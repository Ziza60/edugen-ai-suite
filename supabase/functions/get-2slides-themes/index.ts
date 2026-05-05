import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const COURSE_TYPE_QUERY: Record<string, string> = {
  "CURSO COMPLETO":         "education",
  "TREINAMENTO":            "training",
  "WORKSHOP":               "creative",
  "WEBINAR":                "modern",
  "MINI-CURSO":             "education",
  "TRILHA DE APRENDIZAGEM": "professional",
  "MÓDULO":                 "education",
};
const DEFAULT_QUERY = "education";

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

    const twoSlidesKey = Deno.env.get("TWOSLIDES_API_KEY");
    if (!twoSlidesKey) {
      return new Response(JSON.stringify({ error: "TWOSLIDES_NOT_CONFIGURED" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client      = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userError } = await client.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url        = new URL(req.url);
    const courseType = url.searchParams.get("courseType") || "CURSO COMPLETO";
    const limit      = Math.min(parseInt(url.searchParams.get("limit") || "12"), 20);
    const query      = COURSE_TYPE_QUERY[courseType] ?? DEFAULT_QUERY;

    console.log(`[GET-2SLIDES-THEMES] courseType="${courseType}" → query="${query}" limit=${limit}`);

    // Normaliza qualquer formato de resposta da API 2Slides para um array
    const extractThemes = (raw: any): any[] => {
      if (Array.isArray(raw))                 return raw;
      if (Array.isArray(raw?.themes?.themes)) return raw.themes.themes;
      if (Array.isArray(raw?.themes))         return raw.themes;
      if (Array.isArray(raw?.data))           return raw.data;
      return [];
    };

    // Uma única chamada com a query mapeada; se vazia retorna [] imediatamente
    const searchUrl = `https://2slides.com/api/v1/themes/search?query=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(searchUrl, {
      headers: { "Authorization": `Bearer ${twoSlidesKey}` },
    });
    console.log(`[GET-2SLIDES-THEMES] GET ${searchUrl} → ${res.status}`);

    let themes: any[] = [];
    if (res.ok) {
      const raw = await res.json();
      console.log(`[GET-2SLIDES-THEMES] Raw:`, JSON.stringify(raw).slice(0, 500));
      themes = extractThemes(raw);
    }

    console.log(`[GET-2SLIDES-THEMES] Final: ${themes.length} themes`);

    return new Response(JSON.stringify({ themes, query, total: themes.length }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[GET-2SLIDES-THEMES] Error:", err?.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
