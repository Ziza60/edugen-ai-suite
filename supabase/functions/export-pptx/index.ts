import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";

/**
 * REGRAS DE OURO — NUNCA VIOLAR:
 *
 * 1. NUNCA usar autoFit: true — encolhe texto para tamanho ilegível
 * 2. NUNCA usar altura fixa (h: 4.375) para caixas de conteúdo
 * 3. SEMPRE usar splitBulletsToFit() antes de renderizar bullets
 * 4. SEMPRE calcular titleH dinamicamente com getTitleHeight()
 * 5. SEMPRE posicionar elementos seguintes com Y = elemento_anterior_Y + elemento_anterior_H + gap
 * 6. NUNCA deixar qualquer elemento com bottom > (SLIDE_H - 0.20)
 *
 * Slide widescreen = 10.0 x 5.625 polegadas — NÃO é 10 x 7.5!
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ═══════════════════════════════════════════════════════
   DESIGN SYSTEM
   ═══════════════════════════════════════════════════════ */

const C = {
  PRIMARY:    "1E2761",
  MEDIUM:     "3A5A9B",
  ACCENT:     "F5A623",
  BG_LIGHT:   "F7F8FA",
  TEXT_BODY:   "2D3748",
  TEXT_SEC:    "718096",
  WHITE:       "FFFFFF",
  LIGHT_BLUE:  "CADCFC",
  TABLE_ALT:   "EEF2FF",
  TABLE_BORDER:"CBD5E1",
};

const FONT = "Calibri";
const SLIDE_W = 10.0;
const SLIDE_H = 5.625;

// ── Safe margins: x + w must NEVER exceed SLIDE_W - MARGIN_R ──
// PowerPoint adds ~0.1in internal padding per text box, so we use generous margins
const MARGIN_L = 0.55;
const MARGIN_R = 0.55;
const SAFE_W = SLIDE_W - MARGIN_L - MARGIN_R; // = 8.90 — max width of any element

const HEADER_H = 0.70;
const CONTENT_START_Y = 0.95;
const BOTTOM_MARGIN = 0.30;
const MAX_CONTENT_H = SLIDE_H - CONTENT_START_Y - BOTTOM_MARGIN; // ~4.325

const FONT_PT = 16;
const LINE_H_IN = (FONT_PT * 1.5) / 72;    // 0.333in per line (accounts for lineSpacingMultiple)
const PARA_GAP_IN = 14 / 72;               // 0.194in between bullets (accounts for paraSpaceAfter)
const CHARS_PER_LINE = 62;                  // ~62 chars per line at 16pt in 8.9in (accounts for bullet marker + PPTX padding)

const TABLE_Y = 0.90;
const HEADER_ROW_H = 0.45;
const ROW_BASE_H = 0.55;  // conservative estimate per row
const CELL_LINE_H_IN = 0.22;
const MAX_TABLE_H = SLIDE_H - TABLE_Y - BOTTOM_MARGIN;

const MIN_BULLETS = 3;
const MAX_BULLETS = 5;
const MAX_CHARS = 900;

// Section layout constants
const SECTION_HEADER_H = 14 / 72 * 1.5;  // header in bold 14pt
const SECTION_GAP = 0.20;                // extra gap between sections

/* ═══════════════════════════════════════════════════════
   TEXT SANITIZATION
   ═══════════════════════════════════════════════════════ */

