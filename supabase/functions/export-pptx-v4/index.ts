import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "npm:pptxgenjs@3.12.0";
import JSZip from "npm:jszip@3.10.1";

const ENGINE_VERSION = "5.0.0";

// ═══════════════════════════════════════════════════════════
// XML SAFETY — must run on ALL text before passing to PptxGenJS
// ═══════════════════════════════════════════════════════════

function stripInvalidXmlChars(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i] + input[i + 1];
        i++;
        continue;
      }
      continue; // orphan high surrogate → drop
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue; // lone low surrogate
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)
      continue; // control chars
    if (code === 0x7f) continue;
    if (code === 0xfffe || code === 0xffff) continue; // non-characters
    out += input[i];
  }
  return out;
}

function san(text: string): string {
  if (!text || typeof text !== "string") return "";
  let out = text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, c) => {
      const n = Number(c);
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
      try {
        return String.fromCodePoint(n);
      } catch {
        return "";
      }
    });
  out = stripInvalidXmlChars(out);
  return out
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════════════════════
// SECTION 1: TYPES
// ═══════════════════════════════════════════════════════════

type Layout =
  | "cover"
  | "toc"
  | "module_cover"
  | "bullets"
  | "cards"
  | "takeaways"
  | "closing"
  | "code"
  | "twocol"
  | "comparison"
  | "timeline"
  | "process"
  | "diagram";

interface Slide {
  layout: Layout;
  title: string;
  label?: string;
  subtitle?: string;
  items?: string[];
  code?: string;
  codeLabel?: string;
  competencies?: string[];
  leftHeader?: string; // comparison: left column title
  rightHeader?: string; // comparison: right column title
  leftItems?: string[]; // comparison: left column items
  rightItems?: string[]; // comparison: right column items
  moduleIndex?: number;
}

// ── TYPOGRAPHY CONSTANTS (McKinsey-inspired hierarchy) ──
const T = {
  SLIDE_TITLE: 26, // header title
  SECTION_LABEL: 9, // section label (caps, letter-spaced)
  SUBHEADER: 18, // card/column headers
  BODY: 14, // body text (1–4 items)
  BODY_SM: 13, // body text (5 items)
  CODE: 11, // monospace code
  CAPTION: 9, // footer / footnote
} as const;

interface Design {
  theme: "light" | "dark";
  accent: string;
  accent2: string;
  accent3: string;
  highlight: string;
  bg: string;
  surface: string;
  text: string;
  subtext: string;
  border: string;
  coverBg: string;
  titleFont: string;
  bodyFont: string;
  footerBrand: string;
}

// ═══════════════════════════════════════════════════════════
// SECTION 2: DESIGN SYSTEM
// ═══════════════════════════════════════════════════════════

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const ML = 0.65; // margin left
const MR = 0.65; // margin right
const CW = SLIDE_W - ML - MR; // content width = 12.033
const HEADER_H = 1.45; // space above content
const FOOTER_Y = 7.16;
const CONTENT_Y = HEADER_H;
const CONTENT_H = FOOTER_Y - CONTENT_Y - 0.1; // 5.61

// Each entry: [accent, accent2, accent3, highlight, coverBg]
const PALETTE_MAP: Record<string, [string, string, string, string, string]> = {
  default:    ["1E3A5F", "2E6DA4", "C47F17", "E8A020", "0A1628"],
  ocean:      ["0369A1", "0284C7", "0891B2", "06B6D4", "020C18"],
  forest:     ["15803D", "16A34A", "0D9488", "84CC16", "071A0E"],
  sunset:     ["DC2626", "EA580C", "D97706", "F59E0B", "1A0505"],
  monochrome: ["1E293B", "334155", "475569", "94A3B8", "0A0F18"],
  rose:       ["BE185D", "9D174D", "DB2777", "F472B6", "1A0511"],
  amber:      ["B45309", "D97706", "F59E0B", "FCD34D", "1A1005"],
  teal:       ["0F766E", "0D9488", "14B8A6", "5EEAD4", "03100E"],
  violet:     ["6D28D9", "7C3AED", "8B5CF6", "C4B5FD", "0D0714"],
  slate:      ["1D4ED8", "2563EB", "3B82F6", "93C5FD", "080D1A"],
};

function buildDesign(
  theme: "light" | "dark",
  palette: string,
  template: string,
  footerBrand: string,
): Design {
  const colors = PALETTE_MAP[palette] || PALETTE_MAP.default;
  const [accent, accent2, accent3, highlight, palettecover] = colors;

  if (theme === "dark") {
    return {
      theme,
      accent,
      accent2,
      accent3,
      highlight,
      bg: "0A0E1A",
      surface: "111827",
      text: "F1F5F9",
      subtext: "94A3B8",
      border: "1E293B",
      coverBg: palettecover,
      titleFont: "Cambria",
      bodyFont: "Calibri",
      footerBrand,
    };
  }
  return {
    theme,
    accent,
    accent2,
    accent3,
    highlight,
    bg: "FFFFFF",
    surface: "F8FAFC",
    text: "0F172A",
    subtext: "475569",
    border: "E2E8F0",
    coverBg: "0F172A",
    titleFont: "Cambria",
    bodyFont: "Calibri",
    footerBrand,
  };
}

// ═══════════════════════════════════════════════════════════
// SECTION 3: RENDER HELPERS
// ═══════════════════════════════════════════════════════════

// Like san() but preserves \n and \t — for code blocks
function sanCode(text: string): string {
  if (!text || typeof text !== "string") return "";
  let out = text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  out = stripInvalidXmlChars(out);
  return out
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim();
}

function bg(slide: any, color: string) {
  slide.addShape("rect" as any, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    fill: { color },
  });
}

function footer(slide: any, d: Design, num: number, total: number) {
  // thin line
  slide.addShape("rect" as any, {
    x: ML,
    y: FOOTER_Y,
    w: CW,
    h: 0.01,
    fill: { color: d.border },
  });
  // brand
  if (d.footerBrand) {
    slide.addText(san(d.footerBrand), {
      x: ML,
      y: FOOTER_Y + 0.05,
      w: CW * 0.5,
      h: 0.22,
      fontSize: 9,
      fontFace: d.bodyFont,
      color: d.subtext,
      bold: true,
      charSpacing: 2,
    });
  }
  // page number
  slide.addText(`${num} / ${total}`, {
    x: ML + CW * 0.5,
    y: FOOTER_Y + 0.05,
    w: CW * 0.5,
    h: 0.22,
    fontSize: 9,
    fontFace: d.bodyFont,
    color: d.subtext,
    align: "right",
  });
}

// Standard slide header: chip label + accent line + title
function header(slide: any, d: Design, label: string, title: string) {
  if (label) {
    const chipW = Math.min(4.2, label.length * 0.105 + 0.4);
    slide.addShape("roundRect" as any, {
      x: ML,
      y: 0.22,
      w: chipW,
      h: 0.28,
      fill: { color: d.accent },
      rectRadius: 0.04,
    });
    slide.addText(san(label).toUpperCase(), {
      x: ML,
      y: 0.22,
      w: chipW,
      h: 0.28,
      fontSize: T.SECTION_LABEL,
      fontFace: d.bodyFont,
      bold: true,
      color: "FFFFFF",
      charSpacing: 3,
      align: "center",
      valign: "middle",
    });
  }
  const titleY = label ? 0.58 : 0.22;
  const titleH = label ? 0.72 : 1.0;
  slide.addText(san(title), {
    x: ML,
    y: titleY,
    w: CW,
    h: titleH,
    fontSize: T.SLIDE_TITLE,
    fontFace: d.titleFont,
    bold: true,
    color: d.text,
    valign: "middle",
    fit: "shrink" as any,
  });
  slide.addShape("rect" as any, {
    x: ML,
    y: CONTENT_Y - 0.05,
    w: 0.4,
    h: 0.035,
    fill: { color: d.accent },
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 4: SLIDE RENDERERS
// ═══════════════════════════════════════════════════════════

// ── COVER ──
function renderCover(
  pptx: PptxGenJS,
  slide_: Slide,
  d: Design,
  totalSlides: number,
) {
  const slide = pptx.addSlide();
  bg(slide, d.coverBg);

  // Left accent bar gradient
  slide.addShape("rect" as any, {
    x: 0,
    y: 0,
    w: 0.12,
    h: SLIDE_H,
    fill: { color: d.accent },
  });
  slide.addShape("rect" as any, {
    x: 0.12,
    y: 0,
    w: 0.06,
    h: SLIDE_H,
    fill: { color: d.accent2, transparency: 60 },
  });

  // Course type badge
  if (slide_.subtitle) {
    slide.addShape("roundRect" as any, {
      x: 1.0,
      y: 1.1,
      w: Math.min(4.0, slide_.subtitle.length * 0.18 + 0.5),
      h: 0.34,
      fill: { color: d.accent },
      rectRadius: 0.04,
    });
    slide.addText(san(slide_.subtitle).toUpperCase(), {
      x: 1.0,
      y: 1.1,
      w: 4.5,
      h: 0.34,
      fontSize: 10,
      fontFace: d.bodyFont,
      bold: true,
      color: "FFFFFF",
      charSpacing: 3,
      valign: "middle",
    });
  }

  // Title
  slide.addText(san(slide_.title), {
    x: 1.0,
    y: 1.65,
    w: SLIDE_W - 1.6,
    h: 2.4,
    fontSize: 44,
    fontFace: d.titleFont,
    bold: true,
    color: "FFFFFF",
    valign: "middle",
    fit: "shrink" as any,
    lineSpacingMultiple: 1.15,
  });

  // Divider line
  slide.addShape("rect" as any, {
    x: 1.0,
    y: 4.25,
    w: 3.0,
    h: 0.04,
    fill: { color: d.accent },
  });

  // Subtitle / tagline
  slide.addText("Curso completo com material profissional", {
    x: 1.0,
    y: 4.42,
    w: SLIDE_W - 2.0,
    h: 0.4,
    fontSize: 14,
    fontFace: d.bodyFont,
    color: "94A3B8",
    valign: "middle",
  });

  // Bottom right decoration circles
  for (let i = 0; i < 4; i++) {
    const sz = 0.8 + i * 0.5;
    slide.addShape("ellipse" as any, {
      x: SLIDE_W - sz - 0.3,
      y: SLIDE_H - sz - 0.2,
      w: sz,
      h: sz,
      fill: { color: d.accent, transparency: 82 + i * 4 },
    });
  }
}

// ── TABLE OF CONTENTS ──
function renderTOC(
  pptx: PptxGenJS,
  slide_: Slide,
  d: Design,
  num: number,
  total: number,
  modules: { title: string }[],
) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);

  // Left panel
  const panelW = 2.9;
  slide.addShape("rect" as any, {
    x: 0,
    y: 0.06,
    w: panelW,
    h: SLIDE_H - 0.06,
    fill: { color: d.surface },
  });
  slide.addText("ÍNDICE", {
    x: ML,
    y: 0.3,
    w: panelW - ML,
    h: 0.28,
    fontSize: 10,
    fontFace: d.bodyFont,
    bold: true,
    color: d.accent,
    charSpacing: 5,
  });
  slide.addText("Conteúdo\ndo Curso", {
    x: ML,
    y: 0.64,
    w: panelW - ML,
    h: 1.0,
    fontSize: 24,
    fontFace: d.titleFont,
    bold: true,
    color: d.text,
    valign: "top",
    lineSpacingMultiple: 1.1,
    fit: "shrink" as any,
  });
  // Module count chip
  slide.addShape("roundRect" as any, {
    x: ML,
    y: FOOTER_Y - 0.54,
    w: 1.7,
    h: 0.36,
    fill: { color: d.accent },
    rectRadius: 0.04,
  });
  slide.addText(`${modules.length} Módulo${modules.length !== 1 ? "s" : ""}`, {
    x: ML,
    y: FOOTER_Y - 0.54,
    w: 1.7,
    h: 0.36,
    fontSize: 12,
    fontFace: d.bodyFont,
    bold: true,
    color: "FFFFFF",
    align: "center",
    valign: "middle",
  });

  // Module list — 2 columns when > 5 modules
  const listX = panelW + 0.35;
  const totalListW = SLIDE_W - listX - MR;
  const maxMods = Math.min(modules.length, 10);
  const useTwoCols = maxMods > 5;
  const cols = useTwoCols ? 2 : 1;
  const colW = useTwoCols ? (totalListW - 0.3) / 2 : totalListW;
  const itemsPerCol = useTwoCols ? Math.ceil(maxMods / cols) : maxMods;
  const availH = FOOTER_Y - 0.35;
  const itemH = Math.min(0.68, availH / itemsPerCol);
  const totalListH = itemsPerCol * itemH;
  const startY = 0.35 + Math.max(0, (availH - totalListH) / 2);

  for (let i = 0; i < maxMods; i++) {
    const col = useTwoCols ? Math.floor(i / itemsPerCol) : 0;
    const rowInCol = useTwoCols ? i % itemsPerCol : i;
    const x = listX + col * (colW + 0.3);
    const y = startY + rowInCol * itemH;
    const pal = [d.accent, d.accent2, d.accent3][i % 3];

    slide.addShape("ellipse" as any, {
      x,
      y: y + (itemH - 0.36) / 2,
      w: 0.36,
      h: 0.36,
      fill: { color: pal },
    });
    slide.addText(String(i + 1), {
      x,
      y: y + (itemH - 0.36) / 2,
      w: 0.36,
      h: 0.36,
      fontSize: 12,
      fontFace: d.titleFont,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    });
    slide.addText(san(modules[i].title), {
      x: x + 0.46,
      y: y + (itemH - 0.28) / 2,
      w: colW - 0.5,
      h: 0.28,
      fontSize: useTwoCols ? 12 : 14,
      fontFace: d.bodyFont,
      color: d.text,
      valign: "middle",
      fit: "shrink" as any,
    });
    if (!useTwoCols && i < maxMods - 1) {
      slide.addShape("rect" as any, {
        x,
        y: y + itemH - 0.01,
        w: colW,
        h: 0.01,
        fill: { color: d.border },
      });
    }
  }

  footer(slide, d, num, total);
}

// ── MODULE COVER ──
function renderModuleCover(
  pptx: PptxGenJS,
  slide_: Slide,
  d: Design,
  num: number,
  total: number,
) {
  const slide = pptx.addSlide();
  bg(slide, d.coverBg);

  const sideW = 0.55;
  slide.addShape("rect" as any, {
    x: 0,
    y: 0,
    w: sideW,
    h: SLIDE_H,
    fill: { color: d.accent },
  });

  // Large watermark number — top-right corner
  const modNum = String((slide_.moduleIndex ?? 0) + 1).padStart(2, "0");
  slide.addText(modNum, {
    x: SLIDE_W - 3.8,
    y: 0.1,
    w: 3.2,
    h: 3.0,
    fontSize: 160,
    fontFace: d.titleFont,
    bold: true,
    color: "FFFFFF",
    transparency: 88,
    align: "right",
    valign: "top",
  });

  // Label
  slide.addText("MÓDULO " + ((slide_.moduleIndex ?? 0) + 1), {
    x: sideW + 0.5,
    y: 1.4,
    w: CW,
    h: 0.3,
    fontSize: 10,
    fontFace: d.bodyFont,
    bold: true,
    color: d.accent,
    charSpacing: 5,
  });

  // Title — shorter box to leave room for competencies
  slide.addText(san(slide_.title), {
    x: sideW + 0.5,
    y: 1.82,
    w: SLIDE_W - sideW - 1.2,
    h: 1.7,
    fontSize: 34,
    fontFace: d.titleFont,
    bold: true,
    color: "FFFFFF",
    valign: "top",
    fit: "shrink" as any,
    lineSpacingMultiple: 1.2,
  });

  // Competencies section
  const competencies = (slide_.competencies || []).slice(0, 3);
  if (competencies.length > 0) {
    slide.addShape("rect" as any, {
      x: sideW + 0.5,
      y: 3.68,
      w: 2.2,
      h: 0.03,
      fill: { color: d.accent },
    });
    slide.addText("O QUE VOCÊ VAI APRENDER", {
      x: sideW + 0.5,
      y: 3.78,
      w: SLIDE_W - sideW - 1.3,
      h: 0.22,
      fontSize: 8,
      fontFace: d.bodyFont,
      bold: true,
      color: d.accent,
      charSpacing: 4,
    });
    for (let i = 0; i < competencies.length; i++) {
      const cy = [4.05, 5.00, 5.95][i];
      slide.addShape("ellipse" as any, {
        x: sideW + 0.5,
        y: cy + 0.07,
        w: 0.13,
        h: 0.13,
        fill: { color: d.accent },
      });
      slide.addText(san(competencies[i]), {
        x: sideW + 0.73,
        y: cy,
        w: SLIDE_W - sideW - 1.4,
        h: 0.32,
        fontSize: 12,
        fontFace: d.bodyFont,
        color: "CBD5E1",
        valign: "middle",
        fit: "shrink" as any,
      });
    }
  }

  footer(slide, d, num, total);
}

// ── BULLETS ──
function renderBullets(
  pptx: PptxGenJS,
  slide_: Slide,
  d: Design,
  num: number,
  total: number,
) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);
  header(slide, d, slide_.label || "", slide_.title);

  const items = (slide_.items || []).slice(0, 5);
  if (items.length === 0) {
    footer(slide, d, num, total);
    return;
  }

  const gap = 0.13;
  const totalGap = gap * (items.length - 1);
  const itemH = Math.min(1.4, Math.max(0.58, (CONTENT_H - totalGap) / items.length));
  const totalBlockH = items.length * itemH + totalGap;
  const startY = CONTENT_Y + Math.max(0, (CONTENT_H - totalBlockH) / 2);
  const fontSize = items.length <= 3 ? 18 : items.length <= 4 ? 16 : 14;

  for (let i = 0; i < items.length; i++) {
    const y = startY + i * (itemH + gap);
    const pal = [d.accent, d.accent2, d.accent3][i % 3];

    // Card background
    slide.addShape("roundRect" as any, {
      x: ML,
      y,
      w: CW,
      h: itemH,
      fill: { color: d.surface },
      line: { color: d.border, width: 0.4 },
      rectRadius: 0.06,
    });

    // Left color strip
    slide.addShape("roundRect" as any, {
      x: ML,
      y,
      w: 0.055,
      h: itemH,
      fill: { color: pal },
      rectRadius: 0.06,
    });

    // Bullet dot
    const dotSz = 0.1;
    slide.addShape("ellipse" as any, {
      x: ML + 0.18,
      y: y + itemH / 2 - dotSz / 2,
      w: dotSz,
      h: dotSz,
      fill: { color: pal },
    });

    // Text
    slide.addText(san(items[i]), {
      x: ML + 0.36,
      y: y + 0.05,
      w: CW - 0.46,
      h: itemH - 0.1,
      fontSize,
      fontFace: d.bodyFont,
      color: d.text,
      valign: "middle",
      lineSpacingMultiple: 1.2,
      fit: "shrink" as any,
    });
  }

  footer(slide, d, num, total);
}

