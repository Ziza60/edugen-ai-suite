import { describe, expect, it } from "vitest";
import {
  detectImageFormat,
  fillImageBox,
  fitImageBox,
  lineHeightMm,
  tocSeparatorY,
  tocTitleLines,
} from "../../supabase/functions/_shared/pdf-layout";

// ═══════════════════════════════════════════════════════════════════════════
// A imagem do módulo e o sumário já existiram no export-pdf e sumiram numa
// refatoração, sem que nada acusasse. Estes testes existem para que, se isso
// voltar a acontecer, alguém saiba na hora.
// ═══════════════════════════════════════════════════════════════════════════

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0]);

describe("detectImageFormat", () => {
  it("reconhece PNG pelos bytes", () => {
    expect(detectImageFormat(PNG)).toBe("PNG");
  });

  it("reconhece JPEG pelos bytes", () => {
    expect(detectImageFormat(JPEG)).toBe("JPEG");
  });

  it("devolve null para WebP — o jsPDF não desenha", () => {
    expect(detectImageFormat(WEBP)).toBeNull();
  });

  it("devolve null para GIF", () => {
    expect(detectImageFormat(GIF)).toBeNull();
  });

  it("devolve null para resposta truncada, em vez de estourar", () => {
    expect(detectImageFormat(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(detectImageFormat(new Uint8Array())).toBeNull();
  });

  it("não confia em extensão nem em content-type — só nos bytes", () => {
    // Um WebP servido como "image/jpeg" era tratado como JPEG pela versão
    // anterior, e o addImage falhava sem mensagem. Aqui ele é recusado.
    expect(detectImageFormat(WEBP)).not.toBe("JPEG");
  });
});

describe("fitImageBox", () => {
  const MAX_W = 162; // CONTENT_W do export-pdf
  const MAX_H = 70;

  it("paisagem bem larga ocupa a largura toda", () => {
    // 1600×600 a 162 mm dá 60,75 mm de altura — cabe no teto de 70.
    const { w, h } = fitImageBox(1600, 600, MAX_W, MAX_H);
    expect(w).toBeCloseTo(162, 5);
    expect(h).toBeCloseTo(162 * 600 / 1600, 5);
    expect(h).toBeLessThanOrEqual(MAX_H);
  });

  it("16:9 é limitada pela altura, não pela largura", () => {
    // O caso comum das fotos do Pexels: a 162 mm daria 91 mm de altura e
    // empurraria o texto do módulo para a página seguinte.
    const { w, h } = fitImageBox(1600, 900, MAX_W, MAX_H);
    expect(h).toBeCloseTo(70, 5);
    expect(w).toBeCloseTo(70 * 1600 / 900, 5);
    expect(w).toBeLessThan(MAX_W);
  });

  it("retrato alto é limitado pela altura", () => {
    const { w, h } = fitImageBox(900, 1600, MAX_W, MAX_H);
    expect(h).toBeCloseTo(70, 5);
    expect(w).toBeCloseTo(70 * 900 / 1600, 5);
    expect(w).toBeLessThan(MAX_W);
  });

  it("a proporção sobrevive nos dois casos", () => {
    for (const [iw, ih] of [[1600, 900], [900, 1600], [1000, 1000], [3000, 400]]) {
      const { w, h } = fitImageBox(iw, ih, MAX_W, MAX_H);
      expect(w / h).toBeCloseTo(iw / ih, 4);
    }
  });

  it("nunca ultrapassa a caixa", () => {
    for (const [iw, ih] of [[4000, 100], [100, 4000], [162, 70], [1, 1]]) {
      const { w, h } = fitImageBox(iw, ih, MAX_W, MAX_H);
      expect(w).toBeLessThanOrEqual(MAX_W + 1e-9);
      expect(h).toBeLessThanOrEqual(MAX_H + 1e-9);
    }
  });

  it("dimensão inválida não vira NaN no documento", () => {
    expect(fitImageBox(0, 100, MAX_W, MAX_H)).toEqual({ w: MAX_W, h: MAX_H });
    expect(fitImageBox(Number.NaN, 100, MAX_W, MAX_H)).toEqual({ w: MAX_W, h: MAX_H });
  });
});

describe("tocTitleLines", () => {
  it("título curto passa intacto", () => {
    expect(tocTitleLines(["Fundamentos dos controles internos"])).toEqual([
      "Fundamentos dos controles internos",
    ]);
  });

  it("duas linhas passam intactas", () => {
    const duas = ["Mapeamento e Avaliação de Riscos para o", "Fortalecimento dos Controles"];
    expect(tocTitleLines(duas)).toEqual(duas);
  });

  it("três linhas viram duas, com reticências na segunda", () => {
    const r = tocTitleLines(["Primeira linha", "Segunda linha", "Terceira linha"]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBe("Primeira linha");
    expect(r[1].endsWith("…")).toBe(true);
    expect(r[1]).not.toContain("Terceira");
  });

  it("o corte mantém os pontinhos e o número ancorados na última linha", () => {
    // O limite existe por causa disso: com quatro linhas, o número da página
    // ficava longe do título e o sumário deixava de se ler como tabela.
    const r = tocTitleLines(["a", "b", "c", "d", "e"]);
    expect(r).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A geometria do sumário
//
// No primeiro PDF gerado com o sumário restaurado, um traço fino cortava o
// texto dos títulos. A causa foram duas contas erradas: o traço era posto a
// 1 mm da linha de base do item seguinte — dentro das maiúsculas, que sobem
// 2,67 mm — e o avanço por linha era 5,2 mm enquanto o jsPDF empilha a 4,26.
// ═══════════════════════════════════════════════════════════════════════════

const CORPO = 10.5; // FONT.BODY do export-pdf

describe("lineHeightMm", () => {
  it("bate com o que o jsPDF realmente empilha em corpo 10,5", () => {
    // Medido no PDF gerado: linhas de um mesmo título a 12,1 pt de distância.
    expect(lineHeightMm(CORPO, 1.15)).toBeCloseTo(12.075 / (72 / 25.4), 3);
    expect(lineHeightMm(CORPO, 1.15)).toBeCloseTo(4.26, 2);
  });

  it("não é o 5,2 mm que estava fixo no código", () => {
    expect(lineHeightMm(CORPO, 1.15)).toBeLessThan(5.2);
  });

  it("acompanha o corpo da fonte e o fator", () => {
    expect(lineHeightMm(21, 1.15)).toBeCloseTo(2 * lineHeightMm(10.5, 1.15), 6);
    expect(lineHeightMm(10.5, 2)).toBeCloseTo(2 * lineHeightMm(10.5, 1), 6);
  });
});

describe("tocSeparatorY", () => {
  const VAO = 9; // mm entre a última linha de um item e a base do próximo

  it("fica abaixo das descendentes do item de cima", () => {
    const y = tocSeparatorY(100, VAO, CORPO);
    const descida = (CORPO / (72 / 25.4)) * 0.21;
    expect(y).toBeGreaterThan(100 + descida);
  });

  it("fica acima das maiúsculas do item de baixo", () => {
    const y = tocSeparatorY(100, VAO, CORPO);
    const caixaAlta = (CORPO / (72 / 25.4)) * 0.72;
    expect(y).toBeLessThan(100 + VAO - caixaAlta);
  });

  it("o defeito relatado não se repete: 1 mm acima da base seguinte cortava as letras", () => {
    const baseSeguinte = 100 + VAO;
    const posicaoAntiga = baseSeguinte - 1;
    const caixaAlta = (CORPO / (72 / 25.4)) * 0.72;
    // A posição antiga caía dentro do corpo das letras…
    expect(posicaoAntiga).toBeGreaterThan(baseSeguinte - caixaAlta);
    // …e a nova, não.
    expect(tocSeparatorY(100, VAO, CORPO)).toBeLessThan(baseSeguinte - caixaAlta);
  });

  it("com vão apertado devolve o meio, em vez de uma posição impossível", () => {
    const y = tocSeparatorY(100, 1, CORPO);
    expect(y).toBeCloseTo(100.5, 6);
    expect(Number.isFinite(y)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A capa ficava pequena no meio da faixa reservada: encaixada dentro dela, uma
// imagem 16:9 usava 108,5 dos 162 mm e deixava 53,5 mm de branco que mais
// ninguém aproveita. Estes testes fixam o preenchimento e o limite de recorte.
// ═══════════════════════════════════════════════════════════════════════════

// Faixa real da capa no export-pdf: x=24, y=220, 162 x 62 mm.
const FX = 24, FY = 220, FW = 162, FH = 62;

describe("fillImageBox", () => {
  it("preenche a faixa inteira, sem sobra em nenhum lado", () => {
    const b = fillImageBox(1344, 768, FX, FY, FW, FH);
    expect(b.w).toBeGreaterThanOrEqual(FW);
    expect(b.h).toBeGreaterThanOrEqual(FH);
    expect(b.x).toBeLessThanOrEqual(FX);
    expect(b.y).toBeLessThanOrEqual(FY);
    expect(b.x + b.w).toBeGreaterThanOrEqual(FX + FW);
    expect(b.y + b.h).toBeGreaterThanOrEqual(FY + FH);
  });

  it("não distorce: mantém a proporção do arquivo", () => {
    const b = fillImageBox(1344, 768, FX, FY, FW, FH);
    expect(b.w / b.h).toBeCloseTo(1344 / 768, 6);
  });

  it("centraliza o excedente, cortando igual dos dois lados", () => {
    const b = fillImageBox(1344, 768, FX, FY, FW, FH);
    expect(FX - b.x).toBeCloseTo(b.x + b.w - (FX + FW), 6);
    expect(FY - b.y).toBeCloseTo(b.y + b.h - (FY + FH), 6);
  });

  it("na capa 16:9 recupera os 53,5 mm que ficavam em branco", () => {
    const encaixe = fitImageBox(1344, 768, FW, FH);
    expect(FW - encaixe.w).toBeCloseTo(53.5, 1); // o desperdício de antes
    expect(fillImageBox(1344, 768, FX, FY, FW, FH).w).toBeCloseTo(FW, 6);
  });

  it("marca recortada quando ampliou além da faixa", () => {
    expect(fillImageBox(1344, 768, FX, FY, FW, FH).recortada).toBe(true);
  });

  it("imagem já na proporção da faixa não precisa de recorte", () => {
    const b = fillImageBox(1620, 620, FX, FY, FW, FH);
    expect(b.recortada).toBe(false);
    expect(b.w).toBeCloseTo(FW, 6);
    expect(b.h).toBeCloseTo(FH, 6);
  });

  it("desiste de preencher quando o corte comeria a imagem — foto em pé", () => {
    // 768x1344 numa faixa deitada exigiria descartar 78% da imagem. O que
    // sobraria é uma tira fina; melhor a sobra branca das laterais.
    const b = fillImageBox(768, 1344, FX, FY, FW, FH);
    expect(b.recortada).toBe(false);
    expect(b.w).toBeLessThanOrEqual(FW);
    expect(b.h).toBeLessThanOrEqual(FH + 1e-9);
    expect(b.w / b.h).toBeCloseTo(768 / 1344, 6);
  });

  it("o que sobra do recorte fica dentro do limite aceito", () => {
    const b = fillImageBox(1344, 768, FX, FY, FW, FH);
    const perda = 1 - (FW * FH) / (b.w * b.h);
    expect(perda).toBeLessThanOrEqual(0.6);
  });

  it("dimensões inválidas devolvem a faixa, sem quebrar", () => {
    const b = fillImageBox(0, 0, FX, FY, FW, FH);
    expect(b).toEqual({ x: FX, y: FY, w: FW, h: FH, recortada: false });
  });
});
