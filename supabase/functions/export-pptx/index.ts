import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";

/**
 * PPTX EXPORT — EduGenAI Premium Dark Theme
 *
 * Design Reference: Dark premium theme with serif titles, teal card borders,
 * gold accents, numbered module cards, icon circles, and elegant tables.
 *
 * REGRAS DE OURO — NUNCA VIOLAR:
 * 1. NUNCA usar autoFit: true
 * 2. SEMPRE usar overflow: "clip"
 * 3. SEMPRE calcular titleH dinamicamente
 * 4. SEMPRE posicionar com yCursor
 * 5. NUNCA x + w > SLIDE_W - MARGIN_R
 * 6. NUNCA y + h > SLIDE_H - BOTTOM_MARGIN
 *
 * Slide widescreen = 10.0 x 5.625 polegadas
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ═══════════════════════════════════════════════════════
   DESIGN SYSTEM — EduGenAI Premium Dark
   ═══════════════════════════════════════════════════════ */

const C = {
  // Backgrounds
  BG_DARK:       "141B2A",  // Main slide background
  BG_CARD:       "1C2A3A",  // Card / elevated surface
  BG_CARD_ALT:   "1A2535",  // Alternating card shade
  BG_CALLOUT:    "2A2D1E",  // Olive/gold callout bar (reflection/insight)

  // Accents
  GOLD:          "C4A265",  // Primary accent — labels, badges, highlights
  GOLD_MUTED:    "9B8A60",  // Subtler gold
  TEAL:          "2D6B7A",  // Card left border, subtle accents
  TEAL_LIGHT:    "3A8494",  // Lighter teal for hover/emphasis

  // Text
  TEXT_CREAM:     "E8E0D4",  // Primary text on dark bg
  TEXT_WHITE:     "FFFFFF",  // Bright white for titles
  TEXT_MUTED:     "7A8A9A",  // Secondary/muted text
  TEXT_GOLD:      "C4A265",  // Gold text for labels
  TEXT_TEAL:      "5AACBA",  // Teal highlighted text

  // Table
  TABLE_HEADER:   "1E2E40",
  TABLE_ROW_ODD:  "182230",
  TABLE_ROW_EVEN: "1C2838",
  TABLE_BORDER:   "2A3A4A",
  TABLE_GOLD_LINE:"C4A265",

  // Icon circle backgrounds (rotating palette)
  ICON_GOLD:      "C4A265",
  ICON_GRAY:      "6A7A8A",
  ICON_TEAL:      "3A8494",
  ICON_WARM:      "A68050",
};

// Rotating icon circle colors for variety
const ICON_COLORS = [C.ICON_GOLD, C.ICON_GRAY, C.ICON_TEAL, C.ICON_WARM, C.ICON_GRAY, C.ICON_GOLD];

// Simple icon characters to render inside circles (fallback, no custom font needed)
const ICON_CHARS = ["◆", "⚙", "▣", "◎", "✦", "⬟", "◈", "▲", "●", "✱", "⬢", "◉"];

const FONT_TITLE = "Georgia";   // Serif for titles
const FONT_BODY  = "Calibri";   // Sans-serif for body

const SLIDE_W = 10.0;
const SLIDE_H = 5.625;

const MARGIN_L = 0.55;
const MARGIN_R = 0.55;
const SAFE_W = SLIDE_W - MARGIN_L - MARGIN_R; // ~8.90

const BOTTOM_MARGIN = 0.25;

const BODY_FONT_PT = 14;
const HEADER_SECTION_PT = 13;

const MIN_BULLETS = 3;
const MAX_BULLETS = 6;
const MAX_BULLETS_PER_SLIDE = 5;

const SECTION_GAP = 0.12;

// 2-column layout
const COL_GAP = 0.25;
const COL_W = (SAFE_W - COL_GAP) / 2;
const COL_LEFT_X = MARGIN_L;
const COL_RIGHT_X = MARGIN_L + COL_W + COL_GAP;

// 3-column layout
const COL3_GAP = 0.20;
const COL3_W = (SAFE_W - COL3_GAP * 2) / 3;

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
   SAFE TEXT — boundary-checked wrapper
   ═══════════════════════════════════════════════════════ */

const _auditLog: { slideLabel: string; x: number; y: number; w: number; h: number; origW: number; origH: number }[] = [];
let _auditSlideCounter = 0;

function auditNextSlide() { _auditSlideCounter++; }

function addTextSafe(slide: any, text: any, options: Record<string, unknown>) {
  const x = Number(options.x || 0);
  const y = Number(options.y || 0);
  const w = Number(options.w || 0);
  const h = Number(options.h || 0);
  const maxW = SLIDE_W - x - MARGIN_R;
  const safeW = Math.min(w, maxW);
  const maxH = SLIDE_H - y - 0.10;
  const safeH = Math.min(h, maxH);

  _auditLog.push({ slideLabel: `Slide ${_auditSlideCounter}`, x, y, w: safeW, h: safeH, origW: w, origH: h });

  if (safeW <= 0.1 || safeH <= 0.05) return;

  slide.addText(text, {
    ...options,
    x, y, w: safeW, h: safeH,
    autoFit: false,
    overflow: "clip",
  });
}

function runAudit(): { passed: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const el of _auditLog) {
    const right = el.x + el.w;
    const bottom = el.y + el.h;
    if (right > SLIDE_W - 0.10) errors.push(`${el.slideLabel}: overflow R (x+w=${right.toFixed(2)})`);
    if (bottom > SLIDE_H - 0.10) errors.push(`${el.slideLabel}: overflow B (y+h=${bottom.toFixed(2)})`);
    if (el.x < 0) errors.push(`${el.slideLabel}: x negativo (${el.x})`);
    if (el.y < 0) errors.push(`${el.slideLabel}: y negativo (${el.y})`);
    if (el.origW - el.w > 0.1) warnings.push(`${el.slideLabel}: w clamp ${el.origW.toFixed(2)}->${el.w.toFixed(2)}`);
    if (el.origH - el.h > 0.1) warnings.push(`${el.slideLabel}: h clamp ${el.origH.toFixed(2)}->${el.h.toFixed(2)}`);
  }

  const passed = errors.length === 0;
  if (passed) console.log(`✅ PPTX Audit PASSED — ${_auditLog.length} elements, 0 errors`);
  else {
    console.error(`❌ PPTX Audit FAILED — ${errors.length} errors`);
    errors.forEach(e => console.error(`  ❌ ${e}`));
  }
  if (warnings.length > 0) warnings.forEach(w => console.warn(`  ⚠️ ${w}`));
  return { passed, errors, warnings };
}

