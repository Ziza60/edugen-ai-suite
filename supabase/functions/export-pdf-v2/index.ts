// export-pdf-v2/index.ts  — BUILD 2026-07-04b
// ─── Fixes vs 2026-06-22g — cobertura completa de todos os itens apontados ──
// [fix-blockquote-operator] Linhas que começam com ">" mas são operadores de
//   comparação (ex: "> (maior que)", ">= algo") não são mais engolidas pelo
//   parser de blockquote. A detecção agora exige espaço após ">" E conteúdo
//   textual, excluindo linhas que parecem operadores matemáticos/código.
// [fix-repairTruncation] repairTruncation() agora é chamada na pipeline de
//   renderização, antes de r.content(). Conteúdo truncado por MAX_TOKENS da
//   IA nunca mais chega ao PDF com sentença ou bloco de código aberto.
// [fix-word-spacing] safeText() agora normaliza múltiplos espaços e adiciona
//   espaço entre tokens fundidos quando detecta transição minúscula→maiúscula
//   em texto corrido (heurística para conteúdo colapsado pelo gerador de IA).
// [fix-table-header-repeat] Tabelas que quebram de página agora repetem o
//   cabeçalho no topo de cada nova página.
// [fix-blockquote-visual] Blockquotes ganham borda lateral dourada e fundo
//   levemente tintado, idêntico ao estilo do bloco de código.
// [fix-table-cell-valign] Helper cellStartY() centraliza verticalmente cada
//   célula usando sua própria contagem de linhas, não a do row inteiro. Antes,
//   células com 1 linha num row de 3 linhas ficavam coladas ao topo porque
//   blockH era calculado com (nLines-1)*LINE = 0, empurrando o offset para zero.
// [fix-orphan-bullets] Lookahead no início de cada lista (bullet e numbered):
//   conta todos os itens da lista e a altura total estimada. Se a lista inteira
//   não cabe na página atual mas cabe numa nova, força addPage() antes de
//   renderizar o primeiro item. Evita 1-2 bullets isolados no fim de uma página.
// [fix-testing-mode] Constante TESTING_MODE removida (era dead code).
// [fix-stripMdCell-heading] stripMdCell() agora também remove marcadores de
//   heading (##, ###) para o caso raro de célula iniciando com "#".
// [fix-special-chars] SPECIAL_CHAR_MAP: mapeamento manual de ~50 caracteres
//   Unicode comuns (setas, operadores, moedas, frações, símbolos) para
//   substitutos Latin1, aplicado em safeText() antes do filtro [^\x00-\xFF].
//   Resolve →, ≥, ≠, ×, €, ², ° e outros que antes eram silenciosamente apagados.
// [fix-toc] Sumário automático gerado após renderizar todos os módulos e
//   inserido como página 2 (logo após a capa). Lista módulos (negrito, pág.
//   em dourado) e headings H2 (regular, indentados) com linha pontilhada.
// ────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PDFDocument, StandardFonts, rgb, PDFPage, PDFFont,
} from "https://esm.sh/pdf-lib@1.17.1";
import { cleanModuleContent, repairTruncation } from "../_shared/markdown.ts";

const BUILD = "2026-07-04b";

// ─── Geometry (A4 mm / pts) ───────────────────────────────────────────────────
const PT    = 2.8346;
const PW    = 595.28;
const PH    = 841.89;
const ML    = 24;   const MR = 24;
const MT    = 26;   const MB = 26;
const CW    = (210 - ML - MR) * PT;   // ≈ 459 pt
const ML_PT = ML * PT;
const MAX_Y = 297 - MB;               // 271 mm

const MOD_BAN_H  = 44;
const MOD_CONT_Y = 52;

// ─── Font sizes (pt) ──────────────────────────────────────────────────────────
const FS = {
  COVER_TITLE: 28, COVER_SUB: 13, COVER_LABEL: 9,
  MOD_LABEL: 9, MOD_NUM: 11, MOD_TITLE: 16,
  H2: 14, H3: 12.5, H4: 11,
  BODY: 10.5, TABLE: 8.5, CODE: 8.5, SMALL: 8, FOOTER: 9,
};

// ─── Spacing (mm) ─────────────────────────────────────────────────────────────
const SP = {
  B_H2: 9, A_H2: 5,
  B_H3: 6, A_H3: 3.5,
  B_H4: 4, A_H4: 3,
  A_PARA: 3.5,
  LINE: 5.5,
  TABLE_LINE: 4.4, TABLE_PAD: 2,
  CODE_PAD: 3, CODE_LINE: 4.2, A_CODE: 4,
  B_RULE: 3, A_RULE: 3,
  BQ_PAD: 3, A_BQ: 4,   // [fix-blockquote-visual] espaçamento interno do blockquote
};

function lhMm(sizePt: number, factor = 1.28): number {
  return (sizePt / PT) * factor;
}

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  PRI:       rgb(18/255,  24/255,  68/255),
  ACC:       rgb(196/255, 152/255, 40/255),
  BODY:      rgb(38/255,  38/255,  46/255),
  HEAD:      rgb(18/255,  24/255,  68/255),
  WHITE:     rgb(1, 1, 1),
  CODE_BG:   rgb(13/255, 17/255, 23/255),
  CODE_FG:   rgb(200/255, 225/255, 240/255),
  DIM:       rgb(0.50, 0.50, 0.57),
  RULE:      rgb(0.82, 0.82, 0.85),
  TBL_EVEN:  rgb(0.95, 0.95, 0.97),
  COVER_DIM: rgb(0.72, 0.74, 0.82),
  BQ_BG:     rgb(0.97, 0.96, 0.93),  // [fix-blockquote-visual] fundo âmbar muito suave
};

