// ═══════════════════════════════════════════════════════════════════════════
// EduGenAI — PPTX v7 "Adaptive Engine"  ·  render.ts
//
// A clean, modern, TOPIC-AGNOSTIC renderer. It consumes the normalized deck
// (validate.ts) and draws it. It knows nothing about subjects — only about
// layout, typography, colour and spacing. The PptxGenJS class is injected so
// this file runs both in Deno (edge function) and Node/Bun (tests).
// ═══════════════════════════════════════════════════════════════════════════

import type { PlannedDeck, SlideSpec } from "./deck-plan.ts";
import { autoBodyFontSize } from "./validate.ts";
import { coverBoxSize, imageSizeFromDataUri } from "../_shared/image-size.ts";
import { categoricalColors } from "./chart-palette.ts";
import { chevronNumberBox } from "./chevron-geometry.ts";
import { chevronCabe, ehSequencia, rotuloDoNucleo } from "./layout-fit.ts";

// ── Carimbo de build ─────────────────────────────────────────────────────────
// UM DECK TEM DE DIZER QUEM O FEZ
//
// Passei uma tarde sem conseguir responder a uma pergunta simples: o deck que
// chegou saiu do código novo ou do antigo? Um reparo verificado por teste não
// aparecia no arquivo gerado, e não havia como distinguir "o código está errado"
// de "o deploy não pegou" — as duas hipóteses explicavam o mesmo arquivo.
//
// Agora o build vai dentro do PPTX, no campo Company das propriedades (Arquivo →
// Informações → Propriedades). Não aparece em nenhum slide. Qualquer deck passa
// a responder sozinho de que versão veio — e um deck SEM o carimbo é, ele
// próprio, a resposta: veio de antes de 21/08.
//
// Bump this on every behavioural change to the engine.
export const V7_BUILD = "2026-08-22g-celula-cabe-na-coluna";

// ── Canvas (16:9 widescreen) ──
const W = 13.333;
const H = 7.5;
const ML = 0.7; // margin left
const MR = 0.7; // margin right
const CW = W - ML - MR; // content width
const HEADER_H = 1.35;
const CONTENT_Y = HEADER_H + 0.15;
const FOOTER_Y = 7.12;
const CONTENT_H = FOOTER_Y - CONTENT_Y - 0.12;

const FONT_TITLE = "Georgia";
const FONT_BODY = "Calibri";
const FONT_MONO = "Consolas";

export interface Palette {
  name: string;
  bg: string;
  surface: string;
  text: string;
  subtext: string;
  border: string;
  accent: string;
  accent2: string;
  coverBg: string;
  onAccent: string;
}

export const PALETTES: Record<string, Palette> = {
  default: {
    name: "default",
    bg: "FFFFFF",
    surface: "F4F6F9",
    text: "16202C",
    subtext: "5A6B7B",
    border: "DDE3EA",
    accent: "1E3A5F",
    accent2: "C47F17",
    coverBg: "0E1B2C",
    onAccent: "FFFFFF",
  },
  ocean: {
    name: "ocean",
    bg: "FFFFFF",
    surface: "EEF6FB",
    text: "0A1F2C",
    subtext: "4A6273",
    border: "D3E5EF",
    accent: "0369A1",
    accent2: "0891B2",
    coverBg: "04243A",
    onAccent: "FFFFFF",
  },
  forest: {
    name: "forest",
    bg: "FFFFFF",
    surface: "EEF6F0",
    text: "0C1F14",
    subtext: "47604F",
    border: "D2E6D8",
    accent: "15803D",
    accent2: "0D9488",
    coverBg: "08251A",
    onAccent: "FFFFFF",
  },
  violet: {
    name: "violet",
    bg: "FFFFFF",
    surface: "F3EFFB",
    text: "190F2C",
    subtext: "5C5274",
    border: "E2D9F2",
    accent: "6D28D9",
    accent2: "8B5CF6",
    coverBg: "150A28",
    onAccent: "FFFFFF",
  },
  sunset: {
    name: "sunset",
    bg: "FFFFFF",
    surface: "FBF1EC",
    text: "2A1208",
    subtext: "70544A",
    border: "F0DACE",
    accent: "DC2626",
    accent2: "EA580C",
    coverBg: "2A0A05",
    onAccent: "FFFFFF",
  },
  monochrome: {
    name: "monochrome",
    bg: "FFFFFF",
    surface: "F2F4F6",
    text: "1F2A33",
    subtext: "5A6B78",
    border: "DCE1E6",
    accent: "2C3E50",
    accent2: "64748B",
    coverBg: "1E2A35",
    onAccent: "FFFFFF",
  },
};

// ── Visual Templates (dark / premium) ──────────────────────────────────────
// Each template is a full dark palette: dark canvas, light text, subtle
// surface/border and a strong accent pair. Mirrors the 5 presets offered in
// the export dialog (PptxExportDialog VISUAL_TEMPLATES). Because every renderer
// only reads palette tokens (d.bg / d.text / d.surface / d.accent / …), making
// the canvas dark here turns the WHOLE deck premium-dark with no per-slide code.
export const THEMES: Record<string, Palette> = {
  // Navy & Gold — corporate classic
  default_v5: {
    name: "default_v5",
    bg: "0A1628", surface: "152740", text: "F1F5F9", subtext: "AEC0D2",
    border: "263A54", accent: "2E6DA4", accent2: "D4A24C",
    coverBg: "071120", onAccent: "FFFFFF",
  },
  // Neon & Cyber — dark tech
  futuristic_background: {
    name: "futuristic_background",
    bg: "040D1C", surface: "0C1E36", text: "D6ECFF", subtext: "8FB4D6",
    border: "16314C", accent: "1E90E0", accent2: "27E0C6",
    coverBg: "020814", onAccent: "FFFFFF",
  },
  // Gold & Dark — elegant
  dark_theme: {
    name: "dark_theme",
    bg: "0D1117", surface: "171D26", text: "E6EDF3", subtext: "A2B0BE",
    border: "28323D", accent: "D9810A", accent2: "F0B23C",
    coverBg: "080B11", onAccent: "FFFFFF",
  },
  // Violet & Gold — premium luxury
  dark_elegance_xl: {
    name: "dark_elegance_xl",
    bg: "0B0912", surface: "171125", text: "ECE8F5", subtext: "B0A6C6",
    border: "2B2142", accent: "8B2FC9", accent2: "D4AF37",
    coverBg: "070510", onAccent: "FFFFFF",
  },
  // Red & Fire — bold
  dark_style_theme: {
    name: "dark_style_theme",
    bg: "0F1219", surface: "1B212B", text: "F0F4F8", subtext: "A8B4C2",
    border: "2C333E", accent: "D63B3B", accent2: "E8943A",
    coverBg: "0A0D13", onAccent: "FFFFFF",
  },
};

export interface RenderOptions {
  palette?: string;
  template?: string;
  footerBrand?: string;
  /** Output language — drives the localized course-closing slide. */
  language?: string;
}

type AnySlide = any;
type AnyPptx = any;

// ── small helpers ─────────────────────────────────────────────────────────
// Resolve the active palette from render options.
// - A visual template (always dark/premium) defines the whole look and wins.
//   When a non-"default" colour palette is also chosen, it recolours ONLY the
//   accent pair so users can retint a dark template.
// - Without a template (e.g. a direct API call) we fall back to the legacy
//   light palette selected by name.
function resolvePalette(opts: RenderOptions): Palette {
  const theme = opts.template ? THEMES[opts.template] : undefined;
  if (theme) {
    if (opts.palette && opts.palette !== "default" && PALETTES[opts.palette]) {
      const pal = PALETTES[opts.palette];
      return { ...theme, accent: pal.accent, accent2: pal.accent2 };
    }
    return theme;
  }
  return PALETTES[opts.palette ?? "default"] ?? PALETTES.default;
}

function bgFill(slide: AnySlide, color: string) {
  slide.background = { color };
}

function eyebrow(text: string): string {
  return text.toUpperCase();
}

/**
 * Type scale for the kicker (the small-caps module label above the title).
 *
 * A kicker is a LABEL, so it must never be truncated: a cut label reads as a
 * broken phrase ("…EM SITUAÇÕES DE ALTA"), not as an abbreviation. validate.ts
 * therefore lets kickers run to MAX_EYEBROW_CHARS, and we absorb the length
 * HERE by shrinking the type until it fits its box.
 *
 * Capacity model: uppercase Calibri advances ~0.62em per glyph, plus the
 * tracking (charSpacing, in points). 72pt per inch.
 */
function kickerFit(
  text: string,
  boxW: number,
  base = 10,
  spc = 2,
  lines = 1,
): { fontSize: number; charSpacing: number } {
  const capacityPt = boxW * 72 * lines;
  let fontSize = base;
  let charSpacing = spc;
  // Floor at 8pt: below that the label stops being legible on a projector, and
  // a slightly tight kicker still beats an amputated one.
  while (
    fontSize > 8 &&
    text.length * (fontSize * 0.62 + charSpacing) > capacityPt
  ) {
    fontSize -= 1;
    if (charSpacing > 1) charSpacing -= 0.5;
  }
  return { fontSize, charSpacing };
}

/**
 * Attach speaker notes. The deck carries ~10% of the course's words; the notes
 * are where the other 90% goes, so an instructor gets narration instead of 44
 * screens of fragments. Optional-chained because not every PptxGenJS build
 * exposes addNotes, and notes must never be able to fail an export.
 */
function speakerNotes(slide: AnySlide, s: SlideSpec) {
  const n = (s.notes ?? "").trim();
  if (!n) return;
  try {
    slide.addNotes?.(n);
  } catch (_e) {
    /* notes are additive — never fail the deck over them */
  }
}

/** Header band shared by all content slides. */
function header(slide: AnySlide, d: Palette, s: SlideSpec, moduleLabel: string) {
  // accent tick
  slide.addShape("rect", {
    x: ML,
    y: 0.55,
    w: 0.07,
    h: 0.5,
    fill: { color: d.accent2 },
    line: { type: "none" },
  });
  // Kicker (super-title). Drop it when it merely echoes the slide title — a
  // repeated super-title reads as a templating glitch, not a designed deck. The
  // module-context kicker (the moduleLabel fallback) is intentional and stays.
  const normLabel = (x: string) => x.trim().toLowerCase().replace(/\s+/g, " ");
  const kicker = (s.eyebrow || moduleLabel || "").trim();
  const showKicker = kicker.length > 0 && normLabel(kicker) !== normLabel(s.title);
  if (showKicker) {
    slide.addText(eyebrow(kicker), {
      x: ML + 0.18,
      y: 0.5,
      w: CW - 0.4,
      h: 0.28,
      fontFace: FONT_BODY,
      ...kickerFit(kicker, CW - 0.4, 10, 2),
      bold: true,
      color: d.accent2,
      align: "left",
      valign: "middle",
    });
  }
  slide.addText(s.title, {
    x: ML + 0.18,
    y: showKicker ? 0.78 : 0.5,
    w: CW - 0.4,
    h: showKicker ? 0.62 : 0.9,
    fontFace: FONT_TITLE,
    fontSize: s.title.length > 56 ? 22 : 26,
    bold: true,
    color: d.text,
    align: "left",
    valign: "middle",
  });
  slide.addShape("line", {
    x: ML,
    y: HEADER_H + 0.05,
    w: CW,
    h: 0,
    line: { color: d.border, width: 1 },
  });
}

function footer(slide: AnySlide, d: Palette, brand: string, num: number) {
  slide.addText(brand, {
    x: ML,
    y: FOOTER_Y,
    w: CW / 2,
    h: 0.3,
    fontFace: FONT_BODY,
    fontSize: 9,
    color: d.subtext,
    align: "left",
    valign: "middle",
  });
  slide.addText(String(num), {
    x: ML + CW / 2,
    y: FOOTER_Y,
    w: CW / 2,
    h: 0.3,
    fontFace: FONT_BODY,
    fontSize: 9,
    color: d.subtext,
    align: "right",
    valign: "middle",
  });
}

function maybeImage(slide: AnySlide, s: SlideSpec, box: {
  x: number;
  y: number;
  w: number;
  h: number;
}, extra: Record<string, unknown> = {}) {
  if (!s.imageData) return false;
  try {
    // `sizing: cover` recorta em vez de esticar — mas o pptxgenjs toma `w`/`h`
    // como sendo as dimensões DO ARQUIVO, não da caixa. Passando a caixa nos
    // dois lugares, a proporção declarada era a da caixa, o recorte calculado
    // dava zero e a imagem saía esticada: na faixa vertical da capa (4,93 x
    // 7,50 pol) uma imagem 16:9 chegava achatada quase 3x na horizontal.
    // Declaramos aqui a proporção verdadeira, lida do cabeçalho do binário.
    const natural = imageSizeFromDataUri(s.imageData);
    const proporcao = natural ? coverBoxSize(natural, box) : { w: box.w, h: box.h };
    slide.addImage({
      data: s.imageData,
      x: box.x,
      y: box.y,
      w: proporcao.w,
      h: proporcao.h,
      sizing: { type: "cover", w: box.w, h: box.h },
      ...extra,
    });
    return true;
  } catch {
    return false;
  }
}

// ── per-kind renderers ──────────────────────────────────────────────────────

function renderCover(slide: AnySlide, deck: PlannedDeck, d: Palette, brand: string) {
  bgFill(slide, d.coverBg);
  const hasImg = maybeImage(slide, { imageData: (deck as any).coverImage } as SlideSpec, {
    x: 8.4,
    y: 0,
    w: 4.93,
    h: H,
  });
  // overlay gradient strip for legibility when image present
  if (hasImg) {
    slide.addShape("rect", {
      x: 7.4,
      y: 0,
      w: 1.4,
      h: H,
      fill: { color: d.coverBg, transparency: 15 },
      line: { type: "none" },
    });
  }
  slide.addShape("rect", {
    x: ML,
    y: 2.55,
    w: 1.1,
    h: 0.09,
    fill: { color: d.accent2 },
    line: { type: "none" },
  });
  const tw = hasImg ? 6.6 : 11.0;
  // Tier the title size by length AND auto-shrink to fit its box, so a long
  // course title can't overflow into the subtitle (the cover-overlap bug).
  const tl = deck.courseTitle.length;
  const titleSize = tl > 72 ? 28 : tl > 56 ? 32 : tl > 40 ? 38 : 46;
  slide.addText(deck.courseTitle, {
    x: ML,
    y: 2.7,
    w: tw,
    h: 2.3,
    fontFace: FONT_TITLE,
    fontSize: titleSize,
    bold: true,
    color: "FFFFFF",
    align: "left",
    valign: "top",
    lineSpacingMultiple: 1.02,
    fit: "shrink",
  });
  if (deck.subtitle) {
    slide.addText(deck.subtitle, {
      x: ML,
      y: 5.15, // below the (taller) title box; boxes no longer overlap
      w: tw,
      h: 1.4,
      fontFace: FONT_BODY,
      fontSize: 15,
      color: "C9D4E0",
      align: "left",
      valign: "top",
      fit: "shrink",
    });
  }
  slide.addText(brand.toUpperCase(), {
    x: ML,
    y: 6.7,
    w: 6,
    h: 0.35,
    fontFace: FONT_BODY,
    fontSize: 11,
    bold: true,
    color: d.accent2,
    charSpacing: 3,
    align: "left",
  });
}

