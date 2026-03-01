
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
