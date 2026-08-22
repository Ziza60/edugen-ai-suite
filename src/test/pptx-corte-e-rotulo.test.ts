import { describe, expect, it } from "vitest";
import {
  chevronCabe,
  esqueletoDeCaso,
  rotuloDoNucleo,
  terminaEmClassificador,
  trimToWholeThought,
} from "../../supabase/functions/export-pptx-v7/layout-fit";
import { ensurePedagogicalCoverage } from "../../supabase/functions/export-pptx-v7/deck-plan";
import { normalizeDeck } from "../../supabase/functions/export-pptx-v7/validate";

// ═══════════════════════════════════════════════════════════════════════════
// Curso de Gestão de Estoque, 22/08 — o primeiro fora da administração pública.
// Três defeitos que só apareceram porque o assunto mudou.
// ═══════════════════════════════════════════════════════════════════════════

describe('"Categoria A" perdia o A', () => {
  // Slide 10: o rótulo saiu "Categoria" ao lado de "Categoria B" e "Categoria
  // C". A letra da categoria mais importante do curso foi confundida com o
  // artigo "a" e descartada com as palavras de ligação.
  it("o rótulo mantém a letra da categoria", () => {
    expect(rotuloDoNucleo("Categoria A — Os Produtos Essenciais (Alto Valor)", 2, 18))
      .toBe("Categoria A");
  });

  it("as três categorias ficam distinguíveis entre si", () => {
    const r = ["A", "B", "C"].map((L) =>
      rotuloDoNucleo(`Categoria ${L} — Descrição qualquer aqui`, 2, 18)
    );
    expect(new Set(r).size).toBe(3);
    expect(r).toEqual(["Categoria A", "Categoria B", "Categoria C"]);
  });

  it("vale para outros classificadores de uma letra", () => {
    expect(rotuloDoNucleo("Plano B — alternativa", 2, 18)).toBe("Plano B");
    expect(rotuloDoNucleo("Vitamina C e seus efeitos", 2, 18)).toBe("Vitamina C");
  });

  it("artigo de verdade continua sendo descartado", () => {
    // Aqui o "O" abre o texto: não há nome antes dele, logo é artigo.
    expect(rotuloDoNucleo("Prestação de Contas Anual: O Fechamento", 2, 18))
      .toBe("Fechamento");
    expect(rotuloDoNucleo("Os Pilares da Gestão Fiscal", 2, 18)).toBe("Pilares Gestão");
  });

  it("a legenda do gráfico também para de perder a letra", () => {
    // Slide 9: o mesmo defeito pelo outro caminho — a limpeza de sobras de
    // corte via o "A" final como preposição pendurada.
    expect(terminaEmClassificador("Categoria A")).toBe(true);
    expect(terminaEmClassificador("classificou o Café Premium")).toBe(false);
    const { deck } = normalizeDeck({
      modules: [{
        title: "M",
        slides: [{
          kind: "chart",
          title: "Distribuição",
          chart: {
            type: "donut",
            points: [
              { label: "Categoria A", value: 75 },
              { label: "Categoria B", value: 18 },
              { label: "Categoria C", value: 7 },
            ],
          },
        }],
      }],
    } as never);
    expect(deck.modules[0].slides[0].chart!.points.map((p) => p.label))
      .toEqual(["Categoria A", "Categoria B", "Categoria C"]);
  });
});

