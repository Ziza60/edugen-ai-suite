import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PLAN_LIMITS = {
  free: { maxCourses: 1, maxModules: 5, images: false },
  pro: { maxCourses: 5, maxModules: 10, images: true },
};

// Call Lovable AI Gateway
async function callAI(model: string, prompt: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI call failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || JSON.stringify(data);
}

// PROMPT MESTRE: Pedagogical refinement post-processing
function buildRefinementPrompt(moduleTitle: string, rawContent: string, language: string): string {
  return `Você é um designer instrucional sênior especializado em e-learning de alta qualidade.

Receba o conteúdo bruto abaixo e reescreva-o aplicando TODAS as regras a seguir. O resultado deve parecer material profissional pago.

## REGRAS DE REESCRITA

### 1. Estrutura e Hierarquia Visual
- Use ## para título do módulo (apenas 1)
- Use ### para seções principais (3-5 por módulo)
- Use #### para subseções quando necessário
- Adicione uma linha em branco entre cada bloco para respiro visual
- Parágrafos curtos: máximo 3-4 linhas cada

### 2. Marcadores Pedagógicos (OBRIGATÓRIOS)
Insira os seguintes blocos onde forem pedagogicamente relevantes:

> 🔑 **Conceito-chave:** [explicação concisa do conceito fundamental]

> 💡 **Exemplo prático:** [exemplo concreto e aplicável]

> ⚠️ **Atenção:** [erro comum, armadilha ou ponto crítico]

> 📝 **Resumo da seção:** [2-3 frases sintetizando os pontos principais]

Cada módulo DEVE conter no mínimo:
- 2 blocos "Conceito-chave"
- 2 blocos "Exemplo prático"  
- 1 bloco "Atenção"
- 1 bloco "Resumo da seção" ao final

### 3. Redução de Densidade Textual
- Elimine redundâncias e repetições
- Substitua parágrafos densos por listas com bullet points (-)
- Use **negrito** para termos-chave (máximo 3-4 por parágrafo)
- Use tabelas Markdown quando comparar 2+ itens
- Prefira frases diretas e objetivas

### 4. Formatação para Leitura em Tela
- Escaneabilidade: o leitor deve entender a estrutura só passando os olhos
- Use listas numeradas para processos/etapas sequenciais
- Use listas com bullet para itens sem ordem
- Blocos de código com \`\`\` quando aplicável
- Linha horizontal (---) para separar grandes seções

### 5. Abertura e Fechamento
- Comece com 1-2 frases que contextualizem o que será aprendido (sem "Neste módulo vamos...")
- Termine com o bloco 📝 Resumo + uma frase motivacional curta de transição

### 6. Restrições
- Mantenha 100% da correção técnica do conteúdo original
- NÃO adicione informações novas que não estejam no original
- NÃO remova conceitos ou explicações importantes
- Mantenha o idioma: ${language}
- NÃO inclua metadados, comentários sobre o processo ou notas para o editor

---

TÍTULO DO MÓDULO: ${moduleTitle}

CONTEÚDO BRUTO:
${rawContent}

---

Retorne APENAS o conteúdo reescrito em Markdown, sem explicações adicionais.`;
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

    // Validate token using getClaims
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;

    const body = await req.json();
    const {
      title,
      theme,
      target_audience,
      tone,
      language,
      num_modules,
      include_quiz,
      include_flashcards,
      include_images,
    } = body;

    // 1. Get subscription
    const { data: sub } = await serviceClient
      .from("subscriptions")
      .select("plan")
      .eq("user_id", userId)
      .single();

    const plan = (sub?.plan || "free") as "free" | "pro";
    const limits = PLAN_LIMITS[plan];

    // 1b. Check if user is a dev (unlimited generation)
    const { data: profile, error: profileError } = await serviceClient
      .from("profiles")
      .select("is_dev")
      .eq("user_id", userId)
      .maybeSingle();

    // Defensive fallback: if lookup by user_id fails, try id = auth user id
    let isDev = profile?.is_dev === true;
    if (!isDev && profileError) {
      const { data: profileById } = await serviceClient
        .from("profiles")
        .select("is_dev")
        .eq("id", userId)
        .maybeSingle();
      isDev = profileById?.is_dev === true;
    }

    // 2. Check monthly usage (skip for dev users)
    if (!isDev) {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { count: usageCount } = await serviceClient
        .from("usage_events")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("event_type", "COURSE_GENERATED")
        .gte("created_at", startOfMonth);

      if ((usageCount ?? 0) >= limits.maxCourses) {
        return new Response(
          JSON.stringify({ error: "Monthly course limit reached. Upgrade your plan." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const actualModules = Math.min(num_modules || 3, limits.maxModules);

    // 2b. Validate image gate (Pro only, dev bypasses)
    if (include_images && !limits.images && !isDev) {
      return new Response(
        JSON.stringify({ error: "AI images are available only on Pro plan." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Generate course structure with Gemini Flash-Lite
    const structurePrompt = `You are an educational course designer. Create a detailed course structure in JSON format.

Course details:
- Title: ${title}
- Theme: ${theme}
- Target audience: ${target_audience || "general"}
- Tone: ${tone || "professional"}
- Language: ${language || "pt-BR"}
- Number of modules: ${actualModules}
${include_quiz ? "- Include 3 quiz questions per module" : ""}
${include_flashcards ? "- Include 5 flashcards per module" : ""}

Return ONLY valid JSON with this structure:
{
  "description": "course description",
  "modules": [
    {
      "title": "Module title",
      "summary": "brief summary for content generation"
      ${include_quiz ? ',"quiz": [{"question": "...", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "..."}]' : ""}
      ${include_flashcards ? ',"flashcards": [{"front": "Uma pergunta explícita com verbo e ponto de interrogação. NUNCA use títulos nominais ou formato de glossário. Ex: Qual é a função do X no contexto Y?", "back": "resposta completa"}]' : ""}
    }
  ]
}`;

    const structureRaw = await callAI("google/gemini-2.5-flash-lite", structurePrompt);

    let structure;
    try {
      const jsonMatch = structureRaw.match(/\{[\s\S]*\}/);
      structure = JSON.parse(jsonMatch ? jsonMatch[0] : structureRaw);
    } catch {
      throw new Error("Failed to parse AI structure response");
    }

    // 4. Create course in DB
    const { data: course, error: courseError } = await serviceClient
      .from("courses")
      .insert({
        user_id: userId,
        title,
        description: structure.description || "",
        theme,
        target_audience: target_audience || null,
        tone: tone || null,
        language: language || "pt-BR",
        include_quiz: !!include_quiz,
        include_flashcards: !!include_flashcards,
        include_images: !!include_images,
      })
      .select()
      .single();

    if (courseError) throw courseError;

    // 5. Generate content for each module: raw → refined → save
    for (let i = 0; i < structure.modules.length; i++) {
      const mod = structure.modules[i];

      // Step A: Generate raw content with Gemini Flash
      const contentPrompt = `Write detailed educational content for this module in ${language || "pt-BR"}.

Course: ${title}
Module ${i + 1}: ${mod.title}
Summary: ${mod.summary || mod.title}
Target audience: ${target_audience || "general"}
Tone: ${tone || "professional"}

Write in Markdown format. Include:
- Clear introduction
- Main concepts with explanations
- Examples when relevant
- Key takeaways

Write 800-1200 words. Be thorough and educational.`;

      const rawContent = await callAI("google/gemini-2.5-flash", contentPrompt);

      // Step B: PROMPT MESTRE — Pedagogical refinement post-processing
      const refinementPrompt = buildRefinementPrompt(
        mod.title,
        rawContent,
        language || "pt-BR"
      );
      const refinedContent = await callAI("google/gemini-2.5-flash", refinementPrompt);

      // Step C: Save the REFINED content (never the raw version)
      const { data: moduleData, error: moduleError } = await serviceClient
        .from("course_modules")
        .insert({
          course_id: course.id,
          title: mod.title,
          content: refinedContent,
          order_index: i,
        })
        .select()
        .single();

      if (moduleError) throw moduleError;

      // Insert quiz questions
      if (include_quiz && mod.quiz?.length > 0) {
        const quizInserts = mod.quiz.map((q: any) => ({
          module_id: moduleData.id,
          question: q.question,
          options: q.options,
          correct_answer: q.correct ?? 0,
          explanation: q.explanation || null,
        }));
        await serviceClient.from("course_quiz_questions").insert(quizInserts);
      }

      // Insert flashcards
      if (include_flashcards && mod.flashcards?.length > 0) {
        const fcInserts = mod.flashcards.map((fc: any) => ({
          module_id: moduleData.id,
          front: fc.front,
          back: fc.back,
        }));
        await serviceClient.from("course_flashcards").insert(fcInserts);
      }
    }

    // 6. Log usage event
    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_GENERATED",
      metadata: { course_id: course.id, plan },
    });

    return new Response(
      JSON.stringify({ course_id: course.id, message: "Course generated successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Generate course error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