// ── CARDS ──
// Items can be "Title: Description" — renderer splits on first ": "
function renderCards(
  pptx: PptxGenJS,
  slide_: Slide,
  d: Design,
  num: number,
  total: number,
) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);
  header(slide, d, slide_.label || "", slide_.title);

  const items = (slide_.items || []).slice(0, 4);
  if (items.length === 0) {
    footer(slide, d, num, total);
    return;
  }

  const cols = items.length <= 3 ? items.length : 2;
  const rows = Math.ceil(items.length / cols);
  const gap = 0.22;
  const cardW = (CW - gap * (cols - 1)) / cols;
  const maxCardH = items.length <= 2 ? 2.2 : items.length === 3 ? 2.0 : 1.8;
  const cardH = Math.min(maxCardH, (CONTENT_H - gap * (rows - 1)) / rows);
  const totalCardsH = rows * cardH + (rows - 1) * gap;
  const cardsStartY = CONTENT_Y + Math.max(0, (CONTENT_H - totalCardsH) / 2);

  for (let i = 0; i < items.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = ML + col * (cardW + gap);
    const y = cardsStartY + row * (cardH + gap);
    const pal = [d.accent, d.accent2, d.accent3][i % 3];

    // Parse "Title: Description"
    const colonIdx = items[i].indexOf(": ");
    const hasTitle = colonIdx > 0 && colonIdx < 50;
    const cardTopText = hasTitle ? items[i].slice(0, colonIdx) : "";
    const cardBodyText = hasTitle ? items[i].slice(colonIdx + 2) : items[i];

    // Shadow
    slide.addShape("roundRect" as any, {
      x: x + 0.03,
      y: y + 0.04,
      w: cardW,
      h: cardH,
      fill: { color: "000000", transparency: 88 },
      rectRadius: 0.1,
    });

    // Card body
    slide.addShape("roundRect" as any, {
      x,
      y,
      w: cardW,
      h: cardH,
      fill: { color: d.surface },
      line: { color: d.border, width: 0.4 },
      rectRadius: 0.1,
    });

    // Top color bar
    const topBarH = 0.1;
    slide.addShape("roundRect" as any, {
      x,
      y,
      w: cardW,
      h: topBarH,
      fill: { color: pal },
      rectRadius: 0.1,
    });
    slide.addShape("rect" as any, {
      x,
      y: y + topBarH * 0.4,
      w: cardW,
      h: topBarH * 0.6,
      fill: { color: pal },
    });

    // Color left stripe
    slide.addShape("rect" as any, {
      x,
      y: y + topBarH,
      w: 0.055,
      h: cardH - topBarH,
      fill: { color: pal, transparency: 60 },
    });

    // Number badge in top-left of color bar
    const badgeSz = 0.36;
    slide.addShape("ellipse" as any, {
      x: x + 0.14,
      y: y + topBarH * 0.5 - badgeSz / 2,
      w: badgeSz,
      h: badgeSz,
      fill: {
        color: d.theme === "dark" ? "111827" : "FFFFFF",
        transparency: 10,
      },
    });
    slide.addText(String(i + 1), {
      x: x + 0.14,
      y: y + topBarH * 0.5 - badgeSz / 2,
      w: badgeSz,
      h: badgeSz,
      fontSize: 13,
      fontFace: d.titleFont,
      bold: true,
      color: pal,
      align: "center",
      valign: "middle",
    });

    // Card title (bold) — from "Title: ..."
    const innerX = x + 0.18;
    const innerW = cardW - 0.26;
    let contentY = y + topBarH + 0.14;

    if (hasTitle && cardTopText) {
      slide.addText(san(cardTopText), {
        x: innerX,
        y: contentY,
        w: innerW,
        h: 0.38,
        fontSize: items.length <= 2 ? 17 : items.length === 3 ? 15 : 13,
        fontFace: d.titleFont,
        bold: true,
        color: d.text,
        valign: "top",
        lineSpacingMultiple: 1.1,
        fit: "shrink" as any,
      });
      contentY += 0.38 + 0.06;
    }

    // Card body text
    const remainH = y + cardH - contentY - 0.12;
    slide.addText(san(cardBodyText), {
      x: innerX,
      y: contentY,
      w: innerW,
      h: Math.max(0.3, remainH),
      fontSize: items.length <= 2 ? 15 : items.length === 3 ? 12 : 11,
      fontFace: d.bodyFont,
      color: hasTitle ? d.subtext : d.text,
      align: "left",
      valign: "top",
      lineSpacingMultiple: 1.2,
      fit: "shrink" as any,
    });
  }

  footer(slide, d, num, total);
}

// ── PROCESS ── Horizontal arrow flow (3–5 steps)
function renderProcess(
  pptx: PptxGenJS,
  slide_: Slide,
  d: Design,
  num: number,
  total: number,
) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);
  header(slide, d, slide_.label || "PROCESSO", slide_.title);

  const items = (slide_.items || []).slice(0, 5);
  if (items.length === 0) {
    footer(slide, d, num, total);
    return;
  }

  const n = items.length;
  const arrowW = n <= 4 ? 0.28 : 0.2;
  const totalArrows = (n - 1) * arrowW;
  const boxW = (CW - totalArrows) / n;
  // Altura compacta: suficiente para badge + texto + respiro, sem desperdício
  const boxH = n <= 3 ? 2.4 : n === 4 ? 2.2 : 2.0;
  // Centralizar verticalmente no espaço de conteúdo
  const areaY = CONTENT_Y + (CONTENT_H - boxH) / 2;
  const areaH = boxH; // mantido por compatibilidade com o restante do código

  for (let i = 0; i < n; i++) {
    const x = ML + i * (boxW + arrowW);
    const pal = [d.accent, d.accent2, d.accent3][i % 3];

    // Box shadow
    slide.addShape("roundRect" as any, {
      x: x + 0.03,
      y: areaY + 0.04,
      w: boxW,
      h: boxH,
      fill: { color: "000000", transparency: 90 },
      rectRadius: 0.1,
    });

    // Box
    slide.addShape("roundRect" as any, {
      x,
      y: areaY,
      w: boxW,
      h: boxH,
      fill: { color: d.surface },
      line: { color: pal, width: 1.2 },
      rectRadius: 0.1,
    });

    // Top color bar
    slide.addShape("roundRect" as any, {
      x,
      y: areaY,
      w: boxW,
      h: 0.1,
      fill: { color: pal },
      rectRadius: 0.1,
    });
    slide.addShape("rect" as any, {
      x,
      y: areaY + 0.04,
      w: boxW,
      h: 0.06,
      fill: { color: pal },
    });

    // Step number badge (centered, below bar)
    const badgeSz = n <= 3 ? 0.5 : 0.4;
    const badgeX = x + boxW / 2 - badgeSz / 2;
    const badgeY = areaY + 0.18;
    slide.addShape("ellipse" as any, {
      x: badgeX,
      y: badgeY,
      w: badgeSz,
      h: badgeSz,
      fill: { color: pal },
    });
    slide.addText(String(i + 1), {
      x: badgeX,
      y: badgeY,
      w: badgeSz,
      h: badgeSz,
      fontSize: n <= 3 ? 18 : 14,
      fontFace: d.titleFont,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    });

    // Step text
    const textY = badgeY + badgeSz + 0.12;
    const textH = areaY + boxH - textY - 0.14;
    slide.addText(san(items[i]), {
      x: x + 0.1,
      y: textY,
      w: boxW - 0.2,
      h: Math.max(0.3, textH),
      fontSize: n <= 3 ? 15 : n <= 4 ? 13 : 11,
      fontFace: d.bodyFont,
      color: d.text,
      align: "center",
      valign: "top",
      lineSpacingMultiple: 1.2,
      fit: "shrink" as any,
    });

    // Arrow to next (skip last)
    if (i < n - 1) {
      const arrowX = x + boxW + 0.02;
      const arrowCY = areaY + boxH / 2;
      slide.addText("›", {
        x: arrowX,
        y: arrowCY - 0.22,
        w: arrowW - 0.04,
        h: 0.44,
        fontSize: 28,
        fontFace: d.titleFont,
        bold: true,
        color: pal,
        align: "center",
        valign: "middle",
      });
    }
  }

  footer(slide, d, num, total);
}

