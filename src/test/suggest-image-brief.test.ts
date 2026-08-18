import { describe, expect, it } from "vitest";
import {
  LIMITE_DESCRICAO,
  limparSugestao,
  promptDeSugestao,
} from "../../supabase/functions/suggest-image-brief/prompt";

// ═══════════════════════════════════════════════════════════════════════════
// Com o campo "Descreva a imagem" em branco, o gerador mandava o TÍTULO direto
// para o modelo de imagem. Título de curso é abstrato — "Monitoramento,
// Informação e Comunicação nos Controles Internos" não diz o que desenhar — e
// modelo de imagem é ruim com abstração. Um modelo de texto faz a tradução:
// título → objetos concretos.
//
// Duas coisas a descrição NÃO pode trazer: regra de enquadramento (é do
// sistema) e pedido de texto na cena (pedir "carimbo de conferido" já custou
// uma capa com letras deformadas).
// ═══════════════════════════════════════════════════════════════════════════

const doModulo = promptDeSugestao({
  escopo: "module",
  titulo: "Monitoramento, Informação e Comunicação nos Controles Internos",
  cursoTitulo: "Gestão de Controles Internos",
});
const daCapa = promptDeSugestao({
  escopo: "cover",
  titulo: "Gestão de Controles Internos na Administração Pública Municipal",
});

describe("promptDeSugestao", () => {
  it("pede objetos concretos, que é o que falta no título", () => {
    expect(doModulo).toMatch(/OBJETOS CONCRETOS/);
    expect(doModulo).toMatch(/painel, gráfico, pasta, lupa/);
  });

  it("diz por que a abstração não serve", () => {
    expect(doModulo).toMatch(/não sabe desenhar/i);
  });

  it("proíbe qualquer texto na cena", () => {
    for (const p of [doModulo, daCapa]) {
      expect(p).toMatch(/texto, letra, número, rótulo, placa, carimbo ou logotipo/);
      expect(p).toMatch(/função seja carregar escrita/);
    }
  });

  it("proíbe pessoas, rostos e mãos", () => {
    expect(daCapa).toMatch(/Pessoas, rostos, mãos/);
  });

  it("proíbe falar de enquadramento — isso é regra do sistema", () => {
    // Se a sugestão descrevesse moldura ou margem, voltaríamos ao defeito da
    // capa com listras verticais penduradas.
    expect(daCapa).toMatch(/enquadramento, moldura, margem, proporção, corte/);
  });

  it("pede resposta crua, sem preâmbulo nem lista", () => {
    expect(daCapa).toMatch(/APENAS com a descrição/);
    expect(daCapa).toMatch(/Sem título, sem aspas, sem lista/);
  });

  it("cabe no campo do app", () => {
    expect(daCapa).toContain(String(LIMITE_DESCRICAO));
    expect(LIMITE_DESCRICAO).toBeLessThan(500);
  });

  it("a capa é pedida pelo curso; o módulo, pelo módulo com o curso de contexto", () => {
    expect(daCapa).toMatch(/a CAPA do curso "Gestão de Controles Internos na Administração/);
    expect(doModulo).toMatch(/o módulo "Monitoramento[^"]*" do curso "Gestão de Controles Internos"/);
  });

  it("módulo sem curso não deixa contexto pela metade", () => {
    const p = promptDeSugestao({ escopo: "module", titulo: "Riscos", cursoTitulo: null });
    expect(p).toMatch(/o módulo "Riscos"/);
    expect(p).not.toMatch(/do curso ""/);
  });
});

describe("limparSugestao", () => {
  it("texto limpo passa intacto", () => {
    const t = "Pastas empilhadas ao lado de uma lupa sobre um gráfico de barras.";
    expect(limparSugestao(t)).toBe(t);
  });

  it("tira o preâmbulo conversado", () => {
    expect(limparSugestao("Claro! Aqui está: Uma mesa com pastas."))
      .toBe("Uma mesa com pastas.");
    expect(limparSugestao("Descrição: Uma mesa com pastas."))
      .toBe("Uma mesa com pastas.");
  });

  it("tira aspas em volta", () => {
    expect(limparSugestao('"Uma mesa com pastas."')).toBe("Uma mesa com pastas.");
    expect(limparSugestao("“Uma mesa com pastas.”")).toBe("Uma mesa com pastas.");
  });

  it("tira cerca de código", () => {
    expect(limparSugestao("```\nUma mesa com pastas.\n```")).toBe("Uma mesa com pastas.");
  });

  it("achata tópicos em texto corrido — o campo é caixa de texto simples", () => {
    expect(limparSugestao("- Pastas empilhadas.\n- Uma lupa.\n- Tons azuis."))
      .toBe("Pastas empilhadas. Uma lupa. Tons azuis.");
    expect(limparSugestao("1. Pastas.\n2. Lupa.")).toBe("Pastas. Lupa.");
  });

  it("normaliza espaços e quebras", () => {
    expect(limparSugestao("Uma   mesa\n\ncom pastas.")).toBe("Uma mesa com pastas.");
  });

  it("respeita o limite do campo", () => {
    const longo = "Uma mesa com pastas de processo empilhadas. ".repeat(30);
    expect(limparSugestao(longo).length).toBeLessThanOrEqual(LIMITE_DESCRICAO);
  });

  it("corta na frase inteira, nunca no meio de uma palavra", () => {
    const longo = "Uma mesa com pastas de processo empilhadas. ".repeat(30);
    const r = limparSugestao(longo);
    expect(r.endsWith(".")).toBe(true);
    expect(r).not.toMatch(/\s\S{1,3}$/);
  });

  it("entrada vazia devolve vazio, para quem chama recusar", () => {
    expect(limparSugestao("")).toBe("");
    expect(limparSugestao("   \n  ")).toBe("");
  });

  it("não come um travessão que faz parte da frase", () => {
    // O corte de tópico só vale no COMEÇO da linha.
    expect(limparSugestao("Pastas — empilhadas — sobre a mesa."))
      .toBe("Pastas — empilhadas — sobre a mesa.");
  });
});
