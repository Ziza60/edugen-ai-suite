/**
 * O prompt que analisa um documento enviado e sugere título, tema e número de
 * módulos do curso.
 *
 * ─── POR QUE ELE PRECISA CONHECER OS OUTROS DOCUMENTOS ───────────────────────
 *
 * O prompt pedia "analyze this document and suggest a course structure" para
 * CADA documento, isoladamente. Com um arquivo só, correto. Com dois,
 * estruturalmente errado: o escopo do curso é a UNIÃO dos documentos, e
 * nenhuma das chamadas sabia que a outra existia.
 *
 * RELATADO por quem usou, em 19/11/2026: anexou o capítulo de conceitos gerais
 * de auditoria junto com o de planejamento da auditoria operacional. O título
 * veio abrangente, como se o curso cobrisse todas as fases da auditoria, e o
 * tema afirmou que o curso iria ALÉM do planejamento — promessa que as fontes
 * não sustentam. Teve de corrigir os dois à mão.
 *
 * O tamanho em caracteres de cada documento vai no prompt porque é o único
 * sinal objetivo de onde está a massa de conteúdo: no caso relatado, 93.537 do
 * planejamento contra 38.605 dos conceitos gerais. Um capítulo introdutório
 * curto contribui conceitos, não escopo.
 *
 * Vive em `_shared` para poder ser medido: a regra que conserta o defeito é uma
 * frase de prompt, e uma frase de prompt dentro de `Deno.serve` não tem como
 * ser verificada por teste nenhum.
 */

import { semSumario } from "./texto-extraido.ts";

/** Um documento do conjunto já analisado. Metadado só — o texto não é reenviado. */
export interface DocumentoIrmao {
  filename: string;
  char_count: number;
  title?: string;
  summary?: string;
}

/** O limite de texto enviado por documento, por custo de token. */
export const MAX_CHARS_NA_ANALISE = 40_000;

function linhaDoIrmao(d: DocumentoIrmao): string {
  const titulo = d.title ? ` — suggested title: "${d.title}"` : "";
  const resumo = d.summary ? `\n  summary: ${d.summary}` : "";
  return `- "${d.filename}" (${d.char_count} characters)${titulo}${resumo}`;
}

/**
 * O bloco que declara o conjunto. Vazio quando o documento está sozinho — e
 * nesse caso o prompt fica exatamente como era antes.
 */
export function blocoDoConjunto(
  filename: string,
  charCount: number,
  irmaos: readonly DocumentoIrmao[],
): string {
  if (!irmaos.length) return "";

  return `
THIS DOCUMENT IS ONE OF ${irmaos.length + 1} DOCUMENTS the user uploaded to build ONE single course.

The other documents in the set:
${irmaos.map(linhaDoIrmao).join("\n")}

This document: "${filename}" (${charCount} characters)

RULES for "title", "theme" and "suggestedModules" — they describe the WHOLE SET, not just this document:
- Scope them to what the set actually covers, together.
- NEVER promise coverage of phases, stages or topics that are not in the set. If the set covers only ONE phase of a larger process, the title or the theme must say so explicitly. A broad title over a narrow set is a defect, not a virtue.
- Weigh the subject by content mass: the document with the most characters carries the substantive subject; a short introductory document contributes concepts, not scope.
- "suggestedModules" must reflect the combined content.
`;
}

/** O prompt completo mandado ao modelo. */
export function promptDeAnalise(
  texto: string,
  filename: string,
  irmaos: readonly DocumentoIrmao[] = [],
): string {
  // O SUMÁRIO SAI DAQUI, E SÓ DAQUI.
  //
  // RELATADO em 19/11/2026: com os dois capítulos anexados, o resumo sugerido
  // afirmou que o curso apresenta "as etapas subsequentes de execução,
  // elaboração de relatórios, divulgação e monitoramento", e os módulos
  // sugeridos subiram de 5 para 9. A fonte não ensina nenhuma dessas fases —
  // ela as nomeia no sumário do manual inteiro, nas primeiras linhas do PDF.
  //
  // A regra de escopo proíbe prometer o que não está no conjunto, e o modelo
  // obedeceu: os nomes ESTÃO no conjunto, como índice. Pedir que ele distinga
  // citar de ensinar é pedir que adivinhe. Tirar o índice resolve na origem.
  //
  // Ver `semSumario`: o corpus que gera as lições NÃO é tocado, porque uma
  // tabela de dados legítima também tem densidade alta de números e tirá-la
  // faria `useSources` reprovar os módulos por não achar os próprios valores.
  const recortado = semSumario(texto).slice(0, MAX_CHARS_NA_ANALISE);

  return `You are an expert instructional designer. Analyze this document and suggest a course structure.

Document name: "${filename}"
${blocoDoConjunto(filename, texto.length, irmaos)}
TERMINOLOGY — this matters as much as the scope:
- Name the subject with the EXPRESSIONS THE DOCUMENT ITSELF USES. Do not coin a technical term that does not appear in the text, even when it sounds more natural or more impressive in the language.
- A common collocation of the general language is not a substitute for the document's term of art. If the document says "fase de planejamento", the title must not say "planejamento estratégico": in this field they denote different things.
- Creative single words are fine. Invented two-word technical expressions are not.

Content:
${recortado}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "title": "a clear, engaging course title (in the document's language)",
  "theme": "main subject description in 1-2 sentences (in the document's language)",
  "targetAudience": "who this course is for (in the document's language)",
  "suggestedModules": <integer between 3 and 12 based on content depth>,
  "language": "<BCP-47 code: pt-BR, en, es, fr, de>",
  "summary": "2-3 sentence description of what students will learn (in the document's language)"
}`;
}

/**
 * Lê `outros_documentos` como ele chega do formulário. Entrada quebrada devolve
 * lista vazia: a análise segue sozinha, em vez de o upload inteiro falhar.
 */
export function irmaosRecebidos(bruto: unknown): DocumentoIrmao[] {
  if (typeof bruto !== "string" || !bruto.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(bruto);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((d): d is Record<string, unknown> =>
      !!d && typeof d === "object" && typeof (d as Record<string, unknown>).filename === "string")
    .slice(0, 20)
    .map((d) => ({
      filename: String(d.filename).slice(0, 200),
      char_count: Number(d.char_count) || 0,
      ...(d.title ? { title: String(d.title).slice(0, 300) } : {}),
      ...(d.summary ? { summary: String(d.summary).slice(0, 1000) } : {}),
    }));
}
