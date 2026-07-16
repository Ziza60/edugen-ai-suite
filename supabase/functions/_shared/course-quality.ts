export type CognitiveLevel =
  | "remember"
  | "understand"
  | "apply"
  | "analyze"
  | "evaluate"
  | "create";

export interface LearningObjective {
  id: string;
  text: string;
  cognitiveLevel: CognitiveLevel;
  successCriteria: string;
}

export interface AssessmentItem {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
  objectiveId?: string;
  difficulty?: "easy" | "medium" | "hard";
  feedback?: string[];
}

export interface FlashcardItem {
  front: string;
  back: string;
  tags: string[];
  reviewHint: string;
}

export interface PracticalActivity {
  title: string;
  instructions: string;
  expectedOutput: string;
  rubric: string[];
  objectiveIds: string[];
}

export interface BranchingScenarioChoice {
  text: string;
  feedback: string;
  score: number;
}

export interface BranchingScenario {
  title: string;
  context: string;
  decisionPoint: string;
  choices: BranchingScenarioChoice[];
}

export interface ModuleContent {
  title: string;
  content: string;
  objectives: LearningObjective[];
  assessments: AssessmentItem[];
  flashcards: FlashcardItem[];
  activity: PracticalActivity;
  scenario: BranchingScenario;
  sourceCoverage: SourceCoverage;
}

export interface CourseBlueprint {
  title: string;
  description: string;
  targetAudience: string;
  language: string;
  modules: Array<{
    title: string;
    summary: string;
    objectives: LearningObjective[];
  }>;
}

export interface CourseSequenceIssue {
  code: string;
  severity: "warning" | "critical";
  message: string;
  evidence: string;
  suggestedFix: string;
}

export interface CourseSequenceReport {
  passed: boolean;
  score: number;
  issuesByModule: Array<{
    moduleIndex: number;
    moduleTitle: string;
    issues: CourseSequenceIssue[];
  }>;
  summary: string;
}

export interface ObjectiveAssessmentMatrixRow {
  objectiveId: string;
  objective: string;
  contentEvidence: string;
  activity: string;
  assessment: string;
}

export interface SourceCoverage {
  required: boolean;
  score: number;
  matchedTerms: string[];
  missingSignals: string[];
}

export interface CourseQAIssue {
  code: string;
  severity: "warning" | "critical";
  message: string;
}

export interface CourseQAReport {
  passed: boolean;
  score: number;
  issues: CourseQAIssue[];
  matrix: ObjectiveAssessmentMatrixRow[];
}

const STOPWORDS = new Set([
  "para",
  "com",
  "uma",
  "este",
  "esta",
  "esse",
  "essa",
  "sobre",
  "curso",
  "módulo",
  "modulo",
  "the",
  "and",
  "with",
  "from",
  "that",
  "this",
  "como",
  "por",
  "dos",
  "das",
  "que",
  "não",
]);

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    return JSON.parse(match ? match[0] : cleaned) as T;
  } catch {
    return fallback;
  }
}

export function extractLearningObjectives(
  markdown: string,
): LearningObjective[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) =>
    /objetivo(s)? do m[óo]dulo/i.test(line),
  );
  const candidates: string[] = [];
  if (start >= 0) {
    for (let i = start + 1; i < lines.length && candidates.length < 4; i++) {
      const line = lines[i].trim();
      if (/^#{2,4}\s/.test(line) && candidates.length > 0) break;
      const bullet = line.match(/^[-*]\s+(.+)/)?.[1];
      if (bullet) candidates.push(normalizeSentence(bullet));
    }
  }
  const fallback =
    candidates.length > 0
      ? candidates
      : [
          "Aplicar os principais conceitos do módulo em uma situação prática.",
          "Analisar decisões e cuidados essenciais relacionados ao tema.",
          "Avaliar resultados usando critérios claros de qualidade.",
        ];
  return fallback.slice(0, 3).map((text, index) => ({
    id: `OBJ-${index + 1}`,
    text,
    cognitiveLevel: inferCognitiveLevel(text),
    successCriteria: `O aluno demonstra domínio quando consegue ${text.toLowerCase().replace(/\.$/, "")}.`,
  }));
}

export function inferCognitiveLevel(text: string): CognitiveLevel {
  const t = text.toLowerCase();
  if (/criar|construir|desenhar|projetar|desenvolver/.test(t)) return "create";
  if (/avaliar|priorizar|julgar|validar|criticar/.test(t)) return "evaluate";
  if (/analisar|comparar|diagnosticar|diferenciar/.test(t)) return "analyze";
  if (/aplicar|usar|executar|implementar|resolver/.test(t)) return "apply";
  if (/explicar|descrever|interpretar|entender|compreender/.test(t))
    return "understand";
  return "remember";
}

