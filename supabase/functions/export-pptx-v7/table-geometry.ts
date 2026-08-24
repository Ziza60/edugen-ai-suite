// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — PPTX v7  ·  table-geometry.ts
//
// QUANTO TEXTO CABE NUMA CÉLULA — MEDINDO, EM VEZ DE CHUTANDO
//
// O corte de célula era uma constante: MAX_TABLE_CELL_CHARS = 80, igual para
// toda tabela. Medindo o deck de 23/08, a capacidade real das dez tabelas ia de
// 78 a 220 caracteres, conforme o número de colunas:
//
//   slide 12, 4 colunas de 5,91 cm  →   87 caracteres  (o teto de 80 quase acerta)
//   slide 50, 2 colunas de 11,82 cm →  171 caracteres  (o teto usa metade)
//   slide 51, 2 colunas, linha alta →  228 caracteres  (o teto usa um terço)
//
// A constante tinha sido calibrada para a tabela mais apertada, e punia todas
// as outras. O resultado aparecia na apostila em frases penduradas: "Descreva o
// cenário atual do Armazém da Esquina e a importância de uma nova" — corte a 74
// caracteres numa célula que comportava 171.
//
// A geometria não é misteriosa: o renderizador a calcula a partir do número de
// colunas e de linhas, deterministicamente. Este módulo faz a mesma conta antes,
// para que o corte saiba de quanto espaço dispõe. Fica aqui, e não no render,
// porque o validate precisa dela e o render já importa do validate — importar de
// volta fecharia um ciclo.
//
// AO MEXER NO RENDERIZADOR, MEXA AQUI. Se as larguras, as fontes ou as margens
// da tabela mudarem lá e não mudarem aqui, o corte volta a chutar — só que com
// a aparência de estar medindo, que é pior.
// ═══════════════════════════════════════════════════════════════════════════

// Canvas 16:9, em polegadas — os mesmos números do render.ts.
const W = 13.333;
const ML = 0.7;
const MR = 0.7;
const CW = W - ML - MR;
const HEADER_H = 1.35;
const CONTENT_Y = HEADER_H + 0.15;
const FOOTER_Y = 7.12;
const CONTENT_H = FOOTER_Y - CONTENT_Y - 0.12;

/** Margens internas da célula em pontos: [topo, direita, base, esquerda]. */
const MARGEM_PT = { horizontal: 10 + 10, vertical: 5 + 5 };

/**
 * Largura média de caractere como fração do corpo da fonte.
 *
 * 0,50 para a Calibri em texto corrido português. É deliberadamente mais
 * pessimista que a média real (~0,46): a conta precisa errar para o lado de
 * cortar cedo, porque errar para o outro estoura a célula — e foi disso que o
 * usuário reclamou antes.
 */
const LARGURA_MEDIA = 0.5;

/** Entrelinha do PowerPoint para texto simples. */
const ENTRELINHA = 1.2;

/** A altura de linha que o renderizador vai usar para uma tabela com N linhas. */
export function alturaDaLinha(totalDeLinhas: number): number {
  return Math.min(0.95, CONTENT_H / Math.max(1, totalDeLinhas));
}

/** O corpo de fonte que o renderizador vai usar para N colunas de dados. */
export function corpoDaCelula(colunasDeDados: number): number {
  if (colunasDeDados >= 5) return 9;
  if (colunasDeDados >= 4) return 10;
  return 11;
}

/** A largura da coluna de rótulos (a primeira), em polegadas. */
export function larguraDoRotulo(): number {
  return Math.min(3.0, Math.max(2.0, CW * 0.22));
}

/** A largura de uma coluna de dados, em polegadas. */
export function larguraDaColuna(colunasDeDados: number): number {
  return (CW - larguraDoRotulo()) / Math.max(1, colunasDeDados);
}

