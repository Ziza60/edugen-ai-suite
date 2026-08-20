import { describe, expect, it } from "vitest";
import { altDaImagem } from "../../supabase/functions/generate-module-image/image-prompt";

// ═══════════════════════════════════════════════════════════════════════════
// O alt_text gravado era `Imagem IA: ${brief}` — o PROMPT inteiro. O export-pdf
// o imprimia como legenda, e a página 21 do curso de orçamento saiu com cinco
// linhas de instrução ao gerador, terminando em "A paleta de cores foca em azul
// marinho, dourado e tons de madeira". Metadado interno no documento que o
// comprador recebe.
//
// Alt-text responde a uma pergunta só: o que a imagem mostra. Nem o prefixo
// "Imagem IA:" entra — o leitor de tela já anuncia que aquilo é uma imagem, e a
// procedência não ajuda quem não está vendo.
// ═══════════════════════════════════════════════════════════════════════════

const BRIEF_RELATADO =
  "Uma balança de pratos metálica, um martelo de madeira, uma lupa de vidro e três " +
  "engrenagens douradas que se encaixam. A balança ocupa o centro da cena sobre uma " +
  "mesa de madeira escura. À esquerda, a lupa repousa sobre uma pasta lisa. À direita, " +
  "as engrenagens estão dispostas próximas ao martelo. Ao fundo, um painel exibe um " +
  "fluxograma circular feito de setas sólidas. A paleta de cores foca em azul marinho, " +
  "dourado e tons de madeira.";

describe("altDaImagem — o caso relatado", () => {
  const alt = altDaImagem(BRIEF_RELATADO, "O Marco Legal e os Princípios da Gestão");

  it("não carrega mais o prefixo de procedência", () => {
    expect(alt).not.toMatch(/Imagem IA/i);
  });

  it("descarta a instrução de paleta, que é conversa com o gerador", () => {
    expect(alt).not.toMatch(/paleta/i);
    expect(alt).not.toMatch(/azul marinho/i);
  });

  it("mantém a descrição da cena", () => {
    expect(alt).toMatch(/balança/i);
  });

  it("cabe numa legenda, em vez de ocupar cinco linhas", () => {
    expect(alt.length).toBeLessThanOrEqual(185);
    expect(BRIEF_RELATADO.length).toBeGreaterThan(400);
  });

  it("termina inteiro — em ponto final ou em reticência que avisa o corte", () => {
    expect(alt).toMatch(/(\.|…)$/);
  });
});

describe("altDaImagem — quando não há descrição aproveitável", () => {
  it("sem brief, cai no título do módulo", () => {
    expect(altDaImagem("", "Execução Orçamentária")).toBe("Execução Orçamentária");
    expect(altDaImagem(null, "Execução Orçamentária")).toBe("Execução Orçamentária");
    expect(altDaImagem(undefined, "Execução Orçamentária")).toBe("Execução Orçamentária");
  });

  it("brief que é SÓ instrução de estilo cai no título", () => {
    expect(altDaImagem("Estilo fotorrealista, alta qualidade, sem texto.", "Controle Interno"))
      .toBe("Controle Interno");
  });

  it("brief e título vazios devolvem vazio, sem quebrar", () => {
    expect(altDaImagem("", "")).toBe("");
  });
});

describe("altDaImagem — descrições curtas passam inteiras", () => {
  it("uma frase curta não é cortada", () => {
    const t = "Uma prefeitura vista de fora, com a bandeira do município.";
    expect(altDaImagem(t, "Módulo 1")).toBe(t);
  });

  it("primeira frase entra mesmo quando sozinha já é longa", () => {
    const longa = `Uma mesa de reunião ${"muito ".repeat(40)}comprida.`;
    const alt = altDaImagem(longa, "Módulo 1");
    expect(alt).toMatch(/^Uma mesa de reunião/);
    expect(alt.length).toBeLessThanOrEqual(185);
  });

  it("não deixa vírgula solta antes da reticência", () => {
    const longa = `Uma cena com ${"itens, ".repeat(40)}fim.`;
    expect(altDaImagem(longa, "Módulo 1")).not.toMatch(/[,;:]…$/);
  });
});
