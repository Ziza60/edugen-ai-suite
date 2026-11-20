import { describe, expect, it } from "vitest";
import { renderDeck } from "../../supabase/functions/export-pptx-v7/render";
import { notaDeApoio } from "../../supabase/functions/export-pptx-v7/notas-estruturais";

// ═══════════════════════════════════════════════════════════════════════════
// O RÓTULO DO MÓDULO E A NOTA DO SLIDE QUE NINGUÉM ESCREVE
//
// Dois defeitos MEDIDOS no deck de 21/11/2026, gerado depois do deploy dos
// consertos de 20/11 — isto é, os dois sobreviveram ao conserto anterior.
//
// ─── 1. A SOBRANCELHA VOLTA EM DOIS RENDERIZADORES ──────────────────────────
//
// A regra é: o nome do módulo aparece como sobrancelha no PRIMEIRO slide de
// conteúdo do módulo, como âncora, e sai dos demais. `renderDeck` calcula
// `rotuloDoModulo` exatamente para isso — e passava `m.title` para DOIS dos
// catorze renderizadores:
//
//   renderCompare(slide, s, d, brand, num, m.title, compareCount++)
//   renderProcessArrows(slide, ..., d, brand, num, m.title)
//
// MEDIDO no deck: os slides 8, 14 e 27 repetiam o título do módulo, e os três
// são slides de contraste. Os slides 4, 13 e 23 são a âncora legítima.
//
// É o defeito de sempre: a regra não alcança tudo o que ela governa.
//
// ─── 2. OITO SLIDES SEGUEM SEM NOTA ─────────────────────────────────────────
//
// O conserto de 20/11 deu nota à capa, à agenda, às divisórias e ao
// encerramento — os 9 slides que não têm SlideSpec. Restam 8 que TÊM
// SlideSpec e chegam com `notes` vazio: os 6 fechamentos de módulo, as
// "Trilhas de aprofundamento" e a rubrica de avaliação.
// ═══════════════════════════════════════════════════════════════════════════

interface SlideFalso {
  textos: string[];
  notas: string[];
  addText: (t: unknown) => SlideFalso;
  addShape: () => SlideFalso;
  addImage: () => SlideFalso;
  addTable: () => SlideFalso;
  addChart: () => SlideFalso;
  addNotes: (n: string) => SlideFalso;
  background?: unknown;
}

/** Um PptxGenJS de mentira que guarda o que foi escrito, em vez de zipar. */
class PptxFalso {
  slides: SlideFalso[] = [];
  layout = "";
  author = "";
  company = "";
  subject = "";
  title = "";
  defineLayout() {}
  addSlide(): SlideFalso {
    const texto = (t: unknown): string =>
      typeof t === "string"
        ? t
        : Array.isArray(t)
        ? t.map((p: { text?: string }) => p?.text ?? "").join(" ")
        : String((t as { text?: string } | null)?.text ?? "");
    const s: SlideFalso = {
      textos: [],
      notas: [],
      addText(t) {
        this.textos.push(texto(t));
        return this;
      },
      addShape() {
        return this;
      },
      addImage() {
        return this;
      },
      addTable() {
        return this;
      },
      addChart() {
        return this;
      },
      addNotes(n) {
        this.notas.push(n);
        return this;
      },
    };
    this.slides.push(s);
    return s;
  }
}

const MODULO = "Estratégias Globais e Abordagens de Auditoria";

/** Um módulo com DOIS slides de contraste, que é onde o rótulo vazava. */
function deckDeTeste() {
  return {
    courseTitle: "Auditoria Operacional",
    language: "pt-BR",
    modules: [
      {
        title: MODULO,
        objectives: ["Escolher a abordagem adequada"],
        slides: [
          {
            kind: "bullets",
            title: "Abertura do módulo",
            eyebrow: MODULO,
            bullets: ["Primeiro ponto do módulo", "Segundo ponto do módulo"],
            notes: "Nota escrita pelo planejador.",
          },
          // Contrastes com QUATRO itens por lado: um contraste de uma frase só
          // por lado vira `darkSplit`, que não desenha cabeçalho nenhum e não
          // exercitaria o defeito. Os slides 8 e 14 do deck real são assim.
          {
            kind: "compare",
            title: "Risco vs. Problema",
            eyebrow: MODULO,
            left: {
              heading: "Avaliação de risco",
              items: [
                "Parte das ameaças ao objetivo do programa",
                "Olha para a frente, para o que pode falhar",
                "Exige mapa de controles existentes",
                "Rende questões sobre mitigação",
              ],
            },
            right: {
              heading: "Análise de problema",
              items: [
                "Parte do sintoma já observado",
                "Olha para trás, para a causa",
                "Exige diagnóstico de causa raiz",
                "Rende questões sobre correção",
              ],
            },
            notes: "Nota do contraste.",
          },
          {
            kind: "compare",
            title: "WoG vs. Auditoria isolada",
            eyebrow: MODULO,
            left: {
              heading: "Enfoque integrado de governo",
              items: [
                "Vários órgãos sobre a mesma política",
                "Olha o fluxo inteiro, ponta a ponta",
                "Revela fragmentação e duplicidade",
                "Exige coordenação entre equipes",
              ],
            },
            right: {
              heading: "Auditoria isolada",
              items: [
                "Um órgão, um programa",
                "Olha a própria entrega",
                "Não vê a sobreposição vizinha",
                "Execução mais simples",
              ],
            },
            notes: "Nota do segundo contraste.",
          },
          {
            kind: "closing",
            title: "Pontos-chave do Módulo",
            eyebrow: MODULO,
            bullets: ["A abordagem decide o escopo", "FSD exige visão de conjunto"],
          },
        ],
      },
    ],
  } as never;
}

