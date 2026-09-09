-- Um módulo por posição do curso. É a única garantia REAL contra duplicação.
--
-- Em 08/09 o curso 4f278899 foi pedido com 8 módulos e gravado com 10. A causa
-- imediata estava no código (o claim recusava e o worker não sabia ler a
-- recusa; ver 20260908220000), mas a causa profunda é esta tabela aceitar duas
-- linhas na mesma posição do mesmo curso.
--
-- Todas as outras defesas — o claim atômico, o portão de execução única — são
-- redução de desperdício: elas evitam que dois workers façam o mesmo trabalho.
-- Só o índice único evita que o trabalho duplicado CHEGUE ao curso. Enquanto
-- ele não existir, qualquer corrida nova volta a produzir gêmeos.
--
-- Gêmeos são pior que desperdício. Cada um é uma chamada independente ao
-- modelo, com números próprios: o mesmo módulo aparece duas vezes no curso
-- dizendo coisas diferentes sobre o mesmo caso. O curso vira fábrica de
-- contradição — exatamente o defeito que a ponte de valores e o portão
-- existem para combater.
--
-- ─── ANTES DE RODAR ─────────────────────────────────────────────────────────
-- A criação do índice FALHA se já houver duplicata. Isso é de propósito: uma
-- migração que apaga dados do usuário em silêncio é pior que uma que para e
-- avisa. Para ver o que existe:
--
--   select course_id, order_index, count(*)
--     from public.course_modules
--    group by 1, 2 having count(*) > 1
--    order by 1, 2;
--
-- O caminho recomendado para o que aparecer é apagar e regerar o curso: os
-- gêmeos têm números independentes, e escolher um dos dois não conserta as
-- contradições que o outro já espalhou pelos módulos seguintes.
-- ────────────────────────────────────────────────────────────────────────────

create unique index if not exists course_modules_curso_ordem_uniq
  on public.course_modules (course_id, order_index);

comment on index public.course_modules_curso_ordem_uniq is
  'Um módulo por posição. O worker que perder a corrida recebe 23505 e descarta o que gerou (generate-course-module).';
