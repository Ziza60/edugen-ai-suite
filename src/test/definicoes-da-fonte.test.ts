import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cartoesViramTabela,
  completarCartoes,
  completarDefinicoes,
  definicaoNaFonte,
  frasesDoTexto,
  palavrasDeConteudo,
  perdeuClausula,
  semOPreambulo,
} from "../../supabase/functions/export-pptx-v7/definicoes-da-fonte";
import { normalizeDeck } from "../../supabase/functions/export-pptx-v7/validate";
import { capacidadeDaCelula } from "../../supabase/functions/export-pptx-v7/table-geometry";
import type { SlideSpec } from "../../supabase/functions/export-pptx-v7/deck-plan";

// ═══════════════════════════════════════════════════════════════════════════
// O CARTÃO DO DECK DE 21/11, LITERAL, E O QUE A FONTE DIZIA
//
// Três consertos de prompt não trouxeram a cláusula de volta. Os números do
// último deck, MEDIDOS:
//
//   teto do corpo do cartão ...... 165 caracteres (4 cartões)
//   a cláusula no texto condensado  PRESENTE — rodei condenseForPlanning com
//                                   o orçamento real de 9.000
//   o corpo que saiu ............. "Grau de alcance das metas programadas."
//                                   37 caracteres, 128 de folga
//
// Nada cortou: o modelo escolheu. E a regra citava o erro entre aspas, que o
// modelo devolveu palavra por palavra.
//
// Este teste mede a troca determinística contra o curso real — o mesmo que
// gerou os três decks — e contra os quatro cartões que ele produziu.
// ═══════════════════════════════════════════════════════════════════════════

