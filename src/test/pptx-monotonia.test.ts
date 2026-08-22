import { describe, expect, it } from "vitest";
import {
  objetivosParaDivisoria,
  quebrarSequenciaDeLayout,
  tabelaViraPassos,
} from "../../supabase/functions/export-pptx-v7/deck-plan";
import { normalizeDeck } from "../../supabase/functions/export-pptx-v7/validate";

// ═══════════════════════════════════════════════════════════════════════════
// A APRESENTAÇÃO FICOU MONÓTONA
//
// Medido no deck de estoque (57 slides): 18 deles — 32% — tinham papel
// estrutural fixo, iguais nos cinco módulos. O título "Visão Geral do Módulo"
// aparecia quatro vezes idêntico. Dez páginas eram tabela, três em sequência.
//
// O alvo não é variedade pela variedade: um material de treinamento precisa de
// identidade, e a função PODE repetir — todo módulo abre anunciando objetivos e
// fecha recapitulando. O que não pode é a forma idêntica cinco vezes.
// ═══════════════════════════════════════════════════════════════════════════

const objetivo = (n: number) =>
  Array.from({ length: n }, (_, i) => `Objetivo número ${i + 1} da lição.`);

const modulo = (slides: unknown[]) => ({ title: "Diagnóstico de Estoque", slides });

describe("a visão geral vira os objetivos da divisória", () => {
  it("o slide genérico sai e os objetivos ficam com o módulo", () => {
    const out: any = [modulo([
      { kind: "bullets", title: "Visão Geral do Módulo", bullets: objetivo(4) },
      { kind: "bullets", title: "O Papel do Estoque", bullets: ["Conteúdo real."] },
    ])];
    expect(objetivosParaDivisoria(out, "Português")).toBe(1);
    expect(out[0].slides.map((s: any) => s.title)).toEqual(["O Papel do Estoque"]);
    expect(out[0].objectives).toHaveLength(4);
    expect(out[0].objectives[0]).toContain("Objetivo número 1");
  });

  it("no máximo quatro objetivos vão para a divisória", () => {
    const out: any = [modulo([
      { kind: "bullets", title: "Visão Geral do Módulo", bullets: objetivo(6) },
      { kind: "bullets", title: "Outro", bullets: ["x"] },
    ])];
    objetivosParaDivisoria(out, "Português");
    expect(out[0].objectives).toHaveLength(4);
  });

  it("funciona quando o planejador já pôs uma divisória na frente", () => {
    const out: any = [modulo([
      { kind: "section", title: "Módulo 1" },
      { kind: "bullets", title: "Visão Geral do Módulo", bullets: objetivo(3) },
      { kind: "bullets", title: "Conteúdo", bullets: ["x"] },
    ])];
    expect(objetivosParaDivisoria(out, "Português")).toBe(1);
    expect(out[0].slides.map((s: any) => s.kind)).toEqual(["section", "bullets"]);
  });

  it("visão geral NO MEIO do módulo não é tocada — mexeria na ordem da aula", () => {
    const out: any = [modulo([
      { kind: "bullets", title: "Abertura", bullets: ["x"] },
      { kind: "bullets", title: "Visão Geral do Módulo", bullets: objetivo(3) },
    ])];
    expect(objetivosParaDivisoria(out, "Português")).toBe(0);
    expect(out[0].slides).toHaveLength(2);
  });

  it("slide com título próprio não é confundido com visão geral", () => {
    const out: any = [modulo([
      { kind: "bullets", title: "O Papel Estratégico do Estoque", bullets: objetivo(3) },
    ])];
    expect(objetivosParaDivisoria(out, "Português")).toBe(0);
  });

  it("visão geral de um item só não vira coluna de objetivos", () => {
    const out: any = [modulo([
      { kind: "bullets", title: "Visão Geral do Módulo", bullets: ["Só isto."] },
    ])];
    expect(objetivosParaDivisoria(out, "Português")).toBe(0);
  });

  it("idioma sem rótulo conhecido não mexe em nada", () => {
    const out: any = [modulo([
      { kind: "bullets", title: "Visão Geral do Módulo", bullets: objetivo(3) },
    ])];
    expect(objetivosParaDivisoria(out, "Klingon")).toBe(0);
  });
});

