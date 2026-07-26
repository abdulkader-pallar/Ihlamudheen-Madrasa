-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ Accountant = superset of Teacher                                  ║
-- ║                                                                    ║
-- ║ Product decision: every option/page a teacher can use (Quran      ║
-- ║ Recitation, Grade Book, …) must also work for accountants. The UI  ║
-- ║ role gates were widened to include 'accountant'; this migration    ║
-- ║ widens the matching RLS so accountant reads AND writes are not      ║
-- ║ rejected by the database.                                          ║
-- ║                                                                    ║
-- ║ Mirrors 20260603120000 (exam_*) and 20260607000000 (recitation),   ║
-- ║ adding 'accountant' alongside 'admin','teacher'. Idempotent:       ║
-- ║ DROP … IF EXISTS then CREATE, each guarded by to_regclass so it is  ║
-- ║ safe to run even if a table doesn't exist yet (avoids 42P01).      ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── recitation_sessions — staff (admin/accountant/teacher) manage; self-read ──
DO $$ BEGIN
  IF to_regclass('public.recitation_sessions') IS NOT NULL THEN
    DROP POLICY IF EXISTS "recitation_select" ON public.recitation_sessions;
    CREATE POLICY "recitation_select"
      ON public.recitation_sessions FOR SELECT TO authenticated
      USING (
        public.app_role() IN ('admin', 'accountant', 'teacher')
        OR student_id = (auth.jwt() -> 'user_metadata' ->> 'student_id')  -- self-read identifier, not a privilege
        OR student_id = auth.uid()::text
      );

    DROP POLICY IF EXISTS "recitation_staff_write" ON public.recitation_sessions;
    CREATE POLICY "recitation_staff_write"
      ON public.recitation_sessions FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'accountant', 'teacher'))
      WITH CHECK (public.app_role() IN ('admin', 'accountant', 'teacher'));
  END IF;
END $$;

-- ── exam_scores — staff manage; students read own ─────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.exam_scores') IS NOT NULL THEN
    DROP POLICY IF EXISTS "exam_scores_select"   ON public.exam_scores;
    DROP POLICY IF EXISTS "exam_scores: staff write" ON public.exam_scores;

    CREATE POLICY "exam_scores_select"
      ON public.exam_scores FOR SELECT TO authenticated
      USING (
        public.app_role() IN ('admin', 'accountant', 'teacher')
        OR student_id = (auth.jwt() -> 'user_metadata' ->> 'student_id')  -- self-read identifier, not a privilege
        OR student_id = auth.uid()::text
      );

    CREATE POLICY "exam_scores: staff write"
      ON public.exam_scores FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'accountant', 'teacher'))
      WITH CHECK (public.app_role() IN ('admin', 'accountant', 'teacher'));
  END IF;
END $$;

-- ── exam_subjects / exams — staff write ───────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.exam_subjects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "exam_subjects: staff write" ON public.exam_subjects;
    CREATE POLICY "exam_subjects: staff write"
      ON public.exam_subjects FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'accountant', 'teacher'))
      WITH CHECK (public.app_role() IN ('admin', 'accountant', 'teacher'));
  END IF;

  IF to_regclass('public.exams') IS NOT NULL THEN
    DROP POLICY IF EXISTS "exams: staff write" ON public.exams;
    CREATE POLICY "exams: staff write"
      ON public.exams FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'accountant', 'teacher'))
      WITH CHECK (public.app_role() IN ('admin', 'accountant', 'teacher'));
  END IF;
END $$;
