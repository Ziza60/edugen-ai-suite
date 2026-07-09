import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ENGINE_VERSION = "1.0.0-PRESENTON";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Presenton template mapping ────────────────────────────────────────
// Available standard templates: neo-general, neo-modern, neo-standard, neo-swift, general, modern, standard, swift
// Available themes: edge-yellow, light-rose, mint-blue, professional-blue, professional-dark
const TEMPLATE_MAP: Record<string, { template: string; theme: string }> = {
  "modern":    { template: "neo-modern",   theme: "professional-dark" },
  "band":      { template: "neo-standard", theme: "professional-blue" },
  "minimal":   { template: "neo-swift",    theme: "mint-blue" },
  "tech":      { template: "neo-general",  theme: "professional-dark" },
  "executive": { template: "modern",       theme: "professional-blue" },
};
const DEFAULT_PRESENTON = { template: "neo-modern", theme: "professional-dark" };

// ── Content helpers ──────────────────────────────────────────────────
function truncate(text: string, max: number): string {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max - 3) + "...";
}

function extractBullets(text: string, max: number, maxLen: number): string[] {
  const listItems = [...text.matchAll(/^[-*•]\s+(.+)$/mg)].map((m) => m[1].trim());
  if (listItems.length >= 2) {
    return listItems.slice(0, max).map((s) => truncate(s, maxLen));
  }
  const sentences = text
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 20 && s.length < 300);
  return sentences.slice(0, max).map((s) => truncate(s, maxLen));
}

function extractSubSections(
  content: string,
  maxSections = 4,
  maxBulletsPerSection = 4,
  maxBulletLen = 160,
): { title: string; bullets: string[] }[] {
  const headingRe = /^#{2,4}\s+(.+)$/m;
  const blocks = content.split(/^#{2,4}\s+/m).filter(Boolean);

  if (blocks.length >= 2) {
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

  const paragraphs = content
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 30);

  if (paragraphs.length === 0) return [];

  const N = Math.min(maxSections, Math.max(2, Math.ceil(paragraphs.length / 2)));
  const chunkSize = Math.ceil(paragraphs.length / N);
  const sections: { title: string; bullets: string[] }[] = [];

  for (let i = 0; i < N; i++) {
    const chunk = paragraphs.slice(i * chunkSize, (i + 1) * chunkSize);
    if (chunk.length === 0) continue;
    const firstPara = chunk[0];
    const firstSentence = firstPara.split(/(?<=[.!?])\s+/)[0];
    const title = truncate(firstSentence.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1"), 60);
    const bullets = extractBullets(chunk.join(" "), maxBulletsPerSection, maxBulletLen);
    sections.push({ title, bullets });
  }

  return sections;
}

/**
 * Builds a structured content string for Presenton's generate API.
 * Presenton uses the content + instructions to generate slides with its own AI.
 */
function buildContent(
  courseTitle: string,
  courseDescription: string,
  modules: { title: string; content: string }[],
  courseType: string,
  density: string,
): string {
  const maxSubSections = density === "compact" ? 2 : density === "detailed" ? 4 : 3;
  const maxBullets     = density === "compact" ? 3 : density === "detailed" ? 5 : 4;
  const maxBulletLen   = 160;

  const lines: string[] = [];

  lines.push(`# ${courseTitle}`);
  lines.push(`Tipo: ${courseType}`);
  if (courseDescription) {
    lines.push(truncate(courseDescription.replace(/\s+/g, " ").trim(), 300));
  }
  lines.push("");

  lines.push("## Índice");
  modules.forEach((m, i) => lines.push(`${i + 1}. ${m.title}`));
  lines.push("");

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
      lines.push(`- Conceitos essenciais de ${m.title}`);
      lines.push("");
    }
  }

  lines.push("## Conclusão e Próximos Passos");
  lines.push(`Parabéns por concluir ${courseTitle}!`);
  lines.push("- Aplique o conhecimento adquirido em projetos reais");
  lines.push("- Continue sua jornada de aprendizado");
  lines.push("");

  return truncate(lines.join("\n"), 12000);
}

