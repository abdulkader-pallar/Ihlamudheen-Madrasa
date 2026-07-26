-- ══════════════════════════════════════════════════════════
-- Ihlamudheen Madrasa — Migration: marked_by + TA columns
-- Run this in Supabase SQL Editor AFTER migration-staff-payments.sql
-- ══════════════════════════════════════════════════════════

-- 1. Add marked_by column to attendance table
--    Tracks which teacher/admin last marked each attendance record.
ALTER TABLE public.student_attendance ADD COLUMN IF NOT EXISTS marked_by TEXT;

-- Index for fast lookups when displaying "last marked by" on class cards
CREATE INDEX IF NOT EXISTS idx_attendance_marked_by ON public.student_attendance(class_id, date);

-- 2. Add missing transport_allowance and ta_remarks columns to staff_attendance
--    (These were used in code but missing from the original migration SQL)
ALTER TABLE public.staff_attendance ADD COLUMN IF NOT EXISTS transport_allowance BOOLEAN DEFAULT false;
ALTER TABLE public.staff_attendance ADD COLUMN IF NOT EXISTS ta_remarks TEXT;

-- 3. RLS: allow authenticated users to read marked_by
--    (already covered by existing attendance RLS policies — no extra policy needed)
