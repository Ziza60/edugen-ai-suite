// Tests for the v7 robustness fixes (run offline):
//   #1/#2 salvage of truncated planner JSON
//   #3 condenseForPlanning shrinks verbose code input
//   #4 fallback quality: markdown tables → slides, emoji headings stripped,
//      no mid-sentence / dangling truncation, code preserved
// Run:  bun run __tests__/robustness.smoke.ts

import {
  condenseForPlanning,
  echoesTitle,
  enforceModuleFloors,
  fallbackModuleSlides,
  salvageSlidesFromTruncatedJson,
} from "../deck-plan.ts";
import { normalizeDeck } from "../validate.ts";
import type { DeckModule, ModuleInput, PlannedDeck, SlideSpec } from "../deck-plan.ts";

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

// ── #2b partial-array recovery: a single giant object cut mid-"bullets" ──
// Previously this yielded 0 slides (whole module → fallback). Now the complete
// bullets that landed before the cut are recovered into one usable slide.
const giant = `{"slides":[{"kind":"bullets","title":"Conceitos","bullets":[` +
  `"primeiro ponto","segundo ponto","terceiro ponto","quarto pont`; // cut mid-string
const rec = salvageSlidesFromTruncatedJson(giant);
check("partial-array salvage yields a slide", rec.length === 1);
check("partial-array salvage keeps complete bullets",
  rec.length === 1 && Array.isArray(rec[0].bullets) && rec[0].bullets!.length === 3);
check("partial-array salvage keeps title/kind",
  rec.length === 1 && rec[0].title === "Conceitos" && rec[0].kind === "bullets");

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

// v7.1.2 — code placeholder lines ("# ...", "-- ...", "...") are stripped
const codeDeck: PlannedDeck = {
  courseTitle: "X",
  modules: [{
    title: "M",
    slides: [{
      kind: "code",
      title: "Ex",
      code: { language: "sql", text: "CREATE TABLE t (\n  id INT\n);\n# ...\n-- ...\n..." },
    }],
  }],
};
const { deck: cd } = normalizeDeck(codeDeck);
const codeText = cd.modules[0].slides.find((s) => s.kind === "code")?.code?.text ?? "";
check("code placeholder lines stripped", !/\.{2,}|…/.test(codeText) && codeText.includes("CREATE TABLE"));

// v7.1.10 — code returned as a BARE STRING (not {text}) is coerced, not dropped
const strCode = {
  courseTitle: "X",
  modules: [{ title: "M", slides: [
    { kind: "code", title: "Ex SQL", code: "SELECT id FROM users;\nSELECT 1;" },
  ] }],
} as unknown as PlannedDeck;
const { deck: sc, stats: scStats } = normalizeDeck(strCode);
check("string-form code slide is kept (not dropped)",
  scStats.slidesDropped === 0 &&
  sc.modules[0].slides.some((s) => s.kind === "code" && !!s.code?.text));

// v7.1.4 — single-line multi-statement code gets line breaks back
const oneLine: PlannedDeck = {
  courseTitle: "X",
  modules: [{ title: "M", slides: [{ kind: "code", title: "E",
    code: { language: "sql", text: "CREATE DATABASE d; INSERT INTO t VALUES (1); SELECT * FROM t;" } }] }],
};
const { deck: ol } = normalizeDeck(oneLine);
const olText = ol.modules[0].slides[0].code?.text ?? "";
check("single-line code split into multiple lines", olText.split("\n").length >= 3);

// v7.1.4 — a takeaway-like section ("Principais Aprendizados") is the closing,
// not duplicated as bullet slides; and no orphan "(cont.)" with one item
const dedupMd = `## M
### Conteúdo
- Ponto A.
- Ponto B.
### Principais Aprendizados
- Aprendeu X.
- Aprendeu Y.
- Aprendeu Z.`;
const ds = fallbackModuleSlides("M", dedupMd);
const closings = ds.filter((s) => s.kind === "closing");
check("exactly one closing slide", closings.length === 1);
const conts = ds.filter((s) => /\(cont\.\)/.test(s.title));
const orphanCont = conts.some((s) => (s.bullets?.length ?? 0) <= 1);
check("no orphan (cont.) slide with a single bullet", !orphanCont);

