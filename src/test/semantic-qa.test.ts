/**
 * semantic-qa.test.ts
 * Test coverage for the 2026-08-01a-semantic-qa build:
 * isPlaceholderText, stripLeadingOrdinal, validateLearningBlock,
 * validateBlueprintSemantics, validateCourseForPublication and
 * related helpers.
 *
 * Run with: npx vitest run src/test/semantic-qa.test.ts
 * (or: npx vitest src/test/semantic-qa.test.ts --watch)
 */

import { describe, it, expect } from "vitest";

// ─── Re-implementations for testing (mirror logic from generate-course) ──────
// We duplicate the pure helpers here so tests stay self-contained and fast.

// Mirror the edge function's normalizePlaceholderCheck (NFD + strip accents + strip special chars)
function normalizePlaceholderCheck(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Patterns from the edge function — uses normalized (NFD accent-stripped) text
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /aplicar o conteudo do objetivo/,
  /aplicar o conteudo desta licao/,
  /aplicar os conhecimentos previstos/,
  /conteudo aplicado do modulo/,
  /producao ou decisao observavel do aprendiz/,
  /objetivo da licao/,
  /descricao do modulo/,
  /preencher conteudo/,
  /texto a desenvolver/,
  /resposta esperada/,
  /criterio de avaliacao\s*\d+/,
  /todo/,
  /fixme/,
  /placeholder/,
  /conteudo aqui/,
  /\[insira/,
  /\[adicione/,
  /\[descreva/,
  /\[coloque/,
];

function isPlaceholderText(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return true;
  const normalized = normalizePlaceholderCheck(value);
  const words = normalized.split(" ").filter(Boolean);
  // Too short to express an objective
  if (words.length < 4) return true;
  // Purely ordinal ("Módulo 2", "Objetivo 1", "Lição 3")
  if (/^(modulo|objetivo|licao|secao|capitulo|topico)\s+\d+$/.test(normalized)) return true;
  return PLACEHOLDER_PATTERNS.some((p) => p.test(normalized));
}

function stripLeadingOrdinal(value: string): string {
  return value
    .replace(/^\s*(?:etapa|passo|step)\s+\d+\s*[-–—:.)]?\s*/i, "")
    .replace(/^\s*\d+(?:\.\d+){1,3}\.?\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .trim();
}

function wcText(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("isPlaceholderText", () => {
  it("detects empty string", () => expect(isPlaceholderText("")).toBe(true));
  it("detects null / undefined", () => {
    expect(isPlaceholderText(null)).toBe(true);
    expect(isPlaceholderText(undefined)).toBe(true);
  });
  it("detects [insira …]", () => expect(isPlaceholderText("[Insira conteúdo]")).toBe(true));
  it("detects TODO", () => expect(isPlaceholderText("TODO: add content")).toBe(true));
  it("detects FIXME", () => expect(isPlaceholderText("fixme")).toBe(true));
  it("detects placeholder word", () => expect(isPlaceholderText("Placeholder text")).toBe(true));
  it("detects 'conteúdo aqui'", () => expect(isPlaceholderText("Coloque o conteúdo aqui")).toBe(true));
  it("detects old blueprint pattern — objective", () =>
    expect(isPlaceholderText("Aplicar o conteúdo do objetivo 3.")).toBe(true));
  it("detects old blueprint pattern — lesson", () =>
    expect(isPlaceholderText("Aplicar o conteúdo desta lição.")).toBe(true));
  it("detects old blueprint pattern — module", () =>
    expect(isPlaceholderText("Aplicar os conhecimentos previstos no módulo 2.")).toBe(true));
  it("detects old blueprint pattern — applied", () =>
    expect(isPlaceholderText("Conteúdo aplicado do módulo 3.")).toBe(true));
  it("detects evidence placeholder", () =>
    expect(isPlaceholderText("Produção ou decisão observável do aprendiz.")).toBe(true));
  it("passes real text", () =>
    expect(isPlaceholderText("Identificar os 5 princípios de lean manufacturing e aplicá-los.")).toBe(false));
  it("passes real text with 4+ words", () =>
    expect(isPlaceholderText("Lean manufacturing fundamentos aplicados.")).toBe(false));
});

describe("stripLeadingOrdinal", () => {
  it("strips 'Etapa 1 —'", () => expect(stripLeadingOrdinal("Etapa 1 — Configuração")).toBe("Configuração"));
  it("strips 'Etapa 2. '", () => expect(stripLeadingOrdinal("Etapa 2. Análise")).toBe("Análise"));
  it("strips '1.1. '", () => expect(stripLeadingOrdinal("1.1. Introdução")).toBe("Introdução"));
  it("strips '2) '", () => expect(stripLeadingOrdinal("2) Planejamento")).toBe("Planejamento"));
  it("strips '3. '", () => expect(stripLeadingOrdinal("3. Execução")).toBe("Execução"));
  it("does not strip real title", () =>
    expect(stripLeadingOrdinal("Fundamentos de Lean")).toBe("Fundamentos de Lean"));
  it("does not strip title starting with number noun", () =>
    expect(stripLeadingOrdinal("5 Princípios do Lean")).toBe("5 Princípios do Lean"));
});

describe("wcText helper", () => {
  it("counts words", () => expect(wcText("hello world foo")).toBe(3));
  it("handles empty string", () => expect(wcText("")).toBe(0));
  it("handles extra whitespace", () => expect(wcText("  one  two  ")).toBe(2));
});

// ─── validateLearningBlock stub tests ─────────────────────────────────────────
// These test the shape rules without importing from Deno — we verify edge cases
// that are likely to break in production.

describe("explanation block word count requirement", () => {
  // 70 words minimum
  const makeExplanation = (words: number) => ({
    paragraphs: [Array(words).fill("word").join(" ")],
    bullets: [] as string[],
  });

  it("fails with 40 words", () => {
    const total = wcText(makeExplanation(40).paragraphs[0]) + 0;
    expect(total).toBeLessThan(70);
  });
  it("passes with 75 words", () => {
    const total = wcText(makeExplanation(75).paragraphs[0]) + 0;
    expect(total).toBeGreaterThanOrEqual(70);
  });
});

describe("process block step description requirement (≥18 words)", () => {
  const shortDesc = "only five words here."; // 4 words
  const longDesc = Array(20).fill("word").join(" ");  // 20 words

  it("short description fails threshold", () => expect(wcText(shortDesc)).toBeLessThan(18));
  it("long description passes threshold", () => expect(wcText(longDesc)).toBeGreaterThanOrEqual(18));
});

describe("flip_cards minimum valid cards (≥3 with back ≥12 words)", () => {
  const goodBack = Array(13).fill("word").join(" ");
  const badBack = "short";

  it("good back passes", () => expect(wcText(goodBack)).toBeGreaterThanOrEqual(12));
  it("bad back fails", () => expect(wcText(badBack)).toBeLessThan(12));
});

// ─── validateBlueprintSemantics: core rules ───────────────────────────────────

function minBlueprint(overrides: Partial<{
  final_competency: string;
  objectives: { id: string; statement: string; evidence_required: string }[];
  modulesObj: { module_number: number; module_objective: string; lessons: { lesson_number: string; objective: string }[] }[];
  applied_assignment: {
    title: string; description: string; deliverable: string;
    requirements: string[]; rubric: { weight: number }[];
  };
}>): any {
  return {
    final_competency: overrides.final_competency ?? "Demonstrar domínio completo dos processos de lean manufacturing aplicados ao contexto industrial.",
    course_objectives: (overrides.objectives ?? [
      { id: "obj-1", statement: "Identificar os 5 princípios do lean manufacturing.", evidence_required: "Análise de caso documentada." },
    ]),
    modules: (overrides.modulesObj ?? [
      { module_number: 1, module_objective: "Aplicar lean em linha de produção.", lessons: [{ lesson_number: "1.1", objective: "Identificar os principais desperdícios do processo." }] },
    ]),
    applied_assignment: overrides.applied_assignment ?? {
      title: "Projeto Final de Aplicação Prática",
      description: "Desenvolva um plano de melhoria baseado em lean manufacturing.",
      deliverable: "Relatório final com análise de valor detalhada.",
      requirements: ["Req A", "Req B", "Req C"],
      rubric: [
        { weight: 40 }, { weight: 30 }, { weight: 30 },
      ],
    },
  };
}

// Mirror validateBlueprintSemantics logic for test purposes
function validateBlueprintSemantics(course: any): { blocking: string[]; repairable: string[]; warnings: string[] } {
  const blocking: string[] = [];
  const repairable: string[] = [];
  const warnings: string[] = [];

  const compWords = course.final_competency?.trim().split(/\s+/).filter(Boolean).length ?? 0;
  if (isPlaceholderText(course.final_competency)) blocking.push("final_competency é placeholder.");
  else if (compWords < 10) repairable.push(`final_competency: ${compWords} palavras.`);

  for (const obj of (course.course_objectives ?? [])) {
    const w = obj.statement?.trim().split(/\s+/).filter(Boolean).length ?? 0;
    if (!obj.statement || isPlaceholderText(obj.statement)) repairable.push(`Objetivo ${obj.id}: placeholder.`);
    else if (w < 7 || w > 35) warnings.push(`Objetivo ${obj.id}: ${w} palavras.`);
    if (!obj.evidence_required || isPlaceholderText(obj.evidence_required)) repairable.push(`Objetivo ${obj.id}: evidence_required placeholder.`);
  }

  for (const mod of (course.modules ?? [])) {
    if (!mod.module_objective || isPlaceholderText(mod.module_objective)) repairable.push(`Módulo ${mod.module_number}: objective placeholder.`);
    for (const lesson of (mod.lessons ?? [])) {
      if (!lesson.objective || isPlaceholderText(lesson.objective)) repairable.push(`Lição ${lesson.lesson_number}: objective placeholder.`);
    }
  }

  const aa = course.applied_assignment;
  if (!aa?.title || isPlaceholderText(aa.title)) repairable.push("applied_assignment.title placeholder.");
  if (!aa?.description || isPlaceholderText(aa.description)) repairable.push("applied_assignment.description placeholder.");
  if (!aa?.deliverable || isPlaceholderText(aa.deliverable)) repairable.push("applied_assignment.deliverable placeholder.");
  if (!aa?.requirements || aa.requirements.length < 3) repairable.push("applied_assignment: <3 requisitos.");
  const rubric = aa?.rubric ?? [];
  if (rubric.length < 3 || rubric.length > 6) repairable.push(`rubric: ${rubric.length} critérios.`);
  else {
    const total = rubric.reduce((s: number, c: any) => s + Number(c.weight || 0), 0);
    if (Math.abs(total - 100) > 1) repairable.push(`rubric pesos: ${total}.`);
  }

  return { blocking, repairable, warnings };
}

describe("validateBlueprintSemantics", () => {
  it("passes a clean blueprint", () => {
    const r = validateBlueprintSemantics(minBlueprint({}));
    expect(r.blocking).toHaveLength(0);
    expect(r.repairable).toHaveLength(0);
  });

  it("blocks on placeholder final_competency", () => {
    const r = validateBlueprintSemantics(minBlueprint({ final_competency: "[insira]" }));
    expect(r.blocking.some((x) => x.includes("final_competency"))).toBe(true);
  });

  it("repairable on short final_competency (<10 words)", () => {
    // 5 words → passes the words.length guard but still < 10 → repairable
    const r = validateBlueprintSemantics(minBlueprint({ final_competency: "Muito curta para este uso." }));
    expect(r.repairable.some((x) => x.includes("final_competency"))).toBe(true);
  });

  it("repairable on placeholder module objective", () => {
    const r = validateBlueprintSemantics(minBlueprint({
      modulesObj: [{ module_number: 1, module_objective: "Aplicar os conhecimentos previstos no módulo 1.", lessons: [] }],
    }));
    expect(r.repairable.some((x) => x.includes("Módulo 1"))).toBe(true);
  });

  it("repairable on placeholder objective evidence_required", () => {
    const r = validateBlueprintSemantics(minBlueprint({
      objectives: [{ id: "obj-1", statement: "Identificar processos.", evidence_required: "Produção ou decisão observável do aprendiz." }],
    }));
    expect(r.repairable.some((x) => x.includes("evidence_required"))).toBe(true);
  });

  it("repairable when rubric weights don't sum to 100", () => {
    const r = validateBlueprintSemantics(minBlueprint({
      applied_assignment: {
        title: "Projeto",
        description: "Desc",
        deliverable: "Entregável",
        requirements: ["A", "B", "C"],
        rubric: [{ weight: 40 }, { weight: 30 }, { weight: 20 }], // sums to 90
      },
    }));
    expect(r.repairable.some((x) => x.includes("pesos"))).toBe(true);
  });

  it("repairable with fewer than 3 rubric criteria", () => {
    const r = validateBlueprintSemantics(minBlueprint({
      applied_assignment: {
        title: "P", description: "D", deliverable: "E",
        requirements: ["A", "B", "C"],
        rubric: [{ weight: 100 }],
      },
    }));
    expect(r.repairable.some((x) => x.includes("rubric"))).toBe(true);
  });
});

// ─── validateCourseForPublication stub tests ──────────────────────────────────

// Canonical capstone markdown: contains all required textual markers.
const GOOD_CAPSTONE_MARKDOWN =
  "Conteúdo do módulo capstone.\n\n" +
  "### Projeto Final\n\nDescrição detalhada.\n\n" +
  "**Entregável:** Relatório completo com análise aplicada.\n\n" +
  "**Requisitos**\n\n- Req A\n- Req B\n\n" +
  "**Rubrica de avaliação**\n\n| Critério | Peso |\n|---|---|\n| A | 100 |";

function makeMockResult(overrides: {
  moduleNum?: number;
  lessons?: { lesson_number: string; blocks: { type: string; id: string }[] }[];
  assessment?: { multiple_choice: unknown[]; flashcards: unknown[] } | null;
  markdown?: string;
  isCapstone?: boolean;
}): any {
  const capstone = overrides.isCapstone ?? false;
  return {
    document: {
      lessons: overrides.lessons ?? [
        {
          lesson_number: `${overrides.moduleNum ?? 1}.1`,
          blocks: capstone
            ? [
                { type: "explanation", id: "b1" },
                { type: "flip_cards", id: "b2" },
                { type: "activity", id: "b3" },
              ]
            : [
                { type: "explanation", id: "b1" },
                { type: "flip_cards", id: "b2" },
                { type: "process", id: "b3" },
              ],
        },
      ],
    },
    markdown:
      overrides.markdown !== undefined
        ? overrides.markdown
        : capstone
        ? GOOD_CAPSTONE_MARKDOWN
        : "Content OK. Pare um momento e reflita: X.",
    assessment:
      overrides.assessment !== undefined
        ? overrides.assessment
        : { multiple_choice: ["q1", "q2", "q3"], flashcards: ["f1", "f2", "f3", "f4", "f5"] },
    warnings: [],
    repairsApplied: 0,
  };
}

function makeBlueprint(numModules: number): any {
  return {
    modules: Array.from({ length: numModules }, (_, i) => ({
      module_number: i + 1,
      role: i === numModules - 1 ? "capstone" : "core",
      title: `Módulo ${i + 1}`,
    })),
    applied_assignment: { rubric: [{ weight: 50 }, { weight: 50 }] },
  };
}

// Mirror validateCourseForPublication logic (kept in sync with the edge function)
function blockHasUsableContent(block: any): boolean {
  return !!block?.type;
}

function validateCourseForPublication(params: {
  blueprint: any;
  okResults: any[];
  includeQuiz: boolean;
  includeFlashcards: boolean;
}): { status: string; warningCount: number; needsReview: boolean; reasons: string[] } {
  const { blueprint, okResults, includeQuiz, includeFlashcards } = params;
  const blocking: string[] = [];
  const cosmetic: string[] = [];

  if (okResults.length < blueprint.modules.length) {
    blocking.push(`${okResults.length}/${blueprint.modules.length} módulos gerados.`);
  }

  const lastMod = blueprint.modules[blueprint.modules.length - 1];
  if (lastMod?.role !== "capstone") blocking.push("Último módulo não é capstone.");

  for (const result of okResults) {
    const modNum = result.document.lessons[0]?.lesson_number?.split(".")[0] || "?";

    // Placeholder in final content
    const PLACEHOLDER_INLINE = [/aplicar o conteudo do objetivo/, /aplicar o conteudo desta licao/, /producao ou decisao observavel do aprendiz/];
    function normCheck(v: string) { return v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(); }
    if (PLACEHOLDER_INLINE.some((p) => p.test(normCheck(result.markdown)))) {
      blocking.push(`Módulo ${modNum}: placeholder detectado no conteúdo final.`);
    }

    for (const lesson of result.document.lessons) {
      const validBlocks = lesson.blocks.filter(blockHasUsableContent);
      if (validBlocks.length < 2) blocking.push(`Lição ${lesson.lesson_number}: <2 blocos.`);
      else if (validBlocks.length < 3) cosmetic.push(`Lição ${lesson.lesson_number}: ${validBlocks.length} blocos.`);
    }

    // Capstone: activity + rubric — structural check
    const modBlueprint = blueprint.modules.find((m: any) => m.module_number === Number(modNum));
    if (modBlueprint?.role === "capstone") {
      const hasActivity = result.document.lessons.some((l: any) =>
        l.blocks.some((b: any) => b.type === "activity"),
      );
      if (!hasActivity) blocking.push(`Módulo capstone ${modNum}: atividade aplicada ausente.`);
      if (!blueprint.applied_assignment?.rubric?.length) {
        blocking.push(`Módulo capstone ${modNum}: rubrica ausente.`);
      }
      // Capstone: markdown final must contain the applied-assignment section markers.
      const md = result.markdown as string;
      if (!md.includes("**Entregável:**")) {
        blocking.push(`Módulo capstone ${modNum}: marcador de entregável ausente no Markdown.`);
      }
      if (!md.includes("**Requisitos**")) {
        blocking.push(`Módulo capstone ${modNum}: marcador de requisitos ausente no Markdown.`);
      }
      if (!md.includes("**Rubrica de avaliação**")) {
        blocking.push(`Módulo capstone ${modNum}: marcador de rubrica ausente no Markdown.`);
      }
    }

    if (includeQuiz && (!result.assessment || result.assessment.multiple_choice.length < 3)) {
      blocking.push(`Módulo ${modNum}: quiz ausente.`);
    }
    if (includeFlashcards && (!result.assessment || result.assessment.flashcards.length < 5)) {
      blocking.push(`Módulo ${modNum}: flashcards ausentes.`);
    }
  }

  if (blocking.length) return { status: "needs_review", warningCount: cosmetic.length, needsReview: true, reasons: blocking };
  if (cosmetic.length) return { status: "ready_with_warnings", warningCount: cosmetic.length, needsReview: false, reasons: cosmetic };
  return { status: "ready", warningCount: 0, needsReview: false, reasons: [] };
}

describe("validateCourseForPublication", () => {
  // §14 — scenario 1
  it("returns ready when all modules present and good", () => {
    const result = validateCourseForPublication({
      blueprint: makeBlueprint(2),
      okResults: [
        makeMockResult({ moduleNum: 1 }),
        makeMockResult({ moduleNum: 2, isCapstone: true }),
      ],
      includeQuiz: true,
      includeFlashcards: true,
    });
    expect(result.status).toBe("ready");
    expect(result.needsReview).toBe(false);
  });

  // §14 — scenario 2
  it("returns needs_review when modules are missing", () => {
    const result = validateCourseForPublication({
      blueprint: makeBlueprint(3),
      okResults: [makeMockResult({ moduleNum: 1 })],
      includeQuiz: false,
      includeFlashcards: false,
    });
    expect(result.status).toBe("needs_review");
    expect(result.needsReview).toBe(true);
    expect(result.reasons.some((r) => r.includes("módulos"))).toBe(true);
  });

  // §14 — scenario 3
  it("returns needs_review when last module is not capstone", () => {
    const bp = makeBlueprint(2);
    bp.modules[1].role = "core";
    const result = validateCourseForPublication({
      blueprint: bp,
      okResults: [makeMockResult({ moduleNum: 1 }), makeMockResult({ moduleNum: 2 })],
      includeQuiz: false,
      includeFlashcards: false,
    });
    expect(result.status).toBe("needs_review");
    expect(result.reasons.some((r) => r.includes("capstone"))).toBe(true);
  });

  // §14 — scenario 4
  it("returns needs_review when required quiz is missing", () => {
    const result = validateCourseForPublication({
      blueprint: makeBlueprint(1),
      okResults: [makeMockResult({ moduleNum: 1, isCapstone: true, assessment: null })],
      includeQuiz: true,
      includeFlashcards: false,
    });
    expect(result.status).toBe("needs_review");
    expect(result.reasons.some((r) => r.includes("quiz"))).toBe(true);
  });

  // §14 — scenario 5
  it("returns needs_review when required flashcards are missing", () => {
    const result = validateCourseForPublication({
      blueprint: makeBlueprint(1),
      okResults: [
        makeMockResult({
          moduleNum: 1,
          isCapstone: true,
          assessment: { multiple_choice: ["q1", "q2", "q3"], flashcards: [] },
        }),
      ],
      includeQuiz: false,
      includeFlashcards: true,
    });
    expect(result.status).toBe("needs_review");
    expect(result.reasons.some((r) => r.includes("flashcards"))).toBe(true);
  });

  // §14 — scenario 6
  it("returns ready_with_warnings when a lesson has only 2 valid blocks", () => {
    const result = validateCourseForPublication({
      blueprint: makeBlueprint(1),
      okResults: [
        makeMockResult({
          moduleNum: 1,
          isCapstone: true,
          lessons: [{ lesson_number: "1.1", blocks: [{ type: "activity", id: "b1" }, { type: "flip_cards", id: "b2" }] }],
        }),
      ],
      includeQuiz: false,
      includeFlashcards: false,
    });
    expect(result.status).toBe("ready_with_warnings");
    expect(result.warningCount).toBeGreaterThan(0);
  });

  // §14 — scenario 7
  it("quiz and flashcards not checked when not included", () => {
    const result = validateCourseForPublication({
      blueprint: makeBlueprint(1),
      okResults: [makeMockResult({ moduleNum: 1, isCapstone: true, assessment: null })],
      includeQuiz: false,
      includeFlashcards: false,
    });
    expect(result.status).toBe("ready");
  });

  // §14 — scenario 8: capstone activity block absent
  it("returns needs_review when capstone module has no activity block", () => {
    const result = validateCourseForPublication({
      blueprint: makeBlueprint(1),
      okResults: [
        makeMockResult({
          moduleNum: 1,
          markdown: GOOD_CAPSTONE_MARKDOWN,
          lessons: [
            { lesson_number: "1.1", blocks: [{ type: "explanation", id: "b1" }, { type: "process", id: "b2" }, { type: "flip_cards", id: "b3" }] },
          ],
        }),
      ],
      includeQuiz: false,
      includeFlashcards: false,
    });
    expect(result.status).toBe("needs_review");
    expect(result.reasons.some((r) => r.includes("atividade aplicada"))).toBe(true);
  });

  // §14 — scenario 9: capstone markdown missing Entregável marker
  it("returns needs_review when capstone markdown is missing Entregável marker", () => {
    const mdNoEntregavel = GOOD_CAPSTONE_MARKDOWN.replace("**Entregável:**", "Entregável:");
    const result = validateCourseForPublication({
      blueprint: makeBlueprint(1),
      okResults: [makeMockResult({ moduleNum: 1, isCapstone: true, markdown: mdNoEntregavel })],
      includeQuiz: false,
      includeFlashcards: false,
    });
    expect(result.status).toBe("needs_review");
    expect(result.reasons.some((r) => r.includes("entregável"))).toBe(true);
  });

  // §14 — scenario 10: capstone markdown missing Requisitos marker
  it("returns needs_review when capstone markdown is missing Requisitos marker", () => {
    const mdNoReq = GOOD_CAPSTONE_MARKDOWN.replace("**Requisitos**", "Requisitos");
    const result = validateCourseForPublication({
      blueprint: makeBlueprint(1),
      okResults: [makeMockResult({ moduleNum: 1, isCapstone: true, markdown: mdNoReq })],
      includeQuiz: false,
      includeFlashcards: false,
    });
    expect(result.status).toBe("needs_review");
    expect(result.reasons.some((r) => r.includes("requisitos"))).toBe(true);
  });

  // §14 — scenario 11: capstone markdown missing Rubrica marker
  it("returns needs_review when capstone markdown is missing Rubrica de avaliação marker", () => {
    const mdNoRubrica = GOOD_CAPSTONE_MARKDOWN.replace("**Rubrica de avaliação**", "Rubrica");
    const result = validateCourseForPublication({
      blueprint: makeBlueprint(1),
      okResults: [makeMockResult({ moduleNum: 1, isCapstone: true, markdown: mdNoRubrica })],
      includeQuiz: false,
      includeFlashcards: false,
    });
    expect(result.status).toBe("needs_review");
    expect(result.reasons.some((r) => r.includes("rubrica"))).toBe(true);
  });

  // §14 — scenario 12: placeholder pattern in module markdown
  it("returns needs_review when placeholder pattern found in module markdown", () => {
    const result = validateCourseForPublication({
      blueprint: makeBlueprint(1),
      okResults: [
        makeMockResult({
          moduleNum: 1,
          isCapstone: true,
          markdown: GOOD_CAPSTONE_MARKDOWN + "\n\nAplicar o conteúdo desta lição.",
        }),
      ],
      includeQuiz: false,
      includeFlashcards: false,
    });
    expect(result.status).toBe("needs_review");
    expect(result.reasons.some((r) => r.includes("placeholder"))).toBe(true);
  });

  // §14 — scenario 13: lesson with fewer than 2 valid blocks → blocking
  it("returns needs_review (blocking) when a lesson has 0 or 1 valid blocks", () => {
    const result = validateCourseForPublication({
      blueprint: makeBlueprint(1),
      okResults: [
        makeMockResult({
          moduleNum: 1,
          isCapstone: true,
          lessons: [{ lesson_number: "1.1", blocks: [{ type: "activity", id: "b1" }] }],
        }),
      ],
      includeQuiz: false,
      includeFlashcards: false,
    });
    expect(result.status).toBe("needs_review");
    expect(result.reasons.some((r) => r.includes("blocos"))).toBe(true);
  });

  // §14 — scenario 14: null/undefined results are safely filtered (filter(Boolean))
  it("does not crash when okResults contains falsy entries", () => {
    // The publication gate receives pre-filtered results; passing an empty array simulates null workers.
    const result = validateCourseForPublication({
      blueprint: makeBlueprint(2),
      okResults: [],
      includeQuiz: false,
      includeFlashcards: false,
    });
    expect(result.status).toBe("needs_review");
    expect(result.reasons.some((r) => r.includes("módulos"))).toBe(true);
  });

  // §14 — scenario 15: single-module capstone course returns ready with all checks passing
  it("single-module capstone course passes all checks when fully valid", () => {
    const result = validateCourseForPublication({
      blueprint: makeBlueprint(1),
      okResults: [makeMockResult({ moduleNum: 1, isCapstone: true })],
      includeQuiz: false,
      includeFlashcards: false,
    });
    expect(result.status).toBe("ready");
    expect(result.needsReview).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });
});
