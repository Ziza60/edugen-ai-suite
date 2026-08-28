// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — o laudo do portão, que ninguém conseguia ler
//
// O portão de qualidade roda a cada curso gerado e grava um laudo completo em
// `course_quality_reports`: veredito, escore, e cada verificação com o motivo e
// os trechos reais que a dispararam. Nada disso aparecia no produto. Para ver o
// laudo era preciso abrir o painel do Supabase e escrever SQL — algo que o dono
// do curso não vai fazer, e que eu vinha pedindo ao autor a cada teste.
//
// POR QUE ISSO FICOU CRÍTICO AGORA
//
// Enquanto o portão só bloqueava, dava para viver sem: o veredito rebaixava o
// status do curso e isso, sozinho, dizia algo. Mas o portão passou a AVISAR nos
// casos que ele não consegue decidir — mesma grandeza, valores diferentes,
// itens possivelmente diferentes — e um aviso que ninguém lê não é um aviso.
// O desenho inteiro depende de haver onde ler.
//
// O QUE ESTE PAINEL MOSTRA, E O QUE ELE NÃO FAZ
//
// Mostra o que falhou, com a evidência: o trecho do curso que disparou a
// regra, para quem for corrigir procurar a frase no texto. Não mostra o que
// passou — uma lista de vinte "ok" esconde os dois itens que importam.
//
// E ele não corrige nada. Corrigir é decisão de quem escreveu o curso, e o
// aviso existe justamente porque o portão NÃO sabe se aquilo é defeito.
// ═══════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ShieldX, AlertTriangle } from "lucide-react";
import {
  APARENCIA_DO_VEREDITO,
  oQueFalhou,
  type LaudoDoCurso,
} from "@/lib/laudo-do-curso";

export function CourseQualityReport({ courseId }: { courseId: string }) {
  const [aberto, setAberto] = useState(false);

  const { data: laudo } = useQuery({
    queryKey: ["course-quality-report", courseId],
    queryFn: async (): Promise<LaudoDoCurso | null> => {
      // `as any` porque `course_quality_reports` não está nos tipos gerados do
      // Supabase — o mesmo contorno que `tutor_sessions` já usa neste projeto.
      // A forma da linha está declarada em `LaudoDoCurso`, logo acima.
      const { data, error } = await (supabase as any)
        .from("course_quality_reports")
        .select("verdict, structural_score, criteria_version, blockers, warnings, checks, created_at")
        .eq("course_id", courseId)
        .order("created_at", { ascending: false })
        .limit(1);
      // Laudo ausente não é erro: cursos antigos foram gerados antes do portão.
      if (error) return null;
      return (data?.[0] as unknown as LaudoDoCurso) ?? null;
    },
    enabled: !!courseId,
  });

  if (!laudo) return null;

  const { texto, classe, Icone } = APARENCIA_DO_VEREDITO[laudo.verdict] ??
    APARENCIA_DO_VEREDITO.ready;
  const falhas = oQueFalhou(laudo.checks);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={`h-9 gap-1.5 ${classe}`}
        onClick={() => setAberto(true)}
        data-testid="btn-laudo-qualidade"
        title="Laudo de qualidade do curso"
      >
        <Icone className="h-4 w-4" />
        {texto}
        {falhas.length > 0 && (
          <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 text-[11px]">
            {falhas.length}
          </Badge>
        )}
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icone className="h-5 w-5" />
              Laudo de qualidade — {texto}
            </DialogTitle>
            <DialogDescription>
              Verificação automática da estrutura do curso. Ela aponta onde olhar;
              o que fazer é decisão de quem escreveu.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-4 text-sm border-y border-border py-3">
            <span><strong>{laudo.structural_score}</strong>/100 estrutural</span>
            <span><strong>{laudo.blockers}</strong> bloqueador(es)</span>
            <span><strong>{laudo.warnings}</strong> aviso(s)</span>
            <span className="text-muted-foreground ml-auto">
              critérios {laudo.criteria_version}
            </span>
          </div>

          {falhas.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              Nenhuma verificação falhou. O portão olha a estrutura do curso — a
              exatidão do conteúdo continua sendo sua.
            </p>
          ) : (
            <div className="space-y-4 py-1">
              {falhas.map((c) => (
                <div key={c.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start gap-2">
                    {c.severity === "blocker"
                      ? <ShieldX className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                      : <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{c.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{c.detail}</p>
                    </div>
                  </div>
                  {c.evidence?.length > 0 && (
                    // A evidência é o trecho REAL do curso. Sem ela, "há uma
                    // contradição entre módulos" manda o autor procurar agulha
                    // em palheiro.
                    <ul className="mt-2 space-y-1 pl-6">
                      {c.evidence.map((e, i) => (
                        <li
                          key={i}
                          className="text-xs text-foreground/80 font-mono leading-snug break-words"
                        >
                          {e}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
