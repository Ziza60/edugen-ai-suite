/**
 * pdf-sanitize.ts — pure helper functions for PDF text sanitization.
 *
 * Extracted from export-pdf/index.ts so they can be unit-tested via
 * Vitest (Node.js) without a Deno runtime or jsPDF dependency.
 * All functions are pure (no I/O, no globals) and have zero dependencies
 * on Deno APIs or edge-function infrastructure.
 *
 * NOTE: export-pdf/index.ts imports these — it is no longer self-contained
 * and requires the _shared folder to be present alongside the function.
 */

// ── HTML entities ─────────────────────────────────────────────────────

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&apos;": "'", "&hellip;": "...", "&mdash;": "-", "&ndash;": "-",
};

/** Decode the handful of HTML entities the AI output actually produces. */
export function decodeHtmlEntities(text: string): string {
  let out = text;
  for (const [entity, repl] of Object.entries(HTML_ENTITIES)) {
    out = out.split(entity).join(repl);
  }
  out = out.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return out;
}

// ── Emoji & encoding helpers ──────────────────────────────────────────

/** Remove emojis and other non-Latin1 symbols that jsPDF cannot render */
export function sanitizeText(text: string): string {
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
    .replace(/[\u2248]/g, "~")
    .replace(/[\u2260]/g, "!=")
    .replace(/[\u2264]/g, "<=")
    .replace(/[\u2265]/g, ">=")
    .replace(/[\u00B1]/g, "+/-")
    .replace(/[\u2192\u2794]/g, "->")
    .replace(/[\u2190]/g, "<-")
    .replace(/[\u221E]/g, "infinito");

  clean = clean.replace(/  +/g, " ").trim();
  return clean;
}

// ── Markdown stripper ─────────────────────────────────────────────────

/** Strip markdown formatting from text */
export function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1")
    .replace(/\*(?=\S)([^*]+?)(?<=\S)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, ""))
    .replace(/>\s*/g, "")
    .replace(/---/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

// ── HTML tag stripper ─────────────────────────────────────────────────

/** Strip raw HTML tags, converting block-ish tags to line breaks first so
 *  content doesn't get glued together ("<br>texto</p><p>outro" → 2 lines). */
export function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<(p|div|li|ul|ol|tr|table)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
}

// ── Bold label normalizer ─────────────────────────────────────────────

/** Convert bold-label patterns like "**Solução:**" → "Solução:" so labels
 *  arrive in the PDF as clean text without residual asterisks. */
export function normalizeBoldLabels(text: string): string {
  return text
    .replace(/\*\*([\p{L}\p{N}\s]+):\*\*/gu, "$1:")
    .replace(/\*\*([\p{L}\p{N}\s]+):(\s)/gu, "$1:$2");
}

// ── Formula residue cleaner ───────────────────────────────────────────

/** Remove leftover "Formula" / "Fórmula:" label residue and stray asterisks
 *  that survive markdown stripping. Formula BLOCKS are detected/rendered
 *  separately by `detectFormulaBlock` — this only cleans stray residue. */
export function stripFormulaAndStrayMarks(text: string): string {
  return text
    // "Formula *Fórmula: " or "Formula Fórmula: " — duplicated label artifact
    .replace(/^\s*F[óo]rmula\s+\*{0,2}\s*F[óo]rmula\s*:\s*\*{0,2}\s*/i, "")
    // "**Fórmula:**" or "**Formula:**" at start
    .replace(/^\s*\*{1,2}\s*(F[óo]rmula)\s*:?\s*\*{1,2}\s*/i, "")
    // "Fórmula: " at start (after markdown has been stripped)
    .replace(/^\s*(F[óo]rmula)\s*:\s*/i, "")
    // Remove any remaining double-asterisk runs
    .replace(/\*{2,}/g, "")
    // Multiplication operator: letter/digit * letter/digit → letter/digit × letter/digit
    .replace(/([\p{L}\p{N}\)])\s*\*\s*(?=[\p{L}\p{N}\(])/gu, "$1 × ")
    // Isolated single asterisk surrounded by whitespace or at boundaries
    .replace(/(^|\s)\*(\s|$)/g, "$1$2")
    // Trailing stray asterisk(s) at end of line
    .replace(/\*+$/g, "");
}

// ── Whitespace normalizer ─────────────────────────────────────────────