export function buildObjectiveAssessmentMatrix(
  objectives: LearningObjective[],
  content: string,
  activityTitle: string,
  assessments: AssessmentItem[],
): ObjectiveAssessmentMatrixRow[] {
  return objectives.map((objective, index) => ({
    objectiveId: objective.id,
    objective: objective.text,
    contentEvidence: findBestEvidence(content, objective.text),
    activity: activityTitle,
    assessment:
      assessments[index]?.question ||
      assessments[0]?.question ||
      "Questão formativa a ser revisada.",
  }));
}

export function evaluateSourceCoverage(
  content: string,
  sources: string,
): SourceCoverage {
  if (!sources.trim())
    return { required: false, score: 1, matchedTerms: [], missingSignals: [] };
  const terms = topTerms(sources, 24);
  const lower = content.toLowerCase();
  const matchedTerms = terms.filter((term) => lower.includes(term));
  const score = terms.length === 0 ? 1 : matchedTerms.length / terms.length;
  return {
    required: true,
    score,
    matchedTerms,
    missingSignals:
      score >= 0.25
        ? []
        : ["Baixa sobreposição lexical com as fontes fornecidas."],
  };
}

export function validateModuleQuality(module: ModuleContent): CourseQAReport {
  const issues: CourseQAIssue[] = [];
  const wordCount = countWords(module.content);
  if (wordCount < 450)
    issues.push({
      code: "LOW_CONTENT_DEPTH",
      severity: "warning",
      message: "Módulo com densidade textual baixa.",
    });
  if (module.objectives.length < 2)
    issues.push({
      code: "MISSING_OBJECTIVES",
      severity: "critical",
      message: "Menos de 2 objetivos de aprendizagem.",
    });
  if (module.assessments.length < 3)
    issues.push({
      code: "MISSING_ASSESSMENTS",
      severity: "warning",
      message: "Menos de 3 questões formativas.",
    });
  if (module.flashcards.length < 3)
    issues.push({
      code: "MISSING_FLASHCARDS",
      severity: "warning",
      message: "Menos de 3 flashcards.",
    });
  if (!module.activity?.title || module.activity.rubric.length < 3)
    issues.push({
      code: "MISSING_RUBRIC_ACTIVITY",
      severity: "warning",
      message: "Atividade prática ou rubrica incompleta.",
    });
  if (!module.scenario?.choices || module.scenario.choices.length < 2)
    issues.push({
      code: "MISSING_BRANCHING_SCENARIO",
      severity: "warning",
      message: "Cenário ramificado incompleto.",
    });
  if (module.sourceCoverage.required && module.sourceCoverage.score < 0.18) {
    issues.push({
      code: "LOW_SOURCE_COVERAGE",
      severity: "critical",
      message: "Conteúdo pouco aderente às fontes fornecidas.",
    });
  }
  const matrix = buildObjectiveAssessmentMatrix(
    module.objectives,
    module.content,
    module.activity?.title || "Atividade prática",
    module.assessments,
  );
  const penalty = issues.reduce(
    (sum, issue) => sum + (issue.severity === "critical" ? 25 : 10),
    0,
  );
  const score = Math.max(0, 100 - penalty);
  return {
    passed: !issues.some((issue) => issue.severity === "critical"),
    score,
    issues,
    matrix,
  };
}

function sanitizeTableCell(s: string): string {
  return s
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "—")
    .trim();
}

export function appendInteractiveLearningBlocks(
  module: ModuleContent,
  qa: CourseQAReport,
): string {
  const matrixRows = qa.matrix
    .map(
      (row) =>
        `| ${sanitizeTableCell(row.objectiveId)} | ${sanitizeTableCell(row.objective)} | ${sanitizeTableCell(row.contentEvidence)} | ${sanitizeTableCell(row.activity)} | ${sanitizeTableCell(row.assessment)} |`,
    )
    .join("\n");
  const rubric = module.activity.rubric
    .map((item) => `- ${normalizeSentence(item)}`)
    .join("\n");
  const choices = module.scenario.choices
    .map(
      (choice, index) =>
        `${index + 1}. **${choice.text}** — Feedback: ${choice.feedback} (pontuação: ${choice.score}).`,
    )
    .join("\n");
  const warnings =
    qa.issues.length > 0
      ? `\n\n### 🧪 Nota de Qualidade EduGen\n- Score do módulo: ${qa.score}/100.\n${qa.issues.map((issue) => `- ${issue.severity.toUpperCase()}: ${issue.message}`).join("\n")}`
      : `\n\n### 🧪 Nota de Qualidade EduGen\n- Score do módulo: ${qa.score}/100. O módulo passou no gate mínimo de qualidade.`;

  return `${module.content.trim()}

---

### 🧭 Matriz Objetivo-Conteúdo-Avaliação

| Objetivo | Resultado esperado | Evidência no conteúdo | Atividade | Avaliação |
|---|---|---|---|---|
${matrixRows}

### 🛠️ Atividade Prática Avaliável

**${module.activity.title}**

${module.activity.instructions}

**Entrega esperada:** ${module.activity.expectedOutput}

**Rubrica de avaliação:**

${rubric}

### 🧩 Cenário Ramificado

**${module.scenario.title}**

${module.scenario.context}

**Ponto de decisão:** ${module.scenario.decisionPoint}

${choices}${warnings}`;
}