/* ═══════════════════════════════════════════════════════
   BULLET SANITIZATION & HEIGHT HELPERS
   ═══════════════════════════════════════════════════════ */

function sanitizeBullets(bullets: string[]): string[] {
  if (!bullets || bullets.length === 0) return [];
  const result: string[] = [];
  let buffer = '';
  for (const raw of bullets) {
    const text = (raw || '').trim();
    if (!text) continue;
    buffer = buffer ? buffer + ' ' + text : text;
    const complete = /[.!?](\s*["')])?$/.test(buffer) || buffer.length > 220;
    if (complete) {
      if (!/[.!?]$/.test(buffer.replace(/["')]\s*$/, ''))) buffer += '.';
      result.push(buffer.trim());
      buffer = '';
    }
  }
  if (buffer.trim()) {
    if (!/[.!?]$/.test(buffer.trim())) buffer = buffer.trim() + '.';
    result.push(buffer.trim());
  }
  return result;
}

const BULLET_H_SHORT = 0.50;
const BULLET_H_LONG  = 0.85;
const BULLET_H_XLONG = 1.15;

function getBulletHeight(text: string): number {
  const len = (text || '').length;
  if (len <= 80) return BULLET_H_SHORT;
  if (len <= 160) return BULLET_H_LONG;
  return BULLET_H_XLONG;
}

function calcBulletsHeight(bullets: string[]): number {
  return bullets.reduce((sum, b) => sum + getBulletHeight(b), 0);
}

function splitBulletsToFit(bullets: string[], maxH: number): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let currentH = 0;
  for (const bullet of bullets) {
    const itemH = getBulletHeight(bullet);
    if (current.length >= MAX_BULLETS_PER_SLIDE || (current.length > 0 && currentH + itemH > maxH - 0.15)) {
      groups.push([...current]);
      current = [bullet];
      currentH = itemH;
    } else {
      current.push(bullet);
      currentH += itemH;
    }
  }
  if (current.length > 0) groups.push(current);
  // Balance: merge last group if only 1 item
  if (groups.length >= 2) {
    const last = groups[groups.length - 1];
    const prev = groups[groups.length - 2];
    if (last.length === 1 && prev.length < MAX_BULLETS_PER_SLIDE) {
      const lastH = getBulletHeight(last[0]);
      const prevH = calcBulletsHeight(prev);
      if (prevH + lastH <= maxH) { prev.push(last[0]); groups.pop(); }
    }
  }
  return groups;
}

function estimateTextHeight(text: string, fontSizePt: number, widthInInches: number): number {
  const clean = sanitize(text || "");
  if (!clean) return 0;
  const charsPerInch = Math.max(5, 120 / fontSizePt);
  const charsPerLine = Math.max(15, Math.floor(widthInInches * charsPerInch));
  const paragraphs = clean.split("\n").filter(Boolean);
  let totalLines = 0;
  for (const para of paragraphs) totalLines += Math.max(1, Math.ceil(para.length / charsPerLine));
  const lineHeightIn = (fontSizePt * 1.2) / 72;
  return totalLines * lineHeightIn + 0.08;
}

function getTitleHeight(titleText: string, boxWidthIn: number, fontSizePt: number): number {
  const charsPerLine = Math.floor(boxWidthIn * 5.5);
  const lines = Math.max(1, Math.ceil(titleText.length / Math.max(1, charsPerLine)));
  const lineHeightIn = (fontSizePt * 1.25) / 72;
  return Math.max(0.60, lines * lineHeightIn + 0.20);
}

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
      if (s.length <= maxCharsPerChunk) { current = s; }
      else {
        const words = s.split(/\s+/);
        let wAcc = "";
        for (const w of words) {
          const wCandidate = wAcc ? `${wAcc} ${w}` : w;
          if (wCandidate.length <= maxCharsPerChunk) { wAcc = wCandidate; }
          else { if (wAcc) chunks.push(wAcc.trim()); wAcc = w; }
        }
        current = wAcc;
      }
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.length ? chunks : [clean];
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
      blocks.push({ heading: curHeading, items: [], isTable: true, headers: [...tHeaders], rows: [...tRows] });
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

type LayoutType = "CAPA" | "TOC" | "ABERTURA_MODULO" | "BULLETS" | "CARDS_GRID" | "TABELA" | "RESUMO" | "ENCERRAMENTO";

interface SlideData {
  layout: LayoutType;
  title: string;
  subtitle?: string;
  categoryLabel?: string;
  items?: string[];
  tableHeaders?: string[];
  tableRows?: string[][];
  moduleIndex?: number;
  moduleCount?: number;
  description?: string;
  courseTitle?: string;
  modules?: { title: string; description: string }[];
}

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */

function sameParentTopic(title1: string, title2: string): boolean {
  const clean = (t: string) => t.replace(/\s*\(Parte \d+\)\s*$/i, "").trim();
  return clean(title1) === clean(title2);
}

function removePartSuffix(title: string): string {
  return title.replace(/\s*\(Parte \d+\)\s*$/i, "").trim();
}

function cleanPartTitle(title: string): string {
  return removePartSuffix(deduplicateTitle(title));
}

function detectParallel(items: string[]): boolean {
  if (items.length < 3 || items.length > 8) return false;
  const withColon = items.filter((it) => { const ci = it.indexOf(":"); return ci > 2 && ci < 50; }).length;
  return withColon >= Math.ceil(items.length * 0.6);
}

function isResumoHeading(heading: string): boolean {
  return /resumo|conclus|encerramento|pontos[- ]chave|key takeaway|takeaway|recapitula/i.test(heading);
}

function isObjectivesHeading(heading: string): boolean {
  return /objetivo|objetivos?\s+d[oe]|learning objectives|o que voc/i.test(heading);
}

/** Extract a short category label from the heading (first few words, uppercase) */
function extractCategoryLabel(heading: string): string {
  const clean = sanitize(heading);
  // If it already looks like a short label (<30 chars), use it
  if (clean.length <= 30) return clean.toUpperCase();
  // Take first 3-4 significant words
  const words = clean.split(/\s+/).slice(0, 4);
  return words.join(" ").toUpperCase();
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
  categoryLabel?: string;
}

function processSlideContent(slide: RawSlide): RawSlide {
  const hasBullets = slide.bullets && slide.bullets.length >= 2;
  const hasOnlyParagraph = !hasBullets && slide.content && slide.content.length > 0;
  if (hasOnlyParagraph && slide.content) {
    const sentences = slide.content.split(/(?<=[.!?])\s+/).map((s) => sanitize(s.trim())).filter((s) => s.length > 20);
    if (sentences.length >= 2) { slide.bullets = sentences; slide.content = undefined; }
    else { slide.mergeWithNext = true; }
  }
  return slide;
}

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
      if (prev && !prev.isTable && sameParentTopic(prev.title, slide.title) && (prev.bullets || []).length + bullets.length <= MAX_BULLETS) {
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
      const headerH = 1.2; // approximate
      const maxContentH = SLIDE_H - headerH - BOTTOM_MARGIN;
      const groups = splitBulletsToFit(finalBullets, maxContentH);
      groups.forEach((group, gIdx) => {
        const suffix = groups.length > 1 ? ` (Parte ${gIdx + 1})` : "";
        result.push({ ...slide, bullets: group, title: slide.title + suffix });
      });
      continue;
    }
    result.push({ ...slide, bullets: finalBullets });
  }
  return result;
}

function validateBeforeRender(slides: RawSlide[]): RawSlide[] {
  return slides.filter((slide) => {
    const bullets = slide.bullets || [];
    const content = slide.content || "";
    const hasContent = bullets.length >= 1 || content.length >= 50 || slide.isTable;
    if (!hasContent) console.warn(`⚠️ Slide descartado: "${slide.title}"`);
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

  // Extract short module name (without "Módulo X:" prefix)
  const shortTitle = rawTitle.replace(/^módulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;

  const objItems: string[] = [];
  const resumoItems: string[] = [];
  const contentBlocks: ParsedBlock[] = [];

  for (const block of blocks) {
    if (isObjectivesHeading(block.heading) && !block.isTable) objItems.push(...block.items);
    else if (isResumoHeading(block.heading) && !block.isTable) resumoItems.push(...block.items);
    else contentBlocks.push(block);
  }

  const slides: SlideData[] = [];

  // Module opener
  slides.push({
    layout: "ABERTURA_MODULO",
    title: shortTitle,
    subtitle: `MÓDULO ${String(modIndex + 1).padStart(2, "0")}`,
    description: objItems.length > 0 ? objItems[0] : undefined,
    items: sanitizeBullets(objItems.slice(0, 4).map(sanitize)),
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
        categoryLabel: extractCategoryLabel(block.heading || ""),
      });
      continue;
    }
    const items = block.items.map(sanitize).filter((s) => s.length > 3);
    const heading = sanitize(block.heading || moduleTitle);
    if (items.length === 0) {
      const blockContent = block.items.join(" ").trim();
      if (blockContent.length > 30) rawSlides.push({ title: heading, bullets: [], content: sanitize(blockContent), categoryLabel: extractCategoryLabel(heading) });
      continue;
    }
    rawSlides.push({ title: heading, bullets: items, categoryLabel: extractCategoryLabel(heading) });
  }

  const processed = rawSlides.map(processSlideContent);
  const balanced = splitOrMergeSlides(processed);
  const validated = validateBeforeRender(balanced);

  for (const raw of validated) {
    if (raw.isTable && raw.headers && raw.rows) {
      slides.push({ layout: "TABELA", title: raw.title, tableHeaders: raw.headers, tableRows: raw.rows, categoryLabel: raw.categoryLabel });
      continue;
    }
    const items = raw.bullets || [];
    if (items.length === 0) continue;
    const isParallel = detectParallel(items);
    slides.push({
      layout: isParallel ? "CARDS_GRID" : "BULLETS",
      title: raw.title,
      items: sanitizeBullets(items),
      categoryLabel: raw.categoryLabel,
    });
  }

  if (resumoItems.length > 0) {
    slides.push({
      layout: "RESUMO",
      title: `Key Takeaways – Módulo ${modIndex + 1}`,
      subtitle: moduleTitle,
      items: sanitizeBullets(resumoItems.slice(0, 6).map(sanitize)),
      categoryLabel: "RESUMO DO MÓDULO",
    });
  }

  return slides;
}

function validateAndFix(slides: SlideData[]): SlideData[] {
  for (const slide of slides) {
    if (slide.title) slide.title = sanitize(slide.title);
    if (slide.subtitle) slide.subtitle = sanitize(slide.subtitle);
    if (slide.items) slide.items = slide.items.map(sanitize);
    if (slide.tableHeaders) slide.tableHeaders = slide.tableHeaders.map(sanitize);
    if (slide.tableRows) slide.tableRows = slide.tableRows.map((r) => r.map(sanitize));
  }
  return slides;
}

/* ═══════════════════════════════════════════════════════
   TABLE HEIGHT HELPERS
   ═══════════════════════════════════════════════════════ */

const ROW_BASE_H = 0.45;
const CELL_LINE_H_IN = 0.22;
const HEADER_ROW_H = 0.50;

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
  for (const row of rows) totalH += calcRowHeight(row, colWidths);
  return totalH;
}

function splitTableRows(rows: string[][], colWidths: number[], maxTableH: number): string[][][] {
  if (calcTableHeight(rows, colWidths) <= maxTableH) return [rows];
  const chunks: string[][][] = [];
  let current: string[][] = [];
  let currentHeight = HEADER_ROW_H;
  for (const row of rows) {
    const rowH = calcRowHeight(row, colWidths);
    if (current.length > 0 && currentHeight + rowH > maxTableH) {
      chunks.push(current);
      current = [row];
      currentHeight = HEADER_ROW_H + rowH;
    } else {
      current.push(row);
      currentHeight += rowH;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/* ═══════════════════════════════════════════════════════
   ICON CIRCLE HELPER
   ═══════════════════════════════════════════════════════ */

function addIconCircle(slide: any, pptx: any, x: number, y: number, size: number, color: string, label: string) {
  // Circle background
  slide.addShape(pptx.ShapeType.ellipse, {
    x, y, w: size, h: size,
    fill: { color },
  });
  // Text inside circle
  addTextSafe(slide, label, {
    x, y, w: size, h: size,
    fontSize: Math.round(size * 28),
    fontFace: FONT_BODY, color: C.TEXT_WHITE, bold: true,
    align: "center", valign: "middle",
  });
}

/** Draw a teal left border accent on a card */
function addCardBorder(slide: any, pptx: any, x: number, y: number, h: number, color = C.TEAL) {
  slide.addShape(pptx.ShapeType.rect, {
    x, y: y + 0.06, w: 0.04, h: h - 0.12,
    fill: { color },
  });
}

/* ═══════════════════════════════════════════════════════
   HEADER RENDERING — Category label + Serif title
   ═══════════════════════════════════════════════════════ */

function getHeaderTitleFontSize(titleText: string): number {
  const len = sanitize(removePartSuffix(deduplicateTitle(titleText || ""))).length;
  if (len > 100) return 22;
  if (len > 70) return 26;
  if (len > 50) return 30;
  return 34;
}

/** Renders category label (gold uppercase) + serif title. Returns total header height. */
function renderContentHeader(slide: any, categoryLabel: string, titleText: string): number {
  let y = 0.35;

  // Category label (gold, uppercase, small)
  if (categoryLabel) {
    addTextSafe(slide, categoryLabel, {
      x: MARGIN_L, y, w: SAFE_W, h: 0.30,
      fontSize: 11, fontFace: FONT_BODY, color: C.GOLD, bold: true,
      letterSpacing: 2,
    });
    y += 0.30;
  }

  // Main title (serif, cream/white)
  const fontSize = getHeaderTitleFontSize(titleText);
  const titleH = getTitleHeight(titleText, SAFE_W, fontSize);
  addTextSafe(slide, titleText, {
    x: MARGIN_L, y, w: SAFE_W, h: titleH,
    fontSize, fontFace: FONT_TITLE, color: C.TEXT_CREAM, bold: true,
    valign: "top",
  });
  y += titleH + 0.15;

  return y;
}

/* ═══════════════════════════════════════════════════════
   SLIDE RENDERERS — EduGenAI Premium Dark Theme
   ═══════════════════════════════════════════════════════ */

// ──── CAPA ────
function renderCapa(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.BG_DARK };

  // "CURSO COMPLETO" badge (rounded rect with gold border)
  const badgeW = 2.8;
  const badgeH = 0.42;
  const badgeX = (SLIDE_W - badgeW) / 2;
  const badgeY = 0.80;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: badgeX, y: badgeY, w: badgeW, h: badgeH,
    line: { color: C.GOLD_MUTED, width: 1.5 },
    fill: { type: "none" },
    rectRadius: 0.15,
  });
  addTextSafe(slide, "CURSO COMPLETO", {
    x: badgeX, y: badgeY, w: badgeW, h: badgeH,
    fontSize: 12, fontFace: FONT_BODY, color: C.GOLD, bold: true,
    align: "center", valign: "middle", letterSpacing: 3,
  });

  // Title (large serif, centered)
  const titleH = getTitleHeight(data.title, SAFE_W - 1, 44);
  const titleY = badgeY + badgeH + 0.40;
  addTextSafe(slide, data.title, {
    x: MARGIN_L + 0.5, y: titleY, w: SAFE_W - 1, h: titleH,
    fontSize: 44, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
    align: "center", valign: "middle",
  });

  // Gold separator line
  const sepY = titleY + titleH + 0.10;
  const sepW = 1.2;
  slide.addShape(pptx.ShapeType.rect, {
    x: (SLIDE_W - sepW) / 2, y: sepY, w: sepW, h: 0.04,
    fill: { color: C.GOLD },
  });

  // Description/subtitle
  if (data.description) {
    const descY = sepY + 0.25;
    addTextSafe(slide, sanitize(data.description), {
      x: 1.5, y: descY, w: SLIDE_W - 3, h: 0.50,
      fontSize: 16, fontFace: FONT_BODY, color: C.TEXT_MUTED, align: "center",
    });
  }

  // Footer: date + module count
  const d = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const footerParts = [];
  footerParts.push(d);
  if (data.moduleCount) footerParts.push(`${data.moduleCount} Módulos`);
  addTextSafe(slide, footerParts.join("   |   "), {
    x: 1, y: SLIDE_H - 0.65, w: SLIDE_W - 2, h: 0.40,
    fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_MUTED, align: "center",
  });
}

// ──── TOC (Table of Contents) ────
function renderTOC(pptx: any, data: SlideData) {
  const modules = data.modules || [];
  if (modules.length === 0) return;

  const slide = pptx.addSlide();
  slide.background = { color: C.BG_DARK };

  // Category label
  addTextSafe(slide, "CONTEÚDO DO CURSO", {
    x: MARGIN_L, y: 0.30, w: SAFE_W, h: 0.25,
    fontSize: 11, fontFace: FONT_BODY, color: C.GOLD, bold: true, letterSpacing: 2,
  });

  // Title
  addTextSafe(slide, "O que você vai aprender", {
    x: MARGIN_L, y: 0.55, w: SAFE_W, h: 0.55,
    fontSize: 34, fontFace: FONT_TITLE, color: C.TEXT_CREAM, bold: true,
  });

  // Module cards in 2-column grid
  const gridY = 1.20;
  const cols = 2;
  const cardGapX = 0.20;
  const cardGapY = 0.18;
  const cardW = (SAFE_W - cardGapX) / cols;
  const rows = Math.ceil(modules.length / cols);
  const availH = SLIDE_H - gridY - BOTTOM_MARGIN;
  const cardH = Math.min((availH - (rows - 1) * cardGapY) / rows, 1.30);

  modules.forEach((mod, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MARGIN_L + col * (cardW + cardGapX);
    const y = gridY + row * (cardH + cardGapY);

    if (y + cardH > SLIDE_H - BOTTOM_MARGIN) return;

    // Card background
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.BG_CARD },
      rectRadius: 0.06,
    });

    // Teal left border
    addCardBorder(slide, pptx, x, y, cardH);

    // Numbered circle
    const circleSize = 0.38;
    const circleColor = ICON_COLORS[idx % ICON_COLORS.length];
    addIconCircle(slide, pptx, x + 0.18, y + 0.18, circleSize, circleColor, String(idx + 1).padStart(2, "0"));

    // Module title
    const textX = x + 0.65;
    const textW = cardW - 0.80;
    addTextSafe(slide, mod.title, {
      x: textX, y: y + 0.18, w: textW, h: 0.30,
      fontSize: 14, fontFace: FONT_BODY, color: C.TEXT_CREAM, bold: true,
    });

    // Module description
    if (mod.description) {
      addTextSafe(slide, mod.description, {
        x: textX, y: y + 0.50, w: textW, h: cardH - 0.65,
        fontSize: 11, fontFace: FONT_BODY, color: C.TEXT_MUTED,
        valign: "top", lineSpacingMultiple: 1.2,
      });
    }
  });
}

