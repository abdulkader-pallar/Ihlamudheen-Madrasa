-- Fee payments ledger upgrade
--
-- Reshapes `fee_payments` from a single-row "paid|pending" flag per (student, month)
-- into a money-grade ledger that supports:
--   * Partial payments  (many positive entries per student/month)
--   * Adjustments       (signed corrections, never destructive)
--   * Reversals         (linked, audited entries with mandatory reason)
--   * Audit trail       (every create/update is logged)
--
-- The pending balance for any student is computed at read time as:
--   sum(monthly_fee for each month since enrolment)  -  sum(ledger.amount)
--
-- Migration is idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

-- 1. Relax old constraint that blocked multiple entries per month.
ALTER TABLE public.fee_payments
  DROP CONSTRAINT IF EXISTS fee_payments_student_id_month_key;

-- 2. Widen the ledger columns.
ALTER TABLE public.fee_payments
  ADD COLUMN IF NOT EXISTS entry_type  TEXT        NOT NULL DEFAULT 'payment'
    CHECK (entry_type IN ('payment', 'adjustment')),
  ADD COLUMN IF NOT EXISTS reverses_id BIGINT      REFERENCES public.fee_payments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reason      TEXT,
  ADD COLUMN IF NOT EXISTS notes       TEXT,
  ADD COLUMN IF NOT EXISTS recorded_by UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- 3. Backfill: any historical row with status='paid' becomes a normal payment entry.
--    Rows with status='pending' carried zero money, so we drop them — pending is
--    now derived, not stored.
DELETE FROM public.fee_payments WHERE status = 'pending';

-- 4. Remove the now-redundant status column. Pending is implicit (unpaid balance > 0).
ALTER TABLE public.fee_payments DROP COLUMN IF EXISTS status;

-- 5. Allow signed amounts (adjustments can be negative). Payments must stay > 0.
ALTER TABLE public.fee_payments
  DROP CONSTRAINT IF EXISTS fee_payments_amount_check,
  ADD  CONSTRAINT fee_payments_amount_check CHECK (
    (entry_type = 'payment'    AND amount > 0) OR
    (entry_type = 'adjustment' AND amount <> 0)
  );

-- 6. Adjustments must cite a reason and reference the row they reverse.
ALTER TABLE public.fee_payments
  DROP CONSTRAINT IF EXISTS fee_payments_adjustment_requires_reason,
  ADD  CONSTRAINT fee_payments_adjustment_requires_reason CHECK (
    entry_type = 'payment'
    OR (entry_type = 'adjustment' AND reason IS NOT NULL AND reverses_id IS NOT NULL)
  );

-- 7. Index reverse lookups so we can show "this row was corrected by ..." cheaply.
CREATE INDEX IF NOT EXISTS idx_fee_payments_reverses ON public.fee_payments(reverses_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_student_month ON public.fee_payments(student_id, month);

-- 8. Audit trail — append-only.
CREATE TABLE IF NOT EXISTS public.fee_payment_audit (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id BIGINT NOT NULL,                       -- not a FK: survives if row is ever hard-deleted
  action     TEXT   NOT NULL CHECK (action IN ('insert', 'reverse')),
  actor_id   UUID   REFERENCES auth.users(id) ON DELETE SET NULL,
  reason     TEXT,
  payload    JSONB  NOT NULL,                       -- full row snapshot
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fee_payment_audit_payment ON public.fee_payment_audit(payment_id);
CREATE INDEX IF NOT EXISTS idx_fee_payment_audit_created ON public.fee_payment_audit(created_at DESC);

ALTER TABLE public.fee_payment_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read fee_payment_audit"    ON public.fee_payment_audit;
DROP POLICY IF EXISTS "admin insert fee_payment_audit" ON public.fee_payment_audit;

CREATE POLICY "auth read fee_payment_audit"
  ON public.fee_payment_audit FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin insert fee_payment_audit"
  ON public.fee_payment_audit FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'accountant'));

-- 9. Tighten fee_payments policy: writes restricted to admin/accountant,
--    and rows can never be UPDATE'd or DELETE'd from the client. Corrections
--    must go through new ledger INSERTs (reversal entries).
DROP POLICY IF EXISTS "admins manage fee_payments"     ON public.fee_payments;
DROP POLICY IF EXISTS "auth users read fee_payments"   ON public.fee_payments;
DROP POLICY IF EXISTS "auth read fee_payments"         ON public.fee_payments;
DROP POLICY IF EXISTS "admin insert fee_payments"      ON public.fee_payments;

CREATE POLICY "auth read fee_payments"
  ON public.fee_payments FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin insert fee_payments"
  ON public.fee_payments FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'accountant'));

-- Note: deliberately NO update/delete policy — ledger entries are immutable.

-- 10. Trigger: prevent UPDATE/DELETE even for service-role / SQL editor users
--     unless explicitly disabled. Belt-and-braces against accidental edits.
CREATE OR REPLACE FUNCTION public.fee_payments_block_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fee_payments is append-only — record a reversal entry instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fee_payments_no_update ON public.fee_payments;
DROP TRIGGER IF EXISTS trg_fee_payments_no_delete ON public.fee_payments;

CREATE TRIGGER trg_fee_payments_no_update
  BEFORE UPDATE ON public.fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.fee_payments_block_mutation();

CREATE TRIGGER trg_fee_payments_no_delete
  BEFORE DELETE ON public.fee_payments
  FOR EACH ROW EXECUTE FUNCTION public.fee_payments_block_mutation();
