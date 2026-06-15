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
};

export interface RenderOptions {
  palette?: string;
  footerBrand?: string;
}

type AnySlide = any;
type AnyPptx = any;

// ── small helpers ─────────────────────────────────────────────────────────
function p(pal: string | undefined): Palette {
  return PALETTES[pal ?? "default"] ?? PALETTES.default;
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
}) {
  if (!s.imageData) return false;
  try {
    slide.addImage({ data: s.imageData, ...box, sizing: { type: "cover", w: box.w, h: box.h } });
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
  const hasImg = maybeImage(slide, s, { x: 7.6, y: 0, w: 5.73, h: H });
  if (hasImg) {
    slide.addShape("rect", {
      x: 6.6,
      y: 0,
      w: 1.2,
      h: H,
      fill: { color: d.coverBg, transparency: 10 },
      line: { type: "none" },
    });
  }
  slide.addText(`MÓDULO ${String(index).padStart(2, "0")}`, {
    x: ML,
    y: 2.7,
    w: 6.2,
    h: 0.4,
    fontFace: FONT_BODY,
    fontSize: 13,
    bold: true,
    color: d.accent2,
    charSpacing: 3,
  });
  slide.addShape("rect", {
    x: ML,
    y: 3.18,
    w: 0.9,
    h: 0.08,
    fill: { color: d.accent2 },
    line: { type: "none" },
  });
  slide.addText(s.title, {
    x: ML,
    y: 3.4,
    w: hasImg ? 5.8 : 11,
    h: 2.4,
    fontFace: FONT_TITLE,
    fontSize: s.title.length > 40 ? 30 : 38,
    bold: true,
    color: "FFFFFF",
    valign: "top",
    lineSpacingMultiple: 1.03,
  });
}

function renderBullets(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
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

function renderCards(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const cards = s.cards ?? [];
  const n = cards.length;
  const cols = n <= 2 ? n : n === 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const gap = 0.3;
  const cardW = (CW - gap * (cols - 1)) / cols;
  const cardH = (CONTENT_H - gap * (rows - 1)) / rows;
  cards.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = ML + col * (cardW + gap);
    const y = CONTENT_Y + row * (cardH + gap);
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
      y: y + 0.2,
      w: cardW - 0.5,
      h: 0.4,
      fontFace: FONT_TITLE,
      fontSize: 18,
      bold: true,
      color: d.accent2,
    });
    slide.addText(c.heading, {
      x: x + 0.25,
      y: y + 0.62,
      w: cardW - 0.5,
      h: c.body ? 0.6 : cardH - 0.8,
      fontFace: FONT_BODY,
      fontSize: 15,
      bold: true,
      color: d.text,
      valign: "top",
    });
    if (c.body) {
      slide.addText(c.body, {
        x: x + 0.25,
        y: y + 1.2,
        w: cardW - 0.5,
        h: cardH - 1.35,
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

function renderSteps(slide: AnySlide, s: SlideSpec, d: Palette, brand: string, num: number, moduleLabel: string) {
  bgFill(slide, d.bg);
  header(slide, d, s, moduleLabel);
  const steps = s.steps ?? [];
  const n = steps.length;
  const rowH = CONTENT_H / Math.max(n, 1);
  const spineX = ML + 0.32;
  steps.forEach((st, i) => {
    const y = CONTENT_Y + i * rowH;
    const cy = y + rowH / 2;
    if (i < n - 1) {
      slide.addShape("line", {
        x: spineX,
        y: cy,
        w: 0,
        h: rowH,
        line: { color: d.border, width: 1.5 },
      });
    }
    slide.addShape("ellipse", {
      x: spineX - 0.26,
      y: cy - 0.26,
      w: 0.52,
      h: 0.52,
      fill: { color: d.accent },
      line: { type: "none" },
    });
    slide.addText(String(i + 1), {
      x: spineX - 0.26,
      y: cy - 0.26,
      w: 0.52,
      h: 0.52,
      fontFace: FONT_BODY,
      fontSize: 16,
      bold: true,
      color: d.onAccent,
      align: "center",
      valign: "middle",
    });
    slide.addText(
      [
        { text: st.heading, options: { bold: true, fontSize: 16, color: d.text, breakLine: true } },
        ...(st.body
          ? [{ text: st.body, options: { fontSize: 12.5, color: d.subtext } }]
          : []),
      ],
      {
        x: spineX + 0.5,
        y,
        w: CW - 1.0,
        h: rowH,
        fontFace: FONT_BODY,
        valign: "middle",
        lineSpacingMultiple: 1.02,
      },
    );
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
  bgFill(slide, d.surface);
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 0.18,
    h: H,
    fill: { color: d.accent2 },
    line: { type: "none" },
  });
  slide.addText("“", {
    x: ML,
    y: 0.9,
    w: 2,
    h: 1.6,
    fontFace: FONT_TITLE,
    fontSize: 120,
    bold: true,
    color: d.accent2,
    align: "left",
    valign: "top",
  });
  slide.addText(s.quote ?? s.title, {
    x: ML + 0.2,
    y: 2.4,
    w: CW - 0.4,
    h: 3.0,
    fontFace: FONT_TITLE,
    fontSize: (s.quote ?? s.title).length > 120 ? 26 : 32,
    italic: true,
    color: d.text,
    align: "left",
    valign: "top",
    lineSpacingMultiple: 1.1,
  });
  if (s.attribution) {
    slide.addText(`— ${s.attribution}`, {
      x: ML + 0.2,
      y: 5.7,
      w: CW - 0.4,
      h: 0.5,
      fontFace: FONT_BODY,
      fontSize: 14,
      bold: true,
      color: d.accent,
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
  const d = p(opts.palette);
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
