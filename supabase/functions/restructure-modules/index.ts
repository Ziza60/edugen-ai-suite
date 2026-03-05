import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TEMPLATE_PROMPT = `Você é um especialista em design instrucional. Reestruture o conteúdo do módulo de curso abaixo aplicando TODAS as regras a seguir. Retorne APENAS o markdown reestruturado, sem explicações.

## Regras obrigatórias:

1. **Título**: Use apenas um H2 com o título do módulo (## Módulo X: Título). Remova qualquer duplicação de títulos.

2. **Seções obrigatórias** (nesta ordem exata, todas com ###):
   - ### 🎯 Objetivo do Módulo (3 bullets concisos)
   - --- (separador)
   - ### 🧠 Fundamentos (2-3 parágrafos curtos)
   - ---
   - ### ⚙️ Como funciona (3-4 parágrafos ou lista de 5-7 itens)
   - ---
   - ### 🧩 Modelos / Tipos (tabela comparativa simples OU lista tipificada, max 5 linhas na tabela)
   - ---
   - ### 🛠️ Aplicações reais (4-5 áreas com 1 frase cada)
   - ---
   - ### 💡 Exemplo prático (DEVE ter: **Cenário:** / **Solução:** / **Resultado:** )
   - ---
   - ### ⚠️ Desafios e cuidados (lista de 5 itens máximo)
   - ---
   - > 💭 **Pare um momento e reflita:** (pergunta reflexiva relevante)
   - ---
   - ### 🧾 Resumo do Módulo (1 parágrafo conciso)
   - ---
   - ### 📌 Key Takeaways (5-7 bullets acionáveis, cada um começando com verbo)

3. **Formatação**:
   - Separadores --- entre TODAS as seções
   - Remova TODA tag HTML (<br>, <div>, etc.)
   - Listas: máximo 5-7 itens
   - Textos corridos: máximo 3-4 parágrafos curtos
   - Tabelas: formato simples com | e max 4-5 linhas de dados
   - Indentação de listas aninhadas: 2 espaços
   - Frases curtas, parágrafos de no máximo 4 linhas

4. **Conteúdo**:
   - Se uma seção está faltando, crie-a com base no conteúdo existente
   - Elimine conteúdo redundante
   - Reflexão (💭) SEMPRE após Desafios e ANTES do Resumo
   - Key Takeaways devem ser concisos e acionáveis (iniciar com verbo)
   - Exemplo prático DEVE ter cenário, solução e resultado separados

5. **Proibições**:
   - NÃO adicione markdown code blocks ao redor do resultado
   - NÃO explique o que fez
   - NÃO adicione conteúdo que não existia (apenas reorganize e complete seções)
   - NÃO use heading H1 (#) - use apenas H2 (##) para título e H3 (###) para seções`;

async function callLLM(prompt: string, content: string): Promise<string> {
  const aiGatewayUrl = Deno.env.get("SUPABASE_URL")!.replace(".supabase.co", ".functions.supabase.co");
  
  const response = await fetch(`${aiGatewayUrl}/ai/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Reestruture este módulo:\n\n${content}` },
      ],
      temperature: 0.3,
      max_tokens: 8000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM call failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  let result = data.choices?.[0]?.message?.content || "";
  
  // Strip markdown code fences if present
  result = result.replace(/^```(?:markdown)?\n?/i, "").replace(/\n?```$/i, "").trim();
  
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { course_id } = await req.json();
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Verify course ownership
    const { data: course, error: courseErr } = await serviceClient
      .from("courses").select("id, title, user_id").eq("id", course_id).eq("user_id", user.id).single();
    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch modules
    const { data: modules = [] } = await serviceClient
      .from("course_modules").select("*").eq("course_id", course_id).order("order_index");

    if (modules.length === 0) {
      return new Response(JSON.stringify({ error: "No modules found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { module_id: string; title: string; status: string; error?: string }[] = [];

    // Process modules sequentially to avoid rate limits
    for (const mod of modules) {
      try {
        console.log(`[Restructure] Processing module: ${mod.title}`);
        const restructured = await callLLM(TEMPLATE_PROMPT, mod.content || "");
        
        if (!restructured || restructured.length < 100) {
          results.push({ module_id: mod.id, title: mod.title, status: "skipped", error: "LLM returned empty/short content" });
          continue;
        }

        // Update module content
        const { error: updateErr } = await serviceClient
          .from("course_modules")
          .update({ content: restructured, updated_at: new Date().toISOString() })
          .eq("id", mod.id);

        if (updateErr) {
          results.push({ module_id: mod.id, title: mod.title, status: "error", error: updateErr.message });
        } else {
          results.push({ module_id: mod.id, title: mod.title, status: "ok" });
        }
      } catch (err: any) {
        console.error(`[Restructure] Error on module ${mod.title}:`, err);
        results.push({ module_id: mod.id, title: mod.title, status: "error", error: err.message });
      }
    }

    const successCount = results.filter(r => r.status === "ok").length;

    return new Response(JSON.stringify({
      message: `${successCount}/${modules.length} modules restructured`,
      results,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Restructure error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
