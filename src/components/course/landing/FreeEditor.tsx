import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AlertCircle, Lock } from "lucide-react";

interface FreeEditorProps {
  landing: any;
  onChange: (updates: any) => void;
  onUpgrade: () => void;
}

export function FreeEditor({ landing, onChange, onUpgrade }: FreeEditorProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Informações Básicas</CardTitle>
          <CardDescription>Edite o conteúdo essencial da sua página.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="headline">Título Principal</Label>
            <Input 
              id="headline" 
              value={landing.headline || ""} 
              onChange={(e) => onChange({ headline: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subtitle">Subtítulo / Descrição Curta</Label>
            <Textarea 
              id="subtitle" 
              value={landing.subtitle || ""} 
              onChange={(e) => onChange({ subtitle: e.target.value })}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cta">Texto do Botão (CTA)</Label>
            <Input 
              id="cta" 
              value={landing.cta_text || ""} 
              onChange={(e) => onChange({ cta_text: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            Recursos Limitados
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            No plano **Free**, você tem acesso a um template fixo. Faça upgrade para o plano **Starter** para personalizar o layout, adicionar depoimentos e reordenar seções.
          </p>
          <Button variant="default" size="sm" className="w-full" onClick={onUpgrade}>
            Ver Planos de Upgrade
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
