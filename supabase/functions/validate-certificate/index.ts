import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: "Token required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Fetch certificate by token
    const { data: cert, error } = await serviceClient
      .from("certificates")
      .select("id, student_name, issued_at, template, custom_data, course_id")
      .eq("token", token)
      .single();

    if (error || !cert) {
      return new Response(JSON.stringify({ error: "Certificate not found", valid: false }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch course info (only if published)
    const { data: course } = await serviceClient
      .from("courses")
      .select("title, status, language")
      .eq("id", cert.course_id)
      .single();

    if (!course || course.status !== "published") {
      return new Response(JSON.stringify({ error: "Certificate not available (course not published)", valid: false }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        valid: true,
        certificate: {
          student_name: cert.student_name,
          course_title: course.title,
          issued_at: cert.issued_at,
          template: cert.template,
          custom_data: cert.custom_data,
          language: course.language,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Validate certificate error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
