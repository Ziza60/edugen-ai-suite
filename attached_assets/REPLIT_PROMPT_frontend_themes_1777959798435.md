# REPLIT_PROMPT — PptxExportDialog: Seletor de temas 2Slides dinâmico

## Contexto

O seletor de temas do 2Slides em `PptxExportDialog.tsx` tem 4 temas hardcoded.
A API 2Slides tem endpoint de busca dinâmica: `GET /api/v1/themes/search?query=PALAVRA&limit=N`.
O objetivo é substituir os 4 botões fixos por temas buscados em tempo real ao abrir o painel do 2Slides.

### O que descobrimos sobre a API
- `GET /api/v1/themes/search?query=educação&limit=12` retorna lista de temas com id, nome, preview
- A chave de API (`TWOSLIDES_API_KEY`) está no backend (Supabase Edge Function) — não pode ser exposta no frontend
- Solução: criar uma nova edge function leve `get-2slides-themes` que faz o proxy da busca

---

## Passo 1 — Criar edge function `get-2slides-themes`

Criar o arquivo `supabase/functions/get-2slides-themes/index.ts`:

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Mapeamento courseType → palavra-chave de busca
const COURSE_TYPE_QUERY: Record<string, string> = {
  "CURSO COMPLETO":        "educação",
  "TREINAMENTO":           "treinamento",
  "WORKSHOP":              "criativo",
  "WEBINAR":               "moderno",
  "MINI-CURSO":            "educação",
  "TRILHA DE APRENDIZAGEM":"profissional",
  "MÓDULO":                "educação",
};
const DEFAULT_QUERY = "educação";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Autenticar usuário
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const twoSlidesKey = Deno.env.get("TWOSLIDES_API_KEY");
    if (!twoSlidesKey) {
      return new Response(JSON.stringify({ error: "TWOSLIDES_NOT_CONFIGURED" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client       = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userError } = await client.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parâmetros da busca
    const url        = new URL(req.url);
    const courseType = url.searchParams.get("courseType") || "CURSO COMPLETO";
    const limit      = Math.min(parseInt(url.searchParams.get("limit") || "12"), 20);
    const query      = COURSE_TYPE_QUERY[courseType] ?? DEFAULT_QUERY;

    const res = await fetch(
      `https://2slides.com/api/v1/themes/search?query=${encodeURIComponent(query)}&limit=${limit}`,
      { headers: { "Authorization": `Bearer ${twoSlidesKey}` } },
    );

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "TWOSLIDES_SEARCH_FAILED", status: res.status }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    // Normalizar resposta — a API pode retornar { themes: [...] } ou [...] diretamente
    const themes = data?.themes ?? data?.data ?? (Array.isArray(data) ? data : []);

    return new Response(JSON.stringify({ themes, query }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

Depois de criar, fazer deploy:
```bash
supabase functions deploy get-2slides-themes
```

---

## Passo 2 — Modificar `PptxExportDialog.tsx`

### 2a. Adicionar imports no topo do arquivo

Localizar a linha:
```typescript
import { useState } from "react";
```

Substituir por:
```typescript
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
```

---

### 2b. Adicionar tipo `TwoSlidesTheme` após os imports

Localizar:
```typescript
// ── Exported options type ──────────────────────────────────────────
export interface PptxExportOptions {
```

Inserir ANTES dessa linha:
```typescript
// ── 2Slides theme type (retornado pela API) ────────────────────────
interface TwoSlidesTheme {
  id: string;
  name: string;
  thumbnailUrl?: string;   // URL de preview (se a API retornar)
  previewUrl?: string;     // fallback alternativo
  tags?: string[];
}
```

---

### 2c. Adicionar estado e fetch de temas dentro do componente

Localizar dentro de `export function PptxExportDialog(...)`:
```typescript
  const [twoSlidesTheme, setTwoSlidesTheme]           = useState("blue-gradient");
```

Substituir por:
```typescript
  const [twoSlidesTheme, setTwoSlidesTheme]           = useState("");
  const [twoSlidesThemes, setTwoSlidesThemes]         = useState<TwoSlidesTheme[]>([]);
  const [loadingThemes, setLoadingThemes]             = useState(false);
  const [themesError, setThemesError]                 = useState(false);
```

---

### 2d. Adicionar useEffect para buscar temas ao ativar o 2Slides

Localizar logo após os useState (antes de `const selectedTpl = ...`):
```typescript
  const selectedTpl = VISUAL_TEMPLATES[template] || VISUAL_TEMPLATES.modern;
```

Inserir ANTES dessa linha:
```typescript
  // Buscar temas do 2Slides quando o painel for ativado
  useEffect(() => {
    if (!use2Slides) return;
    if (twoSlidesThemes.length > 0) return; // já carregado

    setLoadingThemes(true);
    setThemesError(false);

    supabase.functions.invoke("get-2slides-themes", {
      body: undefined,
      headers: {},
      // Passar courseType como query param via método invoke não é direto —
      // usar fetch direto com a URL da função
    }).then(() => {}).catch(() => {}); // placeholder — fetch real abaixo

    const fetchThemes = async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        if (!session?.access_token) throw new Error("Sessão expirada");

        const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-2slides-themes?courseType=${encodeURIComponent(courseType)}&limit=12`;
        const res = await fetch(fnUrl, {
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        });
        const data = await res.json();
        if (data?.themes?.length) {
          setTwoSlidesThemes(data.themes);
          // Selecionar o primeiro tema automaticamente
          setTwoSlidesTheme(data.themes[0].id);
        } else {
          setThemesError(true);
        }
      } catch {
        setThemesError(true);
      } finally {
        setLoadingThemes(false);
      }
    };

    fetchThemes();
  }, [use2Slides, courseType]);
