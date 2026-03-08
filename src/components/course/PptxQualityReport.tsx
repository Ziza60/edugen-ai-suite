import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2, XCircle, AlertTriangle, FileText, Layout, Eye, HardDrive,
} from "lucide-react";

export interface QualityCheckpoint {
  score: number;
  weight: number;
  critical: boolean;
  issues: string[];
  fixes: string[];
}

export interface ForensicTraceData {
  truncation_root_causes?: { slide: number; field: string; layout: string; last_stage: string; last_fn: string; compression_before: boolean; fallback_before: boolean; continuation_created: boolean; first_mutation_stage?: string; first_mutation_fn?: string; first_mutation_event_type?: string; first_mutation_reason?: string }[];
  compression_events?: { slide: number; field: string; layout: string; stage: string; function: string; event_type?: string; reason?: string; mutated?: boolean; chars_before: number; chars_after: number; reduction_pct: number; before: string; after: string }[];
  fallback_events?: { slide: number; field: string; layout: string; stage: string; function: string; event_type?: string; reason?: string; mutated?: boolean; before: string; after: string }[];
  stage0_events?: { slide: number; field: string; layout: string; stage: string; function: string; event_type: string; reason?: string; mutated: boolean; chars_before: number; chars_after: number; reduction_pct: number; before: string; after: string }[];
  stage0_5_events?: { slide: number; field: string; layout: string; stage: string; function: string; event_type: string; reason?: string; mutated: boolean; chars_before: number; chars_after: number; reduction_pct: number; before: string; after: string }[];
  stage1_5_events?: { slide: number; field: string; layout: string; stage: string; function: string; event_type: string; reason?: string; mutated: boolean; chars_before: number; chars_after: number; reduction_pct: number; before: string; after: string }[];
  stage2_5_events?: { slide: number; field: string; layout: string; stage: string; function: string; event_type: string; reason?: string; mutated: boolean; chars_before: number; chars_after: number; reduction_pct: number; before: string; after: string }[];
  silent_truncation_events?: { slide: number; field: string; layout: string; stage: string; function: string; event_type: string; reason?: string; mutated: boolean; chars_before: number; chars_after: number; reduction_pct: number; before: string; after: string }[];
  first_mutation_per_field?: { slide_field: string; slide: number; layout: string; field: string; first_stage: string; first_function: string; event_type: string; reason?: string; chars_before: number; chars_after: number; reduction_pct: number; before: string; after: string }[];
  renderer_trace?: { slide: number; layout: string; renderer: string }[];
  field_history_summary?: { slide_field: string; mutations: string[]; final_chars: number }[];
  total_trace_events?: number;
  total_compressions?: number;
  total_fallbacks?: number;
}

export interface QualityReport {
  quality_score: number;
  passed: boolean;
  blocked_reason: string | null;
  pipeline_version: string;
  checkpoints: {
    content: QualityCheckpoint;
    structure: QualityCheckpoint;
    visual: QualityCheckpoint;
    file: QualityCheckpoint;
  };
  problematic_slides: { index: number; title: string; issues: string[] }[];
  corrections_attempted: {
    total_fixes: number;
    total_warnings: number;
    retries_used: number;
    overflow_splits: number;
    dedup_removed: number;
    relevance_dropped: number;
    llm_grammar_fixes: number;
    llm_truncation_fixes: number;
    redistributions?: number;
    semantic_losses?: number;
    semantic_loss_details?: string[];
    regeneration_flagged?: number;
    regeneration_attempted?: number;
    regeneration_resolved?: number;
    regeneration_unresolved?: number;
    regeneration_details?: string[];
  };
  summary: {
    total_slides: number;
    pre_parse_blocks: number;
    avg_density: number;
    bbox_overflows: number;
    bbox_fixes: number;
  };
  forensic_trace?: ForensicTraceData;
}

