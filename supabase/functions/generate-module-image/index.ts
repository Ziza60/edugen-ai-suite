import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Monthly AI image credits per plan
const CREDITS = { free: 3, starter: 10, pro: 50 };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const geminiKey   = Deno.env.get("GEMINI_API_KEY") ?? "";
    const authHeader  = req.headers.get("authorization") ?? "";

    const userClient    = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const { module_id, module_title, course_title } = await req.json();
    if (!module_id || !module_title) return new Response(
      JSON.stringify({ error: "module_id and module_title are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

    // ── Plan check ──────────────────────────────────────────────────────────
    const { data: sub } = await serviceClient
      .from("subscriptions").select("plan").eq("user_id", user.id).single();
    const plan: keyof typeof CREDITS = (sub?.plan as keyof typeof CREDITS) ?? "free";
    const monthlyLimit = CREDITS[plan] ?? CREDITS.free;

    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const { count: usedThisMonth } = await serviceClient
      .from("usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("event_type", "AI_IMAGE_GENERATED")
      .gte("created_at", monthStart.toISOString());

    const used = usedThisMonth ?? 0;
    if (used >= monthlyLimit) {
      return new Response(
        JSON.stringify({
          error: "credits_exhausted",
          used, limit: monthlyLimit, plan,
          message: `Você usou ${used}/${monthlyLimit} gerações de imagem IA este mês.${plan === "free" ? " Faça upgrade para Pro para mais créditos." : ""}`,
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!geminiKey) return new Response(
      JSON.stringify({ error: "Serviço de geração de imagem não configurado" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

    // ── Generate image with Gemini 2.5 Flash Image ──────────────────────────
    const imagePrompt = `Generate a premium, minimalist conceptual illustration for the educational module "${module_title}" (course: "${course_title ?? ""}").
Style: flat vector / soft 3D, geometric shapes, smooth matte surfaces, soft gradient colors, modern and elegant, 16:9 aspect, generous negative space.
Strict directive: purely visual — no text, no typography, no letters, no numbers, no logos, no watermarks. Any surface that would carry writing must be blank and smooth.`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50000);
    const imgRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: imagePrompt }] }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: "16:9" },
          },
        }),
        signal: controller.signal,
      },
    ).finally(() => clearTimeout(timer));

    if (!imgRes.ok) {
      const errText = await imgRes.text();
      console.error("[GENERATE-MODULE-IMAGE] Gemini error:", errText);
      return new Response(
        JSON.stringify({ error: "Falha na geração de imagem. Tente novamente." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const imgData = await imgRes.json();
    const parts = imgData.candidates?.[0]?.content?.parts ?? [];
    const imgPart = parts.find((p: any) => p.inlineData?.data);
    if (!imgPart?.inlineData?.data) {
      return new Response(
        JSON.stringify({ error: "A IA não retornou uma imagem. Tente novamente." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Upload to Storage ────────────────────────────────────────────────────
    const base64Data = imgPart.inlineData.data;
    const mimeType: string = imgPart.inlineData.mimeType || "image/png";
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
    const storagePath = `${user.id}/module-ai-${module_id}.${ext}`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(storagePath, binaryData, { contentType: `image/${ext}`, upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: signed } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year
    if (!signed?.signedUrl) throw new Error("Falha ao gerar URL da imagem");

    // ── Upsert course_images ─────────────────────────────────────────────────
    const { error: dbErr } = await serviceClient.from("course_images").upsert(
      { module_id, url: signed.signedUrl, alt_text: `Imagem IA: ${module_title}` },
      { onConflict: "module_id" },
    );
    if (dbErr) throw dbErr;

    // ── Track usage ──────────────────────────────────────────────────────────
    await serviceClient.from("usage_events").insert({
      user_id: user.id,
      event_type: "AI_IMAGE_GENERATED",
      metadata: { module_id, module_title },
    }).then(() => {});

    return new Response(
      JSON.stringify({
        url: signed.signedUrl,
        alt_text: `Imagem IA: ${module_title}`,
        used: used + 1,
        limit: monthlyLimit,
        plan,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[GENERATE-MODULE-IMAGE]", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
