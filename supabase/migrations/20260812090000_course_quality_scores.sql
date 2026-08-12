-- Histórico do EduScore.
--
-- Até aqui a nota era recalculada a cada clique e descartada: não havia como
-- saber se um curso melhorou depois de uma revisão, nem comparar cursos ao
-- longo do tempo. Um número que some assim que a tela fecha não sustenta
-- decisão nenhuma.
--
-- É uma tabela de histórico, e não uma coluna em `courses`, porque a pergunta
-- que interessa é "melhorou?" — e essa só se responde com mais de um ponto no
-- tempo. A nota mais recente sai de um order by created_at desc limit 1.

create table if not exists public.course_quality_scores (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.courses (id) on delete cascade,
  overall_score integer not null,
  dimensions    jsonb not null,
  suggestions   jsonb not null default '[]'::jsonb,
  modules_count integer not null default 0,
  -- Os critérios mudam. Em 12/08/2026, por exemplo, "Fórmula / Cálculo" virou
  -- "Procedimento Passo a Passo" e o Equilíbrio deixou de contar as seções que
  -- o renderizador acrescenta. Comparar uma nota antiga com uma nova sem saber
  -- disso levaria a conclusões erradas sobre o conteúdo — quando o que mudou
  -- foi a régua. Guardar a versão torna a comparação honesta.
  criteria_version text not null,
  created_at    timestamptz not null default now()
);

create index if not exists course_quality_scores_course_idx
  on public.course_quality_scores (course_id, created_at desc);

alter table public.course_quality_scores enable row level security;

-- Leitura segue a posse do curso. Escrita é exclusiva da service role, que
-- ignora RLS: nenhuma policy de insert/update/delete é criada de propósito.
drop policy if exists "eduscore: dono lê" on public.course_quality_scores;
create policy "eduscore: dono lê"
  on public.course_quality_scores
  for select
  using (exists (
    select 1
      from public.courses c
     where c.id = course_quality_scores.course_id
       and c.user_id = auth.uid()
  ));
