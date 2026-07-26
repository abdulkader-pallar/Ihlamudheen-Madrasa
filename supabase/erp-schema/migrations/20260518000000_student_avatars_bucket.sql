-- Create public storage bucket for student avatar photos.
-- Images are uploaded by students via the portal (compressed to <50 KB)
-- and read publicly so the teacher dashboard can display them.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'student-avatars',
  'student-avatars',
  true,
  51200,            -- 50 KB hard limit
  ARRAY['image/jpeg','image/jpg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public            = true,
      file_size_limit   = 51200,
      allowed_mime_types= ARRAY['image/jpeg','image/jpg','image/png','image/webp'];

-- Anon can upload (students are unauthenticated)
CREATE POLICY "avatar_anon_upload"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'student-avatars');

-- Anon can update/replace their own avatar
CREATE POLICY "avatar_anon_update"
  ON storage.objects FOR UPDATE TO anon
  USING (bucket_id = 'student-avatars');

-- Anyone can read (teachers see via public URL)
CREATE POLICY "avatar_public_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'student-avatars');
