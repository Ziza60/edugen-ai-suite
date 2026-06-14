// Tests for the v7 robustness fixes (run offline):
//   #1/#2 salvage of truncated planner JSON
//   #3 condenseForPlanning shrinks verbose code input
//   #4 fallback quality: markdown tables → slides, emoji headings stripped,
//      no mid-sentence / dangling truncation, code preserved
// Run:  bun run __tests__/robustness.smoke.ts

import {
  condenseForPlanning,
  fallbackModuleSlides,
  salvageSlidesFromTruncatedJson,
} from "../deck-plan.ts";
import { normalizeDeck } from "../validate.ts";
import type { PlannedDeck } from "../deck-plan.ts";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗ FAIL"}  ${name}`);
  if (!cond) failures++;
}

// ── #2 salvage truncated JSON (2 complete slides + 1 cut off) ──
const truncated = `{"slides":[
  {"kind":"bullets","title":"Slide um","bullets":["a","b"]},
  {"kind":"cards","title":"Slide dois","cards":[{"heading":"x","body":"y"}]},
  {"kind":"code","title":"Slide tr`; // <-- cut mid-object
const salvaged = salvageSlidesFromTruncatedJson(truncated);
check("salvage recovers the 2 complete slides", salvaged.length === 2);
check("salvage keeps order/fields", salvaged[0].title === "Slide um" && salvaged[1].kind === "cards");

// ── #3 condense collapses long fenced code ──
const longCode = "Intro\n```sql\n" + Array.from({ length: 40 }, (_, i) => `linha ${i};`).join("\n") + "\n```\nFim";
const condensed = condenseForPlanning(longCode, 6000);
check("condense shortens long code block", condensed.length < longCode.length);
check("condense keeps surrounding prose", condensed.includes("Intro") && condensed.includes("Fim"));

// ── #4 fallback quality on a DML-like module (the one that looked bad) ──
const dml = `## Manipulação de Dados (DML)

### 🎯 Objetivo do Módulo
- Adicionar novos registros a tabelas utilizando a instrução INSERT.
- Modificar dados existentes em tabelas com a instrução UPDATE.

### 🧠 Fundamentos
A Linguagem de Manipulação de Dados (DML) é um subconjunto do SQL que gerencia os dados dentro das tabelas. A integridade dos dados é crucial nas operações DML. Os SGBDs garantem que estas operações sigam regras de consistência definidas no esquema.

### 🧩 Modelos / Tipos
| Característica | DELETE FROM | TRUNCATE TABLE |
| :------------ | :---------- | :------------- |
| Tipo de Linguagem | DML | DDL |
| Transacionável | Sim (ROLLBACK) | Não |
| Velocidade | Mais lenta | Muito mais rápida |

### 💡 Exemplo prático
\`\`\`sql
CREATE TABLE Produtos (
  ID INT PRIMARY KEY,
  Nome VARCHAR(100)
);
\`\`\`

### 📌 Key Takeaways
- Inserir novos registros em tabelas usando a instrução INSERT INTO.
- Distinguir entre DELETE FROM e TRUNCATE TABLE.`;

const slides = fallbackModuleSlides("Manipulação de Dados (DML)", dml);
const allText = slides.flatMap((s) => [
  s.title ?? "",
  ...(s.bullets ?? []),
  ...(s.cards?.map((c) => `${c.heading} ${c.body}`) ?? []),
  ...(s.left?.items ?? []),
  ...(s.right?.items ?? []),
]).join("  ||  ");

check("no raw markdown table residue", !/\|\s*:?-{2,}/.test(allText) && !allText.includes("| :--"));
check("table became a compare slide", slides.some((s) => s.kind === "compare" && (s.left?.items?.length ?? 0) > 0));
check("emoji stripped from titles", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(slides.map((s) => s.title).join(" ")));
check("code slide preserved", slides.some((s) => s.kind === "code" && !!s.code?.text));
check("ends with closing", slides[slides.length - 1].kind === "closing");

// no bullet ends on a dangling connector / mid-thought (check the last WORD)
const CONNECTORS = new Set(["que","e","ou","a","o","de","da","do","com","para","em","no","na","os","as"]);
const lastWord = (s: string) =>
  (s.trim().replace(/[.…,;:]+$/, "").trim().split(/\s+/).pop() ?? "").toLowerCase();
const danglers = slides
  .flatMap((s) => [...(s.bullets ?? []), ...(s.left?.items ?? []), ...(s.right?.items ?? [])])
  .filter((b) => CONNECTORS.has(lastWord(b)));
check("no bullets ending on a dangling word", danglers.length === 0);
if (danglers.length) console.log("   danglers:", danglers);

// full pipeline still renders & normalizes
const deck: PlannedDeck = { courseTitle: "SQL", modules: [{ title: "Manipulação de Dados (DML)", slides }] };
const { deck: norm } = normalizeDeck(deck);
check("normalized deck keeps the module non-empty", norm.modules[0].slides.length > 0);

console.log(failures === 0 ? "\nALL PASS ✓" : `\n${failures} CHECK(S) FAILED ✗`);
if (failures > 0) process.exit(1);
