DROP POLICY IF EXISTS "courses_workspace_select" ON public.courses;

CREATE POLICY "courses_workspace_member_select" ON public.courses FOR SELECT
  USING (
    workspace_id IS NOT NULL
    AND public.is_workspace_member(auth.uid(), workspace_id)
  );