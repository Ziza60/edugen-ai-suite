import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "npm:pptxgenjs@3.12.0";

const ENGINE_VERSION = "2.8.0-2026-03-09";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ╔══════════════════════════════════════════════════════════════════╗
// ║  PPTX EXPORTER v2 — EduGenAI                                   ║
// ║                                                                  ║
// ║  Pipeline architecture:                                          ║
// ║    Stage 1: PARSE       — markdown → structured blocks           ║
// ║    Stage 2: SEGMENT     — blocks → semantic sections             ║
// ║    Stage 3: DISTRIBUTE  — sections → slide plans (no truncation) ║
// ║    Stage 4: RENDER      — slide plans → PptxGenJS slides         ║
// ║    Stage 5: EXPORT      — write PPTX binary + upload             ║
// ║                                                                  ║
// ║  Core principles:                                                ║
// ║    - Complete sentences always (never cut mid-thought)            ║
// ║    - Structural redistribution before compression                 ║
// ║    - Zero intentional semantic fragmentation                      ║
// ║    - Each stage is a pure function with typed I/O                 ║
// ╚══════════════════════════════════════════════════════════════════╝

// ═══════════════════════════════════════════════════════════════════
// SECTION 1: TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

interface ParsedBlock {
  type: "heading" | "paragraph" | "bullets" | "table" | "label_value";
  heading?: string;
  headingLevel?: number;
  content: string;
  items?: string[];
  tableHeaders?: string[];
  tableRows?: string[][];
  sectionHint?: string;
}

interface SemanticSection {
  id: string;
  title: string;
  sectionLabel: string;
  pedagogicalType:
    | "objectives"
    | "fundamentals"
    | "process"
    | "models"
    | "applications"
    | "example"
    | "challenges"
    | "reflection"
    | "summary"
    | "takeaways"
    | "generic";
  blocks: ParsedBlock[];
}

type SlideLayoutV2 =
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
  layout: SlideLayoutV2;
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
}

interface PipelineReport {
  totalModules: number;
  totalBlocks: number;
  totalSections: number;
  totalSlides: number;
  sentenceIntegrityChecks: number;
  redistributions: number;
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
  template: "default" | "academic" | "corporate" | "creative";
  courseType: string;
  footerBrand: string | null;
}

interface SlideImage {
  base64Data: string;
  credit: string;
  creditUrl: string;
}

interface ImagePlan {
  cover: SlideImage | null;
  modules: Map<number, SlideImage>;
  closing: SlideImage | null;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 2: DESIGN SYSTEM
// ═══════════════════════════════════════════════════════════════════

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN = 0.667;
const SAFE_W = SLIDE_W - MARGIN * 2;
const SAFE_H = SLIDE_H - 1.0;

const THEMES = {
  light: {
    bg: "F7F8FC",
    bgAlt: "EDEEF5",
    bgAccent: "E2E5F0",
    text: "0F172A",
    textSecondary: "5A6578",
    accent: "6C63FF",
    accentMuted: "EEEDFF",
    borders: "CDD2DE",
    cardBg: "FFFFFF",
    cardBgAlt: "F1F3FA",
    tableHeaderBg: "0F172A",
    tableRowOdd: "FFFFFF",
    tableRowEven: "F1F3FA",
    insightBg: "FFF8ED",
    reflectionBg: "EDF0FA",
    coverBg: "050A18",
    coverText: "FFFFFF",
    coverSubtext: "94A3C0",
    divider: "D0D5E0",
    coverDark: "050A18",
    panelDark: "0A1228",
    panelMid: "111D38",
    shadowColor: "0F172A",
  },
  dark: {
    bg: "0C1322",
    bgAlt: "141E34",
    bgAccent: "1A2848",
    text: "E8EDF5",
    textSecondary: "94A3C0",
    accent: "6C63FF",
    accentMuted: "1C1A3A",
    borders: "222E48",
    cardBg: "141E34",
    cardBgAlt: "1A2848",
    tableHeaderBg: "080D1A",
    tableRowOdd: "141E34",
    tableRowEven: "1A2848",
    insightBg: "2A1F0F",
    reflectionBg: "0D1830",
    coverBg: "050A18",
    coverText: "FFFFFF",
    coverSubtext: "94A3C0",
    divider: "222E48",
    coverDark: "050A18",
    panelDark: "0A1228",
    panelMid: "111D38",
    shadowColor: "000000",
  },
};

const PALETTES: Record<string, string[]> = {
  default: ["6C63FF", "3B82F6", "10B981", "F59E0B", "06B6D4"],
  ocean: ["0369A1", "0284C7", "0891B2", "0D9488", "1D4ED8"],
  forest: ["15803D", "16A34A", "0D9488", "047857", "166534"],
  sunset: ["DC2626", "EA580C", "D97706", "B91C1C", "C2410C"],
  monochrome: ["1E293B", "334155", "475569", "64748B", "94A3B8"],
};

const TYPO = {
  COVER_TITLE: 48,
  MODULE_NUMBER: 120,
  MODULE_TITLE: 34,
  SECTION_TITLE: 28,
  SUBTITLE: 20,
  BODY: 17,
  BODY_LARGE: 19,
  SUPPORT: 13,
  LABEL: 11,
  TABLE_HEADER: 13,
  TABLE_CELL: 12,
  CARD_TITLE: 15,
  CARD_BODY: 13,
  BULLET_TEXT: 16,
  TAKEAWAY_NUM: 52,
  TAKEAWAY_BODY: 14,
  FOOTER: 11,
  TOC_NUMBER: 42,
  TOC_TITLE: 17,
  TOC_DESC: 12,
};

// ── Font map by template ──
const TEMPLATE_FONTS: Record<string, { title: string; body: string }> = {
  default:   { title: "Montserrat",        body: "Open Sans" },
  academic:  { title: "Times New Roman",   body: "Arial" },
  corporate: { title: "Montserrat",        body: "Open Sans" },
  creative:  { title: "Playfair Display",  body: "Lato" },
};

// ── Default palette per template (used when palette = "default") ──
const TEMPLATE_DEFAULT_PALETTES: Record<string, string[]> = {
  default:   PALETTES.default,
  academic:  ["003366", "336699", "FF6600", "006633", "660033"],
  corporate: ["1A1A2E", "16213E", "0F3460", "533483", "E94560"],
  creative:  ["2C3E50", "E74C3C", "F39C12", "8E44AD", "16A085"],
};

// ── Content density config ──
const DENSITY_CONFIG: Record<string, { maxItemsPerSlide: number; maxCharsPerItem: number }> = {
  compact:  { maxItemsPerSlide: 5, maxCharsPerItem: 130 },
  standard: { maxItemsPerSlide: 6, maxCharsPerItem: 160 },
  detailed: { maxItemsPerSlide: 8, maxCharsPerItem: 200 },
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
  const theme = (themeKey === "dark" ? "dark" : "light") as "light" | "dark";
  // If palette is "default", use template-specific default palette
  const palette = paletteKey === "default"
    ? (TEMPLATE_DEFAULT_PALETTES[templateKey] || PALETTES.default)
    : (PALETTES[paletteKey] || PALETTES.default);
  return {
    theme,
    palette,
    fonts: TEMPLATE_FONTS[templateKey] || TEMPLATE_FONTS.default,
    density: DENSITY_CONFIG[densityKey] || DENSITY_CONFIG.standard,
    includeImages,
    template: (templateKey as DesignConfig["template"]) || "default",
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

/**
 * Ensures a foreground hex color has enough contrast against a background.
 * If the contrast ratio is too low (e.g. yellow text on white card),
 * returns a safe dark or light alternative.
 */
function ensureContrastOnLight(fgHex: string, bgHex: string): string {
  const toLum = (hex: string) => {
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  const fgLum = toLum(fgHex);
  const bgLum = toLum(bgHex);
  if (Math.abs(fgLum - bgLum) < 0.3) {
    // Not enough contrast — return safe dark or light color
    return bgLum > 0.5 ? "1E293B" : "E8EDF5";
  }
  return fgHex;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 2.5: IMAGE SERVICE
// ═══════════════════════════════════════════════════════════════════

const PT_EN_MAP: Record<string, string> = {
  "inteligência": "intelligence", "artificial": "artificial", "produtividade": "productivity",
  "trabalho": "work", "negócios": "business", "marketing": "marketing", "vendas": "sales",
  "educação": "education", "tecnologia": "technology", "saúde": "health", "gestão": "management",
  "liderança": "leadership", "inovação": "innovation", "empreendedorismo": "entrepreneurship",
  "finanças": "finance", "comunicação": "communication", "estratégia": "strategy",
  "dados": "data", "digital": "digital", "criatividade": "creativity", "design": "design",
  "sustentabilidade": "sustainability", "automação": "automation", "análise": "analysis",
  "desenvolvimento": "development", "programação": "programming", "segurança": "security",
  "nuvem": "cloud", "rede": "network", "máquina": "machine", "aprendizado": "learning",
  "profundo": "deep", "natural": "natural", "linguagem": "language", "processamento": "processing",
  "robótica": "robotics", "internet": "internet", "projeto": "project", "planejamento": "planning",
  "equipe": "team", "cliente": "customer", "produto": "product", "serviço": "service",
  "resultado": "results", "crescimento": "growth", "transformação": "transformation",
  "pesquisa": "research", "ciência": "science", "engenharia": "engineering",
  "computação": "computing", "blockchain": "blockchain", "criptomoeda": "cryptocurrency",
  "investimento": "investment", "economia": "economy", "mercado": "market",
  "psicologia": "psychology", "neurociência": "neuroscience", "medicina": "medicine",
  "farmácia": "pharmacy", "ambiente": "environment", "energia": "energy",
  "agricultura": "agriculture", "alimento": "food", "logística": "logistics",
  "transporte": "transportation", "construção": "construction", "arquitetura": "architecture",
  "música": "music", "arte": "art", "fotografia": "photography", "vídeo": "video",
  "jogos": "games", "esporte": "sport", "turismo": "tourism", "moda": "fashion",
  "direito": "law", "ética": "ethics", "sociedade": "society", "cultura": "culture",
  "história": "history", "filosofia": "philosophy", "matemática": "mathematics",
  "física": "physics", "química": "chemistry", "biologia": "biology",
  "pedagógica": "pedagogical", "ensino": "teaching", "aprendizagem": "learning",
  "curso": "course", "aula": "class", "professor": "teacher", "aluno": "student",
  "avaliação": "evaluation", "metodologia": "methodology", "conteúdo": "content",
  "ferramenta": "tool", "plataforma": "platform", "aplicativo": "application",
  "sistema": "system", "processo": "process", "modelo": "model", "framework": "framework",
  "código": "code", "software": "software", "hardware": "hardware", "algoritmo": "algorithm",
  "banco": "database", "servidor": "server", "api": "api", "web": "web", "mobile": "mobile",
  "aumentar": "increase", "reduzir": "reduce", "melhorar": "improve", "otimizar": "optimize",
};

const PT_STOP_WORDS = new Set([
  "de", "da", "do", "das", "dos", "para", "com", "em", "na", "no", "nas", "nos",
  "um", "uma", "uns", "umas", "o", "a", "os", "as", "e", "ou", "que", "por",
  "ao", "à", "como", "mais", "não", "se", "seu", "sua", "seus", "suas",
  "muito", "bem", "todo", "toda", "todos", "todas", "este", "esta", "esse",
  "essa", "aquele", "aquela", "ser", "ter", "fazer", "poder", "dever",
  "módulo", "capítulo", "seção", "parte", "sobre", "entre", "até", "sem",
]);

const _PT_EN_NORM_CACHE: Map<string, [string, string]> = new Map();
function _getPtEnNormalized(): [string, string][] {
  if (_PT_EN_NORM_CACHE.size === 0) {
    for (const [pt, en] of Object.entries(PT_EN_MAP)) {
      const ptNorm = pt.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      _PT_EN_NORM_CACHE.set(ptNorm, [ptNorm, en]);
    }
  }
  return [..._PT_EN_NORM_CACHE.values()];
}

const _PT_STOP_NORM = new Set(
  [...PT_STOP_WORDS].map((w) => w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()),
);

function buildImageQuery(title: string): string {
  const normalized = title.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = normalized.split(" ").filter((w) => w.length > 2 && !_PT_STOP_NORM.has(w));

  const ptEnEntries = _getPtEnNormalized();
  const translated = words.map((w) => {
    for (const [ptNorm, en] of ptEnEntries) {
      if (w === ptNorm) return en;
    }
    return w;
  });

  const unique = [...new Set(translated)];
  return unique.slice(0, 4).join(" ") + " professional";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 1024;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    let str = "";
    for (let j = i; j < end; j++) {
      str += String.fromCharCode(bytes[j]);
    }
    parts.push(str);
  }
  return btoa(parts.join(""));
}

async function fetchUnsplashImage(
  query: string,
  orientation: "landscape" | "portrait" | "squarish" = "landscape",
): Promise<SlideImage | null> {
  const accessKey = Deno.env.get("UNSPLASH_ACCESS_KEY");
  if (!accessKey) {
    console.warn("[V2-IMAGE] UNSPLASH_ACCESS_KEY not found in environment");
    return null;
  }

  const keyPreview = accessKey.length > 8 ? `${accessKey.substring(0, 4)}...${accessKey.substring(accessKey.length - 4)}` : "***";
  console.log(`[V2-IMAGE] Using key: ${keyPreview} (length=${accessKey.length})`);

  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=1&content_filter=high`;
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${accessKey}` },
    });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      console.warn(`[V2-IMAGE] Unsplash returned ${res.status} for query "${query}". Response: ${errorBody.substring(0, 200)}`);
      if (res.status === 401) {
        console.error("[V2-IMAGE] ERROR 401: Access Key is INVALID. Go to https://unsplash.com/developers, open your app, and copy the 'Access Key' (NOT 'Secret Key'). Then set it via: supabase secrets set UNSPLASH_ACCESS_KEY=your_access_key");
      }
      return null;
    }
    const data = await res.json();
    if (!data.results?.length) {
      console.warn(`[V2-IMAGE] No results for query "${query}"`);
      return null;
    }

    const photo = data.results[0];
    const imageUrl = photo.urls?.regular || photo.urls?.small;
    if (!imageUrl) return null;

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const mimeType = contentType.split(";")[0].trim();
    const buf = await imgRes.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);

    console.log(`[V2-IMAGE] Fetched image for "${query}" — credit: ${photo.user?.name}, mime=${mimeType}, base64Length=${base64.length}, starts="${base64.substring(0, 20)}"`);

    return {
      base64Data: `data:${mimeType};base64,${base64}`,
      credit: photo.user?.name || "Unsplash",
      creditUrl: photo.user?.links?.html || "https://unsplash.com",
    };
  } catch (e: any) {
    console.warn(`[V2-IMAGE] Failed to fetch image for "${query}":`, e.message);
    return null;
  }
}

async function buildImagePlan(
  courseTitle: string,
  modules: { title: string; content: string }[],
  includeImages: boolean,
): Promise<ImagePlan> {
  const empty: ImagePlan = { cover: null, modules: new Map(), closing: null };
  if (!includeImages) return empty;

  const accessKey = Deno.env.get("UNSPLASH_ACCESS_KEY");
  if (!accessKey) {
    console.error("[V2-IMAGE] UNSPLASH_ACCESS_KEY NOT FOUND in Supabase secrets. To fix: run 'supabase secrets set UNSPLASH_ACCESS_KEY=your_access_key' or add it in the Supabase Dashboard under Edge Functions > Secrets.");
    return empty;
  }

  console.log(`[V2-IMAGE] Building image plan for "${courseTitle}" with ${modules.length} modules. Key present: YES (length=${accessKey.length})`);

  const coverQuery = buildImageQuery(courseTitle);
  const moduleQueries = modules.map((m) => {
    const rawTitle = m.title.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || m.title;
    return buildImageQuery(rawTitle);
  });

  const MAX_CONCURRENT = 4;
  const allQueries: { query: string; orientation: "landscape" | "portrait" | "squarish" }[] = [];
  allQueries.push({ query: coverQuery, orientation: "landscape" });
  for (const q of moduleQueries) {
    allQueries.push({ query: q, orientation: "landscape" });
  }
  allQueries.push({ query: coverQuery + " conclusion", orientation: "landscape" });

  const results: PromiseSettledResult<SlideImage | null>[] = [];
  for (let i = 0; i < allQueries.length; i += MAX_CONCURRENT) {
    const batch = allQueries.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.allSettled(
      batch.map((q) => fetchUnsplashImage(q.query, q.orientation)),
    );
    results.push(...batchResults);
  }

  const plan: ImagePlan = { cover: null, modules: new Map(), closing: null };

  const coverResult = results[0];
  if (coverResult.status === "fulfilled" && coverResult.value) {
    plan.cover = coverResult.value;
  }

  for (let i = 0; i < modules.length; i++) {
    const result = results[i + 1];
    if (result.status === "fulfilled" && result.value) {
      plan.modules.set(i, result.value);
    }
  }

  const closingResult = results[results.length - 1];
  if (closingResult.status === "fulfilled" && closingResult.value) {
    plan.closing = closingResult.value;
  }

  const fetched = (plan.cover ? 1 : 0) + plan.modules.size + (plan.closing ? 1 : 0);
  console.log(`[V2-IMAGE] Fetched ${fetched}/${allQueries.length} images`);

  return plan;
}

function addImageCredit(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  credit: string,
  design: DesignConfig,
) {
  slide.addText(`Foto: ${credit} / Unsplash`, {
    x: SLIDE_W - 4.00,
    y: SLIDE_H - 0.32,
    w: 3.60,
    h: 0.22,
    fontSize: 7,
    fontFace: design.fonts.body,
    color: "FFFFFF",
    align: "right",
    transparency: 50,
  });
}

