-- Drop the foreign key from period_timetables.class_id → classes(id).
-- The EDU Support weekly timetable uses synthetic level ids ("edu-1a" … "edu-5a")
-- that are NOT rows in public.classes, so the FK would reject those inserts.
-- class_id is now a free-text key. Safe/idempotent.

ALTER TABLE public.period_timetables
  DROP CONSTRAINT IF EXISTS period_timetables_class_id_fkey;
