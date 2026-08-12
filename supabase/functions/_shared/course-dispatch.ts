// Despacho dos jobs de módulo.
//
// Caminho primário: a fase 1 chama o worker por HTTP assim que os jobs entram
// no banco. O worker responde na hora e faz o trabalho em EdgeRuntime.waitUntil,
// então este fetch resolve em milissegundos — não é o despachante que espera a
// geração.
//
// Rede de segurança: generate-course-dispatch varre jobs parados e chama isto
// de novo. Duplicar o despacho é inofensivo porque quem decide é
// claim_course_generation_job, no banco, de forma atômica.

export interface ModuleJobRef {
  id: string;
  course_id: string;
  module_index: number;
}

export const WORKER_FUNCTION_NAME = "generate-course-module";

export function workerEndpoint(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${WORKER_FUNCTION_NAME}`;
}

/** Comparação em tempo constante — evita vazar o segredo por diferença de tempo. */
export function secretsMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function dispatchModuleJob(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  job: ModuleJobRef;
  timeoutMs?: number;
}): Promise<{ ok: boolean; detail: string }> {
  const { supabaseUrl, serviceRoleKey, job, timeoutMs = 8000 } = params;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(workerEndpoint(supabaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        jobId: job.id,
        courseId: job.course_id,
        moduleIndex: job.module_index,
      }),
      signal: controller.signal,
    });
    // 409 = outro despacho já reivindicou o job. É o desenho funcionando, não erro.
    const ok = response.ok || response.status === 409;
    return { ok, detail: `${response.status}` };
  } catch (error: any) {
    // Falha de despacho não perde o job: ele fica 'pending' e a rede de
    // segurança o repesca.
    return { ok: false, detail: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function dispatchAll(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  jobs: ModuleJobRef[];
  concurrency?: number;
}): Promise<{ dispatched: number; failed: number }> {
  const { supabaseUrl, serviceRoleKey, jobs, concurrency = 6 } = params;
  let dispatched = 0;
  let failed = 0;
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, jobs.length) },
    async () => {
      while (true) {
        const index = next++;
        if (index >= jobs.length) return;
        const result = await dispatchModuleJob({
          supabaseUrl,
          serviceRoleKey,
          job: jobs[index],
        });
        if (result.ok) dispatched += 1;
        else {
          failed += 1;
          console.warn(
            `[course-dispatch] Falha ao despachar módulo ${jobs[index].module_index}: ${result.detail}`,
          );
        }
      }
    },
  );
  await Promise.all(runners);
  return { dispatched, failed };
}
