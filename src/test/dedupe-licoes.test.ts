import { describe, expect, it } from "vitest";
import {
  LIMIAR,
  MAXIMO_POR_MODULO,
  removerRepeticoes,
  semelhanca,
  type ModuloTexto,
} from "../../supabase/functions/_shared/dedupe-licoes";

// ═══════════════════════════════════════════════════════════════════════════
// "O trio PPA/LDO/LOA é explicado por extenso umas quatro vezes entre os
// módulos 1 e 2, quase com as mesmas frases." Confirmado no curso: a frase
// "O PPA estabelece as diretrizes, objetivos e metas…" aparece quase idêntica
// nas páginas 7, 9 e 20.
//
// Acontece porque cada módulo é gerado por uma invocação independente e nenhum
// sabe o que os outros escreveram.
//
// Apagar parágrafo é destrutivo: um falso positivo custa conteúdo do produto.
// Por isso a maior parte destes testes não verifica se ele REMOVE — verifica se
// ele DEIXA EM PAZ o que não deve tocar.
// ═══════════════════════════════════════════════════════════════════════════

const PPA_M1 =
  "O Plano Plurianual estabelece as diretrizes, os objetivos e as metas da " +
  "administração pública municipal para as despesas de capital e para as " +
  "decorrentes delas, abrangendo um período de quatro anos e orientando toda a " +
  "elaboração orçamentária subsequente do município.";

const PPA_M2_QUASE_IGUAL =
  "O Plano Plurianual estabelece as diretrizes, os objetivos e as metas da " +
  "administração pública municipal para as despesas de capital e para aquelas " +
  "decorrentes delas, cobrindo um período de quatro anos e orientando toda a " +
  "elaboração orçamentária seguinte do município.";

const OUTRO_ASSUNTO =
  "A Receita Corrente Líquida é apurada somando as receitas correntes dos doze " +
  "meses anteriores e deduzindo as transferências constitucionais devidas a " +
  "outros entes federativos, servindo de base para os limites de gasto com " +
  "pessoal impostos pela Lei de Responsabilidade Fiscal.";

const mod = (titulo: string, conteudo: string): ModuloTexto => ({ titulo, conteudo });

describe("semelhanca", () => {
  it("reconhece o mesmo parágrafo reescrito com outras palavras de ligação", () => {
    expect(semelhanca(PPA_M1, PPA_M2_QUASE_IGUAL)).toBeGreaterThan(LIMIAR);
  });

  it("não confunde dois parágrafos do mesmo domínio com conteúdo diferente", () => {
    expect(semelhanca(PPA_M1, OUTRO_ASSUNTO)).toBeLessThan(LIMIAR);
  });

  it("texto vazio não gera semelhança", () => {
    expect(semelhanca("", PPA_M1)).toBe(0);
    expect(semelhanca(PPA_M1, "")).toBe(0);
  });
});

describe("o caso relatado", () => {
  const { modulos, remocoes } = removerRepeticoes([
    mod("Instrumentos de Planejamento", `### O PPA\n\n${PPA_M1}\n\n${OUTRO_ASSUNTO}`),
    mod("Marco Legal", `### Fundamento\n\n${PPA_M2_QUASE_IGUAL}`),
  ]);

  it("a repetição do módulo 2 é trocada", () => {
    expect(remocoes).toHaveLength(1);
    expect(remocoes[0].modulo).toBe(1);
    expect(remocoes[0].origem).toBe(0);
  });

  it("o módulo 1, que explicou primeiro, fica intacto", () => {
    expect(modulos[0].conteudo).toContain(PPA_M1);
  });

  it("no lugar entra uma remissão que diz ONDE foi explicado", () => {
    expect(modulos[1].conteudo).toMatch(/Retomando o Módulo 1 — Instrumentos de Planejamento/);
    expect(modulos[1].conteudo).not.toContain(PPA_M2_QUASE_IGUAL);
  });

  it("o parágrafo de outro assunto não é tocado", () => {
    expect(modulos[0].conteudo).toContain(OUTRO_ASSUNTO);
  });
});

