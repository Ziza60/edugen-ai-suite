// ═══════════════════════════════════════════════════════════════════════════
// PRESENTATION PLANNER (v5.2.0)
// ───────────────────────────────────────────────────────────────────────────
// Intermediate semantic layer between course markdown and the v5 renderer.
//
//   Course Markdown
//     → PresentationPlan       (this file)
//     → validatePresentationPlan
//     → presentationPlanToV5Slides
//     → existing v5 pipeline (sanitize / QA / cascade / render)
//
// Goal: deliver cleaner input to the renderer so the QA cascade has less
// damage to repair. The planner enforces per-module domain rules (e.g. no
// SQL in a Python "Estruturas de Dados" module), concrete learning
// objectives, single-idea-per-slide, code-in-code-field, and dedup.
//
// IMPORTANT: this module ONLY produces Slide-shaped data for the existing
// renderer. It NEVER calls renderer functions, NEVER mutates shared state,
// and on ANY failure the caller MUST fall back to the legacy pipeline.
// ═══════════════════════════════════════════════════════════════════════════

// ── Re-declared minimal types so this file stays decoupled from index.ts ──
// (keeping the planner self-contained makes it trivial to test/replace).

export type PlanIntent =
  | "module_cover"
  | "concept"
  | "example"
  | "code_walkthrough"
  | "process"
  | "comparison"
  | "cards"
  | "takeaways"
  | "summary"
  | "closing";

export type PlanLayoutHint =
  | "bullets"
  | "cards"
  | "code"
  | "process"
  | "comparison"
  | "twocol"
  | "takeaways";

export interface PresentationSlide {
  id: string;
  moduleIndex: number;
  title: string;
  intent: PlanIntent;
  layoutHint: PlanLayoutHint;
  density: "compact" | "standard" | "detailed";
  visualPriority: "low" | "medium" | "high";
  focalElement: "text" | "code" | "comparison" | "list";
  items: string[];
  code?: string;
  codeLanguage?: string;
  // Comparison-only
  leftHeader?: string;
  rightHeader?: string;
  leftItems?: string[];
  rightItems?: string[];
  speakerNotes?: string;
  sourceModuleTitle: string;
}

export interface PresentationPlanModule {
  moduleTitle: string;
  moduleIndex: number;
  slides: PresentationSlide[];
}

export interface PresentationPlan {
  courseTitle: string;
  language: string;
  modules: PresentationPlanModule[];
}

export interface PlanIssue {
  slideId: string;
  moduleIndex: number;
  type:
    | "DOMAIN_CONTAMINATION"
    | "SQL_IN_PYTHON"
    | "GENERIC_OBJECTIVE"
    | "EMPTY_ITEM"
    | "TRUNCATED_SENTENCE"
    | "BROKEN_SEMANTIC_SENTENCE"
    | "MODULE_OBJECTIVE_VIOLATION"
    | "INCOMPLETE_CODE_SNIPPET"
    | "CODE_IN_BULLET"
    | "DUPLICATE_SLIDE"
    | "TOO_MANY_BULLETS"
    | "CODE_TOO_LONG"
    | "MISSING_TITLE"
    | "EMPTY_SLIDE"
    | "INVALID_INTENT";
  message: string;
  severity: "fatal" | "fixable" | "warn";
}

export interface PlanValidationReport {
  passed: boolean;
  issues: PlanIssue[];
  byType: Record<string, number>;
}

// ═══════════════════════════════════════════════════════════
// v5.3.0 — MODULAR EXPORT ARCHITECTURE
// ───────────────────────────────────────────────────────────
// Formal types for the per-module mini-deck pipeline. The
// orchestrator (runPipeline in index.ts) builds one ModuleDeck
// per source module and merges them with mergeModuleDecks()
// before the renderer. Each ModuleDeck carries its own planner
// diagnostics, validation result, gate decision, and QA status —
// so semantic problems stay scoped to a single module instead
// of contaminating the whole deck.
// ═══════════════════════════════════════════════════════════

// HARD CAP: how many slides a single module is allowed to render.
// Spec target: 3-6 slides/module → deck of 28-42 for an 8-module course.
// Rollout: started at 4 (v5.2.2), bumped to 5 (v5.3.0).
// To raise to 6: change here AND the prompt in buildModulePrompt
// (line ~656) AND the parser slice (line ~815) AND the gate range
// in index.ts (line ~6895). All four MUST move together.
export const MAX_PLANNER_SLIDES_PER_MODULE = 5;
export const MIN_PLANNER_SLIDES_PER_MODULE = 1;

// Visual / typographic / pacing tokens that propagate to every
// module so the merged deck stays visually coherent. Today the
// renderer reads DESIGN_SYSTEMS directly; this blueprint is
// passed through as metadata so future per-module customisation
// can read it without touching the renderer.
export interface GlobalBlueprint {
  theme: string;                  // skin id (default_v5 / dark_theme / etc)
  language: string;               // pt-BR / en-US / es-ES …
  tone: "formal" | "didactic" | "casual";
  density: "compact" | "standard" | "detailed";
  preferredIntents: PlanIntent[]; // hint for planner prompt
  visualRhythm: "calm" | "balanced" | "energetic";
  // Reserved for future expansion — reading the blueprint
  // is safe even if the renderer ignores these fields.
  typographyScale?: { titlePt: number; bodyPt: number };
  spacingScale?:    { gutter: number; gridUnit: number };
}

export interface ModulePlannerDiagnostic {
  moduleIndex: number;
  moduleTitle: string;
  slidesGenerated: number;
  fatals: number;
  blockers: number;
  repairs: {
    repaired_objectives?: number;
    blocked_contamination?: number;
    moved_code?: number;
    removed_duplicates?: number;
    removed_truncated?: number;
    capped_bullets?: number;
    capped_code?: number;
    removed_broken_sentence?: number;
    repaired_module_objectives?: number;
    repaired_code_snippets?: number;
  };
  crossModuleLeaks: number; // count of items dropped due to cross-module-leak
}

export interface ModuleQADiagnostic {
  moduleIndex: number;
  moduleTitle: string;
  status: "PASSED" | "FAILED";
  issuesUnfixed: number;
  issuesFixed: number;
  unfixedBreakdown: Record<string, number>;
}

export type ModuleSource = "planner" | "legacy_fallback";

// ModuleDeck is the per-module unit that flows through the
// pipeline. The orchestrator owns an array of these; merging
// concatenates them while preserving each module's diagnostics.
// We declare `slides` as `unknown[]` here because the renderer's
// Slide type lives in index.ts — keeping presentation-plan.ts
// renderer-free per the original architectural rule.
export interface ModuleDeck<TSlide = unknown> {
  moduleIndex: number;
  moduleTitle: string;
  source: ModuleSource;
  slides: TSlide[];
  plannerDiagnostics?: ModulePlannerDiagnostic;
  validationResult?: PlanValidationReport;
  qaDiagnostic?: ModuleQADiagnostic;
  gateAccepted: boolean; // true if planner output was accepted, false if fallback used
}

export interface CourseExportPlan<TSlide = unknown> {
  courseTitle: string;
  blueprint: GlobalBlueprint;
  moduleDecks: ModuleDeck<TSlide>[];
}

// ═══════════════════════════════════════════════════════════
// MODULE CONTEXT GUARD — single entry point that consolidates
// all the cross-module / per-kind semantic checks that already
// exist in this file. Returns the issues so callers can decide
// to drop the slide / repair / fall back.
// Inputs are renderer-agnostic (PresentationSlide).
// ═══════════════════════════════════════════════════════════
export function validateModuleSemanticBoundary(
  slide: PresentationSlide,
  moduleTitle: string,
  courseTitle: string,
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const rule = getModuleRule(courseTitle, moduleTitle);

  // 1. Cross-module fundamentals leak in title (FATAL)
  if (slide.title && isCrossModuleBasicLeak(slide.title, moduleTitle)) {
    issues.push({
      slideId: slide.id, moduleIndex: slide.moduleIndex,
      type: "DOMAIN_CONTAMINATION", severity: "fatal",
      message: `Title "${slide.title}" leaks fundamentals topic into module "${moduleTitle}"`,
    });
  }

  // 2. Per-item checks
  for (const item of slide.items ?? []) {
    if (!item || !item.trim()) continue;

    // 2a. cross-module fundamentals leak (fixable — repair filters it out)
    if (isCrossModuleBasicLeak(item, moduleTitle)) {
      issues.push({
        slideId: slide.id, moduleIndex: slide.moduleIndex,
        type: "DOMAIN_CONTAMINATION", severity: "fixable",
        message: `Item leaks fundamentals into "${moduleTitle}": "${item.slice(0, 60)}"`,
      });
    }
    // 2b. per-kind hard deny patterns (Python module rules)
    if (rule) {
      for (const dp of rule.denyPatterns) {
        if (dp.test(item)) {
          issues.push({
            slideId: slide.id, moduleIndex: slide.moduleIndex,
            type: rule.kind === "fundamentals" || rule.kind === "control_flow" || rule.kind === "data_structures"
              ? "SQL_IN_PYTHON" : "DOMAIN_CONTAMINATION",
            severity: "fixable",
            message: `Item violates "${rule.kind}" deny rule: "${item.slice(0, 60)}"`,
          });
          break;
        }
      }
    }
    // 2c. truncation
    if (isTruncatedSentence(item)) {
      issues.push({
        slideId: slide.id, moduleIndex: slide.moduleIndex,
        type: "TRUNCATED_SENTENCE", severity: "fixable",
        message: `Truncated item: "${item.slice(0, 60)}"`,
      });
    }
    // 2d. broken-sentence
    const brokenKind = detectBrokenSemanticSentence(item);
    if (brokenKind) {
      issues.push({
        slideId: slide.id, moduleIndex: slide.moduleIndex,
        type: "BROKEN_SEMANTIC_SENTENCE", severity: "fixable",
        message: `Broken sentence (${brokenKind}): "${item.slice(0, 60)}"`,
      });
    }
    // 2e. generic objective on module-objective slides
    const isObjectiveSlide = slide.intent === "module_cover"
      || slide.intent === "takeaways"
      || slide.intent === "summary"
      || slide.intent === "closing";
    if (isObjectiveSlide && isGenericObjective(item, moduleTitle)) {
      issues.push({
        slideId: slide.id, moduleIndex: slide.moduleIndex,
        type: "GENERIC_OBJECTIVE", severity: "fixable",
        message: `Generic objective: "${item.slice(0, 60)}"`,
      });
    }
  }

  // 3. Code snippet validation (only on code slides)
  if (slide.code && slide.intent === "code_walkthrough") {
    if (!validateCodeSnippet(slide.code, slide.codeLanguage)) {
      issues.push({
        slideId: slide.id, moduleIndex: slide.moduleIndex,
        type: "INCOMPLETE_CODE_SNIPPET", severity: "fixable",
        message: `Incomplete code snippet on slide "${slide.title}"`,
      });
    }
  }

  return issues;
}