// ── TAKEAWAYS ──
function renderTakeaways(
  pptx: PptxGenJS,
  slide_: Slide,
  d: Design,
  num: number,
  total: number,
) {
  const slide = pptx.addSlide();
  bg(slide, d.coverBg);

  // Accent top stripe
  slide.addShape("rect" as any, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 0.07,
    fill: { color: d.accent },
  });

  // Label
  slide.addText(san(slide_.label || "PRINCIPAIS APRENDIZADOS").toUpperCase(), {
    x: ML,
    y: 0.22,
    w: CW,
    h: 0.26,
    fontSize: 9,
    fontFace: d.bodyFont,
    bold: true,
    color: d.accent,
    charSpacing: 5,
  });

  // Title
  slide.addText(san(slide_.title), {
    x: ML,
    y: 0.55,
    w: CW,
    h: 0.72,
    fontSize: 26,
    fontFace: d.titleFont,
    bold: true,
    color: "FFFFFF",
    valign: "middle",
    fit: "shrink" as any,
  });

  // Items
  const items = (slide_.items || []).slice(0, 5);
  const gap = 0.1;
  const contentY2 = 1.42;
  const availH = FOOTER_Y - contentY2 - 0.1;
  const itemH = (availH - gap * (items.length - 1)) / Math.max(items.length, 1);

  for (let i = 0; i < items.length; i++) {
    const y = contentY2 + i * (itemH + gap);
    const pal = [d.accent, d.accent2, d.accent3][i % 3];

    // Row bg
    slide.addShape("roundRect" as any, {
      x: ML,
      y,
      w: CW,
      h: itemH,
      fill: { color: "FFFFFF", transparency: 91 },
      rectRadius: 0.07,
    });

    // Number
    const numSz = Math.min(0.5, itemH * 0.7);
    slide.addShape("ellipse" as any, {
      x: ML + 0.14,
      y: y + itemH / 2 - numSz / 2,
      w: numSz,
      h: numSz,
      fill: { color: pal },
    });
    slide.addText(String(i + 1), {
      x: ML + 0.14,
      y: y + itemH / 2 - numSz / 2,
      w: numSz,
      h: numSz,
      fontSize: 15,
      fontFace: d.titleFont,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    });

    // Text
    const fontSize = items.length <= 3 ? 16 : 14;
    slide.addText(san(items[i]), {
      x: ML + numSz + 0.28,
      y: y + 0.05,
      w: CW - numSz - 0.38,
      h: itemH - 0.1,
      fontSize,
      fontFace: d.bodyFont,
      color: "F1F5F9",
      valign: "middle",
      lineSpacingMultiple: 1.2,
      fit: "shrink" as any,
    });
  }

  footer(slide, d, num, total);
}

// ── CLOSING ──
function renderClosing(
  pptx: PptxGenJS,
  slide_: Slide,
  d: Design,
  num: number,
  total: number,
) {
  const slide = pptx.addSlide();
  bg(slide, d.coverBg);

  // Decoration circles (top-right)
  for (let i = 0; i < 5; i++) {
    const sz = 1.2 + i * 0.9;
    slide.addShape("ellipse" as any, {
      x: SLIDE_W - sz * 0.7,
      y: -sz * 0.3,
      w: sz,
      h: sz,
      fill: { color: d.accent, transparency: 85 + i * 2 },
    });
  }
  slide.addShape("rect" as any, {
    x: 0,
    y: 0,
    w: 0.1,
    h: SLIDE_H,
    fill: { color: d.accent },
  });

  // Left column: congrats
  const midX = SLIDE_W * 0.48;
  slide.addText("🎓", {
    x: ML + 0.1,
    y: 0.9,
    w: 1.2,
    h: 1.2,
    fontSize: 52,
    align: "center",
    valign: "middle",
  });
  slide.addText("Parabéns!", {
    x: ML + 1.4,
    y: 1.0,
    w: midX - ML - 1.6,
    h: 0.6,
    fontSize: 34,
    fontFace: d.titleFont,
    bold: true,
    color: d.accent,
  });
  slide.addText(`Você concluiu:\n${san(slide_.title)}`, {
    x: ML + 1.4,
    y: 1.72,
    w: midX - ML - 1.7,
    h: 1.2,
    fontSize: 19,
    fontFace: d.titleFont,
    bold: true,
    color: "FFFFFF",
    valign: "top",
    lineSpacingMultiple: 1.2,
    fit: "shrink" as any,
  });
  slide.addShape("rect" as any, {
    x: ML + 1.4,
    y: 3.1,
    w: 2.4,
    h: 0.04,
    fill: { color: d.accent },
  });
  slide.addText(
    "Continue praticando e construindo\nprojetos reais com o que aprendeu!",
    {
      x: ML + 0.1,
      y: 3.32,
      w: midX - ML - 0.2,
      h: 0.9,
      fontSize: 12,
      fontFace: d.bodyFont,
      color: "94A3B8",
      valign: "top",
      lineSpacingMultiple: 1.3,
      fit: "shrink" as any,
    },
  );

  // Right column: próximos passos checklist panel
  const rightX = midX + 0.3;
  const rightW = SLIDE_W - rightX - MR;
  const panelY = 0.55;
  const panelH = FOOTER_Y - panelY - 0.05;

  slide.addShape("roundRect" as any, {
    x: rightX,
    y: panelY,
    w: rightW,
    h: panelH,
    fill: { color: "FFFFFF", transparency: 6 },
    line: { color: d.accent, width: 0.5 },
    rectRadius: 0.12,
  });
  // Panel header
  slide.addShape("roundRect" as any, {
    x: rightX,
    y: panelY,
    w: rightW,
    h: 0.5,
    fill: { color: d.accent },
    rectRadius: 0.12,
  });
  slide.addShape("rect" as any, {
    x: rightX,
    y: panelY + 0.25,
    w: rightW,
    h: 0.25,
    fill: { color: d.accent },
  });
  slide.addText("PRÓXIMOS PASSOS", {
    x: rightX + 0.2,
    y: panelY + 0.02,
    w: rightW - 0.4,
    h: 0.46,
    fontSize: 11,
    fontFace: d.bodyFont,
    bold: true,
    color: "FFFFFF",
    charSpacing: 3,
    valign: "middle",
  });

  const nexts =
    slide_.items && slide_.items.length > 0
      ? slide_.items
      : [
          "Aplique o conteúdo em um projeto pessoal",
          "Explore a documentação oficial das ferramentas",
          "Construa um portfólio com os projetos deste curso",
          "Compartilhe seu progresso com a comunidade",
        ];
  const checkItemH = (panelH - 0.5 - 0.15) / Math.min(nexts.length, 4);
  for (let i = 0; i < Math.min(nexts.length, 4); i++) {
    const y = panelY + 0.5 + 0.07 + i * checkItemH;
    // Checkbox
    slide.addShape("roundRect" as any, {
      x: rightX + 0.2,
      y: y + (checkItemH - 0.3) / 2,
      w: 0.3,
      h: 0.3,
      fill: { color: d.accent, transparency: 80 },
      line: { color: d.accent, width: 0.5 },
      rectRadius: 0.04,
    });
    slide.addText("✓", {
      x: rightX + 0.2,
      y: y + (checkItemH - 0.3) / 2,
      w: 0.3,
      h: 0.3,
      fontSize: 11,
      color: d.accent,
      align: "center",
      valign: "middle",
      fontFace: d.bodyFont,
      bold: true,
    });
    slide.addText(san(nexts[i]), {
      x: rightX + 0.62,
      y,
      w: rightW - 0.77,
      h: checkItemH,
      fontSize: 12,
      fontFace: d.bodyFont,
      color: "1E293B",
      valign: "middle",
      lineSpacingMultiple: 1.2,
      fit: "shrink" as any,
    });
  }

  footer(slide, d, num, total);
}

// ── CODE ──
function renderCode(
  pptx: PptxGenJS,
  slide_: Slide,
  d: Design,
  num: number,
  total: number,
) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);
  header(slide, d, slide_.label || "CÓDIGO", slide_.title);

  const items = (slide_.items || []).slice(0, 3);
  // Hard cap: truncate to CODE_MAX_LINES regardless of AI output
  const rawCode = slide_.code || "";
  const codeLines = rawCode.split("\n");
  const codeText =
    codeLines.length > CODE_MAX_LINES
      ? codeLines.slice(0, CODE_MAX_LINES).join("\n") + "\n# ..."
      : rawCode;
  const leftW = CW * 0.42;
  const rightX = ML + leftW + 0.22;
  const rightW = CW - leftW - 0.22;
  const areaY = CONTENT_Y + 0.12;
  const areaH = FOOTER_Y - areaY - 0.12;

  // Left: description bullets
  if (items.length > 0) {
    const gap = 0.1;
    const itemH = Math.max(
      0.5,
      (areaH - gap * (items.length - 1)) / items.length,
    );
    for (let i = 0; i < items.length; i++) {
      const y = areaY + i * (itemH + gap);
      const pal = [d.accent, d.accent2, d.accent3][i % 3];
      slide.addShape("roundRect" as any, {
        x: ML,
        y,
        w: leftW,
        h: itemH,
        fill: { color: d.surface },
        line: { color: d.border, width: 0.4 },
        rectRadius: 0.06,
      });
      slide.addShape("roundRect" as any, {
        x: ML,
        y,
        w: 0.055,
        h: itemH,
        fill: { color: pal },
        rectRadius: 0.06,
      });
      const dotSz = 0.1;
      slide.addShape("ellipse" as any, {
        x: ML + 0.18,
        y: y + itemH / 2 - dotSz / 2,
        w: dotSz,
        h: dotSz,
        fill: { color: pal },
      });
      slide.addText(san(items[i]), {
        x: ML + 0.36,
        y: y + 0.05,
        w: leftW - 0.46,
        h: itemH - 0.1,
        fontSize: 13,
        fontFace: d.bodyFont,
        color: d.text,
        valign: "middle",
        lineSpacingMultiple: 1.2,
        fit: "shrink" as any,
      });
    }
  }

  // Right: code terminal
  const termBg = "1E293B";
  const barH = 0.32;
  slide.addShape("roundRect" as any, {
    x: rightX,
    y: areaY,
    w: rightW,
    h: areaH,
    fill: { color: termBg },
    rectRadius: 0.1,
  });
  // Title bar
  slide.addShape("roundRect" as any, {
    x: rightX,
    y: areaY,
    w: rightW,
    h: barH,
    fill: { color: "334155" },
    rectRadius: 0.1,
  });
  slide.addShape("rect" as any, {
    x: rightX,
    y: areaY + barH / 2,
    w: rightW,
    h: barH / 2,
    fill: { color: "334155" },
  });
  // Traffic light dots
  const dotColors = ["FF5F57", "FEBC2E", "28C840"];
  for (let i = 0; i < 3; i++) {
    slide.addShape("ellipse" as any, {
      x: rightX + 0.15 + i * 0.22,
      y: areaY + 0.1,
      w: 0.12,
      h: 0.12,
      fill: { color: dotColors[i] },
    });
  }
  // Language label
  const lang = slide_.codeLabel || "Python";
  slide.addText(lang, {
    x: rightX,
    y: areaY + 0.06,
    w: rightW - 0.12,
    h: 0.2,
    fontSize: 9,
    fontFace: d.bodyFont,
    bold: true,
    color: "94A3B8",
    align: "right",
  });
  // Code text
  if (codeText) {
    slide.addText(sanCode(codeText), {
      x: rightX + 0.18,
      y: areaY + barH + 0.12,
      w: rightW - 0.36,
      h: areaH - barH - 0.22,
      fontSize: 11,
      fontFace: "Courier New",
      color: "E2E8F0",
      valign: "top",
      lineSpacingMultiple: 1.45,
      fit: "shrink" as any,
    });
  }

  footer(slide, d, num, total);
}

// ── TWOCOL ──
function renderTwocol(
  pptx: PptxGenJS,
  slide_: Slide,
  d: Design,
  num: number,
  total: number,
) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);
  header(slide, d, slide_.label || "", slide_.title);

  const items = (slide_.items || []).slice(0, 8);
  if (items.length === 0) {
    footer(slide, d, num, total);
    return;
  }

  const half = Math.ceil(items.length / 2);
  const leftItems = items.slice(0, half);
  const rightItems = items.slice(half);
  const colW = (CW - 0.22) / 2;

  const renderCol = (colItems: string[], colX: number) => {
    const gap = 0.1;
    const itemH = Math.max(
      0.48,
      (CONTENT_H - gap * (colItems.length - 1)) / colItems.length,
    );
    const fontSize = colItems.length <= 3 ? 15 : 13;
    for (let i = 0; i < colItems.length; i++) {
      const y = CONTENT_Y + i * (itemH + gap);
      const pal = [d.accent, d.accent2, d.accent3][i % 3];
      slide.addShape("roundRect" as any, {
        x: colX,
        y,
        w: colW,
        h: itemH,
        fill: { color: d.surface },
        line: { color: d.border, width: 0.4 },
        rectRadius: 0.06,
      });
      slide.addShape("roundRect" as any, {
        x: colX,
        y,
        w: 0.055,
        h: itemH,
        fill: { color: pal },
        rectRadius: 0.06,
      });
      const dotSz = 0.1;
      slide.addShape("ellipse" as any, {
        x: colX + 0.18,
        y: y + itemH / 2 - dotSz / 2,
        w: dotSz,
        h: dotSz,
        fill: { color: pal },
      });
      slide.addText(san(colItems[i]), {
        x: colX + 0.36,
        y: y + 0.05,
        w: colW - 0.46,
        h: itemH - 0.1,
        fontSize,
        fontFace: d.bodyFont,
        color: d.text,
        valign: "middle",
        lineSpacingMultiple: 1.2,
        fit: "shrink" as any,
      });
    }
  };

  renderCol(leftItems, ML);
  renderCol(rightItems, ML + colW + 0.22);
  footer(slide, d, num, total);
}

