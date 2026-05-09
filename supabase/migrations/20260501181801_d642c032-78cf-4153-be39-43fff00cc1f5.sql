-- Revoke execute from public and anon for security definer functions
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_subscription() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_subscription() FROM anon;
GRANT EXECUTE ON FUNCTION public.handle_new_subscription() TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon;

REVOKE EXECUTE ON FUNCTION public.validate_workspace_member_role() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_workspace_member_role() FROM anon;

REVOKE EXECUTE ON FUNCTION public.validate_workspace_invite_role() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_workspace_invite_role() FROM anon;
