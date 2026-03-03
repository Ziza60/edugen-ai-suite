import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";

/**
 * REGRAS DE OURO — NUNCA VIOLAR:
 *
 * 1. NUNCA usar autoFit: true
 * 2. NUNCA usar altura fixa para caixas de conteúdo
 * 3. SEMPRE usar 1 textbox por seção (header + body), NUNCA 1 textbox por bullet
 * 4. SEMPRE calcular titleH dinamicamente
 * 5. SEMPRE posicionar com yCursor
 * 6. NUNCA x + w > SLIDE_W - MARGIN_R
 * 7. NUNCA y + h > SLIDE_H - BOTTOM_MARGIN
 *
 * Slide widescreen = 10.0 x 5.625 polegadas
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

// MARGINS — the golden rule: x + w <= SLIDE_W - MARGIN_R for ALL elements
const MARGIN_L = 0.50;
const MARGIN_R = 0.50;
const SAFE_W = SLIDE_W - MARGIN_L - MARGIN_R; // = 9.00

const HEADER_H = 0.70;
const CONTENT_START_Y = 0.95;
const BOTTOM_MARGIN = 0.30;
const MAX_CONTENT_H = SLIDE_H - CONTENT_START_Y - BOTTOM_MARGIN;

const BODY_FONT_PT = 15;
const HEADER_SECTION_PT = 14;

const TABLE_Y = 0.90;
const HEADER_ROW_H = 0.50;
const ROW_BASE_H = 0.45;
const CELL_LINE_H_IN = 0.22;

const MIN_BULLETS = 3;
const MAX_BULLETS = 6;

const SECTION_GAP = 0.15;

// 2-column layout derived from margins
const COL_GAP = 0.30;
const COL_W = (SAFE_W - COL_GAP) / 2; // = 4.35
const COL_LEFT_X = MARGIN_L;           // = 0.50
const COL_RIGHT_X = MARGIN_L + COL_W + COL_GAP; // = 5.15

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

// Audit log — collects all rendered elements for post-generation validation
const _auditLog: { slideLabel: string; x: number; y: number; w: number; h: number; origW: number; origH: number }[] = [];
let _auditSlideCounter = 0;

function auditNextSlide() { _auditSlideCounter++; }

function addTextSafe(slide: any, text: any, options: Record<string, unknown>) {
  const x = Number(options.x || 0);
  const y = Number(options.y || 0);
  const w = Number(options.w || 0);
  const h = Number(options.h || 0);
  // Clamp width: never exceed right margin
  const maxW = SLIDE_W - x - MARGIN_R;
  const safeW = Math.min(w, maxW);
  // Clamp height: never exceed bottom margin
  const maxH = SLIDE_H - y - 0.15;
  const safeH = Math.min(h, maxH);

  // Record to audit log (before clamping check)
  _auditLog.push({
    slideLabel: `Slide ${_auditSlideCounter}`,
    x, y, w: safeW, h: safeH,
    origW: w, origH: h,
  });

  if (safeW <= 0.1 || safeH <= 0.05) return;

  slide.addText(text, {
    ...options,
    x,
    y,
    w: safeW,
    h: safeH,
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

    if (right > SLIDE_W - 0.10) {
      errors.push(`${el.slideLabel}: overflow DIREITO (x+w=${right.toFixed(2)}in > ${(SLIDE_W - 0.10).toFixed(2)}in)`);
    }
    if (bottom > SLIDE_H - 0.10) {
      errors.push(`${el.slideLabel}: overflow INFERIOR (y+h=${bottom.toFixed(2)}in > ${(SLIDE_H - 0.10).toFixed(2)}in)`);
    }
    if (el.x < 0) {
      errors.push(`${el.slideLabel}: x negativo (${el.x})`);
    }
    if (el.y < 0) {
      errors.push(`${el.slideLabel}: y negativo (${el.y})`);
    }
    // Warn if clamping changed the original dimensions significantly
    if (el.origW - el.w > 0.1) {
      warnings.push(`${el.slideLabel}: largura clampada de ${el.origW.toFixed(2)} para ${el.w.toFixed(2)}in`);
    }
    if (el.origH - el.h > 0.1) {
      warnings.push(`${el.slideLabel}: altura clampada de ${el.origH.toFixed(2)} para ${el.h.toFixed(2)}in`);
    }
  }

  const passed = errors.length === 0;
  if (passed) {
    console.log(`✅ PPTX Audit PASSED — ${_auditLog.length} elements checked, 0 overflow errors`);
  } else {
    console.error(`❌ PPTX Audit FAILED — ${errors.length} errors, ${warnings.length} warnings`);
    errors.forEach(e => console.error(`  ❌ ${e}`));
  }
  if (warnings.length > 0) {
    warnings.forEach(w => console.warn(`  ⚠️ ${w}`));
  }

  return { passed, errors, warnings };
}

/* ═══════════════════════════════════════════════════════
   DYNAMIC HEIGHT HELPERS
   ═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   BULLET SANITIZATION — merges truncated bullets
   ═══════════════════════════════════════════════════════ */

