import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useSubscription } from "@/hooks/useSubscription";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Star, Sparkles, Loader2, CreditCard, Settings } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

type PlanKey = "free" | "starter" | "pro";

interface FeatureRow {
  label: string;
  values: Record<PlanKey, string | boolean>;
}

const FEATURES: FeatureRow[] = [
  { label: "Cursos por mês", values: { free: "1", starter: "2", pro: "5" } },
  { label: "Módulos por curso", values: { free: "6", starter: "8", pro: "12" } },
  { label: "Imagens com IA", values: { free: "8 por curso", starter: "12 por curso", pro: "18 por curso" } },
  { label: "Exportação PowerPoint (PPTX)", values: { free: "Básico", starter: "Bom", pro: "Premium" } },
  { label: "Abrir no Google Slides", values: { free: false, starter: false, pro: true } },
  { label: "Abrir no Microsoft PowerPoint", values: { free: false, starter: false, pro: true } },
  { label: "Exportação SCORM", values: { free: false, starter: false, pro: true } },
  { label: "Exportação Moodle XML", values: { free: false, starter: false, pro: true } },
  { label: "Tutor IA Público para Alunos", values: { free: false, starter: false, pro: true } },
  { label: "Landing Page do Curso", values: { free: "Simples", starter: "Personalizável", pro: "Totalmente Personalizável" } },
  { label: "Certificado", values: { free: "Com branding EduGen", starter: "Com branding EduGen", pro: "Sem branding" } },
  { label: "Suporte", values: { free: "Comunidade + Email", starter: "Email prioritário", pro: "Prioridade Alta" } },
];

const PLANS: { key: PlanKey; name: string; price: string; period: string; tagline: string; popular?: boolean }[] = [
  { key: "free", name: "Free", price: "Grátis", period: "", tagline: "Para explorar e criar seu primeiro curso" },
  { key: "starter", name: "Starter", price: "R$ 39,90", period: "/ mês", tagline: "Para quem quer evoluir e personalizar" },
  { key: "pro", name: "Pro", price: "R$ 97,00", period: "/ mês", tagline: "Tudo para criar, publicar e vender", popular: true },
];

function renderValue(v: string | boolean) {
  if (v === true) return <Check className="h-4 w-4 text-primary mx-auto" />;
  if (v === false) return <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />;
  return <span className="text-sm text-foreground">{v}</span>;
}

export default function Plans() {
  const { plan, isLoading: planLoading } = useSubscription();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [checkoutLoading, setCheckoutLoading] = useState<PlanKey | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get("success") === "true") {
      toast.success("Assinatura realizada com sucesso! 🎉");
      supabase.functions.invoke("check-subscription");
    }
    if (searchParams.get("canceled") === "true") {
      toast.info("Checkout cancelado. Você pode tentar novamente quando quiser.");
    }
  }, [searchParams]);

  const handleUpgrade = async (target: PlanKey) => {
    setCheckoutLoading(target);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", { body: { plan: target } });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err) {
      toast.error("Erro ao iniciar checkout. Tente novamente.");
      console.error(err);
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleManageSubscription = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal");
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err) {
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

  const currentPlan = (plan as PlanKey) ?? "free";

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="bg-gradient-to-br from-primary/8 via-background to-accent/5 border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-10 text-center">
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-foreground tracking-tight">
            Escolha seu plano
          </h1>
          <p className="text-muted-foreground mt-3 text-base lg:text-lg max-w-xl mx-auto">
            Comece grátis e evolua conforme sua necessidade
          </p>
        </div>
      </div>

      {/* Cards */}
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map((p, idx) => {
            const isCurrent = currentPlan === p.key;
            const isPopular = !!p.popular;
            return (
              <motion.div
                key={p.key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.08 }}
                className={`relative bg-card rounded-2xl p-7 flex flex-col ${
                  isPopular
                    ? "border-2 border-primary/40 shadow-lg shadow-primary/10"
                    : "border border-border"
                }`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground text-xs font-semibold px-4 py-1 shadow-md">
                      <Star className="h-3 w-3 mr-1" />
                      Mais popular
                    </Badge>
                  </div>
                )}

                <div className="mb-6 mt-2">
                  <Badge
                    variant={isPopular ? "default" : "secondary"}
                    className={`text-xs font-semibold mb-4 ${
                      isPopular ? "bg-primary/10 text-primary border-primary/20" : ""
                    }`}
                  >
                    Plano {p.name}
                  </Badge>
                  <div className="flex items-baseline gap-1">
                    <span className="font-display text-4xl font-bold text-foreground">{p.price}</span>
                    {p.period && <span className="text-muted-foreground text-sm">{p.period}</span>}
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">{p.tagline}</p>
                </div>

                <div className="flex-1 space-y-3 mb-8">
                  {FEATURES.map((f, i) => {
                    const v = f.values[p.key];
                    const isOff = v === false;
                    return (
                      <div key={i} className="flex items-start gap-2.5">
                        {v === true ? (
                          <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        ) : v === false ? (
                          <X className="h-4 w-4 text-muted-foreground/40 mt-0.5 shrink-0" />
                        ) : (
                          <Check className="h-4 w-4 text-secondary mt-0.5 shrink-0" />
                        )}
                        <span className={`text-sm ${isOff ? "text-muted-foreground/50 line-through" : "text-foreground"}`}>
                          <span className="text-muted-foreground">{f.label}:</span>{" "}
                          {typeof v === "string" ? <span className="font-medium">{v}</span> : isOff ? "Não incluso" : "Incluído"}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {isCurrent ? (
                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      className={`w-full h-11 font-semibold ${isPopular ? "border-primary/30 text-primary" : ""}`}
                      disabled
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      Plano atual
                    </Button>
                    {p.key !== "free" && (
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
                    )}
                  </div>
                ) : p.key === "free" ? (
                  <Button variant="outline" className="w-full h-11 font-semibold" disabled>
                    Plano inicial
                  </Button>
                ) : (
                  <Button
                    className={`w-full h-11 font-semibold ${
                      isPopular ? "shadow-lg shadow-primary/20" : ""
                    }`}
                    variant={isPopular ? "default" : "outline"}
                    onClick={() => handleUpgrade(p.key)}
                    disabled={checkoutLoading !== null}
                  >
                    {checkoutLoading === p.key ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CreditCard className="h-4 w-4 mr-2" />
                    )}
                    Assinar {p.name}
                  </Button>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Comparison table */}
        <div className="mt-14">
          <h2 className="font-display text-2xl font-bold text-center mb-6">Comparação detalhada</h2>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-4 font-semibold text-muted-foreground">Funcionalidade</th>
                  {PLANS.map((p) => (
                    <th
                      key={p.key}
                      className={`p-4 font-semibold text-center ${
                        p.popular ? "text-primary" : "text-foreground"
                      }`}
                    >
                      {p.name} {p.popular && "★"}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-border">
                  <td className="p-4 font-medium text-muted-foreground">Preço mensal</td>
                  {PLANS.map((p) => (
                    <td key={p.key} className="p-4 text-center font-bold text-foreground">
                      {p.price}
                      {p.period && <span className="text-xs text-muted-foreground font-normal">{p.period}</span>}
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((f, i) => (
                  <tr key={i} className={`border-b border-border last:border-0 ${i % 2 === 1 ? "bg-muted/10" : ""}`}>
                    <td className="p-4 font-medium text-foreground">{f.label}</td>
                    {PLANS.map((p) => (
                      <td key={p.key} className="p-4 text-center">
                        {renderValue(f.values[p.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

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
