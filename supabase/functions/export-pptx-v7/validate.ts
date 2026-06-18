// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — PPTX v7 "Adaptive Engine"  ·  validate.ts
//
// UNIVERSAL structural normalization only. There is intentionally NO topic
// knowledge here (no "SQL in Python", no per-language rules). Every check
// applies equally to any subject. The contract: this module NEVER throws and
// NEVER vetoes — it always returns a renderable deck by degrading gracefully
// (shrink, split, trim, or drop the offending element, not the whole export).
// ═══════════════════════════════════════════════════════════════════════════

import type {
  DeckCard,
  DeckModule,
  DeckStep,
  DeckTableRow,
  PlannedDeck,
  SlideSpec,
} from "./deck-plan.ts";

export const LIMITS = {
  MAX_BULLETS: 5,
  MAX_CARDS: 4,
  MAX_STEPS: 5,
  MAX_COLUMN_ITEMS: 4,
  MAX_ITEM_WORDS: 22,
  MAX_ITEM_CHARS: 160,
  MAX_TITLE_CHARS: 90,
  MAX_CODE_LINES: 16,
  MAX_CARD_BODY_CHARS: 90,
  MAX_TABLE_COLS: 5,
  MAX_TABLE_ROWS: 6,
  MAX_TABLE_CELL_CHARS: 80,
  MAX_CHART_POINTS: 6,
} as const;

const TRAILING_JUNK_RE = /[\s,;:\-–—]+$/;
const ELLIPSIS_RE = /(\.{2,}|…)+\s*$/;
const DANGLING_PREP_RE =
  /\s+(para|de|da|do|das|dos|com|e|ou|que|em|no|na|nos|nas|ao|à|aos|às|por|sobre|entre|sem|sob|a|as|os|um|uma|uns|umas)\s*$/i;

/** Clean a short text fragment: strip ellipsis, dangling words, trailing junk. */
function cleanFragment(raw: string): string {
  let t = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // Strip Markdown emphasis the planner sometimes leaks into prose (it would
  // otherwise render as literal **asterisks**/`backticks` on the slide).
  t = t
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*/g, "")
    .trim();
  t = t.replace(ELLIPSIS_RE, "");
  // Drop up to two dangling connector words left by truncation.
  for (let i = 0; i < 2; i++) {
    const next = t.replace(DANGLING_PREP_RE, "");
    if (next === t) break;
    t = next.trim();
  }
  t = t.replace(TRAILING_JUNK_RE, "").trim();
  return t;
}

/** Hard cap by words then chars, never cutting mid-word. */
function capText(raw: string, maxWords: number, maxChars: number): string {
  let t = cleanFragment(raw);
  const words = t.split(/\s+/);
  if (words.length > maxWords) t = words.slice(0, maxWords).join(" ");
  if (t.length > maxChars) {
    const sliced = t.slice(0, maxChars);
    const lastSpace = sliced.lastIndexOf(" ");
    t = (lastSpace > 20 ? sliced.slice(0, lastSpace) : sliced).trim();
  }
  return cleanFragment(t);
}

function normItems(items: string[] | undefined, max: number): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((s) => capText(String(s), LIMITS.MAX_ITEM_WORDS, LIMITS.MAX_ITEM_CHARS))
    .filter((s) => s.length > 0)
    .slice(0, max);
}

function normCards(cards: DeckCard[] | undefined): DeckCard[] {
  if (!Array.isArray(cards)) return [];
  return cards
    .map((c) => ({
      heading: capText(String(c?.heading ?? ""), 8, 48),
      body: capText(String(c?.body ?? ""), 12, LIMITS.MAX_CARD_BODY_CHARS),
    }))
    .filter((c) => c.heading.length > 0)
    .slice(0, LIMITS.MAX_CARDS);
}

/** The steps renderer prepends its own index, so drop any leading "1." / "2)" /
 *  "3 -" the planner already baked into the heading (avoids "1. 1. ..."). */
function stripLeadingOrdinal(s: string): string {
  return s.replace(/^\s*\d{1,2}\s*[.)\-–]\s+/, "");
}

function normSteps(steps: DeckStep[] | undefined): DeckStep[] {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((s) => ({
      heading: capText(stripLeadingOrdinal(String(s?.heading ?? "")), 8, 48),
      body: s?.body ? capText(String(s.body), 12, 90) : undefined,
    }))
    .filter((s) => s.heading.length > 0)
    .slice(0, LIMITS.MAX_STEPS);
}

