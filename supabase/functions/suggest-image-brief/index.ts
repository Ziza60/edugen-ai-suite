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

    // O modelo é o MESMO que a enhance-paragraph usa neste endpoint, e que está
    // comprovadamente funcionando em produção. A primeira versão daqui pediu
    // "gemini-3-flash-lite", e o comentário no upload-course-source avisa que o
    // endpoint nativo do Google recusa certos ids — nome de modelo é coisa para
    // copiar de um caminho que se sabe que funciona, não para escolher no chute.
    const MODELO = "gemini-3-flash-preview";

    // Este modelo RACIOCINA antes de responder, e os tokens de pensamento saem
    // deste mesmo orçamento. Foi assim que a enhance-paragraph, com teto de 800,
    // devolvia duas linhas e meia. A descrição em si tem ~150 tokens; o resto é
    // folga para o raciocínio.
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${geminiKey}` },
        body: JSON.stringify({
          model: MODELO,
          messages: [{
            role: "user",
            content: promptDeSugestao({
              escopo: scope === "cover" ? "cover" : "module",
              titulo,
              cursoTitulo: typeof course_title === "string" ? course_title.slice(0, 200) : null,
            }),
          }],
          stream: false,
          max_tokens: 3000,
        }),
      },
    );

    if (!res.ok) {
      // O erro do gateway VOLTA para a tela. A primeira versão respondia só
      // "Não foi possível sugerir agora", e com isso não havia como saber se o
      // problema era nome de modelo, chave, cota ou rede — exatamente o beco em
      // que a generate-module-image já esteve antes de passar a devolver
      // `detail`. Mensagem genérica não é proteção, é diagnóstico jogado fora.
      const texto = await res.text();
      console.error("[suggest-image-brief] gateway", res.status, texto);
      let detalhe = "";
      try { detalhe = JSON.parse(texto)?.error?.message ?? texto.slice(0, 200); }
      catch { detalhe = texto.slice(0, 200); }
      return new Response(
        JSON.stringify({
          error: "Não foi possível sugerir agora. Tente de novo.",
          detail: detalhe,
          status: res.status,
          model: MODELO,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = await res.json();
    const escolha = json.choices?.[0];
    const brief = limparSugestao(escolha?.message?.content ?? "");

    // Sugestão vazia não pode voltar como sucesso: o campo ficaria em branco e
    // o botão pareceria não fazer nada — o mesmo defeito que o enhance-paragraph
    // tinha ao devolver o próprio texto do autor.
    if (!brief) {
      const motivo = escolha?.finish_reason ?? "desconhecido";
      console.error(`[suggest-image-brief] resposta vazia: finish=${motivo}`);
      return new Response(
        JSON.stringify({
          // "length" aqui significa que o raciocínio consumiu o orçamento antes
          // de sobrar texto. Dizer isso poupa o autor de tentar dez vezes.
          error: motivo === "length"
            ? "A IA não terminou a descrição. Tente de novo."
            : "A IA não retornou uma descrição. Tente de novo.",
          detail: `finish_reason=${motivo}`,
          model: MODELO,
        }),
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
