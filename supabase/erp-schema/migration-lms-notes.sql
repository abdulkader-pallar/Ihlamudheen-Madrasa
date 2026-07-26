-- LMS Notes — link-based class notes (Google Drive, YouTube, Docs, etc.)
-- Run this in Supabase SQL Editor → New Query → Run

CREATE TABLE IF NOT EXISTS public.lms_notes (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id     TEXT NOT NULL,
  teacher_id   TEXT NOT NULL,
  teacher_name TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  link_url     TEXT NOT NULL,
  link_type    TEXT NOT NULL DEFAULT 'other',   -- drive | youtube | doc | other
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lms_notes_class
  ON public.lms_notes(class_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lms_notes_teacher
  ON public.lms_notes(teacher_id);

ALTER TABLE public.lms_notes ENABLE ROW LEVEL SECURITY;

-- Students (anonymous) and teachers can read all notes
CREATE POLICY "Anyone can read lms notes"
  ON public.lms_notes FOR SELECT
  TO anon, authenticated
  USING (true);

-- Authenticated users (teachers, admins) can add notes
CREATE POLICY "Authenticated users can insert notes"
  ON public.lms_notes FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users can delete notes (ownership enforced in app layer)
CREATE POLICY "Authenticated users can delete notes"
  ON public.lms_notes FOR DELETE
  TO authenticated
  USING (true);

-- Authenticated users can update notes (ownership enforced in app layer)
CREATE POLICY "Authenticated users can update notes"
  ON public.lms_notes FOR UPDATE
  TO authenticated
  USING (true);
