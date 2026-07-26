-- EDU Support: per-teacher subject + grade ELIGIBILITY for the auto-scheduler.
-- Each row says "this teacher MAY teach this subject in this grade". The free
-- max-flow solver (src/lib/edu-loadplan.ts) then auto-balances the actual period
-- counts within these choices, so "assign subject + grade" and "automatic load
-- balancing" coexist: pin a (subject, grade) to one teacher and they get it all;
-- allow several and the load is split evenly. When no rows exist for the EDU
-- staff, the solver falls back to canTeach-based eligibility (every grade).
--
-- Free-text ids: teacher_id matches initialTeachers / EDU_TEACHERS (e.g. "t45"),
-- grade_id matches EDU_GRADES (e.g. "edu-1a"); no FKs so synthetic EDU levels
-- that aren't seeded in public.classes still work.

CREATE TABLE IF NOT EXISTS public.edu_teacher_subjects (
  teacher_id  TEXT NOT NULL,
  grade_id    TEXT NOT NULL,
  subject     TEXT NOT NULL,        -- "English" | "Maths" | "Science" | "Arabic"
  updated_at  TIMESTAMPTZ DEFAULT now(),
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (teacher_id, grade_id, subject)
);

CREATE INDEX IF NOT EXISTS idx_edu_teacher_subjects_grade ON public.edu_teacher_subjects(grade_id);

ALTER TABLE public.edu_teacher_subjects ENABLE ROW LEVEL SECURITY;

-- All signed-in users may read the eligibility (needed to generate timetables).
CREATE POLICY "auth users read edu_teacher_subjects"
  ON public.edu_teacher_subjects FOR SELECT TO authenticated USING (true);

-- Only admins may change assignments. Role is read from app_metadata, which is
-- NOT user-writable (see src/lib/api-auth.ts and the security RLS migration).
CREATE POLICY "admins manage edu_teacher_subjects"
  ON public.edu_teacher_subjects FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
