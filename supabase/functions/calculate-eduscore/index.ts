import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Versão dos critérios. Precisa mudar sempre que um critério for alterado:
// é ela que impede comparar uma nota antiga com uma nova sem perceber que
// quem mudou foi a régua, e não o curso.
//
// 2026-08-12: "Fórmula / Cálculo" virou "Procedimento Passo a Passo" (o
// critério anterior cobrava vocabulário de finanças de todo curso e dava
// ponto por acidente morfológico, casando dentro de "reformulação"); o
// Equilíbrio deixou de contar a visão geral e as seções do capstone, que o
// renderizador acrescenta e que faziam o curso ser punido pelo próprio
// formato.
//
// 2026-08-14: Clareza deixou de usar o índice Flesch cru como nota (ver
// clarityScore — 45 é prosa jornalística nessa fórmula, e o critério media a
// morfologia do português em vez da escrita); Engajamento passou a contar
// BLOCOS pedagógicos em vez de linhas com palavras-chave, que subestimava
// justamente os cursos mais práticos. Notas desta versão NÃO são comparáveis
// com as anteriores — as duas mudanças elevam o resultado de um mesmo curso.
const EDUSCORE_CRITERIA_VERSION = "2026-08-14";

// ── Flesch Reading Ease adapted for Portuguese ──
// Devolve o índice CRU, que pode ser negativo. Convertê-lo em nota é trabalho
// de clarityScore() — ver a nota longa lá sobre por que os dois não podem ser
// a mesma coisa.
function fleschPT(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const syllables = words.reduce((acc, w) => acc + countSyllablesPT(w), 0);
  if (sentences.length === 0 || words.length === 0) return 50;
  const asl = words.length / sentences.length;
  const asw = syllables / words.length;
  // Flesch-Kincaid adapted for Portuguese (Martins et al.)
  return Math.round(248.835 - 1.015 * asl - 84.6 * asw);
}

/**
 * Converte o índice Flesch cru em nota de clareza.
 *
 * O índice era usado DIRETAMENTE como nota de 0 a 100, e isso media a
 * morfologia do português, não a qualidade da escrita. O termo dominante da
 * fórmula é 84,6 × sílabas-por-palavra, e o português tem 2,2 a 2,4 sílabas por
 * palavra por natureza — só isso subtrai cerca de 190 pontos antes de qualquer
 * consideração sobre como o texto foi escrito.
 *
 * Medido com a própria fórmula, em textos de dificuldade conhecida:
 *
 *     infantil, frases curtíssimas ...... 120
 *     manual de instruções ..............  59
 *     prosa jornalística comum ..........  45
 *     acadêmico denso ................... −57
 *
 * Ou seja: 45 é jornal. Um curso que pontuava 48 era rotulado "Regular" e
 * recebia a sugestão de "simplificar frases longas" — quando lia como uma
 * notícia de economia, que é exatamente o alvo para material didático adulto.
 * Com peso de 25% num critério que na prática não passa de ~55 em português,
 * o EduScore tinha teto por construção em torno de 85.
 *
 * A faixa-alvo é 35–65: prosa instrucional adulta. Abaixo disso o texto fica
 * denso demais; acima, raso demais para público profissional — os dois extremos
 * são penalizados, porque simplificar em excesso também é defeito.
 */
const CLARITY_ANCHORS: Array<[number, number]> = [
  [-40, 10],
  [0, 28],
  [20, 58],
  [35, 78],
  [48, 90],
  [62, 92],
  [72, 88],
  [85, 72],
  [110, 50],
];

function clarityScore(raw: number): number {
  const a = CLARITY_ANCHORS;
  if (raw <= a[0][0]) return a[0][1];
  if (raw >= a[a.length - 1][0]) return a[a.length - 1][1];
  for (let i = 0; i < a.length - 1; i++) {
    const [x0, y0] = a[i];
    const [x1, y1] = a[i + 1];
    if (raw >= x0 && raw <= x1) {
      const t = x1 === x0 ? 0 : (raw - x0) / (x1 - x0);
      return Math.round(y0 + t * (y1 - y0));
    }
  }
  return 50;
}

