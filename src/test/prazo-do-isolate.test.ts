import { describe, expect, it } from "vitest";
import { prazoRestanteMs } from "../../supabase/functions/_shared/course-dispatch.ts";

// ═══════════════════════════════════════════════════════════════════════════
// O ORÇAMENTO CONTAVA A VIDA DA REQUISIÇÃO; A PLATAFORMA MATA PELA IDADE DO
// ISOLATE
//
// MEDIDO no curso 8091e1c1, de 19/11/2026, agrupando o CSV do log por
// `execution_id`:
//
//   isolate 99264670 ... 18:11:36 → 18:13:36 ... vida 121,0 s
//   isolate 73bed077 ... 18:13:36 → 18:16:06 ... vida 150,0 s   ← morto no teto
//
// O 73bed077 reivindicou TRÊS módulos de uma vez (índices 2, 3 e 4, às
// 18:13:37). Às 18:14:31 o índice 3 morreu num 503 e o MESMO isolate, já com 55
// s de vida, pegou a segunda tentativa:
//
//   isolate nasce ...................... 18:13:36
//   tentativa 2 do índice 3 começa ..... 18:14:31   (isolate com 55 s)
//   orçamento do módulo diz ............ 125 s → até 18:16:36
//   plataforma mata o isolate .......... 18:16:06   (150,0 s de vida)
//
// Às 18:15:50 as três lições estavam prontas e a guarda do reparo mediu
// `msLeft() = 46 s`, acima da reserva de 42 s, e começou um reparo. O isolate
// tinha 16 s. Shutdown com as três lições geradas e nada gravado.
//
// O curso saiu com 4 de 5 módulos. O trabalho existia; o relógio estava errado.
//
// Estes testes reproduzem a linha do tempo medida, em milissegundos, e mostram
// o que cada relógio responderia nela.
// ═══════════════════════════════════════════════════════════════════════════

const MODULE_DEADLINE_MS = 125_000;
const TETO_DO_ISOLATE_MS = 150_000;
const MARGEM_DO_ISOLATE_MS = 20_000;

/** O relógio antigo: só a vida desta requisição. Fica aqui como contraste. */
const prazoAntigo = (desdeOClaim: number) => MODULE_DEADLINE_MS - desdeOClaim;

/**
 * O relógio novo. Chama `prazoRestanteMs` de course-dispatch.ts — a MESMA
 * função que o worker usa. Uma cópia aqui mediria meu raciocínio, não o código.
 */
const prazoNovo = (desdeOClaim: number, idadeDoIsolate: number) =>
  prazoRestanteMs({
    orcamentoDoModuloMs: MODULE_DEADLINE_MS,
    desdeOClaimMs: desdeOClaim,
    tetoDoIsolateMs: TETO_DO_ISOLATE_MS,
    margemMs: MARGEM_DO_ISOLATE_MS,
    idadeDoIsolateMs: idadeDoIsolate,
  });

/** A guarda de entrada do reparo: reserva de reparo + avaliação. */
const RESERVA_PARA_REPARO_MS = 25_000 + 17_000;

// A linha do tempo medida, em ms desde o nascimento do isolate 73bed077.
const NASCE = 0;
const CLAIM_TENTATIVA_2 = 55_000;   // 18:14:31
const LICOES_PRONTAS = 134_000;     // 18:15:50
const MORTE = 150_000;              // 18:16:06

