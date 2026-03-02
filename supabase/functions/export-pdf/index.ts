import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Emoji & encoding helpers ──────────────────────────────────────────

/** Remove emojis and other non-Latin1 symbols that jsPDF cannot render */
function sanitizeText(text: string): string {
  let clean = text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, "")
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")
    .replace(/[\u{2600}-\u{26FF}]/gu, "")
    .replace(/[\u{2700}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{200D}]/gu, "")
    .replace(/[\u{20E3}]/gu, "")
    .replace(/[\u{E0020}-\u{E007F}]/gu, "")
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, "")
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, "")
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, "")
    .replace(/[\u{2300}-\u{23FF}]/gu, "")
    .replace(/[\u{2B50}]/gu, "")
    .replace(/[\u{203C}\u{2049}]/gu, "")
    .replace(/[\u{00AD}]/gu, "")
    .trim();

  clean = clean
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2026]/g, "...");

  clean = clean.replace(/  +/g, " ").trim();
  return clean;
}

/** Strip markdown formatting from text */
function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, ""))
    .replace(/>\s*/g, "")
    .replace(/---/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function getHeadingLevel(line: string): number {
  const match = line.match(/^(#{1,6})\s/);
  return match ? match[1].length : 0;
}

// ── Table parser ──────────────────────────────────────────────────────

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function parseMarkdownTable(lines: string[], startIndex: number): { table: ParsedTable | null; endIndex: number } {
  if (!lines[startIndex]?.includes("|")) return { table: null, endIndex: startIndex };

  const parsePipeRow = (line: string): string[] =>
    line.split("|").map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length);

  const headers = parsePipeRow(lines[startIndex]);
  if (headers.length < 2) return { table: null, endIndex: startIndex };

  const sepLine = lines[startIndex + 1];
  if (!sepLine || !/^[\s|:-]+$/.test(sepLine)) return { table: null, endIndex: startIndex };

  const rows: string[][] = [];
  let i = startIndex + 2;
  while (i < lines.length && lines[i].includes("|")) {
    const cells = parsePipeRow(lines[i]);
    if (cells.length >= 2) rows.push(cells);
    i++;
  }

  if (rows.length === 0) return { table: null, endIndex: startIndex };
  return { table: { headers, rows }, endIndex: i - 1 };
}

// ── Pedagogical block detection ───────────────────────────────────────

type PedagogicalBlockType = "example" | "reflection" | "summary" | "takeaways" | "tip" | "note" | null;

function detectPedagogicalBlock(text: string): PedagogicalBlockType {
  const lower = text.toLowerCase().replace(/[*#_`>]/g, "").trim();
  if (/^exemplo\s+pr[áa]tico/.test(lower) || /^na\s+pr[áa]tica/.test(lower) || /^vamos\s+praticar/.test(lower)) return "example";
  if (/^pare\s+um\s+momento/.test(lower) || /^reflita/.test(lower) || /^para\s+pensar/.test(lower) || /^checkpoint/.test(lower)) return "reflection";
  if (/^resumo/.test(lower) || /^em\s+resumo/.test(lower) || /^conclus[ãa]o/.test(lower)) return "summary";
  if (/^key\s+takeaway/.test(lower) || /^pontos[- ]chave/.test(lower)) return "takeaways";
  if (/^dica/.test(lower) || /^importante/.test(lower) || /^aten[çc][ãa]o/.test(lower)) return "tip";
  if (/^nota/.test(lower) || /^lembre[- ]se/.test(lower) || /^sa[íi]ba\s+mais/.test(lower) || /^exerc[íi]cio/.test(lower) || /^atividade/.test(lower) || /^desafio/.test(lower)) return "note";
  return null;
}

// ── PDF Layout constants ──────────────────────────────────────────────

const PAGE_W = 210;
const MARGIN_LEFT = 24;
const MARGIN_RIGHT = 24;
const MARGIN_TOP = 28;
const MARGIN_BOTTOM = 28;
const CONTENT_W = PAGE_W - MARGIN_LEFT - MARGIN_RIGHT;
const MAX_Y = 297 - MARGIN_BOTTOM;

// Font sizes
const FONT = {
  TITLE: 28,
  MODULE_TITLE: 20,
  H2: 15,
  H3: 12.5,
  H4: 11,
  BODY: 10.5,
  SMALL: 9.5,
  TABLE_HEADER: 9,
  TABLE_BODY: 9,
  BLOCK_LABEL: 9.5,
};

// Spacing (mm) — generous for comfortable reading
const SP = {
  AFTER_TITLE: 14,
  BEFORE_H2: 12,
  AFTER_H2: 7,
  BEFORE_H3: 10,
  AFTER_H3: 5,
  BEFORE_H4: 8,
  AFTER_H4: 4,
  AFTER_PARAGRAPH: 6,
  LINE_HEIGHT: 5.2,
  BULLET_GAP: 3,
  TABLE_ROW_PAD: 3.5,
  TABLE_CELL_LINE: 4,
  SECTION_GAP: 10,
  BLOCK_PAD_V: 5,
  BLOCK_PAD_H: 8,
};

// Colors (RGB tuples)
const COLOR = {
  PRIMARY: [35, 40, 85] as const,       // Deep navy
  PRIMARY_LIGHT: [60, 65, 130] as const,
  TEXT_DARK: [30, 30, 35] as const,
  TEXT_BODY: [45, 45, 50] as const,
  TEXT_MUTED: [100, 100, 110] as const,
  TEXT_WHITE: [255, 255, 255] as const,
  BG_EXAMPLE: [235, 245, 238] as const,    // Soft green
  BG_REFLECTION: [240, 238, 250] as const, // Soft purple
  BG_SUMMARY: [235, 242, 252] as const,    // Soft blue
  BG_TAKEAWAY: [252, 245, 230] as const,   // Soft amber
  BG_TIP: [255, 243, 230] as const,        // Soft orange
  BG_NOTE: [242, 242, 248] as const,       // Neutral
  BAR_EXAMPLE: [40, 140, 70] as const,
  BAR_REFLECTION: [110, 70, 180] as const,
  BAR_SUMMARY: [40, 100, 180] as const,
  BAR_TAKEAWAY: [200, 150, 30] as const,
  BAR_TIP: [220, 120, 30] as const,
  BAR_NOTE: [100, 100, 130] as const,
  TABLE_HEADER: [35, 40, 85] as const,
  TABLE_ZEBRA: [245, 245, 252] as const,
  TABLE_FIRST_COL: [232, 232, 245] as const,
  BORDER_LIGHT: [210, 210, 220] as const,
  BORDER_TABLE: [185, 185, 200] as const,
};

// ── PDF renderer ──────────────────────────────────────────────────────

class PdfRenderer {
  doc: any;
  y: number;
  pageNum: number;

  constructor() {
    this.doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    this.y = MARGIN_TOP;
    this.pageNum = 1;
  }

  // ── Page management ──────────────────────────────────────────────

  addPage() {
    this.doc.addPage();
    this.y = MARGIN_TOP;
    this.pageNum++;
    this.drawFooter();
  }

  checkPage(needed: number) {
    if (this.y + needed > MAX_Y) this.addPage();
  }

  drawFooter() {
    this.doc.setFontSize(8);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(160, 160, 165);
    this.doc.text(`${this.pageNum}`, PAGE_W / 2, 290, { align: "center" });
    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  // ── Estimation helpers (no side-effects on Y) ────────────────────

  estimateTextHeight(text: string, fontSize: number, maxWidth: number, lineH: number): number {
    this.doc.setFontSize(fontSize);
    const lines = this.doc.splitTextToSize(sanitizeText(stripMarkdown(text)), maxWidth);
    return lines.length * lineH + 4;
  }

  estimateBulletHeight(text: string): number {
    this.doc.setFontSize(FONT.BODY);
    const clean = sanitizeText(stripMarkdown(text.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "")));
    const lines = this.doc.splitTextToSize(clean, CONTENT_W - 10);
    return lines.length * SP.LINE_HEIGHT + SP.BULLET_GAP;
  }

  estimateNextBlockHeight(lines: string[], i: number): number {
    if (i >= lines.length) return 0;
    const trimmed = lines[i].trim();
    if (!trimmed) return 0;

    if (trimmed.includes("|") && i + 1 < lines.length && lines[i + 1]?.includes("|")) {
      const { table } = parseMarkdownTable(lines, i);
      if (table) return Math.min(80, 10 + table.rows.length * 12);
    }
    if (trimmed.startsWith("> ")) {
      let text = trimmed.replace(/^>\s*/, "");
      let j = i + 1;
      while (j < lines.length && lines[j]?.trim().startsWith("> ")) {
        text += " " + lines[j].trim().replace(/^>\s*/, "");
        j++;
      }
      return this.estimateTextHeight(text, FONT.SMALL, CONTENT_W - 16, 4.5) + 12;
    }
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || /^\d+\.\s/.test(trimmed)) {
      let h = 0, j = i, count = 0;
      while (j < lines.length && count < 5) {
        const t = lines[j].trim();
        if (!t || getHeadingLevel(t) > 0) break;
        if (t.startsWith("- ") || t.startsWith("* ") || /^\d+\.\s/.test(t)) {
          h += this.estimateBulletHeight(t);
          count++;
        } else break;
        j++;
      }
      return h;
    }
    return this.estimateTextHeight(trimmed, FONT.BODY, CONTENT_W, SP.LINE_HEIGHT);
  }

  nextNonEmpty(lines: string[], from: number): number {
    let j = from;
    while (j < lines.length && !lines[j].trim()) j++;
    return j;
  }

  // ── Title page ────────────────────────────────────────────────────

  renderTitlePage(title: string, description: string | null, language: string) {
    // Top decorative bar
    this.doc.setFillColor(...COLOR.PRIMARY);
    this.doc.rect(0, 0, PAGE_W, 8, "F");
    // Accent stripe
    this.doc.setFillColor(...COLOR.PRIMARY_LIGHT);
    this.doc.rect(0, 8, PAGE_W, 2, "F");

    // Title
    this.doc.setFontSize(FONT.TITLE);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...COLOR.PRIMARY);
    const titleLines = this.doc.splitTextToSize(sanitizeText(title), CONTENT_W - 20);
    const titleY = 80;
    this.doc.text(titleLines, PAGE_W / 2, titleY, { align: "center" });

    // Decorative line under title
    const underY = titleY + titleLines.length * 11 + 6;
    this.doc.setDrawColor(...COLOR.PRIMARY);
    this.doc.setLineWidth(1);
    this.doc.line(PAGE_W / 2 - 35, underY, PAGE_W / 2 + 35, underY);
    this.doc.setLineWidth(0.3);
    this.doc.line(PAGE_W / 2 - 25, underY + 3, PAGE_W / 2 + 25, underY + 3);

    // Description
    if (description) {
      this.doc.setFontSize(11.5);
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(...COLOR.TEXT_MUTED);
      const descLines = this.doc.splitTextToSize(sanitizeText(description), CONTENT_W - 40);
      this.doc.text(descLines, PAGE_W / 2, underY + 18, { align: "center" });
    }

    // Metadata
    this.doc.setFontSize(9);
    this.doc.setTextColor(130, 130, 140);
    this.doc.text(`Idioma: ${language}`, PAGE_W / 2, 248, { align: "center" });
    this.doc.text(new Date().toLocaleDateString("pt-BR"), PAGE_W / 2, 254, { align: "center" });

    // Bottom decorative bars
    this.doc.setFillColor(...COLOR.PRIMARY_LIGHT);
    this.doc.rect(0, 289, PAGE_W, 2, "F");
    this.doc.setFillColor(...COLOR.PRIMARY);
    this.doc.rect(0, 291, PAGE_W, 6, "F");

    this.drawFooter();
  }

  // ── Module title ──────────────────────────────────────────────────

  renderModuleTitle(title: string) {
    this.addPage();
    this.y = MARGIN_TOP + 8;

    // Accent bar
    this.doc.setFillColor(...COLOR.PRIMARY);
    this.doc.rect(MARGIN_LEFT, this.y - 3, 5, 14, "F");

    this.doc.setFontSize(FONT.MODULE_TITLE);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...COLOR.PRIMARY);
    const lines = this.doc.splitTextToSize(sanitizeText(title), CONTENT_W - 14);
    this.doc.text(lines, MARGIN_LEFT + 10, this.y + 7);
    this.y += lines.length * 9 + SP.AFTER_TITLE;

    // Separator line
    this.doc.setDrawColor(...COLOR.BORDER_LIGHT);
    this.doc.setLineWidth(0.4);
    this.doc.line(MARGIN_LEFT, this.y, PAGE_W - MARGIN_RIGHT, this.y);
    this.y += 8;
    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  // ── Headings ──────────────────────────────────────────────────────

  renderHeading(text: string, level: number, extraNeeded = 0) {
    const sizeMap: Record<number, number> = { 2: FONT.H2, 3: FONT.H3, 4: FONT.H4, 5: FONT.BODY, 6: FONT.BODY };
    const fontSize = sizeMap[level] || FONT.BODY;
    const beforeMap: Record<number, number> = { 2: SP.BEFORE_H2, 3: SP.BEFORE_H3, 4: SP.BEFORE_H4 };
    const beforeSpace = beforeMap[level] || 6;
    const afterMap: Record<number, number> = { 2: SP.AFTER_H2, 3: SP.AFTER_H3, 4: SP.AFTER_H4 };
    const afterSpace = afterMap[level] || 4;

    const cleanText = sanitizeText(stripMarkdown(text.replace(/^#{1,6}\s*/, "")));
    this.doc.setFontSize(fontSize);
    const textLines = this.doc.splitTextToSize(cleanText, CONTENT_W);
    const headingH = beforeSpace + textLines.length * (fontSize * 0.38) + afterSpace;

    this.checkPage(headingH + extraNeeded);
    this.y += beforeSpace;

    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...COLOR.PRIMARY);
    this.doc.text(textLines, MARGIN_LEFT, this.y);
    this.y += textLines.length * (fontSize * 0.38) + afterSpace;

    // H2 underline accent
    if (level === 2) {
      this.doc.setDrawColor(...COLOR.PRIMARY_LIGHT);
      this.doc.setLineWidth(0.3);
      this.doc.line(MARGIN_LEFT, this.y - 3, MARGIN_LEFT + 55, this.y - 3);
      this.y += 2;
    }

    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  // ── Body text ─────────────────────────────────────────────────────

  renderParagraph(text: string) {
    const cleanText = sanitizeText(stripMarkdown(text));
    if (!cleanText) return;

    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...COLOR.TEXT_BODY);

    const lines = this.doc.splitTextToSize(cleanText, CONTENT_W);
    this.checkPage(lines.length * SP.LINE_HEIGHT + 3);
    this.doc.text(lines, MARGIN_LEFT, this.y);
    this.y += lines.length * SP.LINE_HEIGHT + SP.AFTER_PARAGRAPH;
  }

  renderBullet(text: string, indent = 0) {
    const cleanText = sanitizeText(stripMarkdown(text.replace(/^[-*]\s*/, "")));
    if (!cleanText) return;

    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...COLOR.TEXT_BODY);

    const indentMm = indent * 5;
    const bulletX = MARGIN_LEFT + 3 + indentMm;
    const textX = MARGIN_LEFT + 9 + indentMm;
    const availW = CONTENT_W - 9 - indentMm;

    const lines = this.doc.splitTextToSize(cleanText, availW);
    this.checkPage(lines.length * SP.LINE_HEIGHT + SP.BULLET_GAP);

    // Bullet dot
    this.doc.setFillColor(...COLOR.PRIMARY);
    this.doc.circle(bulletX, this.y - 1.2, 0.8, "F");

    this.doc.text(lines, textX, this.y);
    this.y += lines.length * SP.LINE_HEIGHT + SP.BULLET_GAP;
  }

  // ── Blockquote ────────────────────────────────────────────────────

  renderBlockquote(text: string) {
    const cleanText = sanitizeText(stripMarkdown(text.replace(/^>\s*/, "")));
    if (!cleanText) return;

    this.doc.setFontSize(FONT.SMALL);
    this.doc.setFont("helvetica", "italic");

    const lines = this.doc.splitTextToSize(cleanText, CONTENT_W - 16);
    const blockH = lines.length * 4.5 + SP.BLOCK_PAD_V * 2;
    this.checkPage(blockH + 4);

    // Background
    this.doc.setFillColor(...COLOR.BG_NOTE);
    this.doc.roundedRect(MARGIN_LEFT, this.y - SP.BLOCK_PAD_V, CONTENT_W, blockH, 2, 2, "F");

    // Left accent bar
    this.doc.setFillColor(...COLOR.BAR_NOTE);
    this.doc.roundedRect(MARGIN_LEFT, this.y - SP.BLOCK_PAD_V, 3, blockH, 1.5, 1.5, "F");

    this.doc.setTextColor(60, 60, 85);
    this.doc.text(lines, MARGIN_LEFT + SP.BLOCK_PAD_H + 2, this.y + 1);
    this.y += blockH + 6;
    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  // ── Styled pedagogical box ────────────────────────────────────────

  renderPedagogicalBox(label: string, bodyLines: string[], blockType: PedagogicalBlockType) {
    const bgMap: Record<string, readonly [number, number, number]> = {
      example: COLOR.BG_EXAMPLE,
      reflection: COLOR.BG_REFLECTION,
      summary: COLOR.BG_SUMMARY,
      takeaways: COLOR.BG_TAKEAWAY,
      tip: COLOR.BG_TIP,
      note: COLOR.BG_NOTE,
    };
    const barMap: Record<string, readonly [number, number, number]> = {
      example: COLOR.BAR_EXAMPLE,
      reflection: COLOR.BAR_REFLECTION,
      summary: COLOR.BAR_SUMMARY,
      takeaways: COLOR.BAR_TAKEAWAY,
      tip: COLOR.BAR_TIP,
      note: COLOR.BAR_NOTE,
    };
    const bt = blockType || "note";
    const bg = bgMap[bt] || COLOR.BG_NOTE;
    const bar = barMap[bt] || COLOR.BAR_NOTE;

    // Measure label
    this.doc.setFontSize(FONT.BLOCK_LABEL);
    this.doc.setFont("helvetica", "bold");
    const labelClean = sanitizeText(stripMarkdown(label));
    const labelLines = this.doc.splitTextToSize(labelClean, CONTENT_W - 18);
    const labelH = labelLines.length * 4.5;

    // Measure body
    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont("helvetica", "normal");
    const bodyH = bodyLines.reduce((sum, line) => {
      const ls = this.doc.splitTextToSize(sanitizeText(stripMarkdown(line)), CONTENT_W - 18);
      return sum + ls.length * SP.LINE_HEIGHT + 2;
    }, 0);

    const totalH = SP.BLOCK_PAD_V + labelH + 4 + bodyH + SP.BLOCK_PAD_V;
    this.checkPage(totalH + 4);

    const boxY = this.y - 2;

    // Background with rounded corners
    this.doc.setFillColor(...bg);
    this.doc.roundedRect(MARGIN_LEFT, boxY, CONTENT_W, totalH, 2.5, 2.5, "F");

    // Left accent bar
    this.doc.setFillColor(...bar);
    this.doc.roundedRect(MARGIN_LEFT, boxY, 3.5, totalH, 1.5, 1.5, "F");

    // Label
    this.doc.setFontSize(FONT.BLOCK_LABEL);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...(bar as [number, number, number]));
    const innerX = MARGIN_LEFT + SP.BLOCK_PAD_H + 2;
    let curY = boxY + SP.BLOCK_PAD_V + 3;
    this.doc.text(labelLines, innerX, curY);
    curY += labelH + 4;

    // Body content
    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...COLOR.TEXT_BODY);
    for (const line of bodyLines) {
      const clean = sanitizeText(stripMarkdown(line));
      if (!clean) { curY += 2; continue; }
      const isBullet = line.trim().startsWith("- ") || line.trim().startsWith("* ") || /^\d+\.\s/.test(line.trim());
      if (isBullet) {
        const bulletText = clean.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "");
        const ls = this.doc.splitTextToSize(bulletText, CONTENT_W - 24);
        this.doc.setFillColor(...bar);
        this.doc.circle(innerX + 2, curY - 1, 0.7, "F");
        this.doc.setTextColor(...COLOR.TEXT_BODY);
        this.doc.text(ls, innerX + 7, curY);
        curY += ls.length * SP.LINE_HEIGHT + SP.BULLET_GAP;
      } else {
        const ls = this.doc.splitTextToSize(clean, CONTENT_W - 18);
        this.doc.text(ls, innerX, curY);
        curY += ls.length * SP.LINE_HEIGHT + 2;
      }
    }

    this.y = boxY + totalH + 8;
  }

  // ── Horizontal rule ───────────────────────────────────────────────

  renderHorizontalRule() {
    this.checkPage(10);
    this.y += 4;
    this.doc.setDrawColor(...COLOR.BORDER_LIGHT);
    this.doc.setLineWidth(0.3);
    this.doc.line(MARGIN_LEFT + 25, this.y, PAGE_W - MARGIN_RIGHT - 25, this.y);
    this.y += SP.SECTION_GAP;
  }

  // ── Table rendering ───────────────────────────────────────────────

  renderTable(table: ParsedTable) {
    const { headers, rows } = table;
    const numCols = headers.length;

    // Column widths - first column wider for "Aspecto" pattern
    const colWidths: number[] = [];
    const firstRatio = numCols <= 2 ? 0.35 : numCols <= 3 ? 0.30 : 0.25;
    colWidths.push(CONTENT_W * firstRatio);
    const remaining = CONTENT_W - colWidths[0];
    for (let i = 1; i < numCols; i++) colWidths.push(remaining / (numCols - 1));

    // Pre-measure all rows to get accurate heights
    const headerH = 10;
    const rowHeights: number[] = [];
    for (const row of rows) {
      this.doc.setFontSize(FONT.TABLE_BODY);
      let maxLines = 1;
      for (let c = 0; c < numCols; c++) {
        const cellText = sanitizeText(stripMarkdown(row[c] || ""));
        const lines = this.doc.splitTextToSize(cellText, colWidths[c] - 8);
        if (lines.length > maxLines) maxLines = Math.min(lines.length, 4);
      }
      rowHeights.push(Math.max(8, maxLines * SP.TABLE_CELL_LINE + SP.TABLE_ROW_PAD * 2));
    }

    const totalTableH = headerH + rowHeights.reduce((a, b) => a + b, 0) + 4;

    // If table fits on one page, keep it together
    if (totalTableH < MAX_Y - MARGIN_TOP) {
      this.checkPage(totalTableH);
    } else {
      this.checkPage(Math.min(totalTableH, headerH + rowHeights[0] + 20));
    }

    this.y += 3;
    const startX = MARGIN_LEFT;
    let currentY = this.y;

    const drawHeader = (atY: number): number => {
      // Header background
      this.doc.setFillColor(...COLOR.TABLE_HEADER);
      this.doc.roundedRect(startX, atY, CONTENT_W, headerH, 1.5, 1.5, "F");
      // Square off bottom corners by overlaying rect
      this.doc.rect(startX, atY + headerH - 2, CONTENT_W, 2, "F");

      this.doc.setFontSize(FONT.TABLE_HEADER);
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...COLOR.TEXT_WHITE);

      let hx = startX;
      for (let c = 0; c < numCols; c++) {
        const cellText = sanitizeText(stripMarkdown(headers[c] || ""));
        const lines = this.doc.splitTextToSize(cellText, colWidths[c] - 6);
        this.doc.text(lines[0] || "", hx + 4, atY + 6.5);
        hx += colWidths[c];
      }
      return atY + headerH;
    };

    currentY = drawHeader(currentY);

    // ── Rows ──
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const rowH = rowHeights[r];

      // Page break check
      if (currentY + rowH > MAX_Y) {
        // Draw outer border for current page portion
        const partH = currentY - this.y;
        this.doc.setDrawColor(...COLOR.BORDER_TABLE);
        this.doc.setLineWidth(0.3);
        this.doc.rect(startX, this.y, CONTENT_W, partH);

        this.addPage();
        currentY = this.y;
        currentY = drawHeader(currentY);
      }

      // Row background
      this.doc.setFillColor(...(r % 2 === 0 ? COLOR.TABLE_ZEBRA : COLOR.TEXT_WHITE));
      this.doc.rect(startX, currentY, CONTENT_W, rowH, "F");

      // First column highlight
      this.doc.setFillColor(...COLOR.TABLE_FIRST_COL);
      this.doc.rect(startX, currentY, colWidths[0], rowH, "F");

      // Cell text
      let colX = startX;
      for (let c = 0; c < numCols; c++) {
        const cellText = sanitizeText(stripMarkdown(row[c] || ""));
        this.doc.setFontSize(FONT.TABLE_BODY);
        const lines = this.doc.splitTextToSize(cellText, colWidths[c] - 8).slice(0, 4);

        if (c === 0) {
          this.doc.setFont("helvetica", "bold");
          this.doc.setTextColor(...COLOR.PRIMARY);
        } else {
          this.doc.setFont("helvetica", "normal");
          this.doc.setTextColor(...COLOR.TEXT_BODY);
        }

        for (let l = 0; l < lines.length; l++) {
          this.doc.text(lines[l], colX + 4, currentY + SP.TABLE_ROW_PAD + 3 + l * SP.TABLE_CELL_LINE);
        }
        colX += colWidths[c];
      }

      // Row bottom border
      this.doc.setDrawColor(...COLOR.BORDER_LIGHT);
      this.doc.setLineWidth(0.15);
      this.doc.line(startX, currentY + rowH, startX + CONTENT_W, currentY + rowH);

      currentY += rowH;
    }

    // Outer border
    const totalH = currentY - this.y;
    this.doc.setDrawColor(...COLOR.BORDER_TABLE);
    this.doc.setLineWidth(0.35);
    this.doc.roundedRect(startX, this.y, CONTENT_W, totalH, 1.5, 1.5);

    // Column separators
    let colX = startX;
    for (let c = 0; c < numCols - 1; c++) {
      colX += colWidths[c];
      this.doc.setDrawColor(...COLOR.BORDER_LIGHT);
      this.doc.setLineWidth(0.15);
      this.doc.line(colX, this.y + headerH, colX, this.y + totalH);
    }

    this.y = currentY + SP.SECTION_GAP;
  }

  // ── Module content processor ──────────────────────────────────────

  renderModuleContent(content: string) {
    const lines = content.split("\n");
    let i = 0;

    while (i < lines.length) {
      const trimmed = lines[i].trim();

      if (!trimmed) {
        this.y += 3;
        i++;
        continue;
      }

      // ── Table detection ──
      if (trimmed.includes("|") && i + 1 < lines.length && lines[i + 1]?.includes("|")) {
        const { table, endIndex } = parseMarkdownTable(lines, i);
        if (table) {
          this.renderTable(table);
          i = endIndex + 1;
          continue;
        }
      }

      // ── Headings with look-ahead ──
      const heading = getHeadingLevel(trimmed);
      if (heading > 0) {
        const nextIdx = this.nextNonEmpty(lines, i + 1);
        const nextBlockH = this.estimateNextBlockHeight(lines, nextIdx);
        this.renderHeading(trimmed, heading === 1 ? 2 : heading, nextBlockH);
        i++;
        continue;
      }

      // ── Pedagogical blocks — collect label + body as one unit ──
      const blockType = detectPedagogicalBlock(trimmed);
      if (blockType) {
        const label = trimmed;
        const bodyLines: string[] = [];
        let j = i + 1;
        // Collect associated content lines until next heading, empty gap, or new block
        let emptyCount = 0;
        while (j < lines.length) {
          const t = lines[j].trim();
          if (!t) {
            emptyCount++;
            if (emptyCount >= 2) break; // Two blank lines = block separator
            j++;
            continue;
          }
          emptyCount = 0;
          if (getHeadingLevel(t) > 0) break;
          if (detectPedagogicalBlock(t)) break;
          if (t === "---" || t === "***" || t === "___") break;
          bodyLines.push(t);
          j++;
        }

        if (bodyLines.length > 0) {
          this.renderPedagogicalBox(label, bodyLines, blockType);
        } else {
          // No body found, render as styled paragraph
          this.renderParagraph(label);
        }
        i = j;
        continue;
      }

      // ── Blockquote ──
      if (trimmed.startsWith("> ")) {
        let quoteText = trimmed.replace(/^>\s*/, "");
        let j = i + 1;
        while (j < lines.length && lines[j]?.trim().startsWith("> ")) {
          quoteText += " " + lines[j].trim().replace(/^>\s*/, "");
          j++;
        }
        const bqH = this.estimateTextHeight(quoteText, FONT.SMALL, CONTENT_W - 16, 4.5) + 12;
        this.checkPage(bqH);
        this.renderBlockquote(quoteText);
        i = j;
        continue;
      }

      // ── Bullet list ──
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        this.renderBullet(trimmed);
        i++;
        continue;
      }

      // ── Numbered list ──
      if (/^\d+\.\s/.test(trimmed)) {
        this.renderBullet("- " + trimmed.replace(/^\d+\.\s*/, ""));
        i++;
        continue;
      }

      // ── Horizontal rule ──
      if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
        this.renderHorizontalRule();
        i++;
        continue;
      }

      // ── Regular paragraph ──
      this.renderParagraph(trimmed);
      i++;
    }
  }

  output(): ArrayBuffer {
    return this.doc.output("arraybuffer");
  }
}