interface Props {
  report: QualityReport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CHECKPOINT_META: Record<string, { label: string; icon: React.ReactNode }> = {
  content: { label: "Conteúdo", icon: <FileText className="h-4 w-4" /> },
  structure: { label: "Estrutura", icon: <Layout className="h-4 w-4" /> },
  visual: { label: "Visual", icon: <Eye className="h-4 w-4" /> },
  file: { label: "Arquivo", icon: <HardDrive className="h-4 w-4" /> },
};

function scoreColor(score: number): string {
  if (score >= 85) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-600";
}

function progressColor(score: number): string {
  if (score >= 85) return "bg-green-500";
  if (score >= 60) return "bg-yellow-500";
  return "bg-red-500";
}

function CheckpointCard({ name, cp }: { name: string; cp: QualityCheckpoint }) {
  const meta = CHECKPOINT_META[name];
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {meta.icon}
          <span className="font-medium text-sm">{meta.label}</span>
          <Badge variant="outline" className="text-[10px]">peso {cp.weight}%</Badge>
          {cp.critical && <Badge variant="destructive" className="text-[10px]">CRÍTICO</Badge>}
        </div>
        <span className={`font-bold text-lg ${scoreColor(cp.score)}`}>{cp.score}</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full transition-all ${progressColor(cp.score)}`}
          style={{ width: `${cp.score}%` }}
        />
      </div>
      {cp.issues.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Problemas ({cp.issues.length})</p>
          {cp.issues.slice(0, 5).map((issue, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              <span className="break-all">{issue}</span>
            </div>
          ))}
          {cp.issues.length > 5 && (
            <p className="text-xs text-muted-foreground">+{cp.issues.length - 5} mais</p>
          )}
        </div>
      )}
      {cp.fixes.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Correções ({cp.fixes.length})</p>
          {cp.fixes.slice(0, 3).map((fix, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-green-600">
              <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
              <span className="break-all">{fix}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PptxQualityReport({ report, open, onOpenChange }: Props) {
  if (!report) return null;

  const checkpoints = report.checkpoints || {};
  const ca = report.corrections_attempted || {} as any;
  const summary = report.summary || {} as any;
  const problematic_slides = report.problematic_slides || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {report.passed ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600" />
            )}
            Relatório de Qualidade PPTX
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-2">
          {/* Overall score */}
          <div className="text-center mb-4">
            <span className={`text-4xl font-bold ${scoreColor(report.quality_score)}`}>
              {report.quality_score}
            </span>
            <span className="text-lg text-muted-foreground">/100</span>
            <Badge variant={report.passed ? "default" : "destructive"} className="ml-3">
              {report.passed ? "Aprovado" : "Bloqueado"}
            </Badge>
            {report.blocked_reason && (
              <p className="text-sm text-destructive mt-2">{report.blocked_reason}</p>
            )}
          </div>

          <Tabs defaultValue="checkpoints" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="checkpoints" className="flex-1 text-xs">Checkpoints</TabsTrigger>
              <TabsTrigger value="slides" className="flex-1 text-xs">Slides</TabsTrigger>
              <TabsTrigger value="stats" className="flex-1 text-xs">Estatísticas</TabsTrigger>
              {report.forensic_trace && <TabsTrigger value="forensic" className="flex-1 text-xs">Forense</TabsTrigger>}
            </TabsList>

            <TabsContent value="checkpoints" className="space-y-3 mt-3">
              {Object.entries(checkpoints).map(([name, cp]) => (
                <CheckpointCard key={name} name={name} cp={cp} />
              ))}
            </TabsContent>

            <TabsContent value="slides" className="mt-3">
              {problematic_slides.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum slide problemático encontrado.
                </p>
              ) : (
                <div className="space-y-2">
                  {problematic_slides.slice(0, 10).map((ps, i) => (
                    <div key={i} className="border rounded-lg p-3">
                      <p className="text-sm font-medium">
                        Slide {ps.index}: {ps.title}
                      </p>
                      {ps.issues.map((issue, j) => (
                        <p key={j} className="text-xs text-destructive mt-1">• {issue}</p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="stats" className="mt-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Total de slides", value: summary.total_slides },
                  { label: "Blocos parseados", value: summary.pre_parse_blocks },
                  { label: "Densidade média", value: summary.avg_density },
                  { label: "Overflows detectados", value: summary.bbox_overflows },
                  { label: "Overflows corrigidos", value: summary.bbox_fixes },
                  { label: "Retries usados", value: ca.retries_used },
                  { label: "Total de correções", value: ca.total_fixes },
                  { label: "Total de avisos", value: ca.total_warnings },
                  { label: "Splits de overflow", value: ca.overflow_splits },
                  { label: "Dedup removidos", value: ca.dedup_removed },
                  { label: "Correções gramática (LLM)", value: ca.llm_grammar_fixes },
                  { label: "Correções truncamento (LLM)", value: ca.llm_truncation_fixes },
                  { label: "Regenerações (flagged)", value: ca.regeneration_flagged ?? 0 },
                  { label: "Regenerações (resolvidas)", value: ca.regeneration_resolved ?? 0 },
                  { label: "Regenerações (não resolvidas)", value: ca.regeneration_unresolved ?? 0 },
                ].map((stat, i) => (
                  <div key={i} className="border rounded-lg p-2.5 text-center">
                    <p className="text-lg font-bold">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                ))}
              </div>
            </TabsContent>

            {report.forensic_trace && (
              <TabsContent value="forensic" className="mt-3 space-y-4">
                {/* Summary counts */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="border rounded-lg p-2 text-center">
                    <p className="text-lg font-bold">{report.forensic_trace.total_trace_events ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Eventos rastreados</p>
                  </div>
                  <div className="border rounded-lg p-2 text-center">
                    <p className="text-lg font-bold">{report.forensic_trace.total_compressions ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Compressões</p>
                  </div>
                  <div className="border rounded-lg p-2 text-center">
                    <p className="text-lg font-bold">{report.forensic_trace.total_fallbacks ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Fallbacks</p>
                  </div>
                </div>

                {/* Truncation root causes */}
                {(report.forensic_trace.truncation_root_causes?.length ?? 0) > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-destructive">Causas raiz de truncamento</p>
                    {report.forensic_trace.truncation_root_causes!.map((rc, i) => (
                      <div key={i} className="border rounded p-2 text-[10px] space-y-0.5">
                        <p className="font-medium">Slide {rc.slide} | {rc.layout} | {rc.field}</p>
                        <p>Último stage: <span className="font-mono">{rc.last_stage}</span> → <span className="font-mono">{rc.last_fn}</span></p>
                        <p>Compressão antes: {rc.compression_before ? "✅ sim" : "❌ não"} | Fallback: {rc.fallback_before ? "✅ sim" : "❌ não"} | Continuação: {rc.continuation_created ? "✅ sim" : "❌ não"}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Compression events */}
                {(report.forensic_trace.compression_events?.length ?? 0) > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Eventos de compressão ({report.forensic_trace.compression_events!.length})</p>
                    {report.forensic_trace.compression_events!.slice(0, 8).map((ce, i) => (
                      <div key={i} className="border rounded p-2 text-[10px]">
                        <p className="font-medium">Slide {ce.slide} | {ce.layout} | {ce.field} | {ce.stage}/{ce.function}</p>
                        <p>Antes ({ce.chars_before}): "{ce.before}"</p>
                        <p>Depois ({ce.chars_after}): "{ce.after}" <span className="text-destructive">(-{ce.reduction_pct}%)</span></p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Field mutation history */}
                {(report.forensic_trace.field_history_summary?.length ?? 0) > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Histórico de mutações por campo</p>
                    {report.forensic_trace.field_history_summary!.slice(0, 10).map((fh, i) => (
                      <div key={i} className="border rounded p-2 text-[10px]">
                        <p className="font-medium font-mono">{fh.slide_field} → {fh.final_chars} chars</p>
                        <p className="break-all">{fh.mutations.join(" → ")}</p>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            )}
          </Tabs>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}