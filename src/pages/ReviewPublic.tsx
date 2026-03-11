import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, MessageSquare, Send, BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function ReviewPublic() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeModuleIndex, setActiveModuleIndex] = useState(0);
  const [reviewerName, setReviewerName] = useState("");
  const [comment, setComment] = useState("");

  // Fetch review session
  const { data: review, isLoading: loadingReview } = useQuery({
    queryKey: ["review-session", token],
    queryFn: async () => {
      const { data, error } = await (supabase.from("course_reviews") as any)
        .select("*, courses(title, description)")
        .eq("review_token", token!)
        .eq("is_active", true)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!token,
  });

  // Fetch modules
  const { data: modules = [] } = useQuery({
    queryKey: ["review-modules", review?.course_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_modules")
        .select("id, title, content, order_index")
        .eq("course_id", review.course_id)
        .order("order_index");
      if (error) return [];
      return data;
    },
    enabled: !!review?.course_id,
  });

  // Fetch comments for this review
  const { data: comments = [] } = useQuery({
    queryKey: ["review-comments", review?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.from("review_comments") as any)
        .select("*")
        .eq("review_id", review.id)
        .order("created_at", { ascending: true });
      if (error) return [];
      return data;
    },
    enabled: !!review?.id,
  });

  const addComment = useMutation({
    mutationFn: async () => {
      const activeModule = modules[activeModuleIndex];
      if (!activeModule || !comment.trim()) return;
      const { error } = await (supabase.from("review_comments") as any).insert({
        review_id: review.id,
        module_id: activeModule.id,
        reviewer_name: reviewerName.trim() || "Anônimo",
        comment: comment.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setComment("");
      queryClient.invalidateQueries({ queryKey: ["review-comments", review?.id] });
      toast({ title: "Comentário adicionado!" });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  if (loadingReview) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!review) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Revisão não encontrada</h1>
          <p className="text-muted-foreground">Este link de revisão expirou ou foi desativado.</p>
        </div>
      </div>
    );
  }

  const activeModule = modules[activeModuleIndex];
  const moduleComments = activeModule
    ? comments.filter((c: any) => c.module_id === activeModule.id)
    : [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-50">
        <div className="container mx-auto flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-display text-lg font-bold">EduGen AI</span>
            <Badge variant="secondary" className="text-xs">Modo Revisão</Badge>
          </div>
          <span className="text-sm text-muted-foreground truncate max-w-[300px]">
            {review.courses?.title}
          </span>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Sidebar: modules */}
        <aside className="hidden md:block w-64 border-r border-border bg-card shrink-0">
          <div className="p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Módulos ({modules.length})
            </p>
            <nav className="space-y-1">
              {modules.map((mod: any, i: number) => {
                const modCommentCount = comments.filter((c: any) => c.module_id === mod.id).length;
                return (
                  <button
                    key={mod.id}
                    onClick={() => setActiveModuleIndex(i)}
                    className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-all flex items-center gap-2 ${
                      i === activeModuleIndex
                        ? "bg-primary/10 text-primary font-semibold"
                        : "text-foreground/70 hover:bg-muted"
                    }`}
                  >
                    <span className={`shrink-0 h-5 w-5 rounded text-xs font-bold flex items-center justify-center ${
                      i === activeModuleIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}>
                      {i + 1}
                    </span>
                    <span className="truncate flex-1">{mod.title}</span>
                    {modCommentCount > 0 && (
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {modCommentCount}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Content + comments */}
        <div className="flex-1 flex flex-col lg:flex-row">
          {/* Module content */}
          <div className="flex-1 overflow-y-auto p-6 lg:p-10">
            {activeModule ? (
              <motion.div
                key={activeModule.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-[700px]"
              >
                <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
                  Módulo {activeModuleIndex + 1} de {modules.length}
                </p>
                <h2 className="font-display text-2xl font-bold text-foreground mb-6">{activeModule.title}</h2>
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {activeModule.content || "*Sem conteúdo*"}
                  </ReactMarkdown>
                </div>

                {/* Navigation */}
                <div className="flex items-center justify-between mt-8 pt-4 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={activeModuleIndex === 0}
                    onClick={() => setActiveModuleIndex(i => i - 1)}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
                  </Button>
                  <span className="text-xs text-muted-foreground">{activeModuleIndex + 1}/{modules.length}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={activeModuleIndex === modules.length - 1}
                    onClick={() => setActiveModuleIndex(i => i + 1)}
                  >
                    Próximo <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </motion.div>
            ) : (
              <p className="text-muted-foreground">Selecione um módulo.</p>
            )}
          </div>

          {/* Comments panel */}
          <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-border bg-card flex flex-col">
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Comentários</h3>
                {moduleComments.length > 0 && (
                  <Badge variant="secondary" className="text-xs">{moduleComments.length}</Badge>
                )}
              </div>
            </div>

            {/* Existing comments */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[400px] lg:max-h-none">
              {moduleComments.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">
                  Nenhum comentário neste módulo ainda.
                </p>
              ) : (
                moduleComments.map((c: any) => (
                  <div key={c.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-foreground text-xs">{c.reviewer_name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(c.created_at).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs leading-relaxed">{c.comment}</p>
                  </div>
                ))
              )}
            </div>

            {/* Add comment form */}
            <div className="p-4 border-t border-border space-y-2">
              <input
                type="text"
                placeholder="Seu nome (opcional)"
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                maxLength={50}
              />
              <div className="flex gap-2">
                <textarea
                  placeholder="Adicione um comentário..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  className="flex-1 text-xs px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  maxLength={1000}
                />
                <Button
                  size="sm"
                  className="shrink-0 self-end"
                  disabled={!comment.trim() || addComment.isPending}
                  onClick={() => addComment.mutate()}
                >
                  {addComment.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
