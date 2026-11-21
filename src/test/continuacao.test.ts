import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  quantosItens,
  temMarcadorDeParte,
  troncoDoTitulo,
  unificarContinuacoes,
} from "../../supabase/functions/export-pptx-v7/continuacao";
import { renderDeck } from "../../supabase/functions/export-pptx-v7/render";
import type { DeckModule, SlideSpec } from "../../supabase/functions/export-pptx-v7/deck-plan";

// ═══════════════════════════════════════════════════════════════════════════
// A ETAPA 5 CHAMADA DE "01"
//
// APONTADO por quem usou, no deck de 21/11/2026. MEDIDO nos slides 51 e 52:
//
//   51 ... "Etapas de Construção da Matriz (Parte 1)"   steps,  1 2 3 4
//   52 ... "Etapas de Construção da Matriz (Parte 2)"   cards, 01 02 03
//
// É UM procedimento de sete etapas. O aluno vê duas listas — uma de quatro e
// uma de três — em desenhos diferentes, as duas começando do começo.
//
// A palavra "Parte" não aparece em nenhum arquivo do exportador: quem escreveu
// os títulos e escolheu os formatos foi o planejador. O prompt manda dividir
// ("MAX 5 items per slide... split it across 2 slides") e cala sobre formato e
// contagem.
//
// E regra de prompt não resolveria a numeração: quem numera é o renderizador,
// sempre a partir de 1, e o prompt PROÍBE o modelo de escrever ordinais no
// título do passo. O conserto tinha de ser no código.
//
// ─── A ARMADILHA DO RODÍZIO DE FORMAS ───────────────────────────────────────
//
// Unificar o tipo no planejamento não bastava: o renderizador tem duas guardas
// anti-monotonia que separariam os dois de novo — dois grids seguidos viram
// grid + barra lateral, e cartões e passos alternam entre três desenhos. A
// continuação precisa SAIR do rodízio, e é por isso que o último teste aqui
// renderiza de verdade em vez de olhar só o plano.
// ═══════════════════════════════════════════════════════════════════════════

const TRONCO = "Etapas de Construção da Matriz";

function passo(n: number) {
  return { heading: `Etapa ${n}`, body: `Corpo da etapa ${n}, com texto suficiente.` };
}

/** Os dois slides como o planejador os entregou em 21/11. */
function planoDe21_11(): DeckModule[] {
  return [{
    title: "Matriz de Planejamento",
    slides: [
      {
        kind: "steps",
        title: `${TRONCO} (Parte 1)`,
        steps: [passo(1), passo(2), passo(3), passo(4)],
      },
      {
        kind: "cards",
        title: `${TRONCO} (Parte 2)`,
        cards: [
          { heading: "Etapa 5", body: "Corpo da etapa 5, com texto suficiente." },
          { heading: "Etapa 6", body: "Corpo da etapa 6, com texto suficiente." },
          { heading: "Etapa 7", body: "Corpo da etapa 7, com texto suficiente." },
        ],
      },
    ] as SlideSpec[],
  }];
}

describe("reconhecer uma continuação pelo título", () => {
  it("tira o marcador de parte, em várias formas", () => {
    for (const t of [
      `${TRONCO} (Parte 2)`, `${TRONCO} - Parte 2`, `${TRONCO} (cont.)`,
      `${TRONCO} (continuação)`, `${TRONCO} — Parte II`, `${TRONCO} (Part 2)`,
    ]) {
      expect(troncoDoTitulo(t), t).toBe(TRONCO.toLowerCase());
    }
  });

  it("o tronco de 'Parte 1' é o mesmo de 'Parte 2'", () => {
    expect(troncoDoTitulo(`${TRONCO} (Parte 1)`))
      .toBe(troncoDoTitulo(`${TRONCO} (Parte 2)`));
  });

  it("título sem marcador não é continuação", () => {
    expect(temMarcadorDeParte("Validação da Matriz de Planejamento")).toBe(false);
    expect(temMarcadorDeParte("Estudo de Caso")).toBe(false);
  });

  it("não confunde título que apenas CONTÉM a palavra", () => {
    // "Parte" no meio não é marcador de divisão.
    expect(temMarcadorDeParte("A Parte Normativa da Auditoria Pública")).toBe(false);
  });

  it("tronco curto demais não vale — evita casar dois títulos genéricos", () => {
    expect(temMarcadorDeParte("Caso (Parte 2)")).toBe(false);
  });
});

