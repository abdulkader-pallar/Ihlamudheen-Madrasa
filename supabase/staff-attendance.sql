-- ============================================================================
--  Ihlamudheen Madrasa — Staff & Attendance (punching machine) schema
--  Run this ONCE in the Supabase SQL Editor, AFTER schema.sql.
--  Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / DROP..CREATE POLICY.
--
--  What it adds
--  ------------
--  * public.staff       — one row per tracked staff member (teacher / office /
--                         driver etc.). NOT the same as portal login users.
--                         `device_user_id` = the person's enrolment number on the
--                         ZKTeco fingerprint device.
--  * public.attendance  — one row per staff member per day; first punch of the
--                         day fills check_in, a later punch fills/updates check_out.
--
--  Security model (same as the rest of the app)
--  --------------------------------------------
--  * RLS ON for both tables.
--  * Members (admin / accountant / viewer) can READ.
--  * Editors (admin / accountant) can INSERT / UPDATE / DELETE.
--  * The ZKTeco webhook (/api/zk-attendance) writes with the service_role key,
--    which bypasses RLS — the device is not a logged-in user.
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

-- ============================================================================
--  Row Level Security
-- ============================================================================
alter table public.staff      enable row level security;
alter table public.attendance enable row level security;

-- staff ----------------------------------------------------------------------
drop policy if exists "members read staff"  on public.staff;
drop policy if exists "editors write staff" on public.staff;

create policy "members read staff" on public.staff
  for select using (public.is_member());
create policy "editors write staff" on public.staff
  for all using (public.is_editor()) with check (public.is_editor());

-- attendance -----------------------------------------------------------------
drop policy if exists "members read attendance"  on public.attendance;
drop policy if exists "editors write attendance" on public.attendance;

create policy "members read attendance" on public.attendance
  for select using (public.is_member());
create policy "editors write attendance" on public.attendance
  for all using (public.is_editor()) with check (public.is_editor());

-- ============================================================================
--  Privileges: only the 'authenticated' role gets table access.
-- ============================================================================
grant select, insert, update, delete on public.staff      to authenticated;
grant select, insert, update, delete on public.attendance to authenticated;
