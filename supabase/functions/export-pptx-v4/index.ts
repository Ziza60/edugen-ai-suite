import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "npm:pptxgenjs@3.12.0";
import JSZip from "npm:jszip@3.10.1";

const ENGINE_VERSION = "4.2.0";

// ═══════════════════════════════════════════════════════════
// XML SAFETY — must run on ALL text before passing to PptxGenJS
// ═══════════════════════════════════════════════════════════

function stripInvalidXmlChars(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) { out += input[i] + input[i + 1]; i++; continue; }
      continue; // orphan high surrogate → drop
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue; // lone low surrogate
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue; // control chars
    if (code === 0x7f) continue;
    if (code === 0xfffe || code === 0xffff) continue; // non-characters
    out += input[i];
  }
  return out;
}

function san(text: string): string {
  if (!text || typeof text !== "string") return "";
  let out = text
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, c) => {
      const n = Number(c);
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
      try { return String.fromCodePoint(n); } catch { return ""; }
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

type Layout = "cover" | "toc" | "module_cover" | "bullets" | "cards" | "takeaways" | "closing" | "code" | "twocol" | "comparison" | "timeline";

interface Slide {
  layout: Layout;
  title: string;
  label?: string;
  subtitle?: string;
  items?: string[];
  code?: string;
  codeLabel?: string;
  competencies?: string[];
  leftHeader?: string;   // comparison: left column title
  rightHeader?: string;  // comparison: right column title
  leftItems?: string[];  // comparison: left column items
  rightItems?: string[]; // comparison: right column items
  moduleIndex?: number;
}

// ── TYPOGRAPHY CONSTANTS (McKinsey-inspired hierarchy) ──
const T = {
  SLIDE_TITLE:   26,  // header title
  SECTION_LABEL:  9,  // section label (caps, letter-spaced)
  SUBHEADER:     18,  // card/column headers
  BODY:          14,  // body text (1–4 items)
  BODY_SM:       13,  // body text (5 items)
  CODE:          11,  // monospace code
  CAPTION:        9,  // footer / footnote
} as const;

interface Design {
  theme: "light" | "dark";
  accent: string;       // hex no #
  accent2: string;
  accent3: string;
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
const ML = 0.65;   // margin left
const MR = 0.65;   // margin right
const CW = SLIDE_W - ML - MR;  // content width = 12.033
const HEADER_H = 1.45;         // space above content
const FOOTER_Y = 7.16;
const CONTENT_Y = HEADER_H;
const CONTENT_H = FOOTER_Y - CONTENT_Y - 0.1; // 5.61

const PALETTE_MAP: Record<string, string[]> = {
  default:    ["4F46E5", "7C3AED", "0891B2", "059669", "D97706"],
  ocean:      ["0369A1", "0284C7", "0891B2", "0D9488", "1D4ED8"],
  forest:     ["15803D", "16A34A", "0D9488", "047857", "166534"],
  sunset:     ["DC2626", "EA580C", "D97706", "B91C1C", "C2410C"],
  monochrome: ["1E293B", "334155", "475569", "64748B", "94A3B8"],
};

function buildDesign(
  theme: "light" | "dark",
  palette: string,
  template: string,
  footerBrand: string,
): Design {
  const colors = PALETTE_MAP[palette] || PALETTE_MAP.default;

  if (theme === "dark") {
    return {
      theme,
      accent:  colors[0],
      accent2: colors[1],
      accent3: colors[2],
      bg:      "0A0E1A",
      surface: "111827",
      text:    "F1F5F9",
      subtext: "94A3B8",
      border:  "1E293B",
      coverBg: "060A14",
      titleFont: "Calibri",
      bodyFont:  "Calibri",
      footerBrand,
    };
  }
  return {
    theme,
    accent:  colors[0],
    accent2: colors[1],
    accent3: colors[2],
    bg:      "FFFFFF",
    surface: "F8FAFC",
    text:    "0F172A",
    subtext: "475569",
    border:  "E2E8F0",
    coverBg: "0F172A",
    titleFont: "Calibri",
    bodyFont:  "Calibri",
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
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  out = stripInvalidXmlChars(out);
  return out
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim();
}

function bg(slide: any, color: string) {
  slide.addShape("rect" as any, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color } });
}

function footer(slide: any, d: Design, num: number, total: number) {
  // thin line
  slide.addShape("rect" as any, {
    x: ML, y: FOOTER_Y, w: CW, h: 0.01,
    fill: { color: d.border },
  });
  // brand
  if (d.footerBrand) {
    slide.addText(san(d.footerBrand), {
      x: ML, y: FOOTER_Y + 0.05, w: CW * 0.5, h: 0.22,
      fontSize: 9, fontFace: d.bodyFont,
      color: d.subtext, bold: true, charSpacing: 2,
    });
  }
  // page number
  slide.addText(`${num} / ${total}`, {
    x: ML + CW * 0.5, y: FOOTER_Y + 0.05, w: CW * 0.5, h: 0.22,
    fontSize: 9, fontFace: d.bodyFont,
    color: d.subtext, align: "right",
  });
}

// Standard slide header: label + accent line + title
function header(slide: any, d: Design, label: string, title: string) {
  slide.addShape("rect" as any, {
    x: 0, y: 0, w: SLIDE_W, h: 0.06,
    fill: { color: d.accent },
  });
  if (label) {
    slide.addText(san(label).toUpperCase(), {
      x: ML, y: 0.18, w: CW, h: 0.22,
      fontSize: T.SECTION_LABEL, fontFace: d.bodyFont, bold: true,
      color: d.accent, charSpacing: 4,
    });
  }
  const titleY = label ? 0.44 : 0.22;
  const titleH = label ? 0.82 : 1.0;
  slide.addText(san(title), {
    x: ML, y: titleY, w: CW, h: titleH,
    fontSize: T.SLIDE_TITLE, fontFace: d.titleFont, bold: true,
    color: d.text, valign: "middle",
    fit: "shrink" as any,
  });
  slide.addShape("rect" as any, {
    x: ML, y: CONTENT_Y - 0.06, w: CW, h: 0.025,
    fill: { color: d.border },
  });
}

// ═══════════════════════════════════════════════════════════
// SECTION 4: SLIDE RENDERERS
// ═══════════════════════════════════════════════════════════

// ── COVER ──
function renderCover(pptx: PptxGenJS, slide_: Slide, d: Design, totalSlides: number) {
  const slide = pptx.addSlide();
  bg(slide, d.coverBg);

  // Left accent bar gradient
  slide.addShape("rect" as any, {
    x: 0, y: 0, w: 0.12, h: SLIDE_H,
    fill: { color: d.accent },
  });
  slide.addShape("rect" as any, {
    x: 0.12, y: 0, w: 0.06, h: SLIDE_H,
    fill: { color: d.accent2, transparency: 60 },
  });

  // Course type badge
  if (slide_.subtitle) {
    slide.addShape("roundRect" as any, {
      x: 1.0, y: 1.1, w: Math.min(4.0, slide_.subtitle.length * 0.18 + 0.5), h: 0.34,
      fill: { color: d.accent },
      rectRadius: 0.04,
    });
    slide.addText(san(slide_.subtitle).toUpperCase(), {
      x: 1.0, y: 1.1, w: 4.5, h: 0.34,
      fontSize: 10, fontFace: d.bodyFont, bold: true,
      color: "FFFFFF", charSpacing: 3, valign: "middle",
    });
  }

  // Title
  slide.addText(san(slide_.title), {
    x: 1.0, y: 1.65, w: SLIDE_W - 1.6, h: 2.4,
    fontSize: 44, fontFace: d.titleFont, bold: true,
    color: "FFFFFF", valign: "middle",
    fit: "shrink" as any,
    lineSpacingMultiple: 1.15,
  });

  // Divider line
  slide.addShape("rect" as any, {
    x: 1.0, y: 4.25, w: 3.0, h: 0.04,
    fill: { color: d.accent },
  });

  // Subtitle / tagline
  slide.addText("Curso completo com material profissional", {
    x: 1.0, y: 4.42, w: SLIDE_W - 2.0, h: 0.4,
    fontSize: 14, fontFace: d.bodyFont,
    color: "94A3B8", valign: "middle",
  });

  // Bottom right decoration circles
  for (let i = 0; i < 4; i++) {
    const sz = 0.8 + i * 0.5;
    slide.addShape("ellipse" as any, {
      x: SLIDE_W - sz - 0.3,
      y: SLIDE_H - sz - 0.2,
      w: sz, h: sz,
      fill: { color: d.accent, transparency: 82 + i * 4 },
    });
  }
}

// ── TABLE OF CONTENTS ──
function renderTOC(pptx: PptxGenJS, slide_: Slide, d: Design, num: number, total: number, modules: {title:string}[]) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);

  slide.addShape("rect" as any, { x: 0, y: 0, w: SLIDE_W, h: 0.06, fill: { color: d.accent } });

  // Left panel
  const panelW = 2.9;
  slide.addShape("rect" as any, {
    x: 0, y: 0.06, w: panelW, h: SLIDE_H - 0.06,
    fill: { color: d.surface },
  });
  slide.addText("ÍNDICE", {
    x: ML, y: 0.3, w: panelW - ML, h: 0.28,
    fontSize: 10, fontFace: d.bodyFont, bold: true,
    color: d.accent, charSpacing: 5,
  });
  slide.addText("Conteúdo\ndo Curso", {
    x: ML, y: 0.64, w: panelW - ML, h: 1.0,
    fontSize: 24, fontFace: d.titleFont, bold: true,
    color: d.text, valign: "top",
    lineSpacingMultiple: 1.1,
    fit: "shrink" as any,
  });
  // Module count chip
  slide.addShape("roundRect" as any, {
    x: ML, y: FOOTER_Y - 0.54, w: 1.7, h: 0.36,
    fill: { color: d.accent }, rectRadius: 0.04,
  });
  slide.addText(`${modules.length} Módulo${modules.length !== 1 ? "s" : ""}`, {
    x: ML, y: FOOTER_Y - 0.54, w: 1.7, h: 0.36,
    fontSize: 12, fontFace: d.bodyFont, bold: true,
    color: "FFFFFF", align: "center", valign: "middle",
  });

  // Module list — 2 columns when > 5 modules
  const listX = panelW + 0.35;
  const totalListW = SLIDE_W - listX - MR;
  const maxMods = Math.min(modules.length, 10);
  const useTwoCols = maxMods > 5;
  const cols = useTwoCols ? 2 : 1;
  const colW = useTwoCols ? (totalListW - 0.3) / 2 : totalListW;
  const itemsPerCol = useTwoCols ? Math.ceil(maxMods / cols) : maxMods;
  const itemH = Math.min(0.68, (FOOTER_Y - 0.2 - 0.15) / itemsPerCol);
  const startY = 0.22;

  for (let i = 0; i < maxMods; i++) {
    const col = useTwoCols ? Math.floor(i / itemsPerCol) : 0;
    const rowInCol = useTwoCols ? i % itemsPerCol : i;
    const x = listX + col * (colW + 0.3);
    const y = startY + rowInCol * itemH;
    const pal = [d.accent, d.accent2, d.accent3][i % 3];

    slide.addShape("ellipse" as any, {
      x, y: y + (itemH - 0.36) / 2, w: 0.36, h: 0.36,
      fill: { color: pal },
    });
    slide.addText(String(i + 1), {
      x, y: y + (itemH - 0.36) / 2, w: 0.36, h: 0.36,
      fontSize: 12, fontFace: d.titleFont, bold: true,
      color: "FFFFFF", align: "center", valign: "middle",
    });
    slide.addText(san(modules[i].title), {
      x: x + 0.46, y: y + (itemH - 0.28) / 2, w: colW - 0.5, h: 0.28,
      fontSize: useTwoCols ? 12 : 14, fontFace: d.bodyFont,
      color: d.text, valign: "middle",
      fit: "shrink" as any,
    });
    if (!useTwoCols && i < maxMods - 1) {
      slide.addShape("rect" as any, {
        x, y: y + itemH - 0.01, w: colW, h: 0.01,
        fill: { color: d.border },
      });
    }
  }

  footer(slide, d, num, total);
}

