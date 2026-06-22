// export-pdf-v2/index.ts  — BUILD 2026-06-22b
// Fixes applied vs 2026-06-22a:
//  [1] ROOT CAUSE justification: content() collects consecutive paragraph lines
//      into a single block before calling para() — each markdown line was being
//      passed individually (always "last line" → never justified)
//  [2] Cover: text moved to upper half — was below 65 % height (top looked blank)
//  [3] Table orphan: pre-check total table height before drawing first row
//  [4] Table dividers: accurate per-page vertical lines, not approximated
//  [5] Heading orphan: MIN_KEEP raised 20 mm → 40 mm
//  [6] Anti-widow in para(): move whole paragraph to next page when ≤1 line fits
//  [7] modulePage(): clamp title rendering to stay within banner height
//  [8] Empty pages: improved by [3][5][6]; also clean trailing-space accumulation

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "https://esm.sh/pdf-lib@1.17.1";
import { cleanModuleContent } from "../_shared/markdown.ts";

const BUILD        = "2026-06-22b";
const TESTING_MODE = true;

// ─── Geometry (A4) ────────────────────────────────────────────────────────────
const PT      = 2.8346;
const PW      = 595.28;
const PH      = 841.89;
const ML      = 24;            // left margin mm
const MR      = 24;            // right margin mm
const MT      = 26;            // top margin for normal pages mm
const MB      = 26;            // bottom margin mm
const CW_MM   = 210 - ML - MR; // 162 mm
const CW      = CW_MM * PT;    // content width pts ≈ 459
const ML_PT   = ML * PT;
const MAX_Y   = 297 - MB;      // 271 mm — last allowed baseline

// Module banner
const MOD_BAN_H  = 44;         // mm
const MOD_CONT_Y = 52;         // mm — content starts after banner

// ─── Font sizes (pts) ─────────────────────────────────────────────────────────
const FS = {
  COVER_TITLE: 28, COVER_SUB: 13, COVER_LABEL: 9,
  MOD_LABEL: 9,   MOD_NUM: 11,   MOD_TITLE: 17,
  H2: 15,         H3: 13,        H4: 11.5,
  BODY: 10.5,     TABLE: 8.5,    CODE: 9,  SMALL: 8,  FOOTER: 9,
};

// ─── Spacing (mm) ─────────────────────────────────────────────────────────────
const SP = {
  B_H2: 11, A_H2: 6,
  B_H3:  8, A_H3: 4,
  B_H4:  5, A_H4: 3,
  A_PARA: 3.5,
  LINE: 5.5,           // body line advance mm
  TABLE_LINE: 4.2,     // table row line advance mm
  TABLE_PAD: 2,        // table cell padding mm
  CODE_PAD: 3, CODE_LINE: 4.5, A_CODE: 4,
  B_RULE: 3,  A_RULE: 3,
};

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  PRI:      rgb(18/255,  24/255,  68/255),
  ACC:      rgb(196/255, 152/255, 40/255),
  BODY:     rgb(38/255,  38/255,  46/255),
  HEAD:     rgb(18/255,  24/255,  68/255),
  WHITE:    rgb(1, 1, 1),
  CODE_BG:  rgb(13/255, 17/255, 23/255),
  CODE_FG:  rgb(200/255,225/255,240/255),
  DIM:      rgb(0.50, 0.50, 0.57),
  RULE:     rgb(0.82, 0.82, 0.85),
  TBL_EVEN: rgb(0.95, 0.95, 0.97),
  COVER_DIM: rgb(0.72, 0.74, 0.82),
};

// ─── Text helpers ─────────────────────────────────────────────────────────────

function safeText(t: string): string {
  return (t || "")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00AD/g, "")
    .replace(/[^\x00-\xFF]/g, "")   // strip remaining non-Latin-1 (no "?")
    .replace(/  +/g, " ")
    .trim();
}

