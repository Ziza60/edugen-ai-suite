-- Revoke execute from authenticated role for security definer functions
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_subscription() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_workspace_member_role() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_workspace_invite_role() FROM authenticated;
