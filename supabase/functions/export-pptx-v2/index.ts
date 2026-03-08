import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PptxGenJS from "https://esm.sh/pptxgenjs@3.12.0";

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
}

interface DesignConfig {
  theme: "light" | "dark";
  palette: string[];
  fonts: { title: string; body: string };
  density: { maxItemsPerSlide: number; maxCharsPerItem: number };
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
    bg: "FFFFFF",
    bgAlt: "F8F9FA",
    bgAccent: "F0EDFA",
    text: "2C3E50",
    textSecondary: "7F8C8D",
    accent: "E67E22",
    accentMuted: "F5E6D3",
    borders: "E0E4E8",
    cardBg: "FFFFFF",
    cardBgAlt: "F6F7F9",
    tableHeaderBg: "34495E",
    tableRowOdd: "FFFFFF",
    tableRowEven: "F4F6F8",
    insightBg: "FEF9F3",
    reflectionBg: "EFF6FB",
    coverBg: "2C3E50",
    coverText: "FFFFFF",
    coverSubtext: "BDC3C7",
    divider: "E8EAED",
  },
  dark: {
    bg: "1E2A38",
    bgAlt: "253545",
    bgAccent: "2D3A4A",
    text: "ECF0F1",
    textSecondary: "BDC3C7",
    accent: "E67E22",
    accentMuted: "3D3020",
    borders: "3D4F63",
    cardBg: "253545",
    cardBgAlt: "2D3E50",
    tableHeaderBg: "1A252F",
    tableRowOdd: "253545",
    tableRowEven: "2D3E50",
    insightBg: "3D2E1A",
    reflectionBg: "1A2E3D",
    coverBg: "0F1923",
    coverText: "FFFFFF",
    coverSubtext: "95A5A6",
    divider: "3D4F63",
  },
};

const PALETTES: Record<string, string[]> = {
  default: ["9B59B6", "3498DB", "27AE60", "F39C12", "1ABC9C"],
  ocean: ["2980B9", "3498DB", "1ABC9C", "16A085", "2C3E50"],
  forest: ["27AE60", "2ECC71", "1ABC9C", "16A085", "2C3E50"],
  sunset: ["E74C3C", "E67E22", "F39C12", "D35400", "C0392B"],
  monochrome: ["2C3E50", "34495E", "7F8C8D", "95A5A6", "BDC3C7"],
};

const TYPO = {
  COVER_TITLE: 44,
  MODULE_NUMBER: 72,
  MODULE_TITLE: 36,
  SECTION_TITLE: 30,
  SUBTITLE: 22,
  BODY: 18,
  BODY_LARGE: 20,
  SUPPORT: 14,
  LABEL: 13,
  TABLE_HEADER: 14,
  TABLE_CELL: 13,
  CARD_TITLE: 16,
  CARD_BODY: 14,
  BULLET_TEXT: 17,
  TAKEAWAY_NUM: 32,
  TAKEAWAY_BODY: 15,
  FOOTER: 14,
  TOC_NUMBER: 36,
  TOC_TITLE: 18,
  TOC_DESC: 13,
};

