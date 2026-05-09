// ═══════════════════════════════════════════════════════════════════════
// TECHNICAL PRESERVATION LAYER (v5.4.0)
// ───────────────────────────────────────────────────────────────────────
// Strategy: FREEZE technical tokens BEFORE any sanitizer / repair /
// LLM rewrite touches the text. Operate on natural-language text only.
// Re-hydrate the original tokens afterwards. Validate integrity.
//
// This replaces the historical "detect damage → reconstruct tokens"
// loop (TR_FLOW_TOKENS, TR_TESTS_TOKENS, etc.) with prevention.
//
// Placeholder format: PUA characters \uE001 ... \uE002 — chosen so
// that they DO NOT match any existing sanitizer regex (which only
// strips ASCII `[[...]]`, `{{...}}`, `lorem ipsum`, etc.).
// ═══════════════════════════════════════════════════════════════════════

export type TechnicalTokenKind =
  | "python_keyword"
  | "python_builtin"
  | "python_dunder"
  | "python_method"
  | "python_exception"
  | "python_module"
  | "test_framework"
  | "log_level"
  | "file_path"
  | "filename"
  | "shell_command"
  | "package_tool"
  | "http_method"
  | "api_method"
  | "json_method"
  | "quoted_mode"
  | "backticked"
  | "generic_identifier";

export interface TechnicalToken {
  id: string;
  value: string;
  kind: TechnicalTokenKind;
  start: number;
  end: number;
  protected: true;
}

export interface ProtectionResult {
  maskedText: string;
  tokenMap: TechnicalToken[];
  stats: { count: number; byKind: Record<string, number> };
}

export interface IntegrityResult {
  ok: boolean;
  missing: string[];
  residualPlaceholders: string[];
  reason?: string;
}

const MARK_OPEN = "\uE001";
const MARK_CLOSE = "\uE002";
const PLACEHOLDER_RE = /\uE001T\d{3,4}\uE002/g;

const makePlaceholder = (n: number): string =>
  `${MARK_OPEN}T${String(n).padStart(3, "0")}${MARK_CLOSE}`;

// ───────────────────────────────────────────────────────────────────────
// TOKEN PATTERNS — ordered MOST SPECIFIC FIRST so longer matches win
// (e.g. `__init__()` before `init`, `unittest.TestCase` before `unittest`).
// All patterns are global; matches are deduplicated by [start,end].
// ───────────────────────────────────────────────────────────────────────
interface PatternEntry {
  re: RegExp;
  kind: TechnicalTokenKind;
}

// Build alternation source helpers
const word = (s: string) => `\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`;

const PYTHON_DUNDER = [
  "__init__()", "__init__", "__name__", "__main__",
  "__str__()", "__str__", "__repr__()", "__repr__",
  "__call__()", "__call__", "__len__()", "__len__",
  "__iter__()", "__iter__", "__next__()", "__next__",
];

const PYTHON_KEYWORDS = [
  "if", "elif", "else", "for", "while", "break", "continue",
  "return", "def", "class", "try", "except", "finally", "raise",
  "import", "from", "with", "as", "in", "is", "not", "and", "or",
  "pass", "yield", "lambda", "async", "await", "global", "nonlocal",
];

const PYTHON_BUILTINS = [
  "print()", "input()", "type()", "len()", "range()",
  "int()", "str()", "float()", "bool()", "list()",
  "dict()", "set()", "tuple()", "open()", "read()", "write()",
  "append()", "keys()", "values()", "items()", "update()",
  "enumerate()", "zip()", "map()", "filter()", "sorted()",
  "reversed()", "min()", "max()", "sum()", "abs()", "round()",
  "isinstance()", "issubclass()", "hasattr()", "getattr()", "setattr()",
];

const PYTHON_EXCEPTIONS = [
  "FileNotFoundError", "IOError", "ValueError", "TypeError",
  "KeyError", "IndexError", "AttributeError", "ZeroDivisionError",
  "RuntimeError", "OSError", "Exception", "StopIteration",
  "NotImplementedError",
];

