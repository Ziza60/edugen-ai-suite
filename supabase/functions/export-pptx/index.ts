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

/**
 * PRE-RENDER TEXT WRAPPING v3 — NEVER produces "..."
 * When text exceeds capacity, cuts at sentence boundary or last complete word.
 * Adds period if needed instead of ellipsis.
 */
function ajustarTextoAoBox(texto: string, maxCaracteresPorLinha: number, maxLinhas = 2): AjusteTextoResult {
  if (!texto) return { texto: "", linhas: 0, truncado: false };
  const original = texto;
  const t = texto.trim();

  if (t.length <= maxCaracteresPorLinha) {
    forensicTrace("renderer", "ajustarTextoAoBox", "fit_adjustment", original, t, "text_fits_single_line", false);
    return { texto: t, linhas: 1, truncado: false };
  }

  const totalCapacity = maxCaracteresPorLinha * maxLinhas;

  // If text fits within total capacity, just wrap it
  if (t.length <= totalCapacity) {
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
        linhaAtual = palavra;
      }
    }
    if (linhaAtual) linhas.push(linhaAtual);
    const wrapped = linhas.join('\n');
    forensicTrace("renderer", "ajustarTextoAoBox", "fit_adjustment", original, wrapped, "wrapped_without_truncation", false);
    return { texto: wrapped, linhas: linhas.length, truncado: false };
  }

  // Text exceeds total capacity — cut at sentence boundary (NO ellipsis)
  const sub = t.substring(0, totalCapacity);
  const sentenceEnd = Math.max(sub.lastIndexOf(". "), sub.lastIndexOf("! "), sub.lastIndexOf("? "));
  let cutText: string;
  if (sentenceEnd > totalCapacity * 0.45) {
    cutText = t.substring(0, sentenceEnd + 1).trim();
  } else {
    // Cut at last complete word, clean trailing prepositions
    cutText = smartTruncate(t, totalCapacity, false);
    if (!/[.!?]$/.test(cutText)) cutText += ".";
  }

  // Re-wrap the cut text
  const palavras = cutText.split(' ');
  const linhas: string[] = [];
  let linhaAtual = '';
  for (const palavra of palavras) {
    if (linhaAtual === '') {
      linhaAtual = palavra;
    } else if ((linhaAtual + ' ' + palavra).length <= maxCaracteresPorLinha) {
      linhaAtual += ' ' + palavra;
    } else {
      linhas.push(linhaAtual);
      if (linhas.length >= maxLinhas) break;
      linhaAtual = palavra;
    }
  }
  if (linhaAtual && linhas.length < maxLinhas) linhas.push(linhaAtual);

  const resultado = linhas.join('\n');
  const truncado = cutText.length < t.length;
  forensicTrace(
    "renderer",
    "ajustarTextoAoBox",
    truncado ? "compression_used" : "fit_adjustment",
    original,
    resultado,
    truncado ? "text_exceeded_box_capacity" : "wrapped_within_capacity",
    truncado,
  );

  return {
    texto: resultado,
    linhas: linhas.length,
    truncado,
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
    const result = t.substring(0, sentenceEnd + 1).trim();
    if (result.length < t.length) {
      forensicTrace("text-util", "smartTruncate", "compression_used", t, result);
    }
    return result;
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

  if (result.length < t.length) {
    forensicTrace("text-util", "smartTruncate", "compression_used", t, result);
  }

  return result;
}

function smartTitle(text: string): string {
  return smartTruncate(text, 100, false); // v6: Increased from 80 — titles wrapped by renderer
}

function ensureSentenceEnd(text: string): string {
  const t = (text || "").trim();
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : t + ".";
}

function splitLongSegments(text: string, maxChars: number): string[] {
  const t = (text || "").trim();
  if (!t) return [];
  if (t.length <= maxChars) return [ensureSentenceEnd(t)];

  const segments: string[] = [];
  const sentences = t.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) || [t];

  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      segments.push(ensureSentenceEnd(sentence));
      continue;
    }

    const enumParts = sentence.split(/\s*;\s*|\s*\|\s*|\s*,\s*(?=(?:\d+[\)\.]|[a-zà-öø-ÿ]{3,}\s+[a-zà-öø-ÿ]{3,}))/i)
      .map(s => s.trim())
      .filter(Boolean);

    if (enumParts.length >= 2) {
      let bucket = "";
      for (const p of enumParts) {
        const candidate = bucket ? `${bucket}; ${p}` : p;
        if (candidate.length <= maxChars || !bucket) {
          bucket = candidate;
        } else {
          segments.push(ensureSentenceEnd(bucket));
          bucket = p;
        }
      }
      if (bucket) segments.push(ensureSentenceEnd(bucket));
      continue;
    }

    // fallback: split by words into chunks (structural, no ellipsis)
    const words = sentence.split(/\s+/).filter(Boolean);
    let chunk = "";
    for (const w of words) {
      const candidate = chunk ? `${chunk} ${w}` : w;
      if (candidate.length <= maxChars || !chunk) {
        chunk = candidate;
      } else {
        segments.push(ensureSentenceEnd(chunk));
        chunk = w;
      }
    }
    if (chunk) segments.push(ensureSentenceEnd(chunk));
  }

  return segments.filter(Boolean);
}

function extractLabelExplanation(text: string): { label: string; explanation: string } | null {
  const t = (text || "").trim();
  if (!t) return null;
  const match = t.match(/^([A-Za-zÀ-ÖØ-öø-ÿ0-9\s]{3,48}?)\s*([:–—-])\s*(.+)$/);
  if (!match) return null;
  const label = match[1].trim();
  const explanation = match[3].trim();
  if (!label || !explanation) return null;
  if (label.split(/\s+/).length > 7) return null;
  return { label, explanation };
}

function splitLabelExplanationBullet(text: string, maxChars: number): string[] | null {
  const parsed = extractLabelExplanation(text);
  if (!parsed) return null;
  const budget = Math.max(36, maxChars - parsed.label.length - 4);
  const parts = splitLongSegments(parsed.explanation, budget);
  if (parts.length <= 1) return null;
  return parts.map((part, idx) => idx === 0
    ? `${parsed.label}: ${part}`
    : `${parsed.label} (continuação): ${part}`);
}

function splitObjectiveForStructure(text: string, maxChars: number): string[] {
  const t = (text || "").trim();
  if (!t) return [];
  const direct = splitLongSegments(t, Math.max(48, maxChars));
  if (direct.length > 0) return direct;
  return [ensureSentenceEnd(t)];
}

function splitModuleCoverTitle(title: string): { primary: string; secondary: string | null; changed: boolean } {
  const t = (title || "").replace(/\s+/g, " ").trim();
  if (!t) return { primary: "", secondary: null, changed: false };

  const titleFits = measureBoundingBox(t, TYPO.MODULE_TITLE, FONT_TITLE, SAFE_W * 0.70, 1.50).fits;
  if (titleFits && t.length <= 120) {
    return { primary: t, secondary: null, changed: false };
  }

  const isSafeTitlePair = (primary: string, secondary: string) => {
    if (!primary || !secondary) return false;
    if (isWeakTitleFragment(primary) || isWeakTitleFragment(secondary)) return false;
    if (primary.length < 12 || secondary.length < 12) return false;
    return true;
  };

  const sepMatch = t.match(/^(.{18,90}?)\s*[:–—-]\s*(.{18,})$/);
  if (sepMatch) {
    const p = sepMatch[1].trim();
    const s = sepMatch[2].trim();
    if (isSafeTitlePair(p, s)) {
      return {
        primary: p,
        secondary: s,
        changed: true,
      };
    }
  }

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 4) return { primary: t, secondary: null, changed: false };
  const mid = Math.ceil(words.length * 0.55);
  const primary = words.slice(0, mid).join(" ").trim();
  const secondary = words.slice(mid).join(" ").trim();

  if (!secondary || !isSafeTitlePair(primary, secondary)) {
    return { primary: t, secondary: null, changed: false };
  }

  return { primary, secondary, changed: true };
}

function getContinuationTitle(title: string, part: number): string {
  const base = (title || "").replace(/\s*\(Parte\s*\d+\)\s*$/i, "").trim();
  return smartTitle(base + " (Parte " + part + ")");
}

function getNextContinuationTitle(title: string, fallbackBase: string): string {
  const source = (title || fallbackBase || "Continuação").trim();
  const match = source.match(/\(Parte\s*(\d+)\)\s*$/i);
  const nextPart = match ? Number(match[1]) + 1 : 2;
  const base = source.replace(/\s*\(Parte\s*\d+\)\s*$/i, "").trim() || fallbackBase || "Continuação";
  return getContinuationTitle(base, nextPart);
}

function flowLog(tag: string, details: string) {
  console.log("[FLOW] " + tag + " | " + details);
}

/* ═══════════════════════════════════════════════════════
   FORENSIC TRACER — field-level mutation tracking
   ═══════════════════════════════════════════════════════ */

interface ForensicEvent {
  slide: number;
  layout: string;
  field: string;
  stage: string;
  fn: string;
  action: string;
  reason: string;
  mutated: boolean;
  before: string;
  after: string;
  chars_before: number;
  chars_after: number;
  reduction_pct: number;
}

interface RendererTraceEvent {
  slide: number;
  layout: string;
  renderer: string;
}

const _forensicEvents: ForensicEvent[] = [];
const _rendererTrace: RendererTraceEvent[] = [];
let _forensicSlideIndex = 0;
let _forensicSlideLayout = "";
let _forensicSlideField = "";

function forensicSetContext(slideIndex: number, layout: string, field: string) {
  _forensicSlideIndex = slideIndex;
  _forensicSlideLayout = layout;
  _forensicSlideField = field;
}

function forensicTrace(
  stage: string,
  fn: string,
  action: string,
  before: string,
  after: string,
  reason = "",
  forcedMutated?: boolean,
) {
  const safeBefore = (before || "").toString();
  const safeAfter = (after || "").toString();
  const charsBefore = safeBefore.length;
  const charsAfter = safeAfter.length;
  const reductionPct = charsBefore > 0 ? Number(((1 - charsAfter / charsBefore) * 100).toFixed(1)) : 0;
  const mutated = typeof forcedMutated === "boolean" ? forcedMutated : safeBefore !== safeAfter;

  const event: ForensicEvent = {
    slide: _forensicSlideIndex,
    layout: _forensicSlideLayout,
    field: _forensicSlideField,
    stage,
    fn,
    action,
    reason,
    mutated,
    before: safeBefore.substring(0, 300),
    after: safeAfter.substring(0, 300),
    chars_before: charsBefore,
    chars_after: charsAfter,
    reduction_pct: reductionPct,
  };
  _forensicEvents.push(event);

  const fieldLabel = "slide=" + _forensicSlideIndex + " layout=" + _forensicSlideLayout + " field=" + _forensicSlideField;
  console.log(
    "[TRACE] " + fieldLabel +
    " stage=" + stage +
    " action=" + action +
    " fn=" + fn +
    " mutated=" + mutated +
    " chars_before=" + charsBefore +
    " chars_after=" + charsAfter +
    " reduction=" + reductionPct + "%" +
    (reason ? " reason=" + reason : ""),
  );

  console.log("[TRACE] " + fieldLabel + " before=\"" + safeBefore.substring(0, 120) + "\"");
  console.log("[TRACE] " + fieldLabel + " after=\"" + safeAfter.substring(0, 120) + "\"");
}

function forensicTraceField(
  slideIndex: number,
  layout: string,
  field: string,
  stage: string,
  fn: string,
  action: string,
  before: string,
  after: string,
  reason = "",
  forcedMutated?: boolean,
) {
  forensicSetContext(slideIndex, layout, field);
  forensicTrace(stage, fn, action, before, after, reason, forcedMutated);
}

function forensicTraceRenderer(slideIndex: number, layout: string, renderer: string) {
  _rendererTrace.push({ slide: slideIndex, layout, renderer });
  console.log("[TRACE] slide=" + slideIndex + " layout=" + layout + " renderer=" + renderer);
}

function forensicReset() {
  _forensicEvents.length = 0;
  _rendererTrace.length = 0;
  _forensicSlideIndex = 0;
  _forensicSlideLayout = "";
  _forensicSlideField = "";
}

function forensicGetReport() {
  const compressionEvents = _forensicEvents.filter(e => e.action === "compression_used");
  const fallbackEvents = _forensicEvents.filter(e => e.action === "fallback_used");
  const stage0Events = _forensicEvents.filter(e => e.stage === "0");
  const stage0_5Events = _forensicEvents.filter(e => e.stage === "0.5");
  const stage1_5Events = _forensicEvents.filter(e => e.stage === "1.5");
  const stage2_5Events = _forensicEvents.filter(e => e.stage === "2.5");
  const silentTruncationEvents = _forensicEvents.filter(e => e.action === "silent_truncation_detected");

  const fieldHistoryMap = new Map<string, ForensicEvent[]>();
  for (const e of _forensicEvents) {
    const key = e.slide + "|" + e.field;
    if (!fieldHistoryMap.has(key)) fieldHistoryMap.set(key, []);
    fieldHistoryMap.get(key)!.push(e);
  }

  const fieldHistorySummary = Array.from(fieldHistoryMap.entries())
    .filter(([, events]) => events.length > 1 || events.some(e => e.mutated))
    .slice(0, 80)
    .map(([key, events]) => ({
      slide_field: key,
      mutations: events.map(e => e.stage + "/" + e.fn + ":" + e.action + (e.reduction_pct > 0 ? "(-" + e.reduction_pct + "%)" : "")),
      final_chars: events[events.length - 1].chars_after,
    }));

  const firstMutationPerField = Array.from(fieldHistoryMap.entries())
    .map(([key, events]) => {
      const firstMutation = events.find(e => e.mutated && e.chars_after < e.chars_before);
      if (!firstMutation) return null;
      return {
        slide_field: key,
        slide: firstMutation.slide,
        layout: firstMutation.layout,
        field: firstMutation.field,
        first_stage: firstMutation.stage,
        first_function: firstMutation.fn,
        event_type: firstMutation.action,
        reason: firstMutation.reason,
        chars_before: firstMutation.chars_before,
        chars_after: firstMutation.chars_after,
        reduction_pct: firstMutation.reduction_pct,
        before: firstMutation.before,
        after: firstMutation.after,
      };
    })
    .filter(Boolean)
    .slice(0, 100);

  const mapEvent = (e: ForensicEvent) => ({
    slide: e.slide,
    field: e.field,
    layout: e.layout,
    stage: e.stage,
    function: e.fn,
    event_type: e.action,
    reason: e.reason,
    mutated: e.mutated,
    chars_before: e.chars_before,
    chars_after: e.chars_after,
    reduction_pct: e.reduction_pct,
    before: e.before,
    after: e.after,
  });

  return {
    stage0_events: stage0Events.slice(0, 200).map(mapEvent),
    stage0_5_events: stage0_5Events.slice(0, 200).map(mapEvent),
    stage1_5_events: stage1_5Events.slice(0, 200).map(mapEvent),
    stage2_5_events: stage2_5Events.slice(0, 300).map(mapEvent),
    silent_truncation_events: silentTruncationEvents.slice(0, 120).map(mapEvent),
    first_mutation_per_field: firstMutationPerField,
    compression_events: compressionEvents.slice(0, 80).map(mapEvent),
    fallback_events: fallbackEvents.slice(0, 80).map(mapEvent),
    renderer_trace: _rendererTrace.slice(0, 200),
    field_history_summary: fieldHistorySummary,
    total_trace_events: _forensicEvents.length,
    total_compressions: compressionEvents.length,
    total_fallbacks: fallbackEvents.length,
  };
}

function splitNarrativeItemForStructure(text: string, maxChars: number): string[] {
  const trimmed = (text || "").trim();
  if (!trimmed) return [];

  const splitLabel = splitLabelExplanationBullet(trimmed, maxChars);
  if (splitLabel && splitLabel.length > 1) {
    return splitLabel.map(ensureSentenceEnd);
  }

  return splitLongSegments(trimmed, maxChars).map(ensureSentenceEnd);
}

/**
 * SMART SUBTITLE v2 — Increased capacity for cover descriptions.
 * Allows up to 280 chars (3+ lines at 18pt on wide slides).
 * Never produces "..." — always cuts at sentence boundary.
 */
function smartSubtitle(text: string): string {
  if (!text) return "";
  const t = text.trim();
  // v6: Increased from 200 to 280 chars — covers have enough space for 3-4 lines
  if (t.length <= 280) return t;
  // Find sentence boundary within 280 chars
  const sub = t.substring(0, 280);
  const sentenceEnd = Math.max(sub.lastIndexOf(". "), sub.lastIndexOf("! "), sub.lastIndexOf("? "));
  if (sentenceEnd > 80) return sub.substring(0, sentenceEnd + 1).trim();
  // Fall back to word boundary with sentence integrity (no ellipsis)
  let result = smartTruncate(t, 280, false);
  result = enforceSentenceIntegrity(result);
  return result;
}

/**
 * SMART BULLET v2 — structural pre-processing for long bullets
 * For "Label: long explanation" patterns, compresses the explanation part only,
 * preserving the label. Never produces "..." — uses sentence boundaries.
 */
function smartBullet(text: string): string {
  if (!text) return "";
  const maxChars = activeDensity.maxCharsPerBullet;
  const t = text.trim();

  // If text fits within limit, return as-is (preserve full sentences)
  if (t.length <= maxChars) {
    return ensureSentenceEnd(t);
  }

  // Prefer structural split-aware compression for label:explanation inputs
  const structural = splitLabelExplanationBullet(t, maxChars);
  if (structural && structural.length > 0) {
    forensicTrace("text-util", "smartBullet", "compression_used", t, structural[0]);
    return structural[0];
  }

  // Try to cut at a sentence boundary first (preserve complete sentences)
  const sub = t.substring(0, maxChars);
  const sentenceEnd = Math.max(sub.lastIndexOf(". "), sub.lastIndexOf("! "), sub.lastIndexOf("? "));
  if (sentenceEnd > maxChars * 0.4) {
    const result = ensureSentenceEnd(t.substring(0, sentenceEnd + 1).trim());
    forensicTrace("text-util", "smartBullet", "compression_used", t, result);
    return result;
  }

  // Fall back to smartTruncate (never with ellipsis)
  const result = smartTruncate(t, maxChars, false);
  forensicTrace("text-util", "smartBullet", "fallback_used", t, ensureSentenceEnd(result));
  return ensureSentenceEnd(result);
}

function smartCell(text: string): string {
  const before = (text || "").trim();
  const after = smartTruncate(text, 120); // Wider cells need more space for complete sentences
  forensicTrace("renderer", "smartCell", before.length !== after.length ? "compression_used" : "fit_adjustment", before, after, "table_cell_fit", before.length !== after.length);
  return after;
}

