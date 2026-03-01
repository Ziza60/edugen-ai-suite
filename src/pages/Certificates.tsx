import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Award, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Certificates() {
  const { user } = useAuth();

  const { data: certificates = [], isLoading } = useQuery({
    queryKey: ["certificates", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("certificates")
        .select("*, courses(title)")
        .eq("user_id", user!.id)
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="font-display text-3xl font-bold mb-2">Certificados</h1>
      <p className="text-muted-foreground mb-8">Certificados emitidos para seus cursos</p>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : certificates.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Award className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-display text-xl font-semibold mb-2">Nenhum certificado ainda</h3>
            <p className="text-muted-foreground max-w-sm">
              Publique um curso e emita certificados para seus alunos.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {certificates.map((cert) => (
            <Card key={cert.id}>
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Award className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{cert.student_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(cert as any).courses?.title} • {new Date(cert.issued_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{cert.template}</Badge>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={`/certificate/${cert.token}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
