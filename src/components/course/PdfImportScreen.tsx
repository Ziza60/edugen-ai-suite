import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, ArrowRight, Loader2, CheckCircle2, AlertCircle,
  FileText, Upload, X, BookOpen, Users, Layers, Globe2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  motivoDasRecusas, selecionarArquivos,
  type ArquivoRecusado, type RegrasDeSelecao,
} from "@/lib/selecao-de-arquivos";
import {
  analiseDoConjunto, irmaosParaAnalise, type IrmaoDeclarado,
} from "@/lib/metadados-do-conjunto";
import { motion, AnimatePresence } from "framer-motion";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import JSZip from "jszip";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const LANGUAGE_OPTIONS = [
  { value: "pt-BR", label: "🇧🇷 Português (BR)" },
  { value: "en",   label: "🇺🇸 English" },
  { value: "es",   label: "🇪🇸 Español" },
  { value: "fr",   label: "🇫🇷 Français" },
  { value: "de",   label: "🇩🇪 Deutsch" },
];

const LOADING_STEPS = [
  "Lendo arquivo…",
  "Extraindo texto…",
  "Analisando conteúdo com IA…",
  "Estruturando os módulos…",
];

export interface FonteAnalisada {
  id: string;
  filename: string;
  char_count: number;
}

export interface PdfAnalysis {
  source_id: string;
  filename: string;
  char_count: number;
  title: string;
  theme: string;
  targetAudience: string;
  suggestedModules: number;
  detectedLanguage: string;
  summary: string;
  /**
   * Expressões de duas palavras do título que NÃO aparecem em nenhum documento
   * enviado — terminologia que o modelo trouxe de fora, num curso cuja premissa
   * é que nada vem de fora. Verificado pela função, não pelo modelo.
   */
  aviso_vocabulario?: string | null;
  termos_fora_das_fontes?: string[];
  /**
   * Todas as fontes analisadas nesta tela, na ordem em que foram escolhidas.
   * O PRIMEIRO documento é o que preenche título, tema, público e número de
   * módulos; os demais entram como fonte adicional do mesmo curso. Um manual
   * dividido em capítulos só ensina o que está em todos eles.
   */
  sources: FonteAnalisada[];
}

