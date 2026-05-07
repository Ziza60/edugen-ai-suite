import { useNavigate } from "react-router-dom";
import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription, useMonthlyUsage } from "@/hooks/useSubscription";
import { useDevMode } from "@/hooks/useDevMode";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus, Loader2, Trash2, Pencil, GraduationCap, BrainCircuit,
  Sparkles, Lightbulb, BarChart3, Bot,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { OnboardingModal, useOnboarding } from "@/components/OnboardingModal";

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:          "#0B0B0F",
  surface:     "#131318",
  surfaceUp:   "#1A1A22",
  surfaceHov:  "#1F1F29",
  text:        "#EDE8DF",
  textMuted:   "#7D7870",
  textFaint:   "#3E3C38",
  border:      "rgba(255,255,255,0.055)",
  borderHov:   "rgba(255,255,255,0.11)",
  accent:      "#DF7C3A",
  accentGlow:  "rgba(223,124,58,0.13)",
  accentBorder:"rgba(223,124,58,0.22)",
  mint:        "#4DCB8D",
  mintGlow:    "rgba(77,203,141,0.1)",
  mintBorder:  "rgba(77,203,141,0.22)",
  red:         "#D95A5A",
  redGlow:     "rgba(217,90,90,0.1)",
};

// ── Per-course accent colors (left bar) ──────────────────────────────────────
const ACCENTS = [
  "#DF7C3A","#4DCB8D","#7B8FE8","#E8C24A",
  "#E05A8A","#4AB8E8","#A87BE0","#5BE0B0","#E06060","#60C0E0",
];
function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h);
}
function accentFor(id: string) { return ACCENTS[hashStr(id) % ACCENTS.length]; }
function initialsOf(t: string) {
  return t.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

const SUGGESTIONS = [
  { Icon: BarChart3,    title: "Estratégias de Social Media",    desc: "Marketing digital para iniciantes" },
  { Icon: Bot,          title: "Introdução à IA",                desc: "Conceitos fundamentais de IA e ML" },
  { Icon: GraduationCap,title: "Metodologias de Ensino Online",  desc: "Técnicas para EAD" },
];

const serif: React.CSSProperties = { fontFamily: "'Cormorant Garamond', 'Georgia', serif" };
const sans:  React.CSSProperties = { fontFamily: "'DM Sans', 'Inter', sans-serif" };

// ── Small icon button ─────────────────────────────────────────────────────────
function IconBtn({ children, onClick, title, hoverColor }:
  { children: React.ReactNode; onClick: () => void; title: string; hoverColor: string }) {
  const [hov, setHov] = useState(false);
  return (
    <button title={title} onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        ...sans,
        width: 32, height: 32, borderRadius: 7,
        border: `1px solid ${hov ? hoverColor + "50" : C.border}`,
        background: hov ? hoverColor + "16" : "transparent",
        color: hov ? hoverColor : C.textMuted,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", transition: "all 0.15s",
      }}
    >{children}</button>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const { user }         = useAuth();
  const { plan, limits } = useSubscription();
  const { usage }        = useMonthlyUsage();
  const { isDev }        = useDevMode();
  const navigate         = useNavigate();
  const queryClient      = useQueryClient();
  const { open: onboardingOpen, dismiss: dismissOnboarding } = useOnboarding();

  const [deleting,     setDeleting]     = useState<{ id: string; title: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all"|"draft"|"published">("all");
  const [sortBy,       setSortBy]       = useState<"recent"|"oldest"|"title">("recent");

  // Inject fonts
  useEffect(() => {
    const id = "dashboard-fonts";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id    = id;
      link.rel   = "stylesheet";
      link.href  = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,500;0,600;0,700;1,300;1,500&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap";
      document.head.appendChild(link);
    }
  }, []);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: courses = [], isLoading } = useQuery({
    queryKey: ["courses", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("courses").select("*")
        .eq("user_id", user!.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: landingSlugs = {} } = useQuery<Record<string, string>>({
    queryKey: ["dashboard-landing-slugs", user?.id],
    queryFn: async () => {
      const ids = courses.map((c: any) => c.id);
      if (!ids.length) return {};
      const { data } = await (supabase.from("course_landings") as any)
        .select("course_id, slug").in("course_id", ids);
      const map: Record<string, string> = {};
      (data || []).forEach((r: any) => { if (r.slug) map[r.course_id] = r.slug; });
      return map;
    },
    enabled: courses.length > 0,
  });

  const { data: courseStats = {} } = useQuery({
    queryKey: ["course-stats", user?.id],
    queryFn: async () => {
      const ids = courses.map((c: any) => c.id);
      if (!ids.length) return {};
      const { data: mods } = await supabase.from("course_modules")
        .select("id, course_id").in("course_id", ids);
      const s: Record<string, number> = {};
      ids.forEach((id: string) => { s[id] = 0; });
      mods?.forEach((m: any) => { if (s[m.course_id] !== undefined) s[m.course_id]++; });
      return s;
    },
    enabled: courses.length > 0,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("courses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courses", user?.id] });
      toast.success("Curso excluído.");
      setDeleting(null);
    },
    onError: () => toast.error("Erro ao excluir."),
  });

  const filteredCourses = useMemo(() => {
    let r = [...courses];
    if (statusFilter === "draft")     r = r.filter((c: any) => c.status === "draft");
    if (statusFilter === "published") r = r.filter((c: any) => c.status === "published");
    if (sortBy === "recent") r.sort((a: any, b: any) => +new Date(b.created_at) - +new Date(a.created_at));
    if (sortBy === "oldest") r.sort((a: any, b: any) => +new Date(a.created_at) - +new Date(b.created_at));
    if (sortBy === "title")  r.sort((a: any, b: any) => a.title.localeCompare(b.title, "pt-BR"));
    return r;
  }, [courses, statusFilter, sortBy]);

  const canCreate = isDev || usage < limits.maxCoursesPerMonth;
  const usagePct  = Math.min((usage / limits.maxCoursesPerMonth) * 100, 100);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, ...sans }}>

      {/* ══════════════════════════════ HERO ══════════════════════════════════ */}
      <div style={{ borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "52px 40px 36px" }}>

          {/* Plan chip */}
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 10, fontWeight: 600, letterSpacing: "0.14em",
            textTransform: "uppercase", color: C.accent,
            background: C.accentGlow, border: `1px solid ${C.accentBorder}`,
            borderRadius: 5, padding: "4px 10px", marginBottom: 24,
          }}>
            <Sparkles size={9} /> Plano {plan.toUpperCase()}
          </span>

          {/* Title + CTA row */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32, flexWrap: "wrap" }}>
            <div>
              <h1 style={{
                ...serif,
                fontSize: "clamp(54px, 6vw, 84px)",
                fontWeight: 600, lineHeight: 0.92,
                margin: 0, color: C.text, letterSpacing: "-0.02em",
              }}>
                Seus<br />
                <em style={{ fontStyle: "italic", fontWeight: 300, color: "#A09890" }}>Cursos.</em>
              </h1>
              <p style={{ color: C.textMuted, marginTop: 18, fontSize: 14, maxWidth: 420, lineHeight: 1.6 }}>
                Gerencie, publique e exporte seus cursos criados com IA.
              </p>
            </div>
            <NewCourseBtn disabled={!canCreate} onClick={() => canCreate && navigate("/app/courses/new")} />
          </div>

          {/* Stats row */}
          <div style={{
            display: "flex", alignItems: "center",
            marginTop: 40, paddingTop: 28, borderTop: `1px solid ${C.border}`,
          }}>
            {[
              { val: String(courses.length),                    label: "cursos criados"   },
              { val: `${usage} / ${limits.maxCoursesPerMonth}`, label: "usados este mês"  },
              { val: plan === "pro" ? "Pro" : plan === "starter" ? "Starter" : "Free", label: "plano atual" },
            ].map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "stretch" }}>
                {i > 0 && <div style={{ width: 1, background: C.border, margin: "0 32px" }} />}
                <div>
                  <div style={{ ...serif, fontSize: 34, fontWeight: 600, lineHeight: 1, color: C.text }}>
                    {s.val}
                  </div>
                  <div style={{ fontSize: 10, color: C.textMuted, marginTop: 5, textTransform: "uppercase", letterSpacing: "0.09em" }}>
                    {s.label}
                  </div>
                </div>
              </div>
            ))}

            {/* Usage bar */}
            <div style={{ flex: 1, marginLeft: 40, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ height: 2, background: C.surfaceUp, borderRadius: 2, overflow: "hidden" }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${usagePct}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  style={{ height: "100%", background: C.accent, borderRadius: 2 }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════ BODY ══════════════════════════════════ */}
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "36px 40px 80px" }}>

        {/* Upsell banner */}
        {plan === "free" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            style={{
              background: `linear-gradient(135deg, ${C.accentGlow}, transparent)`,
              border: `1px solid ${C.accentBorder}`,
              borderRadius: 10, padding: "18px 22px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 16, marginBottom: 32,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                {usage} de {limits.maxCoursesPerMonth} cursos gratuitos usados este mês
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>
                No Starter e Pro: mais cursos, exportação PPTX e imagens com IA.
              </div>
            </div>
            <GhostBtn onClick={() => navigate("/app/planos")} color={C.accent}>
              <Sparkles size={11} /> Ver planos
            </GhostBtn>
          </motion.div>
        )}

        {/* Limit reached */}
        {!canCreate && plan === "free" && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{
              background: C.redGlow, border: `1px solid rgba(217,90,90,0.2)`,
              borderRadius: 10, padding: "18px 22px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 16, marginBottom: 32,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Limite atingido</div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>
                Você já criou {limits.maxCoursesPerMonth} cursos gratuitos este mês. Faça upgrade para continuar.
              </div>
            </div>
            <GhostBtn onClick={() => navigate("/app/planos")} color={C.red}>
              Fazer upgrade
            </GhostBtn>
          </motion.div>
        )}

        {/* Section header + filters */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ ...serif, fontSize: 26, fontWeight: 600, color: C.text, margin: 0 }}>
              Meus cursos
            </h2>
            <p style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>
              {courses.length > 0
                ? `${courses.length} curso${courses.length !== 1 ? "s" : ""}`
                : "Nenhum curso ainda"}
            </p>
          </div>

          {courses.length > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              <NativeSelect value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
                <option value="all">Todos</option>
                <option value="draft">Rascunho</option>
                <option value="published">Publicado</option>
              </NativeSelect>
              <NativeSelect value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
                <option value="recent">Mais recente</option>
                <option value="oldest">Mais antigo</option>
                <option value="title">Título A–Z</option>
              </NativeSelect>
            </div>
          )}
        </div>

        {/* Content states */}
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "72px 0", gap: 12 }}>
            <Loader2 size={26} color={C.accent} style={{ animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: 12, color: C.textMuted }}>Carregando cursos…</span>
          </div>

        ) : courses.length === 0 ? (
          <EmptyState navigate={navigate} />

        ) : filteredCourses.length === 0 ? (
          <div style={{ textAlign: "center", padding: "56px 0" }}>
            <p style={{ fontSize: 13, color: C.textMuted }}>Nenhum curso com os filtros selecionados.</p>
            <button onClick={() => { setStatusFilter("all"); setSortBy("recent"); }}
              style={{ ...sans, background: "none", border: "none", color: C.accent, fontSize: 12, cursor: "pointer", marginTop: 8 }}>
              Limpar filtros
            </button>
          </div>

        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <AnimatePresence>
              {filteredCourses.map((course: any, i: number) => {
                const mods        = (courseStats as any)[course.id] ?? 0;
                const isPublished = course.status === "published";
                const accent      = accentFor(course.id);
                const portalSlug  = isPublished ? (landingSlugs as any)[course.id] : null;
                const dateStr     = new Date(course.created_at).toLocaleDateString("pt-BR", {
                  day: "2-digit", month: "short", year: "2-digit",
                });
                return (
                  <motion.div key={course.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ delay: i * 0.025, duration: 0.22 }}
                  >
                    <CourseRow
                      course={course} mods={mods}
                      isPublished={isPublished} accent={accent}
                      portalSlug={portalSlug} dateStr={dateStr}
                      onEdit={() => navigate(`/app/courses/${course.id}`)}
                      onPortal={() => window.open(`/learn/${portalSlug}`, "_blank")}
                      onDelete={() => setDeleting({ id: course.id, title: course.title })}
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Delete dialog */}
      <AlertDialog open={!!deleting} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent style={{ background: C.surfaceUp, border: `1px solid ${C.border}`, color: C.text, ...sans }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: C.text, ...serif, fontSize: 22 }}>Excluir curso?</AlertDialogTitle>
            <AlertDialogDescription style={{ color: C.textMuted }}>
              Esta ação é irreversível. O curso <strong style={{ color: C.text }}>"{deleting?.title}"</strong> e todos os seus materiais serão removidos permanentemente.
              {plan === "free" && (
                <span style={{ display: "block", color: "#E8C24A", fontSize: 12, marginTop: 10 }}>
                  ⚠ Excluir não libera novas criações no limite mensal.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}
              style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, ...sans }}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              style={{ background: C.red, color: "#fff", border: "none", ...sans }}>
              {deleteMutation.isPending
                ? <><Loader2 size={13} style={{ marginRight: 6 }} />Excluindo…</>
                : "Excluir permanentemente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <OnboardingModal open={onboardingOpen} onDismiss={dismissOnboarding} freeCourses={limits.maxCoursesPerMonth} />
    </div>
  );
}