// ── MODULE COVER ──
function renderModuleCover(pptx: PptxGenJS, slide_: Slide, d: Design, num: number, total: number) {
  const slide = pptx.addSlide();
  bg(slide, d.coverBg);

  const sideW = 0.55;
  slide.addShape("rect" as any, { x: 0, y: 0, w: sideW, h: SLIDE_H, fill: { color: d.accent } });

  // Large watermark number
  const modNum = String((slide_.moduleIndex ?? 0) + 1).padStart(2, "0");
  slide.addText(modNum, {
    x: sideW + 0.3, y: 0.3, w: 3.2, h: 3.0,
    fontSize: 160, fontFace: d.titleFont, bold: true,
    color: "D1D5DB", valign: "top",
  });

  // Label
  slide.addText("MÓDULO " + ((slide_.moduleIndex ?? 0) + 1), {
    x: sideW + 0.5, y: 1.4, w: CW, h: 0.3,
    fontSize: 10, fontFace: d.bodyFont, bold: true,
    color: d.accent, charSpacing: 5,
  });

  // Title — shorter box to leave room for competencies
  slide.addText(san(slide_.title), {
    x: sideW + 0.5, y: 1.82, w: SLIDE_W - sideW - 1.2, h: 1.7,
    fontSize: 34, fontFace: d.titleFont, bold: true,
    color: "FFFFFF", valign: "top",
    fit: "shrink" as any,
    lineSpacingMultiple: 1.2,
  });

  // Competencies section
  const competencies = (slide_.competencies || []).slice(0, 3);
  if (competencies.length > 0) {
    slide.addShape("rect" as any, {
      x: sideW + 0.5, y: 3.68, w: 2.2, h: 0.03,
      fill: { color: d.accent },
    });
    slide.addText("O QUE VOCÊ VAI APRENDER", {
      x: sideW + 0.5, y: 3.78, w: SLIDE_W - sideW - 1.3, h: 0.22,
      fontSize: 8, fontFace: d.bodyFont, bold: true,
      color: d.accent, charSpacing: 4,
    });
    for (let i = 0; i < competencies.length; i++) {
      const cy = 4.1 + i * 0.44;
      slide.addShape("ellipse" as any, {
        x: sideW + 0.5, y: cy + 0.07, w: 0.13, h: 0.13,
        fill: { color: d.accent },
      });
      slide.addText(san(competencies[i]), {
        x: sideW + 0.73, y: cy, w: SLIDE_W - sideW - 1.4, h: 0.32,
        fontSize: 12, fontFace: d.bodyFont,
        color: "CBD5E1", valign: "middle",
        fit: "shrink" as any,
      });
    }
  }

  footer(slide, d, num, total);
}

