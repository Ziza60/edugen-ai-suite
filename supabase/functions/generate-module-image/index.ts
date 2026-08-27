import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { altDaImagem, montarPromptDeImagem } from "./image-prompt.ts";
import { ehPng, paraJpeg } from "../_shared/imagem-jpeg.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Monthly AI image credits per plan
const CREDITS = { free: 3, starter: 10, pro: 50 };

// A imagem chega do Gemini em PNG e é convertida antes de gravar: o jsPDF não
// sabe embutir PNG sem decodificar e recomprimir em JavaScript puro, e isso
// custa 27x mais CPU em CADA exportação. O porquê medido, as duas alternativas
// descartadas e o comportamento em caso de falha estão em _shared/imagem-jpeg.ts,
// que é o mesmo código usado pelo caminho automático de geração de curso.
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

    const { module_id, module_title, course_title, user_prompt, course_id, scope } =
      await req.json();

    // A capa do curso usa o mesmo gerador. O que muda é onde o resultado é
    // gravado: a imagem de módulo entra em course_images, indexada por módulo;
    // a capa é atributo do curso, e quem a grava é quem chamou, em
    // courses.cover_image_url. Sem essa distinção, gerar uma capa sobrescreveria
    // a imagem de algum módulo — course_images tem module_id obrigatório.
    const isCover = scope === "cover";
    if (isCover ? !course_id : !module_id) return new Response(
      JSON.stringify({
        error: isCover ? "course_id is required for scope=cover" : "module_id is required",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
    if (!module_title) return new Response(
      JSON.stringify({ error: "module_title is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

    // Descrição escrita pelo usuário. Sem ela, o único insumo era o título do
    // módulo — e o botão "Regerar" repetia o MESMO prompt, então o resultado
    // variava por acaso e não havia como corrigir o rumo. Limitada a 500
    // caracteres: o que passa disso começa a competir com as diretrizes de
    // estilo em vez de dirigir o assunto.
    const brief = typeof user_prompt === "string"
      ? user_prompt.replace(/\s+/g, " ").trim().slice(0, 500)
      : "";

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

    // ── Generate image with Gemini ───────────────────────────────────────────
    // O texto do prompt mora em image-prompt.ts. A regra de enquadramento da
    // CAPA é diferente da imagem de módulo, e é regra do sistema: só ele sabe
    // que a capa vai ser recortada numa faixa larga. Ver o cabeçalho de lá.
    const imagePrompt = montarPromptDeImagem({
      escopo: isCover ? "cover" : "module",
      moduleTitle: module_title,
      courseTitle: course_title,
      brief,
    });

    // gemini-2.5-flash-image is the stable Gemini native image generation model
    // (also known as "Nano Banana"). See:
    // https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image
    const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55000);
    const imgRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`,
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
      console.error(`[GENERATE-MODULE-IMAGE] Gemini ${imgRes.status} error:`, errText);
      // Include a short excerpt of the real Gemini error in the response so
      // it surfaces in the browser console / Supabase logs for faster diagnosis.
      let geminiDetail = "";
      try { geminiDetail = JSON.parse(errText)?.error?.message ?? errText.slice(0, 200); }
      catch { geminiDetail = errText.slice(0, 200); }
      return new Response(
        JSON.stringify({
          error: "Falha na geração de imagem. Tente novamente.",
          detail: geminiDetail,
          status: imgRes.status,
        }),
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
    const original = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

    const t0 = Date.now();
    // O `mimeType` declarado pela API deixou de decidir: `paraJpeg` olha os
    // bytes. Quando o cabeçalho e o conteúdo discordam, quem grava pelo
    // cabeçalho põe a extensão errada no arquivo, e isso só aparece na hora em
    // que o jsPDF recusa a imagem — exportações depois.
    const eraPng = ehPng(original);
    const { bytes: binaryData, ext, mime } = await paraJpeg(
      original,
      "generate-module-image",
    );
    if (ext === "jpg" && eraPng) {
      console.log(
        `[generate-module-image] PNG ${Math.round(original.length / 1024)}KB → ` +
          `JPEG ${Math.round(binaryData.length / 1024)}KB em ${Date.now() - t0}ms`,
      );
    }

    const storagePath = isCover
      ? `${user.id}/course-cover-ai-${course_id}.${ext}`
      : `${user.id}/module-ai-${module_id}.${ext}`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(storagePath, binaryData, { contentType: mime, upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: signed } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year
    if (!signed?.signedUrl) throw new Error("Falha ao gerar URL da imagem");

    // O upload usa upsert no MESMO caminho, então "Regerar" devolvia uma URL
    // idêntica à anterior e o navegador servia a imagem antiga do cache — o
    // botão parecia não fazer nada. O carimbo força a releitura.
    const imageUrl = `${signed.signedUrl}${signed.signedUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;

    // O alt_text é lido em voz alta por leitores de tela. Antes ele era
    // `Imagem IA: ${brief}` — o prompt inteiro, instruções de paleta e tudo —
    // e o export-pdf o imprimia como legenda. Agora sai só a descrição da cena.
    const altText = altDaImagem(brief, module_title);

    // ── Upsert course_images ─────────────────────────────────────────────────
    // Só para imagem de módulo. A capa volta na resposta e quem grava é o
    // cliente, em courses.cover_image_url — course_images exige module_id, e
    // gravar a capa ali tomaria o lugar da imagem de um módulo.
    if (!isCover) {
      const { error: dbErr } = await serviceClient.from("course_images").upsert(
        { module_id, url: imageUrl, alt_text: altText },
        { onConflict: "module_id" },
      );
      if (dbErr) throw dbErr;
    }

    // ── Track usage ──────────────────────────────────────────────────────────
    await serviceClient.from("usage_events").insert({
      user_id: user.id,
      event_type: "AI_IMAGE_GENERATED",
      metadata: {
        scope: isCover ? "cover" : "module",
        module_id: module_id ?? null,
        course_id: course_id ?? null,
        module_title,
        has_user_prompt: brief.length > 0,
      },
    }).then(() => {});

    return new Response(
      JSON.stringify({
        url: imageUrl,
        alt_text: altText,
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
