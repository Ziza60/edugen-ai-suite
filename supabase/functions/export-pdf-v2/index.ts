// export-pdf-v2/index.ts
// PDF generator v2 — pdf-lib@1.17.1 with exact font metrics for reliable justification
// BUILD: 2026-06-22a
// Fixes vs 2026-06-21a:
//  [1] Module banner is now a HEADER at the top of the content page (not a separate full page)
//  [2] Non-Latin-1 chars (emoji, symbols) are STRIPPED not replaced with "?"
//  [3] Markdown tables are detected and rendered as a proper grid

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "https://esm.sh/pdf-lib@1.17.1";
import { cleanModuleContent } from "../_shared/markdown.ts";

const BUILD = "2026-06-22a";
const TESTING_MODE = true;

// ─── Geometry (A4) ───────────────────────────────────────────────────────────
const PT       = 2.8346;          // points per mm
const PW       = 595.28;          // page width pts
const PH       = 841.89;          // page height pts
const ML       = 24;              // margin left mm
const MB       = 28;              // margin bottom mm
const MR       = 24;              // margin right mm
const MT       = 28;              // margin top mm (regular content pages)
const CW_MM    = 210 - ML - MR;   // content width mm = 162
const CW       = CW_MM * PT;      // content width pts (~459)
const ML_PT    = ML * PT;         // left edge pts
const MAX_Y    = 297 - MB;        // 269mm — last allowed baseline

// Module banner dimensions (replaces header on first page of each module)
const MOD_BAN_H  = 44;            // mm — height of module banner
const MOD_CONT_Y = MOD_BAN_H + 8; // mm — where content starts after banner (52mm)

// ─── Font sizes (pts) ────────────────────────────────────────────────────────
const FS = {
  COVER_TITLE: 30, COVER_SUB: 14, COVER_LABEL: 9,
  MOD_LABEL: 9.5, MOD_NUM: 11, MOD_TITLE: 18,
  H2: 15, H3: 13, H4: 11.5,
  BODY: 10.5, TABLE: 8.5, CODE: 9, SMALL: 8, FOOTER: 9,
};

// ─── Spacing (mm) ────────────────────────────────────────────────────────────
const SP = {
  B_H2: 12, A_H2: 7, B_H3: 9, A_H3: 5, B_H4: 6, A_H4: 4,
  A_PARA: 3, LINE: 5.5, TABLE_LINE: 4.2,
  CODE_PAD: 3, CODE_LINE: 4.5, A_CODE: 4,
  B_RULE: 3, A_RULE: 3,
};

// ─── Colors ──────────────────────────────────────────────────────────────────
const C = {
  PRI:      rgb(18/255,  24/255,  68/255),
  ACC:      rgb(196/255, 152/255, 40/255),
  BODY:     rgb(38/255,  38/255,  46/255),
  HEAD:     rgb(18/255,  24/255,  68/255),
  WHITE:    rgb(1, 1, 1),
  CODE_BG:  rgb(13/255,  17/255,  23/255),
  CODE_FG:  rgb(200/255, 225/255, 240/255),
  DIM:      rgb(0.55, 0.55, 0.6),
  RULE:     rgb(0.82, 0.82, 0.85),
  TBL_EVEN: rgb(0.95, 0.95, 0.97),
};

// ─── Text helpers ─────────────────────────────────────────────────────────────

function safeText(t: string): string {
  return (t || "")
    // Strip emoji ranges entirely — no "?" fallback [FIX #2]
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\u{2B00}-\u{2BFF}]/gu, "")
    // Normalise common typographic chars
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00AD/g, "")
    // Strip anything remaining outside Latin-1 (not "?", just remove)
    .replace(/[^\x00-\xFF]/g, "")
    .replace(/  +/g, " ")
    .trim();
}

function stripMd(t: string): string {
  return t
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1")
    .replace(/\*(?=\S)([^*]+?)(?<=\S)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, ""))
    .replace(/>\s*/g, "")
    .replace(/---/g, "")
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

function bulletBody(line: string): string {
  return line.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "");
}

// Is this a table separator row (|---|---|, |:--|:--| etc.)?
function isTableSep(line: string): boolean {
  return /^[\s|:\-]+$/.test(line);
}

// Wrap text using EXACT font metrics
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

// ─── Renderer ────────────────────────────────────────────────────────────────

class R {
  doc: PDFDocument;
  pg!: PDFPage;
  reg!: PDFFont;
  bld!: PDFFont;
  obl!: PDFFont;
  cou!: PDFFont;
  y = MT;    // current baseline mm from top
  pn = 0;

  constructor(doc: PDFDocument) { this.doc = doc; }

