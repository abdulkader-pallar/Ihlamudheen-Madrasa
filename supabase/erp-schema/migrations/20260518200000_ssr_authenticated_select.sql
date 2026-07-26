-- ============================================================
-- Grant authenticated role access to student_self_reports.
--
-- The previous tightening migration (20260517000000) scoped all
-- SSR policies TO anon only.  Teachers sign in via Supabase Auth
-- (src/app/login/page.tsx) and operate as `authenticated`, so the
-- dashboard's SELECT silently returned zero rows — student
-- submissions were invisible.
--
-- This also fixes a shared-browser case where a stored teacher
-- session caused the /student portal's writes to fail RLS, making
-- submissions appear to vanish after a refresh.
-- ============================================================

CREATE POLICY "ssr_auth_select"
  ON public.student_self_reports
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "ssr_auth_insert"
  ON public.student_self_reports
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "ssr_auth_update"
  ON public.student_self_reports
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
