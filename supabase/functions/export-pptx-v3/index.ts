import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "npm:pptxgenjs@3.12.0";
import JSZip from "npm:jszip@3.10.1";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { z } from "https://esm.sh/zod@3.23.8";

const ENGINE_VERSION = "4.0.0-COMMERCIAL";

const SlidePlanSchema = z.object({
  layout: z.enum([
    "module_cover",
    "toc",
    "bullets",
    "two_column_bullets",
    "grid_cards",
    "process_timeline",
    "comparison_table",
    "example_highlight",
    "warning_callout",
    "reflection_callout",
    "summary_slide",
    "numbered_takeaways",
    "code_block",
    "closing",
    // Preserva compatibilidade com layouts já existentes no motor atual.
    "definition",
  ]),
  title: z.string().max(72),
  sectionLabel: z.string().max(30).optional(),
  items: z.array(z.string().max(130)).max(6).optional(),
  objectives: z.array(z.string().max(160)).max(3).optional(),
  tableHeaders: z.array(z.string().max(40)).optional(),
  tableRows: z.array(z.array(z.string().max(120))).optional(),
  moduleIndex: z.number().optional(),
  continuationOf: z.string().optional(),
  itemStartIndex: z.number().optional(),
  coverQuery: z.string().max(100).optional(),
  codeLines: z.array(z.string().max(120)).max(16).optional(),
  codeLanguage: z.string().max(30).optional(),
}).passthrough();

function sanitizeAndValidate(raw: any): any[] {
  try {
    const array = Array.isArray(raw) ? raw : [raw];
    return array.map((item) => {
      const result = SlidePlanSchema.safeParse(item);
      if (!result.success) {
        console.warn("[ZOD] Slide inválido → fallback sanitizado");
        return {
          layout: "bullets",
          title: String(item?.title || "Slide"),
          sectionLabel: "CONTEÚDO",
          items: (item?.items || []).slice(0, 5).map((s: any) => String(s).slice(0, 140)),
        };
      }
      return result.data;
    });
  } catch {
    return [];
  }
}

/**
 * GEMMA v3.10.4 — Debug Mode
 * FORÇADO em true para coletar logs de overflow.
 */
