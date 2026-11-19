import { describe, expect, it } from "vitest";
import {
  decidirRetentativaTransiente, ESPERA_TRANSIENTE_MS, TRANSIENT_STATUSES,
  severidadeDosNumerosSemFonte, PISO_PARA_PROPORCAO, PROPORCAO_QUE_REPROVA,
} from "../../supabase/functions/_shared/course-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// UM 503 NUMA CHAMADA DE QUATRO DESTRUÍA O MÓDULO INTEIRO
//
// MEDIDO no curso de 19/11/2026, log das 18:14:
//
//   18:14:30  AI call  module_4_lesson_4.3
//   18:14:31  503  "This model is currently experiencing high demand. Spikes in
//                   demand are usually temporary. Please try again later."
//   18:14:31  Módulo 4 (índice 3, tentativa 1/3) falhou
//
// Envelope e as lições 4.1 e 4.2 já estavam prontos — 67 segundos de trabalho —
// e foram jogados fora por causa da quarta chamada.
//
// POR QUE NÃO HOUVE RETENTATIVA NENHUMA: o 429 tinha a sua, com 1,5 s de espera
// no mesmo candidato. O 503 caía no `break`, que vai para o PRÓXIMO MODELO — e
// `getModelFallbacks` devolve UM candidato só para as lições. Sem segundo
// candidato, o `break` saía do laço e a função lançava.
//
// A PROVA de que era transitório está no mesmo log: a retentativa do MÓDULO
// refez tudo e a mesma lição 4.3 passou às 18:15:50.
//
// OS TEMPOS SÃO JULGAMENTO, NÃO MEDIÇÃO. Não sei quanto dura um pico de demanda
// do Gemini; o log só prova que 79 s depois funcionou.
// ═══════════════════════════════════════════════════════════════════════════

const PRAZO_FOLGADO = 90_000;

describe("sobrecarga do servidor é repetida", () => {
  it("503 na primeira vez: repete, com a primeira espera", () => {
    const d = decidirRetentativaTransiente(503, 0, PRAZO_FOLGADO);
    expect(d.repetir).toBe(true);
    expect(d.esperaMs).toBe(ESPERA_TRANSIENTE_MS[0]);
    expect(d.motivo).toBe("sobrecarga");
  });

  it("503 na segunda vez: repete, com a espera maior", () => {
    const d = decidirRetentativaTransiente(503, 1, PRAZO_FOLGADO);
    expect(d.repetir).toBe(true);
    expect(d.esperaMs).toBe(ESPERA_TRANSIENTE_MS[1]);
    expect(d.esperaMs).toBeGreaterThan(ESPERA_TRANSIENTE_MS[0]);
  });

  it("503 na terceira vez: para, por retentativas esgotadas", () => {
    const d = decidirRetentativaTransiente(503, 2, PRAZO_FOLGADO);
    expect(d.repetir).toBe(false);
    expect(d.motivo).toBe("retentativas-esgotadas");
  });

  it("500, 502 e 504 também são sobrecarga do servidor", () => {
    for (const status of [500, 502, 504]) {
      expect(decidirRetentativaTransiente(status, 0, PRAZO_FOLGADO).repetir, String(status))
        .toBe(true);
    }
  });
});

describe("o que NÃO se repete", () => {
  it("400 é erro de conteúdo ou schema — repetir não muda nada", () => {
    const d = decidirRetentativaTransiente(400, 0, PRAZO_FOLGADO);
    expect(d.repetir).toBe(false);
    expect(d.motivo).toBe("status-definitivo");
  });

  it("401, 403, 404 e 422 não são repetidos", () => {
    for (const status of [401, 403, 404, 422]) {
      expect(decidirRetentativaTransiente(status, 0, PRAZO_FOLGADO).repetir, String(status))
        .toBe(false);
    }
  });

  it("429 não passa por aqui — ele tem a retentativa dele, antes desta", () => {
    // Se 429 entrasse nesta lista, haveria duas retentativas para o mesmo erro,
    // cada uma achando que é a única.
    expect(TRANSIENT_STATUSES.has(429)).toBe(false);
    expect(decidirRetentativaTransiente(429, 0, PRAZO_FOLGADO).motivo)
      .toBe("status-definitivo");
  });
});

