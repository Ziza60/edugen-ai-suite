-- 1. Criar buckets de armazenamento se não existirem
INSERT INTO storage.buckets (id, name, public)
VALUES 
  ('avatars', 'avatars', true),
  ('course-images', 'course-images', true),
  ('certificates', 'certificates', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Remover políticas antigas se existirem (para evitar erros de duplicidade)
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Course images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload course images" ON storage.objects;
DROP POLICY IF EXISTS "Users can access their own course sources" ON storage.objects;
DROP POLICY IF EXISTS "Users can access their own course exports" ON storage.objects;

-- 3. Políticas para o bucket 'avatars'
CREATE POLICY "Avatar images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'avatars' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'avatars' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

-- 4. Políticas para o bucket 'course-images'
CREATE POLICY "Course images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'course-images');

CREATE POLICY "Authenticated users can upload course images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'course-images' AND 
  auth.role() = 'authenticated'
);

-- 5. Políticas para 'course-sources' (Privado)
CREATE POLICY "Users can access their own course sources"
ON storage.objects FOR ALL
USING (
  bucket_id = 'course-sources' AND 
  (auth.uid()::text = (storage.foldername(name))[1])
);

-- 6. Políticas para 'course-exports' (Privado)
CREATE POLICY "Users can access their own course exports"
ON storage.objects FOR ALL
USING (
  bucket_id = 'course-exports' AND 
  (auth.uid()::text = (storage.foldername(name))[1])
);

-- 7. Reforço de RLS nas tabelas públicas

-- pptx_export_reports
DROP POLICY IF EXISTS "Service role can insert export reports" ON public.pptx_export_reports;
DROP POLICY IF EXISTS "Authenticated users can insert export reports" ON public.pptx_export_reports;
CREATE POLICY "Authenticated users can insert export reports"
ON public.pptx_export_reports
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

-- tutor_sessions
DROP POLICY IF EXISTS "Anyone can insert tutor sessions" ON public.tutor_sessions;
DROP POLICY IF EXISTS "Anyone can insert tutor sessions for valid courses" ON public.tutor_sessions;
CREATE POLICY "Anyone can insert tutor sessions for valid courses"
ON public.tutor_sessions
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.courses 
    WHERE id = course_id AND status = 'published'
  )
);

-- review_comments
DROP POLICY IF EXISTS "Anyone can insert review comments" ON public.review_comments;
DROP POLICY IF EXISTS "Anyone can insert review comments for active reviews" ON public.review_comments;
CREATE POLICY "Anyone can insert review comments for active reviews"
ON public.review_comments
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.course_reviews 
    WHERE id = review_id AND is_active = true
  )
);