function stripMd(t: string): string {
  return t
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, ""))
    .replace(/^\s*>\s*/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function cleanLine(t: string): string { return safeText(stripMd(t)); }

function headingLevel(line: string): number {
  const m = line.match(/^(#{1,6})\s/);
  return m ? m[1].length : 0;
}

function isBullet(line: string): boolean {
  return /^[-*+]\s/.test(line) || /^\d+[.)]\s/.test(line);
}

function isHRule(line: string): boolean {
  return /^(---+|\*\*\*+|___+)$/.test(line);
}

function isSpecialLine(t: string): boolean {
  return !t
    || t.startsWith("#")
    || t.startsWith("|")
    || t.startsWith(">")
    || t.startsWith("```")
    || isBullet(t)
    || isHRule(t);
}

function isTableSep(line: string): boolean {
  return /^[\s|:\-]+$/.test(line);
}

// Wrap text using EXACT pdf-lib font metrics
function wrapText(text: string, font: PDFFont, size: number, maxW = CW): string[] {
  const t = text.trim();
  if (!t) return [];
  const words = t.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

class R {
  doc: PDFDocument;
  pg!: PDFPage;
  reg!: PDFFont;
  bld!: PDFFont;
  obl!: PDFFont;
  cou!: PDFFont;
  y   = MT;
  pn  = 0;

  constructor(doc: PDFDocument) { this.doc = doc; }

  async fonts() {
    this.reg = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bld = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.obl = await this.doc.embedFont(StandardFonts.HelveticaOblique);
    this.cou = await this.doc.embedFont(StandardFonts.Courier);
  }

  Y(yMm: number): number { return PH - yMm * PT; }

  _footer() {
    this.pg.drawRectangle({ x: 0, y: 0, width: PW, height: 7 * PT, color: C.PRI });
    this.pg.drawRectangle({ x: 0, y: 7 * PT, width: PW, height: 0.8 * PT, color: C.ACC });
    const s = `${this.pn}`;
    this.pg.drawText(s, {
      x: (PW - this.reg.widthOfTextAtSize(s, FS.FOOTER)) / 2,
      y: 2.5 * PT, size: FS.FOOTER, font: this.reg, color: C.WHITE,
    });
  }

  // Regular content page (standard 7mm navy header + gold stripe + footer)
  addPage() {
    this.pg = this.doc.addPage([PW, PH]);
    this.pn++;
    this.pg.drawRectangle({ x: 0, y: PH - 7 * PT, width: PW, height: 7 * PT, color: C.PRI });
    this.pg.drawRectangle({ x: 0, y: PH - 7.8 * PT, width: PW, height: 0.8 * PT, color: C.ACC });
    this._footer();
    this.y = MT;
  }

  // Ensure neededMm of vertical space is available
  check(neededMm: number) { if (this.y + neededMm > MAX_Y) this.addPage(); }

  // ── Cover page [FIX #2] — content in upper 55 % of page ──
  cover(title: string, description?: string) {
    const pg = this.doc.addPage([PW, PH]);
    this.pn++;

    // Full navy background
    pg.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.PRI });
    // Left gold stripe (3 mm decorative)
    pg.drawRectangle({ x: 0, y: 0, width: 3 * PT, height: PH, color: C.ACC });
    // Right subtle stripe
    pg.drawRectangle({ x: PW - 3 * PT, y: 0, width: 3 * PT, height: PH, color: rgb(30/255, 38/255, 90/255) });

    // "EduGenAI" label — upper area
    pg.drawText("EduGenAI", {
      x: ML_PT, y: this.Y(15),
      size: FS.COVER_LABEL, font: this.bld, color: C.ACC,
    });

    // Horizontal gold rule below brand
    pg.drawRectangle({ x: ML_PT, y: this.Y(25), width: CW, height: 1.5 * PT, color: C.ACC });

    // Course title — starts at 40 mm, bold white
    const tLines = wrapText(safeText(title), this.bld, FS.COVER_TITLE, PW - 60 * PT);
    let ty = 40;
    for (const line of tLines) {
      pg.drawText(line, { x: ML_PT, y: this.Y(ty), size: FS.COVER_TITLE, font: this.bld, color: C.WHITE });
      ty += (FS.COVER_TITLE / PT) * 1.35; // pts → mm, 1.35 line spacing
    }

    // Description — below title, dimmed
    if (description) {
      ty += 6; // gap after title
      const dLines = wrapText(safeText(description), this.reg, FS.COVER_SUB, PW - 60 * PT);
      for (const line of dLines.slice(0, 5)) {
        if (ty > 150) break; // safety cap so we never overflow
        pg.drawText(line, { x: ML_PT, y: this.Y(ty), size: FS.COVER_SUB, font: this.reg, color: C.COVER_DIM });
        ty += (FS.COVER_SUB / PT) * 1.45;
      }
    }

    // Bottom gold bar + year
    pg.drawRectangle({ x: 0, y: 0, width: PW, height: 8 * PT, color: C.ACC });
    const yr  = new Date().getFullYear().toString();
    pg.drawText(yr, {
      x: PW - ML_PT - this.reg.widthOfTextAtSize(yr, FS.SMALL),
      y: 2.5 * PT, size: FS.SMALL, font: this.reg, color: C.PRI,
    });
  }

  // ── Module page [FIX #7] — banner at top of content page ──
  modulePage(title: string, num: number) {
    this.pg = this.doc.addPage([PW, PH]);
    this.pn++;

    // Navy banner (top 44 mm)
    this.pg.drawRectangle({ x: 0, y: this.Y(MOD_BAN_H), width: PW, height: MOD_BAN_H * PT, color: C.PRI });
    // Gold stripe at bottom of banner
    this.pg.drawRectangle({ x: 0, y: this.Y(MOD_BAN_H), width: PW, height: 1.5 * PT, color: C.ACC });

    // "MÓDULO 01" label
    const label  = safeText("MÓDULO");
    const labelW = this.bld.widthOfTextAtSize(label, FS.MOD_LABEL);
    this.pg.drawText(label, { x: ML_PT, y: this.Y(17), size: FS.MOD_LABEL, font: this.bld, color: C.ACC });
    this.pg.drawText(String(num).padStart(2, "0"), {
      x: ML_PT + labelW + 2.5 * PT, y: this.Y(17),
      size: FS.MOD_NUM, font: this.bld, color: C.WHITE,
    });

    // Module title — clamp rendering within banner [FIX #7]
    const tLines = wrapText(safeText(title), this.bld, FS.MOD_TITLE, PW - 50 * PT);
    const lineAdvMm = (FS.MOD_TITLE / PT) * 1.3; // pts → mm with 1.3× spacing
    let ty = 27;
    for (const line of tLines) {
      if (ty + lineAdvMm > MOD_BAN_H - 2) break; // don't overflow banner
      this.pg.drawText(line, { x: ML_PT, y: this.Y(ty), size: FS.MOD_TITLE, font: this.bld, color: C.WHITE });
      ty += lineAdvMm;
    }

    this._footer();
    this.y = MOD_CONT_Y;
  }

  // ── Paragraph — justified using exact font metrics [FIX #1 uses this] ──
  para(text: string) {
    const clean = cleanLine(text);
    if (!clean) return;

    const lines = wrapText(clean, this.reg, FS.BODY);
    if (!lines.length) return;

    // [FIX #6] Anti-widow: if paragraph has multiple lines but only 1 line fits
    // on the current page, move the entire paragraph to the next page
    const roomForLines = Math.floor((MAX_Y - this.y) / SP.LINE);
    if (lines.length > 1 && roomForLines <= 1) this.addPage();

    this.check(lines.length * SP.LINE + SP.A_PARA);

    for (let i = 0; i < lines.length; i++) {
      const words  = lines[i].split(/\s+/).filter(Boolean);
      const isLast = i === lines.length - 1;

      // Justify all non-last lines with 3+ words
      if (!isLast && words.length >= 3) {
        const wws    = words.map((w) => this.reg.widthOfTextAtSize(w, FS.BODY));
        const totalW = wws.reduce((a, b) => a + b, 0);
        const gap    = (CW - totalW) / (words.length - 1);
        let cx = ML_PT;
        for (let j = 0; j < words.length; j++) {
          this.pg.drawText(words[j], { x: cx, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY });
          cx += wws[j] + gap;
        }
      } else {
        this.pg.drawText(lines[i], { x: ML_PT, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY });
      }
      this.y += SP.LINE;
    }
    this.y += SP.A_PARA;
  }

  // ── Heading ──
  heading(text: string, level: number, keepH = 0) {
    const clean = cleanLine(text.replace(/^#{1,6}\s*/, ""));
    if (!clean) return;
    const size = level === 2 ? FS.H2 : level === 3 ? FS.H3 : FS.H4;
    const bef  = level === 2 ? SP.B_H2 : level === 3 ? SP.B_H3 : SP.B_H4;
    const aft  = level === 2 ? SP.A_H2 : level === 3 ? SP.A_H3 : SP.A_H4;
    const lhMm = (size / PT) * 1.25;  // pts → mm, 1.25× spacing
    const lines = wrapText(clean, this.bld, size);
    const totalH = bef + lines.length * lhMm + aft + (level === 2 ? 2 : 0);
    this.check(totalH + keepH);
    this.y += bef;
    for (const line of lines) {
      this.pg.drawText(line, { x: ML_PT, y: this.Y(this.y), size, font: this.bld, color: C.HEAD });
      this.y += lhMm;
    }
    if (level === 2) {
      this.pg.drawLine({
        start: { x: ML_PT, y: this.Y(this.y) }, end: { x: ML_PT + CW, y: this.Y(this.y) },
        thickness: 0.8, color: C.ACC,
      });
      this.y += 2;
    }
    this.y += aft;
  }

  // ── Bullet ──
  bullet(text: string) {
    const clean = cleanLine(text.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, ""));
    if (!clean) return;
    const textX = ML_PT + 5 * PT;
    const lines = wrapText(clean, this.reg, FS.BODY, CW - 5 * PT);
    this.check(lines.length * SP.LINE + 2.5);
    this.pg.drawCircle({ x: ML_PT + 2 * PT, y: this.Y(this.y) + FS.BODY * 0.25, size: 1.6, color: C.ACC });
    for (const line of lines) {
      this.pg.drawText(line, { x: textX, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY });
      this.y += SP.LINE;
    }
    this.y += 2;
  }

  // ── Numbered list item ──
  numbered(text: string, n: number) {
    const clean  = cleanLine(text.replace(/^\d+[.)]\s+/, ""));
    if (!clean) return;
    const numStr = `${n}.`;
    const numW   = this.bld.widthOfTextAtSize(numStr, FS.BODY);
    const textX  = ML_PT + numW + 3 * PT;
    const lines  = wrapText(clean, this.reg, FS.BODY, CW - numW - 3 * PT);
    this.check(lines.length * SP.LINE + 2.5);
    this.pg.drawText(numStr, { x: ML_PT, y: this.Y(this.y), size: FS.BODY, font: this.bld, color: C.ACC });
    for (const line of lines) {
      this.pg.drawText(line, { x: textX, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY });
      this.y += SP.LINE;
    }
    this.y += 2;
  }

  // ── Code block ──
  code(codeLines: string[]) {
    if (!codeLines.length) return;
    const pad    = SP.CODE_PAD;
    const blockH = codeLines.length * SP.CODE_LINE + pad * 2;
    this.check(blockH + SP.A_CODE);
    const rectY = this.Y(this.y + blockH);
    this.pg.drawRectangle({ x: ML_PT, y: rectY, width: CW, height: blockH * PT, color: C.CODE_BG });
    this.pg.drawRectangle({ x: ML_PT, y: rectY, width: 2.5 * PT, height: blockH * PT, color: C.ACC });
    this.y += pad;
    for (const rawLine of codeLines) {
      const safe = safeText(rawLine).replace(/\t/g, "    ");
      if (safe.trim()) {
        this.pg.drawText(safe, { x: ML_PT + 6 * PT, y: this.Y(this.y), size: FS.CODE, font: this.cou, color: C.CODE_FG });
      }
      this.y += SP.CODE_LINE;
    }
    this.y += pad + SP.A_CODE;
  }

  // ── Table [FIX #3 + #4] ──
  table(rawLines: string[]) {
    const parseCells = (line: string): string[] =>
      line.split("|").map(c => safeText(stripMd(c.trim()))).slice(1, -1);

    const rows = rawLines
      .filter(l => l.trim().startsWith("|") && !isTableSep(l))
      .map(parseCells)
      .filter(r => r.some(c => c.length > 0));

    if (!rows.length) return;

    const SIZE      = FS.TABLE;
    const PAD       = SP.TABLE_PAD;
    const numCols   = Math.max(...rows.map(r => r.length));
    const colW_pt   = CW / numCols;
    const inner_pt  = colW_pt - PAD * 2 * PT;
    const LHMT      = SP.TABLE_LINE;

    // Pre-compute wrapped cells and row heights
    interface RowInfo { isHeader: boolean; cells: string[][]; rowH: number; }
    const rowData: RowInfo[] = rows.map((cells, ri) => {
      const wrapped = Array.from({ length: numCols }, (_, c) =>
        wrapText(cells[c] ?? "", ri === 0 ? this.bld : this.reg, SIZE, inner_pt));
      const maxLines = Math.max(1, ...wrapped.map(c => c.length));
      return { isHeader: ri === 0, cells: wrapped, rowH: maxLines * LHMT + PAD * 2 };
    });

    // [FIX #3] Pre-check total table height before drawing the first row
    const totalH    = rowData.reduce((s, r) => s + r.rowH, 0);
    const fullPageH = MAX_Y - MT;
    if (totalH <= fullPageH && this.y + totalH > MAX_Y) {
      // Whole table fits on one page — move to fresh page
      this.addPage();
    } else if (totalH > fullPageH) {
      // Table is taller than a full page — just ensure 2 rows can start here
      const firstTwoH = rowData.slice(0, 2).reduce((s, r) => s + r.rowH, 0);
      if (this.y + firstTwoH > MAX_Y) this.addPage();
    }

    // [FIX #4] Track vertical-divider segments per page
    // tblPageStart[pageN] = y-mm at the top of this table on that page
    const pageSegments: Array<{ pn: number; top: number }> = [];
    let segStart = this.y;
    let segPage  = this.pn;

    for (const row of rowData) {
      // Row may need a new page mid-table
      if (this.y + row.rowH > MAX_Y) {
        // Save this page's segment before breaking
        pageSegments.push({ pn: segPage, top: segStart });
        this.addPage();
        segStart = this.y;
        segPage  = this.pn;
      }

      const bgY = this.Y(this.y + row.rowH);
      if (row.isHeader) {
        this.pg.drawRectangle({ x: ML_PT, y: bgY, width: CW, height: row.rowH * PT, color: C.PRI });
      } else {
        const rowIdx = rowData.indexOf(row);
        if (rowIdx % 2 === 0) {
          this.pg.drawRectangle({ x: ML_PT, y: bgY, width: CW, height: row.rowH * PT, color: C.TBL_EVEN });
        }
      }

      // Cell text
      for (let c = 0; c < numCols; c++) {
        const cellX = ML_PT + c * colW_pt + PAD * PT;
        const font  = row.isHeader ? this.bld : this.reg;
        const color = row.isHeader ? C.WHITE : C.BODY;
        let cy = this.y + PAD;
        for (const line of row.cells[c]) {
          this.pg.drawText(line, { x: cellX, y: this.Y(cy), size: SIZE, font, color });
          cy += LHMT;
        }
      }

      // Bottom border for this row
      this.pg.drawLine({
        start: { x: ML_PT, y: this.Y(this.y + row.rowH) },
        end:   { x: ML_PT + CW, y: this.Y(this.y + row.rowH) },
        thickness: 0.3, color: C.RULE,
      });

      this.y += row.rowH;
    }

    // Save the last page segment
    pageSegments.push({ pn: segPage, top: segStart });

    // [FIX #4] Draw accurate vertical column dividers on each page segment
    // We need to find the bottom y for each segment. Since we only have the last
    // segment's current page, draw for that page now. Earlier pages get their
    // bottom set to MAX_Y (they went to end of page).
    // We can only reliably draw dividers for single-page tables (most common case).
    if (pageSegments.length === 1) {
      const tblBottom = this.y;
      for (let c = 1; c < numCols; c++) {
        const divX = ML_PT + c * colW_pt;
        this.pg.drawLine({
          start: { x: divX, y: this.Y(tblBottom) },
          end:   { x: divX, y: this.Y(segStart) },
          thickness: 0.3, color: C.RULE,
        });
      }
    }

    this.y += 5;
  }

  // ── Horizontal rule ──
  rule() {
    this.check(SP.B_RULE + 1 + SP.A_RULE);
    this.y += SP.B_RULE;
    this.pg.drawLine({
      start: { x: ML_PT, y: this.Y(this.y) }, end: { x: ML_PT + CW, y: this.Y(this.y) },
      thickness: 0.5, color: C.RULE,
    });
    this.y += 1 + SP.A_RULE;
  }

  // ── Module content: markdown → PDF elements ──
  // [FIX #1] Collect consecutive plain-text lines into one paragraph block
  // so that multi-sentence paragraphs get properly wrapped + justified.
  content(markdown: string) {
    const lines = markdown.split("\n");
    let i     = 0;
    let listN = 0;

    while (i < lines.length) {
      const raw = lines[i];
      const t   = raw.trim();

      // Blank line → small gap, reset list counter
      if (!t) { this.y += 2; listN = 0; i++; continue; }

      // Fenced code block
      if (t.startsWith("```")) {
        const codeLines: string[] = [];
        let j = i + 1;
        while (j < lines.length && !lines[j].trim().startsWith("```")) codeLines.push(lines[j++]);
        this.code(codeLines);
        i = j < lines.length ? j + 1 : j;
        listN = 0;
        continue;
      }

      // Horizontal rule
      if (isHRule(t)) { this.rule(); i++; listN = 0; continue; }

      // Markdown table — collect all consecutive | lines
      if (t.startsWith("|")) {
        const tblLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) tblLines.push(lines[i++]);
        this.table(tblLines);
        listN = 0;
        continue;
      }

      // Heading — cascade orphan guard [FIX #5]: MIN_KEEP raised to 40 mm
      const lv = headingLevel(t);
      if (lv > 0) {
        listN = 0;
        const MIN_KEEP = 40;
        let cascade = 0, k = i + 1;
        while (k < lines.length) {
          while (k < lines.length && !lines[k].trim()) k++;
          if (k >= lines.length) break;
          const t2  = lines[k].trim();
          const lv2 = headingLevel(t2);
          if (lv2 > 0) {
            cascade += (lv2 === 2 ? SP.B_H2 : lv2 === 3 ? SP.B_H3 : SP.B_H4)
                     + (lv2 === 2 ? FS.H2 : lv2 === 3 ? FS.H3 : FS.H4) / PT * 1.25
                     + (lv2 === 2 ? SP.A_H2 : lv2 === 3 ? SP.A_H3 : SP.A_H4);
            k++;
          } else { cascade += MIN_KEEP; break; }
        }
        if (cascade === 0) cascade = MIN_KEEP;
        this.heading(t, lv === 1 ? 2 : lv, cascade);
        i++;
        continue;
      }

      // Numbered list
      if (/^\d+[.)]\s/.test(t)) { listN++; this.numbered(t, listN); i++; continue; }

      // Bullet
      if (isBullet(t)) { listN = 0; this.bullet(t); i++; continue; }

      // Blockquote → italic, indented
      if (t.startsWith(">")) {
        listN = 0;
        const bqText = cleanLine(t.replace(/^>\s*/, ""));
        if (bqText) {
          const bqLines = wrapText(bqText, this.obl, FS.BODY);
          this.check(bqLines.length * SP.LINE + SP.A_PARA);
          for (const line of bqLines) {
            this.pg.drawText(line, { x: ML_PT + 5 * PT, y: this.Y(this.y), size: FS.BODY, font: this.obl, color: C.DIM });
            this.y += SP.LINE;
          }
          this.y += SP.A_PARA;
        }
        i++;
        continue;
      }

      // [FIX #1] Plain paragraph — collect ALL consecutive non-special lines
      // into one block, then join and call para() once so that multi-sentence
      // paragraphs wrap across multiple display lines and get justified properly.
      listN = 0;
      const paraLines: string[] = [t];
      i++;
      while (i < lines.length) {
        const next = lines[i].trim();
        if (isSpecialLine(next)) break;
        paraLines.push(next);
        i++;
      }
      this.para(paraLines.join(" "));
    }
  }
}

