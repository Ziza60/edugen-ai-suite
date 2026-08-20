// Shared module-markdown sanitizers used by the generation pipeline and the
// export functions. Kept dependency-free so it runs unchanged under Deno.

/** Accent/diacritic- and case-insensitive comparison key, with the leading
 *  "Módulo N:" scaffolding removed, so a heading can be matched to a title
 *  regardless of which one carries the "Módulo N:" prefix. */
function headingKey(s: string): string {
  return (s || "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^m[óo]dul[oe]\s*\d+\s*[:.\-–—]\s*/i, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim().toLowerCase();
}

/**
 * Normalize stored module markdown for display/export:
 *  - strips a stray ```markdown / ``` code fence the generator sometimes leaves
 *    wrapped around the whole module;
 *  - drops a leading heading line that merely repeats the module title — every
 *    consumer (portal, PDF, DOCX, MD, PPTX) renders the title itself, so the
 *    content's own "## Título" would otherwise print it twice in a row.
 * Idempotent and safe on already-clean content.
 */
export function cleanModuleContent(content: string, title?: string): string {
  let c = (content || "").trim();
  // Strip a whole-module wrapper fence ONLY when the content starts with one
  // (```markdown … ```). Guarding on the leading fence avoids removing the
  // CLOSING fence of a legitimate code block that ends the module.
  if (/^```/.test(c)) {
    c = c.replace(/^```[a-zA-Z]*[ \t]*\n?/, "").replace(/\n?```[ \t]*$/, "").trim();
  }

  if (title) {
    const lines = c.split("\n");
    let k = 0;
    while (k < lines.length && !lines[k].trim()) k++; // skip leading blanks
    if (k < lines.length && /^#{1,3}\s+/.test(lines[k]) &&
        headingKey(lines[k]) === headingKey(title) && headingKey(title).length > 0) {
      lines.splice(0, k + 1);
      while (lines.length && !lines[0].trim()) lines.shift(); // drop following blank(s)
      c = lines.join("\n").trim();
    }
  }
  return c;
}

/**
 * Trim a markdown block that was cut off mid-output (MAX_TOKENS) so it never ends
 * in the middle of a sentence/word. Walks back from the end, dropping trailing
 * lines until one ends "cleanly" — terminal punctuation, a heading, a table row,
 * or a horizontal rule. A prose/list line with a completed sentence inside is
 * trimmed to that sentence rather than dropped whole. Call ONLY when truncation
 * was detected, so legitimately-unpunctuated endings are left untouched otherwise.
 */
export function repairTruncation(md: string): string {
  const lines = (md || "").replace(/[ \t]+$/gm, "").replace(/\n+$/, "").split("\n");
  while (lines.length) {
    const raw = lines[lines.length - 1];
    const l = raw.trim();
    if (!l) { lines.pop(); continue; }
    const clean = /^#{1,6}\s/.test(l) || /^\|.*\|$/.test(l) || /^-{3,}$/.test(l) ||
      /[.!?:;)\]"'`*]$/.test(l);
    if (clean) break;
    const period = Math.max(l.lastIndexOf("."), l.lastIndexOf("!"), l.lastIndexOf("?"));
    if (period > 25) {
      const indent = raw.slice(0, raw.length - raw.trimStart().length);
      lines[lines.length - 1] = indent + l.slice(0, period + 1);
      break;
    }
    lines.pop();
  }
  return lines.join("\n").trimEnd();
}

// ── Lista numerada que veio grudada no parágrafo ────────────────────────────
//
// O modelo às vezes devolve a enumeração dentro da mesma linha, sem quebra e
// até sem espaço antes do marcador:
//
//   "Plano para Vila Nova da Esperança:1. Ação: Portal da Transparência. O
//    município deve … legitimando as ações governamentais.2. Ação: Capacitação
//    Contínua … contra irregularidades.3. Ação: Audiências Públicas …"
//
// O exportador não tem como adivinhar: recebe uma linha só e desenha um bloco
// corrido de vinte linhas onde deveria haver três itens. Foi assim que saiu a
// página 55 do curso de orçamento — o conteúdo estava certo e ilegível.
//
// POR QUE A REGRA É ESTREITA
//
// Quebrar em todo "n." destruiria texto correto: "Lei nº 4.320/64", "R$ 3.500,00",
// "art. 5º", "no exercício de 2026. 300 servidores". Por isso não basta achar
// UM marcador — os marcadores encontrados precisam formar a sequência 1, 2, 3…
// começando em 1 e sem pular. Numeração de verdade tem essa forma; coincidência
// não tem. Duas ocorrências é o mínimo, porque um "1." solto não é lista.

