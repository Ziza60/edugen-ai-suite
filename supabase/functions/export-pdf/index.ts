import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import { EDUSANS, registrarEduSans } from "../_shared/fontes/edusans.ts";
import {
  apenasDesenhaveis,
  detectImageFormat,
  fillImageBox,
  fitImageBox,
  lineHeightMm,
  medidorSemKerning,
  tocSeparatorY,
  tocTitleLines,
  transliterarSimbolos,
} from "../_shared/pdf-layout.ts";
import { splitCourseOverview } from "../_shared/course-frontmatter.ts";
import { separarListaEmbutida } from "../_shared/markdown.ts";
import { removerRepeticoes } from "../_shared/dedupe-licoes.ts";

// Este arquivo era autocontido para poder ser colado inteiro no editor do painel
// do Supabase. Deixou de ser: as contas de layout do sumário e da imagem foram
// para ../_shared/pdf-layout.ts porque precisavam de teste — foi por não terem
// teste que a imagem do módulo e o sumário sumiram numa refatoração e ninguém
// percebeu. Para deploy pelo painel, cole também aquele arquivo; pelo CLI
// (`supabase functions deploy export-pdf`) o _shared vai junto, como já vai nas
// outras funções.
function _headingKey(s: string): string {
  return (s || "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^m[óo]dul[oe]\s*\d+\s*[:.\-–—]\s*/i, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim().toLowerCase();
}
/** Strip a stray ```markdown wrapper fence + a leading heading that just repeats
 *  the module title (every consumer already renders the title). */
function cleanModuleContent(content: string, title?: string): string {
  let c = (content || "").trim();
  if (/^```/.test(c)) {
    c = c.replace(/^```[a-zA-Z]*[ \t]*\n?/, "").replace(/\n?```[ \t]*$/, "").trim();
  }
  if (title) {
    const lines = c.split("\n");
    let k = 0;
    while (k < lines.length && !lines[k].trim()) k++;
    if (
      k < lines.length && /^#{1,3}\s+/.test(lines[k]) &&
      _headingKey(title).length > 0 && _headingKey(lines[k]) === _headingKey(title)
    ) {
      lines.splice(0, k + 1);
      while (lines.length && !lines[0].trim()) lines.shift();
      c = lines.join("\n").trim();
    }
  }
  // A enumeração que o modelo devolveu dentro do parágrafo vira lista de
  // verdade. Sem isto, a apostila desenha o que recebeu: um bloco corrido de
  // vinte linhas onde deveria haver três ações numeradas.
  return separarListaEmbutida(c);
}

// TESTING_MODE: fase de testes sem usuários reais — libera o gate de plano Pro
// do export de PDF (espelha generate-course / upload-course-source). Voltar para
// `false` para reativar a monetização.
const TESTING_MODE = true;

// Build marker — surfaced on EVERY response header (x-export-pdf-build) so you
// can confirm in F12 → Network which code is actually live after a deploy.
const EXPORT_PDF_BUILD = "2026-08-23-fonte-embutida";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-export-pdf-build",
  "x-export-pdf-build": EXPORT_PDF_BUILD,
};

// ── Emoji & encoding helpers ──────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// QUAL FONTE ESTÁ EM USO
//
// Decidido uma vez, quando o documento é criado. Com EduSans embutida, o PDF
// desenha √ ≥ → • Δ π e o texto vai inteiro; sem ela — se o registro falhar —
// caímos na Helvetica e no caminho antigo, que traduz o que dá e remove o
// resto. Um PDF com "sqrt" é muito melhor que nenhum PDF.
// ═══════════════════════════════════════════════════════════════════════════

let FAMILIA = "helvetica";
let FONTE_AMPLA = false;

/** Chamado pelo construtor do documento. Ver _shared/fontes/edusans.ts. */
function escolherFonte(doc: unknown): void {
  FONTE_AMPLA = registrarEduSans(doc as never);
  FAMILIA = FONTE_AMPLA ? EDUSANS : "helvetica";
  console.log(`[PDF-FONTE] família em uso: ${FAMILIA}`);
}

/** Remove emojis and other non-Latin1 symbols that jsPDF cannot render */
function sanitizeText(text: string): string {
  let clean = text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, "")
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, "")
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, "")
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, "")
    .replace(/[\u{2600}-\u{26FF}]/gu, "")
    // 2713–2718 (✓ ✔ ✗ ✘) ficam de fora da varredura de emoji: numa lista de
    // conferência eles são conteúdo, não enfeite, e a peneira abaixo os
    // converte em "OK" e "X". Apagá-los aqui deixava a linha sem o veredito.
    .replace(/[\u{2700}-\u{2712}\u{2719}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{200D}]/gu, "")
    .replace(/[\u{20E3}]/gu, "")
    .replace(/[\u{E0020}-\u{E007F}]/gu, "")
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, "")
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, "")
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, "")
    .replace(/[\u{2300}-\u{23FF}]/gu, "")
    .replace(/[\u{2B50}]/gu, "")
    .replace(/[\u{203C}\u{2049}]/gu, "")
    .replace(/[\u{00AD}]/gu, "")
    .trim();

  // Aspas, travessões e reticências só viram ASCII quando a fonte é a
  // Helvetica. Com EduSans embutida elas são desenhadas como foram escritas,
  // e rebaixá-las seria piorar de graça.
  if (!FONTE_AMPLA) {
    clean = clean
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/[\u2026]/g, "...");
  }

  // Aspas, travess\u00F5es e retic\u00EAncias j\u00E1 estavam cobertos acima; o resto do que a
  // fonte WinAnsi n\u00E3o desenha n\u00E3o estava. Um \u2265 numa regra de confer\u00EAncia saiu
  // como `"e` \u2014 o texto errado, n\u00E3o faltando, que \u00E9 pior porque ningu\u00E9m nota.
  // Com a fonte embutida, preserva o que ela desenha; sem ela, traduz e apara.
  clean = FONTE_AMPLA ? apenasDesenhaveis(clean) : transliterarSimbolos(clean);

  clean = clean.replace(/  +/g, " ").trim();
  return clean;
}

/** Strip markdown formatting from text */
function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, "")
    // Bold/italic: the asterisks must HUG non-space content, so Python operators
    // ("5 ** 2", "a * b") are preserved while real **bold**/*italic* is stripped.
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1")
    .replace(/\*(?=\S)([^*]+?)(?<=\S)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, ""))
    .replace(/>\s*/g, "")
    .replace(/---/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function getHeadingLevel(line: string): number {
  const match = line.match(/^(#{1,6})\s/);
  return match ? match[1].length : 0;
}

// ── Table parser ──────────────────────────────────────────────────────

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function parseMarkdownTable(lines: string[], startIndex: number): { table: ParsedTable | null; endIndex: number } {
  if (!lines[startIndex]?.includes("|")) return { table: null, endIndex: startIndex };

  // "| a | b | c |" produz uma célula vazia em cada ponta; "a | b | c" não
  // produz nenhuma. O filtro anterior era `i > 0 && i < arr.length`, e a segunda
  // condição é sempre verdadeira — a célula vazia do FIM sobrevivia, e toda
  // tabela ganhava uma coluna fantasma. Com 3 colunas reais a largura passava a
  // ser dividida por 4 e a coluna de conteúdo perdia 29% do espaço; numa rubrica
  // de 5 colunas sobravam 16 mm por descritor, o bastante para ~9 caracteres por
  // linha. E como o índice 0 era descartado sem checar se estava vazio, uma
  // tabela escrita sem as barras das pontas perdia a primeira coluna de verdade.
  //
  // Remover apenas o que está de fato vazio nas pontas cobre os dois formatos.
  const parsePipeRow = (line: string): string[] => {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length && cells[0] === "") cells.shift();
    if (cells.length && cells[cells.length - 1] === "") cells.pop();
    return cells;
  };

  const headers = parsePipeRow(lines[startIndex]);
  if (headers.length < 2) return { table: null, endIndex: startIndex };

  const sepLine = lines[startIndex + 1];
  if (!sepLine || !/^[\s|:-]+$/.test(sepLine)) return { table: null, endIndex: startIndex };

  const rows: string[][] = [];
  let i = startIndex + 2;
  while (i < lines.length && lines[i].includes("|")) {
    const cells = parsePipeRow(lines[i]);
    if (cells.length >= 2) rows.push(cells);
    i++;
  }

  if (rows.length === 0) return { table: null, endIndex: startIndex };
  return { table: { headers, rows }, endIndex: i - 1 };
}

// ── Pedagogical block detection ───────────────────────────────────────

type PedagogicalBlockType = "example" | "reflection" | "summary" | "takeaways" | "tip" | "note" | null;

function detectPedagogicalBlock(text: string): PedagogicalBlockType {
  const lower = text.toLowerCase().replace(/[*#_`>]/g, "").trim();
  if (/^exemplo\s+pr[áa]tico/.test(lower) || /^na\s+pr[áa]tica/.test(lower) || /^vamos\s+praticar/.test(lower)) return "example";
  if (/^pare\s+um\s+momento/.test(lower) || /^reflita/.test(lower) || /^para\s+pensar/.test(lower) || /^checkpoint/.test(lower)) return "reflection";
  if (/^resumo/.test(lower) || /^em\s+resumo/.test(lower) || /^conclus[ãa]o/.test(lower)) return "summary";
  if (/^key\s+takeaway/.test(lower) || /^pontos[- ]chave/.test(lower)) return "takeaways";
  if (/^dica/.test(lower) || /^importante/.test(lower) || /^aten[çc][ãa]o/.test(lower)) return "tip";
  if (/^nota/.test(lower) || /^lembre[- ]se/.test(lower) || /^sa[íi]ba\s+mais/.test(lower) || /^exerc[íi]cio/.test(lower) || /^atividade/.test(lower) || /^desafio/.test(lower)) return "note";
  return null;
}

// ── PDF Layout constants ──────────────────────────────────────────────

const PAGE_W = 210;
const MARGIN_LEFT = 24;
const MARGIN_RIGHT = 24;
const MARGIN_TOP = 28;
const MARGIN_BOTTOM = 28;
const CONTENT_W = PAGE_W - MARGIN_LEFT - MARGIN_RIGHT;
const MAX_Y = 297 - MARGIN_BOTTOM;

// Font sizes
const FONT = {
  TITLE: 28,
  MODULE_TITLE: 20,
  H2: 15,
  H3: 12.5,
  H4: 11,
  BODY: 10.5,
  SMALL: 9.5,
  TABLE_HEADER: 9,
  TABLE_BODY: 9,
  BLOCK_LABEL: 9.5,
};

// Spacing (mm) — generous for comfortable reading
const SP = {
  AFTER_TITLE: 14,
  BEFORE_H2: 12,
  AFTER_H2: 7,
  BEFORE_H3: 10,
  AFTER_H3: 5,
  BEFORE_H4: 8,
  AFTER_H4: 4,
  AFTER_PARAGRAPH: 6,
  LINE_HEIGHT: 5.2,
  BULLET_GAP: 3,
  TABLE_ROW_PAD: 3.5,
  TABLE_CELL_LINE: 4,
  SECTION_GAP: 10,
  BLOCK_PAD_V: 5,
  BLOCK_PAD_H: 8,
};

// Colors (RGB tuples)
const COLOR = {
  PRIMARY: [18, 24, 68] as const,          // Deep navy (richer)
  PRIMARY_LIGHT: [45, 55, 120] as const,
  ACCENT: [196, 152, 40] as const,         // Gold accent
  ACCENT_LIGHT: [220, 185, 90] as const,
  MODULE_BG: [22, 28, 75] as const,        // Slightly lighter navy for module banners
  TEXT_DARK: [20, 20, 28] as const,
  TEXT_BODY: [40, 42, 52] as const,
  TEXT_MUTED: [105, 108, 125] as const,
  TEXT_WHITE: [255, 255, 255] as const,
  TEXT_LIGHT: [200, 210, 235] as const,    // Light text on dark backgrounds
  BG_EXAMPLE: [232, 246, 236] as const,
  BG_REFLECTION: [238, 234, 252] as const,
  BG_SUMMARY: [232, 242, 254] as const,
  BG_TAKEAWAY: [252, 244, 225] as const,
  BG_TIP: [255, 241, 225] as const,
  BG_NOTE: [240, 240, 248] as const,
  BAR_EXAMPLE: [35, 130, 65] as const,
  BAR_REFLECTION: [105, 65, 175] as const,
  BAR_SUMMARY: [35, 95, 175] as const,
  BAR_TAKEAWAY: [195, 145, 25] as const,
  BAR_TIP: [215, 115, 25] as const,
  BAR_NOTE: [95, 95, 125] as const,
  TABLE_HEADER: [18, 24, 68] as const,
  TABLE_ZEBRA: [244, 244, 252] as const,
  TABLE_FIRST_COL: [230, 230, 246] as const,
  BORDER_LIGHT: [208, 208, 222] as const,
  BORDER_TABLE: [180, 180, 200] as const,
  BG_CODE: [20, 26, 60] as const,
  CODE_TEXT: [220, 230, 248] as const,
  CODE_BORDER: [38, 46, 90] as const,
};

// ── PDF renderer ──────────────────────────────────────────────────────

class PdfRenderer {
  doc: any;
  y: number;
  pageNum: number;
  courseTitle: string = "";
  moduleIndex: number = 0;
  /** Onde ficou o "..." de cada módulo no sumário, para que finalizeTOC volte
   *  lá e escreva o número de página real por cima.
   *
   *  Guarda a PÁGINA junto com o Y: um curso com muitos módulos faz o sumário
   *  passar de uma página, e guardar só o Y escreveria todos os números na
   *  primeira delas. */
  tocPageNum: number = 0;
  tocLines: Array<{ page: number; y: number }> = [];

  constructor() {
    this.doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    escolherFonte(this.doc);
    this.y = MARGIN_TOP;
    this.pageNum = 1;
  }

  // ── Page management ──────────────────────────────────────────────

  addPage() {
    this.doc.addPage();
    this.pageNum++;
    this.drawPageHeader();
    this.drawFooter();
    this.y = MARGIN_TOP;
  }

  checkPage(needed: number) {
    if (this.y + needed > MAX_Y) this.addPage();
  }

  drawPageHeader() {
    // Thin navy bar at top — decorative only, no text (tiny text is distracting in viewers)
    this.doc.setFillColor(...COLOR.PRIMARY);
    this.doc.rect(0, 0, PAGE_W, 7, "F");
    // Gold accent stripe
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(0, 7, PAGE_W, 0.8, "F");
    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  drawFooter() {
    // Bottom navy bar
    this.doc.setFillColor(...COLOR.PRIMARY);
    this.doc.rect(0, 290, PAGE_W, 7, "F");
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(0, 290, PAGE_W, 0.8, "F");
    // Page number
    this.doc.setFontSize(7.5);
    this.doc.setFont(FAMILIA, "bold");
    this.doc.setTextColor(...COLOR.TEXT_WHITE);
    this.doc.text(`${this.pageNum}`, PAGE_W / 2, 294.5, { align: "center" });
    // CRITICAL: reset font to normal so estimation helpers after addPage()
    // use the correct font metrics (bold width ≠ normal width → wrong line counts → orphaning)
    this.doc.setFont(FAMILIA, "normal");
    this.doc.setFontSize(FONT.BODY);
    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  // ── Estimation helpers (no side-effects on Y) ────────────────────

  estimateTextHeight(text: string, fontSize: number, maxWidth: number, lineH: number): number {
    this.doc.setFontSize(fontSize);
    const lines = this.doc.splitTextToSize(sanitizeText(stripMarkdown(text)), maxWidth);
    return lines.length * lineH + 4;
  }

  estimateBulletHeight(text: string): number {
    this.doc.setFontSize(FONT.BODY);
    const clean = sanitizeText(stripMarkdown(text.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "")));
    const lines = this.doc.splitTextToSize(clean, CONTENT_W - 10);
    return lines.length * SP.LINE_HEIGHT + SP.BULLET_GAP;
  }

  estimateNextBlockHeight(lines: string[], i: number): number {
    if (i >= lines.length) return 0;
    const trimmed = lines[i].trim();
    if (!trimmed) return 0;

    if (trimmed.includes("|") && i + 1 < lines.length && lines[i + 1]?.includes("|")) {
      const { table } = parseMarkdownTable(lines, i);
      if (table) return Math.min(80, 10 + table.rows.length * 12);
    }
    if (trimmed.startsWith("> ")) {
      let text = trimmed.replace(/^>\s*/, "");
      let j = i + 1;
      while (j < lines.length && lines[j]?.trim().startsWith("> ")) {
        text += " " + lines[j].trim().replace(/^>\s*/, "");
        j++;
      }
      return this.estimateTextHeight(text, FONT.SMALL, CONTENT_W - 16, 4.5) + 12;
    }
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || /^\d+\.\s/.test(trimmed)) {
      let h = 0, j = i, count = 0;
      while (j < lines.length && count < 5) {
        const t = lines[j].trim();
        if (!t || getHeadingLevel(t) > 0) break;
        if (t.startsWith("- ") || t.startsWith("* ") || /^\d+\.\s/.test(t)) {
          h += this.estimateBulletHeight(t);
          count++;
        } else break;
        j++;
      }
      return h;
    }
    return this.estimateTextHeight(trimmed, FONT.BODY, CONTENT_W, SP.LINE_HEIGHT);
  }

  nextNonEmpty(lines: string[], from: number): number {
    let j = from;
    while (j < lines.length && !lines[j].trim()) j++;
    return j;
  }

  // "Keep-with-next" height for a heading: accumulate the following blocks
  // (intro paragraph + its table/list/etc.) up to a target, so a heading is never
  // stranded at the page bottom with only a one-line intro while the real content
  // (a table) starts on the next page. Capped so a tall table doesn't force a
  // needless break — we only need to guarantee a meaningful chunk stays together.
  estimateKeepHeight(lines: string[], fromIdx: number): number {
    const TARGET = 30; // mm of content to keep under a heading
    let total = 0, j = fromIdx, guard = 0;
    while (j < lines.length && total < TARGET && guard < 5) {
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length) break;
      const t = lines[j].trim();
      if (getHeadingLevel(t) > 0) break; // next heading — stop accumulating
      if (t === "---" || t === "***" || t === "___") { j++; continue; }

      // table
      if (t.includes("|") && lines[j + 1]?.includes("|")) {
        const { table, endIndex } = parseMarkdownTable(lines, j);
        if (table) { total += Math.min(80, 10 + table.rows.length * 12); j = endIndex + 1; guard++; continue; }
      }
      // bullet / numbered run
      if (t.startsWith("- ") || t.startsWith("* ") || /^\d+\.\s/.test(t)) {
        while (j < lines.length) {
          const tt = lines[j].trim();
          if (!tt || getHeadingLevel(tt) > 0) break;
          if (tt.startsWith("- ") || tt.startsWith("* ") || /^\d+\.\s/.test(tt)) { total += this.estimateBulletHeight(tt); j++; }
          else break;
        }
        guard++; continue;
      }
      // blockquote
      if (t.startsWith("> ")) {
        let txt = t.replace(/^>\s*/, ""); j++;
        while (j < lines.length && lines[j].trim().startsWith("> ")) { txt += " " + lines[j].trim().replace(/^>\s*/, ""); j++; }
        total += this.estimateTextHeight(txt, FONT.SMALL, CONTENT_W - 16, 4.5) + 12; guard++; continue;
      }
      // paragraph
      total += this.estimateTextHeight(t, FONT.BODY, CONTENT_W, SP.LINE_HEIGHT); j++; guard++;
    }
    return Math.min(total, TARGET);
  }

  // ── Title page ────────────────────────────────────────────────────

  renderTitlePage(
    title: string,
    description: string | null,
    language: string,
    capa?: Uint8Array,
  ) {
    // Full-height navy background (top 2/3)
    this.doc.setFillColor(...COLOR.PRIMARY);
    this.doc.rect(0, 0, PAGE_W, 185, "F");

    // Gold accent left bar
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(MARGIN_LEFT, 55, 3, 90, "F");

    // Gold horizontal divider
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(0, 185, PAGE_W, 1.5, "F");

    // Subtle geometric accent: small dots pattern (top-right)
    this.doc.setFillColor(30, 38, 95);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        this.doc.circle(PAGE_W - 18 + col * 6, 20 + row * 6, 1, "F");
      }
    }

    // Course title — white, large, left-aligned
    this.doc.setFontSize(28);
    this.doc.setFont(FAMILIA, "bold");
    this.doc.setTextColor(...COLOR.TEXT_WHITE);
    const titleLines = this.doc.splitTextToSize(sanitizeText(title), CONTENT_W - 20);
    const titleY = 82;
    this.doc.text(titleLines, MARGIN_LEFT + 10, titleY);

    // Gold line under title
    const underY = titleY + titleLines.length * 11 + 5;
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(MARGIN_LEFT + 10, underY, 45, 1, "F");

    // Description — light text, left-aligned
    let fimDaDescricao = underY + 14;
    if (description) {
      this.doc.setFontSize(10.5);
      this.doc.setFont(FAMILIA, "normal");
      this.doc.setTextColor(...COLOR.TEXT_LIGHT);
      const descLines = this.doc.splitTextToSize(sanitizeText(description), CONTENT_W - 14);
      this.doc.text(descLines, MARGIN_LEFT + 10, underY + 14);
      fimDaDescricao = underY + 14 + descLines.length * lineHeightMm(10.5);
    }

    // Idioma e data.
    //
    // Com capa, eles SOBEM para dentro do bloco azul: a área de baixo passa a
    // ser da imagem inteira, e texto cinza sobre uma foto qualquer é aposta —
    // sobre imagem clara ainda se lê, sobre escura não. No azul o tratamento
    // já é texto claro sobre fundo escuro, o mesmo do título.
    //
    // Sem capa, ficam onde sempre estiveram: a área de baixo continua branca e
    // esvaziá-la deixaria a página de rosto com um vão sem motivo.
    const dataHoje = new Date().toLocaleDateString("pt-BR");
    this.doc.setFontSize(9);
    this.doc.setFont(FAMILIA, "normal");
    if (capa) {
      // Ancorado perto da divisória dourada, e não colado na descrição: assim a
      // posição não dança conforme o tamanho do título e do resumo. O piso
      // empurra para baixo da descrição quando ela é longa.
      const yMeta = Math.min(178, Math.max(172, fimDaDescricao + 8));
      this.doc.setTextColor(...COLOR.TEXT_LIGHT);
      this.doc.text(`Idioma: ${language}   ·   ${dataHoje}`, MARGIN_LEFT + 10, yMeta);
    } else {
      this.doc.setTextColor(...COLOR.TEXT_MUTED);
      this.doc.text(`Idioma: ${language}`, MARGIN_LEFT, 202);
      this.doc.text(dataHoje, MARGIN_LEFT, 210);
    }

    // Capa escolhida pelo autor, ocupando a ÁREA INTEIRA abaixo da divisória
    // dourada: de borda a borda da página, da divisória até o rodapé.
    //
    // Antes ela vivia numa faixa de 162 x 62 mm no meio de uma área branca de
    // 210 x 100,5 — sobrava branco nos quatro lados em volta dela. Usar a área
    // toda não é só maior: é MENOS recortado. A área é 2,09:1 e a imagem gerada
    // é 1,78:1, então o corte cai de 33% da altura para 16%.
    //
    // Fica depois do texto de propósito: a página de rosto tem que se sustentar
    // sozinha quando não há capa.
    const CAPA_Y = 186.5;          // logo abaixo da divisória (185 + 1,5)
    const CAPA_X = 0;              // sangra até a borda da página
    const CAPA_W = PAGE_W;
    const CAPA_H = 287 - CAPA_Y;   // encosta na barra do rodapé
    if (capa) {
      try {
        const formato = detectImageFormat(capa);
        if (formato) {
          let binary = "";
          for (let i = 0; i < capa.length; i++) binary += String.fromCharCode(capa[i]);
          const dataUri = `data:image/${formato.toLowerCase()};base64,${btoa(binary)}`;
          const props = this.doc.getImageProperties(dataUri);
          // A área é FIXA, então encaixar a imagem dentro dela deixaria branco
          // no lado que não limitou. Preenche e recorta o excedente.
          const box = fillImageBox(
            props.width, props.height, CAPA_X, CAPA_Y, CAPA_W, CAPA_H,
          );
          if (box.recortada) {
            // O recorte é do PDF, não da imagem: salva o estado gráfico, elege
            // a faixa como região de desenho, desenha e devolve o estado. O
            // `null` no rect é o que impede o jsPDF de traçar a borda do
            // próprio caminho de recorte.
            this.doc.saveGraphicsState();
            this.doc.rect(CAPA_X, CAPA_Y, CAPA_W, CAPA_H, null);
            this.doc.clip();
            this.doc.discardPath();
            this.doc.addImage(dataUri, formato, box.x, box.y, box.w, box.h);
            this.doc.restoreGraphicsState();
          } else {
            this.doc.addImage(dataUri, formato, box.x, box.y, box.w, box.h);
          }
        } else {
          console.error("[export-pdf] capa em formato não suportado pelo jsPDF — ignorada");
        }
      } catch (capaErr) {
        console.error("[export-pdf] falha ao embutir a capa:", capaErr);
      }
    }

    // Premium footer bar
    this.doc.setFillColor(...COLOR.PRIMARY);
    this.doc.rect(0, 287, PAGE_W, 10, "F");
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(0, 287, PAGE_W, 1.5, "F");

    // Page number on cover
    this.doc.setFontSize(7.5);
    this.doc.setFont(FAMILIA, "bold");
    this.doc.setTextColor(...COLOR.TEXT_WHITE);
    this.doc.text("1", PAGE_W / 2, 293, { align: "center" });
    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  // ── Sumário ───────────────────────────────────────────────────────
  //
  // Existia, e se perdeu quando este arquivo foi separado em módulos. O leitor
  // ficou com os marcadores laterais e nada impresso: quem abre a apostila em
  // papel, ou num visualizador sem painel lateral, não tem por onde navegar.
  //
  // O número da página não dá para saber na hora de desenhar o sumário — ele
  // vem antes dos módulos. Então imprimimos "..." e voltamos depois, em
  // finalizeTOC, para escrever o número por cima.

  renderTOCPage(moduleTitles: string[]) {
    this.addPage();
    this.tocPageNum = this.pageNum;
    this.tocLines = [];
    this.y = MARGIN_TOP + 4;

    this.doc.setFontSize(FONT.MODULE_TITLE);
    this.doc.setFont(FAMILIA, "bold");
    this.doc.setTextColor(...COLOR.PRIMARY);
    this.doc.text("Sumário", MARGIN_LEFT, this.y);
    this.y += FONT.MODULE_TITLE * 0.5 + 6;

    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(MARGIN_LEFT, this.y, 40, 0.8, "F");
    this.y += 8;

    // A faixa dos pontinhos é fixa. Se ela flutuasse conforme o tamanho do
    // título, um título longo comeria o espaço do número da página.
    const MAX_TITLE_W = CONTENT_W - 48;
    const PAGE_NUM_X = PAGE_W - MARGIN_RIGHT;
    const DOT_FIXED_X = PAGE_NUM_X - 30;
    const DOT_END_X = PAGE_NUM_X - 8;

    // O avanço por linha tem que ser o que o jsPDF de fato usa. Com o valor
    // fixo de antes, num título de duas linhas os pontinhos e o número saíam
    // um milímetro abaixo da segunda linha, em vez de alinhados com ela.
    const LH = lineHeightMm(FONT.BODY, this.doc.getLineHeightFactor?.() ?? 1.15);
    /** Da última linha de um item à linha de base do item seguinte. */
    const VAO = 9;

    for (let i = 0; i < moduleTitles.length; i++) {
      const label = sanitizeText(moduleTitles[i] || `Módulo ${i + 1}`);

      this.doc.setFontSize(FONT.SMALL);
      this.doc.setFont(FAMILIA, "bold");
      this.doc.setTextColor(...COLOR.ACCENT);
      this.doc.text(`${i + 1}.`, MARGIN_LEFT, this.y);

      this.doc.setFontSize(FONT.BODY);
      this.doc.setFont(FAMILIA, "normal");
      this.doc.setTextColor(...COLOR.TEXT_DARK);
      const titleLines = tocTitleLines(this.doc.splitTextToSize(label, MAX_TITLE_W));
      this.doc.text(titleLines, MARGIN_LEFT + 8, this.y);

      // Pontinhos e número ancoram na ÚLTIMA linha do título; ancorar na
      // primeira fazia o número cortar um título de duas linhas ao meio.
      const lastLineY = this.y + (titleLines.length - 1) * LH;
      this.tocLines.push({ page: this.pageNum, y: lastLineY });

      this.doc.setFontSize(7);
      this.doc.setTextColor(...COLOR.TEXT_MUTED);
      const dotLine: string =
        this.doc.splitTextToSize(". ".repeat(40), DOT_END_X - DOT_FIXED_X)[0] || "";
      if (dotLine) this.doc.text(dotLine, DOT_FIXED_X, lastLineY);

      this.doc.setFontSize(FONT.BODY);
      this.doc.setFont(FAMILIA, "bold");
      this.doc.text("...", PAGE_NUM_X, lastLineY, { align: "right" });

      // O separador vai no meio do vão, calculado a partir da altura das
      // letras dos dois lados. Antes ele ficava a 1 mm da linha de base do
      // item seguinte — e como uma maiúscula sobe 2,67 mm, o traço não separava
      // nada: ele cortava o título de baixo.
      if (i < moduleTitles.length - 1) {
        const ySep = tocSeparatorY(lastLineY, VAO, FONT.BODY);
        this.doc.setDrawColor(...COLOR.TEXT_MUTED);
        this.doc.setLineWidth(0.1);
        this.doc.line(MARGIN_LEFT, ySep, PAGE_W - MARGIN_RIGHT, ySep);
      }

      this.y = lastLineY + VAO;
      this.checkPage(VAO + 6);
    }

    this.doc.setFont(FAMILIA, "normal");
    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  /** Volta ao sumário e troca cada "..." pelo número de página real. */
  finalizeTOC(moduleStartPages: number[]) {
    if (!this.tocPageNum || this.tocLines.length === 0) return;
    const lastPage = this.pageNum;
    const PAGE_NUM_X = PAGE_W - MARGIN_RIGHT;
    try {
      const total = Math.min(moduleStartPages.length, this.tocLines.length);
      for (let i = 0; i < total; i++) {
        const { page, y } = this.tocLines[i];
        this.doc.setPage(page);
        // Apaga o "..." antes de escrever por cima; sem isso o número sai
        // sobreposto às reticências.
        this.doc.setFillColor(255, 255, 255);
        this.doc.rect(PAGE_NUM_X - 22, y - 5, 24, 6.5, "F");
        this.doc.setFontSize(FONT.BODY);
        this.doc.setFont(FAMILIA, "bold");
        this.doc.setTextColor(...COLOR.PRIMARY);
        this.doc.text(String(moduleStartPages[i]), PAGE_NUM_X, y, { align: "right" });
      }
      this.doc.setFont(FAMILIA, "normal");
      this.doc.setTextColor(...COLOR.TEXT_BODY);
    } finally {
      // Sem voltar para a última página, o output() sai truncado.
      this.doc.setPage(lastPage);
    }
  }

  // ── Imagem do módulo ──────────────────────────────────────────────
  //
  // Também se perdeu na separação do arquivo. As imagens continuavam sendo
  // geradas, pagas e gravadas em course_images — o portal do aluno as mostra —
  // mas nenhuma exportação as lia. O comprador levava a apostila sem elas.

  renderModuleImage(bytes: Uint8Array, altText?: string) {
    try {
      const format = detectImageFormat(bytes);
      if (!format) {
        console.error("[export-pdf] formato de imagem não suportado pelo jsPDF — ignorada");
        return;
      }

      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      const dataUri = `data:image/${format.toLowerCase()};base64,${base64}`;

      const props = this.doc.getImageProperties(dataUri);
      const { w, h } = fitImageBox(props.width, props.height, CONTENT_W, 70);

      this.checkPage(h + 8);
      this.doc.addImage(dataUri, format, MARGIN_LEFT + (CONTENT_W - w) / 2, this.y, w, h);
      this.y += h + 8;

      // SEM LEGENDA, DE PROPÓSITO
      //
      // Aqui era impresso o alt_text. Ele existe para o leitor de tela e
      // descreve O QUE A FOTO MOSTRA — trabalho diferente do de uma legenda,
      // que liga a imagem ao que a lição ensina. Publicar um pelo outro pôs
      // "Profissionais de negócios discutindo amostras de design de interiores"
      // na primeira página de conteúdo de um curso de orçamento público, e, na
      // imagem gerada por IA, cinco linhas do PRÓPRIO PROMPT abrindo com
      // "Imagem IA:" — metadado interno vazando para o documento do comprador.
      //
      // Tirar não custa acessibilidade: este PDF não é marcado (Tagged: no),
      // então o alt nunca chegou a leitor de tela nenhum por aqui — ele só
      // aparecia impresso. Onde o alt tem função de verdade (HTML do SCORM,
      // Moodle, Notion) ele continua intacto, em course-images.ts.
      //
      // Legenda boa exigiria uma frase escrita a partir da lição. Enquanto ela
      // não existe, nenhuma legenda é melhor que a errada.
      void altText;
    } catch (imgErr) {
      // Imagem é enriquecimento; nunca pode custar a apostila inteira.
      console.error("[export-pdf] falha ao embutir imagem do módulo:", imgErr);
    }
  }

  // ── Module title ──────────────────────────────────────────────────

  renderModuleTitle(title: string) {
    this.addPage();

    // Marcador de navegação do módulo. Num documento de 75 páginas o painel
    // lateral do leitor ficava vazio, e a única navegação era o sumário da
    // página 2 — para trocar de módulo o aluno tinha que rolar o documento.
    try {
      // moduleIndex 0 é a apresentação do curso, que não é um módulo e portanto
      // não recebe número no marcador.
      const rotulo = this.moduleIndex > 0 ? `${this.moduleIndex}. ${title}` : title;
      this.doc.outline?.add?.(null, rotulo, { pageNumber: this.pageNum });
    } catch {
      // Outline é conveniência de navegação; nunca pode custar o PDF.
    }

    // Full navy banner across top (covers page header from addPage)
    this.doc.setFillColor(...COLOR.MODULE_BG);
    this.doc.rect(0, 0, PAGE_W, 52, "F");

    // Gold accent left bar
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(0, 0, 4, 52, "F");

    // Gold bottom edge of banner
    this.doc.setFillColor(...COLOR.ACCENT);
    this.doc.rect(0, 52, PAGE_W, 1, "F");

    // Module number badge (large, semi-transparent)
    if (this.moduleIndex > 0) {
      this.doc.setFontSize(48);
      this.doc.setFont(FAMILIA, "bold");
      this.doc.setTextColor(30, 38, 95); // dark overlay on navy
      const numStr = String(this.moduleIndex).padStart(2, "0");
      this.doc.text(numStr, PAGE_W - MARGIN_RIGHT, 46, { align: "right" });
    }

    // "MÓDULO N" label — 9.5pt so it reads cleanly alongside 10.5pt body
    this.doc.setFontSize(9.5);
    this.doc.setFont(FAMILIA, "bold");
    this.doc.setTextColor(...COLOR.ACCENT);
    if (this.moduleIndex > 0) {
      this.doc.text(`MÓDULO ${this.moduleIndex}`, MARGIN_LEFT + 8, 16);
    }

    // Module title — white, bold
    this.doc.setFontSize(FONT.MODULE_TITLE);
    this.doc.setFont(FAMILIA, "bold");
    this.doc.setTextColor(...COLOR.TEXT_WHITE);
    const lines = this.doc.splitTextToSize(sanitizeText(title), CONTENT_W - 22);
    this.doc.text(lines, MARGIN_LEFT + 8, this.moduleIndex > 0 ? 28 : 22);

    // Reset y below banner for content
    this.y = 62;
    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  // ── Headings ──────────────────────────────────────────────────────

  renderHeading(text: string, level: number, extraNeeded = 0) {
    const sizeMap: Record<number, number> = { 2: FONT.H2, 3: FONT.H3, 4: FONT.H4, 5: FONT.BODY, 6: FONT.BODY };
    const fontSize = sizeMap[level] || FONT.BODY;
    const beforeMap: Record<number, number> = { 2: SP.BEFORE_H2, 3: SP.BEFORE_H3, 4: SP.BEFORE_H4 };
    const beforeSpace = beforeMap[level] || 6;
    const afterMap: Record<number, number> = { 2: SP.AFTER_H2, 3: SP.AFTER_H3, 4: SP.AFTER_H4 };
    const afterSpace = afterMap[level] || 4;

    const cleanText = sanitizeText(stripMarkdown(text.replace(/^#{1,6}\s*/, "")));
    this.doc.setFontSize(fontSize);
    const textLines = this.doc.splitTextToSize(cleanText, CONTENT_W);
    const headingH = beforeSpace + textLines.length * (fontSize * 0.38) + afterSpace;

    this.checkPage(headingH + extraNeeded);
    this.y += beforeSpace;

    this.doc.setFont(FAMILIA, "bold");
    this.doc.setTextColor(...COLOR.PRIMARY);
    this.doc.text(textLines, MARGIN_LEFT, this.y);
    this.y += textLines.length * (fontSize * 0.38) + afterSpace;

    // H2 underline accent
    if (level === 2) {
      this.doc.setDrawColor(...COLOR.PRIMARY_LIGHT);
      this.doc.setLineWidth(0.3);
      this.doc.line(MARGIN_LEFT, this.y - 3, MARGIN_LEFT + 55, this.y - 3);
      this.y += 2;
    }

    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  // ── Body text ─────────────────────────────────────────────────────

  renderParagraph(text: string) {
    const cleanText = sanitizeText(stripMarkdown(text));
    if (!cleanText) return;

    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont(FAMILIA, "normal");
    this.doc.setTextColor(...COLOR.TEXT_BODY);

    const lines = this.doc.splitTextToSize(cleanText, CONTENT_W);
    this.checkPage(lines.length * SP.LINE_HEIGHT + 3);

    // Largura de palavra para justificação — caractere a caractere, de
    // propósito. Medir a palavra inteira traz o kerning do getTextWidth, que o
    // doc.text() não desenha: a palavra fica mais larga que a medida e come o
    // espaço seguinte ("PPAé", "Tomadade"). Ver medidorSemKerning.
    const SF = 72 / 25.4; // mm por ponto (escala do jsPDF em mm)
    const medir = medidorSemKerning((ch) => {
      try {
        return this.doc.getTextWidth(ch);
      } catch (_) {
        return 0;
      }
    });
    const wordWidthMm = (w: string): number => {
      const tw = medir(w);
      if (tw > 0 && tw < 40) return tw;
      // Rede de segurança: 0,48 em por caractere, média da Helvetica. Cobre o
      // getTextWidth devolvendo 0 em contextos Deno/esm.sh.
      return w.length * FONT.BODY * 0.48 / SF;
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const isLastLine = idx === lines.length - 1;
      const trimmedLine = line.trim();
      const words = trimmedLine.split(/\s+/);
      // Justify all lines except the last, and only when >= 3 words
      if (!isLastLine && words.length >= 3) {
        const totalWordW = words.reduce((s, w) => s + wordWidthMm(w), 0);
        const gap = (CONTENT_W - totalWordW) / (words.length - 1);
        // Accept gap 0.3–12 mm: below 0.3 means words overlap; above 12 means
        // the line is too short (3–4 short words) and justification looks stretched.
        // 12 mm headroom handles lines with wider Portuguese words (transformação, etc.).
        if (gap >= 0.3 && gap <= 12) {
          let x = MARGIN_LEFT;
          for (let w = 0; w < words.length; w++) {
            this.doc.text(words[w], x, this.y);
            x += wordWidthMm(words[w]) + gap;
          }
          this.y += SP.LINE_HEIGHT;
          continue;
        }
      }
      this.doc.text(trimmedLine, MARGIN_LEFT, this.y);
      this.y += SP.LINE_HEIGHT;
    }
    this.y += SP.AFTER_PARAGRAPH;
  }

  renderBullet(text: string, indent = 0) {
    const cleanText = sanitizeText(stripMarkdown(text.replace(/^[-*]\s*/, "")));
    if (!cleanText) return;

    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont(FAMILIA, "normal");
    this.doc.setTextColor(...COLOR.TEXT_BODY);

    const indentMm = indent * 5;
    const bulletX = MARGIN_LEFT + 3 + indentMm;
    const textX = MARGIN_LEFT + 9 + indentMm;
    const availW = CONTENT_W - 9 - indentMm;

    const lines = this.doc.splitTextToSize(cleanText, availW);
    this.checkPage(lines.length * SP.LINE_HEIGHT + SP.BULLET_GAP);

    // Bullet dot
    this.doc.setFillColor(...COLOR.PRIMARY);
    this.doc.circle(bulletX, this.y - 1.2, 0.8, "F");

    this.doc.text(lines, textX, this.y);
    this.y += lines.length * SP.LINE_HEIGHT + SP.BULLET_GAP;
  }

  // ── Blockquote ────────────────────────────────────────────────────

  renderBlockquote(text: string) {
    const cleanText = sanitizeText(stripMarkdown(text.replace(/^>\s*/, "")));
    if (!cleanText) return;

    this.doc.setFontSize(FONT.SMALL);
    this.doc.setFont(FAMILIA, "italic");

    const lines = this.doc.splitTextToSize(cleanText, CONTENT_W - 16);
    const blockH = lines.length * 4.5 + SP.BLOCK_PAD_V * 2;
    this.checkPage(blockH + 4);

    // Background
    this.doc.setFillColor(...COLOR.BG_NOTE);
    this.doc.roundedRect(MARGIN_LEFT, this.y - SP.BLOCK_PAD_V, CONTENT_W, blockH, 2, 2, "F");

    // Left accent bar
    this.doc.setFillColor(...COLOR.BAR_NOTE);
    this.doc.roundedRect(MARGIN_LEFT, this.y - SP.BLOCK_PAD_V, 3, blockH, 1.5, 1.5, "F");

    this.doc.setTextColor(60, 60, 85);
    this.doc.text(lines, MARGIN_LEFT + SP.BLOCK_PAD_H + 2, this.y + 1);
    this.y += blockH + 6;
    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  // ── Styled pedagogical box ────────────────────────────────────────

  renderPedagogicalBox(label: string, bodyLines: string[], blockType: PedagogicalBlockType) {
    const bgMap: Record<string, readonly [number, number, number]> = {
      example: COLOR.BG_EXAMPLE,
      reflection: COLOR.BG_REFLECTION,
      summary: COLOR.BG_SUMMARY,
      takeaways: COLOR.BG_TAKEAWAY,
      tip: COLOR.BG_TIP,
      note: COLOR.BG_NOTE,
    };
    const barMap: Record<string, readonly [number, number, number]> = {
      example: COLOR.BAR_EXAMPLE,
      reflection: COLOR.BAR_REFLECTION,
      summary: COLOR.BAR_SUMMARY,
      takeaways: COLOR.BAR_TAKEAWAY,
      tip: COLOR.BAR_TIP,
      note: COLOR.BAR_NOTE,
    };
    const bt = blockType || "note";
    const bg = bgMap[bt] || COLOR.BG_NOTE;
    const bar = barMap[bt] || COLOR.BAR_NOTE;

    // Measure label
    this.doc.setFontSize(FONT.BLOCK_LABEL);
    this.doc.setFont(FAMILIA, "bold");
    const labelClean = sanitizeText(stripMarkdown(label));
    const labelLines = this.doc.splitTextToSize(labelClean, CONTENT_W - 18);
    const labelH = labelLines.length * 4.5;

    // Measure body
    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont(FAMILIA, "normal");
    const bodyH = bodyLines.reduce((sum, line) => {
      const ls = this.doc.splitTextToSize(sanitizeText(stripMarkdown(line)), CONTENT_W - 18);
      return sum + ls.length * SP.LINE_HEIGHT + 2;
    }, 0);

    const totalH = SP.BLOCK_PAD_V + labelH + 4 + bodyH + SP.BLOCK_PAD_V;
    this.checkPage(totalH + 4);

    const boxY = this.y - 2;

    // Background with rounded corners
    this.doc.setFillColor(...bg);
    this.doc.roundedRect(MARGIN_LEFT, boxY, CONTENT_W, totalH, 2.5, 2.5, "F");

    // Left accent bar
    this.doc.setFillColor(...bar);
    this.doc.roundedRect(MARGIN_LEFT, boxY, 3.5, totalH, 1.5, 1.5, "F");

    // Label
    this.doc.setFontSize(FONT.BLOCK_LABEL);
    this.doc.setFont(FAMILIA, "bold");
    this.doc.setTextColor(...(bar as [number, number, number]));
    const innerX = MARGIN_LEFT + SP.BLOCK_PAD_H + 2;
    let curY = boxY + SP.BLOCK_PAD_V + 3;
    this.doc.text(labelLines, innerX, curY);
    curY += labelH + 4;

    // Body content
    this.doc.setFontSize(FONT.BODY);
    this.doc.setFont(FAMILIA, "normal");
    this.doc.setTextColor(...COLOR.TEXT_BODY);
    for (const line of bodyLines) {
      const clean = sanitizeText(stripMarkdown(line));
      if (!clean) { curY += 2; continue; }
      const isBullet = line.trim().startsWith("- ") || line.trim().startsWith("* ") || /^\d+\.\s/.test(line.trim());
      if (isBullet) {
        const bulletText = clean.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "");
        const ls = this.doc.splitTextToSize(bulletText, CONTENT_W - 24);
        this.doc.setFillColor(...bar);
        this.doc.circle(innerX + 2, curY - 1, 0.7, "F");
        this.doc.setTextColor(...COLOR.TEXT_BODY);
        this.doc.text(ls, innerX + 7, curY);
        curY += ls.length * SP.LINE_HEIGHT + SP.BULLET_GAP;
      } else {
        const ls = this.doc.splitTextToSize(clean, CONTENT_W - 18);
        this.doc.text(ls, innerX, curY);
        curY += ls.length * SP.LINE_HEIGHT + 2;
      }
    }

    this.y = boxY + totalH + 8;
  }

  // ── Horizontal rule ───────────────────────────────────────────────

  renderHorizontalRule() {
    this.checkPage(10);
    this.y += 4;
    this.doc.setDrawColor(...COLOR.BORDER_LIGHT);
    this.doc.setLineWidth(0.3);
    this.doc.line(MARGIN_LEFT + 25, this.y, PAGE_W - MARGIN_RIGHT - 25, this.y);
    this.y += SP.SECTION_GAP;
  }

  // ── Table rendering ───────────────────────────────────────────────

  renderTable(table: ParsedTable) {
    const { headers, rows } = table;
    const numCols = headers.length;

    // Uma grade de 5 colunas de prosa não cabe em retrato com fonte legível:
    // sobram ~24 mm por coluna, e "O mapeamento do processo é claro" sai
    // quebrado no meio das palavras. A rubrica do projeto final — justamente o
    // texto contra o qual o aluno é avaliado — era a principal vítima. Acima do
    // limite, cada linha vira um bloco empilhado, que é legível em qualquer
    // largura.
    if (numCols >= 5) return this.renderTableAsBlocks(table);

    // Column widths - first column wider for "Aspecto" pattern
    const colWidths: number[] = [];
    const firstRatio = numCols <= 2 ? 0.35 : numCols <= 3 ? 0.30 : 0.25;
    colWidths.push(CONTENT_W * firstRatio);
    const remaining = CONTENT_W - colWidths[0];
    for (let i = 1; i < numCols; i++) colWidths.push(remaining / (numCols - 1));

    // Com 4 colunas o corpo a 9 pt rende ~17 caracteres por linha. Reduzir um
    // ponto devolve espaço sem prejudicar a leitura — a tabela é conteúdo de
    // apoio, e o texto corrido em volta segue no tamanho normal.
    const bodySize = numCols >= 4 ? FONT.TABLE_BODY - 1.5 : FONT.TABLE_BODY;
    const cellPad = numCols >= 4 ? 5 : 8;

    // Teto de linhas por célula. Antes era um `.slice(0, 4)` fixo, sem
    // reticências e com a altura da linha calculada já com o corte: o texto
    // sumia sem deixar rastro, e num glossário isso significava oito verbetes
    // terminando no meio da frase. O teto agora é o que cabe numa página, de
    // modo que só perde texto quem realmente não caberia de jeito nenhum.
    const maxCellLines = Math.max(
      4,
      Math.floor((MAX_Y - MARGIN_TOP - 10 - SP.TABLE_ROW_PAD * 2) / SP.TABLE_CELL_LINE),
    );

    /** Quebra uma célula, marcando com reticências quando de fato cortou. */
    const wrapCell = (text: string, width: number): string[] => {
      this.doc.setFontSize(bodySize);
      const all = this.doc.splitTextToSize(sanitizeText(stripMarkdown(text || "")), width);
      if (all.length <= maxCellLines) return all;
      const kept = all.slice(0, maxCellLines);
      kept[kept.length - 1] = String(kept[kept.length - 1]).replace(/[\s,;:]+$/, "") + "…";
      return kept;
    };

    // Pre-measure all rows to get accurate heights
    const headerH = 10;
    const rowHeights: number[] = [];
    for (const row of rows) {
      let maxLines = 1;
      for (let c = 0; c < numCols; c++) {
        const lines = wrapCell(row[c] || "", colWidths[c] - cellPad);
        if (lines.length > maxLines) maxLines = lines.length;
      }
      rowHeights.push(Math.max(8, maxLines * SP.TABLE_CELL_LINE + SP.TABLE_ROW_PAD * 2));
    }

    const totalTableH = headerH + rowHeights.reduce((a, b) => a + b, 0) + 4;

    // If table fits on one page, keep it together
    if (totalTableH < MAX_Y - MARGIN_TOP) {
      this.checkPage(totalTableH);
    } else {
      this.checkPage(Math.min(totalTableH, headerH + rowHeights[0] + 20));
    }

    this.y += 3;
    const startX = MARGIN_LEFT;
    let currentY = this.y;

    const drawHeader = (atY: number): number => {
      // Header background
      this.doc.setFillColor(...COLOR.TABLE_HEADER);
      this.doc.roundedRect(startX, atY, CONTENT_W, headerH, 1.5, 1.5, "F");
      // Square off bottom corners by overlaying rect
      this.doc.rect(startX, atY + headerH - 2, CONTENT_W, 2, "F");

      this.doc.setFontSize(numCols >= 4 ? FONT.TABLE_HEADER - 1.5 : FONT.TABLE_HEADER);
      this.doc.setFont(FAMILIA, "bold");
      this.doc.setTextColor(...COLOR.TEXT_WHITE);

      let hx = startX;
      for (let c = 0; c < numCols; c++) {
        const cellText = sanitizeText(stripMarkdown(headers[c] || ""));
        // Só a primeira linha era desenhada: um título de coluna que quebrasse
        // perdia o resto em silêncio. Desenhamos as duas linhas que a faixa
        // comporta, subindo o texto para mantê-lo centrado.
        const lines = this.doc.splitTextToSize(cellText, colWidths[c] - 6).slice(0, 2);
        const y0 = lines.length > 1 ? atY + 4.4 : atY + 6.5;
        for (let l = 0; l < lines.length; l++) {
          this.doc.text(lines[l], hx + 4, y0 + l * 3.6);
        }
        hx += colWidths[c];
      }
      return atY + headerH;
    };

    currentY = drawHeader(currentY);

    // ── Rows ──
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const rowH = rowHeights[r];

      // Page break check
      if (currentY + rowH > MAX_Y) {
        // Draw outer border for current page portion
        const partH = currentY - this.y;
        this.doc.setDrawColor(...COLOR.BORDER_TABLE);
        this.doc.setLineWidth(0.3);
        this.doc.rect(startX, this.y, CONTENT_W, partH);

        this.addPage();
        currentY = this.y;
        currentY = drawHeader(currentY);
      }

      // Row background
      this.doc.setFillColor(...(r % 2 === 0 ? COLOR.TABLE_ZEBRA : COLOR.TEXT_WHITE));
      this.doc.rect(startX, currentY, CONTENT_W, rowH, "F");

      // First column highlight
      this.doc.setFillColor(...COLOR.TABLE_FIRST_COL);
      this.doc.rect(startX, currentY, colWidths[0], rowH, "F");

      // Cell text
      let colX = startX;
      for (let c = 0; c < numCols; c++) {
        // Mesma quebra usada na pré-medição, para o texto desenhado nunca
        // divergir da altura reservada para ele.
        const lines = wrapCell(row[c] || "", colWidths[c] - cellPad);
        this.doc.setFontSize(bodySize);

        if (c === 0) {
          this.doc.setFont(FAMILIA, "bold");
          this.doc.setTextColor(...COLOR.PRIMARY);
        } else {
          this.doc.setFont(FAMILIA, "normal");
          this.doc.setTextColor(...COLOR.TEXT_BODY);
        }

        for (let l = 0; l < lines.length; l++) {
          this.doc.text(lines[l], colX + cellPad / 2, currentY + SP.TABLE_ROW_PAD + 3 + l * SP.TABLE_CELL_LINE);
        }
        colX += colWidths[c];
      }

      // Row bottom border
      this.doc.setDrawColor(...COLOR.BORDER_LIGHT);
      this.doc.setLineWidth(0.15);
      this.doc.line(startX, currentY + rowH, startX + CONTENT_W, currentY + rowH);

      currentY += rowH;
    }

    // Outer border
    const totalH = currentY - this.y;
    this.doc.setDrawColor(...COLOR.BORDER_TABLE);
    this.doc.setLineWidth(0.35);
    this.doc.roundedRect(startX, this.y, CONTENT_W, totalH, 1.5, 1.5);

    // Column separators
    let colX = startX;
    for (let c = 0; c < numCols - 1; c++) {
      colX += colWidths[c];
      this.doc.setDrawColor(...COLOR.BORDER_LIGHT);
      this.doc.setLineWidth(0.15);
      this.doc.line(colX, this.y + headerH, colX, this.y + totalH);
    }

    this.y = currentY + SP.SECTION_GAP;
  }

  /**
   * Tabelas largas (5+ colunas) renderizadas como blocos empilhados.
   *
   * Em retrato há 162 mm de largura. Cinco colunas de prosa deixam ~24 mm cada,
   * onde uma palavra como "compreensível" não cabe inteira em uma linha — o
   * jsPDF a parte no meio, e o resultado é ilegível. Era o que acontecia com a
   * rubrica do projeto final, exatamente o texto que o aluno mais precisa ler.
   *
   * Empilhar resolve porque troca o eixo que está faltando: cada linha vira um
   * bloco com a primeira coluna como título e as demais como pares
   * "cabeçalho: valor", cada um com a largura inteira da página. Perde-se a
   * comparação lado a lado; ganha-se poder ler.
   */
  renderTableAsBlocks(table: ParsedTable) {
    const { headers, rows } = table;
    const startX = MARGIN_LEFT;
    const labelW = 34;

    for (const row of rows) {
      const titulo = sanitizeText(stripMarkdown(row[0] || ""));
      // Pares a partir da 2ª coluna, ignorando células vazias.
      //
      // O RÓTULO TAMBÉM É TEXTO, E TEXTO QUEBRA
      //
      // Isto guardava o rótulo como string e, na hora de desenhar, jogava fora
      // tudo que não coubesse na primeira linha de 32 mm. Na apostila de estoque
      // de 23/08, "Valor Total de Venda (R$)" saiu "Valor Total de" seis vezes —
      // a tabela da Curva ABC inteira sem dizer de que valor estava falando.
      // Agora o rótulo é quebrado junto com o valor e desenhado por inteiro.
      const pares: Array<[string[], string[]]> = [];
      for (let c = 1; c < headers.length; c++) {
        const valor = sanitizeText(stripMarkdown(row[c] || ""));
        if (!valor) continue;
        this.doc.setFontSize(FONT.SMALL);
        // O rótulo é medido em negrito porque é assim que vai ser desenhado.
        this.doc.setFont(FAMILIA, "bold");
        const rotulo = this.doc.splitTextToSize(
          sanitizeText(stripMarkdown(headers[c] || "")),
          labelW - 2,
        );
        this.doc.setFont(FAMILIA, "normal");
        pares.push([rotulo, this.doc.splitTextToSize(valor, CONTENT_W - labelW - 10)]);
      }
      if (!titulo && !pares.length) continue;

      const alturaBloco = 9 +
        pares.reduce(
          (a, [rot, ls]) =>
            a + Math.max(5, Math.max(rot.length, ls.length) * SP.LINE_HEIGHT) + 2,
          0,
        ) + 5;
      // Um bloco nunca deve ser partido: é uma unidade de leitura.
      this.checkPage(Math.min(alturaBloco, MAX_Y - MARGIN_TOP));

      const topo = this.y;
      let y = topo + 6;

      // Título do bloco (o critério, no caso da rubrica).
      this.doc.setFont(FAMILIA, "bold");
      this.doc.setFontSize(FONT.H4);
      this.doc.setTextColor(...COLOR.PRIMARY);
      for (const l of this.doc.splitTextToSize(titulo, CONTENT_W - 14)) {
        this.doc.text(l, startX + 7, y);
        y += SP.LINE_HEIGHT;
      }
      y += 1.5;

      for (const [rotulo, linhas] of pares) {
        // Rótulo e valor descem em paralelo, cada um no seu ritmo; o par termina
        // na altura do mais alto dos dois.
        this.doc.setFont(FAMILIA, "bold");
        this.doc.setFontSize(FONT.SMALL);
        this.doc.setTextColor(...COLOR.TEXT_MUTED);
        let yRotulo = y;
        for (const l of rotulo) {
          this.doc.text(l, startX + 7, yRotulo);
          yRotulo += SP.LINE_HEIGHT;
        }

        this.doc.setFont(FAMILIA, "normal");
        this.doc.setTextColor(...COLOR.TEXT_BODY);
        let yValor = y;
        for (const l of linhas) {
          this.doc.text(l, startX + 7 + labelW, yValor);
          yValor += SP.LINE_HEIGHT;
        }

        y = Math.max(yRotulo, yValor, y + SP.LINE_HEIGHT) + 2;
      }

      // Faixa de destaque à esquerda, no lugar da grade.
      this.doc.setFillColor(...COLOR.ACCENT);
      this.doc.rect(startX, topo, 2.2, y - topo - 1, "F");
      this.doc.setDrawColor(...COLOR.BORDER_LIGHT);
      this.doc.setLineWidth(0.2);
      this.doc.line(startX, y - 1, startX + CONTENT_W, y - 1);

      this.y = y + 3;
    }
    this.y += SP.SECTION_GAP - 3;
  }

  // ── Module content processor ──────────────────────────────────────

  renderModuleContent(content: string) {
    const lines = content.split("\n");
    let i = 0;

    while (i < lines.length) {
      const trimmed = lines[i].trim();

      if (!trimmed) {
        this.y += 3;
        i++;
        continue;
      }

      // ── Fenced code block ── (preserve indentation; render monospace)
      if (trimmed.startsWith("```")) {
        const codeLines: string[] = [];
        let j = i + 1;
        while (j < lines.length && !lines[j].trim().startsWith("```")) {
          codeLines.push(lines[j]);
          j++;
        }
        this.renderCodeBlock(codeLines);
        i = j < lines.length ? j + 1 : j; // skip closing fence
        continue;
      }

      // ── Table detection ──
      if (trimmed.includes("|") && i + 1 < lines.length && lines[i + 1]?.includes("|")) {
        const { table, endIndex } = parseMarkdownTable(lines, i);
        if (table) {
          this.renderTable(table);
          i = endIndex + 1;
          continue;
        }
      }

      // ── Headings with cascade look-ahead ──
      const heading = getHeadingLevel(trimmed);
      if (heading > 0) {
        // CASCADE anti-orphan: walk forward through ALL consecutive following headings,
        // summing their heights, then add MIN_KEEP for the first prose block.
        // This ensures: if H2 is followed by H3 which is followed by prose, checkPage
        // for H2 accounts for H2+H3+MIN_KEEP total — so H2 never lands alone at the
        // bottom when H3 (which needs its own keepH) would immediately page-break.
        const MIN_KEEP = 20;
        let cascadeH = 0;
        let k = this.nextNonEmpty(lines, i + 1);
        while (k < lines.length) {
          const t2 = lines[k].trim();
          const lv2 = getHeadingLevel(t2);
          if (lv2 > 0) {
            const hFont2 = lv2 === 2 ? FONT.H2 : lv2 === 3 ? FONT.H3 : lv2 === 4 ? FONT.H4 : FONT.BODY;
            const hBefore2 = lv2 === 2 ? SP.BEFORE_H2 : lv2 === 3 ? SP.BEFORE_H3 : 6;
            const hAfter2 = lv2 === 2 ? SP.AFTER_H2 : lv2 === 3 ? SP.AFTER_H3 : 4;
            cascadeH += hBefore2 + hFont2 * 0.38 + hAfter2;
            k = this.nextNonEmpty(lines, k + 1);
          } else {
            cascadeH += MIN_KEEP; // first prose: add minimum body height
            break;
          }
        }
        if (cascadeH === 0) cascadeH = MIN_KEEP; // heading is last item in module
        this.renderHeading(trimmed, heading === 1 ? 2 : heading, cascadeH);
        i++;
        continue;
      }

      // ── Pedagogical blocks — collect label + body as one unit ──
      const blockType = detectPedagogicalBlock(trimmed);
      if (blockType) {
        const label = trimmed;
        const bodyLines: string[] = [];
        let j = i + 1;
        // Collect associated content lines until next heading, empty gap, or new block
        let emptyCount = 0;
        while (j < lines.length) {
          const t = lines[j].trim();
          if (!t) {
            emptyCount++;
            if (emptyCount >= 2) break; // Two blank lines = block separator
            j++;
            continue;
          }
          emptyCount = 0;
          if (getHeadingLevel(t) > 0) break;
          if (detectPedagogicalBlock(t)) break;
          if (t === "---" || t === "***" || t === "___") break;
          bodyLines.push(t);
          j++;
        }

        if (bodyLines.length > 0) {
          this.renderPedagogicalBox(label, bodyLines, blockType);
        } else {
          // No body found, render as styled paragraph
          this.renderParagraph(label);
        }
        i = j;
        continue;
      }

      // ── Blockquote ──
      if (trimmed.startsWith("> ")) {
        let quoteText = trimmed.replace(/^>\s*/, "");
        let j = i + 1;
        while (j < lines.length && lines[j]?.trim().startsWith("> ")) {
          quoteText += " " + lines[j].trim().replace(/^>\s*/, "");
          j++;
        }
        const bqH = this.estimateTextHeight(quoteText, FONT.SMALL, CONTENT_W - 16, 4.5) + 12;
        this.checkPage(bqH);
        this.renderBlockquote(quoteText);
        i = j;
        continue;
      }

      // ── Bullet list ──
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        this.renderBullet(trimmed);
        i++;
        continue;
      }

      // ── Numbered list ──
      if (/^\d+\.\s/.test(trimmed)) {
        this.renderBullet("- " + trimmed.replace(/^\d+\.\s*/, ""));
        i++;
        continue;
      }

      // ── Horizontal rule ──
      if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
        this.renderHorizontalRule();
        i++;
        continue;
      }

      // ── Regular paragraph ──
      this.renderParagraph(trimmed);
      i++;
    }
  }

  // ── Code block ────────────────────────────────────────────────────
  // Monospace, light box, indentation preserved. Page-break aware (re-draws the
  // box on each page). Code is NOT markdown-stripped — only emoji/encoding safe.
  renderCodeBlock(codeLines: string[]) {
    const fs = 9, lineH = 4.6, padV = 4, padH = 5;
    this.doc.setFont("courier", "normal");
    this.doc.setFontSize(fs);
    const innerW = CONTENT_W - padH * 2;
    const wrapped: string[] = [];
    for (const raw of codeLines) {
      // O bloco de código é o único lugar que NÃO usa EduSans: precisa de
      // monoespaçada, e a Courier é uma das fontes-padrão, presa ao Latin-1.
      // Então aqui a transliteração continua obrigatória mesmo com a fonte
      // ampla registrada — senão um "≥" dentro do código sairia como bytes
      // soltos, que é o defeito original vestido de outra roupa.
      const safe = transliterarSimbolos(sanitizeText(raw.replace(/\t/g, "    ")));
      const ws = this.doc.splitTextToSize(safe.length ? safe : " ", innerW);
      for (const ln of ws) wrapped.push(ln);
    }
    if (!wrapped.length) return;

    let idx = 0;
    while (idx < wrapped.length) {
      this.checkPage(lineH + padV * 2);
      const avail = MAX_Y - this.y;
      const canFit = Math.max(1, Math.floor((avail - padV * 2) / lineH));
      const chunk = wrapped.slice(idx, idx + canFit);
      const boxH = chunk.length * lineH + padV * 2;

      this.doc.setFillColor(...COLOR.BG_CODE);
      this.doc.setDrawColor(...COLOR.CODE_BORDER);
      this.doc.setLineWidth(0.2);
      this.doc.roundedRect(MARGIN_LEFT, this.y, CONTENT_W, boxH, 1.5, 1.5, "FD");

      this.doc.setFont("courier", "normal");
      this.doc.setFontSize(fs);
      this.doc.setTextColor(...COLOR.CODE_TEXT);
      let ty = this.y + padV + 3;
      for (const ln of chunk) { this.doc.text(ln, MARGIN_LEFT + padH, ty); ty += lineH; }

      this.y += boxH;
      idx += chunk.length;
      if (idx < wrapped.length) this.addPage();
    }
    this.y += SP.AFTER_PARAGRAPH;
    this.doc.setFont(FAMILIA, "normal");
    this.doc.setTextColor(...COLOR.TEXT_BODY);
  }

  output(): ArrayBuffer {
    return this.doc.output("arraybuffer");
  }
}

// ── Main handler ──────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Build marker — appears in the function logs on every invocation, so you can
  // confirm WHICH code is actually live after a deploy (the 403 fix included).
  console.log(`[export-pdf] BUILD=${EXPORT_PDF_BUILD} TESTING_MODE=${TESTING_MODE}`);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const { course_id } = await req.json();
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Check subscription
    const { data: sub } = await serviceClient
      .from("subscriptions")
      .select("plan")
      .eq("user_id", userId)
      .single();
    const plan = sub?.plan || "free";

    // TESTING_MODE bypass — keep in sync with generate-course / upload-course-source.
    // Without it the Pro gate below silently 403s PDF export during the test phase
    // (no real subscriptions), so "o PDF não é gerado" while PPTX/DOCX (ungated) work.
    if (!TESTING_MODE && plan !== "pro") {
      const { data: profile } = await serviceClient
        .from("profiles")
        .select("is_dev")
        .eq("user_id", userId)
        .maybeSingle();
      if (!profile?.is_dev) {
        return new Response(
          JSON.stringify({ error: "PDF export is available only on Pro plan." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Fetch course + modules
    const { data: course, error: courseErr } = await serviceClient
      .from("courses")
      .select("*")
      .eq("id", course_id)
      .eq("user_id", userId)
      .single();

    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: modulesRaw } = await serviceClient
      .from("course_modules")
      .select("*")
      .eq("course_id", course_id)
      .order("order_index");
    const modules: any[] = modulesRaw ?? [];

    // ── Generate PDF ──
    const pdf = new PdfRenderer();
    pdf.courseTitle = sanitizeText(course.title || "");

    // Metadados do arquivo. O campo Title vinha vazio, então o PDF aparecia
    // pelo nome do arquivo em gerenciadores, bibliotecas e na aba do navegador.
    try {
      pdf.doc.setProperties({
        title: sanitizeText(course.title || "Curso"),
        subject: sanitizeText(course.description || ""),
        creator: "EduGen",
        author: "EduGen",
      });
    } catch {
      // Metadado é cosmético; não pode custar a exportação.
    }

    // Capa escolhida pelo autor. Falhar aqui não pode custar a apostila.
    let capaBytes: Uint8Array | undefined;
    if (course.cover_image_url) {
      try {
        const capaRes = await fetch(course.cover_image_url);
        if (capaRes.ok) capaBytes = new Uint8Array(await capaRes.arrayBuffer());
        else console.error(`[export-pdf] capa respondeu ${capaRes.status}`);
      } catch (capaErr) {
        console.error("[export-pdf] erro ao buscar a capa:", capaErr);
      }
    }

    pdf.renderTitlePage(course.title, course.description, course.language, capaBytes);

    // Ilustrações dos módulos — a mesma tabela que o portal do aluno e o editor
    // já leem. Nenhuma exportação a lia: o autor gerava (e pagava) a imagem,
    // via na tela, e ela não saía na apostila.
    const imageByModuleId: Record<string, { url: string; alt_text: string | null }> = {};
    const moduleIds = modules.map((m) => m.id).filter(Boolean);
    if (moduleIds.length > 0) {
      const { data: imagesRaw, error: imgQueryErr } = await serviceClient
        .from("course_images")
        .select("module_id, url, alt_text")
        .in("module_id", moduleIds);
      if (imgQueryErr) {
        console.error("[export-pdf] falha ao consultar course_images:", imgQueryErr.message);
      }
      for (const img of imagesRaw ?? []) {
        if (img.module_id && img.url) imageByModuleId[img.module_id] = img;
      }
    }

    // Cada módulo com o conteúdo já limpo, para que o sumário e o laço adiante
    // enxerguem exatamente a mesma lista.
    const renderableModules = modules
      .map((mod) => ({
        mod,
        // Defensive: older courses stored a stray ```fence and a leading
        // "## <title>" that duplicates the title we just rendered.
        content: cleanModuleContent(mod.content || "", mod.title),
      }))
      .filter((m) => m.content || (m.mod.title || "").trim());

    // DEDUPE ENTRE MÓDULOS
    //
    // Cada módulo é escrito por uma invocação independente e nenhum sabe o que
    // os outros disseram, então todos reapresentam o conceito central antes de
    // usá-lo: o trio PPA/LDO/LOA saiu explicado por extenso três vezes, quase
    // com as mesmas frases. Aqui os módulos estão todos na mão, então dá para
    // trocar a repetição por uma remissão a quem explicou primeiro.
    //
    // Só a apostila é limpa. O texto gravado e a tela do curso seguem como
    // estão: dar memória à geração exigiria serializá-la, desfazendo a divisão
    // que impede o estouro de tempo da edge function.
    {
      const { modulos: semRepeticao, remocoes } = removerRepeticoes(
        renderableModules.map((m) => ({ titulo: m.mod.title || "", conteudo: m.content })),
      );
      if (remocoes.length) {
        renderableModules.forEach((m, i) => { m.content = semRepeticao[i].conteudo; });
        console.log(`[export-pdf] dedupe: ${remocoes.length} parágrafo(s) repetido(s) — ` +
          remocoes.map((r) => `M${r.modulo + 1}<-M${r.origem + 1} (${r.semelhanca})`).join(", "));
      }
    }

    // A apresentação do curso vem gravada dentro do primeiro módulo (o gerador
    // a prepende lá). Sem separar, o leitor abre em "MÓDULO 1 — <título>" e
    // encontra cinco páginas de folheto antes da primeira lição.
    let apresentacao: string | null = null;
    if (renderableModules.length > 0) {
      const separado = splitCourseOverview(renderableModules[0].content);
      if (separado.apresentacao) {
        apresentacao = separado.apresentacao;
        renderableModules[0].content = cleanModuleContent(
          separado.modulo,
          renderableModules[0].mod.title,
        );
      }
    }

    // O sumário é desenhado antes dos módulos, com "..." no lugar do número de
    // página; finalizeTOC volta e preenche. Só faz sentido com mais de um módulo.
    if (renderableModules.length > 1) {
      pdf.renderTOCPage(renderableModules.map((m) => m.mod.title || ""));
    }

    if (apresentacao) {
      pdf.moduleIndex = 0;
      pdf.renderModuleTitle("Apresentação do curso");
      pdf.renderModuleContent(apresentacao);
    }

    const moduleStartPages: number[] = [];
    let moduleNum = 0;
    for (const { mod, content } of renderableModules) {
      moduleNum++;
      pdf.moduleIndex = moduleNum;
      pdf.renderModuleTitle(mod.title);
      moduleStartPages.push(pdf.pageNum);

      const img = imageByModuleId[mod.id];
      if (img?.url) {
        try {
          const imgRes = await fetch(img.url);
          if (imgRes.ok) {
            pdf.renderModuleImage(
              new Uint8Array(await imgRes.arrayBuffer()),
              img.alt_text || undefined,
            );
          } else {
            console.error(
              `[export-pdf] imagem do módulo ${mod.id} respondeu ${imgRes.status}`,
            );
          }
        } catch (imgFetchErr) {
          console.error(`[export-pdf] erro ao buscar imagem do módulo ${mod.id}:`, imgFetchErr);
        }
      }

      if (content) {
        pdf.renderModuleContent(content);
      }
    }

    pdf.finalizeTOC(moduleStartPages);

    const pdfBytes = pdf.output();
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = `${userId}/${safeName} - PDF - ${dateStr}.pdf`;

    // Upload to storage
    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(fileName, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) throw uploadErr;

    // Create signed URL (1 hour)
    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);

    if (signErr) throw signErr;

    // Log usage event
    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_EXPORTED_PDF",
      metadata: { course_id },
    });

    return new Response(JSON.stringify({ url: signedUrl.signedUrl }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Export PDF error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
