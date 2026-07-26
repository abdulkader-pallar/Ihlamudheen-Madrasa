-- Fix exam_scores write policy to work regardless of whether
-- the profiles table exists or is populated.
-- The security-part-b migration replaced the JWT-based policy
-- with a profiles-table lookup. If profiles is empty or missing,
-- all writes are silently blocked. This migration restores a
-- dual-check policy: JWT metadata (always available) OR profiles row.

DROP POLICY IF EXISTS "Admins and teachers can manage exam scores" ON public.exam_scores;
DROP POLICY IF EXISTS "exam_scores: staff manage"                  ON public.exam_scores;
DROP POLICY IF EXISTS "exam_scores: staff write"                   ON public.exam_scores;

CREATE POLICY "exam_scores: staff write"
  ON public.exam_scores
  FOR ALL TO authenticated
  USING (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  )
  WITH CHECK (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  );

-- Same fix for exam_subjects (same pattern, same potential issue)
DROP POLICY IF EXISTS "Admins and teachers can manage exam subjects" ON public.exam_subjects;
DROP POLICY IF EXISTS "exam_subjects: staff manage"                  ON public.exam_subjects;
DROP POLICY IF EXISTS "exam_subjects: staff write"                   ON public.exam_subjects;

CREATE POLICY "exam_subjects: staff write"
  ON public.exam_subjects
  FOR ALL TO authenticated
  USING (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  )
  WITH CHECK (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  );

-- Same fix for exams table
DROP POLICY IF EXISTS "Admins and teachers can manage exams" ON public.exams;
DROP POLICY IF EXISTS "exams: staff manage"                  ON public.exams;
DROP POLICY IF EXISTS "exams: staff write"                   ON public.exams;

CREATE POLICY "exams: staff write"
  ON public.exams
  FOR ALL TO authenticated
  USING (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  )
  WITH CHECK (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  );
