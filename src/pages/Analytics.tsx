import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart3, BookOpen, FileText, BrainCircuit, Award,
  TrendingUp, Layers, Download, PieChart, Activity,
  Lock, Loader2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart as RPieChart, Pie, Cell, ResponsiveContainer,
  AreaChart, Area, Tooltip,
} from "recharts";

const COLORS = [
  "hsl(235,65%,52%)", "hsl(160,60%,45%)", "hsl(270,55%,55%)",
  "hsl(38,92%,50%)", "hsl(0,72%,51%)"
];

export default function Analytics() {
  const { user } = useAuth();
  const { plan } = useSubscription();

  // ── Fetch all data in parallel ──
  const { data: courses = [], isLoading: loadingCourses } = useQuery({
    queryKey: ["analytics-courses", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("courses")
        .select("id, title, status, created_at, include_quiz, include_flashcards, include_images")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: true });
      return data ?? [];
    },
    enabled: !!user,
  });

  const courseIds = courses.map((c) => c.id);

  const { data: modules = [] } = useQuery({
    queryKey: ["analytics-modules", courseIds],
    queryFn: async () => {
      const { data } = await supabase
        .from("course_modules")
        .select("id, course_id")
        .in("course_id", courseIds);
      return data ?? [];
    },
    enabled: courseIds.length > 0,
  });

  const moduleIds = modules.map((m) => m.id);

  const { data: quizzes = [] } = useQuery({
    queryKey: ["analytics-quizzes", moduleIds],
    queryFn: async () => {
      if (moduleIds.length === 0) return [];
      const { data } = await supabase
        .from("course_quiz_questions")
        .select("id, module_id")
        .in("module_id", moduleIds);
      return data ?? [];
    },
    enabled: moduleIds.length > 0,
  });

  const { data: flashcards = [] } = useQuery({
    queryKey: ["analytics-flashcards", moduleIds],
    queryFn: async () => {
      if (moduleIds.length === 0) return [];
      const { data } = await supabase
        .from("course_flashcards")
        .select("id, module_id")
        .in("module_id", moduleIds);
      return data ?? [];
    },
    enabled: moduleIds.length > 0,
  });

  const { data: certificates = [] } = useQuery({
    queryKey: ["analytics-certs", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("certificates")
        .select("id, course_id")
        .eq("user_id", user!.id);
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: exportReports = [] } = useQuery({
    queryKey: ["analytics-exports", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("pptx_export_reports")
        .select("id, course_id, quality_score, passed, created_at")
        .eq("user_id", user!.id);
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: usageEvents = [] } = useQuery({
    queryKey: ["analytics-usage", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("usage_events")
        .select("event_type, created_at, metadata")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: true });
      return data ?? [];
    },
    enabled: !!user,
  });

  if (loadingCourses) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Computed metrics ──
  const totalCourses = courses.length;
  const publishedCourses = courses.filter((c) => c.status === "published").length;
  const draftCourses = totalCourses - publishedCourses;
  const totalModules = modules.length;
  const totalQuizzes = quizzes.length;
  const totalFlashcards = flashcards.length;
  const totalCertificates = certificates.length;
  const totalExports = exportReports.length;
  const avgModulesPerCourse = totalCourses > 0 ? (totalModules / totalCourses).toFixed(1) : "0";
  const avgQuality = exportReports.length > 0
    ? (exportReports.reduce((sum, r) => sum + Number(r.quality_score), 0) / exportReports.length).toFixed(0)
    : null;

  // ── Module distribution chart data ──
  const moduleDistribution = courses.map((c) => ({
    name: c.title.length > 20 ? c.title.slice(0, 18) + "…" : c.title,
    modules: modules.filter((m) => m.course_id === c.id).length,
  })).filter((d) => d.modules > 0);

  // ── Monthly activity ──
  const monthlyMap = new Map<string, number>();
  for (const evt of usageEvents) {
    const d = new Date(evt.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + 1);
  }
  // Also count course creations
  for (const c of courses) {
    const d = new Date(c.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!monthlyMap.has(key)) monthlyMap.set(key, 0);
  }
  const monthlyActivity = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, count]) => ({
      month: month.split("-").reverse().join("/"),
      atividades: count,
    }));

  // ── Content mix pie ──
  const contentMix = [
    { name: "Com Quiz", value: courses.filter((c) => c.include_quiz).length },
    { name: "Com Flashcards", value: courses.filter((c) => c.include_flashcards).length },
    { name: "Com Imagens", value: courses.filter((c) => c.include_images).length },
    { name: "Somente texto", value: courses.filter((c) => !c.include_quiz && !c.include_flashcards && !c.include_images).length },
  ].filter((d) => d.value > 0);

  // ── Status pie ──
  const statusData = [
    { name: "Publicados", value: publishedCourses },
    { name: "Rascunhos", value: draftCourses },
  ].filter((d) => d.value > 0);

  // ── Insights ──
  const insights: string[] = [];
  if (totalCourses > 0 && publishedCourses === 0) {
    insights.push("📝 Nenhum curso publicado ainda. Publique seu primeiro curso para gerar certificados!");
  }
  if (totalExports === 0 && totalCourses > 2) {
    insights.push("📦 Você tem vários cursos mas ainda não exportou nenhum PPTX. Experimente exportar!");
  }
  if (avgQuality && Number(avgQuality) < 70) {
    insights.push(`⚠️ A qualidade média dos seus exports PPTX é ${avgQuality}%. Revise os módulos com conteúdo curto.`);
  }
  if (totalCourses > 0) {
    const quizRate = courses.filter((c) => c.include_quiz).length / totalCourses;
    if (quizRate < 0.3) {
      insights.push("🧠 Apenas " + Math.round(quizRate * 100) + "% dos seus cursos têm quiz. Quizzes aumentam a retenção em até 40%.");
    }
  }
  if (moduleDistribution.length > 0) {
    const maxMod = moduleDistribution.reduce((a, b) => a.modules > b.modules ? a : b);
    const minMod = moduleDistribution.reduce((a, b) => a.modules < b.modules ? a : b);
    if (maxMod.modules > minMod.modules * 2 && minMod.modules < 3) {
      insights.push(`📊 O curso "${minMod.name}" tem apenas ${minMod.modules} módulos. Considere expandir o conteúdo.`);
    }
  }

  const isPro = plan === "pro";

  const chartConfig = {
    modules: { label: "Módulos", color: "hsl(235,65%,52%)" },
    atividades: { label: "Atividades", color: "hsl(160,60%,45%)" },
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="bg-gradient-to-br from-primary/8 via-background to-accent/5 border-b border-border">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-8 lg:py-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <Badge variant={isPro ? "default" : "secondary"} className="text-xs font-semibold tracking-wide">
              CREATOR ANALYTICS
            </Badge>
          </div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-foreground tracking-tight">
            Analytics
          </h1>
          <p className="text-muted-foreground mt-2 text-base lg:text-lg max-w-lg">
            Visão completa da sua produção de cursos com IA
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-8 space-y-8">
        {/* ── Metric Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: "Cursos", value: totalCourses, icon: BookOpen, color: "primary" },
            { label: "Publicados", value: publishedCourses, icon: TrendingUp, color: "secondary" },
            { label: "Módulos", value: totalModules, icon: Layers, color: "accent" },
            { label: "Quizzes", value: totalQuizzes, icon: BrainCircuit, color: "primary" },
            { label: "Certificados", value: totalCertificates, icon: Award, color: "secondary" },
            { label: "Exports PPTX", value: totalExports, icon: Download, color: "accent" },
          ].map((m, i) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Card className="hover:border-primary/20 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`h-7 w-7 rounded-lg bg-${m.color}/10 flex items-center justify-center`}>
                      <m.icon className={`h-3.5 w-3.5 text-${m.color}`} />
                    </div>
                  </div>
                  <div className="text-2xl font-display font-bold text-foreground">{m.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{m.label}</div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* ── Quick stats row ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-5">
              <div className="text-sm text-muted-foreground mb-1">Média de módulos/curso</div>
              <div className="text-3xl font-display font-bold text-foreground">{avgModulesPerCourse}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="text-sm text-muted-foreground mb-1">Flashcards criados</div>
              <div className="text-3xl font-display font-bold text-foreground">{totalFlashcards}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="text-sm text-muted-foreground mb-1">Qualidade PPTX média</div>
              <div className="text-3xl font-display font-bold text-foreground">
                {avgQuality ? `${avgQuality}%` : "—"}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Charts Row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Monthly Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-primary" />
                Atividade mensal
              </CardTitle>
            </CardHeader>
            <CardContent>
              {monthlyActivity.length > 0 ? (
                <ChartContainer config={chartConfig} className="h-[220px] w-full">
                  <AreaChart data={monthlyActivity}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" className="text-xs" />
                    <YAxis allowDecimals={false} className="text-xs" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="atividades"
                      stroke="hsl(160,60%,45%)"
                      fill="hsl(160,60%,45%)"
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
                  Sem dados de atividade ainda
                </div>
              )}
            </CardContent>
          </Card>

          {/* Module Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4 text-accent" />
                Módulos por curso
              </CardTitle>
            </CardHeader>
            <CardContent>
              {moduleDistribution.length > 0 ? (
                <ChartContainer config={chartConfig} className="h-[220px] w-full">
                  <BarChart data={moduleDistribution}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" className="text-xs" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} className="text-xs" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="modules" fill="hsl(235,65%,52%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
                  Crie cursos para ver a distribuição
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Pie Charts Row ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Content Mix */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PieChart className="h-4 w-4 text-primary" />
                Mix de conteúdo
              </CardTitle>
            </CardHeader>
            <CardContent>
              {contentMix.length > 0 ? (
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RPieChart>
                      <Pie
                        data={contentMix}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                        labelLine={false}
                      >
                        {contentMix.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </RPieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                  Sem dados
                </div>
              )}
            </CardContent>
          </Card>

          {/* Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-secondary" />
                Status dos cursos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statusData.length > 0 ? (
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RPieChart>
                      <Pie
                        data={statusData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                        labelLine={false}
                      >
                        <Cell fill="hsl(160,60%,45%)" />
                        <Cell fill="hsl(220,10%,46%)" />
                      </Pie>
                      <Tooltip />
                    </RPieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                  Sem cursos
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── AI Insights ── */}
        <Card className={!isPro ? "relative overflow-hidden" : ""}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BrainCircuit className="h-4 w-4 text-primary" />
              Insights inteligentes
              {!isPro && (
                <Badge variant="outline" className="text-[10px] ml-2">
                  <Lock className="h-3 w-3 mr-1" /> PRO
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isPro ? (
              insights.length > 0 ? (
                <ul className="space-y-3">
                  {insights.map((insight, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="text-sm text-foreground bg-muted/50 rounded-lg px-4 py-3 border border-border"
                    >
                      {insight}
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Crie mais cursos para receber insights personalizados sobre sua produção.
                </p>
              )
            ) : (
              <div className="relative">
                <div className="blur-sm pointer-events-none select-none space-y-3">
                  <div className="text-sm bg-muted/50 rounded-lg px-4 py-3 border border-border">
                    📊 Sua taxa de quizzes está abaixo da média. Adicionar quizzes melhora a retenção.
                  </div>
                  <div className="text-sm bg-muted/50 rounded-lg px-4 py-3 border border-border">
                    🧠 O curso "Marketing Digital" tem poucos módulos comparado aos outros.
                  </div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-card/90 backdrop-blur-sm rounded-xl border border-border px-6 py-4 text-center shadow-lg">
                    <Lock className="h-5 w-5 text-primary mx-auto mb-2" />
                    <p className="text-sm font-semibold text-foreground">Disponível no plano Pro</p>
                    <p className="text-xs text-muted-foreground mt-1">Insights gerados por IA sobre seus cursos</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
