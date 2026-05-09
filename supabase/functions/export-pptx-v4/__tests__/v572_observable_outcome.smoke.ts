// v5.7.2 — observable_outcome + visual_truncation smoke tests.
// Mirrors the validator + repair + truncation logic from index.ts so we can
// run via Deno or Node (V8) without bundling the whole edge function.
//
// To run with Deno:
//   deno test --allow-read supabase/functions/export-pptx-v4/__tests__/v572_observable_outcome.smoke.ts
//
// To run with Node (no deps):
//   node -e 'import("./supabase/functions/export-pptx-v4/__tests__/v572_observable_outcome.smoke.ts")'

// ── Inlined validator (mirror of validateSemanticCodeCompleteness in index.ts) ──
function validateSemanticCodeCompleteness(code: string): string | null {
  const t = code.trim();
  if (!t) return "empty";
  const allLines = t.split("\n");

  // Methods that return a non-trivial value
  const returningMethods = new Set<string>();
  for (let i = 0; i < allLines.length; i++) {
    const m = allLines[i].match(/^(\s+)def\s+([a-z_][\w]*)\s*\(\s*self\b/);
    if (!m) continue;
    const defIndent = m[1].length;
    for (let j = i + 1; j < allLines.length; j++) {
      const bl = allLines[j];
      if (bl.trim() === "") continue;
      const ind = bl.match(/^(\s*)/)![1].length;
      if (ind <= defIndent) break;
      if (/^\s*return\s+(?!None\s*$|$)/.test(bl)) { returningMethods.add(m[2]); break; }
    }
  }

  if (returningMethods.size > 0) {
    for (const line of allLines) {
      if (/^\s/.test(line)) continue;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const bm = trimmed.match(/^([a-z_][\w]*)\.([a-z_][\w]*)\s*\([^)]*\)\s*$/);
      if (!bm) continue;
      if (returningMethods.has(bm[2])) return "bare_method_call_discards_return";
    }
  }

  const RESULT_ISH = /^(total|result|resultado|soma|valor|saida|saída|output|final|count|qtd|ans|response|payload|data|out|val|ret)\w*$/i;
  for (let i = 0; i < allLines.length; i++) {
    const m = allLines[i].match(/^def\s+([a-z_][\w]*)\s*\(/);
    if (!m) continue;
    let bodyHasReturn = false;
    let lastAssignVar: string | null = null;
    for (let j = i + 1; j < allLines.length; j++) {
      const bl = allLines[j];
      if (bl.trim() === "") continue;
      const ind = bl.match(/^(\s*)/)![1].length;
      if (ind === 0) break;
      if (/^\s*return\b/.test(bl)) { bodyHasReturn = true; break; }
      const am = bl.match(/^\s+([a-z_][\w]*)\s*=\s*[^=]/);
      if (am) lastAssignVar = am[1];
    }
    if (!bodyHasReturn && lastAssignVar && RESULT_ISH.test(lastAssignVar)) {
      return "function_returns_implicit_none";
    }
  }

  let lastNonBlankIdx = -1;
  for (let i = allLines.length - 1; i >= 0; i--) {
    if (allLines[i].trim() !== "") { lastNonBlankIdx = i; break; }
  }
  if (lastNonBlankIdx >= 0) {
    const last = allLines[lastNonBlankIdx];
    if (!/^\s/.test(last)) {
      const am = last.match(/^([a-z_][\w]*)\s*=\s*[a-z_][\w]*\s*\(/);
      if (am && RESULT_ISH.test(am[1])) {
        const v = am[1];
        let usedElsewhere = false;
        for (let i = 0; i < allLines.length; i++) {
          if (i === lastNonBlankIdx) continue;
          if (new RegExp(`\\b${v}\\b`).test(allLines[i])) { usedElsewhere = true; break; }
        }
        if (!usedElsewhere) return "assignment_result_unused";
      }
    }
  }

  return null;
}

// ── Inlined visual truncation (mirror of repairVisualTruncationInItems) ──
const TRAILING_PREP_RE = /\s+(para|de|da|do|das|dos|com|e|ou|que|em|no|na|nos|nas|ao|à|aos|às|por|sobre|entre|sem|sob|a|as|os|um|uma|uns|umas)\s*$/i;
const ELLIPSIS_TAIL_RE = /^(.*?)(\s*(?:\.{2,}|…+)\s*)$/;

function repairTruncatedItem(item: string): { changed: boolean; result: string; action: string } {
  const m = item.match(ELLIPSIS_TAIL_RE);
  if (!m) return { changed: false, result: item, action: "noop" };
  let cleaned = m[1].trimEnd();
  let dropped = 0;
  while (TRAILING_PREP_RE.test(cleaned) && dropped < 2) {
    cleaned = cleaned.replace(TRAILING_PREP_RE, "").trimEnd();
    dropped++;
  }
  cleaned = cleaned.replace(/[,;:\-]+\s*$/, "").trimEnd();
  const wc = cleaned.split(/\s+/).filter(Boolean).length;
  let action = "stripped_and_capped";
  if (wc === 0) { action = "dropped_empty"; cleaned = ""; }
  else if (wc < 2) action = "kept_short";
  else if (!/[.!?:]$/.test(cleaned)) { cleaned += "."; if (wc < 3) action = "kept_short_punctuated"; }
  return { changed: true, result: cleaned, action };
}

// ── Test harness ──
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`✗ ${msg}`); failures++; }
  else { console.log(`✓ ${msg}`); passes++; }
}
let passes = 0, failures = 0;

