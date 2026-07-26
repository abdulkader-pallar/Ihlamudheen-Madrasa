-- ══════════════════════════════════════════════════════════════════════
-- Student disenrollment (soft archive)
--
-- "Disenroll" marks a student as having left WITHOUT deleting their record,
-- attendance, or grades — unlike the permanent "Remove" action. A
-- disenrolled student disappears from active rosters but can be viewed on
-- the Disenroll page and re-enrolled later.
--
--   disenrolled_at   — when the student left (NULL = active / enrolled)
--   disenroll_reason — optional free-text note (e.g. "moved", "graduated")
-- ══════════════════════════════════════════════════════════════════════

alter table public.students
  add column if not exists disenrolled_at  timestamptz,
  add column if not exists disenroll_reason text;

-- Speeds up the "active students only" filter used by every roster query.
create index if not exists idx_students_disenrolled_at
  on public.students(disenrolled_at);
