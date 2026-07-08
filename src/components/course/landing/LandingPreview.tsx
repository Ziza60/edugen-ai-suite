import { CheckCircle, BookOpen, Quote, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface LandingPreviewProps {
  landing: any;
}

export function LandingPreview({ landing }: LandingPreviewProps) {
  const benefits = Array.isArray(landing.benefits) ? landing.benefits : [];
  const primaryColor = landing.custom_colors?.primary || "#7c3aed";
  
  return (
    <div className="w-full h-full bg-background font-sans text-foreground">
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
            {landing.cta_text || "Quero me inscrever"}
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="container mx-auto px-4 pt-12 pb-16 text-center">
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
          <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight mb-4">
            {landing.headline || "Título do Curso"}
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed mb-8">
            {landing.subtitle || "Subtítulo do curso descrevendo o valor principal."}
          </p>
          <Button size="lg" className="text-base px-8" style={{ backgroundColor: primaryColor }}>
            {landing.cta_text || "Quero me inscrever"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </motion.div>
      </section>

      {/* Benefits */}
      {benefits.length > 0 && (
        <section className="bg-muted/30 border-y border-border py-12">
          <div className="container mx-auto px-4">
            <h2 className="font-display text-2xl font-bold text-center mb-8">
              O que você vai conquistar
            </h2>
            <div className="max-w-2xl mx-auto space-y-3">
              {benefits.map((b: string, i: number) => (
                <div key={i} className="flex items-start gap-3 bg-card border border-border rounded-xl p-4">
                  <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: primaryColor }} />
                  <span>{b}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Summary */}
      <section className="container mx-auto px-4 py-12">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="font-display text-2xl font-bold mb-4">Sobre o curso</h2>
          <p className="text-muted-foreground leading-relaxed">{landing.summary || "Uma breve descrição do curso."}</p>
        </div>
      </section>

      {/* Testimonial */}
      {landing.testimonial_text && (
        <section className="bg-muted/30 border-y border-border py-12">
          <div className="container mx-auto px-4 text-center">
            <Quote className="h-10 w-10 mx-auto mb-4 opacity-20" style={{ color: primaryColor }} />
            <blockquote className="text-lg italic mb-4 leading-relaxed max-w-2xl mx-auto">
              "{landing.testimonial_text}"
            </blockquote>
            <p className="text-sm font-semibold text-muted-foreground">
              — {landing.testimonial_name}
            </p>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-border py-6 mt-12">
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
