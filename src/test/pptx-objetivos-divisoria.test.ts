import { describe, expect, it } from "vitest";
import {
  objetivosDeReserva,
  objetivosDoConteudo,
} from "../../supabase/functions/export-pptx-v7/deck-plan";

// ═══════════════════════════════════════════════════════════════════════════
// OS OBJETIVOS QUE APARECIAM CONFORME O HUMOR DO PLANEJADOR
//
// A divisória do módulo lista "NESTE MÓDULO" com os objetivos, e eles vinham de
// um slide de visão geral que o planejador escrevia quando queria. Dois decks do
// MESMO curso, com um dia de diferença:
//
//   23/08 — 4 de 5 divisórias com objetivos
//   24/08 — 2 de 5
//
// Nada no código mudou entre os dois nesse ponto; mudou o que o modelo resolveu
// gerar. O aluno abre o módulo 3 e não sabe o que vai aprender ali, por acaso.
//
// Só que os objetivos não precisavam vir do planejador: o markdown do módulo
// traz "> **Objetivo da lição:**" para toda lição, emitido deterministicamente
// por renderModuleMarkdown.
// ═══════════════════════════════════════════════════════════════════════════

const MODULO = `## Módulo 3 — Ponto de Pedido

### 3.1 Componentes do Ponto de Pedido

> **Objetivo da lição:** Identificar os componentes do Ponto de Pedido e sua função na prevenção de rupturas.

Texto da lição.

### 3.2 Estoque de Segurança

> **Objetivo da lição:** Calcular o Estoque de Segurança a partir da demanda máxima e do tempo de ressuprimento.

Mais texto.

### 3.3 Aplicação prática

> **Objetivo da lição:** Aplicar o Ponto de Pedido ao caso da Doceria Sabor & Arte.
`;

describe("objetivosDoConteudo", () => {
  it("acha um objetivo por lição, na ordem", () => {
    const objs = objetivosDoConteudo(MODULO);
    expect(objs).toHaveLength(3);
    expect(objs[0]).toContain("componentes do Ponto de Pedido");
    expect(objs[2]).toContain("Doceria");
  });

  it("respeita o teto de quantos cabem na divisória", () => {
    expect(objetivosDoConteudo(MODULO, 2)).toHaveLength(2);
  });

  it("apara o objetivo comprido sem deixá-lo pendurado", () => {
    const longo = "> **Objetivo da lição:** " +
      "Compreender em profundidade os princípios da classificação de estoque, " +
      "aplicando-os ao portfólio completo da empresa e às suas particularidades " +
      "sazonais ao longo de todo o exercício.";
    const [o] = objetivosDoConteudo(longo);
    expect(o.length).toBeLessThanOrEqual(110);
    expect(o).not.toMatch(/\b(de|da|do|para|com|e|a|o|em|às|aos)$/i);
  });

  it("ignora marcação em negrito no meio do objetivo", () => {
    const md = "> **Objetivo da lição:** Aplicar a **Curva ABC** ao estoque.";
    expect(objetivosDoConteudo(md)[0]).toBe("Aplicar a Curva ABC ao estoque.");
  });

  it("módulo sem o marcador devolve lista vazia — não inventa objetivo", () => {
    expect(objetivosDoConteudo("## Módulo\n\nSó texto corrido.")).toEqual([]);
    expect(objetivosDoConteudo("")).toEqual([]);
    expect(objetivosDoConteudo(null as unknown as string)).toEqual([]);
  });
});

describe("objetivosDeReserva", () => {
  it("preenche o módulo que ficou sem objetivos", () => {
    const out = [{ title: "M3", slides: [], objectives: undefined }] as never as
      Array<{ objectives?: string[] }>;
    const n = objetivosDeReserva(out as never, [{ content: MODULO }]);
    expect(n).toBe(1);
    expect(out[0].objectives).toHaveLength(3);
  });

  it("nunca sobrescreve o que a visão geral já deu", () => {
    // A visão geral foi escrita para ser lida ali; é melhor que o objetivo da
    // lição, e o planejador teve o trabalho de produzi-la.
    const daVisaoGeral = ["Objetivo escrito pelo planejador"];
    const out = [{ title: "M3", slides: [], objectives: daVisaoGeral }] as never as
      Array<{ objectives?: string[] }>;
    expect(objetivosDeReserva(out as never, [{ content: MODULO }])).toBe(0);
    expect(out[0].objectives).toBe(daVisaoGeral);
  });

  it("módulo sem conteúdo aproveitável fica como estava", () => {
    const out = [{ title: "M", slides: [] }] as never as Array<{ objectives?: string[] }>;
    expect(objetivosDeReserva(out as never, [{ content: "sem marcador" }])).toBe(0);
    expect(out[0].objectives).toBeUndefined();
  });

  it("casa cada módulo do deck com o seu módulo de origem", () => {
    const out = [
      { title: "M1", slides: [] },
      { title: "M2", slides: [] },
    ] as never as Array<{ objectives?: string[] }>;
    objetivosDeReserva(out as never, [
      { content: "> **Objetivo da lição:** Primeiro objetivo do módulo um." },
      { content: "> **Objetivo da lição:** Segundo objetivo, do módulo dois." },
    ]);
    expect(out[0].objectives?.[0]).toContain("módulo um");
    expect(out[1].objectives?.[0]).toContain("módulo dois");
  });

  it("lista de origem mais curta que o deck não quebra", () => {
    const out = [{ title: "M1", slides: [] }, { title: "M2", slides: [] }] as never as
      Array<{ objectives?: string[] }>;
    expect(() => objetivosDeReserva(out as never, [])).not.toThrow();
  });
});