function buildDesignConfig(
  themeKey: string,
  paletteKey: string,
): DesignConfig {
  const theme = (themeKey === "dark" ? "dark" : "light") as "light" | "dark";
  const palette = PALETTES[paletteKey] || PALETTES.default;
  return {
    theme,
    palette,
    fonts: { title: "Montserrat", body: "Open Sans" },
    density: { maxItemsPerSlide: 7, maxCharsPerItem: 180 },
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
    p0: p[0],
    p1: p[1],
    p2: p[2],
    p3: p[3],
    p4: p[4],
    white: "FFFFFF",
  };
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

    // "percepções valiosos" → "percepções valiosas" (fem. plural)
    .replace(/\bpercep[cç][oõ]es\s+(valiosos|baseados|obtidos|gerados|coletados|produzidos|fornecidos|relevantes)\b/gi, 
      (_, adj) => {
        const femMap: Record<string, string> = {
          valiosos: "valiosas", baseados: "baseadas", obtidos: "obtidas",
          gerados: "geradas", coletados: "coletadas", produzidos: "produzidas",
          fornecidos: "fornecidas", relevantes: "relevantes",
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
      current.length < 60 &&
      items[i + 1].length < 60 &&
      current.length + items[i + 1].length + 2 <= maxChars
    ) {
      merged.push(current + ". " + items[i + 1]);
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
  const MIN_CONTINUATION_ITEMS = 3;
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
    subtitle: `MÓDULO ${String(moduleIndex + 1).padStart(2, "0")}`,
    objectives: objectiveItems.slice(0, 3),
    moduleIndex,
  });

  for (const section of sections) {
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

      // PHASE 3: Cap process density based on source structure.
      // Single paragraph source → max 3 (strong compaction)
      // Few original items (2-3) → max 4 (balanced)
      // Many original items (4+) → max 5 (preserve detail but avoid overload)
      const maxProcessItems = rawItems.length <= 1 ? 3 : rawItems.length <= 3 ? 4 : 5;
      const compacted = mergeAdjacentShortest(phase2, maxProcessItems);

      validItems = compacted;
      // Only use process_timeline for ≤3 items where ALL are short enough to fit horizontally
      const allFitTimeline = validItems.length <= 3 && validItems.every((item) => item.length <= 85);
      layout = allFitTimeline ? "process_timeline" : "bullets";
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

      // Step 5: Absorb short unlabeled items into the nearest labeled item
      for (const unlabeled of nonLabeled) {
        const bare = unlabeled.replace(/[.\s]+$/, "").trim();
        if (bare.length < 80 && coreItems.length > 0) {
          const resultIdx = coreItems.findIndex((ci) => /^Resultado:/i.test(ci));
          const targetIdx = resultIdx >= 0 ? resultIdx : coreItems.length - 1;
          const prev = coreItems[targetIdx].replace(/[.\s]+$/, "").trim();
          coreItems[targetIdx] = ensureSentenceEnd(`${prev}. ${unlabeled}`);
        } else {
          coreItems.push(unlabeled);
        }
      }

      // Step 6: Cap at 4 items for visual fit on example_highlight layout
      validItems = coreItems.slice(0, 4);
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
        ? `${section.title} (Parte ${ci + 1})`
        : section.title;

      slides.push({
        layout,
        title: slideTitle,
        sectionLabel: section.sectionLabel,
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

function addSlideBackground(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  color: string,
) {
  slide.background = { fill: color };
}

function addTopAccentBar(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  accentColor: string,
) {
  slide.addShape("rect" as any, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 0.08,
    fill: { color: accentColor },
  });
}

function addSectionLabel(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  label: string,
  accentColor: string,
  fontBody: string,
) {
  slide.addShape("rect" as any, {
    x: MARGIN,
    y: 0.40,
    w: 2.0,
    h: 0.32,
    fill: { color: accentColor },
    rectRadius: 0.06,
  });
  slide.addText(label.toUpperCase(), {
    x: MARGIN,
    y: 0.40,
    w: 2.0,
    h: 0.32,
    fontSize: TYPO.LABEL,
    fontFace: fontBody,
    bold: true,
    color: "FFFFFF",
    align: "center",
    valign: "middle",
    letterSpacing: 1.5,
  });
}

function addSlideTitle(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  title: string,
  colors: ReturnType<typeof getColors>,
  fontTitle: string,
) {
  // Decorative line under title
  slide.addShape("rect" as any, {
    x: MARGIN,
    y: 1.42,
    w: 1.6,
    h: 0.04,
    fill: { color: colors.accent },
    rectRadius: 0.02,
  });
  slide.addText(title, {
    x: MARGIN,
    y: 0.82,
    w: SAFE_W,
    h: 0.60,
    fontSize: TYPO.SECTION_TITLE,
    fontFace: fontTitle,
    bold: true,
    color: colors.text,
    valign: "top",
  });
}

function addFooter(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  colors: ReturnType<typeof getColors>,
  fontBody: string,
) {
  slide.addShape("rect" as any, {
    x: 0,
    y: SLIDE_H - 0.35,
    w: SLIDE_W,
    h: 0.35,
    fill: { color: colors.bgAlt },
  });
  slide.addShape("rect" as any, {
    x: 0,
    y: SLIDE_H - 0.35,
    w: SLIDE_W,
    h: 0.025,
    fill: { color: colors.divider },
  });
  slide.addText("EduGenAI", {
    x: MARGIN,
    y: SLIDE_H - 0.33,
    w: 3,
    h: 0.30,
    fontSize: TYPO.FOOTER - 3,
    fontFace: fontBody,
    color: colors.textSecondary,
    valign: "middle",
  });
}

const LAYOUT_VISUAL_MAX_ITEMS: Partial<Record<SlideLayoutV2, number>> = {
  bullets: 5,
  two_column_bullets: 8,
  definition: 4,
  grid_cards: 6,
  process_timeline: 3,
  example_highlight: 5,
  warning_callout: 5,
  reflection_callout: 4,
  summary_slide: 5,
  numbered_takeaways: 6,
};

const LAYOUT_VISUAL_MAX_CHARS: Partial<Record<SlideLayoutV2, number>> = {
  bullets: 180,
  definition: 140,
  grid_cards: 120,
  process_timeline: 100,
  example_highlight: 160,
  warning_callout: 150,
  reflection_callout: 120,
  summary_slide: 420,
  numbered_takeaways: 120,
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
  const contentY = 1.70;
  const bulletGap = 0.06;
  const contentH = SLIDE_H - contentY - 0.60;
  const rawItemH = (contentH - bulletGap * Math.max(itemCount - 1, 0)) / Math.max(itemCount, 1);
  // Keep enough room for 2-3 text lines at 18pt, but allow extra vertical room
  // when there are very few bullets (prevents unnecessary visual splitting).
  const itemH = Math.max(0.72, Math.min(1.60, rawItemH));
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
      const { itemH } = getBulletLayoutMetrics(items.length);
      return items.every((item) => fitsTextBox(item, TYPO.BULLET_TEXT, SAFE_W - 0.30, itemH - 0.05, 1.2));
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
      const stepW = SAFE_W / Math.max(items.length, 1);
      return items.every((item) => {
        const colonIdx = item.indexOf(":");
        let label: string;
        let desc: string;
        if (colonIdx > 0 && colonIdx < 40) {
          label = item.substring(0, colonIdx).trim();
          desc = item.substring(colonIdx + 1).trim();
        } else if (item.length <= 50) {
          label = item;
          desc = "";
        } else {
          const words = item.split(/\s+/);
          label = words.slice(0, 4).join(" ");
          desc = words.slice(4).join(" ");
        }

        const labelOk = fitsTextBox(label, TYPO.CARD_TITLE, stepW - 0.10, 0.35, 1.1);
        const descOk = !desc || fitsTextBox(desc, TYPO.CARD_BODY, stepW - 0.10, 1.80, 1.2);
        return labelOk && descOk;
      });
    }

    case "example_highlight": {
      const capped = items.slice(0, 3);
      return capped.every((item, i) => {
        const colonIdx = item.indexOf(":");
        const label = colonIdx > 0 && colonIdx < 30
          ? item.substring(0, colonIdx).trim()
          : ["Cenário", "Solução", "Resultado"][i] || `Item ${i + 1}`;
        const desc = colonIdx > 0 ? item.substring(colonIdx + 1).trim() : item;
        return (
          fitsTextBox(label, TYPO.CARD_TITLE, 2.00, 0.35, 1.1) &&
          fitsTextBox(desc, TYPO.BODY, SAFE_W - 0.60, 0.85, 1.2)
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

      // Process slides: compact before splitting to avoid 1-item continuation chains.
      if (
        current.layout === "bullets" &&
        /COMO\s+FUNCIONA/i.test(current.sectionLabel || "") &&
        currentItems.length > 3
      ) {
        const compacted = mergeAdjacentShortest(currentItems, 3);
        if (compacted.length < currentItems.length) {
          report.redistributions++;
          report.warnings.push(`[VISUAL] Compacted process bullets before split: "${baseTitle}"`);
          queue.unshift({ ...current, items: compacted });
          continue;
        }
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

function renderModuleCover(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.bg);

  const accentColor = design.palette[((plan.moduleIndex || 0) % design.palette.length)];
  const secondaryAccent = design.palette[((plan.moduleIndex || 0) + 1) % design.palette.length];

  // Top accent band
  slide.addShape("rect" as any, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 2.80,
    fill: { color: accentColor },
  });

  // Decorative secondary stripe
  slide.addShape("rect" as any, {
    x: 0,
    y: 2.80,
    w: SLIDE_W,
    h: 0.06,
    fill: { color: secondaryAccent },
  });

  // Module number (large, white, on accent band)
  slide.addText(String(plan.moduleIndex !== undefined ? plan.moduleIndex + 1 : "").padStart(2, "0"), {
    x: MARGIN,
    y: 0.40,
    w: 2.0,
    h: 1.00,
    fontSize: TYPO.MODULE_NUMBER,
    fontFace: design.fonts.title,
    bold: true,
    color: "FFFFFF",
    valign: "top",
  });

  // Module subtitle label (on accent band)
  slide.addText(plan.subtitle || "MÓDULO", {
    x: MARGIN,
    y: 1.30,
    w: 4,
    h: 0.40,
    fontSize: TYPO.LABEL,
    fontFace: design.fonts.body,
    bold: true,
    color: "FFFFFF",
    letterSpacing: 3,
  });

  // Module title (on accent band)
  slide.addText(plan.title, {
    x: MARGIN,
    y: 1.70,
    w: SAFE_W * 0.70,
    h: 1.00,
    fontSize: TYPO.MODULE_TITLE,
    fontFace: design.fonts.title,
    bold: true,
    color: "FFFFFF",
    valign: "top",
  });

  if (plan.description) {
    slide.addText(plan.description, {
      x: MARGIN,
      y: 3.10,
      w: SAFE_W * 0.65,
      h: 0.70,
      fontSize: TYPO.BODY,
      fontFace: design.fonts.body,
      color: colors.textSecondary,
      valign: "top",
    });
  }

  // Objectives in a subtle card on the right
  if (plan.objectives && plan.objectives.length > 0) {
    const objStartY = 3.20;
    const objCardW = SAFE_W * 0.38;
    const objCardX = SLIDE_W - MARGIN - objCardW;

    slide.addShape("roundRect" as any, {
      x: objCardX,
      y: objStartY,
      w: objCardW,
      h: 3.40,
      fill: { color: colors.bgAlt },
      rectRadius: 0.10,
      line: { color: colors.borders, width: 0.5 },
    });

    slide.addText("OBJETIVOS", {
      x: objCardX + 0.20,
      y: objStartY + 0.15,
      w: objCardW - 0.40,
      h: 0.30,
      fontSize: TYPO.LABEL,
      fontFace: design.fonts.body,
      bold: true,
      color: accentColor,
      letterSpacing: 2,
    });

    const objTexts = plan.objectives.map(
      (obj, i) =>
        ({
          text: `${i + 1}. ${obj}`,
          options: {
            fontSize: TYPO.SUPPORT,
            fontFace: design.fonts.body,
            color: colors.text,
            bullet: false,
            breakLine: true,
            paraSpaceAfter: 8,
          },
        }) as any,
    );
    slide.addText(objTexts, {
      x: objCardX + 0.20,
      y: objStartY + 0.50,
      w: objCardW - 0.40,
      h: 2.70,
      valign: "top",
    });
  }

  addFooter(slide, colors, design.fonts.body);
}

function renderBullets(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.bg);
  addTopAccentBar(slide, colors.accent);

  if (plan.sectionLabel) {
    addSectionLabel(slide, plan.sectionLabel, colors.accent, design.fonts.body);
  }

  addSlideTitle(slide, plan.title, colors, design.fonts.title);

  const items = plan.items || [];
  const contentY = 1.65;
  const bulletGap = 0.10;
  const contentH = SLIDE_H - contentY - 0.50;
  const rawItemH = (contentH - bulletGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1);
  const itemH = Math.max(0.65, Math.min(1.40, rawItemH));

  for (let i = 0; i < items.length; i++) {
    const accentColor = design.palette[i % design.palette.length];
    const yPos = contentY + i * (itemH + bulletGap);
    const isEven = i % 2 === 0;

    // Subtle alternating card background
    slide.addShape("roundRect" as any, {
      x: MARGIN,
      y: yPos,
      w: SAFE_W,
      h: itemH - 0.04,
      fill: { color: isEven ? colors.cardBgAlt : colors.bg },
      rectRadius: 0.06,
    });

    // Colored left accent bar
    slide.addShape("rect" as any, {
      x: MARGIN,
      y: yPos + 0.06,
      w: 0.07,
      h: itemH - 0.16,
      fill: { color: accentColor },
      rectRadius: 0.02,
    });

    slide.addText(items[i], {
      x: MARGIN + 0.25,
      y: yPos,
      w: SAFE_W - 0.30,
      h: itemH - 0.04,
      fontSize: TYPO.BULLET_TEXT,
      fontFace: design.fonts.body,
      color: colors.text,
      valign: "middle",
    });
  }

  addFooter(slide, colors, design.fonts.body);
}

function renderTwoColumnBullets(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.bg);
  addTopAccentBar(slide, design.palette[1] || colors.accent);

  if (plan.sectionLabel) {
    addSectionLabel(slide, plan.sectionLabel, design.palette[1] || colors.accent, design.fonts.body);
  }

  addSlideTitle(slide, plan.title, colors, design.fonts.title);

  const items = plan.items || [];
  const colGap = 0.40;
  const colW = (SAFE_W - colGap) / 2;
  const contentY = 1.65;
  const mid = Math.ceil(items.length / 2);
  const leftItems = items.slice(0, mid);
  const rightItems = items.slice(mid);

  for (let col = 0; col < 2; col++) {
    const colItems = col === 0 ? leftItems : rightItems;
    const colX = MARGIN + col * (colW + colGap);
    const bulletGap = 0.08;
    const contentH = SLIDE_H - contentY - 0.50;
    const rawItemH = (contentH - bulletGap * Math.max(colItems.length - 1, 0)) / Math.max(colItems.length, 1);
    const itemH = Math.max(0.55, Math.min(1.20, rawItemH));

    for (let i = 0; i < colItems.length; i++) {
      const accentColor = design.palette[(col * mid + i) % design.palette.length];
      const yPos = contentY + i * (itemH + bulletGap);

      // Colored dot
      slide.addShape("ellipse" as any, {
        x: colX,
        y: yPos + itemH / 2 - 0.08,
        w: 0.16,
        h: 0.16,
        fill: { color: accentColor },
      });

      slide.addText(colItems[i], {
        x: colX + 0.28,
        y: yPos,
        w: colW - 0.35,
        h: itemH - 0.04,
        fontSize: TYPO.BULLET_TEXT,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "middle",
      });
    }
  }

  // Vertical divider between columns
  slide.addShape("rect" as any, {
    x: MARGIN + colW + colGap / 2 - 0.01,
    y: contentY,
    w: 0.02,
    h: SLIDE_H - contentY - 0.55,
    fill: { color: colors.divider },
  });

  addFooter(slide, colors, design.fonts.body);
}

function renderDefinition(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.bg);

  if (plan.sectionLabel) {
    addSectionLabel(slide, plan.sectionLabel, colors.accent, design.fonts.body);
  }
  addSlideTitle(slide, plan.title, colors, design.fonts.title);

  const items = plan.items || [];
  if (items.length > 0) {
    slide.addShape("rect" as any, {
      x: MARGIN,
      y: 1.70,
      w: SAFE_W,
      h: 0.90,
      fill: { color: colors.bgAlt },
      rectRadius: 0.08,
    });
    slide.addText(items[0], {
      x: MARGIN + 0.20,
      y: 1.75,
      w: SAFE_W - 0.40,
      h: 0.80,
      fontSize: TYPO.BODY_LARGE,
      fontFace: design.fonts.body,
      color: colors.text,
      valign: "middle",
    });
  }

  const pillars = items.slice(1);
  if (pillars.length > 0) {
    const pillarW = (SAFE_W - 0.30 * (pillars.length - 1)) / pillars.length;
    const startY = 2.90;
    for (let i = 0; i < pillars.length; i++) {
      const x = MARGIN + i * (pillarW + 0.30);
      const accentColor = design.palette[i % design.palette.length];

      slide.addShape("rect" as any, {
        x,
        y: startY,
        w: pillarW,
        h: 0.06,
        fill: { color: accentColor },
      });

      slide.addText(pillars[i], {
        x,
        y: startY + 0.15,
        w: pillarW,
        h: 1.20,
        fontSize: TYPO.CARD_BODY,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "top",
      });
    }
  }

  addFooter(slide, colors, design.fonts.body);
}

function renderGridCards(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.bg);

  if (plan.sectionLabel) {
    addSectionLabel(slide, plan.sectionLabel, colors.accent, design.fonts.body);
  }
  addSlideTitle(slide, plan.title, colors, design.fonts.title);

  const items = plan.items || [];
  const cols = items.length <= 3 ? items.length : items.length <= 4 ? 2 : 3;
  const rows = Math.ceil(items.length / cols);
  const gap = 0.20;
  const cardW = (SAFE_W - gap * (cols - 1)) / cols;
  const contentArea = SLIDE_H - 1.70 - 0.60;
  const cardH = (contentArea - gap * (rows - 1)) / rows;

  for (let i = 0; i < items.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (cardW + gap);
    const y = 1.70 + row * (cardH + gap);
    const accentColor = design.palette[i % design.palette.length];

    slide.addShape("roundRect" as any, {
      x,
      y,
      w: cardW,
      h: cardH,
      fill: { color: colors.cardBgAlt },
      rectRadius: 0.08,
      line: { color: colors.borders, width: 0.5 },
    });

    slide.addShape("rect" as any, {
      x,
      y,
      w: cardW,
      h: 0.06,
      fill: { color: accentColor },
    });

    const colonIdx = items[i].indexOf(":");
    if (colonIdx > 0 && colonIdx < 40) {
      const label = items[i].substring(0, colonIdx).trim();
      const desc = items[i].substring(colonIdx + 1).trim();
      slide.addText(label, {
        x: x + 0.15,
        y: y + 0.15,
        w: cardW - 0.30,
        h: 0.35,
        fontSize: TYPO.CARD_TITLE,
        fontFace: design.fonts.title,
        bold: true,
        color: accentColor,
        valign: "top",
      });
      slide.addText(desc, {
        x: x + 0.15,
        y: y + 0.50,
        w: cardW - 0.30,
        h: cardH - 0.65,
        fontSize: TYPO.CARD_BODY,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "top",
      });
    } else {
      slide.addText(items[i], {
        x: x + 0.15,
        y: y + 0.15,
        w: cardW - 0.30,
        h: cardH - 0.30,
        fontSize: TYPO.CARD_BODY,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "top",
      });
    }
  }

  addFooter(slide, colors, design.fonts.body);
}

function renderProcessTimeline(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.bg);
  addTopAccentBar(slide, design.palette[2] || colors.accent);

  if (plan.sectionLabel) {
    addSectionLabel(slide, plan.sectionLabel, colors.accent, design.fonts.body);
  }
  addSlideTitle(slide, plan.title, colors, design.fonts.title);

  const items = plan.items || [];

  if (items.length <= 3) {
    // Horizontal card layout for ≤3 steps
    const gap = 0.30;
    const cardW = (SAFE_W - gap * (items.length - 1)) / items.length;
    const cardY = 2.00;
    const cardH = SLIDE_H - cardY - 0.55;

    for (let i = 0; i < items.length; i++) {
      const x = MARGIN + i * (cardW + gap);
      const accentColor = design.palette[i % design.palette.length];

      // Card background
      slide.addShape("roundRect" as any, {
        x,
        y: cardY,
        w: cardW,
        h: cardH,
        fill: { color: colors.cardBgAlt },
        rectRadius: 0.08,
        line: { color: colors.borders, width: 0.5 },
      });

      // Colored top bar on card
      slide.addShape("rect" as any, {
        x: x + 0.01,
        y: cardY + 0.01,
        w: cardW - 0.02,
        h: 0.06,
        fill: { color: accentColor },
      });

      // Numbered circle
      slide.addShape("ellipse" as any, {
        x: x + cardW / 2 - 0.28,
        y: cardY + 0.25,
        w: 0.56,
        h: 0.56,
        fill: { color: accentColor },
      });
      slide.addText(String(i + 1), {
        x: x + cardW / 2 - 0.28,
        y: cardY + 0.25,
        w: 0.56,
        h: 0.56,
        fontSize: TYPO.SUBTITLE,
        fontFace: design.fonts.title,
        bold: true,
        color: "FFFFFF",
        align: "center",
        valign: "middle",
      });

      // Connector arrow between cards
      if (i < items.length - 1) {
        const arrowX = x + cardW + gap * 0.1;
        const arrowW = gap * 0.8;
        slide.addShape("rect" as any, {
          x: arrowX,
          y: cardY + 0.50,
          w: arrowW,
          h: 0.04,
          fill: { color: colors.borders },
        });
      }

      const colonIdx = items[i].indexOf(":");
      let label: string;
      let desc: string;
      if (colonIdx > 0 && colonIdx < 40) {
        label = items[i].substring(0, colonIdx).trim();
        desc = items[i].substring(colonIdx + 1).trim();
      } else if (items[i].length <= 50) {
        label = items[i];
        desc = "";
      } else {
        const words = items[i].split(/\s+/);
        label = words.slice(0, 4).join(" ");
        desc = words.slice(4).join(" ");
      }

      slide.addText(label, {
        x: x + 0.12,
        y: cardY + 0.95,
        w: cardW - 0.24,
        h: 0.40,
        fontSize: TYPO.CARD_TITLE,
        fontFace: design.fonts.title,
        bold: true,
        color: accentColor,
        align: "center",
      });
      if (desc) {
        slide.addText(desc, {
          x: x + 0.12,
          y: cardY + 1.35,
          w: cardW - 0.24,
          h: cardH - 1.55,
          fontSize: TYPO.CARD_BODY,
          fontFace: design.fonts.body,
          color: colors.text,
          align: "center",
          valign: "top",
        });
      }
    }
  } else {
    // Vertical numbered steps for >3 items
    const contentY = 1.65;
    const stepGap = 0.08;
    const contentH = SLIDE_H - contentY - 0.50;
    const stepH = Math.min(1.00, (contentH - stepGap * (items.length - 1)) / items.length);
    const circleSize = 0.40;
    const circleX = MARGIN + 0.05;

    for (let i = 0; i < items.length; i++) {
      const y = contentY + i * (stepH + stepGap);
      const accentColor = design.palette[i % design.palette.length];

      // Vertical connector line
      if (i < items.length - 1) {
        slide.addShape("rect" as any, {
          x: circleX + circleSize / 2 - 0.015,
          y: y + circleSize + 0.02,
          w: 0.03,
          h: stepGap + stepH - circleSize - 0.02,
          fill: { color: colors.divider },
        });
      }

      // Number circle
      slide.addShape("ellipse" as any, {
        x: circleX,
        y,
        w: circleSize,
        h: circleSize,
        fill: { color: accentColor },
      });
      slide.addText(String(i + 1), {
        x: circleX,
        y,
        w: circleSize,
        h: circleSize,
        fontSize: TYPO.SUPPORT,
        fontFace: design.fonts.title,
        bold: true,
        color: "FFFFFF",
        align: "center",
        valign: "middle",
      });

      // Content card
      const cardX = MARGIN + 0.65;
      const cardW = SAFE_W - 0.70;
      slide.addShape("roundRect" as any, {
        x: cardX,
        y,
        w: cardW,
        h: stepH - 0.02,
        fill: { color: i % 2 === 0 ? colors.cardBgAlt : colors.bg },
        rectRadius: 0.06,
      });

      slide.addText(items[i], {
        x: cardX + 0.15,
        y,
        w: cardW - 0.30,
        h: stepH - 0.02,
        fontSize: TYPO.BULLET_TEXT,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "middle",
      });
    }
  }

  addFooter(slide, colors, design.fonts.body);
}

function renderComparisonTable(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.bg);

  if (plan.sectionLabel) {
    addSectionLabel(slide, plan.sectionLabel, colors.accent, design.fonts.body);
  }
  addSlideTitle(slide, plan.title, colors, design.fonts.title);

  const headers = plan.tableHeaders || [];
  const rows = plan.tableRows || [];

  if (headers.length === 0) {
    renderBullets(pptx, plan, design);
    return;
  }

  const tableData: any[][] = [];

  tableData.push(
    headers.map((h) => ({
      text: h,
      options: {
        bold: true,
        color: "FFFFFF",
        fill: { color: colors.tableHeaderBg },
        fontSize: TYPO.TABLE_HEADER,
        fontFace: design.fonts.body,
        align: "center",
        valign: "middle",
      },
    })),
  );

  for (let r = 0; r < rows.length; r++) {
    const fillColor = r % 2 === 0 ? colors.tableRowOdd : colors.tableRowEven;
    tableData.push(
      rows[r].map((cell) => ({
        text: cell,
        options: {
          fontSize: TYPO.TABLE_CELL,
          fontFace: design.fonts.body,
          color: colors.text,
          fill: { color: fillColor },
          valign: "middle",
        },
      })),
    );
  }

  const colW = SAFE_W / headers.length;
  slide.addTable(tableData, {
    x: MARGIN,
    y: 1.70,
    w: SAFE_W,
    colW: Array(headers.length).fill(colW),
    border: { type: "solid", pt: 0.5, color: colors.borders },
    rowH: 0.50,
  });

  addFooter(slide, colors, design.fonts.body);
}

function renderExampleHighlight(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.bg);
  addTopAccentBar(slide, design.palette[3] || colors.accent);

  if (plan.sectionLabel) {
    addSectionLabel(slide, plan.sectionLabel, design.palette[3] || colors.accent, design.fonts.body);
  }
  addSlideTitle(slide, plan.title, colors, design.fonts.title);

  const items = plan.items || [];
  const normalizedItems = items
    .map((item) => normalizeResidualText(item))
    .filter(Boolean)
    .map((item) => {
      const repaired = isSentenceComplete(item.replace(/\.\s*$/, "")) ? item : repairSentence(item);
      return ensureSentenceEnd(repaired);
    });

  const cappedItems = normalizedItems.slice(0, 4);
  const sectionColors = [design.palette[0], design.palette[1], design.palette[2], design.palette[3], design.palette[4]];

  if (cappedItems.length <= 2) {
    // Side-by-side large cards for 1-2 items
    const gap = 0.30;
    const cardW = cappedItems.length === 1 ? SAFE_W : (SAFE_W - gap) / 2;
    const cardY = 1.70;
    const cardH = SLIDE_H - cardY - 0.55;

    for (let i = 0; i < cappedItems.length; i++) {
      const x = MARGIN + i * (cardW + gap);
      const color = sectionColors[i % sectionColors.length];

      slide.addShape("roundRect" as any, {
        x,
        y: cardY,
        w: cardW,
        h: cardH,
        fill: { color: colors.cardBgAlt },
        rectRadius: 0.10,
        line: { color: colors.borders, width: 0.5 },
      });

      // Colored header bar
      slide.addShape("rect" as any, {
        x: x + 0.01,
        y: cardY + 0.01,
        w: cardW - 0.02,
        h: 0.50,
        fill: { color },
        rectRadius: 0.10,
      });
      // Fix bottom corners of header
      slide.addShape("rect" as any, {
        x: x + 0.01,
        y: cardY + 0.30,
        w: cardW - 0.02,
        h: 0.21,
        fill: { color },
      });

      const colonIdx = cappedItems[i].indexOf(":");
      const label = colonIdx > 0 && colonIdx < 30
        ? cappedItems[i].substring(0, colonIdx).trim()
        : ["Cenário", "Resultado"][i] || `Item ${i + 1}`;
      const desc = colonIdx > 0 ? cappedItems[i].substring(colonIdx + 1).trim() : cappedItems[i];

      slide.addText(label, {
        x: x + 0.20,
        y: cardY + 0.08,
        w: cardW - 0.40,
        h: 0.35,
        fontSize: TYPO.CARD_TITLE + 2,
        fontFace: design.fonts.title,
        bold: true,
        color: "FFFFFF",
      });

      slide.addText(desc, {
        x: x + 0.20,
        y: cardY + 0.65,
        w: cardW - 0.40,
        h: cardH - 0.85,
        fontSize: TYPO.BODY,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "top",
        lineSpacingMultiple: 1.3,
      });
    }
  } else {
    // 2x2 grid of cards for 3-4 items
    const cols = 2;
    const rows = Math.ceil(cappedItems.length / cols);
    const gap = 0.20;
    const cardW = (SAFE_W - gap) / cols;
    const cardY = 1.65;
    const contentH = SLIDE_H - cardY - 0.50;
    const cardH = (contentH - gap * (rows - 1)) / rows;

    for (let i = 0; i < cappedItems.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = MARGIN + col * (cardW + gap);
      const y = cardY + row * (cardH + gap);
      const color = sectionColors[i % sectionColors.length];

      slide.addShape("roundRect" as any, {
        x,
        y,
        w: cardW,
        h: cardH,
        fill: { color: colors.cardBgAlt },
        rectRadius: 0.08,
        line: { color: colors.borders, width: 0.5 },
      });

      // Colored left bar
      slide.addShape("rect" as any, {
        x,
        y: y + 0.08,
        w: 0.06,
        h: cardH - 0.16,
        fill: { color },
        rectRadius: 0.02,
      });

      const colonIdx = cappedItems[i].indexOf(":");
      const defaultLabels = ["Cenário", "Ação", "Resultado", "Impacto"];
      const label = colonIdx > 0 && colonIdx < 30
        ? cappedItems[i].substring(0, colonIdx).trim()
        : defaultLabels[i] || `Item ${i + 1}`;
      const desc = colonIdx > 0 ? cappedItems[i].substring(colonIdx + 1).trim() : cappedItems[i];

      slide.addText(label, {
        x: x + 0.18,
        y: y + 0.10,
        w: cardW - 0.36,
        h: 0.30,
        fontSize: TYPO.CARD_TITLE,
        fontFace: design.fonts.title,
        bold: true,
        color,
      });

      slide.addText(desc, {
        x: x + 0.18,
        y: y + 0.42,
        w: cardW - 0.36,
        h: cardH - 0.58,
        fontSize: TYPO.CARD_BODY,
        fontFace: design.fonts.body,
        color: colors.text,
        valign: "top",
        lineSpacingMultiple: 1.25,
      });
    }
  }

  addFooter(slide, colors, design.fonts.body);
}

