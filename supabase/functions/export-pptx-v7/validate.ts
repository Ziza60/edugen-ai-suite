// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — PPTX v7 "Adaptive Engine"  ·  validate.ts
//
// UNIVERSAL structural normalization only. There is intentionally NO topic
// knowledge here (no "SQL in Python", no per-language rules). Every check
// applies equally to any subject. The contract: this module NEVER throws and
// NEVER vetoes — it always returns a renderable deck by degrading gracefully
// (shrink, split, trim, or drop the offending element, not the whole export).
// ═══════════════════════════════════════════════════════════════════════════

import type {
  DeckCard,
  DeckModule,
  DeckStep,
  DeckTableRow,
  PlannedDeck,
  SlideSpec,
} from "./deck-plan.ts";
import { proporcaoInformativa } from "./layout-fit.ts";

export const LIMITS = {
  MAX_BULLETS: 5,
  MAX_CARDS: 4,
  MAX_STEPS: 5,
  MAX_COLUMN_ITEMS: 4,
  MAX_ITEM_WORDS: 22,
  MAX_ITEM_CHARS: 160,
  MAX_TITLE_CHARS: 90,
  MAX_CODE_LINES: 16,
  MAX_CARD_BODY_CHARS: 90,
  MAX_TABLE_COLS: 5,
  MAX_TABLE_ROWS: 6,
  MAX_TABLE_CELL_CHARS: 80,
  MAX_CHART_POINTS: 6,
  // The kicker is a LABEL (usually the module title), not prose. Cutting it
  // produces a broken phrase — "…EM SITUAÇÕES DE ALTA" instead of "…DE ALTA
  // TENSÃO" — which reads as a bug, not as an abbreviation. The old 60-char cap
  // silently amputated any module title longer than that (2 of 5 modules in a
  // real course, on 17 of its 44 slides). The header band is ~11.5in wide and
  // fits ~100 uppercase chars at 10pt, so 90 is safe here; the renderer shrinks
  // the type for the narrower kicker boxes instead of truncating.
  MAX_EYEBROW_CHARS: 90,
} as const;

const TRAILING_JUNK_RE = /[\s,;:\-–—]+$/;
const ELLIPSIS_RE = /(\.{2,}|…)+\s*$/;
// O artigo "o" faltava. A lista trazia "a", "as" e "os", e só o masculino
// singular ficou de fora — uma omissão de um caractere com efeito visível:
// "…e a" era aparado, "…e os" era aparado, e "Conclua com a fase de pagamento
// e o" foi entregue assim mesmo, num slide de atividade.
const DANGLING_PREP_RE =
  /\s+(para|de|da|do|das|dos|com|e|ou|que|em|no|na|nos|nas|ao|à|aos|às|por|sobre|entre|sem|sob|a|o|as|os|um|uma|uns|umas)\s*$/i;

// Words that CAN legitimately end an intact sentence ("a decisão é sua", "isso
// depende de você") but never end an acceptable CUT one. They are stripped only
// from text we know was truncated — applying them to prose the planner wrote in
// full would mutilate it, which is why they are not in DANGLING_PREP_RE.
const CUT_TAIL_RE =
  /\s+(voc[êe]s?|ele|ela|eles|elas|n[óo]s|quem|qual|quais|onde|quando|cujos?|cujas?|algum|alguma|alguns|algumas|qualquer|quaisquer|seu|sua|seus|suas|este|esta|estes|estas|esse|essa|esses|essas|aquele|aquela|isso|isto|mesmo|mesma)\s*$/i;

// An orphan subordinate clause: a connector followed by 1–2 words and nothing
// else. "Revise sua proposta, garantindo que o controle" is not a short
// sentence, it is a sentence cut in half — the clause promises a completion the
// slide never delivers. Cutting at the connector restores a whole statement.
const ORPHAN_CLAUSE_RE =
  /[,;]?\s+\b(que|para|porque|quando|onde|se|caso|conforme|enquanto|embora|garantindo|assegurando|considerando|visando|buscando|permitindo)\b(\s+\S+){0,2}\s*$/i;

