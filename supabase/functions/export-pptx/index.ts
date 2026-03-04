import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";

/**
 * PPTX EXPORT — EduGenAI Professional Light Theme
 *
 * Design System: Montserrat + Open Sans, white background, 
 * orange/purple accents, dark header tables, zebra striping.
 *
 * 7 Layout Types:
 * 1. module_cover — Module opening with large number + gradient feel
 * 2. definition_card_with_pillars — Definition card + 3-4 pillars
 * 3. comparison_table — 3-column table with insight box
 * 4. grid_cards — 2x2 or 2x3 card grid
 * 5. four_quadrants — 2x2 quadrant layout with footer
 * 6. process_timeline — Horizontal numbered timeline
 * 7. numbered_takeaways — 6 numbered cards + reflection
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ═══════════════════════════════════════════════════════
   DESIGN SYSTEM — EduGenAI Professional Light
   ═══════════════════════════════════════════════════════ */

const C = {
  // Backgrounds
  BG_WHITE:       "FFFFFF",
  BG_LIGHT:       "F8F9FA",
  BG_CARD:        "FFFFFF",
  BG_CARD_ALT:    "F2F3F5",

  // Primary palette
  PRIMARY:        "2C3E50",  // Dark blue-gray (titles, primary text)
  SECONDARY:      "E67E22",  // Orange (accent, module numbers, badges)
  ACCENT_PURPLE:  "9B59B6",
  ACCENT_BLUE:    "3498DB",
  ACCENT_GREEN:   "27AE60",
  ACCENT_RED:     "E74C3C",

  // Text
  TEXT_DARK:      "2C3E50",
  TEXT_BODY:      "34495E",
  TEXT_LIGHT:     "7F8C8D",
  TEXT_WHITE:     "FFFFFF",

  // Table
  TABLE_HEADER_BG: "34495E",
  TABLE_ROW_ODD:   "FFFFFF",
  TABLE_ROW_EVEN:  "ECF0F1",
  TABLE_BORDER:    "BDC3C7",

  // Cards & accents
  CARD_BORDER:    "E0E0E0",
  CARD_SHADOW:    "D5D8DC",
  INSIGHT_BG:     "FDF2E9",   // Light orange background for insight boxes
  INSIGHT_BORDER: "E67E22",
  REFLECTION_BG:  "EBF5FB",   // Light blue background for reflection
};

// Card accent colors for variety
const CARD_ACCENT_COLORS = [C.ACCENT_BLUE, C.ACCENT_GREEN, C.ACCENT_PURPLE, C.SECONDARY, C.ACCENT_RED, C.PRIMARY];

// Module cover gradient colors (pairs)
const MODULE_GRADIENTS = [
  { from: "E67E22", to: "9B59B6" },  // Orange → Purple
  { from: "3498DB", to: "2C3E50" },  // Blue → Dark
  { from: "27AE60", to: "2C3E50" },  // Green → Dark
  { from: "9B59B6", to: "E67E22" },  // Purple → Orange
  { from: "E74C3C", to: "9B59B6" },  // Red → Purple
];

const FONT_TITLE = "Montserrat";
const FONT_BODY  = "Open Sans";

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

const MARGIN = 0.50;
const SAFE_W = SLIDE_W - MARGIN * 2;  // ~12.333

const BOTTOM_MARGIN = 0.35;

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

const _auditLog: { slideLabel: string; x: number; y: number; w: number; h: number }[] = [];
let _auditSlideCounter = 0;
function auditNextSlide() { _auditSlideCounter++; }

function addTextSafe(slide: any, text: any, options: Record<string, unknown>) {
  const x = Number(options.x || 0);
  const y = Number(options.y || 0);
  const w = Number(options.w || 0);
  const h = Number(options.h || 0);
  const safeW = Math.min(w, SLIDE_W - x - 0.15);
  const safeH = Math.min(h, SLIDE_H - y - 0.05);
  if (safeW <= 0.1 || safeH <= 0.05) return;
  _auditLog.push({ slideLabel: `Slide ${_auditSlideCounter}`, x, y, w: safeW, h: safeH });
  slide.addText(text, { ...options, x, y, w: safeW, h: safeH, autoFit: false, overflow: "clip" });
}