const DEBUG_SPLIT = true;
const DEBUG_OVERFLOW = true;
function dbg(tag: string, payload: unknown) {
  if (!DEBUG_SPLIT) return;
  try {
    console.log(`[V3-DEBUG][${tag}] ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  } catch {
    console.log(`[V3-DEBUG][${tag}] <unserializable>`);
  }
}
function classifyItem(item: string): "section" | "item" {
  return isSectionMarker(item) ? "section" : "item";
}
function summarizeItem(item: string, maxLen = 60): string {
  const s = (item || "").replace(/\s+/g, " ").trim();
  return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + "…";
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ╔══════════════════════════════════════════════════════════════════╗
// ║  PPTX EXPORTER v3 — EduGenAI                                   ║
// ║                                                                  ║
// ║  Architecture: AI-Direct JSON Generation                        ║
// ║                                                                  ║
// ║  Pipeline:                                                       ║
// ║    Stage 1: AI CALL  — course content → JSON slides (per module)║
// ║    Stage 2: VALIDATE — normalize + guard JSON from AI           ║
// ║    Stage 3: RENDER   — SlidePlan[] → PptxGenJS slides           ║
// ║    Stage 4: EXPORT   — write PPTX binary + upload               ║
// ║                                                                  ║
// ║  Key difference from v2:                                         ║
// ║    v2: markdown → 7k-line parser → slides                       ║
// ║    v3: content → AI thinks in slides → JSON → render            ║
// ║                                                                  ║
// ║  All render functions (visual engine) are identical to v2.      ║
// ╚══════════════════════════════════════════════════════════════════╝

// ═══════════════════════════════════════════════════════════════════
// SECTION 1: TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

type SlideLayoutV3 =
  | "module_cover"
  | "toc"
  | "bullets"
  | "two_column_bullets"
  | "definition"
  | "grid_cards"
  | "process_timeline"
  | "comparison_table"
  | "example_highlight"
  | "warning_callout"
  | "reflection_callout"
  | "summary_slide"
  | "numbered_takeaways"
  | "closing";

interface SlidePlan {
  layout: SlideLayoutV3;
  title: string;
  sectionLabel?: string;
  subtitle?: string;
  description?: string;
  items?: string[];
  objectives?: string[];
  tableHeaders?: string[];
  tableRows?: string[][];
  moduleIndex?: number;
  continuationOf?: string;
  // GEMMA v3.10.6 — quando um slide é dividido (continuação), preserva o
  // índice base dos badges numerados para manter a sequência (ex.: slide 5
  // termina em "4", o slide 6 deve começar em "5", não em "1").
  itemStartIndex?: number;
  coverQuery?: string;
}

interface PipelineReport {
  totalModules: number;
  totalSlides: number;
  aiCallsTotal: number;
  aiCallsFailed: number;
  fallbacksUsed: number;
  warnings: string[];
  imageDiagnostics?: {
    unsplashKeyPresent: boolean;
    unsplashKeyLength: number;
    includeImages: boolean;
    coverImageFetched: boolean;
    closingImageFetched: boolean;
    moduleImagesFetched: number;
    moduleImagesTotal: number;
    errors: string[];
  };
}

interface DesignConfig {
  theme: "light" | "dark";
  palette: string[];
  fonts: { title: string; body: string };
  density: { maxItemsPerSlide: number; maxCharsPerItem: number };
  includeImages: boolean;
  template: string;
  visualStyle: "classic" | "band" | "minimal";
  courseType: string;
  footerBrand: string | null;
}

interface SlideImage {
  base64Data: string;
  credit: string;
  creditUrl: string;
  photoId?: string;
}

interface ImagePlan {
  cover: SlideImage | null;
  modules: Map<number, SlideImage>;
  closing: SlideImage | null;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 2: DESIGN SYSTEM (identical to v2)
// ═══════════════════════════════════════════════════════════════════

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN = 0.667;
const SAFE_W = SLIDE_W - MARGIN * 2;

// ───────────────────────────────────────────────────────────────────
// GEMMA STANDARD (v3.9) — Geometry / Splitter / Auto-Scale
// ───────────────────────────────────────────────────────────────────

/**
 * SAFE_ZONE — Padrão Gemma. Toda renderização principal de conteúdo
 * deve respeitar essa caixa para garantir que nada vaze para as bordas
 * e que sectionLabel/título/footer convivam com o conteúdo.
 *
 *   X: 0.80   →  margem lateral esquerda
 *   Y: 1.60   →  abaixo do sectionLabel + título
 *   W: 11.70  →  largura útil (SLIDE_W 13.333 - 0.80 esquerda - ~0.83 direita)
 *   H: 5.20   →  altura útil (até ~6.80, deixando espaço para footer)
 */
const SAFE_ZONE = { X: 0.8, Y: 1.6, W: 11.7, H: 5.2 } as const;
// GEMMA v3.10.5 — Limite inferior absoluto do conteúdo. O footer começa em
// SLIDE_H - 0.34 = 7.16. Mantemos 0.36 de respiro: conteúdo nunca passa de 6.80.
const CONTENT_BOTTOM = SAFE_ZONE.Y + SAFE_ZONE.H; // 6.80

/**
 * GEMMA v3.9.5 — Pisos rígidos de fonte.
 * Se o auto-scaling tentar descer abaixo destes valores, o Smart Splitter
 * é forçado a quebrar o slide em vez de "espremer" o texto.
 */
const MIN_FONT = {
  BODY: 18, // corpo do texto (bullets, descrições)
  TITLE: 26, // títulos de slide
  CARD_BODY: 14, // descrições internas a cards (TOC, grids densos)
} as const;

// GEMMA v3.9.8 — limites por layout do TOC. List (≤5 mods): coluna larga aceita ~140 chars.
// Grid (>5 mods): cards compactos, manter 95 chars para não quebrar a grade.
const TOC_DESCRIPTION_LIMIT_LIST = 140;
const TOC_DESCRIPTION_LIMIT_GRID = 95;
// retro-compat: usado em pré-processamento (tocModules) — usa o teto maior.
const TOC_DESCRIPTION_LIMIT = TOC_DESCRIPTION_LIMIT_LIST;
const GRID_MAX_ITEMS = 5;

/**
 * Limites para o Smart Content Splitter.
 * Acima destes limites o slide é dividido automaticamente em
 * "[Título Original]" + "[Título Original] (Continuação)".
 */
const SPLIT_LIMITS = {
  // QUALITY-PHASE-1 — Split mais preventivo: quebra antes da fonte cair ao piso.
  MAX_TOTAL_CHARS: 500, // soma de chars de todos os items (split preventivo)
  MAX_ITEM_CHARS_HARD: 180, // item individual muito longo é quebrado
} as const;

/** Layouts elegíveis para split automático por excesso de itens/chars. */
const SPLITTABLE_LAYOUTS = new Set<SlideLayoutV3>([
  "bullets",
  "two_column_bullets",
  "grid_cards",
  "numbered_takeaways",
  "summary_slide",
]);

/**
 * Marcadores de seção pedagógicos (🧠 ⚙️ ⚠️ 🎯 📌 etc).
 * Usados para detectar itens "rótulo de seção" e impedir que fiquem
 * isolados no final de um slide (regra de agrupamento Gemma v3.9.5).
 */
const SECTION_MARKER_REGEX = /^[\s-]*([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])\uFE0F?/u;

function stripSemanticDivider(text: string): string {
  return sanitizeText(text || "")
    .replace(/^---+\s*/u, "")
    .trim();
}

function splitSemanticLead(text: string): { icon?: string; text: string } {
  const cleaned = stripSemanticDivider(text);
  const match = cleaned.match(/^([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])\uFE0F?\s*(.+)$/u);
  if (!match) return { text: cleaned };
  return { icon: match[1], text: match[2].trim() };
}

function isSectionMarker(item: string): boolean {
  if (!item) return false;
  const trimmed = stripSemanticDivider(item);
  if (!SECTION_MARKER_REGEX.test(trimmed)) return false;
  // Considera "marker" se for um cabeçalho curto (≤ 60 chars, geralmente "🧠 Fundamentos")
  return trimmed.length <= 60;
}

function renderSemanticRuns(
  text: string,
  accentColor: string,
  baseColor: string,
  boldText = false,
): { text: string; options: any }[] | null {
  const semantic = splitSemanticLead(text);
  if (!semantic.icon) return colorizeIconRuns(stripSemanticDivider(text), accentColor, baseColor);
  return [
    { text: `${semantic.icon} `, options: { color: accentColor, bold: true } },
    { text: semantic.text, options: { color: baseColor, bold: boldText } },
  ];
}

function getRenderableTextLength(text: string): number {
  const semantic = splitSemanticLead(text);
  return semantic.text.length || stripSemanticDivider(text).length;
}

function normalizeRenderableBulletText(text: string): string {
  const semantic = splitSemanticLead(text || "");
  return sanitizeText(semantic.text || text || "")
    .replace(/\uFE0F/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function computeUnifiedSlideFontSize(
  items: string[],
  baseSize: number,
  threshold: number,
  floor = MIN_FONT.BODY,
): number {
  const safeItems = (items || []).map((item) => normalizeRenderableBulletText(item || "")).filter(Boolean);
  if (safeItems.length === 0) return baseSize;
  const longest = safeItems.reduce((max, item) => Math.max(max, item.length), 0);
  const totalChars = safeItems.reduce((a, it) => a + it.length, 0);
  let size = autoScaleFont(baseSize, longest, threshold, floor);
  const MAX_HEIGHT_IN = 4.95;
  let finalEstimated = 0;
  let iterations = 0;
  for (let guard = 0; guard < 18; guard++) {
    const perItemPadding = safeItems.length >= 5 ? 0.1 : 0.08;
    const totalEstimated = safeItems.reduce((acc, item) => {
      const h = estimateTextHeightInches(item, size, SAFE_ZONE.W - 1.45, 1.26);
      return acc + h + perItemPadding;
    }, 0);
    finalEstimated = totalEstimated;
    iterations = guard + 1;
    if (totalEstimated <= MAX_HEIGHT_IN) break;
    if (size <= floor) break;
    size = Math.max(floor, Math.round((size - 0.5) * 10) / 10);
  }
  if (DEBUG_OVERFLOW) {
    const status = finalEstimated > MAX_HEIGHT_IN ? "OVERFLOW" : "OK";
    console.log(`[V3-FIT][${status}] items=${items.length} chars=${totalChars} longest=${longest} → fontSize=${size}pt estH=${finalEstimated.toFixed(2)}in (max=${MAX_HEIGHT_IN}in) iters=${iterations}`);
  }
  return size;
}

function truncateHard(text: string, limit: number): string {
  const clean = sanitizeText(text || "").trim();
  if (!clean) return "";
  if (clean.length <= limit) return clean;
  // GEMMA v3.9.8 — quebra por palavra para não cortar no meio de termos.
  const slice = clean.substring(0, Math.max(0, limit - 1));
  const lastSpace = slice.lastIndexOf(" ");
  const safe = lastSpace > limit * 0.6 ? slice.substring(0, lastSpace) : slice;
  return `${safe.replace(/[\s,;:.\-–—]+$/u, "").trim()}…`;
}

type DeterministicCardItem = {
  icon?: string;
  label: string;
  desc: string;
  hasColon: boolean;
  cleanText: string;
};

function parseDeterministicCardItem(raw: string): DeterministicCardItem {
  const semantic = splitSemanticLead(raw || "");
  let clean = semantic.text;

  if (clean.indexOf(":") < 0 || clean.indexOf(":") > 40) {
    const inferMatch = clean.match(
      /^([A-ZÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÇ][\w\sàáéíóúàèìòùâêîôûãõçÀÁÉÍÓÚÂÊÎÔÛÃÕÇ]{0,35}?)\s+([A-ZÁÉÍÓÚO][a-záéíóúàèìòùâêîôûãõç].{10,})/u,
    );
    if (inferMatch && inferMatch[1].split(" ").length <= 4) {
      clean = `${inferMatch[1].trim()}: ${inferMatch[2].trim()}`;
    }
  }

  const colonIdx = clean.indexOf(":");
  if (colonIdx > 0 && colonIdx < 70) {
    const label = sanitizeText(clean.substring(0, colonIdx)).trim();
    const desc = sanitizeText(clean.substring(colonIdx + 1)).trim();
    return {
      icon: semantic.icon,
      label,
      desc,
      hasColon: true,
      cleanText: `${label}: ${desc}`.trim(),
    };
  }

  const desc = sanitizeText(clean).trim();
  return {
    icon: semantic.icon,
    label: "",
    desc,
    hasColon: false,
    cleanText: desc,
  };
}

function getDeterministicGridLayout(itemCount: number) {
  const count = Math.max(1, Math.min(itemCount, GRID_MAX_ITEMS));
  const cols = count >= 4 ? 2 : 1;
  const rows = Math.ceil(count / cols);
  const contentX = SAFE_ZONE.X;
  const contentY = SAFE_ZONE.Y + 0.05;
  const contentW = SAFE_ZONE.W;
  const contentH = SAFE_ZONE.H - 0.05;
  const gapX = 0.24;
  const gapY = 0.16;
  const cardW = (contentW - gapX * (cols - 1)) / cols;
  const cardH = (contentH - gapY * (rows - 1)) / rows;
  const numBadge = 0.34;
  const semanticBadge = 0.34;
  const textXOffset = 0.14 + numBadge + 0.1 + semanticBadge + 0.12;
  const textYOffset = 0.64;
  const textW = cardW - textXOffset - 0.16;
  const textH = Math.max(0.42, cardH - textYOffset - 0.16);

  return {
    cols,
    rows,
    contentX,
    contentY,
    contentW,
    contentH,
    gapX,
    gapY,
    cardW,
    cardH,
    numBadge,
    semanticBadge,
    textXOffset,
    textYOffset,
    textW,
    textH,
  };
}

function estimateWrappedLines(text: string, fontSize: number, boxW: number): number {
  const clean = sanitizeText(text || "").trim();
  if (!clean) return 1;
  const charsPerLine = Math.max(10, Math.floor((boxW * 72) / Math.max(fontSize * 0.58, 1)));
  return Math.max(1, Math.ceil(clean.length / charsPerLine));
}

function estimateTextHeightInches(
  text: string,
  fontSize: number,
  boxW: number,
  lineSpacingMultiple = 1.3, // Aumentado para 1.3 para maior segurança
): number {
  const safeText = sanitizeText(text || "").trim();
  if (!safeText) return 0.2;
  
  // Fator de largura calibrado: mais conservador para evitar falsos negativos de transbordo
  const charWidthFactor = 0.015; 
  const charsPerLine = Math.max(6, Math.floor(boxW / (fontSize * charWidthFactor)));
  const lines = Math.max(1, Math.ceil(safeText.length / charsPerLine));
  
  // Retorna altura em polegadas: (fontSize / 72) é a altura base de 1pt em polegadas
  return lines * ((fontSize / 72) * lineSpacingMultiple * 1.2); 
}

function computeDeterministicGridFontSize(items: string[]): number {
  const parsed = items.map(parseDeterministicCardItem);
  const geometry = getDeterministicGridLayout(parsed.length);
  const base = parsed.length >= 4 ? 20 : 21;

  for (let fontSize = base; fontSize >= MIN_FONT.BODY; fontSize -= 0.5) {
    const fits = parsed.every(
      (item) => estimateTextHeightInches(item.cleanText, fontSize, geometry.textW) <= geometry.textH,
    );
    if (fits) return Math.round(fontSize * 10) / 10;
  }

  return MIN_FONT.BODY - 0.5;
}

function shouldForceContinuation(plan: SlidePlan): boolean {
  const items = plan.items ?? [];
  if (items.length <= 1) return false;
  const longest = items.reduce((max, item) => Math.max(max, getRenderableTextLength(item || "")), 0);
  const totalChars = items.reduce((sum, it) => sum + (it || "").length, 0);

  // HEIGHT-GATE (3.12.6): proxy direto de altura para layouts splittable.
  // Disparado ANTES das heurísticas de fonte porque o estimador de altura
  // do pptxgenjs estoura mesmo quando computeUnifiedSlideFontSize retorna >18pt.
  const heightGate =
    (items.length >= 5 && (totalChars > 600 || longest > 140)) ||
    (items.length >= 4 && totalChars > 580 && longest > 150) ||
    (items.length >= 6); // 6+ items densos sempre dividem

  switch (plan.layout) {
    case "bullets": {
      if (heightGate) return true;
      const unified = computeUnifiedSlideFontSize(items, 20, 92, MIN_FONT.BODY);
      const atMinFloor = unified <= MIN_FONT.BODY + 0.5;
      return unified <= 18.5 || atMinFloor || longest > 100;
    }
    case "two_column_bullets": {
      // 3.12.6: agora splittable por altura. Two-column tolera mais itens
      // (≈10 visualmente) mas estoura igual quando items são longos.
      if (items.length >= 6 && totalChars > 700) return true;
      if (items.length >= 5 && (totalChars > 650 || longest > 145)) return true;
      if (items.length >= 4 && totalChars > 580 && longest > 150) return true;
      return false;
    }
    case "grid_cards":
      return computeDeterministicGridFontSize(items) < MIN_FONT.BODY + 0.5;
    case "summary_slide":
    case "numbered_takeaways": {
      if (heightGate) return true;
      const unified = computeUnifiedSlideFontSize(items, 19, 85, MIN_FONT.BODY);
      const atMinFloor = unified <= MIN_FONT.BODY + 0.5;
      return unified <= 18 || atMinFloor || longest > 90;
    }
    default:
      if (items.length >= 5 && totalChars > 450) {
        console.log(`[V3-SPLIT-SKIP] "${plan.title}" layout=${plan.layout} items=${items.length} chars=${totalChars} — layout não-splittable`);
      }
      return false;
  }
}

/**
 * Calcula o número total de caracteres "úteis" de um slide.
 */
function slideCharLoad(plan: SlidePlan): number {
  let total = 0;
  if (plan.items) for (const it of plan.items) total += (it || "").length;
  if (plan.objectives) for (const it of plan.objectives) total += (it || "").length;
  if (plan.description) total += plan.description.length;
  if (plan.subtitle) total += plan.subtitle.length;
  return total;
}

/**
 * Smart Content Splitter — Gemma v3.9.
 *
 * Recebe um SlidePlan e decide se ele deve ser quebrado em múltiplos
 * slides para respeitar densidade visual. Retorna sempre um array
 * (1+ slides) e nunca perde conteúdo.
 *
 * Regras:
 *   1. Layouts não-splittable (callouts, módulo cover, tabelas, exemplo)
 *      são devolvidos intactos.
 *   2. Se total de chars > MAX_TOTAL_CHARS OU items > densidade,
 *      os items são particionados em N slides do mesmo layout.
 *   3. Slides 2..N recebem título "[Título] (Continuação)" e o mesmo
 *      sectionLabel. continuationOf é preenchido com o título original.
 */
function normalizeAndSplitSlide(plan: SlidePlan, design: DesignConfig): SlidePlan[] {
  if (!plan) return [];
  if (!SPLITTABLE_LAYOUTS.has(plan.layout)) return [plan];

  const items = plan.items ?? [];
  const maxItems = plan.layout === "grid_cards" ? GRID_MAX_ITEMS : Math.max(2, design.density.maxItemsPerSlide);
  const totalChars = slideCharLoad(plan);
  const forcedContinuation = shouldForceContinuation(plan);

  // ZOD-PARITY v3.12.7 — early-return alinhado ao MAX_TOTAL_CHARS=580 da era Zod
  // (3.11.6) que eliminava overflow. Adiciona gate por longest-item (>150) já que
  // os logs mostram OVERFLOW com 4 items mas longest=164-170.
  const longestItem = items.reduce((m, it) => Math.max(m, (it || "").length), 0);
  const earlyPass =
    !forcedContinuation &&
    totalChars <= 500 &&
    items.length <= 5 &&
    longestItem <= 150;
  if (earlyPass) {
    return [plan];
  }
  if (items.length <= 1) return [plan]; // não dá para dividir

  // Particiona items em chunks que respeitem AMBOS os limites.
  // Teto de chars elevado para 580 (Gemini spec): só estouramos quando
  // realmente não há mais espaço físico para acomodar o próximo item.
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const it of items) {
    const itLen = (it || "").length;
    const wouldExceedItems = current.length + 1 > maxItems;
    // MEASURE-FIX v3.12.4 — chunk-cap alinhado ao early-return (720); measure só dispara
    // quando chunk já tem 3+ items E acumulou 400+ chars (evita slides com 1 bullet).
    // ZOD-PARITY v3.12.7 — Reduzi o chunk-cap de 440 para 380 para ser mais agressivo contra transbordo.
    const wouldExceedChars = currentChars + itLen > 380 && current.length > 0;
    const wouldExceedMeasure =
      current.length >= 3 &&
      currentChars + itLen > 400 &&
      computeUnifiedSlideFontSize([...current, it], 16, 70, MIN_FONT.BODY) < MIN_FONT.BODY;
    if (wouldExceedItems || wouldExceedChars) {
      dbg("SPLIT-CUT", {
        title: plan.title,
        reason: wouldExceedItems ? "items" : "chars",
        currentChars,
        currentItems: current.length,
        nextItemLen: itLen,
        nextItemKind: classifyItem(it),
        nextItemPreview: summarizeItem(it),
      });
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    if (wouldExceedMeasure && current.length > 0) {
      dbg("SPLIT-CUT", {
        title: plan.title,
        reason: "measure",
        currentChars,
        currentItems: current.length,
        nextItemLen: itLen,
        nextItemKind: classifyItem(it),
        nextItemPreview: summarizeItem(it),
      });
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(it);
    currentChars += itLen;
  }
  if (current.length > 0) chunks.push(current);

  // GEMMA v3.10.3 — Regra de agrupamento de marcadores de seção:
  // Se QUALQUER item-marker (🧠 ⚙️ ⚠️ 🎯 etc.) estiver no final de um chunk
  // OU isolado entre dois chunks, ele deve viajar com o parágrafo seguinte
  // para que o ícone funcione como cabeçalho da próxima seção, não como
  // sobra órfã no slide anterior.
  for (let i = 0; i < chunks.length - 1; i++) {
    while (chunks[i].length > 1 && isSectionMarker(chunks[i][chunks[i].length - 1])) {
      const last = chunks[i].pop()!;
      chunks[i + 1].unshift(last);
      dbg("MARKER-MOVE", {
        title: plan.title,
        fromChunk: i,
        toChunk: i + 1,
        marker: summarizeItem(last),
      });
    }
  }
  // Caso o primeiro chunk inteiro seja apenas markers (raro), funde-o ao próximo.
  if (chunks.length >= 2 && chunks[0].every(isSectionMarker)) {
    dbg("MARKER-FUSE-HEAD", { title: plan.title, count: chunks[0].length });
    chunks[1] = [...chunks[0], ...chunks[1]];
    chunks.shift();
  }

  if (chunks.length <= 1) return [plan];

  const baseTitle = plan.title || "Slide";
  // Strip any existing continuation markers to prevent "Título (Pt. 2) (Pt. 3)" compounding
  const cleanBase = baseTitle.replace(/\s*\(Continuação\)\s*/g, "").replace(/\s*—?\s*Pt\.\s*\d+\s*/g, "").trim();
  let runningOffset = 0;
  const out: SlidePlan[] = chunks
    .filter((c) => c.length > 0)
    .map((chunkItems, idx) => {
      const startIdx = runningOffset;
      runningOffset += chunkItems.length;
      return {
        ...plan,
        items: chunkItems,
        title: idx === 0 ? baseTitle : `${cleanBase} — Pt. ${idx + 1}`,
        continuationOf: idx === 0 ? undefined : cleanBase,
        // GEMMA v3.10.6 — preserva sequência de numeração entre slides quebrados.
        itemStartIndex: startIdx,
      };
    });

  console.log(
    `[V3-SPLIT] "${baseTitle}" (${plan.layout}) chars=${totalChars} items=${items.length} → ${out.length} slides`,
  );

  if (DEBUG_SPLIT) {
    out.forEach((s, idx) => {
      const classified = (s.items ?? []).map((it, i) => ({
        i,
        kind: classifyItem(it),
        len: (it || "").length,
        preview: summarizeItem(it),
      }));
      dbg("SPLIT-RESULT", {
        slideIdx: idx,
        title: s.title,
        layout: s.layout,
        totalChars: (s.items ?? []).reduce((a, b) => a + (b || "").length, 0),
        itemCount: classified.length,
        sectionCount: classified.filter((c) => c.kind === "section").length,
        items: classified,
      });
    });
  }
  return out;
}

/**
 * Auto-scaling de fontes (Gemma v3.9.5).
 * Reduz o fontSize em até 15% para conteúdo denso, mas NUNCA abaixo do
 * piso passado. O Smart Splitter assume a tarefa de quebrar slides
 * quando o piso é atingido.
 */
function autoScaleFont(baseSize: number, charCount: number, threshold = 120, floor = 0): number {
  if (charCount <= threshold) return baseSize;
  const overflow = (charCount - threshold) / threshold;
  const reduction = Math.min(0.15, overflow * 0.15);
  const scaled = baseSize * (1 - reduction);
  const finalSize = Math.max(floor || 8, scaled);
  return Math.round(finalSize * 10) / 10;
}

/**
 * Substitui emoji ícones de categoria (🧠 ⚙️ ⚠️ 🎯 📌 🔑 💡 ✨ 📊 🚀 etc.)
 * por uma versão com cor accent dentro do array de runs do pptxgenjs.
 * Retorna um array de runs `{text, options}[]` se houver substituição,
 * ou null se não houver emoji a colorir.
 *
 * GEMMA v3.9.5 — Estiliza ícones para combinarem com a paleta accent
 * em vez de "emoji soltos" sem hierarquia visual.
 */
const CATEGORY_ICON_REGEX = /([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])/gu;
function colorizeIconRuns(
  text: string,
  accentColor: string,
  baseColor: string,
): { text: string; options: any }[] | null {
  if (!text || !CATEGORY_ICON_REGEX.test(text)) return null;
  CATEGORY_ICON_REGEX.lastIndex = 0;
  const parts: { text: string; options: any }[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  CATEGORY_ICON_REGEX.lastIndex = 0;
  while ((m = CATEGORY_ICON_REGEX.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push({ text: text.slice(lastIdx, m.index), options: { color: baseColor } });
    }
    parts.push({ text: m[1], options: { color: accentColor, bold: true } });
    lastIdx = m.index + m[1].length;
  }
  if (lastIdx < text.length) {
    parts.push({ text: text.slice(lastIdx), options: { color: baseColor } });
  }
  return parts.length > 0 ? parts : null;
}

/**
 * Deriva um sectionLabel automático quando o AI não fornecer.
 * Usado no Dispatcher (renderSlide) para garantir que TODO slide
 * de conteúdo carregue um rótulo orientativo no topo.
 */
function deriveSectionLabel(plan: SlidePlan): string {
  if (plan.sectionLabel && plan.sectionLabel.trim().length > 0) {
    return plan.sectionLabel.toUpperCase();
  }
  switch (plan.layout) {
    case "module_cover":
      return "MÓDULO";
    case "toc":
      return "ÍNDICE";
    case "bullets":
      return "CONTEÚDO";
    case "two_column_bullets":
      return "CONTEÚDO";
    case "definition":
      return "DEFINIÇÃO";
    case "grid_cards":
      return "CONCEITOS-CHAVE";
    case "process_timeline":
      return "PROCESSO";
    case "comparison_table":
      return "COMPARATIVO";
    case "example_highlight":
      return "ESTUDO DE CASO";
    case "warning_callout":
      return "ATENÇÃO";
    case "reflection_callout":
      return "REFLEXÃO";
    case "summary_slide":
      return "RESUMO";
    case "numbered_takeaways":
      return "PRINCIPAIS APRENDIZADOS";
    case "closing":
      return "ENCERRAMENTO";
    default:
      return "CONTEÚDO";
  }
}

const THEMES = {
  light: {
    bg: "FFFFFF",
    bgAlt: "F0F4FF",
    bgAccent: "DDE5FF",
    text: "0F172A",
    textSecondary: "374151",
    accent: "4F46E5",
    accentMuted: "EEF2FF",
    borders: "C7D2FE",
    cardBg: "FFFFFF",
    cardBgAlt: "F0F4FF",
    tableHeaderBg: "0F172A",
    tableRowOdd: "FFFFFF",
    tableRowEven: "F0F4FF",
    insightBg: "FFFBEB",
    reflectionBg: "EEF2FF",
    coverBg: "080F2A",
    coverText: "FFFFFF",
    coverSubtext: "94A3B8",
    divider: "E0E7FF",
    coverDark: "080F2A",
    panelDark: "0C1530",
    panelMid: "172244",
    shadowColor: "8196C8",
  },
  dark: {
    bg: "070C1C",
    bgAlt: "0F1629",
    bgAccent: "141F3A",
    text: "E8EDF5",
    textSecondary: "94A3B8",
    accent: "6366F1",
    accentMuted: "1E1B4B",
    borders: "1E2D4A",
    cardBg: "0F1629",
    cardBgAlt: "141F3A",
    tableHeaderBg: "060B16",
    tableRowOdd: "0F1629",
    tableRowEven: "141F3A",
    insightBg: "271A05",
    reflectionBg: "0D1830",
    coverBg: "040810",
    coverText: "FFFFFF",
    coverSubtext: "64748B",
    divider: "1E2D4A",
    coverDark: "040810",
    panelDark: "080D1C",
    panelMid: "0F1A30",
    shadowColor: "000000",
  },
};

const PALETTES: Record<string, string[]> = {
  default: ["4F46E5", "7C3AED", "0891B2", "059669", "D97706"],
  ocean: ["0369A1", "0284C7", "0891B2", "0D9488", "1D4ED8"],
  forest: ["15803D", "16A34A", "0D9488", "047857", "166534"],
  sunset: ["DC2626", "EA580C", "D97706", "B91C1C", "C2410C"],
  monochrome: ["1E293B", "334155", "475569", "64748B", "94A3B8"],
  premium: ["1A56DB", "7E3AF2", "0694A2", "057A55", "C27803"],
};

const TYPO = {
  COVER_TITLE: 56,
  MODULE_NUMBER: 160,
  MODULE_TITLE: 40,
  SECTION_TITLE: 32,
  SUBTITLE: 22,
  BODY: 17,
  BODY_LARGE: 20,
  SUPPORT: 13,
  LABEL: 11,
  TABLE_HEADER: 13,
  TABLE_CELL: 12,
  CARD_TITLE: 15,
  CARD_BODY: 13,
  BULLET_TEXT: 16,
  TAKEAWAY_NUM: 60,
  TAKEAWAY_BODY: 14,
  FOOTER: 11,
  TOC_NUMBER: 46,
  TOC_TITLE: 18,
  TOC_DESC: 12,
};

const FONT_WIDTH_FACTOR: Record<string, number> = {
  "Montserrat":       0.62,
  "Open Sans":        0.60,
  "Lato":             0.59,
  "Times New Roman":  0.58,
  "Arial":            0.61,
  "Playfair Display": 0.67,
  "default":          0.61,
};

function measureTextHeight(
  text: string,
  fontSizePt: number,
  fontFace: string,
  boxWidthInches: number,
  lineSpacing: number = 1.18
): number {
  const safeText = normalizeRenderableBulletText(text);
  if (!safeText) return 0.3;
  let factor = FONT_WIDTH_FACTOR[fontFace] ?? FONT_WIDTH_FACTOR["default"];
  if (fontFace === "Times New Roman" && fontSizePt < 14) factor *= 0.96;
  const charWidthInches = (fontSizePt / 72) * factor;
  const charsPerLine = Math.max(1, Math.floor(boxWidthInches / charWidthInches));
  const words = safeText.split(/\s+/);
  let lines = 1, currentLineChars = 0;
  for (const word of words) {
    if (currentLineChars > 0 && currentLineChars + word.length + 1 > charsPerLine) {
      lines++;
      currentLineChars = word.length;
    } else {
      currentLineChars += (currentLineChars > 0 ? 1 : 0) + word.length;
    }
  }
  const lineHeightInches = (fontSizePt / 72) * lineSpacing * 1.2;
  return lines * lineHeightInches;
}

const TEMPLATE_FONTS: Record<string, { title: string; body: string }> = {
  default:   { title: "Montserrat",       body: "Open Sans" },
  academic:  { title: "Times New Roman",  body: "Arial" },
  corporate: { title: "Montserrat",       body: "Open Sans" },
  creative:  { title: "Playfair Display", body: "Lato" },
  modern:    { title: "Montserrat",       body: "Open Sans" },
  band:      { title: "Montserrat",       body: "Open Sans" },
  minimal:   { title: "Montserrat",       body: "Open Sans" },
  tech:      { title: "Montserrat",       body: "Open Sans" },
  executive: { title: "Montserrat",       body: "Open Sans" },
};

const TEMPLATE_DEFAULT_PALETTES: Record<string, string[]> = {
  default:   PALETTES.default,
  academic:  ["1D4ED8", "1E40AF", "7C3AED", "0F766E", "B45309"],
  corporate: ["0F3460", "1A56DB", "7E3AF2", "0694A2", "C27803"],
  creative:  ["7C3AED", "DB2777", "D97706", "059669", "0284C7"],
  modern:    ["4F46E5", "7C3AED", "0891B2", "059669", "D97706"],
  band:      ["4F46E5", "E11D48", "0891B2", "059669", "F59E0B"],
  minimal:   ["1E293B", "475569", "64748B", "94A3B8", "CBD5E1"],
  tech:      ["2563EB", "06B6D4", "10B981", "F59E0B", "6366F1"],
  executive: ["1E3A5F", "2563EB", "475569", "1D4ED8", "0891B2"],
};

const DENSITY_CONFIG: Record<string, { maxItemsPerSlide: number; maxCharsPerItem: number }> = {
  compact: { maxItemsPerSlide: 4, maxCharsPerItem: 130 },
  standard: { maxItemsPerSlide: 5, maxCharsPerItem: 160 },
  detailed: { maxItemsPerSlide: 6, maxCharsPerItem: 200 },
};

const TEMPLATE_VISUAL_STYLES: Record<string, "classic" | "band" | "minimal"> = {
  default:   "classic",
  academic:  "classic",
  corporate: "classic",
  creative:  "classic",
  modern:    "classic",
  band:      "band",
  minimal:   "minimal",
  tech:      "classic",
  executive: "band",
};

const TEMPLATE_DEFAULT_THEMES: Record<string, "light" | "dark"> = {
  default:   "light",
  academic:  "light",
  corporate: "dark",
  creative:  "light",
  modern:    "dark",
  band:      "light",
  minimal:   "light",
  tech:      "dark",
  executive: "light",
};

function buildDesignConfig(
  themeKey: string,
  paletteKey: string,
  includeImages = false,
  templateKey = "default",
  densityKey = "standard",
  courseType = "CURSO COMPLETO",
  footerBrand: string | null = "EduGenAI",
): DesignConfig {
  // Template determines default theme; explicit theme param overrides only if provided
  const resolvedThemeKey = (themeKey === "dark" || themeKey === "light")
    ? themeKey
    : TEMPLATE_DEFAULT_THEMES[templateKey] || "light";
  const theme = resolvedThemeKey as "light" | "dark";
  const palette =
    paletteKey === "default"
      ? TEMPLATE_DEFAULT_PALETTES[templateKey] || PALETTES.default
      : PALETTES[paletteKey] || PALETTES.default;
  return {
    theme,
    palette,
    fonts: TEMPLATE_FONTS[templateKey] || TEMPLATE_FONTS.default,
    density: DENSITY_CONFIG[densityKey] || DENSITY_CONFIG.standard,
    includeImages,
    template: templateKey || "default",
    visualStyle: TEMPLATE_VISUAL_STYLES[templateKey] || "classic",
    courseType: courseType || "CURSO COMPLETO",
    footerBrand: footerBrand !== undefined ? footerBrand : "EduGenAI",
  };
}

function getColors(design: DesignConfig) {
  const t = THEMES[design.theme];
  const p = design.palette;
  return {
    bg: t.bg,
    bgAlt: t.bgAlt,
    bgAccent: t.bgAccent,
    text: t.text,
    textSecondary: t.textSecondary,
    accent: t.accent,
    accentMuted: t.accentMuted,
    borders: t.borders,
    cardBg: t.cardBg,
    cardBgAlt: t.cardBgAlt,
    tableHeaderBg: t.tableHeaderBg,
    tableRowOdd: t.tableRowOdd,
    tableRowEven: t.tableRowEven,
    insightBg: t.insightBg,
    reflectionBg: t.reflectionBg,
    coverBg: t.coverBg,
    coverText: t.coverText,
    coverSubtext: t.coverSubtext,
    divider: t.divider,
    coverDark: t.coverDark,
    panelDark: t.panelDark,
    panelMid: t.panelMid,
    shadowColor: t.shadowColor,
    p0: p[0],
    p1: p[1],
    p2: p[2],
    p3: p[3],
    p4: p[4],
    white: "FFFFFF",
  };
}

function addLightBgDecoration(slide: any, design: DesignConfig, colors: ReturnType<typeof getColors>) {
  if (design.theme === "light") {
    // Top-right large bleed circle
    slide.addShape("ellipse" as any, {
      x: SLIDE_W - 2.8, y: -1.5, w: 4.0, h: 4.0,
      fill: { color: colors.p0 }, transparency: 91,
    });
    // Bottom-left bleed circle
    slide.addShape("ellipse" as any, {
      x: -1.0, y: SLIDE_H - 1.8, w: 3.0, h: 3.0,
      fill: { color: colors.p1 }, transparency: 93,
    });
    // Thin top accent bar
    slide.addShape("rect" as any, {
      x: 0, y: 0, w: SLIDE_W, h: 0.032,
      fill: { color: colors.p0 }, transparency: 40,
    });
    // Dot grid pattern — top-right corner (4×4 grid)
    const dotSz = 0.055, dotGap = 0.19;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        slide.addShape("ellipse" as any, {
          x: SLIDE_W - 1.55 + col * dotGap,
          y: 0.18 + row * dotGap,
          w: dotSz, h: dotSz,
          fill: { color: colors.p0 }, transparency: 55,
        });
      }
    }
    // Corner accent — bottom-right small triangle-ish shape
    slide.addShape("rect" as any, {
      x: SLIDE_W - 0.5, y: SLIDE_H - 0.5, w: 0.5, h: 0.5,
      fill: { color: colors.p2 }, transparency: 80,
    });
  } else {
    // Dark theme: large soft circle glow bottom-right
    slide.addShape("ellipse" as any, {
      x: SLIDE_W - 2.4, y: SLIDE_H - 2.2, w: 3.8, h: 3.8,
      fill: { color: colors.p0 }, transparency: 90,
    });
    // Top-left subtle glow
    slide.addShape("ellipse" as any, {
      x: -1.0, y: -1.2, w: 3.2, h: 3.2,
      fill: { color: colors.p1 }, transparency: 92,
    });
    // Dot grid top-right (dark)
    const dotSz = 0.05, dotGap = 0.18;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        slide.addShape("ellipse" as any, {
          x: SLIDE_W - 1.3 + col * dotGap,
          y: 0.16 + row * dotGap,
          w: dotSz, h: dotSz,
          fill: { color: colors.p0 }, transparency: 65,
        });
      }
    }
  }
}

function ensureContrastOnLight(fgHex: string, bgHex: string): string {
  const toLum = (hex: string) => {
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  if (Math.abs(toLum(fgHex) - toLum(bgHex)) < 0.3) {
    return toLum(bgHex) > 0.5 ? "1E293B" : "E8EDF5";
  }
  return fgHex;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 2.5: IMAGE SERVICE (identical to v2)
// ═══════════════════════════════════════════════════════════════════

const PT_EN_MAP: Record<string, string> = {
  inteligência: "intelligence",
  artificial: "artificial",
  produtividade: "productivity",
  trabalho: "work",
  negócios: "business",
  marketing: "marketing",
  vendas: "sales",
  educação: "education",
  tecnologia: "technology",
  saúde: "health",
  gestão: "management",
  liderança: "leadership",
  inovação: "innovation",
  empreendedorismo: "entrepreneurship",
  finanças: "finance",
  comunicação: "communication",
  estratégia: "strategy",
  dados: "data",
  digital: "digital",
  criatividade: "creativity",
  design: "design",
  sustentabilidade: "sustainability",
  automação: "automation",
  análise: "analysis",
  desenvolvimento: "development",
  programação: "programming",
  segurança: "security",
  nuvem: "cloud",
  rede: "network",
  máquina: "machine",
  aprendizado: "learning",
  profundo: "deep",
  natural: "natural",
  linguagem: "language",
  processamento: "processing",
  robótica: "robotics",
  internet: "internet",
  projeto: "project",
  planejamento: "planning",
  equipe: "team",
  cliente: "customer",
  produto: "product",
  serviço: "service",
  resultado: "results",
  crescimento: "growth",
  transformação: "transformation",
  pesquisa: "research",
  ciência: "science",
  engenharia: "engineering",
  computação: "computing",
  blockchain: "blockchain",
  investimento: "investment",
  economia: "economy",
  mercado: "market",
  psicologia: "psychology",
  medicina: "medicine",
  ambiente: "environment",
  energia: "energy",
  logística: "logistics",
  transporte: "transportation",
  arquitetura: "architecture",
  música: "music",
  arte: "art",
  jogos: "games",
  esporte: "sport",
  moda: "fashion",
  direito: "law",
  ética: "ethics",
  sociedade: "society",
  cultura: "culture",
  matemática: "mathematics",
  física: "physics",
  química: "chemistry",
  biologia: "biology",
  ensino: "teaching",
  curso: "course",
  aula: "class",
  aluno: "student",
  ferramenta: "tool",
  plataforma: "platform",
  sistema: "system",
  processo: "process",
  modelo: "model",
  código: "code",
  software: "software",
  algoritmo: "algorithm",
  servidor: "server",
  web: "web",
  mobile: "mobile",
  // Palavras de domínio frequentes sem tradução no mapa original
  auditoria: "audit",
  operacional: "operational",
  controle: "control",
  compliance: "compliance",
  governanca: "governance",
  risco: "risk",
  qualidade: "quality",
  melhoria: "improvement",
  diagnostico: "diagnostic",
  relatorio: "report",
  indicador: "indicator",
  desempenho: "performance",
  contabilidade: "accounting",
  fiscal: "fiscal",
  tributario: "tax",
  juridico: "legal",
  contrato: "contract",
  negociacao: "negotiation",
  vendedor: "sales",
  atendimento: "customer service",
  suporte: "support",
  treinamento: "training",
  capacitacao: "training",
  habilidade: "skill",
  competencia: "competency",
  certificacao: "certification",
  carreira: "career",
  projeto: "project",
  agil: "agile",
  scrum: "scrum",
  sprint: "sprint",
  startup: "startup",
  escalonamento: "scaling",
  parceria: "partnership",
  apresentacao: "presentation",
  reuniao: "meeting",
  workshop: "workshop",
  planejamento: "planning",
  execucao: "execution",
  monitoramento: "monitoring",
};

const PT_STOP_WORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "para",
  "com",
  "em",
  "na",
  "no",
  "nas",
  "nos",
  "um",
  "uma",
  "uns",
  "umas",
  "o",
  "a",
  "os",
  "as",
  "e",
  "ou",
  "que",
  "por",
  "ao",
  "à",
  "como",
  "mais",
  "não",
  "se",
  "seu",
  "sua",
  "seus",
  "suas",
  "muito",
  "bem",
  "todo",
  "toda",
  "todos",
  "todas",
  "este",
  "esta",
  "esse",
  "essa",
  "aquele",
  "aquela",
  "ser",
  "ter",
  "fazer",
  "poder",
  "dever",
  "módulo",
  "capítulo",
  "seção",
  "parte",
  "sobre",
  "entre",
  "até",
  "sem",
]);

// Dicionário de termos técnicos para busca de imagens contextuais
const TECH_IMAGE_QUERIES: Record<string, string> = {
  // Linguagens de programação
  python: "python programming code",
  java: "java programming",
  javascript: "javascript code",
  typescript: "typescript code",
  "c++": "cpp programming",
  "c#": "csharp programming",
  ruby: "ruby programming",
  go: "golang programming",
  rust: "rust programming",
  php: "php programming",
  swift: "swift programming",
  kotlin: "kotlin programming",
  // Áreas técnicas
  "inteligência artificial": "artificial intelligence technology",
  "machine learning": "machine learning ai",
  "deep learning": "deep learning neural network",
  "data science": "data science analytics",
  "big data": "big data technology",
  cloud: "cloud computing",
  aws: "amazon web services cloud",
  azure: "microsoft azure cloud",
  docker: "docker containers",
  kubernetes: "kubernetes cluster",
  devops: "devops ci cd",
  api: "api development",
  rest: "rest api",
  graphql: "graphql api",
  frontend: "frontend web development",
  backend: "backend server",
  "full stack": "full stack development",
  mobile: "mobile app development",
  ios: "ios development",
  android: "android development",
  // Bancos de dados
  sql: "sql database",
  postgresql: "postgresql database",
  mysql: "mysql database",
  mongodb: "mongodb nosql",
  nosql: "nosql database",
  redis: "redis cache",
  // Ferramentas
  git: "git version control",
  github: "github repository",
  linux: "linux terminal server",
  "linha de comando": "command line terminal",
  terminal: "computer terminal",
  vscode: "visual studio code",
  // Áreas de negócio/gestão
  "gestão de projetos": "project management",
  scrum: "scrum agile",
  agile: "agile methodology",
  kanban: "kanban board",
  produtividade: "productivity workspace",
  liderança: "leadership team",
  empreendedorismo: "entrepreneurship startup",
  marketing: "marketing digital",
  finanças: "finance business",
  contabilidade: "accounting business",
  rh: "human resources",
  "recursos humanos": "human resources team",
  design: "design creative",
  "ux design": "user experience design",
  "ui design": "user interface design",
  fotografia: "photography camera",
  edição: "video editing",
  "edição de vídeo": "video editing suite",
  // Áreas acadêmicas
  matemática: "mathematics education",
  estatística: "statistics data",
  física: "physics science",
  química: "chemistry lab",
  biologia: "biology science",
  história: "history education",
  geografia: "geography education",
  filosofia: "philosophy thinking",
  psicologia: "psychology mind",
  medicina: "medicine healthcare",
  enfermagem: "nursing healthcare",
  direito: "law legal",
  engenharia: "engineering technology",
  arquitetura: "architecture design",
  // Soft skills
  comunicação: "communication skills",
  oratória: "public speaking",
  "falar em público": "public speaking presentation",
  negociação: "business negotiation",
  "inteligência emocional": "emotional intelligence",
  criatividade: "creativity innovation",
  inovação: "innovation technology",
  sustentabilidade: "sustainability environment",
  esg: "sustainability esg",
  // Domínios específicos
  segurança: "cybersecurity",
  "cyber security": "cybersecurity",
  redes: "computer networking",
  iot: "internet of things",
  blockchain: "blockchain technology",
  web3: "web3 blockchain",
  metaverso: "metaverse virtual reality",
  games: "game development",
  jogos: "game development",
  // QUALITY-PHASE-1.1: estruturas de cursos e programação (alta recorrência)
  "estruturas de dados": "data structures computer science",
  "programação orientada a objetos": "object oriented programming code",
  "orientação a objetos": "object oriented programming",
  "manipulação de arquivos": "file handling code",
  "tratamento de exceções": "error handling debugging",
  "testes automatizados": "automated testing software",
  "testes unitários": "unit testing code",
  unittest: "unit testing code",
  "projeto final": "capstone project development",
  "primeiros passos": "getting started learning",
  fundamentos: "programming fundamentals",
  "funções e módulos": "modular programming code",
  "organização de código": "clean code structure",
  "boas práticas": "best practices coding standards",
  "csv e json": "data exchange formats",
  "ambiente de desenvolvimento": "development environment ide",
  depuração: "debugging code",
  pypi: "python package index",
  utilitário: "utility tool software",
  // Técnicas adicionais
  criptografia: "encryption cryptography security",
  autenticação: "authentication security",
  microsserviços: "microservices architecture",
  serverless: "serverless cloud computing",
  // Domínios adicionais
  "realidade virtual": "virtual reality headset",
  "realidade aumentada": "augmented reality",
};

function buildImageQuery(title: string): string {
  const normalized = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 1. Match exato de frases técnicas (prioridade máxima)
  for (const [key, query] of Object.entries(TECH_IMAGE_QUERIES)) {
    const keyNorm = key
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (normalized.includes(keyNorm)) {
      return query;
    }
  }

  // 2. Fallback: processamento palavra-a-palavra
  const words = normalized.split(" ").filter((w) => w.length > 2 && !PT_STOP_WORDS.has(w));
  const translated = words.map((w) => {
    const wNorm = w
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    for (const [pt, en] of Object.entries(PT_EN_MAP)) {
      const ptNorm = pt
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      if (wNorm === ptNorm) return en;
    }
    return w;
  });
  const unique = [...new Set(translated)].slice(0, 3);

  // 3. Âncora visual melhorada: prioriza educação/tecnologia
  const hasVisualAnchor = translated.some((w) =>
    ["technology", "programming", "code", "design", "art", "science", "education", "business"].includes(w),
  );
  const suffix = hasVisualAnchor ? " education professional" : " learning education";
  return unique.join(" ") + suffix;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return encodeBase64(new Uint8Array(buffer));
}

async function fetchPexelsImage(
  query: string,
  orientation: "landscape" | "portrait" | "square" = "landscape",
  usedPhotoIds?: Set<string>,
): Promise<SlideImage | null> {
  const apiKey = Deno.env.get("PEXELS_API_KEY");
  if (!apiKey) return null;

  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=${orientation}`;
    const res = await fetch(url, { headers: { Authorization: apiKey } });
    if (!res.ok) return null;

    const data = await res.json();
    const results: any[] = Array.isArray(data?.photos) ? data.photos : [];
    if (!results.length) return null;

    const validResults = results.filter((p: any) => p?.id && (p?.src?.large || p?.src?.medium));

    const uniquePool = usedPhotoIds
      ? validResults.filter((p: any) => !usedPhotoIds.has(String(p.id)))
      : validResults;

    const pool = uniquePool.length ? uniquePool : validResults;
    const photo = pool[Math.floor(Math.random() * pool.length)];
    const imageUrl = photo.src?.large || photo.src?.medium;
    if (!imageUrl) return null;

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const mimeType = contentType.split(";")[0].trim();
    const buf = await imgRes.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);
    const photoId = String(photo.id);

    if (usedPhotoIds) usedPhotoIds.add(photoId);

    return {
      base64Data: `data:${mimeType};base64,${base64}`,
      credit: photo.photographer || "Pexels",
      creditUrl: photo.photographer_url || "https://www.pexels.com",
      photoId,
    };
  } catch {
    return null;
  }
}

