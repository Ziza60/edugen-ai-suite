-- ═══════════════════════════════════════════════════════════════════════════
-- Fecha a tabela public.course_modules_backup_20260802
--
-- O QUE ACONTECEU
--
-- O Supabase acusou rls_disabled_in_public nessa tabela. Ela é um retrato de
-- course_modules tirado em 2026-08-02, provavelmente antes da refatoração que
-- dividiu a geração de curso em invocações independentes — precaução sensata na
-- hora, esquecida depois.
--
-- Sem RLS numa tabela do schema public, qualquer pessoa com a URL do projeto e a
-- chave anônima podia LER, ALTERAR e APAGAR tudo o que há nela. A chave anônima
-- não é segredo: ela vai no pacote do site e qualquer visitante a lê. Quem
-- protege os dados é a RLS. E o conteúdo aqui é o dos cursos do autor — o
-- produto que ele vende.
--
-- POR QUE ESTA TABELA EXISTIA SEM RLS
--
-- Porque foi criada fora das migrações, direto no banco. Todas as 25 tabelas
-- versionadas neste repositório já habilitam RLS na própria migração que as
-- cria; esta nunca passou por aqui. É o mesmo desencontro entre o histórico de
-- migrações e o banco real que fez o `supabase db push` falhar.
--
-- SEM POLÍTICA, DE PROPÓSITO
--
-- Habilitar RLS sem criar política nenhuma fecha a tabela para todo mundo que
-- chega pela chave anônima. É exatamente o que se quer: nada no aplicativo nem
-- nas edge functions lê esta tabela — verificado por busca no repositório
-- inteiro. Quem precisar dela para uma restauração usa a chave de serviço, que
-- passa por cima da RLS.
--
-- ISTO NÃO APAGA NADA
--
-- O retrato continua lá, intacto. Apagar é decisão do dono dos dados e vem
-- depois, sem pressa — o risco urgente é a exposição, e ela se fecha aqui.
-- ═══════════════════════════════════════════════════════════════════════════

alter table if exists public.course_modules_backup_20260802
  enable row level security;

comment on table public.course_modules_backup_20260802 is
  'Retrato de course_modules de 2026-08-02, criado fora das migrações. RLS '
  'habilitada sem políticas em 2026-08-18: fechada à chave anônima, acessível '
  'apenas pela chave de serviço. Nada no produto lê esta tabela — pode ser '
  'apagada quando o dono confirmar que a restauração não é mais necessária.';
