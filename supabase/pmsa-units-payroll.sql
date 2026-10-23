-- ============================================================================
-- Units & payroll for the Accounts portal.
--
-- An institution can run several units, each paying its own staff. PMSA has
-- six (seeded below). Staff get a unit and a salary; payroll is run per unit
-- per month and, once paid, posts one "Staff Salaries" expense charged to that
-- unit. Other expenses can be charged to a unit too, so each unit's monthly
-- cost = salaries + its own expenses. Rows with no unit are the institution's
-- common costs ("PMSA – Common").
--
-- Every table carries `institution` (see institutions.sql) and is super-admin
-- only, like the rest of the accounting tables. The app scopes queries through
-- lib/scoped-db.ts.
--
-- Run once in the Supabase SQL editor, after institutions.sql. Safe to run again.
-- ============================================================================

-- Units ----------------------------------------------------------------------
create table if not exists public.units (
  id             uuid primary key default gen_random_uuid(),
  institution    text not null default 'pmsa',
  name           text not null,
  sort           integer not null default 0,
  active         boolean not null default true,
  monthly_budget numeric(14,2) check (monthly_budget is null or monthly_budget >= 0),
  created_at     timestamptz not null default now(),
  unique (institution, name)
);

insert into public.units (institution, name, sort) values
  ('pmsa', 'KYHSS Athavanad',     1),
  ('pmsa', 'Yatheem Khana',     2),
  ('pmsa', 'PMSA Wafy College', 3),
  ('pmsa', 'Madrasa',           4),
  ('pmsa', 'PTM HSS, Vettichira', 5),
  ('pmsa', 'SMSTMWC',          6)
on conflict (institution, name) do nothing;

-- Staff salary ---------------------------------------------------------------
alter table public.staff add column if not exists unit_id      uuid references public.units(id) on delete set null;
alter table public.staff add column if not exists basic_salary numeric(12,2) check (basic_salary is null or basic_salary >= 0);
alter table public.staff add column if not exists joined_on    date;
alter table public.staff add column if not exists left_on      date;
create index if not exists idx_staff_unit on public.staff (unit_id);

-- Basic salary history: the basic in force for a month is the latest revision
-- that started on or before that month's last day. A raise never rewrites
-- months already paid.
create table if not exists public.salary_revisions (
  id             uuid primary key default gen_random_uuid(),
  institution    text not null default 'pmsa',
  staff_id       uuid not null references public.staff(id) on delete cascade,
  basic_salary   numeric(12,2) not null check (basic_salary >= 0),
  effective_from date not null,
  created_at     timestamptz not null default now(),
  unique (staff_id, effective_from)
);
create index if not exists idx_salary_revisions_staff on public.salary_revisions (staff_id);

-- Recurring monthly items on top of basic:
--   allowance  → added to gross pay (DA, HRA, special allowance)
--   deduction  → taken from net pay (PF employee share, advance recovery)
--   employer   → paid by the institution on top of gross (PF/ESI employer share)
create table if not exists public.salary_components (
  id             uuid primary key default gen_random_uuid(),
  institution    text not null default 'pmsa',
  staff_id       uuid not null references public.staff(id) on delete cascade,
  kind           text not null check (kind in ('allowance','deduction','employer')),
  name           text not null,
  amount         numeric(12,2) not null check (amount >= 0),
  effective_from date not null,
  effective_to   date,
  created_at     timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists idx_salary_components_staff on public.salary_components (staff_id);

-- Payroll --------------------------------------------------------------------
create table if not exists public.payroll_runs (
  id          uuid primary key default gen_random_uuid(),
  institution text not null default 'pmsa',
  unit_id     uuid not null references public.units(id) on delete restrict,
  month       date not null check (extract(day from month) = 1),
  status      text not null default 'draft' check (status in ('draft','approved','paid')),
  paid_on     date,
  created_at  timestamptz not null default now(),
  unique (unit_id, month)
);

-- Each line keeps its own copy of the amounts, so a closed month never changes
-- when salaries are edited later.
create table if not exists public.payroll_lines (
  id              uuid primary key default gen_random_uuid(),
  institution     text not null default 'pmsa',
  run_id          uuid not null references public.payroll_runs(id) on delete cascade,
  staff_id        uuid references public.staff(id) on delete set null,
  staff_name      text not null,
  designation     text,
  days_in_month   integer not null check (days_in_month between 28 and 31),
  days_worked     integer not null check (days_worked >= 0),
  basic           numeric(12,2) not null default 0,
  allowances      numeric(12,2) not null default 0,
  deductions      numeric(12,2) not null default 0,
  employer        numeric(12,2) not null default 0,
  bonus           numeric(12,2) not null default 0 check (bonus >= 0),
  other_deduction numeric(12,2) not null default 0 check (other_deduction >= 0),
  gross           numeric(12,2) not null default 0,
  net             numeric(12,2) not null default 0,
  cost            numeric(12,2) not null default 0,
  note            text,
  check (days_worked <= days_in_month)
);
create index if not exists idx_payroll_lines_run on public.payroll_lines (run_id);

-- Transactions charged to a unit; payroll_run_id links a salary expense to the
-- run that posted it, and its uniqueness stops a run being posted twice.
alter table public.transactions add column if not exists unit_id        uuid references public.units(id) on delete set null;
alter table public.transactions add column if not exists payroll_run_id uuid references public.payroll_runs(id) on delete set null;
create index if not exists idx_tx_unit on public.transactions (unit_id);
create unique index if not exists uq_tx_payroll_run on public.transactions (payroll_run_id) where payroll_run_id is not null;

-- Institution tag + super-admin-only access on the new tables -----------------
DO $units$
DECLARE
  t   text;
  pol record;
BEGIN
  FOREACH t IN ARRAY ARRAY['units','salary_revisions','salary_components','payroll_runs','payroll_lines']
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_institution_check');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (institution IN (''ihlamudheen'',''gracevalley'',''pmsa''))',
      t, t || '_institution_check');
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (institution)', 'idx_' || t || '_institution', t);

    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.is_superadmin()) WITH CHECK (public.is_superadmin())',
      'superadmin only - ' || t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END
$units$;

-- Check: the six PMSA units.
select name, sort from public.units where institution = 'pmsa' order by sort;
