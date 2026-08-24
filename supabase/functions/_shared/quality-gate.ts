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

export const QUALITY_GATE_VERSION = "2026-08-24";

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
  /^\s*(?:>\s*)?\*\*(Contexto|Desafio|Solu[çc][ãa]o|Resultado|Papel|Entreg[áa]vel)\b[^*]*\*\*:?\s*(.*)$/i;

function checkTruncatedFields(course: CourseInspectionInput): CheckResult {
  const achados: string[] = [];
  for (const mod of course.modules) {
    for (const line of contentLines(mod.markdown)) {
      const m = line.match(CASE_FIELD_RE);
      if (!m) continue;
      const campo = m[1];
      const valor = (m[2] || "").trim();
      if (!valor) {
        achados.push(`M${mod.module_number} — ${campo}: vazio`);
      } else if (ABBREV_END_RE.test(valor)) {
        achados.push(`M${mod.module_number} — ${campo}: "${valor}" (termina em abreviação)`);
      } else if (wordCount(valor) < 4) {
        achados.push(`M${mod.module_number} — ${campo}: "${valor}" (${wordCount(valor)} palavras)`);
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
// mediu isso porque nada aqui olhava dois módulos ao mesmo tempo.
//
// A tentação era resolver por glossário: pegar os termos do `terminology_ledger`
// e procurar o valor de cada um. Foi exatamente isso que quebrou a ponte de
// valores do pipeline — ela achou "Custo Variável: R$ 0,80" numa tabela de
// outro produto e propagou o número errado adiante.
//
// Aqui a leitura é invertida: não se tenta NOMEAR a grandeza a partir de uma
// lista externa. Lê-se o rótulo que o próprio texto escreveu imediatamente
// antes do valor, e acusa-se quando o MESMO rótulo, sobre o MESMO caso, carrega
// valores diferentes em módulos diferentes. O modo de falha é silencioso por
// construção: rótulo lido errado não casa com nada e não vira alarme. Erra para
// menos, nunca para mais — que é o que um portão precisa fazer para não treinar
// o operador a ignorá-lo.
//
// Medido contra cinco cursos reais: 2 divergências verdadeiras (as duas do
// curso de precificação, com a evidência certa) e 0 falsos alarmes.

/** Nome próprio do caso, como o texto o apresenta: entre aspas. */
const NOME_CITADO_RE =
  /['‘’"“”]([A-ZÀ-Ý][\wÀ-ÿ]*(?:\s+[\wÀ-ÿ]+){1,2})['‘’"“”]/g;

// `\d+(?:\.\d{3})*` e não `\d[\d.]*`: sem isso, "custa R$ 25.000." no fim da
// frase captura o ponto final, e "R$25.000." vira um valor diferente de
// "R$25.000" no mesmo grupo.
const MOEDA_RE = String.raw`(?:R\$|US\$|\$|€|£)\s?\d+(?:\.\d{3})*(?:,\d{2})?`;
const PERCENTUAL_RE = String.raw`\d+(?:,\d+)?\s?%`;
const VALOR_RE = `(?:${MOEDA_RE}|${PERCENTUAL_RE})`;
const PRIMEIRO_VALOR_RE = new RegExp(VALOR_RE);

/** O que liga um rótulo ao seu valor: dois-pontos, igual, ou o verbo. */
const LIGACAO_RE = String.raw`(?:\s*[:=]\s*|\s+(?:é|de|são|sao|será|sera|foi|` +
  String.raw`equivale\s+a|totalizam|totalizando|totaliza|somam|soma|custa|custam)\s+(?:de\s+)?)`;

/** Parêntese explicativo entre os valores de uma soma: "R$8,00 (matéria-prima)". */
const PARENTESE_RE = String.raw`(?:\s*\([^)]{0,60}\))?`;

const ROTULO_E_VALOR_RE = new RegExp(
  String.raw`(?<rotulo>.*?)` + LIGACAO_RE +
    String.raw`(?<expressao>${VALOR_RE}${PARENTESE_RE}` +
    String.raw`(?:\s*[+\-*/x×]\s*${VALOR_RE}${PARENTESE_RE})*` +
    String.raw`(?:\s*=\s*(?<total>${VALOR_RE}))?)`,
  "gi",
);

// Palavras que não distinguem uma grandeza de outra. Os qualificadores
// ("total", "unitário", "sugerido") saem junto: o mesmo número aparece ora como
// "custo variável total", ora como "custos variáveis unitários", e é o mesmo
// custo variável.
const PALAVRAS_VAZIAS = new Set(
  ("de do da dos das o a os as um uma uns umas por para em no na nos nas e ou que " +
    "se ao aos com sobre entre seu sua seus suas este esta esse essa aquele cada qual quais " +
    "ser sao eh esta estao apos antes ja mais menos muito bem tambem entao assim isso " +
    "total geral aproximado medio estimado previsto definido sugerido projetado proposto " +
    "inicial final novo atual desejado necessario obtido calculado considerando primeiro")
    .split(" "),
);

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Reduz plural e flexão ao suficiente para "custos variáveis" casar com
 *  "custo variável". Não é um lematizador: é só o bastante para agrupar. */
function raizDaPalavra(t: string): string {
  const s = semAcento(t);
  if (s.endsWith("veis")) return `${s.slice(0, -4)}vel`;
  if (s.endsWith("ais")) return `${s.slice(0, -3)}al`;
  if (s.endsWith("oes")) return `${s.slice(0, -3)}ao`;
  if (s.endsWith("ns")) return `${s.slice(0, -2)}m`;
  if (s.endsWith("es") && s.length > 4) return s.slice(0, -2);
  if (s.endsWith("s") && s.length > 3) return s.slice(0, -1);
  return s;
}

/**
 * A chave da grandeza: as duas primeiras palavras de conteúdo do rótulo.
 *
 * Duas, não três: "Total de Custos Variáveis Unitários" e "custo variável por
 * garrafa" precisam cair na mesma chave, e a terceira palavra as separaria.
 * Duas também é o que impede que o nome do caso entre na chave.
 */
function chaveDaGrandeza(
  rotulo: string,
  tokensDoCaso: Set<string>,
): string | null {
  const toks = (rotulo.match(/[\wÀ-ÿ]+/g) ?? [])
    .map(raizDaPalavra)
    .filter((t) =>
      t.length > 2 && !PALAVRAS_VAZIAS.has(t) && !tokensDoCaso.has(t) &&
      !/^\d/.test(t)
    );
  return toks.length >= 2 ? toks.slice(0, 2).join(" ") : null;
}

/** Um valor em número, para comparar ordens de grandeza. `null` quando o
 *  formato não é o do pt-BR — aí o filtro de magnitude simplesmente não age. */
function valorEmNumero(v: string): number | null {
  const m = v.replace(/\s/g, "").match(/^(?:R\$|US\$|\$|€|£)([\d.]+)(?:,(\d{2}))?$/);
  if (!m) return null;
  const inteiro = Number(m[1].replace(/\./g, ""));
  return Number.isFinite(inteiro) ? inteiro + Number(m[2] ?? 0) / 100 : null;
}

/** Recorta o parágrafo em orações. Uma oração carrega um rótulo e um valor;
 *  sem o corte, o rótulo de uma frase gruda no valor da seguinte. */
function oracoes(paragrafo: string): string[] {
  return paragrafo.split(/(?<=[.;])\s+|\s+\d\.\s+/);
}

function paragrafosDoModulo(markdown: string): string[] {
  return contentText(markdown)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

interface Ocorrencia {
  valor: string;
  modulo: number;
  trecho: string;
}

function checkCrossModuleCoherence(course: CourseInspectionInput): CheckResult {
  const id = "coerencia.valores_entre_modulos";
  const label = "Números do caso condutor coerentes entre módulos";

  if (course.modules.length < 2) {
    return ok(id, label, "blocker", "Curso de módulo único: nada a cruzar.");
  }

  const porModulo = course.modules.map((m) => ({
    numero: m.module_number,
    paragrafos: paragrafosDoModulo(m.markdown),
  }));

  // 1. As âncoras do caso: nomes próprios que o texto apresentou entre aspas e
  //    que reaparecem em pelo menos dois módulos. Aspas são o sinal que separa
  //    o NOME do caso ("Detox Verde") do CONCEITO ensinado ("Custo Variável"),
  //    que também vem em maiúsculas e enganaria a detecção.
  const frequencia = new Map<string, number>();
  const modulosDoNome = new Map<string, Set<number>>();
  const citados = new Set<string>();
  for (const { paragrafos } of porModulo) {
    for (const p of paragrafos) {
      for (const m of p.matchAll(NOME_CITADO_RE)) citados.add(m[1].trim());
    }
  }
  for (const { numero, paragrafos } of porModulo) {
    for (const p of paragrafos) {
      for (const nome of citados) {
        if (!p.includes(nome)) continue;
        frequencia.set(nome, (frequencia.get(nome) ?? 0) + 1);
        if (!modulosDoNome.has(nome)) modulosDoNome.set(nome, new Set());
        modulosDoNome.get(nome)!.add(numero);
      }
    }
  }
  const ancoras = [...citados].filter((n) =>
    (modulosDoNome.get(n)?.size ?? 0) >= 2 && (frequencia.get(n) ?? 0) >= 3
  );
  if (!ancoras.length) {
    return ok(id, label, "blocker",
      "Nenhum caso condutor recorrente identificado: nada a cruzar.");
  }
  const tokensDoCaso = new Set(
    ancoras.flatMap((n) => n.split(/\s+/).map(raizDaPalavra)),
  );

  // 2. Para cada parágrafo, atribuir a grandeza à âncora MAIS ESPECÍFICA
  //    presente — a de menor frequência. Um parágrafo que fala do suco
  //    'Imunidade' e cita a empresa pertence ao suco, não à empresa.
  const grupos = new Map<string, Map<string, Ocorrencia[]>>();
  for (const { numero, paragrafos } of porModulo) {
    for (const p of paragrafos) {
      const presentes = ancoras.filter((n) => p.includes(n));
      if (!presentes.length) continue;
      const alvo = presentes.reduce((a, b) =>
        (frequencia.get(b) ?? 0) < (frequencia.get(a) ?? 0) ? b : a
      );
      for (const oracao of oracoes(p)) {
        for (const m of oracao.matchAll(ROTULO_E_VALOR_RE)) {
          const chave = chaveDaGrandeza(m.groups?.rotulo ?? "", tokensDoCaso);
          if (!chave) continue;
          const bruto = m.groups?.total ??
            m.groups?.expressao?.match(PRIMEIRO_VALOR_RE)?.[0];
          if (!bruto) continue;
          // Agrupa pelo NÚMERO e exibe como o texto escreveu: "R$ 25.000" e
          // "R$ 25.000,00" são o mesmo valor, e mostrá-los como divergência
          // seria acusar o curso pela própria formatação.
          const valor = bruto.replace(/\s/g, "");
          const n = valorEmNumero(valor);
          const chaveDoValor = n === null ? valor : `#${n}`;
          const grupo = `${alvo} — ${chave}`;
          if (!grupos.has(grupo)) grupos.set(grupo, new Map());
          const porValor = grupos.get(grupo)!;
          if (!porValor.has(chaveDoValor)) porValor.set(chaveDoValor, []);
          porValor.get(chaveDoValor)!.push({ valor, modulo: numero, trecho: oracao });
        }
      }
    }
  }

  // 3. Acusar só o que é contradição de fato.
  const evidencias: string[] = [];
  for (const [grupo, porValorBruto] of grupos) {
    if (porValorBruto.size < 2) continue;

    // Duas grandezas diferentes podem começar com as mesmas duas palavras:
    // "custos fixos MENSAIS" (R$ 25.000) e "custos fixos RATEADOS POR UNIDADE"
    // (R$ 3,50). Ordens de grandeza distantes denunciam isso — R$ 25.000 e
    // R$ 3,50 não são o mesmo número escrito de dois jeitos, são dois números.
    const numeros = [...porValorBruto.keys()].map((k) =>
      k.startsWith("#") ? Number(k.slice(1)) : null
    );
    let porValor = porValorBruto;
    if (numeros.every((n) => n !== null && n > 0)) {
      const ordenados = (numeros as number[]).slice().sort((a, b) => a - b);
      const mediana = ordenados[Math.floor(ordenados.length / 2)];
      porValor = new Map(
        [...porValorBruto].filter(([k]) => {
          const n = Number(k.slice(1)) / mediana;
          return n >= 0.05 && n <= 20;
        }),
      );
    }
    if (porValor.size < 2) continue;

    // A contradição precisa CRUZAR módulos. Dentro de um módulo, dois valores
    // para o mesmo rótulo costumam ser uma comparação legítima de cenários —
    // medido: 3 falsos alarmes em 4 achados. É a serialização das lições que
    // trata esse caso, na origem.
    const modulosPorValor = [...porValor.values()].map((ocs) =>
      new Set(ocs.map((o) => o.modulo))
    );
    const todosOsModulos = new Set(modulosPorValor.flatMap((s) => [...s]));
    if (todosOsModulos.size < 2) continue;
    const assinaturas = new Set(
      modulosPorValor.map((s) => [...s].sort().join(",")),
    );
    if (assinaturas.size < 2) continue;

    const detalhe = [...porValor.values()].map((ocs) =>
      `${ocs[0].valor} (módulo ${[...new Set(ocs.map((o) => o.modulo))].sort((a, b) => a - b).join(", ")})`
    ).join(" ≠ ");
    evidencias.push(`${grupo}: ${detalhe}`);
  }

  return evidencias.length === 0
    ? ok(id, label, "blocker",
      `Nenhuma grandeza do caso condutor muda de valor entre módulos (${ancoras.length} caso(s) rastreado(s)).`)
    : fail(id, label, "blocker",
      `${evidencias.length} grandeza(s) do caso condutor com valores diferentes em módulos diferentes. ` +
        `O aluno calcula um número num módulo e encontra outro no seguinte, sem explicação.`,
      evidencias);
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
