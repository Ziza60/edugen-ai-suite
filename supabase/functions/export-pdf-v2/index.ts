// export-pdf-v2/index.ts  — BUILD 2026-06-22d
// ─── Changes vs 22c ────────────────────────────────────────────────────────────
// [fontkit] Registers @pdf-lib/fontkit; loads Roboto Regular+Bold from jsDelivr
//           with silent fallback to Helvetica so exports never fail.
//           Real per-glyph metrics for all Portuguese accented chars.
// [para-fix] Sentence-boundary break is now applied BOTH to the first line AND
//            to every subsequent line collected — prevents Contexto/Desafio/
//            Solução/Resultado from ever merging.
// [banner]   Module-title clamp uses ty > CLAMP_Y (current-position check, not
//            lookahead), + start at y=25 mm giving room for 2 full title lines.
// [cover]    No .slice(0,5) on description; safety cap raised to 210 mm.
// [table]    Pre-check uses actual remaining space (MAX_Y - this.y), not MT.
// [min-keep] MIN_KEEP = 28 mm (heading orphan guard).
// [spacing]  lhMm() helper converts pt → mm for all line advances.
// ───────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PDFDocument, StandardFonts, rgb, PDFPage, PDFFont,
} from "https://esm.sh/pdf-lib@1.17.1";
import { cleanModuleContent } from "../_shared/markdown.ts";

const BUILD        = "2026-07-07g-title-guard";

// NOTE ON FONTS: runtime font embedding was removed. Build 07c/07d embedded
// Roboto by fetching WOFFs and subsetting with fontkit, which blew the Supabase
// Edge worker memory limit (WORKER_RESOURCE_LIMIT / 546) — and an OOM kills the
// isolate, so the try/catch fallback can't save it. subset:false on a WOFF
// produces an INVALID embedded font ("Embedded font file may be invalid").
// The only edge-safe embed (raw TTF as a base64 constant) means a ~450KB source
// blob that's fragile to paste-deploy. Real embedded typography belongs to the
// planned HTML+CSS+Playwright engine (@font-face is trivial there). Standard
// Helvetica is used here — reliable, and what already runs in production.
const TESTING_MODE = true;

// ─── Geometry (A4 mm / pts) ───────────────────────────────────────────────────
const PT     = 2.8346;
const PW     = 595.28;
const PH     = 841.89;
const ML     = 24;   const MR = 24;
const MT     = 26;   const MB = 26;
const CW     = (210 - ML - MR) * PT;   // ≈ 459 pt
const ML_PT  = ML * PT;
const MAX_Y  = 297 - MB;               // 271 mm

const MOD_BAN_H  = 44;
const MOD_CONT_Y = 52;

// ─── Font sizes (pt) ──────────────────────────────────────────────────────────
const FS = {
  COVER_TITLE: 28, COVER_SUB: 13, COVER_LABEL: 9,
  MOD_LABEL: 9, MOD_NUM: 11, MOD_TITLE: 16,
  H2: 14, H3: 12.5, H4: 11,
  BODY: 10.5, TABLE: 8.5, CODE: 8.5, SMALL: 8, FOOTER: 9,
};

// ─── Spacing (mm) ─────────────────────────────────────────────────────────────
const SP = {
  B_H2: 9, A_H2: 5,
  B_H3: 6, A_H3: 3.5,
  B_H4: 4, A_H4: 3,
  A_PARA: 3.5,
  LINE: 5.5,
  TABLE_LINE: 4.4, TABLE_PAD: 2,
  CODE_PAD: 3, CODE_LINE: 4.2, A_CODE: 4,
  B_RULE: 3, A_RULE: 3,
};

function lhMm(sizePt: number, factor = 1.28): number {
  return (sizePt / PT) * factor;
}

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  PRI:       rgb(18/255,  24/255,  68/255),
  ACC:       rgb(196/255, 152/255, 40/255),
  BODY:      rgb(38/255,  38/255,  46/255),
  HEAD:      rgb(18/255,  24/255,  68/255),
  WHITE:     rgb(1, 1, 1),
  CODE_BG:   rgb(13/255, 17/255, 23/255),
  CODE_FG:   rgb(200/255, 225/255, 240/255),
  DIM:       rgb(0.50, 0.50, 0.57),
  RULE:      rgb(0.82, 0.82, 0.85),
  TBL_EVEN:  rgb(0.95, 0.95, 0.97),
  COVER_DIM: rgb(0.72, 0.74, 0.82),
  CALL_BG:   rgb(0.968, 0.952, 0.915),   // warm paper for callout boxes
};

