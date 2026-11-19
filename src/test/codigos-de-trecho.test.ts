import { describe, expect, it } from "vitest";
import { cleanModuleContent, semCodigosDeTrecho } from "../../supabase/functions/_shared/markdown.ts";

// ═══════════════════════════════════════════════════════════════════════════
// O ALUNO LENDO O IDENTIFICADOR INTERNO DO PEDAÇO DA FONTE
//
// O modelo recebe `<SOURCE id="S2:C34" file="Introdução.pdf">` e devolve o id
// como se fosse citação, no corpo da lição.
//
// MEDIDO: 98 ocorrências no curso de 18/11. Eu consertei a seção de
// referências — onde o PIPELINE imprimia os códigos — e encerrei o caso sem
// verificar se o MODELO também os escrevia. No curso de 19/11, já com aquele
// conserto no ar, sobraram 22 ocorrências em 18 trechos, todas no corpo das
// lições.
//
// MEDIDO com a limpeza rodando contra o markdown entregue de 19/11:
//   códigos            22 → 0
//   vírgula órfã        0
//   citações ISSAI     41 → 41
//   citações GUID      11 → 11
//   caracteres        219.838 → 219.655
//
// Todas as cadeias abaixo são recortes LITERAIS do markdown entregue em 19/11.
// A distinção que importa — parêntese compartilhado com citação normativa — não
// apareceu em nenhuma regex pensada no vazio; apareceu ao rodar a limpeza
// contra o texto real, onde `(ISSAI 3000/35, S2:C15)` teria virado
// `(ISSAI 3000/35,)` com a vírgula órfã.
// ═══════════════════════════════════════════════════════════════════════════

describe("código de trecho sozinho no parêntese: o parêntese todo sai", () => {
  const casos: Array<[string, string]> = [
    [
      "Devem ser considerados o interesse e atuação de outros órgãos. (S2:C4)",
      "Devem ser considerados o interesse e atuação de outros órgãos.",
    ],
    [
      "Trate aspectos que possam comprometer a medição do desempenho. (S2:C4)",
      "Trate aspectos que possam comprometer a medição do desempenho.",
    ],
    [
      "Tudo deve ser registrado no plano de auditoria. (S2:C4, S2:C5)",
      "Tudo deve ser registrado no plano de auditoria.",
    ],
    [
      "Busque perspectivas já consolidadas sobre o tema. (S2:C5)",
      "Busque perspectivas já consolidadas sobre o tema.",
    ],
    [
      "Evite exceder o mandato da EFS. (S2:C16, S2:C20)",
      "Evite exceder o mandato da EFS.",
    ],
    [
      "O julgamento profissional é frequentemente necessário. (S2:C25)",
      "O julgamento profissional é frequentemente necessário.",
    ],
    [
      "...desde a coleta até a conclusão esperada (S2:C27).",
      "...desde a coleta até a conclusão esperada.",
    ],
    [
      "É o guia detalhado para a fase de execução (S2:C34). Ele integra tudo.",
      "É o guia detalhado para a fase de execução. Ele integra tudo.",
    ],
    [
      "- O Plano de Auditoria integra a Matriz, traduzindo as decisões em ações (S2:C34).",
      "- O Plano de Auditoria integra a Matriz, traduzindo as decisões em ações.",
    ],
  ];

  for (const [entrada, esperado] of casos) {
    it(entrada.slice(0, 54).replace(/\s+/g, " "), () => {
      expect(semCodigosDeTrecho(entrada)).toBe(esperado);
    });
  }
});

