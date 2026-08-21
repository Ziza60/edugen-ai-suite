import { describe, expect, it } from "vitest";
import { ensurePedagogicalCoverage } from "../../supabase/functions/export-pptx-v7/deck-plan";
import { normalizeDeck } from "../../supabase/functions/export-pptx-v7/validate";

// ═══════════════════════════════════════════════════════════════════════════
// A TABELA AMPUTADA
//
// Curso de orçamento de 21/08. A atividade prática "Identificação de Dados
// Críticos" ocupa a página 57 do PDF com cinco linhas — Relatório, Indicador
// Fiscal Observado, Valor Apurado, Limite Legal, Análise e Sugestão de Ação.
// O slide 39 do PPTX trouxe UMA: só "Relatório (RGF/RREO)".
//
// A causa não é limite de tamanho. MAX_TABLE_ROWS é 6 e o construtor
// determinístico, lendo o mesmo markdown, montava as cinco linhas. O
// planejador simplesmente escreveu uma linha só; a tabela completa era montada
// logo depois e descartada, porque a checagem de cobertura via a tabela do
// planejador e concluía "esta seção já está no deck".
//
// Não é regressão: os decks de 20/08 (dois) trazem exatamente o mesmo slide,
// 2 linhas e 6 células, com o mesmo título.
// ═══════════════════════════════════════════════════════════════════════════

const MODULO = `
### Atividade Prática: Identificação de Dados Críticos em Relatórios Fiscais

> **Objetivo:** Preencher um modelo simplificado de parecer técnico.

| Campo | Orientação | Seu caso |
| --- | --- | --- |
| Relatório (RGF/RREO) | Indique qual relatório está sendo analisado. | ________________ |
| Indicador Fiscal Observado | Nomeie o indicador fiscal. | ________________ |
| Valor Apurado (hipotético) | Apresente um valor hipotético para o indicador. | ________________ |
| Limite Legal (LRF/RSF) | Indique o limite conforme a LRF. | ________________ |
| Análise e Sugestão de Ação | Comente se o valor apurado está em conformidade. | ________________ |

**Entregável:** Um modelo de parecer técnico preenchido.
`;

const TITULO_MODULO = "CONTROLE E TRANSPARÊNCIA NA GESTÃO FISCAL MUNICIPAL";

/** O slide 39 exatamente como saiu do deck de 21/08. */
function tabelaDoPlanejador(linhas: { label: string; cells: string[] }[]) {
  return {
    kind: "table",
    title: "Atividade Prática: Identificação de Dados Críticos",
    eyebrow: TITULO_MODULO,
    columns: ["Campo", "Orientação", "Seu caso"],
    rows: linhas,
  };
}

const UMA_LINHA = [{
  label: "Relatório (RGF/RREO)",
  cells: ["Indique qual relatório está sendo analisado.", "________________"],
}];

function rodar(slides: unknown[], conteudo = MODULO) {
  const out: any[] = [{ title: TITULO_MODULO, slides: slides.slice() }];
  const r = ensurePedagogicalCoverage(
    out,
    [{ title: TITULO_MODULO, content: conteudo }] as any,
    "Português",
  );
  return { modulo: out[0], ...r };
}

const FECHAMENTO = { kind: "closing", title: "Recapitulando", bullets: ["a", "b"] };

describe("tabela do planejador com menos linhas que a fonte", () => {
  const { modulo, tablesAdded } = rodar([tabelaDoPlanejador(UMA_LINHA), FECHAMENTO]);
  const tabelas = modulo.slides.filter((s: any) => s.kind === "table");

  it("as cinco linhas da fonte chegam ao slide", () => {
    expect(tabelas).toHaveLength(1);
    expect(tabelas[0].rows).toHaveLength(5);
    expect(tablesAdded).toBe(1);
  });

  it("as linhas que faltavam são as da página 57, na ordem", () => {
    const rotulos = tabelas[0].rows.map((r: any) => r.label);
    expect(rotulos[0]).toContain("Relatório");
    expect(rotulos[1]).toContain("Indicador Fiscal");
    expect(rotulos[4]).toContain("Análise");
  });

  it("substitui a tabela no lugar — não acrescenta uma segunda", () => {
    expect(modulo.slides.filter((s: any) => s.kind === "table")).toHaveLength(1);
    expect(modulo.slides.indexOf(tabelas[0])).toBe(0);
  });

  it("mantém o título e o olho que o planejador já ajustou", () => {
    expect(tabelas[0].title).toBe("Atividade Prática: Identificação de Dados Críticos");
    expect(tabelas[0].eyebrow).toBe(TITULO_MODULO);
  });

  it("a coluna de preencher continua preenchível", () => {
    expect(tabelas[0].rows[0].cells.at(-1)).toContain("____");
  });
});

