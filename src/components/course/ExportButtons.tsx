import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  Download, FileText, Loader2, Package, StickyNote, GraduationCap, FileType,
} from "lucide-react";
import { PptxExportDialog, type PptxExportOptions } from "./PptxExportDialog";
import { PptxQualityReport, type QualityReport } from "./PptxQualityReport";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, ShadingType,
} from "docx";

interface ExportButtonsProps {
  courseId: string;
  courseTitle: string;
  courseStatus: string;
  isPro: boolean;
  modules: { title: string; content: string | null }[];
}

export function ExportButtons({ courseId, courseTitle, courseStatus, isPro, modules }: ExportButtonsProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingPptx, setExportingPptx] = useState(false);
  const [exportingScorm, setExportingScorm] = useState(false);
  const [exportingNotion, setExportingNotion] = useState(false);
  const [exportingMoodle, setExportingMoodle] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const formatFileName = (title: string, format: string, ext: string) => {
    const safe = (title || "curso").replace(/[^\w\s\-àáâãéêíóôõúüçÀÁÂÃÉÊÍÓÔÕÚÜÇ]/gi, "").trim();
    const date = new Date().toISOString().slice(0, 10);
    return `${safe} - ${format} - ${date}.${ext}`;
  };

  const handleExportDocx = async () => {
    setExportingDocx(true);
    try {
      const children: Paragraph[] = [];

      // Cover: course title
      children.push(
        new Paragraph({
          children: [new TextRun({ text: courseTitle, bold: true, size: 56, color: "1a1a2e" })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `${modules.length} módulos`, size: 28, color: "666666" })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 800 },
        }),
        new Paragraph({ children: [new TextRun({ text: "", break: 1 })] }),
      );

      for (const mod of modules) {
        // Module heading
        children.push(
          new Paragraph({
            text: mod.title,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 480, after: 200 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "e2e8f0", space: 4 } },
          })
        );

        const rawContent = mod.content || "";
        const lines = rawContent.split("\n");

        for (const line of lines) {
          if (line.startsWith("## ")) {
            children.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }));
          } else if (line.startsWith("### ")) {
            children.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } }));
          } else if (line.startsWith("# ")) {
            children.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 160 } }));
          } else if (line.startsWith("- ") || line.startsWith("* ")) {
            children.push(new Paragraph({ text: line.slice(2), bullet: { level: 0 }, spacing: { after: 60 } }));
          } else if (/^\d+\. /.test(line)) {
            children.push(new Paragraph({ text: line.replace(/^\d+\. /, ""), numbering: { reference: "ordered", level: 0 }, spacing: { after: 60 } }));
          } else if (line.startsWith("> ")) {
            children.push(new Paragraph({
              children: [new TextRun({ text: line.slice(2), italics: true, color: "555555" })],
              indent: { left: 720 },
              spacing: { after: 120 },
              shading: { type: ShadingType.SOLID, color: "f8f9fa", fill: "f8f9fa" },
            }));
          } else if (line === "---") {
            children.push(new Paragraph({
              children: [],
              border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "e2e8f0", space: 2 } },
              spacing: { before: 120, after: 120 },
            }));
          } else if (line.trim() === "") {
            children.push(new Paragraph({ text: "", spacing: { after: 80 } }));
          } else {
            // Inline bold/italic parsing
            const runs: TextRun[] = [];
            const boldItalicRe = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;
            let lastIdx = 0;
            let m: RegExpExecArray | null;
            while ((m = boldItalicRe.exec(line)) !== null) {
              if (m.index > lastIdx) runs.push(new TextRun({ text: line.slice(lastIdx, m.index) }));
              if (m[1]) runs.push(new TextRun({ text: m[1], bold: true, italics: true }));
              else if (m[2]) runs.push(new TextRun({ text: m[2], bold: true }));
              else if (m[3]) runs.push(new TextRun({ text: m[3], italics: true }));
              else if (m[4]) runs.push(new TextRun({ text: m[4], font: "Courier New", size: 20, color: "d63384" }));
              lastIdx = m.index + m[0].length;
            }
            if (lastIdx < line.length) runs.push(new TextRun({ text: line.slice(lastIdx) }));
            children.push(new Paragraph({ children: runs.length ? runs : [new TextRun({ text: line })], spacing: { after: 100 } }));
          }
        }
      }

      // Footer branding
      if (!isPro) {
        children.push(
          new Paragraph({ children: [], spacing: { before: 400 } }),
          new Paragraph({
            children: [new TextRun({ text: "Gerado com EduGenAI — plataforma de cursos com IA", italics: true, size: 18, color: "999999" })],
            alignment: AlignmentType.CENTER,
          })
        );
      }

      const doc = new Document({
        numbering: {
          config: [{
            reference: "ordered",
            levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
          }],
        },
        styles: {
          default: {
            document: { run: { font: "Calibri", size: 24, color: "1a1a2e" } },
          },
          paragraphStyles: [
            { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { size: 36, bold: true, color: "1a1a2e" } },
            { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { size: 28, bold: true, color: "334155" } },
            { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", run: { size: 24, bold: true, color: "475569" } },
          ],
        },
        sections: [{ properties: {}, children }],
      });

      const buffer = await Packer.toBlob(doc);
      const url = URL.createObjectURL(buffer);
      const a = document.createElement("a");
      a.href = url;
      a.download = formatFileName(courseTitle, "DOCX", "docx");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({ title: "DOCX gerado com sucesso!" });

      if (user) {
        supabase.from("usage_events").insert({
          user_id: user.id,
          event_type: "COURSE_EXPORTED_DOCX",
          metadata: { course_id: courseId },
        }).then(() => {});
      }
    } catch (err: any) {
      toast({ title: "Erro ao gerar DOCX", description: err.message, variant: "destructive" });
    } finally {
      setExportingDocx(false);
    }
  };

  const handleExportMarkdown = () => {
    const branding = isPro ? "" : "\n\n---\n\n*Gerado com CourseAI — plataforma de cursos com IA*\n";
    const md = modules.map((m) => `# ${m.title}\n\n${m.content || ""}`).join("\n\n---\n\n") + branding;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = formatFileName(courseTitle, "MD", "md");
    a.click();
    URL.revokeObjectURL(url);

    if (user) {
      supabase.from("usage_events").insert({
        user_id: user.id,
        event_type: "COURSE_EXPORTED_MD",
        metadata: { course_id: courseId },
      }).then(() => {});
    }
  };

  const handleExportWithFunction = async (
    functionName: string,
    extension: string,
    setLoading: (v: boolean) => void,
    label: string,
  ) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { course_id: courseId },
      });
      if (error) throw error;
      console.log(`[ExportButtons] Response from ${functionName}:`, { engine_version: data?.engine_version, quality_report: data?.quality_report });
      if (data?.url) {
        const response = await fetch(data.url);
        if (!response.ok) throw new Error(`Não foi possível baixar o ${label}.`);

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = formatFileName(courseTitle, label.toUpperCase(), extension);
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        toast({ title: `${label} gerado!` });
      }
    } catch (err: any) {
      toast({ title: `Erro ao exportar ${label}`, description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const isPublished = courseStatus === "published";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {/* Markdown - Free + Pro */}
        <Button variant="outline" size="sm" onClick={handleExportMarkdown} data-testid="button-export-md">
          <Download className="h-4 w-4 mr-1" /> MD
        </Button>

        {/* DOCX - Free + Pro (client-side) */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportDocx}
          disabled={exportingDocx}
          data-testid="button-export-docx"
          title="Exportar como documento Word editável"
        >
          {exportingDocx ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileType className="h-4 w-4 mr-1" />}
          DOCX
        </Button>

        {/* PDF - Pro */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleExportWithFunction("export-pdf", "pdf", setExportingPdf, "PDF")}
          disabled={exportingPdf}
          title={!isPublished ? "Publique o curso primeiro" : undefined}
        >
          {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
          PDF {!isPro && <Badge variant="outline" className="ml-1 text-[10px] px-1">PRO</Badge>}
        </Button>

        {/* PowerPoint - Pro (with customization dialog) */}
        <PptxExportDialog
          onExport={async (options: PptxExportOptions) => {
            setExportingPptx(true);
            try {
              const session = (await supabase.auth.getSession()).data.session;
              if (!session?.access_token) {
                throw new Error("Sessão expirada. Faça login novamente.");
              }

              let data: any = null;
              let engineUsed = "v7-adaptive";

              // ── ENGINE POLICY (v7 definitive) ──
              // Primary engine = export-pptx-v7 (adaptive, topic-agnostic, no QA veto).
              // On ANY v7 failure (infra/timeout/error) we fall back to the proven
              // export-pptx-v4 (engine v5.x), whose semantic QA veto (HTTP 422) is a
              // hard stop. Legacy native engines (v1/v2/v3/v6) and the external
              // providers (2Slides/Presenton) were removed in the v7-definitive cleanup.
              console.log(
                "[PPTX-FRONTEND] preferredEngine=export-pptx-v7 fallback=export-pptx-v4",
              );

              // ── V7 ADAPTIVE ENGINE (PRIMARY) ──
              // Topic-agnostic engine with no QA veto. On ANY failure we fall through
              // to the proven export-pptx-v4 (engine v5.x) below.
              {
                console.log("[PPTX] Using export-pptx-v7 (adaptive engine, primary)...");
                const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-pptx-v7`;
                const EXPORT_TIMEOUT_MS = 480000;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
                try {
                  const res = await fetch(url, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${session.access_token}`,
                      "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                    },
                    body: JSON.stringify({
                      course_id: courseId,
                      palette: options.palette,
                      includeImages: options.includeImages,
                      footerBrand: options.footerBrand,
                      language: "Português (Brasil)",
                    }),
                    signal: controller.signal,
                  });
                  const responseText = await res.text();
                  let v7data: any = {};
                  try { v7data = responseText ? JSON.parse(responseText) : {}; } catch { /* ignore */ }
                  if (res.ok && v7data?.url) {
                    data = v7data;
                    engineUsed = "v7-adaptive";
                    console.log("[PPTX][DIAG]", JSON.stringify({
                      engine: v7data.engine ?? "export-pptx-v7",
                      engine_version: v7data.engine_version,
                      status: v7data.status ?? "exported",
                      slide_count: v7data.slide_count,
                      modules_planned_by_llm: v7data.modules_planned_by_llm,
                      modules_fallback: v7data.modules_fallback,
                      normalize: v7data.normalize,
                    }));
                  } else {
                    console.warn("[PPTX] v7 falhou, tentando fallback v4:", v7data?.error || `HTTP ${res.status}`);
                  }
                } catch (errV7) {
                  console.warn("[PPTX] v7 indisponível, tentando fallback v4:", (errV7 as Error)?.message ?? errV7);
                } finally {
                  clearTimeout(timeoutId);
                }
              }

              // ── V4 NATIVE ENGINE (engine v5.x) — FALLBACK ──
              // Runs only if v7 (primary) did not produce a deck. Its semantic QA
              // veto (HTTP 422) is a hard stop (handled below).
              if (!data?.url) {
                console.log("[PPTX] v7 unavailable → falling back to export-pptx-v4 (engine v5.x)...");
                const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-pptx-v4`;
                const EXPORT_TIMEOUT_MS = 480000;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
                let res: Response | null = null;
                try {
                  res = await fetch(url, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${session.access_token}`,
                      "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                    },
                    body: JSON.stringify({
                      course_id: courseId,
                      palette: options.palette,
                      density: options.density,
                      theme: options.theme,
                      template: options.template,
                      includeImages: options.includeImages,
                      courseType: options.courseType || "CURSO COMPLETO",
                      footerBrand: options.footerBrand,
                    }),
                    signal: controller.signal,
                  });
                } catch (errV4) {
                  // Network error / timeout / AbortError on the fallback engine.
                  // Semantic vetos always come back as a real HTTP 422 and are
                  // handled below; here there is no further engine to try.
                  console.error("[PPTX] v4 (fallback) erro de rede/timeout:", errV4);
                } finally {
                  clearTimeout(timeoutId);
                }
                const responseText = res ? await res.text() : "";
                let v4data: any = {};
                try { v4data = responseText ? JSON.parse(responseText) : {}; } catch { /* ignore */ }
                if (res && res.ok && v4data?.url) {
                  data = v4data;
                  engineUsed = "v4-native";
                  // Unambiguous success log — uses the actual function name + version.
                  console.log(
                    `[PPTX] export-pptx-v4 / engine_version=${v4data.engine_version ?? "unknown"} successful (slides=${v4data.slide_count ?? "?"})`,
                  );
                  // Unified diagnostic line — answers: which engine, version,
                  // fallback, cache, totals, removed, blocking issues, status.
                  console.log("[PPTX][DIAG]", JSON.stringify({
                    engine_function: v4data.engine_function ?? v4data.engine ?? "export-pptx-v4",
                    engine:          v4data.engine ?? "export-pptx-v4",
                    engine_version:  v4data.engine_version,
                    status:          v4data.status ?? "exported",
                    fallback_used:   v4data.fallback_used ?? false,
                    fallback_reason: v4data.fallback_reason ?? null,
                    modules_failed:  v4data.modules_failed ?? 0,
                    accepted_modules: v4data.accepted_modules ?? [],
                    fallback_modules: v4data.fallback_modules ?? [],
                    cache:           v4data.cache ?? "miss",
                    slide_count:     v4data.slide_count,
                    total_slides:    v4data.total_slides ?? v4data.slide_count,
                    qa_status:       v4data.qa?.qa_status ?? "unknown",
                    qa:              v4data.qa,
                    blocking_issues: v4data.blocking_issues ?? [],
                  }));
                  console.log("[PPTX] v4 raw _diag:", JSON.stringify(v4data._diag));
                } else if (res && res.status === 422 && v4data?.code === "PPTX_QA_VETO") {
                  // ── SEMANTIC VETO — DO NOT FALL BACK ──
                  console.error("[PPTX][DIAG]", JSON.stringify({
                    engine:         v4data.engine ?? "export-pptx-v4",
                    engine_version: v4data.engine_version,
                    status:         "blocked",
                    fallback_used:  false,
                    cache:          v4data.cache ?? "miss",
                    totalSlides:    v4data.totalSlides,
                    removedSlides:  v4data.removedSlides,
                    blocking_issues: v4data.blockingIssues,
                  }));
                  console.error("[PPTX] v4 BLOQUEOU export (QA veto):", v4data);
                  const issues: Array<{slideId:string;type:string;message:string}> =
                    v4data?.blockingIssues ?? [];
                  const summary = issues.slice(0, 3)
                    .map((i) => `• ${i.slideId}: ${i.type}`)
                    .join("\n") || "Conteúdo gerado pela IA tem problemas críticos.";
                  toast({
                    title: "Geração bloqueada — qualidade insuficiente",
                    description: `O motor detectou problemas que não puderam ser corrigidos:\n${summary}\n\nRegenere o curso ou ajuste o conteúdo antes de exportar.`,
                    duration: 12000,
                    variant: "destructive",
                  });
                  setExportingPptx(false);
                  return; // hard stop — do NOT fall back to legacy engines
                } else if (res) {
                  console.error("[PPTX] v4 (fallback) também falhou:", v4data?.error || res.status);
                }
              }

              // ── FINAL DOWNLOAD ──
              if (!data?.url) {
                throw new Error("Falha ao gerar o PowerPoint (motores v7 e v5 indisponíveis). Tente novamente.");
              }

              // ── SLIDE LOG: store for /pptx-debug and print to console ──
              if (data?.slide_log?.length) {
                localStorage.setItem("pptx_slide_log", JSON.stringify(data.slide_log));
                console.group(`[PPTX] Slide Log (${data.slide_log.length} slides)`);
                console.table(data.slide_log);
                console.groupEnd();
              }

              console.log(`[PPTX] Downloading from ${engineUsed}:`, data.url);
              const DOWNLOAD_TIMEOUT_MS = 240000;
              const downloadController = new AbortController();
              const downloadTimeoutId = setTimeout(() => downloadController.abort(), DOWNLOAD_TIMEOUT_MS);
              
              let fileRes: Response;
              try {
                fileRes = await fetch(data.url, { signal: downloadController.signal });
              } finally {
                clearTimeout(downloadTimeoutId);
              }

              if (!fileRes.ok) throw new Error("Não foi possível baixar o arquivo final.");
              
              const blob = await fileRes.blob();
              const blobUrl = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = blobUrl;
              const fileLabel =
                engineUsed === "v4-native"   ? "PPTX-v5" :
                engineUsed === "v7-adaptive" ? "PPTX-v7" : "PPTX";
              a.download = formatFileName(courseTitle, fileLabel, "pptx");
              a.rel = "noopener";
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(blobUrl);

              if (data?.quality_report) {
                setQualityReport(data.quality_report);
              }

              const toastTitle =
                engineUsed === "v4-native"   ? "🚀 PowerPoint (motor v5) gerado!" :
                engineUsed === "v7-adaptive" ? "✨ PowerPoint gerado!" :
                "PowerPoint gerado!";
              const toastDesc =
                engineUsed === "v4-native"   ? "Gerado pelo motor v5 (fallback)." :
                engineUsed === "v7-adaptive" ? `${data.slide_count || 0} slides • ${data.modules_planned_by_llm ?? 0} módulos via IA, ${data.modules_fallback ?? 0} fallback` :
                data.quality_report          ? `Score: ${data.quality_report.quality_score}/100` :
                undefined;

              toast({
                title: toastTitle,
                description: toastDesc,
                action: data.quality_report ? (
                  <Button variant="outline" size="sm" onClick={() => setReportOpen(true)}>
                    Ver Detalhes
                  </Button>
                ) : undefined,
              });
            } catch (err: any) {
              const msg = err.name === "AbortError" ? "Timeout — tente novamente" : err.message;
              toast({ title: "Erro ao exportar PowerPoint", description: msg, variant: "destructive" });
            } finally {
              setExportingPptx(false);
            }
          }}
          exporting={exportingPptx}
          disabled={!isPublished}
          isPro={isPro}
        />

        {/* Notion - Pro */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleExportWithFunction("export-notion", "md", setExportingNotion, "Notion")}
          disabled={exportingNotion || !isPublished}
          title={!isPublished ? "Publique o curso primeiro" : undefined}
        >
          {exportingNotion ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <StickyNote className="h-4 w-4 mr-1" />}
          Notion {!isPro && <Badge variant="outline" className="ml-1 text-[10px] px-1">PRO</Badge>}
        </Button>

        {/* Moodle - Pro */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleExportWithFunction("export-moodle", "zip", setExportingMoodle, "Moodle")}
          disabled={exportingMoodle || !isPublished}
          title={!isPublished ? "Publique o curso primeiro" : "Exportar para Moodle (XML Backup)"}
        >
          {exportingMoodle ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <GraduationCap className="h-4 w-4 mr-1" />}
          Moodle {!isPro && <Badge variant="outline" className="ml-1 text-[10px] px-1">PRO</Badge>}
        </Button>

        {/* SCORM - Pro */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleExportWithFunction("export-scorm", "zip", setExportingScorm, "SCORM")}
          disabled={exportingScorm || !isPublished}
          title={!isPublished ? "Publique o curso primeiro" : "Exportar pacote SCORM 1.2 para LMS (Moodle, Canvas, etc.)"}
        >
          {exportingScorm ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Package className="h-4 w-4 mr-1" />}
          SCORM {!isPro && <Badge variant="outline" className="ml-1 text-[10px] px-1">PRO</Badge>}
        </Button>
      </div>

      {/* Quality Report Dialog */}
      <PptxQualityReport
        report={qualityReport}
        open={reportOpen}
        onOpenChange={setReportOpen}
      />
    </>
  );
}