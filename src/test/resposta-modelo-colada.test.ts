import { describe, expect, it, vi } from "vitest";
import { restaurarQuebrasDePasso } from "../../supabase/functions/_shared/course-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// O MURO DA PÁGINA 47
//
// Curso de estoque, apostila de 23/08. A resposta-modelo do módulo 3 saiu num
// bloco só, com as palavras coladas em cada troca de passo. Os critérios de
// correção logo acima saíam certinhos, um por linha — mas eles vêm de um array,
// e sample_answer é uma string. O modelo escreveu um cálculo passo a passo
// dentro de um campo que trata como prosa, sem uma quebra de linha sequer.
//
// O texto abaixo é o que a apostila imprimiu, copiado do PDF.
// ═══════════════════════════════════════════════════════════════════════════

const MURO =
  "Para o 'Macarrão Instantâneo':Cálculo do LEC:LEC = √((2 * Demanda Anual * " +
  "Custo de Pedido) / Custo de Manutenção por Unidade Anual)LEC = √((2 * 3600 * 50) / 2)" +
  "LEC = √((360000) / 2)LEC = √(180000)LEC ≈ 424 unidadesO LEC de aproximadamente 424 " +
  "unidades indica que o Sr. João deve comprar essa quantidade por pedido para minimizar " +
  "o custo total de estoque.Cálculo do Ponto de Pedido:Ponto de Pedido = (Demanda Média " +
  "Diária × Lead Time) + Estoque de SegurançaPonto de Pedido = (10 unidades/dia × 3 dias) " +
  "+ 30 unidadesPonto de Pedido = 30 unidades + 30 unidadesPonto de Pedido = 60 unidades";

function semRuido<T>(fn: () => T): T {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    return fn();
  } finally {
    log.mockRestore();
  }
}

describe("restaurarQuebrasDePasso — o caso relatado", () => {
  const saida = semRuido(() => restaurarQuebrasDePasso(MURO));
  const linhas = saida.split("\n");

  it("desfaz todas as colagens que a apostila mostrou", () => {
    for (const colada of [
      "unidadesPonto",
      "SegurançaPonto",
      "unidadesO",
      "(180000)LEC",
      "Instantâneo':Cálculo",
      "LEC:LEC",
      "Anual)LEC",
      "estoque.Cálculo",
    ]) {
      expect(saida).not.toContain(colada);
    }
  });

  it("cada passo do cálculo vira uma linha", () => {
    expect(linhas).toContain("LEC = √(180000)");
    expect(linhas).toContain("LEC ≈ 424 unidades");
    expect(linhas).toContain("Ponto de Pedido = 60 unidades");
    expect(linhas.length).toBeGreaterThanOrEqual(10);
  });

  it("não perde nem inventa uma letra — só acrescenta quebras", () => {
    expect(saida.replace(/\n/g, "")).toBe(MURO);
  });

  it("nenhuma linha termina colada na seguinte", () => {
    for (const l of linhas) {
      expect(l).not.toMatch(/[a-zà-ÿ0-9)][A-ZÀ-Þ]/);
    }
  });
});

describe("restaurarQuebrasDePasso — o que NÃO deve tocar", () => {
  it("texto que já tem quebra fica intacto", () => {
    const bom = "Cálculo do LEC:\nLEC = √(180000)\nLEC ≈ 424 unidades\n\nO resultado indica " +
      "que o comprador deve pedir essa quantidade para minimizar o custo total do estoque.";
    expect(restaurarQuebrasDePasso(bom)).toBe(bom);
  });

  it("texto curto fica intacto — um muro curto não atrapalha", () => {
    const curto = "LEC = √(180000)LEC ≈ 424 unidades";
    expect(restaurarQuebrasDePasso(curto)).toBe(curto);
  });

  it("prosa longa e bem escrita fica intacta", () => {
    const prosa =
      "O aluno deve identificar os itens de maior valor acumulado e concentrar neles o " +
      "controle de estoque. A justificativa precisa citar o princípio de Pareto e " +
      "relacionar a classificação ao custo de manutenção. Espera-se também que ele " +
      "reconheça que a curva muda ao longo do ano e precisa ser refeita periodicamente.";
    expect(restaurarQuebrasDePasso(prosa)).toBe(prosa);
  });

  it("nome CamelCase não é partido no meio", () => {
    // Este é o único falso positivo que as regras de adjacência não excluem
    // sozinhas: em português, palavra colada em maiúscula é sempre defeito,
    // menos quando é nome próprio composto.
    const t =
      "Monte a planilha no PowerPoint ou no WhatsApp Business para acompanhar o giro " +
      "do estoque durante o mês e registre o resultado obtido em cada semana do período " +
      "analisado, comparando com a meta definida no início.";
    expect(semRuido(() => restaurarQuebrasDePasso(t))).toBe(t);
  });

  it("CamelCase sobrevive mesmo cercado de números do cálculo", () => {
    // O marcador de proteção não pode ser confundido com os números do texto:
    // uma versão anterior guardava os nomes atrás de um índice cru e devolvia
    // "PowerPoint" no lugar de "1200".
    const t =
      "Exporte do PowerPoint os dados:Demanda = 1200 unidades por ano e o custo unitário " +
      "de manutenção igual a 3 reais, mantendo o mesmo período de apuração usado antes " +
      "para não distorcer a comparação entre os itens.";
    const saida = semRuido(() => restaurarQuebrasDePasso(t));
    expect(saida).toContain("PowerPoint");
    expect(saida).toContain("1200 unidades");
    expect(saida.replace(/\n/g, "")).toBe(t);
  });

  it("vazio e nulo não quebram", () => {
    expect(restaurarQuebrasDePasso("")).toBe("");
    expect(restaurarQuebrasDePasso(null as unknown as string)).toBe("");
    expect(restaurarQuebrasDePasso(undefined as unknown as string)).toBe("");
  });

  it("é idempotente — a segunda passagem não faz nada", () => {
    const uma = semRuido(() => restaurarQuebrasDePasso(MURO));
    expect(semRuido(() => restaurarQuebrasDePasso(uma))).toBe(uma);
  });
});
