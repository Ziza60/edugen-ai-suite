// editorial-normalization.ts — v5.5.0
// Editorial polish layer that runs AFTER all semantic/preservation work
// is complete. Strictly cosmetic: never repairs meaning, never modifies
// code blocks, never touches protected technical tokens.
//
// Two responsibilities:
//   1. polishEditorialTitle  — repair "Que X?" → "Por que x?" patterns
//      and other artificial title shapes the planner sometimes emits.
//   2. polishEditorialText   — sentence-case any string whose letters are
//      >60% uppercase (LLM "shout mode"), preserving acronyms and any
//      tokens recognised by technical-preservation.ts.
//
// Both functions are pure, idempotent, and safe to call on already-clean
// input. Each emits a single console.log when it actually changes the
// string, tagged so production logs can be filtered by feature.

import {
  protectTechnicalTokens,
  restoreTechnicalTokens,
  validateTechnicalTokenIntegrity,
} from "./technical-preservation.ts";

// ─────────────────────────────────────────────────────────────────────
// Hardcoded acronym/token allow-list. These ALWAYS keep their canonical
// case after sentence-case normalisation, even when the technical
// detector misses them (e.g. plurals like "APIs", uppercased log levels
// "DEBUG/INFO/ERROR" that aren't valid identifiers, version strings
// like "PEP 8"). Order matters only for prefix-match safety.
// ─────────────────────────────────────────────────────────────────────
const PROTECTED_ACRONYMS: Array<{ re: RegExp; canonical: string }> = [
  // Plural API forms
  { re: /\bAPIs?\b/gi, canonical: "API" }, // handled per-match below
  // Web/protocol acronyms
  { re: /\bHTTPS?\b/gi, canonical: "HTTP" },
  { re: /\bREST(?:ful)?\b/gi, canonical: "REST" },
  { re: /\bJSON\b/gi, canonical: "JSON" },
  { re: /\bXML\b/gi, canonical: "XML" },
  { re: /\bYAML\b/gi, canonical: "YAML" },
  { re: /\bCSV\b/gi, canonical: "CSV" },
  { re: /\bHTML\b/gi, canonical: "HTML" },
  { re: /\bCSS\b/gi, canonical: "CSS" },
  { re: /\bURLs?\b/gi, canonical: "URL" },
  { re: /\bURIs?\b/gi, canonical: "URI" },
  { re: /\bSQL\b/gi, canonical: "SQL" },
  { re: /\bDDL\b/g, canonical: "DDL" },
  { re: /\bDML\b/g, canonical: "DML" },
  // HTTP verbs
  { re: /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g, canonical: "" },
  // Python log levels (must stay all-caps)
  { re: /\b(DEBUG|INFO|WARNING|ERROR|CRITICAL|FATAL|TRACE|NOTSET)\b/g, canonical: "" },
  // Style guides + tooling
  { re: /\bPEP\s?8\b/gi, canonical: "PEP 8" },
  { re: /\bOOP\b/g, canonical: "OOP" },
  { re: /\bIDE\b/g, canonical: "IDE" },
  { re: /\bCLI\b/g, canonical: "CLI" },
  { re: /\bGUI\b/g, canonical: "GUI" },
  { re: /\bAPI\b/g, canonical: "API" },
  // Cloud / OS
  { re: /\bAWS\b/g, canonical: "AWS" },
  { re: /\bGCP\b/g, canonical: "GCP" },
  { re: /\bSaaS\b/g, canonical: "SaaS" },
  { re: /\bIaaS\b/g, canonical: "IaaS" },
  { re: /\bPaaS\b/g, canonical: "PaaS" },
  { re: /\bIO\b/g, canonical: "IO" },
  { re: /\bOS\b/g, canonical: "OS" },
  { re: /\bRAM\b/g, canonical: "RAM" },
  { re: /\bCPU\b/g, canonical: "CPU" },
  { re: /\bGPU\b/g, canonical: "GPU" },
  { re: /\bUUIDs?\b/g, canonical: "UUID" },
  { re: /\bID\b/g, canonical: "ID" },
];