// ── COMPARISON ── Two independent full-height column panels with VS badge
// Each column is a single panel box (not stacked rows) — clean, corporate look.
function renderComparison(
  pptx: PptxGenJS,
  slide_: Slide,
  d: Design,
  num: number,
  total: number,
) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);
  header(slide, d, slide_.label || "COMPARAÇÃO", slide_.title);

  const lItems  = (slide_.leftItems  || []).slice(0, 4);
  const rItems  = (slide_.rightItems || []).slice(0, 4);
  const lHeader = san(slide_.leftHeader  || "A");
  const rHeader = san(slide_.rightHeader || "B");

  // ── Layout: two full-height panels flanking a narrow VS spine ──
  const vsBadgeW = 0.58;                     // total width of centre VS zone
  const colW     = (CW - vsBadgeW) / 2;      // ≈ 5.727 each
  const lX       = ML;                        // left panel X
  const rX       = ML + colW + vsBadgeW;      // right panel X
  const panelY   = CONTENT_Y + 0.05;
  const panelH   = FOOTER_Y - panelY - 0.06;
  const hdrH     = 0.54;                      // coloured header band height
  const padX     = 0.20;                      // inner horizontal padding
  const padTop   = 0.16;                      // gap between header and first bullet
  const dotSz    = 0.11;
  const maxRows  = Math.max(lItems.length, rItems.length, 1);
  const bodyH    = panelH - hdrH - padTop;
  const itemH    = bodyH / Math.max(maxRows, 1);
  const fontSize = maxRows <= 2 ? 15 : maxRows <= 3 ? T.BODY : T.BODY_SM;

  // ── Draw a single full-height column panel ──
  const drawPanel = (x: number, pal: string, label: string, items: string[]) => {
    // Panel shadow (slight depth)
    slide.addShape("roundRect" as any, {
      x: x + 0.03, y: panelY + 0.04, w: colW, h: panelH,
      fill: { color: "000000", transparency: 92 }, rectRadius: 0.12,
    });
    // Panel body
    slide.addShape("roundRect" as any, {
      x, y: panelY, w: colW, h: panelH,
      fill: { color: d.surface },
      line: { color: d.border, width: 0.5 },
      rectRadius: 0.12,
    });

    // Coloured header band (top-rounded, bottom flat via overlay)
    slide.addShape("roundRect" as any, {
      x, y: panelY, w: colW, h: hdrH,
      fill: { color: pal }, rectRadius: 0.12,
    });
    slide.addShape("rect" as any, {
      x, y: panelY + hdrH - 0.15, w: colW, h: 0.15,
      fill: { color: pal },
    });

    // Header text
    slide.addText(label, {
      x: x + padX, y: panelY, w: colW - padX * 2, h: hdrH,
      fontSize: 16, fontFace: d.titleFont, bold: true,
      color: "FFFFFF", align: "center", valign: "middle",
    });

    // Thin left accent stripe running down the body
    slide.addShape("rect" as any, {
      x: x + 0.015, y: panelY + hdrH, w: 0.04, h: panelH - hdrH - 0.015,
      fill: { color: pal, transparency: 60 },
    });

    // Bullet items — clean text with leading dots
    for (let i = 0; i < items.length; i++) {
      const itemY = panelY + hdrH + padTop + i * itemH;

      // Subtle alternating row tint
      if (i % 2 === 0 && items.length >= 3) {
        slide.addShape("rect" as any, {
          x: x + 0.06, y: itemY, w: colW - 0.07, h: itemH,
          fill: { color: pal, transparency: 94 },
        });
      }

      // Bullet dot
      slide.addShape("ellipse" as any, {
        x: x + 0.14, y: itemY + itemH / 2 - dotSz / 2,
        w: dotSz, h: dotSz,
        fill: { color: pal, transparency: i % 2 === 0 ? 10 : 45 },
      });

      // Item text
      slide.addText(san(items[i]), {
        x: x + 0.32, y: itemY + 0.04,
        w: colW - 0.40, h: itemH - 0.08,
        fontSize, fontFace: d.bodyFont, color: d.text,
        valign: "middle", lineSpacingMultiple: 1.2, fit: "shrink" as any,
      });

      // Hairline separator (not after last item)
      if (i < items.length - 1) {
        slide.addShape("rect" as any, {
          x: x + padX, y: itemY + itemH - 0.008,
          w: colW - padX * 2, h: 0.012,
          fill: { color: d.border },
        });
      }
    }
  };

  drawPanel(lX, d.accent,  lHeader, lItems);
  drawPanel(rX, d.accent2, rHeader, rItems);

  // ── VS badge — vertically centred between the two panels ──
  const vsCX = ML + colW + vsBadgeW / 2;   // horizontal centre of gap
  const vsSz = 0.46;
  const vsY  = panelY + panelH / 2 - vsSz / 2;

  // Spine line
  slide.addShape("rect" as any, {
    x: vsCX - 0.01, y: panelY + 0.10,
    w: 0.02, h: panelH - 0.20,
    fill: { color: d.border },
  });
  // Circle badge
  slide.addShape("ellipse" as any, {
    x: vsCX - vsSz / 2, y: vsY, w: vsSz, h: vsSz,
    fill: { color: d.accent3 },
    line: { color: d.bg, width: 2.0 },
  });
  slide.addText("VS", {
    x: vsCX - vsSz / 2, y: vsY, w: vsSz, h: vsSz,
    fontSize: 11, fontFace: d.titleFont, bold: true,
    color: "FFFFFF", align: "center", valign: "middle",
  });

  footer(slide, d, num, total);
}

// ── TIMELINE ── Vertical McKinsey-style process steps
function renderTimeline(
  pptx: PptxGenJS,
  slide_: Slide,
  d: Design,
  num: number,
  total: number,
) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);
  header(slide, d, slide_.label || "PROCESSO", slide_.title);

  const items = (slide_.items || []).slice(0, 5);
  if (items.length === 0) {
    footer(slide, d, num, total);
    return;
  }

  const n = items.length;
  const lineX = ML + 0.3;
  const lineW = 0.03;
  const dotSz = 0.4;
  const stepH = (FOOTER_Y - CONTENT_Y - 0.24) / n;
  const boxH = Math.min(0.88, stepH - 0.1);
  const textX = lineX + lineW + 0.32;
  const textW = SLIDE_W - textX - MR;

  // Vertical spine line
  slide.addShape("rect" as any, {
    x: lineX,
    y: CONTENT_Y + 0.12,
    w: lineW,
    h: FOOTER_Y - CONTENT_Y - 0.24,
    fill: { color: d.accent, transparency: 55 },
  });

  for (let i = 0; i < n; i++) {
    const pal = [d.accent, d.accent2, d.accent3][i % 3];
    const centerY = CONTENT_Y + 0.12 + i * stepH + stepH / 2;

    // Dot on spine
    slide.addShape("ellipse" as any, {
      x: lineX + lineW / 2 - dotSz / 2,
      y: centerY - dotSz / 2,
      w: dotSz,
      h: dotSz,
      fill: { color: pal },
    });
    slide.addText(String(i + 1), {
      x: lineX + lineW / 2 - dotSz / 2,
      y: centerY - dotSz / 2,
      w: dotSz,
      h: dotSz,
      fontSize: 13,
      fontFace: d.titleFont,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    });

    // Connector tick
    slide.addShape("rect" as any, {
      x: lineX + lineW,
      y: centerY - 0.01,
      w: 0.28,
      h: 0.02,
      fill: { color: pal, transparency: 30 },
    });

    // Text card
    slide.addShape("roundRect" as any, {
      x: textX,
      y: centerY - boxH / 2,
      w: textW,
      h: boxH,
      fill: { color: d.surface },
      line: { color: d.border, width: 0.3 },
      rectRadius: 0.06,
    });
    // Left accent stripe
    slide.addShape("roundRect" as any, {
      x: textX,
      y: centerY - boxH / 2,
      w: 0.055,
      h: boxH,
      fill: { color: pal },
      rectRadius: 0.06,
    });
    slide.addText(san(items[i]), {
      x: textX + 0.14,
      y: centerY - boxH / 2 + 0.04,
      w: textW - 0.22,
      h: boxH - 0.08,
      fontSize: n <= 3 ? T.BODY : T.BODY_SM,
      fontFace: d.bodyFont,
      color: d.text,
      valign: "middle",
      lineSpacingMultiple: 1.2,
      fit: "shrink" as any,
    });
  }

  footer(slide, d, num, total);
}

// ── DIAGRAM ── Horizontal flow mini-diagram: Input → Process → Output
function renderDiagram(
  pptx: PptxGenJS,
  slide_: Slide,
  d: Design,
  num: number,
  total: number,
) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);
  header(slide, d, slide_.label || "FLUXO", slide_.title);

  const rawItems = (slide_.items || []).slice(0, 5);
  if (rawItems.length === 0) { footer(slide, d, num, total); return; }

  // Parse items — support "Label: description" format for richer boxes
  const stages = rawItems.map((item) => {
    const ci = item.indexOf(": ");
    if (ci > 2 && ci < 42) {
      return { label: item.slice(0, ci).trim(), body: item.slice(ci + 2).trim() };
    }
    return { label: item.trim(), body: "" };
  });

  const n       = stages.length;
  const arrowW  = n <= 3 ? 0.40 : 0.30;
  const boxW    = (CW - (n - 1) * arrowW) / n;
  const boxH    = 2.2;
  const areaY   = CONTENT_Y + (CONTENT_H - boxH) / 2;

  for (let i = 0; i < n; i++) {
    const x   = ML + i * (boxW + arrowW);
    const pal = ([d.accent, d.accent2, d.accent3, d.highlight] as string[])[i % 4];
    const { label, body } = stages[i];

    // Shadow
    slide.addShape("roundRect" as any, {
      x: x + 0.025, y: areaY + 0.03, w: boxW, h: boxH,
      fill: { color: "000000", transparency: 92 }, rectRadius: 0.08,
    });
    // Box surface
    slide.addShape("roundRect" as any, {
      x, y: areaY, w: boxW, h: boxH,
      fill: { color: d.surface }, line: { color: pal, width: 1.5 }, rectRadius: 0.08,
    });
    // Accent top band
    slide.addShape("roundRect" as any, { x, y: areaY, w: boxW, h: 0.30, fill: { color: pal }, rectRadius: 0.08 });
    slide.addShape("rect" as any,      { x, y: areaY + 0.16, w: boxW, h: 0.14, fill: { color: pal } });

    // Label inside accent band
    const labelFs = label.length > 16 ? 7 : 9;
    slide.addText(san(label).toUpperCase(), {
      x: x + 0.08, y: areaY + 0.02, w: boxW - 0.16, h: 0.26,
      fontSize: labelFs, fontFace: d.bodyFont, bold: true,
      color: "FFFFFF", charSpacing: 1, align: "center", valign: "middle",
    });

    // Body description (if available)
    if (body) {
      slide.addText(san(body), {
        x: x + 0.1, y: areaY + 0.38, w: boxW - 0.2, h: boxH - 0.52,
        fontSize: n <= 3 ? T.BODY : T.BODY_SM,
        fontFace: d.bodyFont, color: d.text,
        valign: "top", lineSpacingMultiple: 1.3, fit: "shrink" as any,
      });
    }

    // Arrow connector to next box
    if (i < n - 1) {
      const aX  = x + boxW + 0.05;
      const aCY = areaY + boxH / 2;
      slide.addShape("rect" as any, {
        x: aX, y: aCY - 0.022, w: arrowW - 0.12, h: 0.044,
        fill: { color: pal, transparency: 20 },
      });
      slide.addText("\u25BA", {
        x: aX + arrowW - 0.24, y: aCY - 0.16, w: 0.22, h: 0.32,
        fontSize: 13, color: pal, bold: true, align: "center", valign: "middle",
      });
    }
  }

  footer(slide, d, num, total);
}

// ═══════════════════════════════════════════════════════════
// SECTION 5: AI GENERATION
// ═══════════════════════════════════════════════════════════

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

async function callGemini(prompt: string, geminiKey: string): Promise<string> {
  const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8000,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
}

