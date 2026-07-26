-- ══════════════════════════════════════════════════════════════════════
-- Student management permissions (Teachers roster: course → class)
--
--   • ADD    (INSERT) a student → admin / accountant only
--   • REMOVE (DELETE) a student → admin / accountant only
--   • EDIT   (UPDATE) a student → all staff (admin / teacher / accountant)
--
-- Why split the policy:
--   The old policy was a single FOR ALL rule limited to admin + teacher
--   (public.is_teacher_or_admin()). That had two problems:
--     1. Accountants could not add/remove students even though the Teachers
--        roster exposes those actions to them — their write was silently
--        rejected by RLS and the row reappeared on refresh.
--     2. Teachers could add/remove students, which is not wanted —
--        only admins and accountants may add or remove a student.
--   Teachers still legitimately EDIT students (profile fields, photo), so
--   UPDATE stays open to all staff while INSERT/DELETE are tightened to
--   admin + accountant.
--
-- SELECT is unchanged (handled by the existing "anyone authenticated can
-- read students" policy) so all roles keep read access.
-- ══════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF to_regclass('public.students') IS NOT NULL THEN
    -- Remove the legacy single manage policy in all its known names.
    DROP POLICY IF EXISTS "Admins and teachers can manage students" ON public.students;
    DROP POLICY IF EXISTS "students: staff manage" ON public.students;
    -- Drop our own granular policies too, so this migration is idempotent.
    DROP POLICY IF EXISTS "students: admin/accountant insert" ON public.students;
    DROP POLICY IF EXISTS "students: admin/accountant delete" ON public.students;
    DROP POLICY IF EXISTS "students: staff update" ON public.students;

    -- ADD a student → admin / accountant
    CREATE POLICY "students: admin/accountant insert" ON public.students
      FOR INSERT TO authenticated
      WITH CHECK (public.is_admin_or_accountant());

    -- REMOVE a student → admin / accountant
    CREATE POLICY "students: admin/accountant delete" ON public.students
      FOR DELETE TO authenticated
      USING (public.is_admin_or_accountant());

    -- EDIT a student (profile, photo) → all staff (incl. teachers)
    CREATE POLICY "students: staff update" ON public.students
      FOR UPDATE TO authenticated
      USING (public.is_staff())
      WITH CHECK (public.is_staff());
  END IF;
END $$;
