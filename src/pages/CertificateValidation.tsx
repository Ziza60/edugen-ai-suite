import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Award, Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function CertificateValidation() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["certificate-validation", token],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("validate-certificate", {
        body: { token },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!token,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <XCircle className="h-8 w-8 text-destructive" />
            </div>
            <h2 className="font-display text-xl font-bold mb-2">Certificado inválido</h2>
            <p className="text-muted-foreground">
              {data?.error || "Este certificado não foi encontrado ou o curso não está publicado."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const cert = data.certificate;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-lg w-full border-2 border-primary/20">
        <CardContent className="flex flex-col items-center py-12 text-center px-8">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <Award className="h-8 w-8 text-primary" />
          </div>
          <Badge className="mb-6" variant="outline">
            <CheckCircle2 className="h-3 w-3 mr-1" /> Certificado verificado
          </Badge>

          <p className="text-sm text-muted-foreground mb-1">Certificamos que</p>
          <h1 className="font-display text-2xl font-bold mb-4">{cert.student_name}</h1>

          <p className="text-sm text-muted-foreground mb-1">concluiu com sucesso o curso</p>
          <h2 className="font-display text-lg font-semibold mb-6">{cert.course_title}</h2>

          <p className="text-xs text-muted-foreground">
            Emitido em {new Date(cert.issued_at).toLocaleDateString("pt-BR", {
              day: "2-digit", month: "long", year: "numeric"
            })}
          </p>

          {cert.custom_data?.instructor_name && (
            <p className="text-xs text-muted-foreground mt-2">
              Instrutor: {cert.custom_data.instructor_name}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
