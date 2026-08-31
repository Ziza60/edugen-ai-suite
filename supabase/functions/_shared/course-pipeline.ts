// ─────────────────────────────────────────────────────────────────────────────
// Pipeline de geração de curso — código compartilhado.
//
// Este módulo concentra TODO o comportamento: schemas, prompts, normalização,
// validação, reparo e renderização. Ele não tem entrypoint HTTP.
//
// Dois entrypoints o consomem:
//   generate-course/         fase 1 — blueprint, curso e enfileiramento
//   generate-course-module/  fase 2 — um único módulo por invocação
//
// A separação existe porque a Edge Function tem teto de 150 s de wall clock e
// um curso inteiro não cabe nele. Cada invocação passou a ser curta; o número
// de invocações é que cresce com o tamanho do curso.
// ─────────────────────────────────────────────────────────────────────────────

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { cleanModuleContent, repairTruncation } from "./markdown.ts";
import {
  type Grandeza,
  grandezasDoTexto,
  identificarCaso,
  paragrafosDe,
  raizDaPalavra,
  semAcento,
} from "./valores-do-caso.ts";
import { descricaoDoTom } from "./course-tone.ts";
import { paraJpeg } from "./imagem-jpeg.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-client-platform, x-client-platform-version, x-client-runtime, x-client-runtime-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PLAN_LIMITS = {
  free: { maxCourses: 3, maxModules: 5, images: false },
  pro: { maxCourses: 5, maxModules: 10, images: true },
} as const;

// During product testing all Pro gates remain open. Set to false before monetization.
const TESTING_MODE = true;

const GENERATE_COURSE_BUILD = "2026-08-02c-no-cascade-failure";

// Only these text models are confirmed to work with our JSON schema endpoint.
// Any env override that is not in this set falls back to the safe default.
const TEXT_MODEL_ALLOWLIST = new Set(["gemini-2.5-flash", "gemini-2.5-pro"]);

function resolveTextModel(envValue: string | undefined, fallback: string): string {
  if (!envValue) return fallback;
  if (TEXT_MODEL_ALLOWLIST.has(envValue)) return envValue;
  console.warn(`[generate-course] Model "${envValue}" not in allowlist; falling back to ${fallback}`);
  return fallback;
}

const FAST_MODEL = resolveTextModel(Deno.env.get("COURSE_FAST_MODEL"), "gemini-2.5-flash");
const QUALITY_MODEL = resolveTextModel(Deno.env.get("COURSE_QUALITY_MODEL"), "gemini-2.5-pro");

// Image model is separate: validated separately at call site; failures skip image, never block text.
const IMAGE_MODEL = Deno.env.get("COURSE_IMAGE_MODEL") || "gemini-2.5-flash-image";

// Pro repair is opt-in: set COURSE_ENABLE_PRO_REPAIR=true to allow the quality model on lesson repair.
const ENABLE_PRO_REPAIR = Deno.env.get("COURSE_ENABLE_PRO_REPAIR") === "true";

// Keep 120s as the safe default for projects still subject to the lower wall-clock ceiling.
const SOFT_DEADLINE_MS = Math.max(
  90000,
  Number(Deno.env.get("COURSE_SOFT_DEADLINE_MS") || "120000") || 120000,
);

// Um curso de 5 módulos x 3 lições são 15 chamadas de lição de ~25 s cada.
// Com 2x2 = 4 simultâneas isso são quatro ondas, ~100 s, mais o envelope e o
// blueprint — não cabe na janela da função. Com 3x3 = 9 são duas ondas.
const MODULE_CONCURRENCY = Math.max(
  1,
  Math.min(6, Number(Deno.env.get("COURSE_MODULE_CONCURRENCY") || "3") || 3),
);

const LESSON_CONCURRENCY = Math.max(
  1,
  Math.min(6, Number(Deno.env.get("COURSE_LESSON_CONCURRENCY") || "3") || 3),
);

const MAX_SOURCE_TOTAL_CHARS = 1_200_000;
const MAX_STRUCTURE_SOURCE_CHARS = 90_000;
const MAX_MODULE_SOURCE_CHARS = 36_000;

const GENERIC_HEADINGS = new Set([
  "introdução",
  "fundamentos",
  "como funciona",
  "modelos e tipos",
  "modelos / tipos",
  "aplicações reais",
  "conceitos básicos",
  "visão geral",
]);

const ACTIVE_BLOCK_TYPES = new Set<BlockType>([
  "comparison_tabs",
  "flip_cards",
  "accordion",
  "process",
  "worked_example",
  "scenario",
  "activity",
  "decision_map",
  "code",
]);

type Plan = "free" | "pro";
type ModuleRole = "conceito" | "aplicacao" | "consolidacao" | "capstone";
type BloomLevel =
  | "remember"
  | "understand"
  | "apply"
  | "analyse"
  | "evaluate"
  | "create";
type CapstoneType =
  | "sintese"
  | "estudo_de_caso"
  | "projeto"
  | "plano_de_acao"
  | "simulado";
type LessonPattern =
  | "conceptual"
  | "procedural"
  | "decision"
  | "practice"
  | "integration"
  | "assessment";
type BlockType =
  | "explanation"
  | "comparison_tabs"
  | "flip_cards"
  | "accordion"
  | "process"
  | "table"
  | "code"
  | "worked_example"
  | "scenario"
  | "activity"
  | "decision_map"
  | "callout";
type ReasoningEffort = "minimal" | "low" | "medium" | "high";

interface CourseObjective {
  id: string;
  statement: string;
  bloom_level: BloomLevel;
  evidence_required: string;
}

interface CanonicalTerm {
  term: string;
  definition: string;
  first_module: number;
}

interface LessonBlueprint {
  lesson_number: string;
  title: string;
  objective: string;
  pattern: LessonPattern;
  required_block_types: BlockType[];
  source_focus_terms: string[];
  estimated_minutes: number;
}

interface ModuleBlueprint {
  module_number: number;
  title: string;
  summary: string;
  role: ModuleRole;
  outcome_ids: string[];
  builds_on: string[];
  concepts_introduced: string[];
  concepts_reused: string[];
  misconceptions_addressed: string[];
  prior_artifacts: string[];
  produces_artifact: string;
  module_objective: string;
  estimated_minutes: number;
  lessons: LessonBlueprint[];
}

interface RubricCriterion {
  criterion: string;
  weight: number;
  excellent: string;
  adequate: string;
  needs_improvement: string;
}

interface AppliedAssignment {
  title: string;
  description: string;
  deliverable: string;
  requirements: string[];
  rubric: RubricCriterion[];
}

interface AdditionalReading {
  topic: string;
  purpose: string;
  preferred_source_type: string;
}

interface CourseBlueprint {
  course_title: string;
  description: string;
  audience_label: string;
  prerequisites: string[];
  skills_and_knowledge: string[];
  course_objectives: CourseObjective[];
  terminology_ledger: CanonicalTerm[];
  final_competency: string;
  capstone_type: CapstoneType;
  case_thread: string;
  case_facts: string[];
  modules: ModuleBlueprint[];
  applied_assignment: AppliedAssignment;
  additional_readings: AdditionalReading[];
}

interface ItemPair {
  label: string;
  title: string;
  content: string;
}

interface StepItem {
  title: string;
  description: string;
}

interface CardItem {
  front: string;
  back: string;
}

interface TableData {
  headers: string[];
  rows: string[][];
}

interface CodeData {
  language: string;
  code: string;
  explanation: string;
}

interface WorkedExampleData {
  context: string;
  challenge: string;
  solution: string;
  result: string;
}

interface ScenarioOption {
  text: string;
  is_correct: boolean;
  feedback: string;
}

interface ScenarioTurn {
  situation: string;
  options: ScenarioOption[];
}

interface ScenarioData {
  title: string;
  role: string;
  context: string;
  turns: ScenarioTurn[];
  debrief: string[];
}

interface ActivityTemplateRow {
  field: string;
  instruction: string;
}

interface ActivityData {
  objective: string;
  template_rows: ActivityTemplateRow[];
  steps: string[];
  deliverable: string;
  success_criteria: string[];
}

interface LearningBlock {
  id: string;
  type: BlockType;
  heading: string;
  paragraphs: string[];
  bullets: string[];
  items: ItemPair[];
  steps: StepItem[];
  cards: CardItem[];
  table: TableData;
  code: CodeData;
  example: WorkedExampleData;
  scenario: ScenarioData;
  activity: ActivityData;
  source_ids: string[];
}

interface LessonDocument {
  lesson_number: string;
  title: string;
  objective: string;
  blocks: LearningBlock[];
}

interface ModuleDocument {
  module_title: string;
  opening_bridge: string;
  lessons: LessonDocument[];
  checkpoint: string;
  key_takeaways: string[];
  media_brief: {
    purpose: string;
    concept: string;
    alt_text: string;
    generation_prompt: string;
  };
}

interface MultipleChoiceQuestion {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
  outcome_id: string;
  evidence_excerpt: string;
  difficulty: "easy" | "medium" | "hard";
}

interface OpenEndedQuestion {
  question: string;
  sample_answer: string;
  criteria: string[];
  outcome_id: string;
}

interface Flashcard {
  front: string;
  back: string;
}

interface AssessmentDocument {
  multiple_choice: MultipleChoiceQuestion[];
  open_ended: OpenEndedQuestion;
  flashcards: Flashcard[];
}

interface SourceDoc {
  sourceIndex: number;
  filename: string;
  text: string;
}

interface SourceChunk {
  id: string;
  sourceIndex: number;
  filename: string;
  chunkIndex: number;
  text: string;
}

interface AIMeta {
  content: string;
  finishReason: string;
  model: string;
}

interface ModuleGenerationResult {
  moduleData: {
    id: string;
    title: string;
    content: string;
    order_index: number;
  };
  document: ModuleDocument;
  markdown: string;
  assessment: AssessmentDocument | null;
  warnings: string[];
  repairsApplied: number;
}

interface ModuleValidationResult {
  blocking: string[]; // impossível entregar — módulo rejeitado
  repairable: string[]; // o código ou LLM conserta
  warnings: string[]; // entrega e registra
}

const EMPTY_TABLE: TableData = { headers: [], rows: [] };
const EMPTY_CODE: CodeData = { language: "", code: "", explanation: "" };
const EMPTY_EXAMPLE: WorkedExampleData = {
  context: "",
  challenge: "",
  solution: "",
  result: "",
};
const EMPTY_SCENARIO: ScenarioData = {
  title: "",
  role: "",
  context: "",
  turns: [],
  debrief: [],
};
const EMPTY_ACTIVITY: ActivityData = {
  objective: "",
  template_rows: [],
  steps: [],
  deliverable: "",
  success_criteria: [],
};

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown, max = 50): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdown(value: string): string {
  return value
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_>#|~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForMatch(value: string): string {
  return stripMarkdown(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value: string): number {
  const normalized = normalizeWhitespace(stripMarkdown(value));
  return normalized ? normalized.split(" ").length : 0;
}

function sanitizeTitle(value: string): string {
  return normalizeWhitespace(
    (value || "")
      .replace(/^\s*["'“”‘’]+|["'“”‘’]+\s*$/g, "")
      .replace(/^\s*(crie|criar|gere|gerar|quero|fa[çc]a)\b[^A-Za-zÀ-ÿ]*/i, "")
      .replace(
        /^\s*(um|uma|uns|umas)\s+(cursos?|treinamentos?)\s+(de|sobre|do|da|em)\s+/i,
        "",
      )
      .replace(/^\s*[A-Za-zÀ-ÿ]{1,3}\s+de\s+(?=[A-ZÀ-Ý])/, ""),
  );
}

function uniqueStrings(values: string[], max = 50): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = normalizeWhitespace(value);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= max) break;
  }
  return result;
}

function safeModel(value: string, fallback: string): string {
  const clean = asString(value, fallback);
  return /^gemini-[a-z0-9.-]+$/i.test(clean) ? clean : fallback;
}

// Returns the ordered list of models to try for a given call.
// Flash calls: [FAST_MODEL] only.
// Pro calls:   [QUALITY_MODEL, FAST_MODEL] — never more than two; never a 3.x model.
function getModelFallbacks(model: string): string[] {
  if (model === QUALITY_MODEL || model.includes("pro")) {
    return uniqueStrings([QUALITY_MODEL, FAST_MODEL], 2);
  }
  return [FAST_MODEL];
}

// ─── Placeholder detection ─────────────────────────────────────────────────

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /aplicar o conteudo do objetivo/,
  /aplicar o conteudo desta licao/,
  /aplicar os conhecimentos previstos/,
  /produzir uma solucao aplicavel/,
  /conteudo aplicado do modulo/,
  /objetivo da licao/,
  /descricao do modulo/,
  /exemplo de conteudo/,
  /preencher conteudo/,
  /texto a desenvolver/,
  /resposta esperada/,
  /criterio de avaliacao\s*\d+/,
  /aplicar os conhecimentos previstos no modulo/,
  /produzir uma solucao aplicavel e justifica-la/,
  /conteudo aplicado do modulo/,
];

// O Markdown final carrega rótulos fixos do PRÓPRIO renderizador. Um deles é
// "**Objetivo da lição:**", emitido para TODA lição por renderModuleMarkdown.
// Normalizado (minúsculas, sem acentos, sem pontuação) ele vira exatamente
// "objetivo da licao" — que é um dos padrões da lista acima. Rodar a lista
// inteira sobre o Markdown reprovava 100% dos módulos, inclusive os que
// geraram todas as lições sem nenhum erro.
//
// A varredura do Markdown passa a usar só os padrões que descrevem enchimento
// produzido pelo modelo. Os padrões que descrevem RÓTULOS continuam valendo
// campo a campo, via isPlaceholderText — que é onde eles fazem sentido, já que
// ali o texto é o valor e não a etiqueta.
const RENDERER_LABEL_PATTERN =
  /\*\*(?:objetivo da lição|objetivo|contexto|desafio|solução|resultado|papel|entregável|requisitos|rubrica de avaliação|passos|critérios de sucesso|checklist de decisão|resposta-modelo|frente|verso|critérios de correção)\b[^*]*\*\*/gi;

const MARKDOWN_PLACEHOLDER_PATTERNS = PLACEHOLDER_PATTERNS.filter(
  (pattern) => !/objetivo da licao|descricao do modulo/.test(pattern.source),
);

function markdownHasPlaceholder(markdown: string): boolean {
  const withoutChrome = markdown.replace(RENDERER_LABEL_PATTERN, " ");
  const normalized = normalizePlaceholderCheck(withoutChrome);
  return MARKDOWN_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizePlaceholderCheck(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderText(value: string): boolean {
  if (!value || !value.trim()) return true;
  const normalized = normalizePlaceholderCheck(value);
  const words = normalized.split(" ").filter(Boolean);
  // Too short to express an objective
  if (words.length < 4) return true;
  // Purely ordinal ("Módulo 2", "Objetivo 1", "Lição 3")
  if (/^(modulo|objetivo|licao|secao|capitulo|topico)\s+\d+$/.test(normalized)) return true;
  // Matches a known placeholder pattern
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

// ─── Ordinal prefix stripping ───────────────────────────────────────────────

// Removes leading ordinals that will be re-added by the renderer, preventing
// double numbering like "1.1 1.1. O que é…" or "Etapa 1 1. Identifique…".
function stripLeadingOrdinal(value: string): string {
  return value
    // "Etapa 1 — ", "Passo 2: ", "Step 3. "
    .replace(/^\s*(?:etapa|passo|step)\s+\d+\s*[-–—:.)]?\s*/i, "")
    // "1.2.3. " or "1.2. " or "1.1 "
    .replace(/^\s*\d+(?:\.\d+){1,3}\.?\s+/, "")
    // "1. " or "2) "
    .replace(/^\s*\d+[.)]\s+/, "")
    .trim();
}

function parseJsonLoose<T>(raw: string): T | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error: any) {
    if (error?.name === "AbortError")
      throw new Error(`Timeout após ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callAIInner(
  model: string,
  prompt: string,
  options: {
    maxTokens?: number;
    timeoutMs?: number;
    reasoningEffort?: ReasoningEffort;
    jsonSchema?: Record<string, unknown>;
    schemaName?: string;
  } = {},
): Promise<AIMeta> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) throw new Error("GEMINI_API_KEY não configurada.");

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  const maxTokens = options.maxTokens ?? 8000;
  // O ORÇAMENTO É UM PRAZO, NÃO UMA DURAÇÃO POR TENTATIVA
  //
  // Este valor era passado inteiro a cada tentativa. E há duas retentativas
  // internas — 429 e reasoning_effort recusado —, então uma chamada orçada em
  // 19,4 s podia consumir 19,4 + 1,5 + 19,4 = 40,3 s. Foi o que aconteceu no
  // módulo 5 do curso de precificação de 24/08: um reparo com orçamento de
  // 19,4 s levou 36,8 s e levou o worker a 143,4 s, contra os 125 s do módulo e
  // os 150 s da plataforma.
  //
  // Vira prazo absoluto: cada tentativa recebe o que sobrou dele.
  const timeoutMs = options.timeoutMs ?? 90000;
  const prazoFinal = Date.now() + timeoutMs;
  const restanteDoPrazo = () => Math.max(1000, prazoFinal - Date.now());
  const models = getModelFallbacks(model);
  let lastError = "Erro desconhecido";

  // Nos modelos 2.5 os tokens de raciocínio saem do MESMO orçamento de
  // max_tokens da resposta. Sem um teto explícito, o modelo pode gastar quase
  // toda a cota pensando e ser cortado no meio do JSON (finish_reason
  // "length") — foi exatamente isso que travou a geração no build anterior,
  // em que o campo era aceito pela função mas nunca chegava a ser enviado.
  // Se o endpoint rejeitar o campo, repetimos a mesma chamada sem ele.
  let sendReasoningEffort = !!options.reasoningEffort;

  for (const candidate of models) {
    let retryWithoutEffort = false;
    let rateLimitRetried = false;
    do {
      retryWithoutEffort = false;
      const baseBody: Record<string, unknown> = {
        model: candidate,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
      };
      if (sendReasoningEffort && options.reasoningEffort) {
        baseBody.reasoning_effort = options.reasoningEffort;
      }

      // When a JSON schema is provided, use ONLY json_schema — never fall back to
      // json_object which accepts any structure and hides contract violations.
      const responseFormat: Record<string, unknown> | undefined = options.jsonSchema
        ? {
            type: "json_schema",
            json_schema: {
              name: options.schemaName || "structured_response",
              strict: true,
              schema: options.jsonSchema,
            },
          }
        : undefined;

      const body = responseFormat
        ? { ...baseBody, response_format: responseFormat }
        : baseBody;

      try {
        const callStart = Date.now();
        console.log(
          `[generate-course] AI call model=${candidate} schema=${options.schemaName || "text"} maxTokens=${maxTokens} effort=${sendReasoningEffort ? options.reasoningEffort : "off"}`,
        );
        const response = await fetchWithTimeout(
          endpoint,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${geminiKey}`,
            },
            body: JSON.stringify(body),
          },
          restanteDoPrazo(),
        );

        if (!response.ok) {
          const text = await response.text();
          lastError = `${response.status}: ${text}`;
          // "Too many states" is a property of the SCHEMA, not of the model or of
          // the prompt. It is fully deterministic: retrying, switching models or
          // shortening the request cannot change the outcome. Log it distinctly so
          // a schema regression is never mistaken for a transient API failure.
          if (response.status === 400 && /too many states/i.test(text)) {
            console.error(
              `[generate-course] SCHEMA REJEITADO pelo Gemini (schema=${options.schemaName || "text"}): ` +
                "o autômato de decodificação restrita excedeu o limite de serving. " +
                "Causa determinística — retentar não resolve. Regras do schema: toda propriedade " +
                'em "required", "additionalProperties": false em cada objeto, e NENHUM maxItems/minItems.',
            );
          }
          // 429 é limite de taxa, não erro de conteúdo: com a concorrência mais
          // alta ele fica plausível. Espera curta e uma repetição no mesmo
          // candidato — trocar de modelo não ajudaria em nada aqui.
          if (response.status === 429 && !rateLimitRetried) {
            rateLimitRetried = true;
            console.warn(
              `[generate-course] 429 em ${candidate} (${options.schemaName || "text"}); repetindo em 1,5s.`,
            );
            await new Promise((resolve) => setTimeout(resolve, 1500));
            retryWithoutEffort = true;
            continue;
          }
          // Endpoint sem suporte a reasoning_effort: desliga o campo e repete
          // esta mesma chamada uma vez, em vez de queimar o candidato.
          if (
            response.status === 400 &&
            sendReasoningEffort &&
            /reasoning[_\s-]?effort/i.test(text)
          ) {
            console.warn(
              "[generate-course] Endpoint rejeitou reasoning_effort; repetindo sem o campo.",
            );
            sendReasoningEffort = false;
            retryWithoutEffort = true;
            continue;
          }
          console.warn(
            `[generate-course] Gemini failed model=${candidate} schema=${options.schemaName || "text"} status=${response.status}: ${lastError.slice(0, 400)}`,
          );
          // Schema rejection (400) or invalid model (404) → try next model.
          // Any other 4xx/5xx → also try next candidate before giving up.
          break;
        }

        const data = await response.json();
        const choice = data.choices?.[0];
        const elapsed = Date.now() - callStart;
        const finishReason = choice?.finish_reason || "";
        console.log(
          `[generate-course] AI ok model=${candidate} schema=${options.schemaName || "text"} elapsed=${elapsed}ms finish=${finishReason || "?"}`,
        );
        if (finishReason === "length") {
          console.warn(
            `[generate-course] TRUNCADO por max_tokens (schema=${options.schemaName || "text"}, max=${maxTokens}). ` +
              "Nos modelos 2.5 o raciocínio consome o mesmo orçamento da resposta: " +
              "reduza o tamanho pedido ou aumente max_tokens — trocar de modelo não resolve.",
          );
        }
        return {
          content: choice?.message?.content || "",
          finishReason,
          model: candidate,
        };
      } catch (error: any) {
        lastError = error?.message || String(error);
        console.warn(
          `[generate-course] Gemini exception model=${candidate}: ${lastError}`,
        );
        break;
      }
    } while (retryWithoutEffort);
  }

  throw new Error(`Erro na API do Gemini [${options.schemaName || "text"}]: ${lastError}`);
}

async function callAIText(
  model: string,
  prompt: string,
  maxTokens = 8000,
  reasoningEffort: ReasoningEffort = "low",
  timeoutMs = 90000,
): Promise<AIMeta> {
  return await callAIInner(model, prompt, {
    maxTokens,
    reasoningEffort,
    timeoutMs,
  });
}

async function callAIJson<T>(
  model: string,
  prompt: string,
  schema: Record<string, unknown>,
  schemaName: string,
  maxTokens = 10000,
  reasoningEffort: ReasoningEffort = "low",
  timeoutMs = 90000,
): Promise<{ value: T; meta: AIMeta }> {
  const meta = await callAIInner(model, prompt, {
    maxTokens,
    reasoningEffort,
    timeoutMs,
    jsonSchema: schema,
    schemaName,
  });
  const parsed = parseJsonLoose<T>(meta.content);
  if (!parsed) {
    // Distinguir truncagem de JSON malformado importa para a política de
    // retentativa: truncagem se resolve com mais orçamento, não com um modelo
    // melhor. Sem esta marca o chamador só vê "JSON inválido" e escala para o
    // modelo lento, que estoura igual — só que mais devagar.
    const truncated = meta.finishReason === "length";
    const error = new Error(
      `A IA retornou JSON inválido para ${schemaName}${truncated ? " — resposta truncada pelo limite de tokens (finish_reason=length)" : ""}.`,
    ) as Error & { truncated?: boolean; finishReason?: string };
    error.truncated = truncated;
    error.finishReason = meta.finishReason;
    throw error;
  }
  return { value: parsed, meta };
}

