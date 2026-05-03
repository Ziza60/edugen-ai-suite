import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useSubscription } from "@/hooks/useSubscription";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Check, X, Star, Sparkles, Loader2, CreditCard, Settings } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

const ACCENT = "#DF7C3A";
const GOLD = "#C9A96E";
const SAGE = "#7B9E87";

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

export default function Plans() {
  const { plan, isLoading: planLoading } = useSubscription();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [checkoutLoading, setCheckoutLoading] = useState<PlanKey | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get("success") === "true") {
      toast.success("Assinatura realizada com sucesso!");
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: ACCENT }} />
      </div>
    );
  }

  const currentPlan = (plan as PlanKey) ?? "free";

  const planAccentColor = (key: PlanKey) => {
    if (key === "pro") return ACCENT;
    if (key === "starter") return GOLD;
    return "rgba(232,227,220,0.3)";
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0B0B0F", color: "#E8E3DC" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(232,227,220,0.06)", padding: "2.5rem 0" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 2rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.6875rem", letterSpacing: "0.2em", textTransform: "uppercase", color: GOLD, marginBottom: "0.75rem", fontWeight: 500 }}>Preços</p>
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "clamp(2rem, 4vw, 2.75rem)", fontWeight: 600, letterSpacing: "-0.02em", color: "#E8E3DC", lineHeight: 1.1, marginBottom: "0.75rem" }}>
            Escolha seu plano
          </h1>
          <p style={{ color: "rgba(232,227,220,0.4)", fontSize: "0.9375rem", fontWeight: 300 }}>
            Comece grátis e evolua conforme sua necessidade
          </p>
        </div>
      </div>

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "3rem 2rem" }}>
        {/* Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "4rem" }} className="md:grid-cols-3 grid-cols-1">
          {PLANS.map((p, idx) => {
            const isCurrent = currentPlan === p.key;
            const isPopular = !!p.popular;
            const accentColor = planAccentColor(p.key);

            return (
              <motion.div
                key={p.key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.08 }}
                style={{
                  position: "relative",
                  background: isPopular ? `${ACCENT}0A` : "rgba(232,227,220,0.025)",
                  border: isPopular ? `1px solid ${ACCENT}35` : "1px solid rgba(232,227,220,0.07)",
                  borderRadius: "14px",
                  padding: "2rem",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {isPopular && (
                  <div style={{ position: "absolute", top: "-13px", left: "50%", transform: "translateX(-50%)", background: ACCENT, color: "#0B0B0F", fontSize: "0.6875rem", fontWeight: 700, padding: "3px 14px", borderRadius: "100px", letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                    Mais popular
                  </div>
                )}

                <div style={{ marginBottom: "1.75rem" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: `${accentColor}15`, border: `1px solid ${accentColor}25`, color: accentColor, fontSize: "0.6875rem", fontWeight: 600, padding: "2px 10px", borderRadius: "100px", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1rem" }}>
                    {p.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                    <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "2.25rem", fontWeight: 700, color: "#E8E3DC" }}>{p.price}</span>
                    {p.period && <span style={{ color: "rgba(232,227,220,0.35)", fontSize: "0.875rem", fontWeight: 300 }}>{p.period}</span>}
                  </div>
                  <p style={{ fontSize: "0.8125rem", color: "rgba(232,227,220,0.4)", marginTop: "0.375rem", fontWeight: 300 }}>{p.tagline}</p>
                </div>

                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.625rem", marginBottom: "1.75rem" }}>
                  {FEATURES.map((f, i) => {
                    const v = f.values[p.key];
                    const isOff = v === false;
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                        {v === true ? (
                          <Check className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: accentColor }} />
                        ) : v === false ? (
                          <X className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: "rgba(232,227,220,0.18)" }} />
                        ) : (
                          <Check className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: SAGE }} />
                        )}
                        <span style={{ fontSize: "0.8125rem", color: isOff ? "rgba(232,227,220,0.2)" : "rgba(232,227,220,0.55)", lineHeight: 1.4, textDecoration: isOff ? "line-through" : "none" }}>
                          <span style={{ color: isOff ? "rgba(232,227,220,0.15)" : "rgba(232,227,220,0.35)" }}>{f.label}:</span>{" "}
                          {typeof v === "string" ? <span style={{ color: isOff ? "rgba(232,227,220,0.15)" : "rgba(232,227,220,0.7)", fontWeight: 500 }}>{v}</span> : isOff ? "Não incluso" : "Incluído"}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {isCurrent ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "0.7rem", borderRadius: "8px", border: `1px solid ${accentColor}30`, color: accentColor, fontSize: "0.875rem", fontWeight: 500, cursor: "default" }}>
                      <Sparkles className="h-4 w-4" /> Plano atual
                    </div>
                    {p.key !== "free" && (
                      <button
                        onClick={handleManageSubscription}
                        disabled={portalLoading}
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "0.5rem", borderRadius: "8px", color: "rgba(232,227,220,0.4)", fontSize: "0.8125rem", background: "transparent", border: "none", cursor: "pointer", transition: "color 0.15s" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#E8E3DC")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(232,227,220,0.4)")}
                      >
                        {portalLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Settings className="h-3.5 w-3.5" />}
                        Gerenciar assinatura
                      </button>
                    )}
                  </div>
                ) : p.key === "free" ? (
                  <div style={{ padding: "0.7rem", borderRadius: "8px", border: "1px solid rgba(232,227,220,0.07)", color: "rgba(232,227,220,0.3)", fontSize: "0.875rem", textAlign: "center", cursor: "default" }}>
                    Plano inicial
                  </div>
                ) : (
                  <button
                    onClick={() => handleUpgrade(p.key)}
                    disabled={checkoutLoading !== null}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "0.75rem", borderRadius: "8px", background: isPopular ? ACCENT : "rgba(232,227,220,0.06)", color: isPopular ? "#0B0B0F" : "#E8E3DC", fontSize: "0.875rem", fontWeight: 600, border: "none", cursor: checkoutLoading !== null ? "not-allowed" : "pointer", opacity: checkoutLoading !== null ? 0.6 : 1, transition: "opacity 0.15s" }}
                    onMouseEnter={(e) => { if (checkoutLoading === null) e.currentTarget.style.opacity = "0.85"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                  >
                    {checkoutLoading === p.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                    Assinar {p.name}
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Tabela comparativa */}
        <div>
          <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.75rem", fontWeight: 600, color: "#E8E3DC", textAlign: "center", marginBottom: "1.5rem", letterSpacing: "-0.01em" }}>
            Comparação detalhada
          </h2>
          <div style={{ overflow: "hidden", borderRadius: "12px", border: "1px solid rgba(232,227,220,0.07)", background: "rgba(232,227,220,0.02)" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(232,227,220,0.07)" }}>
                    <th style={{ textAlign: "left", padding: "1rem 1.25rem", color: "rgba(232,227,220,0.4)", fontWeight: 500, fontSize: "0.8125rem" }}>Funcionalidade</th>
                    {PLANS.map((p) => (
                      <th key={p.key} style={{ padding: "1rem 1.25rem", fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, fontSize: "1rem", textAlign: "center", color: p.popular ? ACCENT : "#E8E3DC" }}>
                        {p.name} {p.popular && "★"}
                      </th>
                    ))}
                  </tr>
                  <tr style={{ borderBottom: "1px solid rgba(232,227,220,0.07)", background: "rgba(232,227,220,0.015)" }}>
                    <td style={{ padding: "0.875rem 1.25rem", color: "rgba(232,227,220,0.4)", fontSize: "0.8125rem" }}>Preço mensal</td>
                    {PLANS.map((p) => (
                      <td key={p.key} style={{ padding: "0.875rem 1.25rem", textAlign: "center", fontFamily: "'Cormorant Garamond', serif", fontWeight: 700, fontSize: "1.125rem", color: "#E8E3DC" }}>
                        {p.price}
                        {p.period && <span style={{ fontSize: "0.75rem", color: "rgba(232,227,220,0.35)", fontWeight: 300 }}>{p.period}</span>}
                      </td>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEATURES.map((f, i) => (
                    <tr key={i} style={{ borderBottom: i < FEATURES.length - 1 ? "1px solid rgba(232,227,220,0.05)" : "none", background: i % 2 === 1 ? "rgba(232,227,220,0.01)" : "transparent" }}>
                      <td style={{ padding: "0.875rem 1.25rem", color: "rgba(232,227,220,0.55)" }}>{f.label}</td>
                      {PLANS.map((p) => {
                        const v = f.values[p.key];
                        return (
                          <td key={p.key} style={{ padding: "0.875rem 1.25rem", textAlign: "center" }}>
                            {v === true ? (
                              <Check className="h-4 w-4 mx-auto" style={{ color: p.popular ? ACCENT : SAGE }} />
                            ) : v === false ? (
                              <X className="h-4 w-4 mx-auto" style={{ color: "rgba(232,227,220,0.15)" }} />
                            ) : (
                              <span style={{ color: "rgba(232,227,220,0.7)", fontSize: "0.8125rem" }}>{v}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "2rem", textAlign: "center", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <p style={{ fontSize: "0.875rem", color: "rgba(232,227,220,0.35)" }}>
            Pagamento seguro via Stripe · Cartão de crédito ou PIX
          </p>
          <p style={{ fontSize: "0.75rem", color: "rgba(232,227,220,0.2)" }}>
            Cancele a qualquer momento. O downgrade acontece automaticamente ao final do ciclo.
          </p>
        </div>
      </div>
    </div>
  );
}
