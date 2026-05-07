-- 1. Melhorar a estrutura da tabela workspaces
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Garantir que a função de atualização de timestamp existe
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 3. Adicionar gatilhos de updated_at onde estão faltando
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_workspaces_updated_at') THEN
    CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON public.workspaces
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_course_landings_updated_at') THEN
    CREATE TRIGGER update_course_landings_updated_at BEFORE UPDATE ON public.course_landings
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- 4. Revogar execução pública de funções SECURITY DEFINER (Melhoria de Segurança)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_subscription() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_subscription() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_export_reports() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_export_reports() FROM anon;

-- 5. Garantir integridade referencial com ON DELETE CASCADE
-- Algumas tabelas podem ter sido criadas sem CASCADE em migrações anteriores

-- course_sources
ALTER TABLE public.course_sources 
  DROP CONSTRAINT IF EXISTS course_sources_course_id_fkey,
  ADD CONSTRAINT course_sources_course_id_fkey 
    FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;

-- tutor_sessions
ALTER TABLE public.tutor_sessions 
  DROP CONSTRAINT IF EXISTS tutor_sessions_course_id_fkey,
  ADD CONSTRAINT tutor_sessions_course_id_fkey 
    FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;

-- review_comments
ALTER TABLE public.review_comments 
  DROP CONSTRAINT IF EXISTS review_comments_review_id_fkey,
  ADD CONSTRAINT review_comments_review_id_fkey 
    FOREIGN KEY (review_id) REFERENCES public.course_reviews(id) ON DELETE CASCADE;

ALTER TABLE public.review_comments 
  DROP CONSTRAINT IF EXISTS review_comments_module_id_fkey,
  ADD CONSTRAINT review_comments_module_id_fkey 
    FOREIGN KEY (module_id) REFERENCES public.course_modules(id) ON DELETE CASCADE;

-- 6. Adicionar índices para performance se não existirem
CREATE INDEX IF NOT EXISTS idx_course_landings_slug ON public.course_landings(slug);
CREATE INDEX IF NOT EXISTS idx_courses_status ON public.courses(status);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON public.workspaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON public.workspace_members(user_id);