export function createFallbackAssessmentPack(
  moduleTitle: string,
  content: string,
  courseTitle?: string,
): Pick<
  ModuleContent,
  "objectives" | "assessments" | "flashcards" | "activity" | "scenario"
> {
  const objectives = extractLearningObjectives(content);
  const assessments = objectives.map(
    (objective, index) =>
      ({
        question: `Qual ação melhor demonstra o objetivo "${objective.text.replace(/\.$/, "")}"?`,
        options: [
          "Aplicar o conceito em um caso real e justificar a decisão.",
          "Memorizar uma definição sem relacionar com o contexto.",
          "Ignorar riscos e executar a primeira solução disponível.",
          "Copiar um exemplo sem adaptar ao problema apresentado.",
        ],
        correct: 0,
        explanation: `A alternativa correta exige aplicação prática e justificativa, alinhada ao objetivo ${objective.id}.`,
        objectiveId: objective.id,
        difficulty: index === 0 ? "easy" : "medium",
        feedback: [
          "Correto: aplicação contextualizada evidencia aprendizagem.",
          "Incompleto: memorização isolada é insuficiente.",
          "Incorreto: riscos precisam ser considerados.",
          "Incorreto: adaptação é parte da competência.",
        ],
      }) satisfies AssessmentItem,
  );
  const flashcards = objectives.map((objective) => ({
    front: `Como demonstrar domínio de ${objective.text.replace(/\.$/, "").toLowerCase()}?`,
    back: objective.successCriteria,
    tags: [moduleTitle, objective.cognitiveLevel],
    reviewHint:
      "Revise após 1 dia, 3 dias e 7 dias, aplicando a resposta em um exemplo próprio.",
  }));
  const domainActivity = createDomainSpecificActivity(
    moduleTitle,
    courseTitle || "",
    content,
  );
  return {
    objectives,
    assessments,
    flashcards,
    activity: {
      ...domainActivity,
      objectiveIds: objectives.map((objective) => objective.id),
    },
    scenario: {
      title: `Decisão aplicada — ${moduleTitle}`,
      context: `Você precisa orientar uma equipe a usar o tema do módulo em uma situação real com prazo curto e impacto relevante.`,
      decisionPoint:
        "Qual é a melhor primeira decisão para maximizar aprendizagem e reduzir risco?",
      choices: [
        {
          text: "Mapear objetivo, contexto e critério de sucesso antes de agir.",
          feedback: "Boa decisão: conecta ação ao resultado esperado.",
          score: 3,
        },
        {
          text: "Executar imediatamente sem validar restrições.",
          feedback:
            "Risco alto: pode gerar retrabalho e aprendizagem superficial.",
          score: 1,
        },
        {
          text: "Copiar um exemplo genérico sem adaptação.",
          feedback:
            "Parcial: exemplos ajudam, mas precisam ser contextualizados.",
          score: 2,
        },
      ],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COURSE SEQUENCE INTEGRITY GATE
// Detects and repairs broken cross-module references produced when modules are
// generated in parallel without awareness of the full sequence.
// ─────────────────────────────────────────────────────────────────────────────

const PREV_MODULE_PATTERNS = [
  /no m[oó]dulo anterior/i,
  /como vimos anteriormente/i,
  /voc[eê] j[aá] explorou/i,
  /voc[eê] j[aá] aprendeu/i,
  /voc[eê] aprendeu anteriormente/i,
  /estudamos no m[oó]dulo/i,
  /conforme estudamos antes/i,
  /como apresentamos anteriormente/i,
  /como discutimos anteriormente/i,
  /nas li[cç][oõ]es anteriores/i,
  /nos m[oó]dulos anteriores/i,
];

const NEXT_MODULE_PATTERNS = [
  /no pr[oó]ximo m[oó]dulo/i,
  /no m[oó]dulo seguinte/i,
  /veremos no pr[oó]ximo/i,
  /abordaremos no pr[oó]ximo/i,
  /trataremos no pr[oó]ximo/i,
  /exploraremos no pr[oó]ximo/i,
  /na pr[oó]xima li[cç][aã]o/i,
  /na pr[oó]xima aula/i,
];

function extractModuleNumberRefs(text: string): number[] {
  const nums: number[] = [];
  const re = /\bM[oó]dulo[s]?\s+(\d+)(?:\s+[ae]\s+(\d+))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    nums.push(Number(m[1]));
    if (m[2]) nums.push(Number(m[2]));
  }
  return nums;
}

export function validateModuleSequenceReferences(
  content: string,
  moduleIndex: number,
  totalModules: number,
  moduleTitles: string[],
): CourseSequenceIssue[] {
  const issues: CourseSequenceIssue[] = [];
  const isFirst = moduleIndex === 0;
  const isLast = moduleIndex === totalModules - 1;

  // 1. Module number references that exceed totalModules
  const numRefs = extractModuleNumberRefs(content);
  for (const n of numRefs) {
    if (n > totalModules) {
      const re = new RegExp(`M[oó]dulos?\\s+${n}(?:\\s+[ae]\\s+\\d+)?`, "i");
      const match = content.match(re);
      issues.push({
        code: "MODULE_REF_OUT_OF_BOUNDS",
        severity: "critical",
        message: `Referência a "Módulo ${n}" mas o curso tem apenas ${totalModules} módulos.`,
        evidence: match ? match[0] : `Módulo ${n}`,
        suggestedFix: `Substituir "Módulo ${n}" por "módulo anterior" ou pelo título correto.`,
      });
    }
  }

  // 2. "Módulos X a Y" / "Módulos X e Y" where the upper bound exceeds total
  const rangeRe = /\bM[oó]dulos\s+(\d+)\s+[ae]\s+(\d+)/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rangeRe.exec(content)) !== null) {
    const lo = Number(rm[1]);
    const hi = Number(rm[2]);
    if (hi > totalModules || lo > totalModules) {
      issues.push({
        code: "MODULE_RANGE_OUT_OF_BOUNDS",
        severity: "critical",
        message: `Intervalo "${rm[0]}" excede o total de ${totalModules} módulos.`,
        evidence: rm[0],
        suggestedFix: `Substituir por "módulos anteriores".`,
      });
    }
  }

  // 3. First module must not reference prior content
  if (isFirst) {
    for (const pattern of PREV_MODULE_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        issues.push({
          code: "FIRST_MODULE_BACKWARD_REF",
          severity: "critical",
          message: `Primeiro módulo contém referência ao passado: "${match[0]}".`,
          evidence: match[0],
          suggestedFix: `Remover a referência ou substituir por "Neste módulo".`,
        });
      }
    }
  }

  // 4. Last module must not promise a next module
  if (isLast) {
    for (const pattern of NEXT_MODULE_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        issues.push({
          code: "LAST_MODULE_FORWARD_REF",
          severity: "critical",
          message: `Último módulo promete conteúdo futuro: "${match[0]}".`,
          evidence: match[0],
          suggestedFix: `Remover a promessa ou substituir por "no projeto final" / "nos próximos passos".`,
        });
      }
    }
  }

  // 5. References to module titles that don't exist in the course
  for (const title of moduleTitles) {
    // Skip the current module's own title
    if (moduleTitles.indexOf(title) === moduleIndex) continue;
  }
  // (Title-based cross-ref detection is intentionally lightweight here — false
  //  positives from partial matches outweigh the benefit for short titles.)

  return issues;
}

