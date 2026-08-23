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

// ═══════════════════════════════════════════════════════════════════════════
// A RAIZ QUADRADA QUE EU APAGUEI
//
// Curso de estoque, PDF de 23/08. A apostila imprimia, em sequência:
//
//     LEC = ((2 * 1200 * 50) / 3)
//     LEC = ((120000) / 3)
//     LEC = (40000)
//     LEC = 200 unidades
//
// Sem o √, a última linha é falsa: 40000 não é 200. O PPTX mostrava a fórmula
// certa — só o PDF perdia o símbolo, porque só ele passa por esta função.
//
// A culpa é da rede de segurança que eu mesmo escrevi: ela remove tudo acima do
// Latin-1, e √ (U+221A) está acima. Remover é o certo, a fonte não desenha o que
// não conhece. Errado era não ter equivalente no mapa — e apagar calado.
// ═══════════════════════════════════════════════════════════════════════════

describe("símbolos de matemática", () => {
  it("a raiz quadrada vira sqrt, e a conta volta a fechar", () => {
    expect(transliterarSimbolos("LEC = √((2 * D * CP) / CM)"))
      .toBe("LEC = sqrt((2 * D * CP) / CM)");
    expect(transliterarSimbolos("LEC = √(40000) = 200"))
      .toBe("LEC = sqrt(40000) = 200");
  });

  it("multiplicação e divisão do Latin-1 ficam intactas", () => {
    // × e ÷ a fonte desenha; traduzi-los pioraria texto que já estava certo.
    expect(transliterarSimbolos("3 × 4 ÷ 2")).toBe("3 × 4 ÷ 2");
  });

  it("expoentes fora do Latin-1 viram notação legível", () => {
    expect(transliterarSimbolos("10⁶ unidades")).toBe("10^6 unidades");
  });

  it("os que o Latin-1 já desenha ficam como estão", () => {
    // ², ³, °, ½ e µ são Latin-1: a fonte os desenha, não há o que traduzir.
    expect(transliterarSimbolos("2 m² a 25 °C, ½ de µm")).toBe("2 m² a 25 °C, ½ de µm");
  });

  it("nenhum caractere fora do Latin-1 sobrevive", () => {
    const r = transliterarSimbolos("√ ⨯ ∑ Δ π ⅓ ≫");
    expect(r).toMatch(/^[ -ÿ]*$/);
    expect(r).toContain("sqrt");
  });
});