function addImageOverlay(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  color: string,
  transparency: number,
  x = 0, y = 0, w = SLIDE_W, h = SLIDE_H,
) {
  slide.addShape("rect" as any, {
    x, y, w, h,
    fill: { color },
    transparency,
  });
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 3: TEXT UTILITIES
// ═══════════════════════════════════════════════════════════════════

function sanitize(text: string): string {
  if (!text) return "";
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/\u00AD/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureSentenceEnd(text: string): string {
  if (!text) return "";
  const t = text.trim();
  if (!t) return "";
  if (/[.!?…]$/.test(t)) return t;
  return t + ".";
}

function isSentenceComplete(text: string): boolean {
  if (!text || text.trim().length < 5) return true;
  const t = text.trim().replace(/\.+$/, "").trim();
  if (/[,;:\-–]$/.test(t)) return false;
  // Dangling compound prepositional phrases (e.g. "de forma", "de modo", "por meio")
  const danglingCompound =
    /\s(de\s+forma|de\s+modo|de\s+maneira|por\s+meio|em\s+termos|no\s+âmbito|ao\s+longo|a\s+partir|em\s+função|com\s+base|por\s+conta|no\s+sentido|de\s+acordo|em\s+relação|a\s+fim|de\s+cada|de\s+um|de\s+uma|a\s+cada)\s*$/i;
  if (danglingCompound.test(t)) return false;
  const danglingEndings =
    /\s(de|da|do|das|dos|na|no|nas|nos|em|para|por|com|ao|à|a|o|as|os|um|uma|uns|umas|e|ou|que|seu|sua|seus|suas|sem|como|mais|não)\s*$/i;
  if (danglingEndings.test(t)) return false;
  const incompleteVerbs =
    /\s(permite|oferece|utiliza|analisa|envolve|gera|inclui|aplica|usa|apresenta|fornece|facilita|ajuda|promove|garante|aumenta|reduz|melhora|possibilita|integra|exige|exigem|requer|requerem|transforma|cria|define|produz|realiza|proporciona|determina|estabelece|identifica|desenvolve|implementa|combina|conecta|automatiza)\s*$/i;
  if (incompleteVerbs.test(t)) return false;
  return true;
}

function repairSentence(text: string): string {
  if (!text) return "";
  let t = text.trim();
  // Strip dangling compound prepositional phrases first (before single-word stripping)
  t = t
    .replace(
      /\s+(de\s+forma|de\s+modo|de\s+maneira|por\s+meio|em\s+termos|no\s+âmbito|ao\s+longo|a\s+partir|em\s+função|com\s+base|por\s+conta|no\s+sentido|de\s+acordo|em\s+relação|a\s+fim|de\s+cada|de\s+um|de\s+uma|a\s+cada)\s*$/i,
      "",
    )
    .trim();
  // Strip dangling prepositions/articles
  t = t
    .replace(
      /\s+(de|da|do|das|dos|na|no|nas|nos|em|para|por|com|ao|à|a|o|as|os|um|uma|uns|umas|e|ou|que|seu|sua|seus|suas|sem|como|mais|não)\s*$/i,
      "",
    )
    .trim();
  // Strip dangling transitive verbs (the sentence is incomplete without an object)
  t = t
    .replace(
      /\s+(permite|oferece|utiliza|analisa|envolve|gera|inclui|aplica|usa|apresenta|fornece|facilita|ajuda|promove|garante|aumenta|reduz|melhora|possibilita|integra|exigem|exige|requer|requerem|transforma|cria|define|produz|realiza|proporciona|determina|estabelece|identifica|desenvolve|implementa|combina|conecta|automatiza)\s*$/i,
      "",
    )
    .trim();
  t = t.replace(/[,:;\-–]+$/, "").trim();
  // After stripping, re-check recursively (up to 3 passes) for new dangling endings
  for (let pass = 0; pass < 3; pass++) {
    const before = t;
    t = t.replace(/\s+(de\s+forma|de\s+modo|de\s+maneira|por\s+meio|em\s+termos|no\s+âmbito|ao\s+longo|a\s+partir|em\s+função|com\s+base|por\s+conta|no\s+sentido|de\s+acordo|em\s+relação|a\s+fim|de\s+cada|de\s+um|de\s+uma|a\s+cada)\s*$/i, "").trim();
    t = t.replace(/\s+(de|da|do|das|dos|na|no|nas|nos|em|para|por|com|ao|à|a|o|as|os|um|uma|uns|umas|e|ou|que|seu|sua|seus|suas|sem|como|mais|não)\s*$/i, "").trim();
    t = t.replace(/\s+(permite|oferece|utiliza|analisa|envolve|gera|inclui|aplica|usa|apresenta|fornece|facilita|ajuda|promove|garante|aumenta|reduz|melhora|possibilita|integra|exigem|exige|requer|requerem|transforma|cria|define|produz|realiza|proporciona|determina|estabelece|identifica|desenvolve|implementa|combina|conecta|automatiza)\s*$/i, "").trim();
    t = t.replace(/[,:;\-–]+$/, "").trim();
    if (t === before) break;
  }
  return ensureSentenceEnd(t);
}

function cleanMarkdown(text: string): string {
  if (!text) return "";
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function startsWithConnectorFragment(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(e|ou|mas|porém|entretanto|além|como|com|sem|para|por|de|da|do|das|dos|em|na|no|nas|nos|que|quando|onde|enquanto)\b/.test(t);
}

function smartTruncate(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text;
  const sub = text.substring(0, maxLen);
  const sentenceEnd = Math.max(
    sub.lastIndexOf(". "),
    sub.lastIndexOf("! "),
    sub.lastIndexOf("? "),
    sub.lastIndexOf("; "),
  );
  if (sentenceEnd > maxLen * 0.5) {
    return text.substring(0, sentenceEnd + 1).trim();
  }
  const lastSpace = sub.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.6) {
    const cut = text.substring(0, lastSpace).trim();
    const repaired = repairSentence(cut);
    if (isSentenceComplete(repaired.replace(/\.\s*$/, ""))) {
      return repaired;
    }
  }
  // Do not force semantic amputation when there is no safe sentence boundary.
  return ensureSentenceEnd(text.trim());
}

function extractFirstCompleteSentence(text: string, maxLen: number): string {
  const normalized = sanitize(cleanMarkdown(text)).replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const sentenceCandidates = (normalized.match(/[^.!?]+[.!?]?/g) || [])
    .map((s) => sanitize(s).trim())
    .filter(Boolean);

  for (const candidate of sentenceCandidates) {
    const repaired = repairSentence(candidate);
    const bare = repaired.replace(/[.\s]+$/, "").trim();
    if (bare.length >= 10 && isSentenceComplete(bare)) {
      return smartTruncate(repaired, maxLen);
    }
  }

  return "";
}

function isWeakProcessFragment(text: string): boolean {
  const t = text.trim();
  if (t.length > 120) return false;
  // Known weak openers — anaphoric references that lack standalone meaning
  if (/^(Isso|Esse processo|Essa abordagem|Esse m[eé]todo|Esse tipo|Essa ferramenta|Essa t[eé]cnica|Essa estrat[eé]gia|Essa pr[aá]tica|Esse recurso)\s+(oferece|garante|facilita|possibilita|ajuda|promove|permite|gera|reduz|melhora|acelera|aumenta|é|envolve|produz)\b/i.test(t)) return true;
  // "Ele/Ela + verb" filler
  if (/^(Ele|Ela|Eles|Elas)\s+(permite|oferece|garante|facilita|possibilita|ajuda|promove)\b/i.test(t)) return true;
  // REMOVED: the overly aggressive <70 chars rule that was catching legitimate content
  return false;
}

function normalizeResidualText(text: string): string {
  let t = sanitize(cleanMarkdown(text || ""));
  if (!t) return "";

  t = t
    // English terms → Portuguese (expanded)
    .replace(/\bwidely used\b/gi, "amplamente utilizado")
    .replace(/\bmachine learning\b/gi, "aprendizado de máquina")
    .replace(/\bdeep learning\b/gi, "aprendizado profundo")
    .replace(/\bnatural language processing\b/gi, "processamento de linguagem natural")
    .replace(/\bbest practices?\b/gi, "boas práticas")
    .replace(/\buse cases?\b/gi, "casos de uso")
    .replace(/\breal[- ]?time\b/gi, "tempo real")
    .replace(/\bfeedback\b/gi, "retorno")
    .replace(/\bframework\b/gi, "estrutura")
    .replace(/\binput\b/gi, "entrada")
    .replace(/\boutput\b/gi, "saída")
    .replace(/\bdata[- ]?driven\b/gi, "orientado por dados")
    .replace(/\bstakeholders?\b/gi, "partes interessadas")
    .replace(/\binsights?\b/gi, "percepções")
    .replace(/\bbenchmark(ing)?\b/gi, "referência")
    .replace(/\bscalability\b/gi, "escalabilidade")
    .replace(/\bworkflow\b/gi, "fluxo de trabalho")
    .replace(/\bcloud[- ]?based\b/gi, "baseado em nuvem")
    .replace(/\boverall\b/gi, "no geral")
    .replace(/\bapproach\b/gi, "abordagem")
    .replace(/\bkey\b/gi, "chave")
    .replace(/\btools?\b/gi, "ferramentas")
    // "soft skills" / "soft habilidades" MUST come before generic "skills"
    .replace(/\bsoft\s+skills?\b/gi, "habilidades interpessoais")
    .replace(/\bsoft\s+habilidades?\b/gi, "habilidades interpessoais")
    .replace(/\bhard\s+skills?\b/gi, "habilidades técnicas")
    .replace(/\bskills?\b/gi, "habilidades")
    .replace(/\bperformance\b/gi, "desempenho")
    .replace(/\befficiency\b/gi, "eficiência")
    .replace(/\baccuracy\b/gi, "precisão")
    .replace(/\btraining\b/gi, "treinamento")
    .replace(/\bdataset\b/gi, "conjunto de dados")
    .replace(/\bpipeline\b/gi, "fluxo de processamento")
    .replace(/\bdeployment\b/gi, "implantação")
    // Additional English leaks
    .replace(/\bhowever\b/gi, "entretanto")
    .replace(/\btherefore\b/gi, "portanto")
    .replace(/\bmoreover\b/gi, "além disso")
    .replace(/\bfurthermore\b/gi, "além disso")
    .replace(/\bin\s+order\s+to\b/gi, "para")
    .replace(/\bas\s+well\s+as\b/gi, "assim como")
    .replace(/\bon\s+the\s+other\s+hand\b/gi, "por outro lado")
    .replace(/\bbased\s+on\b/gi, "com base em")
    .replace(/\bthrough\b/gi, "por meio de")
    .replace(/\baccording\s+to\b/gi, "de acordo com")

    // "amplamente utilizado/a" → context-aware gender agreement
    // Feminine singular nouns
    .replace(/\b(ferramenta|plataforma|tecnologia|t[eé]cnica|abordagem|metodologia|estrat[eé]gia|pr[aá]tica)\s+amplamente\s+utilizado\b/gi,
      (_, noun) => `${noun} amplamente utilizada`)
    // Feminine plural nouns
    .replace(/\b(ferramentas|plataformas|solu[cç][oõ]es|tecnologias|t[eé]cnicas|abordagens|metodologias|estrat[eé]gias|pr[aá]ticas)\s+amplamente\s+utilizado\b/gi,
      (_, noun) => `${noun} amplamente utilizadas`)
    .replace(/\b(ferramentas|plataformas|solu[cç][oõ]es|tecnologias|t[eé]cnicas|abordagens|metodologias|estrat[eé]gias|pr[aá]ticas)\s+amplamente\s+utilizados\b/gi,
      (_, noun) => `${noun} amplamente utilizadas`)
    // Masculine singular nouns — keep masculine singular
    .replace(/\b(software|sistema|modelo|m[eé]todo|processo|algoritmo|recurso|aplicativo)\s+amplamente\s+utilizada\b/gi,
      (_, noun) => `${noun} amplamente utilizado`)
    // Masculine plural nouns — ensure masculine plural
    .replace(/\b(softwares|sistemas|modelos|m[eé]todos|processos|algoritmos|recursos|aplicativos)\s+amplamente\s+utilizado\b/gi,
      (_, noun) => `${noun} amplamente utilizados`)
    .replace(/\b(softwares|sistemas|modelos|m[eé]todos|processos|algoritmos|recursos|aplicativos)\s+amplamente\s+utilizada\b/gi,
      (_, noun) => `${noun} amplamente utilizados`)
    .replace(/\b(softwares|sistemas|modelos|m[eé]todos|processos|algoritmos|recursos|aplicativos)\s+amplamente\s+utilizadas\b/gi,
      (_, noun) => `${noun} amplamente utilizados`)

    // "percepções valiosos/imprecisos" → "percepções valiosas/imprecisas" (fem. plural)
    .replace(/\bpercep[cç][oõ]es\s+(valiosos|baseados|obtidos|gerados|coletados|produzidos|fornecidos|relevantes|imprecisos|incorretos|errados|precisos|detalhados|significativos|importantes|essenciais|fundamentais|concretos|abstratos|profundos|superficiais|claros|complexos)\b/gi, 
      (_, adj) => {
        const femMap: Record<string, string> = {
          valiosos: "valiosas", baseados: "baseadas", obtidos: "obtidas",
          gerados: "geradas", coletados: "coletadas", produzidos: "produzidas",
          fornecidos: "fornecidas", relevantes: "relevantes",
          imprecisos: "imprecisas", incorretos: "incorretas", errados: "erradas",
          precisos: "precisas", detalhados: "detalhadas", significativos: "significativas",
          importantes: "importantes", essenciais: "essenciais", fundamentais: "fundamentais",
          concretos: "concretas", abstratos: "abstratas", profundos: "profundas",
          superficiais: "superficiais", claros: "claras", complexos: "complexas",
        };
        return `percepções ${femMap[adj.toLowerCase()] || adj}`;
      })
    // "informações coletados" → "informações coletadas"
    .replace(/\binforma[cç][oõ]es\s+(coletados|obtidos|gerados|baseados|fornecidos|relevantes)\b/gi,
      (_, adj) => {
        const femMap: Record<string, string> = {
          coletados: "coletadas", obtidos: "obtidas", gerados: "geradas",
          baseados: "baseadas", fornecidos: "fornecidas", relevantes: "relevantes",
        };
        return `informações ${femMap[adj.toLowerCase()] || adj}`;
      })
    // "decisões baseados" → "decisões baseadas"
    .replace(/\bdecis[oõ]es\s+(baseados|informados|tomados)\b/gi,
      (_, adj) => {
        const femMap: Record<string, string> = {
          baseados: "baseadas", informados: "informadas", tomados: "tomadas",
        };
        return `decisões ${femMap[adj.toLowerCase()] || adj}`;
      })
    // "soluções personalizados" → "soluções personalizadas"
    .replace(/\bsolu[cç][oõ]es\s+(personalizados|automatizados|integrados|otimizados|implementados|desenvolvidos)\b/gi,
      (_, adj) => `soluções ${adj.replace(/os$/, "as")}`)
    // "ferramentas utilizados" → "ferramentas utilizadas"
    .replace(/\bferramentas\s+(utilizados|usados|aplicados|desenvolvidos|integrados)\b/gi,
      (_, adj) => `ferramentas ${adj.replace(/os$/, "as")}`)
    // "estratégias utilizados" → "estratégias utilizadas"
    .replace(/\bestrat[eé]gias\s+(utilizados|baseados|aplicados|desenvolvidos|implementados)\b/gi,
      (_, adj) => `estratégias ${adj.replace(/os$/, "as")}`)
    // "tecnologias avançados" → "tecnologias avançadas"
    .replace(/\btecnologias\s+(avan[cç]ados|utilizados|baseados|integrados|modernos)\b/gi,
      (_, adj) => `tecnologias ${adj.replace(/os$/, "as")}`)
    // "práticas recomendados" → "práticas recomendadas"
    .replace(/\bpr[aá]ticas\s+(recomendados|aplicados|utilizados|baseados|desenvolvidos)\b/gi,
      (_, adj) => `práticas ${adj.replace(/os$/, "as")}`)
    // "métricas definidos" → "métricas definidas"
    .replace(/\bm[eé]tricas\s+(definidos|coletados|obtidos|utilizados|aplicados)\b/gi,
      (_, adj) => `métricas ${adj.replace(/os$/, "as")}`)
    // Generic feminine plural noun + masculine plural adjective → feminine agreement
    // Catches patterns like "respostas inadequados", "análises realizados", "previsões incorretos"
    .replace(/\b(respostas?|an[aá]lises?|previs[oõ]es|condi[cç][oõ]es|opera[cç][oõ]es|avalia[cç][oõ]es|recomenda[cç][oõ]es|configura[cç][oõ]es|aplica[cç][oõ]es|classifica[cç][oõ]es|predi[cç][oõ]es|intera[cç][oõ]es|automa[cç][oõ]es|implementa[cç][oõ]es|comunica[cç][oõ]es|contribui[cç][oõ]es|m[aá]quinas?|redes?|tarefas?|regras?|vari[aá]veis|atividades?|compet[eê]ncias?|tend[eê]ncias?|refer[eê]ncias?|experi[eê]ncias?|inst[aâ]ncias?|demandas?|etapas?|camadas?|medidas?|bases?)\s+(inadequados|realizados|desenvolvidos|aplicados|utilizados|baseados|gerados|otimizados|automatizados|integrados|personalizados|implementados|configurados|conectados|processados|treinados|ajustados|avançados|especializados|refinados|aprimorados|combinados|relacionados|direcionados|orientados|destinados|preparados|projetados|estruturados)\b/gi,
      (_, noun, adj) => `${noun} ${adj.replace(/os$/, "as")}`)
    // Singular feminine + masculine adjective: "resposta inadequado" → "resposta inadequada"
    .replace(/\b(resposta|an[aá]lise|previs[aã]o|condi[cç][aã]o|opera[cç][aã]o|avalia[cç][aã]o|recomenda[cç][aã]o|configura[cç][aã]o|aplica[cç][aã]o|classifica[cç][aã]o|predi[cç][aã]o|intera[cç][aã]o|automa[cç][aã]o|implementa[cç][aã]o|comunica[cç][aã]o|m[aá]quina|rede|tarefa|regra|vari[aá]vel|atividade|compet[eê]ncia|tend[eê]ncia|refer[eê]ncia|experi[eê]ncia|demanda|etapa|camada|medida|base)\s+(inadequado|realizado|desenvolvido|aplicado|utilizado|baseado|gerado|otimizado|automatizado|integrado|personalizado|implementado|configurado|conectado|processado|treinado|ajustado|avançado|especializado|refinado|aprimorado|combinado|relacionado|direcionado|orientado|destinado|preparado|projetado|estruturado)\b/gi,
      (_, noun, adj) => `${noun} ${adj.replace(/o$/, "a")}`)

    // Missing preposition "de" in "gestão X" patterns
    .replace(/\bgest[aã]o\s+(documentos|projetos|dados|tarefas|equipes?|processos?|conte[uú]dos?|riscos?|tempo|conhecimento|recursos?|clientes?|pessoas|custos?|qualidade|mudan[cç]as?|contratos?)\b/gi, (_, noun) => `gestão de ${noun.toLowerCase()}`)
    // Missing preposition in "análise X" patterns
    .replace(/\ban[aá]lise\s+(dados|sentimentos?|riscos?|resultados?|desempenho|mercado)\b/gi, (_, noun) => `análise de ${noun.toLowerCase()}`)
    // Missing preposition in "segurança X" patterns
    .replace(/\bseguran[cç]a\s+(dados|informa[cç][oõ]es|sistemas?|redes?)\b/gi, (_, noun) => `segurança de ${noun.toLowerCase()}`)
    // Missing preposition in "automação X", "integração X", "otimização X"
    .replace(/\bautoma[cç][aã]o\s+(processos?|tarefas?|sistemas?)\b/gi, (_, noun) => `automação de ${noun.toLowerCase()}`)
    .replace(/\bintegra[cç][aã]o\s+(dados|sistemas?|ferramentas?|plataformas?)\b/gi, (_, noun) => `integração de ${noun.toLowerCase()}`)
    .replace(/\botimiza[cç][aã]o\s+(processos?|recursos?|custos?|resultados?|tempo)\b/gi, (_, noun) => `otimização de ${noun.toLowerCase()}`)
    // Missing preposition in "monitoramento X", "processamento X"
    .replace(/\bmonitoramento\s+(dados|resultados?|desempenho|sistemas?)\b/gi, (_, noun) => `monitoramento de ${noun.toLowerCase()}`)
    .replace(/\bprocessamento\s+(dados|linguagem|texto|imagens?)\b/gi, (_, noun) => `processamento de ${noun.toLowerCase()}`)

    // Punctuation cleanup
    .replace(/\.{2,}/g, ".")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/([.!?])\s*"\s*\./g, '$1"')
    .replace(/\"\s*\"/g, '"')
    .replace(/"\s*\.\s*$/g, '".')
    .replace(/,\s*(al[eé]m disso|e tamb[eé]m),?\s*\d+\.?$/i, ".")
    .replace(/^\s*\d+[.)]\s*/g, "")
    // Fix broken prompt quotation: ensure closing quote before period
    .replace(/"([^"]{5,})\.\s*$/g, '"$1."')
    // Fix doubled periods after quotes
    .replace(/\."\./g, '."')
    .replace(/\."\.$/g, '."')
    // Fix trailing period inside and outside quotes
    .replace(/([.!?])"\s*\.\s*$/g, '$1"')
    // Fix orphan punctuation at start
    .replace(/^[.,;:!?\s]+/, "")
    // Fix period-space-period artifacts (e.g., "Dados. .")
    .replace(/\.\s+\./g, ".")
    // Fix double spaces left by replacements
    .replace(/\s{2,}/g, " ")
    .trim();

  if (/^\d+[.)-]?$/.test(t)) return "";

  // ── UNIVERSAL "Label / Content" slash-to-colon conversion ──
  // Catches ANY "CapitalizedWord(s) / content" pattern where label is 2-40 chars
  // and doesn't contain sentence-ending punctuation (so it's a real label, not prose).
  // This replaces the old separate CORE + EXTENDED regex approach that missed patterns
  // like "Necessidade / ...", "Ferramenta Escolhida / ...", etc.
  const UNIVERSAL_SLASH = /^([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]+(?:\s+[A-Za-záàâãéêíóôõúüç]+){0,2})\s*\/\s*(.+)$/;
  const slashMatch = t.match(UNIVERSAL_SLASH);
  if (slashMatch) {
    const label = slashMatch[1].replace(/\s+/g, " ").trim();
    const desc = slashMatch[2].trim();
    if (label.length >= 2 && label.length <= 40 && !/[.!?]/.test(label)) {
      t = `${label}: ${desc}`;
    }
  }

  t = t
    .replace(/([.!?])\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ])/g, "$1 $2")
    .replace(/,\s*(entretanto|contudo|porém|no entanto|todavia)\b/gi, ". $1")
    .replace(/,\s*(al[eé]m disso|ademais|outrossim|por outro lado)\b/gi, ". $1")
    .replace(/\b(é|são)\s+(muito|bastante)\s+(importante|essencial|fundamental|relevante|necess[aá]rio)\b/gi,
      (_m, verb, _int, adj) => `${verb} ${adj}`)
    .replace(/\b(utilizar|usar)\s+(de)\s+/gi, "$1 ")
    .replace(/\bde\s+de\b/gi, "de")
    .replace(/\bpara\s+para\b/gi, "para")
    .replace(/\ba\s+a\b/gi, "a")
    .replace(/\bque\s+que\b/gi, "que")
    .replace(/\bcom\s+com\b/gi, "com")
    .trim();

  const finalized = ensureSentenceEnd(repairSentence(t))
    .replace(/\.{2,}/g, ".")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
  return finalized;
}

function isEditoriallyStrongSentence(text: string): boolean {
  const bare = sanitize(text).replace(/[.\s]+$/, "").trim();
  if (bare.length < 36) return false;
  if (bare.split(/\s+/).length < 7) return false;
  if (/\b(and|with|for|the|widely used)\b/i.test(bare) && /\b(com|de|para|que|dos|das)\b/i.test(bare)) return false;
  if (/\b(grandes|intelig[eê]ncia|processo|dados)\s*$/i.test(bare)) return false;
  return isSentenceComplete(bare);
}

function extractTocDescription(content: string, maxLen: number): string {
  const stripped = (content || "")
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "")
    .trim();

  const normalized = sanitize(cleanMarkdown(stripped));
  if (!normalized) return "";

  const candidates = (normalized.match(/[^.!?]+[.!?]?/g) || [])
    .map((s) => normalizeResidualText(s))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (isEditoriallyStrongSentence(candidate)) {
      return smartTruncate(candidate, maxLen);
    }
  }

  const objectiveLines = stripped
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 20)
    .map((line) => normalizeResidualText(line))
    .filter((line) => isEditoriallyStrongSentence(line));

  if (objectiveLines.length > 0) {
    return smartTruncate(objectiveLines[0], maxLen);
  }

  return "";
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 4: STAGE 1 — PARSE (Markdown → ParsedBlocks)
// ═══════════════════════════════════════════════════════════════════

const SECTION_EMOJI_MAP: Record<string, string> = {
  "🎯": "objectives",
  "🧠": "fundamentals",
  "⚙️": "process",
  "🧩": "models",
  "🛠️": "applications",
  "💡": "example",
  "⚠️": "challenges",
  "💭": "reflection",
  "🧾": "summary",
  "📌": "takeaways",
};

