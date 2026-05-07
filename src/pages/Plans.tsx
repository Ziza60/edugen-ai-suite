import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useSubscription } from "@/hooks/useSubscription";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Check, X, Sparkles, Loader2, CreditCard, Settings, Zap, Info } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

const ACCENT  = "#DF7C3A";
const GOLD    = "#C9A96E";
const SAGE    = "#7B9E87";
const LAVENDER = "#A08EC2";
const BG      = "#0B0B0F";
const TEXT    = "#E8E3DC";

type PlanKey   = "free" | "starter" | "pro";
type Billing   = "monthly" | "annual";

// ── Pricing ──────────────────────────────────────────────────────────
const PRICING: Record<PlanKey, { monthly: number; annual: number; label: string }> = {
  free:    { monthly: 0,      annual: 0,      label: "Grátis"    },
  starter: { monthly: 54.90,  annual: 41.90,  label: "Criador"   },
  pro:     { monthly: 127.00, annual: 97.00,  label: "Pro"       },
};

// ── Feature categories ────────────────────────────────────────────────
interface FeatureRow {
  label:  string;
  tip?:   string;
  values: Record<PlanKey, string | boolean>;
}

interface FeatureCategory {
  title: string;
  icon:  string;
  rows:  FeatureRow[];
}

const CATEGORIES: FeatureCategory[] = [
  {
    title: "Criação de Cursos",
    icon: "✦",
    rows: [
      { label: "Cursos por mês",        values: { free: "1",  starter: "4",  pro: "12"  } },
      { label: "Módulos por curso",      values: { free: "5",  starter: "10", pro: "15"  } },
      { label: "Arquivos fonte/curso",   tip: "PDFs, texto, markdown, YouTube",
                                         values: { free: "3",  starter: "5",  pro: "10"  } },
      { label: "Análises de PDF/hora",   values: { free: "3",  starter: "15", pro: "50"  } },
      { label: "Idiomas de geração",     values: { free: "PT-BR", starter: "PT-BR, EN, ES", pro: "PT-BR, EN, ES, FR, DE + mais" } },
      { label: "Translate AI",           tip: "Traduz o curso inteiro para outro idioma",
                                         values: { free: false, starter: false, pro: true  } },
    ],
  },
  {
    title: "Conteúdo & IA",
    icon: "◈",
    rows: [
      { label: "Geração por IA (Gemini)",  values: { free: true,  starter: true,  pro: true  } },
      { label: "EduScore™",                tip: "Avaliação pedagógica com IA",
                                           values: { free: false, starter: true,  pro: true  } },
      { label: "Restructure AI",           tip: "Reformata o conteúdo seguindo boas práticas",
                                           values: { free: false, starter: true,  pro: true  } },
      { label: "Imagens com IA",           values: { free: "—",   starter: "15/curso", pro: "25/curso" } },
      { label: "Flashcards automáticos",   values: { free: false, starter: true,  pro: true  } },
      { label: "Quizzes automáticos",      values: { free: false, starter: true,  pro: true  } },
      { label: "Tutor IA para alunos",     tip: "Chat baseado no conteúdo do curso para alunos",
                                           values: { free: false, starter: false, pro: true  } },
    ],
  },
  {
    title: "Exportação",
    icon: "⤓",
    rows: [
      { label: "Markdown (.md)",           values: { free: true,  starter: true,  pro: true  } },
      { label: "Word / DOCX",              values: { free: true,  starter: true,  pro: true  } },
      { label: "PDF",                      values: { free: false, starter: true,  pro: true  } },
      { label: "PowerPoint — EduGen v4",   values: { free: false, starter: true,  pro: true  } },
      { label: "PowerPoint — Presenton AI",tip: "Templates premium gerados por IA · 3 exports incluídos/mês",
                                           values: { free: false, starter: false, pro: "3/mês"  } },
      { label: "PowerPoint — 2Slides AI",  tip: "Design profissional premium · compartilha a cota de 3 exports/mês",
                                           values: { free: false, starter: false, pro: "3/mês (compartilhado)"  } },
      { label: "SCORM (LMS)",              values: { free: false, starter: false, pro: true  } },
      { label: "Moodle XML",               values: { free: false, starter: false, pro: true  } },
      { label: "Notion",                   values: { free: false, starter: false, pro: true  } },
      { label: "Google Slides / MS Office",values: { free: false, starter: false, pro: true  } },
    ],
  },
  {
    title: "Publicação & Alunos",
    icon: "◎",
    rows: [
      { label: "Landing page do curso",    values: { free: "Básica",  starter: "Personalizável",  pro: "Completa (sem branding)" } },
      { label: "Portal do aluno",          values: { free: false,     starter: true,               pro: true  } },
      { label: "Progresso do aluno",       values: { free: false,     starter: true,               pro: true  } },
    ],
  },
  {
    title: "Certificado",
    icon: "◇",
    rows: [
      { label: "Emissão de certificado",   values: { free: "Com branding EduGen", starter: "Com branding EduGen", pro: "Totalmente personalizado" } },
      { label: "Logo do instrutor",        values: { free: false, starter: false, pro: true } },
      { label: "Sem marca EduGen",         values: { free: false, starter: false, pro: true } },
    ],
  },
  {
    title: "Suporte",
    icon: "◉",
    rows: [
      { label: "Suporte",                  values: { free: "Comunidade + Email",  starter: "Email prioritário",  pro: "Prioridade alta + Onboarding" } },
      { label: "Analytics de criação",     values: { free: "Básico",              starter: "Intermediário",       pro: "Avançado"                      } },
    ],
  },
];

