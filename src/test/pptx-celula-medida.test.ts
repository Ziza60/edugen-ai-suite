import { describe, expect, it } from "vitest";
import {
  alturaDaLinha,
  capacidadeDaCelula,
  capacidadeDoPasso,
  corpoDaCelula,
  larguraDaColuna,
  larguraDoRotulo,
  tetoDoCorpoDoPasso,
} from "../../supabase/functions/export-pptx-v7/table-geometry";
import { normalizeDeck } from "../../supabase/functions/export-pptx-v7/validate";

// ═══════════════════════════════════════════════════════════════════════════
// O TETO DA CÉLULA QUE NÃO OLHAVA PARA A CÉLULA
//
// MAX_TABLE_CELL_CHARS = 80, igual para toda tabela. Medindo as dez tabelas do
// deck de 23/08, a capacidade real ia de 78 a 220 caracteres conforme o número
// de colunas — a constante fora calibrada para a tabela mais apertada e punia
// todas as outras.
//
// Na apostila isso aparecia assim, no slide 50, numa célula de 11,82 cm:
//
//   «Descreva o cenário atual do Armazém da Esquina e a importância de uma»
//
// Setenta e quatro caracteres, cortado no meio de "uma nova ...", numa célula
// que comportava cento e setenta e um.
// ═══════════════════════════════════════════════════════════════════════════

describe("a geometria da tabela", () => {
  it("três colunas dão o dobro de espaço de cinco", () => {
    expect(larguraDaColuna(3)).toBeGreaterThan(larguraDaColuna(5) * 1.5);
  });

  it("o rótulo não passa de 3 polegadas nem fica abaixo de 2", () => {
    expect(larguraDoRotulo()).toBeGreaterThanOrEqual(2.0);
    expect(larguraDoRotulo()).toBeLessThanOrEqual(3.0);
  });

  it("as colunas somadas cabem na largura útil do slide", () => {
    for (const ncol of [2, 3, 4, 5]) {
      const total = larguraDoRotulo() + larguraDaColuna(ncol) * ncol;
      expect(total).toBeLessThanOrEqual(13.333 - 0.7 - 0.7 + 0.001);
    }
  });

  it("a fonte encolhe quando entram mais colunas", () => {
    expect(corpoDaCelula(3)).toBe(11);
    expect(corpoDaCelula(4)).toBe(10);
    expect(corpoDaCelula(5)).toBe(9);
  });

  it("a linha nunca passa do teto de 0,95 polegada", () => {
    expect(alturaDaLinha(1)).toBeLessThanOrEqual(0.95);
    expect(alturaDaLinha(8)).toBeLessThan(alturaDaLinha(4));
  });
});

