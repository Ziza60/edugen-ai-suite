-- O claim precisa devolver ZERO LINHAS quando não reivindica nada.
--
-- `claim_course_generation_job` era declarada `returns course_generation_jobs`
-- — um registro, não `setof`. Uma função SQL assim, quando o UPDATE não casa
-- nenhuma linha, não devolve zero linhas: devolve UMA linha com todas as
-- colunas nulas. O PostgREST roda `select * from fn(...)`, acha essa linha, e
-- entrega ao cliente um objeto JSON `{"id": null, "status": null, ...}`.
--
-- Em JavaScript esse objeto é truthy. O worker devolvia 409 com `if (!claimed)`
-- e a checagem nunca disparou: o perdedor da disputa gerava o módulo inteiro.
--
-- MEDIDO em Postgres 16.13, com esta tabela e esta função:
--
--   1a chamada .................. id preenchido, status running, attempts 1
--   2a chamada .................. 1 LINHA, todas as colunas nulas, attempts 1
--   duas transações simultâneas . a 2a espera o lock da 1a e sai com o mesmo
--                                 registro todo nulo; attempts continua 1
--
-- Ou seja: o banco sempre serializou corretamente. O defeito é o formato da
-- resposta, que não distingue "reivindiquei" de "não reivindiquei".
--
-- O CUSTO, no curso 4f278899 de 08/09/2026: os módulos 1 e 2 passaram a
-- terminar quase juntos e cada um despachou os seis seguintes — 12 workers para
-- 6 jobs, todos iniciados dentro de 145 ms, todos rodando até o fim. Curso
-- pedido com 8 módulos, entregue com 10; portão de qualidade rodado 5 vezes.
--
-- Com `setof`, zero linhas volta a ser zero linhas, e `.maybeSingle()` devolve
-- null. O corpo do UPDATE não muda em nada — só o envelope.
--
-- O conserto no código (`reivindicou`, em _shared/course-dispatch.ts) checa o
-- `id` e por isso já resolve sozinho, com ou sem esta migração. Esta migração
-- existe para a armadilha não voltar pelo próximo chamador que confiar no
-- formato.

-- `create or replace` não serve aqui: mudar de registro para `setof` muda o
-- tipo de retorno, e o Postgres recusa ("cannot change return type of existing
-- function"). Verificado em 16.13. O drop é seguro porque a função só é chamada
-- pela service role, de dentro do worker, e a recriação é imediata.
drop function if exists public.claim_course_generation_job(uuid, interval);

create function public.claim_course_generation_job(
  p_job_id uuid,
  p_stale_after interval default interval '3 minutes'
)
returns setof public.course_generation_jobs
language sql
security definer
set search_path = public
as $$
  update public.course_generation_jobs
     set status     = 'running',
         attempts   = attempts + 1,
         started_at = now(),
         updated_at = now()
   where id = p_job_id
     and (
       status = 'pending'
       -- Job 'running' cujo worker morreu (a função foi encerrada pelo teto de
       -- wall clock) volta a ser elegível depois da janela de obsolescência.
       or (status = 'running' and started_at < now() - p_stale_after)
     )
     and attempts < 3
  returning *;
$$;

-- ─── PERMISSÃO ──────────────────────────────────────────────────────────────
-- O `drop` leva TODOS os grants da função junto. A recriação só devolveria o
-- EXECUTE ao service_role por conta das default privileges do projeto — que é
-- uma dependência invisível, e é justamente o tipo de coisa que este projeto já
-- pagou caro por supor.
--
-- MEDIDO em Postgres 16.13, criando os papéis anon/authenticated/service_role:
--
--   sem default privileges + revoke from public ... service_role SEM execute
--   com default privileges + revoke from public ... service_role com execute
--   grant explícito ............................... com execute nos dois casos
--
-- O grant explícito é idempotente e custa uma linha. O erro de permissão no
-- primeiro curso de cliente custaria o curso.
revoke all on function public.claim_course_generation_job(uuid, interval) from public, anon, authenticated;
grant execute on function public.claim_course_generation_job(uuid, interval) to service_role;
