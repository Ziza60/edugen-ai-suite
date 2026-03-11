import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, Mic, Download, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ScriptGeneratorButtonProps {
  courseId: string;
  courseTitle: string;
  isPro: boolean;
  disabled?: boolean;
}

export function ScriptGeneratorButton({ courseId, courseTitle, isPro, disabled }: ScriptGeneratorButtonProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [script, setScript] = useState<string | null>(null);
  const [style, setStyle] = useState("professional");
  const [duration, setDuration] = useState("10");
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    setScript(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-script", {
        body: {
          course_id: courseId,
          duration_minutes: parseInt(duration),
          style,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setScript(data.script);
      toast({ title: "Script gerado com sucesso!" });
    } catch (err: any) {
      toast({ title: "Erro ao gerar script", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadTxt = () => {
    if (!script) return;
    const blob = new Blob([script], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safe = (courseTitle || "curso").replace(/[^\w\s\-àáâãéêíóôõúüçÀÁÂÃÉÊÍÓÔÕÚÜÇ]/gi, "").trim();
    const date = new Date().toISOString().slice(0, 10);
    a.download = `${safe} - Script - ${date}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!script) return;
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Script copiado!" });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9" disabled={disabled}>
          <Mic className="h-4 w-4 mr-1.5" />
          Script
          {!isPro && <Badge variant="outline" className="ml-1 text-[10px] px-1">PRO</Badge>}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-primary" />
            Gerador de Script para Narração
          </DialogTitle>
          <DialogDescription>
            Gere um roteiro profissional pronto para narração ou gravação de vídeo-aula.
          </DialogDescription>
        </DialogHeader>

        {!script ? (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Estilo de narração</Label>
                <Select value={style} onValueChange={setStyle}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="professional">Profissional</SelectItem>
                    <SelectItem value="casual">Conversacional</SelectItem>
                    <SelectItem value="formal">Formal / Acadêmico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Duração estimada</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">~5 minutos</SelectItem>
                    <SelectItem value="10">~10 minutos</SelectItem>
                    <SelectItem value="15">~15 minutos</SelectItem>
                    <SelectItem value="20">~20 minutos</SelectItem>
                    <SelectItem value="30">~30 minutos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground text-sm">O script incluirá:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Introdução de ~30s para prender atenção</li>
                <li>Marcadores <code className="bg-muted px-1 rounded">[PAUSA]</code> para ritmo natural</li>
                <li>Palavras-chave em <strong>negrito</strong> para ênfase</li>
                <li>Indicações de <code className="bg-muted px-1 rounded">[SLIDE]</code> para sincronia</li>
                <li>Call-to-action final motivador</li>
              </ul>
            </div>

            <Button onClick={handleGenerate} disabled={generating || !isPro} className="w-full">
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Gerando script com IA...
                </>
              ) : !isPro ? (
                "Disponível no plano Pro"
              ) : (
                <>
                  <Mic className="h-4 w-4 mr-2" />
                  Gerar Script
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 flex-1 min-h-0">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleDownloadTxt}>
                <Download className="h-4 w-4 mr-1.5" />
                Baixar TXT
              </Button>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
                {copied ? "Copiado!" : "Copiar"}
              </Button>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => setScript(null)}>
                Gerar novamente
              </Button>
            </div>
            <ScrollArea className="flex-1 border rounded-lg p-4 bg-muted/30 max-h-[50vh]">
              <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed text-foreground">
                {script}
              </pre>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
