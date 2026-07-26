-- Add custom_data column if not already present
-- This stores student responses for teacher-defined custom activities
ALTER TABLE public.student_self_reports
  ADD COLUMN IF NOT EXISTS custom_data JSONB NOT NULL DEFAULT '{}';

-- Make submitted_at nullable (NULL = auto-saved, non-NULL = explicitly submitted by student)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='student_self_reports'
      AND column_name='submitted_at'
      AND is_nullable='NO'
  ) THEN
    ALTER TABLE public.student_self_reports
      ALTER COLUMN submitted_at DROP NOT NULL,
      ALTER COLUMN submitted_at SET DEFAULT NULL;
    -- Reset old auto-populated submitted_at values so only real submits count
    UPDATE public.student_self_reports SET submitted_at = NULL;
  END IF;
END $$;
