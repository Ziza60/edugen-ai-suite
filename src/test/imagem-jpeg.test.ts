import { describe, expect, it } from "vitest";
import {
  ehJpeg,
  ehPng,
  paraJpeg,
  semConverter,
} from "../../supabase/functions/_shared/imagem-jpeg";

// ═══════════════════════════════════════════════════════════════════════════
// A conversão em si depende de um módulo remoto (imagescript) e não roda aqui.
// O que ESTES testes cobrem é o que decide se ela acontece — e é onde estavam
// os dois defeitos: gravar pela extensão declarada em vez de pelos bytes, e o
// caminho automático que nunca chamava a conversão.
// ═══════════════════════════════════════════════════════════════════════════

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 4, 5, 6, 7]);

describe("reconhecimento pelos bytes", () => {
  it("reconhece a assinatura de PNG", () => {
    expect(ehPng(PNG)).toBe(true);
    expect(ehPng(JPEG)).toBe(false);
  });

  it("reconhece a assinatura de JPEG", () => {
    expect(ehJpeg(JPEG)).toBe(true);
    expect(ehJpeg(PNG)).toBe(false);
  });

  it("não estoura com entrada vazia, curta ou ausente", () => {
    for (const v of [null, undefined, new Uint8Array(0), new Uint8Array([0x89, 0x50])]) {
      expect(ehPng(v as any)).toBe(false);
      expect(ehJpeg(v as any)).toBe(false);
    }
  });

  it("um PNG truncado no meio da assinatura não passa por PNG", () => {
    expect(ehPng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00]))).toBe(false);
  });
});

describe("semConverter", () => {
  it("dá extensão e mime pelo CONTEÚDO, não pelo cabeçalho declarado", () => {
    expect(semConverter(JPEG)).toEqual({ bytes: JPEG, ext: "jpg", mime: "image/jpeg" });
    expect(semConverter(PNG)).toEqual({ bytes: PNG, ext: "png", mime: "image/png" });
  });

  it("bytes irreconhecíveis caem em PNG — o comportamento de antes", () => {
    const lixo = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(semConverter(lixo)).toEqual({ bytes: lixo, ext: "png", mime: "image/png" });
  });

  it("não copia os bytes: o que entra é o que sai", () => {
    expect(semConverter(PNG).bytes).toBe(PNG);
  });
});

describe("paraJpeg", () => {
  it("devolve o JPEG intacto, sem tentar converter", async () => {
    const r = await paraJpeg(JPEG, "teste");
    expect(r.bytes).toBe(JPEG);
    expect(r.ext).toBe("jpg");
    expect(r.mime).toBe("image/jpeg");
  });

  it("nunca lança: entrada inválida devolve o que recebeu", async () => {
    const lixo = new Uint8Array([1, 2, 3]);
    const r = await paraJpeg(lixo, "teste");
    expect(r.bytes).toBe(lixo);
    expect(r.ext).toBe("png");
  });

  it("PNG que não converte volta como PNG, e não como erro", async () => {
    // Sem o módulo remoto, o import dinâmico falha — que é exatamente o pior
    // caso previsto: perder a otimização é aceitável, perder a imagem não.
    const r = await paraJpeg(PNG, "teste");
    expect(r.bytes).toBe(PNG);
    expect(r.ext).toBe("png");
    expect(r.mime).toBe("image/png");
  });
});
