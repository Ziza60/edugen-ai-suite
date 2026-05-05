import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useDevMode } from "@/hooks/useDevMode";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Eye, Edit3, Loader2, BookOpen, Brain, Award,
  RefreshCw, Layers, List, FileText, MessageSquare, BrainCircuit,
  Pencil, Share2, GraduationCap, CheckCircle2, XCircle, Copy, Link2,
  BarChart3, Globe, Rocket, Languages, Save, Cloud, CloudOff,
  Mic, ChevronDown, Wrench, ShieldCheck, AlignLeft, Sparkles, WandSparkles,
} from "lucide-react";
import { PexelsPicker } from "@/components/course/PexelsPicker";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { ExportButtons } from "@/components/course/ExportButtons";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMarkdownTableComponents } from "@/components/course/MarkdownTable";
import { motion } from "framer-motion";
import { useEffect, useState, useRef, useCallback } from "react";
import { BlockEditor } from "@/components/course/BlockEditor";
import { CertificateDialog } from "@/components/course/CertificateDialog";
import { ScriptGeneratorButton } from "@/components/course/ScriptGeneratorButton";
import { FlashcardsFlipView } from "@/components/course/FlashcardsFlipView";
import { FlashcardsListView } from "@/components/course/FlashcardsListView";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EduScorePanel } from "@/components/course/EduScorePanel";
import { TranslateDialog } from "@/components/course/TranslateDialog";
import { ReviewPanel } from "@/components/course/ReviewPanel";
import { ModuleSidebar } from "@/components/course/ModuleSidebar";
import { RestructureDiffDialog } from "@/components/course/RestructureDiffDialog";

