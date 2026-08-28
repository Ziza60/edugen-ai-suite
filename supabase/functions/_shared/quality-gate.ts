// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — Portão de qualidade estrutural
//
// POR QUE ISTO EXISTE
//
// O controle de qualidade dos cursos gerados era manual: alguém abria o PDF e
// procurava defeitos. Isso encontrou coisas reais — marcadores crus no texto,
// módulos sem prática, tabelas ilegíveis, passos que saíram como "1." —, mas
// não escala e não protege o cliente final: um curso só era reprovado se um
// humano tivesse olhado para ele.
//
// Este módulo transforma aquelas inspeções em verificações executáveis que
// rodam em TODO curso gerado. Ele não julga a qualidade da escrita — isso é o
// EduScore. Ele verifica ESTRUTURA: o que precisa existir existe, o que nunca
// deveria aparecer não aparece, e nada saiu pela metade.
//
// CONTRATO
//
//   • Puro: sem rede, sem banco, sem relógio. Entra markdown, sai laudo.
//   • Nunca lança. Um erro no portão não pode derrubar a entrega do curso.
//   • Toda falha carrega EVIDÊNCIA — o trecho exato que a disparou. Um laudo
//     que diz "falhou" sem mostrar onde não conserta nada.
//
// SEVERIDADE
//
//   blocker → o curso não pode ir para o cliente sem revisão (needs_review)
//   warning → entregável, mas alguém deveria olhar (ready_with_warnings)
//
// A régua de severidade é deliberada: só é blocker aquilo que o cliente
// PERCEBE como defeito ou que quebra a promessa pedagógica do produto. Ruído
// cosmético é warning — reprovar curso por isso treinaria o operador a ignorar
// o portão, que é o pior desfecho possível.
// ═══════════════════════════════════════════════════════════════════════════

import {
  type Caso,
  type Grandeza,
  grandezasDoTexto,
  identificarCaso,
  mesmaOrdemDeGrandeza,
  mesmoObjeto,
  especieDoValor,
  casoPorDominancia,
  paragrafosDe,
} from "./valores-do-caso.ts";

export type Severity = "blocker" | "warning";
export type Verdict = "ready" | "ready_with_warnings" | "needs_review";

export interface CheckResult {
  id: string;
  label: string;
  severity: Severity;
  passed: boolean;
  /** Uma frase explicando o que foi medido e o que se encontrou. */
  detail: string;
  /** Trechos reais que dispararam a falha, para quem for corrigir. */
  evidence: string[];
}

export interface QualityReport {
  verdict: Verdict;
  /** 0–100. Não é nota pedagógica: é o percentual de verificações cumpridas,
   *  ponderado (blocker vale 3x warning). Serve para acompanhar tendência. */
  structural_score: number;
  blockers: number;
  warnings: number;
  checks: CheckResult[];
  criteria_version: string;
}

export interface ModuleInspectionInput {
  module_number: number;
  title: string;
  markdown: string;
  /** true quando é o módulo final (onde a rubrica é obrigatória). */
  is_capstone?: boolean;
}

export interface CourseInspectionInput {
  course_title: string;
  modules: ModuleInspectionInput[];
  modules_expected?: number;
  /** Faixa de palavras por lição vinda do perfil de profundidade. */
  lesson_min_words?: number;
  lesson_max_words?: number;
}

export const QUALITY_GATE_VERSION = "2026-08-28";

const MAX_EVIDENCE = 5;

// ── utilidades ───────────────────────────────────────────────────────────────

/** Recorta um trecho para caber no laudo sem perder o contexto do defeito. */
function snippet(s: string, max = 160): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function ok(
  id: string,
  label: string,
  severity: Severity,
  detail: string,
): CheckResult {
  return { id, label, severity, passed: true, detail, evidence: [] };
}

function fail(
  id: string,
  label: string,
  severity: Severity,
  detail: string,
  evidence: string[],
): CheckResult {
  return {
    id,
    label,
    severity,
    passed: false,
    detail,
    evidence: evidence.slice(0, MAX_EVIDENCE).map((e) => snippet(e)),
  };
}

/** Linhas do markdown que NÃO estão dentro de um bloco de código. Sem isto,
 *  um curso de programação seria reprovado pelo próprio conteúdo que ensina. */
function contentLines(markdown: string): string[] {
  const out: string[] = [];
  let inCode = false;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      continue;
    }
    if (!inCode) out.push(line);
  }
  return out;
}

/** Texto do curso sem blocos de código, para as buscas globais. */
function contentText(markdown: string): string {
  return contentLines(markdown).join("\n");
}

/**
 * Remove trechos de código EM LINHA (`assim`).
 *
 * As buscas por vazamento procuram tags e entidades HTML. Num curso que ENSINA
 * HTML, `<p>` e `&nbsp;` aparecem legitimamente no texto — como código em
 * linha. Sem esta limpeza, o portão reprovaria o curso pelo próprio conteúdo
 * que ele se propõe a ensinar. Os blocos cercados já saem em contentLines.
 */
function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, " ");
}

/** Régua horizontal do Markdown (`---`, `***`, `___`), não é item de lista. */
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

interface LessonSlice {
  number: string;
  title: string;
  body: string;
}