function renderWarningCallout(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.bg);

  if (plan.sectionLabel) {
    addSectionLabel(slide, plan.sectionLabel, "E74C3C", design.fonts.body);
  }
  addSlideTitle(slide, plan.title, colors, design.fonts.title);

  const items = plan.items || [];
  const contentY = 1.70;
  const itemH = Math.min(0.80, (SLIDE_H - contentY - 0.60) / Math.max(items.length, 1));

  for (let i = 0; i < items.length; i++) {
    const y = contentY + i * itemH;

    slide.addText("⚠", {
      x: MARGIN,
      y,
      w: 0.40,
      h: itemH - 0.05,
      fontSize: TYPO.BODY,
      align: "center",
      valign: "middle",
    });

    slide.addText(items[i], {
      x: MARGIN + 0.50,
      y,
      w: SAFE_W - 0.55,
      h: itemH - 0.05,
      fontSize: TYPO.BULLET_TEXT,
      fontFace: design.fonts.body,
      color: colors.text,
      valign: "middle",
    });
  }

  addFooter(slide, colors, design.fonts.body);
}

function renderReflectionCallout(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.reflectionBg);

  if (plan.sectionLabel) {
    addSectionLabel(slide, plan.sectionLabel, design.palette[1], design.fonts.body);
  }
  addSlideTitle(slide, plan.title, colors, design.fonts.title);

  const items = plan.items || [];
  const contentY = 1.90;
  const itemH = Math.min(1.00, (SLIDE_H - contentY - 0.60) / Math.max(items.length, 1));

  for (let i = 0; i < items.length; i++) {
    const y = contentY + i * itemH;
    slide.addText(`💭  ${items[i]}`, {
      x: MARGIN + 0.30,
      y,
      w: SAFE_W - 0.60,
      h: itemH - 0.10,
      fontSize: TYPO.BODY_LARGE,
      fontFace: design.fonts.body,
      italic: true,
      color: colors.text,
      valign: "middle",
    });
  }

  addFooter(slide, colors, design.fonts.body);
}

