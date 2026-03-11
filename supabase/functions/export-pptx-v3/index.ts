import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "npm:pptxgenjs@3.12.0";

const ENGINE_VERSION = "3.0.0-2026-03-11";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ╔══════════════════════════════════════════════════════════════════╗
// ║  PPTX EXPORTER v3 — EduGenAI                                   ║
// ║                                                                  ║
// ║  Pipeline architecture:                                          ║
// ║    Stage 1: AI GENERATE  — markdown → AI → SlideData[] JSON      ║
// ║    Stage 2: RENDER       — SlideData[] → PptxGenJS slides        ║
// ║    Stage 3: EXPORT       — write PPTX binary + upload            ║
// ║                                                                  ║
// ║  Core difference from v2:                                        ║
// ║    - Replaces manual parsing+segmentation+distribution with      ║
// ║      a single AI call per module that outputs structured JSON    ║
// ║    - All rendering code is identical to v2                       ║
// ╚══════════════════════════════════════════════════════════════════╝

// ═══════════════════════════════════════════════════════════════════
// SECTION 1: TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

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
  blockType?: string;
  moduleColor?: string;
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

interface ExportOptions {
  density: string;
  language: string;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 2: DESIGN SYSTEM (identical to v2)
// ═══════════════════════════════════════════════════════════════════

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN = 0.667;
const SAFE_W = SLIDE_W - MARGIN * 2;
const SAFE_H = SLIDE_H - 1.0;

const THEMES = {
  light: {
    bg: "F0F2F8",
    bgAlt: "E4E8F2",
    bgAccent: "D6DCF0",
    text: "0F172A",
    textSecondary: "4A5568",
    accent: "6C63FF",
    accentMuted: "EEEDFF",
    borders: "C8CEDF",
    cardBg: "FFFFFF",
    cardBgAlt: "EEF1FA",
    tableHeaderBg: "0F172A",
    tableRowOdd: "FFFFFF",
    tableRowEven: "EEF1FA",
    insightBg: "FFF8ED",
    reflectionBg: "EDF0FA",
    coverBg: "0F1C3F",
    coverText: "FFFFFF",
    coverSubtext: "A0AEC0",
    divider: "C8CEDF",
    coverDark: "0F1C3F",
    panelDark: "162040",
    panelMid: "1E2D55",
    shadowColor: "8896B0",
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

const TEMPLATE_FONTS: Record<string, { title: string; body: string }> = {
  default:   { title: "Montserrat",        body: "Open Sans" },
  academic:  { title: "Times New Roman",   body: "Arial" },
  corporate: { title: "Montserrat",        body: "Open Sans" },
  creative:  { title: "Playfair Display",  body: "Lato" },
};

const TEMPLATE_DEFAULT_PALETTES: Record<string, string[]> = {
  default:   PALETTES.default,
  academic:  ["003366", "336699", "FF6600", "006633", "660033"],
  corporate: ["1A1A2E", "16213E", "0F3460", "533483", "E94560"],
  creative:  ["2C3E50", "E74C3C", "F39C12", "8E44AD", "16A085"],
};

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
    bg: t.bg, bgAlt: t.bgAlt, bgAccent: t.bgAccent,
    text: t.text, textSecondary: t.textSecondary,
    accent: t.accent, accentMuted: t.accentMuted,
    borders: t.borders, cardBg: t.cardBg, cardBgAlt: t.cardBgAlt,
    tableHeaderBg: t.tableHeaderBg, tableRowOdd: t.tableRowOdd, tableRowEven: t.tableRowEven,
    insightBg: t.insightBg, reflectionBg: t.reflectionBg,
    coverBg: t.coverBg, coverText: t.coverText, coverSubtext: t.coverSubtext,
    divider: t.divider, coverDark: t.coverDark, panelDark: t.panelDark, panelMid: t.panelMid,
    shadowColor: t.shadowColor,
    p0: p[0], p1: p[1], p2: p[2], p3: p[3], p4: p[4],
    white: "FFFFFF",
  };
}

function addLightBgDecoration(slide: any, design: DesignConfig, colors: ReturnType<typeof getColors>) {
  if (design.theme === "light") {
    slide.addShape("ellipse" as any, { x: SLIDE_W - 1.60, y: -0.60, w: 1.80, h: 1.80, fill: { color: colors.p0 }, transparency: 92 });
    slide.addShape("ellipse" as any, { x: SLIDE_W - 0.80, y: 0.50, w: 0.80, h: 0.80, fill: { color: colors.p1 }, transparency: 88 });
  }
}

function ensureContrastOnLight(fgHex: string, bgHex: string): string {
  const toLum = (hex: string) => {
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  const fgLum = toLum(fgHex);
  const bgLum = toLum(bgHex);
  if (Math.abs(fgLum - bgLum) < 0.3) return bgLum > 0.5 ? "1E293B" : "E8EDF5";
  return fgHex;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 2.5: IMAGE SERVICE (identical to v2)
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
    for (let j = i; j < end; j++) str += String.fromCharCode(bytes[j]);
    parts.push(str);
  }
  return btoa(parts.join(""));
}

async function fetchUnsplashImage(
  query: string,
  orientation: "landscape" | "portrait" | "squarish" = "landscape",
): Promise<SlideImage | null> {
  const accessKey = Deno.env.get("UNSPLASH_ACCESS_KEY");
  if (!accessKey) return null;
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=1&content_filter=high`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${accessKey}` } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results?.length) return null;
    const photo = data.results[0];
    const imageUrl = photo.urls?.regular || photo.urls?.small;
    if (!imageUrl) return null;
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const mimeType = contentType.split(";")[0].trim();
    const buf = await imgRes.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);
    return {
      base64Data: `data:${mimeType};base64,${base64}`,
      credit: photo.user?.name || "Unsplash",
      creditUrl: photo.user?.links?.html || "https://unsplash.com",
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
  if (!includeImages) return empty;
  const accessKey = Deno.env.get("UNSPLASH_ACCESS_KEY");
  if (!accessKey) return empty;

  const coverQuery = buildImageQuery(courseTitle);
  const moduleQueries = modules.map((m) => {
    const rawTitle = m.title.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || m.title;
    return buildImageQuery(rawTitle);
  });

  const MAX_CONCURRENT = 4;
  const allQueries: { query: string; orientation: "landscape" | "portrait" | "squarish" }[] = [];
  allQueries.push({ query: coverQuery, orientation: "landscape" });
  for (const q of moduleQueries) allQueries.push({ query: q, orientation: "landscape" });
  allQueries.push({ query: coverQuery + " conclusion", orientation: "landscape" });

  const results: PromiseSettledResult<SlideImage | null>[] = [];
  for (let i = 0; i < allQueries.length; i += MAX_CONCURRENT) {
    const batch = allQueries.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.allSettled(batch.map((q) => fetchUnsplashImage(q.query, q.orientation)));
    results.push(...batchResults);
  }

  const plan: ImagePlan = { cover: null, modules: new Map(), closing: null };
  const coverResult = results[0];
  if (coverResult.status === "fulfilled" && coverResult.value) plan.cover = coverResult.value;
  for (let i = 0; i < modules.length; i++) {
    const result = results[i + 1];
    if (result.status === "fulfilled" && result.value) plan.modules.set(i, result.value);
  }
  const closingResult = results[results.length - 1];
  if (closingResult.status === "fulfilled" && closingResult.value) plan.closing = closingResult.value;
  return plan;
}

function addImageCredit(slide: any, credit: string, design: DesignConfig) {
  slide.addText(`Foto: ${credit} / Unsplash`, {
    x: SLIDE_W - 4.00, y: SLIDE_H - 0.42, w: 3.60, h: 0.22,
    fontSize: 7, fontFace: design.fonts.body, color: "FFFFFF", align: "right", transparency: 50,
  });
}

function addImageOverlay(slide: any, color: string, transparency: number, x = 0, y = 0, w = SLIDE_W, h = SLIDE_H) {
  slide.addShape("rect" as any, { x, y, w, h, fill: { color }, transparency });
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 3: TEXT UTILITIES (minimal subset needed for v3)
// ═══════════════════════════════════════════════════════════════════

function sanitize(text: string): string {
  if (!text) return "";
  return text
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/\u00AD/g, "").replace(/\uFFFD/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/\s+/g, " ").trim();
}

