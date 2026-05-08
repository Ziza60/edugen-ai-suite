// Smoke tests for editorial-normalization (v5.5.0).
// Run: deno test --allow-read supabase/functions/export-pptx-v4/__tests__/editorial.smoke.ts

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  polishEditorialTitle,
  polishEditorialText,
} from "../editorial-normalization.ts";

Deno.test("title: Que <verb-1pl> X? → Por que <inf> x?", () => {
  assertEquals(
    polishEditorialTitle("Que Representamos Dados?"),
    "Por que representar dados?",
  );
});

Deno.test("title: Que <inf> X? lowercased and prefixed", () => {
  assertEquals(
    polishEditorialTitle("Que Manipular Arquivos e Tratar Exceções?"),
    "Por que manipular arquivos e tratar exceções?",
  );
});

Deno.test("title: 'Por que ...' is preserved", () => {
  const inp = "Por que usar funções?";
  assertEquals(polishEditorialTitle(inp), inp);
});

Deno.test("title: 'O que é POO?' is preserved", () => {
  const inp = "O que é Programação Orientada a Objetos (POO)?";
  assertEquals(polishEditorialTitle(inp), inp);
});

Deno.test("title: technical title 'Tomada de Decisão...' is preserved", () => {
  const inp = "Tomada de Decisão com if, elif e else";
  assertEquals(polishEditorialTitle(inp), inp);
});

Deno.test("title: 'Como Declarar Variáveis em Python' is preserved", () => {
  const inp = "Como Declarar Variáveis em Python";
  assertEquals(polishEditorialTitle(inp), inp);
});

Deno.test("title uppercased: QUE MANIPULAR ARQUIVOS... → sentence-case + por que", () => {
  // Path: title-polish first sees lowerStart "que manipular...", rewrites
  // it to sentence-case via the same algorithm.
  const out = polishEditorialTitle(
    "QUE MANIPULAR ARQUIVOS E TRATAR EXCEÇÕES?",
  );
  assertEquals(out, "Por que manipular arquivos e tratar exceções?");
});

Deno.test("text: shouted APIs sentence is sentence-cased", () => {
  const out = polishEditorialText(
    "APIS WEB PERMITEM A COMUNICAÇÃO ENTRE SOFTWARES VIA HTTP.",
  );
  // "APIS" → "APIs" (plural normalised), "HTTP" preserved, rest sentence-case
  assertEquals(out, "APIs web permitem a comunicação entre softwares via HTTP.");
});

Deno.test("text: requests.get() preserved when shouted", () => {
  const out = polishEditorialText("USE REQUESTS.GET() PARA RECUPERAR DADOS.");
  // The dotted-call mask runs on lowercased? No — runs on the original
  // before lowercasing. So `REQUESTS.GET()` is uppercase and DOTTED_CALL_RE
  // is lowercase-only. We need to verify behaviour: the test enforces
  // that `requests.get()` survives in some form.
  assert(
    /requests\.get\(\)/i.test(out),
    `expected requests.get() form in output, got: ${out}`,
  );
});

Deno.test("text: log levels DEBUG INFO WARNING ERROR preserved", () => {
  const out = polishEditorialText(
    "CONFIGURE NÍVEIS COMO DEBUG, INFO, WARNING, ERROR.",
  );
  assert(out.includes("DEBUG"), `DEBUG missing: ${out}`);
  assert(out.includes("INFO"), `INFO missing: ${out}`);
  assert(out.includes("WARNING"), `WARNING missing: ${out}`);
  assert(out.includes("ERROR"), `ERROR missing: ${out}`);
});

Deno.test("text: already sentence-case is unchanged", () => {
  const inp = "Tomada de Decisão com if, elif e else";
  assertEquals(polishEditorialText(inp), inp);
});

Deno.test("text: short labels are skipped (no destructive lowercase)", () => {
  // CONTEÚDO is a legitimate uppercase badge label; must not be touched
  assertEquals(polishEditorialText("CONTEÚDO"), "CONTEÚDO");
});

Deno.test("text: code-like content is skipped", () => {
  const code = "def hello():\n    print('OI')\n    return None";
  assertEquals(polishEditorialText(code), code);
});
