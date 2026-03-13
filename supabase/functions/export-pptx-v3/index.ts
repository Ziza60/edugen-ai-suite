import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "npm:pptxgenjs@3.12.0";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const ENGINE_VERSION = "3.6.0-2026-03-13";

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
  template: "default" | "academic" | "corporate" | "creative";
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
  default:   { title: "Montserrat",       body: "Open Sans" },
  academic:  { title: "Times New Roman",  body: "Arial" },
  corporate: { title: "Montserrat",       body: "Open Sans" },
  creative:  { title: "Playfair Display", body: "Lato" },
};

const TEMPLATE_DEFAULT_PALETTES: Record<string, string[]> = {
  default:   PALETTES.default,
  academic:  ["003366", "336699", "FF6600", "006633", "660033"],
  corporate: ["1A1A2E", "16213E", "0F3460", "533483", "E94560"],
  creative:  ["2C3E50", "E74C3C", "F39C12", "8E44AD", "16A085"],
};

const DENSITY_CONFIG: Record<string, { maxItemsPerSlide: number; maxCharsPerItem: number }> = {
  compact:  { maxItemsPerSlide: 4, maxCharsPerItem: 130 },
  standard: { maxItemsPerSlide: 5, maxCharsPerItem: 160 },
  detailed: { maxItemsPerSlide: 6, maxCharsPerItem: 200 },
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
    slide.addShape("ellipse" as any, {
      x: SLIDE_W - 1.60, y: -0.60, w: 1.80, h: 1.80,
      fill: { color: colors.p0 }, transparency: 92,
    });
    slide.addShape("ellipse" as any, {
      x: SLIDE_W - 0.80, y: 0.50, w: 0.80, h: 0.80,
      fill: { color: colors.p1 }, transparency: 88,
    });
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
  "computação": "computing", "blockchain": "blockchain", "investimento": "investment",
  "economia": "economy", "mercado": "market", "psicologia": "psychology",
  "medicina": "medicine", "ambiente": "environment", "energia": "energy",
  "logística": "logistics", "transporte": "transportation", "arquitetura": "architecture",
  "música": "music", "arte": "art", "jogos": "games", "esporte": "sport", "moda": "fashion",
  "direito": "law", "ética": "ethics", "sociedade": "society", "cultura": "culture",
  "matemática": "mathematics", "física": "physics", "química": "chemistry", "biologia": "biology",
  "ensino": "teaching", "curso": "course", "aula": "class", "aluno": "student",
  "ferramenta": "tool", "plataforma": "platform", "sistema": "system", "processo": "process",
  "modelo": "model", "código": "code", "software": "software", "algoritmo": "algorithm",
  "servidor": "server", "web": "web", "mobile": "mobile",
  // Palavras de domínio frequentes sem tradução no mapa original
  "auditoria": "audit", "operacional": "operational", "controle": "control",
  "compliance": "compliance", "governanca": "governance", "risco": "risk",
  "qualidade": "quality", "melhoria": "improvement", "diagnostico": "diagnostic",
  "relatorio": "report", "indicador": "indicator", "desempenho": "performance",
  "contabilidade": "accounting", "fiscal": "fiscal", "tributario": "tax",
  "juridico": "legal", "contrato": "contract", "negociacao": "negotiation",
  "vendedor": "sales", "atendimento": "customer service", "suporte": "support",
  "treinamento": "training", "capacitacao": "training", "habilidade": "skill",
  "competencia": "competency", "certificacao": "certification", "carreira": "career",
  "projeto": "project", "agil": "agile", "scrum": "scrum", "sprint": "sprint",
  "startup": "startup", "escalonamento": "scaling", "parceria": "partnership",
  "apresentacao": "presentation", "reuniao": "meeting", "workshop": "workshop",
  "planejamento": "planning", "execucao": "execution", "monitoramento": "monitoring",
};

const PT_STOP_WORDS = new Set([
  "de","da","do","das","dos","para","com","em","na","no","nas","nos",
  "um","uma","uns","umas","o","a","os","as","e","ou","que","por",
  "ao","à","como","mais","não","se","seu","sua","seus","suas",
  "muito","bem","todo","toda","todos","todas","este","esta","esse",
  "essa","aquele","aquela","ser","ter","fazer","poder","dever",
  "módulo","capítulo","seção","parte","sobre","entre","até","sem",
]);

function buildImageQuery(title: string): string {
  const normalized = title.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const words = normalized.split(" ").filter((w) => w.length > 2 && !PT_STOP_WORDS.has(w));
  const translated = words.map((w) => {
    const wNorm = w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    for (const [pt, en] of Object.entries(PT_EN_MAP)) {
      const ptNorm = pt.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (wNorm === ptNorm) return en;
    }
    return w;
  });
  const unique = [...new Set(translated)].slice(0, 3);
  // Add visual context anchor so Unsplash returns workplace/business photos, not random results
  const VISUAL_ANCHORS = new Set(["technology","design","art","music","sport","nature","medicine","architecture","cooking"]);
  const hasVisualAnchor = unique.some(w => VISUAL_ANCHORS.has(w));
  const suffix = hasVisualAnchor ? " professional" : " workplace professional";
  return unique.join(" ") + suffix;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return encodeBase64(new Uint8Array(buffer));
}

async function fetchUnsplashImage(
  query: string,
  orientation: "landscape" | "portrait" | "squarish" = "landscape",
): Promise<SlideImage | null> {
  const accessKey = Deno.env.get("UNSPLASH_ACCESS_KEY");
  if (!accessKey) return null;
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=5&content_filter=high`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${accessKey}` } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results?.length) return null;
    const photo = data.results[Math.floor(Math.random() * data.results.length)];
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
  } catch { return null; }
}