const TEST_FRAMEWORK = [
  "unittest.TestCase", "unittest.main()", "unittest",
  "pytest.fixture", "pytest.mark.parametrize", "pytest",
  "TestCase", "assertEqual()", "assertTrue()", "assertFalse()",
  "assertRaises()", "assertIsNone()", "assertIsNotNone()",
  "assertIn()", "assertNotIn()", "setUp()", "tearDown()",
  "setUpClass()", "tearDownClass()", "assert",
];

const LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];

const LOGGING = [
  "logging.basicConfig()", "logging.getLogger()", "logging.debug()",
  "logging.info()", "logging.warning()", "logging.error()",
  "logging.critical()", "logging",
];

const JSON_API = [
  "json.loads()", "json.dumps()", "json.load()", "json.dump()", "json",
  "requests.get()", "requests.post()", "requests.put()", "requests.delete()",
  "requests.patch()", "requests",
  "response.json()", "response.status_code", "response.raise_for_status()",
  "response.text", "response.content", "response.headers",
];

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HTTP", "REST", "API"];

const FILES_AND_PATHS = [
  "requirements.txt", "setup.py", "pyproject.toml", "README.md",
  "LICENSE", ".gitignore", ".env", "Dockerfile",
  "src/", "tests/", "docs/", ".venv", ".venv/",
];

const PACKAGE_TOOLS = [
  "pip install", "pip freeze", "pip uninstall", "pip", "venv", "virtualenv",
  "PEP 8", "PEP8", "black", "flake8", "mypy", "isort", "ruff",
  "docstrings", "docstring",
];

const SHELL_COMMANDS = [
  "python3 -m venv .venv",
  "source .venv/bin/activate",
  "pip install -r requirements.txt",
  "pip freeze > requirements.txt",
];

