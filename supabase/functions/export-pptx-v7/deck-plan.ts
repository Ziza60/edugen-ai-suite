// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — PPTX v7 "Adaptive Engine"  ·  deck-plan.ts
//
// PHILOSOPHY (the structural change):
//   The v4/v5 engine tried to FIX bad LLM output downstream with hundreds of
//   topic-specific deterministic rules (Python/SQL/etc). Every new course topic
//   meant new rules — "a new engine for every road".
//
//   v7 inverts this:
//     1. Generate a clean, RENDER-READY slide plan at the SOURCE, via a single
//        topic-AGNOSTIC structured LLM call (JSON schema constrains the shape).
//     2. Validate only what is UNIVERSAL (overflow, empty, item counts) — see
//        validate.ts. No domain knowledge, ever.
//     3. Render with a clean design system (render.ts).
//     4. Graceful degradation, never a hard veto: if the LLM is unavailable or
//        returns junk, a deterministic markdown→slides fallback still ships a
//        usable deck.
//
//   There is ZERO topic-specific logic in this file. It works the same for a
//   Python course, a History course, or a Sales course.
// ═══════════════════════════════════════════════════════════════════════════

export type SlideKind =
  | "cover" // course cover
  | "toc" // agenda / table of contents
  | "section" // module divider
  | "bullets" // title + up to 5 supporting points
  | "cards" // 2–4 concept cards
  | "steps" // ordered process / sequence
  | "compare" // two-column comparison
  | "quote" // pull-quote / reflection prompt
  | "stat" // single big-number highlight
  | "code" // monospace code block
  | "closing"; // summary / key takeaways

export interface DeckCard {
  heading: string;
  body: string;
}

export interface DeckStep {
  heading: string;
  body?: string;
}

export interface DeckColumn {
  heading: string;
  items: string[];
}

/** A normalized, render-ready slide. The renderer never re-interprets prose. */
export interface SlideSpec {
  kind: SlideKind;
  title: string;
  /** Small caps label above the title (usually the module name). */
  eyebrow?: string;
  subtitle?: string;
  bullets?: string[];
  cards?: DeckCard[];
  steps?: DeckStep[];
  left?: DeckColumn;
  right?: DeckColumn;
  quote?: string;
  attribution?: string;
  stat?: { value: string; label: string };
  code?: { language: string; text: string };
  /** Free-text search query for an optional decorative image. */
  imageQuery?: string;
  /** base64 data URI, populated at runtime when images are enabled. */
  imageData?: string;
  /** Speaker notes. */
  notes?: string;
}

export interface DeckModule {
  title: string;
  slides: SlideSpec[];
}

export interface PlannedDeck {
  courseTitle: string;
  subtitle?: string;
  modules: DeckModule[];
}

export interface ModuleInput {
  title: string;
  content: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. STRUCTURED PLANNER PROMPT (topic-agnostic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The schema the model MUST fill. This is the single most important defense:
 * the shape is guaranteed by responseSchema, so we never parse free prose into
 * slides — the model hands us render-ready objects. No topic rules required.
 */
export const SLIDE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "section",
              "bullets",
              "cards",
              "steps",
              "compare",
              "quote",
              "stat",
              "code",
              "closing",
            ],
          },
          title: { type: "string" },
          subtitle: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
          cards: {
            type: "array",
            items: {
              type: "object",
              properties: {
                heading: { type: "string" },
                body: { type: "string" },
              },
              required: ["heading", "body"],
            },
          },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                heading: { type: "string" },
                body: { type: "string" },
              },
              required: ["heading"],
            },
          },
          left: {
            type: "object",
            properties: {
              heading: { type: "string" },
              items: { type: "array", items: { type: "string" } },
            },
          },
          right: {
            type: "object",
            properties: {
              heading: { type: "string" },
              items: { type: "array", items: { type: "string" } },
            },
          },
          quote: { type: "string" },
          stat: {
            type: "object",
            properties: {
              value: { type: "string" },
              label: { type: "string" },
            },
          },
          code: {
            type: "object",
            properties: {
              language: { type: "string" },
              text: { type: "string" },
            },
          },
          imageQuery: { type: "string" },
        },
        required: ["kind", "title"],
      },
    },
  },
  required: ["slides"],
} as const;

