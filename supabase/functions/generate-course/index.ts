import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cleanModuleContent, repairTruncation } from "../_shared/markdown.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PLAN_LIMITS = {
  free: { maxCourses: 3, maxModules: 5, images: false },
  pro: { maxCourses: 5, maxModules: 10, images: true },
};

// TESTING_MODE: fase de testes sem usuários reais. Destrava TODOS os gates de
// plano Pro (imagens IA, fontes próprias, limite mensal de cursos e nº de
// módulos). Para reativar a monetização, basta voltar para `false`.
const TESTING_MODE = true;

// Build marker — logged on every invocation so a deploy can be verified in the
// function logs (see the export-pdf deploy saga: always confirm WHICH code runs).
const GENERATE_COURSE_BUILD = "2026-07-06a-arch-v3";

// Centralized AI Call Logic (Bypasses Lovable credits using personal Gemini Key).
// Returns the text plus the finish_reason so callers can detect a MAX_TOKENS
// truncation ("length") and react (retry with a larger cap, then sanitize).
async function callAIMeta(
  model: string, prompt: string, maxTokens = 2000, isJson = false, timeoutMs = 90000,
): Promise<{ content: string; finishReason: string }> {
  const { content, finishReason } = await callAIInner(model, prompt, maxTokens, isJson, timeoutMs);
  return { content, finishReason };
}

// Backwards-compatible wrapper (most callers only need the text).
async function callAI(model: string, prompt: string, maxTokens = 2000, isJson = false, timeoutMs = 90000) {
  return (await callAIInner(model, prompt, maxTokens, isJson, timeoutMs)).content;
}