// ── BULLETS ──
function renderBullets(pptx: PptxGenJS, slide_: Slide, d: Design, num: number, total: number) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);
  header(slide, d, slide_.label || "", slide_.title);

  const items = (slide_.items || []).slice(0, 5);
  if (items.length === 0) { footer(slide, d, num, total); return; }

  const gap = 0.1;
  const totalGap = gap * (items.length - 1);
  const itemH = Math.max(0.55, (CONTENT_H - totalGap) / items.length);
  const fontSize = items.length <= 3 ? 18 : items.length <= 4 ? 16 : 14;

  for (let i = 0; i < items.length; i++) {
    const y = CONTENT_Y + i * (itemH + gap);
    const pal = [d.accent, d.accent2, d.accent3][i % 3];

    // Card background
    slide.addShape("roundRect" as any, {
      x: ML, y, w: CW, h: itemH,
      fill: { color: d.surface },
      line: { color: d.border, width: 0.4 },
      rectRadius: 0.06,
    });

    // Left color strip
    slide.addShape("roundRect" as any, {
      x: ML, y, w: 0.055, h: itemH,
      fill: { color: pal },
      rectRadius: 0.06,
    });

    // Bullet dot
    const dotSz = 0.1;
    slide.addShape("ellipse" as any, {
      x: ML + 0.18, y: y + itemH / 2 - dotSz / 2,
      w: dotSz, h: dotSz,
      fill: { color: pal },
    });

    // Text
    slide.addText(san(items[i]), {
      x: ML + 0.36, y: y + 0.05, w: CW - 0.46, h: itemH - 0.1,
      fontSize, fontFace: d.bodyFont,
      color: d.text, valign: "middle",
      lineSpacingMultiple: 1.2,
      fit: "shrink" as any,
    });
  }

  footer(slide, d, num, total);
}

// ── CARDS ──
function renderCards(pptx: PptxGenJS, slide_: Slide, d: Design, num: number, total: number) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);
  header(slide, d, slide_.label || "", slide_.title);

  const items = (slide_.items || []).slice(0, 4);
  if (items.length === 0) { footer(slide, d, num, total); return; }

  const cols = items.length <= 2 ? items.length : 2;
  const rows = Math.ceil(items.length / cols);
  const gap = 0.2;
  const cardW = (CW - gap * (cols - 1)) / cols;
  const cardH = (CONTENT_H - gap * (rows - 1)) / rows;

  for (let i = 0; i < items.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = ML + col * (cardW + gap);
    const y = CONTENT_Y + row * (cardH + gap);
    const pal = [d.accent, d.accent2, d.accent3][i % 3];

    // Shadow
    slide.addShape("roundRect" as any, {
      x: x + 0.03, y: y + 0.04, w: cardW, h: cardH,
      fill: { color: "000000", transparency: 88 },
      rectRadius: 0.1,
    });

    // Card
    slide.addShape("roundRect" as any, {
      x, y, w: cardW, h: cardH,
      fill: { color: d.surface },
      line: { color: d.border, width: 0.4 },
      rectRadius: 0.1,
    });

    // Top accent bar
    slide.addShape("roundRect" as any, {
      x, y, w: cardW, h: 0.1,
      fill: { color: pal },
      rectRadius: 0.1,
    });
    slide.addShape("rect" as any, {
      x, y: y + 0.04, w: cardW, h: 0.06,
      fill: { color: pal },
    });

    // Number badge
    const badgeSz = 0.42;
    slide.addShape("ellipse" as any, {
      x: x + cardW / 2 - badgeSz / 2, y: y + 0.18,
      w: badgeSz, h: badgeSz,
      fill: { color: pal },
    });
    slide.addText(String(i + 1), {
      x: x + cardW / 2 - badgeSz / 2, y: y + 0.18,
      w: badgeSz, h: badgeSz,
      fontSize: 16, fontFace: d.titleFont, bold: true,
      color: "FFFFFF", align: "center", valign: "middle",
    });

    // Text
    const textY = y + 0.18 + badgeSz + 0.14;
    slide.addText(san(items[i]), {
      x: x + 0.14, y: textY, w: cardW - 0.28, h: y + cardH - textY - 0.14,
      fontSize: items.length <= 2 ? 16 : 13,
      fontFace: d.bodyFont,
      color: d.text, align: "center", valign: "top",
      lineSpacingMultiple: 1.2,
      fit: "shrink" as any,
    });
  }

  footer(slide, d, num, total);
}

