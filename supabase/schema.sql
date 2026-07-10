-- ============================================================================
--  Ihlamudheen Madrasa — Accounting database schema
--  Run this ONCE in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
--  It is safe to re-run: it uses IF NOT EXISTS / CREATE OR REPLACE throughout.
--
--  Security model
--  --------------
--  * Every table has Row Level Security (RLS) ON.
--  * Only AUTHENTICATED users with a profile row can read.
--  * Only 'admin' and 'accountant' roles can insert / update / delete.
--  * 'viewer' role can read (reports) but never modify.
--  * The 'anon' (public) role is granted NOTHING here — the marketing site
--    and any logged-out visitor cannot touch financial data.
-- ============================================================================

-- ---------- Roles ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'accountant', 'viewer', 'pending');
  end if;
end $$;

-- ---------- Profiles (one row per auth user) ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  role       public.user_role not null default 'pending',
  created_at timestamptz not null default now()
);

-- Reads the current user's role, bypassing RLS (SECURITY DEFINER) so that
-- policies can call it without causing infinite recursion on `profiles`.
create or replace function public.current_user_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid(); $$;

create or replace function public.is_editor()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.current_user_role() in ('admin','accountant'), false); $$;

create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.current_user_role() in ('admin','accountant','viewer'), false); $$;

-- Auto-create a profile (role 'viewer') whenever a new auth user is added.
-- New users start with NO edit rights; an admin promotes them afterwards.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'pending')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Categories ----------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null check (kind in ('income','expense')),
  created_at timestamptz not null default now(),
  unique (name, kind)
);

-- ---------- Funds / accounts ----------
create table if not exists public.funds (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);

-- ---------- Transactions ----------
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  occurred_on date not null default current_date,
  type        text not null check (type in ('income','expense')),
  amount      numeric(14,2) not null check (amount > 0),
  category_id uuid references public.categories(id) on delete set null,
  fund_id     uuid references public.funds(id) on delete set null,
  description text,
  reference   text,                              -- optional receipt / voucher no.
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz
);

create index if not exists idx_tx_occurred_on on public.transactions (occurred_on);
create index if not exists idx_tx_type        on public.transactions (type);
create index if not exists idx_tx_category    on public.transactions (category_id);

-- Audit: stamp who/when on every update.
create or replace function public.touch_updated()
returns trigger language plpgsql
as $$ begin new.updated_at = now(); new.updated_by = auth.uid(); return new; end $$;

drop trigger if exists trg_touch_tx on public.transactions;
create trigger trg_touch_tx
  before update on public.transactions
  for each row execute function public.touch_updated();

-- ============================================================================
--  Row Level Security
-- ============================================================================
alter table public.profiles     enable row level security;
alter table public.categories   enable row level security;
alter table public.funds        enable row level security;
alter table public.transactions enable row level security;

-- profiles -------------------------------------------------------------------
drop policy if exists "read own profile"     on public.profiles;
drop policy if exists "admin read profiles"  on public.profiles;
drop policy if exists "admin write profiles" on public.profiles;

create policy "read own profile" on public.profiles
  for select using (id = auth.uid());
create policy "admin read profiles" on public.profiles
  for select using (public.current_user_role() = 'admin');
create policy "admin write profiles" on public.profiles
  for all using (public.current_user_role() = 'admin')
          with check (public.current_user_role() = 'admin');

-- categories -----------------------------------------------------------------
drop policy if exists "members read categories"  on public.categories;
drop policy if exists "editors write categories" on public.categories;

create policy "members read categories" on public.categories
  for select using (public.is_member());
create policy "editors write categories" on public.categories
  for all using (public.is_editor()) with check (public.is_editor());

-- funds ----------------------------------------------------------------------
drop policy if exists "members read funds"  on public.funds;
drop policy if exists "editors write funds" on public.funds;

create policy "members read funds" on public.funds
  for select using (public.is_member());
create policy "editors write funds" on public.funds
  for all using (public.is_editor()) with check (public.is_editor());

-- transactions ---------------------------------------------------------------
drop policy if exists "members read transactions"  on public.transactions;
drop policy if exists "editors insert transactions" on public.transactions;
drop policy if exists "editors update transactions" on public.transactions;
drop policy if exists "editors delete transactions" on public.transactions;

create policy "members read transactions" on public.transactions
  for select using (public.is_member());
create policy "editors insert transactions" on public.transactions
  for insert with check (public.is_editor());
create policy "editors update transactions" on public.transactions
  for update using (public.is_editor()) with check (public.is_editor());
create policy "editors delete transactions" on public.transactions
  for delete using (public.is_editor());

-- ============================================================================
--  Privileges: only the 'authenticated' role gets table access.
--  'anon' (logged-out / public) is intentionally excluded.
-- ============================================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ============================================================================
--  Seed data — madrasa income & expense categories, and common funds.
--  Safe to re-run (ON CONFLICT DO NOTHING).
-- ============================================================================
insert into public.categories (name, kind) values
  -- Income
  ('Student Fees',            'income'),
  ('Admission Fees',          'income'),
  ('Examination Fees',        'income'),
  ('Monthly Subscriptions',   'income'),
  ('Donations (Sadaqah)',     'income'),
  ('Zakat',                   'income'),
  ('Fitr / Fidya',            'income'),
  ('Fundraising',             'income'),
  ('Grants & Aid',            'income'),
  ('Rent Income',             'income'),
  ('Book / Uniform Sales',    'income'),
  ('Profit / Interest-free Returns', 'income'),
  ('Other Income',            'income'),
  -- Expense
  ('Staff Salaries',          'expense'),
  ('Ustadh Honorarium',       'expense'),
  ('Electricity & Water',     'expense'),
  ('Rent',                    'expense'),
  ('Building & Maintenance',  'expense'),
  ('Furniture & Equipment',   'expense'),
  ('Books & Stationery',      'expense'),
  ('Examination Expenses',    'expense'),
  ('Events & Programs',       'expense'),
  ('Transport & Travel',      'expense'),
  ('Food & Refreshments',     'expense'),
  ('Cleaning & Sanitation',   'expense'),
  ('Internet & Phone',        'expense'),
  ('Charity Distribution',    'expense'),
  ('Zakat Distribution',      'expense'),
  ('Bank Charges',            'expense'),
  ('Miscellaneous',           'expense')
on conflict (name, kind) do nothing;

insert into public.funds (name, description) values
  ('General Fund',     'Day-to-day running of the madrasa'),
  ('Building Fund',    'Construction, expansion and repairs'),
  ('Zakat Fund',       'Zakat received and distributed (kept separate)'),
  ('Scholarship Fund', 'Support for students in need'),
  ('Events Fund',      'Annual day, competitions and programs')
on conflict (name) do nothing;

-- ============================================================================
--  AFTER running this file:
--  1. Dashboard → Authentication → Providers → Email: turn OFF "Allow new users
--     to sign up" (invite-only). Turn ON "Confirm email" if you want.
--  2. Create your users: Authentication → Users → Add user (or invite).
--  3. Make yourself an admin (replace the email):
--        update public.profiles
--        set role = 'admin'
--        where id = (select id from auth.users where email = 'you@example.com');
--     Then set others to 'accountant' or leave as 'viewer'.
-- ============================================================================