/**
 * Make a truncated fragment end on a whole thought.
 *
 * Runs only on text capText actually had to cut. Two shapes of debris:
 * a trailing function word ("…problemas que você") and an orphan subordinate
 * clause ("…garantindo que o controle"). Removing one often exposes the other,
 * so it iterates; it stops before dissolving the fragment, since three words
 * that end badly still beat one word that ends nowhere.
 */
function trimToWholeThought(raw: string): string {
  let s = raw;
  // Bounded loop rather than recursion: each rule can expose work for the
  // others ("…garantindo que o controle" → "…proposta," → "…proposta"), and the
  // string strictly shrinks, so a handful of passes always settles.
  for (let i = 0; i < 6; i++) {
    let next = s
      .replace(CUT_TAIL_RE, "")
      .replace(DANGLING_PREP_RE, "")
      .replace(TRAILING_JUNK_RE, "")
      .trim();
    if (next === s) {
      next = s.replace(ORPHAN_CLAUSE_RE, "").replace(TRAILING_JUNK_RE, "").trim();
      if (next === s) break;
    }
    // Never strip past three words — below that we are deleting the point, not
    // the debris, and the caller is better served by the longer ragged version.
    if (next.split(/\s+/).filter(Boolean).length < 3) break;
    s = next;
  }
  return s;
}

/** Clean a short text fragment: strip ellipsis, dangling words, trailing junk. */
function cleanFragment(raw: string): string {
  let t = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // Strip Markdown emphasis the planner sometimes leaks into prose (it would
  // otherwise render as literal **asterisks**/`backticks` on the slide).
  t = t
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*/g, "")
    .trim();
  t = t.replace(ELLIPSIS_RE, "");
  // Drop up to two dangling connector words left by truncation.
  for (let i = 0; i < 2; i++) {
    const next = t.replace(DANGLING_PREP_RE, "");
    if (next === t) break;
    t = next.trim();
  }
  t = t.replace(TRAILING_JUNK_RE, "").trim();
  return t;
}

/** Count occurrences of a literal character. */
function countChar(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
  return n;
}

/**
 * Is the quote character at `i` an OPENING quote? True at the start of the
 * string or after whitespace / an opening bracket. This is what lets us treat
 * `'` as a quote in «usou: 'Marta» while leaving the apostrophe in «don't» and
 * «l'entreprise» alone — an unconditional odd/even count would eat those.
 */
