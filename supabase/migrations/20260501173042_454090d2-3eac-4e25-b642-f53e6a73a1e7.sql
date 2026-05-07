-- 1. Revogar execução pública
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.is_workspace_admin(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_workspace_admin(uuid, uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_my_workspace() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_workspace() FROM anon;

-- 2. Garantir acesso para usuários autenticados e service_role (necessário para as políticas de RLS funcionarem)
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_workspace() TO authenticated, service_role;

-- 3. Certificar-se de que os gatilhos de sistema não sejam acessíveis publicamente (já feito parcialmente, mas reforçando)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_subscription() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_subscription() FROM anon;
GRANT EXECUTE ON FUNCTION public.handle_new_subscription() TO service_role;
