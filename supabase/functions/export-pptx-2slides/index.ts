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
const DEFAULT_THEME_ID = THEME_MAP["dark-pro"];

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
  const shortTitle = truncate(courseTitle, 40);
  lines.push(`# ${shortTitle}`);
  lines.push(`Tipo: ${courseType}`);
  if (courseDescription) {
    lines.push(truncate(courseDescription.replace(/\s+/g, " ").trim(), 280));
  }
  lines.push("");

  // ── 2. Table of Contents ─────────────────────────────────────────
  lines.push("## Índice do Curso");
  lines.push(`### Visão Geral — ${modules.length} Módulos`);
  modules.forEach((m, i) => lines.push(`- Módulo ${i + 1}: ${m.title}`));
  lines.push("");

  // ── 3. Module sections ─────────────────────────────────────────────
  const maxSubSections = 4;   // sempre 4, independente do nº de módulos
  const maxBullets     = 4;   // era 3
  const maxBulletLen   = 150; // era 120

  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];

    // Slide cover do módulo (1 ## = 1 slide próprio)
    lines.push(`## Módulo ${i + 1}: ${m.title}`);
    lines.push(`- Tópico central deste módulo do curso`);
    lines.push("");

    const subSections = extractSubSections(m.content || "", maxSubSections, maxBullets, maxBulletLen);

    if (subSections.length >= 2) {
      // Cada sub-seção como ## independente → 1 slide próprio
      for (const sub of subSections) {
        lines.push(`## ${sub.title}`);
        for (const bullet of sub.bullets) {
          lines.push(`- ${bullet}`);
        }
        lines.push("");
      }
    } else {
      // Fallback sintético — 3 slides por módulo garantidos
      const synth = [
        { h: `Fundamentos: ${m.title}`,      bullets: ["Conceitos e definições essenciais da área", "Contexto e importância no ambiente profissional", "Principais termos e abordagens utilizados", "Base teórica que sustenta a prática"] },
        { h: `Aplicação Prática`,             bullets: ["Metodologias e ferramentas aplicadas no dia a dia", "Exemplos reais e casos de uso da área", "Boas práticas e erros comuns a evitar", "Passo a passo para implementação"] },
        { h: `Resultados e Próximos Passos`,  bullets: ["Indicadores de sucesso e métricas de avaliação", "Como consolidar e aprofundar o aprendizado", "Conexão deste módulo com o restante do curso", "Ações imediatas para aplicar o conhecimento"] },
      ];
      for (const s of synth) {
        lines.push(`## ${s.h}`);
        for (const b of s.bullets) lines.push(`- ${b}`);
        lines.push("");
      }
    }
  }

  // ── 4. Closing ───────────────────────────────────────────────────
  lines.push(`## Parabéns por concluir ${shortTitle}!`);
  lines.push("- Aplique o conhecimento adquirido em projetos reais");
  lines.push("- Crie um plano de ação com metas claras para os próximos 90 dias");
  lines.push("- Certificado de conclusão disponível na plataforma");
  lines.push("- Compartilhe o aprendizado com sua equipe e organização");
  lines.push("");
  lines.push("## Recursos e Próximos Passos");
  lines.push("- Acesse o material de apoio e leituras complementares no portal");
  lines.push("- Participe da comunidade de alunos e tire suas dúvidas");
  lines.push("- Explore os próximos cursos da trilha de aprendizado");
  lines.push("- Continue sua jornada de desenvolvimento profissional");
  lines.push("");

  return truncate(lines.join("\n"), 14000);
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
        JSON.stringify({ success: false, error: "TWOSLIDES_NOT_CONFIGURED", detail: "TWOSLIDES_API_KEY secret não configurado." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
    // Cap at 120s so we return a clean error before the 150s edge-function limit
    const TWOSLIDES_TIMEOUT_MS = 120_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TWOSLIDES_TIMEOUT_MS);

    const t0 = Date.now();
    let genRes: Response;
    let genData: any;
    try {
      genRes = await fetch("https://2slides.com/api/v1/slides/generate", {
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
        signal: controller.signal,
      });
      genData = await genRes.json();
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      const isTimeout = fetchErr?.name === "AbortError";
      console.warn(`[2SLIDES] Fetch ${isTimeout ? "timed out" : "failed"}:`, fetchErr?.message);
      return new Response(
        JSON.stringify({
          success: false,
          error:   isTimeout ? "TWOSLIDES_TIMEOUT" : "TWOSLIDES_NETWORK_ERROR",
          detail:  isTimeout
            ? `A geração demorou mais de ${TWOSLIDES_TIMEOUT_MS / 1000}s. Tente um curso com menos módulos ou use o motor EduGen v4.`
            : fetchErr?.message,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } finally {
      clearTimeout(timeoutId);
    }

    console.log(`[2SLIDES] API response (${Date.now() - t0}ms):`, JSON.stringify(genData).slice(0, 300));

    if (!genRes.ok || !genData?.success) {
      const rawMsg = JSON.stringify(genData).toLowerCase();
      if (rawMsg.includes("credit") || rawMsg.includes("insufficient")) {
        return new Response(
          JSON.stringify({
            success: false,
            error:   "TWOSLIDES_NO_CREDITS",
            detail:  "Sua conta 2Slides não tem créditos suficientes. Acesse 2slides.com/pricing para recarregar.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          success: false,
          error:   "TWOSLIDES_API_ERROR",
          detail:  JSON.stringify(genData).slice(0, 200),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
