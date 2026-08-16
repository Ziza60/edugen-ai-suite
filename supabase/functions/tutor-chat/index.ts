import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sanitizeTutorAnswer,
  normalizeTutorCitation,
} from "../_shared/tutor-sanitize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── RAG-lite ──────────────────────────────────────────────────────────────────
// Split each module's content into thematic chunks (by heading or horizontal
// rule), rank them by overlap with the question's terms, and keep only the top
// chunks. Each chunk carries a citation label so the client can point back to
// the exact module/section used.
function buildTutorSnippets(
  modules: Array<{
    title: string;
    content: string | null;
    order_index: number;
  }>,
  question: string,
) {
  const terms = (question.toLowerCase().match(/[\p{L}0-9]{4,}/gu) || []).slice(
    0,
    12,
  );
  const snippets = modules.flatMap((m) => {
    const chunks = (m.content || "")
      .split(/\n(?=#{2,4}\s)|\n---\n/g)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 80);
    return chunks.map((chunk, index) => {
      const lower = chunk.toLowerCase();
      const score = terms.reduce(
        (sum, term) => sum + (lower.includes(term) ? 1 : 0),
        0,
      );
      return {
        citation: `Módulo ${m.order_index + 1}: ${m.title} — trecho ${index + 1}`,
        score,
        text: chunk.slice(0, 1800),
      };
    });
  });
  return snippets
    .sort((a, b) => b.score - a.score || a.citation.localeCompare(b.citation))
    .slice(0, 8);
}

// ── Hash helper ───────────────────────────────────────────────────────────────
async function hashInput(input: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Main handler ──────────────────────────────────────────────────────────────
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

    // Fetch all module content (needed for both cache-hit citations and fresh answers)
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

    // Build RAG-lite snippets (also used for citations in cache-hit path)
    const retrievedSnippets = buildTutorSnippets(modules, question);
    const cleanCitations = retrievedSnippets.map((s) =>
      normalizeTutorCitation(s.citation)
    );

    // ── CACHE CHECK ──
    const cacheKey = await hashInput(`tutor-v2:${course.id}:${question.trim().toLowerCase()}`);
    const { data: cached } = await supabase
      .from("ai_cache")
      .select("response_text")
      .eq("input_hash", cacheKey)
      .maybeSingle();

    if (cached) {
      console.log(`[Cache Hit] tutor-chat: ${course.title}`);
      // Sanitize cached answer defensively (covers entries saved before this fix)
      const cachedAnswer = sanitizeTutorAnswer(cached.response_text);
      return new Response(
        JSON.stringify({ answer: cachedAnswer, cached: true, citations: cleanCitations }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── BUILD PROMPT ──
    const truncatedContent = retrievedSnippets
      .map((snippet) => `<TRECHO fonte="${snippet.citation}">\n${snippet.text}\n</TRECHO>`)
      .join("\n\n---\n\n")
      .slice(0, 30000);

    const conversationMessages = history.slice(-6).map((h: { role: string; content: string }) => ({
      role: h.role,
      content: h.content,
    }));

    const systemPrompt = `Você é o Tutor IA do curso "${course.title}". Seu papel é ajudar alunos a entenderem o conteúdo do curso respondendo perguntas de forma clara, didática e amigável.

REGRAS ESTRITAS:
1. Responda EXCLUSIVAMENTE com base no conteúdo dos módulos fornecido abaixo.
2. Se a pergunta não puder ser respondida com o conteúdo disponível, diga educadamente: "Essa pergunta está fora do escopo deste curso. Posso ajudar com dúvidas sobre os temas abordados nos módulos!"
3. NUNCA invente informações que não estejam no material do curso.
4. Não copie tags XML, atributos, <TRECHO>, </TRECHO> ou fonte="..." na sua resposta. Esses são marcadores internos do sistema e são invisíveis para o aluno.
5. Não escreva a seção "Fontes usadas" manualmente. As fontes serão retornadas separadamente pelo sistema.
6. Se for útil mencionar uma fonte no corpo da resposta, use apenas linguagem natural — por exemplo: "No Módulo 2..." ou "Como apresentado no módulo sobre COSO...".
7. Use linguagem acessível e exemplos práticos quando possível.
8. Respostas em formato Markdown com parágrafos curtos.
9. LIMITE ABSOLUTO: máximo de 400 palavras por resposta. Termine SEMPRE com uma frase completa antes de atingir esse limite. NUNCA corte a resposta no meio de uma frase ou lista.
10. Se os trechos recuperados não responderem diretamente, diga que o material do curso não cobre a pergunta.

<CONTEÚDO_DO_CURSO>
${truncatedContent}
</CONTEÚDO_DO_CURSO>`;

    // ── CALL AI ──
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) throw new Error("GEMINI_API_KEY não configurada.");

    const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    const aiModel = "gemini-2.5-flash";

    const aiResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${geminiKey}`,
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationMessages,
          { role: "user", content: question },
        ],
        max_tokens: 2500,
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI API error:", errText);
      throw new Error("Erro ao consultar IA");
    }

    const aiData = await aiResponse.json();
    const rawAnswer = aiData.choices?.[0]?.message?.content || "Desculpe, não consegui gerar uma resposta.";

    // Always sanitize before storing or returning
    const answer = sanitizeTutorAnswer(rawAnswer);

    // ── SAVE TO CACHE ──
    if (answer && answer.length > 20) {
      await supabase.from("ai_cache").insert({
        input_hash: cacheKey,
        model: aiModel,
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
      JSON.stringify({
        answer,
        citations: cleanCitations,
      }),
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
