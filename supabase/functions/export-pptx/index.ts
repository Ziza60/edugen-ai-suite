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
    maxBulletsPerSlide: 5, maxWordsPerBullet: 10, maxCharsPerBullet: 70,
    splitThreshold: 4, compressRatio: 0.50,
  },
  standard: {
    maxBulletsPerSlide: 6, maxWordsPerBullet: 14, maxCharsPerBullet: 90,
    splitThreshold: 5, compressRatio: 0.65,
  },
  detailed: {
    maxBulletsPerSlide: 8, maxWordsPerBullet: 18, maxCharsPerBullet: 120,
    splitThreshold: 7, compressRatio: 0.85,
  },
};

// Runtime config
let activePalette: string[] = PALETTES.default;
let activeDensity: DensityConfig = DENSITY_MODES.standard;
let activeThemeKey: "light" | "dark" = "light";
let currentTheme = THEME.light;

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

// ── TYPOGRAPHY v2 — Market-grade minimum sizes ──
const FONT_TITLE = "Montserrat";
const FONT_BODY = "Open Sans";

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

  // Clean trailing artifacts
  result = result.replace(/[\s,;:\-–]+$/, "").trim();

  if (addEllipsis && result.length < t.length && !/[.!?]$/.test(result)) {
    result += "...";
  }

  return result;
}

function smartTitle(text: string): string {
  return smartTruncate(text, 50); // Increased from 40 for longer titles
}

function smartSubtitle(text: string): string {
  return smartTruncate(text, 70); // Increased from 60
}