/**
 * Normalize a comparison table into a rectangular grid. Columns and per-row
 * cells are trimmed/padded to the same width so the renderer never sees a ragged
 * table. Returns null when there isn't enough to draw (so the slide falls back
 * to bullets, like matrix does) — never throws.
 */
function normTable(slide: SlideSpec):
  | { columns: string[]; rows: DeckTableRow[] }
  | null {
  const columns = (Array.isArray(slide.columns) ? slide.columns : [])
    .map((c) => capText(String(c ?? ""), 6, 28))
    .filter((c) => c.length > 0)
    .slice(0, LIMITS.MAX_TABLE_COLS);
  if (columns.length < 2) return null;
  const n = columns.length;
  const rows = (Array.isArray(slide.rows) ? slide.rows : [])
    .map((r) => {
      const cells = (Array.isArray(r?.cells) ? r.cells : [])
        .map((c) => capText(String(c ?? ""), 12, LIMITS.MAX_TABLE_CELL_CHARS));
      // Force each row to exactly n cells (pad short, drop overflow).
      while (cells.length < n) cells.push("");
      return {
        label: capText(String(r?.label ?? ""), 8, 32),
        cells: cells.slice(0, n),
      };
    })
    .filter((r) => r.label.length > 0 || r.cells.some((c) => c.length > 0))
    .slice(0, LIMITS.MAX_TABLE_ROWS);
  if (rows.length < 1) return null;
  return { columns, rows };
}

/**
 * Normalize a chart: coerce values to finite non-negative numbers, cap the
 * number of points, drop empty labels. Returns null when fewer than 2 valid
 * points remain (the slide then salvages to bullets — never throws).
 */
function normChart(slide: SlideSpec):
  | { type: "donut" | "bar"; points: { label: string; value: number }[]; unit?: string }
  | null {
  const c = slide.chart;
  if (!c) return null;
  const type = c.type === "bar" ? "bar" : "donut";
  const points = (Array.isArray(c.points) ? c.points : [])
    .map((p) => ({
      label: capText(String(p?.label ?? ""), 6, 26),
      value: Number(p?.value),
    }))
    .filter((p) => p.label.length > 0 && Number.isFinite(p.value) && p.value >= 0)
    .slice(0, LIMITS.MAX_CHART_POINTS);
  if (points.length < 2) return null;
  const unit = c.unit ? capText(String(c.unit), 2, 6) : undefined;
  return { type, points, unit };
}

const CODE_PLACEHOLDER_LINE_RE = /^\s*(?:#|--|\/\/)?\s*(?:\.{2,}|…)\s*$/;

function normCode(code: SlideSpec["code"]): SlideSpec["code"] | undefined {
  // Tolerate a bare string: some planner outputs return code as "..." instead
  // of { text, language }. Coerce so the slide isn't needlessly dropped.
  const c: { language?: string; text?: string } | undefined =
    typeof code === "string" ? { text: code } : code;
  if (!c || !c.text) return undefined;
  let lines = String(c.text).replace(/\r\n/g, "\n").split("\n");
  // Safety net: if the model returned multi-statement code on a single line,
  // restore a line break after each ";" so it doesn't render as a wall.
  if (lines.filter((l) => l.trim()).length <= 1 &&
      (c.text.match(/;/g)?.length ?? 0) >= 2) {
    lines = c.text.replace(/;\s*/g, ";\n").split("\n");
  }
  // Strip placeholder/ellipsis lines ("# ...", "-- ...", "...") left by input
  // condensation or the model — they make the example look unfinished.
  lines = lines.filter((l) => !CODE_PLACEHOLDER_LINE_RE.test(l));
  // Drop trailing blank lines, then hard-cap line count (no "..." injection).
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length > LIMITS.MAX_CODE_LINES) {
    lines = lines.slice(0, LIMITS.MAX_CODE_LINES);
  }
  const text = lines.join("\n");
  if (!text.trim()) return undefined;
  return { language: (c.language || "").toLowerCase(), text };
}