interface PdfImportScreenProps {
  tempCourseId: string;
  /** Teto de fontes do plano do usuário — quem conhece o plano é o wizard. */
  maxFiles: number;
  onBack: () => void;
  onComplete: (analysis: PdfAnalysis) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function textToDocxFile(text: string, originalName: string): Promise<File> {
  const paragraphs = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<w:p ><w:r><w:t xml:space="preserve">${escapeXml(l)}</w:t></w:r></w:p>`)
    .join("\n");

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>\n${paragraphs}\n</w:body></w:document>`;

  const zip = new JSZip();
  zip.file("word/document.xml", docXml);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const name = originalName.replace(/\.pdf$/i, ".docx");
  return new File([blob], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// Build a minimal multi-page PDF from JPEG page images (keeps size tiny)
function buildMinimalPdf(
  pages: Array<{ jpeg: Uint8Array; w: number; h: number }>,
): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;

  function str(s: string): Uint8Array {
    const b = enc.encode(s);
    parts.push(b);
    pos += b.length;
    return b;
  }
  function raw(b: Uint8Array): void {
    parts.push(b);
    pos += b.length;
  }
  function mark(n: number): void {
    offsets[n - 1] = pos;
  }

  const n = pages.length;
  // obj numbering: 1=catalog, 2=pages, then per page: 3+i*3=page, 4+i*3=img, 5+i*3=content
  const totalObjs = 2 + n * 3;

  str("%PDF-1.4\n");

  mark(1);
  str("1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n");

  mark(2);
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  str(`2 0 obj\n<</Type /Pages /Kids [${kids}] /Count ${n}>>\nendobj\n`);

  for (let i = 0; i < n; i++) {
    const { jpeg, w, h } = pages[i];
    const pageId    = 3 + i * 3;
    const imgId     = 4 + i * 3;
    const contentId = 5 + i * 3;

    mark(pageId);
    str(`${pageId} 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources <</XObject <</Im${i + 1} ${imgId} 0 R>>>> /Contents ${contentId} 0 R>>\nendobj\n`);

    mark(imgId);
    str(`${imgId} 0 obj\n<</Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length}>>\nstream\n`);
    raw(jpeg);
    str("\nendstream\nendobj\n");

    mark(contentId);
    const cs = `q ${w} 0 0 ${h} 0 0 cm /Im${i + 1} Do Q`;
    str(`${contentId} 0 obj\n<</Length ${cs.length}>>\nstream\n${cs}\nendstream\nendobj\n`);
  }

  const xrefPos = pos;
  str(`xref\n0 ${totalObjs + 1}\n`);
  str("0000000000 65535 f \n");
  for (let i = 0; i < totalObjs; i++) {
    str(String(offsets[i]).padStart(10, "0") + " 00000 n \n");
  }
  str(`trailer\n<</Size ${totalObjs + 1} /Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`);

  const total = parts.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}

// Render PDF pages as small JPEGs and pack into a tiny PDF (for scanned/image PDFs)
async function renderPdfToMiniPdf(pdfFile: File): Promise<File> {
  const buffer = await pdfFile.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const numPages = Math.min(pdf.numPages, 4);  // max 4 pages for size budget
  const pages: Array<{ jpeg: Uint8Array; w: number; h: number }> = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const nativeVp = page.getViewport({ scale: 1 });
    // Target 320px wide — keeps each JPEG under ~10KB at quality 0.2
    const scale = 320 / nativeVp.width;
    const vp = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width  = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;

    const blob = await new Promise<Blob>((res) =>
      canvas.toBlob((b) => res(b!), "image/jpeg", 0.2),
    );
    pages.push({
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      w: canvas.width,
      h: canvas.height,
    });
  }

  const pdfBytes = buildMinimalPdf(pages);
  const totalKB = (pdfBytes.length / 1024).toFixed(1);
  console.log(`[PdfImport] mini-PDF size: ${totalKB} KB for ${numPages} pages`);

  return new File([pdfBytes as unknown as BlobPart], pdfFile.name, { type: "application/pdf" });
}

type RespostaDaAnalise = Omit<PdfAnalysis, "sources">;

const TAMANHO_MAX_BYTES = 50 * 1024 * 1024;
const EXTENSOES = ["pdf", "docx"];

class FalhaDeAnalise extends Error {
  constructor(message: string, readonly limiteHorario = false) {
    super(message);
  }
}

/**
 * PDF de texto vira DOCX (a edge function não tem `btoa` para binário grande);
 * PDF escaneado vira um PDF mínimo de imagens. DOCX segue como está.
 */
async function prepararParaEnvio(
  arquivo: File, avisarPasso: (passo: number) => void,
): Promise<File> {
  const ext = arquivo.name.split(".").pop()?.toLowerCase();
  if (ext !== "pdf") return arquivo;

  avisarPasso(1);

  let textoExtraido = "";
  try {
    const ab = await arquivo.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    const partes: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      partes.push(
        content.items.map((item: any) => ("str" in item ? item.str : "")).join(" "),
      );
    }
    textoExtraido = partes.join("\n\n").trim();
  } catch (e) {
    console.warn("[PdfImport] text extraction failed:", e);
  }

  if (textoExtraido.length >= 100) {
    console.log(`[PdfImport] ${arquivo.name}: texto → DOCX (${textoExtraido.length} chars)`);
    return textToDocxFile(textoExtraido, arquivo.name);
  }
  console.log(`[PdfImport] ${arquivo.name}: PDF de imagem, renderizando páginas…`);
  return renderPdfToMiniPdf(arquivo);
}

