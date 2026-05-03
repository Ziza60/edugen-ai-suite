-- Drop FK constraint on course_sources.course_id so that temp course IDs
-- (generated on the frontend before the course is saved) can be used.
-- generate-course reassociates sources to the real course_id after creation.
ALTER TABLE public.course_sources
  DROP CONSTRAINT IF EXISTS course_sources_course_id_fkey;