// ═════════════════════════ SUB-COMPONENTS ════════════════════════════════════

function CourseRow({ course, mods, isPublished, accent, portalSlug, dateStr, onEdit, onPortal, onDelete }: {
  course: any; mods: number; isPublished: boolean; accent: string;
  portalSlug: string | null; dateStr: string;
  onEdit: () => void; onPortal: () => void; onDelete: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? C.surfaceHov : C.surface,
        border: `1px solid ${hov ? C.borderHov : C.border}`,
        borderRadius: 10, display: "flex", alignItems: "center",
        overflow: "hidden", transition: "all 0.17s", cursor: "default",
      }}
    >
      <div style={{ width: 3, alignSelf: "stretch", background: accent, flexShrink: 0 }} />

      <div style={{
        width: 52, height: 52, borderRadius: 8, flexShrink: 0,
        background: accent + "18", margin: "0 18px",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 20, fontWeight: 700, color: accent }}>
          {initialsOf(course.title)}
        </span>
      </div>

      <div style={{ flex: 1, minWidth: 0, padding: "14px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {course.title}
          </span>
          <StatusPill published={isPublished} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Dot label={`${mods} módulo${mods !== 1 ? "s" : ""}`} />
          {course.include_quiz       && <Dot label="quizzes" />}
          {course.include_flashcards && <Dot label="flashcards" />}
          <Dot label="certificado" />
          <span style={{ fontSize: 10, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {course.language}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 18px", flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: C.textFaint, marginRight: 6 }}>{dateStr}</span>
        {portalSlug && (
          <IconBtn title="Abrir portal do aluno" onClick={onPortal} hoverColor={C.mint}>
            <GraduationCap size={13} />
          </IconBtn>
        )}
        <IconBtn title="Editar curso" onClick={onEdit} hoverColor={C.accent}>
          <Pencil size={13} />
        </IconBtn>
        <IconBtn title="Excluir" onClick={onDelete} hoverColor={C.red}>
          <Trash2 size={13} />
        </IconBtn>
      </div>
    </div>
  );
}

function StatusPill({ published }: { published: boolean }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
      color: published ? C.mint : C.textFaint,
      background: published ? C.mintGlow : C.surfaceUp,
      border: `1px solid ${published ? C.mintBorder : C.border}`,
      borderRadius: 3, padding: "2px 6px", flexShrink: 0,
    }}>
      {published ? "Publicado" : "Rascunho"}
    </span>
  );
}