```

---

### 2e. Substituir o seletor de temas estático pelo dinâmico

Localizar o bloco inteiro (dentro de `{use2Slides && (...)}`):
```typescript
              <div className="space-y-1.5 pt-1">
                <Label className="text-xs text-muted-foreground">Tema Visual</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { key: "blue-gradient",   label: "Azul Gradiente",     desc: "Moderno • Claro",     color: "#3B82F6" },
                    { key: "blue-modern",     label: "Azul Moderno",       desc: "Limpo • Claro",       color: "#2563EB" },
                    { key: "dark-pro",        label: "Profissional Dark",  desc: "Elegante • Escuro",   color: "#374151" },
                    { key: "training-orange", label: "Treinamento",        desc: "Energético • Claro",  color: "#F97316" },
                  ].map(({ key, label, desc, color }) => (
                    <button
                      key={key}
                      data-testid={`theme-2slides-${key}`}
                      onClick={() => setTwoSlidesTheme(key)}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-all text-xs ${
                        twoSlidesTheme === key
                          ? "border-sky-500 bg-sky-500/10"
                          : "border-border hover:border-sky-500/40"
                      }`}
                    >
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <div>
                        <p className="font-medium leading-tight">{label}</p>
                        <p className="text-muted-foreground leading-tight">{desc}</p>
                      </div>
                      {twoSlidesTheme === key && <Check className="h-3 w-3 text-sky-400 ml-auto shrink-0" />}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground pt-0.5 pl-0.5">
                  💡 10 créditos por slide — novo signup inclui 880 créditos grátis
                </p>
              </div>
```

Substituir por:
```typescript
              <div className="space-y-1.5 pt-1">
                <Label className="text-xs text-muted-foreground">Tema Visual</Label>

                {/* Loading */}
                {loadingThemes && (
                  <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Buscando temas disponíveis...
                  </div>
                )}

                {/* Erro */}
                {!loadingThemes && themesError && (
                  <div className="text-xs text-destructive py-2 pl-1">
                    Não foi possível carregar os temas. Verifique sua chave de API do 2Slides.
                  </div>
                )}

                {/* Grid de temas dinâmicos */}
                {!loadingThemes && twoSlidesThemes.length > 0 && (
                  <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-1">
                    {twoSlidesThemes.map((t) => {
                      const thumb = t.thumbnailUrl || t.previewUrl;
                      const selected = twoSlidesTheme === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setTwoSlidesTheme(t.id)}
                          className={`relative flex flex-col rounded-lg border-2 overflow-hidden text-left transition-all ${
                            selected
                              ? "border-sky-500 shadow-sm shadow-sky-500/20"
                              : "border-border hover:border-sky-500/40"
                          }`}
                        >
                          {/* Thumbnail ou placeholder */}
                          {thumb ? (
                            <img
                              src={thumb}
                              alt={t.name}
                              className="w-full h-16 object-cover"
                            />
                          ) : (
                            <div className="w-full h-16 bg-muted flex items-center justify-center">
                              <span className="text-[10px] text-muted-foreground">Preview</span>
                            </div>
                          )}

                          {/* Nome */}
                          <div className={`px-2 py-1.5 ${selected ? "bg-sky-500/10" : "bg-card"}`}>
                            <p className="text-[11px] font-medium leading-tight truncate">{t.name}</p>
                            {t.tags && t.tags.length > 0 && (
                              <p className="text-[10px] text-muted-foreground leading-tight truncate">
                                {t.tags.slice(0, 2).join(" • ")}
                              </p>
                            )}
                          </div>

                          {/* Check */}
                          {selected && (
                            <div className="absolute top-1.5 left-1.5 bg-sky-500 rounded-full p-0.5">
                              <Check className="h-2.5 w-2.5 text-white" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground pt-0.5 pl-0.5">
                  💡 10 créditos por slide — novo signup inclui 880 créditos grátis
                </p>
              </div>
```

---

## Resultado esperado

- Ao ativar o toggle **⚡ 2Slides AI**, o frontend faz fetch em `get-2slides-themes?courseType=CURSO+COMPLETO&limit=12`
- A edge function busca `GET /api/v1/themes/search?query=educação&limit=12` com a chave de API protegida no backend
- O grid exibe thumbnails reais dos temas disponíveis no 2Slides (não mais 4 opções fixas)
- Ao trocar o `courseType` no seletor acima, o `useEffect` re-busca temas com a palavra-chave correta (ex: WORKSHOP → "criativo")
- O `twoSlidesTheme` passa o `id` real do tema selecionado para a edge function `export-pptx-2slides`

## O que NÃO mudar

- `PptxExportOptions` — apenas `twoSlidesTheme: string` já funciona (continua passando o id)
- `ExportButtons.tsx` — não alterar
- `export-pptx-2slides` — já recebe `theme_key` mas agora vai receber o id real; **verificar** se o parâmetro continua sendo chamado `theme_key` ou precisa renomear para `themeId` no body
- Todos os outros engines (v6, v4, presenton) — não tocar
