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

import { esqueletoDeCaso, trimToWholeThought } from "./layout-fit.ts";
import { tetoDoCorpoDoPasso } from "./table-geometry.ts";

export type SlideKind =
  | "cover" // course cover
  | "toc" // agenda / table of contents
  | "section" // module divider
  | "bullets" // title + up to 5 supporting points
  | "tiles" // 3–6 short points as an icon/badge grid (visual variant of bullets)
  | "bento" // 2–4 short points as surface cards (anti-monotony variant of bullets)
  | "cards" // 2–4 concept cards
  | "steps" // ordered process / sequence
  | "compare" // two-column comparison
  | "matrix" // 2×2 quadrant analysis (SWOT, effort×impact) — uses 4 cards
  | "table" // multi-column comparison grid (N options × M criteria)
  | "quote" // pull-quote / reflection prompt
  | "stat" // single big-number highlight
  | "chart" // donut (proportions) or horizontal bar (magnitudes)
  | "code" // monospace code block
  | "closing"; // summary / key takeaways

export interface DeckChartPoint {
  label: string;
  value: number;
}

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

/** One row of a comparison table: a criterion label plus one cell per column. */
export interface DeckTableRow {
  label: string;
  cells: string[];
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
  /** "table" kind: option headers across the top (the row-label column is implicit). */
  columns?: string[];
  /** "table" kind: one row per criterion; cells align to `columns`. */
  rows?: DeckTableRow[];
  /** "table" kind: optional header for the row-label column (top-left cell). */
  rowHeader?: string;
  quote?: string;
  attribution?: string;
  stat?: { value: string; label: string };
  /** "chart" kind: donut (proportions) or horizontal bar (magnitude ranking). */
  chart?: { type: "donut" | "bar"; points: DeckChartPoint[]; unit?: string };
  code?: { language: string; text: string };
  /** Free-text search query for an optional decorative image. */
  imageQuery?: string;
  /** base64 data URI, populated at runtime when images are enabled. */
  imageData?: string;
  /** How a hero image is laid out (set at runtime): bleed right/left, or top. */
  imageLayout?: "split-right" | "split-left" | "top";
  /** Speaker notes. */
  notes?: string;
}

export interface DeckModule {
  title: string;
  slides: SlideSpec[];
  /**
   * Os objetivos do módulo, quando foram retirados do slide de "Visão Geral"
   * para irem à divisória. Ver `objetivosParaDivisoria`.
   */
  objectives?: string[];
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
              "matrix",
              "quote",
              "stat",
              "chart",
              // "table" já era anunciada ao modelo no prompt e no exemplo de
              // JSON, mas não constava aqui — então ele nunca pôde escolhê-la.
              // As tabelas dos decks vinham todas do caminho determinístico.
              "table",
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
          // ── chart e table: por que estavam faltando, e o que isso causava ──
          //
          // Este esquema não é documentação: é CONTRATO. A resposta do modelo é
          // gerada sob `responseSchema`, então o que não está declarado aqui
          // simplesmente não pode ser devolvido — a API descarta antes de nos
          // entregar.
          //
          // "chart" estava na lista de `kind` permitidos, o prompt o descrevia,
          // o exemplo de JSON o mostrava por extenso, o normalizador sabia
          // tratá-lo e o renderizador sabia desenhá-lo. Só faltava o lugar onde
          // os dados moram. Resultado: toda vez que o planejador decidia fazer
          // um gráfico, o objeto com os pontos era removido no caminho, o slide
          // chegava vazio e `isRenderable` o descartava por ter menos de dois
          // pontos. O gráfico era IMPOSSÍVEL desde que o v7 foi escrito.
          //
          // Foi por isso que nada do que fizemos antes o acordou: pôr número no
          // conteúdo era necessário, alargar o que o planejador enxerga era
          // necessário, transformar a permissão em exigência era necessário — e
          // nenhum dos três bastava, porque a porta estava fechada mais adiante.
          //
          // "table" tinha o mesmo defeito, com um disfarce: as tabelas que
          // aparecem nos decks vêm do caminho determinístico
          // (fallbackModuleSlides lendo tabelas do markdown), nunca do
          // planejador. Como havia tabelas, ninguém procurou o buraco.
          chart: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["donut", "bar"] },
              unit: { type: "string" },
              points: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    value: { type: "number" },
                  },
                  required: ["label", "value"],
                },
              },
            },
            required: ["type", "points"],
          },
          columns: { type: "array", items: { type: "string" } },
          rows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                cells: { type: "array", items: { type: "string" } },
              },
              required: ["label", "cells"],
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
// A FUNÇÃO PROMETIA CONDENSAR E ENTREGAVA UM CORTE
//
// Ela encurtava blocos de código e, no fim, fazia `slice(0, maxChars)`. Chamada
// com 4.000 sobre um módulo real de ~32.000 caracteres, isso significa que o
// planejador enxergava **12% do módulo** — sempre os 12% iniciais, que são a
// abertura e os objetivos, e quase nunca a substância.
//
// Medido no curso de orçamento de 20/08: dos 153 percentuais que o conteúdo
// passou a trazer, só 12 caíam dentro da janela. Os 141 restantes eram
// invisíveis para quem monta os slides. Foi por isso que o tipo de slide
// "chart" continuou dormente mesmo depois de o conteúdo ganhar números: o
// gargalo tinha mudado de lugar sem ninguém perceber.
//
// O corte também caía no meio de uma frase e desprezava a estrutura: um módulo
// com cinco seções chegava como uma seção e meia.
//
// O QUE ELA FAZ AGORA
//
// Condensa de verdade, preservando o que serve para PLANEJAR e descartando o
// que serve para LER. Quem planeja precisa da estrutura (os títulos), das
// evidências (números, tabelas, listas) e do assunto de cada parágrafo — não da
// prosa inteira. Por isso, dentro de cada parágrafo:
//
//   • toda frase com número sobrevive — é ela que sustenta gráfico, destaque
//     numérico e citação de norma;
//   • a primeira frase sobrevive — é ela que diz do que o parágrafo trata;
//   • o resto sai.
//
// Títulos, itens de lista e linhas de tabela ficam sempre: são curtos e são
// exatamente a matéria-prima dos slides.
//
// Só se ainda passar do orçamento é que se corta — e aí em fronteira de LINHA,
// nunca no meio de uma frase.

/** Uma frase que carrega número: percentual, valor, prazo, artigo de lei. */
const TEM_NUMERO = /\d/;

function condensarParagrafo(paragrafo: string): string {
  const frases = paragrafo.split(/(?<=[.!?])\s+/).filter((f) => f.trim());
  if (frases.length <= 1) return paragrafo;
  const mantidas = frases.filter((f, i) => i === 0 || TEM_NUMERO.test(f));
  return mantidas.join(" ");
}

export function condenseForPlanning(md: string, maxChars = 6000): string {
  const semCodigoLongo = (md || "").replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_m, lang, body) => {
      const lines = String(body).split("\n");
      if (lines.length <= 8) return "```" + lang + "\n" + body + "```";
      // No "# ..." marker: the model used to echo it verbatim into the slide's
      // code field. Just keep the first lines as a hint of the example.
      return "```" + lang + "\n" + lines.slice(0, 8).join("\n") + "\n```";
    },
  );
  if (semCodigoLongo.length <= maxChars) return semCodigoLongo;

  let dentroDeCodigo = false;
  const linhas = semCodigoLongo.split("\n").map((linha) => {
    const t = linha.trim();
    if (t.startsWith("```")) {
      dentroDeCodigo = !dentroDeCodigo;
      return linha;
    }
    // Código, título, item de lista, linha de tabela e citação passam inteiros:
    // são curtos e são a estrutura que o planejador transforma em slide.
    if (
      dentroDeCodigo || !t ||
      /^#{1,6}\s/.test(t) || /^([-*+]|\d{1,3}[.)])\s/.test(t) ||
      t.startsWith("|") || t.startsWith(">")
    ) {
      return linha;
    }
    return condensarParagrafo(linha);
  });

  const condensado = linhas.join("\n");
  if (condensado.length <= maxChars) return condensado;

  // Ainda longo: corta em fronteira de linha, para não entregar meia frase.
  const cortado = condensado.slice(0, maxChars);
  const ultimaQuebra = cortado.lastIndexOf("\n");
  return (ultimaQuebra > maxChars * 0.5 ? cortado.slice(0, ultimaQuebra) : cortado)
    .trimEnd();
}

