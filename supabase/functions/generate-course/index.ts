import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { limparAutoelogio } from "../_shared/course-description.ts";

import {
  asString,
  buildStructurePrompt,
  buildStructureQuery,
  callAIJson,
  chunkSourceDocuments,
  clampInt,
  corsHeaders,
  ensureObjectiveCoverage,
  normalizeBlueprint,
  outcomeConfiguration,
  renderSourcePacket,
  sanitizeTitle,
  selectSourceChunks,
  targetDepthProfile,
  validateBlueprintSemantics,
  validateRawBlueprintCandidate,
  COURSE_BLUEPRINT_SCHEMA,
  FAST_MODEL,
  GENERATE_COURSE_BUILD,
  IMAGE_MODEL,
  MAX_SOURCE_TOTAL_CHARS,
  MAX_STRUCTURE_SOURCE_CHARS,
  PLAN_LIMITS,
  QUALITY_MODEL,
  SOFT_DEADLINE_MS,
  TESTING_MODE,
} from "../_shared/course-pipeline.ts";
import type { CourseBlueprint, Plan, SourceChunk, SourceDoc } from "../_shared/course-pipeline.ts";
import { dispatchAll, elegiveis } from "../_shared/course-dispatch.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Fase 1 — planeja o curso e enfileira os módulos.
//
// Esta função NÃO gera conteúdo de módulo. Ela autentica, aplica os limites do
// plano, produz e valida o blueprint, cria a linha do curso e enfileira um job
// por módulo — depois despacha os workers e devolve o controle.
//
// Antes, tudo isso acontecia numa invocação só, e um curso de 5 módulos batia
// nos 150 s de wall clock da Edge Function. Agora esta invocação custa ~40 s
// independentemente do tamanho do curso: quem cresce é o número de jobs.
//
// O SSE foi mantido para não quebrar o cliente atual, mas fecha em segundos.
// O acompanhamento da geração passou a ser feito por course_generation_jobs,
// via Realtime ou polling.
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });

  const sendSSE = (data: Record<string, unknown>) => {
    try {
      controller?.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      // Client disconnected or stream closed.
    }
  };

  const closeSSE = () => {
    try {
      (
        controller as ReadableStreamDefaultController<Uint8Array> | null
      )?.close();
    } catch {
      // Stream was already closed or the client disconnected.
    }
  };

  const sseHeaders = {
    ...corsHeaders,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };

  const processingTask = (async () => {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let serviceClient: any = null;
    let createdCourseId = "";
    try {
      heartbeat = setInterval(
        () => sendSSE({ type: "heartbeat", build: GENERATE_COURSE_BUILD }),
        12000,
      );
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) throw new Error("Not authenticated");

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (!supabaseUrl || !serviceRoleKey || !anonKey)
        throw new Error("Variáveis do Supabase não configuradas.");

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      serviceClient = createClient(supabaseUrl, serviceRoleKey);
      const token = authHeader.replace(/^Bearer\s+/i, "");
      const { data: claimsData, error: claimsError } =
        await userClient.auth.getClaims(token);
      if (claimsError || !claimsData?.claims?.sub)
        throw new Error("Invalid token");
      const userId = claimsData.claims.sub as string;

      const body = await req.json();
      console.log(
        `[generate-course] BUILD=${GENERATE_COURSE_BUILD} models=${FAST_MODEL}/${QUALITY_MODEL}/${IMAGE_MODEL}`,
      );

      const rawTitle = asString(body.title);
      const title = sanitizeTitle(rawTitle);
      const theme = asString(body.theme, title);
      const targetAudience = asString(
        body.target_audience,
        "público geral interessado no tema",
      );
      const tone = asString(body.tone, "profissional, claro e acessível");
      const language = asString(body.language, "pt-BR");
      const knowledgeLevel = asString(body.knowledge_level, "básico");
      const includeQuiz = body.include_quiz === true;
      const includeFlashcards = body.include_flashcards === true;
      const includeImages = body.include_images === true;
      const useSources = body.use_sources === true;
      const depth = targetDepthProfile(body.density);
      const outcome = outcomeConfiguration(body.outcome);

      if (!title || title.length < 3)
        throw new Error("O título do curso deve ter pelo menos 3 caracteres.");

      sendSSE({ type: "status", message: "Verificando permissões..." });
      const { data: subscription } = await serviceClient
        .from("subscriptions")
        .select("plan")
        .eq("user_id", userId)
        .maybeSingle();
      const plan = (subscription?.plan === "pro" ? "pro" : "free") as Plan;
      const limits = TESTING_MODE ? PLAN_LIMITS.pro : PLAN_LIMITS[plan];

      const { data: profile, error: profileError } = await serviceClient
        .from("profiles")
        .select("is_dev")
        .eq("user_id", userId)
        .maybeSingle();
      let isDev: boolean = profile?.is_dev === true || TESTING_MODE;
      if (!isDev && profileError) {
        const { data: profileById } = await serviceClient
          .from("profiles")
          .select("is_dev")
          .eq("id", userId)
          .maybeSingle();
        isDev = profileById?.is_dev === true;
      }

      if (!isDev) {
        const now = new Date();
        const startOfMonth = new Date(
          now.getFullYear(),
          now.getMonth(),
          1,
        ).toISOString();
        const { count } = await serviceClient
          .from("usage_events")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("event_type", "COURSE_GENERATED")
          .gte("created_at", startOfMonth);
        if ((count || 0) >= limits.maxCourses)
          throw new Error(
            "Limite mensal de cursos atingido. Faça upgrade do plano.",
          );
      }

      const actualModules = clampInt(body.num_modules, 1, limits.maxModules, 3);
      if (includeImages && !limits.images && !isDev)
        throw new Error("Imagens IA disponíveis apenas no plano Pro.");
      if (useSources && plan !== "pro" && !isDev)
        throw new Error("Fontes próprias disponíveis apenas no plano Pro.");

      const sourceDocs: SourceDoc[] = [];
      let sourceChunks: SourceChunk[] = [];
      if (useSources) {
        const tempCourseId = asString(body.temp_course_id);
        if (!tempCourseId)
          throw new Error(
            "temp_course_id é obrigatório para cursos com fontes.",
          );
        const { data: sources, error: sourceError } = await serviceClient
          .from("course_sources")
          .select("filename, extracted_text")
          .eq("course_id", tempCourseId)
          .eq("user_id", userId);
        if (sourceError) throw sourceError;
        if (!sources?.length) throw new Error("Nenhuma fonte encontrada.");
        let totalChars = 0;
        for (let index = 0; index < sources.length; index++) {
          const text = asString(sources[index]?.extracted_text);
          if (text.length < 100) continue;
          const remaining = Math.max(0, MAX_SOURCE_TOTAL_CHARS - totalChars);
          if (!remaining) break;
          const clipped = text.slice(0, remaining);
          sourceDocs.push({
            sourceIndex: index + 1,
            filename: asString(sources[index]?.filename, `Fonte ${index + 1}`),
            text: clipped,
          });
          totalChars += clipped.length;
        }
        if (!sourceDocs.length || totalChars < 200)
          throw new Error("As fontes não contêm conteúdo suficiente.");
        sourceChunks = chunkSourceDocuments(sourceDocs);
      }

      // DE PERMISSÃO PARA EXIGÊNCIA
      //
      // A regra antiga dizia quando número era PERMITIDO e nunca que ele era
      // devido. Diante de uma permissão sem pedido, o modelo joga seguro e não
      // escreve nenhum. Um curso inteiro sobre orçamento público municipal saiu
      // com zero percentual: sem os 25% da educação, sem os 15% da saúde, sem o
      // limite de pessoal — e ainda trocou a regra de publicação do RGF, que é
      // semestral para município pequeno, por um confuso "3º período bimestral".
      // Números certos são o que separa curso de conversa sobre o assunto.
      //
      // Efeito colateral bem-vindo: sem número na origem, o exportador de PPTX
      // não tem o que desenhar, e o tipo de slide "chart" ficava dormente no
      // produto inteiro — ele é proibido de inventar dado, e com razão.
      const numbersRule = useSources
        ? "Use somente números que apareçam literalmente nas fontes. Não invente valores, percentuais, prazos, quantidades, custos ou resultados, nem como ilustração."
        : [
          "TRAGA os números que o assunto exige. Quando houver limite legal, percentual mínimo ou máximo, prazo normativo, alíquota, parâmetro técnico oficial ou composição consolidada do domínio, ESCREVA o valor — omitir deixa o curso incompleto e genérico.",
          "Cite o número junto do dispositivo ou da norma que o fixa, para que o leitor possa conferir.",
          "Continua proibido inventar estatística, resultado de pesquisa, custo, preço ou prazo que você não conheça com certeza. Na dúvida sobre um valor específico, descreva a regra sem o número em vez de arriscar um palpite — errar um limite legal é pior que omiti-lo.",
        ].join(" ");

      const generationStart = Date.now();
      const msLeft = () => SOFT_DEADLINE_MS - (Date.now() - generationStart);

      sendSSE({
        type: "status",
        message: "Arquitetando objetivos, módulos e lições...",
      });
      const structureChunks = useSources
        ? selectSourceChunks(
            sourceChunks,
            buildStructureQuery(title, theme, targetAudience),
            MAX_STRUCTURE_SOURCE_CHARS,
            28,
            true,
          )
        : [];
      const structureSourcePacket = renderSourcePacket(structureChunks);
      let blueprint: CourseBlueprint | null = null;
      let blueprintErrors: string[] = [];

      // Escalar para o modelo Pro só faz sentido quando o problema é de
      // QUALIDADE do conteúdo. Truncagem por limite de tokens não é: o Pro
      // produziria o mesmo estouro, mais devagar. Nesse caso repetimos no
      // modelo rápido com o dobro do orçamento.
      let lastFailureWasTruncation = false;

      for (let attempt = 0; attempt < 2 && !blueprint; attempt++) {
        // Sem tempo para outra rodada: aborta com uma mensagem útil em vez de
        // deixar a plataforma matar o worker no meio da geração dos módulos.
        if (attempt > 0 && msLeft() < 45000) {
          blueprintErrors.push(
            `Tempo esgotado após a primeira tentativa (${Math.round((SOFT_DEADLINE_MS - msLeft()) / 1000)}s de ${Math.round(SOFT_DEADLINE_MS / 1000)}s consumidos).`,
          );
          break;
        }
        const useQualityModel = attempt > 0 && !lastFailureWasTruncation;
        const attemptMaxTokens = lastFailureWasTruncation ? 32000 : 16000;
        const structurePrompt =
          buildStructurePrompt({
            title,
            theme,
            targetAudience,
            tone,
            language,
            actualModules,
            knowledgeLevel,
            outcomeLabel: outcome.label,
            capstoneType: outcome.capstone,
            wantsCase: outcome.wantsCase,
            useSources,
            sourcePacket: structureSourcePacket,
            numbersRule,
          }) +
          (blueprintErrors.length
            ? `\n\nCORRIJA ESTES PROBLEMAS DA TENTATIVA ANTERIOR:\n${blueprintErrors.map((error) => `- ${error}`).join("\n")}`
            : "");
        try {
          const { value, meta } = await callAIJson<any>(
            useQualityModel ? QUALITY_MODEL : FAST_MODEL,
            structurePrompt,
            COURSE_BLUEPRINT_SCHEMA,
            "course_blueprint",
            attemptMaxTokens,
            useQualityModel ? "medium" : "low",
            Math.min(90000, Math.max(20000, msLeft() - 5000)),
          );
          // JSON pode ser parseável e ainda assim estar cortado (um objeto
          // fechado antes do fim da lista de módulos). Tratamos como falha.
          if (meta.finishReason === "length") {
            lastFailureWasTruncation = true;
            blueprintErrors = [
              "A resposta foi cortada pelo limite de tokens. Encurte drasticamente todos os textos e respeite os limites de itens por lista.",
            ];
            continue;
          }
          lastFailureWasTruncation = false;
          const check = validateRawBlueprintCandidate(value, actualModules);
          if (check.fatal.length) {
            blueprintErrors = check.fatal;
            continue;
          }
          if (check.soft.length)
            console.warn(
              `[generate-course] Blueprint ajustado: ${check.soft.join(" | ")}`,
            );
          const normalized = normalizeBlueprint(value, actualModules, title);
          blueprintErrors = [];
          if (normalized.modules.length !== actualModules)
            blueprintErrors.push(
              `O blueprint contém ${normalized.modules.length} módulos; esperado ${actualModules}.`,
            );
          if (
            normalized.modules[normalized.modules.length - 1]?.role !==
            "capstone"
          )
            blueprintErrors.push("O último módulo não é capstone.");
          const reassigned = ensureObjectiveCoverage(normalized);
          if (reassigned.length) {
            console.warn(
              `[generate-course] Objetivos religados automaticamente: ${reassigned.join(", ")}`,
            );
          }
          if (!blueprintErrors.length) blueprint = normalized;
        } catch (error: any) {
          lastFailureWasTruncation = error?.truncated === true;
          blueprintErrors = [error?.message || String(error)];
        }
      }
      if (!blueprint)
        throw new Error(
          `Falha ao produzir blueprint pedagógico válido: ${blueprintErrors.join(" | ")}`,
        );

      // Se o blueprint consumiu o orçamento, parar aqui é melhor que começar os
      // módulos e ser morto pela plataforma no meio — o usuário fica com um
      // curso pela metade no banco e uma mensagem genérica de timeout.
      const blueprintMs = SOFT_DEADLINE_MS - msLeft();
      console.log(
        `[generate-course] Blueprint pronto em ${Math.round(blueprintMs / 1000)}s; restam ${Math.round(msLeft() / 1000)}s para ${actualModules} módulos.`,
      );
      if (msLeft() < 30000) {
        throw new Error(
          `Tempo insuficiente para gerar os módulos: o blueprint consumiu ${Math.round(blueprintMs / 1000)}s dos ${Math.round(SOFT_DEADLINE_MS / 1000)}s disponíveis. Gere menos módulos ou aumente COURSE_SOFT_DEADLINE_MS.`,
        );
      }

      // ── Semantic blueprint gate (spec item 7) ────────────────────────────────
      const bpSemantics = validateBlueprintSemantics(blueprint);
      if (bpSemantics.blocking.length) {
        throw new Error(
          `Blueprint inválido (semântica): ${bpSemantics.blocking.join(" | ")}`,
        );
      }
      if ((bpSemantics.repairable.length) && msLeft() > 60000) {
        console.warn(`[generate-course] Semântica do blueprint reparável: ${bpSemantics.repairable.join(" | ")}`);
        try {
          const structurePrompt =
            buildStructurePrompt({
              title, theme, targetAudience, tone, language, actualModules,
              knowledgeLevel, outcomeLabel: outcome.label,
              capstoneType: outcome.capstone, wantsCase: outcome.wantsCase,
              useSources, sourcePacket: structureSourcePacket,
              numbersRule,
            }) +
            `\n\nCORRIJA ESTES PROBLEMAS SEMÂNTICOS:\n${bpSemantics.repairable.map((r) => `- ${r}`).join("\n")}`;
          const { value: fixedValue } = await callAIJson<any>(
            FAST_MODEL, structurePrompt, COURSE_BLUEPRINT_SCHEMA,
            "course_blueprint_semantic_repair",
            16000, "medium",
            Math.min(70000, Math.max(20000, msLeft() - 5000)),
          );
          const check = validateRawBlueprintCandidate(fixedValue, actualModules);
          if (!check.fatal.length) {
            const fixedBp = normalizeBlueprint(fixedValue, actualModules, title);
            ensureObjectiveCoverage(fixedBp);
            blueprint = fixedBp;
            console.warn(`[generate-course] Blueprint semântico reparado.`);
          }
        } catch (semErr: any) {
          console.warn(`[generate-course] Reparo semântico do blueprint falhou: ${semErr?.message || semErr}`);
        }
      } else if (bpSemantics.warnings.length) {
        console.warn(`[generate-course] Blueprint: ${bpSemantics.warnings.join(" | ")}`);
      }
      blueprint.capstone_type = outcome.capstone;
      if (!outcome.wantsCase) {
        blueprint.case_thread = "";
        blueprint.case_facts = [];
      }

      sendSSE({
        type: "structure_done",
        modules: actualModules,
        lessons: blueprint.modules.reduce(
          (sum, module) => sum + module.lessons.length,
          0,
        ),
        objectives: blueprint.course_objectives.length,
      });

      const { data: course, error: courseError } = await serviceClient
        .from("courses")
        .insert({
          user_id: userId,
          title: blueprint.course_title,
          // A regra "sem adjetivo de autoelogio" está no prompt de arquitetura;
          // esta limpeza é a garantia determinística ao lado dela — ver o
          // cabeçalho de _shared/course-description.ts, inclusive para o registro
          // de que a regra de prompt nunca chegou a ser testada de verdade.
          //
          // Acontece na GRAVAÇÃO e não na exibição, para o autor ver no editor
          // exatamente o texto que vai sair no PDF.
          description: limparAutoelogio(blueprint.description),
          theme,
          target_audience: blueprint.audience_label || targetAudience,
          tone,
          language,
          include_quiz: includeQuiz,
          include_flashcards: includeFlashcards,
          include_images: includeImages,
          use_sources: useSources,
          generation_status: "generating",
          generation_build: GENERATE_COURSE_BUILD,
          modules_expected: actualModules,
          // O blueprint e os parâmetros ficam na linha do curso porque é daqui
          // que cada worker de módulo os lê. Sem isto, a fase 2 não teria como
          // reconstruir o contexto pedagógico.
          generation_blueprint: blueprint,
          generation_params: {
            language,
            tone,
            knowledge_level: knowledgeLevel,
            density: body.density ?? null,
            include_quiz: includeQuiz,
            include_flashcards: includeFlashcards,
            include_images: includeImages,
            use_sources: useSources,
            numbers_rule: numbersRule,
          },
        })
        .select()
        .single();
      if (courseError) throw courseError;
      createdCourseId = course.id;
      sendSSE({ type: "course_created", courseId: course.id });

      if (useSources && body.temp_course_id) {
        const { error: reassignError } = await serviceClient
          .from("course_sources")
          .update({ course_id: course.id })
          .eq("course_id", body.temp_course_id)
          .eq("user_id", userId);
        if (reassignError) throw reassignError;
      }

      // ── Enfileiramento ────────────────────────────────────────────────────
      // Um job por módulo. A unicidade (course_id, module_index) na tabela é o
      // que permite despachar mais de uma vez sem gerar módulo duplicado.
      const jobRows = blueprint.modules.map((_, index) => ({
        course_id: course.id,
        user_id: userId,
        module_index: index,
        status: "pending",
      }));
      const { data: jobs, error: jobsError } = await serviceClient
        .from("course_generation_jobs")
        .insert(jobRows)
        .select("id, course_id, module_index");
      if (jobsError) throw jobsError;

      sendSSE({
        type: "jobs_queued",
        courseId: course.id,
        modules: jobs.length,
        jobs: jobs.map((job: any) => ({ id: job.id, moduleIndex: job.module_index })),
      });

      // ── Despacho ──────────────────────────────────────────────────────────
      // Cada worker responde na hora e trabalha em waitUntil, então isto leva
      // milissegundos por job. Se algum despacho falhar, o job continua
      // 'pending' e generate-course-dispatch o repesca — nada se perde.
      //
      // Só o que a ORDEM permite: no começo, os dois primeiros módulos, que vão
      // juntos. Quem despacha o resto é o worker que fecha o último dos dois, e
      // a varredura de jobs parados chega à mesma conclusão se essa corrente se
      // romper. Ver MODULOS_DA_PONTE em course-dispatch.ts.
      const filaInicial = (jobs as any[]).map((j) => ({
        module_index: j.module_index,
        status: "pending",
      }));
      const dispatch = await dispatchAll({
        supabaseUrl,
        serviceRoleKey,
        jobs: elegiveis(
          jobs as Array<{ id: string; course_id: string; module_index: number; status?: string }>,
          filaInicial,
        ).map((j) => ({ id: j.id, course_id: j.course_id, module_index: j.module_index })),
      });

      // O limite mensal do plano é contado a partir destes eventos, então eles
      // passam a ser gravados aqui: é nesta fase que o curso passa a existir.
      const usageRows: Array<Record<string, unknown>> = [
        {
          user_id: userId,
          event_type: "COURSE_GENERATED",
          metadata: { course_id: course.id, plan, build: GENERATE_COURSE_BUILD },
        },
      ];
      if (useSources)
        usageRows.push({
          user_id: userId,
          event_type: "COURSE_WITH_SOURCES",
          metadata: { course_id: course.id, plan, build: GENERATE_COURSE_BUILD },
        });
      const { error: usageError } = await serviceClient
        .from("usage_events")
        .insert(usageRows);
      if (usageError)
        console.warn(
          `[generate-course] Usage logging failed: ${usageError.message}`,
        );

      console.log(
        JSON.stringify({
          event: "course-queued",
          build: GENERATE_COURSE_BUILD,
          course_id: course.id,
          modules: jobs.length,
          dispatched: dispatch.dispatched,
          dispatch_failed: dispatch.failed,
          blueprint_ms: Date.now() - generationStart,
        }),
      );

      sendSSE({
        type: "complete",
        courseId: course.id,
        status: "generating",
        modules: jobs.length,
        dispatched: dispatch.dispatched,
        // Sinaliza ao cliente que a geração continua fora desta requisição.
        async: true,
        follow: {
          table: "course_generation_jobs",
          filter: `course_id=eq.${course.id}`,
        },
      });
      closeSSE();
    } catch (error: any) {
      console.error("[generate-course] Fatal error:", error);
      if (createdCourseId && serviceClient) {
        await serviceClient
          .from("courses")
          .update({
            generation_status: "failed",
            generation_details: { message: error?.message || String(error) },
          })
          .eq("id", createdCourseId);
      }
      sendSSE({
        type: "error",
        message: error?.message || "Erro interno ao gerar curso",
        courseId: createdCourseId || undefined,
        partial: !!createdCourseId,
      });
      closeSSE();
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  })();

  const waitUntil = (globalThis as any).EdgeRuntime?.waitUntil;
  if (typeof waitUntil === "function")
    waitUntil.call((globalThis as any).EdgeRuntime, processingTask);

  return new Response(stream, { headers: sseHeaders });
});