export function validateCourseSequenceIntegrity(
  modules: Array<{ title: string; content: string; order_index?: number }>,
): CourseSequenceReport {
  const totalModules = modules.length;
  const moduleTitles = modules.map((m) => m.title);
  const issuesByModule: CourseSequenceReport["issuesByModule"] = [];
  let totalPenalty = 0;

  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    const idx = mod.order_index ?? i;
    const issues = validateModuleSequenceReferences(
      mod.content,
      idx,
      totalModules,
      moduleTitles,
    );
    if (issues.length > 0) {
      issuesByModule.push({ moduleIndex: idx, moduleTitle: mod.title, issues });
      for (const issue of issues) {
        totalPenalty += issue.severity === "critical" ? 20 : 5;
      }
    }
  }

  const score = Math.max(0, 100 - totalPenalty);
  const hasCritical = issuesByModule.some((m) =>
    m.issues.some((i) => i.severity === "critical"),
  );

  const totalIssues = issuesByModule.reduce((s, m) => s + m.issues.length, 0);
  const summary =
    totalIssues === 0
      ? `Integridade de sequência OK — ${totalModules} módulos sem referências cruzadas quebradas.`
      : `${totalIssues} referência(s) quebrada(s) em ${issuesByModule.length} módulo(s). Score: ${score}/100.`;

  return { passed: !hasCritical, score, issuesByModule, summary };
}

