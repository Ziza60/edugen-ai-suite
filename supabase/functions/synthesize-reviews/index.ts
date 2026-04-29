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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { review_id } = await req.json();
    if (!review_id) {
      return new Response(JSON.stringify({ error: "review_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify ownership
    const { data: review, error: reviewErr } = await userClient
      .from("course_reviews")
      .select("*, courses(title)")
      .eq("id", review_id)
      .single();

    if (reviewErr || !review) {
      return new Response(JSON.stringify({ error: "Review not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch comments with module info
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: commentsRaw } = await adminClient
      .from("review_comments")
      .select("*, course_modules(title, order_index)")
      .eq("review_id", review_id)
      .eq("resolved", false)
      .order("created_at");
    const comments: any[] = commentsRaw ?? [];

    if (comments.length === 0) {
      return new Response(JSON.stringify({
        synthesis: "Nenhum comentário pendente para sintetizar.",
        suggestions: [],
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group comments by module
    const byModule: Record<string, { title: string; order: number; comments: string[] }> = {};
    for (const c of comments) {
      const modTitle = (c as any).course_modules?.title || "Módulo";
      const modOrder = (c as any).course_modules?.order_index ?? 0;
      const modId = c.module_id;
      if (!byModule[modId]) {
        byModule[modId] = { title: modTitle, order: modOrder, comments: [] };
      }
      byModule[modId].comments.push(`[${c.reviewer_name}]: ${c.comment}`);
    }

    const commentsSummary = Object.entries(byModule)
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([, mod]) => `## ${mod.title}\n${mod.comments.join("\n")}`)
      .join("\n\n");

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY não configurada nos Secrets." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    const aiModel = "gemini-1.5-flash"; 

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${geminiKey}`,
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          {
            role: "system",
            content: `Você é um assistente editorial pedagógico. Analise os comentários de revisão agrupados por módulo e produza:
1. Uma síntese executiva dos principais pontos levantados
2. Sugestões de ação específicas para cada módulo comentado

Responda em formato JSON com a estrutura:
{ "synthesis": "texto da síntese", "suggestions": [{ "module": "nome do módulo", "action": "ação sugerida", "priority": "alta|média|baixa" }] }

Responda APENAS o JSON, sem markdown code blocks.`,
          },
          {
            role: "user",
            content: `Curso: ${(review as any).courses?.title || "Sem título"}\n\nComentários de revisão:\n${commentsSummary}`,
          },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", errText);
      throw new Error(`Erro na API do Gemini (${response.status})`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      parsed = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    } catch {
      parsed = { synthesis: content, suggestions: [] };
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("synthesize-reviews error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
