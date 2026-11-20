import { describe, expect, it } from "vitest";
import { promptDaImagemDoModulo } from "../../supabase/functions/_shared/course-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// O PROMPT PEDIA UM DIAGRAMA E PROIBIA RÓTULOS NA MESMA RESPIRAÇÃO
//
// MEDIDO no PPTX do curso de 20/11/2026, abrindo as imagens do deck:
//
//   slide  4 ... EFFECTYNESS · EFICIACY · ELUINUMY · CONTINIUOUS · EPRFORMENCHT
//   slide 27 ... ANÁLISIE PRELIMINAR · TÉNICAS · RECUSIÃO DE DOCUMENAL ·
//                ENTREVITAS · AVALAÇÃO DE RISCOS · POTENIAIS POTENIAIS
//   slide 45 ... HYOPTHESIES, duas vezes
//
// Quatro de quatro imagens cheias de tipografia, com a proibição JÁ ESCRITA no
// prompt. Não era desobediência: três linhas acima ele pedia "a process
// diagram, decision map, relationship map, ANNOTATED conceptual scene". Um
// diagrama de processo É um arranjo de caixas rotuladas.
// ═══════════════════════════════════════════════════════════════════════════

const BRIEF = {
  generation_prompt: "Uma cena que evoque a análise preliminar de uma auditoria",
  purpose: "ilustrar a fase de diagnóstico",
  concept: "análise preliminar",
  alt_text: "",
} as any;

const prompt = () => promptDaImagemDoModulo({
  courseTitle: "Auditoria Operacional",
  moduleTitle: "Análise Preliminar",
  mediaBrief: BRIEF,
});

describe("o prompt não pede mais o que ele proíbe", () => {
  it("NÃO pede diagrama, mapa de decisão nem cena anotada", () => {
    // A verificação é sobre o PEDIDO, não sobre a palavra: a proibição nova
    // cita "flowchart" e "decision tree" justamente para proibi-los. Testar a
    // simples presença da palavra reprovaria o conserto — foi o que meu
    // primeiro teste fez.
    const pedido = prompt().split("THE IMAGE CARRIES NO WORDS")[0].toLowerCase();
    for (const antigo of [
      "process diagram", "decision map", "relationship map",
      "annotated", "flowchart", "visual comparison",
    ]) {
      expect(pedido, `o pedido ainda traz "${antigo}"`).not.toContain(antigo);
    }
  });

  it("a proibição fica DEPOIS do pedido, e cita o que proíbe", () => {
    const [pedido, proibicao] = prompt().split("THE IMAGE CARRIES NO WORDS");
    expect(pedido.length).toBeGreaterThan(50);
    expect(proibicao).toContain("flowchart");
    expect(proibicao).toContain("decision tree");
  });

  it("proíbe explicitamente desenhar diagrama", () => {
    expect(prompt()).toMatch(/Do NOT draw a diagram/);
    expect(prompt()).toContain("labelled boxes");
  });

  it("diz POR QUE: o diagrama é desenhado como forma nativa do slide", () => {
    // Sem a razão, a proibição parece arbitrária e o modelo a contorna.
    expect(prompt()).toContain("native slide shapes");
  });

  it("mantém a proibição de tipografia, que já existia", () => {
    const p = prompt();
    expect(p).toContain("NO WORDS");
    expect(p).toContain("No typography, letters, numerals");
    expect(p).toMatch(/must remain blank/);
  });

  it("pede o que imagem faz bem: cena, metáfora, composição", () => {
    const p = prompt().toLowerCase();
    expect(p).toContain("conceptual scene");
    expect(p).toContain("visual metaphor");
  });

  it("ainda carrega o conceito e o contexto do módulo", () => {
    const p = prompt();
    expect(p).toContain("análise preliminar");
    expect(p).toContain("Auditoria Operacional");
    expect(p).toContain("Análise Preliminar");
    expect(p).toContain(BRIEF.generation_prompt);
  });

  it("continua pedindo 16:9 — a proporção do slide", () => {
    expect(prompt()).toContain("16:9");
  });

  it("não quebra com brief vazio", () => {
    const p = promptDaImagemDoModulo({
      courseTitle: "X", moduleTitle: "Y",
      mediaBrief: { generation_prompt: "", purpose: "", concept: "", alt_text: "" } as any,
    });
    expect(p).toContain("NO WORDS");
  });
});