describe("capacidadeDaCelula", () => {
  it("a tabela larga do slide 50 comporta muito mais que 80 caracteres", () => {
    // O slide 50 tinha 3 colunas desenhadas: rótulo + 2 de dados. A célula de
    // 11,82 cm comporta 171 caracteres, e o teto fixo cortava aos 80.
    expect(capacidadeDaCelula(2, 6)).toBeGreaterThan(160);
  });

  it("a tabela apertada continua perto do teto antigo", () => {
    // Com quatro colunas de dados o 80 estava quase certo, e a medição não pode
    // afrouxar: 87 contra os 80 de antes.
    expect(capacidadeDaCelula(4, 6)).toBeLessThan(95);
  });

  it("mais colunas apertam a célula — até a fonte encolher", () => {
    // De 2 para 4 colunas a capacidade só cai. Na quinta ela SOBE: o
    // renderizador baixa o corpo de 10 para 9 pt, e a letra menor recupera mais
    // espaço do que a coluna estreita tira. Não é defeito, é a troca que o
    // renderizador já fazia — e o teto fixo de 80 ignorava nos dois sentidos.
    expect(capacidadeDaCelula(3, 6)).toBeLessThan(capacidadeDaCelula(2, 6));
    expect(capacidadeDaCelula(4, 6)).toBeLessThan(capacidadeDaCelula(3, 6));
    expect(capacidadeDaCelula(5, 6)).toBeGreaterThan(capacidadeDaCelula(4, 6));
  });

  it("mais linhas encolhem a célula, nunca a aumentam", () => {
    expect(capacidadeDaCelula(3, 6)).toBeLessThanOrEqual(capacidadeDaCelula(3, 2));
  });

  it("nunca desce abaixo do piso de 60 caracteres", () => {
    // Abaixo disso a célula não diz mais nada útil; o certo seria a tabela ter
    // menos colunas, não o texto virar duas palavras.
    for (const n of [5, 8, 12]) {
      for (const linhas of [6, 12, 30]) {
        expect(capacidadeDaCelula(n, linhas)).toBeGreaterThanOrEqual(60);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DE PONTA A PONTA: a frase do slide 50 passa inteira pela normalização
// ═══════════════════════════════════════════════════════════════════════════

const FRASE =
  "Descreva o cenário atual do Armazém da Esquina e a importância de uma nova " +
  "abordagem de gestão de estoque para o negócio.";

const LONGA = FRASE +
  " Avalie também o impacto financeiro previsto em cada uma das etapas propostas, " +
  "com prazo e responsável definidos para o acompanhamento mensal do plano.";

function deckComTabela(colunas: string[], texto: string = FRASE) {
  return {
    title: "Curso",
    modules: [
      {
        title: "Módulo 1",
        slides: [
          {
            kind: "table" as const,
            title: "Desenvolva e Apresente Seu Plano",
            rowHeader: "Critério",
            columns: colunas,
            rows: [
              { label: "Diagnóstico", cells: colunas.map(() => texto) },
              { label: "Fornecedores", cells: colunas.map(() => texto) },
            ],
          },
        ],
      },
    ],
  };
}

describe("a frase que saiu pendurada no slide 50", () => {
  it("cabe inteira numa tabela de duas colunas de dados", () => {
    const deck = normalizeDeck(deckComTabela(["Orientação", "Seu caso"]) as never).deck;
    const celula = (deck.modules[0].slides[0] as never as { rows: { cells: string[] }[] })
      .rows[0].cells[0];
    expect(celula).toBe(FRASE);
  });

  it("numa tabela apertada o texto longo é cortado — ali o espaço é pouco mesmo", () => {
    const deck = normalizeDeck(
      deckComTabela(["A", "B", "C", "D"], LONGA) as never,
    ).deck;
    const celula = (deck.modules[0].slides[0] as never as { rows: { cells: string[] }[] })
      .rows[0].cells[0];
    expect(celula.length).toBeLessThan(LONGA.length);
  });

  it("o corte, quando acontece, não deixa a frase pendurada", () => {
    const deck = normalizeDeck(
      deckComTabela(["A", "B", "C", "D"], LONGA) as never,
    ).deck;
    const celula = (deck.modules[0].slides[0] as never as { rows: { cells: string[] }[] })
      .rows[0].cells[0];
    // Não termina em preposição nem em artigo solto.
    expect(celula).not.toMatch(/\b(de|da|do|para|com|e|a|o|em|uma?)$/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O ACOPLAMENTO QUE A CORREÇÃO ANTERIOR CRIOU
//
// quebrarSequenciaDeLayout converte a segunda de duas tabelas seguidas em
// passos, para o módulo não repetir a forma. A conversão era recusada quando o
// corpo do passo passava de 130 caracteres — número calibrado quando a célula
// era de 80.
//
// Ao medir a célula e deixá-la chegar a 228, o corpo do passo (que é a
// concatenação das células da linha) passou de 130 em quase toda tabela, e a
// conversão parou de acontecer. No deck seguinte: formas distintas de 19 para
// 16, formas iguais seguidas de 4 para 6, três tabelas em sequência no fecho do
// módulo 5. Medindo os corpos: antes iam de 64 a 94; depois, de 92 a 282.
// ═══════════════════════════════════════════════════════════════════════════

describe("o teto do corpo do passo", () => {
  it("acompanha o que a barra desenha, em vez da constante 130", () => {
    expect(tetoDoCorpoDoPasso(4)).toBeGreaterThan(130);
    expect(tetoDoCorpoDoPasso(5)).toBeGreaterThan(130);
  });

  it("nunca desce abaixo dos 130 que vigoravam antes", () => {
    for (const n of [3, 4, 5, 8, 12]) {
      expect(tetoDoCorpoDoPasso(n)).toBeGreaterThanOrEqual(130);
    }
  });

  it("mais passos apertam a barra e baixam o teto", () => {
    expect(tetoDoCorpoDoPasso(5)).toBeLessThan(tetoDoCorpoDoPasso(3));
  });

  it("fica em metade do que cabe — a outra metade é respiro", () => {
    expect(tetoDoCorpoDoPasso(3)).toBeLessThanOrEqual(capacidadeDoPasso(3) * 0.5 + 1);
  });

  it("os corpos reais do deck de 23/08 voltam a converter", () => {
    // Quatro passos, corpos de 152 a 182 caracteres: recusados pelo 130,
    // aceitos pela medição. Os de 250–282 continuam recusados — ali a barra
    // viraria mesmo parede de texto.
    const teto = tetoDoCorpoDoPasso(4);
    for (const c of [152, 169, 175, 182]) expect(c).toBeLessThanOrEqual(teto);
    for (const c of [250, 282]) expect(c).toBeGreaterThan(teto);
  });
});
