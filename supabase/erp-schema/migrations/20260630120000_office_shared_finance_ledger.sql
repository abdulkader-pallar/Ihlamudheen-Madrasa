-- ───────────────────────────────────────────────────────────────────────────
-- Shared institute-wide daily income/expenditure ledger for the Office Routine.
--
-- Previously finance lived INSIDE each staff member's daily report (scoped by
-- staff_id + report_date) and was rewritten on every save. That fragmented the
-- day's money across staff and let earlier entries be lost. This table is
-- DAY-SCOPED and SHARED across admin + accountant, with attribution
-- (created_by / created_by_name) so every entry shows who recorded it.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.office_finance_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date      date NOT NULL,
  type            text NOT NULL CHECK (type IN ('income', 'expense')),
  amount          numeric(12,2) NOT NULL DEFAULT 0,
  category        text,
  description     text,
  remarks         text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_office_finance_ledger_date ON public.office_finance_ledger (entry_date);

-- Keep updated_at fresh (reuse the shared trigger fn from the routine migration).
DROP TRIGGER IF EXISTS trg_office_finance_ledger_updated_at ON public.office_finance_ledger;
CREATE TRIGGER trg_office_finance_ledger_updated_at
  BEFORE UPDATE ON public.office_finance_ledger
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

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