async function buildImagePlan(
  courseTitle: string,
  modules: { title: string; content: string }[],
  includeImages: boolean,
): Promise<ImagePlan> {
  const empty: ImagePlan = { cover: null, modules: new Map(), closing: null };
  if (!includeImages || !Deno.env.get("UNSPLASH_ACCESS_KEY")) return empty;

  const coverQuery = buildImageQuery(courseTitle);
  // Separate closing query for a different image
  const closingQuery = buildImageQuery(courseTitle + " conclusion graduation");
  const allQueries = [
    { query: coverQuery, orientation: "landscape" as const },
    { query: closingQuery, orientation: "landscape" as const },
  ];
  for (const m of modules) {
    const rawTitle = m.title.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || m.title;
    allQueries.push({ query: buildImageQuery(rawTitle), orientation: "landscape" as const });
  }

  const MAX_CONCURRENT = 4;
  const results: (SlideImage | null)[] = new Array(allQueries.length).fill(null);
  for (let i = 0; i < allQueries.length; i += MAX_CONCURRENT) {
    const batch = allQueries.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.all(
      batch.map((q) => fetchUnsplashImage(q.query, q.orientation).catch(() => null))
    );
    batchResults.forEach((r, j) => { results[i + j] = r; });
  }

  // results[0] = cover, results[1] = closing, results[2..] = modules
  const plan: ImagePlan = { cover: results[0], modules: new Map(), closing: results[1] };
  for (let i = 0; i < modules.length; i++) {
    if (results[i + 2]) plan.modules.set(i, results[i + 2]!);
  }

  // Fallback: fill missing module images with nearest available module image
  for (let i = 0; i < modules.length; i++) {
    if (!plan.modules.has(i)) {
      // Search nearest neighbor (prefer previous, then next)
      let fallback: SlideImage | null = null;
      for (let d = 1; d < modules.length; d++) {
        if (plan.modules.has(i - d)) { fallback = plan.modules.get(i - d)!; break; }
        if (plan.modules.has(i + d)) { fallback = plan.modules.get(i + d)!; break; }
      }
      if (fallback) {
        plan.modules.set(i, fallback);
        console.log(`[V3-IMAGE] Module ${i + 1}: using neighbor fallback image`);
      }
    }
  }

  // Fallback: if cover failed, reuse first available module image
  if (!plan.cover) {
    for (let fi = 0; fi < modules.length; fi++) {
      if (plan.modules.has(fi)) {
        plan.cover = plan.modules.get(fi)!;
        console.log("[V3-IMAGE] Cover fallback: reusing module", fi + 1, "image");
        break;
      }
    }
  }
  // Fallback: if closing failed, reuse cover or last module image
  if (!plan.closing) {
    plan.closing = plan.cover || null;
    if (plan.closing) console.log("[V3-IMAGE] Closing fallback: reusing cover image");
  }

  return plan;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 3: AI CALL (Lovable Gateway — same pattern as generate-course)
// ═══════════════════════════════════════════════════════════════════

async function callAI(model: string, prompt: string): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI call failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
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

  return `Você é um designer instrucional especializado em apresentações PowerPoint para cursos online.

Sua tarefa: converter o conteúdo do Módulo ${moduleIndex + 1} abaixo em uma sequência de slides para PowerPoint.

## REGRA FUNDAMENTAL
Retorne APENAS um array JSON válido. ZERO texto fora do JSON. ZERO explicações. ZERO markdown.
NÃO inclua preamble, saudação ou confirmação — o primeiro caractere deve ser [ e o último ].

## LAYOUTS DISPONÍVEIS

**"module_cover"** — Capa do módulo (SEMPRE o primeiro slide)
- Campos: title (string), objectives (array de 3 strings — o que o aluno vai aprender)

**"bullets"** — Conteúdo expositivo (fundamentos, conceitos, como funciona)
- Campos: title (string, máx 55 chars), sectionLabel (string em MAIÚSCULAS, máx 3 palavras), items (array de ${itemsPerSlide} strings, cada uma frase completa com ponto final, máx 160 chars)

**"two_column_bullets"** — Conteúdo extenso em duas colunas (usar quando bullets tiver 6+ itens)
- Campos: title, sectionLabel, items (array de 6-10 strings)

**"grid_cards"** — Lista de itens com título e descrição (aplicações, ferramentas, tipos)
- Usar quando: 3-6 itens com estrutura "Nome: descrição"
- Campos: title, sectionLabel (ex: "APLICAÇÕES REAIS", "FERRAMENTAS"), items (array de 3-6 strings no formato "Título do Card: Descrição em uma frase completa")

**"process_timeline"** — Sequência de passos ou etapas (processos, fluxos, como fazer)
- Usar quando: o conteúdo descreve um processo sequencial
- Campos: title, sectionLabel (ex: "COMO FUNCIONA", "PASSO A PASSO"), items (array de 3-6 strings, cada uma no formato "Passo: descrição" ou texto direto)

**"comparison_table"** — Tabela comparativa entre 2+ conceitos/variantes
- Usar quando: o conteúdo compara explicitamente diferentes tipos, versões ou abordagens
- Campos: title, sectionLabel (ex: "COMPARATIVO", "MODELOS"), tableHeaders (array de 2-4 strings), tableRows (array de arrays de strings, cada linha com mesmo número de colunas dos headers)

**"example_highlight"** — Exemplo prático ou estudo de caso
- SEMPRE usar para blocos de exemplo. NUNCA usar bullets para exemplos.
- Campos: title (ex: "Exemplo Prático"), sectionLabel ("ESTUDO DE CASO"), items (array de 3-5 strings, cada uma no formato "Rótulo: descrição")
- ORDEM OBRIGATÓRIA E IMUTÁVEL dos rótulos: Contexto → Desafio → Solução → Resultado
- PROIBIDO usar outro rótulo inicial que não seja Contexto ou Cenário
- PROIBIDO colocar Resultado antes de Solução ou Desafio
- CRÍTICO: cada item deve ter conteúdo único — PROIBIDO repetir a mesma informação

**"warning_callout"** — Desafios, riscos, limitações, erros comuns
- Campos: title (ex: "Desafios e Cuidados"), sectionLabel ("PONTOS DE ATENÇÃO"), items (array de 3-4 strings, cada uma frase completa)

**"reflection_callout"** — Pergunta de reflexão ou provocação para o aluno
- Campos: title (ex: "Para Refletir"), sectionLabel ("REFLEXÃO"), items (array com 1-2 strings — perguntas completas)

**"summary_slide"** — Resumo do módulo
- SEMPRE o penúltimo slide (antes dos takeaways)
- Campos: title ("Resumo"), sectionLabel ("SÍNTESE"), items (array de 2-4 strings resumindo o módulo)

**"numbered_takeaways"** — Key Takeaways
- SEMPRE o último slide de cada módulo
- Campos: title ("Key Takeaways"), sectionLabel ("PRINCIPAIS APRENDIZADOS"), items (array de 4-5 strings, cada uma uma lição concreta e aplicável)

## REGRAS DE QUALIDADE OBRIGATÓRIAS

1. **Sequência obrigatória de cada módulo:**
   - Slide 1: module_cover (SEMPRE)
   - Slides 2 a N-2: conteúdo variado (bullets, grid_cards, process_timeline, example_highlight, etc.)
   - Slide N-1: summary_slide
   - Slide N: numbered_takeaways

2. **Variedade de layouts:** Nunca use o mesmo layout mais de 2 vezes seguidas. O ideal é alternar entre bullets, grid_cards, process_timeline, example_highlight ao longo do módulo.

3. **Densidade:** ${itemsPerSlide} itens por slide (exceto module_cover, summary, takeaways). Nunca 1 item isolado — incorpore no slide anterior.

4. **Frases completas:** Todo item deve ser uma frase completa com ponto final. Máximo 160 chars por item.

5. **Títulos de slide descritivos:** Não use só "Fundamentos" — use "Fundamentos da Inteligência Artificial". Máx 55 chars.

6. **sectionLabel em MAIÚSCULAS:** Máx 3 palavras. Ex: "FUNDAMENTOS", "COMO FUNCIONA", "APLICAÇÕES REAIS".

7. **Sem duplicação:** Nenhum item pode repetir informação de outro item no mesmo slide.

8. **Exemplo obrigatório:** Todo módulo deve ter pelo menos 1 slide "example_highlight". Se o conteúdo não tiver exemplo explícito, criar um realista baseado no tema.

9. **Idioma:** Gere todo o conteúdo em ${language}.

## CONTEÚDO DO MÓDULO

**Título:** ${moduleTitle}

**Conteúdo:**
${moduleContent.substring(0, 6000)}

## FORMATO DE SAÍDA (exemplo mínimo de estrutura):
[
  {"layout":"module_cover","title":"${moduleTitle}","objectives":["Objetivo 1.","Objetivo 2.","Objetivo 3."]},
  {"layout":"bullets","title":"Título Descritivo","sectionLabel":"FUNDAMENTOS","items":["Item 1.","Item 2.","Item 3.","Item 4."]},
  {"layout":"grid_cards","title":"Título Descritivo","sectionLabel":"APLICAÇÕES REAIS","items":["Ferramenta A: Descrição da ferramenta A.","Ferramenta B: Descrição da ferramenta B.","Ferramenta C: Descrição da ferramenta C."]},
  {"layout":"example_highlight","title":"Exemplo Prático","sectionLabel":"ESTUDO DE CASO","items":["Contexto: Descrição do cenário.","Desafio: O problema a resolver.","Solução: Como foi resolvido.","Resultado: O que foi alcançado."]},
  {"layout":"summary_slide","title":"Resumo","sectionLabel":"SÍNTESE","items":["Síntese 1.","Síntese 2.","Síntese 3."]},
  {"layout":"numbered_takeaways","title":"Key Takeaways","sectionLabel":"PRINCIPAIS APRENDIZADOS","items":["Lição 1.","Lição 2.","Lição 3.","Lição 4."]}
]

Retorne APENAS o array JSON. Nenhum texto antes ou depois.`;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 5: JSON PARSING & VALIDATION
// ═══════════════════════════════════════════════════════════════════

function sanitizeText(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/(\d+)\.\s+(\d{3})/g, "$1.$2")       // fix "R$500. 000" / "Lei nº 8. 443" → correct
    .replace(/\|\s*:?-+\s*\|?/g, " ")              // remove markdown table separators | :--- |
    .replace(/\|/g, " ")                             // remove any remaining pipe chars
    .replace(/\s+/g, " ")
    .replace(/\s*\"\s*\.\s*$/g, ".")             // fix trailing artifact ". at end
    .replace(/\.\s*\"\s*\./g, ".")               // fix mid-artifact ."."
    .replace(/\"\s*\.$/g, ".")                     // fix trailing ".
    .trim();
}

function ensureSentenceEnd(text: string): string {
  const t = sanitizeText(text);
  if (!t) return t;
  if (/[.!?:;"]$/.test(t)) return t;
  return t + ".";
}

function normalizeSlide(raw: any, moduleIndex: number, design: DesignConfig): SlidePlan | null {
  if (!raw || typeof raw !== "object" || !raw.layout) return null;

  const layout = String(raw.layout) as SlideLayoutV3;
  const validLayouts: SlideLayoutV3[] = [
    "module_cover", "bullets", "two_column_bullets", "definition", "grid_cards",
    "process_timeline", "comparison_table", "example_highlight", "warning_callout",
    "reflection_callout", "summary_slide", "numbered_takeaways",
  ];
  if (!validLayouts.includes(layout)) return null;

  const title = sanitizeText(String(raw.title || "")).substring(0, 80) || "Slide";
  const sectionLabel = sanitizeText(String(raw.sectionLabel || "")).substring(0, 50);

  // Items: filter out empty/too-short strings, enforce sentence end
  const maxItems = design.density.maxItemsPerSlide + 2; // allow slight overflow for AI
  let items: string[] = [];
  if (Array.isArray(raw.items)) {
    const itemCharLimit = layout === "example_highlight" ? 350 : 200;
    items = raw.items
      .filter((i: any) => typeof i === "string" && i.trim().length > 5)
      .map((i: string) => ensureSentenceEnd(sanitizeText(i).substring(0, itemCharLimit)))
      .slice(0, maxItems + 2);
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
      if (!seenRanks.has(rank)) { seenRanks.add(rank); deduped.push(item); }
    }
    items = deduped
      .filter(item => getPhaseRank(item) <= 3)
      .sort((a, b) => getPhaseRank(a) - getPhaseRank(b));
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

  // Guard: skip slides with no content (except structural slides)
  const structuralLayouts: SlideLayoutV3[] = ["module_cover", "summary_slide", "numbered_takeaways"];
  if (!structuralLayouts.includes(layout)) {
    const hasItems = (plan.items?.length ?? 0) > 0;
    const hasTable = (plan.tableRows?.length ?? 0) > 0;
    if (!hasItems && !hasTable) return null; // drop empty slide
    // Also drop slides where ALL items are empty strings or too short
    if (hasItems && plan.items!.every(it => it.trim().length < 5)) return null;
  }

  return plan;
}

function buildFallbackSlides(
  moduleTitle: string,
  moduleContent: string,
  moduleIndex: number,
): SlidePlan[] {
  // Extract sentences from content as bullet items
  const stripped = moduleContent
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "");

  const sentences = stripped
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 160)
    .map((s) => ensureSentenceEnd(s))
    .slice(0, 12);

  const slides: SlidePlan[] = [
    {
      layout: "module_cover",
      title: moduleTitle,
      objectives: sentences.slice(0, 3).map((s) => s.substring(0, 100)),
      items: [],
      moduleIndex,
    },
  ];

  // Split sentences into bullet slides
  const chunks: string[][] = [];
  for (let i = 0; i < sentences.length; i += 4) {
    chunks.push(sentences.slice(i, i + 4));
  }
  for (const chunk of chunks.slice(0, 3)) {
    if (chunk.length > 0) {
      slides.push({
        layout: "bullets",
        title: moduleTitle,
        sectionLabel: "CONTEÚDO",
        items: chunk,
        moduleIndex,
      });
    }
  }

  slides.push({
    layout: "numbered_takeaways",
    title: "Key Takeaways",
    sectionLabel: "PRINCIPAIS APRENDIZADOS",
    items: sentences.slice(0, 4),
    moduleIndex,
  });

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
  const density = Object.entries(DENSITY_CONFIG).find(
    ([, v]) => v.maxItemsPerSlide === design.density.maxItemsPerSlide
  )?.[0] || "standard";

  let rawText = "";
  try {
    report.aiCallsTotal++;
    rawText = await callAI(
      "google/gemini-2.5-flash",
      buildSlidePrompt(moduleTitle, moduleContent, moduleIndex, density, language),
    );
    console.log(`[V3-AI] Module ${moduleIndex + 1} "${moduleTitle}": response length=${rawText.length}`);
  } catch (err: any) {
    report.aiCallsFailed++;
    report.fallbacksUsed++;
    report.warnings.push(`[V3-AI] Module ${moduleIndex + 1} AI call failed: ${err.message}. Using fallback.`);
    return buildFallbackSlides(moduleTitle, moduleContent, moduleIndex);
  }

  // Strip markdown code fences if present
  let clean = rawText.trim();
  clean = clean.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  // Try to extract JSON array
  let parsed: any[];
  try {
    parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) throw new Error("Response is not an array");
  } catch {
    // Fallback: try to extract JSON array from anywhere in the response
    const match = clean.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        report.aiCallsFailed++;
        report.fallbacksUsed++;
        report.warnings.push(`[V3-PARSE] Module ${moduleIndex + 1} JSON parse failed. Using fallback.`);
        return buildFallbackSlides(moduleTitle, moduleContent, moduleIndex);
      }
    } else {
      report.aiCallsFailed++;
      report.fallbacksUsed++;
      report.warnings.push(`[V3-PARSE] Module ${moduleIndex + 1} no JSON array found. Using fallback.`);
      return buildFallbackSlides(moduleTitle, moduleContent, moduleIndex);
    }
  }

  // Normalize each slide
  const slides: SlidePlan[] = parsed
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
      title: "Key Takeaways",
      sectionLabel: "PRINCIPAIS APRENDIZADOS",
      items: ["Revise o conteúdo do módulo para consolidar o aprendizado."],
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
    report.warnings.push(`[V3-GUARD] Removed ${slides.length - filtered.length} empty slides in module ${moduleIndex + 1}`);
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
      consecutive = 0; continue;
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

  console.log(`[V3-MODULE] Module ${moduleIndex + 1} "${moduleTitle}": ${compacted.length} slides generated`);
  return compacted;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION 6: RENDER UTILITY FUNCTIONS (identical to v2)
// ═══════════════════════════════════════════════════════════════════

let _globalSlideIdx = 0;
let _globalSlideNumber = 0;
let _globalTotalSlides = 0;
let _globalFooterBrand: string | null = "EduGenAI";

function addSlideBackground(slide: any, color: string) {
  slide.background = { fill: color };
}

function addHR(slide: any, x: number, y: number, w: number, color: string, h = 0.028) {
  slide.addShape("rect" as any, { x, y, w, h, fill: { color } });
}

function addGradientBar(
  slide: any, x: number, y: number, w: number, h: number,
  color: string, direction: "right" | "down" = "right",
) {
  const steps = 6;
  if (direction === "right") {
    const stepW = w / steps;
    for (let i = 0; i < steps; i++) {
      slide.addShape("rect" as any, {
        x: x + i * stepW, y, w: stepW + 0.01, h,
        fill: { color }, transparency: Math.floor(i * (70 / steps)),
      });
    }
  } else {
    const stepH = h / steps;
    for (let i = 0; i < steps; i++) {
      slide.addShape("rect" as any, {
        x, y: y + i * stepH, w, h: stepH + 0.01,
        fill: { color }, transparency: Math.floor(i * (70 / steps)),
      });
    }
  }
}

function addCardShadow(slide: any, x: number, y: number, w: number, h: number, shadowColor: string, isLightTheme = false) {
  slide.addShape("roundRect" as any, {
    x: x + 0.03, y: y + 0.04, w, h,
    fill: { color: shadowColor },
    transparency: isLightTheme ? 78 : 88,
    rectRadius: 0.10,
  });
}

function addLeftEdge(slide: any, color: string) {
  slide.addShape("rect" as any, { x: 0, y: 0, w: 0.09, h: SLIDE_H, fill: { color } });
  slide.addShape("rect" as any, { x: 0.09, y: 0, w: 0.03, h: SLIDE_H, fill: { color }, transparency: 50 });
}

function addSectionLabel(slide: any, label: string, accentColor: string, fontBody: string) {
  slide.addText(label.toUpperCase(), {
    x: 0.55, y: 0.28, w: 6.0, h: 0.24,
    fontSize: 9, fontFace: fontBody, bold: true, color: accentColor, charSpacing: 5.5,
  });
  addHR(slide, 0.55, 0.54, 0.70, accentColor, 0.024);
}

function addSlideTitle(slide: any, title: string, colors: ReturnType<typeof getColors>, fontTitle: string, accentColor?: string) {
  slide.addText(title, {
    x: 0.55, y: 0.64, w: SLIDE_W - 1.10, h: 0.85,
    fontSize: TYPO.SECTION_TITLE, fontFace: fontTitle, bold: true,
    color: colors.text, valign: "middle", lineSpacingMultiple: 1.05,
  });
  if (accentColor) {
    addHR(slide, 0.55, 1.52, SLIDE_W - 1.10, accentColor, 0.008);
    addHR(slide, 0.55, 1.54, SLIDE_W - 1.10, colors.divider, 0.004);
  }
}

function addFooter(
  slide: any, colors: ReturnType<typeof getColors>, fontBody: string,
  slideNumber?: number, totalSlides?: number, footerBrand?: string | null,
) {
  addGradientBar(slide, 0, SLIDE_H - 0.34, SLIDE_W, 0.005, colors.p0, "right");
  addHR(slide, 0, SLIDE_H - 0.335, SLIDE_W, colors.divider, 0.003);
  if (slideNumber !== undefined && totalSlides !== undefined) {
    slide.addText(`${slideNumber} / ${totalSlides}`, {
      x: 0.55, y: SLIDE_H - 0.30, w: 1.20, h: 0.20,
      fontSize: 8, fontFace: fontBody, color: colors.textSecondary, align: "left", valign: "middle",
    });
  }
  if (footerBrand) {
    slide.addText(footerBrand, {
      x: SLIDE_W - 1.80, y: SLIDE_H - 0.30, w: 1.50, h: 0.20,
      fontSize: 8, fontFace: fontBody, bold: true,
      color: colors.textSecondary, align: "right", valign: "middle", charSpacing: 3,
    });
    slide.addShape("ellipse" as any, {
      x: SLIDE_W - 1.92, y: SLIDE_H - 0.24, w: 0.08, h: 0.08,
      fill: { color: colors.p0 },
    });
  }
}

function addImageCredit(slide: any, credit: string, design: DesignConfig) {
  const colors = getColors(design);
  slide.addText(`Foto: ${credit} / Unsplash`, {
    x: SLIDE_W - 2.80, y: SLIDE_H - 0.22, w: 2.60, h: 0.18,
    fontSize: 7, fontFace: design.fonts.body, color: colors.coverSubtext,
    align: "right", transparency: 40,
  });
}

function addHeroTextReadabilityOverlay(slide: any) {
  // Keep the image visible on the right while guaranteeing text contrast on the left.
  slide.addShape("rect" as any, {
    x: 0, y: 0, w: SLIDE_W * 0.62, h: SLIDE_H,
    fill: { color: "000000" },
    transparency: 25,
  });

  // Extra support behind date/credit area (bottom-right).
  slide.addShape("roundRect" as any, {
    x: SLIDE_W - 3.30, y: SLIDE_H - 0.82, w: 2.95, h: 0.60,
    fill: { color: "000000" },
    transparency: 35,
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
      console.log(`[V3-RENDER] Cover image: base64 length=${image.base64Data.length}, starts=${image.base64Data.substring(0, 30)}`);
      // Use slide.background for full-slide background image (not addImage which places as object)
      slide.background = { data: image.base64Data };
    } catch (e) {
      console.error(`[V3-RENDER] Cover background FAILED:`, e);
      addSlideBackground(slide, colors.coverDark);
    }
    // Dark overlay for text readability over background image
    addHeroTextReadabilityOverlay(slide);
  } else {
    console.log("[V3-RENDER] Cover: no image provided");
    addSlideBackground(slide, colors.coverDark);
  }

  if (!image) {
    addGradientBar(slide, SLIDE_W * 0.50, 0, SLIDE_W * 0.50, SLIDE_H, colors.p0, "down");
    slide.addShape("ellipse" as any, {
      x: SLIDE_W * 0.55, y: -SLIDE_H * 0.35, w: SLIDE_W * 0.70, h: SLIDE_W * 0.70,
      fill: { color: colors.p1 }, transparency: 92,
    });
  }
  if (design.theme === "light" && !image) {
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        slide.addShape("ellipse" as any, {
          x: SLIDE_W - 2.80 + col * 0.55, y: 0.60 + row * 0.55, w: 0.08, h: 0.08,
          fill: { color: colors.p0 }, transparency: 70,
        });
      }
    }
  }
  slide.addShape("rect" as any, { x: 0.80, y: 0.90, w: 0.035, h: SLIDE_H - 1.80, fill: { color: colors.p0 }, transparency: 30 });
  if (!image) {
    for (let b = 0; b < 5; b++) {
      slide.addShape("roundRect" as any, {
        x: 0.28, y: 1.10 + b * 0.30, w: 0.32, h: 0.18,
        fill: { color: design.palette[b % design.palette.length] }, transparency: 15, rectRadius: 0.04,
      });
    }
  }
  addHR(slide, 1.20, 1.30, 3.50, colors.p0, 0.018);
  slide.addText(design.courseType || "CURSO COMPLETO", {
    x: 1.20, y: 1.55, w: 5.0, h: 0.28,
    fontSize: 10, fontFace: design.fonts.body, bold: true, color: colors.p0, charSpacing: 8,
  });
  slide.addText(courseTitle, {
    x: 1.20, y: 2.00, w: SLIDE_W * 0.52, h: 3.30,
    fontSize: 52, fontFace: design.fonts.title, bold: true, color: "FFFFFF",
    valign: "top", lineSpacingMultiple: 0.96,
  });
  addGradientBar(slide, 1.20, 5.50, 3.00, 0.07, colors.p0, "right");
  if (!image) {
    for (let i = 0; i < 3; i++) {
      const sz = 0.50 + i * 0.35;
      slide.addShape("roundRect" as any, {
        x: SLIDE_W - 2.60 + i * 0.55, y: 0.40 + i * 0.90, w: sz, h: sz,
        fill: { color: design.palette[i % design.palette.length] }, transparency: 82, rectRadius: 0.06,
      });
    }
  }
  slide.addShape("ellipse" as any, { x: 1.20, y: 5.82, w: 0.12, h: 0.12, fill: { color: colors.p0 } });
  addHR(slide, 1.20, SLIDE_H - 1.20, 3.00, colors.p0, 0.012);
  const dateStr = new Intl.DateTimeFormat("pt-BR", { year: "numeric", month: "long" }).format(new Date());
  slide.addText(dateStr, {
    x: SLIDE_W - 3.00, y: SLIDE_H - 0.65, w: 2.60, h: 0.30,
    fontSize: 10, fontFace: design.fonts.body, color: colors.coverSubtext, align: "right", charSpacing: 2.5,
  });
  if (image) addImageCredit(slide, image.credit, design);
}

