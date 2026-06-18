// Smoke test for the v7 adaptive engine — runs OFFLINE (no LLM, no network).
// Verifies: deterministic fallback planning, universal normalization, and that
// the renderer produces a valid PPTX (zip) for DIFFERENT topics with no
// topic-specific code. Run with:  bun run __tests__/render.smoke.ts
//
// pptxgenjs is injected, so this file works under Node/Bun without Deno.

import PptxGenJS from "pptxgenjs";
import {
  buildDeck,
  fallbackModuleSlides,
  type ModuleInput,
} from "../deck-plan.ts";
import { normalizeDeck, LIMITS } from "../validate.ts";
import { renderDeck } from "../render.ts";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗ FAIL"}  ${name}`);
  if (!cond) failures++;
}

// ── Two completely different domains — prove topic-agnosticism ──
const pythonCourse: { title: string; modules: ModuleInput[] } = {
  title: "Introdução à Programação em Python",
  modules: [
    {
      title: "Estruturas de Dados",
      content: `## Estruturas de Dados

### 🎯 Objetivo do Módulo
- Compreender listas, tuplas, dicionários e conjuntos em Python.
- Saber quando usar cada estrutura.

### 🧠 Fundamentos
- Listas são mutáveis e ordenadas, ideais para coleções dinâmicas.
- Tuplas são imutáveis e protegem dados que não devem mudar.
- Dicionários mapeiam chaves a valores para acesso rápido.
- Conjuntos eliminam duplicatas e suportam operações de conjunto.

### 💡 Exemplo prático
\`\`\`python
notas = [8.5, 9.0, 7.0]
media = sum(notas) / len(notas)
print(media)
\`\`\`

### 📌 Key Takeaways
- Use listas para sequências que mudam ao longo do tempo.
- Escolha dicionários quando precisar de busca por chave.
- Prefira conjuntos para garantir unicidade de elementos.`,
    },
  ],
};

const historyCourse: { title: string; modules: ModuleInput[] } = {
  title: "História do Brasil Colonial",
  modules: [
    {
      title: "O Ciclo da Cana-de-Açúcar",
      content: `## O Ciclo da Cana-de-Açúcar

### Contexto Econômico
- A cana tornou-se o principal produto de exportação no século XVI.
- Os engenhos concentravam a produção no litoral nordestino.
- A mão de obra escravizada sustentava todo o sistema produtivo.

### Sociedade Açucareira
- A sociedade era patriarcal e centrada na figura do senhor de engenho.
- Havia rígida hierarquia entre senhores, trabalhadores livres e escravizados.

### Resumo
- O açúcar estruturou a economia colonial por mais de um século.
- A dependência do trabalho escravizado marcou profundamente a sociedade.`,
    },
  ],
};

// ── 1. Deterministic fallback works for ANY topic ──
const pSlides = fallbackModuleSlides(
  pythonCourse.modules[0].title,
  pythonCourse.modules[0].content,
);
const hSlides = fallbackModuleSlides(
  historyCourse.modules[0].title,
  historyCourse.modules[0].content,
);
check("python module yields slides", pSlides.length >= 2);
check("history module yields slides", hSlides.length >= 2);
check("python keeps a code slide", pSlides.some((s) => s.kind === "code"));
check(
  "both end with a closing slide",
  pSlides[pSlides.length - 1].kind === "closing" &&
    hSlides[hSlides.length - 1].kind === "closing",
);

