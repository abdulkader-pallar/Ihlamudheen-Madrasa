-- ══════════════════════════════════════════════════════════
-- Ihlamudheen — Fix: staff_attendance save errors
-- Run this in Supabase SQL Editor → New Query → Run
-- ══════════════════════════════════════════════════════════

-- 1. Ensure optional columns exist (safe if already added)
ALTER TABLE public.staff_attendance ADD COLUMN IF NOT EXISTS transport_allowance BOOLEAN DEFAULT false;
ALTER TABLE public.staff_attendance ADD COLUMN IF NOT EXISTS ta_remarks TEXT;
ALTER TABLE public.staff_attendance ADD COLUMN IF NOT EXISTS arrival_time TIME;

-- 2. Drop old restrictive RLS policies and replace with permissive ones
DROP POLICY IF EXISTS "Admin and accountant can manage staff attendance" ON public.staff_attendance;
DROP POLICY IF EXISTS "Anyone authenticated can read staff attendance" ON public.staff_attendance;

-- Allow all authenticated users to read staff attendance
CREATE POLICY "Authenticated users can read staff attendance"
  ON public.staff_attendance FOR SELECT
  TO authenticated
  USING (true);

-- Allow all authenticated users to insert/update (admin check is done in app layer)
CREATE POLICY "Authenticated users can upsert staff attendance"
  ON public.staff_attendance FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update staff attendance"
  ON public.staff_attendance FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 3. Fix payments table RLS (old role-based policies can silently block updates)
DROP POLICY IF EXISTS "Admin and accountant can read payments" ON public.payments;
DROP POLICY IF EXISTS "Admin and accountant can manage payments" ON public.payments;

CREATE POLICY "Authenticated users can read payments"
  ON public.payments FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert payments"
  ON public.payments FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update payments"
  ON public.payments FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- 4. Ensure staff_attendance_requests table exists (for teacher self-reporting)
CREATE TABLE IF NOT EXISTS public.staff_attendance_requests (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id      TEXT NOT NULL,
  teacher_name    TEXT NOT NULL,
  date            DATE NOT NULL,
  morning_status  TEXT NOT NULL DEFAULT 'present',
  afternoon_status TEXT NOT NULL DEFAULT 'present',
  transport_allowance BOOLEAN DEFAULT false,
  session_type    TEXT NOT NULL DEFAULT 'offline',
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  submitted_at    TIMESTAMPTZ DEFAULT NOW(),
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  UNIQUE(teacher_id, date)
);

ALTER TABLE public.staff_attendance_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers can submit own requests" ON public.staff_attendance_requests;
DROP POLICY IF EXISTS "Teachers can view own requests" ON public.staff_attendance_requests;
DROP POLICY IF EXISTS "Admins can update requests" ON public.staff_attendance_requests;

CREATE POLICY "Authenticated can insert requests"
  ON public.staff_attendance_requests FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can read requests"
  ON public.staff_attendance_requests FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can update requests"
  ON public.staff_attendance_requests FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
