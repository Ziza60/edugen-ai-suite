import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  completarCartoes,
  completarDefinicoes,
  definicaoNaFonte,
  frasesDoTexto,
  palavrasDeConteudo,
  perdeuClausula,
  semOPreambulo,
} from "../../supabase/functions/export-pptx-v7/definicoes-da-fonte";

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
