import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Video, HelpCircle, Image, Clock, Code, ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { useState } from "react";

interface FaqItem { question: string; answer: string; }
interface BlockContent {
  url?: string;
  items?: FaqItem[];
  images?: string[];
  targetDate?: string;
  label?: string;
}
interface LayoutBlock { type: string; content: BlockContent; }

interface ProEditorProps {
  landing: any;
  onChange: (updates: any) => void;
}

const BLOCK_META: Record<string, { icon: React.ReactNode; label: string }> = {
  video:   { icon: <Video   className="h-4 w-4" />, label: "Vídeo" },
  faq:     { icon: <HelpCircle className="h-4 w-4" />, label: "FAQ" },
  gallery: { icon: <Image   className="h-4 w-4" />, label: "Galeria" },
  timer:   { icon: <Clock   className="h-4 w-4" />, label: "Cronômetro" },
};

// ── per-block content editors ──────────────────────────────────
function VideoEditor({ content, onContentChange }: { content: BlockContent; onContentChange: (c: BlockContent) => void }) {
  return (
    <div className="space-y-2 pt-3 pb-1">
      <Label className="text-xs">URL do YouTube</Label>
      <Input
        placeholder="https://www.youtube.com/watch?v=..."
        value={content.url || ""}
        onChange={(e) => onContentChange({ ...content, url: e.target.value })}
      />
      <p className="text-xs text-muted-foreground">Aceita links youtube.com/watch e youtu.be</p>
    </div>
  );
}

