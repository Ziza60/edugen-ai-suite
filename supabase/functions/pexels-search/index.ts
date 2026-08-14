import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Derivação da consulta ────────────────────────────────────────────────────
// O picker mandava o título do módulo cru para a API — por exemplo
// "Monitoramento e Avaliação: Assegurando a Eficácia Contínua dos Controles".
// Três problemas somados, e o resultado eram fotos aleatórias:
//
//   1. Idioma. O acervo do Pexels é etiquetado em inglês. Uma consulta em
//      português quase não casa com tag nenhuma, e a API cai no casamento
//      difuso — que devolve qualquer coisa em vez de nada.
//   2. Comprimento. A relevância dilui a cada palavra. O Pexels responde bem a
//      1–3 termos; a nove ele responde mal.
//   3. Abstração. É um banco de FOTOS. "Eficácia contínua" não tem referente
//      fotográfico; "auditor reviewing documents" tem.
//
// A correção traduz o título num assunto visual concreto em inglês. Preferimos
// o modelo para isso (a alternativa seria um dicionário por domínio, que é
// exatamente o tipo de regra por tópico que este código evita), mas nunca
// dependemos dele: sem chave ou com falha, a redução determinística abaixo
// ainda entrega uma consulta melhor que o título inteiro.

const STOPWORDS_PT = new Set(
  ("a as o os um uma uns umas de do da dos das em no na nos nas por para com sem sob sobre entre e ou que se ao aos à às pelo pela pelos pelas seu sua seus suas este esta esse essa aquele aquela isso isto como quando onde qual quais mais menos muito pouco todo toda todos todas outro outra ser estar ter haver fazer sendo suas nas dos introdução fundamentos conceitos princípios aspectos questões aplicação prática práticas aplicações módulo lição aula parte capítulo unidade")
    .split(/\s+/),
);

/** Reduz um título a 2–3 palavras de conteúdo. Último recurso, sem rede. */
function reduceTitle(title: string): string {
  // O subtítulo depois de ":" costuma ser a parte mais abstrata ("Assegurando
  // a Eficácia Contínua…"); a parte antes carrega o assunto.
  const head = title.split(/[:–—]/)[0] || title;
  const words = head
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS_PT.has(w.toLowerCase()));
  return (words.length ? words : head.split(/\s+/)).slice(0, 3).join(" ").trim();
}

/**
 * Pede ao modelo 3 consultas curtas em inglês — assuntos fotografáveis, não
 * paráfrases do título. Devolve [] em qualquer falha: o chamador cai no
 * reduceTitle e a busca continua funcionando.
 */