function renderTOC(slide: AnySlide, deck: PlannedDeck, d: Palette, brand: string) {
  bgFill(slide, d.bg);
  slide.addText("AGENDA", {
    x: ML,
    y: 0.7,
    w: CW,
    h: 0.4,
    fontFace: FONT_BODY,
    fontSize: 12,
    bold: true,
    color: d.accent2,
    charSpacing: 3,
  });
  slide.addText("Conteúdo do curso", {
    x: ML,
    y: 1.05,
    w: CW,
    h: 0.7,
    fontFace: FONT_TITLE,
    fontSize: 30,
    bold: true,
    color: d.text,
  });
  const mods = deck.modules.slice(0, 8);
  const colCount = mods.length > 4 ? 2 : 1;
  const perCol = Math.ceil(mods.length / colCount);
  const colW = colCount === 2 ? (CW - 0.5) / 2 : CW;
  const rowH = Math.min(0.92, (CONTENT_H - 0.6) / perCol);
  mods.forEach((m, i) => {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const x = ML + col * (colW + 0.5);
    const y = 2.1 + row * rowH;
    slide.addText(String(i + 1).padStart(2, "0"), {
      x,
      y,
      w: 0.7,
      h: rowH - 0.1,
      fontFace: FONT_TITLE,
      fontSize: 22,
      bold: true,
      color: d.accent2,
      valign: "middle",
    });
    slide.addText(m.title, {
      x: x + 0.75,
      y,
      w: colW - 0.8,
      h: rowH - 0.1,
      fontFace: FONT_BODY,
      fontSize: 15,
      color: d.text,
      valign: "middle",
    });
  });
  footer(slide, d, brand, 2);
}

function renderSection(
  slide: AnySlide,
  s: SlideSpec,
  d: Palette,
  index: number,
  objetivos: string[] = [],
) {
  bgFill(slide, d.coverBg);
  const numStr = String(index).padStart(2, "0");
  // Full-bleed photo (when available), dimmed for legibility — heavier scrim on
  // the left third where the text lives, lighter over the image on the right.
  const hasImg = maybeImage(slide, s, { x: 0, y: 0, w: W, h: H });
  if (hasImg) {
    slide.addShape("rect", {
      x: 0, y: 0, w: W, h: H,
      fill: { color: d.coverBg, transparency: 28 },
      line: { type: "none" },
    });
    slide.addShape("rect", {
      x: 0, y: 0, w: 8.2, h: H,
      fill: { color: d.coverBg, transparency: 6 },
      line: { type: "none" },
    });
  }
  // Eyebrow + GIANT module number (inverted colours, big type, little text).
  slide.addText("MÓDULO", {
    x: ML, y: 1.4, w: 7, h: 0.45,
    fontFace: FONT_BODY, fontSize: 15, bold: true,
    color: d.accent2, charSpacing: 5,
  });
  slide.addText(numStr, {
    x: ML - 0.08, y: 1.7, w: 6, h: 2.7,
    fontFace: FONT_TITLE, fontSize: 200, bold: true,
    color: d.accent2, transparency: 22, align: "left", valign: "middle",
  });
  slide.addShape("rect", {
    x: ML + 0.04, y: 4.5, w: 1.1, h: 0.09,
    fill: { color: d.accent2 }, line: { type: "none" },
  });
  // Com objetivos, o título divide a página com eles: título à esquerda,
  // objetivos à direita. Sem objetivos, o título ocupa a largura toda, como
  // sempre ocupou.
  const temObj = objetivos.length > 0 && !hasImg;
  slide.addText(s.title, {
    x: ML, y: 4.78, w: hasImg ? 7.9 : (temObj ? 6.4 : 11.4), h: 2.1,
    fontFace: FONT_TITLE, fontSize: s.title.length > 44 ? 32 : 42, bold: true,
    color: "FFFFFF", valign: "top", lineSpacingMultiple: 1.02,
  });
  if (!temObj) return;

  // OS OBJETIVOS DO MÓDULO, AQUI E NÃO NUM SLIDE PRÓPRIO
  //
  // Eram um slide inteiro logo depois desta divisória, com o título genérico
  // "Visão Geral do Módulo" repetido em todos os módulos. A informação é útil —
  // é o contrato da lição — mas não sustenta uma página sozinha, e a divisória
  // tinha metade da tela vazia. Ver objetivosParaDivisoria, em deck-plan.
  const colX = 7.5;
  slide.addText("NESTE MÓDULO", {
    x: colX, y: 1.55, w: 5.2, h: 0.4,
    fontFace: FONT_BODY, fontSize: 12, bold: true,
    color: d.accent2, charSpacing: 4,
  });
  slide.addShape("rect", {
    x: colX, y: 2.0, w: 0.9, h: 0.06,
    fill: { color: d.accent2 }, line: { type: "none" },
  });
  const linhaH = 0.62;
  objetivos.slice(0, 4).forEach((o, i) => {
    const y = 2.35 + i * linhaH;
    slide.addShape("ellipse", {
      x: colX, y: y + 0.16, w: 0.13, h: 0.13,
      fill: { color: d.accent2 }, line: { type: "none" },
    });
    slide.addText(o, {
      x: colX + 0.32, y, w: 5.0, h: linhaH,
      fontFace: FONT_BODY, fontSize: 13, color: "FFFFFF",
      valign: "top", lineSpacingMultiple: 1.04,
    });
  });
}

/**
 * Split layout: text column on the left, a photo "bleeding" off the right/top/
 * bottom edges. Used for one hero content slide per module, reusing the module's
 * already-resolved image (no extra fetches). Gracefully degrades: if no image
 * resolved, the caller routes to the plain bullets layout instead.
 */
function renderSplit(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string, side: "left" | "right" = "right") {
  bgFill(slide, d.bg);
  const imgW = W - 7.8; // bleeding photo width (~5.53")
  const imgX = side === "right" ? W - imgW : 0;
  // Soft outer shadow toward the page gives the bleeding photo depth at the seam.
  maybeImage(slide, s, { x: imgX, y: 0, w: imgW, h: H }, {
    shadow: { type: "outer", color: "000000", blur: 9, offset: 3, angle: side === "right" ? 180 : 0, opacity: 0.22 },
  });
  // Soft blend strip so the photo's inner edge melts into the page (no hard seam).
  const stripX = side === "right" ? imgX : imgX + imgW - 0.7;
  slide.addShape("rect", {
    x: stripX, y: 0, w: 0.7, h: H,
    fill: { color: d.bg, transparency: 35 }, line: { type: "none" },
  });
  // Text column on the side opposite the photo.
  const colX = side === "right" ? ML : imgW + 0.45;
  const colW = (side === "right" ? imgX : (W - MR)) - colX - 0.45;
  slide.addShape("rect", {
    x: colX, y: 0.72, w: 0.07, h: 0.42,
    fill: { color: d.accent2 }, line: { type: "none" },
  });
  const splitKicker = s.eyebrow || moduleLabel;
  slide.addText(eyebrow(splitKicker), {
    x: colX + 0.18, y: 0.68, w: colW - 0.18, h: 0.3,
    fontFace: FONT_BODY, bold: true, color: d.accent2, valign: "middle",
    ...kickerFit(splitKicker, colW - 0.18, 10, 2),
  });
  slide.addText(s.title, {
    x: colX + 0.18, y: 1.02, w: colW - 0.18, h: 1.2,
    fontFace: FONT_TITLE, fontSize: s.title.length > 40 ? 23 : 27, bold: true,
    color: d.text, valign: "top", lineSpacingMultiple: 1.02,
  });
  const items = s.bullets ?? [];
  const startY = 2.45;
  const listH = FOOTER_Y - startY - 0.15;
  const rowH = listH / Math.max(items.length, 1);
  items.forEach((b, i) => {
    const y = startY + i * rowH;
    slide.addShape("rect", {
      x: colX, y: y + rowH / 2 - 0.06, w: 0.14, h: 0.14,
      fill: { color: d.accent2 }, line: { type: "none" },
    });
    slide.addText(b, {
      x: colX + 0.3, y, w: colW - 0.4, h: rowH,
      fontFace: FONT_BODY, fontSize: 15, color: d.text,
      valign: "middle", lineSpacingMultiple: 1.03,
    });
  });
  // Footer kept inside the text column so the page number never sits over the photo.
  slide.addText(brand, {
    x: colX, y: FOOTER_Y, w: colW - 0.5, h: 0.3,
    fontFace: FONT_BODY, fontSize: 9, color: d.subtext, valign: "middle",
  });
  slide.addText(String(num), {
    x: colX + colW - 0.5, y: FOOTER_Y, w: 0.5, h: 0.3,
    fontFace: FONT_BODY, fontSize: 9, color: d.subtext, align: "right", valign: "middle",
  });
}

/**
 * Image-top layout: the photo bleeds across the top ~46% of the slide and the
 * title + points sit on the page below. Inverting the usual "title on top"
 * structure is the single cheapest way to break a run of identical slides.
 */
function renderImageTop(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  const imgH = H * 0.46;
  maybeImage(slide, s, { x: 0, y: 0, w: W, h: imgH }, {
    shadow: { type: "outer", color: "000000", blur: 9, offset: 3, angle: 90, opacity: 0.22 },
  });
  // Blend strip along the photo's bottom edge so it melts into the page.
  slide.addShape("rect", {
    x: 0, y: imgH - 0.55, w: W, h: 0.55,
    fill: { color: d.bg, transparency: 35 }, line: { type: "none" },
  });
  const ty = imgH + 0.18;
  slide.addShape("rect", {
    x: ML, y: ty + 0.05, w: 0.07, h: 0.42,
    fill: { color: d.accent2 }, line: { type: "none" },
  });
  const topKicker = s.eyebrow || moduleLabel;
  slide.addText(eyebrow(topKicker), {
    x: ML + 0.18, y: ty, w: CW - 0.18, h: 0.3,
    fontFace: FONT_BODY, bold: true, color: d.accent2, valign: "middle",
    ...kickerFit(topKicker, CW - 0.18, 10, 2),
  });
  slide.addText(s.title, {
    x: ML + 0.18, y: ty + 0.32, w: CW - 0.18, h: 0.72,
    fontFace: FONT_TITLE, fontSize: s.title.length > 50 ? 22 : 26, bold: true,
    color: d.text, valign: "top", lineSpacingMultiple: 1.02,
  });
  const items = s.bullets ?? [];
  const startY = ty + 1.12;
  const listH = FOOTER_Y - startY - 0.12;
  const rowH = listH / Math.max(items.length, 1);
  items.forEach((b, i) => {
    const y = startY + i * rowH;
    slide.addShape("rect", {
      x: ML, y: y + rowH / 2 - 0.06, w: 0.14, h: 0.14,
      fill: { color: d.accent2 }, line: { type: "none" },
    });
    slide.addText(b, {
      x: ML + 0.32, y, w: CW - 0.5, h: rowH,
      fontFace: FONT_BODY, fontSize: 14, color: d.text,
      valign: "middle", lineSpacingMultiple: 1.02,
    });
  });
  footer(slide, d, brand, num);
}

function renderBullets(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  // A hero bullets slide carrying a module image renders as an image layout:
  // a bleeding photo (right/left) or image-top, per its rotated imageLayout.
  if (s.imageData && (s.bullets?.length ?? 0) > 0) {
    if (s.imageLayout === "top") return renderImageTop(slide, s, d, brand, num, moduleLabel);
    return renderSplit(slide, s, d, brand, num, moduleLabel, s.imageLayout === "split-left" ? "left" : "right");
  }
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const items = s.bullets ?? [];
  const totalChars = items.join("").length;
  const fs = autoBodyFontSize(items.length, totalChars);
  // Full-width text. Photos live on the cover + module dividers only, which
  // keeps content slides clean and the file light (avoids CPU/size blowups).
  const listW = CW;
  const rowH = CONTENT_H / Math.max(items.length, 1);
  items.forEach((b, i) => {
    const y = CONTENT_Y + i * rowH;
    slide.addShape("rect", {
      x: ML,
      y: y + rowH / 2 - 0.06,
      w: 0.14,
      h: 0.14,
      fill: { color: d.accent2 },
      line: { type: "none" },
    });
    slide.addText(b, {
      x: ML + 0.32,
      y,
      w: listW - 0.5,
      h: rowH,
      fontFace: FONT_BODY,
      fontSize: fs,
      color: d.text,
      valign: "middle",
      lineSpacingMultiple: 1.02,
    });
  });
  footer(slide, d, brand, num);
}

/**
 * Tiles: a short list (3–6 brief points) shown as a grid of badge tiles instead
 * of a vertical bullet list. Each tile carries a numbered accent badge (a clean
 * geometric stand-in for an icon — never a guessed semantic icon) and the point,
 * centered. Used by the anti-monotony pass to break runs of bullet slides.
 */
function renderTiles(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const items = (s.bullets ?? []).filter((b) => b && b.trim());
  const n = items.length;
  const cols = n <= 3 ? n : n === 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const gap = 0.3;
  const tileW = (CW - gap * (cols - 1)) / cols;
  // Size tiles to their CONTENT (badge + text lines), NOT the full row height,
  // then center the block vertically. Otherwise a single row of short tiles
  // (e.g. 3 items → 1 row) stretches into tall, mostly-empty boxes — the
  // "big box, little text" problem.
  const fullRowH = (CONTENT_H - gap * (rows - 1)) / rows;
  const innerW = tileW - 0.36;
  const perLine = Math.max(10, innerW * 9); // ~chars/line for centered body text
  let textLines = 1;
  for (const b of items) {
    textLines = Math.max(textLines, Math.min(4, Math.ceil(b.trim().length / perLine)));
  }
  const padTop = 0.26, badge = 0.56, gapBelowBadge = 0.16, lineH = 0.27, padBottom = 0.22;
  const naturalH = padTop + badge + gapBelowBadge + textLines * lineH + padBottom;
  const tileH = Math.min(fullRowH, Math.max(1.35, naturalH));
  const textFs = n > 4 ? 13 : 15;
  const blockH = rows * tileH + gap * (rows - 1);
  const startY = CONTENT_Y + Math.max(0, (CONTENT_H - blockH) / 2);

  items.forEach((b, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // Center a short final row (e.g. 5 items → 3 + 2) instead of left-hugging it.
    const itemsInRow = Math.min(cols, n - row * cols);
    const rowOffset = (CW - (itemsInRow * tileW + gap * (itemsInRow - 1))) / 2;
    const x = ML + rowOffset + col * (tileW + gap);
    const y = startY + row * (tileH + gap);

    slide.addShape("roundRect", {
      x, y, w: tileW, h: tileH, rectRadius: 0.08,
      fill: { color: d.surface },
      line: { color: d.border, width: 1 },
    });
    const bx = x + tileW / 2 - badge / 2;
    const by = y + padTop;
    slide.addShape("ellipse", {
      x: bx, y: by, w: badge, h: badge,
      fill: { color: d.accent },
      line: { type: "none" },
    });
    slide.addText(String(i + 1), {
      x: bx, y: by, w: badge, h: badge,
      fontFace: FONT_TITLE, fontSize: 20, bold: true, color: d.onAccent,
      align: "center", valign: "middle",
    });
    slide.addText(b, {
      x: x + 0.18,
      y: by + badge + gapBelowBadge,
      w: tileW - 0.36,
      h: tileH - padTop - badge - gapBelowBadge - 0.06,
      fontFace: FONT_BODY, fontSize: textFs, color: d.text,
      align: "center", valign: "top", lineSpacingMultiple: 1.04,
    });
  });
  footer(slide, d, brand, num);
}

