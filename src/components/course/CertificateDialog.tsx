import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Award, Loader2, Copy, ExternalLink } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  courseTitle: string;
  courseStatus: string;
}

export function CertificateDialog({ open, onOpenChange, courseId, courseTitle, courseStatus }: Props) {
  const { user } = useAuth();
  const { plan } = useSubscription();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [studentName, setStudentName] = useState("");
  const [instructorName, setInstructorName] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);

  const isPro = plan === "pro";

  const createCertificate = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");
      if (courseStatus !== "published") throw new Error("Curso precisa estar publicado");

      const customData: Record<string, string> = {};
      if (isPro && instructorName.trim()) {
        customData.instructor_name = instructorName.trim();
      }

      const { data, error } = await supabase
        .from("certificates")
        .insert({
          user_id: user.id,
          course_id: courseId,
          student_name: studentName.trim(),
          template: isPro ? "professional" : "simple",
          custom_data: customData,
        })
        .select("token")
        .single();

      if (error) throw error;
      return data.token;
    },
    onSuccess: (token) => {
      setGeneratedToken(token);
      queryClient.invalidateQueries({ queryKey: ["certificates"] });
      toast({ title: "Certificado gerado!" });

      // Log usage event
      if (user) {
        supabase.from("usage_events").insert({
          user_id: user.id,
          event_type: "certificate_issued",
          metadata: { course_id: courseId },
        }).then(() => {});
      }
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const publicUrl = generatedToken
    ? `${window.location.origin}/certificate/${generatedToken}`
    : null;

  const handleCopy = () => {
    if (publicUrl) {
      navigator.clipboard.writeText(publicUrl);
      toast({ title: "Link copiado!" });
    }
  };

  const handleClose = () => {
    setStudentName("");
    setInstructorName("");
    setGeneratedToken(null);
    onOpenChange(false);
  };

  if (courseStatus !== "published") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Certificado indisponível</DialogTitle>
            <DialogDescription>
              O curso precisa estar publicado para emitir certificados.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-primary" />
            Emitir Certificado
          </DialogTitle>
          <DialogDescription>
            Gere um certificado verificável para "{courseTitle}"
          </DialogDescription>
        </DialogHeader>

        {generatedToken ? (
          <div className="space-y-4">
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 text-center">
              <Badge className="mb-2"><Award className="h-3 w-3 mr-1" /> Gerado com sucesso</Badge>
              <p className="text-sm text-muted-foreground mt-2">Link público de validação:</p>
              <p className="text-xs font-mono bg-muted rounded p-2 mt-2 break-all">{publicUrl}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handleCopy}>
                <Copy className="h-4 w-4 mr-1" /> Copiar link
              </Button>
              <Button className="flex-1" asChild>
                <a href={publicUrl!} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1" /> Visualizar
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do aluno *</Label>
              <Input
                placeholder="Nome completo do aluno"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
              />
            </div>

            {isPro && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  Nome do instrutor <Badge variant="outline" className="text-xs">PRO</Badge>
                </Label>
                <Input
                  placeholder="Seu nome como instrutor"
                  value={instructorName}
                  onChange={(e) => setInstructorName(e.target.value)}
                />
              </div>
            )}

            {!isPro && (
              <p className="text-xs text-muted-foreground">
                Template simples. Faça upgrade para personalizar com nome do instrutor e branding.
              </p>
            )}
          </div>
        )}

        {!generatedToken && (
          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>Cancelar</Button>
            <Button
              onClick={() => createCertificate.mutate()}
              disabled={!studentName.trim() || createCertificate.isPending}
            >
              {createCertificate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Award className="h-4 w-4 mr-1" />
              )}
              Gerar certificado
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