function isOpeningQuote(s: string, i: number): boolean {
  if (i === 0) return true;
  return /[\s([{–—-]/.test(s[i - 1]);
}

/** Drop a dangling, unclosed parenthetical / quote left by truncation, so a
 *  capped fragment never ends with "(ex: a, b" or an open quote. */
function balanceDelimiters(t: string): string {
  let s = t;
  let guard = 0;
  while (countChar(s, "(") > countChar(s, ")") && guard++ < 3) {
    const i = s.lastIndexOf("(");
    if (i < 0) break;
    s = s.slice(0, i).trim();
  }
  // Double quotes come in pairs: “ closes with ”, and " closes with itself. The
  // previous version tested “ and ” INDEPENDENTLY, so a perfectly balanced
  // “texto” counted as one “ (odd) plus one ” (odd) and got cut twice.
  for (const [open, close] of [['"', '"'], ["“", "”"], ["«", "»"]]) {
    const unclosed = open === close
      ? countChar(s, open) % 2 === 1
      : countChar(s, open) > countChar(s, close);
    if (!unclosed) continue;
    const i = s.lastIndexOf(open);
    if (i >= 0) s = s.slice(0, i).trim();
  }
  // Single quotes, position-aware (see isOpeningQuote). A truncated case study
  // shipped as «usa a comunicação assertiva: 'Marta» — the opening quote of a
  // line of dialogue that got cut before its closing partner.
  for (const [open, close] of [["'", "'"], ["‘", "’"]]) {
    let last = -1;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === open && isOpeningQuote(s, i)) last = i;
      else if (s[i] === close && last >= 0 && i > last) last = -1;
    }
    if (last >= 0) s = s.slice(0, last).trim();
  }
  return s;
}

/** Hard cap by words then chars, never cutting mid-word — and, when a cut was
 *  needed, ending on a clause/sentence boundary so the fragment never reads
 *  mid-thought ("...caindo para 6"). */
function capText(raw: string, maxWords: number, maxChars: number): string {
  let t = cleanFragment(raw);
  let truncated = false;
  const words = t.split(/\s+/);
  if (words.length > maxWords) { t = words.slice(0, maxWords).join(" "); truncated = true; }
  if (t.length > maxChars) {
    const sliced = t.slice(0, maxChars);
    const lastSpace = sliced.lastIndexOf(" ");
    // Cut at the word boundary unless that would leave almost nothing. The old
    // guard was a flat `lastSpace > 20`, which fails on SHORT caps: a 28-char
    // table header whose last space sits at index 20 missed the test by one and
    // fell through to the hard slice, shipping "Impacto Potencial na Resoluç".
    // Scale the floor to the cap so short fields keep their word boundary too.
    const floor = Math.min(20, Math.floor(maxChars * 0.5));
    t = (lastSpace >= floor ? sliced.slice(0, lastSpace) : sliced).trim();
    truncated = true;
  }
  // We had to cut, so the fragment probably ends mid-thought. Judge THAT
  // directly instead of guessing from a percentage.
  //
  // A percentage was the wrong instrument, and both settings proved it: at ≥50%
  // the clause trim was licensed to throw away half a whole fragment, and did
  // ("…usa a comunicação assertiva: 'Marta"); at ≥80% it stopped firing where it
  // was needed and shipped "…garantindo que o controle". How much text a cut
  // costs says nothing about whether what remains is a complete statement.
  //
  // trimToWholeThought asks the question that actually matters — does this end
  // on a whole thought? — and removes only the debris that says no.
  if (truncated) {
    t = trimToWholeThought(t);
  }
  // Always balance delimiters: a truncated "(ex: …" or an open quote can survive
  // the clause trim (the source sentence itself was cut by the planner).
  return cleanFragment(balanceDelimiters(cleanFragment(t)));
}

/** Sobrou só numeração, pontuação ou espaço? Então não há título nenhum. */
function isEmptyLabel(s: string): boolean {
  return !s || /^[\s\d.)\-–—:;,]*$/.test(s);
}

function normItems(items: string[] | undefined, max: number): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((s) => capText(String(s), LIMITS.MAX_ITEM_WORDS, LIMITS.MAX_ITEM_CHARS))
    // Mesmo motivo do normSteps: um marcador que sobrou como "1." ou "—"
    // ocupa uma linha do slide sem dizer nada.
    .filter((s) => !isEmptyLabel(s))
    .slice(0, max);
}

function normCards(cards: DeckCard[] | undefined): DeckCard[] {
  if (!Array.isArray(cards)) return [];
  return cards
    .map((c) => ({
      heading: capText(String(c?.heading ?? ""), 8, 48),
      body: capText(String(c?.body ?? ""), 12, LIMITS.MAX_CARD_BODY_CHARS),
    }))
    .filter((c) => c.heading.length > 0)
    .slice(0, LIMITS.MAX_CARDS);
}

/** The steps renderer prepends its own index, so drop any leading "1." / "2)" /
 *  "3 -" the planner already baked into the heading (avoids "1. 1. ...").
 *  O `\s+` final era obrigatório, então um ordinal SOZINHO ("1.", sem nada
 *  depois) não casava e sobrevivia como título do passo. */
