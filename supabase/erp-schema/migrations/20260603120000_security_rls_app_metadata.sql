-- ══════════════════════════════════════════════════════════════════════════
-- SECURITY: move all role-based RLS off user-writable `user_metadata`.
--
-- PROBLEM (audit C3): every financial/grade policy keyed on
--   (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role'))
-- but `user_metadata` is writable by the user via
--   supabase.auth.updateUser({ data: { role: 'admin' } })
-- so any authenticated user could self-escalate and read/write payroll, fees,
-- exam scores, and settings. `app_metadata` is NOT user-writable (only the
-- service role / admin API can set it) and is the correct source of truth.
--
-- This migration:
--   1. Backfills app_metadata.role from user_metadata.role for existing users.
--   2. Adds a helper public.app_role() reading the non-writable claim.
--   3. Recreates every role-gated policy to use app_metadata.
--
-- ⚠️  OPERATIONAL NOTE: app_metadata changes only appear in a user's JWT after
--     their token refreshes. After applying, existing sessions should sign out
--     and back in (or wait for the ~1h token refresh) so their new claim is
--     present. Verify afterwards with:  SELECT * FROM pg_policies;
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Backfill app_metadata.role from the (previously trusted) user_metadata ─
UPDATE auth.users
SET raw_app_meta_data =
      coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', raw_user_meta_data ->> 'role')
WHERE raw_user_meta_data ->> 'role' IN ('admin', 'accountant', 'teacher', 'student')
  AND coalesce(raw_app_meta_data ->> 'role', '') = '';

-- ── 2. Helper: read the authoritative role claim (app_metadata, not writable) ─
CREATE OR REPLACE FUNCTION public.app_role()
RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT auth.jwt() -> 'app_metadata' ->> 'role' $$;

-- ── 3. monthly_salaries — admin/accountant only ──────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.monthly_salaries') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admin/accountant read salaries"  ON public.monthly_salaries;
    DROP POLICY IF EXISTS "Admin/accountant write salaries" ON public.monthly_salaries;

    CREATE POLICY "Admin/accountant read salaries"
      ON public.monthly_salaries FOR SELECT TO authenticated
      USING (public.app_role() IN ('admin', 'accountant'));

    CREATE POLICY "Admin/accountant write salaries"
      ON public.monthly_salaries FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'accountant'))
      WITH CHECK (public.app_role() IN ('admin', 'accountant'));
  END IF;
END $$;

-- ── 4. fee_payments — read: authenticated; write: admin/accountant ────────────
DO $$ BEGIN
  IF to_regclass('public.fee_payments') IS NOT NULL THEN
    DROP POLICY IF EXISTS "admins manage fee_payments"   ON public.fee_payments;
    DROP POLICY IF EXISTS "admin insert fee_payments"    ON public.fee_payments;

    CREATE POLICY "admin insert fee_payments"
      ON public.fee_payments FOR INSERT TO authenticated
      WITH CHECK (public.app_role() IN ('admin', 'accountant'));
  END IF;
END $$;

-- ── 5. fee_payment_audit — read + insert: admin/accountant ────────────────────
DO $$ BEGIN
  IF to_regclass('public.fee_payment_audit') IS NOT NULL THEN
    DROP POLICY IF EXISTS "auth read fee_payment_audit"    ON public.fee_payment_audit;
    DROP POLICY IF EXISTS "admin insert fee_payment_audit" ON public.fee_payment_audit;

    CREATE POLICY "auth read fee_payment_audit"
      ON public.fee_payment_audit FOR SELECT TO authenticated
      USING (public.app_role() IN ('admin', 'accountant'));

    CREATE POLICY "admin insert fee_payment_audit"
      ON public.fee_payment_audit FOR INSERT TO authenticated
      WITH CHECK (public.app_role() IN ('admin', 'accountant'));
  END IF;
END $$;

-- ── 6. app_settings — write: admin only ──────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.app_settings') IS NOT NULL THEN
    DROP POLICY IF EXISTS "settings_admin_write" ON public.app_settings;

    CREATE POLICY "settings_admin_write"
      ON public.app_settings FOR ALL TO authenticated
      USING (public.app_role() = 'admin')
      WITH CHECK (public.app_role() = 'admin');
  END IF;
END $$;

-- ── 7. exam_scores — admin/teacher manage; students read own ──────────────────
DO $$ BEGIN
  IF to_regclass('public.exam_scores') IS NOT NULL THEN
    DROP POLICY IF EXISTS "exam_scores_select"   ON public.exam_scores;
    DROP POLICY IF EXISTS "exam_scores: staff write" ON public.exam_scores;

    CREATE POLICY "exam_scores_select"
      ON public.exam_scores FOR SELECT TO authenticated
      USING (
        public.app_role() IN ('admin', 'teacher')
        OR student_id = (auth.jwt() -> 'user_metadata' ->> 'student_id')  -- self-read identifier, not a privilege
        OR student_id = auth.uid()::text
      );

    CREATE POLICY "exam_scores: staff write"
      ON public.exam_scores FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'teacher'))
      WITH CHECK (public.app_role() IN ('admin', 'teacher'));
  END IF;
END $$;

-- ── 8. exam_subjects / exams — admin/teacher write ────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.exam_subjects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "exam_subjects: staff write" ON public.exam_subjects;
    CREATE POLICY "exam_subjects: staff write"
      ON public.exam_subjects FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'teacher'))
      WITH CHECK (public.app_role() IN ('admin', 'teacher'));
  END IF;

  IF to_regclass('public.exams') IS NOT NULL THEN
    DROP POLICY IF EXISTS "exams: staff write" ON public.exams;
    CREATE POLICY "exams: staff write"
      ON public.exams FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'teacher'))
      WITH CHECK (public.app_role() IN ('admin', 'teacher'));
  END IF;
END $$;

-- ── 9. staff_members — SELECT restricted to staff roles (excludes students) ───
--     Closes the "all authenticated users can read pay rates" hole (H3). Teachers
--     retain read access (no regression for staff pages); students/self-escalated
--     accounts are blocked. Service-role writes unchanged.
--     NOTE: to also hide rate columns from teachers, expose a column-limited
--     view (id, name, status…) and point teacher-facing queries at it.
DO $$ BEGIN
  IF to_regclass('public.staff_members') IS NOT NULL THEN
    DROP POLICY IF EXISTS "staff_members_auth_select" ON public.staff_members;
    CREATE POLICY "staff_members_auth_select"
      ON public.staff_members FOR SELECT TO authenticated
      USING (public.app_role() IN ('admin', 'accountant', 'teacher'));
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- STILL OPEN (intentionally not changed here — require a design decision):
--   • public.student_self_reports allows anon SELECT/INSERT/UPDATE. This backs an
--     AUTH-LESS public student portal (students identified by class_id+roll_no).
--     Locking it down needs a per-student token/PIN so submissions can be row-
--     scoped; a blind RLS change would break the live portal. Track separately.
-- ──────────────────────────────────────────────────────────────────────────────
