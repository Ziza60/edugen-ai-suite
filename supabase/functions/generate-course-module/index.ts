import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeLineBreakTags } from "../_shared/markdown.ts";

import {
  buildModulePrompt,
  buildModuleRepairPrompt,
  buildModuleSourceQuery,
  buildSourceIndex,
  callAIJson,
  chunkSourceDocuments,
  deterministicModuleRepair,
  generateAssessment,
  gerarImagemDoModulo,
  gravarImagemDoModulo,
  type ImagemGerada,
  mapWithConcurrency,
  normalizeModuleDocument,
  renderModuleMarkdown,
  renderSourcePacket,
  repairLesson,
  selectSourceChunks,
  validateModuleDocument,
  asString,
  asStringArray,
  uniqueStrings,
  wordCount,
  renderOpenEndedAssessment,
  bestEffortOpenQuestion,
  bestEffortStructuredHierarchy,
  lessonCallBudget,
  targetDepthProfile,
  GENERATE_COURSE_BUILD,
  FAST_MODEL,
  LESSON_CONCURRENCY,
  MAX_MODULE_SOURCE_CHARS,
  MAX_SOURCE_TOTAL_CHARS,
  MODULE_ENVELOPE_SCHEMA,
  LESSON_DOCUMENT_SCHEMA,
  corsHeaders,
  valoresDoCasoCondutor,
  gerarLicoesEmSerieQuandoCabe,
  textoDaLicao,
} from "../_shared/course-pipeline.ts";
import type {
  CourseBlueprint,
  ModuleBlueprint,
  SourceChunk,
  SourceDoc,
  ValorCanonico,
} from "../_shared/course-pipeline.ts";
import { repairTruncation } from "../_shared/markdown.ts";
import { dispatchAll, elegiveis, secretsMatch } from "../_shared/course-dispatch.ts";

/**
 * Dispara o portão de qualidade para um curso recém-concluído.
 *
 * Invocação HTTP em vez de chamada direta a inspectCourse: o portão precisa
 * carregar TODOS os módulos do banco e gravar o laudo, e fazer isso aqui
 * consumiria o orçamento de tempo do worker — que já é o recurso escasso da
 * fase 2. Delegando, o worker só paga o custo da requisição.
 *
 * Nunca lança: o chamador está num `finally`, e uma exceção ali mascararia o
 * erro original da geração do módulo.
 */
