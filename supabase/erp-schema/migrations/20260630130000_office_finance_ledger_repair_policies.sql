-- ───────────────────────────────────────────────────────────────────────────
-- Repair: re-assert RLS policies on public.office_finance_ledger.
--
-- In production the table ended up with ROW LEVEL SECURITY ENABLED but with NO
-- policies attached (the CREATE POLICY statements from
-- 20260630120000_office_shared_finance_ledger.sql did not land). With RLS on and
-- no permissive policy, PostgreSQL denies *every* row — so admin AND accountant
-- both hit "new row violates row-level security policy for table
-- office_finance_ledger" when adding a daily income/expense entry.
--
-- This migration is idempotent and only (re)creates the policies, so it is safe
-- to run on databases that already have them. The access rules are unchanged
-- from the original migration: admin + accountant read/insert the shared ledger,
-- and an entry's own author (or any admin) may edit/delete it.
-- ───────────────────────────────────────────────────────────────────────────

-- Guard: do nothing if the table itself is missing.
DO $$ BEGIN
  IF to_regclass('public.office_finance_ledger') IS NULL THEN
    RAISE NOTICE 'office_finance_ledger missing; skipping policy repair';
    RETURN;
  END IF;

  -- RLS must be on for the policies to take effect (no-op if already enabled).
  ALTER TABLE public.office_finance_ledger ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "office finance ledger: read"   ON public.office_finance_ledger;
  DROP POLICY IF EXISTS "office finance ledger: insert" ON public.office_finance_ledger;
  DROP POLICY IF EXISTS "office finance ledger: update" ON public.office_finance_ledger;
  DROP POLICY IF EXISTS "office finance ledger: delete" ON public.office_finance_ledger;

  -- Read: any office user (admin + accountant) sees the whole shared ledger.
  CREATE POLICY "office finance ledger: read" ON public.office_finance_ledger
    FOR SELECT TO authenticated
    USING (public.app_role() IN ('admin', 'accountant'));

  -- Insert: admin + accountant, and the row must be attributed to the inserter.
  CREATE POLICY "office finance ledger: insert" ON public.office_finance_ledger
    FOR INSERT TO authenticated
    WITH CHECK (
      public.app_role() IN ('admin', 'accountant') AND created_by = auth.uid()
    );

  -- Update / delete: an entry's own author, or any admin.
  CREATE POLICY "office finance ledger: update" ON public.office_finance_ledger
    FOR UPDATE TO authenticated
    USING (public.app_role() = 'admin' OR created_by = auth.uid())
    WITH CHECK (public.app_role() = 'admin' OR created_by = auth.uid());

  CREATE POLICY "office finance ledger: delete" ON public.office_finance_ledger
    FOR DELETE TO authenticated
    USING (public.app_role() = 'admin' OR created_by = auth.uid());
END $$;