// ── TOC ──
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
    slide.addText("CONTEÚDO PROGRAMÁTICO", {
      x: 0.65, y: 0.32, w: 6.0, h: 0.24,
      fontSize: 10, fontFace: design.fonts.body, bold: true, color: colors.p0, charSpacing: 6,
    });
    slide.addText(pages.length > 1 ? `Índice  ·  ${page + 1}/${pages.length}` : "Índice", {
      x: 0.65, y: 0.62, w: 8.0, h: 0.60,
      fontSize: 32, fontFace: design.fonts.title, bold: true, color: "FFFFFF", valign: "middle",
    });
    addHR(slide, 0.65, 1.42, 2.00, colors.p0, 0.030);
    const progressY = 1.62;
    slide.addShape("rect" as any, { x: 0.65, y: progressY, w: SLIDE_W - 1.30, h: 0.04, fill: { color: colors.panelMid } });
    slide.addShape("rect" as any, {
      x: 0.65, y: progressY, w: (SLIDE_W - 1.30) * ((page + 1) / pages.length), h: 0.04, fill: { color: colors.p0 },
    });
    const globalOffset = page * MAX_PER_PAGE;
    const useListLayout = modules.length > 5;

    if (useListLayout) {
      const itemH = Math.min(0.85, (SLIDE_H - 1.80 - 0.45) / pageModules.length);
      for (let i = 0; i < pageModules.length; i++) {
        const mod = pageModules[i];
        const pal = design.palette[(globalOffset + i) % design.palette.length];
        const y = 1.80 + i * (itemH + 0.08);
        slide.addShape("roundRect" as any, {
          x: 0.65, y: y + itemH / 2 - 0.18, w: 0.36, h: 0.36,
          fill: { color: pal }, rectRadius: 0.06,
        });
        slide.addText(String(globalOffset + i + 1), {
          x: 0.65, y: y + itemH / 2 - 0.18, w: 0.36, h: 0.36,
          fontSize: 13, fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle",
        });
        slide.addText(mod.title, {
          x: 1.18, y, w: 5.50, h: itemH,
          fontSize: 13, fontFace: design.fonts.title, bold: true, color: "FFFFFF", valign: "middle",
        });
        if (mod.description) {
          const cleanDesc = sanitizeText(mod.description)
            .replace(/^[\u{1F300}-\u{1FFFF}\u2600-\u27FF]\s*/u, "")
            .replace(/^M\u00f3dulo\s+\w+:\s*/i, "")
            .replace(/\.$/, "").trim();
          if (cleanDesc) {
            slide.addText(cleanDesc, {
              x: 7.00, y, w: SLIDE_W - 7.50, h: itemH,
              fontSize: 10, fontFace: design.fonts.body, color: colors.coverSubtext,
              valign: "middle", lineSpacingMultiple: 1.15,
            });
          }
        }
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
        slide.addText(num, {
          x: x + 0.14, y: y + 0.14, w: badgeS, h: badgeS,
          fontSize: Math.min(18, badgeS * 38), fontFace: design.fonts.title, bold: true,
          color: "FFFFFF", align: "center", valign: "middle",
        });
        const titleY = y + 0.14 + badgeS + 0.08;
        const titleH = Math.min(0.60, (cardH - badgeS - 0.36) * 0.50);
        slide.addText(pageModules[i].title, {
          x: x + 0.14, y: titleY, w: cardW - 0.28, h: titleH,
          fontSize: cardH < 1.4 ? 12 : 14, fontFace: design.fonts.title, bold: true,
          color: "FFFFFF", valign: "top", lineSpacingMultiple: 1.06, autoFit: true,
        });
        const sepY = titleY + titleH + 0.04;
        addHR(slide, x + 0.14, sepY, cardW * 0.45, pal, 0.010);
        if (pageModules[i].description) {
          const rawGridDesc = sanitizeText(pageModules[i].description!)
            .replace(/^[\u{1F300}-\u{1FFFF}\u2600-\u27FF]\s*/u, "")
            .replace(/^M\u00f3dulo\s+\w+:\s*/i, "")
            .replace(/\.$/, "").trim();
          if (rawGridDesc) {
            const descY = sepY + 0.06;
            const descH = Math.max(0.20, y + cardH - descY - 0.12);
            slide.addText(rawGridDesc, {
              x: x + 0.14, y: descY, w: cardW - 0.28, h: descH,
              fontSize: cardH < 1.4 ? 9 : 11, fontFace: design.fonts.body,
              color: colors.coverSubtext, valign: "top", lineSpacingMultiple: 1.18,
            });
          }
        }
        slide.addShape("ellipse" as any, {
          x: x + cardW - 0.26, y: y + cardH - 0.22, w: 0.08, h: 0.08,
          fill: { color: pal }, transparency: 40,
        });
      }
    }
  }
}

