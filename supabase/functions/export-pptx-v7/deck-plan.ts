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
 * Reference shape of a planned deck. NOTE: this is no longer passed to Gemini
 * as a responseSchema — a rich schema made the constrained decoder slow and, with
 * array maxItems, triggered HTTP 400 ("constraint has too many states"). We now
 * use plain JSON mode (responseMimeType) and describe this shape in the prompt;
 * salvageSlidesFromTruncatedJson + normalizeDeck enforce it downstream. Kept as
 * documentation of the contract the prompt asks for.
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

/**
 * Shrink planner INPUT so verbose modules (SQL/code) don't blow the token
 * budget. Long fenced code blocks are the main hog — the planner doesn't need
 * the full code to decide slide structure, so we collapse them to a few lines.
 * Prose is kept intact, then the whole thing is capped.
 */
export function condenseForPlanning(md: string, maxChars = 6000): string {
  const condensed = (md || "").replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_m, lang, body) => {
      const lines = String(body).split("\n");
      if (lines.length <= 8) return "```" + lang + "\n" + body + "```";
      // No "# ..." marker: the model used to echo it verbatim into the slide's
      // code field. Just keep the first lines as a hint of the example.
      return "```" + lang + "\n" + lines.slice(0, 8).join("\n") + "\n```";
    },
  );
  return condensed.length > maxChars ? condensed.slice(0, maxChars) : condensed;
}

export type Density = "compact" | "standard" | "detailed";
// Density maps directly to the per-module slide-count band advertised in the
// export dialog (PptxExportDialog DENSITY_LABELS). The engine has no hard slide
// cap (only per-slide content caps), so this band is what actually makes the
// "Compacto / Padrão / Detalhado" control change the deck.
const DENSITY_SPECS: Record<Density, { min: number; max: number; note: string }> = {
  compact: {
    min: 5,
    max: 7,
    note: "Lean & visual: prefer FEWER slides with breathing room; keep only the essential points.",
  },
  standard: {
    min: 6,
    max: 8,
    note: "Balanced coverage — the default rhythm.",
  },
  detailed: {
    min: 7,
    max: 9,
    note: "Thorough: split the material into MORE focused slides; add supporting cards/steps where it helps comprehension.",
  },
};

