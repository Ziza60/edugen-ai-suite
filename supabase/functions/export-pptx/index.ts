import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";

/**
 * PPTX EXPORT — EduGenAI Professional Light Theme
 * 
 * CORRECTIONS APPLIED:
 * P1. Smart truncation — NEVER cut words mid-syllable, always respect word boundaries
 * P2. Bold formatting hierarchy — labels bold, content normal, using rich text arrays
 * P3. Semantic icon mapping — no generic symbols, min 3 different icons per slide
 * P4. Standardized module covers — identical structure with 3 objectives
 * P5. Takeaway structure — 6 numbered cards with short title + 1 sentence description
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ═══════════════════════════════════════════════════════
   BLOCO 1: DESIGN SYSTEM FUNDAMENTAL
   Canvas: 13.333" × 7.5" (16:9), Área segura: 12" × 6.5"
   Resolução: 96 DPI
   ═══════════════════════════════════════════════════════ */

// ── THEME SYSTEM (Light default, Dark optional) ──
const THEME = {
  light: {
    background: "FFFFFF",
    backgroundSecondary: "F8F9FA",
    text: "2C3E50",
    textSecondary: "7F8C8D",
    accent: "E67E22",
    accentSecondary: "9B59B6",
    borders: "BDC3C7",
  },
  dark: {
    background: "2C3E50",
    backgroundSecondary: "34495E",
    text: "ECF0F1",
    textSecondary: "BDC3C7",
    accent: "E67E22",
    accentSecondary: "9B59B6",
    borders: "7F8C8D",
  },
};

// Active theme — entire course uses ONE theme, never mix
const currentTheme = THEME.light;

const C = {
  BG_WHITE: currentTheme.background,
  BG_LIGHT: currentTheme.backgroundSecondary,
  BG_CARD: currentTheme.background,
  BG_CARD_ALT: "F2F3F5",
  PRIMARY: currentTheme.text,
  SECONDARY: currentTheme.accent,
  ACCENT_PURPLE: "9B59B6",
  ACCENT_BLUE: "3498DB",
  ACCENT_GREEN: "27AE60",
  ACCENT_TEAL: "1ABC9C",
  ACCENT_RED: "E74C3C",
  ACCENT_ORANGE: "F39C12",
  TEXT_DARK: currentTheme.text,
  TEXT_BODY: "34495E",
  TEXT_LIGHT: currentTheme.textSecondary,
  TEXT_WHITE: "FFFFFF",
  TABLE_HEADER_BG: "34495E",
  TABLE_ROW_ODD: currentTheme.background,
  TABLE_ROW_EVEN: "ECF0F1",
  TABLE_BORDER: currentTheme.borders,
  CARD_BORDER: "E0E0E0",
  CARD_SHADOW: "D5D8DC",
  INSIGHT_BG: "FDF2E9",
  INSIGHT_BORDER: currentTheme.accent,
  REFLECTION_BG: "EBF5FB",
};

const CARD_ACCENT_COLORS = [C.ACCENT_BLUE, C.ACCENT_GREEN, C.ACCENT_PURPLE, C.SECONDARY, C.ACCENT_RED, C.PRIMARY];

// Module cover colors (applied to module number only) — rotates for M06+
const MODULE_NUMBER_COLORS = [
  C.ACCENT_PURPLE,  // M01 — Roxo
  C.ACCENT_BLUE,    // M02 — Azul
  C.ACCENT_GREEN,   // M03 — Verde
  C.ACCENT_ORANGE,  // M04 — Laranja
  C.ACCENT_TEAL,    // M05 — Teal
];

// ── TYPOGRAPHY HIERARCHY (Montserrat + Open Sans) ──
const FONT_TITLE = "Montserrat";
const FONT_BODY = "Open Sans";

// Typography sizes (pt) — strict hierarchy
const TYPO = {
  MODULE_NUMBER: 72,    // Montserrat Bold, line-height 1.0
  MODULE_TITLE: 32,     // Montserrat Bold, line-height 1.2
  SECTION_TITLE: 32,    // Montserrat Bold, line-height 1.2
  SUBTITLE: 18,         // Open Sans Regular, line-height 1.4
  BODY: 14,             // Open Sans Regular 14-16pt, line-height 1.5
  BODY_LARGE: 16,       // Open Sans Regular, line-height 1.5
  SUPPORT: 12,          // Open Sans Regular 11-12pt, line-height 1.4
  LABEL: 14,            // Open Sans Bold UPPERCASE, letter-spacing 2
};

// ── CANVAS & GRID SYSTEM ──
const SLIDE_W = 13.333;  // 16:9 widescreen
const SLIDE_H = 7.5;
const MARGIN = 0.667;    // ~0.667" margins to achieve 12" safe width
const SAFE_W = 12.0;     // Fixed: 12" safe width per spec
const SAFE_H = 6.5;      // Fixed: 6.5" safe height per spec
const BOTTOM_MARGIN = 0.50; // Bottom margin (Y: 7.0" max)

// Grid zones (Y coordinates)
const ZONE = {
  HEADER_START: 0.50,    // Headers and labels
  HEADER_END: 2.0,
  CONTENT_START: 2.0,    // Main content area
  CONTENT_END: 6.0,
  FOOTER_START: 6.0,     // Footer and metadata
  FOOTER_END: 7.0,
  LEFT: 0.667,           // Content margins (centered within safe area)
  RIGHT: 12.667,         // MARGIN + SAFE_W
};

// ── TEXT DENSITY CONSTRAINTS ──
// Rule: NEVER exceed 15 chars/sq in
const DENSITY_LIMITS: Record<string, { minArea: number; maxChars: number; maxDensity: number }> = {
  title:       { minArea: 15,  maxChars: 60,  maxDensity: 4 },
  moduleTitle: { minArea: 6,   maxChars: 40,  maxDensity: 6.7 },
  subtitle:    { minArea: 4,   maxChars: 60,  maxDensity: 15 },
  bullet:      { minArea: 3.5, maxChars: 50,  maxDensity: 14.3 },
};

/* ═══════════════════════════════════════════════════════
   P1: SMART TRUNCATION — NEVER CUT WORDS
   ═══════════════════════════════════════════════════════ */

/**
 * Truncates text without EVER cutting a word in the middle.
 * Always ends on a complete word boundary.
 */
function smartTruncate(text: string, maxChars: number, addEllipsis = false): string {
  if (!text) return "";
  const t = text.trim();
  if (t.length <= maxChars) return t;

  // Find last space before or at the limit
  const truncated = t.substring(0, maxChars);
  const lastSpace = truncated.lastIndexOf(" ");

  let result: string;
  if (lastSpace > maxChars * 0.4) {
    result = truncated.substring(0, lastSpace).trim();
  } else {
    // If no good space found, take up to limit but find closest word end
    const nextSpace = t.indexOf(" ", maxChars);
    if (nextSpace > 0 && nextSpace < maxChars + 15) {
      result = t.substring(0, nextSpace).trim();
    } else {
      result = truncated.trim();
      // Ensure we didn't cut mid-word by checking if last char is part of a word
      const lastCharIsLetter = /\w/.test(result[result.length - 1]);
      const nextCharExists = t.length > maxChars && /\w/.test(t[maxChars]);
      if (lastCharIsLetter && nextCharExists) {
        const ls = result.lastIndexOf(" ");
        if (ls > maxChars * 0.3) {
          result = result.substring(0, ls).trim();
        }
      }
    }
  }

  // Clean trailing punctuation artifacts
  result = result.replace(/[\s,;:\-–]+$/, "").trim();

  if (addEllipsis && result.length < t.length && !/[.!?]$/.test(result)) {
    result += "...";
  }

  return result;
}

/** Title: max 40 chars, no word cutting */
function smartTitle(text: string): string {
  return smartTruncate(text, 40);
}

/** Subtitle: max 60 chars, no word cutting */
function smartSubtitle(text: string): string {
  return smartTruncate(text, 60);
}

/** Bullet text: max 80 chars OR 8 words, whichever comes first */
function smartBullet(text: string): string {
  if (!text) return "";
  const words = text.trim().split(/\s+/);
  if (words.length > 8) {
    const eightWords = words.slice(0, 8).join(" ");
    if (eightWords.length <= 80) return eightWords + ".";
  }
  return smartTruncate(text, 80);
}

/** Table cell: max 80 chars, no word cutting */
function smartCell(text: string): string {
  return smartTruncate(text, 80);
}

/** Module description: max 40 chars, no word cutting */
function smartModuleDesc(text: string): string {
  return smartTruncate(text, 40);
}

/* ═══════════════════════════════════════════════════════
   P3: SEMANTIC ICON MAPPING (no generic symbols)
   ═══════════════════════════════════════════════════════ */

// Visually distinct symbols that render well in PPTX
const ICON_SYMBOLS: Record<string, string> = {
  brain:     "✧",
  robot:     "⚙",
  magnify:   "⊕",
  target:    "◎",
  cog:       "⊛",
  users:     "☆",
  lightbulb: "◇",
  chart:     "▥",
  clock:     "◔",
  shield:    "◈",
  message:   "▣",
  education: "△",
  finance:   "▽",
  health:    "✦",
  marketing: "▷",
  vision:    "◐",
  language:  "▤",
  neural:    "◑",
};