// ── TAKEAWAYS ──
function renderTakeaways(pptx: PptxGenJS, slide_: Slide, d: Design, num: number, total: number) {
  const slide = pptx.addSlide();
  bg(slide, d.coverBg);

  // Accent top stripe
  slide.addShape("rect" as any, { x: 0, y: 0, w: SLIDE_W, h: 0.07, fill: { color: d.accent } });

  // Label
  slide.addText(san(slide_.label || "PRINCIPAIS APRENDIZADOS").toUpperCase(), {
    x: ML, y: 0.22, w: CW, h: 0.26,
    fontSize: 9, fontFace: d.bodyFont, bold: true,
    color: d.accent, charSpacing: 5,
  });

  // Title
  slide.addText(san(slide_.title), {
    x: ML, y: 0.55, w: CW, h: 0.72,
    fontSize: 26, fontFace: d.titleFont, bold: true,
    color: "FFFFFF", valign: "middle",
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
      x: ML, y, w: CW, h: itemH,
      fill: { color: "FFFFFF", transparency: 91 },
      rectRadius: 0.07,
    });

    // Number
    const numSz = Math.min(0.5, itemH * 0.7);
    slide.addShape("ellipse" as any, {
      x: ML + 0.14, y: y + itemH / 2 - numSz / 2,
      w: numSz, h: numSz,
      fill: { color: pal },
    });
    slide.addText(String(i + 1), {
      x: ML + 0.14, y: y + itemH / 2 - numSz / 2,
      w: numSz, h: numSz,
      fontSize: 15, fontFace: d.titleFont, bold: true,
      color: "FFFFFF", align: "center", valign: "middle",
    });

    // Text
    const fontSize = items.length <= 3 ? 16 : 14;
    slide.addText(san(items[i]), {
      x: ML + numSz + 0.28, y: y + 0.05, w: CW - numSz - 0.38, h: itemH - 0.1,
      fontSize, fontFace: d.bodyFont,
      color: "F1F5F9", valign: "middle",
      lineSpacingMultiple: 1.2,
      fit: "shrink" as any,
    });
  }

  footer(slide, d, num, total);
}

// ── CLOSING ──
function renderClosing(pptx: PptxGenJS, slide_: Slide, d: Design, num: number, total: number) {
  const slide = pptx.addSlide();
  bg(slide, d.coverBg);

  // Decoration circles (top-right)
  for (let i = 0; i < 5; i++) {
    const sz = 1.2 + i * 0.9;
    slide.addShape("ellipse" as any, {
      x: SLIDE_W - sz * 0.7, y: -sz * 0.3,
      w: sz, h: sz,
      fill: { color: d.accent, transparency: 85 + i * 2 },
    });
  }
  slide.addShape("rect" as any, { x: 0, y: 0, w: 0.1, h: SLIDE_H, fill: { color: d.accent } });

  // Left column: congrats
  const midX = SLIDE_W * 0.48;
  slide.addText("🎓", {
    x: ML + 0.1, y: 0.9, w: 1.2, h: 1.2,
    fontSize: 52, align: "center", valign: "middle",
  });
  slide.addText("Parabéns!", {
    x: ML + 1.4, y: 1.0, w: midX - ML - 1.6, h: 0.6,
    fontSize: 34, fontFace: d.titleFont, bold: true,
    color: d.accent,
  });
  slide.addText(`Você concluiu:\n${san(slide_.title)}`, {
    x: ML + 1.4, y: 1.72, w: midX - ML - 1.7, h: 1.2,
    fontSize: 19, fontFace: d.titleFont, bold: true,
    color: "FFFFFF", valign: "top",
    lineSpacingMultiple: 1.2,
    fit: "shrink" as any,
  });
  slide.addShape("rect" as any, {
    x: ML + 1.4, y: 3.1, w: 2.4, h: 0.04,
    fill: { color: d.accent },
  });
  slide.addText("Continue praticando e construindo\nprojetos reais com o que aprendeu!", {
    x: ML + 0.1, y: 3.32, w: midX - ML - 0.2, h: 0.9,
    fontSize: 12, fontFace: d.bodyFont,
    color: "94A3B8", valign: "top",
    lineSpacingMultiple: 1.3,
    fit: "shrink" as any,
  });

  // Right column: próximos passos checklist panel
  const rightX = midX + 0.3;
  const rightW = SLIDE_W - rightX - MR;
  const panelY = 0.55;
  const panelH = FOOTER_Y - panelY - 0.05;

  slide.addShape("roundRect" as any, {
    x: rightX, y: panelY, w: rightW, h: panelH,
    fill: { color: "FFFFFF", transparency: 6 },
    line: { color: d.accent, width: 0.5 },
    rectRadius: 0.12,
  });
  // Panel header
  slide.addShape("roundRect" as any, {
    x: rightX, y: panelY, w: rightW, h: 0.5,
    fill: { color: d.accent }, rectRadius: 0.12,
  });
  slide.addShape("rect" as any, {
    x: rightX, y: panelY + 0.25, w: rightW, h: 0.25,
    fill: { color: d.accent },
  });
  slide.addText("PRÓXIMOS PASSOS", {
    x: rightX + 0.2, y: panelY + 0.02, w: rightW - 0.4, h: 0.46,
    fontSize: 11, fontFace: d.bodyFont, bold: true,
    color: "FFFFFF", charSpacing: 3, valign: "middle",
  });

  const nexts = slide_.items && slide_.items.length > 0 ? slide_.items : [
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
      x: rightX + 0.2, y: y + (checkItemH - 0.3) / 2, w: 0.3, h: 0.3,
      fill: { color: d.accent, transparency: 80 },
      line: { color: d.accent, width: 0.5 },
      rectRadius: 0.04,
    });
    slide.addText("✓", {
      x: rightX + 0.2, y: y + (checkItemH - 0.3) / 2, w: 0.3, h: 0.3,
      fontSize: 11, color: d.accent, align: "center", valign: "middle",
      fontFace: d.bodyFont, bold: true,
    });
    slide.addText(san(nexts[i]), {
      x: rightX + 0.62, y, w: rightW - 0.77, h: checkItemH,
      fontSize: 12, fontFace: d.bodyFont,
      color: "E2E8F0", valign: "middle",
      lineSpacingMultiple: 1.2,
      fit: "shrink" as any,
    });
  }

  footer(slide, d, num, total);
}

