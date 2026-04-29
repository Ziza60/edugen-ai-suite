import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, CheckCircle, BookOpen, Quote, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface LandingColors {
  primary: string;
}

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
  const colors = (landing.custom_colors as unknown as LandingColors) || { primary: '#7c3aed' };
  const primaryColor = colors.primary;

  return (
    <div className="min-h-screen bg-background" style={{ "--primary": primaryColor } as any}>
      <style>
        {`
          .btn-custom { background-color: ${primaryColor} !important; color: white !important; }
          .text-custom { color: ${primaryColor} !important; }
          .bg-custom-light { background-color: ${primaryColor}15 !important; }
          .border-custom { border-color: ${primaryColor}40 !important; }
        `}
      </style>
      {/* Header bar */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
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
          <Button size="sm" className="btn-custom">{landing.cta_text || "Quero me inscrever"}</Button>
        </div>
      </header>

      {/* Hero */}
      <section className="container mx-auto px-4 pt-16 pb-20 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl mx-auto"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium mb-6 bg-custom-light text-custom">
            <BookOpen className="h-4 w-4" />
            Curso Online
          </div>
          <h1 className="font-display text-4xl md:text-6xl font-bold leading-tight mb-4 text-foreground">
            {landing.headline}
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed mb-8">
            {landing.subtitle}
          </p>
          <Button size="lg" className="text-base px-8 btn-custom">
            {landing.cta_text || "Quero me inscrever"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </motion.div>
      </section>

      {/* Benefits */}
      {benefits.length > 0 && (
        <section className="bg-muted/30 border-y border-border">
          <div className="container mx-auto px-4 py-16">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="max-w-2xl mx-auto"
            >
              <h2 className="font-display text-2xl md:text-3xl font-bold text-center mb-10 text-foreground">
                O que você vai conquistar
              </h2>
              <div className="space-y-4">
                {benefits.map((b: string, i: number) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: 0.3 + i * 0.1 }}
                    className="flex items-start gap-3 bg-card border border-border rounded-xl p-4 border-custom"
                  >
                    <CheckCircle className="h-5 w-5 shrink-0 mt-0.5 text-custom" />
                    <span className="text-foreground">{b}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>
      )}

      {/* Summary + Course content */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto grid md:grid-cols-2 gap-10">
          {/* About */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <h2 className="font-display text-xl font-bold mb-4 text-foreground">Sobre o curso</h2>
            <p className="text-muted-foreground leading-relaxed">{landing.summary}</p>
          </motion.div>

          {/* Modules list */}
          {modules.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              <h2 className="font-display text-xl font-bold mb-4 text-foreground">
                Conteúdo programático
              </h2>
              <div className="space-y-2">
                {modules.map((m: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="h-6 w-6 rounded-md flex items-center justify-center text-xs font-bold shrink-0 bg-custom-light text-custom">
                      {i + 1}
                    </span>
                    <span className="text-foreground">{m.title}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </section>

      {/* Testimonial */}
      {landing.testimonial_text && (
        <section className="bg-muted/30 border-y border-border">
          <div className="container mx-auto px-4 py-16">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="max-w-2xl mx-auto text-center"
            >
              <Quote className="h-10 w-10 mx-auto mb-4 opacity-30 text-custom" />
              <blockquote className="text-lg italic text-foreground mb-4 leading-relaxed">
                "{landing.testimonial_text}"
              </blockquote>
              <p className="text-sm font-semibold text-muted-foreground">
                — {landing.testimonial_name}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                * Depoimento ilustrativo
              </p>
            </motion.div>
          </div>
        </section>
      )}

      {/* Final CTA */}
      <section className="container mx-auto px-4 py-20 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          <h2 className="font-display text-2xl md:text-3xl font-bold mb-4 text-foreground">
            Pronto para começar?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            Inscreva-se agora e tenha acesso imediato a todo o conteúdo do curso.
          </p>
          <Button size="lg" className="text-base px-10 btn-custom">
            {landing.cta_text || "Quero me inscrever"}
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
