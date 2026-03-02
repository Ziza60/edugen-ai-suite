import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription, useMonthlyUsage } from "@/hooks/useSubscription";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Loader2, Sparkles, BookOpen, Brain, Image, CheckCircle2, Upload, FileText, X, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

const STEPS = [
  { label: "Sobre o curso", icon: BookOpen },
  { label: "Módulos", icon: Brain },
  { label: "Opções", icon: Sparkles },
  { label: "Revisão", icon: CheckCircle2 },
];

const MAX_FILES = 3;
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
  const [uploading, setUploading] = useState(false);

  // Source mode
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

    try {
      const progressInterval = setInterval(() => {
        setGenerationProgress((prev) => Math.min(prev + 5, 85));
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

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <Button variant="ghost" onClick={() => navigate("/app/dashboard")} className="mb-6">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Voltar
      </Button>

      {/* Steps indicator */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2 flex-1">
            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
              i <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}>
              {i + 1}
            </div>
            <span className={`text-sm hidden sm:inline ${i <= step ? "text-foreground" : "text-muted-foreground"}`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < step ? "bg-primary" : "bg-border"}`} />}
          </div>
        ))}
      </div>

      {generating ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
            <h3 className="font-display text-xl font-semibold mb-2">Gerando seu curso...</h3>
            <p className="text-muted-foreground mb-6">
              {useSources
                ? "A IA está analisando suas fontes e criando o conteúdo. Isso pode levar alguns minutos."
                : "A IA está criando o conteúdo. Isso pode levar alguns segundos."}
            </p>
            <Progress value={generationProgress} className="max-w-sm mx-auto h-2" />
            <p className="text-xs text-muted-foreground mt-2">{generationProgress}%</p>
          </CardContent>
        </Card>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {step === 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="font-display">Sobre o curso</CardTitle>
                  <CardDescription>Defina o tema e público-alvo do seu curso</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Source mode toggle */}
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Upload className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-medium">Gerar a partir de fontes próprias</p>
                          <p className="text-sm text-muted-foreground">
                            {canUseSources
                              ? "O curso será baseado exclusivamente nos seus documentos"
                              : "Disponível apenas no plano Pro"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!canUseSources && <Badge variant="outline" className="text-xs">PRO</Badge>}
                        <Switch
                          checked={useSources}
                          onCheckedChange={setUseSources}
                          disabled={!canUseSources}
                        />
                      </div>
                    </div>

                    {/* Upload area */}
                    {useSources && (
                      <div className="space-y-3 pt-2 border-t">
                        <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md p-3">
                          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>O curso será gerado exclusivamente com base nos documentos enviados. A IA não adicionará conteúdo externo.</span>
                        </div>

                        {/* Uploaded files list */}
                        {uploadedSources.length > 0 && (
                          <div className="space-y-2">
                            {uploadedSources.map((source) => (
                              <div key={source.id} className="flex items-center justify-between bg-muted rounded-md px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <FileText className="h-4 w-4 text-primary" />
                                  <span className="text-sm font-medium truncate max-w-[200px]">{source.filename}</span>
                                  <span className="text-xs text-muted-foreground">{source.char_count.toLocaleString()} chars</span>
                                </div>
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeSource(source.id)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                            <div className="text-xs text-muted-foreground">
                              Total: {totalChars.toLocaleString()} / {MAX_TOTAL_CHARS.toLocaleString()} caracteres
                              {" · "}
                              {uploadedSources.length} / {MAX_FILES} arquivos
                            </div>
                          </div>
                        )}

                        {/* Upload button */}
                        {uploadedSources.length < MAX_FILES && (
                          <>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept=".pdf,.txt,.md"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleFileUpload(file);
                                e.target.value = "";
                              }}
                            />
                            <Button
                              variant="outline"
                              className="w-full"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={uploading}
                            >
                              {uploading ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Processando...
                                </>
                              ) : (
                                <>
                                  <Upload className="h-4 w-4 mr-2" />
                                  Enviar arquivo (PDF, TXT ou MD)
                                </>
                              )}
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Título do curso *</Label>
                    <Input placeholder="Ex: Introdução ao Marketing Digital" value={form.title} onChange={(e) => updateForm("title", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Tema / Assunto principal *</Label>
                    <Textarea placeholder="Descreva brevemente o tema do curso" value={form.theme} onChange={(e) => updateForm("theme", e.target.value)} rows={3} />
                  </div>
                  <div className="space-y-2">
                    <Label>Público-alvo</Label>
                    <Input placeholder="Ex: Iniciantes, estudantes universitários" value={form.targetAudience} onChange={(e) => updateForm("targetAudience", e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Tom</Label>
                      <Select value={form.tone} onValueChange={(v) => updateForm("tone", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="profissional">Profissional</SelectItem>
                          <SelectItem value="casual">Casual</SelectItem>
                          <SelectItem value="academico">Acadêmico</SelectItem>
                          <SelectItem value="divertido">Divertido</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Idioma</Label>
                      <Select value={form.language} onValueChange={(v) => updateForm("language", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pt-BR">Português (BR)</SelectItem>
                          <SelectItem value="en">English</SelectItem>
                          <SelectItem value="es">Español</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="font-display">Módulos</CardTitle>
                  <CardDescription>
                    Seu plano permite até {limits.maxModules} módulos por curso
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Número de módulos</Label>
                    <Select value={String(form.numModules)} onValueChange={(v) => updateForm("numModules", parseInt(v))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: limits.maxModules }, (_, i) => i + 1).map((n) => (
                          <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "módulo" : "módulos"}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 2 && (
              <Card>
                <CardHeader>
                  <CardTitle className="font-display">Opções extras</CardTitle>
                  <CardDescription>Escolha os recursos adicionais do seu curso</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Brain className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">Quizzes</p>
                        <p className="text-sm text-muted-foreground">Perguntas de múltipla escolha por módulo</p>
                      </div>
                    </div>
                    <Switch checked={form.includeQuiz} onCheckedChange={(v) => updateForm("includeQuiz", v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <BookOpen className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">Flashcards</p>
                        <p className="text-sm text-muted-foreground">Cartões de estudo para revisão</p>
                      </div>
                    </div>
                    <Switch checked={form.includeFlashcards} onCheckedChange={(v) => updateForm("includeFlashcards", v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Image className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">Imagens com IA</p>
                        <p className="text-sm text-muted-foreground">
                          {canUseImages ? "Gerar imagens ilustrativas" : "Disponível apenas no plano Pro"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!canUseImages && <Badge variant="outline" className="text-xs">PRO</Badge>}
                      <Switch
                        checked={form.includeImages}
                        onCheckedChange={(v) => updateForm("includeImages", v)}
                        disabled={!canUseImages}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 3 && (
              <Card>
                <CardHeader>
                  <CardTitle className="font-display">Revisão</CardTitle>
                  <CardDescription>Confirme as informações antes de gerar</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-muted rounded-lg p-4 space-y-3">
                    <div className="flex justify-between"><span className="text-muted-foreground">Título</span><span className="font-medium">{form.title}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Módulos</span><span className="font-medium">{form.numModules}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Idioma</span><span className="font-medium">{form.language}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tom</span><span className="font-medium capitalize">{form.tone}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Quizzes</span><span>{form.includeQuiz ? "✅" : "❌"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Flashcards</span><span>{form.includeFlashcards ? "✅" : "❌"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Imagens IA</span><span>{form.includeImages ? "✅" : "❌"}</span></div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fontes próprias</span>
                      <span>
                        {useSources
                          ? `✅ ${uploadedSources.length} arquivo(s)`
                          : "❌"}
                      </span>
                    </div>
                  </div>

                  {useSources && (
                    <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 text-sm">
                      <p className="font-medium text-primary mb-1">📄 Curso baseado em fontes próprias</p>
                      <p className="text-muted-foreground">
                        O conteúdo será gerado exclusivamente a partir dos {uploadedSources.length} documento(s) enviado(s)
                        ({totalChars.toLocaleString()} caracteres). A IA não adicionará informações externas.
                      </p>
                    </div>
                  )}

                  {!canCreate && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-center">
                      <p className="text-sm text-destructive font-medium">Limite mensal atingido. Faça upgrade para continuar.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Navigation */}
      {!generating && (
        <div className="flex justify-between mt-6">
          <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Button>
          {step < 3 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext()}>
              Próximo
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleGenerate} disabled={!canCreate || (useSources && uploadedSources.length === 0)}>
              <Sparkles className="h-4 w-4 mr-2" />
              {useSources ? "Gerar curso a partir das fontes" : "Gerar curso com IA"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
