import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ─── Markdown helpers ─── */

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

function cleanEmoji(text: string): string {
  return text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "").trim();
}

/* ─── Content parsing ─── */

interface ContentBlock {
  type: "heading" | "bullets" | "paragraph" | "table" | "takeaways" | "objectives";
  heading?: string;
  items?: string[];
  rows?: string[][];
  headers?: string[];
}

function parseModuleContent(content: string): ContentBlock[] {
  const lines = content.split("\n");
  const blocks: ContentBlock[] = [];
  let currentHeading = "";
  let currentBullets: string[] = [];
  let inTable = false;
  let tableHeaders: string[] = [];
  let tableRows: string[][] = [];

  const flushBullets = () => {
    if (currentBullets.length > 0) {
      const isObjectives = /objetivo|objetivo do módulo/i.test(currentHeading);
      const isTakeaway = /resumo|key takeaway|takeaway/i.test(currentHeading);
      blocks.push({
        type: isObjectives ? "objectives" : isTakeaway ? "takeaways" : "bullets",
        heading: currentHeading,
        items: [...currentBullets],
      });
      currentBullets = [];
    }
  };

  const flushTable = () => {
    if (tableRows.length > 0) {
      blocks.push({ type: "table", heading: currentHeading, headers: [...tableHeaders], rows: [...tableRows] });
      tableHeaders = [];
      tableRows = [];
    }
    inTable = false;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable) {
        flushBullets();
        inTable = true;
        const cells = trimmed.split("|").filter(Boolean).map((c) => stripMarkdown(c.trim()));
        tableHeaders = cells;
      } else if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        // separator
      } else {
        const cells = trimmed.split("|").filter(Boolean).map((c) => stripMarkdown(c.trim()));
        tableRows.push(cells);
      }
      continue;
    }

    if (inTable) flushTable();

    if (trimmed.startsWith("#")) {
      flushBullets();
      currentHeading = cleanEmoji(stripMarkdown(trimmed));
      continue;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || /^\d+\.\s/.test(trimmed)) {
      const text = cleanEmoji(stripMarkdown(trimmed.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "")));
      if (text.length > 0) currentBullets.push(text);
      continue;
    }

    const clean = cleanEmoji(stripMarkdown(trimmed));
    if (clean.length > 10) {
      currentBullets.push(clean);
    }
  }

  if (inTable) flushTable();
  flushBullets();

  return blocks;
}

/* ─── Slide generation helpers ─── */

// STRICT limits — professional presentations use 5-6 bullets max
const MAX_CHARS_PER_SLIDE = 700;
const MAX_BULLETS_PER_SLIDE = 7;

const PRIMARY = "16213E";
const TEXT_WHITE = "FFFFFF";
const TEXT_DARK = "1E1E23";
const ACCENT = "5C6BC0";
const TAKEAWAY_BG = "FFF8E1";
const TAKEAWAY_ACCENT = "F9A825";

// Layout (10" x 5.625")
const HEADER_H = 0.56;
const FOOTER_Y = 5.35;
const BODY_TOP = 0.74;       // content starts after header + accent line + small gap
const BODY_BOTTOM = 5.25;    // stop before footer
const BODY_H = BODY_BOTTOM - BODY_TOP; // ~4.51"
const BODY_X = 0.45;
const BODY_W = 9.1;
const INNER_X = 0.2;
const INNER_Y = 0.1;

interface SlideContent {
  title: string;
  bullets: string[];
  style?: "default" | "objectives" | "takeaways" | "table-compare";
}

/** Estimate how tall a set of bullets will be in inches */
function estimateHeight(bullets: string[], fontSize: number, colWidth: number): number {
  // chars per line based on column width and font size
  // At 18pt Arial, ~5.5 chars/inch; at 24pt ~4.2 chars/inch
  const charsPerInch = Math.max(3.5, 7 - (fontSize / 12));
  const cpl = Math.max(20, Math.floor(colWidth * charsPerInch));
  const lineH = (fontSize / 72) * 1.35; // line height with spacing
  const paraGap = 0.06; // gap between bullets

  let h = 0;
  for (const b of bullets) {
    const lines = Math.max(1, Math.ceil(b.length / cpl));
    h += lines * lineH + paraGap;
  }
  return h;
}

function fitsOnSlide(bullets: string[], fontSize: number, twoCols: boolean): boolean {
  const availH = BODY_H - INNER_Y * 2;
  if (twoCols) {
    const colW = (BODY_W - INNER_X * 2 - 0.3) / 2;
    const mid = Math.ceil(bullets.length / 2);
    const lh = estimateHeight(bullets.slice(0, mid), fontSize, colW);
    const rh = estimateHeight(bullets.slice(mid), fontSize, colW);
    return Math.max(lh, rh) <= availH;
  }
  const contentW = BODY_W - INNER_X * 2;
  return estimateHeight(bullets, fontSize, contentW) <= availH;
}

