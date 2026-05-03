import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Presentation, ImageOff, Info, Check } from "lucide-react";

// ── Exported options type ──────────────────────────────────────────
export interface PptxExportOptions {
  palette: "default" | "ocean" | "forest" | "sunset" | "monochrome";
  density: "compact" | "standard" | "detailed";
  includeImages: boolean;
  theme: "light" | "dark";
  template: string;
  useV2: boolean;
  useV3: boolean;
  useMagicSlides: boolean;
  use2Slides: boolean;
  twoSlidesTheme: string;
  courseType: string;
  footerBrand: string | null;
}

// ── Visual Templates — each defines its complete look ──────────────
interface VisualTemplate {
  label: string;
  tagline: string;
  theme: "light" | "dark";
  visualStyle: "classic" | "band" | "minimal";
  colors: string[];   // primary accent colors for preview
  bgColor: string;
  textColor: string;
  accentColor: string;
}

const VISUAL_TEMPLATES: Record<string, VisualTemplate> = {
  modern: {
    label: "Moderno Escuro",
    tagline: "Sofisticado e impactante",
    theme: "dark",
    visualStyle: "classic",
    colors: ["#4F46E5", "#7C3AED", "#0891B2"],
    bgColor: "#070C1C",
    textColor: "#E8EDF5",
    accentColor: "#4F46E5",
  },
  band: {
    label: "Faixa Colorida",
    tagline: "Header colorido — estilo McKinsey",
    theme: "light",
    visualStyle: "band",
    colors: ["#4F46E5", "#E11D48", "#0891B2"],
    bgColor: "#FFFFFF",
    textColor: "#1E293B",
    accentColor: "#4F46E5",
  },
  minimal: {
    label: "Minimalista",
    tagline: "Limpo e focado no conteúdo",
    theme: "light",
    visualStyle: "minimal",
    colors: ["#1E293B", "#475569", "#94A3B8"],
    bgColor: "#FFFFFF",
    textColor: "#1E293B",
    accentColor: "#1E293B",
  },
  tech: {
    label: "Tech / Dev",
    tagline: "Ideal para cursos de tecnologia",
    theme: "dark",
    visualStyle: "classic",
    colors: ["#2563EB", "#06B6D4", "#10B981"],
    bgColor: "#0A0E1A",
    textColor: "#E2E8F0",
    accentColor: "#2563EB",
  },
  executive: {
    label: "Executivo",
    tagline: "Corporativo — treinamentos e relatórios",
    theme: "light",
    visualStyle: "band",
    colors: ["#1E3A5F", "#2563EB", "#475569"],
    bgColor: "#F8FAFC",
    textColor: "#0F172A",
    accentColor: "#1E3A5F",
  },
};