describe("parêntese compartilhado: o código sai, a citação normativa fica", () => {
  it("(ISSAI 3000/35, S2:C15) → (ISSAI 3000/35)", () => {
    expect(
      semCodigosDeTrecho("Quais são as causas e os efeitos? (ISSAI 3000/35, S2:C15)"),
    ).toBe("Quais são as causas e os efeitos? (ISSAI 3000/35)");
  });

  it("dois códigos e uma ISSAI: fica só a ISSAI", () => {
    expect(
      semCodigosDeTrecho("Alinhe ao mandato da EFS. (ISSAI 3000/35, S2:C15, S2:C16)"),
    ).toBe("Alinhe ao mandato da EFS. (ISSAI 3000/35)");
  });

  it("separador ponto e vírgula também é entendido", () => {
    expect(
      semCodigosDeTrecho("...comprometimento com a auditoria (ISSAI 3000/49; S2:C33)."),
    ).toBe("...comprometimento com a auditoria (ISSAI 3000/49).");
  });

  it("código de outro arquivo junto da ISSAI", () => {
    expect(
      semCodigosDeTrecho("...a combinação desses princípios. (ISSAI 3000/35, S1:C4)"),
    ).toBe("...a combinação desses princípios. (ISSAI 3000/35)");
  });

  it("citação com vírgulas próprias não é remontada errado", () => {
    expect(
      semCodigosDeTrecho("Ver o diagrama (TCE, 2017, p.18, S2:C34)."),
    ).toBe("Ver o diagrama (TCE, 2017, p.18).");
  });

  it("NUNCA deixa vírgula órfã dentro do parêntese", () => {
    // O defeito que esta função quase introduziu.
    for (const entrada of [
      "x (ISSAI 3000/35, S2:C15)",
      "x (ISSAI 3000/36, S2:C16, S2:C20)",
      "x (ISSAI 3000/49; S2:C33)",
    ]) {
      const saida = semCodigosDeTrecho(entrada);
      expect(saida, saida).not.toMatch(/[,;]\s*\)/);
    }
  });
});

describe("dentro de tabela e em bloco de código", () => {
  it("célula de tabela: o código sai e o pipe fica", () => {
    expect(
      semCodigosDeTrecho(
        "| Priorize a relevância (S2:C23). | Otimiza o esforço da equipe. |",
      ),
    ).toBe("| Priorize a relevância. | Otimiza o esforço da equipe. |");
  });

  it("bloco cercado fica intacto — um curso pode ENSINAR a notação", () => {
    const md = [
      "Antes do bloco (S2:C9).",
      "",
      "```",
      "referencia = S2:C9",
      "```",
      "",
      "Depois do bloco (S2:C10).",
    ].join("\n");
    const saida = semCodigosDeTrecho(md);
    expect(saida).toContain("referencia = S2:C9");
    expect(saida).toContain("Antes do bloco.");
    expect(saida).toContain("Depois do bloco.");
  });
});

describe("o que a limpeza não pode fazer", () => {
  it("texto sem código nenhum volta idêntico, byte a byte", () => {
    const md = "## Título\n\nUm parágrafo com (ISSAI 3000/35) e uma tabela.\n\n| a | b |\n";
    expect(semCodigosDeTrecho(md)).toBe(md);
  });

  it("é idempotente — rodar duas vezes dá o mesmo resultado", () => {
    const md = "Ações (S2:C34) e normas (ISSAI 3000/49; S2:C33).";
    const uma = semCodigosDeTrecho(md);
    expect(semCodigosDeTrecho(uma)).toBe(uma);
  });

  it("não come número de norma parecido com código", () => {
    // ISSAI 3000/35, GUID 3910/38, NBASP 300 — nada disso casa com S<n>:C<n>.
    const md = "Conforme GUID 3910/38 e NBASP 300/11, com ISSAI 3000/35.";
    expect(semCodigosDeTrecho(md)).toBe(md);
  });

  it("não come notação R1C1 de planilha", () => {
    const md = "A referência R1C1:R4C4 é relativa.";
    expect(semCodigosDeTrecho(md)).toBe(md);
  });

  it("entrada vazia ou nula não quebra", () => {
    expect(semCodigosDeTrecho("")).toBe("");
    expect(semCodigosDeTrecho(undefined as any)).toBe(undefined as any);
  });
});

describe("a limpeza está ligada no caminho de verdade", () => {
  it("cleanModuleContent remove o código — é por ela que todo módulo passa", () => {
    // Ligada em markdown.ts, que o pipeline E as funções de exportação usam:
    // curso já gravado com código sai limpo na exportação.
    const saida = cleanModuleContent(
      "### 7.1 Plano\n\nTraduz as decisões em ações (S2:C34).",
      "Plano de Auditoria",
    );
    expect(saida).not.toMatch(/S\d+:C\d+/);
    expect(saida).toContain("Traduz as decisões em ações.");
  });

  it("e não atropela o que cleanModuleContent já fazia", () => {
    const saida = cleanModuleContent("## Plano de Auditoria\n\nCorpo (S2:C1).", "Plano de Auditoria");
    expect(saida).toBe("Corpo.");
  });
});