/** ".2. " ou ":2. " — marcador colado ao que vem antes, que é o sintoma. */
const MARCADOR_COLADO = /([.:;!?])(\d{1,2})\.\s+/g;

/**
 * Devolve o texto com a lista numerada embutida quebrada em linhas.
 *
 * Sem sequência válida, devolve o texto exatamente como veio.
 */
export function separarListaEmbutida(texto: string): string {
  const t = texto || "";
  const achados: Array<{ inicio: number; fim: number; n: number }> = [];
  for (const m of t.matchAll(MARCADOR_COLADO)) {
    achados.push({
      inicio: m.index ?? 0,
      fim: (m.index ?? 0) + m[0].length,
      n: Number(m[2]),
    });
  }
  if (achados.length < 2) return t;

  // A prova de que é lista: os marcadores formam 1, 2, 3… começando em 1 e sem
  // pular. Coincidência não tem essa forma — "em 2024. 300 servidores. 45 já
  // concluíram" dá 300 e 45, que não abrem em 1 nem se sucedem.
  const sequencia = achados.every((a, i) => a.n === i + 1);
  if (!sequencia) return t;

  let saida = "";
  let cursor = 0;
  for (const c of achados) {
    // A pontuação que vinha antes do marcador pertence à frase anterior e fica
    // com ela; o dois-pontos que anuncia a lista, idem.
    saida += t.slice(cursor, c.inicio + 1);
    saida += `\n\n${c.n}. `;
    cursor = c.fim;
  }
  saida += t.slice(cursor);
  return saida;
}

/**
 * Normalize a course title before it is ever saved/rendered anywhere (DB,
 * PDF cover, PPTX cover, module list). Strips command/prompt phrasing users
 * sometimes paste in ("Crie um curso no tema '...'"), stray quotes and
 * trailing punctuation, caps length at a word boundary, and falls back to a
 * cleaned `theme` when the title still looks like a prompt instead of a
 * real title. Mirrored (can't share a module with) the frontend copy in
 * src/pages/CourseWizard.tsx and the self-contained copy in
 * export-pdf/index.ts — keep the three in sync when changing the rules.
 */
export function normalizeCourseTitle(rawTitle: string, theme?: string): string {
  let t = (rawTitle || "").trim();
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  t = t.replace(
    /^(crie|criar|gere|gerar|fa[çc]a|fazer|monte|montar|elabore|elaborar|quero|preciso(\s+de)?|me\s+ajude\s+a\s+criar)\s+(m\s+|um\s+|uma\s+|uns\s+|umas\s+)?(cursos?|treinamentos?|capacita[çc][õã]o?es?)\s*(completos?\s*)?(no\s+tema|com\s+o\s+tema|sobre(\s+o\s+tema)?|a\s+respeito\s+de|de|do|da|em|para|:)?\s*/i,
    ""
  );
  t = t.replace(/^(um\s+|uma\s+)?(cursos?|treinamentos?)\s+(de|sobre|do|da|em)\s+/i, "");
  t = t.replace(/^["'“”‘’\s]+|["'“”‘’.\s]+$/g, "").trim();
  t = t.replace(/\s{2,}/g, " ");

  const looksLikePrompt = /\b(crie|criar|gere|gerar|fa[çc]a|monte|elabore|quero|preciso)\b/i.test(t);
  const cleanTheme = (theme || "").trim().replace(/\s{2,}/g, " ");

  let result = (!t || t.length < 3 || looksLikePrompt) ? cleanTheme : t;
  if (!result) result = t || cleanTheme;

  const MAX_TITLE_LEN = 90;
  if (result.length > MAX_TITLE_LEN) {
    result = result.slice(0, MAX_TITLE_LEN).replace(/\s+\S*$/, "").trim();
  }
  result = result.replace(/[.,;:\-–—]+$/, "").trim();
  if (result) result = result.charAt(0).toUpperCase() + result.slice(1);
  return result || "Curso sem título";
}
