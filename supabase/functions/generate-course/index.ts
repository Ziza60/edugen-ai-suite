import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PLAN_LIMITS = {
  free: { maxCourses: 3, maxModules: 5, images: false },
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

// PROMPT MESTRE v2: Official Pedagogical Template
function buildRefinementPrompt(moduleTitle: string, rawContent: string, language: string): string {
  return `Você é um designer instrucional sênior especializado em e-learning premium.

Reescreva o conteúdo bruto abaixo aplicando TODAS as regras do Template Pedagógico Oficial. O resultado deve ser visualmente leve, escaneável e profissional.

## TEMPLATE PEDAGÓGICO OFICIAL

### 1. ABERTURA OBRIGATÓRIA
Comece o módulo SEMPRE com:

## ${moduleTitle}

Seguido IMEDIATAMENTE por:

### 🎯 Objetivo do Módulo
- [bullet 1: o que o aluno vai aprender]
- [bullet 2: habilidade ou competência]
- [bullet 3: aplicação prática esperada]
(máximo 3 bullets, diretos e claros)

---

### 2. ORGANIZAÇÃO EM BLOCOS TEMÁTICOS
Organize o conteúdo do módulo usando os seguintes blocos, NA ORDEM em que fizerem sentido pedagógico. Use apenas os blocos relevantes para o conteúdo (nem todo módulo precisa de todos):

#### 🧠 Fundamentos
- Conceitos base, definições essenciais

#### ⚙️ Como funciona
- Mecanismos, processos, etapas

#### 🧩 Modelos / Tipos
- Categorias, classificações, variantes (usar tabela Markdown quando comparar 2+ itens)

#### 💡 Exemplo prático
- Caso concreto, cenário aplicado, demonstração

#### 🛠️ Aplicações reais
- Usos no mercado, indústria, cotidiano

#### ⚠️ Desafios e cuidados
- Limitações, erros comuns, armadilhas, considerações éticas

### 3. CHECKPOINT DE REFLEXÃO (OBRIGATÓRIO — mínimo 1 por módulo)
Insira em um ponto estratégico do módulo:

> 💭 **Pare um momento e reflita:** [pergunta provocativa relacionada ao conteúdo, que estimule o aluno a conectar o que aprendeu com sua experiência]

### 4. FECHAMENTO OBRIGATÓRIO
Todo módulo DEVE terminar com:

---

### 🧾 Resumo do Módulo
[1 parágrafo curto — máximo 3 frases — sintetizando o essencial]

### 📌 Key Takeaways
- [takeaway 1]
- [takeaway 2]
- [takeaway 3]
- [takeaway 4]
(mínimo 4, máximo 6 bullets)

---

### 5. REGRAS DE FORMATAÇÃO E ESTILO

**Densidade textual:**
- Nenhum parágrafo pode exceder 4 linhas
- Converter parágrafos longos em listas com bullet points (-)
- Inserir linha em branco entre cada bloco/seção para respiro visual
- Usar **negrito** para termos-chave (máximo 3-4 por parágrafo)

**Hierarquia:**
- ## para título do módulo (apenas 1)
- ### para seções principais (com emoji correspondente)
- #### para subseções quando necessário
- Linha horizontal (---) para separar grandes seções

**Tom e linguagem:**
- Profissional, claro e acessível
- Frases diretas, voz ativa
- Evitar jargão excessivo — explicar termos técnicos na primeira ocorrência
- Idioma: ${language}

**Formatação para tela:**
- Escaneabilidade: o leitor deve entender a estrutura só passando os olhos
- Listas numeradas para processos/etapas sequenciais
- Listas com bullet para itens sem ordem
- Blocos de código com \`\`\` quando aplicável

**Padrão obrigatório para TODAS as tabelas Markdown:**
- Primeira coluna deve se chamar "Aspecto", "Dimensão", "Critério" ou equivalente conceitual
- Texto da primeira coluna: sempre curto (2-4 palavras), conceitual, pode incluir emoji discreto no início (ex: 🎯 Objetivo, ⚡ Velocidade)
- Máximo 1 ideia por célula — frases curtas e objetivas
- Preferir verbos claros (analisar, gerar, classificar, criar) em vez de descrições abstratas
- Incluir exemplos concretos sempre que possível (ex: "ex: Python, R")
- Quando a tabela for comparativa, reforçar contrastes claros entre colunas — evitar descrições equivalentes/vagas
- Se o conteúdo original tiver tabelas com parágrafos longos, reescrever mantendo o significado mas fragmentando em frases curtas
- Critério: qualquer tabela deve ser compreendida em até 10 segundos por um leitor iniciante

### 6. RESTRIÇÕES ABSOLUTAS
- Mantenha 100% da correção técnica do conteúdo original
- NÃO adicione informações novas que não estejam no original
- NÃO remova conceitos ou explicações importantes — apenas reorganize e fragmente
- NÃO inclua metadados, comentários sobre o processo ou notas para o editor
- NÃO use "Neste módulo vamos..." como abertura

---

TÍTULO DO MÓDULO: ${moduleTitle}

CONTEÚDO BRUTO:
${rawContent}

---

Retorne APENAS o conteúdo reescrito em Markdown seguindo o template acima, sem explicações adicionais.`;
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
      ${include_flashcards ? ',"flashcards": [{"front": "Pergunta EXPLÍCITA com verbo e ponto de interrogação (?). PROIBIDO: títulos nominais, glossário ou definições soltas. CORRETO: Qual é a função do X no contexto Y? / Como o mecanismo Z contribui para W?", "back": "Resposta completa, objetiva e pedagogicamente clara"}]' : ""}
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
