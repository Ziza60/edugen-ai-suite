import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Youtube, Loader2, CheckCircle2, Sparkles, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";

interface YouTubeAnalysis {
  source_id: string;
  filename: string;
  char_count: number;
  video_id: string;
  video_title: string;
  title: string;
  theme: string;
  targetAudience: string;
  suggestedModules: number;
  detectedLanguage: string;
}

interface YouTubeImportScreenProps {
  tempCourseId: string;
  onBack: () => void;
  onComplete: (analysis: YouTubeAnalysis) => void;
}

const LOADING_STEPS = [
  "Acessando o vídeo…",
  "Extraindo transcrição…",
  "Analisando conteúdo com IA…",
  "Sugerindo estrutura do curso…",
];

export function YouTubeImportScreen({ tempCourseId, onBack, onComplete }: YouTubeImportScreenProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<YouTubeAnalysis | null>(null);

  const isValidYouTubeUrl = (u: string) =>
    /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/.test(u.trim());

  const handleAnalyze = async () => {
    setError(null);
    setAnalysis(null);
    setLoading(true);
    setLoadingStep(0);

    const stepInterval = setInterval(() => {
      setLoadingStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1));
    }, 3500);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("analyze-youtube", {
        body: { url: url.trim(), course_id: tempCourseId },
      });

      clearInterval(stepInterval);

      if (fnError) throw new Error(fnError.message || "Erro ao analisar o vídeo.");
      if (data?.error) throw new Error(data.error);

      setAnalysis(data as YouTubeAnalysis);
    } catch (err: any) {
      clearInterval(stepInterval);
      setError(err.message || "Não foi possível processar o vídeo. Verifique se a URL é válida e o vídeo tem legendas.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Top bar */}
      <div className="bg-card border-b border-border">
        <div className="max-w-[840px] mx-auto px-6 py-4 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Voltar
          </Button>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Youtube className="h-4 w-4 text-red-500" />
            </div>
            <h1 className="font-display text-lg font-bold text-foreground">YouTube → Curso</h1>
          </div>
        </div>
      </div>

      <div className="max-w-[640px] mx-auto px-6 py-10 space-y-6">
        <AnimatePresence mode="wait">
          {!analysis ? (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="space-y-6"
            >
              {/* Hero */}
              <div className="text-center space-y-3">
                <div className="h-16 w-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto">
                  <Youtube className="h-8 w-8 text-red-500" />
                </div>
                <h2 className="font-display text-2xl font-bold text-foreground">
                  Transforme um vídeo em curso
                </h2>
                <p className="text-muted-foreground text-sm max-w-md mx-auto">
                  Cole o link de qualquer vídeo do YouTube com legendas. A IA extrai a transcrição, analisa o conteúdo e cria a estrutura completa do curso automaticamente.
                </p>
              </div>

              {/* URL Input */}
              <Card className="rounded-2xl border-border shadow-sm">
                <CardContent className="p-6 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-foreground">URL do vídeo</label>
                    <div className="relative">
                      <Youtube className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-red-500" />
                      <Input
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={url}
                        onChange={(e) => { setUrl(e.target.value); setError(null); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && isValidYouTubeUrl(url) && !loading) handleAnalyze();
                        }}
                        className="pl-10 h-12 text-sm"
                        disabled={loading}
                        data-testid="input-youtube-url"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Funciona com vídeos que possuem legendas automáticas ou manuais.
                    </p>
                  </div>

                  {error && (
                    <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-xl p-3 text-sm text-destructive">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  {loading && (
                    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="text-sm font-medium text-primary">{LOADING_STEPS[loadingStep]}</span>
                      </div>
                      <div className="space-y-1.5">
                        {LOADING_STEPS.map((step, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                            {i < loadingStep ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                            ) : i === loadingStep ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                            ) : (
                              <div className="h-3.5 w-3.5 rounded-full border border-border shrink-0" />
                            )}
                            <span className={i <= loadingStep ? "text-foreground" : ""}>{step}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button
                    className="w-full h-12 text-base font-semibold"
                    onClick={handleAnalyze}
                    disabled={!isValidYouTubeUrl(url) || loading}
                    data-testid="button-analyze-youtube"
                  >
                    {loading ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analisando…</>
                    ) : (
                      <><Sparkles className="h-4 w-4 mr-2" />Analisar vídeo</>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* How it works */}
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { step: "1", text: "Cole a URL do YouTube" },
                  { step: "2", text: "IA analisa o conteúdo" },
                  { step: "3", text: "Revise e gere o curso" },
                ].map((item) => (
                  <div key={item.step} className="bg-card rounded-xl border border-border p-3 space-y-1.5">
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                      <span className="text-xs font-bold text-primary">{item.step}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-tight">{item.text}</p>
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
              {/* Success header */}
              <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 rounded-xl p-4">
                <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-green-700 dark:text-green-400">Vídeo analisado com sucesso!</p>
                  <p className="text-xs text-muted-foreground truncate">{analysis.video_title}</p>
                </div>
                <Badge variant="secondary" className="ml-auto shrink-0 text-xs">
                  {analysis.char_count.toLocaleString()} chars
                </Badge>
              </div>

              {/* Suggestions */}
              <Card className="rounded-2xl border-border shadow-sm">
                <CardContent className="p-6 space-y-5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <p className="text-sm font-bold text-foreground">Sugestão da IA para o curso</p>
                    <Badge variant="secondary" className="text-[10px] ml-auto">Editável no próximo passo</Badge>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Título</p>
                      <p className="text-sm font-semibold text-foreground bg-muted/50 rounded-lg px-3 py-2">{analysis.title}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tema / Conteúdo</p>
                      <p className="text-sm text-foreground bg-muted/50 rounded-lg px-3 py-2 leading-relaxed">{analysis.theme}</p>
                    </div>
                    {analysis.targetAudience && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Público-alvo</p>
                        <p className="text-sm text-foreground bg-muted/50 rounded-lg px-3 py-2">{analysis.targetAudience}</p>
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <div className="bg-muted/50 rounded-lg px-3 py-2 text-center flex-1">
                        <p className="text-xs text-muted-foreground">Módulos sugeridos</p>
                        <p className="text-lg font-bold text-foreground">{analysis.suggestedModules}</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg px-3 py-2 text-center flex-1">
                        <p className="text-xs text-muted-foreground">Idioma detectado</p>
                        <p className="text-sm font-bold text-foreground">
                          {analysis.detectedLanguage === "pt-BR" ? "Português (BR)" : analysis.detectedLanguage === "en" ? "English" : analysis.detectedLanguage}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button
                      variant="outline"
                      className="flex-1 h-11"
                      onClick={() => { setAnalysis(null); setUrl(""); }}
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Outro vídeo
                    </Button>
                    <Button
                      className="flex-2 h-11 px-6 font-semibold shadow-lg shadow-primary/20"
                      onClick={() => onComplete(analysis)}
                      data-testid="button-youtube-continue"
                    >
                      Continuar
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