export default function CourseView() {
  const markdownTableComponents = useMarkdownTableComponents();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { plan } = useSubscription();
  const { isDev } = useDevMode();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeModuleIndex, setActiveModuleIndex] = useState(0);
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [certDialogOpen, setCertDialogOpen] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [reprocessingFlashcards, setReprocessingFlashcards] = useState(false);
  const [restructuring, setRestructuring] = useState(false);
  const [validating, setValidating] = useState(false);
  const [qualityReport, setQualityReport] = useState<any>(null);
  const [flashcardView, setFlashcardView] = useState<"list" | "flip">("flip");
  const [flipEntitled, setFlipEntitled] = useState<boolean | null>(null);
  const [showFlashcardsModal, setShowFlashcardsModal] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizRevealed, setQuizRevealed] = useState<Record<string, boolean>>({});
  const [togglingTutor, setTogglingTutor] = useState(false);
  const [eduScore, setEduScore] = useState<any>(null);
  const [calculatingScore, setCalculatingScore] = useState(false);
  const [generatingLanding, setGeneratingLanding] = useState(false);
  const [translateOpen, setTranslateOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // ── Auto-save state ──
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // ── Restructure diff state ──
  const [diffDialogOpen, setDiffDialogOpen] = useState(false);
  const [restructuredModules, setRestructuredModules] = useState<any[]>([]);
  const [applyingRestructure, setApplyingRestructure] = useState(false);

  const isPro = plan === "pro" || isDev;
  const isStarter = plan === "starter";

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

  // Tutor stats: questions in last 7 days
  const { data: tutorStats } = useQuery({
    queryKey: ["tutor-stats", id],
    queryFn: async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count, error } = await (supabase
        .from("tutor_sessions") as any)
        .select("id", { count: "exact", head: true })
        .eq("course_id", id!)
        .gte("created_at", sevenDaysAgo);
      if (error) return 0;
      return count || 0;
    },
    enabled: !!id && !!(course as any)?.tutor_enabled,
  });

  // Landing page data
  const { data: landing, refetch: refetchLanding } = useQuery({
    queryKey: ["course-landing", id],
    queryFn: async () => {
      const { data, error } = await (supabase.from("course_landings") as any)
        .select("*")
        .eq("course_id", id!)
        .single();
      if (error) return null;
      return data;
    },
    enabled: !!id,
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

  const saveModuleImage = useMutation({
    mutationFn: async ({ moduleId, url, altText }: { moduleId: string; url: string; altText: string }) => {
      const { error } = await supabase.from("course_images").upsert(
        { module_id: moduleId, url, alt_text: altText },
        { onConflict: "module_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course-images", id] });
      toast({ title: "Imagem salva!" });
    },
    onError: () => toast({ title: "Erro ao salvar imagem", variant: "destructive" }),
  });

  const removeModuleImage = useMutation({
    mutationFn: async (moduleId: string) => {
      const { error } = await supabase.from("course_images").delete().eq("module_id", moduleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course-images", id] });
      toast({ title: "Imagem removida" });
    },
    onError: () => toast({ title: "Erro ao remover imagem", variant: "destructive" }),
  });

  const updateModule = useMutation({
    mutationFn: async ({ moduleId, content, title }: { moduleId: string; content: string; title?: string }) => {
      const patch: Record<string, string> = { content };
      if (title && title.trim()) patch.title = title.trim();
      const { error } = await supabase.from("course_modules").update(patch).eq("id", moduleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["course-modules", id] });
      setEditingModuleId(null);
      setSaveStatus("saved");
      setLastSavedAt(new Date());
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

  // ── Auto-save handler ──
  const handleContentChange = useCallback((newContent: string) => {
    setEditContent(newContent);
    setSaveStatus("unsaved");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const activeModule = modules[activeModuleIndex];
      if (!activeModule || !editingModuleId) return;
      setSaveStatus("saving");
      try {
        const { error } = await supabase.from("course_modules")
          .update({ content: newContent })
          .eq("id", activeModule.id);
        if (error) throw error;
        setSaveStatus("saved");
        setLastSavedAt(new Date());
        queryClient.invalidateQueries({ queryKey: ["course-modules", id] });
      } catch {
        setSaveStatus("unsaved");
      }
    }, 3000);
  }, [modules, activeModuleIndex, editingModuleId, id, queryClient]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => clearTimeout(saveTimerRef.current);
  }, []);

  // ── Restructure with diff preview ──
  const handleRestructureWithDiff = async () => {
    setRestructuring(true);
    try {
      const { data, error } = await supabase.functions.invoke("restructure-modules", {
        body: { course_id: id },
      });
      if (error) throw error;

      // Store restructured data for diff preview
      if (data?.restructured_modules) {
        setRestructuredModules(data.restructured_modules);
      } else {
        // Fallback: refetch after save
        setQualityReport(data?.markdown_quality_report || null);
        toast({
          title: "Módulos reestruturados!",
          description: data?.message || "Conteúdo padronizado com sucesso.",
        });
        queryClient.invalidateQueries({ queryKey: ["course-modules", id] });
        setRestructuring(false);
        return;
      }

      setQualityReport(data?.markdown_quality_report || null);
      setDiffDialogOpen(true);
    } catch (err: any) {
      toast({ title: "Erro ao reestruturar", description: err.message, variant: "destructive" });
    } finally {
      setRestructuring(false);
    }
  };

  const handleApplyRestructure = async () => {
    setApplyingRestructure(true);
    try {
      await Promise.all(
        restructuredModules.map((mod: any) =>
          supabase.from("course_modules").update({ content: mod.content }).eq("id", mod.id)
        )
      );
      queryClient.invalidateQueries({ queryKey: ["course-modules", id] });
      toast({ title: "Módulos reestruturados!", description: "Mudanças aplicadas com sucesso." });
      setDiffDialogOpen(false);
    } catch (err: any) {
      toast({ title: "Erro ao aplicar", description: err.message, variant: "destructive" });
    } finally {
      setApplyingRestructure(false);
    }
  };

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

  const saveStatusLabel = saveStatus === "saved"
    ? lastSavedAt
      ? `Salvo há ${Math.max(1, Math.round((Date.now() - lastSavedAt.getTime()) / 1000))}s`
      : "Salvo"
    : saveStatus === "saving"
    ? "Salvando..."
    : "Alterações não salvas";

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

            <div className="flex items-center gap-2 shrink-0">
              {/* Primary actions */}
              <Button
                variant={isPublished ? "outline" : "default"}
                size="sm"
                onClick={() => togglePublish.mutate()}
                className="h-9"
                data-testid="btn-publish"
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
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => navigate(`/app/courses/${id}/landing-page`)}
                data-testid="btn-landing-page"
              >
                <Globe className="h-4 w-4 mr-1.5" />
                Landing Page
              </Button>

              {/* Tools dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9" data-testid="btn-ferramentas">
                    <Wrench className="h-4 w-4 mr-1.5" />
                    Ferramentas
                    <ChevronDown className="h-3.5 w-3.5 ml-1.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {/* Script */}
                  <DropdownMenuItem
                    disabled={!isPublished}
                    onSelect={() => setScriptOpen(true)}
                    data-testid="menu-script"
                  >
                    <div className="flex items-start gap-3 py-0.5">
                      <Mic className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <div>
                        <div className="flex items-center gap-1.5 font-medium text-sm">
                          Script de narração
                          {!isPro && <Badge variant="outline" className="text-[10px] px-1 py-0">PRO</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">Roteiro para gravar videoaulas</p>
                      </div>
                    </div>
                  </DropdownMenuItem>

                  {/* Certificate */}
                  <DropdownMenuItem onSelect={() => setCertDialogOpen(true)} data-testid="menu-certificate">
                    <div className="flex items-start gap-3 py-0.5">
                      <GraduationCap className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">Certificado</p>
                        <p className="text-xs text-muted-foreground">Personalizar o certificado do curso</p>
                      </div>
                    </div>
                  </DropdownMenuItem>

                  {/* Translate */}
                  <DropdownMenuItem
                    disabled={modules.length === 0}
                    onSelect={() => setTranslateOpen(true)}
                    data-testid="menu-translate"
                  >
                    <div className="flex items-start gap-3 py-0.5">
                      <Languages className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">Traduzir curso</p>
                        <p className="text-xs text-muted-foreground">Traduz todos os módulos para outro idioma</p>
                      </div>
                    </div>
                  </DropdownMenuItem>

                  {/* EduScore */}
                  <DropdownMenuItem
                    disabled={calculatingScore || modules.length === 0}
                    onSelect={async () => {
                      setCalculatingScore(true);
                      try {
                        const { data, error } = await supabase.functions.invoke("calculate-eduscore", {
                          body: { course_id: id },
                        });
                        if (error) throw error;
                        setEduScore(data);
                      } catch (err: any) {
                        toast({ title: "Erro ao calcular EduScore", description: err.message, variant: "destructive" });
                      } finally {
                        setCalculatingScore(false);
                      }
                    }}
                    data-testid="menu-eduscore"
                  >
                    <div className="flex items-start gap-3 py-0.5">
                      {calculatingScore
                        ? <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin text-muted-foreground" />
                        : <BarChart3 className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
                      <div>
                        <p className="font-medium text-sm">EduScore™</p>
                        <p className="text-xs text-muted-foreground">Avalia a qualidade pedagógica do curso</p>
                      </div>
                    </div>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  {/* Verificar qualidade (was "Validar") */}
                  <DropdownMenuItem
                    disabled={validating || modules.length === 0}
                    onSelect={async () => {
                      setValidating(true);
                      try {
                        const { data, error } = await supabase.functions.invoke("restructure-modules", {
                          body: { course_id: id, validate_only: true },
                        });
                        if (error) throw error;
                        setQualityReport(data?.markdown_quality_report || null);
                        const summary = data?.markdown_quality_report?.summary;
                        toast({
                          title: `Qualidade: ${summary?.modules_passed || 0}/${(summary?.modules_passed || 0) + (summary?.modules_failed || 0)} módulos OK`,
                          description: summary?.recommendation || "Checklist concluído.",
                          variant: summary?.modules_failed > 0 ? "destructive" : "default",
                        });
                      } catch (err: any) {
                        toast({ title: "Erro na verificação", description: err.message, variant: "destructive" });
                      } finally {
                        setValidating(false);
                      }
                    }}
                    data-testid="menu-validate"
                  >
                    <div className="flex items-start gap-3 py-0.5">
                      {validating
                        ? <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin text-muted-foreground" />
                        : <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
                      <div>
                        <p className="font-medium text-sm">Verificar qualidade</p>
                        <p className="text-xs text-muted-foreground">Checa se o conteúdo segue padrões pedagógicos</p>
                      </div>
                    </div>
                  </DropdownMenuItem>

                  {/* Reformatar conteúdo (was "Padronizar") */}
                  <DropdownMenuItem
                    disabled={restructuring || modules.length === 0}
                    onSelect={handleRestructureWithDiff}
                    data-testid="menu-restructure"
                  >
                    <div className="flex items-start gap-3 py-0.5">
                      {restructuring
                        ? <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin text-muted-foreground" />
                        : <AlignLeft className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
                      <div>
                        <p className="font-medium text-sm">Reformatar conteúdo</p>
                        <p className="text-xs text-muted-foreground">Padroniza títulos, listas e formatação dos módulos</p>
                      </div>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Script dialog (no trigger — opened via dropdown) */}
              <ScriptGeneratorButton
                courseId={id!}
                courseTitle={course.title}
                isPro={isPro}
                disabled={!isPublished}
                open={scriptOpen}
                onOpenChange={setScriptOpen}
                renderTrigger={false}
              />
            </div>
          </div>

          {/* ── Tutor IA Toggle ── */}
          {isPublished && (
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-3">
                <Switch
                  checked={!!(course as any)?.tutor_enabled}
                  disabled={togglingTutor}
                  onCheckedChange={async (enabled) => {
                    setTogglingTutor(true);
                    try {
                      const updates: any = { tutor_enabled: enabled };
                      if (enabled && !(course as any)?.tutor_slug) {
                        updates.tutor_slug = id!.slice(0, 8);
                      }
                      const { error } = await (supabase.from("courses") as any)
                        .update(updates)
                        .eq("id", id!);
                      if (error) throw error;
                      queryClient.invalidateQueries({ queryKey: ["course", id] });
                      toast({
                        title: enabled ? "Tutor IA ativado!" : "Tutor IA desativado",
                        description: enabled
                          ? "Alunos podem acessar o tutor pelo link público."
                          : "O link público do tutor foi desativado.",
                      });
                    } catch (err: any) {
                      toast({ title: "Erro", description: err.message, variant: "destructive" });
                    } finally {
                      setTogglingTutor(false);
                    }
                  }}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <BrainCircuit className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground">Tutor IA</span>
                    <Badge variant="outline" className="text-[10px]">PRO</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Alunos consultam a IA sobre o conteúdo do curso
                  </p>
                </div>
              </div>

              {(course as any)?.tutor_enabled && (course as any)?.tutor_slug && (
                <div className="ml-auto flex items-center gap-3">
                  {typeof tutorStats === "number" && (
                    <span className="text-xs text-muted-foreground">
                      <MessageSquare className="h-3 w-3 inline mr-1" />
                      {tutorStats} pergunta{tutorStats !== 1 ? "s" : ""} nos últimos 7 dias
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      const url = `${window.location.origin}/tutor/${(course as any).tutor_slug}`;
                      navigator.clipboard.writeText(url);
                      toast({ title: "Link copiado!", description: url });
                    }}
                  >
                    <Copy className="h-3 w-3 mr-1.5" />
                    Copiar link
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      window.open(`/tutor/${(course as any).tutor_slug}`, "_blank");
                    }}
                  >
                    <Link2 className="h-3 w-3 mr-1.5" />
                    Abrir
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Landing Page Controls ── */}
          {isPublished && (
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-3">
                <Globe className="h-5 w-5 text-primary" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">Landing Page</span>
                    {landing && (
                      <Badge variant={landing.is_published ? "default" : "outline"} className="text-[10px]">
                        {landing.is_published ? "Publicada" : "Rascunho"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {landing ? "Página de vendas gerada por IA" : "Gere uma página de vendas com IA"}
                  </p>
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={generatingLanding || modules.length === 0}
                  onClick={async () => {
                    setGeneratingLanding(true);
                    try {
                      const { data, error } = await supabase.functions.invoke("generate-landing", {
                        body: { course_id: id },
                      });
                      if (error) throw error;
                      refetchLanding();
                      toast({
                        title: "Landing page gerada!",
                        description: "O copy foi criado por IA a partir do conteúdo do curso.",
                      });
                    } catch (err: any) {
                      toast({ title: "Erro ao gerar landing", description: err.message, variant: "destructive" });
                    } finally {
                      setGeneratingLanding(false);
                    }
                  }}
                >
                  {generatingLanding ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Rocket className="h-3 w-3 mr-1.5" />}
                  {landing ? "Regenerar" : "Gerar Landing"}
                </Button>

                {landing && (
                  <>
                    <Switch
                      checked={!!landing.is_published}
                      onCheckedChange={async (pub) => {
                        try {
                          const { error } = await (supabase.from("course_landings") as any)
                            .update({ is_published: pub })
                            .eq("id", landing.id);
                          if (error) throw error;
                          refetchLanding();
                          toast({ title: pub ? "Landing publicada!" : "Landing despublicada" });
                        } catch (err: any) {
                          toast({ title: "Erro", description: err.message, variant: "destructive" });
                        }
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => {
                        const url = `${window.location.origin}/c/${landing.slug}`;
                        navigator.clipboard.writeText(url);
                        toast({ title: "Link copiado!", description: url });
                      }}
                    >
                      <Copy className="h-3 w-3 mr-1.5" />
                      Copiar link
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => window.open(`/c/${landing.slug}`, "_blank")}
                    >
                      <Link2 className="h-3 w-3 mr-1.5" />
                      Abrir
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Portal do Aluno ── */}
          {isPublished && landing?.slug && (
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-3">
                <GraduationCap className="h-5 w-5 text-primary" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">Portal do Aluno</span>
                    <Badge variant="outline" className="text-[10px] border-green-500/40 text-green-600 dark:text-green-400">Público</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Link gratuito — módulos, flashcards, quizzes e certificado
                  </p>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <code className="hidden sm:block text-xs text-muted-foreground bg-muted/60 px-2 py-1 rounded-md font-mono">
                  /learn/{landing.slug}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    const url = `${window.location.origin}/learn/${landing.slug}`;
                    navigator.clipboard.writeText(url);
                    toast({ title: "Link do portal copiado!", description: url });
                  }}
                  data-testid="copy-portal-link"
                >
                  <Copy className="h-3 w-3 mr-1.5" />
                  Copiar link
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => window.open(`/learn/${landing.slug}`, "_blank")}
                  data-testid="open-portal-link"
                >
                  <Link2 className="h-3 w-3 mr-1.5" />
                  Abrir portal
                </Button>
              </div>
            </div>
          )}

          {/* ── Review Panel ── */}
          <ReviewPanel courseId={id!} isPublished={isPublished} />
        </div>
      </div>

      {/* ═══════════ EDUSCORE PANEL ═══════════ */}
      {eduScore && (
        <EduScorePanel data={eduScore} onClose={() => setEduScore(null)} />
      )}

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
        {/* ── Left: Module sidebar with DnD ── */}
        <aside className="hidden lg:block w-72 border-r border-border bg-card shrink-0">
          <ScrollArea className="h-[calc(100vh-160px)] sticky top-0">
            <div className="p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
                Módulos ({modules.length})
              </p>
              <ModuleSidebar
                modules={modules as any}
                activeModuleIndex={activeModuleIndex}
                onSelectModule={setActiveModuleIndex}
                courseId={id!}
              />
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
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
                    Módulo {activeModuleIndex + 1} de {modules.length}
                  </p>
                  {editingModuleId === activeModule.id ? (
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="font-display text-xl font-bold h-auto py-1.5 px-2 border-primary/40 focus-visible:ring-primary/30"
                      placeholder="Título do módulo"
                      data-testid="input-module-title"
                    />
                  ) : (
                    <h2 className="font-display text-2xl font-bold text-foreground">{activeModule.title}</h2>
                  )}
                  {/* Summary preview — first plain paragraph of content */}
                  {editingModuleId !== activeModule.id && (() => {
                    const firstPara = (activeModule.content || "")
                      .split("\n")
                      .find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("-") && !l.startsWith("*") && !l.startsWith(">") && !l.startsWith("|"));
                    return firstPara ? (
                      <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2 leading-relaxed">{firstPara.replace(/\*\*/g, "")}</p>
                    ) : null;
                  })()}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Auto-save indicator */}
                  {editingModuleId === activeModule.id && (
                    <span className={`text-xs flex items-center gap-1 ${
                      saveStatus === "saved" ? "text-secondary" : saveStatus === "saving" ? "text-primary" : "text-destructive"
                    }`}>
                      {saveStatus === "saved" ? <Cloud className="h-3 w-3" /> :
                       saveStatus === "saving" ? <Loader2 className="h-3 w-3 animate-spin" /> :
                       <CloudOff className="h-3 w-3" />}
                      {saveStatusLabel}
                    </span>
                  )}
                  {/* Regenerate module button (Starter + Pro, only in edit mode) */}
                  {editingModuleId === activeModule.id && (isPro || isStarter) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 border-primary/30 text-primary hover:bg-primary/10"
                      disabled={regenerating}
                      title="Regenerar conteúdo do módulo com IA"
                      data-testid="button-regenerate-module"
                      onClick={async () => {
                        if (!editContent.trim()) return;
                        setRegenerating(true);
                        try {
                          const { data, error } = await supabase.functions.invoke("enhance-paragraph", {
                            body: { text: editContent, action: "regenerate" },
                          });
                          if (error) throw error;
                          if (data?.enhanced) {
                            setEditContent(data.enhanced);
                            setSaveStatus("unsaved");
                            toast({ title: "Módulo regenerado com IA ✨" });
                          }
                        } catch (err: any) {
                          toast({ title: "Erro ao regenerar", description: err.message, variant: "destructive" });
                        } finally {
                          setRegenerating(false);
                        }
                      }}
                    >
                      {regenerating ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <WandSparkles className="h-4 w-4 mr-1.5" />}
                      Regenerar
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 h-9"
                    onClick={() => {
                      if (editingModuleId === activeModule.id) {
                        updateModule.mutate({ moduleId: activeModule.id, content: editContent, title: editTitle });
                      } else {
                        setEditingModuleId(activeModule.id);
                        setEditContent(activeModule.content || "");
                        setEditTitle(activeModule.title);
                        setSaveStatus("saved");
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
              </div>

              {/* Module content */}
              {editingModuleId === activeModule.id ? (
                <div className="space-y-3">
                  <BlockEditor
                    content={editContent}
                    onChange={handleContentChange}
                    isPro={isPro}
                    isStarter={isStarter}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => updateModule.mutate({ moduleId: activeModule.id, content: editContent, title: editTitle })}>
                      Salvar alterações
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => {
                      clearTimeout(saveTimerRef.current);
                      setEditContent(activeModule.content || "");
                      setEditTitle(activeModule.title);
                      setEditingModuleId(null);
                      setSaveStatus("saved");
                    }}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  {/* ── Module image ── */}
                  {moduleImage ? (
                    <div className="mb-4 rounded-xl overflow-hidden border border-border relative group">
                      <img
                        src={moduleImage.url}
                        alt={moduleImage.alt_text || `Ilustração do módulo ${activeModuleIndex + 1}`}
                        className="w-full h-auto object-cover max-h-[360px]"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent flex flex-col justify-end p-6">
                        <p className="text-xs font-semibold text-white/80 uppercase tracking-wider mb-1">
                          Módulo {activeModuleIndex + 1}
                        </p>
                        <h3 className="text-xl lg:text-2xl font-bold text-white font-display leading-tight drop-shadow-md">
                          {activeModule.title}
                        </h3>
                      </div>
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <PexelsPicker
                          moduleTitle={activeModule.title}
                          moduleId={activeModule.id}
                          currentImageUrl={moduleImage.url}
                          onSelect={({ url, alt }) =>
                            saveModuleImage.mutate({ moduleId: activeModule.id, url, altText: alt })
                          }
                          onRemove={() => removeModuleImage.mutate(activeModule.id)}
                          disabled={saveModuleImage.isPending || removeModuleImage.isPending}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="mb-4">
                      <PexelsPicker
                        moduleTitle={activeModule.title}
                        moduleId={activeModule.id}
                        onSelect={({ url, alt }) =>
                          saveModuleImage.mutate({ moduleId: activeModule.id, url, altText: alt })
                        }
                        disabled={saveModuleImage.isPending}
                      />
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
                    <div className="rounded-xl border border-border bg-card p-4 min-h-[320px]">
                      <FlashcardsFlipView flashcards={moduleFlashcards} />
                    </div>
                  ) : (
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

      {/* Translate Dialog */}
      <TranslateDialog
        open={translateOpen}
        onOpenChange={setTranslateOpen}
        courseId={id!}
        courseTitle={course.title}
        currentLanguage={course.language}
        isPro={isPro}
        modulesCount={modules.length}
      />

      {/* Restructure Diff Dialog */}
      <RestructureDiffDialog
        open={diffDialogOpen}
        onOpenChange={setDiffDialogOpen}
        beforeModules={modules.map((m) => ({ id: m.id, title: m.title, content: m.content }))}
        afterModules={restructuredModules}
        onApply={handleApplyRestructure}
        applying={applyingRestructure}
      />
    </div>
  );
}