function parseModuleContent(content: string): ParsedBlock[] {
  if (!content || !content.trim()) return [];
  const lines = content.split("\n");
  const blocks: ParsedBlock[] = [];
  let currentBullets: string[] = [];
  let currentSectionHint: string | undefined;

  function flushBullets() {
    if (currentBullets.length > 0) {
      blocks.push({
        type: "bullets",
        content: currentBullets.join("\n"),
        items: currentBullets.map((b) => sanitize(cleanMarkdown(b))),
        sectionHint: currentSectionHint,
      });
      currentBullets = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushBullets();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushBullets();
      const level = headingMatch[1].length;
      const rawTitle = headingMatch[2];
      let sectionHint: string | undefined;
      for (const [emoji, hint] of Object.entries(SECTION_EMOJI_MAP)) {
        if (rawTitle.includes(emoji)) {
          sectionHint = hint;
          break;
        }
      }
      // TEXT-BASED FALLBACK: detect pedagogical type from heading keywords
      // when no emoji is present — this is the root cause of slides like 32-35
      // being classified as "generic" and bypassing anti-fragmentation logic
      if (!sectionHint) {
        const titleUpper = rawTitle.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const KEYWORD_SECTION_MAP: [RegExp, string][] = [
          [/\b(COMO\s+FUNCIONA|FUNCIONAMENTO|PROCESSO|PASSO\s+A\s+PASSO|ETAPAS|FLUXO\s+DE\s+TRABALHO|WORKFLOW|MECANISMO|COMO\s+FAZER|COMO\s+USAR|COMO\s+APLICAR|COMO\s+UTILIZAR|NA\s+PRATICA)\b/, "process"],
          [/\b(OBJETIVOS?|METAS?|O\s+QUE\s+VOCE\s+VAI\s+APRENDER)\b/, "objectives"],
          [/\b(FUNDAMENTOS?|CONCEITOS?\s+(BASICOS?|ESSENCIAIS?|FUNDAMENTAIS?|CHAVE)|BASE\s+TEORICA|INTRODUCAO|O\s+QUE\s+[EÉ])\b/, "fundamentals"],
          [/\b(MODELOS?|TIPOS?|CATEGORIAS?|CLASSIFICACAO|ABORDAGENS?|METODOLOGIAS?)\b/, "models"],
          [/\b(APLICACOES?|USOS?\s+REAIS?|CASOS?\s+DE\s+USO|ONDE\s+APLICAR|APLICACOES?\s+PRATICAS?)\b/, "applications"],
          [/\b(EXEMPLOS?\s+PRATICOS?|ESTUDO\s+DE\s+CASO|CASO\s+REAL|CENARIO|DEMONSTRACAO)\b/, "example"],
          [/\b(DESAFIOS?|CUIDADOS?|RISCOS?|LIMITACOES?|ERROS?\s+COMUNS?|ARMADILHAS?|PROBLEMAS?)\b/, "challenges"],
          [/\b(REFLEXAO|PENSE\s+SOBRE|PARA\s+PENSAR|REFLEXOES?)\b/, "reflection"],
          [/\b(RESUMO|SINTESE|RECAPITULACAO|EM\s+RESUMO)\b/, "summary"],
          [/\b(TAKEAWAYS?|PONTOS\s+CHAVE|PONTOS?\s+PRINCIPAIS?|CONCLUSOES?|DESTAQUES?)\b/, "takeaways"],
        ];
        for (const [pattern, hint] of KEYWORD_SECTION_MAP) {
          if (pattern.test(titleUpper)) {
            sectionHint = hint;
            break;
          }
        }
      }
      currentSectionHint = sectionHint;
      const cleanTitle = sanitize(
        cleanMarkdown(
          rawTitle.replace(
            /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu,
            "",
          ).replace(/[⚙️🛠️⚠️]/g, ""),
        ),
      );
      blocks.push({
        type: "heading",
        headingLevel: level,
        heading: cleanTitle,
        content: cleanTitle,
        sectionHint,
      });
      continue;
    }

    const tableMatch = trimmed.match(/^\|(.+)\|$/);
    if (tableMatch) {
      flushBullets();
      const tableLines: string[] = [trimmed];
      let j = i + 1;
      while (j < lines.length && lines[j].trim().match(/^\|(.+)\|$/)) {
        tableLines.push(lines[j].trim());
        j++;
      }
      i = j - 1;
      if (tableLines.length >= 2) {
        const headerLine = tableLines[0];
        const headers = headerLine
          .split("|")
          .map((h) => sanitize(cleanMarkdown(h.trim())))
          .filter(Boolean);
        const dataStartIdx = tableLines[1].includes("---") ? 2 : 1;
        const rows: string[][] = [];
        for (let r = dataStartIdx; r < tableLines.length; r++) {
          const cells = tableLines[r]
            .split("|")
            .map((c) => sanitize(cleanMarkdown(c.trim())))
            .filter(Boolean);
          if (cells.length > 0) rows.push(cells);
        }
        blocks.push({
          type: "table",
          content: tableLines.join("\n"),
          tableHeaders: headers,
          tableRows: rows,
          sectionHint: currentSectionHint,
        });
      }
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    const numberedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (bulletMatch || numberedMatch) {
      const text = bulletMatch ? bulletMatch[1] : numberedMatch![1];
      currentBullets.push(text);
      continue;
    }

    const blockquoteMatch = trimmed.match(/^>\s*(.+)$/);
    if (blockquoteMatch) {
      flushBullets();
      const bqContent = sanitize(cleanMarkdown(blockquoteMatch[1]));
      if (bqContent.length > 10) {
        blocks.push({
          type: "paragraph",
          content: bqContent,
          sectionHint: "reflection",
        });
      }
      continue;
    }

    const labelMatch = trimmed.match(/^(\*\*[^*]+\*\*)\s*[:–-]\s*(.+)$/);
    if (labelMatch) {
      flushBullets();
      blocks.push({
        type: "label_value",
        content: trimmed,
        heading: cleanMarkdown(labelMatch[1]),
        items: [sanitize(cleanMarkdown(labelMatch[2]))],
        sectionHint: currentSectionHint,
      });
      continue;
    }

    flushBullets();
    if (trimmed.length > 10) {
      blocks.push({
        type: "paragraph",
        content: sanitize(cleanMarkdown(trimmed)),
        sectionHint: currentSectionHint,
      });
    }
  }

  flushBullets();
  return blocks;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 5: STAGE 2 — SEGMENT (ParsedBlocks → SemanticSections)
// ═══════════════════════════════════════════════════════════════════

const SECTION_LABEL_MAP: Record<string, string> = {
  objectives: "OBJETIVOS",
  fundamentals: "FUNDAMENTOS",
  process: "COMO FUNCIONA",
  models: "MODELOS E TIPOS",
  applications: "APLICAÇÕES REAIS",
  example: "EXEMPLO PRÁTICO",
  challenges: "DESAFIOS E CUIDADOS",
  reflection: "REFLEXÃO",
  summary: "RESUMO DO MÓDULO",
  takeaways: "KEY TAKEAWAYS",
  generic: "CONTEÚDO",
};

function segmentBlocks(blocks: ParsedBlock[]): SemanticSection[] {
  const sections: SemanticSection[] = [];
  let currentSection: SemanticSection | null = null;
  let sectionCounter = 0;

  function pushCurrentSection() {
    if (currentSection && currentSection.blocks.length > 0) {
      sections.push(currentSection);
    }
  }

  for (const block of blocks) {
    if (block.type === "heading" && block.headingLevel && block.headingLevel <= 4) {
      if (block.headingLevel <= 3 || block.sectionHint) {
        pushCurrentSection();
        sectionCounter++;
        const pedType = (block.sectionHint || "generic") as SemanticSection["pedagogicalType"];
        const headingText = (block.heading || block.content || "").toUpperCase();
        const sectionLabel = pedType !== "generic"
          ? (SECTION_LABEL_MAP[pedType] || headingText || "CONTEÚDO")
          : (headingText.length >= 5 ? headingText : "CONTEÚDO");
        currentSection = {
          id: `section-${sectionCounter}`,
          title: block.heading || block.content,
          sectionLabel,
          pedagogicalType: pedType,
          blocks: [],
        };
        continue;
      }
      if (currentSection) { currentSection.blocks.push(block); continue; }
    }

    if (!currentSection) {
      sectionCounter++;
      const pedType = (block.sectionHint || "generic") as SemanticSection["pedagogicalType"];
      currentSection = {
        id: `section-${sectionCounter}`,
        title: "Introdução",
        sectionLabel: SECTION_LABEL_MAP[pedType] || "CONTEÚDO",
        pedagogicalType: pedType,
        blocks: [],
      };
    }

    currentSection.blocks.push(block);
  }

  pushCurrentSection();
  return sections;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 6: STAGE 3 — DISTRIBUTE (SemanticSections → SlidePlans)
// ═══════════════════════════════════════════════════════════════════

const PEDAGOGICAL_LAYOUT_MAP: Record<string, SlideLayoutV2> = {
  objectives: "bullets",
  fundamentals: "definition",
  process: "process_timeline",
  models: "comparison_table",
  applications: "grid_cards",
  example: "example_highlight",
  challenges: "warning_callout",
  reflection: "reflection_callout",
  summary: "summary_slide",
  takeaways: "numbered_takeaways",
  generic: "bullets",
};

function splitLongItem(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const sentences = (text.match(/[^.!?;]+[.!?;]?/g) || [])
    .map((s) => sanitize(s).trim())
    .filter(Boolean)
    .map((s) => ensureSentenceEnd(repairSentence(s)));

  // If there is no safe sentence boundary, keep item intact to avoid semantic amputation.
  if (sentences.length <= 1) {
    return [ensureSentenceEnd(repairSentence(text))];
  }

  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxLen) {
      current = candidate;
      continue;
    }

    if (current) {
      parts.push(current);
      current = "";
    }

    // Keep oversized single sentence intact rather than splitting mid-idea.
    if (sentence.length > maxLen) {
      parts.push(sentence);
    } else {
      current = sentence;
    }
  }

  if (current) parts.push(current);
  return parts;
}

function collectSectionItems(section: SemanticSection): string[] {
  const items: string[] = [];
  for (const block of section.blocks) {
    if (block.items && block.items.length > 0) {
      for (const item of block.items) {
        const cleaned = sanitize(cleanMarkdown(item));
        if (cleaned.length > 3) items.push(cleaned);
      }
    } else if (block.type === "paragraph" && block.content.length > 10) {
      items.push(block.content);
    } else if (block.type === "label_value" && block.heading) {
      const val =
        block.items && block.items[0] ? block.items[0] : block.content;
      items.push(`${block.heading}: ${val}`);
    }
  }
  return items;
}

function extractTableFromSection(section: SemanticSection): {
  headers: string[];
  rows: string[][];
} | null {
  for (const block of section.blocks) {
    if (
      block.type === "table" &&
      block.tableHeaders &&
      block.tableRows &&
      block.tableRows.length > 0
    ) {
      const cleanRows = block.tableRows.slice(0, 6).map((row) =>
        row.map((cell) => {
          const cleaned = sanitize(cell);
          if (!isSentenceComplete(cleaned) && cleaned.length > 20) {
            return repairSentence(cleaned);
          }
          return cleaned;
        }),
      );
      return { headers: block.tableHeaders, rows: cleanRows };
    }
  }
  return null;
}

function validateAndRepairItems(items: string[], report: PipelineReport): string[] {
  return items
    .map((item) => normalizeResidualText(item))
    .filter(Boolean)
    .map((item) => {
      report.sentenceIntegrityChecks++;
      let result = item;
      if (!isSentenceComplete(result)) {
        report.warnings.push(
          `Repaired incomplete sentence: "${result.substring(0, 40)}..."`,
        );
        result = repairSentence(result);
      }
      result = ensureSentenceEnd(result);
      const bare = result.replace(/[.\s]+$/, "").trim();
      if (bare.length < 8) {
        report.warnings.push(`Dropped too-short item after repair: "${bare}"`);
        return "";
      }
      return result;
    })
    .filter((item) => item.length > 0);
}

function mergeShortItems(
  items: string[],
  maxChars: number,
): string[] {
  if (items.length <= 1) return items;
  const merged: string[] = [];
  let i = 0;
  while (i < items.length) {
    const current = items[i];
    if (
      i + 1 < items.length &&
      current.length < 90 &&
      items[i + 1].length < 90 &&
      current.length + items[i + 1].length + 2 <= maxChars
    ) {
      const sep = /[.!?;]\s*$/.test(current) ? " " : ". ";
      merged.push(current + sep + items[i + 1]);
      i += 2;
    } else {
      merged.push(current);
      i++;
    }
  }
  return merged;
}

function mergeAdjacentShortest(
  items: string[],
  targetCount: number,
): string[] {
  if (items.length <= targetCount) return items;

  const compacted = [...items];
  while (compacted.length > targetCount && compacted.length >= 2) {
    let bestIdx = 0;
    let bestLen = Infinity;

    for (let i = 0; i < compacted.length - 1; i++) {
      const combinedLen = compacted[i].length + compacted[i + 1].length;
      if (combinedLen < bestLen) {
        bestLen = combinedLen;
        bestIdx = i;
      }
    }

    const a = compacted[bestIdx].replace(/\.\s*$/, "").trim();
    const b = compacted[bestIdx + 1].trim();
    compacted.splice(bestIdx, 2, ensureSentenceEnd(`${a}. ${b}`));
  }

  return compacted;
}

function redistributeOverflow(
  items: string[],
  maxPerSlide: number,
  maxChars: number,
  report: PipelineReport,
): string[][] {
  let working = items;
  if (working.length > maxPerSlide) {
    working = mergeShortItems(working, maxChars);
  }
  if (working.length <= maxPerSlide) return [working];
  report.redistributions++;
  const chunks: string[][] = [];
  for (let i = 0; i < working.length; i += maxPerSlide) {
    chunks.push(working.slice(i, i + maxPerSlide));
  }
  // Merge last chunk back if it's too short (≤2 items) to avoid weak continuation slides
  const MIN_CONTINUATION_ITEMS = 4;
  if (chunks.length >= 2) {
    const lastChunk = chunks[chunks.length - 1];
    if (lastChunk.length < MIN_CONTINUATION_ITEMS) {
      const prevChunk = chunks[chunks.length - 2];
      chunks[chunks.length - 2] = [...prevChunk, ...lastChunk];
      chunks.pop();
    }
  }
  return chunks;
}

function hasMeaningfulContent(items: string[]): boolean {
  if (items.length === 0) return false;
  const meaningful = items.filter((item) => {
    const bare = item.replace(/[.\s]+$/, "").trim();
    return bare.length >= 16 && isSentenceComplete(bare);
  });
  return meaningful.length >= 2 || meaningful.some((m) => m.length >= 40);
}

function rebalanceChunksForSemanticIntegrity(
  chunks: string[][],
  report: PipelineReport,
): string[][] {
  if (chunks.length <= 1) return chunks;

  // 1) Prevent sentence/idea suspension across chunk boundary
  for (let i = 0; i < chunks.length - 1; i++) {
    const current = chunks[i];
    const next = chunks[i + 1];
    if (!current.length || !next.length) continue;

    let tail = current[current.length - 1];
    let head = next[0];

    while (
      next.length > 0 &&
      (
        !isSentenceComplete(tail.replace(/\.\s*$/, "")) ||
        /[,;:\-–]$/.test(tail.trim()) ||
        startsWithConnectorFragment(head)
      )
    ) {
      current.push(next.shift()!);
      tail = current[current.length - 1];
      head = next[0] || "";
      report.warnings.push("Adjusted chunk boundary to keep sentence/idea intact");
    }
  }

  // 2) Remove weak continuation chunks by folding them back
  const compact: string[][] = [chunks[0]];
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i].filter((item) => item.replace(/[.\s]+$/, "").trim().length >= 8);
    if (!hasMeaningfulContent(chunk)) {
      compact[compact.length - 1].push(...chunk);
      report.warnings.push("Merged weak continuation chunk back into previous slide");
      continue;
    }
    compact.push(chunk);
  }

  return compact.filter((chunk) => chunk.length > 0);
}