/** Collapse runs of blank/whitespace produced by the strips above. */
export function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// ── Full sanitization pipeline ────────────────────────────────────────

/** Full sanitization pipeline shared by the three public functions below. */
export function sanitizePdfCore(raw: string): string {
  let t = raw || "";
  t = decodeHtmlEntities(t);
  t = stripHtml(t);
  t = normalizeBoldLabels(t);
  t = stripMarkdown(t);
  t = stripFormulaAndStrayMarks(t);
  t = sanitizeText(t);
  t = collapseWhitespace(t);
  return t;
}

/** Sanitize inline text destined for a single line/run (headings, labels,
 *  table cells before per-cell trimming) — collapses to a single line. */
export function sanitizePdfInlineText(raw: string): string {
  return sanitizePdfCore(raw).replace(/\n+/g, " ").replace(/  +/g, " ").trim();
}

/** Sanitize a block of text that may legitimately span multiple lines
 *  (paragraphs, pedagogical box bodies, blockquotes). Preserves single
 *  newlines the caller may want to keep as soft breaks. */
export function sanitizePdfBlockText(raw: string): string {
  return sanitizePdfCore(raw);
}

/** Sanitize a table cell: same as inline text, but also strips leftover
 *  pipe characters from malformed rows and normalizes empty cells to "". */
export function sanitizePdfTableCell(raw: string): string {
  return sanitizePdfInlineText((raw || "").replace(/\|/g, "/"));
}

/** Sanitize heading text: same as inline + capitalize first letter + strip
 *  leading numbering artifacts like "1. " or "1) " from AI-generated headings. */
export function sanitizePdfHeading(raw: string): string {
  let t = sanitizePdfInlineText(raw);
  t = t.replace(/^\d+[.)]\s+/, "");
  if (t.length > 0) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

// ── Formula block detection ───────────────────────────────────────────

export interface FormulaBlock {
  label: string;
  expression: string;
}

/** Detects "**Fórmula:** X = Y" / "Formula: X = Y" / "Fórmula X = Y" lines
 *  so they can be rendered as a clean visual box instead of a paragraph. */
export function detectFormulaBlock(text: string): FormulaBlock | null {
  const t = (text || "").trim();
  const m = t.match(/^\*{0,2}\s*(F[óo]rmula)\s*\*{0,2}\s*:?\s*(.+)$/i);
  if (!m) return null;
  const expression = sanitizePdfInlineText(m[2]);
  if (!expression || expression.length < 3) return null;
  if (!/[=+\-*/×÷%]/.test(expression)) return null;
  return { label: "Fórmula", expression };
}

// ── Title normalizer ──────────────────────────────────────────────────

/**
 * Read-time safety net: remove prompt-like prefixes from course titles so
 * the PDF cover never shows raw prompt text. Mirrors normalizeCourseTitle()
 * in `_shared/markdown.ts` and `src/pages/CourseWizard.tsx`.
 */
export function normalizeCourseTitle(rawTitle: string, theme?: string): string {
  let t = (rawTitle || "").trim();
  t = t.replace(/^["'""'']+|["'""'']+$/g, "").trim();
  t = t.replace(
    /^(crie|criar|gere|gerar|fa[çc]a|fazer|monte|montar|elabore|elaborar|quero|preciso(\s+de)?|me\s+ajude\s+a\s+criar)\s+(m\s+|um\s+|uma\s+|uns\s+|umas\s+)?(cursos?|treinamentos?|capacita[çc][õã]o?es?)\s*(completos?\s*)?(no\s+tema|com\s+o\s+tema|sobre(\s+o\s+tema)?|a\s+respeito\s+de|de|do|da|em|para|:)?\s*/i,
    ""
  );
  t = t.replace(/^(um\s+|uma\s+)?(cursos?|treinamentos?)\s+(de|sobre|do|da|em)\s+/i, "");
  t = t.replace(/^["'""''\s]+|["'""''.\s]+$/g, "").trim();
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

// ── Table cell truncation helper ──────────────────────────────────────

/**
 * Given a list of text lines for a cell and a max line count, returns the
 * (possibly truncated) list. If truncated, the last line gets a trailing "…".
 */
export function truncateCellLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  const truncated = lines.slice(0, maxLines);
  const last = truncated[truncated.length - 1];
  truncated[truncated.length - 1] = last.length > 1 ? `${last.slice(0, -1)}\u2026` : `${last}\u2026`;
  return truncated;
}
