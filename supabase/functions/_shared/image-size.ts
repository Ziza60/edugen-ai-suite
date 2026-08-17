// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — dimensões reais de uma imagem, lidas do cabeçalho do arquivo
//
// Por que isso existe: o pptxgenjs, para recortar uma imagem em vez de
// esticá-la (`sizing: { type: "cover" }`), NÃO lê o arquivo. Ele usa a largura
// e a altura que o chamador declarou em `w`/`h` como se fossem as do arquivo.
// Quando `w`/`h` são a caixa do slide, a proporção declarada é a da caixa, o
// recorte calculado dá zero e o resultado é a imagem esticada até preencher a
// caixa. Numa faixa vertical de 4,93 x 7,50 pol, uma foto 16:9 chega achatada
// quase 3x na horizontal.
//
// A correção é declarar a proporção verdadeira, e para isso é preciso lê-la do
// próprio binário. PNG e JPEG cobrem tudo que entra num deck: a IA devolve PNG
// e o Pexels devolve JPEG. WebP e GIF ficam de fora de propósito — o Pexels
// não os serve nesses endpoints e adicioná-los seria código sem chamador.
// ═══════════════════════════════════════════════════════════════════════════

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Lê largura e altura de um PNG ou JPEG. Devolve `null` quando o formato é
 * outro ou quando o cabeçalho está truncado — quem chama decide o que fazer,
 * porque em nenhum dos dois casos existe proporção confiável para usar.
 */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  return pngSize(bytes) ?? jpegSize(bytes);
}

/**
 * Mesma leitura, a partir de um data URI (`data:image/png;base64,...`) — que é
 * a forma como as imagens circulam no exportador. Decodifica só o necessário
 * para o cabeçalho: 32 bytes bastam para o PNG; o JPEG precisa varrer os
 * segmentos até o SOF, então o teto é maior, mas ainda é uma fração do arquivo.
 */
export function imageSizeFromDataUri(dataUri: string): ImageSize | null {
  const virgula = dataUri.indexOf(",");
  if (virgula < 0) return null;
  if (!/;base64/i.test(dataUri.slice(0, virgula))) return null;

  const base64 = dataUri.slice(virgula + 1);
  // Um SOF costuma aparecer nos primeiros KB, mas arquivos com perfil de cor
  // ICC embutido empurram o marcador para adiante. 192 KB de prefixo cobrem
  // esses casos sem decodificar uma imagem inteira de vários megabytes.
  const LIMITE = 256_000; // caracteres base64 ≈ 192 KB decodificados
  const prefixo = base64.length > LIMITE ? base64.slice(0, LIMITE - (LIMITE % 4)) : base64;

  let bin: string;
  try {
    bin = atob(prefixo);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return imageSize(bytes);
}

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(b: Uint8Array): ImageSize | null {
  if (b.length < 24) return null;
  for (let i = 0; i < ASSINATURA_PNG.length; i++) {
    if (b[i] !== ASSINATURA_PNG[i]) return null;
  }
  // O IHDR é obrigatoriamente o primeiro chunk, em offset fixo 8..16, e traz
  // largura e altura como inteiros big-endian de 32 bits logo em seguida.
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  const width = u32(b, 16);
  const height = u32(b, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegSize(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;

  let i = 2;
  while (i + 3 < b.length) {
    // Marcadores podem vir precedidos de bytes 0xFF de preenchimento.
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    let marcador = b[i + 1];
    while (marcador === 0xff && i + 2 < b.length) {
      i++;
      marcador = b[i + 1];
    }

    // Marcadores sem payload: não têm campo de tamanho para pular.
    if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd9)) {
      i += 2;
      continue;
    }
    // SOS: a partir daqui vêm os dados comprimidos. Se o SOF não apareceu até
    // aqui, ele não vai aparecer.
    if (marcador === 0xda) return null;

    const tamanho = u16(b, i + 2);
    if (tamanho < 2) return null;

    // SOF0..SOF15 carregam as dimensões. Ficam de fora DHT (C4), DAC (CC) e os
    // RSTn (D0..D7), que caem na mesma faixa numérica mas não são SOF.
    const ehSOF = marcador >= 0xc0 && marcador <= 0xcf &&
      marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc;
    if (ehSOF) {
      if (i + 9 >= b.length) return null;
      const height = u16(b, i + 5);
      const width = u16(b, i + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }

    i += 2 + tamanho;
  }
  return null;
}

function u16(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
}

/**
 * Traduz "quero esta imagem preenchendo esta caixa, sem distorcer" para o par
 * `w`/`h` que o pptxgenjs espera junto de `sizing: { type: "cover" }`.
 *
 * O pptxgenjs só usa a PROPORÇÃO de `w`/`h` para calcular o recorte, e depois
 * sobrescreve as duas com as medidas da caixa. Então basta devolver qualquer
 * par com a proporção verdadeira do arquivo — ancoramos na largura da caixa.
 */
export function coverBoxSize(
  natural: ImageSize,
  caixa: { w: number; h: number },
): { w: number; h: number } {
  return { w: caixa.w, h: caixa.w * (natural.height / natural.width) };
}
