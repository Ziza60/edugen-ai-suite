import { describe, expect, it } from "vitest";
import { rotuloDoNucleo } from "../../supabase/functions/export-pptx-v7/layout-fit";

// ═══════════════════════════════════════════════════════════════════════════
// O slide "PPA: O Plano Plurianual" saiu com o núcleo do diagrama escrito
// "PPA: Plano". A regra antiga era "descarte as palavras de ligação e fique
// com as duas primeiras": sobravam "PPA:" e "Plano", e o rótulo terminava em
// dois-pontos, prometendo uma continuação que não vinha. Quem lê não vê um
// resumo, vê um defeito.
//
// O dois-pontos num título separa o NOME da sua explicação. Fica-se com um
// lado inteiro ou com o outro, nunca com um pedaço de cada.
// ═══════════════════════════════════════════════════════════════════════════

describe("rotuloDoNucleo — o caso relatado", () => {
  it("devolve a sigla, não 'PPA: Plano'", () => {
    expect(rotuloDoNucleo("PPA: O Plano Plurianual", 2, 18)).toBe("PPA");
  });

  it("nunca termina em dois-pontos ou outro sinal de divisa", () => {
    for (const t of [
      "PPA: O Plano Plurianual",
      "LDO: A Lei de Diretrizes Orçamentárias",
      "Controle Interno — Função Primordial",
      "Execução Orçamentária: Gerenciando Receitas e Despesas",
    ]) {
      expect(rotuloDoNucleo(t, 2, 18), t).not.toMatch(/[:;,\-–—]$/);
    }
  });
});

describe("rotuloDoNucleo — quando o nome não cabe", () => {
  it("nome longo demais cede lugar à explicação", () => {
    // "Prestação de Contas Anual" tem 25 caracteres e não cabe em 18.
    expect(rotuloDoNucleo("Prestação de Contas Anual: O Fechamento", 2, 18))
      .toBe("Fechamento");
  });

  it("sem dois-pontos, usa o título e descarta as ligações", () => {
    expect(rotuloDoNucleo("Os Pilares da Gestão Fiscal", 2, 18)).toBe("Pilares Gestão");
  });

  it("duas palavras que estouram o limite viram a primeira, inteira", () => {
    expect(rotuloDoNucleo("Transparência Orçamentária Municipal", 2, 18))
      .toBe("Transparência");
  });

  it("palavra única longa demais é cortada com reticência, avisando que há mais", () => {
    const r = rotuloDoNucleo("Responsabilização", 2, 12);
    expect(r).toMatch(/…$/);
    expect(r.length).toBeLessThanOrEqual(12);
  });
});

describe("rotuloDoNucleo — bordas", () => {
  it("título só de palavras de ligação não devolve vazio", () => {
    expect(rotuloDoNucleo("A e O", 2, 18)).toBe("A e");
  });

  it("título vazio devolve vazio", () => {
    expect(rotuloDoNucleo("", 2, 18)).toBe("");
    expect(rotuloDoNucleo("   ", 2, 18)).toBe("");
  });

  it("dois-pontos no começo não vira nome vazio", () => {
    expect(rotuloDoNucleo(": Plano Plurianual", 2, 18)).toBe("Plano Plurianual");
  });

  it("respeita o limite de palavras e de caracteres pedido", () => {
    for (const t of [
      "Ciclo do Orçamento Público Municipal",
      "PPA: O Plano Plurianual",
      "Componentes Essenciais do Controle Interno",
    ]) {
      const r = rotuloDoNucleo(t, 2, 18);
      expect(r.length, t).toBeLessThanOrEqual(18);
      expect(r.split(/\s+/).length, t).toBeLessThanOrEqual(2);
    }
  });
});
