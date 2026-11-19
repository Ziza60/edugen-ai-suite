/**
 * De qual análise sai o título, o tema e o número de módulos quando o usuário
 * anexa VÁRIOS documentos.
 *
 * ─── O DEFEITO ───────────────────────────────────────────────────────────────
 *
 * RELATADO por quem usou, em 19/11/2026: anexou o capítulo de conceitos gerais
 * de auditoria junto com o de planejamento da auditoria operacional. O título
 * veio abrangente, como se o curso cobrisse todas as fases da auditoria, e o
 * tema afirmou que o curso iria ALÉM do planejamento — promessa que as fontes
 * não sustentam. Teve de corrigir os dois à mão.
 *
 * Duas causas somadas:
 *
 * 1. `analyze-pdf-source` analisava cada documento SOZINHO, com o pedido
 *    "desenhe um curso a partir deste documento". Nenhuma chamada sabia que a
 *    outra existia.
 * 2. Eu mandei o formulário usar `analises[0]` — o PRIMEIRO documento
 *    escolhido. Neste caso o primeiro era justamente o geral.
 *
 * Trocar o índice sozinho não consertaria nada: o problema não era qual análise
 * escolher, era que NENHUMA conhecia o conjunto.
 *
 * ─── O QUE FICOU ─────────────────────────────────────────────────────────────
 *
 * Cada análise declara os documentos já analisados (nome, tamanho, título e
 * resumo — não o texto), e o prompt passa a exigir título e tema do CONJUNTO,
 * com a regra explícita de não prometer cobertura que as fontes não têm.
 *
 * O formulário usa a ÚLTIMA análise, porque é a única que conheceu todos os
 * documentos.
 *
 * LIMITE CONHECIDO, ainda não medido: a última análise vê o próprio texto
 * inteiro (até 40 mil caracteres) e os irmãos apenas em resumo, então o escopo
 * ainda pende para o último documento. O contrapeso é o tamanho em caracteres
 * de cada documento, que vai no prompt justamente para o modelo saber onde está
 * a massa de conteúdo — no caso relatado, 93.537 do planejamento contra 38.605
 * dos conceitos gerais. Se um curso real mostrar que o contrapeso não basta, o
 * próximo passo é uma chamada final só de metadados, sem documento primário.
 */

/** O que o app precisa saber de um documento já analisado. */
export interface DocumentoAnalisado {
  filename: string;
  char_count: number;
  title?: string;
  summary?: string;
}

/** O que viaja para a função como `outros_documentos`. */
export interface IrmaoDeclarado {
  filename: string;
  char_count: number;
  title?: string;
  summary?: string;
}

/**
 * Os irmãos a declarar na análise do próximo documento: tudo o que já foi
 * analisado, sem o texto.
 */
export function irmaosParaAnalise(
  jaAnalisados: readonly DocumentoAnalisado[],
): IrmaoDeclarado[] {
  return jaAnalisados.map((d) => ({
    filename: d.filename,
    char_count: d.char_count,
    ...(d.title ? { title: d.title } : {}),
    ...(d.summary ? { summary: d.summary } : {}),
  }));
}

/**
 * A análise que conheceu TODOS os documentos — a única que pode descrever o
 * escopo do conjunto. É a última, porque os irmãos são declarados de forma
 * cumulativa.
 *
 * Devolve `undefined` com lista vazia: quem chama decide o que dizer, em vez de
 * receber um objeto inventado.
 */
export function analiseDoConjunto<T>(analises: readonly T[]): T | undefined {
  return analises.length ? analises[analises.length - 1] : undefined;
}
