import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Search, Check, Image, X, Sparkles, Zap, Wand2 } from "lucide-react";
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
  /** Assunto da imagem: o título do módulo, ou o do curso quando é a capa. */
  moduleTitle: string;
  /** Ausente quando o alvo é a capa — a capa não pertence a módulo nenhum. */
  moduleId?: string;
  /** Obrigatório quando `scope` é "cover": diz ao gerador onde a imagem vive. */
  courseId?: string;
  /** "module" (padrão) grava em course_images; "cover" devolve para quem chamou. */
  scope?: "module" | "cover";
  courseTitle?: string;
  /** Idioma do curso — define em que língua vêm as descrições das fotos. */
  courseLanguage?: string;
  currentImageUrl?: string;
  onSelect: (photo: { url: string; alt: string; credit: string; creditUrl: string }) => void;
  onRemove?: () => void;
  disabled?: boolean;
}

type Tab = "pexels" | "ai";

export function PexelsPicker({ moduleTitle, moduleId, courseId, scope = "module", courseTitle, courseLanguage, currentImageUrl, onSelect, onRemove, disabled }: Props) {
  const [open, setOpen]         = useState(false);
  const [tab, setTab]           = useState<Tab>("pexels");

  // Pexels state
  const [query, setQuery]       = useState("");
  const [photos, setPhotos]     = useState<PexelsPhoto[]>([]);
  const [loading, setLoading]   = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [page, setPage]         = useState(1);
  const [hasMore, setHasMore]   = useState(false);
  // Consultas alternativas devolvidas pelo backend, como atalhos clicáveis.
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // AI generation state
  const [aiLoading, setAiLoading]     = useState(false);
  const [aiError, setAiError]         = useState<string | null>(null);
  const [aiCredits, setAiCredits]     = useState<{ used: number; limit: number; plan: string } | null>(null);
  const [aiPreview, setAiPreview]     = useState<{ url: string; alt: string } | null>(null);
  const [aiBrief, setAiBrief]         = useState("");
  const [sugerindo, setSugerindo]     = useState(false);

  /**
   * Sugere a descrição a partir do título.
   *
   * O campo é opcional, e em branco o gerador manda o TÍTULO direto para o
   * modelo de imagem. Título é abstrato — "Monitoramento, Informação e
   * Comunicação" não diz o que desenhar — e daí saíam as imagens genéricas. Um
   * modelo de texto traduz o título em objetos concretos e escreve aqui; o
   * autor edita antes de gerar, que é o motivo de o campo existir.
   *
   * Não gasta crédito de imagem: é chamada de texto, curta.
   */
  const sugerirDescricao = useCallback(async () => {
    setSugerindo(true);
    setAiError(null);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-image-brief", {
        body: {
          scope: scope === "cover" ? "cover" : "module",
          title: scope === "cover" ? (courseTitle ?? moduleTitle) : moduleTitle,
          course_title: courseTitle ?? "",
        },
      });
      if (error) {
        let body: any = null;
        try { body = await (error as any).context?.json?.(); } catch { /* sem corpo */ }
        // O `detail` do servidor traz o motivo real — nome de modelo recusado,
        // cota, chave. Sem ele na tela, "não foi possível sugerir" é um beco
        // sem saída: nem o autor nem eu sabemos o que tentar em seguida.
        const base = body?.error ?? (error as Error).message;
        throw new Error(body?.detail ? `${base} (${body.detail})` : base);
      }
      if (!data?.brief) throw new Error("A IA não retornou uma descrição.");
      setAiBrief(String(data.brief).slice(0, 500));
    } catch (err: any) {
      setAiError(err?.message ?? "Não foi possível sugerir agora.");
    } finally {
      setSugerindo(false);
    }
  }, [scope, moduleTitle, courseTitle]);

  /**
   * Busca no Pexels.
   *
   * `q` vazio significa "derive a consulta a partir do título do módulo" — o
   * backend traduz o título para um assunto visual em inglês e tenta os
   * candidatos em cascata. Mandar o título cru, como era feito antes, produz
   * fotos aleatórias: o acervo é etiquetado em inglês e a relevância dilui a
   * cada palavra da frase.
   */
  const search = useCallback(async (q: string, pg = 1) => {
    setLoading(true);
    setError(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) throw new Error("Sessão expirada");
      const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pexels-search`;
      const params = new URLSearchParams({
        per_page: "15",
        orientation: "landscape",
        page: String(pg),
      });
      // O título e o idioma vão SEMPRE: o idioma decide em que língua voltam as
      // descrições das fotos (que viram o alt_text do curso), e o título é o
      // insumo da derivação. Só o `derive` distingue os dois modos de busca.
      params.set("title", moduleTitle);
      if (courseTitle) params.set("course", courseTitle);
      if (courseLanguage) params.set("lang", courseLanguage);
      if (q.trim()) params.set("query", q.trim());
      else params.set("derive", "1");
      const res = await fetch(`${base}?${params}`, {
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
      // Mostra no campo a consulta que de fato trouxe as fotos — ela pode não
      // ser a que o usuário digitou, e sem isso ele não tem como saber o que
      // ajustar quando o resultado não agrada.
      if (data?.query) setQuery(data.query);
      if (Array.isArray(data?.suggestions) && data.suggestions.length) {
        setSuggestions(data.suggestions);
      }
    } catch (err: any) {
      setError(err.message || "Erro ao buscar imagens");
    } finally {
      setLoading(false);
    }
  }, [moduleTitle, courseTitle, courseLanguage]);

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen && photos.length === 0) search("");
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
        body: {
          // Na capa não vai module_id: o gerador não deve gravar em
          // course_images, senão a capa tomaria o lugar da imagem de um módulo.
          ...(scope === "cover"
            ? { scope: "cover", course_id: courseId }
            : { module_id: moduleId }),
          module_title: moduleTitle,
          course_title: courseTitle ?? "",
          user_prompt: aiBrief.trim(),
        },
      });

      // supabase-js puts non-2xx responses in `error` (FunctionsHttpError),
      // not in `data`. Parse the real JSON body before giving up.
      if (error) {
        let body: any = null;
        try { body = await (error as any).context?.json?.(); } catch { /* no body */ }
        if (body?.error === "credits_exhausted") {
          setAiCredits({ used: body.used, limit: body.limit, plan: body.plan });
          setAiError(body.message ?? `Limite de ${body.limit} gerações atingido este mês.`);
          return;
        }
        // Surface Gemini detail if present (e.g. model quota, bad request)
        const detail = body?.detail || body?.error;
        throw new Error(detail ? `${detail}` : (error.message || "Erro ao gerar imagem"));
      }

      if (data?.error) {
        if (data.error === "credits_exhausted") {
          setAiCredits({ used: data.used, limit: data.limit, plan: data.plan });
          setAiError(data.message);
          return;
        }
        throw new Error(data.detail || data.error);
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
                placeholder="Ex: audit meeting, team reviewing documents..."
                className="text-sm"
                data-testid="input-pexels-search"
              />
              <Button onClick={() => search(query)} disabled={loading} size="sm" data-testid="button-pexels-search">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 shrink-0 px-0.5">
                <span className="text-[10px] text-muted-foreground shrink-0">Sugestões:</span>
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setQuery(s); search(s); }}
                    disabled={loading}
                    data-testid={`chip-suggestion-${s.replace(/\s+/g, "-")}`}
                    className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${
                      query === s
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <p className="text-[10px] text-muted-foreground px-0.5 shrink-0">
              O acervo do Pexels é indexado em inglês — termos curtos e concretos
              ("audit meeting") trazem resultados muito melhores que o título do módulo.
            </p>

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

            {/* Briefing do usuário: sem ele, o único insumo era o título do
                módulo e "Regerar" repetia o mesmo prompt. */}
            <div className="shrink-0 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="ai-brief" className="text-xs font-medium text-foreground">
                  Descreva a imagem <span className="text-muted-foreground font-normal">(opcional)</span>
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] gap-1 text-primary hover:text-primary"
                  onClick={sugerirDescricao}
                  disabled={sugerindo || aiLoading}
                  data-testid="button-sugerir-descricao"
                  title="A IA escreve uma descrição a partir do título. Não gasta crédito."
                >
                  {sugerindo
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Wand2 className="h-3 w-3" />}
                  {sugerindo ? "Sugerindo…" : "Sugerir"}
                </Button>
              </div>
              <Textarea
                id="ai-brief"
                value={aiBrief}
                onChange={(e) => setAiBrief(e.target.value)}
                maxLength={500}
                rows={3}
                data-testid="input-ai-brief"
                placeholder="Ex: uma mesa de reunião vista de cima, com pastas de documentos e um tablet, tons azuis e sóbrios"
                className="text-sm resize-none"
              />
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Diga o que deve aparecer na cena. Em branco, a IA decide sozinha a
                  partir do título — que é o que produz resultados fora do tema. Use
                  “Sugerir” para começar de um rascunho e ajustar.
                </p>
                <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                  {aiBrief.length}/500
                </span>
              </div>
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
                        {aiBrief.trim()
                          ? "A IA vai criar a ilustração a partir da sua descrição"
                          : "A IA vai criar uma ilustração conceitual exclusiva para este módulo"}
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
