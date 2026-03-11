import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle } from "lucide-react";

interface RestructureDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beforeModules: { id: string; title: string; content: string | null }[];
  afterModules: { id: string; title: string; content: string }[];
  onApply: () => void;
  applying?: boolean;
}

function countDiffSections(before: string, after: string): number {
  const bLines = (before || "").split("\n");
  const aLines = after.split("\n");
  let changed = 0;
  const maxLen = Math.max(bLines.length, aLines.length);
  for (let i = 0; i < maxLen; i++) {
    if ((bLines[i] || "") !== (aLines[i] || "")) changed++;
  }
  return changed;
}

export function RestructureDiffDialog({
  open,
  onOpenChange,
  beforeModules,
  afterModules,
  onApply,
  applying,
}: RestructureDiffDialogProps) {
  const [selectedModule, setSelectedModule] = useState(0);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  // Sync scroll
  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    const syncScroll = (source: HTMLDivElement, target: HTMLDivElement) => {
      target.scrollTop = source.scrollTop;
    };

    const onLeftScroll = () => syncScroll(left, right);
    const onRightScroll = () => syncScroll(right, left);

    left.addEventListener("scroll", onLeftScroll);
    right.addEventListener("scroll", onRightScroll);
    return () => {
      left.removeEventListener("scroll", onLeftScroll);
      right.removeEventListener("scroll", onRightScroll);
    };
  }, [selectedModule]);

  const totalChangedLines = afterModules.reduce((sum, after, i) => {
    const before = beforeModules[i];
    return sum + countDiffSections(before?.content || "", after.content);
  }, 0);

  const currentBefore = beforeModules[selectedModule]?.content || "";
  const currentAfter = afterModules[selectedModule]?.content || "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            Pré-visualização da reestruturação
            <Badge variant="secondary">{totalChangedLines} linhas modificadas</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Module tabs */}
        <div className="flex gap-1 overflow-x-auto pb-2 border-b border-border">
          {afterModules.map((mod, i) => {
            const changed = countDiffSections(beforeModules[i]?.content || "", mod.content);
            return (
              <button
                key={mod.id}
                onClick={() => setSelectedModule(i)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  i === selectedModule
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                M{i + 1}
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

        {/* Side by side diff */}
        <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">
          <div className="flex flex-col min-h-0">
            <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">Antes</p>
            <div ref={leftRef} className="flex-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
              <pre className="text-xs whitespace-pre-wrap font-mono text-foreground/80">{currentBefore || "(vazio)"}</pre>
            </div>
          </div>
          <div className="flex flex-col min-h-0">
            <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">Depois</p>
            <div ref={rightRef} className="flex-1 overflow-y-auto rounded-lg border border-primary/20 bg-primary/3 p-3">
              <pre className="text-xs whitespace-pre-wrap font-mono text-foreground">{currentAfter || "(vazio)"}</pre>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            <XCircle className="h-4 w-4 mr-1.5" />
            Descartar
          </Button>
          <Button onClick={onApply} disabled={applying}>
            {applying ? "Aplicando..." : "Aplicar mudanças"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
