import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";

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
const SLIDE_W = 10;
const SLIDE_H = 5.625;
const MX = 0.6;
const MY = 0.6;
const CONTENT_W = SLIDE_W - MX * 2;

const HEADER_H = 0.70;
const CONTENT_Y = 0.95;
const MARGIN_BOTTOM = 0.20;
const MAX_CONTENT_H = SLIDE_H - CONTENT_Y - MARGIN_BOTTOM;

const FONT_SIZE_PT = 16;
const LINE_HEIGHT_IN = (FONT_SIZE_PT * 1.4) / 72;
const PARA_SPACE_IN = 10 / 72;
const CHARS_PER_LINE = 85;

const TABLE_Y = 0.90;
const HEADER_ROW_H = 0.45;
const ROW_BASE_H = 0.45;
const CELL_LINE_H_IN = 0.22;
const MAX_TABLE_H = SLIDE_H - TABLE_Y - 0.15;

const MIN_BULLETS = 3;
const MAX_BULLETS = 5;
const MAX_CHARS = 900;

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
   BULLET TEXT ARRAY BUILDER (FIX FOR BUG #1 & #4)
   Each bullet is a separate text object with breakLine: true
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

function addTextSafe(slide: any, text: any, options: Record<string, unknown>) {
  slide.addText(text, {
    autoFit: false,
    overflow: "clip",
    ...options,
  });
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

    // Markdown table
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

    // Heading
    if (/^#{1,6}\s/.test(trimmed)) {
      flushBullets();
      curHeading = sanitize(trimmed.replace(/^#{1,6}\s*/, ""));
      continue;
    }

    // Bullet / numbered list
    if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      const raw = trimmed.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "");
      const clean = sanitize(raw);
      if (clean.length > 3) curBullets.push(clean);
      continue;
    }

    // Plain text as bullet
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
   HELPERS FOR MERGE/SPLIT (BUG #2 & #3)
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
   PARAGRAPH → BULLETS CONVERSION (BUG #3)
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
    // Break paragraph into sentence-bullets
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
   SPLIT/MERGE ALGORITHM (BUG #2)
   ═══════════════════════════════════════════════════════ */

function splitOrMergeSlides(rawSlides: RawSlide[]): RawSlide[] {
  const result: RawSlide[] = [];

  for (let i = 0; i < rawSlides.length; i++) {
    let slide = rawSlides[i];

    // Prepend bullets from previous slide marked mergeWithNext
    if (slide.prependBullets) {
      slide.bullets = [...slide.prependBullets, ...slide.bullets];
      delete slide.prependBullets;
    }

    const bullets = slide.bullets || [];

    // CASE 1: Slide with < MIN_BULLETS → try merge with previous
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
      // If can't merge back and < 2 bullets, push forward
      if (bullets.length < 2 && i + 1 < rawSlides.length && !rawSlides[i + 1].isTable) {
        rawSlides[i + 1].prependBullets = bullets;
        continue;
      }
    }

    // Handle mergeWithNext flag (single paragraph)
    if (slide.mergeWithNext && i + 1 < rawSlides.length && !rawSlides[i + 1].isTable) {
      const content = slide.content || (slide.bullets || []).join(". ");
      if (content) {
        if (!rawSlides[i + 1].prependBullets) rawSlides[i + 1].prependBullets = [];
        rawSlides[i + 1].prependBullets!.push(content);
      }
      continue;
    }

    const finalBullets = slide.bullets || bullets;

    // CASE 2: Slide with > MAX_BULLETS → split evenly
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
   VALIDATION: discard slides with insufficient content
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

  // 1) ABERTURA_MODULO
  slides.push({
    layout: "ABERTURA_MODULO",
    title: moduleTitle,
    subtitle: moduleLabel,
    items: objItems.slice(0, 4).map(sanitize),
    moduleIndex: modIndex,
  });

  // 2) Build raw slides from content blocks
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
      // Might be a paragraph-only block; mark as content
      const blockContent = block.items.join(" ").trim();
      if (blockContent.length > 30) {
        rawSlides.push({ title: heading, bullets: [], content: sanitize(blockContent) });
      }
      continue;
    }

    rawSlides.push({ title: heading, bullets: items });
  }

  // Process paragraphs into bullets (Bug #3)
  const processed = rawSlides.map(processSlideContent);

  // Split/merge for balanced content (Bug #2)
  const balanced = splitOrMergeSlides(processed);

  // Validate
  const validated = validateBeforeRender(balanced);

  // Convert to SlideData
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

  // 3) Resumo slide
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

    const bulletCount = slide.items?.length || 0;

    // Merge thin slides into previous bullet/resumo slide
    if (bulletCount > 0 && bulletCount < MIN_BULLETS) {
      const prev = result.length > 0 ? result[result.length - 1] : null;
      if (prev && (prev.layout === "BULLETS" || prev.layout === "RESUMO") && prev.items) {
        const merged = [...prev.items, ...(slide.items || [])];
        if (merged.length <= MAX_BULLETS + 1 && merged.reduce((s, b) => s + b.length, 0) <= MAX_CHARS + 100) {
          prev.items = merged;
          continue;
        }
      }
    }

    result.push(slide);
  }

  // Final sanitization pass
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
   RENDER HELPERS (DYNAMIC HEIGHT / SPLIT)
   ═══════════════════════════════════════════════════════ */

function estimateTextLines(text: string, charsPerLine: number): number {
  const clean = sanitize(text || "");
  return Math.max(1, Math.ceil(clean.length / Math.max(1, charsPerLine)));
}

function estimateBulletHeight(item: string, fontSize = FONT_SIZE_PT, charsPerLine = CHARS_PER_LINE): number {
  const lines = estimateTextLines(item, charsPerLine);
  const lineHeight = (fontSize * 1.4) / 72;
  return (lines * lineHeight) + PARA_SPACE_IN;
}

function estimateContentHeight(items: string[], fontSize = FONT_SIZE_PT, charsPerLine = CHARS_PER_LINE): number {
  return items.reduce((sum, bullet) => sum + estimateBulletHeight(bullet, fontSize, charsPerLine), 0);
}

function shouldSplitByHeight(items: string[], maxHeight: number, fontSize = FONT_SIZE_PT, charsPerLine = CHARS_PER_LINE): boolean {
  return estimateContentHeight(items, fontSize, charsPerLine) > maxHeight;
}

function splitItemsByHeight(items: string[], maxHeight: number, fontSize = FONT_SIZE_PT, charsPerLine = CHARS_PER_LINE): [string[], string[]] {
  if (items.length <= 1) return [items, []];

  const target = estimateContentHeight(items, fontSize, charsPerLine) / 2;
  const first: string[] = [];
  let acc = 0;

  for (let i = 0; i < items.length; i++) {
    const h = estimateBulletHeight(items[i], fontSize, charsPerLine);
    const remaining = items.length - i;
    if (first.length > 0 && acc + h > target && remaining >= 1) break;
    first.push(items[i]);
    acc += h;
  }

  if (first.length === 0) first.push(items[0]);
  if (first.length >= items.length) {
    const mid = Math.ceil(items.length / 2);
    return [items.slice(0, mid), items.slice(mid)];
  }

  return [first, items.slice(first.length)];
}

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

// Layout 1 — CAPA
function renderCapa(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.PRIMARY };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.12, h: SLIDE_H,
    fill: { color: C.ACCENT },
  });

  addTextSafe(slide, data.title, {
    x: 0.8, y: 0.8, w: 8.4, h: 2.4,
    fontSize: 44, fontFace: FONT, color: C.WHITE, bold: true,
    align: "left", valign: "middle",
  });

  if (data.description) {
    addTextSafe(slide, sanitize(data.description), {
      x: 0.8, y: 3.3, w: 7.6, h: 1.0,
      fontSize: 18, fontFace: FONT, color: C.LIGHT_BLUE, align: "left", valign: "top",
    });
  }

  const d = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const footerParts = [];
  if (data.moduleCount) footerParts.push(`${data.moduleCount} módulos`);
  footerParts.push(d);
  addTextSafe(slide, footerParts.join("  •  "), {
    x: 0.8, y: 4.8, w: 8.4, h: 0.4,
    fontSize: 12, fontFace: FONT, color: C.TEXT_SEC, align: "left",
  });
}

