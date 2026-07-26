-- ══════════════════════════════════════════════════════════════════════
-- Ihlamudheen Madrasa — SECURITY HARDENING MIGRATION  (v2, defensive)
-- Run this in Supabase SQL Editor. Idempotent. Skips tables that don't
-- exist in this project yet.
--
-- What this fixes
--   1. RLS policies previously checked `auth.jwt() -> 'user_metadata' ->> 'role'`.
--      user_metadata is WRITABLE BY THE USER, so any logged-in student could
--      call supabase.auth.updateUser({ data: { role: 'admin' } }) and gain
--      full admin write access. This migration moves role to a server-managed
--      `profiles` table and replaces every policy.
--   2. A previous "fix" migration dropped role checks on staff_attendance /
--      payments / requests entirely and allowed ANY authenticated user to
--      read & write salary data. This migration re-tightens those policies.
-- ══════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────
-- 1. PROFILES table — single source of truth for roles
-- ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'student'
               CHECK (role IN ('admin', 'teacher', 'accountant', 'student')),
  full_name  TEXT,
  email      TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles: own read"        ON public.profiles;
DROP POLICY IF EXISTS "profiles: admin read"      ON public.profiles;
DROP POLICY IF EXISTS "profiles: admin write"     ON public.profiles;
DROP POLICY IF EXISTS "profiles: own update safe" ON public.profiles;

CREATE POLICY "profiles: own read" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "profiles: admin read" ON public.profiles
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE POLICY "profiles: admin write" ON public.profiles
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE POLICY "profiles: own update safe" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

-- ────────────────────────────────────────────────────
-- 2. Auto-create profile row on signup (role = 'student')
-- ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, email)
  VALUES (
    NEW.id,
    'student',
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ────────────────────────────────────────────────────
-- 3. Helper functions — SECURITY DEFINER so they read profiles
-- ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_teacher_or_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher'));
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_accountant()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'accountant'));
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher', 'accountant'));
$$;

-- ────────────────────────────────────────────────────
-- 4. Apply policies only to tables that actually exist.
--    Each block is guarded with to_regclass() so missing tables are skipped.
-- ────────────────────────────────────────────────────

-- Helper: apply staff-manage policy to a table if it exists
DO $$
DECLARE
  tbl TEXT;
  staff_tables TEXT[] := ARRAY['classes', 'students', 'attendance', 'exams', 'exam_subjects', 'exam_scores'];