// ── 2. Normalization caps & never empties ──
async function run() {
  for (const course of [pythonCourse, historyCourse]) {
    const { deck: raw, fallbackCount } = await buildDeck(
      course.title,
      "Curso de teste",
      course.modules,
      "Português (Brasil)",
      null, // no LLM → exercises deterministic path
    );
    check(`${course.title}: used fallback (no LLM)`, fallbackCount === course.modules.length);

    const { deck, stats } = normalizeDeck(raw);
    check(`${course.title}: every module has ≥1 slide`, deck.modules.every((m) => m.slides.length > 0));

    // universal limits respected
    let bulletsOK = true;
    let cardsOK = true;
    for (const m of deck.modules) {
      for (const s of m.slides) {
        if (s.bullets && s.bullets.length > LIMITS.MAX_BULLETS) bulletsOK = false;
        if (s.cards && s.cards.length > LIMITS.MAX_CARDS) cardsOK = false;
        if (s.bullets) {
          for (const b of s.bullets) {
            if (/(\.{2,}|…)\s*$/.test(b)) bulletsOK = false; // no trailing ellipsis
          }
        }
      }
    }
    check(`${course.title}: bullets within limits & no ellipsis`, bulletsOK);
    check(`${course.title}: cards within limits`, cardsOK);

    // ── 3. Renders a real PPTX (valid zip with slide parts) ──
    const { pptx, slideCount } = renderDeck(PptxGenJS, deck, {
      palette: "default",
    });
    check(`${course.title}: slideCount > modules`, slideCount > deck.modules.length);

    const buf: Uint8Array = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
    // PK zip magic
    check(`${course.title}: output is a zip (PK header)`, buf[0] === 0x50 && buf[1] === 0x4b);
    check(`${course.title}: non-trivial size`, buf.byteLength > 5000);
  }

  // ── 4. Empty/garbage module degrades gracefully (never throws) ──
  const { deck: junkRaw } = await buildDeck(
    "Curso Vazio",
    "",
    [{ title: "Módulo Fantasma", content: "" }],
    "Português (Brasil)",
    null,
  );
  const { deck: junk } = normalizeDeck(junkRaw);
  check("empty module still yields a slide", junk.modules[0].slides.length >= 1);
  const { pptx: jp, slideCount: jc } = renderDeck(PptxGenJS, junk, {});
  const jbuf: Uint8Array = (await jp.write({ outputType: "uint8array" })) as Uint8Array;
  check("empty course still renders a valid pptx", jc >= 1 && jbuf[0] === 0x50);

  // ── 5. A comparison table renders without throwing, light palette + dark template ──
  const tableDeck = normalizeDeck({
    courseTitle: "Tabela",
    modules: [{ title: "Coleções", slides: [{
      kind: "table", title: "Listas vs Tuplas vs Conjuntos vs Dicionários",
      columns: ["Listas", "Tuplas", "Conjuntos", "Dicionários"],
      rows: [
        { label: "Ordem", cells: ["Mantém", "Mantém", "Sem ordem", "Inserção (3.7+)"] },
        { label: "Mutabilidade", cells: ["Mutável", "Imutável", "Mutável", "Mutável"] },
        { label: "Sintaxe", cells: ["[]", "()", "{} / set()", "{k: v}"] },
      ],
    } as any] }],
  }).deck;
  check("table survives normalization", tableDeck.modules[0].slides[0].kind === "table");
  for (const opts of [{ palette: "default" }, { template: "dark_elegance_xl" }]) {
    const { pptx: tp, slideCount: tc } = renderDeck(PptxGenJS, tableDeck, opts as any);
    const tbuf: Uint8Array = (await tp.write({ outputType: "uint8array" })) as Uint8Array;
    check(`table deck renders a valid pptx (${JSON.stringify(opts)})`, tc >= 1 && tbuf[0] === 0x50 && tbuf.byteLength > 5000);
  }

  // ── 6. Two short compares exercise BOTH dark-split variants (vertical + horizontal) ──
  const mkCompare = (h: string) => ({
    kind: "compare", title: h,
    left: { heading: "Antes", items: ["Processo manual e lento"] },
    right: { heading: "Depois", items: ["Fluxo automatizado"] },
  });
  const cmpDeck = normalizeDeck({
    courseTitle: "Contrastes",
    modules: [{ title: "M", slides: [mkCompare("A"), mkCompare("B"), mkCompare("C")] as any }],
  }).deck;
  const { pptx: cp, slideCount: cc } = renderDeck(PptxGenJS, cmpDeck, { template: "dark_elegance_xl" } as any);
  const cbuf: Uint8Array = (await cp.write({ outputType: "uint8array" })) as Uint8Array;
  check("compare round-robin renders a valid pptx (both variants)", cc >= 3 && cbuf[0] === 0x50 && cbuf.byteLength > 5000);

  // ── 7. v7.18 render-side guards: sidebar anti-repeat, single-item highlight,
  //        question→provocation — exercised together; must render valid pptx ──
  const v718 = normalizeDeck({
    courseTitle: "v718",
    modules: [{ title: "Mx", slides: [
      { kind: "cards", title: "Grid 1", cards: [{ heading: "A", body: "x" }, { heading: "B", body: "y" }, { heading: "C", body: "z" }] },
      { kind: "cards", title: "Grid 2", cards: [{ heading: "U", body: "1" }, { heading: "D", body: "2" }, { heading: "T", body: "3" }, { heading: "Q", body: "4" }] },
      { kind: "bullets", title: "Único", bullets: ["Um só ponto que ficaria vazio num grid"] },
      { kind: "quote", title: "R", quote: "Isto é uma pergunta retórica?" },
    ] as any }],
  }).deck;
  const { pptx: vp, slideCount: vc } = renderDeck(PptxGenJS, v718, { template: "dark_elegance_xl" } as any);
  const vbuf: Uint8Array = (await vp.write({ outputType: "uint8array" })) as Uint8Array;
  check("v7.18 guards (sidebar/highlight/provocation) render a valid pptx", vc >= 4 && vbuf[0] === 0x50 && vbuf.byteLength > 5000);

  // ── 8. v7.19 charts: donut + horizontal bar render; degenerate chart salvages ──
  const chartNorm = normalizeDeck({
    courseTitle: "charts",
    modules: [{ title: "Mc", slides: [
      { kind: "chart", title: "Proporção", chart: { type: "donut", unit: "%", points: [{ label: "A", value: 50 }, { label: "B", value: 30 }, { label: "C", value: 20 }] } },
      { kind: "chart", title: "Ranking", chart: { type: "bar", points: [{ label: "X", value: 9 }, { label: "Y", value: 5 }, { label: "Z", value: 3 }] } },
      { kind: "chart", title: "Degenerado", chart: { type: "donut", points: [{ label: "só", value: 1 }] } },
    ] as any }],
  }).deck;
  const chartKinds = chartNorm.modules[0].slides.map((s) => s.kind);
  check("chart: donut & bar kept, degenerate salvaged to bullets", chartKinds.filter((k) => k === "chart").length === 2 && chartKinds.includes("bullets"));
  const { pptx: chp, slideCount: chc } = renderDeck(PptxGenJS, chartNorm, { template: "dark_theme" } as any);
  const chbuf: Uint8Array = (await chp.write({ outputType: "uint8array" })) as Uint8Array;
  check("v7.19 charts render a valid pptx", chc >= 3 && chbuf[0] === 0x50 && chbuf.byteLength > 5000);

  console.log(
    failures === 0
      ? "\nALL PASS ✓"
      : `\n${failures} CHECK(S) FAILED ✗`,
  );
  if (failures > 0) process.exit(1);
}

run();