describe("o que NÃO pode ser tocado", () => {
  it("títulos, listas, tabelas, citações e imagens passam intactos", () => {
    const estrutura = [
      "## Módulo",
      "### Seção",
      "- item de lista com bastante texto para passar do mínimo de palavras exigido aqui e ali",
      "1. item numerado com bastante texto para passar do mínimo de palavras exigido aqui e ali",
      "| Coluna | Outra | com bastante texto para passar do mínimo de palavras exigido aqui |",
      "> citação com bastante texto para passar do mínimo de palavras exigido aqui e ali também",
      "![alt com bastante texto para passar do mínimo de palavras exigido aqui e ali](u)",
    ].join("\n\n");
    const { modulos, remocoes } = removerRepeticoes([
      mod("A", estrutura),
      mod("B", estrutura),
    ]);
    expect(remocoes).toHaveLength(0);
    expect(modulos[1].conteudo).toBe(estrutura);
  });

  it("parágrafo curto repetido é legítimo — definição, rótulo, transição", () => {
    const curto = "O PPA vigora por quatro anos.";
    const { remocoes } = removerRepeticoes([mod("A", curto), mod("B", curto)]);
    expect(remocoes).toHaveLength(0);
  });

  it("repetição DENTRO do mesmo módulo é recurso didático, não descuido", () => {
    const { remocoes } = removerRepeticoes([
      mod("A", `${PPA_M1}\n\n${PPA_M2_QUASE_IGUAL}`),
    ]);
    expect(remocoes).toHaveLength(0);
  });

  it("nunca remove do primeiro módulo em que o assunto aparece", () => {
    const { remocoes } = removerRepeticoes([
      mod("A", PPA_M1),
      mod("B", PPA_M2_QUASE_IGUAL),
      mod("C", PPA_M2_QUASE_IGUAL),
    ]);
    expect(remocoes.every((r) => r.modulo > 0)).toBe(true);
  });

  it("respeita o teto por módulo — se tudo parece repetido, o problema é outro", () => {
    const muitos = Array.from({ length: 6 }, (_, i) =>
      `${PPA_M1} Variação número ${i} do mesmo parágrafo repetido.`).join("\n\n");
    const { remocoes } = removerRepeticoes([mod("A", muitos), mod("B", muitos)]);
    expect(remocoes.filter((r) => r.modulo === 1).length).toBeLessThanOrEqual(MAXIMO_POR_MODULO);
  });
});

describe("bordas", () => {
  it("curso de um módulo só não tem com o que comparar", () => {
    const { remocoes } = removerRepeticoes([mod("A", PPA_M1)]);
    expect(remocoes).toHaveLength(0);
  });

  it("lista vazia e conteúdo vazio não quebram", () => {
    expect(removerRepeticoes([]).modulos).toEqual([]);
    expect(removerRepeticoes([mod("A", "")]).modulos[0].conteudo).toBe("");
  });

  it("preserva o título do módulo e as quebras de linha do texto", () => {
    const texto = `Primeiro.\n\n${PPA_M1}\n\nÚltimo.`;
    const { modulos } = removerRepeticoes([mod("A", texto), mod("B", texto)]);
    expect(modulos[1].titulo).toBe("B");
    expect(modulos[1].conteudo.split("\n")).toHaveLength(texto.split("\n").length);
  });

  it("registra o que trocou, para a limpeza ser auditável", () => {
    const { remocoes } = removerRepeticoes([mod("A", PPA_M1), mod("B", PPA_M2_QUASE_IGUAL)]);
    expect(remocoes[0].semelhanca).toBeGreaterThan(LIMIAR);
    expect(remocoes[0].trecho.length).toBeGreaterThan(10);
  });
});
