import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PRO_FEATURES = ["flashcards_flip", "export_pdf", "export_pptx", "export_notion", "ai_images", "custom_certificate", "export_moodle", "export_scorm"];
const BUSINESS_FEATURES: string[] = []; // reservado para uso futuro

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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;

    const { feature } = await req.json();

    if (!feature || (!PRO_FEATURES.includes(feature) && !BUSINESS_FEATURES.includes(feature))) {
      return new Response(JSON.stringify({ error: "Invalid feature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isBusinessFeature = BUSINESS_FEATURES.includes(feature);

    // Check subscription
    const { data: sub } = await serviceClient
      .from("subscriptions")
      .select("plan")
      .eq("user_id", userId)
      .single();

    const plan = sub?.plan || "free";

    const requiredPlan = isBusinessFeature ? "business" : "pro";
    const entitled = isBusinessFeature ? plan === "business" : (plan === "pro" || plan === "business");

    if (!entitled) {
      return new Response(
        JSON.stringify({ error: `This feature requires a ${requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1)} plan.`, feature, entitled: false }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ entitled: true, feature, plan }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Check entitlements error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