// Layout 2 — ABERTURA DE MÓDULO
function renderAberturaModulo(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.PRIMARY };

  if (data.subtitle) {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.6, y: 0.6, w: 1.6, h: 0.38,
      fill: { color: C.ACCENT },
      rectRadius: 0.08,
    });
    addTextSafe(slide, data.subtitle.toUpperCase(), {
      x: 0.6, y: 0.6, w: 1.6, h: 0.38,
      fontSize: 13, fontFace: FONT, color: C.PRIMARY, bold: true,
      align: "center", valign: "middle",
    });
  }

  addTextSafe(slide, data.title, {
    x: 0.6, y: 1.2, w: 8.8, h: 1.4,
    fontSize: 38, fontFace: FONT, color: C.WHITE, bold: true,
    valign: "top",
  });

  if (data.items && data.items.length > 0) {
    addTextSafe(slide, "Objetivos", {
      x: 0.6, y: 2.9, w: 3, h: 0.35,
      fontSize: 14, fontFace: FONT, color: C.ACCENT, bold: true,
    });

    const objTextArr = buildBulletTextArray(data.items, {
      markerChar: "✓",
      markerColor: C.ACCENT,
      textColor: C.WHITE,
      fontSize: 16,
    });

    addTextSafe(slide, objTextArr, {
      x: 0.6, y: 3.3, w: 8.8, h: 1.9,
      valign: "top",
      paraSpaceAfter: 8,
      lineSpacingMultiple: 1.25,
    });
  }
}