// ── CODE ──
function renderCode(pptx: PptxGenJS, slide_: Slide, d: Design, num: number, total: number) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);
  header(slide, d, slide_.label || "CÓDIGO", slide_.title);

  const items = (slide_.items || []).slice(0, 3);
  // Hard cap: truncate to CODE_MAX_LINES regardless of AI output
  const rawCode = slide_.code || "";
  const codeLines = rawCode.split("\n");
  const codeText = codeLines.length > CODE_MAX_LINES
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
    const itemH = Math.max(0.5, (areaH - gap * (items.length - 1)) / items.length);
    for (let i = 0; i < items.length; i++) {
      const y = areaY + i * (itemH + gap);
      const pal = [d.accent, d.accent2, d.accent3][i % 3];
      slide.addShape("roundRect" as any, {
        x: ML, y, w: leftW, h: itemH,
        fill: { color: d.surface },
        line: { color: d.border, width: 0.4 },
        rectRadius: 0.06,
      });
      slide.addShape("roundRect" as any, {
        x: ML, y, w: 0.055, h: itemH,
        fill: { color: pal }, rectRadius: 0.06,
      });
      const dotSz = 0.1;
      slide.addShape("ellipse" as any, {
        x: ML + 0.18, y: y + itemH / 2 - dotSz / 2,
        w: dotSz, h: dotSz,
        fill: { color: pal },
      });
      slide.addText(san(items[i]), {
        x: ML + 0.36, y: y + 0.05, w: leftW - 0.46, h: itemH - 0.1,
        fontSize: 13, fontFace: d.bodyFont,
        color: d.text, valign: "middle",
        lineSpacingMultiple: 1.2,
        fit: "shrink" as any,
      });
    }
  }

  // Right: code terminal
  const termBg = "1E293B";
  const barH = 0.32;
  slide.addShape("roundRect" as any, {
    x: rightX, y: areaY, w: rightW, h: areaH,
    fill: { color: termBg }, rectRadius: 0.1,
  });
  // Title bar
  slide.addShape("roundRect" as any, {
    x: rightX, y: areaY, w: rightW, h: barH,
    fill: { color: "334155" }, rectRadius: 0.1,
  });
  slide.addShape("rect" as any, {
    x: rightX, y: areaY + barH / 2, w: rightW, h: barH / 2,
    fill: { color: "334155" },
  });
  // Traffic light dots
  const dotColors = ["FF5F57", "FEBC2E", "28C840"];
  for (let i = 0; i < 3; i++) {
    slide.addShape("ellipse" as any, {
      x: rightX + 0.15 + i * 0.22, y: areaY + 0.1,
      w: 0.12, h: 0.12,
      fill: { color: dotColors[i] },
    });
  }
  // Language label
  const lang = slide_.codeLabel || "Python";
  slide.addText(lang, {
    x: rightX, y: areaY + 0.06, w: rightW - 0.12, h: 0.2,
    fontSize: 9, fontFace: d.bodyFont, bold: true,
    color: "94A3B8", align: "right",
  });
  // Code text
  if (codeText) {
    slide.addText(sanCode(codeText), {
      x: rightX + 0.18, y: areaY + barH + 0.12,
      w: rightW - 0.36, h: areaH - barH - 0.22,
      fontSize: 11, fontFace: "Courier New",
      color: "E2E8F0", valign: "top",
      lineSpacingMultiple: 1.45,
      fit: "shrink" as any,
    });
  }

  footer(slide, d, num, total);
}

// ── TWOCOL ──
function renderTwocol(pptx: PptxGenJS, slide_: Slide, d: Design, num: number, total: number) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);
  header(slide, d, slide_.label || "", slide_.title);

  const items = (slide_.items || []).slice(0, 8);
  if (items.length === 0) { footer(slide, d, num, total); return; }

  const half = Math.ceil(items.length / 2);
  const leftItems = items.slice(0, half);
  const rightItems = items.slice(half);
  const colW = (CW - 0.22) / 2;

  const renderCol = (colItems: string[], colX: number) => {
    const gap = 0.1;
    const itemH = Math.max(0.48, (CONTENT_H - gap * (colItems.length - 1)) / colItems.length);
    const fontSize = colItems.length <= 3 ? 15 : 13;
    for (let i = 0; i < colItems.length; i++) {
      const y = CONTENT_Y + i * (itemH + gap);
      const pal = [d.accent, d.accent2, d.accent3][i % 3];
      slide.addShape("roundRect" as any, {
        x: colX, y, w: colW, h: itemH,
        fill: { color: d.surface },
        line: { color: d.border, width: 0.4 },
        rectRadius: 0.06,
      });
      slide.addShape("roundRect" as any, {
        x: colX, y, w: 0.055, h: itemH,
        fill: { color: pal }, rectRadius: 0.06,
      });
      const dotSz = 0.1;
      slide.addShape("ellipse" as any, {
        x: colX + 0.18, y: y + itemH / 2 - dotSz / 2,
        w: dotSz, h: dotSz,
        fill: { color: pal },
      });
      slide.addText(san(colItems[i]), {
        x: colX + 0.36, y: y + 0.05, w: colW - 0.46, h: itemH - 0.1,
        fontSize, fontFace: d.bodyFont,
        color: d.text, valign: "middle",
        lineSpacingMultiple: 1.2,
        fit: "shrink" as any,
      });
    }
  };

  renderCol(leftItems, ML);
  renderCol(rightItems, ML + colW + 0.22);
  footer(slide, d, num, total);
}

// ── COMPARISON ── McKinsey-style two-column comparison
function renderComparison(pptx: PptxGenJS, slide_: Slide, d: Design, num: number, total: number) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);
  header(slide, d, slide_.label || "COMPARAÇÃO", slide_.title);

  const lItems = (slide_.leftItems || []).slice(0, 5);
  const rItems = (slide_.rightItems || []).slice(0, 5);
  const lHeader = slide_.leftHeader || "A";
  const rHeader = slide_.rightHeader || "B";

  const colW  = (CW - 0.3) / 2;
  const areaY = CONTENT_Y + 0.1;
  const areaH = FOOTER_Y - areaY - 0.1;
  const hdrH  = 0.46;
  const maxRows = Math.max(lItems.length, rItems.length, 1);
  const rowH  = Math.min(0.78, (areaH - hdrH - 0.16) / maxRows);

  const renderCol = (items: string[], x: number, pal: string, colLabel: string) => {
    // Column header pill
    slide.addShape("roundRect" as any, {
      x, y: areaY, w: colW, h: hdrH,
      fill: { color: pal }, rectRadius: 0.08,
    });
    slide.addText(san(colLabel).toUpperCase(), {
      x: x + 0.12, y: areaY, w: colW - 0.24, h: hdrH,
      fontSize: T.SUBHEADER - 4, fontFace: d.titleFont, bold: true,
      color: "FFFFFF", align: "center", valign: "middle",
    });
    // Row items
    for (let i = 0; i < items.length; i++) {
      const y = areaY + hdrH + 0.08 + i * (rowH + 0.06);
      slide.addShape("rect" as any, {
        x, y, w: colW, h: rowH,
        fill: { color: i % 2 === 0 ? d.surface : d.bg },
        line: { color: d.border, width: 0.3 },
      });
      // Left accent stripe
      slide.addShape("rect" as any, { x, y, w: 0.04, h: rowH, fill: { color: pal } });
      slide.addText(san(items[i]), {
        x: x + 0.14, y: y + 0.04, w: colW - 0.22, h: rowH - 0.08,
        fontSize: maxRows <= 3 ? T.BODY : T.BODY_SM, fontFace: d.bodyFont,
        color: d.text, valign: "middle", lineSpacingMultiple: 1.15,
        fit: "shrink" as any,
      });
    }
  };

  renderCol(lItems, ML, d.accent, lHeader);
  renderCol(rItems, ML + colW + 0.3, d.accent2, rHeader);

  // Vertical divider between columns
  slide.addShape("rect" as any, {
    x: ML + colW + 0.14, y: areaY + 0.06, w: 0.02, h: areaH - 0.12,
    fill: { color: d.border },
  });

  footer(slide, d, num, total);
}