async function runQualityGate(courseId: string): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    console.warn("[generate-course-module] Portão de qualidade sem credenciais; pulado.");
    return;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(`${url}/functions/v1/course-quality-gate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({ course_id: courseId }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      console.warn(
        `[generate-course-module] Portão de qualidade respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
      return;
    }
    const laudo = await res.json();
    console.log(
      JSON.stringify({
        event: "course-quality-gate-done",
        course_id: courseId,
        verdict: laudo?.verdict,
        structural_score: laudo?.structural_score,
        blockers: laudo?.blockers,
        warnings: laudo?.warnings,
      }),
    );
  } catch (err: any) {
    console.warn(
      `[generate-course-module] Portão de qualidade falhou: ${err?.message ?? err}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 2 — gera UM módulo por invocação.
//
// Esta função existe para que o tamanho do curso deixe de disputar espaço com o
// teto de wall clock. Uma invocação = um envelope + as lições do módulo em
// paralelo, e não cresce com o número de módulos.
//
// Os tempos que estavam escritos aqui — "~8 s" para o envelope, "~25 s" por
// lição, "~50 s no pior caso" — nunca foram medidos, e não batiam com a
// constante LESSON_CALL_TYPICAL_MS (32 s) usada logo abaixo para decidir se vale
// começar uma lição. O log de conclusão passou a trazer claim_ms, licoes_ms e
// total_ms para que o próximo ajuste venha de número real.
//
// Sobre o teto da plataforma: o que conta é a duração do WORKER — 150 s no plano
// gratuito, 400 s nos pagos —, e existe um limite separado de CPU (2 s no
// gratuito) que mede só computação ativa, sem I/O. Este worker fica quase todo
// em espera de rede, então o gargalo é o relógio de parede, não a CPU.
//
// Ela é chamada máquina-a-máquina: pela fase 1 logo após enfileirar, e pela
// rede de segurança quando um job fica parado. Chamar duas vezes é seguro —
// claim_course_generation_job decide no banco, atomicamente, quem fica com ele.
// ─────────────────────────────────────────────────────────────────────────────

// Orçamento próprio desta invocação. Só precisa cobrir UM módulo.
//
// Era 110 s, escolhido sem medição. Os logs de 24/08 mostraram que o pior
// módulo usava 79,5 s em paralelo — mas 111,4 s se as lições fossem em série,
// que é o que a coerência de valores exige. Não cabia por 1,4 s.
//
// 125 s dá 13,6 s de folga sobre esse pior caso e fica dentro da faixa que a
// própria Supabase recomenda para o plano gratuito. O teto da plataforma é a
// duração do WORKER — 150 s no gratuito, 400 s nos pagos —, e não o tempo da
// requisição: esta função responde 202 na hora e segue em EdgeRuntime.waitUntil,
// então o idle timeout de 150 s não a alcança. No plano pago haveria espaço para
// subir bem mais, e para isso basta a variável de ambiente.
const MODULE_DEADLINE_MS = Math.max(
  60000,
  Number(Deno.env.get("COURSE_MODULE_DEADLINE_MS") || "125000") || 125000,
);

// TETO DO REPARO, NÃO PREVISÃO DO REPARO
//
// Os 33 s vinham de reparos com effort=medium e 9.000 tokens, medidos em 24/08
// (17,6 a 36,8 s). Com effort=low e 12.000 tokens, os cinco reparos de 01/09
// custaram 14,5 / 16,1 / 16,9 / 21,8 / 22,2 s — máximo de 22,2 s, nenhum
// truncado. A guarda exigia 50 s de folga para um trabalho que custa 39 s, e no
// módulo 4 cancelou um reparo com 41,7 s disponíveis; o módulo saiu com dois
// headings placeholder que cabiam ser corrigidos.
//
// A mudança que importa não é o número: é que REPARO_TIPICO_MS agora também é
// passado como TIMEOUT do reparo. Antes ele só previa o custo, enquanto o
// reparo podia consumir msLeft()-3000 — até 70 s. Foi assim que o reparo de
// 36 s de 31/08 devorou a avaliação e a imagem do módulo 7. Uma constante que
// estima sem obrigar é a mesma classe de defeito que já apareceu tantas vezes
// aqui: um número que não olha aquilo que afirma medir.
//
// AVALIACAO_TIPICA_MS segue em 17 s: as seis avaliações de 01/09 custaram de
// 12,7 a 16,8 s.
const REPARO_TIPICO_MS = 25000;
const AVALIACAO_TIPICA_MS = 17000;

interface WorkerPayload {
  jobId: string;
  courseId: string;
  moduleIndex: number;
}

function jsonResponse(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// O QUE OS MÓDULOS ANTERIORES JÁ IMPRIMIRAM
//
// Cada módulo é gerado numa invocação separada desta função e não enxerga uma
// linha do texto dos anteriores. Foi assim que a apostila de estoque de 23/08
// calculou um Custo de Pedido de R$185,00 no módulo 2 e, doze páginas depois,
// usou "CP = R$ 50,00" para o mesmo armazém do mesmo dono.
//
// A ponte é uma leitura só, do que já está gravado em course_modules. Nunca
// lança: coerência é enriquecimento e não pode custar o módulo inteiro. Se a
// consulta falhar, o módulo sai como saía antes.
//
// A leitura dos valores NÃO passa mais pelo glossário do curso. A versão que
// passava propagou "Custo Variável: R$ 0,80" — um número de outro produto — para
// os módulos seguintes do curso de precificação de 24/08. Agora a leitura é
// ancorada no caso condutor e vive em `valores-do-caso.ts`, compartilhada com o
// portão de qualidade. O `blueprint` deixou de ser necessário aqui.
// ═══════════════════════════════════════════════════════════════════════════
async function lerValoresJaPublicados(
  serviceClient: any,
  courseId: string,
  moduleIndex: number,
): Promise<ValorCanonico[]> {
  if (moduleIndex <= 0) return [];

  try {
    const { data, error } = await serviceClient
      .from("course_modules")
      .select("order_index, content")
      .eq("course_id", courseId)
      .lt("order_index", moduleIndex)
      .order("order_index", { ascending: true });

    if (error) {
      console.log(`[generate-course-module] valores anteriores indisponíveis: ${error.message}`);
      return [];
    }

    // Os módulos vão em ordem, e a leitura fica com o valor da fonte mais
    // antiga — foi o que o aluno viu primeiro, e é dele que os seguintes não
    // podem divergir em silêncio.
    const valores = valoresDoCasoCondutor(
      (data ?? []).map((linha: any) => ({
        texto: String(linha?.content ?? ""),
        modulo: Number(linha?.order_index ?? 0) + 1,
      })),
    );
    // O QUE A PONTE INJETOU, E NÃO SÓ QUANTOS
    //
    // Esta linha só imprimia a contagem, e só quando havia pelo menos um valor.
    // As duas coisas custaram caro ao tentar auditar o curso 5ef3f2c1: sem os
    // rótulos não dava para dizer QUAIS números atravessaram, e o silêncio no
    // módulo 2 era ambíguo — podia ser ponte vazia ou linha fora da janela do
    // log exportado. Nenhum dos dois é verificável depois; o prompt não é
    // gravado em lugar nenhum.
    //
    // Agora imprime sempre, inclusive o zero, com rótulo, valor e módulo de
    // origem. O corte em 40 itens é para não estourar a linha de log num curso
    // com caso muito numérico — o total continua explícito antes dele.
    const LIMITE_NO_LOG = 40;
    const lista = valores
      .slice(0, LIMITE_NO_LOG)
      .map((v) => `${v.termo}=${v.valor} (m${v.modulo})`)
      .join(" | ");
    console.log(
      `[generate-course-module] módulo ${moduleIndex + 1}: ${valores.length} valores canônicos herdados` +
        (valores.length ? `: ${lista}` : "") +
        (valores.length > LIMITE_NO_LOG ? ` | … +${valores.length - LIMITE_NO_LOG}` : ""),
    );
    return valores;
  } catch (err) {
    console.log(`[generate-course-module] erro ao ler valores anteriores: ${err}`);
    return [];
  }
}

async function generateOneModule(params: {
  serviceClient: any;
  userId: string;
  courseId: string;
  blueprint: CourseBlueprint;
  module: ModuleBlueprint;
  moduleIndex: number;
  sourceChunks: SourceChunk[];
  settings: Record<string, any>;
  msLeft: () => number;
}): Promise<{
  warnings: string[];
  repairsApplied: number;
  words: number;
  /** Tempo do bloco das lições, para calibrar o orçamento com dado. */
  licoesMs: number;
}> {
  const {
    serviceClient,
    userId,
    courseId,
    blueprint,
    module,
    moduleIndex,
    sourceChunks,
    settings,
    msLeft,
  } = params;

  const language = asString(settings.language, "pt-BR");
  const tone = asString(settings.tone, "profissional, claro e acessível");
  const knowledgeLevel = asString(settings.knowledge_level, "básico");
  const includeQuiz = settings.include_quiz === true;
  const includeFlashcards = settings.include_flashcards === true;
  const includeImages = settings.include_images === true;
  const useSources = settings.use_sources === true;
  const depth = targetDepthProfile(settings.density);
  const numbersRule = asString(settings.numbers_rule);

  // O curso já existe: o worker escreve nele.
  const course = { id: courseId };
  const allSourceIndex = buildSourceIndex(sourceChunks);
  // A promessa da imagem, disparada logo após o envelope e esperada no fim.
  // `null` quando o curso não pede imagem ou quando o envelope não trouxe brief.
  let imagemEmVoo: Promise<ImagemGerada | null> | null = null;


  

  const moduleChunks = useSources
    ? selectSourceChunks(
        sourceChunks,
        buildModuleSourceQuery(blueprint, module),
        MAX_MODULE_SOURCE_CHARS,
        14,
        true,
      )
    : [];
  const moduleSourcePacket = renderSourcePacket(moduleChunks);
  const allowedSourceIds = moduleChunks.map((chunk) => chunk.id);
  const allowedSourceIdSet = new Set(allowedSourceIds);

  const valoresPublicados = await lerValoresJaPublicados(
    serviceClient,
    courseId,
    moduleIndex,
  );

  const modulePromptParams = {
    course: blueprint,
    module,
    moduleIndex,
    language,
    tone,
    knowledgeLevel,
    depthWords: depth.words,
    lessonWords: depth.lessonWords,
    useSources,
    sourcePacket: moduleSourcePacket,
    allowedSourceIds,
    numbersRule,
    valoresPublicados,
  };

  let rawDocument: any;
  let anyTruncated = false;
  let licoesMs = 0;
  const tAntesDoEnvelope = Date.now();
  try {
    const envelope = await callAIJson<any>(
      FAST_MODEL,
      buildModulePrompt({ ...modulePromptParams, part: "envelope" }),
      MODULE_ENVELOPE_SCHEMA,
      `module_${module.module_number}_envelope`,
      4000,
      "low",
      Math.min(45000, Math.max(15000, msLeft() - 4000)),
    );

    // A IMAGEM COMEÇA AQUI, E NÃO NO FIM.
    //
    // Ela nunca dependeu das lições: tudo de que precisa é o `media_brief`, e
    // ele vem neste envelope, pronto em cerca de 8 s. Enquanto era a última
    // coisa da fila, perdia para o reparo de lição — no curso de estoques de
    // 27/08, os módulos 4 e 6 saíram sem ilustração com 3 s e 11 s restantes,
    // e são exatamente os dois que precisaram de reparo (20,5 s e 35 s).
    //
    // Disparada aqui, ela corre em paralelo com as lições e tem ~110 s de
    // folga. Nenhum `await` agora: o que se guarda é a promessa, esperada lá no
    // fim, quando existe id de módulo para gravar.
    const briefDaImagem = envelope.value?.media_brief;
    if (includeImages && briefDaImagem?.generation_prompt) {
      imagemEmVoo = gerarImagemDoModulo({
        course: blueprint,
        module,
        mediaBrief: briefDaImagem,
      });
    }

    // Cada lição recebe os valores que as anteriores já fixaram. Fora do laço
    // porque a lista cresce a cada lição concluída. `textosDasLicoes` guarda o
    // texto bruto: quem identifica o caso condutor precisa ver TODAS as lições
    // juntas, não uma de cada vez — um nome citado numa lição só ainda não é o
    // caso do curso.
    const valoresDoModulo: ValorCanonico[] = [...valoresPublicados];
    const textosDasLicoes: Array<{ texto: string; modulo: number }> = [];

    const gerarLicao = async (lessonPlan: any) => {
      // Um orçamento menor que o tempo típico da chamada só produz
      // timeout: consome o que resta e não devolve nada. Nos logs
      // anteriores as lições levavam de 17 a 39 s e recebiam o piso
      // de 20 s, então morriam em série e ainda gastavam o tempo que
      // faltava aos módulos seguintes. Melhor não começar.
      const budget = lessonCallBudget(msLeft());
      if (budget === null) {
        console.warn(
          `[generate-course] Lição ${lessonPlan.lesson_number} não iniciada: restam ${Math.round(msLeft() / 1000)}s, insuficiente.`,
        );
        return null;
      }
      const { value, meta } = await callAIJson<any>(
        FAST_MODEL,
        buildModulePrompt({
          ...modulePromptParams,
          part: "lesson",
          lessonPlan,
          valoresPublicados: valoresDoModulo,
        }),
        LESSON_DOCUMENT_SCHEMA,
        `module_${module.module_number}_lesson_${lessonPlan.lesson_number}`,
        // "low" em vez de "medium": nos modelos 2.5 o raciocínio sai
        // do mesmo orçamento da resposta, e foi ele que truncou a
        // lição 1.3 em 9.000 tokens. Menos raciocínio, mais teto.
        depth.label === "aprofundado" ? 16000 : 12000,
        "low",
        budget,
      );
      if (meta.finishReason === "length") anyTruncated = true;
      return value;
    };

    const lessonResults = await gerarLicoesEmSerieQuandoCabe(
      module.lessons,
      gerarLicao,
      msLeft,
      (licao) => {
        // Relê o módulo inteiro a cada lição concluída, em vez de só a lição
        // nova: o caso condutor é identificado pelo nome que REAPARECE, e uma
        // lição isolada não tem como provar que um nome é o caso do curso. São
        // três ou quatro releituras de alguns milissegundos, contra uma lista
        // vazia se cada lição fosse lida sozinha.
        textosDasLicoes.push({
          texto: textoDaLicao(licao),
          modulo: module.module_number,
        });
        const jaTem = new Set(valoresPublicados.map((v) => v.termo));
        valoresDoModulo.length = 0;
        valoresDoModulo.push(...valoresPublicados);
        for (const achado of valoresDoCasoCondutor(textosDasLicoes)) {
          // O que os módulos anteriores publicaram tem precedência: o aluno já
          // viu aquele número impresso.
          if (!jaTem.has(achado.termo)) valoresDoModulo.push(achado);
        }
      },
    );

    licoesMs = Date.now() - tAntesDoEnvelope;
    rawDocument = { ...envelope.value, lessons: lessonResults };
  } catch (error: any) {
    throw new Error(
      `Falha ao gerar o módulo ${module.module_number}: ${error?.message || error}`,
    );
  }

  let document = normalizeModuleDocument(rawDocument, module);
  document = deterministicModuleRepair(
    document,
    module,
    allowedSourceIdSet,
    useSources,
  );
  let markdown = renderModuleMarkdown({
    course: blueprint,
    module,
    document,
    moduleIndex,
    sourceIndex: allSourceIndex,
    includeOverview: moduleIndex === 0,
    includeCapstoneExtras: module.role === "capstone",
  });
  if (anyTruncated) markdown = repairTruncation(markdown);

  let validation = validateModuleDocument({
    course: blueprint,
    blueprint: module,
    document,
    markdown,
    sourcePacket: moduleSourcePacket,
    allowedSourceIds: allowedSourceIdSet,
    useSources,
    targetMinWords: depth.lessonMinWords * module.lessons.length,
            lessonMinWords: depth.lessonMinWords,
            lessonMaxWords: depth.lessonMaxWords,
  });

  // ── Per-lesson repair (spec item 6) ───────────────────────────────────
  // Only attempt if there are repairable issues and enough time remains.
  let repairsApplied = 0;
  // As notas do reparo precisam sobreviver à revalidação. Antes não sobreviviam:
  // "Reparo cancelado por timeout", "Reparo da lição X falhou" e "Reparo de
  // envelope falhou" eram empilhadas em `validation.warnings` e apagadas na
  // linha em que `validation` é reatribuída logo abaixo. Foi por isso que o
  // curso de 31/08 registrou `repairs:1` no módulo 4 e `repairs:2` no módulo 8
  // sem que nenhum desses reparos tivesse acontecido: os dois foram cancelados
  // pela guarda de tempo e o cancelamento não deixou rastro em lugar nenhum.
  const notasDoReparo: string[] = [];
  if (validation.repairable.length > 0 && msLeft() > 25000) {


    // Group repairable issues by lesson_number
    const issuesByLesson = new Map<string, string[]>();
    for (const issue of validation.repairable) {
      const match = issue.match(/^Lição ([^\s:]+)/);
      const key = match ? match[1] : "__envelope__";
      if (!issuesByLesson.has(key)) issuesByLesson.set(key, []);
      issuesByLesson.get(key)!.push(issue);
    }

    // Repair envelope-level issues (bridge / checkpoint / takeaways)
    const envelopeIssues = issuesByLesson.get("__envelope__") || [];
    if (envelopeIssues.length && msLeft() > 20000) {
      try {
        const envPrompt = buildModuleRepairPrompt({
          course: blueprint,
          blueprint: module,
          document,
          issues: envelopeIssues,
          language,
          useSources,
          sourcePacket: moduleSourcePacket,
          allowedSourceIds,
          numbersRule,
        });
        const envRepaired = await callAIJson<any>(
          FAST_MODEL, envPrompt, MODULE_ENVELOPE_SCHEMA,
          `module_${module.module_number}_env_repair`,
          4000, "medium",
          Math.min(45000, Math.max(12000, msLeft() - 3000)),
        );
        document = {
          ...document,
          opening_bridge: asString(envRepaired.value?.opening_bridge, document.opening_bridge),
          checkpoint: asString(envRepaired.value?.checkpoint, document.checkpoint),
          key_takeaways: (envRepaired.value?.key_takeaways?.length >= 3)
            ? uniqueStrings(asStringArray(envRepaired.value.key_takeaways, 6), 6)
            : document.key_takeaways,
        };
        repairsApplied += 1;
      } catch (envErr: any) {
        notasDoReparo.push(`Reparo de envelope falhou: ${envErr?.message || envErr}`);
      }
    }

    // Repair each lesson that has issues (max 1 repair per lesson)
    const lessonIssueEntries = [...issuesByLesson.entries()].filter(([k]) => k !== "__envelope__");
    for (const [lessonNum, lessonIssues] of lessonIssueEntries) {
      // O REPARO PRECISA CABER, E A AVALIAÇÃO PRECISA SOBREVIVER A ELE
      //
      // A guarda era 18 s, e os reparos medidos em 24/08 custaram de 17,6 a
      // 36,8 s: ela autorizava um reparo com metade do que ele cobra. No módulo
      // 5 do curso de precificação foram DOIS seguidos, 68,4 s somados, e o
      // worker foi a 143,4 s contra os 125 s do orçamento.
      //
      // Exige o custo de um reparo MAIS o da avaliação, que vem depois e é o
      // que o aluno vê como quiz. Melhor um reparo e um quiz do que dois
      // reparos e nenhum quiz. Em 01/09 os dois cancelamentos foram lidos no
      // log: o módulo 7, com 33,6 s restantes, não tinha mesmo como pagar os
      // dois; o módulo 4, com 41,7 s, tinha — e é por isso que a reserva caiu
      // de 50 s para 42 s, agora que REPARO_TIPICO_MS é teto e não previsão.
      if (msLeft() < REPARO_TIPICO_MS + AVALIACAO_TIPICA_MS) {
        notasDoReparo.push(`Reparo cancelado por timeout antes de lição ${lessonNum}.`);
        break;
      }
      const lessonIndex2 = document.lessons.findIndex((l) => l.lesson_number === lessonNum);
      if (lessonIndex2 < 0) continue;
      const lessonPlan = module.lessons[lessonIndex2];
      if (!lessonPlan) continue;
      try {
        const repaired = await repairLesson({
          course: blueprint,
          module,
          lessonPlan,
          lessonIndex: lessonIndex2,
          currentLesson: document.lessons[lessonIndex2],
          issues: lessonIssues,
          sourcePacket: moduleSourcePacket,
          allowedSourceIds,
          language,
          useSources,
          numbersRule,
          // Mesmo orçamento da geração original da lição (linha 379). Pedir a
          // lição inteira de volta com menos tokens do que custou escrevê-la é
          // o que truncava o reparo.
          maxTokens: depth.label === "aprofundado" ? 16000 : 12000,
          lessonMinWords: depth.lessonMinWords,
          lessonMaxWords: depth.lessonMaxWords,
          tempoMaximoMs: REPARO_TIPICO_MS,
          msLeft,
        });
        repairsApplied += 1;
        if (repaired.aceito) {
          document = {
            ...document,
            lessons: document.lessons.map((l, i) => i === lessonIndex2 ? repaired.lesson : l),
          };
        }
        console.log(
          `[generate-course] Reparo da lição ${lessonNum}: ${repaired.aceito ? "aceito" : "recusado"} — ${repaired.motivo} (${repaired.antes}→${repaired.depois}).`,
        );
        if (!repaired.aceito) {
          notasDoReparo.push(`Reparo da lição ${lessonNum} recusado: ${repaired.motivo}.`);
        }
      } catch (lessonErr: any) {
        notasDoReparo.push(`Reparo da lição ${lessonNum} falhou: ${lessonErr?.message || lessonErr}`);
      }
    }

    // Re-render markdown with repaired document
    markdown = renderModuleMarkdown({
      course: blueprint,
      module,
      document,
      moduleIndex,
      sourceIndex: allSourceIndex,
      includeOverview: moduleIndex === 0,
      includeCapstoneExtras: module.role === "capstone",
    });

    // Re-validate (single pass; no further repair)
    validation = validateModuleDocument({
      course: blueprint,
      blueprint: module,
      document,
      markdown,
      sourcePacket: moduleSourcePacket,
      allowedSourceIds: allowedSourceIdSet,
      useSources,
      targetMinWords: depth.lessonMinWords * module.lessons.length,
            lessonMinWords: depth.lessonMinWords,
            lessonMaxWords: depth.lessonMaxWords,
    });
    validation.warnings.push(...notasDoReparo);
  }

  if (validation.blocking.length) {
    throw new Error(
      `Módulo ${module.module_number} sem conteúdo entregável: ${validation.blocking.join(" | ")}`,
    );
  }
  const qualityNotes = [
    ...validation.repairable,
    ...validation.warnings,
  ];
  if (qualityNotes.length) {
    console.warn(
      `[generate-course] Módulo ${module.module_number} entregue com ressalvas: ${qualityNotes.join(" | ")}`,
    );
  }

  // Assessment time guard — spec item 14
  let assessment: Awaited<ReturnType<typeof generateAssessment>> = null;
  if ((includeQuiz || includeFlashcards) && msLeft() < 15000) {
    validation.warnings.push("Avaliação ignorada: tempo restante insuficiente (<15s); marcar needs_review.");
  } else {
    assessment = await generateAssessment({
      course: blueprint,
      module,
      markdown,
      language,
      includeQuiz,
      includeFlashcards,
      msLeft,
    });
  }
  if ((includeQuiz || includeFlashcards) && !assessment) {
    validation.warnings.push(
      "Avaliação não gerada dentro do prazo; módulo entregue sem quiz/flashcards.",
    );
  }

  const openEndedMarkdown =
    assessment && includeQuiz
      ? renderOpenEndedAssessment(assessment.open_ended)
      : "";
  // `openEndedMarkdown` é texto do modelo e entra DEPOIS da limpeza que o
  // renderizador faz — sem esta passada, um `<br>` na resposta-modelo chegaria
  // ao banco e sairia impresso no PDF. Aplicar no conteúdo final cobre as duas
  // metades; a função é idempotente.
  const finalContent = normalizeLineBreakTags(
    [markdown, openEndedMarkdown].filter(Boolean).join("\n\n").trim(),
  );
  const { data: moduleData, error: moduleError } = await serviceClient
    .from("course_modules")
    .insert({
      course_id: course.id,
      title: module.title,
      content: finalContent,
      order_index: moduleIndex,
    })
    .select()
    .single();
  if (moduleError) throw moduleError;

  await bestEffortStructuredHierarchy(
    serviceClient,
    moduleData.id,
    module,
    document,
  );

  if (assessment) {
    if (includeQuiz) {
      const quizRows = assessment.multiple_choice.map((question) => ({
        module_id: moduleData.id,
        question: question.question,
        options: question.options,
        correct_answer: question.correct,
        explanation: question.explanation,
      }));
      const { error: quizError } = await serviceClient
        .from("course_quiz_questions")
        .insert(quizRows);
      if (quizError)
        throw new Error(
          `Falha ao salvar quiz do módulo ${module.module_number}: ${quizError.message}`,
        );
      await bestEffortOpenQuestion(
        serviceClient,
        moduleData.id,
        assessment.open_ended,
      );
    }
    if (includeFlashcards) {
      const flashcardRows = assessment.flashcards.map((card) => ({
        module_id: moduleData.id,
        front: card.front,
        back: card.back,
      }));
      const { error: flashcardError } = await serviceClient
        .from("course_flashcards")
        .insert(flashcardRows);
      if (flashcardError)
        throw new Error(
          `Falha ao salvar flashcards do módulo ${module.module_number}: ${flashcardError.message}`,
        );
    }
  }

  const result = {
    moduleData,
    document,
    markdown: finalContent,
    assessment,
    warnings: validation.warnings,
    repairsApplied,
  };
  // A imagem é AGUARDADA aqui, não empurrada para outro waitUntil.
  //
  // Antes esta função registrava um segundo EdgeRuntime.waitUntil de dentro de
  // um trabalho que JÁ rodava sob waitUntil — aninhamento que o runtime não
  // garante. O worker respondia, marcava o job como done e era encerrado com a
  // geração de imagem ainda em voo. Num curso de 5 módulos, só 1 imagem
  // sobreviveu.
  //
  // O que mudou é QUANDO ela começa: a chamada ao Gemini foi disparada logo
  // depois do envelope e a esta altura já está pronta ou quase. O que sobra
  // aqui é o upload e o insert, que custam segundos, não dezenas deles — por
  // isso a folga exigida caiu de 20 s para 8 s. Sem folga nem para isso, o
  // módulo é entregue sem imagem: perder a ilustração é muito melhor que
  // perder o módulo.
  if (imagemEmVoo) {
    // IMAGEM PRONTA NÃO SE JOGA FORA.
    //
    // O piso de 8 s no orçamento descartava imagem JÁ GERADA. Nos logs de
    // 31/08, os módulos 6 e 7 fecharam com 3 s restantes e perderam a
    // ilustração — só que, com a geração disparada logo após o envelope, ela
    // estava pronta na memória havia mais de um minuto. Gastou crédito de
    // imagem e não gravou nada.
    //
    // O que resta ali é upload e insert, um a dois segundos. E o orçamento de
    // 125 s é NOSSO, não da plataforma: o worker tem 150 s no plano gratuito,
    // então `msLeft() === 3000` ainda significa mais de 20 s de folga real.
    //
    // Então a espera passa a ser pela imagem, e não pela gravação: espera-se
    // enquanto houver orçamento; se ela chegou, grava-se sempre. O que se
    // recusa é ficar parado esperando uma imagem que ainda não veio.
    const margemParaGravar = 5000;
    const esperaMaxima = Math.max(0, msLeft() - margemParaGravar);
    try {
      const imagem = await Promise.race([
        imagemEmVoo,
        new Promise<null>((r) => setTimeout(() => r(null), esperaMaxima)),
      ]);
      if (imagem) {
        await gravarImagemDoModulo({
          serviceClient,
          userId,
          moduleId: moduleData.id,
          imagem,
        });
      } else {
        console.warn(
          `[generate-course-module] Módulo ${module.module_number} entregue sem imagem: ela não ficou pronta em ${Math.round(esperaMaxima / 1000)}s.`,
        );
      }
    } catch (err: any) {
      console.warn(
        `[generate-course-module] Imagem do módulo ${module.module_number} falhou: ${err?.message ?? err}`,
      );
    }
  }

  return {
    warnings: result.warnings,
    repairsApplied: result.repairsApplied,
    words: wordCount(result.markdown),
    licoesMs,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: "Variáveis do Supabase não configuradas." });
  }

  // Chamada máquina-a-máquina. verify_jwt está desligado nesta função, então a
  // verificação é feita aqui, contra a service role key.
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!secretsMatch(bearer, serviceRoleKey)) {
    return jsonResponse(401, { error: "Não autorizado." });
  }

  let payload: WorkerPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "Corpo inválido." });
  }
  if (!payload?.jobId || !payload?.courseId || typeof payload.moduleIndex !== "number") {
    return jsonResponse(400, { error: "jobId, courseId e moduleIndex são obrigatórios." });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // ═══════════════════════════════════════════════════════════════════════
  // OS MARCOS DE TEMPO
  //
  // O orçamento desta função (MODULE_DEADLINE_MS) foi calibrado por hábito,
  // não por medição — e as duas estimativas que existiam no código para o
  // tempo de uma lição não batiam entre si: um comentário dizia ~25 s e a
  // constante LESSON_CALL_TYPICAL_MS diz 32 s.
  //
  // A dúvida prática é se dá para SERIALIZAR as lições do módulo (cada uma
  // vendo os valores que as anteriores fixaram, para o curso parar de se
  // contradizer) sem estourar o teto de wall clock. Com 25 s por lição cabe;
  // com 32 s não cabe. Nenhum dos dois números foi medido.
  //
  // Estes marcos existem para responder isso com dado. Também separam o que
  // acontece ANTES do relógio de orçamento começar — o claim no Postgres — do
  // que ele já cobre, porque o teto da plataforma conta a vida do worker, e o
  // claim está dentro dela.
  // ═══════════════════════════════════════════════════════════════════════
  const tEntrada = Date.now();
  const { data: claimed, error: claimError } = await serviceClient
    .rpc("claim_course_generation_job", { p_job_id: payload.jobId })
    .maybeSingle();
  if (claimError) {
    console.error(`[generate-course-module] claim falhou: ${claimError.message}`);
    return jsonResponse(500, { error: claimError.message });
  }
  if (!claimed) {
    // Já reivindicado por outro despacho, já concluído, ou sem tentativas
    // restantes. Nada a fazer — e não é erro.
    return jsonResponse(409, { skipped: true, jobId: payload.jobId });
  }

  const startedAt = Date.now();
  const msLeft = () => MODULE_DEADLINE_MS - (Date.now() - startedAt);

  const work = (async () => {
    try {
      const { data: courseRow, error: courseError } = await serviceClient
        .from("courses")
        .select("id, user_id, generation_blueprint, generation_params")
        .eq("id", payload.courseId)
        .single();
      if (courseError) throw courseError;

      const blueprint = courseRow.generation_blueprint as CourseBlueprint | null;
      if (!blueprint?.modules?.length) {
        throw new Error("Blueprint ausente no curso; a fase 1 não concluiu.");
      }
      const module = blueprint.modules[payload.moduleIndex];
      if (!module) {
        throw new Error(`Módulo ${payload.moduleIndex} não existe no blueprint.`);
      }
      const settings = (courseRow.generation_params || {}) as Record<string, any>;

      // As fontes são re-fatiadas aqui: o chunking é determinístico, então os
      // IDs (S1:C0, S1:C1…) são idênticos aos da fase 1.
      let sourceChunks: SourceChunk[] = [];
      if (settings.use_sources === true) {
        const { data: sources } = await serviceClient
          .from("course_sources")
          .select("filename, extracted_text")
          .eq("course_id", payload.courseId)
          .eq("user_id", courseRow.user_id);
        const docs: SourceDoc[] = [];
        let total = 0;
        (sources || []).forEach((row: any, index: number) => {
          const text = asString(row?.extracted_text);
          if (text.length < 100) return;
          const remaining = Math.max(0, MAX_SOURCE_TOTAL_CHARS - total);
          if (!remaining) return;
          const clipped = text.slice(0, remaining);
          docs.push({
            sourceIndex: index + 1,
            filename: asString(row?.filename, `Fonte ${index + 1}`),
            text: clipped,
          });
          total += clipped.length;
        });
        sourceChunks = chunkSourceDocuments(docs);
      }

      const outcome = await generateOneModule({
        serviceClient,
        userId: courseRow.user_id,
        courseId: payload.courseId,
        blueprint,
        module,
        moduleIndex: payload.moduleIndex,
        sourceChunks,
        settings,
        msLeft,
      });

      await serviceClient
        .from("course_generation_jobs")
        .update({
          status: "done",
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", payload.jobId);

      console.log(
        JSON.stringify({
          event: "course-module-done",
          build: GENERATE_COURSE_BUILD,
          course_id: payload.courseId,
          module_index: payload.moduleIndex,
          words: outcome.words,
          warnings: outcome.warnings.length,
          repairs: outcome.repairsApplied,
          elapsed_ms: Date.now() - startedAt,
          // Os marcos, em ms desde a entrada do handler. `claim_ms` é o tempo
          // que o RPC de reivindicação consome antes de o orçamento começar a
          // contar; `total_ms` é a vida do worker, que é o que o teto da
          // plataforma mede.
          claim_ms: startedAt - tEntrada,
          licoes_ms: outcome.licoesMs,
          total_ms: Date.now() - tEntrada,
          orcamento_ms: MODULE_DEADLINE_MS,
        }),
      );
    } catch (error: any) {
      const message = error?.message || String(error);
      console.error(
        `[generate-course-module] Módulo ${payload.moduleIndex} falhou: ${message}`,
      );
      // Volta para 'pending' enquanto houver tentativa sobrando, para que a rede
      // de segurança repesque; só vira 'failed' quando esgotam.
      const { data: current } = await serviceClient
        .from("course_generation_jobs")
        .select("attempts")
        .eq("id", payload.jobId)
        .maybeSingle();
      const exhausted = (current?.attempts ?? 3) >= 3;
      await serviceClient
        .from("course_generation_jobs")
        .update({
          status: exhausted ? "failed" : "pending",
          last_error: message.slice(0, 2000),
          finished_at: exhausted ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.jobId);
    } finally {
      await serviceClient.rpc("refresh_course_generation_progress", {
        p_course_id: payload.courseId,
      });

      // QUEM ABRE A PORTA PARA O PRÓXIMO É QUEM ACABOU DE FECHAR A SUA.
      //
      // Os dois primeiros módulos vão em ordem para que a ponte de valores
      // encontre o que procura — ela lê `order_index < meu` no banco, e só há o
      // que ler se o anterior já gravou. Ver MODULOS_EM_SERIE.
      //
      // Best-effort: se este despacho falhar, a varredura de jobs parados chega
      // à mesma conclusão pela fila. Por isso um erro aqui é registrado e
      // engolido — deixar a exceção subir mascararia o resultado do módulo.
      try {
        const { data: fila } = await serviceClient
          .from("course_generation_jobs")
          .select("id, course_id, module_index, status, attempts")
          .eq("course_id", payload.courseId);
        const pendentes = (fila ?? []).filter(
          (j: any) => j.status === "pending" && (j.attempts ?? 0) < 3,
        );
        const liberados = elegiveis(
          pendentes as Array<{ id: string; course_id: string; module_index: number; status: string }>,
          (fila ?? []) as Array<{ module_index: number; status: string }>,
        );
        if (liberados.length) {
          const r = await dispatchAll({
            supabaseUrl,
            serviceRoleKey,
            jobs: liberados.map((j: any) => ({
              id: j.id, course_id: j.course_id, module_index: j.module_index,
            })),
          });
          console.log(
            `[generate-course-module] Módulo ${payload.moduleIndex} liberou ${r.dispatched} módulo(s).`,
          );
        }
      } catch (err: any) {
        console.warn(
          `[generate-course-module] Despacho seguinte falhou (a varredura retoma): ${err?.message ?? err}`,
        );
      }
      // Portão de qualidade: roda uma única vez, quando o último módulo fecha.
      //
      // A checagem de "sou o último?" é feita no banco, e não por contagem
      // local, porque os módulos rodam em invocações concorrentes — cada worker
      // só enxerga o próprio job. Quem vê a fila inteira é o banco.
      //
      // Best-effort de ponta a ponta: se o portão não puder rodar, o curso
      // continua entregue com o status que a geração já definiu. Um controle de
      // qualidade que bloqueia a entrega quando ele mesmo falha é pior que
      // nenhum.
      try {
        const { count: restantes } = await serviceClient
          .from("course_generation_jobs")
          .select("id", { count: "exact", head: true })
          .eq("course_id", payload.courseId)
          .in("status", ["pending", "running"]);
        if ((restantes ?? 0) === 0) {
          await runQualityGate(payload.courseId);
        }
      } catch (err: any) {
        console.warn(
          `[generate-course-module] Portão de qualidade não executado: ${err?.message ?? err}`,
        );
      }
    }
  })();

  const waitUntil = (globalThis as any).EdgeRuntime?.waitUntil;
  if (typeof waitUntil === "function") {
    waitUntil.call((globalThis as any).EdgeRuntime, work);
  } else {
    void work;
  }

  // Responde imediatamente: quem despachou não espera a geração.
  return jsonResponse(202, {
    accepted: true,
    jobId: payload.jobId,
    moduleIndex: payload.moduleIndex,
  });
});