function distributeModuleToSlides(
  moduleTitle: string,
  moduleIndex: number,
  sections: SemanticSection[],
  design: DesignConfig,
  report: PipelineReport,
): SlidePlan[] {
  const slides: SlidePlan[] = [];
  const maxItems = design.density.maxItemsPerSlide;
  const maxChars = design.density.maxCharsPerItem;

  const objectivesSection = sections.find(
    (s) => s.pedagogicalType === "objectives",
  );
  let objectiveItems = objectivesSection
    ? validateAndRepairItems(collectSectionItems(objectivesSection), report)
    : [];
  // Extra integrity pass on objectives shown on module cover
  objectiveItems = objectiveItems
    .map((obj) => {
      if (!isSentenceComplete(obj.replace(/\.\s*$/, ""))) {
        return repairSentence(obj);
      }
      return obj;
    })
    .filter((obj) => obj.replace(/[.\s]+$/, "").trim().length >= 10);

  slides.push({
    layout: "module_cover",
    title: moduleTitle,
    subtitle: `MÓDULO ${String(moduleIndex + 1)}`,
    objectives: objectiveItems.slice(0, 3),
    moduleIndex,
  });

  // ── Merge ALL "example" sections into a single consolidated section ──
  // When a module has multiple "Exemplo Prático" sections (even non-consecutive),
  // they should be consolidated into ONE example_highlight slide.
  const mergedSections: SemanticSection[] = [];
  let exampleAccumulator: SemanticSection | null = null;
  let firstExampleInsertIndex = -1;

  // First pass: collect all example sections and note where the first one appeared
  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    if (section.pedagogicalType === "example") {
      if (!exampleAccumulator) {
        exampleAccumulator = { ...section, blocks: [...section.blocks] };
        firstExampleInsertIndex = mergedSections.length;
      } else {
        exampleAccumulator.blocks.push(...section.blocks);
      }
    } else {
      mergedSections.push(section);
    }
  }
  // Insert the merged example section at the position of the first example
  if (exampleAccumulator) {
    mergedSections.splice(firstExampleInsertIndex, 0, exampleAccumulator);
  }

  for (const section of mergedSections) {
    if (section.pedagogicalType === "objectives") continue;
    let layout = PEDAGOGICAL_LAYOUT_MAP[section.pedagogicalType] || "bullets";

    if (layout === "comparison_table") {
      const table = extractTableFromSection(section);
      if (table && table.rows.length > 0) {
        slides.push({
          layout: "comparison_table",
          title: section.title,
          sectionLabel: section.sectionLabel,
          tableHeaders: table.headers,
          tableRows: table.rows,
          moduleIndex,
        });
        continue;
      }
      // If no valid table found, fall through to items-based rendering
    }

    let rawItems = collectSectionItems(section);
    const repairedItems = validateAndRepairItems(rawItems, report);
    let validItems = repairedItems.flatMap((item) => splitLongItem(item, maxChars));

    // ── Process/Timeline anti-fragmentation (final pass) ──
    if (section.pedagogicalType === "process" && validItems.length > 1) {
      const normalizedProcessItems = validItems
        .map((item) => normalizeResidualText(item))
        .filter((item) => item.replace(/[.\s]+$/, "").trim().length >= 10)
        .filter((item) => !/^\d+[.)-]?$/.test(item.trim()));

      // PHASE 1: Only absorb truly anaphoric weak fragments into their predecessor
      const phase1: string[] = [];
      for (const item of normalizedProcessItems) {
        const bare = item.replace(/[.\s]+$/, "").trim();
        if (phase1.length > 0 && isWeakProcessFragment(bare)) {
          const prev = phase1[phase1.length - 1].replace(/[.\s]+$/, "").trim();
          // Extract the meaningful verb+complement from the anaphoric fragment
          const stripped = bare
            .replace(/^(Isso|Esse processo|Essa abordagem|Esse m[eé]todo|Essa ferramenta|Essa t[eé]cnica|Essa estrat[eé]gia|Essa pr[aá]tica|Esse recurso|Esse tipo|Ele|Ela)\s+/i, "")
            .trim();
          const fragmentLower = stripped.charAt(0).toLowerCase() + stripped.slice(1);
          phase1[phase1.length - 1] = ensureSentenceEnd(`${prev}, o que ${fragmentLower}`);
        } else {
          phase1.push(item);
        }
      }

      // PHASE 2: Only merge items that are BOTH very short (<65 chars) — 
      // these are typically step labels without enough pedagogical substance alone
      const phase2: string[] = [];
      let i = 0;
      while (i < phase1.length) {
        const current = phase1[i].replace(/[.\s]+$/, "").trim();
        if (i + 1 < phase1.length) {
          const next = phase1[i + 1].replace(/[.\s]+$/, "").trim();
          // Only merge two genuinely tiny items that can't stand alone as bullets
          if (current.length < 65 && next.length < 65) {
            phase2.push(ensureSentenceEnd(`${current}. ${next}`));
            i += 2;
            continue;
          }
        }
        phase2.push(ensureSentenceEnd(current));
        i++;
      }

      // PHASE 3: Keep 4-5 items for a real process feel — never over-compact.
      // Fewer than 4 items loses the "process/flow" visual identity.
      const maxProcessItems = rawItems.length <= 1 ? 4 : 5;
      const compacted = phase2.length > maxProcessItems
        ? mergeAdjacentShortest(phase2, maxProcessItems)
        : phase2;

      validItems = compacted;
    // FORCE process_timeline for ALL process sections — never fallback to bullets
      layout = "process_timeline";
    }

    // Additional merge for summary/applications — only merge truly tiny fragments
    if ((section.pedagogicalType === "summary" || section.pedagogicalType === "applications") && validItems.length > 1) {
      const merged: string[] = [];
      let i = 0;
      while (i < validItems.length) {
        if (i + 1 < validItems.length && validItems[i].length < 55 && validItems[i + 1].length < 55) {
          merged.push(ensureSentenceEnd(`${validItems[i].replace(/\.\s*$/, "")}. ${validItems[i + 1]}`));
          i += 2;
        } else {
          merged.push(validItems[i]);
          i++;
        }
      }
      validItems = merged;
    }

    // Example sections: consolidate and structure practical example blocks
    if (section.pedagogicalType === "example" && validItems.length > 0) {
      // Step 1: Normalize all items through residual text cleanup
      let normalizedExamples = validItems
        .map((item) => normalizeResidualText(item))
        .filter(Boolean);

      const normalizeLabelKey = (label: string) =>
        label
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, "")
          .replace(/\s+/g, " ")
          .trim();

      const isImperativeAction = (content: string) => {
        return /^(Sugira|Inclua|Defina|Liste|Escreva|Crie|Aplique|Use|Elabore|Estruture|Compare|Avalie|Gere|Selecione|Descreva|Proponha)\b/i.test(content.trim());
      };

      const toCanonicalLabel = (rawLabel: string, content: string, hasAction: boolean): string => {
        const key = normalizeLabelKey(rawLabel);
        if (["cenario", "contexto", "desafio", "acao", "solucao", "resultado", "impacto", "beneficio"].includes(key)) {
          if (key === "resultado" && isImperativeAction(content)) {
            return hasAction ? "Solução" : "Ação";
          }
          const map: Record<string, string> = {
            cenario: "Cenário",
            contexto: "Contexto",
            desafio: "Desafio",
            acao: "Ação",
            solucao: "Solução",
            resultado: "Resultado",
            impacto: "Impacto",
            beneficio: "Benefício",
          };
          return map[key] || rawLabel;
        }
        if (/^necessidade( do negocio)?$/.test(key)) return "Desafio";
        if (/^ferramenta( escolhida)?$/.test(key)) return "Solução";
        if (/^prompt( para ia)?$/.test(key)) return "Ação";
        if (/^resultado esperado$/.test(key)) return "Resultado";
        if (/^(relevancia|facilidade|custo|criterios aplicados?)$/.test(key)) return "__criteria__";
        return rawLabel;
      };

      // Step 2: Universal label detection — ANY "Label: content" pattern
      const ANY_LABEL = /^([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][a-záàâãéêíóôõúüç]+(?:\s+[A-Za-záàâãéêíóôõúüç]+){0,3})\s*:\s*(.+)$/;

      const labelBuckets = new Map<string, string[]>();
      const nonLabeled: string[] = [];
      const criteriaEntries: string[] = [];

      for (const item of normalizedExamples) {
        const labelMatch = item.match(ANY_LABEL);
        if (labelMatch) {
          const rawLabel = labelMatch[1].trim();
          const content = labelMatch[2].replace(/\.\s*$/, "").trim();
          const hasAction = labelBuckets.has("Ação");
          const canonicalLabel = toCanonicalLabel(rawLabel, content, hasAction);

          if (canonicalLabel === "__criteria__") {
            criteriaEntries.push(`${rawLabel}: ${content}`);
            continue;
          }

          if (!labelBuckets.has(canonicalLabel)) {
            labelBuckets.set(canonicalLabel, []);
          }

          // Strengthen prompt closure when label is prompt/action and content is too abrupt.
          if (/^Ação$/i.test(canonicalLabel) && /^Prompt\s+para\s+IA\b/i.test(rawLabel)) {
            const closed = /[.!?]$/.test(content)
              ? content
              : `${content}. Adapte o prompt ao contexto do caso`;
            labelBuckets.get(canonicalLabel)!.push(closed);
          } else {
            labelBuckets.get(canonicalLabel)!.push(content);
          }
        } else {
          nonLabeled.push(item);
        }
      }

      // Step 3: Rebuild items — one per label, merging duplicates.
      const coreItems: string[] = [];
      const CANONICAL_ORDER = ["Cenário", "Contexto", "Desafio", "Ação", "Solução", "Resultado", "Impacto", "Benefício"];

      for (const canonical of CANONICAL_ORDER) {
        const bucket = labelBuckets.get(canonical);
        if (bucket && bucket.length > 0) {
          const merged = bucket.join(". ").replace(/\.\s*\./g, ".").trim();
          coreItems.push(ensureSentenceEnd(`${canonical}: ${merged}`));
          labelBuckets.delete(canonical);
        }
      }

      // Remaining labels (if any) still get consolidated in one criteria block when multiple
      const extendedEntries: string[] = [...criteriaEntries];
      for (const [label, bucket] of labelBuckets) {
        const merged = bucket.join(". ").replace(/\.\s*\./g, ".").trim();
        extendedEntries.push(`${label}: ${merged}`);
      }
      if (extendedEntries.length >= 2) {
        const consolidated = extendedEntries.map((e) => e.replace(/\.\s*$/, "")).join("; ");
        coreItems.push(ensureSentenceEnd(`Critérios Aplicados: ${consolidated}`));
      } else if (extendedEntries.length === 1) {
        coreItems.push(ensureSentenceEnd(extendedEntries[0]));
      }

      // Step 5: Absorb or label unlabeled items
      const getUsedLabels = () => coreItems.map((ci) => {
        const colonIdx = ci.indexOf(":");
        return colonIdx > 0 ? ci.substring(0, colonIdx).trim() : "";
      });
      const FALLBACK_LABELS = ["Contexto", "Desafio", "Solução", "Implementação", "Resultado"];

      for (const unlabeled of nonLabeled) {
        const bare = unlabeled.replace(/[.\s]+$/, "").trim();
        if (bare.length < 80 && coreItems.length > 0) {
          const resultIdx = coreItems.findIndex((ci) => /^Resultado:/i.test(ci));
          const targetIdx = resultIdx >= 0 ? resultIdx : coreItems.length - 1;
          const prev = coreItems[targetIdx].replace(/[.\s]+$/, "").trim();
          coreItems[targetIdx] = ensureSentenceEnd(`${prev}. ${unlabeled}`);
        } else {
          const usedLabels = getUsedLabels();
          const availableLabel = FALLBACK_LABELS.find((l) => !usedLabels.includes(l)) || "Detalhe";
          coreItems.push(ensureSentenceEnd(`${availableLabel}: ${bare}`));
        }
      }

      // Step 5b: Ensure minimum 3 phases — synthesize labels if too few
      if (coreItems.length < 3) {
        const usedLabels = new Set(getUsedLabels());
        for (const item of normalizedExamples) {
          if (coreItems.length >= 3) break;
          const colonIdx = item.indexOf(":");
          if (colonIdx > 0) continue;
          const nextLabel = FALLBACK_LABELS.find((l) => !usedLabels.has(l));
          if (nextLabel) {
            usedLabels.add(nextLabel);
            coreItems.push(ensureSentenceEnd(`${nextLabel}: ${item.replace(/[.\s]+$/, "").trim()}`));
          }
        }
      }

      // Step 6: Cap at 5 items for premium case-study layout (5 phases)
      validItems = coreItems.slice(0, 5);
    }

    if (validItems.length === 0) {
      // Skip empty sections entirely — don't create slides with only the title as content
      report.warnings.push(`Skipped empty section: "${section.title}"`);
      continue;
    }

    const chunks = rebalanceChunksForSemanticIntegrity(
      redistributeOverflow(validItems, maxItems, maxChars, report),
      report,
    );

    for (let ci = 0; ci < chunks.length; ci++) {
      const isContination = ci > 0;

      let finalItems = chunks[ci].map((item) => {
        if (item.length > maxChars) {
          return smartTruncate(item, maxChars);
        }
        return item;
      });

      // Final sentence integrity pass on every item before rendering
      finalItems = finalItems
        .map((item) => {
          if (!isSentenceComplete(item.replace(/\.\s*$/, ""))) {
            return repairSentence(item);
          }
          return item;
        })
        .filter((item) => item.replace(/[.\s]+$/, "").trim().length >= 8);

      // Skip any slide (including first) with no meaningful items
      if (finalItems.length === 0) {
        report.warnings.push(`Dropped slide with no valid items: "${section.title}"`);
        continue;
      }

      // A slide must have meaningful content — not just a title with 1 weak bullet
      if (!hasMeaningfulContent(finalItems)) {
        // Try to fold into previous slide
        const prev = slides[slides.length - 1];
        if (prev && prev.items) {
          prev.items = [...prev.items, ...finalItems].filter(
            (item) => item.replace(/[.\s]+$/, "").trim().length >= 8,
          );
          report.warnings.push(`Merged weak slide into previous: "${section.title}" (${isContination ? "continuation" : "first"})`);
          continue;
        }
        // If no previous slide to merge into and content is truly empty, drop
        if (finalItems.length === 0) {
          report.warnings.push(`Dropped empty slide: "${section.title}"`);
          continue;
        }
        // Otherwise let it through — it's the very first slide and has some content
      }

      const slideTitle = isContination
        ? section.title  // Keep clean title — continuation shown via dot indicator in sectionLabel
        : section.title;

      const sectionLabelFinal = isContination
        ? `${section.sectionLabel}  ·  ${ci + 1}/${chunks.length}`
        : section.sectionLabel;

      slides.push({
        layout,
        title: slideTitle,
        sectionLabel: sectionLabelFinal,
        items: finalItems,
        moduleIndex,
        continuationOf: isContination ? section.title : undefined,
      });
    }
  }

  return slides;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 7: STAGE 4 — RENDER (SlidePlans → PptxGenJS slides)
// ═══════════════════════════════════════════════════════════════════

let _globalSlideIdx = 0;
let _globalSlideNumber = 0;   // current rendered slide number (for footer)
let _globalTotalSlides = 0;   // total planned slides (set before render loop)
let _globalFooterBrand: string | null = "EduGenAI"; // set from design config

function addSlideBackground(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  color: string,
) {
  slide.background = { fill: color };
}

function addHR(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  x: number, y: number, w: number, color: string, h = 0.028,
) {
  slide.addShape("rect" as any, { x, y, w, h, fill: { color } });
}

function addGradientBar(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  x: number, y: number, w: number, h: number,
  color: string, direction: "right" | "down" = "right",
) {
  const steps = 6;
  if (direction === "right") {
    const stepW = w / steps;
    for (let i = 0; i < steps; i++) {
      slide.addShape("rect" as any, {
        x: x + i * stepW, y, w: stepW + 0.01, h,
        fill: { color },
        transparency: Math.floor(i * (70 / steps)),
      });
    }
  } else {
    const stepH = h / steps;
    for (let i = 0; i < steps; i++) {
      slide.addShape("rect" as any, {
        x, y: y + i * stepH, w, h: stepH + 0.01,
        fill: { color },
        transparency: Math.floor(i * (70 / steps)),
      });
    }
  }
}

function addCardShadow(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  x: number, y: number, w: number, h: number,
  shadowColor: string,
) {
  slide.addShape("roundRect" as any, {
    x: x + 0.03, y: y + 0.04,
    w, h,
    fill: { color: shadowColor },
    transparency: 88,
    rectRadius: 0.10,
  });
}

function addLeftEdge(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  color: string,
) {
  slide.addShape("rect" as any, {
    x: 0, y: 0, w: 0.07, h: SLIDE_H,
    fill: { color },
  });
  slide.addShape("rect" as any, {
    x: 0.07, y: 0, w: 0.02, h: SLIDE_H,
    fill: { color },
    transparency: 50,
  });
}

function addSectionLabel(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  label: string,
  accentColor: string,
  fontBody: string,
) {
  slide.addText(label.toUpperCase(), {
    x: 0.55, y: 0.28,
    w: 6.0, h: 0.24,
    fontSize: 9,
    fontFace: fontBody,
    bold: true,
    color: accentColor,
    charSpacing: 5.5,
  });
  addHR(slide, 0.55, 0.54, 0.70, accentColor, 0.024);
}

function addSlideTitle(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  title: string,
  colors: ReturnType<typeof getColors>,
  fontTitle: string,
  accentColor?: string,
) {
  slide.addText(title, {
    x: 0.55, y: 0.64,
    w: SLIDE_W - 1.10,
    h: 0.85,
    fontSize: TYPO.SECTION_TITLE,
    fontFace: fontTitle,
    bold: true,
    color: colors.text,
    valign: "middle",
    lineSpacingMultiple: 1.05,
  });
  if (accentColor) {
    addHR(slide, 0.55, 1.52, SLIDE_W - 1.10, accentColor, 0.008);
    addHR(slide, 0.55, 1.54, SLIDE_W - 1.10, colors.divider, 0.004);
  }
}

function addFooter(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  colors: ReturnType<typeof getColors>,
  fontBody: string,
  slideNumber?: number,
  totalSlides?: number,
  footerBrand?: string | null,
) {
  addGradientBar(slide, 0, SLIDE_H - 0.28, SLIDE_W, 0.005, colors.p0, "right");
  addHR(slide, 0, SLIDE_H - 0.275, SLIDE_W, colors.divider, 0.003);

  // Slide number (left side)
  if (slideNumber !== undefined && totalSlides !== undefined) {
    slide.addText(`${slideNumber} / ${totalSlides}`, {
      x: 0.55, y: SLIDE_H - 0.24,
      w: 1.20, h: 0.20,
      fontSize: 8,
      fontFace: fontBody,
      color: colors.textSecondary,
      align: "left",
      valign: "middle",
    });
  }

  // Brand (right side) — only if footerBrand is non-null
  if (footerBrand) {
    slide.addText(footerBrand, {
      x: SLIDE_W - 1.80, y: SLIDE_H - 0.24,
      w: 1.50, h: 0.20,
      fontSize: 8,
      fontFace: fontBody,
      bold: true,
      color: colors.textSecondary,
      align: "right",
      valign: "middle",
      charSpacing: 3,
    });
    slide.addShape("ellipse" as any, {
      x: SLIDE_W - 1.92, y: SLIDE_H - 0.18,
      w: 0.08, h: 0.08,
      fill: { color: colors.p0 },
    });
  }
}



const LAYOUT_VISUAL_MAX_ITEMS: Partial<Record<SlideLayoutV2, number>> = {
  bullets: 7,
  two_column_bullets: 10,
  definition: 4,
  grid_cards: 6,
  process_timeline: 4,
  example_highlight: 5,
  warning_callout: 4,
  reflection_callout: 3,
  summary_slide: 6,
  numbered_takeaways: 6,
};

const LAYOUT_VISUAL_MAX_CHARS: Partial<Record<SlideLayoutV2, number>> = {
  bullets: 200,
  two_column_bullets: 180,
  definition: 160,
  grid_cards: 140,
  process_timeline: 120,
  example_highlight: 180,
  warning_callout: 170,
  reflection_callout: 140,
  summary_slide: 500,
  numbered_takeaways: 140,
};

function estimateTextHeightInches(
  text: string,
  fontSize: number,
  boxW: number,
  lineSpacing = 1.25,
): number {
  const clean = sanitize(text || "");
  if (!clean) return 0;

  const boxWidthPt = Math.max(boxW * 72, 24);
  const avgCharWidthPt = Math.max(fontSize * 0.52, 1);
  const charsPerLine = Math.max(Math.floor(boxWidthPt / avgCharWidthPt), 8);

  const lines = clean
    .split(/\n+/)
    .map((part) => Math.max(1, Math.ceil(part.trim().length / charsPerLine)))
    .reduce((sum, v) => sum + v, 0);

  return (lines * fontSize * lineSpacing) / 72;
}

function fitsTextBox(
  text: string,
  fontSize: number,
  boxW: number,
  boxH: number,
  lineSpacing = 1.25,
  padding = 0.03,
): boolean {
  const needed = estimateTextHeightInches(text, fontSize, boxW, lineSpacing);
  return needed <= Math.max(0, boxH - padding);
}

function stripPartSuffix(title: string): string {
  return sanitize(title).replace(/\s*\(Parte\s+\d+\)\s*$/i, "").trim();
}

function getBulletLayoutMetrics(itemCount: number) {
  const contentY = 1.65;
  const bulletGap = 0.05;
  const contentH = SLIDE_H - contentY - 0.50;
  const rawItemH = (contentH - bulletGap * Math.max(itemCount - 1, 0)) / Math.max(itemCount, 1);
  const itemH = Math.max(0.52, Math.min(1.40, rawItemH));
  return { contentY, bulletGap, contentH, itemH };
}

function visuallyFitsPlan(plan: SlidePlan): boolean {
  const items = plan.items || [];
  if (items.length === 0) return false;

  switch (plan.layout) {
    case "two_column_bullets": {
      const colW = (SAFE_W - 0.40) / 2;
      const halfCount = Math.ceil(items.length / 2);
      const { itemH } = getBulletLayoutMetrics(halfCount);
      return items.every((item) => fitsTextBox(item, TYPO.BULLET_TEXT, colW - 0.30, itemH - 0.05, 1.2));
    }

    case "bullets": {
      const { itemH, bulletGap } = getBulletLayoutMetrics(items.length);
      const sideW = SLIDE_W * 0.35;
      const worstCaseW = SLIDE_W - sideW - 0.35 - 0.45 - 0.18;
      const rBulletGap = items.length >= 7 ? 0.03 : bulletGap;
      const rightH = SLIDE_H - 0.50 - 0.45;
      const rItemH = Math.max(0.45, Math.min(1.20, (rightH - rBulletGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1)));
      const worstItemH = Math.min(itemH, rItemH);
      return items.every((item) => fitsTextBox(item, TYPO.BULLET_TEXT, worstCaseW, worstItemH - 0.05, 1.2));
    }

    case "warning_callout": {
      const contentY = 1.70;
      const itemH = Math.min(0.80, (SLIDE_H - contentY - 0.60) / Math.max(items.length, 1));
      return items.every((item) => fitsTextBox(item, TYPO.BULLET_TEXT, SAFE_W - 0.55, itemH - 0.05, 1.2));
    }

    case "reflection_callout": {
      const contentY = 1.90;
      const itemH = Math.min(1.00, (SLIDE_H - contentY - 0.60) / Math.max(items.length, 1));
      return items.every((item) => fitsTextBox(item, TYPO.BODY_LARGE, SAFE_W - 0.60, itemH - 0.10, 1.2));
    }

    case "numbered_takeaways": {
      const contentY = 1.70;
      const contentH = SLIDE_H - contentY - 0.60;
      const itemH = Math.min(0.65, contentH / Math.max(items.length, 1));
      return items.every((item) => fitsTextBox(item, TYPO.TAKEAWAY_BODY, SAFE_W - 0.60, itemH - 0.05, 1.2));
    }

    case "summary_slide": {
      const bodyText = items.join(" ");
      return fitsTextBox(bodyText, TYPO.BODY, SAFE_W - 0.60, SLIDE_H - 1.90 - 0.80, 1.3);
    }

    case "definition": {
      if (!fitsTextBox(items[0] || "", TYPO.BODY_LARGE, SAFE_W - 0.40, 0.80, 1.2)) return false;
      const pillars = items.slice(1);
      if (pillars.length === 0) return true;
      const pillarW = (SAFE_W - 0.30 * (pillars.length - 1)) / pillars.length;
      return pillars.every((item) => fitsTextBox(item, TYPO.CARD_BODY, pillarW, 1.20, 1.2));
    }

    case "grid_cards": {
      const cols = items.length <= 3 ? items.length : items.length <= 4 ? 2 : 3;
      if (cols <= 0) return false;
      const rows = Math.ceil(items.length / cols);
      const gap = 0.20;
      const cardW = (SAFE_W - gap * (cols - 1)) / cols;
      const contentArea = SLIDE_H - 1.70 - 0.60;
      const cardH = (contentArea - gap * (rows - 1)) / rows;

      return items.every((item) => {
        const colonIdx = item.indexOf(":");
        if (colonIdx > 0 && colonIdx < 40) {
          const label = item.substring(0, colonIdx).trim();
          const desc = item.substring(colonIdx + 1).trim();
          return (
            fitsTextBox(label, TYPO.CARD_TITLE, cardW - 0.30, 0.35, 1.1) &&
            fitsTextBox(desc, TYPO.CARD_BODY, cardW - 0.30, cardH - 0.65, 1.2)
          );
        }
        return fitsTextBox(item, TYPO.CARD_BODY, cardW - 0.30, cardH - 0.30, 1.2);
      });
    }

    case "process_timeline": {
      // Vertical timeline handles up to 7 items; horizontal up to 4.
      // Always accept — the renderer adapts layout dynamically.
      if (items.length <= 7) return true;
      // For 8+ items, check if text fits in compact vertical cards
      const stepH = Math.min(0.70, (SLIDE_H - 1.65 - 0.38) / items.length);
      return items.every((item) => fitsTextBox(item, TYPO.BULLET_TEXT - 1, SAFE_W - 1.20, stepH - 0.06, 1.15));
    }

    case "example_highlight": {
      const capped = items.slice(0, 5);
      return capped.every((item, i) => {
        const colonIdx = item.indexOf(":");
        const label = colonIdx > 0 && colonIdx < 35
          ? item.substring(0, colonIdx).trim()
          : ["Contexto", "Desafio", "Solução", "Implementação", "Resultado"][i] || `Fase ${i + 1}`;
        const desc = colonIdx > 0 ? item.substring(colonIdx + 1).trim() : item;
        return (
          fitsTextBox(label, TYPO.CARD_TITLE, 2.00, 0.30, 1.1) &&
          fitsTextBox(desc, TYPO.BODY, SAFE_W - 1.20, 0.65, 1.2)
        );
      });
    }

    default:
      return true;
  }
}