export function buildModulePlanPrompt(
  courseTitle: string,
  moduleTitle: string,
  moduleContent: string,
  language: string,
  outline: string[] = [],
  moduleIndex = 0,
  covered: string[] = [],
  density: Density = "standard",
): string {
  const dspec = DENSITY_SPECS[density] ?? DENSITY_SPECS.standard;
  // NOTE: deliberately ZERO domain rules. We describe slide *shapes* and
  // universal visual-design quality, and let the model map ANY topic onto them.
  const trimmed = condenseForPlanning(moduleContent, 4000);
  // Cross-module awareness: each module is planned in isolation, so without the
  // course outline the model re-derives shared themes in every module (e.g. it
  // re-explains the same overarching premise) → a repetitive deck. We give it
  // its position + the other module titles and tell it to stay in its lane.
  const others = outline.filter((_, i) => i !== moduleIndex);
  const outlineBlock = outline.length > 1
    ? `\nCOURSE OUTLINE (this is module ${moduleIndex + 1} of ${outline.length}):\n` +
      outline.map((t, i) =>
        `  ${i + 1}. ${t}${i === moduleIndex ? "  ← THIS MODULE" : ""}`
      ).join("\n") +
      `\nSCOPE DISCIPLINE: cover ONLY what is unique to THIS module. Do NOT
re-explain concepts that belong to the other modules listed above; assume the
audience will see those separately. Do not restate the course's overarching
premise on its own slide unless THIS module is specifically about it.\n`
    : "";
  // Running ledger of slide titles already produced by EARLIER modules. Titles
  // alone (the v1 scope discipline) weren't enough — the source content of
  // several modules overlaps, so each call faithfully re-rendered the same
  // subtopic (e.g. "Documentos Pós-Planejamento" appeared in 3 modules). Naming
  // the exact slides already made lets the model actually skip the duplicates.
  const coveredBlock = covered.length
    ? `\nALREADY COVERED in earlier modules (do NOT repeat these — even if this
module's source text overlaps, omit the duplicate or reference it in one line
instead of a full slide):\n` +
      covered.slice(0, 40).map((t) => `  • ${t}`).join("\n") + "\n"
    : "";
  return `You are a world-class presentation designer (think Gamma / Apple Keynote).
Turn the module below into a sequence of clean, render-ready slides.

COURSE: "${courseTitle}"
MODULE: "${moduleTitle}"
OUTPUT LANGUAGE: ${language}
${outlineBlock}${coveredBlock}
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
- Bullets are SHORT, PARALLEL POINTS — not full sentences. DISTILL prose into
  telegraphic fragments of ≤12 words (the way a real slide reads). If the source
  is a paragraph, extract its key point; do NOT copy the sentence verbatim.
- MAX 5 bullets/items per slide. If a topic needs more, split it across 2 slides
  or use "cards"/"steps". Never produce a wall of long sentences.
- BE CONCISE: your JSON must be SHORTER than the source. SUMMARIZE for slides —
  do not elaborate, do not re-teach the whole text. HARD LIMIT: ${dspec.max} slides total.
- Code fields: at most 10 lines. Never paste a long script.
- No trailing "...", no dangling preposition; every point ends cleanly.
- Vary the slide types across the module — avoid many "bullets" slides in a row.
- ${dspec.min} to ${dspec.max} slides per module. ${dspec.note}
- The LAST slide MUST be "closing" with 3–5 key takeaways as bullets. These
  takeaways must be SPECIFIC to THIS module's content — not generic restatements
  of the whole course's themes.
- ALWAYS add a short English "imageQuery" (2–4 words) on the FIRST slide of the
  module and on any section/quote/stat/cards slide. Omit it for code/compare.
- For code slides, put COMPLETE, runnable code in the "code" field, with a REAL
  newline (\n) ending every statement and comment — one statement per line.
  Never put two statements on the same line; never insert "...", "# ...", or
  "-- ..." placeholders.
- Stay strictly faithful to the module content. Do NOT invent facts.

MODULE CONTENT (markdown):
"""
${trimmed}
"""

OUTPUT FORMAT — return ONLY a JSON object of this exact shape (omit fields a
slide doesn't use; never add other keys):
{
  "slides": [
    {
      "kind": "bullets|cards|steps|compare|quote|stat|code|closing",
      "title": "string (required, complete phrase)",
      "subtitle": "string (optional)",
      "bullets": ["short point", "..."],
      "cards": [{ "heading": "string", "body": "string" }],
      "steps": [{ "heading": "string", "body": "string" }],
      "left":  { "heading": "string", "items": ["..."] },
      "right": { "heading": "string", "items": ["..."] },
      "quote": "string",
      "stat":  { "value": "42%", "label": "string" },
      "code":  { "language": "sql", "text": "SELECT id FROM users;\\nSELECT 1;" },
      "imageQuery": "two to four english words"
    }
  ]
}
Return the JSON object only — no markdown fences, no prose before or after.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PLANNER LLM CALL (Gemini structured output)
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_PLAN_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

/**
 * Extract the complete slide objects from a TRUNCATED planner response.
 * When Gemini hits its output cap (finishReason=MAX_TOKENS) the JSON is cut
 * mid-array, so JSON.parse fails. Rather than discard the whole module to
 * fallback, we walk the `"slides": [ ... ` array and recover every object that
 * was fully emitted before the cut. Topic-agnostic, string/escape aware.
 */
export function salvageSlidesFromTruncatedJson(text: string): SlideSpec[] {
  const key = text.indexOf('"slides"');
  if (key === -1) return [];
  const bracket = text.indexOf("[", key);
  if (bracket === -1) return [];
  const out: SlideSpec[] = [];
  const n = text.length;
  let i = bracket + 1;
  while (i < n) {
    while (i < n && /[\s,]/.test(text[i])) i++; // skip whitespace/commas
    if (i >= n || text[i] === "]") break;
    if (text[i] !== "{") break;
    let depth = 0, inStr = false, esc = false, j = i;
    for (; j < n; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { j++; break; }
      }
    }
    if (depth !== 0) {
      // Last object was cut off. Try to recover its complete leading fields
      // (kind/title/etc.) so we still get a slide instead of nothing.
      const partial = recoverPartialObject(text.slice(i));
      if (partial) out.push(partial);
      break;
    }
    try {
      const obj = JSON.parse(text.slice(i, j));
      if (obj && typeof obj === "object" && obj.kind && obj.title) {
        out.push(obj as SlideSpec);
      }
    } catch { /* skip a malformed object */ }
    i = j;
  }
  return out;
}

/**
 * Recover as much of a truncated object as possible. A comma (outside a string)
 * always follows a COMPLETE value, so the longest prefix ending at a comma is
 * valid once we close every still-open bracket. Taking the LAST such comma keeps
 * not just the leading fields (kind/title) but also the complete elements of a
 * trailing array that was cut mid-flight — e.g. a giant "bullets":[...] keeps
 * every bullet that fully landed, instead of dropping the whole slide.
 */
function recoverPartialObject(s: string): SlideSpec | null {
  const open = s.indexOf("{");
  if (open === -1) return null;
  const stack: string[] = [];
  let inStr = false, esc = false;
  let cutIdx = -1; // index of the last comma outside a string
  let cutStack: string[] = []; // bracket stack at that comma
  for (let j = open; j < s.length; j++) {
    const c = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
    else if (c === "," && stack.length >= 1) {
      cutIdx = j;
      cutStack = [...stack];
    }
  }
  if (cutIdx === -1) return null;
  // Close every open bracket (innermost first) to balance the prefix.
  const closers = cutStack
    .reverse()
    .map((b) => (b === "{" ? "}" : "]"))
    .join("");
  try {
    const o = JSON.parse(s.slice(open, cutIdx) + closers);
    if (o && typeof o === "object" && o.kind && o.title) return o as SlideSpec;
  } catch { /* unrecoverable */ }
  return null;
}

/**
 * Calls Gemini with responseSchema so the answer is guaranteed JSON of the
 * right shape. Returns SlideSpec[] for ONE module, or null on any failure
 * (caller falls back to the deterministic plan — never throws to the user).
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function planModuleSlides(
  courseTitle: string,
  moduleTitle: string,
  moduleContent: string,
  language: string,
  geminiKey: string,
  outline: string[] = [],
  moduleIndex = 0,
  covered: string[] = [],
  density: Density = "standard",
): Promise<SlideSpec[] | null> {
  const prompt = buildModulePlanPrompt(
    courseTitle,
    moduleTitle,
    moduleContent,
    language,
    outline,
    moduleIndex,
    covered,
    density,
  );
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.35,
      // JSON mode WITHOUT a responseSchema. A rich responseSchema made Gemini's
      // constrained decoder (a) slow and (b) blow up with HTTP 400 "schema
      // produces a constraint that has too many states" once we added maxItems
      // to bound the structure. responseMimeType still guarantees syntactically
      // valid JSON; the shape is specified in the prompt and enforced downstream
      // by salvageSlidesFromTruncatedJson + normalizeDeck. The token cap bounds
      // wall-time; salvage recovers complete slides (and partial arrays) on cut.
      maxOutputTokens: 8000,
      responseMimeType: "application/json",
    },
  });

  // Retry ONLY transient failures (429 / 5xx / empty / network). A truncated
  // response (MAX_TOKENS) is NOT retried — retrying just truncates again and
  // burns the time budget; we salvage what we can, else fall back immediately.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const last = attempt === MAX_ATTEMPTS;
    const backoff = 1500 * attempt; // 1.5s, 3s
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);
      let res: Response;
      try {
        res = await fetch(`${GEMINI_PLAN_URL}?key=${geminiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        // Capture the API error body (e.g. a rejected schema) so a 4xx is
        // debuggable from logs instead of an opaque "HTTP 400".
        const errBody = await res.text().catch(() => "");
        console.warn(
          `[V7-PLAN] "${moduleTitle}" attempt ${attempt}/${MAX_ATTEMPTS} HTTP ${res.status}${retryable && !last ? " → retry" : " → fallback"} ${errBody.slice(0, 300)}`,
        );
        if (retryable && !last) {
          await sleep(backoff);
          continue;
        }
        return null;
      }

      const data = await res.json();
      const cand = data?.candidates?.[0];
      const finishReason = cand?.finishReason ?? "";
      const text: string = cand?.content?.parts?.[0]?.text ?? "";

      if (!text) {
        const reason = data?.promptFeedback?.blockReason || finishReason ||
          "empty";
        console.warn(
          `[V7-PLAN] "${moduleTitle}" attempt ${attempt}/${MAX_ATTEMPTS} empty (${reason})${last ? " → fallback" : " → retry"}`,
        );
        if (!last) {
          await sleep(backoff);
          continue;
        }
        return null;
      }

      let slides: SlideSpec[] | null = null;
      try {
        const parsed = JSON.parse(text);
        slides = Array.isArray(parsed?.slides) ? parsed.slides : null;
      } catch {
        slides = salvageSlidesFromTruncatedJson(text);
      }

      if (slides && slides.length) {
        console.log(
          `[V7-PLAN] "${moduleTitle}" OK slides=${slides.length} finishReason=${finishReason} attempt=${attempt}`,
        );
        return slides.map((s) => ({ ...s, eyebrow: moduleTitle }));
      }

      console.warn(
        `[V7-PLAN] "${moduleTitle}" attempt ${attempt} no slides (finishReason=${finishReason} textLen=${text.length}) → fallback`,
      );
      // Truncation / unsalvageable: do NOT retry (it just truncates again).
      return null;
    } catch (err) {
      console.warn(
        `[V7-PLAN] "${moduleTitle}" attempt ${attempt}/${MAX_ATTEMPTS} threw${last ? " → fallback" : " → retry"}:`,
        err,
      );
      if (!last) {
        await sleep(backoff);
        continue;
      }
      return null;
    }
  }
  return null;
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
  tableRows: string[][];
}