/**
 * Bento grid: 2–4 short points as roomy surface cards (Apple-style "bento"),
 * each with an accent index chip. A premium alternative to a vertical list or
 * the tighter badge tiles — used by the anti-monotony pass to vary list runs.
 */
function renderBento(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const items = (s.bullets ?? []).filter((b) => b && b.trim());
  const n = items.length;
  // 3 items → one row of 3 (NOT 2+1, which leaves a lopsided hole); 4 → 2×2.
  const cols = n === 3 ? 3 : (n <= 2 ? n : 2);
  const rows = Math.ceil(n / cols);
  const gap = 0.3;
  const cardW = (CW - gap * (cols - 1)) / cols;
  const chip = 0.5;
  // Size cards to their CONTENT (chip + text lines), not the full row height,
  // then centre the block vertically — otherwise a single row of short items
  // stretches into tall, mostly-empty boxes (the "big box, little text" bug).
  const fullCardH = (CONTENT_H - gap * (rows - 1)) / rows;
  const innerW = cardW - 0.56;
  const perLine = Math.max(12, innerW * (n <= 2 ? 9.5 : 11));
  let textLines = 1;
  for (const b of items) {
    textLines = Math.max(textLines, Math.min(5, Math.ceil(b.trim().length / perLine)));
  }
  const padTop = 0.28, gapBelowChip = 0.14, lineH = n <= 2 ? 0.3 : 0.27, padBottom = 0.24;
  const naturalH = padTop + chip + gapBelowChip + textLines * lineH + padBottom;
  const cardH = Math.min(fullCardH, Math.max(1.4, naturalH));
  const blockH = rows * cardH + gap * (rows - 1);
  const startY = CONTENT_Y + Math.max(0, (CONTENT_H - blockH) / 2);
  items.forEach((b, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const itemsInRow = Math.min(cols, n - row * cols);
    const rowOffset = (CW - (itemsInRow * cardW + gap * (itemsInRow - 1))) / 2;
    const x = ML + rowOffset + col * (cardW + gap);
    const y = startY + row * (cardH + gap);
    slide.addShape("roundRect", {
      x, y, w: cardW, h: cardH, rectRadius: 0.1,
      fill: { color: d.surface }, line: { color: d.border, width: 1 },
      shadow: { type: "outer", color: "000000", blur: 7, offset: 2, angle: 90, opacity: 0.18 },
    });
    slide.addShape("roundRect", {
      x: x + 0.28, y: y + 0.28, w: chip, h: chip, rectRadius: 0.06,
      fill: { color: d.accent }, line: { type: "none" },
    });
    slide.addText(String(i + 1), {
      x: x + 0.28, y: y + 0.28, w: chip, h: chip,
      fontFace: FONT_TITLE, fontSize: 18, bold: true, color: d.onAccent,
      align: "center", valign: "middle",
    });
    slide.addText(b, {
      x: x + 0.28, y: y + 0.28 + chip + 0.14, w: cardW - 0.56,
      h: cardH - (0.28 + chip + 0.14) - 0.24,
      fontFace: FONT_BODY, fontSize: n <= 2 ? 17 : 15, color: d.subtext,
      align: "left", valign: "top", lineSpacingMultiple: 1.06,
    });
  });
  footer(slide, d, brand, num);
}

function renderCards(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const cards = s.cards ?? [];
  const n = cards.length;
  const cols = n <= 2 ? n : n === 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const gap = 0.3;
  const cardW = (CW - gap * (cols - 1)) / cols;
  const fullCardH = (CONTENT_H - gap * (rows - 1)) / rows;

  // Size cards to their CONTENT, not the full slide height, then center the
  // block vertically. Otherwise a single row of short cards stretches into
  // tall, mostly-empty boxes while multi-row grids look fine.
  const innerW = cardW - 0.5;
  const headPerLine = Math.max(12, innerW * 8.6); // ~chars/line @15pt bold
  const bodyPerLine = Math.max(14, innerW * 11); // ~chars/line @12pt
  const anyBody = cards.some((c) => c.body);
  let bodyLines = 1;
  let headLines = 1;
  for (const c of cards) {
    if (c.body) bodyLines = Math.max(bodyLines, Math.min(3, Math.ceil(c.body.length / bodyPerLine)));
    headLines = Math.max(headLines, Math.min(3, Math.ceil((c.heading?.length || 1) / headPerLine)));
  }
  const padT = 0.2, numH = 0.36, headLH = 0.28, bodyLH = 0.21, midGap = 0.1, padB = 0.22;
  // Uniform heading slot (2 lines, middle-aligned) when cards carry bodies, so
  // equal-structure card slides render identically regardless of how a single
  // heading happens to wrap (fixes the #27-vs-#28 spacing discrepancy where one
  // longer title silently pushed its whole grid down). Heading-only cards size
  // to their content.
  const headBoxH = anyBody ? 2 * headLH : headLines * headLH;
  const bodyBoxH = anyBody ? bodyLines * bodyLH + 0.06 : 0;
  const naturalH = padT + numH + 0.04 + headBoxH + (anyBody ? midGap + bodyBoxH : 0) + padB;
  const cardH = Math.min(fullCardH, Math.max(1.3, naturalH));
  const blockH = rows * cardH + gap * (rows - 1);
  const startY = CONTENT_Y + Math.max(0, (CONTENT_H - blockH) / 2);

  cards.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = ML + col * (cardW + gap);
    const y = startY + row * (cardH + gap);
    slide.addShape("roundRect", {
      x,
      y,
      w: cardW,
      h: cardH,
      rectRadius: 0.08,
      fill: { color: d.surface },
      line: { color: d.border, width: 1 },
    });
    slide.addShape("rect", {
      x,
      y,
      w: cardW,
      h: 0.08,
      fill: { color: d.accent2 },
      line: { type: "none" },
    });
    slide.addText(String(i + 1).padStart(2, "0"), {
      x: x + 0.25,
      y: y + padT,
      w: cardW - 0.5,
      h: numH,
      fontFace: FONT_TITLE,
      fontSize: 18,
      bold: true,
      color: d.accent2,
    });
    slide.addText(c.heading, {
      x: x + 0.25,
      y: y + padT + numH + 0.04,
      w: cardW - 0.5,
      h: c.body ? headBoxH : cardH - padT - numH - padB,
      fontFace: FONT_BODY,
      fontSize: 15,
      bold: true,
      color: d.text,
      valign: c.body ? "middle" : "top",
    });
    if (c.body) {
      slide.addText(c.body, {
        x: x + 0.25,
        y: y + padT + numH + 0.04 + headBoxH + midGap,
        w: cardW - 0.5,
        h: bodyBoxH,
        fontFace: FONT_BODY,
        fontSize: 12,
        color: d.subtext,
        valign: "top",
        lineSpacingMultiple: 1.0,
      });
    }
  });
  footer(slide, d, brand, num);
}

// ── Card-family helpers (shared by the single-item & anti-repetition guards) ──

/** How many discrete content items a card/bento/tiles/bullets/steps slide holds. */
function contentItemCount(s: SlideSpec): number {
  if (s.kind === "cards") return (s.cards ?? []).length;
  if (s.kind === "steps") return (s.steps ?? []).length;
  return (s.bullets ?? []).filter((b) => b && b.trim()).length;
}

/** Flatten any card-family slide into "heading"/"body" pairs for re-layout. */
function slideItemPairs(s: SlideSpec): { heading: string; body?: string }[] {
  if (s.cards?.length) return s.cards.map((c) => ({ heading: c.heading, body: c.body }));
  if (s.steps?.length) return s.steps.map((st) => ({ heading: st.heading, body: st.body }));
  return (s.bullets ?? []).filter((b) => b && b.trim()).map((b) => ({ heading: b }));
}

/**
 * Single-item rescue: a card/bento/bullets slide that ended up with ONE point
 * would draw a giant, mostly-empty card. Instead we promote that one statement
 * to a dark, cover-style "highlight" — it reads as a deliberate emphasis beat
 * rather than a layout that failed to fill. Tokens only.
 */
function renderHighlight(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.coverBg);
  const hiKicker = s.eyebrow || moduleLabel;
  slide.addText(eyebrow(hiKicker), {
    x: ML, y: 1.5, w: CW, h: 0.4,
    fontFace: FONT_BODY, bold: true, color: d.accent2, align: "center",
    ...kickerFit(hiKicker, CW, 12, 3),
  });
  slide.addText(s.title, {
    x: 1.5, y: 2.05, w: W - 3, h: 0.95,
    fontFace: FONT_TITLE, fontSize: s.title.length > 50 ? 26 : 30, bold: true,
    color: "FFFFFF", align: "center", valign: "middle",
  });
  const pair = slideItemPairs(s)[0];
  const txt = [pair?.heading, pair?.body].filter(Boolean).join(" — ") || s.subtitle || "";
  const fs = txt.length <= 60 ? 38 : txt.length <= 120 ? 30 : 24;
  slide.addText(txt, {
    x: 1.6, y: 3.15, w: W - 3.2, h: 2.5,
    fontFace: FONT_BODY, fontSize: fs, color: "E8EEF5",
    align: "center", valign: "middle", lineSpacingMultiple: 1.2,
  });
  slide.addShape("rect", {
    x: W / 2 - 0.5, y: 5.95, w: 1.0, h: 0.05,
    fill: { color: d.accent2 }, line: { type: "none" },
  });
  footer(slide, { ...d, subtext: "8595A6" }, brand, num);
}

/**
 * Sidebar layout: a full-height accent panel on the left carries the eyebrow +
 * title (the focal point); the points list flows on the right. Used by the
 * deterministic anti-repetition guard so two card grids in a row don't read as
 * the same silhouette — the renderer swaps the SECOND one for this. The planner
 * never sees it, so it adds zero decision load to the LLM. Tokens only.
 */
function renderSidebar(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  const sbW = W * 0.34;
  slide.addShape("rect", { x: 0, y: 0, w: sbW, h: H, fill: { color: d.accent }, line: { type: "none" } });
  slide.addShape("rect", { x: 0.55, y: 0.9, w: 0.5, h: 0.07, fill: { color: d.accent2 }, line: { type: "none" } });
  const sbKicker = s.eyebrow || moduleLabel;
  slide.addText(eyebrow(sbKicker), {
    x: 0.55, y: 1.05, w: sbW - 0.95, h: 0.5,
    fontFace: FONT_BODY, bold: true, color: d.onAccent, valign: "top",
    // The sidebar kicker box is narrow but 0.5in tall — it wraps to 2 lines.
    ...kickerFit(sbKicker, sbW - 0.95, 11, 2, 2),
  });
  slide.addText(s.title, {
    x: 0.55, y: 1.55, w: sbW - 0.95, h: 4.4,
    fontFace: FONT_TITLE, fontSize: s.title.length > 42 ? 24 : 29, bold: true,
    color: d.onAccent, valign: "top", lineSpacingMultiple: 1.05,
  });

  const pairs = slideItemPairs(s);
  const rightX = sbW + 0.55;
  const rightW = W - rightX - 0.7;
  const n = Math.max(pairs.length, 1);
  const slotH = (CONTENT_H + 0.6) / n;
  pairs.forEach((p, i) => {
    const y = CONTENT_Y - 0.55 + i * slotH;
    slide.addShape("rect", {
      x: rightX, y: y + 0.06, w: 0.11, h: Math.min(slotH - 0.35, 0.9),
      fill: { color: d.accent2 }, line: { type: "none" },
    });
    slide.addText(p.heading, {
      x: rightX + 0.32, y, w: rightW - 0.32, h: p.body ? 0.42 : slotH - 0.3,
      fontFace: FONT_TITLE, fontSize: 17, bold: true, color: d.text,
      valign: "middle", lineSpacingMultiple: 1.0,
    });
    if (p.body) {
      slide.addText(p.body, {
        x: rightX + 0.32, y: y + 0.44, w: rightW - 0.32, h: slotH - 0.55,
        fontFace: FONT_BODY, fontSize: 13, color: d.subtext,
        valign: "top", lineSpacingMultiple: 1.1,
      });
    }
  });
  slide.addText(String(num), {
    x: rightX, y: FOOTER_Y, w: rightW, h: 0.3,
    fontFace: FONT_BODY, fontSize: 9, color: d.subtext, align: "right", valign: "middle",
  });
}

/**
 * Horizontal alternating timeline: numbered nodes on a central spine, labels
 * alternating above/below. The premium "process" look — node spacing is computed
 * from the item count (3 steps → wide, 5 → tighter, always balanced). Used for
 * short, scannable step sequences; steps that carry real explanation fall back
 * to the vertical giant-number layout (renderSteps) which has room to read.
 */
function renderTimeline(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const steps = s.steps ?? [];
  const n = steps.length;
  const cy = CONTENT_Y + CONTENT_H / 2; // spine vertical centre
  // Central spine — a subtle gold rule spanning the content width.
  slide.addShape("rect", {
    x: ML, y: cy - 0.015, w: CW, h: 0.03,
    fill: { color: d.accent2, transparency: 55 }, line: { type: "none" },
  });
  const slot = CW / n; // equal slot per node → labels never collide
  const node = 0.36;
  steps.forEach((st, i) => {
    const nodeX = ML + slot * (i + 0.5);
    const isTop = i % 2 === 0;
    const w = slot - 0.3;
    const x = nodeX - w / 2;
    // Connector tick from spine toward the label.
    slide.addShape("line", {
      x: nodeX, y: isTop ? cy - 0.46 : cy + 0.16, w: 0, h: 0.3,
      line: { color: d.accent2, width: 1 },
    });
    // Faint halo ring + numbered node on the spine.
    slide.addShape("ellipse", {
      x: nodeX - 0.27, y: cy - 0.27, w: 0.54, h: 0.54,
      fill: { color: d.accent2, transparency: 78 }, line: { type: "none" },
    });
    slide.addShape("ellipse", {
      x: nodeX - node / 2, y: cy - node / 2, w: node, h: node,
      fill: { color: d.accent }, line: { type: "none" },
    });
    slide.addText(String(i + 1), {
      x: nodeX - node / 2, y: cy - node / 2, w: node, h: node,
      fontFace: FONT_BODY, fontSize: 12, bold: true, color: d.onAccent,
      align: "center", valign: "middle",
    });
    // Heading near the spine, description further out.
    const headY = isTop ? cy - 0.95 : cy + 0.5;
    const bodyY = isTop ? CONTENT_Y + 0.05 : headY + 0.5;
    const bodyH = isTop ? headY - (CONTENT_Y + 0.05) - 0.04 : FOOTER_Y - bodyY - 0.1;
    slide.addText(st.heading, {
      x, y: headY, w, h: 0.45,
      fontFace: FONT_BODY, fontSize: 15, bold: true, color: d.accent2,
      align: "center", valign: isTop ? "bottom" : "top",
    });
    if (st.body) {
      slide.addText(st.body, {
        x, y: bodyY, w, h: Math.max(0.4, bodyH),
        fontFace: FONT_BODY, fontSize: 11.5, color: d.subtext,
        align: "center", valign: isTop ? "bottom" : "top", lineSpacingMultiple: 1.03,
      });
    }
  });
  footer(slide, d, brand, num);
}

