-- ============================================================
-- Supabase Storage: Student Photos (Private Bucket with RLS)
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Create private storage bucket for student photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'student-photos',
  'student-photos',
  false,  -- PRIVATE bucket (requires signed URLs)
  524288, -- 512KB max file size
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 524288,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- 2. RLS Policies for student-photos bucket
-- Only authenticated users can upload/read/delete

-- Allow authenticated users to upload photos
CREATE POLICY "Authenticated users can upload student photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'student-photos');

-- Allow authenticated users to read photos (via signed URLs)
CREATE POLICY "Authenticated users can read student photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'student-photos');

-- Allow authenticated users to update (overwrite) photos
CREATE POLICY "Authenticated users can update student photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'student-photos')
WITH CHECK (bucket_id = 'student-photos');

-- Only admins and instructors can delete photos
CREATE POLICY "Admin/instructor can delete student photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'student-photos'
  AND (public.is_admin() OR public.is_instructor())
);

-- ============================================================
-- Auth Settings (configure in Supabase Dashboard)
-- ============================================================
-- Go to Authentication > Settings and configure:
--
-- 1. PASSWORD STRENGTH:
--    - Minimum password length: 8
--    - Require uppercase, lowercase, numbers
--
-- 2. EMAIL VERIFICATION:
--    - Enable "Confirm email" toggle
--    - Customize email template with Ihlamudheen branding
--
-- 3. RATE LIMITING:
--    - Max sign-up attempts: 5 per hour
--    - Max sign-in attempts: 10 per hour
--
-- 4. GOOGLE OAUTH:
--    - Enable Google provider
--    - Add Google Client ID and Secret
--    - Set redirect URL
--
-- IMPORTANT: Never expose service_role key in frontend code!
-- Only use NEXT_PUBLIC_SUPABASE_ANON_KEY in the browser.
-- ============================================================
