-- ============================================================================
--  Ihlamudheen Madrasa — Accounting Portal Database Schema
-- ============================================================================
--  This file is IDEMPOTENT: it is safe to run repeatedly. It creates the
--  tables, roles, Row Level Security (RLS) policies, helper functions,
--  triggers, and seed data required by the private accounting portal.
--
--  Security model (summary):
--    * RLS is ENABLED on every table.
--    * The public/anon role receives NO table grants at all.
--    * Only AUTHENTICATED users who have a profile row can READ.
--    * Only users whose role is 'admin' or 'accountant' can WRITE.
--    * SECURITY DEFINER helper functions read the caller's role without
--      triggering RLS recursion.
--
--  Run this in the Supabase SQL Editor (see SETUP.md).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'accountant', 'viewer');
  end if;

  if not exists (select 1 from pg_type where typname = 'txn_type') then
    create type public.txn_type as enum ('income', 'expense');
  end if;

  if not exists (select 1 from pg_type where typname = 'category_kind') then
    create type public.category_kind as enum ('income', 'expense');
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- profiles: one row per auth user, holds their role.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  role        public.user_role not null default 'viewer',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- categories: income/expense classification.
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        public.category_kind not null,
  created_at  timestamptz not null default now(),
  unique (name, kind)
);

-- funds: earmarked pools of money (General, Building, Zakat, ...).
create table if not exists public.funds (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);

-- transactions: the income & expenditure ledger.
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  type         public.txn_type not null,
  amount       numeric(14,2) not null check (amount > 0),
  txn_date     date not null default current_date,
  category_id  uuid references public.categories (id) on delete set null,
  fund_id      uuid references public.funds (id) on delete set null,
  description  text,
  reference    text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now()
);

create index if not exists transactions_date_idx     on public.transactions (txn_date desc);
create index if not exists transactions_type_idx     on public.transactions (type);
create index if not exists transactions_category_idx on public.transactions (category_id);
create index if not exists transactions_fund_idx     on public.transactions (fund_id);

-- ---------------------------------------------------------------------------
-- 3. SECURITY DEFINER helper functions (avoid RLS recursion on profiles)
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

create or replace function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'accountant')
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Triggers: auto-create profile on signup, stamp audit fields
-- ---------------------------------------------------------------------------

-- 4a. New auth user -> viewer profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'viewer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4b. Stamp updated_by / updated_at on profile changes.
create or replace function public.touch_profile()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_profile on public.profiles;
create trigger trg_touch_profile
  before update on public.profiles
  for each row execute function public.touch_profile();

-- 4c. Stamp created_by/at + updated_by/at on transactions (audit trail).
create or replace function public.stamp_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_at := coalesce(new.created_at, now());
    new.updated_by := auth.uid();
    new.updated_at := now();
  elsif (tg_op = 'UPDATE') then
    new.created_by := old.created_by;   -- immutable
    new.created_at := old.created_at;   -- immutable
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_transaction on public.transactions;
create trigger trg_stamp_transaction
  before insert or update on public.transactions
  for each row execute function public.stamp_transaction();

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.categories   enable row level security;
alter table public.funds        enable row level security;
alter table public.transactions enable row level security;

-- Force RLS even for table owners in routine access paths.
alter table public.profiles     force row level security;
alter table public.categories   force row level security;
alter table public.funds        force row level security;
alter table public.transactions force row level security;

-- Revoke ALL from anon/public: the browser anon role gets nothing.
revoke all on public.profiles     from anon;
revoke all on public.categories   from anon;
revoke all on public.funds        from anon;
revoke all on public.transactions from anon;

-- --- profiles policies -----------------------------------------------------
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.current_user_role() = 'admin');

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_user_role()); -- can't self-escalate role

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- --- categories policies ---------------------------------------------------
drop policy if exists categories_read_members on public.categories;
create policy categories_read_members on public.categories
  for select to authenticated
  using (public.is_member());

drop policy if exists categories_write_editors on public.categories;
create policy categories_write_editors on public.categories
  for all to authenticated
  using (public.is_editor())
  with check (public.is_editor());

-- --- funds policies --------------------------------------------------------
drop policy if exists funds_read_members on public.funds;
create policy funds_read_members on public.funds
  for select to authenticated
  using (public.is_member());

drop policy if exists funds_write_editors on public.funds;
create policy funds_write_editors on public.funds
  for all to authenticated
  using (public.is_editor())
  with check (public.is_editor());

-- --- transactions policies -------------------------------------------------
drop policy if exists transactions_read_members on public.transactions;
create policy transactions_read_members on public.transactions
  for select to authenticated
  using (public.is_member());

drop policy if exists transactions_write_editors on public.transactions;
create policy transactions_write_editors on public.transactions
  for all to authenticated
  using (public.is_editor())
  with check (public.is_editor());

-- ---------------------------------------------------------------------------
-- 6. Seed data (idempotent)
-- ---------------------------------------------------------------------------

-- Income categories
insert into public.categories (name, kind) values
  ('Student Fees',            'income'),
  ('Admission Fees',          'income'),
  ('Monthly Tuition',         'income'),
  ('Examination Fees',        'income'),
  ('Donations / Sadaqah',     'income'),
  ('Zakat Received',          'income'),
  ('Fitr / Fidya',            'income'),
  ('Fundraising',             'income'),
  ('Grants & Aid',            'income'),
  ('Rent Income',             'income'),
  ('Book & Uniform Sales',    'income'),
  ('Event Contributions',     'income'),
  ('Waqf / Endowment Income', 'income'),
  ('Miscellaneous Income',    'income')
on conflict (name, kind) do nothing;

-- Expense categories
insert into public.categories (name, kind) values
  ('Staff Salaries',              'expense'),
  ('Ustadh Honorarium',          'expense'),
  ('Administrative Staff',        'expense'),
  ('Utilities (Electricity/Water)','expense'),
  ('Internet & Telephone',        'expense'),
  ('Rent',                        'expense'),
  ('Building Maintenance',        'expense'),
  ('Furniture & Equipment',       'expense'),
  ('Books & Learning Materials',  'expense'),
  ('Stationery & Printing',       'expense'),
  ('Student Welfare',             'expense'),
  ('Transport',                   'expense'),
  ('Events & Programs',           'expense'),
  ('Charity / Zakat Distribution','expense'),
  ('Cleaning & Sanitation',       'expense'),
  ('Bank Charges',                'expense'),
  ('Miscellaneous Expense',       'expense')
on conflict (name, kind) do nothing;

-- Funds
insert into public.funds (name, description) values
  ('General',     'Day-to-day operating fund'),
  ('Building',    'Construction, repairs and facilities'),
  ('Zakat',       'Zakat received and distributed per Shari''ah'),
  ('Scholarship', 'Fee support for deserving students'),
  ('Events',      'Annual functions, competitions and programs')
on conflict (name) do nothing;

-- ============================================================================
--  End of schema. Assign roles to users with, e.g.:
--    update public.profiles set role = 'admin'
--    where email = 'you@example.com';
-- ============================================================================
