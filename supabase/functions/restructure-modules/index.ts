import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REQUIRED_SECTIONS = [
  { emoji: "🎯", label: "Objetivo do Módulo" },
  { emoji: "🧠", label: "Fundamentos" },
  { emoji: "⚙️", label: "Como funciona" },
  // 🧩 Modelos / Tipos é OPCIONAL — omitida quando não há comparação real
  { emoji: "🛠️", label: "Aplicações reais" },
  { emoji: "💡", label: "Exemplo prático" },
  { emoji: "⚠️", label: "Desafios e cuidados" },
  { emoji: "🧾", label: "Resumo do Módulo" },
  { emoji: "📌", label: "Key Takeaways" },
];

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
   - ### 🧩 Modelos / Tipos — CONDICIONAL: inclua SOMENTE se o conteúdo já contiver 2+ modelos/tipos/categorias DISTINTOS para comparar. Se não existir no conteúdo recebido, OMITA completamente esta seção — não crie título sem conteúdo, não invente categorias. Quando existir: tabela comparativa com 2-4 colunas e 2-5 linhas de dados reais.
   - --- (apenas se a seção 🧩 foi incluída)
   - ### 🛠️ Aplicações reais (MÍNIMO 4 itens distintos, cada um com 1 frase objetiva — se o conteúdo tiver menos de 4, consolide slides/parágrafos próximos para completar)
   - ---
   - ### 💡 Exemplo prático — ORDEM OBRIGATÓRIA e IMUTÁVEL das fases, sempre nesta sequência:
     **Contexto:** (ou **Cenário:**) → **Desafio:** → **Solução:** → **Resultado:**
     PROIBIDO inverter ou embaralhar esta ordem. Se o conteúdo vier em outra ordem, reordene mantendo os textos originais.
   - ---
   - ### ⚠️ Desafios e cuidados (lista de 5 itens máximo)
   - ---
   - > 💭 **Pare um momento e reflita:** (pergunta reflexiva relevante)
   - ---
   - ### 🧾 Resumo do Módulo (1 parágrafo conciso)
   - ---
   - ### 📌 Key Takeaways (mínimo 5, máximo 6 bullets — cada bullet UMA única ideia com verbo no início; PROIBIDO colapsar duas ideias em um bullet com ponto e vírgula ou " e ")

3. **Formatação**:
   - Separadores --- entre TODAS as seções
   - Remova TODA tag HTML (<br>, <div>, etc.)
   - Listas: máximo 5-7 itens
   - Textos corridos: máximo 3-4 parágrafos curtos
   - Tabelas: formato simples com | e max 4-5 linhas de dados
   - Indentação de listas aninhadas: 2 espaços
   - Frases curtas, parágrafos de no máximo 4 linhas

4. **Conteúdo**:
   - Se uma seção OBRIGATÓRIA está faltando, crie-a com base no conteúdo existente
   - A seção 🧩 Modelos/Tipos é OPCIONAL — só crie se o conteúdo já tiver dados comparativos reais
   - Elimine conteúdo redundante
   - Reflexão (💭) SEMPRE após Desafios e ANTES do Resumo
   - Key Takeaways: mínimo 5 bullets, cada um com UMA ideia acionável iniciando com verbo
   - Exemplo prático DEVE ter as 4 fases em ordem FIXA: Contexto/Cenário → Desafio → Solução → Resultado
   - Se o exemplo vier com fases embaralhadas, reordene os blocos mantendo os textos originais

