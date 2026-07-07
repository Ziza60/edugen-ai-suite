-- Fix course_images: add UNIQUE constraint (required for upsert) + UPDATE/DELETE policies

ALTER TABLE public.course_images
  ADD CONSTRAINT course_images_module_id_key UNIQUE (module_id);

CREATE POLICY "Users can update own course images" ON public.course_images
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.course_modules m
      JOIN public.courses c ON c.id = m.course_id
      WHERE m.id = course_images.module_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own course images" ON public.course_images
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.course_modules m
      JOIN public.courses c ON c.id = m.course_id
      WHERE m.id = course_images.module_id AND c.user_id = auth.uid()
    )
  );