function renderSteps(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  const steps = s.steps ?? [];
  const n = steps.length;
  // Content-driven choice: short, scannable steps → cinematic horizontal
  // timeline; steps with real explanation → vertical giant-number list (room to
  // read). This is the "controle de condicionais" / dynamic-layout idea applied.
  const shortHeads = steps.every((st) => (st.heading?.length ?? 0) <= 24);
  const bodyLight = steps.every((st) => !st.body || st.body.length <= 70);
  if (n >= 3 && n <= 5 && shortHeads && bodyLight) {
    return renderTimeline(slide, s, d, brand, num, moduleLabel);
  }
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const rowH = CONTENT_H / Math.max(n, 1);
  const numW = 1.45;
  // Oversized "ghost" ordinal as a design element on the left (Apple/Gamma look),
  // replacing the small numbered dot + spine. Heading + body sit to the right.
  const numFs = Math.min(54, Math.max(34, rowH * 72 * 0.8));
  steps.forEach((st, i) => {
    const y = CONTENT_Y + i * rowH;
    slide.addText(String(i + 1).padStart(2, "0"), {
      x: ML, y, w: numW, h: rowH,
      fontFace: FONT_TITLE, fontSize: numFs, bold: true,
      color: d.accent2, transparency: 60,
      align: "left", valign: "middle",
    });
    slide.addText(
      [
        { text: st.heading, options: { bold: true, fontSize: 17, color: d.text, breakLine: true } },
        ...(st.body
          ? [{ text: st.body, options: { fontSize: 12.5, color: d.subtext } }]
          : []),
      ],
      {
        x: ML + numW + 0.2,
        y,
        w: CW - numW - 0.4,
        h: rowH,
        fontFace: FONT_BODY,
        valign: "middle",
        lineSpacingMultiple: 1.03,
      },
    );
    if (i < n - 1) {
      slide.addShape("line", {
        x: ML + numW + 0.2, y: y + rowH, w: CW - numW - 0.4, h: 0,
        line: { color: d.border, width: 0.75 },
      });
    }
  });
  footer(slide, d, brand, num);
}

/**
 * 2×2 matrix: a cartesian cross with one labelled card per quadrant. Distinct
 * from "bento"/"cards" (a free grid of items) — this implies axes and a genuine
 * classification (SWOT, effort×impact). Uses the first 4 cards; padding/gaps are
 * computed so it scales cleanly. All colours from palette tokens (any theme).
 */
function renderMatrix(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const cells = (s.cards ?? []).slice(0, 4);
  const midX = ML + CW / 2;
  const midY = CONTENT_Y + CONTENT_H / 2;
  const g = 0.16; // half-gap around the central cross
  const cellW = CW / 2 - g;
  const cellH = CONTENT_H / 2 - g;
  const zones = [
    { x: ML, y: CONTENT_Y },          // top-left
    { x: midX + g, y: CONTENT_Y },     // top-right
    { x: ML, y: midY + g },            // bottom-left
    { x: midX + g, y: midY + g },      // bottom-right
  ];
  cells.forEach((c, i) => {
    const z = zones[i];
    slide.addShape("roundRect", {
      x: z.x, y: z.y, w: cellW, h: cellH, rectRadius: 0.08,
      fill: { color: d.surface, transparency: 18 },
      line: { color: d.border, width: 1 },
    });
    slide.addShape("rect", {
      x: z.x + 0.26, y: z.y + 0.3, w: 0.13, h: 0.13,
      fill: { color: d.accent2 }, line: { type: "none" },
    });
    slide.addText(c.heading, {
      x: z.x + 0.5, y: z.y + 0.22, w: cellW - 0.7, h: 0.4,
      fontFace: FONT_BODY, fontSize: 16, bold: true, color: d.accent2, valign: "middle",
    });
    if (c.body) {
      slide.addText(c.body, {
        x: z.x + 0.28, y: z.y + 0.72, w: cellW - 0.56, h: cellH - 0.94,
        fontFace: FONT_BODY, fontSize: 13, color: d.text, valign: "top", lineSpacingMultiple: 1.05,
      });
    }
  });
  // Central cross drawn over the gaps so the quadrant structure reads instantly.
  slide.addShape("line", {
    x: midX, y: CONTENT_Y, w: 0, h: CONTENT_H,
    line: { color: d.accent2, width: 1.5, transparency: 35 },
  });
  slide.addShape("line", {
    x: ML, y: midY, w: CW, h: 0,
    line: { color: d.accent2, width: 1.5, transparency: 35 },
  });
  footer(slide, d, brand, num);
}

/**
 * Multi-column comparison table: N options ("columns") compared across M criteria
 * ("rows"). Distinct from "compare" (2 columns) and "matrix" (2×2) — this is the
 * only layout that scales a true comparison grid. Drawn with the native table so
 * cells wrap cleanly; every colour is a palette token (theme-agnostic). The grid
 * is already rectangular and capped by validate.ts, so geometry is simple.
 */
function renderTable(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const columns = s.columns ?? [];
  const rows = s.rows ?? [];
  const ncol = columns.length;
  const labelW = Math.min(3.0, Math.max(2.0, CW * 0.22));
  const dataW = (CW - labelW) / ncol;
  const colW = [labelW, ...Array(ncol).fill(dataW)];
  // Cap row height so a 1–2 row table doesn't stretch to fill the whole content
  // area (which left huge vertical gaps and made the header float far above its
  // data, reading as a misaligned table). Few rows now render compact at the top;
  // a full 6-row table (CONTENT_H/7 ≈ 0.77) is unaffected.
  const nRows = rows.length + 1;
  const rowH = Math.min(0.95, CONTENT_H / nRows);
  const headFs = ncol >= 5 ? 11 : 12;
  const bodyFs = ncol >= 5 ? 9 : ncol >= 4 ? 10 : 11;

  // Modern table: NO vertical grid lines. The eye is guided by the accent header
  // and subtle horizontal hairlines only — it "breathes" through whitespace.
  const none = { type: "none" } as const;
  const hair = { type: "solid", color: d.border, pt: 0.75 } as const;
  const headRule = { type: "solid", color: d.accent, pt: 1.5 } as const;
  // pptxgenjs border order: [top, right, bottom, left].
  const headBorder = [none, none, headRule, none];
  const bodyBorder = [none, none, hair, none];

  // Per-column horizontal alignment: a column whose cells are mostly numeric or
  // very short reads better CENTERED (numbers, "Sim/Não", short labels); a column
  // with prose stays LEFT. The header takes its column's alignment so the title
  // always sits directly over its cells (fixes header/content not lining up).
  const isShortOrNumeric = (s: string) => {
    const t = (s || "").trim();
    if (!t) return true;
    if (/^[\d\s.,:%$+\-–—x×/()º°]+$/.test(t)) return true; // numbers, %, ranges
    return t.split(/\s+/).length <= 2 && t.length <= 14;
  };
  const colAligns: ("center" | "left")[] = columns.map((_, ci) => {
    const cells = rows.map((r) => r.cells[ci] ?? "");
    const shortCount = cells.filter(isShortOrNumeric).length;
    return cells.length > 0 && shortCount >= Math.ceil(cells.length / 2)
      ? "center"
      : "left";
  });

  const headerRow = [
    { text: s.rowHeader ?? "", options: { border: headBorder, color: d.accent, bold: true, align: "left", fontSize: headFs } },
    ...columns.map((c, ci) => ({
      text: c,
      options: { border: headBorder, color: d.accent, bold: true, align: colAligns[ci], fontSize: headFs },
    })),
  ];
  const bodyRows = rows.map((r) => [
    { text: r.label, options: { border: bodyBorder, color: d.accent2, bold: true, align: "left", fontSize: bodyFs } },
    ...r.cells.map((cell, ci) => ({
      text: cell,
      options: { border: bodyBorder, color: d.text, align: colAligns[ci], fontSize: bodyFs },
    })),
  ]);

  slide.addTable([headerRow, ...bodyRows], {
    x: ML, y: CONTENT_Y, w: CW,
    colW,
    rowH: Array(rows.length + 1).fill(rowH),
    fontFace: FONT_BODY,
    valign: "middle",
    margin: [5, 10, 5, 10],
    autoPage: false,
  });
  footer(slide, d, brand, num);
}

/** Two short columns (≤2 brief items each) → eligible for the dramatic split. */
function darkSplitEligible(s: SlideSpec): boolean {
  const ok = (c?: { items?: string[] }) => {
    const items = c?.items ?? [];
    return items.length >= 1 && items.length <= 2 &&
      items.every((x) => x.trim().split(/\s+/).length <= 9);
  };
  return ok(s.left) && ok(s.right);
}

/**
 * Dramatic "dark split": left on the page colour, right on a full-bleed accent
 * panel — a polarised State-A-vs-State-B contrast. Adapted from a light-theme
 * reference into tokens (right-panel text uses onAccent so it reads on any
 * accent). Used when each side is one punchy statement; list-y comparisons keep
 * the two-card layout below.
 */
function renderDarkSplit(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number) {
  bgFill(slide, d.bg);
  slide.addShape("rect", {
    x: W / 2, y: 0, w: W / 2, h: H,
    fill: { color: d.accent }, line: { type: "none" },
  });
  // "Billboard" scaling: when each side carries little text the static sizes
  // left a 50/50 field looking empty. Short content becomes the hero (big type,
  // block centred vertically) so the whitespace reads as deliberate "respiro".
  const sc = splitScale(s);
  const headY = sc.short ? 2.35 : 1.7;
  const bodyY = sc.short ? 3.75 : 3.05;
  const sides = [
    { col: s.left!, x: 0.9, headColor: d.accent2, bodyColor: d.text },
    { col: s.right!, x: W / 2 + 0.6, headColor: d.onAccent, bodyColor: d.onAccent },
  ];
  for (const { col, x, headColor, bodyColor } of sides) {
    const w = W / 2 - 1.5;
    slide.addText((col.heading || "").toUpperCase(), {
      x, y: headY, w, h: 1.3,
      fontFace: FONT_TITLE, fontSize: sc.headFs, bold: true, color: headColor,
      valign: "bottom", lineSpacingMultiple: 1.0,
    });
    slide.addText((col.items ?? []).join("\n"), {
      x, y: bodyY, w, h: 2.6,
      fontFace: FONT_BODY, fontSize: sc.bodyFs, color: bodyColor,
      valign: "top", lineSpacingMultiple: sc.short ? 1.3 : 1.25,
    });
  }
  footer(slide, d, brand, num);
}

/**
 * Dynamic "billboard" sizes for the dark-split, shared across BOTH sides so they
 * stay balanced. Short → big hero type; long → compact. Based on the wordiest
 * side so the larger column never overflows.
 */
function splitScale(s: SlideSpec): { headFs: number; bodyFs: number; short: boolean } {
  const cols = [s.left, s.right];
  const itemsLen = Math.max(...cols.map((c) => (c?.items ?? []).join(" ").length || 0));
  const itemCount = Math.max(...cols.map((c) => (c?.items ?? []).length || 0));
  const headLen = Math.max(...cols.map((c) => (c?.heading ?? "").length || 0));
  const short = itemsLen <= 70 && itemCount <= 2;
  const headFs = short ? (headLen <= 22 ? 40 : 33) : 28;
  const bodyFs = itemsLen <= 40 ? 30 : itemsLen <= 80 ? 24 : itemsLen <= 140 ? 19 : 16;
  return { headFs, bodyFs, short };
}

/**
 * Horizontal twin of renderDarkSplit: top half on the page colour, bottom half
 * a full-bleed accent panel. Same polarised A-vs-B contrast, rotated 90° so a
 * deck with several short compares doesn't repeat one silhouette. Tokens only.
 */
function renderDarkSplitH(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number) {
  bgFill(slide, d.bg);
  slide.addShape("rect", {
    x: 0, y: H / 2, w: W, h: H / 2,
    fill: { color: d.accent }, line: { type: "none" },
  });
  // Billboard scaling (capped lower than the vertical split — each half has less
  // room), so short top/bottom contrasts fill their band instead of floating.
  const sc = splitScale(s);
  const headFs = Math.min(sc.headFs, 34);
  const bodyFs = Math.min(sc.bodyFs, 26);
  const halves = [
    { col: s.left!, y: 0.85, headColor: d.accent2, bodyColor: d.text },
    { col: s.right!, y: H / 2 + 0.45, headColor: d.onAccent, bodyColor: d.onAccent },
  ];
  for (const { col, y, headColor, bodyColor } of halves) {
    slide.addText((col.heading || "").toUpperCase(), {
      x: 0.9, y, w: W - 1.8, h: 0.9,
      fontFace: FONT_TITLE, fontSize: headFs, bold: true, color: headColor,
      valign: "bottom", lineSpacingMultiple: 1.0,
    });
    slide.addText((col.items ?? []).join("\n"), {
      x: 0.9, y: y + 0.95, w: W - 1.8, h: 1.55,
      fontFace: FONT_BODY, fontSize: bodyFs, color: bodyColor,
      valign: "top", lineSpacingMultiple: 1.2,
    });
  }
  footer(slide, d, brand, num);
}

function renderCompare(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string, variant = 0) {
  // Defensive: a compare slide MUST have two populated sides. Production
  // normalization guarantees this, but if a malformed slide ever reaches here
  // (e.g. the contrast arrived as "cards" or bullets) we rebuild the sides so we
  // never half-render an empty panel with no text.
  let left = s.left, right = s.right;
  const hasSides = (left?.items?.length ?? 0) > 0 && (right?.items?.length ?? 0) > 0;
  if (!hasSides) {
    const splitBody = (v?: string) =>
      (v ? v.split(/[;\n•]+/).map((x) => x.trim()).filter(Boolean) : []);
    const cards = (s.cards ?? []).filter((c) => c.heading || c.body);
    if (cards.length >= 2) {
      left = { heading: cards[0].heading ?? "", items: splitBody(cards[0].body).length ? splitBody(cards[0].body) : [cards[0].heading ?? ""] };
      right = { heading: cards[1].heading ?? "", items: splitBody(cards[1].body).length ? splitBody(cards[1].body) : [cards[1].heading ?? ""] };
    } else if ((s.bullets?.length ?? 0) >= 2) {
      const mid = Math.ceil(s.bullets!.length / 2);
      left = { heading: "", items: s.bullets!.slice(0, mid) };
      right = { heading: "", items: s.bullets!.slice(mid) };
    } else {
      return renderBullets(slide, s, d, brand, num, moduleLabel);
    }
  }
  const sx: SlideSpec = { ...s, left, right };
  // Round-robin so repeated contrasts don't all look identical: alternate the
  // dramatic VERTICAL split with a HORIZONTAL (top/bottom) one. Only short
  // one-statement sides qualify for either; list-y compares keep the two cards.
  if (darkSplitEligible(sx)) {
    return variant % 2 === 0
      ? renderDarkSplit(slide, sx, d, brand, num)
      : renderDarkSplitH(slide, sx, d, brand, num);
  }
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const gap = 0.5;
  const colW = (CW - gap) / 2;
  const cols = [
    { col: sx.left!, x: ML, accent: d.accent },
    { col: sx.right!, x: ML + colW + gap, accent: d.accent2 },
  ];
  for (const { col, x, accent } of cols) {
    slide.addShape("roundRect", {
      x,
      y: CONTENT_Y,
      w: colW,
      h: CONTENT_H,
      rectRadius: 0.08,
      fill: { color: d.surface },
      line: { color: d.border, width: 1 },
    });
    slide.addShape("rect", {
      x,
      y: CONTENT_Y,
      w: colW,
      h: 0.62,
      fill: { color: accent },
      line: { type: "none" },
    });
    slide.addText(col.heading, {
      x: x + 0.25,
      y: CONTENT_Y,
      w: colW - 0.5,
      h: 0.62,
      fontFace: FONT_BODY,
      fontSize: 16,
      bold: true,
      color: d.onAccent,
      valign: "middle",
    });
    const items = col.items ?? [];
    const listY = CONTENT_Y + 0.85;
    const listH = CONTENT_H - 1.0;
    const rowH = listH / Math.max(items.length, 1);
    items.forEach((it, i) => {
      const y = listY + i * rowH;
      slide.addShape("rect", {
        x: x + 0.28,
        y: y + rowH / 2 - 0.05,
        w: 0.12,
        h: 0.12,
        fill: { color: accent },
        line: { type: "none" },
      });
      slide.addText(it, {
        x: x + 0.52,
        y,
        w: colW - 0.8,
        h: rowH,
        fontFace: FONT_BODY,
        fontSize: 13,
        color: d.text,
        valign: "middle",
      });
    });
  }
  // VS badge
  slide.addShape("ellipse", {
    x: W / 2 - 0.32,
    y: H / 2 + 0.4,
    w: 0.64,
    h: 0.64,
    fill: { color: d.text },
    line: { color: d.bg, width: 2 },
  });
  slide.addText("VS", {
    x: W / 2 - 0.32,
    y: H / 2 + 0.4,
    w: 0.64,
    h: 0.64,
    fontFace: FONT_BODY,
    fontSize: 13,
    bold: true,
    color: d.bg,
    align: "center",
    valign: "middle",
  });
  footer(slide, d, brand, num);
}

