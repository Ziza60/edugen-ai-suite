CREATE POLICY "Users can update own flashcards"
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