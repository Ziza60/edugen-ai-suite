import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription, useMonthlyUsage } from "@/hooks/useSubscription";
import { useDevMode } from "@/hooks/useDevMode";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Plus, BookOpen, Clock, Sparkles, ArrowRight, Loader2, Trash2,
  Eye, Pencil, GraduationCap, Bot, BarChart3, PenTool,
  Zap, TrendingUp, FileText, BrainCircuit, Award
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

function getCourseIcon(theme?: string | null): React.ElementType {
  if (!theme) return BookOpen;
  const lower = theme.toLowerCase();
  if (lower.includes("ia") || lower.includes("inteligência") || lower.includes("machine")) return Bot;
  if (lower.includes("marketing") || lower.includes("negócio") || lower.includes("vendas") || lower.includes("dados")) return BarChart3;
  if (lower.includes("educação") || lower.includes("didática") || lower.includes("pedagog") || lower.includes("ensino")) return GraduationCap;
  if (lower.includes("escrita") || lower.includes("redação") || lower.includes("texto") || lower.includes("conteúdo")) return PenTool;
  return BookOpen;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { plan, limits } = useSubscription();
  const { usage } = useMonthlyUsage();
  const { isDev } = useDevMode();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deletingCourse, setDeletingCourse] = useState<{ id: string; title: string } | null>(null);

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
                    onClick={() => navigate("/app/upgrade")}
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
              onClick={() => navigate("/app/upgrade")}
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
            <Button onClick={() => navigate("/app/upgrade")} className="shrink-0">
              Fazer upgrade <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </motion.div>
        )}

        {/* ═══════════════════ COURSES SECTION ═══════════════════ */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-display text-xl lg:text-2xl font-bold text-foreground">Meus cursos</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {courses.length > 0
                  ? `${courses.length} curso${courses.length !== 1 ? "s" : ""} criado${courses.length !== 1 ? "s" : ""}`
                  : "Nenhum curso criado ainda"}
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Carregando cursos…</span>
            </div>
          ) : courses.length === 0 ? (
            /* ── Empty State ── */
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="border-2 border-dashed border-border rounded-2xl bg-card/50"
            >
              <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center mb-6">
                  <BrainCircuit className="h-10 w-10 text-primary" />
                </div>
                <h3 className="font-display text-2xl font-bold text-foreground mb-2">
                  Você ainda não criou nenhum curso
                </h3>
                <p className="text-muted-foreground mb-8 max-w-md text-base">
                  Crie seu primeiro curso com IA em menos de 10 minutos. Módulos, quizzes, flashcards e certificados — tudo automático.
                </p>
                <Button onClick={() => navigate("/app/courses/new")} size="lg" className="h-12 px-8 text-base font-semibold shadow-lg shadow-primary/20">
                  <Plus className="h-5 w-5 mr-2" />
                  Criar primeiro curso
                </Button>
              </div>
            </motion.div>
          ) : (
            /* ── Course Grid ── */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              <AnimatePresence>
                {courses.map((course: any, i: number) => {
                  const IconComp = getCourseIcon(course.theme);
                  const stats = (courseStats as any)[course.id];
                  const moduleCount = stats?.modules ?? 0;
                  const isPublished = course.status === "published";

                  return (
                    <motion.div
                      key={course.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: i * 0.04, duration: 0.3 }}
                    >
                      <div className="group relative bg-card rounded-2xl border border-border hover:border-primary/25 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 overflow-hidden">
                        {/* Top accent bar */}
                        <div className={`h-1 w-full ${isPublished ? "bg-secondary" : "bg-muted-foreground/20"}`} />

                        <div className="p-5 space-y-4">
                          {/* Row 1 — Icon + Title + Status */}
                          <div className="flex items-start gap-3">
                            <div className="h-11 w-11 rounded-xl bg-primary/8 flex items-center justify-center shrink-0 mt-0.5">
                              <IconComp className="h-5 w-5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-display font-semibold text-[15px] leading-snug text-foreground line-clamp-2">
                                {course.title}
                              </h3>
                              <div className="mt-1.5">
                                <Badge
                                  variant={isPublished ? "default" : "outline"}
                                  className={`text-[10px] font-semibold px-2 py-0.5 ${
                                    isPublished
                                      ? "bg-secondary/15 text-secondary border-secondary/30 hover:bg-secondary/20"
                                      : ""
                                  }`}
                                >
                                  {isPublished ? "✓ Publicado" : "Rascunho"}
                                </Badge>
                              </div>
                            </div>
                          </div>

                          {/* Row 2 — Description */}
                          {course.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                              {course.description}
                            </p>
                          )}

                          {/* Row 3 — Metadata chips */}
                          <div className="flex flex-wrap items-center gap-2">
                            {moduleCount > 0 && (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/60 rounded-md px-2 py-1">
                                <FileText className="h-3 w-3" /> {moduleCount} módulos
                              </span>
                            )}
                            {course.include_quiz && (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/60 rounded-md px-2 py-1">
                                <BookOpen className="h-3 w-3" /> quizzes
                              </span>
                            )}
                            {course.include_flashcards && (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/60 rounded-md px-2 py-1">
                                <BrainCircuit className="h-3 w-3" /> flashcards
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/60 rounded-md px-2 py-1">
                              <Award className="h-3 w-3" /> certificado
                            </span>
                          </div>

                          {/* Row 4 — Date + Language */}
                          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/60">
                            <span>Criado em: {new Date(course.created_at).toLocaleDateString("pt-BR")}</span>
                            <span className="uppercase tracking-wider font-medium">{course.language}</span>
                          </div>

                          {/* Row 5 — Actions (always visible) */}
                          <div className="flex items-center gap-2 pt-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs flex-1 font-medium"
                              onClick={() => navigate(`/app/courses/${course.id}`)}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              Visualizar
                            </Button>
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
