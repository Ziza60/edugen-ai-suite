// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — PPTX v7 "Adaptive Engine"  ·  images.ts
//
// Optional, best-effort decorative images via Pexels (primary) with a Pixabay
// fallback. Topic-agnostic: it just resolves the free-text `imageQuery` the
// planner suggested. Every failure is swallowed — images are an enhancement,
// never a hard dependency.
// ═══════════════════════════════════════════════════════════════════════════

const PEXELS_SEARCH = "https://api.pexels.com/v1/search";
const PIXABAY_SEARCH = "https://pixabay.com/api/";

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

async function toDataUri(url: string): Promise<string | null> {
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

/** Resolve a landscape photo URL from Pexels (≈940px "large"). null on any miss. */
async function pexelsPhoto(q: string, apiKey: string): Promise<string | null> {
  try {
    const url =
      `${PEXELS_SEARCH}?query=${encodeURIComponent(q)}&per_page=1&orientation=landscape`;
    const res = await fetchWithTimeout(url, { headers: { Authorization: apiKey } }, 10000);
    if (!res.ok) return null;
    const data = await res.json();
    const photo = data?.photos?.[0];
    return photo?.src?.large || photo?.src?.medium || null;
  } catch {
    return null;
  }
}

/** Resolve a landscape photo URL from Pixabay. null on any miss.
 *  (Pixabay requires per_page >= 3; we just take the first horizontal photo.) */
async function pixabayPhoto(q: string, apiKey: string): Promise<string | null> {
  try {
    const url = `${PIXABAY_SEARCH}?key=${encodeURIComponent(apiKey)}` +
      `&q=${encodeURIComponent(q)}&image_type=photo&orientation=horizontal` +
      `&safesearch=true&per_page=3`;
    const res = await fetchWithTimeout(url, {}, 10000);
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data?.hits?.[0];
    return hit?.largeImageURL || hit?.webformatURL || null;
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
  const unique = Array.from(
    new Set(queries.map((q) => q.trim().toLowerCase()).filter(Boolean)),
  ).slice(0, maxImages);

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
