import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Download, Eye, Edit3, Loader2, BookOpen, Brain, CreditCard, FileText, Award, RefreshCw, Layers, List } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { CertificateDialog } from "@/components/course/CertificateDialog";
import { FlashcardsFlipView } from "@/components/course/FlashcardsFlipView";
import { FlashcardsListView } from "@/components/course/FlashcardsListView";

export default function CourseView() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { plan } = useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [certDialogOpen, setCertDialogOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [reprocessingFlashcards, setReprocessingFlashcards] = useState(false);
  const [flashcardView, setFlashcardView] = useState<"list" | "flip">("flip");
  const [flipEntitled, setFlipEntitled] = useState<boolean | null>(null);

  const isPro = plan === "pro";

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

  // Check flip entitlement from backend
  useQuery({
    queryKey: ["flip-entitlement"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("check-entitlements", {
        body: { feature: "flashcards_flip" },
      });
      if (error) {
        setFlipEntitled(false);
        setFlashcardView("list");
        return false;
      }
      const entitled = data?.entitled === true;
      setFlipEntitled(entitled);
      if (!entitled) setFlashcardView("list");
      return entitled;
    },
    enabled: flashcards.length > 0,
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

  const handleExportMarkdown = () => {
    const branding = isPro ? "" : "\n\n---\n\n*Gerado com CourseAI — plataforma de cursos com IA*\n";
    const md = modules.map((m) => `# ${m.title}\n\n${m.content || ""}`).join("\n\n---\n\n") + branding;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${course?.title || "curso"}.md`;
    a.click();
    URL.revokeObjectURL(url);

    // Log usage
    if (user) {
      supabase.from("usage_events").insert({
        user_id: user.id,
        event_type: "COURSE_EXPORTED_MD",
        metadata: { course_id: id },
      }).then(() => {});
    }
  };

  const handleExportPdf = async () => {
    if (!isPro) {
      toast({ title: "Recurso PRO", description: "Exportação PDF disponível apenas no plano Pro.", variant: "destructive" });
      return;
    }
    setExportingPdf(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-pdf", {
        body: { course_id: id },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
        toast({ title: "PDF gerado!" });
      }
    } catch (err: any) {
      toast({ title: "Erro ao exportar PDF", description: err.message, variant: "destructive" });
    } finally {
      setExportingPdf(false);
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

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <Button variant="ghost" onClick={() => navigate("/app/dashboard")} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
      </Button>

      {/* Course header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant={course.status === "published" ? "default" : "outline"}>
              {course.status === "published" ? "Publicado" : "Rascunho"}
            </Badge>
            <span className="text-sm text-muted-foreground">{course.language}</span>
          </div>
          <h1 className="font-display text-3xl font-bold">{course.title}</h1>
          {course.description && <p className="text-muted-foreground mt-2">{course.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleExportMarkdown}>
            <Download className="h-4 w-4 mr-1" /> MD
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            disabled={exportingPdf || !isPro}
          >
            {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
            PDF {!isPro && <Badge variant="outline" className="ml-1 text-[10px] px-1">PRO</Badge>}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCertDialogOpen(true)}>
            <Award className="h-4 w-4 mr-1" /> Certificado
          </Button>
          <Button
            variant={course.status === "published" ? "outline" : "default"}
            size="sm"
            onClick={() => togglePublish.mutate()}
          >
            <Eye className="h-4 w-4 mr-1" />
            {course.status === "published" ? "Despublicar" : "Publicar"}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="modules">
        <TabsList>
          <TabsTrigger value="modules">
            <BookOpen className="h-4 w-4 mr-1" /> Módulos ({modules.length})
          </TabsTrigger>
          {quizzes.length > 0 && (
            <TabsTrigger value="quizzes">
              <Brain className="h-4 w-4 mr-1" /> Quizzes ({quizzes.length})
            </TabsTrigger>
          )}
          {flashcards.length > 0 && (
            <TabsTrigger value="flashcards">
              <CreditCard className="h-4 w-4 mr-1" /> Flashcards ({flashcards.length})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="modules" className="space-y-4 mt-4">
          {modules.map((mod, i) => (
            <motion.div key={mod.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="font-display text-lg">
                    <span className="text-muted-foreground mr-2">{i + 1}.</span>
                    {mod.title}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (editingModuleId === mod.id) {
                        updateModule.mutate({ moduleId: mod.id, content: editContent });
                      } else {
                        setEditingModuleId(mod.id);
                        setEditContent(mod.content || "");
                      }
                    }}
                  >
                    <Edit3 className="h-4 w-4 mr-1" />
                    {editingModuleId === mod.id ? "Salvar" : "Editar"}
                  </Button>
                </CardHeader>
                <CardContent>
                  {editingModuleId === mod.id ? (
                    <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={12} className="font-mono text-sm" />
                  ) : (
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <ReactMarkdown>{mod.content || "*Sem conteúdo ainda*"}</ReactMarkdown>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </TabsContent>

        <TabsContent value="quizzes" className="space-y-4 mt-4">
          {quizzes.map((q, i) => (
            <Card key={q.id}>
              <CardContent className="p-5">
                <p className="font-medium mb-3">{i + 1}. {q.question}</p>
                <div className="space-y-2">
                  {(q.options as string[])?.map((opt: string, j: number) => (
                    <div key={j} className={`p-2 rounded text-sm ${j === q.correct_answer ? "bg-success/10 text-success border border-success/30" : "bg-muted"}`}>
                      {String.fromCharCode(65 + j)}) {opt}
                    </div>
                  ))}
                </div>
                {q.explanation && <p className="text-sm text-muted-foreground mt-3 italic">{q.explanation}</p>}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="flashcards" className="space-y-4 mt-4">
          {/* View toggle & reprocess */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              {flipEntitled && (
                <>
                  <Button
                    variant={flashcardView === "flip" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFlashcardView("flip")}
                  >
                    <Layers className="h-4 w-4 mr-1" /> Modo Flip
                  </Button>
                  <Button
                    variant={flashcardView === "list" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFlashcardView("list")}
                  >
                    <List className="h-4 w-4 mr-1" /> Lista
                  </Button>
                </>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={reprocessingFlashcards}
              onClick={async () => {
                setReprocessingFlashcards(true);
                try {
                  const { data, error } = await supabase.functions.invoke("reprocess-flashcards", {
                    body: { course_id: id },
                  });
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
              {reprocessingFlashcards ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Reprocessar perguntas
            </Button>
          </div>

          {/* Render view based on entitlement */}
          {flashcardView === "flip" && flipEntitled ? (
            <FlashcardsFlipView flashcards={flashcards} />
          ) : (
            <FlashcardsListView flashcards={flashcards} showUpsell={!flipEntitled} />
          )}
        </TabsContent>
      </Tabs>

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
