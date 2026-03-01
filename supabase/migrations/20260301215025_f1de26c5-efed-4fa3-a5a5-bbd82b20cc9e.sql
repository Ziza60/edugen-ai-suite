
-- Fix permissive INSERT policy on usage_events
DROP POLICY "Service can insert usage events" ON public.usage_events;
CREATE POLICY "Authenticated users can insert own usage events" ON public.usage_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);
