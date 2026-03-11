import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Flesch Reading Ease adapted for Portuguese ──
function fleschPT(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const syllables = words.reduce((acc, w) => acc + countSyllablesPT(w), 0);
  if (sentences.length === 0 || words.length === 0) return 50;
  const asl = words.length / sentences.length;
  const asw = syllables / words.length;
  // Flesch-Kincaid adapted for Portuguese (Martins et al.)
  const score = 248.835 - 1.015 * asl - 84.6 * asw;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function countSyllablesPT(word: string): number {
  const w = word.toLowerCase().replace(/[^a-záéíóúâêîôûãõç]/g, "");
  if (w.length <= 2) return 1;
  const vowelGroups = w.match(/[aeiouáéíóúâêîôûãõ]+/gi);
  return vowelGroups ? Math.max(1, vowelGroups.length) : 1;
}

// ── Pedagogical section detection ──
const REQUIRED_SECTIONS = [
  "🎯 Objetivo",
  "🧠 Fundamentos",
  "⚙️ Como funciona",
  "🧩 Modelos",
  "🛠️ Aplicações reais",
  "💡 Exemplo prático",
  "⚠️ Desafios",
  "💭 Reflexão",
  "🧾 Resumo",
  "📌 Key Takeaways",
];

function detectSections(content: string): string[] {
  return REQUIRED_SECTIONS.filter((s) => {
    const emoji = s.split(" ")[0];
    const keyword = s.split(" ").slice(1).join(" ").toLowerCase();
    return content.includes(emoji) || content.toLowerCase().includes(keyword);
  });
}

// ── Engagement: theory vs practical ratio ──
function engagementScore(content: string): { score: number; details: { examples: number; theory: number } } {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const practicalKeywords = /exemplo|caso|cenário|prática|aplicação|resultado|solução|exercício|atividade/i;
  const examples = lines.filter((l) => practicalKeywords.test(l)).length;
  const theory = lines.length - examples;
  // Ideal ratio: 30-40% practical
  const ratio = lines.length > 0 ? examples / lines.length : 0;
  // Score peaks at 0.35 ratio
  const distance = Math.abs(ratio - 0.35);
  const score = Math.max(0, Math.round(100 - distance * 200));
  return { score, details: { examples, theory } };
}

// ── Balance: content distribution across modules ──
function balanceScore(modules: { content: string }[]): { score: number; stdDev: number; avgLength: number } {
  if (modules.length <= 1) return { score: 100, stdDev: 0, avgLength: modules[0]?.content?.length || 0 };
  const lengths = modules.map((m) => (m.content || "").length);
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
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch course + modules
    const { data: course, error: courseErr } = await supabase
      .from("courses")
      .select("id, title, description")
      .eq("id", course_id)
      .single();
    if (courseErr || !course) {
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
    const fleschScore = fleschPT(allContent);

    // ── 2. Completude (sections covered) ──
    const moduleAnalysis = modules.map((m) => {
      const sections = detectSections(m.content || "");
      return {
        module: m.order_index + 1,
        title: m.title,
        sectionsFound: sections.length,
        totalSections: REQUIRED_SECTIONS.length,
        missingSections: REQUIRED_SECTIONS.filter((s) => !sections.includes(s)),
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
    if (fleschScore < 50) suggestions.push("Simplifique frases longas e use vocabulário mais acessível para melhorar a legibilidade.");
    if (fleschScore > 80) suggestions.push("O texto está muito simplificado — considere adicionar termos técnicos relevantes.");
    if (avgCompletude < 70) {
      const commonMissing = moduleAnalysis
        .flatMap((m) => m.missingSections)
        .reduce((acc: Record<string, number>, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {});
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
          label: "Clareza",
          description: "Legibilidade Flesch adaptada para PT-BR",
          icon: "📖",
        },
        completude: {
          score: avgCompletude,
          label: "Completude",
          description: `${REQUIRED_SECTIONS.length} seções pedagógicas avaliadas`,
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

    return new Response(JSON.stringify(result), {
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
