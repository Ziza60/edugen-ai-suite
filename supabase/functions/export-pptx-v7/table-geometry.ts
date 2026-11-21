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

// ═══════════════════════════════════════════════════════════════════════════
// O CARTÃO — TRÊS LINHAS FIXAS, EM VEZ DA ALTURA QUE EXISTE
//
// MEDIDO no slide 33 do deck de 21/11/2026: dois dos três cartões terminam sem
// ponto final, cortados em 100 caracteres.
//
//   "...as causas raiz de problemas ou deficiências no desempenho do objeto"
//   "...avaliando sua estrutura, operações"
//
// Os 100 vinham de "3 linhas × ~37 caracteres". As três linhas eram
// `Math.min(3, ...)` em renderCards — um teto que nunca olhou a altura
// disponível. Com TRÊS cartões há UMA linha de grid, e o cartão tem a altura
// inteira da área de conteúdo: cabem dezenove linhas, não três.
//
// A conta abaixo é a mesma do renderizador, feita antes, como já se faz com a
// célula da tabela. MEDIDO pela geometria:
//
//   cartões  colunas  linhas de grid  linhas que cabem  teto de hoje
//      2        2            1              19              175
//      3        3            1              19              108
//      4        2            2               5              175
//      5–6      3            2               5              108
//
// Dezenove linhas num cartão não é cartão, é parágrafo numa caixa. O teto de
// LINHAS fica em 4: é o que o grid de duas fileiras comporta com uma linha de
// folga, e a folga existe porque caracteres-por-linha é estimativa.
//
// AO MEXER EM renderCards, MEXA AQUI — e vice-versa. Havia duas cópias desta
// régua, uma em validate.ts e outra em definicoes-da-fonte.ts, com valores
// diferentes do que o renderizador desenha. Agora é uma só.
// ═══════════════════════════════════════════════════════════════════════════

/** Os mesmos números de renderCards. */
const CARTAO = {
  gap: 0.3,
  padT: 0.2,
  numH: 0.36,
  headLH: 0.28,
  bodyLH: 0.21,
  midGap: 0.1,
  padB: 0.22,
  /** Folga do corpo dentro do cartão: a largura útil é cardW menos isto. */
  margemHorizontal: 0.5,
  /** ~caracteres por polegada a 12pt, como renderCards estima. */
  porPolegada: 11,
  /** Um cartão com mais linhas que isto deixa de ser cartão. */
  maxLinhas: 4,
};

/** As colunas do grid de cartões, como renderCards as escolhe. */
export function colunasDoGrid(quantosCards: number): number {
  return quantosCards <= 2 ? Math.max(1, quantosCards) : quantosCards === 4 ? 2 : 3;
}

/** Quantas linhas de corpo o cartão comporta, pela altura que ele realmente tem. */
export function linhasDoCorpoDoCard(quantosCards: number): number {
  const n = Math.max(1, quantosCards);
  const cols = colunasDoGrid(n);
  const rows = Math.ceil(n / cols);
  const alturaDaFileira = (CONTENT_H - CARTAO.gap * (rows - 1)) / rows;
  const fixo = CARTAO.padT + CARTAO.numH + 0.04 + 2 * CARTAO.headLH +
    CARTAO.midGap + CARTAO.padB;
  const cabem = Math.floor((alturaDaFileira - fixo) / CARTAO.bodyLH);
  return Math.max(1, Math.min(CARTAO.maxLinhas, cabem));
}

/** Quantos caracteres cabem no corpo de um cartão deste arranjo. */
export function capacidadeDoCorpoDoCard(quantosCards: number): number {
  const n = Math.max(1, quantosCards);
  const cols = colunasDoGrid(n);
  const larguraDoCartao = (CW - CARTAO.gap * (cols - 1)) / cols;
  const util = Math.max(1.2, larguraDoCartao - CARTAO.margemHorizontal);
  const porLinha = Math.max(14, util * CARTAO.porPolegada);
  return Math.round(porLinha * linhasDoCorpoDoCard(n));
}

// ═══════════════════════════════════════════════════════════════════════════
// O SATÉLITE DO RADIAL — CAIXA FIXA, TEXTO DE TAMANHO LIVRE
//
// MEDIDO no slide 43 do deck de 21/11/2026, renderizado e olhado: as QUATRO
// caixas do diagrama radial transbordam. As duas ou três últimas linhas de cada
// uma são desenhadas sobre o fundo, fora do retângulo, e a de baixo quase
// encosta no rodapé.
//
//   "...razoável e fundamentada contra a qual o desempenho é comparado."
//   "...centrais da auditoria operacional (ISSAI 3000/45)."
//
// A caixa é `satW = 2.5, satH = 1.0`, fixa, e o corpo recebe `h = satH - 0.5`
// — meia polegada, que a 10pt são três linhas. O texto que chegou tem cinco.
//
// E havia um descasamento pior por trás: a normalização corta o corpo do cartão
// por `capacidadeDoCorpoDoCard`, que mede o GRID (234 caracteres com quatro
// cartões), enquanto o mesmo slide pode ser roteado ao radial, que comporta
// ~90. A régua media uma caixa e o texto era desenhado noutra.
//
// O radial não tem como crescer: o satélite de cima já começa a 0,05 polegada
// da borda da área de conteúdo. Então quem não cabe não usa esta forma — vai
// para o grid, que tem espaço. Ver `cabeNoRadial` em render.ts.
// ═══════════════════════════════════════════════════════════════════════════

const SATELITE = {
  largura: 2.5,
  altura: 1.0,
  /** Recuo horizontal do texto dentro da caixa (0,12 de cada lado). */
  recuoH: 0.24,
  /** O que o cabeçalho e as margens comem da altura. */
  reservaV: 0.5,
  corpoPt: 10,
  entrelinha: 0.98,
};

/** Quantos caracteres cabem no corpo de um satélite do diagrama radial. */
export function capacidadeDoSatelite(): number {
  const larguraPt = (SATELITE.largura - SATELITE.recuoH) * 72;
  const porLinha = Math.floor(larguraPt / (SATELITE.corpoPt * LARGURA_MEDIA));
  const alturaDeLinha = (SATELITE.corpoPt * ENTRELINHA * SATELITE.entrelinha) / 72;
  const linhas = Math.max(1, Math.floor((SATELITE.altura - SATELITE.reservaV) / alturaDeLinha));
  return porLinha * linhas;
}
