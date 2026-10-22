-- ============================================================================
--  Staff code (the institution's own staff ID number)
--
--  Schools keep their own staff numbers and every salary statement is printed
--  with them, so the register needs a place for them. `code` is free text (the
--  numbers are not always plain integers) and is unique within a unit, which
--  is where the numbering lives; two units may use the same number, and the
--  code may be left empty.
--
--  This is NOT the legacy `device_user_id` (a ZKTeco enrolment number, unused
--  since staff attendance was dropped from the portal).
--
--  Run once (safe to re-run):
--      node scripts/run-sql.mjs supabase/staff-code.sql
-- ============================================================================

alter table public.staff add column if not exists code text;

-- Unique per unit. unit_id is NULL for an institution's common staff, so it is
-- folded to a fixed uuid - NULLs would otherwise count as all different and
-- let the same code in twice.
create unique index if not exists uq_staff_code on public.staff (
  institution,
  coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
  upper(code)
) where code is not null;

-- Check: the column is there.
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'staff' and column_name = 'code';
