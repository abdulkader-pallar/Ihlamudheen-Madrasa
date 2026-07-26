-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Ihlamudheen Madrasa â€” Staff, Attendance & Payment Tables
-- Run this in Supabase SQL Editor
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- 1. TEACHERS table
CREATE TABLE IF NOT EXISTS public.teachers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  transport_allowance BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read teachers" ON public.teachers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage teachers" ON public.teachers FOR ALL TO authenticated
  USING ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin'));

-- 2. TEACHER_ASSIGNMENTS (which teacher teaches which class)
CREATE TABLE IF NOT EXISTS public.teacher_assignments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  UNIQUE(teacher_id, class_id)
);

ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read assignments" ON public.teacher_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage assignments" ON public.teacher_assignments FOR ALL TO authenticated
  USING ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin'));

-- 3. STAFF_ATTENDANCE (one row per teacher per date per session)
CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  session TEXT NOT NULL CHECK (session IN ('morning', 'afternoon', 'full')),
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late')),
  arrival_time TIME,
  session_type TEXT NOT NULL DEFAULT 'offline' CHECK (session_type IN ('online', 'offline')),
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(teacher_id, date, session)
);

CREATE INDEX idx_staff_attendance_date ON public.staff_attendance(date);
CREATE INDEX idx_staff_attendance_teacher ON public.staff_attendance(teacher_id);

ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read staff attendance" ON public.staff_attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin and accountant can manage staff attendance" ON public.staff_attendance FOR ALL TO authenticated
  USING ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'accountant'));

-- 4. PAYMENTS table
CREATE TABLE IF NOT EXISTS public.payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- "YYYY-MM"
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  transport_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  paid BOOLEAN DEFAULT false,
  paid_date DATE,
  ta_paid BOOLEAN DEFAULT false,
  ta_paid_date DATE,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(teacher_id, month)
);

-- Add TA columns if table already exists
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS ta_paid BOOLEAN DEFAULT false;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS ta_paid_date DATE;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin and accountant can read payments" ON public.payments FOR SELECT TO authenticated
  USING ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'accountant'));
CREATE POLICY "Admin and accountant can manage payments" ON public.payments FOR ALL TO authenticated
  USING ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'accountant'));


-- ══════════════════════════════════════════════════════════
-- SEED removed: real staff/teacher rows and class assignments from the
-- reference project are intentionally NOT included. Add your own staff
-- via the app (Setup / Add Staff) or your own INSERT statements.
-- ══════════════════════════════════════════════════════════