describe("o prazo manda", () => {
  it("sem prazo para a espera MAIS a chamada, não dorme", () => {
    // Dormir e acordar sem tempo para a chamada é perder duas vezes: o prazo
    // deste projeto é absoluto e já custou um worker estourado antes.
    const d = decidirRetentativaTransiente(503, 0, ESPERA_TRANSIENTE_MS[0] + 1000);
    expect(d.repetir).toBe(false);
    expect(d.motivo).toBe("sem-prazo");
  });

  it("com prazo justo, mas suficiente, repete", () => {
    const d = decidirRetentativaTransiente(503, 0, ESPERA_TRANSIENTE_MS[0] + 6000);
    expect(d.repetir).toBe(true);
  });

  it("prazo zero ou negativo nunca dorme", () => {
    expect(decidirRetentativaTransiente(503, 0, 0).repetir).toBe(false);
    expect(decidirRetentativaTransiente(503, 0, -1000).repetir).toBe(false);
  });

  it("a razão de não repetir é sempre dita", () => {
    // O log precisa distinguir "desisti porque acabou o prazo" de "desisti
    // porque o erro é definitivo". Sem isso, a próxima diagnose é cega — foi o
    // que aconteceu com a mensagem de placeholder.
    const motivos = new Set([
      decidirRetentativaTransiente(400, 0, PRAZO_FOLGADO).motivo,
      decidirRetentativaTransiente(503, 2, PRAZO_FOLGADO).motivo,
      decidirRetentativaTransiente(503, 0, 100).motivo,
    ]);
    expect(motivos).toEqual(
      new Set(["status-definitivo", "retentativas-esgotadas", "sem-prazo"]),
    );
  });
});

describe("a conta de esperas e retentativas é a mesma dos dois lados", () => {
  it("há exatamente tantas retentativas quantas esperas definidas", () => {
    expect(ESPERA_TRANSIENTE_MS.length).toBeGreaterThan(0);
    for (let i = 0; i < ESPERA_TRANSIENTE_MS.length; i++) {
      expect(decidirRetentativaTransiente(503, i, PRAZO_FOLGADO).repetir, `i=${i}`).toBe(true);
    }
    expect(
      decidirRetentativaTransiente(503, ESPERA_TRANSIENTE_MS.length, PRAZO_FOLGADO).repetir,
    ).toBe(false);
  });

  it("as esperas são crescentes", () => {
    for (let i = 1; i < ESPERA_TRANSIENTE_MS.length; i++) {
      expect(ESPERA_TRANSIENTE_MS[i]).toBeGreaterThan(ESPERA_TRANSIENTE_MS[i - 1]);
    }
  });

  it("a soma das esperas é pequena diante do custo de refazer o módulo", () => {
    // Refazer o módulo custou ~80 s de chamadas no log medido. Esperar mais que
    // isso tornaria a retentativa pior que o problema.
    const soma = ESPERA_TRANSIENTE_MS.reduce((a, b) => a + b, 0);
    expect(soma).toBeLessThan(20_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O SEGUNDO ACHADO DO MESMO LOG: UMA PROPORÇÃO SOBRE UMA OBSERVAÇÃO
//
// MEDIDO às 18:12 do mesmo curso:
//
//   "Módulo 2 (índice 1, tentativa 1/3) falhou: Números não localizados nas
//    fontes: 15/03/2024 (1 de 1)."
//
// Uma data do caso fictício, o único número do módulo. 1/1 = 1,0 > 0,5 e o
// módulo foi reprovado; voltou pela retentativa e saiu com ressalva, custando
// ~70 s por uma data.
// ═══════════════════════════════════════════════════════════════════════════

describe("números sem fonte: reprovar ou avisar", () => {
  it("O CASO MEDIDO: 1 de 1 agora AVISA, não reprova", () => {
    expect(severidadeDosNumerosSemFonte(1, 1)).toBe("warning");
  });

  it("2 de 2 também avisa — amostra pequena não decide", () => {
    expect(severidadeDosNumerosSemFonte(2, 2)).toBe("warning");
  });

  it("3 de 3 reprova — aí há amostra", () => {
    expect(severidadeDosNumerosSemFonte(3, 3)).toBe("blocking");
  });

  it("2 de 3 reprova: é maioria com amostra no piso", () => {
    expect(severidadeDosNumerosSemFonte(2, 3)).toBe("blocking");
  });

  it("1 de 3 avisa: minoria", () => {
    expect(severidadeDosNumerosSemFonte(1, 3)).toBe("warning");
  });

  it("5 de 10 avisa, e 6 de 10 reprova — o limiar segue em metade", () => {
    expect(severidadeDosNumerosSemFonte(5, 10)).toBe("warning");
    expect(severidadeDosNumerosSemFonte(6, 10)).toBe("blocking");
  });

  it("O EFEITO INVERTIDO QUE ISTO CONSERTA", () => {
    // Antes: 1 de 1 bloqueava e 5 de 10 avisava, tendo cinco vezes mais
    // evidência de invenção. Agora a evidência maior é a que reprova.
    expect(severidadeDosNumerosSemFonte(1, 1)).toBe("warning");
    expect(severidadeDosNumerosSemFonte(8, 10)).toBe("blocking");
  });

  it("nenhum achado nunca reprova", () => {
    expect(severidadeDosNumerosSemFonte(0, 0)).toBe("warning");
    expect(severidadeDosNumerosSemFonte(0, 20)).toBe("warning");
  });

  it("o piso e o limiar são os números documentados", () => {
    expect(PISO_PARA_PROPORCAO).toBe(3);
    expect(PROPORCAO_QUE_REPROVA).toBe(0.5);
  });
});