/** Pick best layout: try large font first, shrink, then try 2-col */
function pickLayout(bullets: string[]): { fontSize: number; twoCols: boolean } {
  const count = bullets.length;
  const totalChars = bullets.reduce((s, b) => s + b.length, 0);

  // Try single column with decreasing font sizes
  for (const fs of [22, 20, 18, 16]) {
    if (fitsOnSlide(bullets, fs, false)) return { fontSize: fs, twoCols: false };
  }

  // Try two columns (good for many short bullets)
  const useTwoCols = count >= 6 || totalChars > 400;
  if (useTwoCols) {
    for (const fs of [20, 18, 16]) {
      if (fitsOnSlide(bullets, fs, true)) return { fontSize: fs, twoCols: true };
    }
  }

  // Fallback — will use shrink fit
  return { fontSize: 16, twoCols: count >= 8 };
}

/** Split a long bullet into multiple shorter ones at sentence boundaries */
function splitLongBullet(item: string): string[] {
  const clean = item.trim();
  if (clean.length <= 200) return [clean];

  const parts = clean.split(/(?<=[\.!?])\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return [clean];

  const out: string[] = [];
  let acc = "";
  for (const p of parts) {
    if (!acc) { acc = p; continue; }
    if ((acc + " " + p).length <= 180) {
      acc += " " + p;
    } else {
      out.push(acc);
      acc = p;
    }
  }
  if (acc) out.push(acc);
  return out;
}

/** Core splitting: distribute bullets across slides respecting limits */
function splitBulletsIntoSlides(heading: string, inputItems: string[], style: SlideContent["style"] = "default"): SlideContent[] {
  const items = inputItems.flatMap(splitLongBullet).filter(Boolean);
  if (items.length === 0) return [];

  const slides: SlideContent[] = [];
  let current: string[] = [];

  for (const item of items) {
    const next = [...current, item];
    const nextChars = next.reduce((s, b) => s + b.length, 0);

    // Check hard limits AND visual fit
    if (next.length <= MAX_BULLETS_PER_SLIDE && nextChars <= MAX_CHARS_PER_SLIDE) {
      const layout = pickLayout(next);
      if (fitsOnSlide(next, layout.fontSize, layout.twoCols)) {
        current = next;
        continue;
      }
    }

    // Current batch is full — flush it
    if (current.length > 0) {
      slides.push({ title: heading, bullets: [...current], style });
      current = [item];
    } else {
      // Single item too big — push it alone
      slides.push({ title: heading, bullets: [item], style });
      current = [];
    }
  }

  if (current.length > 0) slides.push({ title: heading, bullets: [...current], style });

  // Add part numbers if split
  if (slides.length > 1) {
    slides.forEach((s, i) => { s.title = `${heading} (${i + 1}/${slides.length})`; });
  }

  return slides;
}

function tableToSlides(heading: string, headers: string[], rows: string[][]): SlideContent[] {
  const items: string[] = [];
  for (const row of rows) {
    const parts = row.map((cell, j) => `${headers[j] || `Col${j + 1}`}: ${cell}`).join("  →  ");
    items.push(parts);
  }
  return splitBulletsIntoSlides(heading || "Comparativo", items, "table-compare");
}

/**
 * CRITICAL FIX: Merge tiny content blocks so we don't get slides with 1 sentence.
 * Adjacent blocks under the same or no heading get merged before splitting.
 */
function buildModuleSlides(mod: any, index: number, total: number): SlideContent[] {
  const blocks = parseModuleContent(mod.content || "");
  const moduleTitle = cleanEmoji(stripMarkdown(mod.title));
  const slides: SlideContent[] = [];

  const objectiveBlocks = blocks.filter((b) => b.type === "objectives");
  const takeawayBlocks = blocks.filter((b) => b.type === "takeaways");
  const contentBlocks = blocks.filter((b) => b.type !== "objectives" && b.type !== "takeaways");

  // Module intro slide
  const objectiveBullets = objectiveBlocks.flatMap((b) => b.items || []);
  slides.push({
    title: `Módulo ${index + 1}: ${moduleTitle}`,
    bullets: objectiveBullets.length > 0 ? objectiveBullets : ["Conteúdo detalhado a seguir"],
    style: "objectives",
  });

  // MERGE small adjacent content blocks to avoid slides with 1 bullet
  const mergedBlocks: { heading: string; items: string[]; isTable: boolean; headers?: string[]; rows?: string[][] }[] = [];

  for (const block of contentBlocks) {
    if (block.type === "table" && block.headers && block.rows) {
      mergedBlocks.push({ heading: block.heading || moduleTitle, items: [], isTable: true, headers: block.headers, rows: block.rows });
      continue;
    }

    const blockItems = block.items || [];
    if (blockItems.length === 0) continue;

    const blockChars = blockItems.reduce((s, b) => s + b.length, 0);
    const lastMerged = mergedBlocks.length > 0 ? mergedBlocks[mergedBlocks.length - 1] : null;

    // If this block is tiny (<=2 items or <=150 chars) and previous block is also small, merge them
    if (
      lastMerged &&
      !lastMerged.isTable &&
      blockItems.length <= 2 &&
      blockChars <= 150 &&
      lastMerged.items.length <= 3 &&
      lastMerged.items.reduce((s, b) => s + b.length, 0) <= 300
    ) {
      // Add heading as a prefix bullet if different
      if (block.heading && block.heading !== lastMerged.heading) {
        lastMerged.items.push(`${block.heading}:`);
      }
      lastMerged.items.push(...blockItems);
    } else {
      mergedBlocks.push({ heading: block.heading || moduleTitle, items: [...blockItems], isTable: false });
    }
  }

  for (const mb of mergedBlocks) {
    if (mb.isTable && mb.headers && mb.rows) {
      slides.push(...tableToSlides(mb.heading, mb.headers, mb.rows));
    } else if (mb.items.length > 0) {
      slides.push(...splitBulletsIntoSlides(mb.heading, mb.items));
    }
  }

  // Takeaways
  const takeawayBullets = takeawayBlocks.flatMap((b) => b.items || []);
  if (takeawayBullets.length > 0) {
    slides.push(...splitBulletsIntoSlides("Resumo / Key Takeaways", takeawayBullets, "takeaways"));
  }

  return slides;
}

/* ─── Slide rendering ─── */

function addHeaderBar(slide: any, pptx: any) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: HEADER_H, fill: { color: PRIMARY } });
}