function enforceVisualRenderingGuards(
  modulePlans: SlidePlan[],
  design: DesignConfig,
  report: PipelineReport,
): SlidePlan[] {
  const adjusted: SlidePlan[] = [];

  for (const plan of modulePlans) {
    if (plan.layout === "module_cover" || plan.layout === "comparison_table" || !plan.items || plan.items.length === 0) {
      adjusted.push(plan);
      continue;
    }

    const baseTitle = stripPartSuffix(plan.continuationOf || plan.title);
    const maxItems = LAYOUT_VISUAL_MAX_ITEMS[plan.layout] || design.density.maxItemsPerSlide;
    const maxChars = LAYOUT_VISUAL_MAX_CHARS[plan.layout] || design.density.maxCharsPerItem;

    const normalizedItems = plan.items
      .flatMap((item) => splitLongItem(item, maxChars))
      .map((item) => ensureSentenceEnd(repairSentence(item)))
      .filter((item) => item.replace(/[.\s]+$/, "").trim().length >= 8);

    if (normalizedItems.length === 0) {
      report.warnings.push(`[VISUAL] Dropped plan without renderable items: "${plan.title}"`);
      continue;
    }

    const initialChunks = redistributeOverflow(normalizedItems, maxItems, maxChars, report)
      .map((chunk) => chunk.filter((item) => item.replace(/[.\s]+$/, "").trim().length >= 8))
      .filter((chunk) => chunk.length > 0);

    const queue: SlidePlan[] = initialChunks.map((chunk) => ({ ...plan, items: chunk, title: baseTitle }));
    const fitted: SlidePlan[] = [];
    let guard = 0;

    while (queue.length > 0 && guard < 100) {
      guard++;
      const current = queue.shift()!;
      const currentItems = current.items || [];
      if (currentItems.length === 0) continue;

      if (visuallyFitsPlan(current)) {
        fitted.push(current);
        continue;
      }

      // Process slides: NEVER fragment process_timeline into tiny splits.
      // Force vertical timeline which handles up to 7 items natively.
      if (
        current.layout === "process_timeline" &&
        currentItems.length <= 7
      ) {
        // Always fits vertical timeline — push directly
        fitted.push(current);
        continue;
      }
      if (
        current.layout === "process_timeline" &&
        currentItems.length > 7
      ) {
        // Split into two balanced halves, both as process_timeline
        const mid = Math.ceil(currentItems.length / 2);
        report.redistributions++;
        report.warnings.push(`[VISUAL] Split large process into 2 timeline slides: "${baseTitle}"`);
        queue.unshift(
          { ...current, items: currentItems.slice(mid), title: `${baseTitle} (cont.)` },
          { ...current, items: currentItems.slice(0, mid) },
        );
        continue;
      }

      if (currentItems.length > 1) {
        const mid = Math.ceil(currentItems.length / 2);
        report.redistributions++;
        report.warnings.push(`[VISUAL] Split by visual overflow: "${baseTitle}"`);
        queue.unshift(
          { ...current, items: currentItems.slice(mid) },
          { ...current, items: currentItems.slice(0, mid) },
        );
        continue;
      }

      if (current.layout !== "bullets") {
        const fallback = { ...current, layout: "bullets" as SlideLayoutV2 };
        if (visuallyFitsPlan(fallback)) {
          report.warnings.push(`[VISUAL] Fallback to bullets for fit: "${baseTitle}"`);
          fitted.push(fallback);
          continue;
        }
      }

      const single = currentItems[0];
      const forcedParts = splitLongItem(single, Math.max(48, Math.floor(maxChars * 0.7)));
      if (forcedParts.length > 1) {
        report.redistributions++;
        report.warnings.push(`[VISUAL] Forced re-split long item: "${baseTitle}"`);
        queue.unshift(...forcedParts.map((part) => ({ ...current, items: [part] })));
        continue;
      }

      report.warnings.push(`[VISUAL] Dropped non-fitting item after safeguards: "${single.substring(0, 50)}..."`);
    }

    for (let i = 0; i < fitted.length; i++) {
      const partTitle = i === 0 ? baseTitle : `${baseTitle} (Parte ${i + 1})`;
      adjusted.push({
        ...fitted[i],
        title: partTitle,
        continuationOf: i === 0 ? plan.continuationOf : baseTitle,
      });
    }
  }

  return adjusted;
}

