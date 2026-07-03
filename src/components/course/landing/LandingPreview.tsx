import {
  CheckCircle2, BookOpen, Quote, ArrowRight, Sparkles,
  Award, Infinity as InfinityIcon, Star, Layers, PlayCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface LandingPreviewProps {
  landing: any;
}

export function LandingPreview({ landing }: LandingPreviewProps) {
  const benefits = Array.isArray(landing.benefits) ? landing.benefits : [];
  const primaryColor = landing.custom_colors?.primary || "#7c3aed";
  const ctaLabel = landing.cta_text || "Quero me inscrever";
  const initials = (landing.testimonial_name || "A")
    .split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase();
  const moduleCount = Array.isArray(landing.modules) ? landing.modules.length : 0;

  return (
    <div className="w-full h-full bg-background font-sans text-foreground overflow-x-hidden">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            {landing.logo_url ? (
              <img src={landing.logo_url} alt="Logo" className="h-8 w-auto" />
            ) : (
              <>
                <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: primaryColor }}>
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <span className="font-display text-lg font-bold">EduGen AI</span>
              </>
            )}
          </div>
          <Button size="sm" style={{ backgroundColor: primaryColor }}>
            {ctaLabel}
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.15] blur-3xl"
          style={{ background: `radial-gradient(500px circle at 50% 0%, ${primaryColor}, transparent 70%)` }}
        />
        <div className="container mx-auto px-4 pt-12 pb-14 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-3xl mx-auto"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium mb-6"
                 style={{ backgroundColor: `${primaryColor}15`, color: primaryColor }}>
              <BookOpen className="h-4 w-4" />
              Curso Online
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight tracking-tight mb-4">
              {landing.headline || "Título do Curso"}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed mb-8 max-w-2xl mx-auto">
              {landing.subtitle || "Subtítulo do curso descrevendo o valor principal."}
            </p>
            <Button size="lg" className="text-base px-8 mb-8" style={{ backgroundColor: primaryColor }}>
              {ctaLabel}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>

            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-muted-foreground">
              {moduleCount > 0 && (
                <div className="flex items-center gap-1.5">
                  <Layers className="h-4 w-4" style={{ color: primaryColor }} />
                  <span>{moduleCount} módulos</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Award className="h-4 w-4" style={{ color: primaryColor }} />
                <span>Certificado incluso</span>
              </div>
              <div className="flex items-center gap-1.5">
                <InfinityIcon className="h-4 w-4" style={{ color: primaryColor }} />
                <span>Acesso vitalício</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Benefits */}
      {benefits.length > 0 && (
        <section className="bg-muted/30 border-y border-border py-14">
          <div className="container mx-auto px-4">
            <h2 className="font-display text-2xl font-bold text-center mb-2">
              O que você vai conquistar
            </h2>
            <p className="text-muted-foreground text-center text-sm mb-8">
              Resultados práticos que você leva para o dia a dia.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
              {benefits.map((b: string, i: number) => (
                <div key={i} className="flex items-start gap-3 bg-card border border-border rounded-xl p-4">
                  <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${primaryColor}15` }}>
                    <CheckCircle2 className="h-4 w-4" style={{ color: primaryColor }} />
                  </div>
                  <span className="pt-0.5">{b}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Summary */}
      <section className="container mx-auto px-4 py-14">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="font-display text-2xl font-bold mb-4">Sobre o curso</h2>
          <p className="text-muted-foreground leading-relaxed">{landing.summary || "Uma breve descrição do curso."}</p>
          <div className="mt-8 grid grid-cols-3 gap-3">
            <div className="text-center p-3 rounded-xl bg-muted/40 border border-border">
              <Award className="h-4 w-4 mx-auto mb-1.5" style={{ color: primaryColor }} />
              <p className="text-[11px] text-muted-foreground leading-snug">Certificado</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-muted/40 border border-border">
              <InfinityIcon className="h-4 w-4 mx-auto mb-1.5" style={{ color: primaryColor }} />
              <p className="text-[11px] text-muted-foreground leading-snug">Acesso ilimitado</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-muted/40 border border-border">
              <PlayCircle className="h-4 w-4 mx-auto mb-1.5" style={{ color: primaryColor }} />
              <p className="text-[11px] text-muted-foreground leading-snug">No seu ritmo</p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonial */}
      {landing.testimonial_text && (
        <section className="bg-muted/30 border-y border-border py-14">
          <div className="container mx-auto px-4">
            <div className="max-w-xl mx-auto bg-card border border-border rounded-2xl p-7 text-center">
              <Quote className="h-8 w-8 mx-auto mb-4 opacity-70" style={{ color: primaryColor }} />
              <div className="flex items-center justify-center gap-0.5 mb-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-current" style={{ color: primaryColor }} />
                ))}
              </div>
              <blockquote className="text-lg italic mb-5 leading-relaxed">
                "{landing.testimonial_text}"
              </blockquote>
              <div className="flex items-center justify-center gap-2.5">
                <div className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ backgroundColor: primaryColor }}>
                  {initials}
                </div>
                <p className="text-sm font-semibold text-muted-foreground">
                  {landing.testimonial_name}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Final CTA */}
      <section className="container mx-auto px-4 py-14">
        <div
          className="max-w-xl mx-auto text-center rounded-2xl p-8 border"
          style={{ background: `linear-gradient(135deg, ${primaryColor}12, transparent 60%)`, borderColor: `${primaryColor}40` }}
        >
          <h2 className="font-display text-2xl font-bold mb-3">Pronto para começar?</h2>
          <p className="text-muted-foreground mb-6 text-sm">
            Inscreva-se agora e tenha acesso imediato a todo o conteúdo do curso.
          </p>
          <Button size="lg" className="text-base px-8" style={{ backgroundColor: primaryColor }}>
            {ctaLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-6 mt-4">
        <div className="container mx-auto px-4 text-center text-xs text-muted-foreground">
          {landing.show_branding !== false && (
            <span>Criado com <span className="font-semibold">EduGen AI</span> · </span>
          )}
          © {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}
