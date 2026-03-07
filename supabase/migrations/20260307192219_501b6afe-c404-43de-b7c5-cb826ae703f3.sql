CREATE TABLE public.pptx_export_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  passed boolean NOT NULL DEFAULT false,
  quality_score numeric NOT NULL DEFAULT 0,
  blocked_reason text,
  pipeline_version text,
  checkpoints jsonb NOT NULL DEFAULT '{}'::jsonb,
  problematic_slides jsonb NOT NULL DEFAULT '[]'::jsonb,
  corrections_attempted jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  forensic_trace jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.pptx_export_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own export reports"
  ON public.pptx_export_reports FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert export reports"
  ON public.pptx_export_reports FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.cleanup_old_export_reports()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public'
AS $$
BEGIN
  DELETE FROM public.pptx_export_reports
  WHERE id IN (
    SELECT id FROM public.pptx_export_reports
    WHERE course_id = NEW.course_id
    ORDER BY created_at DESC
    OFFSET 5
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cleanup_old_export_reports
  AFTER INSERT ON public.pptx_export_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_old_export_reports();