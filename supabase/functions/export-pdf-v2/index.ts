// export-pdf-v2/index.ts
// PDF generator v2 — pdf-lib@1.17.1 with exact font metrics for reliable justification
// BUILD: 2026-06-21a

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from "https://esm.sh/pdf-lib@1.17.1";
import { cleanModuleContent } from "../_shared/markdown.ts";

const BUILD = "2026-06-21a";
const TESTING_MODE = true;

// ─── Geometry (A4) ───────────────────────────────────────────────────────────
const PT = 2.8346;           // points per mm
const PW = 595.28;           // page width pts
const PH = 841.89;           // page height pts
const ML = 24;               // margin left mm
const MT = 28;               // margin top mm (first text baseline)
const MB = 28;               // margin bottom mm
const MR = 24;               // margin right mm
const CW_MM = 210 - ML - MR; // content width mm = 162
const CW = CW_MM * PT;       // content width pts
const ML_PT = ML * PT;       // left edge pts
const MAX_Y = 297 - MB;      // 269 mm — last allowed baseline

// ─── Font sizes (pts) ────────────────────────────────────────────────────────
const FS = {
  COVER_TITLE: 30, COVER_SUB: 14, COVER_LABEL: 9,
  MOD_LABEL: 9.5, MOD_NUM: 11, MOD_TITLE: 20,
  H2: 15, H3: 13, H4: 11.5,
  BODY: 10.5, CODE: 9, SMALL: 8, FOOTER: 9,
};

// ─── Spacing (mm) ────────────────────────────────────────────────────────────
const SP = {
  B_H2: 12, A_H2: 7,
  B_H3: 9,  A_H3: 5,
  B_H4: 6,  A_H4: 4,
  A_PARA: 3, LINE: 5.5,
  CODE_PAD: 3, CODE_LINE: 4.5, A_CODE: 4,
  B_RULE: 3, A_RULE: 3,
};

// ─── Colors ──────────────────────────────────────────────────────────────────
const C = {
  PRI:     rgb(18/255,  24/255,  68/255),   // navy
  ACC:     rgb(196/255, 152/255, 40/255),   // gold
  BODY:    rgb(38/255,  38/255,  46/255),
  HEAD:    rgb(18/255,  24/255,  68/255),
  WHITE:   rgb(1, 1, 1),
  CODE_BG: rgb(13/255,  17/255,  23/255),
  CODE_FG: rgb(200/255, 225/255, 240/255),
  DIM:     rgb(0.55, 0.55, 0.6),
  RULE:    rgb(0.82, 0.82, 0.85),
};

// ─── Text helpers ─────────────────────────────────────────────────────────────

function safeText(t: string): string {
  return (t || "")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")   // emoji
    .replace(/[\u{2600}-\u{27BF}]/gu, "")      // misc symbols
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00AD/g, "")
    .replace(/[^\x00-\xFF]/g, "?")             // outside Latin-1 → ?
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

function cleanLine(t: string): string {
  return safeText(stripMd(t));
}

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

