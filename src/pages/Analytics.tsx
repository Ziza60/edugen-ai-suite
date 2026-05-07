import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart3, BookOpen, BrainCircuit, Award,
  Layers, Download, Activity, Lock, Loader2, TrendingUp, PieChart,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart as RPieChart, Pie, Cell, ResponsiveContainer,
  AreaChart, Area, Tooltip,
} from "recharts";

const ACCENT = "#DF7C3A";
const GOLD = "#C9A96E";
const SAGE = "#7B9E87";
const LAVENDER = "#A08EC2";

const CHART_COLORS = [ACCENT, SAGE, LAVENDER, GOLD, "#E06C75"];

export default function Analytics() {
  const { user } = useAuth();
  const { plan } = useSubscription();

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
      const { data } = await supabase.from("course_modules").select("id, course_id").in("course_id", courseIds);
      return data ?? [];
    },
    enabled: courseIds.length > 0,
  });

  const moduleIds = modules.map((m) => m.id);

  const { data: quizzes = [] } = useQuery({
    queryKey: ["analytics-quizzes", moduleIds],
    queryFn: async () => {
      if (moduleIds.length === 0) return [];
      const { data } = await supabase.from("course_quiz_questions").select("id, module_id").in("module_id", moduleIds);
      return data ?? [];
    },
    enabled: moduleIds.length > 0,
  });

  const { data: flashcards = [] } = useQuery({
    queryKey: ["analytics-flashcards", moduleIds],
    queryFn: async () => {
      if (moduleIds.length === 0) return [];
      const { data } = await supabase.from("course_flashcards").select("id, module_id").in("module_id", moduleIds);
      return data ?? [];
    },
    enabled: moduleIds.length > 0,
  });

  const { data: certificates = [] } = useQuery({
    queryKey: ["analytics-certs", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("certificates").select("id, course_id").eq("user_id", user!.id);
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: exportReports = [] } = useQuery({
    queryKey: ["analytics-exports", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("pptx_export_reports").select("id, course_id, quality_score, passed, created_at").eq("user_id", user!.id);
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: usageEvents = [] } = useQuery({
    queryKey: ["analytics-usage", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("usage_events").select("event_type, created_at, metadata").eq("user_id", user!.id).order("created_at", { ascending: true });
      return data ?? [];
    },
    enabled: !!user,
  });

  if (loadingCourses) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: ACCENT }} />
      </div>
    );
  }

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

  const moduleDistribution = courses.map((c) => ({
    name: c.title.length > 20 ? c.title.slice(0, 18) + "…" : c.title,
    módulos: modules.filter((m) => m.course_id === c.id).length,
  })).filter((d) => d.módulos > 0);

  const monthlyMap = new Map<string, number>();
  for (const evt of usageEvents) {
    const d = new Date(evt.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + 1);
  }
  for (const c of courses) {
    const d = new Date(c.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!monthlyMap.has(key)) monthlyMap.set(key, 0);
  }
  const monthlyActivity = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, count]) => ({ month: month.split("-").reverse().join("/"), atividades: count }));

  const contentMix = [
    { name: "Com Quiz", value: courses.filter((c) => c.include_quiz).length },
    { name: "Com Flashcards", value: courses.filter((c) => c.include_flashcards).length },
    { name: "Com Imagens", value: courses.filter((c) => c.include_images).length },
    { name: "Somente texto", value: courses.filter((c) => !c.include_quiz && !c.include_flashcards && !c.include_images).length },
  ].filter((d) => d.value > 0);

  const statusData = [
    { name: "Publicados", value: publishedCourses },
    { name: "Rascunhos", value: draftCourses },
  ].filter((d) => d.value > 0);

  const insights: string[] = [];
  if (totalCourses > 0 && publishedCourses === 0) insights.push("Nenhum curso publicado ainda. Publique seu primeiro curso para gerar certificados.");
  if (totalExports === 0 && totalCourses > 2) insights.push("Você tem vários cursos mas ainda não exportou nenhum PPTX. Experimente exportar!");
  if (avgQuality && Number(avgQuality) < 70) insights.push(`A qualidade média dos seus exports PPTX é ${avgQuality}%. Revise os módulos com conteúdo curto.`);
  if (totalCourses > 0) {
    const quizRate = courses.filter((c) => c.include_quiz).length / totalCourses;
    if (quizRate < 0.3) insights.push(`Apenas ${Math.round(quizRate * 100)}% dos seus cursos têm quiz. Quizzes aumentam a retenção em até 40%.`);
  }
  if (moduleDistribution.length > 0) {
    const minMod = moduleDistribution.reduce((a, b) => a.módulos < b.módulos ? a : b);
    const maxMod = moduleDistribution.reduce((a, b) => a.módulos > b.módulos ? a : b);
    if (maxMod.módulos > minMod.módulos * 2 && minMod.módulos < 3) insights.push(`O curso "${minMod.name}" tem apenas ${minMod.módulos} módulos. Considere expandir o conteúdo.`);
  }

  const isPro = plan === "pro";
  const chartConfig = {
    módulos: { label: "Módulos", color: ACCENT },
    atividades: { label: "Atividades", color: SAGE },
  };

  const metricCards = [
    { label: "Cursos", value: totalCourses, icon: BookOpen, color: ACCENT },
    { label: "Publicados", value: publishedCourses, icon: TrendingUp, color: SAGE },
    { label: "Módulos", value: totalModules, icon: Layers, color: GOLD },
    { label: "Quizzes", value: totalQuizzes, icon: BrainCircuit, color: LAVENDER },
    { label: "Certificados", value: totalCertificates, icon: Award, color: ACCENT },
    { label: "Exports PPTX", value: totalExports, icon: Download, color: SAGE },
  ];

  const card = {
    background: "rgba(232,227,220,0.03)",
    border: "1px solid rgba(232,227,220,0.07)",
    borderRadius: "12px",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0B0B0F", color: "#E8E3DC" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(232,227,220,0.06)", padding: "2.5rem 0" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 2rem" }}>
          <p style={{ fontSize: "0.6875rem", letterSpacing: "0.2em", textTransform: "uppercase", color: GOLD, marginBottom: "0.75rem", fontWeight: 500 }}>Painel do criador</p>
          <h1 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "clamp(2rem, 4vw, 2.75rem)", fontWeight: 600, letterSpacing: "-0.02em", color: "#E8E3DC", lineHeight: 1.1, marginBottom: "0.5rem" }}>
            Análises
          </h1>
          <p style={{ color: "rgba(232,227,220,0.4)", fontSize: "0.9375rem", fontWeight: 300 }}>
            Visão completa da sua produção de cursos com IA
          </p>
        </div>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "2.5rem 2rem", display: "flex", flexDirection: "column", gap: "2rem" }}>

        {/* Métricas */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "1px", background: "rgba(232,227,220,0.06)", borderRadius: "12px", overflow: "hidden" }}>
          {metricCards.map((m, i) => (
            <motion.div key={m.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              style={{ background: "#0B0B0F", padding: "1.5rem", cursor: "default", transition: "background 0.2s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(232,227,220,0.025)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#0B0B0F")}
            >
              <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: `${m.color}15`, border: `1px solid ${m.color}25`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1rem" }}>
                <m.icon className="h-4 w-4" style={{ color: m.color }} />
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "2rem", fontWeight: 700, color: "#E8E3DC", lineHeight: 1 }}>{m.value}</div>
              <div style={{ fontSize: "0.75rem", color: "rgba(232,227,220,0.4)", marginTop: "0.25rem" }}>{m.label}</div>
            </motion.div>
          ))}
        </div>

        {/* Estatísticas rápidas */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }} className="sm:grid-cols-3 grid-cols-1">
          {[
            { label: "Média de módulos por curso", value: avgModulesPerCourse },
            { label: "Flashcards criados", value: totalFlashcards },
            { label: "Qualidade PPTX média", value: avgQuality ? `${avgQuality}%` : "—" },
          ].map((s) => (
            <div key={s.label} style={{ ...card, padding: "1.5rem" }}>
              <div style={{ fontSize: "0.75rem", color: "rgba(232,227,220,0.4)", marginBottom: "0.5rem" }}>{s.label}</div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "2.25rem", fontWeight: 700, color: "#E8E3DC" }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Gráficos de área e barras */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }} className="lg:grid-cols-2 grid-cols-1">
          <div style={{ ...card, padding: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "1.25rem" }}>
              <Activity className="h-4 w-4" style={{ color: SAGE }} />
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.0625rem", fontWeight: 600, color: "#E8E3DC" }}>Atividade mensal</span>
            </div>
            {monthlyActivity.length > 0 ? (
              <ChartContainer config={chartConfig} className="h-[200px] w-full">
                <AreaChart data={monthlyActivity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(232,227,220,0.06)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "rgba(232,227,220,0.35)" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "rgba(232,227,220,0.35)" }} axisLine={false} tickLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="atividades" stroke={SAGE} fill={SAGE} fillOpacity={0.12} strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            ) : (
              <div style={{ height: "200px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.875rem", color: "rgba(232,227,220,0.3)" }}>Sem dados de atividade ainda</div>
            )}
          </div>

          <div style={{ ...card, padding: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "1.25rem" }}>
              <Layers className="h-4 w-4" style={{ color: GOLD }} />
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.0625rem", fontWeight: 600, color: "#E8E3DC" }}>Módulos por curso</span>
            </div>
            {moduleDistribution.length > 0 ? (
              <ChartContainer config={chartConfig} className="h-[200px] w-full">
                <BarChart data={moduleDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(232,227,220,0.06)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "rgba(232,227,220,0.35)" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "rgba(232,227,220,0.35)" }} axisLine={false} tickLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="módulos" fill={ACCENT} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <div style={{ height: "200px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.875rem", color: "rgba(232,227,220,0.3)" }}>Crie cursos para ver a distribuição</div>
            )}
          </div>
        </div>

        {/* Gráficos de pizza */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }} className="sm:grid-cols-2 grid-cols-1">
          <div style={{ ...card, padding: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "1.25rem" }}>
              <PieChart className="h-4 w-4" style={{ color: LAVENDER }} />
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.0625rem", fontWeight: 600, color: "#E8E3DC" }}>Mix de conteúdo</span>
            </div>
            {contentMix.length > 0 ? (
              <div style={{ height: "200px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RPieChart>
                    <Pie data={contentMix} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                      {contentMix.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#16161C", border: "1px solid rgba(232,227,220,0.1)", color: "#E8E3DC", borderRadius: "8px", fontSize: "0.8125rem" }} />
                  </RPieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ height: "200px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.875rem", color: "rgba(232,227,220,0.3)" }}>Sem dados</div>
            )}
          </div>

          <div style={{ ...card, padding: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "1.25rem" }}>
              <BarChart3 className="h-4 w-4" style={{ color: ACCENT }} />
              <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.0625rem", fontWeight: 600, color: "#E8E3DC" }}>Status dos cursos</span>
            </div>
            {statusData.length > 0 ? (
              <div style={{ height: "200px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RPieChart>
                    <Pie data={statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                      <Cell fill={SAGE} />
                      <Cell fill="rgba(232,227,220,0.2)" />
                    </Pie>
                    <Tooltip contentStyle={{ background: "#16161C", border: "1px solid rgba(232,227,220,0.1)", color: "#E8E3DC", borderRadius: "8px", fontSize: "0.8125rem" }} />
                  </RPieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ height: "200px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.875rem", color: "rgba(232,227,220,0.3)" }}>Sem cursos</div>
            )}
          </div>
        </div>

        {/* Insights inteligentes */}
        <div style={{ ...card, padding: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "1.25rem" }}>
            <BrainCircuit className="h-4 w-4" style={{ color: ACCENT }} />
            <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.0625rem", fontWeight: 600, color: "#E8E3DC" }}>Insights inteligentes</span>
            {!isPro && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "rgba(201,169,110,0.1)", border: "1px solid rgba(201,169,110,0.2)", color: GOLD, fontSize: "0.625rem", fontWeight: 600, padding: "2px 8px", borderRadius: "100px", letterSpacing: "0.1em", textTransform: "uppercase", marginLeft: "auto" }}>
                <Lock className="h-2.5 w-2.5" /> PRO
              </span>
            )}
          </div>

          {isPro ? (
            insights.length > 0 ? (
              <ul style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {insights.map((insight, i) => (
                  <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
                    style={{ fontSize: "0.875rem", color: "rgba(232,227,220,0.65)", background: "rgba(232,227,220,0.03)", border: "1px solid rgba(232,227,220,0.07)", borderRadius: "8px", padding: "0.875rem 1rem", lineHeight: 1.6 }}>
                    {insight}
                  </motion.li>
                ))}
              </ul>
            ) : (
              <p style={{ fontSize: "0.875rem", color: "rgba(232,227,220,0.35)" }}>Crie mais cursos para receber insights personalizados sobre sua produção.</p>
            )
          ) : (
            <div style={{ position: "relative" }}>
              <div style={{ filter: "blur(4px)", pointerEvents: "none", userSelect: "none", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {["Sua taxa de quizzes está abaixo da média. Adicionar quizzes melhora a retenção.", "O curso \"Marketing Digital\" tem poucos módulos comparado aos outros."].map((t, i) => (
                  <div key={i} style={{ fontSize: "0.875rem", color: "rgba(232,227,220,0.5)", background: "rgba(232,227,220,0.03)", border: "1px solid rgba(232,227,220,0.07)", borderRadius: "8px", padding: "0.875rem 1rem" }}>{t}</div>
                ))}
              </div>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ background: "rgba(11,11,15,0.9)", backdropFilter: "blur(8px)", borderRadius: "12px", border: "1px solid rgba(232,227,220,0.1)", padding: "1.25rem 1.75rem", textAlign: "center" }}>
                  <Lock className="h-5 w-5 mx-auto mb-2" style={{ color: ACCENT }} />
                  <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "#E8E3DC", marginBottom: "0.25rem" }}>Disponível no plano Pro</p>
                  <p style={{ fontSize: "0.75rem", color: "rgba(232,227,220,0.4)" }}>Insights gerados por IA sobre seus cursos</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