function runAudit() {
  const errors: string[] = [];
  for (const el of _auditLog) {
    if (el.x + el.w > SLIDE_W) errors.push(`${el.slideLabel}: overflow R`);
    if (el.y + el.h > SLIDE_H) errors.push(`${el.slideLabel}: overflow B`);
  }
  if (errors.length === 0) console.log(`✅ Audit PASSED — ${_auditLog.length} elements`);
  else errors.forEach(e => console.error(`❌ ${e}`));
  return { passed: errors.length === 0, errors };
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

function estimateTextLines(text: string, widthInches: number, fontPt: number): number {
  const charsPerInch = Math.max(5, 110 / fontPt);
  const charsPerLine = Math.max(10, Math.floor(widthInches * charsPerInch));
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

function getTitleHeight(text: string, widthIn: number, fontPt: number): number {
  const lines = estimateTextLines(text, widthIn, fontPt);
  const lineH = (fontPt * 1.3) / 72;
  return Math.max(0.50, lines * lineH + 0.15);
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
        tHeaders = trimmed.split("|").filter(Boolean).map(c => sanitize(c.trim()));
      } else if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        // separator line
      } else {
        tRows.push(trimmed.split("|").filter(Boolean).map(c => sanitize(c.trim())));
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
   CONTENT CLASSIFICATION — Smart layout assignment
   ═══════════════════════════════════════════════════════ */

type LayoutType =
  | "module_cover"
  | "definition_card_with_pillars"
  | "comparison_table"
  | "grid_cards"
  | "four_quadrants"
  | "process_timeline"
  | "numbered_takeaways"
  | "bullets";

function isDefinitionBlock(items: string[]): boolean {
  if (items.length < 2 || items.length > 6) return false;
  // Check if first item looks like a definition
  const first = items[0] || "";
  return /\b(é|são|refere-se|consiste|define-se|trata-se|significa)\b/i.test(first) && items.length >= 3;
}

function isProcessBlock(heading: string, items: string[]): boolean {
  if (/\b(processo|etapa|passo|fase|fluxo|como funciona|pipeline|workflow)\b/i.test(heading)) return true;
  // Check if items are numbered/sequential
  const numberedCount = items.filter(it => /^(etapa|passo|fase|step)\s*\d/i.test(it) || /^\d+[\.\)]/i.test(it)).length;
  return numberedCount >= 3;
}

function isQuadrantBlock(items: string[]): boolean {
  if (items.length !== 4) return false;
  const withColon = items.filter(it => { const ci = it.indexOf(":"); return ci > 2 && ci < 50; }).length;
  return withColon >= 3;
}

function isResumoHeading(heading: string): boolean {
  return /resumo|conclus|encerramento|pontos[- ]chave|key takeaway|takeaway|recapitula/i.test(heading);
}

function isObjectivesHeading(heading: string): boolean {
  return /objetivo|objetivos?\s+d[oe]|learning objectives|o que voc/i.test(heading);
}

function detectParallel(items: string[]): boolean {
  if (items.length < 3 || items.length > 8) return false;
  const withColon = items.filter(it => { const ci = it.indexOf(":"); return ci > 2 && ci < 50; }).length;
  return withColon >= Math.ceil(items.length * 0.6);
}

function classifyContent(heading: string, items: string[], isTable: boolean, prevLayout: LayoutType | null): LayoutType {
  if (isTable) return "comparison_table";
  if (isResumoHeading(heading)) return "numbered_takeaways";
  if (isProcessBlock(heading, items)) return "process_timeline";
  if (isDefinitionBlock(items)) return "definition_card_with_pillars";
  if (items.length === 4 && isQuadrantBlock(items)) {
    // Avoid repeating same layout
    return prevLayout === "four_quadrants" ? "grid_cards" : "four_quadrants";
  }
  if (detectParallel(items)) {
    return prevLayout === "grid_cards" ? "four_quadrants" : "grid_cards";
  }
  // Default: alternate between bullets and grid_cards to avoid monotony
  if (items.length >= 3 && items.length <= 6 && prevLayout !== "grid_cards") return "grid_cards";
  return "bullets";
}

/* ═══════════════════════════════════════════════════════
   DENSITY SCORING
   ═══════════════════════════════════════════════════════ */

interface SlideData {
  layout: LayoutType;
  title: string;
  subtitle?: string;
  sectionLabel?: string;
  items?: string[];
  tableHeaders?: string[];
  tableRows?: string[][];
  moduleIndex?: number;
  moduleCount?: number;
  description?: string;
  courseTitle?: string;
  modules?: { title: string; description: string }[];
  densityScore?: number;
}

function calculateDensity(sd: SlideData): number {
  let score = 0;
  const items = sd.items || [];
  const textLines = items.reduce((sum, it) => sum + Math.ceil(it.length / 60), 0);
  score += Math.min(textLines * 5, 30);
  score += Math.min(items.length * 10, 60);
  if (sd.tableHeaders) score += 15;
  if (sd.layout === "process_timeline") score += 10;
  if (sd.layout === "module_cover") score = 50; // Fixed
  return Math.min(score, 100);
}

/* ═══════════════════════════════════════════════════════
   TABLE HELPERS
   ═══════════════════════════════════════════════════════ */

const HEADER_ROW_H = 0.50;

function calcRowHeight(row: string[], colWidths: number[]): number {
  let maxLines = 1;
  for (let c = 0; c < row.length; c++) {
    const cellText = String(row[c] || "");
    const colW = colWidths[c] || 3.0;
    const charsPerLine = Math.max(10, Math.floor(colW * 10));
    const lines = Math.max(1, Math.ceil(cellText.length / charsPerLine));
    maxLines = Math.max(maxLines, lines);
  }
  return 0.45 + (maxLines - 1) * 0.22;
}

function calcTableHeight(rows: string[][], colWidths: number[]): number {
  let h = HEADER_ROW_H;
  for (const row of rows) h += calcRowHeight(row, colWidths);
  return h;
}

function splitTableRows(rows: string[][], colWidths: number[], maxH: number): string[][][] {
  if (calcTableHeight(rows, colWidths) <= maxH) return [rows];
  const chunks: string[][][] = [];
  let current: string[][] = [];
  let curH = HEADER_ROW_H;
  for (const row of rows) {
    const rh = calcRowHeight(row, colWidths);
    if (current.length > 0 && curH + rh > maxH) {
      chunks.push(current);
      current = [row];
      curH = HEADER_ROW_H + rh;
    } else {
      current.push(row);
      curH += rh;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function getColumnWidths(headers: string[], rows: string[][]): number[] {
  const colCount = headers.length;
  if (colCount === 2) return [SAFE_W * 0.35, SAFE_W * 0.65];
  if (colCount === 3) return [SAFE_W * 0.20, SAFE_W * 0.40, SAFE_W * 0.40];
  return Array(colCount).fill(SAFE_W / colCount);
}

/* ═══════════════════════════════════════════════════════
   BUILD MODULE SLIDES (Content Classification)
   ═══════════════════════════════════════════════════════ */

function buildModuleSlides(mod: any, modIndex: number, totalModules: number): SlideData[] {
  const blocks = parseModuleContent(mod.content || "");
  const rawTitle = sanitize(mod.title || "");

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

  // Module cover
  slides.push({
    layout: "module_cover",
    title: shortTitle,
    subtitle: `MÓDULO ${String(modIndex + 1).padStart(2, "0")}`,
    description: objItems.length > 0 ? objItems[0] : undefined,
    items: sanitizeBullets(objItems.slice(0, 4).map(sanitize)),
    moduleIndex: modIndex,
  });

  let prevLayout: LayoutType | null = "module_cover";

  for (const block of contentBlocks) {
    const heading = sanitize(block.heading || shortTitle);
    const sectionLabel = extractSectionLabel(heading);

    if (block.isTable && block.headers && block.rows && block.rows.length > 0) {
      // Handle large tables: split if > 6 rows
      const rows = block.rows.map(r => r.map(sanitize));
      if (rows.length > 6) {
        const mid = Math.ceil(rows.length / 2);
        slides.push({
          layout: "comparison_table",
          title: heading + " (Parte 1)",
          sectionLabel,
          tableHeaders: block.headers.map(sanitize),
          tableRows: rows.slice(0, mid),
        });
        slides.push({
          layout: "comparison_table",
          title: heading + " (Parte 2)",
          sectionLabel,
          tableHeaders: block.headers.map(sanitize),
          tableRows: rows.slice(mid),
        });
        prevLayout = "comparison_table";
      } else {
        slides.push({
          layout: "comparison_table",
          title: heading,
          sectionLabel,
          tableHeaders: block.headers.map(sanitize),
          tableRows: rows,
        });
        prevLayout = "comparison_table";
      }
      continue;
    }

    const items = block.items.map(sanitize).filter(s => s.length > 3);
    if (items.length === 0) continue;

    // Classify content
    let layout = classifyContent(heading, items, false, prevLayout);

    // Ensure no consecutive repeated layouts
    if (layout === prevLayout && layout !== "bullets") {
      const alternatives: LayoutType[] = ["grid_cards", "bullets", "four_quadrants"];
      layout = alternatives.find(l => l !== prevLayout) || "bullets";
    }

    // Split large item lists (>6 items) into multiple slides
    if (items.length > 6 && layout !== "numbered_takeaways") {
      const mid = Math.ceil(items.length / 2);
      slides.push({
        layout,
        title: heading + " (Parte 1)",
        sectionLabel,
        items: sanitizeBullets(items.slice(0, mid)),
      });
      slides.push({
        layout: layout === "grid_cards" ? "bullets" : "grid_cards", // Alternate
        title: heading + " (Parte 2)",
        sectionLabel,
        items: sanitizeBullets(items.slice(mid)),
      });
      prevLayout = "grid_cards";
    } else {
      slides.push({
        layout,
        title: heading,
        sectionLabel,
        items: sanitizeBullets(items),
      });
      prevLayout = layout;
    }
  }

  // Summary/takeaways
  if (resumoItems.length > 0) {
    slides.push({
      layout: "numbered_takeaways",
      title: `Key Takeaways — Módulo ${modIndex + 1}`,
      sectionLabel: "RESUMO DO MÓDULO",
      items: sanitizeBullets(resumoItems.slice(0, 6).map(sanitize)),
    });
  }

  // Calculate density scores
  slides.forEach(s => { s.densityScore = calculateDensity(s); });

  return slides;
}

function extractSectionLabel(heading: string): string {
  const clean = sanitize(heading).replace(/\s*\(Parte \d+\)\s*$/i, "");
  if (clean.length <= 25) return clean.toUpperCase();
  return clean.split(/\s+/).slice(0, 3).join(" ").toUpperCase();
}

/* ═══════════════════════════════════════════════════════
   HEADER RENDERING — Section label + Title
   ═══════════════════════════════════════════════════════ */

function renderContentHeader(slide: any, sectionLabel: string, titleText: string): number {
  let y = 0.40;

  // Section label (small, uppercase, light gray)
  if (sectionLabel) {
    addTextSafe(slide, sectionLabel, {
      x: MARGIN, y, w: SAFE_W, h: 0.28,
      fontSize: 14, fontFace: FONT_BODY, color: C.TEXT_LIGHT, bold: true,
      letterSpacing: 2,
    });
    y += 0.32;
  }

  // Main title (bold, dark)
  const fontSize = titleText.length > 60 ? 26 : titleText.length > 40 ? 30 : 32;
  const titleH = getTitleHeight(titleText, SAFE_W, fontSize);
  addTextSafe(slide, titleText, {
    x: MARGIN, y, w: SAFE_W, h: titleH,
    fontSize, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
  });
  y += titleH + 0.20;

  return y;
}

/* ═══════════════════════════════════════════════════════
   SLIDE RENDERERS
   ═══════════════════════════════════════════════════════ */

// ── CAPA (Course Cover) ──
function renderCapa(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.PRIMARY };

  // "CURSO COMPLETO" badge
  const badgeW = 3.2;
  const badgeH = 0.48;
  const badgeX = (SLIDE_W - badgeW) / 2;
  const badgeY = 1.2;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: badgeX, y: badgeY, w: badgeW, h: badgeH,
    line: { color: C.SECONDARY, width: 2 },
    fill: { type: "none" },
    rectRadius: 0.15,
  });
  addTextSafe(slide, "CURSO COMPLETO", {
    x: badgeX, y: badgeY, w: badgeW, h: badgeH,
    fontSize: 14, fontFace: FONT_TITLE, color: C.SECONDARY, bold: true,
    align: "center", valign: "middle", letterSpacing: 4,
  });

  // Title
  const titleH = getTitleHeight(data.title, SAFE_W - 2, 48);
  const titleY = badgeY + badgeH + 0.50;
  addTextSafe(slide, data.title, {
    x: MARGIN + 1, y: titleY, w: SAFE_W - 2, h: titleH,
    fontSize: 48, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
    align: "center", valign: "middle",
  });

  // Orange separator
  const sepY = titleY + titleH + 0.15;
  const sepW = 1.5;
  slide.addShape(pptx.ShapeType.rect, {
    x: (SLIDE_W - sepW) / 2, y: sepY, w: sepW, h: 0.05,
    fill: { color: C.SECONDARY },
  });

  // Subtitle
  if (data.description) {
    addTextSafe(slide, sanitize(data.description), {
      x: 2, y: sepY + 0.30, w: SLIDE_W - 4, h: 0.55,
      fontSize: 18, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
    });
  }

  // Footer
  const d = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const footer = data.moduleCount ? `${d}  |  ${data.moduleCount} Módulos` : d;
  addTextSafe(slide, footer, {
    x: 1, y: SLIDE_H - 0.80, w: SLIDE_W - 2, h: 0.40,
    fontSize: 14, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
  });
}

// ── TOC (Table of Contents) ──
function renderTOC(pptx: any, data: SlideData) {
  const modules = data.modules || [];
  if (modules.length === 0) return;

  const slide = pptx.addSlide();
  slide.background = { color: C.BG_WHITE };

  // Section label
  addTextSafe(slide, "CONTEÚDO DO CURSO", {
    x: MARGIN, y: 0.35, w: SAFE_W, h: 0.28,
    fontSize: 14, fontFace: FONT_BODY, color: C.SECONDARY, bold: true, letterSpacing: 2,
  });

  // Title
  addTextSafe(slide, "O que você vai aprender", {
    x: MARGIN, y: 0.68, w: SAFE_W, h: 0.55,
    fontSize: 36, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
  });

  // Module cards grid
  const gridY = 1.40;
  const cols = 2;
  const gapX = 0.25;
  const gapY = 0.20;
  const cardW = (SAFE_W - gapX) / cols;
  const rows = Math.ceil(modules.length / cols);
  const availH = SLIDE_H - gridY - BOTTOM_MARGIN;
  const cardH = Math.min((availH - (rows - 1) * gapY) / rows, 1.40);

  modules.forEach((mod, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MARGIN + col * (cardW + gapX);
    const y = gridY + row * (cardH + gapY);
    if (y + cardH > SLIDE_H - BOTTOM_MARGIN) return;

    // Card with left accent border
    const accentColor = CARD_ACCENT_COLORS[idx % CARD_ACCENT_COLORS.length];

    // Card background (light gray)
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.BG_LIGHT },
      line: { color: C.CARD_BORDER, width: 0.5 },
      rectRadius: 0.08,
    });

    // Left accent bar
    slide.addShape(pptx.ShapeType.rect, {
      x, y: y + 0.08, w: 0.06, h: cardH - 0.16,
      fill: { color: accentColor },
      rectRadius: 0.03,
    });

    // Number circle
    const circleSize = 0.44;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.22, y: y + 0.20, w: circleSize, h: circleSize,
      fill: { color: accentColor },
    });
    addTextSafe(slide, String(idx + 1).padStart(2, "0"), {
      x: x + 0.22, y: y + 0.20, w: circleSize, h: circleSize,
      fontSize: 16, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });

    // Title
    const textX = x + 0.78;
    const textW = cardW - 0.95;
    addTextSafe(slide, mod.title, {
      x: textX, y: y + 0.20, w: textW, h: 0.35,
      fontSize: 16, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
    });

    // Description
    if (mod.description) {
      addTextSafe(slide, mod.description, {
        x: textX, y: y + 0.58, w: textW, h: cardH - 0.72,
        fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_LIGHT,
        valign: "top", lineSpacingMultiple: 1.3,
      });
    }
  });
}