describe("O CASO MEDIDO: slides 51 e 52", () => {
  it("os dois passam a ter o formato da PRIMEIRA parte", () => {
    const out = planoDe21_11();
    const feitas = unificarContinuacoes(out);
    expect(feitas).toHaveLength(1);
    expect(out[0].slides[0].kind).toBe("steps");
    expect(out[0].slides[1].kind).toBe("steps");
    expect(out[0].slides[1].cards).toBeUndefined();
  });

  it("a conversão não perde texto nenhum", () => {
    const out = planoDe21_11();
    unificarContinuacoes(out);
    const passos = out[0].slides[1].steps!;
    expect(passos.map((p) => p.heading)).toEqual(["Etapa 5", "Etapa 6", "Etapa 7"]);
    expect(passos[0].body).toContain("Corpo da etapa 5");
  });

  it("A CONTAGEM SEGUE: a parte 2 começa em 5, não em 1", () => {
    const out = planoDe21_11();
    const feitas = unificarContinuacoes(out);
    expect(out[0].slides[0].startIndex ?? 0).toBe(0);
    expect(out[0].slides[1].startIndex).toBe(4);
    expect(feitas[0].comecaEm).toBe(5);
  });

  it("três partes somam certo", () => {
    const out = planoDe21_11();
    out[0].slides.push({
      kind: "cards",
      title: `${TRONCO} (Parte 3)`,
      cards: [{ heading: "Etapa 8", body: "Corpo da oitava etapa, com texto." }],
    } as SlideSpec);
    unificarContinuacoes(out);
    expect(out[0].slides.map((s) => s.startIndex ?? 0)).toEqual([0, 4, 7]);
  });
});

describe("o que NÃO é continuação fica como está", () => {
  it("slides distantes, com o mesmo tronco, não se unificam", () => {
    const out = planoDe21_11();
    out[0].slides.splice(1, 0, {
      kind: "bullets", title: "Outro assunto no meio", bullets: ["a", "b"],
    } as SlideSpec);
    expect(unificarContinuacoes(out)).toEqual([]);
    expect(out[0].slides[2].kind).toBe("cards");
  });

  it("troncos diferentes não se unificam", () => {
    const out = planoDe21_11();
    out[0].slides[1].title = "Validação da Matriz (Parte 2)";
    expect(unificarContinuacoes(out)).toEqual([]);
  });

  it("tipo não numerado fica de fora", () => {
    const out = planoDe21_11();
    out[0].slides[1] = {
      kind: "table", title: `${TRONCO} (Parte 2)`,
      rowHeader: "X", columns: ["A", "B"], rows: [{ label: "l", cells: ["a", "b"] }],
    } as SlideSpec;
    expect(unificarContinuacoes(out)).toEqual([]);
  });

  it("um módulo sem continuação nenhuma não muda nada", () => {
    const out: DeckModule[] = [{
      title: "M",
      slides: [
        { kind: "steps", title: "Etapas do Planejamento", steps: [passo(1), passo(2)] },
        { kind: "cards", title: "Critérios de Auditoria", cards: [{ heading: "a", body: "b" }] },
      ] as SlideSpec[],
    }];
    expect(unificarContinuacoes(out)).toEqual([]);
    expect(out[0].slides.map((s) => s.kind)).toEqual(["steps", "cards"]);
  });

  it("quantosItens conta por tipo", () => {
    expect(quantosItens({ kind: "steps", title: "x", steps: [passo(1)] } as SlideSpec)).toBe(1);
    expect(quantosItens({ kind: "cards", title: "x", cards: [{ heading: "a", body: "b" }] } as SlideSpec)).toBe(1);
    expect(quantosItens({ kind: "quote", title: "x", quote: "q" } as SlideSpec)).toBe(0);
  });
});

// ─── O TESTE QUE OLHA O SLIDE PRONTO ────────────────────────────────────────