function countSyllablesPT(word: string): number {
  const w = word.toLowerCase().replace(/[^a-záéíóúâêîôûãõç]/g, "");
  if (w.length <= 2) return 1;
  const vowelGroups = w.match(/[aeiouáéíóúâêîôûãõ]+/gi);
  return vowelGroups ? Math.max(1, vowelGroups.length) : 1;
}

// ── Pedagogical section detection (v2026 — matches current content format) ──
// The old emoji markers (🎯 Objetivo, 🧠 Fundamentos, etc.) were replaced by the
// new template format. This version detects what the AI actually generates today.
const REQUIRED_SECTION_CHECKS: Array<{ name: string; test: (c: string) => boolean }> = [
  // 1. Key takeaways — template always emits 📌 as closing bullets
  { name: "📌 Pontos-chave",
    test: (c) => c.includes("📌") || /pontos-chave|pontos finais|takeaway/i.test(c) },

  // 2. Reflection checkpoint — "Pare e reflita", 💭, checkpoint
  { name: "💭 Reflexão",
    test: (c) => c.includes("💭") || /pare e reflita|checkpoint|reflita sobre|momento de reflex/i.test(c) },

  // 3. Worked example — any practical demonstration; template uses contextual titles
  //    "Exemplo Prático", "Vamos à prática", "Calculando o X", "O Caso de X",
  //    "Na prática", "vejamos", "Exemplo:", "Aplicando", caso prático
  { name: "Exemplo Prático",
    test: (c) => /exemplo pr[áa]tico|vamos [aà] pr[aá]tica|na pr[aá]tica|calculando o |o caso d[aeo] |vejamos|exemplo:|aplicando na|caso pr[aá]tico|veja como/i.test(c) },

  // 4. Learner activity — explicit exercise, challenge or "try this"
  { name: "Atividade Prática",
    test: (c) => /atividade pr[aá]tica|desafio|exerc[ií]cio|tente voc[eê]|pratique|coloque em pr[aá]tica|sua vez|tente agora|fa[çc]a voc[eê]/i.test(c) },

  // 5. Motivation — "Por Que", intro sections, importance framing
  //    Also catches: "A importância de", "Entender X é fundamental", "Por isso"
  { name: "Por Que / Motivação",
    test: (c) => /por que[\s?]|por qu[eê]|import[âa]ncia de|por isso [eé]|entender (por que|o motivo)|a raz[ãa]o|[eé] fundamental (entender|compreender|conhecer)|sem (isso|esse conhecimento)/i.test(c) },

  // 6. Table — markdown table (| col | col |---|)
  { name: "Tabela Comparativa",
    test: (c) => c.includes("|---|") || c.includes("| ---") || /\|.+\|.+\|/.test(c) },

  // 7. Procedimento passo a passo — uma sequência acionável que o aluno executa.
  //
  //    Antes este critério se chamava "Fórmula / Cálculo" e procurava por
  //    "CVU =", "ponto de equilíbrio", "margem de contribuição", "markup" e
  //    "R$": vocabulário de curso de FINANÇAS, cobrado de todo curso. Um curso
  //    de gestão de conflitos não tem nada disso — e ainda assim passava, por
  //    causa de /f[oó]rmula/ sem fronteira de palavra, que casa dentro de
  //    "REFORMULAção" e no verbo "ele FORMULA sua mensagem". O critério dava
  //    ponto por acidente morfológico do português, não por mérito do conteúdo.
  //
  //    A troca mede algo que todo curso aplicado deve ter: um procedimento
  //    ordenado. A fórmula continua contando, mas só na acepção substantiva —
  //    "fórmula" é sempre acentuada em português e o verbo "formula" não é, e é
  //    esse acento que separa os dois casos.
  { name: "Procedimento Passo a Passo",
    test: (c) =>
      // lista numerada com pelo menos 3 passos
      (c.match(/^\s*\d+[.)]\s+\S/gm) || []).length >= 3
      || /\bpasso a passo\b|\bprimeiro passo\b|\bcomo fazer\b|\bprocedimento\b|\betapa \d/i.test(c)
      // fórmula ou cálculo de verdade, para domínios quantitativos
      || /\bfórmulas?\b|\bc[aá]lculo de\b|=\s*r\$|\bponto de equil[ií]brio\b|\bmargem de contribui/i.test(c) },

  // 8. Context / Scenario / Case study
  //    "O Caso da X", "Estudo de Caso", "cenário", "contexto", intro framing
  { name: "Contexto / Cenário",
    test: (c) => /contexto|cen[áa]rio|estudo de caso|o caso d[aeo] |caso da empresa|neste m[oó]dulo|ao longo deste|nesta aula/i.test(c) },

  // 9. Structured sections — at least 2 ## or ### headings, OR 3+ bold title lines
  { name: "Seções Estruturadas",
    test: (c) => (c.match(/^#{2,3} /gm) || []).length >= 2
             || (c.match(/^\*\*[A-ZÁÉÍÓÚÀÃÕÂÊÔÇ][^*]{5,}\*\*$/gm) || []).length >= 3 },

  // 10. Summary / Conclusion — explicit closing paragraph DISTINCT from 📌 bullets.
  //     Catches: "Resumo", "Conclusão", "Próximos Passos", "Neste módulo vimos/aprendemos",
  //     "Em síntese", "Para encerrar", "Encerrando", "Em resumo"
  //     NOTE: intentionally does NOT alias 📌 — that is Section 1. A well-formed module
  //     should have a closing narrative (Resumo) AND key-takeaway bullets (📌).
  { name: "Resumo / Conclusão",
    // A alternativa original escrevia "resumo" com um "o" CIRÍLICO (U+043E) no
    // lugar do latino (U+006F): homóglifo invisível em revisão, que nunca
    // casava. Sem efeito prático — "resumo:" e "em resumo" cobriam o caso —
    // mas era código morto que ninguém enxergaria. O arquivo agora não tem
    // nenhum caractere cirílico, então um grep por eles volta vazio.
    test: (c) => /conclus[ãa]o|\bresumos?\b|em resumo|resumindo|pr[óo]ximos passos|neste m[oó]dulo (vimos|aprendemos|voc[eê])|o que aprendemos|passamos por|para encerrar|encerrando|em s[ií]ntese|em suma/i.test(c) },
];

// Keep backward-compat array for display
const REQUIRED_SECTIONS = REQUIRED_SECTION_CHECKS.map((s) => s.name);

function detectSections(content: string): string[] {
  return REQUIRED_SECTION_CHECKS.filter((s) => s.test(content)).map((s) => s.name);
}

// ── Engajamento: prática medida por BLOCO, não por linha ──
//
// A versão anterior contava LINHAS que contivessem palavras como "exemplo",
// "caso" ou "atividade". Isso tinha um viés estrutural que subestimava
// justamente os cursos mais práticos: prosa é densa em linhas e prática é
// esparsa. Um template preenchível de oito linhas quase não contém aquelas
// palavras, enquanto oito parágrafos expositivos contam oito linhas. Um curso
// com dez templates preenchíveis pontuava 66 sobre "163 linhas práticas contra
// 750 teóricas" — números que descrevem a forma do markdown, não a pedagogia.
//
// Agora contamos os ARTEFATOS que o pipeline realmente emite, pelos rótulos
// exatos com que os renderiza. Duas metades:
//
//   densidade (60%) — artefatos por lição. O alvo é 1,5: mais de um por lição,
//     com folga, porque uma lição pode carregar exemplo E atividade.
//   variedade (40%) — quantos dos quatro formatos aparecem no curso. Dez
//     atividades e nada mais não é um curso engajante, é um caderno de
//     exercícios; o aluno precisa também ver o especialista resolver
//     (exemplo trabalhado), decidir sob incerteza (cenário) e escrever com as
//     próprias palavras (questão de aplicação).
const PRACTICE_BLOCKS: Array<[string, RegExp]> = [
  // Template preenchível: a tabela "Campo | Orientação | Seu caso".
  ["atividade", /\|\s*Campo\s*\|\s*Orienta[çc][ãa]o\s*\|/gi],
  // Exemplo trabalhado: sempre abre com "**Contexto:**".
  ["exemplo", /\*\*Contexto:\*\*/g],
  // Cenário interativo: fecha com o checklist de decisão.
  ["cenario", /\*\*Checklist de decis[ãa]o\*\*/gi],
  // Questão dissertativa com resposta-modelo.
  ["questao", /###\s*Quest[ãa]o de aplica[çc][ãa]o/gi],
];

const LESSON_HEADING_RE = /^###\s+\d+\.\d+\s+\S/gm;

function engagementScore(content: string): {
  score: number;
  details: { examples: number; theory: number; porTipo: Record<string, number>; licoes: number };
} {
  const porTipo: Record<string, number> = {};
  let total = 0;
  for (const [nome, re] of PRACTICE_BLOCKS) {
    const n = (content.match(re) ?? []).length;
    porTipo[nome] = n;
    total += n;
  }
  const licoes = (content.match(LESSON_HEADING_RE) ?? []).length || 1;

  const densidade = Math.min(100, (total / licoes / 1.5) * 100);
  const tiposPresentes = Object.values(porTipo).filter((n) => n > 0).length;
  const variedade = (tiposPresentes / PRACTICE_BLOCKS.length) * 100;
  const score = Math.max(0, Math.min(100, Math.round(densidade * 0.6 + variedade * 0.4)));

  // `examples` e `theory` seguem no retorno porque a interface os exibe. Agora
  // significam o que o nome diz: blocos de prática, e lições sem nenhum.
  return {
    score,
    details: { examples: total, theory: Math.max(0, licoes - total), porTipo, licoes },
  };
}

// ── Corpo pedagógico de um módulo ──
//
// O Markdown de um módulo não contém só as lições. O renderizador acrescenta,
// por desenho:
//   - a visão geral do curso, SÓ no primeiro módulo;
//   - a atividade aplicada, a rubrica e as leituras, SÓ no capstone;
//   - referências e pontos-chave, no fim de todos.
//
// Medir o comprimento bruto fazia o critério de Equilíbrio punir o curso por
// uma assimetria que o próprio renderizador cria: o módulo 1 e o último sempre
// seriam "grandes demais", por mais equilibrado que o autor fosse.
//
// Este recorte fica com o intervalo que vai da primeira lição até o checkpoint,
// que é o marcador estável logo após o conteúdo das lições.
function lessonBody(content: string): string {
  const c = content || "";
  const start = c.search(/^### \d+\.\d+ /m);
  if (start < 0) return c;
  let body = c.slice(start);
  const checkpoint = body.search(/^> 💭 \*\*Pare um momento e reflita:\*\*/m);
  if (checkpoint > 0) return body.slice(0, checkpoint);
  const rule = body.search(/^---$/m);
  return rule > 0 ? body.slice(0, rule) : body;
}

// ── Balance: content distribution across modules ──
function balanceScore(modules: { content: string }[]): { score: number; stdDev: number; avgLength: number } {
  if (modules.length <= 1) return { score: 100, stdDev: 0, avgLength: lessonBody(modules[0]?.content || "").length };
  const lengths = modules.map((m) => lessonBody(m.content || "").length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((acc, l) => acc + Math.pow(l - avg, 2), 0) / lengths.length;
  const stdDev = Math.sqrt(variance);
  // Coefficient of variation — lower is better
  const cv = avg > 0 ? stdDev / avg : 0;
  // Score: CV of 0 = 100, CV of 1+ = 0
  const score = Math.max(0, Math.round(100 - cv * 100));
  return { score, stdDev: Math.round(stdDev), avgLength: Math.round(avg) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { course_id } = await req.json();
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Autorização ──────────────────────────────────────────────────────────
    // Esta função roda com a service role key, que ignora RLS e enxerga o banco
    // inteiro. Antes ela aceitava qualquer course_id e respondia: quem tivesse
    // um UUID obtinha o título e as métricas de qualidade de curso alheio.
    //
    // Ligar verify_jwt no config.toml não bastaria: quando não há sessão, o
    // supabase.functions.invoke manda a anon key como Bearer, e a anon key é um
    // JWT válido — passaria no gateway. A checagem tem que ser aqui, resolvendo
    // o usuário e comparando com o dono do curso. O `sub` só existe em token de
    // usuário, então a anon key não passa neste ponto.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(
      authHeader.replace(/^Bearer\s+/i, ""),
    );
    const userId = claimsData?.claims?.sub as string | undefined;
    if (claimsErr || !userId) {
      return new Response(JSON.stringify({ error: "Sessão inválida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch course + modules
    const { data: course, error: courseErr } = await supabase
      .from("courses")
      .select("id, title, description, user_id")
      .eq("id", course_id)
      .single();
    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Curso não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (course.user_id !== userId) {
      // 404, e não 403: responder "existe, mas não é seu" já confirmaria a
      // existência do curso para quem estivesse varrendo UUIDs.
      console.warn(
        `[calculate-eduscore] Acesso negado: usuário ${userId} pediu curso ${course_id}.`,
      );
      return new Response(JSON.stringify({ error: "Curso não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: modules } = await supabase
      .from("course_modules")
      .select("id, title, content, order_index")
      .eq("course_id", course_id)
      .order("order_index");

    if (!modules || modules.length === 0) {
      return new Response(JSON.stringify({ error: "Curso sem módulos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 1. Clareza (Flesch) ──
    const allContent = modules.map((m) => m.content || "").join("\n\n");
    // O índice cru e a NOTA são coisas diferentes: o primeiro mede a
    // morfologia do texto, a segunda julga se ele está no ponto para o público.
    const fleschRaw = fleschPT(allContent);
    const fleschScore = clarityScore(fleschRaw);

    // ── 2. Completude (sections covered) ──
    const moduleAnalysis = modules.map((m) => {
      const sections = detectSections(m.content || "");
      return {
        module: m.order_index + 1,
        title: m.title,
        sectionsFound: sections.length,
        totalSections: REQUIRED_SECTION_CHECKS.length,
        missingSections: REQUIRED_SECTION_CHECKS.filter((s) => !s.test(m.content || "")).map((s) => s.name),
      };
    });
    const avgCompletude = Math.round(
      moduleAnalysis.reduce((acc, m) => acc + (m.sectionsFound / m.totalSections) * 100, 0) / moduleAnalysis.length
    );

    // ── 3. Engajamento ──
    const eng = engagementScore(allContent);

    // ── 4. Equilíbrio ──
    const bal = balanceScore(modules.map((m) => ({ content: m.content || "" })));

    // ── Overall EduScore ──
    const overallScore = Math.round(
      fleschScore * 0.25 + avgCompletude * 0.30 + eng.score * 0.25 + bal.score * 0.20
    );

    // ── AI Suggestions ──
    const suggestions: string[] = [];
    // Os gatilhos passam a olhar o índice CRU contra a faixa-alvo do português
    // (35–65). O limiar antigo de 50 sobre a nota disparava em quase todo texto
    // adulto — prosa jornalística pontua 45 nesta fórmula.
    if (fleschRaw < 25) suggestions.push("Frases longas e vocabulário denso: quebre períodos e prefira termos do dia a dia do aluno.");
    if (fleschRaw > 75) suggestions.push("O texto está simplificado demais para público profissional — vale incorporar a terminologia da área.");
    if (avgCompletude < 70) {
      // A anotação precisa estar NA VARIÁVEL, não só no valor inicial do reduce.
      // `createClient` é chamado sem o genérico Database, então `modules` sai
      // como `any`, e o `any` se propaga por map/flatMap/reduce — o `as` no
      // acumulador é descartado junto. Com a cadeia em `any`, Object.entries
      // cai na sobrecarga genérica e infere `unknown` nos valores, o que quebra
      // a subtração do sort abaixo. Declarar o tipo aqui corta a propagação.
      const commonMissing: Record<string, number> = moduleAnalysis
        .flatMap((m: { missingSections: string[] }) => m.missingSections)
        .reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {} as Record<string, number>);
      const topMissing = Object.entries(commonMissing).sort((a, b) => b[1] - a[1]).slice(0, 3);
      suggestions.push(`Seções mais ausentes: ${topMissing.map(([s]) => s).join(", ")}. Adicione-as para completude.`);
    }
    if (eng.score < 40) suggestions.push("Aumente exemplos práticos e cenários reais — a relação teoria/prática está desequilibrada.");
    if (bal.score < 60) suggestions.push(`Módulos com tamanhos muito diferentes (desvio: ${bal.stdDev} chars). Redistribua o conteúdo.`);
    if (modules.length < 3) suggestions.push("Cursos com menos de 3 módulos têm menor retenção. Considere expandir.");
    if (suggestions.length === 0) suggestions.push("Excelente! O curso atende todos os critérios de qualidade pedagógica.");

    const result = {
      course_title: course.title,
      overall_score: overallScore,
      dimensions: {
        clareza: {
          score: fleschScore,
          raw: fleschRaw,
          label: "Clareza",
          description: "Legibilidade Flesch adaptada para PT-BR",
          icon: "📖",
        },
        completude: {
          score: avgCompletude,
          label: "Completude",
          description: `${REQUIRED_SECTION_CHECKS.length} seções pedagógicas avaliadas`,
          icon: "✅",
        },
        engajamento: {
          score: eng.score,
          label: "Engajamento",
          description: `${eng.details.examples} linhas práticas / ${eng.details.theory} teóricas`,
          icon: "🎯",
        },
        equilibrio: {
          score: bal.score,
          label: "Equilíbrio",
          description: `Média ${bal.avgLength} chars/módulo, σ=${bal.stdDev}`,
          icon: "⚖️",
        },
      },
      module_details: moduleAnalysis,
      suggestions,
      modules_count: modules.length,
    };

    // ── Persistência ─────────────────────────────────────────────────────────
    // Grava o resultado para que exista histórico: sem isto a nota some ao
    // fechar a tela e não há como saber se uma revisão do curso melhorou algo.
    // Best-effort de propósito — se a tabela ainda não existir ou a escrita
    // falhar, o usuário continua recebendo a análise. Errar aqui não pode
    // custar a resposta.
    let computedAt: string | null = null;
    try {
      const { data: saved, error: saveError } = await supabase
        .from("course_quality_scores")
        .insert({
          course_id,
          overall_score: overallScore,
          dimensions: result.dimensions,
          suggestions,
          modules_count: modules.length,
          criteria_version: EDUSCORE_CRITERIA_VERSION,
        })
        .select("created_at")
        .single();
      if (saveError) {
        console.log(
          `[calculate-eduscore] Histórico indisponível: ${saveError.message}`,
        );
      } else {
        computedAt = saved?.created_at ?? null;
      }
    } catch (saveErr: any) {
      console.log(
        `[calculate-eduscore] Falha ao gravar histórico: ${saveErr?.message || saveErr}`,
      );
    }

    // Nota anterior, para o front conseguir mostrar a variação. Só compara
    // dentro da MESMA versão de critérios — comparar entre versões diferentes
    // mediria a mudança da régua, não a do curso.
    let previousScore: number | null = null;
    try {
      // As duas mais recentes: a [0] é a que acabou de ser gravada acima, a [1]
      // é a anterior. Buscar duas e indexar é mais portátil que range(1,1).
      const { data: prev } = await supabase
        .from("course_quality_scores")
        .select("overall_score")
        .eq("course_id", course_id)
        .eq("criteria_version", EDUSCORE_CRITERIA_VERSION)
        .order("created_at", { ascending: false })
        .limit(2);
      previousScore = prev?.[1]?.overall_score ?? null;
    } catch {
      // Histórico é conveniência; a análise atual não depende dele.
    }

    return new Response(JSON.stringify({
      ...result,
      criteria_version: EDUSCORE_CRITERIA_VERSION,
      computed_at: computedAt,
      previous_score: previousScore,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("calculate-eduscore error:", err);
    return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