// Layout 3 — CONTEÚDO COM BULLETS (altura dinâmica + split por altura)
function renderBullets(pptx: any, data: SlideData) {
  const bullets = (data.items || []).map((b) => sanitize(b)).filter(Boolean);
  if (bullets.length === 0) return;

  if (shouldSplitByHeight(bullets, MAX_CONTENT_H, 16, CHARS_PER_LINE) && bullets.length > 1) {
    const [part1, part2] = splitItemsByHeight(bullets, MAX_CONTENT_H, 16, CHARS_PER_LINE);
    if (part2.length > 0) {
      const baseTitle = cleanPartTitle(data.title);
      renderBullets(pptx, { ...data, title: `${baseTitle} (Parte 1)`, items: part1 });
      renderBullets(pptx, { ...data, title: `${baseTitle} (Parte 2)`, items: part2 });
      return;
    }
  }

  const slide = pptx.addSlide();
  slide.background = { color: C.BG_LIGHT };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: HEADER_H,
    fill: { color: C.PRIMARY },
  });

  addTextSafe(slide, deduplicateTitle(data.title), {
    x: MX, y: 0.08, w: CONTENT_W, h: HEADER_H - 0.16,
    fontSize: 28, fontFace: FONT, color: C.WHITE, bold: true,
    valign: "middle",
  });

  const bulletsArr: any[] = [];
  bullets.forEach((b, idx) => {
    const isLast = idx === bullets.length - 1;
    const isSubCategory = /^.+:$/.test(b) && b.length < 50;

    if (isSubCategory) {
      bulletsArr.push({
        text: b + (isLast ? "" : "\n"),
        options: {
          fontSize: 15,
          fontFace: FONT,
          color: C.PRIMARY,
          bold: true,
          paraSpaceBefore: 8,
          paraSpaceAfter: 2,
          breakLine: !isLast,
        },
      });
      return;
    }

    bulletsArr.push(
      {
        text: "●  ",
        options: {
          color: C.MEDIUM,
          bold: true,
          fontSize: 16,
          fontFace: FONT,
          breakLine: false,
        },
      },
      {
        text: b + (isLast ? "" : "\n"),
        options: {
          color: C.TEXT_BODY,
          fontSize: 16,
          fontFace: FONT,
          breakLine: !isLast,
        },
      },
    );
  });

  const estimatedH = estimateContentHeight(bullets, 16, CHARS_PER_LINE);
  const contentH = Math.min(estimatedH + 0.3, MAX_CONTENT_H);

  addTextSafe(slide, bulletsArr, {
    x: MX,
    y: CONTENT_Y,
    w: CONTENT_W,
    h: contentH,
    valign: "top",
    paraSpaceAfter: 10,
    lineSpacingMultiple: 1.3,
  });
}