function renderQuote(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number) {
  const text = s.quote ?? s.title;
  // Full-bleed cinematic variant: a photo fills the whole slide, a dark scrim
  // over it, big white quote on top. Fires when the module image was routed here.
  if (s.imageData) {
    bgFill(slide, d.coverBg);
    maybeImage(slide, s, { x: 0, y: 0, w: W, h: H });
    slide.addShape("rect", {
      x: 0, y: 0, w: W, h: H,
      fill: { color: "000000", transparency: 42 }, line: { type: "none" },
    });
    // Opening mark sits above the text; the closing mark drops further below it
    // (qOffClose > qOffOpen) so it clears the bottom of the quote instead of
    // hugging it. Tight box + middle valign keeps each glyph centred on its mark.
    {
      const textCenter = 1.9 + 3.2 / 2; // text box: y=1.9, h=3.2
      const qOffOpen = 1.7, qOffClose = 2.35, qH = 1.95;
      slide.addText("“", {
        x: 0.6, y: textCenter - qOffOpen - qH / 2, w: 3, h: qH,
        fontFace: "Georgia", fontSize: 200, bold: true,
        color: "FFFFFF", transparency: 82, align: "left", valign: "middle",
      });
      slide.addText("”", {
        x: W - 3.6, y: textCenter + qOffClose - qH / 2, w: 3, h: qH,
        fontFace: "Georgia", fontSize: 200, bold: true,
        color: "FFFFFF", transparency: 82, align: "right", valign: "middle",
      });
    }
    slide.addText(text, {
      x: 1.2, y: 1.9, w: W - 2.4, h: 3.2,
      fontFace: FONT_TITLE,
      fontSize: text.length > 170 ? 28 : text.length > 95 ? 34 : 40,
      italic: true, bold: true, color: "FFFFFF",
      align: "center", valign: "middle", lineSpacingMultiple: 1.15,
      shadow: { type: "outer", color: "000000", blur: 6, offset: 2, opacity: 0.5 },
    });
    slide.addShape("rect", {
      x: W / 2 - 0.5, y: 5.5, w: 1.0, h: 0.055,
      fill: { color: d.accent2 }, line: { type: "none" },
    });
    if (s.attribution) {
      slide.addText(s.attribution.toUpperCase(), {
        x: 2, y: 5.7, w: W - 4, h: 0.5,
        fontFace: FONT_BODY, fontSize: 14, bold: true,
        color: d.accent2, charSpacing: 2, align: "center",
      });
    }
    footer(slide, d, brand, num);
    return;
  }
  // A rhetorical question is not a quotation — giant decorative quote marks
  // around a "?" read as a mistake. Render it as a "provocation": full accent
  // field, centred bold prompt, no quote glyphs. (Render-side only.)
  if (text.trim().endsWith("?")) {
    bgFill(slide, d.accent);
    slide.addText(text, {
      x: 1.4, y: 1.7, w: W - 2.8, h: 4.0,
      fontFace: FONT_TITLE, fontSize: text.length > 140 ? 30 : 38, bold: true,
      color: d.onAccent, align: "center", valign: "middle", lineSpacingMultiple: 1.2,
    });
    slide.addShape("rect", {
      x: W / 2 - 0.6, y: 5.95, w: 1.2, h: 0.05,
      fill: { color: d.accent2 }, line: { type: "none" },
    });
    if (s.attribution) {
      slide.addText(s.attribution.toUpperCase(), {
        x: 2, y: 6.15, w: W - 4, h: 0.5,
        fontFace: FONT_BODY, fontSize: 13, bold: true,
        color: d.onAccent, charSpacing: 2, align: "center",
      });
    }
    footer(slide, { ...d, subtext: d.onAccent }, brand, num);
    return;
  }
  bgFill(slide, d.surface);
  slide.addShape("rect", {
    x: 0, y: 0, w: 0.18, h: H,
    fill: { color: d.accent2 }, line: { type: "none" },
  });
  // Decorative quotation marks as a subtle adornment in the corners (not behind
  // the text), in an elegant serif and the accent colour at 20% opacity — the
  // "respiro" premium look. pptxgenjs renders text transparency as <a:alpha>.
  // Opening above the text; closing drops further below (see cinematic branch).
  {
    const textCenter = 2.15 + 3.0 / 2; // text box: y=2.15, h=3.0
    const qOffOpen = 1.7, qOffClose = 2.3, qH = 1.95;
    slide.addText("“", {
      x: ML - 0.1, y: textCenter - qOffOpen - qH / 2, w: 3, h: qH,
      fontFace: "Georgia", fontSize: 200, bold: true,
      color: d.accent2, transparency: 80, align: "left", valign: "middle",
    });
    slide.addText("”", {
      x: W - 3 - (ML - 0.1), y: textCenter + qOffClose - qH / 2, w: 3, h: qH,
      fontFace: "Georgia", fontSize: 200, bold: true,
      color: d.accent2, transparency: 80, align: "right", valign: "middle",
    });
  }
  // The quote: centred, italic, in the modern sans body face (not serif) with a
  // generous side margin so it never touches the edges. Scales for longer text.
  slide.addText(text, {
    x: 1.5, y: 2.15, w: W - 3.0, h: 3.0,
    fontFace: FONT_BODY,
    fontSize: text.length > 170 ? 24 : text.length > 95 ? 29 : 34,
    italic: true, color: d.text,
    align: "center", valign: "middle", lineSpacingMultiple: 1.18,
  });
  // Centred accent rule + attribution styled for sophisticated contrast:
  // uppercase, bold, accent colour, letter-spaced — against the italic quote.
  slide.addShape("rect", {
    x: W / 2 - 0.5, y: 5.42, w: 1.0, h: 0.055,
    fill: { color: d.accent2 }, line: { type: "none" },
  });
  if (s.attribution) {
    slide.addText(s.attribution.toUpperCase(), {
      x: 2, y: 5.62, w: W - 4, h: 0.5,
      fontFace: FONT_BODY, fontSize: 14, bold: true,
      color: d.accent2, charSpacing: 2, align: "center",
    });
  }
  footer(slide, d, brand, num);
}

function renderStat(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number) {
  bgFill(slide, d.coverBg);
  if (s.eyebrow) {
    slide.addText(eyebrow(s.eyebrow), {
      x: ML,
      y: 1.4,
      w: CW,
      h: 0.4,
      fontFace: FONT_BODY,
      ...kickerFit(s.eyebrow, CW, 12, 3),
      bold: true,
      color: d.accent2,
      align: "center",
    });
  }
  // A fixed 130pt figure overflowed long values ("47 Bilhões de Dólares") past the
  // box, colliding with the eyebrow above and the label below. Scale by length so
  // the value always fits — short figures keep the dramatic size.
  const statVal = s.stat?.value ?? s.title;
  const vlen = statVal.length;
  const valSize = vlen <= 12 ? 130 : vlen <= 16 ? 100 : vlen <= 22 ? 70 : vlen <= 30 ? 52 : 40;
  slide.addText(statVal, {
    x: ML,
    y: 2.3,
    w: CW,
    h: 2.2,
    fontFace: FONT_TITLE,
    fontSize: valSize,
    bold: true,
    color: "FFFFFF",
    align: "center",
    valign: "middle",
  });
  slide.addText(s.stat?.label ?? s.title, {
    x: 2,
    y: 4.7,
    w: W - 4,
    h: 1.2,
    fontFace: FONT_BODY,
    fontSize: 20,
    color: "C9D4E0",
    align: "center",
    valign: "top",
    lineSpacingMultiple: 1.05,
  });
  footer(slide, { ...d, subtext: "8595A6" }, brand, num);
}

/**
 * Native chart slide — donut (parts of a whole) or horizontal bar (ranking of
 * magnitudes). Uses pptxgenjs's real chart engine (editable in PowerPoint), so
 * the planner only ever supplies label/value pairs — nothing to mis-draw. The
 * first two series colours are palette tokens (on-brand); the rest are a neutral
 * fallback ramp for many-slice donuts.
 */
function renderChart(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const c = s.chart!;
  const labels = c.points.map((p) => p.label);
  const values = c.points.map((p) => p.value);
  const data = [{ name: s.title || "Dados", labels, values }];
  // As fatias do donut identificam categorias, então cada uma precisa de matiz
  // própria — não de degraus da mesma cor. A lista antiga começava em
  // accent/accent2, que num tema de dois laranjas dava duas fatias iguais, e
  // depois CICLAVA: a sétima fatia repetia a cor da primeira. Ordem fixa, sem
  // ciclo. (Barra continua monocromática de propósito: ali quem mede é o
  // comprimento, e colorir cada barra gastaria o canal de identidade à toa.)
  const chartColors = categoricalColors(labels.length);

  if (c.type === "bar") {
    slide.addChart("bar", data, {
      x: ML, y: CONTENT_Y, w: CW, h: CONTENT_H,
      barDir: "bar", // horizontal bars
      chartColors: [d.accent],
      showLegend: false,
      showTitle: false,
      showValue: true,
      dataLabelColor: d.text, dataLabelFontFace: FONT_BODY, dataLabelFontSize: 12, dataLabelPosition: "outEnd",
      catAxisLabelColor: d.text, catAxisLabelFontFace: FONT_BODY, catAxisLabelFontSize: 12,
      valAxisHidden: true, valGridLine: { style: "none" },
      catAxisLineShow: false, valAxisLineShow: false,
      barGapWidthPct: 45,
    });
  } else {
    slide.addChart("doughnut", data, {
      x: ML, y: CONTENT_Y, w: CW, h: CONTENT_H,
      holeSize: 62,
      chartColors,
      showLegend: true, legendPos: "r", legendColor: d.text, legendFontFace: FONT_BODY, legendFontSize: 12,
      showTitle: false,
      showValue: false, showPercent: true,
      dataLabelColor: "FFFFFF", dataLabelFontFace: FONT_BODY, dataLabelFontSize: 11, dataLabelFontBold: true,
    });
  }
  footer(slide, d, brand, num);
}

function renderCode(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const codeBg = "0E1726";
  slide.addShape("roundRect", {
    x: ML,
    y: CONTENT_Y,
    w: CW,
    h: CONTENT_H,
    rectRadius: 0.06,
    fill: { color: codeBg },
    line: { type: "none" },
  });
  // window dots
  ["FF5F56", "FFBD2E", "27C93F"].forEach((c, i) => {
    slide.addShape("ellipse", {
      x: ML + 0.28 + i * 0.28,
      y: CONTENT_Y + 0.24,
      w: 0.15,
      h: 0.15,
      fill: { color: c },
      line: { type: "none" },
    });
  });
  if (s.code?.language) {
    slide.addText(s.code.language, {
      x: ML,
      y: CONTENT_Y + 0.16,
      w: CW - 0.4,
      h: 0.3,
      fontFace: FONT_MONO,
      fontSize: 10,
      color: "7E8CA0",
      align: "right",
    });
  }
  const lines = (s.code?.text ?? "").split("\n");
  const fs = lines.length > 12 ? 11 : 13;
  slide.addText(s.code?.text ?? "", {
    x: ML + 0.3,
    y: CONTENT_Y + 0.6,
    w: CW - 0.6,
    h: CONTENT_H - 0.8,
    fontFace: FONT_MONO,
    fontSize: fs,
    color: "E6EDF3",
    align: "left",
    valign: "top",
    lineSpacingMultiple: 1.05,
  });
  footer(slide, d, brand, num);
}

function renderClosing(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const items = s.bullets ?? [];
  const n = Math.max(items.length, 1);
  // Every module ends on a takeaways slide; a single vertical ✓ list 8× in a row
  // is the deck's most repetitive beat. With 4+ items lay them out as a 2-column
  // "cheat sheet" card grid; 1–3 items stay a clean single column.
  const cols = n >= 4 ? 2 : 1;
  const rows = Math.ceil(n / cols);
  const gap = 0.28;
  const colW = (CW - gap * (cols - 1)) / cols;
  const cellH = (CONTENT_H - gap * (rows - 1)) / rows;
  const fs = cols === 2 ? 14 : 15;
  items.forEach((b, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = ML + col * (colW + gap);
    const y = CONTENT_Y + row * (cellH + gap);
    slide.addShape("roundRect", {
      x, y: y + 0.06, w: colW, h: cellH - 0.12, rectRadius: 0.06,
      fill: { color: d.surface }, line: { type: "none" },
    });
    slide.addText("✓", {
      x: x + 0.18, y: y + 0.06, w: 0.46, h: cellH - 0.12,
      fontFace: FONT_BODY, fontSize: 17, bold: true, color: d.accent2,
      align: "center", valign: "middle",
    });
    slide.addText(b, {
      x: x + 0.72, y: y + 0.06, w: colW - 0.92, h: cellH - 0.12,
      fontFace: FONT_BODY, fontSize: fs, color: d.text,
      valign: "middle", lineSpacingMultiple: 1.04,
    });
  });
  footer(slide, d, brand, num);
}

// ── extra premium layouts (rotated in to break the bullets/cards monotony) ──

/** Bullets as full-width horizontal bands, alternating accent / surface, each
 *  with a numbered chip. A clean, magazine-like rhythm distinct from a plain list. */
function renderBands(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const items = (s.bullets ?? []).slice(0, 6);
  const n = Math.max(items.length, 1);
  const gap = 0.16;
  const bandH = (CONTENT_H - gap * (n - 1)) / n;
  const fs = autoBodyFontSize(items.length, items.join("").length);
  items.forEach((b, i) => {
    const y = CONTENT_Y + i * (bandH + gap);
    const accentBand = i % 2 === 0;
    slide.addShape("roundRect", {
      x: ML, y, w: CW, h: bandH, rectRadius: 0.06,
      fill: { color: accentBand ? d.accent : d.surface }, line: { type: "none" },
    });
    slide.addShape("ellipse", {
      x: ML + 0.24, y: y + bandH / 2 - 0.22, w: 0.44, h: 0.44,
      fill: { color: accentBand ? d.accent2 : d.accent }, line: { type: "none" },
    });
    slide.addText(String(i + 1), {
      x: ML + 0.24, y: y + bandH / 2 - 0.22, w: 0.44, h: 0.44,
      fontFace: FONT_BODY, fontSize: 14, bold: true, color: d.onAccent,
      align: "center", valign: "middle",
    });
    slide.addText(b, {
      x: ML + 0.94, y, w: CW - 1.2, h: bandH,
      fontFace: FONT_BODY, fontSize: fs, color: accentBand ? d.onAccent : d.text,
      valign: "middle", lineSpacingMultiple: 1.02,
    });
  });
  footer(slide, d, brand, num);
}

