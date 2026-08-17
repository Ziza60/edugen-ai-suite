import { describe, expect, it } from "vitest";
import {
  chevronCenterX,
  chevronNotch,
  chevronNumberBox,
  chevronSafeSpan,
} from "../../supabase/functions/export-pptx-v7/chevron-geometry";
import {
  CATEGORICAL_DARK,
  CATEGORICAL_OVERFLOW,
  categoricalColors,
} from "../../supabase/functions/export-pptx-v7/chart-palette";

// ═══════════════════════════════════════════════════════════════════════════
// Dois defeitos vistos no deck entregue:
//  1. o número do chevron aparecia deslocado para a direita;
//  2. as cinco fatias da rosca eram cinco laranjas quase idênticos.
// O primeiro é geometria, o segundo é escolha de cor. Os dois viraram função
// pura para poderem ser medidos aqui em vez de conferidos a olho.
// ═══════════════════════════════════════════════════════════════════════════

// Medidas reais do slide de processo com 5 itens: CW = 13,333 − 0,7 − 0,7,
// vão de 0,1 entre chevrons.
const CW = 13.333 - 1.4;
const N = 5;
const CH_W = (CW - 0.1 * (N - 1)) / N;
const CH_H = 1.5;
const NUM_H = 0.62;

/**
 * Borda esquerda e direita da forma preenchida, a uma distância `dy` do meio.
 * Vem direto do contorno do preset: o entalhe fecha em x1 no meio e some no
 * topo/base; o bico faz o inverso.
 */
function bordas(w: number, h: number, dy: number) {
  const x1 = chevronNotch(w, h);
  const u = (2 * Math.abs(dy)) / h; // 0 no meio, 1 no topo/base
  return { esq: x1 * (1 - u), dir: w - x1 * u };
}

describe("chevronNotch", () => {
  it("usa min(w,h)/2, que é o ajuste padrão do preset", () => {
    expect(chevronNotch(2.31, 1.5)).toBeCloseTo(0.75, 6);
    expect(chevronNotch(1.0, 1.5)).toBeCloseTo(0.5, 6);
  });
});

describe("chevronCenterX", () => {
  it("é w/2 — entalhe e bico têm a mesma área e se anulam", () => {
    expect(chevronCenterX(CH_W)).toBeCloseTo(CH_W / 2, 6);
  });

  it("confere contra o centroide calculado por integração numérica", () => {
    // Varre a forma em fatias horizontais e acha o centro de massa de fato.
    const passos = 20000;
    let somaMomento = 0;
    let somaArea = 0;
    for (let k = 0; k < passos; k++) {
      const yy = ((k + 0.5) / passos) * CH_H;
      const { esq, dir } = bordas(CH_W, CH_H, yy - CH_H / 2);
      const larg = dir - esq;
      somaArea += larg;
      somaMomento += larg * ((esq + dir) / 2);
    }
    expect(somaMomento / somaArea).toBeCloseTo(chevronCenterX(CH_W), 4);
  });
});

describe("chevronSafeSpan", () => {
  it("o limite esquerdo é o ápice do entalhe, no meio da altura", () => {
    expect(chevronSafeSpan(CH_W, CH_H, NUM_H).esquerda)
      .toBeCloseTo(chevronNotch(CH_W, CH_H), 6);
  });

  it("o limite direito recua conforme a caixa é mais alta", () => {
    const baixa = chevronSafeSpan(CH_W, CH_H, 0.2).direita;
    const alta = chevronSafeSpan(CH_W, CH_H, 1.2).direita;
    expect(alta).toBeLessThan(baixa);
  });

  it("a faixa devolvida está de fato dentro da forma em toda a altura da caixa", () => {
    const { esquerda, direita } = chevronSafeSpan(CH_W, CH_H, NUM_H);
    for (let k = 0; k <= 40; k++) {
      const dy = (k / 40 - 0.5) * NUM_H;
      const b = bordas(CH_W, CH_H, dy);
      expect(esquerda).toBeGreaterThanOrEqual(b.esq - 1e-9);
      expect(direita).toBeLessThanOrEqual(b.dir + 1e-9);
    }
  });
});

