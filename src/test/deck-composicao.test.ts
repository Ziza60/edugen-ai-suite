import { describe, expect, it } from "vitest";
import {
  ALTURA_MAX_DA_LINHA, blocoCentrado, citacaoNoTamanho, tituloCabeNoCabecalho,
} from "../../supabase/functions/export-pptx-v7/render.ts";
import {
  frases, notaDaAgenda, notaDaCapa, notaDaDivisoria, notaDoEncerramento,
} from "../../supabase/functions/export-pptx-v7/notas-estruturais.ts";
import { rotuloDoNucleo } from "../../supabase/functions/export-pptx-v7/layout-fit.ts";

// ═══════════════════════════════════════════════════════════════════════════
// O QUE FOI MEDIDO NO DECK DE 20/11/2026
//
// 67 slides exportados, convertidos para PDF e OLHADOS, um a um nos casos
// suspeitos. Os números abaixo vêm dessa inspeção, não de estimativa.
//
//   citação ....... slide 18: 184 chars a 28pt, coube
//                   slide 27: 329 chars a 28pt, oito linhas sangrando, e a
//                   régua dourada riscando a palavra "resultados"
//   título ........ 37 de 137 passam de 42 chars; no slide 33 a segunda linha
//                   caiu em cima da régua, que está em HEADER_H+0.05 = 1.40
//   sobrancelha ... o nome do módulo repetido 55 vezes no deck, 8 a 12 por
//                   módulo
//   vazios ........ agenda terminando em 4.86 com rodapé em 7.12 — 2,26 pol
//                   de nada; bullets com linha de 1,3 pol para 4 itens
//   notas ......... 17 dos 67 slides sem nota: capa, agenda, as seis
//                   divisórias e o encerramento
// ═══════════════════════════════════════════════════════════════════════════

describe("citação: o teto que o slide 27 mostrou faltar", () => {
  it("o caso que coube passa intacto", () => {
    const curta = "Considerar o planejamento da auditoria como mera burocracia " +
      "compromete sua qualidade, relevância e utilidade.";
    expect(curta.length).toBeLessThan(220);
    expect(citacaoNoTamanho(curta)).toBe(curta);
  });

  it("NUNCA corta no meio de uma palavra", () => {
    // A primeira versão deste conserto fazia `slice(0, 220)` cru e o deck saiu
    // renderizado com "...escopo mal delimitado e, conse". O teste que eu tinha
    // escrito checava o comprimento e a última palavra contra uma lista de
    // preposições — "conse" não estava nela, e passou. Só vi RENDERIZANDO.
    const longa = "Iniciar a fase de planejamento da auditoria operacional sem uma " +
      "Análise Preliminar consistente é um erro crítico. Este equívoco pode levar " +
      "à definição de objetivos de auditoria inadequados, escopo mal delimitado e, " +
      "consequentemente, à execução de um trabalho que não aborda os problemas reais.";
    const c = citacaoNoTamanho(longa);
    expect(c).not.toContain("conse ");
    // O corte só é válido se o que sobrou é prefixo do original terminando
    // onde o original tem espaço, pontuação ou fim.
    expect(longa.startsWith(c)).toBe(true);
    const depois = longa.slice(c.length, c.length + 1);
    expect([" ", "", ",", "."], `cortou colado em "${depois}"`).toContain(depois);
  });

  it("prefere fechar numa FRASE inteira quando há uma no meio do orçamento", () => {
    const longa = "Iniciar a fase de planejamento da auditoria operacional sem uma " +
      "Análise Preliminar consistente é um erro crítico. Este equívoco pode levar " +
      "à definição de objetivos de auditoria inadequados, escopo mal delimitado e, " +
      "consequentemente, à execução de um trabalho que não aborda os problemas reais.";
    const c = citacaoNoTamanho(longa);
    expect(c.endsWith(".")).toBe(true);
    expect(c).toContain("é um erro crítico");
    // Curta e inteira vence longa e interrompida.
    expect(c.length).toBeLessThan(160);
  });

  it("sem ponto final no orçamento, corta num pensamento e sem vírgula pendurada", () => {
    const semPonto = "A matriz de planejamento relaciona objetivos, questões, " +
      "informações requeridas, fontes de informação, métodos de coleta, métodos de " +
      "análise e o detalhamento das limitações do trabalho da equipe de auditoria";
    const c = citacaoNoTamanho(semPonto);
    expect(c.length).toBeLessThanOrEqual(220);
    expect(c).not.toMatch(/[,;:]\s*$/);
    expect(semPonto.startsWith(c)).toBe(true);
  });

  it("O CASO QUE ESTOUROU é cortado", () => {
    const longa = "Iniciar a fase de planejamento da auditoria operacional sem uma " +
      "Análise Preliminar consistente é um erro crítico. Este equívoco pode levar " +
      "à definição de objetivos de auditoria inadequados, escopo mal delimitado e, " +
      "consequentemente, à execução de um trabalho que não aborda os problemas reais " +
      "ou não gera os resultados esperados.";
    expect(longa.length).toBe(329);
    const cortada = citacaoNoTamanho(longa);
    expect(cortada.length).toBeLessThanOrEqual(220);
    expect(cortada.length).toBeGreaterThan(80);
  });

  it("o corte cai num pensamento inteiro, não no meio da palavra", () => {
    const longa = "A".repeat(100) + ". Uma segunda frase que vai muito além do teto " +
      "e precisa ser cortada em algum ponto que faça sentido para quem lê em voz alta " +
      "numa apresentação diante de uma plateia técnica exigente.";
    const c = citacaoNoTamanho(longa);
    expect(c).not.toMatch(/\s(de|da|do|e|ou|para|com|que|em|a|o)$/i);
  });

  it("vazio e nulo não quebram", () => {
    expect(citacaoNoTamanho("")).toBe("");
    expect(citacaoNoTamanho(undefined as any)).toBe("");
  });
});