/** A slide is renderable if its kind has the minimum content it needs. */
function hasMinimumContent(s: SlideSpec): boolean {
  switch (s.kind) {
    case "bullets":
    case "tiles":
    case "closing":
      return (s.bullets?.length ?? 0) > 0;
    case "cards":
    case "matrix":
      return (s.cards?.length ?? 0) > 0;
    case "table":
      return (s.columns?.length ?? 0) >= 2 && (s.rows?.length ?? 0) > 0;
    case "steps":
      return (s.steps?.length ?? 0) > 0;
    case "compare":
      return (
        (s.left?.items?.length ?? 0) > 0 && (s.right?.items?.length ?? 0) > 0
      );
    case "quote":
      return !!s.quote && s.quote.length > 0;
    case "stat":
      return !!s.stat?.value;
    case "chart":
      return (s.chart?.points?.length ?? 0) >= 2;
    case "code":
      return !!s.code?.text;
    case "section":
    case "cover":
    case "toc":
      return !!s.title;
    default:
      return false;
  }
}

/**
 * Normalize one slide. Returns an array because overflow (too many bullets)
 * degrades into a continuation slide rather than truncating content.
 */
function normalizeSlide(slide: SlideSpec): SlideSpec[] {
  const eyebrow = slide.eyebrow ? capText(slide.eyebrow, 10, 60) : undefined;
  let title = capText(slide.title ?? "", 14, LIMITS.MAX_TITLE_CHARS);

  const table = slide.kind === "table" ? normTable(slide) : null;
  const chart = slide.kind === "chart" ? normChart(slide) : null;

  const base: SlideSpec = {
    ...slide,
    title,
    eyebrow,
    columns: table?.columns,
    rows: table?.rows,
    chart: chart ?? undefined,
    subtitle: slide.subtitle
      ? capText(slide.subtitle, 22, 160)
      : undefined,
    cards: normCards(slide.cards),
    steps: normSteps(slide.steps),
    code: normCode(slide.code),
    quote: slide.quote ? cleanFragment(slide.quote) : undefined,
    attribution: slide.attribution
      ? cleanFragment(slide.attribution)
      : undefined,
    left: slide.left
      ? {
          heading: capText(slide.left.heading ?? "", 8, 40),
          items: normItems(slide.left.items, LIMITS.MAX_COLUMN_ITEMS),
        }
      : undefined,
    right: slide.right
      ? {
          heading: capText(slide.right.heading ?? "", 8, 40),
          items: normItems(slide.right.items, LIMITS.MAX_COLUMN_ITEMS),
        }
      : undefined,
    stat: slide.stat
      ? {
          value: capText(String(slide.stat.value ?? ""), 4, 16),
          label: capText(String(slide.stat.label ?? ""), 14, 80),
        }
      : undefined,
  };

  if (!base.title) base.title = base.eyebrow || "Conceito";

  // Bullets overflow → split into continuation slides.
  if (base.kind === "bullets" || base.kind === "closing") {
    const all = normItems(slide.bullets, 999);
    if (all.length === 0) {
      base.bullets = [];
      return hasMinimumContent(base) ? [base] : [];
    }
    // Up to 6 fit on one slide (font auto-shrinks); only split beyond that, and
    // split into BALANCED chunks so we never get a "(cont.)" with a single item.
    if (all.length <= 6) {
      base.bullets = all;
      return [base];
    }
    const slidesNeeded = Math.ceil(all.length / LIMITS.MAX_BULLETS);
    const per = Math.ceil(all.length / slidesNeeded);
    const out: SlideSpec[] = [];
    for (let i = 0; i < all.length; i += per) {
      out.push({
        ...base,
        title: i === 0 ? base.title : `${base.title} (cont.)`,
        bullets: all.slice(i, i + per),
      });
    }
    return out;
  }

  // For other kinds: if minimum content missing, try to salvage as bullets,
  // otherwise drop the slide (degrade, never veto).
  if (!hasMinimumContent(base)) {
    // A degenerate chart still has its points as data → salvage to bullets
    // ("label: value") instead of dropping the slide.
    const fromChart = (slide.chart?.points ?? [])
      .map((p) => `${p?.label ?? ""}: ${p?.value ?? ""}${slide.chart?.unit ?? ""}`.trim());
    const source = (slide.bullets?.length ? slide.bullets : fromChart);
    const salvage = normItems(source, LIMITS.MAX_BULLETS);
    if (salvage.length > 0) {
      return [{ kind: "bullets", title: base.title, eyebrow, bullets: salvage }];
    }
    return [];
  }
  return [base];
}

