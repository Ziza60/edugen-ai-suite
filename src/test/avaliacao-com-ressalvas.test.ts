import { describe, expect, it } from "vitest";
import { validateAssessment } from "../../supabase/functions/_shared/course-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// A regra tratava todo defeito como fatal e devolvia null — o módulo saía sem
// quiz, sem flashcards e sem questão aberta. No módulo 4 do curso de estoques
// de 27/08 a primeira tentativa FUNCIONOU (15,3 s), foi descartada por não ser
// perfeita, e a segunda estourou o prazo. O aluno ficou sem avaliação nenhuma.
// ═══════════════════════════════════════════════════════════════════════════

const CONTEUDO = `O Ponto de Pedido indica quando comprar de novo.
O Lote Econômico de Compra minimiza o custo total do estoque.
O estoque de segurança protege contra atraso do fornecedor.`;

const modulo = { outcome_ids: ["o1", "o2"] } as any;

const questaoBoa = (i: number) => ({
  question: `Qual é a função do Ponto de Pedido na gestão de estoque? (${i})`,
  options: [`Avisar quando comprar ${i}`, `Reduzir o frete ${i}`, `Aumentar a margem ${i}`, `Fechar o caixa ${i}`],
  correct: 0,
  explanation: "Ele marca o nível que dispara a nova compra.",
  outcome_id: "o1",
  evidence_excerpt: "O Ponto de Pedido indica quando comprar de novo.",
});

const flashcardBom = (i: number) => ({
  front: `O que é o Lote Econômico de Compra (${i})?`,
  back: "É a quantidade por pedido que minimiza o custo total de estoque.",
});

const base = () => ({
  multiple_choice: [questaoBoa(1), questaoBoa(2), questaoBoa(3)],
  open_ended: {
    question: "Explique como aplicar o Ponto de Pedido na padaria.",
    criteria: ["Cita o consumo diário", "Cita o tempo de entrega"],
    sample_answer: "…",
    outcome_id: "o2",
  },
  flashcards: [1, 2, 3, 4, 5].map(flashcardBom),
}) as any;

const laudo = (assessment: any) =>
  validateAssessment({ assessment, module: modulo, markdown: CONTEUDO, includeQuiz: true, includeFlashcards: true });

describe("o que impede a entrega", () => {
  it("uma avaliação completa não tem erro nem ressalva", () => {
    expect(laudo(base())).toEqual({ erros: [], ressalvas: [] });
  });

  it("índice de resposta correta fora da faixa: nada ficaria certo na tela", () => {
    const a = base(); a.multiple_choice[0].correct = 4;
    expect(laudo(a).erros.join(" ")).toMatch(/índice correto inválido/);
  });

  it("opções repetidas: a 'correta' fica ambígua", () => {
    const a = base(); a.multiple_choice[0].options[1] = a.multiple_choice[0].options[0];
    expect(laudo(a).erros.join(" ")).toMatch(/opções repetidas/);
  });

  it("menos de quatro opções: a tela espera quatro", () => {
    const a = base(); a.multiple_choice[0].options = ["uma", "duas", "três"];
    expect(laudo(a).erros.join(" ")).toMatch(/4 opções/);
  });

  it("evidência que não existe no conteúdo: perguntaria o que não foi ensinado", () => {
    const a = base(); a.multiple_choice[0].evidence_excerpt = "A curva de Laffer aplicada ao varejo.";
    expect(laudo(a).erros.join(" ")).toMatch(/evidência verificável/);
  });

  it("zero questões não é 'menos que três' — é não ter avaliação objetiva", () => {
    const a = base(); a.multiple_choice = [];
    expect(laudo(a).erros.join(" ")).toMatch(/nenhuma questão objetiva/);
  });
});