describe("chevronNumberBox", () => {
  it("centra o número no centro visual da forma", () => {
    const c = chevronNumberBox(CH_W, CH_H, NUM_H);
    expect(c.dx + c.w / 2).toBeCloseTo(chevronCenterX(CH_W), 9);
  });

  it("o código antigo empurrava o número ~0,22 pol para a direita", () => {
    // Reproduz a conta anterior para registrar o tamanho do erro corrigido.
    const x1 = chevronNotch(CH_W, CH_H);
    const antigoX = x1;
    const antigoW = Math.max(0.4, CH_W - x1 - x1 * (NUM_H / CH_H));
    const centroAntigo = antigoX + antigoW / 2;
    expect(centroAntigo - chevronCenterX(CH_W)).toBeCloseTo(0.22, 2);
  });

  it("a caixa cabe inteira dentro da forma", () => {
    const c = chevronNumberBox(CH_W, CH_H, NUM_H);
    const { esquerda, direita } = chevronSafeSpan(CH_W, CH_H, NUM_H);
    expect(c.dx).toBeGreaterThanOrEqual(esquerda - 1e-9);
    expect(c.dx + c.w).toBeLessThanOrEqual(direita + 1e-9);
  });

  it("sobra largura de sobra para um dígito de 26 pt (~0,25 pol)", () => {
    expect(chevronNumberBox(CH_W, CH_H, NUM_H).w).toBeGreaterThan(0.5);
  });

  it("continua centrada e contida de 1 a 5 chevrons", () => {
    for (let n = 1; n <= 5; n++) {
      const w = (CW - 0.1 * (n - 1)) / n;
      const c = chevronNumberBox(w, CH_H, NUM_H);
      expect(c.dx + c.w / 2).toBeCloseTo(w / 2, 9);
      expect(c.w).toBeGreaterThan(0.5);
      const span = chevronSafeSpan(w, CH_H, NUM_H);
      expect(c.dx).toBeGreaterThanOrEqual(span.esquerda - 1e-9);
      expect(c.dx + c.w).toBeLessThanOrEqual(span.direita + 1e-9);
    }
  });

  it("centra na vertical", () => {
    const c = chevronNumberBox(CH_W, CH_H, NUM_H);
    expect(c.dy + c.h / 2).toBeCloseTo(CH_H / 2, 9);
  });

  it("não devolve largura negativa numa forma degenerada", () => {
    const c = chevronNumberBox(0.4, 4.0, 3.9);
    expect(c.w).toBeGreaterThanOrEqual(0);
  });
});

describe("categoricalColors", () => {
  it("devolve exatamente n cores", () => {
    expect(categoricalColors(5)).toHaveLength(5);
    expect(categoricalColors(0)).toHaveLength(0);
  });

  it("segue a ordem fixa — a ordem é o que garante vizinhos distinguíveis", () => {
    expect(categoricalColors(3)).toEqual(["3987E5", "D95926", "199E70"]);
  });

  it("nunca cicla: a nona cor não repete a primeira", () => {
    const c = categoricalColors(10);
    expect(c[8]).toBe(CATEGORICAL_OVERFLOW);
    expect(c[9]).toBe(CATEGORICAL_OVERFLOW);
    expect(c[8]).not.toBe(c[0]);
  });

  it("todas as cores das 5 fatias são diferentes entre si", () => {
    // O defeito original: cinco fatias, cinco laranjas quase iguais.
    const c = categoricalColors(5);
    expect(new Set(c).size).toBe(5);
  });

  it("as matizes vizinhas não são tons da mesma cor", () => {
    // O que separava mal as fatias antigas não era brilho, era MATIZ: laranja
    // claro e laranja escuro estão longe em RGB e coladas no círculo de cores.
    // Então a checagem é sobre o ângulo de matiz, não sobre distância RGB.
    const matiz = (hex: string) => {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), dl = max - min;
      if (dl === 0) return 0;
      const h = max === r
        ? ((g - b) / dl + 6) % 6
        : max === g
        ? (b - r) / dl + 2
        : (r - g) / dl + 4;
      return h * 60;
    };
    const separacao = (a: string, b: string) => {
      const dif = Math.abs(matiz(a) - matiz(b)) % 360;
      return Math.min(dif, 360 - dif);
    };

    const c = categoricalColors(6);
    for (let i = 0; i < c.length - 1; i++) {
      expect(separacao(c[i], c[i + 1])).toBeGreaterThan(25);
    }
    // O par que o produto usava antes (accent/accent2 do tema "Gold & Dark"):
    // 5° de diferença de matiz — os "cinco laranjas" da reclamação.
    expect(separacao("D9810A", "F0B23C")).toBeLessThan(15);
  });

  it("a lista de referência tem as 8 matizes", () => {
    expect(CATEGORICAL_DARK).toHaveLength(8);
    expect(new Set(CATEGORICAL_DARK).size).toBe(8);
  });
});
