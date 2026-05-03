-- Fix course_sources table:
-- 1. Drop FK constraint so temp course IDs (frontend UUIDs before course creation) work
-- 2. Add missing columns that the edge functions expect

ALTER TABLE public.course_sources
  DROP CONSTRAINT IF EXISTS course_sources_course_id_fkey;

ALTER TABLE public.course_sources ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.course_sources ADD COLUMN IF NOT EXISTS file_path text;
ALTER TABLE public.course_sources ADD COLUMN IF NOT EXISTS content_type text DEFAULT 'text/plain';
ALTER TABLE public.course_sources ADD COLUMN IF NOT EXISTS char_count integer DEFAULT 0;
ALTER TABLE public.course_sources ADD COLUMN IF NOT EXISTS extracted_text text;

-- RLS policies for the full schema
DROP POLICY IF EXISTS "Users can view own course sources" ON public.course_sources;
DROP POLICY IF EXISTS "Users can insert own course sources" ON public.course_sources;
DROP POLICY IF EXISTS "Users can delete own course sources" ON public.course_sources;

CREATE POLICY "Users can view own course sources"
  ON public.course_sources FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert own course sources"
  ON public.course_sources FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can delete own course sources"
  ON public.course_sources FOR DELETE
  USING (auth.uid() = user_id);
