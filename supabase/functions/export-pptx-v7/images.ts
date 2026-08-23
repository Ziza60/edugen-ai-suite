// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — PPTX v7 "Adaptive Engine"  ·  images.ts
//
// Optional, best-effort decorative images via Pexels (primary) with a Pixabay
// fallback. Topic-agnostic: it just resolves the free-text `imageQuery` the
// planner suggested. Every failure is swallowed — images are an enhancement,
// never a hard dependency.
// ═══════════════════════════════════════════════════════════════════════════

import {
  consultaUtil,
  escolherFoto,
  type FotoCandidata,
} from "./image-relevance.ts";

const PEXELS_SEARCH = "https://api.pexels.com/v1/search";
const PIXABAY_SEARCH = "https://pixabay.com/api/";

/** Quantas fotos pedir por consulta para ter de onde escolher a relevante. */
const CANDIDATAS = 5;

/** fetch with a hard timeout (images must never stall the export into a 504). */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = 12000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/** Baixa a imagem e devolve como data URI. Exportada porque as imagens curadas
 *  em course_images passam por este mesmo caminho — elas também são URL. */
export async function toDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // base64 encode in 32KB chunks (per-byte concat is a CPU hog that can trip
    // the edge runtime's CPU-time limit on image-heavy decks).
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
    }
    const b64 = btoa(binary);
    const ext = url.includes(".png") ? "png" : "jpeg";
    return `data:image/${ext};base64,${b64}`;
  } catch {
    return null;
  }
}

/**
 * Resolve a landscape photo URL from Pexels (≈940px "large"). null on any miss.
 *
 * Pede CANDIDATAS, não uma foto. A versão anterior pedia `per_page=1` e usava o
 * que viesse: o Pexels não erra quando a consulta é ruim, ele devolve uma foto
 * qualquer, e ela ia para o slide sem ninguém olhar. O campo `alt` — que já
 * vinha na resposta e era descartado — diz o que a foto mostra. Ver
 * image-relevance.ts.
 */
async function pexelsPhoto(q: string, apiKey: string): Promise<string | null> {
  try {
    const url =
      `${PEXELS_SEARCH}?query=${encodeURIComponent(q)}&per_page=${CANDIDATAS}&orientation=landscape`;
    const res = await fetchWithTimeout(url, { headers: { Authorization: apiKey } }, 10000);
    if (!res.ok) return null;
    const data = await res.json();
    const candidatas: FotoCandidata[] = (data?.photos ?? []).map((p: any) => ({
      url: p?.src?.large || p?.src?.medium || "",
      descricao: String(p?.alt ?? ""),
    }));
    const escolhida = escolherFoto(q, candidatas);
    // O filtro pode estar apertado demais e isto é o que vai dizer: candidatas
    // vieram, e nenhuma passou. Se aparecer com frequência nos logs, quem
    // precisa afrouxar é a regra de relevância, não a busca.
    if (!escolhida && candidatas.length) {
      console.log(`[pptx-v7] pexels: ${candidatas.length} fotos para "${q}", nenhuma relacionada`);
    }
    return escolhida;
  } catch {
    return null;
  }
}

/** Resolve a landscape photo URL from Pixabay. null on any miss.
 *  As `tags` do Pixabay fazem o papel do `alt` do Pexels: dizem o que a foto
 *  mostra, e é por elas que a relevância é conferida. */
async function pixabayPhoto(q: string, apiKey: string): Promise<string | null> {
  try {
    const url = `${PIXABAY_SEARCH}?key=${encodeURIComponent(apiKey)}` +
      `&q=${encodeURIComponent(q)}&image_type=photo&orientation=horizontal` +
      `&safesearch=true&per_page=${CANDIDATAS}`;
    const res = await fetchWithTimeout(url, {}, 10000);
    if (!res.ok) return null;
    const data = await res.json();
    const candidatas: FotoCandidata[] = (data?.hits ?? []).map((h: any) => ({
      url: h?.largeImageURL || h?.webformatURL || "",
      descricao: String(h?.tags ?? ""),
    }));
    return escolherFoto(q, candidatas);
  } catch {
    return null;
  }
}

/**
 * Resolve one landscape photo per unique query. Returns a map query→dataUri.
 * Primary source is Pexels; Pixabay is a best-effort fallback that kicks in
 * whenever Pexels returns nothing for a query — covering rate-limits / outages
 * AND catalogue gaps (a term Pexels can't match, Pixabay often can). Capping
 * count + resolution keeps the PPTX small and avoids the edge runtime's CPU/time
 * limit during base64 embedding + pptx.write. Both keys are optional: with
 * neither configured this is a no-op and the renderer falls back to vector-only
 * layouts.
 */
export async function resolveImages(
  queries: string[],
  pexelsKey: string | undefined,
  maxImages = 8,
  pixabayKey?: string | undefined,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!pexelsKey && !pixabayKey) return out;
  // Consulta que não é cena concreta em inglês nem chega a ser buscada. Dois
  // pontos do planejador caem para o título do módulo em português quando ele
  // não escreve imageQuery, e buscar um título devolve foto aleatória — que no
  // slide não é neutra, desmente o assunto. Ver image-relevance.ts.
  const limpas = queries.map((q) => q.trim().toLowerCase()).filter(Boolean);
  const uteis = limpas.filter(consultaUtil);
  if (uteis.length < limpas.length) {
    console.log(
      `[pptx-v7] ${limpas.length - uteis.length} consulta(s) de imagem descartadas por não descreverem uma cena buscável`,
    );
  }
  const unique = Array.from(new Set(uteis)).slice(0, maxImages);

  await Promise.all(
    unique.map(async (q) => {
      try {
        let src = pexelsKey ? await pexelsPhoto(q, pexelsKey) : null;
        if (!src && pixabayKey) src = await pixabayPhoto(q, pixabayKey);
        if (!src) return;
        const dataUri = await toDataUri(src);
        if (dataUri) out[q] = dataUri;
      } catch {
        /* swallow — images are optional */
      }
    }),
  );
  return out;
}