// ── Plan visual config ────────────────────────────────────────────────
const PLAN_CONFIG: Record<PlanKey, {
  name: string; tagline: string; accent: string;
  badge?: string; popular?: boolean; highlight: string;
}> = {
  free: {
    name:      "Free",
    tagline:   "Para explorar e criar seu primeiro curso",
    accent:    "rgba(232,227,220,0.3)",
    highlight: "rgba(232,227,220,0.03)",
  },
  starter: {
    name:      "Criador",
    tagline:   "Para educadores que criam com frequência",
    accent:    GOLD,
    badge:     "Mais escolhido",
    popular:   true,
    highlight: `${GOLD}08`,
  },
  pro: {
    name:      "Pro",
    tagline:   "Para escolas e infoprodutores profissionais",
    accent:    ACCENT,
    highlight: `${ACCENT}0A`,
  },
};

// ── Highlights per plan (top bullets on card) ─────────────────────────
const HIGHLIGHTS: Record<PlanKey, string[]> = {
  free: [
    "1 curso/mês · 5 módulos",
    "Exportação MD + DOCX",
    "Landing page básica",
  ],
  starter: [
    "4 cursos/mês · 10 módulos",
    "IA: imagens, flashcards, quizzes",
    "EduScore™ + Restructure AI",
    "PDF + PPTX v4 + Portal do aluno",
  ],
  pro: [
    "12 cursos/mês · 15 módulos",
    "Tutor IA para seus alunos",
    "SCORM · Moodle · Notion · Google/MS Office",
    "3 exports premium/mês (Presenton AI + 2Slides)",
    "PPTX v4 ilimitado no plano",
    "Certificado sem branding EduGen",
    "Translate AI (múltiplos idiomas)",
  ],
};

const PLANS: PlanKey[] = ["free", "starter", "pro"];

