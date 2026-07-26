-- ============================================================
-- Fix: exam_scores RLS, score constraint, app_settings table
-- ============================================================

-- 1. Drop the permissive read-all policy on exam_scores
DROP POLICY IF EXISTS "Anyone authenticated can read exam scores" ON public.exam_scores;

-- 2. Student-scoped read policy:
--    • admin / teacher can read everything
--    • a student can only read their own scores
CREATE POLICY "exam_scores_select"
  ON public.exam_scores
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'teacher')
    OR student_id = (auth.jwt() -> 'user_metadata' ->> 'student_id')
    OR student_id = auth.uid()::text
  );

-- 3. Ensure scores cannot be negative
ALTER TABLE public.exam_scores
  ADD CONSTRAINT IF NOT EXISTS chk_score_non_negative CHECK (score >= 0);

-- ============================================================
-- App-wide settings table (key/value)
-- Used for: report_card_enabled, etc.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read settings
CREATE POLICY "settings_select"
  ON public.app_settings
  FOR SELECT TO authenticated
  USING (true);

-- Only admins can write settings
CREATE POLICY "settings_admin_write"
  ON public.app_settings
  FOR ALL TO authenticated
  USING   ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- Seed defaults (idempotent)
INSERT INTO public.app_settings (key, value)
VALUES ('report_card_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_app_settings()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_app_settings();