describe("o que NÃO deve mexer", () => {
  it("tabela do planejador já completa fica como está", () => {
    const completa = [
      { label: "Relatório (RGF/RREO)", cells: ["Indique qual relatório.", "___"] },
      { label: "Indicador Fiscal Observado", cells: ["Nomeie o indicador.", "___"] },
      { label: "Valor Apurado", cells: ["Apresente um valor.", "___"] },
      { label: "Limite Legal", cells: ["Indique o limite.", "___"] },
      { label: "Análise e Sugestão", cells: ["Comente a conformidade.", "___"] },
    ];
    const { modulo, tablesAdded } = rodar([tabelaDoPlanejador(completa), FECHAMENTO]);
    expect(tablesAdded).toBe(0);
    expect(modulo.slides.filter((s: any) => s.kind === "table")).toHaveLength(1);
    expect(modulo.slides[0].rows).toHaveLength(5);
  });

  it("tabela do planejador sobre OUTRO assunto não é sobrescrita", () => {
    const outra = {
      kind: "table",
      title: "Comparativo: PPA, LDO e LOA",
      eyebrow: TITULO_MODULO,
      rowHeader: "Instrumento",
      columns: ["Prazo", "Função"],
      rows: [{ label: "PPA", cells: ["4 anos", "Diretrizes"] }],
    };
    const { modulo } = rodar([outra, FECHAMENTO]);
    const comparativo = modulo.slides.find((s: any) => s.title.startsWith("Comparativo"));
    expect(comparativo.rows).toHaveLength(1); // intacta
    // A tabela da atividade entra como slide novo, sem apagar a outra.
    const atividade = modulo.slides.find((s: any) =>
      s.kind === "table" && (s.rowHeader ?? "") === "Campo"
    );
    expect(atividade.rows).toHaveLength(5);
  });

  it("módulo sem tabela na fonte não ganha tabela", () => {
    const { modulo, tablesAdded } = rodar(
      [FECHAMENTO],
      "### Uma lição qualquer\n\nSó prosa aqui, sem tabela nenhuma.",
    );
    expect(tablesAdded).toBe(0);
    expect(modulo.slides.filter((s: any) => s.kind === "table")).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O CANTO SUPERIOR ESQUERDO EM BRANCO
//
// Achado ao escrever o teste acima. A normalização recalculava `rowHeader` do
// zero e jogava fora o que vinha pronto, então toda tabela montada a partir do
// markdown chegava ao slide sem o rótulo da primeira coluna. No deck de 21/08:
// "Campo" ausente nos slides 20, 30 e 49, "Critério" no 50, "Instrumento" no 8.
// A do slide 39 exibia "Campo" por acidente — veio do planejador e caiu no
// conserto de defasagem de coluna.
// ═══════════════════════════════════════════════════════════════════════════

describe("rótulo da coluna de rótulos", () => {
  const tabela = (extra: Record<string, unknown>) => {
    const { deck } = normalizeDeck({
      modules: [{
        title: TITULO_MODULO,
        slides: [{
          kind: "table",
          title: "Uma tabela",
          rows: [
            { label: "PPA", cells: ["4 anos", "Diretrizes"] },
            { label: "LDO", cells: ["1 ano", "Metas"] },
          ],
          ...extra,
        }],
      }],
    } as any);
    return deck.modules[0].slides[0];
  };

  it("o rótulo que veio pronto chega ao slide", () => {
    expect(tabela({ rowHeader: "Instrumento", columns: ["Prazo", "Função"] }).rowHeader)
      .toBe("Instrumento");
  });

  it("sem rótulo pronto, o conserto de defasagem continua valendo", () => {
    const s = tabela({ columns: ["Instrumento", "Prazo", "Função"] });
    expect(s.rowHeader).toBe("Instrumento");
    expect(s.columns).toEqual(["Prazo", "Função"]);
  });

  it("rótulo pronto impede o conserto de comer uma coluna de dados", () => {
    const s = tabela({ rowHeader: "Instrumento", columns: ["Prazo", "Função", "Vigência"] });
    expect(s.rowHeader).toBe("Instrumento");
    expect(s.columns).toEqual(["Prazo", "Função", "Vigência"]);
  });
});

describe("as cinco linhas sobrevivem à normalização", () => {
  it("nenhuma linha é descartada e a última coluna não fica vazia", () => {
    const { modulo } = rodar([tabelaDoPlanejador(UMA_LINHA), FECHAMENTO]);
    const { deck } = normalizeDeck({ modules: [modulo] } as any);
    const tabela = deck.modules[0].slides.find((s) => s.kind === "table")!;
    expect(tabela.rows).toHaveLength(5);
    expect(tabela.columns).toEqual(["Orientação", "Seu caso"]);
    expect(tabela.rowHeader).toBe("Campo");
    for (const r of tabela.rows!) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.cells).toHaveLength(2);
      expect(r.cells[0].length).toBeGreaterThan(0);
    }
  });
});
