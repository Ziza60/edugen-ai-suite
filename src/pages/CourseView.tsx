import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Eye, Edit3, Loader2, BookOpen, Brain, Award,
  RefreshCw, Layers, List, FileText, MessageSquare, BrainCircuit,
  Pencil, Share2, GraduationCap, CheckCircle2, XCircle
} from "lucide-react";
import { ExportButtons } from "@/components/course/ExportButtons";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMarkdownTableComponents } from "@/components/course/MarkdownTable";
import { motion } from "framer-motion";
import { useEffect, useState, useRef } from "react";
import { BlockEditor } from "@/components/course/BlockEditor";
import { CertificateDialog } from "@/components/course/CertificateDialog";
import { FlashcardsFlipView } from "@/components/course/FlashcardsFlipView";
import { FlashcardsListView } from "@/components/course/FlashcardsListView";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function CourseView() {
  const markdownTableComponents = useMarkdownTableComponents();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { plan } = useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeModuleIndex, setActiveModuleIndex] = useState(0);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [certDialogOpen, setCertDialogOpen] = useState(false);
  const [reprocessingFlashcards, setReprocessingFlashcards] = useState(false);
  const [restructuring, setRestructuring] = useState(false);
  const [validating, setValidating] = useState(false);
  const [qualityReport, setQualityReport] = useState<any>(null);
  const [flashcardView, setFlashcardView] = useState<"list" | "flip">("flip");
  const [flipEntitled, setFlipEntitled] = useState<boolean | null>(null);
  const [showFlashcardsModal, setShowFlashcardsModal] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizRevealed, setQuizRevealed] = useState<Record<string, boolean>>({});
  const contentRef = useRef<HTMLDivElement>(null);

  const isPro = plan === "pro";

  useEffect(() => {
    if (!isPro) {
      setFlipEntitled(false);
      setFlashcardView("list");
    }
  }, [isPro]);

  // Scroll content to top when active module changes
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeModuleIndex]);

  const { data: course, isLoading: loadingCourse } = useQuery({
    queryKey: ["course", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("courses").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: modules = [], isLoading: loadingModules } = useQuery({
    queryKey: ["course-modules", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_modules").select("*").eq("course_id", id!).order("order_index");
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: quizzes = [] } = useQuery({
    queryKey: ["course-quizzes", id],
    queryFn: async () => {
      const moduleIds = modules.map((m) => m.id);
      if (moduleIds.length === 0) return [];
      const { data, error } = await supabase
        .from("course_quiz_questions").select("*").in("module_id", moduleIds);
      if (error) throw error;
      return data;
    },
    enabled: modules.length > 0,
  });

  const { data: flashcards = [] } = useQuery({
    queryKey: ["course-flashcards", id],
    queryFn: async () => {
      const moduleIds = modules.map((m) => m.id);
      if (moduleIds.length === 0) return [];
      const { data, error } = await supabase
        .from("course_flashcards").select("*").in("module_id", moduleIds);
      if (error) throw error;
      return data;
    },
    enabled: modules.length > 0,
  });

  const { data: courseImages = [] } = useQuery({
    queryKey: ["course-images", id],
    queryFn: async () => {
      const moduleIds = modules.map((m) => m.id);
      if (moduleIds.length === 0) return [];
      const { data, error } = await supabase
        .from("course_images").select("*").in("module_id", moduleIds);
      if (error) throw error;
      return data;
    },
    enabled: modules.length > 0,
  });

  useQuery({
    queryKey: ["flip-entitlement", user?.id, plan],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.functions.invoke("check-entitlements", {
          body: { feature: "flashcards_flip" },
        });
        if (error || !data?.entitled) { setFlipEntitled(false); setFlashcardView("list"); return false; }
        setFlipEntitled(true);
        return true;
      } catch { setFlipEntitled(false); setFlashcardView("list"); return false; }
    },
    enabled: flashcards.length > 0 && isPro,
    retry: false,
  });

  const updateModule = useMutation({
    mutationFn: async ({ moduleId, content }: { moduleId: string; content: string }) => {
      const { error } = await supabase.from("course_modules").update({ content }).eq("id", moduleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course-modules", id] });
      setEditingModuleId(null);
      toast({ title: "Módulo atualizado!" });
    },
  });

  const togglePublish = useMutation({
    mutationFn: async () => {
      const newStatus = course?.status === "published" ? "draft" : "published";
      const { error } = await supabase.from("courses").update({ status: newStatus }).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course", id] });
      toast({ title: course?.status === "published" ? "Curso despublicado" : "Curso publicado!" });
    },
  });

  if (loadingCourse || loadingModules) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Curso não encontrado.</p>
        <Button variant="outline" onClick={() => navigate("/app/dashboard")} className="mt-4">Voltar</Button>
      </div>
    );
  }

  const activeModule = modules[activeModuleIndex];
  const isPublished = course.status === "published";
  const moduleQuizzes = activeModule ? quizzes.filter((q) => q.module_id === activeModule.id) : [];
  const moduleFlashcards = activeModule ? flashcards.filter((f) => f.module_id === activeModule.id) : [];
  const moduleImage = activeModule ? courseImages.find((img) => img.module_id === activeModule.id) : null;

  const features = [
    modules.length > 0 && `${modules.length} módulos`,
    quizzes.length > 0 && "quizzes",
    flashcards.length > 0 && "flashcards",
    "certificado",
  ].filter(Boolean);

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      {/* ═══════════ COURSE HEADER ═══════════ */}
      <div className="bg-card border-b border-border">
        <div className="max-w-[1400px] mx-auto px-6 py-5">
          <div className="flex items-center gap-3 mb-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/app/dashboard")} className="shrink-0 -ml-2">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Dashboard
            </Button>
            <div className="h-5 w-px bg-border" />
            <Badge
              variant={isPublished ? "default" : "outline"}
              className={isPublished ? "bg-secondary/15 text-secondary border-secondary/30 hover:bg-secondary/20" : ""}
            >
              {isPublished ? "✓ Publicado" : "Rascunho"}
            </Badge>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl lg:text-3xl font-bold text-foreground">{course.title}</h1>
              {course.description && (
                <p className="text-muted-foreground mt-1 text-sm max-w-2xl">{course.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {features.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/60 rounded-md px-2 py-1">
                    {f}
                  </span>
                ))}
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium ml-1">{course.language}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button
                variant={isPublished ? "outline" : "default"}
                size="sm"
                onClick={() => togglePublish.mutate()}
                className="h-9"
              >
                <Eye className="h-4 w-4 mr-1.5" />
                {isPublished ? "Despublicar" : "Publicar"}
              </Button>
              <ExportButtons
                courseId={id!}
                courseTitle={course.title}
                courseStatus={course.status}
                isPro={isPro}
                modules={modules}
              />
              <Button variant="outline" size="sm" onClick={() => setCertDialogOpen(true)} className="h-9">
                <GraduationCap className="h-4 w-4 mr-1.5" />
                Certificado
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                disabled={validating}
                onClick={async () => {
                  setValidating(true);
                  try {
                    const { data, error } = await supabase.functions.invoke("restructure-modules", {
                      body: { course_id: id, validate_only: true },
                    });
                    if (error) throw error;
                    setQualityReport(data?.markdown_quality_report || null);
                    console.log("[Quality Report]", JSON.stringify(data?.markdown_quality_report, null, 2));
                    const summary = data?.markdown_quality_report?.summary;
                    toast({
                      title: `Validação: ${summary?.modules_passed || 0}/${summary?.modules_passed + summary?.modules_failed || 0} PASS`,
                      description: summary?.recommendation || "Checklist concluído.",
                      variant: summary?.modules_failed > 0 ? "destructive" : "default",
                    });
                  } catch (err: any) {
                    toast({ title: "Erro na validação", description: err.message, variant: "destructive" });
                  } finally {
                    setValidating(false);
                  }
                }}
              >
                {validating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <FileText className="h-4 w-4 mr-1.5" />}
                Validar
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                disabled={restructuring}
                onClick={async () => {
                  setRestructuring(true);
                  try {
                    const { data, error } = await supabase.functions.invoke("restructure-modules", {
                      body: { course_id: id },
                    });
                    if (error) throw error;
                    setQualityReport(data?.markdown_quality_report || null);
                    console.log("[Quality Report]", JSON.stringify(data?.markdown_quality_report, null, 2));
                    toast({
                      title: "Módulos reestruturados!",
                      description: data?.message || "Conteúdo padronizado com sucesso.",
                    });
                    queryClient.invalidateQueries({ queryKey: ["course-modules", id] });
                  } catch (err: any) {
                    toast({ title: "Erro ao reestruturar", description: err.message, variant: "destructive" });
                  } finally {
                    setRestructuring(false);
                  }
                }}
              >
                {restructuring ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                Padronizar
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ QUALITY REPORT PANEL ═══════════ */}
      {qualityReport && (
        <div className="max-w-[1400px] mx-auto w-full px-6 py-4 border-b border-border bg-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Relatório de Qualidade — {qualityReport.course_title}
            </h3>
            <div className="flex items-center gap-3">
              <Badge variant={qualityReport.summary.modules_failed === 0 ? "default" : "destructive"}>
                {qualityReport.summary.modules_passed}/{qualityReport.modules_checked} PASS
              </Badge>
              <Button variant="ghost" size="sm" onClick={() => setQualityReport(null)} className="h-7 text-xs">
                <XCircle className="h-3.5 w-3.5 mr-1" /> Fechar
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {qualityReport.results.map((r: any) => (
              <div
                key={r.module}
                className={`rounded-lg border p-3 text-xs ${
                  r.status === "PASS"
                    ? "border-secondary/30 bg-secondary/5"
                    : "border-destructive/30 bg-destructive/5"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-foreground">Módulo {r.module}</span>
                  {r.status === "PASS" ? (
                    <CheckCircle2 className="h-4 w-4 text-secondary" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                </div>
                <p className="text-muted-foreground truncate mb-1">{r.title}</p>
                {r.errors && r.errors.length > 0 && (
                  <ul className="space-y-0.5 text-destructive/80">
                    {r.errors.slice(0, 3).map((e: string, idx: number) => (
                      <li key={idx} className="truncate">• {e}</li>
                    ))}
                    {r.errors.length > 3 && <li className="text-muted-foreground">+{r.errors.length - 3} mais...</li>}
                  </ul>
                )}
                {r.status === "PASS" && <p className="text-secondary">Todos os critérios OK</p>}
              </div>
            ))}
          </div>
          {qualityReport.summary.critical_errors.length > 0 && (
            <div className="mt-3 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
              <strong>Erros críticos:</strong> {qualityReport.summary.critical_errors.join(" · ")}
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground italic">{qualityReport.summary.recommendation}</p>
        </div>
      )}

      {/* ═══════════ TWO-PANEL LAYOUT ═══════════ */}
      <div className="flex-1 flex max-w-[1400px] mx-auto w-full">
        {/* ── Left: Module sidebar ── */}
        <aside className="hidden lg:block w-72 border-r border-border bg-card shrink-0">
          <ScrollArea className="h-[calc(100vh-160px)] sticky top-0">
            <div className="p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
                Módulos ({modules.length})
              </p>
              <nav className="space-y-1">
                {modules.map((mod, i) => (
                  <button
                    key={mod.id}
                    onClick={() => setActiveModuleIndex(i)}
                    className={`w-full text-left rounded-xl px-3 py-2.5 text-sm transition-all flex items-start gap-3 ${
                      i === activeModuleIndex
                        ? "bg-primary/10 text-primary font-semibold border border-primary/20"
                        : "text-foreground/70 hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <span className={`shrink-0 h-6 w-6 rounded-md flex items-center justify-center text-xs font-bold mt-0.5 ${
                      i === activeModuleIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}>
                      {i + 1}
                    </span>
                    <span className="line-clamp-2 leading-snug">{mod.title}</span>
                  </button>
                ))}
              </nav>
            </div>
          </ScrollArea>
        </aside>

        {/* ── Mobile module selector ── */}
        <div className="lg:hidden sticky top-0 z-10 bg-card border-b border-border px-4 py-2 overflow-x-auto">
          <div className="flex gap-2">
            {modules.map((mod, i) => (
              <button
                key={mod.id}
                onClick={() => setActiveModuleIndex(i)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  i === activeModuleIndex
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {i + 1}. {mod.title.length > 20 ? mod.title.slice(0, 20) + "…" : mod.title}
              </button>
            ))}
          </div>
        </div>

        {/* ── Right: Content area ── */}
        <div ref={contentRef} className="flex-1 overflow-y-auto">
          {activeModule ? (
            <div className="px-6 lg:px-10 py-8 max-w-[760px]">
              {/* Module header */}
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
                    Módulo {activeModuleIndex + 1} de {modules.length}
                  </p>
                  <h2 className="font-display text-2xl font-bold text-foreground">{activeModule.title}</h2>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 h-9"
                  onClick={() => {
                    if (editingModuleId === activeModule.id) {
                      updateModule.mutate({ moduleId: activeModule.id, content: editContent });
                    } else {
                      setEditingModuleId(activeModule.id);
                      setEditContent(activeModule.content || "");
                    }
                  }}
                >
                  {editingModuleId === activeModule.id ? (
                    <><CheckCircle2 className="h-4 w-4 mr-1.5" />Salvar</>
                  ) : (
                    <><Pencil className="h-4 w-4 mr-1.5" />Editar</>
                  )}
                </Button>
              </div>

              {/* Module content */}
              {editingModuleId === activeModule.id ? (
                <div className="space-y-3">
                  <BlockEditor
                    content={editContent}
                    onChange={(md) => setEditContent(md)}
                    isPro={isPro}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => updateModule.mutate({ moduleId: activeModule.id, content: editContent })}>
                      Salvar alterações
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingModuleId(null)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  {moduleImage && (
                    <div className="mb-6 rounded-xl overflow-hidden border border-border relative">
                      <img
                        src={moduleImage.url}
                        alt={moduleImage.alt_text || `Ilustração do módulo ${activeModuleIndex + 1}`}
                        className="w-full h-auto object-cover max-h-[360px]"
                        loading="lazy"
                      />
                      {/* Text overlay — all visible text is real HTML, never baked into the image */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent flex flex-col justify-end p-6">
                        <p className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-1">
                          Módulo {activeModuleIndex + 1}
                        </p>
                        <h3 className="text-xl lg:text-2xl font-bold text-white font-display leading-tight drop-shadow-md">
                          {activeModule.title}
                        </h3>
                      </div>
                    </div>
                  )}
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-display prose-headings:font-bold prose-p:leading-relaxed prose-li:leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownTableComponents}>
                      {activeModule.content || "*Sem conteúdo ainda*"}
                    </ReactMarkdown>
                  </div>
                </div>
              )}

              {/* ── Module navigation ── */}
              <div className="flex items-center justify-between mt-10 pt-6 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={activeModuleIndex === 0}
                  onClick={() => setActiveModuleIndex((i) => i - 1)}
                >
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  Anterior
                </Button>
                <span className="text-xs text-muted-foreground">
                  {activeModuleIndex + 1} / {modules.length}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={activeModuleIndex === modules.length - 1}
                  onClick={() => setActiveModuleIndex((i) => i + 1)}
                >
                  Próximo
                  <ArrowLeft className="h-4 w-4 ml-1.5 rotate-180" />
                </Button>
              </div>

              {/* ═══════════ QUIZZES SECTION ═══════════ */}
              {moduleQuizzes.length > 0 && (
                <div className="mt-10 pt-8 border-t border-border">
                  <div className="flex items-center gap-2 mb-5">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <MessageSquare className="h-4 w-4 text-primary" />
                    </div>
                    <h3 className="font-display text-lg font-bold text-foreground">
                      Quiz — Módulo {activeModuleIndex + 1}
                    </h3>
                    <Badge variant="secondary" className="text-xs">{moduleQuizzes.length} perguntas</Badge>
                  </div>

                  <div className="space-y-4">
                    {moduleQuizzes.map((q, qi) => {
                      const answered = quizAnswers[q.id] !== undefined;
                      const revealed = quizRevealed[q.id];
                      const selectedAnswer = quizAnswers[q.id];

                      return (
                        <Card key={q.id} className="rounded-xl border-border overflow-hidden">
                          <CardContent className="p-5">
                            <p className="font-semibold text-sm mb-4">
                              <span className="text-muted-foreground mr-1.5">{qi + 1}.</span>
                              {q.question}
                            </p>
                            <div className="space-y-2">
                              {(q.options as string[])?.map((opt: string, j: number) => {
                                const isCorrect = j === q.correct_answer;
                                const isSelected = selectedAnswer === j;
                                let optionClass = "bg-muted/50 hover:bg-muted border border-transparent cursor-pointer";

                                if (revealed) {
                                  if (isCorrect) {
                                    optionClass = "bg-secondary/10 border border-secondary/30 text-secondary";
                                  } else if (isSelected && !isCorrect) {
                                    optionClass = "bg-destructive/10 border border-destructive/30 text-destructive";
                                  } else {
                                    optionClass = "bg-muted/30 border border-transparent text-muted-foreground";
                                  }
                                } else if (isSelected) {
                                  optionClass = "bg-primary/10 border border-primary/30 text-primary";
                                }

                                return (
                                  <button
                                    key={j}
                                    onClick={() => {
                                      if (!revealed) {
                                        setQuizAnswers((prev) => ({ ...prev, [q.id]: j }));
                                      }
                                    }}
                                    className={`w-full text-left p-3 rounded-lg text-sm transition-all flex items-center gap-3 ${optionClass}`}
                                  >
                                    <span className="shrink-0 h-6 w-6 rounded-md bg-background/60 flex items-center justify-center text-xs font-bold">
                                      {String.fromCharCode(65 + j)}
                                    </span>
                                    <span className="flex-1">{opt}</span>
                                    {revealed && isCorrect && <CheckCircle2 className="h-4 w-4 text-secondary shrink-0" />}
                                    {revealed && isSelected && !isCorrect && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>

                            {answered && !revealed && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="mt-3"
                                onClick={() => setQuizRevealed((prev) => ({ ...prev, [q.id]: true }))}
                              >
                                Verificar resposta
                              </Button>
                            )}

                            {revealed && q.explanation && (
                              <motion.div
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="mt-4 bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground"
                              >
                                <strong className="text-foreground">Explicação:</strong> {q.explanation}
                              </motion.div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ═══════════ FLASHCARDS ═══════════ */}
              {moduleFlashcards.length > 0 && (
                <div className="mt-10 pt-8 border-t border-border">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center">
                        <BrainCircuit className="h-4 w-4 text-accent" />
                      </div>
                      <h3 className="font-display text-lg font-bold text-foreground">
                        Flashcards de revisão
                      </h3>
                      <Badge variant="secondary" className="text-xs">{moduleFlashcards.length} cards</Badge>
                    </div>
                  </div>

                  {isPro && flipEntitled ? (
                    /* PRO: render FlipView directly inline — no static cards, no modal button */
                    <div className="rounded-xl border border-border bg-card p-4 min-h-[320px]">
                      <FlashcardsFlipView flashcards={moduleFlashcards} />
                    </div>
                  ) : (
                    /* FREE: static preview + button to open modal */
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                        {moduleFlashcards.slice(0, 4).map((fc) => (
                          <div key={fc.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                            <p className="text-xs font-semibold text-primary uppercase tracking-wider">Frente</p>
                            <p className="text-sm font-medium text-foreground leading-snug">{fc.front}</p>
                            <div className="border-t border-border/60 pt-2">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Verso</p>
                              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{fc.back}</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      {moduleFlashcards.length > 4 && (
                        <p className="text-xs text-muted-foreground mb-3">
                          +{moduleFlashcards.length - 4} flashcards adicionais
                        </p>
                      )}

                      <Button
                        variant="outline"
                        onClick={() => setShowFlashcardsModal(true)}
                        className="w-full sm:w-auto"
                      >
                        <Layers className="h-4 w-4 mr-2" />
                        Abrir modo interativo
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              Selecione um módulo para visualizar
            </div>
          )}
        </div>
      </div>

      {/* ═══════════ FLASHCARDS MODAL ═══════════ */}
      {showFlashcardsModal && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-display text-lg font-bold">Flashcards — Módulo {activeModuleIndex + 1}</h3>
              <div className="flex items-center gap-2">
                {flipEntitled && (
                  <>
                    <Button variant={flashcardView === "flip" ? "default" : "outline"} size="sm" onClick={() => setFlashcardView("flip")}>
                      <Layers className="h-4 w-4 mr-1" /> Flip
                    </Button>
                    <Button variant={flashcardView === "list" ? "default" : "outline"} size="sm" onClick={() => setFlashcardView("list")}>
                      <List className="h-4 w-4 mr-1" /> Lista
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={reprocessingFlashcards}
                  onClick={async () => {
                    setReprocessingFlashcards(true);
                    try {
                      const { data, error } = await supabase.functions.invoke("reprocess-flashcards", { body: { course_id: id } });
                      if (error) throw error;
                      queryClient.invalidateQueries({ queryKey: ["course-flashcards", id] });
                      toast({ title: "Flashcards reprocessados!", description: `${data.updated} de ${data.total} atualizados.` });
                    } catch (err: any) {
                      toast({ title: "Erro ao reprocessar", description: err.message, variant: "destructive" });
                    } finally {
                      setReprocessingFlashcards(false);
                    }
                  }}
                >
                  {reprocessingFlashcards ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowFlashcardsModal(false)}>
                  ✕
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {flashcardView === "flip" && flipEntitled ? (
                <FlashcardsFlipView flashcards={moduleFlashcards.length > 0 ? moduleFlashcards : flashcards} />
              ) : (
                <FlashcardsListView flashcards={moduleFlashcards.length > 0 ? moduleFlashcards : flashcards} showUpsell={!flipEntitled} />
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Certificate Dialog */}
      <CertificateDialog
        open={certDialogOpen}
        onOpenChange={setCertDialogOpen}
        courseId={id!}
        courseTitle={course.title}
        courseStatus={course.status}
      />
    </div>
  );
}
