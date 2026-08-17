// ═══════════════════════════════════════════════════════════════════════════
// Cálculos de layout do PDF que não dependem do jsPDF
//
// POR QUE ESTE ARQUIVO EXISTE
//
// A imagem do módulo e a página de sumário já existiram no export-pdf e se
// perderam quando ele foi separado em arquivos. Nada acusou: eram funções sem
// teste dentro de um arquivo de 1.900 linhas, e a refatoração as deixou para
// trás em silêncio. O curso continuou saindo — só que sem as imagens que o
// autor pagou para gerar, e sem sumário.
//
// O que dá para testar sem abrir um PDF mora aqui: a conta de proporção da
// imagem, a identificação do formato pelos bytes e a regra de quebra do título
// no sumário. O desenho em si continua no export-pdf, onde precisa do jsPDF.
// ═══════════════════════════════════════════════════════════════════════════

/** Formatos que o addImage do jsPDF aceita. */
export type ImageFormat = "PNG" | "JPEG";

/**
 * Descobre o formato pelos bytes do arquivo.
 *
 * A versão anterior decidia pelo cabeçalho content-type e pela extensão da URL.
 * Isso erra em dois casos que acontecem: o Pexels serve imagem sem extensão na
 * URL, e um WebP com content-type errado era tratado como JPEG — o addImage
 * falhava e a imagem sumia sem mensagem. Ler os bytes não depende de ninguém
 * ter configurado o cabeçalho direito.
 *
 * Devolve null para o que o jsPDF não sabe desenhar (WebP, GIF, SVG), para que
 * quem chama registre o motivo em vez de estourar uma exceção genérica.
 */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "PNG";

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "JPEG";

  return null;
}

export interface CaixaImagem {
  w: number;
  h: number;
}

/**
 * Encaixa a imagem na área disponível preservando a proporção.
 *
 * Primeiro tenta ocupar toda a largura; se com isso a altura passar do teto,
 * reduz pela altura. O teto de altura existe para a imagem não empurrar o texto
 * do módulo para a página seguinte.
 */
export function fitImageBox(
  imgW: number,
  imgH: number,
  maxW: number,
  maxH: number,
): CaixaImagem {
  if (!(imgW > 0) || !(imgH > 0)) return { w: maxW, h: maxH };

  let w = maxW;
  let h = (imgH / imgW) * w;
  if (h > maxH) {
    h = maxH;
    w = (imgW / imgH) * h;
  }
  return { w, h };
}

export interface DesenhoImagem {
  x: number;
  y: number;
  w: number;
  h: number;
  /** true quando a imagem foi ampliada além da faixa e precisa de recorte. */
  recortada: boolean;
}

/**
 * Fração da imagem que se aceita perder no recorte antes de desistir de
 * preencher. Uma foto em pé numa faixa deitada precisaria de um corte enorme, e
 * o que sobra na tela é uma tira fina que não se lê. Nesse caso vale mais a
 * sobra branca das laterais do que uma fatia sem sentido.
 */
const PERDA_MAXIMA = 0.6;

/**
 * Preenche a faixa INTEIRA com a imagem, sem distorcer: amplia até cobrir os
 * dois lados e centraliza, deixando o excedente para fora — quem chama recorta
 * na faixa.
 *
 * Por que não basta o fitImageBox: ele encaixa a imagem DENTRO da faixa, então
 * sobra branco no lado que não limitou. Na capa do PDF a faixa tem 162 x 62 mm
 * e a imagem gerada é 16:9; encaixando, ela saía com 108,5 mm e deixava 53,5 mm
 * de branco — um terço da largura reservada, vazio. Onde a faixa é fixa e o
 * espaço não é reaproveitado por mais nada, encaixar é desperdício.
 *
 * O fitImageBox continua certo onde a imagem FLUI com o texto (a do módulo): lá
 * a altura não é reservada, ela empurra o que vem depois, e recortar só perderia
 * conteúdo sem ganhar espaço nenhum.
 */