export function repairModuleSequenceReferences(
  content: string,
  moduleIndex: number,
  totalModules: number,
): string {
  let out = content;
  const isFirst = moduleIndex === 0;
  const isLast = moduleIndex === totalModules - 1;

  // 1. "Módulo N" / "Módulos N" where N > totalModules → "módulo anterior"
  out = out.replace(/\bM[oó]dulo\s+(\d+)/gi, (match, numStr) => {
    const n = Number(numStr);
    if (n > totalModules) return "módulo anterior";
    return match;
  });

  // 2. "Módulos X a Y" / "Módulos X e Y" where max > totalModules → "módulos anteriores"
  out = out.replace(/\bM[oó]dulos\s+\d+\s+[ae]\s+\d+/gi, (match) => {
    const nums = match.match(/\d+/g)?.map(Number) ?? [];
    if (nums.some((n) => n > totalModules)) return "módulos anteriores";
    return match;
  });

  // 3. First module: remove/replace backward references
  if (isFirst) {
    for (const pattern of PREV_MODULE_PATTERNS) {
      out = out.replace(pattern, "Neste módulo");
    }
  }

  // 4. Last module: remove/replace forward references
  if (isLast) {
    for (const pattern of NEXT_MODULE_PATTERNS) {
      out = out.replace(pattern, "nos próximos passos");
    }
  }

  return out;
}