/** Fatia um módulo em lições. O renderizador emite `### 1.2 Título`. */
function splitLessons(markdown: string): LessonSlice[] {
  const lines = contentLines(markdown);
  const out: LessonSlice[] = [];
  let cur: LessonSlice | null = null;
  const buf: string[] = [];
  const flush = () => {
    if (cur) {
      cur.body = buf.join("\n");
      out.push(cur);
    }
    buf.length = 0;
  };
  for (const line of lines) {
    const m = line.match(/^###\s+(\d+\.\d+)\s+(.+)$/);
    if (m) {
      flush();
      cur = { number: m[1], title: m[2].trim(), body: "" };
      continue;
    }
    if (cur) buf.push(line);
  }
  flush();
  return out;
}

function wordCount(s: string): number {
  return s.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length;
}

// ── A. Integridade do texto ──────────────────────────────────────────────────

// Marcadores internos e HTML nunca são conteúdo legítimo do curso. Já vazaram
// para a tela do aluno como "<!-- COURSE_WIDGET:activity:{...} -->".
const LEAK_PATTERNS: Array<[string, RegExp]> = [
  ["marcador interno", /COURSE_WIDGET|SEMANTIC_MARKER/],
  ["comentário HTML", /<!--|-->/],
  ["tag HTML", /<\/?(?:div|span|p|br|img|table|tr|td|th|ul|ol|li|h[1-6])\b[^>]*>/i],
  ["entidade HTML", /&(?:nbsp|amp|lt|gt|quot|#\d+);/i],
];

// Lacuna que o modelo deixou por preencher. Se chegou ao curso, o curso está
// incompleto.
//
// A busca é dividida em duas por um motivo concreto, encontrado na primeira
// execução do portão em produção: a versão anterior era uma regex única com a
// flag /i, e `\bTODO\b` insensível a maiúsculas casa com "todo" — uma das
// palavras mais comuns do português. O portão reprovou um curso legítimo por
// frases como "investir todo o orçamento" e "a culminação de todo o
// aprendizado". Um marcador de pendência é escrito em CAIXA ALTA por
// convenção; exigir isso separa o marcador da palavra.
const PLACEHOLDER_BRACKET_RE =
  /\[(?:inserir|inclua|preencher|adicionar|completar|exemplo aqui|texto aqui|descri[çc][ãa]o aqui|placeholder)[^\]]{0,60}\]/i;
const PLACEHOLDER_MARKER_RE = /\b(?:TODO|TBD|FIXME|XXXX+)\b|\bLorem ipsum\b/;

function isPlaceholder(line: string): boolean {
  // `- [ ]` e `- [x]` são caixas de seleção de quiz, não lacunas: o aluno é que
  // marca. Removê-las antes de testar evita confundir o formato com um vazio.
  const semCheckbox = line.replace(/^\s*[-*+]\s*\[[ xX]?\]\s*/, "");
  return PLACEHOLDER_BRACKET_RE.test(semCheckbox) ||
    PLACEHOLDER_MARKER_RE.test(semCheckbox);
}

function checkLeaks(course: CourseInspectionInput): CheckResult[] {
  const achados: Record<string, string[]> = {};
  const placeholders: string[] = [];
  for (const mod of course.modules) {
    for (const bruta of contentLines(mod.markdown)) {
      const line = stripInlineCode(bruta);
      for (const [nome, re] of LEAK_PATTERNS) {
        if (re.test(line)) (achados[nome] ??= []).push(`M${mod.module_number}: ${bruta}`);
      }
      if (isPlaceholder(line)) {
        placeholders.push(`M${mod.module_number}: ${bruta}`);
      }
    }
  }
  const vazamentos = Object.entries(achados);
  const total = vazamentos.reduce((n, [, v]) => n + v.length, 0);
  return [
    total === 0
      ? ok("texto.sem_vazamento", "Nenhum marcador interno ou HTML no conteúdo", "blocker",
        "Nenhuma ocorrência de marcador interno, comentário HTML, tag ou entidade.")
      : fail("texto.sem_vazamento", "Nenhum marcador interno ou HTML no conteúdo", "blocker",
        `${total} ocorrência(s) de ${vazamentos.map(([n, v]) => `${n} (${v.length})`).join(", ")}.`,
        vazamentos.flatMap(([, v]) => v)),
    placeholders.length === 0
      ? ok("texto.sem_placeholder", "Nenhuma lacuna por preencher", "blocker",
        "Nenhum marcador de texto pendente encontrado.")
      : fail("texto.sem_placeholder", "Nenhuma lacuna por preencher", "blocker",
        `${placeholders.length} trecho(s) com lacuna por preencher.`, placeholders),
  ];
}

// ── B. Itens e células degenerados ───────────────────────────────────────────

/** Um item de lista que ficou só com a numeração, o traço ou a pontuação. */
const DEGENERATE_ITEM_RE = /^\s*(?:[-*+]|\d{1,3}[.)])\s*(?:[\s.,;:)\-–—]*)$/;

