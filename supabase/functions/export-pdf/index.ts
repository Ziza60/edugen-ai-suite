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
  // Remove emoji (Unicode ranges for common emoji blocks)
  let clean = text
    // Emoji & symbols
    .replace(/[\u{1F600}-\u{1F64F}]/gu, "")  // Emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")  // Misc symbols & pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")  // Transport & map
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")  // Flags
    .replace(/[\u{2600}-\u{26FF}]/gu, "")    // Misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, "")    // Dingbats
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")    // Variation selectors
    .replace(/[\u{200D}]/gu, "")              // Zero width joiner
    .replace(/[\u{20E3}]/gu, "")              // Combining enclosing keycap
    .replace(/[\u{E0020}-\u{E007F}]/gu, "")  // Tags
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, "")  // Supplemental symbols
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, "")  // Chess symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, "")  // Symbols extended-A
    .replace(/[\u{2300}-\u{23FF}]/gu, "")    // Misc technical (⌛ etc)
    .replace(/[\u{2B50}]/gu, "")              // Star
    .replace(/[\u{203C}\u{2049}]/gu, "")      // ‼ ⁉
    .replace(/[\u{00AD}]/gu, "")              // Soft hyphen
    .trim();

  // Replace smart quotes with regular quotes
  clean = clean
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2026]/g, "...");

  // Collapse multiple spaces left by emoji removal
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
  // Line must contain pipes
  if (!lines[startIndex]?.includes("|")) return { table: null, endIndex: startIndex };

  const parsePipeRow = (line: string): string[] =>
    line.split("|").map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length);

  const headers = parsePipeRow(lines[startIndex]);
  if (headers.length < 2) return { table: null, endIndex: startIndex };

  // Check separator line
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

// ── PDF Layout constants ──────────────────────────────────────────────

const PAGE_W = 210;
const MARGIN_LEFT = 22;
const MARGIN_RIGHT = 22;
const MARGIN_TOP = 25;
const MARGIN_BOTTOM = 25;
const CONTENT_W = PAGE_W - MARGIN_LEFT - MARGIN_RIGHT;
const MAX_Y = 297 - MARGIN_BOTTOM;

// Font sizes
const FONT = {
  TITLE: 26,
  MODULE_TITLE: 18,
  H2: 14,
  H3: 12,
  H4: 11,
  BODY: 10,
  SMALL: 9,
  TABLE_HEADER: 9,
  TABLE_BODY: 8.5,
};

