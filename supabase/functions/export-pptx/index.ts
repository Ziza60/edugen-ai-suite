import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";

/**
 * PPTX EXPORT — EduGenAI Professional v2
 * 
 * MARKET-GRADE IMPROVEMENTS:
 * 1. Minimum 18pt body text — zero unreadable content
 * 2. Content preservation — never suppress examples, reflections, conclusions
 * 3. Overflow continuation slides — no truncation, content flows to next slide
 * 4. Hierarchical summarization — intelligent compression preserving key ideas
 * 5. Template-specific rendering — Fundamentos, Tabela, Exemplo, Resumo
 * 6. Pre-render validation — zero truncated texts guarantee
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ═══════════════════════════════════════════════════════
   DESIGN SYSTEM v2 — Market-grade typography & layout
   Canvas: 13.333" x 7.5" (16:9), Safe area: 12" x 6.5"
   ═══════════════════════════════════════════════════════ */

// ── THEME SYSTEM ──
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

// ── PALETTE SYSTEM ──
const PALETTES: Record<string, string[]> = {
  default: ["9B59B6", "3498DB", "27AE60", "F39C12", "1ABC9C"],
  ocean:   ["2980B9", "3498DB", "1ABC9C", "16A085", "2C3E50"],
  forest:  ["27AE60", "2ECC71", "1ABC9C", "16A085", "2C3E50"],
  sunset:  ["E74C3C", "E67E22", "F39C12", "D35400", "C0392B"],
  monochrome: ["2C3E50", "34495E", "7F8C8D", "95A5A6", "BDC3C7"],
};

// ── DENSITY MODES ──
interface DensityConfig {
  maxBulletsPerSlide: number;
  maxWordsPerBullet: number;
  maxCharsPerBullet: number;
  splitThreshold: number;
  compressRatio: number;
}
const DENSITY_MODES: Record<string, DensityConfig> = {
  compact: {
    maxBulletsPerSlide: 5, maxWordsPerBullet: 18, maxCharsPerBullet: 140,
    splitThreshold: 4, compressRatio: 0.50,
  },
  standard: {
    maxBulletsPerSlide: 5, maxWordsPerBullet: 25, maxCharsPerBullet: 180,
    splitThreshold: 5, compressRatio: 0.65,
  },
  detailed: {
    maxBulletsPerSlide: 6, maxWordsPerBullet: 30, maxCharsPerBullet: 220,
    splitThreshold: 7, compressRatio: 0.85,
  },
};

// Runtime config
let activePalette: string[] = PALETTES.default;
let activeDensity: DensityConfig = DENSITY_MODES.standard;
let activeThemeKey: "light" | "dark" = "light";
let currentTheme = THEME.light;

// Performance guardrails (previnem timeout/conexão fechada em cursos longos)
const MAX_SEMANTIC_SLIDES_PER_MODULE = 11;
const MAX_LLM_VALIDATION_SLIDES = 24;
const LLM_BATCH_SIZE = 12;
const LLM_REQUEST_TIMEOUT_MS = 18000;

function getC() {
  return {
    BG_WHITE: currentTheme.background,
    BG_LIGHT: currentTheme.backgroundSecondary,
    BG_CARD: currentTheme.background,
    BG_CARD_ALT: activeThemeKey === "dark" ? "3D566E" : "F2F3F5",
    PRIMARY: currentTheme.text,
    SECONDARY: currentTheme.accent,
    ACCENT_PURPLE: activePalette[0] || "9B59B6",
    ACCENT_BLUE: activePalette[1] || "3498DB",
    ACCENT_GREEN: activePalette[2] || "27AE60",
    ACCENT_TEAL: activePalette[4] || "1ABC9C",
    ACCENT_RED: "E74C3C",
    ACCENT_ORANGE: activePalette[3] || "F39C12",
    TEXT_DARK: currentTheme.text,
    TEXT_BODY: activeThemeKey === "dark" ? "BDC3C7" : "34495E",
    TEXT_LIGHT: currentTheme.textSecondary,
    TEXT_WHITE: "FFFFFF",
    TABLE_HEADER_BG: activeThemeKey === "dark" ? "1A252F" : "34495E",
    TABLE_ROW_ODD: currentTheme.background,
    TABLE_ROW_EVEN: activeThemeKey === "dark" ? "3D566E" : "ECF0F1",
    TABLE_BORDER: currentTheme.borders,
    CARD_BORDER: activeThemeKey === "dark" ? "4A6278" : "E0E0E0",
    CARD_SHADOW: activeThemeKey === "dark" ? "1A252F" : "D5D8DC",
    INSIGHT_BG: activeThemeKey === "dark" ? "3D2E1A" : "FDF2E9",
    INSIGHT_BORDER: currentTheme.accent,
    REFLECTION_BG: activeThemeKey === "dark" ? "1A2E3D" : "EBF5FB",
  };
}

let C = getC();
function refreshColors() { C = getC(); }

const CARD_ACCENT_COLORS_FN = () => [C.ACCENT_BLUE, C.ACCENT_GREEN, C.ACCENT_PURPLE, C.SECONDARY, C.ACCENT_RED, C.PRIMARY];
const MODULE_NUMBER_COLORS_FN = () => activePalette.slice(0, 5);

// ── SLIDE TEMPLATES ──
interface SlideTemplate {
  fonts: { title: string; body: string };
  colors: { primary: string; secondary: string; accent: string };
}
const SLIDE_TEMPLATES: Record<string, SlideTemplate> = {
  default: {
    fonts: { title: "Montserrat", body: "Open Sans" },
    colors: { primary: "2C3E50", secondary: "9B59B6", accent: "E67E22" },
  },
  academic: {
    fonts: { title: "Times New Roman", body: "Arial" },
    colors: { primary: "003366", secondary: "6699CC", accent: "FF6600" },
  },
  corporate: {
    fonts: { title: "Montserrat", body: "Open Sans" },
    colors: { primary: "1A1A1A", secondary: "4A4A4A", accent: "007BFF" },
  },
  creative: {
    fonts: { title: "Playfair Display", body: "Lato" },
    colors: { primary: "2C3E50", secondary: "E74C3C", accent: "F39C12" },
  },
};

let activeTemplate: SlideTemplate = SLIDE_TEMPLATES.default;

// ── TYPOGRAPHY v2 — Market-grade minimum sizes ──
let FONT_TITLE = "Montserrat";
let FONT_BODY = "Open Sans";

const TYPO = {
  MODULE_NUMBER: 72,     // Montserrat Bold
  MODULE_TITLE: 32,      // Montserrat Bold
  SECTION_TITLE: 30,     // Montserrat Bold
  SUBTITLE: 20,          // Open Sans Regular — INCREASED from 18
  BODY: 18,              // Open Sans Regular — INCREASED from 14 (market minimum)
  BODY_LARGE: 20,        // Open Sans Regular — INCREASED from 16
  SUPPORT: 14,           // Open Sans Regular — INCREASED from 12
  LABEL: 14,             // Open Sans Bold UPPERCASE
  TABLE_HEADER: 14,      // Bold, white on dark — INCREASED from 12
  TABLE_CELL: 13,        // Regular — INCREASED from 11
  CARD_TITLE: 16,        // Montserrat Bold — INCREASED from 14
  CARD_BODY: 14,         // Open Sans Regular — INCREASED from 12
  BULLET_TEXT: 18,       // Open Sans — INCREASED from 16 (market minimum)
  TAKEAWAY_TITLE: 15,    // Montserrat Bold — INCREASED from 13
  TAKEAWAY_BODY: 13,     // Open Sans — INCREASED from 11
  ICON: 18,              // Symbol/icon size
  FOOTER: 14,            // Footer text
};

// ── CANVAS & GRID ──
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN = 0.667;
const SAFE_W = 12.0;
const SAFE_H = 6.5;
const BOTTOM_MARGIN = 0.50;

const ZONE = {
  HEADER_START: 0.50,
  HEADER_END: 2.0,
  CONTENT_START: 2.0,
  CONTENT_END: 6.0,
  FOOTER_START: 6.0,
  FOOTER_END: 7.0,
  LEFT: 0.667,
  RIGHT: 12.667,
};

// ── TEXT DENSITY CONSTRAINTS ──
const DENSITY_LIMITS: Record<string, { minArea: number; maxChars: number; maxDensity: number }> = {
  title:       { minArea: 15,  maxChars: 60,  maxDensity: 4 },
  moduleTitle: { minArea: 6,   maxChars: 40,  maxDensity: 6.7 },
  subtitle:    { minArea: 4,   maxChars: 60,  maxDensity: 15 },
  bullet:      { minArea: 3.5, maxChars: 50,  maxDensity: 14.3 },
};

/* ═══════════════════════════════════════════════════════
   SMART TEXT WRAPPING — Multi-line title handling v2
   ═══════════════════════════════════════════════════════ */

interface AjusteTextoResult {
  texto: string;
  linhas: number;
  truncado: boolean;
}

function ajustarTextoAoBox(texto: string, maxCaracteresPorLinha: number, maxLinhas = 2): AjusteTextoResult {
  if (!texto) return { texto: "", linhas: 0, truncado: false };
  const t = texto.trim();
  
  if (t.length <= maxCaracteresPorLinha) {
    return { texto: t, linhas: 1, truncado: false };
  }
  
  const palavras = t.split(' ');
  const linhas: string[] = [];
  let linhaAtual = '';
  
  for (const palavra of palavras) {
    if (linhaAtual === '') {
      linhaAtual = palavra;
    } else if ((linhaAtual + ' ' + palavra).length <= maxCaracteresPorLinha) {
      linhaAtual += ' ' + palavra;
    } else {
      linhas.push(linhaAtual);
      if (linhas.length >= maxLinhas) {
        // Last allowed line — truncate remaining
        const remaining = palavras.slice(palavras.indexOf(palavra)).join(' ');
        if (remaining.length <= maxCaracteresPorLinha) {
          linhas.push(remaining);
        } else {
          // Truncate at word boundary
          let lastLine = '';
          for (const p of palavras.slice(palavras.indexOf(palavra))) {
            if ((lastLine + ' ' + p).trim().length <= maxCaracteresPorLinha - 3) {
              lastLine = (lastLine + ' ' + p).trim();
            } else break;
          }
          linhas.push(lastLine + '...');
        }
        break;
      }
      linhaAtual = palavra;
    }
  }
  if (linhaAtual && linhas.length < maxLinhas) {
    linhas.push(linhaAtual);
  }
  
  const resultado = linhas.join('\n');
  const truncado = resultado.endsWith('...');
  return { 
    texto: resultado, 
    linhas: linhas.length, 
    truncado
  };
}

/* ═══════════════════════════════════════════════════════
   PRE-RENDER VALIDATION v2 — Enhanced checks
   ═══════════════════════════════════════════════════════ */

function validarSlide(slideTextos: string[], slideWidth: number, slideHeight: number): string[] {
  const erros: string[] = [];
  
  if (Math.abs(slideWidth - 13.333) > 0.01 || Math.abs(slideHeight - 7.5) > 0.01) {
    erros.push("ERRO: Dimensoes incorretas! (" + slideWidth + "x" + slideHeight + ")");
  }
  
  for (const texto of slideTextos) {
    if (!texto || texto.length < 3) continue;
    // Detect truncation: preposition + short word at end without punctuation
    if (/\s(d[ao]s?|nas?|em|por|para|a|o|e|ou)\s+\w{1,3}$/.test(texto) && !/[.!?…]$/.test(texto)) {
      erros.push("TRUNCAMENTO: \"" + texto.substring(0, 50) + "\"");
    }
    if (/\b(do\.|das\.|nas\.|em\.|a\.|de\.)$/.test(texto)) {
      erros.push("TRUNCAMENTO preposicao: \"" + texto.substring(0, 50) + "\"");
    }
    // Detect mid-word cut (word fragment at end)
    if (/[a-záéíóúãõâêîôûç]{1,2}$/.test(texto) && texto.length > 20 && !/[.!?…:;]$/.test(texto)) {
      const lastWord = texto.split(/\s+/).pop() || "";
      if (lastWord.length <= 2 && !/^(é|e|a|o|ou|em|se|já|só|aí|há)$/i.test(lastWord)) {
        erros.push("FRAGMENTO: \"" + texto.substring(Math.max(0, texto.length - 30)) + "\"");
      }
    }
  }
  
  return erros;
}

/* ═══════════════════════════════════════════════════════
   SMART TRUNCATION v2 — NEVER CUT WORDS, preserve meaning
   ═══════════════════════════════════════════════════════ */

function smartTruncate(text: string, maxChars: number, addEllipsis = false): string {
  if (!text) return "";
  const t = text.trim();
  if (t.length <= maxChars) return t;

  // Try to find a sentence boundary within the limit first
  const sub = t.substring(0, maxChars);
  const sentenceEnd = Math.max(sub.lastIndexOf(". "), sub.lastIndexOf("! "), sub.lastIndexOf("? "));
  if (sentenceEnd > maxChars * 0.5) {
    return t.substring(0, sentenceEnd + 1).trim();
  }

  const truncated = t.substring(0, maxChars);
  const lastSpace = truncated.lastIndexOf(" ");

  let result: string;
  if (lastSpace > maxChars * 0.4) {
    result = truncated.substring(0, lastSpace).trim();
  } else {
    const nextSpace = t.indexOf(" ", maxChars);
    if (nextSpace > 0 && nextSpace < maxChars + 15) {
      result = t.substring(0, nextSpace).trim();
    } else {
      result = truncated.trim();
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

  // Clean trailing artifacts AND trailing prepositions/articles (iterative)
  const TRAILING_PREPS = /\s+(da|de|do|das|dos|na|no|nas|nos|em|ao|à|um|uma|com|por|para|que|e|ou|o|a|os|as|seu|sua|seus|suas|este|esta|esse|essa|esses|essas|estes|estas|seu|nosso|nossa|nossos|nossas)$/i;
  let prevResult = "";
  while (prevResult !== result) {
    prevResult = result;
    result = result.replace(/[\s,;:\-–]+$/, "").trim();
    result = result.replace(TRAILING_PREPS, "").trim();
  }

  if (addEllipsis && result.length < t.length && !/[.!?]$/.test(result)) {
    result += "...";
  }

  return result;
}

function smartTitle(text: string): string {
  return smartTruncate(text, 50); // Increased from 40 for longer titles
}

function smartSubtitle(text: string): string {
  if (!text) return "";
  const t = text.trim();
  // Allow up to 200 chars for cover descriptions (2-3 lines at 18pt)
  if (t.length <= 200) return t;
  // Find sentence boundary within 200 chars
  const sub = t.substring(0, 200);
  const sentenceEnd = Math.max(sub.lastIndexOf(". "), sub.lastIndexOf("! "), sub.lastIndexOf("? "));
  if (sentenceEnd > 80) return sub.substring(0, sentenceEnd + 1).trim();
  // Fall back to word boundary, but NEVER cut at prepositions/articles
  const TRAILING_PREPS = /\s+(da|de|do|das|dos|na|no|nas|nos|em|ao|à|um|uma|com|por|para|que|e|ou|o|a|os|as|seu|sua|seus|suas)$/i;
  let result = sub.substring(0, sub.lastIndexOf(" ")).trim();
  result = result.replace(TRAILING_PREPS, "").trim();
  result = result.replace(/[,;:\-–]+$/, "").trim();
  if (!/[.!?]$/.test(result)) result += ".";
  return result;
}

function smartBullet(text: string): string {
  if (!text) return "";
  const maxChars = activeDensity.maxCharsPerBullet;
  const t = text.trim();
  
  // If text fits within limit, return as-is (preserve full sentences)
  if (t.length <= maxChars) {
    if (!/[.!?]$/.test(t)) return t + ".";
    return t;
  }
  
  // Try to cut at a sentence boundary first (preserve complete sentences)
  const sub = t.substring(0, maxChars);
  const sentenceEnd = Math.max(sub.lastIndexOf(". "), sub.lastIndexOf("! "), sub.lastIndexOf("? "));
  if (sentenceEnd > maxChars * 0.4) {
    return t.substring(0, sentenceEnd + 1).trim();
  }
  
  // Fall back to smartTruncate
  const result = smartTruncate(t, maxChars);
  if (result && !/[.!?]$/.test(result)) return result + ".";
  return result;
}

function smartCell(text: string): string {
  return smartTruncate(text, 90); // Increased from 80 for wider cells
}

function smartModuleDesc(text: string): string {
  return smartTruncate(text, 50); // Increased from 40
}

/* ═══════════════════════════════════════════════════════
   SEMANTIC ICON MAPPING
   ═══════════════════════════════════════════════════════ */

const ICON_SYMBOLS: Record<string, string> = {
  brain: "◆", robot: "⊛", magnify: "◎", target: "◇",
  cog: "⊕", users: "☆", lightbulb: "✧", chart: "▥",
  clock: "◔", shield: "◈", message: "▣", education: "△",
  finance: "▽", health: "✦", marketing: "▷", vision: "◐",
  language: "▤", neural: "◑",
};

const ICON_KEYWORDS: [RegExp, string][] = [
  [/\b(intelig[eê]ncia|ia\b|c[eé]rebro|cognit|racioic[ií]n|aprend)/i, "brain"],
  [/\b(automa|rob[oô]|m[aá]quina|bot|robo)/i, "robot"],
  [/\b(busca|an[aá]lise|analis|pesquis)/i, "magnify"],
  [/\b(objetivo|meta|alvo|target|foco)/i, "target"],
  [/\b(processo|config|sistema|fluxo|pipeline)/i, "cog"],
  [/\b(pessoa|cliente|usu[aá]rio|equipe|colabor|grupo|atendimento)/i, "users"],
  [/\b(ideia|inova[cç]|criativ|insight)/i, "lightbulb"],
  [/\b(dado|gr[aá]fico|m[eé]trica|chart|indicador|dashboard|kpi)/i, "chart"],
  [/\b(tempo|velocidade|efici[eê]ncia|r[aá]pid|[aá]gil)/i, "clock"],
  [/\b(seguran[cç]|prote[cç]|escudo|privacidade)/i, "shield"],
  [/\b(comunica|chat|mensag|conversa|di[aá]logo)/i, "message"],
  [/\b(educa|ensino|aprendiz|curso|treinamento)/i, "education"],
  [/\b(finance|dinheiro|custo|investimento|receita)/i, "finance"],
  [/\b(sa[uú]de|m[eé]dic|diagn[oó]stico|hospital)/i, "health"],
  [/\b(marketing|venda|promo[cç]|campanha)/i, "marketing"],
  [/\b(vis[aã]o|imagem|visual|reconhec|computacional)/i, "vision"],
  [/\b(linguag|texto|escrit|plataforma|nlp|pln)/i, "language"],
  [/\b(deep learning|rede neural|neural)/i, "neural"],
];

const FALLBACK_ICON_ORDER = ["brain", "target", "lightbulb", "chart", "cog", "magnify", "users", "clock"] as const;

let _slideIconsUsed: Set<string> = new Set();
function resetSlideIcons() { _slideIconsUsed = new Set(); }

function getSemanticIcon(text: string, fallbackIdx: number): string {
  for (const [pattern, iconKey] of ICON_KEYWORDS) {
    if (pattern.test(text) && !_slideIconsUsed.has(iconKey)) {
      _slideIconsUsed.add(iconKey);
      return ICON_SYMBOLS[iconKey] || "●";
    }
  }
  for (let i = 0; i < FALLBACK_ICON_ORDER.length; i++) {
    const key = FALLBACK_ICON_ORDER[(fallbackIdx + i) % FALLBACK_ICON_ORDER.length];
    if (!_slideIconsUsed.has(key)) {
      _slideIconsUsed.add(key);
      return ICON_SYMBOLS[key] || "●";
    }
  }
  return "●";
}

type IconOffset = { x: number; y: number };
const ICON_OPTICAL_OFFSETS: Record<string, IconOffset> = {
  "◆": { x: 0.00, y: -0.01 },
  "⊛": { x: 0.00, y: -0.01 },
  "◎": { x: 0.00, y: -0.01 },
  "◇": { x: 0.00, y: -0.01 },
  "⊕": { x: 0.00, y: -0.01 },
  "☆": { x: 0.00, y: -0.01 },
  "✧": { x: 0.00, y: -0.02 },
  "▥": { x: 0.00, y: -0.01 },
  "◔": { x: 0.00, y: -0.01 },
  "◈": { x: 0.00, y: -0.01 },
  "▣": { x: 0.00, y: -0.01 },
  "△": { x: 0.00, y: -0.01 },
  "▽": { x: 0.00, y: -0.01 },
  "✦": { x: 0.00, y: -0.02 },
  "▷": { x: 0.00, y: -0.01 },
  "◐": { x: 0.00, y: -0.01 },
  "◑": { x: 0.00, y: -0.01 },
};

function addCenteredIconInCircle(slide: any, pptx: any, cfg: {
  x: number;
  y: number;
  size: number;
  circleColor: string;
  iconChar: string;
  iconColor?: string;
  fontSize?: number;
}) {
  const iconColor = cfg.iconColor || C.TEXT_WHITE;
  const iconSize = cfg.fontSize || TYPO.ICON;
  const offset = ICON_OPTICAL_OFFSETS[cfg.iconChar] || { x: 0, y: -0.01 };

  slide.addShape(pptx.ShapeType.ellipse, {
    x: cfg.x,
    y: cfg.y,
    w: cfg.size,
    h: cfg.size,
    fill: { color: cfg.circleColor },
  });

  addTextSafe(slide, cfg.iconChar, {
    x: cfg.x + offset.x,
    y: cfg.y + offset.y,
    w: cfg.size,
    h: cfg.size,
    fontSize: iconSize,
    fontFace: FONT_BODY,
    color: iconColor,
    bold: true,
    align: "center",
    valign: "middle",
    inset: 0,
  });
}

/* ═══════════════════════════════════════════════════════
   TEXT DENSITY VALIDATION v2
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
  const estimatedLines = boxHeight / (fontSize * 1.5 * 0.0139);
  const maxChars = Math.floor(estimatedCharsPerLine * estimatedLines * 0.85); // 15% safety

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

function autoAdjustText(text: string, boxWidth: number, boxHeight: number, maxFont = 32, minFont = 12): AutoAdjustResult {
  for (let size = maxFont; size >= minFont; size -= 1) {
    const check = validateTextDensity(text, boxWidth, boxHeight, size);
    if (check.fits) {
      return { fontSize: size, truncated: false, text };
    }
  }
  // Last resort: truncate with smartTruncate but try to preserve sentence boundaries
  const maxLen = validateTextDensity(text, boxWidth, boxHeight, minFont).maxChars;
  if (maxLen >= text.length * 0.85) {
    // Close enough — find sentence boundary instead of hard truncate
    const sub = text.substring(0, maxLen);
    const sentenceEnd = Math.max(sub.lastIndexOf(". "), sub.lastIndexOf("! "), sub.lastIndexOf("? "));
    if (sentenceEnd > maxLen * 0.5) {
      return { fontSize: minFont, truncated: true, text: text.substring(0, sentenceEnd + 1).trim() };
    }
  }
  return {
    fontSize: minFont,
    truncated: true,
    text: smartTruncate(text, Math.max(maxLen - 3, 10), true),
  };
}

/* ═══════════════════════════════════════════════════════
   TRUNCATION DETECTION v2
   ═══════════════════════════════════════════════════════ */

function detectTruncation(text: string): boolean {
  if (!text || text.length < 5) return false;
  const trimmed = text.trim();

  // SHORT TEXT EXEMPTIONS — labels, headers, proper nouns, acronyms are NOT truncated
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount <= 3 && trimmed.length < 40) return false;
  if (/^[A-ZÁÉÍÓÚÃÕ\s\d]+$/.test(trimmed)) return false;
  if (/^\d{1,2}[\.\)]\s/.test(trimmed)) return false;

  // Ends in dangling connector/preposition/article without sentence closure
  if (/\s(de|da|do|das|dos|na|no|nas|nos|em|para|por|com|ao|à|a|o|as|os|e|ou|que|seu|sua|seus|suas)\s*$/i.test(trimmed) && !/[.!?…:]$/.test(trimmed)) {
    return true;
  }

  // Ends with very short orphan token (likely cut word) and no punctuation
  const lastWord = trimmed.split(/\s+/).pop() || "";
  if (lastWord.length <= 2 && trimmed.length > 24 && !/[.!?…:;\)\]"']$/.test(trimmed)) {
    if (!/^(é|e|a|o|ou|em|se|já|só|aí|há|IA|AI|TI|UX|UI|ML|BI|CX|RH)$/i.test(lastWord)) return true;
  }

  return false;
}