// ──── ABERTURA DE MÓDULO ────
function renderAberturaModulo(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.BG_DARK };

  // Module badge (rounded rect, filled teal)
  if (data.subtitle) {
    const badgeW = 1.6;
    const badgeH = 0.36;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN_L, y: 0.50, w: badgeW, h: badgeH,
      fill: { color: C.TEAL },
      rectRadius: 0.06,
    });
    addTextSafe(slide, data.subtitle.toUpperCase(), {
      x: MARGIN_L, y: 0.50, w: badgeW, h: badgeH,
      fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_WHITE, bold: true,
      align: "center", valign: "middle", letterSpacing: 2,
    });
  }

  // Title (large serif)
  const titleY = 1.10;
  const titleH = getTitleHeight(data.title, SAFE_W * 0.55, 36);
  addTextSafe(slide, data.title, {
    x: MARGIN_L, y: titleY, w: SAFE_W * 0.55, h: titleH,
    fontSize: 36, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
  });

  // Gold separator
  const sepY = titleY + titleH + 0.08;
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN_L, y: sepY, w: 0.80, h: 0.04,
    fill: { color: C.GOLD },
  });

  // Description
  if (data.description) {
    addTextSafe(slide, sanitize(data.description), {
      x: MARGIN_L, y: sepY + 0.20, w: SAFE_W * 0.55, h: 0.70,
      fontSize: 14, fontFace: FONT_BODY, color: C.TEXT_MUTED,
      valign: "top", lineSpacingMultiple: 1.3,
    });
  }

  // Objective keywords as pills at bottom
  if (data.items && data.items.length > 0) {
    const pillY = SLIDE_H - 0.80;
    let pillX = MARGIN_L;
    const maxPills = 3;
    const pills = data.items.slice(0, maxPills).map(item => {
      // Extract first few words as keyword
      const words = sanitize(item).split(/\s+/).slice(0, 3);
      return words.join(" ");
    });

    pills.forEach((pill) => {
      const pillW = Math.min(pill.length * 0.10 + 0.50, 2.8);
      if (pillX + pillW > SLIDE_W * 0.55) return;

      slide.addShape(pptx.ShapeType.roundRect, {
        x: pillX, y: pillY, w: pillW, h: 0.36,
        fill: { color: C.BG_CARD },
        rectRadius: 0.06,
      });
      addTextSafe(slide, pill, {
        x: pillX, y: pillY, w: pillW, h: 0.36,
        fontSize: 10, fontFace: FONT_BODY, color: C.TEXT_MUTED,
        align: "center", valign: "middle",
      });
      pillX += pillW + 0.12;
    });
  }
}

