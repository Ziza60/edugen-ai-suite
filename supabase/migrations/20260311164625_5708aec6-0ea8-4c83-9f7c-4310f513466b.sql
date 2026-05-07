
-- Review sessions: each course can have one active review link
CREATE TABLE public.course_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  review_token text NOT NULL DEFAULT (gen_random_uuid())::text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE(course_id),
  UNIQUE(review_token)
);

ALTER TABLE public.course_reviews ENABLE ROW LEVEL SECURITY;

-- Owner manages reviews
CREATE POLICY "Users can view own reviews"
  ON public.course_reviews FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reviews"
  ON public.course_reviews FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reviews"
  ON public.course_reviews FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own reviews"
  ON public.course_reviews FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Public can view active reviews by token
CREATE POLICY "Public can view active reviews by token"
  ON public.course_reviews FOR SELECT TO public
  USING (is_active = true);

-- Review comments: anonymous reviewers leave comments per module
CREATE TABLE public.review_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.course_reviews(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.course_modules(id) ON DELETE CASCADE,
  reviewer_name text NOT NULL DEFAULT 'Anônimo',
  comment text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.review_comments ENABLE ROW LEVEL SECURITY;

-- Anyone can insert comments (reviewers are anonymous)
CREATE POLICY "Anyone can insert review comments"
  ON public.review_comments FOR INSERT TO public
  WITH CHECK (true);

-- Public can view comments of active reviews
CREATE POLICY "Public can view review comments"
  ON public.review_comments FOR SELECT TO public
  USING (true);

-- Owner can update (resolve) comments
CREATE POLICY "Owner can update review comments"
  ON public.review_comments FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.course_reviews r
    WHERE r.id = review_comments.review_id AND r.user_id = auth.uid()
  ));

-- Owner can delete comments
CREATE POLICY "Owner can delete review comments"
  ON public.review_comments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.course_reviews r
    WHERE r.id = review_comments.review_id AND r.user_id = auth.uid()
  ));