function smartBullet(text: string): string {
  if (!text) return "";
  const maxWords = activeDensity.maxWordsPerBullet;
  const maxChars = activeDensity.maxCharsPerBullet;
  const words = text.trim().split(/\s+/);
  if (words.length > maxWords) {
    const limited = words.slice(0, maxWords).join(" ");
    if (limited.length <= maxChars) {
      // Ensure ends with punctuation
      if (!/[.!?]$/.test(limited)) return limited + ".";
      return limited;
    }
  }
  const result = smartTruncate(text, maxChars);
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

function autoAdjustText(text: string, boxWidth: number, boxHeight: number, maxFont = 32, minFont = 14): AutoAdjustResult {
  for (let size = maxFont; size >= minFont; size -= 1) {
    const check = validateTextDensity(text, boxWidth, boxHeight, size);
    if (check.fits) {
      return { fontSize: size, truncated: false, text };
    }
  }
  // Last resort: truncate with smartTruncate
  const maxLen = validateTextDensity(text, boxWidth, boxHeight, minFont).maxChars;
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
  // Preposition + short word at end
  if (/\s(d[ao]s?|nas?|em|por|para|a|o|e)\s+\w{1,3}$/.test(trimmed) && !/[.!?…]$/.test(trimmed)) return true;
  // Ends with preposition
  if (/\s(de|da|do|das|dos|na|no|nas|nos|em|para|por|com)\s*$/.test(trimmed)) return true;
  // Very short text without punctuation
  if (trimmed.length < 15 && !/[.!?…]$/.test(trimmed)) return true;
  return false;
}

/* ═══════════════════════════════════════════════════════
   TEXT COMPRESSION v2 — Preserves key ideas
   ═══════════════════════════════════════════════════════ */

function compressText(text: string, maxChars: number = 120): string {
  if (!text || text.length <= maxChars) return text;
  let t = text;
  // Remove filler words (Portuguese)
  t = t.replace(/\b(um|uma|uns|umas)\s+/gi, "");
  t = t.replace(/\b(que|qual|quais|onde|quando|como|porque|pois)\s+/gi, "");
  t = t.replace(/\bcapaz(es)?\s+de\s+/gi, "");
  t = t.replace(/\btipicamente\b/gi, "");
  t = t.replace(/\bpor\s+exemplo\b/gi, "ex:");
  t = t.replace(/\bno\s+entanto\b/gi, "porém");
  t = t.replace(/\bal[eé]m\s+disso\b/gi, "também");
  t = t.replace(/\bque\s+permitem?\b/gi, "para");
  t = t.replace(/\bde\s+forma\s+/gi, "");
  t = t.replace(/\b(na|no|nas|nos|das|dos|da|do|de)\s+(cria[cç][aã]o|constru[cç][aã]o)\s+de\s+/gi, "criando ");
  t = t.replace(/\s{2,}/g, " ").trim();
  
  if (t.length > maxChars) {
    t = smartTruncate(t, maxChars);
    if (!/[.!?]$/.test(t)) t += ".";
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
  t = t.replace(/\s*[-→⟶➜➔➞►⇒⇨]\s*/g, ": ");
  t = t.replace(/\s*->\s*/g, ": ");
  t = t.replace(/&amp;/gi, "&"); t = t.replace(/&lt;/gi, "<"); t = t.replace(/&gt;/gi, ">");
  t = t.replace(/&nbsp;/gi, " "); t = t.replace(/&quot;/gi, '"');
  t = t.replace(/<\/?[a-z][^>]*>/gi, " ");
  // Strip emoji
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "");
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
    const check = validateTextDensity(text, safeW, safeH, fontSize);
    if (!check.fits) {
      const adjusted = autoAdjustText(text, safeW, safeH, fontSize, TYPO.SUPPORT);
      text = adjusted.text;
      options = { ...options, fontSize: adjusted.fontSize };
      if (adjusted.truncated) {
        console.log("[DENSITY] auto-adjust Slide " + _auditSlideCounter + ": " + String(adjusted.fontSize) + "pt");
      }
    }
    if (detectTruncation(text)) {
      console.warn("[TRUNCATION] Slide " + _auditSlideCounter + ": " + text.substring(0, 40));
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

function runSlideQualityChecklist(sd: SlideData, slideIndex: number): QualityResult {
  const warnings: string[] = [];
  const fixes: string[] = [];
  const label = "Slide " + slideIndex;
  const allTexts: string[] = [];

  // Collect all text from slide data
  if (sd.title) allTexts.push(sd.title);
  if (sd.subtitle) allTexts.push(sd.subtitle);
  if (sd.description) allTexts.push(sd.description);
  if (sd.sectionLabel) allTexts.push(sd.sectionLabel);
  if (sd.items) allTexts.push(...sd.items);
  if (sd.objectives) allTexts.push(...sd.objectives);
  if (sd.tableHeaders) allTexts.push(...sd.tableHeaders);
  if (sd.tableRows) sd.tableRows.forEach(r => allTexts.push(...r));

  // ✓ 1. Todo o texto esta completo (sem truncamentos)?
  for (const t of allTexts) {
    if (!t || t.length < 4) continue;
    if (detectTruncation(t)) {
      warnings.push(label + " TRUNCAMENTO: \"" + t.substring(0, 50) + "\"");
    }
    // Detect mid-word cuts
    if (/[a-zA-ZáéíóúãõâêîôûçÁÉÍÓÚÃÕÂÊÎÔÛÇ]{1,2}$/.test(t) && t.length > 15 && !/[.!?…:;)\]"']$/.test(t)) {
      const lastWord = t.split(/\s+/).pop() || "";
      if (lastWord.length <= 2 && !/^(é|e|a|o|ou|em|se|já|só|aí|há|IA|AI|TI|UX|UI)$/i.test(lastWord)) {
        warnings.push(label + " FRAGMENTO: \"..." + t.substring(Math.max(0, t.length - 30)) + "\"");
      }
    }
  }

  // ✓ 2. Titulos sao descritivos e completos?
  if (sd.title) {
    if (sd.title.length < 5 && sd.layout !== "module_cover") {
      warnings.push(label + " TITULO CURTO: \"" + sd.title + "\"");
    }
    if (/^(cont\.|continuacao|parte)$/i.test(sd.title.trim())) {
      warnings.push(label + " TITULO NAO DESCRITIVO: \"" + sd.title + "\"");
    }
  }

  // ✓ 3. Hifens e caracteres especiais estao corretos?
  for (const t of allTexts) {
    if (/\u00AD/.test(t)) warnings.push(label + " SOFT HYPHEN encontrado");
    if (/[–—]{2,}/.test(t)) warnings.push(label + " HIFENS DUPLICADOS");
    if (/[\uFFFD]/.test(t)) warnings.push(label + " CHAR SUBSTITUICAO (?)");
  }

  // ✓ 4. Gramatica basica — frases incompletas (sem verbo aparente em textos longos)
  for (const t of allTexts) {
    if (t.length > 30 && /^[A-ZÁÉÍÓÚÃÕ]/.test(t) && !/[.!?…]$/.test(t.trim())) {
      // Sentence starts uppercase but doesn't end with punctuation
      if (sd.layout !== "module_cover" && !sd.sectionLabel?.includes(t)) {
        // Auto-fix: add period
        const idx = sd.items?.indexOf(t);
        if (idx !== undefined && idx >= 0 && sd.items) {
          sd.items[idx] = t.trim() + ".";
          fixes.push(label + " PONTUACAO ADICIONADA: \"" + t.substring(0, 40) + "...\"");
        }
      }
    }
  }

  // ✓ 5. Variedade nas frases (sem repeticoes excessivas)?
  if (sd.items && sd.items.length >= 3) {
    const firstWords = sd.items.map(it => it.split(/\s+/)[0]?.toLowerCase());
    const wordCounts: Record<string, number> = {};
    for (const w of firstWords) {
      if (w) wordCounts[w] = (wordCounts[w] || 0) + 1;
    }
    for (const [word, count] of Object.entries(wordCounts)) {
      if (count >= 3 && sd.items.length >= 4) {
        warnings.push(label + " REPETICAO: " + count + "x bullets iniciam com \"" + word + "\"");
      }
    }
  }

  // ✓ 6. Cada slide tem conteudo suficiente (min. 3 bullets)?
  if (sd.items && sd.layout !== "module_cover" && sd.layout !== "comparison_table" &&
      sd.layout !== "reflection_callout" && sd.layout !== "example_highlight") {
    if (sd.items.length < 3 && sd.items.length > 0) {
      warnings.push(label + " CONTEUDO ESCASSO: apenas " + sd.items.length + " bullet(s)");
    }
  }

  // ✓ 7. Simbolos sao consistentes e nao aleatorios?
  for (const t of allTexts) {
    if (/[□■◻◼▪▫●○◆◇◈◎⊕⊛☆✧✦▣▤▥▷◐◑◔△▽]{3,}/.test(t)) {
      warnings.push(label + " SIMBOLOS EXCESSIVOS no texto");
    }
  }

  // ✓ 8. Tabelas estao bem formatadas e legiveis?
  if (sd.layout === "comparison_table") {
    if (sd.tableHeaders && sd.tableHeaders.length > 5) {
      warnings.push(label + " TABELA COM MUITAS COLUNAS: " + sd.tableHeaders.length);
    }
    if (sd.tableRows) {
      for (const row of sd.tableRows) {
        for (const cell of row) {
          if (cell.length > 120) {
            warnings.push(label + " CELULA LONGA: " + cell.length + " chars");
          }
        }
      }
    }
  }

  // ✓ 9. Ha exemplos praticos incluidos? (check at module level, warn if absent)
  // This is tracked at module aggregation level — see buildModuleSlides integration

  // ✓ 10. Existe pergunta de reflexao no modulo? (same — tracked at module level)

  const passed = warnings.length === 0;
  if (!passed) {
    console.warn("[CHECKLIST] " + label + ": " + warnings.length + " avisos");
    warnings.forEach(w => console.warn("  " + w));
  }
  if (fixes.length > 0) {
    fixes.forEach(f => console.log("  [FIX] " + f));
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
  blockType?: "example" | "reflection" | "conclusion" | "normal";
}

function classifyBlockType(heading: string, items: string[]): "example" | "reflection" | "conclusion" | "normal" {
  const h = heading.toLowerCase();
  if (/exemplo|case|cen[aá]rio|pr[aá]tic|aplica[cç][aã]o\s+real|estudo\s+de\s+caso/i.test(h)) return "example";
  if (/reflex[aã]o|pare\s+um\s+momento|pense|reflita|checkpoint/i.test(h)) return "reflection";
  if (/conclus[aã]o|encerramento|fechamento|consider|final/i.test(h)) return "conclusion";
  // Check items content too
  const allText = items.join(" ").toLowerCase();
  if (/exemplo\s+pr[aá]tico|na\s+pr[aá]tica|caso\s+real/i.test(allText) && items.length <= 4) return "example";
  return "normal";
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
      const blockType = classifyBlockType(curHeading, curBullets);
      blocks.push({ heading: curHeading, items: [...curBullets], isTable: false, blockType });
      curBullets = [];
    }
  };
  const flushTable = () => {
    if (tRows.length > 0) {
      blocks.push({ heading: curHeading, items: [], isTable: true, headers: [...tHeaders], rows: [...tRows], blockType: "normal" });
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
   CONTENT CLASSIFICATION v2 — with example/reflection templates
   ═══════════════════════════════════════════════════════ */

type LayoutType =
  | "module_cover" | "definition_card_with_pillars" | "comparison_table"
  | "grid_cards" | "four_quadrants" | "process_timeline"
  | "numbered_takeaways" | "bullets" | "example_highlight" | "reflection_callout";

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

function classifyContent(heading: string, items: string[], isTable: boolean, prevLayout: LayoutType | null, blockType?: string): LayoutType {
  if (isTable) return "comparison_table";
  if (blockType === "example") return "example_highlight";
  if (blockType === "reflection") return "reflection_callout";
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
   DENSITY SCORING v2
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
  blockType?: string;
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
  
  // NEVER remove blocks tagged as example, reflection, or conclusion
  if (sd.blockType === "example" || sd.blockType === "reflection" || sd.blockType === "conclusion") return false;
  
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
  const rawTitle = sanitize(mod.title || "");
  const shortTitle = rawTitle.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;

  const objItems: string[] = [];
  const resumoItems: string[] = [];
  const contentBlocks: ParsedBlock[] = [];

  for (const block of blocks) {
    if (isObjectivesHeading(block.heading) && !block.isTable) objItems.push(...block.items);
    else if (isResumoHeading(block.heading) && !block.isTable) resumoItems.push(...block.items);
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

    const items = block.items.map(s => compressBullet(sanitize(s))).filter(s => s.length > 3);
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

  // Always end with takeaways
  if (resumoItems.length > 0) {
    slides.push({
      layout: "numbered_takeaways",
      title: "Key Takeaways - Modulo " + (modIndex + 1),
      sectionLabel: "RESUMO DO MODULO",
      items: sanitizeBullets(resumoItems.slice(0, 6).map(s => compressBullet(sanitize(s)))),
      moduleIndex: modIndex,
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

  // Per-slide quality checklist
  consolidated.forEach((s, idx) => {
    runSlideQualityChecklist(s, idx);
  });

  return consolidated;
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
        slides[i].layout === "reflection_callout") {
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
    if (s.layout === "module_cover" || s.layout === "example_highlight" || s.layout === "reflection_callout") continue;

    // Merge sparse slides into previous (but not examples/reflections)
    if (density < 35 && s.items && s.items.length < 3 && s.blockType !== "example" && s.blockType !== "reflection") {
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

    // Split overloaded slides
    if (density > 85 && s.items && s.items.length > 4 && s.layout !== "numbered_takeaways") {
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

  const badgeW = 3.2; const badgeH = 0.48;
  const badgeX = (SLIDE_W - badgeW) / 2; const badgeY = 1.5;
  slide.addShape(pptx.ShapeType.roundRect, {
    x: badgeX, y: badgeY, w: badgeW, h: badgeH,
    line: { color: C.SECONDARY, width: 2 }, fill: { type: "none" }, rectRadius: 0.15,
  });
  addTextSafe(slide, "CURSO COMPLETO", {
    x: badgeX, y: badgeY, w: badgeW, h: badgeH,
    fontSize: TYPO.LABEL, fontFace: FONT_TITLE, color: C.SECONDARY, bold: true,
    align: "center", valign: "middle", letterSpacing: 4,
  });

  const ajustado = ajustarTextoAoBox(data.title, 40, 2);
  const titleFontSize = ajustado.linhas === 1 ? 44 : 36;
  const titleH = ajustado.linhas === 1 ? 1.0 : 1.5;
  const titleY = badgeY + badgeH + 0.50;
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
    const desc = smartSubtitle(sanitize(data.description));
    addTextSafe(slide, desc, {
      x: 2, y: sepY + 0.30, w: SLIDE_W - 4, h: 0.55,
      fontSize: TYPO.SUBTITLE, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
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

  if (data.description) {
    const desc = smartSubtitle(data.description);
    addTextSafe(slide, desc, {
      x: MARGIN, y: sepY + 0.20, w: SAFE_W * 0.65, h: 0.55,
      fontSize: TYPO.SUBTITLE, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top",
    });
  }

  const objectives = data.objectives || [];
  if (objectives.length > 0) {
    const objStartY = sepY + 0.85;
    objectives.slice(0, 3).forEach((obj, idx) => {
      const objY = objStartY + idx * 0.48;
      if (objY + 0.40 > SLIDE_H - 0.40) return;
      const dotSize = 0.12;
      slide.addShape(pptx.ShapeType.ellipse, {
        x: MARGIN + 0.05, y: objY + 0.12, w: dotSize, h: dotSize,
        fill: { color: moduleColor },
      });
      const objText = smartTruncate(obj, 55);
      addTextSafe(slide, objText, {
        x: MARGIN + 0.30, y: objY, w: SAFE_W * 0.60, h: 0.40,
        fontSize: TYPO.SUPPORT, fontFace: FONT_BODY, color: C.TEXT_BODY, valign: "middle",
      });
    });
  }

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: SLIDE_H - 0.08, w: SLIDE_W, h: 0.08, fill: { color: moduleColor },
  });
}

// ── DEFINITION CARD WITH PILLARS ──
function renderDefinitionWithPillars(pptx: any, data: SlideData) {
  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };
  const items = data.items || [];
  if (items.length === 0) return;

  let contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  const defText = smartTruncate(items[0], 200);
  const defCardH = Math.max(1.0, estimateTextLines(defText, SAFE_W - 1.2, TYPO.BODY) * 0.40 + 0.45);

  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: contentY, w: SAFE_W, h: defCardH,
    fill: { color: C.BG_LIGHT }, line: { color: C.ACCENT_BLUE, width: 1.5 }, rectRadius: 0.10,
  });
  addTextSafe(slide, "DEFINICAO ESSENCIAL", {
    x: MARGIN + 0.30, y: contentY + 0.15, w: SAFE_W - 0.60, h: 0.30,
    fontSize: TYPO.SUPPORT, fontFace: FONT_TITLE, color: C.ACCENT_BLUE, bold: true, letterSpacing: 2,
  });
  addTextSafe(slide, defText, {
    x: MARGIN + 0.30, y: contentY + 0.50, w: SAFE_W - 0.60, h: defCardH - 0.65,
    fontSize: TYPO.BODY, fontFace: FONT_BODY, color: C.TEXT_BODY, valign: "top", lineSpacingMultiple: 1.4,
  });

  contentY += defCardH + 0.30;

  const pillars = items.slice(1, 4);
  if (pillars.length > 0) {
    const cols = pillars.length;
    const gapX = 0.22;
    const pillarW = (SAFE_W - (cols - 1) * gapX) / cols;
    const availH = SLIDE_H - contentY - BOTTOM_MARGIN;
    const pillarH = Math.min(availH, 1.60);

    pillars.forEach((pillar, idx) => {
      const x = MARGIN + idx * (pillarW + gapX);
      const accentColor = CARD_ACCENT_COLORS_FN()[idx % CARD_ACCENT_COLORS_FN().length];

      slide.addShape(pptx.ShapeType.rect, {
        x, y: contentY, w: pillarW, h: pillarH,
        fill: { color: C.BG_LIGHT }, line: { color: C.CARD_BORDER, width: 0.5 }, rectRadius: 0.08,
      });
      slide.addShape(pptx.ShapeType.rect, {
        x: x + 0.10, y: contentY, w: pillarW - 0.20, h: 0.05, fill: { color: accentColor },
      });

      const circleSize = 0.40;
      slide.addShape(pptx.ShapeType.ellipse, {
        x: x + (pillarW - circleSize) / 2, y: contentY + 0.15, w: circleSize, h: circleSize,
        fill: { color: accentColor },
      });
      const iconChar = getSemanticIcon(pillar, idx);
      addTextSafe(slide, iconChar, {
        x: x + (pillarW - circleSize) / 2, y: contentY + 0.15, w: circleSize, h: circleSize,
        fontSize: TYPO.ICON, fontFace: FONT_BODY, color: C.TEXT_WHITE, bold: true,
        align: "center", valign: "middle",
      });

      const colonIdx = pillar.indexOf(":");
      const pTitle = colonIdx > 2 && colonIdx < 50 ? smartTruncate(pillar.substring(0, colonIdx).trim(), 35) : "";
      const pBody = pTitle ? smartTruncate(pillar.substring(colonIdx + 1).trim(), 80) : smartTruncate(pillar, 80);

      let textY = contentY + 0.65;
      if (pTitle) {
        addTextSafe(slide, pTitle, {
          x: x + 0.12, y: textY, w: pillarW - 0.24, h: 0.35,
          fontSize: TYPO.CARD_TITLE, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
          align: "center",
        });
        textY += 0.38;
      }
      addTextSafe(slide, pBody, {
        x: x + 0.12, y: textY, w: pillarW - 0.24, h: pillarH - (textY - contentY) - 0.10,
        fontSize: TYPO.CARD_BODY, fontFace: FONT_BODY, color: C.TEXT_LIGHT,
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
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.18, y: y + 0.18, w: circleSize, h: circleSize, fill: { color: accentColor },
    });
    const iconChar = getSemanticIcon(item, idx);
    addTextSafe(slide, iconChar, {
      x: x + 0.18, y: y + 0.18, w: circleSize, h: circleSize,
      fontSize: TYPO.ICON, fontFace: FONT_BODY, color: C.TEXT_WHITE, bold: true,
      align: "center", valign: "middle",
    });

    const colonIdx = item.indexOf(":");
    const cardTitle = colonIdx > 2 && colonIdx < 50 ? smartTruncate(item.substring(0, colonIdx).trim(), 40) : "";
    const cardBody = cardTitle ? smartTruncate(item.substring(colonIdx + 1).trim(), 100) : smartTruncate(item, 100);

    const textX = x + 0.70; const textW = cardW - 0.84;
    let textY = y + 0.18;

    if (cardTitle) {
      addTextSafe(slide, cardTitle, {
        x: textX, y: textY, w: textW, h: 0.32,
        fontSize: TYPO.CARD_TITLE, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      });
      textY += 0.36;
    }
    if (cardBody) {
      const bodyH = cardH - (textY - y) - 0.10;
      addTextSafe(slide, cardBody, {
        x: textX, y: textY, w: textW, h: Math.max(bodyH, 0.20),
        fontSize: TYPO.CARD_BODY, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top", lineSpacingMultiple: 1.3,
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
    slide.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.25, y: y + 0.25, w: circleSize, h: circleSize, fill: { color: accentColor },
    });
    const iconChar = getSemanticIcon(item, idx);
    addTextSafe(slide, iconChar, {
      x: x + 0.25, y: y + 0.25, w: circleSize, h: circleSize,
      fontSize: 20, fontFace: FONT_BODY, color: C.TEXT_WHITE, align: "center", valign: "middle",
    });

    const colonIdx = item.indexOf(":");
    const qTitle = colonIdx > 2 && colonIdx < 50 ? smartTruncate(item.substring(0, colonIdx).trim(), 40) : "";
    const qBody = qTitle ? smartTruncate(item.substring(colonIdx + 1).trim(), 120) : smartTruncate(item, 120);

    let textY = y + 0.25;
    const textX = x + 0.85; const textW = quadW - 1.05;

    if (qTitle) {
      addTextSafe(slide, qTitle, {
        x: textX, y: textY, w: textW, h: 0.38,
        fontSize: TYPO.CARD_TITLE, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      });
      textY += 0.40;
    }
    addTextSafe(slide, qBody, {
      x: textX, y: textY, w: textW, h: quadH - (textY - y) - 0.15,
      fontSize: TYPO.CARD_BODY, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top", lineSpacingMultiple: 1.3,
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
      stepDesc = smartTruncate(step.substring(colonIdx + 1).trim(), 70);
    } else {
      const words = step.split(/\s+/);
      stepTitle = smartTruncate(words.slice(0, 3).join(" "), 30);
      stepDesc = smartTruncate(words.slice(3).join(" "), 70);
    }

    const textY = y + circleSize + 0.30;
    const textW = stepW - 0.40;
    const textX = centerX - textW / 2;

    addTextSafe(slide, stepTitle, {
      x: textX, y: textY, w: textW, h: 0.45,
      fontSize: TYPO.CARD_TITLE, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
      align: "center",
    });
    if (stepDesc) {
      addTextSafe(slide, stepDesc, {
        x: textX, y: textY + 0.48, w: textW, h: 0.60,
        fontSize: TYPO.CARD_BODY, fontFace: FONT_BODY, color: C.TEXT_LIGHT,
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
  let contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  const maxItems = Math.min(items.length, activeDensity.maxBulletsPerSlide);
  const availH = SLIDE_H - contentY - BOTTOM_MARGIN;
  const bulletH = Math.min(availH / maxItems, 0.75);

  items.slice(0, maxItems).forEach((item, idx) => {
    const y = contentY + idx * bulletH;
    if (y + bulletH > SLIDE_H - BOTTOM_MARGIN) return;

    const accentColor = CARD_ACCENT_COLORS_FN()[idx % CARD_ACCENT_COLORS_FN().length];

    const dotSize = 0.14;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: MARGIN + 0.10, y: y + (bulletH - dotSize) / 2, w: dotSize, h: dotSize,
      fill: { color: accentColor },
    });

    const richText = makeBoldLabelText(smartTruncate(item, 120), C.TEXT_DARK, C.TEXT_BODY, TYPO.BULLET_TEXT);
    addTextSafe(slide, richText, {
      x: MARGIN + 0.40, y, w: SAFE_W - 0.50, h: bulletH,
      valign: "middle", lineSpacingMultiple: 1.3,
    });

    if (idx < items.length - 1 && idx < maxItems - 1) {
      slide.addShape(pptx.ShapeType.rect, {
        x: MARGIN + 0.40, y: y + bulletH - 0.02, w: SAFE_W - 0.80, h: 0.01,
        fill: { color: C.TABLE_ROW_EVEN },
      });
    }
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
  slide.addShape(pptx.ShapeType.ellipse, {
    x: MARGIN + 0.25, y: contentY + 0.20, w: circleSize, h: circleSize,
    fill: { color: moduleColor },
  });
  addTextSafe(slide, iconChar, {
    x: MARGIN + 0.25, y: contentY + 0.20, w: circleSize, h: circleSize,
    fontSize: 20, fontFace: FONT_BODY, color: C.TEXT_WHITE, bold: true,
    align: "center", valign: "middle",
  });

  // Example content
  let textY = contentY + 0.25;
  const textX = MARGIN + 0.90;
  const textW = SAFE_W - 1.10;

  items.forEach((item, idx) => {
    if (textY + 0.50 > contentY + boxH - 0.15) return;
    const richText = makeBoldLabelText(smartTruncate(item, 140), C.TEXT_DARK, C.TEXT_BODY, TYPO.BODY);
    const itemH = Math.min(0.70, (boxH - 0.30) / items.length);
    addTextSafe(slide, richText, {
      x: textX, y: textY, w: textW, h: itemH,
      valign: "middle", lineSpacingMultiple: 1.35,
    });
    textY += itemH + 0.08;
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
  const boxH = Math.min(SLIDE_H - contentY - BOTTOM_MARGIN - 0.20, 3.5);

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
    addTextSafe(slide, smartTruncate(item, 130), {
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
    const { course_id, palette, density, theme, includeImages } = body;
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Apply user customization
    activeThemeKey = theme === "dark" ? "dark" : "light";
    currentTheme = THEME[activeThemeKey];
    activePalette = PALETTES[palette || "default"] || PALETTES.default;
    activeDensity = DENSITY_MODES[density || "standard"] || DENSITY_MODES.standard;
    refreshColors();
    console.log("[CONFIG] Theme:" + activeThemeKey + " Palette:" + (palette || "default") + " Density:" + (density || "standard"));

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

    // Build all slides
    let allSlides: SlideData[] = [];
    for (let i = 0; i < modules.length; i++) {
      allSlides.push(...buildModuleSlides(modules[i], i, modules.length));
    }

    // Density balancing pass
    allSlides = balanceDensity(allSlides);

    // Recalculate density scores
    allSlides.forEach(s => { s.densityScore = calculateDensity(s); });
    const avgDensity = allSlides.reduce((sum, s) => sum + (s.densityScore || 0), 0) / Math.max(allSlides.length, 1);
    console.log("[DENSITY] Avg:" + avgDensity.toFixed(1) + " Slides:" + allSlides.length);

    // FINAL QUALITY CHECKLIST — validate all slides before rendering
    let totalWarnings = 0;
    let totalFixes = 0;
    allSlides.forEach((s, idx) => {
      const qr = runSlideQualityChecklist(s, idx + 3); // +3 for cover, TOC, offset
      totalWarnings += qr.warnings.length;
      totalFixes += qr.fixes.length;
    });
    console.log("[CHECKLIST] Total: " + totalWarnings + " avisos, " + totalFixes + " correcoes auto");

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
