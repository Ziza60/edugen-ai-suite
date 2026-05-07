
-- =============================================
-- EduGen AI - Complete Database Schema
-- =============================================

-- 1. Subscription plan enum
CREATE TYPE public.subscription_plan AS ENUM ('free', 'pro');

-- 2. Course status enum
CREATE TYPE public.course_status AS ENUM ('draft', 'published');

-- 3. Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- =============================================
-- PROFILES
-- =============================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- SUBSCRIPTIONS
-- =============================================
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  plan subscription_plan NOT NULL DEFAULT 'free',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create free subscription on signup
CREATE OR REPLACE FUNCTION public.handle_new_subscription()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan)
  VALUES (NEW.id, 'free');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_subscription();

-- =============================================
-- COURSES
-- =============================================
CREATE TABLE public.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  theme TEXT,
  target_audience TEXT,
  tone TEXT,
  language TEXT NOT NULL DEFAULT 'pt-BR',
  status course_status NOT NULL DEFAULT 'draft',
  include_quiz BOOLEAN NOT NULL DEFAULT false,
  include_flashcards BOOLEAN NOT NULL DEFAULT false,
  include_images BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own courses" ON public.courses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own courses" ON public.courses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own courses" ON public.courses FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own courses" ON public.courses FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- COURSE MODULES
-- =============================================
CREATE TABLE public.course_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.course_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own course modules" ON public.course_modules
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.courses WHERE courses.id = course_modules.course_id AND courses.user_id = auth.uid())
  );
CREATE POLICY "Users can insert own course modules" ON public.course_modules
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.courses WHERE courses.id = course_modules.course_id AND courses.user_id = auth.uid())
  );
CREATE POLICY "Users can update own course modules" ON public.course_modules
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.courses WHERE courses.id = course_modules.course_id AND courses.user_id = auth.uid())
  );
CREATE POLICY "Users can delete own course modules" ON public.course_modules
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.courses WHERE courses.id = course_modules.course_id AND courses.user_id = auth.uid())
  );

CREATE TRIGGER update_course_modules_updated_at BEFORE UPDATE ON public.course_modules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- COURSE QUIZ QUESTIONS
-- =============================================
CREATE TABLE public.course_quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.course_modules(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]',
  correct_answer INTEGER NOT NULL DEFAULT 0,
  explanation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.course_quiz_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own quiz questions" ON public.course_quiz_questions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.course_modules m
      JOIN public.courses c ON c.id = m.course_id
      WHERE m.id = course_quiz_questions.module_id AND c.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own quiz questions" ON public.course_quiz_questions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.course_modules m
      JOIN public.courses c ON c.id = m.course_id
      WHERE m.id = course_quiz_questions.module_id AND c.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can delete own quiz questions" ON public.course_quiz_questions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.course_modules m
      JOIN public.courses c ON c.id = m.course_id
      WHERE m.id = course_quiz_questions.module_id AND c.user_id = auth.uid()
    )
  );

-- =============================================
-- COURSE FLASHCARDS
-- =============================================
CREATE TABLE public.course_flashcards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.course_modules(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.course_flashcards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own flashcards" ON public.course_flashcards
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.course_modules m
      JOIN public.courses c ON c.id = m.course_id
      WHERE m.id = course_flashcards.module_id AND c.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own flashcards" ON public.course_flashcards
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.course_modules m
      JOIN public.courses c ON c.id = m.course_id
      WHERE m.id = course_flashcards.module_id AND c.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can delete own flashcards" ON public.course_flashcards
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.course_modules m
      JOIN public.courses c ON c.id = m.course_id
      WHERE m.id = course_flashcards.module_id AND c.user_id = auth.uid()
    )
  );

-- =============================================
-- COURSE IMAGES
-- =============================================
CREATE TABLE public.course_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.course_modules(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.course_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own course images" ON public.course_images
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.course_modules m
      JOIN public.courses c ON c.id = m.course_id
      WHERE m.id = course_images.module_id AND c.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own course images" ON public.course_images
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.course_modules m
      JOIN public.courses c ON c.id = m.course_id
      WHERE m.id = course_images.module_id AND c.user_id = auth.uid()
    )
  );

-- =============================================
-- CERTIFICATES
-- =============================================
CREATE TABLE public.certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  student_name TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  template TEXT NOT NULL DEFAULT 'simple',
  custom_data JSONB DEFAULT '{}'
);

ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own certificates" ON public.certificates
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own certificates" ON public.certificates
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Public certificate validation" ON public.certificates
  FOR SELECT USING (true);