// ── MODULE COVER ──
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

  addGradientBar(slide, contentW * 0.60, 0, Math.min(contentW * 0.40, SLIDE_W - contentW * 0.60), SLIDE_H, accentColor, "down");

  if (!hasImage) {
    slide.addText(modNum, {
      x: contentW - 5.20, y: 2.20, w: 4.80, h: 4.00,
      fontSize: 180, fontFace: design.fonts.title, bold: true,
      color: accentColor, transparency: 90, align: "right", valign: "bottom",
    });
    slide.addShape("ellipse" as any, { x: contentW - 2.70, y: -0.60, w: 3.00, h: 3.00, fill: { color: accentColor }, transparency: 90 });
    slide.addShape("ellipse" as any, { x: contentW - 1.80, y: 0.65, w: 0.16, h: 0.16, fill: { color: accentColor }, transparency: 20 });
  }

  slide.addShape("rect" as any, { x: 0.80, y: 1.10, w: 0.05, h: 2.30, fill: { color: accentColor } });
  slide.addShape("rect" as any, { x: 0.88, y: 1.10, w: 0.015, h: 2.30, fill: { color: accentColor }, transparency: 50 });
  slide.addText(`MÓDULO ${modNum}`, {
    x: 1.10, y: 1.20, w: 5.0, h: 0.28,
    fontSize: 11, fontFace: design.fonts.body, bold: true, color: accentColor, charSpacing: 8,
  });
  addHR(slide, 1.10, 1.55, 1.40, accentColor, 0.022);
  const titleW = hasImage ? contentW * 0.75 : SLIDE_W * 0.53;
  slide.addText(plan.title, {
    x: 1.10, y: 1.72, w: titleW, h: 2.50,
    fontSize: 36, fontFace: design.fonts.title, bold: true,
    color: "FFFFFF", valign: "top", lineSpacingMultiple: 1.02,
  });

  if (plan.objectives && plan.objectives.length > 0) {
    const objStartY = 4.65;
    const objW = hasImage ? contentW * 0.70 : SLIDE_W * 0.48;
    addHR(slide, 1.10, objStartY - 0.12, 2.20, accentColor, 0.012);
    slide.addText("O QUE VOCÊ VAI APRENDER", {
      x: 1.10, y: objStartY, w: 5.0, h: 0.22,
      fontSize: 8, fontFace: design.fonts.body, bold: true, color: accentColor, charSpacing: 5,
    });
    for (let i = 0; i < Math.min(plan.objectives.length, 3); i++) {
      const objY = objStartY + 0.32 + i * 0.50;
      slide.addShape("roundRect" as any, { x: 1.10, y: objY + 0.05, w: 0.12, h: 0.12, fill: { color: accentColor }, rectRadius: 0.02 });
      slide.addText(plan.objectives[i], {
        x: 1.35, y: objY, w: objW, h: 0.45,
        fontSize: 11, fontFace: design.fonts.body, color: colors.coverSubtext,
        valign: "middle", lineSpacingMultiple: 1.12,
      });
    }
  }
  addGradientBar(slide, 0.80, SLIDE_H - 0.45, 3.50, 0.008, accentColor, "right");
}

