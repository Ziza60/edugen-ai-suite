import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { text, action = "improve", language = "pt-BR", instruction } = await req.json();

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
    // mesmo texto devolveriam o mesmo resultado. Fica no fim para que as ações
    // fixas continuem gerando exatamente a chave de antes — o cache delas não
    // é invalidado por esta mudança.
    const cacheKey = await hashInput(
      `enhance:${action}:${language}:${text}${customInstruction ? `:${customInstruction}` : ""}`,
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

    const systemPrompts: Record<string, string> = {
      improve: `Você é um editor pedagógico especialista. Melhore o texto fornecido mantendo o mesmo significado mas tornando-o mais claro, conciso e profissional. Mantenha o formato markdown. Responda APENAS com o texto melhorado, sem explicações.`,
      simplify: `Você é um editor pedagógico. Simplifique o texto fornecido para que seja compreensível por iniciantes. Use linguagem simples e direta. Mantenha o formato markdown. Responda APENAS com o texto simplificado.`,
      expand: `Você é um editor pedagógico. Expanda o texto fornecido com mais detalhes, exemplos e explicações. Mantenha o formato markdown. Responda APENAS com o texto expandido.`,
      fix: `Você é um editor. Corrija erros gramaticais, ortográficos e de formatação no texto. Mantenha o formato markdown. Responda APENAS com o texto corrigido.`,
    };

    // As travas que valem para TODA edição, inclusive a personalizada: sem elas
    // o modelo responde com explicação em volta do texto, ou devolve prosa onde
    // havia markdown — e o resultado entra direto no editor do autor.
    const TRAVAS =
      "Mantenha o formato markdown do original, incluindo listas, tabelas e citações. " +
      "Responda APENAS com o texto editado, sem preâmbulo, sem comentários e sem cercas de código.";

    const systemPrompt = action === "custom"
      ? `Você é um editor pedagógico especialista. Aplique ao texto fornecido a seguinte instrução do autor:\n\n"${customInstruction}"\n\n${TRAVAS}`
      : (systemPrompts[action] || systemPrompts.improve);

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
        max_tokens: 800,
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
    const enhanced = result.choices?.[0]?.message?.content || text;

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
