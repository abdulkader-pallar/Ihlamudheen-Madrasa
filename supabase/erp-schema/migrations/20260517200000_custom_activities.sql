-- ============================================================
-- Custom Activities per Class
-- Teachers define extra activities (e.g. "Homework", "Hadith")
-- per class through the dashboard. Students see and self-report
-- them in their portal.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.class_custom_activities (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id      TEXT        NOT NULL,
  activity_name TEXT        NOT NULL,
  position      INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, activity_name)
);

-- Fast lookup when teacher or student loads a class
CREATE INDEX IF NOT EXISTS idx_cca_class
  ON public.class_custom_activities (class_id, position);

-- Row Level Security — same open policy as student_self_reports:
-- teachers write, students read, both use the anon key.
ALTER TABLE public.class_custom_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cca_public" ON public.class_custom_activities;
CREATE POLICY "cca_public"
  ON public.class_custom_activities
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Add custom_data column to student_self_reports
-- Stores student responses for custom activities as JSON:
--   { "Homework": true, "Hadith": false }
-- ============================================================

ALTER TABLE public.student_self_reports
  ADD COLUMN IF NOT EXISTS custom_data JSONB NOT NULL DEFAULT '{}';
