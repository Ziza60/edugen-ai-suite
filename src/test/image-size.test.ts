import { describe, expect, it } from "vitest";
import {
  coverBoxSize,
  imageSize,
  imageSizeFromDataUri,
} from "../../supabase/functions/_shared/image-size";

// ═══════════════════════════════════════════════════════════════════════════
// A capa do curso chegava esticada no PPTX: o pptxgenjs calcula o recorte de
// `sizing: cover` a partir da proporção que o chamador DECLARA em w/h, e o
// exportador declarava a caixa do slide. Proporção declarada = proporção da
// caixa ⇒ recorte zero ⇒ imagem esticada. Estes testes fixam a leitura da
// proporção verdadeira, que é o insumo que faltava.
// ═══════════════════════════════════════════════════════════════════════════

/** PNG mínimo válido: assinatura + IHDR com as dimensões pedidas. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8); // comprimento do IHDR
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

/**
 * JPEG mínimo: SOI, um APP0 de tamanho `preenchimento` para empurrar o SOF
 * para adiante, e o SOF0 com as dimensões.
 */
function jpeg(
  width: number,
  height: number,
  { preenchimento = 16, marcadorSOF = 0xc0 } = {},
): Uint8Array {
  const partes: number[] = [0xff, 0xd8];
  partes.push(0xff, 0xe0, (preenchimento >> 8) & 0xff, preenchimento & 0xff);
  for (let i = 0; i < preenchimento - 2; i++) partes.push(0x00);
  partes.push(
    0xff,
    marcadorSOF,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
  );
  return new Uint8Array(partes);
}

function toDataUri(bytes: Uint8Array, mime = "image/png"): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:${mime};base64,${btoa(bin)}`;
}

describe("imageSize — PNG", () => {
  it("lê as dimensões do IHDR", () => {
    expect(imageSize(png(1344, 768))).toEqual({ width: 1344, height: 768 });
  });

  it("lê dimensões acima de 65535 (o IHDR é de 32 bits, não 16)", () => {
    expect(imageSize(png(70000, 100))).toEqual({ width: 70000, height: 100 });
  });

  it("recusa PNG truncado antes do IHDR", () => {
    expect(imageSize(png(800, 600).slice(0, 20))).toBeNull();
  });

  it("recusa arquivo cuja assinatura não é PNG nem JPEG", () => {
    expect(imageSize(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]))).toBeNull();
  });

  it("recusa PNG cujo primeiro chunk não é IHDR", () => {
    const b = png(800, 600);
    b[12] = 0x49;
    b[13] = 0x44; // "IDAT" no lugar de "IHDR"
    expect(imageSize(b)).toBeNull();
  });

  it("recusa dimensão zero", () => {
    expect(imageSize(png(0, 600))).toBeNull();
  });
});

describe("imageSize — JPEG", () => {
  it("lê as dimensões do SOF0", () => {
    expect(imageSize(jpeg(1200, 800))).toEqual({ width: 1200, height: 800 });
  });

  it("encontra o SOF depois de um segmento longo (perfil de cor embutido)", () => {
    expect(imageSize(jpeg(1200, 800, { preenchimento: 6000 })))
      .toEqual({ width: 1200, height: 800 });
  });

  it("aceita SOF2 (JPEG progressivo)", () => {
    expect(imageSize(jpeg(640, 480, { marcadorSOF: 0xc2 })))
      .toEqual({ width: 640, height: 480 });
  });

  it("não confunde DHT (0xC4) com um SOF", () => {
    // Um DHT antes do SOF: se fosse lido como SOF, as dimensões viriam do
    // meio da tabela de Huffman.
    const dht = [0xff, 0xc4, 0x00, 0x08, 1, 2, 3, 4, 5, 6];
    const real = Array.from(jpeg(300, 200));
    const combinado = new Uint8Array([...real.slice(0, 2), ...dht, ...real.slice(2)]);
    expect(imageSize(combinado)).toEqual({ width: 300, height: 200 });
  });

  it("devolve null quando o SOS chega antes de qualquer SOF", () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6]);
    expect(imageSize(b)).toBeNull();
  });

  it("devolve null quando não há SOF algum", () => {
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0])))
      .toBeNull();
  });
});

describe("imageSizeFromDataUri", () => {
  it("lê um data URI de PNG", () => {
    expect(imageSizeFromDataUri(toDataUri(png(1344, 768))))
      .toEqual({ width: 1344, height: 768 });
  });

  it("lê um data URI de JPEG", () => {
    expect(imageSizeFromDataUri(toDataUri(jpeg(1920, 1280), "image/jpeg")))
      .toEqual({ width: 1920, height: 1280 });
  });

  it("devolve null para URL comum, não data URI", () => {
    expect(imageSizeFromDataUri("https://images.pexels.com/foto.jpg")).toBeNull();
  });

  it("devolve null para data URI que não é base64", () => {
    expect(imageSizeFromDataUri("data:image/svg+xml,<svg/>")).toBeNull();
  });

  it("devolve null para base64 corrompido", () => {
    expect(imageSizeFromDataUri("data:image/png;base64,!!!não é base64!!!")).toBeNull();
  });
});

describe("coverBoxSize", () => {
  it("devolve um par com a proporção do arquivo, ancorado na largura da caixa", () => {
    // 1344x768 = 1,75:1. Numa caixa vertical, o que importa é a proporção
    // declarada — o pptxgenjs sobrescreve as medidas pela caixa depois.
    const r = coverBoxSize({ width: 1344, height: 768 }, { w: 4.93, h: 7.5 });
    expect(r.w).toBe(4.93);
    expect(r.h).toBeCloseTo(4.93 * (768 / 1344), 6);
    expect(r.w / r.h).toBeCloseTo(1344 / 768, 6);
  });

  it("o recorte resultante deixa de ser zero na faixa vertical da capa", () => {
    // Reproduz a conta do pptxgenjs (ImageSizingXml.cover) para provar que o
    // par devolvido gera recorte real, e que a caixa antiga gerava zero.
    const recorte = (img: { w: number; h: number }, box: { w: number; h: number }) => {
      const imgRatio = img.h / img.w;
      const boxRatio = box.h / box.w;
      const boxBased = boxRatio > imgRatio;
      const width = boxBased ? box.h / imgRatio : box.w;
      const height = boxBased ? box.h : box.w * imgRatio;
      return {
        l: Math.round(1e5 * 0.5 * (1 - box.w / width)),
        t: Math.round(1e5 * 0.5 * (1 - box.h / height)),
      };
    };
    const caixa = { w: 4.93, h: 7.5 };
    expect(recorte(caixa, caixa)).toEqual({ l: 0, t: 0 }); // o bug
    const corrigido = recorte(coverBoxSize({ width: 1344, height: 768 }, caixa), caixa);
    expect(corrigido.l).toBeGreaterThan(30000); // recorta >30% de cada lado
    expect(corrigido.t).toBe(0); // altura preenchida, nada a cortar em cima
  });

  it("imagem mais alta que a caixa é recortada no topo e na base", () => {
    const r = coverBoxSize({ width: 800, height: 1600 }, { w: 13.33, h: 7.5 });
    expect(r.h / r.w).toBeCloseTo(2, 6);
  });
});