// ── Mini Slide Preview Card ────────────────────────────────────────
function TemplateMiniPreview({ id, tpl, selected, onClick }: {
  id: string;
  tpl: VisualTemplate;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={`template-card-${id}`}
      onClick={onClick}
      className={`relative flex flex-col rounded-xl border-2 overflow-hidden transition-all text-left w-full ${
        selected
          ? "border-primary shadow-md shadow-primary/20"
          : "border-border hover:border-primary/40"
      }`}
    >
      {/* Mini slide preview */}
      <div
        className="w-full h-[78px] relative overflow-hidden"
        style={{ backgroundColor: tpl.bgColor }}
      >
        {tpl.visualStyle === "band" && (
          <>
            <div className="absolute inset-x-0 top-0 h-[28px]" style={{ backgroundColor: tpl.accentColor }} />
            <div className="absolute top-[4px] left-[8px] text-[5px] font-bold tracking-widest opacity-60" style={{ color: "#fff" }}>SEÇÃO</div>
            <div className="absolute top-[10px] left-[8px] right-[8px] text-[7px] font-bold leading-tight" style={{ color: "#fff" }}>
              Título do Slide
            </div>
            <div className="absolute top-[34px] left-[8px] right-[8px] space-y-[3px]">
              {[100, 85, 90].map((w, i) => (
                <div key={i} className="h-[3px] rounded-full opacity-40" style={{ width: `${w}%`, backgroundColor: tpl.accentColor }} />
              ))}
            </div>
          </>
        )}
        {tpl.visualStyle === "minimal" && (
          <>
            <div className="absolute top-[6px] left-[8px] w-[12px] h-[2px] rounded" style={{ backgroundColor: tpl.accentColor }} />
            <div className="absolute top-[11px] left-[8px] right-[8px] text-[8px] font-bold" style={{ color: tpl.textColor }}>
              Título do Slide
            </div>
            <div className="absolute top-[24px] left-[8px] text-[5px] font-bold tracking-widest opacity-50" style={{ color: tpl.accentColor }}>SEÇÃO</div>
            <div className="absolute top-[33px] left-[8px] right-[8px] space-y-[3px]">
              {[100, 85, 92].map((w, i) => (
                <div key={i} className="h-[3px] rounded-full opacity-30" style={{ width: `${w}%`, backgroundColor: tpl.textColor }} />
              ))}
            </div>
          </>
        )}
        {tpl.visualStyle === "classic" && (
          <>
            <div className="absolute top-[6px] left-[8px] text-[5px] font-bold tracking-widest" style={{ color: tpl.accentColor }}>SEÇÃO</div>
            <div className="absolute top-[13px] left-[8px] right-[8px] text-[7px] font-bold" style={{ color: tpl.textColor }}>
              Título do Slide
            </div>
            <div className="absolute top-[25px] left-[8px] right-[8px] space-y-[3px]">
              {[100, 85, 90].map((w, i) => (
                <div key={i} className="h-[3px] rounded-full opacity-40" style={{ width: `${w}%`, backgroundColor: tpl.accentColor }} />
              ))}
            </div>
            {/* Left accent edge */}
            <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: tpl.accentColor }} />
          </>
        )}
        {/* Color palette dots */}
        <div className="absolute bottom-[5px] right-[6px] flex gap-[3px]">
          {tpl.colors.map((c, i) => (
            <div key={i} className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: c }} />
          ))}
        </div>
        {/* Dark/light badge */}
        <div
          className="absolute top-[4px] right-[5px] text-[5px] font-bold px-[4px] py-[1px] rounded-full"
          style={{
            backgroundColor: tpl.theme === "dark" ? "#1e293b" : "#e2e8f0",
            color: tpl.theme === "dark" ? "#94a3b8" : "#475569",
          }}
        >
          {tpl.theme === "dark" ? "DARK" : "LIGHT"}
        </div>
      </div>

      {/* Card label */}
      <div className={`px-3 py-2 ${selected ? "bg-primary/5" : "bg-card"}`}>
        <p className="text-xs font-semibold leading-tight" style={{ color: selected ? undefined : undefined }}>
          {tpl.label}
        </p>
        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{tpl.tagline}</p>
      </div>

      {selected && (
        <div className="absolute top-2 left-2 bg-primary rounded-full p-0.5">
          <Check className="h-2.5 w-2.5 text-white" />
        </div>
      )}
    </button>
  );
}

// ── Palettes ───────────────────────────────────────────────────────
const PALETTES: Record<string, { label: string; colors: string[] }> = {
  default:    { label: "Padrão do template", colors: [] },
  ocean:      { label: "Oceano",        colors: ["#2980B9", "#3498DB", "#1ABC9C", "#16A085", "#2C3E50"] },
  forest:     { label: "Floresta",      colors: ["#27AE60", "#2ECC71", "#1ABC9C", "#16A085", "#2C3E50"] },
  sunset:     { label: "Pôr do Sol",    colors: ["#E74C3C", "#E67E22", "#F39C12", "#D35400", "#C0392B"] },
  monochrome: { label: "Monocromático", colors: ["#2C3E50", "#34495E", "#7F8C8D", "#95A5A6", "#BDC3C7"] },
};

const DENSITY_LABELS: Record<string, { label: string; desc: string; slidesPerModule: string }> = {
  compact:  { label: "Compacto",  desc: "Menos slides, mais visual — ideal para apresentações ágeis",  slidesPerModule: "~5–7 slides/módulo" },
  standard: { label: "Padrão",    desc: "Equilíbrio entre conteúdo e espaço — recomendado",              slidesPerModule: "~6–8 slides/módulo" },
  detailed: { label: "Detalhado", desc: "Slides densos — ideal para material de estudo aprofundado",     slidesPerModule: "~7–9 slides/módulo" },
};

