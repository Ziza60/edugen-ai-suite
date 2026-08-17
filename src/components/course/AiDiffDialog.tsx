import { useMemo, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Sparkles } from "lucide-react";
import {
  agruparEmTrechos,
  contarLinhasAlteradas,
  diffLinhas,
  type LinhaDiff,
} from "@/lib/text-diff";

// ═══════════════════════════════════════════════════════════════════════════
// Diálogo de diff antes/depois — aceitar ou rejeitar
//
// Extraído do RestructureDiffDialog, que já resolvia o problema para o
// resultado da reestruturação de módulos. A edição por IA na seleção não
// tinha nada disso: o texto da IA substituía a seleção na hora, e o autor só
// descobria o que havia mudado depois de a mudança já estar feita.
//
// O componente é genérico de propósito: recebe painéis (rótulo + conteúdo) e
// não sabe se está comparando um módulo, um parágrafo ou uma seção.
// ═══════════════════════════════════════════════════════════════════════════

export interface DiffPanelPair {
  /** Identificador estável, usado como key e como rótulo da aba. */
  id: string;
  label: string;
  before: string;
  after: string;
}

interface AiDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  pairs: DiffPanelPair[];
  /** Índice do par exibido. Controlado pelo pai quando há mais de um. */
  activeIndex?: number;
  onActiveIndexChange?: (i: number) => void;
  onAccept: () => void;
  onReject?: () => void;
  applying?: boolean;
  acceptLabel?: string;
  rejectLabel?: string;
  /** Texto auxiliar no rodapé — por exemplo o escopo da edição. */
  hint?: string;
}

/**
 * Quantas linhas mudaram entre os dois lados.
 *
 * A versão anterior comparava a linha 1 com a linha 1, a 2 com a 2. Bastava a
 * IA inserir uma linha no começo para todo o resto escorregar de posição e
 * entrar na conta: numa seção de 40 linhas, um acréscimo virava "40 linhas
 * modificadas". Agora a conta sai do alinhamento de verdade.
 */
export function countChangedLines(before: string, after: string): number {
  return contarLinhasAlteradas(before, after);
}

/**
 * Marca onde um bloco sem alteração foi escondido. Aparece nos DOIS painéis com
 * a mesma altura, senão os lados se desencontram e a rolagem sincronizada passa
 * a comparar linhas erradas.
 */
function Recolhida({ n }: { n: number }) {
  return (
    <div className="px-2 my-1 text-[10px] text-muted-foreground/70 border-y border-dashed border-border select-none">
      ⋯ {n} {n === 1 ? "linha sem alteração" : "linhas sem alteração"}
    </div>
  );
}

/** Uma linha do diff, pintada conforme o que aconteceu com ela. */
function Linha({ lado, linha }: { lado: "antes" | "depois"; linha: LinhaDiff }) {
  const conteudo = lado === "antes" ? linha.antes : linha.depois;

  // Linha que não existe deste lado vira faixa vazia, para os dois painéis
  // ficarem na mesma altura e a rolagem sincronizada continuar valendo.
  if (conteudo === undefined) {
    return <div className="px-2 min-h-[1.25rem] bg-muted/20 rounded-sm" aria-hidden="true">{" "}</div>;
  }

  const pedacos = lado === "antes" ? linha.pedacosAntes : linha.pedacosDepois;
  const fundo = linha.tipo === "igual"
    ? ""
    : lado === "antes"
    ? "bg-red-500/10 border-l-2 border-red-500/50"
    : "bg-emerald-500/10 border-l-2 border-emerald-500/50";

  return (
    <div className={`px-2 min-h-[1.25rem] rounded-sm ${fundo}`}>
      {pedacos
        ? pedacos.map((p, i) => (
          <span
            key={i}
            className={p.tipo === "removido"
              ? "bg-red-500/35 text-red-100 rounded-[2px]"
              : p.tipo === "adicionado"
              ? "bg-emerald-500/35 text-emerald-50 rounded-[2px]"
              : ""}
          >
            {p.texto}
          </span>
        ))
        : conteudo || " "}
    </div>
  );
}

