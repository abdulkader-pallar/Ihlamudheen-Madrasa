-- ============================================================
-- Student Self-Report table
-- Students submit their own daily activity records via /student portal.
-- No Supabase Auth needed — students identified by class_id + roll_no.
-- Teachers read all rows via the dashboard (service role / anon key).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.student_self_reports (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id    TEXT        NOT NULL,
  roll_no     TEXT        NOT NULL,
  week_key    DATE        NOT NULL,   -- Saturday that starts the Ihlamudheen week
  day_key     TEXT        NOT NULL CHECK (day_key IN ('sat','sun','mon','tue','wed','thu','fri')),
  fajr        BOOLEAN     NOT NULL DEFAULT false,
  dhuhr       BOOLEAN     NOT NULL DEFAULT false,
  asr         BOOLEAN     NOT NULL DEFAULT false,
  maghrib     BOOLEAN     NOT NULL DEFAULT false,
  isha        BOOLEAN     NOT NULL DEFAULT false,
  quran       BOOLEAN     NOT NULL DEFAULT false,
  reading     BOOLEAN     NOT NULL DEFAULT false,
  writing     BOOLEAN     NOT NULL DEFAULT false,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, roll_no, week_key, day_key)
);

-- Index for teacher dashboard queries (fetch all reports for a class/week)
CREATE INDEX IF NOT EXISTS idx_ssr_class_week
  ON public.student_self_reports (class_id, week_key);

-- Index for student portal queries (fetch one student's records)
CREATE INDEX IF NOT EXISTS idx_ssr_roll
  ON public.student_self_reports (class_id, roll_no);

-- ── Row Level Security ────────────────────────────────────
-- Data is non-sensitive (prayer/activity tracking, not grades).
-- Public read/write is intentional — students access without Supabase Auth.
ALTER TABLE public.student_self_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_self_reports_public" ON public.student_self_reports;
CREATE POLICY "student_self_reports_public"
  ON public.student_self_reports
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_ssr_updated_at ON public.student_self_reports;
CREATE TRIGGER trg_ssr_updated_at
  BEFORE UPDATE ON public.student_self_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