// ── TIMELINE ── Vertical McKinsey-style process steps
function renderTimeline(pptx: PptxGenJS, slide_: Slide, d: Design, num: number, total: number) {
  const slide = pptx.addSlide();
  bg(slide, d.bg);
  header(slide, d, slide_.label || "PROCESSO", slide_.title);

  const items = (slide_.items || []).slice(0, 5);
  if (items.length === 0) { footer(slide, d, num, total); return; }

  const n       = items.length;
  const lineX   = ML + 0.3;
  const lineW   = 0.03;
  const dotSz   = 0.4;
  const stepH   = (FOOTER_Y - CONTENT_Y - 0.24) / n;
  const boxH    = Math.min(0.88, stepH - 0.1);
  const textX   = lineX + lineW + 0.32;
  const textW   = SLIDE_W - textX - MR;

  // Vertical spine line
  slide.addShape("rect" as any, {
    x: lineX, y: CONTENT_Y + 0.12, w: lineW, h: FOOTER_Y - CONTENT_Y - 0.24,
    fill: { color: d.accent, transparency: 55 },
  });

  for (let i = 0; i < n; i++) {
    const pal   = [d.accent, d.accent2, d.accent3][i % 3];
    const centerY = CONTENT_Y + 0.12 + i * stepH + stepH / 2;

    // Dot on spine
    slide.addShape("ellipse" as any, {
      x: lineX + lineW / 2 - dotSz / 2, y: centerY - dotSz / 2,
      w: dotSz, h: dotSz,
      fill: { color: pal },
    });
    slide.addText(String(i + 1), {
      x: lineX + lineW / 2 - dotSz / 2, y: centerY - dotSz / 2,
      w: dotSz, h: dotSz,
      fontSize: 13, fontFace: d.titleFont, bold: true,
      color: "FFFFFF", align: "center", valign: "middle",
    });

    // Connector tick
    slide.addShape("rect" as any, {
      x: lineX + lineW, y: centerY - 0.01, w: 0.28, h: 0.02,
      fill: { color: pal, transparency: 30 },
    });

    // Text card
    slide.addShape("roundRect" as any, {
      x: textX, y: centerY - boxH / 2, w: textW, h: boxH,
      fill: { color: d.surface },
      line: { color: d.border, width: 0.3 },
      rectRadius: 0.06,
    });
    // Left accent stripe
    slide.addShape("roundRect" as any, {
      x: textX, y: centerY - boxH / 2, w: 0.055, h: boxH,
      fill: { color: pal }, rectRadius: 0.06,
    });
    slide.addText(san(items[i]), {
      x: textX + 0.14, y: centerY - boxH / 2 + 0.04, w: textW - 0.22, h: boxH - 0.08,
      fontSize: n <= 3 ? T.BODY : T.BODY_SM, fontFace: d.bodyFont,
      color: d.text, valign: "middle", lineSpacingMultiple: 1.2,
      fit: "shrink" as any,
    });
  }

  footer(slide, d, num, total);
}

// ═══════════════════════════════════════════════════════════
// SECTION 5: AI GENERATION
// ═══════════════════════════════════════════════════════════

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

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

function buildPrompt(
  courseTitle: string,
  moduleTitle: string,
  moduleContent: string,
  moduleIndex: number,
  density: string,
  language: string,
): string {
  const nSlides = density === "compact" ? 4 : density === "detailed" ? 7 : 5;
  const maxItems = density === "compact" ? 4 : density === "detailed" ? 6 : 5;
  const maxItemChars = 80;
  const maxCodeLines = 10;

  // Extract key content snippets to guide AI
  const contentSnippet = moduleContent
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/[`_]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 3000);

  return `You are an expert course slide designer. Generate exactly ${nSlides} slides for MODULE ${moduleIndex + 1} of a course.

COURSE: "${courseTitle}"
MODULE ${moduleIndex + 1}: "${moduleTitle}"

MODULE CONTENT (use this as the source of truth):
---
${contentSnippet}
---

RULES:
1. Language: ${language}. ALL text in ${language}.
2. Slides must cover the actual content above — no generic filler
3. Each slide title: max 60 chars, specific to the topic
4. Items: SPECIFIC facts, max 10 words each, max ${maxItemChars} chars. 1 idea per item. Keep items SHORT.
5. Max ${maxItems} items per slide
6. No numbering in items — just the text
7. No repeating module title in slide titles

LAYOUT RULES:
- "bullets": explanations, concepts, facts (default)
- "cards": exactly 2-4 key concepts to highlight side by side
- "twocol": 6-8 short facts that fit neatly in two columns
- "code": ANY slide about syntax, functions, methods, loops, conditionals, classes, operators — ALWAYS use "code" for programming constructs. STRICT LIMITS: max ${maxCodeLines} lines of code (use \\n), max 3 items. Show only the most essential snippet.
- "comparison": side-by-side contrast of TWO concepts (e.g. before/after, pros/cons, A vs B). Requires "leftHeader", "rightHeader", "leftItems" (max 5), "rightItems" (max 5).
- "timeline": ordered steps, stages, or process flow with 3-5 items. Each item is one step.
- "takeaways": ONLY the LAST slide of the module

Return a JSON array of ${nSlides} objects. Schema by layout:
[
  {
    "layout": "bullets"|"cards"|"twocol"|"takeaways"|"timeline",
    "label": "SECTION LABEL IN CAPS (max 25 chars)",
    "title": "Specific slide title",
    "items": ["short idea max 10 words", ...]
  },
  {
    "layout": "code",
    "label": "LABEL",
    "title": "Title",
    "items": ["context bullet", ...],
    "code": "real code with \\n newlines (max ${maxCodeLines} lines)",
    "codeLabel": "Python"
  },
  {
    "layout": "comparison",
    "label": "LABEL",
    "title": "Title",
    "leftHeader": "Concept A",
    "rightHeader": "Concept B",
    "leftItems": ["item", ...],
    "rightItems": ["item", ...]
  }
]

Return ONLY the JSON array, no markdown, no explanation.`;
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
    const prompt = buildPrompt(courseTitle, mod.title, mod.content || "", moduleIndex, density, language);
    const raw = await callGemini(prompt, geminiKey);

    let parsed: any[];
    try {
      // Remove possible markdown code fences
      const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      parsed = JSON.parse(clean);
      if (!Array.isArray(parsed)) throw new Error("Not array");
    } catch {
      console.warn(`[V4] Module ${moduleIndex + 1}: JSON parse failed, using fallback`);
      return fallbackModuleSlides(mod.title, mod.content, moduleIndex, density);
    }

    const VALID_LAYOUTS: Layout[] = ["bullets","cards","takeaways","code","twocol","comparison","timeline"];
    return parsed.map((s: any) => ({
      layout: (VALID_LAYOUTS.includes(s.layout) ? s.layout : "bullets") as Layout,
      title: String(s.title || mod.title).slice(0, 80),
      label: String(s.label || "CONTEÚDO").slice(0, 25).toUpperCase(),
      items: Array.isArray(s.items)
        ? s.items.slice(0, 6).map((x: any) => String(x).slice(0, 90))
        : [],
      code: s.code ? String(s.code).slice(0, 1000) : undefined,
      codeLabel: s.codeLabel ? String(s.codeLabel).slice(0, 20) : "Python",
      leftHeader:  s.leftHeader  ? String(s.leftHeader).slice(0, 40)  : undefined,
      rightHeader: s.rightHeader ? String(s.rightHeader).slice(0, 40) : undefined,
      leftItems:  Array.isArray(s.leftItems)  ? s.leftItems.slice(0, 5).map((x: any) => String(x).slice(0, 90))  : undefined,
      rightItems: Array.isArray(s.rightItems) ? s.rightItems.slice(0, 5).map((x: any) => String(x).slice(0, 90)) : undefined,
      moduleIndex,
    }));
  } catch (e: any) {
    console.error(`[V4] Module ${moduleIndex + 1} AI error: ${e.message}`);
    return fallbackModuleSlides(mod.title, mod.content, moduleIndex, density);
  }
}

function fallbackModuleSlides(title: string, content: string, moduleIndex: number, density: string): Slide[] {
  // Extract bullets from markdown content
  const bullets = [
    ...content.matchAll(/^[-*•]\s+(.+)$/gm)
  ].map(m => m[1].trim()).filter(b => b.length > 10).slice(0, 12);

  const sentences = content
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/[`_\-*•]/g, "")
    .split(/[.!?]\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20 && s.length < 150)
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

