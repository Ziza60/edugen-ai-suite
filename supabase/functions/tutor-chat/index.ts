import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Helper for hashing
async function hashInput(input: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { course_slug, question, session_token, history = [] } = await req.json();

    if (!course_slug || !question || !session_token) {
      return new Response(
        JSON.stringify({ error: "course_slug, question e session_token são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch course by slug
    const { data: course, error: courseErr } = await supabase
      .from("courses")
      .select("id, title, tutor_enabled, status")
      .eq("tutor_slug", course_slug)
      .eq("tutor_enabled", true)
      .eq("status", "published")
      .single();

    if (courseErr || !course) {
      return new Response(
        JSON.stringify({ error: "Tutor não encontrado ou desativado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── CACHE CHECK ──
    const cacheKey = await hashInput(`tutor:${course.id}:${question.trim().toLowerCase()}`);
    const { data: cached } = await supabase
      .from("ai_cache")
      .select("response_text")
      .eq("input_hash", cacheKey)
      .maybeSingle();

    if (cached) {
      console.log(`[Cache Hit] tutor-chat: ${course.title}`);
      return new Response(JSON.stringify({ answer: cached.response_text, cached: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all module content
    const { data: modules } = await supabase
      .from("course_modules")
      .select("title, content, order_index")
      .eq("course_id", course.id)
      .order("order_index");

    if (!modules || modules.length === 0) {
      return new Response(
        JSON.stringify({ error: "Curso sem conteúdo" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build context (RAG-lite: context stuffing)
    const courseContent = modules
      .map((m) => `## Módulo ${m.order_index + 1}: ${m.title}\n\n${m.content || ""}`)
      .join("\n\n---\n\n");

    // Truncate to ~120k chars to stay within model limits
    const truncatedContent = courseContent.slice(0, 120000);

    // Build conversation history for context
    const conversationMessages = history.slice(-6).map((h: { role: string; content: string }) => ({
      role: h.role,
      content: h.content,
    }));

    const systemPrompt = `Você é o Tutor IA do curso "${course.title}". Seu papel é ajudar alunos a entenderem o conteúdo do curso respondendo perguntas de forma clara, didática e amigável.

REGRAS ESTRITAS:
1. Responda EXCLUSIVAMENTE com base no conteúdo dos módulos fornecido abaixo.
2. Se a pergunta não puder ser respondida com o conteúdo disponível, diga educadamente: "Essa pergunta está fora do escopo deste curso. Posso ajudar com dúvidas sobre os temas abordados nos módulos!"
3. NUNCA invente informações que não estejam no material do curso.
4. Cite o módulo relevante quando possível (ex: "Como vimos no Módulo 3...").
5. Use linguagem acessível e exemplos práticos quando possível.
6. Respostas em formato Markdown com parágrafos curtos.
7. Máximo de 500 palavras por resposta.

<CONTEÚDO_DO_CURSO>
${truncatedContent}
</CONTEÚDO_DO_CURSO>`;

    // Call AI via Lovable AI Gateway
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const model = "google/gemini-2.5-flash"; // Mantemos flash para tutor pela complexidade do RAG
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationMessages,
          { role: "user", content: question },
        ],
        max_tokens: 1500, // Reduzido de 2000 para economia
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI API error:", errText);
      throw new Error("Erro ao consultar IA");
    }

    const aiData = await aiResponse.json();
    const answer = aiData.choices?.[0]?.message?.content || "Desculpe, não consegui gerar uma resposta.";

    // ── SAVE TO CACHE ──
    if (answer && answer.length > 20) {
      await supabase.from("ai_cache").insert({
        input_hash: cacheKey,
        model,
        action_type: "tutor",
        prompt_preview: question.substring(0, 100),
        response_text: answer,
      });
    }

    // Log session anonymously
    await supabase.from("tutor_sessions").insert({
      course_id: course.id,
      session_token,
      question,
      answer,
    });

    return new Response(
      JSON.stringify({ answer }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("tutor-chat error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
