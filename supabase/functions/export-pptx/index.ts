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

    // Table detection
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable) {
        flushBullets();
        inTable = true;
        const cells = trimmed.split("|").filter(Boolean).map((c) => stripMarkdown(c.trim()));
        tableHeaders = cells;
      } else if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        // separator row, skip
      } else {
        const cells = trimmed.split("|").filter(Boolean).map((c) => stripMarkdown(c.trim()));
        tableRows.push(cells);
      }
      continue;
    }

    if (inTable) flushTable();

    // Heading
    if (trimmed.startsWith("#")) {
      flushBullets();
      currentHeading = cleanEmoji(stripMarkdown(trimmed));
      continue;
    }

    // Bullet
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || /^\d+\.\s/.test(trimmed)) {
      const text = cleanEmoji(stripMarkdown(trimmed.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "")));
      if (text.length > 0) currentBullets.push(text);
      continue;
    }

    // Paragraph → convert to bullet
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

const MAX_CHARS = 900;
const MAX_BULLETS = 10;
const SPLIT_THRESHOLD_CHARS = 600;
const SPLIT_THRESHOLD_BULLETS = 8;

const PRIMARY = "16213E";
const TEXT_WHITE = "FFFFFF";
const TEXT_DARK = "1E1E23";
const ACCENT = "5C6BC0";
const ACCENT_LIGHT = "E8EAF6";
const TAKEAWAY_BG = "FFF8E1";
const TAKEAWAY_ACCENT = "F9A825";

// Layout constants — slide is 10"×5.63"
const HEADER_H = 0.65;
const FOOTER_Y = 5.35;
const CONTENT_TOP = 0.85;
const CONTENT_H = 4.4;
const CONTENT_LEFT = 0.5;
const CONTENT_W = 9.0;
const BULLET_LEFT = 0.65;
const BULLET_W = 8.7;

const BASE_FONT = 15;
const REDUCED_FONT = 13;
const MIN_FONT = 11;

interface SlideContent {
  title: string;
  bullets: string[];
  style?: "default" | "objectives" | "takeaways" | "table-compare";
}

/** Determine if content is dense enough to warrant two-column layout */
function isDense(bullets: string[]): boolean {
  if (bullets.length >= SPLIT_THRESHOLD_BULLETS) return true;
  const totalChars = bullets.reduce((s, b) => s + b.length, 0);
  return totalChars > SPLIT_THRESHOLD_CHARS && bullets.length >= 4;
}

/** Determine font size: reduce for dense content */
function pickFontSize(bullets: string[]): number {
  const totalChars = bullets.reduce((s, b) => s + b.length, 0);
  if (totalChars > 800 || bullets.length > 8) return MIN_FONT;
  if (totalChars > SPLIT_THRESHOLD_CHARS || bullets.length > 5) return REDUCED_FONT;
  return BASE_FONT;
}

function splitBulletsIntoSlides(heading: string, items: string[], style: SlideContent["style"] = "default"): SlideContent[] {
  const slides: SlideContent[] = [];
  let current: string[] = [];
  let charCount = 0;

  for (const item of items) {
    const wouldExceed = current.length >= MAX_BULLETS || (charCount + item.length) > MAX_CHARS;
    if (wouldExceed && current.length > 0) {
      slides.push({ title: heading, bullets: [...current], style });
      current = [];
      charCount = 0;
    }
    current.push(item);
    charCount += item.length;
  }

  if (current.length > 0) {
    slides.push({ title: heading, bullets: [...current], style });
  }

  if (slides.length > 1) {
    slides.forEach((s, i) => {
      s.title = `${heading} (${i + 1}/${slides.length})`;
    });
  }

  return slides;
}

function tableToSlides(heading: string, headers: string[], rows: string[][]): SlideContent[] {
  const items: string[] = [];
  for (const row of rows) {
    const parts = row.map((cell, j) => `${headers[j] || `Col${j + 1}`}: ${cell}`).join(" → ");
    items.push(parts);
  }
  return splitBulletsIntoSlides(heading || "Comparativo", items, "table-compare");
}

function buildModuleSlides(mod: any, index: number, total: number): SlideContent[] {
  const blocks = parseModuleContent(mod.content || "");
  const moduleTitle = cleanEmoji(stripMarkdown(mod.title));
  const slides: SlideContent[] = [];

  const objectiveBlocks = blocks.filter((b) => b.type === "objectives");
  const takeawayBlocks = blocks.filter((b) => b.type === "takeaways");
  const contentBlocks = blocks.filter((b) => b.type !== "objectives" && b.type !== "takeaways");

  const objectiveBullets = objectiveBlocks.flatMap((b) => b.items || []);
  slides.push({
    title: `Módulo ${index + 1}: ${moduleTitle}`,
    bullets: objectiveBullets.length > 0 ? objectiveBullets.slice(0, MAX_BULLETS) : ["Conteúdo detalhado a seguir"],
    style: "objectives",
  });

  for (const block of contentBlocks) {
    if (block.type === "table" && block.headers && block.rows) {
      slides.push(...tableToSlides(block.heading || moduleTitle, block.headers, block.rows));
    } else if (block.items && block.items.length > 0) {
      slides.push(...splitBulletsIntoSlides(block.heading || moduleTitle, block.items));
    }
  }

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
    x: 4, y: FOOTER_Y, w: 2, h: 0.25,
    fontSize: 8, fontFace: "Arial", color: "999999", align: "center",
  });
}

