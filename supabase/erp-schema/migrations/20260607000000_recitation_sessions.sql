-- ============================================================
-- Quran Recitation Tracking & Progress System
--
-- One row per 5-minute one-on-one recitation assessment.
-- A dedicated recitation teacher pulls students out of class one
-- at a time, coaches them, and scores them against a FIXED rubric:
--
--   Pronunciation Accuracy ... /20
--   Tajweed Rules ............ /20
--   Style and Melody ......... /5
--   Start and Stop ........... /5
--   --------------------------------
--   Total .................... /50
--
-- One assessment per student per date (re-scoring the same date
-- upserts). Weekly cadence → reports show week-over-week progress.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.recitation_sessions (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id       TEXT        NOT NULL,
  student_id     TEXT        NOT NULL,
  session_date   DATE        NOT NULL,

  -- Rubric sub-scores (bounded to the fixed maximums)
  pronunciation  INTEGER     NOT NULL DEFAULT 0 CHECK (pronunciation BETWEEN 0 AND 20),
  tajweed        INTEGER     NOT NULL DEFAULT 0 CHECK (tajweed       BETWEEN 0 AND 20),
  style          INTEGER     NOT NULL DEFAULT 0 CHECK (style         BETWEEN 0 AND 5),
  start_stop     INTEGER     NOT NULL DEFAULT 0 CHECK (start_stop    BETWEEN 0 AND 5),

  -- Persisted total (kept in sync by the trigger below) — 0..50
  total          INTEGER     NOT NULL DEFAULT 0 CHECK (total BETWEEN 0 AND 50),

  -- Short coaching note: what was worked on this session
  notes          TEXT,

  -- Audit: who assessed (display name + auth user id)
  assessed_by    TEXT,
  assessed_by_id UUID        REFERENCES auth.users(id),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (student_id, session_date)
);

-- Fast loads: one class at a time, ordered by date
CREATE INDEX IF NOT EXISTS idx_recitation_class_date
  ON public.recitation_sessions (class_id, session_date);

-- Fast student-portal loads
CREATE INDEX IF NOT EXISTS idx_recitation_student_date
  ON public.recitation_sessions (student_id, session_date);

-- ── Keep total + updated_at consistent regardless of client ───────────────────
CREATE OR REPLACE FUNCTION public.recitation_sync_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.total := COALESCE(NEW.pronunciation, 0)
             + COALESCE(NEW.tajweed, 0)
             + COALESCE(NEW.style, 0)
             + COALESCE(NEW.start_stop, 0);
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_recitation_sync_total ON public.recitation_sessions;
CREATE TRIGGER trg_recitation_sync_total
  BEFORE INSERT OR UPDATE ON public.recitation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.recitation_sync_total();

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Mirrors exam_scores: admin/teacher manage everything; a student/parent may
-- read only their own child's rows. Role is read from the non-writable
-- app_metadata claim via public.app_role() (see 20260603120000).
ALTER TABLE public.recitation_sessions ENABLE ROW LEVEL SECURITY;

-- Read: staff see all; students/parents see only their own student_id
DROP POLICY IF EXISTS "recitation_select" ON public.recitation_sessions;
CREATE POLICY "recitation_select"
  ON public.recitation_sessions FOR SELECT TO authenticated
  USING (
    public.app_role() IN ('admin', 'teacher')
    OR student_id = (auth.jwt() -> 'user_metadata' ->> 'student_id')  -- self-read identifier, not a privilege
    OR student_id = auth.uid()::text
  );

-- Write (insert/update/delete): admin + teacher only
DROP POLICY IF EXISTS "recitation_staff_write" ON public.recitation_sessions;
CREATE POLICY "recitation_staff_write"
  ON public.recitation_sessions FOR ALL TO authenticated
  USING (public.app_role() IN ('admin', 'teacher'))
  WITH CHECK (public.app_role() IN ('admin', 'teacher'));
