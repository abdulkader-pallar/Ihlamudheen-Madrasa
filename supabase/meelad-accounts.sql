-- ============================================================================
--  MEELAD UL NABI PROGRAM — STANDALONE ACCOUNTS BOOK
--
--  A completely separate income/expenditure book for the Meelad ul Nabi
--  program. It shares NOTHING with the institute accounting module
--  (transactions / categories / funds) and nothing with the office daily
--  ledger (office_finance_ledger). Its own table, its own policies, its own
--  totals. Deleting or reworking either of those does not touch this book.
--
--  Entries are tagged with a program_year so each year's Meelad is its own
--  book: pick the year in the UI and you see only that year's income,
--  expenses, and balance.
--
--  Access: the two institute super-admins only — the same rule the accounting
--  module uses (public.is_superadmin(), see lock-accounting-to-superadmins.sql).
--
--  HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> paste ALL ->
--  Run. Safe to re-run; it never deletes data.
-- ============================================================================

-- ── Dependency: public.is_superadmin() ─────────────────────────────────────
-- Normally created by lock-accounting-to-superadmins.sql. Created here ONLY if
-- it is missing, so re-running this file never silently overwrites an edited
-- super-admin list. To change who has access, edit that file and re-run it.
DO $$ BEGIN
  IF to_regprocedure('public.is_superadmin()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.is_superadmin()
      RETURNS boolean LANGUAGE sql STABLE AS $body$
        SELECT coalesce(
          lower(auth.jwt() ->> 'email') IN (
            'cryptolife676@gmail.com',
            'abdulkaderpallar@gmail.com'
          ), false);
      $body$;
    $fn$;
    RAISE NOTICE 'created public.is_superadmin()';
  END IF;
END $$;

-- ── Dependency: shared updated_at trigger fn ───────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── The book ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meelad_accounts_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_year    int  NOT NULL,                        -- 2026 = Meelad 2026
  entry_date      date NOT NULL,
  type            text NOT NULL CHECK (type IN ('income', 'expense')),
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  category        text,                                 -- Donation, Food, Stage…
  description     text NOT NULL,                        -- what this entry is
  party           text,                                 -- received from / paid to
  payment_mode    text NOT NULL DEFAULT 'cash'
                    CHECK (payment_mode IN ('cash', 'bank', 'upi', 'cheque', 'other')),
  voucher_no      text,                                 -- receipt / bill number
  remarks         text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- The UI always filters by year and sorts by date, so index that pair.
CREATE INDEX IF NOT EXISTS idx_meelad_accounts_year_date
  ON public.meelad_accounts_entries (program_year, entry_date);

DROP TRIGGER IF EXISTS trg_meelad_accounts_updated_at ON public.meelad_accounts_entries;
CREATE TRIGGER trg_meelad_accounts_updated_at
  BEFORE UPDATE ON public.meelad_accounts_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Access: super-admins only ──────────────────────────────────────────────
-- RLS is the real boundary. The checks in the app are only the UI layer; a
-- non-super-admin calling the API directly still gets zero rows and zero writes.
ALTER TABLE public.meelad_accounts_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meelad accounts: read"   ON public.meelad_accounts_entries;
DROP POLICY IF EXISTS "meelad accounts: insert" ON public.meelad_accounts_entries;
DROP POLICY IF EXISTS "meelad accounts: update" ON public.meelad_accounts_entries;
DROP POLICY IF EXISTS "meelad accounts: delete" ON public.meelad_accounts_entries;

CREATE POLICY "meelad accounts: read" ON public.meelad_accounts_entries
  FOR SELECT TO authenticated
  USING (public.is_superadmin());

-- Every row must be attributed to whoever actually inserted it.
CREATE POLICY "meelad accounts: insert" ON public.meelad_accounts_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.is_superadmin() AND created_by = auth.uid());

CREATE POLICY "meelad accounts: update" ON public.meelad_accounts_entries
  FOR UPDATE TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

CREATE POLICY "meelad accounts: delete" ON public.meelad_accounts_entries
  FOR DELETE TO authenticated
  USING (public.is_superadmin());

-- ── Verify ─────────────────────────────────────────────────────────────────
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'meelad_accounts_entries'
ORDER BY policyname;
