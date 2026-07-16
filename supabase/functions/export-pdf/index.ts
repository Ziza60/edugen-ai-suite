import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import {
  stripInternalEdugenBlocks,
  markUnsupportedStatisticsAsHypothetical,
  normalizeCourseMapTitles,
} from "../_shared/course-quality.ts";

// NOTE: This function now imports from ../_shared/ and requires the shared
// folder to be deployed alongside it (use `supabase functions deploy --use-api`).
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

/**
 * Read-time safety net: even after the frontend/generate-course normalize
 * the title before saving, older courses already in the DB may still carry
 * prompt-like titles ("Crie m curso no tema '...'"). This re-normalizes at
 * export time so the PDF cover never shows a raw prompt. Self-contained
 * (this file has no ../_shared import so it can be pasted straight into the
 * Supabase Dashboard editor) — mirrors normalizeCourseTitle() in
 * supabase/functions/_shared/markdown.ts and src/pages/CourseWizard.tsx.
 */
function normalizeCourseTitle(rawTitle: string, theme?: string): string {
  let t = (rawTitle || "").trim();
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  t = t.replace(
    /^(crie|criar|gere|gerar|fa[çc]a|fazer|monte|montar|elabore|elaborar|quero|preciso(\s+de)?|me\s+ajude\s+a\s+criar)\s+(m\s+|um\s+|uma\s+|uns\s+|umas\s+)?(cursos?|treinamentos?|capacita[çc][õã]o?es?)\s*(completos?\s*)?(no\s+tema|com\s+o\s+tema|sobre(\s+o\s+tema)?|a\s+respeito\s+de|de|do|da|em|para|:)?\s*/i,
    ""
  );
  t = t.replace(/^(um\s+|uma\s+)?(cursos?|treinamentos?)\s+(de|sobre|do|da|em)\s+/i, "");
  t = t.replace(/^["'“”‘’\s]+|["'“”‘’.\s]+$/g, "").trim();
  t = t.replace(/\s{2,}/g, " ");

  const looksLikePrompt = /\b(crie|criar|gere|gerar|fa[çc]a|monte|elabore|quero|preciso)\b/i.test(t);
  const cleanTheme = (theme || "").trim().replace(/\s{2,}/g, " ");

  let result = (!t || t.length < 3 || looksLikePrompt) ? cleanTheme : t;
  if (!result) result = t || cleanTheme;

  const MAX_TITLE_LEN = 90;
  if (result.length > MAX_TITLE_LEN) {
    result = result.slice(0, MAX_TITLE_LEN).replace(/\s+\S*$/, "").trim();
  }
  result = result.replace(/[.,;:\-–—]+$/, "").trim();
  if (result) result = result.charAt(0).toUpperCase() + result.slice(1);
  return result || "Curso sem título";
}

// TESTING_MODE: fase de testes sem usuários reais — libera o gate de plano Pro
// do export de PDF (espelha generate-course / upload-course-source). Voltar para
// `false` para reativar a monetização.
const TESTING_MODE = true;

// Build marker — surfaced on EVERY response header (x-export-pdf-build) so you
// can confirm in F12 → Network which code is actually live after a deploy.
const EXPORT_PDF_BUILD = "2026-07-16a";

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
    .replace(/[\u2026]/g, "...")
    // jsPDF's default fonts (Helvetica/WinAnsi) cannot render these math/
    // symbol glyphs — they silently render as garbage bytes (e.g. "≈" → `"H`).
    // Replace with the closest ASCII-safe equivalent BEFORE the generic
    // non-Latin1 sweep below (which would otherwise leave them untouched).
    .replace(/[\u2248]/g, "~") // ≈ approximately equal
    .replace(/[\u2260]/g, "!=") // ≠ not equal
    .replace(/[\u2264]/g, "<=") // ≤
    .replace(/[\u2265]/g, ">=") // ≥
    .replace(/[\u00B1]/g, "+/-") // ±
    .replace(/[\u2192\u2794]/g, "->") // → arrow
    .replace(/[\u2190]/g, "<-") // ←
    .replace(/[\u221E]/g, "infinito"); // ∞

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

/** Convert bold-label patterns like "**Solução:**" or "**Resultado:**" into
 *  plain "Solução:" / "Resultado:" BEFORE the generic markdown stripper runs.
 *  This handles the common AI pattern where a structured label inside a
 *  paragraph is formatted as `**Label:**` — the paired asterisks are closed
 *  properly so `stripMarkdown` would strip them, but malformed variants like
 *  `**Solução:*` (single trailing asterisk) survive the stripper and leave
 *  a stray `*` that `stripFormulaAndStrayMarks` must then mop up. Running
 *  this normalizer FIRST avoids the residue entirely. */
function normalizeBoldLabels(text: string): string {
  return text
    .replace(/\*\*([\p{L}\p{N}\s]+):\*\*/gu, "$1:")
    .replace(/\*\*([\p{L}\p{N}\s]+):(\s)/gu, "$1:$2");
}

function getHeadingLevel(line: string): number {
  const match = line.match(/^(#{1,6})\s/);
  return match ? match[1].length : 0;
}

// ── Strong PDF sanitizers ───────────────────────────────────────────────
// Unified cleanup for anything that reaches the PDF as text: strips raw
// HTML tags/entities, residual Markdown, stray asterisks, "Formula"/
// "**Fórmula:**" label residue and collapses whitespace. `stripMarkdown` +
// `sanitizeText` above still exist (used internally by these) but every
// NEW render path should call one of the three functions below instead of
// composing stripMarkdown/sanitizeText by hand.

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&apos;": "'", "&hellip;": "...", "&mdash;": "-", "&ndash;": "-",
};

/** Decode the handful of HTML entities the AI output actually produces. */
function decodeHtmlEntities(text: string): string {
  let out = text;
  for (const [entity, repl] of Object.entries(HTML_ENTITIES)) {
    out = out.split(entity).join(repl);
  }
  out = out.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return out;
}

/** Strip raw HTML tags, converting block-ish tags to line breaks first so
 *  content doesn't get glued together ("<br>texto</p><p>outro" → 2 lines). */
function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<(p|div|li|ul|ol|tr|table)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
}

/** Remove leftover "Formula" / "Fórmula:" label residue and stray asterisks
 *  that survive markdown stripping (e.g. an unmatched "**" or "* " that
 *  isn't a real bullet). Formula BLOCKS are detected/rendered separately by
 *  `detectFormulaBlock` — this only cleans stray residue in regular text. */
function stripFormulaAndStrayMarks(text: string): string {
  return text
    // Duplicated "Formula **Fórmula:** ..." artifact from some AI outputs
    .replace(/^\s*F[óo]rmula\s+\*{0,2}\s*F[óo]rmula\s*:\s*\*{0,2}\s*/i, "")
    .replace(/^\s*\*{1,2}\s*(F[óo]rmula)\s*:?\s*\*{1,2}\s*/i, "")
    .replace(/^\s*(F[óo]rmula)\s*:\s*/i, "")
    .replace(/\*{2,}/g, "")
    // A lone "*" flanked by alphanumerics on both sides ("Preço * Quantidade")
    // is a math multiplication, not a stray markdown mark — render it as "×"
    // instead of silently deleting it (this was eating real formula operators).
    .replace(/([\p{L}\p{N}\)])\s*\*\s*(?=[\p{L}\p{N}\(])/gu, "$1 × ")
    .replace(/(^|\s)\*(\s|$)/g, "$1$2")
    // Trailing stray asterisk(s) not caught above (e.g. "**Solução:*" → "Solução:")
    .replace(/\*+$/g, "");
}

/** Pedagogical boxes render body lines as plain paragraphs/bullets — a raw
 *  markdown table inside one (e.g. a "Nota Técnica" comparison table) would
 *  otherwise show up as literal "| a | b | c |" text. Detect table blocks
 *  inside the box body and flatten each data row into a readable
 *  "Header1: cell1 · Header2: cell2" line instead. */
function flattenTableLinesInBox(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  const splitRow = (line: string): string[] =>
    line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  // Separator rows are usually "---|---" but some AI-generated tables use pure
  // alignment colons with no dashes at all ("|:|:|:|:|") — accept both, and
  // don't require it to be an exact index — just "somewhere in the pipe block".
  const isSeparatorLine = (l: string): boolean =>
    /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && /[-:]/.test(l);
  while (i < lines.length) {
    if (lines[i].includes("|")) {
      // Gather the maximal run of consecutive lines that still contain a "|" —
      // blank lines between table rows are already stripped by the caller, so
      // header/separator/rows end up adjacent in this array regardless of how
      // the original markdown was spaced.
      let end = i;
      while (end < lines.length && lines[end].includes("|")) end++;
      const block = lines.slice(i, end);
      const sepIdx = block.findIndex((l, idx) => idx > 0 && isSeparatorLine(l));
      if (sepIdx > 0) {
        const headers = splitRow(block.slice(0, sepIdx).join(" ")).map((h) => sanitizePdfInlineText(h));
        const dataLines = block.slice(sepIdx + 1);
        let k = 0;
        while (k < dataLines.length) {
          // A logical row can be wrapped across multiple physical lines when the
          // AI-generated markdown breaks a long cell mid-row. Keep merging the
          // next physical line into this row until we have enough cells.
          let rowText = dataLines[k];
          let cells = splitRow(rowText);
          while (cells.length < headers.length && k + 1 < dataLines.length) {
            k++;
            rowText += " " + dataLines[k];
            cells = splitRow(rowText);
          }
          const cleanCells = cells.map((c) => sanitizePdfInlineText(c));
          const parts: string[] = [];
          for (let c = 0; c < Math.max(headers.length, cleanCells.length); c++) {
            const h = headers[c];
            const v = cleanCells[c] || "";
            if (!v) continue;
            parts.push(h ? `${h}: ${v}` : v);
          }
          if (parts.length) out.push(parts.join(" · "));
          k++;
        }
        i = end;
        continue;
      }
    }
    out.push(lines[i]);
    i++;
  }
  return out;
}

/** Collapse runs of blank/whitespace produced by the strips above. */
function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Full sanitization pipeline shared by the three public functions below. */
function sanitizePdfCore(raw: string): string {
  let t = raw || "";
  t = decodeHtmlEntities(t);
  t = stripHtml(t);
  t = normalizeBoldLabels(t);  // converts **Solução:** → Solução: before markdown stripping
  t = stripMarkdown(t);
  t = stripFormulaAndStrayMarks(t);
  t = sanitizeText(t);
  t = collapseWhitespace(t);
  return t;
}

/** Sanitize inline text destined for a single line/run (headings, labels,
 *  table cells before per-cell trimming) — collapses to a single line. */
function sanitizePdfInlineText(raw: string): string {
  return sanitizePdfCore(raw).replace(/\n+/g, " ").replace(/  +/g, " ").trim();
}

/** Sanitize a block of text that may legitimately span multiple lines
 *  (paragraphs, pedagogical box bodies, blockquotes). Preserves single
 *  newlines the caller may want to keep as soft breaks. */
function sanitizePdfBlockText(raw: string): string {
  return sanitizePdfCore(raw);
}

/** Sanitize a table cell: same as inline text, but also strips leftover
 *  pipe characters from malformed rows and normalizes empty cells to "". */
function sanitizePdfTableCell(raw: string): string {
  return sanitizePdfInlineText((raw || "").replace(/\|/g, "/"));
}

// ── Formula block detection ─────────────────────────────────────────────

interface FormulaBlock {
  label: string;
  expression: string;
}

/** Detects "**Fórmula:** X = Y" / "Formula: X = Y" / "Fórmula X = Y" lines
 *  so they can be rendered as a clean visual box instead of a paragraph. */
function detectFormulaBlock(text: string): FormulaBlock | null {
  const t = (text || "").trim();
  const m = t.match(/^\*{0,2}\s*(F[óo]rmula)\s*\*{0,2}\s*:?\s*(.+)$/i);
  if (!m) return null;
  const expression = sanitizePdfInlineText(m[2]);
  if (!expression || expression.length < 3) return null;
  if (!/[=+\-*/×÷%]/.test(expression)) return null;
  return { label: "Fórmula", expression };
}

// ── Table parser ──────────────────────────────────────────────────────

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function parseMarkdownTable(lines: string[], startIndex: number): { table: ParsedTable | null; endIndex: number } {
  if (!lines[startIndex]?.includes("|")) return { table: null, endIndex: startIndex };

  const parsePipeRow = (line: string): string[] => {
    const cells = line.split("|").map((c) => c.trim());
    // Standard markdown tables are bounded by leading/trailing "|", which
    // produces an empty string at index 0 and/or at the end after split().
    // Only drop those boundary artifacts — never drop a real (possibly
    // empty-content) interior cell.
    if (cells.length > 0 && cells[0] === "") cells.shift();
    if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
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
  // Persists across bullet/blank-line gaps inside a numbered list (e.g. sub-bullets
  // under item 2), so "3." doesn't restart as "1." after an interruption. Reset only
  // on real structural breaks (heading, hr, table, code block, pedagogical box).
  numberedListCounter: number = 0;
  // TOC state (populated by renderTOCPage, consumed by finalizeTOC)
  tocPageNum: number = 0;
  tocLineYs: number[] = [];

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
    // Thin navy bar at top — decorative only, no text (tiny text is distracting in viewers).
    // NOTE: no gold accent stripe here on purpose — the footer already carries a gold
    // line + page number, and in continuous-scroll PDF viewers this header's bar sits
    // right below the previous page's footer bar, reading as a duplicated gold rule
    // (one with the page number, one blank). Keeping only the footer's gold line avoids that.
    this.doc.setFillColor(...COLOR.PRIMARY);
    this.doc.rect(0, 0, PAGE_W, 7, "F");
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

  // ── TOC (Table of Contents) ───────────────────────────────────────

  /** Renders a Sumário page (page 2) with placeholder page numbers ("...").
   *  Call `finalizeTOC(moduleStartPages)` after all modules are rendered to
   *  fill in the real page numbers. */
  renderTOCPage(moduleTitles: string[]) {
    this.addPage();
    this.tocPageNum = this.pageNum;
    this.tocLineYs = [];

    // Page background matching cover style (white with a thin navy top bar
    // already drawn by addPage → drawPageHeader)
    this.y = MARGIN_TOP + 4;

    // "Sumário" heading
    this.doc.setFontSize(FONT.MODULE_TITLE);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...COLOR.PRIMARY);
    this.doc.text("Sumário", MARGIN_LEFT, this.y);
    this.y += FONT.MODULE_TITLE * 0.5 + 6;

    // Gold underline
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(MARGIN_LEFT, this.y, 40, 0.8, "F");
    this.y += 8;

    // TOC geometry:
    // • Title zone: MARGIN_LEFT+9 … MARGIN_LEFT+9+MAX_TITLE_W (guaranteed ≤150mm)
    // • Dots zone:  always from DOT_FIXED_X … DOT_END_X (fixed 22mm, always visible)
    // • Page num:   right-aligned at PAGE_NUM_X (186mm)
    // The fixed dot zone means titles never crowd out the page-number connector.
    const MAX_TITLE_W = CONTENT_W - 48; // 114mm — leaves fixed room for dots
    const PAGE_NUM_X = PAGE_W - MARGIN_RIGHT;
    const DOT_FIXED_X = PAGE_NUM_X - 30; // 156mm — dots always start here
    const DOT_END_X = PAGE_NUM_X - 8;    // 178mm — dots always end here

    for (let i = 0; i < moduleTitles.length; i++) {
      const rawTitle = moduleTitles[i] || `Módulo ${i + 1}`;
      const label = sanitizePdfInlineText(rawTitle);

      // Module number badge
      this.doc.setFontSize(FONT.SMALL);
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...COLOR.ACCENT);
      this.doc.text(`${i + 1}.`, MARGIN_LEFT, this.y);

      // Title text (may wrap — restricted to MAX_TITLE_W so dots area is always free)
      this.doc.setFontSize(FONT.BODY);
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(...COLOR.TEXT_DARK);
      const titleLines: string[] = this.doc.splitTextToSize(label, MAX_TITLE_W);
      this.doc.text(titleLines, MARGIN_LEFT + 8, this.y);

      // Record Y of the first line for this entry (where the page number goes)
      this.tocLineYs.push(this.y);

      // Dotted leader — drawn at a FIXED position on the right so it always
      // appears regardless of how long the title is. The gap between a short
      // title and the dot zone provides visual breathing room; a long wrapped
      // title is naturally separated from the right-side reference by the zone.
      this.doc.setFontSize(7);
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(...COLOR.TEXT_MUTED);
      const dotStr = ". . . . . . . . . . . . . . . . . . . . .";
      const dotAvailW = DOT_END_X - DOT_FIXED_X;
      const dotLine: string = this.doc.splitTextToSize(dotStr, dotAvailW)[0] || "";
      if (dotLine) this.doc.text(dotLine, DOT_FIXED_X, this.y);

      // Placeholder "..." for page number (will be replaced in finalizeTOC)
      this.doc.setFontSize(FONT.BODY);
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...COLOR.TEXT_MUTED);
      this.doc.text("...", PAGE_NUM_X, this.y, { align: "right" });

      this.y += titleLines.length * SP.LINE_HEIGHT + 4;

      // Subtle separator
      if (i < moduleTitles.length - 1) {
        this.doc.setDrawColor(...COLOR.BORDER_LIGHT);
        this.doc.setLineWidth(0.2);
        this.doc.line(MARGIN_LEFT, this.y - 1, PAGE_W - MARGIN_RIGHT, this.y - 1);
      }

      this.checkPage(12);
    }

    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  /** Goes back to the TOC page and overwrites each placeholder "..." with
   *  the real module start page number. Call after all modules are rendered. */
  finalizeTOC(moduleStartPages: number[]) {
    if (!this.tocPageNum || this.tocLineYs.length === 0) return;
    const lastPage = this.pageNum;
    this.doc.setPage(this.tocPageNum);

    const PAGE_NUM_X = PAGE_W - MARGIN_RIGHT;

    for (let i = 0; i < moduleStartPages.length && i < this.tocLineYs.length; i++) {
      const y = this.tocLineYs[i];
      // White-out the "..." placeholder area
      this.doc.setFillColor(255, 255, 255);
      this.doc.rect(PAGE_NUM_X - 22, y - 5, 24, 6.5, "F");
      // Write real page number
      this.doc.setFontSize(FONT.BODY);
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(...COLOR.PRIMARY);
      this.doc.text(String(moduleStartPages[i]), PAGE_NUM_X, y, { align: "right" });
    }

    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...COLOR.TEXT_BODY);
    // Return to last page so further operations (output()) work correctly
    this.doc.setPage(lastPage);
  }

  // ── Module title ──────────────────────────────────────────────────

  renderModuleTitle(title: string) {
    this.addPage();

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

  // ── Module illustration (from course_images) ────────────────────────

  /** Embeds a module image below the title banner. `bytes` must already be
   *  a decoded raster (PNG/JPEG) — jsPDF's addImage does not fetch URLs. */
  renderModuleImage(bytes: Uint8Array, format: "PNG" | "JPEG", altText?: string) {
    try {
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      const props = this.doc.getImageProperties(`data:image/${format.toLowerCase()};base64,${base64}`);
      const maxW = CONTENT_W;
      const maxH = 70;
      let w = maxW;
      let h = (props.height / props.width) * w;
      if (h > maxH) {
        h = maxH;
        w = (props.width / props.height) * h;
      }
      this.checkPage(h + 8);
      const x = MARGIN_LEFT + (CONTENT_W - w) / 2;
      this.doc.addImage(base64, format, x, this.y, w, h);
      this.y += h + 8;
      if (altText) {
        this.doc.setFontSize(FONT.SMALL);
        this.doc.setFont("helvetica", "italic");
        this.doc.setTextColor(...COLOR.TEXT_MUTED);
        const capLines = this.doc.splitTextToSize(sanitizePdfInlineText(altText), CONTENT_W);
        this.doc.text(capLines, MARGIN_LEFT + CONTENT_W / 2, this.y, { align: "center" });
        this.y += capLines.length * 4 + 6;
        this.doc.setFont("helvetica", "normal");
        this.doc.setTextColor(...COLOR.TEXT_BODY);
      }
    } catch (imgErr) {
      console.error("[export-pdf] failed to embed module image:", imgErr);
    }
  }

  // ── Headings ──────────────────────────────────────────────────────

  renderHeading(text: string, level: number, extraNeeded = 0) {
    const sizeMap: Record<number, number> = { 2: FONT.H2, 3: FONT.H3, 4: FONT.H4, 5: FONT.BODY, 6: FONT.BODY };
    const fontSize = sizeMap[level] || FONT.BODY;
    const beforeMap: Record<number, number> = { 2: SP.BEFORE_H2, 3: SP.BEFORE_H3, 4: SP.BEFORE_H4 };
    const beforeSpace = beforeMap[level] || 6;
    const afterMap: Record<number, number> = { 2: SP.AFTER_H2, 3: SP.AFTER_H3, 4: SP.AFTER_H4 };
    const afterSpace = afterMap[level] || 4;

    const cleanText = sanitizePdfInlineText(text.replace(/^#{1,6}\s*/, ""));
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
    const cleanText = sanitizePdfBlockText(text).replace(/\n+/g, " ").trim();
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
    const cleanText = sanitizePdfInlineText(text.replace(/^[-*]\s*/, ""));
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

  // ── Numbered list item (real ordinal, not converted to a bullet) ──

  renderNumberedItem(text: string, number: number, indent = 0) {
    const cleanText = sanitizePdfInlineText(text.replace(/^\d+\.\s*/, ""));
    if (!cleanText) return;

    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...COLOR.TEXT_BODY);

    const marker = `${number}.`;
    const indentMm = indent * 5;
    const markerX = MARGIN_LEFT + 3 + indentMm;
    const markerW = this.doc.getTextWidth(marker) + 3;
    const textX = markerX + Math.max(markerW, 6);
    const availW = CONTENT_W - (textX - MARGIN_LEFT);

    const lines = this.doc.splitTextToSize(cleanText, availW);
    this.checkPage(lines.length * SP.LINE_HEIGHT + SP.BULLET_GAP);

    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...COLOR.PRIMARY);
    this.doc.text(marker, markerX, this.y);

    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...COLOR.TEXT_BODY);
    this.doc.text(lines, textX, this.y);
    this.y += lines.length * SP.LINE_HEIGHT + SP.BULLET_GAP;
  }

  // ── Blockquote ────────────────────────────────────────────────────

  renderBlockquote(text: string) {
    const cleanText = sanitizePdfBlockText(text.replace(/^>\s*/, "")).replace(/\n+/g, " ").trim();
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
    const labelClean = sanitizePdfInlineText(label);
    const labelLines = this.doc.splitTextToSize(labelClean, CONTENT_W - 18);
    const labelH = labelLines.length * 4.5;

    // Measure body
    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont("helvetica", "normal");
    const bodyH = bodyLines.reduce((sum, line) => {
      const ls = this.doc.splitTextToSize(sanitizePdfInlineText(line), CONTENT_W - 18);
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
    let numberedCounter = 0;
    for (const line of bodyLines) {
      const trimmedLine = line.trim();
      const numberedMatch = trimmedLine.match(/^(\d+)\.\s+(.*)$/);
      const isDashBullet = trimmedLine.startsWith("- ") || trimmedLine.startsWith("* ");
      if (!numberedMatch && !isDashBullet) numberedCounter = 0; // reset run on any non-list line

      const clean = sanitizePdfInlineText(numberedMatch ? numberedMatch[2] : line.replace(/^[-*]\s*/, ""));
      if (!clean) { curY += 2; continue; }

      if (numberedMatch) {
        numberedCounter++;
        const marker = `${numberedCounter}.`;
        const ls = this.doc.splitTextToSize(clean, CONTENT_W - 28);
        this.doc.setFont("helvetica", "bold");
        this.doc.setTextColor(...(bar as [number, number, number]));
        this.doc.text(marker, innerX, curY);
        this.doc.setFont("helvetica", "normal");
        this.doc.setTextColor(...COLOR.TEXT_BODY);
        this.doc.text(ls, innerX + 8, curY);
        curY += ls.length * SP.LINE_HEIGHT + SP.BULLET_GAP;
      } else if (isDashBullet) {
        const ls = this.doc.splitTextToSize(clean, CONTENT_W - 24);
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

  // ── Formula block (native visual box) ──────────────────────────────

  renderFormulaBlock(formula: FormulaBlock) {
    this.doc.setFont("courier", "bold");
    this.doc.setFontSize(FONT.H4);
    const exprLines: string[] = this.doc.splitTextToSize(formula.expression, CONTENT_W - 2 * SP.BLOCK_PAD_H);
    const labelH = 5;
    const exprH = exprLines.length * 6;
    const totalH = SP.BLOCK_PAD_V + labelH + 3 + exprH + SP.BLOCK_PAD_V;
    this.checkPage(totalH + 6);

    const boxY = this.y;
    this.doc.setFillColor(...COLOR.BG_SUMMARY);
    this.doc.roundedRect(MARGIN_LEFT, boxY, CONTENT_W, totalH, 2.5, 2.5, "F");
    this.doc.setFillColor(...COLOR.BAR_SUMMARY);
    this.doc.roundedRect(MARGIN_LEFT, boxY, 3.5, totalH, 1.5, 1.5, "F");

    const innerX = MARGIN_LEFT + SP.BLOCK_PAD_H + 2;
    let curY = boxY + SP.BLOCK_PAD_V + 3;

    this.doc.setFontSize(FONT.BLOCK_LABEL);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(...COLOR.BAR_SUMMARY);
    this.doc.text(formula.label.toUpperCase(), innerX, curY);
    curY += labelH + 3;

    this.doc.setFont("courier", "bold");
    this.doc.setFontSize(FONT.H4);
    this.doc.setTextColor(...COLOR.PRIMARY);
    this.doc.text(exprLines, innerX, curY);

    this.y = boxY + totalH + 8;
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(...COLOR.TEXT_BODY);
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

    // Pre-measure header height — long column titles (e.g. comparison-table
    // headers like "Precificação de Penetração") must wrap onto multiple
    // lines instead of being silently cut to their first line only.
    this.doc.setFontSize(FONT.TABLE_HEADER);
    let headerLineCount = 1;
    const headerLinesByCol: string[][] = [];
    for (let c = 0; c < numCols; c++) {
      const cellText = sanitizePdfTableCell(headers[c] || "");
      const hLines = this.doc.splitTextToSize(cellText, colWidths[c] - 6);
      headerLinesByCol.push(hLines);
      if (hLines.length > headerLineCount) headerLineCount = hLines.length;
    }
    const headerH = Math.max(10, headerLineCount * 5 + 4);

    // Pre-measure all rows to get accurate heights
    const rowHeights: number[] = [];
    for (const row of rows) {
      this.doc.setFontSize(FONT.TABLE_BODY);
      let maxLines = 1;
      for (let c = 0; c < numCols; c++) {
        const cellText = sanitizePdfTableCell(row[c] || "");
        const lines = this.doc.splitTextToSize(cellText, colWidths[c] - 8);
        // Allow taller cells (up to 8 lines) instead of silently truncating at 4 —
        // the row simply grows; if content is still longer than that the render
        // step below adds a trailing "…" so no content vanishes without a trace.
        if (lines.length > maxLines) maxLines = Math.min(lines.length, 8);
      }
      rowHeights.push(Math.max(8, maxLines * SP.TABLE_CELL_LINE + SP.TABLE_ROW_PAD * 2));
    }

    const totalTableH = headerH + rowHeights.reduce((a, b) => a + b, 0) + 4;

    // Only force a fresh page when there isn't even enough room for the
    // header + first row here — otherwise start the table in the remaining
    // space and let the per-row page-break logic below (which already
    // redraws the header on each new page) carry the rest onto following
    // pages. Forcing the WHOLE table onto a new page whenever it merely
    // fits on a full page (regardless of how much room is left right now)
    // wastes the remaining space on the current page for no benefit, since
    // multi-page tables already render correctly.
    const minChunk = headerH + rowHeights[0] + 8;
    if (MAX_Y - this.y < Math.min(minChunk, totalTableH)) {
      this.checkPage(minChunk);
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
        const hLines = headerLinesByCol[c] || [""];
        const blockH = hLines.length * 5;
        const startYText = atY + (headerH - blockH) / 2 + 4;
        for (let l = 0; l < hLines.length; l++) {
          this.doc.text(hLines[l] || "", hx + 4, startYText + l * 5);
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
        const cellText = sanitizePdfTableCell(row[c] || "");
        this.doc.setFontSize(FONT.TABLE_BODY);
        const allLines = this.doc.splitTextToSize(cellText, colWidths[c] - 8);
        const maxCellLines = 8;
        const lines = allLines.slice(0, maxCellLines);
        if (allLines.length > maxCellLines) {
          const last = lines[lines.length - 1];
          lines[lines.length - 1] = last.length > 1 ? `${last.slice(0, -1)}…` : `${last}…`;
        }

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
    this.numberedListCounter = 0;

    while (i < lines.length) {
      const trimmed = lines[i].trim();

      if (!trimmed) {
        this.y += 3;
        i++;
        continue;
      }

      // ── Fenced code block ── (preserve indentation; render monospace)
      if (trimmed.startsWith("```")) {
        this.numberedListCounter = 0;
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
          this.numberedListCounter = 0;
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
            // Walk past this short prose block (e.g. a 1-3 line intro sentence)
            // to see if a table follows immediately. Without this, a heading like
            // "Panorama do Curso" + a one-line intro fit fine at the bottom of a
            // page, but the table right after them doesn't — so it gets pushed
            // entirely to the next page, leaving the current page underused.
            // Accounting for the table's header + first row here keeps the whole
            // heading+intro+table group together instead of splitting them.
            let p = k;
            let proseLines = 0;
            while (p < lines.length && proseLines < 4) {
              const tp = lines[p]?.trim();
              if (!tp) { p++; continue; }
              if (getHeadingLevel(tp) > 0 || detectPedagogicalBlock(tp)) break;
              if (tp.includes("|") && lines[p + 1]?.includes("|")) break;
              proseLines++;
              p++;
            }
            const nextTrimmed = lines[p]?.trim();
            if (nextTrimmed && nextTrimmed.includes("|") && lines[p + 1]?.includes("|")) {
              const { table } = parseMarkdownTable(lines, p);
              if (table) {
                const headerH = 10;
                const firstRowsH = Math.min(2, table.rows.length) * 16;
                cascadeH += headerH + firstRowsH;
              }
            }
            break;
          }
        }
        if (cascadeH === 0) cascadeH = MIN_KEEP; // heading is last item in module
        this.numberedListCounter = 0;
        this.renderHeading(trimmed, heading === 1 ? 2 : heading, cascadeH);
        i++;
        continue;
      }

      // ── Pedagogical blocks — collect label + body as one unit ──
      const blockType = detectPedagogicalBlock(trimmed);
      if (blockType) {
        this.numberedListCounter = 0;
        const label = trimmed;
        const bodyLines: string[] = [];
        let j = i + 1;
        // Collect associated content lines until next heading, empty gap, or new block
        let emptyCount = 0;
        while (j < lines.length) {
          // Some AI-generated boxes wrap their entire body in markdown
          // blockquote syntax ("> line per line"). Strip that marker here so
          // every downstream check (blank-line detection, heading detection,
          // table detection in flattenTableLinesInBox) sees the real content
          // instead of a "> "-prefixed string that fails all of them.
          const t = lines[j].trim().replace(/^>\s?/, "").trim();
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
          this.renderPedagogicalBox(label, flattenTableLinesInBox(bodyLines), blockType);
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

      // ── Numbered list — uses the persistent this.numberedListCounter so the
      // sequence survives interleaved sub-bullets/blank lines (e.g. item 2 has
      // bullet sub-details, then item 3 continues correctly instead of resetting
      // to "1."). Counter is reset only at real structural breaks above/below. ──
      if (/^\d+\.\s/.test(trimmed)) {
        this.numberedListCounter++;
        this.renderNumberedItem(trimmed, this.numberedListCounter);
        i++;
        continue;
      }

      // ── Horizontal rule ──
      if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
        this.numberedListCounter = 0;
        this.renderHorizontalRule();
        i++;
        continue;
      }

      // ── Formula block ("**Fórmula:** X = Y" style lines) ──
      const formula = detectFormulaBlock(trimmed);
      if (formula) {
        this.renderFormulaBlock(formula);
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

    // Fetch AI-generated module illustrations (same table the student portal
    // and editor already read from) — previously this exporter never queried
    // course_images, so PDFs always came out without the module images.
    const moduleIds = modules.map((m) => m.id).filter(Boolean);
    const imageByModuleId: Record<string, { url: string; alt_text: string | null }> = {};
    if (moduleIds.length > 0) {
      const { data: imagesRaw } = await serviceClient
        .from("course_images")
        .select("module_id, url, alt_text")
        .in("module_id", moduleIds);
      for (const img of imagesRaw ?? []) {
        if (img.module_id && img.url) imageByModuleId[img.module_id] = img;
      }
    }

    // ── Generate PDF ──
    const pdf = new PdfRenderer();
    const displayTitle = normalizeCourseTitle(course.title || "", course.theme || "");
    pdf.courseTitle = sanitizeText(displayTitle);
    pdf.renderTitlePage(displayTitle, course.description, course.language);

    // Pre-filter modules for TOC (same filter used in the rendering loop below)
    const renderableModules = modules.filter(
      (m) => (m.content || "").trim() || (m.title || "").trim()
    );
    if (renderableModules.length > 1) {
      pdf.renderTOCPage(renderableModules.map((m) => m.title || ""));
    }

    // Official module titles (for course-map normalization)
    const officialModuleTitles = renderableModules.map((m) => m.title || "").filter(Boolean);

    let moduleNum = 0;
    const moduleStartPages: number[] = [];
    for (const mod of modules) {
      // Defensive: older courses stored a stray ```fence and a leading
      // "## <title>" that duplicates the title we just rendered.
      const rawContent = cleanModuleContent(mod.content || "", mod.title);
      // Skip modules with no renderable content to avoid blank pages
      if (!rawContent && !mod.title) continue;
      // Strip EduGen-internal QA blocks (Matriz, Nota de Qualidade, Score) and
      // mark unsupported statistical claims as hypothetical before rendering.
      const strippedContent = stripInternalEdugenBlocks(rawContent);
      // Align any "Mapa do Curso" table titles in this module to match the
      // official module titles (same as the TOC), so they never diverge.
      const normalizedContent = normalizeCourseMapTitles(strippedContent, officialModuleTitles);
      const content = markUnsupportedStatisticsAsHypothetical(normalizedContent);
      moduleNum++;
      pdf.moduleIndex = moduleNum;
      pdf.renderModuleTitle(mod.title);
      // Record this module's start page for the TOC
      moduleStartPages.push(pdf.pageNum);

      const img = imageByModuleId[mod.id];
      if (img?.url) {
        try {
          const imgRes = await fetch(img.url);
          if (imgRes.ok) {
            const contentType = imgRes.headers.get("content-type") || "";
            const format: "PNG" | "JPEG" = contentType.includes("png") || /\.png($|\?)/i.test(img.url)
              ? "PNG"
              : "JPEG";
            const bytes = new Uint8Array(await imgRes.arrayBuffer());
            pdf.renderModuleImage(bytes, format, img.alt_text || undefined);
          } else {
            console.error(`[export-pdf] module image fetch failed (${imgRes.status}) for module ${mod.id}`);
          }
        } catch (imgFetchErr) {
          console.error(`[export-pdf] module image fetch error for module ${mod.id}:`, imgFetchErr);
        }
      }

      if (content) {
        pdf.renderModuleContent(content);
      }
    }

    // Finalize TOC: go back to page 2 and fill in real page numbers
    if (moduleStartPages.length > 1) {
      pdf.finalizeTOC(moduleStartPages);
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
