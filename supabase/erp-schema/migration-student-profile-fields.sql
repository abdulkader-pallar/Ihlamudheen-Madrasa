-- ══════════════════════════════════════════════════════════════════
-- Ihlamudheen — Add student profile columns (gender + parents + contacts)
-- Run once in Supabase SQL Editor. Safe to re-run (uses IF NOT EXISTS).
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS gender         TEXT;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS father_name    TEXT;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS mother_name    TEXT;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS father_phone   TEXT;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS mother_phone   TEXT;

-- Optional: a CHECK constraint on gender (skip if you want free-form)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_gender_check'
  ) THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_gender_check
      CHECK (gender IS NULL OR gender IN ('Male', 'Female'));
  END IF;
END $$;

-- Verify:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'students'
ORDER BY ordinal_position;
