import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription, useMonthlyUsage } from "@/hooks/useSubscription";
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
  Check, Circle, MessageSquare, GraduationCap, FileDown, Globe, Youtube
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

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
  const { user } = useAuth();
  const { plan, limits } = useSubscription();
  const { usage } = useMonthlyUsage();
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStep, setGenerationStep] = useState("");
  const [uploading, setUploading] = useState(false);

  const [useSources, setUseSources] = useState(false);
  const [tempCourseId] = useState(() => crypto.randomUUID());
  const [uploadedSources, setUploadedSources] = useState<UploadedSource[]>([]);

  const [form, setForm] = useState({
    title: "",
    theme: "",
    targetAudience: "",
    tone: "profissional",
    language: "pt-BR",
    numModules: 3,
    includeQuiz: true,
    includeFlashcards: true,
    includeImages: false,
  });

  const canCreate = usage < limits.maxCourses;
  const canUseImages = limits.images;
  const canUseSources = plan === "pro";
  const totalChars = uploadedSources.reduce((sum, s) => sum + s.char_count, 0);

  const updateForm = (key: string, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleFileUpload = async (file: File) => {
    if (uploadedSources.length >= MAX_FILES) {
      toast({ title: "Limite atingido", description: `Máximo de ${MAX_FILES} arquivos por curso.`, variant: "destructive" });
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
    setGenerationProgress(10);
    setGenerationStep("Preparando geração…");

    try {
      let moduleProgress = 0;
      const progressInterval = setInterval(() => {
        moduleProgress++;
        const pct = Math.min(10 + moduleProgress * 8, 85);
        setGenerationProgress(pct);
        const currentMod = Math.min(Math.ceil(moduleProgress / 2), form.numModules);
        setGenerationStep(`Gerando módulo ${currentMod}/${form.numModules}…`);
      }, 2000);

      const { data, error } = await supabase.functions.invoke("generate-course", {
        body: {
          title: form.title.trim(),
          theme: form.theme,
          target_audience: form.targetAudience,
          tone: form.tone,
          language: form.language,
          num_modules: form.numModules,
          include_quiz: form.includeQuiz,
          include_flashcards: form.includeFlashcards,
          include_images: form.includeImages,
          use_sources: useSources,
          temp_course_id: useSources ? tempCourseId : undefined,
        },
      });

      clearInterval(progressInterval);
      setGenerationProgress(100);
      setGenerationStep("Finalizando…");

      if (error) throw error;

      toast({ title: "Curso gerado com sucesso!", description: "Redirecionando para o editor..." });
      setTimeout(() => navigate(`/app/courses/${data.course_id}`), 1000);
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

  const canNext = () => {
    switch (step) {
      case 0: return form.title.trim().length > 0 && form.theme.trim().length > 0;
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
              <p className="text-sm font-medium text-primary mb-6">{generationStep}</p>
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
                            placeholder="Ex: Introdução ao Marketing Digital"
                            value={form.title}
                            onChange={(e) => updateForm("title", e.target.value)}
                            className="h-11"
                          />
                          <p className="text-xs text-muted-foreground">Um título claro aumenta a qualidade do conteúdo gerado.</p>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="font-medium">Tema / Assunto principal <span className="text-destructive">*</span></Label>
                          <Textarea
                            placeholder="Explique em 1–2 frases o que o curso ensina"
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
                            placeholder="Ex: iniciantes, estudantes, profissionais…"
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
                                  {totalChars.toLocaleString()} / {MAX_TOTAL_CHARS.toLocaleString()} chars · {uploadedSources.length}/{MAX_FILES} arquivos
                                </p>
                              </div>
                            )}

                            {uploadedSources.length < MAX_FILES && (
                              <>
                                <input
                                  ref={fileInputRef} type="file" accept=".pdf,.txt,.md" className="hidden"
                                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ""; }}
                                />
                                <Button variant="outline" className="w-full h-10" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                                  {uploading
                                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processando…</>
                                    : <><Upload className="h-4 w-4 mr-2" />Enviar arquivo (PDF, TXT ou MD)</>}
                                </Button>
                              </>
                            )}
                          </div>
                        )}
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
                          <ReviewRow label="Título" value={form.title} />
                          <ReviewRow label="Público-alvo" value={form.targetAudience || "Não especificado"} />
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
                            Você usou <strong>{usage}</strong> de <strong>{limits.maxCourses}</strong> cursos gratuitos este mês. Esta geração usará 1 crédito.
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
