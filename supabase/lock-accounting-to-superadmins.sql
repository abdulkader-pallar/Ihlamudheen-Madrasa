-- ============================================================================
--  LOCK THE ACCOUNTING MODULE TO THE TWO SUPER-ADMINS
--
--  Restricts every accounting table (transactions, categories, funds, staff,
--  staff attendance) so ONLY the two institute super-admins can read or write.
--  No other user — including future admins, teachers and office staff — can
--  see this data, even by calling the API directly.
--
--  This does NOT delete any data. It only replaces access policies.
--  Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--  Safe to re-run.
-- ============================================================================

-- Who counts as a super-admin. Identity comes from the verified session token
-- (auth.jwt()), so it cannot be spoofed by the client.
-- To change who has accounting access, edit this list and re-run the file.
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

-- ── transactions ────────────────────────────────────────────────────────────
drop policy if exists "members read transactions"   on public.transactions;
drop policy if exists "editors insert transactions" on public.transactions;
drop policy if exists "editors update transactions" on public.transactions;
drop policy if exists "editors delete transactions" on public.transactions;
drop policy if exists "superadmin transactions"     on public.transactions;
create policy "superadmin transactions" on public.transactions
  for all using (public.is_superadmin()) with check (public.is_superadmin());

-- ── categories ──────────────────────────────────────────────────────────────
drop policy if exists "members read categories"  on public.categories;
drop policy if exists "editors write categories" on public.categories;
drop policy if exists "superadmin categories"    on public.categories;
create policy "superadmin categories" on public.categories
  for all using (public.is_superadmin()) with check (public.is_superadmin());

-- ── funds ───────────────────────────────────────────────────────────────────
drop policy if exists "members read funds"  on public.funds;
drop policy if exists "editors write funds" on public.funds;
drop policy if exists "superadmin funds"    on public.funds;
create policy "superadmin funds" on public.funds
  for all using (public.is_superadmin()) with check (public.is_superadmin());

-- ── staff (accounting staff register) ───────────────────────────────────────
drop policy if exists "members read staff"  on public.staff;
drop policy if exists "editors write staff" on public.staff;
drop policy if exists "superadmin staff"    on public.staff;
create policy "superadmin staff" on public.staff
  for all using (public.is_superadmin()) with check (public.is_superadmin());

-- ── attendance (accounting staff attendance / punches) ──────────────────────
drop policy if exists "members read attendance"  on public.attendance;
drop policy if exists "editors write attendance" on public.attendance;
drop policy if exists "superadmin attendance"    on public.attendance;
create policy "superadmin attendance" on public.attendance
  for all using (public.is_superadmin()) with check (public.is_superadmin());

-- RLS must stay enabled on all of them (it already is; this is a no-op guard).
alter table public.transactions enable row level security;
alter table public.categories   enable row level security;
alter table public.funds        enable row level security;
alter table public.staff        enable row level security;
alter table public.attendance   enable row level security;

-- ── Verify (should list exactly one "superadmin ..." policy per table) ──────
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('transactions','categories','funds','staff','attendance')
order by tablename, policyname;
