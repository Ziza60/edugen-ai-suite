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
// v5.7.3 — Reorders rules: function_returns_implicit_none BEFORE
// function_defined_but_uncalled. Adds logging.* skip in body walker.
const RESULT_ISH = /^(total|result|resultado|soma|valor|saida|saída|output|final|count|qtd|ans|response|payload|data|out|val|ret)\w*$/i;

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

  // v5.7.3 — function_returns_implicit_none — REORDERED upstream of
  // function_defined_but_uncalled. Skips logging.*/print/logger lines so
  // side-effect calls don't mask the real "last computational assignment".
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
      if (/^\s*(logging|logger|log|print)\s*\.?\s*\w*\s*\(/.test(bl)) continue;
      const am = bl.match(/^\s+([a-z_][\w]*)\s*=\s*[^=]/);
      if (am) lastAssignVar = am[1];
    }
    if (!bodyHasReturn && lastAssignVar && RESULT_ISH.test(lastAssignVar)) {
      return "function_returns_implicit_none";
    }
  }

  // v5.7.1 — function_defined_but_uncalled.
  const topLevelDefRe = /^def\s+([a-z_][\w]*)\s*\(/gm;
  const topLevelDefs: { name: string; isDecorated: boolean }[] = [];
  let dm: RegExpExecArray | null;
  while ((dm = topLevelDefRe.exec(t)) !== null) {
    const before = t.slice(0, dm.index);
    const prevLines = before.split("\n");
    let isDecorated = false;
    for (let i = prevLines.length - 1; i >= 0; i--) {
      const line = prevLines[i].trim();
      if (line === "") continue;
      if (/^@[\w.]+/.test(line)) { isDecorated = true; break; }
      break;
    }
    topLevelDefs.push({ name: dm[1], isDecorated });
  }
  if (topLevelDefs.length > 0) {
    const tForCallScan = t.replace(/^def\s+[a-z_][\w]*\s*\(/gm, "__DEFSIG__(");
    for (const { name: fn, isDecorated } of topLevelDefs) {
      if (isDecorated) continue;
      const callRe = new RegExp(`(?<![\\w.])${fn}\\s*\\(`);
      const decoRe = new RegExp(`@\\s*${fn}\\b`);
      if (!callRe.test(tForCallScan) && !decoRe.test(t)) {
        return "function_defined_but_uncalled";
      }
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

// ── Inlined repair (mirror of repairIncompleteCodeExample minimal subset) ──
// Only the v5.7.2/3 patterns we need to test the convergent loop:
//   - inject_missing_return (returns updated code, lets loop continue)
//   - function_call_demo (appends call+print, lets loop continue)
//   - wrap_method_in_print
function repairIncompleteCodeExample(code: string, reason: string): string | null {
  let out = code;

  if (reason === "bare_method_call_discards_return") {
    const lines = out.split("\n");
    const returning = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s+)def\s+([a-z_][\w]*)\s*\(\s*self\b/);
      if (!m) continue;
      const defIndent = m[1].length;
      for (let j = i + 1; j < lines.length; j++) {
        const bl = lines[j];
        if (bl.trim() === "") continue;
        const ind = bl.match(/^(\s*)/)![1].length;
        if (ind <= defIndent) break;
        if (/^\s*return\s+(?!None\s*$|$)/.test(bl)) { returning.add(m[2]); break; }
      }
    }
    let replaced = false;
    const newLines = lines.map((line) => {
      if (replaced || /^\s/.test(line)) return line;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("print(")) return line;
      const bm = trimmed.match(/^([a-z_][\w]*\.[a-z_][\w]*\s*\([^)]*\))\s*$/);
      if (!bm) return line;
      const methodName = trimmed.split(".")[1].split("(")[0];
      if (!returning.has(methodName)) return line;
      replaced = true;
      return `print(${bm[1]})`;
    });
    if (replaced) return newLines.join("\n");
  }

  if (reason === "function_returns_implicit_none") {
    const lines = out.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^def\s+([a-z_][\w]*)\s*\(([^)]*)\)/);
      if (!m) continue;
      let bodyHasReturn = false;
      let lastAssignVar: string | null = null;
      let lastAssignIndent = "    ";
      let bodyEnd = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        const bl = lines[j];
        if (bl.trim() === "") continue;
        const ind = bl.match(/^(\s*)/)![1].length;
        if (ind === 0) { bodyEnd = j; break; }
        if (/^\s*return\b/.test(bl)) { bodyHasReturn = true; break; }
        const am = bl.match(/^(\s+)([a-z_][\w]*)\s*=\s*[^=]/);
        if (am) {
          lastAssignVar = am[2];
          lastAssignIndent = am[1];
        }
      }
      if (bodyHasReturn || !lastAssignVar || !RESULT_ISH.test(lastAssignVar)) continue;
      lines.splice(bodyEnd, 0, `${lastAssignIndent}return ${lastAssignVar}`);
      return lines.join("\n");
    }
  }

  if (reason === "function_defined_but_uncalled") {
    const fnDefs = [...out.matchAll(/^def\s+([a-z_][\w]*)\s*\(([^)]*)\)/gm)];
    if (fnDefs.length > 0) {
      const last = fnDefs[fnDefs.length - 1];
      const fnName = last[1];
      const params = last[2] ?? "";
      const args = params
        .split(",")
        .map((p) => p.trim().split(/[:=]/)[0].trim())
        .map((n) => n.replace(/^\*{1,2}/, ""))
        .filter((n) => n && n !== "self" && n !== "cls" && n !== "args" && n !== "kwargs")
        .map((n) => {
          const lower = n.toLowerCase();
          if (/^lista|^list|seq|items|valores|numeros|carrinho|dados/.test(lower)) return `[10, 20, 30]`;
          if (/preco|valor|num|qtd|total|count|idade|^[abcnxyij]$/.test(lower)) return `10`;
          return `"${n}"`;
        })
        .join(", ");
      out += `\n\nresultado = ${fnName}(${args})\nprint(resultado)`;
      return out;
    }
  }

  if (reason === "assignment_result_unused") {
    const lines = out.split("\n");
    let last = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() !== "") { last = i; break; }
    }
    if (last >= 0) {
      const am = lines[last].match(/^([a-z_][\w]*)\s*=/);
      if (am) return out + `\nprint(${am[1]})`;
    }
  }

  return null;
}