// Re-export so index.ts can call without re-binding
export function getModuleKind(courseTitle: string, moduleTitle: string): string | undefined {
  return getModuleRule(courseTitle, moduleTitle)?.kind;
}

// ═══════════════════════════════════════════════════════════
// v5.3.0 — DEFAULT GLOBAL BLUEPRINT
// Builds a sensible default blueprint from a skin id + language.
// Callers (orchestrator) may override fields before passing to
// the planner / renderer. Reading this is always safe because
// the renderer ignores unknown fields.
// ═══════════════════════════════════════════════════════════
export function buildDefaultBlueprint(opts: {
  theme: string;
  language: string;
  density?: "compact" | "standard" | "detailed";
}): GlobalBlueprint {
  return {
    theme: opts.theme,
    language: opts.language,
    tone: "didactic",
    density: opts.density ?? "standard",
    preferredIntents: ["module_cover", "concept", "example", "code_walkthrough", "comparison", "takeaways"],
    visualRhythm: "balanced",
  };
}

// ═══════════════════════════════════════════════════════════
// Per-module domain rules (Python is the spec example, but the
// architecture supports adding more language families later).
// ═══════════════════════════════════════════════════════════

interface ModuleRule {
  kind: string;
  matchTitle: RegExp;
  allow: string[];           // human-readable allow list (for prompt)
  deny: string[];            // human-readable deny list  (for prompt)
  denyPatterns: RegExp[];    // hard deterministic denies
}

// Order matters — first match wins. Patterns are PT/EN tolerant.
const PYTHON_MODULE_RULES: ModuleRule[] = [
  {
    kind: "fundamentals",
    matchTitle: /(fundament|introdu[çc][aã]o|básico|basico|primeir|getting started|basics)/i,
    allow: ["variáveis", "tipos primitivos", "operadores", "input/output", "expressões", "print", "type()"],
    deny: ["SQL", "CREATE TABLE", "DROP", "TRUNCATE", "JOIN", "banco de dados", "POO", "herança"],
    denyPatterns: [
      /\b(CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE|SELECT\s+.+\s+FROM|INSERT\s+INTO|JOIN)\b/i,
    ],
  },
  {
    kind: "control_flow",
    matchTitle: /(controle\s+de\s+fluxo|control\s+flow|fun[çc][oõ]es|functions|loops?|condicionais)/i,
    allow: ["if/elif/else", "for/while", "def", "parâmetros", "return", "escopo local/global"],
    deny: ["SQL", "CREATE TABLE", "JOIN", "banco de dados", "classe POO", "herança"],
    denyPatterns: [
      /\b(CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE|SELECT\s+.+\s+FROM|INSERT\s+INTO|JOIN)\b/i,
    ],
  },
  {
    kind: "data_structures",
    matchTitle: /(estruturas?\s+de\s+dados|data\s+structures|listas|dicion[áa]rios|tuplas|conjuntos|sets)/i,
    allow: ["listas", "dicionários", "tuplas", "conjuntos", "append()", "keys()", "values()", "set()"],
    deny: [
      "CREATE TABLE", "ALTER TABLE", "DROP TABLE", "TRUNCATE",
      "SELECT", "INSERT", "UPDATE", "DELETE", "JOIN",
      "banco de dados", "tabela SQL", "chave primária", "chave estrangeira",
    ],
    denyPatterns: [
      /\b(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE)\b/i,
      /\b(SELECT|INSERT|UPDATE|DELETE)\s+.+\s+(FROM|INTO|SET|WHERE)\b/i,
      /\bJOIN\b/i,
      /banco\s+de\s+dados\s+relacional/i,
      /chave\s+(prim[áa]ria|estrangeira)/i,
    ],
  },
  {
    kind: "files_exceptions",
    matchTitle: /(arquivos|files?|exce[çc][oõ]es|exceptions?|tratamento\s+de\s+erros)/i,
    allow: ["open()", "with open()", "read()", "write()", "try", "except", "finally", "FileNotFoundError", "IOError", "modos 'r'/'w'/'a'/'b'"],
    deny: ["SQL", "CREATE TABLE", "JOIN", "POO avançado"],
    denyPatterns: [
      /\b(CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE|SELECT\s+.+\s+FROM)\b/i,
    ],
  },
  {
    kind: "json_apis",
    matchTitle: /(json|api[s]?|requests?|http|web\s+services?)/i,
    allow: ["json.loads()", "json.dumps()", "json.load()", "json.dump()", "requests.get()", "requests.post()", "response.json()", "HTTP status code"],
    deny: ["SQL CREATE", "tabelas", "JOIN"],
    denyPatterns: [
      /\b(CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE)\b/i,
    ],
  },
  {
    kind: "oop",
    matchTitle: /(POO|orientad[ao]\s+a\s+objet|object\s*oriented|classes?\s+e\s+objet|heran[çc]a)/i,
    allow: ["class", "__init__()", "objeto", "atributo", "método", "herança", "encapsulamento", "self"],
    deny: [
      "SQL", "CREATE TABLE", "JOIN",
      "variáveis básicas", "tipos primitivos", "operadores aritméticos",
      "expressões aritméticas", "input()/print() como tópico", "hello world",
    ],
    denyPatterns: [
      /\b(CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE|SELECT\s+.+\s+FROM)\b/i,
      // anti-cross-module: POO module must NOT teach fundamentals topics
      /\bvari[áa]veis\s+(b[áa]sicas?|primitivas?|e\s+tipos)\b/i,
      /\btipos\s+(primitivos?|de\s+dados\s+b[áa]sicos?)\b/i,
      /\boperadores\s+(aritm[ée]ticos|b[áa]sicos|de\s+atribui)/i,
      /\bexpress[oõ]es\s+aritm[ée]ticas\b/i,
      /\bentrada\s+(b[áa]sica\s+)?(de|com)\s+input\(\)/i,
      /\bsa[íi]da\s+(b[áa]sica\s+)?(de|com)\s+print\(\)/i,
      /\binput\(\)\s+e\s+print\(\)/i,
      /\bprint\(\)\s+e\s+input\(\)/i,
      /\batribui[çc][aã]o\s+(simples|b[áa]sica|de\s+valores)\b/i,
      /\bhello\s+world\b/i,
      /\bsintaxe\s+b[áa]sica\s+do\s+python\b/i,
    ],
  },
  {
    kind: "tests_logs",
    matchTitle: /(testes?|tests?|logs?|depura[çc][aã]o|debug|loggin)/i,
    allow: ["unittest", "pytest", "TestCase", "test_*", "assert", "logging", "logging.basicConfig()", "DEBUG/INFO/ERROR", "pdb"],
    deny: ["SQL", "CREATE TABLE", "JOIN", "variáveis básicas", "tipos primitivos", "POO básico"],
    denyPatterns: [
      /\b(CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE|SELECT\s+.+\s+FROM)\b/i,
      /\bvari[áa]veis\s+(b[áa]sicas?|primitivas?|e\s+tipos)\b/i,
      /\btipos\s+primitivos?\b/i,
      /\bexpress[oõ]es\s+aritm[ée]ticas\b/i,
    ],
  },
  {
    kind: "best_practices",
    matchTitle: /(boas\s+pr[áa]ticas|best\s+practices|implant|deploy|produc|ci[\/\-]?cd|empacot)/i,
    allow: ["PEP 8", "black", "flake8", "docstrings", "src/", "tests/", "docs/", "README", "requirements.txt", "venv", "pip", "setup.py"],
    deny: [
      "variáveis básicas", "tipos primitivos", "operadores aritméticos",
      "expressões aritméticas", "entrada/saída básica",
      "hello world", "sintaxe básica", "SQL", "CREATE TABLE",
    ],
    denyPatterns: [
      /\b(CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE)\b/i,
      // anti-cross-module: a "best practices" module must NOT teach
      // fundamentals from scratch (variáveis, operadores, print/input topics)
      /\bvari[áa]veis?\s+(b[áa]sicas?|primitivas?|e\s+tipos)\b/i,
      /\btipos\s+primitivos?\s*(b[áa]sicos?|fundament)?/i,
      /\boperadores\s+(aritm[ée]ticos|b[áa]sicos|de\s+atribui)/i,
      /\bexpress[oõ]es\s+aritm[ée]ticas\b/i,
      /\b(entrada|sa[íi]da)\s+(b[áa]sica|de\s+dados\s+b[áa]sica|com\s+(input|print)\(\))/i,
      /\binput\(\)\s+e\s+print\(\)/i,
      /\bprint\(\)\s+e\s+input\(\)/i,
      /\batribui[çc][aã]o\s+(simples|b[áa]sica|de\s+valores)\b/i,
      /\bhello\s+world\b/i,
      /\bsintaxe\s+b[áa]sica\s+do\s+python\b/i,
    ],
  },
];

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function isPythonCourse(courseTitle: string): boolean {
  return /\bpython\b/i.test(courseTitle);
}

export function getModuleRule(courseTitle: string, moduleTitle: string): ModuleRule | null {
  if (!isPythonCourse(courseTitle)) return null;
  for (const r of PYTHON_MODULE_RULES) {
    if (r.matchTitle.test(moduleTitle)) return r;
  }
  return null;
}

const GENERIC_OBJECTIVE_VERBS = [
  "compreender", "entender", "aplicar", "identificar", "conhecer", "estudar",
  "aprender", "explorar", "analisar", "examinar", "understand", "apply", "identify",
];