function checkDegenerateItems(course: CourseInspectionInput): CheckResult {
  const achados: string[] = [];
  for (const mod of course.modules) {
    contentLines(mod.markdown).forEach((line, i) => {
      // A régua horizontal `---` começa com um traço e só tem pontuação
      // depois, então casava com a regra de item degenerado. Ela é um
      // separador de seção, não uma lista vazia — foi o segundo falso
      // positivo da primeira execução do portão em produção.
      if (HR_RE.test(line)) return;
      if (DEGENERATE_ITEM_RE.test(line) && line.trim()) {
        achados.push(`M${mod.module_number} linha ${i + 1}: "${line.trim()}"`);
      }
    });
  }
  return achados.length === 0
    ? ok("estrutura.itens_com_conteudo", "Nenhum item de lista vazio", "blocker",
      "Todo item de lista carrega texto além da numeração.")
    : fail("estrutura.itens_com_conteudo", "Nenhum item de lista vazio", "blocker",
      `${achados.length} item(ns) de lista contendo apenas numeração ou pontuação.`,
      achados);
}

// ── C. Tabelas bem formadas ──────────────────────────────────────────────────

function checkTables(course: CourseInspectionInput): CheckResult {
  const achados: string[] = [];
  for (const mod of course.modules) {
    const lines = contentLines(mod.markdown);
    let header: number | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const isRow = line.startsWith("|") && line.endsWith("|") && line.length > 2;
      if (!isRow) {
        header = null;
        continue;
      }
      const cols = line.split("|").slice(1, -1).length;
      // A linha separadora (|---|---|) confirma que a anterior era o cabeçalho.
      if (/^\|[\s:|-]+\|$/.test(line)) {
        continue;
      }
      if (header === null) {
        header = cols;
        continue;
      }
      if (cols !== header) {
        achados.push(
          `M${mod.module_number}: linha com ${cols} colunas em tabela de ${header} — ${line}`,
        );
      }
    }
  }
  return achados.length === 0
    ? ok("estrutura.tabelas", "Tabelas com colunas consistentes", "warning",
      "Toda linha de tabela tem o mesmo número de colunas do cabeçalho.")
    : fail("estrutura.tabelas", "Tabelas com colunas consistentes", "warning",
      `${achados.length} linha(s) de tabela com contagem de colunas divergente.`,
      achados);
}

// ── D. Frases amputadas ──────────────────────────────────────────────────────

// Um campo de estudo de caso que termina numa abreviação foi cortado: "Como o
// Sr." era a saída real de um curso entregue. O mesmo vale para o campo curto
// demais para dizer qualquer coisa.
const ABBREV_END_RE =
  /\b(?:sr|sra|dr|dra|prof|profa|exm[oa]|ilm[oa]|av|ltda|jr|min|máx|aprox|ex|obs|fig|tab|art|p[áa]g|n[ºo]|cf|vs|s[ée]c|ed|org|coord|cap|vol)\.$/i;

const CASE_FIELD_RE =
  /^\s*(?:>\s*)?\*\*(Contexto|Desafio|Solu[çc][ãa]o|Resultado|Papel|Entreg[áa]vel|Cen[áa]rio)\b[^*]*\*\*:?\s*(.*)$/i;

/**
 * O piso de cada campo, em palavras.
 *
 * A versão anterior exigia QUATRO PALAVRAS DE QUALQUER CAMPO, e foi ela que
 * reprovou o curso de precificação de 24/08 com três achados — os três falsos:
 *
 *     M1 — Papel: "Consultor Financeiro" (2 palavras)
 *     M5 — Papel: "Consultor de Precificação" (3 palavras)
 *     M2 — Solução: "Dados Fornecidos:" (2 palavras)
 *
 * Um Papel é um cargo; uma Solução é um raciocínio. A mesma régua não serve
 * para os dois. Medido em 193 campos de cinco cursos reais, um Papel desce
 * legitimamente a duas palavras, enquanto Contexto e Resultado nunca ficaram
 * abaixo de quarenta.
 *
 * O prompt do pipeline já declara um contrato — "Contexto (20+ palavras),
 * Desafio (12+), Solução (30+) e Resultado (12+)" — mas ele é o que se PEDE, e
 * o portão é o que se BLOQUEIA. Um Contexto de 18 palavras onde se pediram 20
 * não é um curso quebrado. Os pisos abaixo ficam confortavelmente abaixo do
 * menor valor observado em cada campo, para pegar amputação sem tocar em
 * variação legítima:
 *
 *     campo        n    menor observado    piso
 *     Contexto    40         42             10
 *     Resultado   28         41              6
 *     Desafio     33         21              6
 *     Solução     28         12              8
 *     Entregável  49          5              3
 *     Papel       12          2              1
 *
 * A Solução é o caso que obrigou a escolher a medição em vez do contrato:
 * metade de 30 daria 15, e há Solução completa de 12 palavras em curso real.
 */
const PISO_DO_CAMPO: Array<[RegExp, number]> = [
  // Um cargo. "Consultor Financeiro" está completo.
  [/^papel$/i, 1],
  // Um substantivo: "Um plano de negociação preenchido."
  [/^(?:entreg[áa]vel|cen[áa]rio)$/i, 3],
  [/^contexto$/i, 10],
  [/^solu[çc][ãa]o$/i, 8],
  [/^(?:desafio|resultado)$/i, 6],
];