function stripLeadingOrdinal(s: string): string {
  return s.replace(/^\s*\d{1,3}\s*[.)\-–]\s*/, "");
}

function normSteps(steps: DeckStep[] | undefined): DeckStep[] {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((s) => {
      // O TÍTULO DO PASSO TEM DOIS PAPÉIS, E SÓ UM ORÇAMENTO SERVIA PARA AMBOS
      //
      // Quando o passo tem corpo, o título é um RÓTULO ("Empenho", "Previsão") e
      // 8 palavras sobram. Quando não tem, o título É o conteúdo — e numa
      // atividade ele carrega a instrução inteira. Cortar em 8 palavras ali
      // entrega ordem pela metade: "Defina qual departamento necessita",
      // "Estime um valor e identifique qual dotação", "Detalhe as verificações".
      // O aluno lê e não sabe o que fazer.
      //
      // O corpo já tinha sido corrigido por este mesmo motivo — o comentário
      // abaixo é de então. O título ficou para trás.
      //
      // Espaço existe: sem corpo, renderStairs e renderSteps dão a linha inteira
      // ao título em vez de metade dela. E o rodízio se ajusta sozinho — a linha
      // do tempo e o chevron só entram com título curto, então uma instrução
      // longa cai na lista vertical, que é onde ela cabe.
      const temCorpo = !!String(s?.body ?? "").trim();
      let heading = capText(
        stripLeadingOrdinal(String(s?.heading ?? "")),
        temCorpo ? 8 : 20,
        temCorpo ? 48 : 120,
      );
      // Steps carry the worked-example / activity prose (Contexto/Desafio/…), so
      // a 12-word cap chopped real sentences mid-thought. Allow a full short
      // sentence; capText still ends it on a clean clause. The vertical step
      // layout has room for ~2 lines per step (3–5 steps).
      let body = s?.body ? capText(String(s.body), 24, 170) : undefined;
      // Rede de segurança: um passo cujo título é só o número não diz nada, e
      // o renderizador já desenha a numeração por conta própria. Foi assim que
      // um slide de atividade foi entregue com quatro barras contendo apenas
      // "1.", "2.", "3." e "4.". Quando isso acontece, o corpo vira o título —
      // e se não houver corpo, o passo não tem conteúdo para justificar a barra.
      if (isEmptyLabel(heading)) {
        if (body && !isEmptyLabel(body)) {
          heading = capText(body, 20, 120);
          body = undefined;
        } else {
          heading = "";
        }
      }
      return { heading, body };
    })
    .filter((s) => s.heading.length > 0)
    .slice(0, LIMITS.MAX_STEPS);
}

/**
 * Normalize a comparison table into a rectangular grid. Columns and per-row
 * cells are trimmed/padded to the same width so the renderer never sees a ragged
 * table. Returns null when there isn't enough to draw (so the slide falls back
 * to bullets, like matrix does) — never throws.
 */