describe("frase cortada pela metade — slide 11", () => {
  // As duas frases exatamente como estão no PDF (págs. 12-13 do curso).
  const FONTE = `#### Exemplo Prático: Curva ABC no Armazém da Esquina

**Contexto:** O Sr. João decidiu aplicar a Curva ABC para entender melhor seu mix de produtos.

**Desafio:** Sr. João precisa classificar seus produtos em categorias A, B e C.

**Solução:** Sr. João organizou os dados da seguinte forma: 1. Calculou o valor total de vendas de cada produto no semestre. 2. Ordenou os produtos.

**Resultado:** Aplicando os percentuais, o Sr. João classificou o Café Premium, Sabão em Pó e Arroz 5kg como itens da Categoria A (representando a maior parte do valor de vendas). O Papel Higiênico foi B.
`;

  const passos = (() => {
    const out: any[] = [{ title: "M", slides: [{ kind: "closing", title: "z", bullets: ["a"] }] }];
    ensurePedagogicalCoverage(out, [{ title: "M", content: FONTE }] as never, "Português");
    const caso = out[0].slides.find((s: any) => s.steps);
    return Object.fromEntries(caso.steps.map((p: any) => [p.heading, p.body]));
  })();

  it("a chamada de lista não deixa um número órfão no fim", () => {
    // Saiu assim no deck: "…da seguinte forma: 1." — prometia uma lista que o
    // slide não traz, e o "1." solto parecia defeito de renderização.
    expect(passos["Solução"]).toBe("Sr. João organizou os dados da seguinte forma");
    expect(passos["Solução"]).not.toMatch(/:\s*\d+\.?$/);
  });

  it("a enumeração chega inteira — cortá-la ao meio trocava o fato", () => {
    // Saiu assim no deck: "…classificou o Café Premium". Não era uma frase pela
    // metade: era uma frase inteira e ERRADA, dizendo que só um produto foi
    // classificado como A. Três foram.
    expect(passos["Resultado"]).toContain("Sabão em Pó");
    expect(passos["Resultado"]).toContain("Arroz 5kg");
    expect(passos["Resultado"]).toContain("Categoria A");
  });

  it("o aparte entre parênteses é o que se sacrifica para caber", () => {
    expect(passos["Resultado"]).not.toContain("representando");
    expect(passos["Resultado"].split(/\s+/).length).toBeLessThanOrEqual(24);
  });

  it("os quatro momentos do caso continuam presentes", () => {
    expect(Object.keys(passos)).toEqual(["Contexto", "Desafio", "Solução", "Resultado"]);
    for (const b of Object.values(passos)) expect(String(b).length).toBeGreaterThan(20);
  });

  it("texto que já cabe não é mexido", () => {
    const ok = "O estoque de segurança cobre atrasos do fornecedor.";
    expect(trimToWholeThought(ok)).toBe(ok);
  });
});

describe("esqueleto de estudo de caso, agora com rótulo estranho no meio", () => {
  // Slide 29: Contexto · Desafio · DADOS · Solução · Resultado. "Dados" não é
  // rótulo de caso, e a exigência de unanimidade deixava o slide passar.
  const semCorpo = (rotulos: string[]) => ({
    kind: "steps",
    title: "Exemplo Prático: LEC para o Armazém da Esquina",
    steps: rotulos.map((h) => ({ heading: h })),
  });

  it("cinco itens com um intruso ainda é esqueleto", () => {
    expect(esqueletoDeCaso(
      semCorpo(["Contexto", "Desafio", "Dados", "Solução", "Resultado"]),
    )).toBe(true);
  });

  it("quatro rótulos limpos continuam sendo esqueleto", () => {
    expect(esqueletoDeCaso(semCorpo(["Contexto", "Desafio", "Solução", "Resultado"])))
      .toBe(true);
  });

  it("sequência legítima sem rótulo de caso não é tocada", () => {
    expect(esqueletoDeCaso(
      semCorpo(["Fixação", "Empenho", "Liquidação", "Pagamento"]),
    )).toBe(false);
  });

  it("maioria de intrusos não é esqueleto", () => {
    expect(esqueletoDeCaso(
      semCorpo(["Contexto", "Dados", "Fórmula", "Cálculo", "Planilha"]),
    )).toBe(false);
  });

  it("com corpo, fica — é um caso de verdade", () => {
    expect(esqueletoDeCaso({
      kind: "steps",
      steps: [
        { heading: "Contexto", body: "O Sr. João faz compras de forma reativa." },
        { heading: "Desafio", body: "Calcular o custo de pedido." },
        { heading: "Solução", body: "Somou horas e rateou pelo número de pedidos." },
      ],
    })).toBe(false);
  });
});

