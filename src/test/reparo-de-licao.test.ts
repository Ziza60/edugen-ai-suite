import { describe, expect, it } from "vitest";
import {
  decidirReparo,
  problemasDaLicao,
  validateModuleDocument,
} from "../../supabase/functions/_shared/course-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// O REPARO QUE NUNCA CONSERTOU NADA
//
// Curso 'Doces da Vovó', 31/08 (course_id 35a30be8). Três reparos rodaram,
// custaram 89,3 s somados, e os três foram aceitos. Nenhum corrigiu o defeito
// que o chamou:
//
//   +57,8s  lesson_repair_8_2   17.854 ms  finish=stop
//   +75,6s  "Módulo 8 entregue com ressalvas: Lição 8.2: 822-decision-map-
//            planning: tabela sem colunas suficientes. | Lição 8.2: 822-
//            decision-map-planning: tabela com menos de 3 linhas reais. |
//            Lição 8.2: apenas 2 blocos válidos. | Lição 8.3: 367 palavras;
//            mínimo 450."
//
//   +72,0s  lesson_repair_7_3   35.993 ms  finish=length  (TRUNCADO, max=9000)
//   +108,0s "Módulo 7 entregue com ressalvas: Lição 7.3: 353 palavras;
//            mínimo 450."
//
// A revalidação roda DEPOIS do reparo, então essas ressalvas são o estado
// final: a 8.2 voltou com a mesma tabela, e a 7.3 voltou mais curta do que o
// mínimo que o reparo fora chamado para atingir.
//
// O preço: os módulos 6 e 7 foram os dois únicos do curso em que um reparo
// rodou até o fim, e os dois únicos que perderam o quiz ("Assessment rejected
// ... Timeout") E a imagem ("entregue sem imagem: restam 3s").
// ═══════════════════════════════════════════════════════════════════════════

const bloco = (over: Record<string, unknown> = {}) =>
  ({
    id: "b1",
    type: "explanation",
    heading: "Como calcular o ponto de pedido",
    paragraphs: [],
    bullets: [],
    items: [],
    steps: [],
    cards: [],
    table: { headers: [], rows: [], caption: "" },
    code: { language: "", code: "", explanation: "" },
    example: { context: "", challenge: "", solution: "", result: "" },
    scenario: { context: "", turns: [] },
    activity: { objective: "", steps: [], deliverable: "" },
    source_ids: [],
    ...over,
  }) as any;

const palavras = (n: number) =>
  Array.from({ length: n }, (_, i) => `palavra${i}`).join(" ");

const explicacao = (id: string, n: number) =>
  bloco({
    id,
    type: "explanation",
    paragraphs: [palavras(Math.ceil(n / 2)), palavras(Math.floor(n / 2))],
  });

const plano = (over: Record<string, unknown> = {}) =>
  ({
    lesson_number: "8.2",
    title: "Mapa de decisão de compra",
    objective: "Decidir quando comprar",
    pattern: "decision",
    required_block_types: [],
    ...over,
  }) as any;

const licao = (numero: string, blocos: unknown[], over: Record<string, unknown> = {}) =>
  ({
    lesson_number: numero,
    title: "Mapa de decisão de compra",
    objective: "Decidir quando comprar com base no consumo e no prazo",
    blocks: blocos,
    ...over,
  }) as any;

const REGUA = {
  lessonIndex: 1,
  useSources: false,
  allowedSourceIds: new Set<string>(),
  lessonMinWords: 450,
  lessonMaxWords: 1500,
};

