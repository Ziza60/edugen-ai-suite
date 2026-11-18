import { describe, expect, it } from "vitest";
import {
  containsLikelyUnsupportedNumber, numerosSemFonte,
} from "../../supabase/functions/_shared/course-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// O BLOQUEADOR DE NÚMEROS SEM FONTE ACUSAVA A CONTA CERTA
//
// Em 18/11/2026 a primeira tentativa de gerar curso a partir de um PDF não
// produziu curso. O módulo 3 foi rejeitado três vezes com "Números não
// localizados nas fontes" seguido de "sem conteúdo entregável", e o job ficou
// pendente até esgotar as tentativas.
//
// A causa, medida aqui: o teste era "este número aparece LITERALMENTE no
// trecho?", e um único acerto bloqueava o módulo inteiro. Num curso que ensina
// qualquer coisa quantitativa, todo módulo faz conta — e o resultado da conta
// nunca está literalmente na fonte.
//
// Este arquivo trava o comportamento novo e guarda o antigo como evidência.
// ═══════════════════════════════════════════════════════════════════════════

const FONTE = "[S1] A clínica faturou R$ 60.000,00 no mês e tem 35% de custos variáveis.";

describe("o que o bloqueador deve e não deve acusar", () => {
  it("número literal da fonte passa", () => {
    expect(numerosSemFonte("O faturamento é de R$ 60.000,00.", FONTE).semFonte)
      .toEqual([]);
    expect(numerosSemFonte("Os custos variáveis são 35%.", FONTE).semFonte)
      .toEqual([]);
  });

  it("número inventado é acusado — é para isto que a regra existe", () => {
    const r = numerosSemFonte("O aluguel é de R$ 7.000,00.", FONTE);
    expect(r.semFonte.length).toBe(1);
  });

  it("ANO deixa de ser acusado", () => {
    // `\b\d{4}\b` pegava 2024, 1500, 3000 — qualquer número acima de mil
    // escrito sem separador. Não distingue estatística inventada de "1500
    // minutos", e era o padrão que mais reprovava módulo.
    expect(numerosSemFonte("Em 2024 o setor cresceu.", FONTE).semFonte).toEqual([]);
    expect(numerosSemFonte("O procedimento leva 1500 minutos.", FONTE).semFonte)
      .toEqual([]);
  });

  it("a CONTA derivada da fonte ainda é acusada, mas agora com proporção", () => {
    // Ela continua na lista — detectar derivação com segurança não é possível
    // aqui. O que muda é que a proporção permite entregar com aviso em vez de
    // reprovar: ver o chamador em validateModuleDocument.
    const r = numerosSemFonte(
      "35% de R$ 60.000,00 = R$ 21.000,00, e o saldo fica em R$ 39.000,00.",
      FONTE,
    );
    // O regex de dinheiro engole a pontuação final, então o item vem como
    // "R$ 21.000,00," — isso NÃO quebra o casamento com a fonte, porque
    // `normalizeForMatch` troca pontuação por espaço (verificado), mas aparece
    // na mensagem do laudo.
    expect(r.semFonte.join(" ")).toMatch(/R\$ ?21\.000,00/);
    expect(r.examinados).toBeGreaterThan(r.semFonte.length);
  });

  it("a proporção distingue 'fez conta' de 'inventou tudo'", () => {
    const fezConta = numerosSemFonte(
      "Partindo de R$ 60.000,00 e 35%, temos R$ 21.000,00. Com R$ 60.000,00 " +
      "e 35% em outro mês, 35% de R$ 60.000,00 dá o mesmo.",
      FONTE,
    );
    expect(fezConta.semFonte.length / fezConta.examinados).toBeLessThan(0.5);

    const inventouTudo = numerosSemFonte(
      "O aluguel é R$ 7.000,00, os salários R$ 12.000,00 e a margem é 18%.",
      FONTE,
    );
    expect(inventouTudo.semFonte.length / inventouTudo.examinados).toBeGreaterThan(0.5);
  });

  it("texto sem número nenhum não acusa e não divide por zero", () => {
    const r = numerosSemFonte("Nenhum valor aqui.", FONTE);
    expect(r).toEqual({ semFonte: [], examinados: 0 });
  });

  it("containsLikelyUnsupportedNumber continua devolvendo só a lista", () => {
    expect(containsLikelyUnsupportedNumber("O aluguel é de R$ 7.000,00.", FONTE))
      .toEqual(numerosSemFonte("O aluguel é de R$ 7.000,00.", FONTE).semFonte);
  });
});
