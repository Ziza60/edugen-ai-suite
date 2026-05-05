import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

    const pexelsKey = Deno.env.get("PEXELS_API_KEY");
    if (!pexelsKey) {
      return new Response(JSON.stringify({ error: "PEXELS_NOT_CONFIGURED" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Autenticar usuário
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

    const url         = new URL(req.url);
    const query       = url.searchParams.get("query") || "education";
    const perPage     = Math.min(parseInt(url.searchParams.get("per_page") || "15"), 30);
    const orientation = url.searchParams.get("orientation") || "landscape";
    const page        = parseInt(url.searchParams.get("page") || "1");

    console.log(`[PEXELS] query="${query}" orientation=${orientation} per_page=${perPage} page=${page}`);

    const pexelsUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=${orientation}&page=${page}`;
    const res = await fetch(pexelsUrl, {
      headers: { Authorization: pexelsKey },
    });

    if (!res.ok) {
      console.warn(`[PEXELS] API error: ${res.status}`);
      return new Response(JSON.stringify({ error: "PEXELS_SEARCH_FAILED", status: res.status }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    // Normalizar para formato simples
    const photos = (data?.photos ?? []).map((p: any) => ({
      id:          String(p.id),
      url:         p.src?.large || p.src?.medium || p.src?.original,
      thumb:       p.src?.medium || p.src?.small,
      small:       p.src?.small,
      photographer: p.photographer || "Pexels",
      photographerUrl: p.photographer_url || "https://www.pexels.com",
      alt:         p.alt || query,
      width:       p.width,
      height:      p.height,
    }));

    console.log(`[PEXELS] Found ${photos.length} photos for "${query}"`);

    return new Response(JSON.stringify({
      photos,
      total_results: data.total_results ?? photos.length,
      page,
      per_page: perPage,
      query,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[PEXELS] Error:", err?.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
