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
-- ─── E A REEXECUÇÃO? ────────────────────────────────────────────────────────
-- "Já foi reivindicado uma vez, para sempre" seria a forma errada da marca:
-- bloquearia em silêncio qualquer reavaliação futura. Levantado antes de rodar
-- a migração, e verificado no código: HOJE não existe nenhum caminho que
-- reexecute o portão. O único chamador de `course-quality-gate` em produção é
-- `runQualityGate`, dentro de generate-course-module; `inspectCourse` só
-- aparece em teste; não há botão de reavaliar. Os caminhos que mexem em
-- conteúdo depois da geração — BlockEditor, reprocess-flashcards,
-- translate-course, generate-module-image — já deixavam o laudo antigo de pé.
--
-- Ainda assim a marca não é eterna, porque o modo de falhar era SILENCIOSO. A
-- condição compara com o último movimento da fila: se algum job mudou depois da
-- última reivindicação, é outro fechamento, e o portão reabre sozinho. Uma
-- regeração, uma repescagem de job parado ou um reenfileiramento reabrem sem
-- ninguém precisar lembrar de limpar coluna nenhuma.
--
-- Para reexecutar o portão à mão sem mexer na fila:
--
--   update public.courses set quality_gate_claimed_at = null where id = '…';
--
-- E se um dia existir um botão de reavaliar, ele faz esse mesmo update antes de
-- chamar a função.

alter table public.courses
  add column if not exists quality_gate_claimed_at timestamptz;

comment on column public.courses.quality_gate_claimed_at is
  'Quando o portão de qualidade foi reivindicado para este fechamento do curso. Nulo = ainda não rodou. A fila voltar a se mexer depois desta data reabre o portão sozinha; zerar a coluna reexecuta à mão.';

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
     and not exists (
       select 1
         from public.course_generation_jobs
        where course_id = p_course_id
          and status in ('pending', 'running')
     )
     and (
       quality_gate_claimed_at is null
       -- Um fechamento NOVO reabre o portão. `updated_at` avança a cada
       -- mudança de job, e a reivindicação acontece depois da última delas —
       -- então, dentro de um mesmo fechamento, o segundo worker sempre encontra
       -- `claimed_at` mais recente que a fila e desiste. Se a fila voltar a se
       -- mexer depois disso, é outra rodada.
       or quality_gate_claimed_at < (
            select max(updated_at)
              from public.course_generation_jobs
             where course_id = p_course_id
          )
     )
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

-- Ver a nota de permissão em 20260908220000: o EXECUTE do service_role só
-- sobreviveria por default privileges, que é dependência invisível. MEDIDO: sem
-- elas, `revoke ... from public` deixa o service_role sem execute.
revoke all on function public.try_claim_quality_gate(uuid) from public, anon, authenticated;
grant execute on function public.try_claim_quality_gate(uuid) to service_role;