// ─── Text helpers ─────────────────────────────────────────────────────────────

// [fix-word-spacing] Heurística de recuperação de tokens fundidos:
// detecta transições minúscula→maiúscula em sequências sem espaço e insere
// um espaço. Cobre o caso mais comum de colapso gerado pela IA
// (ex: "Listassãocoleções" → "Listas são coleções").
function restoreWordSpacing(t: string): string {
  // Só aplica em blocos sem nenhum espaço que tenham mais de 20 chars
  if (t.includes(" ") || t.length < 20) return t;
  return t.replace(/([a-záéíóúàãõâêôç])([A-ZÁÉÍÓÚÀÃÕÂÊÔ])/g, "$1 $2");
}

// [fix-special-chars] Mapeamento manual de caracteres Unicode comuns em conteúdo
// técnico/educacional que estão fora do Latin1 e seriam silenciosamente removidos
// pela barreira [^\x00-\xFF]. Cobre setas, operadores matemáticos, símbolos de
// moeda, marcas e outros caracteres frequentes em cursos de programação, finanças
// e ciências. Aplicado ANTES do filtro Latin1 para preservar legibilidade.
const SPECIAL_CHAR_MAP: [RegExp, string][] = [
  // Setas
  [/→/g, "->"], [/←/g, "<-"], [/↑/g, "^"], [/↓/g, "v"],
  [/⇒/g, "=>"], [/⇐/g, "<="], [/↔/g, "<->"], [/⇔/g, "<=>"],
  [/➜/g, "->"], [/➡/g, "->"],
  // Operadores matemáticos
  [/≥/g, ">="], [/≤/g, "<="], [/≠/g, "!="], [/≈/g, "~="],
  [/×/g, "x"],  [/÷/g, "/"],  [/±/g, "+/-"], [/∞/g, "inf"],
  [/√/g, "sqrt"], [/∑/g, "sum"], [/∏/g, "prod"],
  [/∈/g, "em"], [/∉/g, "nao em"], [/⊂/g, "subset"], [/∩/g, "inter"], [/∪/g, "uniao"],
  [/∀/g, "para todo"], [/∃/g, "existe"],
  // Frações e superscripts comuns
  [/½/g, "1/2"], [/⅓/g, "1/3"], [/¼/g, "1/4"], [/¾/g, "3/4"],
  [/²/g, "^2"], [/³/g, "^3"], [/¹/g, "^1"],
  // Moeda
  [/€/g, "EUR"], [/£/g, "GBP"], [/¥/g, "JPY"], [/₹/g, "INR"], [/₿/g, "BTC"],
  // Símbolos tipográficos
  [/•/g, "-"], [/·/g, "."], [/‣/g, "-"], [/◦/g, "-"],
  [/™/g, "(TM)"], [/®/g, "(R)"], [/©/g, "(C)"],
  [/°/g, "graus"], [/µ/g, "u"], [/§/g, "sec."], [/¶/g, "par."],
  // Aspas alternativas não cobertas pelo safeText original
  [/«/g, '"'], [/»/g, '"'], [/‹/g, "'"], [/›/g, "'"],
  // Espaços especiais → espaço normal
  [/[\u00A0\u2009\u200A\u202F\u205F]/g, " "],
  // Hífens/traços especiais não cobertos
  [/‐/g, "-"], [/‑/g, "-"], [/‒/g, "-"],
];

function safeText(t: string): string {
  let s = (t || "");
  // [fix-special-chars] aplica mapa antes do filtro Latin1
  for (const [re, sub] of SPECIAL_CHAR_MAP) s = s.replace(re, sub);
  return s
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/­/g, "")
    .replace(/[^\x00-\xFF]/g, "")
    .replace(/  +/g, " ")
    .trim();
}