const COURSE_TYPES = [
  "CURSO COMPLETO", "WORKSHOP", "MÓDULO",
  "TRILHA DE APRENDIZAGEM", "WEBINAR", "TREINAMENTO", "MINI-CURSO",
];

// ── Component ──────────────────────────────────────────────────────
interface Props {
  onExport: (options: PptxExportOptions) => void;
  exporting: boolean;
  disabled: boolean;
  isPro: boolean;
  moduleCount?: number;
}

export function PptxExportDialog({ onExport, exporting, disabled, isPro, moduleCount = 5 }: Props) {
  const [open, setOpen]                               = useState(false);
  const [palette, setPalette]                         = useState<PptxExportOptions["palette"]>("default");
  const [density, setDensity]                         = useState<PptxExportOptions["density"]>("standard");
  const [includeImages, setIncludeImages]             = useState(true);
  const [template, setTemplate]                       = useState("modern");
  const [courseType, setCourseType]                   = useState("CURSO COMPLETO");
  const [footerBrandEnabled, setFooterBrandEnabled]   = useState(true);
  const [footerBrandValue, setFooterBrandValue]       = useState("EduGenAI");
  const [useV2]                                       = useState(true);
  const [useV3, setUseV3]                             = useState(true);
  const [useMagicSlides, setUseMagicSlides]           = useState(false);
  const [use2Slides, setUse2Slides]                   = useState(false);
  const [twoSlidesTheme, setTwoSlidesTheme]           = useState("blue-gradient");

  const selectedTpl = VISUAL_TEMPLATES[template] || VISUAL_TEMPLATES.modern;
  const theme = selectedTpl.theme;

  const slideEstimates: Record<string, [number, number]> = {
    compact:  [5, 7],
    standard: [6, 8],
    detailed: [7, 9],
  };
  const [lo, hi] = slideEstimates[density];
  const minSlides = lo * moduleCount + 3;
  const maxSlides = hi * moduleCount + 3;

  const previewColors = palette === "default"
    ? selectedTpl.colors
    : PALETTES[palette].colors;

  const footerBrand = footerBrandEnabled ? (footerBrandValue.trim() || "EduGenAI") : null;

  const handleExport = () => {
    setOpen(false);
    onExport({ palette, density, includeImages, theme, template, useV2, useV3, useMagicSlides, use2Slides, twoSlidesTheme, courseType, footerBrand });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || exporting} data-testid="button-export-pptx">
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

        <div className="space-y-5 py-2">
          {/* ── Template Visual Cards ── */}
          <div className="space-y-2">
            <Label>Template Visual</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(VISUAL_TEMPLATES).map(([id, tpl]) => (
                <TemplateMiniPreview
                  key={id}
                  id={id}
                  tpl={tpl}
                  selected={template === id}
                  onClick={() => setTemplate(id)}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground pl-1">
              Tema: <span className="font-medium">{selectedTpl.theme === "dark" ? "Escuro" : "Claro"}</span>
              {" · "}
              Layout: <span className="font-medium capitalize">{selectedTpl.visualStyle === "band" ? "Faixa no topo" : selectedTpl.visualStyle === "minimal" ? "Minimalista" : "Clássico flutuante"}</span>
            </p>
          </div>

          <hr className="border-border" />

          {/* ── Palette ── */}
          <div className="space-y-2">
            <Label>Paleta de Cores</Label>
            <Select value={palette} onValueChange={(v) => setPalette(v as PptxExportOptions["palette"])}>
              <SelectTrigger data-testid="select-palette"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PALETTES).map(([key, { label }]) => {
                  const colors = key === "default" ? selectedTpl.colors : PALETTES[key].colors;
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
              <SelectTrigger data-testid="select-density"><SelectValue /></SelectTrigger>
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
            <p className="text-xs text-muted-foreground pl-1 flex items-center gap-1">
              <Info className="h-3 w-3" />
              Estimativa: <span className="font-medium text-foreground">{minSlides}–{maxSlides} slides</span> para este curso
            </p>
          </div>

          {/* ── Course type ── */}
          <div className="space-y-2">
            <Label>Tipo de Curso (capa)</Label>
            <Select value={courseType} onValueChange={setCourseType}>
              <SelectTrigger data-testid="select-course-type"><SelectValue /></SelectTrigger>
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
            <Switch checked={includeImages} onCheckedChange={setIncludeImages} data-testid="switch-include-images" />
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
              <Switch checked={footerBrandEnabled} onCheckedChange={setFooterBrandEnabled} data-testid="switch-footer-brand" />
            </div>
            {footerBrandEnabled && (
              <Input
                value={footerBrandValue}
                onChange={(e) => setFooterBrandValue(e.target.value)}
                placeholder="Ex: EduGenAI, Minha Escola, etc."
                maxLength={40}
                className="text-sm"
                data-testid="input-footer-brand"
              />
            )}
          </div>

          {/* ── 2Slides AI Engine ── */}
          <div className={`space-y-3 p-3 rounded-xl border transition-colors ${use2Slides ? "border-sky-500/40 bg-sky-500/5" : "border-border bg-muted/30"}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-sky-400">⚡ 2Slides AI (Recomendado)</p>
                  <Badge variant="outline" className="text-[10px] px-1 py-0 bg-sky-500/10 text-sky-400 border-sky-500/20">NOVO</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Design profissional gerado por IA — templates premium</p>
              </div>
              <Switch
                checked={use2Slides}
                onCheckedChange={(v) => { setUse2Slides(v); if (v) setUseV3(false); }}
                data-testid="switch-use-2slides"
              />
            </div>

            {use2Slides && (
              <div className="space-y-1.5 pt-1">
                <Label className="text-xs text-muted-foreground">Tema Visual</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { key: "blue-gradient",   label: "Azul Gradiente",     desc: "Moderno • Claro",     color: "#3B82F6" },
                    { key: "blue-modern",     label: "Azul Moderno",       desc: "Limpo • Claro",       color: "#2563EB" },
                    { key: "dark-pro",        label: "Profissional Dark",  desc: "Elegante • Escuro",   color: "#374151" },
                    { key: "training-orange", label: "Treinamento",        desc: "Energético • Claro",  color: "#F97316" },
                  ].map(({ key, label, desc, color }) => (
                    <button
                      key={key}
                      data-testid={`theme-2slides-${key}`}
                      onClick={() => setTwoSlidesTheme(key)}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-all text-xs ${
                        twoSlidesTheme === key
                          ? "border-sky-500 bg-sky-500/10"
                          : "border-border hover:border-sky-500/40"
                      }`}
                    >
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <div>
                        <p className="font-medium leading-tight">{label}</p>
                        <p className="text-muted-foreground leading-tight">{desc}</p>
                      </div>
                      {twoSlidesTheme === key && <Check className="h-3 w-3 text-sky-400 ml-auto shrink-0" />}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground pt-0.5 pl-0.5">
                  💡 10 créditos por slide — novo signup inclui 880 créditos grátis
                </p>
              </div>
            )}
          </div>

          {/* ── V3 AI Generation toggle (fallback/native) ── */}
          {!use2Slides && (
            <div className="flex items-center justify-between px-1">
              <div>
                <p className="text-sm font-medium">Geração de slides EduGen v3</p>
                <p className="text-xs text-muted-foreground">Motor nativo de alta precisão pedagógica</p>
              </div>
              <Switch checked={useV3} onCheckedChange={setUseV3} data-testid="switch-use-v3" />
            </div>
          )}

          {/* ── Compatibility note ── */}
          <div className="rounded-md border border-border bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground">
              📎 O arquivo gerado é um <strong>.pptx padrão</strong>, totalmente editável no PowerPoint, Google Slides, Canva, LibreOffice Impress e Keynote.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-export">Cancelar</Button>
          <Button onClick={handleExport} disabled={exporting} data-testid="button-confirm-export">
            {exporting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Gerar PPTX
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
