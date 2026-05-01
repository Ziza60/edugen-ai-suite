-- 1. Recriar gatilhos de timestamp (updated_at)
DO $$ 
BEGIN
    -- Profiles
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_profiles_updated_at') THEN
        CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
    END IF;

    -- Courses
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_courses_updated_at') THEN
        CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON public.courses
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
    END IF;

    -- Course Modules
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_course_modules_updated_at') THEN
        CREATE TRIGGER update_course_modules_updated_at BEFORE UPDATE ON public.course_modules
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
    END IF;

    -- Workspaces
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_workspaces_updated_at') THEN
        CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON public.workspaces
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
    END IF;
END $$;

-- 2. Recriar gatilhos de validação de workspace com os nomes de funções corretos
DO $$
BEGIN
    -- Workspace Members
    DROP TRIGGER IF EXISTS trg_validate_workspace_member ON public.workspace_members;
    CREATE TRIGGER trg_validate_workspace_member 
    BEFORE INSERT OR UPDATE ON public.workspace_members
    FOR EACH ROW EXECUTE FUNCTION public.validate_workspace_member_role();

    -- Workspace Invites
    DROP TRIGGER IF EXISTS trg_validate_workspace_invite ON public.workspace_invites;
    CREATE TRIGGER trg_validate_workspace_invite 
    BEFORE INSERT OR UPDATE ON public.workspace_invites
    FOR EACH ROW EXECUTE FUNCTION public.validate_workspace_invite_role();
END $$;
