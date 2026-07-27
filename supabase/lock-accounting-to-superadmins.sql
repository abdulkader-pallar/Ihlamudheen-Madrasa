-- ============================================================================
--  LOCK THE ACCOUNTING MODULE TO THE TWO SUPER-ADMINS   (v2 - resilient)
--
--  Restricts every accounting table that exists (transactions, categories,
--  funds, staff, attendance) so ONLY the two institute super-admins can read
--  or write. No other user - including future admins, teachers and office
--  staff - can see this data, even by calling the API directly.
--
--  Tables that do not exist in this database are skipped automatically.
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
