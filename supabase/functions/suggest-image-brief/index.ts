import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { limparSugestao, promptDeSugestao } from "./prompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Chamada de TEXTO, curta e barata — não consome crédito de imagem. O crédito
// existe para o que custa caro de verdade, que é gerar a imagem; cobrar por
// sugerir uma descrição faria o autor evitar justamente a etapa que melhora o
// resultado.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { scope, title, course_title } = await req.json();
    const titulo = typeof title === "string" ? title.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    if (titulo.length < 3) {
      return new Response(JSON.stringify({ error: "title is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(
        JSON.stringify({ error: "Serviço de sugestão não configurado (GEMINI_API_KEY)" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Modelo leve: a tarefa é uma tradução curta de título para objetos, não
    // exige raciocínio longo, e o autor está esperando na tela.
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${geminiKey}` },
        body: JSON.stringify({
          model: "gemini-3-flash-lite",
          messages: [{
            role: "user",
            content: promptDeSugestao({
              escopo: scope === "cover" ? "cover" : "module",
              titulo,
              cursoTitulo: typeof course_title === "string" ? course_title.slice(0, 200) : null,
            }),
          }],
          stream: false,
          max_tokens: 700,
        }),
      },
    );

    if (!res.ok) {
      console.error("[suggest-image-brief] gateway", res.status, await res.text());
      return new Response(
        JSON.stringify({ error: "Não foi possível sugerir agora. Tente de novo." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = await res.json();
    const bruto = json.choices?.[0]?.message?.content ?? "";
    const brief = limparSugestao(bruto);

    // Sugestão vazia não pode voltar como sucesso: o campo ficaria em branco e
    // o botão pareceria não fazer nada — o mesmo defeito que o enhance-paragraph
    // tinha ao devolver o próprio texto do autor.
    if (!brief) {
      console.error("[suggest-image-brief] resposta vazia", json.choices?.[0]?.finish_reason);
      return new Response(
        JSON.stringify({ error: "A IA não retornou uma descrição. Tente de novo." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ brief }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[suggest-image-brief]", err);
    return new Response(
      JSON.stringify({ error: (err as Error)?.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
