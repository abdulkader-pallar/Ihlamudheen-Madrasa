-- ══════════════════════════════════════════════════════════
-- Monthly Salaries — approval & payment audit trail
-- One row per (teacher_id, year, month). Computed by app from
-- staff_attendance + payroll rules, then persisted here at
-- approval time. Paid rows are LOCKED via trigger.
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.monthly_salaries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  year SMALLINT NOT NULL CHECK (year BETWEEN 2024 AND 2100),
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),

  -- Snapshot of the calc at the moment of approval (frozen for audit)
  days_present SMALLINT NOT NULL DEFAULT 0,
  sessions SMALLINT NOT NULL DEFAULT 0,
  hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  gross_pay NUMERIC(10,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_pay NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Workflow state
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'paid')),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  paid_by UUID REFERENCES auth.users(id),
  paid_at TIMESTAMPTZ,
  payment_note TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (teacher_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_salaries_year_month
  ON public.monthly_salaries(year, month);
CREATE INDEX IF NOT EXISTS idx_monthly_salaries_teacher
  ON public.monthly_salaries(teacher_id);
CREATE INDEX IF NOT EXISTS idx_monthly_salaries_status
  ON public.monthly_salaries(status);

-- ── Immutability trigger: PAID rows cannot be altered ────
-- Only allow updates that keep the row in/transition to a valid state.
-- Once status='paid', any further UPDATE/DELETE is blocked.
CREATE OR REPLACE FUNCTION public.lock_paid_salaries()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' THEN
    RAISE EXCEPTION 'Cannot modify a paid salary record (teacher=%, %-%). Paid records are immutable.',
      OLD.teacher_id, OLD.year, OLD.month;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status = 'paid' THEN
    RAISE EXCEPTION 'Cannot delete a paid salary record (teacher=%, %-%). Paid records are immutable.',
      OLD.teacher_id, OLD.year, OLD.month;
  END IF;

  -- Touch updated_at on UPDATE
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at = now();
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lock_paid_salaries_upd ON public.monthly_salaries;
CREATE TRIGGER trg_lock_paid_salaries_upd
  BEFORE UPDATE ON public.monthly_salaries
  FOR EACH ROW EXECUTE FUNCTION public.lock_paid_salaries();

DROP TRIGGER IF EXISTS trg_lock_paid_salaries_del ON public.monthly_salaries;
CREATE TRIGGER trg_lock_paid_salaries_del
  BEFORE DELETE ON public.monthly_salaries
  FOR EACH ROW EXECUTE FUNCTION public.lock_paid_salaries();

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE public.monthly_salaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin/accountant read salaries"  ON public.monthly_salaries;
DROP POLICY IF EXISTS "Admin/accountant write salaries" ON public.monthly_salaries;

CREATE POLICY "Admin/accountant read salaries"
  ON public.monthly_salaries FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'accountant'));

CREATE POLICY "Admin/accountant write salaries"
  ON public.monthly_salaries FOR ALL TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'accountant'))
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'accountant'));

-- ── Enable realtime ──────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.monthly_salaries;
