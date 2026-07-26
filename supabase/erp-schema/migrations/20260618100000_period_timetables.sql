-- Period-wise timetables: subject + teacher assigned to each teaching period of
-- a class. One row per (class_id, day, period_label). Times themselves come from
-- the bell-timetable grid in code (src/data/bell-timetable.ts), so only the
-- assignment is stored here.
--
-- NOTE: the v1 UI persists to localStorage; wiring src/lib/db.ts to this table
-- is the follow-up that makes timetables shared across devices/users.

CREATE TABLE IF NOT EXISTS public.period_timetables (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Free-text class id (Ihlamudheen class ids AND synthetic ids like "edu-1a"); no FK
  -- to public.classes so EDU Support levels that aren't seeded there still work.
  class_id          TEXT NOT NULL,
  bell_timetable_id TEXT NOT NULL,             -- e.g. "madrasa-madrasa-sat-sun"
  day               TEXT NOT NULL,             -- e.g. "Saturday"
  period_label      TEXT NOT NULL,             -- e.g. "Period 1"
  subject_id        TEXT,
  subject_name      TEXT NOT NULL DEFAULT '',
  teacher_id        TEXT,
  teacher_name      TEXT,
  room              TEXT,
  note              TEXT,
  updated_at        TIMESTAMPTZ DEFAULT now(),
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(class_id, day, period_label)
);

CREATE INDEX IF NOT EXISTS idx_period_timetables_class ON public.period_timetables(class_id);
CREATE INDEX IF NOT EXISTS idx_period_timetables_teacher ON public.period_timetables(teacher_id);

ALTER TABLE public.period_timetables ENABLE ROW LEVEL SECURITY;

-- All signed-in users may read timetables (view/print/export).
CREATE POLICY "auth users read period_timetables"
  ON public.period_timetables FOR SELECT TO authenticated USING (true);

-- Only admins may create/update/delete. Role is read from app_metadata, which
-- is NOT user-writable (see src/lib/api-auth.ts and the security RLS migration).
CREATE POLICY "admins manage period_timetables"
  ON public.period_timetables FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
