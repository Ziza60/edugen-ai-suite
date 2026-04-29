import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ENGINE_VERSION = "3.12.1-LANDING-PAGE-STRUCTURE";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const magicSlidesApiKey = Deno.env.get("MAGICSLIDES_API_KEY");

    if (!magicSlidesApiKey) {
      return new Response(JSON.stringify({ error: "MAGICSLIDES_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { course_id, language, template = "educational" } = body;

    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user from token to verify access
    const { data: { user }, error: userError } = await serviceClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch course and modules
    const { data: course, error: courseErr } = await serviceClient
      .from("courses")
      .select("*")
      .eq("id", course_id)
      .eq("user_id", user.id)
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

    // Combine content for MagicSlides
    // We create a structured text that MagicSlides can parse well
    const fullContent = modules.map((m: any, i: number) => {
      return `TÓPICO ${i + 1}: ${m.title}\n${m.content || ""}`;
    }).join("\n\n---\n\n");

    const promptText = `Crie uma apresentação educativa profissional sobre: ${course.title}.
    
    CONTEÚDO BASE:
    ${fullContent}
    `;

    console.log(`[MAGICSLIDES] Calling API for course: ${course.title}`);

    const response = await fetch("https://api.magicslides.app/public/api/ppt-from-text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": magicSlidesApiKey,
      },
      body: JSON.stringify({
        text: promptText,
        title: course.title,
        language: language === "English" ? "en" : "pt",
        template: template === "academic" ? "modern" : "educational",
        aiImages: true,
        imageForEachSlide: true,
        presentationFor: "estudantes",
      }),
    });

    const result = await response.json();
    console.log("[MAGICSLIDES] API Response:", JSON.stringify(result));

    if (result.success && result.url) {
      // Record usage
      await serviceClient.from("usage_events").insert({
        user_id: user.id,
        event_type: "COURSE_EXPORTED_PPTX_MAGICSLIDES",
        metadata: {
          course_id,
          engine: "magicslides",
          engine_version: ENGINE_VERSION,
          magicslides_url: result.url
        },
      });

      return new Response(
        JSON.stringify({
          url: result.url,
          success: true,
          engine: "magicslides",
          engine_version: ENGINE_VERSION,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } else {
      console.error("[MAGICSLIDES] API Failure:", result);
      return new Response(JSON.stringify({ 
        error: result.message || "MagicSlides API failed",
        details: result
      }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (error: any) {
    console.error("[MAGICSLIDES] Export error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