export default function Plans() {
  const { plan, isLoading: planLoading } = useSubscription();
  const { user }        = useAuth();
  const [searchParams]  = useSearchParams();
  const navigate        = useNavigate();
  const [billing, setBilling]                   = useState<Billing>("monthly");
  const [checkoutLoading, setCheckoutLoading]   = useState<PlanKey | null>(null);
  const [portalLoading, setPortalLoading]       = useState(false);
  const [expandedCat, setExpandedCat]           = useState<string | null>(null);

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

  const displayPrice = (key: PlanKey) => {
    const p = PRICING[key];
    if (key === "free") return { main: "Grátis", sub: "" };
    const v = billing === "annual" ? p.annual : p.monthly;
    return { main: `R$ ${v.toFixed(2).replace(".", ",")}`, sub: "/ mês" };
  };

  const annualSavings = (key: PlanKey) => {
    if (key === "free") return null;
    const p = PRICING[key];
    const saved = (p.monthly - p.annual) * 12;
    const pct   = Math.round((1 - p.annual / p.monthly) * 100);
    return { saved: saved.toFixed(0), pct };
  };

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT }}>

      {/* ── Header ── */}
      <div style={{ borderBottom: "1px solid rgba(232,227,220,0.06)", padding: "2.5rem 0" }}>
        <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "0 2rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.6875rem", letterSpacing: "0.2em", textTransform: "uppercase", color: GOLD, marginBottom: "0.75rem", fontWeight: 500 }}>Preços</p>
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "clamp(2rem, 4vw, 2.75rem)", fontWeight: 600, letterSpacing: "-0.02em", color: TEXT, lineHeight: 1.1, marginBottom: "0.75rem" }}>
            Escolha seu plano
          </h1>
          <p style={{ color: "rgba(232,227,220,0.4)", fontSize: "0.9375rem", fontWeight: 300, marginBottom: "2rem" }}>
            Comece grátis · Cancele a qualquer momento
          </p>

          {/* Billing toggle */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0", background: "rgba(232,227,220,0.05)", border: "1px solid rgba(232,227,220,0.08)", borderRadius: "100px", padding: "4px" }}>
            {(["monthly", "annual"] as Billing[]).map((b) => (
              <button
                key={b}
                onClick={() => setBilling(b)}
                style={{
                  padding: "6px 20px",
                  borderRadius: "100px",
                  fontSize: "0.8125rem",
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  background: billing === b ? ACCENT : "transparent",
                  color: billing === b ? BG : "rgba(232,227,220,0.5)",
                  position: "relative",
                }}
                data-testid={`billing-${b}`}
              >
                {b === "monthly" ? "Mensal" : "Anual"}
                {b === "annual" && (
                  <span style={{
                    position: "absolute", top: "-10px", right: "-6px",
                    background: SAGE, color: BG, fontSize: "0.5rem",
                    fontWeight: 700, padding: "1px 5px", borderRadius: "100px",
                    letterSpacing: "0.05em", whiteSpace: "nowrap",
                  }}>
                    ATÉ 25% OFF
                  </span>
                )}
              </button>
            ))}
          </div>

          {billing === "annual" && (
            <p style={{ fontSize: "0.75rem", color: SAGE, marginTop: "0.75rem", fontWeight: 400 }}>
              Cobrado anualmente — economize até R$ 360/ano no Pro
            </p>
          )}
        </div>
      </div>

      <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "3rem 2rem" }}>

        {/* ── Plan cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "5rem" }}>
          {PLANS.map((key, idx) => {
            const cfg       = PLAN_CONFIG[key];
            const isCurrent = currentPlan === key;
            const price     = displayPrice(key);
            const savings   = billing === "annual" ? annualSavings(key) : null;

            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.08, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  position: "relative",
                  background: cfg.highlight,
                  border: cfg.popular
                    ? `1px solid ${cfg.accent}40`
                    : "1px solid rgba(232,227,220,0.07)",
                  borderRadius: "16px",
                  padding: "1.75rem",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* Badge */}
                {cfg.badge && (
                  <div style={{
                    position: "absolute", top: "-13px", left: "50%", transform: "translateX(-50%)",
                    background: cfg.accent, color: BG, fontSize: "0.6rem", fontWeight: 700,
                    padding: "3px 14px", borderRadius: "100px", letterSpacing: "0.1em",
                    textTransform: "uppercase", whiteSpace: "nowrap",
                  }}>
                    {cfg.badge}
                  </div>
                )}

                {/* Plan name */}
                <div style={{ marginBottom: "1.5rem" }}>
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: "6px",
                    background: `${cfg.accent}15`, border: `1px solid ${cfg.accent}25`,
                    color: cfg.accent, fontSize: "0.625rem", fontWeight: 700,
                    padding: "2px 10px", borderRadius: "100px",
                    letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.875rem",
                  }}>
                    {cfg.name}
                  </div>

                  {/* Price */}
                  <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                    <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "2.25rem", fontWeight: 700, color: TEXT, lineHeight: 1 }}>
                      {price.main}
                    </span>
                    {price.sub && (
                      <span style={{ color: "rgba(232,227,220,0.35)", fontSize: "0.8125rem", fontWeight: 300 }}>{price.sub}</span>
                    )}
                  </div>

                  {savings && (
                    <motion.div
                      key={`savings-${key}-${billing}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      style={{ marginTop: "4px", display: "flex", alignItems: "center", gap: "6px" }}
                    >
                      <span style={{ fontSize: "0.6875rem", color: SAGE, fontWeight: 500 }}>
                        Economia de R$ {savings.saved}/ano ({savings.pct}% off)
                      </span>
                    </motion.div>
                  )}

                  {billing === "annual" && key !== "free" && (
                    <p style={{ fontSize: "0.6875rem", color: "rgba(232,227,220,0.3)", marginTop: "2px" }}>
                      Cobrado como R$ {(PRICING[key].annual * 12).toFixed(2).replace(".", ",")}/ano
                    </p>
                  )}

                  <p style={{ fontSize: "0.8rem", color: "rgba(232,227,220,0.38)", marginTop: "0.5rem", fontWeight: 300, lineHeight: 1.4 }}>
                    {cfg.tagline}
                  </p>
                </div>

                {/* Highlights */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem" }}>
                  {HIGHLIGHTS[key].map((h, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                      <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: cfg.accent, flexShrink: 0, marginTop: "6px" }} />
                      <span style={{ fontSize: "0.8125rem", color: "rgba(232,227,220,0.65)", lineHeight: 1.45 }}>{h}</span>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                {isCurrent ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                      padding: "0.7rem", borderRadius: "10px",
                      border: `1px solid ${cfg.accent}30`, color: cfg.accent,
                      fontSize: "0.875rem", fontWeight: 500, cursor: "default",
                    }}>
                      <Sparkles className="h-4 w-4" /> Plano atual
                    </div>
                    {key !== "free" && (
                      <button
                        onClick={handleManageSubscription}
                        disabled={portalLoading}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                          padding: "0.5rem", borderRadius: "8px",
                          color: "rgba(232,227,220,0.4)", fontSize: "0.8rem",
                          background: "transparent", border: "none", cursor: "pointer", transition: "color 0.15s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = TEXT)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(232,227,220,0.4)")}
                      >
                        {portalLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Settings className="h-3.5 w-3.5" />}
                        Gerenciar assinatura
                      </button>
                    )}
                  </div>
                ) : key === "free" ? (
                  <div style={{
                    padding: "0.7rem", borderRadius: "10px",
                    border: "1px solid rgba(232,227,220,0.07)",
                    color: "rgba(232,227,220,0.3)", fontSize: "0.875rem", textAlign: "center", cursor: "default",
                  }}>
                    Plano inicial — sempre grátis
                  </div>
                ) : (
                  <button
                    onClick={() => handleUpgrade(key)}
                    disabled={checkoutLoading !== null}
                    data-testid={`button-upgrade-${key}`}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                      padding: "0.75rem", borderRadius: "10px",
                      background: cfg.popular ? cfg.accent : "rgba(232,227,220,0.07)",
                      color: cfg.popular ? BG : TEXT,
                      fontSize: "0.875rem", fontWeight: 600,
                      border: cfg.popular ? "none" : `1px solid ${cfg.accent}30`,
                      cursor: checkoutLoading !== null ? "not-allowed" : "pointer",
                      opacity: checkoutLoading !== null ? 0.6 : 1,
                      transition: "opacity 0.15s",
                    }}
                    onMouseEnter={(e) => { if (checkoutLoading === null) e.currentTarget.style.opacity = "0.85"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                  >
                    {checkoutLoading === key
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : key === "pro" ? <Zap className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                    {billing === "annual" ? `Assinar ${cfg.name} — Anual` : `Assinar ${cfg.name}`}
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* ── Detailed comparison table ── */}
        <div>
          <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.875rem", fontWeight: 600, color: TEXT, textAlign: "center", marginBottom: "0.5rem", letterSpacing: "-0.01em" }}>
            Comparação detalhada
          </h2>
          <p style={{ textAlign: "center", fontSize: "0.875rem", color: "rgba(232,227,220,0.3)", marginBottom: "2.5rem" }}>
            Todas as funcionalidades incluídas em cada plano
          </p>

          <div style={{ overflow: "hidden", borderRadius: "14px", border: "1px solid rgba(232,227,220,0.07)" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: "0.875rem", borderCollapse: "collapse" }}>

                {/* Sticky header */}
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(232,227,220,0.08)", background: "rgba(11,11,15,0.95)" }}>
                    <th style={{ textAlign: "left", padding: "1.125rem 1.5rem", color: "rgba(232,227,220,0.35)", fontWeight: 500, fontSize: "0.8125rem", width: "38%" }}>
                      Funcionalidade
                    </th>
                    {PLANS.map((key) => {
                      const cfg = PLAN_CONFIG[key];
                      const p   = displayPrice(key);
                      return (
                        <th key={key} style={{ padding: "1.125rem 1rem", textAlign: "center", width: "20.67%" }}>
                          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 700, fontSize: "1.0625rem", color: cfg.accent, marginBottom: "2px" }}>
                            {cfg.name}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "rgba(232,227,220,0.4)", fontWeight: 400 }}>
                            {key === "free" ? "Grátis" : `R$ ${(billing === "annual" ? PRICING[key].annual : PRICING[key].monthly).toFixed(2).replace(".", ",")}/mês`}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {CATEGORIES.flatMap((cat, catIdx) => [
                    <tr
                      key={`cat-${catIdx}`}
                      style={{
                        background: "rgba(232,227,220,0.03)",
                        borderTop: catIdx > 0 ? "1px solid rgba(232,227,220,0.06)" : "none",
                        borderBottom: "1px solid rgba(232,227,220,0.06)",
                      }}
                    >
                      <td colSpan={4} style={{ padding: "0.625rem 1.5rem" }}>
                        <span style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.15em", color: GOLD }}>
                          {cat.icon} {cat.title}
                        </span>
                      </td>
                    </tr>,
                    ...cat.rows.map((row, rowIdx) => (
                      <tr
                        key={`row-${catIdx}-${rowIdx}`}
                        style={{
                          borderBottom: rowIdx < cat.rows.length - 1 ? "1px solid rgba(232,227,220,0.04)" : "none",
                          background: rowIdx % 2 === 1 ? "rgba(232,227,220,0.012)" : "transparent",
                        }}
                      >
                        <td style={{ padding: "0.8125rem 1.5rem", color: "rgba(232,227,220,0.55)" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            {row.label}
                            {row.tip && (
                              <span title={row.tip} style={{ cursor: "help", color: "rgba(232,227,220,0.2)", flexShrink: 0 }}>
                                <Info className="h-3 w-3" />
                              </span>
                            )}
                          </span>
                        </td>
                        {PLANS.map((key) => {
                          const cfg = PLAN_CONFIG[key];
                          const v   = row.values[key];
                          return (
                            <td key={key} style={{ padding: "0.8125rem 1rem", textAlign: "center" }}>
                              {v === true ? (
                                <Check className="h-4 w-4 mx-auto" style={{ color: cfg.accent }} />
                              ) : v === false ? (
                                <X className="h-3.5 w-3.5 mx-auto" style={{ color: "rgba(232,227,220,0.12)" }} />
                              ) : (
                                <span style={{ color: "rgba(232,227,220,0.7)", fontSize: "0.8125rem" }}>{v}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── Cost transparency note ── */}
        <div style={{ marginTop: "3rem", padding: "1.25rem 1.5rem", borderRadius: "12px", border: "1px solid rgba(232,227,220,0.06)", background: "rgba(232,227,220,0.02)" }}>
          <p style={{ fontSize: "0.75rem", color: "rgba(232,227,220,0.3)", textAlign: "center", lineHeight: 1.7 }}>
            Preços calculados com base nos custos reais de infraestrutura (Supabase), modelos de IA (Google Gemini),
            e APIs de terceiros (2Slides, Presenton). Valores em Reais. Pagamento seguro via Stripe · Cartão, PIX ou boleto.
          </p>
          <p style={{ fontSize: "0.6875rem", color: "rgba(232,227,220,0.18)", textAlign: "center", marginTop: "4px" }}>
            Cancele a qualquer momento. O downgrade acontece automaticamente ao final do ciclo.
          </p>
        </div>

        {/* ── FAQ mini ── */}
        <div style={{ marginTop: "4rem" }}>
          <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.5rem", fontWeight: 600, color: TEXT, textAlign: "center", marginBottom: "2rem", letterSpacing: "-0.01em" }}>
            Dúvidas frequentes
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem" }}>
            {[
              {
                q: "Posso trocar de plano a qualquer momento?",
                a: "Sim. Upgrades têm efeito imediato; downgrades entram em vigor ao fim do ciclo atual.",
              },
              {
                q: "O que acontece quando atinjo o limite de cursos?",
                a: "Você pode editar cursos existentes sem restrição. Novos cursos ficam bloqueados até o próximo mês ou com upgrade.",
              },
              {
                q: "As exportações SCORM e Moodle funcionam em qualquer LMS?",
                a: "Sim. Seguimos os padrões SCORM 2004 e Moodle XML compatíveis com Moodle, Canvas, Blackboard e outros.",
              },
              {
                q: "O Tutor IA consome créditos separados?",
                a: "Não. Está incluído no plano Pro sem cobrança adicional por consulta.",
              },
              {
                q: "O que são os 3 exports premium/mês do Pro?",
                a: "Presenton AI e 2Slides AI geram slides com design profissional por IA. O Pro inclui 3 exports desse tipo por mês. PPTX v4 (motor próprio) é ilimitado. Créditos extras disponíveis em breve.",
              },
              {
                q: "Posso usar Presenton ou 2Slides no plano Criador?",
                a: "Não. Esses motores premium de design por IA são exclusivos do Pro. O Criador inclui PPTX v4 (motor EduGen), que já entrega apresentações de alta qualidade.",
              },
              {
                q: "Como funciona o faturamento anual?",
                a: "Cobrado em uma parcela única anual com desconto de até 25%. Ex.: Pro anual = R$ 1.164/ano vs R$ 1.524 no mensal.",
              },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  padding: "1.125rem 1.25rem",
                  borderRadius: "10px",
                  border: "1px solid rgba(232,227,220,0.06)",
                  background: "rgba(232,227,220,0.02)",
                }}
              >
                <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "rgba(232,227,220,0.8)", marginBottom: "0.5rem", lineHeight: 1.4 }}>
                  {item.q}
                </p>
                <p style={{ fontSize: "0.8125rem", color: "rgba(232,227,220,0.4)", lineHeight: 1.6 }}>
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
