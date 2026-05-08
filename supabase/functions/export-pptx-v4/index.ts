import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "npm:pptxgenjs@3.12.0";
import JSZip from "npm:jszip@3.10.1";
import {
  generatePresentationPlan,
  presentationPlanToV5Slides,
  type V5SlideLike,
} from "./presentation-plan.ts";

const ENGINE_VERSION = "5.2.2";

// ═══════════════════════════════════════════════════════════
// TEMPLATE CAPABILITIES — capacity limits per visual template
// "default_v5" is the current v5 engine and the universal fallback.
// External templates (futuristic_background, dark_theme, etc.) reuse the
// same renderers but may impose lower item limits per slide / TOC page.
// ═══════════════════════════════════════════════════════════

interface TemplateCaps {
  /** Max modules shown per TOC page (Infinity = no limit). */
  tocModules: number;
  /** Max takeaway items per slide. */
  takeaways: number;
  /** Max process steps per slide. */
  processSteps: number;
  /** Max cards per slide. */
  cards: number;
  /** Whether TOC can span multiple pages when limit is exceeded. */
  supportsPagination: boolean;
  /** Key of the fallback template, or null for the root fallback. */
  fallback: string | null;
}

const TEMPLATE_CAPABILITIES: Record<string, TemplateCaps> = {
  default_v5: {
    tocModules: Infinity,
    takeaways: 5,
    processSteps: 5,
    cards: 4,
    supportsPagination: true,
    fallback: null,
  },
  futuristic_background: {
    tocModules: 3,
    takeaways: 6,
    processSteps: 6,
    cards: 3,
    supportsPagination: true,
    fallback: "default_v5",
  },
  dark_theme: {
    tocModules: 6,
    takeaways: 8,
    processSteps: 4,
    cards: 3,
    supportsPagination: true,
    fallback: "default_v5",
  },
  dark_elegance_xl: {
    tocModules: 4,
    takeaways: 3,
    processSteps: 6,
    cards: 3,
    supportsPagination: true,
    fallback: "default_v5",
  },
  dark_style_theme: {
    tocModules: 6,
    takeaways: 4,
    processSteps: 6,
    cards: 3,
    supportsPagination: true,
    fallback: "default_v5",
  },
};

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

// Component-level rendering archetypes — drive per-layout visual style
interface ComponentArchetypes {
  cards:      "elevated_grid" | "flat_grid" | "minimal_blocks";
  process:    "horizontal_chevron" | "numbered_steps";
  comparison: "clean_columns" | "split_panels" | "subtle_table";
  code:       "terminal_dark" | "editor_light";
  takeaway:   "numbered_list" | "highlight_cards";
}

const DEFAULT_ARCHETYPES: ComponentArchetypes = {
  cards:      "elevated_grid",
  process:    "horizontal_chevron",
  comparison: "clean_columns",
  code:       "terminal_dark",
  takeaway:   "numbered_list",
};

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
  // Skin layout tokens — drive structural variation per template
  skinId: string;
  coverStyle: "sidebar" | "full" | "diagonal" | "centered";
  headerStyle: "chip" | "band" | "line";
  cardStyle: "rounded" | "glow" | "sharp" | "bordered";
  accentBarPos: "left" | "top";
  // Component rendering archetypes — drive visual style per layout type
  componentArchetypes: ComponentArchetypes;
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

// ═══════════════════════════════════════════════════════════
// SECTION 2B: DESIGN SYSTEMS
// Canonical source of truth for all visual identities.
// SKIN_REGISTRY is derived from DESIGN_SYSTEMS automatically.
// default_v5 uses the palette-based buildDesign path.
// ═══════════════════════════════════════════════════════════

interface SkinOverride {
  bg: string; surface: string; text: string; subtext: string; border: string;
  coverBg: string; accent: string; accent2: string; accent3: string; highlight: string;
  titleFont: string; bodyFont: string;
  coverStyle: "sidebar" | "full" | "diagonal" | "centered";
  headerStyle: "chip" | "band" | "line";
  cardStyle: "rounded" | "glow" | "sharp" | "bordered";
  accentBarPos: "left" | "top";
  componentArchetypes: ComponentArchetypes;
}

interface DesignSystemDef extends SkinOverride {
  name: string;
  description: string;
}

const DESIGN_SYSTEMS: Record<string, DesignSystemDef> = {
  default_v5: {
    name: "Default V5",
    description: "Clean navy/blue professional. Elevated cards, horizontal chevron process, terminal code.",
    bg: "0A0E1A", surface: "111827", text: "F1F5F9", subtext: "94A3B8",
    border: "1E293B", coverBg: "0A1628",
    accent: "1E3A5F", accent2: "2E6DA4", accent3: "C47F17", highlight: "E8A020",
    titleFont: "Cambria", bodyFont: "Calibri",
    coverStyle: "sidebar", headerStyle: "chip", cardStyle: "rounded", accentBarPos: "left",
    componentArchetypes: { cards: "elevated_grid", process: "horizontal_chevron", comparison: "clean_columns", code: "terminal_dark", takeaway: "numbered_list" },
  },
  futuristic_background: {
    name: "Futuristic",
    description: "Cyber neon aesthetic. Flat glowing cards, split panels, highlight takeaways.",
    bg: "030B18", surface: "071525", text: "C8E6FF", subtext: "4A7A9E",
    border: "0A2540", coverBg: "010407",
    accent: "00AAFF", accent2: "7B2FFF", accent3: "00FFD4", highlight: "00FFD4",
    titleFont: "Trebuchet MS", bodyFont: "Calibri",
    coverStyle: "full", headerStyle: "band", cardStyle: "glow", accentBarPos: "top",
    componentArchetypes: { cards: "flat_grid", process: "horizontal_chevron", comparison: "split_panels", code: "terminal_dark", takeaway: "highlight_cards" },
  },
  dark_theme: {
    name: "Dark Gold",
    description: "GitHub dark with gold accents. Sharp elevated cards, numbered steps, clean columns.",
    bg: "0D1117", surface: "161B22", text: "E6EDF3", subtext: "7D8590",
    border: "21262D", coverBg: "04080F",
    accent: "F0A500", accent2: "D97706", accent3: "B45309", highlight: "FCD34D",
    titleFont: "Georgia", bodyFont: "Calibri",
    coverStyle: "diagonal", headerStyle: "line", cardStyle: "sharp", accentBarPos: "left",
    componentArchetypes: { cards: "elevated_grid", process: "numbered_steps", comparison: "clean_columns", code: "terminal_dark", takeaway: "numbered_list" },
  },
  dark_elegance_xl: {
    name: "Dark Elegance",
    description: "Violet-gold luxury. Minimal blocks, numbered steps, subtle table, editor code, highlight takeaways.",
    bg: "0B0912", surface: "140F1F", text: "ECE8F5", subtext: "7A6898",
    border: "201535", coverBg: "060309",
    accent: "8B2FC9", accent2: "C2185B", accent3: "D4AF37", highlight: "E8D5B7",
    titleFont: "Palatino Linotype", bodyFont: "Calibri",
    coverStyle: "centered", headerStyle: "chip", cardStyle: "bordered", accentBarPos: "left",
    componentArchetypes: { cards: "minimal_blocks", process: "numbered_steps", comparison: "subtle_table", code: "editor_light", takeaway: "highlight_cards" },
  },
  dark_style_theme: {
    name: "Dark Fire",
    description: "Red-amber energy. Flat grid cards, split panels, numbered list takeaways.",
    bg: "0F1219", surface: "171D27", text: "F0F4F8", subtext: "718096",
    border: "1E2533", coverBg: "070B12",
    accent: "E53E3E", accent2: "DD6B20", accent3: "D69E2E", highlight: "FAF089",
    titleFont: "Trebuchet MS", bodyFont: "Calibri",
    coverStyle: "sidebar", headerStyle: "band", cardStyle: "rounded", accentBarPos: "left",
    componentArchetypes: { cards: "flat_grid", process: "horizontal_chevron", comparison: "split_panels", code: "terminal_dark", takeaway: "numbered_list" },
  },
};

// Derive SKIN_REGISTRY from DESIGN_SYSTEMS (excludes default_v5 which uses palette-based path)
const SKIN_REGISTRY: Record<string, SkinOverride> = {};
for (const [k, v] of Object.entries(DESIGN_SYSTEMS)) {
  if (k === "default_v5") continue;
  const { name: _n, description: _d, ...skinData } = v;
  SKIN_REGISTRY[k] = skinData;
}

