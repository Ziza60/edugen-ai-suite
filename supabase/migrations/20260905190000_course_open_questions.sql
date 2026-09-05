-- A tabela da questão aberta, que o código escreve desde sempre e nunca existiu.
--
-- `bestEffort_openQuestion` insere aqui a questão de aplicação de cada módulo.
-- Como a inserção é best-effort, a ausência da tabela nunca quebrou nada — mas
-- registrava um erro em TODA invocação de módulo, oito por curso, poluindo todo
-- log usado para medir qualquer outra coisa:
--
--   Optional course_open_questions table unavailable: Could not find the table
--   'public.course_open_questions' in the schema cache
--
-- Nada foi perdido: a questão aberta também é embutida no Markdown do módulo, e
-- é assim que o aluno a vê hoje. O que não existe é a forma consultável — sem
-- ela não dá para listar as questões de um curso sem varrer texto.
--
-- Colunas exatamente como o insert as envia (course-pipeline.ts):
--   module_id, question, sample_answer, criteria, outcome_id

create table if not exists public.course_open_questions (
  id            uuid primary key default gen_random_uuid(),
  module_id     uuid not null references public.course_modules (id) on delete cascade,
  question      text not null,
  sample_answer text,
  -- `criteria` chega como array de strings do JSON do modelo.
  criteria      text[] not null default '{}',
  outcome_id    text,
  created_at    timestamptz not null default now()
);

create index if not exists course_open_questions_module_idx
  on public.course_open_questions (module_id);

alter table public.course_open_questions enable row level security;

-- Leitura segue a posse do curso; escrita é exclusiva da service role, que é
-- quem gera. Mesmo desenho de course_lessons e course_learning_blocks.
drop policy if exists "questão aberta: dono lê" on public.course_open_questions;
create policy "questão aberta: dono lê"
  on public.course_open_questions for select
  using (exists (
    select 1
      from public.course_modules m
      join public.courses c on c.id = m.course_id
     where m.id = course_open_questions.module_id
       and c.user_id = auth.uid()
  ));