// ── v7.8.0 — per-module floor invariant: a starved module never ships hollow ──
// Reproduces the real M4 regression: the planner returned a single objectives
// slide and NO closing because the ledger told it everything was "covered".
const richSource = `## Comunicação e Colaboração da Equipe
### Conteúdo
- A comunicação contínua é essencial para o sucesso da auditoria operacional.
- Estratégias de compartilhamento de informações mantêm a equipe alinhada.
- O pensamento visual ajuda a criar um retrato compartilhado do trabalho.
- Espaços de trabalho colaborativos potencializam a produtividade da equipe.
- A gestão de conflitos preserva o foco nos objetivos da auditoria.`;
const hollow: DeckModule[] = [
  {
    title: "Comunicação e Colaboração da Equipe",
    slides: [{ kind: "bullets", title: "Objetivos do Módulo", eyebrow: "x", bullets: ["um", "dois"] }],
  },
  {
    title: "Módulo Saudável",
    slides: [
      { kind: "bullets", title: "A", bullets: ["1", "2"] },
      { kind: "cards", title: "B", cards: [{ heading: "h", body: "b" }] },
      { kind: "bullets", title: "C", bullets: ["3", "4"] },
      { kind: "closing", title: "Principais aprendizados", bullets: ["z"] },
    ],
  },
];
const inputs: ModuleInput[] = [
  { title: "Comunicação e Colaboração da Equipe", content: richSource },
  { title: "Módulo Saudável", content: "irrelevante" },
];
const before = hollow[1].slides.length;
const res = enforceModuleFloors(hollow, inputs);
const m4 = hollow[0];
const m4content = m4.slides.filter((s) => s.kind !== "closing");
const m4closings = m4.slides.filter((s) => s.kind === "closing");
check("floor: starved module backfilled to >=2 content slides", m4content.length >= 2);
check("floor: starved module ends with exactly one closing", m4closings.length === 1);
check("floor: closing is the last slide", m4.slides[m4.slides.length - 1].kind === "closing");
check("floor: reported it added a closing", res.closingsAdded >= 1 && res.backfilled >= 1);
check("floor: healthy module left intact", hollow[1].slides.length === before);
check("floor: every module has a closing", hollow.every((m) => m.slides.some((s) => s.kind === "closing")));

// ── anti-monotony: runs of bullet slides rotate across tiles/bento variants ──
const sb = (title: string, items: string[]): SlideSpec =>
  ({ kind: "bullets", title, bullets: items } as SlideSpec);
const shortList = ["Cruciais para o sucesso", "Otimizam a interação", "Garantem entendimento", "Agilizam a resolução"];
const runDeck: PlannedDeck = {
  courseTitle: "X",
  modules: [{
    title: "Comunicação",
    slides: [
      sb("Lista 1", shortList),
      sb("Lista 2", shortList),
      sb("Lista 3", shortList),
      sb("Lista 4", shortList),
    ],
  }],
};
const rk = normalizeDeck(runDeck).deck.modules[0].slides.map((s) => s.kind);
check("run of bullets rotates bullets/tiles/bento/tiles", rk.join(",") === "bullets,tiles,bento,tiles");
let noPair = true;
for (let k = 1; k < rk.length; k++) if (rk[k] === "bullets" && rk[k - 1] === "bullets") noPair = false;
check("no two bullet slides remain back-to-back", noPair);

// a 5-item short list is still tile-eligible (badge grid supports up to 6)
const five = ["um curto", "dois curto", "três curto", "quatro curto", "cinco curto"];
const fiveDeck: PlannedDeck = {
  courseTitle: "X",
  modules: [{ title: "M", slides: [sb("A", five), sb("B", five)] }],
};
const fk = normalizeDeck(fiveDeck).deck.modules[0].slides.map((s) => s.kind);
check("second of two 5-item lists becomes tiles", fk[1] === "tiles");

// a long-phrase list is NOT promoted (tiles are for scannable short points)
const longItems = [
  "Esta é uma frase bastante longa que claramente não cabe bem em um tile compacto de grade",
  "Outra explicação extensa com muitas palavras que deve permanecer como item de lista vertical",
  "Mais um ponto longo o suficiente para reprovar a elegibilidade de tiles neste slide",
];
const longDeck: PlannedDeck = {
  courseTitle: "X",
  modules: [{ title: "M", slides: [sb("A", longItems), sb("B", longItems)] }],
};
const lk = normalizeDeck(longDeck).deck.modules[0].slides.map((s) => s.kind);
check("long-phrase lists stay bullets (not promoted to tiles)", lk.every((k) => k === "bullets"));

