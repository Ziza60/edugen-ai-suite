/**
 * O que fazer com o texto que sai de um PDF ou DOCX antes de guardá-lo.
 *
 * Existia em DUAS cópias — `analyze-pdf-source` e `upload-course-source` —, com
 * o mesmo conteúdo escrito de dois jeitos. Era o quarto lugar deste projeto em
 * que uma regra podia divergir de si mesma sem ninguém notar.
 */

/**
 * ─── PALAVRAS QUEBRADAS PELA MUDANÇA DE LINHA DO PDF ─────────────────────────
 *
 * O PDF quebra a palavra no fim da linha com hífen. O extrator do app junta os
 * pedaços de texto com espaço simples, e o hífen fica:
 *
 *   "de maneira econômica, eficiente, eficaz e opor- tuna"
 *   "representantes do grupo estratégico da orga- nização"
 *   "por intermédio da publica- ção das Normas Brasileiras"
 *
 * MEDIDO no `extracted_text` REALMENTE GRAVADO das duas fontes do curso de
 * 19/11/2026, lido por SQL:
 *
 *   Manual_auditoria_operacional_4_edicao.docx ... 3,60 por mil chars → ~281
 *   Introdução.docx ............................. 2,00 por mil chars → ~53
 *
 * ~334 palavras partidas no corpus.
 *
 * O QUE ISTO **NÃO** CAUSA, e a medição é o que impediu um conserto exagerado:
 * zero ocorrências nos cursos entregues. O modelo lê "opor- tuna" e escreve
 * "oportuna" — o aluno nunca viu isso. A gravidade é bem menor do que parecia.
 *
 * O QUE ISTO CAUSA: o corpus deixa de conter as palavras que o documento tem.
 * "organização" não existe como palavra no texto gravado; existem "orga" e
 * "nização". Quem compara texto com o corpus — a verificação de vocabulário do
 * título, a regra de valor literal de `useSources` — compara contra um
 * vocabulário furado. Foi assim que `"estrategico da orga"` apareceu como
 * "expressão da fonte" numa medição deste projeto.
 *
 * O PADRÃO EXIGE MINÚSCULA DOS DOIS LADOS, e o hífen colado à primeira letra.
 * Assim `"custo-benefício"` (sem espaço) não é tocado, `"médio e longo prazo —
 * a"` não casa porque o travessão é outro caractere, e `" - "` com espaço antes
 * não casa porque o hífen tem de vir imediatamente após a letra.
 *
 * VERIFICADO nos 10 casos das amostras reais: 10 junções corretas, 0 erradas.
 */
const PALAVRA_QUEBRADA = /([a-záàâãéêíóôõúüç])-[ \t]+([a-záàâãéêíóôõúüç])/g;

export function juntarPalavrasQuebradas(texto: string): string {
  return (texto || "").replace(PALAVRA_QUEBRADA, "$1$2");
}

/**
 * Normaliza o texto extraído antes de guardá-lo.
 *
 * A ordem importa: as palavras são juntadas ANTES de o resto mexer em espaços,
 * porque o padrão depende do espaço que separa os dois pedaços.
 */