// ── MODULE COVER ──
function renderModuleCover(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  const modIdx = data.moduleIndex || 0;
  const gradient = MODULE_GRADIENTS[modIdx % MODULE_GRADIENTS.length];

  // Gradient background (simulated with two overlapping shapes)
  slide.background = { color: gradient.from };
  // Overlay darker shape on right half for gradient effect
  slide.addShape(pptx.ShapeType.rect, {
    x: SLIDE_W * 0.5, y: 0, w: SLIDE_W * 0.5, h: SLIDE_H,
    fill: { color: gradient.to },
  });
  // Blend overlay
  slide.addShape(pptx.ShapeType.rect, {
    x: SLIDE_W * 0.35, y: 0, w: SLIDE_W * 0.30, h: SLIDE_H,
    fill: { color: gradient.from },
  });

  // Module number (very large)
  const moduleNum = data.subtitle || "MÓDULO 01";
  addTextSafe(slide, moduleNum, {
    x: MARGIN, y: 0.80, w: 5, h: 1.0,
    fontSize: 72, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
  });

  // Title
  const titleH = getTitleHeight(data.title, SAFE_W * 0.5, 40);
  addTextSafe(slide, data.title, {
    x: MARGIN, y: 2.00, w: SAFE_W * 0.55, h: titleH,
    fontSize: 40, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
  });

  // Orange separator
  const sepY = 2.00 + titleH + 0.10;
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: sepY, w: 1.0, h: 0.05,
    fill: { color: C.SECONDARY },
  });

  // Description
  if (data.description) {
    addTextSafe(slide, sanitize(data.description), {
      x: MARGIN, y: sepY + 0.25, w: SAFE_W * 0.50, h: 0.80,
      fontSize: 18, fontFace: FONT_BODY, color: "FFFFFFCC",
      valign: "top", lineSpacingMultiple: 1.4,
    });
  }

  // Keywords at bottom
  if (data.items && data.items.length > 0) {
    const keywords = data.items.slice(0, 3).map(item => {
      return sanitize(item).split(/\s+/).slice(0, 4).join(" ");
    });
    let pillX = MARGIN;
    const pillY = SLIDE_H - 1.0;
    for (const kw of keywords) {
      const pillW = Math.min(kw.length * 0.12 + 0.4, 3.0);
      slide.addShape(pptx.ShapeType.roundRect, {
        x: pillX, y: pillY, w: pillW, h: 0.38,
        fill: { color: "FFFFFF22" },
        rectRadius: 0.19,
      });
      addTextSafe(slide, kw, {
        x: pillX, y: pillY, w: pillW, h: 0.38,
        fontSize: 11, fontFace: FONT_BODY, color: C.TEXT_WHITE,
        align: "center", valign: "middle",
      });
      pillX += pillW + 0.12;
    }
  }
}

