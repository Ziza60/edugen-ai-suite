import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Presentation } from "lucide-react";

export interface PptxExportOptions {
  palette: "default" | "ocean" | "forest" | "sunset" | "monochrome";
  density: "compact" | "standard" | "detailed";
  includeImages: boolean;
  theme: "light" | "dark";
  template: "default" | "academic" | "corporate" | "creative";
  useV2: boolean;
}

const PALETTES: Record<string, { label: string; colors: string[] }> = {
  default: { label: "Padrão (EduGen)", colors: ["#9B59B6", "#3498DB", "#27AE60", "#F39C12", "#1ABC9C"] },
  ocean: { label: "Oceano", colors: ["#2980B9", "#3498DB", "#1ABC9C", "#16A085", "#2C3E50"] },
  forest: { label: "Floresta", colors: ["#27AE60", "#2ECC71", "#1ABC9C", "#16A085", "#2C3E50"] },
  sunset: { label: "Pôr do Sol", colors: ["#E74C3C", "#E67E22", "#F39C12", "#D35400", "#C0392B"] },
  monochrome: { label: "Monocromático", colors: ["#2C3E50", "#34495E", "#7F8C8D", "#95A5A6", "#BDC3C7"] },
};

const DENSITY_LABELS: Record<string, { label: string; desc: string }> = {
  compact: { label: "Compacto", desc: "Mais slides, menos texto por slide" },
  standard: { label: "Padrão", desc: "Equilíbrio entre texto e espaço" },
  detailed: { label: "Detalhado", desc: "Menos slides, mais conteúdo denso" },
};

const TEMPLATES: Record<string, { label: string; desc: string; fonts: string; colors: string[] }> = {
  default: {
    label: "Padrão (EduGen)",
    desc: "Montserrat + Open Sans — Estilo educacional moderno",
    fonts: "Montserrat / Open Sans",
    colors: ["#9B59B6", "#3498DB", "#27AE60"],
  },
  academic: {
    label: "Acadêmico",
    desc: "Times New Roman + Arial — Formal e institucional",
    fonts: "Times New Roman / Arial",
    colors: ["#003366", "#6699CC", "#FF6600"],
  },
  corporate: {
    label: "Corporativo",
    desc: "Montserrat + Open Sans — Sóbrio e profissional",
    fonts: "Montserrat / Open Sans",
    colors: ["#1A1A1A", "#4A4A4A", "#007BFF"],
  },
  creative: {
    label: "Criativo",
    desc: "Playfair Display + Lato — Elegante e expressivo",
    fonts: "Playfair Display / Lato",
    colors: ["#2C3E50", "#E74C3C", "#F39C12"],
  },
};

interface Props {
  onExport: (options: PptxExportOptions) => void;
  exporting: boolean;
  disabled: boolean;
  isPro: boolean;
}

export function PptxExportDialog({ onExport, exporting, disabled, isPro }: Props) {
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState<PptxExportOptions["palette"]>("default");
  const [density, setDensity] = useState<PptxExportOptions["density"]>("standard");
  const [includeImages, setIncludeImages] = useState(false);
  const [theme, setTheme] = useState<PptxExportOptions["theme"]>("light");
  const [template, setTemplate] = useState<PptxExportOptions["template"]>("default");
  const [useV2, setUseV2] = useState(false);

  const handleExport = () => {
    setOpen(false);
    onExport({ palette, density, includeImages, theme, template, useV2 });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || exporting}>
          {exporting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Presentation className="h-4 w-4 mr-1" />}
          PPTX {!isPro && <Badge variant="outline" className="ml-1 text-[10px] px-1">PRO</Badge>}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Exportar PowerPoint</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Template */}
          <div className="space-y-2">
            <Label>Template</Label>
            <Select value={template} onValueChange={(v) => setTemplate(v as PptxExportOptions["template"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TEMPLATES).map(([key, { label, desc, colors }]) => (
                  <SelectItem key={key} value={key}>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span>{label}</span>
                          <div className="flex gap-0.5">
                            {colors.map((c, i) => (
                              <span key={i} className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: c }} />
                            ))}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground">{desc}</span>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Palette */}
          <div className="space-y-2">
            <Label>Paleta de Cores</Label>
            <Select value={palette} onValueChange={(v) => setPalette(v as PptxExportOptions["palette"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PALETTES).map(([key, { label, colors }]) => (
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
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Density */}
          <div className="space-y-2">
            <Label>Densidade do Conteúdo</Label>
            <Select value={density} onValueChange={(v) => setDensity(v as PptxExportOptions["density"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(DENSITY_LABELS).map(([key, { label, desc }]) => (
                  <SelectItem key={key} value={key}>
                    <div className="flex flex-col">
                      <span>{label}</span>
                      <span className="text-xs text-muted-foreground">{desc}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Theme */}
          <div className="space-y-2">
            <Label>Tema Visual</Label>
            <Select value={theme} onValueChange={(v) => setTheme(v as PptxExportOptions["theme"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Claro (Fundo branco)</SelectItem>
                <SelectItem value="dark">Escuro (Fundo escuro)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Images toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Incluir Imagens</Label>
              <p className="text-xs text-muted-foreground">Ícones ilustrativos nos slides de capítulo</p>
            </div>
            <Switch checked={includeImages} onCheckedChange={setIncludeImages} />
          </div>

          {/* V2 Engine toggle */}
          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <div className="flex items-center gap-2">
                <Label>Motor v2</Label>
                <Badge variant="secondary" className="text-[10px] px-1.5">Beta</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Novo pipeline com melhor integridade de texto e menos slides de continuação</p>
            </div>
            <Switch checked={useV2} onCheckedChange={setUseV2} />
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