export function normalizarTextoExtraido(raw: string): string {
  return juntarPalavrasQuebradas(raw || "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    // Artefatos de paginação: "Page 1 of 10", "- 1 -"
    .replace(/^(Page \d+ of \d+|[-–—]\s*\d+\s*[-–—])\s*$/gm, "")
    .split("\n").map((l) => l.trim()).join("\n")
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// O SUMÁRIO DO DOCUMENTO NÃO É COBERTURA DO DOCUMENTO
//
// RELATADO em 19/11/2026: com os dois capítulos anexados, o resumo sugerido
// afirmou que o curso apresenta "as etapas subsequentes de execução, elaboração
// de relatórios, divulgação e monitoramento", e os módulos sugeridos subiram de
// 5 para 9.
//
// A fonte não ensina nenhuma dessas fases. Ela as NOMEIA — no sumário do manual
// inteiro, que está nas primeiras linhas do PDF "Introdução":
//
//   "...5.6 MATRIZ DE ACHADOS 113 ... 6 RELATÓRIO E DIVULGAÇÃO 118 ...
//     6.6 DIVULGAÇÃO 142 7 MONITORAMENTO 144 7.2 SISTEMÁTICA DE
//     MONITORAMENTO 147 REFERÊNCIAS 150..."
//
// A regra de escopo do prompt proíbe prometer o que não está no conjunto, e o
// modelo obedeceu: esses nomes ESTÃO no conjunto. Como índice, não como
// conteúdo. A instrução não tinha como distinguir as duas coisas, e exigir que
// o modelo distinga é pedir que ele adivinhe a diferença entre citar e ensinar.
//
// COMO O SUMÁRIO SE DISTINGUE DA PROSA, MEDIDO no texto realmente gravado:
//
//   Introdução §1 (sumário) ... 150 palavras ... densidade de números 0,393
//   Introdução §2 ("10")    ...   1 palavra  ... 1,000
//   Introdução §3 (prosa)   ... 237 palavras ... 0,042
//   Manual §1 (prosa)       ... 303 palavras ... 0,020
//   Manual §2 (prosa)       ...  76 palavras ... 0,039
//
// Prosa entre 0,020 e 0,042; sumário em 0,393. Uma ordem de magnitude, com
// qualquer corte entre 0,10 e 0,30 separando os dois. O manual, que não tem
// sumário, não é tocado.
//
// ─── POR QUE ISTO NÃO TOCA O CORPUS DA GERAÇÃO ──────────────────────────────
//
// Esta função é usada SÓ na análise que sugere título, tema e número de módulos.
// O texto guardado e o corpus que gera as lições ficam inteiros, de propósito:
// uma tabela de dados legítima — receita, custo, lucro numa linha — também tem
// densidade alta, e tirá-la do corpus faria `useSources` não encontrar os
// valores do próprio documento e reprovar os módulos. O risco de cortar demais
// é alto no corpus e quase nulo no escopo.
// ═══════════════════════════════════════════════════════════════════════════

/** Acima disto, o parágrafo é índice e não texto. Julgamento, com a medição acima. */
const DENSIDADE_DE_SUMARIO = 0.20;
/** Abaixo disto não há parágrafo suficiente para a densidade significar algo. */
const MIN_PALAVRAS_PARA_DENSIDADE = 8;

const SO_NUMERO = /^\d+(\.\d+)*\.?$/;

/** A fração das palavras do parágrafo que são apenas números. */
export function densidadeDeNumeros(paragrafo: string): number {
  const palavras = (paragrafo || "").split(/\s+/).filter(Boolean);
  if (!palavras.length) return 0;
  return palavras.filter((p) => SO_NUMERO.test(p)).length / palavras.length;
}

export function pareceSumario(paragrafo: string): boolean {
  const palavras = (paragrafo || "").split(/\s+/).filter(Boolean);
  // Um parágrafo que é só um número é o número de página solto da extração.
  if (palavras.length > 0 && palavras.every((p) => SO_NUMERO.test(p))) return true;
  if (palavras.length < MIN_PALAVRAS_PARA_DENSIDADE) return false;
  return densidadeDeNumeros(paragrafo) > DENSIDADE_DE_SUMARIO;
}

/**
 * O texto sem os parágrafos que são sumário, lista de ilustrações ou número de
 * página solto.
 *
 * Devolve o texto original quando a remoção levaria quase tudo: um documento que
 * é inteiro tabela não deve virar string vazia, e nesse caso o escopo errado é
 * menos grave que escopo nenhum.
 */
export function semSumario(texto: string): string {
  if (!texto) return texto;
  const paragrafos = texto.split(/\n\s*\n/);
  const mantidos = paragrafos.filter((p) => p.trim() && !pareceSumario(p));
  const resultado = mantidos.join("\n\n").trim();
  if (resultado.length < texto.length * 0.3) return texto;
  return resultado;
}