// ── matrix (2×2 quadrant) kind: kept with cards, salvaged to bullets when empty ──
const matrixDeck: PlannedDeck = {
  courseTitle: "X",
  modules: [{ title: "M", slides: [
    { kind: "matrix", title: "SWOT", cards: [
      { heading: "Forças", body: "a" }, { heading: "Fraquezas", body: "b" },
      { heading: "Oportunidades", body: "c" }, { heading: "Ameaças", body: "d" },
    ] } as SlideSpec,
  ] }],
};
check("matrix with 4 cards is kept as matrix", normalizeDeck(matrixDeck).deck.modules[0].slides[0].kind === "matrix");
const matrixEmpty: PlannedDeck = {
  courseTitle: "X",
  modules: [{ title: "M", slides: [
    { kind: "matrix", title: "SWOT", bullets: ["ponto a", "ponto b"] } as SlideSpec,
  ] }],
};
const mek = normalizeDeck(matrixEmpty).deck.modules[0].slides.map((s) => s.kind);
check("matrix without cards is salvaged to bullets (graceful)", mek.length === 1 && mek[0] === "bullets");

// ── Markdown emphasis must never reach the slide as literal characters ──
const mdDeck: PlannedDeck = {
  courseTitle: "X",
  modules: [{ title: "M", slides: [
    { kind: "bullets", title: "T", bullets: ["**Desafio:** gerar docs", "Usar `prompt` few-shot", "__Viés__ nos dados"] } as SlideSpec,
  ] }],
};
const mdOut = (normalizeDeck(mdDeck).deck.modules[0].slides[0].bullets ?? []).join(" ");
check("markdown ** __ ` stripped from bullets", !/[*_`]/.test(mdOut) && mdOut.includes("Desafio:") && mdOut.includes("prompt"));

// ── Steps must not double-number ("1. 1.") — leading ordinal stripped ──
const stepDeck: PlannedDeck = {
  courseTitle: "X",
  modules: [{ title: "M", slides: [
    { kind: "steps", title: "T", steps: [
      { heading: "1. Recuperação", body: "a" },
      { heading: "2) Geração", body: "b" },
      { heading: "Resposta Aprimorada", body: "c" },
    ] } as SlideSpec,
  ] }],
};
const stHeads = (normalizeDeck(stepDeck).deck.modules[0].slides[0].steps ?? []).map((s) => s.heading);
check("steps headings have no leading ordinal", stHeads[0] === "Recuperação" && stHeads[1] === "Geração" && stHeads[2] === "Resposta Aprimorada");

// ── table: ragged rows are squared to the column count ──
const tblDeck: PlannedDeck = {
  courseTitle: "X",
  modules: [{ title: "M", slides: [
    { kind: "table", title: "Coleções", columns: ["Listas", "Tuplas", "Conjuntos"], rows: [
      { label: "Mutabilidade", cells: ["Mutável", "Imutável", "Mutável"] },
      { label: "Sintaxe", cells: ["[]", "()"] },                 // short → padded
      { label: "Duplicatas", cells: ["Sim", "Sim", "Não", "X"] }, // long → trimmed
    ] } as SlideSpec,
  ] }],
};
const tbl = normalizeDeck(tblDeck).deck.modules[0].slides[0];
const rect = (tbl.rows ?? []).every((r) => r.cells.length === (tbl.columns?.length ?? 0));
check("table kept as table with rectangular rows", tbl.kind === "table" && (tbl.columns?.length ?? 0) === 3 && rect);

// ── table with <2 columns is salvaged to bullets (graceful) ──
const tblBad: PlannedDeck = {
  courseTitle: "X",
  modules: [{ title: "M", slides: [
    { kind: "table", title: "T", columns: ["Só uma"], rows: [{ label: "a", cells: ["b"] }], bullets: ["fallback ponto"] } as SlideSpec,
  ] }],
};
const tb = normalizeDeck(tblBad).deck.modules[0].slides[0];
check("degenerate table salvaged to bullets", tb.kind === "bullets" && (tb.bullets?.length ?? 0) === 1);

// ── v7.12.2 — title-echo detection (course title minus subtitle, etc.) ──
const COURSE = "Dominando o Planejamento de Auditorias Operacionais: Fundamentos e Boas Práticas";
check("echo: exact course title", echoesTitle(COURSE, COURSE));
check("echo: course title minus its subtitle (the S19/S34 case)",
  echoesTitle("Dominando o Planejamento de Auditorias Operacionais", COURSE));
check("echo: accent/case-insensitive module name",
  echoesTitle("comunicacao e colaboracao da equipe", "Comunicação e Colaboração da Equipe"));
check("echo: distinct short title is NOT an echo",
  !echoesTitle("Documentos Essenciais", COURSE));
check("echo: module name is not falsely matched by a longer specific title",
  !echoesTitle("Documentos Essenciais Pós-Planejamento da Auditoria", "Documentos"));

console.log(failures === 0 ? "\nALL PASS ✓" : `\n${failures} CHECK(S) FAILED ✗`);
if (failures > 0) process.exit(1);
