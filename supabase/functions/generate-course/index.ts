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

// Centralized AI Call Logic (Bypasses Lovable credits using personal Gemini Key)
async function callAI(model: string, prompt: string, maxTokens = 2000) {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");

  // Prioritize personal Gemini Key if present (Bypasses Lovable Gateway per user request)
  if (geminiKey) {
    const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    let aiModel = model;
    if (aiModel.includes("gemini")) {
      aiModel = "gemini-3-flash";
    } else {
      aiModel = "gemini-3-flash";
    }

    console.log(`Calling Gemini API directly with model: ${aiModel}`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${geminiKey}`,
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Gemini call failed: ${errText}`);
      throw new Error(`Erro na API do Gemini (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || JSON.stringify(data);
  }

  // FALLBACK REMOVIDO POR SOLICITAÇÃO DO USUÁRIO
  throw new Error("Falha na chamada direta ao Gemini (ou chave GEMINI_API_KEY não configurada). Fallback Lovable desativado.");
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
- REGRA CRÍTICA: Só inclua esta seção se houver PELO MENOS 2 modelos, tipos ou categorias DISTINTOS para comparar.
- Se não houver comparação real, OMITA completamente esta seção — não crie título sem conteúdo.
- Quando existir: use tabela Markdown com 2-4 colunas e 2-5 linhas de dados reais e distintos.
- PROIBIDO: criar esta seção com texto genérico, repetindo o que já foi dito em Fundamentos.

#### 💡 Exemplo prático
- REGRA CRÍTICA DE ORDEM — sempre nesta sequência exata, sem exceção:
  **Contexto:** [situação inicial — quem, onde, qual problema]
  **Desafio:** [obstáculo específico que precisava ser superado]
  **Solução:** [o que foi feito, qual abordagem ou técnica aplicada]
  **Resultado:** [o que mudou, com número ou indicador concreto quando possível]
- O exemplo deve ser ancorado num setor ou perfil de empresa específico (não "uma empresa").
- PROIBIDO inverter ou embaralhar essa ordem.

#### 🛠️ Aplicações reais
- REGRA CRÍTICA: Mínimo 4 aplicações distintas, cada uma com 1 frase objetiva.
- Se o conteúdo original tiver menos de 4, sintetize e complemente com base no tema.
- PROIBIDO criar esta seção com 1 ou 2 itens apenas.

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
- [takeaway 1 — começa com verbo, contém ação específica]
- [takeaway 2 — começa com verbo, contém ação específica]
- [takeaway 3 — começa com verbo, contém ação específica]
- [takeaway 4 — começa com verbo, contém ação específica]
- [takeaway 5 — começa com verbo, contém ação específica]
(mínimo 5, máximo 6 bullets — cada um UMA única ideia, NUNCA duas frases colapsadas com ponto e vírgula ou " e ")

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

### 7. REGRA CRÍTICA PARA BULLETS E FRASES
- Cada bullet DEVE ser uma frase completa, terminando com ponto final.
- NUNCA corte uma frase no meio de uma palavra. Se o bullet ficar longo, reescreva-o de forma mais concisa.
- Máximo de 180 caracteres por bullet.
- Se uma ideia precisar de mais de 180 caracteres, divida em dois bullets completos e independentes.
- PROIBIDO: bullets que começam com letra minúscula (exceto artigos após ponto).
- PROIBIDO: bullets que terminam sem pontuação.
- PROIBIDO: um bullet com duas ideias separadas por ponto e vírgula ou " e ".
- Cada bullet deve ser compreensível isoladamente, sem depender do anterior.

---

TÍTULO DO MÓDULO: ${moduleTitle}

CONTEÚDO BRUTO:
${rawContent}

---

Retorne APENAS o conteúdo reescrito em Markdown seguindo o template acima, sem explicações adicionais.`;
}

function buildQualityElevationPrompt(
  moduleTitle: string,
  structuredContent: string,
  courseTitle: string,
  targetAudience: string,
  language: string,
): string {
  return `Você é um supervisor sênior de qualidade de cursos online com 15 anos de experiência avaliando e elevando material didático para plataformas de e-learning B2B e corporativas.

Você recebeu o módulo abaixo, que já passou por revisão estrutural e está pedagogicamente formatado. Sua tarefa NÃO é reformatar — a estrutura já está correta. Sua tarefa é identificar os trechos que falham nos 5 Critérios de Qualidade de Conteúdo e reescrevê-los com maior profundidade e especificidade.

## CONTEXTO DO CURSO
- Curso: "${courseTitle}"
- Módulo: "${moduleTitle}"
- Público-alvo: ${targetAudience}
- Idioma: ${language}

## OS 5 CRITÉRIOS DE QUALIDADE DE CONTEÚDO

### Critério 1 — ESPECIFICIDADE
Reprovado: conteúdo genérico que poderia estar em qualquer curso de qualquer área.
Aprovado: conteúdo que menciona técnicas, ferramentas, números ou contextos concretos do tema.

### Critério 2 — ADEQUAÇÃO AO PÚBLICO
O público é: ${targetAudience}
Reprovado: explicar o que já é óbvio para esse público (condescendente).
Aprovado: assumir o que o público já sabe e ir direto ao que ele ainda não domina.

### Critério 3 — EXEMPLO ANCORADO NA REALIDADE
Reprovado: "Uma empresa de médio porte que vende software para outra empresa..."
Aprovado: "Uma SaaS de automação de RH tentando vender para o CHRO de uma indústria com 2.000 funcionários..."

### Critério 4 — TAKEAWAYS ACIONÁVEIS
Reprovado (platitude): "Construir confiança através de credibilidade e empatia."
Aprovado (acionável): "Antes de cada reunião com o Economic Buyer, prepare 3 métricas do setor dele."

### Critério 5 — DENSIDADE DE CONTEÚDO
Reprovado: bullets curtos que apenas nomeiam conceitos sem explicar.
Aprovado: bullets que nomeiam E explicam o porquê ou como aplicar.

## COMO PROCEDER
1. Leia o módulo completo abaixo.
2. Para cada seção, avalie internamente os 5 critérios.
3. Reescreva APENAS os trechos que reprovam em pelo menos 1 critério.
4. Mantenha INTACTO o que já está aprovado.
5. Retorne o módulo COMPLETO com as melhorias aplicadas.

## RESTRIÇÕES ABSOLUTAS
- NÃO altere títulos de seções, emojis ou separadores (---)
- NÃO adicione seções novas nem remova seções existentes
- NÃO aumente o número de bullets de nenhuma seção — substitua bullets fracos por versões mais específicas, mantendo a mesma quantidade
- NÃO adicione subseções ou subtítulos novos que não existiam no original
- O volume total de texto deve ser similar ao original (±20%) — eleve qualidade, não quantidade
- Comece DIRETAMENTE com ## [título do módulo] — ZERO preamble, saudação ou explicação antes do conteúdo
- Mantenha o idioma: ${language}
- Retorne APENAS o markdown melhorado, sem comentários

---

## MÓDULO PARA REVISÃO:

${structuredContent}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // SSE helper
  const encoder = new TextEncoder();
  let controller = null as ReadableStreamDefaultController<Uint8Array> | null;

  function sendSSE(data: Record<string, unknown>) {
    if (controller) {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      } catch { /* stream closed */ }
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c as ReadableStreamDefaultController<Uint8Array>; },
  });

  const sseHeaders = {
    ...corsHeaders,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  };

  // Start processing in background, return stream immediately
  (async () => {
    try {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        sendSSE({ type: "error", message: "Not authenticated" });
        controller?.close();
        return;
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const serviceClient = createClient(supabaseUrl, supabaseKey);

      const token = authHeader.replace("Bearer ", "");
      const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
      if (claimsError || !claimsData?.claims) {
        sendSSE({ type: "error", message: "Invalid token" });
        controller?.close();
        return;
      }

      const userId = claimsData.claims.sub as string;
      const body = await req.json();
      const {
        title: rawTitle, theme, target_audience, tone, language,
        num_modules, include_quiz, include_flashcards, include_images,
        use_sources,
      } = body;

      const title = (rawTitle || "").trim().replace(/\s{2,}/g, " ");
      if (!title || title.length < 3) {
        sendSSE({ type: "error", message: "O título do curso deve ter pelo menos 3 caracteres." });
        controller?.close();
        return;
      }

      sendSSE({ type: "status", message: "Verificando permissões..." });

      // Get subscription
      const { data: sub } = await serviceClient
        .from("subscriptions").select("plan").eq("user_id", userId).single();
      const plan = (sub?.plan || "free") as "free" | "pro";
      const limits = PLAN_LIMITS[plan];

      // Check dev status
      const { data: profile, error: profileError } = await serviceClient
        .from("profiles").select("is_dev").eq("user_id", userId).maybeSingle();
      let isDev = profile?.is_dev === true;
      if (!isDev && profileError) {
        const { data: profileById } = await serviceClient
          .from("profiles").select("is_dev").eq("id", userId).maybeSingle();
        isDev = profileById?.is_dev === true;
      }

      // Check monthly usage
      if (!isDev) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const { count: usageCount } = await serviceClient
          .from("usage_events").select("*", { count: "exact", head: true })
          .eq("user_id", userId).eq("event_type", "COURSE_GENERATED").gte("created_at", startOfMonth);
        if ((usageCount ?? 0) >= limits.maxCourses) {
          sendSSE({ type: "error", message: "Limite mensal de cursos atingido. Faça upgrade do plano." });
          controller?.close();
          return;
        }
      }

      const actualModules = Math.min(num_modules || 3, limits.maxModules);

      if (include_images && !limits.images && !isDev) {
        sendSSE({ type: "error", message: "Imagens IA disponíveis apenas no plano Pro." });
        controller?.close();
        return;
      }

      if (use_sources && plan !== "pro" && !isDev) {
        sendSSE({ type: "error", message: "Fontes próprias disponíveis apenas no plano Pro." });
        controller?.close();
        return;
      }

      // Retrieve sources if needed
      let sourcesBlock = "";
      if (use_sources) {
        const tempCourseId = body.temp_course_id;
        if (!tempCourseId) {
          sendSSE({ type: "error", message: "temp_course_id é obrigatório para cursos com fontes." });
          controller?.close();
          return;
        }

        const { data: sources, error: srcError } = await serviceClient
          .from("course_sources").select("filename, extracted_text")
          .eq("course_id", tempCourseId).eq("user_id", userId);
        if (srcError) throw srcError;
        if (!sources || sources.length === 0) {
          sendSSE({ type: "error", message: "Nenhuma fonte encontrada." });
          controller?.close();
          return;
        }

        const allText = sources.map((s: any) => `--- Fonte: ${s.filename} ---\n${s.extracted_text}`).join("\n\n");
        if (allText.length < 200) {
          sendSSE({ type: "error", message: "As fontes não contêm conteúdo suficiente." });
          controller?.close();
          return;
        }
        sourcesBlock = allText;
      }

      // ── STAGE 1: Generate structure ──
      sendSSE({ type: "status", message: "Criando estrutura do curso..." });

      const sourcesInstruction = use_sources
        ? `\n\nCRITICAL SOURCE RULES:
- You MUST use ONLY the content provided in <SOURCES> below.
- Do NOT add any external knowledge not present in the sources.
- Module titles and content must be derived exclusively from the provided documents.

<SOURCES>
${sourcesBlock}
</SOURCES>`
        : "";

      const structurePrompt = `You are an educational course designer. Create a detailed course structure in JSON format.

CRITICAL HARD CONSTRAINT — MODULE COUNT:
- You MUST generate EXACTLY ${actualModules} modules. Not fewer, not more.
- The "modules" array MUST contain exactly ${actualModules} items.

CRITICAL QUALITY RULES:
- All text must have PERFECT spelling and grammar in ${language || "pt-BR"}.
- Module titles must be complete, grammatically correct phrases.
${sourcesInstruction}

Course details:
- Title: ${title}
- Theme: ${theme}
- Target audience: ${target_audience || "general"}
- Tone: ${tone || "professional"}
- Language: ${language || "pt-BR"}
- EXACTLY ${actualModules} modules
${use_sources ? "- Base the course structure EXCLUSIVELY on the content in <SOURCES>" : ""}
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
      ${include_flashcards ? ',"flashcards": [{"front": "Pergunta EXPLÍCITA com verbo e ponto de interrogação (?)", "back": "Resposta completa e pedagógica"}]' : ""}
    }
  ]
}`;

      const structureRaw = await callAI("google/gemini-3-flash", structurePrompt);
      let structure;
      try {
        // Strip markdown fences if present
        const cleaned = structureRaw
          .replace(/^```(?:json)?\s*\n?/i, "")
          .replace(/\n?\s*```\s*$/i, "")
          .trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        structure = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
      } catch (parseErr) {
        console.error("[generate-course] Failed to parse structure:", structureRaw.substring(0, 500));
        throw new Error("Failed to parse AI structure response");
      }

      // Hard validation: enforce exact module count
      if (!structure.modules || structure.modules.length !== actualModules) {
        console.warn(`Module count mismatch: got ${structure.modules?.length ?? 0}, expected ${actualModules}. Retrying...`);
        sendSSE({ type: "status", message: "Ajustando estrutura..." });

        const retryPrompt = `Generate a course structure with EXACTLY ${actualModules} modules for "${title}" (${theme}).
Language: ${language || "pt-BR"}. Target audience: ${target_audience || "general"}. Tone: ${tone || "professional"}.
${include_quiz ? "Include 3 quiz questions per module." : ""}
${include_flashcards ? "Include 5 flashcards per module." : ""}
Return ONLY valid JSON with "description" and "modules" array containing EXACTLY ${actualModules} items.`;

        const retryRaw = await callAI("google/gemini-3-flash-lite", retryPrompt, 1000);
        try {
          const retryMatch = retryRaw.match(/\{[\s\S]*\}/);
          structure = JSON.parse(retryMatch ? retryMatch[0] : retryRaw);
        } catch {
          throw new Error("Failed to parse AI retry response");
        }

        if (!structure.modules || structure.modules.length !== actualModules) {
          throw new Error(`Failed to generate exactly ${actualModules} modules after retry.`);
        }
      }

      sendSSE({ type: "structure_done", modules: actualModules });

      // ── STAGE 2: Create course in DB ──
      const { data: course, error: courseError } = await serviceClient
        .from("courses")
        .insert({
          user_id: userId, title,
          description: structure.description || "",
          theme, target_audience: target_audience || null,
          tone: tone || null, language: language || "pt-BR",
          include_quiz: !!include_quiz, include_flashcards: !!include_flashcards,
          include_images: !!include_images, use_sources: !!use_sources,
        })
        .select().single();

      if (courseError) throw courseError;

      // Reassign sources
      if (use_sources && body.temp_course_id) {
        await serviceClient.from("course_sources")
          .update({ course_id: course.id })
          .eq("course_id", body.temp_course_id).eq("user_id", userId);
      }

      // ── STAGE 3: Generate content per module (parallel batches of 3) ──
      const BATCH_SIZE = 3;
      for (let batchStart = 0; batchStart < structure.modules.length; batchStart += BATCH_SIZE) {
        const batch = structure.modules.slice(batchStart, batchStart + BATCH_SIZE);

        await Promise.all(batch.map(async (mod: any, batchIdx: number) => {
          const i = batchStart + batchIdx;

          sendSSE({
            type: "module_start",
            module: i + 1,
            total: actualModules,
            title: mod.title,
          });

          // Step A: Generate raw content
          const sourceContentInstruction = use_sources
            ? `\n\nCRITICAL: Use ONLY the content in <SOURCES> below.\n<SOURCES>\n${sourcesBlock}\n</SOURCES>`
            : "";

          const contentPrompt = `Write detailed educational content for this module in ${language || "pt-BR"}.

Course: ${title}
Module ${i + 1}: ${mod.title}
Summary: ${mod.summary || mod.title}
Target audience: ${target_audience || "general"}
Tone: ${tone || "professional"}
${sourceContentInstruction}

Write in Markdown format. Include clear introduction, main concepts, examples, key takeaways.
Write 800-1200 words. Be thorough and educational.`;

          const rawContent = await callAI("google/gemini-3-flash", contentPrompt);

          // Step B: Pedagogical refinement
          const refinementPrompt = buildRefinementPrompt(mod.title, rawContent, language || "pt-BR");
          const refinedContent = await callAI("google/gemini-3-flash-lite", refinementPrompt, 1500);

          // Step C: Quality Elevation
          let elevatedContent = refinedContent;
          try {
            console.log(`[generate-course] Quality Elevation: module ${i + 1} "${mod.title}"`);
            const qualityPrompt = buildQualityElevationPrompt(
              mod.title, refinedContent, title,
              target_audience || "profissionais da área", language || "pt-BR",
            );
            const qualityResult = await callAI("google/gemini-3-flash", qualityPrompt, 2000);
            // Strip markdown fences AND any preamble before the first ## heading
            const strippedFences = qualityResult
              .replace(/^```(?:markdown)?\n?/i, "").replace(/\n?```$/i, "").trim();
            const firstHeading = strippedFences.indexOf("\n## ");
            const cleanedQuality = firstHeading > 0
              ? strippedFences.slice(firstHeading).trim()
              : strippedFences.startsWith("## ")
                ? strippedFences
                : strippedFences;
            // Additional preamble guard: if result starts with a conversational line
            // (no ##), extract from first ## occurrence
            const preambleGuard = (s: string) => {
              const idx = s.search(/^## /m);
              return idx > 0 ? s.slice(idx).trim() : s;
            };
            const finalQuality = preambleGuard(cleanedQuality);
            if (finalQuality.length >= refinedContent.length * 0.75) {
              elevatedContent = finalQuality;
              console.log(`[generate-course] Quality Elevation OK: ${refinedContent.length} → ${elevatedContent.length} chars`);
            } else {
              console.warn(`[generate-course] Quality Elevation result too short, keeping refined content`);
            }
          } catch (elevationErr: any) {
            console.warn(`[generate-course] Quality Elevation failed (non-blocking): ${elevationErr.message}`);
          }

          // Step D: Save
          const { data: moduleData, error: moduleError } = await serviceClient
            .from("course_modules")
            .insert({
              course_id: course.id, title: mod.title,
              content: elevatedContent, order_index: i,
            })
            .select().single();
          if (moduleError) throw moduleError;

          // Insert quiz questions
          if (include_quiz && mod.quiz?.length > 0) {
            const quizInserts = mod.quiz.map((q: any) => ({
              module_id: moduleData.id, question: q.question,
              options: q.options, correct_answer: q.correct ?? 0,
              explanation: q.explanation || null,
            }));
            await serviceClient.from("course_quiz_questions").insert(quizInserts);
          }

          // Insert flashcards
          if (include_flashcards && mod.flashcards?.length > 0) {
            const fcInserts = mod.flashcards.map((fc: any) => ({
              module_id: moduleData.id, front: fc.front, back: fc.back,
            }));
            await serviceClient.from("course_flashcards").insert(fcInserts);
          }

          // Generate AI image (non-blocking)
          if (include_images) {
            try {
              const imagePrompt = `Create a professional, clean, educational illustration for a course module about "${mod.title}" in the course "${title}". 
STRICT RULES: No readable text, letters, words, numbers, labels. Use ONLY abstract shapes, icons, conceptual diagrams, visual metaphors. Style: modern, minimalist, soft colors, 16:9.`;

              const imgRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
                },
                body: JSON.stringify({
                  model: "google/gemini-3-flash-image",
                  messages: [{ role: "user", content: imagePrompt }],
                  modalities: ["image", "text"],
                  max_tokens: 500, // Limite para geração de imagem
                }),
              });

              if (imgRes.ok) {
                const imgData = await imgRes.json();
                const imageUrl = imgData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
                if (imageUrl && imageUrl.startsWith("data:image")) {
                  const base64Data = imageUrl.split(",")[1];
                  const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
                  const ext = imageUrl.includes("png") ? "png" : "jpg";
                  const storagePath = `${userId}/module-${moduleData.id}.${ext}`;

                  const { error: uploadErr } = await serviceClient.storage
                    .from("course-exports")
                    .upload(storagePath, binaryData, { contentType: `image/${ext}`, upsert: true });

                  if (!uploadErr) {
                    const { data: signedData } = await serviceClient.storage
                      .from("course-exports")
                      .createSignedUrl(storagePath, 60 * 60 * 24 * 365);
                    if (signedData?.signedUrl) {
                      await serviceClient.from("course_images").insert({
                        module_id: moduleData.id,
                        url: signedData.signedUrl,
                        alt_text: `Ilustração: ${mod.title}`,
                      });
                    }
                  }
                }
              }
            } catch (imgErr) {
              console.error("Image generation failed for module", mod.title, imgErr);
            }
          }

          sendSSE({ type: "module_done", module: i + 1, total: actualModules });
        }));
      }

      // ── STAGE 4: Log usage ──
      const usageInserts = [
        { user_id: userId, event_type: "COURSE_GENERATED", metadata: { course_id: course.id, plan } },
      ];
      if (use_sources) {
        usageInserts.push({
          user_id: userId, event_type: "COURSE_WITH_SOURCES",
          metadata: { course_id: course.id, plan },
        });
      }
      await serviceClient.from("usage_events").insert(usageInserts);

      // ── STAGE 5: Auto-restructure (non-blocking, don't wait for SSE) ──
      try {
        console.log("[generate-course] Auto-invoking restructure-modules...");
        const restructureUrl = `${supabaseUrl}/functions/v1/restructure-modules`;
        fetch(restructureUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": authHeader,
            "apikey": anonKey,
          },
          body: JSON.stringify({ course_id: course.id }),
        }).then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            console.log("[generate-course] Auto-restructure complete:", data.message);
          } else {
            console.warn("[generate-course] Auto-restructure failed:", await res.text());
          }
        }).catch((err) => {
          console.warn("[generate-course] Auto-restructure error:", err.message);
        });
      } catch (e: any) {
        console.warn("[generate-course] Auto-restructure error (non-blocking):", e.message);
      }

      // Send completion event
      sendSSE({ type: "complete", courseId: course.id });
      controller?.close();

    } catch (error: any) {
      console.error("Generate course error:", error);
      sendSSE({ type: "error", message: error.message || "Erro interno ao gerar curso" });
      controller?.close();
    }
  })();

  return new Response(stream, { headers: sseHeaders });
});
