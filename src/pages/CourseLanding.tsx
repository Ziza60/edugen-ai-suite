import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, Sparkles, CheckCircle2, BookOpen, Quote, ArrowRight,
  PlayCircle, Award, Infinity as InfinityIcon, Star, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface LandingColors {
  primary: string;
}

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
};

export default function CourseLanding() {
  const { slug } = useParams<{ slug: string }>();

  const { data: landing, isLoading, error } = useQuery({
    queryKey: ["course-landing", slug],
    queryFn: async () => {
      // Try published first (public access), then owner access (no is_published filter)
      const { data, error } = await (supabase.from("course_landings") as any)
        .select("*, courses(title, description, language)")
        .eq("slug", slug!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!slug,
  });

  // Fetch module titles for the course summary section
  const { data: modules = [] } = useQuery({
    queryKey: ["landing-modules", landing?.course_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_modules")
        .select("title, order_index")
        .eq("course_id", landing.course_id)
        .order("order_index");
      if (error) return [];
      return data;
    },
    enabled: !!landing?.course_id,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !landing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Página não encontrada</h1>
          <p className="text-muted-foreground">Este curso não está disponível ou foi removido.</p>
        </div>
      </div>
    );
  }

  const benefits = Array.isArray(landing.benefits) ? landing.benefits : [];
  const courseTitle = landing.courses?.title || "Curso";
  const courseLanguage = landing.courses?.language;
  const colors = (landing.custom_colors as unknown as LandingColors) || { primary: '#7c3aed' };
  const primaryColor = colors.primary;
  const ctaLabel = landing.cta_text || "Quero me inscrever";
  const initials = (landing.testimonial_name || "A")
    .split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-background overflow-x-hidden" style={{ "--primary": primaryColor } as any}>
      <style>
        {`
          .btn-custom { background-color: ${primaryColor} !important; color: white !important; }
          .btn-custom:hover { filter: brightness(1.08); }
          .text-custom { color: ${primaryColor} !important; }
          .bg-custom-light { background-color: ${primaryColor}15 !important; }
          .border-custom { border-color: ${primaryColor}40 !important; }
          .ring-custom { box-shadow: 0 0 0 1px ${primaryColor}30; }
        `}
      </style>

      {/* Header bar */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
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
          <div className="flex items-center gap-2">
            <Link to={`/learn/${slug}`}>
              <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-foreground">
                <PlayCircle className="h-4 w-4" />
                <span className="hidden sm:inline">Acessar curso</span>
              </Button>
            </Link>
            <Button size="sm" className="btn-custom shadow-sm">{ctaLabel}</Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.15] blur-3xl"
          style={{
            background: `radial-gradient(600px circle at 50% 0%, ${primaryColor}, transparent 70%)`,
          }}
        />
        <div className="container mx-auto px-4 pt-20 pb-16 text-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-3xl mx-auto"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium mb-6 bg-custom-light text-custom">
              <BookOpen className="h-4 w-4" />
              Curso Online
            </div>
            <h1 className="font-display text-4xl md:text-6xl font-bold leading-[1.08] tracking-tight mb-5 text-foreground text-balance">
              {landing.headline}
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed mb-8 max-w-2xl mx-auto text-balance">
              {landing.subtitle}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
              <Button size="lg" className="text-base px-8 h-13 btn-custom shadow-lg shadow-black/5">
                {ctaLabel}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Link to={`/learn/${slug}`}>
                <Button size="lg" variant="outline" className="text-base px-8 border-border">
                  <PlayCircle className="mr-2 h-5 w-5" />
                  Começar agora — é grátis
                </Button>
              </Link>
            </div>

            {/* Stat chips */}
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
              {modules.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Layers className="h-4 w-4 text-custom" />
                  <span>{modules.length} módulos</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Award className="h-4 w-4 text-custom" />
                <span>Certificado incluso</span>
              </div>
              <div className="flex items-center gap-1.5">
                <InfinityIcon className="h-4 w-4 text-custom" />
                <span>Acesso vitalício</span>
              </div>
              {courseLanguage && (
                <div className="flex items-center gap-1.5">
                  <span className="uppercase tracking-wide">{courseLanguage}</span>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Benefits */}
      {benefits.length > 0 && (
        <section className="bg-muted/30 border-y border-border">
          <div className="container mx-auto px-4 py-20">
            <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="max-w-2xl mx-auto text-center mb-12">
              <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground mb-3">
                O que você vai conquistar
              </h2>
              <p className="text-muted-foreground">Resultados práticos que você leva para o dia a dia.</p>
            </motion.div>
            <div className="grid sm:grid-cols-2 gap-4 max-w-4xl mx-auto">
              {benefits.map((b: string, i: number) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.4, delay: i * 0.06 }}
                  className="flex items-start gap-3 bg-card border border-border rounded-2xl p-5 transition-shadow hover:shadow-md"
                >
                  <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-custom-light">
                    <CheckCircle2 className="h-4.5 w-4.5 text-custom" />
                  </div>
                  <span className="text-foreground leading-relaxed pt-0.5">{b}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Summary + Course content */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12">
          {/* About */}
          <motion.div {...fadeUp} transition={{ duration: 0.5 }}>
            <h2 className="font-display text-xl font-bold mb-4 text-foreground">Sobre o curso</h2>
            <p className="text-muted-foreground leading-relaxed">{landing.summary}</p>

            {/* Trust badges */}
            <div className="mt-8 grid grid-cols-3 gap-3">
              <div className="text-center p-4 rounded-xl bg-muted/40 border border-border">
                <Award className="h-5 w-5 mx-auto mb-2 text-custom" />
                <p className="text-xs text-muted-foreground leading-snug">Certificado de conclusão</p>
              </div>
              <div className="text-center p-4 rounded-xl bg-muted/40 border border-border">
                <InfinityIcon className="h-5 w-5 mx-auto mb-2 text-custom" />
                <p className="text-xs text-muted-foreground leading-snug">Acesso ilimitado</p>
              </div>
              <div className="text-center p-4 rounded-xl bg-muted/40 border border-border">
                <PlayCircle className="h-5 w-5 mx-auto mb-2 text-custom" />
                <p className="text-xs text-muted-foreground leading-snug">Aprenda no seu ritmo</p>
              </div>
            </div>
          </motion.div>

          {/* Modules list — timeline style */}
          {modules.length > 0 && (
            <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.1 }}>
              <h2 className="font-display text-xl font-bold mb-4 text-foreground">
                Conteúdo programático
              </h2>
              <div className="relative">
                <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />
                <div className="space-y-1">
                  {modules.map((m: any, i: number) => (
                    <div key={i} className="relative flex items-center gap-4 py-2.5">
                      <span className="relative z-10 h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-background border-2 border-custom text-custom">
                        {i + 1}
                      </span>
                      <span className="text-foreground text-sm leading-snug">{m.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </section>

      {/* Testimonial */}
      {landing.testimonial_text && (
        <section className="bg-muted/30 border-y border-border">
          <div className="container mx-auto px-4 py-20">
            <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="max-w-2xl mx-auto">
              <div className="bg-card border border-border rounded-2xl p-8 md:p-10 text-center shadow-sm">
                <Quote className="h-9 w-9 mx-auto mb-5 text-custom opacity-70" />
                <div className="flex items-center justify-center gap-0.5 mb-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-current text-custom" />
                  ))}
                </div>
                <blockquote className="text-lg md:text-xl text-foreground mb-6 leading-relaxed text-balance">
                  "{landing.testimonial_text}"
                </blockquote>
                <div className="flex items-center justify-center gap-3">
                  <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ backgroundColor: primaryColor }}>
                    {initials}
                  </div>
                  <p className="text-sm font-semibold text-foreground text-left">
                    {landing.testimonial_name}
                    <span className="block text-xs font-normal text-muted-foreground/70">Depoimento ilustrativo</span>
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </section>
      )}

      {/* Final CTA */}
      <section className="container mx-auto px-4 py-20">
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.5 }}
          className="max-w-3xl mx-auto text-center rounded-3xl p-10 md:p-14 border border-custom relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${primaryColor}12, transparent 60%)` }}
        >
          <h2 className="font-display text-2xl md:text-4xl font-bold mb-4 text-foreground text-balance">
            Pronto para começar sua transformação?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            Inscreva-se agora e tenha acesso imediato a todo o conteúdo do curso {courseTitle}.
          </p>
          <Button size="lg" className="text-base px-10 h-13 btn-custom shadow-lg shadow-black/5">
            {ctaLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-6">
        <div className="container mx-auto px-4 text-center text-xs text-muted-foreground">
          {landing.show_branding !== false && (
            <span>Criado com <span className="font-semibold">EduGen AI</span> · </span>
          )} © {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}