function Dot({ label }: { label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.textMuted }}>
      <span style={{ width: 3, height: 3, borderRadius: "50%", background: C.textFaint, display: "inline-block", flexShrink: 0 }} />
      {label}
    </span>
  );
}

function NewCourseBtn({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        fontFamily: "'DM Sans', 'Inter', sans-serif",
        display: "inline-flex", alignItems: "center", gap: 10,
        background: disabled ? C.surfaceUp : hov ? "#F08A48" : C.accent,
        color: disabled ? C.textFaint : "#fff",
        border: "none", borderRadius: 9, padding: "13px 26px",
        fontSize: 14, fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : hov ? "0 10px 36px rgba(223,124,58,0.38)" : "0 6px 24px rgba(223,124,58,0.28)",
        transition: "all 0.18s", whiteSpace: "nowrap",
      }}
    >
      <Plus size={17} /> Criar novo curso
    </button>
  );
}

function GhostBtn({ onClick, color, children }: { onClick: () => void; color: string; children: React.ReactNode }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        fontFamily: "'DM Sans', 'Inter', sans-serif",
        background: hov ? color + "18" : "transparent",
        border: `1px solid ${color}40`, color,
        borderRadius: 6, padding: "7px 14px",
        fontSize: 11, fontWeight: 600, cursor: "pointer",
        transition: "all 0.15s",
        display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
      }}
    >{children}</button>
  );
}