// ──── BULLETS (Content slide with visual cards — matching EduGenAI model) ────
function renderBullets(pptx: any, data: SlideData) {
  const allBullets = (data.items || []).map((b) => sanitize(b)).filter((b) => b.length > 0);
  if (allBullets.length === 0) return;

  const baseTitle = cleanPartTitle(data.title);
  const categoryLabel = data.categoryLabel || extractCategoryLabel(baseTitle);

  // Parse bullets into card data (title + body)
  const cards = allBullets.map((bullet) => {
    const colonIdx = bullet.indexOf(":");
    if (colonIdx > 2 && colonIdx < 60) {
      return { title: bullet.substring(0, colonIdx).trim(), body: bullet.substring(colonIdx + 1).trim() };
    }
    // Extract first ~4 words as title
    const words = bullet.split(/\s+/);
    if (words.length > 6) {
      return { title: words.slice(0, 4).join(" "), body: words.slice(4).join(" ") };
    }
    return { title: "", body: bullet };
  });

  // Split into pages if too many cards
  const maxCardsPerSlide = 6;
  const cardPages: typeof cards[] = [];
  for (let i = 0; i < cards.length; i += maxCardsPerSlide) {
    cardPages.push(cards.slice(i, i + maxCardsPerSlide));
  }

  cardPages.forEach((pageCards, pageIdx) => {
    const suffix = cardPages.length > 1 ? ` (Parte ${pageIdx + 1})` : "";
    const titleText = deduplicateTitle(baseTitle + suffix);

    const slide = pptx.addSlide();
    slide.background = { color: C.BG_DARK };
    const contentY = renderContentHeader(slide, categoryLabel, titleText);

    const count = pageCards.length;
    // Use 2 columns for 2+ cards, 1 column for single card
    const cols = count >= 2 ? 2 : 1;
    const gapX = 0.20;
    const gapY = 0.15;
    const cardW = cols === 1 ? SAFE_W : (SAFE_W - gapX) / cols;
    const rows = Math.ceil(count / cols);
    const availH = SLIDE_H - contentY - BOTTOM_MARGIN - 0.10;
    const cardH = Math.min((availH - (rows - 1) * gapY) / rows, 1.40);

    pageCards.forEach((card, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = MARGIN_L + col * (cardW + gapX);
      const y = contentY + row * (cardH + gapY);

      if (y + cardH > SLIDE_H - BOTTOM_MARGIN) return;

      // Card background
      slide.addShape(pptx.ShapeType.rect, {
        x, y, w: cardW, h: cardH,
        fill: { color: C.BG_CARD },
        rectRadius: 0.06,
      });

      // Teal left border
      addCardBorder(slide, pptx, x, y, cardH);

      // Icon circle
      const circleSize = 0.34;
      const iconColor = ICON_COLORS[(pageIdx * 10 + idx) % ICON_COLORS.length];
      const iconChar = ICON_CHARS[(pageIdx * 10 + idx) % ICON_CHARS.length];
      addIconCircle(slide, pptx, x + 0.15, y + 0.15, circleSize, iconColor, iconChar);

      // Card content
      const cardContentX = x + 0.58;
      const cardContentW = cardW - 0.72;
      let textY = y + 0.15;

      if (card.title) {
        addTextSafe(slide, card.title, {
          x: cardContentX, y: textY, w: cardContentW, h: 0.28,
          fontSize: 14, fontFace: FONT_BODY, color: C.TEXT_CREAM, bold: true,
        });
        textY += 0.32;
      }

      if (card.body) {
        const bodyH = cardH - (textY - y) - 0.10;
        addTextSafe(slide, card.body, {
          x: cardContentX, y: textY, w: cardContentW, h: Math.max(bodyH, 0.20),
          fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_MUTED,
          valign: "top", lineSpacingMultiple: 1.25,
        });
      }
    });
  });
}

