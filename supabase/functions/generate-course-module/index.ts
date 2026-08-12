import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  buildModulePrompt,
  buildModuleRepairPrompt,
  buildModuleSourceQuery,
  buildSourceIndex,
  callAIJson,
  chunkSourceDocuments,
  deterministicModuleRepair,
  generateAssessment,
  generateModuleImage,
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
} from "../_shared/course-pipeline.ts";
import type {
  CourseBlueprint,
  ModuleBlueprint,
  SourceChunk,
  SourceDoc,
} from "../_shared/course-pipeline.ts";
import { repairTruncation } from "../_shared/markdown.ts";
import { secretsMatch } from "../_shared/course-dispatch.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Fase 2 — gera UM módulo por invocação.
//
// Esta função existe para que o tamanho do curso deixe de disputar espaço com o
// teto de wall clock. Uma invocação = um envelope (~8 s) + as lições do módulo
// em paralelo (~25 s cada). Fica em torno de 50 s no pior caso observado, bem
// abaixo dos 150 s do plano gratuito, e não cresce com o número de módulos.
//
// Ela é chamada máquina-a-máquina: pela fase 1 logo após enfileirar, e pela
// rede de segurança quando um job fica parado. Chamar duas vezes é seguro —
// claim_course_generation_job decide no banco, atomicamente, quem fica com ele.
// ─────────────────────────────────────────────────────────────────────────────

// Orçamento próprio desta invocação. Só precisa cobrir UM módulo, então é bem
// mais folgado que o antigo prazo do curso inteiro.
const MODULE_DEADLINE_MS = Math.max(
  60000,
  Number(Deno.env.get("COURSE_MODULE_DEADLINE_MS") || "110000") || 110000,
);

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
}): Promise<{ warnings: string[]; repairsApplied: number; words: number }> {
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
  const imageTasks: Promise<void>[] = [];


  

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
  };

  let rawDocument: any;
  let anyTruncated = false;
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

    const lessonResults = await mapWithConcurrency(
      module.lessons,
      LESSON_CONCURRENCY,
      async (lessonPlan) => {
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
      },
    );

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
      } catch (envErr: any) {
        validation.warnings.push(`Reparo de envelope falhou: ${envErr?.message || envErr}`);
      }
    }

    // Repair each lesson that has issues (max 1 repair per lesson)
    const lessonIssueEntries = [...issuesByLesson.entries()].filter(([k]) => k !== "__envelope__");
    repairsApplied = (envelopeIssues.length > 0 ? 1 : 0) + lessonIssueEntries.length;
    for (const [lessonNum, lessonIssues] of lessonIssueEntries) {
      if (msLeft() < 18000) {
        validation.warnings.push(`Reparo cancelado por timeout antes de lição ${lessonNum}.`);
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
          currentLesson: document.lessons[lessonIndex2],
          issues: lessonIssues,
          sourcePacket: moduleSourcePacket,
          allowedSourceIds,
          language,
          useSources,
          numbersRule,
          maxTokens: depth.label === "aprofundado" ? 12000 : 9000,
          msLeft,
        });
        document = {
          ...document,
          lessons: document.lessons.map((l, i) => i === lessonIndex2 ? repaired : l),
        };
      } catch (lessonErr: any) {
        validation.warnings.push(`Reparo da lição ${lessonNum} falhou: ${lessonErr?.message || lessonErr}`);
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
  const finalContent = [markdown, openEndedMarkdown]
    .filter(Boolean)
    .join("\n\n")
    .trim();
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

  if (includeImages) {
    const task = generateModuleImage({
      serviceClient,
      userId,
      moduleId: moduleData.id,
      course: blueprint,
      module,
      document,
    });
    imageTasks.push(task);
  }

  
  const result = {
    moduleData,
    document,
    markdown: finalContent,
    assessment,
    warnings: validation.warnings,
    repairsApplied,
  };
  // As imagens são AGUARDADAS aqui, não empurradas para outro waitUntil.
  //
  // Antes esta função registrava um segundo EdgeRuntime.waitUntil de dentro de
  // um trabalho que JÁ rodava sob waitUntil — aninhamento que o runtime não
  // garante. O worker respondia, marcava o job como done e era encerrado com a
  // geração de imagem ainda em voo. Num curso de 5 módulos, só 1 imagem
  // sobreviveu.
  //
  // Esperar aqui é seguro: o orçamento do worker cobre um módulo só (~50 s de
  // ~110 s) e a chamada de imagem tem timeout próprio de 65 s. Sem folga, o
  // módulo é entregue sem imagem — perder a ilustração é muito melhor que
  // perder o módulo.
  if (imageTasks.length) {
    if (msLeft() > 20000) {
      const settled = await Promise.allSettled(imageTasks);
      const falhas = settled.filter((r) => r.status === "rejected").length;
      if (falhas) {
        console.warn(
          `[generate-course-module] ${falhas}/${imageTasks.length} imagem(ns) falharam no módulo ${module.module_number}.`,
        );
      }
    } else {
      console.warn(
        `[generate-course-module] Módulo ${module.module_number} entregue sem imagem: restam ${Math.round(msLeft() / 1000)}s.`,
      );
    }
  }

  return {
    warnings: result.warnings,
    repairsApplied: result.repairsApplied,
    words: wordCount(result.markdown),
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

  // Reivindicação ANTES de responder: é isto que impede dois despachos de
  // gerarem o mesmo módulo duas vezes.
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