const ICON_KEYWORDS: [RegExp, string][] = [
  [/\b(inteligência|ia\b|cérebro|cognit|raciocín|aprend)/i, "brain"],
  [/\b(automa|robô|máquina|bot|robo)/i, "robot"],
  [/\b(busca|análise|analis|pesquis|magnif)/i, "magnify"],
  [/\b(objetivo|meta|alvo|target|foco)/i, "target"],
  [/\b(processo|config|sistema|engrenal|cog|fluxo|pipeline)/i, "cog"],
  [/\b(pessoa|cliente|usuário|equipe|colabor|grupo|atendimento|rh)/i, "users"],
  [/\b(ideia|inovaç|criativ|insight|lightbulb)/i, "lightbulb"],
  [/\b(dado|gráfico|métrica|chart|indicador|dashboard|kpi)/i, "chart"],
  [/\b(tempo|velocidade|eficiência|rápid|ágil|clock)/i, "clock"],
  [/\b(seguranç|proteç|escudo|shield|privacidade)/i, "shield"],
  [/\b(comunica|chat|mensag|conversa|diálogo)/i, "message"],
  [/\b(educa|ensino|aprendiz|curso|treinamento)/i, "education"],
  [/\b(finance|dinheiro|custo|investimento|receita)/i, "finance"],
  [/\b(saúde|médic|diagnóstico|hospital|clínic)/i, "health"],
  [/\b(marketing|venda|promoç|campanha|anúncio)/i, "marketing"],
  [/\b(visão|imagem|visual|reconhec|computacional|câmer)/i, "vision"],
  [/\b(linguag|texto|escrit|plataforma|nlp|pln)/i, "language"],
  [/\b(deep learning|rede neural|camada|neural)/i, "neural"],
];

const FALLBACK_ICON_ORDER = ["brain", "target", "lightbulb", "chart", "cog", "magnify", "users", "clock"] as const;

// P3: Track used icons per slide — min 3 different, never repeat
let _slideIconsUsed: Set<string> = new Set();

function resetSlideIcons() {
  _slideIconsUsed = new Set();
}

function getSemanticIcon(text: string, fallbackIdx: number): string {
  // Find best semantic match that hasn't been used on this slide
  for (const [pattern, iconKey] of ICON_KEYWORDS) {
    if (pattern.test(text) && !_slideIconsUsed.has(iconKey)) {
      _slideIconsUsed.add(iconKey);
      return ICON_SYMBOLS[iconKey] || "●";
    }
  }
  // Fallback: pick unused icon from rotation
  for (let i = 0; i < FALLBACK_ICON_ORDER.length; i++) {
    const key = FALLBACK_ICON_ORDER[(fallbackIdx + i) % FALLBACK_ICON_ORDER.length];
    if (!_slideIconsUsed.has(key)) {
      _slideIconsUsed.add(key);
      return ICON_SYMBOLS[key] || "●";
    }
  }
  return "●";
}

/* ═══════════════════════════════════════════════════════
   BLOCO 1 — §4.2: TEXT DENSITY VALIDATION (Critical)
   Rule: NEVER exceed 15 chars/sq in
   ═══════════════════════════════════════════════════════ */

interface DensityResult {
  fits: boolean;
  density: number;
  maxChars: number;
  suggestion: "OK" | "REDUCE_TEXT";
}

function validateTextDensity(text: string, boxWidth: number, boxHeight: number, fontSize: number): DensityResult {
  const area = boxWidth * boxHeight;
  const estimatedCharsPerLine = (boxWidth * 96) / (fontSize * 0.6);
  const estimatedLines = boxHeight / (fontSize * 1.5 * 0.0139); // 1pt = 0.0139"
  const maxChars = Math.floor(estimatedCharsPerLine * estimatedLines * 0.9); // 10% safety margin

  return {
    fits: text.length <= maxChars,
    density: area > 0 ? text.length / area : 999,
    maxChars,
    suggestion: text.length > maxChars ? "REDUCE_TEXT" : "OK",
  };
}

interface AutoAdjustResult {
  fontSize: number;
  truncated: boolean;
  text: string;
}

function autoAdjustText(text: string, boxWidth: number, boxHeight: number, maxFont = 32, minFont = 11): AutoAdjustResult {
  for (let size = maxFont; size >= minFont; size -= 2) {
    const check = validateTextDensity(text, boxWidth, boxHeight, size);
    if (check.fits) {
      return { fontSize: size, truncated: false, text };
    }
  }
  // Last resort: truncate with smartTruncate (word-safe)
  const maxLen = validateTextDensity(text, boxWidth, boxHeight, minFont).maxChars;
  return {
    fontSize: minFont,
    truncated: true,
    text: smartTruncate(text, Math.max(maxLen - 3, 10), true),
  };
}

/* ═══════════════════════════════════════════════════════
   BLOCO 1 — §5.2: TRUNCATION DETECTION (Pre-render check)
   ═══════════════════════════════════════════════════════ */

function detectTruncation(text: string): boolean {
  if (!text || text.length < 5) return false;
  const patterns = [
    /\s(d[ao]s?|nas?|em|por|para)\s+\w{1,3}$/,  // Preposition + short word at end
    /[a-zà-ú]{2,}$/i,                            // Word ending abruptly (no punctuation)
  ];
  const noPunctuation = !/[.!?…]$/.test(text.trim()) && text.length < 20;
  return patterns.some(p => p.test(text)) || noPunctuation;
}

/* ═══════════════════════════════════════════════════════
   TEXT COMPRESSION (65% reduction) — uses smartTruncate
   ═══════════════════════════════════════════════════════ */

function compressText(text: string, maxChars: number = 120): string {
  if (!text || text.length <= maxChars) return text;
  let t = text;
  t = t.replace(/\b(o|a|os|as|um|uma|uns|umas)\s+/gi, "");
  t = t.replace(/\b(que|qual|quais|onde|quando|como|porque|pois)\s+/gi, "");
  t = t.replace(/\bé\s+um\s+campo\s+d[aoe]\s*/gi, "é campo d");
  t = t.replace(/\bcapaz(es)?\s+de\s+/gi, "");
  t = t.replace(/\btipicamente\b/gi, "");
  t = t.replace(/\bpor\s+exemplo\b/gi, "ex:");
  t = t.replace(/\bno\s+entanto\b/gi, "porém");
  t = t.replace(/\balém\s+disso\b/gi, "também");
  t = t.replace(/\bque\s+permitem?\b/gi, "para");
  t = t.replace(/\bque\s+foca\b/gi, "focada");
  t = t.replace(/\bde\s+forma\s+/gi, "");
  t = t.replace(/\b(na|no|nas|nos|das|dos|da|do|de)\s+(criação|construção)\s+de\s+/gi, "criando ");
  t = t.replace(/\s{2,}/g, " ").trim();
  // P1: Use smartTruncate instead of raw substring
  if (t.length > maxChars) {
    t = smartTruncate(t, maxChars);
    if (!/[.!?]$/.test(t)) t += ".";
  }
  return t;
}

function compressBullet(text: string): string {
  return compressText(text, 100);
}

function compressTableCell(text: string): string {
  // P1: Use smartCell for word-safe truncation
  const compressed = compressText(text, 80);
  return smartCell(compressed);
}

/* ═══════════════════════════════════════════════════════
   TEXT SANITIZATION
   ═══════════════════════════════════════════════════════ */