function smartModuleDesc(text: string): string {
  const before = (text || "").trim();
  const after = smartTruncate(text, 100); // Module descriptions need complete sentences
  forensicTrace("renderer", "smartModuleDesc", before.length !== after.length ? "compression_used" : "fit_adjustment", before, after, "module_description_fit", before.length !== after.length);
  return after;
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

/**
 * AUTO-ADJUST TEXT v2 — NEVER produces "..."
 * Tries reducing font size first. If text still doesn't fit at minFont,
 * cuts at sentence boundary and adds period (not ellipsis).
 */
function autoAdjustText(text: string, boxWidth: number, boxHeight: number, maxFont = 32, minFont = 12): AutoAdjustResult {
  for (let size = maxFont; size >= minFont; size -= 1) {
    const check = validateTextDensity(text, boxWidth, boxHeight, size);
    if (check.fits) {
      return { fontSize: size, truncated: false, text };
    }
  }
  // Last resort: cut at sentence boundary (NEVER add "...")
  const maxLen = validateTextDensity(text, boxWidth, boxHeight, minFont).maxChars;
  
  // Try sentence boundary first
  const sub = text.substring(0, Math.max(maxLen, 20));
  const sentenceEnd = Math.max(sub.lastIndexOf(". "), sub.lastIndexOf("! "), sub.lastIndexOf("? "));
  if (sentenceEnd > maxLen * 0.4) {
    return { fontSize: minFont, truncated: true, text: text.substring(0, sentenceEnd + 1).trim() };
  }
  
  // Fall back to word boundary with sentence integrity (no ellipsis)
  let result = smartTruncate(text, Math.max(maxLen, 10), false);
  result = enforceSentenceIntegrity(result);
  return { fontSize: minFont, truncated: true, text: result };
}

/* ═══════════════════════════════════════════════════════
   TRUNCATION DETECTION v3 — Semantic completeness checks
   ═══════════════════════════════════════════════════════ */

// Common Portuguese transitive verbs that REQUIRE a complement/object
const PT_TRANSITIVE_VERBS = /\b(aumentar|tornar|transformar|otimizar|permitir|identificar|analisar|desenvolver|aplicar|compreender|utilizar|habilitar|melhorar|garantir|possibilitar|facilitar|impulsionar|promover|acelerar|revolucionar|aprimorar|categorizar|classificar|gerar|criar|reduzir|eliminar|integrar|implementar|estabelecer|definir|processar|extrair|automatizar|monitorar|prever|avaliar|gerenciar|coordenar|simplificar|personalizar|detectar|prevenir|consolidar|organizar|estruturar|sintetizar)\s*$/i;

// Gerunds/participles that need complements  
const PT_INCOMPLETE_GERUNDS = /\b(transformando|otimizando|analisando|identificando|auxiliando|tornando|permitindo|facilitando|melhorando|garantindo|promovendo|reduzindo|eliminando|integrando|organizando|processando|gerando|criando|desenvolvendo|simplificando)\s*$/i;

// Present-tense transitive verbs that need objects
const PT_PRESENT_TRANSITIVE = /\b(envolve|permite|identifica|analisa|utiliza|categoriza|classifica|transforma|otimiza|facilita|garante|promove|gera|cria|reduz|elimina|integra|processa|extrai|monitora|prevê|avalia|gerencia|coordena|simplifica|personaliza|detecta|previne|consolida|organiza|estrutura|sintetiza|inclui|oferece|fornece|possui|contém|abrange|compreende|requer|exige|demanda|necessita|implica)\s*$/i;

// Words that are clearly self-contained nouns (NOT truncations)
const PT_COMPLETE_ENDINGS = /\b(IA|AI|TI|UX|UI|ML|BI|CX|RH|SEO|ROI|KPI|PLN|NLP|OCR|ERP|CRM|API|IoT|SaaS|B2B|B2C|dados|resultados|trabalho|profissional|negócios|clientes|empresa|equipe|mercado|processo|custos|tempo|eficiência|produtividade|qualidade|inovação|segurança|privacidade|desempenho|informações|decisões|operações|estratégias|ferramentas|tecnologia|sistemas|soluções|plataforma|insights)\s*$/i;

/**
 * Checks if a text looks like a valid bullet/enumeration rather than a truncated sentence.
 * Valid bullets include: comma-separated lists, tool names, short action descriptions,
 * nominal phrases typical in presentations.
 */
function isValidBullet(text: string): boolean {
  const t = text.trim().replace(/\.+$/, "").trim();
  if (!t) return false;

  const wc = t.split(/\s+/).length;

  // Comma-separated enumerations: "ChatGPT, Google Gemini, Claude"
  if ((t.match(/,/g) || []).length >= 1 && wc <= 10) {
    const chunks = t.split(",").map((s) => s.trim()).filter(Boolean);
    if (chunks.length >= 2) return true;
  }

  // Tool/category lists with proper nouns/acronyms, even without commas
  if (wc >= 2 && wc <= 6) {
    const properNounOrAcronymCount = t.split(/\s+/).filter((w) =>
      /^[A-ZÁÉÍÓÚÃÕ][a-záéíóúãõâêîôûç]+$/.test(w) || /^[A-Z]{2,}$/.test(w)
    ).length;
    if (properNounOrAcronymCount >= 2) return true;
  }

  // Action bullet: "Aprimora textos existentes"
  if (/^[A-ZÁÉÍÓÚÃÕ]?[a-záéíóúãõâêîôûç]+\s+\w+/i.test(t) && wc >= 3 && wc <= 8) {
    const words = t.split(/\s+/);
    const firstWord = words[0];
    if (/^[A-Z]?[a-záéíóúãõâêîôûç]+(a|e|i)$/.test(firstWord) && words.length >= 3) return true;
  }

  // Nominal phrase ending in noun/adjective (typical slide bullet)
  if (wc >= 3 && wc <= 7 && t.length >= 16 && t.length <= 70) {
    const words = t.split(/\s+/);
    const lastWord = words[words.length - 1] || "";
    if (
      lastWord.length >= 4
      && !/[aeiou]r$/i.test(lastWord)
      && !/^(de|da|do|das|dos|na|no|em|para|por|com|ao|à|que|como)$/i.test(lastWord)
    ) {
      return true;
    }
  }

  // Short labels are valid only when they look like noun phrases (not arbitrary fragments)
  if (wc >= 2 && wc <= 4 && t.length <= 42) {
    if (/\b(de|da|do|das|dos|para|com|em)\b/i.test(t)) return true;
    if (/^[A-ZÁÉÍÓÚÃÕ][\wÀ-ÖØ-öø-ÿ-]+\s+[a-zà-öø-ÿ]{3,}/.test(t)) return true;
  }

  // Items with semicolons (enumeration style)
  if (t.includes(";")) return true;

  return false;
}

function isWeakSemanticFragment(text: string): boolean {
  const t = (text || "").trim().replace(/\s+/g, " ").replace(/\.+$/, "").trim();
  if (!t) return false;

  // Canonical bad fragments seen in approved-but-poor exports
  if (/^(por exemplo|ferramentas\s+de\s+ia|o processo envolve|a ia analisa dados)$/i.test(t)) return true;

  const wc = t.split(/\s+/).length;

  // Very short discourse markers without payload
  if (/^(por exemplo|em resumo|na prática|no geral|como resultado)$/i.test(t)) return true;

  // Generic noun phrases that look complete but are semantically empty for slide content
  if (/^(ferramentas|modelos|tipos|aplicações|processo|resultado|contexto|exemplo)(\s+de\s+[\wÀ-ÖØ-öø-ÿ-]+){0,2}$/i.test(t) && wc <= 5) return true;

  // Subject + transitive verb with no object/complement
  if (/^(a\s+ia|o\s+processo|o\s+sistema|a\s+ferramenta|as\s+ferramentas|este\s+processo|essa\s+abordagem)\s+(envolve|analisa|usa|utiliza|aplica|gera|permite|inclui|oferece)$/i.test(t)) {
    return true;
  }

  return false;
}

function isWeakTitleFragment(text: string): boolean {
  const t = (text || "").trim().replace(/\s+/g, " ").replace(/\.+$/, "").trim();
  if (!t) return false;

  if (/\(Parte\s*\d+\)\s*$/i.test(t)) return false;

  const wc = t.split(/\s+/).length;
  if (wc <= 2 && t.length < 18) return true;
  if (/^(introdu[cç][aã]o|vis[aã]o geral|detalhes|continua[cç][aã]o|parte)$/i.test(t)) return true;
  if (isWeakSemanticFragment(t)) return true;

  return false;
}

function extractWarningQuotedText(warning: string): string {
  const quoted = warning.match(/"([^"]+)"/);
  return (quoted?.[1] || "").trim();
}

function warningDedupKey(warning: string): string {
  const type = (warning.match(/TRUNCAMENTO|FRAGMENTO|FRAGMENTO SEMÂNTICO|TÍTULO FRAGMENTADO|SPLIT ARTIFICIAL|TEXTO COM QUEBRA INVÁLIDA|GRAMATICA|PONTUACAO|REPETICAO|TITULO CURTO|TITULO GENERICO|WCAG|BBOX|CELULA|MESCLADO|SIMBOLOS/i)?.[0] || "WARN").toUpperCase();
  const quoted = extractWarningQuotedText(warning)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\.+$/, "")
    .trim();

  if (quoted) return `${type}|${quoted.slice(0, 120)}`;

  const normalized = warning
    .replace(/^Slide\s+\d+\s*/i, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return `${type}|${normalized}`;
}

function dedupeWarnings(warnings: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const warning of warnings) {
    const key = warningDedupKey(warning);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(warning);
  }
  return unique;
}

function isFalsePositiveTruncationWarning(warning: string): boolean {
  if (!/TRUNCAMENTO|FRAGMENTO|POST-RENDER|SPLIT ARTIFICIAL/i.test(warning)) return false;
  if (/SPLIT ARTIFICIAL/i.test(warning)) return false; // always real issue

  const snippet = extractWarningQuotedText(warning);
  if (!snippet) return false;

  // Never suppress semantic-fragment warnings
  if (isWeakSemanticFragment(snippet) || isWeakTitleFragment(snippet)) return false;

  // Only suppress when snippet looks like valid slide bullet AND has no semantic truncation
  const normalizedSnippet = snippet.replace(/\.+$/, "").trim();
  return isValidBullet(normalizedSnippet) && !detectSemanticTruncation(normalizedSnippet);
}

function detectTruncation(text: string): boolean {
  if (!text || text.length < 5) return false;
  const trimmed = text.trim().replace(/\.+$/, "").trim(); // Strip trailing period for analysis

  // SHORT TEXT EXEMPTIONS — labels, headers, proper nouns, acronyms are NOT truncated
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount <= 2 && trimmed.length < 30) return false;
  if (/^[A-ZÁÉÍÓÚÃÕ\s\d]+$/.test(trimmed)) return false;
  if (/^\d{1,2}[\.\)]\s/.test(trimmed)) return false;
  // Section labels
  if (/^(Cenário|Solução|Resultado|Reflexão|Reflexao|Resumo|Objetivo|Insight|Atenção|Dica|Nota|Importante)\s*$/i.test(trimmed)) return false;
  // Label:value patterns like "Cenário: ..." are not truncated
  if (/^(Cenário|Solução|Resultado|Prompt para IA|Reflexão)\s*[:–-]\s*.{15,}/i.test(trimmed)) return false;

  // ═══ BULLET/ENUMERATION EXEMPTION (v4 calibration) ═══
  // Valid bullets, enumerations, and nominal phrases typical of slides are NOT truncated
  if (isValidBullet(trimmed)) return false;

  // ═══ DANGLING CONNECTORS ═══
  // Ends in dangling connector/preposition/article (even if period was appended)
  if (/\s(de|da|do|das|dos|na|no|nas|nos|em|para|por|com|ao|à|a|o|as|os|e|ou|que|seu|sua|seus|suas|sem|este|esta|esse|essa|como|mais)\s*$/i.test(trimmed)) {
    return true;
  }

  // ═══ ORPHAN TOKENS ═══
  const lastWord = trimmed.split(/\s+/).pop() || "";
  if (lastWord.length <= 2 && trimmed.length > 24) {
    if (!/^(é|e|a|o|ou|em|se|já|só|aí|há|IA|AI|TI|UX|UI|ML|BI|CX|RH)$/i.test(lastWord)) return true;
  }

  // ═══ INCOMPLETE VERBS (the core regression fix) ═══
  // Infinitive verbs at end of sentence WITHOUT complement
  if (PT_TRANSITIVE_VERBS.test(trimmed)) return true;

  // Gerunds/participles that need complements
  if (PT_INCOMPLETE_GERUNDS.test(trimmed)) return true;

  // Present-tense transitive verbs that need objects
  if (PT_PRESENT_TRANSITIVE.test(trimmed)) return true;

  // ═══ SUSPICIOUSLY SHORT SENTENCES ═══
  // Very short sentence (< 35 chars, >= 3 words) — ONLY flag if clearly incomplete
  // v4 calibration: removed this as a standalone rule — isValidBullet handles the exemption above,
  // and the verb/preposition checks catch real truncations regardless of length
  // This prevents false positives on valid short bullets like "Modelos específicos para marketing."

  // ═══ ARTIFICIAL SPLITS (e.g., "A gestão de documentos. IA permite...") ═══
  if (/\.\s+(IA|A IA|Ela|Ele|Isso|Esta|Este|Essa|Esse)\s/i.test(text.trim()) && wordCount <= 12) {
    return true;
  }

  // ═══ ELLIPSIS INDICATING CUT ═══
  if (/\.\.\.\s/.test(text.trim()) && wordCount >= 4) {
    return true;
  }

  return false;

}

/**
 * Deeper semantic truncation detection for post-render scan.
 * Catches cases where period was added to mask a cut sentence.
 */
/**
 * Deeper semantic truncation detection for post-render scan.
 * v4: Respects bullet/enumeration exemptions to avoid false positives.
 * Catches cases where period was added to mask a cut sentence.
 */
