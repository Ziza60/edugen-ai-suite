import { useNavigate } from "react-router-dom";
import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription, useMonthlyUsage } from "@/hooks/useSubscription";
import { useDevMode } from "@/hooks/useDevMode";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, BookOpen, Clock, Sparkles, ArrowRight, Loader2, Trash2,
  Eye, Pencil, GraduationCap, Bot, BarChart3, PenTool,
  Zap, TrendingUp, FileText, BrainCircuit, Award,
  Share2, Download, Filter, ArrowUpDown, Lightbulb
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { OnboardingModal, useOnboarding } from "@/components/OnboardingModal";

// ── Hash-based color for thumbnail ──
const THUMB_COLORS = [
  "from-rose-500 to-pink-600",
  "from-violet-500 to-purple-600",
  "from-blue-500 to-indigo-600",
  "from-cyan-500 to-teal-600",
  "from-emerald-500 to-green-600",
  "from-amber-500 to-orange-600",
  "from-red-500 to-rose-600",
  "from-fuchsia-500 to-pink-600",
  "from-sky-500 to-blue-600",
  "from-lime-500 to-emerald-600",
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function getThumbColor(id: string): string {
  return THUMB_COLORS[hashString(id) % THUMB_COLORS.length];
}

function getInitials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// ── Empty state suggestions ──
const SUGGESTIONS = [
  { icon: BarChart3, title: "Estratégias de Social Media", desc: "Marketing digital para iniciantes", theme: "marketing" },
  { icon: Bot, title: "Introdução à Inteligência Artificial", desc: "Conceitos fundamentais de IA e ML", theme: "tecnologia" },
  { icon: GraduationCap, title: "Metodologias de Ensino Online", desc: "Técnicas para educação a distância", theme: "educação" },
];

export default function Dashboard() {
  const { user } = useAuth();
  const { plan, limits } = useSubscription();
  const { usage } = useMonthlyUsage();
  const { isDev } = useDevMode();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deletingCourse, setDeletingCourse] = useState<{ id: string; title: string } | null>(null);
  const { open: onboardingOpen, dismiss: dismissOnboarding } = useOnboarding();

  // Filters & sorting
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "published">("all");
  const [langFilter, setLangFilter] = useState<"all" | string>("all");
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "title">("recent");

  const { data: courses = [], isLoading } = useQuery({
    queryKey: ["courses", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: courseStats = {} } = useQuery({
    queryKey: ["course-stats", user?.id],
    queryFn: async () => {
      const courseIds = courses.map((c: any) => c.id);
      if (courseIds.length === 0) return {};
      const { data: modules } = await supabase
        .from("course_modules")
        .select("id, course_id")
        .in("course_id", courseIds);
      const stats: Record<string, { modules: number }> = {};
      courseIds.forEach((id: string) => { stats[id] = { modules: 0 }; });
      modules?.forEach((m: any) => { if (stats[m.course_id]) stats[m.course_id].modules++; });
      return stats;
    },
    enabled: courses.length > 0,
  });

  const deleteMutation = useMutation({
    mutationFn: async (courseId: string) => {
      const { error } = await supabase.from("courses").delete().eq("id", courseId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courses", user?.id] });
      toast.success("Curso excluído com sucesso.");
      setDeletingCourse(null);
    },
    onError: () => {
      toast.error("Erro ao excluir o curso. Tente novamente.");
    },
  });

  // ── Filtered & sorted courses ──
  const filteredCourses = useMemo(() => {
    let result = [...courses];

    // Status filter
    if (statusFilter === "draft") result = result.filter((c: any) => c.status === "draft");
    if (statusFilter === "published") result = result.filter((c: any) => c.status === "published");

    // Language filter
    if (langFilter !== "all") result = result.filter((c: any) => c.language === langFilter);

    // Sort
    if (sortBy === "recent") result.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (sortBy === "oldest") result.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    if (sortBy === "title") result.sort((a: any, b: any) => a.title.localeCompare(b.title, "pt-BR"));

    return result;
  }, [courses, statusFilter, langFilter, sortBy]);

  const availableLanguages = useMemo(() => {
    const langs = new Set(courses.map((c: any) => c.language));
    return Array.from(langs);
  }, [courses]);

  const canCreate = isDev || usage < limits.maxCourses;
  const usagePercent = Math.min((usage / limits.maxCourses) * 100, 100);

  return (
    <div className="min-h-screen">
      {/* ═══════════════════ HERO HEADER ═══════════════════ */}
      <div className="bg-gradient-to-br from-primary/8 via-background to-accent/5 border-b border-border">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-8 lg:py-10">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <Badge variant={plan === "pro" ? "default" : "secondary"} className="text-xs font-semibold tracking-wide">
                  PLANO {plan.toUpperCase()}
                </Badge>
              </div>
              <h1 className="font-display text-3xl lg:text-4xl font-bold text-foreground tracking-tight">
                Dashboard
              </h1>
              <p className="text-muted-foreground mt-2 text-base lg:text-lg max-w-lg">
                Gerencie, publique e exporte seus cursos criados com IA
              </p>
            </div>

            <Button
              onClick={() => canCreate && navigate("/app/courses/new")}
              disabled={!canCreate}
              size="lg"
              className="h-12 px-7 text-base font-semibold shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all"
            >
              <Plus className="h-5 w-5 mr-2" />
              Criar novo curso com IA
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-8 space-y-8">
        {/* ═══════════════════ METRICS ROW ═══════════════════ */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {/* Card 1 — Plan */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0 }}
            className="group relative bg-card rounded-2xl border border-border p-6 hover:border-primary/20 transition-colors overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-[4rem] -mr-2 -mt-2" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Plano atual</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-display font-bold text-foreground">
                  {plan === "pro" ? "PRO" : "FREE"}
                </span>
                {plan === "free" && (
                  <button
                    onClick={() => navigate("/app/planos")}
                    className="text-xs font-semibold text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
                  >
                    Upgrade <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>

          {/* Card 2 — Monthly usage */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="group relative bg-card rounded-2xl border border-border p-6 hover:border-primary/20 transition-colors overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-secondary/5 rounded-bl-[4rem] -mr-2 -mt-2" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-lg bg-secondary/10 flex items-center justify-center">
                  <Clock className="h-4 w-4 text-secondary" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Uso mensal</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-display font-bold text-foreground">{usage}</span>
                <span className="text-base text-muted-foreground font-medium">/ {limits.maxCourses} cursos</span>
              </div>
              <Progress value={usagePercent} className="mt-3 h-2" />
            </div>
          </motion.div>

          {/* Card 3 — Total courses */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16 }}
            className="group relative bg-card rounded-2xl border border-border p-6 hover:border-primary/20 transition-colors overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-accent/5 rounded-bl-[4rem] -mr-2 -mt-2" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center">
                  <BookOpen className="h-4 w-4 text-accent" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Cursos criados</span>
              </div>
              <span className="text-2xl font-display font-bold text-foreground">{courses.length}</span>
            </div>
          </motion.div>
        </div>

        {/* ═══════════════════ UPSELL BANNER ═══════════════════ */}
        {plan === "free" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="relative bg-gradient-to-r from-primary/6 via-primary/4 to-accent/6 border border-primary/15 rounded-2xl px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 overflow-hidden"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,hsl(var(--primary)/0.06),transparent_50%)]" />
            <div className="relative flex items-start gap-4">
              <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Você usou <strong>{usage}</strong> de <strong>{limits.maxCourses}</strong> cursos gratuitos este mês
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  No Pro, crie mais cursos, gere PDFs, exporte PPTX e use imagens com IA.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="relative shrink-0 border-primary/30 text-primary hover:bg-primary/10 font-semibold"
              onClick={() => navigate("/app/planos")}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Ver plano Pro
            </Button>
          </motion.div>
        )}

        {/* ═══════════════════ LIMIT REACHED ═══════════════════ */}
        {!canCreate && plan === "free" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-destructive/5 border border-destructive/20 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4"
          >
            <div>
              <h3 className="font-display font-bold text-lg text-foreground">Limite atingido</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Você já criou {limits.maxCourses} cursos gratuitos este mês. Faça upgrade para continuar criando.
              </p>
            </div>
            <Button onClick={() => navigate("/app/planos")} className="shrink-0">
              Fazer upgrade <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </motion.div>
        )}

        {/* ═══════════════════ COURSES SECTION ═══════════════════ */}
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div>
              <h2 className="font-display text-xl lg:text-2xl font-bold text-foreground">Meus cursos</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {courses.length > 0
                  ? `${courses.length} curso${courses.length !== 1 ? "s" : ""} criado${courses.length !== 1 ? "s" : ""}`
                  : "Nenhum curso criado ainda"}
              </p>
            </div>

            {/* ── Filters & Sort ── */}
            {courses.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                  <SelectTrigger className="h-9 w-[130px] text-xs">
                    <Filter className="h-3 w-3 mr-1.5 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="draft">Rascunho</SelectItem>
                    <SelectItem value="published">Publicado</SelectItem>
                  </SelectContent>
                </Select>

                {availableLanguages.length > 1 && (
                  <Select value={langFilter} onValueChange={setLangFilter}>
                    <SelectTrigger className="h-9 w-[120px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Idiomas</SelectItem>
                      {availableLanguages.map((lang) => (
                        <SelectItem key={lang} value={lang}>
                          {lang === "pt-BR" ? "Português" : lang === "en" ? "English" : lang === "es" ? "Español" : lang}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
                  <SelectTrigger className="h-9 w-[140px] text-xs">
                    <ArrowUpDown className="h-3 w-3 mr-1.5 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">Mais recente</SelectItem>
                    <SelectItem value="oldest">Mais antigo</SelectItem>
                    <SelectItem value="title">Título A–Z</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Carregando cursos…</span>
            </div>
          ) : courses.length === 0 ? (
            /* ── Empty State with contextual suggestions ── */
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="border-2 border-dashed border-border rounded-2xl bg-card/50"
            >
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center mb-6">
                  <BrainCircuit className="h-10 w-10 text-primary" />
                </div>
                <h3 className="font-display text-2xl font-bold text-foreground mb-2">
                  Você ainda não criou nenhum curso
                </h3>
                <p className="text-muted-foreground mb-8 max-w-md text-base">
                  Crie seu primeiro curso com IA em menos de 10 minutos. Módulos, quizzes, flashcards e certificados — tudo automático.
                </p>
                <Button onClick={() => navigate("/app/courses/new")} size="lg" className="h-12 px-8 text-base font-semibold shadow-lg shadow-primary/20 mb-10">
                  <Plus className="h-5 w-5 mr-2" />
                  Criar primeiro curso
                </Button>

                {/* ── Contextual suggestions ── */}
                <div className="w-full max-w-2xl">
                  <div className="flex items-center gap-2 mb-4">
                    <Lightbulb className="h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold text-foreground">Sugestões para começar</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s.title}
                        onClick={() => navigate("/app/courses/new")}
                        className="group/sug text-left bg-muted/40 hover:bg-primary/5 border border-border/60 hover:border-primary/25 rounded-xl p-4 transition-all"
                      >
                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                          <s.icon className="h-4 w-4 text-primary" />
                        </div>
                        <p className="text-sm font-semibold text-foreground leading-snug mb-1">{s.title}</p>
                        <p className="text-xs text-muted-foreground">{s.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : filteredCourses.length === 0 ? (
            /* ── No results for current filter ── */
            <div className="text-center py-16">
              <Filter className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nenhum curso encontrado com os filtros selecionados.</p>
              <Button variant="link" size="sm" onClick={() => { setStatusFilter("all"); setLangFilter("all"); }} className="mt-2">
                Limpar filtros
              </Button>
            </div>
          ) : (
            /* ── Course Grid ── */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              <AnimatePresence>
                {filteredCourses.map((course: any, i: number) => {
                  const stats = (courseStats as any)[course.id];
                  const moduleCount = stats?.modules ?? 0;
                  const isPublished = course.status === "published";
                  const initials = getInitials(course.title);
                  const thumbGradient = getThumbColor(course.id);

                  return (
                    <motion.div
                      key={course.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: i * 0.04, duration: 0.3 }}
                    >
                      <div className="group relative bg-card rounded-2xl border border-border hover:border-primary/25 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 overflow-hidden">
                        {/* ── Thumbnail header ── */}
                        <div className={`h-24 bg-gradient-to-br ${thumbGradient} relative overflow-hidden`}>
                          <div className="absolute inset-0 bg-black/10" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-3xl font-display font-bold text-white/90 tracking-wider select-none">
                              {initials}
                            </span>
                          </div>
                          {/* Status badge on thumbnail */}
                          <div className="absolute top-3 right-3">
                            <Badge
                              variant={isPublished ? "default" : "outline"}
                              className={`text-[10px] font-semibold px-2 py-0.5 backdrop-blur-sm ${
                                isPublished
                                  ? "bg-white/20 text-white border-white/30 hover:bg-white/30"
                                  : "bg-black/20 text-white border-white/20 hover:bg-black/30"
                              }`}
                            >
                              {isPublished ? "✓ Publicado" : "Rascunho"}
                            </Badge>
                          </div>
                        </div>

                        <div className="p-5 space-y-3">
                          {/* Title */}
                          <h3 className="font-display font-semibold text-[15px] leading-snug text-foreground line-clamp-2">
                            {course.title}
                          </h3>

                          {/* Status + progress line */}
                          <p className="text-xs text-muted-foreground">
                            {isPublished
                              ? `Publicado — ${moduleCount} módulo${moduleCount !== 1 ? "s" : ""}`
                              : `Rascunho — ${moduleCount} módulo${moduleCount !== 1 ? "s" : ""}`}
                          </p>

                          {/* Metadata chips */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {course.include_quiz && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/60 rounded-md px-2 py-0.5">
                                <BookOpen className="h-3 w-3" /> quizzes
                              </span>
                            )}
                            {course.include_flashcards && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/60 rounded-md px-2 py-0.5">
                                <BrainCircuit className="h-3 w-3" /> flashcards
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/60 rounded-md px-2 py-0.5">
                              <Award className="h-3 w-3" /> certificado
                            </span>
                            <span className="inline-flex items-center text-[11px] text-muted-foreground bg-muted/60 rounded-md px-2 py-0.5 uppercase tracking-wider font-medium">
                              {course.language}
                            </span>
                          </div>

                          {/* Date */}
                          <div className="text-[11px] text-muted-foreground pt-1 border-t border-border/60">
                            Criado em {new Date(course.created_at).toLocaleDateString("pt-BR")}
                          </div>

                          {/* Quick actions */}
                          <div className="flex items-center gap-2 pt-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs flex-1 font-medium"
                              onClick={() => navigate(`/app/courses/${course.id}`)}
                            >
                              <Pencil className="h-3.5 w-3.5 mr-1" />
                              Editar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs flex-1 font-medium"
                              onClick={() => navigate(`/app/courses/${course.id}`)}
                            >
                              <Download className="h-3.5 w-3.5 mr-1" />
                              Exportar
                            </Button>
                            {isPublished && course.tutor_slug && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => {
                                  navigator.clipboard.writeText(`${window.location.origin}/tutor/${course.tutor_slug}`);
                                  toast.success("Link copiado!");
                                }}
                              >
                                <Share2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive border-destructive/20 hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setDeletingCourse({ id: course.id, title: course.title })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════ DELETE DIALOG ═══════════════════ */}
      <AlertDialog open={!!deletingCourse} onOpenChange={(open) => !open && setDeletingCourse(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Excluir curso?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                Esta ação é irreversível. O curso <strong>"{deletingCourse?.title}"</strong> e todos os seus materiais serão removidos permanentemente.
              </span>
              {plan === "free" && (
                <span className="block text-warning text-sm font-medium">
                  ⚠️ Excluir um curso não libera novas criações no seu limite mensal.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deletingCourse && deleteMutation.mutate(deletingCourse.id)}
            >
              {deleteMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Excluindo...</>
              ) : (
                "Excluir permanentemente"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
