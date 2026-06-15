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
} as const;

const TRAILING_JUNK_RE = /[\s,;:\-–—]+$/;
const ELLIPSIS_RE = /(\.{2,}|…)+\s*$/;
const DANGLING_PREP_RE =
  /\s+(para|de|da|do|das|dos|com|e|ou|que|em|no|na|nos|nas|ao|à|aos|às|por|sobre|entre|sem|sob|a|as|os|um|uma|uns|umas)\s*$/i;

/** Clean a short text fragment: strip ellipsis, dangling words, trailing junk. */
function cleanFragment(raw: string): string {
  let t = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
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
      body: capText(String(c?.body ?? ""), 16, LIMITS.MAX_CARD_BODY_CHARS),
    }))
    .filter((c) => c.heading.length > 0)
    .slice(0, LIMITS.MAX_CARDS);
}

function normSteps(steps: DeckStep[] | undefined): DeckStep[] {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((s) => ({
      heading: capText(String(s?.heading ?? ""), 8, 48),
      body: s?.body ? capText(String(s.body), 16, 90) : undefined,
    }))
    .filter((s) => s.heading.length > 0)
    .slice(0, LIMITS.MAX_STEPS);
}

const CODE_PLACEHOLDER_LINE_RE = /^\s*(?:#|--|\/\/)?\s*(?:\.{2,}|…)\s*$/;

function normCode(code: SlideSpec["code"]): SlideSpec["code"] | undefined {
  if (!code || !code.text) return undefined;
  let lines = String(code.text).replace(/\r\n/g, "\n").split("\n");
  // Safety net: if the model returned multi-statement code on a single line,
  // restore a line break after each ";" so it doesn't render as a wall.
  if (lines.filter((l) => l.trim()).length <= 1 &&
      (code.text.match(/;/g)?.length ?? 0) >= 2) {
    lines = code.text.replace(/;\s*/g, ";\n").split("\n");
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
  return { language: (code.language || "").toLowerCase(), text };
}

/** A slide is renderable if its kind has the minimum content it needs. */
function hasMinimumContent(s: SlideSpec): boolean {
  switch (s.kind) {
    case "bullets":
    case "closing":
      return (s.bullets?.length ?? 0) > 0;
    case "cards":
      return (s.cards?.length ?? 0) > 0;
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

  const base: SlideSpec = {
    ...slide,
    title,
    eyebrow,
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
    const salvage = normItems(slide.bullets, LIMITS.MAX_BULLETS);
    if (salvage.length > 0) {
      return [{ kind: "bullets", title: base.title, eyebrow, bullets: salvage }];
    }
    return [];
  }
  return [base];
}

/**
 * Anti-monotony: never render 3 identical layouts in a row. If we detect a run,
 * nudge the 3rd toward "cards" when its content allows it. Purely visual.
 */
function breakLayoutRuns(slides: SlideSpec[]): SlideSpec[] {
  let run = 0;
  let prev = "";
  return slides.map((s) => {
    if (s.kind === prev) run++;
    else run = 0;
    prev = s.kind;
    if (
      run >= 2 &&
      s.kind === "bullets" &&
      (s.bullets?.length ?? 0) >= 3 &&
      (s.bullets?.length ?? 0) <= 4 &&
      s.bullets!.every((b) => b.split(/\s+/).length <= 9)
    ) {
      run = 0;
      prev = "cards";
      return {
        kind: "cards",
        title: s.title,
        eyebrow: s.eyebrow,
        cards: s.bullets!.map((b) => ({ heading: b, body: "" })),
        imageQuery: s.imageQuery,
      } as SlideSpec;
    }
    return s;
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
