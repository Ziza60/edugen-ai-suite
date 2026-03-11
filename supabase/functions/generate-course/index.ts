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

### 7. REGRA CRÍTICA PARA BULLETS E FRASES
- Cada bullet DEVE ser uma frase completa, terminando com ponto final.
- NUNCA corte uma frase no meio de uma palavra. Se o bullet ficar longo, reescreva-o de forma mais concisa.
- Máximo de 180 caracteres por bullet.
- Se uma ideia precisar de mais de 180 caracteres, divida em dois bullets completos e independentes.
- PROIBIDO: bullets que começam com letra minúscula (exceto artigos após ponto).
- PROIBIDO: bullets que terminam sem pontuação.
- Cada bullet deve ser compreensível isoladamente, sem depender do anterior.

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
      title: rawTitle,
      theme,
      target_audience,
      tone,
      language,
      num_modules,
      include_quiz,
      include_flashcards,
      include_images,
      use_sources,
    } = body;

    // Sanitize title
    const title = (rawTitle || "").trim().replace(/\s{2,}/g, " ");
    if (!title || title.length < 3) {
      return new Response(
        JSON.stringify({ error: "O título do curso deve ter pelo menos 3 caracteres." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Get subscription
    const { data: sub } = await serviceClient
      .from("subscriptions")
      .select("plan")
      .eq("user_id", userId)
      .single();

    const plan = (sub?.plan || "free") as "free" | "pro";
    const limits = PLAN_LIMITS[plan];

    // 1b. Check if user is a dev
    const { data: profile, error: profileError } = await serviceClient
      .from("profiles")
      .select("is_dev")
      .eq("user_id", userId)
      .maybeSingle();

    let isDev = profile?.is_dev === true;
    if (!isDev && profileError) {
      const { data: profileById } = await serviceClient
        .from("profiles")
        .select("is_dev")
        .eq("id", userId)
        .maybeSingle();
      isDev = profileById?.is_dev === true;
    }

    // 2. Check monthly usage
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

    if (include_images && !limits.images && !isDev) {
      return new Response(
        JSON.stringify({ error: "AI images are available only on Pro plan." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (use_sources && plan !== "pro" && !isDev) {
      return new Response(
        JSON.stringify({ error: "Fontes próprias estão disponíveis apenas no plano Pro." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2d. If using sources, retrieve all extracted texts
    let sourcesBlock = "";
    if (use_sources) {
      const tempCourseId = body.temp_course_id;
      if (!tempCourseId) {
        return new Response(
          JSON.stringify({ error: "temp_course_id é obrigatório para cursos com fontes." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: sources, error: srcError } = await serviceClient
        .from("course_sources")
        .select("filename, extracted_text")
        .eq("course_id", tempCourseId)
        .eq("user_id", userId);

      if (srcError) throw srcError;

      if (!sources || sources.length === 0) {
        return new Response(
          JSON.stringify({ error: "Nenhuma fonte encontrada. Faça upload de pelo menos um documento." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const allText = sources
        .map((s: any) => `--- Fonte: ${s.filename} ---\n${s.extracted_text}`)
        .join("\n\n");

      if (allText.length < 200) {
        return new Response(
          JSON.stringify({ error: "As fontes fornecidas não contêm conteúdo suficiente para gerar um curso." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      sourcesBlock = allText;
    }

    // 3. Generate course structure
    const sourcesInstruction = use_sources
      ? `\n\nCRITICAL SOURCE RULES:
- You MUST use ONLY the content provided in <SOURCES> below.
- Do NOT add any external knowledge, facts, or information not present in the sources.
- If the sources don't contain enough information for a topic, explicitly state: "Informação não disponível nas fontes fornecidas."
- Module titles and content must be derived exclusively from the provided documents.

<SOURCES>
${sourcesBlock}
</SOURCES>`
      : "";

    const structurePrompt = `You are an educational course designer. Create a detailed course structure in JSON format.

CRITICAL HARD CONSTRAINT — MODULE COUNT:
- You MUST generate EXACTLY ${actualModules} modules. Not fewer, not more.
- The "modules" array in your JSON response MUST contain exactly ${actualModules} items.
- This is a non-negotiable requirement. Generating a different number is a critical failure.

CRITICAL QUALITY RULES:
- All text (titles, descriptions, questions) must have PERFECT spelling and grammar in ${language || "pt-BR"}.
- Double-check every title and sentence for missing letters, typos, or truncated words.
- Module titles must be complete, grammatically correct phrases.
- The course description must be a well-formed paragraph with no spelling errors.
${sourcesInstruction}

Course details:
- Title: ${title}
- Theme: ${theme}
- Target audience: ${target_audience || "general"}
- Tone: ${tone || "professional"}
- Language: ${language || "pt-BR"}
- EXACTLY ${actualModules} modules (mandatory — no more, no less)
${use_sources ? "- IMPORTANT: Base the course structure EXCLUSIVELY on the content in <SOURCES>" : ""}
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

    // ═══════════ SSE STREAM SETUP ═══════════
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    const send = async (data: object) => {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    };

    // Start async generation in background
    (async () => {
      try {
        await send({ type: "status", message: "Gerando estrutura do curso..." });

        const structureRaw = await callAI("google/gemini-2.5-flash-lite", structurePrompt);

        let structure;
        try {
          const jsonMatch = structureRaw.match(/\{[\s\S]*\}/);
          structure = JSON.parse(jsonMatch ? jsonMatch[0] : structureRaw);
        } catch {
          throw new Error("Failed to parse AI structure response");
        }

        // HARD VALIDATION: enforce exact module count
        if (!structure.modules || structure.modules.length !== actualModules) {
          console.warn(`Module count mismatch: got ${structure.modules?.length ?? 0}, expected ${actualModules}. Retrying...`);
          await send({ type: "status", message: "Ajustando estrutura..." });
          
          const retryPrompt = `You previously generated ${structure.modules?.length ?? 0} modules, but EXACTLY ${actualModules} are required.

Generate a complete course structure with EXACTLY ${actualModules} modules for the course "${title}" (${theme}).
Language: ${language || "pt-BR"}. Target audience: ${target_audience || "general"}. Tone: ${tone || "professional"}.
${include_quiz ? "Include 3 quiz questions per module." : ""}
${include_flashcards ? "Include 5 flashcards per module." : ""}

Return ONLY valid JSON with "description" and "modules" array containing EXACTLY ${actualModules} items.`;

          const retryRaw = await callAI("google/gemini-2.5-flash", retryPrompt);
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

        await send({ type: "structure_done", total: structure.modules.length });

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
            use_sources: !!use_sources,
          })
          .select()
          .single();

        if (courseError) throw courseError;

        // Reassign sources
        if (use_sources && body.temp_course_id) {
          await serviceClient
            .from("course_sources")
            .update({ course_id: course.id })
            .eq("course_id", body.temp_course_id)
            .eq("user_id", userId);
        }

        // 5. Generate content for each module IN PARALLEL (batches of 3)
        const BATCH_SIZE = 3;
        for (let batchStart = 0; batchStart < structure.modules.length; batchStart += BATCH_SIZE) {
          const batch = structure.modules.slice(batchStart, batchStart + BATCH_SIZE);
          
          await Promise.all(batch.map(async (mod: any, batchIdx: number) => {
            const i = batchStart + batchIdx;

            await send({ type: "module_start", module: i + 1, total: structure.modules.length, title: mod.title });

            const sourceContentInstruction = use_sources
              ? `\n\nCRITICAL: Use ONLY the content provided in <SOURCES> below. Do NOT add any external knowledge.
If there is insufficient information in the sources for this module, write: "⚠️ Não há conteúdo suficiente nas fontes para este módulo."

<SOURCES>
${sourcesBlock}
</SOURCES>`
              : "";

            const contentPrompt = `Write detailed educational content for this module in ${language || "pt-BR"}.

Course: ${title}
Module ${i + 1}: ${mod.title}
Summary: ${mod.summary || mod.title}
Target audience: ${target_audience || "general"}
Tone: ${tone || "professional"}
${sourceContentInstruction}

Write in Markdown format. Include:
- Clear introduction
- Main concepts with explanations
- Examples when relevant
- Key takeaways

REGRA CRÍTICA PARA BULLETS E FRASES:
- Cada bullet DEVE ser uma frase completa, terminando com ponto final.
- NUNCA corte uma frase no meio de uma palavra.
- Máximo de 180 caracteres por bullet.
- Cada bullet deve ser compreensível isoladamente.

Write 800-1200 words. Be thorough and educational.`;

            const rawContent = await callAI("google/gemini-2.5-flash", contentPrompt);

            // Pedagogical refinement
            const refinementPrompt = buildRefinementPrompt(mod.title, rawContent, language || "pt-BR");
            const refinedContent = await callAI("google/gemini-2.5-flash", refinementPrompt);

            // Save module
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

            // Generate AI image
            if (include_images) {
              try {
                const imagePrompt = `Create a professional, clean, educational illustration for a course module about "${mod.title}" in the course "${title}". 
STRICT RULES:
- Do NOT include any readable text, letters, words, numbers, labels, captions, or typography anywhere in the image.
- Use ONLY: abstract shapes, icons, conceptual diagrams, visual metaphors, gradients, geometric patterns, and symbolic illustrations.
- Style: modern, minimalist, soft colors, professional e-learning aesthetic.
- Aspect ratio: 16:9.`;

                const imgRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
                  },
                  body: JSON.stringify({
                    model: "google/gemini-2.5-flash-image",
                    messages: [{ role: "user", content: imagePrompt }],
                    modalities: ["image", "text"],
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
                      .upload(storagePath, binaryData, {
                        contentType: `image/${ext}`,
                        upsert: true,
                      });

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

            await send({ type: "module_done", module: i + 1, total: structure.modules.length });
          }));
        }

        // 6. Log usage events
        const usageInserts = [
          { user_id: userId, event_type: "COURSE_GENERATED", metadata: { course_id: course.id, plan } },
        ];
        if (use_sources) {
          usageInserts.push({
            user_id: userId,
            event_type: "COURSE_WITH_SOURCES",
            metadata: { course_id: course.id, plan },
          });
        }
        await serviceClient.from("usage_events").insert(usageInserts);

        // 7. AUTO-STANDARDIZE
        let qualityReport = null;
        try {
          console.log("[generate-course] Auto-invoking restructure-modules...");
          await send({ type: "status", message: "Padronizando conteúdo..." });
          const restructureUrl = `${supabaseUrl}/functions/v1/restructure-modules`;
          const restructureRes = await fetch(restructureUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": authHeader,
              "apikey": anonKey,
            },
            body: JSON.stringify({ course_id: course.id }),
          });
          if (restructureRes.ok) {
            const restructureData = await restructureRes.json();
            qualityReport = restructureData.markdown_quality_report || null;
            console.log("[generate-course] Auto-restructure complete:", restructureData.message);
          } else {
            console.warn("[generate-course] Auto-restructure failed:", await restructureRes.text());
          }
        } catch (restructureErr: any) {
          console.warn("[generate-course] Auto-restructure error (non-blocking):", restructureErr.message);
        }

        await send({ type: "complete", courseId: course.id, qualityReport });
        await writer.close();
      } catch (error: any) {
        console.error("Generate course error:", error);
        try {
          await send({ type: "error", message: error.message || "Internal server error" });
          await writer.close();
        } catch { /* writer may already be closed */ }
      }
    })();

    return new Response(stream.readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("Generate course error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
