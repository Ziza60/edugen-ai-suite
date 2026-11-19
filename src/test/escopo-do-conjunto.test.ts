import { describe, expect, it } from "vitest";
import {
  blocoDoConjunto, irmaosRecebidos, promptDeAnalise, MAX_CHARS_NA_ANALISE,
  type DocumentoIrmao,
} from "../../supabase/functions/_shared/analise-de-documento.ts";
import {
  analiseDoConjunto, irmaosParaAnalise,
} from "@/lib/metadados-do-conjunto";

// ═══════════════════════════════════════════════════════════════════════════
// O TÍTULO ABRANGENTE SOBRE UM CONJUNTO ESTREITO
//
// RELATADO por quem usou, em 19/11/2026: anexou o capítulo de conceitos gerais
// de auditoria (38.605 caracteres) junto com o de planejamento da auditoria
// operacional (93.537). O título veio abrangente, como se o curso cobrisse
// todas as fases da auditoria, e o tema afirmou que o curso iria ALÉM do
// planejamento — promessa que as fontes não sustentam. Teve de corrigir os dois
// à mão, e esperava que o app delimitasse sozinho.
//
// DUAS CAUSAS SOMADAS:
//
//   1. `analyze-pdf-source` analisava cada documento SOZINHO, com o pedido
//      "desenhe um curso a partir deste documento". Nenhuma chamada sabia que a
//      outra existia.
//   2. O formulário usava `analises[0]` — o PRIMEIRO documento escolhido, que
//      nesse caso era justamente o geral. Decisão minha, de hoje mesmo.
//
// Trocar o índice sozinho não consertaria: o problema não era QUAL análise
// escolher, era que NENHUMA conhecia o conjunto.
// ═══════════════════════════════════════════════════════════════════════════

const CONCEITOS: DocumentoIrmao = {
  filename: "Introdução.pdf",
  char_count: 38_605,
  title: "Conceitos Gerais da Auditoria Operacional",
  summary: "Apresenta as dimensões de desempenho e os principais conceitos.",
};

describe("documento sozinho: o prompt fica como sempre foi", () => {
  it("sem irmãos, nenhum bloco de conjunto é declarado", () => {
    expect(blocoDoConjunto("Manual.pdf", 93_537, [])).toBe("");
  });

  it("o prompt de um documento só não fala de conjunto", () => {
    const p = promptDeAnalise("texto do manual", "Manual.pdf");
    expect(p).not.toMatch(/ONE OF \d+ DOCUMENTS/);
    expect(p).toContain('Document name: "Manual.pdf"');
    expect(p).toContain("suggestedModules");
  });
});

describe("vários documentos: o prompt declara o conjunto e proíbe prometer demais", () => {
  const prompt = promptDeAnalise(
    "x".repeat(93_537), "Manual_auditoria_operacional_4_edicao.pdf", [CONCEITOS],
  );

  it("diz quantos documentos são", () => {
    expect(prompt).toContain("ONE OF 2 DOCUMENTS");
  });

  it("nomeia o outro documento, com o tamanho dele", () => {
    expect(prompt).toContain('"Introdução.pdf" (38605 characters)');
  });

  it("passa o título e o resumo já sugeridos para o outro", () => {
    expect(prompt).toContain("Conceitos Gerais da Auditoria Operacional");
    expect(prompt).toContain("dimensões de desempenho");
  });

  it("declara o tamanho DESTE documento, para o modelo pesar a massa", () => {
    // 93.537 contra 38.605: o planejamento é que carrega o assunto.
    expect(prompt).toContain('This document: "Manual_auditoria_operacional_4_edicao.pdf" (93537 characters)');
  });

  it("A REGRA QUE CONSERTA O DEFEITO: nunca prometer o que o conjunto não cobre", () => {
    expect(prompt).toContain("NEVER promise coverage of phases, stages or topics that are not in the set");
    expect(prompt).toMatch(/only ONE phase of a larger process, the title or the theme must say so/);
  });

  it("manda escopo, tema e número de módulos descreverem o CONJUNTO", () => {
    expect(prompt).toContain("they describe the WHOLE SET, not just this document");
    expect(prompt).toMatch(/"suggestedModules" must reflect the combined content/);
  });

  it("diz que documento introdutório curto contribui conceito, não escopo", () => {
    expect(prompt).toMatch(/short introductory document contributes concepts, not scope/);
  });

  it("três documentos contam três", () => {
    const p = promptDeAnalise("t", "C.pdf", [
      CONCEITOS, { filename: "B.pdf", char_count: 1000 },
    ]);
    expect(p).toContain("ONE OF 3 DOCUMENTS");
  });

  it("o texto do documento continua recortado no limite de custo", () => {
    const p = promptDeAnalise("y".repeat(MAX_CHARS_NA_ANALISE + 5_000), "G.pdf", [CONCEITOS]);
    expect(p).toContain("y".repeat(MAX_CHARS_NA_ANALISE));
    expect(p).not.toContain("y".repeat(MAX_CHARS_NA_ANALISE + 1));
  });
});

