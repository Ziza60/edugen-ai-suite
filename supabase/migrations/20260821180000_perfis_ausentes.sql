-- ═══════════════════════════════════════════════════════════════════════════
-- O PERFIL QUE NUNCA EXISTIU
--
-- A conta que gerou 33 cursos não tinha linha em `public.profiles`. Existia em
-- `auth.users`, era Pro, usava o app todo dia — e não tinha perfil. O gatilho
-- `on_auth_user_created`, que cria o perfil no cadastro, só passou a existir em
-- 01/03/2026; contas anteriores a ele nunca ganharam um.
--
-- Ficou inofensivo por meses porque quase nada depende de `profiles`. O que
-- depende é o `is_dev`, e ele só é consultado quando um limite de plano está
-- prestes a barrar alguém. Foi exatamente o que aconteceu em agosto de 2026: a
-- conta bateu os 12 cursos do Pro pela primeira vez, o app foi ler `is_dev`, não
-- achou perfil e concluiu "não é dev". O bloqueio estava certo; o dado, ausente.
--
-- Duas coisas aqui.
--
-- 1. BACKFILL. Toda conta de `auth.users` sem perfil ganha um, com os mesmos
--    dados que o gatilho usaria. `is_dev` fica no padrão (false): esta migração
--    conserta uma ausência, não distribui privilégio.
--
-- 2. O GATILHO PASSA A SER IDEMPOTENTE. Como estava, um INSERT sobre uma conta
--    que já tivesse perfil violava o UNIQUE de `user_id` e derrubava a criação
--    do usuário inteira — o cadastro falharia por causa de uma linha duplicada.
--    Com ON CONFLICT DO NOTHING, o perfil existente é respeitado e o cadastro
--    segue. É o que torna o backfill acima seguro de rodar quantas vezes for.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.profiles (user_id, full_name, avatar_url)
SELECT
  u.id,
  COALESCE(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    ''
  ),
  COALESCE(u.raw_user_meta_data ->> 'avatar_url', '')
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.user_id = u.id
)
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name',
      ''
    ),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', '')
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