async function repairPptxPackage(pptxData: Uint8Array): Promise<{ data: Uint8Array; diag: Record<string, unknown> }> {
  const zip = await JSZip.loadAsync(pptxData);
  const allFileNames = Object.keys(zip.files);

  const noteFiles = allFileNames.filter((name) =>
    name.startsWith("ppt/notesSlides/") || name.startsWith("ppt/notesMasters/")
  );
  for (const name of noteFiles) zip.remove(name);

  const presentationFile = zip.file("ppt/presentation.xml");
  if (presentationFile) {
    const xml = await presentationFile.async("string");
    zip.file("ppt/presentation.xml",
      xml.replace(/<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>/g, "").replace(/\s{2,}/g, " ")
    );
  }

  const presentationRelsFile = zip.file("ppt/_rels/presentation.xml.rels");
  if (presentationRelsFile) {
    const xml = await presentationRelsFile.async("string");
    zip.file("ppt/_rels/presentation.xml.rels",
      xml.replace(/<Relationship[^>]*Type="[^"]*\/notesMaster"[^>]*\/>/g, "").replace(/\s{2,}/g, " ")
    );
  }

  const viewPropsFile = zip.file("ppt/viewProps.xml");
  if (viewPropsFile) {
    const xml = await viewPropsFile.async("string");
    zip.file("ppt/viewProps.xml",
      xml.replace(/<p:notesTextViewPr>[\s\S]*?<\/p:notesTextViewPr>/g, "").replace(/\s{2,}/g, " ")
    );
  }

  const appPropsFile = zip.file("docProps/app.xml");
  if (appPropsFile) {
    const xml = await appPropsFile.async("string");
    zip.file("docProps/app.xml",
      xml.replace(/<Notes>\d+<\/Notes>/g, "<Notes>0</Notes>").replace(/\s{2,}/g, " ")
    );
  }

  for (const name of allFileNames.filter((f) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(f))) {
    const f = zip.file(name);
    if (!f) continue;
    const xml = await f.async("string");
    zip.file(name, xml.replace(/<Relationship[^>]*Type="[^"]*\/notesSlide"[^>]*\/>/g, "").replace(/\s{2,}/g, " "));
  }

  const refreshedFileNames = new Set(Object.keys(zip.files));
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) {
    const earlyOut = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return { data: earlyOut, diag: { notes_removed: noteFiles.length, early_return: true } };
  }

  const ctXml = await contentTypesFile.async("string");
  const repairedCt = ctXml.replace(/<Override\b[^>]*PartName="([^"]+)"[^>]*\/>/g, (full, partName) => {
    const norm = String(partName || "").replace(/^\//, "");
    return (norm && !refreshedFileNames.has(norm)) ? "" : full;
  });
  zip.file("[Content_Types].xml", repairedCt);

  const finalFileNames = Object.keys(zip.files);
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

  // Validate repaired output
  const testZip = await JSZip.loadAsync(out);
  const testFiles = Object.keys(testZip.files).filter(f => !f.endsWith("/"));
  const slideFiles = testFiles.filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  const ctXmlRepaired = await testZip.file("[Content_Types].xml")?.async("string") ?? "";

  return {
    data: out,
    diag: {
      notes_removed:    noteFiles.length,
      files_before:     allFileNames.length,
      files_after:      finalFileNames.length,
      slide_count:      slideFiles.length,
      has_presentation: !!testZip.file("ppt/presentation.xml"),
      content_types:    ctXmlRepaired.slice(0, 1500),
    },
  };
}

// ═══════════════════════════════════════════════════════════
// SECTION 6: PIPELINE
// ═══════════════════════════════════════════════════════════

// ── OVERFLOW GUARD ──
// If a code slide has too many items OR too many code lines → split into
// Slide A (bullets explanation) + Slide B (code with minimal context)
const CODE_MAX_LINES = 12;
const CODE_MAX_ITEMS_WITH_CODE = 3;