function renderSummarySlide(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.bg);
  addTopAccentBar(slide, design.palette[0]);

  if (plan.sectionLabel) {
    addSectionLabel(slide, plan.sectionLabel, design.palette[0], design.fonts.body);
  }
  addSlideTitle(slide, plan.title, colors, design.fonts.title);

  const items = (plan.items || []).map((item) => {
    const repaired = isSentenceComplete(item.replace(/\.\s*$/, "")) ? item : repairSentence(item);
    return ensureSentenceEnd(repaired);
  }).filter((item) => item.replace(/[.\s]+$/, "").trim().length >= 10);

  // Render as numbered key points in a card
  const contentY = 1.65;
  const contentH = SLIDE_H - contentY - 0.50;

  slide.addShape("roundRect" as any, {
    x: MARGIN,
    y: contentY,
    w: SAFE_W,
    h: contentH,
    fill: { color: colors.bgAlt },
    rectRadius: 0.10,
  });

  const itemGap = 0.06;
  const itemH = Math.min(0.80, (contentH - 0.30 - itemGap * Math.max(items.length - 1, 0)) / Math.max(items.length, 1));

  for (let i = 0; i < items.length; i++) {
    const y = contentY + 0.15 + i * (itemH + itemGap);
    const accentColor = design.palette[i % design.palette.length];

    // Bullet accent dot
    slide.addShape("ellipse" as any, {
      x: MARGIN + 0.25,
      y: y + itemH / 2 - 0.07,
      w: 0.14,
      h: 0.14,
      fill: { color: accentColor },
    });

    slide.addText(items[i], {
      x: MARGIN + 0.55,
      y,
      w: SAFE_W - 0.80,
      h: itemH - 0.02,
      fontSize: TYPO.BODY,
      fontFace: design.fonts.body,
      color: colors.text,
      valign: "middle",
      lineSpacingMultiple: 1.25,
    });
  }

  addFooter(slide, colors, design.fonts.body);
}