/**
 * Quantos caracteres cabem numa célula de dados desta tabela.
 *
 * `colunasDeDados` não conta a coluna de rótulo; `linhasDeDados` não conta o
 * cabeçalho — as duas são somadas aqui, como o renderizador faz.
 *
 * O piso de 60 existe para o caso extremo de uma tabela de muitas colunas e
 * muitas linhas: abaixo disso a célula não diz mais nada útil, e o certo é a
 * tabela ter menos colunas — não o texto virar duas palavras.
 */
export function capacidadeDaCelula(
  colunasDeDados: number,
  linhasDeDados: number,
): number {
  const corpo = corpoDaCelula(colunasDeDados);
  const larguraPt = larguraDaColuna(colunasDeDados) * 72 - MARGEM_PT.horizontal;
  const porLinha = Math.floor(larguraPt / (corpo * LARGURA_MEDIA));

  const alturaPt = alturaDaLinha(linhasDeDados + 1) * 72 - MARGEM_PT.vertical;
  const linhas = Math.max(1, Math.floor(alturaPt / (corpo * ENTRELINHA)));

  return Math.max(60, porLinha * linhas);
}

// ═══════════════════════════════════════════════════════════════════════════
// A BARRA DO PASSO — E O ACOPLAMENTO QUE ME PEGOU
//
// quebrarSequenciaDeLayout converte a segunda de duas tabelas seguidas em
// passos, para o módulo não repetir a mesma forma. A conversão era recusada
// quando o corpo do passo passava de 130 caracteres.
//
// Esses 130 tinham sido calibrados contra células de 80 caracteres. Quando o
// teto da célula passou a ser medido (capacidadeDaCelula, acima) e subiu para
// até 228, o corpo do passo — que é a concatenação das células da linha —
// passou de 130 em quase toda tabela, e a conversão parou de acontecer.
//
// O efeito apareceu no deck seguinte: formas distintas de 19 para 16, formas
// iguais seguidas de 4 para 6, e três tabelas em sequência no fecho do módulo
// 5. Medindo os corpos: no deck anterior iam de 64 a 94 caracteres; no novo,
// de 92 a 282. Consertar o teto da célula desativou a quebra de sequência.
//
// A barra do passo comporta de 360 a 720 caracteres, conforme o número de
// passos — muito mais que 130. Mas caber não é o critério: uma barra com 280
// caracteres cabe e lê mal. Por isso o teto é METADE do que a barra desenha,
// e nunca menos que os 130 originais.
// ═══════════════════════════════════════════════════════════════════════════

/** Largura da faixa de texto do passo, descontado o ordinal gigante. */
const PASSO_ORDINAL = 1.45;
const PASSO_FOLGA = 0.4;
const PASSO_CORPO_PT = 12.5;
const PASSO_TITULO_PT = 17;

/** Quantos caracteres a barra de um passo desenha, com N passos no slide. */
export function capacidadeDoPasso(passos: number): number {
  const alturaDaFaixa = CONTENT_H / Math.max(1, passos);
  const largura = CW - PASSO_ORDINAL - PASSO_FOLGA;
  const porLinha = Math.floor((largura * 72) / (PASSO_CORPO_PT * LARGURA_MEDIA));
  // O título do passo ocupa a primeira linha da faixa.
  const alturaUtilPt = alturaDaFaixa * 72 - PASSO_TITULO_PT * 1.25 - 6;
  const linhas = Math.max(1, Math.floor(alturaUtilPt / (PASSO_CORPO_PT * ENTRELINHA)));
  return Math.max(0, porLinha * linhas);
}

/**
 * Até onde o corpo de um passo pode ir sem virar parede de texto.
 *
 * Metade do que a barra desenha: a outra metade é respiro, que é o que faz o
 * passo ler como passo e não como parágrafo. Nunca abaixo de 130, o valor que
 * vigorou enquanto as células eram de 80 caracteres.
 */
export function tetoDoCorpoDoPasso(passos: number): number {
  return Math.max(130, Math.floor(capacidadeDoPasso(passos) * 0.5));
}
