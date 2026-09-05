-- ══════════════════════════════════════════════════════════════════════════
-- SECURITY: remove the last `user_metadata` fallbacks from role-based RLS.
--
-- WHY (Supabase Advisor "RLS references user metadata", CRITICAL):
--   The base schema (00-base-app-tables.sql, migration-staff-payments.sql)
--   gates writes on
--     coalesce(auth.jwt() -> 'app_metadata' ->> 'role',
--              auth.jwt() -> 'user_metadata' ->> 'role')
--   `user_metadata` is writable by the account holder via
--     supabase.auth.updateUser({ data: { role: 'admin' } })
--   so ANY signed-in account that has no app_metadata.role yet (i.e. anyone not
--   on the /api/auth/verify-user allow-list) falls through the coalesce and can
--   grant itself admin/teacher over classes, students, attendance, exams,
--   scores, teachers and assignments.
--
--   20260603120000_security_rls_app_metadata.sql fixed the payroll/fees/settings
--   policies but did not drop these older policy NAMES, so they survived
--   alongside the new ones (permissive policies OR together — the weakest wins).
--   20260624140000_meelad_fest_academic_year.sql then reintroduced the pattern
--   on app_settings. This migration closes both.
--
-- ⚠️  OPERATIONAL NOTE: app_metadata lands in a JWT only after the token
--     refreshes. Signed-in staff should sign out and back in (or wait ~1h).
--     Every legitimate role IS stamped into app_metadata by
--     /api/auth/verify-user, so no staff member loses access permanently.
-- ══════════════════════════════════════════════════════════════════════════

-- Authoritative role claim — app_metadata is service-role-only, not user-writable.
CREATE OR REPLACE FUNCTION public.app_role()
RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT auth.jwt() -> 'app_metadata' ->> 'role' $$;

-- Same defect inside the helper shipped by the consolidated one-shot dumps
-- (supabase/ihlamudheen-erp-full.sql). Redefined only if it is actually present.
DO $$ BEGIN
  IF to_regprocedure('public.erp_role()') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.erp_role()
      RETURNS text LANGUAGE sql STABLE
      AS $body$ SELECT auth.jwt() -> 'app_metadata' ->> 'role' $body$;
    $fn$;
  END IF;
END $$;

-- ── classes / students / student_attendance (00-base-app-tables.sql) ─────────
DO $$ BEGIN
  IF to_regclass('public.classes') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins and teachers can manage classes" ON public.classes;
    CREATE POLICY "Admins and teachers can manage classes"
      ON public.classes FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'teacher'));
  END IF;

  IF to_regclass('public.students') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins and teachers can manage students" ON public.students;
    CREATE POLICY "Admins and teachers can manage students"
      ON public.students FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'teacher'));
  END IF;

  IF to_regclass('public.student_attendance') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins and teachers can manage attendance" ON public.student_attendance;
    CREATE POLICY "Admins and teachers can manage attendance"
      ON public.student_attendance FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'teacher'));
  END IF;
END $$;

-- ── exams / exam_subjects / exam_scores — legacy names left over from the base
--    schema; the app already writes through the "…: staff write" policies added
--    in 20260603120000, so dropping these outright is safe. Recreated on
--    app_role() anyway so behaviour is unchanged for real staff. ─────────────
DO $$ BEGIN
  IF to_regclass('public.exams') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins and teachers can manage exams" ON public.exams;
    CREATE POLICY "Admins and teachers can manage exams"
      ON public.exams FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'teacher'));
  END IF;

  IF to_regclass('public.exam_subjects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins and teachers can manage exam subjects" ON public.exam_subjects;
    CREATE POLICY "Admins and teachers can manage exam subjects"
      ON public.exam_subjects FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'teacher'));
  END IF;

  IF to_regclass('public.exam_scores') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins and teachers can manage exam scores" ON public.exam_scores;
    CREATE POLICY "Admins and teachers can manage exam scores"
      ON public.exam_scores FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'teacher'));
  END IF;
END $$;

-- ── teachers / teacher_assignments (migration-staff-payments.sql) ────────────
DO $$ BEGIN
  IF to_regclass('public.teachers') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins can manage teachers" ON public.teachers;
    CREATE POLICY "Admins can manage teachers"
      ON public.teachers FOR ALL TO authenticated
      USING (public.app_role() = 'admin');
  END IF;

  IF to_regclass('public.teacher_assignments') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins can manage assignments" ON public.teacher_assignments;
    CREATE POLICY "Admins can manage assignments"
      ON public.teacher_assignments FOR ALL TO authenticated
      USING (public.app_role() = 'admin');
  END IF;
END $$;

-- ── fee_payments — legacy "admins manage fee_payments" (20260517400000). The
--    20260603120000 migration dropped it, but re-drop in case that ran first. ─
DO $$ BEGIN
  IF to_regclass('public.fee_payments') IS NOT NULL THEN
    DROP POLICY IF EXISTS "admins manage fee_payments" ON public.fee_payments;
  END IF;
END $$;

-- ── app_settings — 20260624140000 reintroduced the coalesce fallback ─────────
DO $$ BEGIN
  IF to_regclass('public.app_settings') IS NOT NULL THEN
    DROP POLICY IF EXISTS "settings_admin_write" ON public.app_settings;
    CREATE POLICY "settings_admin_write"
      ON public.app_settings FOR ALL TO authenticated
      USING (public.app_role() = 'admin')
      WITH CHECK (public.app_role() = 'admin');
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- STILL OPEN (deliberately not changed — needs a product decision):
--   `exam_scores_select` and `recitation_select` match a student's own rows with
--     student_id = (auth.jwt() -> 'user_metadata' ->> 'student_id')
--   That claim is also user-writable, so a signed-in account can set its own
--   student_id to someone else's and READ that student's marks/recitations.
--   No write escalation, but it is a read leak. Fixing it means moving
--   student_id into app_metadata (stamp it in /api/auth/verify-user) and
--   switching those policies to app_metadata — do that as its own change so the
--   student portal can be retested.
--
-- VERIFY AFTER APPLYING:
--   SELECT schemaname, tablename, policyname
--   FROM pg_policies
--   WHERE (qual ILIKE '%user_metadata%' OR with_check ILIKE '%user_metadata%')
--   ORDER BY tablename, policyname;
-- ──────────────────────────────────────────────────────────────────────────────
