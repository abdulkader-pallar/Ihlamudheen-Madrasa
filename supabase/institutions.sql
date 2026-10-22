-- ============================================================================
-- One database for every institution's books.
--
-- Ihlamudheen keeps the accounts of Grace Valley and PMSA as well; they no
-- longer have Supabase projects of their own. Every accounting row carries the
-- institution it belongs to, and the Accounts portal only ever shows the rows
-- of the institution picked in its sidebar switcher (lib/sites.ts,
-- lib/scoped-db.ts). Existing rows are Ihlamudheen's.
--
-- Their old data is copied in by scripts/import-site.mjs.
--
-- Run once in the Supabase SQL editor, after schema.sql, staff-attendance.sql
-- and lock-accounting-to-superadmins.sql. Safe to run again.
-- ============================================================================

DO $inst$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories','funds','transactions','staff','attendance']
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS institution text NOT NULL DEFAULT ''ihlamudheen''', t);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_institution_check');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (institution IN (''ihlamudheen'',''gracevalley'',''pmsa''))',
      t, t || '_institution_check');
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (institution)', 'idx_' || t || '_institution', t);
  END LOOP;
END
$inst$;

-- Names only need to be unique within one institution: each one has its own
-- "General Fund", "Staff Salaries" and so on.
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_name_kind_key;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_institution_name_kind_key;
ALTER TABLE public.categories ADD CONSTRAINT categories_institution_name_kind_key UNIQUE (institution, name, kind);

ALTER TABLE public.funds DROP CONSTRAINT IF EXISTS funds_name_key;
ALTER TABLE public.funds DROP CONSTRAINT IF EXISTS funds_institution_name_key;
ALTER TABLE public.funds ADD CONSTRAINT funds_institution_name_key UNIQUE (institution, name);

-- Each institution's punching machine numbers its own staff from 1.
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_device_user_id_key;
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_institution_device_user_id_key;
ALTER TABLE public.staff ADD CONSTRAINT staff_institution_device_user_id_key UNIQUE (institution, device_user_id);

-- Check: one row per table, all showing the new column.
select table_name, column_default
from information_schema.columns
where table_schema = 'public' and column_name = 'institution'
order by table_name;