const CURSO = readFileSync(
  resolve(process.cwd(), "src/test/cursos-reais/com-fontes/auditoria-definicoes-fieis.md"),
  "utf8",
);
/** O módulo 1 do curso: é ele que define os quatro critérios. */
const MODULO_1 = (() => {
  const linhas = CURSO.split("\n");
  const ini: number[] = [];
  linhas.forEach((l, i) => {
    if (/^#{1,2} /.test(l) && !/Visão geral/.test(l) && i > 2) ini.push(i);
  });
  return linhas.slice(ini[0], ini[1]).join("\n");
})();

/** Os quatro cartões como o deck de 21/11 os entregou, copiados do PPTX. */
const CARTOES_DE_21_11 = [
  {
    heading: "Economicidade",
    body:
      "Dimensão de desempenho que analisa se os bens e serviços foram adquiridos " +
      "com o menor custo possível, na quantidade e qualidade adequadas.",
  },
  {
    heading: "Eficiência",
    body:
      "Relação entre os produtos obtidos e os insumos empregados, buscando fazer " +
      "mais com os mesmos recursos ou o mesmo com menos recursos.",
  },
  { heading: "Eficácia", body: "Grau de alcance das metas programadas." },
  {
    heading: "Efetividade",
    body:
      "Avalia os impactos de longo prazo e o atendimento das necessidades das " +
      "comunidades.",
  },
];

describe("a fonte do curso real", () => {
  it("define eficácia com a cláusula, e o módulo 1 é onde ela está", () => {
    expect(MODULO_1).toContain("independentemente dos custos implicados");
    expect(MODULO_1.length).toBeGreaterThan(20000);
  });

  it("acha a frase que define o termo", () => {
    const f = definicaoNaFonte("Eficácia", MODULO_1);
    expect(f).toBeTruthy();
    expect(f!).toContain("independentemente dos custos implicados");
  });

  it("devolve null para termo que a fonte não define", () => {
    expect(definicaoNaFonte("Blockchain", MODULO_1)).toBeNull();
    expect(definicaoNaFonte("", MODULO_1)).toBeNull();
    // Título longo não é termo de glossário.
    expect(definicaoNaFonte("A Importância da Análise Preliminar e Aquisição", MODULO_1)).toBeNull();
  });
});

describe("O CASO MEDIDO: o cartão de 21/11 volta a definir", () => {
  it("eficácia recupera a cláusula distintiva", () => {
    const cards = CARTOES_DE_21_11.map((c) => ({ ...c }));
    const feitas = completarCartoes(cards, MODULO_1);

    const eficacia = cards.find((c) => c.heading === "Eficácia")!;
    expect(eficacia.body).toContain("independentemente dos custos implicados");
    expect(eficacia.body.length).toBeGreaterThan(100);
    expect(feitas.map((r) => r.termo)).toContain("Eficácia");
  });

  it("e o corpo novo CABE no cartão — 165 caracteres com quatro cartões", () => {
    const cards = CARTOES_DE_21_11.map((c) => ({ ...c }));
    completarCartoes(cards, MODULO_1);
    for (const c of cards) expect(c.body.length, c.heading).toBeLessThanOrEqual(165);
  });

  it("eficiência recupera 'mantendo os padrões de qualidade'", () => {
    // A SEGUNDA cláusula do critério pré-registrado em 19/11. A fonte a traz no
    // resumo das dimensões; o parágrafo "Diferenciando" não — e era dele que o
    // planejador vinha copiando. A frase mais longa que DEFINE o termo vence.
    const cards = CARTOES_DE_21_11.map((c) => ({ ...c }));
    completarCartoes(cards, MODULO_1);
    expect(cards.find((c) => c.heading === "Eficiência")!.body)
      .toContain("mantendo os padrões de qualidade");
  });

  it("NÃO mexe em economicidade nem efetividade — não houve corte ali", () => {
    const cards = CARTOES_DE_21_11.map((c) => ({ ...c }));
    const feitas = completarCartoes(cards, MODULO_1);
    expect(feitas.map((r) => r.termo).sort()).toEqual(["Eficiência", "Eficácia"]);
    expect(cards[0].body).toBe(CARTOES_DE_21_11[0].body);
    expect(cards[3].body).toBe(CARTOES_DE_21_11[3].body);
  });

  it("é idempotente: rodar de novo não muda mais nada", () => {
    const cards = CARTOES_DE_21_11.map((c) => ({ ...c }));
    completarCartoes(cards, MODULO_1);
    const depois = cards.map((c) => c.body);
    expect(completarCartoes(cards, MODULO_1)).toEqual([]);
    expect(cards.map((c) => c.body)).toEqual(depois);
  });
});

describe("A DEFINIÇÃO QUE NÃO CABE NO CARTÃO VIRA TABELA", () => {
  // MEDIDO: a fonte define efetividade em 220 caracteres (sem o preâmbulo). O
  // cartão comporta 165 em qualquer arranjo. A célula de uma tabela de uma
  // coluna de dados com 4 linhas comporta 472.
  function slideDosQuatroEs() {
    return {
      kind: "cards",
      title: "Diferenciando as Dimensões de Desempenho",
      cards: CARTOES_DE_21_11.map((c) => ({ ...c })),
    } as never as SlideSpec;
  }

  it("converte o slide e traz AS QUATRO definições", () => {
    const s = slideDosQuatroEs();
    const feitas = cartoesViramTabela(s, MODULO_1, "Português");
    expect(feitas).not.toBeNull();
    expect(s.kind).toBe("table");
    expect(s.cards).toBeUndefined();
    expect(s.rows).toHaveLength(4);
    expect(s.rows!.map((r) => r.label))
      .toEqual(["Economicidade", "Eficiência", "Eficácia", "Efetividade"]);
  });

  it("a cláusula de causalidade da efetividade aparece", () => {
    // É ela que separa efetividade de eficácia para quem audita: sem
    // atribuição, "impacto de longo prazo" não diz de quem é o mérito.
    const s = slideDosQuatroEs();
    cartoesViramTabela(s, MODULO_1, "Português");
    const efetividade = s.rows!.find((r) => r.label === "Efetividade")!;
    expect(efetividade.cells[0]).toContain("atribuir às ações do programa");
  });

  it("e as outras duas cláusulas também, na mesma tabela", () => {
    const s = slideDosQuatroEs();
    cartoesViramTabela(s, MODULO_1, "Português");
    const texto = s.rows!.map((r) => r.cells[0]).join(" | ");
    expect(texto).toContain("independentemente dos custos implicados");
    expect(texto).toContain("mantendo os padrões de qualidade");
  });

  it("tudo cabe na célula medida", () => {
    const s = slideDosQuatroEs();
    cartoesViramTabela(s, MODULO_1, "Português");
    const teto = capacidadeDaCelula(1, s.rows!.length);
    for (const r of s.rows!) expect(r.cells[0].length, r.label).toBeLessThanOrEqual(teto);
  });

  it("NÃO converte quando todas as definições cabem no cartão", () => {
    const s = {
      kind: "cards",
      cards: [
        { heading: "Eficácia", body: "Grau de alcance das metas programadas." },
        { heading: "Eficiência", body: "Relação entre produtos e insumos." },
      ],
    } as never as SlideSpec;
    expect(cartoesViramTabela(s, MODULO_1, "Português")).toBeNull();
    expect(s.kind).toBe("cards");
  });

  it("a tabela convertida PASSA pela normalização, com uma coluna de dados", () => {
    // normTable recusava `columns.length < 2`, contando só as colunas de dados
    // — e a tabela "Conceito | Definição" tem uma. A recusa jogava fora
    // justamente a forma que resolve o problema.
    const s = slideDosQuatroEs();
    cartoesViramTabela(s, MODULO_1, "Português");
    const { deck } = normalizeDeck({
      courseTitle: "C",
      language: "Português",
      modules: [{ title: "M", slides: [s] }],
    } as never);
    const saida = deck.modules[0].slides[0];
    expect(saida.kind).toBe("table");
    expect(saida.rows).toHaveLength(4);
    expect(saida.rows!.map((r) => r.cells[0]).join(" "))
      .toContain("atribuir às ações do programa");
  });

  it("os rótulos seguem o idioma do deck", () => {
    for (const [lingua, termo] of [
      ["Português", "Conceito"], ["English", "Concept"], ["Español", "Concepto"],
    ] as [string, string][]) {
      const s = slideDosQuatroEs();
      cartoesViramTabela(s, MODULO_1, lingua);
      expect(s.rowHeader, lingua).toBe(termo);
    }
  });

  it("completarDefinicoes faz a conversão no deck inteiro", () => {
    const out = [{ title: "M1", slides: [slideDosQuatroEs()] }] as never as Parameters<typeof completarDefinicoes>[0];
    const feitas = completarDefinicoes(out, [{ title: "M1", content: MODULO_1 }], "Português");
    expect(feitas.map((r) => r.termo).sort())
      .toEqual(["Efetividade", "Eficiência", "Eficácia"]);
    expect(out[0].slides[0].kind).toBe("table");
  });
});

describe("perdeuClausula só acusa encolhimento, não paráfrase", () => {
  const fonte =
    "A eficácia está ligada ao grau de alcance das metas programadas em termos " +
    "de produtos e resultados imediatos, independentemente dos custos implicados.";

  it("acusa o corpo que é subconjunto e muito menor", () => {
    expect(perdeuClausula("Grau de alcance das metas programadas.", fonte)).toBe(true);
  });

  it("não acusa quando o corpo traz palavra que a fonte não tem", () => {
    // Redação própria do planejador: não é o nosso caso, e trocar seria
    // atropelar o planejador em vez de consertar um corte.
    expect(perdeuClausula("Dimensão de desempenho que mede entregas.", fonte)).toBe(false);
  });

  it("não acusa quando a diferença é pequena", () => {
    const quase =
      "Grau de alcance das metas programadas em termos de produtos e resultados " +
      "imediatos, independentemente dos custos implicados.";
    expect(perdeuClausula(quase, fonte)).toBe(false);
  });

  it("corpo vazio conta como perda", () => {
    expect(perdeuClausula("", fonte)).toBe(true);
  });
});

describe("semOPreambulo", () => {
  it("tira o 'A eficácia está ligada ao' que só repete o título do cartão", () => {
    const f =
      "A eficácia está ligada ao grau de alcance das metas programadas em termos " +
      "de produtos e resultados imediatos, independentemente dos custos implicados.";
    const r = semOPreambulo(f, "Eficácia");
    expect(r.startsWith("Grau de alcance")).toBe(true);
    expect(r).toContain("independentemente dos custos implicados");
  });

  it("deixa a frase intacta quando não reconhece o preâmbulo", () => {
    const f = "Toda auditoria operacional começa pela análise preliminar do objeto.";
    expect(semOPreambulo(f, "Eficácia")).toBe(f);
  });

  it("não corta quando sobraria um toco", () => {
    expect(semOPreambulo("A eficácia é o alcance.", "Eficácia")).toBe("A eficácia é o alcance.");
  });
});

describe("as peças de baixo", () => {
  it("palavrasDeConteudo ignora acento, caixa e palavra vazia", () => {
    expect(palavrasDeConteudo("A Eficácia DOS custos")).toEqual(["eficacia", "custos"]);
  });

  it("frasesDoTexto não parte em abreviação", () => {
    const f = frasesDoTexto(
      "O art. 5º da norma trata do tema e vale aqui. Já a seção seguinte muda o foco do exame.",
    );
    expect(f.length).toBe(2);
    expect(f[0]).toContain("art. 5º");
  });

  it("frasesDoTexto limpa marcação de markdown", () => {
    const f = frasesDoTexto("##### **Eficácia** — Alcançando\n\nA eficácia é o grau de alcance das metas previstas.");
    expect(f.join(" ")).not.toContain("**");
    expect(f.join(" ")).not.toContain("#");
  });
});

describe("completarDefinicoes no deck inteiro", () => {
  it("usa a fonte DO MÓDULO, não a de outro", () => {
    const out: never = [
      { title: "M1", slides: [{ kind: "cards", cards: [{ heading: "Eficácia", body: "Grau de alcance das metas." }] }] },
      { title: "M2", slides: [{ kind: "cards", cards: [{ heading: "Eficácia", body: "Grau de alcance das metas." }] }] },
    ] as never;
    const feitas = completarDefinicoes(out, [
      { title: "M1", content: MODULO_1 },
      { title: "M2", content: "Este módulo não fala de eficácia em momento nenhum do texto." },
    ]);
    expect(feitas).toHaveLength(1);
    const m = out as unknown as { slides: { cards: { body: string }[] }[] }[];
    expect(m[0].slides[0].cards[0].body).toContain("independentemente");
    expect(m[1].slides[0].cards[0].body).toBe("Grau de alcance das metas.");
  });

  it("módulo sem fonte não quebra", () => {
    const out = [{ title: "M1", slides: [{ kind: "cards", cards: [{ heading: "X", body: "y" }] }] }] as never;
    expect(completarDefinicoes(out, [{ title: "M1", content: "" }])).toEqual([]);
  });

  it("slide sem cartões é ignorado", () => {
    const out = [{ title: "M1", slides: [{ kind: "bullets", bullets: ["a"] }] }] as never;
    expect(completarDefinicoes(out, [{ title: "M1", content: MODULO_1 }])).toEqual([]);
  });
});