function renderNumberedTakeaways(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.bg);
  addTopAccentBar(slide, design.palette[4] || colors.accent);

  if (plan.sectionLabel) {
    addSectionLabel(slide, plan.sectionLabel, design.palette[4] || colors.accent, design.fonts.body);
  }
  addSlideTitle(slide, plan.title, colors, design.fonts.title);

  const items = plan.items || [];

  // 2-column grid of cards
  const cols = items.length <= 2 ? items.length : 2;
  const rows = Math.ceil(items.length / cols);
  const gap = 0.20;
  const cardW = (SAFE_W - gap * (cols - 1)) / cols;
  const contentY = 1.65;
  const contentH = SLIDE_H - contentY - 0.50;
  const cardH = Math.min(1.40, (contentH - gap * (rows - 1)) / rows);
  const circleSize = 0.44;

  for (let i = 0; i < items.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (cardW + gap);
    const y = contentY + row * (cardH + gap);
    const accentColor = design.palette[i % design.palette.length];

    // Card background
    slide.addShape("roundRect" as any, {
      x,
      y,
      w: cardW,
      h: cardH,
      fill: { color: colors.cardBgAlt },
      rectRadius: 0.08,
      line: { color: colors.borders, width: 0.5 },
    });

    // Numbered circle
    slide.addShape("ellipse" as any, {
      x: x + 0.18,
      y: y + 0.18,
      w: circleSize,
      h: circleSize,
      fill: { color: accentColor },
    });
    slide.addText(String(i + 1), {
      x: x + 0.18,
      y: y + 0.18,
      w: circleSize,
      h: circleSize,
      fontSize: TYPO.TAKEAWAY_BODY + 3,
      fontFace: design.fonts.title,
      bold: true,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    });

    // Takeaway text
    slide.addText(items[i], {
      x: x + 0.18 + circleSize + 0.15,
      y: y + 0.12,
      w: cardW - circleSize - 0.65,
      h: cardH - 0.24,
      fontSize: TYPO.TAKEAWAY_BODY,
      fontFace: design.fonts.body,
      color: colors.text,
      valign: "middle",
      lineSpacingMultiple: 1.2,
    });
  }

  addFooter(slide, colors, design.fonts.body);
}

