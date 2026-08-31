import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders } from "../_shared/course-pipeline.ts";
import { dispatchAll, elegiveis, secretsMatch } from "../_shared/course-dispatch.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Rede de segurança da fila.
//
// O caminho normal é a fase 1 despachar os workers assim que enfileira. Esta
// função cobre o que aquele caminho não cobre:
//
//   - despacho que falhou por rede, deixando o job em 'pending';
//   - worker morto no meio (a Edge Function foi encerrada), deixando o job
//     preso em 'running';
//   - módulo que falhou e ainda tem tentativa sobrando.
//
// Sem isto, um curso podia ficar parado para sempre em 'generating' e o usuário
// não teria como saber. Rodando de minuto em minuto pelo pg_cron, o pior caso
// vira "o módulo demora um minuto a mais", não "o curso nunca termina".
//
// Reivindicar é sempre atômico no banco, então disparar isto em paralelo com o
// despacho da fase 1 não duplica módulo.
// ─────────────────────────────────────────────────────────────────────────────

// Um job 'running' mais velho que isto é considerado órfão: nenhum worker
// sobrevive tanto tempo, já que o teto de wall clock é de 150 s.
const STALE_RUNNING_MS = 4 * 60 * 1000;
const MAX_JOBS_PER_RUN = 20;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Variáveis do Supabase não configuradas." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Aceita a service role key ou COURSE_DISPATCH_SECRET. O segredo separado
  // existe para o pg_cron: assim o Vault guarda um valor de escopo restrito em
  // vez da chave que abre o banco inteiro.
  const dispatchSecret = Deno.env.get("COURSE_DISPATCH_SECRET") || "";
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const provided = req.headers.get("x-dispatch-secret") || bearer;
  const authorized =
    secretsMatch(provided, serviceRoleKey) ||
    (!!dispatchSecret && secretsMatch(provided, dispatchSecret));
  if (!authorized) {
    return new Response(JSON.stringify({ error: "Não autorizado." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS).toISOString();

  // Jobs pendentes e jobs 'running' órfãos, ambos ainda com tentativa sobrando.
  const { data: jobs, error } = await serviceClient
    .from("course_generation_jobs")
    .select("id, course_id, module_index, status, attempts, started_at")
    .lt("attempts", 3)
    .or(`status.eq.pending,and(status.eq.running,started_at.lt.${staleBefore})`)
    .order("created_at", { ascending: true })
    .limit(MAX_JOBS_PER_RUN);

  if (error) {
    console.error(`[generate-course-dispatch] Consulta falhou: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!jobs?.length) {
    return new Response(JSON.stringify({ picked: 0, dispatched: 0 }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // A varredura respeita a mesma ordem da fase 1 — e é ela que retoma uma
  // cadeia rompida, sem precisar saber que houve rompimento. Para decidir, a
  // fila INTEIRA de cada curso é consultada: os jobs já concluídos não vêm na
  // busca acima, e sem eles a barreira nunca seria considerada vencida.
  const filaPorCurso = new Map<string, Array<{ module_index: number; status: string }>>();
  for (const courseId of new Set(jobs.map((j: any) => j.course_id))) {
    const { data: fila } = await serviceClient
      .from("course_generation_jobs")
      .select("module_index, status")
      .eq("course_id", courseId);
    filaPorCurso.set(courseId, (fila ?? []) as Array<{ module_index: number; status: string }>);
  }
  const liberados = (jobs as any[]).filter((j) =>
    elegiveis([{ module_index: j.module_index, status: j.status }],
      filaPorCurso.get(j.course_id) ?? []).length > 0
  );

  const result = await dispatchAll({
    supabaseUrl,
    serviceRoleKey,
    jobs: liberados as Array<{ id: string; course_id: string; module_index: number }>,
  });

  // Cursos cujos jobs terminaram enquanto ninguém olhava: recalcula o status
  // para que nenhum fique preso em 'generating'.
  const courseIds = [...new Set(jobs.map((job: any) => job.course_id))];
  for (const courseId of courseIds) {
    await serviceClient.rpc("refresh_course_generation_progress", {
      p_course_id: courseId,
    });
  }

  console.log(
    JSON.stringify({
      event: "course-dispatch-sweep",
      picked: jobs.length,
      dispatched: result.dispatched,
      failed: result.failed,
      courses: courseIds.length,
    }),
  );

  return new Response(
    JSON.stringify({
      picked: jobs.length,
      dispatched: result.dispatched,
      failed: result.failed,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
