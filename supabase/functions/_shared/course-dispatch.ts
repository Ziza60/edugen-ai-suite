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
//
// Esse "inofensivo" foi falso por um mês: o banco decidia certo e o código
// não sabia ler a resposta. Ver `reivindicou`, no fim deste arquivo.

// ═══════════════════════════════════════════════════════════════════════════
// OS DOIS PRIMEIROS MÓDULOS VÃO JUNTOS; O RESTO ESPERA OS DOIS
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
// MEDIDO nas divergências dos cursos da bancada, pela posição em que o PRIMEIRO
// valor de cada uma é fixado: encadear os 2 primeiros cobre 6 de 10; os 3
// primeiros, 7. As três que exigiriam encadeamento completo são exatamente os
// três alarmes FALSOS do acervo. Todo defeito verdadeiro está ancorado nos dois
// primeiros módulos, e encadear tudo levaria o curso a ~13 min.
//
// POR QUE O MÓDULO 1 NÃO PRECISA RODAR SOZINHO
//
// A regra antiga era uma rampa: o índice 1 esperava o 0, e os demais esperavam
// 0 e 1. Isso serializava TRÊS ondas, e a primeira não paga o que custa. Medido
// nos sete cursos da bancada, o que a ponte extrai do módulo 1 SOZINHO — que é
// tudo o que o módulo 2 chega a receber:
//
//     Finanças Inteligentes ..... 2      Sabor da Vovó ......... 0
//     Delícias da Vovó .......... 1      Doces da Vovó ......... 0
//     Pão Quente ................ 0      Sabor Caseiro ......... 0
//                                        Transformação Digital . 0
//
// Três valores em sete cursos. O módulo 1 é diagnóstico e fala em prosa; os
// números do caso nascem no módulo 2, o primeiro analítico — 8 dos 8 valores do
// Sabor Caseiro, 5 dos 5 do Pão Quente.
//
// E os módulos 3+ não perdem nada: eles esperam os DOIS, que a essa altura já
// gravaram. O único prejuízo é o módulo 2 deixar de herdar do 1 — e nos sete
// cursos NENHUM tem contradição numérica entre 1 e 2. No Finanças, o único com
// valores relevantes no módulo 1, o módulo 2 reenuncia R$19,90 três vezes, as
// três iguais; as duas contradições verdadeiras estão nos módulos 3 e 5, que
// continuam recebendo tudo.
//
// O preço em tempo, medido no curso 5ef3f2c1 (01/09):
//
//     três ondas (1 | 2 | resto) ..... 73,5 + 82,9 + 108,5 = 265,7 s
//     duas ondas (1+2 | resto) ....... max(73,5; 82,9) + 108,5 = 191,9 s
//
// 74 s a menos, mesma ponte.
//
// COMO A ORDEM É IMPOSTA SEM QUEBRAR A REDE DE SEGURANÇA
//
// A elegibilidade é função do ESTADO DA FILA, não de quem despacha. Assim o
// mesmo cálculo serve à fase 1, ao worker que acabou de fechar um módulo e à
// varredura de jobs parados — e uma cadeia interrompida no meio é retomada
// sozinha pela varredura, sem código especial.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Quantos módulos iniciais precisam estar gravados antes de o resto sair.
 * Eles rodam ENTRE SI em paralelo; a barreira é para quem vem depois.
 */
export const MODULOS_DA_PONTE = 2;

/** Estados em que um job não vai mais mudar, e portanto não bloqueia ninguém. */
const TERMINAL = new Set(["done", "failed"]);

export interface JobParaOrdenar {
  module_index: number;
  status: string;
}

/**
 * Este job pode ser despachado agora?
 *
 * A barreira é FIXA, não uma rampa: os módulos da ponte (índices menores que
 * `MODULOS_DA_PONTE`) saem na hora, juntos; todos os outros esperam que os da
 * ponte estejam terminais. O de índice 5 espera pelos módulos 1 e 2, não pelo 4
 * — e o de índice 1 não espera pelo 0.
 *
 * `failed` conta como terminal de propósito. Se o módulo 1 esgotar as
 * tentativas, o curso sai capenga — mas sai. Um módulo que falha travando os
 * outros sete transformaria um defeito em curso nenhum.
 */
export function podeDespachar(
  job: JobParaOrdenar,
  fila: JobParaOrdenar[],
): boolean {
  if (job.module_index < MODULOS_DA_PONTE) return true;
  return fila.every((outro) =>
    outro.module_index >= MODULOS_DA_PONTE || TERMINAL.has(outro.status)
  );
}

/** Filtra uma lista de jobs pelo que a ordem permite agora. */
export function elegiveis<T extends JobParaOrdenar>(
  candidatos: T[],
  fila: JobParaOrdenar[],
): T[] {
  return candidatos.filter((j) => podeDespachar(j, fila));
}

// ═══════════════════════════════════════════════════════════════════════════
// A RESPOSTA DO CLAIM PRECISA SER LIDA PELO CONTEÚDO, NÃO PELA EXISTÊNCIA
//
// `claim_course_generation_job` é declarada `returns course_generation_jobs` —
// um registro, não `setof`. Quando o UPDATE não casa nenhuma linha, a função
// SQL não devolve zero linhas: devolve UMA linha com todas as colunas nulas. O
// PostgREST executa `select * from fn(...)`, encontra essa linha, e entrega um
// objeto JSON `{"id": null, "status": null, ...}`.
//
// Em JavaScript esse objeto é TRUTHY. O worker checava `if (!claimed)` para
// devolver 409, e a checagem nunca disparou — nenhuma vez, desde que existe. O
// perdedor da disputa gerava o módulo inteiro assim como o vencedor.
//
// MEDIDO em Postgres 16.13, reproduzindo a tabela e a função deste projeto:
//
//   1a chamada .................. id preenchido, status running, attempts 1
//   2a chamada .................. 1 LINHA, todas as colunas nulas, attempts 1
//   duas transações simultâneas . a 2a espera o lock da 1a (2,0 s no teste) e
//                                 sai com o mesmo registro todo nulo
//
// O banco serializa certo: `attempts` fica em 1, nunca 2. Quem não sabia ler
// era este lado.
//
// O QUE ISSO CUSTOU, no curso 4f278899 de 08/09
//
// Os módulos 1 e 2 passaram a terminar quase juntos (MODULOS_DA_PONTE = 2), e
// cada um abriu a porta para os seis seguintes: 12 despachos para 6 jobs, todos
// os 12 iniciados dentro de 145 ms. Os 12 workers rodaram até o fim. O curso
// pedido com 8 módulos foi entregue com 10 — dois gravados duas vezes — e o
// portão de qualidade rodou 5 vezes.
//
// A assinatura do bug é a de sempre neste projeto: uma régua que não olha o que
// afirma medir. `!claimed` media se veio um objeto, não se o job foi
// reivindicado.
//
// A migração 20260908220000 troca a função para `setof`, e aí zero linhas passa
// a ser zero linhas. Esta função continua valendo depois disso: ela é a única
// que responde à pergunta certa, e não depende de qual banco está do outro lado.
// ═══════════════════════════════════════════════════════════════════════════

/** A resposta do claim significa que ESTE worker ficou com o job? */
export function reivindicou(resposta: unknown): boolean {
  if (!resposta || typeof resposta !== "object") return false;
  const linha = resposta as Record<string, unknown>;
  return typeof linha.id === "string" && linha.id.length > 0;
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