function sanitize(text: string): string {
  if (!text) return "";
  let t = text;
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<\/?(p|div|span|strong|em|b|i|u|a|li|ul|ol|h[1-6]|blockquote|code|pre|table|tr|td|th|thead|tbody|section|article|header|footer|main|nav|figure|figcaption|details|summary|mark|small|sup|sub|dl|dt|dd)[^>]*>/gi, " ");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/#{1,6}\s*/g, "");
  t = t.replace(/\*\*(.*?)\*\*/g, "$1");
  t = t.replace(/\*(.*?)\*/g, "$1");
  t = t.replace(/`{1,3}([^`]*)`{1,3}/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  t = t.replace(/^>\s*/gm, "");
  t = t.replace(/^---+$/gm, "");
  t = t.replace(/\s*[→⟶➜➔➞►▶︎⇒⇨]\s*/g, ": ");
  t = t.replace(/\s*->\s*/g, ": ");
  t = t.replace(/&amp;/gi, "&");
  t = t.replace(/&lt;/gi, "<");
  t = t.replace(/&gt;/gi, ">");
  t = t.replace(/&nbsp;/gi, " ");
  t = t.replace(/&quot;/gi, '"');
  t = t.replace(/<\/?[a-z][^>]*>/gi, " ");
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

function deduplicateTitle(title: string): string {
  return title.replace(/^(Módulo\s+\d+\s*[:–\-]\s*)\1/i, "$1").trim();
}

/* ═══════════════════════════════════════════════════════
   SAFE TEXT — NEVER autoFit, NEVER overflow visible
   ═══════════════════════════════════════════════════════ */

function addTextSafe(slide: any, text: any, options: Record<string, unknown>) {
  const x = Number(options.x || 0);
  const y = Number(options.y || 0);
  const w = Number(options.w || 0);
  const h = Number(options.h || 0);
  // Clamp width to prevent horizontal overflow
  const maxW = SLIDE_W - x - 0.10;
  const safeW = Math.min(w, maxW);
  // Clamp height to prevent vertical overflow
  const maxH = SLIDE_H - y - 0.10;
  const safeH = Math.min(h, maxH);
  if (safeW <= 0 || safeH <= 0) return; // skip invisible elements

  slide.addText(text, {
    ...options,
    w: safeW,
    h: safeH,
    autoFit: false,
    overflow: "clip",
  });
}

/* ═══════════════════════════════════════════════════════
   DYNAMIC HEIGHT HELPERS (CORREÇÃO #1 & #2)
   ═══════════════════════════════════════════════════════ */

/** Calculate title box height based on text length */
function getTitleHeight(titleText: string, boxWidthIn: number, fontSizePt: number): number {
  const charsPerLine = Math.floor(boxWidthIn * 5.5); // ~5.5 chars/pt/inch at given font
  const lines = Math.max(1, Math.ceil(titleText.length / Math.max(1, charsPerLine)));
  const lineHeightIn = (fontSizePt * 1.25) / 72;
  return Math.max(0.70, lines * lineHeightIn + 0.20); // minimum 0.70in
}

/** Header title font shrinks for very long titles to prevent right-edge clipping */
function getHeaderTitleFontSize(titleText: string): number {
  const len = sanitize(removePartSuffix(deduplicateTitle(titleText || ""))).length;
  if (len > 110) return 16;
  if (len > 90) return 18;
  if (len > 72) return 20;
  return 24;
}

/** Dynamic header height for long titles */
function getHeaderHeight(titleText: string): number {
  const fs = getHeaderTitleFontSize(titleText);
  const titleH = getTitleHeight(titleText, SAFE_W, fs);
  return Math.max(HEADER_H, Math.min(1.15, titleH + 0.18));
}

/** Split oversized bullet text into smaller bullets so one item never explodes a slide */
function splitLongBulletText(text: string, maxCharsPerChunk: number): string[] {
  const clean = sanitize(text);
  if (!clean) return [];
  if (clean.length <= maxCharsPerChunk) return [clean];

  const chunks: string[] = [];
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  let current = "";

  for (const s of sentences) {
    const candidate = current ? `${current} ${s}` : s;
    if (candidate.length <= maxCharsPerChunk) {
      current = candidate;
    } else {
      if (current) chunks.push(current.trim());
      if (s.length <= maxCharsPerChunk) {
        current = s;
      } else {
        const words = s.split(/\s+/);
        let wAcc = "";
        for (const w of words) {
          const wCandidate = wAcc ? `${wAcc} ${w}` : w;
          if (wCandidate.length <= maxCharsPerChunk) {
            wAcc = wCandidate;
          } else {
            if (wAcc) chunks.push(wAcc.trim());
            wAcc = w;
          }
        }
        current = wAcc;
      }
    }
  }
  if (current) chunks.push(current.trim());

  return chunks.length ? chunks : [clean];
}

/** Estimate height of a single bullet item */
function estimateBulletHeight(item: string, fontSize = FONT_PT, charsPerLine = CHARS_PER_LINE): number {
  const text = sanitize(item || "");
  // Add 4 chars for bullet marker "●  " taking up space
  const effectiveCharsPerLine = Math.max(10, charsPerLine - 4);
  const lines = Math.max(1, Math.ceil(text.length / effectiveCharsPerLine));
  const lineHeight = (fontSize * 1.5) / 72; // match LINE_H_IN calculation
  return (lines * lineHeight) + (14 / 72); // match PARA_GAP_IN
}

/** Estimate total height of a list of bullets — includes 20% safety factor */
function estimateBulletsHeight(bullets: string[], fontSize = FONT_PT, charsPerLine = CHARS_PER_LINE): number {
  const raw = bullets.reduce((sum, b) => sum + estimateBulletHeight(b, fontSize, charsPerLine), 0);
  return raw * 1.15; // 15% safety margin for PowerPoint rendering differences
}

/** Split bullets into groups that fit within maxH */
function splitBulletsToFit(bullets: string[], maxH: number, fontSize = FONT_PT, charsPerLine = CHARS_PER_LINE): string[][] {
  const lineHeight = (fontSize * 1.5) / 72;
  const maxLinesPerChunk = Math.max(2, Math.floor((maxH * 0.55) / lineHeight));
  const maxCharsPerChunk = Math.max(48, maxLinesPerChunk * Math.max(20, charsPerLine - 4));

  const expandedBullets = bullets.flatMap((b) => {
    const itemH = estimateBulletHeight(b, fontSize, charsPerLine);
    return itemH > maxH ? splitLongBulletText(b, maxCharsPerChunk) : [b];
  });

  const groups: string[][] = [];
  let current: string[] = [];
  let currentH = 0;

  for (const b of expandedBullets) {
    const itemH = estimateBulletHeight(b, fontSize, charsPerLine);

    if (currentH + itemH > maxH && current.length > 0) {
      groups.push(current);
      current = [b];
      currentH = itemH;
    } else {
      current.push(b);
      currentH += itemH;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups.length > 0 ? groups : [bullets];
}

/* ═══════════════════════════════════════════════════════
   DETERMINISTIC WRAP/PAGINATION (ANTI-OVERFLOW)
   ═══════════════════════════════════════════════════════ */

const SAFE_CHARS_PER_LINE = 52; // intentionally conservative
const SAFE_LINE_MULTIPLIER = 1.55; // higher than visual setting to avoid underestimation
const SAFE_BULLET_GAP = 12 / 72;

interface BulletBlock {
  kind: "header" | "bullet";
  text: string;
  height: number;
}

function wrapTextConservative(text: string, maxChars = SAFE_CHARS_PER_LINE): string[] {
  const clean = sanitize(text);
  if (!clean) return [""];

  const words = clean.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [clean];
}

function estimateBulletHeightStrict(text: string, fontSize = FONT_PT): number {
  const lines = wrapTextConservative(text, SAFE_CHARS_PER_LINE).length;
  const lineH = (fontSize * SAFE_LINE_MULTIPLIER) / 72;
  return (lines * lineH) + SAFE_BULLET_GAP;
}

function buildBulletBlocks(items: string[]): BulletBlock[] {
  const blocks: BulletBlock[] = [];

  for (const raw of items) {
    const clean = sanitize(raw);
    if (!clean) continue;

    const isSubHeader = /^.+:\s*$/.test(clean) && clean.length <= 70;
    if (isSubHeader) {
      blocks.push({
        kind: "header",
        text: clean,
        height: SECTION_HEADER_H + 0.12,
      });
      continue;
    }

    const chunks = splitLongBulletText(clean, 180);
    for (const chunk of chunks) {
      blocks.push({
        kind: "bullet",
        text: chunk,
        height: estimateBulletHeightStrict(chunk, FONT_PT),
      });
    }
  }

  return blocks;
}

function paginateBulletBlocks(blocks: BulletBlock[], maxH: number): BulletBlock[][] {
  const pages: BulletBlock[][] = [];
  let current: BulletBlock[] = [];
  let currentH = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const wouldOverflow = currentH + block.height > maxH;

    if (wouldOverflow && current.length > 0) {
      pages.push(current);
      current = [];
      currentH = 0;
    }

    if (block.kind === "header") {
      if (currentH + block.height > maxH && current.length > 0) {
        pages.push(current);
        current = [];
        currentH = 0;
      }
      current.push(block);
      currentH += block.height;
      continue;
    }

    if (block.height > maxH) {
      const forcedChunks = splitLongBulletText(block.text, 120);
      for (const forced of forcedChunks) {
        const forcedH = estimateBulletHeightStrict(forced, FONT_PT);
        if (currentH + forcedH > maxH && current.length > 0) {
          pages.push(current);
          current = [];
          currentH = 0;
        }
        current.push({ kind: "bullet", text: forced, height: forcedH });
        currentH += forcedH;
      }
      continue;
    }

    current.push(block);
    currentH += block.height;
  }

  if (current.length > 0) pages.push(current);
  return pages.length ? pages : [[]];
}

/* ═══════════════════════════════════════════════════════
   BULLET TEXT ARRAY BUILDER
   Each bullet is a separate text object with breakLine
   ═══════════════════════════════════════════════════════ */

function buildBulletTextArray(
  bullets: string[],
  opts: {
    markerChar?: string;
    markerColor?: string;
    textColor?: string;
    fontSize?: number;
    markerBold?: boolean;
  } = {}
): any[] {
  const {
    markerChar = "●",
    markerColor = C.MEDIUM,
    textColor = C.TEXT_BODY,
    fontSize = 16,
    markerBold = true,
  } = opts;

  const result: any[] = [];
  bullets.forEach((bullet, idx) => {
    const isLast = idx === bullets.length - 1;
    result.push(
      {
        text: `${markerChar}  `,
        options: {
          color: markerColor,
          bold: markerBold,
          fontSize,
          fontFace: FONT,
          breakLine: false,
        },
      },
      {
        text: bullet.trim() + (isLast ? "" : "\n"),
        options: {
          color: textColor,
          fontSize,
          fontFace: FONT,
          breakLine: !isLast,
        },
      }
    );
  });
  return result;
}

/* ═══════════════════════════════════════════════════════
   CONTENT PARSING
   ═══════════════════════════════════════════════════════ */

interface ParsedBlock {
  heading: string;
  items: string[];
  isTable: boolean;
  headers?: string[];
  rows?: string[][];
  isParallel?: boolean;
}

function parseModuleContent(content: string): ParsedBlock[] {
  const lines = content.split("\n");
  const blocks: ParsedBlock[] = [];
  let curHeading = "";
  let curBullets: string[] = [];
  let inTable = false;
  let tHeaders: string[] = [];
  let tRows: string[][] = [];

  const flushBullets = () => {
    if (curBullets.length > 0) {
      blocks.push({ heading: curHeading, items: [...curBullets], isTable: false });
      curBullets = [];
    }
  };

  const flushTable = () => {
    if (tRows.length > 0) {
      blocks.push({
        heading: curHeading, items: [], isTable: true,
        headers: [...tHeaders], rows: [...tRows],
      });
      tHeaders = []; tRows = [];
    }
    inTable = false;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable) {
        flushBullets();
        inTable = true;
        tHeaders = trimmed.split("|").filter(Boolean).map((c) => sanitize(c.trim()));
      } else if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        // separator
      } else {
        tRows.push(trimmed.split("|").filter(Boolean).map((c) => sanitize(c.trim())));
      }
      continue;
    }
    if (inTable) flushTable();

    if (/^#{1,6}\s/.test(trimmed)) {
      flushBullets();
      curHeading = sanitize(trimmed.replace(/^#{1,6}\s*/, ""));
      continue;
    }

    if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      const raw = trimmed.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "");
      const clean = sanitize(raw);
      if (clean.length > 3) curBullets.push(clean);
      continue;
    }

    const clean = sanitize(trimmed);
    if (clean.length > 8) curBullets.push(clean);
  }

  if (inTable) flushTable();
  flushBullets();
  return blocks;
}

/* ═══════════════════════════════════════════════════════
   SLIDE MODEL
   ═══════════════════════════════════════════════════════ */

type LayoutType = "CAPA" | "ABERTURA_MODULO" | "BULLETS" | "CARDS_GRID" | "TABELA" | "RESUMO" | "ENCERRAMENTO";

interface SlideData {
  layout: LayoutType;
  title: string;
  subtitle?: string;
  items?: string[];
  tableHeaders?: string[];
  tableRows?: string[][];
  moduleIndex?: number;
  moduleCount?: number;
  description?: string;
  courseTitle?: string;
}

/* ═══════════════════════════════════════════════════════
   HELPERS FOR MERGE/SPLIT
   ═══════════════════════════════════════════════════════ */

function sameParentTopic(title1: string, title2: string): boolean {
  const clean = (t: string) => t.replace(/\s*\(Parte \d+\)\s*$/i, "").trim();
  return clean(title1) === clean(title2);
}

function removePartSuffix(title: string): string {
  return title.replace(/\s*\(Parte \d+\)\s*$/i, "").trim();
}

function detectParallel(items: string[]): boolean {
  if (items.length < 4 || items.length > 6) return false;
  const withColon = items.filter((it) => {
    const ci = it.indexOf(":");
    return ci > 2 && ci < 50;
  }).length;
  return withColon >= Math.ceil(items.length * 0.6);
}

function isResumoHeading(heading: string): boolean {
  return /resumo|conclus|encerramento|pontos[- ]chave|key takeaway|takeaway|recapitula/i.test(heading);
}

function isObjectivesHeading(heading: string): boolean {
  return /objetivo|objetivos?\s+d[oe]|learning objectives|o que voc/i.test(heading);
}

/* ═══════════════════════════════════════════════════════
   PARAGRAPH → BULLETS CONVERSION
   ═══════════════════════════════════════════════════════ */

interface RawSlide {
  title: string;
  bullets: string[];
  content?: string;
  isTable?: boolean;
  headers?: string[];
  rows?: string[][];
  mergeWithNext?: boolean;
  prependBullets?: string[];
}

function processSlideContent(slide: RawSlide): RawSlide {
  const hasBullets = slide.bullets && slide.bullets.length >= 2;
  const hasOnlyParagraph = !hasBullets && slide.content && slide.content.length > 0;

  if (hasOnlyParagraph && slide.content) {
    const sentences = slide.content
      .split(/(?<=[.!?])\s+/)
      .map((s) => sanitize(s.trim()))
      .filter((s) => s.length > 20);

    if (sentences.length >= 2) {
      slide.bullets = sentences;
      slide.content = undefined;
    } else {
      slide.mergeWithNext = true;
    }
  }
  return slide;
}

/* ═══════════════════════════════════════════════════════
   SPLIT/MERGE ALGORITHM
   ═══════════════════════════════════════════════════════ */

function splitOrMergeSlides(rawSlides: RawSlide[]): RawSlide[] {
  const result: RawSlide[] = [];

  for (let i = 0; i < rawSlides.length; i++) {
    let slide = rawSlides[i];

    if (slide.prependBullets) {
      slide.bullets = [...slide.prependBullets, ...slide.bullets];
      delete slide.prependBullets;
    }

    const bullets = slide.bullets || [];

    if (bullets.length > 0 && bullets.length < MIN_BULLETS) {
      const prev = result.length > 0 ? result[result.length - 1] : null;
      if (
        prev &&
        !prev.isTable &&
        sameParentTopic(prev.title, slide.title) &&
        (prev.bullets || []).length + bullets.length <= MAX_BULLETS
      ) {
        prev.bullets = [...(prev.bullets || []), ...bullets];
        prev.title = removePartSuffix(prev.title);
        continue;
      }
      if (bullets.length < 2 && i + 1 < rawSlides.length && !rawSlides[i + 1].isTable) {
        rawSlides[i + 1].prependBullets = bullets;
        continue;
      }
    }

    if (slide.mergeWithNext && i + 1 < rawSlides.length && !rawSlides[i + 1].isTable) {
      const content = slide.content || (slide.bullets || []).join(". ");
      if (content) {
        if (!rawSlides[i + 1].prependBullets) rawSlides[i + 1].prependBullets = [];
        rawSlides[i + 1].prependBullets!.push(content);
      }
      continue;
    }

    const finalBullets = slide.bullets || bullets;

    if (finalBullets.length > MAX_BULLETS) {
      const mid = Math.ceil(finalBullets.length / 2);
      result.push({ ...slide, bullets: finalBullets.slice(0, mid), title: slide.title + " (Parte 1)" });
      result.push({ ...slide, bullets: finalBullets.slice(mid), title: slide.title + " (Parte 2)" });
      continue;
    }

    result.push({ ...slide, bullets: finalBullets });
  }

  return result;
}

/* ═══════════════════════════════════════════════════════
   VALIDATION
   ═══════════════════════════════════════════════════════ */

function validateBeforeRender(slides: RawSlide[]): RawSlide[] {
  return slides.filter((slide) => {
    const bullets = slide.bullets || [];
    const content = slide.content || "";
    const hasContent = bullets.length >= 2 || content.length >= 100 || slide.isTable;
    if (!hasContent) {
      console.warn(`⚠️ Slide descartado por conteúdo insuficiente: "${slide.title}"`);
    }
    return hasContent;
  });
}

/* ═══════════════════════════════════════════════════════
   BUILD MODULE SLIDES
   ═══════════════════════════════════════════════════════ */

function buildModuleSlides(mod: any, modIndex: number, totalModules: number): SlideData[] {
  const blocks = parseModuleContent(mod.content || "");
  const rawTitle = sanitize(mod.title || "");
  const moduleLabel = `Módulo ${modIndex + 1}`;

  let moduleTitle: string;
  if (/^módulo\s+\d+/i.test(rawTitle)) {
    moduleTitle = deduplicateTitle(rawTitle);
  } else {
    moduleTitle = `${moduleLabel}: ${rawTitle}`;
  }

  const objItems: string[] = [];
  const resumoItems: string[] = [];
  const contentBlocks: ParsedBlock[] = [];

  for (const block of blocks) {
    if (isObjectivesHeading(block.heading) && !block.isTable) {
      objItems.push(...block.items);
    } else if (isResumoHeading(block.heading) && !block.isTable) {
      resumoItems.push(...block.items);
    } else {
      contentBlocks.push(block);
    }
  }

  const slides: SlideData[] = [];

  slides.push({
    layout: "ABERTURA_MODULO",
    title: moduleTitle,
    subtitle: moduleLabel,
    items: objItems.slice(0, 4).map(sanitize),
    moduleIndex: modIndex,
  });

  const rawSlides: RawSlide[] = [];

  for (const block of contentBlocks) {
    if (block.isTable && block.headers && block.rows && block.rows.length > 0) {
      rawSlides.push({
        title: sanitize(block.heading || moduleTitle),
        bullets: [],
        isTable: true,
        headers: block.headers.map(sanitize),
        rows: block.rows.map((r) => r.map(sanitize)),
      });
      continue;
    }

    const items = block.items.map(sanitize).filter((s) => s.length > 3);
    const heading = sanitize(block.heading || moduleTitle);

    if (items.length === 0) {
      const blockContent = block.items.join(" ").trim();
      if (blockContent.length > 30) {
        rawSlides.push({ title: heading, bullets: [], content: sanitize(blockContent) });
      }
      continue;
    }

    rawSlides.push({ title: heading, bullets: items });
  }

  const processed = rawSlides.map(processSlideContent);
  const balanced = splitOrMergeSlides(processed);
  const validated = validateBeforeRender(balanced);

  for (const raw of validated) {
    if (raw.isTable && raw.headers && raw.rows) {
      slides.push({
        layout: "TABELA",
        title: raw.title,
        tableHeaders: raw.headers,
        tableRows: raw.rows,
      });
      continue;
    }

    const items = raw.bullets || [];
    if (items.length === 0) continue;

    const isParallel = detectParallel(items);
    slides.push({
      layout: isParallel ? "CARDS_GRID" : "BULLETS",
      title: raw.title,
      items: [...items],
    });
  }

  if (resumoItems.length > 0) {
    slides.push({
      layout: "RESUMO",
      title: "Resumo",
      subtitle: moduleTitle,
      items: resumoItems.slice(0, 6).map(sanitize),
    });
  }

  return slides;
}

/* ═══════════════════════════════════════════════════════
   FINAL QUALITY PASS
   ═══════════════════════════════════════════════════════ */

function validateAndFix(slides: SlideData[]): SlideData[] {
  const result: SlideData[] = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];

    if (slide.layout === "CAPA" || slide.layout === "ABERTURA_MODULO" || slide.layout === "TABELA" || slide.layout === "ENCERRAMENTO") {
      result.push(slide);
      continue;
    }

    // CRITICAL: never re-merge small slides blindly after split logic.
    // Previous merge-by-count caused content concatenation and overflow.
    if (slide.layout === "BULLETS" || slide.layout === "RESUMO" || slide.layout === "CARDS_GRID") {
      result.push(slide);
      continue;
    }

    result.push(slide);
  }

  for (const slide of result) {
    if (slide.title) slide.title = sanitize(slide.title);
    if (slide.subtitle) slide.subtitle = sanitize(slide.subtitle);
    if (slide.items) slide.items = slide.items.map(sanitize);
    if (slide.tableHeaders) slide.tableHeaders = slide.tableHeaders.map(sanitize);
    if (slide.tableRows) slide.tableRows = slide.tableRows.map((r) => r.map(sanitize));
  }

  return result;
}

/* ═══════════════════════════════════════════════════════
   PRE-RENDER AUDIT
   ═══════════════════════════════════════════════════════ */

function auditSlides(slides: SlideData[]): string[] {
  const warnings: string[] = [];

  slides.forEach((slide, i) => {
    const totalChars = (slide.items || []).join("").length + (slide.description || "").length;
    if (totalChars > 600 && slide.layout !== "TABELA") {
      warnings.push(`Slide ${i + 1} "${slide.title}": ${totalChars} chars — verificar altura`);
    }

    if (slide.layout === "TABELA" && (slide.tableRows?.length || 0) > 5) {
      warnings.push(`Slide ${i + 1} "${slide.title}": tabela com ${slide.tableRows?.length || 0} linhas — pode precisar de split`);
    }
  });

  if (warnings.length) {
    console.warn("⚠️ PPTX Audit:", warnings);
  }

  return warnings;
}

/* ═══════════════════════════════════════════════════════
   TABLE HEIGHT HELPERS
   ═══════════════════════════════════════════════════════ */

function cleanPartTitle(title: string): string {
  return removePartSuffix(deduplicateTitle(title));
}

function calcRowHeight(row: string[], colWidths: number[]): number {
  let maxLines = 1;
  for (let c = 0; c < row.length; c++) {
    const cellText = String(row[c] || "");
    const colW = colWidths[c] || 3.0;
    const charsPerLine = Math.max(10, Math.floor(colW * 12));
    const lines = Math.max(1, Math.ceil(cellText.length / charsPerLine));
    maxLines = Math.max(maxLines, lines);
  }
  return ROW_BASE_H + (maxLines - 1) * CELL_LINE_H_IN;
}

function calcTableHeight(rows: string[][], colWidths: number[]): number {
  let totalH = HEADER_ROW_H;
  for (const row of rows) {
    totalH += calcRowHeight(row, colWidths);
  }
  return totalH;
}

function splitTableRows(rows: string[][], colWidths: number[], maxTableH: number): string[][][] {
  const chunks: string[][][] = [];
  let current: string[][] = [];
  let currentHeight = HEADER_ROW_H;

  for (const row of rows) {
    const rowH = calcRowHeight(row, colWidths);
    const nextHeight = currentHeight + rowH;

    if (current.length > 0 && nextHeight > maxTableH) {
      chunks.push(current);
      current = [row];
      currentHeight = HEADER_ROW_H + rowH;
    } else {
      current.push(row);
      currentHeight = nextHeight;
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

/* ═══════════════════════════════════════════════════════
   SLIDE RENDERERS
   ═══════════════════════════════════════════════════════ */

// Layout 1 — CAPA (CORREÇÃO #1: título com altura dinâmica)
function renderCapa(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.PRIMARY };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.12, h: SLIDE_H,
    fill: { color: C.ACCENT },
  });

  // Dynamic title height
  const titleX = 0.70;
  const titleW = SLIDE_W - titleX - MARGIN_R; // safe right margin
  const titleH = getTitleHeight(data.title, titleW, 44);
  addTextSafe(slide, data.title, {
    x: titleX, y: 0.8, w: titleW, h: titleH,
    fontSize: 44, fontFace: FONT, color: C.WHITE, bold: true,
    align: "left", valign: "middle",
  });

  // Position description BELOW title dynamically
  const descY = 0.8 + titleH + 0.20;
  if (data.description) {
    const descW = titleW - 0.5;
    const maxDescH = Math.min(1.0, SLIDE_H - descY - 0.8);
    if (maxDescH > 0.3) {
      addTextSafe(slide, sanitize(data.description), {
        x: titleX, y: descY, w: descW, h: maxDescH,
        fontSize: 18, fontFace: FONT, color: C.LIGHT_BLUE, align: "left", valign: "top",
      });
    }
  }

  const d = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const footerParts = [];
  if (data.moduleCount) footerParts.push(`${data.moduleCount} módulos`);
  footerParts.push(d);
  addTextSafe(slide, footerParts.join("  •  "), {
    x: titleX, y: SLIDE_H - 0.60, w: titleW, h: 0.4,
    fontSize: 12, fontFace: FONT, color: C.TEXT_SEC, align: "left",
  });
}

// Layout 2 — ABERTURA DE MÓDULO (CORREÇÃO #3: Y dinâmico para objetivos)
function renderAberturaModulo(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.PRIMARY };

  // Badge módulo: fixed at top
  const badgeY = 0.35;
  const badgeH = 0.38;
  if (data.subtitle) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN_L, y: badgeY, w: 1.6, h: badgeH,
      fill: { color: C.ACCENT },
      rectRadius: 0.08,
    });
    addTextSafe(slide, data.subtitle.toUpperCase(), {
      x: MARGIN_L, y: badgeY, w: 1.6, h: badgeH,
      fontSize: 13, fontFace: FONT, color: C.PRIMARY, bold: true,
      align: "center", valign: "middle",
    });
  }

  // Dynamic title height
  const titleY = 0.90;
  const titleH = getTitleHeight(data.title, SAFE_W, 32);
  addTextSafe(slide, data.title, {
    x: MARGIN_L, y: titleY, w: SAFE_W, h: titleH,
    fontSize: 32, fontFace: FONT, color: C.WHITE, bold: true,
    valign: "top",
  });

  // Objectives positioned BELOW the title dynamically with deterministic item layout
  if (data.items && data.items.length > 0) {
    const labelY = titleY + titleH + 0.15;
    const labelH = 0.35;
    addTextSafe(slide, "Objetivos", {
      x: MARGIN_L, y: labelY, w: 3, h: labelH,
      fontSize: 14, fontFace: FONT, color: C.ACCENT, bold: true,
    });

    const objectivesY = labelY + labelH + 0.06;
    const maxY = SLIDE_H - BOTTOM_MARGIN;
    const objectiveBlocks = (data.items || [])
      .map((item) => sanitize(item))
      .filter(Boolean)
      .slice(0, 6)
      .flatMap((item) => splitLongBulletText(item, 150))
      .map((chunk) => ({ text: chunk, h: estimateBulletHeightStrict(chunk, 14) }));

    let currentY = objectivesY;
    for (const obj of objectiveBlocks) {
      if (currentY + obj.h > maxY) break;

      addTextSafe(slide, [
        {
          text: "✓  ",
          options: {
            color: C.ACCENT,
            bold: true,
            fontSize: 14,
            fontFace: FONT,
            breakLine: false,
          },
        },
        {
          text: obj.text,
          options: {
            color: C.WHITE,
            fontSize: 14,
            fontFace: FONT,
            breakLine: true,
          },
        },
      ], {
        x: MARGIN_L,
        y: currentY,
        w: SAFE_W,
        h: obj.h,
        valign: "top",
        paraSpaceAfter: 6,
        lineSpacingMultiple: 1.2,
      });

      currentY += obj.h;
    }
  }
}

// Layout 3 — CONTEÚDO COM BULLETS (PAGINAÇÃO DETERMINÍSTICA POR BLOCO)
function renderBullets(pptx: any, data: SlideData) {
  const allBullets = (data.items || []).map((b) => sanitize(b)).filter(Boolean);
  if (allBullets.length === 0) return;

  const baseTitle = cleanPartTitle(data.title);
  const baseHeaderH = getHeaderHeight(baseTitle);
  const contentStartY = baseHeaderH + 0.25;
  const maxContentH = SLIDE_H - contentStartY - BOTTOM_MARGIN;

  const blocks = buildBulletBlocks(allBullets);
  const pages = paginateBulletBlocks(blocks, maxContentH);

  pages.forEach((pageBlocks, idx) => {
    const suffix = pages.length > 1 ? ` (Parte ${idx + 1})` : "";
    const titleText = deduplicateTitle(baseTitle + suffix);
    renderSingleBulletSlide(pptx, titleText, pageBlocks);
  });
}

/** Render a single slide with deterministic block layout */
function renderSingleBulletSlide(pptx: any, titleText: string, blocks: BulletBlock[]) {
  const slide = pptx.addSlide();
  slide.background = { color: C.BG_LIGHT };

  const headerH = getHeaderHeight(titleText);
  const headerFont = getHeaderTitleFontSize(titleText);

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: headerH,
    fill: { color: C.PRIMARY },
  });

  addTextSafe(slide, titleText, {
    x: MARGIN_L, y: 0.08, w: SAFE_W, h: headerH - 0.16,
    fontSize: headerFont, fontFace: FONT, color: C.WHITE, bold: true,
    valign: "middle",
  });

  let currentY = headerH + 0.25;
  const maxY = SLIDE_H - BOTTOM_MARGIN;

  for (const block of blocks) {
    if (currentY + block.height > maxY) break;

    if (block.kind === "header") {
      addTextSafe(slide, block.text, {
        x: MARGIN_L,
        y: currentY,
        w: SAFE_W,
        h: block.height,
        fontSize: 14,
        fontFace: FONT,
        color: C.PRIMARY,
        bold: true,
        valign: "top",
      });
      currentY += block.height;
      continue;
    }

    addTextSafe(slide, [
      {
        text: "●  ",
        options: {
          color: C.MEDIUM,
          bold: true,
          fontSize: FONT_PT,
          fontFace: FONT,
          breakLine: false,
        },
      },
      {
        text: block.text,
        options: {
          color: C.TEXT_BODY,
          fontSize: FONT_PT,
          fontFace: FONT,
          breakLine: true,
        },
      },
    ], {
      x: MARGIN_L,
      y: currentY,
      w: SAFE_W,
      h: block.height,
      valign: "top",
      paraSpaceAfter: 8,
      lineSpacingMultiple: 1.25,
    });

    currentY += block.height;
  }
}

// Layout 4 — CARDS EM GRID
function renderCardsGrid(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.BG_LIGHT };

  const titleText = deduplicateTitle(data.title);
  const headerH = getHeaderHeight(titleText);
  const headerFont = getHeaderTitleFontSize(titleText);

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: headerH,
    fill: { color: C.PRIMARY },
  });

  addTextSafe(slide, titleText, {
    x: MARGIN_L, y: 0.08, w: SAFE_W, h: headerH - 0.16,
    fontSize: headerFont, fontFace: FONT, color: C.WHITE, bold: true,
    valign: "middle",
  });

  const items = data.items || [];
  const count = items.length;
  const cols = 2;
  const rows = Math.ceil(count / cols);
  const gridTop = headerH + 0.3;
  const gridH = SLIDE_H - gridTop - BOTTOM_MARGIN;
  const cardW = (SAFE_W - 0.3) / cols;
  const cardH = Math.min((gridH - (rows - 1) * 0.2) / rows, 1.4);
  const gapX = 0.3;
  const gapY = 0.2;

  items.forEach((item, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MARGIN_L + col * (cardW + gapX);
    const y = gridTop + row * (cardH + gapY);

    // Ensure card doesn't exceed slide bounds
    if (y + cardH > SLIDE_H - BOTTOM_MARGIN) return;
    if (x + cardW > SLIDE_W - MARGIN_R) return;

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.WHITE },
      shadow: { type: "outer", blur: 4, offset: 1, color: "000000", opacity: 0.1 },
      rectRadius: 0.04,
    });

    slide.addShape(pptx.ShapeType.rect, {
      x, y: y + 0.06, w: 0.06, h: cardH - 0.12,
      fill: { color: C.ACCENT },
    });

    const cardContentW = cardW - 0.35;
    const colonIdx = item.indexOf(":");
    if (colonIdx > 2 && colonIdx < 50) {
      const cardTitle = item.substring(0, colonIdx).trim();
      const cardDesc = item.substring(colonIdx + 1).trim();
      addTextSafe(slide, cardTitle, {
        x: x + 0.2, y: y + 0.1, w: cardContentW, h: 0.35,
        fontSize: 14, fontFace: FONT, color: C.PRIMARY, bold: true,
        valign: "top",
      });
      addTextSafe(slide, cardDesc, {
        x: x + 0.2, y: y + 0.42, w: cardContentW, h: cardH - 0.55,
        fontSize: 13, fontFace: FONT, color: C.TEXT_BODY,
        valign: "top",
      });
    } else {
      addTextSafe(slide, item, {
        x: x + 0.2, y: y + 0.1, w: cardContentW, h: cardH - 0.2,
        fontSize: 14, fontFace: FONT, color: C.TEXT_BODY,
        valign: "middle",
      });
    }
  });
}

// Layout 5 — TABELA COMPARATIVA (CORREÇÃO #4: altura com folga generosa)
function renderTabela(pptx: any, data: SlideData) {
  const headers = (data.tableHeaders || []).map((h) => sanitize(h));
  const rows = (data.tableRows || []).map((r) => r.map((c) => sanitize(c)));
  if (!headers.length || !rows.length) return;

  const colCount = headers.length || (rows[0]?.length ?? 2);
  const colW = Array(colCount).fill(SAFE_W / colCount);
  const estimatedH = calcTableHeight(rows, colW);

  const titleText = deduplicateTitle(data.title);
  const headerH = getHeaderHeight(titleText);
  const maxTableH = SLIDE_H - (headerH + 0.2) - BOTTOM_MARGIN;

  // Split if table exceeds available height
  if (estimatedH > maxTableH && rows.length > 1) {
    const chunks = splitTableRows(rows, colW, maxTableH);
    if (chunks.length > 1) {
      const baseTitle = cleanPartTitle(data.title);
      chunks.forEach((chunk, idx) => {
        renderTabela(pptx, {
          ...data,
          title: `${baseTitle} (Parte ${idx + 1})`,
          tableHeaders: headers,
          tableRows: chunk,
        });
      });
      return;
    }
  }

  const slide = pptx.addSlide();
  slide.background = { color: C.BG_LIGHT };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: headerH,
    fill: { color: C.PRIMARY },
  });
  addTextSafe(slide, titleText, {
    x: MARGIN_L, y: 0.08, w: SAFE_W, h: headerH - 0.16,
    fontSize: getHeaderTitleFontSize(titleText), fontFace: FONT, color: C.WHITE, bold: true,
    valign: "middle",
  });

  const borderStyle = { type: "solid" as const, pt: 1, color: C.TABLE_BORDER };
  const borders = [borderStyle, borderStyle, borderStyle, borderStyle];
  const tableData: any[][] = [];

  tableData.push(headers.map((h) => ({
    text: h,
    options: {
      fontSize: 14, fontFace: FONT, bold: true, color: C.WHITE,
      fill: { color: C.PRIMARY },
      border: borders,
      valign: "middle" as const,
      paraSpaceBefore: 4, paraSpaceAfter: 4,
    },
  })));

  rows.forEach((row, ri) => {
    const dataRow = row.map((cell, ci) => ({
      text: cell,
      options: {
        fontSize: 13,
        fontFace: FONT,
        color: C.TEXT_BODY,
        bold: ci === 0,
        fill: ri % 2 === 1 ? { color: C.TABLE_ALT } : { color: C.WHITE },
        border: borders,
        valign: "middle" as const,
        paraSpaceBefore: 3,
        paraSpaceAfter: 3,
      },
    }));

    while (dataRow.length < colCount) {
      dataRow.push({
        text: "",
        options: {
          fontSize: 13,
          fontFace: FONT,
          color: C.TEXT_BODY,
          valign: "middle" as const,
          paraSpaceBefore: 3,
          paraSpaceAfter: 3,
        },
      });
    }

    tableData.push(dataRow);
  });

  // +15% padding for safety
  const safeH = Math.min(estimatedH * 1.15 + 0.2, maxTableH);
  const tableY = headerH + 0.2;
  slide.addTable(tableData, {
    x: MARGIN_L,
    y: tableY,
    w: SAFE_W,
    h: safeH,
    colW,
    rowH: ROW_BASE_H,
    autoPage: false,
  });
}

// Layout 6 — RESUMO (paginação determinística anti-overflow)
function renderResumo(pptx: any, data: SlideData) {
  const items = (data.items || []).map((i) => sanitize(i)).filter(Boolean);
  if (!items.length) return;

  const baseTitle = cleanPartTitle(data.subtitle || data.title);
  const titleH = getTitleHeight(baseTitle, SAFE_W - 0.08, 24);
  const titleY = 0.7;
  const bulletsY = titleY + titleH + 0.15;
  const summaryMaxH = SLIDE_H - bulletsY - BOTTOM_MARGIN;

  const bulletBlocks: BulletBlock[] = items.flatMap((text) =>
    splitLongBulletText(text, 170).map((chunk) => ({
      kind: "bullet" as const,
      text: chunk,
      height: estimateBulletHeightStrict(chunk, 14),
    }))
  );

  const pages = paginateBulletBlocks(bulletBlocks, summaryMaxH);

  pages.forEach((pageBlocks, idx) => {
    const suffix = pages.length > 1 ? ` (Parte ${idx + 1})` : "";
    const slideTitle = deduplicateTitle(baseTitle + suffix);

    const slide = pptx.addSlide();
    slide.background = { color: C.BG_LIGHT };

    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 0.18, h: SLIDE_H,
      fill: { color: C.ACCENT },
    });

    addTextSafe(slide, "RESUMO", {
      x: MARGIN_L, y: 0.3, w: 2, h: 0.4,
      fontSize: 13, fontFace: FONT, color: C.ACCENT, bold: true,
    });

    addTextSafe(slide, slideTitle, {
      x: MARGIN_L, y: titleY, w: SAFE_W - 0.08, h: titleH,
      fontSize: 24, fontFace: FONT, color: C.PRIMARY, bold: true,
      valign: "top",
    });

    let currentY = bulletsY;
    const maxY = SLIDE_H - BOTTOM_MARGIN;

    for (const block of pageBlocks) {
      if (currentY + block.height > maxY) break;

      addTextSafe(slide, [
        {
          text: "✓  ",
          options: {
            color: C.ACCENT,
            bold: true,
            fontSize: 14,
            fontFace: FONT,
            breakLine: false,
          },
        },
        {
          text: block.text,
          options: {
            color: C.TEXT_BODY,
            fontSize: 14,
            fontFace: FONT,
            breakLine: true,
          },
        },
      ], {
        x: MARGIN_L,
        y: currentY,
        w: SAFE_W - 0.08,
        h: block.height,
        valign: "top",
        paraSpaceAfter: 8,
        lineSpacingMultiple: 1.22,
      });

      currentY += block.height;
    }
  });
}

// SLIDE FINAL
function renderEncerramento(pptx: any, courseTitle: string) {
  const slide = pptx.addSlide();
  slide.background = { color: C.PRIMARY };

  addTextSafe(slide, "Obrigado!", {
    x: 0, y: 1.0, w: SLIDE_W, h: 1.8,
    fontSize: 52, fontFace: FONT, color: C.WHITE, bold: true,
    align: "center", valign: "middle",
  });

  addTextSafe(slide, sanitize(courseTitle), {
    x: 1, y: 3.0, w: 8, h: 0.7,
    fontSize: 18, fontFace: FONT, color: C.LIGHT_BLUE, align: "center",
  });

  addTextSafe(slide, "Continue praticando  |  Acesse os materiais complementares", {
    x: 1.5, y: 4.0, w: 7, h: 0.4,
    fontSize: 14, fontFace: FONT, color: C.ACCENT, align: "center",
  });
}

/* ═══════════════════════════════════════════════════════
   MAIN HANDLER
   ═══════════════════════════════════════════════════════ */

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const { course_id } = await req.json();
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: sub } = await serviceClient.from("subscriptions").select("plan").eq("user_id", userId).single();
    const plan = sub?.plan || "free";

    if (plan !== "pro") {
      const { data: profile } = await serviceClient.from("profiles").select("is_dev").eq("user_id", userId).maybeSingle();
      if (!profile?.is_dev) {
        return new Response(
          JSON.stringify({ error: "PowerPoint export requires a Pro plan.", feature: "export_pptx" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const { data: course, error: courseErr } = await serviceClient
      .from("courses").select("*").eq("id", course_id).eq("user_id", userId).single();
    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (course.status !== "published") {
      return new Response(JSON.stringify({ error: "Course must be published to export." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: modules = [] } = await serviceClient
      .from("course_modules").select("*").eq("course_id", course_id).order("order_index");

    /* ─── Build all slides ─── */
    let allSlides: SlideData[] = [];
    for (let i = 0; i < modules.length; i++) {
      allSlides.push(...buildModuleSlides(modules[i], i, modules.length));
    }

    allSlides = validateAndFix(allSlides);
    auditSlides(allSlides);

    /* ─── Build PPTX ─── */
    const pptx = new PptxGenJS();
    pptx.author = "EduGen AI";
    pptx.title = course.title;
    pptx.subject = course.description || "";

    renderCapa(pptx, {
      layout: "CAPA",
      title: course.title,
      description: course.description || "",
      moduleCount: modules.length,
    });

    for (const sd of allSlides) {
      switch (sd.layout) {
        case "ABERTURA_MODULO": renderAberturaModulo(pptx, sd); break;
        case "BULLETS":        renderBullets(pptx, sd); break;
        case "CARDS_GRID":     renderCardsGrid(pptx, sd); break;
        case "TABELA":         renderTabela(pptx, sd); break;
        case "RESUMO":         renderResumo(pptx, sd); break;
        default:               renderBullets(pptx, sd); break;
      }
    }

    renderEncerramento(pptx, course.title);

    const totalSlides = allSlides.length + 2;
    console.log(`PPTX generated: ${totalSlides} slides for ${modules.length} modules`);

    const pptxData = await pptx.write({ outputType: "uint8array" });
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = `${userId}/${safeName} - PPTX - ${dateStr}.pptx`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(fileName, pptxData, {
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: true,
      });
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_EXPORTED_PPTX",
      metadata: { course_id, slide_count: totalSlides },
    });

    return new Response(JSON.stringify({ url: signedUrl.signedUrl }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Export PPTX error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