// === Validator: function_returns_implicit_none (slide 14 / 46 family) ===
const slide14 = `def calcularvalortotal(carrinhodecompras):
    totalbruto = sum(carrinhodecompras)
    desconto = totalbruto * 0.1
    totalliquido = totalbruto - desconto`;
assert(
  validateSemanticCodeCompleteness(slide14) === "function_returns_implicit_none",
  "slide 14 — function with computed totalliquido but no return → flagged",
);

const slide46 = `def processar_dados(dados):
    soma = sum(dados)
    logging.debug(f"Soma calculada: {soma}")`;
assert(
  validateSemanticCodeCompleteness(slide46) === "function_returns_implicit_none",
  "slide 46 — function with soma but no return (logging is not a return) → flagged",
);

// === Validator: bare_method_call_discards_return (slide 40) ===
const slide40 = `class Livro:
    def __init__(self, titulo, autor):
        self.titulo = titulo
        self.autor = autor
    def exibir_detalhes(self):
        return f"{self.titulo} - {self.autor}"

livro2 = Livro("1984", "Orwell")
livro2.exibir_detalhes()`;
assert(
  validateSemanticCodeCompleteness(slide40) === "bare_method_call_discards_return",
  "slide 40 — bare method call discarding string return → flagged",
);

// === Positive controls (must NOT trip the new rules) ===
const ok1 = `def somar(a, b):
    return a + b

print(somar(2, 3))`;
assert(
  validateSemanticCodeCompleteness(ok1) === null,
  "positive — function with return + call demo passes",
);

const ok2 = `class Animal:
    def __init__(self, nome):
        self.nome = nome
    def falar(self):
        return f"{self.nome} faz som"

a = Animal("Rex")
print(a.falar())`;
assert(
  validateSemanticCodeCompleteness(ok2) === null,
  "positive — print(inst.method()) on returning method passes",
);

const ok3 = `def configurar(opts):
    cliente.setup(opts)
    cliente.start()`;
assert(
  validateSemanticCodeCompleteness(ok3) === null,
  "positive — void function with no result-ish var doesn't trigger implicit_none",
);

const ok4 = `def calcular(x):
    total = x * 2
    return total

resultado = calcular(5)
print(resultado)`;
assert(
  validateSemanticCodeCompleteness(ok4) === null,
  "positive — explicit return + demo passes (regression guard for slide 14 fix)",
);

// === Validator: assignment_result_unused ===
const unused = `def soma(a, b):
    return a + b

resultado = soma(2, 3)`;
assert(
  validateSemanticCodeCompleteness(unused) === "assignment_result_unused",
  "assignment_result_unused — terminal `resultado = call()` with no print flagged",
);

// Negative: setup-style assignment should NOT trip
const setup = `cliente = MyClient()
cliente.start()
cliente.send("hello")`;
assert(
  validateSemanticCodeCompleteness(setup) === null,
  "positive — `cliente = MyClient()` setup not flagged (non-result-ish name)",
);

// === Visual truncation ===
const t1 = repairTruncatedItem("Use comentários para…");
assert(t1.changed && t1.result === "Use comentários." && t1.action === "kept_short_punctuated",
  `truncation 1: '${t1.result}' (action=${t1.action})`);

const t2 = repairTruncatedItem("Listar...");
assert(t2.changed && t2.result === "Listar" && t2.action === "kept_short",
  `truncation 2: '${t2.result}' (action=${t2.action})`);

const t3 = repairTruncatedItem("Otimize a leitura de arquivos com…");
assert(t3.changed && t3.result === "Otimize a leitura de arquivos." && t3.action === "stripped_and_capped",
  `truncation 3: '${t3.result}' (action=${t3.action})`);

const t4 = repairTruncatedItem("Texto completo sem reticência.");
assert(!t4.changed && t4.result === "Texto completo sem reticência.",
  `truncation 4 (no-op on clean text): '${t4.result}'`);

const t5 = repairTruncatedItem("Configure logging para depurar e…");
assert(t5.changed && t5.result === "Configure logging para depurar." && t5.action === "stripped_and_capped",
  `truncation 5: '${t5.result}' (action=${t5.action})`);

console.log(`\nResult: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  if (typeof (globalThis as any).Deno !== "undefined") (globalThis as any).Deno.exit(1);
  if (typeof (globalThis as any).process !== "undefined") (globalThis as any).process.exit(1);
}
