-- ══════════════════════════════════════════════════════════════════════
-- Session proofs for the July/August ONLINE months
--
-- A self check-in tap alone cannot show that a Google Meet class was
-- actually conducted. Teachers now attach evidence to each checked-in
-- session — a screenshot of the Meet participant grid and/or the Meet
-- link — and the admin verify dialog shows that evidence next to the
-- IN/OUT times before the day is verified.
--
-- Run BY HAND in the Supabase SQL editor (project convention — migrations
-- are never auto-applied).
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. Private storage bucket for proof screenshots ─────────────────────
-- Client compresses screenshots before upload; 5 MB is a hard ceiling.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'session-proofs',
  'session-proofs',
  false,
  5242880,  -- 5 MB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = 5242880,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "session_proofs_staff_upload" ON storage.objects;
DROP POLICY IF EXISTS "session_proofs_staff_read"   ON storage.objects;
DROP POLICY IF EXISTS "session_proofs_admin_manage" ON storage.objects;

-- Staff upload straight from the browser (bypasses the serverless body
-- limit, same pattern as lesson-plans); staff read via signed URLs.
CREATE POLICY "session_proofs_staff_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'session-proofs' AND public.app_role() IN ('admin', 'accountant', 'teacher'));

CREATE POLICY "session_proofs_staff_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'session-proofs' AND public.app_role() IN ('admin', 'accountant', 'teacher'));

CREATE POLICY "session_proofs_admin_manage"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'session-proofs' AND public.app_role() = 'admin')
  WITH CHECK (bucket_id = 'session-proofs' AND public.app_role() = 'admin');

-- ── 2. Proof metadata table ─────────────────────────────────────────────
-- Keyed by (teacher_id, date, session) — the same natural key the admin
-- override/verify flow uses — so a proof survives admin time corrections.
-- Multiple proofs per session are allowed (e.g. start + end screenshots).
CREATE TABLE IF NOT EXISTS public.session_proofs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id       text NOT NULL,
  date             date NOT NULL,
  session          text NOT NULL CHECK (session IN ('morning','afternoon','full','evening','edu-makeup','cibis')),
  storage_path     text,      -- object in the session-proofs bucket
  meet_link        text,      -- Google Meet / recording URL
  note             text,      -- free-text remark ("covered lesson 4", ...)
  class_label      text,      -- which course/class was taught
  students_present integer CHECK (students_present IS NULL OR (students_present >= 0 AND students_present <= 500)),
  uploaded_by      text NOT NULL,                    -- uploader's email
  created_at       timestamptz NOT NULL DEFAULT now(), -- server-set; late uploads stay visible
  -- A proof must carry actual evidence, not just a note.
  CONSTRAINT session_proofs_has_evidence CHECK (storage_path IS NOT NULL OR meet_link IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS session_proofs_teacher_date_idx
  ON public.session_proofs (teacher_id, date);
CREATE INDEX IF NOT EXISTS session_proofs_date_idx
  ON public.session_proofs (date);

-- ── 3. RLS: staff read; ALL writes go through the service-role API route
--        (/api/session-proofs) which enforces ownership + record matching.
ALTER TABLE public.session_proofs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_proofs_staff_select" ON public.session_proofs;
CREATE POLICY "session_proofs_staff_select"
  ON public.session_proofs FOR SELECT TO authenticated
  USING (public.app_role() IN ('admin', 'accountant', 'teacher'));
-- No INSERT/UPDATE/DELETE policies on purpose: only the service role writes.
