import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { promptDaAcao, promptPersonalizado } from "./actions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Helper for hashing
async function hashInput(input: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
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
    
    // User client for auth check
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    // Service client for cache access
    const serviceClient = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { text, action = "improve", language = "pt-BR", instruction, mode } =
      await req.json();

    // O modo diz se a resposta SUBSTITUI o trecho ou é ANEXADA depois dele, e
    // isso muda o que a IA precisa devolver: no anexo, só o pedaço novo; na
    // substituição, o texto inteiro reescrito. A mesma ação "example" serve aos
    // dois — o submenu oferece "Adicionar ao módulo" e "Substituir existente" —
    // então sem esta informação o servidor não tem como acertar os dois.
    const modo: "append" | "replace" = mode === "append" ? "append" : "replace";

    if (!text || text.trim().length < 5) {
      return new Response(JSON.stringify({ error: "Text too short" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Instrução escrita pelo autor, para a ação "custom". Normalizada e limitada
    // a 400 caracteres: acima disso ela começa a competir com as travas de
    // formato em vez de dizer o que fazer com o texto.
    const customInstruction = typeof instruction === "string"
      ? instruction.replace(/\s+/g, " ").trim().slice(0, 400)
      : "";

    if (action === "custom" && customInstruction.length < 3) {
      return new Response(JSON.stringify({ error: "Instrução personalizada vazia" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CACHE CHECK ──
    // A instrução entra na chave: sem isso, duas instruções diferentes sobre o
    // mesmo texto devolveriam o mesmo resultado.
    //
    // O "v2" invalida tudo o que foi gravado antes da correção do max_tokens.
    // Aquelas respostas nasceram sob um teto de 800 tokens e podem estar
    // cortadas no meio de uma frase — e um acerto de cache devolve o texto
    // guardado sem passar pela verificação de finish_reason, então a trava nova
    // não as pegaria nunca. Sem esta linha, quem editou um trecho grande antes
    // da correção receberia o mesmo texto truncado para sempre, e o redeploy
    // pareceria não ter feito nada.
    // O "v3" invalida o que foi gravado enquanto seis das dez ações recebiam
    // calada a instrução de "melhorar o texto". Aquelas respostas estão sob a
    // chave da ação certa mas com o conteúdo da ação errada — quem pediu
    // "Encurtar" antes desta correção receberia para sempre o texto melhorado.
    const CACHE_VERSION = "v3";
    // O modo entra na chave: "example" anexando devolve só o exemplo novo,
    // "example" substituindo devolve o texto inteiro. Duas respostas
    // diferentes para a mesma ação e o mesmo texto.
    const cacheKey = await hashInput(
      `enhance:${CACHE_VERSION}:${action}:${modo}:${language}:${text}${customInstruction ? `:${customInstruction}` : ""}`,
    );
    const { data: cached } = await serviceClient
      .from("ai_cache")
      .select("response_text")
      .eq("input_hash", cacheKey)
      .maybeSingle();

    if (cached) {
      console.log(`[Cache Hit] enhance-paragraph: ${action}`);
      return new Response(JSON.stringify({ enhanced: cached.response_text, cached: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY não configurada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    const model = "gemini-3-flash-preview"; 

    // As instruções de cada ação moram em actions.ts, junto com a lista
    // canônica — ver o cabeçalho de lá para o defeito que motivou a separação.
    const systemPrompt = action === "custom"
      ? promptPersonalizado(customInstruction)
      : promptDaAcao(action, modo);

    // Ação que o servidor não conhece não pode ser servida como se fosse outra:
    // era assim que "Encurtar" virava "Melhorar" sem ninguém notar.
    if (!systemPrompt) {
      console.error(`[enhance-paragraph] ação desconhecida: ${action}`);
      return new Response(
        JSON.stringify({ error: `Ação não suportada: ${action}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    // O teto de saída precisa caber o texto reescrito INTEIRO — e este modelo
    // raciocina antes de responder, com os tokens de pensamento saindo deste
    // mesmo orçamento. Com o valor fixo de 800 que havia aqui, editar uma seção
    // de curso de verdade devolvia duas linhas e meia: o resto do raciocínio
    // consumia a cota e o texto era cortado no meio de uma frase. Pior, isso
    // chegava ao autor como um resultado pronto para aceitar.
    //
    // A conta: ~4 caracteres por token em português, o dobro para caber
    // expansão, mais uma folga fixa para o raciocínio.
    const tokensEntrada = Math.ceil(text.length / 4);
    const maxTokens = Math.min(8000, Math.max(1500, tokensEntrada * 2 + 1200));

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${geminiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: `${systemPrompt} Idioma: ${language}.` },
          { role: "user", content: text },
        ],
        stream: false,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", status, errText);
      return new Response(JSON.stringify({ error: "AI processing failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json();
    const choice = result.choices?.[0];
    const enhanced = (choice?.message?.content ?? "").trim();

    // Resposta cortada por limite de tokens NÃO é resultado — é meia edição.
    // Aplicá-la apaga o resto da seção, e no diff ela parece completa porque o
    // autor não tem como saber onde o texto deveria terminar. Devolvemos o
    // aviso para que a interface se recuse a aplicar, e não gravamos em cache:
    // senão o mesmo texto truncado voltaria para sempre.
    const truncated = choice?.finish_reason === "length";
    if (truncated) {
      console.warn(
        `[enhance-paragraph] resposta truncada: action=${action} entrada=${text.length} max_tokens=${maxTokens}`,
      );
      return new Response(
        JSON.stringify({
          error: "A IA não conseguiu terminar a edição deste trecho",
          truncated: true,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resposta vazia NÃO é resultado. Antes daqui saía `content || text`: com o
    // corpo vazio, o próprio texto do autor voltava com status 200, a interface
    // abria o diff sem diferença nenhuma e o autor via a ação "não fazer nada".
    // Este modelo raciocina antes de responder, e há casos em que o raciocínio
    // termina sem produzir texto — silenciar isso como se fosse uma edição é o
    // pior desfecho possível, porque não dá nem para saber que houve falha.
    if (!enhanced) {
      console.error(
        `[enhance-paragraph] resposta vazia: action=${action} modo=${modo} finish=${choice?.finish_reason}`,
      );
      return new Response(
        JSON.stringify({ error: "A IA não retornou texto. Tente novamente." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Edição que devolve o texto igual ao que entrou também não é resultado —
    // é a ação não tendo efeito. Dizer isso é melhor que abrir um diff vazio e
    // deixar o autor achando que o botão está quebrado. Só vale para quem
    // SUBSTITUI: no anexo, o retorno é um trecho novo e nunca igual à entrada.
    if (modo === "replace" && enhanced === text.trim()) {
      console.warn(`[enhance-paragraph] sem efeito: action=${action} entrada=${text.length}`);
      return new Response(
        JSON.stringify({
          error: "A IA devolveu o texto sem alterações",
          semEfeito: true,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── SAVE TO CACHE ──
    if (enhanced && enhanced !== text) {
      await serviceClient.from("ai_cache").insert({
        input_hash: cacheKey,
        model,
        action_type: action,
        prompt_preview: text.substring(0, 100),
        response_text: enhanced,
      });
    }

    return new Response(JSON.stringify({ enhanced }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("enhance-paragraph error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