// ── BULLETS (4 variants) ──
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
      slide.addText(plan.sectionLabel.toUpperCase(), {
        x: 0.45, y: 0.55, w: sideW - 0.90, h: 0.22,
        fontSize: 9, fontFace: design.fonts.body, bold: true, color: accentColor, charSpacing: 4,
      });
      addHR(slide, 0.45, 0.82, 1.20, accentColor, 0.012);
    }
    slide.addText(plan.title, {
      x: 0.45, y: 1.00, w: sideW - 0.90, h: 3.40,
      fontSize: 24, fontFace: design.fonts.title, bold: true, color: "FFFFFF",
      valign: "top", lineSpacingMultiple: 1.08,
    });
    for (let d = 0; d < Math.min(items.length, 5); d++) {
      slide.addShape("ellipse" as any, { x: 0.45, y: 4.80 + d * 0.40, w: 0.10, h: 0.10, fill: { color: design.palette[d % design.palette.length] } });
    }
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
      { // title:desc split rendering for bullets
        const bColonIdx = items[i].indexOf(":");
        const bHasTitle = bColonIdx > 0 && bColonIdx < 45 && items[i].split(" ").slice(0, bColonIdx).length <= 5;
        if (bHasTitle) {
          const bTitle = items[i].substring(0, bColonIdx).trim();
          const bDesc = items[i].substring(bColonIdx + 1).trim();
          slide.addText([
            { text: bTitle + ": ", options: { bold: true, color: pal } },
            { text: bDesc, options: { bold: false, color: colors.text } },
          ], { x: rightX + 0.18, y: yPos, w: rightW - 0.18, h: rItemH, fontSize: aFontSize, fontFace: design.fonts.body, valign: "middle", lineSpacingMultiple: 1.18, autoFit: true } as any);
        } else {
          slide.addText(items[i], { x: rightX + 0.18, y: yPos, w: rightW - 0.18, h: rItemH, fontSize: aFontSize, fontFace: design.fonts.body, color: colors.text, valign: "middle", lineSpacingMultiple: 1.18, autoFit: true } as any);
        }
      }
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
      slide.addShape("roundRect" as any, {
        x: contentX, y: yPos, w: contentW, h: itemH - 0.04,
        fill: { color: colors.cardBg }, rectRadius: 0.08,
        line: { color: colors.borders, width: 0.3 },
      });
      slide.addShape("rect" as any, { x: contentX, y: yPos, w: 0.06, h: itemH - 0.04, fill: { color: pal }, rectRadius: 0.08 });
      const badgeSize = Math.min(0.34, itemH - 0.14);
      slide.addShape("roundRect" as any, {
        x: contentX + 0.18, y: yPos + (itemH - 0.04) / 2 - badgeSize / 2,
        w: badgeSize, h: badgeSize, fill: { color: pal }, rectRadius: 0.06,
      });
      slide.addText(String(i + 1), {
        x: contentX + 0.18, y: yPos + (itemH - 0.04) / 2 - badgeSize / 2,
        w: badgeSize, h: badgeSize,
        fontSize: badgeSize >= 0.30 ? 13 : 10, fontFace: design.fonts.title, bold: true,
        color: "FFFFFF", align: "center", valign: "middle",
      });
      { // title:desc split rendering for variant 1
        const v1ColonIdx = items[i].indexOf(":");
        const v1HasTitle = v1ColonIdx > 0 && v1ColonIdx < 45;
        const v1FontSize = items.length >= 6 ? TYPO.BULLET_TEXT - 2 : TYPO.BULLET_TEXT - 1;
        const v1X = contentX + 0.18 + badgeSize + 0.14;
        const v1W = contentW - badgeSize - 0.42;
        if (v1HasTitle) {
          const v1Title = items[i].substring(0, v1ColonIdx).trim();
          const v1Desc = items[i].substring(v1ColonIdx + 1).trim();
          slide.addText([
            { text: v1Title + ": ", options: { bold: true, color: pal } },
            { text: v1Desc, options: { bold: false, color: colors.text } },
          ], { x: v1X, y: yPos + 0.03, w: v1W, h: itemH - 0.10, fontSize: v1FontSize, fontFace: design.fonts.body, valign: "middle", lineSpacingMultiple: 1.18, autoFit: true } as any);
        } else {
          slide.addText(items[i], { x: v1X, y: yPos + 0.03, w: v1W, h: itemH - 0.10, fontSize: v1FontSize, fontFace: design.fonts.body, color: colors.text, valign: "middle", lineSpacingMultiple: 1.18, autoFit: true } as any);
        }
      }
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
      slide.addText(String(i + 1), {
        x: x + 0.12, y: y + 0.06, w: 0.40, h: 0.34,
        fontSize: Math.min(15, cardW > 3 ? 16 : 13), fontFace: design.fonts.title, bold: true,
        color: ensureContrastOnLight(pal, colors.cardBg), transparency: 15, align: "left",
      });
      slide.addText(items[i], {
        x: x + 0.14, y: y + 0.38, w: cardW - 0.28, h: cardH - 0.48,
        fontSize: TYPO.BULLET_TEXT - 1, fontFace: design.fonts.body,
        color: colors.text, valign: "top", lineSpacingMultiple: 1.18,
      });
    }
  } else {
    addSlideBackground(slide, colors.bg);
    addLightBgDecoration(slide, design, colors);
    addLeftEdge(slide, accentColor);
    if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, accentColor, design.fonts.body);
    addSlideTitle(slide, plan.title, colors, design.fonts.title, accentColor);
    if (items.length > 0) {
      const heroH = items.length === 1 ? contentH : Math.min(1.60, contentH * 0.40);
      slide.addShape("roundRect" as any, {
        x: contentX, y: contentY, w: contentW, h: heroH,
        fill: { color: colors.coverDark }, rectRadius: 0.10,
      });
      slide.addShape("rect" as any, {
        x: contentX + 0.14, y: contentY + 0.14, w: 0.05, h: heroH - 0.28,
        fill: { color: accentColor },
      });
      slide.addText(items[0], {
        x: contentX + 0.32, y: contentY + 0.08, w: contentW - 0.48, h: heroH - 0.16,
        fontSize: TYPO.BODY_LARGE, fontFace: design.fonts.body,
        color: "FFFFFF", valign: "middle", lineSpacingMultiple: 1.30, italic: true, autoFit: true,
      } as any);
      if (items.length > 1) {
        const restY = contentY + heroH + 0.18;
        const restH = SLIDE_H - restY - 0.45;
        const restItemH = Math.min(0.80, (restH - 0.06 * (items.length - 2)) / (items.length - 1));
        for (let i = 1; i < items.length; i++) {
          const yPos = restY + (i - 1) * (restItemH + 0.06);
          const pal = design.palette[i % design.palette.length];
          slide.addShape("ellipse" as any, { x: contentX + 0.04, y: yPos + restItemH / 2 - 0.05, w: 0.10, h: 0.10, fill: { color: pal } });
          slide.addText(items[i], {
            x: contentX + 0.22, y: yPos, w: contentW - 0.22, h: restItemH,
            fontSize: items.length >= 5 ? TYPO.BULLET_TEXT - 2 : TYPO.BULLET_TEXT - 1,
            fontFace: design.fonts.body, color: colors.text,
            valign: "middle", lineSpacingMultiple: 1.15,
          });
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
    const rawItemH = (colContentH - colBulletGap * Math.max(colItems.length - 1, 0)) / Math.max(colItems.length, 1);
    const itemH = Math.max(0.42, Math.min(1.10, rawItemH));
    for (let i = 0; i < colItems.length; i++) {
      const palColor = design.palette[(col * mid + i) % design.palette.length];
      const yPos = contentY + i * (itemH + colBulletGap);
      addCardShadow(slide, colX, yPos, colW, itemH - 0.02, colors.shadowColor, design.theme === "light");
      slide.addShape("roundRect" as any, { x: colX, y: yPos, w: colW, h: itemH - 0.02, fill: { color: colors.cardBg }, rectRadius: 0.06 });
      slide.addShape("rect" as any, { x: colX, y: yPos, w: 0.05, h: itemH - 0.02, fill: { color: palColor }, rectRadius: 0.06 });
      const badgeW = 0.30;
      slide.addShape("roundRect" as any, { x: colX + 0.14, y: yPos + (itemH - 0.02) / 2 - badgeW / 2, w: badgeW, h: badgeW, fill: { color: palColor }, rectRadius: 0.06 });
      slide.addText(String(col * mid + i + 1), {
        x: colX + 0.14, y: yPos + (itemH - 0.02) / 2 - badgeW / 2, w: badgeW, h: badgeW,
        fontSize: 11, fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle",
      });
      slide.addText(colItems[i], {
        x: colX + 0.52, y: yPos + 0.03, w: colW - 0.60, h: itemH - 0.08,
        fontSize: TYPO.BULLET_TEXT - 1, fontFace: design.fonts.body, color: colors.text,
        valign: "middle", lineSpacingMultiple: 1.18,
      });
    }
  }
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ── GRID CARDS ──
function renderGridCards(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  addSlideBackground(slide, colors.bg);
  addLightBgDecoration(slide, design, colors);
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
    addCardShadow(slide, x, y, cardW, cardH, colors.shadowColor, design.theme === "light");
    slide.addShape("roundRect" as any, { x, y, w: cardW, h: cardH, fill: { color: colors.cardBg }, rectRadius: 0.10 });
    slide.addShape("rect" as any, { x, y, w: cardW, h: 0.05, fill: { color: pal }, rectRadius: 0.10 });
    // Normalize item: if no colon separator, try to infer "Title: description" split
    // Pattern: short phrase (1-4 words, title-case) followed by longer description
    let normalizedItem = items[i];
    if (normalizedItem.indexOf(":") < 0 || normalizedItem.indexOf(":") > 40) {
      const inferMatch = normalizedItem.match(/^([A-ZÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÇ][\w\sàáéíóúàèìòùâêîôûãõçÀÁÉÍÓÚÂÊÎÔÛÃÕÇ]{0,35}?)\s+([A-ZÁÉÍÓÚO][a-záéíóúàèìòùâêîôûãõç].{10,})/u);
      if (inferMatch && inferMatch[1].split(" ").length <= 4) {
        normalizedItem = inferMatch[1].trim() + ": " + inferMatch[2].trim();
      }
    }
    const colonIdx = normalizedItem.indexOf(":");
    if (colonIdx > 0 && colonIdx < 70) {
      const label = normalizedItem.substring(0, colonIdx).trim();
      const desc = normalizedItem.substring(colonIdx + 1).trim();
      const gcBadge = Math.min(0.32, cardW * 0.15, cardH * 0.20);
      slide.addShape("roundRect" as any, { x: x + 0.10, y: y + 0.14, w: gcBadge, h: gcBadge, fill: { color: pal }, rectRadius: 0.06 });
      slide.addText(String(i + 1), {
        x: x + 0.10, y: y + 0.14, w: gcBadge, h: gcBadge,
        fontSize: Math.min(12, gcBadge * 34), fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle",
      });
      const labelX = x + 0.10 + gcBadge + 0.08;
      const labelW = x + cardW - labelX - 0.10;
      const estCharsPerLine = Math.max(1, Math.floor(labelW * 72 / (TYPO.CARD_TITLE * 0.55)));
      const estLines = Math.ceil(label.length / estCharsPerLine);
      const labelH = estLines > 1 ? 0.62 : 0.38;
      slide.addText(label, {
        x: labelX, y: y + 0.12, w: labelW, h: labelH,
        fontSize: items.length >= 6 ? TYPO.CARD_TITLE - 1 : TYPO.CARD_TITLE,
        fontFace: design.fonts.title, bold: true, color: ensureContrastOnLight(pal, colors.cardBg),
        valign: "middle", lineSpacingMultiple: 1.10,
      });
      const sepY = y + 0.12 + labelH + 0.06;
      addHR(slide, x + 0.10, sepY, cardW - 0.20, colors.borders, 0.004);
      slide.addText(desc, {
        x: x + 0.12, y: sepY + 0.08, w: cardW - 0.24, h: Math.max(0.30, y + cardH - sepY - 0.16),
        fontSize: items.length >= 6 ? TYPO.CARD_BODY - 1 : TYPO.CARD_BODY,
        fontFace: design.fonts.body, color: colors.text, valign: "top", lineSpacingMultiple: 1.18,
      });
    } else {
      const gcBadge = Math.min(0.32, cardW * 0.15, cardH * 0.20);
      slide.addShape("roundRect" as any, { x: x + 0.10, y: y + 0.14, w: gcBadge, h: gcBadge, fill: { color: pal }, rectRadius: 0.06 });
      slide.addText(String(i + 1), {
        x: x + 0.10, y: y + 0.14, w: gcBadge, h: gcBadge,
        fontSize: Math.min(12, gcBadge * 34), fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle",
      });
      slide.addText(items[i], {
        x: x + 0.12, y: y + 0.14 + gcBadge + 0.10, w: cardW - 0.24, h: cardH - (0.14 + gcBadge + 0.18),
        fontSize: items.length >= 6 ? TYPO.CARD_BODY - 1 : TYPO.CARD_BODY,
        fontFace: design.fonts.body, color: colors.text, valign: "top", lineSpacingMultiple: 1.18,
      });
    }
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
  const contentW = SLIDE_W - contentX - 0.40;

  if (items.length <= 4) {
    addSlideBackground(slide, colors.coverDark);
    if (plan.sectionLabel) {
      slide.addText(plan.sectionLabel.toUpperCase(), {
        x: 0.55, y: 0.30, w: 6.0, h: 0.24,
        fontSize: 10, fontFace: design.fonts.body, bold: true, color: colors.p2, charSpacing: 5,
      });
      addHR(slide, 0.55, 0.57, 1.00, colors.p2, 0.020);
    }
    slide.addText(plan.title, {
      x: 0.55, y: 0.68, w: SLIDE_W - 1.10, h: 0.70,
      fontSize: 26, fontFace: design.fonts.title, bold: true, color: "FFFFFF", valign: "middle",
    });
    const flowY = 1.68;
    const cardY = flowY + 0.20;
    const cardH = SLIDE_H - cardY - 0.45;
    const gap = 0.06;
    const arrowW = 0.40;
    const totalArrowW = arrowW * Math.max(items.length - 1, 0);
    const cardW = (contentW - totalArrowW - gap * Math.max(items.length - 1, 0)) / items.length;
    slide.addShape("rect" as any, { x: contentX, y: cardY + cardH * 0.35, w: contentW, h: 0.04, fill: { color: colors.p2 }, transparency: 60 });
    for (let i = 0; i < items.length; i++) {
      const x = contentX + i * (cardW + arrowW + gap);
      const pal = design.palette[i % design.palette.length];
      slide.addShape("roundRect" as any, { x: x + 0.02, y: cardY + 0.03, w: cardW, h: cardH, fill: { color: "000000" }, transparency: 70, rectRadius: 0.12 });
      slide.addShape("roundRect" as any, { x, y: cardY, w: cardW, h: cardH, fill: { color: colors.panelMid }, rectRadius: 0.12 });
      slide.addShape("rect" as any, { x, y: cardY, w: cardW, h: 0.05, fill: { color: pal }, rectRadius: 0.12 });
      const badgeSz = 0.40;
      slide.addShape("roundRect" as any, { x: x + cardW / 2 - badgeSz / 2, y: cardY + 0.14, w: badgeSz, h: badgeSz, fill: { color: pal }, rectRadius: 0.08 });
      slide.addText(String(i + 1), {
        x: x + cardW / 2 - badgeSz / 2, y: cardY + 0.14, w: badgeSz, h: badgeSz,
        fontSize: 16, fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle",
      });
      if (i < items.length - 1) {
        const arrowX = x + cardW + gap / 2;
        const arrowMidY = cardY + cardH * 0.35;
        slide.addShape("rect" as any, { x: arrowX, y: arrowMidY - 0.02, w: arrowW - 0.06, h: 0.04, fill: { color: pal }, transparency: 25 });
        slide.addShape("rect" as any, { x: arrowX + arrowW - 0.18, y: arrowMidY - 0.06, w: 0.12, h: 0.12, fill: { color: pal }, transparency: 25, rotate: 45 });
      }
      // Normalize item: if no colon separator, try to infer "Title: description" split
    // Pattern: short phrase (1-4 words, title-case) followed by longer description
    let normalizedItem = items[i];
    if (normalizedItem.indexOf(":") < 0 || normalizedItem.indexOf(":") > 40) {
      const inferMatch = normalizedItem.match(/^([A-ZÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÇ][\w\sàáéíóúàèìòùâêîôûãõçÀÁÉÍÓÚÂÊÎÔÛÃÕÇ]{0,35}?)\s+([A-ZÁÉÍÓÚO][a-záéíóúàèìòùâêîôûãõç].{10,})/u);
      if (inferMatch && inferMatch[1].split(" ").length <= 4) {
        normalizedItem = inferMatch[1].trim() + ": " + inferMatch[2].trim();
      }
    }
    const colonIdx = normalizedItem.indexOf(":");
      let label: string, desc: string;
      if (colonIdx > 0 && colonIdx < 70) { label = items[i].substring(0, colonIdx).trim(); desc = items[i].substring(colonIdx + 1).trim(); }
      else if (items[i].length <= 50) { label = items[i]; desc = ""; }
      else { const words = items[i].split(/\s+/); label = words.slice(0, 6).join(" "); desc = words.slice(6).join(" "); }
      if (desc && desc.length > 0) {
        const ptLabelH = label.length > 20 ? 0.44 : 0.28;
        const ptDescY = cardY + 0.55 + ptLabelH + 0.06;
        slide.addText(label, { x: x + 0.15, y: cardY + 0.55, w: cardW - 0.30, h: ptLabelH, fontSize: TYPO.BODY - 1, fontFace: design.fonts.title, bold: true, color: pal, align: "center", valign: "middle", lineSpacingMultiple: 1.08 });
        slide.addText(desc, { x: x + 0.15, y: ptDescY, w: cardW - 0.30, h: cardH - (ptDescY - cardY) - 0.10, fontSize: TYPO.BODY - 1, fontFace: design.fonts.body, color: colors.coverSubtext, valign: "top", align: "center", lineSpacingMultiple: 1.18, autoFit: true } as any);
      } else {
        slide.addText(label, { x: x + 0.15, y: cardY + 0.55, w: cardW - 0.30, h: cardH - 0.70, fontSize: TYPO.BODY, fontFace: design.fonts.body, color: colors.coverSubtext, valign: "top", align: "center", lineSpacingMultiple: 1.25, autoFit: true } as any);
      }
    }
  } else {
    addSlideBackground(slide, colors.bg);
    addLightBgDecoration(slide, design, colors);
    addLeftEdge(slide, colors.p2);
    if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, colors.p2, design.fonts.body);
    addSlideTitle(slide, plan.title, colors, design.fonts.title, colors.p2);
    const phaseColors = [colors.p1, colors.p3, colors.p0, colors.p2, colors.p4, colors.p1, colors.p3];
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
      slide.addText(String(i + 1), {
        x: nodeX, y: y + stepH / 2 - nodeSize / 2, w: nodeSize, h: nodeSize,
        fontSize: items.length <= 5 ? 12 : 10, fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle",
      });
      const cardX2 = nodeX + nodeSize + 0.16;
      const cardW2 = contentW - (cardX2 - contentX);
      addCardShadow(slide, cardX2, y, cardW2, stepH - 0.02, colors.shadowColor, design.theme === "light");
      slide.addShape("roundRect" as any, { x: cardX2, y, w: cardW2, h: stepH - 0.02, fill: { color: colors.cardBg }, rectRadius: 0.06 });
      slide.addShape("rect" as any, { x: cardX2, y, w: 0.05, h: stepH - 0.02, fill: { color: pal }, rectRadius: 0.06 });
      // Normalize item: if no colon separator, try to infer "Title: description" split
    // Pattern: short phrase (1-4 words, title-case) followed by longer description
    let normalizedItem = items[i];
    if (normalizedItem.indexOf(":") < 0 || normalizedItem.indexOf(":") > 40) {
      const inferMatch = normalizedItem.match(/^([A-ZÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÇ][\w\sàáéíóúàèìòùâêîôûãõçÀÁÉÍÓÚÂÊÎÔÛÃÕÇ]{0,35}?)\s+([A-ZÁÉÍÓÚO][a-záéíóúàèìòùâêîôûãõç].{10,})/u);
      if (inferMatch && inferMatch[1].split(" ").length <= 4) {
        normalizedItem = inferMatch[1].trim() + ": " + inferMatch[2].trim();
      }
    }
    const colonIdx = normalizedItem.indexOf(":");
      let label = "", desc = items[i];
      if (colonIdx > 0 && colonIdx < 70) { label = items[i].substring(0, colonIdx).trim(); desc = items[i].substring(colonIdx + 1).trim(); }
      const textX = cardX2 + 0.05 + 0.12;
      const textW = cardW2 - 0.05 - 0.22;
      const fontSize = items.length <= 5 ? TYPO.BULLET_TEXT : TYPO.BULLET_TEXT - 1;
      if (label) {
        slide.addText(label, { x: textX, y: y + 0.02, w: textW, h: stepH * 0.38, fontSize, fontFace: design.fonts.title, bold: true, color: pal, valign: "bottom" });
        slide.addText(desc, { x: textX, y: y + stepH * 0.38, w: textW, h: stepH * 0.58, fontSize: fontSize - 1, fontFace: design.fonts.body, color: colors.text, valign: "top", lineSpacingMultiple: 1.10 });
      } else {
        slide.addText(desc, { x: textX, y, w: textW, h: stepH - 0.02, fontSize, fontFace: design.fonts.body, color: colors.text, valign: "middle", lineSpacingMultiple: 1.12 });
      }
      if (i < items.length - 1) {
        const arrowY = y + stepH + stepGap / 2;
        slide.addText("▼", { x: contentX + 0.23, y: arrowY - 0.08, w: 0.20, h: 0.16, fontSize: 7, color: phaseColors[i + 1] || pal, align: "center", valign: "middle", transparency: 40 });
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
    text: h, options: { fontSize: TYPO.TABLE_HEADER, fontFace: design.fonts.title, bold: true, color: "FFFFFF", fill: { color: colors.p0 }, align: "center", valign: "middle" },
  })));
  for (let r = 0; r < rows.length; r++) {
    tableData.push(rows[r].map((cell) => ({
      text: cell, options: { fontSize: TYPO.TABLE_CELL, fontFace: design.fonts.body, color: colors.text, fill: { color: r % 2 === 0 ? colors.tableRowOdd : colors.tableRowEven }, valign: "middle" },
    })));
  }
  slide.addTable(tableData, {
    x: contentX, y: 1.68, w: contentW,
    colW: new Array(headers.length).fill(contentW / headers.length),
    rowH: 0.48,
    border: { type: "solid", pt: 0.3, color: colors.borders },
    autoPage: false,
  });
  addFooter(slide, colors, design.fonts.body, ++_globalSlideNumber, _globalTotalSlides, _globalFooterBrand);
}