// ── ADAPTIVE SLIDE COUNT ──
// Calculates target slide count from content word-count + technical density.
// Principle: fewer well-filled slides beats more mediocre slides.
function adaptiveSlideCount(
  content: string,
  density: string,
): { min: number; max: number; target: number } {
  const words = content.trim().split(/\s+/).filter((w) => w.length > 1).length;
  const isTechnical =
    /SELECT\s|INSERT\s|UPDATE\s|DELETE\s|CREATE\s|function\s*\(|import\s+|class\s+|`[^`]+`/i.test(content);

  // Base count driven by content richness
  let base: number;
  if (words <= 800)  base = isTechnical ? 4 : 3;
  else if (words <= 1500) base = 5;
  else               base = 6;

  // Density nudge
  let target = base;
  if (density === "compact")  target = Math.max(3, base - 1);
  if (density === "detailed") target = Math.min(7, base + 1);

  return { min: Math.max(2, target - 1), max: target, target };
}

function buildPrompt(
  courseTitle: string,
  moduleTitle: string,
  moduleContent: string,
  moduleIndex: number,
  density: string,
  language: string,
): string {
  const { min: minSlides, max: maxSlides, target: nSlides } =
    adaptiveSlideCount(moduleContent, density);
  const maxItems = density === "compact" ? 4 : density === "detailed" ? 6 : 5;
  const maxCodeLines = 10;

  // Normalise literal escape sequences that can appear when content is DB-stored
  const normalised = moduleContent
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ");

  const contentSnippet = normalised
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/[`_]/g, "")
    .replace(/:\n+\d+\./g, ":")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 3500);

  return `You are a senior instructional designer producing McKinsey-quality slides for an online course.

COURSE: "${courseTitle}"
MODULE ${moduleIndex + 1} OF COURSE: "${moduleTitle}"

SOURCE CONTENT (treat as ground truth — do NOT invent facts outside it):
---
${contentSnippet}
---

════ GLOBAL RULES ════
1. Output language: ${language}. Every word of every field must be in ${language}.
2. Generate between ${minSlides} and ${maxSlides} slide objects. Target: ${nSlides}. QUALITY OVER QUANTITY: if the source content does not justify ${maxSlides} slides, generate fewer high-quality slides — never pad with weak or repeated content.
3. Each slide title: 5–60 chars, specific and descriptive. FORBIDDEN titles: "Introdução", "Visão Geral", "Overview", "Introduction", "Módulo ${moduleIndex + 1}", or any title that merely repeats the module name.
4. Items: concrete, single-idea statements. Max 15 words each. No bullet prefixes, no numbering.
5. Max ${maxItems} items per non-code slide; max 3 items on code slides.
6. VARIETY RULE: never place the same layout in more than 2 consecutive slides. Each module should combine bullets, comparison/process/diagram, cards, code, and takeaways where appropriate.
7. The LAST slide of the array MUST use layout "takeaways".

════ SEMANTIC CURATION RULES ════
Each slide must be semantically uniform — never mix different categories of knowledge in the same slide:
• COMMAND slides (commands, functions, operators, syntax) → use layout "code" or "bullets" with only commands/functions.
• APPLICATION slides (real-world use cases, practical examples) → use layout "bullets" or "cards" with only practical uses.
• OBJECTIVE slides (learning goals, outcomes) → use layout "takeaways" only.
• CONCEPT slides (definitions, principles, theory) → use layout "bullets" or "cards" with only conceptual items.
• Do NOT mix a command with a learning objective in the same slide.
• Do NOT mix a practical use case with a definition in the same slide.
• If content naturally covers multiple categories, create separate slides for each.

════ LAYOUT GUIDE ════
"bullets"    — default for explanations, definitions, principles (3–5 items). Avoid >2 consecutive.
"cards"      — 3–4 distinct named concepts. Each item MUST follow "Term: one-line explanation" (≤15 words after ":").
"twocol"     — 6–8 short facts that naturally split into two parallel groups.
"process"    — ordered steps / pipeline / workflow. 3–5 items, each starting with an action verb.
              USE when: passo a passo, etapas, fluxo, ciclo, sequência, como funciona, pipeline, how to, steps.
"timeline"   — time-ordered milestones or historical events. 3–5 items.
"comparison" — exactly two things contrasted side by side. USE FREQUENTLY.
              USE when: vs, versus, diferença, contraste, tipos, modelos, antes/depois, pros/cons, vantagens/desvantagens.
              Examples: DELETE vs TRUNCATE, INNER JOIN vs LEFT JOIN, SQL vs NoSQL, síncrono vs assíncrono.
              Requires leftHeader, rightHeader, up to 4 leftItems, up to 4 rightItems.
"diagram"    — horizontal flow architecture: Stage1 → Stage2 → Stage3 (2–5 stages). USE for data flows, system architecture.
              USE when: request/response, ETL, cliente-servidor, arquitetura, fluxo de dados, entrada→saída, pipeline de dados.
              Items can be "StageName: brief description" for richer boxes.
"code"       — MANDATORY when content covers SQL commands, syntax, functions, loops, classes, API calls, CLI, operators.
              SQL: always use code layout for SELECT, INSERT, UPDATE, DELETE, JOIN, CREATE TABLE, DROP, TRUNCATE, GROUP BY.
              Provide real, runnable code. Max ${maxCodeLines} lines (\\n separated). Max 3 context items.
              CRITICAL: preserve SQL wildcards exactly — SELECT *, COUNT(*), SUM(*) must appear as-is in code field.
              SQL keywords to highlight in code: SELECT, FROM, WHERE, JOIN, GROUP BY, ORDER BY, HAVING, INSERT, UPDATE, DELETE.
"takeaways"  — LAST slide only. 3–5 key learning outcomes from this module, each starting with an action verb.

════ OUTPUT FORMAT ════
Return ONLY a valid JSON array — no markdown fences, no commentary.

Schema (use the matching shape per layout):
[
  {
    "layout": "bullets"|"cards"|"twocol"|"process"|"timeline"|"takeaways",
    "label": "CAPS LABEL ≤25 CHARS",
    "title": "Specific slide title",
    "items": ["item 1", "item 2", "item 3"]
  },
  {
    "layout": "code",
    "label": "CAPS LABEL",
    "title": "Slide title",
    "items": ["context point 1", "context point 2"],
    "code": "line1\\nline2\\nline3",
    "codeLabel": "Python|JavaScript|SQL|TypeScript|Bash|etc"
  },
  {
    "layout": "comparison",
    "label": "CAPS LABEL",
    "title": "A vs B",
    "leftHeader": "Concept A",
    "rightHeader": "Concept B",
    "leftItems": ["point 1", "point 2", "point 3"],
    "rightItems": ["point 1", "point 2", "point 3"]
  },
  {
    "layout": "diagram",
    "label": "FLUXO",
    "title": "Fluxo de consulta SQL",
    "items": ["Cliente: envia query", "Parser: valida sintaxe", "Executor: processa", "Storage: retorna dados"]
  }
]`;
}

async function generateModuleSlides(
  courseTitle: string,
  mod: { title: string; content: string },
  moduleIndex: number,
  density: string,
  language: string,
  geminiKey: string,
): Promise<Slide[]> {
  try {
    const prompt = buildPrompt(
      courseTitle,
      mod.title,
      mod.content || "",
      moduleIndex,
      density,
      language,
    );
    const raw = await callGemini(prompt, geminiKey);

    let parsed: any[];
    try {
      // Remove possible markdown code fences
      const clean = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      parsed = JSON.parse(clean);
      if (!Array.isArray(parsed)) throw new Error("Not array");
    } catch {
      console.warn(
        `[V5] Module ${moduleIndex + 1}: JSON parse failed, using fallback`,
      );
      return fallbackModuleSlides(mod.title, mod.content, moduleIndex, density);
    }

    const VALID_LAYOUTS: Layout[] = [
      "bullets",
      "cards",
      "takeaways",
      "code",
      "diagram",
      "twocol",
      "comparison",
      "timeline",
      "process",
    ];
    const rawSlides: Slide[] = parsed.map((s: any) => ({
      layout: (VALID_LAYOUTS.includes(s.layout)
        ? s.layout
        : "bullets") as Layout,
      title: s.layout === "takeaways"
        ? cleanTakeawayTitle(String(s.title || ""), mod.title)
        : cleanSlideTitle(String(s.title || mod.title).slice(0, 80), mod.title),
      label: s.layout === "takeaways"
        ? rotateSummaryLabel(moduleIndex)
        : String(s.label || "CONTEÚDO").slice(0, 32).toUpperCase(),
      items: Array.isArray(s.items)
        ? s.items.slice(0, 6)
            .map((x: any) => safeItemText(globalSanitize(String(x)), 105))
            .filter((x: string) => x.length > 0)
        : [],
      code: s.code ? validateCodeIntegrity(String(s.code).slice(0, 1200)) : undefined,
      codeLabel: s.codeLabel ? String(s.codeLabel).slice(0, 20) : "Python",
      leftHeader: s.leftHeader ? globalSanitize(String(s.leftHeader)).slice(0, 40) : undefined,
      rightHeader: s.rightHeader ? globalSanitize(String(s.rightHeader)).slice(0, 40) : undefined,
      leftItems: Array.isArray(s.leftItems)
        ? s.leftItems.slice(0, 4)
            .map((x: any) => globalSanitize(String(x)).slice(0, 90))
            .filter((x: string) => x.length > 0)
        : undefined,
      rightItems: Array.isArray(s.rightItems)
        ? s.rightItems.slice(0, 4)
            .map((x: any) => globalSanitize(String(x)).slice(0, 90))
            .filter((x: string) => x.length > 0)
        : undefined,
      moduleIndex,
    }));

    // Repair empty slides first, then filter out any that are still un-renderable
    return rawSlides
      .map((s) => repairEmptySlide(s, mod.content || ""))
      .filter(isRenderableSlide);
  } catch (e: any) {
    console.error(`[V5] Module ${moduleIndex + 1} AI error: ${e.message}`);
    return fallbackModuleSlides(mod.title, mod.content, moduleIndex, density);
  }
}

