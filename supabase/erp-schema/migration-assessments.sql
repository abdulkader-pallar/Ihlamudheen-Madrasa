-- Assessments — link-based quizzes / tests / assignments (no file uploads)
-- Run in Supabase SQL Editor → New Query → Run

CREATE TABLE IF NOT EXISTS public.assessments (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id     TEXT NOT NULL,
  teacher_id   TEXT NOT NULL,
  teacher_name TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  link_url     TEXT NOT NULL,
  due_date     DATE,
  max_marks    INTEGER,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessments_class
  ON public.assessments(class_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assessments_teacher
  ON public.assessments(teacher_id);

ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;

-- Public (anon) + authenticated read so students can see assessments
CREATE POLICY "Anyone can read assessments"
  ON public.assessments FOR SELECT
  TO anon, authenticated
  USING (true);

-- Authenticated (teachers/admins) can create/update/delete.
-- Ownership enforced in application layer.
CREATE POLICY "Authenticated users can insert assessments"
  ON public.assessments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update assessments"
  ON public.assessments FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete assessments"
  ON public.assessments FOR DELETE
  TO authenticated
  USING (true);