function makeBulletObjs(bullets: string[], fontSize: number, bulletColor: string) {
  return bullets.map((b) => ({
    text: b,
    options: {
      fontSize,
      fontFace: "Arial",
      color: TEXT_DARK,
      bullet: { type: "bullet" as const, color: bulletColor },
      paraSpaceAfter: fontSize > 13 ? 6 : 4,
      lineSpacing: fontSize > 13 ? 18 : 15,
    },
  }));
}

function renderBulletsArea(slide: any, bullets: string[], fontSize: number, bulletColor: string, top: number, height: number) {
  const twoCol = isDense(bullets);

  if (twoCol) {
    const mid = Math.ceil(bullets.length / 2);
    const left = bullets.slice(0, mid);
    const right = bullets.slice(mid);
    const colW = (CONTENT_W - 0.3) / 2;
    const smallFont = Math.max(MIN_FONT, fontSize - 1);

    slide.addText(makeBulletObjs(left, smallFont, bulletColor), {
      x: CONTENT_LEFT, y: top, w: colW, h: height, valign: "top",
    });
    slide.addText(makeBulletObjs(right, smallFont, bulletColor), {
      x: CONTENT_LEFT + colW + 0.3, y: top, w: colW, h: height, valign: "top",
    });
  } else {
    slide.addText(makeBulletObjs(bullets, fontSize, bulletColor), {
      x: BULLET_LEFT, y: top, w: BULLET_W, h: height, valign: "top",
    });
  }
}

function renderSlide(pptx: any, sc: SlideContent, slideNum: number, totalSlides: number) {
  const slide = pptx.addSlide();
  const fontSize = pickFontSize(sc.bullets);

  if (sc.style === "objectives") {
    addHeaderBar(slide, pptx);
    slide.addText(sc.title, {
      x: 0.4, y: 0.08, w: 9.2, h: 0.5,
      fontSize: 20, fontFace: "Arial", color: TEXT_WHITE, bold: true,
    });
    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: HEADER_H + 0.1, w: 1.2, h: 0.03, fill: { color: ACCENT } });
    slide.addText("🎯 Objetivos", {
      x: 0.5, y: HEADER_H + 0.18, w: 4, h: 0.3,
      fontSize: 13, fontFace: "Arial", color: ACCENT, bold: true,
    });
    const bTop = HEADER_H + 0.52;
    renderBulletsArea(slide, sc.bullets, fontSize, ACCENT, bTop, FOOTER_Y - bTop - 0.1);

  } else if (sc.style === "takeaways") {
    slide.background = { color: TAKEAWAY_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: TAKEAWAY_ACCENT } });
    slide.addText("📌 " + sc.title, {
      x: 0.4, y: 0.2, w: 9.2, h: 0.5,
      fontSize: 19, fontFace: "Arial", color: TEXT_DARK, bold: true,
    });
    const bTop = 0.8;
    renderBulletsArea(slide, sc.bullets, fontSize, TAKEAWAY_ACCENT, bTop, FOOTER_Y - bTop - 0.1);

  } else {
    // default + table-compare share the same layout
    addHeaderBar(slide, pptx);
    slide.addText(sc.title, {
      x: 0.4, y: 0.08, w: 9.2, h: 0.5,
      fontSize: 19, fontFace: "Arial", color: TEXT_WHITE, bold: true,
    });
    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: HEADER_H + 0.08, w: 1.2, h: 0.03, fill: { color: ACCENT } });
    const bTop = HEADER_H + 0.2;
    const bulletColor = sc.style === "table-compare" ? ACCENT : ACCENT;
    renderBulletsArea(slide, sc.bullets, fontSize, bulletColor, bTop, FOOTER_Y - bTop - 0.1);
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

    // 1) Cover slide (handled separately)
    // 2) Module slides
    for (let i = 0; i < modules.length; i++) {
      const modSlides = buildModuleSlides(modules[i], i, modules.length);
      allSlides.push(...modSlides);
    }
    // 3) Closing slide (handled separately)

    const totalSlides = allSlides.length + 2; // +cover +closing

    /* ─── Build PPTX ─── */

    const pptx = new PptxGenJS();
    pptx.author = "EduGen AI";
    pptx.title = course.title;
    pptx.subject = course.description || "";

    // Cover slide
    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: PRIMARY };
    titleSlide.addText(course.title, {
      x: 0.8, y: 1.5, w: 8.4, h: 2,
      fontSize: 36, fontFace: "Arial", color: TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });
    if (course.description) {
      titleSlide.addText(course.description, {
        x: 1.5, y: 3.8, w: 7, h: 1,
        fontSize: 16, fontFace: "Arial", color: "B0BEC5", align: "center",
      });
    }
    titleSlide.addText(`${modules.length} módulos • Gerado por EduGen AI`, {
      x: 0, y: 4.8, w: 10, h: 0.5,
      fontSize: 11, fontFace: "Arial", color: "78909C", align: "center",
    });

    // Content slides
    allSlides.forEach((sc, i) => {
      renderSlide(pptx, sc, i + 2, totalSlides);
    });

    // Closing slide
    const endSlide = pptx.addSlide();
    endSlide.background = { color: PRIMARY };
    endSlide.addText("Obrigado!", {
      x: 0, y: 1.8, w: 10, h: 1.5,
      fontSize: 40, fontFace: "Arial", color: TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });
    endSlide.addText(course.title, {
      x: 1, y: 3.5, w: 8, h: 0.6,
      fontSize: 16, fontFace: "Arial", color: "B0BEC5", align: "center",
    });

    console.log(`PPTX generated: ${allSlides.length + 2} slides for ${modules.length} modules`);

    // Generate file
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
