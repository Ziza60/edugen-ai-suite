import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function callAI(model: string, prompt: string) {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) throw new Error("GEMINI_API_KEY não configurada.");

  const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  let aiModel = "gemini-2.5-flash";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${geminiKey}`,
    },
    body: JSON.stringify({
      model: aiModel,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI call failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

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
    const { course_id } = await req.json();

    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify ownership
    const { data: course, error: courseErr } = await serviceClient
      .from("courses")
      .select("id, user_id, title, language")
      .eq("id", course_id)
      .single();

    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (course.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get modules
    const { data: modules } = await serviceClient
      .from("course_modules")
      .select("id, title")
      .eq("course_id", course_id);

    if (!modules || modules.length === 0) {
      return new Response(JSON.stringify({ message: "No modules found", updated: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const moduleIds = modules.map((m: any) => m.id);

    // Get all flashcards
    const { data: flashcards } = await serviceClient
      .from("course_flashcards")
      .select("*")
      .in("module_id", moduleIds);

    if (!flashcards || flashcards.length === 0) {
      return new Response(JSON.stringify({ message: "No flashcards to reprocess", updated: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build batch prompt
    const flashcardList = flashcards.map((fc: any, i: number) =>
      `${i + 1}. FRONT: ${fc.front}\n   BACK: ${fc.back}`
    ).join("\n\n");

    const prompt = `Você é um designer instrucional. Reescreva TODOS os flashcards abaixo seguindo estas regras rigorosas:

## REGRAS OBRIGATÓRIAS
1. O campo "front" DEVE ser uma PERGUNTA EXPLÍCITA com verbo e ponto de interrogação (?).
2. NUNCA use títulos nominais, glossário ou definições como "front" (ex: "Fotossíntese", "Conceito de X").
3. Transforme cada item em uma pergunta clara e direta. Exemplos:
   - ERRADO: "Fotossíntese" → CORRETO: "O que é fotossíntese e qual sua importância para as plantas?"
   - ERRADO: "Tipos de célula" → CORRETO: "Quais são os principais tipos de célula e como se diferenciam?"
4. O campo "back" deve ser uma resposta completa e objetiva.
5. Mantenha 100% da precisão técnica do conteúdo original.
6. Idioma: ${course.language || "pt-BR"}

## FLASHCARDS PARA REESCREVER
${flashcardList}

## FORMATO DE RESPOSTA
Retorne APENAS um JSON válido (sem markdown, sem explicações):
[
  {"id": "id_original", "front": "pergunta reescrita?", "back": "resposta"}
]

Use os IDs originais na resposta. Aqui estão os IDs:
${flashcards.map((fc: any, i: number) => `${i + 1}. ${fc.id}`).join("\n")}`;

    const aiResponse = await callAI("gemini-2.5-flash", prompt);

    let rewritten;
    try {
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
      rewritten = JSON.parse(jsonMatch ? jsonMatch[0] : aiResponse);
    } catch {
      throw new Error("Failed to parse AI response for flashcards");
    }

    // Update each flashcard
    let updated = 0;
    for (const item of rewritten) {
      if (item.id && item.front && item.back) {
        const { error } = await serviceClient
          .from("course_flashcards")
          .update({ front: item.front, back: item.back })
          .eq("id", item.id);
        if (!error) updated++;
      }
    }

    return new Response(
      JSON.stringify({ message: "Flashcards reprocessed", updated, total: flashcards.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Reprocess flashcards error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