// ──── CARDS GRID (Dark cards with teal border + icon circles) ────
function groupCardsIntoSlides(cards: string[]): string[][] {
  const total = cards.length;
  if (total === 0) return [];
  if (total <= 4) return [cards];
  if (total <= 6) return [cards.slice(0, 3), cards.slice(3)];
  const numSlides = Math.ceil(total / 4);
  const baseSize = Math.floor(total / numSlides);
  const remainder = total % numSlides;
  const groups: string[][] = [];
  let start = 0;
  for (let i = 0; i < numSlides; i++) {
    const size = baseSize + (i < remainder ? 1 : 0);
    groups.push(cards.slice(start, start + size));
    start += size;
  }
  return groups;
}

function renderCardsGrid(pptx: any, data: SlideData) {
  const allItems = data.items || [];
  if (allItems.length === 0) return;
  if (allItems.length <= 2) { renderBullets(pptx, { ...data, layout: "BULLETS" }); return; }

  // Separate intro paragraphs from real cards
  const introItems: string[] = [];
  const cardItems: string[] = [];
  for (const item of allItems) {
    const colonIdx = item.indexOf(":");
    const hasTitle = colonIdx > 2 && colonIdx < 50;
    const isLongParagraph = !hasTitle && item.length > 80;
    if (isLongParagraph) introItems.push(item);
    else cardItems.push(item);
  }
  if (cardItems.length <= 2) { renderBullets(pptx, { ...data, layout: "BULLETS" }); return; }

  const baseTitle = cleanPartTitle(data.title);
  const categoryLabel = data.categoryLabel || extractCategoryLabel(baseTitle);

  const cols = cardItems.length === 3 || cardItems.length === 6 ? 3 : 2;
  const gapX = cols === 3 ? COL3_GAP : 0.20;
  const gapY = 0.18;
  const cardW = cols === 3 ? COL3_W : (SAFE_W - gapX) / 2;
  const maxCardH = 1.50;

  const groups = groupCardsIntoSlides(cardItems);

  groups.forEach((pageItems, pageIdx) => {
    const suffix = groups.length > 1 ? ` (Parte ${pageIdx + 1})` : "";
    const titleText = deduplicateTitle(baseTitle + suffix);

    const slide = pptx.addSlide();
    slide.background = { color: C.BG_DARK };
    let contentY = renderContentHeader(slide, categoryLabel, titleText);

    // Intro text above grid
    if (pageIdx === 0 && introItems.length > 0) {
      const introTextClean = sanitize(introItems.join(" "));
      const lines = Math.max(1, Math.ceil(introTextClean.length / 90));
      const introH = lines * 0.28 + 0.10;
      addTextSafe(slide, introTextClean, {
        x: MARGIN_L, y: contentY, w: SAFE_W, h: introH,
        fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_MUTED, italic: true,
      });
      contentY += introH + 0.10;
    }

    const availH = SLIDE_H - contentY - BOTTOM_MARGIN;
    const rows = Math.ceil(pageItems.length / cols);
    const cardH = Math.min((availH - (rows - 1) * gapY) / rows, maxCardH);

    pageItems.forEach((item, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = MARGIN_L + col * (cardW + gapX);
      const y = contentY + row * (cardH + gapY);

      if (y + cardH > SLIDE_H - BOTTOM_MARGIN) return;
      if (x + cardW > SLIDE_W - MARGIN_R) return;

      // Dark card background
      slide.addShape(pptx.ShapeType.rect, {
        x, y, w: cardW, h: cardH,
        fill: { color: C.BG_CARD },
        rectRadius: 0.06,
      });

      // Teal left border
      addCardBorder(slide, pptx, x, y, cardH);

      // Icon circle
      const circleSize = 0.34;
      const iconColor = ICON_COLORS[(pageIdx * 10 + idx) % ICON_COLORS.length];
      const iconChar = ICON_CHARS[(pageIdx * 10 + idx) % ICON_CHARS.length];
      addIconCircle(slide, pptx, x + 0.15, y + 0.15, circleSize, iconColor, iconChar);

      // Card content
      const cardContentX = x + 0.58;
      const cardContentW = cardW - 0.72;

      const colonIdx = item.indexOf(":");
      const cardTitle = (colonIdx > 2 && colonIdx < 50) ? item.substring(0, colonIdx).trim() : '';
      const cardBody = cardTitle ? item.substring(colonIdx + 1).trim() : item.trim();

      let textY = y + 0.15;

      if (cardTitle) {
        addTextSafe(slide, cardTitle, {
          x: cardContentX, y: textY, w: cardContentW, h: 0.28,
          fontSize: 13, fontFace: FONT_BODY, color: C.TEXT_CREAM, bold: true,
        });
        textY += 0.30;
      }

      if (cardBody) {
        const bodyH = cardH - (textY - y) - 0.10;
        addTextSafe(slide, cardBody, {
          x: cardContentX, y: textY, w: cardContentW, h: Math.max(bodyH, 0.20),
          fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_MUTED,
          valign: "top", lineSpacingMultiple: 1.2,
        });
      }
    });
  });
}