function renderizar() {
  const { pptx } = renderDeck(PptxFalso as never, deckDeTeste(), {});
  return (pptx as unknown as PptxFalso).slides;
}

/** Quantos slides trazem o nome do módulo como texto solto (a sobrancelha). */
function slidesComRotulo(slides: SlideFalso[]): number[] {
  const alvo = MODULO.toLowerCase();
  return slides
    .map((s, i) => ({ i, bate: s.textos.some((t) => t.trim().toLowerCase() === alvo) }))
    .filter((x) => x.bate)
    .map((x) => x.i);
}

describe("o rótulo do módulo aparece uma vez por módulo", () => {
  it("UMA sobrancelha com o nome do módulo, mesmo com dois slides de contraste", () => {
    const slides = renderizar();
    // Capa, agenda e divisória também carregam o título do módulo por desenho;
    // o que se mede aqui são os slides de CONTEÚDO, depois da divisória.
    const conteudo = slides.slice(3);
    expect(slidesComRotulo(conteudo)).toEqual([0]);
  });

  it("FALSIFICAÇÃO: com m.title no lugar do rótulo, os três slides repetem", () => {
    // O defeito que o deck de 21/11 mostrou: os renderizadores de contraste
    // recebendo m.title marcam TODO slide de contraste, não só a âncora.
    const slides = renderizar();
    const conteudo = slides.slice(3);
    const comRotulo = slidesComRotulo(conteudo);
    expect(comRotulo.length).toBeLessThan(3);
    expect(comRotulo).not.toContain(1);
    expect(comRotulo).not.toContain(2);
  });
});

describe("nenhum slide do deck sai sem nota", () => {
  it("o fechamento do módulo recebe nota, mesmo sem o planejador escrever", () => {
    const slides = renderizar();
    const fechamento = slides[slides.length - 2]; // antes do encerramento do curso
    expect(fechamento.notas.join(" ")).toContain("Pontos-chave do Módulo");
    expect(fechamento.notas.join(" ").toLowerCase()).toContain("não leia a lista");
  });

  it("TODOS os slides têm nota", () => {
    const semNota = renderizar()
      .map((s, i) => ({ i, vazio: !s.notas.join("").trim() }))
      .filter((x) => x.vazio)
      .map((x) => x.i);
    expect(semNota).toEqual([]);
  });

  it("a nota do planejador não é sobrescrita pela de apoio", () => {
    const slides = renderizar();
    expect(slides[3].notas.join(" ")).toBe("Nota escrita pelo planejador.");
  });
});

describe("notaDeApoio só fala dos tipos que chegam sem nota por desenho", () => {
  it("fechamento e tabela recebem texto", () => {
    expect(notaDeApoio("closing", "Pontos-chave", "pt-BR")).not.toBe("");
    expect(notaDeApoio("table", "Trilhas de aprofundamento", "pt-BR")).toContain(
      "Trilhas de aprofundamento",
    );
  });

  it("um slide de conteúdo sem nota devolve vazio — o defeito fica visível", () => {
    // Inventar uma frase genérica aqui esconderia um planejador que parou de
    // escrever notas. O silêncio é o sintoma; não se tapa o sintoma.
    for (const kind of ["bullets", "cards", "steps", "compare", "quote", "chart"]) {
      expect(notaDeApoio(kind, "Qualquer título", "pt-BR"), kind).toBe("");
    }
  });

  it("responde no idioma do deck", () => {
    expect(notaDeApoio("closing", "Key points", "english")).toContain("Do not read the list");
    expect(notaDeApoio("closing", "Puntos clave", "español")).toContain("No lea la lista");
  });
});