async function deriveQueries(
  title: string,
  course: string,
  geminiKey: string,
): Promise<string[]> {
  const prompt =
    `A stock-photo library (Pexels) needs a search query for the cover image of this course module.

COURSE: "${course}"
MODULE: "${title}"

Return exactly 3 candidate queries, one per line, no numbering, no punctuation.
Rules — these decide whether the search works at all:
- ENGLISH only. The library's tags are English.
- 2 to 3 words each. Longer queries return worse matches, not better ones.
- A PHOTOGRAPHABLE subject: people doing something, a place, or an object.
  "team reviewing documents" works; "continuous effectiveness" returns noise.
- Describe the module's real-world setting, not its abstract theme.
- Make the 3 queries genuinely different from each other, so a user who
  dislikes the first has somewhere to go.`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 2048,
            // Sem isto o 2.5 gasta o orçamento inteiro pensando e devolve
            // texto vazio com finishReason MAX_TOKENS.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: controller.signal,
      },
    ).finally(() => clearTimeout(timer));
    if (!res.ok) {
      console.warn(`[PEXELS] derive falhou: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p?.text ?? "").join("") ?? "";
    return text
      .split("\n")
      .map((l) => l.replace(/^[\s\-*\d.)]+/, "").replace(/["']/g, "").trim())
      .filter((l) => l.length >= 3 && l.split(/\s+/).length <= 5)
      .slice(0, 3);
  } catch (err) {
    console.warn("[PEXELS] derive falhou:", (err as Error)?.message);
    return [];
  }
}

/**
 * Traduz as descrições das fotos para o idioma do curso.
 *
 * O Pexels descreve cada foto em inglês ("Two men argue while a woman looks
 * frustrated at a laptop in an office environment"). Essa frase não fica só na
 * API: ela vira o alt_text gravado em course_images, é o que um leitor de tela
 * lê em voz alta e o que aparece quando a imagem não carrega. Num curso em
 * português, é texto em inglês na cara do aluno.
 *
 * Uma chamada em lote para as 15 fotos, não uma por foto. Falhou? Devolve []
 * e o chamador mantém o texto original — perder a tradução é melhor que perder
 * a busca.
 */
async function translateAlts(
  alts: string[],
  language: string,
  geminiKey: string,
): Promise<string[]> {
  if (!alts.length) return [];
  const prompt =
    `Translate each stock-photo description below into ${language}.

Return EXACTLY ${alts.length} lines, one translation per input line, in the same
order. No numbering, no quotes, no commentary — the output is parsed by line.
These are alt texts read aloud by screen readers: describe what is in the photo,
naturally and concisely. Keep proper nouns unchanged. If a line is empty, return
an empty line.

${alts.map((a, i) => `${i + 1}. ${a || "(vazio)"}`).join("\n")}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: controller.signal,
      },
    ).finally(() => clearTimeout(timer));
    if (!res.ok) {
      console.warn(`[PEXELS] tradução falhou: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p?.text ?? "").join("") ?? "";
    const clean = text.split("\n")
      .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
      .filter((l) => l.length > 0);
    // Alinhamento por posição só é seguro se vier a mesma quantidade de linhas.
    // Se o modelo juntou, dividiu ou prefaciou alguma, descartamos tudo em vez
    // de casar a descrição errada com a foto errada — legenda trocada é pior
    // que legenda em inglês.
    if (clean.length !== alts.length) {
      console.warn(`[PEXELS] tradução descartada: ${clean.length} linhas para ${alts.length} fotos`);
      return [];
    }
    return clean;
  } catch (err) {
    console.warn("[PEXELS] tradução falhou:", (err as Error)?.message);
    return [];
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pexelsKey = Deno.env.get("PEXELS_API_KEY");
    if (!pexelsKey) {
      return new Response(JSON.stringify({ error: "PEXELS_NOT_CONFIGURED" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Autenticar usuário
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client      = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userError } = await client.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url         = new URL(req.url);
    const perPage     = Math.min(parseInt(url.searchParams.get("per_page") || "15"), 30);
    const orientation = url.searchParams.get("orientation") || "landscape";
    const page        = parseInt(url.searchParams.get("page") || "1");
    const title       = url.searchParams.get("title") || "";
    const course      = url.searchParams.get("course") || "";
    // Idioma do curso: define em que língua as descrições das fotos voltam.
    const language    = url.searchParams.get("lang") || "";
    // derive=1 → o cliente não tem uma consulta, tem um título de módulo, e
    // quer que nós o transformemos em algo que o Pexels saiba responder.
    const derive      = url.searchParams.get("derive") === "1";
    const geminiKey   = Deno.env.get("GEMINI_API_KEY") ?? "";

    // Candidatos em ordem de preferência. O primeiro que devolver fotos vence.
    let suggestions: string[] = [];
    let candidates: string[] = [];
    const explicit = url.searchParams.get("query");

    if (derive && title) {
      suggestions = geminiKey ? await deriveQueries(title, course, geminiKey) : [];
      const reduced = reduceTitle(title);
      // A redução determinística entra sempre no fim da fila: se as três
      // sugestões do modelo vierem vazias de resultado, ainda há uma tentativa.
      candidates = [...suggestions, reduced, "education"].filter(Boolean);
    } else {
      candidates = [explicit || "education"];
    }

    // Busca em cascata: uma consulta sem resultado não é um erro, é a deixa
    // para tentar a próxima. Antes, uma consulta ruim simplesmente devolvia
    // vazio (ou lixo) e o usuário ficava sem saída.
    let data: any = null;
    let resolvedQuery = candidates[0];
    for (const q of candidates) {
      const pexelsUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}` +
        `&per_page=${perPage}&orientation=${orientation}&page=${page}`;
      const res = await fetch(pexelsUrl, { headers: { Authorization: pexelsKey } });
      if (!res.ok) {
        console.warn(`[PEXELS] API error ${res.status} para "${q}"`);
        continue;
      }
      const body = await res.json();
      console.log(`[PEXELS] "${q}" → ${(body?.photos ?? []).length} fotos`);
      if ((body?.photos ?? []).length > 0) {
        data = body;
        resolvedQuery = q;
        break;
      }
      data ??= body; // guarda o primeiro vazio, caso nenhuma consulta ache nada
    }

    if (!data) {
      return new Response(JSON.stringify({ error: "PEXELS_SEARCH_FAILED" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = data?.photos ?? [];

    // As descrições do Pexels são sempre em inglês, e elas não param na API:
    // viram o alt_text gravado no curso, que o leitor de tela lê em voz alta e
    // que aparece quando a imagem não carrega. Traduzimos aqui, em uma chamada
    // para o lote inteiro. Se falhar, ficam como estavam — a busca não depende
    // disso. Só vale a pena quando há idioma e ele não é inglês.
    let alts: string[] = raw.map((p: any) => String(p.alt ?? ""));
    if (geminiKey && language && !/^en/i.test(language) && alts.some((a) => a)) {
      const traduzidas = await translateAlts(alts, language, geminiKey);
      if (traduzidas.length === alts.length) alts = traduzidas;
    }

    // Normalizar para formato simples
    const photos = raw.map((p: any, i: number) => ({
      id:          String(p.id),
      url:         p.src?.large || p.src?.medium || p.src?.original,
      thumb:       p.src?.medium || p.src?.small,
      small:       p.src?.small,
      photographer: p.photographer || "Pexels",
      photographerUrl: p.photographer_url || "https://www.pexels.com",
      alt:         alts[i] || p.alt || resolvedQuery,
      width:       p.width,
      height:      p.height,
    }));

    console.log(`[PEXELS] Found ${photos.length} photos for "${resolvedQuery}"`);

    return new Response(JSON.stringify({
      photos,
      total_results: data.total_results ?? photos.length,
      page,
      per_page: perPage,
      // A consulta que realmente trouxe estas fotos — pode não ser a primeira
      // tentada. O picker a exibe para o usuário não ficar no escuro sobre o
      // que foi buscado, e a usa para paginar ("Carregar mais").
      query: resolvedQuery,
      // Alternativas clicáveis quando o primeiro recorte não agradar.
      suggestions,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[PEXELS] Error:", err?.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
