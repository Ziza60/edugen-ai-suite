// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — PPTX v7 "Adaptive Engine"  ·  images.ts
//
// Optional, best-effort decorative images via the Pexels API. Topic-agnostic:
// it just resolves the free-text `imageQuery` the planner suggested. Every
// failure is swallowed — images are an enhancement, never a hard dependency.
// ═══════════════════════════════════════════════════════════════════════════

const PEXELS_SEARCH = "https://api.pexels.com/v1/search";

async function toDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // base64 encode
    let binary = "";
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    const b64 = btoa(binary);
    const ext = url.includes(".png") ? "png" : "jpeg";
    return `data:image/${ext};base64,${b64}`;
  } catch {
    return null;
  }
}

/**
 * Resolve one landscape photo per unique query. Returns a map query→dataUri.
 * Caps total fetches to keep the export fast. Returns {} when no key is set.
 */
export async function resolveImages(
  queries: string[],
  apiKey: string | undefined,
  maxImages = 12,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!apiKey) return out;
  const unique = Array.from(
    new Set(queries.map((q) => q.trim().toLowerCase()).filter(Boolean)),
  ).slice(0, maxImages);

  await Promise.all(
    unique.map(async (q) => {
      try {
        const url =
          `${PEXELS_SEARCH}?query=${encodeURIComponent(q)}&per_page=1&orientation=landscape`;
        const res = await fetch(url, { headers: { Authorization: apiKey } });
        if (!res.ok) return;
        const data = await res.json();
        const photo = data?.photos?.[0];
        const src = photo?.src?.large2x || photo?.src?.large || photo?.src?.medium;
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
