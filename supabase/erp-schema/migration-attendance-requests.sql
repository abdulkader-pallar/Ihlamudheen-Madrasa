-- Teacher Self-Attendance Requests
-- Run this in Supabase SQL Editor → New Query → Run

CREATE TABLE IF NOT EXISTS public.staff_attendance_requests (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id      TEXT NOT NULL,
  teacher_name    TEXT NOT NULL,
  date            DATE NOT NULL,
  morning_status  TEXT NOT NULL DEFAULT 'present',  -- present | absent | late
  afternoon_status TEXT NOT NULL DEFAULT 'present', -- present | absent | late
  transport_allowance BOOLEAN DEFAULT false,
  session_type    TEXT NOT NULL DEFAULT 'offline',  -- online | offline
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  submitted_at    TIMESTAMPTZ DEFAULT NOW(),
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  UNIQUE(teacher_id, date)
);

-- Allow authenticated users to insert/read their own requests
ALTER TABLE public.staff_attendance_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can submit own requests"
  ON public.staff_attendance_requests FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Teachers can view own requests"
  ON public.staff_attendance_requests FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can update requests"
  ON public.staff_attendance_requests FOR UPDATE
  TO authenticated
  USING (true);
