-- Make submitted_at nullable so auto-saves don't appear as explicit submissions.
-- A NULL means the student has only auto-saved; non-NULL means explicitly submitted.
ALTER TABLE public.student_self_reports
  ALTER COLUMN submitted_at DROP NOT NULL,
  ALTER COLUMN submitted_at DROP DEFAULT,
  ALTER COLUMN submitted_at SET DEFAULT NULL;

-- Reset existing rows so legacy auto-saved rows don't incorrectly show as submitted.
-- Teachers see real submission state after students re-open the portal this week.
UPDATE public.student_self_reports SET submitted_at = NULL WHERE submitted_at IS NOT NULL;