// Wrap text using EXACT font metrics — this is the key advantage over jsPDF
function wrapText(text: string, font: PDFFont, size: number, maxW = CW): string[] {
  const t = text.trim();
  if (!t) return [];
  const words = t.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ─── Renderer ────────────────────────────────────────────────────────────────

class R {
  doc: PDFDocument;
  pg!: PDFPage;
  reg!: PDFFont;  // Helvetica
  bld!: PDFFont;  // HelveticaBold
  obl!: PDFFont;  // HelveticaOblique
  cou!: PDFFont;  // Courier (code)
  y = MT;         // current baseline — mm from top of page
  pn = 0;         // page number

  constructor(doc: PDFDocument) { this.doc = doc; }

  async fonts() {
    this.reg = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bld = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.obl = await this.doc.embedFont(StandardFonts.HelveticaOblique);
    this.cou = await this.doc.embedFont(StandardFonts.Courier);
  }

  // Convert y-mm-from-top → y-pts-from-bottom (pdf-lib coords)
  Y(yMm: number): number { return PH - yMm * PT; }

  // ── New content page (with header + footer) ──
  addPage() {
    this.pg = this.doc.addPage([PW, PH]);
    this.pn++;
    // Header: navy bar + gold stripe
    this.pg.drawRectangle({ x: 0, y: PH - 7 * PT, width: PW, height: 7 * PT, color: C.PRI });
    this.pg.drawRectangle({ x: 0, y: PH - 7.8 * PT, width: PW, height: 0.8 * PT, color: C.ACC });
    // Footer: navy bar + gold stripe + page number
    this.pg.drawRectangle({ x: 0, y: 0, width: PW, height: 7 * PT, color: C.PRI });
    this.pg.drawRectangle({ x: 0, y: 7 * PT, width: PW, height: 0.8 * PT, color: C.ACC });
    const pnStr = `${this.pn}`;
    const pnW = this.reg.widthOfTextAtSize(pnStr, FS.FOOTER);
    this.pg.drawText(pnStr, { x: (PW - pnW) / 2, y: 2.5 * PT, size: FS.FOOTER, font: this.reg, color: C.WHITE });
    this.y = MT;
  }

  // Ensure `neededMm` fits on current page
  check(neededMm: number) { if (this.y + neededMm > MAX_Y) this.addPage(); }

  // ── Cover page ──
  cover(title: string, description?: string) {
    const pg = this.doc.addPage([PW, PH]);
    this.pn++;
    // Navy background
    pg.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.PRI });
    // Left gold stripe
    pg.drawRectangle({ x: 0, y: 0, width: 3 * PT, height: PH, color: C.ACC });
    // Horizontal gold rule at ~72% height
    pg.drawRectangle({ x: 0, y: PH * 0.72, width: PW, height: 1.2 * PT, color: C.ACC });
    // "EduGenAI" label above rule
    pg.drawText("EduGenAI", {
      x: ML_PT, y: PH * 0.72 + 5 * PT,
      size: FS.COVER_LABEL, font: this.bld, color: C.ACC,
    });
    // Course title (wrapped, bold white)
    const titleLines = wrapText(safeText(title), this.bld, FS.COVER_TITLE, PW - 55 * PT);
    let ty = PH * 0.65;
    for (const line of titleLines) {
      pg.drawText(line, { x: ML_PT, y: ty, size: FS.COVER_TITLE, font: this.bld, color: C.WHITE });
      ty -= FS.COVER_TITLE * 1.35;
    }
    // Description (optional, grey)
    if (description) {
      const descLines = wrapText(safeText(description), this.reg, FS.COVER_SUB, PW - 55 * PT);
      let dy = ty - 8 * PT;
      for (const line of descLines.slice(0, 4)) {
        pg.drawText(line, { x: ML_PT, y: dy, size: FS.COVER_SUB, font: this.reg, color: rgb(0.75, 0.77, 0.83) });
        dy -= FS.COVER_SUB * 1.45;
      }
    }
    // Bottom gold bar
    pg.drawRectangle({ x: 0, y: 0, width: PW, height: 8 * PT, color: C.ACC });
    const yr = new Date().getFullYear().toString();
    const yrW = this.reg.widthOfTextAtSize(yr, FS.SMALL);
    pg.drawText(yr, { x: PW - ML_PT - yrW, y: 2.5 * PT, size: FS.SMALL, font: this.reg, color: C.PRI });
  }

  // ── Module banner page ──
  moduleBanner(title: string, num: number) {
    const pg = this.doc.addPage([PW, PH]);
    this.pn++;
    const bannerH = 52 * PT;
    // Navy banner (top 52mm)
    pg.drawRectangle({ x: 0, y: PH - bannerH, width: PW, height: bannerH, color: C.PRI });
    // Gold rule at bottom of banner
    pg.drawRectangle({ x: 0, y: PH - bannerH, width: PW, height: 1.5 * PT, color: C.ACC });
    // "MÓDULO" label + number
    const label = safeText("MÓDULO");
    pg.drawText(label, { x: ML_PT, y: PH - 19 * PT, size: FS.MOD_LABEL, font: this.bld, color: C.ACC });
    const labelW = this.bld.widthOfTextAtSize(label, FS.MOD_LABEL);
    pg.drawText(String(num).padStart(2, "0"), {
      x: ML_PT + labelW + 3 * PT, y: PH - 19 * PT,
      size: FS.MOD_NUM, font: this.bld, color: C.WHITE,
    });
    // Module title
    const titleLines = wrapText(safeText(title), this.bld, FS.MOD_TITLE, PW - 50 * PT);
    let ty = PH - 29 * PT;
    for (const line of titleLines) {
      pg.drawText(line, { x: ML_PT, y: ty, size: FS.MOD_TITLE, font: this.bld, color: C.WHITE });
      ty -= FS.MOD_TITLE * 1.3;
    }
    // Footer
    pg.drawRectangle({ x: 0, y: 0, width: PW, height: 7 * PT, color: C.PRI });
    pg.drawRectangle({ x: 0, y: 7 * PT, width: PW, height: 0.8 * PT, color: C.ACC });
    const pnStr = `${this.pn}`;
    const pnW = this.reg.widthOfTextAtSize(pnStr, FS.FOOTER);
    pg.drawText(pnStr, { x: (PW - pnW) / 2, y: 2.5 * PT, size: FS.FOOTER, font: this.reg, color: C.WHITE });
  }

  // ── Paragraph (JUSTIFIED using exact font metrics) ──
  para(text: string) {
    const clean = cleanLine(text);
    if (!clean) return;
    const lines = wrapText(clean, this.reg, FS.BODY);
    if (!lines.length) return;
    this.check(lines.length * SP.LINE + SP.A_PARA);
    for (let i = 0; i < lines.length; i++) {
      const words = lines[i].split(/\s+/).filter(Boolean);
      const isLast = i === lines.length - 1;
      // Justify every line except the last (standard behavior)
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
    const size  = level === 2 ? FS.H2 : level === 3 ? FS.H3 : FS.H4;
    const bef   = level === 2 ? SP.B_H2 : level === 3 ? SP.B_H3 : SP.B_H4;
    const aft   = level === 2 ? SP.A_H2 : level === 3 ? SP.A_H3 : SP.A_H4;
    const lhMm  = size * 0.38; // line advancement in mm (consistent with v1)
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
        start: { x: ML_PT,      y: this.Y(this.y) },
        end:   { x: ML_PT + CW, y: this.Y(this.y) },
        thickness: 0.8, color: C.ACC,
      });
      this.y += 2;
    }
    this.y += aft;
  }

  // ── Bullet ──
  bullet(text: string) {
    const clean = cleanLine(bulletBody(text));
    if (!clean) return;
    const textX = ML_PT + 4.5 * PT;
    const maxW  = CW - 4.5 * PT;
    const lines = wrapText(clean, this.reg, FS.BODY, maxW);
    this.check(lines.length * SP.LINE + 2);
    // Gold accent dot
    this.pg.drawCircle({ x: ML_PT + 1.8 * PT, y: this.Y(this.y) + FS.BODY * 0.25, size: 1.5, color: C.ACC });
    for (let i = 0; i < lines.length; i++) {
      this.pg.drawText(lines[i], { x: textX, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY });
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
    const maxW   = CW - numW - 2 * PT;
    const lines  = wrapText(clean, this.reg, FS.BODY, maxW);
    this.check(lines.length * SP.LINE + 2);
    this.pg.drawText(numStr, { x: ML_PT, y: this.Y(this.y), size: FS.BODY, font: this.bld, color: C.ACC });
    for (let i = 0; i < lines.length; i++) {
      this.pg.drawText(lines[i], { x: textX, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY });
      this.y += SP.LINE;
    }
    this.y += 2;
  }

  // ── Code block ──
  code(codeLines: string[]) {
    if (!codeLines.length) return;
    const pad  = SP.CODE_PAD;
    const blockH = codeLines.length * SP.CODE_LINE + pad * 2;
    this.check(blockH + SP.A_CODE);
    // Background rect
    const rectY = this.Y(this.y + blockH);
    this.pg.drawRectangle({ x: ML_PT, y: rectY, width: CW, height: blockH * PT, color: C.CODE_BG });
    // Gold left accent
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

  // ── Horizontal rule ──
  rule() {
    this.check(SP.B_RULE + 1 + SP.A_RULE);
    this.y += SP.B_RULE;
    this.pg.drawLine({
      start: { x: ML_PT,      y: this.Y(this.y) },
      end:   { x: ML_PT + CW, y: this.Y(this.y) },
      thickness: 0.5, color: C.RULE,
    });
    this.y += 1 + SP.A_RULE;
  }

  // ── Module content (markdown → PDF elements) ──
  content(markdown: string) {
    const lines = markdown.split("\n");
    let i = 0;
    let listN = 0; // numbered list counter

    while (i < lines.length) {
      const raw = lines[i];
      const t = raw.trim();

      // Empty
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

      // Heading — cascade orphan guard
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
            const s2 = lv2 === 2 ? FS.H2 : lv2 === 3 ? FS.H3 : FS.H4;
            const b2 = lv2 === 2 ? SP.B_H2 : lv2 === 3 ? SP.B_H3 : SP.B_H4;
            const a2 = lv2 === 2 ? SP.A_H2 : lv2 === 3 ? SP.A_H3 : SP.A_H4;
            cascade += b2 + s2 * 0.38 + a2;
            k++;
          } else { cascade += MIN_KEEP; break; }
        }
        if (cascade === 0) cascade = MIN_KEEP;
        this.heading(t, lv === 1 ? 2 : lv, cascade);
        i++;
        continue;
      }

      // Numbered list
      if (/^\d+[.)]\s/.test(t)) {
        listN++;
        this.numbered(t, listN);
        i++;
        continue;
      }

      // Bullet
      if (isBullet(t)) {
        listN = 0;
        this.bullet(t);
        i++;
        continue;
      }

      // Blockquote → treat as paragraph with italic
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

      // Regular paragraph
      listN = 0;
      this.para(t);
      i++;
    }
  }
}

