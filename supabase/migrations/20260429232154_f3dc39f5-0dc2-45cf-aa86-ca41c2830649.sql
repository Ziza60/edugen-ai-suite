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