describe("leitura de outros_documentos como chega do formulário", () => {
  it("lê a lista normal", () => {
    const r = irmaosRecebidos(JSON.stringify([
      { filename: "a.pdf", char_count: 10 },
      { filename: "b.pdf", char_count: 20, title: "T", summary: "S" },
    ]));
    expect(r).toHaveLength(2);
    expect(r[1]).toEqual({ filename: "b.pdf", char_count: 20, title: "T", summary: "S" });
  });

  it("entrada quebrada NÃO derruba o upload — devolve lista vazia", () => {
    // Uma análise sozinha é pior que uma análise do conjunto, e muito melhor
    // que um upload que falha.
    for (const ruim of ["{", "null", '"texto"', "[1,2,3]", "", "   ", undefined, 42]) {
      expect(irmaosRecebidos(ruim as any), String(ruim)).toEqual([]);
    }
  });

  it("descarta item sem nome de arquivo", () => {
    const r = irmaosRecebidos(JSON.stringify([{ char_count: 5 }, { filename: "ok.pdf" }]));
    expect(r.map((d) => d.filename)).toEqual(["ok.pdf"]);
  });

  it("char_count ausente ou inválido vira 0, e não NaN no prompt", () => {
    const r = irmaosRecebidos(JSON.stringify([{ filename: "a.pdf", char_count: "muitos" }]));
    expect(r[0].char_count).toBe(0);
    expect(blocoDoConjunto("b.pdf", 1, r)).toContain("(0 characters)");
  });

  it("não aceita lista sem fim: corta em 20", () => {
    const muitos = Array.from({ length: 50 }, (_, i) => ({ filename: `f${i}.pdf`, char_count: 1 }));
    expect(irmaosRecebidos(JSON.stringify(muitos))).toHaveLength(20);
  });
});

describe("qual análise preenche o formulário", () => {
  const a = { title: "Conceitos Gerais da Auditoria" };
  const b = { title: "Planejamento da Auditoria Operacional" };

  it("a ÚLTIMA — é a única que conheceu todos os documentos", () => {
    expect(analiseDoConjunto([a, b])).toBe(b);
  });

  it("com um documento só, é esse", () => {
    expect(analiseDoConjunto([a])).toBe(a);
  });

  it("lista vazia devolve undefined, e não um objeto inventado", () => {
    expect(analiseDoConjunto([])).toBeUndefined();
  });

  it("NÃO é a primeira — o defeito relatado era exatamente a primeira", () => {
    expect(analiseDoConjunto([a, b])).not.toBe(a);
  });
});

describe("os irmãos declarados a cada análise", () => {
  it("são cumulativos: a segunda análise conhece a primeira", () => {
    const primeira = [{ filename: "a.pdf", char_count: 10, title: "T1", summary: "S1" }];
    expect(irmaosParaAnalise(primeira)).toEqual([
      { filename: "a.pdf", char_count: 10, title: "T1", summary: "S1" },
    ]);
  });

  it("a primeira análise não tem irmão nenhum", () => {
    expect(irmaosParaAnalise([])).toEqual([]);
  });

  it("não vaza o texto do documento, só metadado", () => {
    const comTexto = [{
      filename: "a.pdf", char_count: 10, title: "T",
      extracted_text: "o texto inteiro do documento",
    }] as any;
    const r = irmaosParaAnalise(comTexto);
    expect(JSON.stringify(r)).not.toContain("o texto inteiro");
    expect(Object.keys(r[0]).sort()).toEqual(["char_count", "filename", "title"]);
  });

  it("campo ausente não viaja como undefined", () => {
    const r = irmaosParaAnalise([{ filename: "a.pdf", char_count: 1 }]);
    expect(JSON.stringify(r[0])).toBe('{"filename":"a.pdf","char_count":1}');
  });
});
