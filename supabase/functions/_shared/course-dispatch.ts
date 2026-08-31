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

// ═══════════════════════════════════════════════════════════════════════════
// OS DOIS PRIMEIROS MÓDULOS VÃO EM ORDEM; O RESTO VAI JUNTO
//
// A ponte de valores lê o que os módulos anteriores JÁ GRAVARAM
// (`order_index < meu`) e injeta no prompt do módulo seguinte. É a única
// prevenção que existe contra o curso se contradizer — o resto é detecção.
//
// Só que os oito módulos eram despachados de uma vez. Nos logs de 31/08, as
// oito chamadas de envelope saíram em MENOS DE UM SEGUNDO, e cada módulo só
// grava sua linha 80 a 116 s depois. Quando o módulo 8 começava, nenhum dos
// sete anteriores tinha escrito nada: a consulta voltava vazia, para todos. A
// ponte estava desligada por construção, e um comentário no código afirmava
// "os módulos vão em ordem".
//
// POR QUE DOIS, E NÃO TODOS
//
// MEDIDO nas dez divergências dos cinco cursos da bancada, pela posição em que
// o PRIMEIRO valor de cada uma é fixado:
//
//     encadear os 2 primeiros cobre ..... 6
//     encadear os 3 primeiros cobre ..... 7
//     só encadeamento completo .......... 3
//
// E as três que exigiriam encadeamento completo são exatamente os três alarmes
// FALSOS do acervo — o custo de pedido do açúcar contra o da farinha, o custo
// de manutenção por quilo contra por lata, e o lead time dos ovos contra o do
// chocolate. Todo defeito verdadeiro está ancorado nos dois primeiros módulos.
//
// O preço é tempo de espera. Módulo medido entre 78 e 116 s:
//
//     hoje, tudo em paralelo ......... ~2 min
//     dois em série, resto junto ..... ~5 min
//     tudo em série .................. ~13 min
//
// Treze minutos para cobrir só o que não é defeito seria o pior negócio dos
// três.
//
// COMO A ORDEM É IMPOSTA SEM QUEBRAR A REDE DE SEGURANÇA
//
// A elegibilidade é função do ESTADO DA FILA, não de quem despacha. Assim o
// mesmo cálculo serve à fase 1, ao worker que acabou de fechar um módulo e à
// varredura de jobs parados — e uma cadeia interrompida no meio é retomada
// sozinha pela varredura, sem código especial.
// ═══════════════════════════════════════════════════════════════════════════

/** Quantos módulos rodam em ordem antes de o paralelo voltar. Ver acima. */
export const MODULOS_EM_SERIE = 2;

/** Estados em que um job não vai mais mudar, e portanto não bloqueia ninguém. */
const TERMINAL = new Set(["done", "failed"]);

export interface JobParaOrdenar {
  module_index: number;
  status: string;
}

/**
 * Este job pode ser despachado agora?
 *
 * Um módulo só espera pelos que vêm antes dele ATÉ o limite da série: o de
 * índice 5 espera pelos módulos 1 e 2, não pelo 4. Escrito de uma vez:
 * esperam-se os índices menores que `min(meuIndice, MODULOS_EM_SERIE)`.
 *
 * `failed` conta como terminal de propósito. Se o módulo 1 esgotar as
 * tentativas, o curso sai capenga — mas sai. Um módulo que falha travando os
 * outros sete transformaria um defeito em curso nenhum.
 */
export function podeDespachar(
  job: JobParaOrdenar,
  fila: JobParaOrdenar[],
): boolean {
  const barreira = Math.min(job.module_index, MODULOS_EM_SERIE);
  return fila.every((outro) =>
    outro.module_index >= barreira || TERMINAL.has(outro.status)
  );
}

/** Filtra uma lista de jobs pelo que a ordem permite agora. */
export function elegiveis<T extends JobParaOrdenar>(
  candidatos: T[],
  fila: JobParaOrdenar[],
): T[] {
  return candidatos.filter((j) => podeDespachar(j, fila));
}

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