function FaqEditor({ content, onContentChange }: { content: BlockContent; onContentChange: (c: BlockContent) => void }) {
  const items: FaqItem[] = content.items || [];

  const update = (newItems: FaqItem[]) => onContentChange({ ...content, items: newItems });
  const add = () => update([...items, { question: "", answer: "" }]);
  const remove = (i: number) => update(items.filter((_, idx) => idx !== i));
  const setField = (i: number, field: keyof FaqItem, val: string) => {
    const next = items.map((item, idx) => idx === i ? { ...item, [field]: val } : item);
    update(next);
  };

  return (
    <div className="space-y-3 pt-3 pb-1">
      {items.map((item, i) => (
        <div key={i} className="border rounded-lg p-3 space-y-2 bg-muted/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Pergunta {i + 1}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => remove(i)}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
          <Input
            placeholder="Pergunta…"
            value={item.question}
            onChange={(e) => setField(i, "question", e.target.value)}
          />
          <Textarea
            placeholder="Resposta…"
            className="text-sm h-20 resize-none"
            value={item.answer}
            onChange={(e) => setField(i, "answer", e.target.value)}
          />
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-full" onClick={add}>
        <Plus className="h-4 w-4 mr-2" /> Adicionar pergunta
      </Button>
    </div>
  );
}

function GalleryEditor({ content, onContentChange }: { content: BlockContent; onContentChange: (c: BlockContent) => void }) {
  const images: string[] = content.images || [];
  const update = (imgs: string[]) => onContentChange({ ...content, images: imgs });
  const add = () => update([...images, ""]);
  const set = (i: number, val: string) => update(images.map((img, idx) => idx === i ? val : img));
  const remove = (i: number) => update(images.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2 pt-3 pb-1">
      <Label className="text-xs">URLs das imagens</Label>
      {images.map((img, i) => (
        <div key={i} className="flex gap-2">
          <Input
            placeholder="https://..."
            value={img}
            onChange={(e) => set(i, e.target.value)}
            className="text-xs"
          />
          <Button variant="ghost" size="icon" onClick={() => remove(i)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-full mt-1" onClick={add}>
        <Plus className="h-4 w-4 mr-2" /> Adicionar imagem
      </Button>
      <p className="text-xs text-muted-foreground">Use URLs públicas (ex: Unsplash, Cloudinary)</p>
    </div>
  );
}

function TimerEditor({ content, onContentChange }: { content: BlockContent; onContentChange: (c: BlockContent) => void }) {
  return (
    <div className="space-y-3 pt-3 pb-1">
      <div className="space-y-1">
        <Label className="text-xs">Chamada acima do cronômetro</Label>
        <Input
          placeholder="Ex: Oferta encerra em:"
          value={content.label || ""}
          onChange={(e) => onContentChange({ ...content, label: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Data e hora de encerramento</Label>
        <Input
          type="datetime-local"
          value={content.targetDate ? content.targetDate.slice(0, 16) : ""}
          onChange={(e) => onContentChange({ ...content, targetDate: e.target.value ? new Date(e.target.value).toISOString() : "" })}
        />
      </div>
    </div>
  );
}

// ── collapsible block row ──────────────────────────────────────
function BlockRow({
  block, index, expanded, onToggle, onRemove, onContentChange,
}: {
  block: LayoutBlock;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onContentChange: (c: BlockContent) => void;
}) {
  const meta = BLOCK_META[block.type] || { icon: null, label: block.type };
  return (
    <div className="border rounded-lg bg-background overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0" />
        <div className="p-1.5 bg-muted rounded border shrink-0">{meta.icon}</div>
        <span className="text-sm font-medium flex-1">{meta.label}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      {expanded && (
        <div className="px-3 pb-3 border-t bg-muted/10">
          {block.type === "video"   && <VideoEditor   content={block.content} onContentChange={onContentChange} />}
          {block.type === "faq"     && <FaqEditor     content={block.content} onContentChange={onContentChange} />}
          {block.type === "gallery" && <GalleryEditor content={block.content} onContentChange={onContentChange} />}
          {block.type === "timer"   && <TimerEditor   content={block.content} onContentChange={onContentChange} />}
        </div>
      )}
    </div>
  );
}

export function ProEditor({ landing, onChange }: ProEditorProps) {
  const layoutBlocks: LayoutBlock[] = Array.isArray(landing.layout_blocks) ? landing.layout_blocks : [];
  const [expanded, setExpanded] = useState<number | null>(null);

  const updateBlocks = (blocks: LayoutBlock[]) => onChange({ layout_blocks: blocks });

  const addBlock = (type: string) => {
    const defaultContent: Record<string, BlockContent> = {
      video:   { url: "" },
      faq:     { items: [{ question: "", answer: "" }] },
      gallery: { images: [""] },
      timer:   { label: "Oferta encerra em:", targetDate: "" },
    };
    const newBlocks = [...layoutBlocks, { type, content: defaultContent[type] || {} }];
    updateBlocks(newBlocks);
    setExpanded(newBlocks.length - 1);
  };

  const removeBlock = (index: number) => {
    updateBlocks(layoutBlocks.filter((_, i) => i !== index));
    setExpanded(null);
  };

  const updateBlockContent = (index: number, content: BlockContent) => {
    updateBlocks(layoutBlocks.map((b, i) => i === index ? { ...b, content } : b));
  };

  return (
    <div className="space-y-6">
      {/* Block list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Blocos avançados</CardTitle>
          <CardDescription>Adicione seções extras à sua landing page.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {layoutBlocks.length > 0 ? (
            <div className="space-y-2">
              {layoutBlocks.map((block, i) => (
                <BlockRow
                  key={i}
                  block={block}
                  index={i}
                  expanded={expanded === i}
                  onToggle={() => setExpanded(expanded === i ? null : i)}
                  onRemove={() => removeBlock(i)}
                  onContentChange={(c) => updateBlockContent(i, c)}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">
              Nenhum bloco adicionado. Use os botões abaixo para enriquecer sua página.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 pt-2">
            {Object.entries(BLOCK_META).map(([type, meta]) => (
              <Button
                key={type}
                variant="outline"
                size="sm"
                className="flex items-center gap-2 h-10 justify-start"
                onClick={() => addBlock(type)}
              >
                {meta.icon}
                <span>+ {meta.label}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Branding & CSS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Customização total</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Marca EduGenAI</Label>
              <p className="text-xs text-muted-foreground">Exibir crédito no rodapé.</p>
            </div>
            <Switch
              checked={landing.show_branding !== false}
              onCheckedChange={(checked) => onChange({ show_branding: checked })}
            />
          </div>

          <div className="space-y-2 pt-2">
            <Label className="flex items-center gap-2">
              <Code className="h-4 w-4" /> CSS Customizado
            </Label>
            <Textarea
              className="font-mono text-xs h-32"
              placeholder="/* Adicione seu CSS aqui */"
              value={landing.custom_css || ""}
              onChange={(e) => onChange({ custom_css: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
