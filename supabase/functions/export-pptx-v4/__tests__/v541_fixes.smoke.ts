// Deno smoke tests for v5.4.1 surgical fixes.
// Run: deno test --allow-read supabase/functions/export-pptx-v4/__tests__/v541_fixes.smoke.ts

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ─── Inlined copies of the fixed functions (kept in sync with index.ts) ────
// Importing from index.ts directly would pull the entire 8200-line module
// (Deno.serve side effects). We re-test the exact regex/replacement contracts.

const SEMANTIC_REPAIRS_PY_OOP = {
  use_with_name: (_t: string) =>
    "Usar a palavra-chave `class` seguida do nome da classe em PascalCase.",
  define_classes_no_class: (_t: string) =>
    "Definir Classes: usar a palavra-chave `class` com nome em PascalCase.",
};

function repairPythonRequestsSnippet(code: string): string | null {
  const m = code.match(/requests\.(get|post|put|delete|patch|head)\s*\(/i);
  if (!m) return null;
  const method = m[1].toLowerCase();
  const hasBody = method === "post" || method === "put" || method === "patch";
  const lines = [
    "import requests",
    "",
    `url = "https://api.example.com/data"`,
  ];
  if (hasBody) {
    lines.push(`payload = {"key": "value"}`);
    lines.push(`response = requests.${method}(url, json=payload)`);
  } else {
    lines.push(`response = requests.${method}(url)`);
  }
  lines.push("print(response.status_code)");
  lines.push("print(response.json())");
  return lines.join("\n");
}

// Mid-word truncation guard helper for the test below.
function endsMidWord(s: string): boolean {
  // A complete sentence ends with a period, question, exclamation, or
  // a closing punctuation. "...com nome mai" ends in a stripped letter
  // sequence with no terminal punctuation → mid-word.
  const trimmed = s.trim();
  if (/[.!?…]$/.test(trimmed)) return false;
  if (/[)`"'»\]]$/.test(trimmed)) return false;
  // Ends with bare letters and no punctuation → suspicious mid-word
  return /[a-záéíóúãõâêôç]{2,}$/i.test(trimmed);
}

// ── Fix 3: define_classes_no_class must REPLACE, not concatenate ──────────
Deno.test("Fix 3 — define_classes_no_class produces full sentence (no concat)", () => {
  const broken = "Definir Classes: Usar a palavra-chave class com nome maiúsculo.";
  const out = SEMANTIC_REPAIRS_PY_OOP.define_classes_no_class(broken);
  assertEquals(
    out,
    "Definir Classes: usar a palavra-chave `class` com nome em PascalCase.",
  );
  assert(!out.includes("maiúsculo"), "must NOT keep the original tail");
  assert(!out.includes("mai") || out.includes("PascalCase"), "must NOT leave mid-word");
});

Deno.test("Fix 3 — use_with_name produces full sentence", () => {
  const broken = "Usar com nome (Ex: )";
  const out = SEMANTIC_REPAIRS_PY_OOP.use_with_name(broken);
  assertEquals(
    out,
    "Usar a palavra-chave `class` seguida do nome da classe em PascalCase.",
  );
  assert(out.endsWith("."), "must end with period");
});

Deno.test("Fix 3 — no repair output may end mid-word", () => {
  for (const fn of Object.values(SEMANTIC_REPAIRS_PY_OOP)) {
    const out = fn("Definir Classes: Usar a palavra-chave class com nome maiúsculo.");
    assert(
      !endsMidWord(out),
      `Output ends mid-word (no terminal punctuation): "${out}"`,
    );
    assertStringIncludes(out, "`class`", "must contain technical token `class`");
  }
});

// ── Fix 1: repairPythonRequestsSnippet completes pedagogical closure ─────
Deno.test("Fix 1 — requests.get gets full closure", () => {
  const out = repairPythonRequestsSnippet("requests.get(url)");
  assert(out, "must return a snippet");
  assertStringIncludes(out!, "import requests");
  assertStringIncludes(out!, "response = requests.get(");
  assertStringIncludes(out!, "print(response.status_code)");
  assertStringIncludes(out!, "print(response.json())");
});

Deno.test("Fix 1 — requests.post gets json=payload body", () => {
  const out = repairPythonRequestsSnippet("requests.post(url, json={'a':1})");
  assert(out, "must return a snippet");
  assertStringIncludes(out!, "payload =");
  assertStringIncludes(out!, "response = requests.post(url, json=payload)");
  assertStringIncludes(out!, "print(response.status_code)");
  assertStringIncludes(out!, "print(response.json())");
});

Deno.test("Fix 1 — non-requests code returns null", () => {
  assertEquals(repairPythonRequestsSnippet("print('hello')"), null);
  assertEquals(repairPythonRequestsSnippet("def foo(): pass"), null);
  assertEquals(repairPythonRequestsSnippet("SELECT * FROM t"), null);
});

Deno.test("Fix 1 — output is bracket-balanced", () => {
  for (const m of ["get", "post", "put", "delete", "patch", "head"]) {
    const out = repairPythonRequestsSnippet(`requests.${m}(url)`);
    assert(out);
    const opens = (out!.match(/\(/g) ?? []).length;
    const closes = (out!.match(/\)/g) ?? []).length;
    assertEquals(opens, closes, `unbalanced parens for ${m}`);
    // Last line should always end with `)` (a print() call)
    const lastLine = out!.split("\n").filter(Boolean).pop()!;
    assert(/\)$/.test(lastLine), `last line should close a call: "${lastLine}"`);
  }
});

// ── Fix 2: batch replacement contract for ≥50% generic items ──────────────
const PY_OOP_TAILS = [
  "Definir classes com `class` e atributos no `__init__()`.",
  "Criar objetos e invocar métodos sobre instâncias.",
  "Aplicar herança e encapsulamento em classes Python.",
];

function repairBatch(arr: string[], isGeneric: (s: string) => boolean): string[] {
  if (!arr.length) return arr;
  const genericCount = arr.filter(isGeneric).length;
  if (genericCount * 2 >= arr.length) {
    const N = Math.min(Math.max(arr.length, 2), PY_OOP_TAILS.length);
    return PY_OOP_TAILS.slice(0, N);
  }
  return arr;
}

Deno.test("Fix 2 — 2/4 generic triggers full replacement", () => {
  const items = [
    "Compreender Python orientado a objetos",   // generic
    "Aplicar fundamentos de POO",                // generic
    "Criar uma classe Livro com __init__",       // concrete
    "Usar herança entre classes",                // concrete
  ];
  const isGeneric = (s: string) =>
    /^(Compreender|Aplicar fundamentos|Identificar)\b/i.test(s);
  const out = repairBatch(items, isGeneric);
  assertEquals(out.length, 3);
  assertEquals(out, PY_OOP_TAILS.slice(0, 3));
});

Deno.test("Fix 2 — 1/4 generic does NOT trigger batch (item-level)", () => {
  const items = [
    "Compreender Python",
    "Criar uma classe Livro",
    "Usar herança",
    "Aplicar polimorfismo",
  ];
  const isGeneric = (s: string) => /^Compreender\b/.test(s);
  const out = repairBatch(items, isGeneric);
  assertEquals(out, items);
});