function fallbackModuleSlides(
  title: string,
  content: string,
  moduleIndex: number,
  density: string,
): Slide[] {
  // Extract bullets from markdown content
  const bullets = [...content.matchAll(/^[-*•]\s+(.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((b) => b.length > 10)
    .slice(0, 12);

  const sentences = content
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/[`_\-*•]/g, "")
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 150)
    .slice(0, 12);

  const items = bullets.length >= 3 ? bullets : sentences;
  const nSlides = density === "compact" ? 2 : density === "detailed" ? 4 : 3;
  const slides: Slide[] = [];
  const chunkSize = Math.ceil(items.length / nSlides);

  for (let i = 0; i < nSlides; i++) {
    const chunk = items.slice(i * chunkSize, (i + 1) * chunkSize);
    if (i === nSlides - 1) {
      slides.push({
        layout: "takeaways",
        title: `Principais Aprendizados: ${title}`,
        label: "PRINCIPAIS APRENDIZADOS",
        items: chunk.slice(0, 5),
        moduleIndex,
      });
    } else {
      slides.push({
        layout: "bullets",
        title: title,
        label: "CONTEÚDO",
        items: chunk.slice(0, 5),
        moduleIndex,
      });
    }
  }
  return slides;
}

// ═══════════════════════════════════════════════════════════
// SECTION 5.5: PPTX REPAIR
// ═══════════════════════════════════════════════════════════

async function repairPptxPackage(
  pptxData: Uint8Array,
): Promise<{ data: Uint8Array; diag: Record<string, unknown> }> {
  const zip = await JSZip.loadAsync(pptxData);
  const allFileNames = Object.keys(zip.files);

  const noteFiles = allFileNames.filter(
    (name) =>
      name.startsWith("ppt/notesSlides/") ||
      name.startsWith("ppt/notesMasters/"),
  );
  for (const name of noteFiles) zip.remove(name);

  const presentationFile = zip.file("ppt/presentation.xml");
  if (presentationFile) {
    const xml = await presentationFile.async("string");
    zip.file(
      "ppt/presentation.xml",
      xml
        .replace(/<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>/g, "")
        .replace(/\s{2,}/g, " "),
    );
  }

  const presentationRelsFile = zip.file("ppt/_rels/presentation.xml.rels");
  if (presentationRelsFile) {
    const xml = await presentationRelsFile.async("string");
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      xml
        .replace(/<Relationship[^>]*Type="[^"]*\/notesMaster"[^>]*\/>/g, "")
        .replace(/\s{2,}/g, " "),
    );
  }

  const viewPropsFile = zip.file("ppt/viewProps.xml");
  if (viewPropsFile) {
    const xml = await viewPropsFile.async("string");
    zip.file(
      "ppt/viewProps.xml",
      xml
        .replace(/<p:notesTextViewPr>[\s\S]*?<\/p:notesTextViewPr>/g, "")
        .replace(/\s{2,}/g, " "),
    );
  }

  const appPropsFile = zip.file("docProps/app.xml");
  if (appPropsFile) {
    const xml = await appPropsFile.async("string");
    zip.file(
      "docProps/app.xml",
      xml
        .replace(/<Notes>\d+<\/Notes>/g, "<Notes>0</Notes>")
        .replace(/\s{2,}/g, " "),
    );
  }

  for (const name of allFileNames.filter((f) =>
    /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(f),
  )) {
    const f = zip.file(name);
    if (!f) continue;
    const xml = await f.async("string");
    zip.file(
      name,
      xml
        .replace(/<Relationship[^>]*Type="[^"]*\/notesSlide"[^>]*\/>/g, "")
        .replace(/\s{2,}/g, " "),
    );
  }

  const refreshedFileNames = new Set(Object.keys(zip.files));
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) {
    const earlyOut = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    });
    return {
      data: earlyOut,
      diag: { notes_removed: noteFiles.length, early_return: true },
    };
  }

  const ctXml = await contentTypesFile.async("string");
  const repairedCt = ctXml.replace(
    /<Override\b[^>]*PartName="([^"]+)"[^>]*\/>/g,
    (full, partName) => {
      const norm = String(partName || "").replace(/^\//, "");
      return norm && !refreshedFileNames.has(norm) ? "" : full;
    },
  );
  zip.file("[Content_Types].xml", repairedCt);

  const finalFileNames = Object.keys(zip.files);
  const out = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });

  // Validate repaired output
  const testZip = await JSZip.loadAsync(out);
  const testFiles = Object.keys(testZip.files).filter((f) => !f.endsWith("/"));
  const slideFiles = testFiles.filter((f) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(f),
  );
  const ctXmlRepaired =
    (await testZip.file("[Content_Types].xml")?.async("string")) ?? "";

  return {
    data: out,
    diag: {
      notes_removed: noteFiles.length,
      files_before: allFileNames.length,
      files_after: finalFileNames.length,
      slide_count: slideFiles.length,
      has_presentation: !!testZip.file("ppt/presentation.xml"),
      content_types: ctXmlRepaired.slice(0, 1500),
    },
  };
}

// ═══════════════════════════════════════════════════════════
// SECTION 6: PIPELINE
// ═══════════════════════════════════════════════════════════

// ── GLOBAL SANITISATION ──
// Strips literal escape sequences, structural emojis, markdown markers and
// noise phrases before any text reaches a renderer or validator.
const STRUCTURAL_EMOJI_RE =
  /[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}\uFE00-\uFE0F\u200D\u{20D0}-\u{20FF}]/gu;
const MARKDOWN_BOLD_RE   = /\*{1,2}([^*]+)\*{1,2}/g;
const MARKDOWN_ITALIC_RE = /_{1,2}([^_]+)_{1,2}/g;
const MODULE_NOISE_RE    =
  /\b(m[oó]dulo\s+\d+|objetivo\s+do\s+m[oó]dulo|fundamentos|como\s+funciona|conceitos\s+b[aá]sicos)\b/gi;

// SQL wildcard patterns that must never be mangled by markdown strippers
// e.g. SELECT *, COUNT(*), SUM(*), FROM *, SELECT DISTINCT *
const SQL_WILDCARD_RE =
  /\b(COUNT|SUM|AVG|MAX|MIN|COALESCE|NULLIF|ISNULL)\s*\(\s*\*\s*\)|\bSELECT\s+DISTINCT\s+\*|\bSELECT\s+\*|\bFROM\s+\*/gi;

// IMPORTANT: slot markers use printable ASCII [[...]] notation.
// Control chars (\x00-\x1F) ARE erased by san() — never use them as markers here.
function globalSanitize(text: string): string {
  if (!text || typeof text !== "string") return "";

  // Step 1a: protect SQL wildcard expressions using printable-ASCII markers [[SQLW_N]]
  const sqlSlots: string[] = [];
  const withSqlProt = text.replace(SQL_WILDCARD_RE, (match) => {
    sqlSlots.push(match);
    return `[[SQLW_${sqlSlots.length - 1}]]`;
  });

  // Step 1b: protect backtick-quoted content using printable-ASCII markers [[BT_N]]
  const backtickSlots: string[] = [];
  const slotted = withSqlProt.replace(/`([^`]*)`/g, (_full, inner: string) => {
    backtickSlots.push(inner);
    return `[[BT_${backtickSlots.length - 1}]]`;
  });

  // Step 2: clean markdown & noise — san() is safe here (markers are ASCII printable)
  const cleaned = san(
    slotted
      .replace(/\\n/g, " ").replace(/\\t/g, " ")   // literal escape sequences
      .replace(STRUCTURAL_EMOJI_RE, "")              // structural emojis
      .replace(MARKDOWN_BOLD_RE,   "$1")             // **bold** → plain text
      .replace(MARKDOWN_ITALIC_RE, "$1")             // _italic_ → plain text
      .replace(MODULE_NOISE_RE,    "")               // noise phrases
      .replace(/\s{2,}/g, " ")
      .trim()
  );

  // Step 3: restore protected content (backticks first, then SQL wildcards)
  const withBt = cleaned.replace(
    /\[\[BT_(\d+)\]\]/g,
    (_m, idx: string) => backtickSlots[Number(idx)] ?? "",
  );
  return withBt.replace(
    /\[\[SQLW_(\d+)\]\]/g,
    (_m, idx: string) => sqlSlots[Number(idx)] ?? "",
  );
}

// Safe title: never cuts mid-word, max 60 chars by default
function sanitizeTitle(title: string, max = 60): string {
  const t = globalSanitize(title);
  if (t.length <= max) return t;
  const boundary = t.slice(0, max + 15).lastIndexOf(" ");
  return boundary > max * 0.6 ? t.slice(0, boundary) : t.slice(0, max);
}

// ── SLIDE TITLE NORMALIZATION ──
// Prevents titles starting with bare prepositions/articles (truncation artifact)
// and adds context prefixes when the title looks like a fragment.
const TITLE_PREP_RE = /^(da|de|do|das|dos|na|no|nas|nos|ao|à|às|em|pelo|pela|pelos|pelas|para|com|por|num|numa|sobre|entre|após|desde|sem|um|uma|uns|umas)\s+/i;

// Extract common uppercase acronyms from a string (DDL, SQL, DML, SGBD, etc.)
function extractTitleAcronym(text: string): string {
  const m = text.match(/\b([A-Z]{2,6})\b/);
  return m ? m[1] : "";
}

// Generic takeaway titles the AI tends to generate — we'll replace these
const GENERIC_TAKEAWAY_RE =
  /^(o que você (aprenderá|aprendeu|vai aprender|aprendemos)|takeaways?|resumo geral|vis[aã]o geral|overview|summary|o que aprendemos|principais pontos|pontos( chave)?|key (takeaways?|points?))$/i;

// Normalize a slide title: fix fragments, preposition-starts, truncation.
function normalizeSlideTitle(title: string, moduleTitle: string): string {
  const raw = (title || "").trim();
  if (!raw) return sanitizeTitle(moduleTitle || "Conteúdo");

  // Fix title that starts with a bare preposition (looks like a truncated fragment)
  if (TITLE_PREP_RE.test(raw)) {
    const acronym = extractTitleAcronym(moduleTitle);
    const stripped = raw.replace(TITLE_PREP_RE, "").trim();
    // Capitalize first letter of stripped
    const cap = stripped.charAt(0).toUpperCase() + stripped.slice(1);
    const candidate = acronym ? `${acronym}: ${cap}` : cap;
    return sanitizeTitle(candidate || moduleTitle);
  }

  return sanitizeTitle(raw);
}

// Clean a takeaway slide title — replace generic AI-generated titles with
// meaningful, context-aware alternatives.
function cleanTakeawayTitle(title: string, moduleTitle: string): string {
  const t = (title || "").trim();
  if (!t || GENERIC_TAKEAWAY_RE.test(t)) {
    const mod = moduleTitle.trim();
    const opts = [
      "Principais Aprendizados",
      `Síntese: ${mod}`,
      "Aprendizados Essenciais",
      "Resumo do Módulo",
    ];
    return sanitizeTitle(opts[mod.length % opts.length]);
  }
  return sanitizeTitle(t);
}

// ── TITLE GARBAGE CLEANUP ──
const GARBAGE_TITLE_RE =
  /^(m[oó]dulo\s+\d+|objetivo\s+(do\s+)?m[oó]dulo|introdu[cç][aã]o\s+ao\s+m[oó]dulo|vis[aã]o\s+geral\s+do\s+m[oó]dulo|conte[uú]do\s+do\s+m[oó]dulo|overview|introduction|module\s+\d+|fundamentos|conceitos\s+b[aá]sicos)$/i;

function cleanSlideTitle(title: string, moduleTitle: string): string {
  const raw = (title || "").trim();
  if (!raw || GARBAGE_TITLE_RE.test(raw) || raw.toLowerCase() === moduleTitle.trim().toLowerCase()) {
    return sanitizeTitle(moduleTitle);
  }
  // Apply full normalization (preposition fix, etc.)
  return normalizeSlideTitle(raw, moduleTitle);
}

// ═══════════════════════════════════════════════════════════
// POLISHING UTILITIES  (Patches 5–12 + Quality Gate)
// ═══════════════════════════════════════════════════════════

// ── 1. Safe word-boundary truncation ──
function safeItemText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf(" ", maxChars - 1);
  return cut > maxChars * 0.55 ? text.slice(0, cut) + "…" : text.slice(0, maxChars) + "…";
}

// ── 2. Rotating takeaway/summary labels ──
const SUMMARY_LABELS = [
  "PRINCIPAIS CONCEITOS",
  "APRENDIZADOS",
  "RESUMO",
  "TAKEAWAYS",
  "O QUE VOCÊ APRENDEU",
  "RESULTADOS",
  "SÍNTESE",
  "PONTOS-CHAVE",
];
function rotateSummaryLabel(moduleIndex: number): string {
  return SUMMARY_LABELS[moduleIndex % SUMMARY_LABELS.length];
}

// ── 3. Vague objective expansion ──
// Enriches generic phrases with technical context BEFORE normalization.
function expandVagueObjective(text: string, moduleTitle: string): string {
  const topicLabel = moduleTitle || "SQL";
  return text
    .replace(/\bFunções Avançadas\b/g,           "funções SQL avançadas e agregações")
    .replace(/\bfunções avançadas\b/gi,           "funções SQL avançadas")
    .replace(/\btópicos avançados\b/gi,           `técnicas avançadas de ${topicLabel}`)
    .replace(/\bconceitos (gerais|avançados|básicos)\b/gi, `conceitos de ${topicLabel}`)
    .replace(/\bcoisas avançadas\b/gi,            "técnicas avançadas de SQL")
    .replace(/\bfundamentos (gerais|básicos)\b/gi,"fundamentos de banco de dados relacionais")
    .replace(/\bRelacionamentos e Funções Avançadas\b/gi,
             "relacionamentos entre tabelas e funções SQL avançadas")
    .replace(/\brelacionamentos e funções\b/gi,   "relacionamentos entre tabelas e funções SQL")
    .replace(/\brelacionamentos\b(?!\s+(entre|de|com|e\s))/gi, "relacionamentos entre tabelas")
    .replace(/\best(a|e) módulo\b/gi,             topicLabel);
}

// ── 4. Semantic title ↔ content alignment ──
// Corrects compound DDL/DML titles when only one command is present in the body.
function validateSemanticAlignment(slide: Slide, moduleTitle: string): Slide {
  if (["cover","toc","module_cover","closing","takeaways"].includes(slide.layout)) return slide;
  const title = slide.title || "";
  const body  = [...(slide.items || []), slide.code || ""].join(" ");

  if (/criando e (modificando|alterando)/i.test(title)) {
    const hasCreate = /\bCREATE\b/i.test(body);
    const hasAlter  = /\bALTER\b/i.test(body);
    const hasDrop   = /\bDROP\b|\bTRUNCATE\b/i.test(body);
    if (hasCreate && !hasAlter && !hasDrop)
      return { ...slide, title: cleanSlideTitle("Criando Tabelas com CREATE TABLE", moduleTitle) };
    if (hasAlter && !hasCreate && !hasDrop)
      return { ...slide, title: cleanSlideTitle("Alterando Estruturas com ALTER TABLE", moduleTitle) };
    if (hasDrop && !hasCreate && !hasAlter)
      return { ...slide, title: cleanSlideTitle("Removendo Objetos com DROP e TRUNCATE", moduleTitle) };
  }
  if (/insert.*update|update.*insert/i.test(title)) {
    const hasInsert = /\bINSERT\b/i.test(body);
    const hasUpdate = /\bUPDATE\b/i.test(body);
    if (hasInsert && !hasUpdate)
      return { ...slide, title: cleanSlideTitle("Inserindo Dados com INSERT INTO", moduleTitle) };
    if (!hasInsert && hasUpdate)
      return { ...slide, title: cleanSlideTitle("Atualizando Dados com UPDATE", moduleTitle) };
  }
  return slide;
}

// ── 5. Code integrity validator ──
// Detects comment lines that imply a SQL command but are NOT followed by the
// actual statement (e.g. "-- Remove a tabela Autores" with no DROP TABLE after).
// Auto-completes the missing command so code blocks are never left truncated.
function validateCodeIntegrity(code: string): string {
  if (!code || !code.trim()) return code;
  const lines = code.split("\n");
  const output: string[] = [];
  const HAS_SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|WITH|BEGIN|COMMIT|ROLLBACK)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    output.push(line);

    if (!/^\s*--/.test(line)) continue; // only process comment lines
    const comment = line.replace(/^\s*--\s*/, "").trim();

    // Find the next non-empty line
    let nextIdx = i + 1;
    while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;
    const nextLine = (lines[nextIdx] ?? "").trim();
    if (HAS_SQL.test(nextLine)) continue; // already followed by a valid SQL statement

    // Extract the most likely object name (last PascalCase/UPPER token in comment)
    const objMatch = comment.match(/\b([A-Z][a-zA-Z0-9_]*)\s*$/);
    const objName  = objMatch?.[1] ?? null;
    if (!objName) continue;

    if (/\b(remove?s?|drop|apaga|exclu[ií]|elimina)\b/i.test(comment)) {
      output.push(`DROP TABLE ${objName};`);
    } else if (/\b(trunca|limpa|esvaz|zera registros)\b/i.test(comment)) {
      output.push(`TRUNCATE TABLE ${objName};`);
    } else if (/\b(deleta|exclui registro|remove registro)\b/i.test(comment)) {
      output.push(`DELETE FROM ${objName} WHERE id = 1; -- Adapte o filtro`);
    }
  }
  return output.join("\n");
}

// ── 6. Semantic Quality Gate ──
// Final check applied after validateSemanticAlignment in processBatch.
// Repairs or drops slides that still fail quality criteria.
// Returns null → caller must filter the slide out.
const PLACEHOLDER_RE = /^\[.*\]$|^(TODO|TBD|PLACEHOLDER|CONTEÚDO AQUI|ITEM \d+)$/i;
const FRAG_CONJ_RE   = /^(e|é|ou|mas|porém|então)\s+/i;

function semanticQualityGate(slide: Slide, moduleTitle: string): Slide | null {
  // ── Title integrity: fix fragment / conjunction-start titles ──
  let title = (slide.title || "").trim();
  if (!title || title.length < 3) {
    title = moduleTitle;
  } else if (TITLE_PREP_RE.test(title) || FRAG_CONJ_RE.test(title)) {
    const fixed = title
      .replace(TITLE_PREP_RE, "")
      .replace(FRAG_CONJ_RE, "")
      .trim();
    title = (fixed.charAt(0).toUpperCase() + fixed.slice(1)) || moduleTitle;
  }
  slide = { ...slide, title };

  // ── Code integrity ──
  if (slide.code) {
    slide = { ...slide, code: validateCodeIntegrity(slide.code) };
  }

  // ── Module cover: expand + normalize AI-generated objectives ──
  if (slide.layout === "module_cover" && Array.isArray(slide.items) && slide.items.length > 0) {
    const expanded = slide.items
      .map((item, idx) =>
        withPeriod(normalizeLearningObjective(
          expandVagueObjective(item, moduleTitle), moduleTitle, idx,
        )),
      )
      .filter((item) => item.length > 8 && !BAD_OBJECTIVE_RE.test(item));
    if (expanded.length >= 2) slide = { ...slide, items: expanded };
  }

  // ── Placeholder / residual content guard ──
  if (Array.isArray(slide.items)) {
    const cleaned = slide.items.filter((item) => !PLACEHOLDER_RE.test(item.trim()));
    if (cleaned.length !== slide.items.length) slide = { ...slide, items: cleaned };
  }

  // ── Drop if still un-renderable after all repairs ──
  if (!isRenderableSlide(slide)) return null;

  return slide;
}

// ── LAYOUT HEURISTIC SELECTOR ──
// Applies BEFORE render to pick a better layout based on title keywords and
// item count. Never changes structural or code slides.
const SKIP_HEURISTIC: Layout[] = ["cover","toc","module_cover","closing","code","takeaways"];

// SQL keyword detection — items that look like commands/queries
const SQL_ITEM_RE = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE|JOIN|GROUP\s+BY|ORDER\s+BY|WHERE|HAVING|GRANT|REVOKE)\b/i;

function chooseLayout(slide: Slide, prevLayouts: Layout[]): Slide {
  if (SKIP_HEURISTIC.includes(slide.layout)) return slide;

  const title = (slide.title || "").toLowerCase();
  const useful = nonEmpty(slide.items);
  const n = useful.length;
  const allHaveColon = n >= 2 && useful.every((i) => i.includes(": "));

  // Check if items look like SQL commands → prefer code
  const hasSqlItems = slide.layout !== "code" &&
    useful.some((item) => SQL_ITEM_RE.test(item));

  let chosen: Layout = slide.layout;

  // SQL content → code layout
  if (hasSqlItems && slide.layout === "bullets" && n <= 5) {
    chosen = "code";
  }
  // Comparison triggers (expanded — use aggressively for contrasts)
  else if (/\bvs\.?\b|versus|\bdiferença|\bcomparação|\bcontraste|\bantes.+depois\b|\bpros.+cons\b|\btipos de\b|\bmodelos de\b|\bDELETE vs\b|\bDROP vs\b|\bTRUNCATE vs\b|\bINNER.+LEFT\b|\bvantagens.+desvan/i.test(title)) {
    chosen = "comparison";
  }
  // Diagram triggers: data flow / architecture
  else if (/\bfluxo de\b|\barquitetura\b|\brequest.+response\b|\bETL\b|\bclient.+server\b|\bcliente.+servidor\b|\bentrada.+sa[íi]da\b|\bpipeline de dados\b|\bfluxo de consulta\b|\bfluxo de dados\b/i.test(title)) {
    if (n >= 2 && n <= 5) chosen = "diagram";
  }
  // Process / flow triggers (ordered steps)
  else if (/\bpasso\b|\betapa\b|\bsequência\b|\bciclo\b|\bpipeline\b|\bcomo funciona\b|\bhow to\b|\bfluxo\b|\bprocesso\b/i.test(title)) {
    if (n >= 3 && n <= 5) chosen = "process";
  }
  // 6+ items → two columns
  else if (n >= 6) {
    chosen = "twocol";
  }
  // 2-4 items all "Term: explanation" → cards
  else if (allHaveColon && n >= 2 && n <= 4) {
    chosen = "cards";
  }

  // Anti-repetition: if this would make 3 consecutive same-layout, force variety
  if (
    chosen !== "code" && // never override code layout for anti-repetition
    prevLayouts.length >= 2 &&
    prevLayouts[prevLayouts.length - 1] === chosen &&
    prevLayouts[prevLayouts.length - 2] === chosen
  ) {
    if      (chosen === "bullets" && n >= 5)      chosen = "twocol";
    else if (chosen === "bullets" && n >= 2)      chosen = "cards";
    else if (chosen === "twocol")                 chosen = "bullets";
    else if (chosen === "process")                chosen = "timeline";
    else if (chosen === "diagram")                chosen = "process";
    else                                          chosen = "bullets";
  }

  if (chosen === slide.layout) return slide;

  // Guard: make sure the new layout will pass isRenderableSlide
  const candidate = { ...slide, layout: chosen as Layout };
  if (!isRenderableSlide(candidate)) return slide; // revert if not renderable

  console.log(`[V5] chooseLayout: "${slide.title}" ${slide.layout}→${chosen} (${n} items)`);
  return candidate;
}

// ── LAYOUT VARIETY ENFORCEMENT ──
// Prevents more than 2 consecutive slides with the same layout
const VARIETY_SWAPPABLE: Layout[] = ["bullets", "twocol", "diagram"];

function applyLayoutVariety(slides: Slide[]): Slide[] {
  // Pass 1 — heuristic layout selection with running history
  const withHeuristic: Slide[] = [];
  const history: Layout[] = [];
  for (const s of slides) {
    const picked = chooseLayout(s, history);
    withHeuristic.push(picked);
    history.push(picked.layout);
  }

  // Pass 2 — anti-repetition safety net (same as before)
  const out: Slide[] = [...withHeuristic];
  for (let i = 2; i < out.length - 1; i++) {
    const cur   = out[i].layout;
    const prev1 = out[i - 1].layout;
    const prev2 = out[i - 2].layout;
    if (!VARIETY_SWAPPABLE.includes(cur) || cur !== prev1 || cur !== prev2) continue;

    const items = nonEmpty(out[i].items);
    if (cur === "bullets") {
      if (items.length >= 5) {
        out[i] = { ...out[i], layout: "twocol" };
        console.log(`[V5] Variety pass2: slide ${i + 1} bullets→twocol`);
      } else if (items.length >= 2) {
        out[i] = { ...out[i], layout: "cards" };
        console.log(`[V5] Variety pass2: slide ${i + 1} bullets→cards`);
      }
    } else if (cur === "twocol") {
      out[i] = { ...out[i], layout: "bullets" };
      console.log(`[V5] Variety pass2: slide ${i + 1} twocol→bullets`);
    }
  }
  return out;
}

// ── CONTENT VALIDATION & REPAIR ──
const SELF_SUFFICIENT_LAYOUTS: Layout[] = [
  "cover",
  "toc",
  "module_cover",
  "closing",
];

// Helper: non-empty strings from an array
function nonEmpty(arr: string[] | undefined): string[] {
  return (arr || []).filter((s) => s.trim().length > 0);
}

// Per-layout minimum thresholds — stricter than v4 to prevent empty shapes.
function isRenderableSlide(s: Slide): boolean {
  if (!s.title?.trim()) return false;
  if (SELF_SUFFICIENT_LAYOUTS.includes(s.layout)) return true;
  switch (s.layout) {
    case "bullets":
    case "takeaways":
      // Need ≥3 real items so numbered rows don't render blank
      return nonEmpty(s.items).length >= 3;
    case "process":
    case "timeline":
    case "diagram":
      // Need ≥2 items so flow/step shapes aren't empty (diagram allows 2)
      return nonEmpty(s.items).length >= 2;
    case "twocol":
      // Need ≥4 items to populate both columns meaningfully
      return nonEmpty(s.items).length >= 4;
    case "cards":
      // Need ≥2 cards with content (title or body)
      return nonEmpty(s.items).length >= 2;
    case "comparison":
      // Need ≥2 items in EACH column
      return nonEmpty(s.leftItems).length >= 2 && nonEmpty(s.rightItems).length >= 2;
    case "code":
      return typeof s.code === "string" && s.code.trim().length > 0;
    default: {
      const hasItems = nonEmpty(s.items).length > 0;
      const hasCode  = typeof s.code === "string" && s.code.trim().length > 0;
      return hasItems || hasCode;
    }
  }
}

function repairEmptySlide(s: Slide, moduleContent: string): Slide {
  if (isRenderableSlide(s)) return s;

  // Extract fallback bullets from module content
  const bullets = [...(moduleContent || "").matchAll(/^[-*•]\s+(.+)$/gm)]
    .map((m) => globalSanitize(m[1]))
    .filter((b) => b.length >= 15 && b.length <= 100);

  const sentences = (moduleContent || "")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/[`_]/g, "")
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 100)
    .slice(0, 8);

  const pool = bullets.length >= 3 ? bullets : sentences;
  // Need at least 3 items to satisfy new isRenderableSlide threshold
  const repaired = pool.slice(0, 5);

  if (repaired.length < 3) {
    console.warn(`[V5] Cannot repair slide "${s.title}" — insufficient content, dropping`);
    return s; // will be filtered out
  }

  console.warn(
    `[V5] Repaired slide "${s.title}" (${s.layout}) → bullets with ${repaired.length} items`,
  );
  return { ...s, layout: "bullets", items: repaired };
}

// ── OVERFLOW GUARD ──
// Handles two overflow cases:
//   1. comparison: >4 items per side or long text → convert to twocol
//   2. code: too many items or lines → split into explanation + code slides
const CODE_MAX_LINES = 12;
const CODE_MAX_ITEMS_WITH_CODE = 3;
const COMPARISON_MAX_ITEMS = 4;
const COMPARISON_MAX_CHARS = 68; // max chars per comparison bullet before fallback

function splitOverflowSlides(slides: Slide[]): Slide[] {
  const out: Slide[] = [];
  for (const s of slides) {
    // ── Comparison overflow → twocol ──
    if (s.layout === "comparison") {
      const lItems = nonEmpty(s.leftItems);
      const rItems = nonEmpty(s.rightItems);
      const hasTooMany  = lItems.length > COMPARISON_MAX_ITEMS || rItems.length > COMPARISON_MAX_ITEMS;
      const hasLongText = [...lItems, ...rItems].some((t) => t.length > COMPARISON_MAX_CHARS);

      if (hasTooMany || hasLongText) {
        // Merge both sides into combined items list for twocol
        const combined = [...lItems, ...rItems]
          .map((t) => safeItemText(t, COMPARISON_MAX_CHARS))
          .slice(0, 8);
        console.log(`[V5] Comparison overflow → twocol: "${s.title}" (l=${lItems.length} r=${rItems.length} longText=${hasLongText})`);
        out.push({
          ...s,
          layout: "twocol",
          items: combined,
          leftItems: undefined,
          rightItems: undefined,
        });
      } else {
        out.push(s);
      }
      continue;
    }

    if (s.layout !== "code") {
      out.push(s);
      continue;
    }

    const lines = (s.code || "").split("\n");
    const items = s.items || [];
    const needsSplit =
      items.length > CODE_MAX_ITEMS_WITH_CODE || lines.length > CODE_MAX_LINES;

    if (!needsSplit) {
      out.push(s);
      continue;
    }

    // Slide A — explanation only (bullets)
    if (items.length > 0) {
      out.push({
        layout: "bullets",
        title: s.title,
        label: s.label,
        items: items.slice(0, 5),
        moduleIndex: s.moduleIndex,
      });
    }

    // Slide B — code with max 2 context bullets
    out.push({
      layout: "code",
      title: `${s.title} — Exemplo`,
      label: s.label,
      items: items.slice(0, 2),
      code: lines.slice(0, CODE_MAX_LINES).join("\n"),
      codeLabel: s.codeLabel,
      moduleIndex: s.moduleIndex,
    });
  }
  return out;
}

// ── LEARNING OBJECTIVE NORMALISATION (module cover competencies) ──

const ACTION_VERBS_PT = [
  "Compreender", "Aplicar", "Identificar", "Configurar", "Executar",
  "Construir",   "Analisar", "Definir",    "Utilizar",   "Diferenciar",
];
const VERB_START_RE = new RegExp(
  `^(${ACTION_VERBS_PT.map((v) => v.toLowerCase()).join("|")})\\b`,
  "i",
);

// Detects the broken pattern: action verb immediately followed by another verb
// e.g. "Compreender fornece", "Aplicar modificar", "Identificar conectar-se"
const BAD_OBJECTIVE_RE = new RegExp(
  `^(${ACTION_VERBS_PT.map((v) => v.toLowerCase()).join("|")})\\s+` +
  `(fornece|conectar|selecionar|inserir|criar|modificar|deletar|fazer|realizar|` +
  `gerar|acessar|instalar|consultar|atualizar|remover|retornar|usar|permite|serve|` +
  `refere|significa|indica|representa|demonstra|apresenta|exibe|é |são |tem |têm )`,
  "i",
);

// Topic-specific curated competencies (used when extracted text is not grammatical)
const TOPIC_COMPETENCIES: Record<string, string[]> = {
  select: [
    "Aplicar SELECT para consultar dados em tabelas.",
    "Filtrar resultados com cláusulas WHERE e condições lógicas.",
    "Ordenar e limitar resultados com ORDER BY e LIMIT.",
  ],
  dml: [
    "Inserir novos registros em tabelas com INSERT INTO.",
    "Atualizar dados existentes de forma segura com UPDATE.",
    "Remover registros com segurança utilizando DELETE e filtros.",
  ],
  ddl: [
    "Criar estruturas de banco de dados com CREATE TABLE.",
    "Alterar tabelas e colunas existentes com ALTER TABLE.",
    "Remover objetos do banco de dados com DROP e TRUNCATE.",
  ],
  joins: [
    "Combinar dados de múltiplas tabelas utilizando JOIN.",
    "Diferenciar INNER JOIN, LEFT JOIN e seus casos de uso.",
    "Agrupar e agregar resultados com GROUP BY e funções de agregação.",
  ],
  configuracao: [
    "Compreender os conceitos de bancos de dados relacionais e SGBDs.",
    "Configurar um ambiente SQL com servidor e ferramenta cliente.",
    "Executar os primeiros comandos SQL básicos com segurança.",
  ],
  funcoes: [
    "Utilizar funções de agregação como COUNT, SUM e AVG em consultas.",
    "Aplicar funções de texto, data e matemáticas em resultados.",
    "Analisar dados agrupados com GROUP BY, HAVING e funções de janela.",
  ],
  subquery: [
    "Construir subconsultas para resolver problemas complexos de dados.",
    "Utilizar subqueries em cláusulas WHERE, FROM e SELECT.",
    "Analisar o impacto de subconsultas na performance da query.",
  ],
  index: [
    "Compreender o papel dos índices na performance de consultas.",
    "Criar e gerenciar índices com CREATE INDEX.",
    "Identificar quando e como usar índices de forma eficiente.",
  ],
  transacao: [
    "Compreender o conceito de transações e propriedades ACID.",
    "Utilizar COMMIT e ROLLBACK para controlar transações.",
    "Identificar problemas de concorrência e como evitá-los.",
  ],
};

function detectModuleTopic(title: string): string {
  const t = title.toLowerCase();
  if (/\bselect\b|consulta|busca|query|\bleitura\b/i.test(t))     return "select";
  if (/\binsert\b|\bupdate\b|\bdelete\b|\bdml\b|modificar dados|alterar dados/i.test(t)) return "dml";
  if (/\bcreate\b|\bdrop\b|\balter\b|\btruncate\b|\bddl\b|estrutura|esquema/i.test(t))   return "ddl";
  if (/\bjoin\b|combinar|agregaç|group by|having/i.test(t))       return "joins";
  if (/configur|instalar|ambiente|servidor|ferramenta|cliente/i.test(t)) return "configuracao";
  if (/fun[cç][aã]|count|sum|avg|max|min|agregaç/i.test(t))      return "funcoes";
  if (/subquery|subconsulta|subselect/i.test(t))                  return "subquery";
  if (/[ií]ndice|index|performance|otimiz/i.test(t))              return "index";
  if (/transaç|commit|rollback|acid/i.test(t))                    return "transacao";
  return "generic";
}

// Ensure a learning objective ends with a period.
function withPeriod(text: string): string {
  const t = text.trim();
  if (!t) return t;
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

// Trim text to max chars at a word boundary.
function trimAt(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(" ", max - 1);
  return cut > max * 0.5 ? text.slice(0, cut) : text.slice(0, max);
}

// Returns a grammatically correct, complete learning objective.
// Pattern enforced: VERB + OBJECT + CONTEXT, ending with period, ≤110 chars.
// Never prepends a verb mechanically — validates or rewrites the whole phrase.
function normalizeLearningObjective(text: string, moduleTitle: string, idx: number): string {
  const t = text.trim();

  // Already a complete, grammatical objective: starts with verb, substantial, not broken
  if (VERB_START_RE.test(t) && t.length >= 20 && !BAD_OBJECTIVE_RE.test(t)) {
    return withPeriod(trimAt(t, 110));
  }

  // Use topic-specific template if available (curated, always grammatical)
  const topic = detectModuleTopic(moduleTitle);
  const templates = TOPIC_COMPETENCIES[topic];
  if (templates) return templates[idx % templates.length]; // already ends with period

  // Last resort: verb + lowercased module title
  const verb = ACTION_VERBS_PT[idx % ACTION_VERBS_PT.length];
  const body = moduleTitle.trim().length > 0
    ? moduleTitle.trim().charAt(0).toLowerCase() + moduleTitle.trim().slice(1)
    : "os conceitos principais do módulo";
  return withPeriod(trimAt(`${verb} ${body}`, 110));
}

function extractCompetencies(content: string, moduleTitle?: string): string[] {
  const modTitle = (moduleTitle ?? "").trim();
  const titleLower = modTitle.toLowerCase();
  const normalised = content.replace(/\\n/g, "\n").replace(/\\t/g, " ");

  const hasEmoji = (s: string): boolean =>
    Array.from(s).some((c) => {
      const cp = c.codePointAt(0) ?? 0;
      return (cp >= 0x1F300 && cp <= 0x1FFFF) ||
             (cp >= 0x2600  && cp <= 0x27BF)  ||
             (cp >= 0xFE00  && cp <= 0xFE0F);
    });

  // Extract bullet points — strip only PAIRED markdown asterisks, NOT standalone *
  const bullets = [...normalised.matchAll(/^[-•]\s+(.+)$/gm)]
    .map((m) => m[1].replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1").trim())
    .filter((b) => b.length >= 12 && b.length <= 90)
    .filter((b) => !hasEmoji(b))
    .filter((b) => b.toLowerCase() !== titleLower)
    .slice(0, 4);

  // Extract sub-headings
  const headings = [...normalised.matchAll(/^#{2,4}\s+(.+)$/gm)]
    .map((m) => m[1].replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1").trim())
    .filter((h) => h.length >= 10 && h.length <= 70)
    .filter((h) => !hasEmoji(h))
    .filter((h) => h.toLowerCase() !== titleLower)
    .slice(0, 4);

  // Extract first short sentences — preserve SQL wildcards, only strip paired markdown
  const sentences = normalised
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")   // only paired **bold** / *italic*
    .replace(/`([^`]+)`/g, "$1")                // strip backticks but keep content
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 80)
    .filter((s) => !hasEmoji(s))
    .filter((s) => s.toLowerCase() !== titleLower)
    .slice(0, 4);

  const pool = bullets.length >= 2 ? bullets : headings.length >= 2 ? headings : sentences;
  const raw  = pool.slice(0, 3);

  // Normalize each item — ensures grammatically correct "VERB + OBJECT + COMPLEMENT"
  // Also expand vague terms before normalization
  const normalized = raw
    .map((text) => expandVagueObjective(text, modTitle))
    .map((text, i) => normalizeLearningObjective(text, modTitle, i));

  // Final validation: if ALL items are still broken (matched BAD pattern), use topic fallback
  const allBad = normalized.every((obj) => BAD_OBJECTIVE_RE.test(obj) || obj.length < 15);
  if (allBad) {
    const topic = detectModuleTopic(modTitle);
    const templates = TOPIC_COMPETENCIES[topic];
    if (templates) return templates.slice(0, 3);
    return ACTION_VERBS_PT.slice(0, 3).map((v, i) =>
      `${v} os conceitos principais de ${modTitle || "este módulo"}.`
    );
  }

  return normalized;
}

async function runPipeline(
  courseTitle: string,
  modules: { title: string; content: string }[],
  design: Design,
  density: string,
  language: string,
  geminiKey: string,
): Promise<PptxGenJS> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "EduGenAI v5";
  pptx.title = courseTitle;

  // ── MODULE SLIDE CACHE (per export run, keyed by content hash + density + lang) ──
  // Prevents re-calling Gemini for identical modules within the same request.
  const slideCache = new Map<string, Slide[]>();

  function moduleHashKey(mod: { title: string; content: string }): string {
    // Fast deterministic key — length + first/last 120 chars + title
    const c = (mod.content || "").trim();
    return `${mod.title}|${density}|${language}|${c.length}|${c.slice(0, 120)}|${c.slice(-120)}`;
  }

  // Process modules in parallel batches (max 3 concurrent Gemini calls).
  // Uses Promise.allSettled so a single module failure never aborts the batch.
  async function processBatch(
    indices: number[],
  ): Promise<{ i: number; slides: Slide[] }[]> {
    const settled = await Promise.allSettled(
      indices.map(async (i) => {
        const mod = modules[i];
        const cacheKey = moduleHashKey(mod);

        // Cache hit
        if (slideCache.has(cacheKey)) {
          console.log(`[V5] Module ${i + 1} cache hit: "${mod.title}"`);
          return { i, slides: slideCache.get(cacheKey)! };
        }

        console.log(`[V5] Generating slides for module ${i + 1}/${modules.length}: "${mod.title}"`);
        const rawSlides = await generateModuleSlides(
          courseTitle, mod, i, density, language, geminiKey,
        );
        const splitSlides   = splitOverflowSlides(rawSlides);
        const variedSlides  = applyLayoutVariety(splitSlides);
        // Semantic alignment: correct title/content mismatches per slide
        const alignedSlides  = variedSlides.map((s) => validateSemanticAlignment(s, mod.title));
        // Quality gate: repair or drop slides that still fail quality criteria
        const polishedSlides = alignedSlides
          .map((s) => semanticQualityGate(s, mod.title))
          .filter((s): s is Slide => s !== null);
        console.log(
          `[V5] Module ${i + 1}: ${rawSlides.length} raw → ${splitSlides.length} split → ${polishedSlides.length} final`,
        );

        slideCache.set(cacheKey, polishedSlides);
        return { i, slides: polishedSlides };
      }),
    );

    // Map results — use per-module fallback on rejection
    return settled.map((result, idx) => {
      const i = indices[idx];
      if (result.status === "fulfilled") return result.value;
      console.error(`[V5] Module ${i + 1} failed, using fallback:`, result.reason?.message ?? result.reason);
      const fallback = fallbackModuleSlides(modules[i].title, modules[i].content, i, density);
      return { i, slides: fallback };
    });
  }

  const BATCH_SIZE = 3; // max concurrent Gemini calls
  const allModuleSlides: Slide[][] = new Array(modules.length);
  for (let b = 0; b < modules.length; b += BATCH_SIZE) {
    const batchIndices = Array.from(
      { length: Math.min(BATCH_SIZE, modules.length - b) },
      (_, k) => b + k,
    );
    const results = await processBatch(batchIndices);
    for (const { i, slides } of results) {
      allModuleSlides[i] = slides;
    }
  }

  // Count actual total slides from generated content (for accurate footer numbers)
  const contentSlideCount = allModuleSlides.reduce(
    (s, m) => s + m.filter(isRenderableSlide).length + 1,
    0,
  ); // +1 per module cover
  const totalSlides = 1 + 1 + contentSlideCount + 1; // cover + toc + modules + closing
  let slideNum = 0;

  // Cover
  renderCover(
    pptx,
    {
      layout: "cover",
      title: courseTitle,
      subtitle: "CURSO COMPLETO",
    },
    design,
    totalSlides,
  );
  slideNum++;

  // TOC
  renderTOC(
    pptx,
    { layout: "toc", title: "Conteúdo" },
    design,
    ++slideNum,
    totalSlides,
    modules,
  );

  // Modules
  for (let i = 0; i < modules.length; i++) {
    const cleanTitle =
      modules[i].title.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() ||
      modules[i].title;

    // Module cover with competencies extracted from content
    renderModuleCover(
      pptx,
      {
        layout: "module_cover",
        title: cleanTitle,
        moduleIndex: i,
        competencies: extractCompetencies(modules[i].content, cleanTitle),
      },
      design,
      ++slideNum,
      totalSlides,
    );

    // Content slides — final safety net: filter un-renderable before hitting any renderer
    for (const s of allModuleSlides[i].filter(isRenderableSlide)) {
      switch (s.layout) {
        case "cards":
          renderCards(pptx, s, design, ++slideNum, totalSlides);
          break;
        case "takeaways":
          renderTakeaways(pptx, s, design, ++slideNum, totalSlides);
          break;
        case "code":
          renderCode(pptx, s, design, ++slideNum, totalSlides);
          break;
        case "twocol":
          renderTwocol(pptx, s, design, ++slideNum, totalSlides);
          break;
        case "comparison":
          renderComparison(pptx, s, design, ++slideNum, totalSlides);
          break;
        case "timeline":
          renderTimeline(pptx, s, design, ++slideNum, totalSlides);
          break;
        case "process":
          renderProcess(pptx, s, design, ++slideNum, totalSlides);
          break;
        case "diagram":
          renderDiagram(pptx, s, design, ++slideNum, totalSlides);
          break;
        default:
          renderBullets(pptx, s, design, ++slideNum, totalSlides);
      }
    }
  }

  // Closing with contextual next steps
  renderClosing(
    pptx,
    {
      layout: "closing",
      title: courseTitle,
      items: [
        `Aplique o conteúdo de ${san(courseTitle)} em um projeto real`,
        "Explore a documentação oficial e recursos avançados",
        "Construa um portfólio com os projetos deste curso",
        "Compartilhe seu progresso com a comunidade",
      ],
    },
    design,
    ++slideNum,
    totalSlides,
  );

  console.log(`[V5] Pipeline complete: ${slideNum} slides`);
  return pptx;
}

// ═══════════════════════════════════════════════════════════
// SECTION 7: HTTP HANDLER
// ═══════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } =
      await userClient.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.user.id;

    const body = await req.json();
    const {
      course_id,
      palette = "default",
      density = "standard",
      theme = "light",
      template = "modern",
      includeImages = false,
      courseType = "CURSO COMPLETO",
      footerBrand = "EduGenAI",
      language = "Português (Brasil)",
    } = body;

    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

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
    if (course.status !== "published") {
      return new Response(
        JSON.stringify({ error: "Course must be published to export." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: modules = [] } = await serviceClient
      .from("course_modules")
      .select("*")
      .eq("course_id", course_id)
      .order("order_index");

    const design = buildDesign(
      theme === "dark" ? "dark" : "light",
      palette,
      template,
      footerBrand || "EduGenAI",
    );

    const courseTitle = (course.title || "Curso").trim();
    const moduleData = (modules as any[]).map((m) => ({
      title: (m.title || "").trim().replace(/\\n/g, " ").replace(/\\t/g, " "),
      content: (m.content || "").trim(),
    }));

    console.log(
      `[V5] ENGINE=${ENGINE_VERSION} | "${courseTitle}" | ${moduleData.length} modules | theme=${theme} | density=${density}`,
    );

    const pptx = await runPipeline(
      courseTitle,
      moduleData,
      design,
      density,
      language,
      geminiKey,
    );

    const rawData = await pptx.write({ outputType: "uint8array" });
    const rawBytes = rawData as Uint8Array;
    console.log(
      `[V5-WRITE] raw_bytes=${rawBytes.byteLength} | magic=${rawBytes[0]}_${rawBytes[1]}_${rawBytes[2]}_${rawBytes[3]}`,
    );
    const repairResult = await repairPptxPackage(rawBytes);
    const pptxData = repairResult.data;
    const repairDiag = repairResult.diag;
    console.log(
      `[V5-WRITE] repaired_bytes=${pptxData.byteLength} slides=${repairDiag.slide_count}`,
    );

    const dateStr = new Date().toISOString().slice(0, 10);
    const ts = Math.floor(Date.now() / 1000);
    const safeName = courseTitle
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s\-]/g, "")
      .replace(/\s+/g, "-")
      .trim()
      .substring(0, 80);
    const fileName = `${userId}/${safeName}-PPTX-v5-${dateStr}-${ts}.pptx`;

    // Upload with retry
    let uploadErr: any = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const { error } = await serviceClient.storage
        .from("course-exports")
        .upload(fileName, pptxData, {
          contentType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          upsert: true,
        });
      if (!error) {
        uploadErr = null;
        break;
      }
      uploadErr = error;
      if (attempt < 4)
        await new Promise((r) =>
          setTimeout(r, Math.min(2000 * 2 ** (attempt - 1), 15000)),
        );
    }
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    try {
      await serviceClient.from("usage_events").insert({
        user_id: userId,
        event_type: "COURSE_EXPORTED_PPTX_V5",
        metadata: { course_id, modules: moduleData.length },
      });
    } catch {
      /* non-critical */
    }

    return new Response(
      JSON.stringify({
        url: signedUrl.signedUrl,
        version: "v5",
        engine_version: ENGINE_VERSION,
        slide_count: (repairDiag.slide_count as number) ?? 0,
        _diag: {
          raw_bytes: rawBytes.byteLength,
          repaired_bytes: pptxData.byteLength,
          ...repairDiag,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error: any) {
    console.error("[V5] Export error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
