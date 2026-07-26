-- ══════════════════════════════════════════════════════════════════════
-- Lesson-plan / PPT uploads: direct-to-storage
--
-- Files are now uploaded by the browser straight to Supabase Storage (which
-- has no 4.5 MB serverless-request-body limit), then the server best-effort
-- mirrors them to Google Drive. Storage is the source of truth, so a teacher's
-- submission is always saved regardless of file size or Drive availability.
-- ══════════════════════════════════════════════════════════════════════

-- Private bucket; 100 MB per-file ceiling; common document/slide types.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lesson-plans',
  'lesson-plans',
  false,
  104857600,  -- 100 MB
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = 104857600,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Staff (admin/accountant/teacher) can upload; staff can read; admin manages.
DROP POLICY IF EXISTS "lesson_plans_staff_upload" ON storage.objects;
DROP POLICY IF EXISTS "lesson_plans_staff_read"   ON storage.objects;
DROP POLICY IF EXISTS "lesson_plans_admin_manage" ON storage.objects;

CREATE POLICY "lesson_plans_staff_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lesson-plans' AND public.app_role() IN ('admin', 'accountant', 'teacher'));

CREATE POLICY "lesson_plans_staff_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'lesson-plans' AND public.app_role() IN ('admin', 'accountant', 'teacher'));

CREATE POLICY "lesson_plans_admin_manage"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'lesson-plans' AND public.app_role() = 'admin')
  WITH CHECK (bucket_id = 'lesson-plans' AND public.app_role() = 'admin');

-- Keep the Supabase storage path alongside any Drive link, so the file stays
-- accessible even when Drive is unconfigured or its upload is skipped.
ALTER TABLE public.lesson_plan_submissions
  ADD COLUMN IF NOT EXISTS lesson_plan_path text,
  ADD COLUMN IF NOT EXISTS ppt_path text;