// ── EXAMPLE HIGHLIGHT ──
function renderExampleHighlight(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  _globalSlideIdx++;
  const items = (plan.items || []).filter(Boolean).map((item) => ensureSentenceEnd(sanitizeText(item)));
  const cappedItems = items.slice(0, 4);  // max 4: Contexto → Desafio → Solução → Resultado
  const defaultLabels = ["Contexto", "Desafio", "Solução", "Resultado"];
  const phaseColors = [colors.p1, colors.p3, colors.p0, colors.p4];

  addSlideBackground(slide, colors.coverDark);
  slide.addShape("rect" as any, { x: 0, y: 0, w: 0.50, h: SLIDE_H, fill: { color: colors.panelMid } });
  for (let i = 0; i < Math.min(cappedItems.length, 5); i++) {
    const dotY = 1.60 + i * ((SLIDE_H - 2.20) / Math.max(cappedItems.length - 1, 1));
    slide.addShape("ellipse" as any, { x: 0.18, y: dotY - 0.05, w: 0.14, h: 0.14, fill: { color: phaseColors[i] } });
    if (i < cappedItems.length - 1) {
      const nextY = 1.60 + (i + 1) * ((SLIDE_H - 2.20) / Math.max(cappedItems.length - 1, 1));
      slide.addShape("rect" as any, { x: 0.24, y: dotY + 0.10, w: 0.02, h: nextY - dotY - 0.16, fill: { color: phaseColors[i] }, transparency: 50 });
    }
  }
  const badgeW = 1.50, badgeH = 0.28;
  slide.addShape("roundRect" as any, { x: 0.80, y: 0.42, w: badgeW, h: badgeH, fill: { color: colors.p3 }, rectRadius: 0.14 });
  slide.addText("ESTUDO DE CASO", { x: 0.80, y: 0.42, w: badgeW, h: badgeH, fontSize: 8, fontFace: design.fonts.body, bold: true, color: "FFFFFF", align: "center", valign: "middle", charSpacing: 4 });
  slide.addText(plan.title, { x: 0.80, y: 0.80, w: SLIDE_W - 1.50, h: 0.60, fontSize: 24, fontFace: design.fonts.title, bold: true, color: "FFFFFF", valign: "middle" });
  addHR(slide, 0.80, 1.42, 3.50, colors.p3, 0.020);
  const contentX2 = 0.80;
  const contentW2 = SLIDE_W - 1.50;
  const gridStartY = 1.60;
  const gridH = SLIDE_H - gridStartY - 0.50;
  const bandGap = 0.10;
  const bandH = Math.min((gridH - bandGap * Math.max(cappedItems.length - 1, 0)) / Math.max(cappedItems.length, 1), 1.35);
  const descFontSize = cappedItems.length >= 4 ? TYPO.BODY - 1 : TYPO.BODY;
  for (let i = 0; i < cappedItems.length; i++) {
    const y = gridStartY + i * (bandH + bandGap);
    const pal = phaseColors[i % phaseColors.length];
    const colonIdx = cappedItems[i].indexOf(":");
    const label = colonIdx > 0 && colonIdx < 70 ? cappedItems[i].substring(0, colonIdx).trim() : defaultLabels[i % defaultLabels.length];
    const desc = colonIdx > 0 ? cappedItems[i].substring(colonIdx + 1).trim() : cappedItems[i];
    addCardShadow(slide, contentX2, y, contentW2, bandH, "000000");
    slide.addShape("roundRect" as any, { x: contentX2, y, w: contentW2, h: bandH, fill: { color: colors.panelMid }, rectRadius: 0.08 });
    slide.addShape("rect" as any, { x: contentX2, y: y + 0.04, w: 0.05, h: bandH - 0.08, fill: { color: pal }, rectRadius: 0.03 });
    const numBadgeSize = 0.30;
    slide.addShape("ellipse" as any, { x: contentX2 + 0.18, y: y + (bandH - numBadgeSize) / 2, w: numBadgeSize, h: numBadgeSize, fill: { color: pal }, transparency: 15 });
    slide.addText(`${i + 1}`, { x: contentX2 + 0.18, y: y + (bandH - numBadgeSize) / 2, w: numBadgeSize, h: numBadgeSize, fontSize: 12, fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
    slide.addText(label.toUpperCase(), { x: contentX2 + 0.56, y: y + 0.04, w: 2.00, h: 0.24, fontSize: 8, fontFace: design.fonts.title, bold: true, color: pal, charSpacing: 3, valign: "middle" });
    slide.addText(desc, { x: contentX2 + 0.56, y: y + 0.26, w: contentW2 - 0.80, h: bandH - 0.32, fontSize: descFontSize, fontFace: design.fonts.body, color: colors.coverSubtext, valign: "top", lineSpacingMultiple: 1.18 });
    if (i < cappedItems.length - 1) { slide.addText("▼", { x: contentX2 + 0.23, y: y + bandH + bandGap / 2 - 0.08, w: 0.20, h: 0.16, fontSize: 7, color: phaseColors[i + 1] || pal, align: "center", valign: "middle", transparency: 40 }); }
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
  addLeftEdge(slide, "C0392B");
  if (plan.sectionLabel) addSectionLabel(slide, plan.sectionLabel, "C0392B", design.fonts.body);
  addSlideTitle(slide, plan.title, colors, design.fonts.title, "C0392B");
  slide.addShape("roundRect" as any, { x: SLIDE_W - 1.50, y: 0.35, w: 0.80, h: 0.80, fill: { color: "FEF2F2" }, rectRadius: 0.12 });
  slide.addText("⚠", { x: SLIDE_W - 1.50, y: 0.35, w: 0.80, h: 0.80, fontSize: 28, align: "center", valign: "middle" });
  const items = (plan.items || []).slice(0, 5);
  const contentX = 0.65, contentW = SLIDE_W - contentX - 0.50, contentY = 1.58;
  const bulletGap = 0.10, contentH = SLIDE_H - contentY - 0.45;
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
    // Normalize item: if no colon separator, try to infer "Title: description" split
    // Pattern: short phrase (1-4 words, title-case) followed by longer description
    let normalizedItem = items[i];
    if (normalizedItem.indexOf(":") < 0 || normalizedItem.indexOf(":") > 40) {
      const inferMatch = normalizedItem.match(/^([A-ZÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÇ][\w\sàáéíóúàèìòùâêîôûãõçÀÁÉÍÓÚÂÊÎÔÛÃÕÇ]{0,35}?)\s+([A-ZÁÉÍÓÚO][a-záéíóúàèìòùâêîôûãõç].{10,})/u);
      if (inferMatch && inferMatch[1].split(" ").length <= 4) {
        normalizedItem = inferMatch[1].trim() + ": " + inferMatch[2].trim();
      }
    }
    const colonIdx = normalizedItem.indexOf(":");
    const hasLabel = colonIdx > 0 && colonIdx < 70;
    const itemLabel = hasLabel ? items[i].substring(0, colonIdx).trim() : "";
    const itemDesc = hasLabel ? items[i].substring(colonIdx + 1).trim() : items[i];
    if (hasLabel) {
      slide.addText(itemLabel.toUpperCase(), { x: contentX + 0.18, y: y + 0.04, w: contentW - 0.26, h: 0.18, fontSize: 7, fontFace: design.fonts.title, bold: true, color: "C0392B", charSpacing: 2, valign: "middle" });
      slide.addText(itemDesc, { x: contentX + 0.18, y: y + 0.22, w: contentW - 0.30, h: cardH - 0.26, fontSize: bodyFontSize, fontFace: design.fonts.body, color: cardTextColor, valign: "top", lineSpacingMultiple: 1.12 });
    } else {
      slide.addText(items[i], { x: contentX + 0.18, y: y + 0.04, w: contentW - 0.30, h: cardH - 0.08, fontSize: bodyFontSize, fontFace: design.fonts.body, color: cardTextColor, valign: "middle", lineSpacingMultiple: 1.12 });
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
  slide.addText("\u201C", { x: 0.30, y: -0.30, w: 2.00, h: 2.00, fontSize: 180, fontFace: design.fonts.title, color: colors.p1, transparency: 88, bold: true });
  addHR(slide, 0.65, 0.55, SLIDE_W - 1.30, colors.p1, 0.018);
  slide.addText("REFLEXÃO", { x: 0.65, y: 0.80, w: 4.0, h: 0.24, fontSize: 10, fontFace: design.fonts.body, bold: true, color: colors.p1, charSpacing: 6 });
  slide.addText(plan.title, { x: 0.65, y: 1.12, w: SLIDE_W - 1.30, h: 0.55, fontSize: 24, fontFace: design.fonts.title, bold: true, color: "FFFFFF" });
  const items = plan.items || [];
  const contentY = 1.90, contentH = SLIDE_H - contentY - 0.60;
  const itemGap = 0.16;
  const rawItemH = (contentH - itemGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1);
  const itemH = Math.max(0.65, Math.min(1.30, rawItemH));
  for (let i = 0; i < items.length; i++) {
    const y = contentY + i * (itemH + itemGap);
    slide.addShape("roundRect" as any, { x: 0.65, y, w: SLIDE_W - 1.30, h: itemH, fill: { color: colors.panelMid }, rectRadius: 0.08, transparency: 30 });
    slide.addText(items[i], { x: 1.00, y, w: SLIDE_W - 2.00, h: itemH, fontSize: TYPO.BODY_LARGE, fontFace: design.fonts.body, italic: true, color: colors.coverSubtext, valign: "middle", lineSpacingMultiple: 1.42 });
  }
  addGradientBar(slide, 0.65, SLIDE_H - 0.50, SLIDE_W - 1.30, 0.012, colors.p1, "right");
  slide.addShape("ellipse" as any, { x: SLIDE_W - 1.80, y: SLIDE_H - 0.18, w: 0.08, h: 0.08, fill: { color: colors.p1 } });
  slide.addText("EduGenAI", { x: SLIDE_W - 1.70, y: SLIDE_H - 0.24, w: 1.40, h: 0.20, fontSize: 8, fontFace: design.fonts.body, bold: true, color: colors.coverSubtext, align: "right", valign: "middle", charSpacing: 3 });
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
    slide.addText(plan.sectionLabel.toUpperCase(), { x: sidebarW + 0.30, y: 0.30, w: 6.0, h: 0.24, fontSize: 10, fontFace: design.fonts.body, bold: true, color: colors.p0, charSpacing: 5 });
    addHR(slide, sidebarW + 0.30, 0.57, 0.90, colors.p0, 0.020);
  }
  slide.addText(plan.title, { x: sidebarW + 0.30, y: 0.68, w: SLIDE_W - sidebarW - 0.80, h: 0.75, fontSize: TYPO.SECTION_TITLE, fontFace: design.fonts.title, bold: true, color: colors.text, valign: "middle" });
  const items = (plan.items || []).filter((item) => item.replace(/[.\s]+$/, "").trim().length >= 10);
  const contentX = sidebarW + 0.30, contentW = SLIDE_W - contentX - 0.50, contentY = 1.60;
  const contentHAvail = SLIDE_H - contentY - 0.40;
  const cols = items.length >= 4 ? 2 : 1;
  const rows = Math.ceil(items.length / cols);
  const gap = 0.12;
  const cardW = (contentW - gap * (cols - 1)) / cols;
  const cardH = Math.min(1.50, (contentHAvail - gap * (rows - 1)) / rows);
  for (let i = 0; i < items.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const x = contentX + col * (cardW + gap), y = contentY + row * (cardH + gap);
    const pal = design.palette[i % design.palette.length];
    addCardShadow(slide, x, y, cardW, cardH, colors.shadowColor, design.theme === "light");
    slide.addShape("roundRect" as any, { x, y, w: cardW, h: cardH, fill: { color: colors.cardBg }, rectRadius: 0.10 });
    slide.addShape("rect" as any, { x, y, w: 0.05, h: cardH, fill: { color: pal }, rectRadius: 0.10 });
    const numSize = 0.32;
    slide.addShape("roundRect" as any, { x: x + 0.14, y: y + 0.10, w: numSize, h: numSize, fill: { color: pal }, rectRadius: 0.08 });
    slide.addText(String(i + 1), { x: x + 0.14, y: y + 0.10, w: numSize, h: numSize, fontSize: 16, fontFace: design.fonts.title, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
    slide.addText(items[i], { x: x + 0.14, y: y + numSize + 0.14, w: cardW - 0.28, h: cardH - numSize - 0.24, fontSize: TYPO.BODY, fontFace: design.fonts.body, color: colors.text, valign: "top", lineSpacingMultiple: 1.25 });
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
  if (plan.sectionLabel) { slide.addText(plan.sectionLabel.toUpperCase(), { x: 0.65, y: 0.28, w: 6.0, h: 0.24, fontSize: 10, fontFace: design.fonts.body, bold: true, color: colors.p4, charSpacing: 6 }); }
  slide.addText(plan.title, { x: 0.65, y: 0.58, w: SLIDE_W - 1.30, h: 0.70, fontSize: 28, fontFace: design.fonts.title, bold: true, color: "FFFFFF", valign: "middle" });
  addHR(slide, 0.65, 1.35, 1.80, colors.p4, 0.025);
  const items = plan.items || [];
  const contentX = 0.65, contentW = SLIDE_W - contentX - 0.50;
  const cols = items.length <= 3 ? items.length : items.length <= 4 ? 2 : 3;
  const gridRows = Math.ceil(items.length / cols);
  const gap = 0.14;
  const cardW = (contentW - gap * (cols - 1)) / cols;
  const contentY = 1.65, contentH = SLIDE_H - contentY - 0.30;
  const cardH = Math.min(1.80, (contentH - gap * (gridRows - 1)) / gridRows);
  for (let i = 0; i < items.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const x = contentX + col * (cardW + gap), y = contentY + row * (cardH + gap);
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

// ── CLOSING ──
function renderClosingSlide(pptx: PptxGenJS, courseTitle: string, design: DesignConfig, image?: SlideImage | null) {
  const colors = getColors(design);
  const slide = pptx.addSlide();

  if (image) {
    try {
      console.log(`[V3-RENDER] Closing image: base64 length=${image.base64Data.length}, starts=${image.base64Data.substring(0, 30)}`);
      // Use slide.background for full-slide background image
      slide.background = { data: image.base64Data };
    } catch (e) {
      console.error(`[V3-RENDER] Closing background FAILED:`, e);
      addSlideBackground(slide, colors.coverDark);
    }
    // Dark overlay for text readability over background image
    addHeroTextReadabilityOverlay(slide);
  } else {
    console.log("[V3-RENDER] Closing: no image provided");
    addSlideBackground(slide, colors.coverDark);
  }
  if (!image) {
    addGradientBar(slide, SLIDE_W * 0.45, 0, SLIDE_W * 0.55, SLIDE_H, colors.p0, "down");
    slide.addShape("ellipse" as any, { x: SLIDE_W - 4.00, y: -1.20, w: 5.00, h: 5.00, fill: { color: colors.p1 }, transparency: 92 });
  }
  slide.addShape("rect" as any, { x: 0.80, y: 0.90, w: 0.05, h: 3.80, fill: { color: colors.p0 } });
  slide.addShape("rect" as any, { x: 0.88, y: 0.90, w: 0.015, h: 3.80, fill: { color: colors.p0 }, transparency: 50 });
  addHR(slide, 1.20, 1.30, 3.00, colors.p0, 0.015);
  if (!image) {
    for (let b = 0; b < 5; b++) { slide.addShape("roundRect" as any, { x: 0.28, y: 1.10 + b * 0.28, w: 0.30, h: 0.16, fill: { color: design.palette[b % design.palette.length] }, transparency: 20, rectRadius: 0.04 }); }
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

// ── SLIDE DISPATCHER ──
function renderSlide(pptx: PptxGenJS, plan: SlidePlan, design: DesignConfig, image?: SlideImage | null) {
  switch (plan.layout) {
    case "module_cover":     renderModuleCover(pptx, plan, design, image); break;
    case "two_column_bullets": renderTwoColumnBullets(pptx, plan, design); break;
    case "grid_cards":       renderGridCards(pptx, plan, design); break;
    case "process_timeline": renderProcessTimeline(pptx, plan, design); break;
    case "comparison_table": renderComparisonTable(pptx, plan, design); break;
    case "example_highlight": renderExampleHighlight(pptx, plan, design); break;
    case "warning_callout":  renderWarningCallout(pptx, plan, design); break;
    case "reflection_callout": renderReflectionCallout(pptx, plan, design); break;
    case "summary_slide":    renderSummarySlide(pptx, plan, design); break;
    case "numbered_takeaways": renderNumberedTakeaways(pptx, plan, design); break;
    case "bullets":
    default:                 renderBullets(pptx, plan, design); break;
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

  // Build image plan in parallel with AI generation
  const imagePlanPromise = buildImagePlan(courseTitle, modules, design.includeImages);

  // Generate slides for all modules (sequential to respect API rate limits)
  const allModuleSlidePlans: SlidePlan[][] = [];
  for (let mi = 0; mi < modules.length; mi++) {
    const mod = modules[mi];
    const rawTitle = sanitizeText(mod.title || `Módulo ${mi + 1}`);
    const cleanTitle = rawTitle.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;

    console.log(`[V3-STAGE-1] Generating slides for module ${mi + 1}/${modules.length}: "${cleanTitle}"`);
    const moduleSlides = await generateSlidesForModule(
      cleanTitle,
      mod.content || "",
      mi,
      design,
      language,
      report,
    );
    allModuleSlidePlans.push(moduleSlides);
  }

  // Wait for image plan
  const imagePlan = await imagePlanPromise;

  const unsplashKey = Deno.env.get("UNSPLASH_ACCESS_KEY") || "";
  report.imageDiagnostics = {
    unsplashKeyPresent: unsplashKey.length > 0,
    unsplashKeyLength: unsplashKey.length,
    includeImages: design.includeImages,
    coverImageFetched: !!imagePlan.cover,
    closingImageFetched: !!imagePlan.closing,
    moduleImagesFetched: imagePlan.modules.size,
    moduleImagesTotal: modules.length,
    errors: [],
  };
  if (!unsplashKey) report.imageDiagnostics.errors.push("UNSPLASH_ACCESS_KEY not set");
  if (!design.includeImages) report.imageDiagnostics.errors.push("includeImages is false");

  // Build TOC descriptions (first sentence of each module content)
  const tocModules = modules.map((m) => {
    const rawTitle = sanitizeText(m.title || "");
    const cleanTitle = rawTitle.replace(/^m[oó]dulo\s+\d+\s*[:–\-]\s*/i, "").trim() || rawTitle;
    const stripped = (m.content || "")
      .replace(/#{1,6}\s*/g, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/[*_`]/g, "")
      .replace(/^[-*]\s+/gm, "").replace(/^\d+[.)]\s+/gm, "");
    const firstSentence = stripped.split(/[.!?]\s+/)[0]?.trim() || "";
    return {
      title: cleanTitle,
      description: firstSentence.length > 20 ? firstSentence.substring(0, 105) + "." : undefined,
    };
  });

  console.log(`[V3-STAGE-2] Rendering slides...`);

  // Render cover
  renderCoverSlide(pptx, courseTitle, design, imagePlan.cover);

  // Render TOC
  renderTOC(pptx, tocModules, design);

  // Count total content slides for footer
  _globalTotalSlides = allModuleSlidePlans.reduce((sum, plans) => sum + plans.length, 0);

  // Render all module slides
  for (let mi = 0; mi < allModuleSlidePlans.length; mi++) {
    const modulePlans = allModuleSlidePlans[mi];
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

  console.log(`[V3-PIPELINE] Complete: ${report.totalModules} modules, ${report.totalSlides} slides, ${report.aiCallsTotal} AI calls (${report.aiCallsFailed} failed, ${report.fallbacksUsed} fallbacks)`);

  return { pptx, report };
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
    const { data: claimsData, error: claimsError } = await userClient.auth.getUser(token);
    if (claimsError || !claimsData?.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = claimsData.user.id;

    const body = await req.json();
    const { course_id, palette, density, theme, includeImages, template, courseType, footerBrand, language } = body;
    if (!course_id) {
      return new Response(
        JSON.stringify({ error: "course_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Check subscription
    const { data: sub } = await serviceClient.from("subscriptions").select("plan").eq("user_id", userId).single();
    const userPlan = sub?.plan || "free";
    if (userPlan !== "pro") {
      const { data: profile } = await serviceClient.from("profiles").select("is_dev").eq("user_id", userId).maybeSingle();
      if (!profile?.is_dev) {
        return new Response(
          JSON.stringify({ error: "PowerPoint export requires a Pro plan.", feature: "export_pptx" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Fetch course
    const { data: course, error: courseErr } = await serviceClient
      .from("courses").select("*").eq("id", course_id).eq("user_id", userId).single();
    if (courseErr || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (course.status !== "published") {
      return new Response(JSON.stringify({ error: "Course must be published to export." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch modules
    const { data: modules = [] } = await serviceClient
      .from("course_modules").select("*").eq("course_id", course_id).order("order_index");

    const design = buildDesignConfig(
      theme || "light", palette || "default", !!includeImages,
      template || "default", density || "standard",
      courseType || "CURSO COMPLETO",
      footerBrand !== undefined ? footerBrand : "EduGenAI",
    );

    const courseTitle = sanitizeText(course.title || "Curso EduGenAI");
    const moduleData = modules.map((m: any) => ({ title: m.title || "", content: m.content || "" }));
    const exportLanguage = language || "Português (Brasil)";

    console.log(`[V3] ENGINE_VERSION=${ENGINE_VERSION} | Starting: "${courseTitle}", ${moduleData.length} modules, theme=${design.theme}, density=${density}, language=${exportLanguage}`);

    const { pptx, report } = await runPipeline(courseTitle, moduleData, design, exportLanguage);

    const pptxData = await pptx.write({ outputType: "uint8array" });

    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = (course.title || "curso")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s\-]/g, "").replace(/\s+/g, "-").trim().substring(0, 80);
    const fileName = `${userId}/${safeName}-PPTX-v3-${dateStr}.pptx`;

    const { error: uploadErr } = await serviceClient.storage
      .from("course-exports")
      .upload(fileName, pptxData, {
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        upsert: true,
      });
    if (uploadErr) throw uploadErr;

    const { data: signedUrl, error: signErr } = await serviceClient.storage.from("course-exports").createSignedUrl(fileName, 3600);
    if (signErr) throw signErr;

    await serviceClient.from("usage_events").insert({
      user_id: userId,
      event_type: "COURSE_EXPORTED_PPTX_V3",
      metadata: { course_id, slide_count: report.totalSlides, ai_calls: report.aiCallsTotal, fallbacks: report.fallbacksUsed },
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
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
