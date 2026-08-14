import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";

// Self-contained (no ../_shared import) so this function can be deployed by
// pasting THIS single file into the Supabase Dashboard editor.
function _headingKey(s: string): string {
  return (s || "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^m[óo]dul[oe]\s*\d+\s*[:.\-–—]\s*/i, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim().toLowerCase();
}
/** Strip a stray ```markdown wrapper fence + a leading heading that just repeats
 *  the module title (every consumer already renders the title). */
function cleanModuleContent(content: string, title?: string): string {
  let c = (content || "").trim();
  if (/^```/.test(c)) {
    c = c.replace(/^```[a-zA-Z]*[ \t]*\n?/, "").replace(/\n?```[ \t]*$/, "").trim();
  }
  if (title) {
    const lines = c.split("\n");
    let k = 0;
    while (k < lines.length && !lines[k].trim()) k++;
    if (
      k < lines.length && /^#{1,3}\s+/.test(lines[k]) &&
      _headingKey(title).length > 0 && _headingKey(lines[k]) === _headingKey(title)
    ) {
      lines.splice(0, k + 1);
      while (lines.length && !lines[0].trim()) lines.shift();
      c = lines.join("\n").trim();
    }
  }
  return c;
}

// TESTING_MODE: fase de testes sem usuários reais — libera o gate de plano Pro
// do export de PDF (espelha generate-course / upload-course-source). Voltar para
// `false` para reativar a monetização.
const TESTING_MODE = true;

// Build marker — surfaced on EVERY response header (x-export-pdf-build) so you
// can confirm in F12 → Network which code is actually live after a deploy.
const EXPORT_PDF_BUILD = "2026-06-21i";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-export-pdf-build",
  "x-export-pdf-build": EXPORT_PDF_BUILD,
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
    // Bold/italic: the asterisks must HUG non-space content, so Python operators
    // ("5 ** 2", "a * b") are preserved while real **bold**/*italic* is stripped.
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1")
    .replace(/\*(?=\S)([^*]+?)(?<=\S)\*/g, "$1")
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

  // "| a | b | c |" produz uma célula vazia em cada ponta; "a | b | c" não
  // produz nenhuma. O filtro anterior era `i > 0 && i < arr.length`, e a segunda
  // condição é sempre verdadeira — a célula vazia do FIM sobrevivia, e toda
  // tabela ganhava uma coluna fantasma. Com 3 colunas reais a largura passava a
  // ser dividida por 4 e a coluna de conteúdo perdia 29% do espaço; numa rubrica
  // de 5 colunas sobravam 16 mm por descritor, o bastante para ~9 caracteres por
  // linha. E como o índice 0 era descartado sem checar se estava vazio, uma
  // tabela escrita sem as barras das pontas perdia a primeira coluna de verdade.
  //
  // Remover apenas o que está de fato vazio nas pontas cobre os dois formatos.
  const parsePipeRow = (line: string): string[] => {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length && cells[0] === "") cells.shift();
    if (cells.length && cells[cells.length - 1] === "") cells.pop();
    return cells;
  };

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
  PRIMARY: [18, 24, 68] as const,          // Deep navy (richer)
  PRIMARY_LIGHT: [45, 55, 120] as const,
  ACCENT: [196, 152, 40] as const,         // Gold accent
  ACCENT_LIGHT: [220, 185, 90] as const,
  MODULE_BG: [22, 28, 75] as const,        // Slightly lighter navy for module banners
  TEXT_DARK: [20, 20, 28] as const,
  TEXT_BODY: [40, 42, 52] as const,
  TEXT_MUTED: [105, 108, 125] as const,
  TEXT_WHITE: [255, 255, 255] as const,
  TEXT_LIGHT: [200, 210, 235] as const,    // Light text on dark backgrounds
  BG_EXAMPLE: [232, 246, 236] as const,
  BG_REFLECTION: [238, 234, 252] as const,
  BG_SUMMARY: [232, 242, 254] as const,
  BG_TAKEAWAY: [252, 244, 225] as const,
  BG_TIP: [255, 241, 225] as const,
  BG_NOTE: [240, 240, 248] as const,
  BAR_EXAMPLE: [35, 130, 65] as const,
  BAR_REFLECTION: [105, 65, 175] as const,
  BAR_SUMMARY: [35, 95, 175] as const,
  BAR_TAKEAWAY: [195, 145, 25] as const,
  BAR_TIP: [215, 115, 25] as const,
  BAR_NOTE: [95, 95, 125] as const,
  TABLE_HEADER: [18, 24, 68] as const,
  TABLE_ZEBRA: [244, 244, 252] as const,
  TABLE_FIRST_COL: [230, 230, 246] as const,
  BORDER_LIGHT: [208, 208, 222] as const,
  BORDER_TABLE: [180, 180, 200] as const,
  BG_CODE: [20, 26, 60] as const,
  CODE_TEXT: [220, 230, 248] as const,
  CODE_BORDER: [38, 46, 90] as const,
};

// ── PDF renderer ──────────────────────────────────────────────────────

class PdfRenderer {
  doc: any;
  y: number;
  pageNum: number;
  courseTitle: string = "";
  moduleIndex: number = 0;

  constructor() {
    this.doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    this.y = MARGIN_TOP;
    this.pageNum = 1;
  }

  // ── Page management ──────────────────────────────────────────────

  addPage() {
    this.doc.addPage();
    this.pageNum++;
    this.drawPageHeader();
    this.drawFooter();
    this.y = MARGIN_TOP;
  }

  checkPage(needed: number) {
    if (this.y + needed > MAX_Y) this.addPage();
  }

  drawPageHeader() {
    // Thin navy bar at top — decorative only, no text (tiny text is distracting in viewers)
    this.doc.setFillColor(...COLOR.PRIMARY);
    this.doc.rect(0, 0, PAGE_W, 7, "F");
    // Gold accent stripe
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(0, 7, PAGE_W, 0.8, "F");
    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  drawFooter() {
    // Bottom navy bar
    this.doc.setFillColor(...COLOR.PRIMARY);
    this.doc.rect(0, 290, PAGE_W, 7, "F");
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(0, 290, PAGE_W, 0.8, "F");
    // Page number
    this.doc.setFontSize(7.5);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...COLOR.TEXT_WHITE);
    this.doc.text(`${this.pageNum}`, PAGE_W / 2, 294.5, { align: "center" });
    // CRITICAL: reset font to normal so estimation helpers after addPage()
    // use the correct font metrics (bold width ≠ normal width → wrong line counts → orphaning)
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(FONT.BODY);
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

  // "Keep-with-next" height for a heading: accumulate the following blocks
  // (intro paragraph + its table/list/etc.) up to a target, so a heading is never
  // stranded at the page bottom with only a one-line intro while the real content
  // (a table) starts on the next page. Capped so a tall table doesn't force a
  // needless break — we only need to guarantee a meaningful chunk stays together.
  estimateKeepHeight(lines: string[], fromIdx: number): number {
    const TARGET = 30; // mm of content to keep under a heading
    let total = 0, j = fromIdx, guard = 0;
    while (j < lines.length && total < TARGET && guard < 5) {
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length) break;
      const t = lines[j].trim();
      if (getHeadingLevel(t) > 0) break; // next heading — stop accumulating
      if (t === "---" || t === "***" || t === "___") { j++; continue; }

      // table
      if (t.includes("|") && lines[j + 1]?.includes("|")) {
        const { table, endIndex } = parseMarkdownTable(lines, j);
        if (table) { total += Math.min(80, 10 + table.rows.length * 12); j = endIndex + 1; guard++; continue; }
      }
      // bullet / numbered run
      if (t.startsWith("- ") || t.startsWith("* ") || /^\d+\.\s/.test(t)) {
        while (j < lines.length) {
          const tt = lines[j].trim();
          if (!tt || getHeadingLevel(tt) > 0) break;
          if (tt.startsWith("- ") || tt.startsWith("* ") || /^\d+\.\s/.test(tt)) { total += this.estimateBulletHeight(tt); j++; }
          else break;
        }
        guard++; continue;
      }
      // blockquote
      if (t.startsWith("> ")) {
        let txt = t.replace(/^>\s*/, ""); j++;
        while (j < lines.length && lines[j].trim().startsWith("> ")) { txt += " " + lines[j].trim().replace(/^>\s*/, ""); j++; }
        total += this.estimateTextHeight(txt, FONT.SMALL, CONTENT_W - 16, 4.5) + 12; guard++; continue;
      }
      // paragraph
      total += this.estimateTextHeight(t, FONT.BODY, CONTENT_W, SP.LINE_HEIGHT); j++; guard++;
    }
    return Math.min(total, TARGET);
  }

  // ── Title page ────────────────────────────────────────────────────

  renderTitlePage(title: string, description: string | null, language: string) {
    // Full-height navy background (top 2/3)
    this.doc.setFillColor(...COLOR.PRIMARY);
    this.doc.rect(0, 0, PAGE_W, 185, "F");

    // Gold accent left bar
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(MARGIN_LEFT, 55, 3, 90, "F");

    // Gold horizontal divider
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(0, 185, PAGE_W, 1.5, "F");

    // Subtle geometric accent: small dots pattern (top-right)
    this.doc.setFillColor(30, 38, 95);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        this.doc.circle(PAGE_W - 18 + col * 6, 20 + row * 6, 1, "F");
      }
    }

    // Course title — white, large, left-aligned
    this.doc.setFontSize(28);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...COLOR.TEXT_WHITE);
    const titleLines = this.doc.splitTextToSize(sanitizeText(title), CONTENT_W - 20);
    const titleY = 82;
    this.doc.text(titleLines, MARGIN_LEFT + 10, titleY);

    // Gold line under title
    const underY = titleY + titleLines.length * 11 + 5;
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(MARGIN_LEFT + 10, underY, 45, 1, "F");

    // Description — light text, left-aligned
    if (description) {
      this.doc.setFontSize(10.5);
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(...COLOR.TEXT_LIGHT);
      const descLines = this.doc.splitTextToSize(sanitizeText(description), CONTENT_W - 14);
      this.doc.text(descLines, MARGIN_LEFT + 10, underY + 14);
    }

    // White section — metadata
    this.doc.setFontSize(9);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...COLOR.TEXT_MUTED);
    this.doc.text(`Idioma: ${language}`, MARGIN_LEFT, 202);
    this.doc.text(new Date().toLocaleDateString("pt-BR"), MARGIN_LEFT, 210);

    // Premium footer bar
    this.doc.setFillColor(...COLOR.PRIMARY);
    this.doc.rect(0, 287, PAGE_W, 10, "F");
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(0, 287, PAGE_W, 1.5, "F");

    // Page number on cover
    this.doc.setFontSize(7.5);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...COLOR.TEXT_WHITE);
    this.doc.text("1", PAGE_W / 2, 293, { align: "center" });
    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  // ── Module title ──────────────────────────────────────────────────

  renderModuleTitle(title: string) {
    this.addPage();

    // Marcador de navegação do módulo. Num documento de 75 páginas o painel
    // lateral do leitor ficava vazio, e a única navegação era o sumário da
    // página 2 — para trocar de módulo o aluno tinha que rolar o documento.
    try {
      this.doc.outline?.add?.(null, `${this.moduleIndex}. ${title}`, {
        pageNumber: this.pageNum,
      });
    } catch {
      // Outline é conveniência de navegação; nunca pode custar o PDF.
    }

    // Full navy banner across top (covers page header from addPage)
    this.doc.setFillColor(...COLOR.MODULE_BG);
    this.doc.rect(0, 0, PAGE_W, 52, "F");

    // Gold accent left bar
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(0, 0, 4, 52, "F");

    // Gold bottom edge of banner
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(0, 52, PAGE_W, 1, "F");

    // Module number badge (large, semi-transparent)
    if (this.moduleIndex > 0) {
      this.doc.setFontSize(48);
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(30, 38, 95); // dark overlay on navy
      const numStr = String(this.moduleIndex).padStart(2, "0");
      this.doc.text(numStr, PAGE_W - MARGIN_RIGHT, 46, { align: "right" });
    }

    // "MÓDULO N" label — 9.5pt so it reads cleanly alongside 10.5pt body
    this.doc.setFontSize(9.5);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...COLOR.ACCENT);
    if (this.moduleIndex > 0) {
      this.doc.text(`MÓDULO ${this.moduleIndex}`, MARGIN_LEFT + 8, 16);
    }

    // Module title — white, bold
    this.doc.setFontSize(FONT.MODULE_TITLE);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...COLOR.TEXT_WHITE);
    const lines = this.doc.splitTextToSize(sanitizeText(title), CONTENT_W - 22);
    this.doc.text(lines, MARGIN_LEFT + 8, this.moduleIndex > 0 ? 28 : 22);

    // Reset y below banner for content
    this.y = 62;
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

    // Word-width measurement for justification.
    // Primary: doc.getTextWidth (returns mm in jsPDF 2.x).
    // Fallback: character-count estimate using Helvetica average glyph width (0.48em).
    // This avoids relying on getStringUnitWidth which can return 0 in Deno/esm.sh contexts.
    const SF = 72 / 25.4; // mm per point (jsPDF scale factor for mm units)
    const wordWidthMm = (w: string): number => {
      try {
        const tw: number = this.doc.getTextWidth(w);
        if (tw > 0 && tw < 40) return tw;
      } catch (_) {}
      // Fallback: 0.48em avg char width for Helvetica mixed-case Latin text
      return w.length * FONT.BODY * 0.48 / SF;
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const isLastLine = idx === lines.length - 1;
      const trimmedLine = line.trim();
      const words = trimmedLine.split(/\s+/);
      // Justify all lines except the last, and only when >= 3 words
      if (!isLastLine && words.length >= 3) {
        const totalWordW = words.reduce((s, w) => s + wordWidthMm(w), 0);
        const gap = (CONTENT_W - totalWordW) / (words.length - 1);
        // Accept gap 0.3–12 mm: below 0.3 means words overlap; above 12 means
        // the line is too short (3–4 short words) and justification looks stretched.
        // 12 mm headroom handles lines with wider Portuguese words (transformação, etc.).
        if (gap >= 0.3 && gap <= 12) {
          let x = MARGIN_LEFT;
          for (let w = 0; w < words.length; w++) {
            this.doc.text(words[w], x, this.y);
            x += wordWidthMm(words[w]) + gap;
          }
          this.y += SP.LINE_HEIGHT;
          continue;
        }
      }
      this.doc.text(trimmedLine, MARGIN_LEFT, this.y);
      this.y += SP.LINE_HEIGHT;
    }
    this.y += SP.AFTER_PARAGRAPH;
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

    // Uma grade de 5 colunas de prosa não cabe em retrato com fonte legível:
    // sobram ~24 mm por coluna, e "O mapeamento do processo é claro" sai
    // quebrado no meio das palavras. A rubrica do projeto final — justamente o
    // texto contra o qual o aluno é avaliado — era a principal vítima. Acima do
    // limite, cada linha vira um bloco empilhado, que é legível em qualquer
    // largura.
    if (numCols >= 5) return this.renderTableAsBlocks(table);

    // Column widths - first column wider for "Aspecto" pattern
    const colWidths: number[] = [];
    const firstRatio = numCols <= 2 ? 0.35 : numCols <= 3 ? 0.30 : 0.25;
    colWidths.push(CONTENT_W * firstRatio);
    const remaining = CONTENT_W - colWidths[0];
    for (let i = 1; i < numCols; i++) colWidths.push(remaining / (numCols - 1));

    // Com 4 colunas o corpo a 9 pt rende ~17 caracteres por linha. Reduzir um
    // ponto devolve espaço sem prejudicar a leitura — a tabela é conteúdo de
    // apoio, e o texto corrido em volta segue no tamanho normal.
    const bodySize = numCols >= 4 ? FONT.TABLE_BODY - 1.5 : FONT.TABLE_BODY;
    const cellPad = numCols >= 4 ? 5 : 8;

    // Teto de linhas por célula. Antes era um `.slice(0, 4)` fixo, sem
    // reticências e com a altura da linha calculada já com o corte: o texto
    // sumia sem deixar rastro, e num glossário isso significava oito verbetes
    // terminando no meio da frase. O teto agora é o que cabe numa página, de
    // modo que só perde texto quem realmente não caberia de jeito nenhum.
    const maxCellLines = Math.max(
      4,
      Math.floor((MAX_Y - MARGIN_TOP - 10 - SP.TABLE_ROW_PAD * 2) / SP.TABLE_CELL_LINE),
    );

    /** Quebra uma célula, marcando com reticências quando de fato cortou. */
    const wrapCell = (text: string, width: number): string[] => {
      this.doc.setFontSize(bodySize);
      const all = this.doc.splitTextToSize(sanitizeText(stripMarkdown(text || "")), width);
      if (all.length <= maxCellLines) return all;
      const kept = all.slice(0, maxCellLines);
      kept[kept.length - 1] = String(kept[kept.length - 1]).replace(/[\s,;:]+$/, "") + "…";
      return kept;
    };

    // Pre-measure all rows to get accurate heights
    const headerH = 10;
    const rowHeights: number[] = [];
    for (const row of rows) {
      let maxLines = 1;
      for (let c = 0; c < numCols; c++) {
        const lines = wrapCell(row[c] || "", colWidths[c] - cellPad);
        if (lines.length > maxLines) maxLines = lines.length;
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

      this.doc.setFontSize(numCols >= 4 ? FONT.TABLE_HEADER - 1.5 : FONT.TABLE_HEADER);
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...COLOR.TEXT_WHITE);

      let hx = startX;
      for (let c = 0; c < numCols; c++) {
        const cellText = sanitizeText(stripMarkdown(headers[c] || ""));
        // Só a primeira linha era desenhada: um título de coluna que quebrasse
        // perdia o resto em silêncio. Desenhamos as duas linhas que a faixa
        // comporta, subindo o texto para mantê-lo centrado.
        const lines = this.doc.splitTextToSize(cellText, colWidths[c] - 6).slice(0, 2);
        const y0 = lines.length > 1 ? atY + 4.4 : atY + 6.5;
        for (let l = 0; l < lines.length; l++) {
          this.doc.text(lines[l], hx + 4, y0 + l * 3.6);
        }
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
        // Mesma quebra usada na pré-medição, para o texto desenhado nunca
        // divergir da altura reservada para ele.
        const lines = wrapCell(row[c] || "", colWidths[c] - cellPad);
        this.doc.setFontSize(bodySize);

        if (c === 0) {
          this.doc.setFont("helvetica", "bold");
          this.doc.setTextColor(...COLOR.PRIMARY);
        } else {
          this.doc.setFont("helvetica", "normal");
          this.doc.setTextColor(...COLOR.TEXT_BODY);
        }

        for (let l = 0; l < lines.length; l++) {
          this.doc.text(lines[l], colX + cellPad / 2, currentY + SP.TABLE_ROW_PAD + 3 + l * SP.TABLE_CELL_LINE);
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

  /**
   * Tabelas largas (5+ colunas) renderizadas como blocos empilhados.
   *
   * Em retrato há 162 mm de largura. Cinco colunas de prosa deixam ~24 mm cada,
   * onde uma palavra como "compreensível" não cabe inteira em uma linha — o
   * jsPDF a parte no meio, e o resultado é ilegível. Era o que acontecia com a
   * rubrica do projeto final, exatamente o texto que o aluno mais precisa ler.
   *
   * Empilhar resolve porque troca o eixo que está faltando: cada linha vira um
   * bloco com a primeira coluna como título e as demais como pares
   * "cabeçalho: valor", cada um com a largura inteira da página. Perde-se a
   * comparação lado a lado; ganha-se poder ler.
   */
  renderTableAsBlocks(table: ParsedTable) {
    const { headers, rows } = table;
    const startX = MARGIN_LEFT;
    const labelW = 34;

    for (const row of rows) {
      const titulo = sanitizeText(stripMarkdown(row[0] || ""));
      // Pares a partir da 2ª coluna, ignorando células vazias.
      const pares: Array<[string, string[]]> = [];
      for (let c = 1; c < headers.length; c++) {
        const valor = sanitizeText(stripMarkdown(row[c] || ""));
        if (!valor) continue;
        this.doc.setFontSize(FONT.SMALL);
        pares.push([
          sanitizeText(stripMarkdown(headers[c] || "")),
          this.doc.splitTextToSize(valor, CONTENT_W - labelW - 10),
        ]);
      }
      if (!titulo && !pares.length) continue;

      const alturaBloco = 9 +
        pares.reduce((a, [, ls]) => a + Math.max(5, ls.length * SP.LINE_HEIGHT) + 2, 0) + 5;
      // Um bloco nunca deve ser partido: é uma unidade de leitura.
      this.checkPage(Math.min(alturaBloco, MAX_Y - MARGIN_TOP));

      const topo = this.y;
      let y = topo + 6;

      // Título do bloco (o critério, no caso da rubrica).
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(FONT.H4);
      this.doc.setTextColor(...COLOR.PRIMARY);
      for (const l of this.doc.splitTextToSize(titulo, CONTENT_W - 14)) {
        this.doc.text(l, startX + 7, y);
        y += SP.LINE_HEIGHT;
      }
      y += 1.5;

      for (const [rotulo, linhas] of pares) {
        this.doc.setFont("helvetica", "bold");
        this.doc.setFontSize(FONT.SMALL);
        this.doc.setTextColor(...COLOR.TEXT_MUTED);
        this.doc.text(
          this.doc.splitTextToSize(rotulo, labelW - 2)[0] || "",
          startX + 7,
          y,
        );
        this.doc.setFont("helvetica", "normal");
        this.doc.setTextColor(...COLOR.TEXT_BODY);
        for (const l of linhas) {
          this.doc.text(l, startX + 7 + labelW, y);
          y += SP.LINE_HEIGHT;
        }
        if (!linhas.length) y += SP.LINE_HEIGHT;
        y += 2;
      }

      // Faixa de destaque à esquerda, no lugar da grade.
      this.doc.setFillColor(...COLOR.ACCENT);
      this.doc.rect(startX, topo, 2.2, y - topo - 1, "F");
      this.doc.setDrawColor(...COLOR.BORDER_LIGHT);
      this.doc.setLineWidth(0.2);
      this.doc.line(startX, y - 1, startX + CONTENT_W, y - 1);

      this.y = y + 3;
    }
    this.y += SP.SECTION_GAP - 3;
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

      // ── Fenced code block ── (preserve indentation; render monospace)
      if (trimmed.startsWith("```")) {
        const codeLines: string[] = [];
        let j = i + 1;
        while (j < lines.length && !lines[j].trim().startsWith("```")) {
          codeLines.push(lines[j]);
          j++;
        }
        this.renderCodeBlock(codeLines);
        i = j < lines.length ? j + 1 : j; // skip closing fence
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

      // ── Headings with cascade look-ahead ──
      const heading = getHeadingLevel(trimmed);
      if (heading > 0) {
        // CASCADE anti-orphan: walk forward through ALL consecutive following headings,
        // summing their heights, then add MIN_KEEP for the first prose block.
        // This ensures: if H2 is followed by H3 which is followed by prose, checkPage
        // for H2 accounts for H2+H3+MIN_KEEP total — so H2 never lands alone at the
        // bottom when H3 (which needs its own keepH) would immediately page-break.
        const MIN_KEEP = 20;
        let cascadeH = 0;
        let k = this.nextNonEmpty(lines, i + 1);
        while (k < lines.length) {
          const t2 = lines[k].trim();
          const lv2 = getHeadingLevel(t2);
          if (lv2 > 0) {
            const hFont2 = lv2 === 2 ? FONT.H2 : lv2 === 3 ? FONT.H3 : lv2 === 4 ? FONT.H4 : FONT.BODY;
            const hBefore2 = lv2 === 2 ? SP.BEFORE_H2 : lv2 === 3 ? SP.BEFORE_H3 : 6;
            const hAfter2 = lv2 === 2 ? SP.AFTER_H2 : lv2 === 3 ? SP.AFTER_H3 : 4;
            cascadeH += hBefore2 + hFont2 * 0.38 + hAfter2;
            k = this.nextNonEmpty(lines, k + 1);
          } else {
            cascadeH += MIN_KEEP; // first prose: add minimum body height
            break;
          }
        }
        if (cascadeH === 0) cascadeH = MIN_KEEP; // heading is last item in module
        this.renderHeading(trimmed, heading === 1 ? 2 : heading, cascadeH);
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

  // ── Code block ────────────────────────────────────────────────────
  // Monospace, light box, indentation preserved. Page-break aware (re-draws the
  // box on each page). Code is NOT markdown-stripped — only emoji/encoding safe.
  renderCodeBlock(codeLines: string[]) {
    const fs = 9, lineH = 4.6, padV = 4, padH = 5;
    this.doc.setFont("courier", "normal");
    this.doc.setFontSize(fs);
    const innerW = CONTENT_W - padH * 2;
    const wrapped: string[] = [];
    for (const raw of codeLines) {
      const safe = sanitizeText(raw.replace(/\t/g, "    "));
      const ws = this.doc.splitTextToSize(safe.length ? safe : " ", innerW);
      for (const ln of ws) wrapped.push(ln);
    }
    if (!wrapped.length) return;

    let idx = 0;
    while (idx < wrapped.length) {
      this.checkPage(lineH + padV * 2);
      const avail = MAX_Y - this.y;
      const canFit = Math.max(1, Math.floor((avail - padV * 2) / lineH));
      const chunk = wrapped.slice(idx, idx + canFit);
      const boxH = chunk.length * lineH + padV * 2;

      this.doc.setFillColor(...COLOR.BG_CODE);
      this.doc.setDrawColor(...COLOR.CODE_BORDER);
      this.doc.setLineWidth(0.2);
      this.doc.roundedRect(MARGIN_LEFT, this.y, CONTENT_W, boxH, 1.5, 1.5, "FD");

      this.doc.setFont("courier", "normal");
      this.doc.setFontSize(fs);
      this.doc.setTextColor(...COLOR.CODE_TEXT);
      let ty = this.y + padV + 3;
      for (const ln of chunk) { this.doc.text(ln, MARGIN_LEFT + padH, ty); ty += lineH; }

      this.y += boxH;
      idx += chunk.length;
      if (idx < wrapped.length) this.addPage();
    }
    this.y += SP.AFTER_PARAGRAPH;
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...COLOR.TEXT_BODY);
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

  // Build marker — appears in the function logs on every invocation, so you can
  // confirm WHICH code is actually live after a deploy (the 403 fix included).
  console.log(`[export-pdf] BUILD=${EXPORT_PDF_BUILD} TESTING_MODE=${TESTING_MODE}`);

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

    // TESTING_MODE bypass — keep in sync with generate-course / upload-course-source.
    // Without it the Pro gate below silently 403s PDF export during the test phase
    // (no real subscriptions), so "o PDF não é gerado" while PPTX/DOCX (ungated) work.
    if (!TESTING_MODE && plan !== "pro") {
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

    const { data: modulesRaw } = await serviceClient
      .from("course_modules")
      .select("*")
      .eq("course_id", course_id)
      .order("order_index");
    const modules: any[] = modulesRaw ?? [];

    // ── Generate PDF ──
    const pdf = new PdfRenderer();
    pdf.courseTitle = sanitizeText(course.title || "");

    // Metadados do arquivo. O campo Title vinha vazio, então o PDF aparecia
    // pelo nome do arquivo em gerenciadores, bibliotecas e na aba do navegador.
    try {
      pdf.doc.setProperties({
        title: sanitizeText(course.title || "Curso"),
        subject: sanitizeText(course.description || ""),
        creator: "EduGen",
        author: "EduGen",
      });
    } catch {
      // Metadado é cosmético; não pode custar a exportação.
    }

    pdf.renderTitlePage(course.title, course.description, course.language);

    let moduleNum = 0;
    for (const mod of modules) {
      // Defensive: older courses stored a stray ```fence and a leading
      // "## <title>" that duplicates the title we just rendered.
      const content = cleanModuleContent(mod.content || "", mod.title);
      // Skip modules with no renderable content to avoid blank pages
      if (!content && !mod.title) continue;
      moduleNum++;
      pdf.moduleIndex = moduleNum;
      pdf.renderModuleTitle(mod.title);
      if (content) {
        pdf.renderModuleContent(content);
      }
    }

    const pdfBytes = pdf.output();
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = `${userId}/${safeName} - PDF - ${dateStr}.pdf`;

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
