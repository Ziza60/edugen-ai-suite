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
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    let url = "https://ai.gateway.lovable.dev/v1/chat/completions";
    let apiKey = lovableKey;
    let headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    // Model selection based on complexity
    const originalModel = (action === "fix" || action === "simplify") 
      ? "google/gemini-2.5-flash-lite" 
      : "google/gemini-2.5-flash";
    
    let model = originalModel;

    if (geminiKey) {
      url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
      apiKey = geminiKey;
      model = (action === "fix" || action === "simplify") ? "gemini-1.5-flash" : "gemini-1.5-flash"; 
    } else if (openaiKey) {
      url = "https://api.openai.com/v1/chat/completions";
      apiKey = openaiKey;
      model = "gpt-4o-mini";
    }

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    headers["Authorization"] = `Bearer ${apiKey}`;

    const systemPrompts: Record<string, string> = {
      improve: `Você é um editor pedagógico especialista. Melhore o texto fornecido mantendo o mesmo significado mas tornando-o mais claro, conciso e profissional. Mantenha o formato markdown. Responda APENAS com o texto melhorado, sem explicações.`,
      simplify: `Você é um editor pedagógico. Simplifique o texto fornecido para que seja compreensível por iniciantes. Use linguagem simples e direta. Mantenha o formato markdown. Responda APENAS com o texto simplificado.`,
      expand: `Você é um editor pedagógico. Expanda o texto fornecido com mais detalhes, exemplos e explicações. Mantenha o formato markdown. Responda APENAS com o texto expandido.`,
      fix: `Você é um editor. Corrija erros gramaticais, ortográficos e de formatação no texto. Mantenha o formato markdown. Responda APENAS com o texto corrigido.`,
    };

    const systemPrompt = systemPrompts[action] || systemPrompts.improve;

    const response = await fetch(url, {
      method: "POST",
      headers,
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
