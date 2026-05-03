import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Award, Loader2, ExternalLink } from "lucide-react";

const ACCENT = "#DF7C3A";
const GOLD = "#C9A96E";
const SAGE = "#7B9E87";

export default function Certificates() {
  const { user } = useAuth();

  const { data: certificates = [], isLoading } = useQuery({
    queryKey: ["certificates", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("certificates")
        .select("*, courses(title)")
        .eq("user_id", user!.id)
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const card = {
    background: "rgba(232,227,220,0.03)",
    border: "1px solid rgba(232,227,220,0.07)",
    borderRadius: "12px",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0B0B0F", color: "#E8E3DC" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(232,227,220,0.06)", padding: "2.5rem 0" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto", padding: "0 2rem" }}>
          <p style={{ fontSize: "0.6875rem", letterSpacing: "0.2em", textTransform: "uppercase", color: GOLD, marginBottom: "0.75rem", fontWeight: 500 }}>Conquistas</p>
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "clamp(2rem, 4vw, 2.75rem)", fontWeight: 600, letterSpacing: "-0.02em", color: "#E8E3DC", lineHeight: 1.1, marginBottom: "0.5rem" }}>
            Certificados
          </h1>
          <p style={{ color: "rgba(232,227,220,0.4)", fontSize: "0.9375rem", fontWeight: 300 }}>
            Certificados emitidos para seus cursos
          </p>
        </div>
      </div>

      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2.5rem 2rem" }}>
        {isLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: "5rem" }}>
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: ACCENT }} />
          </div>
        ) : certificates.length === 0 ? (
          <div style={{ ...card, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "5rem 2rem", textAlign: "center" }}>
            <div style={{ width: "64px", height: "64px", borderRadius: "16px", background: "rgba(223,124,58,0.1)", border: "1px solid rgba(223,124,58,0.2)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.5rem" }}>
              <Award className="h-8 w-8" style={{ color: ACCENT }} />
            </div>
            <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.5rem", fontWeight: 600, color: "#E8E3DC", marginBottom: "0.5rem" }}>
              Nenhum certificado ainda
            </h3>
            <p style={{ color: "rgba(232,227,220,0.4)", maxWidth: "380px", fontSize: "0.875rem", fontWeight: 300, lineHeight: 1.6 }}>
              Publique um curso e emita certificados para seus alunos.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1px", background: "rgba(232,227,220,0.06)", borderRadius: "12px", overflow: "hidden" }}>
            {certificates.map((cert) => (
              <div
                key={cert.id}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.25rem 1.5rem", background: "#0B0B0F", transition: "background 0.15s", cursor: "default" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(232,227,220,0.025)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#0B0B0F")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <div style={{ width: "36px", height: "36px", borderRadius: "9px", background: "rgba(223,124,58,0.1)", border: "1px solid rgba(223,124,58,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Award className="h-4 w-4" style={{ color: ACCENT }} />
                  </div>
                  <div>
                    <p style={{ fontSize: "0.9375rem", fontWeight: 500, color: "#E8E3DC", marginBottom: "2px" }}>{cert.student_name}</p>
                    <p style={{ fontSize: "0.8125rem", color: "rgba(232,227,220,0.4)" }}>
                      {(cert as any).courses?.title} · {new Date(cert.issued_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span style={{ fontSize: "0.6875rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(201,169,110,0.7)", background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.18)", padding: "2px 10px", borderRadius: "100px" }}>
                    {cert.template}
                  </span>
                  <a
                    href={`/certificate/${cert.token}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "32px", height: "32px", borderRadius: "8px", color: "rgba(232,227,220,0.4)", background: "transparent", border: "none", cursor: "pointer", transition: "all 0.15s", textDecoration: "none" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(232,227,220,0.06)"; e.currentTarget.style.color = "#E8E3DC"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,227,220,0.4)"; }}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