function normTable(slide: SlideSpec):
  | { columns: string[]; rows: DeckTableRow[]; rowHeader: string }
  | null {
  let columns = (Array.isArray(slide.columns) ? slide.columns : [])
    .map((c) => capText(String(c ?? ""), 6, 28))
    .filter((c) => c.length > 0)
    .slice(0, LIMITS.MAX_TABLE_COLS);
  if (columns.length < 2) return null;
  const rawRows = (Array.isArray(slide.rows) ? slide.rows : [])
    .map((r) => ({
      label: capText(String(r?.label ?? ""), 8, 32),
      cells: (Array.isArray(r?.cells) ? r.cells : [])
        .map((c) => capText(String(c ?? ""), 12, LIMITS.MAX_TABLE_CELL_CHARS)),
    }))
    .filter((r) => r.label.length > 0 || r.cells.some((c) => c.length > 0));
  if (rawRows.length < 1) return null;

  // Off-by-one fix: the planner sometimes lists the FIRST data column as a header
  // (e.g. "Operador") but puts its value in `label` (==, !=), so each row carries
  // one fewer cell than there are columns. Padding to columns.length then shifts
  // every cell under the wrong header and leaves the last column empty. When the
  // data rows consistently have columns-1 cells, treat columns[0] as the header
  // of the row-label column instead, keeping all data aligned with its header.
  let rowHeader = "";
  const dataRows = rawRows.filter((r) => r.cells.length > 0);
  if (
    columns.length >= 3 &&
    dataRows.length > 0 &&
    dataRows.every((r) => r.cells.length === columns.length - 1)
  ) {
    rowHeader = columns[0];
    columns = columns.slice(1);
  }

  const n = columns.length;
  const rows = rawRows
    .map((r) => {
      const cells = r.cells.slice();
      // Force each row to exactly n cells (pad short, drop overflow).
      while (cells.length < n) cells.push("");
      return { label: r.label, cells: cells.slice(0, n) };
    })
    .slice(0, LIMITS.MAX_TABLE_ROWS);
  if (rows.length < 1) return null;
  return { columns, rows, rowHeader };
}

/**
 * Normalize a chart: coerce values to finite non-negative numbers, cap the
 * number of points, drop empty labels. Returns null when fewer than 2 valid
 * points remain (the slide then salvages to bullets — never throws).
 */
function normChart(slide: SlideSpec):
  | { type: "donut" | "bar"; points: { label: string; value: number }[]; unit?: string }
  | null {
  const c = slide.chart;
  if (!c) return null;
  const type = c.type === "bar" ? "bar" : "donut";
  const points = (Array.isArray(c.points) ? c.points : [])
    .map((p) => ({
      label: capText(String(p?.label ?? ""), 6, 26),
      value: Number(p?.value),
    }))
    .filter((p) => p.label.length > 0 && Number.isFinite(p.value) && p.value >= 0)
    .slice(0, LIMITS.MAX_CHART_POINTS);
  if (points.length < 2) return null;
  // Rosca com todas as fatias iguais não é dado: é um todo repartido em partes
  // idênticas, que não informa nada e ainda tem cara de medição. Devolvendo
  // null, o slide cai no resgate para tópicos logo abaixo — que preserva o
  // conteúdo e larga a falsa proporção. A barra escapa da regra porque ali o
  // comprimento É o dado, e barras iguais mostram empate, que é informação.
  if (type === "donut" && !proporcaoInformativa(points.map((p) => p.value))) {
    return null;
  }
  const unit = c.unit ? capText(String(c.unit), 2, 6) : undefined;
  return { type, points, unit };
}

const CODE_PLACEHOLDER_LINE_RE = /^\s*(?:#|--|\/\/)?\s*(?:\.{2,}|…)\s*$/;

function normCode(code: SlideSpec["code"]): SlideSpec["code"] | undefined {
  // Tolerate a bare string: some planner outputs return code as "..." instead
  // of { text, language }. Coerce so the slide isn't needlessly dropped.
  const c: { language?: string; text?: string } | undefined =
    typeof code === "string" ? { text: code } : code;
  if (!c || !c.text) return undefined;
  let lines = String(c.text).replace(/\r\n/g, "\n").split("\n");
  // Safety net: if the model returned multi-statement code on a single line,
  // restore a line break after each ";" so it doesn't render as a wall.
  if (lines.filter((l) => l.trim()).length <= 1 &&
      (c.text.match(/;/g)?.length ?? 0) >= 2) {
    lines = c.text.replace(/;\s*/g, ";\n").split("\n");
  }
  // Strip placeholder/ellipsis lines ("# ...", "-- ...", "...") left by input
  // condensation or the model — they make the example look unfinished.
  lines = lines.filter((l) => !CODE_PLACEHOLDER_LINE_RE.test(l));
  // Drop trailing blank lines, then hard-cap line count (no "..." injection).
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length > LIMITS.MAX_CODE_LINES) {
    lines = lines.slice(0, LIMITS.MAX_CODE_LINES);
  }
  const text = lines.join("\n");
  if (!text.trim()) return undefined;
  return { language: (c.language || "").toLowerCase(), text };
}

