import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription, useMonthlyUsage } from "@/hooks/useSubscription";
import { useDevMode } from "@/hooks/useDevMode";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, BookOpen, Clock, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

export default function Dashboard() {
  const { user } = useAuth();
  const { plan, limits } = useSubscription();
  const { usage } = useMonthlyUsage();
  const { isDev } = useDevMode();
  const navigate = useNavigate();

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

  const canCreate = isDev || usage < limits.maxCourses;

  const handleCreate = () => {
    if (!canCreate) return;
    navigate("/app/courses/new");
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Gerencie seus cursos criados com IA</p>
        </div>
        <Button onClick={handleCreate} disabled={!canCreate} size="lg">
          <Plus className="h-4 w-4 mr-2" />
          Criar novo curso
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
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

      {/* Upsell banner */}
      {!canCreate && plan === "free" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-primary/5 border border-primary/20 rounded-xl p-6 mb-8 flex items-center justify-between"
        >
          <div>
            <h3 className="font-display font-semibold text-lg">Limite atingido</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Você atingiu o limite do plano Free. Faça upgrade para criar mais cursos.
            </p>
          </div>
          <Button onClick={() => navigate("/app/upgrade")}>
            Fazer upgrade <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </motion.div>
      )}

      {/* Courses list */}
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
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Criar primeiro curso
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map((course, i) => (
            <motion.div
              key={course.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/app/courses/${course.id}`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="font-display text-lg line-clamp-2">{course.title}</CardTitle>
                    <Badge variant={course.status === "published" ? "default" : "outline"} className="text-xs shrink-0 ml-2">
                      {course.status === "published" ? "Publicado" : "Rascunho"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {course.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{course.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{course.language}</span>
                    <span>•</span>
                    <span>{new Date(course.created_at).toLocaleDateString("pt-BR")}</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
