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

  console.log(
    failures === 0
      ? "\nALL PASS ✓"
      : `\n${failures} CHECK(S) FAILED ✗`,
  );
  if (failures > 0) process.exit(1);
}

run();