async function buildImagePlan(
  courseTitle: string,
  modules: { title: string; content: string }[],
  includeImages: boolean,
): Promise<ImagePlan> {
  const empty: ImagePlan = { cover: null, modules: new Map(), closing: null };
  if (!includeImages || !Deno.env.get("PEXELS_API_KEY")) return empty;

  const usedPhotoIds = new Set<string>();

  const coverQuery = buildImageQuery(courseTitle);
  const closingQuery = buildImageQuery(`${courseTitle} conclusão formatura celebração`);

  const fetchUniqueWithRetries = async (queries: string[]): Promise<SlideImage | null> => {
    for (const q of queries) {
      const image = await fetchPexelsImage(q, "landscape", usedPhotoIds);
      if (image) return image;
    }
    return null;
  };

  // Last-resort helper when unique pool is exhausted.
  const fetchAnyWithRetries = async (queries: string[]): Promise<SlideImage | null> => {
    for (const q of queries) {
      const image = await fetchPexelsImage(q, "landscape");
      if (image) return image;
    }
    return null;
  };

  const plan: ImagePlan = {
    cover: await fetchUniqueWithRetries([
      coverQuery,
      `${coverQuery} education`,
      `${coverQuery} classroom`,
      `${coverQuery} learning`,
    ]),
    modules: new Map(),
    closing: await fetchUniqueWithRetries([
      closingQuery,
      `${closingQuery} success`,
      `${buildImageQuery(courseTitle)} thank you audience`,
      `${buildImageQuery(courseTitle)} graduation`,
    ]),
  };

  const missingModuleIndexes: number[] = [];

  for (let i = 0; i < modules.length; i++) {
    const rawTitle = modules[i].title.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || modules[i].title;

    const image = await fetchUniqueWithRetries([
      buildImageQuery(rawTitle),
      buildImageQuery(`${courseTitle} ${rawTitle}`),
      `${buildImageQuery(rawTitle)} training`,
      `${buildImageQuery(rawTitle)} classroom`,
    ]);

    if (image) {
      plan.modules.set(i, image);
      continue;
    }

    missingModuleIndexes.push(i);
  }

  // Rescue pass (still unique): broaden query before allowing duplicates.
  const unresolved: number[] = [];
  for (const i of missingModuleIndexes) {
    const rawTitle = modules[i].title.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || modules[i].title;

    const rescue = await fetchUniqueWithRetries([
      `${buildImageQuery(rawTitle)} professional learning`,
      `${buildImageQuery(courseTitle)} education`,
      "education classroom professional",
    ]);

    if (rescue) {
      plan.modules.set(i, rescue);
      continue;
    }

    unresolved.push(i);
  }

  // Final fallback (duplicates allowed only when absolutely necessary).
  for (const i of unresolved) {
    const rawTitle = modules[i].title.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || modules[i].title;
    const fallback = await fetchAnyWithRetries([
      `${buildImageQuery(rawTitle)} education`,
      `${buildImageQuery(courseTitle)} professional training`,
      "learning workshop education",
    ]);

    if (fallback) {
      plan.modules.set(i, fallback);
      console.log(`[V3-IMAGE] Module ${i + 1}: duplicate-allowed fallback used`);
    }
  }

  // Cover/closing hardening: prefer unique first, only then allow duplicates.
  if (!plan.cover) {
    plan.cover =
      (await fetchUniqueWithRetries([
        `${buildImageQuery(courseTitle)} education`,
        `${buildImageQuery(courseTitle)} classroom`,
      ])) || (await fetchAnyWithRetries([`${buildImageQuery(courseTitle)} education`]));
  }

  if (!plan.closing) {
    plan.closing =
      (await fetchUniqueWithRetries([
        `${buildImageQuery(courseTitle)} conclusão celebração`,
        `${buildImageQuery(courseTitle)} thank you audience`,
      ])) || (await fetchAnyWithRetries([`${buildImageQuery(courseTitle)} closing ceremony`]));
  }

  // Guarantee cover/closing are distinct whenever possible.
  if (
    plan.cover &&
    plan.closing &&
    plan.cover.photoId &&
    plan.closing.photoId &&
    plan.cover.photoId === plan.closing.photoId
  ) {
    const replacement =
      (await fetchUniqueWithRetries([
        `${buildImageQuery(courseTitle)} celebration audience`,
        `${buildImageQuery(courseTitle)} graduation`,
      ])) || (await fetchAnyWithRetries([`${buildImageQuery(courseTitle)} celebration audience`]));

    if (replacement && replacement.photoId !== plan.cover.photoId) {
      plan.closing = replacement;
    }
  }

  const allPhotoIds = [
    plan.cover?.photoId,
    plan.closing?.photoId,
    ...Array.from(plan.modules.values()).map((img) => img.photoId),
  ].filter((id): id is string => !!id);
  const duplicatePhotos = allPhotoIds.length - new Set(allPhotoIds).size;

  console.log(
    `[V3-IMAGE] IDs => cover=${plan.cover?.photoId ?? "none"}, closing=${plan.closing?.photoId ?? "none"}, moduleImages=${plan.modules.size}/${modules.length}, duplicates=${duplicatePhotos}`,
  );

  return plan;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 3: AI CALL (Lovable Gateway — same pattern as generate-course)
// ═══════════════════════════════════════════════════════════════════

async function callAI(model: string, prompt: string): Promise<string> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");

  // Prioritize personal Gemini Key if present (Bypasses Lovable Gateway per user request)
  if (geminiKey) {
    const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    let aiModel = model.replace("google/", "");
    const MODEL_MAP: Record<string, string> = {
      "gemini-3-flash-preview": "gemini-2.5-flash",
      "gemini-3-flash-lite": "gemini-2.5-flash",
      "gemini-2.5-flash-lite": "gemini-2.5-flash",
    };
    aiModel = MODEL_MAP[aiModel] ?? aiModel;
    if (!aiModel.startsWith("gemini-")) aiModel = "gemini-2.5-flash";

    console.log(`[V3-AI] Calling Gemini API directly with model: ${aiModel}`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${geminiKey}`,
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1500,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[V3-AI] Direct Gemini call failed: ${errText}`);
      throw new Error(`Erro na API do Gemini (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  // FALLBACK REMOVIDO POR SOLICITAÇÃO DO USUÁRIO
  // O sistema agora deve falhar explicitamente se a GEMINI_API_KEY não funcionar
  throw new Error("Falha na chamada direta ao Gemini (ou chave GEMINI_API_KEY não configurada). Fallback Lovable desativado.");
}


// ═══════════════════════════════════════════════════════════════════
// SECTION 4: SLIDE GENERATION PROMPT
// ═══════════════════════════════════════════════════════════════════

function buildSlidePrompt(
  moduleTitle: string,
  moduleContent: string,
  moduleIndex: number,
  density: string,
  language: string,
): string {
  const itemsPerSlide = density === "compact" ? "3-4" : density === "detailed" ? "5-6" : "4-5";

  return `Você é um designer instrucional sênior e especialista no tema do módulo, responsável por criar materiais de apresentação de ALTO VALOR COMERCIAL para cursos online premium.

Sua tarefa: transformar o conteúdo do Módulo ${moduleIndex + 1} em uma sequência de slides PowerPoint profissionais, densos em conhecimento e visualmente ricos.

## REGRA FUNDAMENTAL
Retorne APENAS um array JSON válido. ZERO texto fora do JSON. ZERO markdown. Primeiro char: [  Último char: ]

## PADRÃO DE QUALIDADE COMERCIAL

### Conteúdo Rico e Específico (OBRIGATÓRIO)
Cada item deve ser SUBSTANCIAL — não genérico. Inclua:
- Números e dados concretos quando aplicável ("reduz em 40% o tempo de desenvolvimento", "usado por +70% das empresas Fortune 500")
- Exemplos reais com nomes de ferramentas, empresas, casos de uso reais
- Explicações que mostram domínio profundo, não definições de dicionário
- Conexões entre conceitos ("isso permite que...", "diferente de X, aqui Y...")

Exemplo BOM: "List Comprehension (Python): Cria listas em uma linha reduzindo 60% do código vs for loops — ex: [x**2 for x in range(10)] gera os quadrados de 0 a 9."
Exemplo RUIM: "List Comprehension: É uma forma de criar listas em Python."

### Densidade por Slide
- Todo slide de conteúdo DEVE ter exatamente ${itemsPerSlide} itens.
- Itens com menos de 60 caracteres são REJEITADOS por serem rasos demais.
- Máximo 160 chars por item — seja denso, não prolixo.

### Exemplo Prático = Estudo de Caso Real
- Todo módulo DEVE ter 1+ slide "example_highlight" com cenário concreto.
- Use empresas/projetos/tecnologias reais quando possível.
- ORDEM OBRIGATÓRIA dos 4 itens: Contexto → Desafio → Solução → Resultado
- O Resultado DEVE incluir um dado mensurável.

### Variedade Obrigatória de Layouts
Nunca use o mesmo layout 2 vezes seguidas. Sequência recomendada:
module_cover → bullets → grid_cards/process_timeline → example_highlight → two_column_bullets/comparison_table → warning_callout → summary_slide → numbered_takeaways

### Key Takeaways = Síntese Transformadora
- Os takeaways NÃO repetem conteúdo já dito — sintetizam o que o aluno SABE FAZER agora.
- Use: "Agora você domina...", "Você é capaz de...", "A partir de hoje..."
- Cada takeaway deve ter peso profissional — algo que o aluno vai lembrar 1 ano depois.

## LAYOUTS DISPONÍVEIS

**"module_cover"** — Capa do módulo (SEMPRE o primeiro slide)
- Campos: title (string), objectives (array de 3 strings — habilidades concretas que o aluno vai desenvolver, começando com verbo de ação forte: "Implementar", "Construir", "Analisar", "Dominar")

**"bullets"** — Conteúdo expositivo com profundidade (fundamentos, conceitos avançados)
- Campos: title (DESCRITIVO, nunca genérico — "Como Python Gerencia Memória" não "Python Memória"), sectionLabel (MAIÚSCULAS, máx 3 palavras), items (${itemsPerSlide} strings no formato "Conceito-Chave: Explicação rica e específica com exemplo ou dado.", máx 160 chars)

**"two_column_bullets"** — Comparação ou listagem ampla (6-10 conceitos complementares)
- Campos: title, sectionLabel, items (6-10 strings, cada uma autossuficiente)

**"grid_cards"** — Cards para itens independentes e paralelos (ferramentas, tipos, frameworks)
- Usar para: 3-5 ferramentas, padrões, abordagens ou categorias distintas
- Campos: title, sectionLabel (ex: "FERRAMENTAS", "FRAMEWORKS", "PADRÕES"), items (3-5 strings "Nome Real: Por que usar e quando — benefício concreto.")

**"process_timeline"** — Sequência de etapas ordenadas (fluxo, metodologia, pipeline)
- Campos: title, sectionLabel ("PASSO A PASSO", "FLUXO", "PIPELINE"), items (3-6 etapas, cada uma com ação específica e resultado esperado)

**"comparison_table"** — Tabela comparativa precisa (diferenças entre abordagens/versões/ferramentas)
- Campos: title, sectionLabel ("COMPARATIVO"), tableHeaders (2-4 colunas), tableRows (linhas com dados reais)

**"example_highlight"** — Estudo de caso real com impacto mensurável
- Campos: title ("Caso Real: [Nome do Cenário]"), sectionLabel ("ESTUDO DE CASO"), items (EXATAMENTE 4 strings: "Contexto: empresa/projeto/área específica...", "Desafio: problema concreto com impacto...", "Solução: técnica/ferramenta/abordagem usada...", "Resultado: dado mensurável alcançado...")

**"warning_callout"** — Armadilhas profissionais, antipadrões, erros que custam caro
- Campos: title ("Armadilhas e Antipadrões"), sectionLabel ("ATENÇÃO"), items (3-4 strings — erros reais que profissionais cometem, com consequência)

**"reflection_callout"** — Pergunta estratégica de reflexão profissional
- Campos: title (pergunta impactante), sectionLabel ("REFLEXÃO CRÍTICA"), items (1-2 perguntas que fazem o aluno pensar em como aplicar no trabalho)

**"summary_slide"** — Consolidação do módulo
- Campos: title ("Consolidando o Módulo"), sectionLabel ("SÍNTESE"), items (3-4 strings resumindo as competências adquiridas — use "Você agora domina...", "Este módulo provou que...")

**"numbered_takeaways"** — Key Takeaways finais (SEMPRE o último slide)
- Campos: title ("Key Takeaways"), sectionLabel ("PRINCIPAIS APRENDIZADOS"), items (4-5 strings que sintetizam as transformações profissionais que o aluno viveu — frases com impacto que ele vai guardar)

**"code_block"** — Bloco de código real ou fórmula estruturada (use para cursos técnicos, programação, ciência de dados, finanças, engenharia)
- Campos: title (descritivo: "Como Funciona um Loop for em Python"), sectionLabel ("CÓDIGO", "FÓRMULA", "SINTAXE", "EXEMPLO PRÁTICO"), codeLanguage ("Python", "SQL", "JavaScript", "R", "Bash", "JSON", etc.), codeLines (array de strings — cada string = 1 linha de código REAL E FUNCIONAL, máx 14 linhas)
- items (1-2 strings explicando o que o código faz e por que importa — aparecem como legenda abaixo do bloco)
- USE sempre que o tema envolver: código, scripts, queries, fórmulas, comandos, configurações, exemplos técnicos

## SEQUÊNCIA OBRIGATÓRIA
1. module_cover
2. Conteúdo variado e rico (mínimo 3 slides, máximo 5)
3. summary_slide
4. numbered_takeaways

## REGRAS DE OURO
- **Total máximo: 7 slides por módulo** (incluindo module_cover, summary_slide, numbered_takeaways). Apresentações premium têm menos slides com mais impacto.
- Títulos são DESCRITIVOS e ESPECÍFICOS ao tema: nunca "Fundamentos", sempre "Os 4 Pilares do Gerenciamento de Estado em React"
- **NUNCA repita um título de slide dentro do mesmo módulo.** Crie títulos únicos e descritivos para cada slide.
- **NUNCA use "(Continuação)" em títulos** — crie um título novo e específico para o segundo slide do mesmo tema.
- Frases completas com ponto final
- sectionLabel em MAIÚSCULAS
- Idioma: ${language}

## ⛔ FRASES PROIBIDAS NO numbered_takeaways E summary_slide
NUNCA use estas frases genéricas que aparecem idênticas em TODOS os módulos e destroem a credibilidade do material:
- "Agora você domina os conceitos fundamentais deste módulo e pode aplicá-los na prática"
- "Agora você domina os conceitos centrais e pode aplicá-los com confiança em projetos profissionais reais"
- "Lembre-se de revisar os pontos principais antes de avançar para o próximo módulo"
- "Você é capaz de explicar estes conceitos com suas próprias palavras e usá-los em projetos reais"
- "Continue praticando: a maestria vem com a aplicação consistente do conhecimento adquirido"
- "As ferramentas e padrões apresentados são os mesmos usados pelas maiores empresas de tecnologia do mundo"
- "O estudo de caso demonstrou que a aplicação correta destes conceitos tem impacto direto"
- "Você agora domina os fundamentos teóricos e práticos necessários para aplicar este conhecimento"
- "Você é capaz de identificar o contexto certo para cada abordagem — habilidade que define profissionais sênior"
- "A partir de hoje, você reconhece os antipadrões e sabe exatamente como evitar os erros que custam caro"
- "Lembre-se: o diferencial não é saber a teoria, mas saber QUANDO e COMO aplicar cada técnica"

Os takeaways DEVEM mencionar conceitos específicos do Módulo ${moduleIndex + 1}: **"${moduleTitle}"**.
✅ CORRETO: "Agora você domina list comprehensions e generators — os recursos que tornam código Python verdadeiramente idiomático e 3x mais legível."
✅ CORRETO: "Você é capaz de escrever queries SQL com JOINs complexos e otimizá-las com índices — habilidade presente em 100% dos empregos de dados."
❌ ERRADO: "Agora você domina os conceitos fundamentais deste módulo." ← GENÉRICO, REJEITADO.

## CONTEÚDO DO MÓDULO

**Título:** ${moduleTitle}

**Conteúdo:**
${moduleContent.substring(0, 6000)}

## EXEMPLO DE SAÍDA PREMIUM:
[
  {"layout":"module_cover","title":"${moduleTitle}","objectives":["Implementar soluções completas e otimizadas aplicando os conceitos centrais do módulo.","Analisar problemas reais e escolher a abordagem técnica mais adequada para cada contexto.","Dominar as armadilhas e antipadrões que separam iniciantes de profissionais sênior."]},
  {"layout":"bullets","title":"Os Fundamentos que Todo Profissional Precisa Dominar","sectionLabel":"FUNDAMENTOS","items":["Conceito A (contexto real): Por que este conceito é crítico em produção — dado concreto que comprova sua importância no mercado atual.","Mecanismo Central: Como funciona internamente e qual problema resolve que abordagens anteriores não resolviam de forma eficiente.","Caso de Uso Principal: Onde este conceito brilha — empresa/projeto real que o adotou e os resultados obtidos em produção.","Armadilha Clássica: O erro que 8 em 10 iniciantes cometem com este conceito e como evitá-lo definitivamente."]},
  {"layout":"grid_cards","title":"As Ferramentas que o Mercado Usa em Produção","sectionLabel":"FERRAMENTAS","items":["Ferramenta Real A: Adotada por empresas como Netflix e Airbnb — resolve [problema específico] com performance X% superior à alternativa padrão.","Ferramenta Real B: Padrão de mercado para [caso de uso] — integração nativa com os principais frameworks e suporte ativo da comunidade.","Abordagem C: Quando usar e por quê — diferencia profissionais júnior de sênior na escolha da solução correta para cada contexto."]},
  {"layout":"example_highlight","title":"Caso Real: Como a [Empresa] Resolveu [Problema]","sectionLabel":"ESTUDO DE CASO","items":["Contexto: Time de 15 engenheiros em startup de fintech processando 2M de transações/dia com latência crescente e custos fora de controle.","Desafio: Sistema legado em Python síncrono com gargalo de I/O causando 3s de latência média — inaceitável para compliance bancário.","Solução: Migração incremental para arquitetura assíncrona com asyncio + Redis como cache de sessão, mantendo 100% de compatibilidade.","Resultado: Latência reduzida de 3s para 180ms (94% de melhoria), custo de infra reduzido em 40% e zero incidentes em 6 meses."]},
  {"layout":"summary_slide","title":"Consolidando o Módulo","sectionLabel":"SÍNTESE","items":["Você agora domina asyncio e a diferença entre concorrência e paralelismo — conhecimento que elimina gargalos de I/O em sistemas reais.","Você sabe quando usar asyncio vs threads vs multiprocessing, escolha que separa engenheiros júnior de sênior em revisões de código.","O estudo de caso mostrou que migrar para arquitetura assíncrona reduziu latência de 3s para 180ms — impacto direto em SLA."]},
  {"layout":"numbered_takeaways","title":"Principais Aprendizados","sectionLabel":"PRINCIPAIS APRENDIZADOS","items":["Agora você domina asyncio: cria event loops, escreve coroutines com async/await e gerencia tarefas concorrentes sem race conditions.","Você implementa padrões producer-consumer com asyncio.Queue — base de 90% dos sistemas de alta-throughput em Python moderno.","A partir de hoje você identifica quando asyncio supera threads: operações I/O-bound com dezenas de conexões simultâneas.","Você evita o erro clássico de misturar código bloqueante com async, garantindo que nenhum await 'engole' o event loop."]}
]

Retorne APENAS o array JSON. Nenhum texto antes ou depois.`;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 5: JSON PARSING & VALIDATION
// ═══════════════════════════════════════════════════════════════════

function stripInvalidXmlChars(input: string): string {
  // XML 1.0 valid chars: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
  // Remove unpaired surrogates and invalid codepoints that corrupt OOXML and trigger
  // PowerPoint's "needs repair" dialog.
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    // High surrogate → must be followed by low surrogate
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i] + input[i + 1];
        i++;
        continue;
      }
      // orphan high surrogate → drop
      continue;
    }
    // Lone low surrogate → drop
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    // Forbidden control chars (keep \t \n \r)
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    if (code === 0x7f) continue;
    // Non-characters
    if (code === 0xfffe || code === 0xffff) continue;
    out += input[i];
  }
  return out;
}

function sanitizeText(text: string): string {
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
      try { return String.fromCodePoint(n); } catch { return ""; }
    });
  // Strip XML-invalid chars BEFORE further processing
  out = stripInvalidXmlChars(out);
  return out
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/(\d+)\.\s+(\d{3})/g, "$1.$2")
    .replace(/\|\s*:?-+\s*\|?/g, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*\"\s*\.\s*$/g, ".")
    .replace(/\.\s*\"\s*\./g, ".")
    .replace(/\"\s*\.$/g, ".")
    .trim();
}

async function repairPptxPackage(pptxData: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(pptxData);

  const allFileNames = Object.keys(zip.files);
  const noteFiles = allFileNames.filter((name) =>
    name.startsWith("ppt/notesSlides/") ||
    name.startsWith("ppt/notesMasters/")
  );

  for (const name of noteFiles) {
    zip.remove(name);
  }

  const presentationFile = zip.file("ppt/presentation.xml");
  if (presentationFile) {
    const presentationXml = await presentationFile.async("string");
    const repairedPresentationXml = presentationXml
      .replace(/<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>/g, "")
      .replace(/\s+xmlns:mc="[^"]+"/g, (m) => m)
      .replace(/\s{2,}/g, " ");
    zip.file("ppt/presentation.xml", repairedPresentationXml);
  }

  const presentationRelsFile = zip.file("ppt/_rels/presentation.xml.rels");
  if (presentationRelsFile) {
    const presentationRelsXml = await presentationRelsFile.async("string");
    const repairedPresentationRelsXml = presentationRelsXml
      .replace(/<Relationship[^>]*Type="[^"]*\/notesMaster"[^>]*\/>/g, "")
      .replace(/\s{2,}/g, " ");
    zip.file("ppt/_rels/presentation.xml.rels", repairedPresentationRelsXml);
  }

  const viewPropsFile = zip.file("ppt/viewProps.xml");
  if (viewPropsFile) {
    const viewPropsXml = await viewPropsFile.async("string");
    const repairedViewPropsXml = viewPropsXml
      .replace(/<p:notesTextViewPr>[\s\S]*?<\/p:notesTextViewPr>/g, "")
      .replace(/\s{2,}/g, " ");
    zip.file("ppt/viewProps.xml", repairedViewPropsXml);
  }

  const appPropsFile = zip.file("docProps/app.xml");
  if (appPropsFile) {
    const appPropsXml = await appPropsFile.async("string");
    const repairedAppPropsXml = appPropsXml
      .replace(/<Notes>\d+<\/Notes>/g, "<Notes>0</Notes>")
      .replace(/\s{2,}/g, " ");
    zip.file("docProps/app.xml", repairedAppPropsXml);
  }

  for (const name of allFileNames.filter((fileName) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(fileName))) {
    const slideRelsFile = zip.file(name);
    if (!slideRelsFile) continue;
    const slideRelsXml = await slideRelsFile.async("string");
    const repairedSlideRelsXml = slideRelsXml
      .replace(/<Relationship[^>]*Type="[^"]*\/notesSlide"[^>]*\/>/g, "")
      .replace(/\s{2,}/g, " ");
    zip.file(name, repairedSlideRelsXml);
  }

  const refreshedFileNames = new Set(Object.keys(zip.files));
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) {
    return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }

  const contentTypesXml = await contentTypesFile.async("string");
  let removedOverrides = 0;
  const repairedContentTypes = contentTypesXml.replace(/<Override\b[^>]*PartName="([^"]+)"[^>]*\/>/g, (full, partName) => {
    const normalizedPartName = String(partName || "").replace(/^\//, "");
    if (normalizedPartName && !refreshedFileNames.has(normalizedPartName)) {
      removedOverrides += 1;
      return "";
    }
    return full;
  });

  zip.file("[Content_Types].xml", repairedContentTypes);
  console.warn(
    `[V3-PACKAGE-REPAIR] Removed notes infra (${noteFiles.length} files), normalized notes metadata, and removed ${removedOverrides} dangling [Content_Types] overrides`,
  );
  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

function ensureSentenceEnd(text: string): string {
  const t = sanitizeText(text);
  if (!t) return t;
  if (/[.!?:;"]$/.test(t)) return t;
  return t + ".";
}

// ── Item normalizers ─────────────────────────────────────────────────────
/** Remove leading textual numbering like "01.", "1.", "1)", "1-" that would
 *  duplicate the visual badge already rendered by the layout. */
function stripLeadingNumber(item: string): string {
  return item.replace(/^\s*(\d{1,2}|0\d)[\.\)\-:\s]\s*/, "").trim();
}

/** Strip section-title prefixes that leak from Markdown headings into item text,
 *  e.g. "Objetivo do Módulo: ..." → "..." */
const SECTION_PREFIX_RE = /^(objetivo\s+do\s+m[oó]dulo|fundamentos?|como\s+funciona|aplica[çc][õo]es\s+reais?|exemplo\s+pr[áa]tico|desafios?\s+e\s+cuidados?|resumo\s+do\s+m[oó]dulo|resumo|principais\s+aprendizados?)\s*[:–\-]\s*/i;
function stripSectionPrefix(item: string): string {
  return item.replace(SECTION_PREFIX_RE, "").trim();
}

/** Per-layout hard caps on number of items. */
function layoutMaxItems(layout: SlideLayoutV3, densityMax: number): number {
  switch (layout) {
    case "example_highlight":   return 4;
    case "numbered_takeaways":  return 5;
    case "summary_slide":       return 4;
    case "warning_callout":     return 4;
    case "reflection_callout":  return 2;
    case "grid_cards":          return 5;
    case "process_timeline":    return 6;
    case "two_column_bullets":  return 8;
    case "bullets":             return densityMax;
    default:                    return densityMax;
  }
}

/** Generic takeaway patterns that appear identical across all modules. */
const GENERIC_TAKEAWAY_RE = [
  /agora você domina os conceitos fundamentais/i,
  /conceitos fundamentais deste módulo/i,
  /lembre-se de revisar os pontos principais antes de avançar/i,
  /continue praticando/i,
  /com suas próprias palavras/i,
  /maestria vem com a aplicação consistente/i,
  /fundamentos teóricos e práticos necessários para aplicar/i,
  /aplicação correta destes conceitos tem impacto direto/i,
  /agora você domina os conceitos centrais e pode aplicá-los com confiança/i,
  /você é capaz de identificar o contexto certo para cada abordagem — habilidade que define/i,
  /a partir de hoje, você reconhece os antipadrões e sabe exatamente como evitar/i,
  /o diferencial não é saber a teoria, mas saber quando e como aplicar/i,
];
function isGenericTakeaway(item: string): boolean {
  return GENERIC_TAKEAWAY_RE.some((re) => re.test(item));
}

function normalizeSlide(raw: any, moduleIndex: number, design: DesignConfig): SlidePlan | null {
  raw = sanitizeAndValidate(raw)[0];
  if (!raw || typeof raw !== "object" || !raw.layout) return null;

  const layout = String(raw.layout) as SlideLayoutV3;
  const validLayouts: SlideLayoutV3[] = [
    "module_cover",
    "toc",
    "bullets",
    "two_column_bullets",
    "definition",
    "grid_cards",
    "process_timeline",
    "comparison_table",
    "example_highlight",
    "warning_callout",
    "reflection_callout",
    "summary_slide",
    "numbered_takeaways",
    "closing",
  ];
  if (!validLayouts.includes(layout)) return null;

  const title = sanitizeText(String(raw.title || "")).substring(0, 72) || "Slide";
  const sectionLabel = sanitizeText(String(raw.sectionLabel || "")).substring(0, 30);

  // Items: filter, normalize (strip leading numbers + section prefixes), enforce limits
  const perLayoutMax = layoutMaxItems(layout, design.density.maxItemsPerSlide);
  let items: string[] = [];
  if (Array.isArray(raw.items)) {
    const itemCharLimit = layout === "example_highlight" ? 300 : 130;
    items = raw.items
      .filter((i: any) => typeof i === "string" && i.trim().length > 5)
      .map((i: string) => {
        let s = sanitizeText(i);
        s = stripLeadingNumber(s);
        s = stripSectionPrefix(s);
        return ensureSentenceEnd(s.substring(0, itemCharLimit));
      })
      .filter((i: string) => !isSectionMarker(i))
      .slice(0, perLayoutMax);
  }

  // For example_highlight: enforce canonical 4-phase order
  // Contexto(0) → Desafio(1) → Solução(2) → Resultado(3)
  // IMPLEMENTAÇÃO and any other non-canonical phases are removed
  if (layout === "example_highlight" && items.length > 1) {
    const getPhaseRank = (item: string): number => {
      const lower = item.toLowerCase();
      if (/^(contexto|cen[aá]rio|context)[: ]/.test(lower)) return 0;
      if (/^(desafio|challenge|problema)[: ]/.test(lower)) return 1;
      if (/^(solu[cç][aã]o|a[cç][aã]o|solution|abordagem)[: ]/.test(lower)) return 2;
      if (/^(resultado|impacto|result|conclus[aã]o)[: ]/.test(lower)) return 3;
      return 9; // IMPLEMENTAÇÃO and all other phases: remove
    };
    // Deduplicate by phase rank: keep only first item per rank
    const seenRanks = new Set<number>();
    const deduped: string[] = [];
    for (const item of items) {
      const rank = getPhaseRank(item);
      if (!seenRanks.has(rank)) {
        seenRanks.add(rank);
        deduped.push(item);
      }
    }
    items = deduped.filter((item) => getPhaseRank(item) <= 3).sort((a, b) => getPhaseRank(a) - getPhaseRank(b));
  }

  // Objectives for module_cover
  let objectives: string[] = [];
  if (Array.isArray(raw.objectives)) {
    objectives = raw.objectives
      .filter((o: any) => typeof o === "string" && o.trim().length > 3)
      .map((o: string) => sanitizeText(o).substring(0, 160))
      .slice(0, 3);
  }

  // Table data
  let tableHeaders: string[] | undefined;
  let tableRows: string[][] | undefined;
  if (layout === "comparison_table") {
    if (Array.isArray(raw.tableHeaders) && raw.tableHeaders.length >= 2) {
      tableHeaders = raw.tableHeaders.map((h: any) => sanitizeText(String(h)).substring(0, 40));
    }
    if (Array.isArray(raw.tableRows)) {
      tableRows = raw.tableRows
        .filter((row: any) => Array.isArray(row) && row.length >= 2)
        .map((row: any[]) => row.map((cell: any) => sanitizeText(String(cell)).substring(0, 120)))
        .slice(0, 8);
    }
    // If no valid table data, downgrade to bullets
    if (!tableHeaders || !tableRows || tableRows.length === 0) {
      return { layout: "bullets", title, sectionLabel, items, moduleIndex };
    }
  }

  const plan: SlidePlan = { layout, title, sectionLabel, moduleIndex };
  if (items.length > 0) plan.items = items;
  if (objectives.length > 0) plan.objectives = objectives;
  if (tableHeaders) plan.tableHeaders = tableHeaders;
  if (tableRows) plan.tableRows = tableRows;

  // Guard: skip slides with insufficient content (except structural slides)
  const structuralLayouts: SlideLayoutV3[] = ["module_cover", "toc", "summary_slide", "numbered_takeaways", "closing"];
  if (!structuralLayouts.includes(layout)) {
    const hasItems = (plan.items?.length ?? 0) > 0;
    const hasTable = (plan.tableRows?.length ?? 0) >= 2;

    // Drop slides with no content
    if (!hasItems && !hasTable) return null;

    // Drop slides where ALL items are empty strings or too short
    if (hasItems && plan.items!.every((it) => it.trim().length < 5)) return null;

    // QUALITY-PHASE-1.1: requisito mínimo de densidade reforçado
    if (hasItems && !hasTable) {
      const substantialItems = plan.items!.filter((it) => it.trim().length >= 25);
      const totalChars = substantialItems.reduce((sum, it) => sum + it.length, 0);

      // Drop se menos de 2 itens substanciais
      if (substantialItems.length < 2) {
        console.log(`[V3-GUARD-DROP] Slide "${plan.title}" dropped: only ${substantialItems.length} substantial items (need ≥2). Total chars: ${totalChars}.`);
        return null;
      }

      // Drop se conteúdo muito ralo (< 120 chars totais)
      if (totalChars < 120) {
        console.log(`[V3-GUARD-DROP] Slide "${plan.title}" dropped: total substantial chars ${totalChars} < 120 minimum.`);
        return null;
      }

      if (substantialItems.length !== plan.items!.length) {
        plan.items = substantialItems.slice(0, 6);
      }
    }
  }

  return plan;
}

function buildFallbackSlides(moduleTitle: string, moduleContent: string, moduleIndex: number): SlidePlan[] {
  // Extrair sentenças do conteúdo
  const stripped = moduleContent
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "");

  const sentences = stripped
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25 && s.length < 160)
    .map((s) => ensureSentenceEnd(s))
    .filter((s) => !isSectionMarker(s))
    .slice(0, 16);

  const slides: SlidePlan[] = [
    {
      layout: "module_cover",
      title: moduleTitle,
      objectives: sentences.slice(0, 3).map((s) =>
        s.replace(/^---+\s*/u, "").trim().substring(0, 100),
      ),
      items: [],
      moduleIndex,
    },
  ];

  // FALLBACK-FIX: Agrupar sentenças em chunks de 3-4 itens, NUNCA menos de 3
  const chunks: string[][] = [];
  for (let i = 0; i < sentences.length; i += 4) {
    const chunk = sentences.slice(i, i + 4);
    if (chunk.length >= 3) {
      chunks.push(chunk);
    } else if (chunks.length > 0) {
      // Fundir chunk pequeno com o anterior para evitar slides com 1-2 itens
      const prev = chunks[chunks.length - 1];
      const merged = [...prev, ...chunk];
      // Se a fusão ficar muito grande (>6 itens), divide em 2
      if (merged.length > 6) {
        const half = Math.ceil(merged.length / 2);
        chunks[chunks.length - 1] = merged.slice(0, half);
        chunks.push(merged.slice(half));
      } else {
        chunks[chunks.length - 1] = merged;
      }
    } else if (chunk.length > 0) {
      // Se for o primeiro chunk e tiver < 3, mantém mesmo assim (mínimo possível)
      chunks.push(chunk);
    }
  }

  // Criar slides de conteúdo a partir dos chunks
  for (let ci = 0; ci < Math.min(chunks.length, 4); ci++) {
    const chunk = chunks[ci];
    if (chunk.length > 0) {
      slides.push({
        layout: "bullets",
        title: ci === 0 ? moduleTitle : `${moduleTitle} (Continuação)`,
        sectionLabel: "CONTEÚDO",
        items: chunk.map((s) => {
          const colonIdx = s.indexOf(":");
          if (colonIdx > 0 && colonIdx < 50) return s;
          return s.charAt(0).toUpperCase() + s.slice(1);
        }),
        moduleIndex,
        itemStartIndex: ci * 4,
      });
    }
  }

  // Takeaways de fallback referenciam o título do módulo para não serem genéricos
  slides.push({
    layout: "numbered_takeaways",
    title: "Principais Aprendizados",
    sectionLabel: "PRINCIPAIS APRENDIZADOS",
    items: [
      `Você domina os fundamentos de "${moduleTitle}" e pode aplicá-los em projetos reais.`,
      `Os conceitos de "${moduleTitle}" que você aprendeu são os mesmos usados por profissionais sênior no mercado.`,
      `Você é capaz de identificar quando e como usar as técnicas de "${moduleTitle}" no contexto certo.`,
      "A prática consistente consolida o aprendizado — aplique o que aprendeu em um projeto real esta semana.",
    ],
    moduleIndex,
  });

  console.log(`[V3-FALLBACK] Module ${moduleIndex + 1}: generated ${slides.length} slides from ${sentences.length} sentences in ${chunks.length} chunks`);
  return slides;
}

async function generateSlidesForModule(
  moduleTitle: string,
  moduleContent: string,
  moduleIndex: number,
  design: DesignConfig,
  language: string,
  report: PipelineReport,
): Promise<SlidePlan[]> {
  const density =
    Object.entries(DENSITY_CONFIG).find(([, v]) => v.maxItemsPerSlide === design.density.maxItemsPerSlide)?.[0] ||
    "standard";

  let rawText = "";
  try {
    report.aiCallsTotal++;
    rawText = await callAI(
      "gemini-2.5-flash",
      buildSlidePrompt(moduleTitle, moduleContent, moduleIndex, density, language),
    );
    console.log(`[V3-AI] Module ${moduleIndex + 1} "${moduleTitle}": response length=${rawText.length}`);
  } catch (err: any) {
    // PARSE-FIX-DIAG: Expor o erro real nos logs para diagnóstico
    console.error(`[V3-AI-ERR] Module ${moduleIndex + 1} "${moduleTitle}": ${err.message}`);
    console.error(`[V3-AI-ERR] Module ${moduleIndex + 1} error type: ${err.name || 'unknown'}, code: ${err.code || 'none'}`);
    if (err.stack) {
      console.error(`[V3-AI-ERR] Module ${moduleIndex + 1} stack first 300: ${err.stack.substring(0, 300)}`);
    }
    report.aiCallsFailed++;
    report.fallbacksUsed++;
    report.warnings.push(`[V3-AI] Module ${moduleIndex + 1} AI call failed: ${err.message}. Using fallback.`);
    return buildFallbackSlides(moduleTitle, moduleContent, moduleIndex);
  }

  // Strip markdown code fences if present
  let clean = rawText.trim();
  clean = clean
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // FALLBACK-FIX: Diagnóstico para investigar falhas de parsing
  console.log(`[V3-AI-DIAG] Module ${moduleIndex + 1} raw first 300 chars: ${rawText.substring(0, 300).replace(/\n/g, '\\n')}`);
  console.log(`[V3-AI-DIAG] Module ${moduleIndex + 1} clean first 300 chars: ${clean.substring(0, 300).replace(/\n/g, '\\n')}`);
  console.log(`[V3-AI-DIAG] Module ${moduleIndex + 1} clean length: ${clean.length}, starts with '[': ${clean.startsWith('[')}, ends with ']': ${clean.endsWith(']')}`);

  // Try to extract JSON array
  let parsed: any[];
  try {
    parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) throw new Error("Response is not an array");
  } catch (parseErr: any) {
    // FALLBACK-FIX: Log detalhado do erro de parsing
    console.error(`[V3-PARSE-ERR] Module ${moduleIndex + 1} JSON.parse failed: ${parseErr.message}`);
    console.error(`[V3-PARSE-ERR] Module ${moduleIndex + 1} clean first 500 chars: ${clean.substring(0, 500)}`);
    console.error(`[V3-PARSE-ERR] Module ${moduleIndex + 1} clean last 100 chars: ${clean.substring(Math.max(0, clean.length - 100))}`);

    // Fallback: try to extract JSON array from anywhere in the response
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
        console.log(`[V3-PARSE-OK] Module ${moduleIndex + 1} extracted JSON from regex match, length: ${match[0].length}`);
      } catch (regexParseErr: any) {
        console.error(`[V3-PARSE-ERR] Module ${moduleIndex + 1} regex extraction also failed: ${regexParseErr.message}`);
        report.aiCallsFailed++;
        report.fallbacksUsed++;
        report.warnings.push(`[V3-PARSE] Module ${moduleIndex + 1} JSON parse failed: ${parseErr.message}. Using fallback.`);
        return buildFallbackSlides(moduleTitle, moduleContent, moduleIndex);
      }
    } else {
      console.error(`[V3-PARSE-ERR] Module ${moduleIndex + 1} no JSON array found in response`);
      report.aiCallsFailed++;
      report.fallbacksUsed++;
      report.warnings.push(`[V3-PARSE] Module ${moduleIndex + 1} no JSON array found. Using fallback.`);
      return buildFallbackSlides(moduleTitle, moduleContent, moduleIndex);
    }
  }

  // Normalize each slide
  const slides: SlidePlan[] = sanitizeAndValidate(parsed)
    .map((raw) => normalizeSlide(raw, moduleIndex, design))
    .filter((s): s is SlidePlan => s !== null);

  if (slides.length === 0) {
    report.fallbacksUsed++;
    report.warnings.push(`[V3-VALIDATE] Module ${moduleIndex + 1} produced 0 valid slides. Using fallback.`);
    return buildFallbackSlides(moduleTitle, moduleContent, moduleIndex);
  }

  // ── Post-processing guards ──

  // 1. Ensure module_cover is always first
  if (slides[0].layout !== "module_cover") {
    slides.unshift({
      layout: "module_cover",
      title: moduleTitle,
      objectives: [],
      items: [],
      moduleIndex,
    });
    report.warnings.push(`[V3-GUARD] Added missing module_cover for module ${moduleIndex + 1}`);
  }

  // 2. Ensure numbered_takeaways is last
  const lastSlide = slides[slides.length - 1];
  if (lastSlide.layout !== "numbered_takeaways") {
    slides.push({
      layout: "numbered_takeaways",
      title: language.includes("Port")
        ? "Principais Aprendizados"
        : language.includes("Span")
          ? "Principales Aprendizajes"
          : "Key Takeaways",
      sectionLabel: language.includes("Port")
        ? "PRINCIPAIS APRENDIZADOS"
        : language.includes("Span")
          ? "PRINCIPALES APRENDIZAJES"
          : "KEY TAKEAWAYS",
      items: [
        language.includes("Port")
          ? "Revise o conteúdo do módulo para consolidar o aprendizado."
          : "Review the module content to consolidate your learning.",
      ],
      moduleIndex,
    });
    report.warnings.push(`[V3-GUARD] Added missing numbered_takeaways for module ${moduleIndex + 1}`);
  }

  // 3. Remove slides with no content (except module_cover)
  const filtered = slides.filter((s) => {
    if (s.layout === "module_cover") return true;
    if (s.layout === "comparison_table") return (s.tableRows?.length ?? 0) > 0;
    return (s.items?.length ?? 0) > 0;
  });

  if (filtered.length < slides.length) {
    report.warnings.push(
      `[V3-GUARD] Removed ${slides.length - filtered.length} empty slides in module ${moduleIndex + 1}`,
    );
  }

  // 4. Absorb 1-item slides into the previous slide
  const compacted: SlidePlan[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const curr = filtered[i];
    if (
      curr.layout !== "module_cover" &&
      curr.layout !== "comparison_table" &&
      curr.layout !== "numbered_takeaways" &&
      curr.layout !== "summary_slide" &&
      (curr.items?.length ?? 0) === 1 &&
      compacted.length > 0
    ) {
      const prev = compacted[compacted.length - 1];
      if (prev.layout !== "module_cover" && prev.layout !== "comparison_table" && prev.items) {
        prev.items = [...prev.items, ...(curr.items || [])];
        report.warnings.push(`[V3-COMPACT] Absorbed 1-item slide "${curr.title}" into "${prev.title}"`);
        continue;
      }
    }
    compacted.push(curr);
  }

  // 5. Anti-repetition: diversify 3+ consecutive same layouts
  const LAYOUT_ALTS: Partial<Record<SlideLayoutV3, SlideLayoutV3[]>> = {
    bullets: ["two_column_bullets", "grid_cards"],
    two_column_bullets: ["bullets", "grid_cards"],
    grid_cards: ["two_column_bullets", "bullets"],
  };
  let consecutive = 0;
  for (let i = 1; i < compacted.length; i++) {
    const prev = compacted[i - 1];
    const curr = compacted[i];
    if (curr.layout === "module_cover" || curr.layout === "comparison_table") {
      consecutive = 0;
      continue;
    }
    if (curr.layout === prev.layout) {
      consecutive++;
    } else {
      consecutive = 0;
    }
    if (consecutive >= 2 && LAYOUT_ALTS[curr.layout]) {
      const alts = LAYOUT_ALTS[curr.layout]!;
      const prevPrev = i >= 2 ? compacted[i - 2].layout : null;
      const alt = alts.find((a) => a !== prev.layout && a !== prevPrev) || alts[0];
      report.warnings.push(`[V3-ANTI-REP] Swapped "${curr.layout}" → "${alt}" for "${curr.title}"`);
      compacted[i] = { ...curr, layout: alt };
      consecutive = 0;
    }
  }

  // 6a. QUALITY: Detectar takeaways com frases genéricas proibidas e substituir
  const takeawaysSlideGeneric = compacted.find((s) => s.layout === "numbered_takeaways");
  if (takeawaysSlideGeneric && takeawaysSlideGeneric.items) {
    const langPrefix = language.includes("Port") ? "pt" : language.includes("Span") ? "es" : "en";
    const genericItems = takeawaysSlideGeneric.items.filter(isGenericTakeaway);
    if (genericItems.length > 0) {
      report.warnings.push(
        `[V3-GENERIC-TAKEAWAY] Module ${moduleIndex + 1}: ${genericItems.length} generic takeaway(s) detected and replaced.`,
      );
      const specific = takeawaysSlideGeneric.items.filter((it) => !isGenericTakeaway(it));
      const fill = langPrefix === "pt"
        ? [
            `Você domina os fundamentos de "${moduleTitle}" com profundidade suficiente para usá-los em projetos reais.`,
            `Os conceitos de "${moduleTitle}" aprendidos aqui estão entre os mais exigidos pelo mercado profissional.`,
            `Você identifica quando e como aplicar as técnicas de "${moduleTitle}" conforme o contexto do problema.`,
            `A maestria em "${moduleTitle}" vem da prática — aplique o que aprendeu em um projeto concreto esta semana.`,
          ]
        : langPrefix === "es"
          ? [
              `Dominas los fundamentos de "${moduleTitle}" con suficiente profundidad para usarlos en proyectos reales.`,
              `Los conceptos de "${moduleTitle}" aprendidos aquí están entre los más demandados por el mercado profesional.`,
            ]
          : [
              `You master the fundamentals of "${moduleTitle}" deeply enough to apply them in real projects.`,
              `The concepts from "${moduleTitle}" are among the most in-demand skills in the professional market.`,
            ];
      takeawaysSlideGeneric.items = [...specific, ...fill].slice(0, 5);
    }
  }

  // 6. QUALITY-PHASE-1.1: Detectar e corrigir takeaways copiados do conteúdo
  const takeawaysSlide = compacted.find((s) => s.layout === "numbered_takeaways");
  if (takeawaysSlide && takeawaysSlide.items) {
    const allPreviousPhrases = new Set<string>();
    for (const s of compacted) {
      if (s === takeawaysSlide || s.layout === "module_cover") continue;
      for (const item of s.items || []) {
        const normalized = item.toLowerCase().replace(/[.!?;:]+$/g, "").replace(/\s+/g, " ").trim();
        if (normalized.length > 15) allPreviousPhrases.add(normalized);
      }
    }

    const originalTakeaways = [...takeawaysSlide.items];
    const uniqueTakeaways: string[] = [];
    const duplicateTakeaways: string[] = [];

    for (const item of originalTakeaways) {
      const normalized = item.toLowerCase().replace(/[.!?;:]+$/g, "").replace(/\s+/g, " ").trim();
      let isDuplicate = false;
      for (const prev of allPreviousPhrases) {
        // Only flag as duplicate on exact match, or when the takeaway is very short
        // and is fully contained inside a slide item (not the other way around).
        // This avoids falsely flagging specific takeaways that merely share topic words.
        const isExactMatch = normalized === prev;
        const isShortSubstring = normalized.length < 80 && prev.includes(normalized);
        if (isExactMatch || isShortSubstring) {
          isDuplicate = true;
          break;
        }
      }
      if (isDuplicate) duplicateTakeaways.push(item);
      else uniqueTakeaways.push(item);
    }

    if (duplicateTakeaways.length > 0) {
      report.warnings.push(
        `[V3-TAKEAWAYS-DUP] Module ${moduleIndex + 1}: ${duplicateTakeaways.length}/${originalTakeaways.length} takeaways are copies. Unique: ${uniqueTakeaways.length}`,
      );

      const langPrefix = language.includes("Port") ? "pt" : language.includes("Span") ? "es" : "en";

      if (uniqueTakeaways.length < 2) {
        const fallbackTakeaways =
          langPrefix === "pt"
            ? [
                "Agora você domina os conceitos fundamentais deste módulo e pode aplicá-los na prática.",
                "Lembre-se de revisar os pontos principais antes de avançar para o próximo módulo.",
                "Você é capaz de explicar estes conceitos com suas próprias palavras.",
                "Continue praticando: a maestria vem com a aplicação consistente do conhecimento.",
              ]
            : langPrefix === "es"
              ? [
                  "Ahora dominas los conceptos fundamentales de este módulo y puedes aplicarlos en la práctica.",
                  "Recuerda revisar los puntos principales antes de avanzar al siguiente módulo.",
                  "Eres capaz de explicar estos conceptos con tus propias palabras.",
                  "Sigue practicando: la maestría viene con la aplicación consistente del conocimiento.",
                ]
              : [
                  "You now master the fundamental concepts of this module and can apply them in practice.",
                  "Remember to review the key points before advancing to the next module.",
                  "You can explain these concepts in your own words and use them in real projects.",
                  "Keep practicing: mastery comes with consistent application of the knowledge gained.",
                ];

        takeawaysSlide.items = [...uniqueTakeaways, ...fallbackTakeaways].slice(0, 5);
        report.warnings.push(`[V3-TAKEAWAYS-FALLBACK] Module ${moduleIndex + 1}: replaced ${duplicateTakeaways.length} duplicates with fallback.`);
      } else {
        const genericFallback =
          langPrefix === "pt"
            ? "Continue praticando para consolidar seu aprendizado."
            : langPrefix === "es"
              ? "Sigue practicando para consolidar tu aprendizaje."
              : "Keep practicing to consolidate your learning.";

        takeawaysSlide.items = [...uniqueTakeaways];
        if (takeawaysSlide.items.length < 4) {
          takeawaysSlide.items.push(genericFallback);
        }
      }
    }
  }

  const usedFallback = report.warnings.some(w => w.includes(`Module ${moduleIndex + 1}`) && w.includes("Using fallback"));
  console.log(`[V3-MODULE] Module ${moduleIndex + 1} "${moduleTitle}": ${compacted.length} slides generated${usedFallback ? ' (FALLBACK)' : ' (AI)'}`);
  return compacted;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 6: RENDER UTILITY FUNCTIONS (identical to v2)
// ═══════════════════════════════════════════════════════════════════

let _globalSlideIdx = 0;
let _globalSlideNumber = 0;
let _globalTotalSlides = 0;
let _globalFooterBrand: string | null = "EduGenAI";

// ── SLIDE LOG (returned in response for frontend debug) ──
const VARIANT_NAMES: Record<number, string> = { 0: "SplitScreen", 1: "IndexTab", 2: "CapCards", 3: "Spotlight" };
let _slideLog: Array<Record<string, unknown>> = [];
function _logSlide(fn: string, extra: Record<string, unknown> = {}) {
  _slideLog.push({ "#": _globalSlideIdx, fn, ...extra });
  console.log(`[SLIDE #${_globalSlideIdx}] ${fn}`, extra);
}

function addSlideBackground(slide: any, color: string) {
  slide.background = { fill: color };
}

function addHR(slide: any, x: number, y: number, w: number, color: string, h = 0.028) {
  slide.addShape("rect" as any, { x, y, w, h, fill: { color } });
}

function addGradientBar(
  slide: any,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  direction: "right" | "down" = "right",
) {
  const steps = 6;
  if (direction === "right") {
    const stepW = w / steps;
    for (let i = 0; i < steps; i++) {
      slide.addShape("rect" as any, {
        x: x + i * stepW,
        y,
        w: stepW + 0.01,
        h,
        fill: { color },
        transparency: Math.floor(i * (70 / steps)),
      });
    }
  } else {
    const stepH = h / steps;
    for (let i = 0; i < steps; i++) {
      slide.addShape("rect" as any, {
        x,
        y: y + i * stepH,
        w,
        h: stepH + 0.01,
        fill: { color },
        transparency: Math.floor(i * (70 / steps)),
      });
    }
  }
}

function addCardShadow(
  slide: any,
  x: number,
  y: number,
  w: number,
  h: number,
  shadowColor: string,
  isLightTheme = false,
) {
  slide.addShape("roundRect" as any, {
    x: x + 0.03,
    y: y + 0.04,
    w,
    h,
    fill: { color: shadowColor },
    transparency: isLightTheme ? 78 : 88,
    rectRadius: 0.1,
  });
}

function addLeftEdge(slide: any, color: string) {
  slide.addShape("rect" as any, { x: 0, y: 0, w: 0.09, h: SLIDE_H, fill: { color } });
  slide.addShape("rect" as any, { x: 0.09, y: 0, w: 0.03, h: SLIDE_H, fill: { color }, transparency: 50 });
}

function addSectionLabel(slide: any, label: string, accentColor: string, fontBody: string) {
  slide.addText(label.toUpperCase(), {
    x: 0.55,
    y: 0.32,
    w: 6.0,
    h: 0.24,
    fontSize: 9,
    fontFace: fontBody,
    bold: true,
    color: accentColor,
    charSpacing: 5.5,
  });
}

function addSlideTitle(
  slide: any,
  title: string,
  colors: ReturnType<typeof getColors>,
  fontTitle: string,
  accentColor?: string,
) {
  slide.addText(title, {
    x: 0.55,
    y: 0.64,
    w: SLIDE_W - 1.1,
    h: 0.85,
    fontSize: TYPO.SECTION_TITLE,
    fontFace: fontTitle,
    bold: true,
    color: colors.text,
    valign: "middle",
    lineSpacingMultiple: 1.05,
  });
}

/**
 * renderSlideHeader — unified header renderer for all content slides.
 * Replaces the addSectionLabel + addSlideTitle pattern.
 * Renders differently based on design.visualStyle:
 *   "classic" — floating label above floating title (current behavior)
 *   "band"    — full-width colored band with title inside (McKinsey style)
 *   "minimal" — thin accent line + large title, label below
 */
function renderSlideHeader(
  slide: any,
  title: string,
  sectionLabel: string,
  design: DesignConfig,
  colors: ReturnType<typeof getColors>,
  accentColor?: string,
): void {
  const accent = accentColor || design.palette[0];
  const label = (sectionLabel || "").toUpperCase();

  if (design.visualStyle === "band") {
    const bandH = 1.44;
    // Full-width color band
    slide.addShape("rect" as any, {
      x: 0, y: 0, w: SLIDE_W, h: bandH,
      fill: { color: accent },
    });
    // Bottom shadow of band
    slide.addShape("rect" as any, {
      x: 0, y: bandH - 0.022, w: SLIDE_W, h: 0.022,
      fill: { color: "000000" },
      transparency: 72,
    });
    // Section label inside band
    if (label) {
      slide.addText(label, {
        x: 0.55, y: 0.11, w: SLIDE_W - 1.1, h: 0.27,
        fontSize: 9, fontFace: design.fonts.body, bold: true,
        color: "FFFFFF", charSpacing: 6, transparency: 22,
      });
    }
    // Title inside band
    slide.addText(title, {
      x: 0.55, y: 0.38, w: SLIDE_W - 1.1, h: 0.98,
      fontSize: 30, fontFace: design.fonts.title, bold: true,
      color: "FFFFFF", valign: "middle", lineSpacingMultiple: 1.04,
      autoFit: true,
    });

  } else if (design.visualStyle === "minimal") {
    // Short accent line before title
    slide.addShape("rect" as any, {
      x: 0.55, y: 0.22, w: 0.28, h: 0.016,
      fill: { color: accent },
    });
    // Title — large, positioned high
    slide.addText(title, {
      x: 0.55, y: 0.28, w: SLIDE_W - 1.1, h: 1.0,
      fontSize: 36, fontFace: design.fonts.title, bold: true,
      color: colors.text, valign: "top", lineSpacingMultiple: 1.04,
      autoFit: true,
    });
    // Section label below title
    if (label) {
      slide.addText(label, {
        x: 0.55, y: 1.34, w: 4.5, h: 0.24,
        fontSize: 9, fontFace: design.fonts.body, bold: true,
        color: accent, charSpacing: 5, transparency: 10,
      });
    }

  } else {
    // "classic" — original floating style
    if (label) addSectionLabel(slide, label, accent, design.fonts.body);
    addSlideTitle(slide, title, colors, design.fonts.title, accent);
  }
}

function addFooter(
  slide: any,
  colors: ReturnType<typeof getColors>,
  fontBody: string,
  slideNumber?: number,
  totalSlides?: number,
  footerBrand?: string | null,
) {
  addGradientBar(slide, 0, SLIDE_H - 0.34, SLIDE_W, 0.005, colors.p0, "right");
  addHR(slide, 0, SLIDE_H - 0.335, SLIDE_W, colors.divider, 0.003);
  if (slideNumber !== undefined && totalSlides !== undefined) {
    slide.addText(`${slideNumber} / ${totalSlides}`, {
      x: 0.55,
      y: SLIDE_H - 0.3,
      w: 1.2,
      h: 0.2,
      fontSize: 8,
      fontFace: fontBody,
      color: colors.textSecondary,
      align: "left",
      valign: "middle",
    });
  }
  if (footerBrand) {
    slide.addText(footerBrand, {
      x: SLIDE_W - 1.8,
      y: SLIDE_H - 0.3,
      w: 1.5,
      h: 0.2,
      fontSize: 8,
      fontFace: fontBody,
      bold: true,
      color: colors.textSecondary,
      align: "right",
      valign: "middle",
      charSpacing: 3,
    });
    slide.addShape("ellipse" as any, {
      x: SLIDE_W - 1.92,
      y: SLIDE_H - 0.24,
      w: 0.08,
      h: 0.08,
      fill: { color: colors.p0 },
    });
  }
}

function addImageCredit(slide: any, credit: string, design: DesignConfig) {
  const colors = getColors(design);
  slide.addText(`Foto: ${credit} / Unsplash`, {
    x: SLIDE_W - 2.8,
    y: SLIDE_H - 0.22,
    w: 2.6,
    h: 0.18,
    fontSize: 7,
    fontFace: design.fonts.body,
    color: colors.coverSubtext,
    align: "right",
    transparency: 40,
  });
}

function addHeroTextReadabilityOverlay(slide: any) {
  // IMPORTANT: transparency must be set inside fill for stable rendering in PPT viewers.
  // Subtle global dim to preserve full-bleed photo visibility.
  slide.addShape("rect" as any, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    fill: { color: "000000", transparency: 78 },
  });

  // Stronger panel only where title/body text lives.
  slide.addShape("rect" as any, {
    x: 0,
    y: 0,
    w: SLIDE_W * 0.64,
    h: SLIDE_H,
    fill: { color: "000000", transparency: 58 },
  });

  // Extra support behind date/credit area (bottom-right).
  slide.addShape("roundRect" as any, {
    x: SLIDE_W - 3.35,
    y: SLIDE_H - 0.88,
    w: 3.05,
    h: 0.68,
    fill: { color: "000000", transparency: 35 },
    rectRadius: 0.05,
  });
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 7: RENDER FUNCTIONS (visual engine — identical to v2)
// ═══════════════════════════════════════════════════════════════════

// ── COVER HERO ──
function renderCoverSlide(pptx: PptxGenJS, courseTitle: string, design: DesignConfig, image?: SlideImage | null) {
  const colors = getColors(design);
  const slide = pptx.addSlide();

  if (image) {
    try {
      console.log(
        `[V3-RENDER] Cover image: photoId=${image.photoId ?? "n/a"}, base64 length=${image.base64Data.length}, starts=${image.base64Data.substring(0, 30)}`,
      );
      slide.addImage({ data: image.base64Data, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
    } catch (e) {
      console.error(`[V3-RENDER] Cover background FAILED:`, e);
      addSlideBackground(slide, colors.coverDark);
    }
    addHeroTextReadabilityOverlay(slide);
  } else {
    console.log("[V3-RENDER] Cover: no image provided");
    addSlideBackground(slide, colors.coverDark);
  }

  if (!image) {
    // Large diagonal gradient sweep on right half
    addGradientBar(slide, SLIDE_W * 0.45, 0, SLIDE_W * 0.55, SLIDE_H, colors.p0, "down");
    // Big decorative circle top-right (out of bounds = natural crop)
    slide.addShape("ellipse" as any, {
      x: SLIDE_W * 0.52,
      y: -SLIDE_H * 0.45,
      w: SLIDE_W * 0.75,
      h: SLIDE_W * 0.75,
      fill: { color: colors.p1 },
      transparency: 90,
    });
    // Second circle bottom-right
    slide.addShape("ellipse" as any, {
      x: SLIDE_W * 0.72,
      y: SLIDE_H * 0.55,
      w: SLIDE_W * 0.45,
      h: SLIDE_W * 0.45,
      fill: { color: colors.p2 },
      transparency: 94,
    });
  }
  if (design.theme === "light" && !image) {
    // Dot grid right side
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        slide.addShape("ellipse" as any, {
          x: SLIDE_W - 3.2 + col * 0.52,
          y: 0.5 + row * 0.52,
          w: 0.07,
          h: 0.07,
          fill: { color: colors.p0 },
          transparency: 68,
        });
      }
    }
  }
  slide.addShape("rect" as any, {
    x: 0.8,
    y: 0.9,
    w: 0.035,
    h: SLIDE_H - 1.8,
    fill: { color: colors.p0 },
    transparency: 30,
  });
  if (!image) {
    for (let b = 0; b < 5; b++) {
      slide.addShape("roundRect" as any, {
        x: 0.28,
        y: 1.1 + b * 0.3,
        w: 0.32,
        h: 0.18,
        fill: { color: design.palette[b % design.palette.length] },
        transparency: 15,
        rectRadius: 0.04,
      });
    }
  }
  addHR(slide, 1.2, 1.3, 3.5, colors.p0, 0.018);
  slide.addText(design.courseType || "CURSO COMPLETO", {
    x: 1.2,
    y: 1.55,
    w: 5.0,
    h: 0.28,
    fontSize: 10,
    fontFace: design.fonts.body,
    bold: true,
    color: colors.p0,
    charSpacing: 8,
  });
  slide.addText(courseTitle, {
    x: 1.2,
    y: 1.85,
    w: SLIDE_W * 0.62,
    h: 3.6,
    fontSize: TYPO.COVER_TITLE,
    fontFace: design.fonts.title,
    bold: true,
    color: "FFFFFF",
    valign: "top",
    lineSpacingMultiple: 1.0,
  });
  addGradientBar(slide, 1.2, 5.6, 3.5, 0.08, colors.p0, "right");
  if (!image) {
    for (let i = 0; i < 3; i++) {
      const sz = 0.5 + i * 0.35;
      slide.addShape("roundRect" as any, {
        x: SLIDE_W - 2.6 + i * 0.55,
        y: 0.4 + i * 0.9,
        w: sz,
        h: sz,
        fill: { color: design.palette[i % design.palette.length] },
        transparency: 82,
        rectRadius: 0.06,
      });
    }
  }
  slide.addShape("ellipse" as any, { x: 1.2, y: 5.82, w: 0.12, h: 0.12, fill: { color: colors.p0 } });
  addHR(slide, 1.2, SLIDE_H - 1.2, 3.0, colors.p0, 0.012);
  const dateStr = new Intl.DateTimeFormat("pt-BR", { year: "numeric", month: "long" }).format(new Date());
  slide.addText(dateStr, {
    x: SLIDE_W - 3.0,
    y: SLIDE_H - 0.65,
    w: 2.6,
    h: 0.3,
    fontSize: 10,
    fontFace: design.fonts.body,
    color: colors.coverSubtext,
    align: "right",
    charSpacing: 2.5,
  });
  if (image) addImageCredit(slide, image.credit, design);
}

// ── TOC ──
// GEMMA v3.9.9 — limpeza inteligente da descrição do TOC:
// 1) remove o título do módulo se a descrição começar com ele (redundância)
// 2) extrai apenas o texto após "🎯 Objetivo do Módulo" / "🎯"
// 3) remove marcadores de seção (---, 🧠, ⚙️, etc.) que vazam do markdown
// 4) só então aplica o truncamento, evitando glifos quebrados
function cleanTOCDescription(rawDesc: string, moduleTitle: string): string {
  let s = sanitizeText(rawDesc || "").trim();
  if (!s) return "";

  // Remove separadores markdown e prefixos de marcador de seção (---, ***, etc.)
  s = s.replace(/^[-*_]{3,}\s*/g, "").trim();

  // Se houver marcador 🎯, prioriza o conteúdo após ele
  const targetMatch = s.match(/🎯\s*(?:Objetivo\s+do\s+M[óo]dulo\s*[:\-–—]?\s*)?(.+)/iu);
  if (targetMatch && targetMatch[1]) {
    s = targetMatch[1].trim();
  }

  // Remove emoji/ícone líder remanescente
  s = s.replace(/^[\u{1F300}-\u{1FFFF}\u2600-\u27FF]\s*/u, "").trim();

  // Remove "Módulo N:" prefix
  s = s.replace(/^M[óo]dulo\s+\w+\s*[:\-–—]\s*/i, "").trim();

  // Remove título repetido no início (case-insensitive, tolerante a pontuação final)
  if (moduleTitle) {
    const cleanTitle = moduleTitle.replace(/^M[óo]dulo\s+\w+\s*[:\-–—]\s*/i, "").trim();
    if (cleanTitle.length > 4) {
      const escaped = cleanTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`^${escaped}\\s*[:\\-–—.]*\\s*`, "i");
      s = s.replace(re, "").trim();
    }
  }

  // Remove ponto final solitário e espaços
  s = s
    .replace(/^[\s.:\-–—]+/, "")
    .replace(/\.$/, "")
    .trim();
  // Colapsa whitespace múltiplo (quebras de linha viram espaço único)
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Corte inteligente em fronteira de palavra com reticências.
// Evita overflow visual catastrófico no PPTX quando o objetivo do módulo
// é um parágrafo inteiro (>300 chars).
function smartTruncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  const slice = s.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut.replace(/[\s.,;:\-–—]+$/, "") + "…";
}

function renderTOC(pptx: PptxGenJS, modules: { title: string; description?: string }[], design: DesignConfig) {
  const colors = getColors(design);
  const MAX_PER_PAGE = 6;
  const pages: { title: string; description?: string }[][] = [];
  for (let i = 0; i < modules.length; i += MAX_PER_PAGE) {
    pages.push(modules.slice(i, i + MAX_PER_PAGE));
  }

  for (let page = 0; page < pages.length; page++) {
    const pageModules = pages[page];
    const slide = pptx.addSlide();
    addSlideBackground(slide, colors.coverDark);
    addHR(slide, 0, 0.03, SLIDE_W, colors.p0, 0.045);

    slide.addText("CONTEÚDO PROGRAMÁTICO", {
      x: 0.65,
      y: 0.32,
      w: 6.0,
      h: 0.24,
      fontSize: 10,
      fontFace: design.fonts.body,
      bold: true,
      color: colors.p0,
      charSpacing: 6,
    });
    slide.addText(pages.length > 1 ? `Índice  ·  ${page + 1}/${pages.length}` : "Índice", {
      x: 0.65,
      y: 0.62,
      w: 8.0,
      h: 0.6,
      fontSize: 32,
      fontFace: design.fonts.title,
      bold: true,
      color: "FFFFFF",
      valign: "middle",
    });
    addHR(slide, 0.65, 1.3, 2.0, colors.p0, 0.03);

    const progressY = 1.5;
    slide.addShape("rect" as any, {
      x: 0.65,
      y: progressY,
      w: SLIDE_W - 1.3,
      h: 0.04,
      fill: { color: colors.panelMid },
    });
    slide.addShape("rect" as any, {
      x: 0.65,
      y: progressY,
      w: (SLIDE_W - 1.3) * ((page + 1) / pages.length),
      h: 0.04,
      fill: { color: colors.p0 },
    });

    const globalOffset = page * MAX_PER_PAGE;
    const useListLayout = modules.length >= 5; // GEMMA v3.9.10: Mudar de 6 para 5 melhora legibilidade de cursos médios

    if (useListLayout) {
      const itemH = Math.min(0.85, (SLIDE_H - 1.8 - 0.45) / pageModules.length);
      for (let i = 0; i < pageModules.length; i++) {
        const mod = pageModules[i];
        const pal = design.palette[(globalOffset + i) % design.palette.length];
        const y = 1.8 + i * (itemH + 0.08);
        const cleaned = mod.description ? cleanTOCDescription(mod.description, mod.title) : "";
        const desc = cleaned ? smartTruncate(cleaned, 180) : "";

        slide.addShape("roundRect" as any, {
          x: 0.65,
          y: y + itemH / 2 - 0.18,
          w: 0.36,
          h: 0.36,
          fill: { color: pal },
          rectRadius: 0.06,
        });
        slide.addText(String(globalOffset + i + 1), {
          x: 0.65,
          y: y + itemH / 2 - 0.18,
          w: 0.36,
          h: 0.36,
          fontSize: 13,
          fontFace: design.fonts.title,
          bold: true,
          color: "FFFFFF",
          align: "center",
          valign: "middle",
        });
        slide.addText(mod.title, {
          x: 1.18,
          y,
          w: 5.5,
          h: itemH,
          fontSize: 13,
          fontFace: design.fonts.title,
          bold: true,
          color: "FFFFFF",
          valign: "middle",
        });
        if (desc) {
          slide.addText(desc, {
            x: 7.0,
            y,
            w: SLIDE_W - 7.5,
            h: itemH,
            fontSize: 12,
            fontFace: design.fonts.body,
            color: colors.coverSubtext,
            valign: "middle",
            lineSpacingMultiple: 1.15,
          });
        }
        if (i < pageModules.length - 1) {
          addHR(slide, 0.65, y + itemH + 0.04, SLIDE_W - 1.2, colors.divider, 0.008);
        }
      }
    } else {
      const cols = pageModules.length <= 3 ? pageModules.length : pageModules.length <= 4 ? 2 : 3;
      const rows = Math.ceil(pageModules.length / cols);
      const gap = 0.18;
      const gridX = 0.65;
      const gridW = SLIDE_W - 1.3;
      const cardW = (gridW - gap * (cols - 1)) / cols;
      const gridY = 1.8;
      const gridH = SLIDE_H - gridY - 0.3;
      const cardH = Math.min(2.9, (gridH - gap * (rows - 1)) / rows); // Aumentado de 2.5 para 2.9 para evitar transbordo

      for (let i = 0; i < pageModules.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = gridX + col * (cardW + gap);
        const y = gridY + row * (cardH + gap);
        const pal = design.palette[(globalOffset + i) % design.palette.length];
        const num = String(globalOffset + i + 1);
        const cleaned = pageModules[i].description
          ? cleanTOCDescription(pageModules[i].description!, pageModules[i].title)
          : "";
        const maxChars = cardW < 2.35 || cardH < 1.55 ? 85 : cardW < 3.45 || cardH < 1.95 ? 125 : 165; // Reduzido para caber fisicamente nos cards
        const desc = cleaned ? smartTruncate(cleaned, maxChars) : "";

        slide.addShape("roundRect" as any, {
          x: x + 0.02,
          y: y + 0.03,
          w: cardW,
          h: cardH,
          fill: { color: "000000" },
          transparency: 70,
          rectRadius: 0.12,
        });
        slide.addShape("roundRect" as any, {
          x,
          y,
          w: cardW,
          h: cardH,
          fill: { color: colors.panelMid },
          rectRadius: 0.12,
        });
        slide.addShape("rect" as any, {
          x,
          y,
          w: 0.05,
          h: cardH,
          fill: { color: pal },
          rectRadius: 0.12,
        });

        const badgeS = Math.min(0.44, cardH * 0.25);
        slide.addShape("roundRect" as any, {
          x: x + 0.14,
          y: y + 0.14,
          w: badgeS,
          h: badgeS,
          fill: { color: pal },
          rectRadius: 0.08,
        });
        slide.addText(num, {
          x: x + 0.14,
          y: y + 0.14,
          w: badgeS,
          h: badgeS,
          fontSize: Math.min(18, badgeS * 38),
          fontFace: design.fonts.title,
          bold: true,
          color: "FFFFFF",
          align: "center",
          valign: "middle",
        });

        const titleY = y + 0.14 + badgeS + 0.08;
        const titleH = Math.min(0.6, (cardH - badgeS - 0.36) * 0.5);
        slide.addText(pageModules[i].title, {
          x: x + 0.14,
          y: titleY,
          w: cardW - 0.28,
          h: titleH,
          fontSize: cardH < 1.4 ? 12 : 14,
          fontFace: design.fonts.title,
          bold: true,
          color: "FFFFFF",
          valign: "top",
          lineSpacingMultiple: 1.06,
          autoFit: true,
        });

        const sepY = titleY + titleH + 0.04;
        addHR(slide, x + 0.14, sepY, cardW * 0.45, pal, 0.01);

        if (desc) {
          const descY = sepY + 0.06;
          const descH = Math.max(0.2, y + cardH - descY - 0.12);
          slide.addText(desc, {
            x: x + 0.14,
            y: descY,
            w: cardW - 0.28,
            h: descH,
            fontSize: 11,
            fontFace: design.fonts.body,
            color: colors.coverSubtext,
            valign: "top",
            lineSpacingMultiple: 1.12,
            autoFit: true, // Reduz fonte se necessário para não transbordar
          });
        }

        slide.addShape("ellipse" as any, {
          x: x + cardW - 0.26,
          y: y + cardH - 0.22,
          w: 0.08,
          h: 0.08,
          fill: { color: pal },
          transparency: 40,
        });
      }
    }
  }
}

// ── MODULE COVER ──
// GEMMA v3.9 — refatorado para SAFE_ZONE: faixa lateral em SAFE_ZONE.X (0.80),
// título e bloco de objetivos contidos em SAFE_ZONE.Y..(Y+H)=1.60..6.80.
function renderModuleCover(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig, image?: SlideImage | null) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  const modIdx = plan.moduleIndex ?? 0;
  const modNum = String(modIdx + 1);
  const accentColor = design.palette[modIdx % design.palette.length];
  const hasImage = !!image;
  const contentW = hasImage ? SLIDE_W * 0.62 : SLIDE_W;

  addSlideBackground(slide, colors.coverDark);

  if (hasImage) {
    const imgX = contentW;
    const imgW = SLIDE_W - contentW;
    try {
      slide.addImage({ data: image!.base64Data, x: imgX, y: 0, w: imgW, h: SLIDE_H });
    } catch {}
    slide.addShape("rect" as any, { x: imgX, y: 0, w: 0.04, h: SLIDE_H, fill: { color: accentColor } });
    addImageCredit(slide, image!.credit, design);
  }

  if (!hasImage) {
    // Right-side architectural panel — dark accent bg
    slide.addShape("rect" as any, {
      x: contentW * 0.68, y: 0,
      w: SLIDE_W - contentW * 0.68, h: SLIDE_H,
      fill: { color: colors.panelDark },
    });
    // Bold accent vertical bar at the seam
    slide.addShape("rect" as any, {
      x: contentW * 0.68, y: 0,
      w: 0.06, h: SLIDE_H,
      fill: { color: accentColor }, transparency: 18,
    });
    // Diagonal stripe pattern inside right panel (6 parallel rotated bars)
    const stripeX = contentW * 0.68 + 0.3;
    const panelW = SLIDE_W - stripeX - 0.1;
    for (let s = 0; s < 6; s++) {
      slide.addShape("rect" as any, {
        x: stripeX + s * (panelW / 6),
        y: -0.6,
        w: panelW / 14,
        h: SLIDE_H + 1.2,
        fill: { color: accentColor },
        transparency: 88 + s * 1.5,
        rotate: 20,
      });
    }
    // Large ghost module number — fills right panel bottom
    slide.addText(modNum, {
      x: contentW * 0.65,
      y: SLIDE_H * 0.28,
      w: SLIDE_W - contentW * 0.65 - 0.2,
      h: SLIDE_H * 0.72,
      fontSize: TYPO.MODULE_NUMBER,
      fontFace: design.fonts.title,
      bold: true,
      color: accentColor,
      transparency: 72,
      align: "center",
      valign: "bottom",
    });
    // Small accent circle top-right
    slide.addShape("ellipse" as any, {
      x: SLIDE_W - 1.1, y: 0.32,
      w: 0.18, h: 0.18,
      fill: { color: accentColor }, transparency: 10,
    });
    // Horizontal dots row under circle
    for (let d = 0; d < 4; d++) {
      slide.addShape("ellipse" as any, {
        x: SLIDE_W - 1.9 + d * 0.28, y: 0.6,
        w: 0.07, h: 0.07,
        fill: { color: accentColor }, transparency: 55,
      });
    }
  }

  slide.addShape("rect" as any, { x: 0.8, y: 1.1, w: 0.05, h: 2.3, fill: { color: accentColor } });
  slide.addShape("rect" as any, { x: 0.88, y: 1.1, w: 0.015, h: 2.3, fill: { color: accentColor }, transparency: 50 });
  slide.addText(`MÓDULO ${modNum}`, {
    x: 1.1,
    y: 1.2,
    w: 5.0,
    h: 0.3,
    fontSize: 12,
    fontFace: design.fonts.body,
    bold: true,
    color: accentColor,
    charSpacing: 10,
  });
  addHR(slide, 1.1, 1.57, 2.0, accentColor, 0.025);
  const titleW = hasImage ? contentW * 0.75 : SLIDE_W * 0.56;
  slide.addText(plan.title, {
    x: 1.1,
    y: 1.75,
    w: titleW,
    h: 2.6,
    fontSize: TYPO.MODULE_TITLE,
    fontFace: design.fonts.title,
    bold: true,
    color: "FFFFFF",
    valign: "top",
    lineSpacingMultiple: 1.04,
  });

  if (plan.objectives && plan.objectives.length > 0) {
    const objStartY = 4.65;
    const objW = hasImage ? contentW * 0.7 : SLIDE_W * 0.48;
    addHR(slide, 1.1, objStartY - 0.12, 2.2, accentColor, 0.012);
    slide.addText("O QUE VOCÊ VAI APRENDER", {
      x: 1.1,
      y: objStartY,
      w: 5.0,
      h: 0.22,
      fontSize: 8,
      fontFace: design.fonts.body,
      bold: true,
      color: accentColor,
      charSpacing: 5,
    });
    for (let i = 0; i < Math.min(plan.objectives.length, 3); i++) {
      const objY = objStartY + 0.32 + i * 0.5;
      slide.addShape("roundRect" as any, {
        x: 1.1,
        y: objY + 0.05,
        w: 0.12,
        h: 0.12,
        fill: { color: accentColor },
        rectRadius: 0.02,
      });
      slide.addText(plan.objectives[i], {
        x: 1.35,
        y: objY,
        w: objW,
        h: 0.45,
        fontSize: 11,
        fontFace: design.fonts.body,
        color: colors.coverSubtext,
        valign: "middle",
        lineSpacingMultiple: 1.12,
      });
    }
  }
  addGradientBar(slide, 0.8, SLIDE_H - 0.45, 3.5, 0.008, accentColor, "right");
}

// ── BULLETS (4 variants) ──
function renderBullets(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  const variant = _globalSlideIdx % 4;
  const accentColor = design.palette[_globalSlideIdx % design.palette.length];
  const rawItems = plan.items || [];
  const items = rawItems.map((item) => normalizeRenderableBulletText(item)).filter(Boolean);
  _logSlide("bullets", { variant: VARIANT_NAMES[variant] ?? variant, items: items.length, title: plan.title?.slice(0, 40), theme: design.theme, template: design.template });
  const unifiedBulletFontSize = computeUnifiedSlideFontSize(
    items,
    items.length >= 6 ? 18 : 19,
    items.length >= 6 ? 78 : 92,
    MIN_FONT.BODY,
  );

  const contentX = SAFE_ZONE.X;
  const contentW = SAFE_ZONE.W;
  const contentY = SAFE_ZONE.Y + 0.05;
  const contentH = SAFE_ZONE.H - 0.05;
  const bulletGap = items.length >= 6 ? 0.04 : 0.07;
  const rawItemH = (contentH - bulletGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1);
  // No upper cap — let cards expand to fill content area (text auto-shrinks via shrinkText)
  const itemH = Math.max(0.5, rawItemH);

  const strongTextOpts = (x: number, y: number, w: number, h: number, color = colors.text, valign: "top" | "middle" = "middle") => ({
    x,
    y,
    w,
    h,
    fontSize: unifiedBulletFontSize,
    fontFace: design.fonts.body,
    color,
    valign,
    wrap: true,
    fit: "shrink",
    shrinkText: true,
    maxFontSize: Math.min(20, unifiedBulletFontSize + 1.5),
    minFontSize: 12,
    lineSpacingMultiple: 1.16,
    margin: 0.06,
  } as any);

  const addBulletText = (text: string, x: number, y: number, w: number, h: number, pal: string, color = colors.text, valign: "top" | "middle" = "middle") => {
    const cleaned = normalizeRenderableBulletText(text);
    const colonIdx = cleaned.indexOf(":");
    const hasTitle = colonIdx > 0 && colonIdx < 48;
    if (hasTitle) {
      const title = cleaned.substring(0, colonIdx).trim();
      const desc = cleaned.substring(colonIdx + 1).trim();
      slide.addText(
        [
          { text: `${title}: `, options: { bold: true, color: pal } },
          { text: desc, options: { color } },
        ] as any,
        strongTextOpts(x, y, w, h, color, valign),
      );
      return;
    }
    slide.addText(cleaned, strongTextOpts(x, y, w, h, color, valign));
  };

  if (variant === 0) {
    addSlideBackground(slide, colors.bg);
    addLightBgDecoration(slide, design, colors);
    const sideW = SLIDE_W * 0.35;
    slide.addShape("rect" as any, { x: 0, y: 0, w: sideW, h: SLIDE_H, fill: { color: colors.coverDark } });
    addGradientBar(slide, 0, 0, sideW, SLIDE_H, accentColor, "down");
    // Diagonal stripe decoration inside left panel
    for (let s = 0; s < 4; s++) {
      slide.addShape("rect" as any, {
        x: sideW * 0.35 + s * (sideW * 0.18),
        y: -0.5, w: sideW * 0.06, h: SLIDE_H + 1.0,
        fill: { color: accentColor }, transparency: 91 + s,
        rotate: 22,
      });
    }
    // Ghost large section number watermark bottom of panel
    slide.addText(String((_globalSlideIdx % 9) + 1).padStart(2, "0"), {
      x: -0.1, y: SLIDE_H * 0.3, w: sideW + 0.2, h: SLIDE_H * 0.7,
      fontSize: 110, fontFace: design.fonts.title, bold: true,
      color: accentColor, transparency: 87,
      align: "center", valign: "bottom",
    });
    slide.addShape("rect" as any, { x: sideW, y: 0, w: 0.05, h: SLIDE_H, fill: { color: accentColor } });
    slide.addShape("rect" as any, {
      x: sideW + 0.05, y: 0, w: 0.015, h: SLIDE_H,
      fill: { color: accentColor }, transparency: 50,
    });
    if (plan.sectionLabel) {
      slide.addText(plan.sectionLabel.toUpperCase(), {
        x: 0.45, y: 0.55,
        w: sideW - 0.9, h: 0.22,
        fontSize: 9, fontFace: design.fonts.body, bold: true,
        color: accentColor, charSpacing: 4,
      });
      addHR(slide, 0.45, 0.82, 1.2, accentColor, 0.012);
    }
    // Small accent dot above title
    slide.addShape("ellipse" as any, {
      x: 0.45, y: plan.sectionLabel ? 1.06 : 0.9,
      w: 0.09, h: 0.09,
      fill: { color: accentColor }, transparency: 15,
    });
    slide.addText(plan.title, {
      x: 0.45,
      y: plan.sectionLabel ? 1.22 : 1.05,
      w: sideW - 0.9,
      h: 3.2,
      fontSize: MIN_FONT.TITLE,
      fontFace: design.fonts.title,
      bold: true,
      color: "FFFFFF",
      valign: "top",
      lineSpacingMultiple: 1.08,
    });
    const rightX = sideW + 0.35;
    const rightW = SLIDE_W - rightX - 0.45;
    const rightY = 0.5;
    const rightH = SLIDE_H - rightY - 0.7;
    const rBulletGap = items.length >= 6 ? 0.03 : 0.05;
    // No upper cap — let items expand to fill the right panel height
    const rItemH = Math.max(0.46, (rightH - rBulletGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1));
    for (let i = 0; i < items.length; i++) {
      const yPos = rightY + i * (rItemH + rBulletGap);
      const pal = design.palette[i % design.palette.length];
      slide.addShape("rect" as any, { x: rightX, y: yPos + 0.08, w: 0.045, h: rItemH - 0.18, fill: { color: pal } });
      addBulletText(rawItems[i] || items[i], rightX + 0.2, yPos + 0.01, rightW - 0.24, rItemH - 0.02, pal);
      if (i < items.length - 1) addHR(slide, rightX + 0.2, yPos + rItemH + rBulletGap / 2 - 0.003, rightW - 0.24, colors.divider, 0.005);
    }
  } else if (variant === 1) {
    // "Index Tab" cards — wide left panel with big number + text area on right
    addSlideBackground(slide, colors.bg);
    addLightBgDecoration(slide, design, colors);
    if (design.visualStyle !== "minimal") addLeftEdge(slide, accentColor);
    renderSlideHeader(slide, plan.title, plan.sectionLabel || "", design, colors, accentColor);
    const singleItem = items.length === 1;
    const effectiveItemH = singleItem ? contentH : itemH;
    const tabW = Math.min(0.72, effectiveItemH * 0.7);
    for (let i = 0; i < items.length; i++) {
      const pal = design.palette[i % design.palette.length];
      const yPos = contentY + i * (effectiveItemH + bulletGap);
      const cardH = effectiveItemH - 0.05;
      // Shadow
      addCardShadow(slide, contentX, yPos, contentW, cardH, colors.shadowColor, design.theme === "light");
      // Full card bg
      slide.addShape("roundRect" as any, {
        x: contentX, y: yPos, w: contentW, h: cardH,
        fill: { color: colors.cardBg },
        rectRadius: 0.1,
        line: { color: colors.borders, width: 0.5 },
      });
      // Colored left panel — rounded only on left side: draw roundRect + mask right rounded corners
      slide.addShape("roundRect" as any, { x: contentX, y: yPos, w: tabW + 0.1, h: cardH, fill: { color: pal }, rectRadius: 0.1 });
      slide.addShape("rect" as any, { x: contentX + tabW, y: yPos, w: 0.1, h: cardH, fill: { color: pal } });
      // Number in panel
      const numStr = String(((plan.itemStartIndex ?? 0) + i + 1)).padStart(2, "0");
      slide.addText(numStr, {
        x: contentX, y: yPos, w: tabW, h: cardH,
        fontSize: Math.min(38, Math.max(14, cardH * 22)),
        fontFace: design.fonts.title, bold: true,
        color: "FFFFFF", align: "center", valign: "middle",
        transparency: 5,
      });
      // Thin separator line between panel and text
      slide.addShape("rect" as any, { x: contentX + tabW + 0.1, y: yPos + cardH * 0.2, w: 0.008, h: cardH * 0.6, fill: { color: pal }, transparency: 55 });
      // Text area
      addBulletText(rawItems[i] || items[i], contentX + tabW + 0.22, yPos + 0.03, contentW - tabW - 0.32, cardH - 0.06, pal);
    }
  } else if (variant === 2) {
    // "Cap Cards" — colored header band at top of each card with big number, text below
    addSlideBackground(slide, colors.bg);
    addLightBgDecoration(slide, design, colors);
    if (design.visualStyle !== "minimal") addLeftEdge(slide, accentColor);
    renderSlideHeader(slide, plan.title, plan.sectionLabel || "", design, colors, accentColor);
    const cols = items.length >= 4 ? 2 : 1;
    const gap = 0.18;
    const cardW = cols === 2 ? (contentW - gap) / 2 : contentW;
    const rows = Math.ceil(items.length / cols);
    const singleCard = rows === 1 && cols === 1;
    const rawCardH = (contentH - gap * (rows - 1)) / rows - 0.04;
    // No upper cap — cards expand to fill content area; text auto-shrinks
    const cardH = singleCard
      ? contentH - 0.02
      : Math.max(1.12, rawCardH);
    // Larger cap (0.72) so header band stays prominent on tall cards
    const capH = Math.min(0.72, cardH * (singleCard ? 0.22 : 0.38));
    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = contentX + col * (cardW + gap);
      const y = contentY + row * (cardH + gap);
      const pal = design.palette[i % design.palette.length];
      // Shadow
      addCardShadow(slide, x, y, cardW, cardH, colors.shadowColor, design.theme === "light");
      // Card body (full)
      slide.addShape("roundRect" as any, { x, y, w: cardW, h: cardH, fill: { color: colors.cardBg }, rectRadius: 0.12 });
      // Colored cap — roundRect for top corners, rect to square off bottom of cap
      slide.addShape("roundRect" as any, { x, y, w: cardW, h: capH + 0.12, fill: { color: pal }, rectRadius: 0.12 });
      slide.addShape("rect" as any, { x, y: y + capH, w: cardW, h: 0.13, fill: { color: pal } });
      // Decorative watermark number (large, transparent, right-aligned in cap)
      const numStr = String(((plan.itemStartIndex ?? 0) + i + 1)).padStart(2, "0");
      slide.addText(numStr, {
        x: x + cardW * 0.45, y, w: cardW * 0.5, h: capH,
        fontSize: Math.min(36, capH * 68), fontFace: design.fonts.title, bold: true,
        color: "FFFFFF", align: "right", valign: "middle", transparency: 22,
      });
      // Number small left-aligned
      slide.addText(numStr, {
        x: x + 0.14, y, w: 0.6, h: capH,
        fontSize: Math.min(24, capH * 46), fontFace: design.fonts.title, bold: true,
        color: "FFFFFF", align: "left", valign: "middle",
      });
      // Text below cap
      addBulletText(rawItems[i] || items[i], x + 0.14, y + capH + 0.14, cardW - 0.26, cardH - capH - 0.22, pal, colors.text, "top");
    }
  } else {
    // "Spotlight" layout — featured first item + mini Index-Tab rows below
    addSlideBackground(slide, colors.bg);
    addLightBgDecoration(slide, design, colors);
    if (design.visualStyle !== "minimal") addLeftEdge(slide, accentColor);
    renderSlideHeader(slide, plan.title, plan.sectionLabel || "", design, colors, accentColor);
    if (items.length > 0) {
      const heroH = items.length === 1 ? contentH : Math.min(1.56, contentH * 0.40);
      const spotTabW = Math.min(0.92, heroH * 0.62);

      // Shadow for spotlight card (light theme only — dark theme has no shadow against dark bg)
      if (design.theme === "light") addCardShadow(slide, contentX, contentY, contentW, heroH, colors.shadowColor, true);
      // Spotlight card body — on dark theme use panelMid (slightly lighter) so card is distinguishable
      const heroBg = design.theme === "dark" ? colors.panelMid : colors.coverDark;
      slide.addShape("roundRect" as any, {
        x: contentX, y: contentY, w: contentW, h: heroH,
        fill: { color: heroBg }, rectRadius: 0.12,
        line: { color: accentColor, width: 1.2, transparency: 40 },
      });
      // Large decorative watermark number
      slide.addText("01", {
        x: contentX + contentW - 1.4, y: contentY, w: 1.3, h: heroH,
        fontSize: Math.min(60, heroH * 110), fontFace: design.fonts.title, bold: true,
        color: "FFFFFF", align: "right", valign: "middle", transparency: 88,
      });
      // Colored left accent panel — rounded left corners
      slide.addShape("roundRect" as any, { x: contentX, y: contentY, w: spotTabW + 0.1, h: heroH, fill: { color: accentColor }, rectRadius: 0.12 });
      slide.addShape("rect" as any, { x: contentX + spotTabW, y: contentY, w: 0.1, h: heroH, fill: { color: accentColor } });
      // "01" in accent panel
      slide.addText("01", {
        x: contentX, y: contentY, w: spotTabW, h: heroH,
        fontSize: Math.min(38, heroH * 70), fontFace: design.fonts.title, bold: true,
        color: "FFFFFF", align: "center", valign: "middle", transparency: 12,
      });
      // First item text (right side)
      addBulletText(rawItems[0] || items[0], contentX + spotTabW + 0.2, contentY + 0.1, contentW - spotTabW - 0.32, heroH - 0.2, accentColor, "FFFFFF");

      if (items.length > 1) {
        const restGap = 0.08;
        const restY = contentY + heroH + 0.16;
        const restH = CONTENT_BOTTOM - restY;
        const restCount = items.length - 1;
        const restItemH = Math.max(0.44, Math.min(0.72, (restH - restGap * (restCount - 1)) / restCount));
        const miniTabW = Math.min(0.62, restItemH * 0.64);
        for (let i = 1; i < items.length; i++) {
          const yPos = restY + (i - 1) * (restItemH + restGap);
          const pal = design.palette[i % design.palette.length];
          const cardH2 = restItemH - 0.02;
          // Shadow
          addCardShadow(slide, contentX, yPos, contentW, cardH2, colors.shadowColor, design.theme === "light");
          // Card bg
          slide.addShape("roundRect" as any, { x: contentX, y: yPos, w: contentW, h: cardH2, fill: { color: colors.cardBg }, rectRadius: 0.1, line: { color: colors.borders, width: 0.5 } });
          // Mini colored tab
          slide.addShape("roundRect" as any, { x: contentX, y: yPos, w: miniTabW + 0.1, h: cardH2, fill: { color: pal }, rectRadius: 0.1 });
          slide.addShape("rect" as any, { x: contentX + miniTabW, y: yPos, w: 0.1, h: cardH2, fill: { color: pal } });
          // Number in tab
          const numStr = String((plan.itemStartIndex ?? 0) + i + 1).padStart(2, "0");
          slide.addText(numStr, {
            x: contentX, y: yPos, w: miniTabW, h: cardH2,
            fontSize: Math.min(22, Math.max(13, cardH2 * 50)), fontFace: design.fonts.title, bold: true,
            color: "FFFFFF", align: "center", valign: "middle",
          });
          // Text
          addBulletText(rawItems[i] || items[i], contentX + miniTabW + 0.2, yPos + 0.02, contentW - miniTabW - 0.3, cardH2 - 0.04, pal);
        }
      }
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ── TWO-COLUMN BULLETS ──
function renderTwoColumnBullets(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  _logSlide("twoColumn", { items: (plan.items || []).length, title: plan.title?.slice(0, 40), theme: design.theme });
  addSlideBackground(slide, colors.bg);
  addLightBgDecoration(slide, design, colors);
  const pal = design.palette[_globalSlideIdx % design.palette.length];
  if (design.visualStyle !== "minimal") addLeftEdge(slide, pal);
  renderSlideHeader(slide, plan.title, plan.sectionLabel || "", design, colors, pal);

  const rawItems = plan.items || [];
  const items = rawItems.map((item) => normalizeRenderableBulletText(item)).filter(Boolean);
  const contentX = SAFE_ZONE.X;
  const totalW = SAFE_ZONE.W;
  const colGap = 0.4;
  const colW = (totalW - colGap) / 2;
  const contentY = SAFE_ZONE.Y + 0.08;
  const mid = Math.ceil(items.length / 2);
  const leftItems = items.slice(0, mid);
  const rightItems = items.slice(mid);
  const divX = contentX + colW + colGap / 2;
  const colHEnd = CONTENT_BOTTOM - contentY;

  slide.addShape("rect" as any, { x: divX - 0.01, y: contentY, w: 0.02, h: colHEnd, fill: { color: pal }, transparency: 50 });

  for (let col = 0; col < 2; col++) {
    const colItems = col === 0 ? leftItems : rightItems;
    const colX = contentX + col * (colW + colGap);
    const colBulletGap = colItems.length >= 3 ? 0.05 : 0.08;
    const usableHeight = colHEnd - colBulletGap * Math.max(colItems.length - 1, 0);
    // No upper cap — cards expand to fill column height; text auto-shrinks
    const itemH = Math.max(0.74, usableHeight / Math.max(colItems.length, 1));

    for (let i = 0; i < colItems.length; i++) {
      const palColor = design.palette[(col * mid + i) % design.palette.length];
      const yPos = contentY + i * (itemH + colBulletGap);

      addCardShadow(slide, colX, yPos, colW, itemH - 0.03, colors.shadowColor, design.theme === "light");
      slide.addShape("roundRect" as any, { x: colX, y: yPos, w: colW, h: itemH - 0.03, fill: { color: colors.cardBg }, rectRadius: 0.06 });
      slide.addShape("rect" as any, { x: colX, y: yPos, w: 0.05, h: itemH - 0.03, fill: { color: palColor }, rectRadius: 0.06 });

      const badgeW = 0.3;
      slide.addShape("roundRect" as any, { x: colX + 0.14, y: yPos + (itemH - 0.03)/2 - badgeW/2, w: badgeW, h: badgeW, fill: { color: palColor }, rectRadius: 0.06 });
      slide.addText(String((plan.itemStartIndex ?? 0) + col * mid + i + 1), {
        x: colX + 0.14, y: yPos + (itemH - 0.03)/2 - badgeW/2, w: badgeW, h: badgeW,
        fontSize: 11, fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle"
      });

      slide.addText(normalizeRenderableBulletText(rawItems[col * mid + i] || colItems[i]), {
        x: colX + 0.62,
        y: yPos + 0.12,
        w: colW - 0.86,
        h: itemH - 0.3,
        fontSize: 15,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "top",
        wrap: true,
        fit: "shrink",
        lineSpacingMultiple: 1.16,
        shrinkText: true,
        maxFontSize: 18,
        minFontSize: 12,
        margin: 0.06,
      } as any);
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ── GRID CARDS ──
function renderGridCards(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  _logSlide("gridCards", { items: (plan.items || []).length, title: plan.title?.slice(0, 40), theme: design.theme });
  addSlideBackground(slide, colors.bg);
  addLightBgDecoration(slide, design, colors);
  if (design.visualStyle !== "minimal") addLeftEdge(slide, colors.p3);
  renderSlideHeader(slide, plan.title, plan.sectionLabel || "", design, colors, colors.p3);
  const items = (plan.items || []).slice(0, GRID_MAX_ITEMS);
  const parsed = items.map(parseDeterministicCardItem);
  const geometry = getDeterministicGridLayout(parsed.length);
  const unifiedFontSize = computeDeterministicGridFontSize(items);

  for (let i = 0; i < parsed.length; i++) {
    const col = i % geometry.cols;
    const row = Math.floor(i / geometry.cols);
    const x = geometry.contentX + col * (geometry.cardW + geometry.gapX);
    const y = geometry.contentY + row * (geometry.cardH + geometry.gapY);
    const pal = design.palette[i % design.palette.length];
    const item = parsed[i];

    addCardShadow(slide, x, y, geometry.cardW, geometry.cardH, colors.shadowColor, design.theme === "light");
    // Card background
    slide.addShape("roundRect" as any, {
      x, y, w: geometry.cardW, h: geometry.cardH,
      fill: { color: colors.cardBg },
      rectRadius: 0.12,
      line: { color: colors.borders, width: 0.5 },
    });

    // Large circle badge centered at top of card
    const circleSz = Math.min(0.58, geometry.cardW * 0.28, geometry.cardH * 0.38);
    const circleX = x + geometry.cardW / 2 - circleSz / 2;
    const circleY = y + 0.14;
    slide.addShape("ellipse" as any, {
      x: circleX, y: circleY, w: circleSz, h: circleSz,
      fill: { color: pal },
    });
    // Inner highlight ring
    slide.addShape("ellipse" as any, {
      x: circleX + 0.03, y: circleY + 0.02, w: circleSz - 0.06, h: circleSz - 0.06,
      fill: { color: "FFFFFF", transparency: 88 },
    });
    // Number in circle
    slide.addText(String((plan.itemStartIndex ?? 0) + i + 1), {
      x: circleX, y: circleY, w: circleSz, h: circleSz,
      fontSize: Math.max(12, Math.min(20, circleSz * 34)),
      fontFace: design.fonts.title, bold: true,
      color: "FFFFFF", align: "center", valign: "middle",
    });

    // Semantic icon (emoji) below circle if available
    const iconY = circleY + circleSz + 0.06;
    if (item.icon) {
      slide.addText(item.icon, {
        x: x + 0.1, y: iconY, w: geometry.cardW - 0.2, h: 0.26,
        fontSize: 14, fontFace: design.fonts.body,
        color: pal, align: "center", valign: "middle",
      });
    }

    // Text block below circle
    const textTopY = item.icon ? iconY + 0.28 : circleY + circleSz + 0.12;
    const textRuns = item.hasColon
      ? [
          { text: `${item.label}: `, options: { bold: true, color: ensureContrastOnLight(pal, colors.cardBg) } },
          { text: item.desc, options: { color: colors.text } },
        ]
      : [{ text: item.desc, options: { color: colors.text } }];

    const textW = geometry.cardW - 0.28;
    const textH = y + geometry.cardH - 0.14 - textTopY;
    slide.addText(
      textRuns as any,
      {
        x: x + 0.14, y: textTopY, w: textW, h: Math.max(0.3, textH),
        fontSize: unifiedFontSize,
        fontFace: design.fonts.body,
        align: "center", valign: "top",
        lineSpacingMultiple: 1.22,
        fit: "shrink", shrinkText: true,
        minFontSize: 11, margin: 0,
      } as any,
    );
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ── PROCESS TIMELINE ──
function renderProcessTimeline(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  const items = plan.items || [];
  const contentX = 0.55;
  const contentW = SLIDE_W - contentX - 0.4;

  if (true) {
    // GEMMA v3.9.5 — sempre horizontal (timeline vertical removida)
    addSlideBackground(slide, colors.coverDark);
    if (plan.sectionLabel) {
      slide.addText(plan.sectionLabel.toUpperCase(), {
        x: 0.55,
        y: 0.3,
        w: 6.0,
        h: 0.24,
        fontSize: 10,
        fontFace: design.fonts.body,
        bold: true,
        color: colors.p2,
        charSpacing: 5,
      });
      addHR(slide, 0.55, 0.57, 1.0, colors.p2, 0.02);
    }
    slide.addText(plan.title, {
      x: 0.55,
      y: 0.68,
      w: SLIDE_W - 1.1,
      h: 0.7,
      fontSize: 26,
      fontFace: design.fonts.title,
      bold: true,
      color: "FFFFFF",
      valign: "middle",
    });
    const flowY = 1.68;
    const cardY = flowY + 0.2;
    const cardH = CONTENT_BOTTOM - cardY;
    const gap = 0.06;
    const arrowW = 0.4;
    const totalArrowW = arrowW * Math.max(items.length - 1, 0);
    const cardW = (contentW - totalArrowW - gap * Math.max(items.length - 1, 0)) / items.length;
    slide.addShape("rect" as any, {
      x: contentX,
      y: cardY + cardH * 0.35,
      w: contentW,
      h: 0.04,
      fill: { color: colors.p2 },
      transparency: 60,
    });
    for (let i = 0; i < items.length; i++) {
      const x = contentX + i * (cardW + arrowW + gap);
      const pal = design.palette[i % design.palette.length];
      slide.addShape("roundRect" as any, {
        x: x + 0.02,
        y: cardY + 0.03,
        w: cardW,
        h: cardH,
        fill: { color: "000000" },
        transparency: 70,
        rectRadius: 0.12,
      });
      slide.addShape("roundRect" as any, {
        x,
        y: cardY,
        w: cardW,
        h: cardH,
        fill: { color: colors.panelMid },
        rectRadius: 0.12,
      });
      slide.addShape("rect" as any, { x, y: cardY, w: cardW, h: 0.05, fill: { color: pal }, rectRadius: 0.12 });
      const badgeSz = 0.4;
      slide.addShape("roundRect" as any, {
        x: x + cardW / 2 - badgeSz / 2,
        y: cardY + 0.14,
        w: badgeSz,
        h: badgeSz,
        fill: { color: pal },
        rectRadius: 0.08,
      });
      slide.addText(String(i + 1), {
        x: x + cardW / 2 - badgeSz / 2,
        y: cardY + 0.14,
        w: badgeSz,
        h: badgeSz,
        fontSize: 16,
        fontFace: design.fonts.title,
        bold: true,
        color: "FFFFFF",
        align: "center",
        valign: "middle",
      });
      if (i < items.length - 1) {
        const arrowX = x + cardW + gap / 2;
        const arrowMidY = cardY + cardH * 0.35;
        slide.addShape("rect" as any, {
          x: arrowX,
          y: arrowMidY - 0.02,
          w: arrowW - 0.06,
          h: 0.04,
          fill: { color: pal },
          transparency: 25,
        });
        slide.addShape("rect" as any, {
          x: arrowX + arrowW - 0.18,
          y: arrowMidY - 0.06,
          w: 0.12,
          h: 0.12,
          fill: { color: pal },
          transparency: 25,
          rotate: 45,
        });
      }
      // Normalize item: if no colon separator, try to infer "Title: description" split
      // Pattern: short phrase (1-4 words, title-case) followed by longer description
      let normalizedItem = items[i];
      if (normalizedItem.indexOf(":") < 0 || normalizedItem.indexOf(":") > 40) {
        const inferMatch = normalizedItem.match(
          /^([A-ZÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÇ][\w\sàáéíóúàèìòùâêîôûãõçÀÁÉÍÓÚÂÊÎÔÛÃÕÇ]{0,35}?)\s+([A-ZÁÉÍÓÚO][a-záéíóúàèìòùâêîôûãõç].{10,})/u,
        );
        if (inferMatch && inferMatch[1].split(" ").length <= 4) {
          normalizedItem = inferMatch[1].trim() + ": " + inferMatch[2].trim();
        }
      }
      const colonIdx = normalizedItem.indexOf(":");
      let label: string, desc: string;
      if (colonIdx > 0 && colonIdx < 70) {
        label = items[i].substring(0, colonIdx).trim();
        desc = items[i].substring(colonIdx + 1).trim();
      } else if (items[i].length <= 50) {
        label = items[i];
        desc = "";
      } else {
        const words = items[i].split(/\s+/);
        label = words.slice(0, 6).join(" ");
        desc = words.slice(6).join(" ");
      }
      if (desc && desc.length > 0) {
        // Dynamic label height based on estimated line wrapping
        const ptCharsPerLine = Math.max(8, Math.floor((cardW - 0.3) / 0.09));
        const ptLabelCapped = label.length > 38 ? label.split(/\s+/).slice(0, 6).join(" ") : label;
        const ptLabelLines = Math.ceil(ptLabelCapped.length / ptCharsPerLine);
        const ptLabelH = Math.min(0.8, Math.max(0.28, ptLabelLines * 0.28 + 0.06));
        const ptDescY = cardY + 0.68 + ptLabelH + 0.08;
        slide.addText(ptLabelCapped, {
          x: x + 0.15,
          y: cardY + 0.68,
          w: cardW - 0.3,
          h: ptLabelH,
          fontSize: TYPO.BODY - 1,
          fontFace: design.fonts.title,
          bold: true,
          color: pal,
          align: "center",
          valign: "middle",
          lineSpacingMultiple: 1.08,
          autoFit: true,
        } as any);
        slide.addText(desc, {
          x: x + 0.15,
          y: ptDescY,
          w: cardW - 0.3,
          h: cardH - (ptDescY - cardY) - 0.18,
          fontSize: TYPO.BODY - 1,
          fontFace: design.fonts.body,
          color: colors.coverSubtext,
          valign: "middle",
          align: "center",
          lineSpacingMultiple: 1.18,
          autoFit: true,
        } as any);
      } else {
        slide.addText(label, {
          x: x + 0.15,
          y: cardY + 0.68,
          w: cardW - 0.3,
          h: cardH - 0.83,
          fontSize: TYPO.BODY,
          fontFace: design.fonts.body,
          color: colors.coverSubtext,
          valign: "middle",
          align: "center",
          lineSpacingMultiple: 1.25,
          autoFit: true,
        } as any);
      }
    }
  } else {
    addSlideBackground(slide, colors.bg);
    addLightBgDecoration(slide, design, colors);
    if (design.visualStyle !== "minimal") addLeftEdge(slide, colors.p2);
    renderSlideHeader(slide, plan.title, plan.sectionLabel || "", design, colors, colors.p2);
    const phaseColors = [colors.p1, colors.p3, colors.p0, colors.p2, colors.p4, colors.p1, colors.p3];
    const vContentY = 1.55;
    const vContentH = CONTENT_BOTTOM - vContentY;
    const stepGap = items.length <= 5 ? 0.06 : 0.03;
    const stepH = (vContentH - stepGap * (items.length - 1)) / items.length;
    const nodeSize = items.length <= 5 ? 0.28 : 0.22;
    const nodeX = contentX + 0.1;
    const lineX = nodeX + nodeSize / 2 - 0.012;
    slide.addShape("rect" as any, {
      x: lineX,
      y: vContentY + nodeSize / 2,
      w: 0.024,
      h: vContentH - nodeSize,
      fill: { color: colors.divider },
    });
    for (let i = 0; i < items.length; i++) {
      const y = vContentY + i * (stepH + stepGap);
      const pal = design.palette[i % design.palette.length];
      slide.addShape("roundRect" as any, {
        x: nodeX,
        y: y + stepH / 2 - nodeSize / 2,
        w: nodeSize,
        h: nodeSize,
        fill: { color: pal },
        rectRadius: 0.05,
      });
      slide.addText(String(i + 1), {
        x: nodeX,
        y: y + stepH / 2 - nodeSize / 2,
        w: nodeSize,
        h: nodeSize,
        fontSize: items.length <= 5 ? 12 : 10,
        fontFace: design.fonts.title,
        bold: true,
        color: "FFFFFF",
        align: "center",
        valign: "middle",
      });
      const cardX2 = nodeX + nodeSize + 0.16;
      const cardW2 = contentW - (cardX2 - contentX);
      addCardShadow(slide, cardX2, y, cardW2, stepH - 0.02, colors.shadowColor, design.theme === "light");
      slide.addShape("roundRect" as any, {
        x: cardX2,
        y,
        w: cardW2,
        h: stepH - 0.02,
        fill: { color: colors.cardBg },
        rectRadius: 0.06,
      });
      slide.addShape("rect" as any, { x: cardX2, y, w: 0.05, h: stepH - 0.02, fill: { color: pal }, rectRadius: 0.06 });
      // Normalize item: if no colon separator, try to infer "Title: description" split
      // Pattern: short phrase (1-4 words, title-case) followed by longer description
      let normalizedItem = items[i];
      if (normalizedItem.indexOf(":") < 0 || normalizedItem.indexOf(":") > 40) {
        const inferMatch = normalizedItem.match(
          /^([A-ZÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÇ][\w\sàáéíóúàèìòùâêîôûãõçÀÁÉÍÓÚÂÊÎÔÛÃÕÇ]{0,35}?)\s+([A-ZÁÉÍÓÚO][a-záéíóúàèìòùâêîôûãõç].{10,})/u,
        );
        if (inferMatch && inferMatch[1].split(" ").length <= 4) {
          normalizedItem = inferMatch[1].trim() + ": " + inferMatch[2].trim();
        }
      }
      const colonIdx = normalizedItem.indexOf(":");
      let label = "",
        desc = items[i];
      if (colonIdx > 0 && colonIdx < 70) {
        label = items[i].substring(0, colonIdx).trim();
        desc = items[i].substring(colonIdx + 1).trim();
      }
      const textX = cardX2 + 0.05 + 0.12;
      const textW = cardW2 - 0.05 - 0.22;
      const fontSize = items.length <= 5 ? TYPO.BULLET_TEXT : TYPO.BULLET_TEXT - 1;
      if (label) {
        slide.addText(label, {
          x: textX,
          y: y + 0.02,
          w: textW,
          h: stepH * 0.38,
          fontSize,
          fontFace: design.fonts.title,
          bold: true,
          color: pal,
          valign: "bottom",
        });
        slide.addText(desc, {
          x: textX,
          y: y + stepH * 0.38,
          w: textW,
          h: stepH * 0.58,
          fontSize: fontSize - 1,
          fontFace: design.fonts.body,
          color: colors.text,
          valign: "top",
          lineSpacingMultiple: 1.1,
        });
      } else {
        slide.addText(desc, {
          x: textX,
          y,
          w: textW,
          h: stepH - 0.02,
          fontSize,
          fontFace: design.fonts.body,
          color: colors.text,
          valign: "middle",
          lineSpacingMultiple: 1.12,
        });
      }
      if (i < items.length - 1) {
        const arrowY = y + stepH + stepGap / 2;
        slide.addText("▼", {
          x: contentX + 0.23,
          y: arrowY - 0.08,
          w: 0.2,
          h: 0.16,
          fontSize: 7,
          color: phaseColors[i + 1] || pal,
          align: "center",
          valign: "middle",
          transparency: 40,
        });
      }
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ── COMPARISON TABLE ──
function renderComparisonTable(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);
  addLightBgDecoration(slide, design, colors);
  if (design.visualStyle !== "minimal") addLeftEdge(slide, colors.p0);
  renderSlideHeader(slide, plan.title, plan.sectionLabel || "", design, colors, colors.p0);
  const headers = plan.tableHeaders || [];
  const rows = plan.tableRows || [];
  if (headers.length === 0) {
    renderBullets(pptx, plan, design);
    return;
  }
  const contentX = 0.65;
  const contentW2_tbl = SLIDE_W - contentX - 0.5;
  const tableY = 1.68;
  const tableAvailH = CONTENT_BOTTOM - tableY;
  const totalRows = rows.length + 1;
  const dynRowH = Math.min(0.8, Math.max(0.4, tableAvailH / totalRows));

  const tableData: any[][] = [];
  tableData.push(
    headers.map((h) => ({
      text: h,
      options: {
        fontSize: TYPO.TABLE_HEADER,
        fontFace: design.fonts.title,
        bold: true,
        color: "FFFFFF",
        fill: { color: colors.p0 },
        align: "center",
        valign: "middle",
      },
    })),
  );
  for (let r = 0; r < rows.length; r++) {
    tableData.push(
      rows[r].map((cell) => ({
        text: cell,
        options: {
          fontSize: TYPO.TABLE_CELL,
          fontFace: design.fonts.body,
          color: colors.text,
          fill: { color: r % 2 === 0 ? colors.tableRowOdd : colors.tableRowEven },
          valign: "middle",
        },
      })),
    );
  }
  slide.addTable(tableData, {
    x: contentX,
    y: tableY,
    w: contentW2_tbl,
    colW: new Array(headers.length).fill(contentW2_tbl / headers.length),
    rowH: dynRowH,
    border: { type: "solid", pt: 0.3, color: colors.borders },
    autoPage: false,
  });
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ── EXAMPLE HIGHLIGHT ──
// GEMMA v3.9.5 — 4 raias horizontais SIMÉTRICAS para
// "Contexto · Desafio · Solução · Resultado", cada raia com fundo
// na cor accent da fase com 20% de transparência (80% transparency em pptxgenjs).
function renderExampleHighlight(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  const items = (plan.items || []).filter(Boolean).map((item) => ensureSentenceEnd(sanitizeText(item)));
  // Sempre 4 raias fixas — Contexto, Desafio, Solução, Resultado
  const cappedItems = items.slice(0, 4);
  const defaultLabels = ["Contexto", "Desafio", "Solução", "Resultado"];
  const phaseColors = [colors.p1, colors.p3, colors.p0, colors.p4];

  addSlideBackground(slide, colors.bg);
  addLightBgDecoration(slide, design, colors);
  if (design.visualStyle !== "minimal") addLeftEdge(slide, colors.p3);

  // Header
  renderSlideHeader(slide, plan.title, plan.sectionLabel || "", design, colors, colors.p3);

  // Geometria — 4 raias horizontais SIMÉTRICAS (mesma altura)
  const contentX2 = SAFE_ZONE.X;
  const contentW2 = SAFE_ZONE.W;
  const gridStartY = SAFE_ZONE.Y + 0.05;
  const gridH = SAFE_ZONE.H - 0.05;
  const slotCount = 4; // raias fixas — garantia de simetria
  const bandGap = 0.12;
  const bandH = (gridH - bandGap * (slotCount - 1)) / slotCount;
  const descFontSize = MIN_FONT.BODY; // 18pt — piso rígido

  for (let i = 0; i < slotCount; i++) {
    const y = gridStartY + i * (bandH + bandGap);
    const pal = phaseColors[i];
    const item = cappedItems[i] || "";
    const colonIdx = item.indexOf(":");
    const label = (colonIdx > 0 && colonIdx < 70 ? item.substring(0, colonIdx) : defaultLabels[i]).trim();
    const desc = colonIdx > 0 ? item.substring(colonIdx + 1).trim() : item;

    // Sombra suave
    addCardShadow(slide, contentX2, y, contentW2, bandH, colors.shadowColor, design.theme === "light");

    // Fundo da raia: cor accent com 80% de transparência (20% opacidade)
    slide.addShape("roundRect" as any, {
      x: contentX2,
      y,
      w: contentW2,
      h: bandH,
      fill: { color: pal, transparency: 80 },
      line: { color: pal, width: 0.5, transparency: 50 },
      rectRadius: 0.1,
    });
    // Borda lateral accent reforçada (0.08)
    slide.addShape("rect" as any, { x: contentX2, y, w: 0.08, h: bandH, fill: { color: pal }, rectRadius: 0.06 });

    // Badge numérico circular
    const numBadgeSize = Math.min(0.5, bandH * 0.55);
    slide.addShape("ellipse" as any, {
      x: contentX2 + 0.22,
      y: y + (bandH - numBadgeSize) / 2,
      w: numBadgeSize,
      h: numBadgeSize,
      fill: { color: pal },
    });
    slide.addText(`${i + 1}`, {
      x: contentX2 + 0.22,
      y: y + (bandH - numBadgeSize) / 2,
      w: numBadgeSize,
      h: numBadgeSize,
      fontSize: 18,
      fontFace: design.fonts.title,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    });

    // Label (Contexto/Desafio/Solução/Resultado) — coluna fixa para alinhamento
    const labelX = contentX2 + 0.22 + numBadgeSize + 0.2;
    slide.addText(label.toUpperCase(), {
      x: labelX,
      y: y + 0.1,
      w: 1.8,
      h: 0.3,
      fontSize: 11,
      fontFace: design.fonts.title,
      bold: true,
      color: pal,
      charSpacing: 4,
      valign: "top",
    });

    // Descrição — coluna fixa após label, ocupa o restante da raia
    const descX = labelX + 1.9;
    const descW = contentX2 + contentW2 - descX - 0.2;
    if (desc) {
      slide.addText(desc, {
        x: descX,
        y: y + 0.1,
        w: descW,
        h: bandH - 0.2,
        fontSize: descFontSize,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "middle",
        lineSpacingMultiple: 1.2,
        autoFit: true,
      } as any);
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ── WARNING CALLOUT ──
function renderWarningCallout(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);
  addLightBgDecoration(slide, design, colors);
  if (design.visualStyle !== "minimal") addLeftEdge(slide, "C0392B");
  renderSlideHeader(slide, plan.title, plan.sectionLabel || "", design, colors, "C0392B");
  slide.addShape("roundRect" as any, {
    x: SLIDE_W - 1.5,
    y: 0.35,
    w: 0.8,
    h: 0.8,
    fill: { color: "FEF2F2" },
    rectRadius: 0.12,
  });
  slide.addText("⚠", { x: SLIDE_W - 1.5, y: 0.35, w: 0.8, h: 0.8, fontSize: 28, align: "center", valign: "middle" });
  const items = (plan.items || []).slice(0, 5);
  const contentX = 0.65,
    contentW = SLIDE_W - contentX - 0.5,
    contentY = 1.58;
  const bulletGap = 0.1,
    contentH = CONTENT_BOTTOM - contentY;
  const rawItemH = (contentH - bulletGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1);
  const itemH = Math.max(0.55, Math.min(1.1, rawItemH));
  const bodyFontSize = items.length >= 4 ? 12 : 14;
  for (let i = 0; i < items.length; i++) {
    const y = contentY + i * (itemH + bulletGap);
    const cardH = itemH - 0.04;
    const isLightCard = i % 2 === 0;
    const cardBgColor = isLightCard ? (design.theme === "dark" ? colors.cardBgAlt : "FFF5F5") : colors.cardBg;
    const cardTextColor = isLightCard && design.theme === "light" ? "1E293B" : colors.text;
    addCardShadow(slide, contentX, y, contentW, cardH, colors.shadowColor, design.theme === "light");
    slide.addShape("roundRect" as any, {
      x: contentX,
      y,
      w: contentW,
      h: cardH,
      fill: { color: cardBgColor },
      rectRadius: 0.08,
    });
    slide.addShape("rect" as any, { x: contentX, y, w: 0.06, h: cardH, fill: { color: "E74C3C" }, rectRadius: 0.08 });
    // Normalize item: if no colon separator, try to infer "Title: description" split
    // Pattern: short phrase (1-4 words, title-case) followed by longer description
    let normalizedItem = items[i];
    if (normalizedItem.indexOf(":") < 0 || normalizedItem.indexOf(":") > 40) {
      const inferMatch = normalizedItem.match(
        /^([A-ZÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÇ][\w\sàáéíóúàèìòùâêîôûãõçÀÁÉÍÓÚÂÊÎÔÛÃÕÇ]{0,35}?)\s+([A-ZÁÉÍÓÚO][a-záéíóúàèìòùâêîôûãõç].{10,})/u,
      );
      if (inferMatch && inferMatch[1].split(" ").length <= 4) {
        normalizedItem = inferMatch[1].trim() + ": " + inferMatch[2].trim();
      }
    }
    const colonIdx = normalizedItem.indexOf(":");
    const hasLabel = colonIdx > 0 && colonIdx < 70;
    const itemLabel = hasLabel ? items[i].substring(0, colonIdx).trim() : "";
    const itemDesc = hasLabel ? items[i].substring(colonIdx + 1).trim() : items[i];
    if (hasLabel) {
      slide.addText(itemLabel.toUpperCase(), {
        x: contentX + 0.18,
        y: y + 0.04,
        w: contentW - 0.26,
        h: 0.18,
        fontSize: 7,
        fontFace: design.fonts.title,
        bold: true,
        color: "C0392B",
        charSpacing: 2,
        valign: "middle",
      });
      slide.addText(itemDesc, {
        x: contentX + 0.18,
        y: y + 0.22,
        w: contentW - 0.3,
        h: cardH - 0.26,
        fontSize: bodyFontSize,
        fontFace: design.fonts.body,
        color: cardTextColor,
        valign: "top",
        lineSpacingMultiple: 1.12,
      });
    } else {
      slide.addText(items[i], {
        x: contentX + 0.18,
        y: y + 0.04,
        w: contentW - 0.3,
        h: cardH - 0.08,
        fontSize: bodyFontSize,
        fontFace: design.fonts.body,
        color: cardTextColor,
        valign: "middle",
        lineSpacingMultiple: 1.12,
      });
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ── REFLECTION CALLOUT ──
function renderReflectionCallout(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.coverDark);
  slide.addText("\u201C", {
    x: 0.3,
    y: 0.04,
    w: 2.0,
    h: 2.0,
    fontSize: 180,
    fontFace: design.fonts.title,
    color: colors.p1,
    transparency: 88,
    bold: true,
  });
  addHR(slide, 0.65, 0.55, SLIDE_W - 1.3, colors.p1, 0.018);
  slide.addText("REFLEXÃO", {
    x: 0.65,
    y: 0.8,
    w: 4.0,
    h: 0.24,
    fontSize: 10,
    fontFace: design.fonts.body,
    bold: true,
    color: colors.p1,
    charSpacing: 6,
  });
  slide.addText(plan.title, {
    x: 0.65,
    y: 1.12,
    w: SLIDE_W - 1.3,
    h: 0.55,
    fontSize: MIN_FONT.TITLE,
    fontFace: design.fonts.title,
    bold: true,
    color: "FFFFFF",
  });
  const items = plan.items || [];
  const contentY = 1.9,
    contentH = CONTENT_BOTTOM - contentY;
  const itemGap = 0.16;
  const rawItemH = (contentH - itemGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1);
  const itemH = Math.max(0.65, Math.min(1.3, rawItemH));
  for (let i = 0; i < items.length; i++) {
    const y = contentY + i * (itemH + itemGap);
    slide.addShape("roundRect" as any, {
      x: 0.65,
      y,
      w: SLIDE_W - 1.3,
      h: itemH,
      fill: { color: colors.panelMid },
      rectRadius: 0.08,
      transparency: 30,
    });
    slide.addText(items[i], {
      x: 1.0,
      y,
      w: SLIDE_W - 2.0,
      h: itemH,
      fontSize: TYPO.BODY_LARGE,
      fontFace: design.fonts.body,
      italic: true,
      color: colors.coverSubtext,
      valign: "middle",
      lineSpacingMultiple: 1.42,
    });
  }
  addGradientBar(slide, 0.65, SLIDE_H - 0.5, SLIDE_W - 1.3, 0.012, colors.p1, "right");
  slide.addShape("ellipse" as any, {
    x: SLIDE_W - 1.8,
    y: SLIDE_H - 0.18,
    w: 0.08,
    h: 0.08,
    fill: { color: colors.p1 },
  });
  slide.addText("EduGenAI", {
    x: SLIDE_W - 1.7,
    y: SLIDE_H - 0.24,
    w: 1.4,
    h: 0.2,
    fontSize: 8,
    fontFace: design.fonts.body,
    bold: true,
    color: colors.coverSubtext,
    align: "right",
    valign: "middle",
    charSpacing: 3,
  });
}

// ── SUMMARY SLIDE ──
function renderSummarySlide(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);
  addLightBgDecoration(slide, design, colors);
  const sidebarW = 0.45;
  slide.addShape("rect" as any, { x: 0, y: 0, w: sidebarW, h: SLIDE_H, fill: { color: colors.p0 } });
  if (plan.sectionLabel) {
    slide.addText(plan.sectionLabel.toUpperCase(), {
      x: sidebarW + 0.3,
      y: 0.3,
      w: 6.0,
      h: 0.24,
      fontSize: 10,
      fontFace: design.fonts.body,
      bold: true,
      color: colors.p0,
      charSpacing: 5,
    });
    addHR(slide, sidebarW + 0.3, 0.57, 0.9, colors.p0, 0.02);
  }
  slide.addText(plan.title, {
    x: sidebarW + 0.3,
    y: 0.68,
    w: SLIDE_W - sidebarW - 0.8,
    h: 0.75,
    fontSize: TYPO.SECTION_TITLE,
    fontFace: design.fonts.title,
    bold: true,
    color: colors.text,
    valign: "middle",
  });
  const items = (plan.items || []).filter((item) => item.replace(/[.\s]+$/, "").trim().length >= 10);
  const contentX = sidebarW + 0.3,
    contentW = SLIDE_W - contentX - 0.5,
    contentY = 1.6;
  const contentHAvail = CONTENT_BOTTOM - contentY;
  const cols = items.length >= 4 ? 2 : 1;
  const rows = Math.ceil(items.length / cols);
  const gap = 0.12;
  const cardW = (contentW - gap * (cols - 1)) / cols;
  const cardH = Math.max(1.35, (contentHAvail - gap * (rows - 1)) / rows - 0.08);
  for (let i = 0; i < items.length; i++) {
    const col = i % cols,
      row = Math.floor(i / cols);
    const x = contentX + col * (cardW + gap),
      y = contentY + row * (cardH + gap);
    const pal = design.palette[i % design.palette.length];
    addCardShadow(slide, x, y, cardW, cardH, colors.shadowColor, design.theme === "light");
    slide.addShape("roundRect" as any, { x, y, w: cardW, h: cardH, fill: { color: colors.cardBg }, rectRadius: 0.1 });
    slide.addShape("rect" as any, { x, y, w: 0.05, h: cardH, fill: { color: pal }, rectRadius: 0.1 });
    const numSize = 0.32;
    slide.addShape("roundRect" as any, {
      x: x + 0.14,
      y: y + 0.1,
      w: numSize,
      h: numSize,
      fill: { color: pal },
      rectRadius: 0.08,
    });
    slide.addText(String((plan.itemStartIndex ?? 0) + i + 1), {
      x: x + 0.14,
      y: y + 0.1,
      w: numSize,
      h: numSize,
      fontSize: 16,
      fontFace: design.fonts.title,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    });
    slide.addText(items[i], {
      x: x + 0.18,
      y: y + numSize + 0.14,
      w: cardW - 0.36,
      h: cardH - numSize - 0.28,
      fontSize: TYPO.BODY,
      fontFace: design.fonts.body,
      color: colors.text,
      valign: "middle",
      lineSpacingMultiple: 1.25,
      fit: "shrink",
      shrinkText: true,
      minFontSize: 12,
      margin: 0.02,
    } as any);
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ── NUMBERED TAKEAWAYS ──
function renderNumberedTakeaways(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.coverDark);
  addHR(slide, 0, 0.04, SLIDE_W, colors.p4, 0.045);
  if (plan.sectionLabel) {
    slide.addText(plan.sectionLabel.toUpperCase(), {
      x: 0.65,
      y: 0.28,
      w: 6.0,
      h: 0.24,
      fontSize: 10,
      fontFace: design.fonts.body,
      bold: true,
      color: colors.p4,
      charSpacing: 6,
    });
  }
  slide.addText(plan.title, {
    x: 0.65,
    y: 0.58,
    w: SLIDE_W - 1.3,
    h: 0.7,
    fontSize: 28,
    fontFace: design.fonts.title,
    bold: true,
    color: "FFFFFF",
    valign: "middle",
  });
  const items = plan.items || [];
  const contentX = 0.65,
    contentW = SLIDE_W - contentX - 0.5;
  const cols = items.length <= 3 ? items.length : items.length <= 4 ? 2 : 3;
  const gridRows = Math.ceil(items.length / cols);
  const gap = 0.14;
  const cardW = (contentW - gap * (cols - 1)) / cols;
  const contentY = 1.65,
    contentH = CONTENT_BOTTOM - contentY;
  const rawCardH = (contentH - gap * (gridRows - 1)) / gridRows;
  const cardH = Math.min(1.85, Math.max(1.35, rawCardH - 0.08));
  for (let i = 0; i < items.length; i++) {
    const col = i % cols,
      row = Math.floor(i / cols);
    const x = contentX + col * (cardW + gap),
      y = contentY + row * (cardH + gap);
    const pal = design.palette[i % design.palette.length];
    slide.addShape("roundRect" as any, {
      x: x + 0.02,
      y: y + 0.03,
      w: cardW,
      h: cardH,
      fill: { color: "000000" },
      transparency: 75,
      rectRadius: 0.12,
    });
    slide.addShape("roundRect" as any, {
      x,
      y,
      w: cardW,
      h: cardH,
      fill: { color: colors.panelMid },
      rectRadius: 0.12,
    });
    slide.addShape("rect" as any, { x, y, w: 0.05, h: cardH, fill: { color: pal }, rectRadius: 0.12 });
    const tkBadge = Math.min(0.38, cardH * 0.28, cardW * 0.22);
    slide.addShape("roundRect" as any, {
      x: x + 0.14,
      y: y + 0.14,
      w: tkBadge,
      h: tkBadge,
      fill: { color: pal },
      rectRadius: 0.08,
    });
    slide.addText(String((plan.itemStartIndex ?? 0) + i + 1), {
      x: x + 0.14,
      y: y + 0.14,
      w: tkBadge,
      h: tkBadge,
      fontSize: Math.min(16, tkBadge * 40),
      fontFace: design.fonts.title,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    });
    const tkTextY = y + 0.14 + tkBadge + 0.1;
    const tkRuns = colorizeIconRuns(items[i], pal, colors.coverSubtext) || [
      { text: items[i], options: { color: colors.coverSubtext } },
    ];
    slide.addText(
      tkRuns as any,
      {
        x: x + 0.18,
        y: tkTextY,
        w: cardW - 0.36,
        h: cardH - (tkTextY - y) - 0.26,
        fontSize: TYPO.TAKEAWAY_BODY,
        fontFace: design.fonts.body,
        valign: "middle",
        lineSpacingMultiple: 1.25,
        fit: "shrink",
        shrinkText: true,
        minFontSize: 12,
        margin: 0.02,
      } as any,
    );
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ── CLOSING ──
function renderClosingSlide(pptx: PptxGenJS, courseTitle: string, design: DesignConfig, image?: SlideImage | null) {
  const colors = getColors(design);
  const slide = pptx.addSlide();

  if (image) {
    try {
      console.log(
        `[V3-RENDER] Closing image: photoId=${image.photoId ?? "n/a"}, base64 length=${image.base64Data.length}, starts=${image.base64Data.substring(0, 30)}`,
      );
      slide.addImage({ data: image.base64Data, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
    } catch (e) {
      console.error(`[V3-RENDER] Closing background FAILED:`, e);
      addSlideBackground(slide, colors.coverDark);
    }
    addHeroTextReadabilityOverlay(slide);
  } else {
    console.log("[V3-RENDER] Closing: no image provided");
    addSlideBackground(slide, colors.coverDark);
  }
  if (!image) {
    addGradientBar(slide, SLIDE_W * 0.45, 0, SLIDE_W * 0.55, SLIDE_H, colors.p0, "down");
    slide.addShape("ellipse" as any, {
      x: SLIDE_W - 4.0,
      y: -1.2,
      w: 5.0,
      h: 5.0,
      fill: { color: colors.p1 },
      transparency: 92,
    });
  }
  slide.addShape("rect" as any, { x: 0.8, y: 0.9, w: 0.05, h: 3.8, fill: { color: colors.p0 } });
  slide.addShape("rect" as any, { x: 0.88, y: 0.9, w: 0.015, h: 3.8, fill: { color: colors.p0 }, transparency: 50 });
  addHR(slide, 1.2, 1.3, 3.0, colors.p0, 0.015);
  if (!image) {
    for (let b = 0; b < 5; b++) {
      slide.addShape("roundRect" as any, {
        x: 0.28,
        y: 1.1 + b * 0.28,
        w: 0.3,
        h: 0.16,
        fill: { color: design.palette[b % design.palette.length] },
        transparency: 20,
        rectRadius: 0.04,
      });
    }
  }
  slide.addText("Parabéns!", {
    x: 1.2,
    y: 1.5,
    w: SLIDE_W * 0.62,
    h: 1.6,
    fontSize: 76,
    fontFace: design.fonts.title,
    bold: true,
    color: "FFFFFF",
    valign: "middle",
  });
  addGradientBar(slide, 1.2, 3.3, 4.0, 0.07, colors.p0, "right");
  slide.addText("Você concluiu o curso", {
    x: 1.2,
    y: 3.55,
    w: SLIDE_W * 0.55,
    h: 0.45,
    fontSize: 18,
    fontFace: design.fonts.body,
    color: colors.coverSubtext,
    valign: "top",
    lineSpacingMultiple: 1.2,
  });
  slide.addText(courseTitle, {
    x: 1.2,
    y: 4.1,
    w: SLIDE_W * 0.58,
    h: 0.7,
    fontSize: 22,
    fontFace: design.fonts.title,
    bold: true,
    color: "FFFFFF",
    valign: "top",
    lineSpacingMultiple: 1.1,
  });
  slide.addText("CERTIFICADO DE CONCLUSÃO", {
    x: 1.2,
    y: 5.05,
    w: 5.0,
    h: 0.28,
    fontSize: 9,
    fontFace: design.fonts.body,
    bold: true,
    color: colors.p0,
    charSpacing: 7,
    transparency: 10,
  });
  if (!image) {
    for (let i = 0; i < 3; i++) {
      const sz = 0.5 + i * 0.25;
      slide.addShape("rect" as any, {
        x: SLIDE_W - 2.2 + i * 0.45,
        y: SLIDE_H - 2.0 + i * 0.4,
        w: sz,
        h: sz,
        fill: { color: design.palette[i % design.palette.length] },
        transparency: 85,
        rectRadius: 0.04,
      });
    }
  }
  const dateStr = new Intl.DateTimeFormat("pt-BR", { year: "numeric", month: "long" }).format(new Date());
  slide.addText(dateStr, {
    x: SLIDE_W - 2.8,
    y: SLIDE_H - 0.55,
    w: 2.4,
    h: 0.28,
    fontSize: 11,
    fontFace: design.fonts.body,
    color: colors.coverSubtext,
    align: "right",
    charSpacing: 2,
    transparency: 30,
  });
  if (image) addImageCredit(slide, image.credit, design);
}

// ── CODE BLOCK ──
function renderCodeBlock(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.bg);
  addLightBgDecoration(slide, design, colors);
  renderSlideHeader(slide, plan.title, plan.sectionLabel || "CÓDIGO", design, colors, design.palette[0]);

  const lines: string[] = (plan as any).codeLines || plan.items || [];
  const language: string = ((plan as any).codeLanguage || "CODE").toUpperCase();
  const caption: string[] = plan.items && (plan as any).codeLines ? plan.items : [];

  const panelX = 0.55;
  const captionH = caption.length > 0 ? 0.62 : 0;
  const panelY = 1.62;
  const maxPanelH = SLIDE_H - panelY - captionH - 0.55;
  const panelH = Math.min(maxPanelH, 0.38 + Math.min(lines.length, 14) * 0.30 + 0.18);
  const panelW = SLIDE_W - 1.1;

  // Panel background (VS Code dark)
  const panelBg = "0D1117";
  const headerBg = "161B22";

  slide.addShape("rect" as any, {
    x: panelX, y: panelY, w: panelW, h: panelH,
    fill: { color: panelBg },
    line: { color: "30363D", width: 0.6 },
    rectRadius: 0.07,
  });

  // Top header bar
  slide.addShape("rect" as any, {
    x: panelX, y: panelY, w: panelW, h: 0.30,
    fill: { color: headerBg },
    line: { color: "30363D", width: 0 },
    rectRadius: 0.07,
  });
  // Cover the bottom corners of header (make only top corners rounded)
  slide.addShape("rect" as any, {
    x: panelX, y: panelY + 0.14, w: panelW, h: 0.16,
    fill: { color: headerBg },
    line: { color: "30363D", width: 0 },
  });

  // Traffic-light dots
  const dotColors = ["FF5F57", "FFBD2E", "28CA41"];
  for (let i = 0; i < 3; i++) {
    slide.addShape("ellipse" as any, {
      x: panelX + 0.18 + i * 0.21,
      y: panelY + 0.10,
      w: 0.09, h: 0.09,
      fill: { color: dotColors[i] },
    });
  }

  // Language badge
  slide.addText(language, {
    x: panelX + panelW - 1.3,
    y: panelY + 0.04,
    w: 1.1, h: 0.22,
    fontSize: 8, fontFace: design.fonts.body, bold: true,
    color: "8B949E", charSpacing: 3, align: "right",
  });

  // Left accent bar
  slide.addShape("rect" as any, {
    x: panelX, y: panelY + 0.30, w: 0.022, h: panelH - 0.30,
    fill: { color: design.palette[0] },
  });

  // Gutter separator line
  const gutterW = 0.35;
  slide.addShape("rect" as any, {
    x: panelX + 0.022 + gutterW,
    y: panelY + 0.30,
    w: 0.012,
    h: panelH - 0.30,
    fill: { color: "21262D" },
  });

  // Code lines
  const codeStartY = panelY + 0.36;
  const lineH = 0.28;
  const maxLines = Math.min(lines.length, 14);
  for (let i = 0; i < maxLines; i++) {
    const y = codeStartY + i * lineH;
    // Line number
    slide.addText(String(i + 1), {
      x: panelX + 0.04, y, w: gutterW - 0.04, h: lineH,
      fontSize: 9, fontFace: "Courier New",
      color: "484F58", align: "right", valign: "middle",
    });
    // Code content — syntax-colorize first token (keyword detection)
    const lineText = lines[i];
    slide.addText(lineText, {
      x: panelX + 0.022 + gutterW + 0.04,
      y, w: panelW - gutterW - 0.12, h: lineH,
      fontSize: 11, fontFace: "Courier New",
      color: "E6EDF3", valign: "middle", wrap: true,
    });
  }

  // Caption (explanation)
  if (caption.length > 0) {
    const captionY = panelY + panelH + 0.18;
    const captionText = caption.join(" • ");
    slide.addShape("rect" as any, {
      x: panelX, y: captionY - 0.05, w: panelW, h: captionH,
      fill: { color: design.theme === "light" ? "F1F5F9" : colors.surface },
      line: { color: design.theme === "light" ? "E2E8F0" : colors.border, width: 0.4 },
      rectRadius: 0.04,
    });
    slide.addText(captionText, {
      x: panelX + 0.2, y: captionY, w: panelW - 0.4, h: captionH - 0.1,
      fontSize: 12, fontFace: design.fonts.body,
      color: colors.subtext, valign: "middle",
      lineSpacingMultiple: 1.15,
    });
  }

  addFooter(slide, design, colors);
}

// ── SLIDE DISPATCHER ──
function renderSlide(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig, image?: SlideImage | null) {
  // GEMMA v3.9 — Garante sectionLabel em CAIXA ALTA em todo slide.
  // Não muta o plan original.
  const planWithLabel: SlidePlan = {
    ...plan,
    sectionLabel: deriveSectionLabel(plan),
  };
  switch (planWithLabel.layout) {
    case "module_cover":
      renderModuleCover(pptx, planWithLabel, design, image);
      break;
    case "two_column_bullets":
      renderTwoColumnBullets(pptx, planWithLabel, design);
      break;
    case "grid_cards":
      renderGridCards(pptx, planWithLabel, design);
      break;
    case "process_timeline":
      renderProcessTimeline(pptx, planWithLabel, design);
      break;
    case "comparison_table":
      renderComparisonTable(pptx, planWithLabel, design);
      break;
    case "example_highlight":
      renderExampleHighlight(pptx, planWithLabel, design);
      break;
    case "warning_callout":
      renderWarningCallout(pptx, planWithLabel, design);
      break;
    case "reflection_callout":
      renderReflectionCallout(pptx, planWithLabel, design);
      break;
    case "summary_slide":
      renderSummarySlide(pptx, planWithLabel, design);
      break;
    case "numbered_takeaways":
      renderNumberedTakeaways(pptx, planWithLabel, design);
      break;
    case "code_block":
      renderCodeBlock(pptx, planWithLabel, design);
      break;
    case "bullets":
    default:
      renderBullets(pptx, planWithLabel, design);
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 8: PIPELINE ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════

async function runPipeline(
  courseTitle: string,
  modules: { title: string; content: string }[],
  design: DesignConfig,
  language: string,
): Promise<{ pptx: PptxGenJS; report: PipelineReport }> {
  const report: PipelineReport = {
    totalModules: modules.length,
    totalSlides: 0,
    aiCallsTotal: 0,
    aiCallsFailed: 0,
    fallbacksUsed: 0,
    warnings: [],
  };

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "EduGenAI v3";
  pptx.title = courseTitle;

  _globalSlideIdx = 0;
  _globalSlideNumber = 0;
  _globalFooterBrand = design.footerBrand;
  _slideLog = [];

  // Build image plan in parallel with AI generation
  const imagePlanPromise = buildImagePlan(courseTitle, modules, design.includeImages);

  // Generate slides for all modules (sequential to respect API rate limits)
  const allModuleSlidePlans: SlidePlan[][] = [];
  for (let mi = 0; mi < modules.length; mi++) {
    const mod = modules[mi];
    const rawTitle = sanitizeText(mod.title || `Módulo ${mi + 1}`);
    const cleanTitle = rawTitle.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;

    console.log(`[V3-STAGE-1] Generating slides for module ${mi + 1}/${modules.length}: "${cleanTitle}"`);
    const moduleSlides = await generateSlidesForModule(cleanTitle, mod.content || "", mi, design, language, report);
    allModuleSlidePlans.push(moduleSlides);
  }

  // Wait for image plan
  const imagePlan = await imagePlanPromise;

  const pexelsKey = Deno.env.get("PEXELS_API_KEY") || "";
  report.imageDiagnostics = {
    unsplashKeyPresent: pexelsKey.length > 0,
    unsplashKeyLength: pexelsKey.length,
    includeImages: design.includeImages,
    coverImageFetched: !!imagePlan.cover,
    closingImageFetched: !!imagePlan.closing,
    moduleImagesFetched: imagePlan.modules.size,
    moduleImagesTotal: modules.length,
    errors: [],
  };
  if (!pexelsKey) report.imageDiagnostics.errors.push("PEXELS_API_KEY not set");
  if (!design.includeImages) report.imageDiagnostics.errors.push("includeImages is false");

  // Build TOC descriptions (first sentence of each module content)
  const tocModules = modules.map((m) => {
    const rawTitle = sanitizeText(m.title || "");
    const cleanTitle = rawTitle.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;
    const stripped = (m.content || "")
      .replace(/#{1,6}\s*/g, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/[*_`]/g, "")
      .replace(/^[-*]\s+/gm, "")
      .replace(/^\d+[.)]\s+/gm, "")
      .replace(/\n{2,}/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    // Passa o conteúdo completo — cleanTOCDescription() em renderTOC extrai o
    // 🎯 Objetivo do Módulo e remove redundância. Sem truncagem aqui.
    const tocDescription = stripped.length > 20 ? stripped : undefined;
    return {
      title: cleanTitle,
      description: tocDescription,
    };
  });

  console.log(`[V3-STAGE-2] Rendering slides...`);

  // Render cover
  renderCoverSlide(pptx, courseTitle, design, imagePlan.cover);

  // Render TOC
  renderTOC(pptx, tocModules, design);

  // ── GEMMA v3.9: Smart Content Splitter ──
  // Aplica normalizeAndSplitSlide em todo plano antes da contagem,
  // para que o footer (n/total) já reflita os slides duplicados.
  const splitModulePlans: SlidePlan[][] = allModuleSlidePlans.map((plans) => {
    const out: SlidePlan[] = [];
    for (const p of plans) {
      const split = normalizeAndSplitSlide(p, design);
      out.push(...split);
    }
    return out;
  });

  // Count total content slides for footer.
  // +1 accounts for the closing slide which also calls addFooter and increments _globalSlideNumber.
  _globalTotalSlides = splitModulePlans.reduce((sum, plans) => sum + plans.length, 0) + 1;

  // Render all module slides
  for (let mi = 0; mi < splitModulePlans.length; mi++) {
    const modulePlans = splitModulePlans[mi];
    const moduleImage = imagePlan.modules.get(mi) || null;
    for (const plan of modulePlans) {
      const img = plan.layout === "module_cover" ? moduleImage : null;
      renderSlide(pptx, plan, design, img);
      report.totalSlides++;
    }
  }

  // Render closing
  renderClosingSlide(pptx, courseTitle, design, imagePlan.closing);
  report.totalSlides += 3; // cover + TOC + closing

  console.log(
    `[V3-PIPELINE] Complete: ${report.totalModules} modules, ${report.totalSlides} slides, ${report.aiCallsTotal} AI calls (${report.aiCallsFailed} failed, ${report.fallbacksUsed} fallbacks)`,
  );

  return { pptx, report };
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 8.5: AUTO-FIX PIPELINE (v3.12.1)
// ═══════════════════════════════════════════════════════════════════

/**
 * AutoFixPipeline v2 — Camada robusta de pós-processamento de PPTX.
 *
 * Inspirado em likaku/Mck-ppt-design-skill. Executa, em ordem:
 *   1. Detecção de overflow real (estimateTextHeightInches)
 *   2. Compressão inteligente de texto (remove redundâncias, encurta frases, limpa emojis órfãos)
 *   3. ShrinkText gradual (1pt por vez, mínimo 12pt)
 *   4. Harmonização peer-level de fontes (títulos iguais, bullets iguais)
 *   5. Correção de colisões verticais
 *
 * O motor original NÃO é alterado; esta é uma camada aditiva sobre o objeto pres.
 */

// --- Helpers de extração/escrita de texto em elementos do PptxGenJS ---
function _afpReadText(el: any): string {
  if (!el || el.text == null) return "";
  if (typeof el.text === "string") return el.text;
  if (Array.isArray(el.text)) {
    return el.text.map((t: any) => (t && typeof t === "object" ? (t.text ?? "") : String(t ?? ""))).join("");
  }
  return String(el.text);
}

function _afpWriteText(el: any, newText: string): void {
  if (typeof el.text === "string") {
    el.text = newText;
    return;
  }
  if (Array.isArray(el.text)) {
    // Concentra todo o texto comprimido no primeiro run, zera os demais para preservar formatação base
    let written = false;
    for (let i = 0; i < el.text.length; i++) {
      const run = el.text[i];
      if (run && typeof run === "object") {
        if (!written) {
          run.text = newText;
          written = true;
        } else {
          run.text = "";
        }
      }
    }
    if (!written) el.text = newText;
    return;
  }
  el.text = newText;
}

// --- Compressão semântica leve (preserva sentido, reduz comprimento) ---
const _AFP_REDUNDANCY_PATTERNS: Array<[RegExp, string]> = [
  [/\bagora você (já )?(sabe|entende|aprendeu|viu) que\b/gi, "você sabe que"],
  [/\bé importante (notar|destacar|ressaltar|lembrar|frisar) que\b/gi, "note que"],
  [/\bvale (a pena )?(notar|destacar|ressaltar|lembrar|mencionar) que\b/gi, "note que"],
  [/\bcomo (você )?pode (ver|perceber|notar|observar)\b/gi, "veja que"],
  [/\bem outras palavras,?\s*/gi, ""],
  [/\bbasicamente,?\s*/gi, ""],
  [/\bessencialmente,?\s*/gi, ""],
  [/\bna verdade,?\s*/gi, ""],
  [/\bde (uma )?(forma|maneira) (geral|simples|simplificada|resumida)\b,?/gi, "em resumo"],
  [/\bde (uma )?(forma|maneira) (mais )?(prática|objetiva|direta)\b,?/gi, ""],
  [/\bao (longo do|decorrer do) (tempo|processo)\b/gi, "com o tempo"],
  [/\bcom (o )?(intuito|objetivo|propósito) de\b/gi, "para"],
  [/\bcom (a )?finalidade de\b/gi, "para"],
  [/\bno (sentido|contexto) de\b/gi, "para"],
  [/\bdevido ao (fato de )?que\b/gi, "porque"],
  [/\bem (função|virtude|razão) (de|do|da)\b/gi, "por"],
  [/\bpor (intermédio|meio) (de|do|da)\b/gi, "via"],
  [/\bcada (um|uma) (de|do|da|dos|das)\b/gi, "cada"],
  [/\b(uma )?(grande )?quantidade de\b/gi, "vários"],
  [/\bnão é nada (mais )?do que\b/gi, "é"],
  [/\b(é|são) (capaz|capazes) de\b/gi, "pode"],
  [/\btem a (capacidade|possibilidade) de\b/gi, "pode"],
  [/\bfaz com que\b/gi, "faz"],
  [/\bcom (relação|respeito) (a|ao|à)\b/gi, "sobre"],
  [/\bno que (diz respeito|se refere) (a|ao|à)\b/gi, "sobre"],
  [/\s{2,}/g, " "],
  [/\s+([,.;:!?])/g, "$1"],
];

function _afpCompressText(text: string): { out: string; changed: boolean } {
  if (!text) return { out: text, changed: false };
  const original = text;
  let out = text;

  // 1) Padrões de redundância
  for (const [re, sub] of _AFP_REDUNDANCY_PATTERNS) {
    out = out.replace(re, sub);
  }

  // 2) Remove emojis isolados (espaço-emoji-espaço/borda) e marcadores órfãos
  // Emojis: ranges pictográficos comuns
  out = out.replace(
    /(^|\s)([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}])(\s|$)/gu,
    (_m, p1, _e, p3) => (p1 === "" ? "" : " ") + (p3 === "" ? "" : ""),
  );
  // Marcadores órfãos no início ("•", "- ", "* ", "→ ") quando duplicados
  out = out.replace(/^[\s]*[•·▪▫◦‣⁃►▶→]+\s*/g, "");
  out = out.replace(/\s[•·▪▫◦‣⁃]\s(?=[•·▪▫◦‣⁃])/g, " ");

  // 3) Encurta frases longas: se uma frase passa de 180 chars, tenta cortar na última vírgula antes de 160
  out = out
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => {
      const s = sentence.trim();
      if (s.length <= 180) return s;
      const cut = s.lastIndexOf(",", 160);
      if (cut > 80) return s.slice(0, cut).trim() + ".";
      // fallback: corta na última palavra antes de 160 chars
      const hardCut = s.lastIndexOf(" ", 160);
      return (hardCut > 60 ? s.slice(0, hardCut).trim() : s.slice(0, 160).trim()) + ".";
    })
    .join(" ");

  out = out.replace(/\s{2,}/g, " ").trim();

  // Capitaliza início se virou minúsculo após remoções
  if (out.length > 0 && /[a-záéíóúâêôãõç]/.test(out[0])) {
    out = out[0].toUpperCase() + out.slice(1);
  }

  return { out, changed: out !== original && out.length < original.length };
}

// --- Classificação peer-level (título vs bullet) por slide ---
function _afpClassifyRole(el: any, slideMaxY: number): "title" | "subtitle" | "body" | "caption" | "other" {
  const opts = el.options || {};
  const fs = opts.fontSize || 0;
  const y = opts.y || 0;
  const isBold = !!opts.bold;
  const text = _afpReadText(el);
  if (!text.trim()) return "other";

  if (y < 1.0 && fs >= 28) return "title";
  if (y < 1.6 && fs >= 20 && fs < 28) return "subtitle";
  if (fs <= 12 && y > slideMaxY - 1.0) return "caption";
  if (fs >= 13 && fs <= 22) return "body";
  if (isBold && fs >= 24) return "title";
  return "other";
}

function applyAutoFixPipeline(pres: any) {
  console.error(`[V3-FIX] === applyAutoFixPipeline STARTING ===`);
  const slides = (pres && (pres._slides || pres.slides)) || [];
  console.info(`[V3-FIX] Target: ${slides.length} slides found in PptxGenJS object.`);

  let overflowCount = 0;
  let compressedCount = 0;
  let shrinkCount = 0;
  let harmonizedCount = 0;
  let collisionCount = 0;

  const SLIDE_HEIGHT_IN = 7.5; 
  const MIN_BODY = 12;
  const MIN_TITLE = 18;

  slides.forEach((slide: any, slideIdx: number) => {
    // PptxGenJS v3 uses _slideObjects
    const elements = slide._slideObjects || slide.elements || [];
    if (!elements || elements.length === 0) {
      console.info(`[V3-FIX] Slide ${slideIdx + 1} has no objects to fix.`);
      return;
    }

    // === PASSO 1+2+3: Overflow → Compressão → Shrink gradual ===
    elements.forEach((el: any) => {
      if (!el || el.text == null) return;
      const text = _afpReadText(el);
      if (!text.trim()) return;

      const opts = el.options || el; // Tenta acessar options ou o próprio elemento (fallback v3)
      const w = opts.w || SAFE_ZONE.W;
      const h = opts.h || 0;
      
      // Ignora se não tiver altura definida ou se for muito pequena (provavelmente decoração)
      if (h <= 0.1) return; 

      let fontSize = opts.fontSize || 18;
      const role = _afpClassifyRole(el, SLIDE_HEIGHT_IN);
      const minFs = role === "title" || role === "subtitle" ? MIN_TITLE : MIN_BODY;

      // Estimativa mais rigorosa para detectar transbordos
      let estH = estimateTextHeightInches(text, fontSize, w);
      if (estH <= h + 0.05) return; // Cabe perfeitamente

      overflowCount++;

      // 2) Compressão inteligente (remove redundâncias)
      const { out: compressed, changed } = _afpCompressText(text);
      if (changed && compressed.length > 0) {
        _afpWriteText(el, compressed);
        compressedCount++;
        estH = estimateTextHeightInches(compressed, fontSize, w);
        if (estH <= h + 0.05) {
          console.info(`[V3-FIX][slide ${slideIdx + 1}] Fix via compression: ${text.length} -> ${compressed.length} chars`);
          return;
        }
      }

      // 3) Shrink gradual de 1pt por vez
      const startFs = fontSize;
      const currentText = _afpReadText(el);
      while (fontSize > minFs) {
        fontSize -= 1;
        estH = estimateTextHeightInches(currentText, fontSize, w);
        if (estH <= h + 0.05) break;
      }
      
      if (fontSize < startFs) {
        opts.fontSize = fontSize;
        shrinkCount++;
        console.info(`[V3-FIX][slide ${slideIdx + 1}] Fix via shrink (${role}): ${startFs}pt -> ${fontSize}pt`);
      }
    });

    // === PASSO 4: Harmonização peer-level (mesma fonte para elementos iguais) ===
    const roleBuckets: Record<string, any[]> = { title: [], subtitle: [], body: [], caption: [] };
    elements.forEach((el: any) => {
      if (!el || el.text == null) return;
      const role = _afpClassifyRole(el, SLIDE_HEIGHT_IN);
      if (roleBuckets[role]) roleBuckets[role].push(el);
    });

    for (const role of Object.keys(roleBuckets)) {
      const bucket = roleBuckets[role];
      if (bucket.length < 2) continue;
      
      const sizes = bucket.map((e) => (e.options?.fontSize || e.fontSize || 0)).filter((s) => s > 0);
      if (!sizes.length) continue;
      
      const target = Math.min(...sizes);
      bucket.forEach((el: any) => {
        const currentFs = el.options?.fontSize || el.fontSize || 0;
        if (currentFs !== target && currentFs > 0) {
          if (el.options) el.options.fontSize = target;
          else el.fontSize = target;
          harmonizedCount++;
        }
      });
    }

    // === PASSO 5: Colisões verticais ===
    for (let i = 0; i < elements.length; i++) {
      for (let j = i + 1; j < elements.length; j++) {
        const a = elements[i];
        const b = elements[j];
        if (!a?.options || !b?.options) continue;
        const r1 = { x: a.options.x || 0, y: a.options.y || 0, w: a.options.w || 0, h: a.options.h || 0 };
        const r2 = { x: b.options.x || 0, y: b.options.y || 0, w: b.options.w || 0, h: b.options.h || 0 };
        const intersects =
          r1.x < r2.x + r2.w && r1.x + r1.w > r2.x && r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;
        if (!intersects) continue;
        if (r2.y >= r1.y && r2.y < r1.y + r1.h) {
          const overlapY = r1.y + r1.h - r2.y;
          if (overlapY > 0 && overlapY < 0.6) {
            b.options.y = +(r2.y + overlapY + 0.05).toFixed(3);
            collisionCount++;
            console.log(
              `[V3-FIX][slide ${slideIdx + 1}] colisão resolvida: y ${r2.y.toFixed(2)} → ${b.options.y}`,
            );
          }
        }
      }
    }
  });

  const logSummary = `[V3-FIX] AutoFixPipeline SUCCESS: ${overflowCount} overflows detected | ${compressedCount} compressed | ${shrinkCount} fonts shrunk | ${harmonizedCount} harmonized | ${collisionCount} collisions resolved`;
  console.log("********************************************************************************");
  console.log(logSummary);
  console.log("********************************************************************************");

  return { overflowCount, compressedCount, shrinkCount, harmonizedCount, collisionCount, logSummary };
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 9: HTTP HANDLER
// ═══════════════════════════════════════════════════════════════════

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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.user.id;

    const body = await req.json();
    const { course_id, palette, density, theme, includeImages, template, courseType, footerBrand, language } = body;
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Fetch course
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
      return new Response(JSON.stringify({ error: "Course must be published to export." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch modules
    const { data: modules = [] } = await serviceClient
      .from("course_modules")
      .select("*")
      .eq("course_id", course_id)
      .order("order_index");

    const design = buildDesignConfig(
      theme || "light",
      palette || "default",
      !!includeImages,
      template || "default",
      density || "standard",
      courseType || "CURSO COMPLETO",
      footerBrand !== undefined ? footerBrand : "EduGenAI",
    );

    const courseTitle = sanitizeText(course.title || "Curso EduGenAI");
    const moduleData = modules.map((m: any) => ({ title: m.title || "", content: m.content || "" }));
    const exportLanguage = language || "Português (Brasil)";

    console.log(
      `[V3] ENGINE_VERSION=${ENGINE_VERSION} | Starting: "${courseTitle}", ${moduleData.length} modules, theme=${design.theme}, density=${density}, language=${exportLanguage}`,
    );

    let { pptx, report } = await runPipeline(courseTitle, moduleData, design, exportLanguage);

    // AutoFixPipeline Applied after render
    console.info(`[V3-FIX] >>> Starting AutoFixPipeline on ${courseTitle}...`);
    try {
      const fixResult = applyAutoFixPipeline(pptx);
      console.info(`[V3-FIX] <<< Finished AutoFixPipeline: ${JSON.stringify(fixResult)}`);
    } catch (fixErr: any) {
      console.error("[V3-FIX] CRITICAL ERROR in AutoFixPipeline:", fixErr?.message || String(fixErr));
      console.error(fixErr?.stack);
    }

    const rawPptxData = await pptx.write({ outputType: "uint8array" });
    const pptxData = await repairPptxPackage(rawPptxData);

    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s\-]/g, "")
      .replace(/\s+/g, "-")
      .trim()
      .substring(0, 80);
    const fileName = `${userId}/${safeName}-PPTX-v3-${dateStr}.pptx`;

    // Upload with retry + exponential backoff (storage 504 Gateway Timeout protection)
    const fileSizeMB = (pptxData.byteLength / 1024 / 1024).toFixed(2);
    console.log(`[V3-UPLOAD] File size: ${fileSizeMB}MB, starting upload with retry...`);
    let uploadErr: any = null;
    const MAX_UPLOAD_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
      const t0 = Date.now();
      const { error } = await serviceClient.storage.from("course-exports").upload(fileName, pptxData, {
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: true,
      });
      const dt = Date.now() - t0;
      if (!error) {
        console.log(`[V3-UPLOAD] Success on attempt ${attempt}/${MAX_UPLOAD_ATTEMPTS} in ${dt}ms`);
        uploadErr = null;
        break;
      }
      uploadErr = error;
      const status = (error as any)?.status || (error as any)?.statusCode;
      const isRetryable = !status || status === 504 || status === 503 || status === 502 || status === 408 || status >= 500;
      console.warn(`[V3-UPLOAD] Attempt ${attempt}/${MAX_UPLOAD_ATTEMPTS} failed in ${dt}ms (status=${status}, retryable=${isRetryable}): ${error.message}`);
      if (!isRetryable || attempt === MAX_UPLOAD_ATTEMPTS) break;
      const backoff = Math.min(2000 * Math.pow(2, attempt - 1), 15000);
      await new Promise((r) => setTimeout(r, backoff));
    }
    if (uploadErr) {
      console.error(`[V3-UPLOAD] All ${MAX_UPLOAD_ATTEMPTS} attempts failed. Final error:`, uploadErr);
      throw uploadErr;
    }

    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_EXPORTED_PPTX_V3",
      metadata: {
        course_id,
        slide_count: report.totalSlides,
        ai_calls: report.aiCallsTotal,
        fallbacks: report.fallbacksUsed,
      },
    });

    return new Response(
      JSON.stringify({
        url: signedUrl.signedUrl,
        version: "v3",
        engine_version: ENGINE_VERSION,
        slide_log: _slideLog,
        quality_report: {
          engine_version: ENGINE_VERSION,
          total_modules: report.totalModules,
          total_slides: report.totalSlides,
          ai_calls_total: report.aiCallsTotal,
          ai_calls_failed: report.aiCallsFailed,
          fallbacks_used: report.fallbacksUsed,
          warnings: report.warnings,
          image_diagnostics: report.imageDiagnostics || null,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[V3] Export error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
