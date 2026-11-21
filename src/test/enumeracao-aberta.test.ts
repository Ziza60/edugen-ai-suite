import { describe, expect, it } from "vitest";
import {
  enumeracaoAberta,
  trimToWholeThought,
} from "../../supabase/functions/export-pptx-v7/layout-fit";

// ═══════════════════════════════════════════════════════════════════════════
// TRÊS DOS QUATRO Es
//
// MEDIDO no slide 5 do deck de 21/11/2026, renderizado e olhado. O cartão que
// define "Auditoria Operacional" termina assim, sem ponto final:
//
//   "...estão funcionando de acordo com os princípios de economicidade,
//    eficiência, eficácia"
//
// Para um auditor isso não é apenas uma frase truncada: lido como está, afirma
// que efetividade não é um dos princípios da auditoria operacional.
//
// `capText` já chamava `trimToWholeThought` em todo corte — e ela não pegava
// este, porque nenhuma das suas regras se aplica: não há preposição pendurada,
// não há oração órfã, e "eficácia" é um substantivo inteiro. O que está
// quebrado é a ENUMERAÇÃO.
//
// O sinal é a pontuação: em português uma lista fecha com "e" ou "ou". Dois ou
// mais segmentos separados por vírgula, sem conjunção nenhuma e sem ponto
// final, é lista cortada no meio.
// ═══════════════════════════════════════════════════════════════════════════

const CARTAO_DO_SLIDE_5 =
  "Exame independente, objetivo e confiável que analisa se empreendimentos, " +
  "sistemas, operações, programas, atividades ou organizações do governo estão " +
  "funcionando de acordo com os princípios de economicidade, eficiência, eficácia";

describe("O CASO MEDIDO", () => {
  it("a lista aberta sai inteira, com a palavra que a introduz", () => {
    // Sozinha, a regra para em "...princípios de": quem tira a preposição
    // pendurada é a regra seguinte da cadeia, e o teste abaixo cobre o conjunto.
    // Dividir assim é de propósito — cada regra responde por uma coisa só.
    const r = enumeracaoAberta(CARTAO_DO_SLIDE_5);
    expect(r).toMatch(/de acordo com os princípios de$/);
    expect(r).not.toContain("economicidade");
  });

  it("e o que sobra é verdadeiro e completo", () => {
    // Não basta cortar: o que fica tem de poder ser lido em voz alta.
    const r = trimToWholeThought(CARTAO_DO_SLIDE_5);
    expect(r.endsWith("princípios")).toBe(true);
    expect(r).toContain("Exame independente, objetivo e confiável");
  });

  it("a enumeração FECHADA no meio da frase não é tocada", () => {
    // "programas, atividades ou organizações" tem conjunção: está inteira, e a
    // regra não pode usá-la como ponto de corte.
    expect(trimToWholeThought(CARTAO_DO_SLIDE_5)).toContain(
      "programas, atividades ou organizações",
    );
  });
});

describe("o que a regra NÃO pode tocar", () => {
  it("lista fechada com 'e'", () => {
    const t = "Avalia economicidade, eficiência, eficácia e efetividade";
    expect(enumeracaoAberta(t)).toBe(t);
  });

  it("lista fechada com 'ou'", () => {
    const t = "Pode ser qualitativo, quantitativo, geral ou específico";
    expect(enumeracaoAberta(t)).toBe(t);
  });

  it("frase que termina em ponto final", () => {
    const t = "A matriz organiza questões, critérios, informações.";
    expect(enumeracaoAberta(t)).toBe(t);
  });

  it("uma vírgula só não é enumeração", () => {
    const t = "O planejamento é uma fase complexa, fundamental para a auditoria";
    expect(enumeracaoAberta(t)).toBe(t);
  });

  it("texto sem vírgula nenhuma", () => {
    const t = "Grau de alcance das metas programadas";
    expect(enumeracaoAberta(t)).toBe(t);
  });

  it("não dissolve o fragmento quando sobraria pouco", () => {
    // Cortar aqui deixaria quase nada; o ragged é melhor que o vazio.
    const t = "Critérios: relevância, clareza, completude";
    expect(enumeracaoAberta(t)).toBe(t);
  });

  it("entrada vazia não quebra", () => {
    expect(enumeracaoAberta("")).toBe("");
    expect(enumeracaoAberta("   ")).toBe("");
  });
});

describe("casos reais do acervo que já passavam", () => {
  it("oração órfã continua sendo removida", () => {
    expect(trimToWholeThought("Documente a decisão tomada, garantindo que o controle"))
      .not.toContain("garantindo que o controle");
  });

  it("preposição pendurada continua sendo removida", () => {
    expect(trimToWholeThought("Analisar os riscos do programa de")).toBe(
      "Analisar os riscos do programa",
    );
  });

  it("classificador de uma letra sobrevive", () => {
    expect(trimToWholeThought("Categoria A")).toBe("Categoria A");
  });
});
