// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — o que o laudo do portão mostra, e como ele é dito
//
// Separado do componente de propósito: `CourseQualityReport.tsx` importa o
// cliente do Supabase, e importá-lo num teste exige as variáveis de ambiente do
// projeto. As decisões que valem a pena travar são estas — o que aparece e como
// o veredito é dito —, e elas não precisam de rede nem de navegador.
// ═══════════════════════════════════════════════════════════════════════════
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";

export type Severidade = "blocker" | "warning";

export interface VerificacaoDoLaudo {
  id: string;
  label: string;
  severity: Severidade;
  passed: boolean;
  detail: string;
  evidence: string[];
}

export interface LaudoDoCurso {
  verdict: "ready" | "ready_with_warnings" | "needs_review";
  structural_score: number;
  criteria_version: string;
  blockers: number;
  warnings: number;
  checks: VerificacaoDoLaudo[];
  created_at: string;
}

/**
 * Como o veredito aparece: palavra, cor e ícone.
 *
 * "needs_review" NÃO vira "reprovado". O portão conhece a estrutura do que
 * chegou, não o mérito do conteúdo — ele aponta onde olhar, e quem decide é
 * quem escreveu o curso.
 */
export const APARENCIA_DO_VEREDITO: Record<
  LaudoDoCurso["verdict"],
  { texto: string; classe: string; Icone: typeof ShieldCheck }
> = {
  ready: {
    texto: "Sem ressalvas",
    classe: "text-emerald-600 border-emerald-600/30 bg-emerald-600/5",
    Icone: ShieldCheck,
  },
  ready_with_warnings: {
    texto: "Com ressalvas",
    classe: "text-amber-600 border-amber-600/30 bg-amber-600/5",
    Icone: ShieldAlert,
  },
  needs_review: {
    texto: "Revisar antes de publicar",
    classe: "text-red-600 border-red-600/30 bg-red-600/5",
    Icone: ShieldX,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// A COERÊNCIA ENTRE MÓDULOS NÃO VAI MAIS PARA A TELA
//
// Ela continua rodando, continua gravada em `course_quality_reports` e continua
// alimentando a bancada — o que muda é que para de assustar quem lê.
//
// MEDIDO nos 14 cursos da bancada, lendo os achados um a um no texto:
//
//     25 achados de coerência
//      9 contradições verdadeiras
//     16 falsos positivos
//     precisão: 36%
//
// E nos DOIS cursos gerados depois de a ficha de valores existir:
//
//     14 avisos de coerência, TODOS falsos, zero contradição verdadeira
//
// A razão é de desenho, não de calibragem: o portão foi construído para
// DETECTAR números do caso se contradizendo entre módulos, e a ficha de valores
// (`case_facts` numerado, desde 12/11) IMPEDE que isso aconteça. O detector
// ficou apontando para um defeito que a prevenção já removeu.
//
// Um aviso que erra duas em três vezes não é informação: é treino para ignorar
// o laudo inteiro, inclusive os bloqueadores. Por isso a seção sai da tela em
// vez de ser refinada — refinar melhoraria um aparelho sem destinatário.
//
// O QUE NÃO MUDA: bloqueador de coerência, se algum dia existir, aparece. A
// exclusão é só dos `warning`, e é por isso que o filtro olha a severidade em
// vez de apagar o prefixo todo.
// ═══════════════════════════════════════════════════════════════════════════

/** Verificações que rodam, são gravadas, e não vão para a tela como aviso. */
const SILENCIOSAS_NA_TELA = ["coerencia."];

function silenciosaNaTela(c: VerificacaoDoLaudo): boolean {
  return c.severity === "warning" &&
    SILENCIOSAS_NA_TELA.some((p) => c.id?.startsWith(p));
}

/** Só o que falhou E tem o que dizer a quem lê, bloqueadores primeiro. */
export function oQueFalhou(checks: VerificacaoDoLaudo[]): VerificacaoDoLaudo[] {
  return (checks ?? [])
    .filter((c) => c && !c.passed && !silenciosaNaTela(c))
    .sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === "blocker" ? -1 : 1
    );
}

/**
 * Os números do cabeçalho, contados sobre o que a tela REALMENTE mostra.
 *
 * `laudo.blockers` e `laudo.warnings` vêm do portão e contam tudo, coerência
 * incluída. Exibi-los ao lado de uma lista que esconde parte deles poria na
 * tela um número que ela não consegue explicar — "2 avisos" e nenhum aviso
 * visível. É a mesma classe de defeito que este projeto já pagou cinco vezes:
 * uma régua que não olha o que afirma medir.
 */
export function contagemNaTela(
  checks: VerificacaoDoLaudo[],
): { bloqueadores: number; avisos: number } {
  const falhas = oQueFalhou(checks);
  return {
    bloqueadores: falhas.filter((c) => c.severity === "blocker").length,
    avisos: falhas.filter((c) => c.severity === "warning").length,
  };
}