/**
 * A bullets slide qualifies for the "tiles" treatment when it is a short,
 * scannable list: 3–6 items, each a brief phrase. Such lists read far better as
 * an icon/badge grid than as yet another vertical bullet list.
 */
function tilesEligible(s: SlideSpec): boolean {
  if (s.kind !== "bullets") return false;
  const b = s.bullets ?? [];
  return b.length >= 3 && b.length <= 6 &&
    b.every((x) => x.trim().length > 0 && x.trim().split(/\s+/).length <= 10);
}

/** 2–4 short points → eligible for the roomy "bento" surface-card grid. */
function bentoEligible(s: SlideSpec): boolean {
  if (s.kind !== "bullets") return false;
  const b = s.bullets ?? [];
  return b.length >= 2 && b.length <= 4 &&
    b.every((x) => x.trim().length > 0 && x.trim().split(/\s+/).length <= 12);
}

/**
 * Anti-monotony: never render two same-looking content slides back to back. The
 * planner overwhelmingly emits "bullets", producing tiring runs of identical
 * vertical lists. Whenever a plain (image-less) bullets slide would follow
 * another "listy" slide, we recast it — rotating across the eligible variants
 * ("tiles" badge grid, "bento" surface cards) — so a run of N bullet slides
 * renders as bullets / tiles / bento / tiles… Hero bullets slides (which carry a
 * module image and render as a split / image-top) are left untouched. Purely
 * visual; content is identical.
 */
function breakLayoutRuns(slides: SlideSpec[]): SlideSpec[] {
  let prev = "";
  let variant = 0;
  const listy = (k: string) => k === "bullets" || k === "tiles" || k === "bento";
  return slides.map((s) => {
    let out = s;
    if (s.kind === "bullets" && !s.imageData && listy(prev)) {
      const options: string[] = [];
      if (tilesEligible(s)) options.push("tiles");
      if (bentoEligible(s)) options.push("bento");
      if (options.length) {
        const kind = options[variant % options.length];
        variant++;
        out = {
          kind,
          title: s.title,
          eyebrow: s.eyebrow,
          bullets: s.bullets,
          imageQuery: s.imageQuery,
        } as SlideSpec;
      }
    }
    prev = out.kind;
    return out;
  });
}

export interface NormalizeStats {
  modulesIn: number;
  slidesIn: number;
  slidesOut: number;
  slidesDropped: number;
  slidesSplit: number;
}

/** Normalize the whole deck. Always returns a renderable deck + stats. */
export function normalizeDeck(deck: PlannedDeck): {
  deck: PlannedDeck;
  stats: NormalizeStats;
} {
  let slidesIn = 0;
  let slidesOut = 0;
  let slidesDropped = 0;
  let slidesSplit = 0;

  const modules: DeckModule[] = deck.modules.map((m) => {
    const cleanTitle = capText(m.title ?? "", 14, LIMITS.MAX_TITLE_CHARS) ||
      "Módulo";
    let normalized: SlideSpec[] = [];
    for (const s of m.slides) {
      slidesIn++;
      const res = normalizeSlide(s);
      if (res.length === 0) slidesDropped++;
      if (res.length > 1) slidesSplit += res.length - 1;
      normalized.push(...res);
    }
    // Guarantee every module ships at least one slide.
    if (normalized.length === 0) {
      normalized.push({
        kind: "section",
        title: cleanTitle,
        eyebrow: cleanTitle,
        imageQuery: cleanTitle,
      });
    }
    normalized = breakLayoutRuns(normalized);
    slidesOut += normalized.length;
    return { title: cleanTitle, slides: normalized };
  });

  return {
    deck: { ...deck, modules },
    stats: {
      modulesIn: deck.modules.length,
      slidesIn,
      slidesOut,
      slidesDropped,
      slidesSplit,
    },
  };
}

/** Auto-size body font from total content weight (shrink, never truncate). */
export function autoBodyFontSize(itemCount: number, totalChars: number): number {
  if (itemCount >= 5 || totalChars > 360) return 13;
  if (itemCount >= 4 || totalChars > 240) return 14;
  if (itemCount >= 3 || totalChars > 140) return 16;
  return 18;
}