describe("título: a segunda linha tem de caber acima da régua", () => {
  // Caixa do título com sobrancelha: y=0.66, h=0.72 → termina em 1.38.
  // A régua está em 1.40. Duas linhas a Npt ocupam 2 × N × 1,2 ÷ 72 polegadas.
  const duasLinhasPol = (pt: number) => (2 * pt * 1.2) / 72;
  const ALTURA_DA_CAIXA = 0.72;

  it("o corpo escolhido para título longo faz duas linhas caberem", () => {
    for (const titulo of [
      "Qual Abordagem Escolher? Avaliação de Risco ou Análise de Problema?",
      "A".repeat(43),
      "A".repeat(79),
    ]) {
      const pt = tituloCabeNoCabecalho(titulo);
      expect(duasLinhasPol(pt), `${titulo.length} chars → ${pt}pt`)
        .toBeLessThanOrEqual(ALTURA_DA_CAIXA);
    }
  });

  it("22pt NÃO caberia — é por isso que o degrau desceu para 20", () => {
    // 2 × 22 × 1,2 ÷ 72 = 0,733 pol contra 0,72 de caixa. Era o corpo antigo.
    expect(duasLinhasPol(22)).toBeGreaterThan(ALTURA_DA_CAIXA);
  });

  it("título curto mantém o corpo grande — o conserto não encolhe o que cabia", () => {
    expect(tituloCabeNoCabecalho("O Que É Auditoria Operacional?")).toBe(26);
  });

  it("os degraus descem com o comprimento, nunca sobem", () => {
    const pts = [10, 42, 43, 78, 79, 200].map((n) => tituloCabeNoCabecalho("A".repeat(n)));
    for (let i = 1; i < pts.length; i++) expect(pts[i]).toBeLessThanOrEqual(pts[i - 1]);
  });

  it("título vazio não quebra", () => {
    expect(tituloCabeNoCabecalho("")).toBe(26);
    expect(tituloCabeNoCabecalho(undefined as any)).toBe(26);
  });
});

describe("composição vertical: poucos itens não esticam até o rodapé", () => {
  const AREA_Y = 1.5, AREA_H = 5.35; // CONTENT_Y e CONTENT_H aproximados

  it("O CASO MEDIDO: 4 itens deixavam 1,3 pol por linha", () => {
    const antes = AREA_H / 4;
    expect(antes).toBeGreaterThan(1.3);
    const { rowH } = blocoCentrado(4, AREA_Y, AREA_H);
    expect(rowH).toBe(ALTURA_MAX_DA_LINHA);
    expect(rowH).toBeLessThan(antes);
  });

  it("o bloco fica centrado na área, não colado no topo", () => {
    const { rowH, y0 } = blocoCentrado(3, AREA_Y, AREA_H);
    const sobraAcima = y0 - AREA_Y;
    const sobraAbaixo = (AREA_Y + AREA_H) - (y0 + rowH * 3);
    expect(sobraAcima).toBeCloseTo(sobraAbaixo, 6);
    expect(sobraAcima).toBeGreaterThan(0);
  });

  it("com muitos itens o teto não morde e nada muda", () => {
    const { rowH, y0 } = blocoCentrado(8, AREA_Y, AREA_H);
    expect(rowH).toBeCloseTo(AREA_H / 8, 6);
    expect(y0).toBeCloseTo(AREA_Y, 6);
  });

  it("o bloco nunca passa da área", () => {
    for (const n of [1, 2, 3, 5, 8, 12]) {
      const { rowH, y0 } = blocoCentrado(n, AREA_Y, AREA_H);
      expect(y0 + rowH * n, `n=${n}`).toBeLessThanOrEqual(AREA_Y + AREA_H + 1e-9);
      expect(y0).toBeGreaterThanOrEqual(AREA_Y - 1e-9);
    }
  });

  it("zero itens não divide por zero", () => {
    const { rowH, y0 } = blocoCentrado(0, AREA_Y, AREA_H);
    expect(Number.isFinite(rowH)).toBe(true);
    expect(Number.isFinite(y0)).toBe(true);
  });
});