describe("o que empobrece sem impedir", () => {
  it("duas questões em vez de três é ressalva, não erro", () => {
    const a = base(); a.multiple_choice = [questaoBoa(1), questaoBoa(2)];
    const l = laudo(a);
    expect(l.erros).toEqual([]);
    expect(l.ressalvas.join(" ")).toMatch(/2 questões objetivas em vez de 3/);
  });

  it("quatro flashcards em vez de cinco é ressalva", () => {
    const a = base(); a.flashcards = [1, 2, 3, 4].map(flashcardBom);
    const l = laudo(a);
    expect(l.erros).toEqual([]);
    expect(l.ressalvas.join(" ")).toMatch(/4 flashcards em vez de 5/);
  });

  it("flashcard sem pergunta explícita é ressalva", () => {
    const a = base(); a.flashcards[0].front = "Lote Econômico de Compra";  // sem "?"
    const l = laudo(a);
    expect(l.erros).toEqual([]);
    expect(l.ressalvas.join(" ")).toMatch(/pergunta explícita/);
  });

  it("questão sem vínculo com objetivo é ressalva: a matriz fica incompleta, o quiz funciona", () => {
    const a = base(); a.multiple_choice[0].outcome_id = "o9";
    const l = laudo(a);
    expect(l.erros).toEqual([]);
    expect(l.ressalvas.join(" ")).toMatch(/não está vinculada a objetivo/);
  });

  it("questão aberta sem enunciado é ERRO, com poucos critérios é ressalva", () => {
    const semEnunciado = base(); semEnunciado.open_ended.question = "";
    expect(laudo(semEnunciado).erros.join(" ")).toMatch(/questão aberta não tem enunciado/i);

    const poucosCriterios = base(); poucosCriterios.open_ended.criteria = ["só um"];
    const l = laudo(poucosCriterios);
    expect(l.erros).toEqual([]);
    expect(l.ressalvas.join(" ")).toMatch(/menos de 2 critérios/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A PODA: UMA QUESTÃO RUIM NÃO CONDENA O QUIZ INTEIRO
//
// O conserto de 27/08 separou ERRO de RESSALVA, mas a unidade continuou sendo
// a avaliação inteira — e quase todo `erro` é de UMA questão. Curso de 06/09,
// módulo 8: a primeira avaliação voltou em 13,2 s, tinha erro estrutural em
// alguma questão, foi descartada inteira, e a segunda tentativa (effort=medium)
// gastou 25 s e estourou:
//
//   +97,0s   AI ok   module_assessment  elapsed=13156ms  finish=stop
//   +97,0s   AI call module_assessment  effort=medium
//   +122,1s  Assessment rejected for module 8: Timeout após 25069ms
//
// O aluno ficou sem quiz, sem questão aberta e sem os cinco flashcards — e o
// módulo foi a 122,4 s dos 125 s, atrasando o curso inteiro em ~12 s.
// ═══════════════════════════════════════════════════════════════════════════

import { podarAvaliacao } from "../../supabase/functions/_shared/course-pipeline";

const podar = (a: any) =>
  podarAvaliacao({
    assessment: a, module: modulo, markdown: CONTEUDO,
    includeQuiz: true, includeFlashcards: true,
  });

describe("poda da avaliação", () => {
  it("descarta só a questão sem evidência e mantém as outras duas", () => {
    const a = base();
    a.multiple_choice[1].evidence_excerpt = "Frase que não existe no conteúdo do módulo.";
    const { assessment, podas } = podar(a);
    expect(assessment.multiple_choice).toHaveLength(2);
    expect(podas.join(" ")).toMatch(/Questão 2 descartada.*evidência/i);
    // O que sobrou continua íntegro: nada mais foi perdido junto.
    expect(assessment.open_ended.question).toBe(base().open_ended.question);
    expect(assessment.flashcards).toHaveLength(5);
  });

  it("descarta a questão com opção repetida", () => {
    const a = base();
    a.multiple_choice[0].options[2] = a.multiple_choice[0].options[0];
    const { assessment, podas } = podar(a);
    expect(assessment.multiple_choice).toHaveLength(2);
    expect(podas.join(" ")).toMatch(/opções repetidas/i);
  });

  it("a questão aberta sem enunciado cai sozinha, o quiz sobrevive", () => {
    const a = base();
    a.open_ended.question = "";
    const { assessment, podas } = podar(a);
    expect(assessment.multiple_choice).toHaveLength(3);
    expect(assessment.flashcards).toHaveLength(5);
    expect(podas.join(" ")).toMatch(/Questão aberta descartada/i);
  });

  it("avaliação perfeita atravessa a poda sem perder nada", () => {
    const { assessment, podas } = podar(base());
    expect(podas).toEqual([]);
    expect(assessment.multiple_choice).toHaveLength(3);
    expect(assessment.flashcards).toHaveLength(5);
  });

  it("o que sobra da poda passa na validação — é o que a torna entregável", () => {
    // Sem isto a poda seria enfeite: ela só serve se o resultado for aceito.
    const a = base();
    a.multiple_choice[2].explanation = "";
    const { assessment } = podar(a);
    const laudo = validateAssessment({
      assessment, module: modulo, markdown: CONTEUDO,
      includeQuiz: true, includeFlashcards: true,
    });
    expect(laudo.erros).toEqual([]);
  });

  it("quando NADA sobra, a poda não inventa avaliação", () => {
    // Três questões ruins não viram um quiz. Aqui a segunda tentativa é
    // legítima, e é para ela que a guarda de tempo existe.
    const a = base();
    for (const q of a.multiple_choice) q.explanation = "";
    const { assessment } = podar(a);
    expect(assessment.multiple_choice).toHaveLength(0);
    const laudo = validateAssessment({
      assessment, module: modulo, markdown: CONTEUDO,
      includeQuiz: true, includeFlashcards: true,
    });
    expect(laudo.erros.length).toBeGreaterThan(0);
  });
});

// ── O piso do quiz ─────────────────────────────────────────────────────────
//
// A poda entrega o que sobra, mas o que sobra precisa continuar sendo um quiz.
// O módulo tem três lições e o quiz nasce com três questões, uma por lição:
// com uma, duas lições ficam sem verificação e o aluno recebe algo que PARECE
// avaliação. Melhor a ausência declarada no laudo.

import { podaSuficiente } from "../../supabase/functions/_shared/course-pipeline";

const comQuestoes = (n: number) =>
  ({ ...base(), multiple_choice: [1, 2, 3].slice(0, n).map(questaoBoa) }) as any;

describe("piso do quiz", () => {
  it("uma questão não é avaliação", () => {
    expect(podaSuficiente(comQuestoes(1), true)).toBe(false);
  });

  it("duas já são", () => {
    expect(podaSuficiente(comQuestoes(2), true)).toBe(true);
    expect(podaSuficiente(comQuestoes(3), true)).toBe(true);
  });

  it("zero também não passa — mas aí quem barra é a validação", () => {
    expect(podaSuficiente(comQuestoes(0), true)).toBe(false);
  });

  it("curso sem quiz não é medido pelo piso", () => {
    // Só flashcards: exigir questões objetivas ali reprovaria o que nem foi
    // pedido.
    expect(podaSuficiente(comQuestoes(0), false)).toBe(true);
  });
});