/** A slide is renderable if its kind has the minimum content it needs. */
function hasMinimumContent(s: SlideSpec): boolean {
  switch (s.kind) {
    case "bullets":
    case "tiles":
    case "closing":
      return (s.bullets?.length ?? 0) > 0;
    case "cards":
    case "matrix":
      return (s.cards?.length ?? 0) > 0;
    case "table":
      return (s.columns?.length ?? 0) >= 2 && (s.rows?.length ?? 0) > 0;
    case "steps":
      return (s.steps?.length ?? 0) > 0;
    case "compare":
      return (
        (s.left?.items?.length ?? 0) > 0 && (s.right?.items?.length ?? 0) > 0
      );
    case "quote":
      return !!s.quote && s.quote.length > 0;
    case "stat":
      return !!s.stat?.value;
    case "chart":
      return (s.chart?.points?.length ?? 0) >= 2;
    case "code":
      return !!s.code?.text;
    case "section":
    case "cover":
    case "toc":
      return !!s.title;
    default:
      return false;
  }
}

/**
 * Normalize one slide. Returns an array because overflow (too many bullets)
 * degrades into a continuation slide rather than truncating content.
 */
function normalizeSlide(slide: SlideSpec): SlideSpec[] {
  const eyebrow = slide.eyebrow
    ? capText(slide.eyebrow, 16, LIMITS.MAX_EYEBROW_CHARS)
    : undefined;
  let title = capText(slide.title ?? "", 14, LIMITS.MAX_TITLE_CHARS);

  const table = slide.kind === "table" ? normTable(slide) : null;
  const chart = slide.kind === "chart" ? normChart(slide) : null;

  const base: SlideSpec = {
    ...slide,
    title,
    eyebrow,
    columns: table?.columns,
    rows: table?.rows,
    rowHeader: table?.rowHeader,
    chart: chart ?? undefined,
    subtitle: slide.subtitle
      ? capText(slide.subtitle, 22, 160)
      : undefined,
    cards: normCards(slide.cards),
    steps: normSteps(slide.steps),
    code: normCode(slide.code),
    quote: slide.quote ? cleanFragment(slide.quote) : undefined,
    attribution: slide.attribution
      ? cleanFragment(slide.attribution)
      : undefined,
    left: slide.left
      ? {
          heading: capText(slide.left.heading ?? "", 8, 40),
          items: normItems(slide.left.items, LIMITS.MAX_COLUMN_ITEMS),
        }
      : undefined,
    right: slide.right
      ? {
          heading: capText(slide.right.heading ?? "", 8, 40),
          items: normItems(slide.right.items, LIMITS.MAX_COLUMN_ITEMS),
        }
      : undefined,
    stat: slide.stat
      ? {
          value: capText(String(slide.stat.value ?? ""), 4, 16),
          label: capText(String(slide.stat.label ?? ""), 14, 80),
        }
      : undefined,
  };

  if (!base.title) base.title = base.eyebrow || "Conceito";

  // Bullets overflow → split into continuation slides.
  if (base.kind === "bullets" || base.kind === "closing") {
    const all = normItems(slide.bullets, 999);
    if (all.length === 0) {
      base.bullets = [];
      return hasMinimumContent(base) ? [base] : [];
    }
    // Up to 6 fit on one slide (font auto-shrinks); only split beyond that, and
    // split into BALANCED chunks so we never get a "(cont.)" with a single item.
    if (all.length <= 6) {
      base.bullets = all;
      return [base];
    }
    const slidesNeeded = Math.ceil(all.length / LIMITS.MAX_BULLETS);
    const per = Math.ceil(all.length / slidesNeeded);
    const out: SlideSpec[] = [];
    for (let i = 0; i < all.length; i += per) {
      out.push({
        ...base,
        title: i === 0 ? base.title : `${base.title} (cont.)`,
        bullets: all.slice(i, i + per),
      });
    }
    return out;
  }

  // For other kinds: if minimum content missing, try to salvage as bullets,
  // otherwise drop the slide (degrade, never veto).
  if (!hasMinimumContent(base)) {
    // A degenerate chart still has its points as data → salvage to bullets
    // ("label: value") instead of dropping the slide. Quando os valores são
    // todos iguais — o caso da rosca recusada acima — o número não distingue
    // nada e só polui o tópico, então sobra só o rótulo.
    const pontos = slide.chart?.points ?? [];
    const comValor = proporcaoInformativa(pontos.map((p) => Number(p?.value)));
    const fromChart = pontos.map((p) =>
      comValor
        ? `${p?.label ?? ""}: ${p?.value ?? ""}${slide.chart?.unit ?? ""}`.trim()
        : `${p?.label ?? ""}`.trim()
    );
    const source = (slide.bullets?.length ? slide.bullets : fromChart);
    const salvage = normItems(source, LIMITS.MAX_BULLETS);
    if (salvage.length > 0) {
      return [{ kind: "bullets", title: base.title, eyebrow, bullets: salvage }];
    }
    return [];
  }
  return [base];
}

