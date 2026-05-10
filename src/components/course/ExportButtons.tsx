import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  Download, FileText, Loader2, Package, StickyNote, GraduationCap,
} from "lucide-react";
import { PptxExportDialog, type PptxExportOptions } from "./PptxExportDialog";
import { PptxQualityReport, type QualityReport } from "./PptxQualityReport";

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
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const formatFileName = (title: string, format: string, ext: string) => {
    const safe = (title || "curso").replace(/[^\w\s\-àáâãéêíóôõúüçÀÁÂÃÉÊÍÓÔÕÚÜÇ]/gi, "").trim();
    const date = new Date().toISOString().slice(0, 10);
    return `${safe} - ${format} - ${date}.${ext}`;
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
        <Button variant="outline" size="sm" onClick={handleExportMarkdown}>
          <Download className="h-4 w-4 mr-1" /> MD
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
              let engineUsed = "v3-native";

              // ── MAGICSLIDES PRO (Try first if enabled) ──
              if (options.useMagicSlides) {
                console.log("[PPTX] Attempting MagicSlides Pro export...");
                try {
                  const magicRes = await supabase.functions.invoke("export-pptx-v3-magicslides", {
                    body: { 
                      course_id: courseId, 
                      template: options.template,
                      language: "Português (Brasil)" // Default or from context
                    },
                  });

                  if (magicRes.data?.url && !magicRes.error) {
                    data = magicRes.data;
                    engineUsed = "magicslides";
                    console.log("[PPTX] MagicSlides Pro successful!");
                  } else {
                    console.warn("[PPTX] MagicSlides failed, falling back to native engine...", magicRes.error);
                    toast({ 
                      title: "MagicSlides (Beta) indisponível", 
                      description: "Usando motor nativo EduGen v3 como fallback automático.",
                      duration: 4000
                    });
                  }
                } catch (magicErr) {
                  console.error("[PPTX] MagicSlides crash:", magicErr);
                }
              }

              // ── NATIVE ENGINE (If MagicSlides failed or wasn't requested) ──
              if (!data?.url) {
                const functionName = options.useV3 ? "export-pptx-v3" : options.useV2 ? "export-pptx-v2" : "export-pptx";
                const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`;
                console.log(`[PPTX] Starting native export to: ${url} (engine: ${functionName})`);
                
                const EXPORT_TIMEOUT_MS = 480000;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), EXPORT_TIMEOUT_MS);
                
                let res: Response;
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
                      includeImages: options.includeImages, 
                      theme: options.theme, 
                      template: options.template 
                    }),
                    signal: controller.signal,
                  });
                } finally {
                  clearTimeout(timeoutId);
                }

                const responseText = await res.text();
                try {
                  data = responseText ? JSON.parse(responseText) : {};
                } catch {
                  throw new Error(!res.ok ? `Erro na exportação (HTTP ${res.status}).` : "Resposta inválida.");
                }

                if (!res.ok) {
                  if (data?.quality_report && !data?.quality_report?.passed) {
                    setQualityReport(data.quality_report);
                    setReportOpen(true);
                    return;
                  }
                  throw new Error(data?.error || `Erro na exportação (HTTP ${res.status})`);
                }
                engineUsed = options.useV3 ? "v3-native" : "v2-legacy";
              }

              // ── FINAL DOWNLOAD ──
              if (!data?.url) {
                throw new Error("Exportação concluída sem URL de download.");
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
              a.download = formatFileName(courseTitle, engineUsed === "magicslides" ? "PPTX-PRO" : "PPTX", "pptx");
              a.rel = "noopener";
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(blobUrl);

              if (data?.quality_report) {
                setQualityReport(data.quality_report);
              }

              toast({
                title: engineUsed === "magicslides" ? "PowerPoint Pro gerado!" : "PowerPoint gerado!",
                description: data.quality_report 
                  ? `Score: ${data.quality_report.quality_score}/100` 
                  : (engineUsed === "magicslides" ? "Design premium aplicado com sucesso." : undefined),
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

        {/* SCORM - Business */}
        <Button
          variant="outline"
          size="sm"
          disabled={true}
          title="Disponível no plano Business (em breve)"
        >
          <Package className="h-4 w-4 mr-1" />
          SCORM <Badge variant="outline" className="ml-1 text-[10px] px-1">Business</Badge>
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