async function enviarParaAnalise(
  arquivo: File, courseId: string, accessToken: string,
  irmaos: IrmaoDeclarado[] = [],
): Promise<RespostaDaAnalise> {
  const formData = new FormData();
  formData.append("file", arquivo);
  formData.append("course_id", courseId);
  // Declarar os documentos já analisados é o que permite à função escrever
  // título e tema do CONJUNTO, em vez de um curso por documento.
  if (irmaos.length) {
    formData.append("outros_documentos", JSON.stringify(irmaos));
  }

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-pdf-source`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    },
  );

  const result = await res.json().catch(() => ({} as any));
  if (res.status === 429) {
    throw new FalhaDeAnalise(
      result.error || "Limite de análises por hora atingido.", true,
    );
  }
  if (!res.ok) throw new FalhaDeAnalise(result.error || "Erro ao processar o arquivo.");
  return result as RespostaDaAnalise;
}

export function PdfImportScreen({
  tempCourseId, maxFiles, onBack, onComplete,
}: PdfImportScreenProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [emAnalise, setEmAnalise] = useState<{ indice: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [falhas, setFalhas] = useState<ArquivoRecusado[]>([]);
  const [analysis, setAnalysis] = useState<PdfAnalysis | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState("pt-BR");

  const regras: RegrasDeSelecao = {
    extensoes: EXTENSOES,
    tamanhoMaxBytes: TAMANHO_MAX_BYTES,
    maxArquivos: maxFiles,
  };

  /**
   * Um caminho só para o clique e para o arrastar. Antes eram dois, e os dois
   * liam `files[0]`: o segundo documento era descartado sem dizer nada.
   */
  const receberArquivos = useCallback((escolhidos: FileList | File[] | null) => {
    const lista = escolhidos ? Array.from(escolhidos) : [];
    if (lista.length === 0) return;

    setFiles((atuais) => {
      const { aceitos, recusados } = selecionarArquivos(lista, atuais, regras);
      setError(motivoDasRecusas(recusados));
      return [...atuais, ...aceitos];
    });
  }, [maxFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    receberArquivos(e.dataTransfer.files);
  }, [receberArquivos]);

  const removerArquivo = (nome: string) => {
    setFiles((atuais) => atuais.filter((f) => f.name !== nome));
    setError(null);
  };

  const handleAnalyze = async () => {
    if (files.length === 0) return;
    setError(null);
    setFalhas([]);
    setLoading(true);
    setLoadingStep(0);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada. Faça login novamente.");

      const analises: RespostaDaAnalise[] = [];
      const naoAnalisados: ArquivoRecusado[] = [];

      // EM SÉRIE, de propósito: a análise é cara e o limite por hora é pequeno
      // (3 no plano free). Em paralelo, um 429 queimaria os outros documentos.
      for (let i = 0; i < files.length; i++) {
        setEmAnalise({ indice: i + 1, total: files.length });
        setLoadingStep(0);
        try {
          const paraEnviar = await prepararParaEnvio(files[i], setLoadingStep);
          setLoadingStep(2);
          analises.push(await enviarParaAnalise(
            paraEnviar, tempCourseId, session.access_token,
            irmaosParaAnalise(analises),
          ));
          setLoadingStep(3);
        } catch (err: any) {
          naoAnalisados.push({
            nome: files[i].name,
            motivo: err?.message || "não foi possível processar",
          });
          // Limite por hora atingido: insistir só queima os que faltam.
          if (err instanceof FalhaDeAnalise && err.limiteHorario) break;
        }
      }

      if (analises.length === 0) {
        setError(
          naoAnalisados[0]?.motivo || "Não foi possível processar os arquivos.",
        );
        return;
      }

      // O título e o tema saem da análise que conheceu TODOS os documentos, e
      // não da primeira. A lista de fontes mantém a ordem que o usuário escolheu.
      const doConjunto = analiseDoConjunto(analises)!;
      setAnalysis({
        ...doConjunto,
        sources: analises.map((a) => ({
          id: a.source_id, filename: a.filename, char_count: a.char_count,
        })),
      });
      setFalhas(naoAnalisados);

      const lang = LANGUAGE_OPTIONS.find((l) => l.value === doConjunto.detectedLanguage);
      setSelectedLanguage(lang ? doConjunto.detectedLanguage : "pt-BR");
    } catch (err: any) {
      setError(err.message || "Não foi possível processar o arquivo.");
    } finally {
      setEmAnalise(null);
      setLoading(false);
    }
  };

  const handleContinue = () => {
    if (analysis) onComplete({ ...analysis, detectedLanguage: selectedLanguage });
  };

  const totalChars = analysis?.sources.reduce((s, f) => s + f.char_count, 0) ?? 0;

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="bg-card border-b border-border">
        <div className="max-w-[840px] mx-auto px-6 py-4 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Voltar
          </Button>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <FileText className="h-4 w-4 text-blue-500" />
            </div>
            <h1 className="font-display text-lg font-bold text-foreground">PDF / DOCX → Curso</h1>
          </div>
        </div>
      </div>

      <div className="max-w-[640px] mx-auto px-6 py-10 space-y-6">
        <AnimatePresence mode="wait">
          {!analysis ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="space-y-6"
            >
              <div className="text-center space-y-3">
                <div className="h-16 w-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto">
                  <FileText className="h-8 w-8 text-blue-500" />
                </div>
                <h2 className="font-display text-2xl font-bold text-foreground">
                  Transforme seu documento em curso
                </h2>
                <p className="text-muted-foreground text-sm max-w-md mx-auto">
                  Faça upload de um ou mais PDF/DOCX — apostila, manual, treinamento
                  corporativo — e a IA cria a estrutura do curso automaticamente. Um
                  manual dividido em capítulos pode entrar inteiro: anexe todos.
                </p>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                data-testid="pdf-dropzone"
                className={`relative border-2 border-dashed rounded-2xl p-8 text-center transition-all ${
                  isDragging
                    ? "border-blue-500 bg-blue-500/5"
                    : files.length > 0
                    ? "border-green-500/50 bg-green-500/5"
                    : "border-border hover:border-blue-400 hover:bg-blue-500/5"
                }`}
              >
                {files.length > 0 ? (
                  <div className="space-y-2">
                    {files.map((f, i) => (
                      <div key={f.name} className="flex items-center gap-3 text-left">
                        <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                          <FileText className="h-5 w-5 text-blue-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate text-sm">{f.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(f.size)}
                            {files.length > 1 && i === 0 && " · documento principal"}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          aria-label={`Remover ${f.name}`}
                          onClick={() => removerArquivo(f.name)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}

                    {files.length < maxFiles ? (
                      <label className="flex items-center justify-center gap-2 cursor-pointer select-none pt-3 mt-1 border-t border-border/60 text-sm text-muted-foreground hover:text-foreground transition-colors">
                        <input
                          type="file"
                          accept=".pdf,.docx"
                          multiple
                          className="hidden"
                          data-testid="pdf-file-input-mais"
                          onChange={(e) => { receberArquivos(e.target.files); e.target.value = ""; }}
                        />
                        <Upload className="h-3.5 w-3.5" />
                        Adicionar outro documento · {files.length}/{maxFiles}
                      </label>
                    ) : (
                      <p className="text-xs text-muted-foreground pt-3 mt-1 border-t border-border/60">
                        Limite do seu plano: {maxFiles} documento{maxFiles > 1 ? "s" : ""}.
                      </p>
                    )}
                  </div>
                ) : (
                  <label className="flex flex-col items-center gap-3 cursor-pointer select-none">
                    <input
                      type="file"
                      accept=".pdf,.docx"
                      multiple
                      className="hidden"
                      data-testid="pdf-file-input"
                      onChange={(e) => { receberArquivos(e.target.files); e.target.value = ""; }}
                    />
                    <Upload className="h-8 w-8 text-muted-foreground/50" />
                    <div>
                      <p className="font-medium text-foreground">Arraste os arquivos aqui</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        ou clique para selecionar — pode marcar vários de uma vez
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-2">
                      <Badge variant="outline" className="text-[11px]">PDF</Badge>
                      <Badge variant="outline" className="text-[11px]">DOCX</Badge>
                      <Badge variant="outline" className="text-[11px]">Até 50 MB cada</Badge>
                      <Badge variant="outline" className="text-[11px]">
                        Até {maxFiles} {maxFiles > 1 ? "documentos" : "documento"}
                      </Badge>
                    </div>
                  </label>
                )}
              </div>

              {loading && (
                <Card className="border-blue-500/20 bg-blue-500/5">
                  <CardContent className="p-5 space-y-3">
                    {emAnalise && emAnalise.total > 1 && (
                      <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
                        Documento {emAnalise.indice} de {emAnalise.total}
                        {files[emAnalise.indice - 1] && ` — ${files[emAnalise.indice - 1].name}`}
                      </p>
                    )}
                    {LOADING_STEPS.map((step, i) => (
                      <div key={i} className="flex items-center gap-3">
                        {i < loadingStep ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        ) : i === loadingStep ? (
                          <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />
                        ) : (
                          <div className="h-4 w-4 rounded-full border-2 border-border shrink-0" />
                        )}
                        <span className={`text-sm ${i <= loadingStep ? "text-foreground" : "text-muted-foreground"}`}>
                          {step}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {error && (
                <div className="flex items-start gap-2 text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p className="text-sm">{error}</p>
                </div>
              )}

              <Button
                className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                disabled={files.length === 0 || loading}
                onClick={handleAnalyze}
                data-testid="pdf-analyze-btn"
              >
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Processando…</>
                ) : (
                  <>
                    {files.length > 1
                      ? `Analisar ${files.length} documentos com IA`
                      : "Analisar com IA"}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: BookOpen, label: "Apostilas e manuais" },
                  { icon: Users, label: "Treinamentos de RH" },
                  { icon: Layers, label: "Documentação técnica" },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-muted/40 text-center">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground leading-tight">{label}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-5"
            >
              <div className="text-green-600 bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">
                    {analysis.sources.length === 1
                      ? "Arquivo analisado"
                      : `${analysis.sources.length} documentos analisados`}
                    {" — "}
                    {totalChars.toLocaleString("pt-BR")} caracteres extraídos
                  </span>
                </div>
                {analysis.sources.length > 1 && (
                  <ul className="text-xs text-green-700/90 pl-6 space-y-0.5">
                    {analysis.sources.map((s) => (
                      <li key={s.id} className="truncate">
                        {s.filename} · {s.char_count.toLocaleString("pt-BR")} chars
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {falhas.length > 0 && (
                <div className="flex items-start gap-2 text-amber-700 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="text-sm space-y-0.5">
                    <p className="font-medium">
                      {falhas.length === 1
                        ? "Um documento não entrou:"
                        : `${falhas.length} documentos não entraram:`}
                    </p>
                    <ul className="text-xs space-y-0.5">
                      {falhas.map((f) => (
                        <li key={f.nome}>{f.nome} — {f.motivo}</li>
                      ))}
                    </ul>
                    <p className="text-xs pt-1">
                      O curso será gerado só com o que foi analisado. Para incluir o
                      resto, volte e tente de novo.
                    </p>
                  </div>
                </div>
              )}

              <Card>
                <CardContent className="p-6 space-y-5">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Título sugerido</p>
                    <h3 className="font-display text-xl font-bold text-foreground">{analysis.title}</h3>
                    {analysis.sources.length > 1 && (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Escopo sugerido a partir dos {analysis.sources.length} documentos
                        juntos. Confira se ele corresponde ao que as fontes realmente
                        cobrem — você pode editar título e tema no próximo passo.
                      </p>
                    )}
                    {analysis.aviso_vocabulario && (
                      <div className="flex items-start gap-2 text-amber-700 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mt-2.5">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <p className="text-xs">
                          {analysis.aviso_vocabulario}{" "}
                          Em áreas técnicas, um termo parecido pode significar outra
                          coisa — vale conferir se é o nome que a sua fonte usa.
                        </p>
                      </div>
                    )}
                  </div>

                  {analysis.summary && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Resumo</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{analysis.summary}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-start gap-2">
                      <Users className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Público-alvo</p>
                        <p className="text-sm text-foreground mt-0.5">{analysis.targetAudience}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Layers className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Módulos sugeridos</p>
                        <p className="text-sm text-foreground mt-0.5">{analysis.suggestedModules} módulos</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-3 border-t border-border">
                    <Globe2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground">Idioma do curso:</span>
                    <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                      <SelectTrigger className="h-8 w-[180px] text-sm" data-testid="pdf-lang-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGE_OPTIONS.map((l) => (
                          <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setAnalysis(null);
                    setFiles([]);
                    setFalhas([]);
                    setError(null);
                  }}
                >
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  {analysis.sources.length > 1 ? "Trocar documentos" : "Usar outro arquivo"}
                </Button>
                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                  onClick={handleContinue}
                  data-testid="pdf-continue-btn"
                >
                  Continuar para o wizard
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
