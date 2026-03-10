import { useState } from "react";
import { SlidePreview } from "./SlidePreview";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Presentation, ImageOff, Info } from "lucide-react";

// ── Exported options type ──────────────────────────────────────────
export interface PptxExportOptions {
  palette: "default" | "ocean" | "forest" | "sunset" | "monochrome";
  density: "compact" | "standard" | "detailed";
  includeImages: boolean;
  theme: "light" | "dark";
  template: "default" | "academic" | "corporate" | "creative";
  useV2: boolean;
  courseType: string;
  footerBrand: string | null;
}

// ── Design data ────────────────────────────────────────────────────
const PALETTES: Record<string, { label: string; colors: string[] }> = {
  default: { label: "Padrão (tema do template)", colors: [] }, // colors shown per template
  ocean:      { label: "Oceano",        colors: ["#2980B9", "#3498DB", "#1ABC9C", "#16A085", "#2C3E50"] },
  forest:     { label: "Floresta",      colors: ["#27AE60", "#2ECC71", "#1ABC9C", "#16A085", "#2C3E50"] },
  sunset:     { label: "Pôr do Sol",    colors: ["#E74C3C", "#E67E22", "#F39C12", "#D35400", "#C0392B"] },
  monochrome: { label: "Monocromático", colors: ["#2C3E50", "#34495E", "#7F8C8D", "#95A5A6", "#BDC3C7"] },
};

// Default palette per template — shown in the "Padrão" option preview
const TEMPLATE_DEFAULT_COLORS: Record<string, string[]> = {
  default:   ["#6C63FF", "#3B82F6", "#10B981", "#F59E0B", "#06B6D4"],
  academic:  ["#003366", "#336699", "#FF6600", "#006633", "#660033"],
  corporate: ["#1A1A2E", "#16213E", "#0F3460", "#533483", "#E94560"],
  creative:  ["#2C3E50", "#E74C3C", "#F39C12", "#8E44AD", "#16A085"],
};

const TEMPLATES: Record<string, { label: string; desc: string; fonts: string }> = {
  default: {
    label: "Padrão (EduGenAI)",
    desc: "Montserrat + Open Sans — Estilo educacional moderno",
    fonts: "Montserrat / Open Sans",
  },
  academic: {
    label: "Acadêmico",
    desc: "Times New Roman + Arial — Formal e institucional",
    fonts: "Times New Roman / Arial",
  },
  corporate: {
    label: "Corporativo",
    desc: "Montserrat + Open Sans — Sóbrio e profissional",
    fonts: "Montserrat / Open Sans",
  },
  creative: {
    label: "Criativo",
    desc: "Playfair Display + Lato — Elegante e expressivo",
    fonts: "Playfair Display / Lato",
  },
};

const DENSITY_LABELS: Record<string, { label: string; desc: string; slidesPerModule: string }> = {
  compact:  { label: "Compacto",  desc: "Mais slides, menos texto — ideal para apresentações ágeis",  slidesPerModule: "~5–8 slides/módulo" },
  standard: { label: "Padrão",    desc: "Equilíbrio entre texto e espaço — recomendado",              slidesPerModule: "~7–10 slides/módulo" },
  detailed: { label: "Detalhado", desc: "Slides mais densos — ideal para material de estudo",          slidesPerModule: "~9–14 slides/módulo" },
};

const COURSE_TYPES = [
  "CURSO COMPLETO",
  "WORKSHOP",
  "MÓDULO",
  "TRILHA DE APRENDIZAGEM",
  "WEBINAR",
  "TREINAMENTO",
  "MINI-CURSO",
];

// ── Component ──────────────────────────────────────────────────────
interface Props {
  onExport: (options: PptxExportOptions) => void;
  exporting: boolean;
  disabled: boolean;
  isPro: boolean;
  moduleCount?: number; // optional: number of modules for slide estimate
}

