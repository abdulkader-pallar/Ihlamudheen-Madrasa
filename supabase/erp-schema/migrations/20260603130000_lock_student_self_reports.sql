-- ══════════════════════════════════════════════════════════════════════════
-- SECURITY (audit H3): lock down student_self_reports.
--
-- Previously: anon could SELECT/INSERT/UPDATE every row (USING true) — anyone
-- with the public anon key could dump all students' activity logs or tamper
-- with any row.
--
-- Now: the student portal writes via the server route /api/student-report
-- (service role, validated against the roster and scoped to one student), so
-- the table needs NO anon access. Teachers/admins still read class reports
-- through their authenticated session.
--
-- Depends on public.app_role() from 20260603120000_security_rls_app_metadata.sql.
-- Ship AFTER deploying the portal change that routes reads/writes through the
-- API (so the portal never relies on anon access during the cutover).
-- ══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF to_regclass('public.student_self_reports') IS NOT NULL THEN
    -- Remove every prior anon/public policy.
    DROP POLICY IF EXISTS "student_self_reports_public" ON public.student_self_reports;
    DROP POLICY IF EXISTS "ssr_anon_select"  ON public.student_self_reports;
    DROP POLICY IF EXISTS "ssr_anon_insert"  ON public.student_self_reports;
    DROP POLICY IF EXISTS "ssr_anon_update"  ON public.student_self_reports;
    DROP POLICY IF EXISTS "ssr_service_delete" ON public.student_self_reports;
    DROP POLICY IF EXISTS "ssr_service_all"  ON public.student_self_reports;
    DROP POLICY IF EXISTS "ssr_staff_select" ON public.student_self_reports;

    -- Teachers/admins/accountants read class reports via authenticated session.
    CREATE POLICY "ssr_staff_select" ON public.student_self_reports
      FOR SELECT TO authenticated
      USING (public.app_role() IN ('admin', 'accountant', 'teacher'));

    -- All portal writes happen server-side via the service role API route.
    CREATE POLICY "ssr_service_all" ON public.student_self_reports
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