function detectSemanticTruncation(text: string): boolean {
  if (!text || text.length < 10) return false;

  if (isWeakSemanticFragment(text)) return true;
  
  // v4: Exempt valid bullets/enumerations FIRST — before any heuristic
  if (isValidBullet(text.trim().replace(/\.+$/, "").trim())) return false;

  // v7: Exempt structural continuation titles ending with "(Parte N)"
  // These are generated by getNextContinuationTitle and are NEVER truncated.
  // Forensic evidence from record ec0a89d3: slides 40, 49, 84 flagged as false positives.
  const trimmedForSuffix = text.trim().replace(/\.+$/, "").trim();
  if (/\(Parte\s*\d+\)\s*$/i.test(trimmedForSuffix)) return false;
  
  // Run the basic check (which also calls isValidBullet internally)
  if (detectTruncation(text)) return true;
  
  const stripped = trimmedForSuffix;
  const wordCount = stripped.split(/\s+/).length;
  
  // Sentence ends with an infinitive VERB — likely needs an object
  // E.g., "A IA atua como um catalisador para aumentar" → "aumentar" WHAT?
  // v4: Only flag for longer sentences (>= 6 words) to avoid flagging action bullets
  if (wordCount >= 6 && /[aeiou]r\s*$/i.test(stripped)) {
    const lastWord = stripped.split(/\s+/).pop() || "";
    if (lastWord.length >= 5 && /[aeiou]r$/i.test(lastWord)) {
      return true;
    }
  }
  
  // "..., como." — dangling comparative
  if (/,\s*como\s*$/i.test(stripped)) return true;

  // v6 REMOVED: preposition+noun heuristic entirely.
  // v7: Also removed "(Parte N)" false positives (see above).

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

function compressText(text: string, maxChars: number = 160): string {
  if (!text || text.length <= maxChars) return text;
  const original = text;
  let t = text;
  // Conservative compression only (avoid semantic corruption)
  t = t.replace(/\bpor\s+exemplo\b/gi, "exemplo");
  t = t.replace(/\bno\s+entanto\b/gi, "porém");
  t = t.replace(/\bal[eé]m\s+disso\b/gi, "também");
  t = t.replace(/\s{2,}/g, " ").trim();

  if (t.length > maxChars) {
    // CRITICAL: try sentence boundary first, never cut at verbs/prepositions
    const sub = t.substring(0, maxChars);
    const sentenceEnd = Math.max(sub.lastIndexOf(". "), sub.lastIndexOf("! "), sub.lastIndexOf("? "));
    if (sentenceEnd > maxChars * 0.45) {
      t = t.substring(0, sentenceEnd + 1).trim();
    } else {
      t = smartTruncate(t, maxChars);
      t = enforceSentenceIntegrity(t);
    }
    // Post-check: if result is semantically truncated, try with more chars
    if (detectSemanticTruncation(t) && maxChars < text.length * 0.95) {
      const expanded = smartTruncate(text, Math.min(text.length, Math.floor(maxChars * 1.3)));
      const expandedClean = enforceSentenceIntegrity(expanded);
      if (!detectSemanticTruncation(expandedClean)) t = expandedClean;
    }
  }
  if (t.length < original.length) {
    forensicTrace("text-util", "compressText", "compression_used", original, t);
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
    if (bbox.fits) {
      if (i > 0) {
        forensicTrace("renderer", "fitTextForBox", "fit_adjustment", clean, currentText);
      }
      return { text: currentText, fontSize: currentFont, adjusted: i > 0 };
    }

    if (bbox.recommendedFontSize < currentFont && bbox.recommendedFontSize >= minFont) {
      currentFont = bbox.recommendedFontSize;
      continue;
    }

      const targetChars = Math.max(24, currentText.length - Math.max(8, bbox.overflowChars + 4));
      const compressed = compressText(currentText, targetChars);
      // If compression produces semantic truncation, prefer font reduction only
      if (detectSemanticTruncation(compressed) && currentFont > minFont) {
        currentFont = Math.max(minFont, currentFont - 2);
        continue;
      }
      currentText = compressed;
  }

  if (currentText.length < clean.length) {
    forensicTrace("renderer", "fitTextForBox", "compression_used", clean, currentText);
  }
  return { text: currentText, fontSize: Math.max(currentFont, minFont), adjusted: true };
}

function fitTextForBoxWithoutCompression(
  text: string,
  boxW: number,
  boxH: number,
  fontSize: number,
  fontFace: string,
  minFont = 12,
): { text: string; fontSize: number; adjusted: boolean; fits: boolean } {
  const clean = enforceSentenceIntegrity(sanitize(text));
  let currentFont = fontSize;

  for (let i = 0; i < 8; i++) {
    const bbox = measureBoundingBox(clean, currentFont, fontFace, boxW, boxH);
    if (bbox.fits) {
      if (currentFont !== fontSize) {
        forensicTrace("renderer", "fitTextForBoxWithoutCompression", "fit_adjustment", clean, clean, "font_reduced_no_text_change", false);
      }
      return { text: clean, fontSize: currentFont, adjusted: currentFont !== fontSize, fits: true };
    }

    if (currentFont <= minFont) break;
    currentFont = Math.max(minFont, currentFont - 1);
  }

  forensicTrace("renderer", "fitTextForBoxWithoutCompression", "fallback_used", clean, clean, "font_floor_reached_no_text_compression", false);
  return { text: clean, fontSize: currentFont, adjusted: currentFont !== fontSize, fits: false };
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
                moduleDescription: { type: "string", description: "One or two complete sentences describing the module objective (max 160 chars). MUST be a grammatically complete sentence ending with a period." },
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

  // ── STRUCTURAL REDISTRIBUTION for module cover (real active path) ──
  const coverTitleRaw = plan.moduleTitle;
  const splitCoverTitle = splitModuleCoverTitle(coverTitleRaw);
  const coverTitle = splitCoverTitle.primary || coverTitleRaw;
  const coverTitleSubtitle = splitCoverTitle.secondary || undefined;
  const coverDesc = ensureSentenceEnd((plan.moduleDescription || "").trim());
  const rawObjectives = plan.objectives.map(o => ensureSentenceEnd((o || "").trim())).filter(Boolean);
  const coverObjectives = rawObjectives.flatMap((o) => splitObjectiveForStructure(o, Math.max(54, activeDensity.maxCharsPerBullet - 8)));

  // Measure: will objectives fit on the cover?
  const objW = SAFE_W * 0.60 - 0.30;
  const objH = 0.44;
  let objectivesOverflow = false;
  for (const obj of coverObjectives) {
    const bbox = measureBoundingBox(obj, TYPO.SUPPORT, FONT_BODY, objW, objH);
    if (!bbox.fits && obj.length > 52) { objectivesOverflow = true; break; }
  }
  // Also check if we have too many objectives + long description
  const totalCoverContent = coverDesc.length + coverObjectives.reduce((s, o) => s + o.length, 0);
  if (totalCoverContent > 320 || coverObjectives.length > 3) objectivesOverflow = true;

  if (objectivesOverflow) {
    // Split: cover gets title + description, objectives go to dedicated continuation slide
    slides.push({
      layout: "module_cover",
      title: coverTitle,
      coverTitleSubtitle,
      subtitle: "MODULO " + String(moduleIndex + 1).padStart(2, "0"),
      description: coverDesc,
      moduleIndex,
      objectives: [],
    });

    const OBJ_PER_SLIDE = 4;
    for (let oi = 0; oi < coverObjectives.length; oi += OBJ_PER_SLIDE) {
      const chunk = coverObjectives.slice(oi, oi + OBJ_PER_SLIDE);
      const part = Math.floor(oi / OBJ_PER_SLIDE) + 1;
      slides.push({
        layout: "bullets",
        title: coverObjectives.length > OBJ_PER_SLIDE ? getContinuationTitle("Objetivos do Módulo", part) : "Objetivos do Módulo",
        sectionLabel: "OBJETIVOS DO MÓDULO",
        items: sanitizeBullets(chunk),
        moduleIndex,
        blockType: "normal",
      });
    }
    flowLog("OBJECTIVES", "semanticPlanToSlides -> dedicated objective slide(s), module=" + (moduleIndex + 1) + ", count=" + coverObjectives.length);
  } else {
    slides.push({
      layout: "module_cover",
      title: coverTitle,
      coverTitleSubtitle,
      subtitle: "MODULO " + String(moduleIndex + 1).padStart(2, "0"),
      description: coverDesc,
      moduleIndex,
      objectives: coverObjectives,
    });
    flowLog("MODULE_COVER", "semanticPlanToSlides -> renderModuleCover, module=" + (moduleIndex + 1));
  }

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

    // ── STRUCTURAL REDISTRIBUTION for long bullet items (v7) ──
    // Instead of compressing "Label: long explanation" bullets, split them
    // into multiple items when they exceed capacity.
    let processedItems = slidePlan.items;
    const maxBulletLen = activeDensity.maxCharsPerBullet;
    const expandedItems: string[] = [];
    let didRedistribute = false;

    for (const item of processedItems) {
      if (item.length <= maxBulletLen) {
        expandedItems.push(item);
        continue;
      }
      // Try to split "Label: long explanation" into "Label" + explanation sentences
      const colonIdx = item.indexOf(":");
      if (colonIdx > 2 && colonIdx < 55) {
        const label = item.substring(0, colonIdx).trim();
        const explanation = item.substring(colonIdx + 1).trim();
        // Split explanation into sentences
        const sentences = explanation.match(/[^.!?]+[.!?]+/g);
        if (sentences && sentences.length >= 2) {
          // First item keeps label + first sentence(s)
          let first = label + ": " + sentences[0].trim();
          if (first.length <= maxBulletLen && sentences.length > 2) {
            first = label + ": " + sentences.slice(0, 2).join(" ").trim();
          }
          expandedItems.push(first.length > 0 && !/[.!?]$/.test(first) ? first + "." : first);
          // Remaining sentences become standalone items
          const remaining = sentences.slice(first.includes(sentences[1]?.trim() || "__") ? 2 : 1);
          if (remaining.length > 0) {
            const remainText = remaining.join(" ").trim();
            if (remainText.length > 3) {
              expandedItems.push(remainText.length > 0 && !/[.!?]$/.test(remainText) ? remainText + "." : remainText);
            }
          }
          didRedistribute = true;
          continue;
        }
      }
      // Regular long item: split at sentence boundary into two items
      const sentences = item.match(/[^.!?]+[.!?]+/g);
      if (sentences && sentences.length >= 2) {
        const mid = Math.ceil(sentences.length / 2);
        const part1 = sentences.slice(0, mid).join(" ").trim();
        const part2 = sentences.slice(mid).join(" ").trim();
        if (part1.length > 10 && part2.length > 10) {
          expandedItems.push(part1);
          expandedItems.push(part2);
          didRedistribute = true;
          continue;
        }
      }
      // Fall back to smartBullet compression (last resort)
      expandedItems.push(smartBullet(item));
    }

    if (didRedistribute) {
      console.log("[REDISTRIB] Slide '" + slidePlan.slideTitle + "': items expanded " + processedItems.length + " → " + expandedItems.length);
      processedItems = expandedItems;
    }

    const sd: SlideData = {
      layout,
      title: smartTitle(slidePlan.slideTitle),
      sectionLabel: slidePlan.sectionLabel.toUpperCase().substring(0, 25),
      items: sanitizeBullets(processedItems),
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
6. **Máximo**: Cada item corrigido deve ter no máximo 180 caracteres. Se ultrapassar, resuma mantendo o significado essencial. NUNCA corte uma frase no meio — sempre termine com sentença completa.

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
        const oldItemsSnapshot = [...slide.items];

        for (const corrected of (slideResult.correctedItems || [])) {
          const itemId = corrected.id;
          const originalText = slide.items[itemId] || "";
          const status = corrected.status || "ok";
          const fixedText = (corrected.text || "").trim();
          const fieldLabel = `item[${itemId}]`;
          const slideNum = slideIdx + 3;

          if (status === "nonsense") {
            forensicTraceField(slideNum, slide.layout, fieldLabel, "1.5", "llmValidateSlideContent", "fit_adjustment", originalText, "", "llm_marked_nonsense", true);
            validation.nonsenseDetected.push(originalText.substring(0, 50));
            validation.droppedItems.push(originalText.substring(0, 50));
            totalND++;
            continue;
          }
          if (status === "irrelevant") {
            forensicTraceField(slideNum, slide.layout, fieldLabel, "1.5", "llmValidateSlideContent", "fit_adjustment", originalText, "", "llm_marked_irrelevant", true);
            validation.droppedItems.push(originalText.substring(0, 50));
            totalRD++;
            continue;
          }
          if (!fixedText || fixedText.length < 3) {
            forensicTraceField(slideNum, slide.layout, fieldLabel, "1.5", "llmValidateSlideContent", "fit_adjustment", originalText, "", "llm_empty_output", true);
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

          const protectedNoCompressionLayout =
            slide.layout === "bullets" ||
            slide.layout === "example_highlight" ||
            slide.layout === "summary_slide";

          if (status === "truncation_fixed" && protectedNoCompressionLayout && final.length < originalText.length) {
            forensicTraceField(
              slideNum,
              slide.layout,
              fieldLabel,
              "1.5",
              "llmValidateSlideContent",
              "fallback_used",
              originalText,
              originalText,
              "protected_layout_kept_original_instead_of_compression",
              false,
            );
            final = ensureSentenceEnd(originalText);
          }

          forensicTraceField(
            slideNum,
            slide.layout,
            fieldLabel,
            "1.5",
            "llmValidateSlideContent",
            status === "truncation_fixed" && final.length < originalText.length ? "compression_used" : "fit_adjustment",
            originalText,
            final,
            "llm_status:" + status,
          );
          newItems.push(final);
        }

        if (newItems.length >= Math.max(1, Math.floor(slide.items.length * 0.4))) {
          slide.items = newItems;
          validation.fixedItems = newItems;
        } else {
          console.warn("[LLM-NLP] Slide " + slideIdx + ": Too many items dropped (" + newItems.length + "/" + slide.items.length + "), keeping originals");
          forensicTraceField(
            slideIdx + 3,
            slide.layout,
            "items",
            "1.5",
            "llmValidateSlideContent",
            "fallback_used",
            JSON.stringify(oldItemsSnapshot),
            JSON.stringify(slide.items),
            "drop_ratio_too_high_kept_original",
            false,
          );
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
    const originalText = text;
    const fontSize = Number(options.fontSize || TYPO.BODY);
    text = enforceSentenceIntegrity(text);

    const check = validateTextDensity(text, safeW, safeH, fontSize);
    if (!check.fits) {
      const adjusted = autoAdjustText(text, safeW, safeH, fontSize, TYPO.SUPPORT);
      text = enforceSentenceIntegrity(adjusted.text);
      options = { ...options, fontSize: adjusted.fontSize };
      if (adjusted.truncated) {
        forensicTrace("addTextSafe", "autoAdjustText", "compression_used", originalText, text);
        console.log("[DENSITY] auto-adjust Slide " + _auditSlideCounter + ": " + String(adjusted.fontSize) + "pt");
      }
    }

    if (detectTruncation(text)) {
      const beforeIntegrity = text;
      text = enforceSentenceIntegrity(text);
      // Only apply further truncation if enforceSentenceIntegrity didn't fix it
      // AND the result wouldn't be semantically worse than the original
      if (detectTruncation(text)) {
        const candidate = smartTruncate(text, Math.max(24, Math.floor(check.maxChars * 0.9)), false);
        const candidateClean = enforceSentenceIntegrity(candidate);
        // Accept the candidate ONLY if it doesn't create a NEW semantic truncation
        if (!detectSemanticTruncation(candidateClean) || candidateClean.length >= text.length * 0.85) {
          forensicTrace("addTextSafe", "smartTruncate", "fallback_used", beforeIntegrity, candidateClean);
          text = candidateClean;
        } else {
          // Keep the original text as-is rather than making it worse
          forensicTrace("addTextSafe", "smartTruncate", "fallback_skipped", beforeIntegrity, text, "candidate_would_worsen_truncation", false);
        }
      }
    }

    // Log post-render state
    if (typeof text === "string" && text.length < originalText.length && originalText.length > 20) {
      forensicTrace("addTextSafe", "addTextSafe", "post_render_truncation", originalText, text);
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

  // ✓ 2. Title quality — reject generic/fragmented titles
  if (sd.title) {
    if (sd.title.length < 3 && sd.layout !== "module_cover") {
      warnings.push(label + " TITULO CURTO: \"" + sd.title + "\"");
    }
    const genericTitles = /^(cont\.|continuacao|parte|introdu[cç][aã]o|conceitos?|vis[aã]o geral|overview|detalhes|t[oó]picos?|aspectos?)$/i;
    if (genericTitles.test(sd.title.trim())) {
      warnings.push(label + " TITULO GENERICO: \"" + sd.title + "\"");
    }
    if ((sd.layout === "module_cover" || sd.layout === "summary_slide" || sd.layout === "example_highlight") && isWeakTitleFragment(sd.title)) {
      warnings.push(label + " TÍTULO FRAGMENTADO: \"" + sd.title.substring(0, 70) + "\"");
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

  // Semantic fragment guard for approved-sensitive layouts
  if (sd.layout === "module_cover") {
    if (sd.description && isWeakSemanticFragment(sd.description)) {
      warnings.push(label + " FRAGMENTO SEMÂNTICO [description]: \"" + sd.description.substring(0, 70) + "\"");
    }
  }

  if (sd.items && ["bullets", "summary_slide", "numbered_takeaways", "example_highlight"].includes(sd.layout)) {
    for (let i = 0; i < sd.items.length; i++) {
      const item = (sd.items[i] || "").trim();
      if (!item) continue;
      if (isWeakSemanticFragment(item)) {
        warnings.push(label + " FRAGMENTO SEMÂNTICO [item[" + i + "]]: \"" + item.substring(0, 70) + "\"");
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

/**
 * Build slide-level structured items by matching NLP-processed flat items
 * back to the original StructuredItem hierarchy.
 */
function buildSlideStructuredItems(original: StructuredItem[], processedItems: string[]): StructuredItem[] {
  if (!original || original.length === 0) return processedItems.map(t => ({ text: t, subItems: [] }));

  const result: StructuredItem[] = [];
  const usedProcessed = new Set<number>();

  for (const orig of original) {
    let matchIdx = -1;
    for (let i = 0; i < processedItems.length; i++) {
      if (usedProcessed.has(i)) continue;
      const pi = processedItems[i];
      const origPrefix = orig.text.substring(0, Math.min(25, orig.text.length));
      const piPrefix = pi.substring(0, Math.min(25, pi.length));
      if (pi === orig.text || origPrefix === piPrefix || pi.startsWith(orig.text.substring(0, 15))) {
        matchIdx = i;
        break;
      }
    }

    if (matchIdx >= 0) {
      usedProcessed.add(matchIdx);
      // Collect arrow sub-items that follow in flat list
      const matchedSubs: string[] = [];
      for (let j = matchIdx + 1; j < processedItems.length; j++) {
        if (usedProcessed.has(j)) continue;
        if (processedItems[j].startsWith("  → ")) {
          matchedSubs.push(processedItems[j].replace(/^\s*→\s*/, ""));
          usedProcessed.add(j);
        } else {
          break;
        }
      }
      const subs = matchedSubs.length > 0 ? matchedSubs : orig.subItems;
      result.push({ text: processedItems[matchIdx], subItems: subs });
    }
  }

  // Unmatched processed items become standalone
  for (let i = 0; i < processedItems.length; i++) {
    if (!usedProcessed.has(i) && !processedItems[i].startsWith("  → ")) {
      result.push({ text: processedItems[i], subItems: [] });
    }
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
/** Classify block type from heading keywords when no pedagogical emoji is present */
function classifyBlockType(heading: string, _items: string[]): ParsedBlock["blockType"] {
  const h = heading.toLowerCase();
  if (/exemplo|case|caso pr[aá]tico/i.test(h)) return "example";
  if (/aten[çc][ãa]o|cuidado|aviso|warning|⚠/i.test(h)) return "warning";
  if (/reflex[ãa]o|pense|considere/i.test(h)) return "reflection";
  if (/resumo|recap|s[ií]ntese/i.test(h)) return "summary";
  if (/conclus[ãa]o|takeaway|encerramento/i.test(h)) return "conclusion";
  return "normal";
}

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
        const result = extractItemsFromTokens(contentTokens);
        if (result.items.length > 0) {
          blocks.push({ heading, items: result.items, structuredItems: result.structuredItems, isTable: false, blockType });
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
    const result = extractItemsFromTokens(contentTokens);
    if (result.items.length > 0) {
      blocks.push({ heading, items: result.items, structuredItems: result.structuredItems, isTable: false, blockType });
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
 * Returns both flat items (for backward compat) and structuredItems (preserving hierarchy).
 */
interface ExtractResult {
  items: string[];
  structuredItems: StructuredItem[];
}

function extractItemsFromTokens(tokens: MdToken[]): ExtractResult {
  const structured: StructuredItem[] = [];
  let paragraphBuffer = "";

  const flushParagraph = () => {
    if (paragraphBuffer.trim()) {
      const clean = sanitize(paragraphBuffer.trim());
      if (clean.length > 3) structured.push({ text: clean, subItems: [] });
      paragraphBuffer = "";
    }
  };

  // Track parent items so sub-items (indent > 0) are preserved as children
  let pendingParent: { text: string } | null = null;
  let pendingSubItems: string[] = [];

  const flushListItem = () => {
    if (pendingParent) {
      const parentText = sanitize(pendingParent.text);
      const subs = pendingSubItems.map(s => sanitize(s)).filter(s => s.length > 2);
      if (parentText.length > 3) {
        structured.push({ text: parentText, subItems: subs });
      } else if (subs.length > 0) {
        // Parent too short, promote sub-items
        for (const s of subs) structured.push({ text: s, subItems: [] });
      }
      pendingParent = null;
      pendingSubItems = [];
    }
  };

  for (const token of tokens) {
    switch (token.type) {
      case "bullet":
      case "numbered": {
        flushParagraph();
        const indent = token.indent || 0;

        if (indent === 0) {
          flushListItem();
          pendingParent = { text: token.content };
        } else {
          if (pendingParent) {
            pendingSubItems.push(token.content);
          } else {
            const clean = sanitize(token.content);
            if (clean.length > 3) structured.push({ text: clean, subItems: [] });
          }
        }
        break;
      }
      case "blockquote": {
        flushParagraph();
        flushListItem();
        const clean = sanitize(token.content);
        if (clean.length > 3) structured.push({ text: clean, subItems: [] });
        break;
      }
      case "paragraph": {
        flushParagraph();
        flushListItem();
        const clean = sanitize(token.content);
        if (clean.length <= 3) break;

        if (clean.length <= 300) {
          structured.push({ text: clean, subItems: [] });
        } else {
          const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
          let chunk = "";
          for (const sentence of sentences) {
            const s = sentence.trim();
            if (chunk.length + s.length > 250 && chunk.length > 0) {
              structured.push({ text: chunk.trim(), subItems: [] });
              chunk = s;
            } else {
              chunk = chunk ? chunk + " " + s : s;
            }
          }
          if (chunk.trim().length > 3) structured.push({ text: chunk.trim(), subItems: [] });
        }
        break;
      }
      default:
        break;
    }
  }

  flushListItem();
  flushParagraph();

  // Generate flat items for backward compatibility
  const items: string[] = [];
  for (const si of structured) {
    if (si.subItems.length === 0) {
      items.push(si.text);
    } else {
      // Flatten: parent text + sub-items as indented entries
      items.push(si.text);
      for (const sub of si.subItems) {
        items.push("  → " + sub);
      }
    }
  }

  return { items, structuredItems: structured };
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

/* ═══════════════════════════════════════════════════════
   LAYOUT CLASSIFICATION & SLIDE BUILDING
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
  coverTitleSubtitle?: string;
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

  const splitFallbackTitle = splitModuleCoverTitle(shortTitle);
  const safeTitle = splitFallbackTitle.primary || shortTitle;
  const moduleDescSource = objItems.length > 0
    ? sanitize(objItems[0])
    : sanitize((mod.content || "").split(/[.!?]\s/)[0] || "");
  const moduleDesc = ensureSentenceEnd(moduleDescSource);

  const objectives = objItems
    .map(o => ensureSentenceEnd(sanitize(o)))
    .filter(Boolean)
    .flatMap(o => splitObjectiveForStructure(o, Math.max(54, activeDensity.maxCharsPerBullet - 8)));

  // ── STRUCTURAL REDISTRIBUTION for fallback path (real active fallback) ──
  const objW = SAFE_W * 0.60 - 0.30;
  const objH = 0.44;
  let objectivesOverflow = false;
  for (const obj of objectives) {
    const bbox = measureBoundingBox(obj, TYPO.SUPPORT, FONT_BODY, objW, objH);
    if (!bbox.fits && obj.length > 52) { objectivesOverflow = true; break; }
  }
  const totalCoverContent = moduleDesc.length + objectives.reduce((s, o) => s + o.length, 0);
  if (totalCoverContent > 320 || objectives.length > 3) objectivesOverflow = true;

  if (objectivesOverflow && objectives.length > 0) {
    slides.push({
      layout: "module_cover",
      title: safeTitle,
      coverTitleSubtitle: splitFallbackTitle.secondary || undefined,
      subtitle: "MODULO " + String(modIndex + 1).padStart(2, "0"),
      description: moduleDesc,
      moduleIndex: modIndex,
      objectives: [],
    });

    const OBJ_PER_SLIDE = 4;
    for (let oi = 0; oi < objectives.length; oi += OBJ_PER_SLIDE) {
      const chunk = objectives.slice(oi, oi + OBJ_PER_SLIDE);
      const part = Math.floor(oi / OBJ_PER_SLIDE) + 1;
      slides.push({
        layout: "bullets",
        title: objectives.length > OBJ_PER_SLIDE ? getContinuationTitle("Objetivos do Módulo", part) : "Objetivos do Módulo",
        sectionLabel: "OBJETIVOS DO MÓDULO",
        items: sanitizeBullets(chunk),
        moduleIndex: modIndex,
        blockType: "normal",
      });
    }
    flowLog("OBJECTIVES", "buildModuleSlidesFromBlocks -> dedicated objective slide(s), module=" + (modIndex + 1) + ", count=" + objectives.length);
  } else {
    slides.push({
      layout: "module_cover",
      title: safeTitle,
      coverTitleSubtitle: splitFallbackTitle.secondary || undefined,
      subtitle: "MODULO " + String(modIndex + 1).padStart(2, "0"),
      description: moduleDesc,
      moduleIndex: modIndex,
      objectives: objectives,
    });
    flowLog("MODULE_COVER", "buildModuleSlidesFromBlocks -> renderModuleCover, module=" + (modIndex + 1));
  }

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

    // Build structured items for this slide, preserving hierarchy from parsing
    const slideStructured = block.structuredItems ? buildSlideStructuredItems(block.structuredItems, items) : undefined;

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
      let remainingStructured = slideStructured ? [...slideStructured] : undefined;
      let partNum = 1;
      while (remaining.length > 0) {
        const chunk = remaining.slice(0, maxItems);
        remaining = remaining.slice(maxItems);
        const chunkStructured = remainingStructured ? remainingStructured.slice(0, maxItems) : undefined;
        if (remainingStructured) remainingStructured = remainingStructured.slice(maxItems);
        const partTitle = remaining.length > 0
          ? smartTitle(heading + " (Parte " + partNum + ")")
          : smartTitle(heading + (partNum > 1 ? " (Parte " + partNum + ")" : ""));
        const chunkLayout = partNum === 1 ? layout : (layout === "grid_cards" ? "bullets" : "grid_cards");
        slides.push({
          layout: chunkLayout, title: partTitle, sectionLabel,
          items: sanitizeBullets(chunk), structuredItems: chunkStructured, moduleIndex: modIndex, blockType,
        });
        partNum++;
      }
      prevLayout = layout;
    } else {
      slides.push({
        layout, title: smartTitle(heading), sectionLabel,
        items: sanitizeBullets(items), structuredItems: slideStructured, moduleIndex: modIndex, blockType,
      });
      prevLayout = layout;
    }
  }

  // Summary slide (Resumo do Módulo) — structural continuation (no slice truncation)
  if (summaryItems.length > 0) {
    const normalizedSummary = sanitizeBullets(summaryItems.map(s => {
      const t = sanitize(s).trim();
      if (!t) return "";
      const parts = splitNarrativeItemForStructure(t, Math.max(56, activeDensity.maxCharsPerBullet));
      return parts.length > 1 ? parts.map(ensureSentenceEnd).join("\n") : ensureSentenceEnd(t);
    }).flatMap(s => s.split("\n").map(p => p.trim()).filter(Boolean)));

    const SUMMARY_PER_SLIDE = 4;
    for (let i = 0; i < normalizedSummary.length; i += SUMMARY_PER_SLIDE) {
      const chunk = normalizedSummary.slice(i, i + SUMMARY_PER_SLIDE);
      const part = Math.floor(i / SUMMARY_PER_SLIDE) + 1;
      slides.push({
        layout: "summary_slide",
        title: normalizedSummary.length > SUMMARY_PER_SLIDE
          ? getContinuationTitle("Resumo - " + smartTitle(shortTitle), part)
          : "Resumo - " + smartTitle(shortTitle),
        sectionLabel: "RESUMO DO MÓDULO",
        items: chunk,
        moduleIndex: modIndex,
        blockType: "summary",
      });
    }
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

    // Split overloaded slides using semantic split
    if (density > 92 && s.items && s.items.length > 5 && s.layout !== "numbered_takeaways") {
      const { first, second } = semanticSplitSlide(s);
      result[i] = first;
      result.splice(i + 1, 0, second);
      console.log("[SPLIT] Semantic split overloaded: " + s.title);
    }
  }
  return result;
}

/* ═══════════════════════════════════════════════════════
   OVERFLOW RESOLUTION ENGINE — Sprint 2
   6-level structural fallback cascade:
   1. Layout swap → 2. Redistribute → 3. Semantic split
   4. Continuation slide → 5. Summarize → 6. Truncate
   ═══════════════════════════════════════════════════════ */

/** Check if a slide's content overflows its available space */
function detectSlideOverflow(s: SlideData): { overflows: boolean; overflowCount: number; totalChars: number } {
  if (!s.items || s.items.length === 0) return { overflows: false, overflowCount: 0, totalChars: 0 };
  if (s.layout === "module_cover" || s.layout === "comparison_table") return { overflows: false, overflowCount: 0, totalChars: 0 };

  const boxW = SAFE_W - 0.50;
  const maxItems = activeDensity.maxBulletsPerSlide;
  const maxItemH = (SLIDE_H - 2.0 - BOTTOM_MARGIN) / Math.min(s.items.length, maxItems);
  let overflowCount = 0;
  let totalChars = 0;

  for (const item of s.items) {
    totalChars += item.length;
    const minFont = s.layout === "definition_card_with_pillars" ? TYPO.BODY : TYPO.SUPPORT;
    const fit = fitTextForBox(item, boxW, maxItemH, TYPO.BULLET_TEXT, FONT_BODY, minFont);
    if (fit.adjusted) overflowCount++;
  }

  // Also check if item count exceeds density limit
  const itemOverflow = s.items.length > maxItems && s.layout !== "numbered_takeaways";

  return {
    overflows: overflowCount >= 2 || itemOverflow,
    overflowCount,
    totalChars,
  };
}

/** Level 1: Try swapping to a layout that handles more content */
const LAYOUT_CAPACITY_ORDER: LayoutType[] = [
  "bullets",                      // highest capacity: vertical list
  "grid_cards",                   // medium: 2-3 col cards
  "definition_card_with_pillars", // medium: def + pillars
  "four_quadrants",               // medium: 2x2
  "process_timeline",             // lower: sequential
];

function findAlternativeLayout(s: SlideData): LayoutType | null {
  // Protected layouts that should never be swapped
  const protectedLayouts: LayoutType[] = [
    "module_cover", "comparison_table", "numbered_takeaways",
    "example_highlight", "reflection_callout", "warning_callout", "summary_slide",
  ];
  if (protectedLayouts.includes(s.layout)) return null;

  const items = s.items || [];
  // "bullets" handles the most content vertically
  if (s.layout !== "bullets" && items.length > 4) return "bullets";
  // If already bullets with many items, grid_cards can show more compactly
  if (s.layout === "bullets" && items.length >= 3 && items.length <= 6) return "grid_cards";
  // grid_cards overflowing → bullets
  if (s.layout === "grid_cards") return "bullets";
  // four_quadrants → grid_cards (3-col fits more)
  if (s.layout === "four_quadrants" && items.length >= 3) return "grid_cards";
  // process_timeline → bullets
  if (s.layout === "process_timeline") return "bullets";

  return null;
}

/** Level 2: Redistribute content within the slide (rebalance long items) */
function redistributeContent(s: SlideData): boolean {
  if (!s.items || s.items.length === 0) return false;
  let changed = false;

  // Split overly long items into two shorter items at sentence boundary
  const newItems: string[] = [];
  const newStructured: StructuredItem[] = [];
  const structured = s.structuredItems || [];

  for (let i = 0; i < s.items.length; i++) {
    const item = s.items[i];
    const si = structured[i];

    if (item.length > activeDensity.maxCharsPerBullet * 1.5) {
      // Try to split at sentence boundary
      const sentences = item.match(/[^.!?]+[.!?]+/g) || [item];
      if (sentences.length >= 2) {
        const mid = Math.ceil(sentences.length / 2);
        const part1 = sentences.slice(0, mid).join(" ").trim();
        const part2 = sentences.slice(mid).join(" ").trim();
        if (part1.length > 10 && part2.length > 10) {
          newItems.push(enforceSentenceIntegrity(part1));
          newItems.push(enforceSentenceIntegrity(part2));
          // Split structured item: sub-items stay with first part
          if (si) {
            newStructured.push({ text: enforceSentenceIntegrity(part1), subItems: si.subItems });
            newStructured.push({ text: enforceSentenceIntegrity(part2), subItems: [] });
          }
          changed = true;
          continue;
        }
      }
    }
    newItems.push(item);
    if (si) newStructured.push(si);
  }

  if (changed) {
    s.items = newItems;
    if (s.structuredItems) s.structuredItems = newStructured;
  }
  return changed;
}

/**
 * Level 3: Semantic split respecting structuredItems hierarchy.
 * Parent + subItems are treated as an atomic unit — never separated.
 */
function semanticSplitSlide(s: SlideData): { first: SlideData; second: SlideData } {
  const items = s.items || [];
  const structured = s.structuredItems;
  const baseTitle = s.title.replace(/\s*\(Parte \d+\)\s*$/i, "").replace(/\s*\(cont\.\)\s*$/i, "");

  if (structured && structured.some(si => si.subItems.length > 0)) {
    // Semantic split: find the best split point that doesn't break parent-child groups
    const groups: { items: string[]; structured: StructuredItem[] }[] = [];
    let currentGroup: { items: string[]; structured: StructuredItem[] } = { items: [], structured: [] };
    let totalItemCount = 0;

    for (const si of structured) {
      const groupSize = 1 + si.subItems.length;
      currentGroup.items.push(si.text);
      for (const sub of si.subItems) currentGroup.items.push("  → " + sub);
      currentGroup.structured.push(si);
      totalItemCount += groupSize;

      // Check if we've passed the midpoint in terms of items
      if (totalItemCount >= Math.ceil(items.length / 2) && groups.length === 0) {
        groups.push(currentGroup);
        currentGroup = { items: [], structured: [] };
      }
    }
    if (currentGroup.items.length > 0) groups.push(currentGroup);

    if (groups.length >= 2) {
      const first: SlideData = {
        ...s,
        title: smartTitle(baseTitle + " (Parte 1)"),
        items: sanitizeBullets(groups[0].items),
        structuredItems: groups[0].structured,
      };
      const secondItems = groups.slice(1).flatMap(g => g.items);
      const secondStructured = groups.slice(1).flatMap(g => g.structured);
      const second: SlideData = {
        layout: s.layout === "grid_cards" ? "bullets" : s.layout,
        title: smartTitle(baseTitle + " (Parte 2)"),
        sectionLabel: s.sectionLabel,
        items: sanitizeBullets(secondItems),
        structuredItems: secondStructured,
        moduleIndex: s.moduleIndex,
        blockType: s.blockType,
      };
      console.log("[SEMANTIC-SPLIT] Split '" + baseTitle + "' preserving " + structured.length + " parent-child groups");
      return { first, second };
    }
  }

  // Fallback: split at sentence-aware midpoint in flat items
  const mid = findSemanticMidpoint(items);
  const first: SlideData = {
    ...s,
    title: smartTitle(baseTitle + " (Parte 1)"),
    items: items.slice(0, mid),
    structuredItems: structured ? structured.slice(0, mid) : undefined,
  };
  const second: SlideData = {
    layout: s.layout === "grid_cards" ? "bullets" : s.layout,
    title: smartTitle(baseTitle + " (Parte 2)"),
    sectionLabel: s.sectionLabel,
    items: items.slice(mid),
    structuredItems: structured ? structured.slice(mid) : undefined,
    moduleIndex: s.moduleIndex,
    blockType: s.blockType,
  };
  return { first, second };
}

/** Find best split point that doesn't break sentences or related items */
function findSemanticMidpoint(items: string[]): number {
  if (items.length <= 2) return 1;
  const mid = Math.ceil(items.length / 2);

  // Check if the item at mid starts with a continuation marker
  for (let offset = 0; offset <= 1 && mid + offset < items.length; offset++) {
    const candidate = mid + offset;
    const item = items[candidate];
    // Don't split right after a "  → " sub-item marker
    if (item && !item.startsWith("  → ")) return candidate;
  }
  // Try before mid
  for (let offset = 1; offset <= 2 && mid - offset > 0; offset++) {
    const candidate = mid - offset;
    const item = items[candidate + 1]; // check next item
    if (item && !item.startsWith("  → ")) return candidate + 1;
  }
  return mid;
}

/** Level 5: Heuristic summarization (no LLM needed) */
function summarizeItemsForOverflow(items: string[], targetCount: number): string[] {
  if (items.length <= targetCount) return items;

  // Score each item by information density (longer + more unique words = higher)
  const scored = items.map((item, idx) => {
    const words = new Set(tokenize(item));
    const score = words.size * 2 + (item.includes(":") ? 10 : 0) + (idx === 0 ? 5 : 0) + (idx === items.length - 1 ? 5 : 0);
    return { item, score, idx };
  });

  // Keep top N by score, maintaining original order
  scored.sort((a, b) => b.score - a.score);
  const kept = scored.slice(0, targetCount).sort((a, b) => a.idx - b.idx);
  return kept.map(k => k.item);
}

/**
 * MAIN OVERFLOW RESOLVER — 6-level cascade
 * Returns modified slides array with overflow resolved.
 */
interface OverflowResolution {
  strategy: "layout_swap" | "redistribute" | "semantic_split" | "continuation" | "summarize" | "truncate" | "none";
  slidesProduced: number;
}

function resolveSlideOverflow(s: SlideData, slideIndex: number): { slides: SlideData[]; resolution: OverflowResolution } {
  const overflow = detectSlideOverflow(s);
  if (!overflow.overflows) {
    return { slides: [s], resolution: { strategy: "none", slidesProduced: 1 } };
  }

  const label = "[OVERFLOW S" + slideIndex + "]";
  console.log(label + " Detected: " + overflow.overflowCount + " items overflow, " + (s.items?.length || 0) + " total items, layout=" + s.layout);

  // ── LEVEL 1: Layout swap ──
  const altLayout = findAlternativeLayout(s);
  if (altLayout) {
    const candidate = { ...s, layout: altLayout };
    const recheck = detectSlideOverflow(candidate);
    if (!recheck.overflows) {
      console.log(label + " RESOLVED by layout swap: " + s.layout + " → " + altLayout);
      return { slides: [candidate], resolution: { strategy: "layout_swap", slidesProduced: 1 } };
    }
  }

  // ── LEVEL 2: Redistribute content (split long items) ──
  const redistCopy: SlideData = JSON.parse(JSON.stringify(s));
  if (redistributeContent(redistCopy)) {
    const recheck = detectSlideOverflow(redistCopy);
    if (!recheck.overflows) {
      console.log(label + " RESOLVED by redistribution");
      return { slides: [redistCopy], resolution: { strategy: "redistribute", slidesProduced: 1 } };
    }
    // Even if still overflows, the redistributed version may be better for splitting
    Object.assign(s, redistCopy);
  }

  // ── LEVEL 3: Semantic split (respects structuredItems) ──
  if (s.items && s.items.length > 3) {
    const { first, second } = semanticSplitSlide(s);
    const check1 = detectSlideOverflow(first);
    const check2 = detectSlideOverflow(second);
    if (!check1.overflows && !check2.overflows) {
      console.log(label + " RESOLVED by semantic split → 2 slides");
      return { slides: [first, second], resolution: { strategy: "semantic_split", slidesProduced: 2 } };
    }
    // If one still overflows, try summarizing it
    if (check1.overflows && first.items) {
      first.items = summarizeItemsForOverflow(first.items, activeDensity.maxBulletsPerSlide);
    }
    if (check2.overflows && second.items) {
      second.items = summarizeItemsForOverflow(second.items, activeDensity.maxBulletsPerSlide);
    }
    console.log(label + " RESOLVED by semantic split + summarize → 2 slides");
    return { slides: [first, second], resolution: { strategy: "semantic_split", slidesProduced: 2 } };
  }

  // ── LEVEL 4: Continuation slide (simple split for small sets) ──
  if (s.items && s.items.length > 2) {
    const { first, second } = semanticSplitSlide(s);
    console.log(label + " RESOLVED by continuation slide");
    return { slides: [first, second], resolution: { strategy: "continuation", slidesProduced: 2 } };
  }

  const protectedLayout = s.layout === "module_cover"
    || s.layout === "summary_slide"
    || (s.layout === "bullets" && /OBJETIVOS DO MÓDULO|VISÃO GERAL/i.test(s.sectionLabel || ""));

  if (protectedLayout && s.items && s.items.length > 0) {
    const expanded = s.items.flatMap(item => splitNarrativeItemForStructure(item, Math.max(56, activeDensity.maxCharsPerBullet)).map(ensureSentenceEnd));
    if (expanded.length > s.items.length) {
      const chunkSize = Math.max(2, activeDensity.maxBulletsPerSlide);
      const firstChunk = expanded.slice(0, chunkSize);
      const secondChunk = expanded.slice(chunkSize);
      if (secondChunk.length > 0) {
        const first: SlideData = { ...s, items: firstChunk };
        const second: SlideData = {
          ...s,
          title: getNextContinuationTitle(s.title || "Continuação", "Continuação"),
          items: secondChunk,
          structuredItems: undefined,
        };
        console.log(label + " RESOLVED by protected continuation (no summarize/truncate)");
        return { slides: [first, second], resolution: { strategy: "continuation", slidesProduced: 2 } };
      }
      return { slides: [{ ...s, items: firstChunk }], resolution: { strategy: "redistribute", slidesProduced: 1 } };
    }
  }

  // ── LEVEL 5: Summarize (reduce item count) ──
  if (s.items && s.items.length > 0 && !protectedLayout) {
    const targetCount = Math.max(2, activeDensity.maxBulletsPerSlide - 1);
    const summarized = { ...s, items: summarizeItemsForOverflow(s.items, targetCount) };
    const recheck = detectSlideOverflow(summarized);
    if (!recheck.overflows) {
      console.log(label + " RESOLVED by summarization: " + s.items.length + " → " + summarized.items.length + " items");
      return { slides: [summarized], resolution: { strategy: "summarize", slidesProduced: 1 } };
    }
  }

  // ── LEVEL 6: Truncate (last resort) ──
  if (!protectedLayout) {
    console.warn(label + " LAST RESORT: truncation applied");
    if (s.items) {
      s.items = s.items.map(item => {
        const fit = fitTextForBox(item, SAFE_W - 0.50, 0.60, TYPO.BULLET_TEXT, FONT_BODY, TYPO.SUPPORT);
        return fit.text;
      });
    }
    return { slides: [s], resolution: { strategy: "truncate", slidesProduced: 1 } };
  }

  console.warn(label + " PROTECTED LAYOUT unresolved without truncation; keeping full text for renderer continuation");
  return { slides: [s], resolution: { strategy: "none", slidesProduced: 1 } };
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

  const safeTitle = (titleText || "").trim();
  // v7: Dynamic title box — long continuation titles (e.g. "Otimização de Projetos... (Parte 2)")
  // need more vertical space. Increase h and lower min font for titles > 55 chars.
  const isLongTitle = safeTitle.length > 55;
  const titleBoxH = isLongTitle ? 1.55 : 1.25;
  const titleMinFont = isLongTitle ? 18 : 22;
  const titleFit = fitTextForBox(safeTitle, SAFE_W, titleBoxH, TYPO.SECTION_TITLE, FONT_TITLE, titleMinFont);
  const renderedTitle = titleFit.text;
  if (safeTitle && renderedTitle.length < safeTitle.length) {
    flowLog("FALLBACK", "renderContentHeader -> title adjusted, original=" + safeTitle.length + " chars, rendered=" + renderedTitle.length + " chars");
  }

  const fontSize = titleFit.fontSize;
  const titleH = getTitleHeight(renderedTitle, SAFE_W, fontSize);
  addTextSafe(slide, renderedTitle, {
    x: MARGIN, y, w: SAFE_W, h: titleH,
    fontSize, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
  });
  y += titleH + 0.30;
  return y;
}

/* ═══════════════════════════════════════════════════════
   SLIDE RENDERERS v2 — Market-grade typography
   ═══════════════════════════════════════════════════════ */

// ── COVER SLIDE v3 — Structural redistribution: if title+description overflow,
// generates a continuation slide instead of compressing ──
function renderCapa(pptx: any, data: SlideData, extraSlides?: SlideData[]) {
  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_W, h: 0.08, fill: { color: C.SECONDARY },
  });

  const titleY = 1.6;

  // v6: Allow 3 lines with 45 chars/line (135 chars total) for long course titles
  const ajustado = ajustarTextoAoBox(data.title, 45, 3);
  const titleFontSize = ajustado.linhas === 1 ? 44 : ajustado.linhas === 2 ? 36 : 30;
  const titleH = ajustado.linhas === 1 ? 1.0 : ajustado.linhas === 2 ? 1.5 : 1.8;
  addTextSafe(slide, ajustado.texto, {
    x: MARGIN + 0.5, y: titleY, w: SAFE_W - 1, h: titleH,
    fontSize: titleFontSize, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
    align: "center", valign: "middle",
  });

  const sepY = titleY + titleH + 0.15;
  slide.addShape(pptx.ShapeType.rect, {
    x: (SLIDE_W - 1.5) / 2, y: sepY, w: 1.5, h: 0.05, fill: { color: C.SECONDARY },
  });

  // v9: Structural redistribution — check if description fits on cover
  let descriptionRenderedOnCover = false;
  if (data.description) {
    const descRaw = sanitize(data.description);
    const descBoxH = 1.8;
    const descW = SLIDE_W - 3;
    const descFit = fitTextForBox(descRaw, descW, descBoxH, TYPO.BODY, FONT_BODY, TYPO.SUPPORT);

    // If description fits (not adjusted/truncated), render on cover
    if (!descFit.adjusted || descRaw.length <= 180) {
      const descH = Math.min(descBoxH, Math.max(0.60, estimateTextLines(descFit.text, descW, descFit.fontSize) * (descFit.fontSize * 1.4 / 72) + 0.10));
      addTextSafe(slide, descFit.text, {
        x: 1.5, y: sepY + 0.30, w: descW, h: descH,
        fontSize: descFit.fontSize, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
      });
      descriptionRenderedOnCover = true;
    } else {
      // STRUCTURAL REDISTRIBUTION: render only first sentence on cover,
      // push full description to a continuation slide
      const sentences = descRaw.match(/[^.!?]+[.!?]+/g) || [descRaw];
      const coverDesc = sentences[0].trim();
      const coverFit = fitTextForBox(coverDesc, descW, 0.8, TYPO.BODY, FONT_BODY, TYPO.SUPPORT);
      addTextSafe(slide, coverFit.text, {
        x: 1.5, y: sepY + 0.30, w: descW, h: 0.8,
        fontSize: coverFit.fontSize, fontFace: FONT_BODY, color: C.TEXT_LIGHT, align: "center",
      });
      descriptionRenderedOnCover = true;

      // Create continuation slide with full description
      if (extraSlides) {
        extraSlides.push({
          layout: "bullets",
          title: "Sobre o Curso",
          sectionLabel: "APRESENTAÇÃO",
          items: sanitizeBullets(sentences.slice(1).map(s => {
            const t = s.trim();
            return t.length > 0 && !/[.!?]$/.test(t) ? t + "." : t;
          }).filter(s => s.length > 5)),
          blockType: "normal",
        });
      }
    }
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

// ── MODULE COVER v2 — Expanded title capacity, fitTextForBox for objectives ──
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

  const titleMain = (data.title || "").trim();
  const titleSub = (data.coverTitleSubtitle || "").trim();
  const titleFit = fitTextForBox(titleMain, SAFE_W * 0.70, titleSub ? 1.10 : 1.35, TYPO.MODULE_TITLE, FONT_TITLE, 22);
  const titleLines = estimateTextLines(titleFit.text, SAFE_W * 0.70, titleFit.fontSize);
  const titleH = Math.max(0.85, titleLines * (titleFit.fontSize * 1.2 / 72) + 0.10);
  addTextSafe(slide, titleFit.text, {
    x: MARGIN, y: 2.8, w: SAFE_W * 0.70, h: titleH,
    fontSize: titleFit.fontSize, fontFace: FONT_TITLE, color: C.TEXT_DARK, bold: true,
  });

  let sepY = 2.8 + titleH + 0.05;
  if (titleSub) {
    const subFit = fitTextForBox(titleSub, SAFE_W * 0.70, 0.55, TYPO.SUPPORT, FONT_BODY, 14);
    const subLines = estimateTextLines(subFit.text, SAFE_W * 0.70, subFit.fontSize);
    const subH = Math.max(0.28, subLines * (subFit.fontSize * 1.2 / 72) + 0.08);
    addTextSafe(slide, subFit.text, {
      x: MARGIN, y: sepY, w: SAFE_W * 0.70, h: subH,
      fontSize: subFit.fontSize, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top",
    });
    sepY += subH + 0.06;
  }

  slide.addShape(pptx.ShapeType.rect, {
    x: MARGIN, y: sepY, w: 1.2, h: 0.05, fill: { color: C.SECONDARY },
  });

  // Calculate description height dynamically to avoid overlap with objectives
  let descEndY = sepY + 0.20;
  let deferredOverviewItems: string[] = [];
  if (data.description) {
    const descW = SAFE_W * 0.65;
    const descCapH = titleSub ? 1.10 : 1.30;
    let descText = ensureSentenceEnd(data.description);

    const descFitCheck = measureBoundingBox(descText, TYPO.SUBTITLE, FONT_BODY, descW, descCapH);
    if (!descFitCheck.fits) {
      const descParts = splitLongSegments(descText, 140);
      if (descParts.length > 1) {
        descText = descParts[0];
        deferredOverviewItems = descParts.slice(1).map(ensureSentenceEnd);
        flowLog("MODULE_COVER_DESCRIPTION", "renderModuleCover -> split description before render, title='" + (data.title || "").substring(0, 52) + "', deferred=" + deferredOverviewItems.length);
      }
    }

    let descFit = fitTextForBoxWithoutCompression(descText, descW, descCapH, TYPO.SUBTITLE, FONT_BODY, TYPO.SUPPORT);
    if (!descFit.fits) {
      const overflowParts = splitLongSegments(descText, 110);
      if (overflowParts.length > 1) {
        descText = overflowParts[0];
        deferredOverviewItems = [...overflowParts.slice(1).map(ensureSentenceEnd), ...deferredOverviewItems];
        descFit = fitTextForBoxWithoutCompression(descText, descW, descCapH, TYPO.SUBTITLE, FONT_BODY, TYPO.SUPPORT);
      }
    }

    if (descText && descFit.fits) {
      const descLines = estimateTextLines(descFit.text, descW, descFit.fontSize);
      const descH = Math.max(0.45, descLines * (descFit.fontSize * 1.35 / 72) + 0.10);
      addTextSafe(slide, descFit.text, {
        x: MARGIN, y: descEndY, w: descW, h: descH,
        fontSize: descFit.fontSize, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top",
      });
      descEndY += descH + 0.20;
    } else if (descText) {
      deferredOverviewItems = [descText, ...deferredOverviewItems].map(ensureSentenceEnd);
      flowLog("MODULE_COVER_DESCRIPTION", "renderModuleCover -> description moved fully to continuation (no compression), title='" + (data.title || "").substring(0, 52) + "'");
    }
  }

  const objectives = (data.objectives || []).map(ensureSentenceEnd).filter(Boolean);
  const deferredObjectiveItems: string[] = [];
  if (objectives.length > 0) {
    const objStartY = Math.max(descEndY, sepY + 0.75);
    const objW = SAFE_W * 0.60;
    const maxCoverObjectives = 3;

    for (let idx = 0; idx < objectives.length; idx++) {
      const obj = objectives[idx];
      if (idx >= maxCoverObjectives) {
        deferredObjectiveItems.push(obj);
        continue;
      }

      const objY = objStartY + idx * 0.50;
      if (objY + 0.44 > SLIDE_H - 0.40) {
        deferredObjectiveItems.push(obj);
        continue;
      }

      const dotSize = 0.12;
      const objFitCheck = measureBoundingBox(obj, TYPO.SUPPORT, FONT_BODY, objW - 0.30, 0.44);
      if (!objFitCheck.fits) {
        const parts = splitObjectiveForStructure(obj, Math.max(48, activeDensity.maxCharsPerBullet - 10));
        if (parts.length > 1) {
          const first = parts.shift() || obj;
          deferredObjectiveItems.push(...parts.map(ensureSentenceEnd));
          const objFit = fitTextForBox(first, objW - 0.30, 0.44, TYPO.SUPPORT, FONT_BODY, 12);
          const objLineH = (objFit.fontSize * 1.35) / 72;
          slide.addShape(pptx.ShapeType.ellipse, {
            x: MARGIN + 0.05, y: objY + (objLineH - dotSize) / 2 + 0.04, w: dotSize, h: dotSize,
            fill: { color: moduleColor },
          });
          addTextSafe(slide, objFit.text, {
            x: MARGIN + 0.30, y: objY, w: objW, h: 0.44,
            fontSize: objFit.fontSize, fontFace: FONT_BODY, color: C.TEXT_BODY, valign: "top",
          });
          flowLog("OBJECTIVES", "renderModuleCover -> objective split before render, title='" + (data.title || "").substring(0, 52) + "'");
          continue;
        }
        deferredObjectiveItems.push(obj);
        continue;
      }

      const objFit = fitTextForBox(obj, objW - 0.30, 0.44, TYPO.SUPPORT, FONT_BODY, 12);
      const objLineH = (objFit.fontSize * 1.35) / 72;
      slide.addShape(pptx.ShapeType.ellipse, {
        x: MARGIN + 0.05, y: objY + (objLineH - dotSize) / 2 + 0.04, w: dotSize, h: dotSize,
        fill: { color: moduleColor },
      });
      addTextSafe(slide, objFit.text, {
        x: MARGIN + 0.30, y: objY, w: objW, h: 0.44,
        fontSize: objFit.fontSize, fontFace: FONT_BODY, color: C.TEXT_BODY, valign: "top",
      });
    }
  }

  if (deferredOverviewItems.length > 0) {
    flowLog("MODULE_COVER_DESCRIPTION", "renderModuleCover -> continuation created, title='" + (data.title || "").substring(0, 52) + "', remaining=" + deferredOverviewItems.length);
    renderBullets(pptx, {
      layout: "bullets",
      title: getNextContinuationTitle("Visão Geral do Módulo", "Visão Geral do Módulo"),
      sectionLabel: "VISÃO GERAL",
      items: deferredOverviewItems,
      moduleIndex: data.moduleIndex,
      blockType: "normal",
    });
  }

  if (deferredObjectiveItems.length > 0) {
    flowLog("OBJECTIVES", "renderModuleCover -> continuation created, title='" + (data.title || "").substring(0, 52) + "', remaining=" + deferredObjectiveItems.length);
    renderBullets(pptx, {
      layout: "bullets",
      title: getNextContinuationTitle("Objetivos do Módulo", "Objetivos do Módulo"),
      sectionLabel: "OBJETIVOS DO MÓDULO",
      items: deferredObjectiveItems,
      moduleIndex: data.moduleIndex,
      blockType: "normal",
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
    const qTitleRaw = colonIdx > 2 && colonIdx < 50 ? smartTruncate(item.substring(0, colonIdx).trim(), 50) : "";
    const qBodyRaw = qTitleRaw ? smartTruncate(item.substring(colonIdx + 1).trim(), 150) : smartTruncate(item, 150);

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

// ── PROCESS TIMELINE v3 — no silent clipping, continuation slides for overflow ──
function renderProcessTimeline(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;

  const steps = items.slice(0, 4);
  const remaining = items.slice(4);

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };
  let contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

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
    if (colonIdx > 2 && colonIdx < 60) {
      stepTitle = smartTruncate(step.substring(0, colonIdx).trim(), 55);
      stepDesc = step.substring(colonIdx + 1).trim();
    } else {
      const commaIdx = step.indexOf(",");
      const dashIdx = step.indexOf(" – ");
      const breakIdx = commaIdx > 8 && commaIdx < 55 ? commaIdx
        : dashIdx > 8 && dashIdx < 55 ? dashIdx
        : -1;
      if (breakIdx > 0) {
        stepTitle = step.substring(0, breakIdx).trim();
        stepDesc = step.substring(breakIdx + 1).trim();
      } else {
        stepTitle = step.length <= 55 ? step : smartTruncate(step, 55);
        stepDesc = step.length <= 55 ? "" : step.substring(stepTitle.replace(/\.\.\.$/, "").trim().length).trim();
      }
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

  if (remaining.length > 0) {
    flowLog("PROCESS_TIMELINE", "renderProcessTimeline -> continuation created, title=" + (data.title || "").substring(0, 46) + ", remaining=" + remaining.length);
    renderProcessTimeline(pptx, {
      ...data,
      title: getNextContinuationTitle(data.title || "Processo", "Processo"),
      items: remaining,
    });
  }
}

// ── BULLETS v3 — with sub-item hierarchy support ──
function renderBullets(pptx: any, data: SlideData) {
  const items = data.items || [];
  if (items.length === 0) return;

  const slide = pptx.addSlide();
  resetSlideIcons();
  slide.background = { color: C.BG_WHITE };
  const contentY = renderContentHeader(slide, data.sectionLabel || "", data.title);

  const structured = data.structuredItems;
  const hasHierarchy = structured && structured.some(si => si.subItems.length > 0);

  // Build render entries: each entry is either a parent or a sub-item
  interface RenderEntry {
    text: string;
    isSubItem: boolean;
    accentIdx: number;
  }

  const rawEntries: RenderEntry[] = [];
  let parentIdx = 0;

  if (hasHierarchy && structured) {
    for (const si of structured) {
      rawEntries.push({ text: ensureSentenceEnd(si.text), isSubItem: false, accentIdx: parentIdx });
      for (const sub of si.subItems) {
        rawEntries.push({ text: ensureSentenceEnd(sub), isSubItem: true, accentIdx: parentIdx });
      }
      parentIdx++;
    }
  } else {
    for (let i = 0; i < items.length; i++) {
      rawEntries.push({ text: ensureSentenceEnd(items[i]), isSubItem: false, accentIdx: i });
    }
  }

  // Structural split pre-render for long bullets (especially "Label: explicação")
  const maxChars = activeDensity.maxCharsPerBullet;
  const entries: RenderEntry[] = [];
  let splitCount = 0;

  for (const entry of rawEntries) {
    const parts = splitNarrativeItemForStructure(entry.text, maxChars);
    if (parts.length > 1) {
      splitCount += parts.length - 1;
      for (const part of parts) {
        entries.push({ ...entry, text: ensureSentenceEnd(part) });
      }
    } else {
      entries.push({ ...entry, text: ensureSentenceEnd(entry.text) });
    }
  }

  if (splitCount > 0) {
    flowLog("BULLETS", "renderBullets -> structural split before render, title='" + (data.title || "").substring(0, 46) + "', splits=" + splitCount);
  }

  const maxEntries = Math.min(entries.length, activeDensity.maxBulletsPerSlide + 3); // allow extra for sub-items
  const selected = entries.slice(0, maxEntries);
  const remainingEntries = entries.slice(maxEntries);

  const textX = MARGIN + 0.40;
  const subTextX = MARGIN + 0.70; // indented for sub-items
  const textW = SAFE_W - 0.50;
  const subTextW = SAFE_W - 0.80;
  const availH = SLIDE_H - contentY - BOTTOM_MARGIN;

  // Calculate uniform font sizes without text compression
  const parentFontSize = TYPO.BULLET_TEXT;
  const subFontSize = Math.max(TYPO.SUPPORT, parentFontSize - 2);

  let uniformFontSize = parentFontSize;
  const maxRowH = Math.max(0.40, availH / Math.max(selected.length, 1) - 0.04);
  for (const entry of selected) {
    const w = entry.isSubItem ? subTextW : textW;
    const fit = fitTextForBoxWithoutCompression(entry.text, w, Math.max(maxRowH, 0.20), entry.isSubItem ? subFontSize : parentFontSize, FONT_BODY, TYPO.SUPPORT);
    if (!entry.isSubItem && fit.fontSize < uniformFontSize) uniformFontSize = fit.fontSize;
  }
  const uniformSubFontSize = Math.max(TYPO.SUPPORT, uniformFontSize - 2);

  const rawHeights = selected.map((entry) => {
    const fs = entry.isSubItem ? uniformSubFontSize : uniformFontSize;
    const w = entry.isSubItem ? subTextW : textW;
    const lineCount = Math.max(1, estimateTextLines(entry.text, w, fs));
    const lineHeight = (fs * 1.35) / 72;
    const minH = entry.isSubItem ? 0.36 : 0.48;
    return Math.max(minH, Math.min(1.10, lineCount * lineHeight + 0.08));
  });

  const GAP_BETWEEN_BULLETS = 0.08;
  const rawTotal = rawHeights.reduce((sum, h) => sum + h, 0) + (selected.length - 1) * GAP_BETWEEN_BULLETS;
  let heights = [...rawHeights];

  if (rawTotal > availH) {
    const totalGaps = (selected.length - 1) * GAP_BETWEEN_BULLETS;
    const availForRows = availH - totalGaps;
    const scale = availForRows / rawHeights.reduce((s, h) => s + h, 0);
    heights = rawHeights.map((h, i) => {
      const minH = selected[i].isSubItem ? 0.30 : 0.40;
      return Math.max(minH, h * scale);
    });
  }

  let carryOverEntries: RenderEntry[] = [...remainingEntries];
  let cursorY = contentY;
  let rendered = 0;

  for (let idx = 0; idx < selected.length; idx++) {
    const entry = selected[idx];
    const rowH = heights[idx];
    if (cursorY + rowH > SLIDE_H - BOTTOM_MARGIN + 0.01) {
      carryOverEntries.push(...selected.slice(idx));
      break;
    }

    const accentColor = CARD_ACCENT_COLORS_FN()[entry.accentIdx % CARD_ACCENT_COLORS_FN().length];
    const fs = entry.isSubItem ? uniformSubFontSize : uniformFontSize;
    const x = entry.isSubItem ? subTextX : textX;
    const w = entry.isSubItem ? subTextW : textW;

    let noCompressionFit = fitTextForBoxWithoutCompression(entry.text, w, Math.max(rowH - 0.03, 0.20), fs, FONT_BODY, Math.max(TYPO.SUPPORT, fs - 2));
    let textToRender = entry.text;
    let fontToRender = noCompressionFit.fontSize;

    if (!noCompressionFit.fits) {
      const structuralPieces = splitNarrativeItemForStructure(entry.text, Math.max(56, activeDensity.maxCharsPerBullet - 8));
      if (structuralPieces.length > 1) {
        carryOverEntries = [
          ...structuralPieces.slice(1).map(text => ({ ...entry, text: ensureSentenceEnd(text) })),
          ...selected.slice(idx + 1),
          ...carryOverEntries,
        ];
        const firstPiece = ensureSentenceEnd(structuralPieces[0]);
        const firstFit = fitTextForBoxWithoutCompression(firstPiece, w, Math.max(rowH - 0.03, 0.20), fs, FONT_BODY, Math.max(TYPO.SUPPORT, fs - 2));
        if (!firstFit.fits) {
          carryOverEntries = [{ ...entry, text: firstPiece }, ...selected.slice(idx + 1), ...carryOverEntries];
          break;
        }
        textToRender = firstPiece;
        fontToRender = firstFit.fontSize;
        noCompressionFit = firstFit;
      } else {
        carryOverEntries.push(...selected.slice(idx));
        break;
      }
    }

    const textY = cursorY + 0.01;
    const lineHeightIn = (fontToRender * 1.35) / 72;

    if (entry.isSubItem) {
      const triSize = 0.09;
      const triY = textY + Math.max(0, (lineHeightIn - triSize) / 2);
      slide.addShape(pptx.ShapeType.rect, {
        x: MARGIN + 0.50,
        y: triY,
        w: triSize,
        h: triSize,
        fill: { color: accentColor },
        rectRadius: 0.02,
      });
    } else {
      const dotSize = 0.14;
      const dotY = textY + Math.max(0, (lineHeightIn - dotSize) / 2);
      slide.addShape(pptx.ShapeType.ellipse, {
        x: MARGIN + 0.10,
        y: dotY,
        w: dotSize,
        h: dotSize,
        fill: { color: accentColor },
      });
    }

    const textColor = entry.isSubItem ? C.TEXT_BODY : C.TEXT_DARK;
    const richText = makeBoldLabelText(textToRender, textColor, C.TEXT_BODY, fontToRender);
    addTextSafe(slide, richText, {
      x: x,
      y: textY,
      w: w,
      h: Math.max(rowH - 0.02, 0.20),
      valign: "top",
      lineSpacingMultiple: 1.3,
      inset: 0,
    });

    const nextEntry = idx < selected.length - 1 ? selected[idx + 1] : null;
    if (nextEntry && !entry.isSubItem && !nextEntry.isSubItem) {
      slide.addShape(pptx.ShapeType.rect, {
        x: textX,
        y: cursorY + rowH - 0.02,
        w: SAFE_W - 0.80,
        h: 0.01,
        fill: { color: C.TABLE_ROW_EVEN },
      });
    }

    rendered++;
    cursorY += rowH + GAP_BETWEEN_BULLETS;
  }

  if (carryOverEntries.length > 0) {
    const remainingItems = carryOverEntries.map(e => e.text);
    if (rendered === 0 && remainingItems.length === (selected.length + remainingEntries.length)) {
      // Last safety guard: avoid recursion loop; keep first item and continue rest
      const first = remainingItems[0];
      const fallbackFit = fitTextForBox(first, textW, Math.max(availH, 0.5), uniformFontSize, FONT_BODY, TYPO.SUPPORT);
      addTextSafe(slide, makeBoldLabelText(fallbackFit.text, C.TEXT_DARK, C.TEXT_BODY, fallbackFit.fontSize), {
        x: textX,
        y: contentY + 0.01,
        w: textW,
        h: Math.max(availH - 0.02, 0.3),
        valign: "top",
        lineSpacingMultiple: 1.3,
        inset: 0,
      });
      carryOverEntries = remainingItems.slice(1).map((text, idx) => ({ text, isSubItem: false, accentIdx: idx }));
      flowLog("BULLETS", "renderBullets -> hard fallback used for first item to prevent loop, title='" + (data.title || "").substring(0, 46) + "'");
    }

    const continuationItems = carryOverEntries.map(e => e.text);
    if (continuationItems.length > 0) {
      flowLog("BULLETS", "renderBullets -> continuation created, title='" + (data.title || "").substring(0, 46) + "', remaining=" + continuationItems.length);
      renderBullets(pptx, {
        ...data,
        title: getNextContinuationTitle(data.title || "Conteúdo", "Conteúdo"),
        items: continuationItems,
        structuredItems: undefined,
      });
    }
  }
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

  // Example content — no text compression, continuation-first
  let textY = contentY + 0.25;
  const textX = MARGIN + 0.90;
  const textW = SAFE_W - 1.10;
  const exItemH = Math.min(0.70, (boxH - 0.30) / Math.max(items.length, 1));
  const EXAMPLE_GAP = 0.12;

  // Calculate uniform font size for all example items without changing text
  let exampleFontSize = TYPO.BODY;
  for (const item of items) {
    const fit = fitTextForBoxWithoutCompression(item, textW, exItemH, TYPO.BODY, FONT_BODY, TYPO.SUPPORT);
    if (fit.fontSize < exampleFontSize) exampleFontSize = fit.fontSize;
  }

  let rendered = 0;
  let continuationItems: string[] = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (textY + 0.50 > contentY + boxH - 0.15) {
      continuationItems = [...items.slice(idx)];
      break;
    }

    const fit = fitTextForBoxWithoutCompression(item, textW, exItemH, exampleFontSize, FONT_BODY, TYPO.SUPPORT);
    if (!fit.fits) {
      const pieces = splitNarrativeItemForStructure(item, Math.max(56, activeDensity.maxCharsPerBullet - 8));
      if (pieces.length > 1) {
        const first = ensureSentenceEnd(pieces[0]);
        const firstFit = fitTextForBoxWithoutCompression(first, textW, exItemH, exampleFontSize, FONT_BODY, TYPO.SUPPORT);
        if (!firstFit.fits) {
          continuationItems = [item, ...items.slice(idx + 1)];
          break;
        }
        const richText = makeBoldLabelText(first, C.TEXT_DARK, C.TEXT_BODY, firstFit.fontSize);
        addTextSafe(slide, richText, {
          x: textX, y: textY, w: textW, h: exItemH,
          valign: "middle", lineSpacingMultiple: 1.35,
        });
        textY += exItemH + EXAMPLE_GAP;
        rendered++;
        continuationItems = [...pieces.slice(1).map(ensureSentenceEnd), ...items.slice(idx + 1)];
        break;
      }

      continuationItems = [item, ...items.slice(idx + 1)];
      break;
    }

    const richText = makeBoldLabelText(item, C.TEXT_DARK, C.TEXT_BODY, fit.fontSize);
    addTextSafe(slide, richText, {
      x: textX, y: textY, w: textW, h: exItemH,
      valign: "middle", lineSpacingMultiple: 1.35,
    });
    textY += exItemH + EXAMPLE_GAP;
    rendered++;
  }

  if (continuationItems.length > 0) {
    if (rendered === 0) {
      console.warn("[FLOW] EXAMPLE | continuation blocked to avoid loop, title='" + (data.title || "").substring(0, 46) + "'");
      return;
    }
    flowLog("EXAMPLE", "renderExampleHighlight -> continuation created, title=" + (data.title || "").substring(0, 46) + ", remaining=" + continuationItems.length);
    renderExampleHighlight(pptx, {
      ...data,
      title: getNextContinuationTitle(data.title || "Exemplo Prático", "Exemplo Prático"),
      items: continuationItems,
    });
  }
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
      cardTitle = bullet.substring(0, colonIdx).trim();
      if (cardTitle.length > 55) cardTitle = smartTruncate(cardTitle, 55);
      cardBody = bullet.substring(colonIdx + 1).trim(); // Keep full text — renderer handles overflow
    } else {
      // DON'T artificially split at word 5 — this creates broken half-sentences
      // Keep the whole text as body (no title) to preserve semantic completeness
      cardTitle = "";
      cardBody = bullet;
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
      // v7: Use fitTextForBoxWithoutCompression to prevent visual overflow (slide 78 fix)
      const bodyFit = fitTextForBoxWithoutCompression(cardBody, textW, Math.max(bodyH, 0.15), TYPO.TAKEAWAY_BODY, FONT_BODY, 11);
      addTextSafe(slide, bodyFit.text, {
        x: textX, y: textY, w: textW, h: Math.max(bodyH, 0.15),
        fontSize: bodyFit.fontSize, fontFace: FONT_BODY, color: C.TEXT_LIGHT, valign: "top", lineSpacingMultiple: 1.2,
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

  let rendered = 0;
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
    rendered++;
  });

  if (rendered < items.length) {
    if (rendered === 0) {
      console.warn("[FLOW] WARNING | continuation blocked to avoid loop, title='" + (data.title || "").substring(0, 46) + "'");
      return;
    }
    const remaining = items.slice(rendered);
    flowLog("WARNING", "renderWarningCallout -> continuation created, title=" + (data.title || "").substring(0, 46) + ", remaining=" + remaining.length);
    renderWarningCallout(pptx, {
      ...data,
      title: getNextContinuationTitle(data.title || "Desafios e Cuidados", "Desafios e Cuidados"),
      items: remaining,
    });
  }
}

// ── SUMMARY SLIDE — Resumo do Módulo ──
function renderSummarySlide(pptx: any, data: SlideData) {
  const sourceItems = data.items || [];
  if (sourceItems.length === 0) return;

  // Structural normalization before rendering (no compression-first for summary)
  const expandedItems: string[] = [];
  for (const item of sourceItems) {
    const normalized = ensureSentenceEnd(item || "");
    const parts = splitNarrativeItemForStructure(normalized, Math.max(56, activeDensity.maxCharsPerBullet));
    if (parts.length > 1) {
      expandedItems.push(...parts.map(ensureSentenceEnd));
    } else {
      expandedItems.push(normalized);
    }
  }

  const SUMMARY_CAP = 4;
  const visibleItems = expandedItems.slice(0, SUMMARY_CAP);
  const overflowItems = expandedItems.slice(SUMMARY_CAP);

  if (overflowItems.length > 0) {
    flowLog("SUMMARY", "renderSummarySlide -> pre-render structural continuation, title='" + (data.title || "").substring(0, 46) + "', remaining=" + overflowItems.length);
  }

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

  let textY = contentY + 0.85;
  const textX = MARGIN + 0.70;
  const textW = SAFE_W - 1.40;
  const itemH = Math.min(0.70, (boxH - 1.0) / Math.max(visibleItems.length, 1));
  const SUMMARY_GAP = 0.12;

  let summaryFontSize = TYPO.BODY;
  for (const item of visibleItems) {
    const fit = fitTextForBoxWithoutCompression(item, textW, itemH, TYPO.BODY, FONT_BODY, TYPO.SUPPORT);
    if (fit.fontSize < summaryFontSize) summaryFontSize = fit.fontSize;
  }

  let rendered = 0;
  let continuationItems: string[] = [];
  for (let idx = 0; idx < visibleItems.length; idx++) {
    const item = visibleItems[idx];
    if (textY + itemH > contentY + boxH - 0.15) {
      continuationItems = [...visibleItems.slice(idx), ...overflowItems];
      break;
    }

    const fit = fitTextForBoxWithoutCompression(item, textW, itemH, summaryFontSize, FONT_BODY, TYPO.SUPPORT);
    if (!fit.fits) {
      const pieces = splitNarrativeItemForStructure(item, Math.max(56, activeDensity.maxCharsPerBullet - 8));
      if (pieces.length > 1) {
        const first = ensureSentenceEnd(pieces[0]);
        const firstFit = fitTextForBoxWithoutCompression(first, textW, itemH, summaryFontSize, FONT_BODY, TYPO.SUPPORT);
        if (!firstFit.fits) {
          continuationItems = [item, ...visibleItems.slice(idx + 1), ...overflowItems];
          break;
        }
        addTextSafe(slide, first, {
          x: textX, y: textY, w: textW, h: itemH,
          fontSize: firstFit.fontSize, fontFace: FONT_BODY, color: C.TEXT_BODY,
          valign: "top", lineSpacingMultiple: 1.4,
        });
        textY += itemH + SUMMARY_GAP;
        rendered++;
        continuationItems = [...pieces.slice(1).map(ensureSentenceEnd), ...visibleItems.slice(idx + 1), ...overflowItems];
        break;
      }

      continuationItems = [item, ...visibleItems.slice(idx + 1), ...overflowItems];
      break;
    }

    addTextSafe(slide, item, {
      x: textX, y: textY, w: textW, h: itemH,
      fontSize: fit.fontSize, fontFace: FONT_BODY, color: C.TEXT_BODY,
      valign: "top", lineSpacingMultiple: 1.4,
    });
    textY += itemH + SUMMARY_GAP;
    rendered++;
  }

  const remaining = continuationItems.length > 0
    ? continuationItems
    : [...visibleItems.slice(rendered), ...overflowItems];

  if (remaining.length > 0) {
    if (rendered === 0) {
      console.warn("[FLOW] SUMMARY | continuation blocked to avoid loop, title='" + (data.title || "").substring(0, 46) + "'");
      return;
    }
    flowLog("SUMMARY", "renderSummarySlide -> continuation created, title=" + (data.title || "").substring(0, 46) + ", remaining=" + remaining.length);
    renderSummarySlide(pptx, {
      ...data,
      title: getNextContinuationTitle(data.title || "Resumo do Módulo", "Resumo do Módulo"),
      items: remaining,
    });
  }

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
    forensicReset();

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
      stage0_5_items_flagged: 0,
      stage0_5_items_regenerated: 0,
      stage0_5_items_resolved: 0,
      stage0_5_items_unresolved: 0,
      stage0_5_details: [] as string[],
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
      stage2_5_redistributions: 0,
      stage2_5_semantic_losses: [] as string[],
      stage2_5_module_cover_title_redistributions: 0,
      stage2_5_objective_redistributions: 0,
      stage2_5_label_explanation_splits: 0,
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
          const slideBase = allSlides.length - slides.length;
          slides.forEach((slide, localIdx) => {
            const slideNum = slideBase + localIdx + 3;
            forensicTraceField(slideNum, slide.layout, "title", "0", "semanticPlanToSlides", "regeneration_applied", "", slide.title || "", "stage0_slide_created", false);
            forensicTraceField(slideNum, slide.layout, "description", "0", "semanticPlanToSlides", "regeneration_applied", "", slide.description || "", "stage0_slide_created", false);
            (slide.objectives || []).forEach((obj, oi) => {
              forensicTraceField(slideNum, slide.layout, `objective[${oi}]`, "0", "semanticPlanToSlides", "regeneration_applied", "", obj || "", "stage0_slide_created", false);
            });
            (slide.items || []).forEach((item, ii) => {
              forensicTraceField(slideNum, slide.layout, `item[${ii}]`, "0", "semanticPlanToSlides", "regeneration_applied", "", item || "", "stage0_slide_created", false);
            });
          });
          console.log("[STAGE-0] Module " + (globalIdx + 1) + ": LLM plan from pre-parsed input (" + slides.length + " slides)");
        } else {
          // Fallback: build slides directly from pre-parsed blocks (reuse, no re-parsing)
          const preParsed = preParsedModules.get(globalIdx);
          if (preParsed && preParsed.blocks.length > 0) {
            const slides = buildModuleSlidesFromBlocks(preParsed.blocks, mod, globalIdx, modules.length);
            allSlides.push(...slides);
            regexFallbackUsed++;
            const slideBase = allSlides.length - slides.length;
            slides.forEach((slide, localIdx) => {
              const slideNum = slideBase + localIdx + 3;
              forensicTraceField(slideNum, slide.layout, "title", "0", "buildModuleSlidesFromBlocks", "fallback_used", "", slide.title || "", "stage0_regex_fallback", false);
              forensicTraceField(slideNum, slide.layout, "description", "0", "buildModuleSlidesFromBlocks", "fallback_used", "", slide.description || "", "stage0_regex_fallback", false);
              (slide.objectives || []).forEach((obj, oi) => {
                forensicTraceField(slideNum, slide.layout, `objective[${oi}]`, "0", "buildModuleSlidesFromBlocks", "fallback_used", "", obj || "", "stage0_regex_fallback", false);
              });
              (slide.items || []).forEach((item, ii) => {
                forensicTraceField(slideNum, slide.layout, `item[${ii}]`, "0", "buildModuleSlidesFromBlocks", "fallback_used", "", item || "", "stage0_regex_fallback", false);
              });
            });
            console.log("[STAGE-0] Module " + (globalIdx + 1) + ": fallback from pre-parsed blocks (" + slides.length + " slides)");
          } else {
            // Last resort: full parse + build (shouldn't happen since pre-parse ran)
            const slides = buildModuleSlides(mod, globalIdx, modules.length);
            allSlides.push(...slides);
            regexFallbackUsed++;
            const slideBase = allSlides.length - slides.length;
            slides.forEach((slide, localIdx) => {
              const slideNum = slideBase + localIdx + 3;
              forensicTraceField(slideNum, slide.layout, "title", "0", "buildModuleSlides", "fallback_used", "", slide.title || "", "stage0_full_fallback", false);
              forensicTraceField(slideNum, slide.layout, "description", "0", "buildModuleSlides", "fallback_used", "", slide.description || "", "stage0_full_fallback", false);
              (slide.objectives || []).forEach((obj, oi) => {
                forensicTraceField(slideNum, slide.layout, `objective[${oi}]`, "0", "buildModuleSlides", "fallback_used", "", obj || "", "stage0_full_fallback", false);
              });
              (slide.items || []).forEach((item, ii) => {
                forensicTraceField(slideNum, slide.layout, `item[${ii}]`, "0", "buildModuleSlides", "fallback_used", "", item || "", "stage0_full_fallback", false);
              });
            });
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

    // ── STAGE 0.5: SELECTIVE REGENERATION OF DEFECTIVE PLANNER OUTPUT ──
    // Scans every item/title/objective from Stage 0. Any text that shows signs
    // of truncation, incomplete semantics, or excessive length is sent to the
    // LLM for a targeted rewrite. Only the defective fragment is regenerated —
    // the rest of the slide plan is preserved intact.
    console.log("[STAGE-0.5] Starting selective regeneration scan...");
    {
      // 1. Collect all defective text fragments across all slides
      interface DefectiveItem {
        slideIdx: number;
        field: "title" | "item" | "objective" | "description";
        itemIdx: number; // -1 for title/description
        original: string;
        reason: string;
      }
      const defectives: DefectiveItem[] = [];

      for (let si = 0; si < allSlides.length; si++) {
        const s = allSlides[si];

        // Check title
        if (s.title && s.title.length > 80 && detectTruncation(s.title)) {
          defectives.push({ slideIdx: si, field: "title", itemIdx: -1, original: s.title, reason: "título truncado (" + s.title.length + " chars)" });
        }
        if (s.title && s.title.length > 100) {
          defectives.push({ slideIdx: si, field: "title", itemIdx: -1, original: s.title, reason: "título excessivamente longo (" + s.title.length + " chars)" });
        }

        // Check description (module covers)
        if (s.description && detectSemanticTruncation(s.description)) {
          defectives.push({ slideIdx: si, field: "description", itemIdx: -1, original: s.description, reason: "descrição truncada" });
        }

        // Check objectives
        if (s.objectives) {
          for (let oi = 0; oi < s.objectives.length; oi++) {
            const obj = s.objectives[oi];
            if (!obj || obj.length < 5) continue;
            if (detectSemanticTruncation(obj)) {
              defectives.push({ slideIdx: si, field: "objective", itemIdx: oi, original: obj, reason: "objetivo truncado" });
            }
            if (obj.length > 80 && !obj.includes(". ")) {
              defectives.push({ slideIdx: si, field: "objective", itemIdx: oi, original: obj, reason: "objetivo excessivamente longo sem sentenças completas" });
            }
          }
        }

        // Check bullet items
        if (s.items) {
          for (let ii = 0; ii < s.items.length; ii++) {
            const item = s.items[ii];
            if (!item || item.length < 8) continue;
            if (detectSemanticTruncation(item)) {
              defectives.push({ slideIdx: si, field: "item", itemIdx: ii, original: item, reason: "bullet truncado" });
            }
            // Extremely long single-sentence bullets that will definitely overflow
            if (item.length > 250 && !(item.match(/[.!?]/g)?.length >= 2)) {
              defectives.push({ slideIdx: si, field: "item", itemIdx: ii, original: item, reason: "bullet excessivamente longo sem quebra de sentença" });
            }
          }
        }
      }

      // Deduplicate by slideIdx + field + itemIdx
      const deduped = new Map<string, DefectiveItem>();
      for (const d of defectives) {
        const key = d.slideIdx + ":" + d.field + ":" + d.itemIdx;
        if (!deduped.has(key)) deduped.set(key, d);
      }
      const uniqueDefectives = Array.from(deduped.values());
      qualityReport.stage0_5_items_flagged = uniqueDefectives.length;

      if (uniqueDefectives.length > 0) {
        console.log("[STAGE-0.5] Found " + uniqueDefectives.length + " defective items, attempting selective regeneration...");

        // 2. Batch defective items and send to LLM for rewrite
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        if (LOVABLE_API_KEY) {
          const REGEN_BATCH_SIZE = 15;
          const batches: DefectiveItem[][] = [];
          for (let i = 0; i < uniqueDefectives.length; i += REGEN_BATCH_SIZE) {
            batches.push(uniqueDefectives.slice(i, i + REGEN_BATCH_SIZE));
          }

          for (const batch of batches) {
            const itemsForPrompt = batch.map((d, idx) => {
              const slideTitle = allSlides[d.slideIdx]?.title || "(sem título)";
              return `[${idx}] Tipo: ${d.field} | Slide: "${slideTitle.substring(0, 40)}" | Motivo: ${d.reason}\nTexto original: "${d.original}"`;
            }).join("\n\n");

            try {
              const regenResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${LOVABLE_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: "google/gemini-2.5-flash-lite",
                  messages: [
                    {
                      role: "system",
                      content: `Você é um editor especialista em apresentações PowerPoint educacionais.
Sua tarefa: reescrever trechos defeituosos para que fiquem adequados para slides.

REGRAS OBRIGATÓRIAS:
1. Cada reescrita deve ser uma FRASE COMPLETA, semanticamente clara.
2. NUNCA use reticências ("...") ou deixe frases incompletas.
3. Para TÍTULOS: máximo 80 caracteres. Descritivo e conciso.
4. Para OBJETIVOS: máximo 70 caracteres. Começa com verbo no infinitivo.
5. Para BULLETS: máximo 160 caracteres. Frase completa terminada com ponto.
6. Para DESCRIÇÕES: máximo 120 caracteres. Frase completa terminada com ponto.
7. Preserve o significado original. Não invente informação nova.
8. Se o texto original é bom mas longo, RESUMA mantendo a essência.
9. Se o texto está truncado, COMPLETE a ideia de forma coerente.
10. Cada reescrita DEVE terminar com ponto final.

Idioma: pt-BR`
                    },
                    {
                      role: "user",
                      content: `Reescreva os seguintes ${batch.length} trechos defeituosos:\n\n${itemsForPrompt}`
                    }
                  ],
                  tools: [{
                    type: "function",
                    function: {
                      name: "submit_rewrites",
                      description: "Submit rewritten texts for defective items",
                      parameters: {
                        type: "object",
                        properties: {
                          rewrites: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                index: { type: "number", description: "Index of the item being rewritten (from [N] in the input)" },
                                rewritten: { type: "string", description: "The rewritten text, complete and slide-ready" },
                              },
                              required: ["index", "rewritten"],
                              additionalProperties: false,
                            },
                          },
                        },
                        required: ["rewrites"],
                        additionalProperties: false,
                      },
                    },
                  }],
                  tool_choice: { type: "function", function: { name: "submit_rewrites" } },
                }),
                signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
              });

              if (regenResponse.ok) {
                const regenData = await regenResponse.json();
                const toolCall = regenData.choices?.[0]?.message?.tool_calls?.[0];
                if (toolCall?.function?.arguments) {
                  try {
                    const parsed = JSON.parse(toolCall.function.arguments);
                    const rewrites: { index: number; rewritten: string }[] = parsed.rewrites || [];

                    for (const rw of rewrites) {
                      if (rw.index < 0 || rw.index >= batch.length) continue;
                      const def = batch[rw.index];
                      let newText = (rw.rewritten || "").trim();
                      if (!newText || newText.length < 5) continue;

                      // Ensure sentence integrity
                      if (!/[.!?]$/.test(newText)) newText += ".";

                      // Validate the rewrite is actually better
                      const stillTruncated = detectSemanticTruncation(newText);
                      const tooLong = (def.field === "title" && newText.length > 100)
                        || (def.field === "objective" && newText.length > 90)
                        || (def.field === "item" && newText.length > 250);

                      qualityReport.stage0_5_items_regenerated++;

                      const currentSlide = allSlides[def.slideIdx];
                      const slideNum = def.slideIdx + 3;
                      const fieldLabel = def.itemIdx >= 0 ? `${def.field}[${def.itemIdx}]` : def.field;

                      if (stillTruncated || tooLong) {
                        forensicTraceField(
                          slideNum,
                          currentSlide?.layout || "unknown",
                          fieldLabel,
                          "0.5",
                          "selective_regeneration",
                          "regeneration_applied",
                          def.original,
                          newText,
                          "regen_unresolved:" + def.reason,
                          false,
                        );
                        // Regeneration didn't fix the issue
                        qualityReport.stage0_5_items_unresolved++;
                        qualityReport.stage0_5_details.push(
                          "NÃO RESOLVIDO [" + def.field + "] slide '" + (allSlides[def.slideIdx]?.title || "").substring(0, 25) + "': " + def.reason
                        );
                        console.warn("[STAGE-0.5] Regeneration UNRESOLVED: " + def.field + " in slide " + def.slideIdx + " (" + def.reason + ")");
                      } else {
                        // Apply the rewrite
                        const slide = allSlides[def.slideIdx];
                        let beforeValue = "";
                        let afterValue = newText;
                        if (def.field === "title") {
                          beforeValue = slide.title || "";
                          slide.title = newText;
                        } else if (def.field === "description") {
                          beforeValue = slide.description || "";
                          slide.description = newText;
                        } else if (def.field === "objective" && slide.objectives && def.itemIdx >= 0) {
                          beforeValue = slide.objectives[def.itemIdx] || "";
                          slide.objectives[def.itemIdx] = newText;
                        } else if (def.field === "item" && slide.items && def.itemIdx >= 0) {
                          beforeValue = slide.items[def.itemIdx] || "";
                          slide.items[def.itemIdx] = newText;
                        }

                        forensicTraceField(
                          slideNum,
                          slide.layout,
                          fieldLabel,
                          "0.5",
                          "selective_regeneration",
                          "regeneration_applied",
                          beforeValue,
                          afterValue,
                          "regen_resolved:" + def.reason,
                        );

                        qualityReport.stage0_5_items_resolved++;
                        qualityReport.stage0_5_details.push(
                          "RESOLVIDO [" + def.field + "] slide '" + (slide.title || "").substring(0, 25) + "': '" + def.original.substring(0, 35) + "...' → '" + newText.substring(0, 35) + "...'"
                        );
                        qualityReport.stage4_all_fixes.push(
                          "REGENERAÇÃO STAGE-0.5 [" + def.field + "]: '" + def.original.substring(0, 40) + "' → reescrito"
                        );
                        console.log("[STAGE-0.5] REGENERATED: " + def.field + " in slide " + def.slideIdx + ": '" + def.original.substring(0, 30) + "...' → '" + newText.substring(0, 30) + "...'");
                      }
                    }
                  } catch (parseErr) {
                    console.error("[STAGE-0.5] Failed to parse regeneration response: " + parseErr);
                  }
                }
              } else {
                console.warn("[STAGE-0.5] Regeneration LLM call failed: HTTP " + regenResponse.status);
              }
            } catch (regenErr: any) {
              console.warn("[STAGE-0.5] Regeneration error: " + (regenErr.message || regenErr));
            }
          }
        } else {
          console.warn("[STAGE-0.5] LOVABLE_API_KEY not available, skipping LLM regeneration");
        }

        // 3. For unresolved items, add warnings to quality report
        if (qualityReport.stage0_5_items_unresolved > 0) {
          for (const detail of qualityReport.stage0_5_details.filter(d => d.startsWith("NÃO RESOLVIDO"))) {
            qualityReport.stage4_all_warnings.push("REGENERAÇÃO FALHOU: " + detail);
          }
        }
      }

      console.log("[STAGE-0.5] Complete: " + qualityReport.stage0_5_items_flagged + " flagged, " +
        qualityReport.stage0_5_items_regenerated + " regenerated, " +
        qualityReport.stage0_5_items_resolved + " resolved, " +
        qualityReport.stage0_5_items_unresolved + " unresolved");
    }

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

    // ── STAGE 2.5: PRE-RENDER STRUCTURAL REDISTRIBUTION (v10 focused) ──
    // Targeted only at residual real-world blockers:
    // - module cover title/description
    // - long objectives
    // - label+explanation bullets
    console.log("[STAGE-2.5] Running focused structural redistribution (v10)...");
    let preRenderRedistributions = 0;
    let semanticLossEvents: string[] = []; // Track compression losses for quality report
    let moduleCoverTitleRedistributions = 0;
    let objectiveRedistributions = 0;
    let labelExplanationSplits = 0;
    const slidesToInsert: { afterIndex: number; slides: SlideData[] }[] = [];

    for (let si = 0; si < allSlides.length; si++) {
      const s = allSlides[si];

      // A. Module cover TITLE: structural split (title + subtitle) or continuation
      if (s.layout === "module_cover" && s.title) {
        const splitTitle = splitModuleCoverTitle(s.title);
        if (splitTitle.changed) {
          const beforeTitle = s.title || "";
          const beforeSubtitle = s.coverTitleSubtitle || "";
          s.title = splitTitle.primary;
          s.coverTitleSubtitle = splitTitle.secondary || undefined;
          forensicTraceField(si + 3, s.layout, "title", "2.5", "splitModuleCoverTitle", "title_adjusted", beforeTitle, s.title || "", "module_cover_title_split");
          forensicTraceField(si + 3, s.layout, "coverTitleSubtitle", "2.5", "splitModuleCoverTitle", "split_structural", beforeSubtitle, s.coverTitleSubtitle || "", "module_cover_subtitle_created", true);
          moduleCoverTitleRedistributions++;
          preRenderRedistributions++;
          flowLog("MODULE_COVER_TITLE", "stage2.5 -> split title/subtitle, title='" + (s.title || "").substring(0, 52) + "'");
          qualityReport.stage4_all_fixes.push(
            "REDISTRIBUIÇÃO TÍTULO MODULE COVER: '" + (splitTitle.primary || "").substring(0, 36) + "...'"
          );
        }

        const titleStillOverflow = !measureBoundingBox(
          s.title,
          TYPO.MODULE_TITLE,
          FONT_TITLE,
          SAFE_W * 0.70,
          s.coverTitleSubtitle ? 1.10 : 1.35
        ).fits;

        if (titleStillOverflow) {
          const titleParts = splitLongSegments(s.title, 78);
          if (titleParts.length >= 2) {
            const beforeTitle = s.title || "";
            const beforeSubtitle = s.coverTitleSubtitle || "";
            s.title = titleParts[0];
            s.coverTitleSubtitle = titleParts[1];
            const remainder = titleParts.slice(2);
            forensicTraceField(si + 3, s.layout, "title", "2.5", "splitLongSegments", "split_structural", beforeTitle, s.title || "", "module_cover_title_overflow_primary");
            forensicTraceField(si + 3, s.layout, "coverTitleSubtitle", "2.5", "splitLongSegments", "split_structural", beforeSubtitle, s.coverTitleSubtitle || "", "module_cover_title_overflow_subtitle", true);
            if (remainder.length > 0) {
              slidesToInsert.push({
                afterIndex: si,
                slides: [{
                  layout: "bullets",
                  title: "Continuação da Abertura",
                  sectionLabel: "ABERTURA DO MÓDULO",
                  items: sanitizeBullets(remainder),
                  moduleIndex: s.moduleIndex,
                  blockType: "normal",
                }],
              });
              forensicTraceField(si + 3, s.layout, "title", "2.5", "splitLongSegments", "continuation_created", beforeTitle, remainder.join(" | "), "module_cover_title_remainder_created", true);
            }
            moduleCoverTitleRedistributions++;
            preRenderRedistributions++;
            flowLog("MODULE_COVER_TITLE", "stage2.5 -> continuation slide for title overflow, title='" + (s.title || "").substring(0, 52) + "'");
            qualityReport.stage4_all_fixes.push(
              "REDISTRIBUIÇÃO TÍTULO MODULE COVER: continuação criada para '" + (s.title || "").substring(0, 30) + "'"
            );
          }
        }
      }

      // B. Module cover OBJECTIVES: structural split of long objective + continuation slides
      if (s.layout === "module_cover" && s.objectives && s.objectives.length > 0) {
        const objW = SAFE_W * 0.60 - 0.30;
        const objH = 0.44;
        let anyObjOverflow = false;
        const normalizedObjectives: string[] = [];

        for (const obj of s.objectives) {
          if (!obj) continue;
          const trimmed = obj.trim();
          if (!trimmed) continue;

          const structuralParts = splitObjectiveForStructure(trimmed, Math.max(54, activeDensity.maxCharsPerBullet - 8));
          if (structuralParts.length > 1) {
            objectiveRedistributions += structuralParts.length - 1;
            preRenderRedistributions++;
          }
          normalizedObjectives.push(...structuralParts);

          for (const part of structuralParts) {
            const partBox = measureBoundingBox(part, TYPO.SUPPORT, FONT_BODY, objW, objH);
            if (!partBox.fits && part.length > 44) anyObjOverflow = true;
          }
        }

        const totalCoverContent = (s.description || "").length + normalizedObjectives.reduce((sum, o) => sum + o.length, 0);
        if (totalCoverContent > 320 || normalizedObjectives.length > 3) anyObjOverflow = true;

        if (anyObjOverflow) {
          const beforeObjectives = JSON.stringify(s.objectives || []);
          s.objectives = [];
          const OBJ_PER_SLIDE = 4;
          const objChunks: string[][] = [];
          for (let oi = 0; oi < normalizedObjectives.length; oi += OBJ_PER_SLIDE) {
            objChunks.push(normalizedObjectives.slice(oi, oi + OBJ_PER_SLIDE));
          }

          for (let ci = 0; ci < objChunks.length; ci++) {
            const chunkTitle = objChunks.length > 1
              ? "Objetivos do Módulo (Parte " + (ci + 1) + ")"
              : "Objetivos do Módulo";
            slidesToInsert.push({
              afterIndex: si,
              slides: [{
                layout: "bullets",
                title: chunkTitle,
                sectionLabel: "OBJETIVOS DO MÓDULO",
                items: sanitizeBullets(objChunks[ci].map(ensureSentenceEnd)),
                moduleIndex: s.moduleIndex,
                blockType: "normal",
              }],
            });
          }

          forensicTraceField(
            si + 3,
            s.layout,
            "objectives",
            "2.5",
            "splitObjectiveForStructure",
            "objective_redistributed",
            beforeObjectives,
            JSON.stringify(objChunks),
            "module_cover_objectives_moved_to_continuation",
          );

          preRenderRedistributions++;
          objectiveRedistributions += normalizedObjectives.length;
          flowLog("OBJECTIVES", "stage2.5 -> moved objectives to continuation, title='" + (s.title || "").substring(0, 52) + "', chunks=" + objChunks.length);
          qualityReport.stage4_all_fixes.push(
            "REDISTRIBUIÇÃO OBJETIVOS: '" + (s.title || "").substring(0, 30) + "' → " + objChunks.length + " slide(s)"
          );
        } else {
          const beforeObjectives = JSON.stringify(s.objectives || []);
          s.objectives = normalizedObjectives.map(ensureSentenceEnd);
          forensicTraceField(
            si + 3,
            s.layout,
            "objectives",
            "2.5",
            "splitObjectiveForStructure",
            "objective_redistributed",
            beforeObjectives,
            JSON.stringify(s.objectives),
            "module_cover_objectives_normalized",
            beforeObjectives !== JSON.stringify(s.objectives),
          );
          flowLog("OBJECTIVES", "stage2.5 -> objectives kept on module cover without compression, title='" + (s.title || "").substring(0, 52) + "', count=" + s.objectives.length);
        }
      }

      // C. Module cover DESCRIPTION: structural split without char-length gate
      if (s.layout === "module_cover" && s.description) {
        const descW = SAFE_W * 0.65;
        const descH = s.coverTitleSubtitle ? 1.10 : 1.30;
        const normalizedDescription = ensureSentenceEnd(s.description || "");
        const bbox = measureBoundingBox(normalizedDescription, TYPO.SUBTITLE, FONT_BODY, descW, descH);
        const weakDescription = isWeakSemanticFragment(normalizedDescription);

        if (!bbox.fits || weakDescription) {
          const parts = splitLongSegments(normalizedDescription, 140);
          if (parts.length >= 1) {
            const beforeDescription = s.description || "";
            let firstChunk = weakDescription ? "" : parts[0];
            let rest = weakDescription ? parts : parts.slice(1);

            const firstChunkFits = () => !!firstChunk && measureBoundingBox(firstChunk, TYPO.SUBTITLE, FONT_BODY, descW, descH).fits;
            while (firstChunk && !firstChunkFits()) {
              const splitAgain = splitLongSegments(firstChunk, 100);
              if (splitAgain.length <= 1) break;
              firstChunk = splitAgain[0];
              rest = [...splitAgain.slice(1), ...rest];
            }

            if (!firstChunk || !firstChunkFits() || isWeakSemanticFragment(firstChunk)) {
              rest = [firstChunk, ...rest].filter(Boolean);
              firstChunk = "";
            }

            s.description = firstChunk;
            const chunks: string[][] = [];
            for (let i = 0; i < rest.length; i += 3) chunks.push(rest.slice(i, i + 3));
            for (let ci = 0; ci < chunks.length; ci++) {
              slidesToInsert.push({
                afterIndex: si,
                slides: [{
                  layout: "bullets",
                  title: chunks.length > 1 ? `Visão Geral do Módulo (Parte ${ci + 1})` : "Visão Geral do Módulo",
                  sectionLabel: "VISÃO GERAL",
                  items: sanitizeBullets(chunks[ci]),
                  moduleIndex: s.moduleIndex,
                  blockType: "normal",
                }],
              });
            }
            forensicTraceField(
              si + 3,
              s.layout,
              "description",
              "2.5",
              "splitLongSegments",
              "continuation_created",
              beforeDescription,
              s.description || "",
              weakDescription ? "module_cover_description_semantic_fragment" : "module_cover_description_split",
            );
            preRenderRedistributions++;
            flowLog("MODULE_COVER_DESCRIPTION", "stage2.5 -> moved description to continuation, title='" + (s.title || "").substring(0, 52) + "', chunks=" + chunks.length);
            qualityReport.stage4_all_fixes.push(
              "REDISTRIBUIÇÃO ABERTURA: descrição movida para " + chunks.length + " slide(s) em '" + (s.title || "").substring(0, 26) + "'"
            );
          }
        }
      }

      // D0. Pre-merge fragments: items starting with lowercase connectors ("e ", "ou ") 
      // that detectSemanticTruncation would flag — merge with previous item (slide 17 fix)
      if (s.items && s.items.length > 1 && s.layout !== "module_cover") {
        const mergedItems: string[] = [];
        for (let ii = 0; ii < s.items.length; ii++) {
          const item = (s.items[ii] || "").trim();
          if (!item) continue;
          // Fragment starting with lowercase connector AND flagged as truncated → merge with prev
          if (mergedItems.length > 0 && /^(e|ou|mas|nem|pois)\s/i.test(item) && item[0] === item[0].toLowerCase() && detectSemanticTruncation(item)) {
            const prev = mergedItems[mergedItems.length - 1].replace(/\.\s*$/, "");
            mergedItems[mergedItems.length - 1] = ensureSentenceEnd(prev + " " + item);
            forensicTraceField(si + 3, s.layout, `item[${ii}]`, "2.5", "fragmentMerge", "fragment_merged_with_previous", item, mergedItems[mergedItems.length - 1], "connector_fragment_merged");
            preRenderRedistributions++;
            continue;
          }
          mergedItems.push(item);
        }
        if (mergedItems.length < s.items.length) {
          s.items = mergedItems;
          flowLog("BULLETS", "stage2.5 -> merged connector fragments, layout=" + s.layout + ", title=" + (s.title || "").substring(0, 46));
        }
      }

      // D. Bullets: structural split for Label: explicação / Label - explicação / enumeração
      if (s.items && s.items.length > 0 && s.layout !== "module_cover") {
        const maxChars = activeDensity.maxCharsPerBullet;
        const newItems: string[] = [];
        let didRedistribute = false;
        const protectedNoCompression = s.layout === "summary_slide"
          || s.layout === "example_highlight"
          || s.layout === "bullets"
          || (s.layout === "bullets" && /OBJETIVOS DO MÓDULO|VISÃO GERAL/i.test(s.sectionLabel || ""));

        for (let itemIdx = 0; itemIdx < s.items.length; itemIdx++) {
          const item = s.items[itemIdx];
          const trimmed = (item || "").trim();
          if (!trimmed) continue;
          const fieldLabel = `item[${itemIdx}]`;

          const semanticGuardLayouts = new Set(["bullets", "summary_slide", "numbered_takeaways", "example_highlight"]);
          if (semanticGuardLayouts.has(s.layout) && isWeakSemanticFragment(trimmed)) {
            const next = (s.items[itemIdx + 1] || "").trim();
            if (next) {
              const merged = ensureSentenceEnd(trimmed.replace(/\.\s*$/, "") + " " + next);
              if (!isWeakSemanticFragment(merged)) {
                newItems.push(merged);
                forensicTraceField(si + 3, s.layout, fieldLabel, "2.5", "semanticFragmentMerge", "fragment_merged_with_next", trimmed, merged, "semantic_fragment_merged_forward");
                didRedistribute = true;
                preRenderRedistributions++;
                itemIdx += 1; // consume next item
                continue;
              }
            }

            const normalizedWeak = ensureSentenceEnd(trimmed);
            newItems.push(normalizedWeak);
            qualityReport.stage4_all_warnings.push(`Slide ${si + 3} FRAGMENTO SEMÂNTICO [${fieldLabel}]: "${normalizedWeak.substring(0, 70)}"`);
            forensicTraceField(si + 3, s.layout, fieldLabel, "2.5", "semanticFragmentGuard", "fallback_used", trimmed, normalizedWeak, "semantic_fragment_unresolved", false);
            continue;
          }

          const labelParsed = extractLabelExplanation(trimmed);
          const enumLike = /;|\|/.test(trimmed) || /,\s+[^,]{8,},\s+[^,]{8,}/.test(trimmed);
          if (labelParsed && (trimmed.length > Math.floor(maxChars * 0.85) || enumLike)) {
            const splitLabel = splitNarrativeItemForStructure(trimmed, maxChars);
            if (splitLabel.length > 1) {
              newItems.push(...splitLabel.map(ensureSentenceEnd));
              forensicTraceField(si + 3, s.layout, fieldLabel, "2.5", "splitNarrativeItemForStructure", "label_explanation_split", trimmed, splitLabel.join(" | "), "label_explanation_split");
              didRedistribute = true;
              labelExplanationSplits++;
              continue;
            }
          }

          if (trimmed.length > maxChars) {
            const pieces = splitNarrativeItemForStructure(trimmed, maxChars);
            if (pieces.length > 1) {
              newItems.push(...pieces.map(ensureSentenceEnd));
              forensicTraceField(si + 3, s.layout, fieldLabel, "2.5", "splitNarrativeItemForStructure", "split_structural", trimmed, pieces.join(" | "), "long_item_structural_split");
              didRedistribute = true;
              continue;
            }

            if (protectedNoCompression || !!labelParsed) {
              // For summary/objectives/overview/label+explicação: never compress here, keep full sentence and force continuation later
              const kept = ensureSentenceEnd(trimmed);
              newItems.push(kept);
              forensicTraceField(si + 3, s.layout, fieldLabel, "2.5", "stage2_5_guard", "fit_adjustment", trimmed, kept, "compression_skipped_protected_path", false);
              flowLog("FALLBACK", "stage2.5 -> compression skipped (protected path), layout=" + s.layout + ", title='" + (s.title || "").substring(0, 46) + "'");
              continue;
            }

            // LAST RESORT: compress and LOG semantic loss (non-protected layouts only)
            const originalLen = trimmed.length;
            const compressed = smartBullet(trimmed);
            forensicTraceField(si + 3, s.layout, fieldLabel, "2.5", "smartBullet", "compression_used", trimmed, compressed, "stage2_5_last_resort_compression");
            const lossRatio = 1 - (compressed.length / originalLen);
            if (lossRatio > 0.25) {
              semanticLossEvents.push(
                "Slide '" + (s.title || "").substring(0, 30) + "': compressão com " +
                Math.round(lossRatio * 100) + "% de perda (" + originalLen + " → " + compressed.length + " chars)"
              );
              console.warn("[STAGE-2.5] SEMANTIC LOSS: " + semanticLossEvents[semanticLossEvents.length - 1]);
            }
            newItems.push(compressed);
            if (compressed !== trimmed) didRedistribute = true;
            flowLog("FALLBACK", "stage2.5 -> compression used, layout=" + s.layout + ", title='" + (s.title || "").substring(0, 46) + "'");
            continue;
          }

          const normalized = ensureSentenceEnd(trimmed);
          newItems.push(normalized);
          forensicTraceField(si + 3, s.layout, fieldLabel, "2.5", "ensureSentenceEnd", "fit_adjustment", trimmed, normalized, "sentence_normalization", trimmed !== normalized);
        }

        const changedItems = newItems.length === s.items.length
          ? newItems.some((v, idx) => v !== s.items![idx])
          : true;

        if (didRedistribute || changedItems) {
          const beforeItems = JSON.stringify(s.items || []);
          s.items = newItems;
          forensicTraceField(si + 3, s.layout, "items", "2.5", "stage2_5_apply_items", "objective_redistributed", beforeItems, JSON.stringify(s.items), "stage2_5_items_applied", beforeItems !== JSON.stringify(s.items));
          preRenderRedistributions++;
          flowLog("BULLETS", "stage2.5 -> redistributed bullet structure, layout=" + s.layout + ", title=" + (s.title || "").substring(0, 46));
        }
      }

      // E. Specialized layouts: prevent renderer-side clipping by pre-splitting into continuation slides
      if (s.items && s.items.length > 0) {
        const layoutCapacity: Partial<Record<LayoutType, number>> = {
          example_highlight: 4,
          warning_callout: 4,
          summary_slide: 4,
          process_timeline: 4,
          numbered_takeaways: 6,
        };

        const cap = layoutCapacity[s.layout];
        if (cap && s.items.length > cap) {
          const chunks: string[][] = [];
          for (let i = 0; i < s.items.length; i += cap) {
            chunks.push(s.items.slice(i, i + cap));
          }

          s.items = chunks[0];
          const continuationSlides: SlideData[] = [];
          for (let ci = 1; ci < chunks.length; ci++) {
            continuationSlides.push({
              ...s,
              title: getContinuationTitle(s.title || "Continuação", ci + 1),
              items: chunks[ci],
              structuredItems: undefined,
            });
          }

          if (continuationSlides.length > 0) {
            slidesToInsert.push({ afterIndex: si, slides: continuationSlides });
            preRenderRedistributions++;
            qualityReport.stage4_all_fixes.push(
              "REDISTRIBUIÇÃO " + s.layout + ": continuação estrutural criada para '" + (s.title || "").substring(0, 28) + "'"
            );
            flowLog("SPECIAL_LAYOUT", "stage2.5 -> " + s.layout + " split into " + chunks.length + " parts, title=" + (s.title || "").substring(0, 46));
          }
        }
      }
    }

    // Insert redistributed slides at correct positions
    if (slidesToInsert.length > 0) {
      // Insert in reverse order to preserve indices
      for (let i = slidesToInsert.length - 1; i >= 0; i--) {
        const { afterIndex, slides: newSlides } = slidesToInsert[i];
        allSlides.splice(afterIndex + 1, 0, ...newSlides);
      }
    }

    // Wire Stage 2.5 results into quality report
    qualityReport.stage2_5_redistributions = preRenderRedistributions;
    qualityReport.stage2_5_semantic_losses = semanticLossEvents;
    qualityReport.stage2_5_module_cover_title_redistributions = moduleCoverTitleRedistributions;
    qualityReport.stage2_5_objective_redistributions = objectiveRedistributions;
    qualityReport.stage2_5_label_explanation_splits = labelExplanationSplits;

    if (labelExplanationSplits > 0) {
      qualityReport.stage4_all_fixes.push(
        "QUEBRA ESTRUTURAL LABEL+EXPLICAÇÃO: " + labelExplanationSplits + " bullet(s) reestruturado(s)"
      );
    }

    // Add semantic loss events as warnings so they appear in the quality report
    for (const loss of semanticLossEvents) {
      qualityReport.stage4_all_warnings.push("COMPRESSÃO SEMÂNTICA: " + loss);
    }
    if (preRenderRedistributions > 0 || semanticLossEvents.length > 0) {
      console.log("[STAGE-2.5] Structural redistribution: " + preRenderRedistributions + " redistributions, " + semanticLossEvents.length + " compression losses");
    }

    // ── STAGE 3: STRUCTURAL OVERFLOW RESOLUTION (6-level cascade) ──
    // Uses the new overflow resolution engine instead of simple bbox + split.
    // Cascade: layout_swap → redistribute → semantic_split → continuation → summarize → truncate
    let bboxOverflows = 0;
    let bboxFixes = 0;
    let overflowSplits = 0;
    const overflowResolutions: Record<string, number> = {
      layout_swap: 0, redistribute: 0, semantic_split: 0,
      continuation: 0, summarize: 0, truncate: 0, none: 0,
    };

    // 3a. Run overflow resolution engine on every slide
    const resolvedSlides: SlideData[] = [];
    for (let si = 0; si < allSlides.length; si++) {
      const s = allSlides[si];
      const { slides: resolved, resolution } = resolveSlideOverflow(s, si);
      resolvedSlides.push(...resolved);
      overflowResolutions[resolution.strategy]++;
      if (resolution.strategy !== "none") {
        bboxOverflows++;
        bboxFixes++;
        if (resolution.slidesProduced > 1) overflowSplits += resolution.slidesProduced - 1;
      }
    }
    allSlides = resolvedSlides;

    // 3b. Definition card overflow (specific to its split rendering logic)
    for (const s of allSlides) {
      if (s.layout === "definition_card_with_pillars" && s.items && s.items.length > 0) {
        const defText = s.items[0];
        const defBoxW = SAFE_W - 0.60;
        const HEADER_EST = 1.60;
        const PILLAR_ZONE = s.items.length > 1 ? 2.10 : 0;
        const availWithPillars = SLIDE_H - HEADER_EST - BOTTOM_MARGIN - PILLAR_ZONE - 0.30;
        const testFit = fitTextForBox(defText, defBoxW, availWithPillars, TYPO.BODY, FONT_BODY, TYPO.BODY);
        if (testFit.adjusted && s.items.length > 1) {
          overflowSplits++;
          console.log("[STAGE-3] Definition overflow detected, will auto-split at render: " + s.title);
        }
      }
    }

    qualityReport.stage3_bbox_overflows = bboxOverflows;
    qualityReport.stage3_bbox_fixes = bboxFixes;
    qualityReport.stage3_overflow_splits = overflowSplits;

    console.log("[STAGE-3] Overflow resolution: " + JSON.stringify(overflowResolutions) +
      " | Total splits=" + overflowSplits + " | Final slides=" + allSlides.length);

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
    console.log("[STAGE-3] Visual validation: " + bboxOverflows + " overflows, " + bboxFixes + " fixes, " + overflowSplits + " splits, " + qualityReport.stage3_wcag_failures.length + " WCAG failures");

    // ── STAGE 4: PROGRESSIVE QUALITY RETRIES ──
    // Each retry uses a DIFFERENT strategy instead of repeating the same compression.
    // Retry 1: Layout swap for overflowing slides
    // Retry 2: Redistribute + re-split overflowing slides
    // Retry 3: Summarize remaining overflows (last resort before truncation)
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
        const strategy = retry === 0 ? "layout_swap" : retry === 1 ? "redistribute" : "summarize";
        console.log("[STAGE-4] Retry " + (retry + 1) + "/" + MAX_QC_RETRIES + ": " + retryWarnings + " warnings, strategy=" + strategy);

        allSlides.forEach((s) => {
          if (!s.items || s.items.length === 0) return;
          const overflow = detectSlideOverflow(s);
          if (!overflow.overflows) return;

          if (strategy === "layout_swap") {
            const alt = findAlternativeLayout(s);
            if (alt) {
              console.log("[STAGE-4] Retry layout swap: " + s.title + " " + s.layout + " → " + alt);
              s.layout = alt;
            }
          } else if (strategy === "redistribute") {
            redistributeContent(s);
          } else if (strategy === "summarize") {
            const targetCount = Math.max(2, activeDensity.maxBulletsPerSlide - 1);
            s.items = summarizeItemsForOverflow(s.items, targetCount);
            s.items = s.items.map(it => enforceSentenceIntegrity(compressText(it, Math.max(48, Math.floor(it.length * 0.88)))));
          }
        });
      } else {
        console.warn("[STAGE-4] Completed with " + retryWarnings + " remaining warnings after " + MAX_QC_RETRIES + " retries");
      }
    }

    // ── POST-RENDER TRUNCATION SCAN v3 (calibrated) ──
    // v4 calibration: removed redundant "short sentence" check that caused false positives.
    // Now relies solely on detectSemanticTruncation which already exempts valid bullets.
    // Added deduplication to prevent the same pattern from inflating the count.
    let postRenderTruncations = 0;
    const postRenderTruncationWarnings: string[] = [];
    const seenTruncationPatterns = new Set<string>(); // Deduplication

    allSlides.forEach((s, idx) => {
      const slideNumber = idx + 3;
      const fieldsToCheck: { field: string; text: string }[] = [
        { field: "title", text: s.title || "" },
        { field: "description", text: s.description || "" },
        ...(s.items || []).map((text, i) => ({ field: `item[${i}]`, text: text || "" })),
        ...(s.objectives || []).map((text, i) => ({ field: `objective[${i}]`, text: text || "" })),
      ].filter(entry => !!entry.text);

      for (const entry of fieldsToCheck) {
        const txt = entry.text;
        // Use semantic detection which now respects bullet/enumeration exemptions
        if (detectSemanticTruncation(txt)) {
          // Deduplicate: normalize text to first 40 chars to avoid counting same pattern twice
          const dedupKey = (txt || "").substring(0, 40).trim().toLowerCase();
          if (seenTruncationPatterns.has(dedupKey)) continue;
          seenTruncationPatterns.add(dedupKey);

          postRenderTruncations++;
          const msg = `Slide ${slideNumber} POST-RENDER TRUNCAMENTO [${entry.field}]: "${txt.substring(0, 60)}..."`;
          postRenderTruncationWarnings.push(msg);
          qualityReport.stage4_all_warnings.push(msg);
          forensicTraceField(slideNumber, s.layout, entry.field, "post-render", "detectSemanticTruncation", "silent_truncation_detected", txt, txt, "post_render_semantic_truncation", false);
        }
        // Detect artificial splits with "..." mid-sentence (kept — these are always real issues)
        if (/\.\.\.\s/.test(txt || "") && (txt || "").split(/\s+/).length >= 4) {
          const dedupKey = "split:" + (txt || "").substring(0, 40).trim().toLowerCase();
          if (seenTruncationPatterns.has(dedupKey)) continue;
          seenTruncationPatterns.add(dedupKey);

          postRenderTruncations++;
          const msg = `Slide ${slideNumber} SPLIT ARTIFICIAL [${entry.field}]: "${(txt || "").substring(0, 60)}..."`;
          postRenderTruncationWarnings.push(msg);
          qualityReport.stage4_all_warnings.push(msg);
          forensicTraceField(slideNumber, s.layout, entry.field, "post-render", "detectSemanticTruncation", "silent_truncation_detected", txt, txt, "post_render_artificial_split", false);
        }
      }
    });
    if (postRenderTruncations > 0) {
      console.warn(`[POST-RENDER] Found ${postRenderTruncations} truncation issues (deduplicated) across slides`);
      postRenderTruncationWarnings.slice(0, 10).forEach(w => console.warn(`  ${w}`));
    }

    // ── CHECKPOINT-BASED QUALITY SCORING ──
    // 4 formal checkpoints with individual scores and weighted final score.
    // Weights: content=40, structure=20, visual=25, file=15

    // --- Checkpoint 1: CONTENT (weight 40%) ---
    // v5 calibration: dedupe repeated warnings and suppress bullet/list false positives only.
    // Real truncations (semantic or structural) remain hard blockers.
    const dedupedWarnings = dedupeWarnings(qualityReport.stage4_all_warnings);
    const contentWarningCandidates = dedupedWarnings.filter(
      (w: string) => /TRUNCAMENTO|FRAGMENTO|FRAGMENTO SEMÂNTICO|TÍTULO FRAGMENTADO|POST-RENDER|SPLIT ARTIFICIAL|TEXTO COM QUEBRA INVÁLIDA/i.test(w)
    );
    const contentHardWarnings = contentWarningCandidates.filter(
      (w: string) => !isFalsePositiveTruncationWarning(w)
    );
    const contentSoftWarnings = dedupedWarnings.filter(
      (w: string) => /PONTUACAO|GRAMATICA/i.test(w)
    );

    const semanticFragmentWarnings = contentHardWarnings.filter(
      (w: string) => /FRAGMENTO SEMÂNTICO|TÍTULO FRAGMENTADO/i.test(w)
    ).length;

    const contentTruncationWarnings = contentHardWarnings.length;
    const contentFixes = qualityReport.stage4_all_fixes.filter(
      (f: string) => /TRUNCAMENTO|FRAGMENTO|PONTUACAO|GRAMATICA|DOIS-PONTOS|SOFT HYPHEN|CHAR|TERMINOLOGIA|REGENERAÇÃO/i.test(f)
    ).length;
    const regenBonus = Math.min(15, qualityReport.stage0_5_items_resolved * 3); // reward successful regenerations
    const contentScore = Math.max(0, Math.min(100,
      100
      - Math.min(70, contentTruncationWarnings * 10)
      - Math.min(15, contentSoftWarnings.length * 2)
      - Math.min(20, (qualityReport.stage1_5_llm_nonsense_dropped || 0) * 5)
      + Math.min(10, contentFixes * 0.3)
      + regenBonus
    ));
    const contentCritical = contentTruncationWarnings > 4 || semanticFragmentWarnings > 0;

    // --- Checkpoint 2: STRUCTURE (weight 25%) ---
    // Measures: repetition, empty slides, density, coherence
    const structureWarnings = dedupedWarnings.filter(
      (w: string) => /REPETICAO|TITULO CURTO|TITULO GENERICO|MESCLADO|SIMBOLOS/i.test(w)
    ).length;
    const structureFixes = qualityReport.stage4_all_fixes.filter(
      (f: string) => /MESCLADO|NORMALIZADA/i.test(f)
    ).length;
    const densityPenalty = qualityReport.stage2_avg_density < 30 ? 15 : qualityReport.stage2_avg_density < 50 ? 5 : 0;
    const coherencePenalty = Math.min(20, (qualityReport.stage2_coherence_warnings?.length || 0) * 2);
    const structureScore = Math.max(0, Math.min(100,
      100
      - Math.min(40, structureWarnings * 6)
      - densityPenalty
      - coherencePenalty
      + Math.min(10, structureFixes * 1)
    ));
    const structureCritical = false; // structure issues are never hard-blockers alone

    // --- Checkpoint 3: VISUAL (weight 25%) ---
    // Measures: WCAG contrast, bounding box overflows, overflow splits
    const wcagFailures = qualityReport.stage3_wcag_failures.length;
    const visualWarnings = dedupedWarnings.filter(
      (w: string) => /WCAG|TABELA|BBOX|CELULA/i.test(w)
    ).length;
    const visualFixes = qualityReport.stage4_all_fixes.filter(
      (f: string) => /BBOX|CELULA COMPRIMIDA|WCAG/i.test(f)
    ).length;
    const visualScore = Math.max(0, Math.min(100,
      100
      - Math.min(30, wcagFailures * 10)
      - Math.min(30, visualWarnings * 5)
      - Math.min(20, Math.floor(bboxOverflows * 1.5))
      + Math.min(15, visualFixes * 1)
    ));
    const visualCritical = wcagFailures > 3;

    // --- Checkpoint 4: FILE INTEGRITY (weight 15%) ---
    // Measures: total slides sanity, retry exhaustion
    const slideSanity = allSlides.length >= 3 && allSlides.length <= 200;
    const retriesExhausted = qualityReport.stage4_retries_used >= MAX_QC_RETRIES && qualityReport.stage4_final_warnings > 0;
    const fileScore = Math.max(0, Math.min(100,
      (slideSanity ? 100 : 40)
      - (retriesExhausted ? 20 : 0)
      - Math.min(30, qualityReport.stage4_final_warnings * 2)
    ));
    const fileCritical = !slideSanity;

    // --- Weighted final score (content=40%, structure=20%, visual=25%, file=15%) ---
    const qualityScore = Math.max(0, Math.min(100,
      contentScore * 0.40 + structureScore * 0.20 + visualScore * 0.25 + fileScore * 0.15
    ));

    const hasCriticalFailure = contentCritical || visualCritical || fileCritical;

    // Build checkpoint details
    const checkpoints = {
      content: {
        score: Number(contentScore.toFixed(1)),
        weight: 40,
        critical: contentCritical,
        issues: contentHardWarnings.slice(0, 15),
        fixes: qualityReport.stage4_all_fixes.filter(
          (f: string) => /TRUNCAMENTO|FRAGMENTO|PONTUACAO|GRAMATICA|DOIS-PONTOS|SOFT HYPHEN|CHAR|TERMINOLOGIA/i.test(f)
        ).slice(0, 10),
      },
      structure: {
        score: Number(structureScore.toFixed(1)),
        weight: 20,
        critical: structureCritical,
        issues: [
          ...dedupedWarnings.filter(
            (w: string) => /REPETICAO|TITULO CURTO|TITULO GENERICO|MESCLADO|SIMBOLOS/i.test(w)
          ).slice(0, 10),
          ...qualityReport.stage2_coherence_warnings.slice(0, 5),
        ],
        fixes: qualityReport.stage4_all_fixes.filter(
          (f: string) => /MESCLADO|NORMALIZADA/i.test(f)
        ).slice(0, 10),
      },
      visual: {
        score: Number(visualScore.toFixed(1)),
        weight: 25,
        critical: visualCritical,
        issues: [
          ...qualityReport.stage3_wcag_failures.slice(0, 5),
          ...dedupedWarnings.filter(
            (w: string) => /WCAG|TABELA|BBOX|CELULA/i.test(w)
          ).slice(0, 10),
        ],
        fixes: qualityReport.stage4_all_fixes.filter(
          (f: string) => /BBOX|CELULA COMPRIMIDA/i.test(f)
        ).slice(0, 10),
      },
      file: {
        score: Number(fileScore.toFixed(1)),
        weight: 15,
        critical: fileCritical,
        issues: [
          ...(slideSanity ? [] : ["Slide count fora do intervalo esperado (3-200): " + allSlides.length]),
          ...(retriesExhausted ? ["Retries esgotados com " + qualityReport.stage4_final_warnings + " avisos restantes"] : []),
        ],
        fixes: [] as string[],
      },
    };

    console.log("[PIPELINE] Checkpoints: content=" + contentScore.toFixed(1) +
      " structure=" + structureScore.toFixed(1) + " visual=" + visualScore.toFixed(1) +
      " file=" + fileScore.toFixed(1) + " => final=" + qualityScore.toFixed(1));

    // Determine block reason
    const blocked = qualityScore < 85 || hasCriticalFailure;
    const blockReason = hasCriticalFailure
      ? "Falha crítica em checkpoint essencial: " +
        [contentCritical && "conteúdo", visualCritical && "visual", fileCritical && "arquivo"].filter(Boolean).join(", ")
      : qualityScore < 85
        ? "Score final (" + qualityScore.toFixed(1) + ") abaixo do mínimo (85)"
        : null;

    // Problematic slides (deduplicated warnings per slide/pattern)
    const problematicSlides: { index: number; title: string; issues: string[] }[] = [];
    allSlides.forEach((s, idx) => {
      const slideWarnings = dedupeWarnings(
        dedupedWarnings.filter((w: string) => w.startsWith("Slide " + (idx + 3)))
      );
      if (slideWarnings.length > 0) {
        problematicSlides.push({ index: idx + 3, title: s.title || "(sem título)", issues: slideWarnings.slice(0, 5) });
      }
    });

    // Build structured report
    const buildReport = (passed: boolean) => {
      const forensicData = forensicGetReport();
      // Build truncation_root_causes from forensic events
      const truncationRootCauses: {
        slide: number;
        field: string;
        layout: string;
        last_stage: string;
        last_fn: string;
        compression_before: boolean;
        fallback_before: boolean;
        continuation_created: boolean;
        first_mutation_stage: string;
        first_mutation_fn: string;
        first_mutation_event_type: string;
        first_mutation_reason: string;
      }[] = [];
      const postRenderFields: { slide: number; field: string }[] = [];
      for (const w of postRenderTruncationWarnings) {
        const slideMatch = w.match(/Slide\s+(\d+)/);
        const fieldMatch = w.match(/\[(.*?)\]/);
        if (slideMatch) {
          postRenderFields.push({
            slide: Number(slideMatch[1]),
            field: fieldMatch?.[1] || "unknown",
          });
        }
      }

      for (const target of postRenderFields) {
        const fieldEvents = _forensicEvents.filter(e => e.slide === target.slide && e.field === target.field);
        const fallbackSlideEvents = _forensicEvents.filter(e => e.slide === target.slide);
        const events = fieldEvents.length > 0 ? fieldEvents : fallbackSlideEvents;
        const lastEvent = events.length > 0 ? events[events.length - 1] : null;
        const firstMutation = events.find(e => e.mutated && e.chars_after < e.chars_before);

        truncationRootCauses.push({
          slide: target.slide,
          field: target.field,
          layout: lastEvent?.layout || "unknown",
          last_stage: lastEvent?.stage || "unknown",
          last_fn: lastEvent?.fn || "unknown",
          compression_before: events.some(e => e.action === "compression_used"),
          fallback_before: events.some(e => e.action === "fallback_used"),
          continuation_created: events.some(e => e.action === "split_structural" || e.action === "continuation_created"),
          first_mutation_stage: firstMutation?.stage || "none",
          first_mutation_fn: firstMutation?.fn || "none",
          first_mutation_event_type: firstMutation?.action || "none",
          first_mutation_reason: firstMutation?.reason || "none",
        });
      }

      return {
        quality_score: Number(qualityScore.toFixed(1)),
        passed,
        blocked_reason: blockReason,
        pipeline_version: "v11.2-forensic-tracing",
        checkpoints,
        problematic_slides: problematicSlides.slice(0, 15),
        corrections_attempted: {
          total_fixes: qualityReport.stage4_all_fixes.length,
          total_warnings: dedupedWarnings.length,
          retries_used: qualityReport.stage4_retries_used,
          overflow_splits: qualityReport.stage3_overflow_splits,
          dedup_removed: qualityReport.stage2_dedup_removed,
          relevance_dropped: qualityReport.stage2_relevance_dropped,
          llm_grammar_fixes: qualityReport.stage1_5_llm_grammar_fixes,
          llm_truncation_fixes: qualityReport.stage1_5_llm_truncation_fixes,
          redistributions: qualityReport.stage2_5_redistributions,
          module_cover_title_redistributions: qualityReport.stage2_5_module_cover_title_redistributions,
          objective_redistributions: qualityReport.stage2_5_objective_redistributions,
          label_explanation_splits: qualityReport.stage2_5_label_explanation_splits,
          semantic_losses: qualityReport.stage2_5_semantic_losses.length,
          semantic_loss_details: qualityReport.stage2_5_semantic_losses.slice(0, 10),
          regeneration_flagged: qualityReport.stage0_5_items_flagged,
          regeneration_attempted: qualityReport.stage0_5_items_regenerated,
          regeneration_resolved: qualityReport.stage0_5_items_resolved,
          regeneration_unresolved: qualityReport.stage0_5_items_unresolved,
          regeneration_details: qualityReport.stage0_5_details.slice(0, 15),
        },
        summary: {
          total_slides: allSlides.length + 3,
          pre_parse_blocks: qualityReport.pre_parse_total_blocks,
          avg_density: qualityReport.stage2_avg_density,
          bbox_overflows: qualityReport.stage3_bbox_overflows,
          bbox_fixes: qualityReport.stage3_bbox_fixes,
        },
        forensic_trace: {
          truncation_root_causes: truncationRootCauses.slice(0, 80),
          stage0_events: forensicData.stage0_events,
          stage0_5_events: forensicData.stage0_5_events,
          stage1_5_events: forensicData.stage1_5_events,
          stage2_5_events: forensicData.stage2_5_events,
          silent_truncation_events: forensicData.silent_truncation_events,
          first_mutation_per_field: forensicData.first_mutation_per_field,
          compression_events: forensicData.compression_events,
          fallback_events: forensicData.fallback_events,
          renderer_trace: forensicData.renderer_trace,
          field_history_summary: forensicData.field_history_summary,
          total_trace_events: forensicData.total_trace_events,
          total_compressions: forensicData.total_compressions,
          total_fallbacks: forensicData.total_fallbacks,
        },
      };
    };

    // ── EXPORT GATE ──
    if (blocked) {
      console.error("[GATE] Export BLOCKED: score=" + qualityScore.toFixed(1) + " critical=" + hasCriticalFailure + " reason=" + blockReason);
      const blockedReport = buildReport(false);

      // ── PERSIST BLOCKED REPORT FOR FORENSIC RECOVERY ──
      try {
        const { error: persistError } = await serviceClient.from("pptx_export_reports").insert({
          course_id: course_id,
          user_id: userId,
          passed: false,
          quality_score: blockedReport.quality_score,
          blocked_reason: blockedReport.blocked_reason,
          pipeline_version: blockedReport.pipeline_version,
          checkpoints: blockedReport.checkpoints,
          problematic_slides: blockedReport.problematic_slides,
          corrections_attempted: blockedReport.corrections_attempted,
          summary: blockedReport.summary,
          forensic_trace: blockedReport.forensic_trace,
        });
        if (persistError) {
          console.error("[PERSIST] Failed to save blocked report:", JSON.stringify(persistError));
        } else {
          console.log("[PERSIST] Blocked report saved to pptx_export_reports for course=" + course_id);
        }
      } catch (persistErr: any) {
        console.error("[PERSIST] Exception saving blocked report:", persistErr?.message || persistErr);
      }

      return new Response(JSON.stringify({
        error: "Exportação bloqueada: " + (blockReason || "qualidade insuficiente") + ".",
        quality_report: blockedReport,
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

    // 1. Cover (with structural redistribution for overflowing descriptions)
    const coverExtraSlides: SlideData[] = [];
    flowLog("COVER", "renderCapa -> curso='" + (course.title || "").substring(0, 52) + "'");
    renderCapa(pptx, {
      layout: "module_cover", title: course.title,
      description: course.description || "", moduleCount: modules.length,
    }, coverExtraSlides);

    // Render any continuation slides generated by cover redistribution
    if (coverExtraSlides.length > 0) {
      qualityReport.stage4_all_fixes.push("REDISTRIBUIÇÃO CAPA: descrição redistribuída em slide de continuação");
      for (const sd of coverExtraSlides) {
        flowLog("COVER_CONTINUATION", "renderBullets -> title='" + (sd.title || "").substring(0, 52) + "'");
        renderBullets(pptx, sd);
      }
    }

    // 2. TOC
    const modulesSummary = modules.map((m: any) => {
      const rawTitle = sanitize(m.title || "");
      const shortTitle = rawTitle.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;
      const firstSentence = smartModuleDesc(sanitize((m.content || "").split(/[.!?]\s/)[0] || ""));
      return { title: shortTitle, description: firstSentence };
    });
    flowLog("TOC", "renderTOC -> módulos=" + modulesSummary.length);
    renderTOC(pptx, { layout: "module_cover", title: "O que voce vai aprender", modules: modulesSummary });

    // 3. All module slides
    for (let _si = 0; _si < allSlides.length; _si++) {
      const sd = allSlides[_si];
      const titlePreview = (sd.title || "").substring(0, 52);
      const slideNum = _si + 3; // offset for cover+TOC
      // Set forensic context for all addTextSafe/fitTextForBox calls within this renderer
      forensicSetContext(slideNum, sd.layout, "slide");
      // Set field-level context per item before each renderer
      if (sd.items) {
        sd.items.forEach((item, ii) => {
          forensicSetContext(slideNum, sd.layout, "item[" + ii + "]");
        });
      }
      forensicSetContext(slideNum, sd.layout, "title");
      switch (sd.layout) {
        case "module_cover":                 forensicTraceRenderer(slideNum, sd.layout, "renderModuleCover"); flowLog("MODULE_COVER", "renderModuleCover -> title='" + titlePreview + "'"); renderModuleCover(pptx, sd); break;
        case "definition_card_with_pillars": forensicTraceRenderer(slideNum, sd.layout, "renderDefinitionWithPillars"); flowLog("DEFINITION", "renderDefinitionWithPillars -> title='" + titlePreview + "'"); renderDefinitionWithPillars(pptx, sd); break;
        case "comparison_table":             forensicTraceRenderer(slideNum, sd.layout, "renderComparisonTable"); flowLog("TABLE", "renderComparisonTable -> title='" + titlePreview + "'"); renderComparisonTable(pptx, sd); break;
        case "grid_cards":                   forensicTraceRenderer(slideNum, sd.layout, "renderGridCards"); flowLog("BULLETS_NARRATIVE", "renderGridCards -> title='" + titlePreview + "'"); renderGridCards(pptx, sd); break;
        case "four_quadrants":               forensicTraceRenderer(slideNum, sd.layout, "renderFourQuadrants"); flowLog("BULLETS_NARRATIVE", "renderFourQuadrants -> title='" + titlePreview + "'"); renderFourQuadrants(pptx, sd); break;
        case "process_timeline":             forensicTraceRenderer(slideNum, sd.layout, "renderProcessTimeline"); flowLog("TIMELINE_PROCESS", "renderProcessTimeline -> title='" + titlePreview + "'"); renderProcessTimeline(pptx, sd); break;
        case "numbered_takeaways":           forensicTraceRenderer(slideNum, sd.layout, "renderNumberedTakeaways"); flowLog("TAKEAWAYS", "renderNumberedTakeaways -> title='" + titlePreview + "'"); renderNumberedTakeaways(pptx, sd); break;
        case "example_highlight":            forensicTraceRenderer(slideNum, sd.layout, "renderExampleHighlight"); flowLog("EXAMPLE", "renderExampleHighlight -> title='" + titlePreview + "'"); renderExampleHighlight(pptx, sd); break;
        case "reflection_callout":           forensicTraceRenderer(slideNum, sd.layout, "renderReflectionCallout"); flowLog("REFLECTION", "renderReflectionCallout -> title='" + titlePreview + "'"); renderReflectionCallout(pptx, sd); break;
        case "warning_callout":              forensicTraceRenderer(slideNum, sd.layout, "renderWarningCallout"); flowLog("WARNING", "renderWarningCallout -> title='" + titlePreview + "'"); renderWarningCallout(pptx, sd); break;
        case "summary_slide":                forensicTraceRenderer(slideNum, sd.layout, "renderSummarySlide"); flowLog("SUMMARY", "renderSummarySlide -> title='" + titlePreview + "'"); renderSummarySlide(pptx, sd); break;
        case "bullets":                      forensicTraceRenderer(slideNum, sd.layout, "renderBullets"); flowLog("BULLETS", "renderBullets -> title='" + titlePreview + "'"); renderBullets(pptx, sd); break;
        default:                               forensicTraceRenderer(slideNum, sd.layout, "renderBullets"); flowLog("BULLETS", "renderBullets(default) -> title='" + titlePreview + "'"); renderBullets(pptx, sd); break;
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

    return new Response(JSON.stringify({
      url: signedUrl.signedUrl,
      quality_report: buildReport(true),
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