-- =============================================
-- USAGE EVENTS
-- =============================================
CREATE TABLE public.usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'course_created',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage events" ON public.usage_events
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service can insert usage events" ON public.usage_events
  FOR INSERT WITH CHECK (true);

-- Indexes
CREATE INDEX idx_usage_events_user_month ON public.usage_events (user_id, created_at);
CREATE INDEX idx_courses_user ON public.courses (user_id);
CREATE INDEX idx_course_modules_course ON public.course_modules (course_id);

-- Fix permissive INSERT policy on usage_events
DROP POLICY "Service can insert usage events" ON public.usage_events;
CREATE POLICY "Authenticated users can insert own usage events" ON public.usage_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);
ALTER TABLE public.profiles ADD COLUMN is_dev boolean NOT NULL DEFAULT false;-- Storage bucket for course exports and certificates
INSERT INTO storage.buckets (id, name, public) VALUES ('course-exports', 'course-exports', false) ON CONFLICT (id) DO NOTHING;

-- RLS: owners can read their own exports
CREATE POLICY "Users can read own exports" ON storage.objects FOR SELECT USING (
  bucket_id = 'course-exports' AND auth.uid()::text = (storage.foldername(name))[1]
);

-- RLS: service role inserts (edge functions use service key, so we allow insert for authenticated too)
CREATE POLICY "Users can insert own exports" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'course-exports' AND auth.uid()::text = (storage.foldername(name))[1]
);CREATE POLICY "Users can update own flashcards"
ON public.course_flashcards
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM course_modules m
    JOIN courses c ON c.id = m.course_id
    WHERE m.id = course_flashcards.module_id AND c.user_id = auth.uid()
  )
);
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
-- Ensure certificates are cascade-deleted when a course is deleted
ALTER TABLE public.certificates
  DROP CONSTRAINT IF EXISTS certificates_course_id_fkey,
  ADD CONSTRAINT certificates_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;UPDATE subscriptions SET plan = 'pro', updated_at = now() WHERE user_id = '389a5d7f-5d24-46ed-a315-e4e86ec53c3b'CREATE TABLE public.pptx_export_reports (
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

-- 1. Create tables first
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  owner_id uuid NOT NULL,
  plan text NOT NULL DEFAULT 'team',
  max_members int NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',
  invited_by uuid,
  joined_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  UNIQUE(workspace_id, user_id)
);
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_by uuid NOT NULL,
  accepted_at timestamptz,
  UNIQUE(workspace_id, email)
);
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

-- 2. Add workspace_id to courses
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_courses_workspace_id ON public.courses(workspace_id);

-- 3. Validation triggers
CREATE OR REPLACE FUNCTION public.validate_workspace_member_role()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.role NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'Invalid role: %', NEW.role;
  END IF;
  IF NEW.status NOT IN ('active', 'invited', 'removed') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_workspace_member
  BEFORE INSERT OR UPDATE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.validate_workspace_member_role();

CREATE OR REPLACE FUNCTION public.validate_workspace_invite_role()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'Invalid invite role: %', NEW.role;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_workspace_invite
  BEFORE INSERT OR UPDATE ON public.workspace_invites
  FOR EACH ROW EXECUTE FUNCTION public.validate_workspace_invite_role();

