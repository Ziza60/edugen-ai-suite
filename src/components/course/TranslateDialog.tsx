import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Languages, Globe, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

interface TranslateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  courseTitle: string;
  currentLanguage: string;
  isPro: boolean;
  modulesCount: number;
}

const LANGUAGES = [
  { code: "en-US", label: "English (US)", flag: "🇺🇸" },
  { code: "en-GB", label: "English (UK)", flag: "🇬🇧" },
  { code: "es-ES", label: "Español", flag: "🇪🇸" },
  { code: "pt-BR", label: "Português (BR)", flag: "🇧🇷" },
  { code: "pt-PT", label: "Português (PT)", flag: "🇵🇹" },
  { code: "fr-FR", label: "Français", flag: "🇫🇷" },
  { code: "de-DE", label: "Deutsch", flag: "🇩🇪" },
  { code: "it-IT", label: "Italiano", flag: "🇮🇹" },
  { code: "ja-JP", label: "日本語", flag: "🇯🇵" },
  { code: "ko-KR", label: "한국어", flag: "🇰🇷" },
  { code: "zh-CN", label: "中文 (简体)", flag: "🇨🇳" },
];

const ADAPTATION_LEVELS = [
  {
    value: "literal",
    label: "Literal",
    desc: "Tradução fiel — mantém exemplos e referências culturais originais.",
    color: "bg-muted text-muted-foreground",
  },
  {
    value: "adapted",
    label: "Adaptado",
    desc: "Ajusta referências confusas (moeda, unidades) mantendo a essência.",
    color: "bg-primary/10 text-primary",
  },
  {
    value: "localized",
    label: "Localizado",
    desc: "Substitui exemplos por equivalentes culturais do país-alvo.",
    color: "bg-secondary/10 text-secondary",
  },
];

export function TranslateDialog({
  open,
  onOpenChange,
  courseId,
  courseTitle,
  currentLanguage,
  isPro,
  modulesCount,
}: TranslateDialogProps) {
  const [targetLang, setTargetLang] = useState("");
  const [adaptation, setAdaptation] = useState("adapted");
  const [translating, setTranslating] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const filteredLanguages = LANGUAGES.filter((l) => l.code !== currentLanguage);

  const handleTranslate = async () => {
    if (!targetLang) {
      toast({ title: "Selecione o idioma de destino", variant: "destructive" });
      return;
    }

    setTranslating(true);
    try {
      const { data, error } = await supabase.functions.invoke("translate-course", {
        body: { course_id: courseId, target_language: targetLang, adaptation },
      });

      if (error) throw error;

      toast({
        title: "Curso traduzido com sucesso!",
        description: `${data.modules_translated} módulos, ${data.quizzes_translated} quizzes e ${data.flashcards_translated} flashcards traduzidos.`,
      });

      onOpenChange(false);
      navigate(`/app/courses/${data.course_id}`);
    } catch (err: any) {
      const msg = err.message || "Erro desconhecido";
      if (msg.includes("403") || msg.includes("Pro")) {
        toast({ title: "Recurso exclusivo Pro", description: "Faça upgrade para traduzir cursos.", variant: "destructive" });
      } else if (msg.includes("429")) {
        toast({ title: "Limite de requisições", description: "Aguarde um momento e tente novamente.", variant: "destructive" });
      } else if (msg.includes("402")) {
        toast({ title: "Créditos de IA esgotados", description: "Adicione créditos para continuar.", variant: "destructive" });
      } else {
        toast({ title: "Erro na tradução", description: msg, variant: "destructive" });
      }
    } finally {
      setTranslating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Languages className="h-5 w-5 text-primary" />
            Tradução Pedagógica Inteligente
          </DialogTitle>
          <DialogDescription>
            Traduz módulos, quizzes e flashcards com adaptação cultural. Um novo curso será criado no idioma-alvo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Source info */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Globe className="h-4 w-4" />
            <span>Curso atual:</span>
            <Badge variant="outline" className="text-xs">{currentLanguage}</Badge>
            <span className="truncate max-w-[200px]">{courseTitle}</span>
          </div>

          {/* Target language */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">Idioma de destino</p>
            <div className="grid grid-cols-2 gap-2">
              {filteredLanguages.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => setTargetLang(lang.code)}
                  className={`text-left rounded-lg border px-3 py-2 text-sm transition-all ${
                    targetLang === lang.code
                      ? "border-primary bg-primary/5 text-primary font-medium"
                      : "border-border hover:border-primary/30 text-foreground"
                  }`}
                >
                  <span className="mr-2">{lang.flag}</span>
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          {/* Adaptation level */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-2">Nível de adaptação cultural</p>
            <div className="space-y-2">
              {ADAPTATION_LEVELS.map((level) => (
                <button
                  key={level.value}
                  onClick={() => setAdaptation(level.value)}
                  className={`w-full text-left rounded-lg border px-4 py-3 transition-all ${
                    adaptation === level.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={`text-[10px] ${level.color}`}>
                      {level.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{level.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Estimate */}
          <div className="rounded-lg bg-muted/50 border border-border p-3 text-xs text-muted-foreground">
            <p>
              <strong className="text-foreground">Estimativa:</strong>{" "}
              {modulesCount} módulo{modulesCount !== 1 ? "s" : ""} serão traduzidos incluindo quizzes e flashcards.
              Um novo curso em rascunho será criado.
            </p>
            {!isPro && (
              <p className="mt-2 text-destructive font-medium">
                ⚠ Este recurso é exclusivo do plano Pro.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={translating}>
            Cancelar
          </Button>
          <Button onClick={handleTranslate} disabled={translating || !targetLang || !isPro}>
            {translating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Traduzindo...
              </>
            ) : (
              <>
                <Languages className="h-4 w-4 mr-2" />
                Traduzir curso
                <ArrowRight className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