const LEADING_EMOJI_RE =
  /^(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]\s*)+/u;

/** Remove a leading emoji + space from a heading (e.g. "🎯 Objetivo" → "Objetivo"). */
function stripLeadingEmoji(s: string): string {
  return s.replace(LEADING_EMOJI_RE, "").trim();
}

/** Split prose into complete sentences (so we never cut mid-sentence). */
function splitSentences(s: string): string[] {
  return s
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Table separator row like |:---|---:| (no real content). */
function isTableSeparator(cells: string[]): boolean {
  return cells.length > 0 &&
    cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")));
}

/** Very small markdown segmenter: groups content under ### headings. */
function segmentMarkdown(md: string): MdBlock[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  const empty = (): MdBlock => ({
    heading: "",
    bullets: [],
    paras: [],
    code: null,
    tableRows: [],
  });
  let cur: MdBlock = empty();
  let inCode = false;
  let codeLang = "";
  let codeBuf: string[] = [];

  const push = () => {
    if (
      cur.heading || cur.bullets.length || cur.paras.length || cur.code ||
      cur.tableRows.length
    ) {
      blocks.push(cur);
    }
    cur = empty();
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
    const tl = line.trim();
    if (tl.startsWith("|") && tl.includes("|", 1)) {
      const cells = tl.split("|").slice(1, -1).map((c) => cleanLine(c.trim()));
      if (!isTableSeparator(cells) && cells.some((c) => c)) {
        cur.tableRows.push(cells);
      }
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

const TAKEAWAY_RE =
  /resumo|takeaway|key\s*takeaway|conclus|s[íi]ntese|aprendizad|recapitul|pontos?\s+principais|o que aprend/i;
const OBJECTIVE_RE = /objetivo|aprende|ao final|learning|goals?/i;

/**
 * Turn a chunk of prose into ONE short, COMPLETE point. Uses the first full
 * sentence (never cuts mid-sentence); if that sentence is still very long, it
 * trims back to the last comma so the line ends on a clause, not a dangling
 * word. This is what prevents fallback bullets like "...operações sigam".
 */
function toShortPoint(s: string, maxWords = 18): string {
  const first = (splitSentences(s)[0] || s).trim();
  const words = first.split(/\s+/);
  if (words.length <= maxWords) return first;
  const capped = words.slice(0, maxWords).join(" ");
  const lastComma = capped.lastIndexOf(",");
  return (lastComma > 20 ? capped.slice(0, lastComma) : capped).trim();
}

/** Convert a markdown table block into a real slide (never raw `|---|` text). */
function tableToSlide(
  heading: string,
  moduleTitle: string,
  rows: string[][],
): SlideSpec {
  const header = rows[0];
  const data = rows.slice(1).filter((r) => r.some((c) => c));
  const cols = Math.max(...rows.map((r) => r.length));
  if (cols === 3 && data.length >= 1) {
    const items = (idx: number) =>
      data.slice(0, 4).map((r) =>
        toShortPoint(`${r[0]}: ${r[idx] ?? ""}`.trim())
      );
    return {
      kind: "compare",
      title: heading,
      eyebrow: moduleTitle,
      left: { heading: header[1] || "Opção A", items: items(1) },
      right: { heading: header[2] || "Opção B", items: items(2) },
    };
  }
  return {
    kind: "bullets",
    title: heading,
    eyebrow: moduleTitle,
    bullets: data.slice(0, 5).map((r) =>
      toShortPoint(`${r[0]} — ${r.slice(1).filter(Boolean).join(" / ")}`)
    ),
  };
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
    const heading = stripLeadingEmoji(b.heading) || moduleTitle;

    if (b.code && b.code.text) {
      slides.push({
        kind: "code",
        title: heading,
        eyebrow: moduleTitle,
        code: b.code,
      });
      continue;
    }

    // Markdown tables become real comparison/bullet slides (never raw `|---|`).
    if (b.tableRows.length >= 2) {
      slides.push(tableToSlide(heading, moduleTitle, b.tableRows));
      continue;
    }

    if (TAKEAWAY_RE.test(heading) && (b.bullets.length || b.paras.length)) {
      takeaways =
        (b.bullets.length ? b.bullets : b.paras.flatMap(splitSentences))
          .map((x) => toShortPoint(x))
          .filter(Boolean)
          .slice(0, 5);
      continue;
    }

    const points =
      (b.bullets.length ? b.bullets : b.paras.flatMap(splitSentences))
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

    // Otherwise bullets — emit one slide; validate.normalizeDeck splits it
    // into balanced slides if needed (no orphan "(cont.)" with a single item).
    slides.push({
      kind: "bullets",
      title: heading,
      eyebrow: moduleTitle,
      bullets: points,
    });
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

// Recap/intro/closing slides legitimately recur once per module, so they must
// NOT enter the de-dup ledger (otherwise module 2's closing would suppress
// module 3's). Matches common PT/EN scaffolding titles, topic-agnostically.
const GENERIC_TITLE_RE =
  /(principais\s+(aprendizados|conclus|pontos)|aprendizados|conclus[õo]es|objetivos|vis[ãa]o\s+geral|introdu[çc][ãa]o|bem[-\s]?vindo|resumo|s[íi]ntese|recapitula|key\s+takeaways|takeaways|summary|overview|objectives|welcome|introduction|conclusion)/i;
function isGenericTitle(title: string): boolean {
  return GENERIC_TITLE_RE.test(title);
}

// The planner often opens a module with a title like "Bem-vindo ao Módulo 1:
// <nome>", which duplicates the module name already shown in the divider and the
// slide eyebrow right above it. Strip the "Bem-vindo ao Módulo X:" / "Welcome to
// Module X:" scaffolding and keep the real subject. Topic-agnostic.
const MODULE_INTRO_PREFIX_RE =
  /^\s*(?:bem[-\s]?vindos?\s+ao|welcome\s+to(?:\s+the)?)\s+m[óo]dul[oe]\s*\d*\s*[:\-–—]\s*/i;
function stripModuleIntroPrefix(title: string): string {
  const cleaned = title.replace(MODULE_INTRO_PREFIX_RE, "").trim();
  // Never blank out a title; if the prefix WAS the whole title, keep original.
  return cleaned.length >= 3 ? cleaned : title;
}

/**
 * Builds the full deck. Tries the structured planner per module (sequentially,
 * so each module can de-duplicate against earlier ones) and falls back
 * deterministically per module on failure. NEVER throws — always returns a
 * renderable deck.
 */
export async function buildDeck(
  courseTitle: string,
  subtitle: string,
  modules: ModuleInput[],
  language: string,
  geminiKey: string | null,
  opts: { batchSize?: number; density?: Density } = {},
): Promise<{ deck: PlannedDeck; plannedCount: number; fallbackCount: number }> {
  const density = opts.density ?? "standard";
  // Modules are planned SEQUENTIALLY (not the old 3-wide concurrent batches) so
  // each call can receive the slide titles already produced by earlier modules
  // and skip duplicate subtopics. This is the cross-module de-duplication fix:
  // passing only module titles wasn't enough because the source content itself
  // overlaps. Trade-off: we lose parallelism, but the export stays well within
  // the 480s timeout and the deck no longer repeats whole slides across modules.
  const out: DeckModule[] = new Array(modules.length);
  const outline = modules.map((m) => m.title); // for cross-module scope discipline
  const covered: string[] = []; // running ledger of slide titles already made
  let plannedCount = 0;
  let fallbackCount = 0;

  for (let idx = 0; idx < modules.length; idx++) {
    const m = modules[idx];
    let slides: SlideSpec[] | null = null;
    if (geminiKey) {
      slides = await planModuleSlides(
        courseTitle,
        m.title,
        m.content,
        language,
        geminiKey,
        outline,
        idx,
        covered,
        density,
      );
    }
    if (slides && slides.length) {
      plannedCount++;
    } else {
      slides = fallbackModuleSlides(m.title, m.content);
      fallbackCount++;
    }
    // Drop the redundant "Bem-vindo ao Módulo X:" prefix the planner likes to
    // put on the opening slide (the module name is already in the divider +
    // eyebrow right above it).
    for (const sp of slides) {
      if (sp.title) sp.title = stripModuleIntroPrefix(sp.title);
    }
    // Feed this module's substantive slide titles into the ledger for the next
    // modules. Skip generic recap/intro slides so we don't suppress every
    // module's own closing or objectives slide.
    for (const sp of slides) {
      const title = (sp.title || "").trim();
      if (title.length >= 6 && !isGenericTitle(title)) covered.push(title);
    }
    out[idx] = { title: m.title, slides };
  }

  return {
    deck: { courseTitle, subtitle, modules: out },
    plannedCount,
    fallbackCount,
  };
}