function renderTOC(
  pptx: PptxGenJS,
  modules: { title: string; description?: string }[],
  design: DesignConfig,
) {
  const colors = getColors(design);
  const MAX_TOC_PER_SLIDE = 6;
  const tocPages: { title: string; description?: string }[][] = [];
  for (let i = 0; i < modules.length; i += MAX_TOC_PER_SLIDE) {
    tocPages.push(modules.slice(i, i + MAX_TOC_PER_SLIDE));
  }

  for (let page = 0; page < tocPages.length; page++) {
    const pageModules = tocPages[page];
    const slide = pptx.addSlide();
    addSlideBackground(slide, colors.bg);
    addTopAccentBar(slide, colors.accent);

    const tocTitle = tocPages.length > 1
      ? `O que você vai aprender (${page + 1}/${tocPages.length})`
      : "O que você vai aprender";

    slide.addText(tocTitle, {
      x: MARGIN,
      y: 0.40,
      w: SAFE_W,
      h: 0.70,
      fontSize: TYPO.MODULE_TITLE,
      fontFace: design.fonts.title,
      bold: true,
      color: colors.text,
    });

    // Decorative line under title
    slide.addShape("rect" as any, {
      x: MARGIN,
      y: 1.10,
      w: 2.0,
      h: 0.04,
      fill: { color: colors.accent },
      rectRadius: 0.02,
    });

    const globalOffset = page * MAX_TOC_PER_SLIDE;

    // 2-column card grid
    const cols = pageModules.length <= 3 ? pageModules.length : pageModules.length <= 4 ? 2 : (pageModules.length <= 6 ? 3 : 3);
    const rows = Math.ceil(pageModules.length / cols);
    const gap = 0.22;
    const cardW = (SAFE_W - gap * (cols - 1)) / cols;
    const startY = 1.35;
    const contentH = SLIDE_H - startY - 0.50;
    const cardH = Math.min(2.40, (contentH - gap * (rows - 1)) / rows);

    for (let i = 0; i < pageModules.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = MARGIN + col * (cardW + gap);
      const y = startY + row * (cardH + gap);
      const accentColor = design.palette[(globalOffset + i) % design.palette.length];

      // Card
      slide.addShape("roundRect" as any, {
        x,
        y,
        w: cardW,
        h: cardH,
        fill: { color: colors.cardBgAlt },
        rectRadius: 0.10,
        line: { color: colors.borders, width: 0.5 },
      });

      // Colored top accent
      slide.addShape("rect" as any, {
        x: x + 0.01,
        y: y + 0.01,
        w: cardW - 0.02,
        h: 0.06,
        fill: { color: accentColor },
      });

      // Module number
      slide.addText(String(globalOffset + i + 1).padStart(2, "0"), {
        x: x + 0.18,
        y: y + 0.20,
        w: 0.60,
        h: 0.50,
        fontSize: TYPO.TOC_NUMBER,
        fontFace: design.fonts.title,
        bold: true,
        color: accentColor,
        valign: "top",
      });

      // Module title
      slide.addText(pageModules[i].title, {
        x: x + 0.18,
        y: y + 0.72,
        w: cardW - 0.36,
        h: 0.55,
        fontSize: TYPO.TOC_TITLE,
        fontFace: design.fonts.title,
        bold: true,
        color: colors.text,
        valign: "top",
      });

      // Description
      if (pageModules[i].description) {
        slide.addText(pageModules[i].description!, {
          x: x + 0.18,
          y: y + 1.30,
          w: cardW - 0.36,
          h: cardH - 1.50,
          fontSize: TYPO.TOC_DESC,
          fontFace: design.fonts.body,
          color: colors.textSecondary,
          valign: "top",
          lineSpacingMultiple: 1.2,
        });
      }
    }

    addFooter(slide, colors, design.fonts.body);
  }
}

