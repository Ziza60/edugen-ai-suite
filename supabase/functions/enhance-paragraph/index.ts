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

    const { text, action = "improve", language = "pt-BR" } = await req.json();

    if (!text || text.trim().length < 5) {
      return new Response(JSON.stringify({ error: "Text too short" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CACHE CHECK ──
    const cacheKey = await hashInput(`enhance:${action}:${language}:${text}`);
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
    const model = "gemini-2.5-flash"; 

    const systemPrompts: Record<string, string> = {
      improve:   `Você é um editor pedagógico especialista. Melhore o texto fornecido mantendo o mesmo significado mas tornando-o mais claro, conciso e profissional. Mantenha o formato markdown. Responda APENAS com o texto melhorado, sem explicações.`,
      simplify:  `Você é um editor pedagógico. Simplifique o texto fornecido para que seja compreensível por iniciantes. Use linguagem simples e direta. Mantenha o formato markdown. Responda APENAS com o texto simplificado.`,
      expand:    `Você é um editor pedagógico. Expanda o texto fornecido com mais detalhes, exemplos e explicações. Mantenha o formato markdown. Responda APENAS com o texto expandido.`,
      fix:       `Você é um editor. Corrija erros gramaticais, ortográficos e de formatação no texto. Mantenha o formato markdown. Responda APENAS com o texto corrigido.`,
      shorten:   `Você é um editor pedagógico. Reduza o texto fornecido para a metade, preservando os pontos mais importantes. Seja direto e elimine redundâncias. Mantenha o formato markdown. Responda APENAS com o texto encurtado.`,
      deepen:    `Você é um especialista pedagógico. Aprofunde o texto com conceitos técnicos, nuances, referências ou frameworks relevantes para quem já tem conhecimento básico. Mantenha o formato markdown. Responda APENAS com o texto aprofundado.`,
      example:   `Você é um educador. Gere um exemplo prático, concreto e detalhado que ilustre bem o conceito descrito no texto. Pode ser um caso real, analogia ou cenário. Formate como markdown com título "## Exemplo Prático". Responda APENAS com o exemplo.`,
      practical: `Você é um designer instrucional. Transforme o conteúdo fornecido em uma aula prática com: objetivo claro, atividade hands-on passo a passo, dicas de execução e critérios de sucesso. Formate com seções markdown. Responda APENAS com a aula prática.`,
      activity:  `Você é um designer instrucional. Crie uma atividade de aprendizagem baseada no conteúdo: descreva o objetivo, as instruções passo a passo, os materiais necessários e como avaliar o resultado. Formate com seções markdown. Responda APENAS com a atividade.`,
    };

    const systemPrompt = systemPrompts[action] || systemPrompts.improve;

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