// ── DEFINITION CARD WITH PILLARS ──
function renderDefinitionWithPillars(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  slide.background = { color: C.BG_WHITE };
  const items = data.items || [];
  if (items.length === 0) return;

  let contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  // Definition card (first item as the main definition)
  const defText = items[0];
  const defCardH = Math.max(1.0, estimateTextLines(defText, SAFE_W - 1.2, 16) * 0.35 + 0.40);
  
  // Card background
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: contentY, w: SAFE_W, h: defCardH,
    fill: { color: C.BG_LIGHT },
    line: { color: C.ACCENT_BLUE, width: 1.5 },
    rectRadius: 0.10,
  });

  // "Definição Essencial" label
  addTextSafe(slide, "DEFINIÇÃO ESSENCIAL", {
    x: MARGIN + 0.30, y: contentY + 0.15, w: SAFE_W - 0.60, h: 0.28,
    fontSize: 11, fontFace: FONT_TITLE, color: C.ACCENT_BLUE, bold: true,
    letterSpacing: 2,
  });

  // Definition text
  addTextSafe(slide, defText, {
    x: MARGIN + 0.30, y: contentY + 0.45, w: SAFE_W - 0.60, h: defCardH - 0.60,
    fontSize: 16, fontFace: FONT_BODY, color: C.TEXT_BODY,
    valign: "top", lineSpacingMultiple: 1.4,
  });

  contentY += defCardH + 0.30;

  // Pillars (remaining items as horizontal cards)
  const pillars = items.slice(1, 5);
  if (pillars.length > 0) {
    const cols = pillars.length;
    const gapX = 0.20;
    const pillarW = (SAFE_W - (cols - 1) * gapX) / cols;
    const availH = SLIDE_H - contentY - BOTTOM_MARGIN;
    const pillarH = Math.min(availH, 1.60);

    pillars.forEach((pillar, idx) => {
      const x = MARGIN + idx * (pillarW + gapX);
      const accentColor = CARD_ACCENT_COLORS[idx % CARD_ACCENT_COLORS.length];

      // Pillar card
      slide.addShape(pptx.ShapeType.rect, {
        x, y: contentY, w: pillarW, h: pillarH,
        fill: { color: C.BG_WHITE },
        line: { color: C.CARD_BORDER, width: 0.5 },
        rectRadius: 0.08,
      });

      // Top accent line
      slide.addShape(pptx.ShapeType.rect, {
        x: x + 0.08, y: contentY, w: pillarW - 0.16, h: 0.05,
        fill: { color: accentColor },
      });

      // Icon circle
      const circleSize = 0.44;
      slide.addShape(pptx.ShapeType.ellipse, {
        x: x + (pillarW - circleSize) / 2, y: contentY + 0.20, w: circleSize, h: circleSize,
        fill: { color: accentColor },
      });
      const iconChar = ["◆", "⚙", "◎", "✦"][idx % 4];
      addTextSafe(slide, iconChar, {
        x: x + (pillarW - circleSize) / 2, y: contentY + 0.20, w: circleSize, h: circleSize,
        fontSize: 18, fontFace: FONT_BODY, color: C.TEXT_WHITE, bold: true,
        align: "center", valign: "middle",
      });

      // Extract title from "Title: Description" pattern
      const colonIdx = pillar.indexOf(":");
      const pTitle = colonIdx > 2 && colonIdx < 50 ? pillar.substring(0, colonIdx).trim() : "";
      const pBody = pTitle ? pillar.substring(colonIdx + 1).trim() : pillar;

      let textY = contentY + 0.72;
      if (pTitle) {
        addTextSafe(slide, pTitle, {
          x: x + 0.15, y: textY, w: pillarW - 0.30, h: 0.30,
          fontSize: 13, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
          align: "center",
        });
        textY += 0.32;
      }

      addTextSafe(slide, pBody, {
        x: x + 0.15, y: textY, w: pillarW - 0.30, h: pillarH - (textY - contentY) - 0.10,
        fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_LIGHT,
        align: "center", valign: "top", lineSpacingMultiple: 1.25,
      });
    });
  }
}