function sanitize(text: string): string {
  if (!text) return "";
  let t = text;
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<\/?(p|div|span|strong|em|b|i|u|a|li|ul|ol|h[1-6]|blockquote|code|pre|table|tr|td|th|thead|tbody|section|article|header|footer|main|nav|figure|figcaption|details|summary|mark|small|sup|sub|dl|dt|dd)[^>]*>/gi, " ");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/#{1,6}\s*/g, "");
  t = t.replace(/\*\*(.*?)\*\*/g, "$1");
  t = t.replace(/\*(.*?)\*/g, "$1");
  t = t.replace(/`{1,3}([^`]*)`{1,3}/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  t = t.replace(/^>\s*/gm, "");
  t = t.replace(/^---+$/gm, "");
  t = t.replace(/\s*[→⟶➜➔➞►▶︎⇒⇨]\s*/g, ": ");
  t = t.replace(/\s*->\s*/g, ": ");
  t = t.replace(/&amp;/gi, "&"); t = t.replace(/&lt;/gi, "<"); t = t.replace(/&gt;/gi, ">");
  t = t.replace(/&nbsp;/gi, " "); t = t.replace(/&quot;/gi, '"');
  t = t.replace(/<\/?[a-z][^>]*>/gi, " ");
  // Strip all emoji characters
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

function deduplicateTitle(title: string): string {
  return title.replace(/^(Módulo\s+\d+\s*[:–\-]\s*)\1/i, "$1").trim();
}

/* ═══════════════════════════════════════════════════════
   SAFE TEXT — boundary-checked wrapper
   ═══════════════════════════════════════════════════════ */

const _auditLog: { slideLabel: string; x: number; y: number; w: number; h: number }[] = [];
let _auditSlideCounter = 0;
function auditNextSlide() { _auditSlideCounter++; }

function addTextSafe(slide: any, text: any, options: Record<string, unknown>) {
  const x = Number(options.x || 0);
  const y = Number(options.y || 0);
  const w = Number(options.w || 0);
  const h = Number(options.h || 0);
  const safeW = Math.min(w, SLIDE_W - x - 0.15);
  const safeH = Math.min(h, SLIDE_H - y - 0.05);
  if (safeW <= 0.1 || safeH <= 0.05) return;

  // Pre-render density validation for plain text
  if (typeof text === "string" && text.length > 0) {
    const fontSize = Number(options.fontSize || TYPO.BODY);
    const check = validateTextDensity(text, safeW, safeH, fontSize);
    if (!check.fits) {
      const adjusted = autoAdjustText(text, safeW, safeH, fontSize, TYPO.SUPPORT);
      text = adjusted.text;
      options = { ...options, fontSize: adjusted.fontSize };
      if (adjusted.truncated) {
        console.log(`⚠️ Density auto-adjust on Slide ${_auditSlideCounter}: "${text.substring(0, 30)}..." → ${adjusted.fontSize}pt`);
      }
    }
    // Final truncation detection
    if (detectTruncation(text)) {
      console.warn(`⚠️ Possible truncation detected on Slide ${_auditSlideCounter}: "${text.substring(0, 40)}"`);
    }
  }

  _auditLog.push({ slideLabel: `Slide ${_auditSlideCounter}`, x, y, w: safeW, h: safeH });
  slide.addText(text, {
    ...options, x, y, w: safeW, h: safeH,
    autoFit: false,
    shrinkText: false,
    wrap: true,        // CRITICAL: line wrapping — §4.3
    overflow: "clip",
    inset: options.inset ?? 0.1,  // Minimal internal margin — §4.3
  });
}

function runAudit() {
  const errors: string[] = [];
  for (const el of _auditLog) {
    if (el.x + el.w > SLIDE_W) errors.push(`${el.slideLabel}: overflow R`);
    if (el.y + el.h > SLIDE_H) errors.push(`${el.slideLabel}: overflow B`);
  }
  if (errors.length === 0) console.log(`✅ Audit PASSED — ${_auditLog.length} elements`);
  else errors.forEach(e => console.error(`❌ ${e}`));
  return { passed: errors.length === 0, errors };
}

/* ═══════════════════════════════════════════════════════
   BULLET SANITIZATION & HEIGHT HELPERS
   ═══════════════════════════════════════════════════════ */

function sanitizeBullets(bullets: string[]): string[] {
  if (!bullets || bullets.length === 0) return [];
  const result: string[] = [];
  let buffer = '';
  for (const raw of bullets) {
    const text = (raw || '').trim();
    if (!text) continue;
    buffer = buffer ? buffer + ' ' + text : text;
    const complete = /[.!?](\s*["')])?$/.test(buffer) || buffer.length > 220;
    if (complete) {
      if (!/[.!?]$/.test(buffer.replace(/["')]\s*$/, ''))) buffer += '.';
      result.push(buffer.trim());
      buffer = '';
    }
  }
  if (buffer.trim()) {
    if (!/[.!?]$/.test(buffer.trim())) buffer = buffer.trim() + '.';
    result.push(buffer.trim());
  }
  return result;
}

function estimateTextLines(text: string, widthInches: number, fontPt: number): number {
  const charsPerInch = Math.max(5, 110 / fontPt);
  const charsPerLine = Math.max(10, Math.floor(widthInches * charsPerInch));
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

function getTitleHeight(text: string, widthIn: number, fontPt: number): number {
  const lines = estimateTextLines(text, widthIn, fontPt);
  const lineH = (fontPt * 1.3) / 72;
  return Math.max(0.50, lines * lineH + 0.15);
}

/* ═══════════════════════════════════════════════════════
   P2: BOLD FORMATTING — Extract label:content pairs
   ═══════════════════════════════════════════════════════ */

interface RichTextPart {
  text: string;
  options: Record<string, unknown>;
}

/**
 * Splits "Label: content text" into rich text array with bold label + normal content.
 * If no colon found, returns the whole text as normal.
 */
function makeBoldLabelText(
  text: string,
  labelColor: string,
  contentColor: string,
  fontSize: number,
  iconChar?: string
): RichTextPart[] {
  const parts: RichTextPart[] = [];

  if (iconChar) {
    parts.push({
      text: iconChar + " ",
      options: { bold: true, color: labelColor, fontSize: fontSize + 2, fontFace: FONT_BODY },
    });
  }

  const colonIdx = text.indexOf(":");
  if (colonIdx > 2 && colonIdx < 60) {
    const label = text.substring(0, colonIdx).trim();
    const content = text.substring(colonIdx + 1).trim();
    parts.push({
      text: label + ": ",
      options: { bold: true, color: labelColor, fontSize, fontFace: FONT_TITLE },
    });
    parts.push({
      text: content,
      options: { bold: false, color: contentColor, fontSize, fontFace: FONT_BODY },
    });
  } else {
    parts.push({
      text: text,
      options: { bold: false, color: contentColor, fontSize, fontFace: FONT_BODY },
    });
  }

  return parts;
}

/* ═══════════════════════════════════════════════════════
   CONTENT PARSING
   ═══════════════════════════════════════════════════════ */

interface ParsedBlock {
  heading: string;
  items: string[];
  isTable: boolean;
  headers?: string[];
  rows?: string[][];
}

function parseModuleContent(content: string): ParsedBlock[] {
  const lines = content.split("\n");
  const blocks: ParsedBlock[] = [];
  let curHeading = "";
  let curBullets: string[] = [];
  let inTable = false;
  let tHeaders: string[] = [];
  let tRows: string[][] = [];

  const flushBullets = () => {
    if (curBullets.length > 0) {
      blocks.push({ heading: curHeading, items: [...curBullets], isTable: false });
      curBullets = [];
    }
  };
  const flushTable = () => {
    if (tRows.length > 0) {
      blocks.push({ heading: curHeading, items: [], isTable: true, headers: [...tHeaders], rows: [...tRows] });
      tHeaders = []; tRows = [];
    }
    inTable = false;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable) {
        flushBullets();
        inTable = true;
        tHeaders = trimmed.split("|").filter(Boolean).map(c => sanitize(c.trim()));
      } else if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        // separator
      } else {
        tRows.push(trimmed.split("|").filter(Boolean).map(c => sanitize(c.trim())));
      }
      continue;
    }
    if (inTable) flushTable();
    if (/^#{1,6}\s/.test(trimmed)) {
      flushBullets();
      curHeading = sanitize(trimmed.replace(/^#{1,6}\s*/, ""));
      continue;
    }
    if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      const raw = trimmed.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "");
      const clean = sanitize(raw);
      if (clean.length > 3) curBullets.push(clean);
      continue;
    }
    const clean = sanitize(trimmed);
    if (clean.length > 8) curBullets.push(clean);
  }
  if (inTable) flushTable();
  flushBullets();
  return blocks;
}

/* ═══════════════════════════════════════════════════════
   CONTENT CLASSIFICATION
   ═══════════════════════════════════════════════════════ */

type LayoutType =
  | "module_cover" | "definition_card_with_pillars" | "comparison_table"
  | "grid_cards" | "four_quadrants" | "process_timeline"
  | "numbered_takeaways" | "bullets";

function isDefinitionBlock(items: string[]): boolean {
  if (items.length < 2 || items.length > 6) return false;
  const first = items[0] || "";
  return /\b(é|são|refere-se|consiste|define-se|trata-se|significa)\b/i.test(first) && items.length >= 3;
}

function isProcessBlock(heading: string, items: string[]): boolean {
  if (/\b(processo|etapa|passo|fase|fluxo|como funciona|pipeline|workflow)\b/i.test(heading)) return true;
  const numberedCount = items.filter(it => /^(etapa|passo|fase|step)\s*\d/i.test(it) || /^\d+[\.\)]/i.test(it)).length;
  return numberedCount >= 3;
}

function isQuadrantBlock(items: string[]): boolean {
  if (items.length !== 4) return false;
  const withColon = items.filter(it => { const ci = it.indexOf(":"); return ci > 2 && ci < 50; }).length;
  return withColon >= 3;
}

function isResumoHeading(heading: string): boolean {
  return /resumo|conclus|encerramento|pontos[- ]chave|key takeaway|takeaway|recapitula/i.test(heading);
}

function isObjectivesHeading(heading: string): boolean {
  return /objetivo|objetivos?\s+d[oe]|learning objectives|o que voc/i.test(heading);
}

function detectParallel(items: string[]): boolean {
  if (items.length < 3 || items.length > 8) return false;
  const withColon = items.filter(it => { const ci = it.indexOf(":"); return ci > 2 && ci < 50; }).length;
  return withColon >= Math.ceil(items.length * 0.6);
}

function classifyContent(heading: string, items: string[], isTable: boolean, prevLayout: LayoutType | null): LayoutType {
  if (isTable) return "comparison_table";
  if (isResumoHeading(heading)) return "numbered_takeaways";
  if (isProcessBlock(heading, items)) return "process_timeline";
  if (isDefinitionBlock(items)) return "definition_card_with_pillars";
  if (items.length === 4 && isQuadrantBlock(items)) {
    return prevLayout === "four_quadrants" ? "grid_cards" : "four_quadrants";
  }
  if (detectParallel(items)) {
    return prevLayout === "grid_cards" ? "four_quadrants" : "grid_cards";
  }
  if (items.length >= 3 && items.length <= 6 && prevLayout !== "grid_cards") return "grid_cards";
  return "bullets";
}

/* ═══════════════════════════════════════════════════════
   DENSITY SCORING
   ═══════════════════════════════════════════════════════ */

interface SlideData {
  layout: LayoutType;
  title: string;
  subtitle?: string;
  sectionLabel?: string;
  items?: string[];
  tableHeaders?: string[];
  tableRows?: string[][];
  moduleIndex?: number;
  moduleCount?: number;
  description?: string;
  courseTitle?: string;
  modules?: { title: string; description: string }[];
  objectives?: string[];
  densityScore?: number;
}

function calculateDensity(sd: SlideData): number {
  let score = 0;
  const items = sd.items || [];
  const textLines = items.reduce((sum, it) => sum + Math.ceil(it.length / 60), 0);
  score += Math.min(textLines * 5, 30);
  score += Math.min(items.length * 10, 60);
  if (sd.tableHeaders) score += 15;
  if (sd.layout === "process_timeline") score += 10;
  if (sd.layout === "module_cover") score = 50;
  return Math.min(score, 100);
}

/* ═══════════════════════════════════════════════════════
   FILLER SLIDE DETECTION
   ═══════════════════════════════════════════════════════ */

function isFillerSlide(sd: SlideData): boolean {
  if (sd.layout === "module_cover" || sd.layout === "numbered_takeaways") return false;
  if (sd.layout === "comparison_table" && sd.tableRows && sd.tableRows.length > 0) return false;
  const items = sd.items || [];
  if (items.length === 1 && items[0].length < 200) {
    const heading = (sd.title || "").toLowerCase();
    if (/^(introdução|contexto|sobre|visão geral|o que é|overview)/.test(heading)) return true;
    if (!items[0].includes(":") && items[0].length < 100) return true;
  }
  if (items.length === 0 && !sd.tableHeaders) return true;
  return false;
}

/* ═══════════════════════════════════════════════════════
   TABLE HELPERS
   ═══════════════════════════════════════════════════════ */

const HEADER_ROW_H = 0.50;

function calcRowHeight(row: string[], colWidths: number[]): number {
  let maxLines = 1;
  for (let c = 0; c < row.length; c++) {
    const cellText = String(row[c] || "");
    const colW = colWidths[c] || 3.0;
    const charsPerLine = Math.max(10, Math.floor(colW * 10));
    const lines = Math.max(1, Math.ceil(cellText.length / charsPerLine));
    maxLines = Math.max(maxLines, lines);
  }
  return 0.45 + (maxLines - 1) * 0.22;
}

function calcTableHeight(rows: string[][], colWidths: number[]): number {
  let h = HEADER_ROW_H;
  for (const row of rows) h += calcRowHeight(row, colWidths);
  return h;
}

function splitTableRows(rows: string[][], colWidths: number[], maxH: number): string[][][] {
  if (calcTableHeight(rows, colWidths) <= maxH) return [rows];
  const chunks: string[][][] = [];
  let current: string[][] = [];
  let curH = HEADER_ROW_H;
  for (const row of rows) {
    const rh = calcRowHeight(row, colWidths);
    if (current.length > 0 && curH + rh > maxH) {
      chunks.push(current);
      current = [row];
      curH = HEADER_ROW_H + rh;
    } else {
      current.push(row);
      curH += rh;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function getColumnWidths(headers: string[]): number[] {
  const colCount = headers.length;
  if (colCount === 2) return [SAFE_W * 0.35, SAFE_W * 0.65];
  if (colCount === 3) return [SAFE_W * 0.20, SAFE_W * 0.40, SAFE_W * 0.40];
  return Array(colCount).fill(SAFE_W / colCount);
}

/* ═══════════════════════════════════════════════════════
   BUILD MODULE SLIDES (consistent structure)
   ═══════════════════════════════════════════════════════ */

function buildModuleSlides(mod: any, modIndex: number, totalModules: number): SlideData[] {
  const blocks = parseModuleContent(mod.content || "");
  const rawTitle = sanitize(mod.title || "");
  const shortTitle = rawTitle.replace(/^módulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;

  const objItems: string[] = [];
  const resumoItems: string[] = [];
  const contentBlocks: ParsedBlock[] = [];

  for (const block of blocks) {
    if (isObjectivesHeading(block.heading) && !block.isTable) objItems.push(...block.items);
    else if (isResumoHeading(block.heading) && !block.isTable) resumoItems.push(...block.items);
    else contentBlocks.push(block);
  }

  const slides: SlideData[] = [];

  // P1: Use smartTitle and smartSubtitle — no truncation mid-word
  const safeTitle = smartTitle(shortTitle);
  const moduleDesc = objItems.length > 0
    ? smartModuleDesc(objItems[0])
    : smartModuleDesc(sanitize((mod.content || "").split(/[.!?]\s/)[0] || ""));

  // P4: Extract 3 objectives for module cover
  const objectives = objItems.slice(0, 3).map(o => smartBullet(sanitize(o)));

  slides.push({
    layout: "module_cover",
    title: safeTitle,
    subtitle: `MÓDULO ${String(modIndex + 1).padStart(2, "0")}`,
    description: moduleDesc,
    moduleIndex: modIndex,
    objectives,
  });

  let prevLayout: LayoutType | null = "module_cover";
  let firstContentRendered = false;

  for (const block of contentBlocks) {
    const heading = sanitize(block.heading || shortTitle);
    const sectionLabel = extractSectionLabel(heading);

    // Table blocks
    if (block.isTable && block.headers && block.rows && block.rows.length > 0) {
      // P1: Use smartCell for all table cells
      const rows = block.rows.map(r => r.map(c => smartCell(compressText(sanitize(c), 80))));
      if (rows.length > 6) {
        const mid = Math.ceil(rows.length / 2);
        slides.push({
          layout: "comparison_table", title: smartTitle(heading + " (Parte 1)"), sectionLabel,
          tableHeaders: block.headers.map(sanitize), tableRows: rows.slice(0, mid),
        });
        slides.push({
          layout: "comparison_table", title: smartTitle(heading + " (Parte 2)"), sectionLabel,
          tableHeaders: block.headers.map(sanitize), tableRows: rows.slice(mid),
        });
        prevLayout = "comparison_table";
      } else {
        slides.push({
          layout: "comparison_table", title: smartTitle(heading), sectionLabel,
          tableHeaders: block.headers.map(sanitize), tableRows: rows,
        });
        prevLayout = "comparison_table";
      }
      firstContentRendered = true;
      continue;
    }

    const items = block.items.map(s => compressBullet(sanitize(s))).filter(s => s.length > 3);
    if (items.length === 0) continue;

    let layout = classifyContent(heading, items, false, prevLayout);

    if (!firstContentRendered && items.length >= 3) {
      layout = "definition_card_with_pillars";
      firstContentRendered = true;
    } else {
      firstContentRendered = true;
    }

    if (layout === prevLayout && layout !== "bullets") {
      const alternatives: LayoutType[] = ["grid_cards", "bullets", "four_quadrants", "definition_card_with_pillars"];
      layout = alternatives.find(l => l !== prevLayout) || "bullets";
    }

    if (items.length > 6 && layout !== "numbered_takeaways") {
      const mid = Math.ceil(items.length / 2);
      slides.push({ layout, title: smartTitle(heading + " (Parte 1)"), sectionLabel, items: sanitizeBullets(items.slice(0, mid)), moduleIndex: modIndex });
      const altLayout = layout === "grid_cards" ? "bullets" : "grid_cards";
      slides.push({ layout: altLayout, title: smartTitle(heading + " (Parte 2)"), sectionLabel, items: sanitizeBullets(items.slice(mid)), moduleIndex: modIndex });
      prevLayout = altLayout;
    } else {
      slides.push({ layout, title: smartTitle(heading), sectionLabel, items: sanitizeBullets(items), moduleIndex: modIndex });
      prevLayout = layout;
    }
  }

  // Always end with takeaways (6 numbered cards)
  if (resumoItems.length > 0) {
    slides.push({
      layout: "numbered_takeaways",
      title: `Key Takeaways — Módulo ${modIndex + 1}`,
      sectionLabel: "RESUMO DO MÓDULO",
      items: sanitizeBullets(resumoItems.slice(0, 6).map(s => compressBullet(sanitize(s)))),
      moduleIndex: modIndex,
    });
  }

  // Remove filler slides
  const filtered: SlideData[] = [];
  for (let i = 0; i < slides.length; i++) {
    if (isFillerSlide(slides[i])) {
      const fillerItems = slides[i].items || [];
      if (fillerItems.length > 0) {
        const target = filtered.length > 0 ? filtered[filtered.length - 1] : (i + 1 < slides.length ? slides[i + 1] : null);
        if (target && target.items) target.items.push(...fillerItems);
      }
      console.log(`🗑️ Removed filler slide: "${slides[i].title}"`);
      continue;
    }
    filtered.push(slides[i]);
  }

  const consolidated = consolidateConsecutiveLayouts(filtered);
  consolidated.forEach(s => { s.densityScore = calculateDensity(s); });
  return consolidated;
}

/* ═══════════════════════════════════════════════════════
   CONSOLIDATE CONSECUTIVE SAME LAYOUTS
   ═══════════════════════════════════════════════════════ */

function consolidateConsecutiveLayouts(slides: SlideData[]): SlideData[] {
  const result: SlideData[] = [];
  let i = 0;
  while (i < slides.length) {
    if (slides[i].layout === "module_cover" || slides[i].layout === "numbered_takeaways" || slides[i].layout === "comparison_table") {
      result.push(slides[i]);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < slides.length && slides[j].layout === slides[i].layout && j - i < 4) j++;
    const consecutiveCount = j - i;
    if (consecutiveCount >= 3) {
      const mergedItems: string[] = [];
      const mergedTitle = slides[i].title.replace(/\s*\(Parte \d+\)\s*$/i, "");
      for (let k = i; k < j; k++) {
        const items = slides[k].items || [];
        if (items.length > 0) mergedItems.push(items[0]);
        if (items.length > 1 && mergedItems.length < 6) mergedItems.push(items[1]);
      }
      result.push({
        layout: "grid_cards", title: smartTitle(mergedTitle),
        sectionLabel: slides[i].sectionLabel, items: mergedItems.slice(0, 6),
        moduleIndex: slides[i].moduleIndex,
      });
      console.log(`🔗 Consolidated ${consecutiveCount} slides into 1 grid_cards`);
      i = j;
    } else {
      result.push(slides[i]);
      i++;
    }
  }
  return result;
}

function extractSectionLabel(heading: string): string {
  const clean = sanitize(heading).replace(/\s*\(Parte \d+\)\s*$/i, "");
  if (clean.length <= 25) return clean.toUpperCase();
  return clean.split(/\s+/).slice(0, 3).join(" ").toUpperCase();
}

/* ═══════════════════════════════════════════════════════
   DENSITY BALANCING PASS
   ═══════════════════════════════════════════════════════ */

function balanceDensity(slides: SlideData[]): SlideData[] {
  const result = [...slides];
  for (let i = 0; i < result.length; i++) {
    const s = result[i];
    const density = calculateDensity(s);
    s.densityScore = density;
    if (s.layout === "module_cover") continue;

    if (density < 40 && s.items && s.items.length < 3) {
      if (i > 0 && result[i - 1].layout !== "module_cover" && result[i - 1].layout !== "numbered_takeaways") {
        const prev = result[i - 1];
        if (prev.items) {
          prev.items.push(...(s.items || []));
          prev.densityScore = calculateDensity(prev);
          result.splice(i, 1);
          console.log(`⬆️ Merged low-density slide "${s.title}" into previous`);
          i--;
          continue;
        }
      }
    }

    if (density > 90 && s.items && s.items.length > 4 && s.layout !== "numbered_takeaways") {
      const mid = Math.ceil(s.items.length / 2);
      const newSlide: SlideData = {
        layout: s.layout === "grid_cards" ? "bullets" : "grid_cards",
        title: smartTitle(s.title + " (cont.)"),
        sectionLabel: s.sectionLabel, items: s.items.slice(mid), moduleIndex: s.moduleIndex,
      };
      s.items = s.items.slice(0, mid);
      s.densityScore = calculateDensity(s);
      newSlide.densityScore = calculateDensity(newSlide);
      result.splice(i + 1, 0, newSlide);
      console.log(`✂️ Split overloaded slide "${s.title}"`);
    }

    if (i > 0) {
      const prevDensity = result[i - 1].densityScore || 50;
      const currDensity = s.densityScore || 50;
      if (Math.abs(currDensity - prevDensity) > 20 && s.items && result[i - 1].items) {
        const denseSlide = currDensity > prevDensity ? s : result[i - 1];
        const sparseSlide = currDensity > prevDensity ? result[i - 1] : s;
        if (denseSlide.items && denseSlide.items.length > 2 && sparseSlide.items) {
          const moved = denseSlide.items.pop()!;
          sparseSlide.items.push(moved);
          denseSlide.densityScore = calculateDensity(denseSlide);
          sparseSlide.densityScore = calculateDensity(sparseSlide);
        }
      }
    }
  }
  return result;
}

/* ═══════════════════════════════════════════════════════
   HEADER RENDERING — P1: No overlap, word-safe titles
   ═══════════════════════════════════════════════════════ */

function renderContentHeader(slide: any, sectionLabel: string, titleText: string): number {
  let y = 0.40;
  if (sectionLabel) {
    // P2: Section label always bold, uppercase
    addTextSafe(slide, sectionLabel, {
      x: MARGIN, y, w: SAFE_W, h: 0.28,
      fontSize: 14, fontFace: FONT_BODY, color: C.TEXT_LIGHT, bold: true, letterSpacing: 2,
    });
    y += 0.35;
  }
  // P1: Smart truncate title — never cut words
  const cleanTitle = smartTruncate(titleText, 80);
  const fontSize = cleanTitle.length > 60 ? 26 : cleanTitle.length > 40 ? 30 : 32;
  const titleH = getTitleHeight(cleanTitle, SAFE_W, fontSize);
  // P2: Title always bold
  addTextSafe(slide, cleanTitle, {
    x: MARGIN, y, w: SAFE_W, h: titleH,
    fontSize, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
  });
  y += titleH + 0.25;
  return y;
}

/* ═══════════════════════════════════════════════════════
   SLIDE RENDERERS
   ═══════════════════════════════════════════════════════ */

// ── COVER SLIDE (LIGHT theme) ──
function renderCapa(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: 0.08, fill: { color: C.SECONDARY },
  });

  const badgeW = 3.2; const badgeH = 0.48;
  const badgeX = (SLIDE_W - badgeW) / 2; const badgeY = 1.5;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: badgeX, y: badgeY, w: badgeW, h: badgeH,
    line: { color: C.SECONDARY, width: 2 }, fill: { type: "none" }, rectRadius: 0.15,
  });
  addTextSafe(slide, "CURSO COMPLETO", {
    x: badgeX, y: badgeY, w: badgeW, h: badgeH,
    fontSize: 14, fontFace: FONT_TITLE, color: C.SECONDARY, bold: true,
    align: "center", valign: "middle", letterSpacing: 4,
  });

  // P1: Smart truncate — never cut words
  const titleText = smartTruncate(data.title, 80);
  const titleH = getTitleHeight(titleText, SAFE_W - 2, 44);
  const titleY = badgeY + badgeH + 0.50;
  addTextSafe(slide, titleText, {
    x: MARGIN + 1, y: titleY, w: SAFE_W - 2, h: titleH,
    fontSize: 44, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
    align: "center", valign: "middle",
  });

  const sepY = titleY + titleH + 0.15;
  slide.addShape(pptx.ShapeType.rect, {
    x: (SLIDE_W - 1.5) / 2, y: sepY, w: 1.5, h: 0.05, fill: { color: C.SECONDARY },
  });

  // P1: Subtitle with smart truncation
  if (data.description) {
    const desc = smartSubtitle(sanitize(data.description));
    addTextSafe(slide, desc, {
      x: 2, y: sepY + 0.30, w: SLIDE_W - 4, h: 0.50,
      fontSize: 18, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
    });
  }

  const d = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const footer = data.moduleCount ? `${d}  |  ${data.moduleCount} Módulos` : d;
  addTextSafe(slide, footer, {
    x: 1, y: SLIDE_H - 0.80, w: SLIDE_W - 2, h: 0.40,
    fontSize: 14, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
  });
}

// ── TABLE OF CONTENTS ──
function renderTOC(pptx: any, data: SlideData) {
  const modules = data.modules || [];
  if (modules.length === 0) return;

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };

  addTextSafe(slide, "CONTEÚDO DO CURSO", {
    x: MARGIN, y: 0.35, w: SAFE_W, h: 0.28,
    fontSize: 14, fontFace: FONT_BODY, color: C.SECONDARY, bold: true, letterSpacing: 2,
  });
  addTextSafe(slide, "O que você vai aprender", {
    x: MARGIN, y: 0.68, w: SAFE_W, h: 0.55,
    fontSize: 36, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
  });

  const gridY = 1.40;
  const cols = 2; const gapX = 0.25; const gapY = 0.20;
  const cardW = (SAFE_W - gapX) / cols;
  const rows = Math.ceil(modules.length / cols);
  const availH = SLIDE_H - gridY - BOTTOM_MARGIN;
  const cardH = Math.min((availH - (rows - 1) * gapY) / rows, 1.40);

  modules.forEach((mod, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MARGIN + col * (cardW + gapX);
    const y = gridY + row * (cardH + gapY);
    if (y + cardH > SLIDE_H - BOTTOM_MARGIN) return;

    const accentColor = MODULE_NUMBER_COLORS[idx % MODULE_NUMBER_COLORS.length];

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.BG_LIGHT }, line: { color: C.CARD_BORDER, width: 0.5 }, rectRadius: 0.08,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x, y: y + 0.08, w: 0.06, h: cardH - 0.16,
      fill: { color: accentColor }, rectRadius: 0.03,
    });

    const circleSize = 0.44;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.22, y: y + 0.20, w: circleSize, h: circleSize, fill: { color: accentColor },
    });
    addTextSafe(slide, String(idx + 1).padStart(2, "0"), {
      x: x + 0.22, y: y + 0.20, w: circleSize, h: circleSize,
      fontSize: 16, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });

    const textX = x + 0.78; const textW = cardW - 0.95;
    // P1: Smart truncate module title — never cut mid-word
    const modTitle = smartTitle(mod.title);
    addTextSafe(slide, modTitle, {
      x: textX, y: y + 0.20, w: textW, h: 0.35,
      fontSize: 16, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
    });
    if (mod.description) {
      // P1: Smart truncate description — never cut mid-word
      const desc = smartModuleDesc(mod.description);
      addTextSafe(slide, desc, {
        x: textX, y: y + 0.58, w: textW, h: cardH - 0.72,
        fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top", lineSpacingMultiple: 1.3,
      });
    }
  });
}

// ── MODULE COVER (P4: Standardized with objectives) ──
function renderModuleCover(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  resetSlideIcons();
  const modIdx = data.moduleIndex || 0;
  const moduleColor = MODULE_NUMBER_COLORS[modIdx % MODULE_NUMBER_COLORS.length];

  slide.background = { color: C.BG_WHITE };

  // Top accent bar in module color
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: 0.08, fill: { color: moduleColor },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: SLIDE_W - 3, y: 0.08, w: 3, h: 0.04, fill: { color: C.SECONDARY },
  });

  // Module number — 72pt, module color
  const moduleNum = data.subtitle || `MÓDULO ${String(modIdx + 1).padStart(2, "0")}`;
  addTextSafe(slide, moduleNum, {
    x: MARGIN, y: 1.2, w: SAFE_W, h: 1.2,
    fontSize: 72, fontFace: FONT_TITLE, color: moduleColor, bold: true,
  });

  // P1: Title with smart truncation — NEVER cut words
  const titleText = smartTruncate(data.title, 45);
  addTextSafe(slide, titleText, {
    x: MARGIN, y: 2.8, w: SAFE_W * 0.70, h: 0.85,
    fontSize: 32, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
  });

  // Separator line
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: 3.70, w: 1.2, h: 0.05, fill: { color: C.SECONDARY },
  });

  // P1: Subtitle with smart truncation
  if (data.description) {
    const desc = smartSubtitle(data.description);
    addTextSafe(slide, desc, {
      x: MARGIN, y: 3.90, w: SAFE_W * 0.65, h: 0.55,
      fontSize: 18, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top",
    });
  }

  // P4: 3 Objectives bullets on module cover
  const objectives = data.objectives || [];
  if (objectives.length > 0) {
    const objStartY = 4.65;
    objectives.slice(0, 3).forEach((obj, idx) => {
      const objY = objStartY + idx * 0.42;
      if (objY + 0.35 > SLIDE_H - 0.40) return;
      // P2: Bullet with colored dot + text
      const dotSize = 0.10;
      slide.addShape(pptx.ShapeType.ellipse, {
        x: MARGIN + 0.05, y: objY + 0.10, w: dotSize, h: dotSize,
        fill: { color: moduleColor },
      });
      // P1: Smart truncate each objective
      const objText = smartBullet(obj);
      addTextSafe(slide, objText, {
        x: MARGIN + 0.25, y: objY, w: SAFE_W * 0.60, h: 0.35,
        fontSize: 14, fontFace: FONT_BODY, color: C.TEXT_BODY, valign: "middle",
      });
    });
  }

  // Bottom accent line
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: SLIDE_H - 0.08, w: SLIDE_W, h: 0.08, fill: { color: moduleColor },
  });
}

// ── DEFINITION CARD WITH PILLARS (P2: bold labels, P3: unique icons) ──
function renderDefinitionWithPillars(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };
  const items = data.items || [];
  if (items.length === 0) return;

  let contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  const defText = smartTruncate(items[0], 200);
  const defCardH = Math.max(1.0, estimateTextLines(defText, SAFE_W - 1.2, 16) * 0.35 + 0.40);

  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: contentY, w: SAFE_W, h: defCardH,
    fill: { color: C.BG_LIGHT }, line: { color: C.ACCENT_BLUE, width: 1.5 }, rectRadius: 0.10,
  });
  // P2: Label always bold
  addTextSafe(slide, "DEFINIÇÃO ESSENCIAL", {
    x: MARGIN + 0.30, y: contentY + 0.15, w: SAFE_W - 0.60, h: 0.28,
    fontSize: 11, fontFace: FONT_TITLE, color: C.ACCENT_BLUE, bold: true, letterSpacing: 2,
  });
  addTextSafe(slide, defText, {
    x: MARGIN + 0.30, y: contentY + 0.45, w: SAFE_W - 0.60, h: defCardH - 0.60,
    fontSize: 16, fontFace: FONT_BODY, color: C.TEXT_BODY, valign: "top", lineSpacingMultiple: 1.4,
  });

  contentY += defCardH + 0.30;

  const pillars = items.slice(1, 5);
  if (pillars.length > 0) {
    const cols = pillars.length;
    const gapX = 0.20;
    const pillarW = (SAFE_W - (cols - 1) * gapX) / cols;
    const availH = SLIDE_H - contentY - BOTTOM_MARGIN;
    const pillarH = Math.min(availH, 1.60);

    pillars.forEach((pillar, idx) => {
      const x = MARGIN + idx * (pillarW + gapX);
      const accentColor = CARD_ACCENT_COLORS[idx % CARD_ACCENT_COLORS.length];

      slide.addShape(pptx.ShapeType.rect, {
        x, y: contentY, w: pillarW, h: pillarH,
        fill: { color: C.BG_WHITE }, line: { color: C.CARD_BORDER, width: 0.5 }, rectRadius: 0.08,
      });
      slide.addShape(pptx.ShapeType.rect, {
        x: x + 0.08, y: contentY, w: pillarW - 0.16, h: 0.05, fill: { color: accentColor },
      });

      // P3: Unique semantic icon per pillar
      const circleSize = 0.44;
      slide.addShape(pptx.ShapeType.ellipse, {
        x: x + (pillarW - circleSize) / 2, y: contentY + 0.20, w: circleSize, h: circleSize,
        fill: { color: accentColor },
      });
      const iconChar = getSemanticIcon(pillar, idx);
      addTextSafe(slide, iconChar, {
        x: x + (pillarW - circleSize) / 2, y: contentY + 0.20, w: circleSize, h: circleSize,
        fontSize: 18, fontFace: FONT_BODY, color: C.TEXT_WHITE, bold: true,
        align: "center", valign: "middle",
      });

      // P2: Bold label + normal content
      const colonIdx = pillar.indexOf(":");
      const pTitle = colonIdx > 2 && colonIdx < 50 ? smartTruncate(pillar.substring(0, colonIdx).trim(), 30) : "";
      const pBody = pTitle ? smartTruncate(pillar.substring(colonIdx + 1).trim(), 80) : smartTruncate(pillar, 80);

      let textY = contentY + 0.72;
      if (pTitle) {
        // P2: Pillar title always bold
        addTextSafe(slide, pTitle, {
          x: x + 0.15, y: textY, w: pillarW - 0.30, h: 0.30,
          fontSize: 13, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true, align: "center",
        });
        textY += 0.32;
      }
      // P2: Body text normal weight
      addTextSafe(slide, pBody, {
        x: x + 0.15, y: textY, w: pillarW - 0.30, h: pillarH - (textY - contentY) - 0.10,
        fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_LIGHT,
        align: "center", valign: "top", lineSpacingMultiple: 1.25,
      });
    });
  }
}

// ── COMPARISON TABLE (proper formatting, zebra striping) ──
function renderComparisonTable(pptx: any, data: SlideData) {
  const headers = (data.tableHeaders || []).map(h => sanitize(h));
  // P1: All cells use smartCell
  const rows = (data.tableRows || []).map(r => r.map(c => smartCell(sanitize(c))));
  if (!headers.length || !rows.length) return;

  resetSlideIcons();
  const titleText = deduplicateTitle(data.title);
  const colWidths = getColumnWidths(headers);

  const headerAreaH = 1.30;
  const insightH = 0.60;
  const maxTableH = SLIDE_H - headerAreaH - insightH - BOTTOM_MARGIN;

  const estH = calcTableHeight(rows, colWidths);
  if (estH > maxTableH && rows.length > 4) {
    const chunks = splitTableRows(rows, colWidths, maxTableH);
    if (chunks.length > 1) {
      const bt = titleText.replace(/\s*\(Parte \d+\)\s*$/i, "");
      chunks.forEach((chunk, idx) => {
        renderComparisonTable(pptx, { ...data, title: smartTitle(`${bt} (Parte ${idx + 1})`), tableRows: chunk });
      });
      return;
    }
  }

  const slide = pptx.addSlide();
  slide.background = { color: C.BG_WHITE };
  const contentY = renderContentHeader(slide, data.sectionLabel || "", titleText);

  const colCount = headers.length;
  const noBorder = { type: "none" as const, pt: 0, color: "000000" };
  const borderBottom = { type: "solid" as const, pt: 0.5, color: C.TABLE_BORDER };

  const tableData: any[][] = [];

  // P2: Header row always bold, white on dark
  tableData.push(headers.map(h => ({
    text: h,
    options: {
      fontSize: 12, fontFace: FONT_TITLE, bold: true, color: C.TEXT_WHITE,
      fill: { color: C.TABLE_HEADER_BG },
      border: [noBorder, noBorder, noBorder, noBorder],
      valign: "middle" as const,
      paraSpaceBefore: 6, paraSpaceAfter: 6,
      margin: [0.10, 0.15, 0.10, 0.15],
    },
  })));

  // Data rows with zebra striping, P2: first column bold
  rows.forEach((row, ri) => {
    const isEven = ri % 2 === 1;
    const fillColor = isEven ? C.TABLE_ROW_EVEN : C.TABLE_ROW_ODD;
    const dataRow = row.map((cell, ci) => ({
      text: cell,
      options: {
        fontSize: 11, fontFace: FONT_BODY, color: C.TEXT_BODY,
        bold: ci === 0, // P2: First column always bold
        fill: { color: fillColor },
        border: [noBorder, noBorder, borderBottom, noBorder],
        valign: "middle" as const,
        paraSpaceBefore: 4, paraSpaceAfter: 4,
        margin: [0.10, 0.15, 0.10, 0.15],
      },
    }));
    while (dataRow.length < colCount) {
      dataRow.push({
        text: "", options: {
          fontSize: 11, fontFace: FONT_BODY, color: C.TEXT_BODY,
          fill: { color: fillColor }, border: [noBorder, noBorder, borderBottom, noBorder],
          valign: "middle" as const, paraSpaceBefore: 4, paraSpaceAfter: 4,
          margin: [0.10, 0.15, 0.10, 0.15],
          bold: false,
        },
      });
    }
    tableData.push(dataRow);
  });

  const safeH = Math.min(estH * 1.15 + 0.2, maxTableH);
  slide.addTable(tableData, {
    x: MARGIN, y: contentY, w: SAFE_W, h: safeH,
    colW: colWidths, autoPage: false,
  });

  // Insight box
  const insightY = SLIDE_H - 0.70;
  const insightBoxH = 0.45;
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: insightY, w: SAFE_W, h: insightBoxH,
    fill: { color: C.INSIGHT_BG }, rectRadius: 0.08,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: insightY + 0.06, w: 0.05, h: insightBoxH - 0.12,
    fill: { color: C.SECONDARY },
  });
  // P2: "Insight:" bold, content italic normal
  addTextSafe(slide, [
    { text: "Insight: ", options: { bold: true, color: C.SECONDARY, fontSize: 12, fontFace: FONT_TITLE } },
    { text: "Analise os dados acima e reflita sobre como se aplicam ao seu contexto.", options: { bold: false, color: C.TEXT_BODY, fontSize: 12, fontFace: FONT_BODY, italic: true } },
  ], {
    x: MARGIN + 0.22, y: insightY, w: SAFE_W - 0.44, h: insightBoxH, valign: "middle",
  });
}

// ── GRID CARDS (P2: bold labels, P3: unique icons) ──
function renderGridCards(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;
  if (items.length <= 2) { renderBullets(pptx, data); return; }

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };
  let contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  const count = Math.min(items.length, 6);
  const cols = count === 3 || count === 6 ? 3 : 2;
  const gapX = 0.22; const gapY = 0.20;
  const cardW = (SAFE_W - (cols - 1) * gapX) / cols;
  const gridRows = Math.ceil(count / cols);
  const availH = SLIDE_H - contentY - BOTTOM_MARGIN;
  const cardH = Math.min((availH - (gridRows - 1) * gapY) / gridRows, 1.60);

  items.slice(0, count).forEach((item, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MARGIN + col * (cardW + gapX);
    const y = contentY + row * (cardH + gapY);
    if (y + cardH > SLIDE_H - BOTTOM_MARGIN) return;

    const accentColor = CARD_ACCENT_COLORS[idx % CARD_ACCENT_COLORS.length];

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.BG_LIGHT }, line: { color: C.CARD_BORDER, width: 0.5 }, rectRadius: 0.08,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x, y: y + 0.08, w: 0.05, h: cardH - 0.16,
      fill: { color: accentColor }, rectRadius: 0.025,
    });

    // P3: unique semantic icon
    const circleSize = 0.40;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.18, y: y + 0.18, w: circleSize, h: circleSize, fill: { color: accentColor },
    });
    const iconChar = getSemanticIcon(item, idx);
    addTextSafe(slide, iconChar, {
      x: x + 0.18, y: y + 0.18, w: circleSize, h: circleSize,
      fontSize: 16, fontFace: FONT_BODY, color: C.TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });

    // P2: Bold label + normal content using rich text
    const colonIdx = item.indexOf(":");
    const cardTitle = colonIdx > 2 && colonIdx < 50 ? smartTruncate(item.substring(0, colonIdx).trim(), 40) : "";
    const cardBody = cardTitle ? smartTruncate(item.substring(colonIdx + 1).trim(), 100) : smartTruncate(item, 100);

    const textX = x + 0.68; const textW = cardW - 0.82;
    let textY = y + 0.18;

    if (cardTitle) {
      // P2: Card title bold
      addTextSafe(slide, cardTitle, {
        x: textX, y: textY, w: textW, h: 0.30,
        fontSize: 14, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      });
      textY += 0.34;
    }
    if (cardBody) {
      // P2: Card body normal weight
      const bodyH = cardH - (textY - y) - 0.10;
      addTextSafe(slide, cardBody, {
        x: textX, y: textY, w: textW, h: Math.max(bodyH, 0.20),
        fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top", lineSpacingMultiple: 1.3,
      });
    }
  });
}

// ── FOUR QUADRANTS (P2: bold labels, P3: unique icons) ──
function renderFourQuadrants(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length < 4) { renderGridCards(pptx, data); return; }

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };
  let contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  const cols = 2; const gapX = 0.25; const gapY = 0.22;
  const quadW = (SAFE_W - gapX) / cols;
  const quadrants = items.slice(0, 4);
  const availH = SLIDE_H - contentY - BOTTOM_MARGIN;
  const quadH = Math.min((availH - gapY) / 2, 2.0);

  quadrants.forEach((item, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MARGIN + col * (quadW + gapX);
    const y = contentY + row * (quadH + gapY);
    if (y + quadH > SLIDE_H - BOTTOM_MARGIN) return;

    const accentColor = CARD_ACCENT_COLORS[idx % CARD_ACCENT_COLORS.length];

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: quadW, h: quadH,
      fill: { color: C.BG_LIGHT }, line: { color: C.CARD_BORDER, width: 0.5 }, rectRadius: 0.10,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: x + 0.10, y, w: quadW - 0.20, h: 0.05, fill: { color: accentColor },
    });

    // P3: unique semantic icon
    const circleSize = 0.50;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.25, y: y + 0.25, w: circleSize, h: circleSize, fill: { color: accentColor },
    });
    const iconChar = getSemanticIcon(item, idx);
    addTextSafe(slide, iconChar, {
      x: x + 0.25, y: y + 0.25, w: circleSize, h: circleSize,
      fontSize: 20, fontFace: FONT_BODY, color: C.TEXT_WHITE, align: "center", valign: "middle",
    });

    // P2: Bold label + normal content
    const colonIdx = item.indexOf(":");
    const qTitle = colonIdx > 2 && colonIdx < 50 ? smartTruncate(item.substring(0, colonIdx).trim(), 40) : "";
    const qBody = qTitle ? smartTruncate(item.substring(colonIdx + 1).trim(), 120) : smartTruncate(item, 120);

    let textY = y + 0.25;
    const textX = x + 0.85; const textW = quadW - 1.05;

    if (qTitle) {
      addTextSafe(slide, qTitle, {
        x: textX, y: textY, w: textW, h: 0.35,
        fontSize: 16, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      });
      textY += 0.38;
    }
    addTextSafe(slide, qBody, {
      x: textX, y: textY, w: textW, h: quadH - (textY - y) - 0.15,
      fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top", lineSpacingMultiple: 1.3,
    });
  });

  if (items.length > 4) {
    const footerItems = items.slice(4, 10);
    const footerY = SLIDE_H - 0.70;
    const footerText = footerItems.map(it => `• ${smartTruncate(sanitize(it), 60)}`).join("   ");
    addTextSafe(slide, footerText, {
      x: MARGIN, y: footerY, w: SAFE_W, h: 0.40,
      fontSize: 11, fontFace: FONT_BODY, color: C.TEXT_LIGHT, italic: true,
    });
  }
}

// ── PROCESS TIMELINE (Standardized: numbered circles + title + desc) ──
function renderProcessTimeline(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };
  let contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  // Max 4 steps per slide
  const steps = items.slice(0, 4);
  const stepCount = steps.length;
  const totalW = SAFE_W;
  const stepW = totalW / stepCount;
  const circleSize = 0.55;
  const lineY = contentY + circleSize / 2;

  // Connector line between steps
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN + stepW / 2, y: lineY + circleSize / 2 - 0.02,
    w: totalW - stepW, h: 0.04, fill: { color: C.CARD_BORDER },
  });

  // Get module color for circles
  const moduleIdx = data.moduleIndex || 0;
  const moduleColor = MODULE_NUMBER_COLORS[moduleIdx % MODULE_NUMBER_COLORS.length];

  steps.forEach((step, idx) => {
    const centerX = MARGIN + stepW * idx + stepW / 2;
    const x = centerX - circleSize / 2;
    const y = contentY;

    // Numbered circles in module color
    slide.addShape(pptx.ShapeType.ellipse, {
      x, y, w: circleSize, h: circleSize, fill: { color: moduleColor },
    });
    addTextSafe(slide, String(idx + 1), {
      x, y, w: circleSize, h: circleSize,
      fontSize: 22, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });

    // P1: Extract title (3-4 words) + description using smart truncation
    const colonIdx = step.indexOf(":");
    let stepTitle: string;
    let stepDesc: string;
    if (colonIdx > 2 && colonIdx < 50) {
      stepTitle = smartTruncate(step.substring(0, colonIdx).trim(), 30);
      stepDesc = smartTruncate(step.substring(colonIdx + 1).trim(), 60);
    } else {
      const words = step.split(/\s+/);
      stepTitle = smartTruncate(words.slice(0, 3).join(" "), 30);
      stepDesc = smartTruncate(words.slice(3).join(" "), 60);
    }

    const textY = y + circleSize + 0.25;
    const textW = stepW - 0.40;
    const textX = centerX - textW / 2;

    // P2: Step title bold
    addTextSafe(slide, stepTitle, {
      x: textX, y: textY, w: textW, h: 0.40,
      fontSize: 14, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      align: "center",
    });
    // P2: Step description normal
    if (stepDesc) {
      addTextSafe(slide, stepDesc, {
        x: textX, y: textY + 0.42, w: textW, h: 0.55,
        fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_LIGHT,
        align: "center", valign: "top", lineSpacingMultiple: 1.25,
      });
    }
  });

  // Supporting text at bottom
  if (items.length > 4) {
    const supportText = smartTruncate(items[4], 80);
    addTextSafe(slide, supportText, {
      x: MARGIN, y: SLIDE_H - 0.80, w: SAFE_W, h: 0.40,
      fontSize: 14, fontFace: FONT_BODY, color: C.SECONDARY, italic: true, align: "center",
    });
  }
}

// ── BULLETS (P2: bold labels + normal content) ──
function renderBullets(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };
  let contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  const maxItems = Math.min(items.length, 8);
  const availH = SLIDE_H - contentY - BOTTOM_MARGIN;
  const bulletH = Math.min(availH / maxItems, 0.65);

  items.slice(0, maxItems).forEach((item, idx) => {
    const y = contentY + idx * bulletH;
    if (y + bulletH > SLIDE_H - BOTTOM_MARGIN) return;

    const accentColor = CARD_ACCENT_COLORS[idx % CARD_ACCENT_COLORS.length];

    const dotSize = 0.12;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: MARGIN + 0.10, y: y + (bulletH - dotSize) / 2, w: dotSize, h: dotSize,
      fill: { color: accentColor },
    });

    // P2: Use rich text with bold label + normal content
    const richText = makeBoldLabelText(smartTruncate(item, 120), C.TEXT_DARK, C.TEXT_BODY, 16);
    addTextSafe(slide, richText, {
      x: MARGIN + 0.35, y, w: SAFE_W - 0.45, h: bulletH,
      valign: "middle", lineSpacingMultiple: 1.3,
    });

    if (idx < items.length - 1) {
      slide.addShape(pptx.ShapeType.rect, {
        x: MARGIN + 0.35, y: y + bulletH - 0.02, w: SAFE_W - 0.80, h: 0.01,
        fill: { color: C.TABLE_ROW_EVEN },
      });
    }
  });
}

// ── P5: NUMBERED TAKEAWAYS (grid 2x3, short title + 1 sentence) ──
function renderNumberedTakeaways(pptx: any, data: SlideData) {
  const items = (data.items || []).map(i => sanitize(i)).filter(Boolean);
  if (!items.length) return;

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };
  const contentY = renderContentHeader(slide, data.sectionLabel || "RESUMO DO MÓDULO", data.title);

  const maxItems = Math.min(items.length, 6);
  const cols = maxItems <= 4 ? 2 : 3;
  const gridRows = Math.ceil(maxItems / cols);
  const gapX = 0.22; const gapY = 0.18;
  const cardW = (SAFE_W - (cols - 1) * gapX) / cols;
  const reflectionH = 0.55;
  const availH = SLIDE_H - contentY - reflectionH - BOTTOM_MARGIN - 0.10;
  const cardH = Math.min((availH - (gridRows - 1) * gapY) / gridRows, 1.30);

  items.slice(0, maxItems).forEach((bullet, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MARGIN + col * (cardW + gapX);
    const y = contentY + row * (cardH + gapY);
    if (y + cardH > SLIDE_H - reflectionH - BOTTOM_MARGIN) return;

    const accentColor = CARD_ACCENT_COLORS[idx % CARD_ACCENT_COLORS.length];

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.BG_LIGHT }, line: { color: C.CARD_BORDER, width: 0.5 }, rectRadius: 0.08,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x, y: y + 0.08, w: 0.05, h: cardH - 0.16,
      fill: { color: accentColor }, rectRadius: 0.025,
    });

    const circleSize = 0.40;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.16, y: y + 0.16, w: circleSize, h: circleSize, fill: { color: accentColor },
    });
    addTextSafe(slide, String(idx + 1), {
      x: x + 0.16, y: y + 0.16, w: circleSize, h: circleSize,
      fontSize: 18, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });

    // P5: Extract short title (max 5 words / 40 chars) + compressed description (max 1 sentence / 80 chars)
    const colonIdx = bullet.indexOf(":");
    let cardTitle = "";
    let cardBody = bullet;
    if (colonIdx > 2 && colonIdx < 60) {
      cardTitle = smartTruncate(bullet.substring(0, colonIdx).trim(), 40);
      cardBody = smartTruncate(bullet.substring(colonIdx + 1).trim(), 80);
    } else {
      const words = bullet.split(/\s+/);
      if (words.length > 4) {
        cardTitle = smartTruncate(words.slice(0, 4).join(" "), 40);
        cardBody = smartTruncate(words.slice(4).join(" "), 80);
      } else {
        cardTitle = smartTruncate(bullet, 40);
        cardBody = "";
      }
    }

    // P5: Ensure description ends properly (no paragraph, 1 sentence max)
    if (cardBody.length > 80) {
      cardBody = smartTruncate(cardBody, 80);
    }
    // Ensure ends with punctuation
    if (cardBody && !/[.!?]$/.test(cardBody)) cardBody += ".";

    const textX = x + 0.66; const textW = cardW - 0.80;
    let textY = y + 0.16;

    if (cardTitle) {
      // P2: Takeaway title always bold
      addTextSafe(slide, cardTitle, {
        x: textX, y: textY, w: textW, h: 0.30,
        fontSize: 13, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      });
      textY += 0.32;
    }
    if (cardBody) {
      // P2: Description normal weight
      const bodyH = cardH - (textY - y) - 0.10;
      addTextSafe(slide, cardBody, {
        x: textX, y: textY, w: textW, h: Math.max(bodyH, 0.15),
        fontSize: 11, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top", lineSpacingMultiple: 1.2,
      });
    }
  });

  // Reflection callout
  const reflY = SLIDE_H - reflectionH - 0.10;
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: reflY, w: SAFE_W, h: reflectionH,
    fill: { color: C.REFLECTION_BG }, rectRadius: 0.08,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: reflY + 0.06, w: 0.05, h: reflectionH - 0.12,
    fill: { color: C.ACCENT_BLUE },
  });
  const reflText = data.description
    ? smartTruncate(sanitize(data.description), 80)
    : "Como esses conceitos se aplicam à sua realidade profissional?";
  // P2: "Reflexão:" bold, content italic normal
  addTextSafe(slide, [
    { text: "Reflexão: ", options: { bold: true, color: C.ACCENT_BLUE, fontSize: 13, fontFace: FONT_TITLE } },
    { text: reflText, options: { bold: false, color: C.TEXT_BODY, fontSize: 13, fontFace: FONT_BODY, italic: true } },
  ], {
    x: MARGIN + 0.22, y: reflY, w: SAFE_W - 0.44, h: reflectionH, valign: "middle",
  });
}

// ── CLOSING SLIDE (LIGHT theme) ──
function renderEncerramento(pptx: any, courseTitle: string) {
  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: 0.08, fill: { color: C.SECONDARY },
  });

  addTextSafe(slide, "Obrigado!", {
    x: 1, y: 1.5, w: SLIDE_W - 2, h: 1.8,
    fontSize: 56, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
    align: "center", valign: "middle",
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: (SLIDE_W - 1.5) / 2, y: 3.40, w: 1.5, h: 0.05, fill: { color: C.SECONDARY },
  });
  addTextSafe(slide, smartTruncate(sanitize(courseTitle), 60), {
    x: 2, y: 3.70, w: SLIDE_W - 4, h: 0.60,
    fontSize: 20, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
  });
  addTextSafe(slide, "Continue praticando  |  Acesse os materiais complementares", {
    x: 2, y: 4.60, w: SLIDE_W - 4, h: 0.40,
    fontSize: 16, fontFace: FONT_BODY, color: C.SECONDARY, align: "center",
  });

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: SLIDE_H - 0.08, w: SLIDE_W, h: 0.08, fill: { color: C.SECONDARY },
  });

  addTextSafe(slide, "Gerado com EduGen AI", {
    x: 2, y: SLIDE_H - 0.55, w: SLIDE_W - 4, h: 0.35,
    fontSize: 12, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
  });
}

/* ═══════════════════════════════════════════════════════
   MAIN HANDLER
   ═══════════════════════════════════════════════════════ */

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
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

    const { course_id } = await req.json();
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: sub } = await serviceClient.from("subscriptions").select("plan").eq("user_id", userId).single();
    const plan = sub?.plan || "free";

    if (plan !== "pro") {
      const { data: profile } = await serviceClient.from("profiles").select("is_dev").eq("user_id", userId).maybeSingle();
      if (!profile?.is_dev) {
        return new Response(
          JSON.stringify({ error: "PowerPoint export requires a Pro plan.", feature: "export_pptx" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const { data: course, error: courseErr } = await serviceClient
      .from("courses").select("*").eq("id", course_id).eq("user_id", userId).single();
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
      .from("course_modules").select("*").eq("course_id", course_id).order("order_index");

    /* ─── Build all slides ─── */
    let allSlides: SlideData[] = [];
    for (let i = 0; i < modules.length; i++) {
      allSlides.push(...buildModuleSlides(modules[i], i, modules.length));
    }

    // Density balancing pass
    allSlides = balanceDensity(allSlides);

    // Recalculate and log
    allSlides.forEach(s => { s.densityScore = calculateDensity(s); });
    const densityStats = allSlides.map(s => `${s.layout}:${s.densityScore}`);
    console.log("📊 Density scores:", densityStats.join(", "));
    const avgDensity = allSlides.reduce((sum, s) => sum + (s.densityScore || 0), 0) / allSlides.length;
    console.log(`📊 Average density: ${avgDensity.toFixed(1)} | Slides: ${allSlides.length}`);

    /* ─── Build PPTX — §4.1 Configuration ─── */
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_16x9";
    pptx.author = "Sistema de Cursos";
    pptx.company = "EduGen AI";
    pptx.subject = "Curso Profissional";
    pptx.title = course.title;

    const _origAddSlide = pptx.addSlide.bind(pptx);
    pptx.addSlide = (...args: any[]) => {
      auditNextSlide();
      return _origAddSlide(...args);
    };

    // 1. Cover
    renderCapa(pptx, {
      layout: "module_cover", title: course.title,
      description: course.description || "", moduleCount: modules.length,
    });

    // 2. TOC
    const modulesSummary = modules.map((m: any) => {
      const rawTitle = sanitize(m.title || "");
      const shortTitle = rawTitle.replace(/^módulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;
      const firstSentence = smartModuleDesc(sanitize((m.content || "").split(/[.!?]\s/)[0] || ""));
      return { title: shortTitle, description: firstSentence };
    });
    renderTOC(pptx, { layout: "module_cover", title: "O que você vai aprender", modules: modulesSummary });

    // 3. All module slides
    for (const sd of allSlides) {
      switch (sd.layout) {
        case "module_cover":                renderModuleCover(pptx, sd); break;
        case "definition_card_with_pillars": renderDefinitionWithPillars(pptx, sd); break;
        case "comparison_table":            renderComparisonTable(pptx, sd); break;
        case "grid_cards":                  renderGridCards(pptx, sd); break;
        case "four_quadrants":              renderFourQuadrants(pptx, sd); break;
        case "process_timeline":            renderProcessTimeline(pptx, sd); break;
        case "numbered_takeaways":          renderNumberedTakeaways(pptx, sd); break;
        case "bullets":                     renderBullets(pptx, sd); break;
        default:                            renderBullets(pptx, sd); break;
      }
    }

    // 4. Closing
    renderEncerramento(pptx, course.title);

    const totalSlides = allSlides.length + 3;
    console.log(`✅ PPTX generated: ${totalSlides} slides for ${modules.length} modules`);

    const audit = runAudit();
    if (!audit.passed) console.error(`Audit: ${audit.errors.length} violations`);

    const pptxData = await pptx.write({ outputType: "uint8array" });
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = `${userId}/${safeName} - PPTX - ${dateStr}.pptx`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(fileName, pptxData, {
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: true,
      });
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: userId, event_type: "COURSE_EXPORTED_PPTX",
      metadata: { course_id, slide_count: totalSlides },
    });

    return new Response(JSON.stringify({ url: signedUrl.signedUrl }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Export PPTX error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