-- 4. Security definer helpers (tables exist now)
CREATE OR REPLACE FUNCTION public.is_workspace_member(_user_id uuid, _workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE user_id = _user_id AND workspace_id = _workspace_id AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(_user_id uuid, _workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE user_id = _user_id AND workspace_id = _workspace_id
      AND role IN ('owner', 'admin') AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_workspace()
RETURNS TABLE(workspace_id uuid, workspace_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT wm.workspace_id, w.name, wm.role
  FROM public.workspace_members wm
  JOIN public.workspaces w ON w.id = wm.workspace_id
  WHERE wm.user_id = auth.uid() AND wm.status = 'active'
  LIMIT 1;
$$;

-- 5. RLS policies
CREATE POLICY "workspace_select" ON public.workspaces FOR SELECT
  USING (public.is_workspace_member(auth.uid(), id));
CREATE POLICY "workspace_insert" ON public.workspaces FOR INSERT
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "workspace_update" ON public.workspaces FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "members_select" ON public.workspace_members FOR SELECT
  USING (public.is_workspace_member(auth.uid(), workspace_id));
CREATE POLICY "members_insert" ON public.workspace_members FOR INSERT
  WITH CHECK (public.is_workspace_admin(auth.uid(), workspace_id));
CREATE POLICY "members_update" ON public.workspace_members FOR UPDATE
  USING (public.is_workspace_admin(auth.uid(), workspace_id));

CREATE POLICY "invites_select" ON public.workspace_invites FOR SELECT
  USING (public.is_workspace_member(auth.uid(), workspace_id));
CREATE POLICY "invites_insert" ON public.workspace_invites FOR INSERT
  WITH CHECK (created_by = auth.uid() AND public.is_workspace_admin(auth.uid(), workspace_id));

CREATE POLICY "courses_workspace_select" ON public.courses FOR SELECT
  USING (workspace_id IS NOT NULL AND public.is_workspace_member(auth.uid(), workspace_id));
DROP POLICY IF EXISTS "courses_workspace_select" ON public.courses;

CREATE POLICY "courses_workspace_member_select" ON public.courses FOR SELECT
  USING (
    workspace_id IS NOT NULL
    AND public.is_workspace_member(auth.uid(), workspace_id)
  );-- Tabela para armazenar cache de respostas da IA
CREATE TABLE IF NOT EXISTS public.ai_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    input_hash TEXT UNIQUE NOT NULL,
    model TEXT NOT NULL,
    action_type TEXT,
    prompt_preview TEXT, -- Apenas para debug humano, não usado na lógica
    response_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_ai_cache_hash ON public.ai_cache(input_hash);

-- Habilitar RLS
ALTER TABLE public.ai_cache ENABLE ROW LEVEL SECURITY;

-- Políticas: Apenas o service role (backend) pode ler/escrever por padrão, 
-- mas vamos permitir select para usuários autenticados se quisermos cache compartilhado (ex: Tutor IA)
CREATE POLICY "Enable read access for authenticated users" ON public.ai_cache
    FOR SELECT TO authenticated USING (true);

-- Função de limpeza opcional para cache antigo (pode ser executada via cron no futuro)
-- DELETE FROM public.ai_cache WHERE created_at < now() - interval '30 days';
-- Add 'starter' value to the subscription_plan enum
-- This needs to be committed before it can be used in other commands within the same transaction
ALTER TYPE public.subscription_plan ADD VALUE IF NOT EXISTS 'starter';
-- Add new columns to course_landings
ALTER TABLE public.course_landings 
ADD COLUMN IF NOT EXISTS template_id TEXT DEFAULT 'template1',
ADD COLUMN IF NOT EXISTS custom_colors JSONB DEFAULT '{"primary": "#7c3aed"}'::jsonb,
ADD COLUMN IF NOT EXISTS layout_blocks JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS custom_css TEXT,
ADD COLUMN IF NOT EXISTS custom_domain TEXT,
ADD COLUMN IF NOT EXISTS show_branding BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Create a permissions table for landing page features
CREATE TABLE IF NOT EXISTS public.landing_page_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan public.subscription_plan UNIQUE NOT NULL,
  can_change_layout BOOLEAN DEFAULT false,
  can_use_drag_drop BOOLEAN DEFAULT false,
  can_add_custom_blocks BOOLEAN DEFAULT false,
  can_use_custom_domain BOOLEAN DEFAULT false,
  can_remove_branding BOOLEAN DEFAULT false,
  can_use_custom_css BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.landing_page_permissions ENABLE ROW LEVEL SECURITY;

-- Insert default permissions
INSERT INTO public.landing_page_permissions (plan, can_change_layout, can_use_drag_drop, can_add_custom_blocks, can_use_custom_domain, can_remove_branding, can_use_custom_css)
VALUES 
  ('free', false, false, false, false, false, false),
  ('starter', true, true, false, false, false, false),
  ('pro', true, true, true, true, true, true)
ON CONFLICT (plan) DO UPDATE SET
  can_change_layout = EXCLUDED.can_change_layout,
  can_use_drag_drop = EXCLUDED.can_use_drag_drop,
  can_add_custom_blocks = EXCLUDED.can_add_custom_blocks,
  can_use_custom_domain = EXCLUDED.can_use_custom_domain,
  can_remove_branding = EXCLUDED.can_remove_branding,
  can_use_custom_css = EXCLUDED.can_use_custom_css;

-- Policies for landing_page_permissions (everyone can read)
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Landing page permissions are viewable by everyone' AND tablename = 'landing_page_permissions') THEN
    CREATE POLICY "Landing page permissions are viewable by everyone" 
    ON public.landing_page_permissions FOR SELECT USING (true);
  END IF;
END $$;
