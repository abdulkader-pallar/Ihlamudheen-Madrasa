-- ============================================================
-- Disabled teachers / staff
-- A teacher who has left Ihlamudheen Madrasa is "disabled" rather than deleted:
-- their historical punch records and approved salary snapshots are kept,
-- but they are hidden going forward from the attendance widgets, synthesized
-- absences, EDU-support hours, the staff grid, and payroll selection.
-- Written by /api/admin/teacher-status (admin only).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.disabled_teachers (
  teacher_id  TEXT        PRIMARY KEY,  -- matches initialTeachers id in courses.ts, e.g. "t40"
  disabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_by TEXT,                     -- email of the admin who disabled them
  reason      TEXT
);

-- ── Row Level Security ──────────────────────────────────────
ALTER TABLE public.disabled_teachers ENABLE ROW LEVEL SECURITY;

-- Authenticated users (teachers/admin) can read who is disabled, so every
-- surface can filter consistently.
DROP POLICY IF EXISTS "disabled_teachers_auth_select" ON public.disabled_teachers;
CREATE POLICY "disabled_teachers_auth_select"
  ON public.disabled_teachers
  FOR SELECT TO authenticated
  USING (true);

-- Only service_role (the admin API) can disable / re-enable.
DROP POLICY IF EXISTS "disabled_teachers_service_write" ON public.disabled_teachers;
CREATE POLICY "disabled_teachers_service_write"
  ON public.disabled_teachers
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
