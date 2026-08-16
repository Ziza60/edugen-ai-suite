import { describe, expect, it } from "vitest";
import {
  appendInteractiveLearningBlocks,
  createFallbackAssessmentPack,
  createDomainSpecificActivity,
  evaluateSourceCoverage,
  extractLearningObjectives,
  findBestInstructionalEvidence,
  markUnsupportedStatisticsAsHypothetical,
  normalizeCourseMapTitles,
  safeJsonParse,
  stripInternalEdugenBlocks,
  validateModuleQuality,
  validateModuleSequenceReferences,
  validateCourseSequenceIntegrity,
  repairModuleSequenceReferences,
} from "../../supabase/functions/_shared/course-quality";

const moduleMarkdown = `## Módulo Teste

### 🎯 Objetivo do Módulo
- Aplicar técnicas de diagnóstico em um cenário real.
- Avaliar riscos com critérios objetivos.
- Criar um plano de ação mensurável.

### 🧠 Fundamentos
Diagnóstico, risco e plano de ação são componentes essenciais para decisões melhores em equipes corporativas.
`;

describe("course-quality helpers", () => {
  it("extracts measurable objectives with cognitive levels", () => {
    const objectives = extractLearningObjectives(moduleMarkdown);
    expect(objectives).toHaveLength(3);
    expect(objectives[0].cognitiveLevel).toBe("apply");
    expect(objectives[1].cognitiveLevel).toBe("evaluate");
    expect(objectives[2].cognitiveLevel).toBe("create");
  });

  it("parses fenced JSON safely and falls back on invalid JSON", () => {
    expect(
      safeJsonParse<{ ok: boolean }>('```json\n{"ok":true}\n```', { ok: false })
        .ok,
    ).toBe(true);
    expect(safeJsonParse("not json", { ok: false }).ok).toBe(false);
  });

  it("creates fallback assessments, flashcards, activity and scenario", () => {
    const pack = createFallbackAssessmentPack("Diagnóstico", moduleMarkdown);
    expect(pack.assessments.length).toBeGreaterThanOrEqual(3);
    expect(pack.flashcards[0].tags.length).toBeGreaterThan(0);
    expect(pack.activity.rubric.length).toBeGreaterThanOrEqual(3);
    expect(pack.scenario.choices.length).toBeGreaterThanOrEqual(2);
  });

  it("runs a minimal QA gate and appends interactive blocks", () => {
    const pack = createFallbackAssessmentPack(
      "Diagnóstico",
      moduleMarkdown.repeat(20),
    );
    const module = {
      title: "Diagnóstico",
      content: moduleMarkdown.repeat(20),
      sourceCoverage: evaluateSourceCoverage(moduleMarkdown, ""),
      ...pack,
    };
    const qa = validateModuleQuality(module);
    expect(qa.score).toBeGreaterThan(60);
    const enhanced = appendInteractiveLearningBlocks(module, qa);
    // Matriz Objetivo-Conteúdo-Avaliação is intentionally NOT appended to
    // student-visible content (QA score goes to console.log only, and
    // stripInternalEdugenBlocks would strip it from PDF anyway).
    expect(enhanced).not.toContain("Matriz Objetivo-Conteúdo-Avaliação");
    expect(enhanced).toContain("Atividade Prática Avaliável");
    expect(enhanced).toContain("Cenário Ramificado");
  });

  it("detects low source coverage when source mode is required", () => {
    const coverage = evaluateSourceCoverage(
      "conteúdo sobre vendas",
      "python pandas dataframe numpy regressao clusterizacao",
    );
    expect(coverage.required).toBe(true);
    expect(coverage.score).toBeLessThan(0.25);
  });
});

