import { describe, expect, it } from "vitest";
import { medidorSemKerning } from "../../supabase/functions/_shared/pdf-layout";

// ═══════════════════════════════════════════════════════════════════════════
// O defeito "PPAé" / "PPAà" / "PPApara" / "Tomadade Contas"
//
// Veio de uma avaliação do material gerado e foi confirmado no PDF: na frase
// "O PPA é mais do que um documento legal", o espaço depois de PPA mede 1,51 pt
// enquanto os outros espaços da MESMA linha medem de 2,7 a 3,0.
//
// O parágrafo justificado é desenhado palavra a palavra, avançando
// `x += getTextWidth(palavra) + folga`. O getTextWidth do jsPDF aplica o
// KERNING da fonte; o doc.text() desenha um `Tj` simples, sem kerning. A
// palavra ocupa mais espaço do que foi medido, e a diferença sai do espaço
// seguinte. Medido na própria biblioteca, a 10,5 pt:
//
//   getTextWidth("PPA")    19,53 pt   soma caractere a caractere  20,79 pt
//   getTextWidth("Tomada") 36,96 pt   soma caractere a caractere  38,22 pt
//   getTextWidth("LDO")    21,52 pt   soma caractere a caractere  21,52 pt
//
// Só erra quem tem par de kerning: "PA" e "To" têm, "LDO"/"LOA"/"RGF" não — e
// era exatamente essa a lista do relato, o que fecha o diagnóstico.
//
// O medidor falso abaixo imita esse comportamento do jsPDF. Assim o teste
// falha se alguém trocar a medição caractere a caractere por uma chamada com a
// palavra inteira, que é a "otimização" que traz o defeito de volta.
// ═══════════════════════════════════════════════════════════════════════════

/** Larguras reais da Helvetica (AFM), em milésimos de em. */
const LARGURA: Record<string, number> = {
  P: 667, A: 667, T: 611, o: 556, m: 833, a: 556, d: 556, e: 556, s: 500,
  C: 722, n: 556, t: 278, L: 556, D: 722, O: 778, R: 722, G: 778, F: 611,
  "ç": 500, "ã": 556, " ": 278,
};
const KERNING: Record<string, number> = { PA: -120, To: -80 };
const CORPO = 10.5;

/** Imita o doc.getTextWidth do jsPDF: aplica kerning em texto de 2+ letras. */
const comoOJsPdf = (t: string): number => {
  let mil = 0;
  for (const ch of t) mil += LARGURA[ch] ?? 500;
  for (let i = 0; i < t.length - 1; i++) mil += KERNING[t.slice(i, i + 2)] ?? 0;
  return (mil / 1000) * CORPO;
};

describe("medidorSemKerning — o caso relatado", () => {
  it("mede a palavra como ela é DESENHADA, não como o jsPDF a mede", () => {
    const medir = medidorSemKerning(comoOJsPdf);
    // P + P + A = 2001 milésimos de em, a 10,5 pt
    expect(medir("PPA")).toBeCloseTo((2001 / 1000) * CORPO, 6);
    // 1,26 pt mais larga do que o jsPDF diria — o buraco que sumia do espaço
    expect(medir("PPA") - comoOJsPdf("PPA")).toBeCloseTo((120 / 1000) * CORPO, 6);
  });

  it("pega também o par To, que é o caso do 'Tomadade Contas'", () => {
    const medir = medidorSemKerning(comoOJsPdf);
    expect(medir("Tomada") - comoOJsPdf("Tomada")).toBeCloseTo((80 / 1000) * CORPO, 6);
  });

  it("não mexe em palavra sem par de kerning — LDO, LOA e RGF nunca erraram", () => {
    const medir = medidorSemKerning(comoOJsPdf);
    for (const p of ["LDO", "LOA", "RGF"]) {
      expect(medir(p), p).toBeCloseTo(comoOJsPdf(p), 6);
    }
  });
});

describe("medidorSemKerning — a garantia que impede a regressão", () => {
  it("nunca entrega mais de um caractere ao medidor", () => {
    const recebidos: string[] = [];
    const medir = medidorSemKerning((t) => {
      recebidos.push(t);
      return comoOJsPdf(t);
    });
    medir("Tomada de Contas");
    expect(recebidos.length).toBeGreaterThan(0);
    expect(recebidos.every((t) => [...t].length === 1)).toBe(true);
  });

  it("mede cada caractere uma vez só, por mais que a palavra se repita", () => {
    let chamadas = 0;
    const medir = medidorSemKerning((t) => {
      chamadas++;
      return comoOJsPdf(t);
    });
    for (let i = 0; i < 50; i++) medir("PPA");
    expect(chamadas).toBe(2); // P e A
  });
});

describe("medidorSemKerning — bordas", () => {
  it("acentuada conta como um caractere só", () => {
    const medir = medidorSemKerning(comoOJsPdf);
    const esperado = comoOJsPdf("a") + comoOJsPdf("ç") + comoOJsPdf("ã") + comoOJsPdf("o");
    expect(medir("ação")).toBeCloseTo(esperado, 6);
  });

  it("caractere sem largura não derruba a conta nem vira NaN", () => {
    const medir = medidorSemKerning((t) => (t === " " ? NaN : comoOJsPdf(t)));
    const largura = medir("PA ");
    expect(Number.isFinite(largura)).toBe(true);
    expect(largura).toBeCloseTo(comoOJsPdf("P") + comoOJsPdf("A"), 6);
  });

  it("palavra vazia mede zero", () => {
    expect(medidorSemKerning(comoOJsPdf)("")).toBe(0);
  });
});