export function fillImageBox(
  imgW: number,
  imgH: number,
  caixaX: number,
  caixaY: number,
  caixaW: number,
  caixaH: number,
): DesenhoImagem {
  if (!(imgW > 0) || !(imgH > 0)) {
    return { x: caixaX, y: caixaY, w: caixaW, h: caixaH, recortada: false };
  }

  const escala = Math.max(caixaW / imgW, caixaH / imgH);
  const w = imgW * escala;
  const h = imgH * escala;

  const perda = 1 - (caixaW * caixaH) / (w * h);
  if (perda > PERDA_MAXIMA) {
    const encaixe = fitImageBox(imgW, imgH, caixaW, caixaH);
    return {
      x: caixaX + (caixaW - encaixe.w) / 2,
      y: caixaY + (caixaH - encaixe.h) / 2,
      w: encaixe.w,
      h: encaixe.h,
      recortada: false,
    };
  }

  // A marca diz se sobra imagem para fora da faixa — não se o caminho de
  // preenchimento foi tomado. Quando a imagem já vem na proporção da faixa,
  // ela preenche sem sobrar nada, e recortar seria trabalho à toa.
  const FOLGA = 1e-9;
  return {
    x: caixaX + (caixaW - w) / 2,
    y: caixaY + (caixaH - h) / 2,
    w,
    h,
    recortada: w > caixaW + FOLGA || h > caixaH + FOLGA,
  };
}

/** Quanto uma maiúscula sobe acima da linha de base, em fração do corpo. */
const ALTURA_CAIXA_ALTA = 0.72;
/** Quanto uma descendente (g, p, q) desce abaixo da linha de base. */
const DESCIDA = 0.21;
/** Pontos por milímetro. */
const PT_POR_MM = 72 / 25.4;

/**
 * Espaçamento real entre linhas de um texto de várias linhas, em milímetros.
 *
 * O jsPDF empilha as linhas em corpo × fator, e o corpo é dado em pontos. O
 * sumário assumia 5,2 mm fixos enquanto o jsPDF usava 4,26 — de modo que, num
 * título de duas linhas, os pontinhos e o número da página caíam um milímetro
 * abaixo da segunda linha em vez de alinhados com ela.
 */
export function lineHeightMm(fontSizePt: number, lineHeightFactor = 1.15): number {
  return (fontSizePt * lineHeightFactor) / PT_POR_MM;
}

/**
 * Onde desenhar o traço separador entre dois itens do sumário.
 *
 * Recebe a linha de base da última linha do item de cima e o vão até o item de
 * baixo. Devolve um Y que não encosta em nenhum dos dois.
 *
 * A versão anterior desenhava o traço a 1 mm da linha de base do item seguinte.
 * Uma maiúscula de corpo 10,5 sobe 2,67 mm acima da base — então o traço não
 * ficava entre os itens, ele cortava as letras do título de baixo.
 */
export function tocSeparatorY(
  ultimaLinhaBaseY: number,
  vaoEntreItens: number,
  fontSizePt: number,
): number {
  const corpoMm = fontSizePt / PT_POR_MM;
  const limiteSuperior = ultimaLinhaBaseY + corpoMm * DESCIDA;
  const limiteInferior = ultimaLinhaBaseY + vaoEntreItens - corpoMm * ALTURA_CAIXA_ALTA;
  // Se o vão for apertado demais para caber o traço, fica no meio do que há.
  if (limiteInferior <= limiteSuperior) {
    return ultimaLinhaBaseY + vaoEntreItens / 2;
  }
  return (limiteSuperior + limiteInferior) / 2;
}

/**
 * Limita o título do sumário a um número de linhas, com reticências.
 *
 * O limite existe por causa do alinhamento: os pontinhos e o número da página
 * são ancorados na ÚLTIMA linha do título. Sem o corte, um título de quatro
 * linhas empurrava o número para longe do texto e o sumário deixava de ser
 * legível como uma tabela.
 */
export function tocTitleLines(linhas: string[], maxLinhas = 2): string[] {
  if (linhas.length <= maxLinhas) return linhas;

  const cortadas = linhas.slice(0, maxLinhas);
  const ultima = cortadas[maxLinhas - 1];
  cortadas[maxLinhas - 1] = ultima.length > 3 ? `${ultima.slice(0, -3)}…` : `${ultima}…`;
  return cortadas;
}