// ── COMPARISON TABLE ──
function renderComparisonTable(pptx: any, data: SlideData) {
  const headers = (data.tableHeaders || []).map(h => sanitize(h));
  const rows = (data.tableRows || []).map(r => r.map(c => sanitize(c)));
  if (!headers.length || !rows.length) return;

  const titleText = deduplicateTitle(data.title);
  const colWidths = getColumnWidths(headers, rows);
  
  // Check if we need to split
  const headerAreaH = 1.30;
  const insightH = 0.60;
  const maxTableH = SLIDE_H - headerAreaH - insightH - BOTTOM_MARGIN;
  
  const estH = calcTableHeight(rows, colWidths);
  if (estH > maxTableH && rows.length > 4) {
    const chunks = splitTableRows(rows, colWidths, maxTableH);
    if (chunks.length > 1) {
      const bt = titleText.replace(/\s*\(Parte \d+\)\s*$/i, "");
      chunks.forEach((chunk, idx) => {
        renderComparisonTable(pptx, {
          ...data,
          title: `${bt} (Parte ${idx + 1})`,
          tableRows: chunk,
        });
      });
      return;
    }
  }

  const slide = pptx.addSlide();
  slide.background = { color: C.BG_WHITE };
  const contentY = renderContentHeader(slide, data.sectionLabel || "", titleText);

  // Build table
  const colCount = headers.length;
  const noBorder = { type: "none" as const, pt: 0, color: "000000" };
  const borderBottom = { type: "solid" as const, pt: 0.5, color: C.TABLE_BORDER };

  const tableData: any[][] = [];

  // Header row
  tableData.push(headers.map(h => ({
    text: h,
    options: {
      fontSize: 12, fontFace: FONT_TITLE, bold: true, color: C.TEXT_WHITE,
      fill: { color: C.TABLE_HEADER_BG },
      border: [noBorder, noBorder, noBorder, noBorder],
      valign: "middle" as const,
      paraSpaceBefore: 6, paraSpaceAfter: 6,
      margin: [0.10, 0.15, 0.10, 0.15],
    },
  })));

  // Data rows with zebra striping
  rows.forEach((row, ri) => {
    const isEven = ri % 2 === 1;
    const fillColor = isEven ? C.TABLE_ROW_EVEN : C.TABLE_ROW_ODD;
    const dataRow = row.map((cell, ci) => ({
      text: cell,
      options: {
        fontSize: 11, fontFace: FONT_BODY, color: C.TEXT_BODY,
        bold: ci === 0, // First column bold
        fill: { color: fillColor },
        border: [noBorder, noBorder, borderBottom, noBorder],
        valign: "middle" as const,
        paraSpaceBefore: 4, paraSpaceAfter: 4,
        margin: [0.10, 0.15, 0.10, 0.15],
      },
    }));
    // Pad if needed
    while (dataRow.length < colCount) {
      dataRow.push({
        text: "",
        options: {
          fontSize: 11, fontFace: FONT_BODY, color: C.TEXT_BODY,
          fill: { color: fillColor },
          border: [noBorder, noBorder, borderBottom, noBorder],
          valign: "middle" as const,
          paraSpaceBefore: 4, paraSpaceAfter: 4,
          margin: [0.10, 0.15, 0.10, 0.15],
        },
      });
    }
    tableData.push(dataRow);
  });

  const safeH = Math.min(estH * 1.15 + 0.2, maxTableH);
  slide.addTable(tableData, {
    x: MARGIN, y: contentY, w: SAFE_W, h: safeH,
    colW: colWidths,
    autoPage: false,
  });

  // Insight box at bottom
  const insightY = SLIDE_H - 0.70;
  const insightBoxH = 0.45;
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: insightY, w: SAFE_W, h: insightBoxH,
    fill: { color: C.INSIGHT_BG },
    rectRadius: 0.08,
  });
  // Left accent bar on insight
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: insightY + 0.06, w: 0.05, h: insightBoxH - 0.12,
    fill: { color: C.SECONDARY },
  });
  addTextSafe(slide, [
    { text: "💡 Insight: ", options: { bold: true, color: C.SECONDARY, fontSize: 12, fontFace: FONT_TITLE } },
    { text: "Analise os dados acima e reflita sobre como se aplicam ao seu contexto profissional.", options: { color: C.TEXT_BODY, fontSize: 12, fontFace: FONT_BODY, italic: true } },
  ], {
    x: MARGIN + 0.22, y: insightY, w: SAFE_W - 0.44, h: insightBoxH,
    valign: "middle",
  });
}

