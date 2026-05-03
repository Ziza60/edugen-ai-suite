import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ENGINE_VERSION = "1.2.0-2SLIDES";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Curated professional themes (IDs verified via API) ──────────────
const THEME_MAP: Record<string, string> = {
  "blue-modern":     "st-1759917935785-nx0z6ae54",  // Blue Modern Project Presentation (light)
  "blue-gradient":   "st-1763383163914-9ftifz8jv",  // Blue and White Gradient Modern (light)
  "dark-pro":        "st-1763450718138-5utx9lnia",  // Black and Gray Gradient Professional (dark)
  "training-orange": "st-1761218879337-89489751t",  // Yellow & White Modern Training (light)
  "tech-green":      "st-1757840073876-sxlvltrs3",  // Green Modern Futuristic AI (dark)
};
const DEFAULT_THEME_ID = THEME_MAP["blue-gradient"];

// ── Content helpers ──────────────────────────────────────────────────
function truncate(text: string, max: number): string {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max - 3) + "...";
}

/**
 * Extracts sub-sections from module markdown content.
 * Returns 3–5 sub-sections with title + bullets, which maps to
 * 3–5 individual slides in 2Slides (one slide per ### heading).
 */
function extractSubSections(
  content: string,
  maxSections = 4,
  maxBulletsPerSection = 4,
  maxBulletLen = 160,
): { title: string; bullets: string[] }[] {
  // Try to find existing markdown headings (## or ###)
  const headingRe = /^#{2,4}\s+(.+)$/m;
  const blocks = content.split(/^#{2,4}\s+/m).filter(Boolean);

  if (blocks.length >= 2) {
    // Content already has headings — parse them
    const sections: { title: string; bullets: string[] }[] = [];
    const parts = content.split(/(^#{2,4}\s+.+$)/m).filter(Boolean);
    let currentTitle = "";
    let currentBody = "";
    for (const part of parts) {
      if (headingRe.test(part)) {
        if (currentTitle) {
          sections.push({ title: currentTitle, bullets: extractBullets(currentBody, maxBulletsPerSection, maxBulletLen) });
        }
        currentTitle = part.replace(/^#{2,4}\s+/, "").trim();
        currentBody = "";
      } else {
        currentBody += part;
      }
    }
    if (currentTitle) {
      sections.push({ title: currentTitle, bullets: extractBullets(currentBody, maxBulletsPerSection, maxBulletLen) });
    }
    return sections.slice(0, maxSections);
  }

  // No headings — split into paragraph groups and create synthetic sections
  const paragraphs = content
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 30);

  if (paragraphs.length === 0) return [];

  // Split paragraphs evenly into N sections
  const N = Math.min(maxSections, Math.max(2, Math.ceil(paragraphs.length / 2)));
  const chunkSize = Math.ceil(paragraphs.length / N);
  const sections: { title: string; bullets: string[] }[] = [];

  for (let i = 0; i < N; i++) {
    const chunk = paragraphs.slice(i * chunkSize, (i + 1) * chunkSize);
    if (chunk.length === 0) continue;
    // Use first sentence of first paragraph as section title
    const firstPara = chunk[0];
    const firstSentence = firstPara.split(/(?<=[.!?])\s+/)[0];
    const title = truncate(firstSentence.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1"), 60);
    const bullets = extractBullets(chunk.join(" "), maxBulletsPerSection, maxBulletLen);
    sections.push({ title, bullets });
  }

  return sections;
}

function extractBullets(text: string, max: number, maxLen: number): string[] {
  // Try to find existing list items first
  const listItems = [...text.matchAll(/^[-*•]\s+(.+)$/mg)].map((m) => m[1].trim());
  if (listItems.length >= 2) {
    return listItems.slice(0, max).map((s) => truncate(s, maxLen));
  }
  // Fall back to sentences
  const sentences = text
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 20 && s.length < 300);
  return sentences.slice(0, max).map((s) => truncate(s, maxLen));
}

/**
 * Builds a structured presentation outline for 2Slides AI.
 *
 * Structure:
 *   # Course Title  →  Cover slide
 *   ## Índice        →  Table of contents slide
 *   ## Módulo N      →  Module section header
 *   ### Sub-seção    →  Individual content slide (3–4 per module)
 *   ## Conclusão     →  Closing slide
 *
 * Using ### within each ## causes 2Slides to generate 3–4 slides
 * per module instead of just 1.
 */
function buildUserInput(
  courseTitle: string,
  courseDescription: string,
  modules: { title: string; content: string }[],
  courseType = "CURSO COMPLETO",
): string {
  const lines: string[] = [];

  // ── 1. Cover ─────────────────────────────────────────────────────
  lines.push(`# ${courseTitle}`);
  lines.push(`Tipo: ${courseType}`);
  if (courseDescription) {
    lines.push(truncate(courseDescription.replace(/\s+/g, " ").trim(), 280));
  }
  lines.push("");

  // ── 2. Table of Contents ─────────────────────────────────────────
  lines.push("## Índice");
  modules.forEach((m, i) => lines.push(`${i + 1}. ${m.title}`));
  lines.push("");

  // ── 3. Module sections with sub-sections ─────────────────────────
  // Character budget: 9000 total / modules / sections to keep under limit
  const maxSubSections = modules.length <= 4 ? 4 : modules.length <= 6 ? 3 : 2;
  const maxBullets     = modules.length <= 4 ? 4 : 3;
  const maxBulletLen   = modules.length <= 5 ? 140 : 110;

  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    lines.push(`## Módulo ${i + 1}: ${m.title}`);

    const subSections = extractSubSections(m.content || "", maxSubSections, maxBullets, maxBulletLen);

    if (subSections.length > 0) {
      for (const sub of subSections) {
        lines.push(`### ${sub.title}`);
        for (const bullet of sub.bullets) {
          lines.push(`- ${bullet}`);
        }
        lines.push("");
      }
    } else {
      // Minimal fallback
      lines.push(`- Conceitos essenciais de ${m.title}`);
      lines.push("");
    }
  }

  // ── 4. Closing ───────────────────────────────────────────────────
  lines.push("## Conclusão e Próximos Passos");
  lines.push(`Parabéns por concluir ${courseTitle}!`);
  lines.push("- Aplique o conhecimento adquirido em projetos reais");
  lines.push("- Continue sua jornada de aprendizado");
  lines.push("- Certificado de conclusão disponível");
  lines.push("");

  return truncate(lines.join("\n"), 10000);
}

// ── Main handler ─────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const twoSlidesKey = Deno.env.get("TWOSLIDES_API_KEY");
    if (!twoSlidesKey) {
      return new Response(
        JSON.stringify({ error: "TWOSLIDES_NOT_CONFIGURED", detail: "TWOSLIDES_API_KEY secret não configurado." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
    const serviceKey     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient  = createClient(supabaseUrl, serviceKey);

    // Authenticate user
    const { data: { user }, error: userError } = await serviceClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { course_id, theme_key = "blue-gradient", language = "Portuguese", courseType = "CURSO COMPLETO" } = body;
    if (!course_id) {
      return new Response(
        JSON.stringify({ error: "course_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch course
    const { data: course, error: courseErr } = await serviceClient
      .from("courses")
      .select("*")
      .eq("id", course_id)
      .eq("user_id", user.id)
      .single();
    if (courseErr || !course) {
      return new Response(
        JSON.stringify({ error: "Course not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (course.status !== "published") {
      return new Response(
        JSON.stringify({ error: "Course must be published to export." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch modules
    const { data: modules = [] } = await serviceClient
      .from("course_modules")
      .select("title, content")
      .eq("course_id", course_id)
      .order("order_index");

    const themeId   = THEME_MAP[theme_key] || DEFAULT_THEME_ID;
    const userInput = buildUserInput(
      course.title || "Curso",
      course.description || "",
      (modules as any[]).map((m) => ({ title: m.title || "", content: m.content || "" })),
      courseType,
    );

    console.log(
      `[2SLIDES] Starting: "${course.title}" | theme=${theme_key}(${themeId}) | inputLen=${userInput.length} | lang=${language}`,
    );

    // ── Call 2Slides API (sync mode) ──────────────────────────────────
    const t0 = Date.now();
    const genRes = await fetch("https://2slides.com/api/v1/slides/generate", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${twoSlidesKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        userInput,
        themeId,
        responseLanguage: language,
        mode: "sync",
      }),
    });

    const genData = await genRes.json();
    console.log(`[2SLIDES] API response (${Date.now() - t0}ms):`, JSON.stringify(genData).slice(0, 300));

    if (!genRes.ok || !genData?.success) {
      const rawMsg = JSON.stringify(genData).toLowerCase();
      if (rawMsg.includes("credit") || rawMsg.includes("insufficient")) {
        return new Response(
          JSON.stringify({
            error:  "TWOSLIDES_NO_CREDITS",
            detail: "Sua conta 2Slides não tem créditos suficientes. Acesse 2slides.com/pricing para recarregar.",
          }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw new Error(`2Slides API error: ${JSON.stringify(genData)}`);
    }

    const { downloadUrl, slidePageCount, jobId } = genData.data || {};
    if (!downloadUrl) {
      throw new Error(`2Slides did not return a downloadUrl. jobId=${jobId}`);
    }

    console.log(`[2SLIDES] Success! ${slidePageCount} slides | jobId=${jobId} | downloading...`);

    // ── Download PPTX from 2Slides presigned URL ──────────────────────
    const pptxRes = await fetch(downloadUrl);
    if (!pptxRes.ok) throw new Error(`Failed to download PPTX from 2Slides: ${pptxRes.status}`);
    const pptxData = new Uint8Array(await pptxRes.arrayBuffer());
    console.log(`[2SLIDES] Downloaded ${(pptxData.byteLength / 1024).toFixed(0)} KB`);

    // ── Upload to Supabase Storage ────────────────────────────────────
    const dateStr  = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s\-]/g, "")
      .replace(/\s+/g, "-")
      .trim()
      .substring(0, 80);
    const fileName = `${user.id}/${safeName}-2Slides-${dateStr}.pptx`;

    let uploadErr: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error } = await serviceClient.storage
        .from("course-exports")
        .upload(fileName, pptxData, {
          contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          upsert: true,
        });
      if (!error) { uploadErr = null; break; }
      uploadErr = error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    // ── Usage event ───────────────────────────────────────────────────
    await serviceClient.from("usage_events").insert({
      user_id:    user.id,
      event_type: "COURSE_EXPORTED_PPTX_2SLIDES",
      metadata:   { course_id, slide_count: slidePageCount, theme_key, job_id: jobId },
    });

    console.log(`[2SLIDES] Done! Signed URL ready.`);

    return new Response(
      JSON.stringify({
        url:            signedUrl.signedUrl,
        version:        "2slides",
        engine_version: ENGINE_VERSION,
        slide_count:    slidePageCount,
        theme_key,
        job_id:         jobId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[2SLIDES] Export error:", error?.message || error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