// ── Main handler ──────────────────────────────────────────────────────
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

    const presentonKey = Deno.env.get("PRESENTON_API_KEY");
    if (!presentonKey) {
      return new Response(
        JSON.stringify({ success: false, error: "PRESENTON_NOT_CONFIGURED", detail: "PRESENTON_API_KEY não configurado." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl   = Deno.env.get("SUPABASE_URL")!;
    const serviceKey    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceKey);

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
    const {
      course_id,
      template      = "modern",
      density       = "standard",
      courseType    = "CURSO COMPLETO",
      includeImages = true,
    } = body;

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

    const presentonConfig = TEMPLATE_MAP[template] || DEFAULT_PRESENTON;
    const content = buildContent(
      course.title || "Curso",
      course.description || "",
      (modules as any[]).map((m) => ({ title: m.title || "", content: m.content || "" })),
      courseType,
      density,
    );

    const nSlides = density === "compact"
      ? Math.max(5, (modules as any[]).length * 4 + 3)
      : density === "detailed"
      ? Math.max(10, (modules as any[]).length * 7 + 3)
      : Math.max(8, (modules as any[]).length * 5 + 3);

    console.log(
      `[PRESENTON] Starting: "${course.title}" | template=${presentonConfig.template} | theme=${presentonConfig.theme} | density=${density} | nSlides=${nSlides} | contentLen=${content.length}`,
    );

    const t0 = Date.now();

    // ── Call Presenton generate API (sync) ──────────────────────────
    const genRes = await fetch("https://api.presenton.ai/api/v3/presentation/generate", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${presentonKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        content,
        n_slides:               nSlides,
        instructions:           `Este é um curso educacional em português chamado "${course.title}". Tipo: ${courseType}. Gere slides em Português do Brasil com linguagem pedagógica clara e objetiva. Cada módulo deve ter slides claros e bem estruturados.`,
        tone:                   "default",
        verbosity:              "standard",
        language:               "Portuguese",
        standard_template:      presentonConfig.template,
        theme:                  presentonConfig.theme,
        include_title_slide:    true,
        include_table_of_contents: (modules as any[]).length > 3,
        image_type:             includeImages ? "stock" : undefined,
        export_as:              "pptx",
        markdown_emphasis:      true,
      }),
    });

    const genText = await genRes.text();
    let genData: any;
    try {
      genData = JSON.parse(genText);
    } catch {
      console.error("[PRESENTON] Non-JSON response:", genText.slice(0, 500));
      throw new Error(`Presenton retornou resposta inválida (HTTP ${genRes.status})`);
    }

    if (!genRes.ok) {
      console.error("[PRESENTON] API error:", JSON.stringify(genData));
      const detail = genData?.detail?.[0]?.msg || genData?.detail || genData?.message || `HTTP ${genRes.status}`;
      throw new Error(`Presenton API error: ${detail}`);
    }

    const elapsed = Date.now() - t0;
    console.log(`[PRESENTON] Generation complete in ${elapsed}ms | presentation_id=${genData.presentation_id} | credits=${genData.credits_consumed}`);

    // genData.path is the PPTX download URL
    if (!genData.path) {
      throw new Error("Presenton não retornou URL de download.");
    }

    // Resolve the download URL — path may be relative or absolute
    const downloadUrl = genData.path.startsWith("http")
      ? genData.path
      : `https://api.presenton.ai${genData.path}`;

    return new Response(
      JSON.stringify({
        url:             downloadUrl,
        edit_url:        genData.edit_path || null,
        presentation_id: genData.presentation_id,
        credits_consumed: genData.credits_consumed,
        slide_count:     nSlides,
        engine:          ENGINE_VERSION,
        elapsed_ms:      elapsed,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    const msg = err?.message || "Internal server error";
    console.error("[PRESENTON] Fatal error:", msg);
    return new Response(
      JSON.stringify({ success: false, error: "PRESENTON_ERROR", detail: msg }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