async function callAIInner(model: string, prompt: string, maxTokens = 2000, isJson = false, timeoutMs = 90000): Promise<{ content: string; finishReason: string }> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

  // Honor the per-stage model requested by the caller. The Google native endpoint
  // expects bare model ids (e.g. "gemini-2.5-flash"), NOT vendor-prefixed names
  // like "google/...". Unknown values fall back to flash to stay safe/cheap.
  const ALLOWED_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro"];
  const aiModel = ALLOWED_MODELS.includes(model) ? model : "gemini-2.5-flash";

  console.log(`Calling Gemini API directly with model: ${aiModel}`);

  if (!geminiKey) {
    throw new Error("GEMINI_API_KEY não configurada.");
  }

  // Hard timeout: a single slow/hung Gemini call must not consume the whole edge
  // wall-clock budget and leave generation stuck. Aborts cleanly; the elevation
  // and assessment callers already treat a failure as non-blocking.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${geminiKey}`,
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.1, // Even lower temperature for more predictable structure
        ...(isJson ? { response_format: { type: "json_object" } } : {})
      }),
      signal: controller.signal,
    });
  } catch (e: any) {
    throw new Error(
      e?.name === "AbortError"
        ? `Gemini timeout (${aiModel}, ${timeoutMs}ms)`
        : `Gemini fetch error (${aiModel}): ${e?.message || e}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Gemini call failed: ${errText}`);
    throw new Error(`Erro na API do Gemini (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content || "",
    finishReason: choice?.finish_reason || "",
  };
}


// ── Arquitetura pedagógica v3: papéis por módulo, não fórmula fixa ─────────────
// Cada módulo recebe do Arquiteto (Stage 1) um PAPEL pedagógico; o Redator abaixo
// usa um cardápio de blocos POR PAPEL em vez do template canônico de 12 seções.
// Invariantes preservados para o pipeline de export (PPTX v7/PDF v2):
//   - todo módulo fecha com "### 📌 Pontos-chave" (slide de takeaways no PPTX);
//   - exemplos trabalhados mantêm a microestrutura Contexto→Desafio→Solução→Resultado;
//   - tabelas só com 2+ linhas reais de dados; código em cercas ```.
// NOTA: restructure-modules ("Reformatar conteúdo") ainda valida o template antigo —
// não rodar rewrite naquele fluxo sobre cursos v3 (validate_only continua ok).

type ModuleRole = "conceito" | "aplicacao" | "consolidacao" | "capstone";

const ROLE_BLOCKS: Record<ModuleRole, string> = {
  conceito: `BLOCOS RECOMENDADOS para um módulo CONCEITUAL (escolha 3-5, na ordem que fizer sentido):
- Conceito central explicado com UMA analogia concreta do universo do público.
- Comparativo real (tabela Markdown SÓ se houver 2+ itens genuinamente distintos; senão, prosa).
- Mini-exemplo ilustrativo curto (3-6 linhas) mostrando o conceito em ação.
- "Erro comum": o mal-entendido típico de iniciantes sobre este conceito e como evitá-lo.
- Pergunta-guia respondida ao longo do texto (abre com a pergunta, fecha respondendo).`,
  aplicacao: `BLOCOS RECOMENDADOS para um módulo de APLICAÇÃO (escolha 3-5, na ordem que fizer sentido):
- Passo a passo numerado do procedimento/técnica (3-7 passos acionáveis).
- Exemplo trabalhado OBRIGATÓRIO nesta ordem exata:
  **Contexto:** [quem, onde, qual problema] **Desafio:** [obstáculo específico]
  **Solução:** [o que foi feito] **Resultado:** [o que mudou, com indicador concreto]
  Ancorado num setor/perfil específico (não "uma empresa").
- Atividade prática: UMA tarefa hands-on com enunciado + 3-6 passos e entregável claro.
- Checklist de verificação ("antes de seguir, confira...").
- Variações/limites: quando a técnica NÃO se aplica.`,
  consolidacao: `BLOCOS RECOMENDADOS para um módulo de CONSOLIDAÇÃO (escolha 3-4):
- Síntese integradora: como os conceitos dos módulos anteriores se conectam (cite-os pelo nome).
- Caso integrador que exige usar 2+ competências já construídas no curso.
- Exercício integrador com entregável.
- Mapa de decisão: "quando usar o quê" (tabela ou lista de critérios).`,
  capstone: `Este é o módulo FINAL (capstone). Estruture-o como o entregável indicado no plano do curso:
- estudo_de_caso → caso guiado do início ao fim usando o fio condutor do curso, com perguntas orientadoras em cada etapa.
- projeto → projeto final com briefing, requisitos, etapas numeradas, critérios de avaliação e entregável definido.
- plano_de_acao → plano de ação aplicável ao contexto do aluno: template preenchível + instruções por seção.
- simulado → 8-12 questões no estilo da avaliação-alvo com gabarito comentado ao final.
- sintese → revisão integradora dos pontos essenciais do curso + próximos passos de estudo.
O capstone deve OBRIGAR o aluno a usar competências de PELO MENOS 3 módulos anteriores (cite-os).`,
};

function buildRefinementPrompt(
  moduleTitle: string,
  rawContent: string,
  language: string,
  role: ModuleRole,
  buildsOn: string,
  caseThread: string,
  moduleIndex: number,
  totalModules: number,
): string {
  return `Você é um designer instrucional sênior especializado em e-learning premium.

Reescreva o conteúdo bruto abaixo como a ${moduleIndex + 1}ª lição de um curso com ${totalModules} módulos. O papel pedagógico DESTE módulo é: ${role.toUpperCase()}.

## PRINCÍPIOS (substituem qualquer template fixo)

1. PROGRESSÃO É OBRIGATÓRIA: este módulo NÃO é autônomo.
${moduleIndex === 0
  ? "- Como primeiro módulo, abra situando o problema que o curso resolve e o que o aluno será capaz de fazer ao final DO CURSO (1 parágrafo)."
  : `- Abra com 1-2 frases conectando explicitamente ao que o aluno construiu antes: ${buildsOn || "o módulo anterior"}. Sem essa ponte o módulo está ERRADO.`}
- Referencie conceitos de módulos anteriores pelo nome quando usá-los (ex.: "como você viu ao mapear os riscos...").

2. TÍTULOS DE SEÇÃO ESPECÍFICOS DO TEMA:
- Use ### para seções com nomes que descrevem O CONTEÚDO (ex.: "### Ameaças no ambiente escolar", "### Delimitando o escopo da missão").
- PROIBIDO usar rótulos genéricos de fôrma como "Fundamentos", "Como funciona", "Modelos / Tipos", "Aplicações reais" — o nome da seção deve ser incompreensível fora deste tema.
- Emojis: no máximo 1-2 em todo o módulo, apenas onde agregam (ou nenhum).

3. ${ROLE_BLOCKS[role]}

${caseThread ? `4. FIO CONDUTOR DO CURSO: "${caseThread}"
- Quando este módulo usar exemplo ou caso, prefira AVANÇAR este fio condutor (a mesma organização/personagem evoluindo módulo a módulo) em vez de inventar um cenário desconexo.
` : ""}
## CHECKPOINT DE REFLEXÃO (1 por módulo, em ponto estratégico)
> 💭 **Pare um momento e reflita:** [pergunta que conecte o conteúdo à experiência do aluno]

## FECHAMENTO OBRIGATÓRIO (invariante de exportação — NÃO OMITIR)
Termine SEMPRE com:

---

### 📌 Pontos-chave
- [3 a 6 bullets; cada um começa com verbo e traz UMA ação/ideia específica deste módulo]

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
  theme: string,
): string {
  return `Você é um supervisor sênior de qualidade de cursos online com 15 anos de experiência avaliando e elevando material didático para plataformas de e-learning B2B e corporativas.

Você recebeu o módulo abaixo, que já passou por uma formatação inicial. Esta é a PASSAGEM FINAL: o resultado será publicado como está. Você tem DUAS tarefas:
(A) Garantir que a ESTRUTURA do template oficial esteja COMPLETA e correta.
(B) Elevar a QUALIDADE do conteúdo segundo os 5 Critérios abaixo.

## CONTEXTO DO CURSO
- Curso: "${courseTitle}"
- Tema: "${theme}"
- Módulo: "${moduleTitle}"
- Público-alvo: ${targetAudience}
- Idioma: ${language}

## REGRA ABSOLUTA DE DOMÍNIO (NÃO QUEBRAR)
- TODOS os exemplos, código, terminologia e analogias devem permanecer dentro do domínio técnico de "${courseTitle}" / "${theme}" e seu ecossistema nativo.
- Se o curso é sobre uma linguagem de programação (Python, JavaScript, Java, etc.): use APENAS sintaxe/idiomática/biblioteca padrão dessa linguagem. NUNCA introduza SQL DDL/DML (CREATE TABLE, ALTER TABLE, INSERT, UPDATE, DELETE, SELECT, JOIN) salvo se o curso for explicitamente sobre SQL/bancos.
- Mesma regra para shell/Bash, HTML/CSS ou outras linguagens — não traga exemplos de fora do domínio.
- Ao "elevar a qualidade", NÃO substitua exemplos da linguagem-alvo por exemplos de outra tecnologia, mesmo que pareçam mais ricos.
${language.toLowerCase().startsWith("pt") ? "\n## LOCALIZAÇÃO (BRASIL)\n- Quando agregar valor e sem forçar, ancore exemplos no contexto brasileiro: LGPD (dados pessoais), referenciais nacionais quando pertinente (ex.: BNCC na educação) e ferramentas/plataformas/empresas usadas no Brasil, além das internacionais. NÃO invente fatos.\n" : ""}
## OS 6 CRITÉRIOS DE QUALIDADE DE CONTEÚDO

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

## Critério 6 — PROGRESSÃO (arquitetura v3)
Reprovado: módulo-ilha que não menciona nada construído nos módulos anteriores.
Aprovado: abertura que conecta ao módulo anterior e corpo que USA competências já construídas, citando-as pelo nome.

## INVARIANTES DE ESTRUTURA (verificar e garantir — SEM impor fôrma)
- A estrutura de seções foi desenhada para ESTE módulo: PRESERVE os títulos temáticos existentes. NÃO os renomeie para rótulos genéricos ("Fundamentos", "Como funciona", "Aplicações reais") e NÃO adicione seções de fôrma.
- O módulo DEVE terminar com \`### 📌 Pontos-chave\` (3-6 bullets iniciando com verbo). Se faltar, crie a partir do conteúdo.
- Deve existir 1 checkpoint \`> 💭 **Pare um momento e reflita:**\`. Se faltar, insira em ponto estratégico.
- Se houver exemplo trabalhado, as fases seguem a ordem **Contexto → Desafio → Solução → Resultado**.
- Tabelas: só com 2+ linhas reais de dados; conserte ou remova tabelas vazias/quebradas.

## COMO PROCEDER
1. Leia o módulo completo abaixo.
2. **Garanta os invariantes acima** (fechamento, checkpoint, exemplo, tabelas) sem uniformizar os títulos.
3. **Eleve a qualidade:** reescreva os trechos que reprovam em pelo menos 1 dos 6 Critérios, com mais profundidade e especificidade.
4. Mantenha o que já está bom.
5. Retorne o módulo COMPLETO.

## RESTRIÇÕES ABSOLUTAS
- NÃO deixe tabela com só cabeçalho.
- Preserve 100% da correção técnica; NÃO invente fatos novos só para preencher.
- Comece DIRETAMENTE com \`## ${moduleTitle}\` — ZERO preâmbulo, saudação ou explicação antes do conteúdo.
- Mantenha o idioma: ${language}.
- Retorne APENAS o markdown final, sem comentários nem cercas de código.

---

## MÓDULO PARA REVISÃO:

${structuredContent}`;
}

// Generated PER MODULE (not in the structure call) so the structure JSON stays
// small and reliably parseable regardless of module count.
function buildAssessmentPrompt(
  moduleTitle: string,
  moduleSummary: string,
  courseTitle: string,
  theme: string,
  language: string,
  includeQuiz: boolean,
  includeFlashcards: boolean,
): string {
  return `You are an educational assessment designer. Return ONLY valid JSON (no markdown fences, no commentary).

Course: "${courseTitle}" — Theme: "${theme}"
Module: "${moduleTitle}"
Summary: ${moduleSummary}
Language: ${language}

DOMAIN RULE (HARD): every question, option and answer MUST stay strictly within the
technical domain of "${courseTitle}" / "${theme}" and its native ecosystem. For a
programming-language course use ONLY that language; never SQL/Bash/HTML unless that
IS the subject.

Return JSON in EXACTLY this shape:
{
${includeQuiz ? `  "quiz": [{"question": "...", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "..."}]${includeFlashcards ? "," : ""}` : ""}
${includeFlashcards ? `  "flashcards": [{"front": "Pergunta explícita com verbo e ponto de interrogação (?)", "back": "Resposta completa e pedagógica"}]` : ""}
}
${includeQuiz ? "- EXACTLY 3 quiz questions, 4 options each; \"correct\" is the 0-based index of the right option." : ""}
${includeFlashcards ? "- EXACTLY 5 flashcards." : ""}
- Perfect spelling and grammar in ${language}.
- CRITICAL: output a SINGLE, syntactically valid JSON object. No text before or after,
  no markdown fences, no comments, no trailing commas. Escape any double quotes inside
  strings. Keep each string on one line.`;
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
    // Heartbeat: during the long 2.5-pro elevation there are no progress events for
    // ~100s. Without a keepalive the client can't tell "still working" from "died".
    // A 12s heartbeat lets the client watchdog use a short stall timeout.
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      heartbeat = setInterval(() => sendSSE({ type: "heartbeat" }), 12000);
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
      console.log(`[generate-course] BUILD=${GENERATE_COURSE_BUILD} outcome=${body.outcome ?? "-"} level=${body.knowledge_level ?? "-"}`);
      const {
        title: rawTitle, theme, target_audience, tone, language,
        num_modules, include_quiz, include_flashcards, include_images,
        use_sources, density,
      } = body;

      // Detail level → per-module depth. Previously the wizard's "nível de
      // detalhamento" was never sent to the backend, so every course was generated
      // at the same depth. This maps it to target length per module.
      const DEPTH_PROFILES = {
        compact:  { words: "500-700",   label: "conciso (curso rápido)" },
        standard: { words: "800-1200",  label: "equilibrado" },
        detailed: { words: "1300-1800", label: "aprofundado (curso longo)" },
      } as const;
      const depth = DEPTH_PROFILES[(density as keyof typeof DEPTH_PROFILES)] ?? DEPTH_PROFILES.standard;

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
      const limits = TESTING_MODE ? PLAN_LIMITS.pro : PLAN_LIMITS[plan];

      // Check dev status
      const { data: profile, error: profileError } = await serviceClient
        .from("profiles").select("is_dev").eq("user_id", userId).maybeSingle();
      let isDev = profile?.is_dev === true || TESTING_MODE;
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

      // Outcome → capstone type (backward design: the course is architected from
      // the final deliverable backwards). Defaults keep old clients working.
      const OUTCOME_CAPSTONE: Record<string, { capstone: string; label: string }> = {
        introducao:  { capstone: "sintese",        label: "introdução ao tema" },
        aplicacao:   { capstone: "estudo_de_caso", label: "aplicação prática" },
        treinamento: { capstone: "projeto",        label: "treinamento completo" },
        avaliacao:   { capstone: "simulado",       label: "preparação para avaliação" },
      };
      const outcomeKey = (body.outcome as string) in OUTCOME_CAPSTONE ? body.outcome as string : "aplicacao";
      const outcomeInfo = OUTCOME_CAPSTONE[outcomeKey];
      const knowledgeLevel = (body.knowledge_level as string) || "básico";

      const structurePrompt = `You are a senior instructional designer. Architect a course using BACKWARD DESIGN: first decide the final competency and the capstone deliverable, then design the module sequence that builds up to it. Return JSON only.

      STRICT JSON RULE:
      - Return ONLY the JSON object.
      - Do NOT include any markdown formatting like \`\`\`json.
      - Ensure the JSON is valid and NOT truncated.

      CRITICAL HARD CONSTRAINT — MODULE COUNT:
      - You MUST generate EXACTLY ${actualModules} modules. Not fewer, not more.
      - The "modules" array MUST contain exactly ${actualModules} items.

DESIGN BRIEF:
- Desired outcome: ${outcomeInfo.label} → the LAST module MUST be a capstone of type "${outcomeInfo.capstone}".
- Learner's current level: ${knowledgeLevel}. Calibrate where the course STARTS (advanced learners skip basics; absolute beginners need the ground floor).

PEDAGOGICAL ARCHITECTURE RULES (HARD):
1. PROGRESSION, not juxtaposition: each module must USE what previous modules built. Fill "builds_on" with a concrete phrase (e.g. "usa o mapa de riscos do módulo 2"). Module 1 has builds_on = "".
2. Each module gets a "role": "conceito" (builds understanding), "aplicacao" (applies technique), "consolidacao" (integrates prior modules), or "capstone" (final deliverable, LAST module only). A good arc mixes them (e.g. conceito → conceito → aplicacao → aplicacao → consolidacao → capstone). NEVER give all modules the same role.
3. Module titles must be theme-specific and outcome-oriented — NEVER generic labels like "Fundamentos", "Introdução" alone, "Conceitos básicos".
4. "case_thread": invent ONE realistic running scenario (a named organization/person with a concrete problem in this domain) that examples across modules can advance. One sentence.
5. "final_competency": one sentence — what the learner DOES at the end (observable, not "understands").

CRITICAL QUALITY RULES:
- All text must have PERFECT spelling and grammar in ${language || "pt-BR"}.
- Module titles must be complete, grammatically correct phrases.

CRITICAL DOMAIN INTEGRITY (HARD RULE):
- The course is about: "${title}" — Theme: "${theme}".
- ALL module titles, summaries, quizzes, flashcards and any examples MUST stay strictly within this technical domain and its native ecosystem.
- If the course is about a PROGRAMMING LANGUAGE (Python, JavaScript, Java, C#, Go, Ruby, PHP, etc.):
  · Use ONLY that language's syntax, idioms, standard library and ecosystem.
  · NEVER use SQL DDL/DML (CREATE TABLE, ALTER TABLE, INSERT, UPDATE, DELETE, SELECT, JOIN, etc.) unless the course is explicitly about SQL or relational databases.
  · NEVER use shell/Bash, HTML/CSS, or other-language code as examples.
  · A module titled "Data Structures" in a Python course means Python lists/tuples/dicts/sets — NOT SQL tables, columns or schemas.
  · A module titled "Functions" in a Python course means Python def/lambda/decorators — NOT SQL stored procedures.
- If the course is about SQL or a database, do the inverse — stay within SQL.
- Module SUMMARIES must explicitly mention the language/tool by name where possible (e.g. "listas e dicionários em Python", not just "estruturas de dados").
- Each module MUST be coherent with the course title — if you cannot write the module without leaving the domain, rewrite the module title.
${sourcesInstruction}

Course details:
- Title: ${title}
- Theme: ${theme}
- Target audience: ${target_audience || "general"}
- Tone: ${tone || "professional"}
- Language: ${language || "pt-BR"}
- EXACTLY ${actualModules} modules
${use_sources ? "- Base the course structure EXCLUSIVELY on the content in <SOURCES>" : ""}

Return ONLY valid JSON with this structure (quizzes/flashcards are generated
separately per module to keep this JSON small and valid):
{
  "description": "course description",
  "final_competency": "what the learner will be able to DO",
  "case_thread": "one-sentence running scenario",
  "modules": [
    {
      "title": "Theme-specific module title",
      "summary": "brief summary for content generation",
      "role": "conceito | aplicacao | consolidacao | capstone",
      "builds_on": "what this module uses from previous ones (\\"\\" for module 1)"
    }
  ]
}`;

      // Structure is now lightweight (titles + summaries only), so 4000 tokens is
      // ample even for 10 modules — quizzes/flashcards are generated per module later.
      const structureRaw = await callAI("gemini-2.5-flash", structurePrompt, 4000, true);

      const parseStructure = (raw: string): any | null => {
        try {
          const m = raw.match(/\{[\s\S]*\}/);
          return JSON.parse(m ? m[0] : raw.trim());
        } catch {
          return null;
        }
      };

      let structure = parseStructure(structureRaw);

      // One retry covers BOTH a failed parse and a wrong module count.
      if (!structure || !Array.isArray(structure.modules) || structure.modules.length !== actualModules) {
        console.warn(`[generate-course] Structure retry (parsed=${!!structure}, modules=${structure?.modules?.length ?? 0}, expected ${actualModules}).`);
        sendSSE({ type: "status", message: "Ajustando estrutura..." });

        const retryPrompt = `Generate a course structure with EXACTLY ${actualModules} modules for "${title}" (${theme}).
Language: ${language || "pt-BR"}. Target audience: ${target_audience || "general"}. Tone: ${tone || "professional"}.

CRITICAL DOMAIN INTEGRITY (HARD RULE):
- ALL module titles and summaries MUST stay strictly within the technical domain of "${title}" / "${theme}" and its native ecosystem.
- If the course is about a programming language (Python, JavaScript, Java, etc.): use ONLY that language's syntax/idioms/standard library. NEVER use SQL DDL/DML (CREATE TABLE, ALTER TABLE, INSERT, etc.) unless the course is explicitly about SQL/databases.
- Module summaries must cite the language/tool by name when possible.

Return ONLY valid JSON: {"description": "...", "modules": [{"title": "...", "summary": "..."}]} with EXACTLY ${actualModules} items.`;

        const retryRaw = await callAI("gemini-2.5-flash", retryPrompt, 4000, true);
        structure = parseStructure(retryRaw);

        if (!structure) {
          console.error("[generate-course] Structure parse failed twice. Raw length:", retryRaw.length, "start:", retryRaw.substring(0, 300));
          throw new Error("Falha ao processar a estrutura do curso gerada pela IA. Por favor, tente novamente.");
        }
        if (!Array.isArray(structure.modules) || structure.modules.length !== actualModules) {
          throw new Error(`Falha ao gerar exatamente ${actualModules} módulos após nova tentativa.`);
        }
      }

      // Normalize the pedagogical fields: the retry prompt (and any older client)
      // returns only title/summary, so roles/threads get sane inferred defaults.
      const VALID_ROLES: ModuleRole[] = ["conceito", "aplicacao", "consolidacao", "capstone"];
      const inferRole = (i: number, total: number): ModuleRole => {
        if (total === 1) return "aplicacao";
        if (i === total - 1) return "capstone";
        if (i === 0) return "conceito";
        if (total >= 5 && i === total - 2) return "consolidacao";
        return "aplicacao";
      };
      structure.modules = structure.modules.map((m: any, i: number) => ({
        ...m,
        role: VALID_ROLES.includes(m.role) ? m.role as ModuleRole : inferRole(i, structure.modules.length),
        builds_on: typeof m.builds_on === "string" ? m.builds_on : "",
      }));
      const caseThread: string = typeof structure.case_thread === "string" ? structure.case_thread : "";

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

      // Tell the client the courseId EARLY so its watchdog can recover the (partial)
      // course from the DB even if the stream dies before `complete`.
      sendSSE({ type: "course_created", courseId: course.id });

      // Reassign sources
      if (use_sources && body.temp_course_id) {
        await serviceClient.from("course_sources")
          .update({ course_id: course.id })
          .eq("course_id", body.temp_course_id).eq("user_id", userId);
      }

      // ── STAGE 3: Generate content for ALL modules in parallel ──
      // Each module chain (draft → refine → gemini-2.5-pro elevation → assessment)
      // is dominated by the slow ~30-40s 2.5-pro pass. Batching in groups of 3 made a
      // 6-module course run 2 serial batches and exceed the 150s edge-function
      // wall-clock limit (the course got stuck at ~85% when the function was killed).
      // Running every module in one parallel batch keeps total wall-time ≈ a single
      // module chain (~90s), independent of module count (max 10).
      // ── Wall-clock blindagem ──
      // The edge function is killed at ~150s. We track a soft budget and SKIP the
      // optional steps (2.5-pro elevation, quiz) when time runs low, so the function
      // ALWAYS finishes and emits `complete` instead of being killed mid-stream
      // (which froze the UI at e.g. 78%). Module CONTENT is saved early (right after
      // the template) so nothing is ever lost; images run in the BACKGROUND.
      const GEN_START = Date.now();
      const SOFT_DEADLINE_MS = 110000;
      const msLeft = () => SOFT_DEADLINE_MS - (Date.now() - GEN_START);
      const imageTasks: Promise<unknown>[] = [];
      const BATCH_SIZE = structure.modules.length;
      for (let batchStart = 0; batchStart < structure.modules.length; batchStart += BATCH_SIZE) {
        const batch = structure.modules.slice(batchStart, batchStart + BATCH_SIZE);

        await Promise.all(batch.map(async (mod: any, batchIdx: number) => {
          const i = batchStart + batchIdx;
          // Per-module isolation: one module failing/timing out must NEVER abort
          // the whole course (Promise.all would reject). We always advance progress.
          try {

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

          // Brazil localization (pt-BR courses only): adapt examples to local context.
          const brLocalization = (language || "pt-BR").toLowerCase().startsWith("pt")
            ? `\n\nLOCALIZAÇÃO (BRASIL): quando agregar valor e sem forçar, ancore exemplos no contexto brasileiro — regulamentações locais (ex.: LGPD para dados pessoais), referenciais nacionais quando pertinente (ex.: BNCC na educação) e ferramentas/plataformas/empresas usadas no Brasil, além das internacionais. NÃO invente fatos; adapte só quando fizer sentido para o público.`
            : "";

          const contentPrompt = `Write detailed educational content for this module in ${language || "pt-BR"}.

Course: ${title}
Theme: ${theme}
Module ${i + 1} of ${actualModules}: ${mod.title}
Pedagogical role of THIS module: ${mod.role}
${mod.builds_on ? `This module builds on: ${mod.builds_on} — open by connecting to it and USE it in the content.` : "This is the opening module — situate the problem the course solves."}
${caseThread ? `Running scenario of the course (advance it in examples instead of inventing disconnected ones): ${caseThread}` : ""}
Learner level: ${knowledgeLevel} — calibrate depth accordingly (do not re-explain what this level already knows).
Summary: ${mod.summary || mod.title}
Target audience: ${target_audience || "general"}
Tone: ${tone || "professional"}

CRITICAL DOMAIN INTEGRITY (HARD RULE):
- ALL examples, code, terminology and analogies MUST stay strictly inside the technical domain of "${title}" / "${theme}" and its native ecosystem.
- If the course is about a PROGRAMMING LANGUAGE (Python, JavaScript, Java, etc.):
  · Use ONLY that language's syntax, idioms and standard library in code blocks and examples.
  · NEVER use SQL DDL/DML (CREATE TABLE, ALTER TABLE, INSERT, UPDATE, DELETE, SELECT, JOIN, etc.) unless the course is explicitly about SQL/databases.
  · "Data structures" in a Python course = lists, tuples, dicts, sets — NOT SQL tables/columns.
  · "Functions" in a Python course = def, lambda, decorators, *args/**kwargs — NOT SQL stored procedures.
- Learning objectives, key takeaways and bullets MUST cite concrete language-native concepts (e.g. "Manipular listas, dicionários, tuplas e conjuntos em Python") and avoid generic verbs like "Aplicar X" without an application context.
${sourceContentInstruction}${brLocalization}

Write in Markdown format. Include clear introduction, main concepts, examples, key takeaways.
Write ${depth.words} words — nível ${depth.label}. Be thorough and educational.`;

          const rawContent = await callAI("gemini-2.5-flash", contentPrompt, 4000);

          // Step B: Pedagogical refinement (role-aware writer)
          const refinementPrompt = buildRefinementPrompt(
            mod.title, rawContent, language || "pt-BR",
            mod.role as ModuleRole, mod.builds_on || "", caseThread, i, actualModules,
          );
          // 8000 tokens: the full template (now incl. Atividade Prática) for a PT
          // module is long; smaller caps were truncating modules mid-content/table.
          let refined = await callAIMeta("gemini-2.5-flash", refinementPrompt, 8000);
          // Truncation guard: a MAX_TOKENS cut leaves the module ending mid-sentence
          // and silently drops whole sections (the "...proteger dados e oferecer" bug).
          // Retry ONCE with a larger cap; keep whichever output is complete/longer.
          if (refined.finishReason === "length") {
            console.warn(`[generate-course] Refinement truncated for module ${i + 1} → retry (12000 tokens)`);
            try {
              const retry = await callAIMeta("gemini-2.5-flash", refinementPrompt, 12000);
              if (retry.content && (retry.finishReason !== "length" || retry.content.length > refined.content.length)) {
                refined = retry;
              }
            } catch (e: any) {
              console.warn(`[generate-course] Refinement retry failed (non-blocking): ${e?.message || e}`);
            }
          }
          // Strip stray ```fences and the redundant leading "## <title>" heading (the
          // duplicate-title bug), then trim any leftover mid-sentence tail.
          let refinedContent = cleanModuleContent(refined.content, mod.title);
          if (refined.finishReason === "length") refinedContent = repairTruncation(refinedContent);

          // Step D (EARLY SAVE): persist the refined module IMMEDIATELY so its
          // content is never lost if a later optional step times out or is skipped.
          const { data: moduleData, error: moduleError } = await serviceClient
            .from("course_modules")
            .insert({
              course_id: course.id, title: mod.title,
              content: refinedContent, order_index: i,
            })
            .select().single();
          if (moduleError) throw moduleError;

          // Step C: Quality Elevation — best-effort, TIME-BUDGETED, runs in PARALLEL
          // with the assessment below. The 2.5-pro pass needs ~70s, so we only start
          // it when enough budget remains; otherwise we keep the saved refined text.
          // On success it UPDATEs the already-saved module.
          const elevationDone = (async () => {
            if (msLeft() < 65000) {
              console.warn(`[generate-course] Elevation SKIPPED (low budget) for module ${i + 1}`);
              return;
            }
            try {
              console.log(`[generate-course] Quality Elevation: module ${i + 1} "${mod.title}"`);
              const qualityPrompt = buildQualityElevationPrompt(
                mod.title, refinedContent, title,
                target_audience || "profissionais da área", language || "pt-BR",
                theme || "",
              );
              const quality = await callAIMeta("gemini-2.5-pro", qualityPrompt, 8000);
              const strippedFences = quality.content
                .replace(/^```(?:markdown)?\n?/i, "").replace(/\n?```$/i, "").trim();
              const firstHeading = strippedFences.indexOf("\n## ");
              const cleanedQuality = firstHeading > 0
                ? strippedFences.slice(firstHeading).trim()
                : strippedFences;
              const hIdx = cleanedQuality.search(/^## /m);
              const trimmedQuality = hIdx > 0 ? cleanedQuality.slice(hIdx).trim() : cleanedQuality;
              // Same sanitation as the refined path: drop the duplicate leading
              // "## <title>" heading, stray fences, and any truncated tail.
              let finalQuality = cleanModuleContent(trimmedQuality, mod.title);
              if (quality.finishReason === "length") finalQuality = repairTruncation(finalQuality);
              if (finalQuality.length >= refinedContent.length * 0.5) {
                await serviceClient.from("course_modules")
                  .update({ content: finalQuality }).eq("id", moduleData.id);
                console.log(`[generate-course] Quality Elevation OK: ${refinedContent.length} → ${finalQuality.length} chars`);
              } else {
                console.warn(`[generate-course] Quality Elevation too short, keeping refined`);
              }
            } catch (elevationErr: any) {
              console.warn(`[generate-course] Quality Elevation failed (non-blocking): ${elevationErr.message}`);
            }
          })();

          // Run quiz/flashcards AND the illustration CONCURRENTLY (they are
          // independent and both optional). Doing them in series pushed the
          // per-module chain past the edge wall-clock limit, leaving generation
          // stuck at ~78%. Both swallow their own errors (non-blocking).
          const assessmentTask = (async () => {
          if ((include_quiz || include_flashcards) && msLeft() > 15000) {
            const assessmentPrompt = buildAssessmentPrompt(
              mod.title, mod.summary || mod.title, title, theme || "",
              language || "pt-BR", !!include_quiz, !!include_flashcards,
            );
            const parseAssessment = (raw: string): any | null => {
              const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
              try { return JSON.parse(cleaned); } catch { /* fall through */ }
              const m = cleaned.match(/\{[\s\S]*\}/);
              if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
              return null;
            };
            let assessments: any = null;
            for (let attempt = 0; attempt < 2 && !assessments; attempt++) {
              try {
                const assessmentRaw = await callAI("gemini-2.5-flash", assessmentPrompt, 4000, true);
                assessments = parseAssessment(assessmentRaw);
                if (!assessments) console.warn(`[generate-course] Assessment parse failed (attempt ${attempt + 1}) for "${mod.title}"`);
              } catch (assessErr: any) {
                console.warn(`[generate-course] Assessment call failed (attempt ${attempt + 1}) for "${mod.title}": ${assessErr.message}`);
              }
            }
            if (assessments) {
              try {
                if (include_quiz && Array.isArray(assessments.quiz) && assessments.quiz.length > 0) {
                  const quizInserts = assessments.quiz.map((q: any) => ({
                    module_id: moduleData.id, question: q.question,
                    options: q.options, correct_answer: q.correct ?? 0,
                    explanation: q.explanation || null,
                  }));
                  await serviceClient.from("course_quiz_questions").insert(quizInserts);
                }
                if (include_flashcards && Array.isArray(assessments.flashcards) && assessments.flashcards.length > 0) {
                  const fcInserts = assessments.flashcards.map((fc: any) => ({
                    module_id: moduleData.id, front: fc.front, back: fc.back,
                  }));
                  await serviceClient.from("course_flashcards").insert(fcInserts);
                }
              } catch (insErr: any) {
                console.warn(`[generate-course] Assessment insert failed (non-blocking) for "${mod.title}": ${insErr.message}`);
              }
            }
          }
          })();

          // Generate AI image (non-blocking)
          const imageTask = (async () => {
          if (include_images) {
            try {
              const imagePrompt = `Generate a premium, minimalist conceptual illustration evoking the theme "${mod.title}" (course: "${title}") — a clean graphic asset for an educational interface.
Style: flat vector / soft 3D, geometric shapes, smooth matte surfaces, soft gradient colors, modern and elegant, 16:9 aspect, with generous negative space.
Strict design directive: the output is 100% visual, built exclusively from geometric forms, lighting and texture. Any surface that would normally carry writing — screens, signs, book covers, panels, banners — must be rendered as a blank, smooth, matte surface. Keep all negative space intact, empty and clean. Purely visual, non-verbal design — graphics only, with no typography, lettering, numerals, logos, signatures or watermarks.`;

              // Native Gemini 2.5 Flash Image (Nano Banana) via personal GEMINI_API_KEY.
              // Replaces the Lovable gateway. Imagen 4 was avoided (deprecated 2026-08-17).
              const geminiKey = Deno.env.get("GEMINI_API_KEY");
              const imgController = new AbortController();
              const imgTimer = setTimeout(() => imgController.abort(), 45000);
              const imgRes = await fetch(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": geminiKey ?? "",
                  },
                  body: JSON.stringify({
                    contents: [{ parts: [{ text: imagePrompt }] }],
                    generationConfig: {
                      responseModalities: ["IMAGE"],
                      imageConfig: { aspectRatio: "16:9" },
                    },
                  }),
                  signal: imgController.signal,
                },
              ).finally(() => clearTimeout(imgTimer));

              if (imgRes.ok) {
                const imgData = await imgRes.json();
                const parts = imgData.candidates?.[0]?.content?.parts ?? [];
                const imgPart = parts.find((p: { inlineData?: { data?: string; mimeType?: string } }) => p.inlineData?.data);
                if (imgPart?.inlineData?.data) {
                  const base64Data = imgPart.inlineData.data;
                  const binaryData = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
                  const mimeType: string = imgPart.inlineData.mimeType || "image/png";
                  const ext = mimeType.includes("png") ? "png" : "jpg";
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
          })();

          // Image runs in the BACKGROUND (never blocks readiness). We only await the
          // content-critical work: elevation (best-effort) + assessment.
          imageTasks.push(imageTask);
          await Promise.all([elevationDone, assessmentTask]);
          sendSSE({ type: "module_done", module: i + 1, total: actualModules });
          } catch (modErr: any) {
            console.error(`[generate-course] Module ${i + 1} failed (non-blocking): ${modErr?.message || modErr}`);
            sendSSE({ type: "module_done", module: i + 1, total: actualModules });
          }
        }));
      }

      // Flush background images so they finish even after the response closes
      // (best-effort, never blocks course completion).
      if (imageTasks.length) {
        const allImages = Promise.allSettled(imageTasks);
        const wu = (globalThis as any).EdgeRuntime?.waitUntil;
        if (typeof wu === "function") {
          wu.call((globalThis as any).EdgeRuntime, allImages);
        } else {
          try { await Promise.race([allImages, new Promise((r) => setTimeout(r, Math.max(0, msLeft())))]); } catch { /* best-effort */ }
        }
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

      // ── STAGE 5: Quality validation (non-blocking, validate-only) ──
      // Deliberately do NOT rewrite here. The per-module pipeline already applies
      // the pedagogical template (Step B) and elevates the writing on gemini-2.5-pro
      // (Step C). Re-running the template via restructure-modules would overwrite the
      // 2.5-pro output with a cheaper re-format, undoing Step C. So we only request
      // the deterministic quality report (validate_only) and log it.
      try {
        console.log("[generate-course] Invoking restructure-modules (validate_only)...");
        const restructureUrl = `${supabaseUrl}/functions/v1/restructure-modules`;
        fetch(restructureUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": authHeader,
            "apikey": anonKey,
          },
          body: JSON.stringify({ course_id: course.id, validate_only: true }),
        }).then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            console.log("[generate-course] Quality report:", JSON.stringify(data.markdown_quality_report?.summary ?? {}));
          } else {
            console.warn("[generate-course] Quality validation failed:", await res.text());
          }
        }).catch((err) => {
          console.warn("[generate-course] Quality validation error:", err.message);
        });
      } catch (e: any) {
        console.warn("[generate-course] Quality validation error (non-blocking):", e.message);
      }

      // Send completion event
      sendSSE({ type: "complete", courseId: course.id });
      controller?.close();

    } catch (error: any) {
      console.error("Generate course error:", error);
      sendSSE({ type: "error", message: error.message || "Erro interno ao gerar curso" });
      controller?.close();
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  })();

  return new Response(stream, { headers: sseHeaders });
});
