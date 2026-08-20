import { describe, expect, it } from "vitest";
import { separarListaEmbutida } from "../../supabase/functions/_shared/markdown";

// ═══════════════════════════════════════════════════════════════════════════
// A página 55 do curso de orçamento: um bloco corrido de vinte linhas onde
// deveria haver três ações numeradas. O modelo devolveu a enumeração dentro da
// mesma linha, sem quebra e sem espaço antes do marcador, e o exportador
// desenhou o que recebeu.
//
// O perigo da correção é maior que o defeito: quebrar em todo "n." estragaria
// "Lei nº 4.320/64", "R$ 3.500,00" e "art. 5º". Por isso a regra exige que os
// marcadores formem a sequência 1, 2, 3… começando em 1. Metade destes testes
// existe para provar que texto correto passa intacto.
// ═══════════════════════════════════════════════════════════════════════════

describe("separarListaEmbutida — o caso da página 55", () => {
  const relatado =
    "Plano Simplificado de Fortalecimento da Prestação de Contas para Vila Nova da " +
    "Esperança:1. Ação: Implementação do Portal da Transparência. O município deve " +
    "assegurar a atualização diária, legitimando as ações governamentais.2. Ação: " +
    "Capacitação Contínua de Servidores. Oferecer treinamentos regulares, protegendo " +
    "o patrimônio público contra irregularidades.3. Ação: Realização de Audiências " +
    "Públicas Semestrais. Promover audiências abertas à participação cidadã.";

  it("quebra as três ações em linhas próprias", () => {
    const saida = separarListaEmbutida(relatado);
    const itens = saida.split("\n").filter((l) => /^\d+\.\s/.test(l.trim()));
    expect(itens).toHaveLength(3);
    expect(itens[0]).toMatch(/^1\. Ação: Implementação/);
    expect(itens[1]).toMatch(/^2\. Ação: Capacitação/);
    expect(itens[2]).toMatch(/^3\. Ação: Realização/);
  });

  it("não gruda mais o marcador no fim da frase anterior", () => {
    expect(separarListaEmbutida(relatado)).not.toMatch(/[a-zà-ú][.:]\d\.\s/i);
  });

  it("a pontuação que abria a lista fica com a frase que a anuncia", () => {
    expect(separarListaEmbutida(relatado)).toMatch(/Esperança:\n/);
  });

  it("não perde nenhuma palavra do texto", () => {
    const palavras = (t: string) => t.replace(/\s+/g, " ").match(/[\p{L}\p{N}]+/gu) ?? [];
    expect(palavras(separarListaEmbutida(relatado))).toEqual(palavras(relatado));
  });
});

describe("separarListaEmbutida — texto correto passa intacto", () => {
  it("não quebra referência de lei nem valor em reais", () => {
    for (const t of [
      "A Lei nº 4.320/64 é a base. O empenho de R$ 3.500,00 foi anulado.",
      "Conforme o art. 5. A regra vale para todos.",
      "O limite subiu em 2024. 300 servidores foram capacitados. 45 já concluíram.",
    ]) {
      expect(separarListaEmbutida(t), t).toBe(t);
    }
  });

  it("não quebra quando a numeração não começa em 1", () => {
    const t = "Veja os casos:2. Segundo caso do manual.3. Terceiro caso do manual.";
    expect(separarListaEmbutida(t)).toBe(t);
  });

  it("não quebra quando a sequência pula um número", () => {
    const t = "Etapas:1. Primeira etapa.3. Terceira etapa.4. Quarta etapa.";
    expect(separarListaEmbutida(t)).toBe(t);
  });

  it("um marcador solto não é lista", () => {
    const t = "O procedimento está descrito assim:1. Faça o empenho antes da liquidação.";
    expect(separarListaEmbutida(t)).toBe(t);
  });

  it("lista que já veio em linhas separadas não é tocada", () => {
    const t = "Etapas:\n\n1. Previsão\n\n2. Lançamento\n\n3. Arrecadação";
    expect(separarListaEmbutida(t)).toBe(t);
  });

  it("texto vazio e sem número passam intactos", () => {
    expect(separarListaEmbutida("")).toBe("");
    expect(separarListaEmbutida("Nenhum número aqui.")).toBe("Nenhum número aqui.");
  });
});

describe("separarListaEmbutida — variações que ainda são lista", () => {
  it("aceita ponto e vírgula como separador", () => {
    const t = "Fases:1. Coleta de documentos;2. Conferência dos saldos;3. Envio ao Tribunal.";
    const itens = separarListaEmbutida(t).split("\n").filter((l) => /^\d+\.\s/.test(l.trim()));
    expect(itens).toHaveLength(3);
  });

  it("aceita lista de dois itens", () => {
    const t = "São dois caminhos:1. Empenho ordinário do valor total.2. Empenho estimativo.";
    const itens = separarListaEmbutida(t).split("\n").filter((l) => /^\d+\.\s/.test(l.trim()));
    expect(itens).toHaveLength(2);
  });

  it("é idempotente — rodar duas vezes dá o mesmo resultado", () => {
    const t = "Fases:1. Coleta dos dados.2. Conferência dos saldos.3. Envio ao Tribunal.";
    const uma = separarListaEmbutida(t);
    expect(separarListaEmbutida(uma)).toBe(uma);
  });
});