function addFooter(slide: any, slideNum: number, totalSlides: number) {
  slide.addText(`${slideNum} / ${totalSlides}`, {
    x: 4, y: FOOTER_Y, w: 2, h: 0.22,
    fontSize: 8, fontFace: "Arial", color: "999999", align: "center",
  });
}

function makeBulletObjs(bullets: string[], fontSize: number, bulletColor: string) {
  const lineSpacing = Math.round(fontSize * 1.3);
  const paraAfter = Math.max(3, Math.round(fontSize * 0.25));
  return bullets.map((b) => ({
    text: b,
    options: {
      fontSize,
      fontFace: "Arial",
      color: TEXT_DARK,
      bullet: { type: "bullet" as const, color: bulletColor },
      paraSpaceAfter: paraAfter,
      lineSpacing,
    },
  }));
}

function renderBulletsArea(slide: any, bullets: string[], bulletColor: string, fontSize: number, twoCols: boolean, top: number, height: number) {
  const textTop = top + INNER_Y;
  const textHeight = height - INNER_Y * 2;

  if (twoCols) {
    const mid = Math.ceil(bullets.length / 2);
    const left = bullets.slice(0, mid);
    const right = bullets.slice(mid);
    const contentW = BODY_W - INNER_X * 2;
    const colW = (contentW - 0.3) / 2;

    slide.addText(makeBulletObjs(left, fontSize, bulletColor), {
      x: BODY_X + INNER_X, y: textTop, w: colW, h: textHeight,
      valign: "top", shrinkText: true,
    });

    slide.addText(makeBulletObjs(right, fontSize, bulletColor), {
      x: BODY_X + INNER_X + colW + 0.3, y: textTop, w: colW, h: textHeight,
      valign: "top", shrinkText: true,
    });
  } else {
    slide.addText(makeBulletObjs(bullets, fontSize, bulletColor), {
      x: BODY_X + INNER_X, y: textTop, w: BODY_W - INNER_X * 2, h: textHeight,
      valign: "top", shrinkText: true,
    });
  }
}

