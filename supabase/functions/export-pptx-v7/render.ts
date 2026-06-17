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
  slide.addText(eyebrow(s.eyebrow || moduleLabel), {
    x: ML + 0.18,
    y: 0.5,
    w: CW - 0.4,
    h: 0.28,
    fontFace: FONT_BODY,
    fontSize: 10,
    bold: true,
    color: d.accent2,
    charSpacing: 2,
    align: "left",
    valign: "middle",
  });
  slide.addText(s.title, {
    x: ML + 0.18,
    y: 0.78,
    w: CW - 0.4,
    h: 0.62,
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
    slide.addImage({ data: s.imageData, ...box, sizing: { type: "cover", w: box.w, h: box.h }, ...extra });
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

function renderSection(slide: AnySlide, s: SlideSpec, d: Palette, index: number) {
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
  slide.addText(s.title, {
    x: ML, y: 4.78, w: hasImg ? 7.9 : 11.4, h: 2.1,
    fontFace: FONT_TITLE, fontSize: s.title.length > 44 ? 32 : 42, bold: true,
    color: "FFFFFF", valign: "top", lineSpacingMultiple: 1.02,
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
  slide.addText(eyebrow(s.eyebrow || moduleLabel), {
    x: colX + 0.18, y: 0.68, w: colW - 0.18, h: 0.3,
    fontFace: FONT_BODY, fontSize: 10, bold: true, color: d.accent2,
    charSpacing: 2, valign: "middle",
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
  slide.addText(eyebrow(s.eyebrow || moduleLabel), {
    x: ML + 0.18, y: ty, w: CW - 0.18, h: 0.3,
    fontFace: FONT_BODY, fontSize: 10, bold: true, color: d.accent2,
    charSpacing: 2, valign: "middle",
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
  const cols = n <= 2 ? n : 2;
  const rows = Math.ceil(n / cols);
  const gap = 0.3;
  const cardW = (CW - gap * (cols - 1)) / cols;
  const cardH = (CONTENT_H - gap * (rows - 1)) / rows;
  const chip = 0.5;
  items.forEach((b, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const itemsInRow = Math.min(cols, n - row * cols);
    const rowOffset = (CW - (itemsInRow * cardW + gap * (itemsInRow - 1))) / 2;
    const x = ML + rowOffset + col * (cardW + gap);
    const y = CONTENT_Y + row * (cardH + gap);
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
      fontFace: FONT_BODY, fontSize: n <= 2 ? 17 : 15, color: d.text,
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

function renderCompare(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const gap = 0.5;
  const colW = (CW - gap) / 2;
  const cols = [
    { col: s.left!, x: ML, accent: d.accent },
    { col: s.right!, x: ML + colW + gap, accent: d.accent2 },
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
    slide.addText("“", {
      x: 0.6, y: 0.05, w: 3, h: 2.4,
      fontFace: "Georgia", fontSize: 200, bold: true,
      color: "FFFFFF", transparency: 82, align: "left", valign: "top",
    });
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
  bgFill(slide, d.surface);
  slide.addShape("rect", {
    x: 0, y: 0, w: 0.18, h: H,
    fill: { color: d.accent2 }, line: { type: "none" },
  });
  // Decorative quotation marks as a subtle adornment in the corners (not behind
  // the text), in an elegant serif and the accent colour at 20% opacity — the
  // "respiro" premium look. pptxgenjs renders text transparency as <a:alpha>.
  slide.addText("“", {
    x: ML - 0.1, y: 0.05, w: 3, h: 2.4,
    fontFace: "Georgia", fontSize: 200, bold: true,
    color: d.accent2, transparency: 80,
    align: "left", valign: "top",
  });
  slide.addText("”", {
    x: W - 3 - (ML - 0.1), y: H - 2.6, w: 3, h: 2.4,
    fontFace: "Georgia", fontSize: 200, bold: true,
    color: d.accent2, transparency: 80,
    align: "right", valign: "bottom",
  });
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
      fontSize: 12,
      bold: true,
      color: d.accent2,
      charSpacing: 3,
      align: "center",
    });
  }
  slide.addText(s.stat?.value ?? s.title, {
    x: ML,
    y: 2.3,
    w: CW,
    h: 2.2,
    fontFace: FONT_TITLE,
    fontSize: 130,
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
  const rowH = CONTENT_H / Math.max(items.length, 1);
  items.forEach((b, i) => {
    const y = CONTENT_Y + i * rowH;
    slide.addShape("roundRect", {
      x: ML,
      y: y + 0.06,
      w: CW,
      h: rowH - 0.18,
      rectRadius: 0.06,
      fill: { color: d.surface },
      line: { type: "none" },
    });
    slide.addText("✓", {
      x: ML + 0.2,
      y: y + 0.06,
      w: 0.5,
      h: rowH - 0.18,
      fontFace: FONT_BODY,
      fontSize: 18,
      bold: true,
      color: d.accent2,
      align: "center",
      valign: "middle",
    });
    slide.addText(b, {
      x: ML + 0.78,
      y: y + 0.06,
      w: CW - 1.0,
      h: rowH - 0.18,
      fontFace: FONT_BODY,
      fontSize: 15,
      color: d.text,
      valign: "middle",
    });
  });
  footer(slide, d, brand, num);
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

  let num = 0;
  const add = () => {
    num++;
    return pptx.addSlide();
  };

  // Cover
  renderCover(add(), deck, d, brand);
  // Agenda
  renderTOC(add(), deck, d, brand);

  deck.modules.forEach((m, mi) => {
    // Module divider (if the planner didn't already provide a section slide).
    if (m.slides[0]?.kind !== "section") {
      renderSection(add(), {
        kind: "section",
        title: m.title,
        eyebrow: m.title,
        imageData: m.slides.find((x) => x.imageData)?.imageData,
      }, d, mi + 1);
    }
    for (const s of m.slides) {
      try {
        const slide = add();
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
          case "cards":
            renderCards(slide, s, d, brand, num, m.title);
            break;
          case "steps":
            renderSteps(slide, s, d, brand, num, m.title);
            break;
          case "compare":
            renderCompare(slide, s, d, brand, num, m.title);
            break;
          case "quote":
            renderQuote(slide, s, d, brand, num);
            break;
          case "stat":
            renderStat(slide, s, d, brand, num);
            break;
          case "code":
            renderCode(slide, s, d, brand, num, m.title);
            break;
          case "closing":
            renderClosing(slide, s, d, brand, num, m.title);
            break;
          case "bullets":
          default:
            renderBullets(slide, s, d, brand, num, m.title);
            break;
        }
      } catch (err) {
        console.warn(`[V7-RENDER] slide failed (${s.kind}) — skipped:`, err);
      }
    }
  });

  return { pptx, slideCount: num };
}
