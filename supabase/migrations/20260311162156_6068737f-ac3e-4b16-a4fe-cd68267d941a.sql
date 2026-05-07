
-- Add tutor columns to courses
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS tutor_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS tutor_slug text UNIQUE;

-- Create tutor_sessions table for anonymous logging
CREATE TABLE public.tutor_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  session_token text NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tutor_sessions ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (anonymous tutor usage)
CREATE POLICY "Anyone can insert tutor sessions"
  ON public.tutor_sessions FOR INSERT
  TO public
  WITH CHECK (true);

-- Course owner can view tutor sessions
CREATE POLICY "Course owner can view tutor sessions"
  ON public.tutor_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.courses
      WHERE courses.id = tutor_sessions.course_id
      AND courses.user_id = auth.uid()
    )
  );

-- Public read policy for courses by tutor_slug (needed for public tutor page)
CREATE POLICY "Public can view published courses by tutor_slug"
  ON public.courses FOR SELECT
  TO public
  USING (
    tutor_enabled = true
    AND tutor_slug IS NOT NULL
    AND status = 'published'
  );

-- Public can read modules of published tutor-enabled courses
CREATE POLICY "Public can view modules of tutor-enabled courses"
  ON public.course_modules FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.courses
      WHERE courses.id = course_modules.course_id
      AND courses.tutor_enabled = true
      AND courses.tutor_slug IS NOT NULL
      AND courses.status = 'published'
    )
  );
