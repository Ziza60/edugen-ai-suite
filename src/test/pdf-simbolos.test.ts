import { describe, expect, it } from "vitest";
import { transliterarSimbolos } from "../../supabase/functions/_shared/pdf-layout";

// ═══════════════════════════════════════════════════════════════════════════
// Na tabela de conferência dos mínimos constitucionais, a apostila trouxe
// «Verificar se Gasto Efetivo "e Mínimo Saúde». O autor escreveu «Gasto Efetivo
// ≥ Mínimo Saúde».
//
// As fontes padrão do PDF usam WinAnsi, que alcança o Latin-1 e pouco mais. O ≥
// (U+2265) está fora. O jsPDF não avisa nem desenha um quadradinho: emite os
// bytes como se fossem Latin-1 e o leitor mostra o que calhar. O texto sai
// ERRADO em vez de sair faltando — pior, porque ninguém nota pela ausência.
// ═══════════════════════════════════════════════════════════════════════════

describe("transliterarSimbolos — o caso relatado", () => {
  it("o maior-ou-igual vira >=", () => {
    expect(transliterarSimbolos("Verificar se Gasto Efetivo ≥ Mínimo Saúde."))
      .toBe("Verificar se Gasto Efetivo >= Mínimo Saúde.");
  });

  it("o menor-ou-igual e o diferente também têm equivalente", () => {
    expect(transliterarSimbolos("Empenho ≤ Dotação")).toBe("Empenho <= Dotação");
    expect(transliterarSimbolos("Meta ≠ Realizado")).toBe("Meta != Realizado");
  });

  it("setas viram texto em vez de sumirem", () => {
    expect(transliterarSimbolos("PPA → LDO → LOA")).toBe("PPA -> LDO -> LOA");
  });
});

describe("transliterarSimbolos — não estraga o português", () => {
  it("acentos e cedilha passam intactos", () => {
    const t = "Execução orçamentária: previsão, lançamento, arrecadação e recolhimento.";
    expect(transliterarSimbolos(t)).toBe(t);
  });

  it("preserva os caracteres do Latin-1 que a fonte desenha", () => {
    const t = "Ação º ª § ± ÷ × ¢ £ ¹ ² ³ ¼ ½ æ Ø ñ ü ý þ ÿ";
    expect(transliterarSimbolos(t)).toBe(t);
  });

  it("a pontuação tipográfica vira a de máquina, sem sumir", () => {
    expect(transliterarSimbolos("O PPA — peça de médio prazo — “orienta” a LDO…"))
      .toBe('O PPA - peça de médio prazo - "orienta" a LDO...');
  });

  it("é idempotente: aplicar duas vezes dá o mesmo", () => {
    const t = "Gasto ≥ Mínimo — “conforme” a LRF…";
    const uma = transliterarSimbolos(t);
    expect(transliterarSimbolos(uma)).toBe(uma);
  });

  it("texto sem símbolo estranho não muda", () => {
    const t = "Art. 165, § 1º, da CF/88.";
    expect(transliterarSimbolos(t)).toBe(t);
  });
});

describe("transliterarSimbolos — a rede final", () => {
  it("o que não tem tradução e a fonte não desenha sai, em vez de sair mutilado", () => {
    // Ideogramas e emoji não pertencem a um curso em português, mas quando
    // aparecem é melhor a ausência do que bytes soltos no meio da frase.
    expect(transliterarSimbolos("Total 漢字 final")).toBe("Total  final");
    expect(transliterarSimbolos("Meta 🎯 atingida")).toBe("Meta  atingida");
  });

  it("espaço fino e travessão condicional viram espaço e hífen comuns", () => {
    expect(transliterarSimbolos("10 000")).toBe("10 000");
    expect(transliterarSimbolos("pré‑requisito")).toBe("pré-requisito");
  });

  it("marcadores de lista viram hífen", () => {
    expect(transliterarSimbolos("• primeiro ● segundo")).toBe("- primeiro - segundo");
  });

  it("vazio e nulo não quebram", () => {
    expect(transliterarSimbolos("")).toBe("");
    expect(transliterarSimbolos(null as unknown as string)).toBe("");
    expect(transliterarSimbolos(undefined as unknown as string)).toBe("");
  });
});
