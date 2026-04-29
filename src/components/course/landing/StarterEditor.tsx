import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { GripVertical, Plus, Trash2, Lock } from "lucide-react";

interface StarterEditorProps {
  landing: any;
  onChange: (updates: any) => void;
  onUpgrade: () => void;
}

export function StarterEditor({ landing, onChange, onUpgrade }: StarterEditorProps) {
  const benefits = Array.isArray(landing.benefits) ? landing.benefits : [];

  const handleAddBenefit = () => {
    onChange({ benefits: [...benefits, ""] });
  };

  const handleUpdateBenefit = (index: number, value: string) => {
    const newBenefits = [...benefits];
    newBenefits[index] = value;
    onChange({ benefits: newBenefits });
  };

  const handleRemoveBenefit = (index: number) => {
    const newBenefits = benefits.filter((_: any, i: number) => i !== index);
    onChange({ benefits: newBenefits });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Conteúdo da Página</CardTitle>
          <CardDescription>Personalize os textos e seções.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Título Principal</Label>
            <Input 
              value={landing.headline || ""} 
              onChange={(e) => onChange({ headline: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Subtítulo</Label>
            <Textarea 
              value={landing.subtitle || ""} 
              onChange={(e) => onChange({ subtitle: e.target.value })}
            />
          </div>
          
          <div className="space-y-3 pt-2">
            <Label>Benefícios (O que você vai aprender)</Label>
            <div className="space-y-2">
              {benefits.map((benefit: string, index: number) => (
                <div key={index} className="flex gap-2">
                  <div className="flex items-center text-muted-foreground">
                    <GripVertical className="h-4 w-4" />
                  </div>
                  <Input 
                    value={benefit} 
                    onChange={(e) => handleUpdateBenefit(index, e.target.value)}
                    placeholder="Ex: Domine as bases do design"
                  />
                  <Button variant="ghost" size="icon" onClick={() => handleRemoveBenefit(index)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full mt-2" onClick={handleAddBenefit}>
                <Plus className="h-4 w-4 mr-2" />
                Adicionar Benefício
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Depoimentos</CardTitle>
          <CardDescription>Adicione prova social.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nome do Aluno</Label>
            <Input 
              value={landing.testimonial_name || ""} 
              onChange={(e) => onChange({ testimonial_name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Texto do Depoimento</Label>
            <Textarea 
              value={landing.testimonial_text || ""} 
              onChange={(e) => onChange({ testimonial_text: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            Upgrade para Pro
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            No plano **Starter**, você pode personalizar o conteúdo. Faça upgrade para o **Pro** para adicionar vídeos, FAQs, cronômetros, remover nossa marca e usar seu próprio domínio.
          </p>
          <Button variant="default" size="sm" className="w-full" onClick={onUpgrade}>
            Conhecer Plano Pro
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