// ── GRID CARDS ──
function renderGridCards(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;
  if (items.length <= 2) { renderBullets(pptx, data); return; }

  const slide = pptx.addSlide();
  slide.background = { color: C.BG_WHITE };
  let contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  const count = Math.min(items.length, 6);
  const cols = count === 3 || count === 6 ? 3 : 2;
  const gapX = 0.22;
  const gapY = 0.20;
  const cardW = (SAFE_W - (cols - 1) * gapX) / cols;
  const rows = Math.ceil(count / cols);
  const availH = SLIDE_H - contentY - BOTTOM_MARGIN;
  const cardH = Math.min((availH - (rows - 1) * gapY) / rows, 1.60);

  items.slice(0, count).forEach((item, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MARGIN + col * (cardW + gapX);
    const y = contentY + row * (cardH + gapY);
    if (y + cardH > SLIDE_H - BOTTOM_MARGIN) return;

    const accentColor = CARD_ACCENT_COLORS[idx % CARD_ACCENT_COLORS.length];

    // Card
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.BG_LIGHT },
      line: { color: C.CARD_BORDER, width: 0.5 },
      rectRadius: 0.08,
    });

    // Left accent bar
    slide.addShape(pptx.ShapeType.rect, {
      x, y: y + 0.08, w: 0.05, h: cardH - 0.16,
      fill: { color: accentColor },
      rectRadius: 0.025,
    });

    // Icon circle
    const circleSize = 0.40;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.18, y: y + 0.18, w: circleSize, h: circleSize,
      fill: { color: accentColor },
    });
    const iconChar = ["◆", "⚙", "◎", "✦", "▲", "●"][idx % 6];
    addTextSafe(slide, iconChar, {
      x: x + 0.18, y: y + 0.18, w: circleSize, h: circleSize,
      fontSize: 16, fontFace: FONT_BODY, color: C.TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });

    // Extract title:body
    const colonIdx = item.indexOf(":");
    const cardTitle = colonIdx > 2 && colonIdx < 50 ? item.substring(0, colonIdx).trim() : "";
    const cardBody = cardTitle ? item.substring(colonIdx + 1).trim() : item;

    const textX = x + 0.68;
    const textW = cardW - 0.82;
    let textY = y + 0.18;

    if (cardTitle) {
      addTextSafe(slide, cardTitle, {
        x: textX, y: textY, w: textW, h: 0.30,
        fontSize: 14, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      });
      textY += 0.34;
    }

    if (cardBody) {
      const bodyH = cardH - (textY - y) - 0.10;
      addTextSafe(slide, cardBody, {
        x: textX, y: textY, w: textW, h: Math.max(bodyH, 0.20),
        fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_LIGHT,
        valign: "top", lineSpacingMultiple: 1.3,
      });
    }
  });
}

// ── FOUR QUADRANTS ──
function renderFourQuadrants(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length < 4) { renderGridCards(pptx, data); return; }

  const slide = pptx.addSlide();
  slide.background = { color: C.BG_WHITE };
  let contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  const cols = 2;
  const gapX = 0.25;
  const gapY = 0.22;
  const quadW = (SAFE_W - gapX) / cols;
  const quadrants = items.slice(0, 4);
  const rows = 2;
  const availH = SLIDE_H - contentY - BOTTOM_MARGIN;
  const quadH = Math.min((availH - gapY) / rows, 2.0);

  quadrants.forEach((item, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MARGIN + col * (quadW + gapX);
    const y = contentY + row * (quadH + gapY);
    if (y + quadH > SLIDE_H - BOTTOM_MARGIN) return;

    const accentColor = CARD_ACCENT_COLORS[idx % CARD_ACCENT_COLORS.length];

    // Quadrant background
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: quadW, h: quadH,
      fill: { color: C.BG_LIGHT },
      line: { color: C.CARD_BORDER, width: 0.5 },
      rectRadius: 0.10,
    });

    // Top accent line
    slide.addShape(pptx.ShapeType.rect, {
      x: x + 0.10, y, w: quadW - 0.20, h: 0.05,
      fill: { color: accentColor },
    });

    // Icon circle (larger for quadrants)
    const circleSize = 0.50;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.25, y: y + 0.25, w: circleSize, h: circleSize,
      fill: { color: accentColor },
    });
    const iconChar = ["⚙", "👥", "💡", "📊"][idx % 4];
    addTextSafe(slide, iconChar, {
      x: x + 0.25, y: y + 0.25, w: circleSize, h: circleSize,
      fontSize: 20, fontFace: FONT_BODY, color: C.TEXT_WHITE,
      align: "center", valign: "middle",
    });

    // Title and body
    const colonIdx = item.indexOf(":");
    const qTitle = colonIdx > 2 && colonIdx < 50 ? item.substring(0, colonIdx).trim() : "";
    const qBody = qTitle ? item.substring(colonIdx + 1).trim() : item;

    let textY = y + 0.25;
    const textX = x + 0.85;
    const textW = quadW - 1.05;

    if (qTitle) {
      addTextSafe(slide, qTitle, {
        x: textX, y: textY, w: textW, h: 0.35,
        fontSize: 16, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      });
      textY += 0.38;
    }

    addTextSafe(slide, qBody, {
      x: textX, y: textY, w: textW, h: quadH - (textY - y) - 0.15,
      fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_LIGHT,
      valign: "top", lineSpacingMultiple: 1.3,
    });
  });

  // If there are more than 4 items, add footer section
  if (items.length > 4) {
    const footerItems = items.slice(4, 10);
    const footerY = SLIDE_H - 0.70;
    const footerText = footerItems.map(it => `• ${sanitize(it).substring(0, 60)}`).join("   ");
    addTextSafe(slide, footerText, {
      x: MARGIN, y: footerY, w: SAFE_W, h: 0.40,
      fontSize: 11, fontFace: FONT_BODY, color: C.TEXT_LIGHT, italic: true,
    });
  }
}