BEGIN
  FOREACH tbl IN ARRAY staff_tables LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Admins and teachers can manage ' || tbl, tbl);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || ': staff manage', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_teacher_or_admin()) WITH CHECK (public.is_teacher_or_admin())',
        tbl || ': staff manage', tbl
      );
    END IF;
  END LOOP;

  -- Also catch exact legacy names for the two multi-word tables
  IF to_regclass('public.exam_subjects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins and teachers can manage exam subjects" ON public.exam_subjects';
  END IF;
  IF to_regclass('public.exam_scores') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins and teachers can manage exam scores" ON public.exam_scores';
  END IF;
END $$;

-- ────────────────────────────────────────────────────
-- 5. TEACHERS / TEACHER_ASSIGNMENTS — admin only
-- ────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.teachers') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins can manage teachers" ON public.teachers;
    DROP POLICY IF EXISTS "teachers: admin manage"     ON public.teachers;
    CREATE POLICY "teachers: admin manage" ON public.teachers
      FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;

  IF to_regclass('public.teacher_assignments') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admins can manage assignments"      ON public.teacher_assignments;
    DROP POLICY IF EXISTS "teacher_assignments: admin manage"  ON public.teacher_assignments;
    CREATE POLICY "teacher_assignments: admin manage" ON public.teacher_assignments
      FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END $$;

-- ────────────────────────────────────────────────────
-- 6. STAFF_ATTENDANCE — re-tighten
-- ────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.staff_attendance') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admin and accountant can manage staff attendance" ON public.staff_attendance;
    DROP POLICY IF EXISTS "Anyone authenticated can read staff attendance"    ON public.staff_attendance;
    DROP POLICY IF EXISTS "Authenticated users can read staff attendance"     ON public.staff_attendance;
    DROP POLICY IF EXISTS "Authenticated users can upsert staff attendance"   ON public.staff_attendance;
    DROP POLICY IF EXISTS "Authenticated users can update staff attendance"   ON public.staff_attendance;
    DROP POLICY IF EXISTS "staff_attendance: staff read"                       ON public.staff_attendance;
    DROP POLICY IF EXISTS "staff_attendance: admin/accountant write"           ON public.staff_attendance;

    CREATE POLICY "staff_attendance: staff read" ON public.staff_attendance
      FOR SELECT TO authenticated USING (public.is_staff());
    CREATE POLICY "staff_attendance: admin/accountant write" ON public.staff_attendance
      FOR ALL TO authenticated USING (public.is_admin_or_accountant()) WITH CHECK (public.is_admin_or_accountant());
  END IF;
END $$;

-- ────────────────────────────────────────────────────
-- 7. PAYMENTS — admin/accountant only
-- ────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.payments') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admin and accountant can read payments"    ON public.payments;
    DROP POLICY IF EXISTS "Admin and accountant can manage payments"  ON public.payments;
    DROP POLICY IF EXISTS "Authenticated users can read payments"     ON public.payments;
    DROP POLICY IF EXISTS "Authenticated users can insert payments"   ON public.payments;
    DROP POLICY IF EXISTS "Authenticated users can update payments"   ON public.payments;
    DROP POLICY IF EXISTS "payments: admin/accountant read"            ON public.payments;
    DROP POLICY IF EXISTS "payments: admin/accountant write"           ON public.payments;

    CREATE POLICY "payments: admin/accountant read" ON public.payments
      FOR SELECT TO authenticated USING (public.is_admin_or_accountant());
    CREATE POLICY "payments: admin/accountant write" ON public.payments
      FOR ALL TO authenticated USING (public.is_admin_or_accountant()) WITH CHECK (public.is_admin_or_accountant());
  END IF;
END $$;

-- ────────────────────────────────────────────────────
-- 8. STAFF_ATTENDANCE_REQUESTS
-- ────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.staff_attendance_requests') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Teachers can submit own requests"    ON public.staff_attendance_requests;
    DROP POLICY IF EXISTS "Teachers can view own requests"      ON public.staff_attendance_requests;
    DROP POLICY IF EXISTS "Admins can update requests"          ON public.staff_attendance_requests;
    DROP POLICY IF EXISTS "Authenticated can insert requests"   ON public.staff_attendance_requests;
    DROP POLICY IF EXISTS "Authenticated can read requests"     ON public.staff_attendance_requests;
    DROP POLICY IF EXISTS "Authenticated can update requests"   ON public.staff_attendance_requests;
    DROP POLICY IF EXISTS "staff_req: staff insert"              ON public.staff_attendance_requests;
    DROP POLICY IF EXISTS "staff_req: staff read"                ON public.staff_attendance_requests;
    DROP POLICY IF EXISTS "staff_req: admin update"              ON public.staff_attendance_requests;

    CREATE POLICY "staff_req: staff insert" ON public.staff_attendance_requests
      FOR INSERT TO authenticated WITH CHECK (public.is_staff());
    CREATE POLICY "staff_req: staff read" ON public.staff_attendance_requests
      FOR SELECT TO authenticated USING (public.is_staff());
    CREATE POLICY "staff_req: admin update" ON public.staff_attendance_requests
      FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END $$;

-- ────────────────────────────────────────────────────
-- 9. LMS_NOTES / ASSESSMENTS — staff-only writes
-- ────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.lms_notes') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Authenticated users can insert notes" ON public.lms_notes;
    DROP POLICY IF EXISTS "Authenticated users can delete notes" ON public.lms_notes;
    DROP POLICY IF EXISTS "Authenticated users can update notes" ON public.lms_notes;
    DROP POLICY IF EXISTS "lms_notes: staff insert"               ON public.lms_notes;
    DROP POLICY IF EXISTS "lms_notes: staff update"               ON public.lms_notes;
    DROP POLICY IF EXISTS "lms_notes: staff delete"               ON public.lms_notes;

    CREATE POLICY "lms_notes: staff insert" ON public.lms_notes
      FOR INSERT TO authenticated WITH CHECK (public.is_teacher_or_admin());
    CREATE POLICY "lms_notes: staff update" ON public.lms_notes
      FOR UPDATE TO authenticated USING (public.is_teacher_or_admin()) WITH CHECK (public.is_teacher_or_admin());
    CREATE POLICY "lms_notes: staff delete" ON public.lms_notes
      FOR DELETE TO authenticated USING (public.is_teacher_or_admin());
  END IF;

  IF to_regclass('public.assessments') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Authenticated users can insert assessments" ON public.assessments;
    DROP POLICY IF EXISTS "Authenticated users can update assessments" ON public.assessments;
    DROP POLICY IF EXISTS "Authenticated users can delete assessments" ON public.assessments;
    DROP POLICY IF EXISTS "assessments: staff insert"                   ON public.assessments;
    DROP POLICY IF EXISTS "assessments: staff update"                   ON public.assessments;
    DROP POLICY IF EXISTS "assessments: staff delete"                   ON public.assessments;

    CREATE POLICY "assessments: staff insert" ON public.assessments
      FOR INSERT TO authenticated WITH CHECK (public.is_teacher_or_admin());
    CREATE POLICY "assessments: staff update" ON public.assessments
      FOR UPDATE TO authenticated USING (public.is_teacher_or_admin()) WITH CHECK (public.is_teacher_or_admin());
    CREATE POLICY "assessments: staff delete" ON public.assessments
      FOR DELETE TO authenticated USING (public.is_teacher_or_admin());
  END IF;
END $$;

-- ────────────────────────────────────────────────────
-- 10. BACKFILL existing users' profiles from user_metadata.
--     Runs once; safe to re-run.
-- ────────────────────────────────────────────────────
INSERT INTO public.profiles (id, role, full_name, email)
SELECT
  u.id,
  CASE
    WHEN u.raw_user_meta_data ->> 'role' IN ('admin', 'teacher', 'accountant', 'student')
      THEN u.raw_user_meta_data ->> 'role'
    ELSE 'student'
  END AS role,
  COALESCE(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '') AS full_name,
  u.email
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- Verify:
--   SELECT role, count(*) FROM public.profiles GROUP BY role;

-- ══════════════════════════════════════════════════════════════════════
-- DONE. Next steps (do these manually in the Supabase dashboard):
--   • Authentication → Settings → Enable "Confirm email"
--   • Authentication → Settings → Set JWT expiry to 24h
--   • Authentication → URL Configuration → Restrict redirect URLs
--   • Settings → API → Rotate service_role key, update in Vercel
-- ══════════════════════════════════════════════════════════════════════