// ──── TABELA (Borderless minimal with gold header underline + insight bar) ────
function renderTabela(pptx: any, data: SlideData) {
  const headers = (data.tableHeaders || []).map((h) => sanitize(h));
  const rows = (data.tableRows || []).map((r) => r.map((c) => sanitize(c)));
  if (!headers.length || !rows.length) return;

  const colCount = headers.length || (rows[0]?.length ?? 2);
  const colW = Array(colCount).fill(SAFE_W / colCount);

  const titleText = deduplicateTitle(data.title);
  const categoryLabel = data.categoryLabel || extractCategoryLabel(titleText);

  // Calculate available space
  const headerAreaH = 1.15;
  const insightBarH = 0.55; // reserve space for insight bar
  const maxTableH = SLIDE_H - headerAreaH - insightBarH - BOTTOM_MARGIN;

  // Handle table splitting
  const estimatedH = calcTableHeight(rows, colW);
  if (estimatedH > maxTableH && rows.length > 1) {
    const chunks = splitTableRows(rows, colW, maxTableH);
    if (chunks.length > 1) {
      const bt = cleanPartTitle(data.title);
      chunks.forEach((chunk, idx) => {
        renderTabela(pptx, { ...data, title: `${bt} (Parte ${idx + 1})`, tableHeaders: headers, tableRows: chunk });
      });
      return;
    }
  }

  const slide = pptx.addSlide();
  slide.background = { color: C.BG_DARK };
  const contentY = renderContentHeader(slide, categoryLabel, titleText);

  // Gold underline beneath header area
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN_L, y: contentY - 0.05, w: SAFE_W, h: 0.025,
    fill: { color: C.GOLD },
  });

  // Build table data — minimal borders (thin horizontal lines only)
  const noBorder = { type: "none" as const, pt: 0, color: "000000" };
  const subtleLine = { type: "solid" as const, pt: 0.3, color: "2A3A4A" };
  const headerBorders = [noBorder, noBorder, subtleLine, noBorder]; // only bottom
  const rowBorders = [noBorder, noBorder, subtleLine, noBorder]; // only bottom
  const lastRowBorders = [noBorder, noBorder, noBorder, noBorder]; // no borders

  const tableData: any[][] = [];

  // Header row — gold text, no fill (transparent dark bg)
  tableData.push(headers.map((h) => ({
    text: h,
    options: {
      fontSize: 13, fontFace: FONT_BODY, bold: true, color: C.GOLD,
      fill: { type: "none" }, border: headerBorders,
      valign: "middle" as const, paraSpaceBefore: 6, paraSpaceAfter: 6,
    },
  })));

  // Data rows — cream text, transparent bg, subtle bottom line
  rows.forEach((row, ri) => {
    const isLast = ri === rows.length - 1;
    const dataRow = row.map((cell, ci) => ({
      text: cell,
      options: {
        fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_CREAM,
        bold: ci === 0,
        fill: { type: "none" },
        border: isLast ? lastRowBorders : rowBorders,
        valign: "middle" as const,
        paraSpaceBefore: 5, paraSpaceAfter: 5,
      },
    }));
    while (dataRow.length < colCount) {
      dataRow.push({
        text: "",
        options: { fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_CREAM, fill: { type: "none" }, border: isLast ? lastRowBorders : rowBorders, valign: "middle" as const, paraSpaceBefore: 5, paraSpaceAfter: 5 },
      });
    }
    tableData.push(dataRow);
  });

  const safeH = Math.min(estimatedH * 1.2 + 0.2, maxTableH);
  slide.addTable(tableData, {
    x: MARGIN_L, y: contentY, w: SAFE_W, h: safeH,
    colW, rowH: ROW_BASE_H, autoPage: false,
  });

  // Insight callout bar at bottom
  const calloutY = SLIDE_H - 0.55;
  const calloutH = 0.40;
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN_L, y: calloutY, w: SAFE_W, h: calloutH,
    fill: { color: C.BG_CALLOUT },
    rectRadius: 0.06,
  });
  // Teal left accent on callout
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN_L, y: calloutY + 0.06, w: 0.04, h: calloutH - 0.12,
    fill: { color: C.TEAL },
  });
  addTextSafe(slide, [
    { text: "💡 Insight: ", options: { bold: true, color: C.GOLD, fontSize: 11, fontFace: FONT_BODY } },
    { text: "Analise os dados acima e reflita sobre como se aplicam ao seu contexto profissional.", options: { color: C.TEXT_MUTED, fontSize: 11, fontFace: FONT_BODY, italic: true } },
  ], {
    x: MARGIN_L + 0.20, y: calloutY, w: SAFE_W - 0.40, h: calloutH,
    valign: "middle",
  });
}

