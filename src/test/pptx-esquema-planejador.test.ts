import { describe, expect, it } from "vitest";
import { SLIDE_RESPONSE_SCHEMA } from "../../supabase/functions/export-pptx-v7/deck-plan";

// ═══════════════════════════════════════════════════════════════════════════
// POR QUE ESTE TESTE EXISTE
//
// O slide de gráfico nunca apareceu em curso nenhum, e passamos por três
// hipóteses antes de achar a causa: o conteúdo não tinha números (era verdade e
// foi corrigido), o planejador enxergava só 12% do módulo (era verdade e foi
// corrigido), o prompt só permitia em vez de exigir (era verdade e foi
// corrigido). Nenhuma das três acordou o gráfico.
//
// A causa real: o responseSchema do planejador NÃO DECLARAVA a propriedade
// "chart". O esquema não é documentação, é contrato — a resposta é gerada sob
// ele, e o que não está declarado é descartado pela API antes de chegar aqui.
// O "chart" estava no enum de `kind`, o prompt o descrevia, o exemplo de JSON o
// mostrava, o normalizador sabia tratá-lo e o renderizador sabia desenhá-lo.
// Faltava só o lugar onde os dados moram. O slide chegava vazio e era
// descartado por ter menos de dois pontos.
//
// O defeito era invisível porque o esquema mora longe de todos eles. Este teste
// existe para amarrar as duas pontas: se um `kind` é oferecido ao modelo, a
// propriedade que carrega o conteúdo daquele kind tem de estar declarada junto.
// ═══════════════════════════════════════════════════════════════════════════

const slide = (SLIDE_RESPONSE_SCHEMA as any).properties.slides.items;
const props = slide.properties;
const kinds: string[] = props.kind.enum;

describe("o esquema do planejador oferece o que sabe receber", () => {
  it("todo kind com conteúdo próprio tem a sua propriedade declarada", () => {
    const carga: Record<string, string[]> = {
      bullets: ["bullets"],
      cards: ["cards"],
      steps: ["steps"],
      compare: ["left", "right"],
      matrix: ["cards"],
      quote: ["quote"],
      stat: ["stat"],
      chart: ["chart"],
      table: ["columns", "rows"],
      code: ["code"],
      closing: ["bullets"],
    };
    for (const k of kinds) {
      for (const campo of carga[k] ?? []) {
        expect(props[campo], `kind "${k}" precisa da propriedade "${campo}"`).toBeDefined();
      }
    }
  });
});

describe("chart — a propriedade que faltava", () => {
  it("está declarada", () => {
    expect(props.chart).toBeDefined();
  });

  it("aceita os dois tipos que o renderizador desenha, e só eles", () => {
    expect(props.chart.properties.type.enum).toEqual(["donut", "bar"]);
  });

  it("os pontos têm rótulo e valor NUMÉRICO", () => {
    const ponto = props.chart.properties.points.items;
    expect(ponto.properties.label.type).toBe("string");
    // Número, não texto: normChart converte, mas pedir string ao modelo
    // convidaria "25%" no lugar de 25, e a unidade tem campo próprio.
    expect(ponto.properties.value.type).toBe("number");
    expect(ponto.required).toEqual(["label", "value"]);
  });

  it("tipo e pontos são obrigatórios — gráfico sem dado não é gráfico", () => {
    expect(props.chart.required).toEqual(["type", "points"]);
  });

  it("a unidade é opcional, porque nem todo gráfico é percentual", () => {
    expect(props.chart.properties.unit).toBeDefined();
    expect(props.chart.required).not.toContain("unit");
  });
});

describe("table — o mesmo defeito, com disfarce", () => {
  it("é um kind oferecido ao modelo", () => {
    expect(kinds).toContain("table");
  });

  it("colunas e linhas estão declaradas", () => {
    expect(props.columns).toBeDefined();
    expect(props.rows).toBeDefined();
    expect(props.rows.items.required).toEqual(["label", "cells"]);
  });
});

describe("o que não pode regredir", () => {
  it("kind e title continuam obrigatórios", () => {
    expect(slide.required).toEqual(["kind", "title"]);
  });

  it("os kinds que já funcionavam continuam na lista", () => {
    for (const k of ["bullets", "cards", "steps", "compare", "quote", "stat", "code", "closing"]) {
      expect(kinds, k).toContain(k);
    }
  });
});
