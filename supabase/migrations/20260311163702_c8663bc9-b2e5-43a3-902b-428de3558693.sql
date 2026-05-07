
-- Table to store AI-generated landing page data for courses
CREATE TABLE public.course_landings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  slug text NOT NULL,
  headline text NOT NULL DEFAULT '',
  subtitle text NOT NULL DEFAULT '',
  benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL DEFAULT '',
  testimonial_name text NOT NULL DEFAULT '',
  testimonial_text text NOT NULL DEFAULT '',
  cta_text text NOT NULL DEFAULT 'Quero me inscrever',
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id),
  UNIQUE(slug)
);

ALTER TABLE public.course_landings ENABLE ROW LEVEL SECURITY;

-- Owner can CRUD
CREATE POLICY "Users can view own landings"
  ON public.course_landings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own landings"
  ON public.course_landings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own landings"
  ON public.course_landings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own landings"
  ON public.course_landings FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Public can view published landings by slug
CREATE POLICY "Public can view published landings"
  ON public.course_landings FOR SELECT TO public
  USING (is_published = true);
