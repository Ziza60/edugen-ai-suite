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
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      throw new Error("GEMINI_API_KEY não configurada.");
    }

    const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    const model = "gemini-2.0-flash"; 

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { course_id, module_id, duration_minutes, style } = await req.json();
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch course
    const { data: course, error: courseErr } = await userClient
      .from("courses")
      .select("title, description, language, target_audience, tone")
      .eq("id", course_id)
      .single();
    if (courseErr || !course) throw new Error("Course not found");

    // Fetch modules
    let modulesQuery = userClient
      .from("course_modules")
      .select("title, content, order_index")
      .eq("course_id", course_id)
      .order("order_index");
    
    if (module_id) {
      modulesQuery = modulesQuery.eq("id", module_id);
    }

    const { data: modules, error: modErr } = await modulesQuery;
    if (modErr || !modules?.length) throw new Error("No modules found");

    const durationHint = duration_minutes
      ? `O script deve ter duração estimada de ${duration_minutes} minutos de narração.`
      : "O script deve ter duração estimada de 5-10 minutos por módulo.";

    const styleHint = style === "formal"
      ? "Use tom formal e acadêmico."
      : style === "casual"
      ? "Use tom conversacional e acessível, como se estivesse falando com um amigo."
      : "Use tom profissional mas acessível.";

    const modulesText = modules.map((m) =>
      `## ${m.title}\n\n${m.content || "(sem conteúdo)"}`
    ).join("\n\n---\n\n");

    const systemPrompt = `Você é um roteirista profissional de vídeo-aulas e apresentações educacionais.
Gere scripts de narração de alta qualidade, prontos para serem lidos em voz alta ou gravados com text-to-speech.

Regras de formatação:
- Use [PAUSA] para indicar pausas de 1-2 segundos
- Use [PAUSA LONGA] para transições entre seções (3-4 segundos)
- Use **negrito** para palavras/frases que devem ser enfatizadas na narração
- Use [SLIDE: descrição] para indicar mudanças de slide
- Comece com uma introdução de ~30 segundos que prenda a atenção
- Termine com um call-to-action claro e motivador
- Cada módulo deve ter transições naturais
- Inclua perguntas retóricas para engajamento
- Mantenha frases curtas e diretas (máx 20 palavras por sentença para leitura fluida)

Idioma do script: ${course.language || "pt-BR"}
${course.target_audience ? `Público-alvo: ${course.target_audience}` : ""}
${course.tone ? `Tom original do curso: ${course.tone}` : ""}
${styleHint}
${durationHint}`;

    const userPrompt = `Gere o script de narração completo para o curso "${course.title}".
${course.description ? `Descrição: ${course.description}` : ""}

Conteúdo dos módulos:

${modulesText}`;

    const aiResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${geminiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      throw new Error("AI generation failed");
    }

    const aiData = await aiResponse.json();
    const script = aiData.choices?.[0]?.message?.content || "";

    if (!script) throw new Error("Empty AI response");

    return new Response(
      JSON.stringify({ script, course_title: course.title, modules_count: modules.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Generate script error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
