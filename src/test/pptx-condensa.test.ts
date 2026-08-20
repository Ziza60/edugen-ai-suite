import { describe, expect, it } from "vitest";
import { condenseForPlanning } from "../../supabase/functions/export-pptx-v7/deck-plan";

// ═══════════════════════════════════════════════════════════════════════════
// A função prometia condensar e entregava um corte: encurtava blocos de código
// e terminava em `slice(0, maxChars)`. Chamada com 4.000 sobre um módulo real
// de ~32.000 caracteres, o planejador via 12% do módulo — sempre os 12%
// iniciais, que são abertura e objetivos, quase nunca a substância.
//
// Medido no curso de orçamento de 20/08: dos 153 percentuais que o conteúdo
// passou a trazer depois que a regra de números virou exigência, só 12 caíam
// dentro da janela. Foi por isso que o slide de gráfico continuou dormente
// mesmo com o conteúdo cheio de números — o gargalo tinha mudado de lugar.
//
// Agora ela preserva o que serve para PLANEJAR (estrutura e evidência) e
// descarta o que serve para LER (a prosa de desenvolvimento).
// ═══════════════════════════════════════════════════════════════════════════

const numeros = (s: string) => (s.match(/\d+(?:,\d+)?%/g) ?? []).length;

/** Um módulo no formato que o gerador produz, com número no fim de parágrafo. */
const MODULO = `## Limites de Gastos com Pessoal

### A Receita Corrente Líquida
A RCL é a base de cálculo dos limites da LRF. Ela soma as receitas correntes e
deduz as transferências constitucionais a outros entes. O cálculo considera os
doze meses anteriores. Em Vila Nova Verde, a RCL apurada no exercício foi a
referência para todos os limites: o Executivo não pode ultrapassar 54% dela.

### Os limites por Poder
A LRF reparte o limite global de 60% entre os Poderes. O Executivo municipal
fica com 54% e o Legislativo com 6%. Cada Poder responde por seu próprio
enquadramento, e a apuração é quadrimestral.

| Poder | Limite | Apurado |
| --- | --- | --- |
| Executivo | 54% | 51,3% |
| Legislativo | 6% | 4,2% |

### Vinculações constitucionais
Além do gasto com pessoal, a Constituição vincula parte da receita de impostos.
São dois percentuais mínimos que o gestor não pode ignorar em nenhuma hipótese,
sob pena de responsabilização pessoal do ordenador de despesa.

- Educação: 25% da receita resultante de impostos
- Saúde: 15% da receita resultante de impostos
`;

describe("condenseForPlanning — preserva a evidência numérica", () => {
  it("um módulo grande deixa de perder os números no corte", () => {
    // Módulo inflado com prosa, como um módulo real: os números ficam no fim.
    const encheLinguica = "Este parágrafo desenvolve o raciocínio sem trazer dado novo. ".repeat(60);
    const grande = `${encheLinguica}\n\n${MODULO}`;

    const cortado = grande.slice(0, 1500);            // o comportamento antigo
    const condensado = condenseForPlanning(grande, 1500);

    expect(numeros(cortado)).toBe(0);
    expect(numeros(condensado)).toBeGreaterThan(0);
  });

  it("frase com número sobrevive mesmo no meio do parágrafo", () => {
    const p = "A LRF reparte o limite global. Uma frase qualquer sem dado. " +
      "O Executivo municipal fica com 54% e o Legislativo com 6%. " +
      "Outra frase de desenvolvimento sem número nenhum aqui.";
    const grande = p.repeat(40);
    expect(condenseForPlanning(grande, 2000)).toContain("54%");
  });

  it("mantém a primeira frase do parágrafo, que diz do que ele trata", () => {
    const grande = MODULO + "\n\n" + "Prosa longa sem dado. ".repeat(400);
    expect(condenseForPlanning(grande, 2500)).toContain("A RCL é a base de cálculo");
  });
});

describe("condenseForPlanning — preserva a estrutura", () => {
  const grande = MODULO + "\n\n" + "Parágrafo de enchimento sem dado algum. ".repeat(300);
  const out = condenseForPlanning(grande, 2000);

  it("títulos passam inteiros — são eles que viram slide", () => {
    expect(out).toContain("### A Receita Corrente Líquida");
    expect(out).toContain("### Os limites por Poder");
  });

  it("linhas de tabela passam inteiras", () => {
    expect(out).toContain("| Executivo | 54% | 51,3% |");
  });

  it("itens de lista passam inteiros", () => {
    expect(out).toContain("- Educação: 25% da receita resultante de impostos");
  });
});

describe("condenseForPlanning — o que não pode mudar", () => {
  it("conteúdo dentro do orçamento passa sem tocar", () => {
    expect(condenseForPlanning(MODULO, 99999)).toBe(MODULO);
  });

  it("respeita o teto pedido", () => {
    const grande = MODULO.repeat(20);
    expect(condenseForPlanning(grande, 3000).length).toBeLessThanOrEqual(3000);
  });

  it("quando precisa cortar, corta em fim de linha e não no meio da frase", () => {
    const grande = MODULO.repeat(20);
    const out = condenseForPlanning(grande, 3000);
    expect(out).toBe(out.trimEnd());
    expect(out.endsWith("…")).toBe(false);
  });

  it("bloco de código longo continua encurtado para 8 linhas", () => {
    const code = "```sql\n" + Array.from({ length: 40 }, (_, i) => `SELECT ${i};`).join("\n") + "\n```";
    const out = condenseForPlanning(code, 6000);
    expect(out).toContain("SELECT 7;");
    expect(out).not.toContain("SELECT 20;");
  });

  it("vazio não quebra", () => {
    expect(condenseForPlanning("", 100)).toBe("");
  });
});