// ──── RESUMO (Numbered takeaway cards + reflection callout) ────
function renderResumo(pptx: any, data: SlideData) {
  const items = (data.items || []).map((i) => sanitize(i)).filter(Boolean);
  if (!items.length) return;

  const categoryLabel = data.categoryLabel || "RESUMO DO MÓDULO";
  const titleText = cleanPartTitle(data.title);

  // Sanitize and split
  const sanitized = sanitizeBullets(items);
  const allBullets = sanitized.flatMap((text) => splitLongBulletText(text, 250));

  // For resumo, we render as numbered cards in a 2-column grid
  const slide = pptx.addSlide();
  slide.background = { color: C.BG_DARK };
  const contentY = renderContentHeader(slide, categoryLabel, titleText);

  const cols = 2;
  const gapX = 0.20;
  const gapY = 0.15;
  const cardW = (SAFE_W - gapX) / cols;
  const maxItems = Math.min(allBullets.length, 6);
  const rows = Math.ceil(maxItems / cols);
  const availH = SLIDE_H - contentY - 0.65 - BOTTOM_MARGIN; // reserve space for callout
  const cardH = Math.min((availH - (rows - 1) * gapY) / rows, 1.20);

  allBullets.slice(0, maxItems).forEach((bullet, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MARGIN_L + col * (cardW + gapX);
    const y = contentY + row * (cardH + gapY);

    if (y + cardH > SLIDE_H - 0.65) return;

    // Card background
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.BG_CARD },
      rectRadius: 0.06,
    });

    // Teal left border
    addCardBorder(slide, pptx, x, y, cardH);

    // Numbered circle
    const circleColor = ICON_COLORS[idx % ICON_COLORS.length];
    addIconCircle(slide, pptx, x + 0.15, y + 0.15, 0.34, circleColor, String(idx + 1));

    // Extract title from bullet (first sentence or before colon)
    const colonIdx = bullet.indexOf(":");
    let cardTitle = "";
    let cardBody = bullet;
    if (colonIdx > 2 && colonIdx < 60) {
      cardTitle = bullet.substring(0, colonIdx).trim();
      cardBody = bullet.substring(colonIdx + 1).trim();
    } else {
      // Use first ~5 words as title
      const words = bullet.split(/\s+/);
      if (words.length > 5) {
        cardTitle = words.slice(0, 5).join(" ");
        cardBody = words.slice(5).join(" ");
      }
    }

    const textX = x + 0.58;
    const textW = cardW - 0.72;
    let textY = y + 0.15;

    if (cardTitle) {
      addTextSafe(slide, cardTitle, {
        x: textX, y: textY, w: textW, h: 0.28,
        fontSize: 13, fontFace: FONT_BODY, color: C.TEXT_CREAM, bold: true,
      });
      textY += 0.30;
    }

    if (cardBody) {
      const bodyH = cardH - (textY - y) - 0.08;
      addTextSafe(slide, cardBody, {
        x: textX, y: textY, w: textW, h: Math.max(bodyH, 0.15),
        fontSize: 11, fontFace: FONT_BODY, color: C.TEXT_MUTED,
        valign: "top", lineSpacingMultiple: 1.2,
      });
    }
  });

  // Reflection callout bar at bottom
  const calloutY = SLIDE_H - 0.55;
  const calloutH = 0.40;
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN_L, y: calloutY, w: SAFE_W, h: calloutH,
    fill: { color: C.BG_CALLOUT },
    rectRadius: 0.06,
  });

  const reflectionText = data.description
    ? sanitize(data.description)
    : `Reflita: Como esses conceitos se aplicam à sua realidade profissional?`;
  addTextSafe(slide, reflectionText, {
    x: MARGIN_L + 0.20, y: calloutY, w: SAFE_W - 0.40, h: calloutH,
    fontSize: 11, fontFace: FONT_BODY, color: C.GOLD, italic: true,
    valign: "middle",
  });
}