function isGenericObjective(text: string, moduleTitle: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  const mt = moduleTitle.trim().toLowerCase().replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/, "");
  if (!mt) return false;

  // v5.5.5 — looser pattern: ANY generic verb followed by a gerund glue word
  // ("trabalhando", "estudando", "explorando", "lidando com") is inherently
  // meta/empty regardless of suffix match. Catches "Compreender trabalhando
  // com JSON e APIs." even when module title doesn't match exactly.
  const gerundGlueRe = /^(compreender|entender|aplicar|identificar|conhecer|estudar|aprender|explorar|analisar|examinar)\s+(trabalhando|estudando|explorando|lidando|atuando|operando)\s+(com|em|sobre)\b/;
  if (gerundGlueRe.test(t)) return true;

  // Verb + module title (e.g. "Compreender Estruturas de Dados.")
  for (const v of GENERIC_OBJECTIVE_VERBS) {
    if (t === `${v} ${mt}.` || t === `${v} ${mt}`) return true;
    if (t.startsWith(`${v} ${mt}`) && t.length < mt.length + v.length + 8) return true;
    // Verb + first 2-3 words of module title
    const mtHead = mt.split(/\s+/).slice(0, 3).join(" ");
    if (mtHead.length > 8 && t === `${v} ${mtHead}.`) return true;
    // v5.2.4 — Verb + gerund-glue + module title (mechanical reformulation)
    // "Compreender trabalhando com JSON e APIs Web."
    // "Identificar trabalhando com Estruturas de Dados."
    const glues = ["trabalhando com", "estudando", "explorando", "atuando em", "atuando com", "lidando com"];
    for (const g of glues) {
      if (t === `${v} ${g} ${mt}.` || t === `${v} ${g} ${mt}`) return true;
      const mtHead2 = mt.split(/\s+/).slice(0, 4).join(" ");
      if (mtHead2.length > 8 && (t === `${v} ${g} ${mtHead2}.` || t.startsWith(`${v} ${g} ${mtHead2}`))) return true;
    }
  }
  return false;
}

