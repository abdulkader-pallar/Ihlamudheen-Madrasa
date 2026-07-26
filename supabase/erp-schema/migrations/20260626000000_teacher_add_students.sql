-- ══════════════════════════════════════════════════════════════════════
-- Teachers can now add students from the Teachers roster (course → class)
--
--   • ADD    (INSERT) a student → admin / accountant / teacher (was admin/accountant)
--   • REMOVE (DELETE) a student → admin / accountant only (unchanged)
--
-- Product decision: teachers should be able to onboard students into their
-- own class without going through an admin/accountant, but removing a
-- student (which also deletes attendance and grade history) stays
-- restricted. public.is_staff() already covers admin/teacher/accountant.
-- ══════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF to_regclass('public.students') IS NOT NULL THEN
    DROP POLICY IF EXISTS "students: admin/accountant insert" ON public.students;
    DROP POLICY IF EXISTS "students: staff insert" ON public.students;

    CREATE POLICY "students: staff insert" ON public.students
      FOR INSERT TO authenticated
      WITH CHECK (public.is_staff());
  END IF;
END $$;
