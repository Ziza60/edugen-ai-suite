import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  MessageSquare, Copy, Link2, Loader2, Sparkles, CheckCircle2, XCircle,
  ChevronDown, ChevronUp
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ReviewPanelProps {
  courseId: string;
  isPublished: boolean;
}

export function ReviewPanel({ courseId, isPublished }: ReviewPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthesis, setSynthesis] = useState<any>(null);
  const [expanded, setExpanded] = useState(false);

  const { data: review, refetch: refetchReview } = useQuery({
    queryKey: ["course-review", courseId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("course_reviews") as any)
        .select("*")
        .eq("course_id", courseId)
        .single();
      if (error) return null;
      return data;
    },
    enabled: !!courseId,
  });

  const { data: comments = [] } = useQuery({
    queryKey: ["review-comments-owner", review?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.from("review_comments") as any)
        .select("*, course_modules(title, order_index)")
        .eq("review_id", review.id)
        .order("created_at", { ascending: true });
      if (error) return [];
      return data;
    },
    enabled: !!review?.id,
  });

  const pendingComments = comments.filter((c: any) => !c.resolved);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await (supabase.from("course_reviews") as any).insert({
        course_id: courseId,
        user_id: user.id,
      });
      if (error) throw error;
      refetchReview();
      toast({ title: "Link de revisão criado!" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (active: boolean) => {
    try {
      const { error } = await (supabase.from("course_reviews") as any)
        .update({ is_active: active })
        .eq("id", review.id);
      if (error) throw error;
      refetchReview();
      toast({ title: active ? "Revisão ativada" : "Revisão desativada" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const handleResolve = async (commentId: string) => {
    try {
      const { error } = await (supabase.from("review_comments") as any)
        .update({ resolved: true })
        .eq("id", commentId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["review-comments-owner", review?.id] });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const handleSynthesize = async () => {
    setSynthesizing(true);
    try {
      const { data, error } = await supabase.functions.invoke("synthesize-reviews", {
        body: { review_id: review.id },
      });
      if (error) throw error;
      setSynthesis(data);
    } catch (err: any) {
      toast({ title: "Erro na síntese", description: err.message, variant: "destructive" });
    } finally {
      setSynthesizing(false);
    }
  };

  if (!isPublished) return null;

  return (
    <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border">
      <div className="flex items-center gap-3">
        <MessageSquare className="h-5 w-5 text-primary" />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Revisão Colaborativa</span>
            {review && (
              <Badge variant={review.is_active ? "default" : "outline"} className="text-[10px]">
                {review.is_active ? "Ativo" : "Inativo"}
              </Badge>
            )}
            {pendingComments.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {pendingComments.length} pendente{pendingComments.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Compartilhe para coletar feedback por módulo
          </p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {!review ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={creating}
            onClick={handleCreate}
          >
            {creating ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <MessageSquare className="h-3 w-3 mr-1.5" />}
            Criar link de revisão
          </Button>
        ) : (
          <>
            <Switch checked={review.is_active} onCheckedChange={handleToggle} />
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                const url = `${window.location.origin}/review/${review.review_token}`;
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
              onClick={() => window.open(`/review/${review.review_token}`, "_blank")}
            >
              <Link2 className="h-3 w-3 mr-1.5" />
              Abrir
            </Button>
            {pendingComments.length > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={synthesizing}
                  onClick={handleSynthesize}
                >
                  {synthesizing ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Sparkles className="h-3 w-3 mr-1.5" />}
                  Sintetizar com IA
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </Button>
              </>
            )}
          </>
        )}
      </div>

      {/* Expandable comments + synthesis area */}
      <AnimatePresence>
        {expanded && (review || synthesis) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="w-full overflow-hidden basis-full"
          >
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Comments list */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Comentários pendentes ({pendingComments.length})
                </p>
                {pendingComments.map((c: any) => (
                  <div key={c.id} className="rounded-lg border border-border p-3 text-xs flex items-start gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-foreground">{c.reviewer_name}</span>
                        <span className="text-muted-foreground">
                          {(c as any).course_modules?.title || "Módulo"}
                        </span>
                      </div>
                      <p className="text-muted-foreground">{c.comment}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 shrink-0"
                      onClick={() => handleResolve(c.id)}
                      title="Marcar como resolvido"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-secondary" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* AI Synthesis */}
              {synthesis && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Síntese IA
                  </p>
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs">
                    <p className="text-foreground leading-relaxed">{synthesis.synthesis}</p>
                  </div>
                  {synthesis.suggestions?.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">Sugestões de ação:</p>
                      {synthesis.suggestions.map((s: any, i: number) => (
                        <div key={i} className="rounded-lg border border-border p-3 text-xs flex items-start gap-2">
                          <Badge
                            variant="outline"
                            className={`text-[9px] shrink-0 ${
                              s.priority === "alta" ? "border-destructive text-destructive" :
                              s.priority === "média" ? "border-primary text-primary" :
                              "border-muted-foreground text-muted-foreground"
                            }`}
                          >
                            {s.priority}
                          </Badge>
                          <div>
                            <p className="font-semibold text-foreground">{s.module}</p>
                            <p className="text-muted-foreground">{s.action}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