// ──── ENCERRAMENTO ────
function renderEncerramento(pptx: any, courseTitle: string) {
  const slide = pptx.addSlide();
  slide.background = { color: C.BG_DARK };

  addTextSafe(slide, "Obrigado!", {
    x: 0.50, y: 1.2, w: SAFE_W, h: 1.5,
    fontSize: 52, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
    align: "center", valign: "middle",
  });

  // Gold separator
  slide.addShape(pptx.ShapeType.rect, {
    x: (SLIDE_W - 1.2) / 2, y: 2.75, w: 1.2, h: 0.04,
    fill: { color: C.GOLD },
  });

  addTextSafe(slide, sanitize(courseTitle), {
    x: 1, y: 3.0, w: 8, h: 0.6,
    fontSize: 18, fontFace: FONT_BODY, color: C.TEXT_MUTED, align: "center",
  });

  addTextSafe(slide, "Continue praticando  |  Acesse os materiais complementares", {
    x: 1, y: 3.8, w: 8, h: 0.4,
    fontSize: 14, fontFace: FONT_BODY, color: C.GOLD, align: "center",
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
    const { data: claimsData, error: claimsError } = await userClient.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.user.id;

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

    /* ─── Build PPTX ─── */
    const pptx = new PptxGenJS();
    pptx.author = "EduGen AI";
    pptx.title = course.title;
    pptx.subject = course.description || "";

    // Wrap addSlide to auto-increment audit counter
    const _origAddSlide = pptx.addSlide.bind(pptx);
    pptx.addSlide = (...args: any[]) => {
      auditNextSlide();
      return _origAddSlide(...args);
    };

    // 1. Cover
    renderCapa(pptx, {
      layout: "CAPA",
      title: course.title,
      description: course.description || "",
      moduleCount: modules.length,
    });

    // 2. Table of Contents
    const modulesSummary = modules.map((m: any, i: number) => {
      const rawTitle = sanitize(m.title || "");
      const shortTitle = rawTitle.replace(/^módulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;
      // Extract first sentence of content as description
      const firstSentence = sanitize((m.content || "").split(/[.!?]\s/)[0] || "").substring(0, 120);
      return { title: shortTitle, description: firstSentence };
    });

    renderTOC(pptx, {
      layout: "TOC",
      title: "O que você vai aprender",
      modules: modulesSummary,
    });

    // 3. Module slides
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

    // 4. Closing
    renderEncerramento(pptx, course.title);

    const totalSlides = allSlides.length + 3; // +3 for capa, toc, encerramento
    console.log(`PPTX generated: ${totalSlides} slides for ${modules.length} modules`);

    // Audit
    const audit = runAudit();
    if (!audit.passed) console.error(`PPTX Audit: ${audit.errors.length} violations`);
    console.log(`PPTX Audit: ${_auditLog.length} elements, ${audit.errors.length} errors, ${audit.warnings.length} warnings`);

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