// Spacing (mm)
const SPACE = {
  AFTER_TITLE: 10,
  AFTER_H2: 6,
  AFTER_H3: 5,
  AFTER_PARAGRAPH: 5,
  LINE_HEIGHT: 4.5,   // body text line height
  TABLE_ROW_PAD: 3,
  SECTION_GAP: 8,
  BEFORE_HEADING: 8,
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
    this.doc.setTextColor(160, 160, 160);
    this.doc.text(`${this.pageNum}`, PAGE_W / 2, 290, { align: "center" });
    this.doc.setTextColor(0, 0, 0);
  }

  // ── Title page ────────────────────────────────────────────────────

  renderTitlePage(title: string, description: string | null, language: string) {
    // Decorative top bar
    this.doc.setFillColor(40, 40, 90);
    this.doc.rect(0, 0, PAGE_W, 6, "F");

    // Title
    this.doc.setFontSize(FONT.TITLE);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(30, 30, 60);
    const titleLines = this.doc.splitTextToSize(sanitizeText(title), CONTENT_W - 10);
    const titleY = 70;
    this.doc.text(titleLines, PAGE_W / 2, titleY, { align: "center" });

    // Underline
    const underY = titleY + titleLines.length * 10 + 4;
    this.doc.setDrawColor(40, 40, 90);
    this.doc.setLineWidth(0.8);
    this.doc.line(PAGE_W / 2 - 30, underY, PAGE_W / 2 + 30, underY);

    // Description
    if (description) {
      this.doc.setFontSize(11);
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(80, 80, 80);
      const descLines = this.doc.splitTextToSize(sanitizeText(description), CONTENT_W - 30);
      this.doc.text(descLines, PAGE_W / 2, underY + 12, { align: "center" });
    }

    // Metadata
    this.doc.setFontSize(9);
    this.doc.setTextColor(120, 120, 120);
    this.doc.text(`Idioma: ${language}`, PAGE_W / 2, 250, { align: "center" });
    this.doc.text(new Date().toLocaleDateString("pt-BR"), PAGE_W / 2, 256, { align: "center" });

    // Bottom bar
    this.doc.setFillColor(40, 40, 90);
    this.doc.rect(0, 291, PAGE_W, 6, "F");

    this.drawFooter();
  }

  // ── Module rendering ──────────────────────────────────────────────

  renderModuleTitle(title: string) {
    this.addPage();
    this.y = MARGIN_TOP + 5;

    // Accent bar
    this.doc.setFillColor(40, 40, 90);
    this.doc.rect(MARGIN_LEFT, this.y - 2, 4, 10, "F");

    this.doc.setFontSize(FONT.MODULE_TITLE);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(30, 30, 60);
    const lines = this.doc.splitTextToSize(sanitizeText(title), CONTENT_W - 10);
    this.doc.text(lines, MARGIN_LEFT + 8, this.y + 6);
    this.y += lines.length * 8 + SPACE.AFTER_TITLE;
    this.doc.setTextColor(0, 0, 0);

    // Thin separator
    this.doc.setDrawColor(200, 200, 210);
    this.doc.setLineWidth(0.3);
    this.doc.line(MARGIN_LEFT, this.y, PAGE_W - MARGIN_RIGHT, this.y);
    this.y += 6;
  }

  renderHeading(text: string, level: number) {
    this.checkPage(14);
    this.y += SPACE.BEFORE_HEADING;

    const sizeMap: Record<number, number> = {
      2: FONT.H2,
      3: FONT.H3,
      4: FONT.H4,
      5: FONT.BODY,
      6: FONT.BODY,
    };
    const fontSize = sizeMap[level] || FONT.BODY;

    this.doc.setFontSize(fontSize);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(30, 30, 60);

    const cleanText = sanitizeText(stripMarkdown(text.replace(/^#{1,6}\s*/, "")));
    const lines = this.doc.splitTextToSize(cleanText, CONTENT_W);
    this.doc.text(lines, MARGIN_LEFT, this.y);
    this.y += lines.length * (fontSize / 2.8) + SPACE.AFTER_H2;

    // Small underline for H2
    if (level === 2) {
      this.doc.setDrawColor(200, 200, 210);
      this.doc.setLineWidth(0.2);
      this.doc.line(MARGIN_LEFT, this.y - 2, MARGIN_LEFT + 50, this.y - 2);
      this.y += 2;
    }

    this.doc.setTextColor(0, 0, 0);
  }

  renderParagraph(text: string) {
    const cleanText = sanitizeText(stripMarkdown(text));
    if (!cleanText) return;

    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(40, 40, 40);

    const lines = this.doc.splitTextToSize(cleanText, CONTENT_W);
    this.checkPage(lines.length * SPACE.LINE_HEIGHT + 2);
    this.doc.text(lines, MARGIN_LEFT, this.y);
    this.y += lines.length * SPACE.LINE_HEIGHT + SPACE.AFTER_PARAGRAPH;
  }

  renderBullet(text: string, indent = 0) {
    const cleanText = sanitizeText(stripMarkdown(text.replace(/^[-*]\s*/, "")));
    if (!cleanText) return;

    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(40, 40, 40);

    const indentMm = indent * 4;
    const bulletX = MARGIN_LEFT + 2 + indentMm;
    const textX = MARGIN_LEFT + 7 + indentMm;
    const availW = CONTENT_W - 7 - indentMm;

    const lines = this.doc.splitTextToSize(cleanText, availW);
    this.checkPage(lines.length * SPACE.LINE_HEIGHT + 2);

    // Bullet dot
    this.doc.setFillColor(40, 40, 90);
    this.doc.circle(bulletX, this.y - 1, 0.7, "F");

    this.doc.text(lines, textX, this.y);
    this.y += lines.length * SPACE.LINE_HEIGHT + 2;
  }

  renderBlockquote(text: string) {
    const cleanText = sanitizeText(stripMarkdown(text.replace(/^>\s*/, "")));
    if (!cleanText) return;

    this.doc.setFontSize(FONT.SMALL);
    this.doc.setFont("helvetica", "italic");
    this.doc.setTextColor(60, 60, 80);

    const lines = this.doc.splitTextToSize(cleanText, CONTENT_W - 12);
    this.checkPage(lines.length * 4 + 6);

    // Background
    const blockH = lines.length * 4 + 4;
    this.doc.setFillColor(240, 240, 248);
    this.doc.roundedRect(MARGIN_LEFT, this.y - 4, CONTENT_W, blockH, 2, 2, "F");

    // Left accent bar
    this.doc.setFillColor(70, 70, 140);
    this.doc.rect(MARGIN_LEFT, this.y - 4, 2, blockH, "F");

    this.doc.text(lines, MARGIN_LEFT + 8, this.y);
    this.y += blockH + 4;
    this.doc.setTextColor(0, 0, 0);
  }

  renderHorizontalRule() {
    this.checkPage(8);
    this.y += 3;
    this.doc.setDrawColor(210, 210, 215);
    this.doc.setLineWidth(0.3);
    this.doc.line(MARGIN_LEFT + 20, this.y, PAGE_W - MARGIN_RIGHT - 20, this.y);
    this.y += SPACE.SECTION_GAP;
  }

  // ── Table rendering ───────────────────────────────────────────────

  renderTable(table: ParsedTable) {
    const { headers, rows } = table;
    const numCols = headers.length;

    // Calculate column widths proportionally
    // First column gets slightly more width for "Aspecto" style columns
    const colWidths: number[] = [];
    const firstColRatio = numCols <= 3 ? 0.30 : 0.25;
    const remainingWidth = CONTENT_W - (CONTENT_W * firstColRatio);
    colWidths.push(CONTENT_W * firstColRatio);
    for (let i = 1; i < numCols; i++) {
      colWidths.push(remainingWidth / (numCols - 1));
    }

    // Measure total table height to check if it fits
    const headerH = 8;
    const estimatedRowH = 10;
    const totalEstH = headerH + rows.length * estimatedRowH + 4;

    // If table is too tall, check if we need a new page
    this.checkPage(Math.min(totalEstH, 60));
    this.y += 2;

    const startX = MARGIN_LEFT;
    const tableWidth = CONTENT_W;
    let currentY = this.y;

    // ── Header ──
    this.doc.setFillColor(40, 40, 90);
    this.doc.rect(startX, currentY, tableWidth, headerH, "F");

    this.doc.setFontSize(FONT.TABLE_HEADER);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(255, 255, 255);

    let colX = startX;
    for (let c = 0; c < numCols; c++) {
      const cellText = sanitizeText(stripMarkdown(headers[c] || ""));
      const lines = this.doc.splitTextToSize(cellText, colWidths[c] - 4);
      this.doc.text(lines[0] || "", colX + 3, currentY + 5.5);
      colX += colWidths[c];
    }

    currentY += headerH;

    // ── Rows ──
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];

      // Calculate row height based on content
      this.doc.setFontSize(FONT.TABLE_BODY);
      this.doc.setFont("helvetica", "normal");
      let maxLines = 1;
      const cellLines: string[][] = [];

      for (let c = 0; c < numCols; c++) {
        const cellText = sanitizeText(stripMarkdown(row[c] || ""));
        const lines = this.doc.splitTextToSize(cellText, colWidths[c] - 6);
        // Limit to 3 lines per cell for readability
        const trimmedLines = lines.slice(0, 3);
        cellLines.push(trimmedLines);
        if (trimmedLines.length > maxLines) maxLines = trimmedLines.length;
      }

      const rowH = Math.max(7, maxLines * 3.8 + SPACE.TABLE_ROW_PAD * 2);

      // Check page break
      if (currentY + rowH > MAX_Y) {
        this.addPage();
        currentY = this.y;

        // Repeat header on new page
        this.doc.setFillColor(40, 40, 90);
        this.doc.rect(startX, currentY, tableWidth, headerH, "F");
        this.doc.setFontSize(FONT.TABLE_HEADER);
        this.doc.setFont("helvetica", "bold");
        this.doc.setTextColor(255, 255, 255);
        let hx = startX;
        for (let c = 0; c < numCols; c++) {
          const cellText = sanitizeText(stripMarkdown(headers[c] || ""));
          this.doc.text(cellText, hx + 3, currentY + 5.5);
          hx += colWidths[c];
        }
        currentY += headerH;
      }

      // Row background (zebra striping)
      if (r % 2 === 0) {
        this.doc.setFillColor(248, 248, 252);
      } else {
        this.doc.setFillColor(255, 255, 255);
      }
      this.doc.rect(startX, currentY, tableWidth, rowH, "F");

      // First column highlight
      this.doc.setFillColor(235, 235, 245);
      this.doc.rect(startX, currentY, colWidths[0], rowH, "F");

      // Cell text
      colX = startX;
      for (let c = 0; c < numCols; c++) {
        if (c === 0) {
          this.doc.setFont("helvetica", "bold");
          this.doc.setTextColor(30, 30, 60);
        } else {
          this.doc.setFont("helvetica", "normal");
          this.doc.setTextColor(50, 50, 50);
        }
        this.doc.setFontSize(FONT.TABLE_BODY);

        const lines = cellLines[c] || [""];
        for (let l = 0; l < lines.length; l++) {
          this.doc.text(lines[l], colX + 3, currentY + SPACE.TABLE_ROW_PAD + 2.5 + l * 3.8);
        }
        colX += colWidths[c];
      }

      // Row border
      this.doc.setDrawColor(220, 220, 230);
      this.doc.setLineWidth(0.15);
      this.doc.line(startX, currentY + rowH, startX + tableWidth, currentY + rowH);

      currentY += rowH;
    }

    // Table outer border
    const totalH = currentY - this.y;
    this.doc.setDrawColor(180, 180, 200);
    this.doc.setLineWidth(0.3);
    this.doc.rect(startX, this.y, tableWidth, totalH);

    // Column separators
    colX = startX;
    for (let c = 0; c < numCols - 1; c++) {
      colX += colWidths[c];
      this.doc.setDrawColor(210, 210, 220);
      this.doc.setLineWidth(0.15);
      this.doc.line(colX, this.y, colX, this.y + totalH);
    }

    this.y = currentY + SPACE.SECTION_GAP;
  }

  // ── Module content processor ──────────────────────────────────────

  renderModuleContent(content: string) {
    const lines = content.split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip empty lines (add small spacing)
      if (!trimmed) {
        this.y += 2;
        i++;
        continue;
      }

      // Table detection
      if (trimmed.includes("|") && i + 1 < lines.length && lines[i + 1]?.includes("|")) {
        const { table, endIndex } = parseMarkdownTable(lines, i);
        if (table) {
          this.renderTable(table);
          i = endIndex + 1;
          continue;
        }
      }

      // Headings
      const heading = getHeadingLevel(trimmed);
      if (heading > 0) {
        if (heading === 1) {
          this.renderHeading(trimmed, 2); // Treat H1 in content as H2
        } else {
          this.renderHeading(trimmed, heading);
        }
        i++;
        continue;
      }

      // Blockquote
      if (trimmed.startsWith("> ")) {
        // Collect multi-line blockquote
        let quoteText = trimmed.replace(/^>\s*/, "");
        while (i + 1 < lines.length && lines[i + 1]?.trim().startsWith("> ")) {
          i++;
          quoteText += " " + lines[i].trim().replace(/^>\s*/, "");
        }
        this.renderBlockquote(quoteText);
        i++;
        continue;
      }

      // Bullet list
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        this.renderBullet(trimmed);
        i++;
        continue;
      }

      // Numbered list
      if (/^\d+\.\s/.test(trimmed)) {
        const itemText = trimmed.replace(/^\d+\.\s*/, "");
        this.renderBullet("- " + itemText);
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