describe("notas dos 17 slides que saíam sem nenhuma", () => {
  it("a capa diz o que abrir e quantos módulos são", () => {
    const n = notaDaCapa("Auditoria Operacional", 6, "Português");
    expect(n).toContain("Auditoria Operacional");
    expect(n).toContain("6 módulos");
    expect(n.length).toBeGreaterThan(80);
  });

  it("um módulo só não vira '1 módulos'", () => {
    expect(notaDaCapa("X", 1, "Português")).toContain("1 módulo.");
    expect(notaDaAgenda(1, "Português")).toContain("1 módulo");
  });

  it("a divisória carrega os objetivos do módulo", () => {
    const n = notaDaDivisoria(3, "Análise Preliminar", [
      "Aplicar técnicas de diagnóstico",
      "Avaliar riscos do objeto auditado",
    ], "Português");
    expect(n).toContain("módulo 3");
    expect(n).toContain("Análise Preliminar");
    expect(n).toContain("• Aplicar técnicas de diagnóstico");
    expect(n).toContain("• Avaliar riscos do objeto auditado");
  });

  it("divisória sem objetivos continua tendo a frase de transição", () => {
    const n = notaDaDivisoria(1, "Fundamentos", undefined, "Português");
    expect(n).toContain("Fundamentos");
    expect(n).not.toContain("•");
    expect(n.length).toBeGreaterThan(40);
  });

  it("o encerramento aponta o próximo passo", () => {
    expect(notaDoEncerramento("Português")).toMatch(/certificado|avaliação/);
  });

  it("segue o idioma do deck", () => {
    expect(notaDaCapa("X", 2, "English")).toContain("are 2 modules");
    expect(notaDaCapa("X", 2, "Español")).toContain("2 módulos");
    expect(frases("Português")).toBe(frases("pt-BR"));
  });

  it("idioma desconhecido cai em português, que é o padrão do produto", () => {
    expect(notaDaAgenda(3, "klingon")).toContain("Percorra");
    expect(notaDaAgenda(3, "")).toContain("Percorra");
  });

  it("nenhuma nota sai vazia", () => {
    for (const lang of ["Português", "English", "Español", ""]) {
      expect(notaDaCapa("C", 4, lang).trim().length).toBeGreaterThan(50);
      expect(notaDaAgenda(4, lang).trim().length).toBeGreaterThan(40);
      expect(notaDaDivisoria(2, "T", [], lang).trim().length).toBeGreaterThan(40);
      expect(notaDoEncerramento(lang).trim().length).toBeGreaterThan(40);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// O NÚCLEO DO DIAGRAMA ESCREVIA O INTERROGATIVO EM VEZ DO ASSUNTO
//
// MEDIDO ao RENDERIZAR o deck consertado e olhar: o slide "O Que É Auditoria
// Operacional?" saiu com o círculo central escrito "Que É".
//
// `LIGACAO` derruba o artigo "O", e as duas palavras seguintes são o
// interrogativo e a cópula. O assunto fica em terceiro lugar e nunca é
// alcançado. Título em pergunta é comum num curso.
// ═══════════════════════════════════════════════════════════════════════════

describe("rótulo do núcleo do diagrama", () => {
  it("O CASO MEDIDO: a pergunta não vira o rótulo", () => {
    const r = rotuloDoNucleo("O Que É Auditoria Operacional?", 2, 18);
    expect(r).not.toBe("Que É");
    expect(r).toContain("Auditoria");
  });

  it("outras aberturas interrogativas também saem", () => {
    for (const [titulo, esperado] of [
      ["Qual Abordagem Escolher?", "Abordagem"],
      ["Como Elaborar a Matriz de Planejamento", "Elaborar"],
      ["What Is Operational Audit?", "Operational"],
    ] as const) {
      expect(rotuloDoNucleo(titulo, 2, 18), titulo).toContain(esperado);
    }
  });

  it("nenhum rótulo termina em interrogação", () => {
    for (const t of [
      "O Que É Auditoria Operacional?",
      "What Is Operational Audit?",
      "Qual Abordagem Escolher?",
    ]) {
      expect(rotuloDoNucleo(t, 2, 18), t).not.toMatch(/[?!.;:,\-–—]\s*$/);
    }
  });

  it("'como' NO MEIO do título é conteúdo e fica", () => {
    // A lista é de abertura: ela para na primeira palavra substantiva.
    expect(rotuloDoNucleo("Risco como critério de seleção", 2, 18)).toContain("Risco");
  });

  it("título sem pergunta continua como era", () => {
    expect(rotuloDoNucleo("PPA: O Plano Plurianual", 2, 18)).toBe("PPA");
    expect(rotuloDoNucleo("A Fase de Planejamento", 2, 18)).toContain("Fase");
  });

  it("título só de interrogativos devolve algo, não vazio", () => {
    expect(rotuloDoNucleo("O que é?", 2, 18).length).toBeGreaterThan(0);
    expect(rotuloDoNucleo("", 2, 18)).toBe("");
  });
});
