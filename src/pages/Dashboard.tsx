import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription, useMonthlyUsage } from "@/hooks/useSubscription";
import { useDevMode } from "@/hooks/useDevMode";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, BookOpen, Clock, Sparkles, ArrowRight, Loader2, Trash2, Eye, Pencil, GraduationCap, Bot, BarChart3, PenTool } from "lucide-react";
import { motion } from "framer-motion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const THEME_ICONS: Record<string, React.ElementType> = {
  default: BookOpen,
  ia: Bot,
  marketing: BarChart3,
  educacao: GraduationCap,
  escrita: PenTool,
};

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
        .select("*, course_modules(id), course_quiz_questions(id), course_flashcards(id:course_modules!inner(id))")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) {
        // Fallback to simple query if join fails
        const { data: simple, error: simpleError } = await supabase
          .from("courses")
          .select("*")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false });
        if (simpleError) throw simpleError;
        return simple;
      }
      return data;
    },
    enabled: !!user,
  });

  // Separate query for course stats
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
      courseIds.forEach((id: string) => {
        stats[id] = { modules: 0 };
      });
      modules?.forEach((m: any) => {
        if (stats[m.course_id]) stats[m.course_id].modules++;
      });
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

  const handleCreate = () => {
    if (!canCreate) return;
    navigate("/app/courses/new");
  };

  return (
    <div className="p-6 lg:p-10 max-w-6xl mx-auto space-y-8">
      {/* Plan usage contextual banner */}
      {plan === "free" && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-primary/5 border border-primary/15 rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                Você usou <strong>{usage}</strong> de <strong>{limits.maxCourses}</strong> cursos gratuitos este mês
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                No Pro, crie mais cursos, gere PDFs, exporte PPTX e use imagens com IA.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 border-primary/30 text-primary hover:bg-primary/10" onClick={() => navigate("/app/upgrade")}>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Ver plano Pro
          </Button>
        </motion.div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Gerencie seus cursos criados com IA</p>
        </div>
        <Button onClick={handleCreate} disabled={!canCreate} size="lg" className="text-base px-6 h-12 shadow-md hover:shadow-lg transition-shadow">
          <Plus className="h-5 w-5 mr-2" />
          Criar novo curso com IA
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Plano atual</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={plan === "pro" ? "default" : "secondary"}>
                    {plan.toUpperCase()}
                  </Badge>
                  {plan === "free" && (
                    <button className="text-xs text-primary hover:underline" onClick={() => navigate("/app/upgrade")}>
                      Upgrade
                    </button>
                  )}
                </div>
              </div>
              <Sparkles className="h-8 w-8 text-primary/30" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Uso mensal</p>
                <p className="text-2xl font-bold font-display mt-1">
                  {usage}<span className="text-base text-muted-foreground font-normal">/{limits.maxCourses}</span>
                </p>
              </div>
              <Clock className="h-8 w-8 text-primary/30" />
            </div>
            <Progress value={(usage / limits.maxCourses) * 100} className="mt-3 h-1.5" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total de cursos</p>
                <p className="text-2xl font-bold font-display mt-1">{courses.length}</p>
              </div>
              <BookOpen className="h-8 w-8 text-primary/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upsell banner when limit reached */}
      {!canCreate && plan === "free" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-primary/5 border border-primary/20 rounded-xl p-6 flex items-center justify-between"
        >
          <div>
            <h3 className="font-display font-semibold text-lg">Limite atingido</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Você já criou {limits.maxCourses} cursos gratuitos este mês. Faça upgrade para criar mais cursos agora.
            </p>
          </div>
          <Button onClick={() => navigate("/app/upgrade")}>
            Fazer upgrade <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </motion.div>
      )}

      {/* Courses list */}
      <div>
        <h2 className="font-display text-xl font-semibold mb-4">Seus cursos</h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : courses.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <BookOpen className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-display text-xl font-semibold mb-2">Nenhum curso ainda</h3>
              <p className="text-muted-foreground mb-6 max-w-sm">
                Crie seu primeiro curso com inteligência artificial em poucos minutos.
              </p>
              <Button onClick={handleCreate} size="lg">
                <Plus className="h-4 w-4 mr-2" />
                Criar primeiro curso
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {courses.map((course: any, i: number) => {
              const IconComp = getCourseIcon(course.theme);
              const stats = (courseStats as any)[course.id];
              const moduleCount = stats?.modules ?? 0;

              return (
                <motion.div
                  key={course.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Card className="group hover:shadow-md transition-all hover:border-primary/20">
                    <CardHeader className="pb-3">
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <IconComp className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="font-display text-base line-clamp-2 leading-snug">{course.title}</CardTitle>
                          <div className="mt-1.5">
                            <Badge variant={course.status === "published" ? "default" : "outline"} className="text-[10px] px-2 py-0">
                              {course.status === "published" ? "Publicado" : "Rascunho"}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {course.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">{course.description}</p>
                      )}
                      
                      {/* Metadata */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {moduleCount > 0 && <span>{moduleCount} módulos</span>}
                        {course.include_quiz && <span>· quizzes</span>}
                        {course.include_flashcards && <span>· flashcards</span>}
                      </div>

                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
                        <span>{new Date(course.created_at).toLocaleDateString("pt-BR")}</span>
                        <span>{course.language}</span>
                      </div>

                      {/* Quick actions */}
                      <div className="flex items-center gap-1.5 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs flex-1"
                          onClick={() => navigate(`/app/courses/${course.id}`)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          Ver
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs flex-1"
                          onClick={() => navigate(`/app/courses/${course.id}`)}
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1" />
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeletingCourse({ id: course.id, title: course.title })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      <AlertDialog open={!!deletingCourse} onOpenChange={(open) => !open && setDeletingCourse(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir curso?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                Esta ação é irreversível. O curso <strong>"{deletingCourse?.title}"</strong> e todos os seus materiais (módulos, quizzes, flashcards, imagens e certificados) serão removidos permanentemente.
              </span>
              {plan === "free" && (
                <span className="block text-amber-600 dark:text-amber-400 text-sm font-medium">
                  ⚠️ Excluir um curso não libera novas criações no seu limite mensal. O limite conta cursos gerados no mês.
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