// ── Main handler ──────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const { course_id } = await req.json();
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Check subscription
    const { data: sub } = await serviceClient
      .from("subscriptions")
      .select("plan")
      .eq("user_id", userId)
      .single();
    const plan = sub?.plan || "free";

    if (plan !== "pro") {
      const { data: profile } = await serviceClient
        .from("profiles")
        .select("is_dev")
        .eq("user_id", userId)
        .maybeSingle();
      if (!profile?.is_dev) {
        return new Response(
          JSON.stringify({ error: "PDF export is available only on Pro plan." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Fetch course + modules
    const { data: course, error: courseErr } = await serviceClient
      .from("courses")
      .select("*")
      .eq("id", course_id)
      .eq("user_id", userId)
      .single();

    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: modules = [] } = await serviceClient
      .from("course_modules")
      .select("*")
      .eq("course_id", course_id)
      .order("order_index");

    // ── Generate PDF ──
    const pdf = new PdfRenderer();
    pdf.renderTitlePage(course.title, course.description, course.language);

    for (const mod of modules) {
      pdf.renderModuleTitle(mod.title);
      if (mod.content) {
        pdf.renderModuleContent(mod.content);
      }
    }

    const pdfBytes = pdf.output();
    const fileName = `${userId}/${course_id}.pdf`;

    // Upload to storage
    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(fileName, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) throw uploadErr;

    // Create signed URL (1 hour)
    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);

    if (signErr) throw signErr;

    // Log usage event
    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_EXPORTED_PDF",
      metadata: { course_id },
    });

    return new Response(JSON.stringify({ url: signedUrl.signedUrl }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Export PDF error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