function renderCoverSlide(
  pptx: PptxGenJS,
  courseTitle: string,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.bg);

  slide.addShape("rect" as any, {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 0.12,
    fill: { color: colors.accent },
  });

  slide.addText(courseTitle, {
    x: MARGIN,
    y: 2.00,
    w: SAFE_W,
    h: 2.00,
    fontSize: 40,
    fontFace: design.fonts.title,
    bold: true,
    color: colors.text,
    align: "center",
    valign: "middle",
  });

  slide.addText("Gerado por EduGenAI", {
    x: MARGIN,
    y: 4.50,
    w: SAFE_W,
    h: 0.60,
    fontSize: TYPO.SUBTITLE,
    fontFace: design.fonts.body,
    color: colors.textSecondary,
    align: "center",
  });

  addFooter(slide, colors, design.fonts.body);
}

function renderClosingSlide(
  pptx: PptxGenJS,
  courseTitle: string,
  design: DesignConfig,
) {
  const colors = getColors(design);
  const slide = pptx.addSlide();
  addSlideBackground(slide, colors.bg);

  slide.addText("Obrigado!", {
    x: MARGIN,
    y: 2.20,
    w: SAFE_W,
    h: 1.20,
    fontSize: 44,
    fontFace: design.fonts.title,
    bold: true,
    color: colors.text,
    align: "center",
    valign: "middle",
  });

  slide.addText(courseTitle, {
    x: MARGIN,
    y: 3.60,
    w: SAFE_W,
    h: 0.60,
    fontSize: TYPO.SUBTITLE,
    fontFace: design.fonts.body,
    color: colors.textSecondary,
    align: "center",
  });

  addFooter(slide, colors, design.fonts.body);
}

