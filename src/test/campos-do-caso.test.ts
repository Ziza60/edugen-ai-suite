import { describe, expect, it } from "vitest";
import { inspectCourse } from "../../supabase/functions/_shared/quality-gate";

// ═══════════════════════════════════════════════════════════════════════════
// A RÉGUA ÚNICA PARA CAMPOS QUE NÃO TÊM O MESMO TAMANHO
//
// Curso "Formação de Preço de Venda no Pequeno Comércio", laudo de 24/08 06:26.
// Um bloqueador, três achados — e os três falsos:
//
//     M1 — Papel: "Consultor Financeiro" (2 palavras)
//     M5 — Papel: "Consultor de Precificação" (3 palavras)
//     M2 — Solução: "Dados Fornecidos:" (2 palavras)
//
// A verificação exigia quatro palavras de QUALQUER campo. Um Papel é um cargo;
// uma Solução é um raciocínio. Medido em 193 campos de cinco cursos reais, um
// Papel desce legitimamente a duas palavras, enquanto Contexto e Resultado
// nunca ficaram abaixo de quarenta.
//
// O terceiro achado tinha outra causa: o campo é um BLOCO, e a verificação lia
// só a primeira linha. "Dados Fornecidos:" era a abertura de uma solução
// inteira que continuava logo abaixo.
// ═══════════════════════════════════════════════════════════════════════════

function laudo(...markdowns: string[]) {
  const r = inspectCourse({
    course_title: "Formação de Preço de Venda no Pequeno Comércio",
    modules: markdowns.map((markdown, i) => ({
      module_number: i + 1,
      title: `Módulo ${i + 1}`,
      markdown,
    })),
  });
  return r.checks.find((c) => c.id === "texto.campos_completos")!;
}

describe("campos de estudo de caso", () => {
  it("um Papel de duas palavras é um cargo completo", () => {
    const c = laudo("**Papel:** Consultor Financeiro");
    expect(c.passed, `evidências: ${JSON.stringify(c.evidence)}`).toBe(true);
  });

  it("um Papel de três palavras também", () => {
    expect(laudo("**Papel:** Consultor de Precificação").passed).toBe(true);
  });

  it("a Solução é lida como bloco, não como primeira linha", () => {
    // O texto do modelo pode trazer quebras de linha dentro do campo. Foi assim
    // que uma solução inteira apareceu no laudo como "duas palavras".
    const md = `**Solução:** Dados Fornecidos:
Preço de Venda Unitário (PVU) do pão francês: R$ 0,80. Custos Variáveis
Unitários (CVU): R$ 0,35. Volume mensal: 15.000 unidades.`;
    const c = laudo(md);
    expect(c.passed, `evidências: ${JSON.stringify(c.evidence)}`).toBe(true);
  });

  it("campo vazio continua bloqueando", () => {
    const c = laudo("**Contexto:**");
    expect(c.passed).toBe(false);
    expect(c.severity).toBe("blocker");
    expect(c.evidence.join(" ")).toContain("vazio");
  });

  it("Contexto amputado continua bloqueando", () => {
    const c = laudo("**Contexto:** A padaria de Ana e");
    expect(c.passed).toBe(false);
    expect(c.evidence.join(" ")).toMatch(/piso 10/);
  });

  it("campo cortado numa abreviação continua bloqueando", () => {
    const c = laudo("**Resultado:** O cálculo foi conferido pelo Sr.");
    expect(c.passed).toBe(false);
    expect(c.evidence.join(" ")).toContain("abreviação");
  });

  it("o bloco para no campo seguinte, não engole o vizinho", () => {
    // Sem esse limite, um Papel curto seria salvo pelo Contexto que vem
    // depois, e o campo vazio deixaria de ser visto.
    const md = `**Papel:** Consultor

**Contexto:** A Doceria Sabor de Infância vende bolos artesanais sob encomenda
e precisa revisar o preço de cada linha de produto antes da alta temporada.`;
    const c = laudo(md);
    expect(c.passed).toBe(true);
  });

  it("o bloco para na régua horizontal e no título", () => {
    const md = `**Desafio:** Calcular o preço

---

## Outra seção com muitas palavras aqui para não salvar o desafio de cima`;
    const c = laudo(md);
    expect(c.passed).toBe(false);
    expect(c.evidence.join(" ")).toMatch(/Desafio/);
  });

  it("o piso da Solução vem da medição, não da metade do contrato", () => {
    // Metade do que o prompt pede daria 15, e há Solução completa de 12
    // palavras em curso real. O piso fica abaixo do menor valor observado.
    const c = laudo("**Solução:** O custo unitário é R$ 12,20 e a margem cobre os fixos.");
    expect(c.passed, `evidências: ${JSON.stringify(c.evidence)}`).toBe(true);
  });

  it("o curso real de 24/08 passaria inteiro", () => {
    // Os três campos do laudo, juntos, exatamente como saíram.
    const c = laudo(
      "**Papel:** Consultor Financeiro",
      `**Solução:** Dados Fornecidos:
Preço de Venda Unitário: R$ 0,80. Custos Variáveis Unitários: R$ 0,35.`,
      "**Papel:** Consultor de Precificação",
    );
    expect(c.passed, `evidências: ${JSON.stringify(c.evidence)}`).toBe(true);
  });
});