function pisoDoCampo(campo: string): number {
  for (const [re, piso] of PISO_DO_CAMPO) if (re.test(campo)) return piso;
  return 4;
}

/**
 * Campos de estudo de caso vazios ou amputados.
 *
 * O campo é UM BLOCO, não uma linha. O renderizador emite `**Solução:** ` e o
 * texto do modelo em seguida, e esse texto pode trazer quebras de linha dentro
 * — foi assim que "Dados Fornecidos:" apareceu no laudo como um campo de duas
 * palavras: era a primeira linha de um campo inteiro, e a verificação não
 * olhava para as seguintes. O bloco vai até a linha em branco ou o próximo
 * campo.
 */
function checkTruncatedFields(course: CourseInspectionInput): CheckResult {
  const achados: string[] = [];
  for (const mod of course.modules) {
    const linhas = contentLines(mod.markdown);
    for (let i = 0; i < linhas.length; i++) {
      const m = linhas[i].match(CASE_FIELD_RE);
      if (!m) continue;
      const campo = m[1];
      const partes = [(m[2] || "").trim()];
      for (let j = i + 1; j < linhas.length; j++) {
        const proxima = linhas[j];
        if (!proxima.trim() || CASE_FIELD_RE.test(proxima)) break;
        if (/^#{1,6}\s/.test(proxima) || HR_RE.test(proxima)) break;
        partes.push(proxima.trim());
      }
      const valor = partes.filter(Boolean).join(" ").trim();
      const piso = pisoDoCampo(campo);
      if (!valor) {
        achados.push(`M${mod.module_number} — ${campo}: vazio`);
      } else if (ABBREV_END_RE.test(valor)) {
        achados.push(`M${mod.module_number} — ${campo}: "${snippet(valor, 80)}" (termina em abreviação)`);
      } else if (wordCount(valor) < piso) {
        achados.push(
          `M${mod.module_number} — ${campo}: "${snippet(valor, 80)}" (${wordCount(valor)} palavras, piso ${piso})`,
        );
      }
    }
  }
  return achados.length === 0
    ? ok("texto.campos_completos", "Campos de estudo de caso completos", "blocker",
      "Nenhum campo vazio, cortado em abreviação ou curto demais.")
    : fail("texto.campos_completos", "Campos de estudo de caso completos", "blocker",
      `${achados.length} campo(s) vazio(s) ou cortado(s).`, achados);
}

// ── E. Prática por módulo ────────────────────────────────────────────────────

// O template preenchível é renderizado como uma tabela "Campo | Orientação |
// Seu caso" com linhas de sublinhados. Qualquer um dos dois serve de prova.
const ACTIVITY_TABLE_RE = /\|\s*Campo\s*\|\s*Orienta[çc][ãa]o\s*\|/i;
const ACTIVITY_BLANK_RE = /_{6,}/;

function checkPracticePerModule(course: CourseInspectionInput): CheckResult {
  const semPratica: string[] = [];
  for (const mod of course.modules) {
    const texto = contentText(mod.markdown);
    if (!ACTIVITY_TABLE_RE.test(texto) && !ACTIVITY_BLANK_RE.test(texto)) {
      semPratica.push(`Módulo ${mod.module_number} — ${mod.title}`);
    }
  }
  return semPratica.length === 0
    ? ok("pedagogia.pratica_por_modulo", "Atividade prática em todos os módulos", "blocker",
      `Os ${course.modules.length} módulos têm ao menos um template preenchível.`)
    : fail("pedagogia.pratica_por_modulo", "Atividade prática em todos os módulos", "blocker",
      `${semPratica.length} de ${course.modules.length} módulo(s) sem atividade prática.`,
      semPratica);
}

// ── F. Objetivo por lição ────────────────────────────────────────────────────

function checkLessonObjectives(course: CourseInspectionInput): CheckResult[] {
  const semObjetivo: string[] = [];
  const modulosMagros: string[] = [];
  let totalLicoes = 0;
  for (const mod of course.modules) {
    const licoes = splitLessons(mod.markdown);
    totalLicoes += licoes.length;
    if (licoes.length < 2) {
      modulosMagros.push(`Módulo ${mod.module_number} — ${licoes.length} lição(ões)`);
    }
    for (const l of licoes) {
      if (!/\*\*Objetivo da li[çc][ãa]o/i.test(l.body)) {
        semObjetivo.push(`Lição ${l.number} — ${l.title}`);
      }
    }
  }
  return [
    semObjetivo.length === 0
      ? ok("pedagogia.objetivo_por_licao", "Objetivo declarado em todas as lições", "blocker",
        `As ${totalLicoes} lições declaram objetivo.`)
      : fail("pedagogia.objetivo_por_licao", "Objetivo declarado em todas as lições", "blocker",
        `${semObjetivo.length} de ${totalLicoes} lição(ões) sem objetivo declarado.`,
        semObjetivo),
    modulosMagros.length === 0
      ? ok("estrutura.licoes_por_modulo", "Módulos com no mínimo duas lições", "blocker",
        "Nenhum módulo ficou abaixo de duas lições.")
      : fail("estrutura.licoes_por_modulo", "Módulos com no mínimo duas lições", "blocker",
        `${modulosMagros.length} módulo(s) com menos de duas lições.`, modulosMagros),
  ];
}

// ── G. Rubrica do capstone ───────────────────────────────────────────────────

function checkRubric(course: CourseInspectionInput): CheckResult {
  const capstone = course.modules.find((m) => m.is_capstone) ??
    course.modules[course.modules.length - 1];
  if (!capstone) {
    return fail("pedagogia.rubrica", "Rubrica no projeto final", "blocker",
      "Curso sem módulo final identificável.", []);
  }
  const texto = contentText(capstone.markdown);
  if (!/\*\*Rubrica de avalia[çc][ãa]o\*\*/i.test(texto)) {
    return fail("pedagogia.rubrica", "Rubrica no projeto final", "blocker",
      `Módulo ${capstone.module_number} não traz a rubrica de avaliação.`,
      [`Módulo ${capstone.module_number} — ${capstone.title}`]);
  }
  // Os pesos precisam somar 100: uma rubrica que não fecha não avalia.
  const pesos = [...texto.matchAll(/\|\s*(\d{1,3})\s*%\s*\|/g)].map((m) => Number(m[1]));
  if (pesos.length < 3) {
    return fail("pedagogia.rubrica", "Rubrica no projeto final", "blocker",
      `Rubrica com ${pesos.length} critério(s) ponderado(s); o mínimo é 3.`,
      [`pesos encontrados: ${pesos.join(", ") || "nenhum"}`]);
  }
  const soma = pesos.reduce((a, b) => a + b, 0);
  if (Math.abs(soma - 100) > 1) {
    return fail("pedagogia.rubrica", "Rubrica no projeto final", "blocker",
      `Os pesos da rubrica somam ${soma}%, não 100%.`,
      [`pesos: ${pesos.join(" + ")} = ${soma}`]);
  }
  return ok("pedagogia.rubrica", "Rubrica no projeto final", "blocker",
    `Rubrica com ${pesos.length} critérios somando ${soma}%.`);
}

// ── H. Cenário de decisão ────────────────────────────────────────────────────

function checkScenario(course: CourseInspectionInput): CheckResult {
  const texto = course.modules.map((m) => contentText(m.markdown)).join("\n");
  const n = (texto.match(/\*\*Checklist de decis[ãa]o\*\*|####\s*Checklist de decis/gi) ?? []).length;
  return n > 0
    ? ok("pedagogia.cenario", "Cenário de decisão no curso", "warning",
      `${n} cenário(s) interativo(s).`)
    : fail("pedagogia.cenario", "Cenário de decisão no curso", "warning",
      "Nenhum cenário de decisão: o curso não coloca o aluno para decidir em contexto.",
      []);
}

// ── I. Densidade por lição ───────────────────────────────────────────────────

function checkDensity(course: CourseInspectionInput): CheckResult {
  const min = course.lesson_min_words ?? 450;
  const max = course.lesson_max_words ?? 1500;
  const foraDaFaixa: string[] = [];
  let total = 0;
  for (const mod of course.modules) {
    for (const l of splitLessons(mod.markdown)) {
      total++;
      const w = wordCount(l.body);
      if (w < min) foraDaFaixa.push(`Lição ${l.number}: ${w} palavras (mínimo ${min})`);
    }
  }
  // Só o PISO é verificado. O teto foi deliberadamente deixado de fora: lição
  // longa é uma escolha editorial defensável, lição curta é conteúdo faltando.
  return foraDaFaixa.length === 0
    ? ok("pedagogia.densidade", "Lições com densidade mínima", "warning",
      `As ${total} lições atingem o piso de ${min} palavras.`)
    : fail("pedagogia.densidade", "Lições com densidade mínima", "warning",
      `${foraDaFaixa.length} de ${total} lição(ões) abaixo do piso de ${min} palavras.`,
      foraDaFaixa);
}

// ── K. Coerência numérica do caso condutor entre módulos ─────────────────────
//
// O curso de precificação de 24/08 saiu deste portão com veredito `ready`,
// escore 100 e zero bloqueadores. Dentro dele, o mesmo suco Detox Verde, da
// mesma empresa, no mesmo lançamento, tinha custo variável de R$ 7,20 no
// módulo 1, R$ 12,75 no módulo 2 e R$ 8,00 três páginas depois; os custos
// fixos mensais eram R$ 25.000 num módulo e R$ 15.000 no outro. O portão não
// mediu isso porque nenhuma das dez verificações olhava dois módulos ao mesmo
// tempo.
//
// A leitura dos números vive em `valores-do-caso.ts`, compartilhada com a ponte
// de valores do pipeline — o portão e a ponte precisam ler o curso do mesmo
// jeito, senão um aprova o que o outro produziu.

type GrandezaComModulo = Grandeza & { modulo: number };

/**
 * Agrupa pelo NÚMERO e guarda como o texto escreveu: "R$ 25.000" e
 * "R$ 25.000,00" são o mesmo valor, e mostrá-los como divergência seria acusar
 * o curso pela própria formatação. A chave do grupo é a CHAVE normalizada da
 * grandeza, não o rótulo exibido: o mesmo custo aparece como "custos variáveis
 * unitários" numa lição e "Custos Variáveis" na outra.
 */
function agruparGrandezas(
  porModulo: Array<{ numero: number; texto: string }>,
  caso: Caso,
  somenteDiretas = false,
): Map<string, Map<string, GrandezaComModulo[]>> {
  const grupos = new Map<string, Map<string, GrandezaComModulo[]>>();
  if (!caso.nomes.length) return grupos;
  for (const { numero, texto } of porModulo) {
    for (const g of grandezasDoTexto(texto, caso)) {
      if (somenteDiretas && g.herdado) continue;
      const grupo = `${g.caso}\u0000${g.chave}`;
      const chaveDoValor = g.numero === null ? g.valor : `#${g.numero}`;
      if (!grupos.has(grupo)) grupos.set(grupo, new Map());
      const porValor = grupos.get(grupo)!;
      if (!porValor.has(chaveDoValor)) porValor.set(chaveDoValor, []);
      porValor.get(chaveDoValor)!.push({ ...g, modulo: numero });
    }
  }
  return grupos;
}

/** Alguma grandeza foi vista em mais de um módulo? Se não, esta leitura não
 *  mediu coerência nenhuma — ficou muda, que é diferente de aprovar. */
function atravessaModulos(
  grupos: Map<string, Map<string, GrandezaComModulo[]>>,
): boolean {
  for (const porValor of grupos.values()) {
    const modulos = new Set<number>();
    for (const ocs of porValor.values()) for (const o of ocs) modulos.add(o.modulo);
    if (modulos.size >= 2) return true;
  }
  return false;
}

interface LeituraDeCoerencia {
  /** O agrupamento completo, com atribuições diretas e herdadas. */
  grupos: Map<string, Map<string, GrandezaComModulo[]>>;
  casos: string[];
}

/**
 * A leitura, compartilhada pelos dois checks. String = não houve o que cruzar.
 *
 * Ela devolve o AGRUPAMENTO, e não o veredito: quem decide o que é bloqueador e
 * o que é aviso são os dois checks, cada um filtrando o que lhe interessa.
 */
function lerCoerencia(
  course: CourseInspectionInput,
): LeituraDeCoerencia | string {
  if (course.modules.length < 2) {
    return "Curso de módulo único: nada a cruzar.";
  }

  const porModulo = course.modules.map((m) => ({
    numero: m.module_number,
    texto: contentText(m.markdown),
    paragrafos: paragrafosDe(contentText(m.markdown)),
  }));

  // Primeiro pelas aspas, que é como a maioria dos cursos apresenta o caso.
  // Se essa leitura não render NENHUMA grandeza que atravesse módulos, tenta a
  // dominância — porque "não achei nada" pode significar que a âncora estava
  // errada, e não que o curso é coerente. A escalada nunca substitui uma
  // leitura que funcionou: ela só age onde a primeira ficou muda.
  let caso = identificarCaso(porModulo);
  let grupos = agruparGrandezas(porModulo, caso);
  if (!atravessaModulos(grupos)) {
    const porDominancia = casoPorDominancia(porModulo);
    if (porDominancia.nomes.length) {
      const alternativos = agruparGrandezas(porModulo, porDominancia);
      if (atravessaModulos(alternativos)) {
        caso = porDominancia;
        grupos = alternativos;
      }
    }
  }
  if (!caso.nomes.length) {
    return "Nenhum caso condutor recorrente identificado: nada a cruzar.";
  }

  return { grupos, casos: caso.nomes };
}

/** As divergências de um agrupamento, por chave de grupo. */
function divergencias(
  grupos: Map<string, Map<string, GrandezaComModulo[]>>,
): Map<string, string> {
  const achados = new Map<string, string>();
  for (const [grupo, porValorBruto] of grupos) {
    if (porValorBruto.size < 2) continue;

    const entradas = [...porValorBruto.values()];
    // Só se comparam valores da MESMA espécie: dinheiro com dinheiro, dias com
    // dias. A espécie majoritária do grupo manda; o resto sai.
    const especies = entradas.map((ocs) => especieDoValor(ocs[0].valor));
    const contagemDeEspecie = new Map<string, number>();
    for (const e of especies) {
      contagemDeEspecie.set(e, (contagemDeEspecie.get(e) ?? 0) + 1);
    }
    const dominante = [...contagemDeEspecie.entries()]
      .sort((a, b) => b[1] - a[1])[0][0];
    const daEspecie = entradas.filter((_, i) => especies[i] === dominante);
    if (daEspecie.length < 2) continue;

    const manter = mesmaOrdemDeGrandeza(daEspecie.map((ocs) => ocs[0].numero));
    const porValor = daEspecie.filter((_, i) => manter[i]);
    if (porValor.length < 2) continue;

    // A contradição precisa CRUZAR módulos. Dentro de um módulo, dois valores
    // para o mesmo rótulo costumam ser uma comparação legítima de cenários —
    // medido: 3 falsos alarmes em 4 achados. É a serialização das lições que
    // trata esse caso, na origem.
    // Só é contradição se os dois lados falarem da mesma coisa. No curso de
    // padaria, "Preço de Venda Unitário do Pão Tradicional: R$ 5,00" e "O Preço
    // de Venda calculado para o novo bolo artesanal é de R$ 62,50" caem na
    // mesma chave sob a mesma âncora — que é a PADARIA — e são dois produtos.
    // Basta um par incompatível para o grupo inteiro deixar de acusar: entre
    // deixar passar e acusar errado, o portão deixa passar.
    const complementos = porValor.map((ocs) =>
      new Set(ocs.flatMap((o) => [...o.complemento]))
    );
    let objetosCompativeis = true;
    for (let i = 0; i < complementos.length && objetosCompativeis; i++) {
      for (let j = i + 1; j < complementos.length; j++) {
        if (!mesmoObjeto(complementos[i], complementos[j])) {
          objetosCompativeis = false;
          break;
        }
      }
    }
    if (!objetosCompativeis) continue;

    const modulosPorValor = porValor.map((ocs) =>
      new Set(ocs.map((o) => (o as Grandeza & { modulo: number }).modulo))
    );
    const todosOsModulos = new Set(modulosPorValor.flatMap((s) => [...s]));
    if (todosOsModulos.size < 2) continue;
    const assinaturas = new Set(
      modulosPorValor.map((s) => [...s].sort((a, b) => a - b).join(",")),
    );
    if (assinaturas.size < 2) continue;

    const detalhe = porValor.map((ocs, i) =>
      `${ocs[0].valor} (módulo ${
        [...modulosPorValor[i]].sort((a, b) => a - b).join(", ")
      })`
    ).join(" ≠ ");
    // O laudo mostra o rótulo como o curso escreveu: quem for conferir procura
    // a frase no PDF, e a chave normalizada não existe em lugar nenhum lá.
    const [caso_, _] = grupo.split("\u0000");
    achados.set(grupo, `${caso_} — ${porValor[0][0].rotulo}: ${detalhe}`);
  }
  return achados;
}

const ID_COERENCIA = "coerencia.valores_entre_modulos";
const ID_COERENCIA_INFERIDA = "coerencia.valores_entre_modulos_inferidos";

/**
 * Contradição em que TODOS os valores vieram de parágrafos que nomeiam o caso.
 *
 * O agrupamento é refeito só com as atribuições diretas, e não filtrado depois:
 * um grupo com quatro valores, um deles herdado, ainda contradiz se os três
 * diretos discordarem entre si. Rebaixar o achado inteiro por causa do quarto
 * custou, na medição, o verdadeiro positivo do curso de precificação.
 */
function checkCrossModuleCoherence(course: CourseInspectionInput): CheckResult {
  const label = "Números do caso condutor coerentes entre módulos";
  const r = lerCoerencia(course);
  if (typeof r === "string") return ok(ID_COERENCIA, label, "blocker", r);

  const diretas = divergencias(agruparGrandezas(porModuloDe(course), casoDe(r), true));
  const evidencias = [...diretas.values()];
  return evidencias.length === 0
    ? ok(ID_COERENCIA, label, "blocker",
      `Nenhuma grandeza do caso condutor muda de valor entre módulos (${r.casos.length} caso(s) rastreado(s)).`)
    : fail(ID_COERENCIA, label, "blocker",
      `${evidencias.length} grandeza(s) do caso condutor com valores diferentes em módulos diferentes. ` +
        `O aluno calcula um número num módulo e encontra outro no seguinte, sem explicação.`,
      evidencias);
}

/**
 * O MESMO CRUZAMENTO, QUANDO A ATRIBUIÇÃO FOI INFERIDA.
 *
 * Os números que interessam moram em parágrafos que não repetem o nome do caso
 * — a "Solução" de um exercício raramente o repete. Herdar o caso do parágrafo
 * anterior os alcança, e traz junto comparações que podem ser legítimas:
 *
 *   27/08  custo de pedido R$ 80 (açúcar, "inclui frete fixo do fornecedor")
 *          contra R$ 50 (farinha) — diferença legítima
 *   28/08  custo de pedido R$ 152,50 (calculado no módulo 2, que afirma ser
 *          "fixo por transação") contra R$ 75 e R$ 50 no módulo 4 —
 *          contradição de verdade
 *
 * O mesmo padrão, veredito oposto, e o que separa é uma frase em prosa sobre a
 * natureza da grandeza. Detectar o objeto não resolveria: nos dois casos os
 * itens são diferentes.
 *
 * Então o portão para de tentar decidir. Ele não reprova o curso por uma
 * atribuição que inferiu — levanta a mão, e quem lê o laudo decide. O que já
 * foi acusado como bloqueador não se repete aqui.
 */
function checkCrossModuleCoherenceInferida(
  course: CourseInspectionInput,
): CheckResult {
  const label = "Números que PODEM se contradizer entre módulos";
  const r = lerCoerencia(course);
  if (typeof r === "string") {
    return ok(ID_COERENCIA_INFERIDA, label, "warning", r);
  }
  const diretas = divergencias(agruparGrandezas(porModuloDe(course), casoDe(r), true));
  const todas = divergencias(r.grupos);
  const evidencias = [...todas.entries()]
    .filter(([grupo]) => !diretas.has(grupo))
    .map(([, texto]) => texto);

  return evidencias.length === 0
    ? ok(ID_COERENCIA_INFERIDA, label, "warning",
      "Nenhuma divergência adicional nas atribuições inferidas.")
    : fail(ID_COERENCIA_INFERIDA, label, "warning",
      `${evidencias.length} grandeza(s) aparecem com valores diferentes em módulos diferentes, ` +
        `atribuídas ao caso pelo parágrafo anterior. Pode ser contradição, pode ser item diferente — ` +
        `confira antes de publicar.`,
      evidencias);
}

function porModuloDe(course: CourseInspectionInput) {
  return course.modules.map((m) => ({
    numero: m.module_number,
    texto: contentText(m.markdown),
    paragrafos: paragrafosDe(contentText(m.markdown)),
  }));
}

function casoDe(r: LeituraDeCoerencia): Caso {
  return {
    nomes: r.casos,
    frequencia: new Map(r.casos.map((n) => [n, 1])),
    tokens: new Set(r.casos.flatMap((n) => n.split(/\s+/).map((w) => w.toLowerCase()))),
  };
}

// ── J. Completude da geração ─────────────────────────────────────────────────

function checkCompleteness(course: CourseInspectionInput): CheckResult {
  const esperado = course.modules_expected ?? course.modules.length;
  const entregue = course.modules.length;
  const vazios = course.modules
    .filter((m) => wordCount(contentText(m.markdown)) < 200)
    .map((m) => `Módulo ${m.module_number} — ${wordCount(contentText(m.markdown))} palavras`);
  if (entregue < esperado) {
    return fail("estrutura.modulos_completos", "Todos os módulos gerados", "blocker",
      `${entregue} de ${esperado} módulos foram gerados.`,
      [`faltam ${esperado - entregue} módulo(s)`]);
  }
  if (vazios.length) {
    return fail("estrutura.modulos_completos", "Todos os módulos gerados", "blocker",
      `${vazios.length} módulo(s) praticamente vazio(s).`, vazios);
  }
  return ok("estrutura.modulos_completos", "Todos os módulos gerados", "blocker",
    `${entregue} de ${esperado} módulos, todos com conteúdo.`);
}

// ── Execução ─────────────────────────────────────────────────────────────────

/**
 * Inspeciona um curso inteiro. Nunca lança: qualquer erro interno vira um
 * warning no laudo, porque um portão quebrado não pode bloquear a entrega.
 */
export function inspectCourse(course: CourseInspectionInput): QualityReport {
  const checks: CheckResult[] = [];
  const executar = (fn: () => CheckResult | CheckResult[], id: string) => {
    try {
      const r = fn();
      if (Array.isArray(r)) checks.push(...r);
      else checks.push(r);
    } catch (err) {
      checks.push({
        id: `${id}.erro`,
        label: `Verificação ${id} não pôde ser executada`,
        severity: "warning",
        passed: false,
        detail: `Erro interno do portão: ${(err as Error)?.message ?? String(err)}`,
        evidence: [],
      });
    }
  };

  executar(() => checkCompleteness(course), "completude");
  executar(() => checkLeaks(course), "vazamento");
  executar(() => checkDegenerateItems(course), "itens");
  executar(() => checkTruncatedFields(course), "campos");
  executar(() => checkPracticePerModule(course), "pratica");
  executar(() => checkLessonObjectives(course), "objetivos");
  executar(() => checkRubric(course), "rubrica");
  executar(() => checkScenario(course), "cenario");
  executar(() => checkDensity(course), "densidade");
  executar(() => checkTables(course), "tabelas");
  executar(() => checkCrossModuleCoherence(course), "coerencia");
  executar(() => checkCrossModuleCoherenceInferida(course), "coerencia-inferida");

  const blockers = checks.filter((c) => !c.passed && c.severity === "blocker").length;
  const warnings = checks.filter((c) => !c.passed && c.severity === "warning").length;

  // Ponderação: um blocker pesa 3 warnings. O escore é para acompanhar
  // tendência entre gerações, não para decidir — quem decide é o veredito.
  const peso = (c: CheckResult) => (c.severity === "blocker" ? 3 : 1);
  const totalPeso = checks.reduce((n, c) => n + peso(c), 0);
  const pesoOk = checks.filter((c) => c.passed).reduce((n, c) => n + peso(c), 0);
  const structural_score = totalPeso === 0
    ? 0
    : Math.round((pesoOk / totalPeso) * 100);

  const verdict: Verdict = blockers > 0
    ? "needs_review"
    : warnings > 0
    ? "ready_with_warnings"
    : "ready";

  return {
    verdict,
    structural_score,
    blockers,
    warnings,
    checks,
    criteria_version: QUALITY_GATE_VERSION,
  };
}

/** Resumo de uma linha para log. */
export function summarizeReport(r: QualityReport): string {
  const falhas = r.checks.filter((c) => !c.passed).map((c) => c.id);
  return `veredito=${r.verdict} escore=${r.structural_score} blockers=${r.blockers} warnings=${r.warnings}` +
    (falhas.length ? ` falhas=[${falhas.join(", ")}]` : "");
}