interface SlideFalso {
  textos: string[];
  addText: (t: unknown) => SlideFalso;
  addShape: () => SlideFalso;
  addImage: () => SlideFalso;
  addTable: () => SlideFalso;
  addChart: () => SlideFalso;
  addNotes: () => SlideFalso;
}

class PptxFalso {
  slides: SlideFalso[] = [];
  layout = ""; author = ""; company = ""; subject = ""; title = "";
  defineLayout() {}
  addSlide(): SlideFalso {
    const ler = (t: unknown): string =>
      typeof t === "string"
        ? t
        : Array.isArray(t)
        ? t.map((p: { text?: string }) => p?.text ?? "").join(" ")
        : String((t as { text?: string } | null)?.text ?? "");
    const s: SlideFalso = {
      textos: [],
      addText(t) { this.textos.push(ler(t)); return this; },
      addShape() { return this; },
      addImage() { return this; },
      addTable() { return this; },
      addChart() { return this; },
      addNotes() { return this; },
    };
    this.slides.push(s);
    return s;
  }
}

describe("no slide pronto, a contagem segue e o desenho é o mesmo", () => {
  function renderizar(unificar: boolean) {
    const out = planoDe21_11();
    if (unificar) unificarContinuacoes(out);
    const { pptx } = renderDeck(
      PptxFalso as never,
      { courseTitle: "Auditoria", language: "Português", modules: out } as never,
      {},
    );
    // capa, agenda, divisória, parte 1, parte 2
    return (pptx as unknown as PptxFalso).slides.slice(3);
  }

  /**
   * Os números soltos que o slide escreve, SEM o do rodapé — `footer` escreve
   * a marca e o número da página por último, e ele casaria com o mesmo padrão.
   */
  function numeros(s: SlideFalso): string[] {
    const marca = s.textos.lastIndexOf("EduGenAI");
    const corpo = marca >= 0 ? s.textos.slice(0, marca) : s.textos;
    return corpo.filter((t) => /^\d{1,2}$/.test(t.trim())).map((t) => t.trim());
  }

  it("a parte 2 numera 5, 6 e 7", () => {
    const [, parte2] = renderizar(true);
    expect(numeros(parte2)).toEqual(["5", "6", "7"]);
  });

  it("a parte 1 continua em 1, 2, 3 e 4", () => {
    const [parte1] = renderizar(true);
    expect(numeros(parte1)).toEqual(["1", "2", "3", "4"]);
  });

  it("FALSIFICAÇÃO: sem unificar, a parte 2 recomeça do 1", () => {
    const [, parte2] = renderizar(false);
    expect(numeros(parte2)).toEqual(["01", "02", "03"]);
  });

  it("a continuação sai do rodízio de formas", () => {
    // Observável só em parte pelo texto renderizado: `renderSteps` e
    // `renderStairs` escrevem o mesmo conteúdo em posições diferentes, e o
    // PptxGenJS de mentira não guarda posição. O que dá para travar aqui é que
    // as duas guardas e as duas rotações consultam `continuacao` — sem isso, o
    // tipo unificado no plano se desfaz na hora de desenhar.
    const fonte = readFileSync(
      resolve(process.cwd(), "supabase/functions/export-pptx-v7/render.ts"),
      "utf8",
    );
    expect(fonte).toMatch(/const continuacao = \(s\.startIndex \?\? 0\) > 0/);
    expect(fonte).toMatch(/!continuacao &&[\s\S]{0,200}contentItemCount\(s\) === 1/);
    expect(fonte).toMatch(/if \(!continuacao && cardLike && prevCardLike\)/);
    expect(fonte).toContain("continuacao ? ultimoVarDeCards");
    expect(fonte).toContain("continuacao\n              ? ultimoVarDeSteps");
  });

  it("as duas partes escrevem os mesmos rótulos de etapa, na ordem", () => {
    const [parte1, parte2] = renderizar(true);
    const juntos = [...parte1.textos, ...parte2.textos].join(" ");
    for (let n = 1; n <= 7; n++) expect(juntos, `Etapa ${n}`).toContain(`Etapa ${n}`);
  });
});