function renderSlide(pptx: any, sc: SlideContent, slideNum: number, totalSlides: number) {
  const slide = pptx.addSlide();
  const layout = pickLayout(sc.bullets);

  const contentTop = BODY_TOP;
  const contentH = BODY_H;

  if (sc.style === "objectives") {
    addHeaderBar(slide, pptx);
    slide.addText(sc.title, {
      x: 0.4, y: 0.06, w: 9.2, h: 0.42,
      fontSize: 18, fontFace: "Arial", color: TEXT_WHITE, bold: true,
    });
    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: HEADER_H + 0.06, w: 1.2, h: 0.03, fill: { color: ACCENT } });
    slide.addText("Objetivos", {
      x: 0.5, y: HEADER_H + 0.12, w: 3.5, h: 0.22,
      fontSize: 12, fontFace: "Arial", color: ACCENT, bold: true,
    });
    renderBulletsArea(slide, sc.bullets, ACCENT, layout.fontSize, layout.twoCols, contentTop + 0.15, contentH - 0.15);

  } else if (sc.style === "takeaways") {
    slide.background = { color: TAKEAWAY_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: TAKEAWAY_ACCENT } });
    slide.addText("Resumo / Key Takeaways", {
      x: 0.4, y: 0.14, w: 9.2, h: 0.40,
      fontSize: 18, fontFace: "Arial", color: TEXT_DARK, bold: true,
    });
    renderBulletsArea(slide, sc.bullets, TAKEAWAY_ACCENT, layout.fontSize, layout.twoCols, 0.58, BODY_BOTTOM - 0.58);

  } else {
    addHeaderBar(slide, pptx);
    slide.addText(sc.title, {
      x: 0.4, y: 0.06, w: 9.2, h: 0.42,
      fontSize: 18, fontFace: "Arial", color: TEXT_WHITE, bold: true,
    });
    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: HEADER_H + 0.06, w: 1.2, h: 0.03, fill: { color: ACCENT } });
    renderBulletsArea(slide, sc.bullets, ACCENT, layout.fontSize, layout.twoCols, contentTop, contentH);
  }

  addFooter(slide, slideNum, totalSlides);
}

/* ─── Main handler ─── */

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

    // Pro-only gate
    const { data: sub } = await serviceClient.from("subscriptions").select("plan").eq("user_id", userId).single();
    const plan = sub?.plan || "free";

    if (plan !== "pro") {
      const { data: profile } = await serviceClient.from("profiles").select("is_dev").eq("user_id", userId).maybeSingle();
      if (!profile?.is_dev) {
        return new Response(
          JSON.stringify({ error: "PowerPoint export requires a Pro plan.", feature: "export_pptx" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Fetch course
    const { data: course, error: courseErr } = await serviceClient
      .from("courses").select("*").eq("id", course_id).eq("user_id", userId).single();
    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (course.status !== "published") {
      return new Response(JSON.stringify({ error: "Course must be published to export." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: modules = [] } = await serviceClient
      .from("course_modules").select("*").eq("course_id", course_id).order("order_index");

    /* ─── Build all slide content ─── */

    const allSlides: SlideContent[] = [];
    for (let i = 0; i < modules.length; i++) {
      const modSlides = buildModuleSlides(modules[i], i, modules.length);
      allSlides.push(...modSlides);
    }

    const totalSlides = allSlides.length + 2; // +cover +closing

    /* ─── Build PPTX ─── */

    const pptx = new PptxGenJS();
    pptx.author = "EduGen AI";
    pptx.title = course.title;
    pptx.subject = course.description || "";

    // ─── COVER SLIDE (fixed overlap) ───
    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: PRIMARY };
    // Title in top half — use shrinkText to avoid overflow
    titleSlide.addText(course.title, {
      x: 0.8, y: 0.8, w: 8.4, h: 2.2,
      fontSize: 34, fontFace: "Arial", color: TEXT_WHITE, bold: true,
      align: "center", valign: "middle", shrinkText: true,
    });
    if (course.description) {
      // Description safely below title area
      titleSlide.addText(course.description, {
        x: 1.2, y: 3.2, w: 7.6, h: 1.6,
        fontSize: 14, fontFace: "Arial", color: "B0BEC5", align: "center", valign: "top",
        shrinkText: true,
      });
    }
    titleSlide.addText(`${modules.length} módulos • Gerado por EduGen AI`, {
      x: 0, y: 5.0, w: 10, h: 0.4,
      fontSize: 10, fontFace: "Arial", color: "78909C", align: "center",
    });

    // Content slides
    allSlides.forEach((sc, i) => {
      renderSlide(pptx, sc, i + 2, totalSlides);
    });

    // Closing slide
    const endSlide = pptx.addSlide();
    endSlide.background = { color: PRIMARY };
    endSlide.addText("Obrigado!", {
      x: 0, y: 1.6, w: 10, h: 1.4,
      fontSize: 38, fontFace: "Arial", color: TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });
    endSlide.addText(course.title, {
      x: 1, y: 3.3, w: 8, h: 0.6,
      fontSize: 15, fontFace: "Arial", color: "B0BEC5", align: "center",
      shrinkText: true,
    });

    console.log(`PPTX generated: ${totalSlides} slides for ${modules.length} modules`);

    const pptxData = await pptx.write({ outputType: "uint8array" });
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = `${userId}/${safeName} - PPTX - ${dateStr}.pptx`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(fileName, pptxData, { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_EXPORTED_PPTX",
      metadata: { course_id, slide_count: totalSlides },
    });

    return new Response(JSON.stringify({ url: signedUrl.signedUrl }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Export PPTX error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