// ── PROCESS TIMELINE ──
function renderProcessTimeline(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;

  const slide = pptx.addSlide();
  slide.background = { color: C.BG_WHITE };
  let contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  const steps = items.slice(0, 5);
  const stepCount = steps.length;
  const totalW = SAFE_W;
  const stepW = totalW / stepCount;
  const circleSize = 0.55;
  const lineY = contentY + circleSize / 2;

  // Connecting line
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN + stepW / 2,
    y: lineY + circleSize / 2 - 0.02,
    w: totalW - stepW,
    h: 0.04,
    fill: { color: C.CARD_BORDER },
  });

  steps.forEach((step, idx) => {
    const centerX = MARGIN + stepW * idx + stepW / 2;
    const x = centerX - circleSize / 2;
    const y = contentY;
    const accentColor = idx === 0 ? C.SECONDARY : CARD_ACCENT_COLORS[idx % CARD_ACCENT_COLORS.length];

    // Circle
    slide.addShape(pptx.ShapeType.ellipse, {
      x, y, w: circleSize, h: circleSize,
      fill: { color: accentColor },
    });
    addTextSafe(slide, String(idx + 1), {
      x, y, w: circleSize, h: circleSize,
      fontSize: 22, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });

    // Extract title and description
    const colonIdx = step.indexOf(":");
    const stepTitle = colonIdx > 2 && colonIdx < 50 ? step.substring(0, colonIdx).trim() : `Etapa ${idx + 1}`;
    const stepDesc = colonIdx > 2 && colonIdx < 50 ? step.substring(colonIdx + 1).trim() : step;

    const textX = centerX - stepW / 2 + 0.08;
    const textW = stepW - 0.16;
    const textY = y + circleSize + 0.15;

    // Step title
    addTextSafe(slide, stepTitle, {
      x: textX, y: textY, w: textW, h: 0.35,
      fontSize: 14, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      align: "center",
    });

    // Step description
    addTextSafe(slide, stepDesc, {
      x: textX, y: textY + 0.38, w: textW, h: 1.2,
      fontSize: 11, fontFace: FONT_BODY, color: C.TEXT_LIGHT,
      align: "center", valign: "top", lineSpacingMultiple: 1.3,
    });
  });

  // Supporting text at bottom
  addTextSafe(slide, "Cada etapa contribui para um resultado mais eficiente e robusto.", {
    x: MARGIN, y: SLIDE_H - 0.65, w: SAFE_W, h: 0.35,
    fontSize: 14, fontFace: FONT_BODY, color: C.TEXT_LIGHT, italic: true,
    align: "center",
  });
}

// ── BULLETS (Clean modern list) ──
function renderBullets(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;

  const slide = pptx.addSlide();
  slide.background = { color: C.BG_WHITE };
  let contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  const availH = SLIDE_H - contentY - BOTTOM_MARGIN;
  const bulletH = Math.min(availH / items.length, 0.80);

  items.forEach((item, idx) => {
    const y = contentY + idx * bulletH;
    if (y + bulletH > SLIDE_H - BOTTOM_MARGIN) return;

    const accentColor = CARD_ACCENT_COLORS[idx % CARD_ACCENT_COLORS.length];

    // Accent dot
    const dotSize = 0.12;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: MARGIN + 0.10, y: y + (bulletH - dotSize) / 2, w: dotSize, h: dotSize,
      fill: { color: accentColor },
    });

    // Text
    addTextSafe(slide, item, {
      x: MARGIN + 0.35, y, w: SAFE_W - 0.45, h: bulletH,
      fontSize: 16, fontFace: FONT_BODY, color: C.TEXT_BODY,
      valign: "middle", lineSpacingMultiple: 1.3,
    });

    // Subtle separator line (not on last item)
    if (idx < items.length - 1) {
      slide.addShape(pptx.ShapeType.rect, {
        x: MARGIN + 0.35, y: y + bulletH - 0.02, w: SAFE_W - 0.80, h: 0.01,
        fill: { color: C.TABLE_ROW_EVEN },
      });
    }
  });
}

