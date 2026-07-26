-- ══════════════════════════════════════════════════════════
-- Ihlamudheen Madrasa — Student late-arrival tracking
-- Adds an arrival_time column to the attendance table so the
-- marking screen can record when each student arrived. Arrivals
-- after the program's official start time are stored with
-- status = 'late' (already permitted by the status CHECK).
--
-- Program start times (students):
--   Ihlamudheen Madrasa             09:00
--   Ihlamudheen Madrasa English Madrasa 15:00
--   Ihlamudheen Madrasa Edu Support     09:00
--   CIBIS Certification       — not tracked
-- ══════════════════════════════════════════════════════════

-- Arrival time stored as "HH:MM" (24-hour), nullable — only set when recorded.
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS arrival_time TEXT;

-- Absence/late note column is referenced by the app; ensure it exists.
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Fast lookup of late records for the daily/monthly late-comer reports.
CREATE INDEX IF NOT EXISTS idx_attendance_late
  ON public.attendance(date)
  WHERE status = 'late';