describe("o esqueleto é barrado na NORMALIZAÇÃO, que é o fim da linha", () => {
  // Foi aqui que os slides 19 e 29 escaparam: na cobertura, que roda antes,
  // eles ainda tinham corpo. A limpeza posterior é que os esvaziou.
  it("passos cujo corpo se dissolve na limpeza não viram slide", () => {
    const { deck, stats } = normalizeDeck({
      modules: [{
        title: "Avaliação Econômica do Estoque",
        slides: [
          {
            kind: "steps",
            title: "Cálculo do Custo de Pedido: Armazém da Esquina",
            // Corpos que a limpeza reduz a nada: só reticências e sobras.
            steps: [
              { heading: "Contexto", body: "..." },
              { heading: "Desafio", body: "…" },
              { heading: "Solução", body: "  " },
              { heading: "Resultado", body: "" },
            ],
          },
          { kind: "bullets", title: "Um slide de verdade", bullets: ["Conteúdo real aqui."] },
        ],
      }],
    } as never);
    expect(deck.modules[0].slides.map((s) => s.title)).toEqual(["Um slide de verdade"]);
    expect(stats.slidesDropped).toBe(1);
  });

  it("o mesmo slide COM corpo sobrevive à normalização", () => {
    const { deck } = normalizeDeck({
      modules: [{
        title: "M",
        slides: [{
          kind: "steps",
          title: "Cálculo do Custo de Pedido",
          steps: [
            { heading: "Contexto", body: "O Sr. João faz as compras de forma reativa." },
            { heading: "Desafio", body: "Descobrir quanto custa cada pedido." },
            { heading: "Solução", body: "Somar o tempo gasto e ratear pelos pedidos do mês." },
          ],
        }],
      }],
    } as never);
    expect(deck.modules[0].slides).toHaveLength(1);
    expect(deck.modules[0].slides[0].steps).toHaveLength(3);
  });

  it("módulo que ficaria vazio ganha um slide de seção, não fica sem nada", () => {
    const { deck } = normalizeDeck({
      modules: [{
        title: "Módulo só com esqueleto",
        slides: [{
          kind: "steps",
          title: "Estudo de Caso",
          steps: [{ heading: "Contexto" }, { heading: "Desafio" }, { heading: "Resultado" }],
        }],
      }],
    } as never);
    expect(deck.modules[0].slides).toHaveLength(1);
    expect(deck.modules[0].slides[0].kind).toBe("section");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A CAUSA QUE EU PROCUREI POR TRÊS DECKS
//
// Slides 20 e 30 do deck de 22/08 (2ª geração): "1 Contexto · 2 Desafio ·
// 3 Solução · 4 Resultado" e nada mais — pela terceira vez, agora com o
// carimbo confirmando que TODAS as proteções que eu havia escrito estavam no
// ar. Elas não podiam funcionar.
//
// O slide nunca esteve vazio. O texto existia, chegava inteiro à renderização,
// e a variante de chevron o descartava: ela lê apenas os títulos dos passos,
// porque é só o que cabe dentro da seta. A perda acontecia DEPOIS de todo
// ponto onde eu havia colocado triagem.
//
// A regra certa é anterior a qualquer triagem: uma forma que não sabe mostrar
// o corpo não recebe conteúdo que tem corpo.
// ═══════════════════════════════════════════════════════════════════════════

describe("a seta só desenha o rótulo, então só recebe rótulos", () => {
  const passo = (heading: string, body?: string) => ({ heading, body });

  it("passos COM corpo nunca vão para a seta — era aqui que o texto sumia", () => {
    expect(chevronCabe([
      passo("Contexto", "No Armazém da Esquina, o Sr. João compra de forma reativa."),
      passo("Desafio", "Descobrir quanto custa cada pedido."),
      passo("Solução", "Somar o tempo gasto e ratear pelos pedidos do mês."),
      passo("Resultado", "Chegou a R$ 42,50 por pedido."),
    ])).toBe(false);
  });

  it("basta UM passo com corpo para a seta estar fora", () => {
    expect(chevronCabe([
      passo("Contexto", "Só este tem texto."),
      passo("Desafio"),
      passo("Solução"),
    ])).toBe(false);
  });

  it("sequência de rótulo puro continua ganhando a seta", () => {
    expect(chevronCabe([
      passo("Fixação"), passo("Empenho"), passo("Liquidação"), passo("Pagamento"),
    ])).toBe(true);
  });

  it("corpo em branco não conta como corpo", () => {
    expect(chevronCabe([passo("Previsão", "  "), passo("Lançamento", ""), passo("Arrecadação")]))
      .toBe(true);
  });

  it("as condições antigas continuam valendo", () => {
    const puro = (n: number) => Array.from({ length: n }, (_, i) => passo(`Etapa ${i + 1}`));
    expect(chevronCabe(puro(2))).toBe(false); // poucos
    expect(chevronCabe(puro(6))).toBe(false); // demais
    expect(chevronCabe([
      passo("Um rótulo bem mais longo do que caberia na seta"),
      passo("Empenho"),
      passo("Pagamento"),
    ])).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O CORTE VOLTOU — E NUNCA TINHA SIDO CONSERTADO AQUI
//
// A pergunta era: consertamos e regrediu, ou o conserto não alcançava estes
// textos? A contagem responde: 25 células de tabela cortadas no deck de antes,
// 24 no de depois. As MESMAS células, com o MESMO texto. Nunca foi regressão —
// o reparo anterior mexeu em toShortPoint com orçamento de 24 palavras, que é
// o corpo do exemplo trabalhado. A célula de tabela tem outro caminho e outro
// orçamento, e ficou de fora.
//
// A causa é dois tetos em série, de novo: 10 palavras ao montar a tabela e 12
// ao normalizar. O primeiro, mais apertado, decidia tudo — e a célula desenhada
// comporta 80 caracteres. Um teto de palavras mais restritivo que o de
// caracteres corta texto que caberia na página.
// ═══════════════════════════════════════════════════════════════════════════

describe("a célula da atividade cabe no que a coluna desenha", () => {
  // Os três campos da atividade do LEC, exatamente como estão no curso.
  const FONTE = `#### Atividade: Calcule o LEC para Outro Item do Armazém

> **Objetivo:** Aplicar a fórmula do LEC.

| Campo | Orientação | Seu caso |
| --- | --- | --- |
| Custo de Manutenção (CM) | Estime o Custo de Manutenção anual por unidade para o produto (ex: R$ 2,50 por unidade/ano). | ________________ |
| Cálculo do LEC | Escreva a fórmula e mostre os passos do cálculo (LEC = ((2 * D * CP) / CM)). | ________________ |
| LEC Resultante | Qual é a quantidade ideal a ser comprada por pedido para este produto? | ________________ |
`;

  const celulas = (() => {
    const out: any[] = [{ title: "M", slides: [{ kind: "closing", title: "z", bullets: ["a"] }] }];
    ensurePedagogicalCoverage(out, [{ title: "M", content: FONTE }] as never, "Português");
    const { deck } = normalizeDeck({ modules: out } as never);
    const t = deck.modules[0].slides.find((s) => s.kind === "table")!;
    return t.rows!.map((r) => r.cells[0]);
  })();

  it("a instrução mantém o exemplo que a torna utilizável", () => {
    // Saía "Estime o Custo de Manutenção anual por unidade" — inteira e inútil.
    expect(celulas[0]).toContain("para o produto");
  });

  it("a pergunta continua sendo uma pergunta", () => {
    // Saía "…comprada por pedido", sem complemento e sem interrogação.
    expect(celulas[2]).toContain("para este produto");
    expect(celulas[2].trim().endsWith("?")).toBe(true);
  });

  it("nenhuma célula estoura o que a coluna desenha", () => {
    for (const c of celulas) expect(c.length).toBeLessThanOrEqual(80);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A FÓRMULA PERDIA OS SINAIS DE MULTIPLICAÇÃO
//
// Achado ao conferir a célula acima: "((2 * D * CP) / CM)" chegava ao slide
// como "((2 D CP) / CM)". A limpeza de itálico do markdown casava com o par
// " * D * " e engolia os dois asteriscos. Não é texto cortado — é fórmula
// trocada, que num curso de cálculo de estoque é pior.
// ═══════════════════════════════════════════════════════════════════════════

describe("asterisco de multiplicação não é itálico", () => {
  const passar = (md: string) => {
    const out: any[] = [{ title: "M", slides: [{ kind: "closing", title: "z", bullets: ["a"] }] }];
    ensurePedagogicalCoverage(
      out,
      [{ title: "M", content: `#### Atividade: Fórmulas\n\n| Campo | Orientação | Seu caso |\n| --- | --- | --- |\n| A | ${md} | ____ |\n| B | Outra coisa qualquer aqui. | ____ |\n| C | Mais uma coisa qualquer. | ____ |\n` }] as never,
      "Português",
    );
    const t = out[0].slides.find((s: any) => s.kind === "table");
    return t.rows[0].cells[0] as string;
  };

  it("a multiplicação sobrevive", () => {
    expect(passar("LEC = ((2 * D * CP) / CM)")).toContain("2 * D * CP");
  });

  it("itálico de verdade continua sendo removido", () => {
    expect(passar("O valor é *estimado* pelo gestor")).toBe("O valor é estimado pelo gestor");
  });
});
