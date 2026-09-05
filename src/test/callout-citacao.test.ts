import { describe, expect, it } from "vitest";
import { renderModuleMarkdown } from "../../supabase/functions/_shared/course-pipeline";

// ═══════════════════════════════════════════════════════════════════════════
// O BLOCO DE DESTAQUE CHEGAVA PARTIDO AO ALUNO
//
// A renderização era `> ${[paragraphs, bullets].join("\n> \n> ")}`: o '>'
// entrava no início e nas duas emendas, e em nenhuma outra linha. Como
// `paragraphs` já traz vários parágrafos e `bullets` uma linha por item, tudo
// a partir do segundo parágrafo saía FORA da citação.
//
// Curso 'Sabor Caseiro', lição 8.2, bloco "A Importância da Revisão Contínua
// do Plano" — como foi entregue:
//
//     > Um plano estratégico de estoques não é um documento estático...
//
//     Estabelecer um ciclo de feedback...          <- escapou
//     >
//     > - O plano deve ser um documento dinâmico e flexível.
//     - Revisões periódicas (ex: trimestrais) são essenciais...   <- escapou
//
// O portão deu ZERO problema naquela lição. É o caso que mostra que "(3→0)"
// mede o que o portão enxerga, não o que o aluno lê.
// ═══════════════════════════════════════════════════════════════════════════

const bloco = (over: Record<string, unknown>) =>
  ({
    id: "b1", type: "callout", heading: "A revisão contínua do plano",
    paragraphs: [], bullets: [], items: [], steps: [], cards: [],
    table: { headers: [], rows: [], caption: "" },
    code: { language: "", code: "", explanation: "" },
    example: { context: "", challenge: "", solution: "", result: "" },
    scenario: { context: "", turns: [] },
    activity: { objective: "", steps: [], deliverable: "", template_rows: [], success_criteria: [] },
    source_ids: [],
    ...over,
  }) as any;

function markdownDoCallout(over: Record<string, unknown>) {
  return renderModuleMarkdown({
    course: { course_title: "Gestão de Estoques", description: "" } as any,
    module: {
      module_number: 1, title: "Módulo 1", role: "core",
      lessons: [{
        lesson_number: "1.1", title: "Lição", objective: "Obj",
        pattern: "conceito", required_block_types: [],
      }],
    } as any,
    document: {
      module_title: "Módulo 1", opening_bridge: "x".repeat(60),
      lessons: [{
        lesson_number: "1.1", title: "Lição", objective: "Objetivo da lição",
        blocks: [bloco(over)],
      }],
      checkpoint: "y".repeat(40), key_takeaways: ["a", "b", "c"],
      media_brief: { purpose: "", concept: "", alt_text: "", generation_prompt: "" },
    } as any,
    moduleIndex: 0, sourceIndex: [], includeOverview: false, includeCapstoneExtras: false,
  });
}

/** Linhas de conteúdo entre o heading do callout e o fim do bloco. */
function linhasDoCallout(md: string): string[] {
  const linhas = md.split("\n");
  const i = linhas.findIndex((l) => l.startsWith("#### A revisão contínua"));
  expect(i, "heading do callout não encontrado").toBeGreaterThan(-1);
  const corpo: string[] = [];
  for (const l of linhas.slice(i + 1)) {
    if (l.startsWith("#") || l.startsWith("---")) break;
    if (l.trim()) corpo.push(l);
  }
  return corpo;
}

describe("bloco de destaque", () => {
  it("todo parágrafo fica dentro da citação, não só o primeiro", () => {
    const corpo = linhasDoCallout(markdownDoCallout({
      paragraphs: [
        "Um plano estratégico de estoques não é um documento estático, e precisa de revisão.",
        "Estabelecer um ciclo de feedback é crucial para o sucesso a longo prazo do negócio.",
      ],
    }));
    for (const linha of corpo) {
      expect(linha, `linha fora da citação: ${linha}`).toMatch(/^>/);
    }
    expect(corpo.join("\n")).toContain("Estabelecer um ciclo de feedback");
  });

  it("todo bullet fica dentro da citação, não só o primeiro", () => {
    const corpo = linhasDoCallout(markdownDoCallout({
      paragraphs: ["A revisão periódica do plano protege o negócio contra sazonalidade."],
      bullets: [
        "O plano deve ser um documento dinâmico e flexível",
        "Revisões trimestrais são essenciais para ajustar o plano",
        "O acompanhamento dos indicadores permite corrigir desvios",
      ],
    }));
    for (const linha of corpo) {
      expect(linha, `linha fora da citação: ${linha}`).toMatch(/^>/);
    }
    // Os três bullets sobrevivem; o defeito não era perder texto, era soltá-lo.
    expect(corpo.filter((l) => l.includes("- ")).length).toBe(3);
  });

  it("parágrafos e bullets juntos — o caso exato do curso entregue", () => {
    const corpo = linhasDoCallout(markdownDoCallout({
      paragraphs: [
        "Um plano estratégico de estoques não é um documento estático, deve ser revisado.",
        "Estabelecer um ciclo de feedback é crucial para o sucesso a longo prazo.",
      ],
      bullets: [
        "O plano deve ser um documento dinâmico e flexível",
        "Revisões periódicas são essenciais para ajustar o plano ao mercado",
      ],
    }));
    expect(corpo.every((l) => l.startsWith(">"))).toBe(true);
  });
});