// ─── Supabase handler ─────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl  = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader   = req.headers.get("authorization") ?? "";

    const userClient    = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Auth
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userId = user.id;

    const body = await req.json();
    const courseId = body.course_id ?? body.courseId;
    if (!courseId) return new Response(JSON.stringify({ error: "course_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Fetch course + modules
    const { data: course, error: courseErr } = await serviceClient
      .from("courses").select("*").eq("id", courseId).eq("user_id", userId).single();
    if (courseErr || !course) return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: modulesRaw } = await serviceClient
      .from("course_modules").select("*").eq("course_id", courseId).order("order_index");
    const modules: any[] = modulesRaw ?? [];

    // ── Build PDF ──
    const doc = await PDFDocument.create();
    const r = new R(doc);
    await r.fonts();

    r.cover(course.title, course.description ?? undefined);

    let modNum = 0;
    for (const mod of modules) {
      const mdContent = cleanModuleContent(mod.content ?? "", mod.title);
      if (!mdContent && !mod.title) continue;
      modNum++;
      r.moduleBanner(mod.title, modNum);
      r.addPage();
      if (mdContent) r.content(mdContent);
    }

    const pdfBytes = await doc.save();

    // Upload to storage + signed URL
    const dateStr   = new Date().toISOString().slice(0, 10);
    const safeName  = (course.title || "curso").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().slice(0, 80);
    const fileName  = `${userId}/${safeName} - PDF-v2 - ${dateStr}.pdf`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports").upload(fileName, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: signed, error: signErr } = await serviceClient.storage
      .from("course-exports").createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: userId, event_type: "COURSE_EXPORTED_PDF_V2", metadata: { course_id: courseId },
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