describe("tabela que é sequência disfarçada", () => {
  // "Etapas do Plano Mestre": Etapa | Ferramentas | Ações. É um roteiro, não
  // uma planilha.
  const sequencia = {
    kind: "table",
    title: "Etapas do Plano Mestre de Estoque e Compras",
    rowHeader: "Etapa",
    columns: ["Ferramentas", "Ações Chave"],
    rows: [
      { label: "Diagnóstico", cells: ["Curva ABC", "Classificar o mix"] },
      { label: "Dimensionamento", cells: ["LEC", "Definir lotes de compra"] },
      { label: "Reposição", cells: ["Ponto de pedido", "Disparar o pedido"] },
    ],
  };

  it("vira passos, com o rótulo virando o título do passo", () => {
    const r = tabelaViraPassos(sequencia as never)!;
    expect(r.kind).toBe("steps");
    expect(r.steps!.map((p) => p.heading))
      .toEqual(["Diagnóstico", "Dimensionamento", "Reposição"]);
    expect(r.steps![0].body).toBe("Curva ABC · Classificar o mix");
    expect(r.rows).toBeUndefined();
    expect(r.columns).toBeUndefined();
  });

  it("FORMULÁRIO continua tabela — é nela que o aluno escreve", () => {
    const form = {
      kind: "table",
      title: "Atividade: Classificando o Mix",
      rowHeader: "Campo",
      columns: ["Orientação", "Seu caso"],
      rows: [
        { label: "Produto", cells: ["Nome do item.", "________________"] },
        { label: "Valor", cells: ["Vendas no semestre.", "________________"] },
        { label: "Categoria", cells: ["A, B ou C.", "________________"] },
      ],
    };
    expect(tabelaViraPassos(form as never)).toBeNull();
  });

  it("tabela grande demais continua grade", () => {
    const grande = {
      ...sequencia,
      rows: Array.from({ length: 6 }, (_, i) => ({
        label: `L${i}`,
        cells: ["a", "b"],
      })),
    };
    expect(tabelaViraPassos(grande as never)).toBeNull();
  });

  it("célula longa continua grade — na barra do passo viraria parede", () => {
    const longa = {
      ...sequencia,
      rows: sequencia.rows.map((r) => ({ ...r, cells: ["x".repeat(140), "y"] })),
    };
    expect(tabelaViraPassos(longa as never)).toBeNull();
  });

  it("linha sem rótulo continua grade", () => {
    const semRotulo = {
      ...sequencia,
      rows: [{ label: "", cells: ["a", "b"] }, ...sequencia.rows.slice(1)],
    };
    expect(tabelaViraPassos(semRotulo as never)).toBeNull();
  });

  it("o que não é tabela não é convertido", () => {
    expect(tabelaViraPassos({ kind: "bullets", bullets: ["a"] } as never)).toBeNull();
  });
});

describe("duas grades seguidas", () => {
  const grade = (titulo: string) => ({
    kind: "table",
    title: titulo,
    rowHeader: "Etapa",
    columns: ["Ferramentas", "Ações"],
    rows: [
      { label: "Um", cells: ["a", "b"] },
      { label: "Dois", cells: ["c", "d"] },
      { label: "Três", cells: ["e", "f"] },
    ],
  });
  const formulario = () => ({
    kind: "table",
    title: "Atividade",
    rowHeader: "Campo",
    columns: ["Orientação", "Seu caso"],
    rows: [
      { label: "Um", cells: ["a", "____________"] },
      { label: "Dois", cells: ["c", "____________"] },
      { label: "Três", cells: ["e", "____________"] },
    ],
  });

  it("a segunda de duas vira passos", () => {
    const out: any = [modulo([grade("Primeira"), grade("Segunda")])];
    expect(quebrarSequenciaDeLayout(out)).toBe(1);
    expect(out[0].slides.map((s: any) => s.kind)).toEqual(["table", "steps"]);
  });

  it("tabela isolada não é mexida", () => {
    const out: any = [modulo([
      grade("Única"),
      { kind: "bullets", title: "Outro", bullets: ["x"] },
    ])];
    expect(quebrarSequenciaDeLayout(out)).toBe(0);
    expect(out[0].slides[0].kind).toBe("table");
  });

  it("três seguidas: a do meio muda e a sequência se quebra", () => {
    const out: any = [modulo([grade("A"), grade("B"), grade("C")])];
    quebrarSequenciaDeLayout(out);
    const kinds = out[0].slides.map((s: any) => s.kind);
    expect(kinds).toEqual(["table", "steps", "table"]);
    // Nenhuma tabela ficou colada em outra.
    for (let i = 1; i < kinds.length; i++) {
      expect(kinds[i] === "table" && kinds[i - 1] === "table").toBe(false);
    }
  });

  it("formulário atrás de formulário fica como está — variedade não vale página pior", () => {
    const out: any = [modulo([formulario(), formulario()])];
    expect(quebrarSequenciaDeLayout(out)).toBe(0);
    expect(out[0].slides.every((s: any) => s.kind === "table")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// OS OBJETIVOS SE PERDIAM NA NORMALIZAÇÃO
//
// Deck de 22/08 (2ª geração): a fusão funcionou — os quatro slides "Visão Geral
// do Módulo" sumiram e o deck caiu de 57 para 52 páginas —, mas as divisórias
// saíram vazias, só com o número e o título. A informação foi retirada de um
// lugar e não apareceu no outro.
//
// A normalização reconstruía cada módulo como { title, slides } e, com isso,
// descartava em silêncio qualquer campo novo. Um caso em que remover é pior que
// não ter mexido: o slide foi embora e o conteúdo dele também.
// ═══════════════════════════════════════════════════════════════════════════

describe("os objetivos sobrevivem à normalização", () => {
  it("chegam do outro lado, junto com o módulo", () => {
    const out: any = [modulo([
      { kind: "bullets", title: "Visão Geral do Módulo", bullets: objetivo(3) },
      { kind: "bullets", title: "Conteúdo", bullets: ["Texto de verdade aqui."] },
    ])];
    objetivosParaDivisoria(out, "Português");
    expect(out[0].objectives).toHaveLength(3);

    const { deck } = normalizeDeck({ modules: out } as never);
    expect(deck.modules[0].objectives).toHaveLength(3);
    expect(deck.modules[0].objectives![0]).toContain("Objetivo número 1");
  });

  it("módulo sem objetivos continua sem, e nada quebra", () => {
    const { deck } = normalizeDeck({
      modules: [modulo([{ kind: "bullets", title: "Só conteúdo", bullets: ["x"] }])],
    } as never);
    expect(deck.modules[0].objectives).toBeUndefined();
  });
});