describe("a linha do tempo medida do isolate 73bed077", () => {
  it("o claim da 2a tentativa pegou um isolate que já tinha 55s", () => {
    expect(CLAIM_TENTATIVA_2 - NASCE).toBe(55_000);
  });

  it("o relógio ANTIGO autorizava o reparo — e foi o que aconteceu", () => {
    const desdeOClaim = LICOES_PRONTAS - CLAIM_TENTATIVA_2; // 79s
    expect(desdeOClaim).toBe(79_000);
    const sobra = prazoAntigo(desdeOClaim);
    expect(sobra).toBe(46_000);
    expect(sobra).toBeGreaterThan(RESERVA_PARA_REPARO_MS); // 46s > 42s → começou
  });

  it("o isolate tinha 16s de vida nesse instante", () => {
    expect(MORTE - LICOES_PRONTAS).toBe(16_000);
  });

  it("o relógio NOVO recusa o reparo no mesmo instante", () => {
    const sobra = prazoNovo(LICOES_PRONTAS - CLAIM_TENTATIVA_2, LICOES_PRONTAS);
    expect(sobra).toBeLessThanOrEqual(0);
    expect(sobra).toBeLessThan(RESERVA_PARA_REPARO_MS);
  });

  it("o relógio antigo prometia 30s além da vida do isolate", () => {
    // O módulo acreditava ter até 18:16:36; a plataforma matou às 18:16:06.
    const fimQueOModuloAcreditava = CLAIM_TENTATIVA_2 + MODULE_DEADLINE_MS;
    expect(fimQueOModuloAcreditava - MORTE).toBe(30_000);
  });
});

describe("o prazo é o menor dos dois", () => {
  it("isolate novo: quem manda é o orçamento do módulo", () => {
    // Recém-nascido, o isolate tem 130s úteis contra os 125s do módulo.
    expect(prazoNovo(0, 0)).toBe(MODULE_DEADLINE_MS);
  });

  it("isolate de meia-idade: quem manda é a vida restante", () => {
    expect(prazoNovo(0, 55_000)).toBe(75_000);
    expect(prazoNovo(0, 55_000)).toBeLessThan(MODULE_DEADLINE_MS);
  });

  it("isolate perto do teto: o prazo é zero ou negativo, e nada novo começa", () => {
    expect(prazoNovo(0, 140_000)).toBeLessThanOrEqual(0);
  });

  it("nunca promete mais que o orçamento do módulo", () => {
    for (const idade of [0, 10_000, 60_000, 120_000]) {
      expect(prazoNovo(0, idade)).toBeLessThanOrEqual(MODULE_DEADLINE_MS);
    }
  });

  it("nunca promete mais que a vida restante menos a margem", () => {
    for (const idade of [0, 30_000, 90_000, 149_000]) {
      expect(prazoNovo(0, idade))
        .toBeLessThanOrEqual(TETO_DO_ISOLATE_MS - MARGEM_DO_ISOLATE_MS - idade);
    }
  });

  it("decresce com os dois relógios, nunca aumenta", () => {
    let anterior = Infinity;
    for (let t = 0; t <= 120_000; t += 10_000) {
      const agora = prazoNovo(t, t);
      expect(agora).toBeLessThanOrEqual(anterior);
      anterior = agora;
    }
  });
});

describe("a margem existe para o que vem depois da última chamada de IA", () => {
  it("sobra tempo para validar, gravar e responder", () => {
    // Com o prazo em zero ainda restam 20s de vida de isolate — é nessa janela
    // que o módulo é validado e gravado. Sem ela, o prazo chegaria a zero no
    // mesmo instante em que a plataforma mata, e o insert não aconteceria.
    const idadeQuandoOPrazoZera = TETO_DO_ISOLATE_MS - MARGEM_DO_ISOLATE_MS;
    expect(TETO_DO_ISOLATE_MS - idadeQuandoOPrazoZera).toBe(MARGEM_DO_ISOLATE_MS);
    expect(MARGEM_DO_ISOLATE_MS).toBeGreaterThanOrEqual(15_000);
  });

  it("no caso medido, a margem teria salvado o módulo", () => {
    // Sem o reparo, o que faltava era validar, gravar e devolver. A avaliação
    // tem guarda própria (msLeft < 15s → ignorada com ressalva), então ela
    // também seria saltada, e o módulo seria gravado com as três lições.
    const sobraNoInstanteDoReparo = prazoNovo(79_000, LICOES_PRONTAS);
    expect(sobraNoInstanteDoReparo).toBeLessThan(15_000); // avaliação saltada
    expect(MORTE - LICOES_PRONTAS).toBeGreaterThan(0);    // e havia tempo de gravar
  });
});
