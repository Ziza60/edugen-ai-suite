
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