export function PptxExportDialog({ onExport, exporting, disabled, isPro, moduleCount = 5 }: Props) {
  const [open, setOpen] = useState(false);
  const [palette, setPalette]           = useState<PptxExportOptions["palette"]>("default");
  const [density, setDensity]           = useState<PptxExportOptions["density"]>("standard");
  const [includeImages, setIncludeImages] = useState(true);
  const [theme, setTheme]               = useState<PptxExportOptions["theme"]>("light");
  const [template, setTemplate]         = useState<PptxExportOptions["template"]>("default");
  const [courseType, setCourseType]     = useState("CURSO COMPLETO");
  const [footerBrandEnabled, setFooterBrandEnabled] = useState(true);
  const [footerBrandValue, setFooterBrandValue]     = useState("EduGenAI");
  const [useV2] = useState(true);

  // Estimate slide count based on density + module count
  const slideEstimates: Record<string, [number, number]> = {
    compact:  [5, 8],
    standard: [7, 10],
    detailed: [9, 14],
  };
  const [lo, hi] = slideEstimates[density];
  const minSlides = lo * moduleCount + 3; // +3 for cover, TOC, closing
  const maxSlides = hi * moduleCount + 3;

  // Preview colors: use template default when palette = "default"
  const previewColors = palette === "default"
    ? TEMPLATE_DEFAULT_COLORS[template]
    : PALETTES[palette].colors;

  const footerBrand = footerBrandEnabled ? (footerBrandValue.trim() || "EduGenAI") : null;

  const handleExport = () => {
    setOpen(false);
    onExport({ palette, density, includeImages, theme, template, useV2, courseType, footerBrand });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || exporting}>
          {exporting
            ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
            : <Presentation className="h-4 w-4 mr-1" />}
          PPTX {!isPro && <Badge variant="outline" className="ml-1 text-[10px] px-1">PRO</Badge>}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Exportar PowerPoint</DialogTitle>
        </DialogHeader>

        {/* ── Slide Preview ── */}
        <div className="space-y-1.5 py-1">
          <span className="text-xs text-muted-foreground">Pré-visualização</span>
          <SlidePreview
            previewColors={previewColors}
            theme={theme}
            courseType={courseType}
            footerBrand={footerBrand}
            template={template}
          />
        </div>

        <hr className="border-border" />

        <div className="space-y-5 py-2">
          {/* ── Tema Visual (first — sets the overall mood) ── */}
          <div className="space-y-2">
            <Label>Tema Visual</Label>
            <Select value={theme} onValueChange={(v) => setTheme(v as PptxExportOptions["theme"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="light">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full bg-white border border-gray-300" />
                    <span>Claro (fundo branco)</span>
                  </div>
                </SelectItem>
                <SelectItem value="dark">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full bg-slate-900" />
                    <span>Escuro (fundo escuro)</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ── Template ── */}
          <div className="space-y-2">
            <Label>Template</Label>
            <Select value={template} onValueChange={(v) => setTemplate(v as PptxExportOptions["template"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TEMPLATES).map(([key, { label, desc, fonts }]) => (
                  <SelectItem key={key} value={key}>
                    <div className="flex flex-col">
                      <span className="font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">{desc}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground pl-1">
              Fontes: <span className="font-medium">{TEMPLATES[template].fonts}</span>
            </p>
          </div>

          {/* ── Palette ── */}
          <div className="space-y-2">
            <Label>Paleta de Cores</Label>
            <Select value={palette} onValueChange={(v) => setPalette(v as PptxExportOptions["palette"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PALETTES).map(([key, { label }]) => {
                  const colors = key === "default" ? TEMPLATE_DEFAULT_COLORS[template] : PALETTES[key].colors;
                  return (
                    <SelectItem key={key} value={key}>
                      <div className="flex items-center gap-2">
                        <span>{label}</span>
                        <div className="flex gap-0.5">
                          {colors.map((c, i) => (
                            <span key={i} className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {/* Live color preview strip */}
            <div className="flex gap-1 rounded-md overflow-hidden h-2 w-full mt-1">
              {previewColors.map((c, i) => (
                <div key={i} className="flex-1" style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>

          {/* ── Density ── */}
          <div className="space-y-2">
            <Label>Densidade do Conteúdo</Label>
            <Select value={density} onValueChange={(v) => setDensity(v as PptxExportOptions["density"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(DENSITY_LABELS).map(([key, { label, desc, slidesPerModule }]) => (
                  <SelectItem key={key} value={key}>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span>{label}</span>
                        <span className="text-xs text-muted-foreground">({slidesPerModule})</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{desc}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Slide count estimate */}
            <p className="text-xs text-muted-foreground pl-1 flex items-center gap-1">
              <Info className="h-3 w-3" />
              Estimativa: <span className="font-medium text-foreground">{minSlides}–{maxSlides} slides</span> para este curso
            </p>
          </div>

          {/* ── Course type ── */}
          <div className="space-y-2">
            <Label>Tipo de Curso (capa)</Label>
            <Select value={courseType} onValueChange={setCourseType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {COURSE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ── Images toggle ── */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Incluir Imagens</Label>
              <p className="text-xs text-muted-foreground">Imagens temáticas na capa, módulos e encerramento</p>
            </div>
            <Switch checked={includeImages} onCheckedChange={setIncludeImages} />
          </div>
          {includeImages && (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <ImageOff className="h-3.5 w-3.5 shrink-0" />
              Requer integração Unsplash ativa. Se não configurada, o PPTX será gerado sem imagens.
            </div>
          )}

          {/* ── Footer brand ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label>Marca no Rodapé</Label>
                <p className="text-xs text-muted-foreground">Texto exibido no rodapé de todos os slides</p>
              </div>
              <Switch checked={footerBrandEnabled} onCheckedChange={setFooterBrandEnabled} />
            </div>
            {footerBrandEnabled && (
              <Input
                value={footerBrandValue}
                onChange={(e) => setFooterBrandValue(e.target.value)}
                placeholder="Ex: EduGenAI, Minha Escola, etc."
                maxLength={40}
                className="text-sm"
              />
            )}
          </div>

          {/* ── Compatibility note ── */}
          <div className="rounded-md border border-border bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">
              📎 O arquivo gerado é um <strong>.pptx padrão</strong>, totalmente editável no PowerPoint, Google Slides, Canva, LibreOffice Impress e Keynote.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Gerar PPTX
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