  async fonts() {
    this.reg = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bld = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.obl = await this.doc.embedFont(StandardFonts.HelveticaOblique);
    this.cou = await this.doc.embedFont(StandardFonts.Courier);
  }

  // y-mm-from-top → y-pts-from-bottom
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

  // ── Regular content page (standard navy header + footer) ──
  addPage() {
    this.pg = this.doc.addPage([PW, PH]);
    this.pn++;
    this.pg.drawRectangle({ x: 0, y: PH - 7 * PT, width: PW, height: 7 * PT, color: C.PRI });
    this.pg.drawRectangle({ x: 0, y: PH - 7.8 * PT, width: PW, height: 0.8 * PT, color: C.ACC });
    this._footer();
    this.y = MT;
  }

  // Ensure neededMm fits
  check(neededMm: number) { if (this.y + neededMm > MAX_Y) this.addPage(); }

  // ── Cover page ──
  cover(title: string, description?: string) {
    const pg = this.doc.addPage([PW, PH]);
    this.pn++;
    pg.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.PRI });
    pg.drawRectangle({ x: 0, y: 0, width: 3 * PT, height: PH, color: C.ACC });
    pg.drawRectangle({ x: 0, y: PH * 0.72, width: PW, height: 1.2 * PT, color: C.ACC });
    pg.drawText("EduGenAI", { x: ML_PT, y: PH * 0.72 + 5 * PT, size: FS.COVER_LABEL, font: this.bld, color: C.ACC });
    const tLines = wrapText(safeText(title), this.bld, FS.COVER_TITLE, PW - 55 * PT);
    let ty = PH * 0.65;
    for (const line of tLines) {
      pg.drawText(line, { x: ML_PT, y: ty, size: FS.COVER_TITLE, font: this.bld, color: C.WHITE });
      ty -= FS.COVER_TITLE * 1.35;
    }
    if (description) {
      const dLines = wrapText(safeText(description), this.reg, FS.COVER_SUB, PW - 55 * PT);
      let dy = ty - 8 * PT;
      for (const line of dLines.slice(0, 4)) {
        pg.drawText(line, { x: ML_PT, y: dy, size: FS.COVER_SUB, font: this.reg, color: rgb(0.75, 0.77, 0.83) });
        dy -= FS.COVER_SUB * 1.45;
      }
    }
    pg.drawRectangle({ x: 0, y: 0, width: PW, height: 8 * PT, color: C.ACC });
    const yr = new Date().getFullYear().toString();
    pg.drawText(yr, {
      x: PW - ML_PT - this.reg.widthOfTextAtSize(yr, FS.SMALL),
      y: 2.5 * PT, size: FS.SMALL, font: this.reg, color: C.PRI,
    });
  }

  // ── Module page [FIX #1]: banner at TOP of content page, content follows immediately ──
  modulePage(title: string, num: number) {
    this.pg = this.doc.addPage([PW, PH]);
    this.pn++;

    // Full-width navy banner (0 → MOD_BAN_H mm from top)
    this.pg.drawRectangle({
      x: 0, y: this.Y(MOD_BAN_H),
      width: PW, height: MOD_BAN_H * PT,
      color: C.PRI,
    });
    // Gold stripe at bottom of banner
    this.pg.drawRectangle({
      x: 0, y: this.Y(MOD_BAN_H),
      width: PW, height: 1.2 * PT,
      color: C.ACC,
    });

    // "MÓDULO 01" label
    const label = safeText("MÓDULO");
    this.pg.drawText(label, {
      x: ML_PT, y: this.Y(19),
      size: FS.MOD_LABEL, font: this.bld, color: C.ACC,
    });
    const labelW = this.bld.widthOfTextAtSize(label, FS.MOD_LABEL);
    this.pg.drawText(String(num).padStart(2, "0"), {
      x: ML_PT + labelW + 3 * PT, y: this.Y(19),
      size: FS.MOD_NUM, font: this.bld, color: C.WHITE,
    });

    // Module title
    const tLines = wrapText(safeText(title), this.bld, FS.MOD_TITLE, PW - 50 * PT);
    let ty = 30;
    for (const line of tLines) {
      this.pg.drawText(line, {
        x: ML_PT, y: this.Y(ty),
        size: FS.MOD_TITLE, font: this.bld, color: C.WHITE,
      });
      ty += FS.MOD_TITLE * 0.42;
    }

    // Footer
    this._footer();

    // Content starts below the banner
    this.y = MOD_CONT_Y; // 52mm from top
  }

  // ── Paragraph (JUSTIFIED — exact font metrics) ──
  para(text: string) {
    const clean = cleanLine(text);
    if (!clean) return;
    const lines = wrapText(clean, this.reg, FS.BODY);
    if (!lines.length) return;
    this.check(lines.length * SP.LINE + SP.A_PARA);
    for (let i = 0; i < lines.length; i++) {
      const words = lines[i].split(/\s+/).filter(Boolean);
      const isLast = i === lines.length - 1;
      if (!isLast && words.length >= 3) {
        const wws = words.map((w) => this.reg.widthOfTextAtSize(w, FS.BODY));
        const totalW = wws.reduce((a, b) => a + b, 0);
        const gap = (CW - totalW) / (words.length - 1);
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
    const lhMm = size * 0.38;
    const lines = wrapText(clean, this.bld, size);
    this.check(bef + lines.length * lhMm + aft + (level === 2 ? 2 : 0) + keepH);
    this.y += bef;
    for (const line of lines) {
      this.pg.drawText(line, { x: ML_PT, y: this.Y(this.y), size, font: this.bld, color: C.HEAD });
      this.y += lhMm;
    }
    if (level === 2) {
      this.pg.drawLine({ start: { x: ML_PT, y: this.Y(this.y) }, end: { x: ML_PT + CW, y: this.Y(this.y) }, thickness: 0.8, color: C.ACC });
      this.y += 2;
    }
    this.y += aft;
  }

  // ── Bullet ──
  bullet(text: string) {
    const clean = cleanLine(bulletBody(text));
    if (!clean) return;
    const textX = ML_PT + 4.5 * PT;
    const lines = wrapText(clean, this.reg, FS.BODY, CW - 4.5 * PT);
    this.check(lines.length * SP.LINE + 2);
    this.pg.drawCircle({ x: ML_PT + 1.8 * PT, y: this.Y(this.y) + FS.BODY * 0.25, size: 1.5, color: C.ACC });
    for (const line of lines) {
      this.pg.drawText(line, { x: textX, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY });
      this.y += SP.LINE;
    }
    this.y += 2;
  }

  // ── Numbered list item ──
  numbered(text: string, n: number) {
    const clean = cleanLine(text.replace(/^\d+[.)]\s+/, ""));
    if (!clean) return;
    const numStr = `${n}.`;
    const numW   = this.bld.widthOfTextAtSize(numStr, FS.BODY);
    const textX  = ML_PT + numW + 2 * PT;
    const lines  = wrapText(clean, this.reg, FS.BODY, CW - numW - 2 * PT);
    this.check(lines.length * SP.LINE + 2);
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
    this.pg.drawRectangle({ x: ML_PT, y: rectY, width: 2 * PT, height: blockH * PT, color: C.ACC });
    this.y += pad;
    for (const rawLine of codeLines) {
      const safe = safeText(rawLine).replace(/\t/g, "    ");
      if (safe.trim()) {
        this.pg.drawText(safe, { x: ML_PT + 5 * PT, y: this.Y(this.y), size: FS.CODE, font: this.cou, color: C.CODE_FG });
      }
      this.y += SP.CODE_LINE;
    }
    this.y += pad + SP.A_CODE;
  }

  // ── Table [FIX #3] ──
  table(rawLines: string[]) {
    // Parse pipe-delimited cells, skip separator rows
    const parseCells = (line: string): string[] =>
      line.split("|")
        .map(c => safeText(stripMd(c.trim())))
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

    const rows = rawLines
      .filter(l => l.trim().startsWith("|") && !isTableSep(l))
      .map(parseCells)
      .filter(r => r.some(c => c.length > 0));

    if (!rows.length) return;

    const SIZE     = FS.TABLE;
    const CELL_PAD = 2;              // mm padding inside each cell
    const numCols  = Math.max(...rows.map(r => r.length));
    const colW_pt  = CW / numCols;  // pts per column
    const inner_pt = colW_pt - CELL_PAD * 2 * PT;

    // Pre-compute wrapped lines for each cell
    const rowData = rows.map((cells, ri) => ({
      isHeader: ri === 0,
      cells: Array.from({ length: numCols }, (_, c) =>
        wrapText(cells[c] ?? "", ri === 0 ? this.bld : this.reg, SIZE, inner_pt)),
    }));

    for (const row of rowData) {
      const maxLines = Math.max(1, ...row.cells.map(c => c.length));
      const rowH     = maxLines * SP.TABLE_LINE + CELL_PAD * 2;

      this.check(rowH + 1);

      // Row background
      const bgY = this.Y(this.y + rowH);
      if (row.isHeader) {
        this.pg.drawRectangle({ x: ML_PT, y: bgY, width: CW, height: rowH * PT, color: C.PRI });
      } else if (rowData.indexOf(row) % 2 === 0) {
        this.pg.drawRectangle({ x: ML_PT, y: bgY, width: CW, height: rowH * PT, color: C.TBL_EVEN });
      }

      // Cell text
      for (let c = 0; c < numCols; c++) {
        const cellX  = ML_PT + c * colW_pt + CELL_PAD * PT;
        const font   = row.isHeader ? this.bld : this.reg;
        const color  = row.isHeader ? C.WHITE : C.BODY;
        let cellY    = this.y + CELL_PAD;
        for (const line of row.cells[c]) {
          this.pg.drawText(line, { x: cellX, y: this.Y(cellY), size: SIZE, font, color });
          cellY += SP.TABLE_LINE;
        }
      }

      // Bottom border per row
      this.pg.drawLine({
        start: { x: ML_PT, y: this.Y(this.y + rowH) },
        end:   { x: ML_PT + CW, y: this.Y(this.y + rowH) },
        thickness: 0.3, color: C.RULE,
      });

      this.y += rowH;
    }

    // Vertical column dividers (drawn on top)
    const tblTop = this.Y(/* start of first row — approximate */ this.y);
    for (let c = 1; c < numCols; c++) {
      const divX = ML_PT + c * colW_pt;
      this.pg.drawLine({
        start: { x: divX, y: this.Y(this.y) },
        end:   { x: divX, y: tblTop + rowData.length * 12 * PT }, // approximate
        thickness: 0.3, color: C.RULE,
      });
    }

    this.y += 5; // space after table
  }

  // ── Horizontal rule ──
  rule() {
    this.check(SP.B_RULE + 1 + SP.A_RULE);
    this.y += SP.B_RULE;
    this.pg.drawLine({ start: { x: ML_PT, y: this.Y(this.y) }, end: { x: ML_PT + CW, y: this.Y(this.y) }, thickness: 0.5, color: C.RULE });
    this.y += 1 + SP.A_RULE;
  }

  // ── Module content (markdown → PDF) ──
  content(markdown: string) {
    const lines = markdown.split("\n");
    let i = 0;
    let listN = 0;

    while (i < lines.length) {
      const raw = lines[i];
      const t   = raw.trim();

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
      if (t === "---" || t === "***" || t === "___") { this.rule(); i++; listN = 0; continue; }

      // Markdown table [FIX #3] — collect all consecutive pipe lines
      if (t.startsWith("|")) {
        const tblLines: string[] = [];
        let j = i;
        while (j < lines.length && lines[j].trim().startsWith("|")) tblLines.push(lines[j++]);
        this.table(tblLines);
        i = j;
        listN = 0;
        continue;
      }

      // Heading with cascade orphan guard
      const lv = headingLevel(t);
      if (lv > 0) {
        listN = 0;
        const MIN_KEEP = 20;
        let cascade = 0;
        let k = i + 1;
        while (k < lines.length) {
          while (k < lines.length && !lines[k].trim()) k++;
          if (k >= lines.length) break;
          const t2 = lines[k].trim();
          const lv2 = headingLevel(t2);
          if (lv2 > 0) {
            cascade += (lv2 === 2 ? SP.B_H2 : lv2 === 3 ? SP.B_H3 : SP.B_H4)
                     + (lv2 === 2 ? FS.H2 : lv2 === 3 ? FS.H3 : FS.H4) * 0.38
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

      // Blockquote → italic
      if (t.startsWith(">")) {
        listN = 0;
        const bqText = cleanLine(t.replace(/^>\s*/, ""));
        if (bqText) {
          const bqLines = wrapText(bqText, this.obl, FS.BODY);
          this.check(bqLines.length * SP.LINE + SP.A_PARA);
          for (const line of bqLines) {
            this.pg.drawText(line, { x: ML_PT + 4 * PT, y: this.Y(this.y), size: FS.BODY, font: this.obl, color: C.DIM });
            this.y += SP.LINE;
          }
          this.y += SP.A_PARA;
        }
        i++;
        continue;
      }

      // Paragraph
      listN = 0;
      this.para(t);
      i++;
    }
  }
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
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
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body     = await req.json();
    const courseId = body.course_id ?? body.courseId;
    if (!courseId) return new Response(JSON.stringify({ error: "course_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: course, error: courseErr } = await serviceClient
      .from("courses").select("*").eq("id", courseId).eq("user_id", user.id).single();
    if (courseErr || !course) return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
      r.modulePage(mod.title, modNum);   // [FIX #1] banner + content on same page
      if (mdContent) r.content(mdContent);
    }

    const pdfBytes = await doc.save();

    // Upload → signed URL
    const dateStr  = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s\-]/g, "")
      .replace(/\s+/g, "-").trim().slice(0, 80);
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
