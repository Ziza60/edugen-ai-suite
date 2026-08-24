import { describe, expect, it } from "vitest";
import { cleanModuleContent } from "../../supabase/functions/_shared/markdown";

// ═══════════════════════════════════════════════════════════════════════════
// O <br> QUE SAÍA IMPRESSO NA APOSTILA
//
// Curso "Formação de Preço de Venda no Pequeno Comércio", 24/08 16:36. O portão
// de qualidade reprovou com um bloqueador — duas tags HTML no módulo 4 — e
// estava certo: nenhum renderizador deste repositório sabe o que é <br>. Nem o
// PDF, nem o PPTX, nem o portal. A célula da tabela chegava ao aluno assim:
//
//   Considere:<br>- Ingredientes: R$ 45,00<br>- Embalagem: R$ 5,00<br>- ...
//
// O modelo recorre ao <br> por um motivo só: precisa de várias linhas dentro de
// uma célula, e uma quebra ali destruiria a tabela. Por isso a substituição
// depende de onde a tag está.
//
// As duas primeiras entradas abaixo são o texto literal do laudo.
// ═══════════════════════════════════════════════════════════════════════════

describe("cleanModuleContent — <br>", () => {
  it("numa célula de tabela, vira separador e não quebra a tabela", () => {
    const md =
      "| Custos Variáveis Unitários (Bolo de Aniversário) | Considere:<br>- Ingredientes: R$ 45,00<br>- Embalagem: R$ 5,00 |";
    const out = cleanModuleContent(md);
    expect(out).not.toContain("<br>");
    expect(out.split("\n")).toHaveLength(1); // a tabela continua de pé
    expect(out).toContain("Ingredientes: R$ 45,00");
    expect(out).toContain("Embalagem: R$ 5,00");
    // O hífen que o <br> simulava não fica órfão depois do separador.
    expect(out).not.toMatch(/·\s*-/);
  });

  it("fora de tabela, vira quebra de linha de verdade", () => {
    const out = cleanModuleContent("Primeira linha<br>Segunda linha");
    expect(out).toBe("Primeira linha\nSegunda linha");
  });

  it("aceita as três grafias da tag", () => {
    const out = cleanModuleContent("a<br>b<br/>c<BR />d");
    expect(out).not.toMatch(/<br/i);
    expect(out.split("\n")).toHaveLength(4);
  });

  it("não sobra ponto solto encostado na barra da tabela", () => {
    const out = cleanModuleContent("| Campo | Valor<br> |");
    expect(out).not.toMatch(/·\s*\|/);
    expect(out).not.toContain("<br>");
  });

  it("um curso que ENSINA HTML mantém o <br> do bloco de código", () => {
    // Reescrever o próprio conteúdo que o curso se propõe a ensinar é o erro
    // que as buscas por vazamento do portão já tiveram de aprender a evitar.
    const md = "Use a quebra:\n\n```html\n<p>Linha um<br>Linha dois</p>\n```\n\nFim.";
    expect(cleanModuleContent(md)).toContain("<br>");
  });

  it("o <br> em código de linha também fica", () => {
    const md = "A tag `<br>` insere uma quebra.";
    expect(cleanModuleContent(md)).toContain("`<br>`");
  });

  it("tabela DENTRO DE CITAÇÃO não é partida em duas", () => {
    // Linha real do curso de 09/07. A detecção era `^\s*\|` e não via o "> |",
    // então punha uma quebra no meio e destruía a tabela.
    const real =
      "> | **Markup** | `(Preço de Venda - Custo) / Custo` <br> `(R$ 45 - R$ 18) / R$ 18 = 1,5 ou 150%` | Sobre o **Custo** |";
    const out = cleanModuleContent(real);
    expect(out.split("\n")).toHaveLength(1);
    expect(out).not.toContain("<br>");
    // O código de linha que o `<br>` separava continua inteiro dos dois lados.
    expect(out).toContain("`(Preço de Venda - Custo) / Custo`");
    expect(out).toContain("`(R$ 45 - R$ 18) / R$ 18 = 1,5 ou 150%`");
  });

  it("o <br> usado como espaçador entre tabelas não estraga nada", () => {
    // Curso de programação, módulo 8: a tag está sozinha na linha, entre duas
    // tabelas. Não é HTML sendo ensinado — é espaçamento.
    const real = "| A | B |\n\n<br/>\n\n| C | D |";
    const out = cleanModuleContent(real);
    expect(out).not.toMatch(/<br/i);
    expect(out).toContain("| A | B |");
    expect(out).toContain("| C | D |");
  });

  it("célula com duas linhas vira lista legível, não texto grudado", () => {
    // Curso de 19/06, módulo 9.
    const real = "| Indicadores | - Redução do TMA.<br>- Custo por Transação.<br>- Taxa de Automação. |";
    const out = cleanModuleContent(real);
    expect(out.split("\n")).toHaveLength(1);
    expect(out).toContain("Redução do TMA");
    expect(out).toContain("Custo por Transação");
    expect(out).not.toMatch(/\.-/); // não gruda o fim de um no começo do outro
  });

  it("texto sem a tag passa intacto", () => {
    const md = "## Título\n\nUm parágrafo normal.\n\n| a | b |\n| - | - |";
    expect(cleanModuleContent(md)).toBe(md);
  });

  it("é idempotente", () => {
    const md = "| Campo | Considere:<br>- Um: R$ 1,00<br>- Dois: R$ 2,00 |";
    const uma = cleanModuleContent(md);
    expect(cleanModuleContent(uma)).toBe(uma);
  });
});