// ── Convergent loop (mirror of v5.7.3 Guardrail 4) ──
function runConvergentRepair(code: string): { final: string; cycles: number; trace: any[]; firstReason: string | null; lastReason: string | null } {
  const MAX = 4;
  let cur = code;
  const trace: any[] = [];
  let cycle = 0;
  let firstReason: string | null = null;
  let lastReason: string | null = null;
  while (cycle < MAX) {
    const reason = validateSemanticCodeCompleteness(cur);
    if (cycle === 0) firstReason = reason;
    trace.push({ cycle, phase: cycle === 0 ? "detect" : "revalidate", reason });
    if (reason === null) { lastReason = null; break; }
    lastReason = reason;
    const repaired = repairIncompleteCodeExample(cur, reason);
    if (!repaired || repaired === cur) {
      trace.push({ cycle, phase: "repair", reason, applied: false });
      break;
    }
    trace.push({ cycle, phase: "repair", reason, applied: true });
    cur = repaired;
    cycle++;
  }
  return { final: cur, cycles: cycle, trace, firstReason, lastReason };
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
    cliente.start()

configurar({"host": "x"})`;
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

// === v5.7.3 — CONVERGENT LOOP tests ===
// These reproduce the EXACT slides 14 and 43 production failure modes.
// Without the loop the validator finds defect A, repair fixes A, defect B
// remains, and the export ships broken. With the loop both defects converge.

// Slide 14 REAL — function with if/elif chain, no return, no call.
// Production symptom: print(None) after v5.7.2's call-demo.
const slide14Real = `def calcularvalortotal(carrinhodecompras):
    totalbruto = sum(carrinhodecompras)
    if totalbruto > 80:
        desconto = totalbruto * 0.2
    elif totalbruto > 50:
        desconto = totalbruto * 0.1
    else:
        desconto = 0
    totalliquido = totalbruto - desconto`;
{
  const r = runConvergentRepair(slide14Real);
  assert(r.lastReason === null,
    `LOOP slide14 (if/elif) — converges to PASSED (final=${r.lastReason}, cycles=${r.cycles})`);
  assert(/return totalliquido/.test(r.final),
    `LOOP slide14 — injected 'return totalliquido' after if/elif chain`);
  assert(/resultado\s*=\s*calcularvalortotal\(/.test(r.final) && /print\(resultado\)/.test(r.final),
    `LOOP slide14 — appended call demo + print(resultado)`);
  assert(r.firstReason === "function_returns_implicit_none",
    `LOOP slide14 — first reason is function_returns_implicit_none (proves reorder works, was function_defined_but_uncalled before v5.7.3)`);
}

// Slide 43 REAL — function with logging.debug() AFTER the assignment, no return, no call.
// Production symptom: logging masks the real "last assignment" detection.
const slide43Real = `import logging

def processar_dados(dados):
    soma = sum(dados)
    logging.debug(f"Soma calculada: {soma}")`;
{
  const r = runConvergentRepair(slide43Real);
  assert(r.lastReason === null,
    `LOOP slide43 (logging) — converges to PASSED (final=${r.lastReason}, cycles=${r.cycles})`);
  assert(/return soma/.test(r.final),
    `LOOP slide43 — injected 'return soma' (logging.debug did NOT mask the real result var)`);
  assert(/logging\.debug/.test(r.final),
    `LOOP slide43 — preserved logging.debug side-effect (return injected at body END)`);
  assert(/resultado\s*=\s*processar_dados\(/.test(r.final) && /print\(resultado\)/.test(r.final),
    `LOOP slide43 — appended call demo`);
}

// Loop bound: must terminate within MAX_REPAIR_CYCLES (4) on a worst case
// chain. Slide 14 is exactly this worst case: detect → inject_return → re-validate
// → call_demo → re-validate → PASS. cycles must be <= 2.
{
  const r = runConvergentRepair(slide14Real);
  assert(r.cycles <= 2, `LOOP — slide14 converges in <= 2 cycles (got ${r.cycles})`);
  assert(r.trace.length >= 4, `LOOP — trace has >= 4 entries (detect+repair+revalidate+repair) (got ${r.trace.length})`);
}

// Idempotency: a slide already complete must take 0 cycles.
{
  const clean = `def f(x):\n    return x * 2\n\nprint(f(5))`;
  const r = runConvergentRepair(clean);
  assert(r.cycles === 0 && r.lastReason === null && r.final === clean,
    `LOOP — clean code is idempotent (0 cycles, no mutation)`);
}

console.log(`\nResult: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  if (typeof (globalThis as any).Deno !== "undefined") (globalThis as any).Deno.exit(1);
  if (typeof (globalThis as any).process !== "undefined") (globalThis as any).process.exit(1);
}
