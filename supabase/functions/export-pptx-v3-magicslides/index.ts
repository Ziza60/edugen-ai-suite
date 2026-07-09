import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ENGINE_VERSION = "3.12.5-AUTOFIX-PREPROCESS";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// --- AutoFix Pre-processor (Compressão semântica para evitar transbordos no MagicSlides) ---
const _AFP_REDUNDANCY_PATTERNS: Array<[RegExp, string]> = [
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
  [/\bao (longo do|decorrer do) (tempo|processo)\b/gi, "com o tempo"],
  [/\bcom (o )?(intuito|objetivo|propósito) de\b/gi, "para"],
  [/\bcom (a )?finalidade de\b/gi, "para"],
  [/\bno (sentido|contexto) de\b/gi, "para"],
  [/\bdevido ao (fato de )?que\b/gi, "porque"],
  [/\bem (função|virtude|razão) (de|do|da)\b/gi, "por"],
  [/\bpor (intermédio|meio) (de|do|da)\b/gi, "via"],
  [/\bcada (um|uma) (de|do|da|dos|das)\b/gi, "cada"],
  [/\b(uma )?(grande )?quantidade de\b/gi, "vários"],
  [/\bnão é nada (mais )?do que\b/gi, "é"],
  [/\b(é|são) (capaz|capazes) de\b/gi, "pode"],
  [/\btem a (capacidade|possibilidade) de\b/gi, "pode"],
  [/\bfaz com que\b/gi, "faz"],
  [/\bcom (relação|respeito) (a|ao|à)\b/gi, "sobre"],
  [/\bno que (diz respeito|se refere) (a|ao|à)\b/gi, "sobre"],
  [/\s{2,}/g, " "],
  [/\s+([,.;:!?])/g, "$1"],
];

function compressTextForAutoFix(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [re, sub] of _AFP_REDUNDANCY_PATTERNS) {
    out = out.replace(re, sub);
  }
  // Remove emojis isolados e marcadores duplicados
  out = out.replace(/(^|\s)([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}])(\s|$)/gu, "$1$3");
  out = out.replace(/^[\s]*[•·▪▫◦‣⁃►▶→]+\s*/g, "");
  
  // Encurtamento agressivo para MagicSlides
  out = out.split(/(?<=[.!?])\s+/)
    .map(s => s.length > 150 ? s.slice(0, 147).trim() + "..." : s)
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
    const magicSlidesApiKey = Deno.env.get("MAGICSLIDES_API_KEY");

    if (!magicSlidesApiKey) {
      return new Response(JSON.stringify({ error: "MAGICSLIDES_API_KEY_MISSING" }), { status: 400, headers: corsHeaders });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);
    const body = await req.json();
    const { course_id, language, template = "educational" } = body;

    const { data: { user }, error: userError } = await serviceClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) throw new Error("Unauthorized");

    const { data: course } = await serviceClient.from("courses").select("*").eq("id", course_id).single();
    const { data: modules = [] } = await serviceClient.from("course_modules").select("*").eq("course_id", course_id).order("order_index");

    // === APPLY AUTOFIX PIPELINE (Pre-processing for MagicSlides) ===
    console.log(`[V3-FIX] AutoFixPipeline: Pre-processing ${modules.length} modules for MagicSlides...`);
    const fullContent = modules.map((m: any, i: number) => {
      const compressedContent = compressTextForAutoFix(m.content || "");
      return `TÓPICO ${i + 1}: ${m.title}\n${compressedContent}`;
    }).join("\n\n---\n\n");

    const promptText = `Crie uma apresentação educativa profissional sobre: ${course.title}.\n\nCONTEÚDO BASE:\n${fullContent}`;

    console.log(`[MAGICSLIDES] Calling API for: ${course.title} (AutoFix Applied)`);

    const response = await fetch("https://api.magicslides.app/public/api/ppt-from-text", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": magicSlidesApiKey },
      body: JSON.stringify({
        text: promptText,
        title: course.title,
        language: language === "English" ? "en" : "pt",
        template: template === "academic" ? "modern" : "educational",
        aiImages: true,
        imageForEachSlide: true,
      }),
    });

    const result = await response.json();
    if (result.success && result.url) {
      console.log("[V3-FIX] AutoFixPipeline: Finished pre-processing for MagicSlides.");
      return new Response(JSON.stringify({ url: result.url, success: true, engine_version: ENGINE_VERSION }), { status: 200, headers: corsHeaders });
    }
    throw new Error(result.message || "MagicSlides API failed");
  } catch (error: any) {
    console.error("[MAGICSLIDES] Export error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});