// Order: longest/most-specific first
const PATTERNS: PatternEntry[] = [
  // Multi-word shell commands (must be first)
  ...SHELL_COMMANDS.map((s) => ({
    re: new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
    kind: "shell_command" as TechnicalTokenKind,
  })),
  // Files / paths with dots or slashes (specific)
  ...FILES_AND_PATHS.map((s) => ({
    re: new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\/$/, "/"), "g"),
    kind: (s.includes("/") ? "file_path" : "filename") as TechnicalTokenKind,
  })),
  // Dunders (longer first)
  ...PYTHON_DUNDER.map((s) => ({
    re: new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
    kind: "python_dunder" as TechnicalTokenKind,
  })),
  // Test framework (specific dotted names first)
  ...TEST_FRAMEWORK.map((s) => ({
    re: new RegExp(s.includes(".") || s.includes("(")
      ? s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      : word(s), "g"),
    kind: "test_framework" as TechnicalTokenKind,
  })),
  // JSON / API methods (dotted)
  ...JSON_API.map((s) => ({
    re: new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
    kind: (s.startsWith("json") ? "json_method" : "api_method") as TechnicalTokenKind,
  })),
  // Logging (dotted)
  ...LOGGING.map((s) => ({
    re: new RegExp(s.includes(".") || s.includes("(")
      ? s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      : word(s), "g"),
    kind: "python_module" as TechnicalTokenKind,
  })),
  // Log levels (uppercase words — case-sensitive boundary)
  ...LOG_LEVELS.map((s) => ({
    re: new RegExp(`\\b${s}\\b`, "g"),
    kind: "log_level" as TechnicalTokenKind,
  })),
  // Exceptions (CamelCase identifiers)
  ...PYTHON_EXCEPTIONS.map((s) => ({
    re: new RegExp(`\\b${s}\\b`, "g"),
    kind: "python_exception" as TechnicalTokenKind,
  })),
  // Package tools / best practices
  ...PACKAGE_TOOLS.map((s) => ({
    re: new RegExp(s.includes(" ") || /[A-Z]/.test(s)
      ? s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      : word(s), "g"),
    kind: "package_tool" as TechnicalTokenKind,
  })),
  // HTTP methods (uppercase) — case-sensitive
  ...HTTP_METHODS.map((s) => ({
    re: new RegExp(`\\b${s}\\b`, "g"),
    kind: "http_method" as TechnicalTokenKind,
  })),
  // Builtins (with parens — specific)
  ...PYTHON_BUILTINS.map((s) => ({
    re: new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
    kind: "python_builtin" as TechnicalTokenKind,
  })),
  // Test_* prefix identifiers
  { re: /\btest_[a-zA-Z_][a-zA-Z0-9_]*\b/g, kind: "test_framework" },
  { re: /\btest_\*/g, kind: "test_framework" },
  // Backticked snippets `xyz`
  { re: /`[^`\n]{1,40}`/g, kind: "backticked" },
  // Quoted file modes 'r','w','a','b','rb','wb','rt','wt','x','r+','w+','a+'
  { re: /'(?:r\+|w\+|a\+|rb|wb|rt|wt|ab|r|w|a|b|x)'/g, kind: "quoted_mode" },
  // Python keywords (lowercase) — case-sensitive
  ...PYTHON_KEYWORDS.map((s) => ({
    re: new RegExp(`\\b${s}\\b`, "g"),
    kind: "python_keyword" as TechnicalTokenKind,
  })),
];

// ───────────────────────────────────────────────────────────────────────
// detectTechnicalTokens — find all token spans, dedup overlaps
// (longer match wins on overlap).
// ───────────────────────────────────────────────────────────────────────
export function detectTechnicalTokens(text: string): TechnicalToken[] {
  if (!text || typeof text !== "string") return [];
  const raw: Array<{ start: number; end: number; value: string; kind: TechnicalTokenKind }> = [];
  for (const { re, kind } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      raw.push({ start: m.index, end: m.index + m[0].length, value: m[0], kind });
    }
  }
  // Sort by start asc, then by length desc (longer wins on overlap)
  raw.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const accepted: typeof raw = [];
  let cursor = -1;
  for (const r of raw) {
    if (r.start < cursor) continue; // overlap with already-accepted longer match
    accepted.push(r);
    cursor = r.end;
  }
  return accepted.map((r, i) => ({
    id: `T${String(i).padStart(3, "0")}`,
    value: r.value,
    kind: r.kind,
    start: r.start,
    end: r.end,
    protected: true,
  }));
}

// ───────────────────────────────────────────────────────────────────────
// protectTechnicalTokens — replace tokens with PUA placeholders
// ───────────────────────────────────────────────────────────────────────
export function protectTechnicalTokens(text: string): ProtectionResult {
  if (!text || typeof text !== "string") {
    return { maskedText: text, tokenMap: [], stats: { count: 0, byKind: {} } };
  }
  const tokens = detectTechnicalTokens(text);
  if (tokens.length === 0) {
    return { maskedText: text, tokenMap: [], stats: { count: 0, byKind: {} } };
  }
  // Replace from end to start so indices remain valid
  let masked = text;
  const tokenMap: TechnicalToken[] = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    const idNum = i;
    const placeholder = makePlaceholder(idNum);
    masked = masked.slice(0, t.start) + placeholder + masked.slice(t.end);
    tokenMap.unshift({ ...t, id: `T${String(idNum).padStart(3, "0")}` });
  }
  const byKind: Record<string, number> = {};
  for (const t of tokenMap) byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
  return { maskedText: masked, tokenMap, stats: { count: tokenMap.length, byKind } };
}

// ───────────────────────────────────────────────────────────────────────
// restoreTechnicalTokens — replace placeholders with original values
// ───────────────────────────────────────────────────────────────────────
export function restoreTechnicalTokens(maskedText: string, tokenMap: TechnicalToken[]): string {
  if (!maskedText || typeof maskedText !== "string" || tokenMap.length === 0) return maskedText;
  let out = maskedText;
  for (const t of tokenMap) {
    const placeholder = `${MARK_OPEN}T${t.id.replace(/^T/, "")}${MARK_CLOSE}`;
    // Replace ALL occurrences (LLM might duplicate; we'll catch via integrity check)
    out = out.split(placeholder).join(t.value);
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────
// validateTechnicalTokenIntegrity
// ───────────────────────────────────────────────────────────────────────
export function validateTechnicalTokenIntegrity(
  originalText: string,
  restoredText: string,
  tokenMap: TechnicalToken[],
): IntegrityResult {
  const residualPlaceholders = restoredText ? restoredText.match(PLACEHOLDER_RE) ?? [] : [];
  if (residualPlaceholders.length > 0) {
    return {
      ok: false,
      missing: [],
      residualPlaceholders,
      reason: `${residualPlaceholders.length} placeholder(s) survived restore`,
    };
  }
  // v5.4.0 (architect feedback) — multiplicity check.
  // Count how many times each token VALUE was expected vs how many
  // times it actually appears in restoredText. If a token had two
  // placeholders and only one survived restore, .includes() would
  // still pass — but the count check catches the loss.
  const expected: Record<string, number> = {};
  for (const t of tokenMap) expected[t.value] = (expected[t.value] ?? 0) + 1;
  const missing: string[] = [];
  for (const [value, count] of Object.entries(expected)) {
    // Count non-overlapping occurrences in restoredText
    let n = 0;
    let idx = 0;
    while ((idx = restoredText.indexOf(value, idx)) !== -1) {
      n++;
      idx += value.length;
    }
    if (n < count) {
      // Add `value` once per missing occurrence so caller sees the count
      for (let k = 0; k < (count - n); k++) missing.push(value);
    }
  }
  if (missing.length > 0) {
    return { ok: false, missing, residualPlaceholders: [], reason: `missing token(s) after restore: ${missing.join(", ")}` };
  }
  return { ok: true, missing: [], residualPlaceholders: [] };
}

// ───────────────────────────────────────────────────────────────────────
// withTechnicalProtection — wrap any text-mutating processor.
// If integrity fails, returns the ORIGINAL text (REVERT-on-fail) so the
// downstream QA detector sees the real damage and can block via
// TECHNICAL_TOKEN_LOSS instead of shipping a half-fixed sentence.
// ───────────────────────────────────────────────────────────────────────
export interface ProtectionContext {
  slideId?: string;
  module?: number;
  field?: string;
}

export function withTechnicalProtection(
  text: string,
  context: ProtectionContext,
  processorFn: (masked: string) => string,
): { result: string; valid: boolean; missing?: string[]; reason?: string } {
  if (!text || typeof text !== "string") {
    return { result: text, valid: true };
  }
  const protection = protectTechnicalTokens(text);
  if (protection.tokenMap.length === 0) {
    // Nothing technical to protect — run processor directly
    const out = processorFn(text);
    return { result: out, valid: true };
  }
  if (protection.tokenMap.length > 0) {
    const kinds = Object.entries(protection.stats.byKind)
      .map(([k, v]) => `${k}:${v}`).join(",");
    console.log(
      `[TECH-PRESERVE] ${context.slideId ?? "?"} field=${context.field ?? "?"} tokens=${protection.tokenMap.length} kinds=${kinds}`,
    );
  }
  const processed = processorFn(protection.maskedText);
  const restored = restoreTechnicalTokens(processed, protection.tokenMap);
  const integrity = validateTechnicalTokenIntegrity(text, restored, protection.tokenMap);
  if (!integrity.ok) {
    console.warn(
      `[TECH-PRESERVE-FAIL] ${context.slideId ?? "?"} field=${context.field ?? "?"} reason="${integrity.reason}" missing=${JSON.stringify(integrity.missing)}`,
    );
    return { result: text, valid: false, missing: integrity.missing, reason: integrity.reason };
  }
  return { result: restored, valid: true };
}

// ───────────────────────────────────────────────────────────────────────
// detectTechnicalTokenDamage — QA-time detector for residual damage.
// Returns the matched signature(s), used to emit TECHNICAL_TOKEN_LOSS.
// ───────────────────────────────────────────────────────────────────────
const DAMAGE_PATTERNS: Array<{ re: RegExp; key: string }> = [
  { re: /\bcom\s*,\s*e\b/i, key: "com_comma_e" },
  { re: /\bcom\s+e\b(?!\s+[a-záéíóúâêôãõç])/i, key: "com_e_orphan" },
  { re: /\bcom\s*\.\s*$/i, key: "trailing_com_dot" },
  { re: /\(\s*,\s*\)/, key: "empty_paren_comma" },
  { re: /\(\s*,\s*else\s*\)/i, key: "paren_comma_else" },
  { re: /\bn[ií]veis\s+como\s*,?\s*e\b/i, key: "niveis_como_e" },
  { re: /\bestruturas\s+condicionais\s+com\s*,?\s*e\b/i, key: "cond_com_e" },
  { re: /\bcom\s*,\s*else\b/i, key: "com_comma_else" },
  { re: /\bcom\s*,\s*elif\b/i, key: "com_comma_elif" },
  { re: /\b(repetindo\s+a[çc][oõ]es|la[çc]os|loops?)\s+com\s+e\b(?!\s+[a-z])/i, key: "loops_com_e" },
  // v5.4.0 (architect feedback) — narrowed: original pattern matched
  // legitimate prose like "modos de abertura e fechamento". Now requires
  // a damage signature: trailing comma OR ending in orphan quote/paren
  // OR followed by quoted single char that suggests a list cut short.
  { re: /\bmodos\s+de\s+abertura\s*,\s*e\b(?!\s+[a-z]{4,})/i, key: "modos_abertura_e" },
  { re: /\bmodos\s+de\s+abertura[^.]*?,\s+e\s+'[a-z]'/i, key: "modos_abertura_quoted" },
  { re: /\bconstrutor\s+init\b(?![^.]*__init__)/i, key: "construtor_init_no_dunder" },
  { re: /\busar\s+e\s+para\s+interagir\b/i, key: "usar_e_interagir" },
  { re: /\borganizar\s+projetos\s+python\s+com\s*,\s*\.\s*$/i, key: "organizar_projetos_com" },
  { re: /\bgerenciar\s+depend[êe]ncias\s+com\s*,?\s*e\b/i, key: "gerenciar_dep_com_e" },
  { re: /\bcrie\s+testes\s+herdando\s+de\s*,/i, key: "testes_herdando_de_comma" },
  { re: /\bacessar\s+membros:\s*usar\s+e\b/i, key: "acessar_membros_usar_e" },
  { re: /\brealize\s+leitura\s+com\s*,?\s*e\s+escrita\b/i, key: "leitura_escrita_com" },
];

// Allowlist for legitimate Portuguese forms that would otherwise trip
// the damage detector (`E/S`, "E se ...", "com e sem", etc.).
const DAMAGE_ALLOWLIST: RegExp[] = [
  /\bE\/S\b/,
  /^E\s+se\b/i,
  /\bcom\s+e\s+sem\b/i,
  /\bcom\s+e\s+contra\b/i,
];

export function detectTechnicalTokenDamage(text: string): { damaged: boolean; keys: string[] } {
  if (!text || typeof text !== "string") return { damaged: false, keys: [] };
  for (const allow of DAMAGE_ALLOWLIST) if (allow.test(text)) return { damaged: false, keys: [] };
  const keys: string[] = [];
  for (const { re, key } of DAMAGE_PATTERNS) {
    if (re.test(text)) keys.push(key);
  }
  return { damaged: keys.length > 0, keys };
}

// Convenience: scan an entire slide-like object's string fields
export function scanSlideForTechnicalDamage(s: {
  title?: string;
  items?: string[];
  code?: string;
  leftItems?: string[];
  rightItems?: string[];
  competencies?: string[];
}): { damaged: boolean; matches: Array<{ field: string; index?: number; keys: string[]; sample: string }> } {
  const matches: Array<{ field: string; index?: number; keys: string[]; sample: string }> = [];
  const check = (val: string | undefined, field: string, index?: number) => {
    if (!val) return;
    const r = detectTechnicalTokenDamage(val);
    if (r.damaged) matches.push({ field, index, keys: r.keys, sample: val.slice(0, 80) });
  };
  check(s.title, "title");
  (s.items ?? []).forEach((it, i) => check(it, "items", i));
  check(s.code, "code");
  (s.leftItems ?? []).forEach((it, i) => check(it, "leftItems", i));
  (s.rightItems ?? []).forEach((it, i) => check(it, "rightItems", i));
  (s.competencies ?? []).forEach((it, i) => check(it, "competencies", i));
  return { damaged: matches.length > 0, matches };
}

// Re-exported markers so tests can build placeholders deterministically
export const __TECH_MARK_OPEN = MARK_OPEN;
export const __TECH_MARK_CLOSE = MARK_CLOSE;
export const __TECH_PLACEHOLDER_RE = PLACEHOLDER_RE;