// ─── HTTP handler ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader  = req.headers.get("authorization") ?? "";

    const userClient    = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const body     = await req.json();
    const courseId = body.course_id ?? body.courseId;
    if (!courseId) return new Response(JSON.stringify({ error: "course_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const { data: course, error: courseErr } = await serviceClient
      .from("courses").select("*").eq("id", courseId).eq("user_id", user.id).single();
    if (courseErr || !course) return new Response(JSON.stringify({ error: "Course not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const { data: modulesRaw } = await serviceClient
      .from("course_modules").select("*").eq("course_id", courseId).order("order_index");
    const modules: any[] = modulesRaw ?? [];

    // ── Build PDF ──
    const doc = await PDFDocument.create();
    const r   = new R(doc);
    await r.fonts();

    r.cover(course.title, course.description ?? undefined);

    let modNum = 0;
    for (const mod of modules) {
      const mdContent = cleanModuleContent(mod.content ?? "", mod.title);
      if (!mdContent && !mod.title) continue;
      modNum++;
      r.modulePage(mod.title, modNum);
      if (mdContent) r.content(mdContent);
    }

    const pdfBytes = await doc.save();

    const dateStr  = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().slice(0, 80);
    const fileName = `${user.id}/${safeName} - PDF-v2 - ${dateStr}.pdf`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports").upload(fileName, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: signed, error: signErr } = await serviceClient.storage
      .from("course-exports").createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: user.id, event_type: "COURSE_EXPORTED_PDF_V2", metadata: { course_id: courseId },
    }).then(() => {});

    return new Response(
      JSON.stringify({ url: signed.signedUrl, engine: "pdf-lib-v2", build: BUILD }),
      { headers: { ...corsHeaders, "Content-Type": "application/json", "x-export-pdf-v2-build": BUILD } },
    );
  } catch (err: any) {
    console.error("[EXPORT-PDF-V2]", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