// ─── JSON schemas ────────────────────────────────────────────────────────────
//
// CONTRATO OBRIGATÓRIO — leia antes de editar qualquer schema abaixo.
//
// O endpoint usa `response_format.json_schema` com `strict: true`. Isso liga a
// decodificação restrita: o Gemini compila o schema em um autômato finito e o
// executa token a token. Se esse autômato passar do limite de serving, a API
// devolve 400 INVALID_ARGUMENT com "The specified schema produces a constraint
// that has too many states for serving" — de forma determinística, para
// qualquer modelo e qualquer prompt. Retentar nunca resolve.
//
// Duas regras mantêm o autômato pequeno:
//
// 1. TODA propriedade de TODO objeto precisa estar em `required`, e todo objeto
//    precisa de `additionalProperties: false`. Propriedade opcional obriga o
//    decodificador a rastrear QUAL subconjunto de chaves já foi emitido, o que
//    custa 2^n estados por objeto (o objeto de módulo, com 14 propriedades,
//    sozinho custava 2^14 = 16.384). Com tudo obrigatório, o autômato vira uma
//    cadeia linear de n+1 estados. `strict: true` exige isso de qualquer forma.
//
// 2. NENHUM `maxItems` / `minItems`. Um limite de tamanho força o decodificador
//    a DESENROLAR o array: `maxItems: 8` replica o autômato do item 8 vezes, e
//    os fatores se multiplicam quando os arrays são aninhados. Array sem limite
//    é um laço simples, de custo constante.
//
// Os limites de quantidade continuam existindo — no prompt (que instrui o
// modelo) e no código de normalização/validação, que é quem realmente garante o
// contrato: normalizeBlueprint, normalizeLearningBlock, normalizeAssessment,
// validateRawBlueprintCandidate, validateLearningBlock e validateAssessment já
// fazem slice e já rejeitam contagens erradas.
//
// Custo medido do COURSE_BLUEPRINT_SCHEMA (estados do autômato):
//   propriedades opcionais + maxItems ......... 152.992  → 400
//   required/additionalProperties restaurados ..  4.497  → 400
//   required + sem maxItems (esta versão) ......    364  → OK

const stringArraySchema = () => ({
  type: "array",
  items: { type: "string" },
});

const COURSE_BLUEPRINT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "course_title",
    "description",
    "audience_label",
    "prerequisites",
    "skills_and_knowledge",
    "course_objectives",
    "terminology_ledger",
    "final_competency",
    "capstone_type",
    "case_thread",
    "case_facts",
    "modules",
    "applied_assignment",
    "additional_readings",
  ],
  properties: {
    course_title: { type: "string" },
    description: { type: "string" },
    audience_label: { type: "string" },
    prerequisites: stringArraySchema(),
    skills_and_knowledge: stringArraySchema(),
    course_objectives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "statement", "bloom_level", "evidence_required"],
        properties: {
          id: { type: "string" },
          statement: { type: "string" },
          bloom_level: {
            type: "string",
            enum: ["remember", "understand", "apply", "analyse", "evaluate", "create"],
          },
          evidence_required: { type: "string" },
        },
      },
    },
    terminology_ledger: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "definition", "first_module"],
        properties: {
          term: { type: "string" },
          definition: { type: "string" },
          first_module: { type: "integer" },
        },
      },
    },
    final_competency: { type: "string" },
    capstone_type: {
      type: "string",
      enum: ["sintese", "estudo_de_caso", "projeto", "plano_de_acao", "simulado"],
    },
    case_thread: { type: "string" },
    case_facts: stringArraySchema(),
    modules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "module_number",
          "title",
          "summary",
          "role",
          "outcome_ids",
          "builds_on",
          "concepts_introduced",
          "concepts_reused",
          "misconceptions_addressed",
          "prior_artifacts",
          "produces_artifact",
          "module_objective",
          "estimated_minutes",
          "lessons",
        ],
        properties: {
          module_number: { type: "integer" },
          title: { type: "string" },
          summary: { type: "string" },
          role: {
            type: "string",
            enum: ["conceito", "aplicacao", "consolidacao", "capstone"],
          },
          outcome_ids: stringArraySchema(),
          builds_on: stringArraySchema(),
          concepts_introduced: stringArraySchema(),
          concepts_reused: stringArraySchema(),
          misconceptions_addressed: stringArraySchema(),
          prior_artifacts: stringArraySchema(),
          produces_artifact: { type: "string" },
          module_objective: { type: "string" },
          estimated_minutes: { type: "integer" },
          lessons: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "lesson_number",
                "title",
                "objective",
                "pattern",
                "estimated_minutes",
              ],
              properties: {
                lesson_number: { type: "string" },
                title: { type: "string" },
                objective: { type: "string" },
                pattern: {
                  type: "string",
                  enum: [
                    "conceptual",
                    "procedural",
                    "decision",
                    "practice",
                    "integration",
                    "assessment",
                  ],
                },
                estimated_minutes: { type: "integer" },
              },
            },
          },
        },
      },
    },
    applied_assignment: {
      type: "object",
      additionalProperties: false,
      required: ["title", "description", "deliverable", "requirements", "rubric"],
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        deliverable: { type: "string" },
        requirements: stringArraySchema(),
        rubric: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "criterion",
              "weight",
              "excellent",
              "adequate",
              "needs_improvement",
            ],
            properties: {
              criterion: { type: "string" },
              weight: { type: "integer" },
              excellent: { type: "string" },
              adequate: { type: "string" },
              needs_improvement: { type: "string" },
            },
          },
        },
      },
    },
    additional_readings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "purpose", "preferred_source_type"],
        properties: {
          topic: { type: "string" },
          purpose: { type: "string" },
          preferred_source_type: { type: "string" },
        },
      },
    },
  },
};

// LESSON_DOCUMENT_SCHEMA — schema raiz para uma única lição.
// A contagem de blocos (3 a 6) é exigida pelo prompt e verificada por
// validateModuleDocument / validateLearningBlock, nunca por minItems/maxItems.
const LESSON_DOCUMENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["lesson_number", "title", "objective", "blocks"],
  properties: {
    lesson_number: { type: "string" },
    title: { type: "string" },
    objective: { type: "string" },
    blocks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "type",
          "heading",
          "paragraphs",
          "bullets",
          "items",
          "steps",
          "cards",
          "table",
          "code",
          "example",
          "scenario",
          "activity",
          "source_ids",
        ],
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: [
              "explanation",
              "comparison_tabs",
              "flip_cards",
              "accordion",
              "process",
              "table",
              "code",
              "worked_example",
              "scenario",
              "activity",
              "decision_map",
              "callout",
            ],
          },
          heading: { type: "string" },
          paragraphs: stringArraySchema(),
          bullets: stringArraySchema(),
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "title", "content"],
              properties: {
                label: { type: "string" },
                title: { type: "string" },
                content: { type: "string" },
              },
            },
          },
          steps: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "description"],
              properties: {
                title: { type: "string" },
                description: { type: "string" },
              },
            },
          },
          cards: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["front", "back"],
              properties: {
                front: { type: "string" },
                back: { type: "string" },
              },
            },
          },
          table: {
            type: "object",
            additionalProperties: false,
            required: ["headers", "rows"],
            properties: {
              headers: stringArraySchema(),
              rows: {
                type: "array",
                items: { type: "array", items: { type: "string" } },
              },
            },
          },
          code: {
            type: "object",
            additionalProperties: false,
            required: ["language", "code", "explanation"],
            properties: {
              language: { type: "string" },
              code: { type: "string" },
              explanation: { type: "string" },
            },
          },
          example: {
            type: "object",
            additionalProperties: false,
            required: ["context", "challenge", "solution", "result"],
            properties: {
              context: { type: "string" },
              challenge: { type: "string" },
              solution: { type: "string" },
              result: { type: "string" },
            },
          },
          scenario: {
            type: "object",
            additionalProperties: false,
            required: ["title", "role", "context", "turns", "debrief"],
            properties: {
              title: { type: "string" },
              role: { type: "string" },
              context: { type: "string" },
              turns: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["situation", "options"],
                  properties: {
                    situation: { type: "string" },
                    options: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["text", "is_correct", "feedback"],
                        properties: {
                          text: { type: "string" },
                          is_correct: { type: "boolean" },
                          feedback: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
              debrief: stringArraySchema(),
            },
          },
          activity: {
            type: "object",
            additionalProperties: false,
            required: [
              "objective",
              "template_rows",
              "steps",
              "deliverable",
              "success_criteria",
            ],
            properties: {
              objective: { type: "string" },
              template_rows: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["field", "instruction"],
                  properties: {
                    field: { type: "string" },
                    instruction: { type: "string" },
                  },
                },
              },
              steps: stringArraySchema(),
              deliverable: { type: "string" },
              success_criteria: stringArraySchema(),
            },
          },
          source_ids: stringArraySchema(),
        },
      },
    },
  },
};

// MODULE_ENVELOPE_SCHEMA — tudo exceto `lessons`, gerado em chamada separada.
// (O antigo MODULE_DOCUMENT_SCHEMA, que gerava envelope + lições numa única
// chamada, foi removido: virou código morto quando a geração passou a ser
// envelope + lição, e era o maior schema do arquivo — 32.834 estados.)
const MODULE_ENVELOPE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "module_title",
    "opening_bridge",
    "checkpoint",
    "key_takeaways",
    "media_brief",
  ],
  properties: {
    module_title: { type: "string" },
    opening_bridge: { type: "string" },
    checkpoint: { type: "string" },
    key_takeaways: stringArraySchema(),
    media_brief: {
      type: "object",
      additionalProperties: false,
      required: ["purpose", "concept", "alt_text", "generation_prompt"],
      properties: {
        purpose: { type: "string" },
        concept: { type: "string" },
        alt_text: { type: "string" },
        generation_prompt: { type: "string" },
      },
    },
  },
};

const ASSESSMENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["multiple_choice", "open_ended", "flashcards"],
  properties: {
    multiple_choice: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "question",
          "options",
          "correct",
          "explanation",
          "outcome_id",
          "evidence_excerpt",
          "difficulty",
        ],
        properties: {
          question: { type: "string" },
          options: stringArraySchema(),
          correct: { type: "integer" },
          explanation: { type: "string" },
          outcome_id: { type: "string" },
          evidence_excerpt: { type: "string" },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
        },
      },
    },
    open_ended: {
      type: "object",
      additionalProperties: false,
      required: ["question", "sample_answer", "criteria", "outcome_id"],
      properties: {
        question: { type: "string" },
        sample_answer: { type: "string" },
        criteria: stringArraySchema(),
        outcome_id: { type: "string" },
      },
    },
    flashcards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["front", "back"],
        properties: {
          front: { type: "string" },
          back: { type: "string" },
        },
      },
    },
  },
};

const STOPWORDS = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "até",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "entre",
  "é",
  "essa",
  "esse",
  "esta",
  "este",
  "foi",
  "mais",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "ou",
  "para",
  "pela",
  "pelas",
  "pelo",
  "pelos",
  "por",
  "que",
  "se",
  "sem",
  "ser",
  "sua",
  "suas",
  "seu",
  "seus",
  "um",
  "uma",
  "the",
  "and",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "that",
  "to",
  "with",
]);

