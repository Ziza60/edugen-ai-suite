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
