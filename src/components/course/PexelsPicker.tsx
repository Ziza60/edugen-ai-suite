import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Check, Image, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

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
  currentImageUrl?: string;
  onSelect: (photo: { url: string; alt: string; credit: string; creditUrl: string }) => void;
  onRemove?: () => void;
  disabled?: boolean;
}

export function PexelsPicker({ moduleTitle, moduleId, currentImageUrl, onSelect, onRemove, disabled }: Props) {
  const [open, setOpen]           = useState(false);
  const [query, setQuery]         = useState(moduleTitle);
  const [photos, setPhotos]       = useState<PexelsPhoto[]>([]);
  const [loading, setLoading]     = useState(false);
  const [selected, setSelected]   = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [page, setPage]           = useState(1);
  const [hasMore, setHasMore]     = useState(false);

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
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
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
    if (isOpen && photos.length === 0) {
      search(moduleTitle);
    }
  };

  const handleConfirm = () => {
    const photo = photos.find((p) => p.id === selected);
    if (!photo) return;
    onSelect({
      url: photo.url,
      alt: photo.alt || moduleTitle,
      credit: photo.photographer,
      creditUrl: photo.photographerUrl,
    });
    setOpen(false);
    setSelected(null);
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
            Buscar imagem — Pexels
          </DialogTitle>
        </DialogHeader>

        {/* Search bar */}
        <div className="flex gap-2 shrink-0">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { search(query); } }}
            placeholder="Ex: educação, negócios, tecnologia..."
            className="text-sm"
            data-testid="input-pexels-search"
          />
          <Button
            onClick={() => search(query)}
            disabled={loading}
            size="sm"
            data-testid="button-pexels-search"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-destructive px-1">{error}</p>
        )}

        {/* Grid */}
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
                  const isSelected = selected === photo.id;
                  return (
                    <button
                      key={photo.id}
                      data-testid={`photo-pexels-${photo.id}`}
                      onClick={() => setSelected(isSelected ? null : photo.id)}
                      className={`relative rounded-lg overflow-hidden border-2 transition-all aspect-video ${
                        isSelected ? "border-primary shadow-md" : "border-transparent hover:border-primary/40"
                      }`}
                    >
                      <img
                        src={photo.thumb}
                        alt={photo.alt}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      {isSelected && (
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => search(query, page + 1)}
                    disabled={loading}
                    className="text-xs"
                  >
                    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                    Carregar mais
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border shrink-0">
          <p className="text-[10px] text-muted-foreground">
            Fotos fornecidas por{" "}
            <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer" className="underline">
              Pexels
            </a>
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={!selected}
              data-testid="button-pexels-confirm"
            >
              Usar imagem
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
