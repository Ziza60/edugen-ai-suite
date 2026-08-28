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

/** Só o que falhou, bloqueadores primeiro. Ver o cabeçalho deste arquivo. */
export function oQueFalhou(checks: VerificacaoDoLaudo[]): VerificacaoDoLaudo[] {
  return (checks ?? [])
    .filter((c) => c && !c.passed)
    .sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === "blocker" ? -1 : 1
    );
}