function renderSlide(
  pptx: PptxGenJS,
  plan: SlidePlan,
  design: DesignConfig,
) {
  switch (plan.layout) {
    case "module_cover":
      renderModuleCover(pptx, plan, design);
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

function runPipeline(
  courseTitle: string,
  modules: { title: string; content: string }[],
  design: DesignConfig,
): { pptx: PptxGenJS; report: PipelineReport } {
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

  renderCoverSlide(pptx, courseTitle, design);

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

  console.log(`[V2-STAGE-3.7] Visual fit pass: preventing overflow and overlap...`);
  for (let i = 0; i < allModuleSlidePlans.length; i++) {
    allModuleSlidePlans[i] = enforceVisualRenderingGuards(allModuleSlidePlans[i], design, report);
  }

  console.log(`[V2-STAGE-4] Rendering slides...`);
  for (const modulePlans of allModuleSlidePlans) {
    for (const plan of modulePlans) {
      renderSlide(pptx, plan, design);
      report.totalSlides++;
    }
  }

  renderClosingSlide(pptx, courseTitle, design);
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
    const { course_id, palette, density, theme, includeImages, template } = body;
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

    const design = buildDesignConfig(theme || "light", palette || "default");

    const courseTitle = sanitize(cleanMarkdown(course.title || "Curso EduGenAI"));
    const moduleData = modules.map((m: any) => ({
      title: m.title || "",
      content: m.content || "",
    }));

    console.log(
      `[V2] Starting export: "${courseTitle}", ${moduleData.length} modules, theme=${design.theme}, palette=${palette || "default"}`,
    );

    const { pptx, report } = runPipeline(courseTitle, moduleData, design);

    const pptxData = await pptx.write({ outputType: "uint8array" });
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
        quality_report: {
          version: "v2",
          total_modules: report.totalModules,
          total_slides: report.totalSlides,
          total_blocks_parsed: report.totalBlocks,
          total_sections_segmented: report.totalSections,
          sentence_integrity_checks: report.sentenceIntegrityChecks,
          redistributions: report.redistributions,
          warnings: report.warnings,
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