5. **Proibições**:
   - NÃO adicione markdown code blocks ao redor do resultado
   - NÃO explique o que fez
   - NÃO adicione conteúdo que não existia (apenas reorganize e complete seções)
   - NÃO use heading H1 (#) - use apenas H2 (##) para título e H3 (###) para seções`;

// ─── Quality Checklist Validation ───────────────────────────────────────
interface ModuleCheckResult {
  module: number;
  title: string;
  title_unique: boolean;
  sections_complete: boolean;
  missing_sections: string[];
  separators_consistent: boolean;
  example_practical_complete: boolean;
  reflection_position_correct: boolean;
  key_takeaways_count: number;
  lists_within_limit: boolean;
  tables_standardized: boolean;
  html_removed: boolean;
  redundancy_detected: boolean;
  status: "PASS" | "FAIL";
  errors: string[];
}

function validateModuleMarkdown(content: string, moduleIndex: number, title: string): ModuleCheckResult {
  const errors: string[] = [];
  const lines = content.split("\n");

  // 1. Title unique: only one H2
  const h2Count = lines.filter(l => /^## /.test(l)).length;
  const h1Count = lines.filter(l => /^# [^#]/.test(l)).length;
  const titleUnique = h2Count <= 1 && h1Count === 0;
  if (!titleUnique) errors.push(`Títulos duplicados: ${h2Count} H2, ${h1Count} H1`);

  // 2. Check required sections
  const missingSections: string[] = [];
  for (const sec of REQUIRED_SECTIONS) {
    const pattern = new RegExp(`###\\s*${sec.emoji}\\s*${sec.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, "i");
    if (!pattern.test(content)) {
      // Try looser match with just the emoji
      const loosePattern = new RegExp(`###.*${sec.emoji}`, "i");
      if (!loosePattern.test(content)) {
        missingSections.push(`${sec.emoji} ${sec.label}`);
      }
    }
  }
  const sectionsComplete = missingSections.length === 0;
  if (!sectionsComplete) errors.push(`Seções ausentes: ${missingSections.join(", ")}`);

  // 3. Separators: count --- lines, should be >= 8 (between 9+ sections)
  const separatorCount = lines.filter(l => /^---\s*$/.test(l.trim())).length;
  const separatorsConsistent = separatorCount >= 7;
  if (!separatorsConsistent) errors.push(`Separadores insuficientes: ${separatorCount} (min 7)`);

  // 4. Example practical completeness: must have Cenário, Solução, Resultado
  const hasExampleSection = /###.*💡/.test(content);
  let examplePracticalComplete = false;
  if (hasExampleSection) {
    const hasCenario = /\*\*Cenário[:\s]/i.test(content) || /cenário:/i.test(content);
    const hasSolucao = /\*\*Solução[:\s]/i.test(content) || /solução:/i.test(content);
    const hasResultado = /\*\*Resultado[:\s]/i.test(content) || /resultado:/i.test(content);
    examplePracticalComplete = hasCenario && hasSolucao && hasResultado;
    if (!examplePracticalComplete) errors.push("Exemplo prático incompleto (falta cenário/solução/resultado)");
  } else {
    errors.push("Seção de exemplo prático ausente");
  }

  // 5. Reflection position: 💭 should come after ⚠️ and before 🧾
  const reflectionIdx = content.indexOf("💭");
  const challengesIdx = content.indexOf("⚠️");
  const summaryIdx = content.indexOf("🧾");
  const reflectionPositionCorrect = reflectionIdx > -1 && 
    (challengesIdx === -1 || reflectionIdx > challengesIdx) &&
    (summaryIdx === -1 || reflectionIdx < summaryIdx);
  if (!reflectionPositionCorrect) errors.push("Reflexão mal posicionada (deve ficar após Desafios e antes do Resumo)");

  // 6. Key takeaways count
  const ktMatch = content.match(/###.*📌[\s\S]*?(?=\n##|\n---|\n$|$)/);
  let keyTakeawaysCount = 0;
  if (ktMatch) {
    const ktLines = ktMatch[0].split("\n").filter(l => /^\s*[-*]\s/.test(l));
    keyTakeawaysCount = ktLines.length;
  }
  if (keyTakeawaysCount < 5 || keyTakeawaysCount > 7) {
    errors.push(`Key Takeaways: ${keyTakeawaysCount} itens (esperado 5-7)`);
  }

  // 7. Lists within limit (no list > 7 items)
  let listsWithinLimit = true;
  let currentListCount = 0;
  for (const line of lines) {
    if (/^\s*[-*]\s/.test(line)) {
      currentListCount++;
      if (currentListCount > 7) {
        listsWithinLimit = false;
        break;
      }
    } else if (line.trim() !== "") {
      currentListCount = 0;
    }
  }
  if (!listsWithinLimit) errors.push("Lista com mais de 7 itens detectada");

  // 8. Tables standardized (pipe format, max 5 data rows)
  let tablesStandardized = true;
  const tableRows = lines.filter(l => /^\|/.test(l.trim()));
  if (tableRows.length > 0) {
    // Count data rows (exclude header and separator)
    const dataRows = tableRows.filter(l => !/^[\|\s-]+$/.test(l.trim()));
    // Subtract header row
    const dataCount = Math.max(0, dataRows.length - 1);
    if (dataCount > 5) {
      tablesStandardized = false;
      errors.push(`Tabela com ${dataCount} linhas de dados (max 5)`);
    }
  }

  // 9. HTML removed
  const htmlRemoved = !/<[a-z][^>]*>/i.test(content);
  if (!htmlRemoved) errors.push("Tags HTML detectadas no conteúdo");

  // 10. Redundancy: simple heuristic - check for duplicate paragraphs
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 50);
  let redundancyDetected = false;
  for (let i = 0; i < paragraphs.length; i++) {
    for (let j = i + 1; j < paragraphs.length; j++) {
      if (paragraphs[i].trim() === paragraphs[j].trim()) {
        redundancyDetected = true;
        break;
      }
    }
    if (redundancyDetected) break;
  }
  if (redundancyDetected) errors.push("Conteúdo redundante detectado");

  const status: "PASS" | "FAIL" = errors.length === 0 ? "PASS" : "FAIL";

  return {
    module: moduleIndex + 1,
    title,
    title_unique: titleUnique,
    sections_complete: sectionsComplete,
    missing_sections: missingSections,
    separators_consistent: separatorsConsistent,
    example_practical_complete: examplePracticalComplete,
    reflection_position_correct: reflectionPositionCorrect,
    key_takeaways_count: keyTakeawaysCount,
    lists_within_limit: listsWithinLimit,
    tables_standardized: tablesStandardized,
    html_removed: htmlRemoved,
    redundancy_detected: redundancyDetected,
    status,
    errors,
  };
}

async function callLLM(prompt: string, content: string): Promise<string> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) throw new Error("GEMINI_API_KEY não configurada.");

  const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  const model = "gemini-2.0-flash"; 

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${geminiKey}`,
    },
    body: JSON.stringify({
      model,
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

    const body = await req.json();
    const { course_id, validate_only } = body;
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

    // ─── VALIDATE ONLY MODE ─────────────────────────────────────────
    if (validate_only) {
      const checkResults = modules.map((mod, i) => validateModuleMarkdown(mod.content || "", i, mod.title));
      const passed = checkResults.filter(r => r.status === "PASS").length;
      const failed = checkResults.filter(r => r.status === "FAIL").length;
      const criticalErrors = [...new Set(checkResults.flatMap(r => r.errors))];

      return new Response(JSON.stringify({
        markdown_quality_report: {
          course_title: course.title,
          modules_checked: modules.length,
          results: checkResults,
          summary: {
            modules_passed: passed,
            modules_failed: failed,
            critical_errors: criticalErrors,
            recommendation: failed > 0
              ? "Corrigir módulos com FAIL antes da exportação para PPTX."
              : "Todos os módulos passaram. Pronto para exportação.",
          },
        },
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── RESTRUCTURE + VALIDATE LOOP ────────────────────────────────
    const results: { module_id: string; title: string; status: string; error?: string; validation?: ModuleCheckResult }[] = [];

    for (const mod of modules) {
      try {
        console.log(`[Restructure] Processing module: ${mod.title}`);
        const restructured = await callLLM(TEMPLATE_PROMPT, mod.content || "");
        
        if (!restructured || restructured.length < 100) {
          results.push({ module_id: mod.id, title: mod.title, status: "skipped", error: "LLM returned empty/short content" });
          continue;
        }

        // Validate the restructured content
        const moduleIdx = modules.indexOf(mod);
        const validation = validateModuleMarkdown(restructured, moduleIdx, mod.title);

        // Update module content regardless (it's always better than before)
        const { error: updateErr } = await serviceClient
          .from("course_modules")
          .update({ content: restructured, updated_at: new Date().toISOString() })
          .eq("id", mod.id);

        if (updateErr) {
          results.push({ module_id: mod.id, title: mod.title, status: "error", error: updateErr.message, validation });
        } else {
          results.push({ module_id: mod.id, title: mod.title, status: validation.status === "PASS" ? "ok" : "warn", validation });
        }
      } catch (err: any) {
        console.error(`[Restructure] Error on module ${mod.title}:`, err);
        results.push({ module_id: mod.id, title: mod.title, status: "error", error: err.message });
      }
    }

    const successCount = results.filter(r => r.status === "ok").length;
    const warnCount = results.filter(r => r.status === "warn").length;
    const allValidations = results.filter(r => r.validation).map(r => r.validation!);
    const criticalErrors = [...new Set(allValidations.flatMap(v => v.errors))];

    return new Response(JSON.stringify({
      message: `${successCount}/${modules.length} módulos PASS, ${warnCount} com warnings`,
      results,
      markdown_quality_report: {
        course_title: course.title,
        modules_checked: modules.length,
        results: allValidations,
        summary: {
          modules_passed: successCount,
          modules_failed: modules.length - successCount,
          critical_errors: criticalErrors,
          recommendation: warnCount > 0 || criticalErrors.length > 0
            ? "Corrigir módulos com FAIL antes da exportação para PPTX."
            : "Todos os módulos passaram. Pronto para exportação.",
        },
      },
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
