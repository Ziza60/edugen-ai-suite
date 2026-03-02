-- Ensure certificates are cascade-deleted when a course is deleted
ALTER TABLE public.certificates
  DROP CONSTRAINT IF EXISTS certificates_course_id_fkey,
  ADD CONSTRAINT certificates_course_id_fkey
    FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;