// NOTE (v7.26): anti-monotony for bullet runs was CONSOLIDATED into the renderer
// (render.ts dispatch), which rotates every short, image-less bullets slide
// across a single rich pool — tiles / bento / chevron / segmented-ring / pyramid
// / zig-zag / mountain / markers. Keeping a second, kind-level rotation here
// (the old breakLayoutRuns → tiles/bento) competed with that pool and starved
// the infographics, so normalization now leaves bullets as "bullets" and lets
// the renderer own all visual variety.

export interface NormalizeStats {
  modulesIn: number;
  slidesIn: number;
  slidesOut: number;
  slidesDropped: number;
  slidesSplit: number;
}

/** Normalize the whole deck. Always returns a renderable deck + stats. */
export function normalizeDeck(deck: PlannedDeck): {
  deck: PlannedDeck;
  stats: NormalizeStats;
} {
  let slidesIn = 0;
  let slidesOut = 0;
  let slidesDropped = 0;
  let slidesSplit = 0;

  const modules: DeckModule[] = deck.modules.map((m) => {
    const cleanTitle = capText(m.title ?? "", 14, LIMITS.MAX_TITLE_CHARS) ||
      "Módulo";
    let normalized: SlideSpec[] = [];
    for (const s of m.slides) {
      slidesIn++;
      const res = normalizeSlide(s);
      if (res.length === 0) slidesDropped++;
      if (res.length > 1) slidesSplit += res.length - 1;
      normalized.push(...res);
    }
    // Guarantee every module ships at least one slide.
    if (normalized.length === 0) {
      normalized.push({
        kind: "section",
        title: cleanTitle,
        eyebrow: cleanTitle,
        imageQuery: cleanTitle,
      });
    }
    slidesOut += normalized.length;
    return { title: cleanTitle, slides: normalized };
  });

  return {
    deck: { ...deck, modules },
    stats: {
      modulesIn: deck.modules.length,
      slidesIn,
      slidesOut,
      slidesDropped,
      slidesSplit,
    },
  };
}

/** Auto-size body font from total content weight (shrink, never truncate). */
export function autoBodyFontSize(itemCount: number, totalChars: number): number {
  if (itemCount >= 5 || totalChars > 360) return 13;
  if (itemCount >= 4 || totalChars > 240) return 14;
  if (itemCount >= 3 || totalChars > 140) return 16;
  return 18;
}