// Layout 4 — CARDS EM GRID
function renderCardsGrid(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.BG_LIGHT };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: HEADER_H,
    fill: { color: C.PRIMARY },
  });

  addTextSafe(slide, deduplicateTitle(data.title), {
    x: MX, y: 0.08, w: CONTENT_W, h: HEADER_H - 0.16,
    fontSize: 28, fontFace: FONT, color: C.WHITE, bold: true,
    valign: "middle",
  });

  const items = data.items || [];
  const count = items.length;
  const cols = 2;
  const rows = Math.ceil(count / cols);
  const gridTop = HEADER_H + 0.3;
  const gridH = SLIDE_H - gridTop - 0.35;
  const cardW = (CONTENT_W - 0.3) / cols;
  const cardH = Math.min((gridH - (rows - 1) * 0.2) / rows, 1.4);
  const gapX = 0.3;
  const gapY = 0.2;

  items.forEach((item, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MX + col * (cardW + gapX);
    const y = gridTop + row * (cardH + gapY);

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

    const colonIdx = item.indexOf(":");
    if (colonIdx > 2 && colonIdx < 50) {
      const cardTitle = item.substring(0, colonIdx).trim();
      const cardDesc = item.substring(colonIdx + 1).trim();
      addTextSafe(slide, cardTitle, {
        x: x + 0.2, y: y + 0.1, w: cardW - 0.35, h: 0.35,
        fontSize: 14, fontFace: FONT, color: C.PRIMARY, bold: true,
        valign: "top",
      });
      addTextSafe(slide, cardDesc, {
        x: x + 0.2, y: y + 0.42, w: cardW - 0.35, h: cardH - 0.55,
        fontSize: 13, fontFace: FONT, color: C.TEXT_BODY,
        valign: "top",
      });
    } else {
      addTextSafe(slide, item, {
        x: x + 0.2, y: y + 0.1, w: cardW - 0.35, h: cardH - 0.2,
        fontSize: 14, fontFace: FONT, color: C.TEXT_BODY,
        valign: "middle",
      });
    }
  });
}

// Layout 5 — TABELA COMPARATIVA (altura dinâmica + split por altura)
function renderTabela(pptx: any, data: SlideData) {
  const headers = (data.tableHeaders || []).map((h) => sanitize(h));
  const rows = (data.tableRows || []).map((r) => r.map((c) => sanitize(c)));
  if (!headers.length || !rows.length) return;

  const colCount = headers.length || (rows[0]?.length ?? 2);
  const colW = Array(colCount).fill(CONTENT_W / colCount);
  const estimatedH = calcTableHeight(rows, colW);

  if (estimatedH > MAX_TABLE_H && rows.length > 1) {
    const chunks = splitTableRows(rows, colW, MAX_TABLE_H);
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
    x: 0, y: 0, w: SLIDE_W, h: HEADER_H,
    fill: { color: C.PRIMARY },
  });
  addTextSafe(slide, deduplicateTitle(data.title), {
    x: MX, y: 0.08, w: CONTENT_W, h: HEADER_H - 0.16,
    fontSize: 28, fontFace: FONT, color: C.WHITE, bold: true,
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

  const safeH = Math.min(calcTableHeight(rows, colW) + 0.2, MAX_TABLE_H);
  slide.addTable(tableData, {
    x: MX,
    y: TABLE_Y,
    w: CONTENT_W,
    h: safeH,
    colW,
    autoPage: false,
  });
}

// Layout 6 — RESUMO (altura dinâmica + split por altura)
function renderResumo(pptx: any, data: SlideData) {
  const items = (data.items || []).map((i) => sanitize(i)).filter(Boolean);
  if (!items.length) return;

  const summaryY = 1.5;
  const summaryMaxH = SLIDE_H - summaryY - 0.2;

  if (shouldSplitByHeight(items, summaryMaxH, 14, 95) && items.length > 1) {
    const [part1, part2] = splitItemsByHeight(items, summaryMaxH, 14, 95);
    if (part2.length > 0) {
      const baseTitle = cleanPartTitle(data.subtitle || data.title);
      renderResumo(pptx, { ...data, subtitle: `${baseTitle} (Parte 1)`, items: part1 });
      renderResumo(pptx, { ...data, subtitle: `${baseTitle} (Parte 2)`, items: part2 });
      return;
    }
  }

  const slide = pptx.addSlide();
  slide.background = { color: C.BG_LIGHT };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.18, h: SLIDE_H,
    fill: { color: C.ACCENT },
  });

  addTextSafe(slide, "RESUMO", {
    x: 0.4, y: 0.3, w: 2, h: 0.4,
    fontSize: 13, fontFace: FONT, color: C.ACCENT, bold: true,
  });

  addTextSafe(slide, deduplicateTitle(data.subtitle || data.title), {
    x: 0.4, y: 0.7, w: 9.2, h: 0.7,
    fontSize: 24, fontFace: FONT, color: C.PRIMARY, bold: true,
    valign: "top",
  });

  const bulletLines = buildBulletTextArray(items, {
    markerChar: "✓",
    markerColor: C.ACCENT,
    textColor: C.TEXT_BODY,
    fontSize: 14,
  });

  const contentH = Math.min(estimateContentHeight(items, 14, 95) + 0.3, summaryMaxH);
  addTextSafe(slide, bulletLines, {
    x: 0.4,
    y: summaryY,
    w: 9.2,
    h: contentH,
    valign: "top",
    paraSpaceAfter: 10,
    lineSpacingMultiple: 1.3,
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