export function buildModulePlanPrompt(
  courseTitle: string,
  moduleTitle: string,
  moduleContent: string,
  language: string,
): string {
  // NOTE: deliberately ZERO domain rules. We describe slide *shapes* and
  // universal visual-design quality, and let the model map ANY topic onto them.
  const trimmed = moduleContent.slice(0, 8000);
  return `You are a world-class presentation designer (think Gamma / Apple Keynote).
Turn the module below into a sequence of clean, render-ready slides.

COURSE: "${courseTitle}"
MODULE: "${moduleTitle}"
OUTPUT LANGUAGE: ${language}

PICK THE RIGHT SLIDE TYPE for each idea — this is what makes a deck feel premium:
- "bullets"  → a single concept with 3–5 short supporting points.
- "cards"    → 2–4 parallel items (types, pillars, components) each with a 1-line body.
- "steps"    → an ordered process or sequence (3–5 steps).
- "compare"  → two contrasting things (left vs right), each with 2–4 short items.
- "quote"    → a memorable principle, definition, or reflection prompt.
- "stat"     → one striking number or metric worth a whole slide.
- "code"     → a code/command example (ONLY if the source actually contains code).
- "closing"  → the module's key takeaways (use as the LAST slide).

UNIVERSAL QUALITY RULES (apply to EVERY topic, no exceptions):
- ONE idea per slide. Never cram two concepts together.
- Titles are complete, specific phrases — never single words, never truncated.
- Each bullet / card body / item: max ~14 words, a complete thought, no trailing
  "...", no dangling preposition, ends cleanly.
- Vary the slide types across the module — avoid 5 "bullets" slides in a row.
- 3 to 6 slides per module. Prefer fewer, denser-in-meaning slides.
- The LAST slide MUST be "closing" with 3–5 key takeaways as bullets.
- For visually rich slides (section/quote/stat/cards), suggest a short English
  "imageQuery" (2–4 words) describing a relevant photo. Omit for code/compare.
- Stay strictly faithful to the module content. Do NOT invent facts.

MODULE CONTENT (markdown):
"""
${trimmed}
"""

Return JSON only, matching the provided schema.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PLANNER LLM CALL (Gemini structured output)
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_PLAN_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

/**
 * Calls Gemini with responseSchema so the answer is guaranteed JSON of the
 * right shape. Returns SlideSpec[] for ONE module, or null on any failure
 * (caller falls back to the deterministic plan — never throws to the user).
 */
export async function planModuleSlides(
  courseTitle: string,
  moduleTitle: string,
  moduleContent: string,
  language: string,
  geminiKey: string,
): Promise<SlideSpec[] | null> {
  try {
    const prompt = buildModulePlanPrompt(
      courseTitle,
      moduleTitle,
      moduleContent,
      language,
    );
    const res = await fetch(`${GEMINI_PLAN_URL}?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: SLIDE_RESPONSE_SCHEMA,
        },
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(
        `[V7-PLAN] module "${moduleTitle}" LLM ${res.status} → fallback | ${errBody.slice(0, 200)}`,
      );
      return null;
    }
    const data = await res.json();
    const finishReason = data?.candidates?.[0]?.finishReason ?? "UNKNOWN";
    const text: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) {
      console.warn(`[V7-PLAN] module "${moduleTitle}" empty text finishReason=${finishReason} → fallback`);
      return null;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (parseErr) {
      console.warn(`[V7-PLAN] module "${moduleTitle}" JSON parse failed finishReason=${finishReason} textLen=${text.length} → fallback`);
      return null;
    }
    const slides = Array.isArray(parsed?.slides) ? parsed.slides : null;
    if (!slides || slides.length === 0) {
      console.warn(`[V7-PLAN] module "${moduleTitle}" no slides in response finishReason=${finishReason} → fallback`);
      return null;
    }
    console.log(`[V7-PLAN] module "${moduleTitle}" OK slides=${slides.length} finishReason=${finishReason}`);
    // Tag every slide with the module eyebrow for consistent headers.
    return (slides as SlideSpec[]).map((s) => ({ ...s, eyebrow: moduleTitle }));
  } catch (err) {
    console.warn(`[V7-PLAN] module "${moduleTitle}" threw → fallback:`, err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. DETERMINISTIC FALLBACK (no LLM) — guarantees a usable deck always
// ─────────────────────────────────────────────────────────────────────────────

/** Strip markdown emphasis/markers from a single line. */
function cleanLine(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^>\s?/, "")
    .trim();
}

interface MdBlock {
  heading: string;
  bullets: string[];
  paras: string[];
  code: { language: string; text: string } | null;
}

/** Very small markdown segmenter: groups content under ### headings. */
function segmentMarkdown(md: string): MdBlock[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let cur: MdBlock = { heading: "", bullets: [], paras: [], code: null };
  let inCode = false;
  let codeLang = "";
  let codeBuf: string[] = [];

  const push = () => {
    if (cur.heading || cur.bullets.length || cur.paras.length || cur.code) {
      blocks.push(cur);
    }
    cur = { heading: "", bullets: [], paras: [], code: null };
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const fence = line.match(/^```(\w+)?/);
    if (fence) {
      if (!inCode) {
        inCode = true;
        codeLang = fence[1] || "";
        codeBuf = [];
      } else {
        inCode = false;
        cur.code = { language: codeLang, text: codeBuf.join("\n").trim() };
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }
    if (/^#{2,4}\s+/.test(line)) {
      // New heading starts a new block.
      push();
      cur.heading = cleanLine(line);
      continue;
    }
    if (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const t = cleanLine(line);
      if (t) cur.bullets.push(t);
      continue;
    }
    if (line.trim()) {
      const t = cleanLine(line);
      if (t) cur.paras.push(t);
    }
  }
  push();
  return blocks;
}

const TAKEAWAY_RE = /resumo|takeaway|key\s*takeaway|conclus|síntese|sintese/i;
const OBJECTIVE_RE = /objetivo|aprende|ao final|learning|goals?/i;

/** Split a string into sentence-ish chunks for bullet salvage. */
function toShortPoint(s: string, maxWords = 16): string {
  const words = s.split(/\s+/);
  if (words.length <= maxWords) return s;
  return words.slice(0, maxWords).join(" ");
}

/**
 * Build a sensible slide sequence for a module WITHOUT any LLM. Used when the
 * planner is unavailable or fails. Topic-agnostic: only structural heuristics.
 */
export function fallbackModuleSlides(
  moduleTitle: string,
  moduleContent: string,
): SlideSpec[] {
  const blocks = segmentMarkdown(moduleContent || "");
  const slides: SlideSpec[] = [];
  let takeaways: string[] = [];

  for (const b of blocks) {
    const heading = b.heading || moduleTitle;

    if (b.code && b.code.text) {
      slides.push({
        kind: "code",
        title: heading,
        eyebrow: moduleTitle,
        code: b.code,
      });
      continue;
    }

    if (TAKEAWAY_RE.test(heading) && (b.bullets.length || b.paras.length)) {
      takeaways = (b.bullets.length ? b.bullets : b.paras)
        .map((x) => toShortPoint(x))
        .slice(0, 5);
      continue;
    }

    const points = (b.bullets.length ? b.bullets : b.paras)
      .map((x) => toShortPoint(x))
      .filter(Boolean);

    if (points.length === 0) continue;

    // Objectives or short lists with crisp headings → cards look better.
    if (
      !OBJECTIVE_RE.test(heading) &&
      points.length >= 3 &&
      points.length <= 4 &&
      points.every((p) => p.split(/\s+/).length <= 10)
    ) {
      slides.push({
        kind: "cards",
        title: heading,
        eyebrow: moduleTitle,
        cards: points.map((p) => ({ heading: p, body: "" })),
        imageQuery: moduleTitle,
      });
      continue;
    }

    // Otherwise bullets, chunked to 5 per slide.
    for (let i = 0; i < points.length; i += 5) {
      const chunk = points.slice(i, i + 5);
      slides.push({
        kind: "bullets",
        title: i === 0 ? heading : `${heading} (cont.)`,
        eyebrow: moduleTitle,
        bullets: chunk,
      });
    }
  }

  // Always end with a closing slide.
  if (takeaways.length === 0) {
    // Derive a closing from the first points we produced.
    const firstPoints = slides
      .flatMap((s) => s.bullets ?? s.cards?.map((c) => c.heading) ?? [])
      .slice(0, 4);
    takeaways = firstPoints.length
      ? firstPoints
      : [`Você concluiu o módulo "${moduleTitle}".`];
  }
  slides.push({
    kind: "closing",
    title: "Principais aprendizados",
    eyebrow: moduleTitle,
    bullets: takeaways.slice(0, 5),
  });

  // Guard: never return an empty module.
  if (slides.length === 0) {
    slides.push({
      kind: "bullets",
      title: moduleTitle,
      eyebrow: moduleTitle,
      bullets: [moduleTitle],
    });
  }
  return slides;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. DECK ASSEMBLY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the full deck. Tries the structured planner per module (in small
 * concurrent batches) and falls back deterministically per module on failure.
 * NEVER throws — always returns a renderable deck.
 */
export async function buildDeck(
  courseTitle: string,
  subtitle: string,
  modules: ModuleInput[],
  language: string,
  geminiKey: string | null,
  opts: { batchSize?: number } = {},
): Promise<{ deck: PlannedDeck; plannedCount: number; fallbackCount: number }> {
  const batchSize = opts.batchSize ?? 1;
  const out: DeckModule[] = new Array(modules.length);
  let plannedCount = 0;
  let fallbackCount = 0;

  for (let start = 0; start < modules.length; start += batchSize) {
    const batch = modules.slice(start, start + batchSize);
    await Promise.all(
      batch.map(async (m, j) => {
        const idx = start + j;
        let slides: SlideSpec[] | null = null;
        if (geminiKey) {
          slides = await planModuleSlides(
            courseTitle,
            m.title,
            m.content,
            language,
            geminiKey,
          );
        }
        if (slides && slides.length) {
          plannedCount++;
        } else {
          slides = fallbackModuleSlides(m.title, m.content);
          fallbackCount++;
        }
        out[idx] = { title: m.title, slides };
      }),
    );
  }

  return {
    deck: { courseTitle, subtitle, modules: out },
    plannedCount,
    fallbackCount,
  };
}
