import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Check, Image, X, Sparkles, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface PexelsPhoto {
  id: string;
  url: string;
  thumb: string;
  small: string;
  photographer: string;
  photographerUrl: string;
  alt: string;
}

interface Props {
  moduleTitle: string;
  moduleId: string;
  courseTitle?: string;
  currentImageUrl?: string;
  onSelect: (photo: { url: string; alt: string; credit: string; creditUrl: string }) => void;
  onRemove?: () => void;
  disabled?: boolean;
}

type Tab = "pexels" | "ai";

export function PexelsPicker({ moduleTitle, moduleId, courseTitle, currentImageUrl, onSelect, onRemove, disabled }: Props) {
  const [open, setOpen]         = useState(false);
  const [tab, setTab]           = useState<Tab>("pexels");

  // Pexels state
  const [query, setQuery]       = useState(moduleTitle);
  const [photos, setPhotos]     = useState<PexelsPhoto[]>([]);
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [page, setPage]         = useState(1);
  const [hasMore, setHasMore]   = useState(false);

  // AI generation state
  const [aiLoading, setAiLoading]     = useState(false);
  const [aiError, setAiError]         = useState<string | null>(null);
  const [aiCredits, setAiCredits]     = useState<{ used: number; limit: number; plan: string } | null>(null);
  const [aiPreview, setAiPreview]     = useState<{ url: string; alt: string } | null>(null);

  const search = useCallback(async (q: string, pg = 1) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) throw new Error("Sessão expirada");
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pexels-search?query=${encodeURIComponent(q)}&per_page=15&orientation=landscape&page=${pg}`;
      const res = await fetch(fnUrl, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      const newPhotos: PexelsPhoto[] = data?.photos ?? [];
      setPhotos(pg === 1 ? newPhotos : (prev) => [...prev, ...newPhotos]);
      setHasMore(newPhotos.length === 15);
      setPage(pg);
    } catch (err: any) {
      setError(err.message || "Erro ao buscar imagens");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen && photos.length === 0) search(moduleTitle);
  };

  const handleConfirmPexels = () => {
    const photo = photos.find((p) => p.id === selected);
    if (!photo) return;
    onSelect({ url: photo.url, alt: photo.alt || moduleTitle, credit: photo.photographer, creditUrl: photo.photographerUrl });
    setOpen(false);
    setSelected(null);
  };

  const handleGenerateAI = async () => {
    setAiLoading(true);
    setAiError(null);
    setAiPreview(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-module-image", {
        body: { module_id: moduleId, module_title: moduleTitle, course_title: courseTitle ?? "" },
      });
      if (error) throw error;
      if (data?.error) {
        if (data.error === "credits_exhausted") {
          setAiCredits({ used: data.used, limit: data.limit, plan: data.plan });
          setAiError(data.message);
          return;
        }
        throw new Error(data.error);
      }
      setAiCredits({ used: data.used, limit: data.limit, plan: data.plan });
      setAiPreview({ url: data.url, alt: data.alt_text });
    } catch (err: any) {
      setAiError(err.message || "Erro ao gerar imagem");
    } finally {
      setAiLoading(false);
    }
  };

  const handleUseAI = () => {
    if (!aiPreview) return;
    onSelect({ url: aiPreview.url, alt: aiPreview.alt, credit: "EduGenAI", creditUrl: "" });
    setOpen(false);
    setAiPreview(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <div className="flex items-center gap-2">
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            data-testid="button-pexels-picker"
            className="gap-1.5 text-xs"
          >
            <Image className="h-3.5 w-3.5" />
            {currentImageUrl ? "Trocar imagem" : "Adicionar imagem"}
          </Button>
        </DialogTrigger>
        {currentImageUrl && onRemove && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={disabled}
            data-testid="button-pexels-remove"
            className="gap-1.5 text-xs text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
            Remover
          </Button>
        )}
      </div>

      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Image className="h-4 w-4 text-primary" />
            Adicionar imagem ao módulo
          </DialogTitle>
        </DialogHeader>

        {/* Tab switcher */}
        <div className="flex gap-1 shrink-0 border border-border rounded-lg p-1 bg-muted/40">
          <button
            onClick={() => setTab("pexels")}
            data-testid="tab-pexels"
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-all ${
              tab === "pexels" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Search className="h-3 w-3" />
            Pexels
          </button>
          <button
            onClick={() => setTab("ai")}
            data-testid="tab-ai"
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-all ${
              tab === "ai" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="h-3 w-3" />
            Gerar com IA
          </button>
        </div>

        {/* ── Pexels tab ── */}
        {tab === "pexels" && (
          <>
            <div className="flex gap-2 shrink-0">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") search(query); }}
                placeholder="Ex: educação, negócios, tecnologia..."
                className="text-sm"
                data-testid="input-pexels-search"
              />
              <Button onClick={() => search(query)} disabled={loading} size="sm" data-testid="button-pexels-search">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {error && <p className="text-xs text-destructive px-1 shrink-0">{error}</p>}

            <div className="flex-1 overflow-y-auto min-h-0">
              {loading && photos.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Buscando imagens...
                </div>
              ) : photos.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                  Nenhuma imagem encontrada. Tente outro termo.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 pb-2">
                    {photos.map((photo) => {
                      const isSel = selected === photo.id;
                      return (
                        <button
                          key={photo.id}
                          data-testid={`photo-pexels-${photo.id}`}
                          onClick={() => setSelected(isSel ? null : photo.id)}
                          className={`relative rounded-lg overflow-hidden border-2 transition-all aspect-video ${
                            isSel ? "border-primary shadow-md" : "border-transparent hover:border-primary/40"
                          }`}
                        >
                          <img src={photo.thumb} alt={photo.alt} className="w-full h-full object-cover" loading="lazy" />
                          {isSel && (
                            <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                              <div className="bg-primary rounded-full p-1">
                                <Check className="h-4 w-4 text-primary-foreground" />
                              </div>
                            </div>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5">
                            <p className="text-[9px] text-white/80 truncate">{photo.photographer}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {hasMore && (
                    <div className="flex justify-center pt-1 pb-3">
                      <Button variant="outline" size="sm" onClick={() => search(query, page + 1)} disabled={loading} className="text-xs">
                        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                        Carregar mais
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border shrink-0">
              <p className="text-[10px] text-muted-foreground">
                Fotos por{" "}
                <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer" className="underline">Pexels</a>
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button size="sm" onClick={handleConfirmPexels} disabled={!selected} data-testid="button-pexels-confirm">
                  Usar imagem
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ── AI generation tab ── */}
        {tab === "ai" && (
          <div className="flex-1 flex flex-col gap-4 min-h-0">
            {/* Credits indicator */}
            {aiCredits && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 shrink-0">
                <Zap className="h-3.5 w-3.5 text-yellow-500" />
                <span>
                  {aiCredits.used}/{aiCredits.limit} gerações usadas este mês
                  {aiCredits.plan === "free" && " · Plano Free"}
                  {aiCredits.plan === "pro" && " · Plano Pro"}
                </span>
                {aiCredits.used >= aiCredits.limit && (
                  <Badge variant="destructive" className="text-[10px] ml-auto">Esgotado</Badge>
                )}
              </div>
            )}

            {/* Module context */}
            <div className="bg-muted/30 rounded-lg px-3 py-2.5 shrink-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Módulo</p>
              <p className="text-sm font-medium text-foreground leading-snug">{moduleTitle}</p>
            </div>

            {/* Preview or placeholder */}
            <div className="flex-1 flex items-center justify-center min-h-0">
              {aiPreview ? (
                <div className="w-full rounded-xl overflow-hidden border border-border">
                  <img src={aiPreview.url} alt={aiPreview.alt} className="w-full h-auto object-cover max-h-64" />
                </div>
              ) : (
                <div className="w-full aspect-video flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-xl bg-muted/20">
                  {aiLoading ? (
                    <>
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Gerando imagem com IA…</p>
                      <p className="text-xs text-muted-foreground">Isso pode levar alguns segundos</p>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground text-center px-4">
                        A IA vai criar uma ilustração conceitual exclusiva para este módulo
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>

            {aiError && (
              <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 shrink-0">{aiError}</p>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-border shrink-0">
              <p className="text-[10px] text-muted-foreground">Gerado por Gemini · uso conforme plano</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
                {aiPreview ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateAI}
                      disabled={aiLoading}
                      data-testid="button-ai-regenerate"
                    >
                      {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                      Regerar
                    </Button>
                    <Button size="sm" onClick={handleUseAI} data-testid="button-ai-use">
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Usar imagem
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleGenerateAI}
                    disabled={aiLoading || (aiCredits !== null && aiCredits.used >= aiCredits.limit)}
                    data-testid="button-ai-generate"
                    className="gap-1.5"
                  >
                    {aiLoading
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Sparkles className="h-3.5 w-3.5" />}
                    Gerar imagem
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
