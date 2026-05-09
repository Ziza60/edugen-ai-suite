// Deno smoke tests for v5.7.1 code-completeness hardening.
// Covers the 4 real slide patterns from the user report (slides 13, 35, 43, 49):
//   13 — function `calcularvalortotal` defined but never called, no return
//   35 — class Carro with `print(carro_amigo)` (bare instance print)
//   43 — function `processar_numeros` with logging but no call demo
//   49 — function `saudar` with `-> str`, `raise` in error path, no happy return
//
// Run: deno test --allow-read supabase/functions/export-pptx-v4/__tests__/v571_code_completeness.smoke.ts
//
// Notes
// - We re-test the *contract* of `validateSemanticCodeCompleteness` and the
//   preventive rewrite `repairBareInstancePrint` by inlining minimal copies
//   (same convention as `v541_fixes.smoke.ts`). Importing index.ts directly
//   would pull `Deno.serve` and the entire 9k-line module.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ─── Inlined copy of validateSemanticCodeCompleteness (v5.7.1) ────────────
function validateSemanticCodeCompleteness(code: string): string | null {
  if (!code || !code.trim()) return "empty";
  const t = code.trim();
  const lines = t.split("\n");
  for (const ln of lines) {
    const s = ln.trim();
    if (/^\.{3,}$/.test(s)) return "ellipsis_placeholder";
    if (/^(#|\/\/|--)\s*\.{2,}/.test(s)) return "ellipsis_comment_placeholder";
    if (/^(#|\/\/|--)\s*(continua|restante omitido|resto omitido|TODO|FIXME|XXX)/i.test(s)) return "todo_placeholder";
  }
  const codeLines = lines.filter((l) => {
    const x = l.trim();
    return x && !x.startsWith("#") && !x.startsWith("//") && !x.startsWith("--");
  }).length;
  if (codeLines < 2) return "too_few_code_lines";
  const lastNonBlank = (() => {
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return lines[i].trim();
    return "";
  })();
  if (/[,:({\[]\s*$/.test(lastNonBlank)) return "trailing_open_bracket";
  const classMatch = t.match(/^\s*class\s+([A-Z][A-Za-z0-9_]*)/m);
  if (classMatch) {
    const cls = classMatch[1];
    const instRe = new RegExp(`^\\s*([a-z_][\\w]*)\\s*=\\s*${cls}\\s*\\(`, "gm");
    const instances: string[] = [];
    let im: RegExpExecArray | null;
    while ((im = instRe.exec(t)) !== null) instances.push(im[1]);
    if (instances.length === 0) return "class_defined_but_unused";
    const hasRealUse = instances.some((inst) =>
      new RegExp(`\\b${inst}\\s*\\.\\s*[a-zA-Z_]\\w*`).test(t),
    );
    if (!hasRealUse) return "class_instance_no_method_call";
  }
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
  const definesClass = /^\s*class\s+[A-Z]/m.test(t);
  const hasOutput = /\b(print|return|yield|raise|assert)\s*[\(.]|\blog(?:ger|ging)?\.[a-z]+\s*\(/.test(t);
  if (definesClass && !hasOutput) return "class_defined_but_no_output";
  return null;
}

// ─── Inlined copy of repairBareInstancePrint (v5.7.1) ────────────────────
type CodeSymbols = { classes: string[]; vars: string[]; funcs: string[]; imports: string[]; };
function extractCodeSymbols(code: string | null | undefined): CodeSymbols {
  const out: CodeSymbols = { classes: [], vars: [], funcs: [], imports: [] };
  if (!code) return out;
  for (const line of code.split("\n")) {
    const c = line.match(/^\s*class\s+([A-Z][A-Za-z0-9_]*)/);
    if (c) out.classes.push(c[1]);
    const v = line.match(/^\s*([a-z_][a-z0-9_]*)\s*=\s*[A-Z][A-Za-z0-9_]*\s*\(/);
    if (v) out.vars.push(v[1]);
    const f = line.match(/^\s*def\s+([a-z_][\w]*)\s*\(/);
    if (f) out.funcs.push(f[1]);
  }
  return out;
}
function repairBareInstancePrint(code: string, moduleCtx: CodeSymbols): string {
  if (!code) return code;
  const m = code.match(/^([ \t]*)print\(\s*([a-z_][\w]*)\s*\)\s*$/m);
  if (!m) return code;
  const [fullMatch, indent, instName] = m;
  const isInst = new RegExp(`\\b${instName}\\s*=\\s*[A-Z][A-Za-z0-9_]*\\s*\\(`).test(code);
  if (!isInst) return code;
  const SKIP_FNS = new Set(["__init__", "__new__", "__str__", "__repr__", "main", "init"]);
  const localFuncs = extractCodeSymbols(code).funcs;
  const candidate = localFuncs.find((f) => !SKIP_FNS.has(f)) ??
    moduleCtx.funcs.find((f) => !SKIP_FNS.has(f));
  if (!candidate) return code;
  return code.replace(fullMatch, `${indent}${instName}.${candidate}()`);
}

// ─── REGRESSION FIXTURES — actual user-reported slides ───────────────────

// Slide 13 — control_flow module: function defined but never called.
// Original symptom: validator returned null (passed); slide rendered with
// no demonstration of the function's output.
const SLIDE_13_FN_NO_CALL = `def calcularvalortotal(carrinhodecompras):
    totalbruto = 0.0
    for item in carrinhodecompras:
        totalbruto += item['preco']
    desconto = 0.0
    if totalbruto > 80.00:
        desconto = totalbruto * 0.10
    elif totalbruto > 50.00:
        desconto = totalbruto * 0.05
    totalliquido = totalbruto - desconto`;

// Slide 35 — OOP module: class with bare print(instance) only.
// Original symptom: validator returned null; print(carro_amigo) just
// prints the object's address, which is pedagogically meaningless.
const SLIDE_35_CLASS_BARE_PRINT = `class Carro:
    def __init__(self, marca, modelo):
        self.marca = marca
        self.modelo = modelo

    def exibir_info(self):
        return f"Marca: {self.marca}, Modelo: {self.modelo}"

# Criando objetos
meu_carro = Carro("Toyota", "Corolla")
carro_amigo = Carro("Honda", "Civic")
print(carro_amigo)`;

// Slide 43 — tests_logs module: function with logging, no call demo.
// Original symptom: validator returned null (logging.* matches hasOutput).
const SLIDE_43_LOGGING_NO_CALL = `import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

def processar_numeros(lista_numeros):
    logging.info("Iniciando processamento de números.")
    if not isinstance(lista_numeros, list):
        logging.error("Entrada inválida: esperado uma lista.")
        return None

    soma = sum(lista_numeros)
    logging.debug(f"Soma calculada: {soma}")`;

// Slide 49 — best_practices: function defined with raise but no call.
// Original symptom: validator returned null (raise matches hasOutput).
const SLIDE_49_RAISE_NO_CALL = `def saudar(nome: str) -> str:
    """
    Gera uma saudação personalizada para o nome fornecido.
    """
    if not isinstance(nome, str) or not nome:
        raise ValueError("O nome deve ser uma string não vazia.")`;

// ─── Validator regression tests — 4 user-reported patterns ────────────────

Deno.test("validator: slide 13 — function defined but never called → BLOCKED", () => {
  const reason = validateSemanticCodeCompleteness(SLIDE_13_FN_NO_CALL);
  assertEquals(reason, "function_defined_but_uncalled");
});

Deno.test("validator: slide 35 — class with print(instance) only → BLOCKED", () => {
  const reason = validateSemanticCodeCompleteness(SLIDE_35_CLASS_BARE_PRINT);
  assertEquals(reason, "class_instance_no_method_call");
});

Deno.test("validator: slide 43 — logging fn, no call demo → BLOCKED", () => {
  const reason = validateSemanticCodeCompleteness(SLIDE_43_LOGGING_NO_CALL);
  assertEquals(reason, "function_defined_but_uncalled");
});

Deno.test("validator: slide 49 — raise on error path, no call → BLOCKED", () => {
  const reason = validateSemanticCodeCompleteness(SLIDE_49_RAISE_NO_CALL);
  assertEquals(reason, "function_defined_but_uncalled");
});

// ─── Validator positive tests — must STILL accept good educational code ──

Deno.test("validator: function WITH call demo → OK", () => {
  const code = `def somar(a, b):
    return a + b

resultado = somar(2, 3)
print(resultado)`;
  assertEquals(validateSemanticCodeCompleteness(code), null);
});

Deno.test("validator: class WITH method call → OK", () => {
  const code = `class Carro:
    def __init__(self, marca):
        self.marca = marca
    def exibir(self):
        return self.marca

meu_carro = Carro("Honda")
print(meu_carro.exibir())`;
  assertEquals(validateSemanticCodeCompleteness(code), null);
});

Deno.test("validator: class WITH attribute access → OK", () => {
  const code = `class Pessoa:
    def __init__(self, nome):
        self.nome = nome

p = Pessoa("Ana")
print(p.nome)`;
  assertEquals(validateSemanticCodeCompleteness(code), null);
});

Deno.test("validator: top-level def used as decorator → OK", () => {
  const code = `def log_calls(fn):
    return fn

@log_calls
def hello():
    print("hi")`;
  assertEquals(validateSemanticCodeCompleteness(code), null);
});

Deno.test("validator: methods inside class are NOT top-level defs", () => {
  // Only the class is defined; both `def`s are indented (methods).
  // Class is instantiated AND method-called, so this passes.
  const code = `class Calc:
    def __init__(self, x):
        self.x = x
    def dobrar(self):
        return self.x * 2

c = Calc(5)
print(c.dobrar())`;
  assertEquals(validateSemanticCodeCompleteness(code), null);
});

Deno.test("validator: legacy ellipsis still BLOCKED", () => {
  assertEquals(validateSemanticCodeCompleteness("x = 1\n# ..."), "ellipsis_comment_placeholder");
});

Deno.test("validator: legacy too_few_code_lines still BLOCKED", () => {
  assertEquals(validateSemanticCodeCompleteness("x = 1"), "too_few_code_lines");
});

// ─── Preventive repair tests ──────────────────────────────────────────────

Deno.test("repair: bare print(instance) → instance.method() (local funcs)", () => {
  const repaired = repairBareInstancePrint(SLIDE_35_CLASS_BARE_PRINT, {
    classes: [], vars: [], funcs: [], imports: [],
  });
  assertStringIncludes(repaired, "carro_amigo.exibir_info()");
  assert(!repaired.includes("print(carro_amigo)"), "old bare print must be gone");
});

Deno.test("repair: bare print(instance) → instance.method() (module ctx fallback)", () => {
  const code = `livro = Livro("Dom Casmurro")
print(livro)`;
  const ctx: CodeSymbols = { classes: ["Livro"], vars: ["livro"], funcs: ["resumo", "__init__"], imports: [] };
  const repaired = repairBareInstancePrint(code, ctx);
  assertStringIncludes(repaired, "livro.resumo()");
});

Deno.test("repair: bare print(non-instance) → unchanged", () => {
  const code = `x = 5
print(x)`;
  assertEquals(repairBareInstancePrint(code, { classes: [], vars: [], funcs: [], imports: [] }), code);
});

Deno.test("repair: no print(instance) pattern → unchanged", () => {
  const code = `meu_carro = Carro("Honda")
meu_carro.exibir_info()`;
  assertEquals(repairBareInstancePrint(code, { classes: [], vars: [], funcs: [], imports: [] }), code);
});

Deno.test("repair: skips dunder methods even if they are the only ones", () => {
  const code = `class Foo:
    def __init__(self):
        self.x = 1
f = Foo()
print(f)`;
  // Only __init__ in funcs → no candidate → unchanged
  assertEquals(repairBareInstancePrint(code, { classes: [], vars: [], funcs: [], imports: [] }), code);
});

// ─── End-to-end: repair output passes the validator ──────────────────────

Deno.test("e2e slide 35: preventive repair makes the slide pass validation", () => {
  const repaired = repairBareInstancePrint(SLIDE_35_CLASS_BARE_PRINT, {
    classes: [], vars: [], funcs: [], imports: [],
  });
  assertEquals(validateSemanticCodeCompleteness(repaired), null);
});