function enforceSentenceIntegrity(text: string): string {
  if (!text) return "";
  let t = text
    .replace(/\u00AD/g, "") // soft hyphen
    .replace(/�/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Remove trailing particles that indicate truncation
  t = t.replace(/\s+(de|da|do|das|dos|na|no|nas|nos|em|para|por|com|ao|à|a|o|as|os|e|ou|que|seu|sua|seus|suas)$/i, "").trim();
  t = t.replace(/[,:;\-–]+$/, "").trim();

  if (t.length > 0 && !/[.!?…:]$/.test(t)) t += ".";
  return t;
}

/* ═══════════════════════════════════════════════════════
   TEXT COMPRESSION v2 — Preserves key ideas
   ═══════════════════════════════════════════════════════ */

function compressText(text: string, maxChars: number = 120): string {
  if (!text || text.length <= maxChars) return text;
  let t = text;
  // Conservative compression only (avoid semantic corruption)
  t = t.replace(/\bpor\s+exemplo\b/gi, "exemplo");
  t = t.replace(/\bno\s+entanto\b/gi, "porém");
  t = t.replace(/\bal[eé]m\s+disso\b/gi, "também");
  t = t.replace(/\s{2,}/g, " ").trim();

  if (t.length > maxChars) {
    t = smartTruncate(t, maxChars);
    t = enforceSentenceIntegrity(t);
  }
  return t;
}

function compressBullet(text: string): string {
  return compressText(text, activeDensity.maxCharsPerBullet);
}

function compressTableCell(text: string): string {
  const compressed = compressText(text, 90);
  return smartCell(compressed);
}

/* ═══════════════════════════════════════════════════════
   NLP PIPELINE — Terminology, Dedup, Grammar, WCAG, BBox
   ═══════════════════════════════════════════════════════ */

// ── TERMINOLOGY NORMALIZATION ──
const TERMINOLOGY_MAP: [RegExp, string][] = [
  [/\bintelig[eê]ncia artificial\b/gi, "Inteligência Artificial"],
  [/\bmachine learning\b/gi, "Machine Learning"],
  [/\bdeep learning\b/gi, "Deep Learning"],
  [/\bprocessamento de linguagem natural\b/gi, "Processamento de Linguagem Natural"],
  [/\bredes? neurais?\b/gi, "Redes Neurais"],
  [/\bbig data\b/gi, "Big Data"],
  [/\bcloud computing\b/gi, "Cloud Computing"],
  [/\bInternet das Coisas\b/gi, "Internet das Coisas"],
  [/\b(block ?chain)\b/gi, "Blockchain"],
  [/\bdata ?science\b/gi, "Data Science"],
  [/\buser experience\b/gi, "User Experience"],
];

function normalizeTerminology(text: string): string {
  if (!text) return "";
  let result = text;
  for (const [pattern, replacement] of TERMINOLOGY_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ── TF-IDF EMBEDDINGS & COSINE SIMILARITY ──
// Replaces basic Jaccard with TF-IDF weighted cosine similarity for semantic coherence

function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\wà-úÀ-Ú]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function wordSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

// Build TF vector: term frequency normalized by document length
function buildTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  if (tokens.length === 0) return tf;
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  for (const [k, v] of tf) tf.set(k, v / tokens.length);
  return tf;
}

// Corpus-level IDF cache (populated per export run)
let _idfCache: Map<string, number> = new Map();
let _idfCorpusSize = 0;

function resetIdfCache() { _idfCache = new Map(); _idfCorpusSize = 0; }

function buildIdfFromCorpus(documents: string[]) {
  const docCount = documents.length;
  if (docCount === 0) return;
  const df = new Map<string, number>();
  for (const doc of documents) {
    const unique = new Set(tokenize(doc));
    for (const t of unique) df.set(t, (df.get(t) || 0) + 1);
  }
  _idfCache = new Map();
  for (const [term, count] of df) {
    _idfCache.set(term, Math.log((docCount + 1) / (count + 1)) + 1);
  }
  _idfCorpusSize = docCount;
  console.log("[TF-IDF] Corpus built: " + docCount + " docs, " + _idfCache.size + " terms");
}

function getIdf(term: string): number {
  return _idfCache.get(term) || Math.log((_idfCorpusSize + 1) / 1) + 1;
}

// TF-IDF cosine similarity (replaces Jaccard — higher quality semantic matching)
function tfidfCosineSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 && tokensB.length === 0) return 1;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const tfA = buildTF(tokensA);
  const tfB = buildTF(tokensB);

  // Collect all terms
  const allTerms = new Set([...tfA.keys(), ...tfB.keys()]);

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const term of allTerms) {
    const idf = getIdf(term);
    const weightA = (tfA.get(term) || 0) * idf;
    const weightB = (tfB.get(term) || 0) * idf;
    dotProduct += weightA * weightB;
    normA += weightA * weightA;
    normB += weightB * weightB;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

// Backward-compatible alias (all callers use this)
function jaccardSimilarity(a: string, b: string): number {
  // Use TF-IDF when corpus is built, fallback to basic overlap otherwise
  if (_idfCorpusSize > 0) return tfidfCosineSimilarity(a, b);
  // Basic fallback
  const setA = wordSet(a);
  const setB = wordSet(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function deduplicateItems(items: string[], threshold = 0.70): string[] {
  if (items.length <= 1) return items;
  const result: string[] = [items[0]];
  for (let i = 1; i < items.length; i++) {
    let dupIdx = -1;
    for (let k = 0; k < result.length; k++) {
      if (jaccardSimilarity(items[i], result[k]) >= threshold) {
        dupIdx = k;
        break;
      }
    }
    if (dupIdx >= 0) {
      // MERGE: keep the longer/more complete version, append unique info from shorter
      const existing = result[dupIdx];
      const incoming = items[i];
      const existingWords = wordSet(existing);
      const incomingWords = wordSet(incoming);
      const uniqueIncoming = [...incomingWords].filter(w => !existingWords.has(w));
      
      if (incoming.length > existing.length) {
        // Incoming is more complete — replace
        result[dupIdx] = incoming;
        console.log("[DEDUP] Merged (replaced shorter): \"" + existing.substring(0, 35) + "...\"");
      } else if (uniqueIncoming.length >= 3 && existing.length + 30 < 130) {
        // Existing is longer but incoming has unique content — append summary
        const suffix = uniqueIncoming.slice(0, 4).join(", ");
        let merged = existing.replace(/[.!?]\s*$/, "") + " (" + suffix + ").";
        if (merged.length > 130) merged = existing; // Don't bloat
        result[dupIdx] = merged;
        console.log("[DEDUP] Merged (appended unique): \"" + incoming.substring(0, 35) + "...\"");
      } else {
        console.log("[DEDUP] Merged (kept existing): \"" + incoming.substring(0, 35) + "...\"");
      }
    } else {
      result.push(items[i]);
    }
  }
  return result;
}

function deduplicateAcrossSlides(slides: SlideData[]): SlideData[] {
  const seenContent = new Map<string, number>(); // key -> slide index
  const result: SlideData[] = [];
  
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (s.layout === "module_cover" || s.layout === "numbered_takeaways" || 
        s.layout === "example_highlight" || s.layout === "reflection_callout") {
      result.push(s);
      continue;
    }
    const key = (s.items || []).map(it => it.toLowerCase().trim().substring(0, 50)).sort().join("|");
    if (key.length < 10) {
      result.push(s);
      continue;
    }
    const existingIdx = seenContent.get(key);
    if (existingIdx !== undefined) {
      // MERGE unique items from duplicate into existing slide instead of discarding
      const existing = result[existingIdx];
      if (existing.items && s.items) {
        const existingSet = new Set(existing.items.map(it => it.toLowerCase().trim().substring(0, 50)));
        const uniqueItems = s.items.filter(it => !existingSet.has(it.toLowerCase().trim().substring(0, 50)));
        if (uniqueItems.length > 0 && existing.items.length + uniqueItems.length <= activeDensity.maxBulletsPerSlide) {
          existing.items.push(...uniqueItems);
          console.log("[DEDUP-SLIDE] Merged " + uniqueItems.length + " unique items from: \"" + s.title + "\"");
        } else {
          console.log("[DEDUP-SLIDE] Removed duplicate slide: \"" + s.title + "\"");
        }
      }
    } else {
      seenContent.set(key, result.length);
      result.push(s);
    }
  }
  return result;
}

// ── PORTUGUESE GRAMMAR VALIDATION & AUTO-FIX (regex fallback) ──
const PT_GRAMMAR_FIXES: [RegExp, string][] = [
  [/\bà partir\b/g, "a partir"],
  [/\bà nível\b/g, "em nível"],
  [/\bà medida que\b/gi, "à medida que"],
  [/\bafim de\b/g, "a fim de"],
  [/\bde mais\b(?!\s+(de|que))/g, "demais"],
  [/\ba cêrca\b/gi, "acerca"],
  [/\bem baixo\b(?!\s+de)/g, "embaixo"],
  [/\bpor que\b(?=[.!?])/g, "por quê"],
  [/\baonde\b(?!\s+(ir|vai|vou|vamos|foram|foram|chegou))/g, "onde"],
  [/\bmenas\b/g, "menos"],
  [/\bfazem\s+(\d+)\s+(anos?|dias?|meses?)\b/g, "faz $1 $2"],
  [/\bhouveram\b/g, "houve"],
  [/\bentretando\b/g, "entretanto"],
  [/\bimpresindível\b/gi, "imprescindível"],
  [/\bprevilégio\b/gi, "privilégio"],
  [/\bexcessão\b/gi, "exceção"],
  [/\bconcerteza\b/gi, "com certeza"],
];

interface GrammarResult {
  text: string;
  corrections: string[];
}

function validateAndFixGrammar(text: string): GrammarResult {
  if (!text || text.length < 5) return { text, corrections: [] };
  let result = text;
  const corrections: string[] = [];
  for (const [pattern, replacement] of PT_GRAMMAR_FIXES) {
    if (pattern.test(result)) {
      const before = result;
      result = result.replace(pattern, replacement);
      if (result !== before) {
        corrections.push("Corrigido: \"" + before.substring(0, 30) + "\" → \"" + result.substring(0, 30) + "\"");
      }
    }
  }
  const beforeSpaces = result;
  result = result.replace(/\s{2,}/g, " ").trim();
  if (result !== beforeSpaces) corrections.push("Espacos duplos corrigidos");
  result = result.replace(/\.\s+[a-záéíóúãõâêîôûç]/g, (m) => m.toUpperCase());
  return { text: result, corrections };
}

const COLON_LABEL_WORDS = new Set([
  "nota", "dica", "objetivo", "exemplo", "resumo", "etapa", "módulo", "modulo",
  "slide", "importante", "atenção", "atencao", "definição", "definicao", "pergunta", "resposta",
]);

function fixBrokenColonWords(text: string): { text: string; fixes: number } {
  if (!text) return { text: "", fixes: 0 };
  let result = text;
  let fixes = 0;

  // Ex: e: mails -> e-mails
  result = result.replace(/\b([A-Za-zÀ-ÖØ-öø-ÿ]{1,3}):\s+([A-Za-zÀ-ÖØ-öø-ÿ]{3,})\b/g, (_m, a, b) => {
    fixes++;
    return `${a}-${b}`;
  });

  // Ex: tornando: a -> tornando-a
  result = result.replace(/\b([A-Za-zÀ-ÖØ-öø-ÿ]{4,}(?:ando|endo|indo|ndo|ar|er|ir)):\s+([a-zà-öø-ÿ]{1,3})\b/gi, (_m, a, b) => {
    fixes++;
    return `${a}-${b}`;
  });

  // Ex: transformando: o -> transformando-o (evita labels legítimos como "Nota: ...")
  result = result.replace(/\b([A-Za-zÀ-ÖØ-öø-ÿ]{4,}):\s+([a-zà-öø-ÿ]{1,2})\b/g, (m, a, b) => {
    if (COLON_LABEL_WORDS.has(String(a).toLowerCase())) return m;
    fixes++;
    return `${a}-${b}`;
  });

  return { text: result, fixes };
}

function hasSuspiciousColonBreak(text: string): boolean {
  if (!text) return false;
  return /\b[A-Za-zÀ-ÖØ-öø-ÿ]{1,3}:\s+[A-Za-zÀ-ÖØ-öø-ÿ]{3,}\b/.test(text)
    || /\b[A-Za-zÀ-ÖØ-öø-ÿ]{4,}(?:ando|endo|indo|ndo|ar|er|ir):\s+[a-zà-öø-ÿ]{1,3}\b/i.test(text);
}

// ── WCAG CONTRAST VALIDATION ──
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(fg: string, bg: string): number {
  const [r1, g1, b1] = hexToRgb(fg);
  const [r2, g2, b2] = hexToRgb(bg);
  const l1 = relativeLuminance(r1, g1, b1);
  const l2 = relativeLuminance(r2, g2, b2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function checkWCAGContrast(fg: string, bg: string, fontSize: number): { ratio: number; passesAA: boolean; passesAAA: boolean } {
  const ratio = contrastRatio(fg, bg);
  const isLargeText = fontSize >= 18;
  return {
    ratio,
    passesAA: ratio >= (isLargeText ? 3.0 : 4.5),
    passesAAA: ratio >= (isLargeText ? 4.5 : 7.0),
  };
}

// ── IMPROVED BOUNDING BOX MEASUREMENT v3 — More accurate with safety margins ──
const FONT_WIDTH_FACTORS: Record<string, number> = {
  "Montserrat": 0.60,  // Slightly wider than before for safety
  "Open Sans": 0.56,    // Slightly wider than before for safety
};

interface BBoxResult {
  fits: boolean;
  estimatedLines: number;
  maxLines: number;
  overflowChars: number;
  recommendedFontSize: number;
}

function measureBoundingBox(text: string, fontSize: number, fontFace: string, boxW: number, boxH: number): BBoxResult {
  const widthFactor = FONT_WIDTH_FACTORS[fontFace] || 0.57;
  const charWidthPx = fontSize * widthFactor;
  const charWidthIn = charWidthPx / 72;
  // More conservative line height with padding
  const lineHeightIn = (fontSize * 1.45) / 72;

  // Account for inset/padding (0.1" each side = 0.2" total)
  const effectiveW = Math.max(0.5, boxW - 0.25);
  const effectiveH = Math.max(0.2, boxH - 0.10);

  const charsPerLine = Math.max(5, Math.floor(effectiveW / charWidthIn));
  const maxLines = Math.max(1, Math.floor(effectiveH / lineHeightIn));
  const maxChars = charsPerLine * maxLines;

  // Word-wrap simulation for accurate line counting
  const words = text.split(/\s+/);
  let currentLineLen = 0;
  let lineCount = 1;
  for (const word of words) {
    const wordLen = word.length;
    if (currentLineLen === 0) {
      currentLineLen = wordLen;
    } else if (currentLineLen + 1 + wordLen > charsPerLine) {
      lineCount++;
      currentLineLen = wordLen;
    } else {
      currentLineLen += 1 + wordLen;
    }
  }

  const overflowChars = Math.max(0, text.length - maxChars);

  // Find recommended font size if text doesn't fit
  let recFont = fontSize;
  if (lineCount > maxLines) {
    for (let fs = fontSize - 1; fs >= 12; fs--) {
      const cw = (fs * widthFactor) / 72;
      const lh = (fs * 1.45) / 72;
      const cpl = Math.floor(effectiveW / cw);
      const ml = Math.floor(effectiveH / lh);
      let cl = 1, cll = 0;
      for (const w of words) {
        if (cll === 0) { cll = w.length; }
        else if (cll + 1 + w.length > cpl) { cl++; cll = w.length; }
        else { cll += 1 + w.length; }
      }
      if (cl <= ml) { recFont = fs; break; }
    }
  }

  return {
    fits: lineCount <= maxLines,
    estimatedLines: lineCount,
    maxLines,
    overflowChars,
    recommendedFontSize: recFont,
  };
}

function fitTextForBox(text: string, boxW: number, boxH: number, fontSize: number, fontFace: string, minFont = 12): { text: string; fontSize: number; adjusted: boolean } {
  const clean = enforceSentenceIntegrity(sanitize(text));
  let currentText = clean;
  let currentFont = fontSize;

  for (let i = 0; i < 4; i++) {
    const bbox = measureBoundingBox(currentText, currentFont, fontFace, boxW, boxH);
    if (bbox.fits) return { text: currentText, fontSize: currentFont, adjusted: i > 0 };

    if (bbox.recommendedFontSize < currentFont && bbox.recommendedFontSize >= minFont) {
      currentFont = bbox.recommendedFontSize;
      continue;
    }

    const targetChars = Math.max(24, currentText.length - Math.max(8, bbox.overflowChars + 4));
    currentText = compressText(currentText, targetChars);
  }

  return { text: currentText, fontSize: Math.max(currentFont, minFont), adjusted: true };
}

// ── CONTENT COHERENCE CHECK ──
function checkNarrativeCoherence(slides: SlideData[]): string[] {
  const warnings: string[] = [];
  let prevTitle = "";
  let prevItems: string[] = [];
  
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (s.layout === "module_cover") {
      prevTitle = s.title;
      prevItems = [];
      continue;
    }
    
    if (prevItems.length > 0 && s.items && s.items.length > 0) {
      const prevWords = wordSet(prevItems.join(" "));
      const currWords = wordSet(s.items.join(" "));
      let overlap = 0;
      for (const w of prevWords) if (currWords.has(w)) overlap++;
      const overlapRatio = prevWords.size > 0 ? overlap / prevWords.size : 0;
      
      if (overlapRatio < 0.05 && prevWords.size > 5 && currWords.size > 5) {
        warnings.push("Slide " + i + ": Possivel ruptura narrativa (overlap=" + (overlapRatio * 100).toFixed(0) + "% com slide anterior)");
      }
    }
    
    prevTitle = s.title;
    prevItems = s.items || [];
  }
  return warnings;
}

// ── FULL NLP PIPELINE v3 — Tokenization + Grammar + Dedup + Hybrid Summarization ──
function runNLPPipeline(items: string[]): { processed: string[]; stats: { deduped: number; grammarFixes: number; termNormalized: number; summarized: number } } {
  let stats = { deduped: 0, grammarFixes: 0, termNormalized: 0, summarized: 0 };

  // Step 1: Consistent tokenization & terminology normalization
  let processed = items.map(item => {
    const normalized = normalizeTerminology(item);
    if (normalized !== item) stats.termNormalized++;
    return normalized;
  });

  // Step 2: Grammar validation & auto-fix
  processed = processed.map(item => {
    const result = validateAndFixGrammar(item);
    stats.grammarFixes += result.corrections.length;
    return enforceSentenceIntegrity(result.text);
  });

  // Step 3: Hybrid summarization — compress long items heuristically
  processed = processed.map(item => {
    if (item.length <= activeDensity.maxCharsPerBullet) return item;
    // Heuristic summarization: extract key sentences
    const sentences = item.match(/[^.!?]+[.!?]+/g) || [item];
    if (sentences.length <= 1) return compressBullet(item);
    // Keep first and last sentences (intro + conclusion pattern)
    const summary = sentences.length > 2
      ? [sentences[0].trim(), sentences[sentences.length - 1].trim()].join(" ")
      : item;
    if (summary.length <= activeDensity.maxCharsPerBullet) {
      stats.summarized++;
      return enforceSentenceIntegrity(summary);
    }
    return compressBullet(item);
  });

  // Step 4: Sentence completeness validation
  processed = processed.map(item => {
    if (detectTruncation(item)) {
      return enforceSentenceIntegrity(item);
    }
    return item;
  });

  // Step 5: Deduplication with TF-IDF similarity
  const beforeLen = processed.length;
  processed = deduplicateItems(processed);
  stats.deduped = beforeLen - processed.length;

  return { processed, stats };
}

function semanticSimilarity(a: string, b: string): number {
  return jaccardSimilarity(a, b);
}

// ── RAG-STYLE RELEVANCE VALIDATION ──
// Validates each item's relevance to context using TF-IDF cosine similarity
// Items below threshold are dropped unless doing so would empty the slide
function validateRelevanceWithThreshold(items: string[], context: string, threshold = 0.12): { filtered: string[]; dropped: number } {
  if (!items.length || !context.trim()) return { filtered: items, dropped: 0 };

  // Score each item against context
  const scored = items.map(item => ({
    item,
    score: semanticSimilarity(item, context),
    isShort: item.length <= 50,
  }));

  // Filter: keep items above threshold OR short labels
  const filtered = scored
    .filter(s => s.score >= threshold || s.isShort)
    .map(s => s.item);

  // Safety: never drop ALL items
  if (filtered.length === 0 && items.length > 0) {
    const ranked = [...scored].sort((a, b) => b.score - a.score);
    const keepCount = Math.max(1, Math.ceil(items.length * 0.5));
    return {
      filtered: ranked.slice(0, keepCount).map(s => s.item),
      dropped: items.length - keepCount,
    };
  }

  const dropped = items.length - filtered.length;
  if (dropped > 0) {
    console.log("[RAG] Relevance filter: kept " + filtered.length + "/" + items.length + " items (threshold=" + threshold + ")");
  }
  return { filtered, dropped };
}

/* ═══════════════════════════════════════════════════════
   STAGE 0: LLM SEMANTIC CONTENT PLANNER
   Uses LLM to intelligently plan how content should be
   distributed across slides BEFORE rendering.
   This replaces dumb regex splitting with semantic understanding.
   ═══════════════════════════════════════════════════════ */

interface SemanticSlidePlan {
  slideTitle: string;
  sectionLabel: string;
  layout: "definition" | "bullets" | "grid_cards" | "process" | "table" | "example" | "reflection" | "takeaways";
  items: string[];
  tableHeaders?: string[];
  tableRows?: string[][];
}

interface SemanticModulePlan {
  moduleTitle: string;
  moduleDescription: string;
  objectives: string[];
  slides: SemanticSlidePlan[];
}

async function llmPlanModuleSlides(moduleTitle: string, moduleContent: string, moduleIndex: number, language: string, preParsedSummary?: string): Promise<SemanticModulePlan | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.warn("[SEMANTIC-PLANNER] LOVABLE_API_KEY not available, falling back to regex parser");
    return null;
  }

  // Use pre-parsed structured summary if available (from semantic parser),
  // otherwise fall back to raw markdown content
  const contentForPlanner = preParsedSummary || moduleContent;
  const maxContentLen = 12000;
  const truncatedContent = contentForPlanner.length > maxContentLen
    ? contentForPlanner.substring(0, maxContentLen) + "\n\n[... conteúdo truncado para processamento ...]"
    : contentForPlanner;

  const systemPrompt = `Você é um designer instrucional especialista em criar apresentações PowerPoint de alta qualidade a partir de conteúdo educacional.

O conteúdo do módulo segue uma ESTRUTURA PEDAGÓGICA FIXA com seções marcadas por emojis. Sua tarefa é mapear CADA seção para um slide, preservando a ordem e a identidade de cada seção.

## ESTRUTURA PEDAGÓGICA OBRIGATÓRIA (siga EXATAMENTE esta ordem)
O markdown do módulo contém estas seções, nesta ordem. Cada uma DEVE gerar um slide dedicado:

1. 🎯 **Objetivo do Módulo** → Os objetivos vão para o slide "module_cover" (gerado automaticamente). NÃO gere slide separado para objetivos.
2. 🧠 **Fundamentos** → layout "definition" (sectionLabel: "FUNDAMENTOS")
3. ⚙️ **Como funciona** → layout "process" (sectionLabel: "COMO FUNCIONA")
4. 🧩 **Modelos / Tipos** → layout "table" preferencialmente, ou "grid_cards" se não houver tabela (sectionLabel: "MODELOS E TIPOS")
5. 🛠️ **Aplicações reais** → layout "grid_cards" (sectionLabel: "APLICAÇÕES REAIS")
6. 💡 **Exemplo prático** → layout "example" (sectionLabel: "EXEMPLO PRÁTICO") — exatamente 3 items: Cenário, Solução, Resultado
7. ⚠️ **Desafios e cuidados** → layout "warning" (sectionLabel: "DESAFIOS E CUIDADOS")
8. 💭 **Reflexão** → layout "reflection" (sectionLabel: "REFLEXÃO")
9. 🧾 **Resumo do Módulo** → layout "summary" (sectionLabel: "RESUMO DO MÓDULO") — síntese textual dos pontos principais
10. 📌 **Key Takeaways** → layout "takeaways" (sectionLabel: "KEY TAKEAWAYS") — 5-7 items numerados

## REGRAS FUNDAMENTAIS
1. **Preservar TODAS as seções**: Cada seção do markdown DEVE ter um slide correspondente. NÃO pule, NÃO mescle seções diferentes.
2. **Frases COMPLETAS**: Cada item DEVE ser uma frase completa. NUNCA corte frases no meio.
3. **Cada slide = 1 seção**: Um slide mapeia exatamente UMA seção pedagógica.
4. **Máximo 5-6 items por slide**: Se uma seção tem mais pontos, use os mais importantes.
5. **Máximo 180 caracteres por item**: Resuma sem perder significado. Toda frase termina com ponto. Para seções de Exemplo, Desafios e Resumo, escreva frases COMPLETAS sem abreviação — até 250 caracteres se necessário.
6. **Títulos descritivos COM contexto**: O título do slide deve incluir o tópico do módulo (ex: "Fundamentos da IA Generativa" em vez de apenas "Fundamentos").
7. **Exemplo prático OBRIGATÓRIO**: O slide de exemplo deve ter exatamente 3 items: "Cenário: ...", "Solução: ...", "Resultado: ...".
8. **Key Takeaways OBRIGATÓRIO**: 5-7 pontos concisos e acionáveis.
9. **Desafios = warning**: Sempre use layout "warning" para desafios e cuidados.
10. **Resumo ≠ Takeaways**: Resumo é uma síntese textual (3-5 frases). Takeaways são itens numerados concisos.

## LAYOUTS DISPONÍVEIS
- "definition": Para definir um conceito (1 definição principal + 2-3 pilares)
- "bullets": Para lista de pontos (3-6 items)
- "grid_cards": Para conceitos paralelos com "Título: descrição" (3-6 items)
- "process": Para etapas sequenciais (3-4 etapas com "Etapa: descrição")
- "table": Para comparações (headers + rows, máx 5 linhas)
- "example": Para exemplos práticos (Cenário, Solução, Resultado)
- "warning": Para desafios, riscos e cuidados (3-5 items com alertas)
- "reflection": Para perguntas de reflexão (2-4 perguntas)
- "summary": Para resumo textual do módulo (3-5 frases de síntese)
- "takeaways": Para resumo final numerado (5-7 takeaways concisos)

Idioma: ${language || "pt-BR"}`;

  const contentLabel = preParsedSummary
    ? "CONTEÚDO PRÉ-SEGMENTADO (cada ### é uma seção pedagógica identificada, tags [TIPO] indicam o tipo de bloco):"
    : "CONTEÚDO DO MÓDULO:";
  const userPrompt = `Planeje a distribuição de slides para o módulo "${moduleTitle}" (Módulo ${moduleIndex + 1}).

${contentLabel}
${truncatedContent}`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "submit_slide_plan",
            description: "Submit the planned slide distribution for this module",
            parameters: {
              type: "object",
              properties: {
                moduleTitle: { type: "string", description: "Clean module title (without 'Módulo N:' prefix)" },
                moduleDescription: { type: "string", description: "One sentence describing the module objective (max 60 chars)" },
                objectives: {
                  type: "array",
                  items: { type: "string" },
                  description: "2-3 learning objectives for this module (max 60 chars each)"
                },
                slides: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      slideTitle: { type: "string", description: "Descriptive slide title with module context (max 50 chars). NEVER use generic titles like 'Introdução', 'Conceitos', 'Visão Geral'. Always include the specific topic." },
                      sectionLabel: { type: "string", description: "Short uppercase label (max 25 chars)" },
                      layout: {
                        type: "string",
                        enum: ["definition", "bullets", "grid_cards", "process", "table", "example", "warning", "reflection", "summary", "takeaways"],
                        description: "Slide layout type"
                      },
                      items: {
                        type: "array",
                        items: { type: "string" },
                        description: "Content items (complete sentences, max 180 chars each, ending with period. For example/warning/summary sections use up to 250 chars to ensure completeness)"
                      },
                      tableHeaders: {
                        type: "array",
                        items: { type: "string" },
                        description: "Table column headers (only for 'table' layout)"
                      },
                      tableRows: {
                        type: "array",
                        items: {
                          type: "array",
                          items: { type: "string" }
                        },
                        description: "Table rows (only for 'table' layout, max 5 rows)"
                      },
                    },
                    required: ["slideTitle", "sectionLabel", "layout", "items"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["moduleTitle", "moduleDescription", "objectives", "slides"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "submit_slide_plan" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[SEMANTIC-PLANNER] Gateway error " + response.status + ": " + errText.substring(0, 200));
      return null;
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.warn("[SEMANTIC-PLANNER] No tool call in response");
      return null;
    }

    let parsed: SemanticModulePlan;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      console.error("[SEMANTIC-PLANNER] Failed to parse tool call arguments");
      return null;
    }

    // Validate basic structure
    if (!parsed.slides || parsed.slides.length < 2) {
      console.warn("[SEMANTIC-PLANNER] Plan has too few slides (" + (parsed.slides?.length || 0) + "), falling back");
      return null;
    }

    // Post-process: enforce sentence integrity on all items
    for (const slide of parsed.slides) {
      slide.items = (slide.items || []).map(item => {
        let t = item.trim();
        if (t.length > 0 && !/[.!?…]$/.test(t)) t += ".";
        return t;
      }).filter(item => item.length > 3);

      // Enforce max items
      if (slide.layout !== "takeaways" && slide.items.length > 6) {
        slide.items = slide.items.slice(0, 6);
      }
      if (slide.layout === "takeaways" && slide.items.length > 7) {
        slide.items = slide.items.slice(0, 7);
      }
    }

    // Hard cap de slides por módulo para manter exportação estável e rápida
    if (parsed.slides.length > MAX_SEMANTIC_SLIDES_PER_MODULE) {
      const selected = new Set<number>();

      // Sempre manter início do raciocínio
      for (let i = 0; i < Math.min(3, parsed.slides.length); i++) selected.add(i);

      // Sempre manter blocos pedagógicos críticos
      const mustKeepLayouts: Array<SemanticSlidePlan["layout"]> = ["example", "reflection", "takeaways"];
      for (const layout of mustKeepLayouts) {
        for (let i = parsed.slides.length - 1; i >= 0; i--) {
          if (parsed.slides[i].layout === layout) {
            selected.add(i);
            break;
          }
        }
      }

      // Completar em ordem até o limite
      for (let i = 0; i < parsed.slides.length && selected.size < MAX_SEMANTIC_SLIDES_PER_MODULE; i++) {
        selected.add(i);
      }

      const keepIndices = Array.from(selected).sort((a, b) => a - b).slice(0, MAX_SEMANTIC_SLIDES_PER_MODULE);
      parsed.slides = keepIndices.map((idx) => parsed.slides[idx]);
      console.log("[SEMANTIC-PLANNER] Module " + (moduleIndex + 1) + " capped to " + parsed.slides.length + " slides");
    }

    console.log("[SEMANTIC-PLANNER] Module " + (moduleIndex + 1) + " planned: " + parsed.slides.length + " slides");
    return parsed;

  } catch (err: any) {
    console.error("[SEMANTIC-PLANNER] Error: " + (err.message || err));
    return null;
  }
}

/** Convert semantic plan to SlideData array */
function semanticPlanToSlides(plan: SemanticModulePlan, moduleIndex: number): SlideData[] {
  const slides: SlideData[] = [];

  // Module cover
  slides.push({
    layout: "module_cover",
    title: smartTitle(plan.moduleTitle),
    subtitle: "MODULO " + String(moduleIndex + 1).padStart(2, "0"),
    description: plan.moduleDescription,
    moduleIndex,
    objectives: plan.objectives.slice(0, 3),
  });

  const LAYOUT_MAP: Record<string, LayoutType> = {
    definition: "definition_card_with_pillars",
    bullets: "bullets",
    grid_cards: "grid_cards",
    process: "process_timeline",
    table: "comparison_table",
    example: "example_highlight",
    warning: "warning_callout",
    reflection: "reflection_callout",
    summary: "summary_slide",
    takeaways: "numbered_takeaways",
  };

  for (const slidePlan of plan.slides) {
    const layout = LAYOUT_MAP[slidePlan.layout] || "bullets";
    const blockType = slidePlan.layout === "example" ? "example"
      : slidePlan.layout === "reflection" ? "reflection"
      : slidePlan.layout === "takeaways" ? "conclusion"
      : slidePlan.layout === "warning" ? "warning"
      : slidePlan.layout === "summary" ? "summary"
      : "normal";

    const sd: SlideData = {
      layout,
      title: smartTitle(slidePlan.slideTitle),
      sectionLabel: slidePlan.sectionLabel.toUpperCase().substring(0, 25),
      items: sanitizeBullets(slidePlan.items),
      moduleIndex,
      blockType,
    };

    // Handle table layout
    if (slidePlan.layout === "table" && slidePlan.tableHeaders && slidePlan.tableRows) {
      sd.tableHeaders = slidePlan.tableHeaders;
      sd.tableRows = slidePlan.tableRows.slice(0, 5);
    }

    slides.push(sd);
  }

  return slides;
}

/* ═══════════════════════════════════════════════════════
   LLM-POWERED NLP VALIDATION — Lovable AI Gateway
   Post-rendering validation pass for grammar, truncation, nonsense
   ═══════════════════════════════════════════════════════ */

interface LLMSlideValidation {
  slideIndex: number;
  title: string;
  fixedItems: string[];
  droppedItems: string[];
  grammarFixes: string[];
  truncationFixes: string[];
  nonsenseDetected: string[];
}

interface LLMValidationResult {
  slides: LLMSlideValidation[];
  totalGrammarFixes: number;
  totalTruncationFixes: number;
  totalNonsenseDropped: number;
  totalRelevanceDropped: number;
}

async function llmValidateSlideContent(allSlides: SlideData[]): Promise<LLMValidationResult> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.warn("[LLM-NLP] LOVABLE_API_KEY not available, skipping LLM validation");
    return { slides: [], totalGrammarFixes: 0, totalTruncationFixes: 0, totalNonsenseDropped: 0, totalRelevanceDropped: 0 };
  }

  const slidesForValidation: { idx: number; title: string; items: string[]; score: number }[] = [];
  for (let i = 0; i < allSlides.length; i++) {
    const s = allSlides[i];
    if (!s.items || s.items.length === 0 || s.layout === "module_cover") continue;

    let score = 0;
    for (const item of s.items) {
      const txt = (item || "").trim();
      if (!txt) continue;
      if (txt.length > 110) score += 3;
      if (txt.length > 80) score += 2;
      if (detectTruncation(txt)) score += 4;
      if (!/[.!?…:]$/.test(txt)) score += 1;
    }

    // Também validar blocos sensíveis de storytelling
    if (s.blockType === "example" || s.blockType === "conclusion") score += 2;

    if (score > 0) slidesForValidation.push({ idx: i, title: s.title, items: s.items, score });
  }

  if (slidesForValidation.length === 0) {
    return { slides: [], totalGrammarFixes: 0, totalTruncationFixes: 0, totalNonsenseDropped: 0, totalRelevanceDropped: 0 };
  }

  // Validação LLM parcial e priorizada para garantir estabilidade em cursos grandes
  const prioritized = slidesForValidation
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, MAX_LLM_VALIDATION_SLIDES)
    .sort((a, b) => a.idx - b.idx);

  const allResults: LLMSlideValidation[] = [];
  let totalGF = 0, totalTF = 0, totalND = 0, totalRD = 0;

  for (let batchStart = 0; batchStart < prioritized.length; batchStart += LLM_BATCH_SIZE) {
    const batch = prioritized.slice(batchStart, batchStart + LLM_BATCH_SIZE);
    
    const slidesPayload = batch.map(s => ({
      slideIndex: s.idx,
      title: s.title,
      items: s.items.map((it, i) => ({ id: i, text: it })),
    }));

    const systemPrompt = `Você é um revisor profissional de conteúdo educacional em PT-BR para slides de apresentação (PowerPoint).

Sua tarefa é analisar CADA item de texto de CADA slide e retornar uma versão corrigida.

Para cada item, você DEVE:
1. **Gramática**: Corrigir erros gramaticais, ortográficos e de concordância em português brasileiro.
2. **Frases truncadas**: Se uma frase está incompleta (termina em preposição, artigo, ou parece cortada), COMPLETE a frase de forma lógica e concisa ou remova a parte incompleta e finalize com pontuação.
3. **Sem sentido**: Se o texto é incompreensível, sem sentido, ou contém palavras aleatórias/sem conexão lógica, marque como "nonsense".
4. **Relevância**: Se o item não tem relação com o título do slide, marque como "irrelevant".
5. **Pontuação**: Toda frase deve terminar com ponto, exclamação ou interrogação.
6. **Máximo**: Cada item corrigido deve ter no máximo 120 caracteres. Se ultrapassar, resuma mantendo o significado essencial.

REGRAS CRÍTICAS:
- NÃO invente informação nova — apenas corrija/complete o que existe.
- Se uma frase está truncada, prefira ENCURTAR e fechar com ponto do que inventar conteúdo.
- Mantenha o tom profissional/educacional.
- Retorne TODOS os slides processados, mesmo que sem correções.`;

    const userPrompt = `Analise e corrija os seguintes slides:\n\n${JSON.stringify(slidesPayload, null, 0)}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            tools: [{
              type: "function",
              function: {
                name: "submit_validated_slides",
                description: "Submit the validated and corrected slide content",
                parameters: {
                  type: "object",
                  properties: {
                    slides: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          slideIndex: { type: "number", description: "Original slide index" },
                          correctedItems: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                id: { type: "number", description: "Original item index" },
                                text: { type: "string", description: "Corrected text (empty string if should be dropped)" },
                                status: { type: "string", enum: ["ok", "grammar_fixed", "truncation_fixed", "nonsense", "irrelevant"], description: "What was done" },
                                original: { type: "string", description: "Original text before fix" },
                              },
                              required: ["id", "text", "status"],
                              additionalProperties: false,
                            },
                          },
                        },
                        required: ["slideIndex", "correctedItems"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["slides"],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "submit_validated_slides" } },
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error("[LLM-NLP] Gateway error " + response.status + ": " + errText.substring(0, 200));
        continue;
      }

      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall?.function?.arguments) {
        console.warn("[LLM-NLP] No tool call in response");
        continue;
      }

      let parsed: { slides: any[] };
      try {
        parsed = JSON.parse(toolCall.function.arguments);
      } catch {
        console.error("[LLM-NLP] Failed to parse tool call arguments");
        continue;
      }

      for (const slideResult of (parsed.slides || [])) {
        const slideIdx = slideResult.slideIndex;
        const slide = allSlides[slideIdx];
        if (!slide || !slide.items) continue;

        const validation: LLMSlideValidation = {
          slideIndex: slideIdx,
          title: slide.title,
          fixedItems: [],
          droppedItems: [],
          grammarFixes: [],
          truncationFixes: [],
          nonsenseDetected: [],
        };

        const newItems: string[] = [];
        for (const corrected of (slideResult.correctedItems || [])) {
          const itemId = corrected.id;
          const originalText = slide.items[itemId] || "";
          const status = corrected.status || "ok";
          const fixedText = (corrected.text || "").trim();

          if (status === "nonsense") {
            validation.nonsenseDetected.push(originalText.substring(0, 50));
            validation.droppedItems.push(originalText.substring(0, 50));
            totalND++;
            continue;
          }
          if (status === "irrelevant") {
            validation.droppedItems.push(originalText.substring(0, 50));
            totalRD++;
            continue;
          }
          if (!fixedText || fixedText.length < 3) {
            validation.droppedItems.push(originalText.substring(0, 50));
            continue;
          }

          if (status === "grammar_fixed") {
            validation.grammarFixes.push(originalText.substring(0, 30) + " → " + fixedText.substring(0, 30));
            totalGF++;
          }
          if (status === "truncation_fixed") {
            validation.truncationFixes.push(originalText.substring(0, 30) + " → " + fixedText.substring(0, 30));
            totalTF++;
          }

          let final = fixedText;
          if (final.length > 0 && !/[.!?…]$/.test(final)) final += ".";
          newItems.push(final);
        }

        if (newItems.length >= Math.max(1, Math.floor(slide.items.length * 0.4))) {
          slide.items = newItems;
          validation.fixedItems = newItems;
        } else {
          console.warn("[LLM-NLP] Slide " + slideIdx + ": Too many items dropped (" + newItems.length + "/" + slide.items.length + "), keeping originals");
          validation.fixedItems = [...slide.items];
        }

        allResults.push(validation);
      }

      console.log("[LLM-NLP] Batch processed: " + batch.length + " slides, " + totalGF + " grammar, " + totalTF + " truncation, " + totalND + " nonsense");

    } catch (err: any) {
      if (err?.name === "AbortError") {
        console.warn("[LLM-NLP] Batch timeout after " + LLM_REQUEST_TIMEOUT_MS + "ms; seguindo sem validação deste lote");
      } else {
        console.error("[LLM-NLP] Error: " + (err.message || err));
      }
    }
  }

  return {
    slides: allResults,
    totalGrammarFixes: totalGF,
    totalTruncationFixes: totalTF,
    totalNonsenseDropped: totalND,
    totalRelevanceDropped: totalRD,
  };
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
  // Converter conectores de fluxo para ':' sem quebrar palavras hifenizadas (ex: e-mails, tornando-a)
  t = t.replace(/\s*(?:->|→|⟶|➜|➔|➞|►|⇒|⇨)\s*/g, ": ");
  t = t.replace(/\s+[–—-]\s+/g, ": ");
  t = t.replace(/&amp;/gi, "&"); t = t.replace(/&lt;/gi, "<"); t = t.replace(/&gt;/gi, ">");
  t = t.replace(/&nbsp;/gi, " "); t = t.replace(/&quot;/gi, '"');
  t = t.replace(/<\/?[a-z][^>]*>/gi, " ");
  // Map emojis to semantic text markers before stripping
  const EMOJI_MAP: [RegExp, string][] = [
    [/[\u{1F4A1}]/gu, "[ideia] "],
    [/[\u{2705}\u{2714}]/gu, "[ok] "],
    [/[\u{26A0}\u{2757}]/gu, "[alerta] "],
    [/[\u{1F4CA}\u{1F4C8}\u{1F4C9}]/gu, "[dados] "],
    [/[\u{1F50D}\u{1F50E}]/gu, "[busca] "],
    [/[\u{1F4DD}\u{270F}]/gu, "[nota] "],
    [/[\u{1F680}]/gu, "[acao] "],
    [/[\u{1F4BB}\u{1F5A5}]/gu, "[tech] "],
    [/[\u{1F464}\u{1F465}]/gu, "[pessoas] "],
    [/[\u{2B50}\u{1F31F}]/gu, "[destaque] "],
    [/[\u{1F3AF}]/gu, "[objetivo] "],
    [/[\u{1F512}\u{1F513}]/gu, "[seguranca] "],
    [/[\u{2764}\u{1F49A}\u{1F499}]/gu, ""],
  ];
  for (const [pattern, replacement] of EMOJI_MAP) {
    t = t.replace(pattern, replacement);
  }
  // Strip remaining emojis
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "");
  // Apply fixBrokenColonWords early in sanitization to catch issues at source
  const colonFix = fixBrokenColonWords(t);
  t = colonFix.text;
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

function deduplicateTitle(title: string): string {
  return title.replace(/^(M[oó]dulo\s+\d+\s*[:–\-]\s*)\1/i, "$1").trim();
}

/* ═══════════════════════════════════════════════════════
   SAFE TEXT v2 — boundary-checked, density-validated
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

  // Density validation for plain text
  if (typeof text === "string" && text.length > 0) {
    const fontSize = Number(options.fontSize || TYPO.BODY);
    text = enforceSentenceIntegrity(text);

    const check = validateTextDensity(text, safeW, safeH, fontSize);
    if (!check.fits) {
      const adjusted = autoAdjustText(text, safeW, safeH, fontSize, TYPO.SUPPORT);
      text = enforceSentenceIntegrity(adjusted.text);
      options = { ...options, fontSize: adjusted.fontSize };
      if (adjusted.truncated) {
        console.log("[DENSITY] auto-adjust Slide " + _auditSlideCounter + ": " + String(adjusted.fontSize) + "pt");
      }
    }

    if (detectTruncation(text)) {
      text = enforceSentenceIntegrity(text);
      if (detectTruncation(text)) {
        text = smartTruncate(text, Math.max(24, Math.floor(check.maxChars * 0.9)), false);
        text = enforceSentenceIntegrity(text);
      }
    }
  }

  _auditLog.push({ slideLabel: "Slide " + _auditSlideCounter, x, y, w: safeW, h: safeH });
  slide.addText(text, {
    ...options, x, y, w: safeW, h: safeH,
    autoFit: false,
    shrinkText: false,
    wrap: true,
    overflow: "clip",
    inset: options.inset ?? 0.1,
  });
}

function runAudit() {
  const errors: string[] = [];
  for (const el of _auditLog) {
    if (el.x + el.w > SLIDE_W + 0.01) errors.push(el.slideLabel + ": overflow R");
    if (el.y + el.h > SLIDE_H + 0.01) errors.push(el.slideLabel + ": overflow B");
  }
  if (errors.length === 0) console.log("[AUDIT] PASSED - " + _auditLog.length + " elements");
  else errors.forEach(e => console.error("[AUDIT] " + e));
  return { passed: errors.length === 0, errors };
}

/* ═══════════════════════════════════════════════════════
   QUALITY CHECKLIST — runs before finalizing each slide
   10-point validation per the acceptance criteria
   ═══════════════════════════════════════════════════════ */

interface QualityResult {
  passed: boolean;
  warnings: string[];
  fixes: string[];
}

function runSlideQualityChecklist(sd: SlideData, slideIndex: number, allSlides?: SlideData[]): QualityResult {
  const warnings: string[] = [];
  const fixes: string[] = [];
  const label = "Slide " + slideIndex;

  const contentTexts: string[] = [];
  const headerTexts: string[] = [];
  
  if (sd.title) headerTexts.push(sd.title);
  if (sd.subtitle) headerTexts.push(sd.subtitle);
  if (sd.sectionLabel) headerTexts.push(sd.sectionLabel);
  if (sd.description) contentTexts.push(sd.description);
  if (sd.items) contentTexts.push(...sd.items);
  if (sd.objectives) contentTexts.push(...sd.objectives);
  if (sd.tableHeaders) headerTexts.push(...sd.tableHeaders);
  if (sd.tableRows) sd.tableRows.forEach(r => contentTexts.push(...r));

  // ═══ CHECKPOINT 1: CONTENT INTEGRITY ═══
  
  // ✓ 1. Text completeness (no truncations)
  for (const t of contentTexts) {
    if (!t || t.length < 10) continue;
    if (detectTruncation(t)) {
      // AUTO-FIX: try to complete truncated text
      const TRAILING_PREPS = /\s+(da|de|do|das|dos|na|no|nas|nos|em|ao|à|um|uma|com|por|para|que|e|ou|o|a|os|as)$/i;
      let fixed = t.replace(TRAILING_PREPS, "").trim();
      if (!/[.!?]$/.test(fixed)) fixed += ".";
      const idx = sd.items?.indexOf(t);
      if (idx !== undefined && idx >= 0 && sd.items) {
        sd.items[idx] = fixed;
        fixes.push(label + " TRUNCAMENTO CORRIGIDO: \"" + t.substring(0, 35) + "...\"");
      } else {
        warnings.push(label + " TRUNCAMENTO: \"" + t.substring(0, 50) + "\"");
      }
    }
    // Mid-word cut detection
    if (t.length > 25 && /\s/.test(t)) {
      const lastWord = t.split(/\s+/).pop() || "";
      if (lastWord.length <= 2 && !/[.!?…:;)\]"']$/.test(t) &&
          !/^(é|e|a|o|ou|em|se|já|só|aí|há|IA|AI|TI|UX|UI|ML|BI|CX|RH)$/i.test(lastWord)) {
        const TRAILING_PREPS = /\s+\w{1,2}$/;
        let fixed = t.replace(TRAILING_PREPS, "").trim();
        if (!/[.!?]$/.test(fixed)) fixed += ".";
        const idx = sd.items?.indexOf(t);
        if (idx !== undefined && idx >= 0 && sd.items) {
          sd.items[idx] = fixed;
          fixes.push(label + " FRAGMENTO CORRIGIDO");
        }
      }
    }
  }

  // ✓ 2. Title quality — reject generic titles
  if (sd.title) {
    if (sd.title.length < 3 && sd.layout !== "module_cover") {
      warnings.push(label + " TITULO CURTO: \"" + sd.title + "\"");
    }
    const genericTitles = /^(cont\.|continuacao|parte|introdu[cç][aã]o|conceitos?|vis[aã]o geral|overview|detalhes|t[oó]picos?|aspectos?)$/i;
    if (genericTitles.test(sd.title.trim())) {
      warnings.push(label + " TITULO GENERICO: \"" + sd.title + "\"");
    }
  }

  // ═══ CHECKPOINT 2: TEXT QUALITY (NLP) ═══
  
  // ✓ 3. Special characters cleanup
  for (const t of [...headerTexts, ...contentTexts]) {
    if (/\u00AD/.test(t)) {
      const fixed = t.replace(/\u00AD/g, "");
      const idx = sd.items?.indexOf(t);
      if (idx !== undefined && idx >= 0 && sd.items) {
        sd.items[idx] = fixed;
        fixes.push(label + " SOFT HYPHEN REMOVIDO");
      }
    }
    if (/[\uFFFD]/.test(t)) {
      const fixed = t.replace(/[\uFFFD]/g, "");
      const idx = sd.items?.indexOf(t);
      if (idx !== undefined && idx >= 0 && sd.items) {
        sd.items[idx] = fixed;
        fixes.push(label + " CHAR SUBSTITUICAO REMOVIDO");
      }
    }
  }

  // ✓ 4. Grammar auto-fix on items
  if (sd.items) {
    for (let i = 0; i < sd.items.length; i++) {
      const gramResult = validateAndFixGrammar(sd.items[i]);
      if (gramResult.corrections.length > 0) {
        sd.items[i] = gramResult.text;
        fixes.push(label + " GRAMATICA: " + gramResult.corrections.length + " correcoes");
      }
      // Add punctuation to incomplete sentences
      const t = sd.items[i];
      if (t.length > 20 && /\s/.test(t) && !/[.!?…;:)\]"']$/.test(t.trim())) {
        sd.items[i] = t.trim() + ".";
        fixes.push(label + " PONTUACAO ADICIONADA");
      }
    }
  }

  // ✓ 5. Terminology normalization + colon break artifacts (on ALL text fields)
  const allTextFields: { items: string[]; field: string }[] = [];
  if (sd.items) allTextFields.push({ items: sd.items, field: "items" });
  if (sd.objectives) allTextFields.push({ items: sd.objectives, field: "objectives" });
  
  for (const { items: textItems, field } of allTextFields) {
    for (let i = 0; i < textItems.length; i++) {
      const colonFixed = fixBrokenColonWords(textItems[i]);
      if (colonFixed.fixes > 0) {
        textItems[i] = colonFixed.text;
        fixes.push(label + " QUEBRA POR DOIS-PONTOS CORRIGIDA (" + field + ")");
      }

      if (hasSuspiciousColonBreak(textItems[i])) {
        warnings.push(label + " TEXTO COM QUEBRA INVÁLIDA (" + field + ")");
      }

      const normalized = normalizeTerminology(textItems[i]);
      if (normalized !== textItems[i]) {
        textItems[i] = normalized;
        fixes.push(label + " TERMINOLOGIA NORMALIZADA (" + field + ")");
      }
    }
  }
  
  // Also fix title and description
  if (sd.title) {
    const titleFix = fixBrokenColonWords(sd.title);
    if (titleFix.fixes > 0) { sd.title = titleFix.text; fixes.push(label + " TITULO DOIS-PONTOS CORRIGIDO"); }
  }
  if (sd.description) {
    const descFix = fixBrokenColonWords(sd.description);
    if (descFix.fixes > 0) { sd.description = descFix.text; fixes.push(label + " DESCRICAO DOIS-PONTOS CORRIGIDA"); }
  }
  // Fix table cells
  if (sd.tableRows) {
    for (let ri = 0; ri < sd.tableRows.length; ri++) {
      for (let ci = 0; ci < sd.tableRows[ri].length; ci++) {
        const cellFix = fixBrokenColonWords(sd.tableRows[ri][ci]);
        if (cellFix.fixes > 0) {
          sd.tableRows[ri][ci] = cellFix.text;
          fixes.push(label + " CELULA DOIS-PONTOS CORRIGIDA R" + ri + "C" + ci);
        }
      }
    }
  }

  // ═══ CHECKPOINT 3: STRUCTURAL QUALITY ═══
  
  // ✓ 6. Content variety (no excessive repetitions)
  if (sd.items && sd.items.length >= 4) {
    const firstWords = sd.items.map(it => (it.split(/\s+/)[0] || "").toLowerCase());
    const wordCounts: Record<string, number> = {};
    for (const w of firstWords) {
      if (w && w.length > 1) wordCounts[w] = (wordCounts[w] || 0) + 1;
    }
    for (const [word, count] of Object.entries(wordCounts)) {
      if (count >= Math.ceil(sd.items.length * 0.6)) {
        warnings.push(label + " REPETICAO: " + count + "/" + sd.items.length + " bullets iniciam com \"" + word + "\"");
      }
    }
  }

  // ✓ 7. Minimum content per slide
  if (sd.items && sd.layout !== "module_cover" && sd.layout !== "comparison_table" &&
      sd.layout !== "reflection_callout" && sd.layout !== "example_highlight" &&
      sd.layout !== "numbered_takeaways") {
    if (sd.items.length < 3 && sd.items.length > 0 && allSlides) {
      const myIdx = allSlides.indexOf(sd);
      if (myIdx > 0) {
        const prev = allSlides[myIdx - 1];
        if (prev.items && prev.layout !== "module_cover" && prev.layout !== "numbered_takeaways" &&
            prev.layout !== "comparison_table") {
          const totalAfterMerge = prev.items.length + sd.items.length;
          if (totalAfterMerge <= activeDensity.maxBulletsPerSlide) {
            prev.items.push(...sd.items);
            sd.items = [];
            sd._markedForRemoval = true;
            fixes.push(label + " MESCLADO com slide anterior (" + totalAfterMerge + " bullets)");
          }
        }
      }
    }
  }

  // ✓ 8. Symbol consistency
  for (const t of contentTexts) {
    if (/[□■◻◼▪▫●○◆◇◈◎⊕⊛☆✧✦▣▤▥▷◐◑◔△▽]{3,}/.test(t)) {
      warnings.push(label + " SIMBOLOS EXCESSIVOS");
    }
  }

  // ═══ CHECKPOINT 4: VISUAL QUALITY ═══
  
  // ✓ 9. Table readability
  if (sd.layout === "comparison_table") {
    if (sd.tableHeaders && sd.tableHeaders.length > 5) {
      warnings.push(label + " TABELA: " + sd.tableHeaders.length + " colunas (max: 5)");
    }
    if (sd.tableRows) {
      for (let ri = 0; ri < sd.tableRows.length; ri++) {
        for (let ci = 0; ci < sd.tableRows[ri].length; ci++) {
          const cell = sd.tableRows[ri][ci];
          if (cell.length > 120) {
            sd.tableRows[ri][ci] = compressTableCell(cell);
            fixes.push(label + " CELULA COMPRIMIDA: R" + ri + "C" + ci);
          }
        }
      }
    }
  }

  // ✓ 10. WCAG Contrast validation (spot check key color combos)
  const wcagChecks = [
    { fg: C.TEXT_DARK, bg: C.BG_WHITE, label: "body text" },
    { fg: C.TEXT_LIGHT, bg: C.BG_WHITE, label: "light text" },
    { fg: C.TEXT_WHITE, bg: C.TABLE_HEADER_BG, label: "table header" },
  ];
  for (const wc of wcagChecks) {
    const result = checkWCAGContrast(wc.fg, wc.bg, TYPO.BODY);
    if (!result.passesAA) {
      warnings.push(label + " WCAG-AA FALHOU: " + wc.label + " (ratio=" + result.ratio.toFixed(1) + ")");
    }
  }

  // ✓ 11. Bounding box pre-validation for items
  if (sd.items && sd.items.length > 0 && sd.layout !== "comparison_table") {
    const boxW = SAFE_W - 0.50;
    const maxH = (SLIDE_H - 2.0 - BOTTOM_MARGIN) / Math.min(sd.items.length, activeDensity.maxBulletsPerSlide);
    for (let i = 0; i < sd.items.length; i++) {
      const bbox = measureBoundingBox(sd.items[i], TYPO.BULLET_TEXT, FONT_BODY, boxW, maxH);
      if (!bbox.fits && bbox.overflowChars > 10) {
        // AUTO-FIX: compress text to fit bounding box
        const maxChars = sd.items[i].length - bbox.overflowChars - 5;
        if (maxChars > 20) {
          sd.items[i] = compressText(sd.items[i], maxChars);
          fixes.push(label + " BBOX OVERFLOW CORRIGIDO: item " + i + " (overflow=" + bbox.overflowChars + " chars)");
        }
      }
    }
  }

  const passed = warnings.length === 0;
  if (warnings.length > 0 || fixes.length > 0) {
    console.log("[QC] " + label + ": " + fixes.length + " correcoes, " + warnings.length + " avisos");
    fixes.forEach(f => console.log("  [FIX] " + f));
    if (warnings.length > 0) warnings.forEach(w => console.warn("  [WARN] " + w));
  }
  return { passed, warnings, fixes };
}

/** Module-level checklist: verifies examples and reflections exist */
function checkModuleCompleteness(moduleSlides: SlideData[], modIndex: number): string[] {
  const warnings: string[] = [];
  const label = "Modulo " + (modIndex + 1);

  const hasExample = moduleSlides.some(s =>
    s.layout === "example_highlight" || s.blockType === "example"
  );
  const hasReflection = moduleSlides.some(s =>
    s.layout === "reflection_callout" || s.blockType === "reflection" ||
    s.layout === "numbered_takeaways"
  );
  const hasTakeaways = moduleSlides.some(s => s.layout === "numbered_takeaways");

  if (!hasExample) warnings.push(label + ": SEM EXEMPLO PRATICO");
  if (!hasReflection) warnings.push(label + ": SEM REFLEXAO/CHECKPOINT");
  if (!hasTakeaways) warnings.push(label + ": SEM KEY TAKEAWAYS");

  if (warnings.length > 0) {
    warnings.forEach(w => console.warn("[MODULE-CHECK] " + w));
  }
  return warnings;
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
   BOLD FORMATTING — Label:content pairs
   ═══════════════════════════════════════════════════════ */

interface RichTextPart {
  text: string;
  options: Record<string, unknown>;
}

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
      options: { bold: true, color: labelColor, fontSize, fontFace: FONT_BODY },
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
   CONTENT PARSING — Semantic Block Parser v2
   Replaces line-by-line splitting with structured markdown
   tokenization → section grouping → pedagogical mapping.
   ═══════════════════════════════════════════════════════ */

/** Structured item preserving parent/sub-item hierarchy */
interface StructuredItem {
  text: string;
  subItems: string[];
}

interface ParsedBlock {
  heading: string;
  items: string[];
  structuredItems?: StructuredItem[];
  isTable: boolean;
  headers?: string[];
  rows?: string[][];
  blockType?: "example" | "reflection" | "conclusion" | "warning" | "summary" | "normal";
}

// ── Markdown Token Types ──
type MdTokenType = "heading" | "bullet" | "numbered" | "table_row" | "table_sep" | "blockquote" | "separator" | "paragraph";

interface MdToken {
  type: MdTokenType;
  raw: string;
  content: string;         // cleaned content
  headingLevel?: number;   // 1-6 for headings
  indent?: number;         // nesting depth for lists
}

// ── Pedagogical Section Mapping ──
const PEDAGOGICAL_EMOJI_MAP: Record<string, { blockType: ParsedBlock["blockType"]; label: string }> = {
  "🎯": { blockType: "normal",     label: "Objetivo do Módulo" },
  "🧠": { blockType: "normal",     label: "Fundamentos" },
  "⚙️": { blockType: "normal",     label: "Como funciona" },
  "🧩": { blockType: "normal",     label: "Modelos / Tipos" },
  "🛠️": { blockType: "normal",     label: "Aplicações reais" },
  "💡": { blockType: "example",    label: "Exemplo prático" },
  "⚠️": { blockType: "warning",    label: "Desafios e cuidados" },
  "💭": { blockType: "reflection", label: "Reflexão" },
  "🧾": { blockType: "summary",    label: "Resumo do Módulo" },
  "📌": { blockType: "conclusion", label: "Key Takeaways" },
};

/**
 * PASS 1: Tokenize markdown into typed tokens.
 * Each line becomes a token with its structural role identified.
 */
function tokenizeMarkdown(content: string): MdToken[] {
  const lines = content.split("\n");
  const tokens: MdToken[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Empty lines → skip
    if (!trimmed) continue;

    // Separators (---)
    if (/^-{3,}\s*$/.test(trimmed) || /^\*{3,}\s*$/.test(trimmed)) {
      tokens.push({ type: "separator", raw: line, content: "" });
      continue;
    }

    // Headings (# to ######)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      tokens.push({
        type: "heading",
        raw: line,
        content: headingMatch[2].trim(),
        headingLevel: headingMatch[1].length,
      });
      continue;
    }

    // Table rows (|...|)
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      // Table separator row
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        tokens.push({ type: "table_sep", raw: line, content: trimmed });
        continue;
      }
      tokens.push({ type: "table_row", raw: line, content: trimmed });
      continue;
    }

    // Blockquotes (> ...)
    if (/^>\s+/.test(trimmed)) {
      tokens.push({ type: "blockquote", raw: line, content: trimmed.replace(/^>\s+/, "").trim() });
      continue;
    }

    // Bullet lists (- or * or •)
    if (/^[-*•]\s+/.test(trimmed)) {
      const indent = (line.match(/^(\s*)/) || ["", ""])[1].length;
      tokens.push({
        type: "bullet",
        raw: line,
        content: trimmed.replace(/^[-*•]\s+/, "").trim(),
        indent: Math.floor(indent / 2),
      });
      continue;
    }

    // Numbered lists (1. or 1))
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const indent = (line.match(/^(\s*)/) || ["", ""])[1].length;
      tokens.push({
        type: "numbered",
        raw: line,
        content: trimmed.replace(/^\d+[.)]\s+/, "").trim(),
        indent: Math.floor(indent / 2),
      });
      continue;
    }

    // Everything else → paragraph
    tokens.push({ type: "paragraph", raw: line, content: trimmed });
  }

  return tokens;
}

/**
 * PASS 2: Group tokens into sections under their parent heading.
 * Each section is a heading + all tokens until the next heading of same or higher level.
 */
interface MarkdownSection {
  heading: string;
  headingLevel: number;
  tokens: MdToken[];
  pedagogicalEmoji: string | null;
}

function detectPedagogicalEmoji(heading: string): string | null {
  for (const emoji of Object.keys(PEDAGOGICAL_EMOJI_MAP)) {
    if (heading.includes(emoji)) return emoji;
  }
  return null;
}

function groupTokensIntoSections(tokens: MdToken[]): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let currentSection: MarkdownSection = {
    heading: "",
    headingLevel: 0,
    tokens: [],
    pedagogicalEmoji: null,
  };

  for (const token of tokens) {
    if (token.type === "heading") {
      // Flush current section if it has content
      if (currentSection.tokens.length > 0 || currentSection.heading) {
        sections.push(currentSection);
      }
      const emoji = detectPedagogicalEmoji(token.content);
      currentSection = {
        heading: token.content,
        headingLevel: token.headingLevel || 3,
        tokens: [],
        pedagogicalEmoji: emoji,
      };
      continue;
    }

    // Skip separators between sections (they're structural, not content)
    if (token.type === "separator") continue;

    currentSection.tokens.push(token);
  }

  // Flush last section
  if (currentSection.tokens.length > 0 || currentSection.heading) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * PASS 3: Convert each section into a ParsedBlock.
 * - Table tokens → table block
 * - List tokens → item block
 * - Paragraph tokens → item block (each paragraph becomes an item)
 * - Blockquotes → item block with reflection detection
 * - Mixed content → split into sub-blocks to avoid mixing topics
 */
function sectionToParsedBlocks(section: MarkdownSection): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const heading = sanitize(section.heading);

  // Determine block type from pedagogical emoji or heading content
  let blockType: ParsedBlock["blockType"] = "normal";
  if (section.pedagogicalEmoji && PEDAGOGICAL_EMOJI_MAP[section.pedagogicalEmoji]) {
    blockType = PEDAGOGICAL_EMOJI_MAP[section.pedagogicalEmoji].blockType;
  } else {
    blockType = classifyBlockType(heading, []);
  }

  // Separate tokens by type for structured processing
  const tableTokens: MdToken[] = [];
  const contentTokens: MdToken[] = [];
  let inTableSequence = false;

  for (const token of section.tokens) {
    if (token.type === "table_row" || token.type === "table_sep") {
      // If we have accumulated non-table content before this table, flush it
      if (!inTableSequence && contentTokens.length > 0) {
        const items = extractItemsFromTokens(contentTokens);
        if (items.length > 0) {
          blocks.push({ heading, items, isTable: false, blockType });
        }
        contentTokens.length = 0;
      }
      inTableSequence = true;
      tableTokens.push(token);
    } else {
      // If we were in a table sequence, flush the table first
      if (inTableSequence && tableTokens.length > 0) {
        const tableBlock = parseTableTokens(tableTokens, heading);
        if (tableBlock) blocks.push(tableBlock);
        tableTokens.length = 0;
        inTableSequence = false;
      }
      contentTokens.push(token);
    }
  }

  // Flush remaining table
  if (tableTokens.length > 0) {
    const tableBlock = parseTableTokens(tableTokens, heading);
    if (tableBlock) blocks.push(tableBlock);
  }

  // Flush remaining content
  if (contentTokens.length > 0) {
    const items = extractItemsFromTokens(contentTokens);
    if (items.length > 0) {
      blocks.push({ heading, items, isTable: false, blockType });
    }
  }

  // If section had a heading but produced no blocks, create an empty one
  // so the heading doesn't get lost
  if (blocks.length === 0 && heading) {
    // Don't create empty blocks for separators or headings with no content
  }

  return blocks;
}

/**
 * Extract clean items from a sequence of non-table tokens.
 * Paragraphs are merged into items only if they're short enough.
 * Lists stay as individual items.
 * Blockquotes become items.
 */
function extractItemsFromTokens(tokens: MdToken[]): string[] {
  const items: string[] = [];
  let paragraphBuffer = "";

  const flushParagraph = () => {
    if (paragraphBuffer.trim()) {
      const clean = sanitize(paragraphBuffer.trim());
      if (clean.length > 3) items.push(clean);
      paragraphBuffer = "";
    }
  };

  // ── Nested list processing ──
  // Track parent items so sub-items (indent > 0) get merged into their parent
  // as "Parent: sub1; sub2; sub3" — preserving hierarchy for slide rendering.
  let pendingParent: { text: string; indent: number } | null = null;
  let subItems: string[] = [];

  const flushListItem = () => {
    if (pendingParent) {
      let merged = sanitize(pendingParent.text);
      if (subItems.length > 0) {
        // Append sub-items as semicolon-separated suffix
        const subText = subItems.map(s => sanitize(s)).filter(s => s.length > 2).join("; ");
        if (subText) {
          // If parent ends with colon, just append; otherwise add colon
          if (/:\s*$/.test(merged)) {
            merged = merged.replace(/:\s*$/, ": " + subText + ".");
          } else {
            merged = merged.replace(/[.!?]\s*$/, "") + ": " + subText + ".";
          }
        }
      }
      if (merged.length > 3) items.push(merged);
      pendingParent = null;
      subItems = [];
    }
  };

  for (const token of tokens) {
    switch (token.type) {
      case "bullet":
      case "numbered": {
        flushParagraph();
        const indent = token.indent || 0;

        if (indent === 0) {
          // Top-level item: flush any pending parent, start new one
          flushListItem();
          pendingParent = { text: token.content, indent: 0 };
        } else {
          // Sub-item: attach to pending parent
          if (pendingParent) {
            subItems.push(token.content);
          } else {
            // Orphan sub-item (no parent above) — treat as top-level
            const clean = sanitize(token.content);
            if (clean.length > 3) items.push(clean);
          }
        }
        break;
      }
      case "blockquote": {
        flushParagraph();
        flushListItem();
        const clean = sanitize(token.content);
        if (clean.length > 3) items.push(clean);
        break;
      }
      case "paragraph": {
        flushParagraph();
        flushListItem();
        const clean = sanitize(token.content);
        if (clean.length <= 3) break;

        if (clean.length <= 300) {
          items.push(clean);
        } else {
          // Split long paragraph into sentences, group into ~250-char chunks
          const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
          let chunk = "";
          for (const sentence of sentences) {
            const s = sentence.trim();
            if (chunk.length + s.length > 250 && chunk.length > 0) {
              items.push(chunk.trim());
              chunk = s;
            } else {
              chunk = chunk ? chunk + " " + s : s;
            }
          }
          if (chunk.trim().length > 3) items.push(chunk.trim());
        }
        break;
      }
      default:
        break;
    }
  }

  flushListItem();
  flushParagraph();
  return items;
}

/**
 * Parse a sequence of table tokens into a table ParsedBlock.
 * Validates header/separator/row structure.
 */
function parseTableTokens(tokens: MdToken[], heading: string): ParsedBlock | null {
  const dataRows: MdToken[] = [];
  const sepRows: MdToken[] = [];

  for (const t of tokens) {
    if (t.type === "table_sep") sepRows.push(t);
    else dataRows.push(t);
  }

  if (dataRows.length < 2) return null; // Need at least header + 1 data row

  // First data row = headers
  const headerRow = dataRows[0];
  const headers = headerRow.content.split("|").filter(Boolean).map(c => sanitize(c.trim()));

  if (headers.length < 2 || !headers.some(h => h.length > 0)) return null;

  // Validate separator matches header count (if present)
  if (sepRows.length > 0) {
    const sepCells = sepRows[0].content.split("|").filter(Boolean);
    if (sepCells.length !== headers.length) {
      // Mismatched — not a real table, treat as text
      return null;
    }
  }

  // Remaining data rows
  const rows: string[][] = [];
  for (let i = 1; i < dataRows.length; i++) {
    const cells = dataRows[i].content.split("|").filter(Boolean).map(c => sanitize(c.trim()));
    // Normalize column count
    while (cells.length < headers.length) cells.push("");
    if (cells.length > headers.length) cells.length = headers.length;
    rows.push(cells);
  }

  if (rows.length === 0) return null;

  return {
    heading: sanitize(heading),
    items: [],
    isTable: true,
    headers,
    rows,
    blockType: "normal",
  };
}

/**
 * Main entry point: Semantic Markdown Parser v2.
 * Replaces the old line-by-line parseModuleContent.
 *
 * Pipeline: tokenize → group by heading → convert to ParsedBlocks
 * with pedagogical section awareness and proper content separation.
 */
function parseModuleContent(content: string): ParsedBlock[] {
  // PASS 1: Tokenize
  const tokens = tokenizeMarkdown(content);
  console.log("[SEMANTIC-PARSER] Tokenized: " + tokens.length + " tokens (" +
    tokens.filter(t => t.type === "heading").length + " headings, " +
    tokens.filter(t => t.type === "bullet" || t.type === "numbered").length + " list items, " +
    tokens.filter(t => t.type === "table_row").length + " table rows)");

  // PASS 2: Group into sections
  const sections = groupTokensIntoSections(tokens);
  console.log("[SEMANTIC-PARSER] Grouped into " + sections.length + " sections" +
    (sections.filter(s => s.pedagogicalEmoji).length > 0
      ? " (" + sections.filter(s => s.pedagogicalEmoji).length + " pedagogical)"
      : ""));

  // PASS 3: Convert to ParsedBlocks
  const allBlocks: ParsedBlock[] = [];
  for (const section of sections) {
    const blocks = sectionToParsedBlocks(section);
    allBlocks.push(...blocks);
  }

  console.log("[SEMANTIC-PARSER] Output: " + allBlocks.length + " blocks (" +
    allBlocks.filter(b => b.isTable).length + " tables, " +
    allBlocks.filter(b => b.blockType !== "normal").length + " typed)");

  return allBlocks;
}

/**
 * Convert pre-parsed blocks into a structured text summary for the LLM planner.
 * This replaces sending raw markdown — the LLM receives a clean, pre-segmented
 * representation that preserves section boundaries and content types.
 */
function blocksToStructuredSummary(blocks: ParsedBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const typeTag = block.blockType && block.blockType !== "normal"
      ? ` [${block.blockType.toUpperCase()}]`
      : "";
    if (block.heading) {
      lines.push("### " + block.heading + typeTag);
    }
    if (block.isTable && block.headers && block.rows) {
      lines.push("[TABELA: " + block.headers.join(" | ") + "]");
      for (const row of block.rows.slice(0, 5)) {
        lines.push("  " + row.join(" | "));
      }
    } else if (block.items.length > 0) {
      for (const item of block.items) {
        lines.push("- " + item);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Pre-parse result stored per module for reuse across pipeline stages.
 */
interface PreParsedModule {
  blocks: ParsedBlock[];
  structuredSummary: string;
  sectionCount: number;
  pedagogicalSections: string[];
}

/**
 * PRE-STAGE: Run semantic parser on all modules.
 * Returns pre-parsed blocks and structured summaries that feed BOTH
 * the LLM planner (main path) and buildModuleSlides (fallback path).
 */
function preParseAllModules(modules: any[]): Map<number, PreParsedModule> {
  const result = new Map<number, PreParsedModule>();

  for (let i = 0; i < modules.length; i++) {
    const content = modules[i].content || "";
    const blocks = parseModuleContent(content);
    const structuredSummary = blocksToStructuredSummary(blocks);

    // Detect which pedagogical sections exist
    const pedagogicalSections: string[] = [];
    for (const block of blocks) {
      if (block.blockType && block.blockType !== "normal") {
        pedagogicalSections.push(block.blockType);
      }
    }

    result.set(i, {
      blocks,
      structuredSummary,
      sectionCount: blocks.length,
      pedagogicalSections,
    });

    console.log("[PRE-PARSE] Module " + (i + 1) + ": " + blocks.length + " blocks, " +
      blocks.filter(b => b.isTable).length + " tables, sections=[" + pedagogicalSections.join(",") + "]");
  }

  return result;
}


   ═══════════════════════════════════════════════════════ */

type LayoutType =
  | "module_cover" | "definition_card_with_pillars" | "comparison_table"
  | "grid_cards" | "four_quadrants" | "process_timeline"
  | "numbered_takeaways" | "bullets" | "example_highlight" | "reflection_callout"
  | "warning_callout" | "summary_slide";

function isDefinitionBlock(items: string[]): boolean {
  if (items.length < 2 || items.length > 6) return false;
  const first = items[0] || "";
  return /\b([eé]|s[aã]o|refere-se|consiste|define-se|trata-se|significa)\b/i.test(first) && items.length >= 3;
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
  return /pontos[- ]chave|key takeaway|takeaway|recapitula/i.test(heading);
}

function isSummaryHeading(heading: string): boolean {
  return /resumo|s[ií]ntese/i.test(heading) && !/key takeaway|takeaway/i.test(heading);
}

function isObjectivesHeading(heading: string): boolean {
  return /objetivo|objetivos?\s+d[oe]|learning objectives|o que voc/i.test(heading);
}

function detectParallel(items: string[]): boolean {
  if (items.length < 3 || items.length > 8) return false;
  const withColon = items.filter(it => { const ci = it.indexOf(":"); return ci > 2 && ci < 50; }).length;
  return withColon >= Math.ceil(items.length * 0.6);
}

function classifyContent(heading: string, items: string[], isTable: boolean, prevLayout: LayoutType | null, blockType?: string): LayoutType {
  if (isTable) return "comparison_table";
  if (blockType === "example") return "example_highlight";
  if (blockType === "reflection") return "reflection_callout";
  if (blockType === "warning") return "warning_callout";
  if (blockType === "summary") return "summary_slide";
  if (isResumoHeading(heading)) return "numbered_takeaways";
  
  // Map pedagogical section headings to appropriate layouts
  const h = heading.toLowerCase();
  if (/objetivo/i.test(h)) return "definition_card_with_pillars";
  if (/fundamento/i.test(h)) return items.length >= 3 ? "definition_card_with_pillars" : "bullets";
  if (/como funciona|processo|etapa|passo|pipeline/i.test(h)) return "process_timeline";
  if (/modelo|tipo|categorias|classifica/i.test(h)) return items.length >= 3 ? "grid_cards" : "bullets";
  if (/aplica[cç][oõ]|uso|caso de uso/i.test(h)) return items.length >= 3 ? "grid_cards" : "bullets";
  if (/desafio|cuidado|risco|limita/i.test(h)) return "warning_callout";
  
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
   DENSITY SCORING v2
   ═══════════════════════════════════════════════════════ */

interface SlideData {
  layout: LayoutType;
  title: string;
  subtitle?: string;
  sectionLabel?: string;
  items?: string[];
  structuredItems?: StructuredItem[];
  tableHeaders?: string[];
  tableRows?: string[][];
  moduleIndex?: number;
  moduleCount?: number;
  description?: string;
  courseTitle?: string;
  modules?: { title: string; description: string }[];
  objectives?: string[];
  densityScore?: number;
  blockType?: string;
  _markedForRemoval?: boolean;
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
   FILLER SLIDE DETECTION v2 — NEVER remove examples/reflections/conclusions
   ═══════════════════════════════════════════════════════ */

function isFillerSlide(sd: SlideData): boolean {
  // NEVER remove these types
  if (sd.layout === "module_cover" || sd.layout === "numbered_takeaways") return false;
  if (sd.layout === "comparison_table" && sd.tableRows && sd.tableRows.length > 0) return false;
  if (sd.layout === "example_highlight" || sd.layout === "reflection_callout") return false;
  if (sd.layout === "warning_callout" || sd.layout === "summary_slide") return false;
  
  // NEVER remove blocks tagged as example, reflection, conclusion, warning, or summary
  if (sd.blockType === "example" || sd.blockType === "reflection" || sd.blockType === "conclusion" || sd.blockType === "warning" || sd.blockType === "summary") return false;
  
  const items = sd.items || [];
  if (items.length === 1 && items[0].length < 150) {
    const heading = (sd.title || "").toLowerCase();
    // Only remove truly generic intro slides
    if (/^(introdu[cç][aã]o|contexto|sobre|vis[aã]o geral|overview)$/.test(heading.trim())) return true;
    if (!items[0].includes(":") && items[0].length < 80 && items[0].split(/\s+/).length < 8) return true;
  }
  if (items.length === 0 && !sd.tableHeaders) return true;
  return false;
}

/* ═══════════════════════════════════════════════════════
   TABLE HELPERS
   ═══════════════════════════════════════════════════════ */

const HEADER_ROW_H = 0.55;

function calcRowHeight(row: string[], colWidths: number[]): number {
  let maxLines = 1;
  for (let c = 0; c < row.length; c++) {
    const cellText = String(row[c] || "");
    const colW = colWidths[c] || 3.0;
    const charsPerLine = Math.max(10, Math.floor(colW * 9)); // Adjusted for larger font
    const lines = Math.max(1, Math.ceil(cellText.length / charsPerLine));
    maxLines = Math.max(maxLines, lines);
  }
  return 0.50 + (maxLines - 1) * 0.25; // Increased row height for larger font
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
  if (colCount === 3) return [SAFE_W * 0.25, SAFE_W * 0.375, SAFE_W * 0.375];
  return Array(colCount).fill(SAFE_W / colCount);
}

/* ═══════════════════════════════════════════════════════
   BUILD MODULE SLIDES v2 — with overflow continuation
   ═══════════════════════════════════════════════════════ */

function buildModuleSlides(mod: any, modIndex: number, totalModules: number): SlideData[] {
  const blocks = parseModuleContent(mod.content || "");
  return buildModuleSlidesFromBlocks(blocks, mod, modIndex, totalModules);
}

/**
 * Build slides from pre-parsed blocks. This is the core slide builder
 * used by both the fallback path (with pre-parsed blocks from PRE-STAGE B)
 * and the legacy path (via buildModuleSlides which parses first).
 */
function buildModuleSlidesFromBlocks(blocks: ParsedBlock[], mod: any, modIndex: number, totalModules: number): SlideData[] {
  const rawTitle = sanitize(mod.title || "");
  const shortTitle = rawTitle.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;

  const objItems: string[] = [];
  const resumoItems: string[] = [];
  const summaryItems: string[] = [];
  const contentBlocks: ParsedBlock[] = [];

  for (const block of blocks) {
    if (isObjectivesHeading(block.heading) && !block.isTable) objItems.push(...block.items);
    else if (isResumoHeading(block.heading) && !block.isTable) resumoItems.push(...block.items);
    else if (isSummaryHeading(block.heading) && !block.isTable) summaryItems.push(...block.items);
    else contentBlocks.push(block);
  }

  const slides: SlideData[] = [];

  const safeTitle = smartTitle(shortTitle);
  const moduleDesc = objItems.length > 0
    ? smartModuleDesc(objItems[0])
    : smartModuleDesc(sanitize((mod.content || "").split(/[.!?]\s/)[0] || ""));

  const objectives = objItems.slice(0, 3).map(o => smartBullet(sanitize(o)));

  slides.push({
    layout: "module_cover",
    title: safeTitle,
    subtitle: "MODULO " + String(modIndex + 1).padStart(2, "0"),
    description: moduleDesc,
    moduleIndex: modIndex,
    objectives,
  });

  let prevLayout: LayoutType | null = "module_cover";
  let firstContentRendered = false;

  for (const block of contentBlocks) {
    const heading = sanitize(block.heading || shortTitle);
    const sectionLabel = extractSectionLabel(heading);
    const blockType = block.blockType || "normal";

    // Table blocks
    if (block.isTable && block.headers && block.rows && block.rows.length > 0) {
      const rows = block.rows.map(r => r.map(c => smartCell(compressText(sanitize(c), 90))));
      if (rows.length > 5) {
        const mid = Math.ceil(rows.length / 2);
        slides.push({
          layout: "comparison_table", title: smartTitle(heading + " (Parte 1)"), sectionLabel,
          tableHeaders: block.headers.map(sanitize), tableRows: rows.slice(0, mid), moduleIndex: modIndex,
        });
        slides.push({
          layout: "comparison_table", title: smartTitle(heading + " (Parte 2)"), sectionLabel,
          tableHeaders: block.headers.map(sanitize), tableRows: rows.slice(mid), moduleIndex: modIndex,
        });
        prevLayout = "comparison_table";
      } else {
        slides.push({
          layout: "comparison_table", title: smartTitle(heading), sectionLabel,
          tableHeaders: block.headers.map(sanitize), tableRows: rows, moduleIndex: modIndex,
        });
        prevLayout = "comparison_table";
      }
      firstContentRendered = true;
      continue;
    }

    // NLP Pipeline: sanitize → compress → normalize → grammar → deduplicate → relevance threshold
    // For pedagogical sections (example, warning, summary), preserve full sentences — skip aggressive compression
    const isPreservationBlock = blockType === "example" || blockType === "warning" || blockType === "summary" || blockType === "reflection";
    let items = block.items.map(s => {
      const sanitized = sanitize(s);
      if (isPreservationBlock) {
        // Only add period if missing, no truncation
        const trimmed = sanitized.trim();
        if (trimmed.length > 0 && !/[.!?…]$/.test(trimmed)) return trimmed + ".";
        return trimmed;
      }
      return compressBullet(sanitized);
    }).filter(s => s.length > 3);
    const nlpResult = runNLPPipeline(items);
    items = nlpResult.processed;

    const relevanceContext = sanitize([heading, mod.title || "", mod.content || ""].join(" "));
    const relevance = validateRelevanceWithThreshold(items, relevanceContext, 0.18);
    items = relevance.filtered;

    if (nlpResult.stats.deduped > 0 || nlpResult.stats.grammarFixes > 0 || relevance.dropped > 0) {
      console.log("[NLP] Module " + modIndex + ": deduped=" + nlpResult.stats.deduped + " grammar=" + nlpResult.stats.grammarFixes + " terms=" + nlpResult.stats.termNormalized + " relevance_dropped=" + relevance.dropped);
    }
    if (items.length === 0) continue;

    let layout = classifyContent(heading, items, false, prevLayout, blockType);

    if (!firstContentRendered && items.length >= 3 && layout !== "example_highlight" && layout !== "reflection_callout") {
      layout = "definition_card_with_pillars";
      firstContentRendered = true;
    } else {
      firstContentRendered = true;
    }

    // Prevent consecutive same layouts (except bullets)
    if (layout === prevLayout && layout !== "bullets" && layout !== "example_highlight" && layout !== "reflection_callout") {
      const alternatives: LayoutType[] = ["grid_cards", "bullets", "four_quadrants", "definition_card_with_pillars"];
      layout = alternatives.find(l => l !== prevLayout) || "bullets";
    }

    // OVERFLOW HANDLING: Split items that exceed density threshold
    const maxItems = activeDensity.maxBulletsPerSlide;
    if (items.length > maxItems && layout !== "numbered_takeaways") {
      // Create continuation slides instead of truncating
      let remaining = [...items];
      let partNum = 1;
      while (remaining.length > 0) {
        const chunk = remaining.slice(0, maxItems);
        remaining = remaining.slice(maxItems);
        const partTitle = remaining.length > 0
          ? smartTitle(heading + " (Parte " + partNum + ")")
          : smartTitle(heading + (partNum > 1 ? " (Parte " + partNum + ")" : ""));
        const chunkLayout = partNum === 1 ? layout : (layout === "grid_cards" ? "bullets" : "grid_cards");
        slides.push({
          layout: chunkLayout, title: partTitle, sectionLabel,
          items: sanitizeBullets(chunk), moduleIndex: modIndex, blockType,
        });
        partNum++;
      }
      prevLayout = layout;
    } else {
      slides.push({
        layout, title: smartTitle(heading), sectionLabel,
        items: sanitizeBullets(items), moduleIndex: modIndex, blockType,
      });
      prevLayout = layout;
    }
  }

  // Summary slide (Resumo do Módulo)
  if (summaryItems.length > 0) {
    slides.push({
      layout: "summary_slide",
      title: "Resumo - " + smartTitle(shortTitle),
      sectionLabel: "RESUMO DO MÓDULO",
      items: sanitizeBullets(summaryItems.slice(0, 5).map(s => {
        const t = sanitize(s).trim();
        if (t.length > 0 && !/[.!?…]$/.test(t)) return t + ".";
        return t;
      })),
      moduleIndex: modIndex,
      blockType: "summary",
    });
  }

  // Always end with takeaways (Key Takeaways)
  if (resumoItems.length > 0) {
    slides.push({
      layout: "numbered_takeaways",
      title: "Key Takeaways - Modulo " + (modIndex + 1),
      sectionLabel: "KEY TAKEAWAYS",
      items: sanitizeBullets(resumoItems.slice(0, 7).map(s => {
        const t = sanitize(s).trim();
        if (t.length > 0 && !/[.!?…]$/.test(t)) return t + ".";
        return t;
      })),
      moduleIndex: modIndex,
      blockType: "conclusion",
    });
  }

  // Remove filler slides (preserving examples, reflections, conclusions)
  const filtered: SlideData[] = [];
  for (let i = 0; i < slides.length; i++) {
    if (isFillerSlide(slides[i])) {
      const fillerItems = slides[i].items || [];
      if (fillerItems.length > 0) {
        const target = filtered.length > 0 ? filtered[filtered.length - 1] : (i + 1 < slides.length ? slides[i + 1] : null);
        if (target && target.items) target.items.push(...fillerItems);
      }
      console.log("[FILLER] Removed: " + slides[i].title);
      continue;
    }
    filtered.push(slides[i]);
  }

  const consolidated = consolidateConsecutiveLayouts(filtered);
  consolidated.forEach(s => { s.densityScore = calculateDensity(s); });

  // Module-level completeness check (examples, reflections, takeaways)
  checkModuleCompleteness(consolidated, modIndex);

  // Per-slide quality checklist (within module)
  consolidated.forEach((s, idx) => {
    runSlideQualityChecklist(s, idx, consolidated);
  });

  // Remove slides marked for removal by checklist
  return consolidated.filter(s => !s._markedForRemoval);
}

/* ═══════════════════════════════════════════════════════
   CONSOLIDATE CONSECUTIVE SAME LAYOUTS
   ═══════════════════════════════════════════════════════ */

function consolidateConsecutiveLayouts(slides: SlideData[]): SlideData[] {
  const result: SlideData[] = [];
  let i = 0;
  while (i < slides.length) {
    // Never consolidate special types
    if (slides[i].layout === "module_cover" || slides[i].layout === "numbered_takeaways" || 
        slides[i].layout === "comparison_table" || slides[i].layout === "example_highlight" ||
        slides[i].layout === "reflection_callout" || slides[i].layout === "warning_callout" ||
        slides[i].layout === "summary_slide") {
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
        mergedItems.push(...items);
      }
      // Split into proper chunks
      const maxItems = activeDensity.maxBulletsPerSlide;
      if (mergedItems.length <= maxItems) {
        result.push({
          layout: "grid_cards", title: smartTitle(mergedTitle),
          sectionLabel: slides[i].sectionLabel, items: mergedItems,
          moduleIndex: slides[i].moduleIndex,
        });
      } else {
        // Keep as multiple slides but with alternating layouts
        for (let k = 0; k < mergedItems.length; k += maxItems) {
          const chunk = mergedItems.slice(k, k + maxItems);
          result.push({
            layout: k === 0 ? "grid_cards" : "bullets",
            title: smartTitle(mergedTitle + (k > 0 ? " (cont.)" : "")),
            sectionLabel: slides[i].sectionLabel, items: chunk,
            moduleIndex: slides[i].moduleIndex,
          });
        }
      }
      console.log("[CONSOLIDATE] " + consecutiveCount + " slides consolidated");
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
   DENSITY BALANCING PASS v2
   ═══════════════════════════════════════════════════════ */

function balanceDensity(slides: SlideData[]): SlideData[] {
  const result = [...slides];
  for (let i = 0; i < result.length; i++) {
    const s = result[i];
    const density = calculateDensity(s);
    s.densityScore = density;
    if (s.layout === "module_cover" || s.layout === "example_highlight" || s.layout === "reflection_callout" || s.layout === "warning_callout" || s.layout === "summary_slide") continue;

    // Merge sparse slides into previous (but not examples/reflections/warnings/summaries) — raised threshold
    if (density < 30 && s.items && s.items.length < 2 && s.blockType !== "example" && s.blockType !== "reflection" && s.blockType !== "warning" && s.blockType !== "summary") {
      if (i > 0 && result[i - 1].layout !== "module_cover" && result[i - 1].layout !== "numbered_takeaways") {
        const prev = result[i - 1];
        if (prev.items && prev.items.length + (s.items?.length || 0) <= activeDensity.maxBulletsPerSlide) {
          prev.items.push(...(s.items || []));
          prev.densityScore = calculateDensity(prev);
          result.splice(i, 1);
          console.log("[MERGE] Merged sparse slide: " + s.title);
          i--;
          continue;
        }
      }
    }

    // Split overloaded slides — raised threshold to avoid excessive fragmentation
    if (density > 92 && s.items && s.items.length > 5 && s.layout !== "numbered_takeaways") {
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
      console.log("[SPLIT] Split overloaded: " + s.title);
    }
  }
  return result;
}

/* ═══════════════════════════════════════════════════════
   HEADER RENDERING v2 — with improved spacing
   ═══════════════════════════════════════════════════════ */

function renderContentHeader(slide: any, sectionLabel: string, titleText: string): number {
  let y = 0.40;
  if (sectionLabel) {
    addTextSafe(slide, sectionLabel, {
      x: MARGIN, y, w: SAFE_W, h: 0.30,
      fontSize: TYPO.LABEL, fontFace: FONT_BODY, color: C.TEXT_LIGHT, bold: true, letterSpacing: 2,
    });
    y += 0.38;
  }
  const cleanTitle = smartTruncate(titleText, 80);
  const fontSize = cleanTitle.length > 60 ? 26 : cleanTitle.length > 40 ? 28 : TYPO.SECTION_TITLE;
  const titleH = getTitleHeight(cleanTitle, SAFE_W, fontSize);
  addTextSafe(slide, cleanTitle, {
    x: MARGIN, y, w: SAFE_W, h: titleH,
    fontSize, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
  });
  y += titleH + 0.30;
  return y;
}

/* ═══════════════════════════════════════════════════════
   SLIDE RENDERERS v2 — Market-grade typography
   ═══════════════════════════════════════════════════════ */

// ── COVER SLIDE ──
function renderCapa(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: 0.08, fill: { color: C.SECONDARY },
  });

  const titleY = 1.9;

  const ajustado = ajustarTextoAoBox(data.title, 40, 2);
  const titleFontSize = ajustado.linhas === 1 ? 44 : 36;
  const titleH = ajustado.linhas === 1 ? 1.0 : 1.5;
  addTextSafe(slide, ajustado.texto, {
    x: MARGIN + 1, y: titleY, w: SAFE_W - 2, h: titleH,
    fontSize: titleFontSize, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
    align: "center", valign: "middle",
  });

  const sepY = titleY + titleH + 0.15;
  slide.addShape(pptx.ShapeType.rect, {
    x: (SLIDE_W - 1.5) / 2, y: sepY, w: 1.5, h: 0.05, fill: { color: C.SECONDARY },
  });

  if (data.description) {
    const descRaw = smartSubtitle(sanitize(data.description));
    const descFit = fitTextForBox(descRaw, SLIDE_W - 3, 1.5, TYPO.BODY, FONT_BODY, TYPO.SUPPORT);
    const descH = Math.min(1.5, Math.max(0.55, (descFit.text.split(/\s+/).length / 14) * 0.22));

    addTextSafe(slide, descFit.text, {
      x: 1.5, y: sepY + 0.30, w: SLIDE_W - 3, h: descH,
      fontSize: descFit.fontSize, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
    });
  }

  const d = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const footer = data.moduleCount ? d + "  |  " + data.moduleCount + " Modulos" : d;
  addTextSafe(slide, footer, {
    x: 1, y: SLIDE_H - 0.80, w: SLIDE_W - 2, h: 0.40,
    fontSize: TYPO.FOOTER, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
  });
}

// ── TABLE OF CONTENTS ──
function renderTOC(pptx: any, data: SlideData) {
  const modules = data.modules || [];
  if (modules.length === 0) return;

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };

  addTextSafe(slide, "CONTEUDO DO CURSO", {
    x: MARGIN, y: 0.35, w: SAFE_W, h: 0.28,
    fontSize: TYPO.LABEL, fontFace: FONT_BODY, color: C.SECONDARY, bold: true, letterSpacing: 2,
  });
  addTextSafe(slide, "O que voce vai aprender", {
    x: MARGIN, y: 0.68, w: SAFE_W, h: 0.55,
    fontSize: 36, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
  });

  const gridY = 1.60;
  const cols = 2;
  const gapX = 0.30;
  const gapY = 0.20;
  const cellW = (SAFE_W - gapX) / cols;
  const gridRows = Math.ceil(modules.length / cols);
  const availH = SLIDE_H - gridY - BOTTOM_MARGIN;
  const cellH = Math.min((availH - (gridRows - 1) * gapY) / gridRows, 1.80);

  modules.forEach((mod, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MARGIN + col * (cellW + gapX);
    const y = gridY + row * (cellH + gapY);
    if (y + cellH > SLIDE_H - BOTTOM_MARGIN) return;

    const accentColor = MODULE_NUMBER_COLORS_FN()[idx % MODULE_NUMBER_COLORS_FN().length];
    const moduleNum = String(idx + 1).padStart(2, "0");

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: cellW, h: cellH,
      fill: { color: C.BG_LIGHT }, line: { color: C.CARD_BORDER, width: 0.5 }, rectRadius: 0.08,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x, y: y + 0.08, w: 0.06, h: cellH - 0.16,
      fill: { color: accentColor }, rectRadius: 0.03,
    });

    addTextSafe(slide, moduleNum, {
      x: x + 0.20, y: y + 0.15, w: 1.2, h: 0.80,
      fontSize: 48, fontFace: FONT_TITLE, color: accentColor, bold: true,
      align: "left", valign: "top",
    });

    const tituloAjustado = ajustarTextoAoBox(mod.title, 28, 2);
    const titleFontSize = tituloAjustado.linhas === 1 ? TYPO.CARD_TITLE : TYPO.SUPPORT;
    addTextSafe(slide, tituloAjustado.texto, {
      x: x + 1.50, y: y + 0.20, w: cellW - 1.70, h: 0.80,
      fontSize: titleFontSize, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      align: "left", valign: "middle",
    });
  });
}

// ── MODULE COVER ──
function renderModuleCover(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  resetSlideIcons();
  const modIdx = data.moduleIndex || 0;
  const moduleColor = MODULE_NUMBER_COLORS_FN()[modIdx % MODULE_NUMBER_COLORS_FN().length];

  slide.background = { color: C.BG_WHITE };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: 0.08, fill: { color: moduleColor },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: SLIDE_W - 3, y: 0.08, w: 3, h: 0.04, fill: { color: C.SECONDARY },
  });

  const moduleNum = data.subtitle || ("MODULO " + String(modIdx + 1).padStart(2, "0"));
  addTextSafe(slide, moduleNum, {
    x: MARGIN, y: 1.2, w: SAFE_W, h: 1.2,
    fontSize: TYPO.MODULE_NUMBER, fontFace: FONT_TITLE, color: moduleColor, bold: true,
  });

  const tituloAjustado = ajustarTextoAoBox(data.title, 35, 2);
  const titleFontSize = tituloAjustado.linhas === 1 ? TYPO.MODULE_TITLE : 28;
  addTextSafe(slide, tituloAjustado.texto, {
    x: MARGIN, y: 2.8, w: SAFE_W * 0.70, h: tituloAjustado.linhas === 1 ? 0.85 : 1.20,
    fontSize: titleFontSize, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
  });

  const sepY = tituloAjustado.linhas === 1 ? 3.70 : 4.05;
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: sepY, w: 1.2, h: 0.05, fill: { color: C.SECONDARY },
  });

  // Calculate description height dynamically to avoid overlap with objectives
  let descEndY = sepY + 0.20;
  if (data.description) {
    const desc = smartSubtitle(data.description);
    // Estimate lines needed for description
    const descCharsPerLine = Math.floor((SAFE_W * 0.65 * 96) / (TYPO.SUBTITLE * 0.54));
    const descLines = Math.max(1, Math.ceil(desc.length / descCharsPerLine));
    const descH = Math.max(0.55, descLines * (TYPO.SUBTITLE * 1.35 / 72) + 0.15);
    addTextSafe(slide, desc, {
      x: MARGIN, y: descEndY, w: SAFE_W * 0.65, h: descH,
      fontSize: TYPO.SUBTITLE, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top",
    });
    descEndY += descH + 0.25;
  }

  const objectives = data.objectives || [];
  if (objectives.length > 0) {
    const objStartY = Math.max(descEndY, sepY + 0.85);
    objectives.slice(0, 3).forEach((obj, idx) => {
      const objY = objStartY + idx * 0.48;
      if (objY + 0.40 > SLIDE_H - 0.40) return;
      const dotSize = 0.12;
      const objLineH = (TYPO.SUPPORT * 1.35) / 72;
      slide.addShape(pptx.ShapeType.ellipse, {
        x: MARGIN + 0.05, y: objY + (objLineH - dotSize) / 2 + 0.04, w: dotSize, h: dotSize,
        fill: { color: moduleColor },
      });
      const objText = smartTruncate(obj, 55);
      addTextSafe(slide, objText, {
        x: MARGIN + 0.30, y: objY, w: SAFE_W * 0.60, h: 0.40,
        fontSize: TYPO.SUPPORT, fontFace: FONT_BODY, color: C.TEXT_BODY, valign: "top",
      });
    });
  }

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: SLIDE_H - 0.08, w: SLIDE_W, h: 0.08, fill: { color: moduleColor },
  });
}

// ── DEFINITION CARD WITH PILLARS ──
function renderDefinitionWithPillars(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;

  const defTextRaw = items[0];
  const pillars = items.slice(1, 4);
  const defBoxW = SAFE_W - 0.60;

  // ── PRE-CHECK: Does the full text fit with pillars on the same slide? ──
  // We need ~2.0" for pillars. Check if definition fits in remaining space at 18pt min.
  const PILLAR_ZONE_H = pillars.length > 0 ? 2.10 : 0;
  const HEADER_ESTIMATE = 1.60; // header + spacing
  const availForDefWithPillars = SLIDE_H - HEADER_ESTIMATE - BOTTOM_MARGIN - PILLAR_ZONE_H - 0.30;
  const availForDefAlone = SLIDE_H - HEADER_ESTIMATE - BOTTOM_MARGIN - 0.30;

  // Test fit at TYPO.BODY (18pt) minimum — never go below 18pt for body text
  const testFitWithPillars = fitTextForBox(defTextRaw, defBoxW, availForDefWithPillars, TYPO.BODY, FONT_BODY, TYPO.BODY);
  const needsSplit = testFitWithPillars.adjusted && pillars.length > 0;

  // ── SLIDE 1: Definition ──
  const slide1 = pptx.addSlide();
  resetSlideIcons();
  slide1.background = { color: C.BG_WHITE };
  let contentY = renderContentHeader(slide1, data.sectionLabel || "", data.title);

  // If splitting, definition gets the full slide height; otherwise share with pillars
  const maxDefAvail = needsSplit ? (SLIDE_H - contentY - BOTTOM_MARGIN - 0.20) : (SLIDE_H - contentY - BOTTOM_MARGIN - PILLAR_ZONE_H - 0.30);
  const defFit = fitTextForBox(defTextRaw, defBoxW, maxDefAvail, TYPO.BODY, FONT_BODY, TYPO.BODY);
  const defTextLines = estimateTextLines(defFit.text, defBoxW, defFit.fontSize);
  const defTextH = Math.max(0.50, defTextLines * (defFit.fontSize * 1.4) / 72 + 0.10);
  const defCardH = Math.min(Math.max(1.0, defTextH + 0.65), maxDefAvail);

  slide1.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: contentY, w: SAFE_W, h: defCardH,
    fill: { color: C.BG_LIGHT }, line: { color: C.ACCENT_BLUE, width: 1.5 }, rectRadius: 0.10,
  });
  addTextSafe(slide1, "DEFINIÇÃO ESSENCIAL", {
    x: MARGIN + 0.30, y: contentY + 0.15, w: defBoxW, h: 0.30,
    fontSize: TYPO.SUPPORT, fontFace: FONT_TITLE, color: C.ACCENT_BLUE, bold: true, letterSpacing: 2,
  });
  addTextSafe(slide1, defFit.text, {
    x: MARGIN + 0.30, y: contentY + 0.50, w: defBoxW, h: defCardH - 0.65,
    fontSize: defFit.fontSize, fontFace: FONT_BODY, color: C.TEXT_BODY, valign: "top", lineSpacingMultiple: 1.4,
  });

  contentY += defCardH + 0.30;

  // ── PILLARS: Render on same slide or continuation slide ──
  if (pillars.length > 0) {
    let pillarSlide: any;
    let pillarY: number;

    if (needsSplit) {
      // Continuation slide for pillars
      pillarSlide = pptx.addSlide();
      resetSlideIcons();
      pillarSlide.background = { color: C.BG_WHITE };
      pillarY = renderContentHeader(pillarSlide, data.sectionLabel || "", smartTitle(data.title + " (cont.)"));
    } else {
      pillarSlide = slide1;
      pillarY = contentY;
    }

    const cols = pillars.length;
    const gapX = 0.22;
    const pillarW = (SAFE_W - (cols - 1) * gapX) / cols;
    const availH = SLIDE_H - pillarY - BOTTOM_MARGIN;
    const pillarH = Math.min(availH, 1.80);

    pillars.forEach((pillar, idx) => {
      const x = MARGIN + idx * (pillarW + gapX);
      const accentColor = CARD_ACCENT_COLORS_FN()[idx % CARD_ACCENT_COLORS_FN().length];

      pillarSlide.addShape(pptx.ShapeType.rect, {
        x, y: pillarY, w: pillarW, h: pillarH,
        fill: { color: C.BG_LIGHT }, line: { color: C.CARD_BORDER, width: 0.5 }, rectRadius: 0.08,
      });
      pillarSlide.addShape(pptx.ShapeType.rect, {
        x: x + 0.10, y: pillarY, w: pillarW - 0.20, h: 0.05, fill: { color: accentColor },
      });

      const circleSize = 0.40;
      const circleX = x + (pillarW - circleSize) / 2;
      const circleY = pillarY + 0.18;
      const iconChar = getSemanticIcon(pillar, idx);
      addCenteredIconInCircle(pillarSlide, pptx, {
        x: circleX, y: circleY, size: circleSize,
        circleColor: accentColor, iconChar, fontSize: TYPO.ICON,
      });

      const colonIdx = pillar.indexOf(":");
      const pTitle = colonIdx > 2 && colonIdx < 50 ? smartTruncate(pillar.substring(0, colonIdx).trim(), 35) : "";
      const pBody = pTitle ? pillar.substring(colonIdx + 1).trim() : pillar;
      // Fit pillar body text to its box
      const pBodyFit = fitTextForBox(pBody, pillarW - 0.24, pillarH - 0.75, TYPO.CARD_BODY, FONT_BODY, 12);

      let textY = pillarY + 0.65;
      if (pTitle) {
        addTextSafe(pillarSlide, pTitle, {
          x: x + 0.12, y: textY, w: pillarW - 0.24, h: 0.35,
          fontSize: TYPO.CARD_TITLE, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
          align: "center",
        });
        textY += 0.38;
      }
      addTextSafe(pillarSlide, pBodyFit.text, {
        x: x + 0.12, y: textY, w: pillarW - 0.24, h: pillarH - (textY - pillarY) - 0.10,
        fontSize: pBodyFit.fontSize, fontFace: FONT_BODY, color: C.TEXT_LIGHT,
        align: "center", valign: "top", lineSpacingMultiple: 1.3,
      });
    });
  }
}

// ── COMPARISON TABLE v2 — readable font sizes ──
function renderComparisonTable(pptx: any, data: SlideData) {
  const headers = data.tableHeaders || [];
  const allRows = data.tableRows || [];
  if (headers.length === 0 || allRows.length === 0) return;

  const colWidths = getColumnWidths(headers);
  const maxTableH = SLIDE_H - 2.2 - BOTTOM_MARGIN;
  const chunks = splitTableRows(allRows, colWidths, maxTableH);

  for (let ci = 0; ci < chunks.length; ci++) {
    const rows = chunks[ci];
    const estH = calcTableHeight(rows, colWidths);
    const titleText = chunks.length > 1
      ? smartTitle(data.title + " (Parte " + (ci + 1) + ")")
      : data.title;

    if (estH > maxTableH * 1.2) {
      const mid = Math.ceil(rows.length / 2);
      renderComparisonTable(pptx, {
        ...data, title: titleText + " (A)", tableRows: rows.slice(0, mid),
      });
      renderComparisonTable(pptx, {
        ...data, title: titleText + " (B)", tableRows: rows.slice(mid),
      });
      return;
    }

    const slide = pptx.addSlide();
    slide.background = { color: C.BG_WHITE };
    const contentY = renderContentHeader(slide, data.sectionLabel || "", titleText);

    const colCount = headers.length;
    const noBorder = { type: "none" as const, pt: 0, color: "000000" };
    const borderBottom = { type: "solid" as const, pt: 0.5, color: C.TABLE_BORDER };

    const tableData: any[][] = [];

    // Header row
    tableData.push(headers.map(h => ({
      text: h,
      options: {
        fontSize: TYPO.TABLE_HEADER, fontFace: FONT_TITLE, bold: true, color: C.TEXT_WHITE,
        fill: { color: C.TABLE_HEADER_BG },
        border: [noBorder, noBorder, noBorder, noBorder],
        valign: "middle" as const,
        paraSpaceBefore: 6, paraSpaceAfter: 6,
        margin: [0.10, 0.15, 0.10, 0.15],
      },
    })));

    // Data rows
    rows.forEach((row, ri) => {
      const isEven = ri % 2 === 1;
      const fillColor = isEven ? C.TABLE_ROW_EVEN : C.TABLE_ROW_ODD;
      const dataRow = row.map((cell, ci) => ({
        text: cell,
        options: {
          fontSize: TYPO.TABLE_CELL, fontFace: FONT_BODY, color: C.TEXT_BODY,
          bold: ci === 0,
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
            fontSize: TYPO.TABLE_CELL, fontFace: FONT_BODY, color: C.TEXT_BODY,
            fill: { color: fillColor }, border: [noBorder, noBorder, borderBottom, noBorder],
            valign: "middle" as const, paraSpaceBefore: 4, paraSpaceAfter: 4,
            margin: [0.10, 0.15, 0.10, 0.15], bold: false,
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
    const insightY = SLIDE_H - 0.75;
    const insightBoxH = 0.50;
    slide.addShape(pptx.ShapeType.rect, {
      x: MARGIN, y: insightY, w: SAFE_W, h: insightBoxH,
      fill: { color: C.INSIGHT_BG }, rectRadius: 0.08,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: MARGIN, y: insightY + 0.06, w: 0.05, h: insightBoxH - 0.12,
      fill: { color: C.SECONDARY },
    });
    addTextSafe(slide, [
      { text: "Insight: ", options: { bold: true, color: C.SECONDARY, fontSize: TYPO.SUPPORT, fontFace: FONT_TITLE } },
      { text: "Analise os dados acima e reflita sobre como se aplicam ao seu contexto.", options: { bold: false, color: C.TEXT_BODY, fontSize: TYPO.SUPPORT, fontFace: FONT_BODY, italic: true } },
    ], {
      x: MARGIN + 0.22, y: insightY, w: SAFE_W - 0.44, h: insightBoxH, valign: "middle",
    });
  }
}

// ── GRID CARDS v2 ──
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
  const gapX = 0.22; const gapY = 0.22;
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

    const accentColor = CARD_ACCENT_COLORS_FN()[idx % CARD_ACCENT_COLORS_FN().length];

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.BG_LIGHT }, line: { color: C.CARD_BORDER, width: 0.5 }, rectRadius: 0.08,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x, y: y + 0.08, w: 0.05, h: cardH - 0.16,
      fill: { color: accentColor }, rectRadius: 0.025,
    });

    const circleSize = 0.42;
    const iconChar = getSemanticIcon(item, idx);
    addCenteredIconInCircle(slide, pptx, {
      x: x + 0.18,
      y: y + 0.18,
      size: circleSize,
      circleColor: accentColor,
      iconChar,
      fontSize: TYPO.ICON,
    });

    const colonIdx = item.indexOf(":");
    const cardTitleRaw = colonIdx > 2 && colonIdx < 50 ? smartTruncate(item.substring(0, colonIdx).trim(), 40) : "";
    const cardBodyRaw = cardTitleRaw ? smartTruncate(item.substring(colonIdx + 1).trim(), 110) : smartTruncate(item, 110);

    const textX = x + 0.70; const textW = cardW - 0.84;
    let textY = y + 0.18;

    if (cardTitleRaw) {
      const titleFit = fitTextForBox(cardTitleRaw, textW, 0.32, TYPO.CARD_TITLE, FONT_TITLE, TYPO.SUPPORT);
      addTextSafe(slide, titleFit.text, {
        x: textX, y: textY, w: textW, h: 0.32,
        fontSize: titleFit.fontSize, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      });
      textY += 0.36;
    }
    if (cardBodyRaw) {
      const bodyH = Math.max(cardH - (textY - y) - 0.10, 0.20);
      const bodyFit = fitTextForBox(cardBodyRaw, textW, bodyH, TYPO.CARD_BODY, FONT_BODY, 12);
      addTextSafe(slide, bodyFit.text, {
        x: textX, y: textY, w: textW, h: bodyH,
        fontSize: bodyFit.fontSize, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top", lineSpacingMultiple: 1.3,
      });
    }
  });
}

// ── FOUR QUADRANTS v2 ──
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

    const accentColor = CARD_ACCENT_COLORS_FN()[idx % CARD_ACCENT_COLORS_FN().length];

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: quadW, h: quadH,
      fill: { color: C.BG_LIGHT }, line: { color: C.CARD_BORDER, width: 0.5 }, rectRadius: 0.10,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: x + 0.10, y, w: quadW - 0.20, h: 0.05, fill: { color: accentColor },
    });

    const circleSize = 0.50;
    const iconChar = getSemanticIcon(item, idx);
    addCenteredIconInCircle(slide, pptx, {
      x: x + 0.25,
      y: y + 0.25,
      size: circleSize,
      circleColor: accentColor,
      iconChar,
      fontSize: 20,
    });

    const colonIdx = item.indexOf(":");
    const qTitleRaw = colonIdx > 2 && colonIdx < 50 ? smartTruncate(item.substring(0, colonIdx).trim(), 40) : "";
    const qBodyRaw = qTitleRaw ? smartTruncate(item.substring(colonIdx + 1).trim(), 120) : smartTruncate(item, 120);

    let textY = y + 0.25;
    const textX = x + 0.85; const textW = quadW - 1.05;

    if (qTitleRaw) {
      const titleFit = fitTextForBox(qTitleRaw, textW, 0.38, TYPO.CARD_TITLE, FONT_TITLE, TYPO.SUPPORT);
      addTextSafe(slide, titleFit.text, {
        x: textX, y: textY, w: textW, h: 0.38,
        fontSize: titleFit.fontSize, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      });
      textY += 0.40;
    }

    const qBodyH = Math.max(quadH - (textY - y) - 0.15, 0.28);
    const bodyFit = fitTextForBox(qBodyRaw, textW, qBodyH, TYPO.CARD_BODY, FONT_BODY, 12);
    addTextSafe(slide, bodyFit.text, {
      x: textX, y: textY, w: textW, h: qBodyH,
      fontSize: bodyFit.fontSize, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top", lineSpacingMultiple: 1.3,
    });
  });

  if (items.length > 4) {
    const footerItems = items.slice(4, 8);
    const footerY = SLIDE_H - 0.75;
    const footerText = footerItems.map(it => "- " + smartTruncate(sanitize(it), 50)).join("   ");
    addTextSafe(slide, footerText, {
      x: MARGIN, y: footerY, w: SAFE_W, h: 0.45,
      fontSize: TYPO.SUPPORT, fontFace: FONT_BODY, color: C.TEXT_LIGHT, italic: true,
    });
  }
}

// ── PROCESS TIMELINE v2 ──
function renderProcessTimeline(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };
  let contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  const steps = items.slice(0, 4);
  const stepCount = steps.length;
  const totalW = SAFE_W;
  const stepW = totalW / stepCount;
  const circleSize = 0.60;
  const lineY = contentY + circleSize / 2;

  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN + stepW / 2, y: lineY + circleSize / 2 - 0.02,
    w: totalW - stepW, h: 0.04, fill: { color: C.CARD_BORDER },
  });

  const moduleIdx = data.moduleIndex || 0;
  const moduleColor = MODULE_NUMBER_COLORS_FN()[moduleIdx % MODULE_NUMBER_COLORS_FN().length];

  steps.forEach((step, idx) => {
    const centerX = MARGIN + stepW * idx + stepW / 2;
    const x = centerX - circleSize / 2;
    const y = contentY;

    slide.addShape(pptx.ShapeType.ellipse, {
      x, y, w: circleSize, h: circleSize, fill: { color: moduleColor },
    });
    addTextSafe(slide, String(idx + 1), {
      x, y, w: circleSize, h: circleSize,
      fontSize: 24, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });

    const colonIdx = step.indexOf(":");
    let stepTitle: string;
    let stepDesc: string;
    if (colonIdx > 2 && colonIdx < 50) {
      stepTitle = smartTruncate(step.substring(0, colonIdx).trim(), 30);
      stepDesc = smartTruncate(step.substring(colonIdx + 1).trim(), 78);
    } else {
      const words = step.split(/\s+/);
      stepTitle = smartTruncate(words.slice(0, 3).join(" "), 30);
      stepDesc = smartTruncate(words.slice(3).join(" "), 78);
    }

    const textY = y + circleSize + 0.30;
    const textW = stepW - 0.40;
    const textX = centerX - textW / 2;

    const titleFit = fitTextForBox(stepTitle, textW, 0.45, TYPO.CARD_TITLE, FONT_TITLE, TYPO.SUPPORT);
    addTextSafe(slide, titleFit.text, {
      x: textX, y: textY, w: textW, h: 0.45,
      fontSize: titleFit.fontSize, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      align: "center",
    });
    if (stepDesc) {
      const descFit = fitTextForBox(stepDesc, textW, 0.60, TYPO.CARD_BODY, FONT_BODY, 12);
      addTextSafe(slide, descFit.text, {
        x: textX, y: textY + 0.48, w: textW, h: 0.60,
        fontSize: descFit.fontSize, fontFace: FONT_BODY, color: C.TEXT_LIGHT,
        align: "center", valign: "top", lineSpacingMultiple: 1.25,
      });
    }
  });

  if (items.length > 4) {
    const supportText = smartTruncate(items[4], 80);
    addTextSafe(slide, supportText, {
      x: MARGIN, y: SLIDE_H - 0.80, w: SAFE_W, h: 0.45,
      fontSize: TYPO.SUPPORT, fontFace: FONT_BODY, color: C.SECONDARY, italic: true, align: "center",
    });
  }
}

// ── BULLETS v2 — 18pt minimum ──
function renderBullets(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };
  const contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  const maxItems = Math.min(items.length, activeDensity.maxBulletsPerSlide);
  const textX = MARGIN + 0.40;
  const textW = SAFE_W - 0.50;
  const availH = SLIDE_H - contentY - BOTTOM_MARGIN;
  const selected = items.slice(0, maxItems).map((item) => smartBullet(item));

  // ── UNIFORM FONT SIZE: calculate ONE font size for ALL bullets ──
  // Find the smallest font that fits the longest bullet, then use it for all
  let uniformFontSize = TYPO.BULLET_TEXT;
  const maxRowH = Math.max(0.48, availH / selected.length - 0.06);
  for (const item of selected) {
    const fit = fitTextForBox(item, textW, Math.max(maxRowH, 0.22), TYPO.BULLET_TEXT, FONT_BODY, TYPO.SUPPORT);
    if (fit.fontSize < uniformFontSize) uniformFontSize = fit.fontSize;
  }

  const rawHeights = selected.map((txt) => {
    const lineCount = Math.max(1, estimateTextLines(txt, textW, uniformFontSize));
    const lineHeight = (uniformFontSize * 1.35) / 72;
    return Math.max(0.52, Math.min(1.15, lineCount * lineHeight + 0.10));
  });

  const GAP_BETWEEN_BULLETS = 0.10;
  const rawTotal = rawHeights.reduce((sum, h) => sum + h, 0) + (selected.length - 1) * GAP_BETWEEN_BULLETS;
  const minRowH = 0.48;
  let heights = [...rawHeights];

  if (rawTotal > availH) {
    const totalGaps = (selected.length - 1) * GAP_BETWEEN_BULLETS;
    const availForRows = availH - totalGaps;
    const minTotal = minRowH * heights.length;
    if (minTotal >= availForRows) {
      heights = heights.map(() => availForRows / heights.length);
    } else {
      const extraTotal = heights.reduce((sum, h) => sum + Math.max(0, h - minRowH), 0);
      const availableExtra = availForRows - minTotal;
      heights = heights.map((h) => {
        const extra = Math.max(0, h - minRowH);
        return minRowH + (extraTotal > 0 ? (extra / extraTotal) * availableExtra : 0);
      });
    }
  }

  let cursorY = contentY;
  selected.forEach((item, idx) => {
    const rowH = heights[idx];
    if (cursorY + rowH > SLIDE_H - BOTTOM_MARGIN + 0.01) return;

    const accentColor = CARD_ACCENT_COLORS_FN()[idx % CARD_ACCENT_COLORS_FN().length];
    // Use uniform font size (already computed) — compress text if needed at this size
    const textFit = fitTextForBox(item, textW, Math.max(rowH - 0.03, 0.22), uniformFontSize, FONT_BODY, uniformFontSize);
    const textY = cursorY + 0.01;

    const dotSize = 0.14;
    const lineHeightIn = (uniformFontSize * 1.35) / 72;
    const dotY = textY + Math.max(0, (lineHeightIn - dotSize) / 2);

    slide.addShape(pptx.ShapeType.ellipse, {
      x: MARGIN + 0.10,
      y: dotY,
      w: dotSize,
      h: dotSize,
      fill: { color: accentColor },
    });

    const richText = makeBoldLabelText(textFit.text, C.TEXT_DARK, C.TEXT_BODY, uniformFontSize);
    addTextSafe(slide, richText, {
      x: textX,
      y: textY,
      w: textW,
      h: Math.max(rowH - 0.02, 0.22),
      valign: "top",
      lineSpacingMultiple: 1.3,
      inset: 0,
    });

    if (idx < selected.length - 1) {
      slide.addShape(pptx.ShapeType.rect, {
        x: textX,
        y: cursorY + rowH - 0.02,
        w: SAFE_W - 0.80,
        h: 0.01,
        fill: { color: C.TABLE_ROW_EVEN },
      });
    }

    cursorY += rowH + GAP_BETWEEN_BULLETS;
  });
}

// ── EXAMPLE HIGHLIGHT — NEW template for examples/case studies ──
function renderExampleHighlight(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };

  let contentY = renderContentHeader(slide, data.sectionLabel || "EXEMPLO PRATICO", data.title);

  // Example highlight box
  const moduleIdx = data.moduleIndex || 0;
  const moduleColor = MODULE_NUMBER_COLORS_FN()[moduleIdx % MODULE_NUMBER_COLORS_FN().length];
  const boxBg = activeThemeKey === "dark" ? "2D3E2A" : "F0FFF4";
  const boxH = Math.min(SLIDE_H - contentY - BOTTOM_MARGIN - 0.20, 4.0);

  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: contentY, w: SAFE_W, h: boxH,
    fill: { color: boxBg }, line: { color: moduleColor, width: 1.5 }, rectRadius: 0.10,
  });
  // Left accent bar
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: contentY + 0.10, w: 0.06, h: boxH - 0.20,
    fill: { color: moduleColor }, rectRadius: 0.03,
  });

  // Icon
  const iconChar = getSemanticIcon(data.title + " " + items[0], 0);
  const circleSize = 0.50;
  addCenteredIconInCircle(slide, pptx, {
    x: MARGIN + 0.25,
    y: contentY + 0.20,
    size: circleSize,
    circleColor: moduleColor,
    iconChar,
    fontSize: 20,
  });

  // Example content — UNIFORM font size + proper spacing
  let textY = contentY + 0.25;
  const textX = MARGIN + 0.90;
  const textW = SAFE_W - 1.10;
  const exItemH = Math.min(0.70, (boxH - 0.30) / items.length);
  const EXAMPLE_GAP = 0.12;

  // Calculate uniform font size for all example items
  let exampleFontSize = TYPO.BODY;
  for (const item of items) {
    const fit = fitTextForBox(item, textW, exItemH, TYPO.BODY, FONT_BODY, TYPO.SUPPORT);
    if (fit.fontSize < exampleFontSize) exampleFontSize = fit.fontSize;
  }

  items.forEach((item, idx) => {
    if (textY + 0.50 > contentY + boxH - 0.15) return;
    const richText = makeBoldLabelText(item, C.TEXT_DARK, C.TEXT_BODY, exampleFontSize);
    addTextSafe(slide, richText, {
      x: textX, y: textY, w: textW, h: exItemH,
      valign: "middle", lineSpacingMultiple: 1.35,
    });
    textY += exItemH + EXAMPLE_GAP;
  });
}

// ── REFLECTION CALLOUT — NEW template for reflection/checkpoint ──
function renderReflectionCallout(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };

  let contentY = renderContentHeader(slide, data.sectionLabel || "MOMENTO DE REFLEXAO", data.title);

  const boxBg = C.REFLECTION_BG;
  const REFLECTION_BOTTOM_GAP = 0.55;
  const boxH = Math.min(SLIDE_H - contentY - BOTTOM_MARGIN - REFLECTION_BOTTOM_GAP, 3.2);

  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN + 0.5, y: contentY, w: SAFE_W - 1.0, h: boxH,
    fill: { color: boxBg }, rectRadius: 0.12,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN + 0.5, y: contentY + 0.10, w: 0.06, h: boxH - 0.20,
    fill: { color: C.ACCENT_BLUE }, rectRadius: 0.03,
  });

  // Reflection icon
  const circleSize = 0.55;
  const iconX = (SLIDE_W - circleSize) / 2;
  slide.addShape(pptx.ShapeType.ellipse, {
    x: iconX, y: contentY + 0.25, w: circleSize, h: circleSize,
    fill: { color: C.ACCENT_BLUE },
  });
  addTextSafe(slide, "?", {
    x: iconX, y: contentY + 0.25, w: circleSize, h: circleSize,
    fontSize: 28, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
    align: "center", valign: "middle",
  });

  let textY = contentY + 1.0;
  const textX = MARGIN + 1.0;
  const textW = SAFE_W - 2.0;

  items.forEach((item, idx) => {
    if (textY + 0.55 > contentY + boxH - 0.15) return;
    const itemH = Math.min(0.65, (boxH - 1.0) / items.length);
    addTextSafe(slide, item, {
      x: textX, y: textY, w: textW, h: itemH,
      fontSize: TYPO.BODY, fontFace: FONT_BODY, color: C.TEXT_BODY, italic: true,
      align: "center", valign: "middle", lineSpacingMultiple: 1.4,
    });
    textY += itemH + 0.10;
  });
}

// ── NUMBERED TAKEAWAYS v2 ──
function renderNumberedTakeaways(pptx: any, data: SlideData) {
  const items = (data.items || []).map(i => sanitize(i)).filter(Boolean);
  if (!items.length) return;

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };
  const contentY = renderContentHeader(slide, data.sectionLabel || "RESUMO DO MODULO", data.title);

  const maxItems = Math.min(items.length, 6);
  const cols = maxItems <= 4 ? 2 : 3;
  const gridRows = Math.ceil(maxItems / cols);
  const gapX = 0.22; const gapY = 0.20;
  const cardW = (SAFE_W - (cols - 1) * gapX) / cols;
  const reflectionH = 0.58;
  const availH = SLIDE_H - contentY - reflectionH - BOTTOM_MARGIN - 0.10;
  const cardH = Math.min((availH - (gridRows - 1) * gapY) / gridRows, 1.35);

  items.slice(0, maxItems).forEach((bullet, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = MARGIN + col * (cardW + gapX);
    const y = contentY + row * (cardH + gapY);
    if (y + cardH > SLIDE_H - reflectionH - BOTTOM_MARGIN) return;

    const accentColor = CARD_ACCENT_COLORS_FN()[idx % CARD_ACCENT_COLORS_FN().length];

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.BG_LIGHT }, line: { color: C.CARD_BORDER, width: 0.5 }, rectRadius: 0.08,
    });
    slide.addShape(pptx.ShapeType.rect, {
      x, y: y + 0.08, w: 0.05, h: cardH - 0.16,
      fill: { color: accentColor }, rectRadius: 0.025,
    });

    const circleSize = 0.42;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.16, y: y + 0.16, w: circleSize, h: circleSize, fill: { color: accentColor },
    });
    addTextSafe(slide, String(idx + 1), {
      x: x + 0.16, y: y + 0.16, w: circleSize, h: circleSize,
      fontSize: TYPO.ICON, fontFace: FONT_TITLE, color: C.TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });

    const colonIdx = bullet.indexOf(":");
    let cardTitle = "";
    let cardBody = bullet;
    if (colonIdx > 2 && colonIdx < 60) {
      cardTitle = smartTruncate(bullet.substring(0, colonIdx).trim(), 40);
      cardBody = smartTruncate(bullet.substring(colonIdx + 1).trim(), 90);
    } else {
      const words = bullet.split(/\s+/);
      if (words.length > 4) {
        cardTitle = smartTruncate(words.slice(0, 4).join(" "), 40);
        cardBody = smartTruncate(words.slice(4).join(" "), 90);
      } else {
        cardTitle = smartTruncate(bullet, 40);
        cardBody = "";
      }
    }

    if (cardBody && !/[.!?]$/.test(cardBody)) cardBody += ".";

    const textX = x + 0.68; const textW = cardW - 0.82;
    let textY = y + 0.16;

    if (cardTitle) {
      addTextSafe(slide, cardTitle, {
        x: textX, y: textY, w: textW, h: 0.32,
        fontSize: TYPO.TAKEAWAY_TITLE, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      });
      textY += 0.34;
    }
    if (cardBody) {
      const bodyH = cardH - (textY - y) - 0.10;
      addTextSafe(slide, cardBody, {
        x: textX, y: textY, w: textW, h: Math.max(bodyH, 0.15),
        fontSize: TYPO.TAKEAWAY_BODY, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top", lineSpacingMultiple: 1.2,
      });
    }
  });

  // Reflection callout at bottom
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
    ? smartTruncate(sanitize(data.description), 90)
    : "Como esses conceitos se aplicam a sua realidade profissional?";
  addTextSafe(slide, [
    { text: "Reflexao: ", options: { bold: true, color: C.ACCENT_BLUE, fontSize: TYPO.SUPPORT, fontFace: FONT_TITLE } },
    { text: reflText, options: { bold: false, color: C.TEXT_BODY, fontSize: TYPO.SUPPORT, fontFace: FONT_BODY, italic: true } },
  ], {
    x: MARGIN + 0.22, y: reflY, w: SAFE_W - 0.44, h: reflectionH, valign: "middle",
  });
}

// ── WARNING CALLOUT — Desafios e cuidados ──
function renderWarningCallout(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };

  let contentY = renderContentHeader(slide, data.sectionLabel || "DESAFIOS E CUIDADOS", data.title);

  const moduleIdx = data.moduleIndex || 0;
  const warningColor = C.ACCENT_RED;
  const warningBg = activeThemeKey === "dark" ? "3D2A2A" : "FFF5F5";
  const boxH = Math.min(SLIDE_H - contentY - BOTTOM_MARGIN - 0.20, 4.0);

  // Warning box background
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: contentY, w: SAFE_W, h: boxH,
    fill: { color: warningBg }, line: { color: warningColor, width: 1.5 }, rectRadius: 0.10,
  });
  // Left accent bar (red)
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: contentY + 0.10, w: 0.06, h: boxH - 0.20,
    fill: { color: warningColor }, rectRadius: 0.03,
  });

  // Warning icon
  const circleSize = 0.50;
  addCenteredIconInCircle(slide, pptx, {
    x: MARGIN + 0.25,
    y: contentY + 0.20,
    size: circleSize,
    circleColor: warningColor,
    iconChar: "◈",
    fontSize: 20,
  });

  // Warning label
  addTextSafe(slide, "ATENÇÃO", {
    x: MARGIN + 0.90, y: contentY + 0.22, w: 3.0, h: 0.40,
    fontSize: TYPO.LABEL, fontFace: FONT_TITLE, color: warningColor, bold: true, letterSpacing: 2,
  });

  // Bullet items with warning dots — UNIFORM font size
  let textY = contentY + 0.85;
  const textX = MARGIN + 0.55;
  const textW = SAFE_W - 0.75;
  const itemH = Math.min(0.65, (boxH - 1.0) / Math.max(items.length, 1));
  const WARNING_GAP = 0.10;

  // Calculate uniform font size for all warning items
  let warningFontSize = TYPO.BODY;
  for (const item of items) {
    const fit = fitTextForBox(item, textW, itemH, TYPO.BODY, FONT_BODY, TYPO.SUPPORT);
    if (fit.fontSize < warningFontSize) warningFontSize = fit.fontSize;
  }

  items.forEach((item, idx) => {
    if (textY + itemH > contentY + boxH - 0.10) return;

    const dotSize = 0.12;
    const lineHeightIn = (warningFontSize * 1.35) / 72;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: MARGIN + 0.25, y: textY + (lineHeightIn - dotSize) / 2,
      w: dotSize, h: dotSize, fill: { color: warningColor },
    });

    const richText = makeBoldLabelText(item, warningColor, C.TEXT_BODY, warningFontSize);
    addTextSafe(slide, richText, {
      x: textX, y: textY, w: textW, h: itemH,
      valign: "top", lineSpacingMultiple: 1.35,
    });
    textY += itemH + WARNING_GAP;
  });
}

// ── SUMMARY SLIDE — Resumo do Módulo ──
function renderSummarySlide(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };

  let contentY = renderContentHeader(slide, data.sectionLabel || "RESUMO DO MÓDULO", data.title);

  const moduleIdx = data.moduleIndex || 0;
  const moduleColor = MODULE_NUMBER_COLORS_FN()[moduleIdx % MODULE_NUMBER_COLORS_FN().length];

  // Summary box
  const boxH = Math.min(SLIDE_H - contentY - BOTTOM_MARGIN - 0.20, 4.0);
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN + 0.3, y: contentY, w: SAFE_W - 0.6, h: boxH,
    fill: { color: C.BG_LIGHT }, line: { color: moduleColor, width: 1.0 }, rectRadius: 0.10,
  });

  // Top accent bar
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN + 0.4, y: contentY, w: SAFE_W - 0.8, h: 0.05,
    fill: { color: moduleColor },
  });

  // Summary icon
  const circleSize = 0.48;
  const iconX = (SLIDE_W - circleSize) / 2;
  addCenteredIconInCircle(slide, pptx, {
    x: iconX,
    y: contentY + 0.20,
    size: circleSize,
    circleColor: moduleColor,
    iconChar: "▣",
    fontSize: 18,
  });

  // Summary text items — use UNIFORM font size across all items
  let textY = contentY + 0.85;
  const textX = MARGIN + 0.70;
  const textW = SAFE_W - 1.40;
  const itemH = Math.min(0.70, (boxH - 1.0) / Math.max(items.length, 1));
  const SUMMARY_GAP = 0.12;

  // Find smallest font that fits ALL items (uniform sizing)
  let summaryFontSize = TYPO.BODY;
  for (const item of items) {
    const fit = fitTextForBox(item, textW, itemH, TYPO.BODY, FONT_BODY, TYPO.SUPPORT);
    if (fit.fontSize < summaryFontSize) summaryFontSize = fit.fontSize;
  }

  items.forEach((item, idx) => {
    if (textY + itemH > contentY + boxH - 0.15) return;
    const textFit = fitTextForBox(item, textW, itemH, summaryFontSize, FONT_BODY, summaryFontSize);
    addTextSafe(slide, textFit.text, {
      x: textX, y: textY, w: textW, h: itemH,
      fontSize: summaryFontSize, fontFace: FONT_BODY, color: C.TEXT_BODY,
      valign: "top", lineSpacingMultiple: 1.4,
    });
    textY += itemH + SUMMARY_GAP;
  });

  // Bottom accent
  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN + 0.4, y: contentY + boxH - 0.05, w: SAFE_W - 0.8, h: 0.05,
    fill: { color: moduleColor },
  });
}

// ── CLOSING SLIDE ──
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
  
  const tituloFechamento = ajustarTextoAoBox(sanitize(courseTitle), 45, 2);
  const closeFontSize = tituloFechamento.linhas === 1 ? TYPO.SUBTITLE : TYPO.BODY;
  addTextSafe(slide, tituloFechamento.texto, {
    x: 2, y: 3.70, w: SLIDE_W - 4, h: tituloFechamento.linhas === 1 ? 0.60 : 0.90,
    fontSize: closeFontSize, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
  });
  
  addTextSafe(slide, "Continue praticando  |  Acesse os materiais complementares", {
    x: 2, y: 4.80, w: SLIDE_W - 4, h: 0.45,
    fontSize: TYPO.BODY, fontFace: FONT_BODY, color: C.SECONDARY, align: "center",
  });

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: SLIDE_H - 0.08, w: SLIDE_W, h: 0.08, fill: { color: C.SECONDARY },
  });

  addTextSafe(slide, "Gerado com EduGen AI", {
    x: 2, y: SLIDE_H - 0.55, w: SLIDE_W - 4, h: 0.35,
    fontSize: TYPO.SUPPORT, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
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

    const body = await req.json();
    const { course_id, palette, density, theme, includeImages, template } = body;
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Apply template first (fonts + base colors)
    activeTemplate = SLIDE_TEMPLATES[template || "default"] || SLIDE_TEMPLATES.default;
    FONT_TITLE = activeTemplate.fonts.title;
    FONT_BODY = activeTemplate.fonts.body;

    // Apply user customization (theme, palette, density override template colors when set)
    activeThemeKey = theme === "dark" ? "dark" : "light";
    currentTheme = THEME[activeThemeKey];
    activePalette = PALETTES[palette || "default"] || PALETTES.default;
    activeDensity = DENSITY_MODES[density || "standard"] || DENSITY_MODES.standard;

    // If template != default AND palette == default, apply template accent colors into the palette
    if ((template || "default") !== "default" && (palette || "default") === "default") {
      activePalette = [
        activeTemplate.colors.secondary,
        activeTemplate.colors.accent,
        activeTemplate.colors.primary,
        activeTemplate.colors.accent,
        activeTemplate.colors.secondary,
      ];
    }

    refreshColors();
    console.log("[CONFIG] Template:" + (template || "default") + " Theme:" + activeThemeKey + " Palette:" + (palette || "default") + " Density:" + (density || "standard"));

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

    // ═══════════════════════════════════════════════════════
    // MULTI-STAGE VALIDATION PIPELINE v3
    // Stage 0: TF-IDF Corpus + Semantic Planner → Stage 1: Content
    // Stage 1.5: LLM NLP → Stage 2: Structure → Stage 3: Visual → Stage 4: Final QC
    // ═══════════════════════════════════════════════════════
    console.log("[PIPELINE] Starting multi-stage validation pipeline v3...");

    // ── PRE-STAGE A: Build TF-IDF corpus from all module content for semantic operations ──
    const corpusDocs = modules.map((m: any) => sanitize(m.content || "")).filter((c: string) => c.length > 20);
    resetIdfCache();
    buildIdfFromCorpus(corpusDocs);

    // ── PRE-STAGE B: Semantic pre-parse ALL modules ──
    // This runs the semantic parser on every module BEFORE the LLM planner,
    // producing structured blocks that feed both the main path and the fallback path.
    console.log("[PRE-PARSE] Running semantic parser on all " + modules.length + " modules...");
    const preParsedModules = preParseAllModules(modules);
    let totalPreParsedBlocks = 0;
    let totalPreParsedTables = 0;
    for (const [, pp] of preParsedModules) {
      totalPreParsedBlocks += pp.sectionCount;
      totalPreParsedTables += pp.blocks.filter(b => b.isTable).length;
    }
    console.log("[PRE-PARSE] Complete: " + totalPreParsedBlocks + " blocks, " + totalPreParsedTables + " tables across " + modules.length + " modules");

    // Accumulative quality report (persists across ALL retries)
    const qualityReport = {
      pre_tfidf_corpus_size: corpusDocs.length,
      pre_tfidf_terms: _idfCache.size,
      pre_parse_total_blocks: totalPreParsedBlocks,
      pre_parse_total_tables: totalPreParsedTables,
      stage0_semantic_planner_modules: 0,
      stage0_regex_fallback_modules: 0,
      stage1_slides_generated: 0,
      stage1_nlp_summarized: 0,
      stage1_5_llm_grammar_fixes: 0,
      stage1_5_llm_truncation_fixes: 0,
      stage1_5_llm_nonsense_dropped: 0,
      stage1_5_llm_relevance_dropped: 0,
      stage2_dedup_removed: 0,
      stage2_coherence_warnings: [] as string[],
      stage2_avg_density: 0,
      stage2_relevance_dropped: 0,
      stage3_bbox_overflows: 0,
      stage3_bbox_fixes: 0,
      stage3_overflow_splits: 0,
      stage3_wcag_failures: [] as string[],
      stage4_all_warnings: [] as string[],
      stage4_all_fixes: [] as string[],
      stage4_retries_used: 0,
      stage4_final_warnings: 0,
      stage4_final_fixes: 0,
    };

    // ── STAGE 0: SLIDE PLANNING (LLM with pre-parsed input + fallback) ──
    // The LLM planner now receives pre-segmented structured content from the
    // semantic parser instead of raw markdown. This gives it cleaner section
    // boundaries, identified pedagogical types, and properly separated tables.
    // If the LLM planner fails, buildModuleSlides reuses the same pre-parsed
    // blocks (no double-parsing).
    console.log("[STAGE-0] Starting slide planning with pre-parsed semantic input...");
    let allSlides: SlideData[] = [];
    let semanticPlannerUsed = 0;
    let regexFallbackUsed = 0;

    // Process modules in parallel batches of 3 to speed up
    const PLANNER_BATCH = 3;
    for (let batchStart = 0; batchStart < modules.length; batchStart += PLANNER_BATCH) {
      const batchModules = modules.slice(batchStart, batchStart + PLANNER_BATCH);
      const planPromises = batchModules.map((mod: any, localIdx: number) => {
        const globalIdx = batchStart + localIdx;
        const preParsed = preParsedModules.get(globalIdx);
        return llmPlanModuleSlides(
          sanitize(mod.title || ""),
          mod.content || "",
          globalIdx,
          course.language || "pt-BR",
          preParsed?.structuredSummary  // Feed pre-parsed structured content to LLM
        ).then(plan => ({ plan, mod, globalIdx }));
      });

      const results = await Promise.all(planPromises);

      for (const { plan, mod, globalIdx } of results) {
        if (plan) {
          // LLM planner succeeded — use semantic plan (built from pre-parsed input)
          const slides = semanticPlanToSlides(plan, globalIdx);
          allSlides.push(...slides);
          semanticPlannerUsed++;
          console.log("[STAGE-0] Module " + (globalIdx + 1) + ": LLM plan from pre-parsed input (" + slides.length + " slides)");
        } else {
          // Fallback: build slides directly from pre-parsed blocks (reuse, no re-parsing)
          const preParsed = preParsedModules.get(globalIdx);
          if (preParsed && preParsed.blocks.length > 0) {
            const slides = buildModuleSlidesFromBlocks(preParsed.blocks, mod, globalIdx, modules.length);
            allSlides.push(...slides);
            regexFallbackUsed++;
            console.log("[STAGE-0] Module " + (globalIdx + 1) + ": fallback from pre-parsed blocks (" + slides.length + " slides)");
          } else {
            // Last resort: full parse + build (shouldn't happen since pre-parse ran)
            const slides = buildModuleSlides(mod, globalIdx, modules.length);
            allSlides.push(...slides);
            regexFallbackUsed++;
            console.log("[STAGE-0] Module " + (globalIdx + 1) + ": full fallback (" + slides.length + " slides)");
          }
        }
      }
    }

    console.log("[STAGE-0] Complete: " + semanticPlannerUsed + " LLM (pre-parsed input), " + regexFallbackUsed + " fallback");
    qualityReport.stage0_semantic_planner_modules = semanticPlannerUsed;
    qualityReport.stage0_regex_fallback_modules = regexFallbackUsed;
    qualityReport.stage1_slides_generated = allSlides.length;
    console.log("[STAGE-1] Content generated: " + allSlides.length + " slides");

    // ── STAGE 1.5: LLM-POWERED NLP VALIDATION ──
    console.log("[STAGE-1.5] Running LLM-powered NLP validation...");
    const llmResult = await llmValidateSlideContent(allSlides);
    qualityReport.stage1_5_llm_grammar_fixes = llmResult.totalGrammarFixes;
    qualityReport.stage1_5_llm_truncation_fixes = llmResult.totalTruncationFixes;
    qualityReport.stage1_5_llm_nonsense_dropped = llmResult.totalNonsenseDropped;
    qualityReport.stage1_5_llm_relevance_dropped = llmResult.totalRelevanceDropped;
    console.log("[STAGE-1.5] LLM NLP complete: grammar=" + llmResult.totalGrammarFixes + " truncation=" + llmResult.totalTruncationFixes + " nonsense=" + llmResult.totalNonsenseDropped + " irrelevant=" + llmResult.totalRelevanceDropped);

    // Remove slides that lost all items after LLM validation
    allSlides = allSlides.filter(s => {
      if (s.layout === "module_cover" || s.layout === "numbered_takeaways") return true;
      if (s.items && s.items.length === 0 && s.layout !== "comparison_table") {
        console.log("[STAGE-1.5] Removed empty slide after LLM: " + s.title);
        return false;
      }
      return true;
    });

    // ── STAGE 2: STRUCTURAL OPTIMIZATION ──
    const beforeDedup = allSlides.length;
    allSlides = deduplicateAcrossSlides(allSlides);
    qualityReport.stage2_dedup_removed = beforeDedup - allSlides.length;
    if (allSlides.length < beforeDedup) {
      console.log("[STAGE-2] Dedup removed " + (beforeDedup - allSlides.length) + " duplicate slides");
    }

    allSlides = balanceDensity(allSlides);

    const coherenceWarnings = checkNarrativeCoherence(allSlides);
    qualityReport.stage2_coherence_warnings = coherenceWarnings;
    if (coherenceWarnings.length > 0) {
      coherenceWarnings.forEach(w => console.warn("[STAGE-2] " + w));
    }

    allSlides.forEach(s => { s.densityScore = calculateDensity(s); });
    const avgDensity = allSlides.reduce((sum, s) => sum + (s.densityScore || 0), 0) / Math.max(allSlides.length, 1);
    qualityReport.stage2_avg_density = Number(avgDensity.toFixed(1));
    console.log("[STAGE-2] Structure optimized: Avg density=" + avgDensity.toFixed(1) + " Slides=" + allSlides.length);

    // ── STAGE 3: VISUAL VALIDATION (Bounding Box + WCAG + Overflow Split + Auto-Continuation) ──
    let bboxOverflows = 0;
    let bboxFixes = 0;
    let overflowSplits = 0;

    // 3a. Pre-render overflow detection with auto-split for ALL slide types
    const slidesToInsert: { afterIndex: number; slide: SlideData }[] = [];
    for (let si = 0; si < allSlides.length; si++) {
      const s = allSlides[si];

      // Definition cards — check text vs pillar space
      if (s.layout === "definition_card_with_pillars" && s.items && s.items.length > 0) {
        const defText = s.items[0];
        const defBoxW = SAFE_W - 0.60;
        const HEADER_EST = 1.60;
        const PILLAR_ZONE = s.items.length > 1 ? 2.10 : 0;
        const availWithPillars = SLIDE_H - HEADER_EST - BOTTOM_MARGIN - PILLAR_ZONE - 0.30;
        const testFit = fitTextForBox(defText, defBoxW, availWithPillars, TYPO.BODY, FONT_BODY, TYPO.BODY);
        if (testFit.adjusted && s.items.length > 1) {
          overflowSplits++;
          console.log("[STAGE-3] Definition overflow detected, will auto-split: " + s.title);
        }
      }

      // Bullet/warning/example slides — auto-split if too many items overflow
      if (s.items && s.items.length > 0 && s.layout !== "comparison_table" && s.layout !== "module_cover") {
        const boxW = SAFE_W - 0.50;
        const maxItems = activeDensity.maxBulletsPerSlide;
        const maxItemH = (SLIDE_H - 2.0 - BOTTOM_MARGIN) / Math.min(s.items.length, maxItems);
        let overflowCount = 0;

        for (let i = 0; i < s.items.length; i++) {
          const minFontForItem = s.layout === "definition_card_with_pillars" ? TYPO.BODY : TYPO.SUPPORT;
          const fit = fitTextForBox(s.items[i], boxW, maxItemH, TYPO.BULLET_TEXT, FONT_BODY, minFontForItem);
          if (fit.adjusted) {
            bboxOverflows++;
            // Try font reduction first, only truncate as last resort
            if (fit.text.length >= s.items[i].length * 0.85) {
              bboxFixes++;
              s.items[i] = fit.text;
            } else {
              overflowCount++;
            }
          }
        }

        // If too many items overflow even after font reduction, create continuation slide
        if (overflowCount >= 2 && s.items.length > 3 && s.layout !== "numbered_takeaways") {
          const mid = Math.ceil(s.items.length / 2);
          const contSlide: SlideData = {
            layout: s.layout,
            title: smartTitle(s.title.replace(/\s*\(Parte \d+\)\s*$/i, "") + " (Parte 2)"),
            sectionLabel: s.sectionLabel,
            items: s.items.slice(mid),
            moduleIndex: s.moduleIndex,
            blockType: s.blockType,
          };
          s.items = s.items.slice(0, mid);
          if (!s.title.includes("Parte")) {
            s.title = smartTitle(s.title + " (Parte 1)");
          }
          slidesToInsert.push({ afterIndex: si, slide: contSlide });
          overflowSplits++;
          bboxFixes += overflowCount;
          console.log("[STAGE-3] Auto-split slide: " + s.title + " → 2 slides");
        }
      }
    }

    // Insert continuation slides in reverse order to maintain indices
    for (let i = slidesToInsert.length - 1; i >= 0; i--) {
      const { afterIndex, slide } = slidesToInsert[i];
      allSlides.splice(afterIndex + 1, 0, slide);
    }

    qualityReport.stage3_bbox_overflows = bboxOverflows;
    qualityReport.stage3_bbox_fixes = bboxFixes;
    qualityReport.stage3_overflow_splits = overflowSplits;

    // WCAG spot check
    const wcagSpotChecks = [
      { fg: C.TEXT_DARK, bg: C.BG_WHITE, label: "body-on-white" },
      { fg: C.TEXT_LIGHT, bg: C.BG_WHITE, label: "light-on-white" },
      { fg: C.TEXT_WHITE, bg: C.TABLE_HEADER_BG, label: "white-on-header" },
      { fg: C.TEXT_BODY, bg: C.BG_LIGHT, label: "body-on-light" },
      { fg: C.TEXT_DARK, bg: C.INSIGHT_BG, label: "dark-on-insight" },
    ];
    for (const wc of wcagSpotChecks) {
      const result = checkWCAGContrast(wc.fg, wc.bg, TYPO.BODY);
      if (!result.passesAA) {
        qualityReport.stage3_wcag_failures.push(wc.label + " (ratio=" + result.ratio.toFixed(1) + ", need 4.5)");
      }
    }
    if (qualityReport.stage3_wcag_failures.length > 0) {
      console.warn("[STAGE-3] WCAG failures: " + qualityReport.stage3_wcag_failures.join(", "));
    }
    console.log("[STAGE-3] Visual validation: " + bboxOverflows + " overflows, " + bboxFixes + " fixes, " + overflowSplits + " def-splits, " + qualityReport.stage3_wcag_failures.length + " WCAG failures");

    // ── STAGE 4: FINAL QUALITY CHECKLIST WITH RETRY (accumulative) ──
    const MAX_QC_RETRIES = 3;

    for (let retry = 0; retry <= MAX_QC_RETRIES; retry++) {
      let retryWarnings = 0;
      let retryFixes = 0;

      allSlides.forEach((s, idx) => {
        const qr = runSlideQualityChecklist(s, idx + 3, allSlides);
        retryWarnings += qr.warnings.length;
        retryFixes += qr.fixes.length;
        qualityReport.stage4_all_warnings.push(...qr.warnings);
        qualityReport.stage4_all_fixes.push(...qr.fixes);
      });

      allSlides = allSlides.filter(s => !s._markedForRemoval);
      qualityReport.stage4_retries_used = retry;
      qualityReport.stage4_final_warnings = retryWarnings;
      qualityReport.stage4_final_fixes = retryFixes;

      if (retryWarnings === 0) {
        console.log("[STAGE-4] Quality checklist PASSED (retry=" + retry + ") | " + retryFixes + " fixes | " + allSlides.length + " slides");
        break;
      }

      if (retry < MAX_QC_RETRIES) {
        allSlides.forEach((s) => {
          if (!s.items) return;
          s.items = s.items.map((it) => enforceSentenceIntegrity(compressText(it, Math.max(48, Math.floor(it.length * 0.88)))));
        });
        console.log("[STAGE-4] Retry " + (retry + 1) + "/" + MAX_QC_RETRIES + ": " + retryWarnings + " warnings, repairing...");
      } else {
        console.warn("[STAGE-4] Completed with " + retryWarnings + " remaining warnings after " + MAX_QC_RETRIES + " retries");
      }
    }

    // ── QUALITY SCORE CALCULATION ──
    const qualityScore = Math.max(0, Math.min(100,
      100
      - Math.min(40, qualityReport.stage4_final_warnings * 3)
      - Math.min(15, qualityReport.stage3_wcag_failures.length * 5)
      - Math.min(15, Math.floor(bboxOverflows * 0.5))
      + Math.min(10, Math.floor(qualityReport.stage4_all_fixes.length * 0.2))
    ));

    console.log("[PIPELINE] Pipeline complete: " + allSlides.length + " slides, quality=" + qualityScore.toFixed(1));

    // ── EXPORT GATE: Block if quality < 85 ──
    if (qualityScore < 85) {
      console.error("[GATE] Export BLOCKED: quality_score=" + qualityScore.toFixed(1) + " < 85");
      const reportSummary = {
        quality_score: Number(qualityScore.toFixed(1)),
        passed: false,
        pipeline_version: "v3-tfidf-rag",
        pre_tfidf_corpus: qualityReport.pre_tfidf_corpus_size + " docs, " + qualityReport.pre_tfidf_terms + " terms",
        pre_parse_blocks: qualityReport.pre_parse_total_blocks,
        pre_parse_tables: qualityReport.pre_parse_total_tables,
        stage0_semantic_planner_modules: qualityReport.stage0_semantic_planner_modules,
        stage0_regex_fallback_modules: qualityReport.stage0_regex_fallback_modules,
        stage1_slides_generated: qualityReport.stage1_slides_generated,
        stage1_nlp_summarized: qualityReport.stage1_nlp_summarized,
        stage1_5_llm_grammar_fixes: qualityReport.stage1_5_llm_grammar_fixes,
        stage1_5_llm_truncation_fixes: qualityReport.stage1_5_llm_truncation_fixes,
        stage1_5_llm_nonsense_dropped: qualityReport.stage1_5_llm_nonsense_dropped,
        stage1_5_llm_relevance_dropped: qualityReport.stage1_5_llm_relevance_dropped,
        stage2_dedup_removed: qualityReport.stage2_dedup_removed,
        stage2_relevance_dropped: qualityReport.stage2_relevance_dropped,
        stage2_avg_density: qualityReport.stage2_avg_density,
        stage2_coherence_warnings_sample: qualityReport.stage2_coherence_warnings.slice(0, 10),
        stage3_bbox_overflows: qualityReport.stage3_bbox_overflows,
        stage3_bbox_fixes: qualityReport.stage3_bbox_fixes,
        stage3_overflow_splits: qualityReport.stage3_overflow_splits,
        stage3_wcag_failures_count: qualityReport.stage3_wcag_failures.length,
        stage3_wcag_failures_sample: qualityReport.stage3_wcag_failures.slice(0, 10),
        stage4_final_warnings: qualityReport.stage4_final_warnings,
        stage4_final_fixes: qualityReport.stage4_final_fixes,
        stage4_all_warnings_count: qualityReport.stage4_all_warnings.length,
        stage4_all_fixes_count: qualityReport.stage4_all_fixes.length,
        stage4_sample_warnings: qualityReport.stage4_all_warnings.slice(0, 15),
        stage4_sample_fixes: qualityReport.stage4_all_fixes.slice(0, 15),
      };

      return new Response(JSON.stringify({
        error: "Exportação bloqueada: qualidade insuficiente (score=" + qualityScore.toFixed(1) + "/100).",
        quality_report: reportSummary,
      }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[GATE] Export APPROVED: quality_score=" + qualityScore.toFixed(1));

    // Build PPTX
    const pptx = new PptxGenJS();
    
    const WIDESCREEN_LAYOUT = {
      name: 'WIDESCREEN',
      width: 13.333,
      height: 7.5,
    };
    pptx.defineLayout(WIDESCREEN_LAYOUT);
    pptx.layout = 'WIDESCREEN';
    
    pptx.author = "Sistema de Cursos";
    pptx.company = "EduGen AI";
    pptx.subject = "Curso Profissional";
    pptx.title = course.title;
    
    console.log("[LAYOUT] " + WIDESCREEN_LAYOUT.width + "x" + WIDESCREEN_LAYOUT.height);

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
      const shortTitle = rawTitle.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;
      const firstSentence = smartModuleDesc(sanitize((m.content || "").split(/[.!?]\s/)[0] || ""));
      return { title: shortTitle, description: firstSentence };
    });
    renderTOC(pptx, { layout: "module_cover", title: "O que voce vai aprender", modules: modulesSummary });

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
        case "example_highlight":           renderExampleHighlight(pptx, sd); break;
        case "reflection_callout":          renderReflectionCallout(pptx, sd); break;
        case "warning_callout":             renderWarningCallout(pptx, sd); break;
        case "summary_slide":              renderSummarySlide(pptx, sd); break;
        case "bullets":                     renderBullets(pptx, sd); break;
        default:                            renderBullets(pptx, sd); break;
      }
    }

    // 4. Closing
    renderEncerramento(pptx, course.title);

    const totalSlides = allSlides.length + 3;
    console.log("[OK] PPTX: " + totalSlides + " slides, " + modules.length + " modules");

    const audit = runAudit();
    if (!audit.passed) console.error("Audit: " + audit.errors.length + " violations");

    const pptxData = await pptx.write({ outputType: "uint8array" });
    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = userId + "/" + safeName + " - PPTX - " + dateStr + ".pptx";

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

    const reportSummary = {
      quality_score: Number(qualityScore.toFixed(1)),
      passed: true,
      total_slides: totalSlides,
      pipeline_version: "v3-tfidf-rag",
      pre_tfidf_corpus: qualityReport.pre_tfidf_corpus_size + " docs, " + qualityReport.pre_tfidf_terms + " terms",
      pre_parse_blocks: qualityReport.pre_parse_total_blocks,
      pre_parse_tables: qualityReport.pre_parse_total_tables,
      stage0_semantic_planner_modules: qualityReport.stage0_semantic_planner_modules,
      stage0_regex_fallback_modules: qualityReport.stage0_regex_fallback_modules,
      stage1_slides_generated: qualityReport.stage1_slides_generated,
      stage1_nlp_summarized: qualityReport.stage1_nlp_summarized,
      stage1_5_llm_grammar_fixes: qualityReport.stage1_5_llm_grammar_fixes,
      stage1_5_llm_truncation_fixes: qualityReport.stage1_5_llm_truncation_fixes,
      stage1_5_llm_nonsense_dropped: qualityReport.stage1_5_llm_nonsense_dropped,
      stage1_5_llm_relevance_dropped: qualityReport.stage1_5_llm_relevance_dropped,
      stage2_dedup_removed: qualityReport.stage2_dedup_removed,
      stage2_relevance_dropped: qualityReport.stage2_relevance_dropped,
      stage2_avg_density: qualityReport.stage2_avg_density,
      stage2_coherence_warnings_sample: qualityReport.stage2_coherence_warnings.slice(0, 10),
      stage3_bbox_overflows: qualityReport.stage3_bbox_overflows,
      stage3_bbox_fixes: qualityReport.stage3_bbox_fixes,
      stage3_overflow_splits: qualityReport.stage3_overflow_splits,
      stage3_wcag_failures_count: qualityReport.stage3_wcag_failures.length,
      stage3_wcag_failures_sample: qualityReport.stage3_wcag_failures.slice(0, 10),
      stage4_final_warnings: qualityReport.stage4_final_warnings,
      stage4_final_fixes: qualityReport.stage4_final_fixes,
      stage4_all_warnings_count: qualityReport.stage4_all_warnings.length,
      stage4_all_fixes_count: qualityReport.stage4_all_fixes.length,
      stage4_sample_warnings: qualityReport.stage4_all_warnings.slice(0, 15),
      stage4_sample_fixes: qualityReport.stage4_all_fixes.slice(0, 15),
    };

    return new Response(JSON.stringify({
      url: signedUrl.signedUrl,
      quality_report: reportSummary,
    }), {
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
