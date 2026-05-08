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

function getModuleRule(courseTitle: string, moduleTitle: string): ModuleRule | null {
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

  // Verb + module title (e.g. "Compreender Estruturas de Dados.")
  for (const v of GENERIC_OBJECTIVE_VERBS) {
    if (t === `${v} ${mt}.` || t === `${v} ${mt}`) return true;
    if (t.startsWith(`${v} ${mt}`) && t.length < mt.length + v.length + 8) return true;
    // Verb + first 2-3 words of module title
    const mtHead = mt.split(/\s+/).slice(0, 3).join(" ");
    if (mtHead.length > 8 && t === `${v} ${mtHead}.`) return true;
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
  if (/\b(Trata|Tratar|Trate|Use|Usar|Utilize|Utilizar|Realize|Realizar|Define|Definir|Cria|Criar|Configura|Configurar|Aplica|Aplicar|Manipula|Manipular|Implementa|Implementar|Organiza|Organizar|Faz|Faça|Captura|Capturar|Capture|Garante|Garantir|Permite|Permitir|Habilita|Habilitar|Verifica|Verificar|Analisa|Analisar|Identifica|Identificar|Prepara|Preparar|Limpa|Limpar)\s+e\s+(para|com|em|no|na|de|do|da)\b/i.test(t)) return true;
  // verb directly followed by "para" with no object — "Use para buscar", "Utilizar para enviar"
  // Restricted: must be a short fragment (<70 chars) AND have NO substantive
  // word between the verb and "para" (i.e. literally "Verb para X"). Long
  // pedagogical sentences like "Use list comprehensions para filtrar dados" are
  // already excluded by the `^Verb para` anchor. The 70-char gate avoids
  // flagging conversational "Use para iniciar a sessão e configurar o ambiente."
  if (
    t.length < 50 &&
    /^\s*(Use|Usar|Utilize|Utilizar|Aplique|Aplicar|Realize|Realizar|Configure|Configurar|Defina|Definir|Crie|Criar)\s+para\b/i.test(t)
  ) return true;
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
2. **Generate EXACTLY 3 to 4 slides. NEVER 5 or more.** Quality over quantity.
   The deck is for an introductory course — long modules are exhausting.
   Prefer 3 slides for short/simple modules; use 4 only when truly needed.
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

  // HARD CAP: max 4 slides per module (regardless of what the LLM returned).
  // Keep the LAST slide if it's takeaways/summary so the module ends well.
  if (parsed.length > 4) {
    const lastIsRecap = parsed.length > 0 &&
      ["takeaways", "summary", "closing"].includes(parsed[parsed.length - 1]?.intent);
    const recap = lastIsRecap ? parsed[parsed.length - 1] : null;
    parsed = recap ? [...parsed.slice(0, 3), recap] : parsed.slice(0, 4);
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
    capped_bullets: 0,
    capped_code: 0,
  };

  const fatalSlideIds = new Set(
    report.issues.filter((i) => i.severity === "fatal").map((i) => i.slideId),
  );

  const repaired: PresentationPlanModule[] = plan.modules.map((mod) => {
    const rule = getModuleRule(courseTitle, mod.moduleTitle);
    const slides: PresentationSlide[] = [];
    const seen: { title: string; firstItems: string }[] = [];

    for (const slide of mod.slides) {
      if (fatalSlideIds.has(slide.id)) continue;

      // Filter items: drop empties, generics, truncated, code-in-bullet,
      // domain-contaminated.
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

      // Drop slide if it's now empty
      const stillHasContent =
        finalItems.length > 0 ||
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
        items: finalItems,
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
  capped_bullets: number;
  capped_code: number;
  modules_failed: number;
}

export async function generatePresentationPlan(
  input: PlannerInput,
): Promise<{ plan: PresentationPlan; stats: PlannerStats; validation: PlanValidationReport }> {
  const { courseTitle, modules, language, audience, geminiKey } = input;

  const BATCH = 3;
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
    capped_bullets: repairStats.capped_bullets,
    capped_code: repairStats.capped_code,
    modules_failed: modulesFailed,
  };

  return { plan: repairedPlan, stats, validation: finalValidation };
}