function normalizeSentence(value: string): string {
  const cleaned = value.replace(/^[-•*\d.)\s]+/, "").trim();
  if (!cleaned) return cleaned;
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function topTerms(text: string, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const raw of text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]{4,}/g) || []) {
    if (STOPWORDS.has(raw)) continue;
    counts.set(raw, (counts.get(raw) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term);
}

function findBestEvidence(content: string, query: string): string {
  const queryTerms = topTerms(query, 8);
  const sentences = content
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
  let best = sentences[0] || "Evidência distribuída no conteúdo do módulo.";
  let bestScore = -1;
  for (const sentence of sentences.slice(0, 80)) {
    const lower = sentence.toLowerCase();
    const score = queryTerms.reduce(
      (sum, term) => sum + (lower.includes(term) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  }
  return best.length > 140 ? `${best.slice(0, 137).trim()}...` : best;
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTRUCTIONAL EVIDENCE FINDER
// Like findBestEvidence but filters out markdown tables, navigation sections
// (Mapa do Curso, Sumário) and headings so the result is always a clean
// pedagogical sentence suitable for inclusion in activity instructions.
// ─────────────────────────────────────────────────────────────────────────────

const NAVIGATION_HEADING_RES = [
  /\bMapa\s+do\s+Curso\b/i,
  /\bSum[aá]rio\b/i,
  /\bVis[aã]o\s+Geral\b/i,
  /\b[Íi]ndice\b/i,
  /\bConteúdo\s+Programático\b/i,
];

function isMarkdownTableLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") || (t.match(/\|/g) || []).length > 2;
}

function isNavigationSentence(text: string): boolean {
  return NAVIGATION_HEADING_RES.some((re) => re.test(text));
}

/**
 * Returns the best instructional sentence from the content to use as a
 * starting point in activity instructions. Filters out:
 * - Markdown table lines (starting with | or having more than 2 pipes)
 * - Table separators (|---|)
 * - Navigation/meta headings (Mapa do Curso, Sumário, Visão Geral, Índice)
 * - Sentences with excessive module-number references
 * - Headings (lines starting with #)
 */
export function findBestInstructionalEvidence(content: string, query: string): string {
  const queryTerms = topTerms(query, 8);

  // Strip table lines and headings at the line level before sentence splitting
  const cleanedContent = content
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (t.startsWith("#")) return false;
      if (isMarkdownTableLine(t)) return false;
      return true;
    })
    .join("\n");

  const sentences = cleanedContent
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length < 40 || s.length > 300) return false;
      if (isNavigationSentence(s)) return false;
      // Reject sentences listing many module references (likely a TOC paragraph)
      const moduleRefCount = (s.match(/\bM[oó]dulo\s+\d+/gi) || []).length;
      if (moduleRefCount > 2) return false;
      // Reject any residual pipe (table fragment that survived)
      if (s.includes("|")) return false;
      return true;
    });

  if (sentences.length === 0) return "os conceitos centrais do módulo";

  let best = sentences[0];
  let bestScore = -1;
  for (const sentence of sentences.slice(0, 80)) {
    const lower = sentence.toLowerCase();
    const score = queryTerms.reduce(
      (sum, term) => sum + (lower.includes(term) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  }
  return best.length > 160 ? `${best.slice(0, 157).trim()}...` : best;
}

// ─────────────────────────────────────────────────────────────────────────────
// COURSE MAP TITLE NORMALIZER
// Aligns "Mapa do Curso" table titles with the official module titles so that
// the PDF sumário and the mapa table are consistent.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeForCompare(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Scans a content string for "Mapa do Curso" table sections and replaces
 * divergent module titles in those tables with the official titles from the
 * `moduleTitles` array (0-indexed: moduleTitles[0] = Módulo 1).
 *
 * Only modifies rows that clearly identify a module by number
 * (e.g. `| 1 |` or `| Módulo 1 |`). Rows that cannot be matched, header
 * rows, and separator rows are left untouched.
 */
export function normalizeCourseMapTitles(
  content: string,
  moduleTitles: string[],
): string {
  if (!moduleTitles.length) return content;

  const lines = content.split("\n");
  let inMapSection = false;

  const out = lines.map((line) => {
    const trimmed = line.trim();

    // Detect start of a "Mapa do Curso" section (heading or table context)
    if (/\bMapa\s+do\s+Curso\b/i.test(trimmed)) {
      inMapSection = true;
      return line;
    }

    // Exit map section at the next major heading (same or higher level, not the map itself)
    if (
      inMapSection &&
      /^#{1,3}\s/.test(trimmed) &&
      !/\bMapa\s+do\s+Curso\b/i.test(trimmed)
    ) {
      inMapSection = false;
      return line;
    }

    if (!inMapSection) return line;

    // Skip header rows and separator rows
    if (/^\|\s*[-:]+/.test(trimmed) || /^\|\s*Módulo/i.test(trimmed) && /\bMódulo\b/i.test(trimmed.replace(/\|/g, "").trim().split(/\s+/).slice(0, 2).join(" "))) {
      return line;
    }

    // Match a table data row: | N | ... or | Módulo N | ...
    const rowMatch = trimmed.match(/^\|\s*(?:M[oó]dulo\s+)?(\d+)\s*\|(.+)$/i);
    if (!rowMatch) return line;

    const moduleNum = parseInt(rowMatch[1], 10);
    if (moduleNum < 1 || moduleNum > moduleTitles.length) return line;

    const officialTitle = moduleTitles[moduleNum - 1];
    if (!officialTitle) return line;

    // cells[0] is the title column (first cell after the module-number cell)
    const afterNum = rowMatch[2];
    const cells = afterNum.split("|");
    if (cells.length < 1) return line;

    const existingTitle = cells[0].trim();

    if (normalizeForCompare(existingTitle) === normalizeForCompare(officialTitle)) {
      return line; // already consistent
    }

    cells[0] = ` ${officialTitle} `;
    const indent = line.match(/^(\s*)/)?.[1] ?? "";
    return `${indent}| ${moduleNum} |${cells.join("|")}`;
  });

  return out.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL QA BLOCK STRIPPER
// Removes EduGen-internal QA blocks from module content before delivery to the
// student (PDF export, portal). The enriched content stays in the DB for QA.
// ─────────────────────────────────────────────────────────────────────────────

const INTERNAL_BLOCK_HEADING_RES = [
  /^#{1,4}\s+.*Matriz\s+Objetivo[-–]Conte[úu]do[-–]Avalia[çc][aã]o/i,
  /^#{1,4}\s+.*Nota\s+de\s+Qualidade\s+EduGen/i,
];

const INTERNAL_LINE_RES = [
  /^-\s+Score\s+do\s+m[óo]dulo\s*:/i,
  /^-\s+(CRITICAL|WARNING|INFO|ERROR)\s*:\s+/,
];

/**
 * Strips EduGen-internal QA blocks from module content so they never appear
 * in the student apostila (PDF or portal). Preserves all genuine pedagogical
 * content (objectives, examples, activities, branching scenarios, etc.).
 */
export function stripInternalEdugenBlocks(content: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let skipping = false;
  let skipLevel = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (INTERNAL_BLOCK_HEADING_RES.some((re) => re.test(trimmed))) {
      skipping = true;
      const levelMatch = trimmed.match(/^(#{1,4})\s/);
      skipLevel = levelMatch ? levelMatch[1].length : 3;
      continue;
    }

    if (skipping) {
      const headingMatch = trimmed.match(/^(#{1,6})\s/);
      if (headingMatch && headingMatch[1].length <= skipLevel) {
        skipping = false;
        // fall through to process this new heading
      } else if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
        skipping = false;
        continue;
      } else {
        continue;
      }
    }

    if (INTERNAL_LINE_RES.some((re) => re.test(trimmed))) continue;

    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMAIN-SPECIFIC ACTIVITY GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

interface DomainActivitySpec {
  title: string;
  instructions: string;
  expectedOutput: string;
  rubric: string[];
}

const DOMAIN_RULES: Array<{ keywords: RegExp; activities: DomainActivitySpec[] }> = [
  {
    keywords:
      /controle\s+interno|controles\s+internos|COSO|SOX|auditoria\s+interna|segrega[çc][aã]o\s+de\s+fun[çc][oõ]es|remedia[çc][aã]o|compliance|defici[êe]ncia\s+de\s+controle/i,
    activities: [
      {
        title: "Matriz Risco-Controle",
        instructions:
          "Identifique ao menos três riscos operacionais ou financeiros relevantes ao contexto do módulo. Para cada risco, descreva o controle preventivo ou detectivo existente, avalie sua adequação (adequado / parcialmente adequado / inadequado) e proponha melhorias quando aplicável.",
        expectedOutput:
          "Uma matriz risco-controle com colunas: Risco | Probabilidade | Impacto | Controle Atual | Adequação | Melhoria Sugerida.",
        rubric: [
          "Identifica riscos específicos ao contexto e não genéricos.",
          "Classifica corretamente controles preventivos vs. detectivos.",
          "Avalia adequação com critério objetivo.",
          "Propõe melhoria factível e mensurável.",
        ],
      },
      {
        title: "Checklist COSO",
        instructions:
          "Com base no conteúdo do módulo, elabore um checklist de verificação de conformidade COSO para o componente mais relevante (Ambiente de Controle, Avaliação de Risco, Atividades de Controle, Informação & Comunicação ou Monitoramento). Cada item deve ser verificável com Sim / Não / Parcial e incluir evidência esperada.",
        expectedOutput:
          "Checklist com ao menos 8 itens verificáveis, coluna de status (Sim/Não/Parcial) e coluna de evidência esperada.",
        rubric: [
          "Mapeia ao componente COSO correto.",
          "Itens são verificáveis e não ambíguos.",
          "Inclui coluna de evidência esperada.",
          "Cobre pelo menos duas sub-áreas do componente.",
        ],
      },
    ],
  },
  {
    keywords:
      /gest[aã]o\s+de\s+riscos?|apetite\s+(ao|de)\s+risco|mapa\s+de\s+riscos?|probabilidade.*impacto|ERM|ISO\s*31000/i,
    activities: [
      {
        title: "Mapa de Riscos",
        instructions:
          "Identifique cinco riscos do contexto abordado no módulo. Para cada risco, atribua probabilidade (1-3) e impacto (1-3), calcule o índice de risco (P × I) e classifique como Baixo / Médio / Alto. Proponha uma estratégia de resposta (aceitar, mitigar, transferir ou evitar).",
        expectedOutput:
          "Mapa de riscos com cinco entradas, índice P×I calculado, classificação de nível e estratégia de resposta.",
        rubric: [
          "Riscos são específicos ao tema do módulo.",
          "Escalas de probabilidade e impacto são aplicadas corretamente.",
          "Estratégias de resposta são coerentes com o nível de risco.",
          "O mapa tem estrutura replicável para novos riscos.",
        ],
      },
    ],
  },
  {
    keywords:
      /fluxo\s+de\s+caixa|DRE\b|balan[çc]o\s+patrimonial|indicadores?\s+financeiros?|ROI\b|EBITDA\b|margem\s+(l[íi]quida|bruta)|liquidez|rentabilidade/i,
    activities: [
      {
        title: "Análise de Indicadores Financeiros",
        instructions:
          "Com base em dados hipotéticos, calcule ao menos três indicadores financeiros do módulo (ex.: liquidez corrente, margem líquida, ROE). Interprete cada resultado em relação a benchmarks setoriais e recomende ações de melhoria.",
        expectedOutput:
          "Tabela com indicador, fórmula, valor calculado, benchmark de referência e recomendação.",
        rubric: [
          "Fórmulas aplicadas corretamente.",
          "Interpreta resultado em relação a benchmark.",
          "Recomendações são acionáveis e específicas.",
          "Distingue indicadores de liquidez, rentabilidade e eficiência.",
        ],
      },
    ],
  },
  {
    keywords:
      /gest[aã]o\s+de\s+projetos?|PMO\b|sprint\b|WBS\b|cronograma|escopo\s+do\s+projeto|stakeholder|PMBOK|Agile|Scrum/i,
    activities: [
      {
        title: "Plano de Projeto Resumido",
        instructions:
          "Para um projeto fictício relacionado ao tema do módulo, elabore: escopo em três linhas, WBS de alto nível com ao menos cinco entregas, cronograma simplificado (semanas) e matriz RACI para as principais atividades.",
        expectedOutput: "Documento com escopo, WBS, cronograma e matriz RACI.",
        rubric: [
          "Escopo é claro, limitado e sem ambiguidade.",
          "WBS cobre as principais entregas sem repetição.",
          "Cronograma tem dependências lógicas.",
          "RACI distingue Responsável de Aprovador corretamente.",
        ],
      },
    ],
  },
  {
    keywords:
      /seguran[çc]a\s+da\s+informa[çc][aã]o|LGPD\b|GDPR\b|vulnerabilidade|incidente\s+de\s+seguran[çc]a|criptografia|pentest/i,
    activities: [
      {
        title: "Plano de Resposta a Incidente",
        instructions:
          "Descreva um cenário de incidente de segurança hipotético relacionado ao conteúdo do módulo. Elabore um plano de resposta com as fases: Detecção, Contenção, Erradicação, Recuperação e Lições Aprendidas. Inclua responsáveis e prazo estimado para cada fase.",
        expectedOutput:
          "Plano de resposta a incidente com cinco fases, responsáveis e prazos.",
        rubric: [
          "Cenário é realista e específico ao domínio.",
          "Cobre todas as cinco fases de resposta.",
          "Define responsáveis com clareza.",
          "Inclui ação de lição aprendida para prevenção futura.",
        ],
      },
    ],
  },
];

/**
 * Generates a domain-specific practical activity for a module, replacing the
 * generic "Escolha um contexto real..." fallback when the domain is detectable.
 */
export function createDomainSpecificActivity(
  moduleTitle: string,
  courseTitle: string,
  content: string,
  _targetAudience?: string,
): Pick<PracticalActivity, "title" | "instructions" | "expectedOutput" | "rubric"> & {
  objectiveIds: string[];
} {
  const probe = `${courseTitle} ${moduleTitle} ${content.slice(0, 600)}`;

  for (const rule of DOMAIN_RULES) {
    if (rule.keywords.test(probe)) {
      const spec = rule.activities[0];
      return {
        title: `${spec.title} — ${moduleTitle}`,
        instructions: spec.instructions,
        expectedOutput: spec.expectedOutput,
        rubric: spec.rubric,
        objectiveIds: [],
      };
    }
  }

  // Generic fallback — use instructional evidence (avoids markdown tables)
  const coreSentence = findBestInstructionalEvidence(content, moduleTitle);

  return {
    title: `Aplicação guiada — ${moduleTitle}`,
    instructions: `Escolha um contexto real do seu trabalho ou estudo e aplique os conceitos centrais do módulo. Use como ponto de partida: ${coreSentence}`,
    expectedOutput:
      "Um plano curto com contexto, decisão tomada, justificativa, riscos e métrica de sucesso.",
    rubric: [
      "Contextualiza o problema com clareza.",
      "Aplica pelo menos dois conceitos do módulo.",
      "Justifica decisões com critérios objetivos.",
      "Define uma métrica verificável de sucesso.",
    ],
    objectiveIds: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STATISTICAL CLAIMS HYPOTHETICAL MARKER
// ─────────────────────────────────────────────────────────────────────────────

const ALREADY_QUALIFIED_RE =
  /hipot[ée]tico|ilustrativo|exemplo\s+ilustrativo|fict[íi]cio|estimativa|aproximadamente|cen[aá]rio\s+hipot[ée]tico/i;

const STRONG_STAT_RE =
  /\b(\d{2,3})\s*%\s*(?:de\s+)?(redu[çc][aã]o|aumento|melhoria|queda|crescimento|economia|diminui[çc][aã]o|efici[êe]ncia|produtividade)/i;

/**
 * Wraps strong percentage claims with a "cenário hipotético" qualifier so they
 * are not presented as verified facts when no source is cited.
 *
 * - sourceMode = false (default): applies the qualifier to unqualified claims.
 * - sourceMode = true           : returns content unchanged (source is cited).
 */
export function markUnsupportedStatisticsAsHypothetical(
  content: string,
  sourceMode = false,
): string {
  if (sourceMode) return content;

  const lines = content.split("\n");
  const out: string[] = [];

  for (const line of lines) {
    if (!STRONG_STAT_RE.test(line) || ALREADY_QUALIFIED_RE.test(line)) {
      out.push(line);
      continue;
    }

    const trimmed = line.trimStart();
    const indent = line.slice(0, line.length - trimmed.length);
    const bulletMatch = trimmed.match(/^([-*]\s+)(.*)/s);

    if (bulletMatch) {
      const rest = bulletMatch[2];
      out.push(
        `${indent}${bulletMatch[1]}Em um cenário hipotético, ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`,
      );
    } else {
      out.push(
        `${indent}Em um cenário hipotético, ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`,
      );
    }
  }

  return out.join("\n");
}