// Preserve dotted/parenthesised technical fragments verbatim:
//   requests.get(), file.read(), pdb.set_trace(), str.upper()
// Case-INsensitive because shouted prose ("REQUESTS.GET()") needs to
// be captured BEFORE sentence-casing. We then store the lowercased
// canonical form (Python/JS dotted calls are conventionally lowercase).
const DOTTED_CALL_RE = /\b[a-z_][\w]*(?:\.[a-z_][\w]*)+(?:\s*\([^)]*\))?/gi;
// Preserve identifiers in `backticks` and snippets that look like code
const BACKTICK_RE = /`[^`]+`/g;
// Preserve filenames with extensions: app.py, main.js, README.md
const FILENAME_RE = /\b[a-zA-Z_][\w-]*\.[a-z]{1,5}\b/gi;
// Preserve URLs (http(s):// + bare www.)
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

// ─────────────────────────────────────────────────────────────────────
// Title polish
// ─────────────────────────────────────────────────────────────────────

// "Que" without a preceding "Por" at start of title → user wants
// "Por que <infinitive lowercased> ...?".
const QUE_TITLE_RE = /^que\s+(.+?)\s*\??$/i;

// 1st-person plural verb endings → infinitive ending
//   representamos → representar
//   escrevemos   → escrever
//   decidimos    → decidir
//   manipulamos  → manipular
const VERB_1PL_TO_INF: Array<[RegExp, string]> = [
  [/(\w+?)amos$/i, "$1ar"],
  [/(\w+?)emos$/i, "$1er"],
  [/(\w+?)imos$/i, "$1ir"],
];

function deriveInfinitive(word: string): string {
  // If already looks like an infinitive (ends in -ar/-er/-ir), just lower
  if (/(?:ar|er|ir)$/i.test(word)) return word.toLowerCase();
  for (const [re, repl] of VERB_1PL_TO_INF) {
    if (re.test(word)) return word.replace(re, repl).toLowerCase();
  }
  return word.toLowerCase();
}

export interface EditorialContext {
  slideNum?: number | string;
  field?: string;
}

export function polishEditorialTitle(
  rawTitle: string,
  ctx?: EditorialContext,
): string {
  const raw = (rawTitle || "").trim();
  if (!raw) return raw;

  // Detect "Que ...?" (NOT "Por que ...?", NOT "O que ...?", NOT "Para que")
  const lowerStart = raw.toLowerCase();
  const startsWithQue =
    lowerStart.startsWith("que ") &&
    !lowerStart.startsWith("que é ") &&
    !lowerStart.startsWith("que são ");
  const hasPorQueAlready = /\bpor\s+que\b/i.test(raw);
  const hasOQue = /\bo\s+que\b/i.test(raw);
  const hasParaQue = /\bpara\s+que\b/i.test(raw);

  if (startsWithQue && !hasPorQueAlready && !hasOQue && !hasParaQue) {
    const m = raw.match(QUE_TITLE_RE);
    if (m) {
      const restWords = m[1].trim().split(/\s+/);
      // First word is the verb to convert to infinitive
      if (restWords.length > 0) {
        restWords[0] = deriveInfinitive(restWords[0]);
        // Lowercase the rest unless it's a protected acronym
        for (let i = 1; i < restWords.length; i++) {
          restWords[i] = preserveAcronymOrLower(restWords[i]);
        }
        const out = `Por que ${restWords.join(" ")}?`;
        const polished = out.charAt(0).toUpperCase() + out.slice(1);
        if (polished !== raw) {
          console.log(
            `[TITLE-POLISH] slide=${ctx?.slideNum ?? "?"} ` +
            `before="${raw}" after="${polished}"`,
          );
        }
        return polished;
      }
    }
  }

  // No structural rewrite — but still drop runaway uppercase if any
  const recased = polishEditorialText(raw, { ...ctx, field: ctx?.field ?? "title" });
  return recased;
}

// Preserve a single word's case when it matches an acronym, otherwise
// lowercase. Used only when assembling rewritten titles word-by-word.
function preserveAcronymOrLower(word: string): string {
  // Strip trailing punctuation for matching, re-attach later
  const trail = word.match(/[.,;:!?)]+$/)?.[0] ?? "";
  const core = trail ? word.slice(0, -trail.length) : word;
  for (const { re } of PROTECTED_ACRONYMS) {
    re.lastIndex = 0;
    if (new RegExp(`^${re.source}$`, re.flags.replace(/g/g, "")).test(core)) {
      // Use canonical case from the regex source itself if it's literal,
      // otherwise keep the input as-typed (already correct).
      return core + trail;
    }
  }
  return core.toLowerCase() + trail;
}

// ─────────────────────────────────────────────────────────────────────
// Editorial text-case polish (sentence-case for shouted prose)
// ─────────────────────────────────────────────────────────────────────

const MIN_LENGTH_FOR_SHOUT_DETECTION = 12; // skip tiny labels
const SHOUT_THRESHOLD = 0.6;

function isLikelyCode(text: string): boolean {
  // Heuristic: presence of ≥2 of these strongly suggests code
  let signals = 0;
  if (/[{}();]/.test(text) && /[{}();].*[{}();]/.test(text)) signals++;
  if (/=>|->|::|<=|>=|!=|==/.test(text)) signals++;
  if (/^\s{2,}\S/m.test(text)) signals++;
  if (/\bdef\s+\w+\s*\(/.test(text) || /\bclass\s+\w+\s*[:({]/.test(text)) signals++;
  return signals >= 2;
}

function uppercaseRatio(text: string): number {
  let upper = 0, lower = 0;
  for (const ch of text) {
    if (ch >= "A" && ch <= "Z") upper++;
    else if (ch >= "a" && ch <= "z") lower++;
    else if (ch.toUpperCase() !== ch.toLowerCase()) {
      // Non-ASCII letter (acentos, etc.) — count as upper if it equals
      // its uppercased form
      if (ch === ch.toUpperCase()) upper++;
      else lower++;
    }
  }
  const total = upper + lower;
  return total === 0 ? 0 : upper / total;
}

// Build a single masking pass that protects: acronyms, dotted calls,
// backticks, filenames, URLs. Returns masked string + restoration map.
function maskAllProtected(text: string): { masked: string; restore: (s: string) => string } {
  const placeholders: Array<{ key: string; value: string }> = [];
  let counter = 0;
  const mark = (value: string): string => {
    // Marker MUST contain no ASCII letters — toSentenceCase below
    // lowercases the entire string, which would otherwise corrupt the
    // marker and break restore. Pure digits + control chars are safe.
    const key = `\u0001${counter++}\u0002`;
    placeholders.push({ key, value });
    return key;
  };

  let out = text;
  // Order matters: backticks first (they wrap arbitrary content),
  // then URLs, dotted calls, filenames, acronyms last.
  out = out.replace(BACKTICK_RE, (m) => mark(m));
  out = out.replace(URL_RE, (m) => mark(m));
  // Dotted calls: lowercase the captured form so REQUESTS.GET() restores
  // as requests.get() (canonical Python/JS form, per user spec test #3).
  out = out.replace(DOTTED_CALL_RE, (m) => mark(m.toLowerCase()));
  // Filenames: lowercase extension only when whole match is uppercase
  // (APP.PY → app.py); preserve mixed-case (README.md untouched).
  out = out.replace(FILENAME_RE, (m) => mark(m === m.toUpperCase() ? m.toLowerCase() : m));
  for (const { re } of PROTECTED_ACRONYMS) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => {
      // Normalise common shout-plurals: APIS → APIs, URLS → URLs
      if (/^[A-Z]+S$/.test(m) && m.length >= 4) {
        return mark(m.slice(0, -1) + "s");
      }
      return mark(m.toUpperCase() === m ? m : m); // keep as-is
    });
  }

  const restore = (s: string): string => {
    let result = s;
    for (const { key, value } of placeholders) {
      result = result.split(key).join(value);
    }
    return result;
  };
  return { masked: out, restore };
}

// Sentence-case a string: lowercase everything, then capitalise the
// first letter of each sentence. Sentences are separated by `.`, `!`,
// `?`, or newline followed by whitespace.
function toSentenceCase(text: string): string {
  const lowered = text.toLowerCase();
  return lowered.replace(
    /(^|[.!?]\s+|\n\s*)([a-zà-ÿ])/g,
    (_m, sep, ch) => sep + ch.toUpperCase(),
  );
}

export function polishEditorialText(
  rawText: string,
  ctx?: EditorialContext,
): string {
  const raw = (rawText || "").toString();
  if (raw.length < MIN_LENGTH_FOR_SHOUT_DETECTION) return raw;
  if (isLikelyCode(raw)) return raw;

  const ratio = uppercaseRatio(raw);
  if (ratio < SHOUT_THRESHOLD) return raw;

  // Phase A — protect technical tokens via the shared preservation layer
  const protection = protectTechnicalTokens(raw);
  // Phase B — protect editorial acronyms / dotted calls / etc.
  const { masked, restore } = maskAllProtected(protection.maskedText);
  // Phase C — sentence case
  const cased = toSentenceCase(masked);
  // Phase D — restore editorial protections
  const editorialRestored = restore(cased);
  // Phase E — restore technical tokens
  const finalText = restoreTechnicalTokens(editorialRestored, protection.tokenMap);
  // Phase F — integrity check (defensive; never throws)
  const integrity = validateTechnicalTokenIntegrity(raw, finalText, protection.tokenMap);
  if (!integrity.ok) {
    console.warn(
      `[CASE-NORMALIZE] integrity_failed slide=${ctx?.slideNum ?? "?"} ` +
      `field=${ctx?.field ?? "?"} reason=${integrity.reason} → reverted`,
    );
    return raw;
  }

  if (finalText !== raw) {
    console.log(
      `[CASE-NORMALIZE] slide=${ctx?.slideNum ?? "?"} field=${ctx?.field ?? "?"} ` +
      `before="${raw.slice(0, 80)}" after="${finalText.slice(0, 80)}"`,
    );
  }
  return finalText;
}
