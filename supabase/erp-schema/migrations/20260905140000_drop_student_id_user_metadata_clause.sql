-- ══════════════════════════════════════════════════════════════════════════
-- SECURITY: drop the last two `user_metadata` reads from RLS.
--
-- Closes the remaining Supabase Advisor "RLS references user metadata"
-- findings on public.exam_scores and public.recitation_sessions.
--
-- WHY THIS IS A ONE-LINE DELETE, NOT A MIGRATION OF THE CLAIM:
--   Both self-read policies matched a student's own rows two ways:
--     student_id = (auth.jwt() -> 'user_metadata' ->> 'student_id')   ← removed
--     student_id = auth.uid()::text                                    ← kept
--   Nothing in the codebase has ever WRITTEN user_metadata.student_id — not
--   verify-user, add-staff, setup-teachers, nor erp/users. The only readers,
--   app/dashboard/recitation/page.tsx and app/dashboard/report-card/page.tsx,
--   both do `user_metadata?.student_id || user.id`, so for every real user the
--   value is undefined and they fall through to user.id — which the
--   auth.uid()::text clause already covers.
--
--   So the clause never matched for a legitimate user. It could only ever match
--   for someone who set the claim on themselves — user_metadata is writable via
--   supabase.auth.updateUser({ data: { student_id: '<someone else>' } }) —
--   letting any signed-in account read another student's marks and recitation
--   assessments. Pure attack surface, zero function. Deleting it loses nothing.
--
-- Self-read via auth.uid() is unaffected, so the student/parent views keep
-- working exactly as before. Follows 20260905120000.
-- ══════════════════════════════════════════════════════════════════════════

-- ── recitation_sessions — staff read all; students read their own ────────────
DO $$ BEGIN
  IF to_regclass('public.recitation_sessions') IS NOT NULL THEN
    DROP POLICY IF EXISTS "recitation_select" ON public.recitation_sessions;
    CREATE POLICY "recitation_select"
      ON public.recitation_sessions FOR SELECT TO authenticated
      USING (
        public.app_role() IN ('admin', 'accountant', 'teacher')
        OR student_id = auth.uid()::text
      );
  END IF;
END $$;

-- ── exam_scores — staff read all; students read their own ────────────────────
DO $$ BEGIN
  IF to_regclass('public.exam_scores') IS NOT NULL THEN
    DROP POLICY IF EXISTS "exam_scores_select" ON public.exam_scores;
    CREATE POLICY "exam_scores_select"
      ON public.exam_scores FOR SELECT TO authenticated
      USING (
        public.app_role() IN ('admin', 'accountant', 'teacher')
        OR student_id = auth.uid()::text
      );
  END IF;
END $$;

-- VERIFY AFTER APPLYING — expect ZERO rows:
--   SELECT tablename, policyname
--   FROM pg_policies
--   WHERE qual ILIKE '%user_metadata%' OR with_check ILIKE '%user_metadata%'
--   ORDER BY tablename;