export type Density = "compact" | "standard" | "detailed";
// Density maps directly to the per-module slide-count band advertised in the
// export dialog (PptxExportDialog DENSITY_LABELS). The engine has no hard slide
// cap (only per-slide content caps), so this band is what actually makes the
// "Compacto / Padrão / Detalhado" control change the deck.
const DENSITY_SPECS: Record<Density, { min: number; max: number; note: string }> = {
  compact: {
    min: 4,
    max: 6,
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
  // 4.000 era pouco mesmo depois de condensar: um módulo real tem ~32.000
  // caracteres, e a condensação o leva a algo em torno de um terço disso. Com
  // 9.000 o planejador passa a ver o módulo inteiro na maioria dos casos, e o
  // custo é modesto — cerca de 2.500 tokens a mais por módulo.
  const trimmed = condenseForPlanning(moduleContent, 9000);
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
- "matrix"   → a 2×2 quadrant analysis (SWOT, risk×impact, effort×value). Provide
  EXACTLY 4 "cards": each card heading is the quadrant label, body a 1-line note.
  Use ONLY for genuine cartesian classifications — not for any list of 4 things.
- "table"    → a multi-column comparison: 2–5 options ("columns") compared across
  2–6 criteria ("rows"). Each row has a "label" (the criterion) and one short
  "cells" entry per column, in column order. Use this — NOT bullets or "compare" —
  whenever 3+ things are compared on several attributes (e.g. data types across
  Order/Mutability/Syntax; file modes; HTTP methods). Keep every cell to a short
  phrase, never a sentence.
- "quote"    → a memorable principle or reflection prompt. NOT a glossary entry:
  a term and its dictionary definition go in "cards" (heading = the term, body =
  the definition), where several terms share one slide. A full-screen pull-quote
  spent on "X is defined as…" wastes the module's strongest visual beat.
- "stat"     → one striking number or metric worth a whole slide.
- "chart"    → quantitative data worth visualizing. When the module's source
  contains two or more comparable numbers — percentages of a whole, legal limits
  against actual figures, values across categories — you MUST use a chart slide
  for them. A number that stays inside a paragraph is a number the audience will
  not see. Provide "chart" with a "type"
  and 2–6 "points", each { "label", "value" } (value is a NUMBER, no units in it):
    • type "donut" → parts of a whole / proportions that add up (market share,
      time split, % breakdown). Optionally set "unit":"%".
    • type "bar"   → ranking/comparison of magnitudes across categories (adoption
      by tool, cost per option, scores).
  ONLY use real numbers present or clearly implied by the source — never invent
  data. If you have no numbers, do NOT use "chart".
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
  The imageQuery must describe a CONCRETE, photographable scene that visually
  evokes the topic — a real thing a stock photo could show (e.g. "team meeting
  whiteboard", "person reviewing documents", "city infrastructure inspection").
  NEVER use abstract nouns alone ("communication", "quality", "planning"); turn
  the concept into a literal scene with people, objects or places.
- For code slides, put COMPLETE, runnable code in the "code" field, with a REAL
  newline (\n) ending every statement and comment — one statement per line.
  Never put two statements on the same line; never insert "...", "# ...", or
  "-- ..." placeholders.
- VARY THE LAYOUT — do NOT make every module the same bullets/cards/steps rhythm:
  • If the module teaches programming or shows commands/code, INCLUDE at least one
    "code" slide with the real snippet.
  • Use "compare" for any Problem-vs-Solution, Before-vs-After, Manual-vs-IA or
    Tradicional-vs-Otimizado contrast — it genuinely aids comprehension, so do NOT
    flatten these into plain bullets. BUT if the module has SEVERAL such contrasts,
    render only the 1–2 STRONGEST as "compare" and turn the rest into a "table" or
    "cards" — never 3+ near-identical "compare" slides in a row.
  • Use "matrix" when 4 items classify along two axes (SWOT, effort×impact).
  • Use "table" when 3+ options are compared across several criteria (a
    comparison that would otherwise become a cramped bullet list).
  • Add AT MOST ONE "quote" OR "stat" per module, and only when the source
    offers a genuinely striking principle or number, to break the visual rhythm.
    Two quote slides in a row render as two near-identical screens — if you have
    two candidates, keep the stronger one and make the other a "cards" slide.
  • Every module must TEACH, not just frame: at least half of its slides should
    be "cards" / "steps" / "compare" / "table" carrying the module's actual
    substance. A module made only of an overview, a quote and a recap is a
    failure even if each slide is individually well-formed.
  • Use "chart" (donut for proportions, bar for ranking magnitudes) whenever the
    source gives two or more comparable REAL numbers — never with invented data.
    A module whose source carries percentages, legal limits or figures across
    categories and ships WITHOUT a chart has wasted its clearest evidence.
- Do NOT prepend ordinals ("1.", "2)") inside a step's heading — the renderer
  numbers steps automatically. Write the heading as plain text.
- Plain text only in every field — NO Markdown emphasis (no asterisks, backticks or #).
- For cards, tiles, steps and table cells, enforce a MAXIMUM of ~12 words per text
  block. Be ruthless in your summarization — these layouts must stay minimalist.
- Stay strictly faithful to the module content. Do NOT invent facts.
- NEVER collapse a list of N DISTINCT items into one point. If the source lists
  3 trends / 4 types / 5 risks, the slide keeps ALL of them (split across two
  slides if needed). A content slide must have at least 2 items — never ship a
  slide with a single bullet/card/step.
- MANDATORY COVERAGE — these practical sections are the MOST valuable part of the
  course; each MUST get its OWN slide whenever the source contains it (this is
  REQUIRED, even if it means going one slide over the band above — never drop it):
  • Worked example ("Exemplo prático" / "Estudo de caso", usually with Contexto/
    Desafio/Solução/Resultado): a "steps" slide (Contexto → Desafio → Solução →
    Resultado) or a "compare" (Desafio vs Solução).
  • Hands-on activity ("Atividade Prática" / "Mão na massa"): a "steps" slide
    titled after the activity, each numbered task as one short step heading.
  • Comparison table under "Modelos / Tipos" (3+ options across several
    criteria, with concrete tool/example names): a "table" slide — KEEP the
    real names (e.g. Khan Academy, Geekie, MagicSchool.ai). Do NOT flatten it
    into vague bullets that lose the examples.

MODULE CONTENT (markdown):
"""
${trimmed}
"""

OUTPUT FORMAT — return ONLY a JSON object of this exact shape (omit fields a
slide doesn't use; never add other keys):
{
  "slides": [
    {
      "kind": "bullets|cards|steps|compare|matrix|table|quote|stat|chart|code|closing",
      "title": "string (required, complete phrase)",
      "subtitle": "string (optional)",
      "bullets": ["short point", "..."],
      "cards": [{ "heading": "string", "body": "string" }],
      "steps": [{ "heading": "string", "body": "string" }],
      "left":  { "heading": "string", "items": ["..."] },
      "right": { "heading": "string", "items": ["..."] },
      "columns": ["Option A", "Option B", "Option C"],
      "rows": [{ "label": "Criterion", "cells": ["cell A", "cell B", "cell C"] }],
      "quote": "string",
      "stat":  { "value": "42%", "label": "string" },
      "chart": { "type": "donut|bar", "unit": "%", "points": [{ "label": "string", "value": 42 }] },
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

/**
 * Extract the slides array from a successfully-parsed Gemini JSON response.
 *
 * We ask for `{ "slides": [...] }` in the prompt, but because we run JSON mode
 * WITHOUT a responseSchema (a rich schema made the constrained decoder slow /
 * blow up), the model occasionally ships the SAME slides in a different
 * envelope — most often a bare top-level array `[ {...} ]`, or under an
 * alternately-named/cased key. Without this tolerance those valid responses
 * were discarded and the module dropped to the deterministic fallback even
 * though finishReason=STOP and the JSON was complete. We accept:
 *   1. a top-level array,
 *   2. `parsed.slides` (canonical),
 *   3. otherwise the longest array-of-objects among the top-level values.
 * Downstream normalizeDeck still validates/repairs every slide.
 */
export function extractSlidesArray(parsed: any): SlideSpec[] | null {
  if (Array.isArray(parsed)) return parsed.length ? (parsed as SlideSpec[]) : null;
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.slides) && parsed.slides.length) return parsed.slides;
    let best: any[] | null = null;
    for (const v of Object.values(parsed)) {
      if (
        Array.isArray(v) && v.length &&
        typeof v[0] === "object" && v[0] !== null && !Array.isArray(v[0])
      ) {
        if (!best || v.length > best.length) best = v;
      }
    }
    if (best) return best as SlideSpec[];
  }
  return null;
}

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
        slides = extractSlidesArray(parsed);
      } catch {
        slides = salvageSlidesFromTruncatedJson(text);
      }

      if (slides && slides.length) {
        console.log(
          `[V7-PLAN] "${moduleTitle}" OK slides=${slides.length} finishReason=${finishReason} attempt=${attempt}`,
        );
        return slides.map((s) => ({ ...s, eyebrow: moduleTitle }));
      }

      // finishReason STOP with text but no extractable slides means the model
      // returned prose / mis-fenced JSON, NOT a length cut-off — a retry can
      // fix it (this is what dropped Module 8 to the plain-text fallback). Only
      // a genuine truncation (MAX_TOKENS/LENGTH) would just truncate again.
      const truncated = /MAX_TOKENS|LENGTH/i.test(finishReason);
      console.warn(
        `[V7-PLAN] "${moduleTitle}" attempt ${attempt}/${MAX_ATTEMPTS} no slides (finishReason=${finishReason} textLen=${text.length})${!truncated && !last ? " → retry" : " → fallback"}`,
      );
      if (!truncated && !last) {
        await sleep(backoff);
        continue;
      }
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
    // Itálico de verdade é *palavra*, colado ao texto. Exigir que não haja
    // espaço logo depois do primeiro asterisco nem logo antes do último impede
    // que a fórmula "((2 * D * CP) / CM)" perca os sinais de multiplicação — o
    // par " * D * " casava com a regra antiga e virava " D ", trocando a
    // fórmula do LEC por outra coisa dentro da célula da atividade.
    .replace(/\*(\S[^*]*?\S|\S)\*/g, "$1")
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

// Um ponto final nem sempre encerra uma frase. Estas são as formas que mais
// aparecem no meio de uma: abreviações de tratamento e de referência.
const ABBREV_RE =
  /(?:^|[\s(])(?:sr|sra|srs|sras|dr|dra|drs|dras|prof|profa|profs|profas|exm[oa]|ilm[oa]|jr|av|r|pç|ltda|jr|min|máx|max|aprox|ex|etc|obs|fig|tab|art|arts|inc|p[áa]g|p|n[ºo]|cf|vs|s[ée]c|ed|org|coord|trad|ref|cap|vol|op|cit|i\.e|e\.g|p\.ex)\.$/i;

/** "1." / "12)" sozinhos — o ordinal de um item de lista, não uma frase. */
const BARE_ORDINAL_RE = /^\d{1,3}\s*[.)]$/;

/** Uma inicial isolada ("J.") também não encerra frase. */
const INITIAL_RE = /(?:^|\s)[A-ZÀ-Ý]\.$/;

/**
 * Divide prosa em frases completas (para nunca cortar no meio de uma).
 *
 * A divisão ingênua em `(?<=[.!?])\s+` trata QUALQUER ponto como fim de frase,
 * e dois casos muito comuns quebravam o deck:
 *
 *   • O ordinal de uma lista. "1. Revise a Persona…" virava a frase "1.", e
 *     como toShortPoint usa a primeira frase, o slide de atividade saía com
 *     quatro barras numeradas contendo apenas "1.", "2.", "3.", "4.".
 *   • A abreviação de tratamento. "Como o Sr. João pode…" virava "Como o Sr.",
 *     e três estudos de caso foram entregues com o Desafio e a Solução
 *     cortados na terceira palavra — um deles com a Solução vazia.
 *
 * A correção divide como antes e depois REMENDA: um pedaço cujo anterior
 * termina em abreviação, inicial ou ordinal isolado pertence àquele anterior.
 * O laço trata cadeias ("1. Sr. João decidiu.") porque cada remendo é avaliado
 * contra o pedaço já acumulado.
 */
function splitSentences(s: string): string[] {
  const partes = s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const parte of partes) {
    const anterior = out[out.length - 1];
    if (
      anterior !== undefined &&
      (BARE_ORDINAL_RE.test(anterior) ||
        ABBREV_RE.test(anterior) ||
        INITIAL_RE.test(anterior))
    ) {
      out[out.length - 1] = `${anterior} ${parte}`;
      continue;
    }
    out.push(parte);
  }
  return out
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
function toShortPoint(s: string, maxWords = 14): string {
  let first = (splitSentences(s)[0] || s).trim();

  // CHAMADA DE LISTA NÃO É FRASE
  //
  // "Sr. João organizou os dados da seguinte forma: 1." foi para o slide 11 do
  // deck de 22/08 exatamente assim. A primeira frase termina anunciando uma
  // lista que o slide não traz — e o "1." solto no fim parece defeito de
  // renderização. Some o número órfão e os dois-pontos que o chamavam; o que
  // sobra ("…organizou os dados da seguinte forma") já é uma afirmação inteira.
  first = first.replace(/:\s*\d{1,2}[.)]?\s*$/, "").trim();

  // O PARÊNTESE É O PRIMEIRO A SAIR
  //
  // Antes de cortar qualquer coisa, sacrifica-se o aparte. A frase do slide 11
  // era "…classificou o Café Premium, Sabão em Pó e Arroz 5kg como itens da
  // Categoria A (representando a maior parte do valor de vendas)": 28 palavras
  // com o parêntese, 21 sem ele. Era o parêntese que estourava o orçamento e
  // forçava um corte no meio da enumeração. Sem ele, a frase cabe inteira — e
  // uma frase inteira é sempre melhor que uma cortada, por melhor que se corte.
  if (first.split(/\s+/).length > maxWords) {
    const semAparte = first.replace(/\s*\([^()]*\)\s*([.!?])?\s*$/, "$1").trim();
    if (semAparte && semAparte.split(/\s+/).length <= maxWords) first = semAparte;
  }

  const words = first.split(/\s+/);
  if (words.length <= maxWords) return first;
  const capped = words.slice(0, maxWords).join(" ");

  // CORTAR NO MEIO DE UMA ENUMERAÇÃO TROCA O FATO
  //
  // A vírgula é um bom lugar para cortar — a não ser quando ela separa itens de
  // uma lista. O slide 11 do deck de 22/08 dizia "o Sr. João classificou o Café
  // Premium", e a frase original era "classificou o Café Premium, Sabão em Pó e
  // Arroz 5kg como itens da Categoria A". O corte não deixou a frase pela
  // metade: deixou uma frase inteira e ERRADA, afirmando que só um produto foi
  // classificado como A. É pior que truncar, porque não parece truncado.
  //
  // Quando o que vem depois da vírgula é continuação de lista — mais um item e
  // um "e" logo adiante —, recua para a vírgula anterior, que está fora da
  // enumeração.
  const continuaLista = (resto: string) => /^\s*[^.,;:]{1,40}\s+e\s+/.test(resto);
  let lastComma = capped.lastIndexOf(",");
  while (lastComma > 20 && continuaLista(first.slice(lastComma + 1))) {
    lastComma = capped.lastIndexOf(",", lastComma - 1);
  }
  const cortado = (lastComma > 20 ? capped.slice(0, lastComma) : capped).trim();
  // Sem vírgula onde se apoiar, o corte cai no meio do pensamento
  // ("…classificou o Café Premium"). capText, adiante, não vai limpar isto: ele
  // só apara o que ELE MESMO cortou, e daqui em diante o texto já parece curto
  // e inteiro. A limpeza tem de ser feita aqui, por quem cortou.
  return trimToWholeThought(cortado);
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
// Module X:" scaffolding (and the bare "Módulo N:" / "Module N:" form) and keep
// the real subject. Topic-agnostic.
const MODULE_INTRO_PREFIX_RE =
  /^\s*(?:bem[-\s]?vindos?\s+ao|welcome\s+to(?:\s+the)?)\s+m[óo]dul[oe]\s*\d*\s*[:\-–—]\s*/i;
const MODULE_NUM_PREFIX_RE = /^\s*m[óo]dul[oe]\s*\d+\s*[:\-–—]\s*/i;
function stripModuleIntroPrefix(title: string): string {
  let cleaned = title.replace(MODULE_INTRO_PREFIX_RE, "").trim();
  cleaned = cleaned.replace(MODULE_NUM_PREFIX_RE, "").trim();
  // Never blank out a title; if the prefix WAS the whole title, keep original.
  return cleaned.length >= 3 ? cleaned : title;
}

// Accent-insensitive comparison key (lowercase, no diacritics, single-spaced).
function normKey(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// True when `a` is essentially the same as `ref` — exact match OR a leading slice
// covering most of it. The planner often echoes the COURSE title minus its
// subtitle (e.g. "Dominando o Planejamento de Auditorias Operacionais" vs the
// full "…: Fundamentos e Boas Práticas"), which an exact check would miss.
export function echoesTitle(a: string, ref: string): boolean {
  const x = normKey(a);
  const y = normKey(ref);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.startsWith(short) && short.length >= long.length * 0.6;
}

// When the FIRST content slide's title is just the module name (already shown in
// the divider + eyebrow), demote it to a localized "module overview" label so we
// don't print the same name three times. Unknown language → keep the title.
function moduleOverviewLabel(language: string): string {
  const l = language.toLowerCase();
  if (/portug/.test(l)) return "Visão Geral do Módulo";
  if (/espa|spanish/.test(l)) return "Visión General del Módulo";
  if (/fran|french/.test(l)) return "Vue d'ensemble du module";
  if (/ingl|engl/.test(l)) return "Module Overview";
  return "";
}

// ── Cross-module near-duplicate removal ──────────────────────────────────────
// The title-ledger stops the planner from RESTATING a theme, but when two
// modules' source text overlaps it still renders the same content under
// different titles (e.g. M2's "Documentos Chave do Planejamento" vs M3's
// "Documentos Fundamentais Pós-Planejamento" — identical cards). This
// deterministic pass fingerprints each content slide's BODY (never its title)
// and drops a LATER slide whose body is near-identical to an earlier one.
const DUP_STOPWORDS = new Set(
  "para com como uma dos das que the and for sao seu sua suas seus mais nao por entre cada todos toda este esta esse essa pela pelo num numa aos nas nos ser sobre".split(" "),
);
function contentTokens(s: SlideSpec): Set<string> {
  const parts: string[] = [];
  if (s.bullets) parts.push(...s.bullets);
  if (s.cards) for (const c of s.cards) parts.push(c.heading, c.body);
  if (s.steps) for (const st of s.steps) parts.push(st.heading, st.body ?? "");
  if (s.left) parts.push(s.left.heading, ...s.left.items);
  if (s.right) parts.push(s.right.heading, ...s.right.items);
  if (s.quote) parts.push(s.quote);
  // Previously omitted: stat / code / table slides were invisible to the dedup,
  // which let the SAME big-number stat resurface in two modules (e.g. a "US$ 47
  // bilhões" market-size slide). Fold their text in too.
  if (s.stat) parts.push(s.stat.value, s.stat.label);
  if (s.code?.text) parts.push(s.code.text);
  if (s.columns) parts.push(...s.columns);
  if (s.rows) for (const r of s.rows) parts.push(r.label, ...r.cells);
  if (s.subtitle) parts.push(s.subtitle);
  const text = parts.join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const toks = (text.match(/[a-z]{4,}/g) ?? [])
    .filter((t) => !DUP_STOPWORDS.has(t) && t !== "edugenai");
  return new Set(toks);
}
function overlapMin(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let common = 0;
  for (const t of small) if (large.has(t)) common++;
  return common / small.size;
}
// Tuned empirically on a real overlapping deck: targets land at 0.65–0.75 while
// the nearest legitimate pair sits at 0.53. min-size 10 excludes dividers /
// quotes / overview slides whose tiny token sets cause spurious matches.
const DUP_SIM_THRESHOLD = 0.6;
const DUP_MIN_TOKENS = 10;
/**
 * Normalize a stat value to a comparable signature. The same figure dressed
 * differently ("$47 Bilhões" vs "47 Bilhões de Dólares") must collapse to ONE
 * signature, so when a scale/magnitude word is present we key on just the leading
 * number + a canonical scale letter (47 + "b"). Without a scale word we keep the
 * full normalized text, to avoid merging unrelated bare numbers.
 */
function statSignature(value: string): string {
  const norm = value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const num = (norm.match(/\d[\d.,]*/)?.[0] ?? "").replace(/[.,]/g, "");
  if (!num) return norm.replace(/[^a-z0-9]/g, "");
  let scale = "";
  if (/tril|trillion/.test(norm)) scale = "t";
  else if (/bilh|billion|\bbi\b|\bbn\b/.test(norm)) scale = "b";
  else if (/milh|million|\bmi\b|\bmm\b/.test(norm)) scale = "m";
  else if (/\bmil\b|thousand|\bk\b/.test(norm)) scale = "k";
  else if (/%|percent|por\s*cento/.test(norm)) scale = "p";
  else if (/\bx\b|vezes|\btimes\b/.test(norm)) scale = "x";
  return scale ? num + scale : norm.replace(/[^a-z0-9]/g, "");
}

export function dedupeModules(modules: DeckModule[]): number {
  const seen: Set<string>[] = [];
  const seenStats = new Set<string>();
  let dropped = 0;
  for (const m of modules) {
    const kept: SlideSpec[] = [];
    for (const sp of m.slides) {
      // Never drop a module's own closing slide (takeaways are module-specific).
      if (sp.kind === "closing") {
        kept.push(sp);
        continue;
      }
      // A big-number stat repeated across modules is pure redundancy; its token
      // set is too small for the overlap test, so match on the value itself.
      if (sp.kind === "stat" && sp.stat?.value) {
        const sig = statSignature(sp.stat.value);
        if (sig) {
          if (seenStats.has(sig)) {
            dropped++;
            continue;
          }
          seenStats.add(sig);
        }
      }
      const tk = contentTokens(sp);
      if (tk.size >= DUP_MIN_TOKENS) {
        if (seen.some((p) => overlapMin(p, tk) >= DUP_SIM_THRESHOLD)) {
          dropped++;
          continue;
        }
        seen.push(tk);
      }
      kept.push(sp);
    }
    m.slides = kept;
  }
  return dropped;
}

// ── Per-module floor (the invariant that ends "hollow module" regressions) ────
// The sequential planner + anti-repetition ledger can starve a module whose
// source overlaps an earlier one: the LLM, told its themes are "already
// covered", returns just an objectives slide (sometimes no closing). The
// cross-module dedup can also thin a module. Rather than chase each symptom, we
// enforce a hard invariant on the ASSEMBLED deck: every module renders with at
// least FLOOR_MIN_CONTENT content slides AND exactly one closing. Shortfalls are
// backfilled deterministically from the module's OWN source text (which is
// self-contained and ledger-free), skipping only slides that would near-
// duplicate one already in the same module. Completeness wins over a blank
// module; the cross-module dedup still prevents wholesale repetition elsewhere.
// 2 = at least an objectives/overview slide PLUS one substantive content slide,
// then a closing. We never force a higher floor by fabricating: a thin source
// yields a thin (but complete and honest) module rather than padding.
// A flat floor of 2 was far below what the density spec asks the planner for
// (6–8 content slides at "standard"), so a module the planner under-served just
// shipped thin: a 3-lesson module went out with 4 content slides, two of which
// were glossary definitions. The floor now tracks the density the user chose,
// one below its minimum — enough slack for a legitimately short module without
// licensing a hollow one.
const INTRA_DUP_THRESHOLD = 0.85;
/**
 * Exportada porque o teste de robustez precisa montar um módulo que já esteja
 * NO piso, e um número copiado à mão ali envelhece calado — foi o que
 * aconteceu quando o piso subiu de 2 para 5 e o fixture ficou em três slides.
 */
export function floorMinContent(density: Density): number {
  return Math.max(2, (DENSITY_SPECS[density] ?? DENSITY_SPECS.standard).min - 1);
}
export function enforceModuleFloors(
  out: DeckModule[],
  inputs: ModuleInput[],
  density: Density = "standard",
): { backfilled: number; closingsAdded: number } {
  const minContent = floorMinContent(density);
  let backfilled = 0;
  let closingsAdded = 0;
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    const content = m.slides.filter((s) => s.kind !== "closing");
    let closing = m.slides.find((s) => s.kind === "closing") ?? null;
    const hadClosing = closing !== null;

    if (content.length < minContent) {
      const fb = fallbackModuleSlides(m.title, inputs[i]?.content ?? "");
      // Titles already on screen. With the floor raised from 2 to ~5 the
      // backfill runs far more often, and the token test alone (≥0.85 overlap)
      // is too permissive to stop it: the planner's "cards" version of a
      // section and the fallback's "bullets" version of the SAME section share
      // a heading but little wording, so both shipped. A section is on the deck
      // once, whatever shape it took.
      const titles = new Set(content.map((c) => normKey(c.title ?? "")).filter(Boolean));
      for (const s of fb) {
        if (content.length >= minContent) break;
        if (s.kind === "closing") continue;
        const key = normKey(s.title ?? "");
        if (key && titles.has(key)) continue;
        const tk = contentTokens(s);
        const dup = content.some(
          (c) => overlapMin(contentTokens(c), tk) >= INTRA_DUP_THRESHOLD,
        );
        if (!dup) {
          content.push(s);
          if (key) titles.add(key);
          backfilled++;
        }
      }
      if (!closing) closing = fb.find((s) => s.kind === "closing") ?? null;
    }

    if (!closing) {
      closing = {
        kind: "closing",
        title: "Principais aprendizados",
        eyebrow: m.title,
        bullets: content.map((s) => s.title).filter(Boolean).slice(0, 5),
      };
    }
    if (!hadClosing) closingsAdded++;
    m.slides = [...content, closing];
  }
  return { backfilled, closingsAdded };
}

// ── Pedagogical coverage (deterministic guarantee) ───────────────────────────
// The planner is TOLD to keep the practical content (worked example, hands-on
// activity, comparison tables), but under the slide-count cap + cross-module
// dedup it routinely drops them — exactly the sections that make a course
// actionable. Rather than trust the LLM, we enforce coverage on the assembled
// deck: for every module, if its SOURCE has a worked-example / activity / table
// section that NO planned slide represents, we backfill a render-ready slide
// built from that section. Topic-agnostic, idempotent, and skipped when already
// covered (so we never duplicate what the planner kept).
const ACTIVITY_RE =
  /atividade\s*pr[aá]tica|m[ãa]o\s*na\s*massa|hands[\s-]?on|pr[aá]tica\s+guiada/i;
const EXAMPLE_RE = /exemplo\s*pr[aá]tico|estudo\s+de\s+caso|case\s+study/i;
const CASE_LABEL_RE =
  /^(contexto|desafio|solu[çc][aã]o|resultado|problema|cen[aá]rio|tarefa|proposta|enunciado)\b/i;

function coverageTitles(
  language: string,
): { activity: string; example: string } {
  const l = (language || "").toLowerCase();
  if (/portug/.test(l)) return { activity: "Atividade Prática", example: "Estudo de Caso" };
  if (/espa|spanish/.test(l)) return { activity: "Actividad Práctica", example: "Estudio de Caso" };
  if (/fran|french/.test(l)) return { activity: "Activité Pratique", example: "Étude de Cas" };
  return { activity: "Hands-on Activity", example: "Case Study" };
}

/** Split "Lead: rest" / "Lead — rest" into a step heading + short body. */
function leadSplit(raw: string): DeckStep {
  // O renderizador desenha a própria numeração, então o ordinal que vem do
  // markdown ("1. Revise a Persona…") é ruído duas vezes: aparece ao lado do
  // número desenhado E consome parte do orçamento de palavras do título.
  const s = raw.replace(/^\s*\d{1,3}\s*[.)\-–]\s*/, "").trim();
  const m = s.match(/^([^:–—]{3,60})[:–—]\s+(.+)$/);
  if (m) return { heading: m[1].trim(), body: toShortPoint(m[2], 22) };
  return { heading: toShortPoint(s, 12) };
}

/** A hands-on activity block → a numbered "steps" slide. */
function buildActivitySlide(b: MdBlock, moduleTitle: string, title: string): SlideSpec | null {
  const raw = b.bullets.length ? b.bullets : b.paras.flatMap(splitSentences);
  const steps = raw.map(leadSplit).filter((s) => s.heading).slice(0, 5);
  if (steps.length < 2) return null;
  return { kind: "steps", title, eyebrow: moduleTitle, steps };
}

/** A worked-example block (Contexto/Desafio/Solução/Resultado) → "steps" slide. */
function buildExampleSlide(b: MdBlock, moduleTitle: string, title: string): SlideSpec | null {
  const labeled: DeckStep[] = [];
  const paras = b.paras;
  const labelOnly = /^([^:→]{3,28})[:→]\s*$/;
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i].trim();
    // Inline form: "Contexto: <text>".
    const inline = p.match(/^([^:→]{3,28})[:→]\s+(.+)$/);
    if (inline && CASE_LABEL_RE.test(inline[1].trim())) {
      labeled.push({ heading: inline[1].trim(), body: toShortPoint(inline[2], 24) });
      continue;
    }
    // Label-on-its-own-line form: "Contexto:" with the text in the NEXT paragraph.
    const lone = p.match(labelOnly);
    if (lone && CASE_LABEL_RE.test(lone[1].trim())) {
      const next = (paras[i + 1] ?? "").trim();
      if (next && !labelOnly.test(next)) {
        labeled.push({ heading: lone[1].trim(), body: toShortPoint(next, 24) });
        i++; // consume the body paragraph
      } else {
        labeled.push({ heading: lone[1].trim() });
      }
    }
  }
  if (labeled.length >= 2) {
    return { kind: "steps", title, eyebrow: moduleTitle, steps: labeled.slice(0, 4) };
  }
  // Fallback: first sentences as plain steps.
  const pts = b.paras.flatMap(splitSentences).map((s) => toShortPoint(s, 22)).filter(Boolean).slice(0, 4);
  if (pts.length >= 2) {
    return { kind: "steps", title, eyebrow: moduleTitle, steps: pts.map((h) => ({ heading: h })) };
  }
  return null;
}

/** Raw lines of the first section whose heading matches `headingRe`, up to the
 *  next heading or horizontal rule. Used to recover label→body structure that
 *  segmentMarkdown flattens away (e.g. "Resultado:" followed by bullets). */
function sliceSection(src: string, headingRe: RegExp): string[] {
  const lines = (src || "").replace(/\r\n/g, "\n").split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#{2,4}\s/.test(lines[i]) && headingRe.test(lines[i])) { start = i + 1; break; }
  }
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    if (/^#{2,4}\s/.test(lines[i]) || /^\s*---\s*$/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

const CASE_LABEL_LINE_RE =
  /^(contexto|desafio|solu[çc][aã]o|resultado|problema|cen[aá]rio)\b\s*[:→-]?\s*(.*)$/i;

/** Parse a worked-example section into Contexto/Desafio/Solução/Resultado steps,
 *  pairing each label with the prose AND/OR bullets that follow it (so a label
 *  whose content is a bullet list still gets a body). */
function buildExampleFromRaw(lines: string[], moduleTitle: string, title: string): SlideSpec | null {
  const steps: DeckStep[] = [];
  let label: string | null = null;
  let buf: string[] = [];
  let inCode = false;
  const flush = () => {
    if (label) {
      const text = buf.join(" ").trim();
      steps.push(text ? { heading: label, body: toShortPoint(text, 24) } : { heading: label });
    }
    buf = [];
  };
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const line = stripLeadingEmoji(cleanLine(raw));
    if (!line) continue;
    const m = line.match(CASE_LABEL_LINE_RE);
    if (m) {
      flush();
      label = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
      if (m[2]?.trim()) buf.push(m[2].trim());
      continue;
    }
    if (label) buf.push(line);
  }
  flush();
  const withBody = steps.filter((s) => s.body && s.body.trim());
  if (withBody.length >= 2) {
    return { kind: "steps", title, eyebrow: moduleTitle, steps: withBody.slice(0, 4) };
  }
  return null;
}

/** True for a steps slide that is a worked example (most headings are case labels). */
function isCaseStudySlide(s: SlideSpec): boolean {
  if (s.kind !== "steps" || !s.steps || s.steps.length < 2) return false;
  const labels = s.steps.filter((st) => CASE_LABEL_RE.test(st.heading || "")).length;
  return labels >= Math.ceil(s.steps.length / 2);
}

/** A 3+ column markdown table → a real "table" slide (never a cramped bullet list). */
function buildTableSlide(b: MdBlock, moduleTitle: string): SlideSpec | null {
  const rows = b.tableRows;
  if (rows.length < 2) return null;
  const cols = Math.max(...rows.map((r) => r.length));
  if (cols < 3) return null; // 2-col comparisons render fine elsewhere
  const header = rows[0];
  const data = rows.slice(1).filter((r) => r.some((c) => c));
  if (!data.length) return null;
  const columns = header.slice(1).map((h) => toShortPoint(h, 6)).filter(Boolean);
  if (columns.length < 2) return null;
  // O ORÇAMENTO DA CÉLULA É EM CARACTERES, NÃO EM PALAVRAS
  //
  // Eram 10 palavras aqui e 12 na normalização: dois cortes em série, e o
  // primeiro — o mais apertado — decidia tudo. Na atividade do LEC isso
  // significava perder justamente o que torna a instrução utilizável:
  //
  //   fonte : "Estime o Custo de Manutenção anual por unidade para o produto
  //            (ex: R$ 2,50 por unidade/ano)."
  //   slide : "Estime o Custo de Manutenção anual por unidade"
  //
  // A frase que sobra é gramaticalmente inteira — a limpeza de sobras faz o
  // seu trabalho — mas o exemplo que dizia ao aluno o que fazer sumiu. O
  // mesmo com a fórmula do LEC e com a pergunta que perdeu o ponto de
  // interrogação junto com o complemento.
  //
  // DOIS CORTADORES EM SÉRIE SÃO UM SÓ CORTADOR: O PRIMEIRO
  //
  // Quem decide o tamanho da célula é a normalização, que mede a coluna
  // (capacidadeDaCelula, em table-geometry.ts) e chega a 220 caracteres nas
  // tabelas de três colunas. Mas ela só vê o que o planejador deixou passar: um
  // teto de 18 palavras aqui equivale a ~110 caracteres e continuaria mandando,
  // com a medição da coluna sem efeito nenhum. Este teto existe só para conter
  // um parágrafo inteiro que tenha vindo como célula; o corte de verdade é lá.
  const trows: DeckTableRow[] = data.slice(0, 6).map((r) => ({
    label: toShortPoint(r[0], 6),
    cells: columns.map((_, ci) => toShortPoint(r[ci + 1] ?? "", 40)),
  }));
  return {
    kind: "table",
    title: stripLeadingEmoji(b.heading) || "Comparação",
    eyebrow: moduleTitle,
    rowHeader: toShortPoint(header[0] || "", 6),
    columns,
    rows: trows,
  };
}

/**
 * Assinatura de cabeçalho de um slide de tabela: o rótulo da coluna de rótulos
 * mais os cabeçalhos de dados, normalizados.
 *
 * Precisa somar `rowHeader` e `columns` porque a MESMA tabela aparece nas duas
 * formas dependendo de quem a montou: o planejador devolve as três colunas em
 * `columns` (o esquema nem tem `rowHeader`), e o construtor determinístico já
 * separa a primeira em `rowHeader`. Somando os dois campos, as duas formas dão
 * o mesmo conjunto.
 */
function assinaturaTabela(s: SlideSpec): Set<string> {
  const out = new Set<string>();
  for (const c of [s.rowHeader ?? "", ...(s.columns ?? [])]) {
    const t = String(c ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (t) out.add(t);
  }
  return out;
}

/** Dois slides de tabela são a MESMA tabela quando os cabeçalhos coincidem. */
function mesmaTabela(a: SlideSpec, b: SlideSpec): boolean {
  if (a.kind !== "table" || b.kind !== "table") return false;
  const x = assinaturaTabela(a);
  const y = assinaturaTabela(b);
  if (x.size < 2 || y.size < 2) return false;
  const [menor, maior] = x.size <= y.size ? [x, y] : [y, x];
  let comuns = 0;
  for (const t of menor) if (maior.has(t)) comuns++;
  return comuns >= 2 && comuns / menor.size >= 0.6;
}

// ── Speaker notes (deterministic) ────────────────────────────────────────────
// A slide carries ~45 words; the lesson it came from carries hundreds. Without
// notes the deck is ~10% of the course and the other 90% is simply discarded —
// an instructor gets 40+ screens of fragments and no narration. The `notes`
// field existed on SlideSpec but was never written and never rendered.
//
// We rebuild it deterministically instead of asking the planner for it: the
// planner call is already the pipeline's time bottleneck, and prose it invents
// for the notes would not be the course's own words. Matching each slide back
// to the source passage it was distilled from keeps the notes faithful, works
// identically for the LLM plan and the heuristic fallback, and costs no tokens.

const NOTES_MAX_CHARS = 900;
const NOTES_MIN_MATCH = 0.18; // below this the passage is about something else

/** Accent-folded content tokens of a raw string (same shape as contentTokens). */
function textTokens(raw: string): Set<string> {
  const text = (raw || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const toks = (text.match(/[a-z]{4,}/g) ?? [])
    .filter((t) => !DUP_STOPWORDS.has(t) && t !== "edugenai");
  return new Set(toks);
}

/** Jaccard-ish overlap, normalized by the SLIDE's vocabulary: we ask "how much
 *  of this slide does the passage explain?", not "how similar are they?" — a
 *  long passage should not be penalised for covering more than the slide. */
function coverage(slideToks: Set<string>, passToks: Set<string>): number {
  if (!slideToks.size || !passToks.size) return 0;
  let common = 0;
  for (const t of slideToks) if (passToks.has(t)) common++;
  return common / slideToks.size;
}

/** Trim a passage to the notes budget, always ending on a sentence. */
function fitNote(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length <= NOTES_MAX_CHARS) return t;
  const sentences = splitSentences(t);
  let out = "";
  for (const s of sentences) {
    if ((out + " " + s).trim().length > NOTES_MAX_CHARS) break;
    out = (out + " " + s).trim();
  }
  // A single sentence longer than the budget: cut on a word boundary.
  if (!out) {
    const sliced = t.slice(0, NOTES_MAX_CHARS);
    const sp = sliced.lastIndexOf(" ");
    out = (sp > 40 ? sliced.slice(0, sp) : sliced).trim();
  }
  return out;
}

/** The prose passages of a module, in document order, largest units first. */
// RECAPITULAÇÃO NÃO É NARRAÇÃO
//
// O bloco de pontos-chave do módulo repete, em forma curta, o vocabulário de
// tudo o que veio antes. Oferecido como trecho candidato, ele casa com QUASE
// TODO slide — e como casa forte, ganha pares que não são dele. Foi assim que o
// slide "PPA, LDO e LOA: Comparativo Essencial" recebeu como nota do orador os
// "📌 Pontos-chave" do módulo inteiro.
//
// O lugar desse texto é o slide de fechamento, que já o tem como conteúdo
// próprio. Como narração de outro slide, ele não explica: resume.
const RECAPITULACAO_RE =
  // "Principais Conclusões do Módulo" faltava: o plural não casava com
  // `conclusão do módulo`, e era o título do recapitulativo do módulo 5.
  /^\s*(?:📌\s*)?(?:pontos?[-\s]chave|principais\s+(?:aprendizados|pontos|conclus[õo]es)|resumo|recapitula|s[ií]ntese|key\s+takeaways?|takeaways?|em\s+resumo|conclus[õoãa]\w*\s+do\s+m[óo]dulo)\b/i;

function sourcePassages(content: string): { text: string; toks: Set<string> }[] {
  const out: { text: string; toks: Set<string> }[] = [];
  for (const b of segmentMarkdown(content)) {
    if (b.heading && RECAPITULACAO_RE.test(b.heading)) continue;
    const parts: string[] = [];
    if (b.heading) parts.push(b.heading);
    parts.push(...b.paras);
    // Bullets are already slide-shaped; they only help as narration when the
    // block has no prose of its own.
    if (!b.paras.length) parts.push(...b.bullets);
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    // Skip stubs: a heading alone narrates nothing.
    if (text.split(/\s+/).length < 25) continue;
    out.push({ text, toks: textTokens(text) });
  }
  return out;
}

// POR QUE AS NOTAS SAÍAM TROCADAS
//
// O relato: no slide "Benefícios do Planejamento Orçamentário" a nota era a
// atividade da LOA; no "Estágios da Receita Pública", os pontos-chave do módulo
// inteiro. A hipótese de quem relatou era que o texto-fonte fosse distribuído em
// sequência. Não é — cada slide procura mesmo o trecho que mais o explica. O
// defeito é mais sutil e está em COMO a escolha era feita.
//
// A varredura era gulosa na ORDEM DOS SLIDES: o primeiro slide pegava o melhor
// trecho ainda livre, o segundo o melhor do que sobrou, e assim por diante. Um
// slide que casa fraco com um trecho (0,20) chega antes e o consome; o slide
// que casaria forte com aquele mesmo trecho (0,70) chega depois, encontra-o
// ocupado e leva um resto qualquer. Os dois saem errados por causa da ordem de
// chegada — é o problema clássico de atribuição resolvido do jeito ingênuo.
//
// A CORREÇÃO tem duas partes.
//
// 1) Decidir pelos PARES, não pelos slides. Monta-se a tabela inteira de
//    slide × trecho, ordena-se por afinidade decrescente e atribui-se de cima
//    para baixo, pulando quem já foi usado. O par mais forte do módulo é
//    fechado primeiro, aconteça o que acontecer com a ordem dos slides. Continua
//    determinístico e é barato: dezenas de slides, dezenas de trechos.
//
// 2) Usar a ORDEM, que estava sendo ignorada. Slides e trechos seguem a mesma
//    progressão da lição: o terceiro slide de oito provavelmente nasceu perto do
//    terceiro trecho de oito. Isso entra como um empurrãozinho de proximidade,
//    pequeno de propósito — serve para desempatar afinidades parecidas, nunca
//    para vencer evidência de vocabulário.
//
// O piso de afinidade continua sendo cobrado sobre a afinidade CRUA, sem o
// empurrão: proximidade de posição não pode fabricar um par que o texto não
// sustenta. Sem par bom, o slide fica sem nota de propósito — para quem vai
// apresentar, narração errada é pior que nenhuma.

/** Quanto a proximidade de posição vale. Só desempata. */
const NOTES_PESO_ORDEM = 0.08;

/**
 * Attach speaker notes to every content slide by matching it back to the source
 * passage it was distilled from. A passage is consumed once so two slides never
 * get the same narration; when nothing matches well enough we leave the notes
 * empty on purpose — wrong narration is worse for an instructor than none.
 */
export function attachSpeakerNotes(
  out: DeckModule[],
  inputs: ModuleInput[],
): { withNotes: number; total: number } {
  let withNotes = 0;
  let total = 0;
  for (let i = 0; i < out.length; i++) {
    const passages = sourcePassages(inputs[i]?.content ?? "");

    // Os slides que podem receber nota, na ordem em que aparecem. Divisórias,
    // capa e sumário não ensinam nada por conta própria.
    //
    // O slide de RECAPITULAÇÃO também fica de fora, e por um motivo diferente:
    // o texto que o originou — os pontos-chave do módulo — já é excluído das
    // passagens de origem (ver RECAPITULACAO_RE acima), justamente para não ser
    // usado como narração de outro slide. Sobrando sem par natural, o
    // recapitulativo atraía a passagem que por acaso estivesse livre. Medido no
    // deck de 21/08: das três notas claramente fora de lugar, as três estavam
    // em "Principais Aprendizados" — o slide 10 narrava PPA/LDO/LOA com 4% de
    // vocabulário em comum. Ele não precisa de narração: seus próprios itens
    // JÁ são o resumo que o professor vai ler.
    const candidatos = out[i].slides.filter(
      (s) =>
        s.kind !== "section" && s.kind !== "cover" && s.kind !== "toc" &&
        s.kind !== "closing" && !RECAPITULACAO_RE.test(s.title ?? ""),
    );
    total += candidatos.length;
    if (!candidatos.length || !passages.length) continue;

    const posicao = (indice: number, quantos: number) =>
      quantos <= 1 ? 0.5 : indice / (quantos - 1);

    type Par = { slide: number; trecho: number; afinidade: number; nota: number };
    const pares: Par[] = [];
    candidatos.forEach((s, si) => {
      const toks = new Set<string>([
        ...textTokens(s.title ?? ""),
        ...contentTokens(s),
      ]);
      const ps = posicao(si, candidatos.length);
      passages.forEach((p, pi) => {
        const afinidade = coverage(toks, p.toks);
        if (afinidade < NOTES_MIN_MATCH) return;
        const perto = 1 - Math.abs(ps - posicao(pi, passages.length));
        pares.push({
          slide: si,
          trecho: pi,
          afinidade,
          nota: afinidade + NOTES_PESO_ORDEM * perto,
        });
      });
    });

    // Empate desfeito pela ordem do documento, para a saída não depender da
    // ordem em que os pares foram gerados.
    pares.sort((a, b) =>
      b.nota - a.nota || a.slide - b.slide || a.trecho - b.trecho
    );

    const slideUsado = new Set<number>();
    const trechoUsado = new Set<number>();
    for (const par of pares) {
      if (slideUsado.has(par.slide) || trechoUsado.has(par.trecho)) continue;
      slideUsado.add(par.slide);
      trechoUsado.add(par.trecho);
      candidatos[par.slide].notes = fitNote(passages[par.trecho].text);
      withNotes++;
    }
  }
  return { withNotes, total };
}

/** Escapa um texto para casar com ele mesmo, ao pé da letra, dentro de regex. */
function comoRegex(t: string): RegExp {
  return new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/**
 * O bloco PARECE um exemplo trabalhado pela forma, não pelo título?
 *
 * EXAMPLE_RE procura "exemplo prático", "estudo de caso" ou "case study" no
 * título. Só que o gerador de curso costuma dar ao exemplo um título temático:
 * no curso de orçamento, o exemplo do módulo 4 chama-se "Análise de Relatórios
 * para Conformidade Fiscal em Cidade Nova". Nenhuma das três expressões aparece
 * ali, então a seção ficava invisível e o slide do planejador — quatro rótulos
 * sem uma linha de conteúdo — ia para o deck do jeito que estava.
 *
 * A forma denuncia o que o título esconde: três ou mais rótulos de caso
 * (Contexto, Desafio, Solução, Resultado…) abrindo linhas do mesmo bloco.
 */
function pareceExemplo(b: MdBlock): boolean {
  const rotulos = new Set<string>();
  for (const linha of [...b.paras, ...b.bullets]) {
    const m = linha.match(CASE_LABEL_LINE_RE);
    if (m) {
      rotulos.add(
        m[1].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(),
      );
    }
  }
  return rotulos.size >= 3;
}

/** Reexporta a triagem compartilhada (ver layout-fit.ts) sob o nome local. */
const casoVazio = esqueletoDeCaso;

export function ensurePedagogicalCoverage(
  out: DeckModule[],
  inputs: ModuleInput[],
  language: string,
): {
  examplesAdded: number;
  activitiesAdded: number;
  tablesAdded: number;
  emptyExamplesDropped: number;
} {
  const t = coverageTitles(language);
  let examplesAdded = 0, activitiesAdded = 0, tablesAdded = 0;
  let emptyExamplesDropped = 0;
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    const src = inputs[i]?.content ?? "";
    if (!src) continue;
    const blocks = segmentMarkdown(src);
    const existing = m.slides.map(contentTokens);
    // A candidate is already represented when an existing slide really IS this
    // section — i.e. it shares MANY tokens with the candidate (≥5 in absolute
    // terms AND ≥50% of the smaller set). The absolute floor is essential: a
    // couple of incidental shared words ("aluno", "tema") between the candidate
    // and an unrelated slide must NOT count as coverage, or we'd skip backfilling
    // a section the planner actually dropped.
    const represented = (cand: SlideSpec): boolean => {
      const tk = contentTokens(cand);
      if (tk.size < 4) return true; // too thin to be worth a slide
      return existing.some((p) => {
        if (!p.size) return false;
        let common = 0;
        const [small, large] = p.size <= tk.size ? [p, tk] : [tk, p];
        for (const t of small) if (large.has(t)) common++;
        return common >= 5 && common / small.size >= 0.5;
      });
    };
    const toAdd: SlideSpec[] = [];

    let exBlock = blocks.find((b) => EXAMPLE_RE.test(b.heading));
    let exRe = EXAMPLE_RE;
    if (!exBlock) {
      // Título temático: reconhece pela forma (ver pareceExemplo).
      exBlock = blocks.find((b) => b.heading && pareceExemplo(b));
      if (exBlock) exRe = comoRegex(exBlock.heading);
    }
    if (exBlock) {
      // Prefer the raw-section parser (captures a Resultado expressed as bullets);
      // fall back to the flattened-block builder.
      const exLines = sliceSection(src, exRe);
      const c = (exLines.length && buildExampleFromRaw(exLines, m.title, t.example)) ||
        buildExampleSlide(exBlock, m.title, t.example);
      if (c) {
        const bodied = (s: SlideSpec) => (s.steps ?? []).filter((st) => st.body && st.body.trim()).length;
        // Também acha o esqueleto que não é `steps` — um "Contexto ·
        // Desafio · Solução · Resultado" vazio em forma de cartões ou de
        // tópicos é o mesmo slide, e deve ser SUBSTITUÍDO pelo preenchido em
        // vez de ganhar um segundo slide ao lado.
        const existingIdx = m.slides.findIndex(
          (s) => isCaseStudySlide(s) || casoVazio(s),
        );
        if (existingIdx >= 0) {
          // The planner already made an example slide — replace it only if ours
          // is MORE complete (more steps carry a body), e.g. its Resultado was empty.
          if (bodied(c) > bodied(m.slides[existingIdx])) {
            c.eyebrow = m.slides[existingIdx].eyebrow ?? c.eyebrow;
            m.slides[existingIdx] = c;
            examplesAdded++;
          }
        } else if (!represented(c)) {
          toAdd.push(c);
          examplesAdded++;
        }
      }
    }
    // SÓ A PRIMEIRA TABELA DO MÓDULO ERA CONSIDERADA
    //
    // Era um `find`: encontrada a primeira tabela do módulo, as outras nem eram
    // olhadas. E bastava que ESSA primeira já estivesse coberta por algum slide
    // para o módulo inteiro ficar sem tabela nenhuma. Foi o que aconteceu com o
    // módulo 1 do curso de orçamento de 21/08: a primeira tabela é o
    // comparativo PPA/LDO/LOA, que o planejador já havia transformado em cartões
    // (slide 5); a checagem disse "coberta", e o modelo preenchível da atividade
    // — quatro linhas, o entregável da lição — nunca chegou ao deck.
    //
    // Agora todas as tabelas do módulo são consideradas, com teto de duas por
    // módulo para o deck não virar uma sequência de grades.
    const tblBlocks = blocks.filter(
      (b) => b.tableRows.length >= 2 && Math.max(...b.tableRows.map((r) => r.length)) >= 3,
    );
    let tabelasDesteModulo = 0;
    const tabelas: SlideSpec[] = [];
    const blocosComTabela = new Set<MdBlock>();
    for (const tblBlock of tblBlocks) {
      if (tabelasDesteModulo >= 2) break;
      const c = buildTableSlide(tblBlock, m.title);
      if (c) {
        // A TABELA AMPUTADA
        //
        // O planejador transcreve a tabela do módulo e, quando ela é longa,
        // transcreve SÓ A PRIMEIRA LINHA. Medido no curso de orçamento de
        // 21/08: a atividade "Identificação de Dados Críticos" tem cinco linhas
        // no PDF (pág. 57) e chegou ao slide 39 com uma. As outras quatro não
        // foram cortadas por nenhum limite nosso — MAX_TABLE_ROWS é 6, e a
        // tabela montada aqui a partir do markdown trazia as cinco. Elas nunca
        // foram escritas pelo planejador.
        //
        // A tabela completa era descartada logo em seguida porque `represented`
        // via a do planejador e concluía "esta seção já está no deck". Está —
        // amputada. É o mesmo caso já resolvido acima para o exemplo
        // trabalhado: quando já existe um slide do mesmo tipo para a mesma
        // seção, a pergunta certa não é "existe?" e sim "qual dos dois está
        // mais completo?".
        const linhas = (s: SlideSpec) => (s.rows ?? []).length;
        const idx = m.slides.findIndex((s) => mesmaTabela(s, c));
        if (idx >= 0) {
          if (linhas(c) > linhas(m.slides[idx])) {
            // O título e o olho do planejador já passaram pelo ajuste de
            // tamanho; só os dados vêm da fonte.
            c.title = m.slides[idx].title || c.title;
            c.eyebrow = m.slides[idx].eyebrow ?? c.eyebrow;
            m.slides[idx] = c;
            tablesAdded++;
          }
          tabelasDesteModulo++;
          blocosComTabela.add(tblBlock);
        } else if (!represented(c)) {
          tabelas.push(c);
          // Entra na lista de cobertura: sem isso, duas tabelas parecidas do
          // mesmo módulo entrariam as duas.
          existing.push(contentTokens(c));
          tablesAdded++;
          tabelasDesteModulo++;
          blocosComTabela.add(tblBlock);
        }
      }
    }

    // UM ARTEFATO POR SEÇÃO
    //
    // A atividade prática rende duas coisas: o modelo preenchível (tabela) e a
    // lista de passos. Nós acrescentávamos as DUAS, e o planejador ainda fazia
    // a sua própria versão — no deck de 21/08 o módulo 4 gastou TRÊS slides
    // seguidos com a mesma atividade (39, 40 e 41), todos sob o mesmo título.
    //
    // Entre os dois, o modelo preenchível é o que o aluno entrega; os passos
    // ficam no PDF e na nota do apresentador. Então, quando a tabela da própria
    // seção da atividade já entrou, o slide de passos não entra.
    const actBlock = blocks.find((b) => ACTIVITY_RE.test(b.heading));
    if (actBlock && !blocosComTabela.has(actBlock)) {
      const c = buildActivitySlide(actBlock, m.title, t.activity);
      if (c && !represented(c)) { toAdd.push(c); activitiesAdded++; }
    }
    toAdd.push(...tabelas);

    if (toAdd.length) {
      // Insert just before the closing so takeaways stay last.
      const ci = m.slides.findIndex((s) => s.kind === "closing");
      if (ci >= 0) m.slides.splice(ci, 0, ...toAdd);
      else m.slides.push(...toAdd);
    }

    // ÚLTIMA LINHA DE DEFESA
    //
    // Se, depois de tudo, ainda restar um estudo de caso sem corpo, ele sai. O
    // deck de 21/08 embarcou dois desses: os slides 26 e 38 mostravam ao aluno
    // "1 Contexto · 2 Desafio · 3 Solução · 4 Resultado" e mais nada. Um slide
    // com quatro rótulos e nenhuma frase não ensina — ocupa tempo de aula e faz
    // o professor parecer despreparado. Melhor não existir.
    for (let k = m.slides.length - 1; k >= 0; k--) {
      if (casoVazio(m.slides[k])) {
        m.slides.splice(k, 1);
        emptyExamplesDropped++;
      }
    }
  }
  return { examplesAdded, activitiesAdded, tablesAdded, emptyExamplesDropped };
}

// ── Assessment rubric (capstone modules) ─────────────────────────────────────
// The final project's rubric is the single artefact a learner most needs on
// screen — it is what they will be graded against — yet it was reaching the
// deck only by accident, as a generic table, and usually not at all: the
// planner spends its slide budget on the project's narrative instead.
//
// The pipeline renders it as a markdown table under "**Rubrica de avaliação**"
// with columns Critério | Peso | Excelente | Adequado | Precisa melhorar. Five
// columns of prose is unreadable projected, so we keep the two that define the
// target — the weight and what "excellent" looks like.

const RUBRIC_LABEL_RE = /rubrica\s+de\s+avalia|assessment\s+rubric|r[úu]brica\s+de\s+evaluaci|grille\s+d'?[ée]valuation/i;
const RUBRIC_HEADER_RE = /^(crit[ée]rio|criterion|crit[èe]re)s?$/i;
const WEIGHT_HEADER_RE = /^(peso|weight|poids|ponderaci[óo]n)$/i;

function rubricStrings(
  language: string,
): { title: string; weight: string; excellent: string; criterion: string } {
  const l = (language || "").toLowerCase();
  if (/portug/.test(l)) {
    return { title: "Como Você Será Avaliado", weight: "Peso", excellent: "Nível Excelente", criterion: "Critério" };
  }
  if (/espa|spanish/.test(l)) {
    return { title: "Cómo Serás Evaluado", weight: "Peso", excellent: "Nivel Excelente", criterion: "Criterio" };
  }
  if (/fran|french/.test(l)) {
    return { title: "Comment Vous Serez Évalué", weight: "Poids", excellent: "Niveau Excellent", criterion: "Critère" };
  }
  return { title: "How You Will Be Assessed", weight: "Weight", excellent: "Excellent Level", criterion: "Criterion" };
}

/** Find the rubric table in a module's source, whatever its column order. */
function findRubricTable(blocks: MdBlock[]): string[][] | null {
  for (const b of blocks) {
    if (b.tableRows.length < 2) continue;
    const header = b.tableRows[0].map((c) => c.trim());
    const hasCriterion = header.some((c) => RUBRIC_HEADER_RE.test(c));
    const hasWeight = header.some((c) => WEIGHT_HEADER_RE.test(c));
    // Either the table declares itself, or the block it lives in does.
    if ((hasCriterion && hasWeight) || RUBRIC_LABEL_RE.test(b.heading)) {
      return b.tableRows;
    }
  }
  return null;
}

/**
 * Guarantee a rubric slide in every module whose source carries one. Idempotent:
 * skipped when a slide already shows the rubric.
 */
export function ensureRubricSlide(
  out: DeckModule[],
  inputs: ModuleInput[],
  language: string,
): number {
  const t = rubricStrings(language);
  let added = 0;
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    const src = inputs[i]?.content ?? "";
    if (!src || !RUBRIC_LABEL_RE.test(src)) continue;
    // Already on a slide?
    if (m.slides.some((s) => RUBRIC_LABEL_RE.test(s.title ?? "") ||
      (s.columns ?? []).some((c) => WEIGHT_HEADER_RE.test(c.trim())))) continue;

    const rows = findRubricTable(segmentMarkdown(src));
    if (!rows || rows.length < 2) continue;
    const header = rows[0].map((c) => c.trim());
    const iCrit = Math.max(0, header.findIndex((c) => RUBRIC_HEADER_RE.test(c)));
    const iWeight = header.findIndex((c) => WEIGHT_HEADER_RE.test(c));
    // "Excelente" is the first descriptor column after the weight; fall back to
    // the column right after the criterion when the table has no weight column.
    const iBest = iWeight >= 0 ? iWeight + 1 : iCrit + 1;

    const trows: DeckTableRow[] = rows.slice(1)
      .filter((r) => (r[iCrit] ?? "").trim())
      .slice(0, 6)
      .map((r) => ({
        label: cleanLine(r[iCrit] ?? ""),
        cells: [
          iWeight >= 0 ? cleanLine(r[iWeight] ?? "") : "",
          cleanLine(r[iBest] ?? ""),
        ],
      }));
    if (trows.length < 2) continue;

    const slide: SlideSpec = {
      kind: "table",
      title: t.title,
      eyebrow: m.title,
      // A coluna dos critérios ficava sem cabeçalho — no deck de 21/08 o slide
      // "Como Você Será Avaliado" mostrava uma célula vazia sobre "Compreensão
      // e Análise", "Adequação Legal", "Clareza". Era a última tabela do deck
      // ainda com o canto em branco. O rótulo vem da própria fonte quando ela o
      // traz ("Critério"), com um padrão traduzido para quando não traz.
      rowHeader: cleanLine(header[iCrit] ?? "") || t.criterion,
      columns: iWeight >= 0 ? [t.weight, t.excellent] : [t.excellent],
      rows: iWeight >= 0 ? trows : trows.map((r) => ({ ...r, cells: [r.cells[1]] })),
    };
    // Just before the closing, so the takeaways still land last.
    const ci = m.slides.findIndex((s) => s.kind === "closing");
    if (ci >= 0) m.slides.splice(ci, 0, slide);
    else m.slides.push(slide);
    added++;
  }
  return added;
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
  // Modules are planned in small CONCURRENT BATCHES (default 3-wide). Pure
  // sequential planning let each call see every earlier module's slide titles
  // (best cross-module de-duplication) but cost ~16s/module — a 10-module course
  // then ran ~160s and was KILLED by the Edge Function wall-clock limit (~150s)
  // before it could render, surfacing to the user as the v4-fallback QA veto.
  // Batching keeps the cross-module ledger BETWEEN batches (batch N still sees
  // batches 1..N-1) and cuts wall-time ~Nx (10 modules → ~4 batches ≈ 60s); the
  // only overlap it can't catch is WITHIN a batch, which the deterministic
  // dedupeModules() net below removes.
  const BATCH = Math.max(1, opts.batchSize ?? 3);
  const out: DeckModule[] = new Array(modules.length);
  const outline = modules.map((m) => m.title); // for cross-module scope discipline
  const covered: string[] = []; // running ledger of slide titles already made
  const overview = moduleOverviewLabel(language);
  let plannedCount = 0;
  let fallbackCount = 0;

  for (let start = 0; start < modules.length; start += BATCH) {
    const batch = modules.slice(start, start + BATCH);
    // Snapshot the ledger so every module in this batch sees the SAME prior
    // context (they run concurrently and cannot observe each other's titles).
    const ledgerSnapshot = covered.slice();
    const results = await Promise.all(
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
            outline,
            idx,
            ledgerSnapshot,
            density,
          );
        }
        const planned = !!(slides && slides.length);
        if (!planned) slides = fallbackModuleSlides(m.title, m.content);
        return { idx, m, slides: slides!, planned };
      }),
    );

    // Per-module cleanup + ledger feed, applied IN ORDER after the batch so the
    // result is deterministic and the next batch's snapshot is stable.
    for (const r of results) {
      if (r.planned) plannedCount++;
      else fallbackCount++;
      // Drop the redundant "Bem-vindo ao Módulo X:" / "Módulo N:" prefix the
      // planner likes to put on the opening slide (the module name is already in
      // the divider + eyebrow right above it).
      for (const sp of r.slides) {
        if (sp.title) sp.title = stripModuleIntroPrefix(sp.title);
      }
      // Kill titles that just echo the module name or the COURSE title (the
      // planner often repeats one — sometimes the course title minus its
      // subtitle — printing divider + eyebrow + title all saying the same
      // thing). The opening slide becomes a localized "overview"; a later slide
      // that echoes the COURSE title falls back to the module name.
      r.slides.forEach((sp, i) => {
        if (!sp.title) return;
        const echoesModule = echoesTitle(sp.title, r.m.title);
        const echoesCourse = echoesTitle(sp.title, courseTitle);
        if (!echoesModule && !echoesCourse) return;
        if (i === 0 && overview) sp.title = overview;
        else if (echoesCourse) sp.title = r.m.title;
      });
      // Feed this module's substantive slide titles into the ledger for the next
      // batches. Skip generic recap/intro slides so we don't suppress every
      // module's own closing or objectives slide.
      for (const sp of r.slides) {
        const title = (sp.title || "").trim();
        if (title.length >= 6 && !isGenericTitle(title)) covered.push(title);
      }
      out[r.idx] = { title: r.m.title, slides: r.slides };
    }
  }

  // Deterministic safety net: remove cross-module near-duplicate slides the
  // title-ledger couldn't prevent (overlapping source rendered under different
  // titles). Runs after all modules are planned so it sees the full deck.
  const deduped = dedupeModules(out);
  if (deduped) console.log(`[V7-DEDUP] dropped=${deduped} near-duplicate slides`);

  // Pedagogical coverage: guarantee the practical sections (worked example,
  // hands-on activity, comparison table) survive even when the planner dropped
  // them under the slide cap. Runs AFTER dedup so its backfills aren't removed.
  const cov = ensurePedagogicalCoverage(out, modules, language);
  if (
    cov.examplesAdded || cov.activitiesAdded || cov.tablesAdded ||
    cov.emptyExamplesDropped
  ) {
    console.log(
      `[V7-COVERAGE] examples=${cov.examplesAdded} activities=${cov.activitiesAdded} tables=${cov.tablesAdded} emptyExamplesDropped=${cov.emptyExamplesDropped}`,
    );
  }

  // The capstone's rubric: added after coverage (so it isn't mistaken for the
  // generic comparison table) and before the floor (so it counts as content).
  const rubrics = ensureRubricSlide(out, modules, language);
  if (rubrics) console.log(`[V7-RUBRIC] slides=${rubrics}`);

  // Invariant: never ship a hollow module. Backfill from source / guarantee a
  // closing AFTER dedup so cross-module cleanup can't leave a module starved.
  const floor = enforceModuleFloors(out, modules, density);
  if (floor.backfilled || floor.closingsAdded) {
    console.log(
      `[V7-FLOOR] backfilled=${floor.backfilled} closingsAdded=${floor.closingsAdded}`,
    );
  }

  const grades = quebrarSequenciaDeLayout(out);
  if (grades) console.log(`[V7-VARIETY] tables converted to steps=${grades}`);

  // A visão geral vira os objetivos da divisória — antes das notas, para que o
  // slide removido não consuma uma passagem de origem que pertence a outro.
  const fundidos = objetivosParaDivisoria(out, language);
  if (fundidos) console.log(`[V7-OVERVIEW] merged into divider=${fundidos}`);

  // Rede para os módulos em que o planejador não escreveu visão geral nenhuma.
  const reserva = objetivosDeReserva(out, modules);
  if (reserva) console.log(`[V7-OVERVIEW] objectives from source=${reserva}`);

  // Speaker notes LAST: every slide the deck will ship now exists, including
  // the backfills above, so each one gets matched to its source passage.
  const notes = attachSpeakerNotes(out, modules);
  console.log(`[V7-NOTES] ${notes.withNotes}/${notes.total} slides with notes`);

  return {
    deck: { courseTitle, subtitle, modules: out },
    plannedCount,
    fallbackCount,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// A MOLDURA QUE SE REPETIA CINCO VEZES
//
// Medido no deck de estoque, 57 slides: 18 deles (32%) tinham papel estrutural
// fixo — divisória, "Visão Geral do Módulo" e recapitulação, iguais nos cinco
// módulos. O título "Visão Geral do Módulo" aparecia quatro vezes idêntico.
// Quem folheia sente déjà-vu antes de chegar ao conteúdo.
//
// Isto não é excesso de repertório de formas: é a MOLDURA repetindo. E a
// correção não pode ser cortar a visão geral, que tem função pedagógica — ela
// anuncia os objetivos da lição. A informação vai para a divisória, que hoje é
// só um número gigante e um título e tem página sobrando.
//
// Resultado: um slide a menos por módulo, a divisória deixa de ser decorativa,
// e o par "divisória + visão geral" para de dizer duas vezes a mesma coisa.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Um slide que só anuncia o módulo: título genérico de visão geral e tópicos.
 *
 * UM tópico já basta. O piso era de dois, para não montar uma coluna de
 * objetivos raquítica na divisória — e o efeito foi o oposto do pretendido: no
 * deck de 22/08 (3ª geração) o módulo 5 abriu com uma página inteira para uma
 * frase só, sob o título genérico "Visão Geral do Módulo". Uma linha na
 * divisória é melhor que um slide inteiro para uma linha.
 */
function ehVisaoGeral(
  s: SlideSpec | undefined,
  rotulo: string,
  tituloDoModulo: string,
): boolean {
  if (!s || !rotulo) return false;
  const t = (s.title ?? "").trim();
  if (!t) return false;
  // Precisa ser uma lista de tópicos e nada mais. Cartões, passos, tabela ou
  // imagem são conteúdo com forma própria — nada disso cabe numa coluna da
  // divisória, e absorvê-lo seria engolir a página, não desentupi-la.
  if (s.kind !== "bullets" || s.imageData) return false;
  if (!(s.bullets ?? []).some((b) => String(b ?? "").trim())) return false;

  // Dois nomes para a mesma coisa. O rótulo genérico ("Visão Geral do Módulo")
  // é atribuído quando o planejador repete o nome do módulo no primeiro slide —
  // mas essa renomeação nem sempre acontece, e aí o slide chega com o próprio
  // nome do módulo no título. Foi o caso do módulo 2 no deck de 22/08 (4ª
  // geração): "Avaliação Econômica do Estoque", com três objetivos e mais nada,
  // logo abaixo de uma divisória que já dizia "Avaliação Econômica do Estoque:
  // Custos de Pedido e Manutenção". A divisória e o slide diziam o mesmo nome,
  // em sequência.
  if (t.toLowerCase() === rotulo.trim().toLowerCase()) return true;
  return repeteONomeDoModulo(t, tituloDoModulo);
}

/**
 * O título do slide é o nome do módulo, ou o começo dele?
 *
 * `echoesTitle` não serve aqui: ele exige que o trecho cubra 60% do título, e
 * "Avaliação Econômica do Estoque" (30 caracteres) cobre metade de "Avaliação
 * Econômica do Estoque: Custos de Pedido e Manutenção" (60). Por um triz o
 * slide escapava — e ele repetia o nome do módulo logo abaixo da divisória que
 * já o exibia.
 *
 * Aqui a pergunta é outra e mais simples: o título ABRE com o nome do módulo?
 * Se abre, não acrescenta nada ao que a divisória já disse. O piso de 12
 * caracteres evita absorver por causa de um prefixo curto e casual.
 */
function repeteONomeDoModulo(titulo: string, tituloDoModulo: string): boolean {
  const a = normKey(titulo);
  const b = normKey(tituloDoModulo ?? "");
  if (!a || !b || a.length < 12) return false;
  return b === a || b.startsWith(a);
}

/**
 * Move os objetivos do slide de visão geral para a divisória do módulo e
 * descarta o slide. Devolve quantos módulos foram fundidos.
 */
export function objetivosParaDivisoria(
  out: DeckModule[],
  language: string,
): number {
  const rotulo = moduleOverviewLabel(language);
  if (!rotulo) return 0;
  let fundidos = 0;
  for (const m of out) {
    // Só o PRIMEIRO slide do módulo: uma visão geral no meio do módulo é outra
    // coisa, e mexer nela mudaria a ordem do que o professor vai apresentar.
    const i = m.slides[0]?.kind === "section" ? 1 : 0;
    const alvo = m.slides[i];
    if (!ehVisaoGeral(alvo, rotulo, m.title)) continue;
    m.objectives = (alvo.bullets ?? []).slice(0, 4);
    m.slides.splice(i, 1);
    fundidos++;
  }
  return fundidos;
}

// ═══════════════════════════════════════════════════════════════════════════
// OS OBJETIVOS DO MÓDULO NÃO PODEM DEPENDER DO HUMOR DO PLANEJADOR
//
// objetivosParaDivisoria só tem o que fundir quando o planejador escreveu um
// slide de visão geral como primeiro do módulo. Ele escreve quando quer: dois
// decks do MESMO curso, gerados com um dia de diferença, trouxeram 4 de 5 e 2 de
// 5 divisórias com objetivos. O aluno abre o módulo 3 e não sabe o que vai
// aprender ali, por acaso.
//
// Só que os objetivos não precisavam vir do planejador. O markdown do módulo
// traz "> **Objetivo da lição:**" para TODA lição — renderModuleMarkdown emite
// isso deterministicamente. A divisória passa a se servir da fonte quando o
// planejador não deu nada.
// ═══════════════════════════════════════════════════════════════════════════

/** "> **Objetivo da lição:** ..." — uma por lição, sempre. */
const OBJETIVO_DA_LICAO = /^>\s*\*\*Objetivo da li[çc]ão:\*\*\s*(.+)$/gim;

/** Os objetivos das lições deste módulo, na ordem em que aparecem. */
export function objetivosDoConteudo(markdown: string, max = 4): string[] {
  const achados: string[] = [];
  for (const m of String(markdown ?? "").matchAll(OBJETIVO_DA_LICAO)) {
    const bruto = m[1].replace(/\*\*/g, "").trim();
    if (bruto.length < 12) continue;
    // A divisória tem espaço para uma linha por objetivo, não para um parágrafo.
    const curto = bruto.length > 110
      ? trimToWholeThought(bruto.slice(0, 110))
      : bruto;
    if (curto.length >= 12) achados.push(curto);
    if (achados.length >= max) break;
  }
  return achados;
}

/**
 * Preenche os objetivos da divisória a partir do conteúdo do módulo, para os
 * módulos que ficaram sem. Nunca sobrescreve o que a visão geral já deu — ela
 * foi escrita para ser lida ali, e é melhor que o objetivo da lição.
 */
export function objetivosDeReserva(
  out: DeckModule[],
  modules: Array<{ content?: string }>,
  max = 4,
): number {
  let preenchidos = 0;
  out.forEach((m, i) => {
    if (m.objectives?.length) return;
    const objetivos = objetivosDoConteudo(modules[i]?.content ?? "", max);
    if (!objetivos.length) return;
    m.objectives = objetivos;
    preenchidos++;
  });
  return preenchidos;
}

// ═══════════════════════════════════════════════════════════════════════════
// DUAS GRADES SEGUIDAS SÃO A MESMA PÁGINA DUAS VEZES
//
// Dez das 57 páginas do deck de estoque eram tabela, e três vinham em sequência
// (53, 54, 55). Uma grade não muda de aparência conforme o assunto: o olho lê
// "planilha" e desliga.
//
// A conversão não é cosmética — é de significado. "Etapas do Plano Mestre"
// (Etapa | Ferramentas | Ações) e "Fluxograma de Análise Crítica" (Situação |
// Análise | Ação) são SEQUÊNCIAS que estavam vestidas de planilha. Como passos,
// dizem melhor o que são e quebram a repetição no mesmo gesto.
//
// O que NÃO se converte, e é a maior parte delas: o modelo preenchível
// "Campo | Orientação | Seu caso". Ali a grade é o ponto — o aluno escreve
// dentro dela. Uma célula com linha de preencher (____) marca a tabela como
// formulário, e formulário fica formulário.
// ═══════════════════════════════════════════════════════════════════════════

const LINHA_DE_PREENCHER = /_{4,}/;

/** A tabela é um formulário para o aluno preencher? Então continua tabela. */
function ehFormulario(s: SlideSpec): boolean {
  for (const r of s.rows ?? []) {
    if (r.cells.some((c) => LINHA_DE_PREENCHER.test(String(c ?? "")))) return true;
  }
  return false;
}

/**
 * Converte uma tabela em sequência de passos, quando ela é uma sequência
 * disfarçada: 3 a 5 linhas, todas com rótulo, células curtas e nenhuma linha
 * de preencher. Devolve null quando a tabela deve continuar tabela.
 */
export function tabelaViraPassos(s: SlideSpec): SlideSpec | null {
  if (s.kind !== "table" || ehFormulario(s)) return null;
  const rows = s.rows ?? [];
  if (rows.length < 3 || rows.length > 5) return null;
  if (rows.some((r) => !String(r.label ?? "").trim())) return null;
  const passos: DeckStep[] = rows.map((r) => ({
    heading: r.label,
    body: r.cells.map((c) => String(c ?? "").trim()).filter(Boolean).join(" · "),
  }));
  // Corpo longo demais vira parede de texto na barra do passo; ali a grade
  // ainda serve melhor. Quanto é "demais" vem da barra, não de uma constante:
  // os 130 que estavam aqui foram calibrados quando a célula era de 80
  // caracteres, e ficaram defasados no dia em que o teto da célula passou a ser
  // medido — a conversão parou de acontecer e o deck perdeu variedade. Ver
  // tetoDoCorpoDoPasso, em table-geometry.ts.
  const teto = tetoDoCorpoDoPasso(passos.length);
  if (passos.some((p) => !p.body || p.body.length > teto)) return null;
  return {
    ...s,
    kind: "steps",
    steps: passos,
    columns: undefined,
    rows: undefined,
    rowHeader: undefined,
  };
}

/**
 * Quebra sequências do mesmo layout dentro do módulo. Hoje trata o caso que
 * medimos — tabela atrás de tabela —, convertendo a SEGUNDA quando os dados
 * dela suportam outra forma. Uma tabela que não pode virar outra coisa fica
 * como está: variedade nunca vale uma página pior.
 */
export function quebrarSequenciaDeLayout(out: DeckModule[]): number {
  let convertidos = 0;
  for (const m of out) {
    for (let i = 1; i < m.slides.length; i++) {
      if (m.slides[i].kind !== "table" || m.slides[i - 1].kind !== "table") continue;
      const alternativa = tabelaViraPassos(m.slides[i]);
      if (!alternativa) continue;
      m.slides[i] = alternativa;
      convertidos++;
    }
  }
  return convertidos;
}