function buildDesign(
  theme: "light" | "dark",
  palette: string,
  template: string,
  footerBrand: string,
): Design {
  const defaultTokens = {
    skinId: "default_v5",
    coverStyle: "sidebar" as const,
    headerStyle: "chip" as const,
    cardStyle: "rounded" as const,
    accentBarPos: "left" as const,
    componentArchetypes: DEFAULT_ARCHETYPES,
  };

  // Registered skin — overrides ALL colors and layout tokens
  const skin = SKIN_REGISTRY[template];
  if (skin) {
    return { theme: "dark", ...skin, skinId: template, footerBrand };
  }

  const colors = PALETTE_MAP[palette] || PALETTE_MAP.default;
  const [accent, accent2, accent3, highlight, palettecover] = colors;

  if (theme === "dark") {
    return {
      theme, accent, accent2, accent3, highlight,
      bg: "0A0E1A", surface: "111827",
      text: "F1F5F9", subtext: "94A3B8", border: "1E293B",
      coverBg: palettecover,
      titleFont: "Cambria", bodyFont: "Calibri",
      footerBrand, ...defaultTokens,
    };
  }
  return {
    theme, accent, accent2, accent3, highlight,
    bg: "FFFFFF", surface: "F8FAFC",
    text: "0F172A", subtext: "475569", border: "E2E8F0",
    coverBg: "0F172A",
    titleFont: "Cambria", bodyFont: "Calibri",
    footerBrand, ...defaultTokens,
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

// Standard slide header — 3 variants driven by d.headerStyle
function header(slide: any, d: Design, label: string, title: string) {
  // ── BAND: full-width surface bar with left accent stripe ──
  if (d.headerStyle === "band") {
    const bandH = 1.38;
    slide.addShape("rect" as any, { x: 0, y: 0, w: SLIDE_W, h: bandH, fill: { color: d.surface } });
    slide.addShape("rect" as any, { x: 0, y: 0, w: 0.07, h: bandH, fill: { color: d.accent } });
    slide.addShape("rect" as any, { x: 0, y: bandH - 0.03, w: SLIDE_W, h: 0.03, fill: { color: d.accent, transparency: 40 } });
    if (label) {
      slide.addText(san(label).toUpperCase(), { x: ML, y: 0.18, w: CW, h: 0.26, fontSize: T.SECTION_LABEL, fontFace: d.bodyFont, bold: true, color: d.accent, charSpacing: 4 });
    }
    const tY = label ? 0.52 : 0.26;
    slide.addText(san(title), { x: ML, y: tY, w: CW, h: bandH - tY - 0.14, fontSize: T.SLIDE_TITLE, fontFace: d.titleFont, bold: true, color: d.text, valign: "middle", fit: "shrink" as any });
    return;
  }

  // ── LINE: left vertical accent stripe ──
  if (d.headerStyle === "line") {
    slide.addShape("rect" as any, { x: ML, y: 0.18, w: 0.045, h: 1.15, fill: { color: d.accent } });
    if (label) {
      slide.addText(san(label).toUpperCase(), { x: ML + 0.18, y: 0.20, w: CW - 0.22, h: 0.28, fontSize: T.SECTION_LABEL, fontFace: d.bodyFont, bold: true, color: d.subtext, charSpacing: 4 });
    }
    const tY2 = label ? 0.55 : 0.22;
    const tH2 = label ? 0.74 : 1.05;
    slide.addText(san(title), { x: ML + 0.18, y: tY2, w: CW - 0.22, h: tH2, fontSize: T.SLIDE_TITLE, fontFace: d.titleFont, bold: true, color: d.text, valign: "middle", fit: "shrink" as any });
    return;
  }

  // ── CHIP (default): pill label + short accent underline ──
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

  // ── FUTURISTIC: centered title, grid dots, dual neon strips ──
  if (d.coverStyle === "full") {
    bg(slide, d.coverBg);
    slide.addShape("rect" as any, { x: 0, y: 0, w: SLIDE_W, h: 0.046, fill: { color: d.accent } });
    slide.addShape("rect" as any, { x: 0, y: SLIDE_H - 0.046, w: SLIDE_W, h: 0.046, fill: { color: d.accent2 } });
    for (let gx = 0; gx < 11; gx++) {
      for (let gy = 0; gy < 6; gy++) {
        slide.addShape("ellipse" as any, { x: 0.7 + gx * 1.15, y: 0.4 + gy * 1.15, w: 0.032, h: 0.032, fill: { color: d.accent, transparency: 88 } });
      }
    }
    if (slide_.subtitle) {
      slide.addShape("roundRect" as any, { x: SLIDE_W / 2 - 1.8, y: 1.35, w: 3.6, h: 0.36, fill: { color: d.accent, transparency: 22 }, line: { color: d.accent, width: 0.8 }, rectRadius: 0.04 });
      slide.addText(san(slide_.subtitle).toUpperCase(), { x: SLIDE_W / 2 - 1.8, y: 1.35, w: 3.6, h: 0.36, fontSize: 10, fontFace: d.bodyFont, bold: true, color: d.accent, charSpacing: 3, align: "center", valign: "middle" });
    }
    slide.addText(san(slide_.title), { x: 0.9, y: 1.9, w: SLIDE_W - 1.8, h: 2.5, fontSize: 44, fontFace: d.titleFont, bold: true, color: "FFFFFF", align: "center", valign: "middle", fit: "shrink" as any, lineSpacingMultiple: 1.15 });
    slide.addShape("rect" as any, { x: SLIDE_W / 2 - 1.6, y: 4.55, w: 3.2, h: 0.03, fill: { color: d.accent } });
    slide.addText("Curso completo com material profissional", { x: 0.9, y: 4.65, w: SLIDE_W - 1.8, h: 0.38, fontSize: 12, fontFace: d.bodyFont, color: d.subtext, align: "center", valign: "middle" });
    return;
  }

  // ── DARK PREMIUM: right-side gold accent panel ──
  if (d.coverStyle === "diagonal") {
    bg(slide, d.coverBg);
    const panelW = 3.8;
    slide.addShape("rect" as any, { x: SLIDE_W - panelW, y: 0, w: panelW, h: SLIDE_H, fill: { color: d.accent, transparency: 88 } });
    slide.addShape("rect" as any, { x: 0, y: 0, w: SLIDE_W, h: 0.055, fill: { color: d.accent } });
    if (slide_.subtitle) {
      slide.addText(san(slide_.subtitle).toUpperCase(), { x: ML, y: 1.0, w: SLIDE_W - panelW - ML - 0.2, h: 0.3, fontSize: 9, fontFace: d.bodyFont, bold: true, color: d.accent, charSpacing: 5 });
    }
    slide.addText(san(slide_.title), { x: ML, y: slide_.subtitle ? 1.42 : 1.1, w: SLIDE_W - panelW - ML - 0.3, h: 2.6, fontSize: 44, fontFace: d.titleFont, bold: true, color: "FFFFFF", valign: "middle", fit: "shrink" as any, lineSpacingMultiple: 1.15 });
    slide.addShape("rect" as any, { x: ML, y: 4.2, w: 2.6, h: 0.04, fill: { color: d.accent } });
    slide.addText("Curso completo com material profissional", { x: ML, y: 4.36, w: SLIDE_W - panelW - ML - 0.3, h: 0.38, fontSize: 12, fontFace: d.bodyFont, color: "94A3B8", valign: "middle" });
    for (let i = 0; i < 4; i++) {
      slide.addShape("rect" as any, { x: SLIDE_W - panelW + 0.5, y: 1.2 + i * 1.1, w: panelW - 1.0, h: 0.03, fill: { color: d.accent, transparency: 70 } });
    }
    return;
  }

  // ── DARK ELEGANCE: centered, top accent band, ornamental lines ──
  if (d.coverStyle === "centered") {
    bg(slide, d.coverBg);
    const headerH = 1.72;
    slide.addShape("rect" as any, { x: 0, y: 0, w: SLIDE_W, h: headerH, fill: { color: d.accent, transparency: 25 } });
    slide.addShape("rect" as any, { x: 0, y: headerH - 0.04, w: SLIDE_W, h: 0.04, fill: { color: d.accent } });
    if (slide_.subtitle) {
      slide.addText(san(slide_.subtitle).toUpperCase(), { x: 0, y: 0.62, w: SLIDE_W, h: 0.32, fontSize: 10, fontFace: d.bodyFont, bold: true, color: "FFFFFF", charSpacing: 6, align: "center" });
    }
    slide.addShape("rect" as any, { x: SLIDE_W / 2 - 2.2, y: headerH + 0.28, w: 4.4, h: 0.02, fill: { color: d.accent3 } });
    slide.addText(san(slide_.title), { x: 0.9, y: headerH + 0.38, w: SLIDE_W - 1.8, h: 2.3, fontSize: 42, fontFace: d.titleFont, bold: true, color: "FFFFFF", align: "center", valign: "middle", fit: "shrink" as any, lineSpacingMultiple: 1.15 });
    slide.addShape("rect" as any, { x: SLIDE_W / 2 - 2.2, y: 4.84, w: 4.4, h: 0.02, fill: { color: d.accent3 } });
    slide.addText("Curso completo com material profissional", { x: 0.9, y: 4.95, w: SLIDE_W - 1.8, h: 0.38, fontSize: 12, fontFace: d.bodyFont, color: d.subtext, align: "center" });
    for (let i = 0; i < 3; i++) {
      const sz = 0.5 + i * 0.35;
      slide.addShape("ellipse" as any, { x: -sz * 0.5, y: SLIDE_H - sz * 0.9, w: sz, h: sz, fill: { color: d.accent2, transparency: 84 + i * 3 } });
      slide.addShape("ellipse" as any, { x: SLIDE_W - sz * 0.5, y: SLIDE_H - sz * 0.9, w: sz, h: sz, fill: { color: d.accent3, transparency: 84 + i * 3 } });
    }
    return;
  }

  // ── DEFAULT SIDEBAR ──
  bg(slide, d.coverBg);
  slide.addShape("rect" as any, { x: 0, y: 0, w: 0.12, h: SLIDE_H, fill: { color: d.accent } });
  slide.addShape("rect" as any, { x: 0.12, y: 0, w: 0.06, h: SLIDE_H, fill: { color: d.accent2, transparency: 60 } });
  if (slide_.subtitle) {
    slide.addShape("roundRect" as any, { x: 1.0, y: 1.1, w: Math.min(4.0, slide_.subtitle.length * 0.18 + 0.5), h: 0.34, fill: { color: d.accent }, rectRadius: 0.04 });
    slide.addText(san(slide_.subtitle).toUpperCase(), { x: 1.0, y: 1.1, w: 4.5, h: 0.34, fontSize: 10, fontFace: d.bodyFont, bold: true, color: "FFFFFF", charSpacing: 3, valign: "middle" });
  }
  slide.addText(san(slide_.title), { x: 1.0, y: 1.65, w: SLIDE_W - 1.6, h: 2.4, fontSize: 44, fontFace: d.titleFont, bold: true, color: "FFFFFF", valign: "middle", fit: "shrink" as any, lineSpacingMultiple: 1.15 });
  slide.addShape("rect" as any, { x: 1.0, y: 4.25, w: 3.0, h: 0.04, fill: { color: d.accent } });
  slide.addText("Curso completo com material profissional", { x: 1.0, y: 4.42, w: SLIDE_W - 2.0, h: 0.4, fontSize: 14, fontFace: d.bodyFont, color: "94A3B8", valign: "middle" });
  for (let i = 0; i < 4; i++) {
    const sz = 0.8 + i * 0.5;
    slide.addShape("ellipse" as any, { x: SLIDE_W - sz - 0.3, y: SLIDE_H - sz - 0.2, w: sz, h: sz, fill: { color: d.accent, transparency: 82 + i * 4 } });
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
  pagination?: { page: number; pageCount: number; firstModule: number; lastModule: number; totalModules: number },
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
  // ── Header label: "ÍNDICE" or "ÍNDICE — PARTE X/Y" when paginated
  const headerLabel = pagination && pagination.pageCount > 1
    ? `ÍNDICE — PARTE ${pagination.page}/${pagination.pageCount}`
    : "ÍNDICE";
  slide.addText(headerLabel, {
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
  // ── Title: "Conteúdo do Curso" — same on every page so it reads
  // as the same course rather than a separate one.
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
  // ── Bottom chip: module range (e.g. "Módulos 7–8 de 8") when paginated,
  // else the simple total count. Never just "{n} Módulos" alone on page 2+,
  // which previously read like a different deck.
  const chipLabel = pagination && pagination.pageCount > 1
    ? (pagination.firstModule === pagination.lastModule
        ? `Módulo ${pagination.firstModule} de ${pagination.totalModules}`
        : `Módulos ${pagination.firstModule}–${pagination.lastModule} de ${pagination.totalModules}`)
    : `${modules.length} Módulo${modules.length !== 1 ? "s" : ""}`;
  // Wider chip for paginated label (it can be long like "Módulos 11–15 de 20")
  const chipW = pagination && pagination.pageCount > 1 ? 2.4 : 1.7;
  slide.addShape("roundRect" as any, {
    x: ML,
    y: FOOTER_Y - 0.54,
    w: chipW,
    h: 0.36,
    fill: { color: d.accent },
    rectRadius: 0.04,
  });
  slide.addText(chipLabel, {
    x: ML,
    y: FOOTER_Y - 0.54,
    w: chipW,
    h: 0.36,
    fontSize: 12,
    fontFace: d.bodyFont,
    bold: true,
    color: "FFFFFF",
    align: "center",
    valign: "middle",
    fit: "shrink" as any,
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

// ── TOC PAGINATED ──
// Renders one or more TOC slides, paginating when modules exceed maxPerPage.
// Returns the count of slides added (so the caller can advance slideNum correctly).
function renderTOCPaginated(
  pptx: PptxGenJS,
  slide_: Slide,
  d: Design,
  startNum: number,
  total: number,
  modules: { title: string }[],
  maxPerPage: number,
): number {
  // Single page: no limit or everything fits
  if (!isFinite(maxPerPage) || modules.length <= maxPerPage) {
    renderTOC(pptx, slide_, d, startNum, total, modules);
    return 1;
  }

  // Multi-page: split modules into pages of maxPerPage each
  const pageCount = Math.ceil(modules.length / maxPerPage);
  for (let p = 0; p < pageCount; p++) {
    const firstIdx = p * maxPerPage;
    const lastIdx  = Math.min((p + 1) * maxPerPage, modules.length);
    const chunk = modules.slice(firstIdx, lastIdx);
    // Pagination metadata so renderTOC can show "ÍNDICE — PARTE 2/2"
    // and "Módulos 7–8 de 8" instead of just "{n} Módulos" (which on
    // page 2+ looked like a separate course in v5.1).
    const pageLabel = `ÍNDICE — PARTE ${p + 1}/${pageCount}`;
    renderTOC(
      pptx,
      { ...slide_, label: pageLabel },
      d,
      startNum + p,
      total,
      chunk,
      {
        page: p + 1,
        pageCount,
        firstModule: firstIdx + 1,
        lastModule:  lastIdx,
        totalModules: modules.length,
      },
    );
  }
  return pageCount;
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
  const modNum = String((slide_.moduleIndex ?? 0) + 1).padStart(2, "0");

  // ── FUTURISTIC: horizontal top band ──
  if (d.accentBarPos === "top") {
    bg(slide, d.coverBg);
    const topH = 1.05;
    slide.addShape("rect" as any, { x: 0, y: 0, w: SLIDE_W, h: topH, fill: { color: d.accent } });
    slide.addShape("rect" as any, { x: 0, y: topH - 0.03, w: SLIDE_W, h: 0.03, fill: { color: d.accent2 } });
    slide.addText("MÓDULO " + ((slide_.moduleIndex ?? 0) + 1), { x: ML, y: 0.14, w: CW * 0.65, h: 0.28, fontSize: 10, fontFace: d.bodyFont, bold: true, color: "FFFFFF", charSpacing: 5 });
    slide.addText(modNum, { x: SLIDE_W - 2.6, y: -0.2, w: 2.2, h: 1.5, fontSize: 110, fontFace: d.titleFont, bold: true, color: "FFFFFF", transparency: 82, align: "right", valign: "top" });
    for (let gx = 0; gx < 9; gx++) {
      for (let gy = 0; gy < 4; gy++) {
        slide.addShape("ellipse" as any, { x: 0.8 + gx * 1.35, y: topH + 0.5 + gy * 1.45, w: 0.025, h: 0.025, fill: { color: d.accent, transparency: 88 } });
      }
    }
    slide.addText(san(slide_.title), { x: ML, y: topH + 0.35, w: SLIDE_W - ML - MR, h: 2.1, fontSize: 34, fontFace: d.titleFont, bold: true, color: d.text, valign: "top", fit: "shrink" as any, lineSpacingMultiple: 1.2 });
    slide.addShape("rect" as any, { x: ML, y: topH + 2.6, w: 1.4, h: 0.04, fill: { color: d.accent } });
    const competenciesTop = (slide_.competencies || []).slice(0, 3);
    if (competenciesTop.length > 0) {
      slide.addText("O QUE VOCÊ VAI APRENDER", { x: ML, y: topH + 2.78, w: CW, h: 0.22, fontSize: 8, fontFace: d.bodyFont, bold: true, color: d.accent, charSpacing: 4 });
      for (let i = 0; i < competenciesTop.length; i++) {
        const cy = topH + 3.1 + i * 0.76;
        slide.addShape("ellipse" as any, { x: ML, y: cy + 0.07, w: 0.12, h: 0.12, fill: { color: d.accent } });
        slide.addText(san(competenciesTop[i]), { x: ML + 0.22, y: cy, w: CW - 0.28, h: 0.32, fontSize: 12, fontFace: d.bodyFont, color: d.text, valign: "middle", fit: "shrink" as any });
      }
    }
    footer(slide, d, num, total);
    return;
  }

  // ── DEFAULT (left sidebar) ──
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

    // Card background + left accent — varies by skin
    if (d.cardStyle === "glow") {
      slide.addShape("roundRect" as any, { x: ML, y, w: CW, h: itemH, fill: { color: d.surface }, line: { color: pal, width: 1.6 }, rectRadius: 0.06 });
      slide.addShape("rect" as any, { x: ML, y: y + itemH * 0.2, w: 0.04, h: itemH * 0.6, fill: { color: pal } });
    } else if (d.cardStyle === "sharp") {
      slide.addShape("roundRect" as any, { x: ML, y, w: CW, h: itemH, fill: { color: d.surface }, line: { color: d.border, width: 0.5 }, rectRadius: 0.02 });
      slide.addShape("rect" as any, { x: ML, y, w: 0.055, h: itemH, fill: { color: pal } });
    } else if (d.cardStyle === "bordered") {
      slide.addShape("roundRect" as any, { x: ML, y, w: CW, h: itemH, fill: { color: d.surface, transparency: 55 }, line: { color: pal, width: 1.0 }, rectRadius: 0.07 });
      slide.addShape("rect" as any, { x: ML, y: y + 0.08, w: 0.04, h: itemH - 0.16, fill: { color: pal, transparency: 15 } });
    } else {
      slide.addShape("roundRect" as any, { x: ML, y, w: CW, h: itemH, fill: { color: d.surface }, line: { color: d.border, width: 0.4 }, rectRadius: 0.06 });
      slide.addShape("roundRect" as any, { x: ML, y, w: 0.055, h: itemH, fill: { color: pal }, rectRadius: 0.06 });
    }

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

  const cardArch = d.componentArchetypes?.cards ?? "elevated_grid";

  // ── flat_grid: no shadow, bottom accent strip, accent title, no badge ──
  if (cardArch === "flat_grid") {
    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = ML + col * (cardW + gap);
      const y = cardsStartY + row * (cardH + gap);
      const pal = [d.accent, d.accent2, d.accent3][i % 3];
      const colonIdx = items[i].indexOf(": ");
      const hasTitle = colonIdx > 0 && colonIdx < 50;
      const cardTopText = hasTitle ? items[i].slice(0, colonIdx) : "";
      const cardBodyText = hasTitle ? items[i].slice(colonIdx + 2) : items[i];
      slide.addShape("roundRect" as any, {
        x, y, w: cardW, h: cardH,
        fill: { color: d.surface },
        line: { color: pal, width: 1.4, transparency: 45 },
        rectRadius: 0.06,
      });
      slide.addShape("rect" as any, { x, y: y + cardH - 0.048, w: cardW, h: 0.048, fill: { color: pal } });
      slide.addText(String(i + 1), {
        x: x + cardW - 0.40, y: y + 0.07, w: 0.32, h: 0.24,
        fontSize: 10, fontFace: d.bodyFont, bold: true, color: pal, align: "right",
      });
      let fgCY = y + 0.18;
      if (hasTitle && cardTopText) {
        slide.addText(san(cardTopText), {
          x: x + 0.14, y: fgCY, w: cardW - 0.28, h: 0.38,
          fontSize: items.length <= 2 ? 18 : items.length === 3 ? 16 : 14,
          fontFace: d.titleFont, bold: true, color: pal,
          valign: "top", lineSpacingMultiple: 1.1, fit: "shrink" as any,
        });
        fgCY += 0.38 + 0.06;
      }
      slide.addText(san(cardBodyText), {
        x: x + 0.14, y: fgCY, w: cardW - 0.28,
        h: Math.max(0.3, y + cardH - fgCY - 0.10),
        fontSize: items.length <= 2 ? 15 : items.length === 3 ? 13 : 11,
        fontFace: d.bodyFont, color: hasTitle ? d.subtext : d.text,
        align: "left", valign: "top", lineSpacingMultiple: 1.2, fit: "shrink" as any,
      });
    }
    footer(slide, d, num, total);
    return;
  }

  // ── minimal_blocks: translucent bg, ultra-thin left bar, no badge ──
  if (cardArch === "minimal_blocks") {
    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = ML + col * (cardW + gap);
      const y = cardsStartY + row * (cardH + gap);
      const pal = [d.accent, d.accent2, d.accent3][i % 3];
      const colonIdx = items[i].indexOf(": ");
      const hasTitle = colonIdx > 0 && colonIdx < 50;
      const cardTopText = hasTitle ? items[i].slice(0, colonIdx) : "";
      const cardBodyText = hasTitle ? items[i].slice(colonIdx + 2) : items[i];
      slide.addShape("roundRect" as any, {
        x, y, w: cardW, h: cardH,
        fill: { color: d.surface, transparency: 62 },
        line: { color: d.border, width: 0.4 },
        rectRadius: 0.08,
      });
      slide.addShape("roundRect" as any, {
        x, y, w: 0.024, h: cardH,
        fill: { color: pal }, rectRadius: 0.08,
      });
      let mbCY = y + 0.18;
      if (hasTitle && cardTopText) {
        slide.addText(san(cardTopText), {
          x: x + 0.11, y: mbCY, w: cardW - 0.22, h: 0.40,
          fontSize: items.length <= 2 ? 18 : 15,
          fontFace: d.titleFont, bold: true, color: d.text,
          valign: "top", lineSpacingMultiple: 1.1, fit: "shrink" as any,
        });
        mbCY += 0.40 + 0.08;
      }
      slide.addText(san(cardBodyText), {
        x: x + 0.11, y: mbCY, w: cardW - 0.22,
        h: Math.max(0.3, y + cardH - mbCY - 0.12),
        fontSize: items.length <= 2 ? 16 : items.length === 3 ? 13 : 12,
        fontFace: d.bodyFont, color: hasTitle ? d.subtext : d.text,
        align: "left", valign: "top", lineSpacingMultiple: 1.3, fit: "shrink" as any,
      });
    }
    footer(slide, d, num, total);
    return;
  }

  // ── elevated_grid (default): shadow + top color bar + number badge ──
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

    // Shadow (omit for glow — bright border provides depth)
    if (d.cardStyle !== "glow") {
      slide.addShape("roundRect" as any, {
        x: x + 0.03, y: y + 0.04, w: cardW, h: cardH,
        fill: { color: "000000", transparency: 88 }, rectRadius: 0.1,
      });
    }

    // Card body — varies by skin
    const cardR = d.cardStyle === "sharp" ? 0.02 : 0.1;
    slide.addShape("roundRect" as any, {
      x, y, w: cardW, h: cardH,
      fill: d.cardStyle === "bordered" ? { color: d.surface, transparency: 55 } : { color: d.surface },
      line: d.cardStyle === "glow"     ? { color: pal, width: 2.0 }
           : d.cardStyle === "bordered" ? { color: pal, width: 1.4 }
           : d.cardStyle === "sharp"    ? { color: d.border, width: 0.5 }
           : { color: d.border, width: 0.4 },
      rectRadius: cardR,
    });

    // Top color bar
    const topBarH = 0.1;
    if (d.cardStyle === "glow" || d.cardStyle === "bordered") {
      // Thin neon strip for glow/bordered
      slide.addShape("rect" as any, { x, y, w: cardW, h: 0.055, fill: { color: pal } });
    } else {
      slide.addShape("roundRect" as any, { x, y, w: cardW, h: topBarH, fill: { color: pal }, rectRadius: cardR });
      slide.addShape("rect" as any, { x, y: y + topBarH * 0.4, w: cardW, h: topBarH * 0.6, fill: { color: pal } });
    }

    // Color left stripe (standard styles only)
    if (d.cardStyle !== "glow" && d.cardStyle !== "bordered") {
      slide.addShape("rect" as any, {
        x, y: y + topBarH, w: 0.055, h: cardH - topBarH,
        fill: { color: pal, transparency: 60 },
      });
    }

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

  // ── Archetype: numbered_steps — vertical list with numbered circle badges ──
  const procArch = d.componentArchetypes?.process ?? "horizontal_chevron";
  if (procArch === "numbered_steps") {
    const dotSz = n <= 3 ? 0.50 : 0.42;
    const spineX = ML + 0.28;
    const stepH = Math.min(1.15, (CONTENT_H - 0.10) / n);
    const totalH = stepH * n;
    const startY = CONTENT_Y + (CONTENT_H - totalH) / 2;
    const textX = spineX + dotSz + 0.20;
    const textW = CW - (textX - ML);
    // Vertical spine
    slide.addShape("rect" as any, {
      x: spineX + dotSz / 2 - 0.015, y: startY + dotSz * 0.55,
      w: 0.03, h: Math.max(0.1, totalH - dotSz * 1.1),
      fill: { color: d.accent, transparency: 68 },
    });
    for (let i = 0; i < n; i++) {
      const pal = [d.accent, d.accent2, d.accent3][i % 3];
      const dotY = startY + i * stepH;
      const cH = Math.max(0.40, stepH * 0.76);
      const cY = dotY + dotSz / 2 - cH / 2;
      // Number badge
      slide.addShape("ellipse" as any, {
        x: spineX, y: dotY, w: dotSz, h: dotSz, fill: { color: pal },
      });
      slide.addText(String(i + 1), {
        x: spineX, y: dotY, w: dotSz, h: dotSz,
        fontSize: n <= 3 ? 17 : 13, fontFace: d.titleFont, bold: true,
        color: "FFFFFF", align: "center", valign: "middle",
      });
      // Text card
      slide.addShape("roundRect" as any, {
        x: textX, y: cY, w: textW, h: cH,
        fill: { color: d.surface },
        line: { color: pal, width: 0.8 },
        rectRadius: 0.07,
      });
      slide.addShape("rect" as any, {
        x: textX, y: cY + cH * 0.22, w: 0.04, h: cH * 0.56,
        fill: { color: pal },
      });
      slide.addText(san(items[i]), {
        x: textX + 0.12, y: cY + 0.04, w: textW - 0.20, h: cH - 0.08,
        fontSize: n <= 3 ? 15 : n <= 4 ? 13 : 11,
        fontFace: d.bodyFont, color: d.text,
        valign: "middle", lineSpacingMultiple: 1.2, fit: "shrink" as any,
      });
    }
    footer(slide, d, num, total);
    return;
  }

  // ── horizontal_chevron (default): boxes with › arrow connectors ──
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

  const takeArch = d.componentArchetypes?.takeaway ?? "numbered_list";

  // ── highlight_cards: impactful cards with colored top band ──
  if (takeArch === "highlight_cards") {
    const hcGap = 0.12;
    const hcAvailH = FOOTER_Y - contentY2 - 0.1;
    const hcItemH = (hcAvailH - hcGap * (items.length - 1)) / Math.max(items.length, 1);
    for (let i = 0; i < items.length; i++) {
      const y = contentY2 + i * (hcItemH + hcGap);
      const pal = [d.accent, d.accent2, d.accent3][i % 3];
      const topBH = Math.min(0.13, hcItemH * 0.20);
      // Card shadow
      slide.addShape("roundRect" as any, {
        x: ML + 0.02, y: y + 0.03, w: CW, h: hcItemH,
        fill: { color: "000000", transparency: 90 }, rectRadius: 0.08,
      });
      // Card body
      slide.addShape("roundRect" as any, {
        x: ML, y, w: CW, h: hcItemH,
        fill: { color: d.surface },
        line: { color: pal, width: 0.7 },
        rectRadius: 0.08,
      });
      // Colored top band
      slide.addShape("roundRect" as any, { x: ML, y, w: CW, h: topBH, fill: { color: pal }, rectRadius: 0.08 });
      slide.addShape("rect" as any, { x: ML, y: y + topBH / 2, w: CW, h: topBH / 2, fill: { color: pal } });
      // Text
      const fontSize = items.length <= 3 ? 16 : 14;
      slide.addText(san(items[i]), {
        x: ML + 0.22, y: y + topBH + 0.06, w: CW - 0.44,
        h: Math.max(0.24, hcItemH - topBH - 0.10),
        fontSize, fontFace: d.bodyFont, color: d.text,
        valign: "middle", lineSpacingMultiple: 1.2, fit: "shrink" as any,
      });
    }
    footer(slide, d, num, total);
    return;
  }

  // ── numbered_list (default): numbered circles + row bg ──
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

  // Right: code panel — branched by archetype
  const codeArch = d.componentArchetypes?.code ?? "terminal_dark";
  const lang = slide_.codeLabel || "Code";

  if (codeArch === "editor_light") {
    // ── editor_light: accent-bordered panel, no traffic lights, skin-colored text ──
    const edBarH = 0.28;
    slide.addShape("roundRect" as any, {
      x: rightX, y: areaY, w: rightW, h: areaH,
      fill: { color: d.surface },
      line: { color: d.accent, width: 1.5 },
      rectRadius: 0.09,
    });
    // Accent top stripe
    slide.addShape("roundRect" as any, {
      x: rightX, y: areaY, w: rightW, h: edBarH,
      fill: { color: d.accent, transparency: 20 },
      rectRadius: 0.09,
    });
    slide.addShape("rect" as any, {
      x: rightX, y: areaY + edBarH / 2, w: rightW, h: edBarH / 2,
      fill: { color: d.accent, transparency: 20 },
    });
    // Right-side accent stripe
    slide.addShape("rect" as any, {
      x: rightX + rightW - 0.04, y: areaY, w: 0.04, h: areaH,
      fill: { color: d.accent, transparency: 80 },
    });
    // Language label
    slide.addText(san(lang), {
      x: rightX + 0.14, y: areaY + 0.04, w: rightW - 0.28, h: 0.20,
      fontSize: 9, fontFace: d.bodyFont, bold: true,
      color: d.accent, align: "left",
    });
    // Code text in skin color
    if (codeText) {
      slide.addText(sanCode(codeText), {
        x: rightX + 0.16, y: areaY + edBarH + 0.10,
        w: rightW - 0.28, h: areaH - edBarH - 0.18,
        fontSize: 11, fontFace: "Courier New",
        color: d.text,
        valign: "top", lineSpacingMultiple: 1.45, fit: "shrink" as any,
      });
    }
    footer(slide, d, num, total);
    return;
  }

  // ── terminal_dark (default): slate terminal with traffic lights ──
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

  const compArch = d.componentArchetypes?.comparison ?? "clean_columns";

  // ── split_panels: colored column headers + mini-card items ──
  if (compArch === "split_panels") {
    const hdrH = 0.42;
    const listY = CONTENT_Y + hdrH + 0.08;
    const listH = FOOTER_Y - listY - 0.08;
    const renderSplitCol = (colItems: string[], colX: number, colColor: string, label: string) => {
      // Header band
      slide.addShape("roundRect" as any, { x: colX, y: CONTENT_Y, w: colW, h: hdrH, fill: { color: colColor }, rectRadius: 0.08 });
      slide.addShape("rect" as any, { x: colX, y: CONTENT_Y + hdrH / 2, w: colW, h: hdrH / 2, fill: { color: colColor } });
      slide.addText(san(label).toUpperCase(), {
        x: colX + 0.10, y: CONTENT_Y, w: colW - 0.20, h: hdrH,
        fontSize: 11, fontFace: d.titleFont, bold: true,
        color: "FFFFFF", align: "center", valign: "middle", charSpacing: 2,
      });
      // Items as mini-cards
      const spGap = 0.08;
      const spH = Math.max(0.44, (listH - spGap * (colItems.length - 1)) / Math.max(colItems.length, 1));
      for (let i = 0; i < colItems.length; i++) {
        const y = listY + i * (spH + spGap);
        slide.addShape("roundRect" as any, {
          x: colX, y, w: colW, h: spH,
          fill: { color: d.surface }, line: { color: d.border, width: 0.3 }, rectRadius: 0.06,
        });
        slide.addShape("rect" as any, { x: colX, y, w: 0.04, h: spH, fill: { color: colColor, transparency: 30 } });
        slide.addText(san(colItems[i]), {
          x: colX + 0.14, y: y + 0.04, w: colW - 0.22, h: spH - 0.08,
          fontSize: colItems.length <= 3 ? 14 : 12, fontFace: d.bodyFont, color: d.text,
          valign: "middle", lineSpacingMultiple: 1.2, fit: "shrink" as any,
        });
      }
    };
    renderSplitCol(leftItems, ML, d.accent, "Grupo A");
    renderSplitCol(rightItems, ML + colW + 0.22, d.accent2, "Grupo B");
    // Center divider
    slide.addShape("rect" as any, { x: ML + colW + 0.09, y: CONTENT_Y, w: 0.04, h: FOOTER_Y - CONTENT_Y - 0.08, fill: { color: d.border } });
    footer(slide, d, num, total);
    return;
  }

  // ── subtle_table: alternating row tints, hairline dividers, no accent bars ──
  if (compArch === "subtle_table") {
    const maxRows = Math.max(leftItems.length, rightItems.length, 1);
    const stGap = 0.06;
    const stH = Math.max(0.44, (CONTENT_H - stGap * (maxRows - 1)) / maxRows);
    const divX = ML + colW + 0.11;
    for (let i = 0; i < maxRows; i++) {
      const y = CONTENT_Y + i * (stH + stGap);
      // Alternating row tint
      slide.addShape("rect" as any, {
        x: ML, y, w: CW, h: stH,
        fill: { color: i % 2 === 0 ? d.surface : d.bg, transparency: i % 2 === 0 ? 0 : 72 },
      });
      // Hairline row divider
      if (i < maxRows - 1) {
        slide.addShape("rect" as any, { x: ML, y: y + stH + stGap / 2 - 0.006, w: CW, h: 0.012, fill: { color: d.border } });
      }
      if (i < leftItems.length) {
        slide.addText(san(leftItems[i]), {
          x: ML + 0.10, y: y + 0.04, w: colW - 0.18, h: stH - 0.08,
          fontSize: maxRows <= 3 ? 14 : 12, fontFace: d.bodyFont, color: d.text,
          valign: "middle", lineSpacingMultiple: 1.2, fit: "shrink" as any,
        });
      }
      if (i < rightItems.length) {
        slide.addText(san(rightItems[i]), {
          x: divX + 0.10, y: y + 0.04, w: colW - 0.18, h: stH - 0.08,
          fontSize: maxRows <= 3 ? 14 : 12, fontFace: d.bodyFont, color: d.text,
          valign: "middle", lineSpacingMultiple: 1.2, fit: "shrink" as any,
        });
      }
    }
    // Column divider
    slide.addShape("rect" as any, { x: divX, y: CONTENT_Y, w: 0.022, h: maxRows * (stH + stGap), fill: { color: d.border } });
    footer(slide, d, num, total);
    return;
  }

  // ── clean_columns (default): accent bars per row, two-column list ──
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
  const restored = withBt.replace(
    /\[\[SQLW_(\d+)\]\]/g,
    (_m, idx: string) => sqlSlots[Number(idx)] ?? "",
  );

  // Final safety net (v5.1) — strip ANY residual placeholder marker that
  // survived the restore step (e.g. stale [[BT0]], [[BT1]] from prompt
  // examples baked into LLM output, orphan {{TOKEN}}, lorem ipsum, etc.)
  return restored
    .replace(/\[\[BT_?\d+\]\]/gi, "")
    .replace(/\[\[SQLW_?\d+\]\]/gi, "")
    .replace(/\[\[[A-Z_0-9]{2,}\]\]/g, "")
    .replace(/\{\{[A-Z_0-9]{2,}\}\}/g, "")
    .replace(/\blorem\s+ipsum\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Safe title: never cuts mid-word, max 60 chars by default
function sanitizeTitle(title: string, max = 60): string {
  let t = globalSanitize(title);
  // Remove leading colon (truncation artifact like ": Funções Avançadas")
  t = t.replace(/^:\s*/, "").trim();
  // Remove leading preposition that survived other filters
  t = t.replace(/^(e\s+|ou\s+|,\s*)/i, "").trim();
  if (!t) return "Conteúdo";
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
    .replace(/\bCompreender relacionamentos e Funções Avançadas\.?\b/gi,
             "Compreender relacionamentos entre tabelas e funções SQL avançadas")
    .replace(/\bRelacionamentos e Funções Avançadas\.?\b/gi,
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
const PLACEHOLDER_RE = /^\[.*\]$|^(TODO|TBD|PLACEHOLDER|CONTEÚDO AQUI|ITEM \d+|LOREM\s+IPSUM)$|\[\[[A-Z_0-9]+\]\]|\{\{[A-Z_0-9]+\}\}|\[\[BT_?\d+\]\]/i;
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

// ═══════════════════════════════════════════════════════════
// SECTION 5B: VISUAL PLANNER
// Pure-heuristic editorial layer. Defines INTENT and PACING for each
// slide so that chooseLayout can make richer, context-aware decisions.
// NO coordinates, NO AI calls, NO renderer changes.
// If createVisualPlan throws for any reason, chooseLayout falls back
// to its original behavior (plan=null path).
// ═══════════════════════════════════════════════════════════

interface SlideVisualPlan {
  slideId: string;
  intent: "educational" | "comparison" | "process" | "code" | "impact" | "summary" | "concept" | "example";
  emotionalWeight: "low" | "medium" | "high";
  focalElement: "title" | "code" | "big_number" | "comparison" | "steps" | "cards" | "none";
  pacingRole: "normal" | "visual_break" | "module_transition" | "deep_dive" | "recap";
  densityTolerance: "low" | "medium" | "high";
  preferredLayout?: string;
  fallbackLayouts?: string[];
}

/**
 * Build a SlideVisualPlan for a single slide given the preceding slides
 * and an optional module context string.
 * Pure heuristic — no AI, no side effects.
 */
function createVisualPlan(
  slide: Slide,
  prevSlides: Slide[],
  _moduleContext: string,
): SlideVisualPlan {
  const title  = (slide.title || "").toLowerCase();
  const useful = nonEmpty(slide.items);
  const n      = useful.length;
  const avgLen = n > 0 ? useful.reduce((a, t) => a + t.length, 0) / n : 0;
  const allHaveColon = n >= 2 && useful.every((t) => t.includes(": "));

  // ── Intent ────────────────────────────────────────────────
  const hasSqlContent      = slide.layout === "code" || useful.some((t) => SQL_ITEM_RE.test(t));
  const isComparisonTitle  = /\bvs\.?\b|versus|\bdiferença|\bcomparação|\bcontraste|\bantes.+depois\b|\bpros.+cons\b|\bvantagens.+desvan/i.test(title);
  const isProcessTitle     = /\bpasso\b|\betapa\b|\bsequência\b|\bciclo\b|\bpipeline\b|\bcomo funciona\b|\bfluxo\b|\bprocesso\b/i.test(title);
  const isSummaryTitle     = /\bresumo\b|\bconclusão\b|\btakeaway\b|\bo que (aprendemos|você aprendeu)\b|\bprincipais pontos\b|\brecap\b/i.test(title);
  const isConceptTitle     = /\bconceito\b|\bdefinição\b|\bo que [eé]\b|\bintrodução\b|\bfundamentos\b|\bvisão geral\b/i.test(title);
  const isExampleTitle     = /\bexemplo\b|\bcase study\b|\bestudo de caso\b|\bcenário\b|\bna prática\b/i.test(title);
  const hasImpactSignal    = n <= 3 && (
    useful.some((t) => /\d+\s*%|\d+x\b|\d{4,}\b/.test(t)) ||
    (avgLen < 60 && n <= 2 && useful.some((t) => /\b(sempre|nunca|obrigatório|crítico|essencial)\b/i.test(t)))
  );

  let intent: SlideVisualPlan["intent"] = "educational";
  if      (hasSqlContent)                                                  intent = "code";
  else if (slide.layout === "comparison" || isComparisonTitle)             intent = "comparison";
  else if (["process","timeline"].includes(slide.layout) || isProcessTitle) intent = "process";
  else if (slide.layout === "takeaways" || isSummaryTitle)                 intent = "summary";
  else if (hasImpactSignal)                                                intent = "impact";
  else if (isExampleTitle)                                                 intent = "example";
  else if (isConceptTitle)                                                 intent = "concept";

  // ── Emotional weight ───────────────────────────────────────
  let emotionalWeight: SlideVisualPlan["emotionalWeight"] = "low";
  if (intent === "impact" || /\bcrítico\b|\bmuito importante\b|\bnunca\b|\bsempre\b|\bobrigatório\b/i.test(title)) {
    emotionalWeight = "high";
  } else if (["comparison","process","example"].includes(intent)) {
    emotionalWeight = "medium";
  }

  // ── Focal element ──────────────────────────────────────────
  let focalElement: SlideVisualPlan["focalElement"] = "none";
  if      (intent === "code")                                               focalElement = "code";
  else if (intent === "comparison")                                         focalElement = "comparison";
  else if (intent === "process")                                            focalElement = "steps";
  else if (intent === "impact" && useful.some((t) => /\d+\s*%|\d+x\b|\d{4,}\b/.test(t))) focalElement = "big_number";
  else if (allHaveColon && n >= 2 && n <= 4)                               focalElement = "cards";
  else if (emotionalWeight === "high")                                      focalElement = "title";

  // ── Density tolerance ──────────────────────────────────────
  let densityTolerance: SlideVisualPlan["densityTolerance"] = "medium";
  if      (intent === "code" || slide.layout === "twocol") densityTolerance = "high";
  else if (intent === "impact" || emotionalWeight === "high") densityTolerance = "low";

  // ── Pacing role ────────────────────────────────────────────
  let pacingRole: SlideVisualPlan["pacingRole"] = "normal";
  if (["module_cover","closing"].includes(slide.layout)) {
    pacingRole = "module_transition";
  } else if (intent === "summary" || slide.layout === "takeaways") {
    pacingRole = "recap";
  } else if (intent === "code" || (n >= 6 && avgLen > 80)) {
    pacingRole = "deep_dive";
  } else if (prevSlides.length >= 2) {
    // Visual break: previous 2 slides both dense bullets/twocol
    const prevDense = prevSlides.slice(-2).every((s) => {
      const pi = nonEmpty(s.items);
      return (
        ["bullets","twocol"].includes(s.layout) &&
        pi.length >= 4 &&
        pi.reduce((a, t) => a + t.length, 0) / Math.max(pi.length, 1) > 70
      );
    });
    const prevSameLayout = prevSlides.slice(-2).every((s) => s.layout === slide.layout);
    if (
      (prevDense || prevSameLayout) &&
      !SKIP_HEURISTIC.includes(slide.layout as Layout)
    ) {
      pacingRole = "visual_break";
    }
  }

  // ── Preferred layout & fallbacks ──────────────────────────
  // Only set when slide is not in SKIP_HEURISTIC (structural slides)
  let preferredLayout: string | undefined;
  let fallbackLayouts: string[] | undefined;

  if (!SKIP_HEURISTIC.includes(slide.layout as Layout)) {
    if (intent === "process" && n >= 3 && n <= 5) {
      preferredLayout = "process";
      fallbackLayouts = ["timeline", "bullets"];
    } else if (intent === "comparison" && n >= 4) {
      preferredLayout = "twocol";
      fallbackLayouts = ["bullets", "cards"];
    } else if (intent === "impact" && n <= 3) {
      preferredLayout = "cards";
      fallbackLayouts = ["bullets"];
    } else if (intent === "example" && allHaveColon && n >= 2 && n <= 4) {
      preferredLayout = "cards";
      fallbackLayouts = ["process", "bullets"];
    } else if (intent === "concept" && n >= 4) {
      preferredLayout = "bullets";
      fallbackLayouts = ["diagram", "cards"];
    } else if (pacingRole === "visual_break") {
      preferredLayout = (n >= 2 && n <= 4) ? "cards" : "diagram";
      fallbackLayouts = ["process", "bullets"];
    } else if (focalElement === "cards") {
      preferredLayout = "cards";
      fallbackLayouts = ["bullets", "twocol"];
    }
  }

  return {
    slideId: `${(slide.title || "untitled").slice(0, 20)}_${slide.layout}`,
    intent,
    emotionalWeight,
    focalElement,
    pacingRole,
    densityTolerance,
    preferredLayout,
    fallbackLayouts,
  };
}

function chooseLayout(slide: Slide, prevLayouts: Layout[], plan?: SlideVisualPlan | null): Slide {
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
  // Comparison disabled — route contrasts to twocol for reliability
  else if (/\bvs\.?\b|versus|\bdiferença|\bcomparação|\bcontraste|\bantes.+depois\b|\bpros.+cons\b|\btipos de\b|\bmodelos de\b|\bDELETE vs\b|\bDROP vs\b|\bTRUNCATE vs\b|\bINNER.+LEFT\b|\bvantagens.+desvan/i.test(title)) {
    chosen = n >= 4 ? "twocol" : "cards";
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
  // ── Visual Plan guidance (activates only when existing heuristics left no signal) ──
  // Strong heuristics (SQL, comparison regex, process regex, 6+ items, allHaveColon)
  // already set chosen ≠ slide.layout. This branch only fires when chosen === slide.layout.
  else if (plan?.preferredLayout && !SKIP_HEURISTIC.includes(plan.preferredLayout as Layout)) {
    const preferred = plan.preferredLayout as Layout;
    const trial = { ...slide, layout: preferred };
    if (isRenderableSlide(trial)) {
      chosen = preferred;
    }
  }

  // ── Visual break: override dense layout for pacing ─────────────────
  // If plan says this slide should be a visual break, steer away from
  // dense layouts (bullets/twocol) toward lighter ones.
  if (plan?.pacingRole === "visual_break" && ["bullets","twocol"].includes(chosen)) {
    const breakAlts: Layout[] = (plan.fallbackLayouts as Layout[] | undefined) ?? ["cards","diagram"];
    for (const alt of breakAlts) {
      if (SKIP_HEURISTIC.includes(alt) || alt === chosen) continue;
      const t = { ...slide, layout: alt };
      if (isRenderableSlide(t)) {
        console.log(`[V5-VP] visual_break: "${slide.title}" ${chosen}→${alt}`);
        chosen = alt;
        break;
      }
    }
  }

  // ── Anti-repetition: 3 consecutive same-layout → force variety ──────
  // Uses plan.fallbackLayouts as first candidates before falling back to
  // the original static rules.
  if (
    chosen !== "code" &&
    prevLayouts.length >= 2 &&
    prevLayouts[prevLayouts.length - 1] === chosen &&
    prevLayouts[prevLayouts.length - 2] === chosen
  ) {
    let antiRepeatApplied = false;
    if (plan?.fallbackLayouts?.length) {
      for (const fb of plan.fallbackLayouts as Layout[]) {
        if (fb === chosen || SKIP_HEURISTIC.includes(fb)) continue;
        const t = { ...slide, layout: fb };
        if (isRenderableSlide(t)) {
          console.log(`[V5-VP] anti-repeat via plan: "${slide.title}" ${chosen}→${fb}`);
          chosen = fb;
          antiRepeatApplied = true;
          break;
        }
      }
    }
    if (!antiRepeatApplied) {
      if      (chosen === "bullets" && n >= 5) chosen = "twocol";
      else if (chosen === "bullets" && n >= 2) chosen = "cards";
      else if (chosen === "twocol")            chosen = "bullets";
      else if (chosen === "process")           chosen = "timeline";
      else if (chosen === "diagram")           chosen = "process";
      else                                     chosen = "bullets";
    }
  }

  if (chosen === slide.layout) return slide;

  // Guard: new layout must pass isRenderableSlide
  const candidate = { ...slide, layout: chosen as Layout };
  if (!isRenderableSlide(candidate)) return slide;

  console.log(
    `[V5] chooseLayout: "${slide.title}" ${slide.layout}→${chosen} (${n} items)` +
    (plan ? ` [intent=${plan.intent} pacing=${plan.pacingRole}]` : ""),
  );
  return candidate;
}

// ── LAYOUT VARIETY ENFORCEMENT ──
// Prevents more than 2 consecutive slides with the same layout
const VARIETY_SWAPPABLE: Layout[] = ["bullets", "twocol", "diagram"];

function applyLayoutVariety(slides: Slide[]): Slide[] {
  // Pass 1 — heuristic layout selection with visual plan guidance
  const withHeuristic: Slide[] = [];
  const history: Layout[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    // Build visual plan; any error falls back to null → old behavior
    let plan: SlideVisualPlan | null = null;
    try {
      plan = createVisualPlan(s, slides.slice(Math.max(0, i - 3), i), "");
    } catch (_) {
      /* visual plan is advisory — silent fallback */
    }
    const picked = chooseLayout(s, history, plan);
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
    // ── Comparison always → twocol (renderComparison disabled) ──
    if (s.layout === "comparison") {
      const lItems = nonEmpty(s.leftItems);
      const rItems = nonEmpty(s.rightItems);
      const combined = [...lItems, ...rItems]
        .map((t) => safeItemText(t, COMPARISON_MAX_CHARS))
        .slice(0, 8);
      console.log(`[V5] Comparison → twocol (disabled): "${s.title}" (l=${lItems.length} r=${rItems.length})`);
      out.push({
        ...s,
        layout: "twocol",
        items: combined.length >= 4 ? combined : [...combined, ...lItems.slice(0, 4 - combined.length)].slice(0, 4),
        leftItems: undefined,
        rightItems: undefined,
      });
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

// ═══════════════════════════════════════════════════════════
// SECTION 6B: TEMPLATE SYSTEM HELPERS
// ═══════════════════════════════════════════════════════════

// Regex that matches un-filled template placeholders like {{COURSE_TITLE}}, {{BULLET_1}}.
// NOTE: different from PLACEHOLDER_RE (line ~2662) which filters bad content items.
const TEMPLATE_PH_RE = /\{\{[A-Z_0-9]+\}\}/;

/**
 * Picks the best template for this course.
 * Falls back to "default_v5" when the selected template is unknown or
 * cannot paginate its TOC.  All other capacity overflows are handled
 * adaptively by splitSlidesForTemplate — they never force a fallback.
 */
function resolveTemplateForCourse(
  selectedTemplate: string,
  numModules: number,
): string {
  const key = selectedTemplate || "default_v5";
  const caps = TEMPLATE_CAPABILITIES[key];

  if (!caps) {
    console.log(`[V5-TEMPLATE] Unknown template "${key}", using default_v5`);
    return "default_v5";
  }
  if (key === "default_v5") return "default_v5";

  // Only hard-fallback when the template can't paginate TOC at all
  if (!caps.supportsPagination && numModules > caps.tocModules) {
    const fb = caps.fallback ?? "default_v5";
    console.log(
      `[V5-TEMPLATE] "${key}" cannot paginate TOC (${numModules} > ${caps.tocModules}) → fallback "${fb}"`,
    );
    return fb;
  }

  console.log(
    `[V5-TEMPLATE] Resolved template: "${key}" | modules=${numModules} | tocLimit=${caps.tocModules}`,
  );
  return key;
}

/**
 * Splits process / takeaways / cards slides that exceed template limits.
 * Never drops items — always distributes them across additional slides.
 * A single leftover card is converted to bullets to avoid a 1-card slide.
 */
function splitSlidesForTemplate(slides: Slide[], caps: TemplateCaps): Slide[] {
  const out: Slide[] = [];

  for (const s of slides) {
    if (s.layout === "process") {
      const items = (s.items ?? []).filter(Boolean);
      if (caps.processSteps > 0 && items.length > caps.processSteps) {
        const chunkCount = Math.ceil(items.length / caps.processSteps);
        for (let i = 0; i < items.length; i += caps.processSteps) {
          const chunk = items.slice(i, i + caps.processSteps);
          const part = Math.floor(i / caps.processSteps) + 1;
          out.push({
            ...s,
            title:
              chunkCount > 1 ? `${s.title} (${part}/${chunkCount})` : s.title,
            items: chunk,
          });
        }
        continue;
      }
    } else if (s.layout === "takeaways") {
      const items = (s.items ?? []).filter(Boolean);
      if (caps.takeaways > 0 && items.length > caps.takeaways) {
        for (let i = 0; i < items.length; i += caps.takeaways) {
          out.push({ ...s, items: items.slice(i, i + caps.takeaways) });
        }
        continue;
      }
    } else if (s.layout === "cards") {
      const items = (s.items ?? []).filter(Boolean);
      if (caps.cards > 0 && items.length > caps.cards) {
        for (let i = 0; i < items.length; i += caps.cards) {
          const chunk = items.slice(i, i + caps.cards);
          // A single orphan card renders poorly — convert to bullets
          out.push(
            chunk.length >= 2
              ? { ...s, items: chunk }
              : { ...s, layout: "bullets", items: chunk },
          );
        }
        continue;
      }
    }
    out.push(s);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// SECTION 6C: PPTX QA ENGINE
// Formal quality validation layer — runs after template splits,
// before final render.  Inspired by Design Validation Report.
// WARNINGs auto-fixed in-place; CRITICALs repaired or slide removed.
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// SECTION 5C: SCENE BLUEPRINT + HARD CONSTRAINTS + DOMAIN GUARD
// Architectural correction (v5.1) — adds an intermediate semantic layer
// between the LLM-generated Slide and the renderer, with explicit
// hard/soft constraint separation, domain contamination detection, a
// final placeholder sanitizer and Python/SQL code completeness checks.
//
// Hard constraints ALWAYS win over soft constraints. The qaVeto
// function (Section 6E) blocks the final export if any CRITICAL issue
// survives the resolution cascade.
// ═══════════════════════════════════════════════════════════

type ContentDomain =
  | "python"
  | "sql"
  | "javascript"
  | "java"
  | "data_analysis"
  | "business"
  | "marketing"
  | "design"
  | "legal"
  | "education"
  | "generic";

type SceneIntent =
  | "concept"
  | "example"
  | "code"
  | "process"
  | "comparison"
  | "summary"
  | "module_cover"
  | "toc"
  | "closing";

type ScenePriority = "low" | "medium" | "high";

type FocalElement =
  | "title"
  | "bullets"
  | "code"
  | "steps"
  | "cards"
  | "comparison"
  | "none";

interface HardConstraints {
  noPlaceholders:        true;
  noEmptySlides:         true;
  noIncompleteCode:      true;
  noDomainContamination: true;
  maxWords:              number;
  maxBullets:            number;
  maxCodeLines:          number;
  minFontSafe:           true;
  noFragmentTitle:       true;
  noGenericObjective:    true;
}

interface SoftConstraints {
  preferPremiumVisual: boolean;
  preferHero:          boolean;
  preferComparison:    boolean;
  preferCards:         boolean;
  preferLayoutBold:    boolean;
  preferVariation:     boolean;
}

interface SceneBlueprint {
  slideId:           string;
  moduleId:          string;
  courseTopic:       string;
  contentDomain:     ContentDomain;
  intent:            SceneIntent;
  priority:          ScenePriority;
  focalElement:      FocalElement;
  layoutCandidates:  Layout[];
  hardConstraints:   HardConstraints;
  softConstraints:   SoftConstraints;
}

const DEFAULT_HARD: HardConstraints = {
  noPlaceholders:        true,
  noEmptySlides:         true,
  noIncompleteCode:      true,
  noDomainContamination: true,
  maxWords:              80,
  maxBullets:             6,
  maxCodeLines:          12,
  minFontSafe:           true,
  noFragmentTitle:       true,
  noGenericObjective:    true,
};

const DEFAULT_SOFT: SoftConstraints = {
  preferPremiumVisual: true,
  preferHero:          false,
  preferComparison:    false,
  preferCards:         true,
  preferLayoutBold:    false,
  preferVariation:     true,
};

// ── Course-topic → ContentDomain inference ──────────────────
function inferCourseDomain(courseTopic: string, moduleTitle = ""): ContentDomain {
  const t = `${courseTopic} ${moduleTitle}`.toLowerCase();
  if (/\bpython\b|\bdjango\b|\bflask\b|\bpandas\b|\bnumpy\b/.test(t)) return "python";
  if (/\bsql\b|\bpostgres|\bmysql\b|\boracle\b|banco de dados|database/.test(t)) return "sql";
  if (/\bjavascript\b|\bnode\b|\breact\b|\btypescript\b|\bvue\b/.test(t)) return "javascript";
  if (/\bjava\b(?!\s*script)|spring\b|maven|gradle/.test(t)) return "java";
  if (/análise de dados|data analy|business intelligence|\bbi\b|power\s*bi/.test(t)) return "data_analysis";
  if (/marketing|publicidade|branding|propaganda/.test(t)) return "marketing";
  if (/design|ux|ui|figma|adobe/.test(t)) return "design";
  if (/jurídic|legal|direito|contrato/.test(t)) return "legal";
  if (/empresa|gestão|negóci|liderança|vendas/.test(t)) return "business";
  if (/educação|ensino|pedagog|didátic/.test(t)) return "education";
  return "generic";
}

// ── Domain-aware intent inference ──────────────────────────
function inferSceneIntent(slide: Slide): SceneIntent {
  if (slide.layout === "module_cover") return "module_cover";
  if (slide.layout === "toc")          return "toc";
  if (slide.layout === "closing")      return "closing";
  if (slide.layout === "code" || (slide.code && slide.code.trim().length > 0)) return "code";
  if (slide.layout === "comparison") return "comparison";
  if (slide.layout === "process" || slide.layout === "timeline") return "process";
  if (slide.layout === "takeaways") return "summary";
  const t = (slide.title || "").toLowerCase();
  if (/exemplo|caso|cenário|prática/.test(t)) return "example";
  return "concept";
}

function buildSceneBlueprint(
  slide: Slide,
  moduleId: string,
  moduleTitle: string,
  courseTopic: string,
  slideId: string,
): SceneBlueprint {
  const domain = inferCourseDomain(courseTopic, moduleTitle);
  const intent = inferSceneIntent(slide);
  const focalElement: FocalElement =
    intent === "code"          ? "code" :
    intent === "process"       ? "steps" :
    intent === "comparison"    ? "comparison" :
    nonEmpty(slide.items).length >= 4 ? "bullets" :
    nonEmpty(slide.items).length > 0   ? "cards" :
    slide.title                ? "title" : "none";
  const layoutCandidates: Layout[] = (() => {
    if (intent === "code")       return ["code", "twocol", "bullets"];
    if (intent === "process")    return ["process", "timeline", "diagram", "bullets"];
    if (intent === "comparison") return ["comparison", "twocol", "cards"];
    if (intent === "summary")    return ["takeaways", "bullets", "cards"];
    if (intent === "example")    return ["cards", "twocol", "bullets"];
    return [slide.layout, "bullets", "cards", "twocol"];
  })();
  const priority: ScenePriority =
    intent === "code" || intent === "comparison" ? "high" :
    intent === "module_cover" || intent === "summary" ? "medium" :
    "low";
  return {
    slideId,
    moduleId,
    courseTopic,
    contentDomain: domain,
    intent,
    priority,
    focalElement,
    layoutCandidates,
    hardConstraints: DEFAULT_HARD,
    softConstraints: DEFAULT_SOFT,
  };
}

// ── Domain contamination detector ──────────────────────────
// Returns true if a slide contains content from a foreign technical
// domain (e.g. SQL/DDL appearing inside a Python course module).
const SQL_DDL_RE = /\b(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE|CREATE\s+INDEX|CREATE\s+VIEW|FOREIGN\s+KEY|PRIMARY\s+KEY)\b/i;
const SQL_DML_RE = /\b(SELECT\s+\*|SELECT\s+\w+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|JOIN\s+\w+\s+ON)\b/i;
const PYTHON_HINTS_RE = /\b(def\s+\w+\s*\(|class\s+\w+|import\s+\w+|from\s+\w+\s+import|print\s*\(|elif\b|lambda\s+|self\.)/;
const JS_HINTS_RE = /\b(function\s+\w+\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|=>|console\.log|require\s*\()/;

// Strip line/block comments + string/template literals so we don't flag
// SQL/Python/JS keywords that only appear inside docstrings, examples,
// regex tutorials, etc.  This makes contamination detection conservative.
function stripCommentsAndStrings(code: string): string {
  return code
    // Python triple-quoted docstrings
    .replace(/'''[\s\S]*?'''/g, "")
    .replace(/"""[\s\S]*?"""/g, "")
    // C-family block comments
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // line comments (#, //, --)
    .replace(/(^|\s)#[^\n]*/g, "$1")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/--[^\n]*/g, "")
    // string literals
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

// Hard SQL DDL/DML patterns — keywords extremely unlikely to appear in
// legitimate prose of a non-SQL course. Scanned across title + items
// + code. v5.1.5 strengthening: also flags BARE uppercase SQL keywords
// (SELECT/INSERT/UPDATE/DELETE/JOIN) when they appear as standalone
// uppercase tokens — Python pedagogy uses lowercase verbs ("selecionar",
// "atualizar"), so uppercase SQL is foreign-domain leakage.
// HARD prose SQL — only phrases that are unambiguous SQL even in lowercase.
// Excludes "GROUP BY"/"ORDER BY"/bare "SELECT"/bare "JOIN" — these are too
// common in English prose ("group by length", "order by date", "select * from
// the list"). Those go to BARE_SQL_UPPER_RE (uppercase-only).
const HARD_SQL_PROSE_RE =
  /\b(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|FOREIGN\s+KEY|PRIMARY\s+KEY|REFERENCES\s+\w+\s*\()\b/i;
// v5.1.7 — Portuguese SQL DDL pedagogy phrases. Python courses NEVER discuss
// "criar tabela" / "alterar tabela" / "chave estrangeira" / "chave primária"
// in pedagogical prose. These are SQL-domain concepts.
const PT_SQL_DDL_RE =
  /\b(criar|alterar|remover|truncar|excluir)\s+tabela\b|\bchave\s+(estrangeira|prim[áa]ria)\b|\b(inserir|atualizar|deletar)\s+(em|na|de)\s+tabela\b|\bbanco\s+de\s+dados\s+relacional\b|\bschema\s+do\s+banco\b/i;
// Bare uppercase SQL — case-sensitive; only blocks ALL-CAPS variants.
// FROM/WHERE alone removed — too common in English prose ("FROM zero to hero").
const BARE_SQL_UPPER_RE =
  /(?<![A-Za-z])(SELECT|INSERT|UPDATE|DELETE|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|GROUP\s+BY|ORDER\s+BY|HAVING|UNION)(?![A-Za-z])/;

// v5.1.6: exhaustive string extraction — recursively pulls every
// string-valued field from a slide so SQL leakage can't hide inside
// nested arrays (caseStudy.phases, process.steps, cards, tableData...).
function extractAllStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 6) return out;
  if (value == null) return out;
  if (typeof value === "string") { if (value.trim()) out.push(value); return out; }
  if (Array.isArray(value)) {
    for (const v of value) extractAllStrings(v, out, depth + 1);
    return out;
  }
  if (typeof value === "object") {
    for (const k of Object.keys(value as Record<string, unknown>)) {
      // Skip known non-textual / structural keys to keep the pass fast.
      if (k === "layout" || k === "image" || k === "src" || k === "url" || k === "color") continue;
      extractAllStrings((value as Record<string, unknown>)[k], out, depth + 1);
    }
  }
  return out;
}

// v5.1.8 — GLOBAL FIELD SAFETY NET
// Runs ALL hard detectors against EVERY string field of EVERY slide via
// extractAllStrings(). This catches contamination/genericity that per-field
// QA checks miss (e.g. competencies on module_cover, cards.title/text,
// takeaways subtitle, comparison left/right text, process.steps).
// Returns issues with precise (slideId + matched substring) so qaVeto can
// hard-block AND the developer can see exactly which field escaped.
const MODULE_SQL_ALLOW_RE =
  /\bsql\b|banco de dados|\bbd\b|\bdatabase\b|\bquery\b|\bconsulta\b|postgres|mysql|oracle|sqlite|mariadb|nosql/i;
const MODULE_PYTHON_ALLOW_RE =
  /\bpython\b|pandas|numpy|django|flask|jupyter|scikit|matplotlib|seaborn|pytorch|tensorflow/i;

// v5.1.14 — DETERMINISTIC SQL STRIP for module covers (items + competencies)
// When the LLM ignores domain-integrity prompts and emits SQL DDL/DML inside
// a non-SQL course's module cover (e.g. "Criar tabelas com CREATE TABLE" in a
// Python "Estruturas de Dados" module), the safety net previously vetoed the
// whole export. Now we drop ONLY the offending strings so the cover survives.
// If a list goes empty after stripping, we leave it empty (renderer handles
// sparse covers; cleaner than fabricating fake content).
// v5.1.15 — broader SQL detection (Pass 14 missed bare DROP/TRUNCATE/CREATE/ALTER
// without "TABLE", and "banco de dados" without "relacional").
// v5.1.15 — exclude `_` and digits from the boundary so identifiers like
// `CREATE_ACTION`, `DROP_TABLE_NAME`, `ALTER2` (constants/var names that
// happen to embed an SQL verb) don't trip the detector.
const BARE_SQL_DDL_VERBS_RE =
  /(?<![A-Za-z0-9_])(DROP|TRUNCATE|CREATE|ALTER)(?![A-Za-z0-9_])/;
const BROADER_PT_DB_RE =
  /\b(banco\s+de\s+dados|tabela[s]?\s+(do\s+)?banco|colunas?\s+(da|de)\s+tabela|registros?\s+(da|na|de)\s+tabela|consulta[s]?\s+SQL)\b/i;

function isSqlContaminatedString(txt: string): boolean {
  if (!txt || typeof txt !== "string") return false;
  return HARD_SQL_PROSE_RE.test(txt) ||
    PT_SQL_DDL_RE.test(txt) ||
    BARE_SQL_UPPER_RE.test(txt) ||
    BARE_SQL_DDL_VERBS_RE.test(txt) ||
    BROADER_PT_DB_RE.test(txt);
}

// v5.1.15 — cross-module objective contamination
// Module 8 ("Boas Práticas e Implantação") receiving Module 1 objectives
// ("Utilizar variáveis, tipos primitivos..."). Detect when an advanced
// module title contains advanced/practice/deploy keywords AND an item
// mentions clearly basic-fundamental concepts.
const ADVANCED_MODULE_RE =
  /\b(boas\s+pr[áa]ticas|implanta[çc][ãa]o|deploy|avan[çc]ad[oa]s?|otimiza[çc][ãa]o|performance|ci\/cd|monitora|seguran[çc]a|refactor|arquitetura|escalabilidade)\b/i;
const BASIC_FUNDAMENTALS_RE =
  /\b(vari[áa]veis\s+(b[áa]sicas|e\s+tipos\s+primitivos|e\s+operadores\s+b[áa]sicos)|tipos\s+primitivos|primeiros\s+passos|hello\s+world|sintaxe\s+b[áa]sica|expressões\s+b[áa]sicas|atribuições\s+b[áa]sicas|operadores\s+b[áa]sicos|conceitos\s+iniciais)\b/i;

function isCrossModuleBasicLeak(txt: string, moduleTitle: string): boolean {
  if (!txt || !moduleTitle) return false;
  if (!ADVANCED_MODULE_RE.test(moduleTitle)) return false;
  return BASIC_FUNDAMENTALS_RE.test(txt);
}

// v5.1.15 — raw code leaking as bullet/text
// Slide 11 had `{pizza['nome']} - R${pizza['preco']:.2f}") print(...)` as
// a bullet item. Detect template-string / dangling-print / unbalanced
// quote patterns that reveal source-code fragments leaked into prose.
const RAW_CODE_LEAK_PATTERNS: RegExp[] = [
  /\{[a-zA-Z_]\w*\[['"][^'"]+['"]\][^}]*\}/,        // {var['key']:fmt}
  /["')]\s*print\s*\(/,                              // ") print(  or  ) print(
  /\bprint\s*\(\s*[fr]?["'][^"']*$/,                 // print("...   (unterminated)
  /\.\d+f\}["')]/,                                   // :.2f}")
  /\)\s*\.\s*print\s*\(/,                            // ).print(
];
function detectRawCodeLeak(text: string): boolean {
  if (!text || text.length < 8) return false;
  return RAW_CODE_LEAK_PATTERNS.some((re) => re.test(text));
}

// v5.1.15 — generalised contamination strip. Drops items matching ANY of:
//   - SQL leakage in non-SQL/non-DB module
//   - cross-module basic-fundamental leak in advanced module
//   - raw code leak (template strings, dangling print, etc.)
function stripSqlContaminationFromSlide(
  slide: Slide,
  courseDomain: ContentDomain,
  moduleTitle: string,
  slideId: string,
): Slide {
  const moduleAllowsSql = MODULE_SQL_ALLOW_RE.test(moduleTitle);
  const moduleAllowsPython = MODULE_PYTHON_ALLOW_RE.test(moduleTitle);
  const looksLikePython = courseDomain === "python" || moduleAllowsPython;
  const checkSql = (courseDomain !== "sql" && !moduleAllowsSql) || looksLikePython;

  const isContaminated = (t: string): string | null => {
    if (typeof t !== "string") return null;
    if (checkSql && isSqlContaminatedString(t)) return "sql";
    if (isCrossModuleBasicLeak(t, moduleTitle)) return "cross_module_basic";
    if (detectRawCodeLeak(t)) return "raw_code_leak";
    // v5.1.16 — last-resort drop for items that survived the repair pipeline
    // with structural damage (stripped function names, "com :", "com e", etc.)
    // or empty semantic-break shells like "(Ex: )" / "objeto ()" /
    // "Definir Classes: Usar com nome". These were previously emitted as HARD
    // CRITICAL by the safety net and vetoed the entire export. Strip-and-keep
    // is safer: the renderable-slide gate drops the slide if too few items
    // remain, but the rest of the deck survives.
    if (detectTechnicalDamage(t)) return "tech_damage_unrepaired";
    try {
      const inc = detectIncompleteTechnicalSentence(t);
      if (inc?.broken) return `semantic_break:${inc.key ?? "unknown"}`;
    } catch { /* defensive */ }
    return null;
  };

  const out = { ...slide } as Slide & { competencies?: string[] };
  let dropped = 0;
  const reasons: string[] = [];

  for (const key of ["items", "leftItems", "rightItems"] as const) {
    const arr = (out as unknown as Record<string, unknown>)[key];
    if (Array.isArray(arr)) {
      const before = arr.length;
      const cleaned = (arr as string[]).filter((t) => {
        const r = isContaminated(t);
        if (r) reasons.push(r);
        return r === null;
      });
      dropped += before - cleaned.length;
      (out as unknown as Record<string, unknown>)[key] = cleaned;
    }
  }
  const comps = (slide as Slide & { competencies?: string[] }).competencies;
  if (Array.isArray(comps)) {
    const before = comps.length;
    const cleaned = comps.filter((t) => {
      const r = isContaminated(t);
      if (r) reasons.push(r);
      return r === null;
    });
    dropped += before - cleaned.length;
    out.competencies = cleaned;
  }
  if (dropped > 0) {
    console.log(
      `[V5-CONTAM-STRIP] ${slideId} | "${moduleTitle}" | dropped=${dropped} reasons=[${reasons.join(",")}]`,
    );
  }
  return out;
}

function runGlobalFieldSafetyNet(
  allModuleSlides: Slide[][],
  courseDomain: ContentDomain,
  moduleTitlesArr: string[],
): QAIssue[] {
  const issues: QAIssue[] = [];
  for (let mi = 0; mi < allModuleSlides.length; mi++) {
    const moduleTitle = moduleTitlesArr[mi] ?? "";
    const moduleAllowsSql    = MODULE_SQL_ALLOW_RE.test(moduleTitle);
    const moduleAllowsPython = MODULE_PYTHON_ALLOW_RE.test(moduleTitle);
    const looksLikePython = courseDomain === "python" || moduleAllowsPython;
    const checkSql = (courseDomain !== "sql" && !moduleAllowsSql) || looksLikePython;

    for (let si = 0; si < allModuleSlides[mi].length; si++) {
      const s = allModuleSlides[mi][si];
      const id = `M${mi + 1}.S${si + 1}`;
      const title = s.title ?? id;
      const strs = extractAllStrings(s).filter((x) => !x.startsWith("[["));

      for (const txt of strs) {
        if (typeof txt !== "string" || txt.length < 4) continue;

        // ── SQL leakage in non-SQL course ────────────────────
        if (checkSql) {
          const m1 = HARD_SQL_PROSE_RE.exec(txt);
          if (m1) {
            issues.push({
              slideId: id, type: "DOMAIN_CONTAMINATION", severity: "CRITICAL",
              message: `[SAFETY-NET] SQL DDL/DML escapou em "${title}" — match="${m1[0].slice(0, 60)}" no campo "${txt.slice(0, 80)}"`,
              context: txt.slice(0, 160),
              resolutionStrategy: "Bloqueio absoluto — campo escapou do detector per-layout",
            });
            continue;
          }
          const m2 = PT_SQL_DDL_RE.exec(txt);
          if (m2) {
            issues.push({
              slideId: id, type: "DOMAIN_CONTAMINATION", severity: "CRITICAL",
              message: `[SAFETY-NET] Pedagogia SQL (PT) escapou em "${title}" — match="${m2[0].slice(0, 60)}" no campo "${txt.slice(0, 80)}"`,
              context: txt.slice(0, 160),
              resolutionStrategy: "Bloqueio absoluto",
            });
            continue;
          }
          const m3 = BARE_SQL_UPPER_RE.exec(txt);
          if (m3) {
            issues.push({
              slideId: id, type: "DOMAIN_CONTAMINATION", severity: "CRITICAL",
              message: `[SAFETY-NET] SQL keyword UPPERCASE escapou em "${title}" — match="${m3[0].slice(0, 60)}" no campo "${txt.slice(0, 80)}"`,
              context: txt.slice(0, 160),
              resolutionStrategy: "Bloqueio absoluto",
            });
            continue;
          }
        }

        // (Generic-objective check moved out of the per-string loop —
        //  it runs only on items/competencies below to avoid false
        //  positives on cover titles that legitimately start with verbs.)

        // ── Broken Portuguese language ────────────────────────
        const broken = detectBrokenNaturalLanguage(txt);
        if (broken.broken) {
          issues.push({
            slideId: id, type: "BROKEN_LANGUAGE_STRUCTURE", severity: "CRITICAL",
            message: `[SAFETY-NET] Linguagem quebrada em "${title}" (${broken.describe}): "${txt.slice(0, 80)}"`,
            context: txt.slice(0, 160),
            resolutionStrategy: "Bloqueio absoluto",
          });
        }

        // ── Unresolved technical damage ("verb ()", ", ,", "Use e .") ──
        if (detectTechnicalDamage(txt)) {
          issues.push({
            slideId: id, type: "TECHNICAL_SANITIZATION_DAMAGE", severity: "CRITICAL",
            message: `[SAFETY-NET] Dano técnico não reparado em "${title}": "${txt.slice(0, 80)}"`,
            context: txt.slice(0, 160),
            resolutionStrategy: "Bloqueio absoluto — repair determinístico falhou",
          });
        }

        // ── Incomplete technical sentence ─────────────────────
        const inc = detectIncompleteTechnicalSentence(txt);
        if (inc.broken) {
          issues.push({
            slideId: id, type: "TECHNICAL_SEMANTIC_BREAK", severity: "CRITICAL",
            message: `[SAFETY-NET] Frase técnica incompleta em "${title}" (${inc.key}): "${txt.slice(0, 80)}"`,
            context: txt.slice(0, 160),
            resolutionStrategy: "Bloqueio absoluto",
          });
        }
      }

      // ── Generic objective check: ONLY items + competencies on module_cover ──
      // Restricted to objective-bearing fields to avoid false positives on
      // titles that legitimately start with verbs ("Aplicar Loops em Python").
      if (s.layout === "module_cover") {
        const sCov = s as Slide & { competencies?: string[] };
        const objFields = [
          ...(Array.isArray(s.items) ? s.items : []),
          ...(Array.isArray(sCov.competencies) ? sCov.competencies : []),
        ];
        for (const txt of objFields) {
          if (typeof txt !== "string" || txt.length < 4) continue;
          if (isGenericLearningObjective(txt, moduleTitle)) {
            issues.push({
              slideId: id, type: "GENERIC_LEARNING_OBJECTIVE", severity: "CRITICAL",
              message: `[SAFETY-NET] Objetivo genérico escapou em "${title}": "${txt.slice(0, 100)}"`,
              context: txt.slice(0, 160),
              resolutionStrategy: "Bloqueio absoluto — repair não atingiu o campo",
            });
          }
        }
      }
    }
  }
  return issues;
}

function detectDomainContamination(
  slide: Slide,
  domain: ContentDomain,
  moduleTitle: string,
): { contaminated: boolean; reason?: string } {
  // Module/course allow-lists — ecosystem-aware.
  const moduleAllowsSql =
    /\bsql\b|banco de dados|\bbd\b|\bdatabase\b|\bquery\b|\bconsulta\b|postgres|mysql|oracle|sqlite|mariadb|nosql/i.test(moduleTitle);
  const moduleAllowsPython =
    /\bpython\b|pandas|numpy|django|flask|jupyter|scikit|matplotlib|seaborn|pytorch|tensorflow/i.test(moduleTitle);
  const moduleAllowsJs =
    /\bjavascript\b|\btypescript\b|\bnode\b|\bnodejs\b|\breact\b|\bvue\b|\bnext\b|\bnuxt\b|\bangular\b|\bdeno\b/i.test(moduleTitle);

  // v5.1.6: also infer python from module title/slide content even when
  // courseDomain is "generic" (e.g. when the course title doesn't have
  // "Python" but a module clearly does). This makes the SQL block
  // ABSOLUTE for any python module regardless of inferred domain.
  const looksLikePython = domain === "python" || moduleAllowsPython;

  // ── Layer 1: HARD prose check (EXHAUSTIVE — all string fields) ───
  // Concatenates EVERY string-valued field reachable in the slide, not
  // just title/items. Catches SQL leaking into process.steps, cards,
  // caseStudy.phases, tableData, etc.
  if ((domain !== "sql" && !moduleAllowsSql) || looksLikePython) {
    const allStrs = extractAllStrings(slide).filter((s) => !s.startsWith("[[")); // skip protected slots
    const proseText = allStrs.join("\n");
    const sample = (m: RegExpExecArray | null) => m ? m[0].slice(0, 80) : "";
    const m1 = HARD_SQL_PROSE_RE.exec(proseText);
    if (m1) {
      console.log(`[V5-DOMAIN-BLOCK] SQL DDL/DML detected in ${looksLikePython ? "python" : domain} module "${moduleTitle}" | match="${sample(m1)}" | title="${slide.title ?? ""}"`);
      return { contaminated: true, reason: `SQL DDL/DML em prose de curso ${domain} ("${sample(m1)}")` };
    }
    const m2 = BARE_SQL_UPPER_RE.exec(proseText);
    if (m2) {
      console.log(`[V5-DOMAIN-BLOCK] Bare uppercase SQL detected in ${looksLikePython ? "python" : domain} module "${moduleTitle}" | match="${sample(m2)}" | title="${slide.title ?? ""}"`);
      return { contaminated: true, reason: `SQL bare keywords em prose de curso ${domain} ("${sample(m2)}")` };
    }
    // v5.1.7: Portuguese SQL pedagogy phrases — block in non-SQL/python courses
    const m3 = PT_SQL_DDL_RE.exec(proseText);
    if (m3) {
      console.log(`[V5-DOMAIN-BLOCK] Portuguese SQL pedagogy detected in ${looksLikePython ? "python" : domain} module "${moduleTitle}" | match="${sample(m3)}" | title="${slide.title ?? ""}"`);
      return { contaminated: true, reason: `Pedagogia SQL (PT) em curso ${domain} ("${sample(m3)}")` };
    }
  }
  if (domain === "generic" && !looksLikePython) return { contaminated: false };

  // ── Layer 2: code-block analysis (only when slide has code) ─
  if (!slide.code || !slide.code.trim()) return { contaminated: false };
  const sanitisedCode = stripCommentsAndStrings(slide.code);
  if (!sanitisedCode.trim()) return { contaminated: false };

  if (domain !== "sql" && !moduleAllowsSql) {
    if (SQL_DDL_RE.test(sanitisedCode)) return { contaminated: true, reason: `SQL DDL em curso ${domain}` };
    if (SQL_DML_RE.test(sanitisedCode)) return { contaminated: true, reason: `SQL DML em curso ${domain}` };
  }
  if (domain !== "python" && !moduleAllowsPython) {
    if (PYTHON_HINTS_RE.test(sanitisedCode)) return { contaminated: true, reason: `Código Python em curso ${domain}` };
  }
  if (domain !== "javascript" && !moduleAllowsJs) {
    if (JS_HINTS_RE.test(sanitisedCode)) return { contaminated: true, reason: `Código JS em curso ${domain}` };
  }
  return { contaminated: false };
}

// ── Generic learning objective detector (v5.1 hardening) ────
// Catches non-pedagogical bullets like "Compreender X", "Aplicar X",
// "Identificar X" where X is just a fragment of the module title and
// no concrete technical verb/operation is present.
const FILLER_VERBS_RE =
  /^(compreender|conhecer|entender|aprender|saber|estudar|explorar|descobrir|aplicar|identificar|reconhecer|familiarizar(-se)?|introduzir|apresentar|abordar|revisar)\s+/i;

const CONCRETE_TECH_VERBS_RE =
  /\b(criar|definir|implementar|construir|configurar|instalar|executar|chamar|invocar|escrever|ler|abrir|fechar|salvar|carregar|importar|exportar|inserir|atualizar|remover|deletar|consultar|filtrar|agrupar|ordenar|tratar|capturar|lançar|gerar|retornar|receber|enviar|conectar|autenticar|validar|testar|depurar|iterar|percorrer|mapear|reduzir|filtrar|combinar|comparar|calcular|somar|contar|converter|serializar|desserializar|parsear|formatar|renderizar|publicar|fazer\s+deploy|usar|utilizar|manipular)\b/i;

const CONCRETE_TECH_NOUNS_RE =
  /\b(função|funções|método|métodos|classe|classes|objeto|objetos|variável|variáveis|lista|listas|dicionário|dicionários|tupla|tuplas|conjunto|conjuntos|array|arrays|loop|loops|for|while|if|else|try|except|finally|with|lambda|map|filter|reduce|comprehension|decorador|generator|iterator|módulo|pacote|biblioteca|framework|api|endpoint|requisição|resposta|json|csv|xml|sql|select|insert|update|delete|join|índice|tabela|coluna|chave|exceção|erro|log|teste|unitário|integração|debug|depuração|parâmetro|argumento|retorno|callback|promise|async|await|thread|processo|arquivo|diretório|stream|buffer|socket|http|tcp|udp|rest|graphql)\b/i;

function isGenericLearningObjective(text: string, moduleTitle: string): boolean {
  if (!text || text.length < 10) return false;
  const t = text.trim();

  // Only items that BEGIN with a filler verb are candidates for generic.
  if (!FILLER_VERBS_RE.test(t)) return false;

  const tail = t.replace(FILLER_VERBS_RE, "").trim();
  const hasConcreteVerb = CONCRETE_TECH_VERBS_RE.test(tail);
  const hasConcreteNoun = CONCRETE_TECH_NOUNS_RE.test(tail);

  // v5.1.7 — STRICTER: filler verbs ("Compreender", "Aplicar", "Identificar")
  // are pedagogically vague by themselves. The presence of a tech NOUN alone
  // ("Aplicar Funções", "Identificar testes") is just topic restatement, not
  // a concrete actionable objective. We require either:
  //   (a) a concrete tech VERB in the tail ("Aplicar criar funções"), OR
  //   (b) a purpose clause + concrete content ("Aplicar listas para armazenar").
  // Otherwise the item is generic — block it.

  // Pattern 1: filler + concrete VERB → not generic (truly actionable).
  if (hasConcreteVerb) return false;

  // Pattern 2: filler + purpose clause + concrete noun → not generic
  // ("Aplicar listas para armazenar dados").
  const hasPurposeClause = /\b(para|com|usando|através|via|de\s+modo|de\s+forma|a\s+fim\s+de)\b/i.test(tail);
  if (hasPurposeClause && hasConcreteNoun) return false;

  // Pattern 3 (v5.1.12) — filler + <concrete concept> + "em/no/na <objeto técnico>"
  // ACCEPTS: "Aplicar escopo local e global em funções Python"
  //          "Aplicar herança e encapsulamento em classes Python"
  // BLOCKS:  "Compreender conceitos sobre funções"  (filler noun before prep)
  //          "Aplicar fundamentos em classes"        (filler noun before prep)
  //          "Aplicar IA em saúde"                   (no tech noun after prep)
  // "sobre" was removed — it usually marks topic restatement, not application
  // context. `dentro d[aeo]s?` now covers da/de/do/das/des/dos.
  const APPLICATION_PREP_RE = /\b(em|no|na|nos|nas|dentro\s+d[aeo]s?)\s+/i;
  const FILLER_NOUNS_RE =
    /^(conceitos?|fundamentos?|princípios?|princip|noções?|aspectos?|elementos?|tópicos?|temas?|bases?|ideias?|teorias?|introdução|visão\s+geral|panorama|generalidades?)\b/i;
  const appMatch = tail.match(APPLICATION_PREP_RE);
  if (appMatch && appMatch.index !== undefined) {
    const beforePrep = tail.slice(0, appMatch.index).trim();
    const afterPrep = tail.slice(appMatch.index + appMatch[0].length);
    // BEFORE-prep must be a real concept, not a filler noun stub.
    const beforeWords = beforePrep.split(/\s+/).filter(Boolean);
    const beforeIsFillerStub =
      beforePrep.length === 0 ||
      (FILLER_NOUNS_RE.test(beforePrep) && beforeWords.length <= 2);
    // AFTER-prep must contain a concrete technical noun.
    if (!beforeIsFillerStub && CONCRETE_TECH_NOUNS_RE.test(afterPrep)) return false;
  }

  // All remaining filler-led items lacking actionable content are generic.
  // This catches:
  //   "Compreender fundamentos Essenciais de Python."   (no verb, no noun)
  //   "Aplicar controle de Fluxo e Funções."           (noun only, no verb, no purpose)
  //   "Identificar testes, Logs e Depuração."          (noun only, no verb, no purpose)
  //   "Conhecer estruturas de dados básicas."          (no verb, weak noun without purpose)
  return true;
}

// ── Technical-sanitization damage detector (v5.1 hardening) ─
// Detects the SPECIFIC symptom of stripped function calls: orphan empty
// parens following a Portuguese action word that pedagogical content
// would normally pair with a function name. Examples we want to catch:
//   "Realize leitura () e escrita ()."   ← read()/write() were stripped
//   "Use a função () para ..."          ← function name was stripped
//   "Chame . () no objeto"               ← method call dot+name stripped
// Examples we must NOT flag (legitimate prose):
//   "Use parênteses () para agrupar expressões."
//   "Explique a notação callback () no pseudocódigo."
//
// Strategy: only trigger when the empty parens follow one of a small set
// of "calling" verbs/nouns AND the surrounding text doesn't explicitly
// reference the parentheses themselves as a topic.
const CALLING_TRIGGER_WORDS = [
  "leitura", "escrita", "abertura", "fechamento", "execução", "execucao",
  "invocação", "invocacao", "chamada", "definição", "definicao",
  "função", "funcao", "método", "metodo",
  "ler", "escrever", "abrir", "fechar", "executar", "invocar", "chamar",
];
const DAMAGED_CALL_RE = new RegExp(
  `\\b(${CALLING_TRIGGER_WORDS.join("|")})\\s+\\(\\s*\\)`,
  "i",
);
const DAMAGED_DOT_RE = /\b\w+\s*\.\s*\(\s*\)/;        // "obj. ()" — method call w/ name stripped
const DAMAGED_DOUBLE_PARENS_RE = /\b(?:e|ou|,)\s+\(\s*\)/i; // "..., ()" or "... e ()"

// ── PUNCTUATION-only damage (no parens) ─────────────────────
// Catches: "Estruture em , , , .", "Use e .", "Use X e ."
// Symptom: words got stripped, leaving orphan punctuation/conjunctions.
const ORPHAN_COMMAS_RE = /,\s*,/;
const ORPHAN_CONJ_PERIOD_RE = /\s(e|ou)\s+\.(\s|$)/i;
const STRIPPED_VERB_PHRASE_RE =
  /\b(use|usar|chame|chamar|invoque|invocar|execute|executar|defina|definir|configure|configurar|estruture|estruturar|importe|importar|crie|criar)\s+(?:\w+\s+)?(?:e|ou)\s+\.(\s|$)/i;
// "X em : ." or ": ." (colon then nothing meaningful) at end of sentence
const STRIPPED_TAIL_AFTER_COLON_RE = /:\s*[,\s\.]+$/;
// (Removed STRIPPED_ENUMERATION_AFTER_PREP_RE — too broad. The ", ,"
//  pattern covered by ORPHAN_COMMAS_RE catches the real damage case
//  "em , , , ." while normal enumerations like "em módulos, classes."
//  contain only single commas between words and are correctly ignored.)

// Topics that legitimately discuss empty parens — exempt from damage flag.
const PARENS_TOPIC_RE = /\bparêntese|\bparentese|\bnotação|\bnotacao|\bsintaxe\b|\bsímbolo|\bsimbolo\b/i;

// v5.1.15 — additional gap patterns from Pass 15 user report:
//   "Usar modos de abertura , e 'a' corretamente."  → STRIPPED_LEADING_COMMA_RE
//   "Definir classes com e atributos no ."          → BARE_COM_E_RE / NO_DOT_TAIL_RE
//   "Organizar testes em classes e métodos ."       → TRAILING_NOUN_DOT_RE
//   "Testes Unitários com : Crie classes..."        → COM_COLON_GAP_RE
const STRIPPED_LEADING_COMMA_RE = /[a-zA-ZÀ-ÿ]\s+,\s+/;          // word + space + ", "
const BARE_COM_E_RE = /\bcom\s+e\s+[a-zA-ZÀ-ÿ]/;                  // "com e atributos"
const NO_DOT_TAIL_RE = /\b(no|na|nos|nas|de|do|da)\s*\.\s*$/i;    // "no ."
const TRAILING_NOUN_DOT_RE = /\b(m[ée]todos|classes|fun[çc][õo]es|atributos|par[âa]metros|argumentos|m[óo]dulos)\s+\.\s*$/i;
const COM_COLON_GAP_RE = /\bcom\s*:\s*[A-ZÀ-Ÿ]/;                  // "com : Crie"

function detectTechnicalDamage(text: string): boolean {
  // Min length 6 — catches short stripped phrases like "Use e ." (7 chars).
  if (!text || text.length < 6) return false;
  // Exempt prose that explicitly discusses parens/notation/syntax as a topic.
  if (PARENS_TOPIC_RE.test(text)) return false;

  // ── Empty-parens damage ───────────────────────────────────
  // Calling verb/noun directly followed by "()" with no name in between.
  if (DAMAGED_CALL_RE.test(text)) return true;
  // Method-call dot pattern with stripped name.
  if (DAMAGED_DOT_RE.test(text)) return true;
  // Conjunction followed by isolated "()" — pattern of two stripped calls.
  if (DAMAGED_DOUBLE_PARENS_RE.test(text)) return true;

  // ── Orphan-punctuation damage (no parens) ─────────────────
  // ", ," — at least one list item was stripped.
  if (ORPHAN_COMMAS_RE.test(text)) return true;
  // "Use e ." or "Use X e ." — enumeration verb missing trailing item.
  if (STRIPPED_VERB_PHRASE_RE.test(text)) return true;
  // " e ." / " ou ." — conjunction followed by period (item after conj stripped).
  if (ORPHAN_CONJ_PERIOD_RE.test(text)) return true;
  // ": ." or ": , , ." — colon then nothing meaningful after.
  if (STRIPPED_TAIL_AFTER_COLON_RE.test(text)) return true;

  // ── v5.1.15 new gap patterns ──────────────────────────────
  if (STRIPPED_LEADING_COMMA_RE.test(text)) return true;
  if (BARE_COM_E_RE.test(text)) return true;
  if (NO_DOT_TAIL_RE.test(text)) return true;
  if (TRAILING_NOUN_DOT_RE.test(text)) return true;
  if (COM_COLON_GAP_RE.test(text)) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════
// SEMANTIC BREAK DETECTOR (v5.1.5 hardening pass 5)
// Detects sentences whose syntax is intact but whose meaning was
// destroyed by sanitization — e.g. "Capture erros específicos como.",
// "Verifica partes isoladas com.", "Definir Classes: Usar com nome
// (Ex: ).". These pass detectTechnicalDamage (no orphan parens, no
// orphan commas) but are pedagogically broken.
// ═══════════════════════════════════════════════════════════

// Pattern → (matcher, repair-context-key). Repair attempts come from
// the per-domain dictionaries below.
type SemanticBreakPattern = {
  re: RegExp;
  key: string;          // semantic kind (used to look up repair phrases)
  describe: string;     // human-readable name for logging
};

const SEMANTIC_BREAK_PATTERNS: SemanticBreakPattern[] = [
  // ── Truncated terminal connectives ──────────────────────────
  // "...específicos como." / "...trate como."
  { re: /\b(como|tais\s+como|tipo|tipos\s+de|exemplos?\s+de)\s*\.\s*$/i,
    key: "trailing_as_example", describe: "termina com 'como.'" },
  // "...partes isoladas com." / "...trabalha com."
  { re: /\b(com|usando|através\s+de|via|por\s+meio\s+de)\s*\.\s*$/i,
    key: "trailing_with_tool", describe: "termina com 'com.' ou 'usando.'" },
  // "...feito a partir de."
  { re: /\b(a\s+partir\s+de|para|de)\s*\.\s*$/i,
    key: "trailing_preposition", describe: "termina com preposição isolada" },

  // ── Empty parenthetical examples ────────────────────────────
  // "(Ex: )" / "(Exemplo: )" / "(ex: ).
  { re: /\(\s*(?:ex|exemplo|exemplos|por\s*ex|p\.\s*ex)\s*[:.]?\s*\)/i,
    key: "empty_example_parens", describe: "(Ex: ) sem exemplo" },
  // "Ex: ." / "Exemplo: ." (no parens)
  { re: /\b(?:ex|exemplo|exemplos)\s*:\s*\.(\s|$)/i,
    key: "empty_example_colon", describe: "Ex: . sem exemplo" },

  // ── Anonymous "Usar com nome" / "objeto ()" patterns ────────
  // "Usar com nome (Ex: )" / "Definir com nome"
  { re: /\busa(?:r|ndo)?\s+com\s+nome\b/i,
    key: "use_with_name", describe: "'Usar com nome' sem keyword" },
  // "Inicializa atributos do objeto ()" — pseudo-call with empty parens
  { re: /\bobjeto\s*\(\s*\)/i,
    key: "object_empty_parens", describe: "objeto () pseudo-chamada" },
  // "Criar Construtor :" — colon without method body indication
  { re: /\bcriar\s+construtor\s*:/i,
    key: "create_constructor_label", describe: "Criar Construtor sem __init__()" },
  // "Definir Classes:" or "Definir Classe :" without keyword
  { re: /\bdefinir\s+classes?\s*:\s*usar\b(?!.*\bclass\b)/i,
    key: "define_classes_no_class", describe: "Definir Classes sem keyword 'class'" },

  // ── Generic verb stranded by missing complement ─────────────
  // "Verifica partes isoladas." (verb + isolated noun + period, no tool)
  // — only flagged when a known "X com Y" framing got truncated to "X."
  { re: /\b(verifica|valida|testa|garante|assegura|implementa)\s+\w+(?:\s+\w+){0,3}\s+com\s*\.\s*$/i,
    key: "verb_isolated_with_dot", describe: "verbo + 'com.' truncado" },
];

function detectIncompleteTechnicalSentence(
  text: string,
): { broken: boolean; key?: string; describe?: string } {
  if (!text || text.length < 8) return { broken: false };
  // Exempt prose explicitly discussing parentheses/notation as a topic
  if (PARENS_TOPIC_RE.test(text)) return { broken: false };
  for (const p of SEMANTIC_BREAK_PATTERNS) {
    if (p.re.test(text)) {
      return { broken: true, key: p.key, describe: p.describe };
    }
  }
  return { broken: false };
}

// ── Domain-aware semantic reconstructions ───────────────────
// For each (domain, pattern_key) we provide a substitution function.
// If no rule matches, returns null and the field stays broken (will be
// blocked by qaVeto via TECHNICAL_SEMANTIC_BREAK).

type SemanticRepairFn = (text: string) => string | null;

function detectModuleDomainPython(moduleTitle: string, courseTopic: string): string {
  const t = `${moduleTitle} ${courseTopic}`.toLowerCase();
  if (/\barquivos?|\bfiles?\b|\bi\/o\b|\bleitura|\bescrita/.test(t)) return "py_files";
  if (/\bclasses?|\boop\b|\bobjetos?|\bherança|\bencapsul/.test(t)) return "py_oop";
  if (/\btestes?|\bunittest|\bpytest|\btdd\b/.test(t)) return "py_tests";
  if (/\bexce[çc][õo]es?|\berros?|\btry|\bexcept/.test(t)) return "py_errors";
  if (/\bfunções?|\bfunctions?|\bdef\b/.test(t)) return "py_functions";
  if (/\bestruturas?\s+de\s+dados|listas?|dicionários?|tuplas?|conjuntos?/.test(t)) return "py_datastructs";
  if (/\bcontrole\s+de\s+fluxo|condicionais|laços|loops|while|for/.test(t)) return "py_flow";
  if (/\bvariáveis|\btipos\s+primitivos|\boperadores|\bfundamentos|introdução/.test(t)) return "py_basics";
  return "py_generic";
}

const SEMANTIC_REPAIRS: Record<string, Record<string, SemanticRepairFn>> = {
  // ── Python • Errors / Exceptions ──────────────────────────
  py_errors: {
    trailing_as_example: (t) =>
      t.replace(/\b(como|tais\s+como)\s*\.\s*$/i, "como `FileNotFoundError` e `IOError`."),
    trailing_with_tool: (t) =>
      t.replace(/\bcom\s*\.\s*$/i, "com `try`/`except`."),
    trailing_preposition: null as unknown as SemanticRepairFn,
    verb_isolated_with_dot: (t) =>
      t.replace(/\bcom\s*\.\s*$/i, "com `try`/`except`."),
  },
  // ── Python • Classes / OOP ────────────────────────────────
  py_oop: {
    use_with_name: (t) =>
      t.replace(/\busa(r|ndo)?\s+com\s+nome\b/i, "usar `class` seguido do nome da classe"),
    define_classes_no_class: (t) =>
      t.replace(/\bdefinir\s+classes?\s*:\s*usar\b/i, "Definir Classes: usar `class` seguido do nome"),
    empty_example_parens: (t) =>
      t.replace(/\(\s*(?:ex|exemplo|exemplos|por\s*ex|p\.\s*ex)\s*[:.]?\s*\)/i, "(Ex: `class Livro:`)"),
    empty_example_colon: (t) =>
      t.replace(/\b(ex|exemplo|exemplos)\s*:\s*\.(\s|$)/i, "$1: `class Livro:`.$2"),
    object_empty_parens: (t) =>
      t.replace(/\bobjeto\s*\(\s*\)/i, "objeto"),
    create_constructor_label: (t) =>
      t.replace(/\bcriar\s+construtor\s*:/i, "Criar Construtor `__init__()`:"),
    trailing_as_example: (t) =>
      t.replace(/\b(como|tais\s+como)\s*\.\s*$/i, "como `__init__()` e atributos."),
    trailing_with_tool: (t) =>
      t.replace(/\bcom\s*\.\s*$/i, "com `class` e `__init__()`."),
  },
  // ── Python • Tests ────────────────────────────────────────
  py_tests: {
    trailing_with_tool: (t) =>
      t.replace(/\bcom\s*\.\s*$/i, "com `unittest` ou `pytest`."),
    verb_isolated_with_dot: (t) =>
      t.replace(/\bcom\s*\.\s*$/i, "com `unittest` ou `pytest`."),
    trailing_as_example: (t) =>
      t.replace(/\b(como|tais\s+como)\s*\.\s*$/i, "como `assertEqual()` e `assertTrue()`."),
    empty_example_parens: (t) =>
      t.replace(/\(\s*(?:ex|exemplo|exemplos|por\s*ex|p\.\s*ex)\s*[:.]?\s*\)/i, "(Ex: `assertEqual(a, b)`)"),
    empty_example_colon: (t) =>
      t.replace(/\b(ex|exemplo|exemplos)\s*:\s*\.(\s|$)/i, "$1: `assertEqual(a, b)`.$2"),
  },
  // ── Python • Files / I/O ──────────────────────────────────
  py_files: {
    trailing_with_tool: (t) =>
      t.replace(/\bcom\s*\.\s*$/i, "com `open()` e `with`."),
    trailing_as_example: (t) =>
      t.replace(/\b(como|tais\s+como)\s*\.\s*$/i, "como `'r'`, `'w'` e `'a'`."),
    empty_example_parens: (t) =>
      t.replace(/\(\s*(?:ex|exemplo|exemplos|por\s*ex|p\.\s*ex)\s*[:.]?\s*\)/i, "(Ex: `open('file.txt', 'r')`)"),
  },
  // ── Python • Functions ────────────────────────────────────
  py_functions: {
    trailing_with_tool: (t) =>
      t.replace(/\bcom\s*\.\s*$/i, "com `def` e parâmetros."),
    trailing_as_example: (t) =>
      t.replace(/\b(como|tais\s+como)\s*\.\s*$/i, "como `def`, `return` e parâmetros."),
    empty_example_parens: (t) =>
      t.replace(/\(\s*(?:ex|exemplo|exemplos|por\s*ex|p\.\s*ex)\s*[:.]?\s*\)/i, "(Ex: `def soma(a, b): return a + b`)"),
  },
  // ── Python • Data structures ──────────────────────────────
  py_datastructs: {
    trailing_with_tool: (t) =>
      t.replace(/\bcom\s*\.\s*$/i, "com listas, dicionários e tuplas."),
    trailing_as_example: (t) =>
      t.replace(/\b(como|tais\s+como)\s*\.\s*$/i, "como `list`, `dict` e `tuple`."),
    empty_example_parens: (t) =>
      t.replace(/\(\s*(?:ex|exemplo|exemplos|por\s*ex|p\.\s*ex)\s*[:.]?\s*\)/i, "(Ex: `[1, 2, 3]` ou `{'a': 1}`)"),
  },
  // ── Python • Flow control ─────────────────────────────────
  py_flow: {
    trailing_with_tool: (t) =>
      t.replace(/\bcom\s*\.\s*$/i, "com `if`/`elif`/`else` e `for`/`while`."),
    trailing_as_example: (t) =>
      t.replace(/\b(como|tais\s+como)\s*\.\s*$/i, "como `if`, `for` e `while`."),
  },
  // ── Python • Basics ───────────────────────────────────────
  py_basics: {
    trailing_with_tool: (t) =>
      t.replace(/\bcom\s*\.\s*$/i, "com variáveis, tipos e operadores."),
    trailing_as_example: (t) =>
      t.replace(/\b(como|tais\s+como)\s*\.\s*$/i, "como `int`, `str`, `float` e `bool`."),
  },
  // ── Python • Generic fallback ─────────────────────────────
  py_generic: {
    empty_example_parens: (t) =>
      t.replace(/\s*\(\s*(?:ex|exemplo|exemplos|por\s*ex|p\.\s*ex)\s*[:.]?\s*\)/i, ""),
    empty_example_colon: (t) =>
      t.replace(/\s*\b(ex|exemplo|exemplos)\s*:\s*\.(\s|$)/i, ".$2"),
  },
};

function repairSemanticBreak(
  text: string,
  moduleTitle: string,
  courseTopic: string,
): { repaired: string; changed: boolean; appliedKey?: string } {
  if (!text) return { repaired: text, changed: false };
  const detect = detectIncompleteTechnicalSentence(text);
  if (!detect.broken || !detect.key) return { repaired: text, changed: false };

  const subdomain = detectModuleDomainPython(moduleTitle, courseTopic);
  const dictsToTry = [
    SEMANTIC_REPAIRS[subdomain],
    SEMANTIC_REPAIRS["py_generic"],
  ].filter(Boolean);

  for (const dict of dictsToTry) {
    const fn = dict[detect.key];
    if (typeof fn !== "function") continue;
    const out = fn(text);
    if (out && out !== text) {
      // Verify the repair actually fixed the break
      if (!detectIncompleteTechnicalSentence(out).broken) {
        return { repaired: out, changed: true, appliedKey: detect.key };
      }
    }
  }
  return { repaired: text, changed: false };
}

function repairSlideSemanticBreaks(
  s: Slide,
  moduleTitle: string,
  courseTopic: string,
  slideId: string,
): Slide {
  const fix = (txt: string | undefined): string | undefined => {
    if (!txt) return txt;
    const r = repairSemanticBreak(txt, moduleTitle, courseTopic);
    if (r.changed) {
      console.log(
        `[V5-SEMANTIC-REPAIR] ${slideId} | "${txt.slice(0, 80)}" → "${r.repaired.slice(0, 80)}" [${r.appliedKey}]`,
      );
    }
    return r.repaired;
  };
  const out: Slide = {
    ...s,
    title:    fix(s.title) ?? s.title,
    subtitle: fix(s.subtitle),
    items:      s.items?.map((t) => fix(t) ?? t),
    leftItems:  s.leftItems?.map((t) => fix(t) ?? t),
    rightItems: s.rightItems?.map((t) => fix(t) ?? t),
  };
  // v5.1.8: also repair competencies on module_cover
  const comps = (s as Slide & { competencies?: string[] }).competencies;
  if (Array.isArray(comps)) {
    (out as Slide & { competencies?: string[] }).competencies = comps.map((t) => fix(t) ?? t);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// LEARNING OBJECTIVE REPAIR (v5.1.5)
// Rewrites generic objectives like "Compreender fundamentos
// Essenciais de Python" into concrete pedagogical statements
// using a domain-aware tail dictionary.
// ═══════════════════════════════════════════════════════════

const PYTHON_OBJECTIVE_TAILS: Record<string, string[]> = {
  py_basics: [
    "Utilizar variáveis, tipos primitivos e operadores básicos.",
    "Criar expressões e atribuições corretas em Python.",
    "Aplicar entrada e saída com `input()` e `print()`.",
  ],
  py_flow: [
    "Criar estruturas condicionais com `if`, `elif` e `else`.",
    "Implementar laços com `for` e `while` para iteração.",
    "Combinar operadores lógicos em condições compostas.",
  ],
  py_functions: [
    "Definir funções reutilizáveis com `def` e parâmetros.",
    "Retornar valores e usar argumentos posicionais e nomeados.",
    "Aplicar escopo local e global em funções Python.",
  ],
  py_datastructs: [
    "Manipular listas, tuplas e dicionários para armazenar dados.",
    "Acessar, inserir e remover elementos de coleções.",
    "Aplicar métodos como `append()`, `pop()` e `keys()`.",
  ],
  py_oop: [
    "Definir classes com `class` e atributos no `__init__()`.",
    "Criar objetos e invocar métodos sobre instâncias.",
    "Aplicar herança e encapsulamento em classes Python.",
  ],
  py_files: [
    "Abrir, ler e escrever arquivos com `open()` e `with`.",
    "Tratar exceções de I/O como `FileNotFoundError`.",
    "Usar modos de abertura `'r'`, `'w'` e `'a'` corretamente.",
  ],
  py_errors: [
    "Capturar exceções específicas com `try`/`except`.",
    "Diferenciar `FileNotFoundError`, `ValueError` e `IOError`.",
    "Aplicar `finally` para liberar recursos com segurança.",
  ],
  py_tests: [
    "Escrever testes unitários com `unittest` ou `pytest`.",
    "Validar resultados com `assertEqual()` e `assertTrue()`.",
    "Organizar testes em classes `TestCase` e métodos `test_*`.",
  ],
  py_generic: [
    "Aplicar conceitos práticos com exemplos de código Python.",
    "Implementar pequenas rotinas utilizando boas práticas.",
    "Resolver exercícios reforçando os fundamentos do tópico.",
  ],
};

function repairLearningObjective(
  text: string,
  moduleTitle: string,
  courseTopic: string,
  idx: number,
): string {
  if (!isGenericLearningObjective(text, moduleTitle)) return text;
  const sub = detectModuleDomainPython(moduleTitle, courseTopic);
  const tails = PYTHON_OBJECTIVE_TAILS[sub] ?? PYTHON_OBJECTIVE_TAILS["py_generic"];
  const replacement = tails[idx % tails.length];
  console.log(
    `[V5-SEMANTIC-REPAIR] objective | "${text.slice(0, 80)}" → "${replacement}" [${sub}]`,
  );
  return replacement;
}

function repairSlideLearningObjectives(
  s: Slide,
  moduleTitle: string,
  courseTopic: string,
): Slide {
  if (s.layout !== "module_cover") return s;
  const mt = moduleTitle || s.title || "";
  const out: Slide = { ...s };
  if (Array.isArray(s.items)) {
    out.items = s.items.map((it, i) => repairLearningObjective(it, mt, courseTopic, i));
  }
  // v5.1.8: also repair competencies (separate field on module_cover)
  if (Array.isArray((s as Slide & { competencies?: string[] }).competencies)) {
    const comps = (s as Slide & { competencies?: string[] }).competencies as string[];
    (out as Slide & { competencies?: string[] }).competencies = comps.map(
      (it, i) => repairLearningObjective(it, mt, courseTopic, i),
    );
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// BROKEN NATURAL LANGUAGE DETECTOR + REPAIR (v5.1.6 hardening pass 6)
// Catches Portuguese grammar damage that survives every other check —
// e.g. "POO: Que Adotar a Programação Orientada a Objetos?" (missing
// "Por"), questions starting with "Que" + verb without "Por", missing
// prepositions, etc.
// ═══════════════════════════════════════════════════════════

type BrokenLangPattern = {
  re: RegExp;
  key: string;
  describe: string;
};

const BROKEN_LANG_PATTERNS: BrokenLangPattern[] = [
  // "Que Adotar...", "Que Usar...", "POO: Que Aprender..." — missing "Por"
  // Negative lookbehind (?<!\bPor\s) ensures we DON'T re-flag already-fixed
  // "Por Que Usar..." (otherwise the verify step rejects the repair).
  { re: /(?<!\bPor\s)\bQue\s+(Adotar|Usar|Utilizar|Aplicar|Escolher|Implementar|Aprender|Estudar|Conhecer|Iniciar|Começar|Comecar|Programar|Desenvolver|Criar|Adotamos|Escolhemos|Usamos)\b/,
    key: "missing_por_que", describe: "'Que <verbo>' sem 'Por'" },
  // "POO: É Importante?" / "POR: É Necessário?" — fragmented questions starting with isolated "É"
  { re: /(^|[\s:])É\s+(Importante|Necessário|Necessária|Útil|Fundamental|Essencial)\?/,
    key: "missing_por_que_e", describe: "'É <adj>?' provavelmente faltando 'Por que'" },
  // Title ends with isolated preposition: "Introdução a", "Conceitos de", "Trabalhando com"
  { re: /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][^.?!]*\b(a|de|com|para|em|por)\s*$/,
    key: "trailing_preposition_title", describe: "título termina em preposição isolada" },
  // Double conjunction: "que que", "de de", "com com"
  { re: /\b(que|de|com|para|em|por)\s+\1\b/i,
    key: "duplicate_word", describe: "palavra duplicada" },
  // "?:" or ":?" or ":?:" — broken question/colon punctuation
  { re: /[?:]\s*[?:]/,
    key: "broken_question_colon", describe: "pontuação de pergunta/dois-pontos quebrada" },
];

function detectBrokenNaturalLanguage(
  text: string,
): { broken: boolean; key?: string; describe?: string } {
  if (!text || text.length < 4) return { broken: false };
  for (const p of BROKEN_LANG_PATTERNS) {
    if (p.re.test(text)) return { broken: true, key: p.key, describe: p.describe };
  }
  return { broken: false };
}

const BROKEN_LANG_REPAIRS: Record<string, (t: string) => string | null> = {
  missing_por_que: (t) =>
    t.replace(
      /(?<!\bPor\s)\bQue(\s+(?:Adotar|Usar|Utilizar|Aplicar|Escolher|Implementar|Aprender|Estudar|Conhecer|Iniciar|Começar|Comecar|Programar|Desenvolver|Criar|Adotamos|Escolhemos|Usamos)\b)/,
      "Por Que$1",
    ),
  missing_por_que_e: (t) =>
    t.replace(
      /(^|[\s:])É\s+(Importante|Necessário|Necessária|Útil|Fundamental|Essencial)\?/,
      "$1Por que é $2?",
    ),
  trailing_preposition_title: (t) =>
    // Drop the trailing preposition (safer than guessing the missing word)
    t.replace(/\s+\b(a|de|com|para|em|por)\s*$/, ""),
  duplicate_word: (t) =>
    t.replace(/\b(que|de|com|para|em|por)\s+\1\b/gi, "$1"),
  broken_question_colon: (t) => t.replace(/[?:]\s*[?:]/g, "?"),
};

function repairBrokenLanguage(text: string): { repaired: string; changed: boolean; key?: string } {
  if (!text) return { repaired: text, changed: false };
  const det = detectBrokenNaturalLanguage(text);
  if (!det.broken || !det.key) return { repaired: text, changed: false };
  const fn = BROKEN_LANG_REPAIRS[det.key];
  if (!fn) return { repaired: text, changed: false };
  const out = fn(text);
  if (out && out !== text && !detectBrokenNaturalLanguage(out).broken) {
    return { repaired: out, changed: true, key: det.key };
  }
  return { repaired: text, changed: false };
}

function repairSlideBrokenLanguage(s: Slide, slideId: string): Slide {
  const fix = (txt: string | undefined): string | undefined => {
    if (!txt) return txt;
    const r = repairBrokenLanguage(txt);
    if (r.changed) {
      console.log(
        `[V5-LANGUAGE-REPAIR] ${slideId} | "${txt.slice(0, 80)}" → "${r.repaired.slice(0, 80)}" [${r.key}]`,
      );
    }
    return r.repaired;
  };
  const out: Slide = {
    ...s,
    title:    fix(s.title) ?? s.title,
    subtitle: fix(s.subtitle),
    items:      s.items?.map((t) => fix(t) ?? t),
    leftItems:  s.leftItems?.map((t) => fix(t) ?? t),
    rightItems: s.rightItems?.map((t) => fix(t) ?? t),
  };
  // v5.1.8: also repair competencies on module_cover
  const comps = (s as Slide & { competencies?: string[] }).competencies;
  if (Array.isArray(comps)) {
    (out as Slide & { competencies?: string[] }).competencies = comps.map((t) => fix(t) ?? t);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// SEMANTIC DUPLICATE DETECTOR (v5.1.5)
// Finds slide pairs whose normalized bullet/title content overlaps
// ≥70% and drops the weaker one (fewer items, shorter total text).
// ═══════════════════════════════════════════════════════════

function slideSemanticSignature(s: Slide): string {
  const all = [
    s.title || "",
    ...(s.items ?? []),
    ...(s.leftItems ?? []),
    ...(s.rightItems ?? []),
  ].join(" | ").toLowerCase()
    .replace(/[`*_~\-•]/g, " ")
    .replace(/[^a-z0-9áéíóúâêîôûãõç\s]/gi, " ")
    .replace(/\s+/g, " ").trim();
  return all;
}

function jaccardSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const tokA = new Set(a.split(/\s+/).filter((w) => w.length > 3));
  const tokB = new Set(b.split(/\s+/).filter((w) => w.length > 3));
  if (!tokA.size || !tokB.size) return 0;
  let inter = 0;
  for (const w of tokA) if (tokB.has(w)) inter++;
  return inter / (tokA.size + tokB.size - inter);
}

function slideContentWeight(s: Slide): number {
  const items = [
    ...(s.items ?? []), ...(s.leftItems ?? []), ...(s.rightItems ?? []),
  ];
  return items.length * 100 + items.reduce((a, b) => a + (b?.length ?? 0), 0);
}

function dedupeSemanticDuplicates(allModuleSlides: Slide[][]): {
  result: Slide[][]; removed: number;
} {
  const SIM_THRESHOLD = 0.70;
  // v5.1.15 — adjacent slides (same module, consecutive index) get a more
  // aggressive threshold because real consecutive slides should advance the
  // narrative; near-identical pairs are almost always accidental redundancy.
  const ADJACENT_SIM_THRESHOLD = 0.55;
  let removedCount = 0;
  const result = allModuleSlides.map((modSlides) => {
    if (modSlides.length < 2) return modSlides;
    const keep = new Array(modSlides.length).fill(true);
    const sigs = modSlides.map(slideSemanticSignature);
    for (let i = 0; i < modSlides.length; i++) {
      if (!keep[i]) continue;
      // Skip structural slides — they intentionally repeat patterns.
      if (["module_cover", "toc", "closing", "cover"].includes(modSlides[i].layout)) continue;
      for (let j = i + 1; j < modSlides.length; j++) {
        if (!keep[j]) continue;
        if (["module_cover", "toc", "closing", "cover"].includes(modSlides[j].layout)) continue;
        const sim = jaccardSimilarity(sigs[i], sigs[j]);
        const threshold = (j === i + 1) ? ADJACENT_SIM_THRESHOLD : SIM_THRESHOLD;
        if (sim >= threshold) {
          // Drop the weaker (less content); tie-break: keep earlier.
          const wi = slideContentWeight(modSlides[i]);
          const wj = slideContentWeight(modSlides[j]);
          const dropIdx = wj > wi ? i : j;
          keep[dropIdx] = false;
          removedCount++;
          console.log(
            `[V5-DEDUPE] dropped slide #${dropIdx + 1} (sim=${sim.toFixed(2)} with #${(dropIdx === i ? j : i) + 1}): "${modSlides[dropIdx].title}"`,
          );
          if (dropIdx === i) break; // i is gone, move on
        }
      }
    }
    return modSlides.filter((_, i) => keep[i]);
  });
  return { result, removed: removedCount };
}

// ── Final placeholder sanitizer ────────────────────────────
// IMPORTANT (v5.1 hardening): We DO NOT strip [[BT_N]] or [[SQLW_N]] here —
// those are protected backtick / SQL-wildcard slots managed by
// globalSanitize(). Stripping them out-of-band destroys legitimate code
// like `read()`, `write()`, `except`, `finally`. The rule is:
//   - Use globalSanitize() to clean text (it restores BT/SQLW slots safely).
//   - Use removeOrBlockPlaceholders() to strip ONLY foreign template tokens
//     that were never produced by globalSanitize ({{TOKEN}}, lorem ipsum,
//     stale [[CAPS_TOKEN]] patterns NOT matching BT_N or SQLW_N).
const FOREIGN_PLACEHOLDER_PATTERNS: RegExp[] = [
  /\{\{[A-Z_0-9]+\}\}/g,                      // {{COURSE_TITLE}}, {{BULLET_1}}
  /\blorem\s+ipsum\b/gi,
  /\bTODO\b:/g,
];

// Stricter patterns used ONLY by the residual-placeholder veto check.
// These DO include BT_N/SQLW_N because by the time the veto runs, all
// globalSanitize calls are complete, so any surviving marker is genuine
// leakage that must block export.
const RESIDUAL_PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[\[BT_?\d+\]\]/gi,
  /\[\[SQLW_?\d+\]\]/gi,
  /\[\[[A-Z_0-9]{2,}\]\]/g,
  /\{\{[A-Z_0-9]+\}\}/g,
  /\blorem\s+ipsum\b/gi,
];

function removeOrBlockPlaceholders(text: string): string {
  if (!text || typeof text !== "string") return text;
  let out = text;
  for (const re of FOREIGN_PLACEHOLDER_PATTERNS) out = out.replace(re, "");
  return out.replace(/\s{2,}/g, " ").trim();
}

// sanitizeSlidePlaceholders pipes every text field through globalSanitize
// FIRST (which safely restores BT_N/SQLW_N slots and strips orphan markers),
// then through removeOrBlockPlaceholders (which only kills foreign tokens
// like {{...}} and lorem ipsum). Code blocks are never touched.
function sanitizeSlidePlaceholders(s: Slide): Slide {
  const cleanText = (t?: string) => {
    if (!t) return t;
    return removeOrBlockPlaceholders(globalSanitize(t));
  };
  const cleanItems = (arr?: string[]) =>
    arr ? arr.map((t) => cleanText(t) ?? "").filter((t) => t.trim().length > 0) : arr;
  const out: Slide = {
    ...s,
    title:       cleanText(s.title) ?? "",
    subtitle:    cleanText(s.subtitle),
    label:       cleanText(s.label),
    leftHeader:  cleanText(s.leftHeader),
    rightHeader: cleanText(s.rightHeader),
    items:       cleanItems(s.items),
    leftItems:   cleanItems(s.leftItems),
    rightItems:  cleanItems(s.rightItems),
    code:        s.code, // never sanitise code
  };
  // v5.1.9: also sanitise competencies (module_cover field)
  const comps = (s as Slide & { competencies?: string[] }).competencies;
  if (Array.isArray(comps)) {
    (out as Slide & { competencies?: string[] }).competencies = cleanItems(comps);
  }
  return out;
}

// ── Technical sanitization damage REPAIR (v5.1.4) ──────────
// Deterministic, domain-aware repair of "verb ()" / ", ," / "Use e ."
// patterns that survive globalSanitize. Runs BEFORE the QA detector,
// then again after the cascade. Never loosens the veto — only attempts
// to reconstruct the lost technical token from context.
//
// Domain dictionaries are conservative: they only fire when the module
// title clearly belongs to a known domain (Python file I/O, Python OOP,
// Python tests). Generic Python repairs apply to any Python course.

type RepairRule = [RegExp, string];

const PY_FILES_DICT: RepairRule[] = [
  // "leitura ()" / "ler ()" → "leitura com `read()`"
  [/\b(leitura|ler)\s*\(\s*\)/gi, "leitura com `read()`"],
  // "escrita ()" / "escrever ()" → "escrita com `write()`"
  [/\b(escrita|escrever)\s*\(\s*\)/gi, "escrita com `write()`"],
  // "abrir ()" / "abertura ()" → "`open()`"
  [/\b(abrir|abertura)\s*\(\s*\)/gi, "`open()`"],
  // "fechar ()" / "fechamento ()" → "`close()`"
  [/\b(fechar|fechamento)\s*\(\s*\)/gi, "`close()`"],
  // "Use () para abrir arquivos" → "Use `open()` para abrir arquivos"
  [/\b(use|usar|usando)\s+\(\s*\)\s+para\s+abrir/gi, "$1 `open()` para abrir"],
  [/\b(use|usar|usando)\s+\(\s*\)\s+para\s+(ler|leitura)/gi, "$1 `read()` para $2"],
  [/\b(use|usar|usando)\s+\(\s*\)\s+para\s+(escrever|escrita)/gi, "$1 `write()` para $2"],
  [/\b(use|usar|usando)\s+\(\s*\)\s+para\s+fechar/gi, "$1 `close()` para fechar"],
  // "trata erros e para limpeza" → "Use `except` para tratar erros e `finally` para limpeza"
  [/\btrata(r)?\s+(erros?|exce[çc][õo]es?)\s+e\s+para\s+limpeza/gi,
    "Use `except` para tratar erros e `finally` para limpeza"],
  // "blocos e para tratamento" → "blocos `try`/`except` para tratamento"
  [/\bblocos?\s+e\s+para\s+tratamento/gi, "blocos `try`/`except` para tratamento"],
  // "with open ()" → "`with open(...)`"
  [/\bwith\s+open\s*\(\s*\)/gi, "`with open(...)`"],
  // "use with ()" → "use `with open(...)`"
  [/\b(use|usar|usando)\s+with\s+\(\s*\)/gi, "$1 `with open(...)`"],
  // "context manager ()" → "context manager `with`"
  [/\bcontext\s*manager\s*\(\s*\)/gi, "context manager `with`"],
  // "exceção FileNotFound" / "FileNotFound ()" → "`FileNotFoundError`"
  [/\bFileNotFound(?:Error)?\s*\(\s*\)/g, "`FileNotFoundError`"],
  [/\bexce[çc][aã]o\s+FileNotFound\b/gi, "exceção `FileNotFoundError`"],
  // "IOError ()" / "IO Error ()" → "`IOError`"
  [/\bIO\s*Error\s*\(\s*\)/g, "`IOError`"],
  // "encoding ()" → "`encoding='utf-8'`"
  [/\bencoding\s*\(\s*\)/gi, "`encoding='utf-8'`"],
  [/\b(use|usar|usando)\s+\(\s*\)\s+para\s+codifica[çc][aã]o/gi,
    "$1 `encoding='utf-8'` para codificação"],
  // "modo de abertura ()" → "modo de abertura (`'r'`, `'w'`, `'a'`)"
  [/\bmodo(s)?\s+de\s+abertura\s*\(\s*\)/gi, "modos de abertura (`'r'`, `'w'`, `'a'`)"],
  // "blocos try e ()" → "blocos `try` e `except`"
  [/\bblocos?\s+try\s+e\s+\(\s*\)/gi, "blocos `try` e `except`"],
  // "try ()" / "except ()" / "finally ()" — drop empty parens (these are statements, not calls)
  [/\b(try|except|finally|raise)\s*\(\s*\)/gi, "`$1`"],
  // v5.1.6: stripped function name with surviving comma — "leitura (, )" / "escrita (, )"
  [/\b(leitura|ler)\s*\(\s*,\s*\)/gi, "leitura com `read()`"],
  [/\b(escrita|escrever)\s*\(\s*,\s*\)/gi, "escrita com `write()`"],
  // "função (, )" / "method (, )" → drop the orphan parens
  [/\b(função|funcao|m[ée]todo|chamada)\s*\(\s*,+\s*\)/gi, "$1 correspondente"],
  // "Use com." / "Utilize com." (terminal "com.") in files context → with open
  [/\b(use|usar|utilize|utilizar)\s+com\s*\.\s*$/i, "$1 `with open(...)` para gerenciamento seguro de arquivos."],
];

const PY_OOP_DICT: RepairRule[] = [
  // "construtor ()" → "`__init__()`"
  [/\bconstrutor\s*\(\s*\)/gi, "`__init__()`"],
  // "método ()" / "metodo ()" → "método correspondente"
  [/\b(m[ée]todo|metodo)\s*\(\s*\)/gi, "método correspondente"],
  // "instanciar ()" → "instanciar a classe"
  [/\binstanciar\s*\(\s*\)/gi, "instanciar a classe"],
  // "use () para criar objetos" → "use o construtor para criar objetos"
  [/\b(use|usar|usando)\s+\(\s*\)\s+para\s+(criar|instanciar)/gi,
    "$1 o construtor para $2"],
];

const PY_TESTS_DICT: RepairRule[] = [
  // v5.1.6: "Use com classes e métodos assert" → "Use `unittest` com classes `TestCase` e métodos `assert*`"
  [/\b(use|usar|usando|utilize|utilizar)\s+com\s+classes?\s+e\s+m[ée]todos?\s+assert\w*\b/gi,
    "$1 `unittest` com classes `TestCase` e métodos `assert*`"],
  // "Use com classes" alone (sem assert)
  [/\b(use|usar|usando|utilize|utilizar)\s+com\s+classes?\b(?!\s+\w)/gi,
    "$1 `unittest` com classes `TestCase`"],
  // "métodos assert." (terminal) → métodos assert*
  [/\bm[ée]todos?\s+assert\s*\.(\s|$)/gi, "métodos `assert*`.$1"],
  // "Use com." (terminal) in tests context → use unittest
  [/\b(use|usar|utilize|utilizar)\s+com\s*\.\s*$/i, "$1 `unittest` para escrever testes."],
  // "classes com e métodos" → "classes com `unittest.TestCase` e métodos `test_*`"
  [/\bclasses?\s+com\s+e\s+m[ée]todos/gi,
    "classes com `unittest.TestCase` e métodos `test_*`"],
  // "use () para asserções" → "use `assertEqual()` para asserções"
  [/\b(use|usar)\s+\(\s*\)\s+para\s+asser[çc][õo]es/gi,
    "$1 `assertEqual()` para asserções"],
  // "testes" pattern: bare "()" near "teste"
  [/\bteste\s*\(\s*\)/gi, "função de teste"],
];

const PY_GENERIC_DICT: RepairRule[] = [
  // "Realize leitura () e escrita ()." → handled by FILES first; this is fallback
  // Generic "verb ()" with no obvious tech mapping → drop empty parens
  [/\b(usar|use|usando|chamar|chame|chamando|invocar|invoque|executar|execute|aplicar|aplique|realize|realizar|fazer|faça|implementar|implemente)\s+\(\s*\)\s+e\s+\(\s*\)/gi,
    "$1 as funções correspondentes"],
  [/\b(usar|use|usando|chamar|chame|chamando|invocar|invoque|executar|execute|aplicar|aplique|realize|realizar|fazer|faça|implementar|implemente)\s+\(\s*\)/gi,
    "$1 a função apropriada"],
  // "função ()" / "funcao ()" → "função correspondente"
  [/\b(fun[çc][aã]o|chamada)\s*\(\s*\)/gi, "$1 correspondente"],
  // ". ()" → ". " (orphan parens at sentence break)
  [/\.\s*\(\s*\)/g, "."],
  // "() e ()" anywhere → "as funções correspondentes"
  [/\(\s*\)\s+e\s+\(\s*\)/g, "as funções correspondentes"],
  // Bare leftover "()" — drop
  [/\s+\(\s*\)/g, ""],
];

const ORPHAN_PUNCT_DICT: RepairRule[] = [
  // "X em , , , ." → "X em itens diversos."
  [/\bem\s+(,\s*){2,}\.?/gi, "em itens diversos."],
  // ", ," → ","
  [/,\s*,+/g, ","],
  // " ," → ","
  [/\s+,/g, ","],
  // " e ." → "."
  [/\s+e\s+\./g, "."],
  // " ou ." → "."
  [/\s+ou\s+\./g, "."],
  // ": ." or ": , ." → "."
  [/:\s*[,\s]*\./g, "."],
  // collapse whitespace
  [/\s{2,}/g, " "],
];

function detectModuleDomain(moduleTitle: string, courseTopic: string): {
  isPython: boolean; isFiles: boolean; isOOP: boolean; isTests: boolean;
} {
  const ml = (moduleTitle || "").toLowerCase();
  const ct = (courseTopic  || "").toLowerCase();
  const isPython = /\bpython\b/.test(ml) || /\bpython\b/.test(ct);
  const isFiles  = isPython && /(arquiv|except|exce[çc][aã]o|erro|i\/?o|recurs|file|leitura|escrita)/.test(ml);
  const isOOP    = isPython && /(orient|objeto|classe|poo|construtor|hera[nñ][cç]a|encapsul|polimorf)/.test(ml);
  const isTests  = isPython && /(teste|test\b|unitt|pytest|tdd)/.test(ml);
  return { isPython, isFiles, isOOP, isTests };
}

function repairTechnicalSanitizationDamage(
  text: string,
  moduleTitle: string,
  courseTopic: string,
  _language: string = "pt-BR",
): string {
  if (!text || typeof text !== "string") return text;
  const { isPython, isFiles, isOOP, isTests } = detectModuleDomain(moduleTitle, courseTopic);
  let out = text;
  const apply = (dict: RepairRule[]) => { for (const [re, rep] of dict) out = out.replace(re, rep); };
  // Domain-specific dictionaries first (so "leitura ()" → "leitura com `read()`"
  // wins over the generic "verb ()" → "verb a função apropriada").
  if (isFiles) apply(PY_FILES_DICT);
  if (isOOP)   apply(PY_OOP_DICT);
  if (isTests) apply(PY_TESTS_DICT);
  if (isPython) apply(PY_GENERIC_DICT);
  // Always run orphan-punctuation cleanup last.
  apply(ORPHAN_PUNCT_DICT);
  return out.trim();
}

// Slide-level wrapper. Logs before/after when a damaged field was repaired.
function repairSlideTechnicalDamage(
  s: Slide,
  moduleTitle: string,
  courseTopic: string,
  slideId?: string,
): Slide {
  const repair = (t?: string) => {
    if (!t) return t;
    if (!detectTechnicalDamage(t)) return t;
    const fixed = repairTechnicalSanitizationDamage(t, moduleTitle, courseTopic);
    if (fixed !== t) {
      console.log(
        `[V5-REPAIR] ${slideId ?? "?"} | "${t.slice(0, 80)}" → "${fixed.slice(0, 80)}"`,
      );
    }
    return fixed;
  };
  const repairArr = (arr?: string[]) =>
    arr ? arr.map((t) => repair(t) ?? "").filter((t) => t.trim().length > 0) : arr;
  const out: Slide = {
    ...s,
    title:       repair(s.title) ?? s.title,
    subtitle:    repair(s.subtitle),
    label:       repair(s.label),
    leftHeader:  repair(s.leftHeader),
    rightHeader: repair(s.rightHeader),
    items:       repairArr(s.items),
    leftItems:   repairArr(s.leftItems),
    rightItems:  repairArr(s.rightItems),
    code:        s.code,
  };
  // v5.1.9: also repair competencies (module_cover field)
  const comps = (s as Slide & { competencies?: string[] }).competencies;
  if (Array.isArray(comps)) {
    (out as Slide & { competencies?: string[] }).competencies = repairArr(comps);
  }
  return out;
}

function slideHasResidualPlaceholder(s: Slide): { found: boolean; sample?: string } {
  const sCov = s as Slide & { competencies?: string[] };
  const candidates = [
    s.title, s.subtitle, s.label, s.leftHeader, s.rightHeader,
    ...(s.items ?? []), ...(s.leftItems ?? []), ...(s.rightItems ?? []),
    ...(sCov.competencies ?? []),
  ].filter(Boolean) as string[];
  for (const t of candidates) {
    for (const re of RESIDUAL_PLACEHOLDER_PATTERNS) {
      const m = t.match(re);
      if (m) return { found: true, sample: m[0] };
    }
  }
  return { found: false };
}

// ── Code completeness validator ────────────────────────────
// Per-language structural completeness check. Returns true when the
// code block looks safe to render (closed brackets, balanced quotes,
// no truncation marker like "...", etc.).
function validateCodeCompleteness(code: string, language: ContentDomain): boolean {
  if (!code || !code.trim()) return false;
  const trimmed = code.trim();

  // Universal: no obvious truncation marker at end
  if (/\.{3,}$|…\s*$/.test(trimmed)) return false;

  // Strip strings, template literals AND comments before structural checks
  // so legitimate `if (x > "}")` or `// {` etc don't trip the validator.
  const stripped = stripCommentsAndStrings(trimmed);

  // Bracket balance — applies to most C-family + Python expressions
  const pairs: Array<[string, string]> = [["(", ")"], ["[", "]"], ["{", "}"]];
  for (const [open, close] of pairs) {
    const opens  = (stripped.match(new RegExp(`\\${open}`, "g")) ?? []).length;
    const closes = (stripped.match(new RegExp(`\\${close}`, "g")) ?? []).length;
    if (opens !== closes) return false;
  }

  // Unbalanced triple-quoted strings (Python) — count on the raw code
  const tripleSingle = (trimmed.match(/'''/g) ?? []).length;
  const tripleDouble = (trimmed.match(/"""/g) ?? []).length;
  if (tripleSingle % 2 !== 0 || tripleDouble % 2 !== 0) return false;

  // Python-specific: def/class with no body
  if (language === "python") {
    const lines = trimmed.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(def|class|if|elif|else|for|while|try|except|finally|with)\b.*:\s*$/.test(line)) {
        // Must have an indented next line OR same-line body (already on this line before colon)
        const next = lines[i + 1] ?? "";
        const indent = (line.match(/^\s*/)?.[0].length) ?? 0;
        const nextIndent = (next.match(/^\s*/)?.[0].length) ?? 0;
        if (!next.trim() || nextIndent <= indent) return false;
      }
    }
  }

  // SQL-specific: statement must terminate with `;` OR have valid FROM / WHERE / VALUES
  if (language === "sql") {
    const upper = trimmed.toUpperCase();
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/.test(upper)) {
      if (!/;\s*(--[^\n]*\s*)?$/.test(trimmed) && !/--/.test(trimmed)) {
        // No semicolon and no comment-only fallback
        if (!/(FROM|WHERE|VALUES|SET|TABLE)\s+\w+/i.test(trimmed)) return false;
      }
    }
  }

  return true;
}

// ── QA Global Thresholds ────────────────────────────────────
const QA = {
  MAX_WORDS_PER_SLIDE:               50,
  MAX_BULLETS:                        6,
  MAX_CODE_LINES:                    12,
  MAX_TABLE_CELLS:                   16,
  MIN_BODY_FONT_SIZE:                18, // pt — used for risk detection only
  MAX_IDENTICAL_LAYOUTS_IN_SEQUENCE:  2,
  MIN_REQUIRED_WHITESPACE_RATIO:    0.20,
  MAX_WORDS_HARD_VETO:               80, // hard cap for veto (blueprint hard constraint)
} as const;

// ── QA Issue Types & Severity ───────────────────────────────
type QAIssueType =
  | "EMPTY_SLIDE"
  | "PLACEHOLDER_RESIDUAL"
  | "TITLE_FRAGMENT"
  | "GENERIC_LEARNING_OBJECTIVE"
  | "CONTENT_DENSITY_OVERFLOW"
  | "TOO_MANY_BULLETS"
  | "CODE_TOO_LONG"
  | "SQL_CODE_INCOMPLETE"
  | "LAYOUT_REPETITION"
  | "COMPARISON_UNSAFE"
  | "FONT_TOO_SMALL_RISK"
  // ── Architectural correction (v5.1) ─────────────────────────
  | "DOMAIN_CONTAMINATION"
  | "INCOMPLETE_CODE"
  | "EXTREME_DENSITY"
  | "BROKEN_COMPARISON"
  | "UNREADABLE_SLIDE"
  | "GENERIC_OBJECTIVE"
  // ── v5.1 hardening pass 2 ───────────────────────────────────
  | "TECHNICAL_SANITIZATION_DAMAGE"
  // ── v5.1.5 hardening pass 5 ─────────────────────────────────
  | "TECHNICAL_SEMANTIC_BREAK"
  | "REDUNDANT_SLIDE"
  // ── v5.1.6 hardening pass 6 ─────────────────────────────────
  | "BROKEN_LANGUAGE_STRUCTURE";

interface QAIssue {
  slideId:            string;
  type:               QAIssueType;
  severity:           "WARNING" | "CRITICAL";
  message:            string;
  metric?:            number;
  context?:           string;
  resolutionStrategy: string;
}

interface QAReport {
  status:      "PASSED" | "WARNING" | "FAILED";
  issues:      QAIssue[];      // un-fixed (CRITICAL that could not be repaired)
  fixedIssues: QAIssue[];     // auto-repaired
}

// ── SQL completeness probe (QA-specific, narrower than validateCodeIntegrity) ──
const QA_SQL_PROMISE_RE = /^\s*--\s*(remove?|drop|trunca|deleta|exclui|insert|update|select|altera|cria)\b/i;
const QA_SQL_STMT_RE    = /^\s*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|WITH)\b/i;

function qaHasSqlIncomplete(code: string): boolean {
  if (!code) return false;
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!QA_SQL_PROMISE_RE.test(lines[i])) continue;
    let nx = i + 1;
    while (nx < lines.length && !lines[nx].trim()) nx++;
    if (!QA_SQL_STMT_RE.test((lines[nx] ?? "").trim())) return true;
  }
  return false;
}

function qaCountWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * runPptxQA — formal QA pass over all generated module slides.
 *
 * Checks performed (per slide):
 *   CRITICAL: EMPTY_SLIDE, PLACEHOLDER_RESIDUAL, TITLE_FRAGMENT,
 *             SQL_CODE_INCOMPLETE, COMPARISON_UNSAFE
 *   WARNING:  GENERIC_LEARNING_OBJECTIVE, CONTENT_DENSITY_OVERFLOW,
 *             TOO_MANY_BULLETS, CODE_TOO_LONG, LAYOUT_REPETITION,
 *             FONT_TOO_SMALL_RISK
 *
 * Returns repaired slide arrays + a QAReport for logging.
 */
function runPptxQA(
  allSlides: Slide[][],
  moduleContents: string[],
  courseTopic = "",
  moduleTitles: string[] = [],
): { repairedSlides: Slide[][]; report: QAReport } {
  const courseDomain = inferCourseDomain(courseTopic);
  const unfixedIssues: QAIssue[] = [];
  const fixedIssues:   QAIssue[] = [];

  // Deep-copy each slide so mutations don't corrupt the originals
  const repaired: Slide[][] = allSlides.map((mod) => mod.map((s) => ({ ...s })));

  // Global layout sequence — spans all modules for LAYOUT_REPETITION
  const globalLayouts: Layout[] = [];

  for (let mi = 0; mi < repaired.length; mi++) {
    const modSlides  = repaired[mi];
    const modContent = moduleContents[mi] ?? "";
    const keepMask: boolean[] = new Array(modSlides.length).fill(true);

    for (let si = 0; si < modSlides.length; si++) {
      let s  = modSlides[si];
      const id = `module_${mi + 1}_slide_${si + 1}`;

      // ──────────────────────────────────────────────────────
      // 1. EMPTY_SLIDE  [CRITICAL]
      // ──────────────────────────────────────────────────────
      if (!isRenderableSlide(s)) {
        const repS = repairEmptySlide(s, modContent);
        if (isRenderableSlide(repS)) {
          fixedIssues.push({
            slideId: id, type: "EMPTY_SLIDE", severity: "CRITICAL",
            message: `Slide vazio reparado: "${s.title}" (${s.layout})`,
            context: s.layout,
            resolutionStrategy: "Extraídos bullets do conteúdo do módulo como fallback",
          });
          modSlides[si] = repS;
          s = repS;
        } else {
          unfixedIssues.push({
            slideId: id, type: "EMPTY_SLIDE", severity: "CRITICAL",
            message: `Slide vazio sem reparo possível: "${s.title}" — removido`,
            context: s.layout,
            resolutionStrategy: "Slide removido do deck final",
          });
          keepMask[si] = false;
          continue;
        }
      }

      // ──────────────────────────────────────────────────────
      // 2. PLACEHOLDER_RESIDUAL  [CRITICAL]
      // ──────────────────────────────────────────────────────
      const allTexts = [
        s.title, s.subtitle, s.label, s.code,
        s.leftHeader, s.rightHeader,
        ...(s.items ?? []), ...(s.leftItems ?? []), ...(s.rightItems ?? []),
      ].filter(Boolean) as string[];

      if (allTexts.some((t) => PLACEHOLDER_RE.test(t.trim()))) {
        const ci = (s.items ?? []).filter((t) => !PLACEHOLDER_RE.test(t.trim()));
        const cl = (s.leftItems  ?? []).filter((t) => !PLACEHOLDER_RE.test(t.trim()));
        const cr = (s.rightItems ?? []).filter((t) => !PLACEHOLDER_RE.test(t.trim()));
        const ct = PLACEHOLDER_RE.test((s.title || "").trim()) ? (s.label || "Conteúdo") : s.title;
        const fixed: Slide = { ...s, title: ct, items: ci, leftItems: cl, rightItems: cr };
        const issue: QAIssue = {
          slideId: id, type: "PLACEHOLDER_RESIDUAL", severity: "CRITICAL",
          message: `Placeholder residual em "${s.title}"`,
          context: allTexts.find((t) => PLACEHOLDER_RE.test(t.trim())),
          resolutionStrategy: "Textos placeholder filtrados; slide descartado se ficar vazio",
        };
        if (isRenderableSlide(fixed)) {
          fixedIssues.push(issue);
          modSlides[si] = fixed;
          s = fixed;
        } else {
          unfixedIssues.push({ ...issue, message: `Placeholder residual — slide removido: "${s.title}"`, resolutionStrategy: "Slide removido após remoção dos placeholders" });
          keepMask[si] = false;
          continue;
        }
      }

      // ──────────────────────────────────────────────────────
      // 3. TITLE_FRAGMENT  [CRITICAL — auto-fixed]
      // ──────────────────────────────────────────────────────
      const rawTitle = (s.title || "").trim();
      if (rawTitle.length < 3 || TITLE_PREP_RE.test(rawTitle) || FRAG_CONJ_RE.test(rawTitle)) {
        const stripped = rawTitle.replace(TITLE_PREP_RE, "").replace(FRAG_CONJ_RE, "").trim();
        const normalized = stripped.length >= 3
          ? stripped.charAt(0).toUpperCase() + stripped.slice(1)
          : (s.label || "Conteúdo do Módulo");
        fixedIssues.push({
          slideId: id, type: "TITLE_FRAGMENT", severity: "CRITICAL",
          message: `Título fragmentado corrigido: "${rawTitle}" → "${normalized}"`,
          context: rawTitle,
          resolutionStrategy: "Preposição/conjunção inicial removida; título capitalizado",
        });
        modSlides[si] = { ...s, title: normalized };
        s = modSlides[si];
      }

      // ──────────────────────────────────────────────────────
      // 4. GENERIC_LEARNING_OBJECTIVE  [CRITICAL — auto-repair via cascade]
      // v5.1.6: was WARNING-only and used BAD_OBJECTIVE_RE (only catches
      // double-verb patterns). Now uses isGenericLearningObjective which
      // catches "Compreender X", "Aplicar X", "Identificar X" — emits
      // CRITICAL so L1 cascade replaces with concrete objectives via
      // repairSlideLearningObjectives.
      // ──────────────────────────────────────────────────────
      if (s.layout === "module_cover") {
        const moduleTitle4 = moduleTitles[mi] ?? s.title ?? "";
        // v5.1.8: scan BOTH items and competencies (module_cover usually has competencies, not items).
        const sCov = s as Slide & { competencies?: string[] };
        const fields: string[] = [
          ...(Array.isArray(s.items) ? s.items : []),
          ...(Array.isArray(sCov.competencies) ? sCov.competencies : []),
        ];
        const generic = fields.filter((item) => isGenericLearningObjective(item, moduleTitle4));
        if (generic.length > 0) {
          unfixedIssues.push({
            slideId: id, type: "GENERIC_LEARNING_OBJECTIVE", severity: "CRITICAL",
            message: `${generic.length} objetivo(s) genérico(s) em "${s.title}"`,
            metric: generic.length,
            context: generic[0],
            resolutionStrategy: "L1 cascade aplicará repairSlideLearningObjectives()",
          });
        }
      }

      const items = nonEmpty(s.items);

      // ──────────────────────────────────────────────────────
      // 5. CONTENT_DENSITY_OVERFLOW  [WARNING → auto-fix]
      // ──────────────────────────────────────────────────────
      const DENSITY_SKIP: Layout[] = ["code","module_cover","cover","toc","closing"];
      if (!DENSITY_SKIP.includes(s.layout)) {
        const totalWords = items.reduce((acc, t) => acc + qaCountWords(t), 0);
        if (totalWords > QA.MAX_WORDS_PER_SLIDE) {
          fixedIssues.push({
            slideId: id, type: "CONTENT_DENSITY_OVERFLOW", severity: "WARNING",
            message: `Slide com ${totalWords} palavras (máx ${QA.MAX_WORDS_PER_SLIDE}): "${s.title}"`,
            metric: totalWords,
            context: s.layout,
            resolutionStrategy: `Items truncados para ${QA.MAX_BULLETS}`,
          });
          modSlides[si] = { ...s, items: items.slice(0, QA.MAX_BULLETS) };
          s = modSlides[si];
        }
      }

      // ──────────────────────────────────────────────────────
      // 6. TOO_MANY_BULLETS  [WARNING → auto-fix]
      // ──────────────────────────────────────────────────────
      if (["bullets","takeaways"].includes(s.layout) && items.length > QA.MAX_BULLETS) {
        fixedIssues.push({
          slideId: id, type: "TOO_MANY_BULLETS", severity: "WARNING",
          message: `${items.length} bullets em "${s.title}" (máx ${QA.MAX_BULLETS})`,
          metric: items.length,
          resolutionStrategy: `Items cortados para ${QA.MAX_BULLETS}`,
        });
        modSlides[si] = { ...s, items: items.slice(0, QA.MAX_BULLETS) };
        s = modSlides[si];
      }

      // ──────────────────────────────────────────────────────
      // 7. CODE_TOO_LONG  [WARNING → auto-fix]
      // ──────────────────────────────────────────────────────
      if (s.layout === "code" && s.code) {
        const codeLines = s.code.split("\n");
        if (codeLines.length > QA.MAX_CODE_LINES) {
          fixedIssues.push({
            slideId: id, type: "CODE_TOO_LONG", severity: "WARNING",
            message: `Código com ${codeLines.length} linhas (máx ${QA.MAX_CODE_LINES}): "${s.title}"`,
            metric: codeLines.length,
            resolutionStrategy: `Código truncado para ${QA.MAX_CODE_LINES} linhas`,
          });
          modSlides[si] = {
            ...s,
            code: codeLines.slice(0, QA.MAX_CODE_LINES).join("\n") + "\n-- ... (truncado)",
          };
          s = modSlides[si];
        }
      }

      // ──────────────────────────────────────────────────────
      // 8. SQL_CODE_INCOMPLETE  [CRITICAL → auto-fix]
      // ──────────────────────────────────────────────────────
      if (s.layout === "code" && s.code && qaHasSqlIncomplete(s.code)) {
        const repaired_code = validateCodeIntegrity(s.code);
        fixedIssues.push({
          slideId: id, type: "SQL_CODE_INCOMPLETE", severity: "CRITICAL",
          message: `SQL incompleto reparado em "${s.title}"`,
          resolutionStrategy: "Instrução SQL sintetizada a partir do comentário indicativo",
        });
        modSlides[si] = { ...s, code: repaired_code };
        s = modSlides[si];
      }

      // ──────────────────────────────────────────────────────
      // 9. LAYOUT_REPETITION  [WARNING → swap layout]
      // ──────────────────────────────────────────────────────
      const REPETITION_SKIP: Layout[] = ["module_cover","cover","toc","closing","code"];
      globalLayouts.push(s.layout);
      if (
        !REPETITION_SKIP.includes(s.layout) &&
        globalLayouts.length > QA.MAX_IDENTICAL_LAYOUTS_IN_SEQUENCE
      ) {
        const tail = globalLayouts.slice(-(QA.MAX_IDENTICAL_LAYOUTS_IN_SEQUENCE + 1));
        if (tail.every((l) => l === s.layout)) {
          const curItems = nonEmpty(s.items);
          const swapped: Slide = s.layout === "bullets"
            ? { ...s, layout: curItems.length >= 5 ? "twocol" : "cards" }
            : s.layout === "twocol"
            ? { ...s, layout: "bullets" }
            : { ...s, layout: "bullets" };
          if (isRenderableSlide(swapped)) {
            fixedIssues.push({
              slideId: id, type: "LAYOUT_REPETITION", severity: "WARNING",
              message: `Layout "${s.layout}" repetido ${QA.MAX_IDENTICAL_LAYOUTS_IN_SEQUENCE + 1}x — variado para "${swapped.layout}"`,
              metric: QA.MAX_IDENTICAL_LAYOUTS_IN_SEQUENCE + 1,
              context: s.layout,
              resolutionStrategy: `Layout variado: ${s.layout} → ${swapped.layout}`,
            });
            modSlides[si] = swapped;
            globalLayouts[globalLayouts.length - 1] = swapped.layout;
            s = swapped;
          }
        }
      }

      // ──────────────────────────────────────────────────────
      // 10. COMPARISON_UNSAFE  [CRITICAL → convert to twocol]
      // ──────────────────────────────────────────────────────
      if (s.layout === "comparison") {
        const lI = nonEmpty(s.leftItems);
        const rI = nonEmpty(s.rightItems);
        const hasLong = [...lI, ...rI].some((t) => t.length > 80);
        const tooMany = lI.length > COMPARISON_MAX_ITEMS || rI.length > COMPARISON_MAX_ITEMS;
        if (hasLong || tooMany) {
          const merged = [...lI, ...rI].slice(0, 8);
          fixedIssues.push({
            slideId: id, type: "COMPARISON_UNSAFE", severity: "CRITICAL",
            message: `Comparison visualmente inseguro em "${s.title}" (l=${lI.length} r=${rI.length} hasLong=${hasLong})`,
            metric: lI.length + rI.length,
            resolutionStrategy: "Convertido para twocol com items mesclados",
          });
          modSlides[si] = { ...s, layout: "twocol", items: merged, leftItems: undefined, rightItems: undefined };
          s = modSlides[si];
        }
      }

      // ──────────────────────────────────────────────────────
      // 11. FONT_TOO_SMALL_RISK  [WARNING → cap item length]
      // ──────────────────────────────────────────────────────
      const FONT_SKIP: Layout[] = ["code","module_cover","cover","toc","closing"];
      const renderItems = nonEmpty(s.items);
      if (!FONT_SKIP.includes(s.layout) && renderItems.length >= 5) {
        const avgLen = renderItems.reduce((a, t) => a + t.length, 0) / renderItems.length;
        if (avgLen > 120) {
          fixedIssues.push({
            slideId: id, type: "FONT_TOO_SMALL_RISK", severity: "WARNING",
            message: `Risco de fonte <${QA.MIN_BODY_FONT_SIZE}pt em "${s.title}" (${renderItems.length} items, avg ${Math.round(avgLen)} chars)`,
            metric: Math.round(avgLen),
            context: `${renderItems.length} items`,
            resolutionStrategy: "Items truncados a 100 chars para preservar legibilidade",
          });
          modSlides[si] = { ...s, items: renderItems.map((t) => t.slice(0, 100)) };
          s = modSlides[si];
        }
      }

      // ══════════════════════════════════════════════════════
      // ARCHITECTURAL CORRECTION (v5.1) — additional CRITICAL checks
      // ══════════════════════════════════════════════════════

      // 12. DOMAIN_CONTAMINATION  [CRITICAL → drop or strip code]
      // Prevents SQL/DDL leaking into Python courses, etc.
      const moduleTitle = moduleTitles[mi] ?? "";
      const contam = detectDomainContamination(s, courseDomain, moduleTitle);
      if (contam.contaminated) {
        // If contamination is confined to the code field, strip the code
        // and demote layout to bullets. Otherwise mark slide for removal.
        if (s.layout === "code" && s.code) {
          const itemsFallback = nonEmpty(s.items);
          if (itemsFallback.length >= 3) {
            fixedIssues.push({
              slideId: id, type: "DOMAIN_CONTAMINATION", severity: "CRITICAL",
              message: `Domínio contaminado em "${s.title}": ${contam.reason}`,
              context: contam.reason,
              resolutionStrategy: "Código contaminado removido; slide convertido para bullets",
            });
            modSlides[si] = { ...s, layout: "bullets", code: undefined };
            s = modSlides[si];
          } else {
            unfixedIssues.push({
              slideId: id, type: "DOMAIN_CONTAMINATION", severity: "CRITICAL",
              message: `Slide com domínio incompatível removido: "${s.title}" (${contam.reason})`,
              context: contam.reason,
              resolutionStrategy: "Slide removido — não havia conteúdo alternativo válido",
            });
            keepMask[si] = false;
            continue;
          }
        } else {
          unfixedIssues.push({
            slideId: id, type: "DOMAIN_CONTAMINATION", severity: "CRITICAL",
            message: `Slide com domínio incompatível: "${s.title}" (${contam.reason})`,
            context: contam.reason,
            resolutionStrategy: "Slide removido para preservar coerência do curso",
          });
          keepMask[si] = false;
          continue;
        }
      }

      // 13. INCOMPLETE_CODE  [CRITICAL → drop code or split]
      // Per-language structural validation (Python def/class body, brackets, quotes).
      if (s.layout === "code" && s.code) {
        const lang: ContentDomain =
          courseDomain === "python" || courseDomain === "sql" ||
          courseDomain === "javascript" || courseDomain === "java"
            ? courseDomain : "generic";
        if (!validateCodeCompleteness(s.code, lang)) {
          const itemsFallback = nonEmpty(s.items);
          if (itemsFallback.length >= 3) {
            fixedIssues.push({
              slideId: id, type: "INCOMPLETE_CODE", severity: "CRITICAL",
              message: `Código incompleto em "${s.title}" (${lang}) — convertido para bullets`,
              context: lang,
              resolutionStrategy: "Bloco de código removido; slide renderizado como bullets",
            });
            modSlides[si] = { ...s, layout: "bullets", code: undefined };
            s = modSlides[si];
          } else {
            unfixedIssues.push({
              slideId: id, type: "INCOMPLETE_CODE", severity: "CRITICAL",
              message: `Código incompleto sem fallback em "${s.title}" (${lang})`,
              context: lang,
              resolutionStrategy: "Slide removido — código truncado e sem alternativa",
            });
            keepMask[si] = false;
            continue;
          }
        }
      }

      // 14. EXTREME_DENSITY  [CRITICAL → split or trim hard]
      // Hard veto threshold (80 words) — overrides MAX_WORDS_PER_SLIDE.
      const HARD_DENSITY_SKIP: Layout[] = ["code","module_cover","cover","toc","closing"];
      if (!HARD_DENSITY_SKIP.includes(s.layout)) {
        const itemsNow = nonEmpty(s.items);
        const totalWords = itemsNow.reduce((a, t) => a + qaCountWords(t), 0);
        if (totalWords > QA.MAX_WORDS_HARD_VETO) {
          const trimmed = itemsNow
            .map((t) => safeSliceText(t, 70))
            .slice(0, QA.MAX_BULLETS);
          const trimmedWords = trimmed.reduce((a, t) => a + qaCountWords(t), 0);
          if (trimmedWords <= QA.MAX_WORDS_HARD_VETO) {
            fixedIssues.push({
              slideId: id, type: "EXTREME_DENSITY", severity: "CRITICAL",
              message: `Densidade extrema (${totalWords} palavras) em "${s.title}" — comprimida para ${trimmedWords}`,
              metric: totalWords,
              resolutionStrategy: "Itens comprimidos e truncados ao limite duro",
            });
            modSlides[si] = { ...s, items: trimmed };
            s = modSlides[si];
          } else {
            unfixedIssues.push({
              slideId: id, type: "EXTREME_DENSITY", severity: "CRITICAL",
              message: `Densidade extrema sem reparo em "${s.title}" (${totalWords} palavras)`,
              metric: totalWords,
              resolutionStrategy: "Será dividido pelo cascade L2",
            });
          }
        }
      }

      // 15. BROKEN_COMPARISON  [CRITICAL → convert to twocol]
      // Comparison with one or both columns empty / single-item.
      if (s.layout === "comparison") {
        const lI2 = nonEmpty(s.leftItems);
        const rI2 = nonEmpty(s.rightItems);
        if (lI2.length < 2 || rI2.length < 2) {
          const merged = [...lI2, ...rI2].slice(0, 6);
          if (merged.length >= 3) {
            fixedIssues.push({
              slideId: id, type: "BROKEN_COMPARISON", severity: "CRITICAL",
              message: `Comparison quebrado em "${s.title}" (l=${lI2.length} r=${rI2.length})`,
              resolutionStrategy: "Convertido para twocol com itens mesclados",
            });
            modSlides[si] = { ...s, layout: "twocol", items: merged, leftItems: undefined, rightItems: undefined };
            s = modSlides[si];
          } else {
            unfixedIssues.push({
              slideId: id, type: "BROKEN_COMPARISON", severity: "CRITICAL",
              message: `Comparison quebrado sem conteúdo: "${s.title}"`,
              resolutionStrategy: "Slide removido",
            });
            keepMask[si] = false;
            continue;
          }
        }
      }

      // 16. UNREADABLE_SLIDE  [CRITICAL → drop]
      // Final readability check — if after all fixes the slide is still
      // un-renderable OR has zero meaningful content, mark CRITICAL.
      if (!isRenderableSlide(s)) {
        unfixedIssues.push({
          slideId: id, type: "UNREADABLE_SLIDE", severity: "CRITICAL",
          message: `Slide ilegível após todos os reparos: "${s.title}" (${s.layout})`,
          resolutionStrategy: "Slide removido do deck final",
        });
        keepMask[si] = false;
        continue;
      }

      // 17. GENERIC_OBJECTIVE  [CRITICAL → drop bad items, drop slide if empty]
      // Strict pedagogical check — strips bullets like "Compreender Python",
      // "Aplicar fundamentos", "Identificar testes" that are non-actionable.
      const genericSkipLayouts: Layout[] = ["code", "module_cover", "cover", "toc", "closing"];
      if (!genericSkipLayouts.includes(s.layout) && s.items?.length) {
        const moduleTitle17 = moduleTitles[mi] ?? "";
        const goodItems = s.items.filter((it) => !isGenericLearningObjective(it, moduleTitle17));
        const removedCount = s.items.length - goodItems.length;
        if (removedCount > 0) {
          if (goodItems.length >= 3) {
            fixedIssues.push({
              slideId: id, type: "GENERIC_OBJECTIVE", severity: "CRITICAL",
              message: `${removedCount} objetivo(s) genérico(s) removidos de "${s.title}"`,
              metric: removedCount,
              resolutionStrategy: "Bullets genéricos removidos; restantes preservados",
            });
            modSlides[si] = { ...s, items: goodItems };
            s = modSlides[si];
          } else {
            unfixedIssues.push({
              slideId: id, type: "GENERIC_OBJECTIVE", severity: "CRITICAL",
              message: `Slide majoritariamente genérico: "${s.title}" (${removedCount}/${s.items.length})`,
              metric: removedCount,
              resolutionStrategy: "Slide removido — sem objetivos pedagógicos concretos",
            });
            keepMask[si] = false;
            continue;
          }
        }
      }

      // 18. TECHNICAL_SANITIZATION_DAMAGE  [CRITICAL → flag for veto]
      // Catches the symptom of valid Python/JS function calls being
      // stripped (e.g. "Realize leitura ()" instead of "leitura `read()`").
      // We cannot recover the lost name here — the only safe action is to
      // mark CRITICAL and let qaVeto block the export.
      const allTextFields = [
        s.title, s.subtitle, ...(s.items ?? []),
        ...(s.leftItems ?? []), ...(s.rightItems ?? []),
      ].filter(Boolean) as string[];
      let damaged = false;
      for (const t of allTextFields) {
        if (detectTechnicalDamage(t)) { damaged = true; break; }
      }
      if (damaged) {
        unfixedIssues.push({
          slideId: id, type: "TECHNICAL_SANITIZATION_DAMAGE", severity: "CRITICAL",
          message: `Sintaxe técnica destruída em "${s.title}" (parênteses vazios após verbo)`,
          resolutionStrategy: "Slide marcado para regeneração",
        });
      }

      // 19. TECHNICAL_SEMANTIC_BREAK  [CRITICAL → repair via cascade or veto]
      // Catches sentences whose syntax survived but whose meaning was
      // destroyed (e.g. "Capture erros específicos como.", "Verifica
      // partes isoladas com.", "Definir Classes: Usar com nome (Ex: ).").
      let semanticBreak: { txt: string; describe: string } | null = null;
      for (const t of allTextFields) {
        const det = detectIncompleteTechnicalSentence(t);
        if (det.broken) { semanticBreak = { txt: t, describe: det.describe ?? det.key ?? "?" }; break; }
      }
      if (semanticBreak) {
        unfixedIssues.push({
          slideId: id, type: "TECHNICAL_SEMANTIC_BREAK", severity: "CRITICAL",
          message: `Frase tecnicamente incompleta em "${s.title}" (${semanticBreak.describe})`,
          context: semanticBreak.txt.slice(0, 120),
          resolutionStrategy: "Reparo semântico via repairSemanticBreak() ou bloqueio do export",
        });
      }

      // 20. BROKEN_LANGUAGE_STRUCTURE  [CRITICAL → repair via cascade or veto]
      // v5.1.6: catches Portuguese grammar damage like "Que Adotar..."
      // (missing "Por"), missing prepositions, etc. L1 cascade will try
      // repairBrokenLanguage(); persistent damage blocks the export.
      let brokenLang: { txt: string; describe: string } | null = null;
      const langFields = [s.title, ...(s.items ?? []), ...(s.leftItems ?? []), ...(s.rightItems ?? [])]
        .filter((x): x is string => typeof x === "string");
      for (const t of langFields) {
        const det = detectBrokenNaturalLanguage(t);
        if (det.broken) { brokenLang = { txt: t, describe: det.describe ?? det.key ?? "?" }; break; }
      }
      if (brokenLang) {
        unfixedIssues.push({
          slideId: id, type: "BROKEN_LANGUAGE_STRUCTURE", severity: "CRITICAL",
          message: `Linguagem natural quebrada em "${s.title}" (${brokenLang.describe})`,
          context: brokenLang.txt.slice(0, 120),
          resolutionStrategy: "Reparo via repairBrokenLanguage() ou bloqueio do export",
        });
      }
    } // end slide loop

    // Apply drop mask for CRITICALs that could not be repaired
    repaired[mi] = modSlides.filter((_, si) => keepMask[si]);
  } // end module loop

  // ── Build report ─────────────────────────────────────────
  const allFound = [...unfixedIssues, ...fixedIssues];
  const hasCritical = unfixedIssues.some((i) => i.severity === "CRITICAL");
  const hasWarning  = allFound.some((i) => i.severity === "WARNING");
  const status: QAReport["status"] = hasCritical ? "FAILED" : hasWarning ? "WARNING" : "PASSED";
  const report: QAReport = { status, issues: unfixedIssues, fixedIssues };

  console.log(
    `[V5-QA] status=${status} | unfixed=${unfixedIssues.length} | fixed=${fixedIssues.length} | total_checks=${allFound.length}`,
  );
  for (const issue of unfixedIssues) {
    console.warn(`[V5-QA] UNFIXED ${issue.severity}:${issue.type} @ ${issue.slideId} — ${issue.message}`);
  }
  for (const fix of fixedIssues.slice(0, 10)) { // cap log volume
    console.log(`[V5-QA] FIXED ${fix.type} @ ${fix.slideId} — ${fix.message}`);
  }
  if (fixedIssues.length > 10) {
    console.log(`[V5-QA] ... and ${fixedIssues.length - 10} more fixed issues`);
  }

  return { repairedSlides: repaired, report };
}

// ═══════════════════════════════════════════════════════════
// SECTION 6D: QA RESOLUTION CASCADE
// Three-level resolution pipeline for issues that runPptxQA could not
// fix in a single pass.
//   Level 1 — Visual auto-correction  (no structural changes)
//   Level 2 — Layout replanning       (may split slides)
//   Level 3 — Local LLM rewrite       (CRITICALs only, per slide)
// Max 2 full cycles of L1+L2 before escalating to L3.
// ═══════════════════════════════════════════════════════════

// ── Cascade helpers ──────────────────────────────────────────

/** Parse "module_2_slide_4" → {mi:1, si:3}. Returns null on bad format. */
function parseSlideId(id: string): { mi: number; si: number } | null {
  const m = id.match(/^module_(\d+)_slide_(\d+)$/);
  if (!m) return null;
  return { mi: parseInt(m[1], 10) - 1, si: parseInt(m[2], 10) - 1 };
}

/**
 * Trim text to maxChars but NEVER cut SQL aggregate expressions
 * like SELECT *, COUNT(*), SUM(*), MAX(*), MIN(*), AVG(*).
 * Also avoids breaking mid-word.
 */
const SQL_STAR_PRESERVE_RE = /\b(?:SELECT\s+\*|COUNT\s*\(\s*\*\s*\)|SUM\s*\(\s*\*\s*\)|AVG\s*\(\s*\*\s*\)|MAX\s*\(\s*\*\s*\)|MIN\s*\(\s*\*\s*\))/i;

function safeSliceText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (SQL_STAR_PRESERVE_RE.test(text)) return text;
  const cut = text.slice(0, maxChars).trimEnd();
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.65 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

function normalizeItemPunctuation(text: string): string {
  return text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,;:.])/g, "$1")
    .trim();
}

// ── Level 1 — Visual auto-correction ────────────────────────
/**
 * Apply a targeted visual fix to a single slide for the given issue.
 * Never changes layout or splits the slide.
 */
function l1VisualFix(
  s: Slide,
  issue: QAIssue,
  moduleContent: string,
  moduleTitle: string = "",
  courseTopic: string = "",
): Slide {
  switch (issue.type) {
    case "EMPTY_SLIDE": {
      const rep = repairEmptySlide(s, moduleContent);
      if (isRenderableSlide(rep)) return rep;
      return {
        ...s, layout: "bullets",
        title: s.label || s.title || "Conteúdo",
        items: ["Consulte o material do módulo para este tópico."],
      };
    }
    case "PLACEHOLDER_RESIDUAL": {
      const ci = (s.items ?? []).filter((t) => !PLACEHOLDER_RE.test(t.trim())).map(normalizeItemPunctuation);
      const cl = (s.leftItems  ?? []).filter((t) => !PLACEHOLDER_RE.test(t.trim())).map(normalizeItemPunctuation);
      const cr = (s.rightItems ?? []).filter((t) => !PLACEHOLDER_RE.test(t.trim())).map(normalizeItemPunctuation);
      const ct = PLACEHOLDER_RE.test((s.title || "").trim()) ? (s.label || "Conteúdo do Módulo") : s.title;
      const fixed: Slide = { ...s, title: ct, items: ci, leftItems: cl, rightItems: cr };
      return isRenderableSlide(fixed) ? fixed : repairEmptySlide(fixed, moduleContent);
    }
    case "TITLE_FRAGMENT": {
      let t = (s.title || "").trim()
        .replace(TITLE_PREP_RE, "")
        .replace(FRAG_CONJ_RE, "")
        .trim();
      if (t.length < 3) t = s.label || "Conteúdo do Módulo";
      return { ...s, title: t.charAt(0).toUpperCase() + t.slice(1) };
    }
    case "SQL_CODE_INCOMPLETE":
      return { ...s, code: validateCodeIntegrity(s.code || "") };
    case "CONTENT_DENSITY_OVERFLOW": {
      const capped = nonEmpty(s.items)
        .map((t) => normalizeItemPunctuation(safeSliceText(t, 60)));
      return { ...s, items: capped.slice(0, QA.MAX_BULLETS) };
    }
    case "TOO_MANY_BULLETS": {
      const trimmed = nonEmpty(s.items)
        .map((t) => normalizeItemPunctuation(safeSliceText(t, 70)));
      return { ...s, items: trimmed.slice(0, QA.MAX_BULLETS) };
    }
    case "CODE_TOO_LONG": {
      const lines = (s.code || "").split("\n").slice(0, QA.MAX_CODE_LINES);
      return { ...s, code: lines.join("\n") + "\n-- ... (ver continuação)" };
    }
    case "LAYOUT_REPETITION": {
      const items = nonEmpty(s.items);
      const swapped: Slide = s.layout === "bullets"
        ? { ...s, layout: items.length >= 5 ? "twocol" : "cards" }
        : s.layout === "twocol" ? { ...s, layout: "bullets" }
        : { ...s, layout: "bullets" };
      return isRenderableSlide(swapped) ? swapped : s;
    }
    case "COMPARISON_UNSAFE": {
      const lI = nonEmpty(s.leftItems);
      const rI = nonEmpty(s.rightItems);
      const merged = [...lI, ...rI].slice(0, 8);
      return { ...s, layout: "twocol", items: merged, leftItems: undefined, rightItems: undefined };
    }
    case "FONT_TOO_SMALL_RISK":
      return { ...s, items: nonEmpty(s.items).map((t) => safeSliceText(t, 80)) };
    case "TECHNICAL_SANITIZATION_DAMAGE": {
      const mTitle = moduleTitle || s.label || "";
      const cTopic = courseTopic || mTitle;
      return repairSlideTechnicalDamage(s, mTitle, cTopic, issue.slideId);
    }
    case "TECHNICAL_SEMANTIC_BREAK": {
      // Domain-aware semantic reconstruction. If repair fails, the slide
      // remains broken and qaVeto blocks the export (HARD_CRITICAL).
      const mTitle = moduleTitle || s.label || "";
      const cTopic = courseTopic || mTitle;
      return repairSlideSemanticBreaks(s, mTitle, cTopic, issue.slideId);
    }
    case "BROKEN_LANGUAGE_STRUCTURE": {
      // v5.1.6: deterministic Portuguese-grammar repair ("Que Adotar..."
      // → "Por Que Adotar..."). Failures stay flagged; veto blocks.
      return repairSlideBrokenLanguage(s, issue.slideId);
    }
    case "GENERIC_OBJECTIVE":
    case "GENERIC_LEARNING_OBJECTIVE": {
      if (s.layout !== "module_cover") return s;
      // v5.1.5: deterministic concrete-objective rewrite using
      // PYTHON_OBJECTIVE_TAILS dictionary (tied to module subdomain).
      // v5.1.9: works for items AND competencies (module_cover usually has competencies, no items).
      const repaired = repairSlideLearningObjectives(s, moduleTitle || s.title || "", courseTopic);
      // Keep the legacy normalisation as a final pass for any remaining
      // items that weren't generic (it normalises capitalisation).
      const out: Slide = { ...repaired };
      if (Array.isArray(repaired.items)) {
        const finalItems = repaired.items
          .map((item, idx) => withPeriod(normalizeLearningObjective(item, s.title, idx)))
          .filter((item) => item.length > 8);
        if (finalItems.length >= 2) out.items = finalItems;
      }
      const repCov = (repaired as Slide & { competencies?: string[] }).competencies;
      if (Array.isArray(repCov)) {
        const finalComps = repCov
          .map((item, idx) => withPeriod(normalizeLearningObjective(item, s.title, idx)))
          .filter((item) => item.length > 8);
        if (finalComps.length >= 2) (out as Slide & { competencies?: string[] }).competencies = finalComps;
      }
      return out;
    }
    default:
      return s;
  }
}

// ── Level 2 — Layout replanning ─────────────────────────────
/**
 * Resolve density/structural issues that Level 1 could not fix.
 * May return 2 slides (split) or 0 slides (drop) instead of 1.
 * Never returns empty array unless drop is the only safe option.
 */
function l2Replan(s: Slide, issue: QAIssue, moduleContent: string): Slide[] {
  switch (issue.type) {
    case "TOO_MANY_BULLETS":
    case "CONTENT_DENSITY_OVERFLOW": {
      const all = nonEmpty(s.items);
      if (all.length < 4) return [{ ...s, items: all.slice(0, QA.MAX_BULLETS) }];
      const mid = Math.ceil(all.length / 2);
      const p1: Slide = { ...s, title: `${s.title} (1/2)`, items: all.slice(0, mid) };
      const p2: Slide = { ...s, title: `${s.title} (2/2)`, items: all.slice(mid) };
      if (isRenderableSlide(p1) && isRenderableSlide(p2)) return [p1, p2];
      return [{ ...s, items: all.slice(0, QA.MAX_BULLETS) }];
    }
    case "CODE_TOO_LONG": {
      const lines = (s.code || "").split("\n");
      if (lines.length <= QA.MAX_CODE_LINES * 2) {
        const mid = Math.ceil(lines.length / 2);
        const p1: Slide = { ...s, title: `${s.title} (1/2)`, code: lines.slice(0, mid).join("\n") };
        const p2: Slide = { ...s, title: `${s.title} (2/2)`, code: lines.slice(mid).join("\n") };
        if (isRenderableSlide(p1) && isRenderableSlide(p2)) return [p1, p2];
      }
      return [{ ...s, code: lines.slice(0, QA.MAX_CODE_LINES).join("\n") + "\n-- ... (ver material)" }];
    }
    case "LAYOUT_REPETITION": {
      const candidates: Layout[] = ["cards", "diagram", "process", "timeline", "twocol", "bullets"];
      for (const candidate of candidates) {
        if (candidate === s.layout) continue;
        const attempt: Slide = { ...s, layout: candidate };
        if (isRenderableSlide(attempt)) return [attempt];
      }
      return [s];
    }
    case "COMPARISON_UNSAFE": {
      const lI = nonEmpty(s.leftItems);
      const rI = nonEmpty(s.rightItems);
      const merged = [...lI, ...rI].slice(0, 8);
      const twocol: Slide = { ...s, layout: "twocol", items: merged, leftItems: undefined, rightItems: undefined };
      if (isRenderableSlide(twocol)) return [twocol];
      return [{ ...s, layout: "bullets", items: merged.slice(0, QA.MAX_BULLETS), leftItems: undefined, rightItems: undefined }];
    }
    case "EMPTY_SLIDE": {
      const rep = repairEmptySlide(s, moduleContent);
      // Return empty array to signal "drop this slide"
      return isRenderableSlide(rep) ? [rep] : [];
    }
    default:
      return [s];
  }
}

// ── Level 3 — Local LLM rewrite ─────────────────────────────
/**
 * Call Gemini to rewrite a single problematic slide's content.
 * Only triggered for CRITICAL issues surviving L1+L2.
 * Falls back silently to the original slide if Gemini fails.
 */
async function l3LocalRewrite(
  s: Slide,
  issue: QAIssue,
  geminiKey: string,
  courseTopic = "",
  moduleTitle = "",
): Promise<Slide> {
  // ── Domain-aware skip list (v5.1) ─────────────────────────
  // Some issue types are dangerous for LLM rewrite because they tend
  // to produce generic content or contaminate the course domain.
  // For these, we keep the deterministic L1/L2 fix and skip the LLM.
  const SKIP_LLM: QAIssueType[] = [
    "DOMAIN_CONTAMINATION", // already structurally fixed
    "INCOMPLETE_CODE",      // code rewrite is too risky without source
    "GENERIC_LEARNING_OBJECTIVE",
    "GENERIC_OBJECTIVE",
  ];
  if (SKIP_LLM.includes(issue.type)) {
    console.log(`[V5-QA-L3] Skipping LLM rewrite for ${issue.type} (deterministic fix already applied)`);
    return s;
  }

  const allowedDomain = inferCourseDomain(courseTopic, moduleTitle);
  const domainHint =
    allowedDomain === "python" ? "Python (NUNCA gere SQL/DDL como CREATE TABLE, ALTER, DROP)." :
    allowedDomain === "sql"    ? "SQL." :
    allowedDomain === "javascript" ? "JavaScript/TypeScript." :
    allowedDomain === "java"   ? "Java." :
    "do tema do curso (NÃO mude de assunto).";

  const contentSummary = [
    s.code   ? `CODE:\n${s.code.slice(0, 400)}`                               : null,
    s.items?.length  ? `ITEMS:\n${(s.items || []).slice(0, 8).join("\n")}`     : null,
    s.leftItems?.length  ? `LEFT:\n${(s.leftItems  || []).join("\n")}`         : null,
    s.rightItems?.length ? `RIGHT:\n${(s.rightItems || []).join("\n")}`        : null,
  ].filter(Boolean).join("\n");

  const safeTitle = (s.title || "Slide").replace(/"/g, "'");
  const prompt = `Você é editor de slides educativos do curso "${courseTopic}".
Módulo atual: "${moduleTitle}".
Domínio permitido: ${domainHint}

O slide abaixo tem problema: "${issue.type}: ${issue.message}".

Slide atual — título: "${safeTitle}" | layout: ${s.layout}
${contentSummary}

Regras OBRIGATÓRIAS:
- Mantenha o domínio do curso. Não introduza tecnologias de outro tema.
- 4-5 bullets concisos (máx 20 palavras cada) em português.
- Sem placeholders, sem [[...]], sem {{...}}, sem "lorem ipsum".
- Sem objetivos genéricos como "Compreender X" ou "Aprender sobre Y".
- Preserve conteúdo técnico essencial. NUNCA corte SELECT *, COUNT(*), SUM(*).

Responda SOMENTE com JSON válido sem markdown:
{"title":"${safeTitle}","items":["item1","item2","item3","item4"]}`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 400 },
        }),
      },
    );
    if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}`);
    const data = await resp.json();
    const raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in Gemini L3 response");
    const parsed = JSON.parse(jsonMatch[0]);
    const newItems: string[] = Array.isArray(parsed.items)
      ? parsed.items
          .filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 3)
          .map((t: string) => removeOrBlockPlaceholders(t))
          .filter((t: string) => t.length > 3 && !BAD_OBJECTIVE_RE.test(t))
          .slice(0, 6)
      : [];
    if (newItems.length < 3) {
      throw new Error(`LLM returned only ${newItems.length} usable items`);
    }
    // ── Post-rewrite domain veto ─────────────────────────────
    const candidate: Slide = { ...s, layout: "bullets", items: newItems, code: undefined };
    const contam2 = detectDomainContamination(candidate, allowedDomain, moduleTitle);
    if (contam2.contaminated) {
      console.warn(`[V5-QA-L3] Rejected rewrite (domain contamination: ${contam2.reason})`);
      return s;
    }
    console.log(`[V5-QA-L3] Rewrote "${s.title}" via Gemini (${newItems.length} items)`);
    return candidate;
  } catch (err) {
    console.warn(`[V5-QA-L3] Rewrite failed for "${s.title}": ${err instanceof Error ? err.message : String(err)}`);
    return s; // unchanged — runPptxQA final pass will handle it
  }
}

// ── Cascade orchestrator ─────────────────────────────────────
/**
 * resolveQAIssues — three-level QA resolution cascade.
 *
 * Receives the QA-repaired slides and the initial QAReport.
 * Runs up to 2 cycles of (L1 → QA → L2 → QA).
 * After 2 cycles, applies L3 (local Gemini rewrite) for remaining CRITICALs.
 * Final runPptxQA pass ensures no broken slide reaches the renderer.
 */
async function resolveQAIssues(
  slides: Slide[][],
  qaReport: QAReport,
  moduleContents: string[],
  geminiKey: string,
  courseTopic = "",
  moduleTitles: string[] = [],
): Promise<{ resolvedSlides: Slide[][]; finalReport: QAReport }> {
  if (qaReport.issues.length === 0) {
    return { resolvedSlides: slides, finalReport: qaReport };
  }

  let current: Slide[][] = slides.map((mod) => mod.map((s) => ({ ...s })));
  let lastReport = qaReport;

  for (let cycle = 0; cycle < 2; cycle++) {
    if (lastReport.issues.length === 0) break;
    console.log(`[V5-QA-CASCADE] Cycle ${cycle + 1} start | unfixed=${lastReport.issues.length}`);

    // ── Level 1: visual fixes (no splits) ─────────────────
    for (const issue of lastReport.issues) {
      const pos = parseSlideId(issue.slideId);
      if (!pos) continue;
      const { mi, si } = pos;
      if (!current[mi] || si >= current[mi].length) continue;
      current[mi][si] = l1VisualFix(
        current[mi][si],
        issue,
        moduleContents[mi] ?? "",
        moduleTitles[mi] ?? "",
        courseTopic,
      );
    }
    const { repairedSlides: afterL1, report: reportL1 } = runPptxQA(current, moduleContents, courseTopic, moduleTitles);
    current = afterL1;
    console.log(`[V5-QA-CASCADE] After L1 (cycle ${cycle + 1}): unfixed=${reportL1.issues.length}`);
    if (reportL1.issues.length === 0) { lastReport = reportL1; break; }

    // ── Level 2: layout replanning (may split/drop slides) ─
    for (let mi = 0; mi < current.length; mi++) {
      // Collect replacements for this module, indexed by current si
      const mIssues = reportL1.issues.filter((iss) => {
        const p = parseSlideId(iss.slideId);
        return p !== null && p.mi === mi && p.si < current[mi].length;
      });
      if (mIssues.length === 0) continue;

      // Deduplicate: one replacement per si (first issue wins)
      const seen = new Set<number>();
      const replacements: Array<{ si: number; slides: Slide[] }> = [];
      for (const issue of mIssues) {
        const pos = parseSlideId(issue.slideId)!;
        if (seen.has(pos.si)) continue;
        seen.add(pos.si);
        const repl = l2Replan(current[mi][pos.si], issue, moduleContents[mi] ?? "");
        if (repl.length !== 1 || repl[0] !== current[mi][pos.si]) {
          replacements.push({ si: pos.si, slides: repl });
        }
      }

      // Apply in descending order so earlier indices stay valid
      for (const { si, slides: repl } of replacements.sort((a, b) => b.si - a.si)) {
        current[mi].splice(si, 1, ...repl); // repl=[] drops the slide
      }
    }

    const { repairedSlides: afterL2, report: reportL2 } = runPptxQA(current, moduleContents, courseTopic, moduleTitles);
    current = afterL2;
    lastReport = reportL2;
    console.log(`[V5-QA-CASCADE] After L2 (cycle ${cycle + 1}): unfixed=${lastReport.issues.length}`);
  }

  // ── Level 3: local LLM rewrite for surviving CRITICALs ──
  const criticals = lastReport.issues.filter((i) => i.severity === "CRITICAL");
  if (criticals.length > 0) {
    console.log(`[V5-QA-CASCADE] Level 3 LLM rewrite: ${criticals.length} critical slide(s)`);

    const tasks = criticals
      .map((issue) => {
        const pos = parseSlideId(issue.slideId);
        if (!pos) return null;
        const { mi, si } = pos;
        if (!current[mi] || si >= current[mi].length) return null;
        return { issue, mi, si };
      })
      .filter((t): t is { issue: QAIssue; mi: number; si: number } => t !== null);

    // Batch in groups of 3 (avoid overwhelming Gemini quota)
    for (let b = 0; b < tasks.length; b += 3) {
      const batch = tasks.slice(b, b + 3);
      const settled = await Promise.allSettled(
        batch.map(({ issue, mi, si }) =>
          l3LocalRewrite(current[mi][si], issue, geminiKey, courseTopic, moduleTitles[mi] ?? "")
            .then((s) => ({ mi, si, s }))
        ),
      );
      for (const res of settled) {
        if (res.status === "fulfilled") {
          current[res.value.mi][res.value.si] = res.value.s;
        }
      }
    }

    // Final QA pass after L3
    const { repairedSlides: afterL3, report: reportL3 } = runPptxQA(current, moduleContents, courseTopic, moduleTitles);
    current = afterL3;
    lastReport = reportL3;
    console.log(`[V5-QA-CASCADE] After L3: status=${lastReport.status} unfixed=${lastReport.issues.length}`);
  }

  // ── Final safety net: isRenderableSlide hard filter ──────
  // runPptxQA already enforces this, but we double-check here.
  for (let mi = 0; mi < current.length; mi++) {
    const before = current[mi].length;
    current[mi] = current[mi].filter(isRenderableSlide);
    const dropped = before - current[mi].length;
    if (dropped > 0) {
      console.warn(`[V5-QA-CASCADE] Safety filter: dropped ${dropped} unrenderable slide(s) in module ${mi + 1}`);
    }
  }

  console.log(
    `[V5-QA-CASCADE] Complete: status=${lastReport.status} | unfixed=${lastReport.issues.length} | fixed=${lastReport.fixedIssues.length}`,
  );
  return { resolvedSlides: current, finalReport: lastReport };
}

// ═══════════════════════════════════════════════════════════
// SECTION 6E: QA VETO (Architectural correction v5.1)
// Final hard gate — blocks export if any CRITICAL issue from the
// hard-constraint set survives the resolution cascade.
// ═══════════════════════════════════════════════════════════

interface QAVetoResult {
  blocked:        boolean;
  blockingIssues: QAIssue[];
  totalSlides:    number;
  removedSlides:  number;
}

const HARD_CRITICAL_TYPES: ReadonlySet<QAIssueType> = new Set<QAIssueType>([
  "DOMAIN_CONTAMINATION",
  "INCOMPLETE_CODE",
  "PLACEHOLDER_RESIDUAL",
  "EMPTY_SLIDE",
  "UNREADABLE_SLIDE",
  "EXTREME_DENSITY",
  "BROKEN_COMPARISON",
  // Spec-required additions (architect review v5.1):
  "TITLE_FRAGMENT",
  "GENERIC_OBJECTIVE",
  "GENERIC_LEARNING_OBJECTIVE",
  // v5.1 hardening pass 2:
  "TECHNICAL_SANITIZATION_DAMAGE",
  // v5.1.5 hardening pass 5 — semantically broken technical sentences
  // (e.g. "Capture erros específicos como.", "Verifica X com.") that
  // cannot be auto-repaired must block export rather than ship truncated.
  "TECHNICAL_SEMANTIC_BREAK",
  // v5.1.6 hardening pass 6 — broken Portuguese ("Que Adotar..." sem "Por")
  "BROKEN_LANGUAGE_STRUCTURE",
]);

function qaVeto(
  finalReport: QAReport,
  finalSlides: Slide[][],
  originalCount: number,
  extraCovers?: Slide[],
): QAVetoResult {
  const totalSlides   = finalSlides.reduce((a, m) => a + m.length, 0);
  const removedSlides = Math.max(0, originalCount - totalSlides);

  // Per-slide residual placeholder check (defence in depth)
  const placeholderIssues: QAIssue[] = [];
  for (let mi = 0; mi < finalSlides.length; mi++) {
    for (let si = 0; si < finalSlides[mi].length; si++) {
      const s = finalSlides[mi][si];
      const ph = slideHasResidualPlaceholder(s);
      if (ph.found) {
        placeholderIssues.push({
          slideId: `M${mi + 1}.S${si + 1}`,
          type: "PLACEHOLDER_RESIDUAL",
          severity: "CRITICAL",
          message: `Placeholder residual "${ph.sample}" em "${s.title}"`,
          resolutionStrategy: "Bloqueio de export — sanitizer não conseguiu remover marker",
        });
      }
    }
  }
  // v5.1.9: also scan module covers for residual placeholders
  if (extraCovers) {
    for (let mi = 0; mi < extraCovers.length; mi++) {
      const c = extraCovers[mi];
      const ph = slideHasResidualPlaceholder(c);
      if (ph.found) {
        placeholderIssues.push({
          slideId: `M${mi + 1}.COVER`,
          type: "PLACEHOLDER_RESIDUAL",
          severity: "CRITICAL",
          message: `Placeholder residual "${ph.sample}" em cover "${c.title}"`,
          resolutionStrategy: "Bloqueio de export — sanitizer não conseguiu remover marker",
        });
      }
    }
  }

  const blockingIssues = [
    ...finalReport.issues.filter(
      (i) => i.severity === "CRITICAL" && HARD_CRITICAL_TYPES.has(i.type),
    ),
    ...placeholderIssues,
  ];

  // Empty deck is also a veto trigger
  if (totalSlides === 0) {
    blockingIssues.push({
      slideId: "DECK", type: "EMPTY_SLIDE", severity: "CRITICAL",
      message: "Deck final ficou sem slides após QA",
      resolutionStrategy: "Bloqueio de export — todos os slides removidos pelo cascade",
    });
  }

  const blocked = blockingIssues.length > 0;
  console.log(
    `[V5-QA-VETO] blocked=${blocked} | blockingIssues=${blockingIssues.length} | totalSlides=${totalSlides} | removedSlides=${removedSlides}`,
  );
  for (const i of blockingIssues.slice(0, 12)) {
    console.warn(`[V5-QA-VETO] BLOCK ${i.type} @ ${i.slideId} — ${i.message}`);
  }
  return { blocked, blockingIssues, totalSlides, removedSlides };
}

// Custom error thrown when qaVeto blocks the export. Caught by the
// HTTP handler and converted into a structured 422 response.
class PptxQAVetoError extends Error {
  result: QAVetoResult;
  constructor(result: QAVetoResult) {
    super(`PPTX QA Veto: ${result.blockingIssues.length} blocking issue(s)`);
    this.name = "PptxQAVetoError";
    this.result = result;
  }
}

/**
 * Returns true if any slide in any module still contains an un-filled
 * placeholder like {{COURSE_TITLE}} or {{BULLET_1}}.
 * When detected, the pipeline logs a warning and forces default_v5 caps.
 */
function hasResidualPlaceholders(slides: Slide[][]): boolean {
  for (const module of slides) {
    for (const s of module) {
      const texts: (string | undefined)[] = [
        s.title,
        s.subtitle,
        s.label,
        ...(s.items ?? []),
        s.code,
        s.leftHeader,
        s.rightHeader,
        ...(s.leftItems ?? []),
        ...(s.rightItems ?? []),
      ];
      for (const t of texts) {
        if (t && TEMPLATE_PH_RE.test(t)) return true;
      }
    }
  }
  return false;
}

async function runPipeline(
  courseTitle: string,
  modules: { title: string; content: string }[],
  design: Design,
  density: string,
  language: string,
  geminiKey: string,
  selectedTemplate: string,
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

  // Suppress unused-var lint when planner short-circuits processBatch.
  void slideCache; void moduleHashKey; void processBatch;

  // ── PRESENTATION PLANNER (v5.2.0) ─────────────────────────────────────
  // Try the new structured planner first. It enforces per-module domain
  // rules (e.g. no SQL in a Python "Estruturas de Dados" module), concrete
  // learning objectives, single-idea-per-slide, code-in-code-field, and
  // dedup — BEFORE the renderer ever sees the slides. Reduces the load on
  // the regex-heavy QA cascade.
  //
  // SAFETY: any failure (planner exception, validation fatal, empty output
  // for ≥1 module) falls back silently to the legacy generateModuleSlides
  // pipeline. The QA veto remains active either way.
  const allModuleSlides: Slide[][] = new Array(modules.length);
  // Per-module decision: which indices get planner output vs legacy fallback.
  // null = decide later (planner threw); true = planner ok; false = fallback.
  const moduleUsesPlanner: (boolean | null)[] = new Array(modules.length).fill(null);
  const fallbackIndices: number[] = [];

  try {
    const { plan, stats, validation } = await generatePresentationPlan({
      courseTitle, modules, language, geminiKey,
    });
    console.log(
      `[PRESENTATION-PLAN] modules=${stats.module_count} | slides=${stats.slide_count} | intents=${JSON.stringify(stats.intents_breakdown)} | repaired_objectives=${stats.repaired_objectives} | blocked_contamination=${stats.blocked_contamination} | moved_code=${stats.moved_code} | removed_duplicates=${stats.removed_duplicates} | removed_truncated=${stats.removed_truncated} | capped_bullets=${stats.capped_bullets} | capped_code=${stats.capped_code} | modules_failed=${stats.modules_failed}`,
    );
    console.log(
      `[PRESENTATION-PLAN-VALIDATION] ${validation.passed ? "PASSED" : "FAILED"} | issues=${JSON.stringify(validation.byType)}`,
    );

    // PER-MODULE GATE — accept the planner module-by-module instead of
    // all-or-nothing. A module is accepted ONLY if:
    //   (a) it has between 1 and 5 slides, AND
    //   (b) no fatal validation issue affects this module, AND
    //   (c) no residual semantic blocker (DOMAIN_CONTAMINATION /
    //       SQL_IN_PYTHON / GENERIC_OBJECTIVE / CODE_IN_BULLET /
    //       TRUNCATED_SENTENCE) affects this module.
    // Modules that fail the gate fall back to legacy generateModuleSlides
    // for that index ONLY — the rest of the deck still benefits from the
    // planner's clean output.
    const SEMANTIC_BLOCKERS = new Set([
      "DOMAIN_CONTAMINATION", "SQL_IN_PYTHON", "GENERIC_OBJECTIVE",
      "CODE_IN_BULLET", "TRUNCATED_SENTENCE",
    ]);
    const fatalsByModule = new Map<number, number>();
    const blockersByModule = new Map<number, number>();
    for (const issue of validation.issues) {
      if (issue.severity === "fatal") {
        fatalsByModule.set(issue.moduleIndex, (fatalsByModule.get(issue.moduleIndex) ?? 0) + 1);
      }
      if (SEMANTIC_BLOCKERS.has(issue.type)) {
        blockersByModule.set(issue.moduleIndex, (blockersByModule.get(issue.moduleIndex) ?? 0) + 1);
      }
    }

    const v5Like: V5SlideLike[][] = presentationPlanToV5Slides(plan);
    let acceptedCount = 0;
    for (let i = 0; i < modules.length; i++) {
      const planSlides = plan.modules[i]?.slides ?? [];
      const slideCount = planSlides.length;
      const hasFatal = (fatalsByModule.get(i) ?? 0) > 0;
      const hasBlocker = (blockersByModule.get(i) ?? 0) > 0;
      const inRange = slideCount >= 1 && slideCount <= 4;

      if (inRange && !hasFatal && !hasBlocker) {
        // Convert this module's slides to v5 Slide shape
        allModuleSlides[i] = v5Like[i].map((s): Slide => ({
          layout: s.layout as Layout,
          title: cleanSlideTitle(s.title.slice(0, 80), modules[i].title),
          label: (s.label ?? "CONTEÚDO").slice(0, 32).toUpperCase(),
          items: (s.items ?? [])
            .map((x) => safeItemText(globalSanitize(x), 105))
            .filter((x) => x.length > 0),
          code: s.code ? validateCodeIntegrity(s.code.slice(0, 1200)) : undefined,
          codeLabel: s.codeLabel ? s.codeLabel.slice(0, 20) : (s.code ? "Python" : undefined),
          leftHeader: s.leftHeader ? globalSanitize(s.leftHeader).slice(0, 40) : undefined,
          rightHeader: s.rightHeader ? globalSanitize(s.rightHeader).slice(0, 40) : undefined,
          leftItems: s.leftItems
            ? s.leftItems.map((x) => globalSanitize(x).slice(0, 90)).filter((x) => x.length > 0)
            : undefined,
          rightItems: s.rightItems
            ? s.rightItems.map((x) => globalSanitize(x).slice(0, 90)).filter((x) => x.length > 0)
            : undefined,
          moduleIndex: i,
        }));
        moduleUsesPlanner[i] = true;
        acceptedCount++;
      } else {
        moduleUsesPlanner[i] = false;
        fallbackIndices.push(i);
        console.warn(
          `[PRESENTATION-PLAN] module ${i + 1} ("${modules[i].title}") rejected: slides=${slideCount} (in 1-4: ${inRange}), fatals=${fatalsByModule.get(i) ?? 0}, blockers=${blockersByModule.get(i) ?? 0} → legacy fallback for this module only`,
        );
      }
    }
    console.log(
      `[PRESENTATION-PLAN] per-module gate: accepted=${acceptedCount}/${modules.length} | fallback_indices=${JSON.stringify(fallbackIndices.map((i) => i + 1))}`,
    );
  } catch (e: any) {
    console.warn(`[PRESENTATION-PLAN] threw, falling back ALL modules: ${e?.message ?? e}`);
    for (let i = 0; i < modules.length; i++) {
      moduleUsesPlanner[i] = false;
      fallbackIndices.push(i);
    }
  }

  // Run legacy generateModuleSlides for ONLY the modules that need it.
  if (fallbackIndices.length > 0) {
    const BATCH_SIZE = 3;
    for (let b = 0; b < fallbackIndices.length; b += BATCH_SIZE) {
      const batchIndices = fallbackIndices.slice(b, b + BATCH_SIZE);
      const results = await processBatch(batchIndices);
      for (const { i, slides } of results) {
        allModuleSlides[i] = slides;
      }
    }
  }

  // Planner-accepted modules still flow through the existing downstream
  // guards (split / variety / semantic gate) so they get the same polish
  // as legacy modules.
  for (let i = 0; i < allModuleSlides.length; i++) {
    if (moduleUsesPlanner[i] !== true) continue; // legacy already polished
    const split = splitOverflowSlides(allModuleSlides[i]);
    const varied = applyLayoutVariety(split);
    const aligned = varied.map((s) => validateSemanticAlignment(s, modules[i].title));
    allModuleSlides[i] = aligned
      .map((s) => semanticQualityGate(s, modules[i].title))
      .filter((s): s is Slide => s !== null);
  }

  // ── v5.1.9 — PRE-BUILD MODULE COVER SLIDES ─────────────────
  // Module covers were previously constructed inline at render time
  // via extractCompetencies(...), bypassing QA/repair/safety entirely.
  // Build them upfront so the repair pipeline + safety net inspect
  // (and can block) the actual competency strings that will render.
  const moduleCovers: Slide[] = modules.map((m, i) => {
    const cleanTitle =
      m.title.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || m.title;
    return {
      layout: "module_cover",
      title: cleanTitle,
      moduleIndex: i,
      competencies: extractCompetencies(m.content, cleanTitle),
    } as Slide & { moduleIndex: number; competencies: string[] };
  });

  // ── TEMPLATE RESOLUTION ──────────────────────────────────────────────────
  // Resolve which template to use, then apply adaptive splits so that no slide
  // exceeds the template's item limits.  This runs AFTER allModuleSlides is
  // fully built so we can also run the placeholder safety check.
  const resolvedTemplate = resolveTemplateForCourse(selectedTemplate, modules.length);
  let caps = TEMPLATE_CAPABILITIES[resolvedTemplate] ?? TEMPLATE_CAPABILITIES.default_v5;

  // Placeholder safety gate: if any slide contains un-filled {{PLACEHOLDERS}},
  // force the most permissive (default_v5) capabilities.
  if (hasResidualPlaceholders(allModuleSlides)) {
    console.warn("[V5-TEMPLATE] Residual placeholders detected — forcing default_v5 caps");
    caps = TEMPLATE_CAPABILITIES.default_v5;
  }

  // Apply splits for process / takeaways / cards per template limits
  for (let i = 0; i < allModuleSlides.length; i++) {
    allModuleSlides[i] = splitSlidesForTemplate(allModuleSlides[i], caps);
  }
  console.log(
    `[V5-TEMPLATE] Splits applied | template=${resolvedTemplate} | processMax=${caps.processSteps} | takeawaysMax=${caps.takeaways} | cardsMax=${caps.cards}`,
  );
  // ─────────────────────────────────────────────────────────────────────────

  // ── PPTX QA ENGINE + RESOLUTION CASCADE ─────────────────────────────────
  // Step 1: initial 11-point QA pass (auto-fixes WARNINGs in-place).
  // Step 2: if unfixed issues remain, run 3-level resolution cascade:
  //   L1 visual fixes → re-QA → L2 layout replanning → re-QA (×2 cycles)
  //   L3 local Gemini rewrite for surviving CRITICALs.
  // Final isRenderableSlide filter guarantees no broken slide reaches renderer.
  const moduleTitlesArr = modules.map((m) => m.title);
  const moduleContentsArr = modules.map((m) => m.content);
  const originalSlideCount = allModuleSlides.reduce((a, m) => a + m.length, 0);

  // Pre-QA placeholder sanitization pass (architectural correction v5.1).
  // Strips orphan [[BT0]]/[[BT1]]/{{TOKEN}}/lorem ipsum from every text
  // field BEFORE QA runs, so subsequent checks see clean content.
  for (let mi = 0; mi < allModuleSlides.length; mi++) {
    allModuleSlides[mi] = allModuleSlides[mi].map(sanitizeSlidePlaceholders);
  }

  // ── Pre-QA TECHNICAL DAMAGE REPAIR (v5.1.4) ──────────────────────────
  // Deterministic, domain-aware reconstruction of "verb ()" / ", ," patterns
  // BEFORE qa runs. The QA still runs afterwards and the veto still blocks
  // anything we couldn't fix — we never loosen the gate, we just give the
  // repairer a chance to recover known damage from context.
  // ── Pre-QA repair pass (v5.1.6) ───────────────────────────
  // Mirrors the post-cascade pipeline so initial QA sees already-cleaned
  // slides. Catches damage from sanitization/LLM before it gets logged
  // as an issue.
  for (let mi = 0; mi < allModuleSlides.length; mi++) {
    const mTitle = moduleTitlesArr[mi] ?? "";
    allModuleSlides[mi] = allModuleSlides[mi].map((s, si) => {
      const sid = `module_${mi + 1}_slide_${si + 1}`;
      let out = repairSlideTechnicalDamage(s, mTitle, courseTitle, sid);
      out = repairSlideSemanticBreaks(out, mTitle, courseTitle, sid);
      out = repairSlideLearningObjectives(out, mTitle, courseTitle);
      out = repairSlideBrokenLanguage(out, sid);
      // v5.1.14: deterministic SQL strip (drops contaminated items)
      out = stripSqlContaminationFromSlide(out, inferCourseDomain(courseTitle), mTitle, sid);
      return out;
    });
  }

  // v5.1.9: same repair pipeline for pre-built module covers
  for (let mi = 0; mi < moduleCovers.length; mi++) {
    const mTitle = moduleTitlesArr[mi] ?? "";
    const sid = `module_${mi + 1}_cover`;
    let c = sanitizeSlidePlaceholders(moduleCovers[mi]);
    c = repairSlideTechnicalDamage(c, mTitle, courseTitle, sid);
    c = repairSlideSemanticBreaks(c, mTitle, courseTitle, sid);
    c = repairSlideLearningObjectives(c, mTitle, courseTitle);
    c = repairSlideBrokenLanguage(c, sid);
    c = stripSqlContaminationFromSlide(c, inferCourseDomain(courseTitle), mTitle, sid);
    moduleCovers[mi] = c;
  }

  const { repairedSlides: qaSlides, report: qaReport } = runPptxQA(
    allModuleSlides,
    moduleContentsArr,
    courseTitle,
    moduleTitlesArr,
  );
  for (let i = 0; i < qaSlides.length; i++) {
    allModuleSlides[i] = qaSlides[i];
  }
  console.log(
    `[V5-QA] Initial pass: status=${qaReport.status} | issues=${qaReport.issues.length} | fixed=${qaReport.fixedIssues.length} | courseDomain=${inferCourseDomain(courseTitle)}`,
  );

  let cascadeReport: QAReport = qaReport;
  if (qaReport.issues.length > 0) {
    // Unfixed issues remain — run resolution cascade
    const { resolvedSlides, finalReport } = await resolveQAIssues(
      allModuleSlides,
      qaReport,
      moduleContentsArr,
      geminiKey,
      courseTitle,
      moduleTitlesArr,
    );
    for (let i = 0; i < resolvedSlides.length; i++) {
      allModuleSlides[i] = resolvedSlides[i];
    }
    cascadeReport = finalReport;
    console.log(
      `[V5-QA-CASCADE] Final: status=${finalReport.status} | unfixed=${finalReport.issues.length} | fixed=${finalReport.fixedIssues.length}`,
    );
  } else {
    console.log("[V5-QA] All issues resolved in initial pass — cascade skipped");
  }

  // Post-cascade safety sanitization pass — guarantees no residual
  // placeholder reaches the renderer even if a cascade level produced one.
  for (let mi = 0; mi < allModuleSlides.length; mi++) {
    allModuleSlides[mi] = allModuleSlides[mi].map(sanitizeSlidePlaceholders);
  }

  // ── Final repair pass (v5.1.6) ─────────────────────────────────────
  // Last chance before the veto. Runs sequentially:
  //   (a) repairSlideTechnicalDamage     — empty-paren / orphan-punct
  //   (b) repairSlideSemanticBreaks      — "como.", "com.", "(Ex: )"
  //   (c) repairSlideLearningObjectives  — concrete objective rewrite
  //   (d) repairSlideBrokenLanguage      — "Que Adotar..." → "Por Que..."
  // Then dedupeSemanticDuplicates collapses any near-duplicate slides.
  for (let mi = 0; mi < allModuleSlides.length; mi++) {
    const mTitle = moduleTitlesArr[mi] ?? "";
    allModuleSlides[mi] = allModuleSlides[mi].map((s, si) => {
      const sid = `module_${mi + 1}_slide_${si + 1}.post`;
      let out = repairSlideTechnicalDamage(s, mTitle, courseTitle, sid);
      out = repairSlideSemanticBreaks(out, mTitle, courseTitle, sid);
      out = repairSlideLearningObjectives(out, mTitle, courseTitle);
      out = repairSlideBrokenLanguage(out, sid);
      out = stripSqlContaminationFromSlide(out, inferCourseDomain(courseTitle), mTitle, sid);
      return out;
    });
  }
  const dedupe = dedupeSemanticDuplicates(allModuleSlides);
  if (dedupe.removed > 0) {
    for (let i = 0; i < dedupe.result.length; i++) allModuleSlides[i] = dedupe.result[i];
    console.log(`[V5-DEDUPE] Total redundant slides removed: ${dedupe.removed}`);
  }

  // ── RE-RUN QA after the final repair so qaVeto sees the current state.
  // Without this, the veto consumes the stale cascadeReport and would
  // (a) block slides we just fixed, or (b) miss damage introduced after
  // cascade. We reuse runPptxQA's full battery of CRITICAL checks.
  const { repairedSlides: postRepairSlides, report: postRepairReport } = runPptxQA(
    allModuleSlides,
    moduleContentsArr,
    courseTitle,
    moduleTitlesArr,
  );
  for (let i = 0; i < postRepairSlides.length; i++) {
    allModuleSlides[i] = postRepairSlides[i];
  }
  cascadeReport = postRepairReport;
  console.log(
    `[V5-QA-POSTREPAIR] After final repair: status=${postRepairReport.status} | unfixed=${postRepairReport.issues.length} | fixed=${postRepairReport.fixedIssues.length}`,
  );

  // ── v5.1.8 — GLOBAL FIELD SAFETY NET ──────────────────────────────
  // Final pass: scan EVERY string field (extractAllStrings) of EVERY slide
  // against ALL hard detectors. Catches contamination/genericity/brokenness
  // that field-specific QA checks missed (competencies, takeaways subtitle,
  // cards/process nested, comparison left/right, etc).
  // v5.1.9: also re-run final repair pass on covers, then include them in safety net.
  for (let mi = 0; mi < moduleCovers.length; mi++) {
    const mTitle = moduleTitlesArr[mi] ?? "";
    const sid = `module_${mi + 1}_cover`;
    let c = sanitizeSlidePlaceholders(moduleCovers[mi]);
    c = repairSlideTechnicalDamage(c, mTitle, courseTitle, sid);
    c = repairSlideSemanticBreaks(c, mTitle, courseTitle, sid);
    c = repairSlideLearningObjectives(c, mTitle, courseTitle);
    c = repairSlideBrokenLanguage(c, sid);
    c = stripSqlContaminationFromSlide(c, inferCourseDomain(courseTitle), mTitle, sid);
    moduleCovers[mi] = c;
  }
  // Wrap each cover as its own pseudo-module so safety-net indexing keeps
  // the original module title aligned with each cover.
  const coverGroups: Slide[][] = moduleCovers.map((c) => [c]);
  const safetyNetIssues = [
    ...runGlobalFieldSafetyNet(
      allModuleSlides,
      inferCourseDomain(courseTitle),
      moduleTitlesArr,
    ),
    ...runGlobalFieldSafetyNet(
      coverGroups,
      inferCourseDomain(courseTitle),
      moduleTitlesArr,
    ).map((iss) => ({ ...iss, slideId: iss.slideId.replace(/^M(\d+)\.S1$/, "M$1.COVER") })),
  ];
  if (safetyNetIssues.length > 0) {
    console.log(`[V5-SAFETY-NET] ${safetyNetIssues.length} issue(s) escaped per-field checks:`);
    for (const i of safetyNetIssues.slice(0, 20)) {
      console.log(`[V5-SAFETY-NET]   - ${i.slideId} | ${i.type} | ${i.message.slice(0, 200)}`);
    }
    cascadeReport = {
      ...cascadeReport,
      status: "FAILED",
      issues: [...cascadeReport.issues, ...safetyNetIssues],
    };
  } else {
    console.log(`[V5-SAFETY-NET] Clean — no leakage detected by global field scan`);
  }

  // ── QA VETO ─────────────────────────────────────────────────────────────
  // Hard gate — blocks export if any CRITICAL hard-constraint issue
  // survives the cascade. The handler converts this into a 422 response
  // with structured details.
  const veto = qaVeto(cascadeReport, allModuleSlides, originalSlideCount, moduleCovers);
  if (veto.blocked) {
    throw new PptxQAVetoError(veto);
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Count actual total slides from generated content (for accurate footer numbers)
  const contentSlideCount = allModuleSlides.reduce(
    (s, m) => s + m.filter(isRenderableSlide).length + 1,
    0,
  ); // +1 per module cover
  // Compute how many TOC slides pagination will produce
  const tocPageCount = isFinite(caps.tocModules) && modules.length > caps.tocModules
    ? Math.ceil(modules.length / caps.tocModules)
    : 1;
  const totalSlides = 1 + tocPageCount + contentSlideCount + 1; // cover + toc page(s) + modules + closing
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

  // TOC — single or multi-page depending on template capability
  const tocPagesAdded = renderTOCPaginated(
    pptx,
    { layout: "toc", title: "Conteúdo" },
    design,
    slideNum + 1,           // first TOC page number
    totalSlides,
    modules,
    isFinite(caps.tocModules) ? caps.tocModules : Infinity,
  );
  slideNum += tocPagesAdded; // advance past all TOC pages

  // Modules
  for (let i = 0; i < modules.length; i++) {
    const cleanTitle =
      modules[i].title.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() ||
      modules[i].title;

    // v5.1.9: cover was pre-built and passed through repair + safety net + veto.
    // Render uses the QA'd version, NOT a fresh extractCompetencies() call.
    renderModuleCover(
      pptx,
      moduleCovers[i],
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
        case "comparison": {
          // renderComparison disabled — fallback to twocol with merged items
          const lI = nonEmpty(s.leftItems);
          const rI = nonEmpty(s.rightItems);
          const merged = [...lI, ...rI].slice(0, 8);
          const fallback: Slide = { ...s, layout: "twocol", items: merged.length >= 4 ? merged : merged.concat(lI).slice(0, 4), leftItems: undefined, rightItems: undefined };
          renderTwocol(pptx, fallback, design, ++slideNum, totalSlides);
          break;
        }
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
  // Compact QA summary for diagnostic transparency on the success path.
  // The veto already short-circuits when blocked; here we expose what was
  // detected and silently auto-repaired (so the user can see the engine
  // actually did work, even when no PPTX is blocked).
  const qaSummary = {
    qa_status: cascadeReport.status,                 // PASSED | WARNING | FAILED
    issues_unfixed: cascadeReport.issues.length,     // surviving (non-hard-critical)
    issues_fixed:   cascadeReport.fixedIssues.length,
    original_slides: originalSlideCount,
    rendered_slides: slideNum,
    removed_slides:  Math.max(0, originalSlideCount - allModuleSlides.reduce((a, m) => a + m.filter(isRenderableSlide).length, 0)),
    fixed_breakdown: (() => {
      const counts: Record<string, number> = {};
      for (const i of cascadeReport.fixedIssues) counts[i.type] = (counts[i.type] ?? 0) + 1;
      return counts;
    })(),
    unfixed_breakdown: (() => {
      const counts: Record<string, number> = {};
      for (const i of cascadeReport.issues) counts[i.type] = (counts[i.type] ?? 0) + 1;
      return counts;
    })(),
  };
  return { pptx, qaSummary };
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
    // Multi-template: if body.template matches a registered skin, use it as the selected template.
    // body.selectedTemplate takes priority when explicitly provided.
    const selectedTemplate: string =
      (body.selectedTemplate && body.selectedTemplate !== "default_v5")
        ? body.selectedTemplate
        : (SKIN_REGISTRY[template] ? template : "default_v5");

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
      selectedTemplate,
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

    const { pptx, qaSummary } = await runPipeline(
      courseTitle,
      moduleData,
      design,
      density,
      language,
      geminiKey,
      selectedTemplate,
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
        engine: "export-pptx-v4",
        engine_version: ENGINE_VERSION,
        status: "exported",
        fallback_used: false,            // v4 never falls back internally
        cache: "miss",                   // every export is a fresh build (filename has timestamp)
        slide_count: (repairDiag.slide_count as number) ?? 0,
        blocking_issues: [],             // empty on success path (veto would 422 otherwise)
        qa: qaSummary,                   // status / fixed / unfixed / removed_slides / breakdowns
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
    // ── QA VETO → 422 with structured details (architectural correction v5.1) ──
    if (error instanceof PptxQAVetoError) {
      const v = error.result;
      console.warn(
        `[V5-QA-VETO] HTTP 422 — blocking=${v.blockingIssues.length} totalSlides=${v.totalSlides}`,
      );
      return new Response(
        JSON.stringify({
          error:           "PPTX export blocked by quality veto",
          code:            "PPTX_QA_VETO",
          engine:          "export-pptx-v4",
          engine_version:  ENGINE_VERSION,
          status:          "blocked",
          fallback_used:   false,
          cache:           "miss",
          totalSlides:     v.totalSlides,
          removedSlides:   v.removedSlides,
          blockingIssues:  v.blockingIssues.map((i) => ({
            slideId: i.slideId,
            type:    i.type,
            message: i.message,
          })),
          hint:
            "O conteúdo gerado contém problemas críticos (placeholders, código incompleto, contaminação de domínio ou densidade extrema). Tente regenerar o curso ou ajustar os módulos.",
        }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
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
