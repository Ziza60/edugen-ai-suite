-- ═══════════════════════════════════════════════════════════════════════════
-- Reconcilia o esquema declarado com o que o banco tem de fato
--
-- CONTEXTO
--
-- A tabela supabase_migrations.schema_migrations estava VAZIA: o CLI achava que
-- nenhuma das 34 migrações havia rodado e tentava aplicar todas desde a
-- primeira, batendo em "type subscription_plan already exists". Consequência
-- prática: toda mudança de banco virava SQL colado à mão no painel — que é como
-- nasce uma tabela sem RLS, exatamente o alerta que o Supabase enviou.
--
-- O histórico foi reparado marcando as 34 como aplicadas. Marcar é uma
-- AFIRMAÇÃO, não uma prova: se alguma não tivesse rodado, o CLI passaria a
-- pulá-la para sempre e faltaria um pedaço do esquema sem ninguém procurar.
--
-- Por isso a verificação: o inventário real de tabelas e colunas
-- (information_schema) foi comparado com tudo o que as 34 migrações declaram
-- criar. Ela achou duas divergências, corrigidas aqui.
--
-- 1) workspaces.updated_at — DECLARADA E AUSENTE
--
-- A migração 20260501071455 faz "ADD COLUMN IF NOT EXISTS updated_at" em
-- workspaces e cria o gatilho update_workspaces_updated_at sobre ela. A coluna
-- não existe no banco: essa parte da migração nunca rodou.
--
-- Passou despercebida porque o recurso de workspaces está dormente — nada no
-- aplicativo nem nas edge functions consulta workspaces, workspace_members ou
-- workspace_invites. Mas o gatilho atribui NEW.updated_at, então o primeiro
-- UPDATE em workspaces, no dia em que o recurso for ligado, falharia. É
-- justamente o tipo de buraco que o reparo do histórico teria selado em
-- silêncio.
--
-- 2) course_sources.content — EXISTE E NÃO É DECLARADA
--
-- Coluna criada fora das migrações. Nada a lê nem a escreve: as funções que
-- usam course_sources selecionam filename e extracted_text. Fica declarada aqui
-- para o repositório descrever o banco com exatidão — enquanto houver coluna
-- que só existe no servidor, a comparação acima volta a acusar diferença e
-- ninguém saberá dizer se é resíduo ou defeito.
--
-- Sobre course_modules_backup_20260802: existe no banco sem migração que a
-- crie, de propósito. É um retrato de 2026-08-02, já fechado com RLS pela
-- migração anterior, e destinado a ser apagado quando o dono confirmar.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Fecha a lacuna real.
alter table public.workspaces
  add column if not exists updated_at timestamptz default now();

-- 2) Declara o que já existe, para o repositório e o banco pararem de divergir.
alter table public.course_sources
  add column if not exists content text;

comment on column public.course_sources.content is
  'Coluna criada fora das migrações e sem uso no produto — as funções leem '
  'filename e extracted_text. Declarada em 2026-08-18 apenas para o esquema '
  'do repositório bater com o banco. Candidata a remoção.';
