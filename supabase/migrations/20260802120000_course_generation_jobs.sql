-- Geração de curso em invocações independentes.
--
-- Motivação: a Edge Function tem teto de wall clock de 150 s no plano gratuito
-- (400 s em background no pago). Um curso de 5 módulos são ~21 chamadas ao
-- Gemini e não cabe nessa janela — a geração morria em 150,0 s cravados.
--
-- A solução não é caber mais trabalho na janela, é encurtar cada janela:
--   fase 1 (generate-course)         blueprint + curso + jobs  ~40 s
--   fase 2 (generate-course-module)  um módulo por invocação   ~50 s
--
-- O tamanho do curso passa a aumentar o NÚMERO de invocações, não a duração de
-- cada uma. Um curso de 10 módulos usa a mesma janela de um de 2.

-- ─── Colunas de acompanhamento no curso ──────────────────────────────────────
-- O código já tentava gravar estas colunas por caminho best-effort e falhava em
-- silêncio ("Could not find the 'course_objectives' column"). Agora existem.

alter table public.courses
  add column if not exists generation_status text not null default 'pending',
  add column if not exists generation_details jsonb,
  add column if not exists generation_build text,
  add column if not exists generation_blueprint jsonb,
  add column if not exists generation_params jsonb,
  add column if not exists final_competency text,
  add column if not exists skills_and_knowledge jsonb,
  add column if not exists course_objectives jsonb,
  add column if not exists modules_expected integer,
  add column if not exists modules_completed integer not null default 0;

-- pending → generating → ready | ready_with_warnings | needs_review | failed
alter table public.courses
  drop constraint if exists courses_generation_status_check;
alter table public.courses
  add constraint courses_generation_status_check
  check (generation_status in (
    'pending', 'generating', 'ready', 'ready_with_warnings', 'needs_review', 'failed'
  ));

create index if not exists courses_generation_status_idx
  on public.courses (generation_status)
  where generation_status in ('pending', 'generating');

-- ─── Fila de módulos ─────────────────────────────────────────────────────────

create table if not exists public.course_generation_jobs (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses (id) on delete cascade,
  user_id      uuid not null,
  module_index integer not null,
  status       text not null default 'pending'
               check (status in ('pending', 'running', 'done', 'failed')),
  attempts     integer not null default 0,
  last_error   text,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Um job por módulo do curso. É esta restrição que torna o re-despacho
  -- seguro: a rede de segurança pode disparar quantas vezes quiser sem
  -- duplicar módulo.
  unique (course_id, module_index)
);

create index if not exists course_generation_jobs_pending_idx
  on public.course_generation_jobs (status, created_at)
  where status in ('pending', 'running');

create index if not exists course_generation_jobs_course_idx
  on public.course_generation_jobs (course_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- O dono lê o próprio progresso. Escrita é exclusiva da service role, que
-- ignora RLS: nenhuma policy de insert/update/delete é criada de propósito.

alter table public.course_generation_jobs enable row level security;

drop policy if exists "jobs: dono lê" on public.course_generation_jobs;
create policy "jobs: dono lê"
  on public.course_generation_jobs
  for select
  using (auth.uid() = user_id);

-- ─── Reivindicação atômica ───────────────────────────────────────────────────
-- Sem isto, dois despachos simultâneos (o fan-out direto e a rede de segurança
-- do cron) pegariam o mesmo job e gerariam o módulo duas vezes. O update
-- condicional garante que só um worker sai com o job na mão.

create or replace function public.claim_course_generation_job(
  p_job_id uuid,
  p_stale_after interval default interval '3 minutes'
)
returns public.course_generation_jobs
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

revoke all on function public.claim_course_generation_job(uuid, interval) from public, anon, authenticated;

-- ─── Progresso do curso ──────────────────────────────────────────────────────

create or replace function public.refresh_course_generation_progress(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total    integer;
  v_done     integer;
  v_failed   integer;
  v_pending  integer;
begin
  select count(*),
         count(*) filter (where status = 'done'),
         count(*) filter (where status = 'failed'),
         count(*) filter (where status in ('pending', 'running'))
    into v_total, v_done, v_failed, v_pending
    from public.course_generation_jobs
   where course_id = p_course_id;

  update public.courses
     set modules_completed = v_done,
         generation_status = case
           when v_pending > 0 then 'generating'
           when v_done = 0    then 'failed'
           -- Curso parcial é entregue e marcado para revisão, nunca descartado:
           -- o aluno fica com os módulos que deram certo.
           when v_failed > 0  then 'needs_review'
           else 'ready'
         end
   where id = p_course_id;
end;
$$;

revoke all on function public.refresh_course_generation_progress(uuid) from public, anon, authenticated;

-- ─── Conteúdo estruturado das lições ─────────────────────────────────────────
-- bestEffortStructuredHierarchy já gravava nestas tabelas, mas nenhuma migration
-- as criava: a escrita falhava em silêncio a cada módulo e o dado estruturado
-- de cada bloco (tabs, flip cards, cenários, atividades) ficava só embutido no
-- Markdown, como um comentário HTML que vazava na tela do aluno.
--
-- Com as tabelas existindo, o payload vai para uma coluna consultável e o
-- Markdown volta a ser só texto para leitura.

create table if not exists public.course_lessons (
  id                uuid primary key default gen_random_uuid(),
  module_id         uuid not null references public.course_modules (id) on delete cascade,
  lesson_number     text not null,
  title             text not null,
  objective         text,
  order_index       integer not null default 0,
  estimated_minutes integer,
  created_at        timestamptz not null default now(),
  unique (module_id, order_index)
);

create index if not exists course_lessons_module_idx
  on public.course_lessons (module_id, order_index);

create table if not exists public.course_learning_blocks (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.course_lessons (id) on delete cascade,
  block_type   text not null,
  heading      text,
  -- O bloco inteiro, normalizado e validado: é a fonte para um renderizador de
  -- widgets interativos, se ele vier a ser construído.
  content_json jsonb not null,
  order_index  integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (lesson_id, order_index)
);

create index if not exists course_learning_blocks_lesson_idx
  on public.course_learning_blocks (lesson_id, order_index);

alter table public.course_lessons enable row level security;
alter table public.course_learning_blocks enable row level security;

-- Leitura segue a posse do curso; escrita é exclusiva da service role.
drop policy if exists "lições: dono lê" on public.course_lessons;
create policy "lições: dono lê"
  on public.course_lessons for select
  using (exists (
    select 1
      from public.course_modules m
      join public.courses c on c.id = m.course_id
     where m.id = course_lessons.module_id
       and c.user_id = auth.uid()
  ));

drop policy if exists "blocos: dono lê" on public.course_learning_blocks;
create policy "blocos: dono lê"
  on public.course_learning_blocks for select
  using (exists (
    select 1
      from public.course_lessons l
      join public.course_modules m on m.id = l.module_id
      join public.courses c on c.id = m.course_id
     where l.id = course_learning_blocks.lesson_id
       and c.user_id = auth.uid()
  ));

-- ─── Realtime ────────────────────────────────────────────────────────────────
-- Permite ao front acompanhar sem polling. Disponível no plano gratuito.

do $$
begin
  alter publication supabase_realtime add table public.course_generation_jobs;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