describe("course sequence integrity gate", () => {
  it("flags FIRST_MODULE_BACKWARD_REF when module 0 says 'no módulo anterior'", () => {
    const content = "No módulo anterior aprendemos sobre Python. Aqui vamos aprofundar.";
    const issues = validateModuleSequenceReferences(content, 0, 3, ["M1", "M2", "M3"]);
    expect(issues.some((i) => i.code === "FIRST_MODULE_BACKWARD_REF")).toBe(true);
    expect(issues.some((i) => i.severity === "critical")).toBe(true);
  });

  it("flags FIRST_MODULE_BACKWARD_REF when module 0 says 'você já explorou'", () => {
    const content = "Você já explorou os fundamentos de variáveis, agora veja funções.";
    const issues = validateModuleSequenceReferences(content, 0, 4, ["M1", "M2", "M3", "M4"]);
    expect(issues.some((i) => i.code === "FIRST_MODULE_BACKWARD_REF")).toBe(true);
  });

  it("flags MODULE_RANGE_OUT_OF_BOUNDS when 'Módulos 1 a 4' in 3-module course", () => {
    const content = "Ao longo dos Módulos 1 a 4 vimos os conceitos principais.";
    const issues = validateModuleSequenceReferences(content, 1, 3, ["M1", "M2", "M3"]);
    expect(issues.some((i) => i.code === "MODULE_RANGE_OUT_OF_BOUNDS")).toBe(true);
    expect(issues.some((i) => i.severity === "critical")).toBe(true);
  });

  it("flags LAST_MODULE_FORWARD_REF when last module promises 'no próximo módulo'", () => {
    const content = "No próximo módulo vamos explorar tópicos avançados de OOP.";
    const issues = validateModuleSequenceReferences(content, 2, 3, ["M1", "M2", "M3"]);
    expect(issues.some((i) => i.code === "LAST_MODULE_FORWARD_REF")).toBe(true);
    expect(issues.some((i) => i.severity === "critical")).toBe(true);
  });

  it("repair fixes 'Módulos 1 a 4' → 'módulos anteriores' in 3-module course", () => {
    const content = "Ao longo dos Módulos 1 a 4 vimos os conceitos principais.";
    const repaired = repairModuleSequenceReferences(content, 1, 3);
    expect(repaired).toContain("módulos anteriores");
    expect(repaired).not.toMatch(/Módulos\s+1\s+a\s+4/i);
  });

  it("validateCourseSequenceIntegrity returns passed=false when a module references a non-existent module number", () => {
    const modules = [
      { title: "Introdução", content: "Bem-vindo ao curso. Aqui começamos do zero.", order_index: 0 },
      { title: "Intermediário", content: "No Módulo 5 veremos tópicos avançados.", order_index: 1 },
      { title: "Avançado", content: "Aqui integramos tudo que aprendemos.", order_index: 2 },
    ];
    const report = validateCourseSequenceIntegrity(modules);
    expect(report.passed).toBe(false);
    expect(report.issuesByModule.length).toBeGreaterThan(0);
  });

  it("validateCourseSequenceIntegrity returns passed=true for a consistent course", () => {
    const modules = [
      { title: "Introdução", content: "Bem-vindo ao curso. Vamos explorar os fundamentos.", order_index: 0 },
      { title: "Conceitos", content: "Como vimos no Módulo 1, os fundamentos são essenciais. Aqui aprofundamos.", order_index: 1 },
      { title: "Aplicação", content: "Integrando o Módulo 1 e o Módulo 2, agora aplicamos na prática.", order_index: 2 },
    ];
    const report = validateCourseSequenceIntegrity(modules);
    expect(report.passed).toBe(true);
    expect(report.score).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: stripInternalEdugenBlocks
// ─────────────────────────────────────────────────────────────────────────────

describe("stripInternalEdugenBlocks", () => {
  it("removes Matriz Objetivo-Conteúdo-Avaliação heading and its body", () => {
    const input = `## Fundamentos\n\nConteúdo legítimo aqui.\n\n### 🧭 Matriz Objetivo-Conteúdo-Avaliação\n\n| Objetivo | Conteúdo | Avaliação |\n|---|---|---|\n| Aplicar X | Seção 2 | Exercício |\n\n## Próximo Módulo\n\nTópico legítimo.`;
    const result = stripInternalEdugenBlocks(input);
    expect(result).not.toContain("Matriz Objetivo");
    expect(result).not.toContain("| Objetivo |");
    expect(result).toContain("Conteúdo legítimo aqui.");
    expect(result).toContain("Tópico legítimo.");
  });

  it("removes Nota de Qualidade EduGen heading and its body", () => {
    const input = `### Conceitos\n\nTexto educacional.\n\n### 🧪 Nota de Qualidade EduGen\n\n- Score do módulo: 85/100\n- WARNING: slide 3 tem densidade alta\n\n### Atividade\n\nFaça o exercício.`;
    const result = stripInternalEdugenBlocks(input);
    expect(result).not.toContain("Nota de Qualidade EduGen");
    expect(result).not.toContain("Score do módulo");
    expect(result).not.toContain("WARNING");
    expect(result).toContain("Texto educacional.");
    expect(result).toContain("Faça o exercício.");
  });

  it("removes Score do módulo lines even when outside a heading block", () => {
    const input = `### Resumo\n\nAprendemos muito.\n- Score do módulo: 92/100\n- CRITICAL: objetivo vago\nFim do conteúdo.`;
    const result = stripInternalEdugenBlocks(input);
    expect(result).not.toContain("Score do módulo");
    expect(result).not.toContain("CRITICAL:");
    expect(result).toContain("Aprendemos muito.");
    expect(result).toContain("Fim do conteúdo.");
  });

  it("preserves genuine pedagogical content untouched", () => {
    const input = `## Módulo 1\n\nObjetivo: aplicar COSO na prática.\n\n### Atividade\n\nElabore uma matriz risco-controle.`;
    const result = stripInternalEdugenBlocks(input);
    expect(result).toBe(input.trim());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: markUnsupportedStatisticsAsHypothetical
// ─────────────────────────────────────────────────────────────────────────────

describe("markUnsupportedStatisticsAsHypothetical", () => {
  it("wraps bullet with strong percentage claim in hypothetical qualifier", () => {
    const input = `- 80% de redução nos erros após a implantação do controle.`;
    const result = markUnsupportedStatisticsAsHypothetical(input);
    expect(result).toMatch(/cenário hipotético/i);
    expect(result).toContain("80%");
  });

  it("does not double-wrap lines already marked as hypothetical", () => {
    const input = `Em um cenário hipotético, 80% de redução nos erros.`;
    const result = markUnsupportedStatisticsAsHypothetical(input);
    expect((result.match(/cenário hipotético/gi) || []).length).toBe(1);
  });

  it("returns content unchanged when sourceMode=true", () => {
    const input = `80% de redução na produtividade (Fonte: IBGE 2023).`;
    const result = markUnsupportedStatisticsAsHypothetical(input, true);
    expect(result).toBe(input);
  });

  it("leaves plain sentences without strong stats untouched", () => {
    const input = `O controle interno reduz o risco operacional significativamente.`;
    const result = markUnsupportedStatisticsAsHypothetical(input);
    expect(result).toBe(input);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: createDomainSpecificActivity
// ─────────────────────────────────────────────────────────────────────────────

describe("createDomainSpecificActivity", () => {
  it("returns a Matriz Risco-Controle activity for controles_internos domain", () => {
    const result = createDomainSpecificActivity(
      "Controles Internos COSO",
      "Auditoria e Compliance Corporativo",
      "Este módulo aborda controles internos, segregação de funções e COSO.",
    );
    expect(result.title).toMatch(/Risco.?Controle/i);
    expect(result.instructions).toBeTruthy();
    expect(result.rubric.length).toBeGreaterThanOrEqual(4);
    expect(result.objectiveIds).toEqual([]);
  });

  it("returns a generic activity when no domain keyword matches", () => {
    const result = createDomainSpecificActivity(
      "Tópico Genérico",
      "Curso Genérico",
      "Conteúdo sem palavras-chave de domínio específico.",
    );
    expect(result.title).toMatch(/Aplicação guiada/i);
    expect(result.instructions).toContain("Escolha um contexto real");
  });

  it("createFallbackAssessmentPack uses domain-specific activity when courseTitle is provided", () => {
    const content = `### Objetivo\n- Identificar riscos operacionais.\n- Aplicar controles COSO.\n- Avaliar adequação dos controles internos.\n\nControles internos são essenciais para a governança corporativa.`;
    const pack = createFallbackAssessmentPack("Controles Internos", content, "Auditoria Corporativa");
    expect(pack.activity.title).toMatch(/Risco.?Controle|Checklist/i);
    expect(pack.activity.objectiveIds.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: findBestInstructionalEvidence
// ─────────────────────────────────────────────────────────────────────────────

describe("findBestInstructionalEvidence", () => {
  it("ignores markdown table lines starting with |", () => {
    const content = `| Aspecto | Módulo | Tema Central |\n|---|---|---|\n| Risco | 1 | Fundamentos |\n\nControles internos são mecanismos que reduzem riscos operacionais e garantem conformidade.`;
    const result = findBestInstructionalEvidence(content, "controles internos");
    expect(result).not.toContain("| Aspecto |");
    expect(result).not.toContain("| Módulo |");
    expect(result).not.toContain("| Tema Central |");
    expect(result).not.toContain("|---|");
    expect(result).not.toContain("|");
  });

  it("ignores navigation sections like Mapa do Curso and Sumário", () => {
    const content = `Mapa do Curso apresenta todos os módulos da formação.\n\nOs controles internos protegem ativos e garantem integridade das informações financeiras de uma organização.`;
    const result = findBestInstructionalEvidence(content, "controles internos");
    expect(result).not.toMatch(/Mapa do Curso/i);
    expect(result).toContain("controles internos");
  });

  it("ignores sentences with more than 2 module number references (TOC-like)", () => {
    const content = `O Módulo 1 cobre fundamentos, o Módulo 2 aborda COSO, o Módulo 3 trata de implementação.\n\nA segregação de funções é um controle preventivo essencial para evitar fraudes.`;
    const result = findBestInstructionalEvidence(content, "controle preventivo");
    expect(result).not.toMatch(/Módulo 1.*Módulo 2.*Módulo 3/i);
    expect(result).toContain("segregação de funções");
  });

  it("returns a pedagogical sentence from clean content", () => {
    const content = `### Fundamentos\n\nA avaliação de riscos é o processo de identificar e mensurar ameaças aos objetivos organizacionais.`;
    const result = findBestInstructionalEvidence(content, "avaliação de riscos");
    expect(result).toContain("avaliação de riscos");
    expect(result).not.toContain("#");
  });

  it("createFallbackAssessmentPack activity does not contain pipe characters from tables", () => {
    const tableContent = `| Aspecto | Módulo | Tema Central |\n|---|---|---|\n| Governança | 1 | Fundamentos |\n\n- Identificar riscos.\n- Aplicar controles internos.\n- Avaliar conformidade.\n\nA gestão de riscos protege o valor das organizações.`;
    const pack = createFallbackAssessmentPack("Fundamentos", tableContent);
    expect(pack.activity.instructions).not.toContain("| Aspecto |");
    expect(pack.activity.instructions).not.toContain("| Módulo |");
    expect(pack.activity.instructions).not.toContain("|---|");
    // instructions should not have bare pipe characters from table rows
    const pipeCount = (pack.activity.instructions.match(/\|/g) || []).length;
    expect(pipeCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: normalizeCourseMapTitles
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeCourseMapTitles", () => {
  const officialTitles = [
    "Fundamentos e Conceitos Essenciais de Controles Internos",
    "Modelos e Estruturas de Controles Internos: O Framework COSO",
    "Desenho, Implementação e Documentação de Controles Internos",
  ];

  it("replaces a divergent module title in the map with the official title", () => {
    const content = `## Mapa do Curso\n\n| Módulo | Título | Objetivos |\n|---|---|---|\n| 1 | Introdução aos Controles | Compreender fundamentos |\n| 2 | Framework COSO | Aplicar COSO |\n| 3 | Implementação Prática | Documentar controles |`;
    const result = normalizeCourseMapTitles(content, officialTitles);
    expect(result).toContain("Fundamentos e Conceitos Essenciais de Controles Internos");
    expect(result).not.toContain("| 1 | Introdução aos Controles |");
  });

  it("does not modify rows that already match the official title", () => {
    const official = officialTitles[1];
    const content = `## Mapa do Curso\n\n| Módulo | Título | Objetivos |\n|---|---|---|\n| 2 | ${official} | Aplicar COSO |`;
    const result = normalizeCourseMapTitles(content, officialTitles);
    // Should be unchanged for the matching row
    expect(result).toContain(`| 2 | ${official} |`);
  });

  it("does not touch content outside the Mapa do Curso section", () => {
    const content = `## Introdução\n\nO módulo 3 apresenta implementação.\n\n## Mapa do Curso\n\n| Módulo | Título |\n|---|---|\n| 3 | Implementação Antiga |\n\n## Conclusão\n\nConteúdo final.`;
    const result = normalizeCourseMapTitles(content, officialTitles);
    expect(result).toContain("O módulo 3 apresenta implementação.");
    expect(result).toContain("Conteúdo final.");
    expect(result).toContain(officialTitles[2]);
  });

  it("returns content unchanged when moduleTitles array is empty", () => {
    const content = `## Mapa do Curso\n\n| 1 | Título Antigo |`;
    expect(normalizeCourseMapTitles(content, [])).toBe(content);
  });
});
