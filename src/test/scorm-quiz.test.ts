import { describe, expect, it } from "vitest";
import {
  NOTA_MINIMA,
  quizInterativoHtml,
  quizUtilizavel,
  scriptSemQuiz,
  type QuizQuestion,
} from "../../supabase/functions/export-scorm/quiz";

// ═══════════════════════════════════════════════════════════════════════════
// O quiz do SCORM não avaliava nada, por dois motivos.
//
// 1) Saía com o gabarito impresso: a alternativa certa vinha marcada com "✓"
//    ao lado da pergunta. Isso é material de consulta, não avaliação.
//
// 2) O pacote informava ao LMS apenas `lesson_status = "completed"`, e
//    informava isso NA ABERTURA da página. O Moodle registrava "concluído" no
//    instante em que o aluno abria o módulo, tivesse lido ou não. Para quem
//    compra curso para treinar equipe e precisa comprovar aproveitamento, o
//    relatório não dizia absolutamente nada.
// ═══════════════════════════════════════════════════════════════════════════

const q = (n = 2, correta = 0): QuizQuestion => ({
  question: "Qual o limite de gastos com pessoal do Executivo municipal?",
  options: Array.from({ length: n }, (_, i) => `Alternativa ${i}`),
  correct_answer: correta,
  explanation: "A LRF fixa 54% da Receita Corrente Líquida.",
});

describe("o gabarito não é mais impresso junto da pergunta", () => {
  const html = quizInterativoHtml([q(4, 2)]);

  it("não marca a alternativa certa com um sinal visível", () => {
    // O "✓" ao lado da opção era exatamente o defeito.
    expect(html).not.toContain("✓");
  });

  it("as quatro alternativas são indistinguíveis no HTML", () => {
    const opts = html.match(/<label class="eg-opt"[\s\S]*?<\/label>/g) ?? [];
    expect(opts).toHaveLength(4);
    const classes = opts.map((o) => (o.match(/class="([^"]*)"/) ?? [])[1]);
    expect(new Set(classes).size).toBe(1);
  });

  it("o aluno precisa escolher: há um controle por alternativa", () => {
    expect((html.match(/type="radio"/g) ?? [])).toHaveLength(4);
  });
});

describe("o resultado chega ao LMS", () => {
  const html = quizInterativoHtml([q(3, 1), q(3, 2)]);

  it("envia a nota, com mínimo e máximo", () => {
    expect(html).toContain("cmi.core.score.raw");
    expect(html).toContain("cmi.core.score.min");
    expect(html).toContain("cmi.core.score.max");
  });

  it("declara aprovado ou reprovado, não apenas concluído", () => {
    expect(html).toContain('"passed" : "failed"');
    expect(html).not.toMatch(/lesson_status["'],\s*["']completed/);
  });

  it("registra questão a questão, para o instrutor ver ONDE o aluno errou", () => {
    expect(html).toContain("cmi.interactions.");
    expect(html).toContain(".student_response");
    expect(html).toContain(".correct_responses.0.pattern");
    expect(html).toContain('.result", acertou ? "correct" : "wrong"');
  });

  it("a nota mínima aparece para o aluno antes de ele responder", () => {
    expect(html).toContain(`${NOTA_MINIMA}%`);
  });

  it("funciona fora de um LMS: sem API, só o envio é omitido", () => {
    // O autor confere o pacote no próprio navegador; nada pode quebrar ali.
    expect(html).toContain("if (API)");
  });
});

describe("módulo sem quiz mantém o comportamento antigo", () => {
  it("sem questão utilizável, o quiz não é gerado", () => {
    expect(quizInterativoHtml([])).toBe("");
    expect(quizInterativoHtml(null)).toBe("");
    expect(quizInterativoHtml(undefined)).toBe("");
  });

  it("e aí o módulo marca 'completed' na abertura, como antes", () => {
    const s = scriptSemQuiz();
    expect(s).toContain('LMSSetValue("cmi.core.lesson_status", "completed")');
  });
});

describe("questões quebradas não entram", () => {
  it("descarta enunciado vazio", () => {
    expect(quizUtilizavel([{ ...q(), question: "  " }])).toHaveLength(0);
  });

  it("descarta questão com menos de duas alternativas", () => {
    expect(quizUtilizavel([{ ...q(), options: ["única"] }])).toHaveLength(0);
  });

  it("descarta gabarito fora do intervalo — apontaria para alternativa inexistente", () => {
    expect(quizUtilizavel([q(3, 7)])).toHaveLength(0);
    expect(quizUtilizavel([q(3, -1)])).toHaveLength(0);
  });

  it("mantém a questão íntegra e descarta só a quebrada", () => {
    expect(quizUtilizavel([q(3, 1), { ...q(), options: [] }])).toHaveLength(1);
  });
});

describe("o texto do curso não pode quebrar a página", () => {
  it("pergunta com HTML é escapada", () => {
    const html = quizInterativoHtml([{ ...q(), question: '<img src=x onerror="alert(1)">' }]);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain("&lt;img");
  });

  it("pergunta contendo </script> não fecha a tag do gabarito", () => {
    const html = quizInterativoHtml([{ ...q(), explanation: "veja </script><b>isto</b>" }]);
    const abre = (html.match(/<script>/g) ?? []).length;
    const fecha = (html.match(/<\/script>/g) ?? []).length;
    expect(fecha).toBe(abre);
  });

  it("aspas na alternativa não quebram o atributo", () => {
    const html = quizInterativoHtml([{ ...q(), options: ['a" onclick="x', "b"] }]);
    expect(html).not.toContain('onclick="x');
  });
});
