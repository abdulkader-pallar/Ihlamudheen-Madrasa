-- ============================================================
-- Staff Members table
-- Written by /api/add-staff when admin onboards a teacher.
-- Acts as the live source of truth for teacher roster, ZK device
-- ID mapping, and pay configuration — complementing the static
-- initialTeachers array in courses.ts.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_members (
  id                    TEXT        PRIMARY KEY,  -- e.g. "t47" (t + ZK device ID)
  name                  TEXT        NOT NULL,
  email                 TEXT,
  phone                 TEXT,
  fingerprint_device_id INTEGER     UNIQUE,       -- ZKTeco device user ID
  pay_type              TEXT        NOT NULL,
  dual_pay_type         TEXT,
  fixed_monthly_rate    NUMERIC,
  daily_rate            NUMERIC,
  transport_allowance   BOOLEAN     NOT NULL DEFAULT false,
  class_ids             TEXT[]      NOT NULL DEFAULT '{}',
  teaches_madrasa         BOOLEAN     NOT NULL DEFAULT false,
  teaches_cibis         BOOLEAN     NOT NULL DEFAULT false,
  is_non_teaching       BOOLEAN     NOT NULL DEFAULT false,
  role_label            TEXT,
  auth_user_id          UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  status                TEXT        NOT NULL DEFAULT 'active',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add columns that may be missing if the table already existed
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS status     TEXT        NOT NULL DEFAULT 'active';
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS role_label TEXT;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS is_non_teaching BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS teaches_cibis   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS teaches_madrasa   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS class_ids       TEXT[]  NOT NULL DEFAULT '{}';
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS transport_allowance BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS daily_rate      NUMERIC;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS fixed_monthly_rate NUMERIC;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS dual_pay_type   TEXT;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS phone           TEXT;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS email           TEXT;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS fingerprint_device_id INTEGER;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_staff_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_staff_updated_at ON public.staff_members;
CREATE TRIGGER trg_staff_updated_at
  BEFORE UPDATE ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.set_staff_updated_at();

-- ── Row Level Security ──────────────────────────────────────
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

-- Authenticated users (teachers/admin) can read all staff
CREATE POLICY "staff_members_auth_select"
  ON public.staff_members
  FOR SELECT TO authenticated
  USING (true);

-- Only service_role (server-side API) can insert / update / delete
CREATE POLICY "staff_members_service_write"
  ON public.staff_members
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