function sanitizeBullets(bullets: string[]): string[] {
  if (!bullets || bullets.length === 0) return [];
  const result: string[] = [];
  let buffer = '';

  for (const raw of bullets) {
    const text = (raw || '').trim();
    if (!text) continue;

    // Accumulate in buffer
    buffer = buffer ? buffer + ' ' + text : text;

    // Bullet is complete if it ends with terminal punctuation (accounting for quotes/parens)
    const complete = /[.!?](\s*["')])?$/.test(buffer) || buffer.length > 220;

    if (complete) {
      if (!/[.!?]$/.test(buffer.replace(/["')]\s*$/, ''))) buffer += '.';
      result.push(buffer.trim());
      buffer = '';
    }
  }
  // Flush remaining buffer (last incomplete sentence)
  if (buffer.trim()) {
    if (!/[.!?]$/.test(buffer.trim())) buffer = buffer.trim() + '.';
    result.push(buffer.trim());
  }
  return result;
}

/* ═══════════════════════════════════════════════════════
   CONSERVATIVE HEIGHT — bullet-count based (not char estimation)
   ═══════════════════════════════════════════════════════ */

const BULLET_H_SHORT = 0.52;   // bullets <= 80 chars (1 line) — increased for real PPT rendering
const BULLET_H_LONG  = 0.90;   // bullets 81-160 chars (2 lines) — increased for line-wrap headroom
const BULLET_H_XLONG = 1.20;   // bullets > 160 chars (3 lines) — increased for safety
const MAX_BULLETS_PER_SLIDE = 5;
// Used by splitOrMergeSlides when splitting bullet-heavy slides
const MAX_CONTENT_H_FOR_SPLIT = SLIDE_H - (HEADER_H + 0.25) - BOTTOM_MARGIN;

function getBulletHeight(text: string): number {
  const len = (text || '').length;
  if (len <= 80) return BULLET_H_SHORT;
  if (len <= 160) return BULLET_H_LONG;
  return BULLET_H_XLONG;
}

function calcBulletsHeight(bullets: string[]): number {
  return bullets.reduce((sum, b) => sum + getBulletHeight(b), 0);
}

/** Split bullets into groups guaranteed to fit on a slide */
function splitBulletsToFit(bullets: string[], maxH: number): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let currentH = 0;

  for (const bullet of bullets) {
    const itemH = getBulletHeight(bullet);
    if (current.length >= MAX_BULLETS_PER_SLIDE ||
        (current.length > 0 && currentH + itemH > maxH - 0.15)) {
      groups.push([...current]);
      current = [bullet];
      currentH = itemH;
    } else {
      current.push(bullet);
      currentH += itemH;
    }
  }
  if (current.length > 0) groups.push(current);

  // CAUSA #1 balance: merge last group if it has only 1 item and previous group has room
  if (groups.length >= 2) {
    const last = groups[groups.length - 1];
    const prev = groups[groups.length - 2];
    if (last.length === 1 && prev.length < MAX_BULLETS_PER_SLIDE) {
      const lastH = getBulletHeight(last[0]);
      const prevH = calcBulletsHeight(prev);
      if (prevH + lastH <= maxH) {
        prev.push(last[0]);
        groups.pop();
      }
    }
  }

  return groups;
}

// Legacy estimateTextHeight kept for non-bullet uses (titles, headers)
function estimateTextHeight(text: string, fontSizePt: number, widthInInches: number): number {
  const clean = sanitize(text || "");
  if (!clean) return 0;
  const charsPerInch = Math.max(5, 120 / fontSizePt);
  const charsPerLine = Math.max(15, Math.floor(widthInInches * charsPerInch));
  const paragraphs = clean.split("\n").filter(Boolean);
  let totalLines = 0;
  for (const para of paragraphs) {
    totalLines += Math.max(1, Math.ceil(para.length / charsPerLine));
  }
  const lineHeightIn = (fontSizePt * 1.2) / 72;
  return totalLines * lineHeightIn + 0.08;
}

function getTitleHeight(titleText: string, boxWidthIn: number, fontSizePt: number): number {
  const charsPerLine = Math.floor(boxWidthIn * 5.5);
  const lines = Math.max(1, Math.ceil(titleText.length / Math.max(1, charsPerLine)));
  const lineHeightIn = (fontSizePt * 1.25) / 72;
  return Math.max(0.70, lines * lineHeightIn + 0.20);
}

function getHeaderTitleFontSize(titleText: string): number {
  const len = sanitize(removePartSuffix(deduplicateTitle(titleText || ""))).length;
  if (len > 110) return 16;
  if (len > 90) return 18;
  if (len > 72) return 20;
  return 24;
}

function getHeaderHeight(titleText: string): number {
  const fs = getHeaderTitleFontSize(titleText);
  const titleH = getTitleHeight(titleText, SAFE_W, fs);
  return Math.max(HEADER_H, Math.min(1.15, titleH + 0.18));
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

/* ═══════════════════════════════════════════════════════
   CONTENT SECTION MODEL
   ═══════════════════════════════════════════════════════ */

interface ContentSection {
  header: string | null;
  bullets: string[];
  totalHeight: number;
}

function estimateSectionHeight(header: string | null, bullets: string[], widthIn: number, bodyFontPt = BODY_FONT_PT): number {
  let h = 0;
  if (header) {
    h += estimateTextHeight(header, HEADER_SECTION_PT, widthIn) + 0.06;
  }
  if (bullets.length > 0) {
    // Use conservative bullet-count-based heights
    h += calcBulletsHeight(bullets);
  }
  return h;
}

function groupIntoSections(items: string[]): ContentSection[] {
  const sections: ContentSection[] = [];
  let curHeader: string | null = null;
  let curBullets: string[] = [];

  const flush = () => {
    if (curBullets.length > 0 || curHeader) {
      sections.push({
        header: curHeader,
        bullets: [...curBullets],
        totalHeight: estimateSectionHeight(curHeader, curBullets, SAFE_W),
      });
      curBullets = [];
      curHeader = null;
    }
  };

  for (const raw of items) {
    const clean = sanitize(raw);
    if (!clean) continue;
    const isSubHeader = /^.+:\s*$/.test(clean) && clean.length <= 70;
    if (isSubHeader) {
      flush();
      curHeader = clean;
    } else {
      const chunks = splitLongBulletText(clean, 180);
      curBullets.push(...chunks);
    }
  }
  flush();
  return sections;
}

function paginateSections(sections: ContentSection[], maxH: number): ContentSection[][] {
  // Filter out header-only sections with no bullets (they create empty slides)
  const validSections = sections.filter(s => s.bullets.length > 0);
  if (validSections.length === 0) return [];

  // Use actual maxH — BULLET_H constants already include headroom, no 0.85 factor needed
  const pages: ContentSection[][] = [];
  let currentPage: ContentSection[] = [];
  let currentH = 0;
  let currentBulletCount = 0;

  for (const sec of validSections) {
    const secBulletCount = sec.bullets.length;
    // Break page if height overflows OR bullet count exceeds MAX_BULLETS_PER_SLIDE
    if (currentPage.length > 0 &&
        (currentH + sec.totalHeight > maxH - 0.10 || currentBulletCount + secBulletCount > MAX_BULLETS_PER_SLIDE)) {
      pages.push(currentPage);
      currentPage = [sec];
      currentH = sec.totalHeight + SECTION_GAP;
      currentBulletCount = secBulletCount;
    } else {
      currentPage.push(sec);
      currentH += sec.totalHeight + SECTION_GAP;
      currentBulletCount += secBulletCount;
    }
  }
  if (currentPage.length > 0) pages.push(currentPage);
  // Filter out any empty pages to prevent empty slide creation
  return pages.filter(p => p.length > 0 && p.some(s => s.bullets.length > 0));
}

/* ═══════════════════════════════════════════════════════
   SINGLE-TEXTBOX RENDERERS (ANTI-OVERLAP)
   ═══════════════════════════════════════════════════════ */

function renderSectionsInArea(
  slide: any,
  sections: ContentSection[],
  x: number,
  startY: number,
  w: number,
  maxY: number,
) {
  let yCursor = startY;
  // Clamp w to never exceed right margin
  const safeW = Math.min(w, SLIDE_W - x - MARGIN_R);

  for (const sec of sections) {
    if (sec.header) {
      const headerH = estimateTextHeight(sec.header, HEADER_SECTION_PT, safeW);
      if (yCursor + headerH > maxY) break;
      addTextSafe(slide, sec.header, {
        x, y: yCursor, w: safeW, h: headerH,
        fontSize: HEADER_SECTION_PT, fontFace: FONT, color: C.PRIMARY,
        bold: true, valign: "top", lineSpacingMultiple: 1.15,
      });
      yCursor += headerH + 0.06;
    }

    if (sec.bullets.length > 0) {
      const cleanBullets = sanitizeBullets(sec.bullets);
      const textParts: any[] = [];
      cleanBullets.forEach((bullet, idx) => {
        const isLast = idx === cleanBullets.length - 1;
        textParts.push(
          { text: "●  ", options: { color: C.MEDIUM, bold: true, fontSize: BODY_FONT_PT, fontFace: FONT, breakLine: false } },
          { text: bullet.trim() + (isLast ? "" : "\n"), options: { color: C.TEXT_BODY, fontSize: BODY_FONT_PT, fontFace: FONT, breakLine: !isLast } }
        );
      });

      const bodyH = calcBulletsHeight(cleanBullets);
      if (yCursor + bodyH > maxY) break;

      addTextSafe(slide, textParts, {
        x, y: yCursor, w: safeW, h: bodyH,
        valign: "top", paraSpaceAfter: 3, lineSpacingMultiple: 1.1,
      });
      yCursor += bodyH + SECTION_GAP;
    }
  }
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
   HELPERS
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

function cleanPartTitle(title: string): string {
  return removePartSuffix(deduplicateTitle(title));
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
      // Use balanced split: never create a part with fewer than 2 bullets
      const groups = splitBulletsToFit(finalBullets, MAX_CONTENT_H_FOR_SPLIT);
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

/* ═══════════════════════════════════════════════════════
   VALIDATION
   ═══════════════════════════════════════════════════════ */

function validateBeforeRender(slides: RawSlide[]): RawSlide[] {
  return slides.filter((slide) => {
    const bullets = slide.bullets || [];
    const content = slide.content || "";
    // Accept 1+ bullets (single bullets will be merged by splitOrMergeSlides if needed)
    const hasContent = bullets.length >= 1 || content.length >= 50 || slide.isTable;
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
      slides.push({ layout: "TABELA", title: raw.title, tableHeaders: raw.headers, tableRows: raw.rows });
      continue;
    }

    const items = raw.bullets || [];
    if (items.length === 0) continue;

    const isParallel = detectParallel(items);
    slides.push({ layout: isParallel ? "CARDS_GRID" : "BULLETS", title: raw.title, items: sanitizeBullets(items) });
  }

  if (resumoItems.length > 0) {
    slides.push({ layout: "RESUMO", title: "Resumo", subtitle: moduleTitle, items: sanitizeBullets(resumoItems.slice(0, 6).map(sanitize)) });
  }

  return slides;
}

/* ═══════════════════════════════════════════════════════
   FINAL QUALITY PASS
   ═══════════════════════════════════════════════════════ */

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
  // CAUSA #3: Try fitting ALL rows in 1 slide first
  if (calcTableHeight(rows, colWidths) <= maxTableH) {
    return [rows]; // fits in one slide — DO NOT SPLIT
  }

  // Split by adding rows until height limit
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
   SLIDE RENDERERS
   ═══════════════════════════════════════════════════════ */

/** Render the header bar (dark background + title) — returns the header height */
function renderHeaderBar(pptx: any, slide: any, titleText: string): number {
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

  return headerH;
}

// Layout 1 — CAPA
function renderCapa(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.PRIMARY };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.12, h: SLIDE_H,
    fill: { color: C.ACCENT },
  });

  const titleX = 0.70;
  const titleW = SLIDE_W - titleX - MARGIN_R; // 10.0 - 0.70 - 0.50 = 8.80
  const titleH = getTitleHeight(data.title, titleW, 44);
  addTextSafe(slide, data.title, {
    x: titleX, y: 0.8, w: titleW, h: titleH,
    fontSize: 44, fontFace: FONT, color: C.WHITE, bold: true,
    align: "left", valign: "middle",
  });

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

// Layout 2 — ABERTURA DE MÓDULO
function renderAberturaModulo(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.PRIMARY };

  const badgeY = 0.35;
  const badgeH = 0.38;
  if (data.subtitle) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: MARGIN_L, y: badgeY, w: 1.6, h: badgeH,
      fill: { color: C.ACCENT }, rectRadius: 0.08,
    });
    addTextSafe(slide, data.subtitle.toUpperCase(), {
      x: MARGIN_L, y: badgeY, w: 1.6, h: badgeH,
      fontSize: 13, fontFace: FONT, color: C.PRIMARY, bold: true,
      align: "center", valign: "middle",
    });
  }

  const titleY = 0.90;
  const titleH = getTitleHeight(data.title, SAFE_W, 32);
  addTextSafe(slide, data.title, {
    x: MARGIN_L, y: titleY, w: SAFE_W, h: titleH,
    fontSize: 32, fontFace: FONT, color: C.WHITE, bold: true, valign: "top",
  });

  if (data.items && data.items.length > 0) {
    const labelY = titleY + titleH + 0.15;
    const labelH = 0.30;
    addTextSafe(slide, "Objetivos", {
      x: MARGIN_L, y: labelY, w: 3, h: labelH,
      fontSize: 14, fontFace: FONT, color: C.ACCENT, bold: true,
    });

    const objectivesY = labelY + labelH + 0.06;
    const maxY = SLIDE_H - BOTTOM_MARGIN;
    const objItems = (data.items || []).map((item) => sanitize(item)).filter(Boolean).slice(0, 6).flatMap((item) => splitLongBulletText(item, 150));

    const textParts: any[] = [];
    objItems.forEach((item, idx) => {
      const isLast = idx === objItems.length - 1;
      textParts.push(
        { text: "✓  ", options: { color: C.ACCENT, bold: true, fontSize: 14, fontFace: FONT, breakLine: false } },
        { text: item + (isLast ? "" : "\n"), options: { color: C.WHITE, fontSize: 14, fontFace: FONT, breakLine: !isLast } }
      );
    });

    const objH = estimateTextHeight(objItems.join("\n"), 14, SAFE_W - 0.3) + (objItems.length * 4) / 72;
    const clampedH = Math.min(objH, maxY - objectivesY);
    if (clampedH > 0.2) {
      addTextSafe(slide, textParts, {
        x: MARGIN_L, y: objectivesY, w: SAFE_W, h: clampedH,
        valign: "top", paraSpaceAfter: 4, lineSpacingMultiple: 1.15,
      });
    }
  }
}

// Layout 3 — CONTEÚDO COM BULLETS (LAYOUT ADAPTATIVO + PAGINAÇÃO COMPLETA)
function renderBullets(pptx: any, data: SlideData) {
  const allBullets = (data.items || []).map((b) => sanitize(b)).filter(Boolean);
  if (allBullets.length === 0) return;

  const baseTitle = cleanPartTitle(data.title);
  const sections = groupIntoSections(allBullets);

  // Calculate available content area
  const baseHeaderH = getHeaderHeight(baseTitle);
  const contentStartY = baseHeaderH + 0.25;
  const maxContentH = SLIDE_H - contentStartY - BOTTOM_MARGIN;

  // Always paginate first — this guarantees no empty pages are created
  const pages = paginateSections(sections, maxContentH);
  if (pages.length === 0) return;

  pages.forEach((pageSections, idx) => {
    // Guard: skip pages that somehow have no bullets after filtering
    const hasBullets = pageSections.some(s => s.bullets.length > 0);
    if (!hasBullets) return;

    const suffix = pages.length > 1 ? ` (Parte ${idx + 1})` : "";
    const titleText = deduplicateTitle(baseTitle + suffix);

    // Try 2-column layout only when exactly 2 valid sections and both are not too tall
    if (pageSections.length === 2 &&
        pageSections[0].bullets.length > 0 &&
        pageSections[1].bullets.length > 0) {
      const s0H = estimateSectionHeight(pageSections[0].header, pageSections[0].bullets, COL_W);
      const s1H = estimateSectionHeight(pageSections[1].header, pageSections[1].bullets, COL_W);
      if (s0H <= maxContentH && s1H <= maxContentH) {
        const slide = pptx.addSlide();
        slide.background = { color: C.BG_LIGHT };
        const headerH = renderHeaderBar(pptx, slide, titleText);
        const cStartY = headerH + 0.25;
        const colMaxY = SLIDE_H - BOTTOM_MARGIN;
        renderSectionsInArea(slide, [pageSections[0]], COL_LEFT_X, cStartY, COL_W, colMaxY);
        renderSectionsInArea(slide, [pageSections[1]], COL_RIGHT_X, cStartY, COL_W, colMaxY);
        return;
      }
    }

    // Full-width single slide
    const slide = pptx.addSlide();
    slide.background = { color: C.BG_LIGHT };
    const headerH = renderHeaderBar(pptx, slide, titleText);
    const maxY = SLIDE_H - BOTTOM_MARGIN;
    renderSectionsInArea(slide, pageSections, MARGIN_L, headerH + 0.25, SAFE_W, maxY);
  });
}

// Layout 4 — CARDS EM GRID
function groupCardsIntoSlides(cards: string[]): string[][] {
  const total = cards.length;
  if (total === 0) return [];
  if (total <= 4) return [cards];
  if (total === 5) return [cards.slice(0, 3), cards.slice(3)];
  if (total === 6) return [cards.slice(0, 3), cards.slice(3)];
  // 7+ cards: balanced groups, minimum 2 per slide
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

  if (allItems.length <= 2) {
    renderBullets(pptx, { ...data, layout: "BULLETS" });
    return;
  }

  // CAUSA #2: Separate intro paragraphs (no colon title AND >80 chars) from real cards
  const introItems: string[] = [];
  const cardItems: string[] = [];

  for (const item of allItems) {
    const colonIdx = item.indexOf(":");
    const hasTitle = colonIdx > 2 && colonIdx < 50;
    const isLongParagraph = !hasTitle && item.length > 80;

    if (isLongParagraph) {
      introItems.push(item);
    } else {
      cardItems.push(item);
    }
  }

  // If no real card items left, fall back to bullets
  if (cardItems.length <= 2) {
    renderBullets(pptx, { ...data, layout: "BULLETS" });
    return;
  }

  const baseTitle = cleanPartTitle(data.title);
  const cols = 2;
  const gapY = 0.2;
  const gapX = 0.30;
  const cardW = (SAFE_W - gapX) / cols;
  const maxCardH = 1.4;

  // Calculate intro height for first page
  const introText = introItems.map(i => sanitize(i)).join(' ');

  // CAUSA #1: Use balanced grouping instead of mechanical slice
  const groups = groupCardsIntoSlides(cardItems);

  groups.forEach((pageItems, pageIdx) => {
    const suffix = groups.length > 1 ? ` (Parte ${pageIdx + 1})` : "";
    const titleText = deduplicateTitle(baseTitle + suffix);

    const slide = pptx.addSlide();
    slide.background = { color: C.BG_LIGHT };
    const hH = renderHeaderBar(pptx, slide, titleText);

    let gTop = hH + 0.3;

    // Render intro text ABOVE the grid on first page only
    if (pageIdx === 0 && introItems.length > 0) {
      const introTextClean = sanitize(introText);
      const lines = Math.max(1, Math.ceil(introTextClean.length / 90));
      const introRenderH = lines * 0.32 + 0.10;
      addTextSafe(slide, introTextClean, {
        x: MARGIN_L, y: gTop, w: SAFE_W, h: introRenderH,
        fontSize: 13, fontFace: FONT, color: C.TEXT_SEC, italic: true,
        valign: "top",
      });
      gTop += introRenderH + 0.15;
    }

    const gHAvail = SLIDE_H - gTop - BOTTOM_MARGIN;
    const rows = Math.ceil(pageItems.length / cols);
    const cardH = Math.min((gHAvail - (rows - 1) * gapY) / rows, maxCardH);

    pageItems.forEach((item, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = MARGIN_L + col * (cardW + gapX);
      const y = gTop + row * (cardH + gapY);

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
      // CAUSA #2: Always handle title as string, never undefined
      const cardTitle = (colonIdx > 2 && colonIdx < 50) ? item.substring(0, colonIdx).trim() : '';
      const cardBody = cardTitle ? item.substring(colonIdx + 1).trim() : item.trim();

      let textY = y + 0.1;

      if (cardTitle) {
        addTextSafe(slide, cardTitle, {
          x: x + 0.2, y: textY, w: cardContentW, h: 0.28,
          fontSize: 14, fontFace: FONT, color: C.PRIMARY, bold: true, valign: "top",
        });
        textY += 0.30;
      }

      if (cardBody) {
        const bodyH = cardH - (textY - y) - 0.10;
        addTextSafe(slide, cardBody, {
          x: x + 0.2, y: textY, w: cardContentW, h: Math.max(bodyH, 0.20),
          fontSize: 13, fontFace: FONT, color: C.TEXT_BODY, valign: "top",
        });
      }
    });
  });
}

// Layout 5 — TABELA COMPARATIVA
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
  slide.background = { color: C.BG_LIGHT };
  const hH = renderHeaderBar(pptx, slide, titleText);

  const borderStyle = { type: "solid" as const, pt: 1, color: C.TABLE_BORDER };
  const borders = [borderStyle, borderStyle, borderStyle, borderStyle];
  const tableData: any[][] = [];

  tableData.push(headers.map((h) => ({
    text: h,
    options: {
      fontSize: 14, fontFace: FONT, bold: true, color: C.WHITE,
      fill: { color: C.PRIMARY }, border: borders,
      valign: "middle" as const, paraSpaceBefore: 4, paraSpaceAfter: 4,
    },
  })));

  rows.forEach((row, ri) => {
    const dataRow = row.map((cell, ci) => ({
      text: cell,
      options: {
        fontSize: 13, fontFace: FONT, color: C.TEXT_BODY,
        bold: ci === 0,
        fill: ri % 2 === 1 ? { color: C.TABLE_ALT } : { color: C.WHITE },
        border: borders, valign: "middle" as const,
        paraSpaceBefore: 3, paraSpaceAfter: 3,
      },
    }));

    while (dataRow.length < colCount) {
      dataRow.push({
        text: "",
        options: { fontSize: 13, fontFace: FONT, color: C.TEXT_BODY, valign: "middle" as const, paraSpaceBefore: 3, paraSpaceAfter: 3 },
      });
    }

    tableData.push(dataRow);
  });

  const safeH = Math.min(estimatedH * 1.25 + 0.3, maxTableH);
  const tableY = hH + 0.2;
  slide.addTable(tableData, {
    x: MARGIN_L, y: tableY, w: SAFE_W, h: safeH,
    colW, rowH: ROW_BASE_H, autoPage: false,
    newSlideStartY: tableY, newSlideStopY: SLIDE_H - BOTTOM_MARGIN,
  });
}

// Layout 6 — RESUMO
function renderResumo(pptx: any, data: SlideData) {
  const items = (data.items || []).map((i) => sanitize(i)).filter(Boolean);
  if (!items.length) return;

  const baseTitle = cleanPartTitle(data.subtitle || data.title);
  const titleH = getTitleHeight(baseTitle, SAFE_W - 0.08, 24);
  const titleY = 0.7;
  const bulletsY = titleY + titleH + 0.15;
  const summaryMaxH = SLIDE_H - bulletsY - BOTTOM_MARGIN;

  // Apply sanitizeBullets to merge truncated bullets, then split long ones
  const sanitized = sanitizeBullets(items);
  const allBullets = sanitized.flatMap((text) => splitLongBulletText(text, 250));

  // Use conservative bullet-count split instead of imprecise estimation
  const bulletGroups = splitBulletsToFit(allBullets, summaryMaxH);

  bulletGroups.forEach((pageBullets, idx) => {
    const suffix = bulletGroups.length > 1 ? ` (Parte ${idx + 1})` : "";
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
      fontSize: 24, fontFace: FONT, color: C.PRIMARY, bold: true, valign: "top",
    });

    const textParts: any[] = [];
    pageBullets.forEach((bullet, bIdx) => {
      const isLast = bIdx === pageBullets.length - 1;
      textParts.push(
        { text: "✓  ", options: { color: C.ACCENT, bold: true, fontSize: 14, fontFace: FONT, breakLine: false } },
        { text: bullet + (isLast ? "" : "\n"), options: { color: C.TEXT_BODY, fontSize: 14, fontFace: FONT, breakLine: !isLast } }
      );
    });

    const bodyH = calcBulletsHeight(pageBullets);
    const clampedH = Math.min(bodyH, SLIDE_H - bulletsY - BOTTOM_MARGIN);

    if (clampedH > 0.2) {
      addTextSafe(slide, textParts, {
        x: MARGIN_L, y: bulletsY, w: SAFE_W - 0.08, h: clampedH,
        valign: "top", paraSpaceAfter: 3, lineSpacingMultiple: 1.1,
      });
    }
  });
}

// SLIDE FINAL
function renderEncerramento(pptx: any, courseTitle: string) {
  const slide = pptx.addSlide();
  slide.background = { color: C.PRIMARY };

  addTextSafe(slide, "Obrigado!", {
    x: 0.50, y: 1.0, w: SAFE_W, h: 1.8,
    fontSize: 52, fontFace: FONT, color: C.WHITE, bold: true,
    align: "center", valign: "middle",
  });

  addTextSafe(slide, sanitize(courseTitle), {
    x: 1, y: 3.0, w: 8, h: 0.7,
    fontSize: 18, fontFace: FONT, color: C.LIGHT_BLUE, align: "center",
  });

  addTextSafe(slide, "Continue praticando  |  Acesse os materiais complementares", {
    x: 1, y: 4.0, w: 8, h: 0.4,
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

    // ═══ AUDIT CHECKLIST — runs after every generation ═══
    const audit = runAudit();
    if (!audit.passed) {
      console.error(`PPTX Audit: ${audit.errors.length} bound violations detected. Details above.`);
    }
    console.log(`PPTX Audit summary: ${_auditLog.length} elements, ${audit.errors.length} errors, ${audit.warnings.length} warnings`);

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