function isTruncatedSentence(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 6) return false;
  // ends with comma/colon/dash/open-paren
  if (/[,:\-(]$/.test(t)) return true;
  // ends with ",." (split-token like "verdadeiro ou falso,.")
  if (/,\s*\.\s*$/.test(t)) return true;
  // common stripped-token patterns
  if (/\(\s*Ex\s*:\s*\)\s*\.?$/i.test(t)) return true;        // (Ex: )
  if (/\b\w+\s*\(\s*\)\s*\.\s*$/.test(t)) return true;        // "objeto ()."
  if (/\bcom\s+e\s+/i.test(t)) return true;                   // "com e"
  if (/\bcom\s*,\s+e\s+/i.test(t)) return true;               // "com, e" (leitura com, e escrita)
  if (/\bcom\s+:\s+/i.test(t)) return true;                   // "com :"
  if (/\s+\.\s*$/.test(t) && /\b(no|na|do|da|em|com)\s+\.\s*$/i.test(t)) return true; // "no ."
  // verb + bare ", e 'X'" — "modos de abertura, e 'a' corretamente"
  if (/,\s+e\s+'[^']{1,3}'/.test(t)) return true;
  // orphan comma inside parens — "(, ERROR)" / "( ,ERROR)"
  if (/\(\s*,/.test(t)) return true;
  // verb + bare "e" + preposition (no noun between) — "Trata e para garantir", "Captura e para feedback", "Utilizar e para definir"
  if (/\b(Trata|Tratar|Trate|Use|Usar|Usamos|Utiliza|Utilize|Utilizar|Utilizamos|Realize|Realizar|Define|Definir|Definimos|Cria|Criar|Criamos|Configura|Configurar|Configuramos|Aplica|Aplicar|Aplicamos|Manipula|Manipular|Implementa|Implementar|Organiza|Organizar|Faz|Faça|Fazemos|Captura|Capturar|Capture|Capturamos|Garante|Garantir|Garantimos|Permite|Permitir|Habilita|Habilitar|Verifica|Verificar|Analisa|Analisar|Identifica|Identificar|Prepara|Preparar|Limpa|Limpar|Busca|Buscar|Envia|Enviar)\s+e\s+(para|com|em|no|na|de|do|da)\b/i.test(t)) return true;
  // v5.2.4 — verb + " e <prep>" without conjunction subject ("Utiliza e para garantir robustez.")
  // Same verb list, allows the second word to be just a verb stem (not necessarily preposition)
  if (/\b(Utiliza|Usamos|Aplica|Aplicamos|Define|Definimos|Captura|Capturamos|Trata|Cria|Criamos|Faz|Fazemos)\s+e\s+(para|com)\b/i.test(t)) return true;
  // verb directly followed by "para" with no object — "Use para buscar", "Utilizar para enviar"
  // Restricted: must be a short fragment (<70 chars) AND have NO substantive
  // word between the verb and "para" (i.e. literally "Verb para X"). Long
  // pedagogical sentences like "Use list comprehensions para filtrar dados" are
  // already excluded by the `^Verb para` anchor. The 70-char gate avoids
  // flagging conversational "Use para iniciar a sessão e configurar o ambiente."
  if (
    t.length < 50 &&
    /^\s*(Use|Usar|Usamos|Utilize|Utilizar|Utilizamos|Aplique|Aplicar|Aplicamos|Realize|Realizar|Configure|Configurar|Configuramos|Defina|Definir|Definimos|Crie|Criar|Criamos)\s+para\b/i.test(t)
  ) return true;
  // v5.2.4 — verb + "para" mid-sentence with no object before "para" — "O comando X usamos para definir Y" → "Usamos para definir" stand-alone
  // Catch patterns where the verb-para starts a clause after punctuation (".", ":", ";")
  if (/(?:^|[.:;]\s+)(Usamos|Utilizamos|Aplicamos|Definimos|Criamos|Configuramos|Capturamos|Tratamos|Garantimos|Buscamos|Enviamos)\s+para\b/i.test(t)) return true;
  // v5.2.4 — bare "como e <short-noun>." trailing ("O método ... como e idade.")
  if (/\bcomo\s+e\s+[a-zà-ÿ]{2,15}\s*\.\s*$/i.test(t)) return true;
  // v5.2.4 — "como, e <short>" trailing ("...exceções comuns como, e 'a'.")
  if (/\bcomo\s*,\s*e\s+['"]?[a-zà-ÿ]{1,8}['"]?\s*\.\s*$/i.test(t)) return true;
  // leading "e" + verb (orphan conjunction) — "e preparam e limpam recursos."
  // Restricted to high-confidence truncations: short fragment (<60 chars) AND
  // either the verb is in 3rd-person plural ending in -am/-em/-m AND the line
  // contains a SECOND "e + verb" (the "...e preparam e limpam..." shape), OR
  // the line is very short (<35 chars) — both signal a stripped sentence head.
  // Avoids false positives on legitimate "E permitem a execução de..." prose.
  if (
    /^\s*[Ee]\s+[a-zà-ÿ]+(am|em|m)\b/.test(t) &&
    (
      (t.length < 60 && /\be\s+[a-zà-ÿ]+(am|em|m)\b/i.test(t.slice(3))) ||
      t.length < 35
    )
  ) return true;
  // bare "Que X" without "Por" — "Que Boas Práticas de Código?"
  // Tightened to avoid false positives on legitimate Portuguese pedagogy
  // text starting with "Que" (e.g. "Que os alunos identifiquem..."):
  // require either (a) the line ends with "?" or (b) at least TWO
  // consecutive Title-Case words after "Que" (a Title-Case noun phrase).
  if (
    /^\s*Que\s+[A-ZÁÉÍÓÚÂÊÔÃÕ]/.test(t) &&
    !/\bPor\s+Que\b/i.test(t) &&
    (/\?\s*$/.test(t) || /^\s*Que\s+[A-ZÁÉÍÓÚÂÊÔÃÕ][a-zà-ÿ]+\s+[A-ZÁÉÍÓÚÂÊÔÃÕ][a-zà-ÿ]+/.test(t))
  ) {
    return true;
  }
  // "X e Y para Z" with bare "e" between same-stem verbs ("leitura com, e escrita...")
  if (/\b(leitura|escrita|abertura|fechamento|entrada|sa[íi]da)\s+com\s*,/i.test(t)) return true;
  return false;
}

// Cross-module basic-leak: an advanced module (POO / Boas Práticas / etc)
// must NOT teach a fundamentals topic (variáveis, operadores, print/input
// as topic, etc). Used in addition to per-module denyPatterns.
const ADVANCED_MODULE_TITLE_RE =
  /(POO|orientad[ao]\s+a\s+objet|object\s*oriented|heran[çc]a|encapsul|polimorf|boas\s+pr[áa]ticas|best\s+practices|implant|deploy|produc|avan[çc]ad|otimiz|performance|ci[\/\-]?cd|monitora|seguran[çc]a|refactor|arquitetura|testes?\s+|tests?\b|logs?\b|depura[çc][aã]o|debug)/i;
const FUNDAMENTALS_TOPIC_RE =
  /(\bvari[áa]veis\s+(b[áa]sicas?|primitivas?|e\s+tipos|simples)\b|\bvari[áa]veis\s*,?\s*tipos\s+e\s+operadores\b|\bcom\s+vari[áa]veis\s*,\s*tipos\s+e\s+operadores\b|\btipos\s+primitivos?\b|\boperadores\s+(aritm[ée]ticos|b[áa]sicos|de\s+atribui)|\bexpress[oõ]es\s+aritm[ée]ticas\b|\bexpress[oõ]es\s+e\s+atribui[çc][oõ]es\b|\bcriar\s+express[oõ]es\b|\bhello\s+world\b|\bsintaxe\s+b[áa]sica\s+do\s+python\b|\batribui[çc][aã]o\s+(simples|b[áa]sica|de\s+valores)\b|\b(entrada|sa[íi]da)\s+(b[áa]sica|de\s+dados\s+b[áa]sica)\b|\bentrada\s+e\s+sa[íi]da\s+com\s+vari[áa]veis\b|\baplicar\s+entrada\s+e\s+sa[íi]da\b|\binput\(\)\s+e\s+print\(\)|\bprint\(\)\s+e\s+input\(\))/i;

function isCrossModuleBasicLeak(text: string, moduleTitle: string): boolean {
  if (!text || !moduleTitle) return false;
  if (!ADVANCED_MODULE_TITLE_RE.test(moduleTitle)) return false;
  return FUNDAMENTALS_TOPIC_RE.test(text);
}

// v5.5.3 — bare-fundamentals title in an advanced module is contamination.
// FUNDAMENTALS_TOPIC_RE requires "variáveis" + qualifier ("básicas"/"e tipos"
// /etc), so a slide titled JUST "Variáveis" or "Operadores" inside the OOP /
// tests / best_practices module slips through. This detector catches those
// short, generic titles that are unambiguously fundamentals topics when they
// appear in a module that should be teaching advanced material.
const BARE_FUNDAMENTALS_TITLE_RE =
  /^\s*(vari[áa]veis|operadores|tipos\s+de\s+dados(\s+primitivos)?|tipos\s+primitivos|express[oõ]es(\s+aritm[ée]ticas)?|hello\s+world|sintaxe\s+b[áa]sica(\s+do\s+python)?|entrada\s+e\s+sa[íi]da(\s+com\s+(input|print)\(\))?|input\(\)\s+e\s+print\(\)|print\(\)\s+e\s+input\(\)|atribui[çc][aã]o(\s+(simples|b[áa]sica|de\s+valores))?)\s*[:.!?]?\s*$/i;

function isBareFundamentalsTitleInAdvancedModule(
  title: string,
  moduleTitle: string,
): boolean {
  if (!title || !moduleTitle) return false;
  if (!ADVANCED_MODULE_TITLE_RE.test(moduleTitle)) return false;
  return BARE_FUNDAMENTALS_TITLE_RE.test(title.trim());
}

// v5.5.3 — repair duplicated/orphan prepositions like "dos de Python",
// "de de Python", "da da Lista". Common output of cascading sanitizers
// stripping a noun in the middle. Returns the cleaned string.
const DUPLICATE_PREP_RE =
  /\b(de|do|da|dos|das|em|no|na|nos|nas)\s+(de|do|da|dos|das|em|no|na|nos|nas)\b/gi;
function repairOrphanPrepositions(text: string): string {
  if (!text) return text;
  // Collapse "X Y" → "Y" (keep the second, more specific preposition)
  return text.replace(DUPLICATE_PREP_RE, (_m, _a, b) => b);
}

// v5.5.3 — OOP positivity check used by the per-module gate.
// Returns the fraction of slides in this module that mention any OOP
// keyword (class, classe, objeto, método, atributo, instância, herança,
// encapsulamento, polimorfismo, self, __init__). When the module is
// labeled OOP and this fraction falls below the threshold, the module
// is contaminated and should be rejected.
const OOP_KEYWORD_RE =
  /\b(class\b|classe|objeto|m[ée]todo|atributo|inst[âa]ncia|heran[çc]a|encapsulamento|polimorfismo|self\b|__init__|super\(\))/i;
export function computeOopPositivityFraction(slides: PresentationSlide[]): number {
  if (!slides || slides.length === 0) return 0;
  let hits = 0;
  for (const s of slides) {
    const blob = [
      s.title ?? "",
      ...(s.items ?? []),
      s.code ?? "",
      ...((s as any).leftItems ?? []),
      ...((s as any).rightItems ?? []),
    ].join(" ");
    if (OOP_KEYWORD_RE.test(blob)) hits++;
  }
  return hits / slides.length;
}

// ═══════════════════════════════════════════════════════════
// v5.2.3 — Stronger broken-sentence detection (BROKEN_SEMANTIC_SENTENCE)
// Patterns user reported as still leaking:
//   - "Acessar Membros: Usar."                (verb-only after colon)
//   - "Principais Aprendizados de Arquivos e" (ends in " e")
//   - "Realize leitura (, )..."               (empty parens "(, )")
//   - "...usar."                              (one-word predicate after colon)
// Returns the issue subtype string ("broken" or "truncated") or null.
// Used to populate BROKEN_SEMANTIC_SENTENCE issues which are HARD blockers.
// ═══════════════════════════════════════════════════════════
function detectBrokenSemanticSentence(text: string): string | null {
  if (!text) return null;
  const t = text.trim();
  if (t.length < 6) return null;
  // Ends with bare " e" or " e." (short fragment only — long bullets ending
  // in " e" as a deliberate continuation marker are valid pedagogy)
  if (t.length < 60 && /\s+e\s*\.?\s*$/.test(t)) return "ends_with_bare_e";
  // Ends with bare " ou" or " ou." (same length guard)
  if (t.length < 60 && /\s+ou\s*\.?\s*$/.test(t)) return "ends_with_bare_ou";
  // X: Verb. — short capitalized verb after colon (Acessar Membros: Usar.)
  if (/:\s*[A-ZÁÉÍÓÚÂÊÔÃÕ][a-zà-ÿ]{1,9}\s*\.\s*$/.test(t)) return "verb_only_after_colon";
  // Empty parens with comma — "(, )" / "( , )"
  if (/\(\s*,\s*\)/.test(t)) return "empty_comma_parens";
  // Single-word imperative with period — "Usar." / "Aplicar."
  if (/^\s*(Usar|Aplicar|Definir|Configurar|Criar|Realizar|Implementar|Manipular|Tratar|Gerenciar|Organizar|Validar|Verificar|Capturar|Habilitar|Permitir|Garantir)\s*\.\s*$/i.test(t)) return "lone_verb";
  // Trailing "Verbar." after preposition (de/com/em/no/na/para) — "para usar."
  if (/\b(de|com|em|no|na|para|sobre|pelo|pela)\s+(usar|aplicar|definir|criar|configurar|implementar|gerenciar|tratar)\s*\.\s*$/i.test(t)) return "verb_only_after_prep";
  return null;
}

// ═══════════════════════════════════════════════════════════
// v5.2.3 — Per-module OBJECTIVE rules (covers/takeaways/closing).
// Stricter than allow/deny used for content slides — these run on
// objective-class slides where the text MUST sound module-aligned.
// kind is the same string returned by getModuleRule (Python rules).
// ═══════════════════════════════════════════════════════════
const MODULE_OBJECTIVE_FORBIDDEN: Record<string, RegExp> = {
  best_practices: /(\bvari[áa]ve(is|l)\s+(b[áa]sicas?|primitivas?|simples)?\b|\btipos?\s+primitivos?\b|\boperadores?\s+(aritm[ée]ticos?|b[áa]sicos?|de\s+atribui)|\bexpress[oõ]es\s+(aritm[ée]ticas|e\s+atribui)|\bcriar?\s+express[oõ]es\b|\bhello\s+world\b|\binput\(\)|\bprint\(\)|\bentrada\s+e\s+sa[íi]da\s+(com\s+vari|b[áa]sica)|\baplicar\s+entrada\s+e\s+sa[íi]da\b|\batribui[çc][aã]o\s+(simples|b[áa]sica))/i,
  oop: /(\bvari[áa]ve(is|l)\s+(b[áa]sicas?|primitivas?|simples)?\b|\btipos?\s+primitivos?\b|\boperadores?\s+(aritm[ée]ticos?|b[áa]sicos?)|\bexpress[oõ]es\s+aritm[ée]ticas\b|\bhello\s+world\b|\binput\(\)\s+e\s+print\(\)|\bsintaxe\s+b[áa]sica\b)/i,
  tests_logs: /(\bvari[áa]ve(is|l)\s+(b[áa]sicas?|primitivas?)\b|\btipos?\s+primitivos?\b|\boperadores?\s+aritm[ée]ticos?\b|\bexpress[oõ]es\s+aritm[ée]ticas\b|\bhello\s+world\b)/i,
  json_apis: /(\bvari[áa]ve(is|l)\s+(b[áa]sicas?|primitivas?)\b|\btipos?\s+primitivos?\b|\bhello\s+world\b)/i,
  files_exceptions: /(\bvari[áa]ve(is|l)\s+(b[áa]sicas?|primitivas?)\b|\bhello\s+world\b)/i,
  data_structures: /(\bhello\s+world\b)/i,
  control_flow: /(\bhello\s+world\b)/i,
};

// Module-aligned objective fallbacks — used by repairModuleObjective
// when an objective is dropped due to violation. Cycled per slide.
const MODULE_OBJECTIVE_FALLBACKS: Record<string, string[]> = {
  fundamentals: [
    "Compreender variáveis, tipos primitivos e operadores em Python.",
    "Escrever expressões aritméticas e usar entrada/saída com print() e input().",
    "Aplicar atribuição e conversão de tipos em pequenos programas.",
  ],
  control_flow: [
    "Aplicar estruturas condicionais if/elif/else para decisões em Python.",
    "Usar laços for e while com break e continue para repetição controlada.",
    "Definir funções com parâmetros, retorno e escopo local em Python.",
  ],
  data_structures: [
    "Manipular listas, tuplas e dicionários em Python para organizar dados.",
    "Aplicar fatiamento, indexação e iteração sobre coleções nativas.",
    "Escolher entre list, set e dict conforme o caso de uso em Python.",
  ],
  files_exceptions: [
    "Ler e escrever arquivos texto em Python usando open() e with.",
    "Tratar exceções com try/except/finally para programas robustos.",
    "Usar context managers para garantir liberação correta de recursos.",
  ],
  json_apis: [
    "Interpretar dados JSON recebidos de APIs Web em Python.",
    "Serializar e desserializar objetos com json.dumps() e json.loads().",
    "Realizar requisições HTTP com requests.get() e requests.post().",
    "Validar respostas usando response.status_code antes de processar.",
    "Converter respostas com response.json() para dicionários e listas Python.",
  ],
  oop: [
    "Modelar entidades com classes, atributos e métodos em Python.",
    "Aplicar herança, encapsulamento e polimorfismo em projetos Python.",
    "Usar __init__, self e super() corretamente em hierarquias de classes.",
  ],
  tests_logs: [
    "Escrever testes unitários com unittest ou pytest para validar funções.",
    "Configurar logging com níveis (DEBUG, INFO, WARNING, ERROR) em Python.",
    "Depurar programas Python com pdb e mensagens de log estruturadas.",
  ],
  best_practices: [
    "Aplicar PEP 8 para estilo, nomes e organização de código Python.",
    "Gerenciar dependências e ambientes virtuais com venv e pip.",
    "Estruturar projetos Python com pacotes, módulos e setup/pyproject.",
    "Documentar funções e classes com docstrings claras e padronizadas.",
    "Configurar logging em produção e preparar deploy de aplicações Python.",
  ],
};

function isObjectiveSlide(intent: PlanIntent): boolean {
  return intent === "module_cover" || intent === "takeaways" ||
    intent === "summary" || intent === "closing";
}

function validateModuleObjective(
  text: string,
  moduleKind: string,
  moduleTitle: string,
): boolean {
  if (!text) return true;
  // Cross-module fundamentals leak
  if (isCrossModuleBasicLeak(text, moduleTitle)) return false;
  const re = MODULE_OBJECTIVE_FORBIDDEN[moduleKind];
  if (re && re.test(text)) return false;
  return true;
}

function repairModuleObjective(moduleKind: string, idx: number): string | null {
  const list = MODULE_OBJECTIVE_FALLBACKS[moduleKind];
  if (!list || list.length === 0) return null;
  return list[idx % list.length];
}

// ═══════════════════════════════════════════════════════════
// v5.2.3 — Code snippet validation/repair
// A useful snippet has at least 2 non-trivial lines AND demonstrates
// observable behaviour (print/return/yield/log/raise/assert/output).
// A single-line bare assignment ("soma = sum(dados)") is INCOMPLETE.
// ═══════════════════════════════════════════════════════════
function validateCodeSnippet(code: string, language: string | undefined): boolean {
  if (!code) return true; // no code is fine
  const lang = (language ?? "python").toLowerCase();
  const lines = code.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return true;
  // 1+ line: must show observable behaviour somewhere
  const observable = lines.some((l) =>
    /\b(print|return|yield|raise|assert|log(ger|ging)?\.\w+|console\.\w+|sys\.std)\b/.test(l) ||
    /=>/.test(l) ||
    /[#]\s*(output|sa[íi]da|resultado|prints?|=>)/i.test(l)
  );
  // Comment-only or import-only does not count
  const meaningfulLines = lines.filter((l) =>
    !l.startsWith("#") && !l.startsWith("//") && !/^from\s+\w+\s+import\b/.test(l) && !/^import\s+\w+/.test(l)
  );
  if (meaningfulLines.length === 0) return false;
  // Single-line bare assignment without observable result → incomplete
  if (lines.length <= 1 && !observable) return false;
  // Multi-line code with ONLY simple assignments and no observable
  // (no def/class/loop/if/with/try/call) → incomplete demonstration
  if (!observable) {
    const hasStructure = meaningfulLines.some((l) =>
      /^(def|class|for|while|if|elif|else|with|try|except|finally|@\w)\b/.test(l) ||
      /\w+\s*\([^)]*\)\s*$/.test(l)
    );
    if (!hasStructure) return false;
  }
  // Multi-line but ends in dangling `=` / `,` / `(` → incomplete
  const last = lines[lines.length - 1];
  if (/[=,(]\s*$/.test(last)) return false;
  // Python def/class with empty body → incomplete
  if (lang === "python") {
    const lastIsHeader = /^(def|class)\s+\w+.*:\s*$/.test(last);
    if (lastIsHeader) return false;
  }
  return true;
}

// v5.2.4 — Common Python typos with deterministic fixes (super().init etc.)
function repairPythonApiTypos(code: string): string {
  if (!code) return code;
  let out = code;
  // super().init(...) → super().__init__(...)
  out = out.replace(/\bsuper\(\)\.init\b(?=\s*\()/g, "super().__init__");
  // .init( on instance/class (not already __init__)
  out = out.replace(/(\w)\.init\s*\(/g, (m, p1) => p1 === "_" ? m : `${p1}.__init__(`);
  // method definition typo: def init(self, ...) → def __init__(self, ...)
  out = out.replace(/\bdef\s+init\s*\(/g, "def __init__(");
  // Single-underscore dunder typos
  out = out.replace(/\b__init_\(/g, "__init__(");
  out = out.replace(/\b_init__\(/g, "__init__(");
  return out;
}

function repairCodeSnippet(code: string, language: string | undefined): string {
  if (!code) return code;
  const lang = (language ?? "python").toLowerCase();
  // v5.2.4 — fix common API typos FIRST (super().init → super().__init__)
  let working = lang === "python" ? repairPythonApiTypos(code) : code;
  const lines = working.split("\n");
  const trimmedLines = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (trimmedLines.length === 0) return working;
  // Single bare assignment "X = expr" → append print(X) (Python)
  if (lang === "python" && trimmedLines.length === 1) {
    const m = trimmedLines[0].match(/^([A-Za-z_]\w*)\s*=\s*[^=]/);
    if (m) {
      return `${working.replace(/\s+$/, "")}\nprint(${m[1]})`;
    }
  }
  // Last line is dangling header (Python def/class with no body)
  if (lang === "python") {
    const last = trimmedLines[trimmedLines.length - 1];
    if (/^def\s+\w+.*:\s*$/.test(last)) {
      return `${working.replace(/\s+$/, "")}\n    pass`;
    }
    if (/^class\s+\w+.*:\s*$/.test(last)) {
      return `${working.replace(/\s+$/, "")}\n    pass`;
    }
  }
  return working;
}

function looksLikeCodeLine(line: string): boolean {
  if (!line) return false;
  const l = line.trim();
  // multi-line → likely code
  if (l.includes("\n")) return true;
  // common code signatures
  if (/^(def\s|class\s|import\s|from\s+\w+\s+import|return\s|print\s*\()/.test(l)) return true;
  if (/^(if|for|while|try|except|with)\s+.+:\s*$/.test(l)) return true;
  if (/^\s*\w+\s*=\s*[\w'"\[{(]/.test(l) && l.length > 30) return true;
  // braces / semicolons
  if (/[{};]\s*$/.test(l) && l.length > 20) return true;
  return false;
}

function jaccard(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (wa.size === 0 && wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

// ═══════════════════════════════════════════════════════════
// Prompt builder — strict per-module contract
// ═══════════════════════════════════════════════════════════

function buildPlanPrompt(
  courseTitle: string,
  moduleTitle: string,
  moduleIndex: number,
  moduleContent: string,
  language: string,
  audience: string | undefined,
  rule: ModuleRule | null,
): string {
  const snippet = (moduleContent || "")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/[`_]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 3500);

  const ruleBlock = rule
    ? `
════ MODULE-SPECIFIC SCOPE — "${rule.kind}" ════
ALLOWED CONCEPTS for this module (you MAY teach these):
${rule.allow.map((a) => `  ✓ ${a}`).join("\n")}

FORBIDDEN CONCEPTS for this module (NEVER include — even as examples):
${rule.deny.map((d) => `  ✗ ${d}`).join("\n")}

If the source content drifts into forbidden territory, IGNORE that drift —
re-anchor the slide to the allowed concepts above. The slide deck for this
module is for "${rule.kind}" only.`
    : "";

  const audienceBlock = audience
    ? `Target audience: ${audience}.`
    : "";

  return `You are a senior instructional designer. You are NOT writing a textbook —
you are writing a PRESENTATION DECK. One slide = one idea.

COURSE: "${courseTitle}"
MODULE ${moduleIndex + 1}: "${moduleTitle}"
${audienceBlock}

SOURCE CONTENT (treat as ground truth — do NOT invent facts outside it):
---
${snippet}
---
${ruleBlock}

════ HARD CONTRACT ════
1. Output language: ${language}. Every word of every field must be in ${language}.
2. **Generate EXACTLY 3 to 5 slides. NEVER 6 or more.** Quality over quantity.
   The deck is for an introductory course — long modules are exhausting.
   Prefer 3 slides for short/simple modules; use 4-5 only when the module
   genuinely needs the extra depth (multi-part concept + example + recap).
3. **MODULE COHERENCE — CRITICAL.** Every slide MUST teach a concept that
   belongs to "${moduleTitle}". Do NOT teach concepts that belong to other
   modules (e.g. if this module is "POO", do NOT include slides about
   variables/types/operators/print/input as topics — those belong to
   the Fundamentals module). Fundamentals concepts may only appear as
   incidental code, never as the main idea.
4. Each slide MUST have ONE main idea. Never mix concept + example + code on
   the same slide — split them into multiple slides.
5. Items: max 5 per slide. Each item ≤ 15 words, complete sentence ending in
   a period. **No truncation.** No bullet prefixes ("•", "-", "1.", etc).
   Avoid split-token artifacts like "verdadeiro ou falso,." or "leitura com, e".
6. Code: max 12 lines. Code MUST go in the "code" field, NEVER inside "items".
7. Long explanations belong in "speakerNotes", not in items.
8. NO duplicate slides. NO consecutive slides covering the same idea. Each
   slide must teach something distinct.
9. NO generic objectives. FORBIDDEN item shapes:
     "Compreender ${moduleTitle}"
     "Aplicar ${moduleTitle}"
     "Identificar ${moduleTitle}"
   Replace with concrete outcomes (e.g. "Declarar variáveis e atribuir
   valores usando = em Python.").

════ SLIDE INTENTS (use these literal values) ════
- "concept"         → definition / principle / theory
- "example"         → real-world use case (no code)
- "code_walkthrough"→ runnable code with brief context
- "process"         → ordered steps / pipeline (3–5 steps, action verbs)
- "comparison"      → exactly two things contrasted (left vs right)
- "cards"           → 3–4 named items, each "Term: short explanation"
- "takeaways"       → key learnings (use as the LAST slide of the module)
- "summary"         → recap (alternative to takeaways)

Layout hint should match intent:
  concept|example     → "bullets" or "cards"
  code_walkthrough    → "code"
  process             → "process"
  comparison          → "comparison"
  cards               → "cards"
  takeaways|summary   → "takeaways"

The LAST slide of your output MUST have intent "takeaways".

════ OUTPUT ════
Return ONLY a valid JSON array of slide objects. No markdown fences, no
commentary. Schema (use the matching shape per intent):

[
  {
    "intent": "concept",
    "layoutHint": "bullets",
    "title": "Specific descriptive title (5–60 chars)",
    "items": ["full sentence 1.", "full sentence 2.", "full sentence 3."],
    "speakerNotes": "Optional longer narration / context for the presenter."
  },
  {
    "intent": "code_walkthrough",
    "layoutHint": "code",
    "title": "What this code does",
    "items": ["one or two short context lines."],
    "code": "def hello():\\n    print('hi')",
    "codeLanguage": "Python"
  },
  {
    "intent": "comparison",
    "layoutHint": "comparison",
    "title": "A vs B",
    "leftHeader": "A",
    "rightHeader": "B",
    "leftItems": ["fact 1.", "fact 2."],
    "rightItems": ["fact 1.", "fact 2."]
  },
  {
    "intent": "takeaways",
    "layoutHint": "takeaways",
    "title": "Key takeaways from ${moduleTitle}",
    "items": ["concrete outcome 1.", "concrete outcome 2.", "concrete outcome 3."]
  }
]`;
}

// ═══════════════════════════════════════════════════════════
// LLM call
// ═══════════════════════════════════════════════════════════

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

async function callPlannerLLM(prompt: string, geminiKey: string): Promise<string> {
  const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 8000,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Planner LLM error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
}

// ═══════════════════════════════════════════════════════════
// Parse + normalize
// ═══════════════════════════════════════════════════════════

const VALID_INTENTS: PlanIntent[] = [
  "module_cover", "concept", "example", "code_walkthrough", "process",
  "comparison", "cards", "takeaways", "summary", "closing",
];
const VALID_LAYOUT_HINTS: PlanLayoutHint[] = [
  "bullets", "cards", "code", "process", "comparison", "twocol", "takeaways",
];

function intentToLayoutHint(intent: PlanIntent): PlanLayoutHint {
  switch (intent) {
    case "code_walkthrough": return "code";
    case "process": return "process";
    case "comparison": return "comparison";
    case "cards": return "cards";
    case "takeaways":
    case "summary":
    case "closing": return "takeaways";
    default: return "bullets";
  }
}

function parsePlannerOutput(
  raw: string,
  moduleIndex: number,
  moduleTitle: string,
): PresentationSlide[] {
  let parsed: any[];
  try {
    const clean = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) throw new Error("Not array");
  } catch {
    return [];
  }

  // HARD CAP: max MAX_PLANNER_SLIDES_PER_MODULE slides per module
  // (regardless of what the LLM returned). Keep the LAST slide if it's
  // takeaways/summary so the module ends well.
  if (parsed.length > MAX_PLANNER_SLIDES_PER_MODULE) {
    const lastIsRecap = parsed.length > 0 &&
      ["takeaways", "summary", "closing"].includes(parsed[parsed.length - 1]?.intent);
    const recap = lastIsRecap ? parsed[parsed.length - 1] : null;
    parsed = recap
      ? [...parsed.slice(0, MAX_PLANNER_SLIDES_PER_MODULE - 1), recap]
      : parsed.slice(0, MAX_PLANNER_SLIDES_PER_MODULE);
  }

  return parsed.map((s: any, idx: number): PresentationSlide => {
    const intent: PlanIntent = VALID_INTENTS.includes(s.intent)
      ? s.intent
      : "concept";
    const layoutHint: PlanLayoutHint = VALID_LAYOUT_HINTS.includes(s.layoutHint)
      ? s.layoutHint
      : intentToLayoutHint(intent);

    const items = Array.isArray(s.items)
      ? s.items.map((x: any) => String(x).trim()).filter((x: string) => x.length > 0)
      : [];

    const focal: PresentationSlide["focalElement"] =
      intent === "code_walkthrough" ? "code"
      : intent === "comparison" ? "comparison"
      : intent === "cards" ? "list"
      : "text";

    return {
      id: `M${moduleIndex + 1}.S${idx + 1}`,
      moduleIndex,
      title: String(s.title || "").trim().slice(0, 80),
      intent,
      layoutHint,
      density: "standard",
      visualPriority: intent === "takeaways" ? "high" : "medium",
      focalElement: focal,
      items,
      code: s.code ? String(s.code).slice(0, 1500) : undefined,
      codeLanguage: s.codeLanguage ? String(s.codeLanguage).slice(0, 20) : undefined,
      leftHeader: s.leftHeader ? String(s.leftHeader).trim().slice(0, 40) : undefined,
      rightHeader: s.rightHeader ? String(s.rightHeader).trim().slice(0, 40) : undefined,
      leftItems: Array.isArray(s.leftItems)
        ? s.leftItems.map((x: any) => String(x).trim()).filter((x: string) => x.length > 0).slice(0, 5)
        : undefined,
      rightItems: Array.isArray(s.rightItems)
        ? s.rightItems.map((x: any) => String(x).trim()).filter((x: string) => x.length > 0).slice(0, 5)
        : undefined,
      speakerNotes: s.speakerNotes ? String(s.speakerNotes).slice(0, 600) : undefined,
      sourceModuleTitle: moduleTitle,
    };
  });
}

// ═══════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════

export function validatePresentationPlan(
  plan: PresentationPlan,
  courseTitle: string,
): PlanValidationReport {
  const issues: PlanIssue[] = [];

  for (const mod of plan.modules) {
    const rule = getModuleRule(courseTitle, mod.moduleTitle);
    const moduleKind = rule?.kind ?? "";
    const seen: { title: string; firstItems: string }[] = [];

    for (const slide of mod.slides) {
      const sid = slide.id;

      // 1. Missing title
      if (!slide.title || slide.title.length < 3) {
        issues.push({
          slideId: sid, moduleIndex: mod.moduleIndex,
          type: "MISSING_TITLE",
          message: `Slide sem título`,
          severity: "fatal",
        });
        continue;
      }

      // 2. Empty slide (no items + no code)
      if ((!slide.items || slide.items.length === 0) &&
          !slide.code &&
          (!slide.leftItems || slide.leftItems.length === 0) &&
          (!slide.rightItems || slide.rightItems.length === 0)) {
        issues.push({
          slideId: sid, moduleIndex: mod.moduleIndex,
          type: "EMPTY_SLIDE",
          message: `Slide "${slide.title}" sem conteúdo útil`,
          severity: "fatal",
        });
        continue;
      }

      // 3. Invalid intent (already coerced in parse but defensive)
      if (!VALID_INTENTS.includes(slide.intent)) {
        issues.push({
          slideId: sid, moduleIndex: mod.moduleIndex,
          type: "INVALID_INTENT",
          message: `Intent inválido: ${String(slide.intent)}`,
          severity: "fixable",
        });
      }

      // 4. Too many bullets
      if (slide.items && slide.items.length > 5) {
        issues.push({
          slideId: sid, moduleIndex: mod.moduleIndex,
          type: "TOO_MANY_BULLETS",
          message: `${slide.items.length} bullets (max 5)`,
          severity: "fixable",
        });
      }

      // 5. Code too long
      if (slide.code) {
        const lines = slide.code.split("\n").length;
        if (lines > 12) {
          issues.push({
            slideId: sid, moduleIndex: mod.moduleIndex,
            type: "CODE_TOO_LONG",
            message: `Código com ${lines} linhas (max 12)`,
            severity: "fixable",
          });
        }
      }

      // 6a. Title + headers — domain + truncation + generic checks
      const titleAndHeaders: { kind: string; txt: string }[] = [
        { kind: "title", txt: slide.title },
      ];
      if (slide.leftHeader) titleAndHeaders.push({ kind: "leftHeader", txt: slide.leftHeader });
      if (slide.rightHeader) titleAndHeaders.push({ kind: "rightHeader", txt: slide.rightHeader });
      for (const { kind, txt } of titleAndHeaders) {
        if (rule) {
          for (const dp of rule.denyPatterns) {
            if (dp.test(txt)) {
              const isPyMod = isPythonCourse(courseTitle);
              issues.push({
                slideId: sid, moduleIndex: mod.moduleIndex,
                type: isPyMod && /SQL|TABLE|JOIN|SELECT|INSERT|UPDATE|DELETE|TRUNCATE/.test(dp.source)
                  ? "SQL_IN_PYTHON" : "DOMAIN_CONTAMINATION",
                message: `Contaminação no ${kind} de "${slide.title}": "${txt.slice(0, 60)}"`,
                severity: "fatal",
              });
              break;
            }
          }
        }
      }

      // 6b. Code field — domain contamination ONLY (size already checked).
      // We do NOT flag truncation/generic in code (that's prose-only).
      if (slide.code && rule) {
        for (const dp of rule.denyPatterns) {
          if (dp.test(slide.code)) {
            const isPyMod = isPythonCourse(courseTitle);
            issues.push({
              slideId: sid, moduleIndex: mod.moduleIndex,
              type: isPyMod && /SQL|TABLE|JOIN|SELECT|INSERT|UPDATE|DELETE|TRUNCATE/.test(dp.source)
                ? "SQL_IN_PYTHON" : "DOMAIN_CONTAMINATION",
              message: `Código fora do escopo do módulo "${mod.moduleTitle}" (${rule.kind}): "${slide.code.slice(0, 80)}"`,
              severity: "fatal",
            });
            break;
          }
        }
      }

      // 6c. Per-item checks (items + leftItems + rightItems)
      const allItems = [
        ...(slide.items ?? []),
        ...(slide.leftItems ?? []),
        ...(slide.rightItems ?? []),
      ];
      for (const it of allItems) {
        if (!it || !it.trim()) {
          issues.push({
            slideId: sid, moduleIndex: mod.moduleIndex,
            type: "EMPTY_ITEM",
            message: `Item vazio em "${slide.title}"`,
            severity: "fixable",
          });
          continue;
        }
        if (isGenericObjective(it, mod.moduleTitle)) {
          issues.push({
            slideId: sid, moduleIndex: mod.moduleIndex,
            type: "GENERIC_OBJECTIVE",
            message: `Objetivo genérico em "${slide.title}": "${it.slice(0, 80)}"`,
            severity: "fixable",
          });
        }
        if (isTruncatedSentence(it)) {
          issues.push({
            slideId: sid, moduleIndex: mod.moduleIndex,
            type: "TRUNCATED_SENTENCE",
            message: `Frase truncada em "${slide.title}": "${it.slice(0, 80)}"`,
            severity: "fixable",
          });
        }
        // v5.2.3 — broken semantic sentence (HARD blocker)
        const brokenKind = detectBrokenSemanticSentence(it);
        if (brokenKind) {
          issues.push({
            slideId: sid, moduleIndex: mod.moduleIndex,
            type: "BROKEN_SEMANTIC_SENTENCE",
            message: `Frase quebrada (${brokenKind}) em "${slide.title}": "${it.slice(0, 80)}"`,
            severity: "fixable",
          });
        }
        // v5.2.3 — module-objective violation on objective-class slides
        if (isObjectiveSlide(slide.intent) && moduleKind &&
            !validateModuleObjective(it, moduleKind, mod.moduleTitle)) {
          issues.push({
            slideId: sid, moduleIndex: mod.moduleIndex,
            type: "MODULE_OBJECTIVE_VIOLATION",
            message: `Objetivo desalinhado com "${mod.moduleTitle}" (${moduleKind}): "${it.slice(0, 80)}"`,
            severity: "fixable",
          });
        }
        if (slide.intent !== "code_walkthrough" && looksLikeCodeLine(it)) {
          issues.push({
            slideId: sid, moduleIndex: mod.moduleIndex,
            type: "CODE_IN_BULLET",
            message: `Código em bullet em "${slide.title}": "${it.slice(0, 80)}"`,
            severity: "fixable",
          });
        }
        // 7a. Module-scoped domain enforcement (allow/deny lists)
        if (rule) {
          for (const dp of rule.denyPatterns) {
            if (dp.test(it)) {
              const isPyMod = isPythonCourse(courseTitle);
              issues.push({
                slideId: sid, moduleIndex: mod.moduleIndex,
                type: isPyMod && /SQL|TABLE|JOIN|SELECT|INSERT|UPDATE|DELETE|TRUNCATE/.test(dp.source)
                  ? "SQL_IN_PYTHON"
                  : "DOMAIN_CONTAMINATION",
                message: `Conteúdo fora do escopo do módulo "${mod.moduleTitle}" (${rule.kind}): "${it.slice(0, 80)}"`,
                severity: "fixable",
              });
              break;
            }
          }
        }
        // 7b. Cross-module basic leak (advanced module teaching fundamentals)
        if (isCrossModuleBasicLeak(it, mod.moduleTitle)) {
          issues.push({
            slideId: sid, moduleIndex: mod.moduleIndex,
            type: "DOMAIN_CONTAMINATION",
            message: `Cross-module leak em "${mod.moduleTitle}" (tópico de fundamentos): "${it.slice(0, 80)}"`,
            severity: "fixable",
          });
        }
      }
      // 7c. Cross-module leak in slide TITLE (advanced module with
      // fundamentals topic in the title is a hard fail).
      if (isCrossModuleBasicLeak(slide.title, mod.moduleTitle)) {
        issues.push({
          slideId: sid, moduleIndex: mod.moduleIndex,
          type: "DOMAIN_CONTAMINATION",
          message: `Título com tópico de fundamentos no módulo "${mod.moduleTitle}": "${slide.title}"`,
          severity: "fatal",
        });
      }
      // v5.5.3 — 7d. Bare fundamentals title in advanced module.
      // Catches short, generic titles like "Variáveis", "Operadores",
      // "Hello World", "Entrada e Saída" inside OOP / tests / best_practices
      // modules that FUNDAMENTALS_TOPIC_RE doesn't match because it requires
      // an explicit qualifier (básicas / primitivas / e tipos / etc).
      // Also catches the Python-deck regression user reported (slides 34/35/37
      // of module 6 POO showing variáveis/operadores/input-print).
      if (
        isBareFundamentalsTitleInAdvancedModule(slide.title, mod.moduleTitle)
      ) {
        issues.push({
          slideId: sid, moduleIndex: mod.moduleIndex,
          type: "DOMAIN_CONTAMINATION",
          message: `Título de fundamentos puro no módulo avançado "${mod.moduleTitle}": "${slide.title}"`,
          severity: "fatal",
        });
      }
      // v5.2.3 — broken semantic sentence in TITLE / headers (hard)
      for (const f of [slide.title, slide.leftHeader, slide.rightHeader]) {
        if (!f) continue;
        const bk = detectBrokenSemanticSentence(f);
        if (bk) {
          issues.push({
            slideId: sid, moduleIndex: mod.moduleIndex,
            type: "BROKEN_SEMANTIC_SENTENCE",
            message: `Título/cabeçalho quebrado (${bk}): "${f.slice(0, 80)}"`,
            severity: "fatal",
          });
          break;
        }
      }
      // v5.2.3 — code snippet completeness
      if (slide.code && !validateCodeSnippet(slide.code, slide.codeLanguage)) {
        issues.push({
          slideId: sid, moduleIndex: mod.moduleIndex,
          type: "INCOMPLETE_CODE_SNIPPET",
          message: `Snippet incompleto em "${slide.title}": "${slide.code.slice(0, 60).replace(/\n/g, " | ")}"`,
          severity: "fixable",
        });
      }

      // 8. Duplicate slide check (within module)
      const firstItems = (slide.items ?? []).slice(0, 3).join("|");
      const dupHit = seen.find((p) =>
        jaccard(p.title, slide.title) >= 0.75 &&
        jaccard(p.firstItems, firstItems) >= 0.6
      );
      if (dupHit) {
        issues.push({
          slideId: sid, moduleIndex: mod.moduleIndex,
          type: "DUPLICATE_SLIDE",
          message: `Slide quase duplicado de outro no mesmo módulo: "${slide.title}"`,
          severity: "fixable",
        });
      } else {
        seen.push({ title: slide.title, firstItems });
      }
    }
  }

  const byType: Record<string, number> = {};
  for (const i of issues) byType[i.type] = (byType[i.type] ?? 0) + 1;

  // "passed" = no FATAL issues. Fixable issues are repaired by repairPlan.
  const passed = !issues.some((i) => i.severity === "fatal");
  return { passed, issues, byType };
}

// ═══════════════════════════════════════════════════════════
// Repair — drops fatal slides, removes invalid items, normalises
// ═══════════════════════════════════════════════════════════

export function repairPlan(
  plan: PresentationPlan,
  report: PlanValidationReport,
  courseTitle: string,
): { plan: PresentationPlan; stats: Record<string, number> } {
  const stats: Record<string, number> = {
    repaired_objectives: 0,
    blocked_contamination: 0,
    moved_code: 0,
    removed_duplicates: 0,
    removed_truncated: 0,
    removed_broken_sentence: 0,
    repaired_module_objectives: 0,
    repaired_code_snippets: 0,
    capped_bullets: 0,
    capped_code: 0,
  };

  const fatalSlideIds = new Set(
    report.issues.filter((i) => i.severity === "fatal").map((i) => i.slideId),
  );

  const repaired: PresentationPlanModule[] = plan.modules.map((mod) => {
    const rule = getModuleRule(courseTitle, mod.moduleTitle);
    const moduleKind = rule?.kind ?? "";
    const slides: PresentationSlide[] = [];
    const seen: { title: string; firstItems: string }[] = [];

    for (const slide of mod.slides) {
      if (fatalSlideIds.has(slide.id)) continue;

      const isObj = isObjectiveSlide(slide.intent);

      // Filter items: drop empties, generics, truncated, code-in-bullet,
      // domain-contaminated, broken-semantic, module-objective-violations.
      const cleanItems = (slide.items ?? []).filter((it) => {
        if (!it || !it.trim()) return false;
        // CRITICAL: domain contamination check runs FIRST so forbidden
        // content (e.g. SQL in a Python module) gets dropped instead of
        // being promoted to the code field by looksLikeCodeLine below.
        if (rule) {
          for (const dp of rule.denyPatterns) {
            if (dp.test(it)) { stats.blocked_contamination++; return false; }
          }
        }
        // Cross-module basic leak (advanced module teaching fundamentals)
        if (isCrossModuleBasicLeak(it, mod.moduleTitle)) {
          stats.blocked_contamination++;
          return false;
        }
        if (isGenericObjective(it, mod.moduleTitle)) {
          stats.repaired_objectives++;
          return false;
        }
        if (isTruncatedSentence(it)) {
          stats.removed_truncated++;
          return false;
        }
        // v5.2.3 — broken semantic sentence
        const bk = detectBrokenSemanticSentence(it);
        if (bk) {
          console.warn(`[V5-BROKEN-SENTENCE] mod=${mod.moduleIndex + 1} kind=${bk} text="${it.slice(0, 80)}"`);
          stats.removed_broken_sentence++;
          return false;
        }
        // v5.2.3 — module-objective violation on objective slides
        if (isObj && moduleKind && !validateModuleObjective(it, moduleKind, mod.moduleTitle)) {
          console.warn(`[V5-MODULE-OBJECTIVE-REPAIR] mod=${mod.moduleIndex + 1} (${moduleKind}) drop="${it.slice(0, 80)}"`);
          stats.repaired_module_objectives++;
          return false;
        }
        if (slide.intent !== "code_walkthrough" && looksLikeCodeLine(it)) {
          // If the slide has no code yet, promote to code field
          if (!slide.code) {
            slide.code = it;
            slide.intent = "code_walkthrough";
            slide.layoutHint = "code";
            slide.focalElement = "code";
          }
          stats.moved_code++;
          return false;
        }
        return true;
      });

      // Cap bullets
      let finalItems = cleanItems;
      if (finalItems.length > 5) {
        finalItems = finalItems.slice(0, 5);
        stats.capped_bullets++;
      }

      // Cap code
      let finalCode = slide.code;
      if (finalCode) {
        const lines = finalCode.split("\n");
        if (lines.length > 12) {
          finalCode = lines.slice(0, 12).join("\n");
          stats.capped_code++;
        }
      }
      // v5.2.4 — ALWAYS run Python API typo repair (super().init → super().__init__)
      // even if the snippet is otherwise complete and valid.
      if (finalCode && (slide.codeLanguage ?? "python").toLowerCase() === "python") {
        const fixed = repairPythonApiTypos(finalCode);
        if (fixed !== finalCode) {
          console.warn(`[V5-CODE-REPAIR] mod=${mod.moduleIndex + 1} fixed Python API typos (super().init/init etc.)`);
          finalCode = fixed;
          stats.repaired_code_snippets++;
        }
      }
      // v5.2.3 — repair incomplete code snippet
      if (finalCode && !validateCodeSnippet(finalCode, slide.codeLanguage)) {
        const repaired = repairCodeSnippet(finalCode, slide.codeLanguage);
        if (repaired !== finalCode && validateCodeSnippet(repaired, slide.codeLanguage)) {
          console.warn(`[V5-CODE-REPAIR] mod=${mod.moduleIndex + 1} appended completion to snippet "${finalCode.slice(0, 50).replace(/\n/g, " | ")}"`);
          finalCode = repaired;
          stats.repaired_code_snippets++;
        } else {
          console.warn(`[V5-CODE-REPAIR] mod=${mod.moduleIndex + 1} snippet still incomplete after repair attempt — dropping code field`);
          finalCode = undefined;
          stats.repaired_code_snippets++;
        }
      }

      // Filter comparison columns with the SAME filter set as items
      // (was: only truncation — too permissive; now: full domain/generic guard).
      const filterColumn = (arr: string[]): string[] =>
        arr.filter((it) => {
          if (!it || !it.trim()) return false;
          if (rule) {
            for (const dp of rule.denyPatterns) {
              if (dp.test(it)) { stats.blocked_contamination++; return false; }
            }
          }
          if (isCrossModuleBasicLeak(it, mod.moduleTitle)) {
            stats.blocked_contamination++; return false;
          }
          if (isGenericObjective(it, mod.moduleTitle)) {
            stats.repaired_objectives++; return false;
          }
          if (isTruncatedSentence(it)) {
            stats.removed_truncated++; return false;
          }
          if (detectBrokenSemanticSentence(it)) {
            stats.removed_broken_sentence++; return false;
          }
          return true;
        }).slice(0, 5);
      const cleanLeft = filterColumn(slide.leftItems ?? []);
      const cleanRight = filterColumn(slide.rightItems ?? []);

      // Drop the slide entirely if any of its non-item fields (code,
      // title, headers) are contaminated. Includes both per-module
      // denyPatterns AND cross-module fundamentals leak in title.
      if (rule) {
        const fields: string[] = [
          slide.title,
          slide.leftHeader ?? "",
          slide.rightHeader ?? "",
          slide.code ?? "",
        ];
        let nonItemContaminated = false;
        for (const f of fields) {
          for (const dp of rule.denyPatterns) {
            if (f && dp.test(f)) { nonItemContaminated = true; break; }
          }
          if (nonItemContaminated) break;
        }
        if (nonItemContaminated) { stats.blocked_contamination++; continue; }
      }
      if (isCrossModuleBasicLeak(slide.title, mod.moduleTitle)) {
        stats.blocked_contamination++;
        continue;
      }

      // v5.2.3 — if an OBJECTIVE slide ended up with no items but has a
      // valid module kind, inject module-aligned fallbacks instead of
      // leaving the cover/takeaways empty.
      let injectedItems = finalItems;
      if (isObj && injectedItems.length === 0 && !finalCode &&
          cleanLeft.length === 0 && cleanRight.length === 0 && moduleKind) {
        const list = MODULE_OBJECTIVE_FALLBACKS[moduleKind];
        if (list && list.length > 0) {
          injectedItems = [
            list[0],
            list[1 % list.length],
            list[2 % list.length],
          ].filter(Boolean);
          console.warn(`[V5-MODULE-OBJECTIVE-REPAIR] mod=${mod.moduleIndex + 1} (${moduleKind}) injected ${injectedItems.length} fallback objectives`);
          stats.repaired_module_objectives++;
        }
      }

      // Drop slide if it's now empty
      const stillHasContent =
        injectedItems.length > 0 ||
        !!finalCode ||
        cleanLeft.length > 0 ||
        cleanRight.length > 0;
      if (!stillHasContent) continue;

      // Dedup at repair time (catch fixable duplicates)
      const firstItems = finalItems.slice(0, 3).join("|");
      const isDup = seen.some((p) =>
        jaccard(p.title, slide.title) >= 0.75 &&
        jaccard(p.firstItems, firstItems) >= 0.6
      );
      if (isDup) { stats.removed_duplicates++; continue; }
      seen.push({ title: slide.title, firstItems });

      slides.push({
        ...slide,
        items: injectedItems,
        code: finalCode,
        leftItems: cleanLeft.length > 0 ? cleanLeft : undefined,
        rightItems: cleanRight.length > 0 ? cleanRight : undefined,
      });
    }

    // Ensure module ends with takeaways
    if (slides.length > 0 && slides[slides.length - 1].intent !== "takeaways") {
      // Promote last slide if it looks like a summary, else leave as-is
      // (the v5 pipeline doesn't strictly require a takeaways slide).
    }

    return { ...mod, slides };
  });

  return { plan: { ...plan, modules: repaired }, stats };
}

// ═══════════════════════════════════════════════════════════
// Convert PresentationSlide → v5 Slide shape
// ═══════════════════════════════════════════════════════════

// We export a JSON-compatible Slide type; index.ts casts to its own Slide.
export interface V5SlideLike {
  layout: string;
  title: string;
  label?: string;
  items?: string[];
  code?: string;
  codeLabel?: string;
  leftHeader?: string;
  rightHeader?: string;
  leftItems?: string[];
  rightItems?: string[];
  moduleIndex: number;
}

function intentToLabel(intent: PlanIntent): string {
  switch (intent) {
    case "concept": return "CONCEITO";
    case "example": return "EXEMPLO";
    case "code_walkthrough": return "CÓDIGO";
    case "process": return "PROCESSO";
    case "comparison": return "COMPARAÇÃO";
    case "cards": return "CONCEITOS";
    case "takeaways": return "PRINCIPAIS APRENDIZADOS";
    case "summary": return "RESUMO";
    case "closing": return "ENCERRAMENTO";
    default: return "CONTEÚDO";
  }
}

function layoutHintToV5Layout(hint: PlanLayoutHint): string {
  switch (hint) {
    case "bullets": return "bullets";
    case "cards": return "cards";
    case "code": return "code";
    case "process": return "process";
    case "comparison": return "comparison";
    case "twocol": return "twocol";
    case "takeaways": return "takeaways";
    default: return "bullets";
  }
}

export function presentationSlideToV5Slide(ps: PresentationSlide): V5SlideLike {
  return {
    layout: layoutHintToV5Layout(ps.layoutHint),
    title: ps.title,
    label: intentToLabel(ps.intent),
    items: ps.items && ps.items.length > 0 ? ps.items : undefined,
    code: ps.code,
    codeLabel: ps.codeLanguage || (ps.code ? "Python" : undefined),
    leftHeader: ps.leftHeader,
    rightHeader: ps.rightHeader,
    leftItems: ps.leftItems,
    rightItems: ps.rightItems,
    moduleIndex: ps.moduleIndex,
  };
}

export function presentationPlanToV5Slides(plan: PresentationPlan): V5SlideLike[][] {
  return plan.modules.map((mod) => mod.slides.map(presentationSlideToV5Slide));
}

// ═══════════════════════════════════════════════════════════
// Main entry — produces a PresentationPlan for the whole course
// ═══════════════════════════════════════════════════════════

export interface PlannerInput {
  courseTitle: string;
  modules: { title: string; content: string }[];
  language: string;
  audience?: string;
  geminiKey: string;
}

export interface PlannerStats {
  module_count: number;
  slide_count: number;
  intents_breakdown: Record<string, number>;
  repaired_objectives: number;
  blocked_contamination: number;
  moved_code: number;
  removed_duplicates: number;
  removed_truncated: number;
  removed_broken_sentence: number;
  repaired_module_objectives: number;
  repaired_code_snippets: number;
  capped_bullets: number;
  capped_code: number;
  modules_failed: number;
}

export async function generatePresentationPlan(
  input: PlannerInput,
): Promise<{ plan: PresentationPlan; stats: PlannerStats; validation: PlanValidationReport }> {
  const { courseTitle, modules, language, audience, geminiKey } = input;

  // v5.4.6 — was 3 (sequential 3 batches × ~30s = ~90s on 8 modules, blowing
  // the Edge Function 150s wall-clock). Bumped to 8 so a typical course
  // (8 modules) completes in ONE Promise.allSettled wave (~25-30s). Gemini
  // free tier is 60 RPM, so 8 concurrent calls is well within limits.
  const BATCH = 8;
  const tPlannerStart = Date.now();
  const moduleResults: PresentationPlanModule[] = new Array(modules.length);
  let modulesFailed = 0;

  for (let b = 0; b < modules.length; b += BATCH) {
    const batchIdx = Array.from(
      { length: Math.min(BATCH, modules.length - b) },
      (_, k) => b + k,
    );
    const settled = await Promise.allSettled(
      batchIdx.map(async (i) => {
        const mod = modules[i];
        const rule = getModuleRule(courseTitle, mod.title);
        const prompt = buildPlanPrompt(
          courseTitle, mod.title, i, mod.content || "",
          language, audience, rule,
        );
        const raw = await callPlannerLLM(prompt, geminiKey);
        const slides = parsePlannerOutput(raw, i, mod.title);
        if (slides.length === 0) {
          throw new Error(`empty plan for module ${i + 1}`);
        }
        return { i, mod, slides };
      }),
    );

    for (let k = 0; k < settled.length; k++) {
      const r = settled[k];
      const i = batchIdx[k];
      if (r.status === "fulfilled") {
        moduleResults[i] = {
          moduleTitle: r.value.mod.title,
          moduleIndex: i,
          slides: r.value.slides,
        };
      } else {
        modulesFailed++;
        console.warn(
          `[PRESENTATION-PLAN] Module ${i + 1} planner failed: ${(r.reason as any)?.message ?? r.reason}`,
        );
        // Empty module — caller will detect and fall back
        moduleResults[i] = {
          moduleTitle: modules[i].title,
          moduleIndex: i,
          slides: [],
        };
      }
    }
  }

  const plan: PresentationPlan = {
    courseTitle,
    language,
    modules: moduleResults,
  };

  const validation = validatePresentationPlan(plan, courseTitle);
  const { plan: repairedPlan, stats: repairStats } = repairPlan(plan, validation, courseTitle);

  // Re-validate repaired plan so the [PRESENTATION-PLAN-VALIDATION] log
  // reflects the post-repair state (which is what the renderer will see).
  const finalValidation = validatePresentationPlan(repairedPlan, courseTitle);

  // Stats
  const intents: Record<string, number> = {};
  let slideCount = 0;
  for (const mod of repairedPlan.modules) {
    for (const s of mod.slides) {
      intents[s.intent] = (intents[s.intent] ?? 0) + 1;
      slideCount++;
    }
  }

  const stats: PlannerStats = {
    module_count: repairedPlan.modules.length,
    slide_count: slideCount,
    intents_breakdown: intents,
    repaired_objectives: repairStats.repaired_objectives,
    blocked_contamination: repairStats.blocked_contamination,
    moved_code: repairStats.moved_code,
    removed_duplicates: repairStats.removed_duplicates,
    removed_truncated: repairStats.removed_truncated,
    removed_broken_sentence: repairStats.removed_broken_sentence,
    repaired_module_objectives: repairStats.repaired_module_objectives,
    repaired_code_snippets: repairStats.repaired_code_snippets,
    capped_bullets: repairStats.capped_bullets,
    capped_code: repairStats.capped_code,
    modules_failed: modulesFailed,
  };

  // v5.4.6 — isolate planner wall-clock so we can prove the 8-wide batch worked
  console.log(
    `[PLANNER-TIMING] total_ms=${Date.now() - tPlannerStart} modules=${modules.length} batch_size=${BATCH} slides=${slideCount} failed=${modulesFailed}`,
  );

  return { plan: repairedPlan, stats, validation: finalValidation };
}