/** Bullets as a vertical timeline-style spine with numbered nodes. */
function renderNumberedList(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const items = (s.bullets ?? []).slice(0, 6);
  const n = Math.max(items.length, 1);
  const rowH = CONTENT_H / n;
  const lineX = ML + 0.4;
  const fs = autoBodyFontSize(items.length, items.join("").length);
  if (n > 1) {
    slide.addShape("line", {
      x: lineX, y: CONTENT_Y + rowH / 2, w: 0, h: rowH * (n - 1),
      line: { color: d.border, width: 1.5 },
    });
  }
  items.forEach((b, i) => {
    const cy = CONTENT_Y + i * rowH + rowH / 2;
    slide.addShape("ellipse", {
      x: lineX - 0.27, y: cy - 0.27, w: 0.54, h: 0.54,
      fill: { color: d.accent }, line: { color: d.bg, width: 2 },
    });
    slide.addText(String(i + 1), {
      x: lineX - 0.27, y: cy - 0.27, w: 0.54, h: 0.54,
      fontFace: FONT_BODY, fontSize: 15, bold: true, color: d.onAccent,
      align: "center", valign: "middle",
    });
    slide.addText(b, {
      x: lineX + 0.55, y: cy - rowH / 2, w: ML + CW - (lineX + 0.55) - 0.1, h: rowH,
      fontFace: FONT_BODY, fontSize: fs, color: d.text,
      valign: "middle", lineSpacingMultiple: 1.03,
    });
  });
  footer(slide, d, brand, num);
}

/** Cards as a radial hub-and-spokes diagram: a central concept with satellites
 *  arranged on a ring, joined by connector lines. Premium, distinct from a grid. */
function renderRadial(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const cards = (s.cards ?? []).slice(0, 5);
  const N = Math.max(cards.length, 1);
  const cx = ML + CW / 2;
  const cy = CONTENT_Y + CONTENT_H / 2;
  const hubR = 0.9;
  const ringRx = CW / 2 - 1.55;
  const ringRy = CONTENT_H / 2 - 0.55;
  const pos = cards.map((_, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / N;
    return { x: cx + ringRx * Math.cos(ang), y: cy + ringRy * Math.sin(ang) };
  });
  // connectors (drawn first, behind the nodes). PowerPoint DROPS shapes whose
  // <a:ext> is negative, so a raw negative w/h (nodes left of / above the hub)
  // renders no line at all. Use an absolute bounding box + flipH/flipV instead.
  pos.forEach((p) => {
    slide.addShape("line", {
      x: Math.min(cx, p.x), y: Math.min(cy, p.y),
      w: Math.abs(p.x - cx), h: Math.abs(p.y - cy),
      flipH: p.x < cx, flipV: p.y < cy,
      line: { color: d.border, width: 1.25 },
    });
  });
  // hub
  slide.addShape("ellipse", {
    x: cx - hubR, y: cy - hubR, w: hubR * 2, h: hubR * 2,
    fill: { color: d.accent }, line: { type: "none" },
  });
  // Rótulo central: o ASSUNTO do título, não suas duas primeiras palavras. A
  // regra mora em layout-fit.ts, com teste — foi ela que devolvia "PPA: Plano".
  const hub = rotuloDoNucleo(s.title, 2, 22);
  slide.addText(hub, {
    x: cx - hubR + 0.05, y: cy - hubR, w: hubR * 2 - 0.1, h: hubR * 2,
    fontFace: FONT_BODY, fontSize: hub.length > 14 ? 11 : 12, bold: true,
    color: d.onAccent, align: "center", valign: "middle", lineSpacingMultiple: 0.95,
  });
  // satellites
  const satW = 2.5, satH = 1.0;
  cards.forEach((c, i) => {
    const p = pos[i];
    slide.addShape("roundRect", {
      x: p.x - satW / 2, y: p.y - satH / 2, w: satW, h: satH, rectRadius: 0.07,
      fill: { color: d.surface }, line: { color: d.border, width: 1 },
    });
    slide.addText(c.heading ?? "", {
      x: p.x - satW / 2 + 0.12, y: p.y - satH / 2 + 0.08, w: satW - 0.24, h: 0.34,
      fontFace: FONT_BODY, fontSize: 12, bold: true, color: d.accent2,
      align: "center", valign: "middle",
    });
    if (c.body) {
      slide.addText(c.body, {
        x: p.x - satW / 2 + 0.12, y: p.y - satH / 2 + 0.42, w: satW - 0.24, h: satH - 0.5,
        fontFace: FONT_BODY, fontSize: 10, color: d.text,
        align: "center", valign: "top", lineSpacingMultiple: 0.98,
      });
    }
  });
  footer(slide, d, brand, num);
}

/** Steps as an ascending cascade of panels (a "staircase") — conveys progression. */
function renderStairs(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const steps = (s.steps ?? []).slice(0, 5);
  const n = Math.max(steps.length, 1);
  const rowH = CONTENT_H / n;
  const indentMax = Math.min(2.2, CW * 0.2);
  steps.forEach((st, i) => {
    const indent = n > 1 ? (indentMax * i) / (n - 1) : 0;
    const y = CONTENT_Y + i * rowH;
    const x = ML + indent;
    const w = CW - indent;
    // TODOS OS DEGRAUS IGUAIS
    //
    // Aqui havia `const accent = i % 2 === 0`, que pintava os passos 1 e 3 de
    // laranja cheio e o 2 e o 4 de escuro. A alternância era decoração, mas
    // ninguém lê decoração: lê ênfase, e conclui que os ímpares importam mais.
    // Num processo em que todo passo é obrigatório, isso é afirmação falsa — o
    // mesmo defeito da rosca repartida em fatias iguais e da fila de setas
    // sobre uma lista que não tem ordem.
    //
    // A progressão continua visível por meios que não mentem: cada degrau
    // recua um pouco mais que o anterior e o número cresce. A barra de acento à
    // esquerda devolve o ritmo vertical que a alternância dava, sem hierarquia.
    slide.addShape("roundRect", {
      x, y: y + 0.06, w, h: rowH - 0.12, rectRadius: 0.06,
      fill: { color: d.surface }, line: { type: "none" },
    });
    slide.addShape("rect", {
      x, y: y + 0.06, w: 0.06, h: rowH - 0.12,
      fill: { color: d.accent }, line: { type: "none" },
    });
    slide.addText(String(i + 1), {
      x: x + 0.22, y: y + 0.06, w: 0.7, h: rowH - 0.12,
      fontFace: FONT_TITLE, fontSize: 24, bold: true,
      color: d.accent2, align: "left", valign: "middle",
    });
    slide.addText(st.heading ?? "", {
      x: x + 0.99, y: y + 0.1, w: w - 1.19, h: (rowH - 0.12) * (st.body ? 0.5 : 1),
      fontFace: FONT_BODY, fontSize: 14, bold: true,
      color: d.text, valign: "middle",
    });
    if (st.body) {
      slide.addText(st.body, {
        x: x + 0.99, y: y + (rowH - 0.12) * 0.5, w: w - 1.19, h: (rowH - 0.12) * 0.45,
        fontFace: FONT_BODY, fontSize: 11,
        color: d.subtext, valign: "middle", lineSpacingMultiple: 1.0,
      });
    }
  });
  footer(slide, d, brand, num);
}

// ── infographic layouts (rotate into the BULLETS family to break the "every
//    slide is a card grid" monotony). Each consumes s.bullets (short items),
//    uses palette tokens only, and degrades gracefully on any theme. ──────────

