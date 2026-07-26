-- Allow fractional marks in the grade book.
--
-- The grade-book UI lets teachers type scores like "48.5", but the
-- exam columns were INTEGER, so Postgres rejected the save with
-- "invalid input syntax for type integer: \"48.5\"".
--
-- Widen the score / max-score columns to NUMERIC so half-marks (and any
-- other fractional value) can be stored. Existing whole-number values are
-- preserved unchanged by the implicit integer -> numeric cast.

ALTER TABLE public.exam_scores
  ALTER COLUMN score TYPE NUMERIC USING score::numeric;

ALTER TABLE public.exam_subjects
  ALTER COLUMN max_score TYPE NUMERIC USING max_score::numeric;

ALTER TABLE public.exams
  ALTER COLUMN total_max_score TYPE NUMERIC USING total_max_score::numeric;
