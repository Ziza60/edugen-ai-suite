-- O portão de qualidade roda UMA vez por fechamento de curso.
--
-- A checagem antiga era uma contagem seguida de uma decisão, em duas idas ao
-- banco: contar os jobs pendentes e, se der zero, rodar o portão. Entre uma
-- coisa e outra cabe outro worker fazendo o mesmo. No curso 4f278899, de
-- 08/09, o log mostra CINCO `course-quality-gate-done` para o mesmo course_id.
--
-- Os cinco laudos daquele curso deram o mesmo veredito (94/100, 0 bloqueadores,
-- 2 ressalvas), então o estrago foi desperdício. Mas o desenho admite estrago
-- de verdade: um worker que fecha enquanto outro ainda escreve dispara um
-- portão que julga um curso incompleto. O app mostra o laudo mais recente
-- (`order by created_at desc limit 1`, em CourseQualityReport.tsx), então basta
-- o laudo prematuro ser o último a ser gravado para o usuário ver um veredito
-- sobre um curso que já não existe mais daquele jeito.
--
-- Aqui as duas perguntas viram um UPDATE condicional só: marca a data se e
-- somente se ela ainda estiver nula E não houver job pendente ou rodando.
-- Exatamente um worker recebe `true`.
--
-- A coluna não precisa ser limpa entre gerações: `generate-course` INSERE uma
-- linha nova em `courses` a cada curso, então ela nasce nula. Para reexecutar o
-- portão de um curso à mão, zere-a:
--
--   update public.courses set quality_gate_claimed_at = null where id = '…';

alter table public.courses
  add column if not exists quality_gate_claimed_at timestamptz;

comment on column public.courses.quality_gate_claimed_at is
  'Quando o portão de qualidade foi reivindicado para este curso. Nulo = ainda não rodou. Zerar para reexecutar à mão.';

-- `returns boolean` em LANGUAGE sql tem a mesma armadilha do claim de job: sem
-- linha casada o retorno é NULL, e NULL do lado do JavaScript é falsy por
-- acidente, não por decisão. Em plpgsql o `coalesce` responde false de forma
-- explícita, e o chamador compara com `=== true`.
create or replace function public.try_claim_quality_gate(p_course_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  update public.courses
     set quality_gate_claimed_at = now()
   where id = p_course_id
     and quality_gate_claimed_at is null
     and not exists (
       select 1
         from public.course_generation_jobs
        where course_id = p_course_id
          and status in ('pending', 'running')
     )
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.try_claim_quality_gate(uuid) from public, anon, authenticated;
