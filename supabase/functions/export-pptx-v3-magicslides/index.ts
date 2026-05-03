import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ENGINE_VERSION = "3.13.0-MAGICSLIDES-EMAIL";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// --- Semantic compression for MagicSlides (keeps content concise) ---
const _COMPRESS_PATTERNS: Array<[RegExp, string]> = [
  [/\bagora você (já )?(sabe|entende|aprendeu|viu) que\b/gi, "você sabe que"],
  [/\bé importante (notar|destacar|ressaltar|lembrar|frisar) que\b/gi, "note que"],
  [/\bvale (a pena )?(notar|destacar|ressaltar|lembrar|mencionar) que\b/gi, "note que"],
  [/\bcomo (você )?pode (ver|perceber|notar|observar)\b/gi, "veja que"],
  [/\bem outras palavras,?\s*/gi, ""],
  [/\bbasicamente,?\s*/gi, ""],
  [/\bessencialmente,?\s*/gi, ""],
  [/\bna verdade,?\s*/gi, ""],
  [/\bde (uma )?(forma|maneira) (geral|simples|simplificada|resumida)\b,?/gi, "em resumo"],
  [/\bde (uma )?(forma|maneira) (mais )?(prática|objetiva|direta)\b,?/gi, ""],
  [/\bcom (o )?(intuito|objetivo|propósito) de\b/gi, "para"],
  [/\bdevido ao (fato de )?que\b/gi, "porque"],
  [/\s{2,}/g, " "],
  [/\s+([,.;:!?])/g, "$1"],
];

function compressText(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [re, sub] of _COMPRESS_PATTERNS) {
    out = out.replace(re, sub);
  }
  // Remove isolated emojis
  out = out.replace(/(^|\s)([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])(\s|$)/gu, "$1$3");
  // Truncate overly long sentences
  out = out.split(/(?<=[.!?])\s+/)
    .map(s => s.length > 180 ? s.slice(0, 177).trim() + "..." : s)
    .join(" ");
  return out.replace(/\s{2,}/g, " ").trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Support two auth methods:
    // 1. API Key (new, recommended): MAGICSLIDES_API_KEY
    // 2. Email + AccessId (legacy, no credit card needed): MAGICSLIDES_EMAIL + MAGICSLIDES_ACCESS_ID
    const magicApiKey    = Deno.env.get("MAGICSLIDES_API_KEY");
    const magicEmail     = Deno.env.get("MAGICSLIDES_EMAIL");
    const magicAccessId  = Deno.env.get("MAGICSLIDES_ACCESS_ID");

    const hasApiKey     = !!magicApiKey;
    const hasEmailAuth  = !!(magicEmail && magicAccessId);

    if (!hasApiKey && !hasEmailAuth) {
      return new Response(JSON.stringify({
        error: "MAGICSLIDES_NOT_CONFIGURED",
        detail: "Configure MAGICSLIDES_API_KEY ou (MAGICSLIDES_EMAIL + MAGICSLIDES_ACCESS_ID) nos secrets da função.",
      }), { status: 400, headers: corsHeaders });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { course_id, language, template = "educational", slideCount = 12 } = body;

    const { data: { user }, error: userError } = await serviceClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) throw new Error("Unauthorized");

    const { data: course } = await serviceClient
      .from("courses").select("*").eq("id", course_id).single();
    if (!course) throw new Error("Course not found");

    const { data: modules = [] } = await serviceClient
      .from("course_modules").select("*").eq("course_id", course_id).order("order_index");

    // Build structured content
    const fullContent = (modules as any[]).map((m: any, i: number) => {
      const compressed = compressText(m.content || "");
      return `MÓDULO ${i + 1}: ${m.title}\n${compressed}`;
    }).join("\n\n---\n\n");

    const summaryText = `${course.title}\n\n${fullContent}`;
    const msLanguage = (language || "").includes("English") ? "en" : "pt";
    const msTemplate = template === "academic" ? "modern" : "educational";

    console.log(`[MAGICSLIDES] Starting export for: "${course.title}" | auth=${hasApiKey ? "apiKey" : "email+accessId"} | lang=${msLanguage}`);

    let result: any;

    if (hasApiKey) {
      // ── Method 1: API Key (unified endpoint) ──────────────────────
      const res = await fetch("https://api.magicslides.app/public/api/ppt-from-text", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": magicApiKey! },
        body: JSON.stringify({
          topic: summaryText,
          language: msLanguage,
          template: msTemplate,
          slideCount,
          aiImages: false,
          imageForEachSlide: false,
          model: "gemini",
          presentationFor: "educational audience",
        }),
      });
      result = await res.json();
      console.log("[MAGICSLIDES][apiKey] Response:", JSON.stringify(result).slice(0, 300));

    } else {
      // ── Method 2: Email + AccessId (legacy endpoint) ───────────────
      const res = await fetch("https://api.magicslides.app/public/api/ppt_from_summery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msSummaryText: summaryText,
          email: magicEmail,
          accessId: magicAccessId,
          template: "bullet-point1",
          language: msLanguage,
          slideCount,
          aiImages: false,
          imageForEachSlide: false,
          googleImage: false,
          googleText: false,
          model: "gemini",
          presentationFor: "educational audience",
        }),
      });
      result = await res.json();
      console.log("[MAGICSLIDES][email+accessId] Response:", JSON.stringify(result).slice(0, 300));
    }

    // Extract URL from response (field may vary)
    const downloadUrl = result?.url || result?.pptUrl || result?.downloadUrl || result?.fileUrl;
    if (downloadUrl) {
      console.log("[MAGICSLIDES] Success! URL:", downloadUrl.slice(0, 80) + "...");
      return new Response(JSON.stringify({
        url: downloadUrl,
        success: true,
        engine_version: ENGINE_VERSION,
        pptId: result?.pptId,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const errMsg = result?.message || result?.error || result?.msg || JSON.stringify(result);
    throw new Error(`MagicSlides API error: ${errMsg}`);

  } catch (error: any) {
    console.error("[MAGICSLIDES] Export error:", error?.message || error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
