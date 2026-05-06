import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Text helpers ───────────────────────────────────────────────────────

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

  return clean.replace(/  +/g, " ").trim();
}

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

function normalizeTitle(t: string): string {
  return sanitizeText(stripMarkdown(t.replace(/^#{1,6}\s*/, "").replace(/^M[oó]dulo\s+\d+[:.]\s*/i, "")))
    .toLowerCase().replace(/\s+/g, " ").trim();
}

// ── Table parser ────────────────────────────────────────────────────────

interface ParsedTable { headers: string[]; rows: string[][]; }

function parseMarkdownTable(lines: string[], startIndex: number): { table: ParsedTable | null; endIndex: number } {
  if (!lines[startIndex]?.includes("|")) return { table: null, endIndex: startIndex };
  const parsePipeRow = (line: string): string[] =>
    line.split("|").map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length);
  // BUG #4 FIX: filter empty header cells to prevent ghost columns from AI-generated trailing pipes
  const headers = parsePipeRow(lines[startIndex]).filter((h) => h !== "");
  if (headers.length < 2) return { table: null, endIndex: startIndex };
  const numCols = headers.length;
  const sepLine = lines[startIndex + 1];
  if (!sepLine || !/^[\s|:-]+$/.test(sepLine)) return { table: null, endIndex: startIndex };
  const rows: string[][] = [];
  let i = startIndex + 2;
  while (i < lines.length && lines[i].includes("|")) {
    const cells = parsePipeRow(lines[i]);
    if (cells.length >= 1) {
      // Normalize each row to exactly numCols cells — prevents missing or extra columns
      const normalized = cells.slice(0, numCols);
      while (normalized.length < numCols) normalized.push("");
      rows.push(normalized);
    }
    i++;
  }
  if (rows.length === 0) return { table: null, endIndex: startIndex };
  return { table: { headers, rows }, endIndex: i - 1 };
}

// ── Pedagogical block detection ─────────────────────────────────────────

type BlockType = "example" | "reflection" | "summary" | "takeaways" | "tip" | "note" | null;

function detectBlock(text: string): BlockType {
  const lower = text.toLowerCase().replace(/[*#_`>]/g, "").trim();
  if (/^exemplo\s+pr[áa]tico/.test(lower) || /^na\s+pr[áa]tica/.test(lower)) return "example";
  if (/^pare\s+um\s+momento/.test(lower) || /^reflita/.test(lower) || /^checkpoint/.test(lower)) return "reflection";
  if (/^resumo/.test(lower) || /^em\s+resumo/.test(lower) || /^conclus[ãa]o/.test(lower)) return "summary";
  if (/^key\s+takeaway/.test(lower) || /^pontos[- ]chave/.test(lower) || /^principais\s+aprendizados/.test(lower)) return "takeaways";
  if (/^dica/.test(lower) || /^importante/.test(lower) || /^aten[çc][ãa]o/.test(lower)) return "tip";
  if (/^nota/.test(lower) || /^lembre[- ]se/.test(lower) || /^desafio/.test(lower) || /^atividade/.test(lower)) return "note";
  return null;
}

// ── Layout constants ────────────────────────────────────────────────────

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_L = 22;
const MARGIN_R = 22;
const MARGIN_T = 26;
const MARGIN_B = 26;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
const MAX_Y = PAGE_H - MARGIN_B;

const FONT = { COVER_TITLE: 30, COVER_SUB: 12, MODULE_NUM: 11, MODULE_TITLE: 22, H2: 14, H3: 12, H4: 11, BODY: 10.5, SMALL: 9.5, TABLE_H: 9, TABLE_B: 9, BLOCK_LABEL: 9.5 };

const SP = {
  AFTER_TITLE: 12, BEFORE_H2: 11, AFTER_H2: 6, BEFORE_H3: 9, AFTER_H3: 5,
  BEFORE_H4: 7, AFTER_H4: 4, AFTER_PARA: 5.5, LINE_H: 5.2,
  BULLET_GAP: 3, TABLE_ROW_PAD: 3.5, TABLE_LINE: 4, SECTION_GAP: 10,
  BOX_V: 5, BOX_H: 8,
};

const C = {
  NAVY: [22, 33, 75] as const,
  NAVY_MID: [45, 60, 130] as const,
  NAVY_LIGHT: [80, 100, 170] as const,
  ACCENT: [255, 195, 0] as const,         // Gold accent
  TEXT_DARK: [28, 28, 33] as const,
  TEXT_BODY: [50, 50, 58] as const,
  TEXT_MUTED: [110, 110, 120] as const,
  WHITE: [255, 255, 255] as const,
  BG_EXAMPLE: [234, 247, 238] as const,
  BG_REFLECTION: [242, 238, 252] as const,
  BG_SUMMARY: [234, 243, 254] as const,
  BG_TAKEAWAY: [254, 247, 228] as const,
  BG_TIP: [255, 244, 230] as const,
  BG_NOTE: [242, 242, 250] as const,
  BAR_EXAMPLE: [38, 142, 72] as const,
  BAR_REFLECTION: [108, 68, 180] as const,
  BAR_SUMMARY: [38, 98, 180] as const,
  BAR_TAKEAWAY: [196, 148, 28] as const,
  BAR_TIP: [218, 118, 28] as const,
  BAR_NOTE: [98, 98, 128] as const,
  TABLE_HEAD: [22, 33, 75] as const,
  TABLE_ZEBRA: [244, 244, 252] as const,
  TABLE_COL1: [232, 234, 248] as const,
  BORDER: [205, 205, 218] as const,
  BORDER_TABLE: [180, 180, 200] as const,
  PAGE_BG: [252, 252, 254] as const,
};

// ── Renderer ────────────────────────────────────────────────────────────

class PdfRenderer {
  doc: any;
  y: number;
  pageNum: number;

  constructor() {
    this.doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    this.y = MARGIN_T;
    this.pageNum = 1;
  }

  addPage() {
    this.doc.addPage();
    this.y = MARGIN_T;
    this.pageNum++;
    this.drawPageChrome();
  }

  checkPage(needed: number) {
    if (this.y + needed > MAX_Y) this.addPage();
  }

  /** Estimate minimum height needed after a heading so it never strands alone at the bottom */
  estimateFollowHeight(lines: string[], fromIdx: number): number {
    // Skip blank lines
    let j = fromIdx;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j >= lines.length) return 0;

    const t = lines[j].trim();
    // Table coming up → keep at least 28mm
    if (t.includes("|")) return 28;
    // Another heading → keep at least 10mm
    if (getHeadingLevel(t) > 0) return 10;
    // Bullet list → estimate first 2 bullets
    if (t.startsWith("- ") || t.startsWith("* ") || /^\d+\.\s/.test(t)) {
      this.doc.setFontSize(FONT.BODY);
      const ls = this.doc.splitTextToSize(sanitizeText(stripMarkdown(t.replace(/^[-*\d.]\s*/, ""))), CONTENT_W - 10);
      return Math.min(ls.length, 3) * SP.LINE_H + SP.BULLET_GAP + 10;
    }
    // Regular paragraph → estimate first line
    this.doc.setFontSize(FONT.BODY);
    const ls = this.doc.splitTextToSize(sanitizeText(stripMarkdown(t)), CONTENT_W);
    return Math.min(ls.length, 3) * SP.LINE_H + 8;
  }

  drawPageChrome() {
    // Subtle left sidebar accent
    this.doc.setFillColor(...C.NAVY);
    this.doc.rect(0, 0, 4, PAGE_H, "F");
    this.doc.setFillColor(...C.NAVY_MID);
    this.doc.rect(0, 0, 1.5, PAGE_H, "F");
    // Top rule
    this.doc.setFillColor(...C.NAVY_LIGHT);
    this.doc.rect(4, 0, PAGE_W - 4, 0.8, "F");
    // Footer area
    this.doc.setFillColor(...C.NAVY);
    this.doc.rect(0, PAGE_H - 8, PAGE_W, 8, "F");
    // Page number
    this.doc.setFontSize(8);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...C.WHITE);
    this.doc.text(`${this.pageNum}`, PAGE_W / 2, PAGE_H - 3, { align: "center" });
    // BUG #6 FIX: reset font/size after footer so first element on new page never inherits 8pt Bold
    this.doc.setTextColor(...C.TEXT_BODY);
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(FONT.BODY);
  }

  // ── Cover page ──────────────────────────────────────────────────────

  renderTitlePage(title: string, description: string | null, language: string) {
    // Full navy top band: top 45% of page
    const bandH = PAGE_H * 0.46;
    this.doc.setFillColor(...C.NAVY);
    this.doc.rect(0, 0, PAGE_W, bandH, "F");

    // Diagonal wave accent at band bottom
    this.doc.setFillColor(...C.NAVY_MID);
    this.doc.rect(0, bandH - 6, PAGE_W, 6, "F");
    // Gold accent stripe
    this.doc.setFillColor(...C.ACCENT);
    this.doc.rect(0, bandH, PAGE_W, 3, "F");

    // Lighter stripe inside left edge of band (no alpha — jsPDF doesn't support it)
    this.doc.setFillColor(45, 58, 110);
    this.doc.rect(0, 0, 5, bandH, "F");

    // Title text (white, inside band)
    const cleanTitle = sanitizeText(title);
    this.doc.setFontSize(FONT.COVER_TITLE);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...C.WHITE);
    const titleLines = this.doc.splitTextToSize(cleanTitle, CONTENT_W - 10);
    const titleTotalH = titleLines.length * 11;
    const titleStartY = bandH / 2 - titleTotalH / 2 + 5;
    this.doc.text(titleLines, PAGE_W / 2, titleStartY, { align: "center" });

    // Gold underline under title
    const titleEndY = titleStartY + titleTotalH + 2;
    this.doc.setFillColor(...C.ACCENT);
    this.doc.rect(PAGE_W / 2 - 28, titleEndY, 56, 1.5, "F");

    // Description text (below band, on white area)
    if (description) {
      const descY = bandH + 14;
      this.doc.setFontSize(11.5);
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(...C.TEXT_BODY);
      const descLines = this.doc.splitTextToSize(sanitizeText(description), CONTENT_W - 20);
      const maxDescLines = 8;
      this.doc.text(descLines.slice(0, maxDescLines), PAGE_W / 2, descY, { align: "center" });
    }

    // BUG #1 FIX: metadata box (Idioma + Gerado em) removed — not relevant for students

    // Footer
    this.doc.setFillColor(...C.NAVY);
    this.doc.rect(0, PAGE_H - 8, PAGE_W, 8, "F");
    this.doc.setFontSize(8);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...C.WHITE);
    this.doc.text("1", PAGE_W / 2, PAGE_H - 3, { align: "center" });
  }

  // ── Module divider page ─────────────────────────────────────────────

  renderModuleTitle(title: string, moduleIndex: number) {
    this.doc.addPage();
    this.pageNum++;

    // Full page with navy left panel
    const panelW = PAGE_W * 0.42;

    // Navy left panel
    this.doc.setFillColor(...C.NAVY);
    this.doc.rect(0, 0, panelW, PAGE_H, "F");

    // Lighter stripe inside panel
    this.doc.setFillColor(...C.NAVY_MID);
    this.doc.rect(panelW - 10, 0, 10, PAGE_H, "F");

    // Gold accent line at panel edge
    this.doc.setFillColor(...C.ACCENT);
    this.doc.rect(panelW, 0, 2.5, PAGE_H, "F");

    // White right area
    this.doc.setFillColor(...C.WHITE);
    this.doc.rect(panelW + 2.5, 0, PAGE_W - panelW - 2.5, PAGE_H, "F");

    // Module number on left panel (vertical center)
    const numLabel = `MÓDULO`;
    const numStr = String(moduleIndex).padStart(2, "0");
    this.doc.setFontSize(9.5);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...C.ACCENT);
    this.doc.text(numLabel, panelW / 2, PAGE_H / 2 - 16, { align: "center" });

    this.doc.setFontSize(54);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...C.WHITE);
    this.doc.text(numStr, panelW / 2, PAGE_H / 2 + 12, { align: "center" });

    // Decorative lines on left panel
    this.doc.setDrawColor(...C.ACCENT);
    this.doc.setLineWidth(0.5);
    this.doc.line(panelW / 2 - 16, PAGE_H / 2 - 24, panelW / 2 + 16, PAGE_H / 2 - 24);
    this.doc.line(panelW / 2 - 16, PAGE_H / 2 + 22, panelW / 2 + 16, PAGE_H / 2 + 22);

    // Module title on right area
    const rightX = panelW + 14;
    const rightW = PAGE_W - panelW - 14 - 12;
    const cleanTitle = sanitizeText(title.replace(/^M[oó]dulo\s+\d+[:.]\s*/i, ""));

    this.doc.setFontSize(FONT.MODULE_TITLE);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...C.NAVY);
    const titleLines = this.doc.splitTextToSize(cleanTitle, rightW);
    const titleH = titleLines.length * 9;
    this.doc.text(titleLines, rightX, PAGE_H / 2 - titleH / 2, { baseline: "top" });

    // Underline accent on right
    const underY = PAGE_H / 2 - titleH / 2 + titleH + 6;
    this.doc.setFillColor(...C.NAVY_LIGHT);
    this.doc.rect(rightX, underY, 32, 1.2, "F");

    // Footer
    this.doc.setFillColor(...C.NAVY);
    this.doc.rect(0, PAGE_H - 8, PAGE_W, 8, "F");
    this.doc.setFontSize(8);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...C.WHITE);
    this.doc.text(`${this.pageNum}`, PAGE_W / 2, PAGE_H - 3, { align: "center" });
    this.doc.setTextColor(...C.TEXT_BODY);
    // NOTE: content page is created by renderModuleContent, not here
  }

  // ── Headings ────────────────────────────────────────────────────────

  renderHeading(text: string, level: number, extraNeeded = 0) {
    const sizeMap: Record<number, number> = { 2: FONT.H2, 3: FONT.H3, 4: FONT.H4 };
    const fontSize = sizeMap[level] || FONT.BODY;
    const beforeMap: Record<number, number> = { 2: SP.BEFORE_H2, 3: SP.BEFORE_H3, 4: SP.BEFORE_H4 };
    const afterMap: Record<number, number> = { 2: SP.AFTER_H2, 3: SP.AFTER_H3, 4: SP.AFTER_H4 };
    const before = beforeMap[level] || 6;
    const after = afterMap[level] || 4;

    const cleanText = sanitizeText(stripMarkdown(text.replace(/^#{1,6}\s*/, "")));
    this.doc.setFontSize(fontSize);
    const textLines = this.doc.splitTextToSize(cleanText, CONTENT_W);
    const headingH = before + textLines.length * (fontSize * 0.38) + after + (level === 2 ? 5 : 0);

    this.checkPage(headingH + extraNeeded);
    this.y += before;

    if (level === 2) {
      // H2: navy left bar + bold text
      const barH = textLines.length * (fontSize * 0.38) + 4;
      this.doc.setFillColor(...C.NAVY);
      this.doc.rect(MARGIN_L, this.y - 3, 3, barH, "F");
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...C.NAVY);
      this.doc.text(textLines, MARGIN_L + 8, this.y);
      this.y += textLines.length * (fontSize * 0.38) + after + 2;
    } else if (level === 3) {
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...C.NAVY_MID);
      this.doc.text(textLines, MARGIN_L, this.y);
      this.y += textLines.length * (fontSize * 0.38) + after;
    } else {
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...C.TEXT_DARK);
      this.doc.text(textLines, MARGIN_L, this.y);
      this.y += textLines.length * (fontSize * 0.38) + after;
    }

    this.doc.setTextColor(...C.TEXT_BODY);
  }

  // ── Body text ────────────────────────────────────────────────────────

  renderParagraph(text: string) {
    const cleanText = sanitizeText(stripMarkdown(text));
    if (!cleanText) return;

    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...C.TEXT_BODY);
    const lines = this.doc.splitTextToSize(cleanText, CONTENT_W);
    this.checkPage(lines.length * SP.LINE_H + 3);
    this.doc.text(lines, MARGIN_L, this.y);
    this.y += lines.length * SP.LINE_H + SP.AFTER_PARA;
  }

  renderBullet(text: string, indent = 0) {
    const cleanText = sanitizeText(stripMarkdown(text.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "")));
    if (!cleanText) return;

    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...C.TEXT_BODY);

    const indentMm = indent * 5;
    const bulletX = MARGIN_L + 4 + indentMm;
    const textX = MARGIN_L + 10 + indentMm;
    const availW = CONTENT_W - 10 - indentMm;
    const lines = this.doc.splitTextToSize(cleanText, availW);
    // BUG #3 FIX: +8mm orphan buffer — any bullet that can't fit with room for one sibling
    // moves to the next page, preventing isolated last-bullets on near-blank pages
    this.checkPage(lines.length * SP.LINE_H + SP.BULLET_GAP + 8);

    this.doc.setFillColor(...C.NAVY_MID);
    this.doc.circle(bulletX, this.y - 1.2, 0.85, "F");
    this.doc.text(lines, textX, this.y);
    this.y += lines.length * SP.LINE_H + SP.BULLET_GAP;
  }

  renderBlockquote(text: string) {
    const cleanText = sanitizeText(stripMarkdown(text.replace(/^>\s*/, "")));
    if (!cleanText) return;

    this.doc.setFontSize(FONT.SMALL);
    this.doc.setFont("helvetica", "italic");
    const lines = this.doc.splitTextToSize(cleanText, CONTENT_W - 16);
    const blockH = lines.length * 4.5 + SP.BOX_V * 2;
    this.checkPage(blockH + 4);

    this.doc.setFillColor(...C.BG_NOTE);
    this.doc.roundedRect(MARGIN_L, this.y - SP.BOX_V, CONTENT_W, blockH, 2, 2, "F");
    this.doc.setFillColor(...C.BAR_NOTE);
    this.doc.roundedRect(MARGIN_L, this.y - SP.BOX_V, 3, blockH, 1.5, 1.5, "F");
    this.doc.setTextColor(60, 60, 85);
    this.doc.text(lines, MARGIN_L + SP.BOX_H + 2, this.y + 1);
    this.y += blockH + 6;
    this.doc.setTextColor(...C.TEXT_BODY);
  }

  // ── Pedagogical box ─────────────────────────────────────────────────

  renderPedagogicalBox(label: string, bodyLines: string[], blockType: BlockType) {
    const bgMap: Record<string, readonly [number, number, number]> = {
      example: C.BG_EXAMPLE, reflection: C.BG_REFLECTION, summary: C.BG_SUMMARY,
      takeaways: C.BG_TAKEAWAY, tip: C.BG_TIP, note: C.BG_NOTE,
    };
    const barMap: Record<string, readonly [number, number, number]> = {
      example: C.BAR_EXAMPLE, reflection: C.BAR_REFLECTION, summary: C.BAR_SUMMARY,
      takeaways: C.BAR_TAKEAWAY, tip: C.BAR_TIP, note: C.BAR_NOTE,
    };
    const bt = blockType || "note";
    const bg = bgMap[bt] || C.BG_NOTE;
    const bar = barMap[bt] || C.BAR_NOTE;

    this.doc.setFontSize(FONT.BLOCK_LABEL);
    this.doc.setFont("helvetica", "bold");
    const labelClean = sanitizeText(stripMarkdown(label));
    const labelLines = this.doc.splitTextToSize(labelClean, CONTENT_W - 18);
    const labelH = labelLines.length * 4.5;

    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont("helvetica", "normal");
    const bodyH = bodyLines.reduce((sum, line) => {
      const ls = this.doc.splitTextToSize(sanitizeText(stripMarkdown(line)), CONTENT_W - 18);
      return sum + ls.length * SP.LINE_H + 2;
    }, 0);

    const totalH = SP.BOX_V + labelH + 4 + bodyH + SP.BOX_V;
    this.checkPage(totalH + 4);

    const boxY = this.y - 2;
    this.doc.setFillColor(...bg);
    this.doc.roundedRect(MARGIN_L, boxY, CONTENT_W, totalH, 2.5, 2.5, "F");
    this.doc.setFillColor(...bar);
    this.doc.roundedRect(MARGIN_L, boxY, 3.5, totalH, 1.5, 1.5, "F");

    this.doc.setFontSize(FONT.BLOCK_LABEL);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...(bar as [number, number, number]));
    const innerX = MARGIN_L + SP.BOX_H + 2;
    let curY = boxY + SP.BOX_V + 3;
    this.doc.text(labelLines, innerX, curY);
    curY += labelH + 4;

    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...C.TEXT_BODY);
    for (const line of bodyLines) {
      const clean = sanitizeText(stripMarkdown(line));
      if (!clean) { curY += 2; continue; }
      const isBullet = line.trim().startsWith("- ") || line.trim().startsWith("* ") || /^\d+\.\s/.test(line.trim());
      if (isBullet) {
        const bulletText = clean.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "");
        const ls = this.doc.splitTextToSize(bulletText, CONTENT_W - 24);
        this.doc.setFillColor(...bar);
        this.doc.circle(innerX + 2, curY - 1, 0.7, "F");
        this.doc.setTextColor(...C.TEXT_BODY);
        this.doc.text(ls, innerX + 7, curY);
        curY += ls.length * SP.LINE_H + SP.BULLET_GAP;
      } else {
        const ls = this.doc.splitTextToSize(clean, CONTENT_W - 18);
        this.doc.text(ls, innerX, curY);
        curY += ls.length * SP.LINE_H + 2;
      }
    }

    this.y = boxY + totalH + 8;
  }

  // ── Code block (BUG #2 + #5 FIX) ───────────────────────────────────
  // Renders fenced code verbatim — no stripMarkdown, no HTML escape,
  // so operators like > and < are preserved exactly as written.
  renderCodeBlock(code: string) {
    const rawLines = code.split("\n");
    // Trim trailing blank lines
    while (rawLines.length && !rawLines[rawLines.length - 1].trim()) rawLines.pop();
    if (!rawLines.length) return;

    const lineH = 4.2;
    const padV = 5;
    const padH = 8;
    const totalH = rawLines.length * lineH + padV * 2;

    this.checkPage(Math.min(totalH + 6, 55));
    this.y += 3;

    // Dark background box (sized to available space on current page)
    const availH = MAX_Y - this.y - padV;
    this.doc.setFillColor(30, 36, 55);
    this.doc.roundedRect(MARGIN_L, this.y - padV, CONTENT_W, Math.min(totalH, availH + padV), 2, 2, "F");

    this.doc.setFontSize(8.5);
    this.doc.setFont("courier", "normal");
    this.doc.setTextColor(210, 215, 240);

    let codeY = this.y;
    for (const line of rawLines) {
      if (codeY + lineH > MAX_Y - 4) {
        this.addPage();
        // Re-draw background on continuation page
        const remLines = rawLines.slice(rawLines.indexOf(line));
        const remH = remLines.length * lineH + padV * 2;
        this.doc.setFillColor(30, 36, 55);
        this.doc.roundedRect(MARGIN_L, this.y - padV, CONTENT_W, Math.min(remH, MAX_Y - this.y - padV + padV), 2, 2, "F");
        this.doc.setFontSize(8.5);
        this.doc.setFont("courier", "normal");
        this.doc.setTextColor(210, 215, 240);
        codeY = this.y;
      }
      // Use sanitizeText (removes emojis/bad chars) but NOT stripMarkdown — preserves > < operators
      this.doc.text(sanitizeText(line), MARGIN_L + padH, codeY);
      codeY += lineH;
    }

    this.y = codeY + padV + 5;
    // Reset to body style after code block
    this.doc.setTextColor(...C.TEXT_BODY);
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(FONT.BODY);
  }

  renderHorizontalRule() {
    this.checkPage(10);
    this.y += 4;
    this.doc.setDrawColor(...C.BORDER);
    this.doc.setLineWidth(0.3);
    this.doc.line(MARGIN_L + 20, this.y, PAGE_W - MARGIN_R - 20, this.y);
    this.y += SP.SECTION_GAP;
  }

  // ── Table ────────────────────────────────────────────────────────────

  renderTable(table: ParsedTable) {
    const { headers, rows } = table;
    const numCols = headers.length;
    const colWidths: number[] = [];
    const firstRatio = numCols <= 2 ? 0.35 : numCols <= 3 ? 0.30 : 0.25;
    colWidths.push(CONTENT_W * firstRatio);
    const remaining = CONTENT_W - colWidths[0];
    for (let i = 1; i < numCols; i++) colWidths.push(remaining / (numCols - 1));

    const headerH = 10;
    const rowHeights: number[] = [];
    for (const row of rows) {
      this.doc.setFontSize(FONT.TABLE_B);
      let maxLines = 1;
      for (let c = 0; c < numCols; c++) {
        const cellText = sanitizeText(stripMarkdown(row[c] || ""));
        const lines = this.doc.splitTextToSize(cellText, colWidths[c] - 8);
        if (lines.length > maxLines) maxLines = Math.min(lines.length, 4);
      }
      rowHeights.push(Math.max(9, maxLines * SP.TABLE_LINE + SP.TABLE_ROW_PAD * 2));
    }

    const totalTableH = headerH + rowHeights.reduce((a, b) => a + b, 0) + 4;
    if (totalTableH < MAX_Y - MARGIN_T) this.checkPage(totalTableH);
    else this.checkPage(Math.min(totalTableH, headerH + rowHeights[0] + 20));

    this.y += 3;
    const startX = MARGIN_L;
    let currentY = this.y;

    const drawHeader = (atY: number): number => {
      this.doc.setFillColor(...C.TABLE_HEAD);
      this.doc.roundedRect(startX, atY, CONTENT_W, headerH, 2, 2, "F");
      this.doc.rect(startX, atY + headerH - 2, CONTENT_W, 2, "F");
      this.doc.setFontSize(FONT.TABLE_H);
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...C.WHITE);
      let hx = startX;
      for (let c = 0; c < numCols; c++) {
        const txt = sanitizeText(stripMarkdown(headers[c] || ""));
        this.doc.text(txt.slice(0, 40), hx + 4, atY + 6.5);
        hx += colWidths[c];
      }
      return atY + headerH;
    };

    currentY = drawHeader(currentY);

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const rowH = rowHeights[r];

      if (currentY + rowH > MAX_Y) {
        const partH = currentY - this.y;
        this.doc.setDrawColor(...C.BORDER_TABLE);
        this.doc.setLineWidth(0.3);
        this.doc.rect(startX, this.y, CONTENT_W, partH);
        this.addPage();
        currentY = this.y;
        currentY = drawHeader(currentY);
      }

      this.doc.setFillColor(...(r % 2 === 0 ? C.TABLE_ZEBRA : C.WHITE));
      this.doc.rect(startX, currentY, CONTENT_W, rowH, "F");
      this.doc.setFillColor(...C.TABLE_COL1);
      this.doc.rect(startX, currentY, colWidths[0], rowH, "F");

      let colX = startX;
      for (let c = 0; c < numCols; c++) {
        const cellText = sanitizeText(stripMarkdown(row[c] || ""));
        this.doc.setFontSize(FONT.TABLE_B);
        const lines = this.doc.splitTextToSize(cellText, colWidths[c] - 8).slice(0, 4);
        if (c === 0) {
          this.doc.setFont("helvetica", "bold");
          this.doc.setTextColor(...C.NAVY);
        } else {
          this.doc.setFont("helvetica", "normal");
          this.doc.setTextColor(...C.TEXT_BODY);
        }
        for (let l = 0; l < lines.length; l++) {
          this.doc.text(lines[l], colX + 4, currentY + SP.TABLE_ROW_PAD + 3 + l * SP.TABLE_LINE);
        }
        colX += colWidths[c];
      }

      this.doc.setDrawColor(...C.BORDER);
      this.doc.setLineWidth(0.15);
      this.doc.line(startX, currentY + rowH, startX + CONTENT_W, currentY + rowH);
      currentY += rowH;
    }

    const totalH = currentY - this.y;
    this.doc.setDrawColor(...C.BORDER_TABLE);
    this.doc.setLineWidth(0.35);
    this.doc.roundedRect(startX, this.y, CONTENT_W, totalH, 1.5, 1.5);

    let colX = startX;
    for (let c = 0; c < numCols - 1; c++) {
      colX += colWidths[c];
      this.doc.setDrawColor(...C.BORDER);
      this.doc.setLineWidth(0.15);
      this.doc.line(colX, this.y + headerH, colX, this.y + totalH);
    }

    // BUG #7 FIX: increase post-table spacing so text never collides with table border
    this.y = currentY + SP.SECTION_GAP + 4;
  }

  // ── Module content ───────────────────────────────────────────────────

  renderModuleContent(content: string, moduleTitle: string) {
    // Create the content page here (module divider does NOT create it)
    this.addPage();
    this.y = MARGIN_T;

    // Normalise literal escape sequences stored in DB (\\n → real newline, \\t → space)
    let normContent = content
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, " ")
      .replace(/:\n+\d+\./g, ":");  // remove list-number artefacts after colons

    // ── PRE-EXTRACT code fences (Bug #2 + #5 fix) ─────────────────────────
    // Extract ALL fenced code blocks BEFORE any line-by-line processing.
    // This guarantees:
    //   • The language identifier (```sql, ```python…) is never emitted as text.
    //   • Operators like > and < inside code are never stripped by stripMarkdown.
    // Each block is replaced by a single-line placeholder and stored verbatim.
    const codeBlockStore: string[] = [];
    const CB_START = "[[CODEBLOCK_";
    const CB_END   = "]]";
    normContent = normContent.replace(
      /```(\w*)[^\n]*\n([\s\S]*?)```/gm,
      (_fullMatch, _lang, code) => {
        const idx = codeBlockStore.length;
        codeBlockStore.push(code.replace(/\n$/, "")); // store verbatim, strip final newline only
        return `${CB_START}${idx}${CB_END}`;
      }
    );
    // ── END pre-extraction ─────────────────────────────────────────────────

    const lines = normContent.split("\n");
    const normModuleTitle = normalizeTitle(moduleTitle);
    let i = 0;
    let skippedFirstH1 = false;

    while (i < lines.length) {
      const trimmed = lines[i].trim();

      // Blank lines: advance y but never past the content boundary
      if (!trimmed) {
        if (this.y + 2.5 < MAX_Y - 10) this.y += 2.5;
        i++;
        continue;
      }

      // Code block placeholder — restored verbatim, no stripMarkdown applied
      if (trimmed.startsWith(CB_START) && trimmed.endsWith(CB_END)) {
        const idxStr = trimmed.slice(CB_START.length, -CB_END.length);
        const idx = parseInt(idxStr, 10);
        if (!isNaN(idx) && codeBlockStore[idx] !== undefined) {
          this.renderCodeBlock(codeBlockStore[idx]);
        }
        i++;
        continue;
      }

      // Table detection
      if (trimmed.includes("|") && i + 1 < lines.length && lines[i + 1]?.includes("|")) {
        const { table, endIndex } = parseMarkdownTable(lines, i);
        if (table) { this.renderTable(table); i = endIndex + 1; continue; }
      }

      // Headings
      const headingLevel = getHeadingLevel(trimmed);
      if (headingLevel > 0) {
        // Skip first H1/H2 that duplicates the module title
        if (!skippedFirstH1 && (headingLevel === 1 || headingLevel === 2)) {
          const normContent = normalizeTitle(trimmed);
          if (
            normContent === normModuleTitle ||
            normContent.includes(normModuleTitle) ||
            normModuleTitle.includes(normContent)
          ) {
            skippedFirstH1 = true;
            i++;
            continue;
          }
        }
        skippedFirstH1 = true;

        const followH = this.estimateFollowHeight(lines, i + 1);
        this.renderHeading(trimmed, headingLevel === 1 ? 2 : headingLevel, followH);
        i++;
        continue;
      }

      // Pedagogical blocks
      const blockType = detectBlock(trimmed);
      if (blockType) {
        const label = trimmed;
        const bodyLines: string[] = [];
        let j = i + 1;
        let emptyCount = 0;
        while (j < lines.length) {
          const t = lines[j].trim();
          if (!t) { emptyCount++; if (emptyCount >= 2) break; j++; continue; }
          emptyCount = 0;
          if (getHeadingLevel(t) > 0) break;
          if (detectBlock(t)) break;
          if (t === "---" || t === "***" || t === "___") break;
          bodyLines.push(t);
          j++;
        }
        if (bodyLines.length > 0) this.renderPedagogicalBox(label, bodyLines, blockType);
        else this.renderParagraph(label);
        i = j;
        continue;
      }

      // Blockquote
      if (trimmed.startsWith("> ")) {
        let quoteText = trimmed.replace(/^>\s*/, "");
        let j = i + 1;
        while (j < lines.length && lines[j]?.trim().startsWith("> ")) {
          quoteText += " " + lines[j].trim().replace(/^>\s*/, "");
          j++;
        }
        this.renderBlockquote(quoteText);
        i = j;
        continue;
      }

      // Bullets
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        this.renderBullet(trimmed);
        i++;
        continue;
      }

      // Numbered list
      if (/^\d+\.\s/.test(trimmed)) {
        this.renderBullet("- " + trimmed.replace(/^\d+\.\s*/, ""));
        i++;
        continue;
      }

      // Horizontal rule
      if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
        this.renderHorizontalRule();
        i++;
        continue;
      }

      // Regular paragraph
      this.renderParagraph(trimmed);
      i++;
    }
  }

  output(): ArrayBuffer {
    return this.doc.output("arraybuffer");
  }
}

// ── Main handler ─────────────────────────────────────────────────────────

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

    const { data: course, error: courseErr } = await serviceClient
      .from("courses").select("*").eq("id", course_id).eq("user_id", userId).single();

    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: modulesRaw } = await serviceClient
      .from("course_modules").select("*").eq("course_id", course_id).order("order_index");
    const modules: any[] = modulesRaw ?? [];

    // Generate PDF
    const pdf = new PdfRenderer();
    pdf.renderTitlePage(course.title, course.description, course.language || "pt-BR");

    modules.forEach((mod, idx) => {
      pdf.renderModuleTitle(mod.title, idx + 1);
      if (mod.content) {
        pdf.renderModuleContent(mod.content, mod.title);
      }
    });

    const pdfBytes = pdf.output();
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = `${userId}/${safeName} - PDF - ${dateStr}.pdf`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports").upload(fileName, pdfBytes, { contentType: "application/pdf", upsert: true });

    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports").createSignedUrl(fileName, 3600);

    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: userId, event_type: "COURSE_EXPORTED_PDF", metadata: { course_id },
    });

    return new Response(JSON.stringify({ url: signedUrl.signedUrl }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Export PDF error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