describe("problemasDaLicao — a régua que o reparo passou a usar", () => {
  it("reproduz as três ressalvas da lição 8.2 do curso de 31/08", () => {
    // decision_map com 1 coluna e 2 linhas, mais dois blocos de texto: é o que
    // o log registrou depois do reparo de 17,9 s.
    const mapa = bloco({
      id: "822-decision-map-planning",
      type: "decision_map",
      table: { headers: ["Situação"], rows: [["a"], ["b"]], caption: "" },
    });
    const p = problemasDaLicao({
      lesson: licao("8.2", [mapa, explicacao("b2", 300), explicacao("b3", 300)]),
      planned: plano(),
      ...REGUA,
    });
    expect(p.repairable).toContain(
      "Lição 8.2: 822-decision-map-planning: tabela sem colunas suficientes.",
    );
    expect(p.repairable).toContain(
      "Lição 8.2: 822-decision-map-planning: tabela com menos de 3 linhas reais.",
    );
    expect(p.repairable).toContain("Lição 8.2: apenas 2 blocos válidos.");
  });

  it("conta as palavras da lição, que é o defeito que chamou o reparo da 7.3", () => {
    const curta = problemasDaLicao({
      lesson: licao("7.3", [explicacao("b1", 120), explicacao("b2", 120), explicacao("b3", 113)]),
      planned: plano({ lesson_number: "7.3" }),
      ...REGUA,
    });
    expect(curta.palavras).toBe(353);
    expect(curta.repairable).toContain("Lição 7.3: 353 palavras; mínimo 450.");

    const cheia = problemasDaLicao({
      lesson: licao("7.3", [explicacao("b1", 200), explicacao("b2", 200), explicacao("b3", 200)]),
      planned: plano({ lesson_number: "7.3" }),
      ...REGUA,
    });
    expect(cheia.repairable).toHaveLength(0);
  });

  it("enxerga bloco obrigatório ausente — que validateLearningBlock não enxerga", () => {
    // Era esta a cegueira: a verificação antiga do reparo era bloco a bloco, e
    // um bloco individualmente válido não denuncia o tipo que ficou faltando.
    const p = problemasDaLicao({
      lesson: licao("8.2", [explicacao("b1", 200), explicacao("b2", 200), explicacao("b3", 200)]),
      planned: plano({ required_block_types: ["decision_map"] }),
      ...REGUA,
    });
    expect(p.repairable).toContain("Lição 8.2: bloco obrigatório decision_map ausente.");
  });

  it("é a mesma régua que o módulo usa no laudo", () => {
    // Se as duas divergirem, o reparo volta a aceitar candidatos que o módulo
    // vai reprovar em seguida — que é exatamente o que acontecia.
    const curta = licao("1.1", [explicacao("b1", 120), explicacao("b2", 120), explicacao("b3", 113)], {
      lesson_number: "1.1",
    });
    const planoDaLicao = plano({ lesson_number: "1.1" });
    const doModulo = validateModuleDocument({
      course: { course_title: "Gestão de Estoques", description: "" } as any,
      blueprint: { module_number: 1, title: "Módulo 1", role: "core", lessons: [planoDaLicao] } as any,
      document: {
        module_title: "Módulo 1",
        opening_bridge: "x".repeat(60),
        lessons: [curta],
        checkpoint: "y".repeat(40),
        key_takeaways: ["a", "b", "c"],
        media_brief: { purpose: "", concept: "", alt_text: "", generation_prompt: "" },
      } as any,
      markdown: "Pare um momento e reflita",
      sourcePacket: "",
      allowedSourceIds: new Set<string>(),
      useSources: false,
      targetMinWords: 450,
      lessonMinWords: 450,
      lessonMaxWords: 1500,
    });
    const daLicao = problemasDaLicao({
      lesson: curta,
      planned: planoDaLicao,
      lessonIndex: 0,
      useSources: false,
      allowedSourceIds: new Set<string>(),
      lessonMinWords: 450,
      lessonMaxWords: 1500,
    });
    for (const problema of daLicao.repairable) {
      expect(doModulo.repairable).toContain(problema);
    }
    expect(daLicao.repairable).toContain("Lição 1.1: 353 palavras; mínimo 450.");
  });
});

describe("decidirReparo — quando o candidato pode substituir a lição", () => {
  it("recusa resposta truncada mesmo quando ela parece melhor", () => {
    // O caso 7.3: finish=length, parseJsonLoose fecha as chaves que faltam e
    // devolve um objeto bem formado. A lição encolheu sem que ninguém visse.
    expect(decidirReparo({ antes: 1, depois: 0, truncado: true })).toEqual({
      aceito: false,
      motivo: "resposta truncada pelo limite de tokens",
    });
  });

  it("recusa empate — o caso 8.2, três problemas antes e três depois", () => {
    expect(decidirReparo({ antes: 3, depois: 3, truncado: false }).aceito).toBe(false);
  });

  it("recusa piora", () => {
    expect(decidirReparo({ antes: 1, depois: 4, truncado: false }).aceito).toBe(false);
  });

  it("aceita quando reduz a contagem", () => {
    expect(decidirReparo({ antes: 3, depois: 1, truncado: false })).toEqual({
      aceito: true,
      motivo: "corrigido",
    });
    expect(decidirReparo({ antes: 1, depois: 0, truncado: false }).aceito).toBe(true);
  });

  it("não tem limiar para calibrar: qualquer redução vale", () => {
    // Um limiar do tipo "melhorou pelo menos 50%" seria mais uma constante
    // ajustada a três cursos e morta no quarto, como já aconteceu três vezes
    // neste projeto. Reduzir é reduzir.
    for (let antes = 1; antes <= 8; antes++) {
      expect(decidirReparo({ antes, depois: antes - 1, truncado: false }).aceito).toBe(true);
      expect(decidirReparo({ antes, depois: antes, truncado: false }).aceito).toBe(false);
    }
  });
});
