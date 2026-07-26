-- Fee payments tracking: per student per month paid/pending status

CREATE TABLE IF NOT EXISTS public.fee_payments (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_id    TEXT NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,  -- "YYYY-MM"
  amount      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('paid', 'pending')),
  paid_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(student_id, month)
);

CREATE INDEX idx_fee_payments_month ON public.fee_payments(month);
CREATE INDEX idx_fee_payments_student ON public.fee_payments(student_id);

ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth users read fee_payments"
  ON public.fee_payments FOR SELECT TO authenticated USING (true);

CREATE POLICY "admins manage fee_payments"
  ON public.fee_payments FOR ALL TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'teacher'));