/** Blend two RRGGBB hex colours (t: 0 → a, 1 → b). Drives segment/ramp colours. */
function hexLerp(a: string, b: string, t: number): string {
  const ca = [0, 2, 4].map((i) => parseInt(a.slice(i, i + 2), 16));
  const cb = [0, 2, 4].map((i) => parseInt(b.slice(i, i + 2), 16));
  return ca
    .map((v, i) => Math.round(v + (cb[i] - v) * t).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** Trimmed, non-empty bullets, capped. */
function bulletItems(s: SlideSpec, max: number): string[] {
  return (s.bullets ?? []).map((b) => (b || "").trim()).filter(Boolean).slice(0, max);
}

/** Horizontal chevron flow — an ordered process / sequence. */
function renderProcessArrows(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const items = bulletItems(s, 5);
  const n = Math.max(items.length, 1);
  const gap = 0.1;
  const chW = (CW - gap * (n - 1)) / n;

  // GEOMETRIA DO CHEVRON — por que o texto vazava
  //
  // O preset `chevron` do OOXML tem entalhe à esquerda e bico à direita, ambos
  // com profundidade x1 = min(w,h)/2 (ajuste padrão 50000). A consequência não é
  // uma margem: é que a faixa preenchida tem largura CONSTANTE (w − x1) e
  // DESLIZA na diagonal conforme se sobe ou desce. Com 4 chevrons de 2,91 × 2,30
  // pol, a faixa ia de x=0,90 a x=2,66 na altura do topo do texto e de x=0,25 a
  // x=2,01 na altura da base — 0,65 pol de deslocamento entre uma linha e outra.
  //
  // Por isso nenhum recuo resolvia, e ajustá-lo era enxugar gelo: o valor que
  // continha a primeira linha deixava a última para fora, e vice-versa. Para um
  // bloco de texto que cruza o meio, a largura de fato segura é
  // w − x1·(1 + uMax), que naquela proporção dava 0,86 pol — menos que uma
  // palavra.
  //
  // A correção tira o texto de dentro da forma. O chevron carrega só o número,
  // centrado na vertical, onde a faixa é mais larga e praticamente não desliza;
  // a legenda vai ABAIXO, na largura inteira da coluna, onde não há forma
  // nenhuma para conter. A metáfora visual da seta continua, e o texto passa a
  // ter espaço real.
  const chH = 1.5;
  const capH = 0.8;
  const blocoH = chH + 0.16 + capH;
  const y = CONTENT_Y + (CONTENT_H - blocoH) / 2;
  const fs = autoBodyFontSize(n, items.join("").length);

  // A caixa do número precisa de duas coisas ao mesmo tempo: cair no CENTRO
  // VISUAL da forma (que é w/2 — o entalhe da esquerda e o bico da direita têm
  // a mesma área e se anulam) e caber inteira dentro da faixa preenchida, que
  // é assimétrica em relação a esse centro. Centrar na faixa segura, como se
  // fazia antes, jogava o número 0,22 pol à direita do centro. A conta está em
  // chevron-geometry.ts, com teste.
  const numH = 0.62;
  const caixaNum = chevronNumberBox(chW, chH, numH);

  items.forEach((b, i) => {
    const x = ML + i * (chW + gap);
    // Todas as setas iguais, pelo mesmo motivo dos degraus em renderStairs:
    // `i % 2 === 0` pintava a 1 e a 3 de acento e a 2 e a 4 de superfície, e
    // quem olha lê ênfase onde havia só decoração. Numa sequência em que todo
    // passo é obrigatório, isso hierarquiza o que não tem hierarquia. A ordem
    // já é dita pela direção do bico e pelo número dentro de cada seta.
    slide.addShape("chevron", {
      x, y, w: chW, h: chH,
      fill: { color: d.accent }, line: { color: d.border, width: 1 },
    });
    slide.addText(String(i + 1), {
      x: x + caixaNum.dx, y: y + caixaNum.dy, w: caixaNum.w, h: caixaNum.h,
      fontFace: FONT_TITLE, fontSize: 26, bold: true,
      color: d.onAccent, align: "center", valign: "middle",
    });
    slide.addText(b, {
      x, y: y + chH + 0.16, w: chW, h: capH,
      fontFace: FONT_BODY, fontSize: fs, color: d.text,
      align: "center", valign: "top", lineSpacingMultiple: 1.0,
    });
  });
  footer(slide, d, brand, num);
}

/**
 * Stacked pyramid — pointed triangular apex over trapezoid tiers, LEFT-aligned,
 * with the short title INSIDE each tier and a longer description pulled out to
 * the right, joined by a connector line in that tier's colour (foundation →
 * peak). Form adapted from a user-supplied light-theme reference; here it reads
 * heading/body pairs and uses the active dark palette so it matches the deck.
 * Falls back gracefully: tiers whose item has no body just show the title.
 *
 * Geometry: every tier's top/bottom width is derived from a SINGLE pyramid
 * slope (half-width grows linearly with distance below the apex). Because the
 * tiers are separated by a small gap, each tier's floor is strictly NARROWER
 * than the ceiling of the tier below it — a true, continuous pyramid silhouette
 * with no overhang. The PowerPoint "trapezoid" preset can't express an arbitrary
 * top/bottom ratio (its top edge is locked at ~50% of the base), so the trapezoid
 * tiers are drawn as custom geometry with exact corner points.
 */
function renderPyramid(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const pairs = slideItemPairs(s).slice(0, 5);
  const n = Math.max(pairs.length, 1);

  // ── geometry (16:9, left-aligned pyramid; descriptions fill the right) ──
  // The apex tier gets extra height so its (necessarily narrow) triangle has
  // room for its label without the text spilling past the sloped sides.
  const gap = 0.16;
  const apexFactor = 1.6;                    // apex is 1.6× a normal tier's height
  const baseTierH = (CONTENT_H - gap * (n - 1)) / ((n - 1) + apexFactor);
  const totalH = CONTENT_H;                  // apex tip → base
  const baseW = Math.min(5.0, CW * 0.42);    // widest (base) tier
  const slope = baseW / 2 / totalH;          // half-width gained per unit height
  const cx = ML + baseW / 2;                  // pyramid centre x
  const descX = ML + baseW + 0.9;             // description column start
  const descW = (W - MR) - descX;
  const titleFs = n <= 3 ? 15 : 13;
  const descFs = n <= 3 ? 13 : 12;

  let y = CONTENT_Y;   // top of the current tier
  let relTop = 0;      // current tier's top, measured down from the apex tip
  pairs.forEach((p, i) => {
    const isTop = i === 0;
    const h = isTop ? baseTierH * apexFactor : baseTierH;
    const wTop = 2 * slope * relTop;          // ceiling width (0 for the apex)
    const wBot = 2 * slope * (relTop + h);    // floor width
    const color = n > 1 ? hexLerp(d.accent2, d.accent, i / (n - 1)) : d.accent;

    // 1 · the tier shape. Apex = pointed triangle; the rest = custom trapezoids
    //     whose exact top/bottom widths follow the single pyramid slope.
    if (isTop) {
      slide.addShape("triangle", {
        x: cx - wBot / 2, y, w: wBot, h,
        fill: { color }, line: { color: d.bg, width: 2 },
      });
    } else {
      slide.addShape("custGeom", {
        x: cx - wBot / 2, y, w: wBot, h,
        fill: { color }, line: { color: d.bg, width: 2 },
        points: [
          { x: (wBot - wTop) / 2, y: 0 },
          { x: (wBot + wTop) / 2, y: 0 },
          { x: wBot, y: h },
          { x: 0, y: h },
          { close: true },
        ],
      });
    }

    // 2 · short title INSIDE the tier. The apex is a narrow funnel, so it gets a
    //     smaller font and the label is pushed DOWN to the wide base of the
    //     triangle (valign bottom) and sized to that base width — fixing the
    //     overflow at the tip. Trapezoid tiers hug their narrower TOP width so
    //     wrapped lines never spill past the sloped sides.
    const innerW = isTop
      ? Math.max(wBot - 0.3, 0.6)
      : Math.max(wTop, wBot * 0.55) - 0.24;
    slide.addText(p.heading, {
      x: cx - innerW / 2,
      y: isTop ? y + h * 0.30 : y,
      w: innerW, h: isTop ? h * 0.66 : h,
      fontFace: FONT_BODY, fontSize: isTop ? Math.max(9, titleFs - 4) : titleFs,
      bold: true, color: d.onAccent,
      align: "center", valign: isTop ? "bottom" : "middle", lineSpacingMultiple: 0.96,
    });

    // 3 · connector line + 4 · description, only when a body exists. The line
    //     meets the sloped right edge at the tier's vertical midpoint.
    if (p.body && p.body.trim()) {
      const midW = (wTop + wBot) / 2;
      const rightEdge = cx + midW / 2;
      slide.addShape("line", {
        x: rightEdge - 0.05, y: y + h / 2,
        w: descX - 0.2 - (rightEdge - 0.05), h: 0,
        line: { color, width: 2 },
      });
      slide.addText(p.body, {
        x: descX, y, w: descW, h,
        fontFace: FONT_BODY, fontSize: descFs, color: d.text,
        align: "left", valign: "middle", lineSpacingMultiple: 1.05,
      });
    }

    y += h + gap;
    relTop += h + gap;
  });
  footer(slide, d, brand, num);
}

/** Geometric-marker list — a lighter alternative to plain bullets, and the safe
 *  fallback for longer / denser bullet sets. */
function renderMarkers(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const items = bulletItems(s, 6);
  const n = Math.max(items.length, 1);
  const rowH = CONTENT_H / n;
  const fs = autoBodyFontSize(n, items.join("").length);
  const mk = 0.34;
  items.forEach((b, i) => {
    const y = CONTENT_Y + i * rowH;
    slide.addShape("triangle", {
      x: ML + 0.05, y: y + rowH / 2 - mk / 2, w: mk, h: mk, rotate: 90,
      fill: { color: i % 2 === 0 ? d.accent2 : d.accent }, line: { type: "none" },
    });
    slide.addText(b, {
      x: ML + 0.6, y, w: CW - 0.7, h: rowH,
      fontFace: FONT_BODY, fontSize: fs, color: d.subtext,
      valign: "middle", lineSpacingMultiple: 1.03,
    });
    if (i < n - 1) {
      slide.addShape("line", {
        x: ML + 0.6, y: y + rowH, w: CW - 0.7, h: 0,
        line: { color: d.border, width: 0.5 },
      });
    }
  });
  footer(slide, d, brand, num);
}

// ── infographic layouts · batch 2 ───────────────────────────────────────────

/** Spiral of numbered nodes (left) + numbered legend (right) — an evolving cycle. */
function renderSpiral(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const items = bulletItems(s, 6);
  const n = Math.max(items.length, 1);
  const cx = ML + 2.5, cy = CONTENT_Y + CONTENT_H / 2;
  const rMin = 0.35, rMax = 2.05, turns = 1.6;
  const pos = items.map((_, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const ang = -Math.PI / 2 + t * turns * 2 * Math.PI;
    const r = rMin + t * (rMax - rMin);
    return { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) };
  });
  for (let i = 0; i < n - 1; i++) {
    const a = pos[i], b = pos[i + 1];
    slide.addShape("line", {
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
      flipH: b.x < a.x, flipV: b.y < a.y, line: { color: d.border, width: 1.5 },
    });
  }
  const r = 0.3;
  pos.forEach((p, i) => {
    const color = n > 1 ? hexLerp(d.accent, d.accent2, i / (n - 1)) : d.accent;
    slide.addShape("ellipse", { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2, fill: { color }, line: { color: d.bg, width: 2 } });
    slide.addText(String(i + 1), { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2, fontFace: FONT_TITLE, fontSize: 14, bold: true, color: d.onAccent, align: "center", valign: "middle" });
  });
  const legX = ML + 5.1, legW = ML + CW - legX;
  const rowH = Math.min(1.1, CONTENT_H / n);
  const startY = CONTENT_Y + (CONTENT_H - rowH * n) / 2;
  const fs = autoBodyFontSize(n, items.join("").length);
  items.forEach((b, i) => {
    const ry = startY + i * rowH;
    const color = n > 1 ? hexLerp(d.accent, d.accent2, i / (n - 1)) : d.accent;
    slide.addShape("ellipse", { x: legX, y: ry + rowH / 2 - 0.16, w: 0.34, h: 0.34, fill: { color }, line: { type: "none" } });
    slide.addText(String(i + 1), { x: legX, y: ry + rowH / 2 - 0.16, w: 0.34, h: 0.34, fontFace: FONT_BODY, fontSize: 11, bold: true, color: d.onAccent, align: "center", valign: "middle" });
    slide.addText(b, { x: legX + 0.5, y: ry, w: legW - 0.5, h: rowH, fontFace: FONT_BODY, fontSize: fs, color: d.subtext, valign: "middle", lineSpacingMultiple: 1.02 });
  });
  footer(slide, d, brand, num);
}

/** Network: a central concept with satellites joined by hub + peer links. */
function renderNetwork(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const items = bulletItems(s, 5);
  const N = Math.max(items.length, 1);
  const cx = ML + CW / 2, cy = CONTENT_Y + CONTENT_H / 2;
  const ringRx = CW / 2 - 1.7, ringRy = CONTENT_H / 2 - 0.7;
  const pos = items.map((_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / N;
    return { x: cx + ringRx * Math.cos(a), y: cy + ringRy * Math.sin(a) };
  });
  pos.forEach((p) => slide.addShape("line", {
    x: Math.min(cx, p.x), y: Math.min(cy, p.y), w: Math.abs(p.x - cx), h: Math.abs(p.y - cy),
    flipH: p.x < cx, flipV: p.y < cy, line: { color: d.border, width: 1 },
  }));
  if (N >= 3) {
    for (let i = 0; i < N; i++) {
      const a = pos[i], b = pos[(i + 1) % N];
      slide.addShape("line", {
        x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
        flipH: b.x < a.x, flipV: b.y < a.y, line: { color: d.border, width: 0.75, dashType: "dash" },
      });
    }
  }
  const hubR = 0.7;
  slide.addShape("ellipse", { x: cx - hubR, y: cy - hubR, w: hubR * 2, h: hubR * 2, fill: { color: d.accent }, line: { type: "none" } });
  // Mesma regra do outro núcleo — foi ESTA linha que produziu "PPA: Plano" no
  // slide "PPA: O Plano Plurianual". Ver rotuloDoNucleo, em layout-fit.ts.
  const hub = rotuloDoNucleo(s.title, 2, 18);
  slide.addText(hub, { x: cx - hubR + 0.04, y: cy - hubR, w: hubR * 2 - 0.08, h: hubR * 2, fontFace: FONT_BODY, fontSize: 11, bold: true, color: d.onAccent, align: "center", valign: "middle", lineSpacingMultiple: 0.95 });
  const sw = 2.5, sh = 0.9;
  const fs = autoBodyFontSize(N, items.join("").length);
  items.forEach((b, i) => {
    const p = pos[i];
    slide.addShape("roundRect", { x: p.x - sw / 2, y: p.y - sh / 2, w: sw, h: sh, rectRadius: 0.08, fill: { color: d.surface }, line: { color: d.border, width: 1 } });
    slide.addText(b, { x: p.x - sw / 2 + 0.14, y: p.y - sh / 2, w: sw - 0.28, h: sh, fontFace: FONT_BODY, fontSize: fs, color: d.subtext, align: "center", valign: "middle", lineSpacingMultiple: 0.98 });
  });
  footer(slide, d, brand, num);
}

/** Asymmetric modular panels: a bold feature panel + a stack of smaller ones. */
function renderAsymPanels(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const items = bulletItems(s, 5);
  const n = Math.max(items.length, 1);
  const gap = 0.18;
  const featW = CW * 0.44;
  const fs = autoBodyFontSize(n, items.join("").length);
  slide.addShape("roundRect", { x: ML, y: CONTENT_Y, w: featW, h: CONTENT_H, rectRadius: 0.06, fill: { color: d.accent }, line: { type: "none" } });
  slide.addText("01", { x: ML + 0.3, y: CONTENT_Y + 0.3, w: featW - 0.6, h: 0.8, fontFace: FONT_TITLE, fontSize: 34, bold: true, color: d.accent2, align: "left", valign: "top" });
  slide.addText(items[0] ?? "", { x: ML + 0.3, y: CONTENT_Y + 1.1, w: featW - 0.6, h: CONTENT_H - 1.4, fontFace: FONT_BODY, fontSize: fs + 2, bold: true, color: d.onAccent, align: "left", valign: "middle", lineSpacingMultiple: 1.03 });
  const rest = items.slice(1);
  const rx = ML + featW + gap, rw = CW - featW - gap;
  const m = Math.max(rest.length, 1);
  const rh = (CONTENT_H - gap * (m - 1)) / m;
  rest.forEach((b, i) => {
    const y = CONTENT_Y + i * (rh + gap);
    slide.addShape("roundRect", { x: rx, y, w: rw, h: rh, rectRadius: 0.06, fill: { color: d.surface }, line: { color: d.border, width: 1 } });
    slide.addText(String(i + 2).padStart(2, "0"), { x: rx + 0.22, y, w: 0.7, h: rh, fontFace: FONT_TITLE, fontSize: 20, bold: true, color: d.accent2, align: "left", valign: "middle" });
    slide.addText(b, { x: rx + 1.0, y, w: rw - 1.2, h: rh, fontFace: FONT_BODY, fontSize: fs, color: d.subtext, align: "left", valign: "middle", lineSpacingMultiple: 1.0 });
  });
  footer(slide, d, brand, num);
}

/** Numbered circular icons in a grid — a clean, scannable enumerated list. */
function renderNumberedIcons(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const items = bulletItems(s, 6);
  const n = Math.max(items.length, 1);
  const cols = n <= 3 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const gapX = 0.5, gapY = 0.22;
  const cellW = (CW - gapX * (cols - 1)) / cols;
  const cellH = (CONTENT_H - gapY * (rows - 1)) / rows;
  const fs = autoBodyFontSize(n, items.join("").length);
  const cr = 0.34;
  items.forEach((b, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = ML + c * (cellW + gapX), y = CONTENT_Y + r * (cellH + gapY);
    const cyc = y + cellH / 2;
    slide.addShape("ellipse", { x, y: cyc - cr, w: cr * 2, h: cr * 2, fill: { color: n > 1 ? hexLerp(d.accent, d.accent2, i / (n - 1)) : d.accent }, line: { type: "none" } });
    slide.addText(String(i + 1), { x, y: cyc - cr, w: cr * 2, h: cr * 2, fontFace: FONT_TITLE, fontSize: 16, bold: true, color: d.onAccent, align: "center", valign: "middle" });
    slide.addText(b, { x: x + cr * 2 + 0.25, y, w: cellW - cr * 2 - 0.35, h: cellH, fontFace: FONT_BODY, fontSize: fs, color: d.subtext, align: "left", valign: "middle", lineSpacingMultiple: 1.02 });
  });
  footer(slide, d, brand, num);
}

/** Staggered cards joined by diagonal arrows — a flowing, ordered progression. */
function renderDiagonalArrows(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const items = bulletItems(s, 5);
  const n = Math.max(items.length, 1);
  const padX = 0.3;
  const usableW = CW - 2 * padX;
  const slot = usableW / n;
  const cardW = Math.min(2.6, slot - 0.1);
  const cardH = 1.5;
  const yTop = CONTENT_Y + 0.4, yBot = FOOTER_Y - 0.15 - cardH;
  const fs = autoBodyFontSize(n, items.join("").length);
  const pos = items.map((_, i) => ({ x: ML + padX + slot * i + (slot - cardW) / 2, y: i % 2 === 0 ? yTop : yBot }));
  for (let i = 0; i < n - 1; i++) {
    const a = { x: pos[i].x + cardW, y: pos[i].y + cardH / 2 };
    const b = { x: pos[i + 1].x, y: pos[i + 1].y + cardH / 2 };
    slide.addShape("line", {
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
      flipH: b.x < a.x, flipV: b.y < a.y, line: { color: d.subtext, width: 1.25, endArrowType: "triangle" },
    });
  }
  items.forEach((b, i) => {
    const p = pos[i], accent = i % 2 === 0;
    slide.addShape("roundRect", { x: p.x, y: p.y, w: cardW, h: cardH, rectRadius: 0.08, fill: { color: accent ? d.accent : d.surface }, line: { color: d.border, width: 1 } });
    slide.addText(String(i + 1), { x: p.x + 0.14, y: p.y + 0.1, w: cardW - 0.28, h: 0.5, fontFace: FONT_TITLE, fontSize: 20, bold: true, color: d.accent2, align: "left", valign: "top" });
    slide.addText(b, { x: p.x + 0.16, y: p.y + 0.6, w: cardW - 0.32, h: cardH - 0.7, fontFace: FONT_BODY, fontSize: fs, color: accent ? d.onAccent : d.subtext, align: "left", valign: "top", lineSpacingMultiple: 1.0 });
  });
  footer(slide, d, brand, num);
}

/** Connection lines: a hub fanning out to labelled nodes (a mind-map spread). */
function renderConnectionLines(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const items = bulletItems(s, 6);
  const n = Math.max(items.length, 1);
  const ox = ML + 0.5, oy = CONTENT_Y + CONTENT_H / 2;
  const nodeX = ML + 3.4;
  const rowH = Math.min(1.1, CONTENT_H / n);
  const startY = CONTENT_Y + (CONTENT_H - rowH * n) / 2;
  const fs = autoBodyFontSize(n, items.join("").length);
  slide.addShape("ellipse", { x: ox - 0.28, y: oy - 0.28, w: 0.56, h: 0.56, fill: { color: d.accent }, line: { type: "none" } });
  items.forEach((b, i) => {
    const ny = startY + i * rowH + rowH / 2;
    slide.addShape("line", {
      x: Math.min(ox, nodeX), y: Math.min(oy, ny), w: Math.abs(nodeX - ox), h: Math.abs(ny - oy),
      flipH: nodeX < ox, flipV: ny < oy, line: { color: d.border, width: 1.25 },
    });
    const color = n > 1 ? hexLerp(d.accent, d.accent2, i / (n - 1)) : d.accent;
    slide.addShape("ellipse", { x: nodeX - 0.16, y: ny - 0.16, w: 0.32, h: 0.32, fill: { color }, line: { color: d.bg, width: 1.5 } });
    slide.addText(b, { x: nodeX + 0.32, y: ny - rowH / 2, w: ML + CW - (nodeX + 0.32) - 0.1, h: rowH, fontFace: FONT_BODY, fontSize: fs, color: d.subtext, align: "left", valign: "middle", lineSpacingMultiple: 1.02 });
  });
  footer(slide, d, brand, num);
}

/** Bullet-fed horizontal timeline — a clean, continuous sequence. Curated
 *  replacement for the noisier zig-zag / mountain layouts: feeds short bullets
 *  into the polished step timeline as heading-only nodes. */
function renderBulletTimeline(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  const items = bulletItems(s, 6);
  renderTimeline(slide, { ...s, steps: items.map((t) => ({ heading: t })) } as SlideSpec, d, brand, num, moduleLabel);
}

/** Localized copy for the course-closing slide. */
function outroStrings(language: string): { eyebrow: string; title: string; lines: string[]; thanks: string } {
  const l = (language || "").toLowerCase();
  if (/portug/.test(l)) {
    return {
      eyebrow: "Conclusão do Curso",
      title: "Parabéns, você concluiu o curso!",
      lines: [
        "Revise os conceitos com os quizzes e flashcards do curso.",
        "Conclua a avaliação final para validar seu aprendizado.",
        "Receba seu certificado de conclusão.",
      ],
      thanks: "Obrigado por participar.",
    };
  }
  if (/espa|spanish/.test(l)) {
    return {
      eyebrow: "Conclusión del Curso",
      title: "¡Felicidades, has completado el curso!",
      lines: [
        "Repasa los conceptos con los cuestionarios y flashcards del curso.",
        "Completa la evaluación final para validar tu aprendizaje.",
        "Recibe tu certificado de finalización.",
      ],
      thanks: "Gracias por participar.",
    };
  }
  if (/fran|french/.test(l)) {
    return {
      eyebrow: "Conclusion du Cours",
      title: "Félicitations, vous avez terminé le cours !",
      lines: [
        "Révisez les concepts avec les quiz et les flashcards du cours.",
        "Terminez l'évaluation finale pour valider vos acquis.",
        "Recevez votre certificat de réussite.",
      ],
      thanks: "Merci de votre participation.",
    };
  }
  return {
    eyebrow: "Course Conclusion",
    title: "Congratulations, you've completed the course!",
    lines: [
      "Review the concepts with the course quizzes and flashcards.",
      "Complete the final assessment to validate your learning.",
      "Receive your certificate of completion.",
    ],
    thanks: "Thank you for participating.",
  };
}

/** Final course-level closing: a cover-style "well done + next steps" slide that
 *  mentions the assessment / certificate. Distinct from per-module closings. */
function renderCourseOutro(slide: AnySlide, d: Palette, brand: string, num: number, language: string) {
  const t = outroStrings(language);
  bgFill(slide, d.coverBg);
  slide.addText(eyebrow(t.eyebrow), {
    x: ML, y: 1.35, w: CW, h: 0.4,
    fontFace: FONT_BODY, fontSize: 13, bold: true, color: d.accent2,
    charSpacing: 3, align: "center",
  });
  slide.addText(t.title, {
    x: 1.2, y: 1.9, w: W - 2.4, h: 1.0,
    fontFace: FONT_TITLE, fontSize: t.title.length > 48 ? 26 : 30, bold: true,
    color: "FFFFFF", align: "center", valign: "middle",
  });
  t.lines.forEach((ln, i) => {
    const y = 3.35 + i * 0.62;
    slide.addText("✓", {
      x: 2.3, y, w: 0.4, h: 0.5,
      fontFace: FONT_BODY, fontSize: 16, bold: true, color: d.accent2,
      align: "center", valign: "middle",
    });
    slide.addText(ln, {
      x: 2.8, y, w: W - 2.8 - 2.3, h: 0.5,
      fontFace: FONT_BODY, fontSize: 16, color: "E8EEF5",
      align: "left", valign: "middle",
    });
  });
  slide.addShape("rect", {
    x: W / 2 - 0.5, y: 5.7, w: 1.0, h: 0.05,
    fill: { color: d.accent2 }, line: { type: "none" },
  });
  slide.addText(t.thanks, {
    x: 1.2, y: 5.9, w: W - 2.4, h: 0.5,
    fontFace: FONT_BODY, fontSize: 14, italic: true, color: d.subtext, align: "center",
  });
  footer(slide, { ...d, subtext: "8595A6" }, brand, num);
}

// ── orchestrator ────────────────────────────────────────────────────────────

/**
 * Render the whole deck. `PptxGenJS` is injected (constructor). Returns the
 * pptx instance ready for .write(). Never throws on a single bad slide.
 */
export function renderDeck(
  PptxGenJS: any,
  deck: PlannedDeck,
  opts: RenderOptions = {},
): { pptx: AnyPptx; slideCount: number } {
  const d = resolvePalette(opts);
  const brand = opts.footerBrand || "EduGenAI";
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "EDU16x9", width: W, height: H });
  pptx.layout = "EDU16x9";
  pptx.author = brand;
  pptx.title = deck.courseTitle;
  // Left unset, PptxGenJS stamps dc:subject with its own name — the literal
  // string "PptxGenJS Presentation" showed up in the file's properties.
  pptx.subject = deck.subtitle?.trim() || deck.courseTitle;
  // O carimbo de build viaja aqui: invisível nos slides, legível nas
  // propriedades do arquivo. Ver V7_BUILD, no topo.
  pptx.company = `${brand} · v7 ${V7_BUILD}`;

  let num = 0;
  const add = () => {
    num++;
    return pptx.addSlide();
  };
  let compareCount = 0; // drives the compare round-robin across the whole deck
  let bulletsVar = 0;   // rotates bullet-family layouts (list / bands / numbered)
  let cardsVar = 0;     // rotates card-family layouts (grid / radial)
  let stepsVar = 0;     // rotates step-family layouts (list / staircase)

  // Cover
  renderCover(add(), deck, d, brand);
  // Agenda
  renderTOC(add(), deck, d, brand);

  deck.modules.forEach((m, mi) => {
    // Module divider (if the planner didn't already provide a section slide).
    if (m.slides[0]?.kind !== "section") {
      // Sem imageData de propósito: a divisória reaproveitava a foto do slide
      // de destaque do módulo, e a mesma imagem aparecia duas vezes em poucos
      // segundos — esmaecida aqui, em brilho normal logo adiante. Ver o
      // comentário em index.ts. O número gigante segura a página sozinho.
      renderSection(add(), {
        kind: "section",
        title: m.title,
        eyebrow: m.title,
      }, d, mi + 1, m.objectives ?? []);
    }
    // Per-module memory for the anti-repetition guard: two card-family grids in
    // a row are visually monotonous, so the SECOND becomes a sidebar layout.
    let prevCardLike = false;
    const cardLikeKind = (k: string) => k === "cards" || k === "bento" || k === "tiles";
    for (const s of m.slides) {
      try {
        const slide = add();
        // Notes are layout-independent, so attach them up front — the two
        // early `continue` branches below would otherwise skip them.
        speakerNotes(slide, s);
        const cardLike = cardLikeKind(s.kind);
        // (1) Single-point card/bullets/steps slide → high-impact statement
        // instead of one giant near-empty card.
        if ((cardLike || s.kind === "bullets" || s.kind === "steps") && contentItemCount(s) === 1) {
          renderHighlight(slide, s, d, brand, num, m.title);
          prevCardLike = false;
          continue;
        }
        // (2) Two card grids back-to-back → swap the 2nd for a sidebar layout.
        if (cardLike && prevCardLike) {
          renderSidebar(slide, s, d, brand, num, m.title);
          prevCardLike = false;
          continue;
        }
        prevCardLike = cardLike;
        switch (s.kind) {
          case "section":
            renderSection(slide, s, d, mi + 1);
            break;
          case "tiles":
            renderTiles(slide, s, d, brand, num, m.title);
            break;
          case "bento":
            renderBento(slide, s, d, brand, num, m.title);
            break;
          case "cards": {
            const nc = (s.cards ?? []).length;
            if (nc >= 3 && nc <= 5) {
              // Rotate cards across cards / radial / pyramid so a module with
              // several card slides doesn't repeat the same grid. The pyramid
              // (title inside + description on the right) needs heading+body —
              // which cards always carry.
              const v = cardsVar++ % 3;
              if (v === 1) renderRadial(slide, s, d, brand, num, m.title);
              else if (v === 2) renderPyramid(slide, s, d, brand, num, m.title);
              else renderCards(slide, s, d, brand, num, m.title);
            } else {
              renderCards(slide, s, d, brand, num, m.title);
            }
            break;
          }
          case "steps": {
            // O CHEVRON MORAVA NO LUGAR ERRADO
            //
            // Ele só existia no rodízio dos slides de BULLETS, atrás do
            // detector ehSequencia — que serve para impedir que uma lista sem
            // ordem ganhe cara de processo. A trava está certa; o endereço
            // estava errado. Conteúdo em ordem o planejador classifica como
            // "steps", e o rodízio de steps não tinha chevron nenhum. Resultado:
            // a forma só podia aparecer quando o planejador ERRAVA de categoria
            // — exatamente o caso que o prompt manda evitar. Na prática, nunca
            // aparecia.
            //
            // Aqui a ordem é garantida pelo TIPO do slide: um "steps" é
            // ordenado por definição. O chevron faz afirmação verdadeira por
            // construção, sem depender de detector.
            //
            // Só entra com rótulo curto, porque a seta carrega o número dentro
            // e a legenda embaixo, na largura de uma coluna estreita. Texto
            // longo ali vira duas linhas apertadas — o mesmo motivo pelo qual
            // renderSteps escolhe a linha do tempo apenas para passos curtos.
            const passos = s.steps ?? [];
            // Ver chevronCabe, em layout-fit.ts: além do rótulo curto e da
            // contagem, exige que NENHUM passo tenha corpo — a seta desenha só
            // o rótulo, e passar-lhe um passo com corpo apaga o corpo.
            const cabeRotulo = chevronCabe(passos);
            const v = stepsVar++ % (cabeRotulo ? 3 : 2);
            if (v === 1) renderStairs(slide, s, d, brand, num, m.title);
            else if (v === 2) {
              // renderProcessArrows lê s.bullets. Os títulos dos passos são o
              // que cabe na seta; o corpo fica de fora, como já ficava na
              // linha do tempo.
              renderProcessArrows(
                slide,
                { ...s, bullets: passos.map((st) => st.heading ?? "").filter(Boolean) },
                d, brand, num, m.title,
              );
            } else renderSteps(slide, s, d, brand, num, m.title);
            break;
          }
          case "compare":
            renderCompare(slide, s, d, brand, num, m.title, compareCount++);
            break;
          case "matrix":
            renderMatrix(slide, s, d, brand, num, m.title);
            break;
          case "table":
            renderTable(slide, s, d, brand, num, m.title);
            break;
          case "quote":
            renderQuote(slide, s, d, brand, num);
            break;
          case "stat":
            renderStat(slide, s, d, brand, num);
            break;
          case "chart":
            renderChart(slide, s, d, brand, num, m.title);
            break;
          case "code":
            renderCode(slide, s, d, brand, num, m.title);
            break;
          case "closing": {
            // O RECAP ERA O MESMO SLIDE CINCO VEZES
            //
            // Um por módulo, todos com o mesmo desenho e quase o mesmo título
            // ("Principais Aprendizados" aparecia duas vezes idêntico no deck
            // de estoque). A FUNÇÃO deve mesmo se repetir — todo módulo fecha
            // recapitulando, e é isso que dá identidade ao material. A FORMA
            // não precisa. Alterna pelo índice do módulo, o que mantém o
            // resultado determinístico: o mesmo curso gera o mesmo deck.
            const vc = mi % 3;
            if (vc === 1) renderBands(slide, s, d, brand, num, m.title);
            else if (vc === 2) renderNumberedList(slide, s, d, brand, num, m.title);
            else renderClosing(slide, s, d, brand, num, m.title);
            break;
          }
          case "bullets":
          default: {
            if (s.imageData) {
              renderBullets(slide, s, d, brand, num, m.title);
            } else {
              // SINGLE source of bullet-slide variety (consolidated from the old
              // normalize-level breakLayoutRuns). Every short, image-less bullets
              // slide rotates across one rich pool so no two look the same — a
              // plain vertical list is the "auto-converted" look we avoid here.
              const its = (s.bullets ?? []).map((b) => (b || "").trim()).filter(Boolean);
              const k = its.length;
              // Shape-based diagrams place text INSIDE shapes, so they need short
              // items; tiles/bento need scannable short phrases. Long / 6+ item
              // lists stay list-style (bullets / markers) to avoid overflow.
              const short = its.every((b) => b.length <= 58);
              const wordShort = its.every((b) => b.trim().split(/\s+/).length <= 10);
              const variants: Array<typeof renderBullets> = [];
              if (k >= 3 && k <= 5 && short) {
                // O rodízio garante VARIEDADE, mas variedade não pode custar
                // veracidade: uma forma que afirma estrutura (ordem, proporção)
                // só entra no sorteio quando o conteúdo tem essa estrutura.
                //
                // Setas, espiral, linha do tempo e diagonais afirmam ORDEM.
                // Numa lista comum — duas características e três exemplos, por
                // exemplo — elas transformam tópicos soltos num processo de
                // cinco etapas que ninguém escreveu. Ficam atrás do detector.
                //
                // A rosca segmentada saiu de vez: dividida em partes iguais,
                // ela afirma proporções que a lista não tem, e não existe
                // conteúdo de lista neste produto em que essa afirmação seja
                // verdadeira. Proporção tem um lugar próprio — kind "chart",
                // onde o planejador fornece números de verdade.
                if (ehSequencia(s.title, its)) {
                  variants.push(
                    renderProcessArrows, renderDiagonalArrows,
                    renderBulletTimeline, renderSpiral,
                  );
                }
                // NUMERAR TAMBÉM É AFIRMAR ORDEM
                //
                // A regra acima — forma que afirma estrutura só entra quando o
                // conteúdo tem essa estrutura — valia para setas, espiral e
                // linha do tempo, e deixava de fora justamente o sinal mais
                // literal de todos: 1, 2, 3, 4. No deck de 22/08 o slide "O Que
                // é a Curva ABC?" saiu numerado em quatro cartões. São quatro
                // ATRIBUTOS de uma definição — ferramenta de gestão, baseada em
                // importância, fundamentada em Pareto, divide em A/B/C —, não
                // quatro etapas. Numerá-los promete uma ordem que ninguém
                // escreveu e que o aluno vai procurar.
                //
                // Bento, ícones numerados e painéis assimétricos carregam
                // número. Passam a ficar atrás do mesmo detector das setas.
                // Para lista sem ordem sobram rede, linhas de conexão e
                // marcadores — três formas, variedade preservada, sem afirmar
                // o que o conteúdo não diz.
                if (ehSequencia(s.title, its)) {
                  variants.push(renderNumberedIcons, renderAsymPanels);
                  if (wordShort && k <= 4) variants.push(renderBento);
                }
                variants.push(
                  renderNetwork, renderConnectionLines, renderMarkers,
                );
              } else if (k === 2 && wordShort) {
                // Com dois itens o bento não numera nada que possa enganar:
                // "1" e "2" ao lado um do outro leem-se como duas colunas.
                variants.push(renderBullets, renderBento, renderMarkers);
              } else {
                variants.push(renderBullets, renderMarkers);
                if (k <= 6) variants.push(renderConnectionLines);
                if (k <= 6 && ehSequencia(s.title, its)) {
                  variants.push(renderNumberedIcons);
                }
              }
              variants[bulletsVar++ % variants.length](slide, s, d, brand, num, m.title);
            }
            break;
          }
        }
      } catch (err) {
        console.warn(`[V7-RENDER] slide failed (${s.kind}) — skipped:`, err);
      }
    }
  });

  // Course-level closing (well done + assessment/certificate). Only for a real
  // multi-module deck — skip the degenerate empty/junk case.
  if (deck.modules.length > 0) {
    try {
      renderCourseOutro(add(), d, brand, num, opts.language ?? "");
    } catch (err) {
      console.warn("[V7-RENDER] course outro failed — skipped:", err);
    }
  }

  return { pptx, slideCount: num };
}