function splitOverflowSlides(slides: Slide[]): Slide[] {
  const out: Slide[] = [];
  for (const s of slides) {
    if (s.layout !== "code") { out.push(s); continue; }

    const lines = (s.code || "").split("\n");
    const items = s.items || [];
    const needsSplit = items.length > CODE_MAX_ITEMS_WITH_CODE || lines.length > CODE_MAX_LINES;

    if (!needsSplit) { out.push(s); continue; }

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

function extractCompetencies(content: string): string[] {
  // Try bullet points first
  const bullets = [...content.matchAll(/^[-*•]\s+(.+)$/gm)]
    .map(m => m[1].replace(/\*{1,2}/g, "").trim())
    .filter(b => b.length >= 12 && b.length <= 80)
    .slice(0, 3);
  if (bullets.length >= 2) return bullets;

  // Fallback: sub-headings
  const headings = [...content.matchAll(/^#{2,4}\s+(.+)$/gm)]
    .map(m => m[1].trim())
    .filter(h => h.length >= 10 && h.length <= 70)
    .slice(0, 3);
  if (headings.length >= 2) return headings;

  // Fallback: first short sentences
  return content
    .replace(/#{1,6}\s*/g, "").replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1").replace(/[`_]/g, "")
    .split(/[.!?\n]+/).map(s => s.trim())
    .filter(s => s.length >= 12 && s.length <= 70)
    .slice(0, 3);
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
  pptx.author = "EduGenAI v4";
  pptx.title = courseTitle;

  // Generate all module slides (sequential to avoid rate limits)
  const allModuleSlides: Slide[][] = [];
  for (let i = 0; i < modules.length; i++) {
    console.log(`[V4] Generating slides for module ${i + 1}/${modules.length}: "${modules[i].title}"`);
    const rawSlides = await generateModuleSlides(courseTitle, modules[i], i, density, language, geminiKey);
    const slides = splitOverflowSlides(rawSlides);
    console.log(`[V4] Module ${i + 1}: ${rawSlides.length} raw → ${slides.length} after split`);
    allModuleSlides.push(slides);
  }

  // Count total slides for footer
  const contentSlideCount = allModuleSlides.reduce((s, m) => s + m.length + 1, 0); // +1 per module cover
  const totalSlides = 1 + 1 + contentSlideCount + 1; // cover + toc + modules + closing
  let slideNum = 0;

  // Cover
  renderCover(pptx, {
    layout: "cover",
    title: courseTitle,
    subtitle: "CURSO COMPLETO",
  }, design, totalSlides);
  slideNum++;

  // TOC
  renderTOC(pptx, { layout: "toc", title: "Conteúdo" }, design, ++slideNum, totalSlides, modules);

  // Modules
  for (let i = 0; i < modules.length; i++) {
    const cleanTitle = modules[i].title.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || modules[i].title;

    // Module cover with competencies extracted from content
    renderModuleCover(pptx, {
      layout: "module_cover",
      title: cleanTitle,
      moduleIndex: i,
      competencies: extractCompetencies(modules[i].content),
    }, design, ++slideNum, totalSlides);

    // Content slides
    for (const s of allModuleSlides[i]) {
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
        default:
          renderBullets(pptx, s, design, ++slideNum, totalSlides);
      }
    }
  }

  // Closing with contextual next steps
  renderClosing(pptx, {
    layout: "closing",
    title: courseTitle,
    items: [
      `Aplique o conteúdo de ${san(courseTitle)} em um projeto real`,
      "Explore a documentação oficial e recursos avançados",
      "Construa um portfólio com os projetos deste curso",
      "Compartilhe seu progresso com a comunidade",
    ],
  }, design, ++slideNum, totalSlides);

  console.log(`[V4] Pipeline complete: ${slideNum} slides`);
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey    = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.user.id;

    const body = await req.json();
    const {
      course_id,
      palette     = "default",
      density     = "standard",
      theme       = "light",
      template    = "modern",
      includeImages = false,
      courseType  = "CURSO COMPLETO",
      footerBrand = "EduGenAI",
      language    = "Português (Brasil)",
    } = body;

    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: course, error: courseErr } = await serviceClient
      .from("courses").select("*")
      .eq("id", course_id).eq("user_id", userId).single();
    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (course.status !== "published") {
      return new Response(JSON.stringify({ error: "Course must be published to export." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: modules = [] } = await serviceClient
      .from("course_modules").select("*")
      .eq("course_id", course_id).order("order_index");

    const design = buildDesign(
      theme === "dark" ? "dark" : "light",
      palette,
      template,
      footerBrand || "EduGenAI",
    );

    const courseTitle = (course.title || "Curso").trim();
    const moduleData  = (modules as any[]).map((m) => ({
      title:   (m.title || "").trim(),
      content: (m.content || "").trim(),
    }));

    console.log(`[V4] ENGINE=${ENGINE_VERSION} | "${courseTitle}" | ${moduleData.length} modules | theme=${theme} | density=${density}`);

    const pptx = await runPipeline(courseTitle, moduleData, design, density, language, geminiKey);

    const rawData  = await pptx.write({ outputType: "uint8array" });
    const rawBytes = rawData as Uint8Array;
    console.log(`[V4-WRITE] raw_bytes=${rawBytes.byteLength} | magic=${rawBytes[0]}_${rawBytes[1]}_${rawBytes[2]}_${rawBytes[3]}`);
    const repairResult = await repairPptxPackage(rawBytes);
    const pptxData = repairResult.data;
    const repairDiag = repairResult.diag;
    console.log(`[V4-WRITE] repaired_bytes=${pptxData.byteLength} slides=${repairDiag.slide_count}`);

    const dateStr  = new Date().toISOString().slice(0, 10);
    const ts       = Math.floor(Date.now() / 1000);
    const safeName = courseTitle
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = `${userId}/${safeName}-PPTX-v4-${dateStr}-${ts}.pptx`;

    // Upload with retry
    let uploadErr: any = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const { error } = await serviceClient.storage.from("course-exports").upload(fileName, pptxData, {
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: true,
      });
      if (!error) { uploadErr = null; break; }
      uploadErr = error;
      if (attempt < 4) await new Promise(r => setTimeout(r, Math.min(2000 * 2 ** (attempt - 1), 15000)));
    }
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports").createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    try {
      await serviceClient.from("usage_events").insert({
        user_id: userId,
        event_type: "COURSE_EXPORTED_PPTX_V4",
        metadata: { course_id, modules: moduleData.length },
      });
    } catch { /* non-critical */ }

    return new Response(
      JSON.stringify({
        url:            signedUrl.signedUrl,
        version:        "v4",
        engine_version: ENGINE_VERSION,
        slide_count:    moduleData.length * (density === "compact" ? 5 : density === "detailed" ? 8 : 6) + 3,
        _diag: {
          raw_bytes:      rawBytes.byteLength,
          repaired_bytes: pptxData.byteLength,
          ...repairDiag,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (error: any) {
    console.error("[V4] Export error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