function tokenize(value: string): string[] {
  return normalizeForMatch(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function chunkSourceDocuments(docs: SourceDoc[]): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  for (const doc of docs) {
    const text = doc.text.slice(0, MAX_SOURCE_TOTAL_CHARS);
    const sections = text
      .replace(/\r\n/g, "\n")
      .split(/\n(?=(?:#{1,6}\s|[A-ZÀ-Ý0-9][^\n]{3,90}\n))/g)
      .flatMap((section) => section.split(/\n{2,}/g))
      .map((section) => section.trim())
      .filter(Boolean);

    let buffer = "";
    let chunkIndex = 0;
    const flush = () => {
      const clean = buffer.trim();
      if (!clean) return;
      chunks.push({
        id: `S${doc.sourceIndex}:C${chunkIndex}`,
        sourceIndex: doc.sourceIndex,
        filename: doc.filename,
        chunkIndex,
        text: clean,
      });
      chunkIndex += 1;
      buffer = "";
    };

    for (const section of sections) {
      if (section.length > 3200) {
        flush();
        for (let start = 0; start < section.length; start += 2600) {
          const part = section.slice(start, start + 3000).trim();
          if (!part) continue;
          chunks.push({
            id: `S${doc.sourceIndex}:C${chunkIndex}`,
            sourceIndex: doc.sourceIndex,
            filename: doc.filename,
            chunkIndex,
            text: part,
          });
          chunkIndex += 1;
        }
        continue;
      }
      if ((buffer + "\n\n" + section).length > 3000) flush();
      buffer += `${buffer ? "\n\n" : ""}${section}`;
    }
    flush();
  }
  return chunks;
}

function scoreChunk(chunk: SourceChunk, queryTokens: Set<string>): number {
  const tokens = tokenize(chunk.text);
  if (!tokens.length || !queryTokens.size) return 0;
  const unique = new Set(tokens);
  let score = 0;
  for (const token of queryTokens) {
    if (unique.has(token)) score += token.length >= 7 ? 3 : 2;
    else if (
      tokens.some(
        (candidate) =>
          candidate.startsWith(token) || token.startsWith(candidate),
      )
    )
      score += 0.5;
  }
  const headingBonus =
    tokenize(chunk.text.slice(0, 240)).filter((token) => queryTokens.has(token))
      .length * 2;
  return score + headingBonus;
}

function selectSourceChunks(
  chunks: SourceChunk[],
  query: string,
  maxChars: number,
  maxChunks = 12,
  ensurePerSource = false,
): SourceChunk[] {
  if (!chunks.length) return [];
  const queryTokens = new Set(tokenize(query));
  const ranked = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, queryTokens) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.chunk.sourceIndex - b.chunk.sourceIndex ||
        a.chunk.chunkIndex - b.chunk.chunkIndex,
    );

  const selected: SourceChunk[] = [];
  const selectedIds = new Set<string>();
  let chars = 0;

  const tryAdd = (chunk: SourceChunk) => {
    if (selectedIds.has(chunk.id) || selected.length >= maxChunks) return;
    if (chars + chunk.text.length > maxChars && selected.length > 0) return;
    selected.push(chunk);
    selectedIds.add(chunk.id);
    chars += chunk.text.length;
  };

  if (ensurePerSource) {
    const sources = uniqueStrings(
      chunks.map((chunk) => String(chunk.sourceIndex)),
      100,
    ).map(Number);
    for (const sourceIndex of sources) {
      const first = chunks.find((chunk) => chunk.sourceIndex === sourceIndex);
      if (first) tryAdd(first);
      const best = ranked.find(
        (item) => item.chunk.sourceIndex === sourceIndex,
      )?.chunk;
      if (best) tryAdd(best);
    }
  }

  for (const item of ranked) tryAdd(item.chunk);
  return selected.sort(
    (a, b) => a.sourceIndex - b.sourceIndex || a.chunkIndex - b.chunkIndex,
  );
}

function renderSourcePacket(chunks: SourceChunk[]): string {
  if (!chunks.length) return "";
  return chunks
    .map(
      (chunk) =>
        `<SOURCE id="${chunk.id}" file="${chunk.filename.replace(/"/g, "'")}">\n${chunk.text}\n</SOURCE>`,
    )
    .join("\n\n");
}

function buildSourceIndex(chunks: SourceChunk[]): Map<string, SourceChunk> {
  return new Map(chunks.map((chunk) => [chunk.id, chunk]));
}

function inferModuleRole(index: number, total: number): ModuleRole {
  if (total === 1) return "capstone";
  if (index === total - 1) return "capstone";
  if (index === 0) return "conceito";
  if (total >= 5 && index === total - 2) return "consolidacao";
  return "aplicacao";
}

// `pattern` already encodes the pedagogical intent, so the block types are derived
// from it instead of being another nested enum array in the schema (that array was
// worth 200 states). This mirrors the fallback the code already used.
const BLOCKS_BY_PATTERN: Record<LessonPattern, BlockType[]> = {
  conceptual: ["explanation", "comparison_tabs", "callout"],
  procedural: ["process", "worked_example", "activity"],
  decision: ["explanation", "scenario", "decision_map"],
  practice: ["worked_example", "activity", "callout"],
  integration: ["explanation", "decision_map", "activity"],
  assessment: ["activity", "decision_map", "callout"],
};

function deriveBlockTypes(
  pattern: LessonPattern,
  role: ModuleRole,
): BlockType[] {
  const base = BLOCKS_BY_PATTERN[pattern] || BLOCKS_BY_PATTERN.conceptual;
  if (role === "capstone" && !base.includes("activity")) {
    return uniqueStrings([...base, "activity"], 4) as BlockType[];
  }
  return base;
}

// Bloom level implies WHERE an objective naturally lands on the track:
// remember/understand early, create/evaluate at the capstone.
const BLOOM_POSITION: Record<BloomLevel, number> = {
  remember: 0.0,
  understand: 0.15,
  apply: 0.45,
  analyse: 0.7,
  evaluate: 0.85,
  create: 1.0,
};

// An orphan objective must not fail the whole course: the mapping is repairable
// deterministically. Assign it to the module that best fits its Bloom level,
// preferring the least loaded of the neighbouring modules.
function ensureObjectiveCoverage(course: CourseBlueprint): string[] {
  const assigned: string[] = [];
  for (const objective of course.course_objectives) {
    if (
      course.modules.some((module) => module.outcome_ids.includes(objective.id))
    )
      continue;
    const position = BLOOM_POSITION[objective.bloom_level] ?? 0.5;
    let index = Math.min(
      course.modules.length - 1,
      Math.round(position * (course.modules.length - 1)),
    );
    const neighbours = [index - 1, index, index + 1].filter(
      (i) => i >= 0 && i < course.modules.length,
    );
    index = neighbours.reduce(
      (best, i) =>
        course.modules[i].outcome_ids.length <
        course.modules[best].outcome_ids.length
          ? i
          : best,
      index,
    );
    course.modules[index].outcome_ids.push(objective.id);
    assigned.push(`${objective.id}→M${index + 1}`);
  }
  return assigned;
}

function normalizeBlockType(value: unknown): BlockType | null {
  const valid: BlockType[] = [
    "explanation",
    "comparison_tabs",
    "flip_cards",
    "accordion",
    "process",
    "table",
    "code",
    "worked_example",
    "scenario",
    "activity",
    "decision_map",
    "callout",
  ];
  return valid.includes(value as BlockType) ? (value as BlockType) : null;
}

// As contagens que antes viviam em minItems/maxItems são verificadas aqui.
// Este é o único lugar que garante o contrato — o schema só garante a forma.
function validateRawBlueprintCandidate(
  raw: any,
  expectedModules: number,
): { fatal: string[]; soft: string[] } {
  const fatal: string[] = [];
  const soft: string[] = [];
  const objectives = Array.isArray(raw?.course_objectives)
    ? raw.course_objectives
    : [];
  const modules = Array.isArray(raw?.modules) ? raw.modules : [];
  const skills = Array.isArray(raw?.skills_and_knowledge)
    ? raw.skills_and_knowledge
    : [];
  const terminology = Array.isArray(raw?.terminology_ledger)
    ? raw.terminology_ledger
    : [];
  const readings = Array.isArray(raw?.additional_readings)
    ? raw.additional_readings
    : [];
  const rubric = Array.isArray(raw?.applied_assignment?.rubric)
    ? raw.applied_assignment.rubric
    : [];

  // FATAL: normalizeBlueprint cannot fix a wrong module count
  if (modules.length !== expectedModules) {
    fatal.push(
      `modules deve conter exatamente ${expectedModules} itens; recebido ${modules.length}.`,
    );
  }

  // SOFT: normalizeBlueprint fills sensible defaults for all of these
  if (objectives.length < 4 || objectives.length > 8) {
    soft.push(
      `course_objectives deve conter de 4 a 8 itens; recebido ${objectives.length}.`,
    );
  }
  if (skills.length < 5 || skills.length > 8) {
    soft.push(
      `skills_and_knowledge deve conter de 5 a 8 itens; recebido ${skills.length}.`,
    );
  }
  if (terminology.length < 5 || terminology.length > 12) {
    soft.push(
      `terminology_ledger deve conter de 5 a 12 itens; recebido ${terminology.length}.`,
    );
  }
  if (readings.length < 3 || readings.length > 6) {
    soft.push(
      `additional_readings deve conter de 3 a 6 itens; recebido ${readings.length}.`,
    );
  }

  modules.forEach((module: any, index: number) => {
    const lessons = Array.isArray(module?.lessons) ? module.lessons : [];
    if (lessons.length < 2 || lessons.length > 4) {
      soft.push(
        `Módulo ${index + 1}: lessons deve conter de 2 a 4 itens; recebido ${lessons.length}.`,
      );
    }
    if (!asString(module?.title))
      soft.push(`Módulo ${index + 1}: title está vazio.`);
    if (!asString(module?.module_objective))
      soft.push(`Módulo ${index + 1}: module_objective está vazio.`);
    if (!Array.isArray(module?.concepts_introduced))
      soft.push(`Módulo ${index + 1}: concepts_introduced está ausente.`);
    if (!Array.isArray(module?.concepts_reused))
      soft.push(`Módulo ${index + 1}: concepts_reused está ausente.`);
    if (!Array.isArray(module?.misconceptions_addressed))
      soft.push(`Módulo ${index + 1}: misconceptions_addressed está ausente.`);
  });

  if (modules.length && modules[modules.length - 1]?.role !== "capstone") {
    soft.push("O último módulo deve ter role=capstone.");
  }
  if (rubric.length < 3 || rubric.length > 6) {
    soft.push(
      `A rubrica final deve conter de 3 a 6 critérios; recebido ${rubric.length}.`,
    );
  }
  const rubricWeight = rubric.reduce(
    (sum: number, criterion: any) => sum + Number(criterion?.weight || 0),
    0,
  );
  if (rubric.length && Math.abs(rubricWeight - 100) > 0.01) {
    soft.push(
      `Os pesos da rubrica devem somar 100; soma recebida ${rubricWeight}.`,
    );
  }

  return { fatal, soft };
}

function normalizeBlueprint(
  raw: any,
  expectedModules: number,
  fallbackTitle: string,
): CourseBlueprint {
  const objectiveIds = new Set<string>();
  let objectives: CourseObjective[] = Array.isArray(raw?.course_objectives)
    ? raw.course_objectives
        .map((objective: any, index: number) => {
          let id = asString(objective?.id, `O${index + 1}`)
            .toUpperCase()
            .replace(/[^A-Z0-9_-]/g, "");
          if (!id || objectiveIds.has(id)) id = `O${index + 1}`;
          objectiveIds.add(id);
          const bloomValues: BloomLevel[] = [
            "remember",
            "understand",
            "apply",
            "analyse",
            "evaluate",
            "create",
          ];
          return {
            id,
            statement: asString(objective?.statement, ""),
            bloom_level: bloomValues.includes(objective?.bloom_level)
              ? objective.bloom_level
              : "apply",
            evidence_required: asString(objective?.evidence_required, ""),
          };
        })
        .slice(0, 8)
    : [];

  if (objectives.length < 4) {
    objectives = [
      {
        id: "O1",
        statement: "Identificar os elementos essenciais do tema.",
        bloom_level: "understand",
        evidence_required: "Explicação correta dos elementos essenciais.",
      },
      {
        id: "O2",
        statement: "Aplicar o procedimento central do curso.",
        bloom_level: "apply",
        evidence_required: "Execução orientada do procedimento.",
      },
      {
        id: "O3",
        statement:
          "Analisar situações práticas e selecionar respostas adequadas.",
        bloom_level: "analyse",
        evidence_required: "Decisão justificada em situação prática.",
      },
      {
        id: "O4",
        statement:
          "Produzir um entregável final coerente com o contexto de atuação.",
        bloom_level: "create",
        evidence_required:
          "Entregável final avaliado por critérios explícitos.",
      },
    ];
  }
  const validObjectiveIds = new Set(
    objectives.map((objective) => objective.id),
  );

  const rawModules = Array.isArray(raw?.modules) ? raw.modules : [];
  const modules: ModuleBlueprint[] = [];
  for (let index = 0; index < expectedModules; index++) {
    const source = rawModules[index] || {};
    const moduleNumber = index + 1;
    const role = (
      ["conceito", "aplicacao", "consolidacao", "capstone"] as ModuleRole[]
    ).includes(source?.role)
      ? (source.role as ModuleRole)
      : inferModuleRole(index, expectedModules);
    const rawLessons = Array.isArray(source?.lessons) ? source.lessons : [];
    const lessonCount = Math.max(
      2,
      Math.min(4, rawLessons.length || (role === "capstone" ? 3 : 2)),
    );
    const lessons: LessonBlueprint[] = [];

    for (let lessonIndex = 0; lessonIndex < lessonCount; lessonIndex++) {
      const lesson = rawLessons[lessonIndex] || {};
      const lessonNumber = `${moduleNumber}.${lessonIndex + 1}`;
      const patternValues: LessonPattern[] = [
        "conceptual",
        "procedural",
        "decision",
        "practice",
        "integration",
        "assessment",
      ];
      const pattern: LessonPattern = patternValues.includes(lesson?.pattern)
        ? lesson.pattern
        : role === "conceito"
          ? "conceptual"
          : role === "capstone"
            ? lessonIndex === lessonCount - 1
              ? "assessment"
              : "integration"
            : lessonIndex === lessonCount - 1
              ? "practice"
              : "procedural";
      const requiredTypes = deriveBlockTypes(pattern, role);
      lessons.push({
        lesson_number: lessonNumber,
        title: asString(
          lesson?.title,
          `${asString(source?.title, `Módulo ${moduleNumber}`)} — Parte ${lessonIndex + 1}`,
        ),
        objective: asString(lesson?.objective, asString(source?.module_objective, "")),
        pattern,
        required_block_types: uniqueStrings(requiredTypes, 5) as BlockType[],
        source_focus_terms: uniqueStrings(
          [
            ...asStringArray(source?.concepts_introduced, 6),
            ...asStringArray(source?.concepts_reused, 6),
          ],
          8,
        ),
        estimated_minutes: clampInt(lesson?.estimated_minutes, 5, 45, 12),
      });
    }

    const mappedOutcomeIds = asStringArray(source?.outcome_ids, 8).filter(
      (id) => validObjectiveIds.has(id),
    );
    modules.push({
      module_number: moduleNumber,
      title: asString(source?.title, `Módulo ${moduleNumber}`),
      summary: asString(source?.summary, ""),
      role:
        index === expectedModules - 1
          ? "capstone"
          : role === "capstone"
            ? inferModuleRole(index, expectedModules)
            : role,
      outcome_ids: mappedOutcomeIds.length
        ? mappedOutcomeIds
        : [objectives[Math.min(index, objectives.length - 1)].id],
      builds_on:
        index === 0
          ? []
          : uniqueStrings(asStringArray(source?.builds_on, 8), 8),
      concepts_introduced: uniqueStrings(
        asStringArray(source?.concepts_introduced, 12),
        12,
      ),
      concepts_reused:
        index === 0
          ? []
          : uniqueStrings(asStringArray(source?.concepts_reused, 12), 12),
      misconceptions_addressed: uniqueStrings(
        asStringArray(source?.misconceptions_addressed, 8),
        8,
      ),
      prior_artifacts:
        index === 0
          ? []
          : uniqueStrings(asStringArray(source?.prior_artifacts, 8), 8),
      produces_artifact: asString(
        source?.produces_artifact,
        role === "conceito"
          ? "Mapa conceitual ou síntese aplicada."
          : "Entregável prático do módulo.",
      ),
      module_objective: asString(source?.module_objective, ""),
      estimated_minutes: clampInt(
        source?.estimated_minutes,
        15,
        180,
        lessons.reduce((sum, lesson) => sum + lesson.estimated_minutes, 0),
      ),
      lessons,
    });
  }

  modules[modules.length - 1].role = "capstone";

  // Piso de aprendizagem ativa: garante ao menos uma lição com padrão
  // `decision`, que é a única que produz cenário interativo (ver
  // BLOCKS_BY_PATTERN). Sem isso o curso fica à mercê da variância do
  // blueprint — em duas gerações do MESMO curso os cenários caíram de 4 para 1,
  // e o cenário é justamente o formato que faz o aluno decidir em contexto, em
  // vez de só ler.
  const temDecisao = modules.some((module) =>
    module.lessons.some((lesson) => lesson.pattern === "decision"),
  );
  if (!temDecisao) {
    // Prefere módulo intermediário: no primeiro o aluno ainda não tem
    // repertório para decidir, e o capstone já integra tudo.
    const candidato =
      modules.find(
        (module) =>
          module.role === "aplicacao" &&
          module.lessons.some((lesson) => lesson.pattern === "procedural"),
      ) || modules[Math.min(1, modules.length - 1)];
    const alvo =
      candidato.lessons.find((l) => l.pattern === "procedural") ||
      candidato.lessons[candidato.lessons.length - 1];
    if (alvo) {
      alvo.pattern = "decision";
      alvo.required_block_types = uniqueStrings(
        deriveBlockTypes("decision", candidato.role),
        5,
      ) as BlockType[];
      console.warn(
        `[generate-course] Nenhuma lição de decisão no blueprint; ${alvo.lesson_number} promovida para garantir um cenário.`,
      );
    }
  }

  // Piso de prática, por MÓDULO.
  //
  // O piso acima cobre só o cenário. A atividade — o template que o aluno
  // preenche — nasce de outros padrões: `procedural`, `practice`, `integration`
  // e `assessment` produzem bloco `activity`; `conceptual` e `decision` não
  // produzem nenhum (ver BLOCKS_BY_PATTERN). Como o blueprint escolhe os
  // padrões livremente, a quantidade de prática do curso era sorteio: em duas
  // gerações do MESMO curso as atividades caíram de 7 para 2, e o segundo saiu
  // MAIOR — 16 lições, das quais 14 só de leitura.
  //
  // O piso é por módulo, e não por curso, porque um curso com 5 atividades
  // concentradas em dois módulos deixa os outros três sem nenhuma prática. Um
  // módulo que só expõe conteúdo não fecha o ciclo de aprendizagem.
  const PADROES_COM_ATIVIDADE: LessonPattern[] = [
    "procedural",
    "practice",
    "integration",
    "assessment",
  ];
  let promovidas = 0;
  for (const module of modules) {
    // O capstone já ganha `activity` de graça em deriveBlockTypes.
    if (module.role === "capstone") continue;
    if (
      module.lessons.some((lesson) =>
        PADROES_COM_ATIVIDADE.includes(lesson.pattern),
      )
    ) continue;

    // Promove a ÚLTIMA lição elegível: a prática vem depois da exposição, não
    // antes. Lições `decision` ficam de fora — são o cenário garantido pelo
    // piso anterior, e convertê-las apenas trocaria um formato ativo por outro.
    const elegiveis = module.lessons.filter((l) => l.pattern === "conceptual");
    const alvo = elegiveis[elegiveis.length - 1];
    if (!alvo) continue;

    alvo.pattern = "practice";
    // Os blocos são montados à mão em vez de sair de deriveBlockTypes("practice"),
    // que devolve worked_example + activity + callout — sem `explanation`. A
    // lição promovida continua sendo a que EXPLICA o conteúdo do módulo; tirar
    // dela o bloco expositivo para acrescentar prática trocaria um buraco por
    // outro. Aqui ela mantém a explicação e ganha o exemplo e a atividade.
    alvo.required_block_types = uniqueStrings(
      ["explanation", "worked_example", "activity"],
      5,
    ) as BlockType[];
    promovidas++;
    console.warn(
      `[generate-course] Módulo ${module.module_number} sem lição prática; ${alvo.lesson_number} promovida para garantir uma atividade.`,
    );
  }
  if (promovidas) {
    console.log(`[generate-course] Piso de prática: ${promovidas} lição(ões) promovida(s).`);
  }

  const capstoneValues: CapstoneType[] = [
    "sintese",
    "estudo_de_caso",
    "projeto",
    "plano_de_acao",
    "simulado",
  ];
  const rawRubric = Array.isArray(raw?.applied_assignment?.rubric)
    ? raw.applied_assignment.rubric
    : [];
  let rubric: RubricCriterion[] = rawRubric
    .map((criterion: any, index: number) => ({
      criterion: asString(criterion?.criterion, `Critério ${index + 1}`),
      weight: clampInt(criterion?.weight, 1, 100, 25),
      excellent: asString(
        criterion?.excellent,
        "Atende integralmente ao critério com precisão e aplicabilidade.",
      ),
      adequate: asString(
        criterion?.adequate,
        "Atende ao essencial, com pequenas lacunas.",
      ),
      needs_improvement: asString(
        criterion?.needs_improvement,
        "Apresenta lacunas que comprometem a aplicação.",
      ),
    }))
    .slice(0, 6);
  if (rubric.length < 3) {
    rubric = [
      {
        criterion: "Correção técnica",
        weight: 35,
        excellent: "Aplica conceitos e procedimentos sem erros relevantes.",
        adequate: "Aplica o essencial com pequenas imprecisões.",
        needs_improvement: "Contém erros que comprometem a solução.",
      },
      {
        criterion: "Aplicação ao contexto",
        weight: 35,
        excellent: "Adapta a solução ao contexto e justifica as escolhas.",
        adequate: "Aplica a solução com justificativa parcial.",
        needs_improvement:
          "Oferece resposta genérica ou pouco contextualizada.",
      },
      {
        criterion: "Clareza e completude",
        weight: 30,
        excellent: "Entrega organizada, completa e verificável.",
        adequate: "Entrega compreensível, com pequenas omissões.",
        needs_improvement: "Entrega incompleta ou difícil de verificar.",
      },
    ];
  }
  const totalWeight =
    rubric.reduce((sum, criterion) => sum + criterion.weight, 0) || 1;
  rubric = rubric.map((criterion, index) => ({
    ...criterion,
    weight:
      index === rubric.length - 1
        ? 100 -
          rubric
            .slice(0, -1)
            .reduce(
              (sum, item) =>
                sum + Math.round((item.weight * 100) / totalWeight),
              0,
            )
        : Math.round((criterion.weight * 100) / totalWeight),
  }));

  const courseTitle =
    sanitizeTitle(asString(raw?.course_title, fallbackTitle)) || fallbackTitle;
  return {
    course_title: courseTitle,
    description: asString(
      raw?.description,
      `Curso aplicado sobre ${courseTitle}, com progressão entre conceitos, prática e avaliação.`,
    ),
    audience_label: asString(
      raw?.audience_label,
      "profissionais que precisam aplicar o tema no trabalho",
    ),
    prerequisites: uniqueStrings(asStringArray(raw?.prerequisites, 10), 10),
    skills_and_knowledge: uniqueStrings(
      asStringArray(raw?.skills_and_knowledge, 10),
      10,
    ),
    course_objectives: objectives,
    terminology_ledger: Array.isArray(raw?.terminology_ledger)
      ? raw.terminology_ledger
          .slice(0, 20)
          .map((item: any, index: number) => ({
            term: asString(item?.term, `Termo ${index + 1}`),
            definition: asString(
              item?.definition,
              "Definição canônica do curso.",
            ),
            first_module: clampInt(item?.first_module, 1, expectedModules, 1),
          }))
          .filter((item: CanonicalTerm) => item.term && item.definition)
      : [],
    final_competency: asString(
      raw?.final_competency,
      "Produzir uma solução aplicável e justificá-la com base no conteúdo do curso.",
    ),
    capstone_type: capstoneValues.includes(raw?.capstone_type)
      ? raw.capstone_type
      : "projeto",
    case_thread: asString(raw?.case_thread),
    case_facts: uniqueStrings(asStringArray(raw?.case_facts, 20), 20),
    modules,
    applied_assignment: {
      title: asString(
        raw?.applied_assignment?.title,
        "Atividade aplicada final",
      ),
      description: asString(
        raw?.applied_assignment?.description,
        "Integre as competências do curso em um entregável aplicável ao seu contexto.",
      ),
      deliverable: asString(
        raw?.applied_assignment?.deliverable,
        "Documento ou artefato definido no briefing.",
      ),
      requirements: uniqueStrings(
        asStringArray(raw?.applied_assignment?.requirements, 12),
        12,
      ),
      rubric,
    },
    additional_readings: Array.isArray(raw?.additional_readings)
      ? raw.additional_readings.slice(0, 6).map((item: any) => ({
          topic: asString(item?.topic, "Aprofundamento do tema"),
          purpose: asString(item?.purpose, "Ampliar a aplicação prática."),
          preferred_source_type: asString(
            item?.preferred_source_type,
            "fonte oficial ou referência setorial reconhecida",
          ),
        }))
      : [],
  };
}

function buildStructurePrompt(params: {
  title: string;
  theme: string;
  targetAudience: string;
  tone: string;
  language: string;
  actualModules: number;
  knowledgeLevel: string;
  outcomeLabel: string;
  capstoneType: CapstoneType;
  wantsCase: boolean;
  useSources: boolean;
  sourcePacket: string;
  numbersRule: string;
}): string {
  const {
    title,
    theme,
    targetAudience,
    tone,
    language,
    actualModules,
    knowledgeLevel,
    outcomeLabel,
    capstoneType,
    wantsCase,
    useSources,
    sourcePacket,
    numbersRule,
  } = params;

  return `Você é um arquiteto instrucional sênior de e-learning B2B e corporativo.

Projete um curso usando BACKWARD DESIGN. Comece pela competência final observável, desdobre objetivos mensuráveis, associe cada objetivo a evidências e organize uma progressão real de módulos e lições.

DADOS DO CURSO
- Pedido/título: ${title}
- Tema: ${theme}
- Público: ${targetAudience}
- Nível atual: ${knowledgeLevel}
- Tom: ${descricaoDoTom(tone)}
- Idioma: ${language}
- Resultado desejado: ${outcomeLabel}
- Tipo obrigatório do encerramento: ${capstoneType}
- Quantidade EXATA de módulos: ${actualModules}

REGRAS DE ARQUITETURA
1. Gere EXATAMENTE ${actualModules} módulos. Cada módulo deve ter de 2 a 4 lições numeradas (1.1, 1.2 etc.).
2. Cada objetivo do curso deve usar verbo observável e indicar a evidência que comprova a aprendizagem.
3. Crie um terminology_ledger com as definições canônicas dos 5 a 12 termos centrais e o primeiro módulo em que cada termo aparece. Essas definições serão a memória compartilhada do curso e não podem variar entre módulos.
4. Cada módulo precisa indicar os objetivos que atende, os conceitos introduzidos, os conceitos reutilizados, os equívocos que corrige, o que recupera dos módulos anteriores e o artefato produzido pelo aprendiz.
5. O último módulo é sempre "capstone" e integra competências de pelo menos 3 módulos quando houver 4 ou mais módulos.
6. Não use títulos genéricos isolados como "Fundamentos", "Introdução" ou "Conceitos básicos". Os títulos devem nomear o conteúdo e a ação.
7. Escolha o "pattern" de cada lição conforme a competência que ela desenvolve. O pattern determina os widgets que serão gerados depois:
   - conceptual: explicação + comparação + alerta;
   - procedural: processo + exemplo resolvido + atividade;
   - decision: explicação + cenário + mapa de decisão;
   - practice: exemplo resolvido + atividade + alerta;
   - integration: explicação + mapa de decisão + atividade;
   - assessment: atividade + mapa de decisão + alerta.
8. O projeto final deve conter briefing, requisitos, entregável e rubrica com pesos somando 100.
9. "additional_readings": em "preferred_source_type", NOMEIE o instrumento quando ele for um marco normativo, técnico ou institucional inequívoco do assunto — "Constituição Federal, arts. 165 a 169", "Lei Complementar nº 101/2000 (LRF)", "Lei nº 4.320/64", "MCASP", "NBC TSP", "Lei nº 13.709/2018 (LGPD)". Nomear uma lei ou uma norma pelo nome oficial não é inventar referência: é dizer o que o próprio módulo já cita. Continua proibido inventar LINK, título de livro, artigo, autor ou número de edição — sem esses, use o tipo de fonte ("Manual de Tribunal de Contas", "Artigo acadêmico").

INTEGRIDADE FACTUAL
${numbersRule}
- Não invente resultados, estatísticas, leis, normas, referências ou estudos de caso apresentados como reais.
- Em curso baseado em fontes, toda competência, título, exemplo planejado e leitura adicional deve ser derivada exclusivamente das fontes fornecidas.

INTEGRIDADE DE DOMÍNIO
- Todo o curso deve permanecer no domínio de "${title}" / "${theme}".
- Em curso de linguagem de programação, use somente essa linguagem e seu ecossistema; não introduza SQL, Bash, HTML ou outra tecnologia salvo quando o pedido exigir.

CASO CONDUTOR
${
  wantsCase
    ? `Crie um único caso condutor realista e estritamente fictício. Preencha case_thread e 8 a 12 case_facts canônicos. Não atribua resultados numéricos ao caso sem base permitida pela regra de números.`
    : `case_thread deve ser "" e case_facts deve ser []. Não invente empresa, personagem ou história para carregar o curso.`
}

SAÍDA
- Retorne somente o objeto JSON previsto no esquema, com TODOS os campos preenchidos.
- description: 1 a 3 frases dizendo para quem é o curso e o que o aluno será capaz
  de fazer ao final. SEM adjetivo de autoelogio sobre o próprio curso — nada de
  "premium", "completo", "excepcional", "inovador", "abrangente" ou "de alta
  qualidade". Quem lê a descrição já sabe que ela descreve o produto; o elogio
  ocupa o lugar da informação e soa a folheto.
- prerequisites: até 6 itens.
- skills_and_knowledge: 5 a 8 etiquetas curtas.
- course_objectives: 4 a 8 objetivos.
- terminology_ledger: 5 a 12 termos.
- additional_readings: 3 a 6 tópicos.
- A soma das lições deve produzir uma trilha coerente, não uma coleção de textos autônomos.

TAMANHO — RESTRIÇÃO RÍGIDA
Este é um PLANO, não o conteúdo do curso. O conteúdo das lições será escrito
depois, em outra etapa. Respostas longas demais são cortadas no meio e perdidas.
- Por módulo, no máximo: 4 outcome_ids, 4 builds_on, 6 concepts_introduced,
  6 concepts_reused, 4 misconceptions_addressed, 4 prior_artifacts.
- applied_assignment: no máximo 8 requirements e de 3 a 6 critérios de rubrica.
- summary e module_objective: no máximo 2 frases cada.
- Itens de lista: frases curtas, não parágrafos.
- Não repita em um campo o que já foi dito em outro.

${useSources ? `<SOURCES>\n${sourcePacket}\n</SOURCES>` : ""}`;
}

function normalizeLearningBlock(raw: any, fallbackId: string): LearningBlock {
  const type = normalizeBlockType(raw?.type) || "explanation";
  const items = Array.isArray(raw?.items)
    ? raw.items
        .slice(0, 8)
        .map((item: any) => ({
          label: asString(item?.label),
          title: asString(item?.title),
          content: asString(item?.content),
        }))
        .filter((item: ItemPair) => item.label || item.title || item.content)
    : [];
  const steps = Array.isArray(raw?.steps)
    ? raw.steps
        .slice(0, 10)
        .map((item: any) => ({
          title: asString(item?.title),
          description: asString(item?.description),
        }))
        .filter((item: StepItem) => item.title || item.description)
    : [];
  const cards = Array.isArray(raw?.cards)
    ? raw.cards
        .slice(0, 10)
        .map((item: any) => ({
          front: asString(item?.front),
          back: asString(item?.back),
        }))
        .filter((item: CardItem) => item.front && item.back)
    : [];
  const headers = asStringArray(raw?.table?.headers, 8);
  const rows = Array.isArray(raw?.table?.rows)
    ? raw.table.rows
        .slice(0, 12)
        .map((row: any) => asStringArray(row, 8))
        .filter((row: string[]) => row.length)
    : [];
  const turns = Array.isArray(raw?.scenario?.turns)
    ? raw.scenario.turns
        .slice(0, 4)
        .map((turn: any) => ({
          situation: asString(turn?.situation),
          options: Array.isArray(turn?.options)
            ? turn.options
                .slice(0, 4)
                .map((option: any) => ({
                  text: asString(option?.text),
                  is_correct: option?.is_correct === true,
                  feedback: asString(option?.feedback),
                }))
                .filter((option: ScenarioOption) => option.text)
            : [],
        }))
        .filter((turn: ScenarioTurn) => turn.situation)
    : [];

  return {
    id:
      asString(raw?.id, fallbackId)
        .replace(/[^A-Za-z0-9_-]/g, "-")
        .slice(0, 80) || fallbackId,
    type,
    heading: asString(raw?.heading),
    paragraphs: asStringArray(raw?.paragraphs, 8),
    bullets: asStringArray(raw?.bullets, 12),
    items,
    steps,
    cards,
    table: { headers, rows },
    code: {
      language: asString(raw?.code?.language),
      code: typeof raw?.code?.code === "string" ? raw.code.code.trim() : "",
      explanation: asString(raw?.code?.explanation),
    },
    example: {
      context: asString(raw?.example?.context),
      challenge: asString(raw?.example?.challenge),
      solution: asString(raw?.example?.solution),
      result: asString(raw?.example?.result),
    },
    scenario: {
      title: asString(raw?.scenario?.title),
      role: asString(raw?.scenario?.role),
      context: asString(raw?.scenario?.context),
      turns,
      debrief: asStringArray(raw?.scenario?.debrief, 8),
    },
    activity: {
      objective: asString(raw?.activity?.objective),
      template_rows: Array.isArray(raw?.activity?.template_rows)
        ? raw.activity.template_rows
            .slice(0, 10)
            .map((row: any) => ({
              field: asString(row?.field),
              instruction: asString(row?.instruction),
            }))
            .filter((row: ActivityTemplateRow) => row.field || row.instruction)
        : [],
      steps: asStringArray(raw?.activity?.steps, 10),
      deliverable: asString(raw?.activity?.deliverable),
      success_criteria: asStringArray(raw?.activity?.success_criteria, 10),
    },
    source_ids: uniqueStrings(asStringArray(raw?.source_ids, 12), 12),
  };
}

function normalizeModuleDocument(
  raw: any,
  blueprint: ModuleBlueprint,
): ModuleDocument {
  const rawLessons = Array.isArray(raw?.lessons) ? raw.lessons : [];
  const lessons: LessonDocument[] = blueprint.lessons.map(
    (lessonBlueprint, lessonIndex) => {
      const lesson =
        rawLessons[lessonIndex] ||
        rawLessons.find(
          (candidate: any) =>
            candidate?.lesson_number === lessonBlueprint.lesson_number,
        ) ||
        {};
      const rawBlocks = Array.isArray(lesson?.blocks) ? lesson.blocks : [];
      const blocks = rawBlocks
        .slice(0, 8)
        .map((block: any, blockIndex: number) =>
          normalizeLearningBlock(
            block,
            `m${blueprint.module_number}-l${lessonIndex + 1}-b${blockIndex + 1}`,
          ),
        );
      // Do NOT create a fake explanation block — leave blocks: [] so the
      // validator can classify the lesson as repairable and trigger re-generation.
      return {
        lesson_number: lessonBlueprint.lesson_number,
        title: asString(lesson?.title, lessonBlueprint.title),
        objective: asString(lesson?.objective, lessonBlueprint.objective),
        blocks,
      };
    },
  );

  return {
    module_title: asString(raw?.module_title, blueprint.title),
    opening_bridge: asString(raw?.opening_bridge),
    lessons,
    checkpoint: asString(raw?.checkpoint),
    key_takeaways: uniqueStrings(asStringArray(raw?.key_takeaways, 6), 6),
    media_brief: {
      purpose: asString(raw?.media_brief?.purpose, ""),
      concept: asString(raw?.media_brief?.concept, blueprint.title),
      alt_text: asString(raw?.media_brief?.alt_text, ""),
      generation_prompt: asString(raw?.media_brief?.generation_prompt, ""),
    },
  };
}

function buildPriorLearningContext(
  blueprint: CourseBlueprint,
  moduleIndex: number,
): string {
  if (moduleIndex <= 0)
    return "Este é o primeiro módulo; não pressuponha artefatos anteriores.";
  return blueprint.modules
    .slice(0, moduleIndex)
    .map((module) => {
      const lessons = module.lessons
        .map((lesson) => `${lesson.lesson_number} ${lesson.title}`)
        .join("; ");
      return `- Módulo ${module.module_number}: ${module.title}. Objetivo: ${module.module_objective}. Conceitos introduzidos: ${module.concepts_introduced.join(", ") || "nenhum"}. Artefato produzido: ${module.produces_artifact}. Lições: ${lessons}.`;
    })
    .join("\n");
}

function buildCaseDossier(blueprint: CourseBlueprint): string {
  if (!blueprint.case_thread || !blueprint.case_facts.length) return "";
  return `FIO CONDUTOR: ${blueprint.case_thread}\nDOSSIÊ CANÔNICO:\n${blueprint.case_facts.map((fact) => `- ${fact}`).join("\n")}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// OS NÚMEROS DO CASO CONDUTOR MUDAVAM DE MÓDULO PARA MÓDULO
//
// Curso de estoque, apostila de 23/08. O módulo 2 faz o aluno calcular, para o
// Armazém da Esquina do Sr. João, um Custo de Pedido de R$185,00 — soma tempo do
// dono, tempo do funcionário, frete e papelaria, e imprime o resultado em
// destaque. Doze páginas depois, o módulo 3 usa o MESMO armazém e o MESMO dono
// para calcular o Lote Econômico, e informa "CP = R$ 50,00/pedido". Sem uma
// palavra de explicação. O aluno acabou de calcular 185.
//
// A CAUSA é estrutural, não um deslize do modelo. Duas coisas se somam:
//
//   1. O dossiê canônico é DELIBERADAMENTE sem números — o prompt da estrutura
//      manda não atribuir resultados numéricos ao caso, para não inventar dado
//      sem lastro. Então não há valor canônico nenhum para o módulo consultar.
//   2. buildPriorLearningContext monta o "que veio antes" a partir do BLUEPRINT:
//      títulos, objetivos, conceitos. Nunca do que foi de fato escrito. Cada
//      módulo é gerado numa invocação separada e não enxerga uma linha do texto
//      dos anteriores.
//
// Somadas, garantem que cada módulo invente os seus próprios números para o
// mesmo caso. Isto aqui fecha a lacuna 2: lê o que os módulos anteriores já
// imprimiram e devolve os valores encontrados para o prompt do módulo seguinte.
//
// POR QUE PROCURAR PELOS TERMOS DO GLOSSÁRIO
//
// Extrair "grandeza = valor" de prosa livre é ruído garantido, e um valor
// extraído errado vira instrução errada — pior que não ter. Mas o curso já traz
// uma lista canônica de termos (terminology_ledger). Procurar um valor perto de
// um termo conhecido é preciso: ou acha "Custo de Pedido ... R$185,00", ou não
// acha nada e o módulo segue como seguia antes.
// ═══════════════════════════════════════════════════════════════════════════

export interface ValorCanonico {
  /** "Detox Verde — custo variável": o caso e a grandeza, como o curso escreveu. */
  termo: string;
  valor: string;
  modulo: number;
}

/**
 * Os valores que o caso condutor já teve fixados.
 *
 * A PRIMEIRA versão desta função lia pelo glossário: pegava cada termo do
 * `terminology_ledger` e procurava o primeiro valor depois dele. Passou nos
 * nove testes que escrevi e falhou no curso de precificação de 24/08 — achou
 * "Custo Variável: R$ 0,80" numa tabela de outro produto e injetou esse número
 * nos módulos seguintes como se fosse fato estabelecido. Era exatamente o risco
 * que o comentário desta função descrevia: um valor extraído errado vira
 * instrução errada, e o modelo obedece.
 *
 * A leitura agora é ancorada no caso condutor — quem é o caso, que grandeza o
 * texto nomeou, qual valor ele ligou a ela. Está em `valores-do-caso.ts`, junto
 * com o porquê de cada escolha, e é a MESMA leitura que o portão de qualidade
 * usa para reprovar incoerência. Sem isso, um lado aprovaria o que o outro
 * produziu.
 *
 * Sem caso condutor identificável, devolve lista vazia e nada é injetado. Não
 * ter valor nenhum é um desfecho correto; ter o valor errado, não.
 */
/** Quantas vezes o rótulo precisa recorrer no curso para valer sem repetição
 *  do valor. Medido: fragmentos aparecem 1 a 2 vezes, termos reais 5 ou mais. */
const RECORRENCIA_MINIMA = 5;

export function valoresDoCasoCondutor(
  fontes: Array<{ texto: string; modulo: number }>,
): ValorCanonico[] {
  const blocos = fontes.map((f) => ({ paragrafos: paragrafosDe(f.texto) }));
  if (!blocos.length) return [];
  // Duas fontes quando há duas: um nome que aparece em duas lições ou dois
  // módulos é o caso do curso. Com uma fonte só — o módulo 2 herdando do
  // módulo 1 — exigir duas não deixaria nada passar.
  const caso = identificarCaso(blocos, Math.min(2, blocos.length));
  if (!caso.nomes.length) return [];

  // ── O filtro que o portão não precisa ter ────────────────────────────────
  //
  // O portão tolera leitura ruim: um rótulo falso não se agrupa com nada e
  // nunca vira alarme. A ponte NÃO tolera — tudo que ela lê é injetado no
  // prompt como fato estabelecido. Rodando a leitura ancorada contra os cursos
  // reais, o módulo 1 de precificação entregaria treze "valores", entre eles:
  //
  //     Detox Verde — Eles precisam: 30%
  //     Detox Verde — Além disso: R$ 0,20
  //     Armazém da Esquina — Representam uma pequena: 10%
  //
  // São fragmentos de oração, não grandezas. Injetá-los é o mesmo defeito da
  // versão por glossário, com outra roupa.
  //
  // O que separa uma grandeza de um fragmento, sem precisar de dicionário: a
  // grandeza SE REPETE. O curso fixa o número e o reafirma no resultado —
  // "o custo variável total por garrafa será R$ 7,20" e, dois parágrafos
  // adiante, "o custo variável por garrafa é de R$ 7,20". "Além disso" aparece
  // uma vez e não volta.
  //
  // Duas menções do MESMO valor, portanto. Isso derruba os treze a dois, e os
  // dois são o custo variável e os custos fixos — exatamente os números que o
  // módulo 2 contradisse.
  // A HERDADA CORROBORA; A DIRETA É QUE PODE SER FONTE.
  //
  // Antes a herdada era descartada antes de contar, e os dois filtros se
  // destruíam mutuamente. O curso enuncia o número na "Solução" e o repete no
  // "Resultado" — e o parágrafo do "Resultado" quase nunca repete o nome da
  // empresa. A segunda menção saía como herdada, e a repetição que o filtro
  // seguinte exige nunca acontecia. MEDIDO nos cinco cursos, sobre os dois
  // primeiros módulos de cada um:
  //
  //     lidas   após tirar herdadas   após exigir repetição
  //      35            6                      0
  //      52           17                      0
  //      36           12                      0
  //      45           10                      1
  //
  // Um valor em cinco cursos: a ponte existia e não carregava nada.
  //
  // Contando as duas e exigindo que ao menos UMA seja direta, o número sobe
  // para oito — e entre eles os dois do curso de precificação que depois se
  // contradizem, R$19,90 e R$5,00. A cautela que importa fica de pé: nenhum
  // valor entra sem ter sido escrito ao menos uma vez num parágrafo que nomeia
  // o caso, então continua valendo que valor de outra coisa não é injetado.
  // REPETIR NÃO É COPIAR.
  //
  // A contagem era de menções, e uma frase de enunciado copiada literalmente em
  // dois lugares valia por duas. Foi assim que "João planeja = R$ 5.000,00" e
  // "exigirá um aumento = R$ 100,00" — fragmentos de oração, não grandezas —
  // entraram: a mesma frase aparece na atividade do módulo 2 e é repetida na
  // seção seguinte, palavra por palavra.
  //
  // Corroborar é o curso dizer o número OUTRA VEZ, com outras palavras: "o
  // custo variável total por garrafa será R$ 7,20" e, adiante, "o custo
  // variável por garrafa é de R$ 7,20". Então o que se conta são orações
  // DISTINTAS, e não menções.
  const contagem = new Map<
    string,
    { g: Grandeza; modulo: number; oracoes: Set<string>; temDireta: boolean }
  >();
  for (const { texto, modulo } of fontes) {
    for (const g of grandezasDoTexto(texto, caso)) {
      const chave = `${g.caso}\u0000${g.chave}\u0000${g.numero ?? g.valor}`;
      const ja = contagem.get(chave);
      // Fica com a fonte MAIS ANTIGA: foi o que o aluno viu primeiro, e é dela
      // que os módulos seguintes não podem divergir em silêncio. Uma menção
      // herdada não vira fonte nem quando chega primeiro.
      if (ja) {
        ja.oracoes.add(g.trecho);
        if (!g.herdado && !ja.temDireta) {
          ja.temDireta = true;
          ja.g = g;
          ja.modulo = modulo;
        }
      } else {
        contagem.set(chave, {
          g, modulo, oracoes: new Set([g.trecho]), temDireta: !g.herdado,
        });
      }
    }
  }

  // O SEGUNDO CAMINHO: O RÓTULO É UM TERMO DO CURSO.
  //
  // Exigir que o VALOR apareça duas vezes é evidência forte e tem um custo alto:
  // há cursos que enunciam cada número uma vez só. O de 'Doces da Vovó', gerado
  // em 31/08, tem 18 grandezas lidas, 12 diretas, e NENHUMA repetida — a ponte
  // saiu muda mesmo com os módulos já em ordem.
  //
  // O que separa uma grandeza de um fragmento de oração, quando o número não se
  // repete, é o RÓTULO recorrer. Medido nos quatro cursos com caso numérico,
  // contando as duas palavras da chave juntas no texto inteiro:
  //
  //     custos variáveis .......... 121      ele faz ................. 1
  //     custo total de manutenção .. 88      João poderia ............ 1
  //     preço de venda ............. 60      teve um impacto ......... 1
  //     Cobertura de Estoque ....... 23      Após análises ........... 1
  //     capital empatado ........... 33      totalizando cerca ....... 1
  //
  // O lixo aparece uma vez; o termo do curso aparece dezenas. O piso fica em 5,
  // acima do aglomerado de fragmentos (1 a 2) e com folga até o primeiro termo
  // legítimo. Ele erra para CIMA de propósito: perder um valor devolve o
  // silêncio de hoje, e injetar um fragmento no prompt é o defeito que este
  // arquivo inteiro existe para evitar.
  const raizesDoCurso = fontes
    .flatMap((f) => semAcento(f.texto).split(/[^a-z0-9]+/))
    .map(raizDaPalavra);

  function recorrencia(chave: string): number {
    const [a, b] = chave.split(" ");
    if (!a || !b) return 0;
    let n = 0;
    // Janela de três: "custo de pedido" e "custo unitário de pedido" contam
    // como o mesmo termo, que é como o texto de fato varia.
    for (let i = 0; i + 3 < raizesDoCurso.length; i++) {
      if (
        raizesDoCurso[i] === a &&
        (raizesDoCurso[i + 1] === b || raizesDoCurso[i + 2] === b ||
          raizesDoCurso[i + 3] === b)
      ) n++;
    }
    return n;
  }

  const porGrandeza = new Map<string, ValorCanonico>();
  for (const { g, modulo, oracoes, temDireta } of contagem.values()) {
    if (!temDireta) continue;
    if (oracoes.size < 2 && recorrencia(g.chave) < RECORRENCIA_MINIMA) continue;
    const chave = `${g.caso}\u0000${g.chave}`;
    if (porGrandeza.has(chave)) continue;
    porGrandeza.set(chave, {
      termo: `${g.caso} — ${g.rotulo}`,
      valor: g.valor,
      modulo,
    });
  }
  return [...porGrandeza.values()];
}

/**
 * O bloco do prompt com os valores já impressos.
 *
 * O texto pede consistência, não obediência cega: se o módulo precisar de um
 * valor diferente, ele pode — desde que diga por quê. Um curso pode legitimamente
 * revisar um número; o que não pode é trocá-lo em silêncio.
 */
function buildLedgerDeValores(valores: ValorCanonico[]): string {
  if (!valores.length) return "";
  const linhas = valores
    .map((v) => `- ${v.termo}: ${v.valor} (publicado no módulo ${v.modulo})`)
    .join("\n");
  return `VALORES JÁ PUBLICADOS PARA O CASO CONDUTOR
${linhas}

Estes números já estão impressos na apostila do aluno. Se este módulo usar uma
dessas grandezas para o mesmo caso, use O MESMO VALOR. Se precisar de outro,
diga no texto por que ele mudou — o aluno acabou de calcular o anterior.`;
}

function buildModulePrompt(params: {
  course: CourseBlueprint;
  module: ModuleBlueprint;
  moduleIndex: number;
  language: string;
  tone: string;
  knowledgeLevel: string;
  depthWords: string;
  lessonWords: string;
  useSources: boolean;
  sourcePacket: string;
  allowedSourceIds: string[];
  numbersRule: string;
  part: "envelope" | "lesson";
  lessonPlan?: LessonBlueprint;
  /** Valores que os módulos anteriores já imprimiram. Ver buildLedgerDeValores. */
  valoresPublicados?: ValorCanonico[];
}): string {
  const {
    course,
    module,
    moduleIndex,
    language,
    tone,
    knowledgeLevel,
    depthWords,
    lessonWords,
    useSources,
    sourcePacket,
    allowedSourceIds,
    numbersRule,
    part,
    lessonPlan,
    valoresPublicados,
  } = params;
  const priorContext = buildPriorLearningContext(course, moduleIndex);
  const caseDossier = buildCaseDossier(course);
  const ledgerDeValores = buildLedgerDeValores(valoresPublicados ?? []);
  const plannedLessons = module.lessons
    .map(
      (lesson) =>
        `- ${lesson.lesson_number} ${lesson.title}\n  Objetivo: ${lesson.objective}\n  Padrão: ${lesson.pattern}\n  Blocos obrigatórios: ${lesson.required_block_types.join(", ")}\n  Termos-foco: ${lesson.source_focus_terms.join(", ") || "—"}`,
    )
    .join("\n");
  const objectiveMap = course.course_objectives
    .filter((objective) => module.outcome_ids.includes(objective.id))
    .map(
      (objective) =>
        `- ${objective.id}: ${objective.statement}. Evidência: ${objective.evidence_required}.`,
    )
    .join("\n");

  return `Você é um designer instrucional sênior e redator técnico de e-learning corporativo premium.

Produza o DOCUMENTO ESTRUTURADO do módulo abaixo. O JSON será validado e convertido deterministicamente em Markdown, widgets interativos, PDF e PPTX. Não escreva Markdown na resposta.

CURSO
- Título: ${course.course_title}
- Público: ${course.audience_label}
- Nível: ${knowledgeLevel}
- Idioma: ${language}
- Tom: ${descricaoDoTom(tone)}
- Competência final: ${course.final_competency}

MÓDULO ${module.module_number} DE ${course.modules.length}
- Título: ${module.title}
- Papel pedagógico interno: ${module.role}
- Objetivo do módulo: ${module.module_objective}
- Síntese: ${module.summary}
- Objetivos atendidos:\n${objectiveMap || "- Use o objetivo atribuído no plano."}
- Reutiliza: ${module.builds_on.join("; ") || "—"}
- Artefatos anteriores: ${module.prior_artifacts.join("; ") || "—"}
- Artefato produzido: ${module.produces_artifact}

MEMÓRIA CANÔNICA DO CURSO
${course.terminology_ledger.map((item) => `- ${item.term}: ${item.definition} (introdução prevista no módulo ${item.first_module})`).join("\n")}

PLANO DE PROGRESSÃO DESTE MÓDULO
- Conceitos a introduzir: ${module.concepts_introduced.join(", ") || "nenhum termo novo"}
- Conceitos a reutilizar sem redefinir: ${module.concepts_reused.join(", ") || "nenhum"}
- Equívocos a corrigir: ${module.misconceptions_addressed.join(" | ") || "nenhum específico"}

APRENDIZAGEM ANTERIOR CANÔNICA
${priorContext}

PLANO DAS LIÇÕES
${plannedLessons}

REGRAS DE PROGRESSÃO
1. A opening_bridge deve conectar explicitamente este módulo à aprendizagem anterior. No primeiro módulo, situe o problema e a competência final.
2. Não redefina conceitos já previstos nos módulos anteriores; use-os para avançar a tarefa.
3. Cada lição deve cumprir exatamente seu objetivo e conter os required_block_types planejados.
4. Mantenha a numeração e os títulos das lições do blueprint.

DESIGN DE BLOCOS
- explanation: explicação densa e específica, em parágrafos curtos. Mínimo 70 palavras somando parágrafos e bullets, com pelo menos 2 parágrafos substanciais ou 3 bullets.
- comparison_tabs: 3 a 5 itens com contrastes claros; use items. Cada item precisa de pelo menos 25 palavras em content.
- flip_cards: 4 a 8 pares frente/verso; use cards. Verso com pelo menos 12 palavras.
- accordion: 2 a 5 exceções, erros ou zonas cinzentas; use items. Cada item com pelo menos 25 palavras em content.
- process: 3 a 7 etapas acionáveis; use steps. Cada descrição com pelo menos 18 palavras.
- table ou decision_map: pelo menos 2 cabeçalhos e 3 linhas reais; use table.
- code: somente quando necessário ao domínio; use code.language, code.code e code.explanation (explicação com pelo menos 35 palavras).
- worked_example: preencha Contexto (20+ palavras), Desafio (12+), Solução (30+) e Resultado (12+). O resultado deve ser qualitativo, salvo número permitido.
- scenario: use apenas quando planejado. Contexto com pelo menos 45 palavras. Deve ter EXATAMENTE 4 turnos; cada turno deve ter EXATAMENTE 4 opções, apenas 1 correta e feedback específico de pelo menos 10 palavras para cada opção. As alternativas erradas devem ser plausíveis, não absurdas. Debriefing com pelo menos 3 itens.
- activity: inclua objetivo, template com pelo menos 3 linhas, 3 a 7 passos, entregável e pelo menos 3 critérios de sucesso. O aluno faz o curso SOZINHO e no ritmo dele: nenhum passo pode depender de colega, turma, instrutor, grupo, fórum, aula ao vivo ou prazo combinado. Nada de "compartilhe com colegas para discussão", "debata em grupo" ou "apresente à turma" — troque por autoverificação contra os critérios de sucesso, comparação com a resposta-modelo, ou aplicação no próprio trabalho do aluno.
- callout: use para erro crítico, limite, norma ou orientação de alto valor. Mínimo 35 palavras.
- Não force dois widgets por lição. Cumpra o plano e use interatividade apenas quando ela mede ou pratica a competência.

QUALIDADE
${
  part === "lesson"
    ? `- EXTENSÃO DESTA LIÇÃO: escreva de ${lessonWords} palavras, somando todos os blocos.
  Esta é a extensão DA LIÇÃO que você está escrevendo agora, não a do módulo.
  As outras lições deste módulo são geradas separadamente — não escreva por elas
  nem tente cobrir o módulo inteiro aqui.
  Abaixo do mínimo a lição fica superficial; acima do máximo, cansa e dilui o objetivo.`
    : `- O módulo completo terá cerca de ${depthWords} palavras, distribuídas entre as lições,
  que são geradas em outra etapa. Aqui você escreve apenas o envelope: ponte, checkpoint,
  pontos-chave e briefing de imagem. Seja conciso.`
}
- Use linguagem profissional, direta, acessível e tecnicamente precisa.
- Títulos de blocos devem ser específicos do tema; evite rótulos genéricos.
- Explique o porquê e o como; não produza listas de nomes sem desenvolvimento.
- checkpoint: uma pergunta que conecte o conteúdo ao contexto do aprendiz.
- key_takeaways: 3 a 6 ações ou ideias específicas, sem platitudes.
- media_brief: descreva uma imagem instrucional, como diagrama de processo, mapa de decisão ou comparação visual. Não peça imagem decorativa.
  ATENÇÃO ao idioma de cada campo: generation_prompt vai para um gerador de
  imagens e deve ser escrito em INGLÊS. Mas alt_text é a LEGENDA que o aluno lê
  no material e no PDF — escreva-a em ${language}, como uma frase curta que
  descreve o que a imagem mostra. Um curso em português com legenda em inglês é
  erro visível na página.

INTEGRIDADE FACTUAL
${numbersRule}
- Não invente leis, normas, estatísticas, métricas, referências, estudos, empresas ou resultados.
- Não crie siglas ou fórmulas inexistentes.
- Se houver caso condutor, use apenas os fatos do dossiê.
${caseDossier ? `\n${caseDossier}\n` : ""}${ledgerDeValores ? `\n${ledgerDeValores}\n` : ""}

COERÊNCIA INTERNA DO QUE VOCÊ ESCREVER
- Todo exemplo resolvido tem de obedecer à regra que o próprio módulo enunciou.
  Se o texto diz "os itens que somam os primeiros 80% do valor são A", um item
  que leva o acumulado a 87,87% não pode sair classificado como A. Confira o
  exemplo contra o critério antes de fechar o bloco; se o resultado divergir da
  regra, corrija o exemplo — não a regra.
- Verifique a aritmética de cada passo: o resultado de uma linha é a entrada da
  seguinte.

INTEGRIDADE DE DOMÍNIO
- Todo exemplo, terminologia e código deve permanecer no domínio do curso.
- Em curso de linguagem de programação, use somente a linguagem-alvo e seu ecossistema, salvo exigência explícita do curso.

FONTES
${
  useSources
    ? `- Use exclusivamente os trechos abaixo.\n- Cada bloco substantivo deve listar em source_ids apenas IDs que sustentem o bloco.\n- IDs permitidos: ${allowedSourceIds.join(", ")}\n- Se um detalhe não está nas fontes, omita-o.\n\n<SOURCES>\n${sourcePacket}\n</SOURCES>`
    : `- source_ids deve ser [] em todos os blocos.\n- Não apresente uma referência específica como consultada.`
}

SAÍDA
${
  part === "envelope"
    ? `Retorne SOMENTE o envelope do módulo — module_title, opening_bridge (a ponte com a aprendizagem anterior), checkpoint reflexivo, 3 a 6 key_takeaways e o media_brief. NÃO gere lições.`
    : `LIÇÃO A PRODUZIR AGORA: ${lessonPlan!.lesson_number} — ${lessonPlan!.title}
Objetivo: ${lessonPlan!.objective}
Padrão: ${lessonPlan!.pattern}
Blocos obrigatórios (todos devem aparecer): ${lessonPlan!.required_block_types.join(", ")}

Retorne SOMENTE esta lição, com no mínimo 3 e no máximo 6 blocos, contendo obrigatoriamente os tipos listados acima. Mantenha lesson_number e title exatamente como indicados.`
}
Todos os campos do esquema são obrigatórios; campos não usados pelo tipo do bloco devem ser string vazia ou [] — nunca omita uma chave.`;
}

// O Markdown gerado aqui é consumido por react-markdown SEM rehype-raw (em
// CourseView.tsx) e pelos exportadores de PDF, PPTX, DOCX, SCORM e Notion.
// Nenhum deles interpreta HTML cru: o react-markdown escapa, e o resultado
// aparece como texto literal para o aluno. Por isso este arquivo passa a emitir
// Markdown puro.
//
// O marcador `<!-- COURSE_WIDGET:tipo:payload -->` existia para um renderizador
// de widgets interativos que nunca foi construído: a string "COURSE_WIDGET" não
// aparece em nenhum lugar de src/ nem em nenhuma função de exportação. O efeito
// era o payload em percent-encoding vazando no meio da lição — às vezes com
// mais de mil caracteres.
//
// A carga estruturada de cada bloco não se perde, e vai para um lugar melhor:
// bestEffortStructuredHierarchy grava o bloco inteiro em
// course_learning_blocks.content_json. Se o renderizador de widgets for
// construído um dia, ele lê de uma coluna consultável em vez de um comentário
// enterrado no texto.
function semanticMarker(_type: string, _payload: unknown): string {
  return "";
}

function escapeTableCell(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\|/g, "\\|")
    // Guarda defensiva. Hoje ela não dispara: normalizeWhitespace, na linha
    // acima, já colapsou toda quebra de linha em espaço — o antigo
    // .replace(/\n/g, "<br>") era código morto pelo mesmo motivo, e por isso
    // nunca chegou a vazar "<br>" na tela. Fica como separador, e não como
    // HTML, caso a normalização mude.
    .replace(/\n+/g, " · ");
}

function renderTable(headers: string[], rows: string[][]): string {
  if (headers.length < 2 || rows.length < 2) return "";
  const normalizedRows = rows
    .map((row) => headers.map((_, index) => escapeTableCell(row[index] || "")))
    .filter((row) => row.some(Boolean));
  if (normalizedRows.length < 2) return "";
  return [
    `| ${headers.map(escapeTableCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...normalizedRows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function renderParagraphs(paragraphs: string[]): string {
  return paragraphs
    .filter(Boolean)
    .map((paragraph) => normalizeWhitespace(paragraph))
    .join("\n\n");
}

function renderBullets(bullets: string[]): string {
  return bullets
    .filter(Boolean)
    .map((bullet) => `- ${normalizeWhitespace(bullet).replace(/[.;:]?$/, ".")}`)
    .join("\n");
}

function renderBlock(block: LearningBlock): string {
  const heading = block.heading ? `#### ${stripLeadingOrdinal(block.heading)}\n\n` : "";
  const paragraphs = renderParagraphs(block.paragraphs);
  const bullets = renderBullets(block.bullets);
  const basicTail = [paragraphs, bullets].filter(Boolean).join("\n\n");

  switch (block.type) {
    case "comparison_tabs": {
      const items = block.items
        .filter((item) => item.label && item.content)
        .slice(0, 5);
      if (items.length < 2) return `${heading}${basicTail}`.trim();
      const marker = semanticMarker("tabs", { id: block.id, items });
      const fallback = items
        .map(
          (item) =>
            `##### ${item.label}${item.title ? ` — ${item.title}` : ""}\n\n${item.content}`,
        )
        .join("\n\n");
      return `${marker}\n${heading}${fallback}${basicTail ? `\n\n${basicTail}` : ""}`.trim();
    }
    case "flip_cards": {
      const cards = block.cards
        .filter((card) => card.front && card.back)
        .slice(0, 10);
      if (cards.length < 2) return `${heading}${basicTail}`.trim();
      const marker = semanticMarker("flip-cards", { id: block.id, cards });
      const table = renderTable(
        ["Frente", "Verso"],
        cards.map((card) => [card.front, card.back]),
      );
      return `${marker}\n${heading}${table}${basicTail ? `\n\n${basicTail}` : ""}`.trim();
    }
    case "accordion": {
      const items = block.items
        .filter((item) => (item.title || item.label) && item.content)
        .slice(0, 6);
      if (items.length < 2) return `${heading}${basicTail}`.trim();
      const marker = semanticMarker("accordion", { id: block.id, items });
      const fallback = items
        .map((item) => `**${item.title || item.label}**\n\n${item.content}`)
        .join("\n\n");
      return `${marker}\n${heading}${fallback}${basicTail ? `\n\n${basicTail}` : ""}`.trim();
    }
    case "process": {
      const steps = block.steps
        .filter((step) => step.title || step.description)
        .slice(0, 10);
      const marker = semanticMarker("process", { id: block.id, steps });
      const fallback = steps
        .map(
          (step, index) =>
            `${index + 1}. **${stripLeadingOrdinal(step.title || `Etapa ${index + 1}`)}** — ${step.description}`,
        )
        .join("\n");
      return `${marker}\n${heading}${fallback}${basicTail ? `\n\n${basicTail}` : ""}`.trim();
    }
    case "table":
    case "decision_map": {
      const table = renderTable(block.table.headers, block.table.rows);
      const marker = semanticMarker(
        block.type === "decision_map" ? "decision-map" : "table",
        {
          id: block.id,
          table: block.table,
        },
      );
      return `${marker}\n${heading}${table || basicTail}${table && basicTail ? `\n\n${basicTail}` : ""}`.trim();
    }
    case "code": {
      if (!block.code.code) return `${heading}${basicTail}`.trim();
      const marker = semanticMarker("code", {
        id: block.id,
        language: block.code.language,
      });
      return `${marker}\n${heading}\`\`\`${block.code.language}\n${block.code.code}\n\`\`\`\n\n${block.code.explanation}${basicTail ? `\n\n${basicTail}` : ""}`.trim();
    }
    case "worked_example": {
      const example = block.example;
      const marker = semanticMarker("worked-example", {
        id: block.id,
        example,
      });
      return `${marker}\n${heading}**Contexto:** ${example.context}\n\n**Desafio:** ${example.challenge}\n\n**Solução:** ${example.solution}\n\n**Resultado:** ${example.result}${basicTail ? `\n\n${basicTail}` : ""}`.trim();
    }
    case "scenario": {
      const scenario = block.scenario;
      const marker = semanticMarker("interactive-scenario", {
        id: block.id,
        scenario,
      });
      const turns = scenario.turns
        .map((turn, turnIndex) => {
          const options = turn.options
            .map(
              (option, optionIndex) =>
                `- [ ] ${String.fromCharCode(65 + optionIndex)}. ${option.text}`,
            )
            .join("\n");
          return `##### Etapa ${turnIndex + 1}\n\n${turn.situation}\n\n${options}`;
        })
        .join("\n\n");
      const facilitator = scenario.turns
        .map((turn, turnIndex) => {
          const correct = turn.options.findIndex((option) => option.is_correct);
          const feedback = turn.options
            .map(
              (option, optionIndex) =>
                `${String.fromCharCode(65 + optionIndex)}: ${option.feedback}`,
            )
            .join(" | ");
          return `- Etapa ${turnIndex + 1}: resposta ${correct >= 0 ? String.fromCharCode(65 + correct) : "a definir"}. ${feedback}`;
        })
        .join("\n");
      const debrief = renderBullets(scenario.debrief);
      // Antes isto vinha dentro de <details>/<summary>, que o react-markdown
      // escapa: em vez de um bloco recolhível, o aluno via as tags cruas e o
      // gabarito aberto do mesmo jeito. Em Markdown puro pelo menos fica
      // legível e claramente rotulado.
      return `${marker}\n${heading}**Papel:** ${scenario.role}\n\n**Contexto:** ${scenario.context}\n\n${turns}\n\n---\n\n**Gabarito e feedback do cenário**\n\n${facilitator}${debrief ? `\n\n**Checklist de decisão**\n\n${debrief}` : ""}`.trim();
    }
    case "activity": {
      const activity = block.activity;
      const marker = semanticMarker("activity", { id: block.id, activity });
      const template =
        activity.template_rows.length >= 2
          ? renderTable(
              ["Campo", "Orientação", "Seu caso"],
              activity.template_rows.map((row) => [
                row.field,
                row.instruction,
                "________________",
              ]),
            )
          : "";
      const steps = activity.steps
        .map((step, index) => `${index + 1}. ${step}`)
        .join("\n");
      const criteria = renderBullets(activity.success_criteria);
      return `${marker}\n${heading}> **Objetivo:** ${activity.objective}\n\n${template}${steps ? `\n\n**Passos**\n\n${steps}` : ""}\n\n**Entregável:** ${activity.deliverable}${criteria ? `\n\n**Critérios de sucesso**\n\n${criteria}` : ""}`.trim();
    }
    case "callout":
      return `${semanticMarker("callout", { id: block.id })}\n${heading}> ${[paragraphs, bullets].filter(Boolean).join("\n> \n> ")}`.trim();
    case "explanation":
    default:
      return `${heading}${basicTail}`.trim();
  }
}

function renderCourseOverview(course: CourseBlueprint): string {
  const objectives = course.course_objectives
    .map((objective) => `- **${objective.id}.** ${objective.statement}`)
    .join("\n");
  const skills = course.skills_and_knowledge.length
    ? course.skills_and_knowledge.map((skill) => `\`${skill}\``).join(" · ")
    : "";
  const prerequisites = course.prerequisites.length
    ? renderBullets(course.prerequisites)
    : "Nenhum pré-requisito formal.";
  const terms = course.terminology_ledger.slice(0, 10);
  const terminologyTable = terms.length
    ? renderTable(
        ["Termo", "Definição no curso", "Primeiro módulo"],
        terms.map((item) => [
          item.term,
          item.definition,
          String(item.first_module),
        ]),
      )
    : "";
  return `## Visão geral do curso\n\n${course.description}\n\n### Competência final\n\n${course.final_competency}\n\n### Objetivos do curso\n\n${objectives}\n\n### Habilidades e conhecimentos\n\n${skills || "As habilidades serão construídas ao longo da trilha."}\n\n### Pré-requisitos\n\n${prerequisites}${terminologyTable ? `\n\n### Mapa de termos essenciais\n\n${terminologyTable}` : ""}`;
}

function renderAppliedAssignment(assignment: AppliedAssignment): string {
  const requirements = renderBullets(assignment.requirements);
  const rubricRows = assignment.rubric.map((criterion) => [
    criterion.criterion,
    `${criterion.weight}%`,
    criterion.excellent,
    criterion.adequate,
    criterion.needs_improvement,
  ]);
  const rubric = renderTable(
    ["Critério", "Peso", "Excelente", "Adequado", "Precisa melhorar"],
    rubricRows,
  );
  return `### ${assignment.title}\n\n${assignment.description}\n\n**Entregável:** ${assignment.deliverable}${requirements ? `\n\n**Requisitos**\n\n${requirements}` : ""}\n\n**Rubrica de avaliação**\n\n${rubric}`;
}

function renderAdditionalReadings(readings: AdditionalReading[]): string {
  if (!readings.length) return "";
  const rows = readings.map((reading) => [
    reading.topic,
    reading.purpose,
    reading.preferred_source_type,
  ]);
  return `### Trilhas de aprofundamento\n\n${renderTable(["Tema", "Finalidade", "Fonte recomendada"], rows)}\n\n> Procure versões atuais e oficiais dessas referências. O curso não inventa links nem atribui documentos não consultados.`;
}

function renderModuleMarkdown(params: {
  course: CourseBlueprint;
  module: ModuleBlueprint;
  document: ModuleDocument;
  moduleIndex: number;
  sourceIndex: Map<string, SourceChunk>;
  includeOverview: boolean;
  includeCapstoneExtras: boolean;
}): string {
  const {
    course,
    module,
    document,
    sourceIndex,
    includeOverview,
    includeCapstoneExtras,
  } = params;
  const sections: string[] = [];
  if (includeOverview) sections.push(renderCourseOverview(course));
  sections.push(`## ${module.title}`);
  if (document.opening_bridge) sections.push(document.opening_bridge);

  for (const lesson of document.lessons) {
    // Lição que não produziu nenhum bloco utilizável não vira seção vazia no
    // material. Ela permanece no documento para não desalinhar os índices do
    // blueprint durante o reparo, mas some do Markdown entregue.
    if (!lesson.blocks.some(blockHasUsableContent)) continue;
    sections.push(
      `### ${lesson.lesson_number} ${stripLeadingOrdinal(lesson.title)}\n\n> **Objetivo da lição:** ${lesson.objective}`,
    );
    for (const block of lesson.blocks) {
      const rendered = renderBlock(block);
      if (rendered) sections.push(rendered);
    }
  }

  if (document.checkpoint) {
    sections.push(`> 💭 **Pare um momento e reflita:** ${document.checkpoint}`);
  }

  if (includeCapstoneExtras) {
    sections.push(renderAppliedAssignment(course.applied_assignment));
    const readings = renderAdditionalReadings(course.additional_readings);
    if (readings) sections.push(readings);
  }

  const usedIds = uniqueStrings(
    document.lessons.flatMap((lesson) =>
      lesson.blocks.flatMap((block) => block.source_ids),
    ),
    100,
  ).filter((id) => sourceIndex.has(id));
  if (usedIds.length) {
    const grouped = new Map<string, string[]>();
    for (const id of usedIds) {
      const chunk = sourceIndex.get(id)!;
      const ids = grouped.get(chunk.filename) || [];
      ids.push(id);
      grouped.set(chunk.filename, ids);
    }
    const references = [...grouped.entries()]
      .map(([filename, ids]) => `- **${filename}:** trechos ${ids.join(", ")}.`)
      .join("\n");
    sections.push(`### Referências utilizadas neste módulo\n\n${references}`);
  }

  const takeaways = document.key_takeaways.length
    ? document.key_takeaways
    : [
        `Aplicar o objetivo central de ${module.title}.`,
        "Usar os critérios apresentados para tomar decisões.",
        "Produzir o artefato previsto para o módulo.",
      ];
  sections.push(`---\n\n### 📌 Pontos-chave\n\n${renderBullets(takeaways)}`);

  const raw = sections.filter(Boolean).join("\n\n");
  return cleanModuleContent(raw, module.title).trim();
}

function blockHasUsableContent(block: LearningBlock): boolean {
  switch (block.type) {
    case "comparison_tabs":
    case "accordion":
      return (
        block.items.filter((item) => item.content && (item.label || item.title))
          .length >= 2
      );
    case "flip_cards":
      return block.cards.filter((card) => card.front && card.back).length >= 2;
    case "process":
      return (
        block.steps.filter((step) => step.title || step.description).length >= 3
      );
    case "table":
    case "decision_map":
      return block.table.headers.length >= 2 && block.table.rows.length >= 2;
    case "code":
      return !!block.code.code;
    case "worked_example":
      return !!(
        block.example.context &&
        block.example.challenge &&
        block.example.solution &&
        block.example.result
      );
    case "scenario":
      return block.scenario.turns.length === 4;
    case "activity":
      return !!(
        block.activity.objective &&
        block.activity.deliverable &&
        block.activity.steps.length >= 3
      );
    case "callout":
    case "explanation":
    default:
      return block.paragraphs.length > 0 || block.bullets.length > 0;
  }
}

// ─── Per-type block validation ──────────────────────────────────────────────

function wcText(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function validateLearningBlock(block: LearningBlock): { usable: boolean; issues: string[] } {
  const issues: string[] = [];
  const id = block.id || block.type;

  switch (block.type) {
    case "explanation": {
      if (isPlaceholderText(block.heading)) issues.push(`${id}: heading é placeholder.`);
      const total = [...block.paragraphs, ...block.bullets].reduce((s, t) => s + wcText(t), 0);
      if (total < 70) issues.push(`${id} (explanation): ${total} palavras; mínimo 70.`);
      const validParas = block.paragraphs.filter((p) => wcText(p) >= 10);
      const validBullets = block.bullets.filter((b) => wcText(b) >= 5);
      if (validParas.length < 2 && validBullets.length < 3) {
        issues.push(`${id}: precisa de ≥2 parágrafos ou ≥3 bullets substanciais.`);
      }
      break;
    }
    case "comparison_tabs":
    case "accordion": {
      const valid = block.items.filter((item) => wcText(item.content) >= 25);
      if (valid.length < 2) issues.push(`${id} (${block.type}): menos de 2 itens com ≥25 palavras.`);
      const titles = valid.map((item) => (item.title || item.label).toLowerCase().trim());
      if (new Set(titles).size < titles.length) issues.push(`${id}: títulos duplicados.`);
      break;
    }
    case "flip_cards": {
      const valid = block.cards.filter((c) => c.front && wcText(c.back) >= 12);
      if (valid.length < 3) issues.push(`${id} (flip_cards): menos de 3 cartões válidos (verso ≥12 palavras).`);
      break;
    }
    case "process": {
      const valid = block.steps.filter((s) => wcText(s.description) >= 18);
      if (valid.length < 3) issues.push(`${id} (process): menos de 3 etapas com descrição ≥18 palavras.`);
      break;
    }
    case "table":
    case "decision_map": {
      if (block.table.headers.length < 2) issues.push(`${id}: tabela sem colunas suficientes.`);
      const validRows = block.table.rows.filter((row) => row.some((c) => c.trim()));
      if (validRows.length < 3) issues.push(`${id}: tabela com menos de 3 linhas reais.`);
      break;
    }
    case "code": {
      if (!block.code.code) issues.push(`${id}: campo code vazio.`);
      if (!block.code.language) issues.push(`${id}: language não preenchido.`);
      if (wcText(block.code.explanation) < 35) issues.push(`${id}: explicação do código superficial (<35 palavras).`);
      break;
    }
    case "worked_example": {
      const reqs: [keyof typeof block.example, number][] = [
        ["context", 20], ["challenge", 12], ["solution", 30], ["result", 12],
      ];
      for (const [field, min] of reqs) {
        const w = wcText(block.example[field]);
        if (w < min) issues.push(`${id} (worked_example): ${field} com ${w} palavras; mínimo ${min}.`);
      }
      break;
    }
    case "scenario": {
      if (wcText(block.scenario.context) < 45) issues.push(`${id}: contexto do cenário superficial (<45 palavras).`);
      if (block.scenario.turns.length !== 4) issues.push(`${id}: deve ter exatamente 4 turnos.`);
      block.scenario.turns.forEach((turn, i) => {
        if (turn.options.length !== 4) issues.push(`${id}, turno ${i + 1}: deve ter 4 opções.`);
        if (turn.options.filter((o) => o.is_correct).length !== 1) issues.push(`${id}, turno ${i + 1}: exatamente 1 opção correta.`);
        turn.options.forEach((opt, j) => {
          if (wcText(opt.feedback) < 10) issues.push(`${id}, turno ${i + 1}, opção ${j + 1}: feedback <10 palavras.`);
        });
      });
      if (block.scenario.debrief.length < 3) issues.push(`${id}: debriefing com menos de 3 itens.`);
      break;
    }
    case "activity": {
      if (isPlaceholderText(block.activity.objective)) issues.push(`${id}: objetivo da atividade é placeholder.`);
      if (block.activity.template_rows.length < 3) issues.push(`${id}: template com menos de 3 linhas.`);
      if (block.activity.steps.length < 3) issues.push(`${id}: menos de 3 passos.`);
      if (!block.activity.deliverable || isPlaceholderText(block.activity.deliverable)) {
        issues.push(`${id}: entregável ausente ou genérico.`);
      }
      if (block.activity.success_criteria.length < 3) issues.push(`${id}: menos de 3 critérios de sucesso.`);
      break;
    }
    case "callout": {
      if (isPlaceholderText(block.heading)) issues.push(`${id}: heading de callout é placeholder.`);
      const total = [...block.paragraphs, ...block.bullets].reduce((s, t) => s + wcText(t), 0);
      if (total < 35) issues.push(`${id} (callout): ${total} palavras; mínimo 35.`);
      break;
    }
    default:
      break;
  }

  return { usable: issues.length === 0, issues };
}

function containsLikelyUnsupportedNumber(
  text: string,
  allowedCorpus: string,
): string[] {
  const patterns = [
    /(?:R\$|US\$|€|£)\s?\d[\d.,]*/gi,
    /\b\d+(?:[.,]\d+)?\s?%/g,
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
    /\b\d{4}\b/g,
  ];
  const allowed = normalizeForMatch(allowedCorpus);
  const found: string[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const token = normalizeForMatch(match[0]);
      if (token && !allowed.includes(token)) found.push(match[0]);
    }
  }
  return uniqueStrings(found, 20);
}

function detectDomainLeak(
  markdown: string,
  title: string,
  theme: string,
): string[] {
  const domain = `${title} ${theme}`.toLowerCase();
  const isProgramming =
    /(python|javascript|typescript|java\b|c#|c\+\+|golang|\bgo\b|ruby|php|kotlin|swift|rust)/i.test(
      domain,
    );
  const isSql =
    /(sql|banco de dados|database|postgres|mysql|sqlite|oracle)/i.test(domain);
  if (!isProgramming || isSql) return [];
  const sqlPatterns = [
    /\bCREATE\s+TABLE\b/i,
    /\bALTER\s+TABLE\b/i,
    /\bINSERT\s+INTO\b/i,
    /\bSELECT\s+.+\s+FROM\b/i,
    /\bUPDATE\s+.+\s+SET\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bJOIN\b/i,
  ];
  return sqlPatterns
    .filter((pattern) => pattern.test(markdown))
    .map((pattern) => `Vazamento de domínio detectado: ${pattern.source}.`);
}

function validateScenario(block: LearningBlock): string[] {
  if (block.type !== "scenario") return [];
  const errors: string[] = [];
  if (block.scenario.turns.length !== 4)
    errors.push(
      `Cenário "${block.heading || block.id}" deve ter exatamente 4 turnos.`,
    );
  block.scenario.turns.forEach((turn, index) => {
    if (turn.options.length !== 4)
      errors.push(
        `Cenário ${block.id}, turno ${index + 1}: deve ter exatamente 4 opções.`,
      );
    const correctCount = turn.options.filter(
      (option) => option.is_correct,
    ).length;
    if (correctCount !== 1)
      errors.push(
        `Cenário ${block.id}, turno ${index + 1}: deve ter exatamente 1 opção correta.`,
      );
    if (turn.options.some((option) => !option.feedback))
      errors.push(
        `Cenário ${block.id}, turno ${index + 1}: todas as opções precisam de feedback.`,
      );
  });
  return errors;
}

function validateModuleDocument(params: {
  course: CourseBlueprint;
  blueprint: ModuleBlueprint;
  document: ModuleDocument;
  markdown: string;
  sourcePacket: string;
  allowedSourceIds: Set<string>;
  useSources: boolean;
  targetMinWords: number;
  lessonMinWords: number;
  lessonMaxWords: number;
}): ModuleValidationResult {
  const {
    course,
    blueprint,
    document,
    markdown,
    sourcePacket,
    allowedSourceIds,
    useSources,
    targetMinWords,
    lessonMinWords,
    lessonMaxWords,
  } = params;
  const blocking: string[] = [];
  const repairable: string[] = [];
  const warnings: string[] = [];

  // ── Envelope checks ─────────────────────────────────────────────────────────
  if (document.lessons.length !== blueprint.lessons.length) {
    repairable.push(`Quantidade de lições: ${document.lessons.length}; esperado ${blueprint.lessons.length}.`);
  }
  if (!document.opening_bridge || document.opening_bridge.length < 40) {
    repairable.push("Ponte de progressão ausente ou superficial.");
  }
  if (!document.checkpoint || document.checkpoint.length < 20) {
    repairable.push("Checkpoint reflexivo ausente ou superficial.");
  }
  if (document.key_takeaways.length < 3 || document.key_takeaways.length > 6) {
    repairable.push(`Pontos-chave: ${document.key_takeaways.length} itens (esperado 3-6).`);
  }
  if (!markdown.includes("Pare um momento e reflita")) {
    repairable.push("Checkpoint ausente no Markdown.");
  }

  // ── Per-lesson checks (deep per-type validation) ──────────────────────────
  let activeBlocks = 0;
  let totalValidBlocks = 0;
  let incompleteCount = 0;

  document.lessons.forEach((lesson, lessonIndex) => {
    const planned = blueprint.lessons[lessonIndex];
    if (!planned) return;

    if (lesson.lesson_number !== planned.lesson_number) {
      repairable.push(`Numeração da lição ${lessonIndex + 1} divergente.`);
    }
    if (isPlaceholderText(lesson.objective)) {
      repairable.push(`Lição ${lesson.lesson_number}: objetivo é placeholder.`);
    }
    if (GENERIC_HEADINGS.has(lesson.title.trim().toLowerCase())) {
      warnings.push(`Título genérico de lição: "${lesson.title}".`);
    }

    const validBlocks: LearningBlock[] = [];
    for (const block of lesson.blocks) {
      if (ACTIVE_BLOCK_TYPES.has(block.type)) activeBlocks += 1;
      const { usable, issues: bIssues } = validateLearningBlock(block);
      if (!usable) {
        repairable.push(...bIssues.map((i) => `Lição ${lesson.lesson_number}: ${i}`));
      } else {
        validBlocks.push(block);
        totalValidBlocks += 1;
      }
      if (block.heading && GENERIC_HEADINGS.has(block.heading.trim().toLowerCase())) {
        warnings.push(`Título de bloco genérico: "${block.heading}".`);
      }
      if (useSources) {
        if (!block.source_ids.length && ["explanation", "table", "worked_example", "callout"].includes(block.type)) {
          warnings.push(`Bloco substantivo ${block.id} não registra fonte.`);
        }
        for (const sourceId of block.source_ids) {
          if (!allowedSourceIds.has(sourceId)) {
            repairable.push(`Bloco ${block.id} cita fonte inválida: ${sourceId}.`);
          }
        }
      } else if (block.source_ids.length) {
        warnings.push(`Bloco ${block.id} registra fontes em curso sem fontes; IDs serão removidos.`);
      }
    }

    // Required block types → repairable
    const actualTypes = new Set(lesson.blocks.map((b) => b.type));
    for (const requiredType of planned.required_block_types) {
      if (!actualTypes.has(requiredType)) {
        repairable.push(`Lição ${lesson.lesson_number}: bloco obrigatório ${requiredType} ausente.`);
      }
    }

    // Contagem de blocos: era minItems/maxItems no schema, agora é verificada aqui.
    if (lesson.blocks.length > 6) {
      warnings.push(`Lição ${lesson.lesson_number}: ${lesson.blocks.length} blocos (planejado no máximo 6).`);
    }

    // Uma lição vazia é a perda de UMA lição, não do módulo. Antes, qualquer
    // lição falha reprovava o módulo inteiro — e como cada lição é uma chamada
    // de rede independente, bastava um timeout entre quinze para derrubar tudo.
    // Agora a lição entra em reparo e, se não houver tempo, é descartada: o
    // módulo é entregue com o que funcionou e o curso vai para needs_review.
    if (validBlocks.length === 0) {
      repairable.push(`Lição ${lesson.lesson_number}: nenhum bloco válido.`);
      incompleteCount += 1;
    } else if (validBlocks.length < 2) {
      repairable.push(`Lição ${lesson.lesson_number}: menos de 2 blocos válidos.`);
      incompleteCount += 1;
    } else if (validBlocks.length < 3) {
      repairable.push(`Lição ${lesson.lesson_number}: apenas ${validBlocks.length} blocos válidos.`);
    }

    // Densidade POR LIÇÃO. Medir só o módulo inteiro escondia o desequilíbrio:
    // num curso real, um módulo com 514 + 1.922 + 1.309 palavras passava folgado
    // na soma, mas a primeira lição — justamente a que abre o curso — tinha
    // metade do que deveria.
    if (validBlocks.length > 0) {
      const lessonWordCount = validBlocks.reduce(
        (sum, block) =>
          sum +
          wordCount(
            [
              ...block.paragraphs,
              ...block.bullets,
              ...block.items.map((item) => `${item.title} ${item.content}`),
              ...block.steps.map((step) => `${step.title} ${step.description}`),
              ...block.cards.map((card) => `${card.front} ${card.back}`),
              block.example.context,
              block.example.challenge,
              block.example.solution,
              block.example.result,
              block.scenario.context,
              ...block.scenario.turns.map((turn) => turn.situation),
              block.activity.objective,
              ...block.activity.steps,
            ].join(" "),
          ),
        0,
      );
      if (lessonWordCount < lessonMinWords) {
        repairable.push(
          `Lição ${lesson.lesson_number}: ${lessonWordCount} palavras; mínimo ${lessonMinWords}.`,
        );
      } else if (lessonWordCount > lessonMaxWords) {
        warnings.push(
          `Lição ${lesson.lesson_number}: ${lessonWordCount} palavras (acima de ${lessonMaxWords}); tende a diluir o objetivo.`,
        );
      }
    }
  });

  // Só é impossível entregar quando NENHUMA lição sobrou.
  const lessonCount = document.lessons.length;
  if (lessonCount > 0 && incompleteCount >= lessonCount) {
    blocking.push(`Nenhuma lição utilizável no módulo (${incompleteCount}/${lessonCount}).`);
  } else if (lessonCount > 0 && incompleteCount / lessonCount > 0.25) {
    warnings.push(
      `${incompleteCount} de ${lessonCount} lições ficaram incompletas; módulo entregue parcial.`,
    );
  }

  if (activeBlocks < Math.min(2, lessonCount)) {
    warnings.push("Pouca aprendizagem ativa no módulo.");
  }

  // ── Density ──────────────────────────────────────────────────────────────────
  const words = wordCount(markdown);
  if (words < targetMinWords) {
    if (words < targetMinWords * 0.5) {
      repairable.push(`Densidade insuficiente: ${words} palavras (mínimo ${targetMinWords}).`);
    } else {
      warnings.push(`Densidade abaixo da meta: ${words}/${targetMinWords} palavras.`);
    }
  }

  // ── Blocking: factual integrity ──────────────────────────────────────────────
  if (useSources) {
    const unsupported = containsLikelyUnsupportedNumber(markdown, sourcePacket);
    if (unsupported.length) {
      blocking.push(`Números não localizados nas fontes: ${unsupported.join(", ")}.`);
    }
  }
  blocking.push(...detectDomainLeak(markdown, course.course_title, course.description));

  // Placeholder in final markdown is always blocking
  if (markdownHasPlaceholder(markdown)) {
    blocking.push("Placeholder detectado no Markdown final.");
  }

  // Zero valid blocks anywhere → blocking
  if (totalValidBlocks === 0) {
    blocking.push("Módulo sem nenhum bloco de conteúdo utilizável.");
  }

  return {
    blocking: uniqueStrings(blocking, 80),
    repairable: uniqueStrings(repairable, 80),
    warnings: uniqueStrings(warnings, 80),
  };
}

function deterministicModuleRepair(
  document: ModuleDocument,
  blueprint: ModuleBlueprint,
  allowedSourceIds: Set<string>,
  useSources: boolean,
): ModuleDocument {
  const repaired = structuredClone(document) as ModuleDocument;
  repaired.module_title = blueprint.title;
  repaired.lessons = blueprint.lessons.map((planned, lessonIndex) => {
    const lesson = repaired.lessons[lessonIndex] || {
      lesson_number: planned.lesson_number,
      title: planned.title,
      objective: planned.objective,
      blocks: [],
    };
    lesson.lesson_number = planned.lesson_number;
    lesson.title = lesson.title || planned.title;
    lesson.objective = lesson.objective || planned.objective;
    lesson.blocks = lesson.blocks
      .filter(blockHasUsableContent)
      .map((block, blockIndex) => ({
        ...block,
        id:
          block.id ||
          `m${blueprint.module_number}-l${lessonIndex + 1}-b${blockIndex + 1}`,
        source_ids: useSources
          ? block.source_ids.filter((id) => allowedSourceIds.has(id))
          : [],
      }));
    return lesson;
  });
  repaired.key_takeaways = uniqueStrings(repaired.key_takeaways, 6).slice(0, 6);
  if (repaired.key_takeaways.length < 3) {
    repaired.key_takeaways = uniqueStrings(
      [
        ...repaired.key_takeaways,
        `Aplicar o objetivo central de ${blueprint.title}.`,
        "Usar os critérios do módulo para orientar decisões.",
        `Produzir ${blueprint.produces_artifact.toLowerCase()}`,
      ],
      6,
    ).slice(0, 6);
  }
  repaired.checkpoint =
    repaired.checkpoint ||
    `Como você aplicaria ${blueprint.module_objective.toLowerCase()} no seu contexto?`;
  repaired.opening_bridge =
    repaired.opening_bridge ||
    (blueprint.module_number === 1
      ? `Este módulo situa o problema central do curso e prepara o primeiro artefato de aprendizagem.`
      : `A partir do que foi construído anteriormente, este módulo avança para ${blueprint.module_objective.toLowerCase()}.`);

  // Parte C — cenário malformado degrada para explanation em vez de reprovar o módulo
  for (const lesson of repaired.lessons) {
    lesson.blocks = lesson.blocks
      .map((block) => {
        if (block.type !== "scenario") return block;
        const turnsOk =
          block.scenario.turns.length === 4 &&
          block.scenario.turns.every(
            (turn) =>
              turn.options.length === 4 &&
              turn.options.filter((option) => option.is_correct).length === 1 &&
              turn.options.every((option) => option.feedback),
          );
        if (turnsOk) return block;
        const fallbackText = [
          block.scenario.context,
          ...block.scenario.turns.map((turn) => turn.situation),
          ...block.scenario.debrief,
        ].filter(Boolean);
        if (!fallbackText.length) return block;
        return {
          ...block,
          type: "explanation" as BlockType,
          heading: block.heading || block.scenario.title,
          paragraphs: fallbackText,
          scenario: EMPTY_SCENARIO,
        };
      })
      .filter(blockHasUsableContent);
  }

  // Parte D — piso de prática, verificado no RESULTADO e não no plano.
  //
  // Existe um piso no blueprint que promove uma lição a `practice` quando o
  // módulo não tem nenhuma lição de padrão prático. Ele parte de uma premissa
  // que não se sustenta: o padrão apenas PEDE os blocos, via
  // required_block_types. Quando o bloco pedido não vem, a falta é classificada
  // como reparável — e o reparo só roda se sobrar tempo no worker.
  //
  // Na prática isso deixou passar módulos inteiros: uma lição `procedural`
  // produziu o bloco `process` ("Passos") e não o `activity` (o template que o
  // aluno preenche). O piso do blueprint olhou o padrão, concluiu "coberto" e
  // seguiu adiante — dois de cinco módulos saíram sem prática nenhuma.
  //
  // Aqui a pergunta é outra: este módulo TEM um bloco activity? Se não tiver,
  // construímos um a partir do que já existe. Os passos de um bloco `process`
  // são a matéria-prima natural — já são um roteiro de execução, e viram as
  // linhas do template. É determinístico: não gasta chamada de rede nem
  // depende do tempo restante, que é justamente o que tornava o reparo
  // pouco confiável.
  if (!repaired.lessons.some((l) => l.blocks.some((b) => b.type === "activity"))) {
    const alvo = buildActivityFromModule(repaired, blueprint);
    if (alvo) {
      const { lessonIndex, block } = alvo;
      repaired.lessons[lessonIndex].blocks.push(block);
      console.warn(
        `[generate-course] Módulo ${blueprint.module_number} sem bloco de atividade; um foi derivado para a lição ${repaired.lessons[lessonIndex].lesson_number}.`,
      );
    }
  }

  return repaired;
}

/**
 * Deriva um bloco `activity` do conteúdo que o módulo já produziu.
 *
 * Ordem de preferência das fontes, da mais rica para a mais pobre:
 *   1. bloco `process` — os passos já são um roteiro de execução
 *   2. bloco `worked_example` — o exemplo resolvido vira o caso a replicar
 *   3. os objetivos das lições — último recurso, sempre disponível
 *
 * Devolve null quando não há material suficiente para uma atividade honesta:
 * um template de uma linha só seria pior que nenhum.
 */
/**
 * A primeira frase de um texto, no máximo `maxPalavras` palavras, terminando em
 * ponto. Serve para citar um momento do exemplo dentro da orientação de um
 * campo sem despejar o parágrafo inteiro dentro de uma célula de tabela.
 */
function primeiraFrase(texto: string, maxPalavras = 24): string {
  const limpo = normalizeWhitespace(stripMarkdown(String(texto ?? "")));
  if (!limpo) return "";
  const frase = limpo.split(/(?<=[.!?])\s+/)[0] || limpo;
  const palavras = frase.split(/\s+/);
  if (palavras.length <= maxPalavras) {
    return /[.!?…]$/.test(frase) ? frase : `${frase}.`;
  }
  return `${palavras.slice(0, maxPalavras).join(" ")}…`;
}

function buildActivityFromModule(
  document: ModuleDocument,
  blueprint: ModuleBlueprint,
): { lessonIndex: number; block: LearningBlock } | null {
  const artefato = blueprint.produces_artifact ||
    `o entregável de ${blueprint.title}`;

  // 1. Passos de um bloco `process`.
  for (let i = document.lessons.length - 1; i >= 0; i--) {
    const proc = document.lessons[i].blocks.find(
      (b) => b.type === "process" && b.steps.length >= 3,
    );
    if (!proc) continue;
    const rows = proc.steps
      .slice(0, 8)
      .map((step) => ({
        field: stripLeadingOrdinal(step.title || "").slice(0, 120),
        instruction: (step.description || "").slice(0, 240),
      }))
      .filter((r) => r.field || r.instruction);
    if (rows.length < 3) continue;
    return {
      lessonIndex: i,
      block: normalizeLearningBlock(
        {
          id: `m${blueprint.module_number}-activity-derived`,
          type: "activity",
          heading: proc.heading || "Atividade Prática",
          activity: {
            // Sem minúsculas e com o título entre aspas: colocar o cabeçalho em
            // caixa baixa no meio da frase gerava gagueira ("os passos de
            // passos do mapeamento") quando ele já começava por "Passos".
            objective: `Executar, no seu contexto, o roteiro apresentado em "${proc.heading || blueprint.title}".`,
            template_rows: rows,
            steps: proc.steps
              .slice(0, 8)
              .map((s) => `${stripLeadingOrdinal(s.title || "")}: ${s.description || ""}`.trim())
              .filter(Boolean),
            deliverable: artefato,
            success_criteria: [
              "Cada campo do template foi preenchido com dados do seu próprio contexto.",
              "As escolhas estão justificadas pelos conceitos do módulo.",
            ],
          },
        },
        `m${blueprint.module_number}-activity-derived`,
      ),
    };
  }

  // 2. Exemplo trabalhado — o aluno refaz o mesmo raciocínio no caso dele.
  //
  // A ATIVIDADE QUE SERVIA PARA QUALQUER CURSO
  //
  // Este ramo tinha o exemplo resolvido inteiro na mão — contexto, desafio,
  // solução e resultado — e não usava uma palavra dele. Produzia sempre o mesmo
  // molde: "Seu contexto / Desafio identificado / Sua solução / Resultado
  // esperado", com os passos "Releia o exemplo trabalhado do módulo. /
  // Identifique a situação equivalente no seu contexto. / …". Serve para
  // orçamento público, para panificação e para mergulho autônomo — que é
  // exatamente o problema: o aluno abre a página 17 do curso de orçamento e não
  // encontra ali nada de orçamento.
  //
  // Agora cada campo cita o momento correspondente do exemplo antes de fazer a
  // pergunta, e os passos apontam para o caso concreto. O molde continua o
  // mesmo — é o molde certo para "refaça no seu contexto" —, mas ancorado.
  for (let i = document.lessons.length - 1; i >= 0; i--) {
    const ex = document.lessons[i].blocks.find(
      (b) => b.type === "worked_example" && b.example.challenge && b.example.solution,
    );
    if (!ex) continue;
    const tituloEx = normalizeWhitespace(ex.heading || "") ||
      "o exemplo trabalhado do módulo";
    const ctx = primeiraFrase(ex.example.context, 18);
    const des = primeiraFrase(ex.example.challenge, 18);
    const sol = primeiraFrase(ex.example.solution, 18);
    const res = primeiraFrase(ex.example.result, 18);
    /**
     * A PERGUNTA VEM PRIMEIRO.
     *
     * A célula desta tabela é cortada por palavra quando vai para o slide. Se a
     * citação do exemplo abrisse a frase, o corte comeria justamente a pergunta
     * — o aluno leria o caso alheio e não saberia o que fazer com ele.
     */
    const campo = (pergunta: string, trecho: string) =>
      trecho ? `${pergunta} No exemplo: ${trecho}` : pergunta;
    return {
      lessonIndex: i,
      block: normalizeLearningBlock(
        {
          id: `m${blueprint.module_number}-activity-derived`,
          type: "activity",
          heading: "Atividade Prática",
          activity: {
            // Sem `.toLowerCase()`: ele destruía as siglas do título do exemplo
            // ("Aplicação da LDO e LOA" virava "aplicação da ldo e loa"). Entre
            // aspas, como já era feito no ramo 1.
            objective: `Refazer, no seu próprio contexto, a análise apresentada em "${tituloEx}".`,
            template_rows: [
              {
                field: "Seu contexto",
                instruction: campo("Descreva a situação equivalente na sua realidade.", ctx),
              },
              {
                field: "Desafio identificado",
                instruction: campo("Qual é o problema central a resolver no seu caso?", des),
              },
              {
                field: "Sua solução",
                instruction: campo("Que caminho você adotaria, e por quê?", sol),
              },
              {
                field: "Resultado esperado",
                instruction: campo("O que mudaria se a sua solução funcionasse?", res),
              },
            ],
            steps: [
              `Releia "${tituloEx}", o exemplo trabalhado deste módulo.`,
              des
                ? `Identifique, no seu contexto, a situação equivalente a: ${des}`
                : "Identifique a situação equivalente no seu contexto.",
              sol
                ? `Compare o caminho que você adotaria com o do exemplo: ${sol}`
                : "Decida que caminho você adotaria, e por quê.",
              `Preencha cada campo do modelo com os seus próprios dados e justifique as escolhas pelos conceitos de ${blueprint.title}.`,
            ],
            deliverable: artefato,
            success_criteria: [
              "O caso descrito é real e específico, não genérico.",
              `A solução se apoia nos conceitos de ${blueprint.title}.`,
              `A comparação com "${tituloEx}" aponta ao menos uma diferença relevante.`,
            ],
          },
        },
        `m${blueprint.module_number}-activity-derived`,
      ),
    };
  }

  // 3. Objetivos das lições. Sempre existem, então este ramo nunca deixa um
  //    módulo sem prática — mas produz o template mais genérico dos três.
  const objetivos = document.lessons
    .map((l) => (l.objective || "").trim())
    .filter(Boolean)
    .slice(0, 6);
  if (objetivos.length < 2) return null;
  const ultima = document.lessons.length - 1;
  return {
    lessonIndex: ultima,
    block: normalizeLearningBlock(
      {
        id: `m${blueprint.module_number}-activity-derived`,
        type: "activity",
        heading: "Atividade Prática",
        activity: {
          objective: `Consolidar ${blueprint.module_objective || blueprint.title} aplicando os objetivos do módulo ao seu contexto.`,
          template_rows: objetivos.map((obj, idx) => ({
            field: `Objetivo ${idx + 1}`,
            instruction: `Como você aplicaria isto na sua realidade? ${obj}`.slice(0, 240),
          })),
          steps: [
            "Releia os objetivos do módulo.",
            "Para cada um, descreva uma aplicação concreta no seu contexto.",
            "Aponte o que precisaria mudar para que ela funcione.",
          ],
          deliverable: artefato,
          success_criteria: [
            "Cada objetivo tem uma aplicação concreta e verificável.",
            "As aplicações descrevem o seu contexto, não um caso genérico.",
          ],
        },
      },
      `m${blueprint.module_number}-activity-derived`,
    ),
  };
}

function buildModuleRepairPrompt(params: {
  course: CourseBlueprint;
  blueprint: ModuleBlueprint;
  document: ModuleDocument;
  issues: string[];
  language: string;
  useSources: boolean;
  sourcePacket: string;
  allowedSourceIds: string[];
  numbersRule: string;
}): string {
  const {
    course,
    blueprint,
    document,
    issues,
    language,
    useSources,
    sourcePacket,
    allowedSourceIds,
    numbersRule,
  } = params;
  return `Você é o revisor final e o gate de qualidade de um curso corporativo.

Corrija o envelope do módulo abaixo sem mudar a arquitetura pedagógica. Retorne o envelope COMPLETO no mesmo esquema JSON.

CURSO: ${course.course_title}
MÓDULO: ${blueprint.title}
IDIOMA: ${language}

PROBLEMAS OBJETIVOS ENCONTRADOS
${issues.map((issue) => `- ${issue}`).join("\n")}

REGRAS
- opening_bridge: conecte explicitamente este módulo à aprendizagem anterior, com pelo menos 40 caracteres.
- checkpoint: uma pergunta reflexiva que ligue o conteúdo ao contexto do aprendiz.
- key_takeaways: de 3 a 6 itens específicos e acionáveis, sem platitudes.
- media_brief: imagem instrucional (diagrama, mapa de decisão, comparação visual), nunca decorativa.
- Não invente fatos ou números. ${numbersRule}
- Mantenha todos os exemplos no domínio do curso.
- source_ids: ${useSources ? `use apenas ${allowedSourceIds.join(", ")}` : "sempre []"}.

BLUEPRINT DO MÓDULO
${JSON.stringify(blueprint)}

ENVELOPE ATUAL
${JSON.stringify({
  module_title: document.module_title,
  opening_bridge: document.opening_bridge,
  checkpoint: document.checkpoint,
  key_takeaways: document.key_takeaways,
  media_brief: document.media_brief,
})}

${useSources ? `<SOURCES>\n${sourcePacket}\n</SOURCES>` : ""}`;
}

// ─── Semantic blueprint validation ─────────────────────────────────────────

function validateBlueprintSemantics(
  course: CourseBlueprint,
): { blocking: string[]; repairable: string[]; warnings: string[] } {
  const blocking: string[] = [];
  const repairable: string[] = [];
  const warnings: string[] = [];

  // final_competency
  const compWords = course.final_competency.trim().split(/\s+/).filter(Boolean).length;
  if (isPlaceholderText(course.final_competency)) {
    blocking.push("final_competency é um placeholder.");
  } else if (compWords < 10) {
    repairable.push(`final_competency muito curta (${compWords} palavras; mínimo 10).`);
  }

  // course_objectives
  for (const obj of course.course_objectives) {
    const w = obj.statement.trim().split(/\s+/).filter(Boolean).length;
    if (!obj.statement || isPlaceholderText(obj.statement)) {
      repairable.push(`Objetivo ${obj.id}: statement é placeholder ou vazio.`);
    } else if (w < 7 || w > 35) {
      warnings.push(`Objetivo ${obj.id}: statement tem ${w} palavras (esperado 7-35).`);
    }
    if (!obj.evidence_required || isPlaceholderText(obj.evidence_required)) {
      repairable.push(`Objetivo ${obj.id}: evidence_required ausente ou placeholder.`);
    }
  }

  // module / lesson objectives
  for (const mod of course.modules) {
    if (!mod.module_objective || isPlaceholderText(mod.module_objective)) {
      repairable.push(`Módulo ${mod.module_number}: module_objective ausente ou placeholder.`);
    }
    for (const lesson of mod.lessons) {
      if (!lesson.objective || isPlaceholderText(lesson.objective)) {
        repairable.push(`Lição ${lesson.lesson_number}: objective ausente ou placeholder.`);
      }
    }
  }

  // applied_assignment
  const aa = course.applied_assignment;
  if (!aa?.title || isPlaceholderText(aa.title)) repairable.push("applied_assignment.title ausente ou placeholder.");
  if (!aa?.description || isPlaceholderText(aa.description)) repairable.push("applied_assignment.description ausente.");
  if (!aa?.deliverable || isPlaceholderText(aa.deliverable)) repairable.push("applied_assignment.deliverable ausente.");
  if (!aa?.requirements || aa.requirements.length < 3) repairable.push("applied_assignment: menos de 3 requisitos.");
  const rubric = aa?.rubric ?? [];
  if (rubric.length < 3 || rubric.length > 6) {
    repairable.push(`applied_assignment.rubric: ${rubric.length} critérios (esperado 3-6).`);
  } else {
    const total = rubric.reduce((s, c) => s + Number((c as any).weight || 0), 0);
    if (Math.abs(total - 100) > 1) repairable.push(`Pesos da rubrica somam ${total}; esperado 100.`);
  }

  return { blocking, repairable, warnings };
}

// ─── Per-lesson repair ───────────────────────────────────────────────────────

async function repairLesson(params: {
  course: CourseBlueprint;
  module: ModuleBlueprint;
  lessonPlan: LessonBlueprint;
  currentLesson: LessonDocument;
  issues: string[];
  sourcePacket: string;
  allowedSourceIds: string[];
  language: string;
  useSources: boolean;
  numbersRule: string;
  maxTokens: number;
  msLeft: () => number;
}): Promise<LessonDocument> {
  const {
    course, module, lessonPlan, currentLesson, issues,
    sourcePacket, allowedSourceIds, language, useSources, numbersRule, maxTokens, msLeft,
  } = params;

  const prompt = `Você é revisor de qualidade de e-learning corporativo.

Corrija SOMENTE a lição indicada abaixo. Retorne o JSON completo da lição no esquema.

CURSO: ${course.course_title}
MÓDULO: ${module.title}
IDIOMA: ${language}

PROBLEMAS IDENTIFICADOS
${issues.map((i) => `- ${i}`).join("\n")}

BLUEPRINT DA LIÇÃO
- Número: ${lessonPlan.lesson_number}
- Título: ${lessonPlan.title}
- Objetivo: ${lessonPlan.objective}
- Padrão: ${lessonPlan.pattern}
- Blocos obrigatórios: ${lessonPlan.required_block_types.join(", ")}

REGRAS
- Preserve lesson_number e title exatamente como indicados.
- Produza no mínimo 3 e no máximo 6 blocos, incluindo obrigatoriamente os tipos acima.
- Conteúdo técnico específico; nunca use frases genéricas ou placeholders.
- Não invente números nem fatos. ${numbersRule}
- source_ids: ${useSources ? `use apenas ${allowedSourceIds.join(", ")}` : "sempre []"}.
- Todos os campos do esquema são obrigatórios; campos não usados pelo tipo do bloco devem ser string vazia ou [].

LIÇÃO ATUAL (para referência)
${JSON.stringify(currentLesson)}

${useSources ? `<SOURCES>\n${sourcePacket}\n</SOURCES>` : ""}`;

  // First attempt: Flash
  const schemaName = `lesson_repair_${lessonPlan.lesson_number.replace(/\./g, "_")}`;
  const timeoutBudget = Math.min(70000, Math.max(15000, msLeft() - 3000));

  const { value } = await callAIJson<any>(
    FAST_MODEL, prompt, LESSON_DOCUMENT_SCHEMA, schemaName,
    maxTokens, "medium", timeoutBudget,
  );

  // Inline normalization (no full-module context needed for a single lesson)
  function normalizeSingleLesson(raw: any): LessonDocument {
    const rawBlocks = Array.isArray(raw?.blocks) ? raw.blocks : [];
    const blocks = rawBlocks.slice(0, 8).map((b: any, i: number) =>
      normalizeLearningBlock(b, `m${module.module_number}-l${lessonPlan.lesson_number.replace(".", "_")}-b${i + 1}`)
    );
    return {
      lesson_number: lessonPlan.lesson_number,
      title: asString(raw?.title, lessonPlan.title),
      objective: asString(raw?.objective, lessonPlan.objective),
      blocks,
    };
  }

  const candidate = normalizeSingleLesson(value);
  const remainingIssues = candidate.blocks.flatMap((b) => {
    const r = validateLearningBlock(b);
    return r.usable ? [] : r.issues;
  });

  // Upgrade to Pro only when conditions from the spec are met
  if (
    remainingIssues.length > 0 &&
    ENABLE_PRO_REPAIR &&
    msLeft() > 35000 &&
    issues.length <= 3 // don't send Pro for noisy lists
  ) {
    console.warn(`[generate-course] repairLesson → Pro: lição ${lessonPlan.lesson_number} (${remainingIssues.length} issues restantes)`);
    try {
      const { value: proValue } = await callAIJson<any>(
        QUALITY_MODEL, prompt, LESSON_DOCUMENT_SCHEMA, `${schemaName}_pro`,
        maxTokens, "high", Math.min(70000, Math.max(15000, msLeft() - 4000)),
      );
      return normalizeSingleLesson(proValue);
    } catch {
      // Pro attempt failed — use Flash result
    }
  }

  return candidate;
}

// ─── Publication gate ─────────────────────────────────────────────────────────

function validateCourseForPublication(params: {
  blueprint: CourseBlueprint;
  okResults: ModuleGenerationResult[];
  includeQuiz: boolean;
  includeFlashcards: boolean;
}): {
  status: "ready" | "ready_with_warnings" | "needs_review";
  warningCount: number;
  needsReview: boolean;
  reasons: string[];
} {
  const { blueprint, okResults, includeQuiz, includeFlashcards } = params;
  const blocking: string[] = [];
  const cosmetic: string[] = [];

  // Module count
  if (okResults.length < blueprint.modules.length) {
    blocking.push(`${okResults.length}/${blueprint.modules.length} módulos gerados.`);
  }

  // Capstone
  const lastMod = blueprint.modules[blueprint.modules.length - 1];
  if (lastMod?.role !== "capstone") blocking.push("Último módulo não é capstone.");

  for (const result of okResults) {
    const modNum = result.document.lessons[0]?.lesson_number?.split(".")[0] || "?";

    // Placeholder in final content
    if (markdownHasPlaceholder(result.markdown)) {
      blocking.push(`Módulo ${modNum}: placeholder detectado no conteúdo final.`);
    }

    // Per-lesson checks
    for (const lesson of result.document.lessons) {
      const validBlocks = lesson.blocks.filter((b) => blockHasUsableContent(b));
      if (validBlocks.length < 2) {
        blocking.push(`Lição ${lesson.lesson_number}: menos de 2 blocos válidos.`);
      } else if (validBlocks.length < 3) {
        cosmetic.push(`Lição ${lesson.lesson_number}: ${validBlocks.length} blocos (recomendado ≥3).`);
      }
    }

    // Capstone: activity + rubric — structural check
    const modBlueprint = blueprint.modules.find((m) => m.module_number === Number(modNum));
    if (modBlueprint?.role === "capstone") {
      const hasActivity = result.document.lessons.some((l) =>
        l.blocks.some((b) => b.type === "activity"),
      );
      if (!hasActivity) blocking.push(`Módulo capstone ${modNum}: atividade aplicada ausente.`);
      if (!blueprint.applied_assignment?.rubric?.length) {
        blocking.push(`Módulo capstone ${modNum}: rubrica ausente.`);
      }
      // Capstone: markdown final must contain the applied-assignment section markers.
      const md = result.markdown;
      if (!md.includes("**Entregável:**")) {
        blocking.push(`Módulo capstone ${modNum}: marcador de entregável ausente no Markdown.`);
      }
      if (!md.includes("**Requisitos**")) {
        blocking.push(`Módulo capstone ${modNum}: marcador de requisitos ausente no Markdown.`);
      }
      if (!md.includes("**Rubrica de avaliação**")) {
        blocking.push(`Módulo capstone ${modNum}: marcador de rubrica ausente no Markdown.`);
      }
    }

    // Assessments
    if (includeQuiz && (!result.assessment || result.assessment.multiple_choice.length < 3)) {
      blocking.push(`Módulo ${modNum}: quiz obrigatório ausente.`);
    }
    if (includeFlashcards && (!result.assessment || result.assessment.flashcards.length < 5)) {
      blocking.push(`Módulo ${modNum}: flashcards obrigatórios ausentes.`);
    }
  }

  if (blocking.length) {
    return { status: "needs_review", warningCount: cosmetic.length, needsReview: true, reasons: blocking };
  }
  if (cosmetic.length) {
    return { status: "ready_with_warnings", warningCount: cosmetic.length, needsReview: false, reasons: cosmetic };
  }
  return { status: "ready", warningCount: 0, needsReview: false, reasons: [] };
}

function evidenceSupported(excerpt: string, markdown: string): boolean {
  const evidence = normalizeForMatch(excerpt);
  const content = normalizeForMatch(markdown);
  if (!evidence || evidence.split(" ").length < 5) return false;
  if (content.includes(evidence)) return true;
  const evidenceTokens = new Set(
    evidence.split(" ").filter((token) => token.length >= 4),
  );
  if (!evidenceTokens.size) return false;
  const contentTokens = new Set(content.split(" "));
  const overlap =
    [...evidenceTokens].filter((token) => contentTokens.has(token)).length /
    evidenceTokens.size;
  return overlap >= 0.8;
}

function normalizeAssessment(raw: any): AssessmentDocument {
  const multipleChoice: MultipleChoiceQuestion[] = Array.isArray(
    raw?.multiple_choice,
  )
    ? raw.multiple_choice.slice(0, 3).map((question: any) => ({
        question: asString(question?.question),
        options: asStringArray(question?.options, 4).slice(0, 4),
        correct: clampInt(question?.correct, 0, 3, 0),
        explanation: asString(question?.explanation),
        outcome_id: asString(question?.outcome_id),
        evidence_excerpt: asString(question?.evidence_excerpt),
        difficulty: (["easy", "medium", "hard"] as const).includes(
          question?.difficulty,
        )
          ? question.difficulty
          : "medium",
      }))
    : [];
  const open = raw?.open_ended || {};
  const flashcards: Flashcard[] = Array.isArray(raw?.flashcards)
    ? raw.flashcards
        .slice(0, 5)
        .map((card: any) => ({
          front: asString(card?.front),
          back: asString(card?.back),
        }))
        .filter((card: Flashcard) => card.front && card.back)
    : [];
  return {
    multiple_choice: multipleChoice,
    open_ended: {
      question: asString(open?.question),
      // A rede contra o muro de texto da página 47. Ver restaurarQuebrasDePasso.
      // Um ponto só serve os dois destinos: o Markdown da apostila e a linha
      // gravada em course_open_questions.
      sample_answer: restaurarQuebrasDePasso(asString(open?.sample_answer)),
      criteria: asStringArray(open?.criteria, 8),
      outcome_id: asString(open?.outcome_id),
    },
    flashcards,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// NEM TODO DEFEITO DA AVALIAÇÃO É FATAL
//
// A regra tratava tudo como fatal e devolvia `null` — o módulo saía SEM quiz,
// sem flashcards e sem questão aberta. Os logs de 27/08 mostram o preço disso
// no módulo 4 do curso de estoques:
//
//   AI ok    module_assessment  effort=low     elapsed=15323ms   ← funcionou
//   AI call  module_assessment  effort=medium                    ← tentou de novo
//   Timeout após 17138ms
//   Assessment rejected for module 4
//
// A primeira tentativa produziu uma avaliação. Ela foi descartada por não ser
// perfeita, a segunda estourou o prazo, e o aluno ficou sem avaliação nenhuma.
// Uma avaliação com quatro flashcards em vez de cinco é melhor que nenhuma.
//
// A SEPARAÇÃO
//
// ERRO é o que quebra o produto ou engana o aluno: índice de resposta correta
// fora da faixa (nada fica certo), menos de quatro opções (a tela espera
// quatro), opções repetidas (a "correta" fica ambígua), enunciado vazio, e
// evidência que não existe no conteúdo — essa última porque perguntar o que o
// módulo não ensinou é pior do que não perguntar.
//
// RESSALVA é o que empobrece sem quebrar: duas questões em vez de três, quatro
// flashcards em vez de cinco, flashcard sem pergunta explícita, questão não
// vinculada a um objetivo do módulo. O vínculo alimenta a matriz de objetivos;
// sem ele a matriz fica incompleta, e o quiz funciona igual.
// ═══════════════════════════════════════════════════════════════════════════
export interface LaudoDaAvaliacao {
  /** Impedem a entrega: quebram a tela ou enganam quem estuda. */
  erros: string[];
  /** Empobrecem, e não impedem. Viram aviso no módulo. */
  ressalvas: string[];
}

function validateAssessment(params: {
  assessment: AssessmentDocument;
  module: ModuleBlueprint;
  markdown: string;
  includeQuiz: boolean;
  includeFlashcards: boolean;
}): LaudoDaAvaliacao {
  const { assessment, module, markdown, includeQuiz, includeFlashcards } =
    params;
  const erros: string[] = [];
  const ressalvas: string[] = [];
  if (includeQuiz) {
    // Zero questões não é "menos que três": é não ter avaliação objetiva.
    if (!assessment.multiple_choice.length) {
      erros.push("A avaliação não trouxe nenhuma questão objetiva.");
    } else if (assessment.multiple_choice.length !== 3) {
      ressalvas.push(
        `A avaliação trouxe ${assessment.multiple_choice.length} questões objetivas em vez de 3.`,
      );
    }
    assessment.multiple_choice.forEach((question, index) => {
      if (!question.question || question.question.length < 20)
        erros.push(`Questão ${index + 1} é curta ou vazia.`);
      if (question.options.length !== 4)
        erros.push(`Questão ${index + 1} deve ter 4 opções.`);
      if (
        new Set(question.options.map((option) => normalizeForMatch(option)))
          .size !== 4
      )
        erros.push(`Questão ${index + 1} possui opções repetidas.`);
      if (question.correct < 0 || question.correct >= 4)
        erros.push(`Questão ${index + 1} possui índice correto inválido.`);
      if (!question.explanation)
        erros.push(`Questão ${index + 1} não possui explicação.`);
      if (!evidenceSupported(question.evidence_excerpt, markdown))
        erros.push(
          `Questão ${index + 1} não possui evidência verificável no conteúdo final.`,
        );
      if (!module.outcome_ids.includes(question.outcome_id))
        ressalvas.push(
          `Questão ${index + 1} não está vinculada a objetivo do módulo.`,
        );
    });
    if (!assessment.open_ended.question) {
      erros.push("A questão aberta não tem enunciado.");
    } else if (assessment.open_ended.criteria.length < 2) {
      ressalvas.push(
        "A questão aberta tem menos de 2 critérios de correção.",
      );
    }
    if (!module.outcome_ids.includes(assessment.open_ended.outcome_id)) {
      ressalvas.push("A questão aberta não está vinculada a objetivo do módulo.");
    }
  } else if (
    assessment.multiple_choice.length ||
    assessment.open_ended.question
  ) {
    erros.push("Foram geradas questões embora o quiz esteja desativado.");
  }

  if (includeFlashcards) {
    if (!assessment.flashcards.length) {
      erros.push("A avaliação não trouxe nenhum flashcard.");
    } else if (assessment.flashcards.length !== 5) {
      ressalvas.push(
        `A avaliação trouxe ${assessment.flashcards.length} flashcards em vez de 5.`,
      );
    }
    assessment.flashcards.forEach((card, index) => {
      if (!card.front.endsWith("?"))
        ressalvas.push(
          `Flashcard ${index + 1} não tem pergunta explícita na frente.`,
        );
      if (card.back.length < 20)
        ressalvas.push(`Flashcard ${index + 1} tem resposta superficial.`);
    });
  } else if (assessment.flashcards.length) {
    erros.push("Foram gerados flashcards embora estejam desativados.");
  }
  return {
    erros: uniqueStrings(erros, 50),
    ressalvas: uniqueStrings(ressalvas, 50),
  };
}

function buildAssessmentPrompt(params: {
  course: CourseBlueprint;
  module: ModuleBlueprint;
  markdown: string;
  language: string;
  includeQuiz: boolean;
  includeFlashcards: boolean;
  priorErrors?: string[];
}): string {
  const {
    course,
    module,
    markdown,
    language,
    includeQuiz,
    includeFlashcards,
    priorErrors = [],
  } = params;
  const objectives = course.course_objectives
    .filter((objective) => module.outcome_ids.includes(objective.id))
    .map(
      (objective) =>
        `${objective.id}: ${objective.statement} (${objective.bloom_level})`,
    )
    .join("\n");
  return `Você é um especialista em avaliação educacional corporativa.

Gere a avaliação SOMENTE a partir do conteúdo final abaixo. A avaliação deve medir os objetivos do módulo e não apenas memória de frases.

CURSO: ${course.course_title}
MÓDULO: ${module.title}
IDIOMA: ${language}
OBJETIVOS DO MÓDULO:
${objectives}

CONFIGURAÇÃO
- Questões objetivas: ${includeQuiz ? "EXATAMENTE 3" : "0"}
- Questão aberta: ${includeQuiz ? "1" : "vazia"}
- Flashcards: ${includeFlashcards ? "EXATAMENTE 5" : "0"}

QUALIDADE DAS QUESTÕES OBJETIVAS
1. EXATAMENTE quatro opções, distintas e gramaticalmente paralelas.
2. Uma única resposta correta; "correct" é o índice dela (0 a 3).
3. Distratores plausíveis que representem erros reais de iniciantes ou decisões tecnicamente inferiores. Não use alternativas absurdas.
4. Pelo menos uma questão de aplicação ou análise quando o objetivo do módulo estiver em apply/analyse/evaluate/create.
5. explanation deve explicar por que a correta é melhor e por que o erro é relevante.
6. outcome_id deve ser um dos objetivos listados.
7. evidence_excerpt deve copiar literalmente de 8 a 25 palavras do conteúdo final que sustentem a resposta correta.
8. Não pergunte algo que não esteja ensinado no conteúdo.

QUESTÃO ABERTA
- Deve exigir aplicação ao contexto profissional.
- Inclua resposta-modelo e de 2 a 5 critérios observáveis de correção.
- sample_answer é uma string com quebras de linha reais ("\\n"). Quando a resposta
  tiver um cálculo, escreva UM PASSO POR LINHA, e a explicação em parágrafo
  separado por linha em branco. Não emende os passos num parágrafo corrido: a
  apostila imprime a string como ela chega, e um cálculo em linha única sai com
  as palavras coladas ("...= 60 unidadesO Ponto de Pedido de 60 unidades...").
  Exemplo do formato esperado:
  "Cálculo do LEC:\\nLEC = √((2 × 3600 × 50) / 2)\\nLEC = √(180000)\\nLEC ≈ 424 unidades\\n\\nO resultado indica que..."

FLASHCARDS
- Use somente quando ativados.
- Frente em forma de pergunta terminada por "?".
- Verso com definição ou orientação técnica completa (pelo menos 20 caracteres).
- Não use flashcards para habilidades complexas que exigem análise de caso.

${priorErrors.length ? `CORRIJA TAMBÉM ESTES PROBLEMAS DA TENTATIVA ANTERIOR:\n${priorErrors.map((error) => `- ${error}`).join("\n")}\n` : ""}

CONTEÚDO FINAL DO MÓDULO
<MODULE_CONTENT>
${markdown}
</MODULE_CONTENT>

Retorne somente o JSON do esquema, com todos os campos presentes. Campos desativados devem ser [] ou objeto com strings vazias e criteria [].`;
}

// ═══════════════════════════════════════════════════════════════════════════
// O PASSO A PASSO QUE CHEGA NUMA LINHA SÓ
//
// Na apostila de estoque de 23/08, página 47, a resposta-modelo saiu assim:
//
//   ...LEC = √(180000)LEC ≈ 424 unidadesO LEC de aproximadamente 424 unidades
//   indica que o Sr. João deve comprar...Ponto de Pedido = (10 unidades/dia ×
//   3 dias) + 30 unidadesPonto de Pedido = 60 unidades...
//
// Um muro, com as palavras coladas em cada troca de passo. Os critérios de
// correção logo acima saíam certinhos, um por linha — mas eles vêm de um array,
// e `sample_answer` é uma string só. O modelo escreve um cálculo passo a passo
// dentro de um campo que trata como prosa, sem `\n` nenhum, e o exportador não
// tem onde quebrar.
//
// A prevenção está no prompt (ver QUESTÃO ABERTA em buildAssessmentPrompt).
// Isto aqui é a rede: quando a string chega inteira sem uma quebra sequer,
// devolvemos as quebras onde a colagem é INEQUÍVOCA.
//
// "Inequívoca" é o que dá segurança a esta função. Todas as regras exigem
// ADJACÊNCIA — nenhum espaço entre o que terminou e a maiúscula que começa. Em
// português, uma palavra nunca é seguida colada de outra com inicial maiúscula;
// quando isso aparece, ou era uma quebra de linha, ou é um nome CamelCase. Por
// isso o único falso positivo possível está na lista COMPOSTOS_CAMELCASE.
// ═══════════════════════════════════════════════════════════════════════════

/** Nomes que legitimamente têm maiúscula no meio e não podem ser partidos. */
const COMPOSTOS_CAMELCASE =
  /(?:PowerPoint|WhatsApp|YouTube|LinkedIn|MercadoLivre|MercadoPago|PagSeguro|OneDrive|SharePoint|QuickBooks|MacBook|iFood|iPhone|eBook|eSocial|eCommerce|NotaFiscal)/gi;

/** Início de linha de cálculo: um rótulo curto seguido de "=". */
const LINHA_DE_CALCULO = /(?<=[a-zà-ÿ0-9)\]])(?=[A-ZÀ-Þ][A-Za-zÀ-ÿ ]{0,40}=)/g;
// Pontuação que fecha alguma coisa, colada numa maiúscula.
//
// A aspa precisa de cuidado: `'Macarrão` é uma aspa ABRINDO um nome de produto,
// e quebrar ali estraga texto correto — foi o primeiro falso positivo que este
// teste pegou. Uma aspa só fecha quando vem depois de letra ou dígito. Para o
// resto da pontuação basta não haver espaço antes, o que já exclui `("Café`.
const PONTUACAO_COLADA =
  /(?<=[A-Za-zÀ-ÿ0-9]['"]|[^\s][)\]%:.,;!?])(?=[A-ZÀ-Þ])/g;
/** Artigo iniciando frase nova, colado na palavra anterior. */
const ARTIGO_COLADO = /(?<=[a-zà-ÿ0-9)\]])(?=(?:O|A|Os|As)\s[A-Za-zÀ-ÿ])/g;

/**
 * Devolve as quebras de linha a um passo a passo que veio numa linha só.
 *
 * Não faz nada se o texto já tem quebra — quem formatou direito fica intacto —
 * nem em textos curtos, onde um muro não chega a atrapalhar.
 */
export function restaurarQuebrasDePasso(texto: string): string {
  const t = String(texto ?? "");
  if (!t || t.includes("\n") || t.length < 120) return t;

  // Os nomes CamelCase saem de cena por um marcador que nenhuma regra casa, e
  // voltam no fim. E mais simples e mais seguro que tentar excluí-los em cada
  // uma das três expressões.
  //
  // O marcador usa a área de uso privado do Unicode com um índice entre
  // delimitadores. Um número cru não serviria: o texto é um cálculo, está cheio
  // de números, e a volta trocaria "1200" pelo primeiro nome guardado.
  const abre = String.fromCharCode(0xe000);
  const fecha = String.fromCharCode(0xe001);
  const guardados: string[] = [];
  let corpo = t.replace(COMPOSTOS_CAMELCASE, (nome) => {
    guardados.push(nome);
    return `${abre}${guardados.length - 1}${fecha}`;
  });

  corpo = corpo
    .replace(PONTUACAO_COLADA, "\n")
    .replace(LINHA_DE_CALCULO, "\n")
    .replace(ARTIGO_COLADO, "\n");

  corpo = corpo.replace(
    new RegExp(`${abre}(\\d+)${fecha}`, "g"),
    (_m, i) => guardados[Number(i)],
  );

  if (corpo === t) return t;
  console.log(
    `[generate-course] resposta-modelo veio numa linha só; ${
      corpo.split("\n").length - 1
    } quebras restauradas`,
  );
  return corpo;
}

function renderOpenEndedAssessment(openEnded: OpenEndedQuestion): string {
  if (!openEnded.question) return "";
  const marker = semanticMarker("open-ended-assessment", openEnded);
  const criteria = renderBullets(openEnded.criteria);
  return `${marker}\n### Questão de aplicação\n\n${openEnded.question}${criteria ? `\n\n**Critérios de correção**\n\n${criteria}` : ""}\n\n---\n\n**Resposta-modelo**\n\n${openEnded.sample_answer}`.trim();
}

async function generateAssessment(params: {
  course: CourseBlueprint;
  module: ModuleBlueprint;
  markdown: string;
  language: string;
  includeQuiz: boolean;
  includeFlashcards: boolean;
  msLeft: () => number;
}): Promise<AssessmentDocument | null> {
  const {
    course,
    module,
    markdown,
    language,
    includeQuiz,
    includeFlashcards,
    msLeft,
  } = params;
  if (!includeQuiz && !includeFlashcards) return null;
  let priorErrors: string[] = [];
  // A melhor avaliação vista até agora: sem erro estrutural, com ressalvas.
  // Ela é a rede — o que se entrega quando a segunda tentativa não vem.
  let melhor: { assessment: AssessmentDocument; ressalvas: string[] } | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    // NÃO ARRISCAR O QUE JÁ SE TEM POR UMA MELHORA MARGINAL.
    //
    // A segunda tentativa é opcional e, no módulo 4 do curso de estoques, ela
    // custou tudo: começou com ~20 s no relógio e estourou em 17,1 s. As oito
    // chamadas de avaliação daquele curso levaram de 11,1 s a 17,2 s, então
    // 20 s era cara ou coroa. Com uma avaliação boa-o-bastante na mão, só vale
    // tentar de novo com folga sobre o PIOR tempo observado, não sobre o médio.
    const minimo = melhor ? 25000 : 14000;
    if (msLeft() < minimo) break;
    const prompt = buildAssessmentPrompt({
      course,
      module,
      markdown,
      language,
      includeQuiz,
      includeFlashcards,
      priorErrors,
    });
    try {
      const { value } = await callAIJson<any>(
        FAST_MODEL,
        prompt,
        ASSESSMENT_SCHEMA,
        "module_assessment",
        7000,
        attempt === 0 ? "low" : "medium",
        Math.min(70000, Math.max(12000, msLeft() - 3000)),
      );
      const assessment = normalizeAssessment(value);
      const laudo = validateAssessment({
        assessment,
        module,
        markdown,
        includeQuiz,
        includeFlashcards,
      });
      if (!laudo.erros.length && !laudo.ressalvas.length) return assessment;
      // Sem erro estrutural, ela já serve. Guarda-se a primeira que chega neste
      // estado: a segunda tentativa pode melhorá-la, e pode não voltar.
      if (!laudo.erros.length && !melhor) {
        melhor = { assessment, ressalvas: laudo.ressalvas };
      }
      priorErrors = [...laudo.erros, ...laudo.ressalvas];
    } catch (error: any) {
      priorErrors = [error?.message || String(error)];
    }
  }

  if (melhor) {
    console.warn(
      `[generate-course] Avaliação do módulo ${module.module_number} entregue com ressalvas: ${melhor.ressalvas.join(" | ")}`,
    );
    return melhor.assessment;
  }
  console.warn(
    `[generate-course] Assessment rejected for module ${module.module_number}: ${priorErrors.join(" | ")}`,
  );
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// A IMAGEM NÃO PRECISA ESPERAR AS LIÇÕES
//
// No curso de estoques de 27/08, dois módulos de oito saíram sem ilustração:
//
//   [generate-course-module] Módulo 4 entregue sem imagem: restam 3s.
//   [generate-course-module] Módulo 6 entregue sem imagem: restam 11s.
//
// Não foi falha da API. A imagem era a ÚLTIMA coisa da fila e só é tentada se
// sobrarem mais de 20 s do orçamento de 125 s. Os dois módulos são justamente
// os que precisaram de reparo de lição — 20,5 s no módulo 4 e 35 s no módulo 6
// —, e o 4 ainda perdeu 17,1 s numa avaliação que estourou. A imagem perdia
// por um problema que não era dela.
//
// Só que ela nunca dependeu das lições. Tudo de que precisa é o `media_brief`,
// e ele vem no ENVELOPE, pronto em cerca de 8 s. Então a chamada cara sai da
// frente: começa logo depois do envelope e é esperada no fim, quando o id do
// módulo existe para gravar. Passa a ter ~110 s de folga em vez de disputar os
// últimos 3.
//
// Daí a divisão em duas funções. `gerarImagemDoModulo` fala com o Gemini e
// converte; `gravarImagemDoModulo` sobe ao Storage e registra em course_images.
// A primeira não conhece moduleId — é isso que a deixa começar antes de existir
// linha no banco.
// ═══════════════════════════════════════════════════════════════════════════

export interface ImagemGerada {
  bytes: Uint8Array;
  ext: "jpg" | "png";
  mime: string;
  alt: string;
}

export async function gerarImagemDoModulo(params: {
  course: CourseBlueprint;
  module: ModuleBlueprint;
  mediaBrief: ModuleDocument["media_brief"];
}): Promise<ImagemGerada | null> {
  const { course, module, mediaBrief } = params;
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) return null;

  const prompt = `${mediaBrief.generation_prompt}

Educational purpose: ${mediaBrief.purpose}
Core concept: ${mediaBrief.concept}
Course: ${course.course_title}
Module: ${module.title}

Create a premium 16:9 educational visual that explains the concept rather than merely decorating the page. Prefer a process diagram, decision map, relationship map, annotated conceptual scene, or visual comparison as appropriate. Use clean composition, strong visual hierarchy, generous negative space, and a professional corporate e-learning aesthetic.

No typography, letters, numerals, logos, signatures, watermarks, fake interface text, or unreadable labels. Any screens, signs, books, cards, or panels must remain blank. Do not depict a real identifiable person.`;

  // IMAGE_MODEL is already validated at startup; if it looks wrong skip silently.
  const imageModelResolved = safeModel(IMAGE_MODEL, "gemini-2.5-flash-image");
  if (!imageModelResolved.includes("image") && !Deno.env.get("COURSE_IMAGE_MODEL")) {
    console.warn("[generate-course] Image model not configured; skipping image generation.");
    return null;
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/${imageModelResolved}:generateContent`;
  try {
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // `responseFormat` não é campo do generationConfig da API do Gemini:
          // era ignorado no melhor caso e motivo de 400 no pior. A proporção
          // 16:9 já é pedida no texto do prompt, que é onde ela funciona.
          generationConfig: {
            responseModalities: ["IMAGE"],
          },
        }),
      },
      65000,
    );
    if (!response.ok) {
      console.warn(
        `[generate-course] Image API failed for module ${module.module_number}: ${response.status} ${await response.text()}`,
      );
      return null;
    }
    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find(
      (part: any) => part?.inlineData?.data || part?.inline_data?.data,
    );
    const inline = imagePart?.inlineData || imagePart?.inline_data;
    if (!inline?.data) return null;

    const binary = Uint8Array.from(atob(inline.data), (char) =>
      char.charCodeAt(0),
    );
    // ESTE CAMINHO GRAVAVA O PNG CRU, e é o que mais custa.
    //
    // A conversão foi escrita no `generate-module-image`, o caminho MANUAL, e
    // não chegou aqui — o toggle "Imagens com IA" do formulário completo não
    // passa por aquela função, tem este código próprio. Só que é por aqui que
    // nascem os cursos de oito, dez módulos: exatamente os que apertam o
    // orçamento de CPU da exportação.
    //
    // A extensão também deixou de sair do `mimeType` declarado: `paraJpeg` lê
    // os bytes. Cabeçalho e conteúdo discordam de vez em quando, e gravar pela
    // declaração põe a extensão errada no arquivo — defeito que só aparece na
    // hora em que o jsPDF recusa a imagem, exportações depois.
    const convertida = await paraJpeg(binary, "generate-course");
    return {
      ...convertida,
      alt: mediaBrief.alt_text || `Ilustração educacional: ${module.title}`,
    };
  } catch (error: any) {
    console.warn(
      `[generate-course] Image generation failed for module ${module.module_number}: ${error?.message || error}`,
    );
    return null;
  }
}

export async function gravarImagemDoModulo(params: {
  serviceClient: any;
  userId: string;
  moduleId: string;
  imagem: ImagemGerada;
}): Promise<void> {
  const { serviceClient, userId, moduleId, imagem } = params;
  const storagePath = `${userId}/module-${moduleId}.${imagem.ext}`;
  const { error: uploadError } = await serviceClient.storage
    .from("course-exports")
    .upload(storagePath, imagem.bytes, {
      contentType: imagem.mime,
      upsert: true,
    });
  if (uploadError) {
    console.warn(`[generate-course] Image upload failed: ${uploadError.message}`);
    return;
  }
  const { data: signedData, error: signedError } = await serviceClient.storage
    .from("course-exports")
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365);
  if (signedError || !signedData?.signedUrl) return;
  const { error: insertError } = await serviceClient
    .from("course_images")
    .insert({ module_id: moduleId, url: signedData.signedUrl, alt_text: imagem.alt });
  if (insertError) {
    console.warn(
      `[generate-course] course_images insert failed: ${insertError.message}`,
    );
  }
}

// Tempo típico observado de uma chamada de lição, em produção: 17 a 39 s.
// Abaixo disso o timeout é certo, e um timeout custa o orçamento inteiro sem
// entregar nada — pior que não tentar.
const LESSON_CALL_TYPICAL_MS = 32000;

// ═══════════════════════════════════════════════════════════════════════════
// AS LIÇÕES EM SÉRIE, ENQUANTO O RELÓGIO PERMITIR
//
// As lições de um módulo rodavam TODAS em paralelo, cada uma cega para o que as
// irmãs estavam escrevendo. No curso de precificação de 24/08 isso apareceu na
// página 27 contra a 30: o mesmo pão francês da mesma padaria, com custo
// variável de R$ 0,35 numa lição e R$ 0,55 na outra. O aluno calcula 56,25% de
// margem e três páginas depois lê 31,25%.
//
// Em série, cada lição recebe os valores que as anteriores fixaram — a mesma
// ponte que já existia entre módulos, agora dentro deles.
//
// O QUE OS LOGS DE 24/08 MOSTRARAM (5 módulos, 15 lições)
//
//   lição      mín 12,5 s   p50 17,9 s   máx 26,7 s
//   envelope   7,1 a 8,5 s
//   pós-lições 10,0 a 49,2 s  — o topo é reparo (33,2 s) + avaliação (15,5 s)
//   total hoje 32,5 a 79,5 s, em paralelo
//
// Serializado, o pior módulo medido dá 111,4 s: não cabia nos 110 s de antes,
// por 1,4 s. O que estoura não são as lições — é o reparo, que apareceu em 2 dos
// 5 módulos. Daí o orçamento ter subido para 125 s.
//
// A guarda existe para o módulo que vier pior que tudo isso: quando o relógio
// não comporta mais uma lição em série E ainda há duas ou mais pela frente, o
// resto vai em paralelo. Perde-se a coerência daquelas, não o módulo.
// ═══════════════════════════════════════════════════════════════════════════

/** p95 observado de uma lição, arredondado para cima. */
const LICAO_LENTA_MS = 28000;

/** O que precisa sobrar depois das lições: reparo, avaliação, gravação e o
 *  portão de qualidade. O topo medido foi 49,2 s. */
const RESERVA_POS_LICOES_MS = 55000;

export async function gerarLicoesEmSerieQuandoCabe<P, R>(
  planos: P[],
  gerar: (plano: P) => Promise<R>,
  msLeft: () => number,
  aoConcluir: (resultado: R) => void,
): Promise<R[]> {
  const resultados: R[] = [];
  let i = 0;
  for (; i < planos.length; i++) {
    const restantes = planos.length - i;
    // Com uma só pela frente não há paralelismo a ganhar: roda em série de
    // qualquer jeito, que ainda dá a coerência.
    if (restantes > 1 && msLeft() < RESERVA_POS_LICOES_MS + LICAO_LENTA_MS) {
      console.log(
        `[generate-course-module] restam ${Math.round(msLeft() / 1000)}s: as ${restantes} lições finais vão em paralelo`,
      );
      break;
    }
    const r = await gerar(planos[i]);
    resultados.push(r);
    if (r) aoConcluir(r);
  }
  if (i < planos.length) {
    const resto = await mapWithConcurrency(
      planos.slice(i),
      LESSON_CONCURRENCY,
      (plano) => gerar(plano),
    );
    resultados.push(...resto);
  }
  return resultados;
}

/** Todo o texto de uma lição, um trecho por parágrafo.
 *
 *  A leitura dos valores do caso procura o número na MESMA oração do rótulo, e
 *  trabalha parágrafo a parágrafo. A lição chega como JSON aninhado; juntar as
 *  strings com linha em branco entre elas dá a ela a forma que a leitura
 *  espera — colar tudo numa linha só faria o rótulo de um bloco encostar no
 *  número do bloco seguinte. */
export function textoDaLicao(licao: unknown): string {
  const partes: string[] = [];
  const visitar = (n: unknown) => {
    if (typeof n === "string") partes.push(n);
    else if (Array.isArray(n)) n.forEach(visitar);
    else if (n && typeof n === "object") Object.values(n).forEach(visitar);
  };
  visitar(licao);
  return partes.join("\n\n");
}

function lessonCallBudget(msLeft: number, reserveMs = 4000): number | null {
  const budget = msLeft - reserveMs;
  if (budget < LESSON_CALL_TYPICAL_MS) return null;
  return Math.min(75000, budget);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        try {
          results[index] = await worker(items[index], index);
        } catch (error: any) {
          console.error(
            `[generate-course] Item ${index + 1} falhou: ${error?.message || error}`,
          );
          results[index] = null as R;
        }
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function bestEffortCourseMetadata(
  serviceClient: any,
  courseId: string,
  blueprint: CourseBlueprint,
  status: string,
): Promise<void> {
  const payload = {
    generation_status: status,
    final_competency: blueprint.final_competency,
    skills_and_knowledge: blueprint.skills_and_knowledge,
    course_objectives: blueprint.course_objectives,
    generation_blueprint: blueprint,
    generation_build: GENERATE_COURSE_BUILD,
  };
  try {
    const { error } = await serviceClient
      .from("courses")
      .update(payload)
      .eq("id", courseId);
    if (error)
      console.log(
        `[generate-course] Optional course metadata columns unavailable: ${error.message}`,
      );
  } catch {
    // Backward-compatible: the current schema may not yet have these optional columns.
  }
}

async function bestEffortStatus(
  serviceClient: any,
  courseId: string,
  status: string,
  details?: unknown,
): Promise<void> {
  try {
    const { error } = await serviceClient
      .from("courses")
      .update({
        generation_status: status,
        generation_details: details ?? null,
      })
      .eq("id", courseId);
    if (error)
      console.log(
        `[generate-course] Optional generation_status unavailable: ${error.message}`,
      );
  } catch {
    // Optional columns; never block the legacy schema.
  }
}

async function bestEffortOpenQuestion(
  serviceClient: any,
  moduleId: string,
  openEnded: OpenEndedQuestion,
): Promise<void> {
  if (!openEnded.question) return;
  try {
    const { error } = await serviceClient.from("course_open_questions").insert({
      module_id: moduleId,
      question: openEnded.question,
      sample_answer: openEnded.sample_answer,
      criteria: openEnded.criteria,
      outcome_id: openEnded.outcome_id,
    });
    if (error)
      console.log(
        `[generate-course] Optional course_open_questions table unavailable: ${error.message}`,
      );
  } catch {
    // The open question is also embedded in Markdown, so no learning object is lost.
  }
}

async function bestEffortStructuredHierarchy(
  serviceClient: any,
  moduleId: string,
  blueprint: ModuleBlueprint,
  document: ModuleDocument,
): Promise<void> {
  try {
    const lessonRows = document.lessons.map((lesson, index) => ({
      module_id: moduleId,
      lesson_number: lesson.lesson_number,
      title: lesson.title,
      objective: lesson.objective,
      order_index: index,
      estimated_minutes: blueprint.lessons[index]?.estimated_minutes ?? null,
    }));
    const { data: savedLessons, error: lessonError } = await serviceClient
      .from("course_lessons")
      .insert(lessonRows)
      .select("id, order_index");
    if (lessonError || !savedLessons?.length) {
      if (lessonError)
        console.log(
          `[generate-course] Optional course_lessons table unavailable: ${lessonError.message}`,
        );
      return;
    }

    const lessonIdByIndex = new Map<number, string>(
      savedLessons.map((lesson: any) => [
        Number(lesson.order_index),
        String(lesson.id),
      ]),
    );
    const blockRows: Array<Record<string, unknown>> = [];
    document.lessons.forEach((lesson, lessonIndex) => {
      const lessonId = lessonIdByIndex.get(lessonIndex);
      if (!lessonId) return;
      lesson.blocks.forEach((block, blockIndex) => {
        blockRows.push({
          lesson_id: lessonId,
          block_type: block.type,
          heading: block.heading || null,
          content_json: block,
          order_index: blockIndex,
        });
      });
    });
    if (!blockRows.length) return;
    const { error: blockError } = await serviceClient
      .from("course_learning_blocks")
      .insert(blockRows);
    if (blockError)
      console.log(
        `[generate-course] Optional course_learning_blocks table unavailable: ${blockError.message}`,
      );
  } catch {
    // Markdown remains the canonical backward-compatible representation.
  }
}

// A meta de densidade precisa ser POR LIÇÃO, não por módulo.
//
// Cada lição é gerada numa chamada isolada, que não sabe o que as outras
// escreveram. Enquanto a meta era "800-1200 palavras no módulo completo", as
// três lições miravam o orçamento inteiro do módulo cada uma, por conta
// própria — daí a variação de 4,3× medida num curso real: 514 palavras na
// lição 1.1 contra 2.219 na 2.3, com o módulo 1 somando 3.745 para uma meta
// de 1.200.
//
// `words` (módulo) continua existindo para o texto de contexto do prompt, mas
// quem guia a escrita é `lessonWords`, e quem verifica é `lessonMinWords`.
function targetDepthProfile(value: unknown): {
  words: string;
  minWords: number;
  lessonWords: string;
  lessonMinWords: number;
  lessonMaxWords: number;
  label: string;
} {
  const profiles = {
    compact: {
      words: "500-700",
      minWords: 380,
      lessonWords: "350 a 550",
      lessonMinWords: 300,
      lessonMaxWords: 750,
      label: "conciso",
    },
    standard: {
      words: "800-1200",
      minWords: 600,
      // Calibrado com um curso real gerado sob a meta por lição: as 15 lições
      // ficaram entre 601 e 2.020 palavras, com média 1.176 — só 3 caíram na
      // faixa 600-900 e 6 passaram de 1.200. O piso de 450 se mostrou correto
      // (nenhuma lição ficou abaixo), mas o alvo estava otimista demais para
      // como o modelo realmente escreve. Alinhar a régua ao comportamento
      // observado vale mais que manter uma meta que só gera aviso ignorado.
      lessonWords: "800 a 1200",
      lessonMinWords: 450,
      lessonMaxWords: 1500,
      label: "equilibrado",
    },
    detailed: {
      words: "1300-1800",
      minWords: 900,
      lessonWords: "900 a 1300",
      lessonMinWords: 700,
      lessonMaxWords: 1700,
      label: "aprofundado",
    },
  } as const;
  return profiles[value as keyof typeof profiles] || profiles.standard;
}

function outcomeConfiguration(value: unknown): {
  key: string;
  capstone: CapstoneType;
  label: string;
  wantsCase: boolean;
} {
  const mapping: Record<
    string,
    { capstone: CapstoneType; label: string; wantsCase: boolean }
  > = {
    introducao: {
      capstone: "sintese",
      label: "introdução ao tema",
      wantsCase: false,
    },
    aplicacao: {
      capstone: "estudo_de_caso",
      label: "aplicação prática",
      wantsCase: true,
    },
    treinamento: {
      capstone: "projeto",
      label: "treinamento completo",
      wantsCase: true,
    },
    avaliacao: {
      capstone: "simulado",
      label: "preparação para avaliação",
      wantsCase: false,
    },
    plano_de_acao: {
      capstone: "plano_de_acao",
      label: "construção de plano de ação",
      wantsCase: true,
    },
  };
  const key =
    typeof value === "string" && mapping[value] ? value : "introducao";
  return { key, ...mapping[key] };
}

function buildStructureQuery(
  title: string,
  theme: string,
  targetAudience: string,
): string {
  return `${title} ${theme} ${targetAudience} objetivos competências processos critérios exemplos aplicação riscos decisões avaliação`;
}

function buildModuleSourceQuery(
  course: CourseBlueprint,
  module: ModuleBlueprint,
): string {
  return [
    course.course_title,
    module.title,
    module.summary,
    module.module_objective,
    ...module.lessons.flatMap((lesson) => [
      lesson.title,
      lesson.objective,
      ...lesson.source_focus_terms,
    ]),
  ].join(" ");
}

function courseQualitySummary(
  results: ModuleGenerationResult[],
  blueprint: CourseBlueprint,
  includeQuiz: boolean,
  includeFlashcards: boolean,
) {
  const objectiveCoverage = new Map<string, number>();
  for (const objective of blueprint.course_objectives)
    objectiveCoverage.set(objective.id, 0);
  for (const module of blueprint.modules) {
    for (const objectiveId of module.outcome_ids)
      objectiveCoverage.set(
        objectiveId,
        (objectiveCoverage.get(objectiveId) || 0) + 1,
      );
  }
  return {
    modules_expected: blueprint.modules.length,
    modules_saved: results.length,
    lessons_saved: results.reduce(
      (sum, result) => sum + result.document.lessons.length,
      0,
    ),
    objectives: blueprint.course_objectives.length,
    objectives_without_module: [...objectiveCoverage.entries()]
      .filter(([, count]) => count === 0)
      .map(([id]) => id),
    quizzes_expected: includeQuiz ? blueprint.modules.length : 0,
    quizzes_generated: results.filter(
      (result) => result.assessment?.multiple_choice.length === 3,
    ).length,
    flashcard_sets_expected: includeFlashcards ? blueprint.modules.length : 0,
    flashcard_sets_generated: results.filter(
      (result) => result.assessment?.flashcards.length === 5,
    ).length,
    warnings: results.flatMap((result) => result.warnings),
  };
}


export {
  ACTIVE_BLOCK_TYPES,
  buildActivityFromModule,
  ASSESSMENT_SCHEMA,
  BLOCKS_BY_PATTERN,
  BLOOM_POSITION,
  COURSE_BLUEPRINT_SCHEMA,
  EMPTY_ACTIVITY,
  EMPTY_CODE,
  EMPTY_EXAMPLE,
  EMPTY_SCENARIO,
  EMPTY_TABLE,
  ENABLE_PRO_REPAIR,
  FAST_MODEL,
  GENERATE_COURSE_BUILD,
  GENERIC_HEADINGS,
  IMAGE_MODEL,
  LESSON_CALL_TYPICAL_MS,
  LESSON_CONCURRENCY,
  LESSON_DOCUMENT_SCHEMA,
  MARKDOWN_PLACEHOLDER_PATTERNS,
  MAX_MODULE_SOURCE_CHARS,
  MAX_SOURCE_TOTAL_CHARS,
  MAX_STRUCTURE_SOURCE_CHARS,
  MODULE_CONCURRENCY,
  MODULE_ENVELOPE_SCHEMA,
  PLACEHOLDER_PATTERNS,
  PLAN_LIMITS,
  QUALITY_MODEL,
  RENDERER_LABEL_PATTERN,
  SOFT_DEADLINE_MS,
  STOPWORDS,
  TESTING_MODE,
  TEXT_MODEL_ALLOWLIST,
  asString,
  asStringArray,
  bestEffortCourseMetadata,
  bestEffortOpenQuestion,
  bestEffortStatus,
  bestEffortStructuredHierarchy,
  blockHasUsableContent,
  buildAssessmentPrompt,
  buildCaseDossier,
  buildModulePrompt,
  buildModuleRepairPrompt,
  buildModuleSourceQuery,
  buildPriorLearningContext,
  buildSourceIndex,
  buildStructurePrompt,
  buildStructureQuery,
  callAIInner,
  callAIJson,
  callAIText,
  chunkSourceDocuments,
  clampInt,
  containsLikelyUnsupportedNumber,
  corsHeaders,
  courseQualitySummary,
  deriveBlockTypes,
  detectDomainLeak,
  deterministicModuleRepair,
  ensureObjectiveCoverage,
  escapeTableCell,
  evidenceSupported,
  fetchWithTimeout,
  generateAssessment,
  getModelFallbacks,
  inferModuleRole,
  isPlaceholderText,
  lessonCallBudget,
  mapWithConcurrency,
  markdownHasPlaceholder,
  normalizeAssessment,
  normalizeBlockType,
  normalizeBlueprint,
  normalizeForMatch,
  normalizeLearningBlock,
  normalizeModuleDocument,
  normalizePlaceholderCheck,
  normalizeWhitespace,
  outcomeConfiguration,
  parseJsonLoose,
  renderAdditionalReadings,
  renderAppliedAssignment,
  renderBlock,
  renderBullets,
  renderCourseOverview,
  renderModuleMarkdown,
  renderOpenEndedAssessment,
  renderParagraphs,
  renderSourcePacket,
  renderTable,
  repairLesson,
  resolveTextModel,
  safeModel,
  sanitizeTitle,
  scoreChunk,
  selectSourceChunks,
  semanticMarker,
  stringArraySchema,
  stripLeadingOrdinal,
  stripMarkdown,
  targetDepthProfile,
  tokenize,
  uniqueStrings,
  validateAssessment,
  validateBlueprintSemantics,
  validateCourseForPublication,
  validateLearningBlock,
  validateModuleDocument,
  validateRawBlueprintCandidate,
  validateScenario,
  wcText,
  wordCount,
};

export type {
  AIMeta,
  ActivityData,
  ActivityTemplateRow,
  AdditionalReading,
  AppliedAssignment,
  AssessmentDocument,
  BlockType,
  BloomLevel,
  CanonicalTerm,
  CapstoneType,
  CardItem,
  CodeData,
  CourseBlueprint,
  CourseObjective,
  Flashcard,
  ItemPair,
  LearningBlock,
  LessonBlueprint,
  LessonDocument,
  LessonPattern,
  ModuleBlueprint,
  ModuleDocument,
  ModuleGenerationResult,
  ModuleRole,
  ModuleValidationResult,
  MultipleChoiceQuestion,
  OpenEndedQuestion,
  Plan,
  ReasoningEffort,
  RubricCriterion,
  ScenarioData,
  ScenarioOption,
  ScenarioTurn,
  SourceChunk,
  SourceDoc,
  StepItem,
  TableData,
  WorkedExampleData,
};
