-- ============================================================================
--  Ihlamudheen — add Staff & Attendance, locked to the super-admins
--  The tables from staff-attendance.sql, then the same super-admin-only RLS
--  as lock-accounting-to-superadmins.sql (instead of staff-attendance.sql's
--  member/editor policies). Safe to re-run.
-- ============================================================================

-- ---------- Staff ----------
create table if not exists public.staff (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  designation    text,                       -- e.g. Teacher, Office, Driver
  device_user_id integer unique,             -- ZKTeco enrolment number (nullable)
  phone          text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists idx_staff_device on public.staff (device_user_id);

-- ---------- Attendance ----------
create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  work_date   date not null default current_date,
  check_in    time,
  check_out   time,
  source      text not null default 'device' check (source in ('device','manual')),
  remarks     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  unique (staff_id, work_date)               -- one row per staff per day
);

create index if not exists idx_attendance_date  on public.attendance (work_date);
create index if not exists idx_attendance_staff on public.attendance (staff_id);

-- Stamp updated_at on every change.
create or replace function public.touch_attendance()
returns trigger language plpgsql
as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_touch_attendance on public.attendance;
create trigger trg_touch_attendance
  before update on public.attendance
  for each row execute function public.touch_attendance();

grant select, insert, update, delete on public.staff      to authenticated;
grant select, insert, update, delete on public.attendance to authenticated;

create or replace function public.is_superadmin()
returns boolean
language sql stable
as $$
  select coalesce(
    lower(auth.jwt() ->> 'email') in (
      'cryptolife676@gmail.com',
      'abdulkaderpallar@gmail.com'
    ), false);
$$;

-- ---------------------------------------------------------------------------
-- For each accounting table that exists: drop every existing policy on it and
-- install a single super-admin-only policy.
-- ---------------------------------------------------------------------------
DO $lock$
DECLARE
  t    text;
  pol  record;
  done text := '';
  skip text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY['transactions','categories','funds','staff','attendance']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      skip := skip || t || ' ';
      CONTINUE;
    END IF;

    -- remove any existing policies on this table
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    -- enable RLS and install the super-admin-only policy
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.is_superadmin()) WITH CHECK (public.is_superadmin())',
      'superadmin only - ' || t, t);

    done := done || t || ' ';
  END LOOP;

  RAISE NOTICE 'Locked: %', done;
  IF skip <> '' THEN
    RAISE NOTICE 'Skipped (table not in this database): %', skip;
  END IF;
END
$lock$;

-- ── Verify: one "superadmin only - <table>" policy per existing table ───────
select tablename, policyname, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('transactions','categories','funds','staff','attendance')
order by tablename, policyname;