function cleanMarkdown(text: string): string {
  if (!text) return "";
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").replace(/`(.*?)`/g, "$1")
    .replace(/#{1,6}\s*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
}

function ensureSentenceEnd(text: string): string {
  if (!text) return "";
  const t = text.trim();
  if (!t) return "";
  if (/[.!?…]$/.test(t)) return t;
  return t + ".";
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 4: AI SLIDE GENERATION (core v3 change)
// ═══════════════════════════════════════════════════════════════════

function buildSlidePrompt(moduleTitle: string, moduleContent: string, options: ExportOptions): string {
  return `Você é um designer instrucional especializado em apresentações de slides. 
Converta o conteúdo do módulo abaixo em uma sequência de slides para PowerPoint.

## REGRAS OBRIGATÓRIAS

### Estrutura de saída
Retorne APENAS um array JSON válido de slides. Nenhum texto fora do JSON.

### Tipos de slide disponíveis e quando usar cada um:

**"module_cover"** — SEMPRE o primeiro slide do módulo
- Campos: title (título do módulo), objectives (array de 3 strings — o que o aluno vai aprender)

**"bullets"** — Conteúdo expositivo geral (fundamentos, como funciona, conceitos)
- Campos: title (máx 60 chars), sectionLabel (ex: "FUNDAMENTOS", "COMO FUNCIONA"), items (array de 4-6 strings, cada uma máx 160 chars, frase completa com ponto final)

**"grid_cards"** — Listas de itens paralelos com título e descrição (aplicações reais, tipos, modelos)
- Usar quando: 3-6 itens com estrutura "Nome: descrição" ou "Ferramenta: uso"
- Campos: title, sectionLabel (ex: "APLICAÇÕES REAIS", "MODELOS"), items (array de 3-6 strings no formato "Título: descrição em 1 frase")

**"comparison_table"** — Comparativos entre 2 ou mais conceitos
- Usar quando: o conteúdo compara variantes, versões, abordagens
- Campos: title, sectionLabel, headers (array de 2-4 strings), rows (array de arrays de strings)

**"example_highlight"** — Exemplo prático ou estudo de caso
- SEMPRE usar para blocos de exemplo — nunca use "bullets" para exemplos
- Campos: title (ex: "Exemplo prático"), sectionLabel ("ESTUDO DE CASO"), items (array de 3-5 strings descrevendo: cenário → ação → resultado, cada item uma frase completa distinta)
- CRÍTICO: cada item deve ter conteúdo único — PROIBIDO repetir a mesma informação em itens diferentes

**"reflection_callout"** — Pergunta de reflexão para o aluno
- Usar para blocos "💭 Pare um momento e reflita"
- Campos: title ("Reflexão"), items (array com 1 string — a pergunta completa)

**"warning_callout"** — Desafios, riscos, cuidados
- Campos: title, sectionLabel ("DESAFIOS E CUIDADOS"), items (array de 3-5 alertas, cada um uma frase completa)

**"summary_slide"** — Resumo do módulo
- SEMPRE o penúltimo slide do módulo (antes dos takeaways)
- Campos: title ("Resumo"), items (array de 2-3 frases sintetizando o módulo)

**"numbered_takeaways"** — Key Takeaways
- SEMPRE o último slide do módulo
- Campos: title ("Key Takeaways"), items (array de 4-6 strings, cada uma uma lição concreta e aplicável)

---

### Regras de qualidade obrigatórias:

1. **Densidade por slide**: 4-6 items para bullets/grid_cards. Nunca 1 item isolado em um slide — se sobrar 1 item, incorpore no slide anterior.

2. **Variedade de layouts**: Não use "bullets" mais de 3 vezes seguidas. Alterne com grid_cards, example_highlight, comparison_table quando o conteúdo permitir.

3. **Títulos descritivos**: O title do slide deve ser específico ao conteúdo. Nunca use apenas "Fundamentos" — use "Fundamentos da Inteligência Artificial". Máximo 60 caracteres.

4. **Frases completas**: Todo item deve ser uma frase completa com ponto final. Nunca corte uma frase no meio. Máximo 160 caracteres por item.

5. **sectionLabel em maiúsculas**: sempre CAPS, máximo 4 palavras, ex: "FUNDAMENTOS", "APLICAÇÕES REAIS", "COMO FUNCIONA".

6. **Sem duplicação**: Nenhum item pode repetir informação de outro item no mesmo slide ou em slides adjacentes do mesmo módulo.

7. **example_highlight obrigatório**: Todo módulo deve ter pelo menos 1 slide de exemplo. Se o conteúdo não tiver exemplo explícito, criar um baseado no conteúdo.

8. **Sequência obrigatória por módulo**:
   - Slide 1: module_cover (sempre)
   - Slides 2-N: conteúdo (bullets, grid_cards, table, example, reflection, warning)
   - Penúltimo: summary_slide
   - Último: numbered_takeaways

---

### Opções de exportação aplicadas:
- Densidade do conteúdo: ${options.density} (compact = menos items por slide, detailed = mais)
- Idioma: ${options.language}

---

### Conteúdo do módulo:

**Título:** ${moduleTitle}

**Conteúdo:**
${moduleContent}

---

Retorne APENAS o array JSON. Exemplo mínimo de estrutura esperada:
[
  {"layout": "module_cover", "title": "...", "objectives": ["...", "...", "..."]},
  {"layout": "bullets", "title": "...", "sectionLabel": "FUNDAMENTOS", "items": ["...", "...", "...", "..."]},
  {"layout": "example_highlight", "title": "Exemplo prático", "sectionLabel": "ESTUDO DE CASO", "items": ["...", "...", "..."]},
  {"layout": "summary_slide", "title": "Resumo", "items": ["...", "..."]},
  {"layout": "numbered_takeaways", "title": "Key Takeaways", "items": ["...", "...", "...", "..."]}
]`;
}

async function callAI(model: string, prompt: string): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Você é um assistente que retorna APENAS JSON válido. Sem explicações, sem markdown code fences, apenas o JSON puro." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error(`[V3-AI] Gateway error ${response.status}:`, errText.substring(0, 300));
    throw new Error(`AI Gateway error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

function normalizeSlide(s: any): SlidePlan {
  return {
    layout: s.layout as SlideLayoutV2,
    title: (s.title || "").substring(0, 80),
    sectionLabel: s.sectionLabel || "",
    items: Array.isArray(s.items) ? s.items.filter((i: any) => typeof i === "string" && i.trim().length > 3) : [],
    objectives: Array.isArray(s.objectives) ? s.objectives : [],
    tableHeaders: Array.isArray(s.headers) ? s.headers : undefined,
    tableRows: Array.isArray(s.rows) ? s.rows : undefined,
    blockType: layoutToBlockType(s.layout),
  };
}

function layoutToBlockType(layout: string): string {
  const map: Record<string, string> = {
    example_highlight: "example",
    reflection_callout: "reflection",
    warning_callout: "warning",
    summary_slide: "summary",
    numbered_takeaways: "conclusion",
  };
  return map[layout] || "normal";
}

function buildFallbackSlides(title: string, content: string): SlidePlan[] {
  const sentences = content
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 160)
    .slice(0, 6);

  return [
    { layout: "module_cover", title, objectives: sentences.slice(0, 3), items: [] },
    { layout: "bullets", title, sectionLabel: "CONTEÚDO", items: sentences, blockType: "normal" },
    { layout: "numbered_takeaways", title: "Key Takeaways", items: sentences.slice(0, 4), blockType: "conclusion" },
  ];
}

async function generateSlidesForModule(
  moduleTitle: string,
  moduleContent: string,
  options: ExportOptions,
): Promise<SlidePlan[]> {
  const prompt = buildSlidePrompt(moduleTitle, moduleContent, options);

  let raw: string;
  try {
    raw = await callAI("google/gemini-2.5-flash", prompt);
  } catch (err: any) {
    console.error(`[V3] AI call failed for module "${moduleTitle}":`, err.message);
    return buildFallbackSlides(moduleTitle, moduleContent);
  }

  // Strip markdown code fences if present
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: any[];
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Fallback: try to extract JSON array from response
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        console.error("[V3] JSON parse failed (even with extraction) for module:", moduleTitle);
        return buildFallbackSlides(moduleTitle, moduleContent);
      }
    } else {
      console.error("[V3] JSON parse failed for module:", moduleTitle);
      return buildFallbackSlides(moduleTitle, moduleContent);
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.error("[V3] AI returned empty or non-array for module:", moduleTitle);
    return buildFallbackSlides(moduleTitle, moduleContent);
  }

  // Validate and normalize each slide
  return parsed
    .filter((s) => s && typeof s === "object" && s.layout)
    .map((s) => normalizeSlide(s));
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 5: RENDER PRIMITIVES (identical to v2)
// ═══════════════════════════════════════════════════════════════════

let _globalSlideIdx = 0;
let _globalSlideNumber = 0;
let _globalTotalSlides = 0;
let _globalFooterBrand: string | null = "EduGenAI";

function addSlideBackground(slide: any, color: string) {
  slide.addShape("rect" as any, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color } });
}

function addHR(slide: any, x: number, y: number, w: number, color: string, h = 0.012) {
  slide.addShape("rect" as any, { x, y, w, h, fill: { color } });
}

function addGradientBar(slide: any, x: number, y: number, w: number, h: number, color: string, direction: "right" | "down") {
  const steps = 8;
  if (direction === "right") {
    const stepW = w / steps;
    for (let i = 0; i < steps; i++) {
      slide.addShape("rect" as any, { x: x + i * stepW, y, w: stepW + 0.01, h, fill: { color }, transparency: Math.floor(i * (70 / steps)) });
    }
  } else {
    const stepH = h / steps;
    for (let i = 0; i < steps; i++) {
      slide.addShape("rect" as any, { x, y: y + i * stepH, w, h: stepH + 0.01, fill: { color }, transparency: Math.floor(i * (70 / steps)) });
    }
  }
}

function addCardShadow(slide: any, x: number, y: number, w: number, h: number, shadowColor: string, isLightTheme = false) {
  slide.addShape("roundRect" as any, { x: x + 0.03, y: y + 0.04, w, h, fill: { color: shadowColor }, transparency: isLightTheme ? 78 : 88, rectRadius: 0.10 });
}

function addLeftEdge(slide: any, color: string) {
  slide.addShape("rect" as any, { x: 0, y: 0, w: 0.09, h: SLIDE_H, fill: { color } });
  slide.addShape("rect" as any, { x: 0.09, y: 0, w: 0.03, h: SLIDE_H, fill: { color }, transparency: 50 });
}

function addSectionLabel(slide: any, label: string, accentColor: string, fontBody: string) {
  slide.addText(label.toUpperCase(), { x: 0.55, y: 0.28, w: 6.0, h: 0.24, fontSize: 9, fontFace: fontBody, bold: true, color: accentColor, charSpacing: 5.5 });
  addHR(slide, 0.55, 0.54, 0.70, accentColor, 0.024);
}

function addSlideTitle(slide: any, title: string, colors: ReturnType<typeof getColors>, fontTitle: string, accentColor?: string) {
  slide.addText(title, { x: 0.55, y: 0.64, w: SLIDE_W - 1.10, h: 0.85, fontSize: TYPO.SECTION_TITLE, fontFace: fontTitle, bold: true, color: colors.text, valign: "middle", lineSpacingMultiple: 1.05 });
  if (accentColor) {
    addHR(slide, 0.55, 1.52, SLIDE_W - 1.10, accentColor, 0.008);
    addHR(slide, 0.55, 1.54, SLIDE_W - 1.10, colors.divider, 0.004);
  }
}

function addFooter(slide: any, colors: ReturnType<typeof getColors>, fontBody: string, slideNumber?: number, totalSlides?: number, footerBrand?: string | null) {
  addGradientBar(slide, 0, SLIDE_H - 0.34, SLIDE_W, 0.005, colors.p0, "right");
  addHR(slide, 0, SLIDE_H - 0.335, SLIDE_W, colors.divider, 0.003);
  if (slideNumber !== undefined && totalSlides !== undefined) {
    slide.addText(`${slideNumber} / ${totalSlides}`, { x: 0.55, y: SLIDE_H - 0.30, w: 1.20, h: 0.20, fontSize: 8, fontFace: fontBody, color: colors.textSecondary, align: "left", valign: "middle" });
  }
  if (footerBrand) {
    slide.addText(footerBrand, { x: SLIDE_W - 1.80, y: SLIDE_H - 0.30, w: 1.50, h: 0.20, fontSize: 8, fontFace: fontBody, bold: true, color: colors.textSecondary, align: "right", valign: "middle", charSpacing: 3 });
    slide.addShape("ellipse" as any, { x: SLIDE_W - 1.92, y: SLIDE_H - 0.24, w: 0.08, h: 0.08, fill: { color: colors.p0 } });
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 6: RENDER FUNCTIONS (identical to v2)
// ═══════════════════════════════════════════════════════════════════

function renderCoverSlide(pptx: PptxGenJS, courseTitle: string, design: DesignConfig, image?: SlideImage | null) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  if (image) {
    try { slide.addImage({ data: image.base64Data, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }); } catch { addSlideBackground(slide, colors.coverDark); }
    slide.addShape("rect" as any, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: "000000" }, transparency: 45 });
  } else {
    addSlideBackground(slide, colors.coverDark);
  }
  if (!image) {
    addGradientBar(slide, SLIDE_W * 0.50, 0, SLIDE_W * 0.55, SLIDE_H, colors.p0, "down");
    slide.addShape("ellipse" as any, { x: SLIDE_W * 0.55, y: -SLIDE_H * 0.35, w: SLIDE_W * 0.70, h: SLIDE_W * 0.70, fill: { color: colors.p1 }, transparency: 92 });
  }
  if (design.theme === "light" && !image) {
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      slide.addShape("ellipse" as any, { x: SLIDE_W - 2.80 + col * 0.55, y: 0.60 + row * 0.55, w: 0.08, h: 0.08, fill: { color: colors.p0 }, transparency: 70 });
    }
  }
  slide.addShape("rect" as any, { x: 0.80, y: 0.90, w: 0.035, h: SLIDE_H - 1.80, fill: { color: colors.p0 }, transparency: 30 });
  if (!image) {
    for (let b = 0; b < 5; b++) slide.addShape("roundRect" as any, { x: 0.28, y: 1.10 + b * 0.30, w: 0.32, h: 0.18, fill: { color: design.palette[b % design.palette.length] }, transparency: 15, rectRadius: 0.04 });
  }
  addHR(slide, 1.20, 1.30, 3.50, colors.p0, 0.018);
  slide.addText(design.courseType || "CURSO COMPLETO", { x: 1.20, y: 1.55, w: 5.0, h: 0.28, fontSize: 10, fontFace: design.fonts.body, bold: true, color: colors.p0, charSpacing: 8 });
  slide.addText(courseTitle, { x: 1.20, y: 2.00, w: SLIDE_W * 0.52, h: 3.30, fontSize: 52, fontFace: design.fonts.title, bold: true, color: "FFFFFF", valign: "top", lineSpacingMultiple: 0.96 });
  addGradientBar(slide, 1.20, 5.50, 3.00, 0.07, colors.p0, "right");
  if (!image) {
    for (let i = 0; i < 3; i++) {
      const sz = 0.50 + i * 0.35;
      slide.addShape("roundRect" as any, { x: SLIDE_W - 2.60 + i * 0.55, y: 0.40 + i * 0.90, w: sz, h: sz, fill: { color: design.palette[i % design.palette.length] }, transparency: 82, rectRadius: 0.06 });
    }
  }
  slide.addShape("ellipse" as any, { x: 1.20, y: 5.82, w: 0.12, h: 0.12, fill: { color: colors.p0 } });
  addHR(slide, 1.20, SLIDE_H - 1.20, 3.00, colors.p0, 0.012);
  const dateStr = new Intl.DateTimeFormat("pt-BR", { year: "numeric", month: "long" }).format(new Date());
  slide.addText(dateStr, { x: SLIDE_W - 3.00, y: SLIDE_H - 0.65, w: 2.60, h: 0.30, fontSize: 10, fontFace: design.fonts.body, color: colors.coverSubtext, align: "right", charSpacing: 2.5 });
  if (image) addImageCredit(slide, image.credit, design);
}

function renderTOC(pptx: PptxGenJS, modules: { title: string; description?: string }[], design: DesignConfig) {
  const colors = getColors(design);
  const MAX_PER_PAGE = 6;
  const pages: { title: string; description?: string }[][] = [];
  for (let i = 0; i < modules.length; i += MAX_PER_PAGE) pages.push(modules.slice(i, i + MAX_PER_PAGE));

  for (let page = 0; page < pages.length; page++) {
    const pageModules = pages[page];
    const slide = pptx.addSlide();
    addSlideBackground(slide, colors.coverDark);
    addHR(slide, 0, 0.03, SLIDE_W, colors.p0, 0.045);
    slide.addText("CONTEÚDO PROGRAMÁTICO", { x: 0.65, y: 0.32, w: 6.0, h: 0.24, fontSize: 10, fontFace: design.fonts.body, bold: true, color: colors.p0, charSpacing: 6 });
    slide.addText(pages.length > 1 ? `Índice  ·  ${page + 1}/${pages.length}` : "Índice", { x: 0.65, y: 0.62, w: 8.0, h: 0.60, fontSize: 32, fontFace: design.fonts.title, bold: true, color: "FFFFFF", valign: "middle" });
    addHR(slide, 0.65, 1.30, 2.00, colors.p0, 0.030);
    const progressY = 1.50;
    slide.addShape("rect" as any, { x: 0.65, y: progressY, w: SLIDE_W - 1.30, h: 0.04, fill: { color: colors.panelMid } });
    slide.addShape("rect" as any, { x: 0.65, y: progressY, w: (SLIDE_W - 1.30) * ((page + 1) / pages.length), h: 0.04, fill: { color: colors.p0 } });

    const globalOffset = page * MAX_PER_PAGE;
    const useListLayout = modules.length > 5;
    if (useListLayout) {
      const itemH = Math.min(0.85, (SLIDE_H - 1.80 - 0.45) / pageModules.length);
      for (let i = 0; i < pageModules.length; i++) {
        const mod = pageModules[i];
        const pal = design.palette[(globalOffset + i) % design.palette.length];
        const y = 1.80 + i * (itemH + 0.08);
        slide.addShape("roundRect" as any, { x: 0.65, y: y + itemH / 2 - 0.18, w: 0.36, h: 0.36, fill: { color: pal }, rectRadius: 0.06 });
        slide.addText(String(globalOffset + i + 1), { x: 0.65, y: y + itemH / 2 - 0.18, w: 0.36, h: 0.36, fontSize: 13, fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
        slide.addText(mod.title, { x: 1.18, y, w: 5.50, h: itemH, fontSize: 13, fontFace: design.fonts.title, bold: true, color: "FFFFFF", valign: "middle" });
        if (mod.description) slide.addText(mod.description, { x: 7.00, y, w: SLIDE_W - 7.50, h: itemH, fontSize: 10, fontFace: design.fonts.body, color: colors.coverSubtext, valign: "middle", lineSpacingMultiple: 1.15 });
        if (i < pageModules.length - 1) addHR(slide, 0.65, y + itemH + 0.04, SLIDE_W - 1.20, colors.divider, 0.008);
      }
    } else {
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
        const num = String(globalOffset + i + 1);
        slide.addShape("roundRect" as any, { x: x + 0.02, y: y + 0.03, w: cardW, h: cardH, fill: { color: "000000" }, transparency: 70, rectRadius: 0.12 });
        slide.addShape("roundRect" as any, { x, y, w: cardW, h: cardH, fill: { color: colors.panelMid }, rectRadius: 0.12 });
        slide.addShape("rect" as any, { x, y, w: 0.05, h: cardH, fill: { color: pal }, rectRadius: 0.12 });
        const badgeS = Math.min(0.44, cardH * 0.25);
        slide.addShape("roundRect" as any, { x: x + 0.14, y: y + 0.14, w: badgeS, h: badgeS, fill: { color: pal }, rectRadius: 0.08 });
        slide.addText(num, { x: x + 0.14, y: y + 0.14, w: badgeS, h: badgeS, fontSize: Math.min(18, badgeS * 38), fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
        const titleY = y + 0.14 + badgeS + 0.08;
        const titleH = Math.min(0.60, (cardH - badgeS - 0.36) * 0.50);
        slide.addText(pageModules[i].title, { x: x + 0.14, y: titleY, w: cardW - 0.28, h: titleH, fontSize: cardH < 1.4 ? 12 : 14, fontFace: design.fonts.title, bold: true, color: "FFFFFF", valign: "top", lineSpacingMultiple: 1.06, autoFit: true } as any);
        const sepY = titleY + titleH + 0.04;
        addHR(slide, x + 0.14, sepY, cardW * 0.45, pal, 0.010);
        if (pageModules[i].description) {
          const descY = sepY + 0.06;
          const descH = Math.max(0.20, y + cardH - descY - 0.12);
          slide.addText(pageModules[i].description!, { x: x + 0.14, y: descY, w: cardW - 0.28, h: descH, fontSize: cardH < 1.4 ? 9 : 11, fontFace: design.fonts.body, color: colors.coverSubtext, valign: "top", lineSpacingMultiple: 1.18 });
        }
        slide.addShape("ellipse" as any, { x: x + cardW - 0.26, y: y + cardH - 0.22, w: 0.08, h: 0.08, fill: { color: pal }, transparency: 40 });
      }
    }
  }
}

function renderModuleCover(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig, image?: SlideImage | null) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  const modIdx = (plan.moduleIndex ?? 0);
  const modNum = String(modIdx + 1);
  const accentColor = design.palette[modIdx % design.palette.length];
  const hasImage = !!image;
  const contentW = hasImage ? SLIDE_W * 0.62 : SLIDE_W;
  addSlideBackground(slide, colors.coverDark);
  if (hasImage) {
    const imgX = contentW;
    const imgW = SLIDE_W - contentW;
    try { slide.addImage({ data: image!.base64Data, x: imgX, y: 0, w: imgW, h: SLIDE_H }); } catch {}
    slide.addShape("rect" as any, { x: imgX, y: 0, w: 0.04, h: SLIDE_H, fill: { color: accentColor } });
    addImageCredit(slide, image!.credit, design);
  }
  addGradientBar(slide, contentW * 0.60, 0, contentW * 0.45, SLIDE_H, accentColor, "down");
  if (!hasImage) {
    slide.addText(modNum, { x: contentW - 5.20, y: 2.20, w: 4.80, h: 4.00, fontSize: 180, fontFace: design.fonts.title, bold: true, color: accentColor, transparency: 90, align: "right", valign: "bottom" });
    slide.addShape("ellipse" as any, { x: contentW - 3.00, y: -0.60, w: 3.50, h: 3.50, fill: { color: accentColor }, transparency: 90 });
    slide.addShape("ellipse" as any, { x: contentW - 1.80, y: 0.65, w: 0.16, h: 0.16, fill: { color: accentColor }, transparency: 20 });
  }
  slide.addShape("rect" as any, { x: 0.80, y: 1.10, w: 0.05, h: 2.30, fill: { color: accentColor } });
  slide.addShape("rect" as any, { x: 0.88, y: 1.10, w: 0.015, h: 2.30, fill: { color: accentColor }, transparency: 50 });
  slide.addText(`MÓDULO ${modNum}`, { x: 1.10, y: 1.20, w: 5.0, h: 0.28, fontSize: 11, fontFace: design.fonts.body, bold: true, color: accentColor, charSpacing: 8 });
  addHR(slide, 1.10, 1.62, 1.40, accentColor, 0.022);
  const titleW = hasImage ? contentW * 0.75 : SLIDE_W * 0.53;
  slide.addText(plan.title, { x: 1.10, y: 1.85, w: titleW, h: 2.50, fontSize: 36, fontFace: design.fonts.title, bold: true, color: "FFFFFF", valign: "top", lineSpacingMultiple: 1.02 });
  if (plan.objectives && plan.objectives.length > 0) {
    const objStartY = 4.65;
    const objW = hasImage ? contentW * 0.70 : SLIDE_W * 0.48;
    addHR(slide, 1.10, objStartY - 0.12, 2.20, accentColor, 0.012);
    slide.addText("O QUE VOCÊ VAI APRENDER", { x: 1.10, y: objStartY, w: 5.0, h: 0.22, fontSize: 8, fontFace: design.fonts.body, bold: true, color: accentColor, charSpacing: 5 });
    for (let i = 0; i < Math.min(plan.objectives.length, 3); i++) {
      const objY = objStartY + 0.32 + i * 0.44;
      slide.addShape("roundRect" as any, { x: 1.10, y: objY + 0.05, w: 0.12, h: 0.12, fill: { color: accentColor }, rectRadius: 0.02 });
      slide.addText(plan.objectives[i], { x: 1.35, y: objY, w: objW, h: 0.38, fontSize: 11, fontFace: design.fonts.body, color: colors.coverSubtext, valign: "middle", lineSpacingMultiple: 1.12 });
    }
  }
  addGradientBar(slide, 0.80, SLIDE_H - 0.45, 3.50, 0.008, accentColor, "right");
}

function renderBullets(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
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
    addSlideBackground(slide, colors.bg);
    addLightBgDecoration(slide, design, colors);
    const sideW = SLIDE_W * 0.35;
    slide.addShape("rect" as any, { x: 0, y: 0, w: sideW, h: SLIDE_H, fill: { color: colors.coverDark } });
    addGradientBar(slide, 0, 0, sideW, SLIDE_H, accentColor, "down");
    slide.addShape("rect" as any, { x: sideW, y: 0, w: 0.05, h: SLIDE_H, fill: { color: accentColor } });
    slide.addShape("rect" as any, { x: sideW + 0.05, y: 0, w: 0.015, h: SLIDE_H, fill: { color: accentColor }, transparency: 50 });
    if (plan.sectionLabel) {
      slide.addText(plan.sectionLabel.toUpperCase(), { x: 0.45, y: 0.55, w: sideW - 0.90, h: 0.22, fontSize: 9, fontFace: design.fonts.body, bold: true, color: accentColor, charSpacing: 4 });
      addHR(slide, 0.45, 0.82, 1.20, accentColor, 0.012);
    }
    slide.addText(plan.title, { x: 0.45, y: 1.00, w: sideW - 0.90, h: 3.40, fontSize: 24, fontFace: design.fonts.title, bold: true, color: "FFFFFF", valign: "top", lineSpacingMultiple: 1.08 });
    for (let d = 0; d < Math.min(items.length, 5); d++) slide.addShape("ellipse" as any, { x: 0.45, y: 4.80 + d * 0.40, w: 0.10, h: 0.10, fill: { color: design.palette[d % design.palette.length] } });
    const rightX = sideW + 0.35;
    const rightW = SLIDE_W - rightX - 0.45;
    const rightY = 0.50;
    const rightH = SLIDE_H - rightY - 0.70;
    const rBulletGap = items.length >= 7 ? 0.03 : bulletGap;
    const rItemH = Math.max(0.42, Math.min(1.10, (rightH - rBulletGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1)));
    for (let i = 0; i < items.length; i++) {
      const yPos = rightY + i * (rItemH + rBulletGap);
      const pal = design.palette[i % design.palette.length];
      slide.addShape("rect" as any, { x: rightX, y: yPos + 0.06, w: 0.045, h: rItemH - 0.16, fill: { color: pal } });
      const aFontSize = items.length >= 6 ? TYPO.BULLET_TEXT - 2 : items.length >= 4 ? TYPO.BULLET_TEXT - 1 : TYPO.BULLET_TEXT;
      slide.addText(items[i], { x: rightX + 0.18, y: yPos, w: rightW - 0.18, h: rItemH, fontSize: aFontSize, fontFace: design.fonts.body, color: colors.text, valign: "middle", lineSpacingMultiple: 1.18, autoFit: true } as any);
      if (i < items.length - 1) addHR(slide, rightX + 0.18, yPos + rItemH + rBulletGap / 2 - 0.003, rightW - 0.18, colors.divider, 0.005);
    }
  } else if (variant === 1) {
    addSlideBackground(slide, colors.bg);
    addLightBgDecoration(slide, design, colors);
    addLeftEdge(slide, accentColor);
    if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, accentColor, design.fonts.body);
    addSlideTitle(slide, plan.title, colors, design.fonts.title, accentColor);
    for (let i = 0; i < items.length; i++) {
      const pal = design.palette[i % design.palette.length];
      const yPos = contentY + i * (itemH + bulletGap);
      addCardShadow(slide, contentX, yPos, contentW, itemH - 0.04, colors.shadowColor, design.theme === "light");
      slide.addShape("roundRect" as any, { x: contentX, y: yPos, w: contentW, h: itemH - 0.04, fill: { color: colors.cardBg }, rectRadius: 0.08, line: { color: colors.borders, width: 0.3 } });
      slide.addShape("rect" as any, { x: contentX, y: yPos, w: 0.06, h: itemH - 0.04, fill: { color: pal }, rectRadius: 0.08 });
      const badgeSize = Math.min(0.34, itemH - 0.14);
      const badgeFontSize = badgeSize >= 0.30 ? 13 : 10;
      slide.addShape("roundRect" as any, { x: contentX + 0.18, y: yPos + (itemH - 0.04) / 2 - badgeSize / 2, w: badgeSize, h: badgeSize, fill: { color: pal }, rectRadius: 0.06 });
      slide.addText(String(i + 1), { x: contentX + 0.18, y: yPos + (itemH - 0.04) / 2 - badgeSize / 2, w: badgeSize, h: badgeSize, fontSize: badgeFontSize, fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
      const textFontSize = items.length >= 6 ? TYPO.BULLET_TEXT - 2 : TYPO.BULLET_TEXT - 1;
      slide.addText(items[i], { x: contentX + 0.18 + badgeSize + 0.14, y: yPos + 0.03, w: contentW - badgeSize - 0.42, h: itemH - 0.10, fontSize: textFontSize, fontFace: design.fonts.body, color: colors.text, valign: "middle", lineSpacingMultiple: 1.18, autoFit: true } as any);
    }
  } else if (variant === 2) {
    addSlideBackground(slide, colors.bg);
    addLightBgDecoration(slide, design, colors);
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
      addCardShadow(slide, x, y, cardW, cardH, colors.shadowColor, design.theme === "light");
      slide.addShape("roundRect" as any, { x, y, w: cardW, h: cardH, fill: { color: colors.cardBg }, rectRadius: 0.10 });
      slide.addShape("rect" as any, { x, y, w: 0.06, h: cardH, fill: { color: pal }, rectRadius: 0.10 });
      slide.addText(String(i + 1), { x: x + 0.12, y: y + 0.06, w: 0.40, h: 0.34, fontSize: Math.min(15, cardW > 3 ? 16 : 13), fontFace: design.fonts.title, bold: true, color: ensureContrastOnLight(pal, colors.cardBg), transparency: 15, align: "left" });
      slide.addText(items[i], { x: x + 0.14, y: y + 0.38, w: cardW - 0.28, h: cardH - 0.48, fontSize: TYPO.BULLET_TEXT - 1, fontFace: design.fonts.body, color: colors.text, valign: "top", lineSpacingMultiple: 1.18 });
    }
  } else {
    addSlideBackground(slide, colors.bg);
    addLightBgDecoration(slide, design, colors);
    addLeftEdge(slide, accentColor);
    if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, accentColor, design.fonts.body);
    addSlideTitle(slide, plan.title, colors, design.fonts.title, accentColor);
    if (items.length > 0) {
      const heroH = items.length === 1 ? contentH : Math.min(1.60, contentH * 0.40);
      slide.addShape("roundRect" as any, { x: contentX, y: contentY, w: contentW, h: heroH, fill: { color: colors.coverDark }, rectRadius: 0.10 });
      slide.addShape("rect" as any, { x: contentX + 0.14, y: contentY + 0.14, w: 0.05, h: heroH - 0.28, fill: { color: accentColor } });
      slide.addText(items[0], { x: contentX + 0.32, y: contentY + 0.08, w: contentW - 0.48, h: heroH - 0.16, fontSize: TYPO.BODY_LARGE, fontFace: design.fonts.body, color: "FFFFFF", valign: "middle", lineSpacingMultiple: 1.30, italic: true, autoFit: true } as any);
      if (items.length > 1) {
        const restY = contentY + heroH + 0.18;
        const restH = SLIDE_H - restY - 0.45;
        const restItemH = Math.min(0.80, (restH - 0.06 * (items.length - 2)) / (items.length - 1));
        for (let i = 1; i < items.length; i++) {
          const yPos = restY + (i - 1) * (restItemH + 0.06);
          const pal = design.palette[i % design.palette.length];
          slide.addShape("ellipse" as any, { x: contentX + 0.04, y: yPos + restItemH / 2 - 0.05, w: 0.10, h: 0.10, fill: { color: pal } });
          slide.addText(items[i], { x: contentX + 0.22, y: yPos, w: contentW - 0.22, h: restItemH, fontSize: items.length >= 5 ? TYPO.BULLET_TEXT - 2 : TYPO.BULLET_TEXT - 1, fontFace: design.fonts.body, color: colors.text, valign: "middle", lineSpacingMultiple: 1.15 });
        }
      }
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

function renderTwoColumnBullets(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);
  addLightBgDecoration(slide, design, colors);
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
  const divX = contentX + colW + colGap / 2;
  slide.addShape("rect" as any, { x: divX - 0.010, y: contentY, w: 0.020, h: SLIDE_H - contentY - 0.45, fill: { color: pal }, transparency: 50 });
  slide.addShape("ellipse" as any, { x: divX - 0.05, y: contentY + (SLIDE_H - contentY - 0.45) / 2 - 0.05, w: 0.10, h: 0.10, fill: { color: pal } });
  for (let col = 0; col < 2; col++) {
    const colItems = col === 0 ? leftItems : rightItems;
    const colX = contentX + col * (colW + colGap);
    const colBulletGap = colItems.length >= 5 ? 0.04 : 0.06;
    const colContentH = SLIDE_H - contentY - 0.40;
    const rawIH = (colContentH - colBulletGap * Math.max(colItems.length - 1, 0)) / Math.max(colItems.length, 1);
    const iH = Math.max(0.42, Math.min(1.10, rawIH));
    for (let i = 0; i < colItems.length; i++) {
      const palColor = design.palette[(col * mid + i) % design.palette.length];
      const yPos = contentY + i * (iH + colBulletGap);
      addCardShadow(slide, colX, yPos, colW, iH - 0.02, colors.shadowColor, design.theme === "light");
      slide.addShape("roundRect" as any, { x: colX, y: yPos, w: colW, h: iH - 0.02, fill: { color: colors.cardBg }, rectRadius: 0.06 });
      slide.addShape("rect" as any, { x: colX, y: yPos, w: 0.05, h: iH - 0.02, fill: { color: palColor }, rectRadius: 0.06 });
      const badgeW = 0.30;
      slide.addShape("roundRect" as any, { x: colX + 0.14, y: yPos + (iH - 0.02) / 2 - badgeW / 2, w: badgeW, h: badgeW, fill: { color: palColor }, rectRadius: 0.06 });
      slide.addText(String(col * mid + i + 1), { x: colX + 0.14, y: yPos + (iH - 0.02) / 2 - badgeW / 2, w: badgeW, h: badgeW, fontSize: 11, fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
      slide.addText(colItems[i], { x: colX + 0.52, y: yPos + 0.03, w: colW - 0.60, h: iH - 0.08, fontSize: TYPO.BULLET_TEXT - 1, fontFace: design.fonts.body, color: colors.text, valign: "middle", lineSpacingMultiple: 1.18 });
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

function renderGridCards(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);
  addLightBgDecoration(slide, design, colors);
  const pal = design.palette[_globalSlideIdx % design.palette.length];
  addLeftEdge(slide, pal);
  if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, pal, design.fonts.body);
  addSlideTitle(slide, plan.title, colors, design.fonts.title, pal);
  const items = plan.items || [];
  const contentX = 0.65;
  const contentW = SLIDE_W - contentX - 0.50;
  const contentY = 1.68;
  const cols = items.length <= 3 ? items.length : items.length <= 4 ? 2 : 3;
  const rows = Math.ceil(items.length / cols);
  const gap = 0.18;
  const cardW = (contentW - gap * (cols - 1)) / cols;
  const contentArea = SLIDE_H - contentY - 0.50;
  const cardH = Math.min(2.20, (contentArea - gap * (rows - 1)) / rows);
  for (let i = 0; i < items.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = contentX + col * (cardW + gap);
    const y = contentY + row * (cardH + gap);
    const palC = design.palette[i % design.palette.length];
    addCardShadow(slide, x, y, cardW, cardH, colors.shadowColor, design.theme === "light");
    slide.addShape("roundRect" as any, { x, y, w: cardW, h: cardH, fill: { color: colors.cardBg }, rectRadius: 0.10 });
    slide.addShape("rect" as any, { x, y, w: cardW, h: 0.05, fill: { color: palC }, rectRadius: 0.10 });
    const colonIdx = items[i].indexOf(":");
    if (colonIdx > 0 && colonIdx < 40) {
      const label = items[i].substring(0, colonIdx).trim();
      const desc = items[i].substring(colonIdx + 1).trim();
      const gcBadge = Math.min(0.30, cardW * 0.12, cardH * 0.15);
      slide.addShape("roundRect" as any, { x: x + 0.10, y: y + 0.14, w: gcBadge, h: gcBadge, fill: { color: palC }, rectRadius: 0.06 });
      slide.addText(String(i + 1), { x: x + 0.10, y: y + 0.14, w: gcBadge, h: gcBadge, fontSize: Math.min(12, gcBadge * 34), fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
      const labelX = x + 0.10 + gcBadge + 0.08;
      const labelW = x + cardW - labelX - 0.10;
      slide.addText(label, { x: labelX, y: y + 0.12, w: labelW, h: 0.38, fontSize: items.length >= 6 ? TYPO.CARD_TITLE - 1 : TYPO.CARD_TITLE, fontFace: design.fonts.title, bold: true, color: ensureContrastOnLight(palC, colors.cardBg), valign: "middle", lineSpacingMultiple: 1.10 });
      const sepY = y + 0.56;
      addHR(slide, x + 0.10, sepY, cardW - 0.20, colors.borders, 0.004);
      slide.addText(desc, { x: x + 0.12, y: sepY + 0.08, w: cardW - 0.24, h: Math.max(0.30, y + cardH - sepY - 0.16), fontSize: items.length >= 6 ? TYPO.CARD_BODY - 1 : TYPO.CARD_BODY, fontFace: design.fonts.body, color: colors.text, valign: "top", lineSpacingMultiple: 1.18 });
    } else {
      const gcBadge = Math.min(0.32, cardW * 0.15, cardH * 0.20);
      slide.addShape("roundRect" as any, { x: x + 0.10, y: y + 0.14, w: gcBadge, h: gcBadge, fill: { color: palC }, rectRadius: 0.06 });
      slide.addText(String(i + 1), { x: x + 0.10, y: y + 0.14, w: gcBadge, h: gcBadge, fontSize: Math.min(12, gcBadge * 34), fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
      slide.addText(items[i], { x: x + 0.12, y: y + 0.14 + gcBadge + 0.10, w: cardW - 0.24, h: cardH - (0.14 + gcBadge + 0.18), fontSize: items.length >= 6 ? TYPO.CARD_BODY - 1 : TYPO.CARD_BODY, fontFace: design.fonts.body, color: colors.text, valign: "top", lineSpacingMultiple: 1.18 });
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

function renderProcessTimeline(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  const items = plan.items || [];
  const contentX = 0.55;
  const contentW = SLIDE_W - contentX - 0.40;
  // For v3, process_timeline maps to vertical timeline always (simpler)
  addSlideBackground(slide, colors.bg);
  addLightBgDecoration(slide, design, colors);
  addLeftEdge(slide, colors.p2);
  if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, colors.p2, design.fonts.body);
  addSlideTitle(slide, plan.title, colors, design.fonts.title, colors.p2);
  const vContentY = 1.55;
  const vContentH = SLIDE_H - vContentY - 0.35;
  const stepGap = items.length <= 5 ? 0.06 : 0.03;
  const stepH = (vContentH - stepGap * (items.length - 1)) / items.length;
  const nodeSize = items.length <= 5 ? 0.28 : 0.22;
  const nodeX = contentX + 0.10;
  const lineX = nodeX + nodeSize / 2 - 0.012;
  slide.addShape("rect" as any, { x: lineX, y: vContentY + nodeSize / 2, w: 0.024, h: vContentH - nodeSize, fill: { color: colors.divider } });
  for (let i = 0; i < items.length; i++) {
    const y = vContentY + i * (stepH + stepGap);
    const pal = design.palette[i % design.palette.length];
    slide.addShape("roundRect" as any, { x: nodeX, y: y + stepH / 2 - nodeSize / 2, w: nodeSize, h: nodeSize, fill: { color: pal }, rectRadius: 0.05 });
    slide.addText(String(i + 1), { x: nodeX, y: y + stepH / 2 - nodeSize / 2, w: nodeSize, h: nodeSize, fontSize: items.length <= 5 ? 12 : 10, fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
    const cardX = nodeX + nodeSize + 0.16;
    const cardW = contentW - (cardX - contentX);
    addCardShadow(slide, cardX, y, cardW, stepH - 0.02, colors.shadowColor, design.theme === "light");
    slide.addShape("roundRect" as any, { x: cardX, y, w: cardW, h: stepH - 0.02, fill: { color: colors.cardBg }, rectRadius: 0.06 });
    slide.addShape("rect" as any, { x: cardX, y, w: 0.05, h: stepH - 0.02, fill: { color: pal }, rectRadius: 0.06 });
    const colonIdx = items[i].indexOf(":");
    let label: string, desc: string;
    if (colonIdx > 0 && colonIdx < 40) { label = items[i].substring(0, colonIdx).trim(); desc = items[i].substring(colonIdx + 1).trim(); }
    else { label = ""; desc = items[i]; }
    const textX = cardX + 0.05 + 0.12;
    const textW = cardW - 0.05 - 0.22;
    const fontSize = items.length <= 5 ? TYPO.BULLET_TEXT : TYPO.BULLET_TEXT - 1;
    if (label) {
      slide.addText(label, { x: textX, y: y + 0.02, w: textW, h: stepH * 0.38, fontSize, fontFace: design.fonts.title, bold: true, color: pal, valign: "bottom" });
      slide.addText(desc, { x: textX, y: y + stepH * 0.38, w: textW, h: stepH * 0.58, fontSize: fontSize - 1, fontFace: design.fonts.body, color: colors.text, valign: "top", lineSpacingMultiple: 1.10 });
    } else {
      slide.addText(desc, { x: textX, y, w: textW, h: stepH - 0.02, fontSize, fontFace: design.fonts.body, color: colors.text, valign: "middle", lineSpacingMultiple: 1.12 });
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

function renderComparisonTable(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);
  addLightBgDecoration(slide, design, colors);
  addLeftEdge(slide, colors.p0);
  if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, colors.p0, design.fonts.body);
  addSlideTitle(slide, plan.title, colors, design.fonts.title, colors.p0);
  const headers = plan.tableHeaders || [];
  const rows = plan.tableRows || [];
  if (headers.length === 0) { renderBullets(pptx, plan, design); return; }
  const contentX = 0.65;
  const contentW = SLIDE_W - contentX - 0.50;
  const tableData: any[][] = [];
  tableData.push(headers.map((h) => ({ text: h, options: { fontSize: TYPO.TABLE_HEADER, fontFace: design.fonts.title, bold: true, color: "FFFFFF", fill: { color: colors.p0 }, align: "center", valign: "middle" } })));
  for (let r = 0; r < rows.length; r++) {
    tableData.push(rows[r].map((cell) => ({ text: cell, options: { fontSize: TYPO.TABLE_CELL, fontFace: design.fonts.body, color: colors.text, fill: { color: r % 2 === 0 ? colors.tableRowOdd : colors.tableRowEven }, valign: "middle" } })));
  }
  slide.addTable(tableData, { x: contentX, y: 1.68, w: contentW, colW: new Array(headers.length).fill(contentW / headers.length), rowH: 0.48, border: { type: "solid", pt: 0.3, color: colors.borders }, autoPage: false });
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

function renderExampleHighlight(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  const items = (plan.items || []).slice(0, 5);
  const defaultLabels = ["Contexto", "Desafio", "Solução", "Implementação", "Resultado"];
  const phaseColors = [colors.p1, colors.p3, colors.p0, colors.p2, colors.p4];
  addSlideBackground(slide, colors.coverDark);
  slide.addShape("rect" as any, { x: 0, y: 0, w: 0.50, h: SLIDE_H, fill: { color: colors.panelMid } });
  for (let i = 0; i < Math.min(items.length, 5); i++) {
    const dotY = 1.60 + i * ((SLIDE_H - 2.20) / Math.max(items.length - 1, 1));
    slide.addShape("ellipse" as any, { x: 0.18, y: dotY - 0.05, w: 0.14, h: 0.14, fill: { color: phaseColors[i] } });
    if (i < items.length - 1) {
      const nextY = 1.60 + (i + 1) * ((SLIDE_H - 2.20) / Math.max(items.length - 1, 1));
      slide.addShape("rect" as any, { x: 0.24, y: dotY + 0.10, w: 0.02, h: nextY - dotY - 0.16, fill: { color: phaseColors[i] }, transparency: 50 });
    }
  }
  const badgeW = 1.50;
  const badgeH = 0.28;
  slide.addShape("roundRect" as any, { x: 0.80, y: 0.42, w: badgeW, h: badgeH, fill: { color: colors.p3 }, rectRadius: 0.14 });
  slide.addText("ESTUDO DE CASO", { x: 0.80, y: 0.42, w: badgeW, h: badgeH, fontSize: 8, fontFace: design.fonts.body, bold: true, color: "FFFFFF", align: "center", valign: "middle", charSpacing: 4 });
  slide.addText(plan.title, { x: 0.80, y: 0.80, w: SLIDE_W - 1.50, h: 0.60, fontSize: 24, fontFace: design.fonts.title, bold: true, color: "FFFFFF", valign: "middle" });
  addHR(slide, 0.80, 1.42, 3.50, colors.p3, 0.020);
  const contentX = 0.80;
  const contentW = SLIDE_W - 1.50;
  const gridStartY = 1.60;
  const gridH = SLIDE_H - gridStartY - 0.50;
  const bandGap = 0.10;
  const bandH = Math.min((gridH - bandGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1), 1.20);
  const descFontSize = items.length >= 5 ? TYPO.BODY - 1 : TYPO.BODY;
  for (let i = 0; i < items.length; i++) {
    const y = gridStartY + i * (bandH + bandGap);
    const pal = phaseColors[i % phaseColors.length];
    const colonIdx = items[i].indexOf(":");
    const label = colonIdx > 0 && colonIdx < 35 ? items[i].substring(0, colonIdx).trim() : defaultLabels[i % defaultLabels.length];
    const desc = colonIdx > 0 ? items[i].substring(colonIdx + 1).trim() : items[i];
    addCardShadow(slide, contentX, y, contentW, bandH, "000000");
    slide.addShape("roundRect" as any, { x: contentX, y, w: contentW, h: bandH, fill: { color: colors.panelMid }, rectRadius: 0.08 });
    slide.addShape("rect" as any, { x: contentX, y, w: 0.06, h: bandH, fill: { color: pal }, rectRadius: 0.08 });
    const iconSize = 0.34;
    slide.addShape("roundRect" as any, { x: contentX + 0.14, y: y + 0.08, w: iconSize, h: iconSize, fill: { color: pal }, rectRadius: 0.06 });
    slide.addText(String(i + 1), { x: contentX + 0.14, y: y + 0.08, w: iconSize, h: iconSize, fontSize: 12, fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
    slide.addText(label.toUpperCase(), { x: contentX + 0.56, y: y + 0.04, w: 2.00, h: 0.24, fontSize: 8, fontFace: design.fonts.title, bold: true, color: pal, charSpacing: 3, valign: "middle" });
    slide.addText(desc, { x: contentX + 0.56, y: y + 0.26, w: contentW - 0.80, h: bandH - 0.32, fontSize: descFontSize, fontFace: design.fonts.body, color: colors.coverSubtext, valign: "top", lineSpacingMultiple: 1.18 });
    if (i < items.length - 1) slide.addText("▼", { x: contentX + 0.23, y: y + bandH + bandGap / 2 - 0.08, w: 0.20, h: 0.16, fontSize: 7, color: phaseColors[i + 1] || pal, align: "center", valign: "middle", transparency: 40 });
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

function renderWarningCallout(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);
  addLightBgDecoration(slide, design, colors);
  addLeftEdge(slide, "C0392B");
  if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, "C0392B", design.fonts.body);
  addSlideTitle(slide, plan.title, colors, design.fonts.title, "C0392B");
  slide.addShape("roundRect" as any, { x: SLIDE_W - 1.50, y: 0.35, w: 0.80, h: 0.80, fill: { color: "FEF2F2" }, rectRadius: 0.12 });
  slide.addText("⚠", { x: SLIDE_W - 1.50, y: 0.35, w: 0.80, h: 0.80, fontSize: 28, align: "center", valign: "middle" });
  const items = (plan.items || []).slice(0, 5);
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
    const isLightCard = i % 2 === 0;
    const cardBgColor = isLightCard ? (design.theme === "dark" ? colors.cardBgAlt : "FFF5F5") : colors.cardBg;
    const cardTextColor = isLightCard && design.theme === "light" ? "1E293B" : colors.text;
    addCardShadow(slide, contentX, y, contentW, cardH, colors.shadowColor, design.theme === "light");
    slide.addShape("roundRect" as any, { x: contentX, y, w: contentW, h: cardH, fill: { color: cardBgColor }, rectRadius: 0.08 });
    slide.addShape("rect" as any, { x: contentX, y, w: 0.06, h: cardH, fill: { color: "E74C3C" }, rectRadius: 0.08 });
    slide.addText(items[i], { x: contentX + 0.18, y: y + 0.04, w: contentW - 0.30, h: cardH - 0.08, fontSize: bodyFontSize, fontFace: design.fonts.body, color: cardTextColor, valign: "middle", lineSpacingMultiple: 1.12 });
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

function renderReflectionCallout(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.coverDark);
  slide.addText("\u201C", { x: 0.30, y: -0.30, w: 2.00, h: 2.00, fontSize: 180, fontFace: design.fonts.title, color: colors.p1, transparency: 88, bold: true });
  addHR(slide, 0.65, 0.55, SLIDE_W - 1.30, colors.p1, 0.018);
  slide.addText("REFLEXÃO", { x: 0.65, y: 0.80, w: 4.0, h: 0.24, fontSize: 10, fontFace: design.fonts.body, bold: true, color: colors.p1, charSpacing: 6 });
  slide.addText(plan.title, { x: 0.65, y: 1.12, w: SLIDE_W - 1.30, h: 0.55, fontSize: 24, fontFace: design.fonts.title, bold: true, color: "FFFFFF" });
  const items = plan.items || [];
  const contentY = 1.90;
  const contentH = SLIDE_H - contentY - 0.60;
  const itemGap = 0.16;
  const rawIH = (contentH - itemGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1);
  const iH = Math.max(0.65, Math.min(1.30, rawIH));
  for (let i = 0; i < items.length; i++) {
    const y = contentY + i * (iH + itemGap);
    slide.addShape("roundRect" as any, { x: 0.65, y, w: SLIDE_W - 1.30, h: iH, fill: { color: colors.panelMid }, rectRadius: 0.08, transparency: 30 });
    slide.addText(items[i], { x: 1.00, y, w: SLIDE_W - 2.00, h: iH, fontSize: TYPO.BODY_LARGE, fontFace: design.fonts.body, italic: true, color: colors.coverSubtext, valign: "middle", lineSpacingMultiple: 1.42 });
  }
  addGradientBar(slide, 0.65, SLIDE_H - 0.50, SLIDE_W - 1.30, 0.012, colors.p1, "right");
}

function renderSummarySlide(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);
  addLightBgDecoration(slide, design, colors);
  const sidebarW = 0.45;
  slide.addShape("rect" as any, { x: 0, y: 0, w: sidebarW, h: SLIDE_H, fill: { color: colors.p0 } });
  if (plan.sectionLabel) {
    slide.addText(plan.sectionLabel.toUpperCase(), { x: sidebarW + 0.30, y: 0.30, w: 6.0, h: 0.24, fontSize: 10, fontFace: design.fonts.body, bold: true, color: colors.p0, charSpacing: 5 });
    addHR(slide, sidebarW + 0.30, 0.57, 0.90, colors.p0, 0.020);
  }
  slide.addText(plan.title, { x: sidebarW + 0.30, y: 0.68, w: SLIDE_W - sidebarW - 0.80, h: 0.75, fontSize: TYPO.SECTION_TITLE, fontFace: design.fonts.title, bold: true, color: colors.text, valign: "middle" });
  const items = (plan.items || []).map((item) => ensureSentenceEnd(item)).filter((item) => item.replace(/[.\s]+$/, "").trim().length >= 10);
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
    addCardShadow(slide, x, y, cardW, cardH, colors.shadowColor, design.theme === "light");
    slide.addShape("roundRect" as any, { x, y, w: cardW, h: cardH, fill: { color: colors.cardBg }, rectRadius: 0.10 });
    slide.addShape("rect" as any, { x, y, w: 0.05, h: cardH, fill: { color: pal }, rectRadius: 0.10 });
    const numSize = 0.40;
    slide.addShape("roundRect" as any, { x: x + 0.14, y: y + 0.12, w: numSize, h: numSize, fill: { color: pal }, rectRadius: 0.08 });
    slide.addText(String(i + 1), { x: x + 0.14, y: y + 0.12, w: numSize, h: numSize, fontSize: 16, fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
    slide.addText(items[i], { x: x + 0.14, y: y + numSize + 0.18, w: cardW - 0.28, h: cardH - numSize - 0.30, fontSize: TYPO.BODY, fontFace: design.fonts.body, color: colors.text, valign: "top", lineSpacingMultiple: 1.25 });
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

function renderNumberedTakeaways(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.coverDark);
  addHR(slide, 0, 0.04, SLIDE_W, colors.p4, 0.045);
  if (plan.sectionLabel) slide.addText(plan.sectionLabel.toUpperCase(), { x: 0.65, y: 0.28, w: 6.0, h: 0.24, fontSize: 10, fontFace: design.fonts.body, bold: true, color: colors.p4, charSpacing: 6 });
  slide.addText(plan.title, { x: 0.65, y: 0.58, w: SLIDE_W - 1.30, h: 0.70, fontSize: 28, fontFace: design.fonts.title, bold: true, color: "FFFFFF", valign: "middle" });
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
    slide.addShape("roundRect" as any, { x: x + 0.02, y: y + 0.03, w: cardW, h: cardH, fill: { color: "000000" }, transparency: 75, rectRadius: 0.12 });
    slide.addShape("roundRect" as any, { x, y, w: cardW, h: cardH, fill: { color: colors.panelMid }, rectRadius: 0.12 });
    slide.addShape("rect" as any, { x, y, w: 0.05, h: cardH, fill: { color: pal }, rectRadius: 0.12 });
    const tkBadge = Math.min(0.38, cardH * 0.28, cardW * 0.22);
    slide.addShape("roundRect" as any, { x: x + 0.14, y: y + 0.14, w: tkBadge, h: tkBadge, fill: { color: pal }, rectRadius: 0.08 });
    slide.addText(String(i + 1), { x: x + 0.14, y: y + 0.14, w: tkBadge, h: tkBadge, fontSize: Math.min(16, tkBadge * 40), fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
    const tkTextY = y + 0.14 + tkBadge + 0.10;
    slide.addText(items[i], { x: x + 0.14, y: tkTextY, w: cardW - 0.28, h: cardH - (tkTextY - y) - 0.10, fontSize: TYPO.TAKEAWAY_BODY, fontFace: design.fonts.body, color: colors.coverSubtext, valign: "top", lineSpacingMultiple: 1.25, autoFit: true } as any);
  }
}

function renderClosingSlide(pptx: PptxGenJS, courseTitle: string, design: DesignConfig, image?: SlideImage | null) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  if (image) {
    try { slide.addImage({ data: image.base64Data, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }); } catch { addSlideBackground(slide, colors.coverDark); }
    slide.addShape("rect" as any, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: "000000" }, transparency: 45 });
  } else {
    addSlideBackground(slide, colors.coverDark);
  }
  if (!image) {
    addGradientBar(slide, SLIDE_W * 0.45, 0, SLIDE_W * 0.60, SLIDE_H, colors.p0, "down");
    slide.addShape("ellipse" as any, { x: SLIDE_W - 4.00, y: -1.20, w: 5.00, h: 5.00, fill: { color: colors.p1 }, transparency: 92 });
  }
  slide.addShape("rect" as any, { x: 0.80, y: 0.90, w: 0.05, h: 3.80, fill: { color: colors.p0 } });
  slide.addShape("rect" as any, { x: 0.88, y: 0.90, w: 0.015, h: 3.80, fill: { color: colors.p0 }, transparency: 50 });
  addHR(slide, 1.20, 1.30, 3.00, colors.p0, 0.015);
  if (!image) {
    for (let b = 0; b < 5; b++) slide.addShape("roundRect" as any, { x: 0.28, y: 1.10 + b * 0.28, w: 0.30, h: 0.16, fill: { color: design.palette[b % design.palette.length] }, transparency: 20, rectRadius: 0.04 });
  }
  slide.addText("Obrigado!", { x: 1.20, y: 1.80, w: SLIDE_W * 0.55, h: 2.00, fontSize: 68, fontFace: design.fonts.title, bold: true, color: "FFFFFF", valign: "middle" });
  addGradientBar(slide, 1.20, 4.05, 3.20, 0.06, colors.p0, "right");
  slide.addText(courseTitle, { x: 1.20, y: 4.30, w: SLIDE_W * 0.50, h: 0.55, fontSize: 15, fontFace: design.fonts.body, color: colors.coverSubtext, valign: "top", lineSpacingMultiple: 1.18 });
  slide.addText("CONCLUSÃO", { x: 1.20, y: 5.10, w: 4.0, h: 0.24, fontSize: 9, fontFace: design.fonts.body, bold: true, color: colors.p0, charSpacing: 7, transparency: 20 });
  if (!image) {
    for (let i = 0; i < 3; i++) {
      const sz = 0.50 + i * 0.25;
      slide.addShape("rect" as any, { x: SLIDE_W - 2.20 + i * 0.45, y: SLIDE_H - 2.00 + i * 0.40, w: sz, h: sz, fill: { color: design.palette[i % design.palette.length] }, transparency: 85, rectRadius: 0.04 });
    }
  }
  const dateStr = new Intl.DateTimeFormat("pt-BR", { year: "numeric", month: "long" }).format(new Date());
  slide.addText(dateStr, { x: SLIDE_W - 2.80, y: SLIDE_H - 0.55, w: 2.40, h: 0.28, fontSize: 11, fontFace: design.fonts.body, color: colors.coverSubtext, align: "right", charSpacing: 2, transparency: 30 });
  if (image) addImageCredit(slide, image.credit, design);
}

// ── Slide dispatcher ──
function renderSlide(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig, image?: SlideImage | null) {
  switch (plan.layout) {
    case "module_cover": renderModuleCover(pptx, plan, design, image); break;
    case "two_column_bullets": renderTwoColumnBullets(pptx, plan, design); break;
    case "definition": renderBullets(pptx, plan, design); break; // definition maps to bullets in v3
    case "grid_cards": renderGridCards(pptx, plan, design); break;
    case "process_timeline": renderProcessTimeline(pptx, plan, design); break;
    case "comparison_table": renderComparisonTable(pptx, plan, design); break;
    case "example_highlight": renderExampleHighlight(pptx, plan, design); break;
    case "warning_callout": renderWarningCallout(pptx, plan, design); break;
    case "reflection_callout": renderReflectionCallout(pptx, plan, design); break;
    case "summary_slide": renderSummarySlide(pptx, plan, design); break;
    case "numbered_takeaways": renderNumberedTakeaways(pptx, plan, design); break;
    case "bullets": default: renderBullets(pptx, plan, design); break;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 7: PIPELINE ORCHESTRATOR (v3 — AI-driven)
// ═══════════════════════════════════════════════════════════════════

const MODULE_COLORS = ["6C63FF", "3B82F6", "10B981", "F59E0B", "06B6D4", "EC4899", "8B5CF6", "14B8A6", "F97316", "6366F1"];

async function runPipeline(
  courseTitle: string,
  modules: { title: string; content: string }[],
  design: DesignConfig,
  language: string,
): Promise<{ pptx: PptxGenJS; report: any }> {
  const warnings: string[] = [];

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "EduGenAI v3";
  pptx.title = courseTitle;

  _globalSlideIdx = 0;
  _globalSlideNumber = 0;
  _globalFooterBrand = design.footerBrand;

  const imagePlan = await buildImagePlan(courseTitle, modules, design.includeImages);

  renderCoverSlide(pptx, courseTitle, design, imagePlan.cover);

  // Generate slides for all modules via AI
  const allModuleSlides: SlidePlan[][] = [];
  const densityKey = design.density.maxItemsPerSlide <= 5 ? "compact" : design.density.maxItemsPerSlide >= 8 ? "detailed" : "standard";

  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    const rawTitle = sanitize(mod.title || `Módulo ${i + 1}`);
    const cleanTitle = rawTitle.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;

    console.log(`[V3] Generating slides for module ${i + 1}/${modules.length}: ${cleanTitle}`);

    const moduleSlides = await generateSlidesForModule(
      cleanTitle,
      mod.content || "",
      { density: densityKey, language },
    );

    // Attach module metadata to each slide
    moduleSlides.forEach((s) => {
      s.moduleIndex = i;
      s.moduleColor = MODULE_COLORS[i % MODULE_COLORS.length];
    });

    allModuleSlides.push(moduleSlides);
    console.log(`[V3] Module ${i + 1} generated ${moduleSlides.length} slides`);
  }

  // Render TOC
  const tocModules = modules.map((m) => {
    const rawTitle = sanitize(m.title || "");
    const cleanTitle = rawTitle.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;
    return { title: cleanMarkdown(cleanTitle) };
  });
  renderTOC(pptx, tocModules, design);

  // Count total content slides for footer numbering
  _globalTotalSlides = allModuleSlides.reduce((sum, plans) => sum + plans.length, 0);

  // Render all module slides
  let totalSlides = 2; // cover + TOC
  for (let mi = 0; mi < allModuleSlides.length; mi++) {
    const moduleImage = imagePlan.modules.get(mi) || null;
    for (const plan of allModuleSlides[mi]) {
      const img = plan.layout === "module_cover" ? moduleImage : null;
      renderSlide(pptx, plan, design, img);
      totalSlides++;
    }
  }

  renderClosingSlide(pptx, courseTitle, design, imagePlan.closing);
  totalSlides++;

  console.log(`[V3-PIPELINE] Complete: ${modules.length} modules, ${totalSlides} slides total`);

  return {
    pptx,
    report: {
      totalModules: modules.length,
      totalSlides,
      warnings,
      moduleSlideCounts: allModuleSlides.map((ms) => ms.length),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 8: HTTP HANDLER
// ═══════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = claimsData.user.id;

    const body = await req.json();
    const { course_id, palette, density, theme, includeImages, template, courseType, footerBrand } = body;
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: sub } = await serviceClient.from("subscriptions").select("plan").eq("user_id", userId).single();
    const plan = sub?.plan || "free";

    if (plan !== "pro") {
      const { data: profile } = await serviceClient.from("profiles").select("is_dev").eq("user_id", userId).maybeSingle();
      if (!profile?.is_dev) {
        return new Response(JSON.stringify({ error: "PowerPoint export requires a Pro plan.", feature: "export_pptx" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const { data: course, error: courseErr } = await serviceClient.from("courses").select("*").eq("id", course_id).eq("user_id", userId).single();
    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (course.status !== "published") {
      return new Response(JSON.stringify({ error: "Course must be published to export." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: modules = [] } = await serviceClient.from("course_modules").select("*").eq("course_id", course_id).order("order_index");

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
    const moduleData = modules.map((m: any) => ({ title: m.title || "", content: m.content || "" }));
    const language = course.language || "pt-BR";

    console.log(`[V3] ENGINE_VERSION=${ENGINE_VERSION} | Starting export: "${courseTitle}", ${moduleData.length} modules`);

    const { pptx: pptxGen, report } = await runPipeline(courseTitle, moduleData, design, language);

    const pptxData = await pptxGen.write({ outputType: "uint8array" });

    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s\-]/g, "")
      .replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = `${userId}/${safeName}-PPTX-v3-${dateStr}.pptx`;

    const { error: uploadErr } = await serviceClient.storage.from("course-exports").upload(fileName, pptxData, {
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      upsert: true,
    });
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage.from("course-exports").createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_EXPORTED_PPTX_V3",
      metadata: { course_id, slide_count: report.totalSlides },
    });

    return new Response(
      JSON.stringify({
        url: signedUrl.signedUrl,
        version: "v3",
        engine_version: ENGINE_VERSION,
        quality_report: {
          engine_version: ENGINE_VERSION,
          total_modules: report.totalModules,
          total_slides: report.totalSlides,
          module_slide_counts: report.moduleSlideCounts,
          warnings: report.warnings,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[V3] Export error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
