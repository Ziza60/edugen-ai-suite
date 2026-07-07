import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription, useMonthlyUsage } from "@/hooks/useSubscription";
import { useDevMode } from "@/hooks/useDevMode";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  ArrowLeft, ArrowRight, Loader2, Sparkles, BookOpen, Brain, Image,
  CheckCircle2, Upload, FileText, X, AlertCircle, Award, Zap,
  Check, Circle, MessageSquare, GraduationCap, FileDown, Globe, Youtube,
  Clock, Gauge
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { TemplateSelector, CourseTemplate } from "@/components/course/TemplateSelector";
import { YouTubeImportScreen } from "@/components/course/YouTubeImportScreen";
import { PdfImportScreen, PdfAnalysis } from "@/components/course/PdfImportScreen";

const STEPS = [
  { label: "Sobre o curso", num: 1 },
  { label: "Módulos", num: 2 },
  { label: "Opções", num: 3 },
  { label: "Revisão", num: 4 },
];

const MAX_FILES_FREE = 3;
const MAX_FILES_PRO = 20;
const MAX_TOTAL_CHARS = 150_000;
const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".md"];

interface UploadedSource {
  id: string;
  filename: string;
  char_count: number;
}

export default function CourseWizard() {
  // Prefill support: a quick-create box (homepage/dashboard suggestion) can hand
  // the theme via URL (?theme=...&title=...) or router state ({ theme, title }).
  // With a theme present we skip the template screen and land on the form filled.
  // The box receives conversational input ("crie um curso com o tema \"X\""), so
  // we strip the instruction wrapper/quotes and derive the title from the theme.
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navState = (location.state ?? {}) as { theme?: string; title?: string };
  const rawPrefillTheme = (searchParams.get("theme") || navState.theme || "").trim();
  const rawPrefillTitle = (searchParams.get("title") || navState.title || "").trim();
  const cleanPrompt = (raw: string): string => {
    let t = raw.trim();
    // "crie/gere/quero um curso/treinamento (com o tema|sobre|de) ..." → keep only the theme
    t = t.replace(/^(crie|criar|gere|gerar|fa[çc]a|fazer|quero|preciso(\s+de)?|me\s+ajude\s+a\s+criar)\s+(um\s+|uma\s+)?(curso|treinamento|capacita[çc][ãa]o)\s*(completo\s*)?(com\s+o\s+tema|sobre(\s+o\s+tema)?|a\s+respeito\s+de|de|do|da|em|para|:)?\s*/i, "");
    // bare "curso de/sobre X" → X
    t = t.replace(/^(um\s+|uma\s+)?(curso|treinamento)\s+(de|sobre|do|da|em)\s+/i, "");
    // strip surrounding/unbalanced quotes and leftover punctuation
    t = t.replace(/^["'“”‘’\s]+|["'“”‘’.\s]+$/g, "").trim();
    return t;
  };
  const prefillTheme = rawPrefillTheme ? (cleanPrompt(rawPrefillTheme) || rawPrefillTheme) : "";
  const derivedTitle = prefillTheme.length > 90
    ? prefillTheme.slice(0, 90).replace(/\s+\S*$/, "")
    : prefillTheme;
  const prefillTitle = rawPrefillTitle ||
    (derivedTitle ? derivedTitle.charAt(0).toUpperCase() + derivedTitle.slice(1) : "");

  const [showTemplates, setShowTemplates] = useState(!prefillTheme);
  // Quick create (Coursebox-style): arriving with a theme, the user answers 4
  // guided questions and we generate straight away — no Título/Tema form. The
  // full form stays available via "Modo avançado".
  const [quickMode, setQuickMode] = useState(!!prefillTheme);
  const [quickStep, setQuickStep] = useState(0);
  const [quickCustom, setQuickCustom] = useState("");
  const [pendingQuickGenerate, setPendingQuickGenerate] = useState(false);
  // handleGenerate is defined further down (after the early-return screens); the
  // effect below must be an unconditional hook, so it calls through a ref that is
  // (re)assigned every full render.
  const handleGenerateRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (pendingQuickGenerate) {
      setPendingQuickGenerate(false);
      setQuickMode(false);
      handleGenerateRef.current();
    }
  }, [pendingQuickGenerate]);
  const [showYouTube, setShowYouTube] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<CourseTemplate | null>(null);

  const { user } = useAuth();
  const { plan, limits } = useSubscription();
  const { usage } = useMonthlyUsage();
  const { isDev } = useDevMode();
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStep, setGenerationStep] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [importingUrl, setImportingUrl] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [useSources, setUseSources] = useState(false);
  const [tempCourseId] = useState(() => crypto.randomUUID());
  const [uploadedSources, setUploadedSources] = useState<UploadedSource[]>([]);

  const [form, setForm] = useState({
    title: prefillTitle,
    theme: prefillTheme,
    targetAudience: "",
    tone: "profissional",
    knowledgeLevel: "basico",
    outcome: "aplicacao",
    language: "pt-BR",
    numModules: 3,
    includeQuiz: true,
    includeFlashcards: true,
    includeImages: false,
    density: "standard" as "compact" | "standard" | "detailed",
  });

  // ── Prompt quality score ──
  const calcPromptScore = () => {
    let score = 0;
    const rt = form.title.trim() || selectedTemplate?.suggestedTitle || "";
    const rth = form.theme.trim() || selectedTemplate?.suggestedTheme || "";
    const ra = form.targetAudience.trim() || selectedTemplate?.targetAudience || "";
    if (rt.length >= 10) score += 25;
    if (rth.length >= 15) score += 25;
    if (ra.length > 0) score += 20;
    if (form.numModules >= 5) score += 10;
    if (useSources && uploadedSources.length > 0) score += 20;
    return Math.min(score, 100);
  };

  const promptScore = calcPromptScore();
  const promptScoreColor = promptScore < 40 ? "bg-destructive" : promptScore < 75 ? "bg-yellow-500" : "bg-green-500";
  const promptScoreLabel = promptScore < 40
    ? "Adicione mais detalhes para gerar um curso de qualidade"
    : promptScore < 75
    ? "Bom começo — defina o público-alvo para melhorar"
    : "Ótimo! Seu curso está pronto para ser gerado";

  // ── Reading time estimate ──
  const calcReadingTime = () => {
    const wordsPerModule = { compact: 600, standard: 1000, detailed: 1550 };
    const wpm = 200;
    const totalMinutes = Math.round((form.numModules * wordsPerModule[form.density]) / wpm);
    if (totalMinutes < 60) return `~${totalMinutes} min de conteúdo`;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m > 0 ? `~${h}h ${m}min de conteúdo` : `~${h}h de conteúdo`;
  };

  const canCreate = true;
  const canUseImages = true;
  const canUseSources = true;
  const maxFiles = plan === "pro" ? MAX_FILES_PRO : MAX_FILES_FREE;
  const totalChars = uploadedSources.reduce((sum, s) => sum + s.char_count, 0);

  const handleTemplateSelect = (template: CourseTemplate) => {
    setSelectedTemplate(template);
    setForm((prev) => ({
      ...prev,
      title: "",
      theme: "",
      targetAudience: "",
      tone: template.tone,
      numModules: Math.min(template.suggestedModules, limits.maxModules),
    }));
    setShowTemplates(false);
  };

  const handleSkipTemplates = () => {
    setShowTemplates(false);
  };

  const handleYouTubeSelect = () => {
    setShowTemplates(false);
    setShowYouTube(true);
  };

  const handlePdfSelect = () => {
    setShowTemplates(false);
    setShowPdf(true);
  };

  const handlePdfComplete = (analysis: PdfAnalysis) => {
    setForm((prev) => ({
      ...prev,
      title: analysis.title,
      theme: analysis.theme,
      targetAudience: analysis.targetAudience,
      numModules: Math.min(analysis.suggestedModules, limits.maxModules),
      language: analysis.detectedLanguage === "en" ? "en" : analysis.detectedLanguage === "es" ? "es" : "pt-BR",
    }));
    setUploadedSources([{ id: analysis.source_id, filename: analysis.filename, char_count: analysis.char_count }]);
    setUseSources(true);
    setShowPdf(false);
  };

  const handleYouTubeComplete = (analysis: {
    source_id: string;
    filename: string;
    char_count: number;
    title: string;
    theme: string;
    targetAudience: string;
    suggestedModules: number;
    detectedLanguage: string;
  }) => {
    setForm((prev) => ({
      ...prev,
      title: analysis.title,
      theme: analysis.theme,
      targetAudience: analysis.targetAudience,
      numModules: Math.min(analysis.suggestedModules, limits.maxModules),
      language: analysis.detectedLanguage === "en" ? "en" : analysis.detectedLanguage === "es" ? "es" : "pt-BR",
    }));
    setUploadedSources([{ id: analysis.source_id, filename: analysis.filename, char_count: analysis.char_count }]);
    setUseSources(true);
    setShowYouTube(false);
  };

  if (showTemplates) {
    return (
      <TemplateSelector
        onSelect={handleTemplateSelect}
        onSkip={handleSkipTemplates}
        onYouTube={handleYouTubeSelect}
        onPdf={handlePdfSelect}
      />
    );
  }

  if (showYouTube) {
    return (
      <YouTubeImportScreen
        tempCourseId={tempCourseId}
        onBack={() => { setShowYouTube(false); setShowTemplates(true); }}
        onComplete={handleYouTubeComplete}
      />
    );
  }

  if (showPdf) {
    return (
      <PdfImportScreen
        tempCourseId={tempCourseId}
        onBack={() => { setShowPdf(false); setShowTemplates(true); }}
        onComplete={handlePdfComplete}
      />
    );
  }

  const updateForm = (key: string, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleFileUpload = async (file: File) => {
    if (uploadedSources.length >= maxFiles) {
      toast({ title: "Limite atingido", description: `Máximo de ${maxFiles} fontes por curso.`, variant: "destructive" });
      return;
    }

    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      toast({ title: "Tipo não suportado", description: `Aceitos: ${ALLOWED_EXTENSIONS.join(", ")}`, variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("course_id", tempCourseId);

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-course-source`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: formData,
        }
      );

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Erro no upload");

      setUploadedSources((prev) => [
        ...prev,
        { id: result.id, filename: result.filename, char_count: result.char_count },
      ]);

      toast({ title: "Arquivo processado", description: `${result.filename} — ${result.char_count.toLocaleString()} caracteres extraídos.` });
    } catch (error: any) {
      toast({ title: "Erro no upload", description: error.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const removeSource = async (sourceId: string) => {
    try {
      await supabase.from("course_sources").delete().eq("id", sourceId);
      setUploadedSources((prev) => prev.filter((s) => s.id !== sourceId));
    } catch {
      toast({ title: "Erro ao remover", variant: "destructive" });
    }
  };

  const handleGenerate = async () => {
    if (!canCreate) {
      toast({ title: "Limite atingido", description: "Você atingiu o limite mensal do seu plano.", variant: "destructive" });
      return;
    }

    if (useSources && uploadedSources.length === 0) {
      toast({ title: "Nenhuma fonte", description: "Faça upload de pelo menos um documento.", variant: "destructive" });
      return;
    }

    setGenerating(true);
    setGenerationProgress(5);
    setGenerationStep("Preparando geração…");
    setGenerationMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-course`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            title: (form.title.trim() || selectedTemplate?.suggestedTitle || "").trim(),
            theme: form.theme.trim() || selectedTemplate?.suggestedTheme || "",
            target_audience: form.targetAudience.trim() || selectedTemplate?.targetAudience || "",
            tone: form.tone,
            knowledge_level: form.knowledgeLevel,
            outcome: form.outcome,
            language: form.language,
            num_modules: form.numModules,
            include_quiz: form.includeQuiz,
            include_flashcards: form.includeFlashcards,
            include_images: form.includeImages,
            density: form.density,
            use_sources: useSources,
            temp_course_id: useSources ? tempCourseId : undefined,
          }),
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Erro ao gerar curso");
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let courseId: string | null = null;
      let completed = false;
      // The server emits a heartbeat every 12s; 45s of total silence means the
      // function died (edge wall-clock kill). The watchdog below then recovers.
      const STALL_MS = 45000;

      const goToCourse = (id: string, partial = false) => {
        completed = true;
        setGenerationProgress(100);
        setGenerationStep("Concluído!");
        setGenerationMessage("");
        toast(
          partial
            ? { title: "Curso gerado", description: "Alguns extras (imagens/quiz) podem levar um instante para aparecer." }
            : { title: "Curso gerado com sucesso!", description: "Redirecionando para o editor..." },
        );
        setTimeout(() => navigate(`/app/courses/${id}`), 1000);
      };

      while (true) {
        const read = await Promise.race([
          reader.read(),
          new Promise<"stall">((r) => setTimeout(() => r("stall"), STALL_MS)),
        ]);
        if (read === "stall") { try { await reader.cancel(); } catch { /* noop */ } break; }
        const { done, value } = read;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.replace("data: ", ""));
            if (event.type === "course_created") {
              courseId = event.courseId;
            }
            if (event.type === "status") {
              setGenerationStep(event.message);
            }
            if (event.type === "structure_done") {
              setGenerationProgress(15);
              setGenerationStep("Estrutura criada!");
            }
            if (event.type === "module_start") {
              const pct = 15 + Math.round((event.module / event.total) * 70);
              setGenerationProgress(pct);
              setGenerationMessage(`Gerando Módulo ${event.module} de ${event.total}: ${event.title}...`);
              setGenerationStep(`Módulo ${event.module}/${event.total}`);
            }
            if (event.type === "module_done") {
              const pct = 15 + Math.round((event.module / event.total) * 75);
              setGenerationProgress(pct);
            }
            if (event.type === "complete") {
              goToCourse(event.courseId);
            }
            if (event.type === "debug") {
              console.warn("[CourseGen DEBUG]", event);
            }
            if (event.type === "error") {
              console.error("[CourseGen ERROR]", event.message, event);
              throw new Error(event.message);
            }
          } catch (parseErr: any) {
            if (parseErr.message && !parseErr.message.includes("JSON")) throw parseErr;
          }
        }
        if (completed) break;
      }

      // Watchdog recovery: the stream ended or stalled WITHOUT a `complete` event.
      // Never leave the user stuck — recover the (possibly partial) course from the
      // DB. If modules already exist, treat it as success; otherwise offer a retry.
      if (!completed) {
        if (courseId) {
          const { count } = await supabase
            .from("course_modules")
            .select("id", { count: "exact", head: true })
            .eq("course_id", courseId);
          if ((count ?? 0) > 0) {
            goToCourse(courseId, true);
          } else {
            throw new Error("A geração demorou mais que o esperado e não concluiu. Tente novamente.");
          }
        } else {
          throw new Error("A geração foi interrompida antes de criar o curso. Tente novamente.");
        }
      }
    } catch (error: any) {
      toast({
        title: "Erro ao gerar curso",
        description: error.message || "Tente novamente mais tarde.",
        variant: "destructive",
      });
      setGenerating(false);
      setGenerationProgress(0);
    }
  };

  handleGenerateRef.current = handleGenerate;

  const resolvedTitle = form.title.trim() || selectedTemplate?.suggestedTitle || "";
  const resolvedTheme = form.theme.trim() || selectedTemplate?.suggestedTheme || "";
  const resolvedAudience = form.targetAudience.trim() || selectedTemplate?.targetAudience || "";

  // ── Quick create (Coursebox-style): 4 guided questions, then generate ──
  const QUICK_QUESTIONS: {
    key: "targetAudience" | "knowledgeLevel" | "outcome" | "tone";
    question: string;
    options: { label: string; value: string }[];
    allowCustom?: boolean;
  }[] = [
    {
      key: "targetAudience",
      question: "Para quem é o curso que você quer criar?",
      allowCustom: true,
      options: [
        { label: "Iniciantes", value: "iniciantes" },
        { label: "Profissionais", value: "profissionais da área" },
        { label: "Equipe interna", value: "equipe interna da empresa" },
        { label: "Estudantes", value: "estudantes" },
      ],
    },
    {
      key: "knowledgeLevel",
      question: "Qual é o nível de conhecimento atual desse público?",
      options: [
        { label: "Nenhum", value: "nenhum" },
        { label: "Básico", value: "basico" },
        { label: "Intermediário", value: "intermediario" },
        { label: "Avançado", value: "avancado" },
      ],
    },
    {
      key: "outcome",
      question: "Qual resultado esse curso precisa entregar?",
      options: [
        { label: "Introdução ao tema", value: "introducao" },
        { label: "Aplicação prática", value: "aplicacao" },
        { label: "Treinamento completo", value: "treinamento" },
        { label: "Preparação para avaliação", value: "avaliacao" },
      ],
    },
    {
      key: "tone",
      question: "Que tom você prefere no material?",
      options: [
        { label: "Prático", value: "didatico" },
        { label: "Profissional", value: "profissional" },
        { label: "Conversacional", value: "direto" },
        { label: "Acadêmico", value: "academico" },
      ],
    },
  ];

  const answerQuick = (value: string | null) => {
    const q = QUICK_QUESTIONS[quickStep];
    if (value !== null && value.trim()) {
      setForm((prev) => ({ ...prev, [q.key]: value.trim() }));
    }
    setQuickCustom("");
    if (quickStep < QUICK_QUESTIONS.length - 1) setQuickStep(quickStep + 1);
    else setPendingQuickGenerate(true);
  };

  if (quickMode && !generating && !pendingQuickGenerate) {
    const q = QUICK_QUESTIONS[quickStep];
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center px-4">
        <Card className="rounded-2xl border-border shadow-sm w-full max-w-xl">
          <CardContent className="p-8">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Novo curso
            </p>
            <h1 className="font-semibold text-lg mb-6 leading-snug">{resolvedTitle || resolvedTheme}</h1>

            <div className="flex items-center justify-between mb-4">
              <p className="font-medium text-base">{q.question}</p>
              <span className="text-xs text-muted-foreground shrink-0 ml-3">
                {quickStep + 1} de {QUICK_QUESTIONS.length}
              </span>
            </div>

            <div className="space-y-2 mb-4">
              {q.options.map((opt, oi) => (
                <button
                  key={opt.value}
                  onClick={() => answerQuick(opt.value)}
                  className="w-full flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm font-medium hover:border-primary hover:bg-primary/5 transition-colors"
                >
                  <span className="h-6 w-6 rounded-md bg-muted text-muted-foreground text-xs font-bold flex items-center justify-center shrink-0">
                    {oi + 1}
                  </span>
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {q.allowCustom ? (
                <>
                  <Input
                    value={quickCustom}
                    onChange={(e) => setQuickCustom(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && quickCustom.trim()) answerQuick(quickCustom); }}
                    placeholder="Outra coisa..."
                    className="h-10"
                  />
                  {quickCustom.trim() && (
                    <Button size="sm" onClick={() => answerQuick(quickCustom)}>OK</Button>
                  )}
                </>
              ) : <div className="flex-1" />}
              <Button variant="ghost" size="sm" className="text-muted-foreground shrink-0" onClick={() => answerQuick(null)}>
                Pular
              </Button>
            </div>

            <button
              onClick={() => setQuickMode(false)}
              className="mt-6 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Prefiro preencher o formulário completo (modo avançado)
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canNext = () => {
    switch (step) {
      case 0: return resolvedTitle.length > 0 && resolvedTheme.length > 0;
      case 1: return form.numModules > 0;
      case 2: return true;
      case 3: return true;
      default: return false;
    }
  };

  const certType = plan === "pro" ? "personalizado" : "simples";

  return (
    <div className="min-h-screen bg-muted/30">
      {/* ═══════════ TOP BAR ═══════════ */}
      <div className="bg-card border-b border-border">
        <div className="max-w-[840px] mx-auto px-6 py-4 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/app/dashboard")} className="shrink-0">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Dashboard
          </Button>
          <div className="h-5 w-px bg-border" />
          <h1 className="font-display text-lg font-bold text-foreground">Criar novo curso</h1>
          {selectedTemplate && (
            <Badge variant="secondary" className="text-xs">
              Template: {selectedTemplate.name}
            </Badge>
          )}
        </div>
      </div>

      <div className="max-w-[840px] mx-auto px-6 py-8">
        {/* ═══════════ STEPPER ═══════════ */}
        <div className="flex items-center justify-between mb-8 px-4">
          {STEPS.map((s, i) => (
            <div key={s.num} className="flex items-center gap-0 flex-1">
              <div className="flex flex-col items-center gap-1.5">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                  i < step
                    ? "bg-primary text-primary-foreground"
                    : i === step
                    ? "bg-primary text-primary-foreground ring-[3px] ring-primary/25 shadow-lg shadow-primary/20"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {i < step ? <Check className="h-4 w-4" /> : s.num}
                </div>
                <span className={`text-xs font-medium text-center whitespace-nowrap ${
                  i <= step ? "text-foreground" : "text-muted-foreground"
                }`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-3 mt-[-18px] rounded-full transition-colors ${
                  i < step ? "bg-primary" : "bg-border"
                }`} />
              )}
            </div>
          ))}
        </div>

        {/* ═══════════ GENERATING STATE ═══════════ */}
        {generating ? (
          <Card className="rounded-2xl border-border shadow-sm">
            <CardContent className="py-20 text-center">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              <h3 className="font-display text-2xl font-bold mb-2">Gerando seu curso…</h3>
              <p className="text-muted-foreground mb-1">
                {useSources
                  ? "A IA está analisando suas fontes e criando o conteúdo."
                  : "A IA está criando o conteúdo do seu curso."}
              </p>
              <p className="text-sm font-medium text-primary mb-2">{generationStep}</p>
              {generationMessage && (
                <p className="text-xs text-muted-foreground mb-4">{generationMessage}</p>
              )}
              <Progress value={generationProgress} className="max-w-sm mx-auto h-2.5" />
              <p className="text-xs text-muted-foreground mt-3">{generationProgress}% concluído</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* ═══════════ WIZARD CARD ═══════════ */}
            <Card className="rounded-2xl border-border shadow-sm overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.2 }}
                >
                  {/* ──────── STEP 0: ABOUT ──────── */}
                  {step === 0 && (
                    <div className="p-6 lg:p-8 space-y-7">
                      <div>
                        <h2 className="font-display text-xl font-bold text-foreground">Sobre o curso</h2>
                        <p className="text-sm text-muted-foreground mt-1">Defina o tema, público e estilo do seu curso</p>
                      </div>

                      {/* Section: Main fields */}
                      <div className="bg-muted/40 rounded-xl p-5 space-y-5 border border-border/60">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Definições principais</p>

                        <div className="space-y-1.5">
                          <Label className="font-medium">Título do curso <span className="text-destructive">*</span></Label>
                          <Input
                            placeholder={selectedTemplate?.suggestedTitle || "Ex: Introdução ao Marketing Digital"}
                            value={form.title}
                            onChange={(e) => updateForm("title", e.target.value)}
                            className="h-11"
                          />
                          <p className="text-xs text-muted-foreground">Um título claro aumenta a qualidade do conteúdo gerado.</p>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="font-medium">Tema / Assunto principal <span className="text-destructive">*</span></Label>
                          <Textarea
                            placeholder={selectedTemplate?.suggestedTheme || "Explique em 1–2 frases o que o curso ensina"}
                            value={form.theme}
                            onChange={(e) => updateForm("theme", e.target.value)}
                            rows={3}
                            className="resize-none"
                          />
                          <p className="text-xs text-muted-foreground">Isso ajuda a IA a ajustar o nível e a profundidade do curso.</p>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="font-medium">Público-alvo</Label>
                          <Input
                            placeholder={selectedTemplate?.targetAudience || "Ex: iniciantes, estudantes, profissionais…"}
                            value={form.targetAudience}
                            onChange={(e) => updateForm("targetAudience", e.target.value)}
                            className="h-11"
                          />
                          <p className="text-xs text-muted-foreground">A IA adapta exemplos e profundidade ao público.</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <Label className="font-medium">Tom</Label>
                            <Select value={form.tone} onValueChange={(v) => updateForm("tone", v)}>
                              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="profissional">Profissional</SelectItem>
                                <SelectItem value="didatico">Didático</SelectItem>
                                <SelectItem value="direto">Direto</SelectItem>
                                <SelectItem value="academico">Acadêmico</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">Define o estilo do texto e a linguagem.</p>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="font-medium">Idioma</Label>
                            <Select value={form.language} onValueChange={(v) => updateForm("language", v)}>
                              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pt-BR">Português (BR)</SelectItem>
                                <SelectItem value="en">English</SelectItem>
                                <SelectItem value="es">Español</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">O conteúdo e as avaliações serão gerados neste idioma.</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <Label className="font-medium">Nível atual do público</Label>
                            <Select value={form.knowledgeLevel} onValueChange={(v) => updateForm("knowledgeLevel", v)}>
                              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="nenhum">Nenhum conhecimento</SelectItem>
                                <SelectItem value="basico">Básico</SelectItem>
                                <SelectItem value="intermediario">Intermediário</SelectItem>
                                <SelectItem value="avancado">Avançado</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">Define onde o curso começa e o que pode assumir como sabido.</p>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="font-medium">Resultado esperado</Label>
                            <Select value={form.outcome} onValueChange={(v) => updateForm("outcome", v)}>
                              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="introducao">Introdução ao tema</SelectItem>
                                <SelectItem value="aplicacao">Aplicação prática</SelectItem>
                                <SelectItem value="treinamento">Treinamento completo</SelectItem>
                                <SelectItem value="avaliacao">Preparação para avaliação</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">Molda a progressão e o fechamento do curso (caso, projeto ou simulado).</p>
                          </div>
                        </div>
                      </div>

                      {/* Section: Sources */}
                      <div className={`rounded-xl border p-5 space-y-4 transition-colors ${
                        canUseSources ? "border-primary/20 bg-primary/3" : "border-border bg-muted/30"
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${
                              canUseSources ? "bg-primary/10" : "bg-muted"
                            }`}>
                              <Upload className={`h-4 w-4 ${canUseSources ? "text-primary" : "text-muted-foreground"}`} />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-semibold text-sm">Gerar a partir de fontes próprias</p>
                                {!canUseSources && <Badge variant="outline" className="text-[10px] font-bold px-1.5 py-0">PRO</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {canUseSources
                                  ? "Use PDFs ou textos para criar um curso baseado no seu material."
                                  : "Disponível apenas no Pro."}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {!canUseSources && (
                              <button
                                onClick={() => navigate("/app/upgrade")}
                                className="text-[11px] font-semibold text-primary hover:underline whitespace-nowrap"
                              >
                                Upgrade
                              </button>
                            )}
                            <Switch checked={useSources} onCheckedChange={setUseSources} disabled={!canUseSources} />
                          </div>
                        </div>

                        {useSources && (
                          <div className="space-y-3 pt-3 border-t border-border/60">
                            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
                              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                              <span>Seus documentos serão usados exclusivamente neste curso. A IA não adicionará conteúdo externo.</span>
                            </div>

                            {uploadedSources.length > 0 && (
                              <div className="space-y-2">
                                {uploadedSources.map((source) => (
                                  <div key={source.id} className="flex items-center justify-between bg-card rounded-lg px-3 py-2.5 border border-border/60">
                                    <div className="flex items-center gap-2">
                                      <FileText className="h-4 w-4 text-primary" />
                                      <span className="text-sm font-medium truncate max-w-[200px]">{source.filename}</span>
                                      <span className="text-xs text-muted-foreground">{source.char_count.toLocaleString()} chars</span>
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeSource(source.id)}>
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </div>
                                ))}
                                <p className="text-xs text-muted-foreground">
                                  {totalChars.toLocaleString()} / {MAX_TOTAL_CHARS.toLocaleString()} chars · {uploadedSources.length}/{maxFiles} fontes
                                </p>
                              </div>
                            )}

                            {uploadedSources.length < maxFiles && (
                              <>
                                <div
                                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                                  onDragLeave={() => setDragging(false)}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    setDragging(false);
                                    const file = e.dataTransfer.files[0];
                                    if (file) handleFileUpload(file);
                                  }}
                                  onClick={() => fileInputRef.current?.click()}
                                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                                    dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                                  }`}
                                >
                                  {uploading ? (
                                    <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-primary" />
                                  ) : (
                                    <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                                  )}
                                  <p className="text-sm text-muted-foreground">
                                    {uploading ? "Processando…" : <>Arraste um arquivo aqui ou <span className="text-primary font-medium">clique para selecionar</span></>}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">PDF, TXT, MD — máx. 10MB</p>
                                </div>
                                {uploading && (
                                  <Progress value={uploadProgress} className="h-1.5" />
                                )}
                                <input
                                  ref={fileInputRef} type="file" accept=".pdf,.txt,.md" className="hidden"
                                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ""; }}
                                />

                                {/* URL Import */}
                                <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                                  <div className="relative flex-1">
                                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                    <Input
                                      placeholder="Cole URL do YouTube ou artigo web"
                                      value={urlInput}
                                      onChange={(e) => setUrlInput(e.target.value)}
                                      className="h-10 pl-9 text-sm"
                                      disabled={importingUrl || uploading}
                                    />
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-10 shrink-0"
                                    disabled={!urlInput.trim() || importingUrl || uploading}
                                    onClick={async () => {
                                      setImportingUrl(true);
                                      try {
                                        const { data: { session } } = await supabase.auth.getSession();
                                        const { data, error } = await supabase.functions.invoke("import-url-source", {
                                          body: { url: urlInput.trim(), course_id: tempCourseId },
                                        });
                                        if (error) throw error;
                                        setUploadedSources((prev) => [
                                          ...prev,
                                          { id: data.id, filename: data.filename, char_count: data.char_count },
                                        ]);
                                        setUrlInput("");
                                        toast({
                                          title: data.source_type === "youtube" ? "Vídeo importado!" : "Artigo importado!",
                                          description: `${data.filename} — ${data.char_count.toLocaleString()} caracteres extraídos.`,
                                        });
                                      } catch (err: any) {
                                        toast({ title: "Erro na importação", description: err.message, variant: "destructive" });
                                      } finally {
                                        setImportingUrl(false);
                                      }
                                    }}
                                  >
                                    {importingUrl ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : urlInput.includes("youtu") ? (
                                      <><Youtube className="h-4 w-4 mr-1" />Importar</>
                                    ) : (
                                      <><Globe className="h-4 w-4 mr-1" />Importar</>
                                    )}
                                  </Button>
                                </div>
                                <p className="text-[10px] text-muted-foreground">
                                  YouTube (transcrição automática) · Artigos e blogs · Páginas web
                                </p>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Prompt quality indicator */}
                      <div className="rounded-xl border border-border/60 bg-muted/40 p-4 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Gauge className="h-4 w-4 text-muted-foreground" />
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Qualidade do prompt</p>
                          </div>
                          <span className="text-xs font-bold text-foreground">{promptScore}%</span>
                        </div>
                        <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${promptScoreColor}`}
                            style={{ width: `${promptScore}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">{promptScoreLabel}</p>
                      </div>
                    </div>
                  )}

                  {/* ──────── STEP 1: MODULES ──────── */}
                  {step === 1 && (
                    <div className="p-6 lg:p-8 space-y-7">
                      <div>
                        <h2 className="font-display text-xl font-bold text-foreground">Módulos</h2>
                        <p className="text-sm text-muted-foreground mt-1">Defina a estrutura do curso antes de gerar o conteúdo.</p>
                      </div>

                      <div className="bg-muted/40 rounded-xl p-5 space-y-5 border border-border/60">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="font-medium">Número de módulos</Label>
                            <span className="text-xs text-muted-foreground">
                              Limite do seu plano: <strong>{limits.maxModules}</strong> módulos
                            </span>
                          </div>

                          <div className="flex items-center gap-4">
                            <Slider
                              value={[form.numModules]}
                              onValueChange={([v]) => updateForm("numModules", v)}
                              min={1}
                              max={limits.maxModules}
                              step={1}
                              className="flex-1"
                            />
                            <Input
                              type="number"
                              min={1}
                              max={limits.maxModules}
                              value={form.numModules}
                              onChange={(e) => {
                                const v = Math.min(Math.max(1, parseInt(e.target.value) || 1), limits.maxModules);
                                updateForm("numModules", v);
                              }}
                              className="w-20 h-10 text-center font-bold text-lg"
                            />
                        </div>

                        {/* Density selector */}
                        <div className="space-y-1.5 pt-2 border-t border-border/40">
                          <Label className="font-medium">Densidade do conteúdo</Label>
                          <Select value={form.density} onValueChange={(v) => updateForm("density", v)}>
                            <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="compact">Compacto — visão geral, curso mais rápido</SelectItem>
                              <SelectItem value="standard">Padrão — equilíbrio ideal</SelectItem>
                              <SelectItem value="detailed">Detalhado — aprofundado, curso mais longo</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Reading time badge */}
                        <div className="flex items-center gap-2 pt-2">
                          <Badge variant="secondary" className="text-xs font-medium gap-1.5 py-1 px-2.5">
                            <Clock className="h-3.5 w-3.5" />
                            {calcReadingTime()}
                          </Badge>
                        </div>
                      </div>
                    </div>

                      {/* Module preview cards */}
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Prévia dos módulos</p>
                        <div className="space-y-2">
                          {Array.from({ length: form.numModules }, (_, i) => (
                            <div key={i} className="flex items-center gap-3 bg-card rounded-xl border border-border/60 px-4 py-3">
                              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                <span className="text-xs font-bold text-primary">{i + 1}</span>
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-foreground">Módulo {i + 1}</p>
                                <p className="text-xs text-muted-foreground">Conteúdo gerado automaticamente pela IA</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ──────── STEP 2: OPTIONS ──────── */}
                  {step === 2 && (
                    <div className="p-6 lg:p-8 space-y-7">
                      <div>
                        <h2 className="font-display text-xl font-bold text-foreground">Opções extras</h2>
                        <p className="text-sm text-muted-foreground mt-1">Escolha os recursos adicionais do seu curso</p>
                      </div>

                      <div className="space-y-3">
                        {/* Quiz option */}
                        <div className={`rounded-xl border p-4 flex items-center justify-between transition-colors ${
                          form.includeQuiz ? "border-primary/25 bg-primary/3" : "border-border"
                        }`}>
                          <div className="flex items-center gap-3">
                            <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                              form.includeQuiz ? "bg-primary/10" : "bg-muted"
                            }`}>
                              <MessageSquare className={`h-5 w-5 ${form.includeQuiz ? "text-primary" : "text-muted-foreground"}`} />
                            </div>
                            <div>
                              <p className="font-semibold text-sm">Quizzes</p>
                              <p className="text-xs text-muted-foreground">Perguntas de múltipla escolha por módulo.</p>
                            </div>
                          </div>
                          <Switch checked={form.includeQuiz} onCheckedChange={(v) => updateForm("includeQuiz", v)} />
                        </div>

                        {/* Flashcards option */}
                        <div className={`rounded-xl border p-4 flex items-center justify-between transition-colors ${
                          form.includeFlashcards ? "border-primary/25 bg-primary/3" : "border-border"
                        }`}>
                          <div className="flex items-center gap-3">
                            <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                              form.includeFlashcards ? "bg-primary/10" : "bg-muted"
                            }`}>
                              <Brain className={`h-5 w-5 ${form.includeFlashcards ? "text-primary" : "text-muted-foreground"}`} />
                            </div>
                            <div>
                              <p className="font-semibold text-sm">Flashcards</p>
                              <p className="text-xs text-muted-foreground">Cartões de revisão para retenção.</p>
                            </div>
                          </div>
                          <Switch checked={form.includeFlashcards} onCheckedChange={(v) => updateForm("includeFlashcards", v)} />
                        </div>

                        {/* Images option */}
                        <div className={`rounded-xl border p-4 flex items-center justify-between transition-colors ${
                          form.includeImages && canUseImages ? "border-primary/25 bg-primary/3" : "border-border"
                        }`}>
                          <div className="flex items-center gap-3">
                            <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                              form.includeImages && canUseImages ? "bg-primary/10" : "bg-muted"
                            }`}>
                              <Image className={`h-5 w-5 ${form.includeImages && canUseImages ? "text-primary" : "text-muted-foreground"}`} />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-semibold text-sm">Imagens com IA</p>
                                <Badge variant="outline" className="text-[10px] font-bold px-1.5 py-0">PRO</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {canUseImages ? "Imagens ilustrativas geradas por módulo." : "Disponível no Pro."}
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={form.includeImages}
                            onCheckedChange={(v) => updateForm("includeImages", v)}
                            disabled={!canUseImages}
                          />
                        </div>
                      </div>

                      {/* Mini summary */}
                      <div className="bg-muted/40 rounded-xl p-4 border border-border/60">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Selecionado</p>
                        <div className="space-y-1.5">
                          <SummaryItem active={form.includeQuiz} label="Quizzes" />
                          <SummaryItem active={form.includeFlashcards} label="Flashcards" />
                          <SummaryItem active={form.includeImages && canUseImages} label="Imagens IA" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ──────── STEP 3: REVIEW ──────── */}
                  {step === 3 && (
                    <div className="p-6 lg:p-8 space-y-6">
                      <div>
                        <h2 className="font-display text-xl font-bold text-foreground">Revisão final</h2>
                        <p className="text-sm text-muted-foreground mt-1">Confirme tudo antes de gerar</p>
                      </div>

                      {/* Course summary card */}
                      <div className="bg-muted/40 rounded-xl p-5 border border-border/60 space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Resumo do curso</p>
                        <div className="space-y-2.5 text-sm">
                          <ReviewRow label="Título" value={resolvedTitle} />
                          <ReviewRow label="Público-alvo" value={resolvedAudience || "Não especificado"} />
                          <ReviewRow label="Idioma" value={form.language === "pt-BR" ? "Português (BR)" : form.language === "en" ? "English" : "Español"} />
                          <ReviewRow label="Tom" value={form.tone.charAt(0).toUpperCase() + form.tone.slice(1)} />
                          <ReviewRow label="Módulos" value={`${form.numModules}`} />
                          <ReviewRow label="Recursos" value={[
                            form.includeQuiz && "Quizzes",
                            form.includeFlashcards && "Flashcards",
                            form.includeImages && "Imagens IA",
                          ].filter(Boolean).join(", ") || "Nenhum extra"} />
                          {useSources && <ReviewRow label="Fontes próprias" value={`${uploadedSources.length} arquivo(s)`} />}
                        </div>
                      </div>

                      {/* What you'll receive */}
                      <div className="bg-primary/5 border border-primary/15 rounded-xl p-5 space-y-3">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-primary" />
                          <p className="text-sm font-bold text-foreground">O que você vai receber</p>
                        </div>
                        <ul className="space-y-2 text-sm text-foreground/80">
                          <li className="flex items-center gap-2">
                            <BookOpen className="h-4 w-4 text-primary/70 shrink-0" />
                            Conteúdo completo em {form.numModules} {form.numModules === 1 ? "módulo" : "módulos"}
                          </li>
                          {form.includeQuiz && (
                            <li className="flex items-center gap-2">
                              <MessageSquare className="h-4 w-4 text-primary/70 shrink-0" />
                              Quizzes de múltipla escolha por módulo
                            </li>
                          )}
                          {form.includeFlashcards && (
                            <li className="flex items-center gap-2">
                              <Brain className="h-4 w-4 text-primary/70 shrink-0" />
                              Flashcards de revisão
                            </li>
                          )}
                          {form.includeImages && (
                            <li className="flex items-center gap-2">
                              <Image className="h-4 w-4 text-primary/70 shrink-0" />
                              Imagens ilustrativas com IA
                            </li>
                          )}
                          <li className="flex items-center gap-2">
                            <Award className="h-4 w-4 text-primary/70 shrink-0" />
                            Certificado {certType} (após publicar)
                          </li>
                          <li className="flex items-center gap-2">
                            <FileDown className="h-4 w-4 text-primary/70 shrink-0" />
                            Exportações conforme plano (MD/PDF/PPTX/Notion/SCORM)
                          </li>
                        </ul>
                      </div>

                      {/* Source info */}
                      {useSources && (
                        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 text-sm">
                          <p className="font-semibold text-primary mb-1">📄 Curso baseado em fontes próprias</p>
                          <p className="text-muted-foreground">
                            O conteúdo será gerado exclusivamente a partir dos {uploadedSources.length} documento(s) enviado(s)
                            ({totalChars.toLocaleString()} caracteres).
                          </p>
                        </div>
                      )}

                      {/* Usage warning */}
                      {plan === "free" && canCreate && (
                        <div className="bg-muted/50 border border-border rounded-xl p-3 text-xs text-muted-foreground flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>
                            Você usou <strong>{usage}</strong> de <strong>{limits.maxCoursesPerMonth}</strong> cursos gratuitos este mês. Esta geração usará 1 crédito.
                          </span>
                        </div>
                      )}

                      {!canCreate && (
                        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-center">
                          <p className="text-sm text-destructive font-semibold">Limite mensal atingido. Faça upgrade para continuar.</p>
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* ═══════════ STICKY BOTTOM NAV ═══════════ */}
              <div className="sticky bottom-0 bg-card border-t border-border px-6 lg:px-8 py-4 flex items-center justify-between">
                <Button
                  variant="outline"
                  onClick={() => setStep((s) => s - 1)}
                  disabled={step === 0}
                  className="h-11 px-5"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Voltar
                </Button>

                {step < 3 ? (
                  <Button
                    onClick={() => setStep((s) => s + 1)}
                    disabled={!canNext()}
                    className="h-11 px-6 font-semibold"
                  >
                    Próximo
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={handleGenerate}
                    disabled={!canCreate || (useSources && uploadedSources.length === 0)}
                    className="h-12 px-7 text-base font-semibold shadow-lg shadow-primary/20"
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    {useSources ? "Gerar curso a partir das fontes" : "Gerar curso com IA"}
                  </Button>
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Helper components ── */
function SummaryItem({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {active ? (
        <CheckCircle2 className="h-4 w-4 text-primary" />
      ) : (
        <Circle className="h-4 w-4 text-muted-foreground/40" />
      )}
      <span className={active ? "text-foreground font-medium" : "text-muted-foreground line-through"}>
        {label}
      </span>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-foreground text-right max-w-[60%] break-words">{value}</span>
    </div>
  );
}