// ═══════════════════════════════════════════════════════════════════
// PREMIUM RENDER FUNCTIONS — v2 Editorial Visual Engine (Premium Redesign R4)
// ═══════════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────────
// COVER HERO PREMIUM — Full-bleed cinematic with overlay + decorative numbers
// ────────────────────────────────────────────────────────────────
function renderCoverSlide(
  pptx: PptxGenJS,
  courseTitle: string,
  design: DesignConfig,
  image?: SlideImage | null,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();

  if (image) {
    try {
      slide.addImage({ data: image.base64Data, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
      console.log(`[V2-RENDER] Cover: addImage OK, dataLen=${image.base64Data.length}`);
    } catch (err: any) {
      console.error("[V2-RENDER] Cover addImage FAILED:", err.message);
      addSlideBackground(slide, colors.coverDark);
    }
  } else {
    addSlideBackground(slide, colors.coverDark);
  }

  // Only add large decorative gradient/ellipse when there's no image (they obscure the photo)
  if (!image) {
    addGradientBar(slide, SLIDE_W * 0.50, 0, SLIDE_W * 0.55, SLIDE_H, colors.p0, "down");

    slide.addShape("ellipse" as any, {
      x: SLIDE_W * 0.55, y: -SLIDE_H * 0.35,
      w: SLIDE_W * 0.70, h: SLIDE_W * 0.70,
      fill: { color: colors.p1 },
      transparency: 92,
    });
  }

  slide.addShape("rect" as any, {
    x: 0.80, y: 0.90, w: 0.035, h: SLIDE_H - 1.80,
    fill: { color: colors.p0 },
    transparency: 30,
  });

  if (!image) {
    for (let b = 0; b < 5; b++) {
      slide.addShape("roundRect" as any, {
        x: 0.28, y: 1.10 + b * 0.30,
        w: 0.32, h: 0.18,
        fill: { color: design.palette[b % design.palette.length] },
        transparency: 15,
        rectRadius: 0.04,
      });
    }
  }

  addHR(slide, 1.20, 1.30, 3.50, colors.p0, 0.018);

  slide.addText(design.courseType || "CURSO COMPLETO", {
    x: 1.20, y: 1.55,
    w: 5.0, h: 0.28,
    fontSize: 10,
    fontFace: design.fonts.body,
    bold: true,
    color: colors.p0,
    charSpacing: 8,
  });

  slide.addText(courseTitle, {
    x: 1.20, y: 2.00,
    w: SLIDE_W * 0.52,
    h: 3.30,
    fontSize: 52,
    fontFace: design.fonts.title,
    bold: true,
    color: "FFFFFF",
    valign: "top",
    lineSpacingMultiple: 0.96,
  });

  addGradientBar(slide, 1.20, 5.50, 3.00, 0.07, colors.p0, "right");

  if (!image) {
    for (let i = 0; i < 3; i++) {
      const sz = 0.50 + i * 0.35;
      slide.addShape("roundRect" as any, {
        x: SLIDE_W - 2.60 + i * 0.55,
        y: 0.40 + i * 0.90,
        w: sz, h: sz,
        fill: { color: design.palette[i % design.palette.length] },
        transparency: 82,
        rectRadius: 0.06,
      });
    }
  }

  slide.addShape("ellipse" as any, {
    x: 1.20, y: 5.82, w: 0.12, h: 0.12,
    fill: { color: colors.p0 },
  });

  addHR(slide, 1.20, SLIDE_H - 1.20, 3.00, colors.p0, 0.012);

  // PT-BR formatted date (e.g. "março de 2026")
  const dateStr = new Intl.DateTimeFormat("pt-BR", { year: "numeric", month: "long" }).format(new Date());
  slide.addText(dateStr, {
    x: SLIDE_W - 3.00, y: SLIDE_H - 0.65,
    w: 2.60, h: 0.30,
    fontSize: 10,
    fontFace: design.fonts.body,
    color: colors.coverSubtext,
    align: "right",
    charSpacing: 2.5,
  });

  if (image) {
    addImageCredit(slide, image.credit, design);
  }
  // Engine version removed — not visible in commercial output
}

// ────────────────────────────────────────────────────────────────
// TOC PREMIUM — Card grid (2-3 columns) with large numbered indicators
// ────────────────────────────────────────────────────────────────
function renderTOC(
  pptx: PptxGenJS,
  modules: { title: string; description?: string }[],
  design: DesignConfig,
) {
  const colors = getColors(design);
  // For ≤6 modules: 1 page, 2 or 3 columns. For >6: paginate.
  const MAX_PER_PAGE = 6;
  const pages: { title: string; description?: string }[][] = [];
  for (let i = 0; i < modules.length; i += MAX_PER_PAGE) {
    pages.push(modules.slice(i, i + MAX_PER_PAGE));
  }

  for (let page = 0; page < pages.length; page++) {
    const pageModules = pages[page];
    const slide = pptx.addSlide();
    addSlideBackground(slide, colors.coverDark);

    // ── Top accent line ──
    addHR(slide, 0, 0.03, SLIDE_W, colors.p0, 0.045);

    // ── Header area ──
    slide.addText("CONTEÚDO PROGRAMÁTICO", {
      x: 0.65, y: 0.32,
      w: 6.0, h: 0.24,
      fontSize: 10,
      fontFace: design.fonts.body,
      bold: true,
      color: colors.p0,
      charSpacing: 6,
    });
    slide.addText(pages.length > 1 ? `Índice  ·  ${page + 1}/${pages.length}` : "Índice", {
      x: 0.65, y: 0.62,
      w: 8.0, h: 0.60,
      fontSize: 32,
      fontFace: design.fonts.title,
      bold: true,
      color: "FFFFFF",
      valign: "middle",
    });
    addHR(slide, 0.65, 1.30, 2.00, colors.p0, 0.030);

    // ── Progress bar (full width) ──
    const progressY = 1.50;
    slide.addShape("rect" as any, {
      x: 0.65, y: progressY,
      w: SLIDE_W - 1.30, h: 0.04,
      fill: { color: colors.panelMid },
    });
    const progressFill = ((page + 1) / pages.length);
    slide.addShape("rect" as any, {
      x: 0.65, y: progressY,
      w: (SLIDE_W - 1.30) * progressFill, h: 0.04,
      fill: { color: colors.p0 },
    });

    // ── Card grid ──
    const globalOffset = page * MAX_PER_PAGE;
    const cols = pageModules.length <= 3 ? pageModules.length : pageModules.length <= 4 ? 2 : 3;
    const rows = Math.ceil(pageModules.length / cols);
    const gap = 0.18;
    const gridX = 0.65;
    const gridW = SLIDE_W - 1.30;
    const cardW = (gridW - gap * (cols - 1)) / cols;
    const gridY = 1.80;
    const gridH = SLIDE_H - gridY - 0.30;
    const cardH = Math.min(2.50, (gridH - gap * (rows - 1)) / rows);

    for (let i = 0; i < pageModules.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = gridX + col * (cardW + gap);
      const y = gridY + row * (cardH + gap);
      const pal = design.palette[(globalOffset + i) % design.palette.length];
      const num = String(globalOffset + i + 1).padStart(2, "0");

      slide.addShape("roundRect" as any, {
        x: x + 0.02, y: y + 0.03,
        w: cardW, h: cardH,
        fill: { color: "000000" },
        transparency: 70,
        rectRadius: 0.12,
      });
      slide.addShape("roundRect" as any, {
        x, y, w: cardW, h: cardH,
        fill: { color: colors.panelMid },
        rectRadius: 0.12,
      });

      slide.addShape("rect" as any, {
        x, y, w: 0.05, h: cardH,
        fill: { color: pal },
        rectRadius: 0.12,
      });

      const badgeS = Math.min(0.44, cardH * 0.25);
      slide.addShape("roundRect" as any, {
        x: x + 0.14, y: y + 0.14,
        w: badgeS, h: badgeS,
        fill: { color: pal },
        rectRadius: 0.08,
      });
      slide.addText(num, {
        x: x + 0.14, y: y + 0.14,
        w: badgeS, h: badgeS,
        fontSize: Math.min(18, badgeS * 38),
        fontFace: design.fonts.title,
        bold: true,
        color: "FFFFFF",
        align: "center",
        valign: "middle",
      });

      const titleY = y + 0.14 + badgeS + 0.08;
      const titleH = Math.min(0.48, (cardH - badgeS - 0.36) * 0.45);
      slide.addText(pageModules[i].title, {
        x: x + 0.14, y: titleY,
        w: cardW - 0.28, h: titleH,
        fontSize: cardH < 1.4 ? 12 : 14,
        fontFace: design.fonts.title,
        bold: true,
        color: "FFFFFF",
        valign: "top",
        lineSpacingMultiple: 1.06,
      });

      const sepY = titleY + titleH + 0.04;
      addHR(slide, x + 0.14, sepY, cardW * 0.45, pal, 0.010);

      if (pageModules[i].description) {
        const descY = sepY + 0.06;
        const descH = Math.max(0.20, y + cardH - descY - 0.12);
        slide.addText(pageModules[i].description!, {
          x: x + 0.14, y: descY,
          w: cardW - 0.28, h: descH,
          fontSize: cardH < 1.4 ? 9 : 11,
          fontFace: design.fonts.body,
          color: colors.coverSubtext,
          valign: "top",
          lineSpacingMultiple: 1.18,
        });
      }

      slide.addShape("ellipse" as any, {
        x: x + cardW - 0.26, y: y + cardH - 0.22,
        w: 0.08, h: 0.08,
        fill: { color: pal },
        transparency: 40,
      });
    }
  }
}

// ────────────────────────────────────────────────────────────────
// MODULE COVER — Giant number watermark + geometric decoration
// ────────────────────────────────────────────────────────────────
function renderModuleCover(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
  image?: SlideImage | null,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  const modIdx = (plan.moduleIndex ?? 0);
  const modNum = String(modIdx + 1).padStart(2, "0");
  const accentColor = design.palette[modIdx % design.palette.length];

  const hasImage = !!image;
  const contentW = hasImage ? SLIDE_W * 0.62 : SLIDE_W;

  addSlideBackground(slide, colors.coverDark);

  if (hasImage) {
    const imgX = contentW;
    const imgW = SLIDE_W - contentW;
    try {
      slide.addImage({
        data: image!.base64Data,
        x: imgX, y: 0, w: imgW, h: SLIDE_H,
      });
      console.log(`[V2-RENDER] Module cover: addImage at x=${imgX}, w=${imgW}, dataLen=${image!.base64Data.length}`);
      console.log(`[V2-RENDER] Module cover: addImage + overlay at x=${imgX}, w=${imgW}, dataLen=${image!.base64Data.length}`);
    } catch (imgErr: any) {
      console.error(`[V2-RENDER] Module cover: addImage FAILED:`, imgErr.message);
    }
    slide.addShape("rect" as any, {
      x: imgX, y: 0, w: 0.04, h: SLIDE_H,
      fill: { color: accentColor },
    });
    addImageCredit(slide, image!.credit, design);
  }

  addGradientBar(slide, contentW * 0.60, 0, contentW * 0.45, SLIDE_H, accentColor, "down");

  if (!hasImage) {
    slide.addText(modNum, {
      x: contentW - 5.0, y: SLIDE_H - 4.50,
      w: 5.0, h: 4.50,
      fontSize: 200,
      fontFace: design.fonts.title,
      bold: true,
      color: accentColor,
      transparency: 90,
      align: "right",
      valign: "bottom",
    });
  }

  if (!hasImage) {
    slide.addShape("ellipse" as any, {
      x: contentW - 3.00, y: -0.60,
      w: 3.50, h: 3.50,
      fill: { color: accentColor },
      transparency: 90,
    });
    slide.addShape("ellipse" as any, {
      x: contentW - 1.80, y: 0.65,
      w: 0.16, h: 0.16,
      fill: { color: accentColor },
      transparency: 20,
    });
  }

  slide.addShape("rect" as any, {
    x: 0.80, y: 1.10, w: 0.05, h: 2.30,
    fill: { color: accentColor },
  });
  slide.addShape("rect" as any, {
    x: 0.88, y: 1.10, w: 0.015, h: 2.30,
    fill: { color: accentColor },
    transparency: 50,
  });

  slide.addText(`MÓDULO ${modNum}`, {
    x: 1.10, y: 1.20,
    w: 5.0, h: 0.28,
    fontSize: 11,
    fontFace: design.fonts.body,
    bold: true,
    color: accentColor,
    charSpacing: 8,
  });

  addHR(slide, 1.10, 1.62, 1.40, accentColor, 0.022);

  const titleW = hasImage ? contentW * 0.75 : SLIDE_W * 0.53;
  slide.addText(plan.title, {
    x: 1.10, y: 1.85,
    w: titleW,
    h: 2.50,
    fontSize: 36,
    fontFace: design.fonts.title,
    bold: true,
    color: "FFFFFF",
    valign: "top",
    lineSpacingMultiple: 1.02,
  });

  if (plan.objectives && plan.objectives.length > 0) {
    const objStartY = 4.65;
    const objW = hasImage ? contentW * 0.70 : SLIDE_W * 0.48;
    addHR(slide, 1.10, objStartY - 0.12, 2.20, accentColor, 0.012);
    slide.addText("O QUE VOCÊ VAI APRENDER", {
      x: 1.10, y: objStartY,
      w: 5.0, h: 0.22,
      fontSize: 8,
      fontFace: design.fonts.body,
      bold: true,
      color: accentColor,
      charSpacing: 5,
    });

    for (let i = 0; i < Math.min(plan.objectives.length, 3); i++) {
      const objY = objStartY + 0.32 + i * 0.44;
      slide.addShape("roundRect" as any, {
        x: 1.10, y: objY + 0.05,
        w: 0.12, h: 0.12,
        fill: { color: accentColor },
        rectRadius: 0.02,
      });
      slide.addText(plan.objectives[i], {
        x: 1.35, y: objY,
        w: objW, h: 0.38,
        fontSize: 11,
        fontFace: design.fonts.body,
        color: colors.coverSubtext,
        valign: "middle",
        lineSpacingMultiple: 1.12,
      });
    }
  }

  addGradientBar(slide, 0.80, SLIDE_H - 0.45, 3.50, 0.008, accentColor, "right");
}

// ────────────────────────────────────────────────────────────────
// BULLETS PREMIUM — 4 truly distinct visual compositions
// ────────────────────────────────────────────────────────────────
function renderBullets(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  const variant = _globalSlideIdx % 4;

  const accentColor = design.palette[_globalSlideIdx % design.palette.length];
  const items = plan.items || [];
  const contentX = 0.65;
  const contentW = SLIDE_W - contentX - 0.55;
  const contentY = 1.65;
  const bulletGap = items.length >= 7 ? 0.04 : 0.08;
  const contentH = SLIDE_H - contentY - 0.40;
  const rawItemH = (contentH - bulletGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1);
  const itemH = Math.max(0.48, Math.min(1.30, rawItemH));

  if (variant === 0) {
    // ── VARIANT A: Split layout — dark left sidebar + content right ──
    addSlideBackground(slide, colors.bg);
    const sideW = SLIDE_W * 0.35;
    slide.addShape("rect" as any, {
      x: 0, y: 0, w: sideW, h: SLIDE_H,
      fill: { color: colors.coverDark },
    });
    addGradientBar(slide, 0, 0, sideW, SLIDE_H, accentColor, "down");
    slide.addShape("rect" as any, {
      x: sideW, y: 0, w: 0.05, h: SLIDE_H,
      fill: { color: accentColor },
    });
    slide.addShape("rect" as any, {
      x: sideW + 0.05, y: 0, w: 0.015, h: SLIDE_H,
      fill: { color: accentColor },
      transparency: 50,
    });

    // Section label + title on dark sidebar
    if (plan.sectionLabel) {
      slide.addText(plan.sectionLabel.toUpperCase(), {
        x: 0.45, y: 0.55,
        w: sideW - 0.90, h: 0.22,
        fontSize: 9,
        fontFace: design.fonts.body,
        bold: true,
        color: accentColor,
        charSpacing: 4,
      });
      addHR(slide, 0.45, 0.82, 1.20, accentColor, 0.012);
    }
    slide.addText(plan.title, {
      x: 0.45, y: 1.00,
      w: sideW - 0.90, h: 3.40,
      fontSize: 24,
      fontFace: design.fonts.title,
      bold: true,
      color: "FFFFFF",
      valign: "top",
      lineSpacingMultiple: 1.08,
    });
    // Decorative accent dots on sidebar
    for (let d = 0; d < Math.min(items.length, 5); d++) {
      slide.addShape("ellipse" as any, {
        x: 0.45, y: 4.80 + d * 0.40,
        w: 0.10, h: 0.10,
        fill: { color: design.palette[d % design.palette.length] },
      });
    }

    // Items on right (light) zone with left color accent bar
    const rightX = sideW + 0.35;
    const rightW = SLIDE_W - rightX - 0.45;
    const rightY = 0.50;
    const rightH = SLIDE_H - rightY - 0.45;
    const rBulletGap = items.length >= 7 ? 0.03 : bulletGap;
    const rItemH = Math.max(0.45, Math.min(1.20, (rightH - rBulletGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1)));

    for (let i = 0; i < items.length; i++) {
      const yPos = rightY + i * (rItemH + rBulletGap);
      const pal = design.palette[i % design.palette.length];
      // Left accent bar
      slide.addShape("rect" as any, {
        x: rightX, y: yPos + 0.06,
        w: 0.045, h: rItemH - 0.16,
        fill: { color: pal },
      });
      const aFontSize = items.length >= 6 ? TYPO.BULLET_TEXT - 2 : items.length >= 4 ? TYPO.BULLET_TEXT - 1 : TYPO.BULLET_TEXT;
      slide.addText(items[i], {
        x: rightX + 0.18, y: yPos,
        w: rightW - 0.18, h: rItemH,
        fontSize: aFontSize,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "middle",
        lineSpacingMultiple: 1.18,
        autoFit: true,
      } as any);
      if (i < items.length - 1) {
        addHR(slide, rightX + 0.18, yPos + rItemH + rBulletGap / 2 - 0.003, rightW - 0.18, colors.divider, 0.005);
      }
    }

  } else if (variant === 1) {
    // ── VARIANT B: Full-width cards with colored number badges + shadow ──
    addSlideBackground(slide, colors.bg);
    addLeftEdge(slide, accentColor);
    if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, accentColor, design.fonts.body);
    addSlideTitle(slide, plan.title, colors, design.fonts.title, accentColor);

    for (let i = 0; i < items.length; i++) {
      const pal = design.palette[i % design.palette.length];
      const yPos = contentY + i * (itemH + bulletGap);
      addCardShadow(slide, contentX, yPos, contentW, itemH - 0.04, colors.shadowColor);
      slide.addShape("roundRect" as any, {
        x: contentX, y: yPos,
        w: contentW, h: itemH - 0.04,
        fill: { color: colors.cardBg },
        rectRadius: 0.08,
        line: { color: colors.borders, width: 0.3 },
      });
      slide.addShape("rect" as any, {
        x: contentX, y: yPos,
        w: 0.06, h: itemH - 0.04,
        fill: { color: pal },
        rectRadius: 0.08,
      });
      const badgeSize = Math.min(0.34, itemH - 0.14);
      const badgeFontSize = badgeSize >= 0.30 ? 13 : 10;
      slide.addShape("roundRect" as any, {
        x: contentX + 0.18, y: yPos + (itemH - 0.04) / 2 - badgeSize / 2,
        w: badgeSize, h: badgeSize,
        fill: { color: pal },
        rectRadius: 0.06,
      });
      slide.addText(String(i + 1), {
        x: contentX + 0.18, y: yPos + (itemH - 0.04) / 2 - badgeSize / 2,
        w: badgeSize, h: badgeSize,
        fontSize: badgeFontSize,
        fontFace: design.fonts.title,
        bold: true,
        color: "FFFFFF",
        align: "center",
        valign: "middle",
      });
      const textFontSize = items.length >= 6 ? TYPO.BULLET_TEXT - 2 : TYPO.BULLET_TEXT - 1;
      slide.addText(items[i], {
        x: contentX + 0.18 + badgeSize + 0.14, y: yPos + 0.03,
        w: contentW - badgeSize - 0.42, h: itemH - 0.10,
        fontSize: textFontSize,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "middle",
        lineSpacingMultiple: 1.18,
        autoFit: true,
      } as any);
    }

  } else if (variant === 2) {
    // ── VARIANT C: 2-column card grid with colored left edge + shadow ──
    addSlideBackground(slide, colors.bg);
    addLeftEdge(slide, accentColor);
    if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, accentColor, design.fonts.body);
    addSlideTitle(slide, plan.title, colors, design.fonts.title, accentColor);

    const cols = items.length >= 4 ? 2 : 1;
    const gap = 0.18;
    const cardW = cols === 2 ? (contentW - gap) / 2 : contentW;
    const rows = Math.ceil(items.length / cols);
    const cardH = Math.min(1.50, (contentH - gap * (rows - 1)) / rows);

    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = contentX + col * (cardW + gap);
      const y = contentY + row * (cardH + gap);
      const pal = design.palette[i % design.palette.length];

      addCardShadow(slide, x, y, cardW, cardH, colors.shadowColor);
      slide.addShape("roundRect" as any, {
        x, y, w: cardW, h: cardH,
        fill: { color: colors.cardBg },
        rectRadius: 0.10,
      });
      slide.addShape("rect" as any, {
        x, y, w: 0.06, h: cardH,
        fill: { color: pal },
        rectRadius: 0.10,
      });
      slide.addText(String(i + 1).padStart(2, "0"), {
        x: x + 0.12, y: y + 0.06,
        w: 0.40, h: 0.28,
        fontSize: Math.min(16, cardW > 3 ? 18 : 14),
        fontFace: design.fonts.title,
        bold: true,
        color: ensureContrastOnLight(pal, colors.cardBg),
        transparency: 15,
        align: "left",
      });
      slide.addText(items[i], {
        x: x + 0.14, y: y + 0.38,
        w: cardW - 0.28, h: cardH - 0.48,
        fontSize: TYPO.BULLET_TEXT - 1,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "top",
        lineSpacingMultiple: 1.18,
      });
    }

  } else {
    // ── VARIANT D: Single highlight — first item dominant, rest as compact list ──
    addSlideBackground(slide, colors.bg);
    addLeftEdge(slide, accentColor);
    if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, accentColor, design.fonts.body);
    addSlideTitle(slide, plan.title, colors, design.fonts.title, accentColor);

    if (items.length > 0) {
      // Hero highlight box for first item
      const heroH = items.length === 1 ? contentH : Math.min(1.60, contentH * 0.40);
      slide.addShape("roundRect" as any, {
        x: contentX, y: contentY,
        w: contentW, h: heroH,
        fill: { color: colors.coverDark },
        rectRadius: 0.10,
      });
      // Accent left bar inside hero
      slide.addShape("rect" as any, {
        x: contentX + 0.14, y: contentY + 0.14,
        w: 0.05, h: heroH - 0.28,
        fill: { color: accentColor },
      });
      slide.addText(items[0], {
        x: contentX + 0.32, y: contentY + 0.08,
        w: contentW - 0.48, h: heroH - 0.16,
        fontSize: TYPO.BODY_LARGE,
        fontFace: design.fonts.body,
        color: "FFFFFF",
        valign: "middle",
        lineSpacingMultiple: 1.30,
        italic: true,
        autoFit: true,
      } as any);

      // Remaining items as compact numbered list
      if (items.length > 1) {
        const restY = contentY + heroH + 0.18;
        const restH = SLIDE_H - restY - 0.45;
        const restItemH = Math.min(0.80, (restH - 0.06 * (items.length - 2)) / (items.length - 1));
        for (let i = 1; i < items.length; i++) {
          const yPos = restY + (i - 1) * (restItemH + 0.06);
          const pal = design.palette[i % design.palette.length];
          // Bullet dot
          slide.addShape("ellipse" as any, {
            x: contentX + 0.04, y: yPos + restItemH / 2 - 0.05,
            w: 0.10, h: 0.10,
            fill: { color: pal },
          });
          slide.addText(items[i], {
            x: contentX + 0.22, y: yPos,
            w: contentW - 0.22, h: restItemH,
            fontSize: items.length >= 5 ? TYPO.BULLET_TEXT - 2 : TYPO.BULLET_TEXT - 1,
            fontFace: design.fonts.body,
            color: colors.text,
            valign: "middle",
            lineSpacingMultiple: 1.15,
          });
        }
      }
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ────────────────────────────────────────────────────────────────
// TWO-COLUMN BULLETS PREMIUM — Split with center accent divider
// ────────────────────────────────────────────────────────────────
function renderTwoColumnBullets(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);
  const pal = design.palette[_globalSlideIdx % design.palette.length];
  addLeftEdge(slide, pal);
  if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, pal, design.fonts.body);
  addSlideTitle(slide, plan.title, colors, design.fonts.title, pal);

  const items = plan.items || [];
  const contentX = 0.65;
  const totalW = SLIDE_W - contentX - 0.55;
  const colGap = 0.35;
  const colW = (totalW - colGap) / 2;
  const contentY = 1.68;
  const mid = Math.ceil(items.length / 2);
  const leftItems = items.slice(0, mid);
  const rightItems = items.slice(mid);

  // Center divider — thin accent line with dot
  const divX = contentX + colW + colGap / 2;
  slide.addShape("rect" as any, {
    x: divX - 0.010, y: contentY,
    w: 0.020, h: SLIDE_H - contentY - 0.45,
    fill: { color: pal },
    transparency: 50,
  });
  // Center dot on divider
  slide.addShape("ellipse" as any, {
    x: divX - 0.05, y: contentY + (SLIDE_H - contentY - 0.45) / 2 - 0.05,
    w: 0.10, h: 0.10,
    fill: { color: pal },
  });

  for (let col = 0; col < 2; col++) {
    const colItems = col === 0 ? leftItems : rightItems;
    const colX = contentX + col * (colW + colGap);
    const colBulletGap = colItems.length >= 5 ? 0.04 : 0.06;
    const colContentH = SLIDE_H - contentY - 0.40;
    const rawItemH = (colContentH - colBulletGap * Math.max(colItems.length - 1, 0)) / Math.max(colItems.length, 1);
    const itemH = Math.max(0.42, Math.min(1.10, rawItemH));
    for (let i = 0; i < colItems.length; i++) {
      const palColor = design.palette[(col * mid + i) % design.palette.length];
      const yPos = contentY + i * (itemH + colBulletGap);
      addCardShadow(slide, colX, yPos, colW, itemH - 0.02, colors.shadowColor);
      slide.addShape("roundRect" as any, {
        x: colX, y: yPos,
        w: colW, h: itemH - 0.02,
        fill: { color: colors.cardBg },
        rectRadius: 0.06,
      });
      slide.addShape("rect" as any, {
        x: colX, y: yPos,
        w: 0.05, h: itemH - 0.02,
        fill: { color: palColor },
        rectRadius: 0.06,
      });
      const badgeW = 0.30;
      slide.addShape("roundRect" as any, {
        x: colX + 0.14, y: yPos + (itemH - 0.02) / 2 - badgeW / 2,
        w: badgeW, h: badgeW,
        fill: { color: palColor },
        rectRadius: 0.06,
      });
      slide.addText(String(col * mid + i + 1), {
        x: colX + 0.14, y: yPos + (itemH - 0.02) / 2 - badgeW / 2,
        w: badgeW, h: badgeW,
        fontSize: 11,
        fontFace: design.fonts.title,
        bold: true,
        color: "FFFFFF",
        align: "center",
        valign: "middle",
      });
      slide.addText(colItems[i], {
        x: colX + 0.52, y: yPos + 0.03,
        w: colW - 0.60, h: itemH - 0.08,
        fontSize: TYPO.BULLET_TEXT - 1,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "middle",
        lineSpacingMultiple: 1.18,
      });
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ────────────────────────────────────────────────────────────────
// DEFINITION PREMIUM — Hero definition box + pillar cards
// ────────────────────────────────────────────────────────────────
function renderDefinition(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);
  addLeftEdge(slide, colors.p2);
  if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, colors.p2, design.fonts.body);
  addSlideTitle(slide, plan.title, colors, design.fonts.title, colors.p2);

  const items = plan.items || [];
  const contentX = 0.65;
  const contentW = SLIDE_W - contentX - 0.50;

  if (items.length > 0) {
    const heroH = 1.30;
    addCardShadow(slide, contentX, 1.68, contentW, heroH, colors.shadowColor);
    slide.addShape("roundRect" as any, {
      x: contentX, y: 1.68, w: contentW, h: heroH,
      fill: { color: colors.coverDark },
      rectRadius: 0.10,
    });
    slide.addShape("rect" as any, {
      x: contentX, y: 1.68, w: 0.06, h: heroH,
      fill: { color: colors.p2 },
      rectRadius: 0.10,
    });
    slide.addText("\u201C", {
      x: contentX + 0.10, y: 1.58,
      w: 0.50, h: 0.60,
      fontSize: 48,
      fontFace: design.fonts.title,
      color: colors.p2,
      transparency: 25,
      bold: true,
    });
    slide.addText(items[0], {
      x: contentX + 0.30, y: 1.72,
      w: contentW - 0.50, h: heroH - 0.10,
      fontSize: TYPO.BODY_LARGE,
      fontFace: design.fonts.body,
      color: "FFFFFF",
      valign: "middle",
      italic: true,
      lineSpacingMultiple: 1.35,
    });
  }

  const pillars = items.slice(1);
  if (pillars.length > 0) {
    const gap = 0.16;
    const pillarW = (contentW - gap * (pillars.length - 1)) / pillars.length;
    const startY = 3.22;
    for (let i = 0; i < pillars.length; i++) {
      const x = contentX + i * (pillarW + gap);
      const pal = design.palette[i % design.palette.length];
      const pH = SLIDE_H - startY - 0.45;
      addCardShadow(slide, x, startY, pillarW, pH, colors.shadowColor);
      slide.addShape("roundRect" as any, {
        x, y: startY, w: pillarW, h: pH,
        fill: { color: colors.cardBg },
        rectRadius: 0.08,
      });
      slide.addShape("rect" as any, {
        x, y: startY, w: pillarW, h: 0.05,
        fill: { color: pal },
        rectRadius: 0.08,
      });
      slide.addShape("roundRect" as any, {
        x: x + 0.10, y: startY + 0.14,
        w: 0.34, h: 0.34,
        fill: { color: pal },
        rectRadius: 0.06,
      });
      slide.addText(String(i + 2), {
        x: x + 0.10, y: startY + 0.14,
        w: 0.34, h: 0.34,
        fontSize: 15,
        fontFace: design.fonts.title,
        bold: true,
        color: "FFFFFF",
        align: "center",
        valign: "middle",
      });
      slide.addText(pillars[i], {
        x: x + 0.14, y: startY + 0.55,
        w: pillarW - 0.28, h: SLIDE_H - startY - 1.05,
        fontSize: TYPO.CARD_BODY,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "top",
        lineSpacingMultiple: 1.22,
      });
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ────────────────────────────────────────────────────────────────
// GRID CARDS PREMIUM — Cards with colored header zones
// ────────────────────────────────────────────────────────────────
function renderGridCards(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);
  addLeftEdge(slide, colors.p3);
  if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, colors.p3, design.fonts.body);
  addSlideTitle(slide, plan.title, colors, design.fonts.title, colors.p3);

  const items = plan.items || [];
  const contentX = 0.65;
  const contentW = SLIDE_W - contentX - 0.50;
  const cols = items.length <= 3 ? items.length : items.length <= 4 ? 2 : 3;
  const rows = Math.ceil(items.length / cols);
  const gap = 0.18;
  const cardW = (contentW - gap * (cols - 1)) / cols;
  const contentArea = SLIDE_H - 1.68 - 0.45;
  const cardH = Math.min(2.50, (contentArea - gap * (rows - 1)) / rows);

  for (let i = 0; i < items.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = contentX + col * (cardW + gap);
    const y = 1.68 + row * (cardH + gap);
    const pal = design.palette[i % design.palette.length];

    addCardShadow(slide, x, y, cardW, cardH, colors.shadowColor);
    slide.addShape("roundRect" as any, {
      x, y, w: cardW, h: cardH,
      fill: { color: colors.cardBg },
      rectRadius: 0.10,
    });

    slide.addShape("rect" as any, {
      x, y, w: cardW, h: 0.05,
      fill: { color: pal },
      rectRadius: 0.10,
    });

    const colonIdx = items[i].indexOf(":");
    if (colonIdx > 0 && colonIdx < 40) {
      const label = items[i].substring(0, colonIdx).trim();
      const desc = items[i].substring(colonIdx + 1).trim();
      const gcBadge = Math.min(0.32, cardW * 0.15, cardH * 0.20);
      slide.addShape("roundRect" as any, {
        x: x + 0.10, y: y + 0.14,
        w: gcBadge, h: gcBadge,
        fill: { color: pal },
        rectRadius: 0.06,
      });
      slide.addText(String(i + 1), {
        x: x + 0.10, y: y + 0.14,
        w: gcBadge, h: gcBadge,
        fontSize: Math.min(12, gcBadge * 34),
        fontFace: design.fonts.title,
        bold: true, color: "FFFFFF",
        align: "center", valign: "middle",
      });
      const labelX = x + 0.10 + gcBadge + 0.08;
      const labelW = x + cardW - labelX - 0.10;
      // Estimate if label wraps to 2+ lines: ~7px per char at card_title size
      const estCharsPerLine = Math.max(1, Math.floor(labelW * 72 / (TYPO.CARD_TITLE * 0.55)));
      const estLines = Math.ceil(label.length / estCharsPerLine);
      const labelH = estLines > 1 ? 0.62 : 0.38;
      slide.addText(label, {
        x: labelX, y: y + 0.12,
        w: labelW, h: labelH,
        fontSize: items.length >= 6 ? TYPO.CARD_TITLE - 1 : TYPO.CARD_TITLE,
        fontFace: design.fonts.title,
        bold: true, color: ensureContrastOnLight(pal, colors.cardBg),
        valign: "middle",
        lineSpacingMultiple: 1.10,
      });
      const sepY = y + 0.12 + labelH + 0.06;
      addHR(slide, x + 0.10, sepY, cardW - 0.20, colors.borders, 0.004);
      slide.addText(desc, {
        x: x + 0.12, y: sepY + 0.08,
        w: cardW - 0.24, h: Math.max(0.30, y + cardH - sepY - 0.16),
        fontSize: items.length >= 6 ? TYPO.CARD_BODY - 1 : TYPO.CARD_BODY,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "top",
        lineSpacingMultiple: 1.18,
      });
    } else {
      slide.addText(String(i + 1).padStart(2, "0"), {
        x: x + 0.10, y: y + 0.12,
        w: 0.40, h: 0.30,
        fontSize: Math.min(16, cardW > 2.5 ? 18 : 14),
        fontFace: design.fonts.title,
        bold: true,
        color: ensureContrastOnLight(pal, colors.cardBg),
        transparency: 10,
        align: "left",
      });
      slide.addText(items[i], {
        x: x + 0.12, y: y + 0.48,
        w: cardW - 0.24, h: cardH - 0.58,
        fontSize: items.length >= 6 ? TYPO.CARD_BODY - 1 : TYPO.CARD_BODY,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "top",
        lineSpacingMultiple: 1.20,
      });
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ────────────────────────────────────────────────────────────────
// PROCESS TIMELINE — Horizontal pipeline (≤4) / Vertical node-line (5+)
// Always visual flow, never plain bullets
// ────────────────────────────────────────────────────────────────
function renderProcessTimeline(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;

  const items = plan.items || [];
  const contentX = 0.55;
  const contentW = SLIDE_W - contentX - 0.40;

  if (items.length <= 4) {
    // ── HORIZONTAL PIPELINE — dark bg, chevron-style cards ──
    addSlideBackground(slide, colors.coverDark);

    // Section label + title on dark
    if (plan.sectionLabel) {
      slide.addText(plan.sectionLabel.toUpperCase(), {
        x: 0.55, y: 0.30,
        w: 6.0, h: 0.24,
        fontSize: 10,
        fontFace: design.fonts.body,
        bold: true,
        color: colors.p2,
        charSpacing: 5,
      });
      addHR(slide, 0.55, 0.57, 1.00, colors.p2, 0.020);
    }
    slide.addText(plan.title, {
      x: 0.55, y: 0.68,
      w: SLIDE_W - 1.10, h: 0.70,
      fontSize: 26,
      fontFace: design.fonts.title,
      bold: true,
      color: "FFFFFF",
      valign: "middle",
    });

    // ── Horizontal flow line ──
    const flowY = 1.68;
    const cardY = flowY + 0.20;
    const cardH = SLIDE_H - cardY - 0.45;
    const gap = 0.06;
    const arrowW = 0.40;
    const totalArrowW = arrowW * Math.max(items.length - 1, 0);
    const cardW = (contentW - totalArrowW - gap * Math.max(items.length - 1, 0)) / items.length;

    // Connecting flow line behind cards
    slide.addShape("rect" as any, {
      x: contentX, y: cardY + cardH * 0.35,
      w: contentW, h: 0.04,
      fill: { color: colors.p2 },
      transparency: 60,
    });

    for (let i = 0; i < items.length; i++) {
      const x = contentX + i * (cardW + arrowW + gap);
      const pal = design.palette[i % design.palette.length];

      slide.addShape("roundRect" as any, {
        x: x + 0.02, y: cardY + 0.03,
        w: cardW, h: cardH,
        fill: { color: "000000" },
        transparency: 70,
        rectRadius: 0.12,
      });
      slide.addShape("roundRect" as any, {
        x, y: cardY, w: cardW, h: cardH,
        fill: { color: colors.panelMid },
        rectRadius: 0.12,
      });

      slide.addShape("rect" as any, {
        x, y: cardY, w: cardW, h: 0.05,
        fill: { color: pal },
        rectRadius: 0.12,
      });

      const badgeSz = 0.40;
      slide.addShape("roundRect" as any, {
        x: x + cardW / 2 - badgeSz / 2, y: cardY + 0.14,
        w: badgeSz, h: badgeSz,
        fill: { color: pal },
        rectRadius: 0.08,
      });
      slide.addText(String(i + 1), {
        x: x + cardW / 2 - badgeSz / 2, y: cardY + 0.14,
        w: badgeSz, h: badgeSz,
        fontSize: 16,
        fontFace: design.fonts.title,
        bold: true, color: "FFFFFF",
        align: "center", valign: "middle",
      });

      // Arrow connector
      if (i < items.length - 1) {
        const arrowX = x + cardW + gap / 2;
        const arrowMidY = cardY + cardH * 0.35;
        // Arrow shaft
        slide.addShape("rect" as any, {
          x: arrowX, y: arrowMidY - 0.02,
          w: arrowW - 0.06, h: 0.04,
          fill: { color: pal },
          transparency: 25,
        });
        // Arrow head (diamond rotated)
        slide.addShape("rect" as any, {
          x: arrowX + arrowW - 0.18, y: arrowMidY - 0.06,
          w: 0.12, h: 0.12,
          fill: { color: pal },
          transparency: 25,
          rotate: 45,
        });
      }

      // Label + description
      const colonIdx = items[i].indexOf(":");
      let label: string, desc: string;
      if (colonIdx > 0 && colonIdx < 40) {
        label = items[i].substring(0, colonIdx).trim();
        desc = items[i].substring(colonIdx + 1).trim();
      } else if (items[i].length <= 50) {
        label = items[i]; desc = "";
      } else {
        const words = items[i].split(/\s+/);
        label = words.slice(0, 4).join(" ");
        desc = words.slice(4).join(" ");
      }
      const labelY = cardY + 0.62;
      slide.addText(label, {
        x: x + 0.10, y: labelY,
        w: cardW - 0.20, h: 0.40,
        fontSize: TYPO.CARD_TITLE,
        fontFace: design.fonts.title,
        bold: true, color: pal,
        align: "center",
      });
      if (desc) {
        slide.addText(desc, {
          x: x + 0.10, y: labelY + 0.40,
          w: cardW - 0.20, h: cardH - 1.10,
          fontSize: TYPO.CARD_BODY,
          fontFace: design.fonts.body,
          color: colors.coverSubtext,
          align: "center", valign: "top",
          lineSpacingMultiple: 1.22,
        });
      }
    }
  } else {
    // ── VERTICAL TIMELINE with node-connector system (5-7 items) ──
    addSlideBackground(slide, colors.bg);
    addLeftEdge(slide, colors.p2);
    if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, colors.p2, design.fonts.body);
    addSlideTitle(slide, plan.title, colors, design.fonts.title, colors.p2);

    const vContentY = 1.55;
    const vContentH = SLIDE_H - vContentY - 0.35;
    const stepGap = items.length <= 5 ? 0.06 : 0.03;
    const stepH = (vContentH - stepGap * (items.length - 1)) / items.length;
    const nodeSize = items.length <= 5 ? 0.28 : 0.22;
    const nodeX = contentX + 0.10;

    // Vertical connector line
    const lineX = nodeX + nodeSize / 2 - 0.012;
    slide.addShape("rect" as any, {
      x: lineX, y: vContentY + nodeSize / 2,
      w: 0.024, h: vContentH - nodeSize,
      fill: { color: colors.divider },
    });

    for (let i = 0; i < items.length; i++) {
      const y = vContentY + i * (stepH + stepGap);
      const pal = design.palette[i % design.palette.length];

      slide.addShape("roundRect" as any, {
        x: nodeX, y: y + stepH / 2 - nodeSize / 2,
        w: nodeSize, h: nodeSize,
        fill: { color: pal },
        rectRadius: 0.05,
      });
      slide.addText(String(i + 1), {
        x: nodeX, y: y + stepH / 2 - nodeSize / 2,
        w: nodeSize, h: nodeSize,
        fontSize: items.length <= 5 ? 12 : 10,
        fontFace: design.fonts.title,
        bold: true, color: "FFFFFF",
        align: "center", valign: "middle",
      });

      const cardX = nodeX + nodeSize + 0.16;
      const cardW = contentW - (cardX - contentX);

      addCardShadow(slide, cardX, y, cardW, stepH - 0.02, colors.shadowColor);
      slide.addShape("roundRect" as any, {
        x: cardX, y, w: cardW, h: stepH - 0.02,
        fill: { color: colors.cardBg },
        rectRadius: 0.06,
      });
      slide.addShape("rect" as any, {
        x: cardX, y, w: 0.05, h: stepH - 0.02,
        fill: { color: pal },
        rectRadius: 0.06,
      });

      const colonIdx = items[i].indexOf(":");
      let label: string, desc: string;
      if (colonIdx > 0 && colonIdx < 40) {
        label = items[i].substring(0, colonIdx).trim();
        desc = items[i].substring(colonIdx + 1).trim();
      } else {
        label = ""; desc = items[i];
      }

      const textX = cardX + 0.05 + 0.12;
      const textW = cardW - 0.05 - 0.22;
      const fontSize = items.length <= 5 ? TYPO.BULLET_TEXT : TYPO.BULLET_TEXT - 1;

      if (label) {
        slide.addText(label, {
          x: textX, y: y + 0.02,
          w: textW, h: stepH * 0.38,
          fontSize,
          fontFace: design.fonts.title,
          bold: true, color: pal,
          valign: "bottom",
        });
        slide.addText(desc, {
          x: textX, y: y + stepH * 0.38,
          w: textW, h: stepH * 0.58,
          fontSize: fontSize - 1,
          fontFace: design.fonts.body,
          color: colors.text,
          valign: "top",
          lineSpacingMultiple: 1.10,
        });
      } else {
        slide.addText(desc, {
          x: textX, y,
          w: textW, h: stepH - 0.02,
          fontSize,
          fontFace: design.fonts.body,
          color: colors.text,
          valign: "middle",
          lineSpacingMultiple: 1.12,
        });
      }
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ────────────────────────────────────────────────────────────────
// COMPARISON TABLE PREMIUM — Zebra rows, minimal borders
// ────────────────────────────────────────────────────────────────
function renderComparisonTable(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);
  addLeftEdge(slide, colors.p0);
  if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, colors.p0, design.fonts.body);
  addSlideTitle(slide, plan.title, colors, design.fonts.title, colors.p0);

  const headers = plan.tableHeaders || [];
  const rows = plan.tableRows || [];
  if (headers.length === 0) { renderBullets(pptx, plan, design); return; }

  const contentX = 0.65;
  const contentW = SLIDE_W - contentX - 0.50;
  const tableData: any[][] = [];
  tableData.push(headers.map((h) => ({
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
  })));
  for (let r = 0; r < rows.length; r++) {
    tableData.push(rows[r].map((cell) => ({
      text: cell,
      options: {
        fontSize: TYPO.TABLE_CELL,
        fontFace: design.fonts.body,
        color: colors.text,
        fill: { color: r % 2 === 0 ? colors.tableRowOdd : colors.tableRowEven },
        valign: "middle",
      },
    })));
  }

  slide.addTable(tableData, {
    x: contentX, y: 1.68,
    w: contentW,
    colW: new Array(headers.length).fill(contentW / headers.length),
    rowH: 0.48,
    border: { type: "solid", pt: 0.3, color: colors.borders },
    autoPage: false,
  });
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ────────────────────────────────────────────────────────────────
// CASE STUDY PREMIUM — Badge + Storytelling horizontal bands
// Cenário → Desafio → Ação → Resultado (color-coded phases)
// ────────────────────────────────────────────────────────────────
function renderExampleHighlight(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;

  const items = (plan.items || [])
    .map((item) => normalizeResidualText(item))
    .filter(Boolean)
    .map((item) => {
      const repaired = isSentenceComplete(item.replace(/\.\s*$/, "")) ? item : repairSentence(item);
      return ensureSentenceEnd(repaired);
    });
  const cappedItems = items.slice(0, 5);
  const defaultLabels = ["Contexto", "Desafio", "Solução", "Implementação", "Resultado"];
  const defaultIcons = ["●", "▲", "◆", "■", "★"];
  const phaseColors = [colors.p1, colors.p3, colors.p0, colors.p2, colors.p4];

  addSlideBackground(slide, colors.coverDark);

  slide.addShape("rect" as any, {
    x: 0, y: 0, w: 0.50, h: SLIDE_H,
    fill: { color: colors.panelMid },
  });

  for (let i = 0; i < Math.min(cappedItems.length, 5); i++) {
    const dotY = 1.60 + i * ((SLIDE_H - 2.20) / Math.max(cappedItems.length - 1, 1));
    const isActive = true;
    slide.addShape("ellipse" as any, {
      x: 0.18, y: dotY - 0.05, w: 0.14, h: 0.14,
      fill: { color: isActive ? phaseColors[i] : colors.panelMid },
    });
    if (i < cappedItems.length - 1) {
      const nextY = 1.60 + (i + 1) * ((SLIDE_H - 2.20) / Math.max(cappedItems.length - 1, 1));
      slide.addShape("rect" as any, {
        x: 0.24, y: dotY + 0.10, w: 0.02, h: nextY - dotY - 0.16,
        fill: { color: phaseColors[i] },
        transparency: 50,
      });
    }
  }

  const badgeW = 1.50;
  const badgeH = 0.28;
  slide.addShape("roundRect" as any, {
    x: 0.80, y: 0.42,
    w: badgeW, h: badgeH,
    fill: { color: colors.p3 },
    rectRadius: 0.14,
  });
  slide.addText("ESTUDO DE CASO", {
    x: 0.80, y: 0.42,
    w: badgeW, h: badgeH,
    fontSize: 8,
    fontFace: design.fonts.body,
    bold: true,
    color: "FFFFFF",
    align: "center",
    valign: "middle",
    charSpacing: 4,
  });

  slide.addText(plan.title, {
    x: 0.80, y: 0.80,
    w: SLIDE_W - 1.50, h: 0.60,
    fontSize: 24,
    fontFace: design.fonts.title,
    bold: true,
    color: "FFFFFF",
    valign: "middle",
  });
  addHR(slide, 0.80, 1.42, 3.50, colors.p3, 0.020);

  const contentX = 0.80;
  const contentW = SLIDE_W - 1.50;
  const gridStartY = 1.60;
  const gridH = SLIDE_H - gridStartY - 0.50;
  const bandGap = 0.10;
  const bandH = Math.min(
    (gridH - bandGap * Math.max(cappedItems.length - 1, 0)) / Math.max(cappedItems.length, 1),
    1.20,
  );
  const descFontSize = cappedItems.length >= 5 ? TYPO.BODY - 1 : TYPO.BODY;

  for (let i = 0; i < cappedItems.length; i++) {
    const y = gridStartY + i * (bandH + bandGap);
    const pal = phaseColors[i % phaseColors.length];
    const colonIdx = cappedItems[i].indexOf(":");
    const label = colonIdx > 0 && colonIdx < 35
      ? cappedItems[i].substring(0, colonIdx).trim()
      : defaultLabels[i % defaultLabels.length];
    const desc = colonIdx > 0 ? cappedItems[i].substring(colonIdx + 1).trim() : cappedItems[i];

    addCardShadow(slide, contentX, y, contentW, bandH, "000000");

    slide.addShape("roundRect" as any, {
      x: contentX, y, w: contentW, h: bandH,
      fill: { color: colors.panelMid },
      rectRadius: 0.08,
    });

    slide.addShape("rect" as any, {
      x: contentX, y: y + 0.04, w: 0.05, h: bandH - 0.08,
      fill: { color: pal },
      rectRadius: 0.03,
    });

    const numBadgeSize = 0.30;
    slide.addShape("ellipse" as any, {
      x: contentX + 0.18, y: y + (bandH - numBadgeSize) / 2,
      w: numBadgeSize, h: numBadgeSize,
      fill: { color: pal },
      transparency: 15,
    });
    slide.addText(`${i + 1}`, {
      x: contentX + 0.18, y: y + (bandH - numBadgeSize) / 2,
      w: numBadgeSize, h: numBadgeSize,
      fontSize: 12,
      fontFace: design.fonts.title,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    });

    slide.addText(label.toUpperCase(), {
      x: contentX + 0.56, y: y + 0.04,
      w: 2.00, h: 0.24,
      fontSize: 8,
      fontFace: design.fonts.title,
      bold: true,
      color: pal,
      charSpacing: 3,
      valign: "middle",
    });

    slide.addText(desc, {
      x: contentX + 0.56, y: y + 0.26,
      w: contentW - 0.80, h: bandH - 0.32,
      fontSize: descFontSize,
      fontFace: design.fonts.body,
      color: colors.coverSubtext,
      valign: "top",
      lineSpacingMultiple: 1.18,
    });

    if (i < cappedItems.length - 1) {
      const arrowY = y + bandH + bandGap / 2;
      slide.addText("▼", {
        x: contentX + 0.23, y: arrowY - 0.08,
        w: 0.20, h: 0.16,
        fontSize: 7,
        color: phaseColors[i + 1] || pal,
        align: "center",
        valign: "middle",
        transparency: 40,
      });
    }
  }

  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ────────────────────────────────────────────────────────────────
// WARNING CALLOUT PREMIUM — Alert cards with red accent
// ────────────────────────────────────────────────────────────────
function renderWarningCallout(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);

  // Red accent left edge
  addLeftEdge(slide, "C0392B");
  if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, "C0392B", design.fonts.body);
  addSlideTitle(slide, plan.title, colors, design.fonts.title, "C0392B");

  // Warning icon area
  slide.addShape("roundRect" as any, {
    x: SLIDE_W - 1.50, y: 0.35,
    w: 0.80, h: 0.80,
    fill: { color: "FEF2F2" },
    rectRadius: 0.12,
  });
  slide.addText("⚠", {
    x: SLIDE_W - 1.50, y: 0.35,
    w: 0.80, h: 0.80,
    fontSize: 28,
    align: "center",
    valign: "middle",
  });

  const allItems = plan.items || [];
  const maxWarningItems = 5;
  const items = allItems.slice(0, maxWarningItems);
  const contentX = 0.65;
  const contentW = SLIDE_W - contentX - 0.50;
  const contentY = 1.58;
  const bulletGap = 0.10;
  const contentH = SLIDE_H - contentY - 0.45;
  const rawItemH = (contentH - bulletGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1);
  const itemH = Math.max(0.55, Math.min(1.10, rawItemH));
  const bodyFontSize = items.length >= 4 ? 12 : 14;

  for (let i = 0; i < items.length; i++) {
    const y = contentY + i * (itemH + bulletGap);
    const cardH = itemH - 0.04;
    // Use theme-appropriate card bg — never hardcode light bg on dark theme
    const isLightCard = i % 2 === 0;
    const cardBgColor = isLightCard
      ? (design.theme === "dark" ? colors.cardBgAlt : "FFF5F5")
      : colors.cardBg;
    // Text must contrast with the card background
    const cardTextColor = isLightCard && design.theme === "light" ? "1E293B" : colors.text;

    addCardShadow(slide, contentX, y, contentW, cardH, colors.shadowColor);
    slide.addShape("roundRect" as any, {
      x: contentX, y, w: contentW, h: cardH,
      fill: { color: cardBgColor },
      rectRadius: 0.08,
    });
    slide.addShape("rect" as any, {
      x: contentX, y, w: 0.06, h: cardH,
      fill: { color: "E74C3C" },
      rectRadius: 0.08,
    });

    const colonIdx = items[i].indexOf(":");
    const hasLabel = colonIdx > 0 && colonIdx < 40;
    const itemLabel = hasLabel ? items[i].substring(0, colonIdx).trim() : "";
    const itemDesc = hasLabel ? items[i].substring(colonIdx + 1).trim() : items[i];

    if (hasLabel) {
      const labelH = 0.18;
      slide.addText(itemLabel.toUpperCase(), {
        x: contentX + 0.18, y: y + 0.04,
        w: contentW - 0.26, h: labelH,
        fontSize: 7,
        fontFace: design.fonts.title,
        bold: true,
        color: "C0392B",
        charSpacing: 2,
        valign: "middle",
      });
      slide.addText(itemDesc, {
        x: contentX + 0.18, y: y + 0.04 + labelH,
        w: contentW - 0.30, h: cardH - labelH - 0.08,
        fontSize: bodyFontSize,
        fontFace: design.fonts.body,
        color: cardTextColor,
        valign: "top",
        lineSpacingMultiple: 1.12,
      });
    } else {
      slide.addText(items[i], {
        x: contentX + 0.18, y: y + 0.04,
        w: contentW - 0.30, h: cardH - 0.08,
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

// ────────────────────────────────────────────────────────────────
// REFLECTION CALLOUT — Cinematic dark + large quotes
// ────────────────────────────────────────────────────────────────
function renderReflectionCallout(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.coverDark);

  // Large decorative quote mark (giant, faded)
  slide.addText("\u201C", {
    x: 0.30, y: -0.30,
    w: 2.00, h: 2.00,
    fontSize: 180,
    fontFace: design.fonts.title,
    color: colors.p1,
    transparency: 88,
    bold: true,
  });

  // Accent line top
  addHR(slide, 0.65, 0.55, SLIDE_W - 1.30, colors.p1, 0.018);

  // "REFLEXÃO" label
  slide.addText("REFLEXÃO", {
    x: 0.65, y: 0.80,
    w: 4.0, h: 0.24,
    fontSize: 10,
    fontFace: design.fonts.body,
    bold: true,
    color: colors.p1,
    charSpacing: 6,
  });

  // Title
  slide.addText(plan.title, {
    x: 0.65, y: 1.12,
    w: SLIDE_W - 1.30, h: 0.55,
    fontSize: 24,
    fontFace: design.fonts.title,
    bold: true,
    color: "FFFFFF",
  });

  const items = plan.items || [];
  const contentY = 1.90;
  const contentH = SLIDE_H - contentY - 0.60;
  const itemGap = 0.16;
  const rawItemH = (contentH - itemGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1);
  const itemH = Math.max(0.65, Math.min(1.30, rawItemH));

  for (let i = 0; i < items.length; i++) {
    const y = contentY + i * (itemH + itemGap);
    // Subtle background panel for each reflection
    slide.addShape("roundRect" as any, {
      x: 0.65, y,
      w: SLIDE_W - 1.30, h: itemH,
      fill: { color: colors.panelMid },
      rectRadius: 0.08,
      transparency: 30,
    });
    slide.addText(items[i], {
      x: 1.00, y,
      w: SLIDE_W - 2.00, h: itemH,
      fontSize: TYPO.BODY_LARGE,
      fontFace: design.fonts.body,
      italic: true,
      color: colors.coverSubtext,
      valign: "middle",
      lineSpacingMultiple: 1.42,
    });
  }

  addGradientBar(slide, 0.65, SLIDE_H - 0.50, SLIDE_W - 1.30, 0.012, colors.p1, "right");

  slide.addShape("ellipse" as any, {
    x: SLIDE_W - 1.80, y: SLIDE_H - 0.18,
    w: 0.08, h: 0.08,
    fill: { color: colors.p1 },
  });
  slide.addText("EduGenAI", {
    x: SLIDE_W - 1.70, y: SLIDE_H - 0.24,
    w: 1.40, h: 0.20,
    fontSize: 8,
    fontFace: design.fonts.body,
    bold: true,
    color: colors.coverSubtext,
    align: "right",
    valign: "middle",
    charSpacing: 3,
  });
}

// ────────────────────────────────────────────────────────────────
// SUMMARY PREMIUM — 2x2 or 2x3 grid of numbered insight cards
// ────────────────────────────────────────────────────────────────
function renderSummarySlide(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);

  // ── Left accent sidebar ──
  const sidebarW = 0.45;
  slide.addShape("rect" as any, {
    x: 0, y: 0, w: sidebarW, h: SLIDE_H,
    fill: { color: colors.p0 },
  });

  // Section label + title
  if (plan.sectionLabel) {
    slide.addText(plan.sectionLabel.toUpperCase(), {
      x: sidebarW + 0.30, y: 0.30,
      w: 6.0, h: 0.24,
      fontSize: 10,
      fontFace: design.fonts.body,
      bold: true,
      color: colors.p0,
      charSpacing: 5,
    });
    addHR(slide, sidebarW + 0.30, 0.57, 0.90, colors.p0, 0.020);
  }
  slide.addText(plan.title, {
    x: sidebarW + 0.30, y: 0.68,
    w: SLIDE_W - sidebarW - 0.80, h: 0.75,
    fontSize: TYPO.SECTION_TITLE,
    fontFace: design.fonts.title,
    bold: true,
    color: colors.text,
    valign: "middle",
  });

  const items = (plan.items || []).map((item) => {
    const repaired = isSentenceComplete(item.replace(/\.\s*$/, "")) ? item : repairSentence(item);
    return ensureSentenceEnd(repaired);
  }).filter((item) => item.replace(/[.\s]+$/, "").trim().length >= 10);

  // ── Grid layout: 2 columns for ≥4 items, single column for ≤3 ──
  const contentX = sidebarW + 0.30;
  const contentW = SLIDE_W - contentX - 0.50;
  const contentY = 1.60;
  const contentHAvail = SLIDE_H - contentY - 0.40;
  const cols = items.length >= 4 ? 2 : 1;
  const rows = Math.ceil(items.length / cols);
  const gap = 0.12;
  const cardW = (contentW - gap * (cols - 1)) / cols;
  const cardH = Math.min(1.50, (contentHAvail - gap * (rows - 1)) / rows);

  for (let i = 0; i < items.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = contentX + col * (cardW + gap);
    const y = contentY + row * (cardH + gap);
    const pal = design.palette[i % design.palette.length];

    addCardShadow(slide, x, y, cardW, cardH, colors.shadowColor);
    slide.addShape("roundRect" as any, {
      x, y, w: cardW, h: cardH,
      fill: { color: colors.cardBg },
      rectRadius: 0.10,
    });

    slide.addShape("rect" as any, {
      x, y, w: 0.05, h: cardH,
      fill: { color: pal },
      rectRadius: 0.10,
    });

    const numSize = 0.40;
    slide.addShape("roundRect" as any, {
      x: x + 0.14, y: y + 0.12,
      w: numSize, h: numSize,
      fill: { color: pal },
      rectRadius: 0.08,
    });
    slide.addText(String(i + 1), {
      x: x + 0.14, y: y + 0.12,
      w: numSize, h: numSize,
      fontSize: 16,
      fontFace: design.fonts.title,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    });

    slide.addText(items[i], {
      x: x + 0.14, y: y + numSize + 0.18,
      w: cardW - 0.28, h: cardH - numSize - 0.30,
      fontSize: TYPO.BODY,
      fontFace: design.fonts.body,
      color: colors.text,
      valign: "top",
      lineSpacingMultiple: 1.25,
    });
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ────────────────────────────────────────────────────────────────
// TAKEAWAYS — Full dark bg + grid cards with accent top strips
// ────────────────────────────────────────────────────────────────
function renderNumberedTakeaways(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;

  // Full dark background for high contrast
  addSlideBackground(slide, colors.coverDark);

  // Top accent strip
  addHR(slide, 0, 0.04, SLIDE_W, colors.p4, 0.045);

  // Section label
  if (plan.sectionLabel) {
    slide.addText(plan.sectionLabel.toUpperCase(), {
      x: 0.65, y: 0.28,
      w: 6.0, h: 0.24,
      fontSize: 10,
      fontFace: design.fonts.body,
      bold: true,
      color: colors.p4,
      charSpacing: 6,
    });
  }
  // Title on dark bg
  slide.addText(plan.title, {
    x: 0.65, y: 0.58,
    w: SLIDE_W - 1.30, h: 0.70,
    fontSize: 28,
    fontFace: design.fonts.title,
    bold: true,
    color: "FFFFFF",
    valign: "middle",
  });
  addHR(slide, 0.65, 1.35, 1.80, colors.p4, 0.025);

  const items = plan.items || [];
  const contentX = 0.65;
  const contentW = SLIDE_W - contentX - 0.50;
  const cols = items.length <= 3 ? items.length : items.length <= 4 ? 2 : 3;
  const gridRows = Math.ceil(items.length / cols);
  const gap = 0.14;
  const cardW = (contentW - gap * (cols - 1)) / cols;
  const contentY = 1.65;
  const contentH = SLIDE_H - contentY - 0.30;
  const cardH = Math.min(1.80, (contentH - gap * (gridRows - 1)) / gridRows);

  for (let i = 0; i < items.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = contentX + col * (cardW + gap);
    const y = contentY + row * (cardH + gap);
    const pal = design.palette[i % design.palette.length];

    slide.addShape("roundRect" as any, {
      x: x + 0.02, y: y + 0.03,
      w: cardW, h: cardH,
      fill: { color: "000000" },
      transparency: 75,
      rectRadius: 0.12,
    });
    slide.addShape("roundRect" as any, {
      x, y, w: cardW, h: cardH,
      fill: { color: colors.panelMid },
      rectRadius: 0.12,
    });

    slide.addShape("rect" as any, {
      x, y, w: 0.05, h: cardH,
      fill: { color: pal },
      rectRadius: 0.12,
    });

    const tkBadge = Math.min(0.38, cardH * 0.28, cardW * 0.22);
    slide.addShape("roundRect" as any, {
      x: x + 0.14, y: y + 0.14,
      w: tkBadge, h: tkBadge,
      fill: { color: pal },
      rectRadius: 0.08,
    });
    slide.addText(String(i + 1), {
      x: x + 0.14, y: y + 0.14,
      w: tkBadge, h: tkBadge,
      fontSize: Math.min(16, tkBadge * 40),
      fontFace: design.fonts.title,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    });

    const tkTextY = y + 0.14 + tkBadge + 0.10;
    slide.addText(items[i], {
      x: x + 0.14, y: tkTextY,
      w: cardW - 0.28, h: cardH - (tkTextY - y) - 0.10,
      fontSize: TYPO.TAKEAWAY_BODY,
      fontFace: design.fonts.body,
      color: colors.coverSubtext,
      valign: "top",
      lineSpacingMultiple: 1.25,
      autoFit: true,
    } as any);
  }
}

// ────────────────────────────────────────────────────────────────
// CLOSING HERO — Cinematic, elegant, with CTA feel
// ────────────────────────────────────────────────────────────────
function renderClosingSlide(
  pptx: PptxGenJS,
  courseTitle: string,
  design: DesignConfig,
  image?: SlideImage | null,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();

  if (image) {
    try {
      slide.addImage({ data: image.base64Data, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
      console.log(`[V2-RENDER] Closing: addImage OK, dataLen=${image.base64Data.length}`);
    } catch (err: any) {
      console.error("[V2-RENDER] Closing addImage FAILED:", err.message);
      addSlideBackground(slide, colors.coverDark);
    }
  } else {
    addSlideBackground(slide, colors.coverDark);
  }

  // Only add large decorative gradient/ellipse when there's no image (they obscure the photo)
  if (!image) {
    addGradientBar(slide, SLIDE_W * 0.45, 0, SLIDE_W * 0.60, SLIDE_H, colors.p0, "down");

    slide.addShape("ellipse" as any, {
      x: SLIDE_W - 4.00, y: -1.20,
      w: 5.00, h: 5.00,
      fill: { color: colors.p1 },
      transparency: 92,
    });
  }

  slide.addShape("rect" as any, {
    x: 0.80, y: 0.90, w: 0.05, h: 3.80,
    fill: { color: colors.p0 },
  });
  slide.addShape("rect" as any, {
    x: 0.88, y: 0.90, w: 0.015, h: 3.80,
    fill: { color: colors.p0 },
    transparency: 50,
  });

  addHR(slide, 1.20, 1.30, 3.00, colors.p0, 0.015);

  if (!image) {
    for (let b = 0; b < 5; b++) {
      slide.addShape("roundRect" as any, {
        x: 0.28, y: 1.10 + b * 0.28,
        w: 0.30, h: 0.16,
        fill: { color: design.palette[b % design.palette.length] },
        transparency: 20,
        rectRadius: 0.04,
      });
    }
  }

  slide.addText("Obrigado!", {
    x: 1.20, y: 1.80,
    w: SLIDE_W * 0.55,
    h: 2.00,
    fontSize: 68,
    fontFace: design.fonts.title,
    bold: true,
    color: "FFFFFF",
    valign: "middle",
  });

  addGradientBar(slide, 1.20, 4.05, 3.20, 0.06, colors.p0, "right");

  slide.addText(courseTitle, {
    x: 1.20, y: 4.30,
    w: SLIDE_W * 0.50,
    h: 0.55,
    fontSize: 15,
    fontFace: design.fonts.body,
    color: colors.coverSubtext,
    valign: "top",
    lineSpacingMultiple: 1.18,
  });

  slide.addText("CONCLUSÃO", {
    x: 1.20, y: 5.10,
    w: 4.0, h: 0.24,
    fontSize: 9,
    fontFace: design.fonts.body,
    bold: true,
    color: colors.p0,
    charSpacing: 7,
    transparency: 20,
  });

  // ── Bottom decorative elements ──
  // Small geometric squares (right area)
  if (!image) {
    for (let i = 0; i < 3; i++) {
      const sz = 0.50 + i * 0.25;
      slide.addShape("rect" as any, {
        x: SLIDE_W - 2.20 + i * 0.45,
        y: SLIDE_H - 2.00 + i * 0.40,
        w: sz, h: sz,
        fill: { color: design.palette[i % design.palette.length] },
        transparency: 85,
        rectRadius: 0.04,
      });
    }
  }

  // ── Date bottom-right (PT-BR format) ──
  const dateStr = new Intl.DateTimeFormat("pt-BR", { year: "numeric", month: "long" }).format(new Date());
  slide.addText(dateStr, {
    x: SLIDE_W - 2.80, y: SLIDE_H - 0.55,
    w: 2.40, h: 0.28,
    fontSize: 11,
    fontFace: design.fonts.body,
    color: colors.coverSubtext,
    align: "right",
    charSpacing: 2,
    transparency: 30,
  });

  if (image) {
    addImageCredit(slide, image.credit, design);
  }
}

// ── Slide dispatcher ──
function renderSlide(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
  image?: SlideImage | null,
) {
  switch (plan.layout) {
    case "module_cover":
      renderModuleCover(pptx, plan, design, image);
      break;
    case "two_column_bullets":
      renderTwoColumnBullets(pptx, plan, design);
      break;
    case "definition":
      renderDefinition(pptx, plan, design);
      break;
    case "grid_cards":
      renderGridCards(pptx, plan, design);
      break;
    case "process_timeline":
      renderProcessTimeline(pptx, plan, design);
      break;
    case "comparison_table":
      renderComparisonTable(pptx, plan, design);
      break;
    case "example_highlight":
      renderExampleHighlight(pptx, plan, design);
      break;
    case "warning_callout":
      renderWarningCallout(pptx, plan, design);
      break;
    case "reflection_callout":
      renderReflectionCallout(pptx, plan, design);
      break;
    case "summary_slide":
      renderSummarySlide(pptx, plan, design);
      break;
    case "numbered_takeaways":
      renderNumberedTakeaways(pptx, plan, design);
      break;
    case "bullets":
    default:
      renderBullets(pptx, plan, design);
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 8: STAGE 5 — FULL PIPELINE ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════

async function runPipeline(
  courseTitle: string,
  modules: { title: string; content: string }[],
  design: DesignConfig,
): Promise<{ pptx: PptxGenJS; report: PipelineReport }> {
  const report: PipelineReport = {
    totalModules: modules.length,
    totalBlocks: 0,
    totalSections: 0,
    totalSlides: 0,
    sentenceIntegrityChecks: 0,
    redistributions: 0,
    warnings: [],
  };

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "EduGenAI v2";
  pptx.title = courseTitle;

  _globalSlideIdx = 0;
  _globalSlideNumber = 0;
  _globalFooterBrand = design.footerBrand;

  const imagePlan = await buildImagePlan(courseTitle, modules, design.includeImages);

  const unsplashKey = Deno.env.get("UNSPLASH_ACCESS_KEY") || "";
  report.imageDiagnostics = {
    unsplashKeyPresent: unsplashKey.length > 0,
    unsplashKeyLength: unsplashKey.length,
    includeImages: design.includeImages,
    coverImageFetched: !!imagePlan.cover,
    closingImageFetched: !!imagePlan.closing,
    moduleImagesFetched: imagePlan.modules.size,
    moduleImagesTotal: modules.length,
    coverBase64Length: imagePlan.cover?.base64Data?.length ?? 0,
    coverBase64Start: imagePlan.cover?.base64Data?.substring(0, 50) ?? "N/A",
    pptxgenImport: "npm:pptxgenjs@3.12.0",
    errors: [],
  } as any;
  if (!unsplashKey) report.imageDiagnostics!.errors.push("UNSPLASH_ACCESS_KEY not set in Supabase secrets");
  if (!design.includeImages) report.imageDiagnostics!.errors.push("includeImages is false — images disabled by user");
  if (design.includeImages && unsplashKey && (imagePlan.modules.size === 0 && !imagePlan.cover)) {
    report.imageDiagnostics!.errors.push("IMAGES_NOT_FETCHED: includeImages was true but no images were retrieved. Check Unsplash API key and quota.");
    report.warnings.push("IMAGES_NOT_FETCHED: Presentation generated without images. Check Unsplash configuration.");
  }
  console.log(`[V2-IMAGE-DIAG]`, JSON.stringify(report.imageDiagnostics));

  renderCoverSlide(pptx, courseTitle, design, imagePlan.cover);

  const allModuleSlidePlans: SlidePlan[][] = [];

  for (let mi = 0; mi < modules.length; mi++) {
    const mod = modules[mi];
    const rawTitle = sanitize(mod.title || `Módulo ${mi + 1}`);
    const cleanTitle = rawTitle.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;

    console.log(`[V2-STAGE-1] Parsing module ${mi + 1}: "${cleanTitle}"`);
    const blocks = parseModuleContent(mod.content || "");
    report.totalBlocks += blocks.length;

    console.log(`[V2-STAGE-2] Segmenting module ${mi + 1}: ${blocks.length} blocks`);
    const sections = segmentBlocks(blocks);
    report.totalSections += sections.length;

    console.log(`[V2-STAGE-3] Distributing module ${mi + 1}: ${sections.length} sections`);
    const slidePlans = distributeModuleToSlides(cleanTitle, mi, sections, design, report);
    allModuleSlidePlans.push(slidePlans);
  }

  const tocModules = modules.map((m) => {
    const rawTitle = sanitize(m.title || "");
    const cleanTitle = rawTitle.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;
    const desc = extractTocDescription(m.content || "", 105);
    if (!desc) {
      return {
        title: cleanMarkdown(cleanTitle),
        description: undefined,
      };
    }

    return {
      title: cleanMarkdown(cleanTitle),
      description: ensureSentenceEnd(normalizeResidualText(desc)),
    };
  });
  renderTOC(pptx, tocModules, design);

  // ── POST-PROCESSING: Final sweep to eliminate empty/weak slides ──
  console.log(`[V2-STAGE-3.5] Post-processing: eliminating empty/weak slides...`);
  for (const modulePlans of allModuleSlidePlans) {
    for (let i = modulePlans.length - 1; i >= 0; i--) {
      const plan = modulePlans[i];
      if (plan.layout === "module_cover") continue; // Always keep module covers
      if (plan.layout === "comparison_table") {
        // Table slides need actual rows
        if (!plan.tableRows || plan.tableRows.length === 0) {
          report.warnings.push(`[POST] Removed empty table slide: "${plan.title}"`);
          modulePlans.splice(i, 1);
          continue;
        }
        continue;
      }
      // For all other layouts: must have meaningful items
      const items = plan.items || [];
      if (items.length === 0) {
        report.warnings.push(`[POST] Removed slide with no items: "${plan.title}"`);
        // Try to fold items into previous slide
        if (i > 0 && modulePlans[i - 1].items) {
          // nothing to fold, just remove
        }
        modulePlans.splice(i, 1);
        continue;
      }
      if (!hasMeaningfulContent(items)) {
        // Fold into previous slide if possible
        if (i > 0 && modulePlans[i - 1].items) {
          modulePlans[i - 1].items = [...(modulePlans[i - 1].items || []), ...items];
          report.warnings.push(`[POST] Merged weak slide "${plan.title}" into "${modulePlans[i - 1].title}"`);
        } else {
          report.warnings.push(`[POST] Removed weak slide: "${plan.title}" (${items.length} items, none meaningful)`);
        }
        modulePlans.splice(i, 1);
        continue;
      }
    }
  }

  console.log(`[V2-STAGE-3.6] Merging adjacent sparse continuation slides...`);
  for (const modulePlans of allModuleSlidePlans) {
    for (let i = modulePlans.length - 2; i >= 0; i--) {
      const curr = modulePlans[i];
      const next = modulePlans[i + 1];
      if (curr.layout === "module_cover" || next.layout === "module_cover") continue;
      if (curr.layout === "comparison_table" || next.layout === "comparison_table") continue;
      const currItems = curr.items || [];
      const nextItems = next.items || [];
      if (currItems.length === 0 || nextItems.length === 0) continue;
      const currChars = currItems.reduce((s, t) => s + t.length, 0);
      const nextChars = nextItems.reduce((s, t) => s + t.length, 0);
      const combinedItems = currItems.length + nextItems.length;
      const combinedChars = currChars + nextChars;
      const baseTitle = stripPartSuffix(curr.title);
      const sameSection = baseTitle === stripPartSuffix(next.title);
      const isContinuation = next.continuationOf === baseTitle ||
        /\(Parte\s+\d+\)/i.test(next.title) ||
        /\(Parte\s+\d+\)/i.test(curr.title);
      const canMerge = sameSection && isContinuation &&
        combinedItems <= design.density.maxItemsPerSlide &&
        combinedChars < 800 &&
        currChars < 400 &&
        nextChars < 400;
      const isVeryThin = currItems.length <= 2 && nextItems.length <= 2 &&
        sameSection && (isContinuation || curr.layout === next.layout) &&
        combinedItems <= design.density.maxItemsPerSlide;
      if (canMerge || isVeryThin) {
        curr.items = [...currItems, ...nextItems];
        curr.title = stripPartSuffix(curr.title);
        report.warnings.push(`[MERGE] Merged sparse slides: "${next.title}" into "${curr.title}"`);
        modulePlans.splice(i + 1, 1);
      }
    }
  }

  console.log(`[V2-STAGE-3.7] Visual fit pass: preventing overflow and overlap...`);
  for (let i = 0; i < allModuleSlidePlans.length; i++) {
    allModuleSlidePlans[i] = enforceVisualRenderingGuards(allModuleSlidePlans[i], design, report);
  }

  // ── STAGE 3.8: Anti-repetition & breathing — diversify sequential layouts ──
  console.log(`[V2-STAGE-3.8] Anti-repetition: diversifying sequential layouts...`);
  const LAYOUT_ALTS: Partial<Record<SlideLayoutV2, SlideLayoutV2[]>> = {
    bullets: ["two_column_bullets", "grid_cards"],
    two_column_bullets: ["bullets", "grid_cards"],
    definition: ["grid_cards", "bullets"],
    grid_cards: ["two_column_bullets", "definition"],
    warning_callout: ["bullets"],
  };
  for (const modulePlans of allModuleSlidePlans) {
    let consecutiveSame = 0;
    for (let i = 1; i < modulePlans.length; i++) {
      const prev = modulePlans[i - 1];
      const curr = modulePlans[i];
      if (curr.layout === "module_cover" || curr.layout === "comparison_table") {
        consecutiveSame = 0;
        continue;
      }
      if (curr.layout === prev.layout) {
        consecutiveSame++;
      } else {
        consecutiveSame = 0;
      }
      // Swap after any 2 consecutive same layouts
      if (consecutiveSame >= 1 && LAYOUT_ALTS[curr.layout]) {
        const alts = LAYOUT_ALTS[curr.layout]!;
        // Pick an alternative that differs from both prev and prev-prev
        const prevPrev = i >= 2 ? modulePlans[i - 2].layout : null;
        const alt = alts.find((a) => a !== prev.layout && a !== prevPrev) || alts[0];
        report.warnings.push(`[ANTI-REP] Swapped "${curr.layout}" → "${alt}" for "${curr.title}"`);
        curr.layout = alt;
        consecutiveSame = 0;
      }
    }
  }

  console.log(`[V2-STAGE-4] Rendering slides...`);
  // Compute total content slides for footer numbering (cover + TOC + module slides + closing)
  _globalTotalSlides = allModuleSlidePlans.reduce((sum, plans) => sum + plans.length, 0);
  let moduleIdx = 0;
  for (const modulePlans of allModuleSlidePlans) {
    const moduleImage = imagePlan.modules.get(moduleIdx) || null;
    for (const plan of modulePlans) {
      const img = plan.layout === "module_cover" ? moduleImage : null;
      renderSlide(pptx, plan, design, img);
      report.totalSlides++;
    }
    moduleIdx++;
  }

  renderClosingSlide(pptx, courseTitle, design, imagePlan.closing);
  report.totalSlides += 3;

  console.log(
    `[V2-PIPELINE] Complete: ${report.totalModules} modules, ${report.totalBlocks} blocks, ${report.totalSections} sections, ${report.totalSlides} slides`,
  );

  return { pptx, report };
}

// ═══════════════════════════════════════════════════════════════════

// SECTION 9: HTTP HANDLER (Deno.serve)
// ═══════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = claimsData.user.id;

    const body = await req.json();
    const { course_id, palette, density, theme, includeImages, template, courseType, footerBrand } = body;
    if (!course_id) {
      return new Response(
        JSON.stringify({ error: "course_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: sub } = await serviceClient
      .from("subscriptions")
      .select("plan")
      .eq("user_id", userId)
      .single();
    const plan = sub?.plan || "free";

    if (plan !== "pro") {
      const { data: profile } = await serviceClient
        .from("profiles")
        .select("is_dev")
        .eq("user_id", userId)
        .maybeSingle();
      if (!profile?.is_dev) {
        return new Response(
          JSON.stringify({
            error: "PowerPoint export requires a Pro plan.",
            feature: "export_pptx",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const { data: course, error: courseErr } = await serviceClient
      .from("courses")
      .select("*")
      .eq("id", course_id)
      .eq("user_id", userId)
      .single();
    if (courseErr || !course) {
      return new Response(
        JSON.stringify({ error: "Course not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (course.status !== "published") {
      return new Response(
        JSON.stringify({ error: "Course must be published to export." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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

    const courseTitle = sanitize(cleanMarkdown(course.title || "Curso EduGenAI"));
    const moduleData = modules.map((m: any) => ({
      title: m.title || "",
      content: m.content || "",
    }));

    const unsplashKeyPresent = !!Deno.env.get("UNSPLASH_ACCESS_KEY");
    console.log(
      `[V2] ENGINE_VERSION=${ENGINE_VERSION} | Starting export: "${courseTitle}", ${moduleData.length} modules, theme=${design.theme}, palette=${palette || "default"}, images=${design.includeImages}, unsplashKey=${unsplashKeyPresent ? "SET" : "MISSING"}, includeImages_raw=${includeImages}`,
    );

    const { pptx, report } = await runPipeline(courseTitle, moduleData, design);

    const pptxData = await pptx.write({ outputType: "uint8array" });

    let zipDiag: any = null;
    try {
      const JSZip = (await import("npm:jszip@3.10.1")).default;
      const zip = await JSZip.loadAsync(pptxData);
      const allFiles = Object.keys(zip.files);
      const mediaFiles = allFiles.filter((f: string) => f.startsWith("ppt/media/"));
      const mediaSizes: Record<string, number> = {};
      for (const mf of mediaFiles) {
        const fileData = await zip.file(mf)?.async("uint8array");
        mediaSizes[mf] = fileData?.length ?? 0;
      }

      // Deep slide XML inspection for image debugging
      let slide1ImageRefs = 0;
      let slide1RelsContent = "";
      const slide1Rels = allFiles.find((f: string) => f.includes("slide1.xml.rels"));
      if (slide1Rels) {
        slide1RelsContent = (await zip.file(slide1Rels)?.async("string")) || "";
        slide1ImageRefs = (slide1RelsContent).match(/image/gi)?.length ?? 0;
      }

      // Extract slide1.xml to check image element properties
      let slide1XmlSnippet = "";
      const slide1Xml = allFiles.find((f: string) => f === "ppt/slides/slide1.xml");
      if (slide1Xml) {
        const slide1Content = (await zip.file(slide1Xml)?.async("string")) || "";
        // Extract all <a:blip> tags (image references in OOXML)
        const blipMatches = slide1Content.match(/<a:blip[^>]*>/g) || [];
        // Extract all <a:ext> tags inside <a:xfrm> (dimensions)
        const xfrmMatches = slide1Content.match(/<a:xfrm[^>]*>[\s\S]*?<\/a:xfrm>/g) || [];
        // Extract <p:pic> elements (picture shapes)
        const picCount = (slide1Content.match(/<p:pic>/g) || []).length;
        slide1XmlSnippet = JSON.stringify({
          blipTags: blipMatches.map((b: string) => b.substring(0, 120)),
          xfrmCount: xfrmMatches.length,
          xfrmSamples: xfrmMatches.slice(0, 3).map((x: string) => x.substring(0, 200)),
          picShapeCount: picCount,
          xmlLength: slide1Content.length,
        });
      }

      // Check [Content_Types].xml for image content types
      let contentTypesInfo = "";
      const ctFile = allFiles.find((f: string) => f === "[Content_Types].xml");
      if (ctFile) {
        const ctContent = (await zip.file(ctFile)?.async("string")) || "";
        const imageTypes = (ctContent.match(/<Default[^>]*Extension="(jpeg|jpg|png|gif|webp)"[^>]*/gi) || []);
        contentTypesInfo = JSON.stringify(imageTypes.map((t: string) => t.substring(0, 100)));
      }

      zipDiag = {
        totalFiles: allFiles.length,
        mediaFileCount: mediaFiles.length,
        mediaFiles: mediaSizes,
        slide1ImageRefs,
        slide1RelsContent: slide1RelsContent.substring(0, 500),
        slide1XmlAnalysis: slide1XmlSnippet,
        contentTypesImageEntries: contentTypesInfo,
      };
      console.log(`[V2-ZIP] Diagnostics:`, JSON.stringify(zipDiag));
    } catch (zipErr: any) {
      console.warn("[V2-ZIP] ZIP inspection failed:", zipErr.message);
      zipDiag = { error: zipErr.message };
    }
    (report as any).zipDiagnostics = zipDiag;

    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s\-]/g, "")
      .replace(/\s+/g, "-")
      .trim()
      .substring(0, 80);
    const fileName = `${userId}/${safeName}-PPTX-v2-${dateStr}.pptx`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(fileName, pptxData, {
        contentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: true,
      });
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage
      .from("course-exports")
      .createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_EXPORTED_PPTX_V2",
      metadata: { course_id, slide_count: report.totalSlides },
    });

    return new Response(
      JSON.stringify({
        url: signedUrl.signedUrl,
        version: "v2",
        engine_version: ENGINE_VERSION,
        quality_report: {
          engine_version: ENGINE_VERSION,
          total_modules: report.totalModules,
          total_slides: report.totalSlides,
          total_blocks_parsed: report.totalBlocks,
          total_sections_segmented: report.totalSections,
          sentence_integrity_checks: report.sentenceIntegrityChecks,
          redistributions: report.redistributions,
          warnings: report.warnings,
          image_diagnostics: report.imageDiagnostics || null,
          images_warning: (report.imageDiagnostics?.errors || []).find(e => e.startsWith("IMAGES_NOT_FETCHED")) || null,
          zip_diagnostics: report.zipDiagnostics || null,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[V2] Export error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
