import { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useSubscription } from "@/hooks/useSubscription";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Star, Sparkles, Loader2, CreditCard, Settings } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useState } from "react";

const freeBenefits = [
  { text: "Até 3 cursos por mês", included: true },
  { text: "Até 5 módulos por curso", included: true },
  { text: "Conteúdo refinado com IA", included: true },
  { text: "Quizzes e flashcards automáticos", included: true },
  { text: "Certificado simples (com branding EduGen)", included: true },
  { text: "Exportação Markdown", included: true },
  { text: "Exportação PDF", included: false },
  { text: "Exportação PowerPoint (PPTX)", included: false },
  { text: "Exportação SCORM", included: false },
  { text: "Exportação Moodle XML", included: false },
  { text: "Imagens com IA", included: false },
  { text: "Flashcards interativos (flip)", included: false },
  { text: "Fontes próprias (PDF, YouTube, web)", included: false },
  { text: "Tutor IA para alunos", included: false },
  { text: "EduScore™ pedagógico", included: false },
  { text: "Branding próprio", included: false },
];

const proBenefits = [
  { text: "Até 5 cursos por mês", included: true },
  { text: "Até 10 módulos por curso", included: true },
  { text: "Conteúdo refinado automaticamente", included: true },
  { text: "Quizzes e flashcards automáticos", included: true },
  { text: "Flashcards interativos (flip)", included: true },
  { text: "Imagens com IA", included: true },
  { text: "Certificado personalizável (sem branding EduGen)", included: true },
  { text: "Exportação PDF", included: true },
  { text: "Exportação PowerPoint (PPTX) premium", included: true },
  { text: "Exportação SCORM para LMS", included: true },
  { text: "Exportação Moodle XML", included: true },
  { text: "Exportação Notion", included: true },
  { text: "Fontes próprias (PDF, YouTube, artigos web)", included: true },
  { text: "Tutor IA público para alunos", included: true },
  { text: "EduScore™ — score de qualidade pedagógica", included: true },
  { text: "Script para vídeo/narração", included: true },
  { text: "Tradução pedagógica com adaptação cultural", included: true },
  { text: "Revisão colaborativa com síntese por IA", included: true },
  { text: "Analytics do criador", included: true },
  { text: "Landing page do curso", included: true },
];

export default function Plans() {
  const { plan, isLoading: planLoading } = useSubscription();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get("success") === "true") {
      toast.success("Assinatura realizada com sucesso! Bem-vindo ao Pro 🎉");
      // Sync subscription from Stripe
      supabase.functions.invoke("check-subscription");
    }
    if (searchParams.get("canceled") === "true") {
      toast.info("Checkout cancelado. Você pode tentar novamente quando quiser.");
    }
  }, [searchParams]);

  const handleUpgrade = async () => {
    setCheckoutLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout");
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (err: any) {
      toast.error("Erro ao iniciar checkout. Tente novamente.");
      console.error(err);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal");
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (err: any) {
      toast.error("Erro ao abrir portal. Tente novamente.");
      console.error(err);
    } finally {
      setPortalLoading(false);
    }
  };

  if (planLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="bg-gradient-to-br from-primary/8 via-background to-accent/5 border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-10 text-center">
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-foreground tracking-tight">
            Escolha seu plano
          </h1>
          <p className="text-muted-foreground mt-3 text-base lg:text-lg max-w-xl mx-auto">
            Comece grátis e faça upgrade quando precisar de mais poder
          </p>
        </div>
      </div>

      {/* Cards */}
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
          {/* FREE Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0 }}
            className="relative bg-card rounded-2xl border border-border p-7 flex flex-col"
          >
            <div className="mb-6">
              <Badge variant="secondary" className="text-xs font-semibold mb-4">
                Plano Free
              </Badge>
              <div className="flex items-baseline gap-1">
                <span className="font-display text-4xl font-bold text-foreground">R$ 0</span>
                <span className="text-muted-foreground text-sm">/ mês</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Para explorar e criar seus primeiros cursos
              </p>
            </div>

            <div className="flex-1 space-y-3 mb-8">
              {freeBenefits.map((b, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  {b.included ? (
                    <Check className="h-4 w-4 text-secondary mt-0.5 shrink-0" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground/40 mt-0.5 shrink-0" />
                  )}
                  <span className={`text-sm ${b.included ? "text-foreground" : "text-muted-foreground/50 line-through"}`}>
                    {b.text}
                  </span>
                </div>
              ))}
            </div>

            <Button
              variant="outline"
              className="w-full h-11 font-semibold"
              disabled={plan === "free"}
            >
              {plan === "free" ? "Plano atual" : "Começar grátis"}
            </Button>
          </motion.div>

          {/* PRO Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="relative bg-card rounded-2xl border-2 border-primary/30 p-7 flex flex-col shadow-lg shadow-primary/5"
          >
            {/* Popular badge */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <Badge className="bg-primary text-primary-foreground text-xs font-semibold px-4 py-1 shadow-md">
                <Star className="h-3 w-3 mr-1" />
                Mais popular
              </Badge>
            </div>

            <div className="mb-6 mt-2">
              <Badge className="text-xs font-semibold mb-4 bg-primary/10 text-primary border-primary/20">
                Plano Pro
              </Badge>
              <div className="flex items-baseline gap-1">
                <span className="font-display text-4xl font-bold text-foreground">R$ 59,90</span>
                <span className="text-muted-foreground text-sm">/ mês</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Tudo que você precisa para criar, publicar e vender cursos
              </p>
            </div>

            <div className="flex-1 space-y-3 mb-8">
              {proBenefits.map((b, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span className="text-sm text-foreground">{b.text}</span>
                </div>
              ))}
            </div>

            {plan === "pro" ? (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full h-11 font-semibold border-primary/30 text-primary"
                  disabled
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Plano atual
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={handleManageSubscription}
                  disabled={portalLoading}
                >
                  {portalLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Settings className="h-4 w-4 mr-2" />
                  )}
                  Gerenciar assinatura
                </Button>
              </div>
            ) : (
              <Button
                className="w-full h-11 font-semibold shadow-lg shadow-primary/20"
                onClick={handleUpgrade}
                disabled={checkoutLoading}
              >
                {checkoutLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-2" />
                )}
                Upgrade para Pro
              </Button>
            )}
          </motion.div>
        </div>

        {/* Bottom info */}
        <div className="mt-8 text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            💳 Pagamento seguro via Stripe · Cartão de crédito ou PIX
          </p>
          <p className="text-xs text-muted-foreground/60">
            Cancele a qualquer momento. O downgrade acontece automaticamente ao final do ciclo.
          </p>
        </div>
      </div>
    </div>
  );
}
