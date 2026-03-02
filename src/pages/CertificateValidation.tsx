import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, XCircle, Award, BookOpen, ShieldCheck } from "lucide-react";

export default function CertificateValidation() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["certificate-validation", token],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("validate-certificate", {
        body: { token },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!token,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1a1a2e]">
        <Loader2 className="h-8 w-8 animate-spin text-[#7c5cfc]" />
      </div>
    );
  }

  if (error || !data?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1a1a2e] p-4">
        <div className="max-w-md w-full bg-[#16213e] border border-[#7c5cfc]/30 rounded-2xl p-12 text-center">
          <div className="h-16 w-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <XCircle className="h-8 w-8 text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Certificado inválido</h2>
          <p className="text-gray-400 text-sm">
            {data?.error || "Este certificado não foi encontrado ou o curso não está publicado."}
          </p>
        </div>
      </div>
    );
  }

  const cert = data.certificate;
  const issuedDate = new Date(cert.issued_at).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const validationCode = `CERT-${cert.token.substring(0, 8).toUpperCase()}`;
  const validationUrl = window.location.href;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(validationUrl)}&bgcolor=16213e&color=ffffff`;

  return (
    <div className="min-h-screen bg-[#0f0f23] flex flex-col items-center justify-center p-4 gap-6">
      {/* Page 1: Main Certificate */}
      <div className="w-full max-w-[900px] aspect-[1.414/1] bg-[#16213e] rounded-xl border-2 border-[#7c5cfc]/40 shadow-2xl shadow-[#7c5cfc]/10 relative overflow-hidden flex flex-col">
        {/* Top purple accent bar */}
        <div className="h-1.5 bg-gradient-to-r from-[#7c5cfc] via-[#a78bfa] to-[#7c5cfc]" />

        <div className="flex-1 flex flex-col px-8 py-6 sm:px-12 sm:py-10">
          {/* Header */}
          <div className="flex items-start justify-between mb-6 sm:mb-10">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-gradient-to-br from-[#7c5cfc] to-[#a78bfa] flex items-center justify-center">
                <Award className="h-6 w-6 sm:h-7 sm:w-7 text-white" />
              </div>
              <div>
                <p className="text-white font-bold text-sm sm:text-base">CourseAI</p>
                <p className="text-gray-400 text-[10px] sm:text-xs tracking-widest uppercase">Cursos com Inteligência Artificial</p>
              </div>
            </div>
            <div className="text-right">
              <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-white tracking-wider">CERTIFICADO</h1>
              <p className="text-[#a78bfa] text-xs sm:text-sm tracking-[0.3em] uppercase mt-1">de conclusão</p>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <p className="text-gray-400 italic text-sm sm:text-base mb-2">Certificamos que o(a)</p>
            <h2 className="text-2xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 sm:mb-6" style={{ fontFamily: "Georgia, serif" }}>
              {cert.student_name}
            </h2>
            <p className="text-gray-300 italic text-sm sm:text-base max-w-xl leading-relaxed">
              participou e concluiu o curso <strong className="text-white">"{cert.course_title}"</strong>, em{" "}
              <strong className="text-white">{issuedDate}</strong>.
            </p>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 my-6 sm:my-8">
            {[
              { label: "MÓDULOS", value: `${cert.modules?.length || 0}` },
              { label: "DATA DE EMISSÃO", value: issuedDate },
            ].map((stat) => (
              <div key={stat.label} className="text-center border border-gray-600/30 rounded-lg py-3 sm:py-4">
                <p className="text-gray-500 text-[9px] sm:text-[10px] tracking-widest uppercase mb-1">{stat.label}</p>
                <p className="text-white font-bold text-sm sm:text-lg">{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-end justify-between pt-4 border-t border-gray-600/20">
            <div className="flex items-center gap-3 sm:gap-4">
              <img src={qrUrl} alt="QR Code de validação" className="h-16 w-16 sm:h-20 sm:w-20 rounded" />
              <div>
                <p className="text-gray-500 text-[9px] sm:text-[10px] tracking-widest uppercase">Código de validação</p>
                <p className="text-white font-mono font-bold text-xs sm:text-sm mt-0.5">{validationCode}</p>
                <p className="text-gray-500 text-[9px] sm:text-[10px] mt-1 max-w-[200px] break-all">
                  Valide em {validationUrl}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center">
                <div className="h-px w-56 sm:w-72 bg-gray-500 mb-3" />
                {cert.custom_data?.instructor_name ? (
                  <>
                    <p className="text-white font-bold text-xs sm:text-sm text-center">{cert.custom_data.instructor_name}</p>
                    <p className="text-gray-400 text-[10px] sm:text-xs text-center">Instrutor</p>
                  </>
                ) : (
                  <>
                    <p className="text-white font-bold text-xs sm:text-sm text-center">CourseAI</p>
                    <p className="text-gray-400 text-[10px] sm:text-xs text-center">Plataforma de Cursos com IA</p>
                  </>
                )}
              </div>
              <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-full border-2 border-gray-500 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 sm:h-6 sm:w-6 text-gray-400" />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom purple accent bar */}
        <div className="h-1.5 bg-gradient-to-r from-[#7c5cfc] via-[#a78bfa] to-[#7c5cfc]" />
      </div>

      {/* Page 2: Syllabus */}
      {cert.modules && cert.modules.length > 0 && (
        <div className="w-full max-w-[900px] bg-[#16213e] rounded-xl border-2 border-[#7c5cfc]/40 shadow-2xl shadow-[#7c5cfc]/10 relative overflow-hidden flex flex-col">
          <div className="h-1.5 bg-gradient-to-r from-[#7c5cfc] via-[#a78bfa] to-[#7c5cfc]" />

          <div className="px-8 py-8 sm:px-12 sm:py-10">
            {/* Header */}
            <div className="flex items-center gap-3 mb-8">
              <div className="h-10 w-10 rounded-lg bg-[#7c5cfc]/20 flex items-center justify-center">
                <BookOpen className="h-5 w-5 text-[#a78bfa]" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white">Conteúdo Programático</h2>
            </div>

            {/* Module list */}
            <div className="space-y-4 mb-10">
              {cert.modules.map((mod: any, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-3 w-3 rounded-sm bg-[#7c5cfc]/60 shrink-0" />
                  <p className="text-gray-200 font-medium text-sm sm:text-base">
                    Módulo {mod.order_index}: {mod.title}
                  </p>
                </div>
              ))}
            </div>

            {/* Footer text */}
            <p className="text-gray-400 italic text-sm text-center max-w-2xl mx-auto mb-8">
              Este certificado comprova que o participante concluiu todos os módulos acima.
            </p>

            {/* Bottom bar */}
            <div className="flex items-end justify-between pt-4 border-t border-gray-600/20">
              <div className="flex items-center gap-3">
                <img src={qrUrl} alt="QR Code" className="h-14 w-14 sm:h-16 sm:w-16 rounded" />
                <div>
                  <p className="text-gray-500 text-[9px] sm:text-[10px] tracking-widest uppercase">Código de validação</p>
                  <p className="text-white font-mono font-bold text-xs sm:text-sm">{validationCode}</p>
                </div>
              </div>
              <div className="flex flex-col items-center">
                <div className="h-px w-56 sm:w-72 bg-gray-500 mb-3" />
                <p className="text-white font-bold text-xs sm:text-sm text-center">CourseAI</p>
                <p className="text-gray-400 text-[10px] sm:text-xs text-center">Plataforma de Cursos com IA</p>
              </div>
            </div>
          </div>

          <div className="h-1.5 bg-gradient-to-r from-[#7c5cfc] via-[#a78bfa] to-[#7c5cfc]" />
        </div>
      )}

      {/* Verified badge */}
      <div className="flex items-center gap-2 text-[#7c5cfc] text-sm mb-8">
        <ShieldCheck className="h-4 w-4" />
        <span>Certificado verificado e autêntico</span>
      </div>
    </div>
  );
}