function NativeSelect({ value, onChange, children }: {
  value: string; onChange: React.ChangeEventHandler<HTMLSelectElement>; children: React.ReactNode;
}) {
  return (
    <select value={value} onChange={onChange} style={{
      fontFamily: "'DM Sans', 'Inter', sans-serif",
      background: C.surfaceUp, border: `1px solid ${C.border}`,
      color: C.textMuted, borderRadius: 6,
      padding: "6px 10px", fontSize: 11, cursor: "pointer", outline: "none",
    }}>
      {children}
    </select>
  );
}

function EmptyState({ navigate }: { navigate: (path: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      style={{
        border: `1px dashed ${C.border}`, borderRadius: 14,
        background: C.surface, padding: "64px 40px", textAlign: "center",
      }}
    >
      <div style={{
        width: 68, height: 68, borderRadius: 16, margin: "0 auto 22px",
        background: `linear-gradient(135deg, ${C.accentGlow}, ${C.mintGlow})`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <BrainCircuit size={30} color={C.accent} />
      </div>
      <h3 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 28, fontWeight: 600, color: C.text, margin: "0 0 10px" }}>
        Nenhum curso ainda
      </h3>
      <p style={{ color: C.textMuted, fontSize: 13, maxWidth: 400, margin: "0 auto 28px", lineHeight: 1.65 }}>
        Crie seu primeiro curso com IA em menos de 10 minutos — módulos, quizzes, flashcards e certificados automáticos.
      </p>
      <button
        onClick={() => navigate("/app/courses/new")}
        style={{
          fontFamily: "'DM Sans', 'Inter', sans-serif",
          background: C.accent, color: "#fff", border: "none",
          borderRadius: 8, padding: "12px 26px",
          fontSize: 13, fontWeight: 600, cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 7,
          boxShadow: "0 8px 24px rgba(223,124,58,0.28)", marginBottom: 44,
        }}
      >
        <Plus size={15} /> Criar primeiro curso
      </button>

      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, justifyContent: "center" }}>
          <Lightbulb size={11} color={C.accent} />
          <span style={{ fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Sugestões para começar
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          {SUGGESTIONS.map(s => (
            <SuggestionCard key={s.title} Icon={s.Icon} title={s.title} desc={s.desc}
              onClick={() => navigate("/app/courses/new")} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function SuggestionCard({ Icon, title, desc, onClick }: {
  Icon: React.ElementType; title: string; desc: string; onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        fontFamily: "'DM Sans', 'Inter', sans-serif",
        background: hov ? C.surfaceHov : C.surfaceUp,
        border: `1px solid ${hov ? C.borderHov : C.border}`,
        borderRadius: 9, padding: "14px", textAlign: "left",
        cursor: "pointer", transition: "all 0.16s",
      }}
    >
      <div style={{ width: 30, height: 30, borderRadius: 7, background: C.accentGlow, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
        <Icon size={13} color={C.accent} />
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: C.text, lineHeight: 1.35, marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 10.5, color: C.textMuted, lineHeight: 1.4 }}>{desc}</div>
    </button>
  );
}
