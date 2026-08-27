// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — a conversão para JPEG, num lugar só
//
// POR QUE ESTE ARQUIVO EXISTE
//
// A conversão foi escrita dentro do `generate-module-image`, que é o caminho
// MANUAL — o autor abre o seletor de imagem e clica em gerar. Ficou correto ali
// e ficou de fora do caminho AUTOMÁTICO: o toggle "Imagens com IA" do formulário
// completo não passa por essa função. Ele tem código próprio, em
// `course-pipeline.ts`, que chama o Gemini e grava a imagem sozinho — e gravava
// o PNG cru que a API devolve.
//
// A ironia é que o caminho esquecido é o que mais custa. É por ele que nascem
// os cursos de oito, dez módulos — exatamente os que apertam o orçamento de CPU
// da exportação, onde as imagens já consomem 78% do tempo de render.
//
// Contei três caminhos que gravam imagem: este, o manual, e o upload do autor
// (no frontend, `src/lib/image-upload.ts`, que tem regra própria porque lá é
// preciso distinguir fotografia de gráfico). Os dois do servidor passam a
// compartilhar ESTE código, para não haver um quarto lugar onde a regra possa
// divergir de novo.
//
// O QUE A MEDIÇÃO DIZ (foto real de curso, 940x627)
//
//     PNG,  1105 KB  →  54 ms para embutir no PDF, e 1107 KB dentro dele
//     JPEG,  163 KB  →   2 ms para embutir,        e  166 KB dentro dele
//
// Duas tentativas de resolver sem converter foram descartadas por medição: a
// transformação de imagem do Storage só aceita `format: 'origin'` (sem ele
// devolve WebP, que o jsPDF não lê), e a bandeira de compressão do jsPDF, no
// melhor caso, leva os 54 ms a 31 ms sem mudar o tamanho do arquivo.
//
// Converter na GERAÇÃO é uma vez por imagem. Converter no export seria toda vez.
// ═══════════════════════════════════════════════════════════════════════════

export const QUALIDADE_JPEG = 85;

export interface ImagemGravavel {
  bytes: Uint8Array;
  ext: "jpg" | "png";
  mime: string;
}

/** Assinatura de PNG: os oito primeiros bytes, fixos pela especificação. */
const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function ehPng(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.length < 8) return false;
  return ASSINATURA_PNG.every((b, i) => bytes[i] === b);
}

/** JPEG começa em SOI (FF D8 FF). */
export function ehJpeg(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.length < 3) return false;
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * O que gravar sem converter nada.
 *
 * Lê os BYTES, e não o `mimeType` que a API declarou. Os dois discordam quando
 * o servidor erra o cabeçalho, e quem grava com a extensão errada só descobre
 * na hora em que o jsPDF recusa a imagem — três exportações depois.
 */
export function semConverter(bytes: Uint8Array): ImagemGravavel {
  return ehJpeg(bytes)
    ? { bytes, ext: "jpg", mime: "image/jpeg" }
    : { bytes, ext: "png", mime: "image/png" };
}

/**
 * Converte PNG para JPEG. Nunca falha: no pior caso devolve o que recebeu.
 *
 * As três saídas sem conversão são deliberadas e cada uma tem um motivo:
 *
 *   já é JPEG ......... não há o que fazer;
 *   módulo não carrega  o import é remoto e dinâmico — perder a otimização é
 *                       aceitável, perder a ilustração não;
 *   JPEG ficou maior .. acontece com imagem muito chapada, em que o PNG já é
 *                       ótimo; trocar seria piorar os dois lados.
 */
export async function paraJpeg(
  bytes: Uint8Array,
  rotulo: string,
): Promise<ImagemGravavel> {
  const comoEstava = semConverter(bytes);
  if (!ehPng(bytes)) return comoEstava;
  try {
    const { decode } = await import(
      "https://deno.land/x/imagescript@1.3.0/mod.ts"
    );
    const img: any = await decode(bytes);
    if (typeof img?.encodeJPEG !== "function") return comoEstava;
    const jpeg: Uint8Array = await img.encodeJPEG(QUALIDADE_JPEG);
    if (!jpeg?.length || jpeg.length >= bytes.length) return comoEstava;
    return { bytes: jpeg, ext: "jpg", mime: "image/jpeg" };
  } catch (err) {
    console.warn(
      `[${rotulo}] conversão para JPEG falhou, mantendo PNG: ${
        (err as Error)?.message ?? err
      }`,
    );
    return comoEstava;
  }
}
