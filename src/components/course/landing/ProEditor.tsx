import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Video, HelpCircle, Image, Clock, Code } from "lucide-react";

interface ProEditorProps {
  landing: any;
  onChange: (updates: any) => void;
}

export function ProEditor({ landing, onChange }: ProEditorProps) {
  const layoutBlocks = Array.isArray(landing.layout_blocks) ? landing.layout_blocks : [];

  const addBlock = (type: string) => {
    onChange({ layout_blocks: [...layoutBlocks, { type, content: {} }] });
  };

  const removeBlock = (index: number) => {
    const newBlocks = layoutBlocks.filter((_: any, i: number) => i !== index);
    onChange({ layout_blocks: newBlocks });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Editor de Blocos Pro</CardTitle>
          <CardDescription>Adicione elementos avançados à sua página.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" className="flex items-center gap-2 h-10" onClick={() => addBlock('video')}>
              <Video className="h-4 w-4" /> Video
            </Button>
            <Button variant="outline" size="sm" className="flex items-center gap-2 h-10" onClick={() => addBlock('faq')}>
              <HelpCircle className="h-4 w-4" /> FAQ
            </Button>
            <Button variant="outline" size="sm" className="flex items-center gap-2 h-10" onClick={() => addBlock('gallery')}>
              <Image className="h-4 w-4" /> Galeria
            </Button>
            <Button variant="outline" size="sm" className="flex items-center gap-2 h-10" onClick={() => addBlock('timer')}>
              <Clock className="h-4 w-4" /> Contador
            </Button>
          </div>

          <div className="mt-6 space-y-3">
            {layoutBlocks.map((block: any, index: number) => (
              <div key={index} className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-background rounded border">
                    {block.type === 'video' && <Video className="h-4 w-4" />}
                    {block.type === 'faq' && <HelpCircle className="h-4 w-4" />}
                    {block.type === 'gallery' && <Image className="h-4 w-4" />}
                    {block.type === 'timer' && <Clock className="h-4 w-4" />}
                  </div>
                  <span className="text-sm font-medium capitalize">{block.type}</span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeBlock(index)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Customização Total</CardTitle>
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
