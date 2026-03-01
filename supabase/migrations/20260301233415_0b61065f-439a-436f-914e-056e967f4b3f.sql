-- Storage bucket for course exports and certificates
INSERT INTO storage.buckets (id, name, public) VALUES ('course-exports', 'course-exports', false) ON CONFLICT (id) DO NOTHING;

-- RLS: owners can read their own exports
CREATE POLICY "Users can read own exports" ON storage.objects FOR SELECT USING (
  bucket_id = 'course-exports' AND auth.uid()::text = (storage.foldername(name))[1]
);

-- RLS: service role inserts (edge functions use service key, so we allow insert for authenticated too)
CREATE POLICY "Users can insert own exports" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'course-exports' AND auth.uid()::text = (storage.foldername(name))[1]
);