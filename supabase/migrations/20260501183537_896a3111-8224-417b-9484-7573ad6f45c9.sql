-- Set secure search_path for functions with correct signatures
ALTER FUNCTION public.is_workspace_admin(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.is_workspace_member(uuid, uuid) SET search_path = public;

-- Also update others that might have failed in the previous batch
ALTER FUNCTION public.cleanup_old_export_reports() SET search_path = public;
ALTER FUNCTION public.get_my_workspace() SET search_path = public;
ALTER FUNCTION public.handle_new_subscription() SET search_path = public;
ALTER FUNCTION public.validate_workspace_invite_role() SET search_path = public;
ALTER FUNCTION public.validate_workspace_member_role() SET search_path = public;

-- Revoke execute from public and authenticated for sensitive functions
REVOKE EXECUTE ON FUNCTION public.handle_new_subscription() FROM public, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_workspace_invite_role() FROM public, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_workspace_member_role() FROM public, authenticated;