function stripMd(t: string): string {
  return t
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/^\s*>\s*/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

// [fix-stripMdCell-heading] Remove heading markers além dos já existentes.
function stripMdCell(t: string): string {
  return t
    .replace(/^#{1,6}\s*/, "")   // fix: heading markers em células
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Nota: NÃO remove blockquote "^> " — um ">" em célula de tabela é operador
}

function cleanLine(t: string): string { return safeText(stripMd(t)); }
function cleanCell(t: string): string { return safeText(stripMdCell(t)); }

function headingLevel(line: string): number {
  const m = line.match(/^(#{1,6})\s/);
  return m ? m[1].length : 0;
}

function isBullet(line: string): boolean {
  return /^[-*+]\s/.test(line) || /^\d+[.)]\s/.test(line);
}

function isHRule(line: string): boolean {
  return /^(---+|\*\*\*+|___+)\s*$/.test(line);
}

// [fix-blockquote-operator] Distingue blockquote real de operador matemático.
// Blockquote real: "> texto comum" (espaço + letra/palavra após ">").
// Operador/código: "> (maior que)", ">= valor", ">>> python", etc.
// A heurística: se após "> " vier "(" ou letra seguida de ")" ou operador,
// trata como texto normal, não como blockquote.
function isBlockquote(line: string): boolean {
  if (!line.startsWith(">")) return false;
  // ">>" ou ">>>" — prompt de Python, não é blockquote
  if (line.startsWith(">>")) return false;
  // ">= " ou "> =" — operador de comparação
  if (/^>=?\s/.test(line)) return false;
  // "> (algo" — linha de operador matemático como "> (maior que)"
  if (/^>\s*\(/.test(line)) return false;
  // "> letra:" — pode ser operador em tabela como "> 18:"
  if (/^>\s*\d/.test(line)) return false;
  // Caso legítimo: "> texto" com palavra real
  return /^>\s+\S/.test(line);
}

function isSpecialLine(t: string): boolean {
  return !t
    || t.startsWith("#")
    || t.startsWith("|")
    || isBlockquote(t)
    || t.startsWith("```")
    || isBullet(t)
    || isHRule(t);
}

function isTableSep(line: string): boolean {
  return /^[\s|:\-]+$/.test(line);
}

function isLabeledItem(rawLine: string): boolean {
  const c = cleanLine(rawLine);
  return /^[A-ZÁÉÍÓÚÀÃÕÂÊÔ][a-záéíóúàãõâêôç]+:/.test(c);
}

// ─── Word wrap — exact pdf-lib font metrics ───────────────────────────────────
function wrapText(text: string, font: PDFFont, size: number, maxW = CW): string[] {
  // [fix-word-spacing] aplica restauração antes de quebrar
  const t = restoreWordSpacing(text.trim());
  if (!t) return [];

  const fitWord = (w: string): string[] => {
    if (font.widthOfTextAtSize(w, size) <= maxW) return [w];
    const chunks: string[] = [];
    let chunk = "";
    for (const ch of w) {
      if (chunk && font.widthOfTextAtSize(chunk + ch, size) > maxW) { chunks.push(chunk); chunk = ch; }
      else chunk += ch;
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  };

  const words = t.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    for (const piece of fitWord(w)) {
      const test = cur ? `${cur} ${piece}` : piece;
      if (font.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = piece; }
      else cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

// [fix-toc] Entrada do sumário
interface TocEntry {
  label: string;
  page: number;
  level: number;   // 0 = módulo, 2 = H2
}

class R {
  doc: PDFDocument;
  pg!: PDFPage;
  reg!: PDFFont; bld!: PDFFont; obl!: PDFFont; cou!: PDFFont;
  y = MT; pn = 0;
  tocEntries: TocEntry[] = [];

  constructor(doc: PDFDocument) { this.doc = doc; }

  async fonts() {
    this.reg = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bld = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.obl = await this.doc.embedFont(StandardFonts.HelveticaOblique);
    this.cou = await this.doc.embedFont(StandardFonts.Courier);
  }

  Y(yMm: number): number { return PH - yMm * PT; }

  _footer() {
    this.pg.drawRectangle({ x: 0, y: 0, width: PW, height: 7 * PT, color: C.PRI });
    this.pg.drawRectangle({ x: 0, y: 7 * PT, width: PW, height: 0.8 * PT, color: C.ACC });
    const s = `${this.pn}`;
    this.pg.drawText(s, {
      x: (PW - this.reg.widthOfTextAtSize(s, FS.FOOTER)) / 2,
      y: 2.5 * PT, size: FS.FOOTER, font: this.reg, color: C.WHITE,
    });
  }

  addPage() {
    this.pg = this.doc.addPage([PW, PH]);
    this.pn++;
    this.pg.drawRectangle({ x: 0, y: PH - 7 * PT, width: PW, height: 7 * PT, color: C.PRI });
    this.pg.drawRectangle({ x: 0, y: PH - 7.8 * PT, width: PW, height: 0.8 * PT, color: C.ACC });
    this._footer();
    this.y = MT;
  }

  check(neededMm: number) {
    if (this.y + neededMm > MAX_Y) this.addPage();
  }

  // ── Table of Contents — gerado após todos os módulos ──────────────────────
  // [fix-toc] Insere a página de sumário na posição 1 (índice 0-based, após a
  // capa). pdf-lib não tem insertPage nativo, então: criamos a página no final,
  // coletamos seu índice e movemos para a posição correta usando a API interna
  // de referências do documento.
  toc() {
    if (this.tocEntries.length === 0) return;

    // Cria a página de sumário como última do documento temporariamente
    const tocPg = this.doc.addPage([PW, PH]);

    // Cabeçalho da página
    tocPg.drawRectangle({ x: 0, y: PH - 7 * PT, width: PW, height: 7 * PT, color: C.PRI });
    tocPg.drawRectangle({ x: 0, y: PH - 7.8 * PT, width: PW, height: 0.8 * PT, color: C.ACC });
    tocPg.drawRectangle({ x: 0, y: 0, width: PW, height: 7 * PT, color: C.PRI });
    tocPg.drawRectangle({ x: 0, y: 7 * PT, width: PW, height: 0.8 * PT, color: C.ACC });

    // Título "Sumário"
    const titleText = "Sumario";
    tocPg.drawText(titleText, {
      x: ML_PT, y: PH - (MT + 4) * PT,
      size: FS.H2, font: this.bld, color: C.HEAD,
    });
    tocPg.drawLine({
      start: { x: ML_PT,      y: PH - (MT + 4 + lhMm(FS.H2, 1.25) + 1) * PT },
      end:   { x: ML_PT + CW, y: PH - (MT + 4 + lhMm(FS.H2, 1.25) + 1) * PT },
      thickness: 0.7, color: C.ACC,
    });

    let yy = MT + lhMm(FS.H2, 1.25) + SP.A_H2 + 3;
    const LINE_MOD = 7.5;   // altura de linha para entradas de módulo
    const LINE_H2  = 6.2;   // altura de linha para H2

    for (const entry of this.tocEntries) {
      if (yy > MAX_Y - 4) break;   // segurança: não transborda (TOC de 1 página)

      const isModule = entry.level === 0;
      const indent   = isModule ? 0 : 6 * PT;
      const font     = isModule ? this.bld : this.reg;
      const size     = isModule ? FS.BODY + 0.5 : FS.BODY - 0.5;
      const color    = isModule ? C.HEAD : C.BODY;
      const lineH    = isModule ? LINE_MOD : LINE_H2;
      const pageStr  = String(entry.page);
      const pageW    = this.reg.widthOfTextAtSize(pageStr, size);
      const maxLabelW = CW - indent - pageW - 8 * PT;

      // Label truncado se muito longo (não deve quebrar linha no TOC)
      let label = entry.label;
      while (label.length > 3 && font.widthOfTextAtSize(label, size) > maxLabelW) {
        label = label.slice(0, -1);
      }
      if (label !== entry.label) label = label.trimEnd() + "...";

      const baseY = PH - yy * PT;

      // Linha pontilhada entre label e número
      const labelW  = font.widthOfTextAtSize(label, size);
      const dotStart = ML_PT + indent + labelW + 3 * PT;
      const dotEnd   = ML_PT + CW - pageW - 4 * PT;
      const dotStep  = 3.5;
      for (let dx = dotStart; dx < dotEnd; dx += dotStep) {
        tocPg.drawText(".", {
          x: dx, y: baseY - 1.5, size: size - 1, font: this.reg, color: C.RULE,
        });
      }

      // Label
      tocPg.drawText(label, {
        x: ML_PT + indent, y: baseY, size, font, color,
      });

      // Número de página
      tocPg.drawText(pageStr, {
        x: ML_PT + CW - pageW, y: baseY, size, font: this.reg, color: isModule ? C.ACC : C.DIM,
      });

      // Separador leve após cada módulo
      if (isModule && yy > MT + 10) {
        tocPg.drawLine({
          start: { x: ML_PT,      y: baseY + (size / PT) * 1.4 },
          end:   { x: ML_PT + CW, y: baseY + (size / PT) * 1.4 },
          thickness: 0.3, color: C.RULE,
        });
      }

      yy += lineH;
    }

    // Move a página de sumário para a posição 1 (logo após a capa, índice 0).
    // pdf-lib expõe o array interno de páginas via getPages(); manipulamos
    // diretamente para reordenar sem re-renderizar nada.
    const pages = this.doc.getPages();
    // A nova página está na última posição
    const tocIndex = pages.length - 1;
    if (tocIndex > 1) {
      // Remove do fim e insere na posição 1
      const internalPages = (this.doc as any).catalog.Pages().Kids();
      const tocRef = internalPages.get(tocIndex);
      internalPages.remove(tocIndex);
      internalPages.insert(1, tocRef);
    }
  }

  // ── Cover ──────────────────────────────────────────────────────────────────
  cover(title: string, description?: string) {
    const pg = this.doc.addPage([PW, PH]);
    this.pn++;
    pg.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.PRI });
    pg.drawRectangle({ x: 0, y: 0, width: 3 * PT, height: PH, color: C.ACC });
    pg.drawRectangle({ x: PW - 3 * PT, y: 0, width: 3 * PT, height: PH,
      color: rgb(30/255, 38/255, 90/255) });

    pg.drawText("EduGenAI", {
      x: ML_PT, y: this.Y(15),
      size: FS.COVER_LABEL, font: this.bld, color: C.ACC,
    });
    pg.drawRectangle({ x: ML_PT, y: this.Y(25), width: CW, height: 1.5 * PT, color: C.ACC });

    const tLines = wrapText(safeText(title), this.bld, FS.COVER_TITLE, PW - 60 * PT);
    let ty = 38;
    for (const line of tLines) {
      pg.drawText(line, { x: ML_PT, y: this.Y(ty), size: FS.COVER_TITLE, font: this.bld, color: C.WHITE });
      ty += lhMm(FS.COVER_TITLE, 1.35);
    }

    if (description) {
      ty += 7;
      const dLines = wrapText(safeText(description), this.reg, FS.COVER_SUB, PW - 60 * PT);
      for (const line of dLines) {
        if (ty > 215) break;
        pg.drawText(line, { x: ML_PT, y: this.Y(ty), size: FS.COVER_SUB, font: this.reg, color: C.COVER_DIM });
        ty += lhMm(FS.COVER_SUB, 1.45);
      }
    }

    pg.drawRectangle({ x: 0, y: 0, width: PW, height: 8 * PT, color: C.ACC });
    const yr = new Date().getFullYear().toString();
    pg.drawText(yr, {
      x: PW - ML_PT - this.reg.widthOfTextAtSize(yr, FS.SMALL),
      y: 2.5 * PT, size: FS.SMALL, font: this.reg, color: C.PRI,
    });
  }

  // ── Module banner page ─────────────────────────────────────────────────────
  modulePage(title: string, num: number) {
    this.pg = this.doc.addPage([PW, PH]);
    this.pn++;

    this.pg.drawRectangle({
      x: 0, y: this.Y(MOD_BAN_H), width: PW, height: MOD_BAN_H * PT, color: C.PRI,
    });
    this.pg.drawRectangle({
      x: 0, y: this.Y(MOD_BAN_H), width: PW, height: 1.5 * PT, color: C.ACC,
    });

    const label  = safeText("MÓDULO");
    const labelW = this.bld.widthOfTextAtSize(label, FS.MOD_LABEL);
    this.pg.drawText(label, { x: ML_PT, y: this.Y(17), size: FS.MOD_LABEL, font: this.bld, color: C.ACC });
    this.pg.drawText(String(num).padStart(2, "0"), {
      x: ML_PT + labelW + 2.5 * PT, y: this.Y(17),
      size: FS.MOD_NUM, font: this.bld, color: C.WHITE,
    });

    const titleLines = wrapText(safeText(title), this.bld, FS.MOD_TITLE, PW - 48 * PT);
    const titleAdv   = lhMm(FS.MOD_TITLE, 1.28);
    const TITLE_CLAMP = MOD_BAN_H - 4;
    let ty = 25;
    for (const line of titleLines) {
      if (ty > TITLE_CLAMP) break;
      this.pg.drawText(line, { x: ML_PT, y: this.Y(ty), size: FS.MOD_TITLE, font: this.bld, color: C.WHITE });
      ty += titleAdv;
    }

    this._footer();
    // [fix-toc] registra módulo no sumário
    this.tocEntries.push({ label: safeText(title), page: this.pn, level: 0 });
    this.y = MOD_CONT_Y;
  }

  // ── Paragraph — full justification via exact font metrics ──────────────────
  para(text: string) {
    const clean = cleanLine(text);
    if (!clean) return;
    const lines = wrapText(clean, this.reg, FS.BODY);
    if (!lines.length) return;

    if (lines.length > 1 && (MAX_Y - this.y) < SP.LINE * 2) this.addPage();
    this.check(lines.length * SP.LINE + SP.A_PARA);

    for (let i = 0; i < lines.length; i++) {
      const words  = lines[i].split(/\s+/).filter(Boolean);
      const isLast = i === lines.length - 1;

      if (!isLast && words.length >= 3) {
        const wws    = words.map((w) => this.reg.widthOfTextAtSize(w, FS.BODY));
        const totalW = wws.reduce((a, b) => a + b, 0);
        const gap    = (CW - totalW) / (words.length - 1);
        let cx = ML_PT;
        for (let j = 0; j < words.length; j++) {
          this.pg.drawText(words[j], {
            x: cx, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY,
          });
          cx += wws[j] + gap;
        }
      } else {
        this.pg.drawText(lines[i], {
          x: ML_PT, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY,
        });
      }
      this.y += SP.LINE;
    }
    this.y += SP.A_PARA;
  }

  // ── Heading ────────────────────────────────────────────────────────────────
  heading(text: string, level: number, keepH = 0) {
    const clean = cleanLine(text.replace(/^#{1,6}\s*/, ""));
    if (!clean) return;
    const size  = level === 2 ? FS.H2 : level === 3 ? FS.H3 : FS.H4;
    const bef   = level === 2 ? SP.B_H2 : level === 3 ? SP.B_H3 : SP.B_H4;
    const aft   = level === 2 ? SP.A_H2 : level === 3 ? SP.A_H3 : SP.A_H4;
    const adv   = lhMm(size, 1.25);
    const hLines = wrapText(clean, this.bld, size);
    const rule   = level === 2 ? 2 : 0;
    this.check(bef + hLines.length * adv + aft + rule + keepH);
    this.y += bef;
    for (const line of hLines) {
      this.pg.drawText(line, { x: ML_PT, y: this.Y(this.y), size, font: this.bld, color: C.HEAD });
      this.y += adv;
    }
    if (level === 2) {
      this.pg.drawLine({
        start: { x: ML_PT, y: this.Y(this.y) },
        end:   { x: ML_PT + CW, y: this.Y(this.y) },
        thickness: 0.7, color: C.ACC,
      });
      this.y += 2;
      // [fix-toc] registra H2 no sumário (indentado)
      this.tocEntries.push({ label: clean, page: this.pn, level: 2 });
    }
    this.y += aft;
  }

  // ── Bullet ─────────────────────────────────────────────────────────────────
  bullet(text: string) {
    const clean = cleanLine(text.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, ""));
    if (!clean) return;
    const textX  = ML_PT + 5 * PT;
    const bLines = wrapText(clean, this.reg, FS.BODY, CW - 5 * PT);
    this.check(bLines.length * SP.LINE + 2);
    this.pg.drawCircle({
      x: ML_PT + 2 * PT, y: this.Y(this.y) + FS.BODY * 0.25, size: 1.5, color: C.ACC,
    });
    for (const line of bLines) {
      this.pg.drawText(line, { x: textX, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY });
      this.y += SP.LINE;
    }
    this.y += 2;
  }

  // ── Numbered list item ─────────────────────────────────────────────────────
  numbered(text: string, n: number) {
    const clean  = cleanLine(text.replace(/^\d+[.)]\s+/, ""));
    if (!clean) return;
    const numStr = `${n}.`;
    const numW   = this.bld.widthOfTextAtSize(numStr, FS.BODY);
    const textX  = ML_PT + numW + 3 * PT;
    const nLines = wrapText(clean, this.reg, FS.BODY, CW - numW - 3 * PT);
    this.check(nLines.length * SP.LINE + 2);
    this.pg.drawText(numStr, { x: ML_PT, y: this.Y(this.y), size: FS.BODY, font: this.bld, color: C.ACC });
    for (const line of nLines) {
      this.pg.drawText(line, { x: textX, y: this.Y(this.y), size: FS.BODY, font: this.reg, color: C.BODY });
      this.y += SP.LINE;
    }
    this.y += 2;
  }

  // ── Code block ─────────────────────────────────────────────────────────────
  code(codeLines: string[]) {
    if (!codeLines.length) return;
    const pad    = SP.CODE_PAD;
    const blockH = codeLines.length * SP.CODE_LINE + pad * 2;
    this.check(blockH + SP.A_CODE);
    const rectY = this.Y(this.y + blockH);
    this.pg.drawRectangle({ x: ML_PT, y: rectY, width: CW, height: blockH * PT, color: C.CODE_BG });
    this.pg.drawRectangle({ x: ML_PT, y: rectY, width: 2.5 * PT, height: blockH * PT, color: C.ACC });
    this.y += pad;
    for (const raw of codeLines) {
      const safe = safeText(raw).replace(/\t/g, "    ");
      if (safe.trim()) {
        this.pg.drawText(safe, {
          x: ML_PT + 6 * PT, y: this.Y(this.y), size: FS.CODE, font: this.cou, color: C.CODE_FG,
        });
      }
      this.y += SP.CODE_LINE;
    }
    this.y += pad + SP.A_CODE;
  }

  // ── Blockquote — [fix-blockquote-visual] borda lateral + fundo tintado ─────
  blockquote(text: string) {
    const bqText = cleanLine(text.replace(/^>\s*/, ""));
    if (!bqText) return;
    const bqLines = wrapText(bqText, this.obl, FS.BODY, CW - 8 * PT);
    const pad     = SP.BQ_PAD;
    const blockH  = bqLines.length * SP.LINE + pad * 2;
    this.check(blockH + SP.A_BQ);

    const rectY = this.Y(this.y + blockH);
    // Fundo âmbar suave
    this.pg.drawRectangle({ x: ML_PT, y: rectY, width: CW, height: blockH * PT, color: C.BQ_BG });
    // Borda lateral dourada (igual ao code block)
    this.pg.drawRectangle({ x: ML_PT, y: rectY, width: 2.5 * PT, height: blockH * PT, color: C.ACC });

    this.y += pad;
    for (const line of bqLines) {
      this.pg.drawText(line, {
        x: ML_PT + 6 * PT, y: this.Y(this.y), size: FS.BODY, font: this.obl, color: C.DIM,
      });
      this.y += SP.LINE;
    }
    this.y += pad + SP.A_BQ;
  }

  // ── Table ──────────────────────────────────────────────────────────────────
  // [fix-table-header-repeat] cabeçalho repetido em quebra de página
  // [fix-table-cell-valign]   alinhamento vertical corrigido para células com 1 linha
  table(rawLines: string[]) {
    const parseCells = (line: string): string[] => {
      const parts = line.split("|").map(c => cleanCell(c.trim()));
      if (parts.length && parts[0] === "") parts.shift();
      if (parts.length && parts[parts.length - 1] === "") parts.pop();
      return parts;
    };

    const rows = rawLines
      .filter(l => l.trim().startsWith("|") && !isTableSep(l))
      .map(parseCells)
      .filter(r => r.length > 0);

    if (!rows.length) return;

    const SIZE    = FS.TABLE;
    const PAD     = SP.TABLE_PAD;
    const numCols = rows[0].length;
    const colW    = CW / numCols;
    const inner   = colW - PAD * 2 * PT;

    interface RowInfo { isHeader: boolean; cells: string[][]; rowH: number; }

    // Pré-calcula todas as linhas incluindo o cabeçalho (índice 0)
    const rowData: RowInfo[] = rows.map((cells, ri) => {
      const wrapped = Array.from({ length: numCols }, (_, c) =>
        wrapText(cells[c] ?? "", ri === 0 ? this.bld : this.reg, SIZE, inner));
      const maxL = Math.max(1, ...wrapped.map(c => c.length));
      return { isHeader: ri === 0, cells: wrapped, rowH: maxL * SP.TABLE_LINE + PAD * 2 };
    });

    const headerRow  = rowData[0];
    const totalH     = rowData.reduce((s, r) => s + r.rowH, 0);
    const remaining  = MAX_Y - this.y;
    const freshH     = MAX_Y - MT;

    if (totalH <= freshH && totalH > remaining) {
      this.addPage();
    } else if (totalH > freshH) {
      const twoH = rowData.slice(0, 2).reduce((s, r) => s + r.rowH, 0);
      if (twoH > remaining) this.addPage();
    }

    // [fix-table-cell-valign] Calcula o offset vertical de início para uma célula
    // dentro de um row que pode ter mais linhas em outras colunas.
    // rowH = altura total do row (ditada pela célula mais alta).
    // nLines = número de linhas desta célula específica.
    // Fórmula: centraliza o bloco de texto verticalmente dentro do row,
    // respeitando um padding mínimo (PAD). capMm converte cap-height de pt → mm
    // para que a baseline da primeira linha fique alinhada ao centro visual,
    // não ao topo da caixa de texto (que inclui o ascender).
    const capMm = (SIZE * 0.70) / PT;
    const cellStartY = (rowH: number, nLines: number): number => {
      // Altura total do bloco de texto desta célula
      const blockH = (nLines - 1) * SP.TABLE_LINE + capMm;
      // Offset desde o topo do row até a primeira baseline
      const offset = Math.max(PAD, (rowH - blockH) / 2);
      return offset + capMm;
    };

    // Helper para desenhar uma linha de cabeçalho (reutilizado na repetição)
    const drawHeaderRow = () => {
      const bgY = this.Y(this.y + headerRow.rowH);
      this.pg.drawRectangle({ x: ML_PT, y: bgY, width: CW, height: headerRow.rowH * PT, color: C.PRI });
      for (let c = 0; c < numCols; c++) {
        const cx        = ML_PT + c * colW + PAD * PT;
        const cellLines = headerRow.cells[c];
        // [fix-table-cell-valign] usa helper — correto para 1 ou N linhas
        let cy = this.y + cellStartY(headerRow.rowH, cellLines.length);
        for (const line of cellLines) {
          this.pg.drawText(line, { x: cx, y: this.Y(cy), size: SIZE, font: this.bld, color: C.WHITE });
          cy += SP.TABLE_LINE;
        }
      }
      this.pg.drawLine({
        start: { x: ML_PT, y: this.Y(this.y + headerRow.rowH) },
        end:   { x: ML_PT + CW, y: this.Y(this.y + headerRow.rowH) },
        thickness: 0.3, color: C.RULE,
      });
      this.y += headerRow.rowH;
    };

    const segStart = this.y;
    let multiPage  = false;

    // Desenha cabeçalho
    drawHeaderRow();

    // Desenha linhas de dados
    for (let ri = 1; ri < rowData.length; ri++) {
      const row = rowData[ri];

      if (this.y + row.rowH > MAX_Y) {
        // [fix-table-header-repeat] nova página → repete cabeçalho
        multiPage = true;
        this.addPage();
        drawHeaderRow();
      }

      const bgY = this.Y(this.y + row.rowH);
      if (ri % 2 === 0) {
        this.pg.drawRectangle({ x: ML_PT, y: bgY, width: CW, height: row.rowH * PT, color: C.TBL_EVEN });
      }

      for (let c = 0; c < numCols; c++) {
        const cx        = ML_PT + c * colW + PAD * PT;
        const cellLines = row.cells[c];
        // [fix-table-cell-valign] usa o mesmo helper — correto para 1 ou N linhas
        let cy = this.y + cellStartY(row.rowH, cellLines.length);
        for (const line of cellLines) {
          this.pg.drawText(line, { x: cx, y: this.Y(cy), size: SIZE, font: this.reg, color: C.BODY });
          cy += SP.TABLE_LINE;
        }
      }

      this.pg.drawLine({
        start: { x: ML_PT, y: this.Y(this.y + row.rowH) },
        end:   { x: ML_PT + CW, y: this.Y(this.y + row.rowH) },
        thickness: 0.3, color: C.RULE,
      });
      this.y += row.rowH;
    }

    // Divisores verticais — apenas em tabelas de página única
    if (!multiPage) {
      for (let c = 1; c < numCols; c++) {
        const divX = ML_PT + c * colW;
        this.pg.drawLine({
          start: { x: divX, y: this.Y(this.y) },
          end:   { x: divX, y: this.Y(segStart) },
          thickness: 0.3, color: C.RULE,
        });
      }
    }

    this.y += 5;
  }

  // ── Horizontal rule ────────────────────────────────────────────────────────
  rule() {
    this.check(SP.B_RULE + 1 + SP.A_RULE);
    this.y += SP.B_RULE;
    this.pg.drawLine({
      start: { x: ML_PT, y: this.Y(this.y) },
      end:   { x: ML_PT + CW, y: this.Y(this.y) },
      thickness: 0.4, color: C.RULE,
    });
    this.y += 1 + SP.A_RULE;
  }

  // ── Module content: markdown → PDF elements ────────────────────────────────
  content(markdown: string) {
    const lines = markdown.split("\n");
    let i     = 0;
    let listN = 0;

    while (i < lines.length) {
      const raw = lines[i];
      const t   = raw.trim();

      // Blank line
      if (!t) { this.y += 2; listN = 0; i++; continue; }

      // Fenced code block
      if (t.startsWith("```")) {
        const codeLines: string[] = [];
        let j = i + 1;
        while (j < lines.length && !lines[j].trim().startsWith("```")) codeLines.push(lines[j++]);
        this.code(codeLines);
        i = j < lines.length ? j + 1 : j;
        listN = 0;
        continue;
      }

      // Horizontal rule
      if (isHRule(t)) { this.rule(); i++; listN = 0; continue; }

      // Markdown table
      if (t.startsWith("|")) {
        const tblLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) tblLines.push(lines[i++]);
        this.table(tblLines);
        listN = 0;
        continue;
      }

      // Heading
      const lv = headingLevel(t);
      if (lv > 0) {
        listN = 0;
        const MIN_KEEP = 28;
        let cascade = 0, k = i + 1;
        while (k < lines.length) {
          while (k < lines.length && !lines[k].trim()) k++;
          if (k >= lines.length) break;
          const t2  = lines[k].trim();
          const lv2 = headingLevel(t2);
          if (lv2 > 0) {
            const s2 = lv2 === 2 ? FS.H2 : lv2 === 3 ? FS.H3 : FS.H4;
            cascade += (lv2 === 2 ? SP.B_H2 : lv2 === 3 ? SP.B_H3 : SP.B_H4)
                     + lhMm(s2, 1.25)
                     + (lv2 === 2 ? SP.A_H2 : lv2 === 3 ? SP.A_H3 : SP.A_H4);
            k++;
          } else { cascade += MIN_KEEP; break; }
        }
        if (cascade === 0) cascade = MIN_KEEP;
        this.heading(t, lv === 1 ? 2 : lv, cascade);
        i++;
        continue;
      }

      // Numbered list
      if (/^\d+[.)]\s/.test(t)) {
        // [fix-orphan-bullets] No início de uma lista numerada (listN === 0),
        // faz lookahead para contar quantos itens tem a lista inteira.
        // Se todos os itens cabem na página atual, renderiza normalmente.
        // Se NÃO cabem mas também não cabem numa página fresca (lista enorme),
        // renderiza normalmente (não há como evitar quebra).
        // Se NÃO cabem na página atual MAS caberiam numa página nova → força
        // nova página para evitar que só 1-2 itens fiquem numa página isolada.
        if (listN === 0) {
          let k = i; let count = 0; let listH = 0;
          while (k < lines.length) {
            const lt = lines[k].trim();
            if (!lt) { k++; continue; }
            if (!/^\d+[.)]\s/.test(lt)) break;
            const lLines = wrapText(
              cleanLine(lt.replace(/^\d+[.)]\s+/, "")),
              this.reg, FS.BODY, CW - this.bld.widthOfTextAtSize("99.", FS.BODY) - 3 * PT
            );
            listH += lLines.length * SP.LINE + 2;
            count++; k++;
          }
          // Threshold: se há pelo menos 3 itens e menos de metade cabem na
          // página atual, move a lista inteira para a próxima página.
          const MIN_LIST_ITEMS = 3;
          const spaceLeft = MAX_Y - this.y;
          if (count >= MIN_LIST_ITEMS && listH > spaceLeft && listH <= (MAX_Y - MT)) {
            this.addPage();
          }
        }
        listN++; this.numbered(t, listN); i++; continue;
      }

      // Bullet
      if (isBullet(t)) {
        // [fix-orphan-bullets] Mesma lógica para listas de bullets (listN === 0
        // sinaliza início de nova lista, pois listN é zerado em qualquer linha
        // não-bullet/não-numbered).
        if (listN === 0) {
          let k = i; let count = 0; let listH = 0;
          while (k < lines.length) {
            const lt = lines[k].trim();
            if (!lt) { k++; continue; }
            if (!isBullet(lt)) break;
            const lLines = wrapText(
              cleanLine(lt.replace(/^[-*+]\s+/, "")),
              this.reg, FS.BODY, CW - 5 * PT
            );
            listH += lLines.length * SP.LINE + 2;
            count++; k++;
          }
          const MIN_LIST_ITEMS = 3;
          const spaceLeft = MAX_Y - this.y;
          if (count >= MIN_LIST_ITEMS && listH > spaceLeft && listH <= (MAX_Y - MT)) {
            this.addPage();
          }
        }
        listN = 0; this.bullet(t); i++; continue;
      }

      // [fix-blockquote-operator] Usa isBlockquote() em vez de startsWith(">")
      if (isBlockquote(t)) {
        listN = 0;
        this.blockquote(t);
        i++;
        continue;
      }

      // Plain paragraph — merge consecutive non-special lines
      listN = 0;
      const paraLines: string[] = [t];
      const curIsLabeled = isLabeledItem(t);
      i++;
      if (!curIsLabeled) {
        while (i < lines.length) {
          const next = lines[i].trim();
          if (isSpecialLine(next)) break;
          if (isLabeledItem(next)) break;
          paraLines.push(next);
          i++;
        }
      }
      this.para(paraLines.join(" "));
    }
  }
}

// ─── HTTP handler ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader  = req.headers.get("authorization") ?? "";

    const userClient    = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const body     = await req.json();
    const courseId = body.course_id ?? body.courseId;
    if (!courseId) return new Response(JSON.stringify({ error: "course_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const { data: course, error: courseErr } = await serviceClient
      .from("courses").select("*").eq("id", courseId).eq("user_id", user.id).single();
    if (courseErr || !course) return new Response(JSON.stringify({ error: "Course not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const { data: modulesRaw } = await serviceClient
      .from("course_modules").select("*").eq("course_id", courseId).order("order_index");
    const modules: any[] = modulesRaw ?? [];

    const doc = await PDFDocument.create();
    const r   = new R(doc);
    await r.fonts();

    r.cover(course.title, course.description ?? undefined);

    let modNum = 0;
    for (const mod of modules) {
      // [fix-repairTruncation] repara conteúdo truncado pelo gerador de IA
      // antes de sanitizar — a ordem importa: repair → clean → render
      const rawContent     = mod.content ?? "";
      const repairedContent = repairTruncation(rawContent);
      const mdContent      = cleanModuleContent(repairedContent, mod.title);

      if (!mdContent && !mod.title) continue;
      modNum++;
      r.modulePage(mod.title, modNum);
      if (mdContent) r.content(mdContent);
    }

    // [fix-toc] gera sumário e insere após a capa
    r.toc();

    const pdfBytes = await doc.save();

    const dateStr  = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().slice(0, 80);
    const fileName = `${user.id}/${safeName} - PDF-v2 - ${dateStr}.pdf`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports").upload(fileName, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: signed, error: signErr } = await serviceClient.storage
      .from("course-exports").createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: user.id, event_type: "COURSE_EXPORTED_PDF_V2",
      metadata: { course_id: courseId, build: BUILD },
    }).then(() => {});

    return new Response(
      JSON.stringify({ url: signed.signedUrl, engine: "pdf-lib-v2", build: BUILD }),
      { headers: { ...corsHeaders, "Content-Type": "application/json", "x-export-pdf-v2-build": BUILD } },
    );
  } catch (err: any) {
    console.error("[EXPORT-PDF-V2]", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