export function AiDiffDialog({
  open,
  onOpenChange,
  title,
  pairs,
  activeIndex = 0,
  onActiveIndexChange,
  onAccept,
  onReject,
  applying,
  acceptLabel = "Aceitar",
  rejectLabel = "Rejeitar",
  hint,
}: AiDiffDialogProps) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  // Rolagem sincronizada: comparar dois textos longos rolando cada lado por si
  // é o que torna um diff inútil na prática.
  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;
    const onLeft = () => { right.scrollTop = left.scrollTop; };
    const onRight = () => { left.scrollTop = right.scrollTop; };
    left.addEventListener("scroll", onLeft);
    right.addEventListener("scroll", onRight);
    return () => {
      left.removeEventListener("scroll", onLeft);
      right.removeEventListener("scroll", onRight);
    };
  }, [activeIndex, open]);

  const totalChanged = useMemo(
    () => pairs.reduce((sum, p) => sum + countChangedLines(p.before, p.after), 0),
    [pairs],
  );

  const atual = pairs[activeIndex] ?? pairs[0];

  // O diff é caro o suficiente para não ser refeito a cada rolagem do diálogo.
  const trechos = useMemo(
    () => agruparEmTrechos(diffLinhas(atual?.before ?? "", atual?.after ?? "")),
    [atual?.before, atual?.after],
  );

  const rejeitar = () => {
    onReject?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : rejeitar())}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col" data-testid="dialog-ai-diff">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            {title}
            <Badge variant="secondary">{totalChanged} linhas modificadas</Badge>
          </DialogTitle>
        </DialogHeader>

        {pairs.length > 1 && (
          <div className="flex gap-1 overflow-x-auto pb-2 border-b border-border">
            {pairs.map((p, i) => {
              const changed = countChangedLines(p.before, p.after);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onActiveIndexChange?.(i)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                    i === activeIndex
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.label}
                  {changed > 0 ? (
                    <span className="h-4 w-4 rounded-full bg-yellow-500/20 text-yellow-600 text-[10px] flex items-center justify-center font-bold">
                      !
                    </span>
                  ) : (
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* O painel da direita já foi tingido inteiro com a cor do tema. Lido
            no tema escuro, aquilo virava um fundo marrom que parecia destaque
            de alteração sem marcar alteração nenhuma — e para achar o que a IA
            fez era preciso ler os dois lados inteiros. Agora só o que MUDOU
            recebe cor: vermelho no que saiu, verde no que entrou, e dentro de
            uma frase reescrita a marca desce ao nível da palavra. */}
        <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">
          <div className="flex flex-col min-h-0">
            <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
              Antes
            </p>
            <div
              ref={leftRef}
              className="flex-1 overflow-y-auto rounded-lg border border-border bg-background p-2"
            >
              <div className="text-xs whitespace-pre-wrap font-mono text-foreground/80 leading-5">
                {trechos.length === 0
                  ? <div className="px-2 text-muted-foreground">(sem alterações)</div>
                  : trechos.map((t, ti) => (
                    <div key={ti}>
                      {t.ocultasAntes > 0 && <Recolhida n={t.ocultasAntes} />}
                      {t.linhas.map((l, li) => <Linha key={li} lado="antes" linha={l} />)}
                    </div>
                  ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col min-h-0">
            <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
              Depois
            </p>
            <div
              ref={rightRef}
              className="flex-1 overflow-y-auto rounded-lg border border-border bg-background p-2"
            >
              <div className="text-xs whitespace-pre-wrap font-mono text-foreground leading-5">
                {trechos.length === 0
                  ? <div className="px-2 text-muted-foreground">(sem alterações)</div>
                  : trechos.map((t, ti) => (
                    <div key={ti}>
                      {t.ocultasAntes > 0 && <Recolhida n={t.ocultasAntes} />}
                      {t.linhas.map((l, li) => <Linha key={li} lado="depois" linha={l} />)}
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-[11px] text-muted-foreground px-1">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-500/35" />
            saiu
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/35" />
            entrou
          </span>
          <span>Trechos sem alteração ficam recolhidos.</span>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground self-center mr-auto">{hint}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={rejeitar} disabled={applying} data-testid="button-ai-diff-reject">
              <XCircle className="h-4 w-4 mr-1.5" />
              {rejectLabel}
            </Button>
            <Button onClick={onAccept} disabled={applying} data-testid="button-ai-diff-accept">
              {applying ? "Aplicando..." : acceptLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
