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
