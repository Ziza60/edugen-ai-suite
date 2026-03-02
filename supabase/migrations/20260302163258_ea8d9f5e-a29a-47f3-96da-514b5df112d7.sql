
-- Table to store uploaded source files metadata
CREATE TABLE public.course_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  filename text NOT NULL,
  file_path text NOT NULL,
  content_type text NOT NULL DEFAULT 'text/plain',
  char_count integer NOT NULL DEFAULT 0,
  extracted_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.course_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own course sources"
  ON public.course_sources FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own course sources"
  ON public.course_sources FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own course sources"
  ON public.course_sources FOR DELETE
  USING (auth.uid() = user_id);

-- Add use_sources flag to courses table
ALTER TABLE public.courses ADD COLUMN use_sources boolean NOT NULL DEFAULT false;

-- Storage bucket for source files
INSERT INTO storage.buckets (id, name, public) VALUES ('course-sources', 'course-sources', false);

CREATE POLICY "Users can upload own source files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'course-sources'
    AND auth.uid()::text = (string_to_array(name, '/'))[1]
  );

CREATE POLICY "Users can view own source files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'course-sources'
    AND auth.uid()::text = (string_to_array(name, '/'))[1]
  );

CREATE POLICY "Users can delete own source files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'course-sources'
    AND auth.uid()::text = (string_to_array(name, '/'))[1]
  );
