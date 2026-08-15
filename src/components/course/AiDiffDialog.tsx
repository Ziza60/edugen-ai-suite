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

/** Quantas linhas mudaram entre os dois lados. */
export function countChangedLines(before: string, after: string): number {
  const b = (before || "").split("\n");
  const a = (after || "").split("\n");
  let n = 0;
  for (let i = 0; i < Math.max(b.length, a.length); i++) {
    if ((b[i] || "") !== (a[i] || "")) n++;
  }
  return n;
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

        <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">
          <div className="flex flex-col min-h-0">
            <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
              Antes
            </p>
            <div
              ref={leftRef}
              className="flex-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3"
            >
              <pre className="text-xs whitespace-pre-wrap font-mono text-foreground/80">
                {atual?.before || "(vazio)"}
              </pre>
            </div>
          </div>
          <div className="flex flex-col min-h-0">
            <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
              Depois
            </p>
            <div
              ref={rightRef}
              className="flex-1 overflow-y-auto rounded-lg border border-primary/20 bg-primary/5 p-3"
            >
              <pre className="text-xs whitespace-pre-wrap font-mono text-foreground">
                {atual?.after || "(vazio)"}
              </pre>
            </div>
          </div>
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
