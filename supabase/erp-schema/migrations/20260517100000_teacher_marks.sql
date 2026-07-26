-- ============================================================
-- Teacher activity marks table
-- Teachers mark student daily activities via the dashboard.
-- Previously stored only in localStorage — now persisted to DB
-- so marks survive browser clears and sync across devices.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.teacher_marks (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id    TEXT        NOT NULL,
  week_key    DATE        NOT NULL,
  day_key     TEXT        NOT NULL CHECK (day_key IN ('sat','sun','mon','tue','wed','thu','fri')),
  student_id  TEXT        NOT NULL,
  fajr        BOOLEAN     NOT NULL DEFAULT false,
  dhuhr       BOOLEAN     NOT NULL DEFAULT false,
  asr         BOOLEAN     NOT NULL DEFAULT false,
  maghrib     BOOLEAN     NOT NULL DEFAULT false,
  isha        BOOLEAN     NOT NULL DEFAULT false,
  quran       BOOLEAN     NOT NULL DEFAULT false,
  reading     BOOLEAN     NOT NULL DEFAULT false,
  writing     BOOLEAN     NOT NULL DEFAULT false,
  custom      JSONB       NOT NULL DEFAULT '{}',
  marked_by   UUID        REFERENCES auth.users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, week_key, day_key, student_id)
);

-- Index for dashboard loads (one class + one week at a time)
CREATE INDEX IF NOT EXISTS idx_tm_class_week
  ON public.teacher_marks (class_id, week_key);

-- ── Row Level Security ────────────────────────────────────
ALTER TABLE public.teacher_marks ENABLE ROW LEVEL SECURITY;

-- Authenticated users with teacher/admin role can read all marks
CREATE POLICY "tm_auth_select"
  ON public.teacher_marks
  FOR SELECT TO authenticated
  USING (true);

-- Authenticated users can insert/update (app-level role check via canEdit)
CREATE POLICY "tm_auth_insert"
  ON public.teacher_marks
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "tm_auth_update"
  ON public.teacher_marks
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- Only service_role can delete
CREATE POLICY "tm_service_delete"
  ON public.teacher_marks
  FOR DELETE TO service_role
  USING (true);

-- ============================================================
-- Custom activities per class (shared across all teachers)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.teacher_custom_activities (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id    TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  created_by  UUID        REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, name)
);

ALTER TABLE public.teacher_custom_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tca_auth_select"
  ON public.teacher_custom_activities
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "tca_auth_insert"
  ON public.teacher_custom_activities
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "tca_auth_delete"
  ON public.teacher_custom_activities
  FOR DELETE TO authenticated
  USING (true);

-- Auto-update updated_at on teacher_marks
CREATE TRIGGER trg_tm_updated_at
  BEFORE UPDATE ON public.teacher_marks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
