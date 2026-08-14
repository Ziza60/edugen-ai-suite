-- Laudos do portão de qualidade estrutural.
--
-- Até aqui a única barreira entre um curso defeituoso e o cliente final era
-- alguém abrir o PDF e reparar no defeito. Isso encontrou coisas reais —
-- marcadores internos vazando no texto, módulos sem atividade prática, campos
-- de estudo de caso cortados no meio —, mas não escala: um curso só era
-- reprovado se um humano tivesse olhado para ele.
--
-- O portão roda em toda geração e grava o laudo aqui. É tabela de histórico, e
-- não coluna em `courses`, pelo mesmo motivo do EduScore: a pergunta que
-- interessa é "melhorou?", e essa só se responde com mais de um ponto no tempo.
-- Também é o que permite auditar depois POR QUE um curso foi para revisão.

create table if not exists public.course_quality_reports (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid not null references public.courses (id) on delete cascade,
  -- ready | ready_with_warnings | needs_review
  verdict          text not null,
  -- Percentual de verificações cumpridas, com blocker pesando 3x warning.
  -- Não é nota pedagógica (isso é o EduScore) — serve para acompanhar tendência.
  structural_score integer not null default 0,
  blockers         integer not null default 0,
  warnings         integer not null default 0,
  -- Laudo completo: cada verificação com severidade, resultado e as evidências
  -- que a dispararam. Sem as evidências o laudo diz "falhou" e não conserta nada.
  checks           jsonb  not null default '[]'::jsonb,
  -- As regras mudam. Comparar um laudo antigo com um novo sem saber a versão
  -- levaria a conclusões erradas sobre o conteúdo quando o que mudou foi a régua.
  criteria_version text   not null,
  created_at       timestamptz not null default now(),

  constraint course_quality_reports_verdict_check
    check (verdict in ('ready', 'ready_with_warnings', 'needs_review'))
);

create index if not exists course_quality_reports_course_idx
  on public.course_quality_reports (course_id, created_at desc);

-- Consulta operacional: "o que está represado em revisão?"
create index if not exists course_quality_reports_verdict_idx
  on public.course_quality_reports (verdict, created_at desc)
  where verdict = 'needs_review';

alter table public.course_quality_reports enable row level security;

-- Leitura segue a posse do curso. Escrita é exclusiva da service role, que
-- ignora RLS: nenhuma policy de insert/update/delete é criada de propósito —
-- um laudo que o próprio dono pudesse reescrever não seria uma garantia.
drop policy if exists "quality report: dono lê" on public.course_quality_reports;
create policy "quality report: dono lê"
  on public.course_quality_reports
  for select
  using (exists (
    select 1
      from public.courses c
     where c.id = course_quality_reports.course_id
       and c.user_id = auth.uid()
  ));

-- Resumo do último laudo direto no curso, para a listagem não precisar de join.
alter table public.courses
  add column if not exists quality_verdict text,
  add column if not exists quality_score integer,
  add column if not exists quality_checked_at timestamptz;