// ─── Text helpers ─────────────────────────────────────────────────────────────

function safeText(t: string): string {
  return (t || "")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/­/g, "")
    .replace(/[^\x00-\xFF]/g, "")
    .replace(/  +/g, " ")
    .trim();
}

// Defensive title cleanup for courses created BEFORE the LLM-owned title fix,
// whose stored course.title may carry a conversational residue ("S de Finanças
// pessoais...", "crie um curso de..."). New courses already store a clean title.
function cleanTitle(t: string): string {
  return safeText(t || "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/^\s*(crie|criar|gere|gerar|quero|fa[çc]a)\b[^A-Za-zÀ-ÿ]*/i, "")
    .replace(/^\s*(um|uma|uns|umas)\s+(cursos?|treinamentos?)\s+(de|sobre|do|da|em)\s+/i, "")
    .replace(/^[A-Za-zÀ-ÿ]{1,3}\s+de\s+(?=[A-Za-zÀ-ÿ])/, "")   // orphan "S de "
    .replace(/\s{2,}/g, " ")
    .trim();
}

function stripMd(t: string): string {
  // NOTE: do NOT strip a leading ">" here. Real blockquotes are handled in
  // content() (which removes the ">" itself), so any ">" that reaches stripMd is
  // literal content — e.g. the ">"/">=" comparison operators in a list item or
  // paragraph. Stripping it wiped those operators.
  return t
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

// Markdown strip for TABLE CELLS. Same as stripMd but WITHOUT the blockquote
// (`^> `) removal — otherwise a cell whose content is the ">" / ">=" operator
// (comparison-operator tables) would be wiped to an empty string.
function stripMdCell(t: string): string {
  return t
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function cleanLine(t: string): string { return safeText(stripMd(t)); }
function cleanCell(t: string): string { return safeText(stripMdCell(t)); }

function headingLevel(line: string): number {
  const m = line.match(/^(#{1,6})\s/);
  return m ? m[1].length : 0;
}

function isBullet(line: string): boolean {
  return /^[-*+]\s/.test(line) || /^\d+[.)]\s/.test(line);
}

function isHRule(line: string): boolean {
  return /^(---+|\*\*\*+|___+)\s*$/.test(line);
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

// A "labeled item" line starts with a single capitalized word followed immediately
// by a colon — e.g. "Contexto:", "Desafio:", "Resultado:", "Solução:".
// These must each become their own para() call even without a blank line separator.
// The regex intentionally excludes commas/parens so "Em sua essência, ..." is NOT matched.
function isLabeledItem(rawLine: string): boolean {
  const c = cleanLine(rawLine);
  return /^[A-ZÁÉÍÓÚÀÃÕÂÊÔ][a-záéíóúàãõâêôç]+:/.test(c);
}

// ─── Word wrap — exact pdf-lib font metrics ───────────────────────────────────
// Hard-breaks any single word wider than maxW at the character level so a long
// token (e.g. "Exponenciação" in a narrow table column) never overflows its box.
function wrapText(text: string, font: PDFFont, size: number, maxW = CW): string[] {
  const t = text.trim();
  if (!t) return [];

  const fitWord = (w: string): string[] => {
    if (font.widthOfTextAtSize(w, size) <= maxW) return [w];
    // break the oversized word into chunks that each fit maxW
    const chunks: string[] = [];
    let chunk = "";
    for (const ch of w) {
      if (chunk && font.widthOfTextAtSize(chunk + ch, size) > maxW) { chunks.push(chunk); chunk = ch; }
      else chunk += ch;
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  };

  const words = t.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    for (const piece of fitWord(w)) {
      const test = cur ? `${cur} ${piece}` : piece;
      if (font.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = piece; }
      else cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

class R {
  doc: PDFDocument;
  pg!: PDFPage;
  reg!: PDFFont; bld!: PDFFont; obl!: PDFFont; cou!: PDFFont;
  y = MT; pn = 0;
  tocPage: PDFPage | null = null;
  tocEntries: { num: number; title: string; page: number }[] = [];

  constructor(doc: PDFDocument) { this.doc = doc; }

  /** Reserve the TOC page right after the cover; its entries are drawn at the
   *  end (after every module landed on its real page number). */
  reserveToc() {
    this.addPage();
    this.tocPage = this.pg;
  }

  renderToc() {
    if (!this.tocPage) return;
    const pg = this.tocPage;
    pg.drawText("Sumário", {
      x: ML_PT, y: this.Y(30), size: FS.H2 + 4, font: this.bld, color: C.PRI,
    });
    pg.drawRectangle({ x: ML_PT, y: this.Y(34), width: 22 * PT, height: 1 * PT, color: C.ACC });

    let ty = 48;
    const SIZE = 10.5;
    const lineAdv = 9;
    for (const e of this.tocEntries) {
      if (ty > MAX_Y - 10) break;
      const numStr = `Módulo ${String(e.num).padStart(2, "0")}`;
      const pageStr = String(e.page);
      const title = e.title.length > 58 ? e.title.slice(0, 58).replace(/\s+\S*$/, "") + "…" : e.title;

      pg.drawText(numStr, { x: ML_PT, y: this.Y(ty), size: 8.5, font: this.bld, color: C.ACC });
      pg.drawText(title, { x: ML_PT, y: this.Y(ty + 5.5), size: SIZE, font: this.reg, color: C.BODY });

      // dot leader between title and right-aligned page number
      const titleW = this.reg.widthOfTextAtSize(title, SIZE);
      const pageW = this.bld.widthOfTextAtSize(pageStr, SIZE);
      const dotStart = ML_PT + titleW + 6;
      const dotEnd = ML_PT + CW - pageW - 6;
      if (dotEnd > dotStart + 10) {
        const dotW = this.reg.widthOfTextAtSize(".", SIZE) + 2.2;
        const n = Math.floor((dotEnd - dotStart) / dotW);
        pg.drawText(". ".repeat(Math.max(0, Math.floor(n / 1))).trim(), {
          x: dotStart, y: this.Y(ty + 5.5), size: SIZE, font: this.reg, color: C.RULE,
        });
      }
      pg.drawText(pageStr, {
        x: ML_PT + CW - pageW, y: this.Y(ty + 5.5), size: SIZE, font: this.bld, color: C.PRI,
      });
      ty += lineAdv + 5.5;
    }
  }

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

  addPage() {
    this.pg = this.doc.addPage([PW, PH]);
    this.pn++;
    this.pg.drawRectangle({ x: 0, y: PH - 7 * PT, width: PW, height: 7 * PT, color: C.PRI });
    this.pg.drawRectangle({ x: 0, y: PH - 7.8 * PT, width: PW, height: 0.8 * PT, color: C.ACC });
    this._footer();
    this.y = MT;
  }

  check(neededMm: number) {
    if (this.y + neededMm > MAX_Y) this.addPage();
  }

  // ── Cover ──────────────────────────────────────────────────────────────────
  cover(
    title: string,
    description?: string,
    info?: { audience?: string; language?: string; modules?: number; hours?: string },
  ) {
    const pg = this.doc.addPage([PW, PH]);
    this.pn++;
    pg.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.PRI });
    pg.drawRectangle({ x: 0, y: 0, width: 3 * PT, height: PH, color: C.ACC });
    pg.drawRectangle({ x: PW - 3 * PT, y: 0, width: 3 * PT, height: PH,
      color: rgb(30/255, 38/255, 90/255) });

    pg.drawText("EduGenAI", {
      x: ML_PT, y: this.Y(15),
      size: FS.COVER_LABEL, font: this.bld, color: C.ACC,
    });
    pg.drawRectangle({ x: ML_PT, y: this.Y(25), width: CW, height: 1.5 * PT, color: C.ACC });

    // Title — starts at 38 mm
    const tLines = wrapText(safeText(title), this.bld, FS.COVER_TITLE, PW - 60 * PT);
    let ty = 38;
    for (const line of tLines) {
      pg.drawText(line, { x: ML_PT, y: this.Y(ty), size: FS.COVER_TITLE, font: this.bld, color: C.WHITE });
      ty += lhMm(FS.COVER_TITLE, 1.35);
    }

    // Description — no line count limit; mm cap only
    if (description) {
      ty += 7;
      const dLines = wrapText(safeText(description), this.reg, FS.COVER_SUB, PW - 60 * PT);
      for (const line of dLines) {
        if (ty > 215) break;
        pg.drawText(line, { x: ML_PT, y: this.Y(ty), size: FS.COVER_SUB, font: this.reg, color: C.COVER_DIM });
        ty += lhMm(FS.COVER_SUB, 1.45);
      }
    }

    // Course fact strip (audience / workload / modules / language / date)
    if (info) {
      const facts: [string, string][] = [];
      if (info.modules) facts.push(["MÓDULOS", String(info.modules)]);
      if (info.hours) facts.push(["CARGA ESTIMADA", info.hours]);
      if (info.audience) facts.push(["PÚBLICO", info.audience.length > 34 ? info.audience.slice(0, 34).replace(/\s+\S*$/, "") + "…" : info.audience]);
      if (info.language) facts.push(["IDIOMA", info.language]);
      facts.push(["GERADO EM", new Date().toLocaleDateString("pt-BR")]);

      let fy = 252;
      pg.drawRectangle({ x: ML_PT, y: this.Y(fy - 8), width: CW, height: 0.6 * PT, color: rgb(0.28, 0.32, 0.55) });
      let fx = ML_PT;
      for (const [label, value] of facts) {
        const wLabel = this.bld.widthOfTextAtSize(label, 7);
        const wValue = this.reg.widthOfTextAtSize(safeText(value), 9.5);
        const cellW = Math.max(wLabel, wValue) + 22;
        if (fx + cellW > ML_PT + CW) break;
        pg.drawText(label, { x: fx, y: this.Y(fy), size: 7, font: this.bld, color: C.ACC });
        pg.drawText(safeText(value), { x: fx, y: this.Y(fy + 6), size: 9.5, font: this.reg, color: C.WHITE });
        fx += cellW;
      }
    }

    // Bottom gold bar
    pg.drawRectangle({ x: 0, y: 0, width: PW, height: 8 * PT, color: C.ACC });
    const yr = new Date().getFullYear().toString();
    pg.drawText(yr, {
      x: PW - ML_PT - this.reg.widthOfTextAtSize(yr, FS.SMALL),
      y: 2.5 * PT, size: FS.SMALL, font: this.reg, color: C.PRI,
    });
  }

  // ── Module banner page ─────────────────────────────────────────────────────
  modulePage(title: string, num: number) {
    this.pg = this.doc.addPage([PW, PH]);
    this.pn++;
    this.tocEntries.push({ num, title: safeText(title), page: this.pn });

    this.pg.drawRectangle({
      x: 0, y: this.Y(MOD_BAN_H), width: PW, height: MOD_BAN_H * PT, color: C.PRI,
    });
    this.pg.drawRectangle({
      x: 0, y: this.Y(MOD_BAN_H), width: PW, height: 1.5 * PT, color: C.ACC,
    });

    const label  = safeText("MÓDULO");
    const labelW = this.bld.widthOfTextAtSize(label, FS.MOD_LABEL);
    this.pg.drawText(label, { x: ML_PT, y: this.Y(17), size: FS.MOD_LABEL, font: this.bld, color: C.ACC });
    this.pg.drawText(String(num).padStart(2, "0"), {
      x: ML_PT + labelW + 2.5 * PT, y: this.Y(17),
      size: FS.MOD_NUM, font: this.bld, color: C.WHITE,
    });

    // Title: clamp to banner. Check CURRENT position before drawing (not lookahead).
    const titleLines = wrapText(safeText(title), this.bld, FS.MOD_TITLE, PW - 48 * PT);
    const titleAdv   = lhMm(FS.MOD_TITLE, 1.28);
    const TITLE_CLAMP = MOD_BAN_H - 4;   // 40 mm — last allowed baseline
    let ty = 25;
    for (const line of titleLines) {
      if (ty > TITLE_CLAMP) break;        // current position check — NOT lookahead
      this.pg.drawText(line, { x: ML_PT, y: this.Y(ty), size: FS.MOD_TITLE, font: this.bld, color: C.WHITE });
      ty += titleAdv;
    }

    this._footer();
    this.y = MOD_CONT_Y;
  }

  // ── Paragraph — full justification via exact font metrics ──────────────────
  para(text: string) {
    const clean = cleanLine(text);
    if (!clean) return;
    const lines = wrapText(clean, this.reg, FS.BODY);
    if (!lines.length) return;

    // Anti-widow: move whole paragraph to next page if ≤1 wrap line fits here
    if (lines.length > 1 && (MAX_Y - this.y) < SP.LINE * 2) this.addPage();
    this.check(lines.length * SP.LINE + SP.A_PARA);

    for (let i = 0; i < lines.length; i++) {
      const words  = lines[i].split(/\s+/).filter(Boolean);
      const isLast = i === lines.length - 1;

      if (!isLast && words.length >= 3) {
        // Justify: distribute remaining space between words
        const wws    = words.map((w) => this.reg.widthOfTextAtSize(w, FS.BODY));
        const totalW = wws.reduce((a, b) => a + b, 0);
        const gap    = (CW - totalW) / (words.length - 1);
        let cx = ML_PT;
        for (let j = 0; j < words.length; j++) {
          this.pg.drawText(words[j], {
            x: cx, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY,
          });
          cx += wws[j] + gap;
        }
      } else {
        this.pg.drawText(lines[i], {
          x: ML_PT, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY,
        });
      }
      this.y += SP.LINE;
    }
    this.y += SP.A_PARA;
  }

  // ── Heading ────────────────────────────────────────────────────────────────
  heading(text: string, level: number, keepH = 0) {
    const clean = cleanLine(text.replace(/^#{1,6}\s*/, ""));
    if (!clean) return;
    const size  = level === 2 ? FS.H2 : level === 3 ? FS.H3 : FS.H4;
    const bef   = level === 2 ? SP.B_H2 : level === 3 ? SP.B_H3 : SP.B_H4;
    const aft   = level === 2 ? SP.A_H2 : level === 3 ? SP.A_H3 : SP.A_H4;
    const adv   = lhMm(size, 1.25);
    const hLines = wrapText(clean, this.bld, size);
    const rule   = level === 2 ? 2 : 0;
    this.check(bef + hLines.length * adv + aft + rule + keepH);
    this.y += bef;
    for (const line of hLines) {
      this.pg.drawText(line, { x: ML_PT, y: this.Y(this.y), size, font: this.bld, color: C.HEAD });
      this.y += adv;
    }
    if (level === 2) {
      this.pg.drawLine({
        start: { x: ML_PT, y: this.Y(this.y) },
        end:   { x: ML_PT + CW, y: this.Y(this.y) },
        thickness: 0.7, color: C.ACC,
      });
      this.y += 2;
    }
    this.y += aft;
  }

  // ── Bullet ─────────────────────────────────────────────────────────────────
  bullet(text: string) {
    const clean = cleanLine(text.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, ""));
    if (!clean) return;
    const textX  = ML_PT + 5 * PT;
    const bLines = wrapText(clean, this.reg, FS.BODY, CW - 5 * PT);
    this.check(bLines.length * SP.LINE + 2);
    this.pg.drawCircle({
      x: ML_PT + 2 * PT, y: this.Y(this.y) + FS.BODY * 0.25, size: 1.5, color: C.ACC,
    });
    for (const line of bLines) {
      this.pg.drawText(line, { x: textX, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY });
      this.y += SP.LINE;
    }
    this.y += 2;
  }

  // ── Numbered list item ──────────────────────────────────────────────────────
  numbered(text: string, n: number) {
    const clean  = cleanLine(text.replace(/^\d+[.)]\s+/, ""));
    if (!clean) return;
    const numStr = `${n}.`;
    const numW   = this.bld.widthOfTextAtSize(numStr, FS.BODY);
    const textX  = ML_PT + numW + 3 * PT;
    const nLines = wrapText(clean, this.reg, FS.BODY, CW - numW - 3 * PT);
    this.check(nLines.length * SP.LINE + 2);
    this.pg.drawText(numStr, { x: ML_PT, y: this.Y(this.y), size: FS.BODY, font: this.bld, color: C.ACC });
    for (const line of nLines) {
      this.pg.drawText(line, { x: textX, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY });
      this.y += SP.LINE;
    }
    this.y += 2;
  }

  // ── Code block ─────────────────────────────────────────────────────────────
  code(codeLines: string[]) {
    if (!codeLines.length) return;
    const pad    = SP.CODE_PAD;
    const blockH = codeLines.length * SP.CODE_LINE + pad * 2;
    this.check(blockH + SP.A_CODE);
    const rectY = this.Y(this.y + blockH);
    this.pg.drawRectangle({ x: ML_PT, y: rectY, width: CW, height: blockH * PT, color: C.CODE_BG });
    this.pg.drawRectangle({ x: ML_PT, y: rectY, width: 2.5 * PT, height: blockH * PT, color: C.ACC });
    this.y += pad;
    for (const raw of codeLines) {
      const safe = safeText(raw).replace(/\t/g, "    ");
      if (safe.trim()) {
        this.pg.drawText(safe, {
          x: ML_PT + 6 * PT, y: this.Y(this.y), size: FS.CODE, font: this.cou, color: C.CODE_FG,
        });
      }
      this.y += SP.CODE_LINE;
    }
    this.y += pad + SP.A_CODE;
  }

  // ── Table ───────────────────────────────────────────────────────────────────
  table(rawLines: string[]) {
    // Split a pipe row into cells, dropping the empty cells created by the
    // leading/trailing pipes ONLY (a genuinely empty middle cell is preserved).
    const parseCells = (line: string): string[] => {
      const parts = line.split("|").map(c => cleanCell(c.trim()));
      if (parts.length && parts[0] === "") parts.shift();
      if (parts.length && parts[parts.length - 1] === "") parts.pop();
      return parts;
    };

    const rows = rawLines
      .filter(l => l.trim().startsWith("|") && !isTableSep(l))
      .map(parseCells)
      .filter(r => r.length > 0);

    if (!rows.length) return;

    const SIZE    = FS.TABLE;
    const PAD     = SP.TABLE_PAD;
    // The header row (first row) defines the column count — stray extra cells in
    // a body row can't invent a phantom empty column.
    const numCols = rows[0].length;
    const colW    = CW / numCols;
    const inner   = colW - PAD * 2 * PT;

    interface RowInfo { isHeader: boolean; cells: string[][]; rowH: number; }
    const rowData: RowInfo[] = rows.map((cells, ri) => {
      const wrapped = Array.from({ length: numCols }, (_, c) =>
        wrapText(cells[c] ?? "", ri === 0 ? this.bld : this.reg, SIZE, inner));
      const maxL = Math.max(1, ...wrapped.map(c => c.length));
      return { isHeader: ri === 0, cells: wrapped, rowH: maxL * SP.TABLE_LINE + PAD * 2 };
    });

    const totalH   = rowData.reduce((s, r) => s + r.rowH, 0);
    const remaining = MAX_Y - this.y;           // actual space left on this page
    const freshH   = MAX_Y - MT;               // space on a fresh page

    if (totalH <= freshH && totalH > remaining) {
      this.addPage();                           // move whole table to next page
    } else if (totalH > freshH) {
      const twoH = rowData.slice(0, 2).reduce((s, r) => s + r.rowH, 0);
      if (twoH > remaining) this.addPage();
    }

    const segStart = this.y;
    let multiPage  = false;

    const drawRow = (row: RowInfo, zebraIdx: number) => {
      const bgY = this.Y(this.y + row.rowH);
      if (row.isHeader) {
        this.pg.drawRectangle({ x: ML_PT, y: bgY, width: CW, height: row.rowH * PT, color: C.PRI });
      } else if (zebraIdx % 2 === 0) {
        this.pg.drawRectangle({ x: ML_PT, y: bgY, width: CW, height: row.rowH * PT, color: C.TBL_EVEN });
      }

      const capMm = (SIZE * 0.70) / PT;   // approx cap height in mm
      for (let c = 0; c < numCols; c++) {
        const cx    = ML_PT + c * colW + PAD * PT;
        const font  = row.isHeader ? this.bld : this.reg;
        const color = row.isHeader ? C.WHITE : C.BODY;
        const cellLines = row.cells[c];
        // Vertically center the cell's text block within the row so text isn't
        // glued to the top border (rows are as tall as the tallest cell).
        const blockH = (cellLines.length - 1) * SP.TABLE_LINE + capMm;
        let cy = this.y + Math.max(PAD, (row.rowH - blockH) / 2) + capMm;
        for (const line of cellLines) {
          this.pg.drawText(line, { x: cx, y: this.Y(cy), size: SIZE, font, color });
          cy += SP.TABLE_LINE;
        }
      }

      this.pg.drawLine({
        start: { x: ML_PT, y: this.Y(this.y + row.rowH) },
        end:   { x: ML_PT + CW, y: this.Y(this.y + row.rowH) },
        thickness: 0.3, color: C.RULE,
      });
      this.y += row.rowH;
    };

    for (let ri = 0; ri < rowData.length; ri++) {
      const row = rowData[ri];
      if (this.y + row.rowH > MAX_Y) {
        multiPage = true;
        this.addPage();
        // Repeat the header on the new page so the continued table stays readable.
        if (!row.isHeader && rowData[0]?.isHeader) drawRow(rowData[0], 0);
      }
      drawRow(row, ri);
    }

    // Vertical dividers for single-page tables
    if (!multiPage) {
      for (let c = 1; c < numCols; c++) {
        const divX = ML_PT + c * colW;
        this.pg.drawLine({
          start: { x: divX, y: this.Y(this.y) },
          end:   { x: divX, y: this.Y(segStart) },
          thickness: 0.3, color: C.RULE,
        });
      }
    }

    this.y += 5;
  }

  // ── Callout box (blockquotes / reflection checkpoints) ─────────────────────
  callout(rawText: string) {
    const text = cleanLine(rawText);
    if (!text) return;
    // "Pare um momento e reflita: pergunta" → title + body split
    const m = text.match(/^(pare\s+um\s+momento\s+e\s+reflita|reflita|para\s+refletir|dica|importante|aten[çc][ãa]o|nota)\s*[:—-]?\s*/i);
    const title = m ? (
      /reflita|refletir/i.test(m[1]) ? "Pare e reflita" :
      m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
    ) : "Nota";
    const body = m ? text.slice(m[0].length).trim() || text : text;

    const PAD = 4.5;
    const bodyLines = wrapText(body, this.obl, FS.BODY, CW - (PAD * 2 + 3) * PT);
    const titleH = 6;
    const boxH = PAD + titleH + bodyLines.length * SP.LINE + PAD - 1;

    // keep the whole box together on one page
    this.check(boxH + 4);
    const rectY = this.Y(this.y + boxH);
    this.pg.drawRectangle({ x: ML_PT, y: rectY, width: CW, height: boxH * PT, color: C.CALL_BG });
    this.pg.drawRectangle({ x: ML_PT, y: rectY, width: 2.5 * PT, height: boxH * PT, color: C.ACC });

    const tx = ML_PT + (PAD + 3) * PT;
    this.y += PAD + 1.5;
    this.pg.drawText(title, { x: tx, y: this.Y(this.y + 2.2), size: 9, font: this.bld, color: C.PRI });
    this.y += titleH;
    for (const line of bodyLines) {
      this.pg.drawText(line, { x: tx, y: this.Y(this.y), size: FS.BODY, font: this.obl, color: C.BODY });
      this.y += SP.LINE;
    }
    this.y += PAD + 3;
  }

  // ── Horizontal rule ─────────────────────────────────────────────────────────
  rule() {
    this.check(SP.B_RULE + 1 + SP.A_RULE);
    this.y += SP.B_RULE;
    this.pg.drawLine({
      start: { x: ML_PT, y: this.Y(this.y) },
      end:   { x: ML_PT + CW, y: this.Y(this.y) },
      thickness: 0.4, color: C.RULE,
    });
    this.y += 1 + SP.A_RULE;
  }

  // ── Module content: markdown → PDF elements ─────────────────────────────────
  content(markdown: string) {
    const lines = markdown.split("\n");
    let i     = 0;
    let listN = 0;

    while (i < lines.length) {
      const raw = lines[i];
      const t   = raw.trim();

      // Blank line
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

      // Markdown table
      if (t.startsWith("|")) {
        const tblLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) tblLines.push(lines[i++]);
        this.table(tblLines);
        listN = 0;
        continue;
      }

      // Heading
      const lv = headingLevel(t);
      if (lv > 0) {
        listN = 0;
        const MIN_KEEP = 28;
        // Cascade orphan guard: look ahead to find first non-heading content
        let cascade = 0, k = i + 1;
        while (k < lines.length) {
          while (k < lines.length && !lines[k].trim()) k++;
          if (k >= lines.length) break;
          const t2  = lines[k].trim();
          const lv2 = headingLevel(t2);
          if (lv2 > 0) {
            const s2 = lv2 === 2 ? FS.H2 : lv2 === 3 ? FS.H3 : FS.H4;
            cascade += (lv2 === 2 ? SP.B_H2 : lv2 === 3 ? SP.B_H3 : SP.B_H4)
                     + lhMm(s2, 1.25)
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

      // Blockquote → visual callout (gold bar + warm box; never a literal ">")
      if (t.startsWith(">")) {
        listN = 0;
        const bqParts: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith(">")) {
          bqParts.push(lines[i].trim().replace(/^>\s*/, ""));
          i++;
        }
        this.callout(bqParts.join(" "));
        continue;
      }

      // ── Plain paragraph ──────────────────────────────────────────────────────
      // Merge consecutive non-special source lines into ONE para() call so that
      // the resulting block wraps to many display lines → full justification.
      // Break only when:
      //   • a blank / special line is encountered (standard paragraph boundary)
      //   • the NEXT line is a labeled item ("Contexto:", "Desafio:", "Resultado:"…)
      //     so those sections each get their own visually distinct block.
      // If the CURRENT line is itself labeled, don't collect continuations (labeled
      // items are typically self-contained single sentences in the source).
      listN = 0;
      const paraLines: string[] = [t];
      const curIsLabeled = isLabeledItem(t);
      i++;
      if (!curIsLabeled) {
        while (i < lines.length) {
          const next = lines[i].trim();
          if (isSpecialLine(next)) break;   // heading/bullet/table/blank → stop
          if (isLabeledItem(next)) break;   // next line is a new labeled item → stop
          paraLines.push(next);
          i++;
        }
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

    const doc = await PDFDocument.create();
    const r   = new R(doc);
    await r.fonts();

    const courseTitle = cleanTitle(course.title) || "Curso";

    // Document metadata (viewer title bar, search, accessibility basics)
    doc.setTitle(courseTitle);
    doc.setAuthor("EduGenAI");
    doc.setSubject(course.description || course.theme || "");
    doc.setCreator(`EduGenAI export-pdf-v2 ${BUILD}`);
    doc.setProducer("EduGenAI");
    doc.setLanguage(course.language || "pt-BR");
    doc.setCreationDate(new Date());

    // Estimated workload from total content length (~180 words/min reading pace)
    const totalWords = modules.reduce(
      (s: number, m: any) => s + String(m.content || "").split(/\s+/).length, 0,
    );
    const mins = Math.max(10, Math.round(totalWords / 180));
    const hours = mins >= 60 ? `≈ ${(Math.round((mins / 60) * 2) / 2).toString().replace(".", ",")}h` : `≈ ${mins} min`;

    r.cover(courseTitle, course.description ?? undefined, {
      audience: course.target_audience || undefined,
      language: course.language || "pt-BR",
      modules: modules.length,
      hours,
    });
    r.reserveToc();

    let modNum = 0;
    for (const mod of modules) {
      const mdContent = cleanModuleContent(mod.content ?? "", mod.title);
      if (!mdContent && !mod.title) continue;
      modNum++;
      r.modulePage(mod.title, modNum);
      if (mdContent) r.content(mdContent);
    }

    r.renderToc();

    const pdfBytes = await doc.save();

    const dateStr  = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().slice(0, 80);
    const fileName = `${user.id}/${safeName} - PDF-v2 - ${dateStr}.pdf`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports").upload(fileName, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: signed, error: signErr } = await serviceClient.storage
      .from("course-exports").createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: user.id, event_type: "COURSE_EXPORTED_PDF_V2",
      metadata: { course_id: courseId, build: BUILD },
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