// ── NUMBERED TAKEAWAYS (Summary) ──
function renderNumberedTakeaways(pptx: any, data: SlideData) {
  const items = (data.items || []).map(i => sanitize(i)).filter(Boolean);
  if (!items.length) return;

  const slide = pptx.addSlide();
  slide.background = { color: C.BG_WHITE };
  const contentY = renderContentHeader(slide, data.sectionLabel || "RESUMO DO MÓDULO", data.title);

  const maxItems = Math.min(items.length, 6);
  const cols = maxItems <= 4 ? 2 : 3;
  const rows = Math.ceil(maxItems / cols);
  const gapX = 0.22;
  const gapY = 0.18;
  const cardW = (SAFE_W - (cols - 1) * gapX) / cols;
  const reflectionH = 0.55;
  const availH = SLIDE_H - contentY - reflectionH - BOTTOM_MARGIN - 0.10;
  const cardH = Math.min((availH - (rows - 1) * gapY) / rows, 1.30);

  items.slice(0, maxItems).forEach((bullet, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MARGIN + col * (cardW + gapX);
    const y = contentY + row * (cardH + gapY);
    if (y + cardH > SLIDE_H - reflectionH - BOTTOM_MARGIN) return;

    const accentColor = CARD_ACCENT_COLORS[idx % CARD_ACCENT_COLORS.length];

    // Card
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.BG_LIGHT },
      line: { color: C.CARD_BORDER, width: 0.5 },
      rectRadius: 0.08,
    });

    // Left accent
    slide.addShape(pptx.ShapeType.rect, {
      x, y: y + 0.08, w: 0.05, h: cardH - 0.16,
      fill: { color: accentColor },
      rectRadius: 0.025,
    });

    // Number circle
    const circleSize = 0.40;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.16, y: y + 0.16, w: circleSize, h: circleSize,
      fill: { color: accentColor },
    });
    addTextSafe(slide, String(idx + 1), {
      x: x + 0.16, y: y + 0.16, w: circleSize, h: circleSize,
      fontSize: 18, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });

    // Content
    const colonIdx = bullet.indexOf(":");
    let cardTitle = "";
    let cardBody = bullet;
    if (colonIdx > 2 && colonIdx < 60) {
      cardTitle = bullet.substring(0, colonIdx).trim();
      cardBody = bullet.substring(colonIdx + 1).trim();
    } else {
      const words = bullet.split(/\s+/);
      if (words.length > 4) {
        cardTitle = words.slice(0, 4).join(" ");
        cardBody = words.slice(4).join(" ");
      }
    }

    const textX = x + 0.66;
    const textW = cardW - 0.80;
    let textY = y + 0.16;

    if (cardTitle) {
      addTextSafe(slide, cardTitle, {
        x: textX, y: textY, w: textW, h: 0.30,
        fontSize: 13, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      });
      textY += 0.32;
    }

    if (cardBody) {
      const bodyH = cardH - (textY - y) - 0.10;
      addTextSafe(slide, cardBody, {
        x: textX, y: textY, w: textW, h: Math.max(bodyH, 0.15),
        fontSize: 11, fontFace: FONT_BODY, color: C.TEXT_LIGHT,
        valign: "top", lineSpacingMultiple: 1.2,
      });
    }
  });

  // Reflection callout
  const reflY = SLIDE_H - reflectionH - 0.10;
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: reflY, w: SAFE_W, h: reflectionH,
    fill: { color: C.REFLECTION_BG },
    rectRadius: 0.08,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: reflY + 0.06, w: 0.05, h: reflectionH - 0.12,
    fill: { color: C.ACCENT_BLUE },
  });
  const reflText = data.description
    ? sanitize(data.description)
    : "Reflita: Como esses conceitos se aplicam à sua realidade profissional?";
  addTextSafe(slide, [
    { text: "🔍 Reflexão: ", options: { bold: true, color: C.ACCENT_BLUE, fontSize: 13, fontFace: FONT_TITLE } },
    { text: reflText, options: { color: C.TEXT_BODY, fontSize: 13, fontFace: FONT_BODY, italic: true } },
  ], {
    x: MARGIN + 0.22, y: reflY, w: SAFE_W - 0.44, h: reflectionH,
    valign: "middle",
  });
}

// ── ENCERRAMENTO (Closing) ──
function renderEncerramento(pptx: any, courseTitle: string) {
  const slide = pptx.addSlide();
  slide.background = { color: C.PRIMARY };

  addTextSafe(slide, "Obrigado!", {
    x: 1, y: 1.5, w: SLIDE_W - 2, h: 1.8,
    fontSize: 56, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
    align: "center", valign: "middle",
  });

  // Orange separator
  slide.addShape(pptx.ShapeType.rect, {
    x: (SLIDE_W - 1.5) / 2, y: 3.40, w: 1.5, h: 0.05,
    fill: { color: C.SECONDARY },
  });

  addTextSafe(slide, sanitize(courseTitle), {
    x: 2, y: 3.70, w: SLIDE_W - 4, h: 0.60,
    fontSize: 20, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
  });

  addTextSafe(slide, "Continue praticando  |  Acesse os materiais complementares", {
    x: 2, y: 4.60, w: SLIDE_W - 4, h: 0.40,
    fontSize: 16, fontFace: FONT_BODY, color: C.SECONDARY, align: "center",
  });

  // Footer
  addTextSafe(slide, "Gerado com EduGen AI", {
    x: 2, y: SLIDE_H - 0.80, w: SLIDE_W - 4, h: 0.35,
    fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
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

    // Calculate density scores
    allSlides.forEach(s => { s.densityScore = calculateDensity(s); });

    // Log density distribution
    console.log("Density scores:", allSlides.map(s => `${s.layout}:${s.densityScore}`).join(", "));

    /* ─── Build PPTX ─── */
    const pptx = new PptxGenJS();
    pptx.author = "EduGen AI";
    pptx.title = course.title;
    pptx.subject = course.description || "";
    pptx.layout = "LAYOUT_WIDE";  // 13.333 x 7.5

    // Wrap addSlide for audit
    const _origAddSlide = pptx.addSlide.bind(pptx);
    pptx.addSlide = (...args: any[]) => {
      auditNextSlide();
      return _origAddSlide(...args);
    };

    // 1. Cover
    renderCapa(pptx, {
      layout: "module_cover",
      title: course.title,
      description: course.description || "",
      moduleCount: modules.length,
    });

    // 2. TOC
    const modulesSummary = modules.map((m: any) => {
      const rawTitle = sanitize(m.title || "");
      const shortTitle = rawTitle.replace(/^módulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;
      const firstSentence = sanitize((m.content || "").split(/[.!?]\s/)[0] || "").substring(0, 120);
      return { title: shortTitle, description: firstSentence };
    });

    renderTOC(pptx, {
      layout: "module_cover",
      title: "O que você vai aprender",
      modules: modulesSummary,
    });

    // 3. All module slides
    for (const sd of allSlides) {
      switch (sd.layout) {
        case "module_cover":                renderModuleCover(pptx, sd); break;
        case "definition_card_with_pillars": renderDefinitionWithPillars(pptx, sd); break;
        case "comparison_table":            renderComparisonTable(pptx, sd); break;
        case "grid_cards":                  renderGridCards(pptx, sd); break;
        case "four_quadrants":              renderFourQuadrants(pptx, sd); break;
        case "process_timeline":            renderProcessTimeline(pptx, sd); break;
        case "numbered_takeaways":          renderNumberedTakeaways(pptx, sd); break;
        case "bullets":                     renderBullets(pptx, sd); break;
        default:                            renderBullets(pptx, sd); break;
      }
    }

    // 4. Closing
    renderEncerramento(pptx, course.title);

    const totalSlides = allSlides.length + 3;
    console.log(`PPTX generated: ${totalSlides} slides for ${modules.length} modules`);

    // Audit
    const audit = runAudit();
    if (!audit.passed) console.error(`Audit: ${audit.errors.length} violations`);

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
