-- >>> ERP SCHEMA v8 (dynamic-SQL fix) -- if line 1 is not v8, you have an OLD file, re-download <<<
-- ============================================================================
--  Ihlamudheen Madrasa - SCHOOL ERP schema (consolidated, collision-free)
--  Additive only; never touches accounting data. Re-runnable. Paste ALL -> Run.
-- ============================================================================
create or replace function public.erp_role()
returns text language sql stable as $do$
  select coalesce(auth.jwt() -> 'app_metadata'  ->> 'role',
                  auth.jwt() -> 'user_metadata' ->> 'role');
$do$;
create or replace function public.is_admin() returns boolean language sql stable as $do$
  select coalesce(public.erp_role() = 'admin', false); $do$;
create or replace function public.is_instructor() returns boolean language sql stable as $do$
  select coalesce(public.erp_role() = 'teacher', false); $do$;
create or replace function public.is_admin_or_accountant() returns boolean language sql stable as $do$
  select coalesce(public.erp_role() in ('admin','accountant'), false); $do$;
create or replace function public.is_teacher_or_admin() returns boolean language sql stable as $do$
  select coalesce(public.erp_role() in ('admin','teacher'), false); $do$;
create or replace function public.is_staff() returns boolean language sql stable as $do$
  select coalesce(public.erp_role() in ('admin','accountant','teacher'), false); $do$;

-- ==================== 00-base-app-tables.sql ====================
-- Base ERP app tables (classes, students, attendance, exams, exam_subjects,
-- exam_scores). DDL only - real seed rows intentionally excluded.
-- Apply this FIRST, before the other erp-schema files.

-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
-- Ihlamudheen Madrasa â€” App Data Tables
-- Run this in Supabase SQL Editor to create all data tables
-- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- 1. CLASSES table
CREATE TABLE IF NOT EXISTS public.classes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  name TEXT NOT NULL,
  schedule TEXT DEFAULT 'TBD',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated can read classes" ON public.classes;
CREATE POLICY "Anyone authenticated can read classes" ON public.classes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins and teachers can manage classes" ON public.classes;
CREATE POLICY "Admins and teachers can manage classes" ON public.classes FOR ALL TO authenticated
  USING (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  );

-- 2. STUDENTS table
CREATE TABLE IF NOT EXISTS public.students (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  roll_no TEXT NOT NULL,
  photo TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_students_class ON public.students(class_id);

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated can read students" ON public.students;
CREATE POLICY "Anyone authenticated can read students" ON public.students FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins and teachers can manage students" ON public.students;
CREATE POLICY "Admins and teachers can manage students" ON public.students FOR ALL TO authenticated
  USING (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  );

-- 3. ATTENDANCE table (one row per student per date)
CREATE TABLE IF NOT EXISTS public.student_attendance (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(class_id, student_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_class_date ON public.student_attendance(class_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON public.student_attendance(student_id);

ALTER TABLE public.student_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated can read attendance" ON public.student_attendance;
CREATE POLICY "Anyone authenticated can read attendance" ON public.student_attendance FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins and teachers can manage attendance" ON public.student_attendance;
CREATE POLICY "Admins and teachers can manage attendance" ON public.student_attendance FOR ALL TO authenticated
  USING (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  );

-- 4. EXAMS table (one row per exam)
CREATE TABLE IF NOT EXISTS public.exams (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  exam_name TEXT NOT NULL,
  date DATE NOT NULL,
  total_max_score NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exams_class ON public.exams(class_id);

ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated can read exams" ON public.exams;
CREATE POLICY "Anyone authenticated can read exams" ON public.exams FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins and teachers can manage exams" ON public.exams;
CREATE POLICY "Admins and teachers can manage exams" ON public.exams FOR ALL TO authenticated
  USING (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  );

-- 5. EXAM_SUBJECTS table (subjects per exam)
CREATE TABLE IF NOT EXISTS public.exam_subjects (
  id TEXT PRIMARY KEY,
  exam_id BIGINT NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  max_score NUMERIC NOT NULL DEFAULT 50
);

CREATE INDEX IF NOT EXISTS idx_exam_subjects_exam ON public.exam_subjects(exam_id);

ALTER TABLE public.exam_subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated can read exam subjects" ON public.exam_subjects;
CREATE POLICY "Anyone authenticated can read exam subjects" ON public.exam_subjects FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins and teachers can manage exam subjects" ON public.exam_subjects;
CREATE POLICY "Admins and teachers can manage exam subjects" ON public.exam_subjects FOR ALL TO authenticated
  USING (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  );

-- 6. EXAM_SCORES table (one row per student per subject per exam)
CREATE TABLE IF NOT EXISTS public.exam_scores (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exam_id BIGINT NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES public.exam_subjects(id) ON DELETE CASCADE,
  score NUMERIC NOT NULL DEFAULT 0,
  UNIQUE(exam_id, student_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_scores_exam ON public.exam_scores(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_scores_student ON public.exam_scores(student_id);

ALTER TABLE public.exam_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated can read exam scores" ON public.exam_scores;
CREATE POLICY "Anyone authenticated can read exam scores" ON public.exam_scores FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins and teachers can manage exam scores" ON public.exam_scores;
CREATE POLICY "Admins and teachers can manage exam scores" ON public.exam_scores FOR ALL TO authenticated
  USING (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  );


-- ==================== migration-staff-payments.sql ====================
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
DROP POLICY IF EXISTS "Anyone authenticated can read teachers" ON public.teachers;
CREATE POLICY "Anyone authenticated can read teachers" ON public.teachers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins can manage teachers" ON public.teachers;
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
DROP POLICY IF EXISTS "Anyone authenticated can read assignments" ON public.teacher_assignments;
CREATE POLICY "Anyone authenticated can read assignments" ON public.teacher_assignments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins can manage assignments" ON public.teacher_assignments;
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

CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON public.staff_attendance(date);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_teacher ON public.staff_attendance(teacher_id);

ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated can read staff attendance" ON public.staff_attendance;
CREATE POLICY "Anyone authenticated can read staff attendance" ON public.staff_attendance FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin and accountant can manage staff attendance" ON public.staff_attendance;
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
DROP POLICY IF EXISTS "Admin and accountant can read payments" ON public.payments;
CREATE POLICY "Admin and accountant can read payments" ON public.payments FOR SELECT TO authenticated
  USING ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'accountant'));
DROP POLICY IF EXISTS "Admin and accountant can manage payments" ON public.payments;
CREATE POLICY "Admin and accountant can manage payments" ON public.payments FOR ALL TO authenticated
  USING ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'accountant'));


-- ══════════════════════════════════════════════════════════
-- SEED removed: real staff/teacher rows and class assignments from the
-- reference project are intentionally NOT included. Add your own staff
-- via the app (Setup / Add Staff) or your own INSERT statements.
-- ══════════════════════════════════════════════════════════


-- ==================== migration-assessments.sql ====================
-- Assessments — link-based quizzes / tests / assignments (no file uploads)
-- Run in Supabase SQL Editor → New Query → Run

CREATE TABLE IF NOT EXISTS public.assessments (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id     TEXT NOT NULL,
  teacher_id   TEXT NOT NULL,
  teacher_name TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  link_url     TEXT NOT NULL,
  due_date     DATE,
  max_marks    INTEGER,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessments_class
  ON public.assessments(class_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assessments_teacher
  ON public.assessments(teacher_id);

ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;

-- Public (anon) + authenticated read so students can see assessments
DROP POLICY IF EXISTS "Anyone can read assessments" ON public.assessments;
CREATE POLICY "Anyone can read assessments" ON public.assessments FOR SELECT
  TO anon, authenticated
  USING (true);

-- Authenticated (teachers/admins) can create/update/delete.
-- Ownership enforced in application layer.
DROP POLICY IF EXISTS "Authenticated users can insert assessments" ON public.assessments;
CREATE POLICY "Authenticated users can insert assessments" ON public.assessments FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update assessments" ON public.assessments;
CREATE POLICY "Authenticated users can update assessments" ON public.assessments FOR UPDATE
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can delete assessments" ON public.assessments;
CREATE POLICY "Authenticated users can delete assessments" ON public.assessments FOR DELETE
  TO authenticated
  USING (true);


-- ==================== migration-attendance-requests.sql ====================
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

DROP POLICY IF EXISTS "Teachers can submit own requests" ON public.staff_attendance_requests;
CREATE POLICY "Teachers can submit own requests" ON public.staff_attendance_requests FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Teachers can view own requests" ON public.staff_attendance_requests;
CREATE POLICY "Teachers can view own requests" ON public.staff_attendance_requests FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can update requests" ON public.staff_attendance_requests;
CREATE POLICY "Admins can update requests" ON public.staff_attendance_requests FOR UPDATE
  TO authenticated
  USING (true);


-- ==================== migration-lms-notes.sql ====================
-- LMS Notes — link-based class notes (Google Drive, YouTube, Docs, etc.)
-- Run this in Supabase SQL Editor → New Query → Run

CREATE TABLE IF NOT EXISTS public.lms_notes (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id     TEXT NOT NULL,
  teacher_id   TEXT NOT NULL,
  teacher_name TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  link_url     TEXT NOT NULL,
  link_type    TEXT NOT NULL DEFAULT 'other',   -- drive | youtube | doc | other
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lms_notes_class
  ON public.lms_notes(class_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lms_notes_teacher
  ON public.lms_notes(teacher_id);

ALTER TABLE public.lms_notes ENABLE ROW LEVEL SECURITY;

-- Students (anonymous) and teachers can read all notes
DROP POLICY IF EXISTS "Anyone can read lms notes" ON public.lms_notes;
CREATE POLICY "Anyone can read lms notes" ON public.lms_notes FOR SELECT
  TO anon, authenticated
  USING (true);

-- Authenticated users (teachers, admins) can add notes
DROP POLICY IF EXISTS "Authenticated users can insert notes" ON public.lms_notes;
CREATE POLICY "Authenticated users can insert notes" ON public.lms_notes FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users can delete notes (ownership enforced in app layer)
DROP POLICY IF EXISTS "Authenticated users can delete notes" ON public.lms_notes;
CREATE POLICY "Authenticated users can delete notes" ON public.lms_notes FOR DELETE
  TO authenticated
  USING (true);

-- Authenticated users can update notes (ownership enforced in app layer)
DROP POLICY IF EXISTS "Authenticated users can update notes" ON public.lms_notes;
CREATE POLICY "Authenticated users can update notes" ON public.lms_notes FOR UPDATE
  TO authenticated
  USING (true);


-- ==================== migration-monthly-salaries.sql ====================
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

DROP POLICY IF EXISTS "Admin/accountant read salaries" ON public.monthly_salaries;
CREATE POLICY "Admin/accountant read salaries" ON public.monthly_salaries FOR SELECT TO authenticated
  USING ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'accountant'));

DROP POLICY IF EXISTS "Admin/accountant write salaries" ON public.monthly_salaries;
CREATE POLICY "Admin/accountant write salaries" ON public.monthly_salaries FOR ALL TO authenticated
  USING ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'accountant'))
  WITH CHECK ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'accountant'));

-- ── Enable realtime ──────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.monthly_salaries;


-- ==================== migration-storage-photos.sql ====================
-- ============================================================
-- Supabase Storage: Student Photos (Private Bucket with RLS)
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Create private storage bucket for student photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'student-photos',
  'student-photos',
  false,  -- PRIVATE bucket (requires signed URLs)
  524288, -- 512KB max file size
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 524288,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- 2. RLS Policies for student-photos bucket
-- Only authenticated users can upload/read/delete

-- Allow authenticated users to upload photos
DROP POLICY IF EXISTS "Authenticated users can upload student photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload student photos" ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'student-photos');

-- Allow authenticated users to read photos (via signed URLs)
DROP POLICY IF EXISTS "Authenticated users can read student photos" ON storage.objects;
CREATE POLICY "Authenticated users can read student photos" ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'student-photos');

-- Allow authenticated users to update (overwrite) photos
DROP POLICY IF EXISTS "Authenticated users can update student photos" ON storage.objects;
CREATE POLICY "Authenticated users can update student photos" ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'student-photos')
WITH CHECK (bucket_id = 'student-photos');

-- Only admins and instructors can delete photos
DROP POLICY IF EXISTS "Admin/instructor can delete student photos" ON storage.objects;
CREATE POLICY "Admin/instructor can delete student photos" ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'student-photos'
  AND (public.is_admin() OR public.is_instructor())
);

-- ============================================================
-- Auth Settings (configure in Supabase Dashboard)
-- ============================================================
-- Go to Authentication > Settings and configure:
--
-- 1. PASSWORD STRENGTH:
--    - Minimum password length: 8
--    - Require uppercase, lowercase, numbers
--
-- 2. EMAIL VERIFICATION:
--    - Enable "Confirm email" toggle
--    - Customize email template with Ihlamudheen branding
--
-- 3. RATE LIMITING:
--    - Max sign-up attempts: 5 per hour
--    - Max sign-in attempts: 10 per hour
--
-- 4. GOOGLE OAUTH:
--    - Enable Google provider
--    - Add Google Client ID and Secret
--    - Set redirect URL
--
-- IMPORTANT: Never expose service_role key in frontend code!
-- Only use NEXT_PUBLIC_SUPABASE_ANON_KEY in the browser.
-- ============================================================


-- ==================== migration-student-profile-fields.sql ====================
-- ══════════════════════════════════════════════════════════════════
-- Ihlamudheen — Add student profile columns (gender + parents + contacts)
-- Run once in Supabase SQL Editor. Safe to re-run (uses IF NOT EXISTS).
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS gender         TEXT;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS father_name    TEXT;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS mother_name    TEXT;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS father_phone   TEXT;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS mother_phone   TEXT;

-- Optional: a CHECK constraint on gender (skip if you want free-form)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_gender_check'
  ) THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_gender_check
      CHECK (gender IS NULL OR gender IN ('Male', 'Female'));
  END IF;
END $$;

-- Verify:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'students'
ORDER BY ordinal_position;


-- ==================== migration-add-profile-fields.sql ====================
-- Migration: Add phone and bio columns to users table
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard > SQL Editor)

-- 1. Add missing columns
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio text;

-- 2. Add INSERT policy so upsert works for users saving their own profile
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'Users: insert own row'
  ) THEN
    DROP POLICY IF EXISTS "Users: insert own row" ON public.profiles;
    CREATE POLICY "Users: insert own row" ON public.profiles FOR INSERT
      WITH CHECK (auth.uid() = id);
  END IF;
END
$$;

-- 3. Create avatars storage bucket (if it doesn't exist)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 4. Storage policies for avatars bucket
DO $$
BEGIN
  -- Allow authenticated users to upload their own avatar
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND policyname = 'Avatar upload'
  ) THEN
    DROP POLICY IF EXISTS "Avatar upload" ON storage.objects;
    CREATE POLICY "Avatar upload" ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'avatars'
        AND auth.uid()::text = (storage.foldername(name))[1]
      );
  END IF;

  -- Allow authenticated users to update their own avatar
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND policyname = 'Avatar update'
  ) THEN
    DROP POLICY IF EXISTS "Avatar update" ON storage.objects;
    CREATE POLICY "Avatar update" ON storage.objects FOR UPDATE
      USING (
        bucket_id = 'avatars'
        AND auth.uid()::text = (storage.foldername(name))[1]
      );
  END IF;

  -- Allow anyone to read avatars (public bucket)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND policyname = 'Avatar public read'
  ) THEN
    DROP POLICY IF EXISTS "Avatar public read" ON storage.objects;
    CREATE POLICY "Avatar public read" ON storage.objects FOR SELECT
      USING (bucket_id = 'avatars');
  END IF;
END
$$;


-- ==================== migration-fix-staff-attendance-rls.sql ====================
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
DROP POLICY IF EXISTS "Authenticated users can read staff attendance" ON public.staff_attendance;
CREATE POLICY "Authenticated users can read staff attendance" ON public.staff_attendance FOR SELECT
  TO authenticated
  USING (true);

-- Allow all authenticated users to insert/update (admin check is done in app layer)
DROP POLICY IF EXISTS "Authenticated users can upsert staff attendance" ON public.staff_attendance;
CREATE POLICY "Authenticated users can upsert staff attendance" ON public.staff_attendance FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update staff attendance" ON public.staff_attendance;
CREATE POLICY "Authenticated users can update staff attendance" ON public.staff_attendance FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 3. Fix payments table RLS (old role-based policies can silently block updates)
DROP POLICY IF EXISTS "Admin and accountant can read payments" ON public.payments;
DROP POLICY IF EXISTS "Admin and accountant can manage payments" ON public.payments;

DROP POLICY IF EXISTS "Authenticated users can read payments" ON public.payments;
CREATE POLICY "Authenticated users can read payments" ON public.payments FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert payments" ON public.payments;
CREATE POLICY "Authenticated users can insert payments" ON public.payments FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update payments" ON public.payments;
CREATE POLICY "Authenticated users can update payments" ON public.payments FOR UPDATE
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

DROP POLICY IF EXISTS "Authenticated can insert requests" ON public.staff_attendance_requests;
CREATE POLICY "Authenticated can insert requests" ON public.staff_attendance_requests FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can read requests" ON public.staff_attendance_requests;
CREATE POLICY "Authenticated can read requests" ON public.staff_attendance_requests FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can update requests" ON public.staff_attendance_requests;
CREATE POLICY "Authenticated can update requests" ON public.staff_attendance_requests FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);


-- ==================== migration-marked-by.sql ====================
-- ══════════════════════════════════════════════════════════
-- Ihlamudheen Madrasa — Migration: marked_by + TA columns
-- Run this in Supabase SQL Editor AFTER migration-staff-payments.sql
-- ══════════════════════════════════════════════════════════

-- 1. Add marked_by column to attendance table
--    Tracks which teacher/admin last marked each attendance record.
ALTER TABLE public.student_attendance ADD COLUMN IF NOT EXISTS marked_by TEXT;

-- Index for fast lookups when displaying "last marked by" on class cards
CREATE INDEX IF NOT EXISTS idx_attendance_marked_by ON public.student_attendance(class_id, date);

-- 2. Add missing transport_allowance and ta_remarks columns to staff_attendance
--    (These were used in code but missing from the original migration SQL)
ALTER TABLE public.staff_attendance ADD COLUMN IF NOT EXISTS transport_allowance BOOLEAN DEFAULT false;
ALTER TABLE public.staff_attendance ADD COLUMN IF NOT EXISTS ta_remarks TEXT;

-- 3. RLS: allow authenticated users to read marked_by
--    (already covered by existing attendance RLS policies — no extra policy needed)


-- ==================== migrations/20260516000000_student_self_reports.sql ====================
-- ============================================================
-- Student Self-Report table
-- Students submit their own daily activity records via /student portal.
-- No Supabase Auth needed — students identified by class_id + roll_no.
-- Teachers read all rows via the dashboard (service role / anon key).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.student_self_reports (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id    TEXT        NOT NULL,
  roll_no     TEXT        NOT NULL,
  week_key    DATE        NOT NULL,   -- Saturday that starts the Ihlamudheen week
  day_key     TEXT        NOT NULL CHECK (day_key IN ('sat','sun','mon','tue','wed','thu','fri')),
  fajr        BOOLEAN     NOT NULL DEFAULT false,
  dhuhr       BOOLEAN     NOT NULL DEFAULT false,
  asr         BOOLEAN     NOT NULL DEFAULT false,
  maghrib     BOOLEAN     NOT NULL DEFAULT false,
  isha        BOOLEAN     NOT NULL DEFAULT false,
  quran       BOOLEAN     NOT NULL DEFAULT false,
  reading     BOOLEAN     NOT NULL DEFAULT false,
  writing     BOOLEAN     NOT NULL DEFAULT false,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, roll_no, week_key, day_key)
);

-- Index for teacher dashboard queries (fetch all reports for a class/week)
CREATE INDEX IF NOT EXISTS idx_ssr_class_week
  ON public.student_self_reports (class_id, week_key);

-- Index for student portal queries (fetch one student's records)
CREATE INDEX IF NOT EXISTS idx_ssr_roll
  ON public.student_self_reports (class_id, roll_no);

-- ── Row Level Security ────────────────────────────────────
-- Data is non-sensitive (prayer/activity tracking, not grades).
-- Public read/write is intentional — students access without Supabase Auth.
ALTER TABLE public.student_self_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_self_reports_public" ON public.student_self_reports;
DROP POLICY IF EXISTS "student_self_reports_public" ON public.student_self_reports;
CREATE POLICY "student_self_reports_public" ON public.student_self_reports
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_ssr_updated_at ON public.student_self_reports;
CREATE TRIGGER trg_ssr_updated_at
  BEFORE UPDATE ON public.student_self_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ==================== migrations/20260517000000_tighten_ssr_rls.sql ====================
-- ============================================================
-- Tighten RLS on student_self_reports
-- Previous policy allowed anonymous DELETE of any row.
-- New policies: anon can INSERT and UPDATE (needed for the
-- student portal upsert), but NOT delete.  SELECT is open
-- so the teacher dashboard can fetch class reports via the
-- anon key.  DELETE is restricted to service_role only.
-- ============================================================

-- Drop the overly-permissive blanket policy
DROP POLICY IF EXISTS "student_self_reports_public" ON public.student_self_reports;

-- 1. Anon can read all rows (teacher dashboard fetches via anon key)
DROP POLICY IF EXISTS "ssr_anon_select" ON public.student_self_reports;
CREATE POLICY "ssr_anon_select" ON public.student_self_reports
  FOR SELECT TO anon
  USING (true);

-- 2. Anon can insert new rows (student portal upsert)
DROP POLICY IF EXISTS "ssr_anon_insert" ON public.student_self_reports;
CREATE POLICY "ssr_anon_insert" ON public.student_self_reports
  FOR INSERT TO anon
  WITH CHECK (true);

-- 3. Anon can update existing rows (student portal upsert on conflict)
DROP POLICY IF EXISTS "ssr_anon_update" ON public.student_self_reports;
CREATE POLICY "ssr_anon_update" ON public.student_self_reports
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- 4. Only service_role can delete (admin cleanup via server-side client)
DROP POLICY IF EXISTS "ssr_service_delete" ON public.student_self_reports;
CREATE POLICY "ssr_service_delete" ON public.student_self_reports
  FOR DELETE TO service_role
  USING (true);

-- 5. Service role has full access (for server-side operations)
DROP POLICY IF EXISTS "ssr_service_all" ON public.student_self_reports;
CREATE POLICY "ssr_service_all" ON public.student_self_reports
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- ==================== migrations/20260517100000_teacher_marks.sql ====================
-- ============================================================
-- Teacher activity marks table
-- Teachers mark student daily activities via the dashboard.
-- Previously stored only in localStorage — now persisted to DB
-- so marks survive browser clears and sync across devices.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.teacher_marks (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id    TEXT        NOT NULL,
  week_key    DATE        NOT NULL,
  day_key     TEXT        NOT NULL CHECK (day_key IN ('sat','sun','mon','tue','wed','thu','fri')),
  student_id  TEXT        NOT NULL,
  fajr        BOOLEAN     NOT NULL DEFAULT false,
  dhuhr       BOOLEAN     NOT NULL DEFAULT false,
  asr         BOOLEAN     NOT NULL DEFAULT false,
  maghrib     BOOLEAN     NOT NULL DEFAULT false,
  isha        BOOLEAN     NOT NULL DEFAULT false,
  quran       BOOLEAN     NOT NULL DEFAULT false,
  reading     BOOLEAN     NOT NULL DEFAULT false,
  writing     BOOLEAN     NOT NULL DEFAULT false,
  custom      JSONB       NOT NULL DEFAULT '{}',
  marked_by   UUID        REFERENCES auth.users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, week_key, day_key, student_id)
);

-- Index for dashboard loads (one class + one week at a time)
CREATE INDEX IF NOT EXISTS idx_tm_class_week
  ON public.teacher_marks (class_id, week_key);

-- ── Row Level Security ────────────────────────────────────
ALTER TABLE public.teacher_marks ENABLE ROW LEVEL SECURITY;

-- Authenticated users with teacher/admin role can read all marks
DROP POLICY IF EXISTS "tm_auth_select" ON public.teacher_marks;
CREATE POLICY "tm_auth_select" ON public.teacher_marks
  FOR SELECT TO authenticated
  USING (true);

-- Authenticated users can insert/update (app-level role check via canEdit)
DROP POLICY IF EXISTS "tm_auth_insert" ON public.teacher_marks;
CREATE POLICY "tm_auth_insert" ON public.teacher_marks
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "tm_auth_update" ON public.teacher_marks;
CREATE POLICY "tm_auth_update" ON public.teacher_marks
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- Only service_role can delete
DROP POLICY IF EXISTS "tm_service_delete" ON public.teacher_marks;
CREATE POLICY "tm_service_delete" ON public.teacher_marks
  FOR DELETE TO service_role
  USING (true);

-- ============================================================
-- Custom activities per class (shared across all teachers)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.teacher_custom_activities (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id    TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  created_by  UUID        REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, name)
);

ALTER TABLE public.teacher_custom_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tca_auth_select" ON public.teacher_custom_activities;
CREATE POLICY "tca_auth_select" ON public.teacher_custom_activities
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "tca_auth_insert" ON public.teacher_custom_activities;
CREATE POLICY "tca_auth_insert" ON public.teacher_custom_activities
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "tca_auth_delete" ON public.teacher_custom_activities;
CREATE POLICY "tca_auth_delete" ON public.teacher_custom_activities
  FOR DELETE TO authenticated
  USING (true);

-- Auto-update updated_at on teacher_marks
CREATE TRIGGER trg_tm_updated_at
  BEFORE UPDATE ON public.teacher_marks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ==================== migrations/20260517200000_custom_activities.sql ====================
-- ============================================================
-- Custom Activities per Class
-- Teachers define extra activities (e.g. "Homework", "Hadith")
-- per class through the dashboard. Students see and self-report
-- them in their portal.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.class_custom_activities (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id      TEXT        NOT NULL,
  activity_name TEXT        NOT NULL,
  position      INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, activity_name)
);

-- Fast lookup when teacher or student loads a class
CREATE INDEX IF NOT EXISTS idx_cca_class
  ON public.class_custom_activities (class_id, position);

-- Row Level Security — same open policy as student_self_reports:
-- teachers write, students read, both use the anon key.
ALTER TABLE public.class_custom_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cca_public" ON public.class_custom_activities;
DROP POLICY IF EXISTS "cca_public" ON public.class_custom_activities;
CREATE POLICY "cca_public" ON public.class_custom_activities
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Add custom_data column to student_self_reports
-- Stores student responses for custom activities as JSON:
--   { "Homework": true, "Hadith": false }
-- ============================================================

ALTER TABLE public.student_self_reports
  ADD COLUMN IF NOT EXISTS custom_data JSONB NOT NULL DEFAULT '{}';


-- ==================== migrations/20260517210000_class_activity_config.sql ====================
-- ============================================================
-- Class Activity Config
-- Stores which default activities a teacher has hidden for
-- a specific class (e.g. hide Prayers for younger grades).
-- hidden_defaults values: 'prayers' | 'quran' | 'reading' | 'writing'
-- ============================================================

CREATE TABLE IF NOT EXISTS public.class_activity_config (
  class_id        TEXT        PRIMARY KEY,
  hidden_defaults TEXT[]      NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.class_activity_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cac_public" ON public.class_activity_config;
DROP POLICY IF EXISTS "cac_public" ON public.class_activity_config;
CREATE POLICY "cac_public" ON public.class_activity_config
  FOR ALL
  USING (true)
  WITH CHECK (true);


-- ==================== migrations/20260517220000_submitted_at_nullable.sql ====================
-- Make submitted_at nullable so auto-saves don't appear as explicit submissions.
-- A NULL means the student has only auto-saved; non-NULL means explicitly submitted.
ALTER TABLE public.student_self_reports
  ALTER COLUMN submitted_at DROP NOT NULL,
  ALTER COLUMN submitted_at DROP DEFAULT,
  ALTER COLUMN submitted_at SET DEFAULT NULL;

-- Reset existing rows so legacy auto-saved rows don't incorrectly show as submitted.
-- Teachers see real submission state after students re-open the portal this week.
UPDATE public.student_self_reports SET submitted_at = NULL WHERE submitted_at IS NOT NULL;


-- ==================== migrations/20260517300000_rename_edu_support_classes.sql ====================
-- Rename Ihlamudheen Madrasa EDU SUPPORT classes from "Grade: ES G<n>" → "Grade <n>"
-- so the fee tier regex (grade\s*[12], grade\s*[34], grade\s*[56]) can match correctly.
-- Fees: Grade 1 & 2 = AED 300 | Grade 3 & 4 = AED 350 | Grade 5 & 6 = AED 400

UPDATE public.classes
SET name = 'Grade ' || (regexp_match(name, '(?i)g(\d+)\s*$'))[1]
WHERE course_id = '4'
  AND name ~* 'g\d+\s*$';


-- ==================== migrations/20260517400000_fee_payments.sql ====================
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

CREATE INDEX IF NOT EXISTS idx_fee_payments_month ON public.fee_payments(month);
CREATE INDEX IF NOT EXISTS idx_fee_payments_student ON public.fee_payments(student_id);

ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth users read fee_payments" ON public.fee_payments;
CREATE POLICY "auth users read fee_payments" ON public.fee_payments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admins manage fee_payments" ON public.fee_payments;
CREATE POLICY "admins manage fee_payments" ON public.fee_payments FOR ALL TO authenticated
  USING ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher'));


-- ==================== migrations/20260518000000_student_avatars_bucket.sql ====================
-- Create public storage bucket for student avatar photos.
-- Images are uploaded by students via the portal (compressed to <50 KB)
-- and read publicly so the teacher dashboard can display them.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'student-avatars',
  'student-avatars',
  true,
  51200,            -- 50 KB hard limit
  ARRAY['image/jpeg','image/jpg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public            = true,
      file_size_limit   = 51200,
      allowed_mime_types= ARRAY['image/jpeg','image/jpg','image/png','image/webp'];

-- Anon can upload (students are unauthenticated)
DROP POLICY IF EXISTS "avatar_anon_upload" ON storage.objects;
CREATE POLICY "avatar_anon_upload" ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'student-avatars');

-- Anon can update/replace their own avatar
DROP POLICY IF EXISTS "avatar_anon_update" ON storage.objects;
CREATE POLICY "avatar_anon_update" ON storage.objects FOR UPDATE TO anon
  USING (bucket_id = 'student-avatars');

-- Anyone can read (teachers see via public URL)
DROP POLICY IF EXISTS "avatar_public_read" ON storage.objects;
CREATE POLICY "avatar_public_read" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'student-avatars');


-- ==================== migrations/20260518100000_ssr_missing_columns.sql ====================
-- Add custom_data column if not already present
-- This stores student responses for teacher-defined custom activities
ALTER TABLE public.student_self_reports
  ADD COLUMN IF NOT EXISTS custom_data JSONB NOT NULL DEFAULT '{}';

-- Make submitted_at nullable (NULL = auto-saved, non-NULL = explicitly submitted by student)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='student_self_reports'
      AND column_name='submitted_at'
      AND is_nullable='NO'
  ) THEN
    ALTER TABLE public.student_self_reports
      ALTER COLUMN submitted_at DROP NOT NULL,
      ALTER COLUMN submitted_at SET DEFAULT NULL;
    -- Reset old auto-populated submitted_at values so only real submits count
    UPDATE public.student_self_reports SET submitted_at = NULL;
  END IF;
END $$;


-- ==================== migrations/20260518200000_ssr_authenticated_select.sql ====================
-- ============================================================
-- Grant authenticated role access to student_self_reports.
--
-- The previous tightening migration (20260517000000) scoped all
-- SSR policies TO anon only.  Teachers sign in via Supabase Auth
-- (src/app/login/page.tsx) and operate as `authenticated`, so the
-- dashboard's SELECT silently returned zero rows — student
-- submissions were invisible.
--
-- This also fixes a shared-browser case where a stored teacher
-- session caused the /student portal's writes to fail RLS, making
-- submissions appear to vanish after a refresh.
-- ============================================================

DROP POLICY IF EXISTS "ssr_auth_select" ON public.student_self_reports;
CREATE POLICY "ssr_auth_select" ON public.student_self_reports
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "ssr_auth_insert" ON public.student_self_reports;
CREATE POLICY "ssr_auth_insert" ON public.student_self_reports
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "ssr_auth_update" ON public.student_self_reports;
CREATE POLICY "ssr_auth_update" ON public.student_self_reports
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);


-- ==================== migrations/20260519000000_staff_members.sql ====================
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
DROP POLICY IF EXISTS "staff_members_auth_select" ON public.staff_members;
CREATE POLICY "staff_members_auth_select" ON public.staff_members
  FOR SELECT TO authenticated
  USING (true);

-- Only service_role (server-side API) can insert / update / delete
DROP POLICY IF EXISTS "staff_members_service_write" ON public.staff_members;
CREATE POLICY "staff_members_service_write" ON public.staff_members
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- ==================== migrations/20260521000000_add_edu_makeup_session.sql ====================
-- Allow session="edu-makeup" on staff_attendance.
--
-- EDU Support teachers (payType=monthly-edu-support) are paid 1,500 AED/month for
-- 112 billable hours (13.3929 AED/hr). If they fall short during the Mon–Fri work
-- week, they may come in on Saturday or Sunday to make up the missing hours.
-- Those weekend punches are recorded with session="edu-makeup" so that
-- detectProgram() in src/lib/payroll.ts classifies them as edu-support (not madrasa)
-- and the hours are counted toward the monthly 112-hour target.
--
-- See: src/lib/punch-routing.ts (kind: "edu-makeup-arrival" / "edu-makeup-departure")
--      src/app/api/zk-attendance/route.ts (handlers for those action kinds)

ALTER TABLE staff_attendance
  DROP CONSTRAINT staff_attendance_session_check;

ALTER TABLE staff_attendance
  ADD CONSTRAINT staff_attendance_session_check
  CHECK (session = ANY (ARRAY[
    'morning'::text,
    'afternoon'::text,
    'evening'::text,
    'cibis'::text,
    'full'::text,
    'edu-makeup'::text
  ]));


-- ==================== migrations/20260525120000_fix_exam_rls_and_constraints.sql ====================
-- ============================================================
-- Fix: exam_scores RLS, score constraint, app_settings table
-- ============================================================

-- 1. Drop the permissive read-all policy on exam_scores
DROP POLICY IF EXISTS "Anyone authenticated can read exam scores" ON public.exam_scores;

-- 2. Student-scoped read policy:
--    • admin / teacher can read everything
--    • a student can only read their own scores
DROP POLICY IF EXISTS "exam_scores_select" ON public.exam_scores;
CREATE POLICY "exam_scores_select" ON public.exam_scores
  FOR SELECT TO authenticated
  USING (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
    OR student_id = (auth.jwt() -> 'user_metadata' ->> 'student_id')
    OR student_id = auth.uid()::text
  );

-- 3. Ensure scores cannot be negative
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_score_non_negative') THEN ALTER TABLE public.exam_scores ADD CONSTRAINT chk_score_non_negative CHECK (score >= 0); END IF; END $do$;

-- ============================================================
-- App-wide settings table (key/value)
-- Used for: report_card_enabled, etc.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read settings
DROP POLICY IF EXISTS "settings_select" ON public.app_settings;
CREATE POLICY "settings_select" ON public.app_settings
  FOR SELECT TO authenticated
  USING (true);

-- Only admins can write settings
DROP POLICY IF EXISTS "settings_admin_write" ON public.app_settings;
CREATE POLICY "settings_admin_write" ON public.app_settings
  FOR ALL TO authenticated
  USING   ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin')
  WITH CHECK ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin');

-- Seed defaults (idempotent)
INSERT INTO public.app_settings (key, value)
VALUES ('report_card_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_app_settings()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_app_settings();


-- ==================== migrations/20260525200000_unlocked_academic_years.sql ====================
-- ============================================================
-- Seed: unlocked_academic_years setting
-- Controls which academic years are open for data entry.
-- Future years are locked until an admin promotes students.
-- ============================================================

INSERT INTO public.app_settings (key, value)
VALUES ('unlocked_academic_years', '["2025-2026","2026-2027"]')
ON CONFLICT (key) DO NOTHING;


-- ==================== migrations/20260525210000_fee_payments_ledger.sql ====================
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

DROP POLICY IF EXISTS "auth read fee_payment_audit" ON public.fee_payment_audit;
CREATE POLICY "auth read fee_payment_audit" ON public.fee_payment_audit FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin insert fee_payment_audit" ON public.fee_payment_audit;
CREATE POLICY "admin insert fee_payment_audit" ON public.fee_payment_audit FOR INSERT TO authenticated
  WITH CHECK ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'accountant'));

-- 9. Tighten fee_payments policy: writes restricted to admin/accountant,
--    and rows can never be UPDATE'd or DELETE'd from the client. Corrections
--    must go through new ledger INSERTs (reversal entries).
DROP POLICY IF EXISTS "admins manage fee_payments"     ON public.fee_payments;
DROP POLICY IF EXISTS "auth users read fee_payments"   ON public.fee_payments;
DROP POLICY IF EXISTS "auth read fee_payments"         ON public.fee_payments;
DROP POLICY IF EXISTS "admin insert fee_payments"      ON public.fee_payments;

DROP POLICY IF EXISTS "auth read fee_payments" ON public.fee_payments;
CREATE POLICY "auth read fee_payments" ON public.fee_payments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admin insert fee_payments" ON public.fee_payments;
CREATE POLICY "admin insert fee_payments" ON public.fee_payments FOR INSERT TO authenticated
  WITH CHECK ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'accountant'));

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


-- ==================== migrations/20260601000000_fix_exam_scores_write_policy.sql ====================
-- Fix exam_scores write policy to work regardless of whether
-- the profiles table exists or is populated.
-- The security-part-b migration replaced the JWT-based policy
-- with a profiles-table lookup. If profiles is empty or missing,
-- all writes are silently blocked. This migration restores a
-- dual-check policy: JWT metadata (always available) OR profiles row.

DROP POLICY IF EXISTS "Admins and teachers can manage exam scores" ON public.exam_scores;
DROP POLICY IF EXISTS "exam_scores: staff manage"                  ON public.exam_scores;
DROP POLICY IF EXISTS "exam_scores: staff write"                   ON public.exam_scores;

DROP POLICY IF EXISTS "exam_scores: staff write" ON public.exam_scores;
CREATE POLICY "exam_scores: staff write" ON public.exam_scores
  FOR ALL TO authenticated
  USING (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  )
  WITH CHECK (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  );

-- Same fix for exam_subjects (same pattern, same potential issue)
DROP POLICY IF EXISTS "Admins and teachers can manage exam subjects" ON public.exam_subjects;
DROP POLICY IF EXISTS "exam_subjects: staff manage"                  ON public.exam_subjects;
DROP POLICY IF EXISTS "exam_subjects: staff write"                   ON public.exam_subjects;

DROP POLICY IF EXISTS "exam_subjects: staff write" ON public.exam_subjects;
CREATE POLICY "exam_subjects: staff write" ON public.exam_subjects
  FOR ALL TO authenticated
  USING (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  )
  WITH CHECK (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  );

-- Same fix for exams table
DROP POLICY IF EXISTS "Admins and teachers can manage exams" ON public.exams;
DROP POLICY IF EXISTS "exams: staff manage"                  ON public.exams;
DROP POLICY IF EXISTS "exams: staff write"                   ON public.exams;

DROP POLICY IF EXISTS "exams: staff write" ON public.exams;
CREATE POLICY "exams: staff write" ON public.exams
  FOR ALL TO authenticated
  USING (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  )
  WITH CHECK (
    (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) IN ('admin', 'teacher')
  );


-- ==================== migrations/20260601010000_exam_scores_unique_constraint.sql ====================
-- Add the missing UNIQUE constraint on exam_scores so that
-- upsert with onConflict:"exam_id,student_id,subject_id" works.
-- Removes any duplicate rows first (keep the row with the highest id).

DELETE FROM public.exam_scores a
USING public.exam_scores b
WHERE a.id < b.id
  AND a.exam_id    = b.exam_id
  AND a.student_id = b.student_id
  AND a.subject_id = b.subject_id;

ALTER TABLE public.exam_scores
  DROP CONSTRAINT IF EXISTS exam_scores_unique_combo;

ALTER TABLE public.exam_scores
  ADD CONSTRAINT exam_scores_unique_combo
  UNIQUE (exam_id, student_id, subject_id);


-- ==================== migrations/20260603120000_security_rls_app_metadata.sql ====================
-- ══════════════════════════════════════════════════════════════════════════
-- SECURITY: move all role-based RLS off user-writable `user_metadata`.
--
-- PROBLEM (audit C3): every financial/grade policy keyed on
--   (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role'))
-- but `user_metadata` is writable by the user via
--   supabase.auth.updateUser({ data: { role: 'admin' } })
-- so any authenticated user could self-escalate and read/write payroll, fees,
-- exam scores, and settings. `app_metadata` is NOT user-writable (only the
-- service role / admin API can set it) and is the correct source of truth.
--
-- This migration:
--   1. Backfills app_metadata.role from user_metadata.role for existing users.
--   2. Adds a helper public.app_role() reading the non-writable claim.
--   3. Recreates every role-gated policy to use app_metadata.
--
-- ⚠️  OPERATIONAL NOTE: app_metadata changes only appear in a user's JWT after
--     their token refreshes. After applying, existing sessions should sign out
--     and back in (or wait for the ~1h token refresh) so their new claim is
--     present. Verify afterwards with:  SELECT * FROM pg_policies;
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Backfill app_metadata.role from the (previously trusted) user_metadata ─
UPDATE auth.users
SET raw_app_meta_data =
      coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', raw_user_meta_data ->> 'role')
WHERE raw_user_meta_data ->> 'role' IN ('admin', 'accountant', 'teacher', 'student')
  AND coalesce(raw_app_meta_data ->> 'role', '') = '';

-- ── 2. Helper: read the authoritative role claim (app_metadata, not writable) ─
CREATE OR REPLACE FUNCTION public.app_role()
RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT auth.jwt() -> 'app_metadata' ->> 'role' $$;

-- ── 3. monthly_salaries — admin/accountant only ──────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.monthly_salaries') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Admin/accountant read salaries"  ON public.monthly_salaries;
    DROP POLICY IF EXISTS "Admin/accountant write salaries" ON public.monthly_salaries;

    DROP POLICY IF EXISTS "Admin/accountant read salaries" ON public.monthly_salaries;
    CREATE POLICY "Admin/accountant read salaries" ON public.monthly_salaries FOR SELECT TO authenticated
      USING (public.app_role() IN ('admin', 'accountant'));

    DROP POLICY IF EXISTS "Admin/accountant write salaries" ON public.monthly_salaries;
    CREATE POLICY "Admin/accountant write salaries" ON public.monthly_salaries FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'accountant'))
      WITH CHECK (public.app_role() IN ('admin', 'accountant'));
  END IF;
END $$;

-- ── 4. fee_payments — read: authenticated; write: admin/accountant ────────────
DO $$ BEGIN
  IF to_regclass('public.fee_payments') IS NOT NULL THEN
    DROP POLICY IF EXISTS "admins manage fee_payments"   ON public.fee_payments;
    DROP POLICY IF EXISTS "admin insert fee_payments"    ON public.fee_payments;

    DROP POLICY IF EXISTS "admin insert fee_payments" ON public.fee_payments;
    CREATE POLICY "admin insert fee_payments" ON public.fee_payments FOR INSERT TO authenticated
      WITH CHECK (public.app_role() IN ('admin', 'accountant'));
  END IF;
END $$;

-- ── 5. fee_payment_audit — read + insert: admin/accountant ────────────────────
DO $$ BEGIN
  IF to_regclass('public.fee_payment_audit') IS NOT NULL THEN
    DROP POLICY IF EXISTS "auth read fee_payment_audit"    ON public.fee_payment_audit;
    DROP POLICY IF EXISTS "admin insert fee_payment_audit" ON public.fee_payment_audit;

    DROP POLICY IF EXISTS "auth read fee_payment_audit" ON public.fee_payment_audit;
    CREATE POLICY "auth read fee_payment_audit" ON public.fee_payment_audit FOR SELECT TO authenticated
      USING (public.app_role() IN ('admin', 'accountant'));

    DROP POLICY IF EXISTS "admin insert fee_payment_audit" ON public.fee_payment_audit;
    CREATE POLICY "admin insert fee_payment_audit" ON public.fee_payment_audit FOR INSERT TO authenticated
      WITH CHECK (public.app_role() IN ('admin', 'accountant'));
  END IF;
END $$;

-- ── 6. app_settings — write: admin only ──────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.app_settings') IS NOT NULL THEN
    DROP POLICY IF EXISTS "settings_admin_write" ON public.app_settings;

    DROP POLICY IF EXISTS "settings_admin_write" ON public.app_settings;
    CREATE POLICY "settings_admin_write" ON public.app_settings FOR ALL TO authenticated
      USING (public.app_role() = 'admin')
      WITH CHECK (public.app_role() = 'admin');
  END IF;
END $$;

-- ── 7. exam_scores — admin/teacher manage; students read own ──────────────────
DO $$ BEGIN
  IF to_regclass('public.exam_scores') IS NOT NULL THEN
    DROP POLICY IF EXISTS "exam_scores_select"   ON public.exam_scores;
    DROP POLICY IF EXISTS "exam_scores: staff write" ON public.exam_scores;

    DROP POLICY IF EXISTS "exam_scores_select" ON public.exam_scores;
    CREATE POLICY "exam_scores_select" ON public.exam_scores FOR SELECT TO authenticated
      USING (
        public.app_role() IN ('admin', 'teacher')
        OR student_id = (auth.jwt() -> 'user_metadata' ->> 'student_id')  -- self-read identifier, not a privilege
        OR student_id = auth.uid()::text
      );

    DROP POLICY IF EXISTS "exam_scores: staff write" ON public.exam_scores;
    CREATE POLICY "exam_scores: staff write" ON public.exam_scores FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'teacher'))
      WITH CHECK (public.app_role() IN ('admin', 'teacher'));
  END IF;
END $$;

-- ── 8. exam_subjects / exams — admin/teacher write ────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.exam_subjects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "exam_subjects: staff write" ON public.exam_subjects;
    DROP POLICY IF EXISTS "exam_subjects: staff write" ON public.exam_subjects;
    CREATE POLICY "exam_subjects: staff write" ON public.exam_subjects FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'teacher'))
      WITH CHECK (public.app_role() IN ('admin', 'teacher'));
  END IF;

  IF to_regclass('public.exams') IS NOT NULL THEN
    DROP POLICY IF EXISTS "exams: staff write" ON public.exams;
    DROP POLICY IF EXISTS "exams: staff write" ON public.exams;
    CREATE POLICY "exams: staff write" ON public.exams FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'teacher'))
      WITH CHECK (public.app_role() IN ('admin', 'teacher'));
  END IF;
END $$;

-- ── 9. staff_members — SELECT restricted to staff roles (excludes students) ───
--     Closes the "all authenticated users can read pay rates" hole (H3). Teachers
--     retain read access (no regression for staff pages); students/self-escalated
--     accounts are blocked. Service-role writes unchanged.
--     NOTE: to also hide rate columns from teachers, expose a column-limited
--     view (id, name, status…) and point teacher-facing queries at it.
DO $$ BEGIN
  IF to_regclass('public.staff_members') IS NOT NULL THEN
    DROP POLICY IF EXISTS "staff_members_auth_select" ON public.staff_members;
    DROP POLICY IF EXISTS "staff_members_auth_select" ON public.staff_members;
    CREATE POLICY "staff_members_auth_select" ON public.staff_members FOR SELECT TO authenticated
      USING (public.app_role() IN ('admin', 'accountant', 'teacher'));
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- STILL OPEN (intentionally not changed here — require a design decision):
--   • public.student_self_reports allows anon SELECT/INSERT/UPDATE. This backs an
--     AUTH-LESS public student portal (students identified by class_id+roll_no).
--     Locking it down needs a per-student token/PIN so submissions can be row-
--     scoped; a blind RLS change would break the live portal. Track separately.
-- ──────────────────────────────────────────────────────────────────────────────


-- ==================== migrations/20260603130000_lock_student_self_reports.sql ====================
-- ══════════════════════════════════════════════════════════════════════════
-- SECURITY (audit H3): lock down student_self_reports.
--
-- Previously: anon could SELECT/INSERT/UPDATE every row (USING true) — anyone
-- with the public anon key could dump all students' activity logs or tamper
-- with any row.
--
-- Now: the student portal writes via the server route /api/student-report
-- (service role, validated against the roster and scoped to one student), so
-- the table needs NO anon access. Teachers/admins still read class reports
-- through their authenticated session.
--
-- Depends on public.app_role() from 20260603120000_security_rls_app_metadata.sql.
-- Ship AFTER deploying the portal change that routes reads/writes through the
-- API (so the portal never relies on anon access during the cutover).
-- ══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF to_regclass('public.student_self_reports') IS NOT NULL THEN
    -- Remove every prior anon/public policy.
    DROP POLICY IF EXISTS "student_self_reports_public" ON public.student_self_reports;
    DROP POLICY IF EXISTS "ssr_anon_select"  ON public.student_self_reports;
    DROP POLICY IF EXISTS "ssr_anon_insert"  ON public.student_self_reports;
    DROP POLICY IF EXISTS "ssr_anon_update"  ON public.student_self_reports;
    DROP POLICY IF EXISTS "ssr_service_delete" ON public.student_self_reports;
    DROP POLICY IF EXISTS "ssr_service_all"  ON public.student_self_reports;
    DROP POLICY IF EXISTS "ssr_staff_select" ON public.student_self_reports;

    -- Teachers/admins/accountants read class reports via authenticated session.
    DROP POLICY IF EXISTS "ssr_staff_select" ON public.student_self_reports;
    CREATE POLICY "ssr_staff_select" ON public.student_self_reports
      FOR SELECT TO authenticated
      USING (public.app_role() IN ('admin', 'accountant', 'teacher'));

    -- All portal writes happen server-side via the service role API route.
    DROP POLICY IF EXISTS "ssr_service_all" ON public.student_self_reports;
    CREATE POLICY "ssr_service_all" ON public.student_self_reports
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;


-- ==================== migrations/20260603140000_student_portal_pin.sql ====================
-- Optional per-student PIN for the activity portal (closes the audit H3 residual:
-- identity was just the roll number, which a peer could guess).
--
-- NULL = no PIN required → fully backward compatible: existing students keep
-- working until an admin sets a PIN via /api/student-pin.
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS portal_pin_hash TEXT;

COMMENT ON COLUMN public.students.portal_pin_hash IS
  'scrypt hash of the student portal PIN (set via /api/student-pin). NULL = no PIN required. Never exposed to the anon client.';


-- ==================== migrations/20260606000000_attendance_arrival_time.sql ====================
-- ══════════════════════════════════════════════════════════
-- Ihlamudheen Madrasa — Student late-arrival tracking
-- Adds an arrival_time column to the attendance table so the
-- marking screen can record when each student arrived. Arrivals
-- after the program's official start time are stored with
-- status = 'late' (already permitted by the status CHECK).
--
-- Program start times (students):
--   Ihlamudheen Madrasa             09:00
--   Ihlamudheen Madrasa English Madrasa 15:00
--   Ihlamudheen Madrasa Edu Support     09:00
--   CIBIS Certification       — not tracked
-- ══════════════════════════════════════════════════════════

-- Arrival time stored as "HH:MM" (24-hour), nullable — only set when recorded.
ALTER TABLE public.student_attendance ADD COLUMN IF NOT EXISTS arrival_time TEXT;

-- Absence/late note column is referenced by the app; ensure it exists.
ALTER TABLE public.student_attendance ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Fast lookup of late records for the daily/monthly late-comer reports.
CREATE INDEX IF NOT EXISTS idx_attendance_late
  ON public.student_attendance(date)
  WHERE status = 'late';


-- ==================== migrations/20260607000000_recitation_sessions.sql ====================
-- ============================================================
-- Quran Recitation Tracking & Progress System
--
-- One row per 5-minute one-on-one recitation assessment.
-- A dedicated recitation teacher pulls students out of class one
-- at a time, coaches them, and scores them against a FIXED rubric:
--
--   Pronunciation Accuracy ... /20
--   Tajweed Rules ............ /20
--   Style and Melody ......... /5
--   Start and Stop ........... /5
--   --------------------------------
--   Total .................... /50
--
-- One assessment per student per date (re-scoring the same date
-- upserts). Weekly cadence → reports show week-over-week progress.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.recitation_sessions (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id       TEXT        NOT NULL,
  student_id     TEXT        NOT NULL,
  session_date   DATE        NOT NULL,

  -- Rubric sub-scores (bounded to the fixed maximums)
  pronunciation  INTEGER     NOT NULL DEFAULT 0 CHECK (pronunciation BETWEEN 0 AND 20),
  tajweed        INTEGER     NOT NULL DEFAULT 0 CHECK (tajweed       BETWEEN 0 AND 20),
  style          INTEGER     NOT NULL DEFAULT 0 CHECK (style         BETWEEN 0 AND 5),
  start_stop     INTEGER     NOT NULL DEFAULT 0 CHECK (start_stop    BETWEEN 0 AND 5),

  -- Persisted total (kept in sync by the trigger below) — 0..50
  total          INTEGER     NOT NULL DEFAULT 0 CHECK (total BETWEEN 0 AND 50),

  -- Short coaching note: what was worked on this session
  notes          TEXT,

  -- Audit: who assessed (display name + auth user id)
  assessed_by    TEXT,
  assessed_by_id UUID        REFERENCES auth.users(id),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (student_id, session_date)
);

-- Fast loads: one class at a time, ordered by date
CREATE INDEX IF NOT EXISTS idx_recitation_class_date
  ON public.recitation_sessions (class_id, session_date);

-- Fast student-portal loads
CREATE INDEX IF NOT EXISTS idx_recitation_student_date
  ON public.recitation_sessions (student_id, session_date);

-- ── Keep total + updated_at consistent regardless of client ───────────────────
CREATE OR REPLACE FUNCTION public.recitation_sync_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.total := COALESCE(NEW.pronunciation, 0)
             + COALESCE(NEW.tajweed, 0)
             + COALESCE(NEW.style, 0)
             + COALESCE(NEW.start_stop, 0);
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_recitation_sync_total ON public.recitation_sessions;
CREATE TRIGGER trg_recitation_sync_total
  BEFORE INSERT OR UPDATE ON public.recitation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.recitation_sync_total();

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Mirrors exam_scores: admin/teacher manage everything; a student/parent may
-- read only their own child's rows. Role is read from the non-writable
-- app_metadata claim via public.app_role() (see 20260603120000).
ALTER TABLE public.recitation_sessions ENABLE ROW LEVEL SECURITY;

-- Read: staff see all; students/parents see only their own student_id
DROP POLICY IF EXISTS "recitation_select" ON public.recitation_sessions;
DROP POLICY IF EXISTS "recitation_select" ON public.recitation_sessions;
CREATE POLICY "recitation_select" ON public.recitation_sessions FOR SELECT TO authenticated
  USING (
    public.app_role() IN ('admin', 'teacher')
    OR student_id = (auth.jwt() -> 'user_metadata' ->> 'student_id')  -- self-read identifier, not a privilege
    OR student_id = auth.uid()::text
  );

-- Write (insert/update/delete): admin + teacher only
DROP POLICY IF EXISTS "recitation_staff_write" ON public.recitation_sessions;
DROP POLICY IF EXISTS "recitation_staff_write" ON public.recitation_sessions;
CREATE POLICY "recitation_staff_write" ON public.recitation_sessions FOR ALL TO authenticated
  USING (public.app_role() IN ('admin', 'teacher'))
  WITH CHECK (public.app_role() IN ('admin', 'teacher'));


-- ==================== migrations/20260609000000_student_email.sql ====================
-- Add email column to students table
alter table students
  add column if not exists email text;


-- ==================== migrations/20260618000000_exam_scores_decimal.sql ====================
-- Allow fractional marks in the grade book.
--
-- The grade-book UI lets teachers type scores like "48.5", but the
-- exam columns were INTEGER, so Postgres rejected the save with
-- "invalid input syntax for type integer: \"48.5\"".
--
-- Widen the score / max-score columns to NUMERIC so half-marks (and any
-- other fractional value) can be stored. Existing whole-number values are
-- preserved unchanged by the implicit integer -> numeric cast.

ALTER TABLE public.exam_scores
  ALTER COLUMN score TYPE NUMERIC USING score::numeric;

ALTER TABLE public.exam_subjects
  ALTER COLUMN max_score TYPE NUMERIC USING max_score::numeric;

ALTER TABLE public.exams
  ALTER COLUMN total_max_score TYPE NUMERIC USING total_max_score::numeric;


-- ==================== migrations/20260618100000_period_timetables.sql ====================
-- Period-wise timetables: subject + teacher assigned to each teaching period of
-- a class. One row per (class_id, day, period_label). Times themselves come from
-- the bell-timetable grid in code (src/data/bell-timetable.ts), so only the
-- assignment is stored here.
--
-- NOTE: the v1 UI persists to localStorage; wiring src/lib/db.ts to this table
-- is the follow-up that makes timetables shared across devices/users.

CREATE TABLE IF NOT EXISTS public.period_timetables (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Free-text class id (Ihlamudheen class ids AND synthetic ids like "edu-1a"); no FK
  -- to public.classes so EDU Support levels that aren't seeded there still work.
  class_id          TEXT NOT NULL,
  bell_timetable_id TEXT NOT NULL,             -- e.g. "madrasa-madrasa-sat-sun"
  day               TEXT NOT NULL,             -- e.g. "Saturday"
  period_label      TEXT NOT NULL,             -- e.g. "Period 1"
  subject_id        TEXT,
  subject_name      TEXT NOT NULL DEFAULT '',
  teacher_id        TEXT,
  teacher_name      TEXT,
  room              TEXT,
  note              TEXT,
  updated_at        TIMESTAMPTZ DEFAULT now(),
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(class_id, day, period_label)
);

CREATE INDEX IF NOT EXISTS idx_period_timetables_class ON public.period_timetables(class_id);
CREATE INDEX IF NOT EXISTS idx_period_timetables_teacher ON public.period_timetables(teacher_id);

ALTER TABLE public.period_timetables ENABLE ROW LEVEL SECURITY;

-- All signed-in users may read timetables (view/print/export).
DROP POLICY IF EXISTS "auth users read period_timetables" ON public.period_timetables;
CREATE POLICY "auth users read period_timetables" ON public.period_timetables FOR SELECT TO authenticated USING (true);

-- Only admins may create/update/delete. Role is read from app_metadata, which
-- is NOT user-writable (see src/lib/api-auth.ts and the security RLS migration).
DROP POLICY IF EXISTS "admins manage period_timetables" ON public.period_timetables;
CREATE POLICY "admins manage period_timetables" ON public.period_timetables FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');


-- ==================== migrations/20260620100000_disabled_teachers.sql ====================
-- ============================================================
-- Disabled teachers / staff
-- A teacher who has left Ihlamudheen Madrasa is "disabled" rather than deleted:
-- their historical punch records and approved salary snapshots are kept,
-- but they are hidden going forward from the attendance widgets, synthesized
-- absences, EDU-support hours, the staff grid, and payroll selection.
-- Written by /api/admin/teacher-status (admin only).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.disabled_teachers (
  teacher_id  TEXT        PRIMARY KEY,  -- matches initialTeachers id in courses.ts, e.g. "t40"
  disabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_by TEXT,                     -- email of the admin who disabled them
  reason      TEXT
);

-- ── Row Level Security ──────────────────────────────────────
ALTER TABLE public.disabled_teachers ENABLE ROW LEVEL SECURITY;

-- Authenticated users (teachers/admin) can read who is disabled, so every
-- surface can filter consistently.
DROP POLICY IF EXISTS "disabled_teachers_auth_select" ON public.disabled_teachers;
DROP POLICY IF EXISTS "disabled_teachers_auth_select" ON public.disabled_teachers;
CREATE POLICY "disabled_teachers_auth_select" ON public.disabled_teachers
  FOR SELECT TO authenticated
  USING (true);

-- Only service_role (the admin API) can disable / re-enable.
DROP POLICY IF EXISTS "disabled_teachers_service_write" ON public.disabled_teachers;
DROP POLICY IF EXISTS "disabled_teachers_service_write" ON public.disabled_teachers;
CREATE POLICY "disabled_teachers_service_write" ON public.disabled_teachers
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);


-- ==================== migrations/20260621000000_accountant_manage_students.sql ====================
-- ══════════════════════════════════════════════════════════════════════
-- Student management permissions (Teachers roster: course → class)
--
--   • ADD    (INSERT) a student → admin / accountant only
--   • REMOVE (DELETE) a student → admin / accountant only
--   • EDIT   (UPDATE) a student → all staff (admin / teacher / accountant)
--
-- Why split the policy:
--   The old policy was a single FOR ALL rule limited to admin + teacher
--   (public.is_teacher_or_admin()). That had two problems:
--     1. Accountants could not add/remove students even though the Teachers
--        roster exposes those actions to them — their write was silently
--        rejected by RLS and the row reappeared on refresh.
--     2. Teachers could add/remove students, which is not wanted —
--        only admins and accountants may add or remove a student.
--   Teachers still legitimately EDIT students (profile fields, photo), so
--   UPDATE stays open to all staff while INSERT/DELETE are tightened to
--   admin + accountant.
--
-- SELECT is unchanged (handled by the existing "anyone authenticated can
-- read students" policy) so all roles keep read access.
-- ══════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF to_regclass('public.students') IS NOT NULL THEN
    -- Remove the legacy single manage policy in all its known names.
    DROP POLICY IF EXISTS "Admins and teachers can manage students" ON public.students;
    DROP POLICY IF EXISTS "students: staff manage" ON public.students;
    -- Drop our own granular policies too, so this migration is idempotent.
    DROP POLICY IF EXISTS "students: admin/accountant insert" ON public.students;
    DROP POLICY IF EXISTS "students: admin/accountant delete" ON public.students;
    DROP POLICY IF EXISTS "students: staff update" ON public.students;

    -- ADD a student → admin / accountant
    DROP POLICY IF EXISTS "students: admin/accountant insert" ON public.students;
    CREATE POLICY "students: admin/accountant insert" ON public.students
      FOR INSERT TO authenticated
      WITH CHECK (public.is_admin_or_accountant());

    -- REMOVE a student → admin / accountant
    DROP POLICY IF EXISTS "students: admin/accountant delete" ON public.students;
    CREATE POLICY "students: admin/accountant delete" ON public.students
      FOR DELETE TO authenticated
      USING (public.is_admin_or_accountant());

    -- EDIT a student (profile, photo) → all staff (incl. teachers)
    DROP POLICY IF EXISTS "students: staff update" ON public.students;
    CREATE POLICY "students: staff update" ON public.students
      FOR UPDATE TO authenticated
      USING (public.is_staff())
      WITH CHECK (public.is_staff());
  END IF;
END $$;


-- ==================== migrations/20260621000000_period_timetables_drop_class_fk.sql ====================
-- Drop the foreign key from period_timetables.class_id → classes(id).
-- The EDU Support weekly timetable uses synthetic level ids ("edu-1a" … "edu-5a")
-- that are NOT rows in public.classes, so the FK would reject those inserts.
-- class_id is now a free-text key. Safe/idempotent.

ALTER TABLE public.period_timetables
  DROP CONSTRAINT IF EXISTS period_timetables_class_id_fkey;


-- ==================== migrations/20260621100000_student_disenroll.sql ====================
-- ══════════════════════════════════════════════════════════════════════
-- Student disenrollment (soft archive)
--
-- "Disenroll" marks a student as having left WITHOUT deleting their record,
-- attendance, or grades — unlike the permanent "Remove" action. A
-- disenrolled student disappears from active rosters but can be viewed on
-- the Disenroll page and re-enrolled later.
--
--   disenrolled_at   — when the student left (NULL = active / enrolled)
--   disenroll_reason — optional free-text note (e.g. "moved", "graduated")
-- ══════════════════════════════════════════════════════════════════════

alter table public.students
  add column if not exists disenrolled_at  timestamptz,
  add column if not exists disenroll_reason text;

-- Speeds up the "active students only" filter used by every roster query.
create index if not exists idx_students_disenrolled_at
  on public.students(disenrolled_at);


-- ==================== migrations/20260623000000_accountant_teacher_parity.sql ====================
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ Accountant = superset of Teacher                                  ║
-- ║                                                                    ║
-- ║ Product decision: every option/page a teacher can use (Quran      ║
-- ║ Recitation, Grade Book, …) must also work for accountants. The UI  ║
-- ║ role gates were widened to include 'accountant'; this migration    ║
-- ║ widens the matching RLS so accountant reads AND writes are not      ║
-- ║ rejected by the database.                                          ║
-- ║                                                                    ║
-- ║ Mirrors 20260603120000 (exam_*) and 20260607000000 (recitation),   ║
-- ║ adding 'accountant' alongside 'admin','teacher'. Idempotent:       ║
-- ║ DROP … IF EXISTS then CREATE, each guarded by to_regclass so it is  ║
-- ║ safe to run even if a table doesn't exist yet (avoids 42P01).      ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── recitation_sessions — staff (admin/accountant/teacher) manage; self-read ──
DO $$ BEGIN
  IF to_regclass('public.recitation_sessions') IS NOT NULL THEN
    DROP POLICY IF EXISTS "recitation_select" ON public.recitation_sessions;
    DROP POLICY IF EXISTS "recitation_select" ON public.recitation_sessions;
    CREATE POLICY "recitation_select" ON public.recitation_sessions FOR SELECT TO authenticated
      USING (
        public.app_role() IN ('admin', 'accountant', 'teacher')
        OR student_id = (auth.jwt() -> 'user_metadata' ->> 'student_id')  -- self-read identifier, not a privilege
        OR student_id = auth.uid()::text
      );

    DROP POLICY IF EXISTS "recitation_staff_write" ON public.recitation_sessions;
    DROP POLICY IF EXISTS "recitation_staff_write" ON public.recitation_sessions;
    CREATE POLICY "recitation_staff_write" ON public.recitation_sessions FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'accountant', 'teacher'))
      WITH CHECK (public.app_role() IN ('admin', 'accountant', 'teacher'));
  END IF;
END $$;

-- ── exam_scores — staff manage; students read own ─────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.exam_scores') IS NOT NULL THEN
    DROP POLICY IF EXISTS "exam_scores_select"   ON public.exam_scores;
    DROP POLICY IF EXISTS "exam_scores: staff write" ON public.exam_scores;

    DROP POLICY IF EXISTS "exam_scores_select" ON public.exam_scores;
    CREATE POLICY "exam_scores_select" ON public.exam_scores FOR SELECT TO authenticated
      USING (
        public.app_role() IN ('admin', 'accountant', 'teacher')
        OR student_id = (auth.jwt() -> 'user_metadata' ->> 'student_id')  -- self-read identifier, not a privilege
        OR student_id = auth.uid()::text
      );

    DROP POLICY IF EXISTS "exam_scores: staff write" ON public.exam_scores;
    CREATE POLICY "exam_scores: staff write" ON public.exam_scores FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'accountant', 'teacher'))
      WITH CHECK (public.app_role() IN ('admin', 'accountant', 'teacher'));
  END IF;
END $$;

-- ── exam_subjects / exams — staff write ───────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.exam_subjects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "exam_subjects: staff write" ON public.exam_subjects;
    DROP POLICY IF EXISTS "exam_subjects: staff write" ON public.exam_subjects;
    CREATE POLICY "exam_subjects: staff write" ON public.exam_subjects FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'accountant', 'teacher'))
      WITH CHECK (public.app_role() IN ('admin', 'accountant', 'teacher'));
  END IF;

  IF to_regclass('public.exams') IS NOT NULL THEN
    DROP POLICY IF EXISTS "exams: staff write" ON public.exams;
    DROP POLICY IF EXISTS "exams: staff write" ON public.exams;
    CREATE POLICY "exams: staff write" ON public.exams FOR ALL TO authenticated
      USING (public.app_role() IN ('admin', 'accountant', 'teacher'))
      WITH CHECK (public.app_role() IN ('admin', 'accountant', 'teacher'));
  END IF;
END $$;


-- ==================== migrations/20260623000000_edu_teacher_subjects.sql ====================
-- EDU Support: per-teacher subject + grade ELIGIBILITY for the auto-scheduler.
-- Each row says "this teacher MAY teach this subject in this grade". The free
-- max-flow solver (src/lib/edu-loadplan.ts) then auto-balances the actual period
-- counts within these choices, so "assign subject + grade" and "automatic load
-- balancing" coexist: pin a (subject, grade) to one teacher and they get it all;
-- allow several and the load is split evenly. When no rows exist for the EDU
-- staff, the solver falls back to canTeach-based eligibility (every grade).
--
-- Free-text ids: teacher_id matches initialTeachers / EDU_TEACHERS (e.g. "t45"),
-- grade_id matches EDU_GRADES (e.g. "edu-1a"); no FKs so synthetic EDU levels
-- that aren't seeded in public.classes still work.

CREATE TABLE IF NOT EXISTS public.edu_teacher_subjects (
  teacher_id  TEXT NOT NULL,
  grade_id    TEXT NOT NULL,
  subject     TEXT NOT NULL,        -- "English" | "Maths" | "Science" | "Arabic"
  updated_at  TIMESTAMPTZ DEFAULT now(),
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (teacher_id, grade_id, subject)
);

CREATE INDEX IF NOT EXISTS idx_edu_teacher_subjects_grade ON public.edu_teacher_subjects(grade_id);

ALTER TABLE public.edu_teacher_subjects ENABLE ROW LEVEL SECURITY;

-- All signed-in users may read the eligibility (needed to generate timetables).
DROP POLICY IF EXISTS "auth users read edu_teacher_subjects" ON public.edu_teacher_subjects;
CREATE POLICY "auth users read edu_teacher_subjects" ON public.edu_teacher_subjects FOR SELECT TO authenticated USING (true);

-- Only admins may change assignments. Role is read from app_metadata, which is
-- NOT user-writable (see src/lib/api-auth.ts and the security RLS migration).
DROP POLICY IF EXISTS "admins manage edu_teacher_subjects" ON public.edu_teacher_subjects;
CREATE POLICY "admins manage edu_teacher_subjects" ON public.edu_teacher_subjects FOR ALL TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');


-- ==================== migrations/20260623120000_meelad_fest_phase1.sql ====================
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 1: schema + RLS + seed                        ║
-- ║                                                                    ║
-- ║ "Ihlamudheen Madrasa Meelad Fest Portal" — a multi-year madrasa arts-fest    ║
-- ║ module living INSIDE Ihlamudheen on the same Supabase project. Every     ║
-- ║ transactional table hangs off `edition_id` so each yearly fest is  ║
-- ║ an isolated, permanently-browsable archive ("clone last year",     ║
-- ║ lifetime student profiles, Hall of Fame all fall out of this).     ║
-- ║                                                                    ║
-- ║ All `fest_*` tables are namespaced to avoid colliding with the     ║
-- ║ existing Ihlamudheen schema. RLS reuses public.app_role() (reads the     ║
-- ║ non-user-writable app_metadata.role claim — see migration          ║
-- ║ 20260603120000). New role strings: 'coordinator', 'judge',         ║
-- ║ 'parent' (set in app_metadata; no app_role() change needed).      ║
-- ║                                                                    ║
-- ║ Locked decisions (§14): module-inside-Ihlamudheen · cap 4 individual +   ║
-- ║ 2 group · points roll up by BOTH house and section · judges see    ║
-- ║ code numbers (admin can always reveal names). Scoring thresholds/  ║
-- ║ aggregation/tie-break live in editions.config and stay per-edition ║
-- ║ configurable (wired up in Phase 4 judging).                        ║
-- ║                                                                    ║
-- ║ Idempotent: IF NOT EXISTS for tables, guarded DO blocks for enums  ║
-- ║ and policies, ON CONFLICT for seed — safe to re-run.               ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── Enums ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE fest_edition_status AS ENUM
    ('draft','registration_open','scheduling','live','results_published','archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE fest_item_language AS ENUM ('en','ml','ar','na');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE fest_item_type AS ENUM ('individual','group');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Shared updated_at helper (create-or-replace; may already exist in Ihlamudheen) ──
CREATE OR REPLACE FUNCTION public.fest_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLES
-- ══════════════════════════════════════════════════════════════════════════════

-- editions — one per yearly fest; the backbone every other table scopes to.
CREATE TABLE IF NOT EXISTS public.fest_editions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,                       -- 'meelad-2026'
  name        text NOT NULL,                              -- 'Meelad 2026'
  theme       text,
  year        int,
  starts_on   date,
  ends_on     date,
  status      fest_edition_status NOT NULL DEFAULT 'draft',
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,         -- caps, grades, points, aggregation…
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- houses — competing units that accumulate points (Green/Blue/Red/Yellow).
CREATE TABLE IF NOT EXISTS public.fest_houses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id  uuid NOT NULL REFERENCES public.fest_editions(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (edition_id, name)
);

-- sections — class sections (1A…10A). Reusable across editions; the per-year
-- section/house/category a student belongs to lives in fest_student_editions.
CREATE TABLE IF NOT EXISTS public.fest_sections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text UNIQUE NOT NULL,                       -- '1A'
  grade       int,                                        -- 1
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- categories — age/class bands, configurable per edition.
CREATE TABLE IF NOT EXISTS public.fest_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id  uuid NOT NULL REFERENCES public.fest_editions(id) ON DELETE CASCADE,
  name        text NOT NULL,                              -- 'Sub-Junior'…
  min_grade   int,
  max_grade   int,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (edition_id, name)
);

-- students — lifetime madrasa roll, keyed by STABLE registration number so a
-- student's history survives across years (they change section each year).
CREATE TABLE IF NOT EXISTS public.fest_students (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reg_no            text UNIQUE NOT NULL,                 -- the REG/ID in the sheet
  name              text NOT NULL,
  name_ml           text,                                 -- Malayalam / Arabi-Malayalam
  gender            text CHECK (gender IN ('male','female')),
  parent_name       text,
  parent_mobile     text,
  madrasa_student_id  text,                                 -- optional link to Ihlamudheen roll
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- student_editions — a student's section/house/category/code AS OF an edition.
CREATE TABLE IF NOT EXISTS public.fest_student_editions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id   uuid NOT NULL REFERENCES public.fest_editions(id)  ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES public.fest_students(id)  ON DELETE CASCADE,
  section_id   uuid REFERENCES public.fest_sections(id),
  house_id     uuid REFERENCES public.fest_houses(id),
  category_id  uuid REFERENCES public.fest_categories(id),
  grade        int,
  code_no      text,                                      -- anonymization code shown to judges
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (edition_id, student_id),
  UNIQUE (edition_id, code_no)
);

-- items (events) — speech, recitation, duff, group programmes, etc.
CREATE TABLE IF NOT EXISTS public.fest_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id        uuid NOT NULL REFERENCES public.fest_editions(id) ON DELETE CASCADE,
  name              text NOT NULL,                        -- canonical, e.g. 'Speech – English'
  name_ml           text,
  language          fest_item_language NOT NULL DEFAULT 'na',
  type              fest_item_type     NOT NULL DEFAULT 'individual',
  category_id       uuid REFERENCES public.fest_categories(id),
  stage             text,
  scheduled_at      timestamptz,
  max_per_section   int,
  group_min         int,
  group_max         int,
  rubric            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{key,label,weight,max}]
  rules             text,
  duration_minutes  int,
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fest_items_group_size_ck
    CHECK (group_min IS NULL OR group_max IS NULL OR group_min <= group_max)
);
-- One item name per (edition, category), case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS fest_items_edition_name_cat_uq
  ON public.fest_items (edition_id, lower(name), coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- registrations — student/group → item within an edition.
CREATE TABLE IF NOT EXISTS public.fest_registrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id    uuid NOT NULL REFERENCES public.fest_editions(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES public.fest_items(id)    ON DELETE CASCADE,
  student_id    uuid REFERENCES public.fest_students(id) ON DELETE CASCADE,  -- individual entrant / group leader
  is_group      boolean NOT NULL DEFAULT false,
  section_id    uuid REFERENCES public.fest_sections(id),                    -- snapshot for reporting
  status        text NOT NULL DEFAULT 'registered',       -- registered | verified | withdrawn
  import_batch  uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fest_reg_student_or_group_ck CHECK (is_group OR student_id IS NOT NULL)
);
-- A student can register an individual item only once per edition.
CREATE UNIQUE INDEX IF NOT EXISTS fest_reg_edition_item_student_uq
  ON public.fest_registrations (edition_id, item_id, student_id)
  WHERE student_id IS NOT NULL;

-- group_members — students inside a group registration.
CREATE TABLE IF NOT EXISTS public.fest_group_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id  uuid NOT NULL REFERENCES public.fest_registrations(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL REFERENCES public.fest_students(id)      ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_id, student_id)
);

-- audit_log — who changed what (competition integrity; expanded in later phases).
CREATE TABLE IF NOT EXISTS public.fest_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id  uuid REFERENCES public.fest_editions(id) ON DELETE SET NULL,
  actor       uuid,
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes for the common edition-scoped lookups ─────────────────────────────
CREATE INDEX IF NOT EXISTS fest_student_editions_edition_idx ON public.fest_student_editions (edition_id);
CREATE INDEX IF NOT EXISTS fest_student_editions_student_idx ON public.fest_student_editions (student_id);
CREATE INDEX IF NOT EXISTS fest_items_edition_idx            ON public.fest_items (edition_id);
CREATE INDEX IF NOT EXISTS fest_registrations_edition_idx    ON public.fest_registrations (edition_id);
CREATE INDEX IF NOT EXISTS fest_registrations_item_idx       ON public.fest_registrations (item_id);
CREATE INDEX IF NOT EXISTS fest_registrations_student_idx    ON public.fest_registrations (student_id);
CREATE INDEX IF NOT EXISTS fest_group_members_student_idx    ON public.fest_group_members (student_id);

-- ── updated_at triggers ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS fest_editions_set_updated_at ON public.fest_editions;
CREATE TRIGGER fest_editions_set_updated_at BEFORE UPDATE ON public.fest_editions
  FOR EACH ROW EXECUTE FUNCTION public.fest_set_updated_at();
DROP TRIGGER IF EXISTS fest_students_set_updated_at ON public.fest_students;
CREATE TRIGGER fest_students_set_updated_at BEFORE UPDATE ON public.fest_students
  FOR EACH ROW EXECUTE FUNCTION public.fest_set_updated_at();

-- ══════════════════════════════════════════════════════════════════════════════
-- BUSINESS RULES enforced at the DB (UI is not the gate — §12 acceptance)
-- ══════════════════════════════════════════════════════════════════════════════

-- Per-student item cap. Reads the edition's config.caps (defaults 4 individual,
-- 2 group). Counts the student's existing INDIVIDUAL registrations vs GROUP
-- registrations (as entrant/leader) for the edition and rejects over-cap inserts.
-- Member-level group cap (a student appearing only in fest_group_members) is a
-- Phase-2 refinement; Phase-1 imports register the entrant on the registration row.
CREATE OR REPLACE FUNCTION public.fest_enforce_item_cap()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cfg          jsonb;
  cap_ind      int;
  cap_grp      int;
  is_grp_item  boolean;
  existing_ind int;
  existing_grp int;
BEGIN
  IF NEW.student_id IS NULL THEN
    RETURN NEW;  -- pure group entry with no leader: cap tracked via members later
  END IF;

  SELECT config INTO cfg FROM public.fest_editions WHERE id = NEW.edition_id;
  cap_ind := COALESCE((cfg #>> '{caps,individual}')::int, 4);
  cap_grp := COALESCE((cfg #>> '{caps,group}')::int, 2);

  SELECT (type = 'group') INTO is_grp_item FROM public.fest_items WHERE id = NEW.item_id;

  SELECT
    count(*) FILTER (WHERE i.type = 'individual'),
    count(*) FILTER (WHERE i.type = 'group')
  INTO existing_ind, existing_grp
  FROM public.fest_registrations r
  JOIN public.fest_items i ON i.id = r.item_id
  WHERE r.edition_id = NEW.edition_id
    AND r.student_id = NEW.student_id
    AND r.status <> 'withdrawn'
    AND r.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF COALESCE(is_grp_item, false) THEN
    IF existing_grp >= cap_grp THEN
      RAISE EXCEPTION 'fest: student exceeds group item cap (%).', cap_grp
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF existing_ind >= cap_ind THEN
      RAISE EXCEPTION 'fest: student exceeds individual item cap (%).', cap_ind
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fest_registrations_cap ON public.fest_registrations;
CREATE TRIGGER fest_registrations_cap
  BEFORE INSERT OR UPDATE OF student_id, item_id, status ON public.fest_registrations
  FOR EACH ROW EXECUTE FUNCTION public.fest_enforce_item_cap();

-- Group size ceiling: never let members exceed the item's group_max.
CREATE OR REPLACE FUNCTION public.fest_enforce_group_max()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g_max int; n int;
BEGIN
  SELECT i.group_max INTO g_max
  FROM public.fest_registrations r JOIN public.fest_items i ON i.id = r.item_id
  WHERE r.id = NEW.registration_id;
  IF g_max IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.fest_group_members WHERE registration_id = NEW.registration_id;
    IF n >= g_max THEN
      RAISE EXCEPTION 'fest: group exceeds max size (%).', g_max USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fest_group_members_max ON public.fest_group_members;
CREATE TRIGGER fest_group_members_max
  BEFORE INSERT ON public.fest_group_members
  FOR EACH ROW EXECUTE FUNCTION public.fest_enforce_group_max();

-- ══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
--   admin                       → super admin, full control
--   accountant/coordinator/teacher → fest staff: manage roster/items/registration
--   anon (public)               → read-only on the public catalog of a non-draft
--                                 edition (editions, houses, categories, sections,
--                                 items). Student PII + registrations stay private.
--   judge/parent/student        → scoped reads land in Phase 4/7; until then they
--                                 fall through to the authenticated staff checks.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fest_is_staff()
RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT public.app_role() IN ('admin','accountant','coordinator','teacher') $$;

ALTER TABLE public.fest_editions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_houses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_sections         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_students         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_student_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_registrations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_group_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_audit_log        ENABLE ROW LEVEL SECURITY;

-- editions: admin writes; staff read all; public reads non-draft editions.
DROP POLICY IF EXISTS fest_editions_public_read ON public.fest_editions;
DROP POLICY IF EXISTS fest_editions_public_read ON public.fest_editions;
CREATE POLICY fest_editions_public_read ON public.fest_editions
  FOR SELECT TO anon, authenticated
  USING (status <> 'draft' OR public.fest_is_staff());
DROP POLICY IF EXISTS fest_editions_admin_write ON public.fest_editions;
DROP POLICY IF EXISTS fest_editions_admin_write ON public.fest_editions;
CREATE POLICY fest_editions_admin_write ON public.fest_editions
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

-- Public-catalog tables: anon read when parent edition is non-draft; staff manage.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fest_houses','fest_categories','fest_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_public_read', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated
      USING (
        public.fest_is_staff()
        OR EXISTS (SELECT 1 FROM public.fest_editions e
                   WHERE e.id = %I.edition_id AND e.status <> 'draft')
      )$f$, t||'_public_read', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_staff_write', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING (public.fest_is_staff()) WITH CHECK (public.fest_is_staff())$f$,
      t||'_staff_write', t);
  END LOOP;
END $$;

-- sections are global (no edition_id): public read, staff manage.
DROP POLICY IF EXISTS fest_sections_public_read ON public.fest_sections;
DROP POLICY IF EXISTS fest_sections_public_read ON public.fest_sections;
CREATE POLICY fest_sections_public_read ON public.fest_sections
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS fest_sections_staff_write ON public.fest_sections;
DROP POLICY IF EXISTS fest_sections_staff_write ON public.fest_sections;
CREATE POLICY fest_sections_staff_write ON public.fest_sections
  FOR ALL TO authenticated
  USING (public.fest_is_staff()) WITH CHECK (public.fest_is_staff());

-- PII / transactional tables: staff only (parents/students/judges added later).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fest_students','fest_student_editions',
                           'fest_registrations','fest_group_members'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_staff_all', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING (public.fest_is_staff()) WITH CHECK (public.fest_is_staff())$f$,
      t||'_staff_all', t);
  END LOOP;
END $$;

-- audit_log: staff insert, admin read.
DROP POLICY IF EXISTS fest_audit_admin_read ON public.fest_audit_log;
DROP POLICY IF EXISTS fest_audit_admin_read ON public.fest_audit_log;
CREATE POLICY fest_audit_admin_read ON public.fest_audit_log
  FOR SELECT TO authenticated USING (public.app_role() = 'admin');
DROP POLICY IF EXISTS fest_audit_staff_insert ON public.fest_audit_log;
DROP POLICY IF EXISTS fest_audit_staff_insert ON public.fest_audit_log;
CREATE POLICY fest_audit_staff_insert ON public.fest_audit_log
  FOR INSERT TO authenticated WITH CHECK (public.fest_is_staff());

-- ══════════════════════════════════════════════════════════════════════════════
-- SEED — the current edition + default houses & category bands (§3)
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO public.fest_editions (slug, name, theme, year, status, config)
VALUES (
  'meelad-2026', 'Meelad 2026', 'Ihlamudheen Madrasa Meelad Fest', 2026, 'draft',
  jsonb_build_object(
    'caps',              jsonb_build_object('individual', 4, 'group', 2),
    'points_rollup',     'both',                 -- house AND section
    'official_champion', 'house',
    'judge_anonymize',   true,                   -- judges see code numbers
    'grade_thresholds',  jsonb_build_object('A', 80, 'B', 60, 'C', 40),
    'points',            jsonb_build_object(
                           'individual', jsonb_build_object('A', 5, 'B', 3, 'C', 1),
                           'group_multiplier', 2),
    'aggregation',       'average',              -- average | drop_high_low | sum
    'tie_break',         'rank_then_grade_count' -- placeholder; finalized in Phase 4
  )
)
ON CONFLICT (slug) DO NOTHING;

-- Default houses.
INSERT INTO public.fest_houses (edition_id, name, color, sort_order)
SELECT e.id, h.name, h.color, h.ord
FROM public.fest_editions e
CROSS JOIN (VALUES
  ('Green',  '#16a34a', 1),
  ('Blue',   '#2563eb', 2),
  ('Red',    '#dc2626', 3),
  ('Yellow', '#ca8a04', 4)
) AS h(name, color, ord)
WHERE e.slug = 'meelad-2026'
ON CONFLICT (edition_id, name) DO NOTHING;

-- Default category bands (Sub-Junior 1–2 · Junior 3–4 · Senior 5–7 · Super-Senior 8–10).
INSERT INTO public.fest_categories (edition_id, name, min_grade, max_grade, sort_order)
SELECT e.id, c.name, c.lo, c.hi, c.ord
FROM public.fest_editions e
CROSS JOIN (VALUES
  ('Sub-Junior',   1, 2, 1),
  ('Junior',       3, 4, 2),
  ('Senior',       5, 7, 3),
  ('Super-Senior', 8, 10, 4)
) AS c(name, lo, hi, ord)
WHERE e.slug = 'meelad-2026'
ON CONFLICT (edition_id, name) DO NOTHING;


-- ==================== migrations/20260623130000_meelad_fest_phase2.sql ====================
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 2: one-click edition cloning                  ║
-- ║                                                                    ║
-- ║ fest_clone_edition(source, target) copies a *catalog* — categories, ║
-- ║ houses and items — from one edition into another, remapping each    ║
-- ║ item's category to the same-named category in the target. Students  ║
-- ║ and registrations are NOT cloned: a new year reuses the structure,  ║
-- ║ not last year's entries (acceptance §12 — "creating Meelad 2027     ║
-- ║ reuses sections/students/items in one click; 2026 stays intact").   ║
-- ║                                                                    ║
-- ║ Idempotent: skips rows that already exist in the target (by name),  ║
-- ║ so it can be re-run or layered on top of a partial clone.           ║
-- ║                                                                    ║
-- ║ SECURITY DEFINER + an internal app_role() = 'admin' check so the    ║
-- ║ multi-table write is admin-only regardless of table RLS. search_    ║
-- ║ path is pinned to public to keep the definer context safe.         ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION public.fest_clone_edition(p_source uuid, p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cats   int := 0;
  v_houses int := 0;
  v_items  int := 0;
BEGIN
  IF public.app_role() <> 'admin' THEN
    RAISE EXCEPTION 'fest: only admin may clone editions' USING ERRCODE = '42501';
  END IF;
  IF p_source IS NULL OR p_target IS NULL OR p_source = p_target THEN
    RAISE EXCEPTION 'fest: source and target editions must be distinct';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fest_editions WHERE id = p_source) THEN
    RAISE EXCEPTION 'fest: source edition % not found', p_source;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fest_editions WHERE id = p_target) THEN
    RAISE EXCEPTION 'fest: target edition % not found', p_target;
  END IF;

  -- Categories (match by name).
  INSERT INTO public.fest_categories (edition_id, name, min_grade, max_grade, sort_order)
  SELECT p_target, c.name, c.min_grade, c.max_grade, c.sort_order
  FROM public.fest_categories c
  WHERE c.edition_id = p_source
    AND NOT EXISTS (
      SELECT 1 FROM public.fest_categories t
      WHERE t.edition_id = p_target AND t.name = c.name
    );
  GET DIAGNOSTICS v_cats = ROW_COUNT;

  -- Houses (match by name).
  INSERT INTO public.fest_houses (edition_id, name, color, sort_order)
  SELECT p_target, h.name, h.color, h.sort_order
  FROM public.fest_houses h
  WHERE h.edition_id = p_source
    AND NOT EXISTS (
      SELECT 1 FROM public.fest_houses t
      WHERE t.edition_id = p_target AND t.name = h.name
    );
  GET DIAGNOSTICS v_houses = ROW_COUNT;

  -- Items (remap category_id to the same-named category in the target edition).
  INSERT INTO public.fest_items (
    edition_id, name, name_ml, language, type, category_id, stage,
    max_per_section, group_min, group_max, rubric, rules, duration_minutes, status
  )
  SELECT
    p_target, i.name, i.name_ml, i.language, i.type, tc.id, i.stage,
    i.max_per_section, i.group_min, i.group_max, i.rubric, i.rules, i.duration_minutes, i.status
  FROM public.fest_items i
  LEFT JOIN public.fest_categories sc ON sc.id = i.category_id
  LEFT JOIN public.fest_categories tc
    ON tc.edition_id = p_target AND tc.name = sc.name
  WHERE i.edition_id = p_source
    AND NOT EXISTS (
      SELECT 1 FROM public.fest_items t
      WHERE t.edition_id = p_target
        AND lower(t.name) = lower(i.name)
        AND coalesce(t.category_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(tc.id,        '00000000-0000-0000-0000-000000000000'::uuid)
    );
  GET DIAGNOSTICS v_items = ROW_COUNT;

  RETURN jsonb_build_object(
    'categories', v_cats,
    'houses',     v_houses,
    'items',      v_items
  );
END $$;

REVOKE ALL ON FUNCTION public.fest_clone_edition(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fest_clone_edition(uuid, uuid) TO authenticated;


-- ==================== migrations/20260623150000_meelad_fest_phase3_scheduling.sql ====================
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 3: scheduling                                 ║
-- ║                                                                    ║
-- ║ Stages (venues) per edition, and the scheduling columns on items   ║
-- ║ (stage + start time + duration) that drive the clash detector.     ║
-- ║ Idempotent; RLS mirrors the Phase-1 catalog pattern (public reads  ║
-- ║ non-draft editions, fest staff manage).                            ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.fest_stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id  uuid NOT NULL REFERENCES public.fest_editions(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (edition_id, name)
);
CREATE INDEX IF NOT EXISTS fest_stages_edition_idx ON public.fest_stages (edition_id);

-- Items already carry `stage` (text), `scheduled_at`, `duration_minutes`; add a
-- proper FK to the stage entity so the planner can group by venue.
ALTER TABLE public.fest_items
  ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES public.fest_stages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS fest_items_stage_idx ON public.fest_items (stage_id);

ALTER TABLE public.fest_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fest_stages_public_read ON public.fest_stages;
DROP POLICY IF EXISTS fest_stages_public_read ON public.fest_stages;
CREATE POLICY fest_stages_public_read ON public.fest_stages
  FOR SELECT TO anon, authenticated
  USING (
    public.fest_is_staff()
    OR EXISTS (SELECT 1 FROM public.fest_editions e
               WHERE e.id = fest_stages.edition_id AND e.status <> 'draft')
  );
DROP POLICY IF EXISTS fest_stages_staff_write ON public.fest_stages;
DROP POLICY IF EXISTS fest_stages_staff_write ON public.fest_stages;
CREATE POLICY fest_stages_staff_write ON public.fest_stages
  FOR ALL TO authenticated
  USING (public.fest_is_staff()) WITH CHECK (public.fest_is_staff());


-- ==================== migrations/20260623160000_meelad_fest_phase4_judging.sql ====================
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 4: judging + results computation              ║
-- ║                                                                    ║
-- ║ • fest_item_judges  — which judge scores which item                ║
-- ║ • fest_scores       — one row per (judge, entry); judges see only   ║
-- ║                       their own marks, never another judge's        ║
-- ║ • fest_results      — finalized rank/grade/points per entry         ║
-- ║ • fest_items.locked_at — item locks when judging completes          ║
-- ║                                                                    ║
-- ║ Judge anonymization (§5): judges load their sheet via               ║
-- ║ fest_judge_sheet() which returns CODE NUMBERS, never names.         ║
-- ║ Admins/staff keep full read access (the "reveal" path).            ║
-- ║                                                                    ║
-- ║ fest_recompute_results() aggregates marks per the edition's config  ║
-- ║ (average | sum | drop_high_low), grades (A/B/C thresholds), ranks   ║
-- ║ within each item, and awards points (group doubled) — atomically.   ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── Tables ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fest_item_judges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL REFERENCES public.fest_items(id) ON DELETE CASCADE,
  judge_id    uuid NOT NULL,                       -- auth.users id
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, judge_id)
);
CREATE INDEX IF NOT EXISTS fest_item_judges_judge_idx ON public.fest_item_judges (judge_id);

CREATE TABLE IF NOT EXISTS public.fest_scores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id       uuid NOT NULL REFERENCES public.fest_editions(id)     ON DELETE CASCADE,
  item_id          uuid NOT NULL REFERENCES public.fest_items(id)        ON DELETE CASCADE,
  registration_id  uuid NOT NULL REFERENCES public.fest_registrations(id) ON DELETE CASCADE,
  judge_id         uuid NOT NULL,                  -- auth.users id (= auth.uid())
  criteria         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { criterionKey: mark }
  total            numeric NOT NULL DEFAULT 0,     -- 0..100 aggregate of criteria
  remarks          text,
  submitted        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, registration_id, judge_id)
);
CREATE INDEX IF NOT EXISTS fest_scores_item_idx  ON public.fest_scores (item_id);
CREATE INDEX IF NOT EXISTS fest_scores_judge_idx ON public.fest_scores (judge_id);

DROP TRIGGER IF EXISTS fest_scores_set_updated_at ON public.fest_scores;
CREATE TRIGGER fest_scores_set_updated_at BEFORE UPDATE ON public.fest_scores
  FOR EACH ROW EXECUTE FUNCTION public.fest_set_updated_at();

CREATE TABLE IF NOT EXISTS public.fest_results (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id       uuid NOT NULL REFERENCES public.fest_editions(id)     ON DELETE CASCADE,
  item_id          uuid NOT NULL REFERENCES public.fest_items(id)        ON DELETE CASCADE,
  registration_id  uuid NOT NULL REFERENCES public.fest_registrations(id) ON DELETE CASCADE,
  avg_mark         numeric,
  grade            text,
  rank             int,
  points           numeric NOT NULL DEFAULT 0,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, registration_id)
);
CREATE INDEX IF NOT EXISTS fest_results_edition_idx ON public.fest_results (edition_id);

ALTER TABLE public.fest_items
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.fest_item_judges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_scores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_results     ENABLE ROW LEVEL SECURITY;

-- item_judges: staff manage; a judge can see their own assignments.
DROP POLICY IF EXISTS fest_item_judges_staff_write ON public.fest_item_judges;
DROP POLICY IF EXISTS fest_item_judges_staff_write ON public.fest_item_judges;
CREATE POLICY fest_item_judges_staff_write ON public.fest_item_judges
  FOR ALL TO authenticated
  USING (public.fest_is_staff()) WITH CHECK (public.fest_is_staff());
DROP POLICY IF EXISTS fest_item_judges_self_read ON public.fest_item_judges;
DROP POLICY IF EXISTS fest_item_judges_self_read ON public.fest_item_judges;
CREATE POLICY fest_item_judges_self_read ON public.fest_item_judges
  FOR SELECT TO authenticated
  USING (public.fest_is_staff() OR judge_id = auth.uid());

-- scores: a judge reads/writes ONLY their own rows, and only while the item is
-- unlocked and they're assigned. Staff read all (the reveal/oversight path).
DROP POLICY IF EXISTS fest_scores_select ON public.fest_scores;
DROP POLICY IF EXISTS fest_scores_select ON public.fest_scores;
CREATE POLICY fest_scores_select ON public.fest_scores
  FOR SELECT TO authenticated
  USING (public.fest_is_staff() OR judge_id = auth.uid());

DROP POLICY IF EXISTS fest_scores_judge_write ON public.fest_scores;
DROP POLICY IF EXISTS fest_scores_judge_write ON public.fest_scores;
CREATE POLICY fest_scores_judge_write ON public.fest_scores
  FOR ALL TO authenticated
  USING (
    public.fest_is_staff()
    OR (
      judge_id = auth.uid()
      AND EXISTS (SELECT 1 FROM public.fest_item_judges j
                  WHERE j.item_id = fest_scores.item_id AND j.judge_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.fest_items i
                  WHERE i.id = fest_scores.item_id AND i.locked_at IS NULL)
    )
  )
  WITH CHECK (
    public.fest_is_staff()
    OR (
      judge_id = auth.uid()
      AND EXISTS (SELECT 1 FROM public.fest_item_judges j
                  WHERE j.item_id = fest_scores.item_id AND j.judge_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.fest_items i
                  WHERE i.id = fest_scores.item_id AND i.locked_at IS NULL)
    )
  );

-- results: staff read always; public reads once the edition is published.
DROP POLICY IF EXISTS fest_results_read ON public.fest_results;
DROP POLICY IF EXISTS fest_results_read ON public.fest_results;
CREATE POLICY fest_results_read ON public.fest_results
  FOR SELECT TO anon, authenticated
  USING (
    public.fest_is_staff()
    OR EXISTS (SELECT 1 FROM public.fest_editions e
               WHERE e.id = fest_results.edition_id AND e.status = 'results_published')
  );
-- writes happen only through the SECURITY DEFINER recompute function below.
DROP POLICY IF EXISTS fest_results_staff_write ON public.fest_results;
DROP POLICY IF EXISTS fest_results_staff_write ON public.fest_results;
CREATE POLICY fest_results_staff_write ON public.fest_results
  FOR ALL TO authenticated
  USING (public.app_role() IN ('admin','accountant'))
  WITH CHECK (public.app_role() IN ('admin','accountant'));

-- ── Anonymized judge sheet: code numbers, never names ─────────────────────────
CREATE OR REPLACE FUNCTION public.fest_judge_sheet(p_item_id uuid)
RETURNS TABLE (registration_id uuid, code_no text, is_group boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    public.fest_is_staff()
    OR EXISTS (SELECT 1 FROM fest_item_judges j WHERE j.item_id = p_item_id AND j.judge_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'not authorized for this item';
  END IF;

  RETURN QUERY
    SELECT r.id, se.code_no, r.is_group
    FROM fest_registrations r
    JOIN fest_items i ON i.id = r.item_id
    LEFT JOIN fest_student_editions se
      ON se.edition_id = i.edition_id AND se.student_id = r.student_id
    WHERE r.item_id = p_item_id
    ORDER BY se.code_no NULLS LAST;
END $$;

-- ── Lock when every assigned judge has submitted every entry ──────────────────
CREATE OR REPLACE FUNCTION public.fest_lock_if_complete(p_item_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_judges int; n_entries int; n_done int;
BEGIN
  SELECT count(*) INTO n_judges  FROM fest_item_judges WHERE item_id = p_item_id;
  SELECT count(*) INTO n_entries FROM fest_registrations WHERE item_id = p_item_id;
  IF n_judges = 0 OR n_entries = 0 THEN RETURN false; END IF;

  SELECT count(*) INTO n_done
  FROM fest_scores WHERE item_id = p_item_id AND submitted;

  IF n_done >= n_judges * n_entries THEN
    UPDATE fest_items SET locked_at = now() WHERE id = p_item_id AND locked_at IS NULL;
    RETURN true;
  END IF;
  RETURN false;
END $$;

-- Admin-only unlock, audited.
CREATE OR REPLACE FUNCTION public.fest_unlock_item(p_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eid uuid;
BEGIN
  IF public.app_role() <> 'admin' THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT edition_id INTO eid FROM fest_items WHERE id = p_item_id;
  UPDATE fest_items SET locked_at = NULL WHERE id = p_item_id;
  INSERT INTO fest_audit_log(edition_id, actor, action, entity, entity_id)
  VALUES (eid, auth.uid(), 'unlock_item', 'fest_items', p_item_id::text);
END $$;

-- ── Recompute results for an edition (atomic) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fest_recompute_results(p_edition_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg jsonb;
  ta int; tb int; tc int;
  agg text;
  pa numeric; pb numeric; pc numeric; gmul numeric;
BEGIN
  IF NOT (public.app_role() IN ('admin','accountant')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT config INTO cfg FROM fest_editions WHERE id = p_edition_id;
  ta   := coalesce((cfg #>> '{grade_thresholds,A}')::int, 80);
  tb   := coalesce((cfg #>> '{grade_thresholds,B}')::int, 60);
  tc   := coalesce((cfg #>> '{grade_thresholds,C}')::int, 40);
  agg  := coalesce(cfg ->> 'aggregation', 'average');
  pa   := coalesce((cfg #>> '{points,individual,A}')::numeric, 5);
  pb   := coalesce((cfg #>> '{points,individual,B}')::numeric, 3);
  pc   := coalesce((cfg #>> '{points,individual,C}')::numeric, 1);
  gmul := coalesce((cfg #>> '{points,group_multiplier}')::numeric, 2);

  DELETE FROM fest_results WHERE edition_id = p_edition_id;

  INSERT INTO fest_results (edition_id, item_id, registration_id, avg_mark, grade, rank, points)
  WITH agg_marks AS (
    SELECT s.item_id, s.registration_id,
      CASE agg
        WHEN 'sum' THEN sum(s.total)
        WHEN 'drop_high_low' THEN
          CASE WHEN count(*) > 2
               THEN (sum(s.total) - max(s.total) - min(s.total)) / (count(*) - 2)
               ELSE avg(s.total) END
        ELSE avg(s.total)
      END AS mark
    FROM fest_scores s
    JOIN fest_items i ON i.id = s.item_id
    WHERE i.edition_id = p_edition_id AND s.submitted
    GROUP BY s.item_id, s.registration_id
  ),
  graded AS (
    SELECT am.*,
      CASE WHEN mark >= ta THEN 'A' WHEN mark >= tb THEN 'B'
           WHEN mark >= tc THEN 'C' ELSE '-' END AS grade
    FROM agg_marks am
  ),
  ranked AS (
    SELECT g.*, rank() OVER (PARTITION BY item_id ORDER BY mark DESC) AS rnk
    FROM graded g
  )
  SELECT p_edition_id, r.item_id, r.registration_id, round(r.mark, 2), r.grade, r.rnk::int,
    (CASE r.grade WHEN 'A' THEN pa WHEN 'B' THEN pb WHEN 'C' THEN pc ELSE 0 END)
      * (CASE WHEN it.type = 'group' THEN gmul ELSE 1 END)
  FROM ranked r
  JOIN fest_items it ON it.id = r.item_id;

  INSERT INTO fest_audit_log(edition_id, actor, action, entity, entity_id)
  VALUES (p_edition_id, auth.uid(), 'recompute_results', 'fest_editions', p_edition_id::text);
END $$;

GRANT EXECUTE ON FUNCTION public.fest_judge_sheet(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.fest_lock_if_complete(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.fest_unlock_item(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.fest_recompute_results(uuid)  TO authenticated;


-- ==================== migrations/20260623170000_meelad_fest_phase5_leaderboard.sql ====================
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 5: leaderboard aggregation                    ║
-- ║                                                                    ║
-- ║ fest_leaderboard(edition) rolls fest_results points up by house    ║
-- ║ AND by section (locked decision §14.2 = both) plus the top         ║
-- ║ individuals. Readable by staff always, and by anyone once the      ║
-- ║ edition is 'live' or 'results_published' (drives the public live    ║
-- ║ leaderboard + Stage Mode). SECURITY DEFINER so anon can read the    ║
-- ║ aggregate without exposing the underlying PII tables.              ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION public.fest_leaderboard(p_edition_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE st fest_edition_status; out jsonb;
BEGIN
  SELECT status INTO st FROM fest_editions WHERE id = p_edition_id;
  IF st IS NULL THEN RAISE EXCEPTION 'edition not found'; END IF;
  IF NOT (public.fest_is_staff() OR st IN ('live','results_published')) THEN
    RAISE EXCEPTION 'leaderboard not available yet';
  END IF;

  WITH res AS (
    SELECT r.points, r.rank, reg.student_id, se.house_id, se.section_id
    FROM fest_results r
    JOIN fest_registrations reg ON reg.id = r.registration_id
    LEFT JOIN fest_student_editions se
      ON se.edition_id = p_edition_id AND se.student_id = reg.student_id
    WHERE r.edition_id = p_edition_id
  )
  SELECT jsonb_build_object(
    'houses', (
      SELECT coalesce(jsonb_agg(h ORDER BY (h->>'points')::numeric DESC, h->>'name'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('id', ho.id, 'name', ho.name, 'color', ho.color,
                 'points', coalesce(sum(res.points), 0)) AS h
        FROM fest_houses ho
        LEFT JOIN res ON res.house_id = ho.id
        WHERE ho.edition_id = p_edition_id
        GROUP BY ho.id, ho.name, ho.color
      ) hx
    ),
    'sections', (
      SELECT coalesce(jsonb_agg(s ORDER BY (s->>'points')::numeric DESC, s->>'name'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('id', sec.id, 'name', sec.name,
                 'points', coalesce(sum(res.points), 0)) AS s
        FROM fest_sections sec
        JOIN res ON res.section_id = sec.id
        GROUP BY sec.id, sec.name
      ) sx
    ),
    'individuals', (
      SELECT coalesce(jsonb_agg(i ORDER BY (i->>'points')::numeric DESC, i->>'name'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('student_id', stu.id, 'name', stu.name,
                 'reg', stu.reg_no, 'points', sum(res.points)) AS i
        FROM res
        JOIN fest_students stu ON stu.id = res.student_id
        GROUP BY stu.id, stu.name, stu.reg_no
        ORDER BY sum(res.points) DESC
        LIMIT 20
      ) ix
    )
  ) INTO out;

  RETURN out;
END $$;

GRANT EXECUTE ON FUNCTION public.fest_leaderboard(uuid) TO anon, authenticated;


-- ==================== migrations/20260623180000_meelad_fest_phase6_certificates.sql ====================
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 6: certificates + QR verification             ║
-- ║                                                                    ║
-- ║ fest_certificates holds one row per issued certificate with a       ║
-- ║ random verification token printed (as a QR) on the PDF.            ║
-- ║ fest_verify_certificate(token) is a public SECURITY DEFINER RPC so  ║
-- ║ /verify/<token> can confirm authenticity without exposing the       ║
-- ║ underlying PII tables — and only once the edition is published.     ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.fest_certificates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id       uuid NOT NULL REFERENCES public.fest_editions(id)      ON DELETE CASCADE,
  registration_id  uuid NOT NULL REFERENCES public.fest_registrations(id) ON DELETE CASCADE,
  student_id       uuid REFERENCES public.fest_students(id) ON DELETE SET NULL,
  item_id          uuid REFERENCES public.fest_items(id)    ON DELETE SET NULL,
  type             text NOT NULL DEFAULT 'participation',   -- participation | winner | appreciation
  rank             int,
  grade            text,
  token            text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(9), 'hex'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_id, type)
);
CREATE INDEX IF NOT EXISTS fest_certificates_edition_idx ON public.fest_certificates (edition_id);

ALTER TABLE public.fest_certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fest_certificates_staff_all ON public.fest_certificates;
DROP POLICY IF EXISTS fest_certificates_staff_all ON public.fest_certificates;
CREATE POLICY fest_certificates_staff_all ON public.fest_certificates
  FOR ALL TO authenticated
  USING (public.fest_is_staff()) WITH CHECK (public.fest_is_staff());

-- Public certificate verification: returns the printable facts only, and only
-- when the edition has published results (otherwise reports invalid).
CREATE OR REPLACE FUNCTION public.fest_verify_certificate(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'valid', true,
    'student', stu.name,
    'reg', stu.reg_no,
    'item', it.name,
    'edition', ed.name,
    'theme', ed.theme,
    'type', c.type,
    'rank', c.rank,
    'grade', c.grade,
    'issued_at', c.created_at
  ) INTO out
  FROM fest_certificates c
  JOIN fest_editions ed ON ed.id = c.edition_id
  LEFT JOIN fest_students stu ON stu.id = c.student_id
  LEFT JOIN fest_items it ON it.id = c.item_id
  WHERE c.token = p_token
    AND (public.fest_is_staff() OR ed.status = 'results_published');

  RETURN coalesce(out, jsonb_build_object('valid', false));
END $$;

GRANT EXECUTE ON FUNCTION public.fest_verify_certificate(text) TO anon, authenticated;


-- ==================== migrations/20260623190000_meelad_fest_phase7_media_archive.sql ====================
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 7: media gallery + archive / Hall of Fame     ║
-- ║                                                                    ║
-- ║ • fest_media       — photos/videos/posters tagged by edition →     ║
-- ║                       event → category (public 'fest-media' bucket) ║
-- ║ • fest_hall_of_fame() — lifetime records across PUBLISHED editions  ║
-- ║ • fest_analytics()    — cross-edition counts for the archive charts ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.fest_media (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id    uuid NOT NULL REFERENCES public.fest_editions(id) ON DELETE CASCADE,
  item_id       uuid REFERENCES public.fest_items(id) ON DELETE SET NULL,
  category      text,                                  -- free tag (event/category)
  type          text NOT NULL DEFAULT 'photo',         -- photo | video | poster
  storage_path  text NOT NULL,                         -- path in the fest-media bucket
  caption       text,
  uploaded_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fest_media_edition_idx ON public.fest_media (edition_id);

ALTER TABLE public.fest_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fest_media_public_read ON public.fest_media;
DROP POLICY IF EXISTS fest_media_public_read ON public.fest_media;
CREATE POLICY fest_media_public_read ON public.fest_media
  FOR SELECT TO anon, authenticated
  USING (
    public.fest_is_staff()
    OR EXISTS (SELECT 1 FROM public.fest_editions e
               WHERE e.id = fest_media.edition_id AND e.status <> 'draft')
  );
DROP POLICY IF EXISTS fest_media_staff_write ON public.fest_media;
DROP POLICY IF EXISTS fest_media_staff_write ON public.fest_media;
CREATE POLICY fest_media_staff_write ON public.fest_media
  FOR ALL TO authenticated
  USING (public.fest_is_staff()) WITH CHECK (public.fest_is_staff());

-- Public media bucket (images displayed on the public site / yearbook).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('fest-media', 'fest-media', true, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 10485760;

DROP POLICY IF EXISTS "fest-media staff upload" ON storage.objects;
DROP POLICY IF EXISTS "fest-media staff upload" ON storage.objects;
CREATE POLICY "fest-media staff upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fest-media' AND public.fest_is_staff());
DROP POLICY IF EXISTS "fest-media public read" ON storage.objects;
DROP POLICY IF EXISTS "fest-media public read" ON storage.objects;
CREATE POLICY "fest-media public read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'fest-media');
DROP POLICY IF EXISTS "fest-media staff delete" ON storage.objects;
DROP POLICY IF EXISTS "fest-media staff delete" ON storage.objects;
CREATE POLICY "fest-media staff delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'fest-media' AND public.fest_is_staff());

-- ── Hall of Fame: lifetime records across all PUBLISHED editions ──────────────
CREATE OR REPLACE FUNCTION public.fest_hall_of_fame()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE out jsonb;
BEGIN
  WITH pub AS (SELECT id FROM fest_editions WHERE status = 'results_published'),
  res AS (
    SELECT r.points, r.rank, reg.student_id, it.name AS item_name, se.house_id, r.edition_id
    FROM fest_results r
    JOIN pub ON pub.id = r.edition_id
    JOIN fest_registrations reg ON reg.id = r.registration_id
    JOIN fest_items it ON it.id = r.item_id
    LEFT JOIN fest_student_editions se ON se.edition_id = r.edition_id AND se.student_id = reg.student_id
  )
  SELECT jsonb_build_object(
    'topPerformers', (
      SELECT coalesce(jsonb_agg(x ORDER BY (x->>'points')::numeric DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('name', stu.name, 'reg', stu.reg_no,
                 'points', sum(res.points), 'wins', count(*) FILTER (WHERE res.rank = 1)) AS x
        FROM res JOIN fest_students stu ON stu.id = res.student_id
        GROUP BY stu.id, stu.name, stu.reg_no
        ORDER BY sum(res.points) DESC LIMIT 10
      ) t
    ),
    'topReciter', (
      SELECT stu.name FROM res JOIN fest_students stu ON stu.id = res.student_id
      WHERE res.item_name ILIKE '%quran%' OR res.item_name ILIKE '%hifz%'
      GROUP BY stu.id, stu.name ORDER BY sum(res.points) DESC LIMIT 1
    ),
    'topSpeaker', (
      SELECT stu.name FROM res JOIN fest_students stu ON stu.id = res.student_id
      WHERE res.item_name ILIKE '%speech%'
      GROUP BY stu.id, stu.name ORDER BY sum(res.points) DESC LIMIT 1
    ),
    'bestHouses', (
      SELECT coalesce(jsonb_agg(y ORDER BY y->>'edition'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('edition', ed.name, 'house', ho.name,
                 'points', sum(res.points)) AS y
        FROM res
        JOIN fest_houses ho ON ho.id = res.house_id
        JOIN fest_editions ed ON ed.id = res.edition_id
        GROUP BY ed.id, ed.name, ho.id, ho.name
        ORDER BY ed.name, sum(res.points) DESC
      ) bh
    )
  ) INTO out;
  RETURN coalesce(out, '{}'::jsonb);
END $$;

-- ── Cross-edition analytics (counts per edition) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fest_analytics()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'name', e.name,
      'year', e.year,
      'students', (SELECT count(*) FROM fest_student_editions se WHERE se.edition_id = e.id),
      'items',    (SELECT count(*) FROM fest_items i WHERE i.edition_id = e.id),
      'registrations', (SELECT count(*) FROM fest_registrations r WHERE r.edition_id = e.id)
    ) AS x
    FROM fest_editions e
    WHERE e.status <> 'draft'
  ) z;
$$;

GRANT EXECUTE ON FUNCTION public.fest_hall_of_fame() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fest_analytics()    TO anon, authenticated;


-- ==================== migrations/20260623200000_meelad_fest_phase8_public.sql ====================
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 8: public results portal                      ║
-- ║                                                                    ║
-- ║ Anon can read fest_results, but NOT the PII tables it joins to, so  ║
-- ║ the public results portal goes through this SECURITY DEFINER RPC.   ║
-- ║ It returns each item's top-3 winners (name, rank, grade) only once  ║
-- ║ the edition is published.                                          ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION public.fest_public_results(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE eid uuid; st fest_edition_status; out jsonb;
BEGIN
  SELECT id, status INTO eid, st FROM fest_editions WHERE slug = p_slug;
  IF eid IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  IF st <> 'results_published' AND NOT public.fest_is_staff() THEN
    RETURN jsonb_build_object('found', true, 'published', false, 'items', '[]'::jsonb);
  END IF;

  SELECT jsonb_build_object(
    'found', true, 'published', true,
    'items', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'item')
      FROM (
        SELECT jsonb_build_object(
          'item', it.name,
          'type', it.type,
          'winners', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                     'rank', r.rank, 'grade', r.grade, 'name', stu.name)
                     ORDER BY r.rank), '[]'::jsonb)
            FROM fest_results r
            JOIN fest_registrations reg ON reg.id = r.registration_id
            LEFT JOIN fest_students stu ON stu.id = reg.student_id
            WHERE r.item_id = it.id AND r.rank <= 3
          )
        ) AS x
        FROM fest_items it
        WHERE it.edition_id = eid
          AND EXISTS (SELECT 1 FROM fest_results r WHERE r.item_id = it.id AND r.rank <= 3)
      ) y
    ), '[]'::jsonb)
  ) INTO out;

  RETURN out;
END $$;

GRANT EXECUTE ON FUNCTION public.fest_public_results(text) TO anon, authenticated;


-- ==================== migrations/20260624120000_meelad_fest_per_course.sql ====================
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — per-course editions                                  ║
-- ║                                                                    ║
-- ║ Each Ihlamudheen course runs its OWN Ihlamudheen Madrasa Meelad Fest. We add a      ║
-- ║ course_id dimension to fest_editions so every edition (and, by      ║
-- ║ extension, its houses / categories / items / students / results,    ║
-- ║ which all hang off edition_id) is isolated to a single course.      ║
-- ║                                                                    ║
-- ║ Courses are static app data (src/data/courses.ts), so the course    ║
-- ║ list is seeded here explicitly. The pre-existing generic            ║
-- ║ 'meelad-2026' edition is adopted as course 1 (Ihlamudheen Madrasa);   ║
-- ║ courses 2–4 get a fresh edition each with the default houses and     ║
-- ║ category bands. Idempotent — safe to re-run.                       ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── Schema ────────────────────────────────────────────────────────────────────
ALTER TABLE public.fest_editions
  ADD COLUMN IF NOT EXISTS course_id text;

CREATE INDEX IF NOT EXISTS fest_editions_course_idx ON public.fest_editions (course_id);

-- ── Adopt the existing generic edition as the course-1 fest ───────────────────
UPDATE public.fest_editions
   SET course_id = '1',
       name = 'Meelad 2026 — Ihlamudheen Madrasa'
 WHERE slug = 'meelad-2026'
   AND course_id IS NULL;

-- ── One edition per remaining course ──────────────────────────────────────────
INSERT INTO public.fest_editions (slug, name, theme, year, status, course_id, config)
SELECT
  c.slug, c.name, 'Ihlamudheen Madrasa Meelad Fest', 2026, 'draft', c.cid,
  jsonb_build_object(
    'caps',              jsonb_build_object('individual', 4, 'group', 2),
    'points_rollup',     'both',
    'official_champion', 'house',
    'judge_anonymize',   true,
    'grade_thresholds',  jsonb_build_object('A', 80, 'B', 60, 'C', 40),
    'points',            jsonb_build_object(
                           'individual', jsonb_build_object('A', 5, 'B', 3, 'C', 1),
                           'group_multiplier', 2),
    'aggregation',       'average',
    'tie_break',         'rank_then_grade_count'
  )
FROM (VALUES
  ('2', 'meelad-2026-c2', 'Meelad 2026 - Kammu Musliyar Memorial School')
) AS c(cid, slug, name)
ON CONFLICT (slug) DO NOTHING;

-- ── Default houses for every edition that has none ────────────────────────────
INSERT INTO public.fest_houses (edition_id, name, color, sort_order)
SELECT e.id, h.name, h.color, h.ord
FROM public.fest_editions e
CROSS JOIN (VALUES
  ('Green',  '#16a34a', 1),
  ('Blue',   '#2563eb', 2),
  ('Red',    '#dc2626', 3),
  ('Yellow', '#ca8a04', 4)
) AS h(name, color, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.fest_houses x WHERE x.edition_id = e.id)
ON CONFLICT (edition_id, name) DO NOTHING;

-- ── Default category bands for every edition that has none ─────────────────────
INSERT INTO public.fest_categories (edition_id, name, min_grade, max_grade, sort_order)
SELECT e.id, c.name, c.lo, c.hi, c.ord
FROM public.fest_editions e
CROSS JOIN (VALUES
  ('Sub-Junior',   1, 2, 1),
  ('Junior',       3, 4, 2),
  ('Senior',       5, 7, 3),
  ('Super-Senior', 8, 10, 4)
) AS c(name, lo, hi, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.fest_categories x WHERE x.edition_id = e.id)
ON CONFLICT (edition_id, name) DO NOTHING;


-- ==================== migrations/20260624140000_meelad_fest_academic_year.sql ====================
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — drive editions by academic year (auto-upgrade)       ║
-- ║                                                                    ║
-- ║ A fest "edition" is really just the course's fest for an academic   ║
-- ║ year. Rather than make staff manage editions by hand, we tag each    ║
-- ║ edition with academic_year and keep one edition per (course, year).  ║
-- ║ A trigger on app_settings.unlocked_academic_years auto-creates the   ║
-- ║ next year's fest for every course the moment the academic year is    ║
-- ║ unlocked — so the fest "upgrades" with the institute's year.        ║
-- ║                                                                    ║
-- ║ Idempotent — safe to re-run.                                        ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── Bootstrap app_settings if this DB doesn't have it yet ─────────────────────
-- The academic-year list lives in public.app_settings (a core Ihlamudheen table).
-- Some databases were set up without it, so create it here (canonical schema +
-- RLS) and seed the academic years before we depend on it.
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings' AND policyname = 'settings_select') THEN
    DROP POLICY IF EXISTS "settings_select" ON public.app_settings;
    CREATE POLICY "settings_select" ON public.app_settings
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings' AND policyname = 'settings_admin_write') THEN
    DROP POLICY IF EXISTS "settings_admin_write" ON public.app_settings;
    CREATE POLICY "settings_admin_write" ON public.app_settings
      FOR ALL TO authenticated
      USING   ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin')
      WITH CHECK ((coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role')) = 'admin');
  END IF;
END $$;

INSERT INTO public.app_settings (key, value)
VALUES ('unlocked_academic_years', '["2025-2026","2026-2027"]')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.fest_editions
  ADD COLUMN IF NOT EXISTS course_id text;
ALTER TABLE public.fest_editions
  ADD COLUMN IF NOT EXISTS academic_year text;

CREATE INDEX IF NOT EXISTS fest_editions_course_idx ON public.fest_editions (course_id);
CREATE INDEX IF NOT EXISTS fest_editions_ay_idx ON public.fest_editions (academic_year);

-- Backfill the editions seeded so far to the earliest unlocked academic year.
UPDATE public.fest_editions
   SET academic_year = COALESCE(
         (SELECT (value::jsonb ->> 0) FROM public.app_settings WHERE key = 'unlocked_academic_years'),
         '2025-2026')
 WHERE academic_year IS NULL;

-- ── Ensure one fest edition per course × per unlocked academic year ────────────
-- SECURITY DEFINER so it can write regardless of the caller's RLS (it is only
-- ever invoked by the settings trigger or a one-off admin call).
CREATE OR REPLACE FUNCTION public.fest_sync_course_editions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_years jsonb;
BEGIN
  SELECT COALESCE(value::jsonb, '["2025-2026","2026-2027"]'::jsonb)
    INTO v_years
    FROM public.app_settings
   WHERE key = 'unlocked_academic_years';
  IF v_years IS NULL THEN v_years := '["2025-2026","2026-2027"]'::jsonb; END IF;

  -- Editions: one per (course, year) that doesn't already exist.
  INSERT INTO public.fest_editions (slug, name, theme, year, status, course_id, academic_year, config)
  SELECT
    'meelad-' || y.ay || '-c' || c.cid,
    'Meelad ' || y.ay || ' — ' || c.cname,
    'Ihlamudheen Madrasa Meelad Fest',
    split_part(y.ay, '-', 1)::int,
    'draft', c.cid, y.ay,
    jsonb_build_object(
      'caps',              jsonb_build_object('individual', 4, 'group', 2),
      'points_rollup',     'both',
      'official_champion', 'house',
      'judge_anonymize',   true,
      'grade_thresholds',  jsonb_build_object('A', 80, 'B', 60, 'C', 40),
      'points',            jsonb_build_object(
                             'individual', jsonb_build_object('A', 5, 'B', 3, 'C', 1),
                             'group_multiplier', 2),
      'aggregation',       'average',
      'tie_break',         'rank_then_grade_count'
    )
  FROM (VALUES
    ('1', 'Ihlamudheen Madrasa'),
    ('2', 'Kammu Musliyar Memorial School')
  ) AS c(cid, cname)
  CROSS JOIN (SELECT jsonb_array_elements_text(v_years) AS ay) y
  WHERE NOT EXISTS (
    SELECT 1 FROM public.fest_editions e
    WHERE e.course_id = c.cid AND e.academic_year = y.ay
  )
  ON CONFLICT (slug) DO NOTHING;

  -- Default houses for any edition that has none.
  INSERT INTO public.fest_houses (edition_id, name, color, sort_order)
  SELECT e.id, h.name, h.color, h.ord
  FROM public.fest_editions e
  CROSS JOIN (VALUES
    ('Green', '#16a34a', 1), ('Blue', '#2563eb', 2),
    ('Red', '#dc2626', 3),   ('Yellow', '#ca8a04', 4)
  ) AS h(name, color, ord)
  WHERE NOT EXISTS (SELECT 1 FROM public.fest_houses x WHERE x.edition_id = e.id)
  ON CONFLICT (edition_id, name) DO NOTHING;

  -- Default category bands for any edition that has none.
  INSERT INTO public.fest_categories (edition_id, name, min_grade, max_grade, sort_order)
  SELECT e.id, c.name, c.lo, c.hi, c.ord
  FROM public.fest_editions e
  CROSS JOIN (VALUES
    ('Sub-Junior', 1, 2, 1), ('Junior', 3, 4, 2),
    ('Senior', 5, 7, 3),     ('Super-Senior', 8, 10, 4)
  ) AS c(name, lo, hi, ord)
  WHERE NOT EXISTS (SELECT 1 FROM public.fest_categories x WHERE x.edition_id = e.id)
  ON CONFLICT (edition_id, name) DO NOTHING;
END $$;

-- ── Trigger: re-sync whenever the unlocked academic years change ──────────────
CREATE OR REPLACE FUNCTION public.fest_settings_year_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.key = 'unlocked_academic_years' THEN
    PERFORM public.fest_sync_course_editions();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fest_sync_on_year_change ON public.app_settings;
CREATE TRIGGER fest_sync_on_year_change
  AFTER INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.fest_settings_year_trigger();

-- Seed current years now.
SELECT public.fest_sync_course_editions();


-- ==================== migrations/20260625120000_meelad_fest_single_current_year.sql ====================
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — single current academic year (2026-2027)             ║
-- ║                                                                    ║
-- ║ Splitting the fest across two unlocked years (2025-2026 +          ║
-- ║ 2026-2027) fragmented the roster. The institute runs ONE current   ║
-- ║ fest year. This:                                                   ║
-- ║   1. records the current fest year (fest_current_academic_year),    ║
-- ║   2. merges every course's editions into a single 2026-2027         ║
-- ║      edition (all students moved into it), pruning the rest,         ║
-- ║   3. makes the auto-sync create ONLY the current year going          ║
-- ║      forward, so changing the current year rolls the fest over.      ║
-- ║                                                                    ║
-- ║ The UI only permits data entry on the current year (frozen else).  ║
-- ║ Idempotent — safe to re-run.                                        ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── 1. Current fest year ──────────────────────────────────────────────────────
INSERT INTO public.app_settings (key, value)
VALUES ('fest_current_academic_year', '2026-2027')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ── 2. Merge each course's editions into one current-year keeper ──────────────
DO $$
DECLARE
  v_cur     text;
  v_course  text;
  v_keeper  uuid;
  v_src     uuid;
BEGIN
  SELECT value INTO v_cur FROM public.app_settings WHERE key = 'fest_current_academic_year';
  v_cur := COALESCE(v_cur, '2026-2027');

  FOR v_course IN
    SELECT DISTINCT course_id FROM public.fest_editions WHERE course_id IS NOT NULL
  LOOP
    -- Keeper = the course's edition with the most students (else the oldest).
    SELECT e.id INTO v_keeper
    FROM public.fest_editions e
    LEFT JOIN (
      SELECT edition_id, count(*) AS n FROM public.fest_student_editions GROUP BY edition_id
    ) se ON se.edition_id = e.id
    WHERE e.course_id = v_course
    ORDER BY COALESCE(se.n, 0) DESC, e.created_at ASC
    LIMIT 1;

    CONTINUE WHEN v_keeper IS NULL;

    -- Relabel the keeper to the current year.
    UPDATE public.fest_editions SET academic_year = v_cur WHERE id = v_keeper;

    -- Fold every other edition of this course into the keeper.
    FOR v_src IN
      SELECT id FROM public.fest_editions WHERE course_id = v_course AND id <> v_keeper
    LOOP
      -- Move students not already in the keeper. house/category/code are
      -- per-edition, so clear them (re-assigned in the UI; code re-minted there).
      UPDATE public.fest_student_editions se
         SET edition_id = v_keeper, house_id = NULL, category_id = NULL, code_no = NULL
       WHERE se.edition_id = v_src
         AND NOT EXISTS (
           SELECT 1 FROM public.fest_student_editions k
           WHERE k.edition_id = v_keeper AND k.student_id = se.student_id
         );

      -- Drop any remaining rows in the source (duplicates / leftover regs);
      -- deleting the edition then cascades its houses, categories and items.
      DELETE FROM public.fest_student_editions WHERE edition_id = v_src;
      DELETE FROM public.fest_editions WHERE id = v_src;
    END LOOP;
  END LOOP;
END $$;

-- ── 3. Auto-sync now ensures only the CURRENT year's editions ─────────────────
CREATE OR REPLACE FUNCTION public.fest_sync_course_editions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur text;
BEGIN
  SELECT value INTO v_cur FROM public.app_settings WHERE key = 'fest_current_academic_year';
  v_cur := COALESCE(v_cur, '2026-2027');

  INSERT INTO public.fest_editions (slug, name, theme, year, status, course_id, academic_year, config)
  SELECT
    'meelad-' || v_cur || '-c' || c.cid,
    'Meelad ' || v_cur || ' — ' || c.cname,
    'Ihlamudheen Madrasa Meelad Fest',
    split_part(v_cur, '-', 1)::int,
    'draft', c.cid, v_cur,
    jsonb_build_object(
      'caps',              jsonb_build_object('individual', 4, 'group', 2),
      'points_rollup',     'both',
      'official_champion', 'house',
      'judge_anonymize',   true,
      'grade_thresholds',  jsonb_build_object('A', 80, 'B', 60, 'C', 40),
      'points',            jsonb_build_object(
                             'individual', jsonb_build_object('A', 5, 'B', 3, 'C', 1),
                             'group_multiplier', 2),
      'aggregation',       'average',
      'tie_break',         'rank_then_grade_count'
    )
  FROM (VALUES
    ('1', 'Ihlamudheen Madrasa'),
    ('2', 'Kammu Musliyar Memorial School')
  ) AS c(cid, cname)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.fest_editions e
    WHERE e.course_id = c.cid AND e.academic_year = v_cur
  )
  ON CONFLICT (slug) DO NOTHING;

  INSERT INTO public.fest_houses (edition_id, name, color, sort_order)
  SELECT e.id, h.name, h.color, h.ord
  FROM public.fest_editions e
  CROSS JOIN (VALUES
    ('Green', '#16a34a', 1), ('Blue', '#2563eb', 2),
    ('Red', '#dc2626', 3),   ('Yellow', '#ca8a04', 4)
  ) AS h(name, color, ord)
  WHERE NOT EXISTS (SELECT 1 FROM public.fest_houses x WHERE x.edition_id = e.id)
  ON CONFLICT (edition_id, name) DO NOTHING;

  INSERT INTO public.fest_categories (edition_id, name, min_grade, max_grade, sort_order)
  SELECT e.id, c.name, c.lo, c.hi, c.ord
  FROM public.fest_editions e
  CROSS JOIN (VALUES
    ('Sub-Junior', 1, 2, 1), ('Junior', 3, 4, 2),
    ('Senior', 5, 7, 3),     ('Super-Senior', 8, 10, 4)
  ) AS c(name, lo, hi, ord)
  WHERE NOT EXISTS (SELECT 1 FROM public.fest_categories x WHERE x.edition_id = e.id)
  ON CONFLICT (edition_id, name) DO NOTHING;
END $$;

-- ── 4. Re-sync trigger also fires when the current fest year changes ──────────
CREATE OR REPLACE FUNCTION public.fest_settings_year_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.key IN ('unlocked_academic_years', 'fest_current_academic_year') THEN
    PERFORM public.fest_sync_course_editions();
  END IF;
  RETURN NEW;
END $$;

-- Ensure every course has its current-year edition.
SELECT public.fest_sync_course_editions();


-- ==================== migrations/20260625130000_meelad_fest_judge_show_names.sql ====================
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — judges see the student name + register number        ║
-- ║                                                                    ║
-- ║ The register number is now used as the entry "code", and judges     ║
-- ║ are allowed to see the participant's name. fest_judge_sheet()       ║
-- ║ therefore returns reg_no and student_name alongside the legacy      ║
-- ║ code_no (which may be null). Authorisation is unchanged: only        ║
-- ║ assigned judges (or staff) may read an item's sheet.                ║
-- ║                                                                    ║
-- ║ The return signature changes, so the function is dropped and        ║
-- ║ recreated. Idempotent.                                              ║
-- ╚══════════════════════════════════════════════════════════════════╝

DROP FUNCTION IF EXISTS public.fest_judge_sheet(uuid);

CREATE FUNCTION public.fest_judge_sheet(p_item_id uuid)
RETURNS TABLE (registration_id uuid, code_no text, reg_no text, student_name text, is_group boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    public.fest_is_staff()
    OR EXISTS (SELECT 1 FROM fest_item_judges j WHERE j.item_id = p_item_id AND j.judge_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'not authorized for this item';
  END IF;

  RETURN QUERY
    SELECT r.id, se.code_no, s.reg_no, s.name, r.is_group
    FROM fest_registrations r
    JOIN fest_items i ON i.id = r.item_id
    LEFT JOIN fest_student_editions se
      ON se.edition_id = i.edition_id AND se.student_id = r.student_id
    LEFT JOIN fest_students s ON s.id = r.student_id
    WHERE r.item_id = p_item_id
    ORDER BY s.reg_no NULLS LAST, se.code_no NULLS LAST;
END $$;

GRANT EXECUTE ON FUNCTION public.fest_judge_sheet(uuid) TO authenticated;


-- ==================== migrations/20260626000000_teacher_add_students.sql ====================
-- ══════════════════════════════════════════════════════════════════════
-- Teachers can now add students from the Teachers roster (course → class)
--
--   • ADD    (INSERT) a student → admin / accountant / teacher (was admin/accountant)
--   • REMOVE (DELETE) a student → admin / accountant only (unchanged)
--
-- Product decision: teachers should be able to onboard students into their
-- own class without going through an admin/accountant, but removing a
-- student (which also deletes attendance and grade history) stays
-- restricted. public.is_staff() already covers admin/teacher/accountant.
-- ══════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF to_regclass('public.students') IS NOT NULL THEN
    DROP POLICY IF EXISTS "students: admin/accountant insert" ON public.students;
    DROP POLICY IF EXISTS "students: staff insert" ON public.students;

    DROP POLICY IF EXISTS "students: staff insert" ON public.students;
    CREATE POLICY "students: staff insert" ON public.students
      FOR INSERT TO authenticated
      WITH CHECK (public.is_staff());
  END IF;
END $$;


-- ==================== migrations/20260628000000_office_daily_routine.sql ====================
-- ══════════════════════════════════════════════════════════════════════
-- Daily Office Routine
--
-- Office staff (role = accountant) submit one structured duty report per day;
-- admins review them. Covers: finance, per-course duty checklists (all four
-- courses incl. CIBIS), weekly reels + boost, attendance follow-up, assignment
-- follow-up, and a teacher-facing lesson-plan / PPT submission record.
--
-- Authorization source is app_metadata.role (public.app_role(), defined in
-- 20260603120000_security_rls_app_metadata.sql) — never user_metadata.
-- updated_at is bumped by public.set_updated_at() (20260516000000).
-- ══════════════════════════════════════════════════════════════════════

-- ── Parent: one report per office-staff member per day ─────────────────
CREATE TABLE IF NOT EXISTS public.office_daily_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_date  date NOT NULL,
  status       text NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'submitted', 'locked')),
  submitted_at timestamptz,
  locked_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, report_date)
);

-- ── Item 2: income & expenditure ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.office_finance_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid NOT NULL REFERENCES public.office_daily_reports(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('income', 'expense')),
  amount      numeric(12,2) NOT NULL DEFAULT 0,
  category    text,
  description text,
  remarks     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Items 3-5 + CIBIS: per-course duty checklist ──────────────────────
CREATE TABLE IF NOT EXISTS public.office_duty_checklist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id  uuid NOT NULL REFERENCES public.office_daily_reports(id) ON DELETE CASCADE,
  course_id  text NOT NULL,
  duty_label text NOT NULL,
  is_done    boolean NOT NULL DEFAULT false,
  remarks    text
);

-- ── Item 6: 3 reels per week ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.office_reels_checklist (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid NOT NULL REFERENCES public.office_daily_reports(id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  reel_number     int  NOT NULL CHECK (reel_number BETWEEN 1 AND 3),
  is_prepared     boolean NOT NULL DEFAULT false,
  notes           text
);

-- ── Item 7: 1 boosted reel per week + Instagram link ──────────────────
CREATE TABLE IF NOT EXISTS public.office_reel_boost (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid NOT NULL REFERENCES public.office_daily_reports(id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  is_boosted      boolean NOT NULL DEFAULT false,
  instagram_url   text
);

-- ── Item 8: late / absent follow-up (reason captured here, source row stays
--    authoritative & untouched) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.office_attendance_followup (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid NOT NULL REFERENCES public.office_daily_reports(id) ON DELETE CASCADE,
  class_id        text NOT NULL,
  late_students   jsonb NOT NULL DEFAULT '[]'::jsonb,
  absent_students jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- ── Item 11: teacher forwarded today's assignment? ────────────────────
CREATE TABLE IF NOT EXISTS public.office_assignment_followup (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id            uuid NOT NULL REFERENCES public.office_daily_reports(id) ON DELETE CASCADE,
  class_id             text NOT NULL,
  teacher_id           text,
  assignment_forwarded boolean NOT NULL DEFAULT false,
  remarks              text
);

-- ── Item 9: lesson-plan / PPT submission record (teacher-written) ──────
CREATE TABLE IF NOT EXISTS public.lesson_plan_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_code  text NOT NULL UNIQUE,
  teacher_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  teacher_name     text,
  teacher_email    text,
  course_id        text,
  class_id         text,
  grade            text,
  subject          text NOT NULL,
  week_date        date NOT NULL,
  lesson_plan_name text,
  lesson_plan_url  text,
  ppt_name         text,
  ppt_url          text,
  drive_folder_id  text,
  status           text NOT NULL DEFAULT 'submitted'
                   CHECK (status IN ('submitted', 'partial', 'failed')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes for the common lookups ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_office_reports_date     ON public.office_daily_reports (report_date);
CREATE INDEX IF NOT EXISTS idx_office_finance_report   ON public.office_finance_entries (report_id);
CREATE INDEX IF NOT EXISTS idx_office_duty_report      ON public.office_duty_checklist (report_id);
CREATE INDEX IF NOT EXISTS idx_office_reels_report     ON public.office_reels_checklist (report_id);
CREATE INDEX IF NOT EXISTS idx_office_boost_report     ON public.office_reel_boost (report_id);
CREATE INDEX IF NOT EXISTS idx_office_attend_report    ON public.office_attendance_followup (report_id);
CREATE INDEX IF NOT EXISTS idx_office_assign_report    ON public.office_assignment_followup (report_id);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_week       ON public.lesson_plan_submissions (week_date);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_class      ON public.lesson_plan_submissions (class_id);

-- ── updated_at trigger on the parent ──────────────────────────────────
DROP TRIGGER IF EXISTS trg_office_reports_updated_at ON public.office_daily_reports;
CREATE TRIGGER trg_office_reports_updated_at
  BEFORE UPDATE ON public.office_daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Immutability: a locked report can only be changed by an admin ─────
-- Mirrors the paid-row immutability convention used for monthly_salaries.
CREATE OR REPLACE FUNCTION public.office_report_guard_locked()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'locked' AND public.app_role() <> 'admin' THEN
    RAISE EXCEPTION 'This office report is locked and can only be edited by an admin.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_office_report_lock_guard ON public.office_daily_reports;
CREATE TRIGGER trg_office_report_lock_guard
  BEFORE UPDATE ON public.office_daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.office_report_guard_locked();

-- ══════════════════════════════════════════════════════════════════════
-- Row Level Security
--   • office reports + children : admin (all) / accountant (office staff)
--   • lesson-plan submissions   : admin / accountant / teacher
-- RLS is the real gate; middleware + UI guards are defense-in-depth.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.office_daily_reports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_finance_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_duty_checklist      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_reels_checklist     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_reel_boost          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_attendance_followup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_assignment_followup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_plan_submissions    ENABLE ROW LEVEL SECURITY;

-- Parent: office staff manage their own rows; admin manages all.
DROP POLICY IF EXISTS "office reports: read"   ON public.office_daily_reports;
DROP POLICY IF EXISTS "office reports: insert" ON public.office_daily_reports;
DROP POLICY IF EXISTS "office reports: update" ON public.office_daily_reports;
DROP POLICY IF EXISTS "office reports: delete" ON public.office_daily_reports;

DROP POLICY IF EXISTS "office reports: read" ON public.office_daily_reports;
CREATE POLICY "office reports: read" ON public.office_daily_reports
  FOR SELECT TO authenticated
  USING (public.app_role() IN ('admin', 'accountant'));

DROP POLICY IF EXISTS "office reports: insert" ON public.office_daily_reports;
CREATE POLICY "office reports: insert" ON public.office_daily_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_role() = 'admin'
    OR (public.app_role() = 'accountant' AND staff_id = auth.uid())
  );

DROP POLICY IF EXISTS "office reports: update" ON public.office_daily_reports;
CREATE POLICY "office reports: update" ON public.office_daily_reports
  FOR UPDATE TO authenticated
  USING (
    public.app_role() = 'admin'
    OR (public.app_role() = 'accountant' AND staff_id = auth.uid())
  )
  WITH CHECK (
    public.app_role() = 'admin'
    OR (public.app_role() = 'accountant' AND staff_id = auth.uid())
  );

DROP POLICY IF EXISTS "office reports: delete" ON public.office_daily_reports;
CREATE POLICY "office reports: delete" ON public.office_daily_reports
  FOR DELETE TO authenticated
  USING (public.app_role() = 'admin');

-- Child tables: gated through the office-staff role. (FK cascade ties the row
-- lifecycle to an accessible parent report.)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'office_finance_entries',
    'office_duty_checklist',
    'office_reels_checklist',
    'office_reel_boost',
    'office_attendance_followup',
    'office_assignment_followup'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "office child: all" ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY "office child: all" ON public.%I
        FOR ALL TO authenticated
        USING (public.app_role() IN ('admin', 'accountant'))
        WITH CHECK (public.app_role() IN ('admin', 'accountant'))
    $f$, t);
  END LOOP;
END $$;

-- Lesson-plan submissions: teachers create their own; staff read all.
DROP POLICY IF EXISTS "lesson plans: read"   ON public.lesson_plan_submissions;
DROP POLICY IF EXISTS "lesson plans: insert" ON public.lesson_plan_submissions;
DROP POLICY IF EXISTS "lesson plans: manage" ON public.lesson_plan_submissions;

DROP POLICY IF EXISTS "lesson plans: read" ON public.lesson_plan_submissions;
CREATE POLICY "lesson plans: read" ON public.lesson_plan_submissions
  FOR SELECT TO authenticated
  USING (public.app_role() IN ('admin', 'accountant', 'teacher'));

DROP POLICY IF EXISTS "lesson plans: insert" ON public.lesson_plan_submissions;
CREATE POLICY "lesson plans: insert" ON public.lesson_plan_submissions
  FOR INSERT TO authenticated
  WITH CHECK (public.app_role() IN ('admin', 'accountant', 'teacher'));

DROP POLICY IF EXISTS "lesson plans: manage" ON public.lesson_plan_submissions;
CREATE POLICY "lesson plans: manage" ON public.lesson_plan_submissions
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');


-- ==================== migrations/20260629000000_lesson_plans_storage.sql ====================
-- ══════════════════════════════════════════════════════════════════════
-- Lesson-plan / PPT uploads: direct-to-storage
--
-- Files are now uploaded by the browser straight to Supabase Storage (which
-- has no 4.5 MB serverless-request-body limit), then the server best-effort
-- mirrors them to Google Drive. Storage is the source of truth, so a teacher's
-- submission is always saved regardless of file size or Drive availability.
-- ══════════════════════════════════════════════════════════════════════

-- Private bucket; 100 MB per-file ceiling; common document/slide types.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lesson-plans',
  'lesson-plans',
  false,
  104857600,  -- 100 MB
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = 104857600,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Staff (admin/accountant/teacher) can upload; staff can read; admin manages.
DROP POLICY IF EXISTS "lesson_plans_staff_upload" ON storage.objects;
DROP POLICY IF EXISTS "lesson_plans_staff_read"   ON storage.objects;
DROP POLICY IF EXISTS "lesson_plans_admin_manage" ON storage.objects;

DROP POLICY IF EXISTS "lesson_plans_staff_upload" ON storage.objects;
CREATE POLICY "lesson_plans_staff_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lesson-plans' AND public.app_role() IN ('admin', 'accountant', 'teacher'));

DROP POLICY IF EXISTS "lesson_plans_staff_read" ON storage.objects;
CREATE POLICY "lesson_plans_staff_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'lesson-plans' AND public.app_role() IN ('admin', 'accountant', 'teacher'));

DROP POLICY IF EXISTS "lesson_plans_admin_manage" ON storage.objects;
CREATE POLICY "lesson_plans_admin_manage" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'lesson-plans' AND public.app_role() = 'admin')
  WITH CHECK (bucket_id = 'lesson-plans' AND public.app_role() = 'admin');

-- Keep the Supabase storage path alongside any Drive link, so the file stays
-- accessible even when Drive is unconfigured or its upload is skipped.
ALTER TABLE public.lesson_plan_submissions
  ADD COLUMN IF NOT EXISTS lesson_plan_path text,
  ADD COLUMN IF NOT EXISTS ppt_path text;


-- ==================== migrations/20260629100000_google_oauth_tokens.sql ====================
-- ══════════════════════════════════════════════════════════════════════
-- Google OAuth token storage (lesson-plan uploads "as the user")
--
-- A service account has no Drive storage of its own, so on a personal Google
-- account its uploads are rejected. Instead the institute connects their own
-- Google account once (OAuth consent); we store the refresh token here and the
-- server uploads as that user — files are owned by them and land in their Drive.
--
-- Single-row table. RLS is enabled with NO policies, so it is only reachable
-- via the service-role key (server-side). The refresh token is never exposed
-- to the browser.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.google_oauth_tokens (
  id            int PRIMARY KEY DEFAULT 1,
  refresh_token text,
  email         text,
  scope         text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_oauth_singleton CHECK (id = 1)
);

ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: only the service-role key (server) can read/write this table.


-- ==================== migrations/20260630120000_office_shared_finance_ledger.sql ====================
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
DROP POLICY IF EXISTS "office finance ledger: read" ON public.office_finance_ledger;
CREATE POLICY "office finance ledger: read" ON public.office_finance_ledger
  FOR SELECT TO authenticated
  USING (public.app_role() IN ('admin', 'accountant'));

-- Insert: admin + accountant, and the row must be attributed to the inserter.
DROP POLICY IF EXISTS "office finance ledger: insert" ON public.office_finance_ledger;
CREATE POLICY "office finance ledger: insert" ON public.office_finance_ledger
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_role() IN ('admin', 'accountant') AND created_by = auth.uid()
  );

-- Update / delete: an entry's own author, or any admin.
DROP POLICY IF EXISTS "office finance ledger: update" ON public.office_finance_ledger;
CREATE POLICY "office finance ledger: update" ON public.office_finance_ledger
  FOR UPDATE TO authenticated
  USING (public.app_role() = 'admin' OR created_by = auth.uid())
  WITH CHECK (public.app_role() = 'admin' OR created_by = auth.uid());

DROP POLICY IF EXISTS "office finance ledger: delete" ON public.office_finance_ledger;
CREATE POLICY "office finance ledger: delete" ON public.office_finance_ledger
  FOR DELETE TO authenticated
  USING (public.app_role() = 'admin' OR created_by = auth.uid());


-- ==================== migrations/20260630130000_office_finance_ledger_repair_policies.sql ====================
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
  DROP POLICY IF EXISTS "office finance ledger: read" ON public.office_finance_ledger;
  CREATE POLICY "office finance ledger: read" ON public.office_finance_ledger
    FOR SELECT TO authenticated
    USING (public.app_role() IN ('admin', 'accountant'));

  -- Insert: admin + accountant, and the row must be attributed to the inserter.
  DROP POLICY IF EXISTS "office finance ledger: insert" ON public.office_finance_ledger;
  CREATE POLICY "office finance ledger: insert" ON public.office_finance_ledger
    FOR INSERT TO authenticated
    WITH CHECK (
      public.app_role() IN ('admin', 'accountant') AND created_by = auth.uid()
    );

  -- Update / delete: an entry's own author, or any admin.
  DROP POLICY IF EXISTS "office finance ledger: update" ON public.office_finance_ledger;
  CREATE POLICY "office finance ledger: update" ON public.office_finance_ledger
    FOR UPDATE TO authenticated
    USING (public.app_role() = 'admin' OR created_by = auth.uid())
    WITH CHECK (public.app_role() = 'admin' OR created_by = auth.uid());

  DROP POLICY IF EXISTS "office finance ledger: delete" ON public.office_finance_ledger;
  CREATE POLICY "office finance ledger: delete" ON public.office_finance_ledger
    FOR DELETE TO authenticated
    USING (public.app_role() = 'admin' OR created_by = auth.uid());
END $$;


-- ==================== migrations/20260701120000_fest_rename.sql ====================
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ Ihlamudheen Madrasa Fest — rebrand from "Meelad Fest" to "Ihlamudheen Madrasa Fest"    ║
-- ║                                                                    ║
-- ║ The fest is now called "Ihlamudheen Madrasa Fest" everywhere it is shown.    ║
-- ║ This relabels the user-facing strings stored in the DB:            ║
-- ║   • edition.theme  (rendered as the public hero tagline, on         ║
-- ║     certificates, and in the yearbook)                              ║
-- ║   • edition.name   ("Meelad <year> …" → "Ihlamudheen Madrasa Fest <year> …")  ║
-- ║ and re-points the auto-sync function so future per-course editions  ║
-- ║ carry the new brand. Edition SLUGS are deliberately left unchanged  ║
-- ║ ('meelad-…') so existing public URLs and printed QR passports keep  ║
-- ║ resolving. Idempotent — safe to re-run.                             ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── 1. Relabel existing editions ──────────────────────────────────────────────
UPDATE public.fest_editions
   SET theme = 'Ihlamudheen Madrasa Fest'
 WHERE theme = 'Ihlamudheen Madrasa Meelad Fest';

UPDATE public.fest_editions
   SET name = regexp_replace(name, '^Meelad ', 'Ihlamudheen Madrasa Fest ')
 WHERE name LIKE 'Meelad %';

-- ── 2. Re-point the auto-sync so new per-course editions use the new brand ────
CREATE OR REPLACE FUNCTION public.fest_sync_course_editions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur text;
BEGIN
  SELECT value INTO v_cur FROM public.app_settings WHERE key = 'fest_current_academic_year';
  v_cur := COALESCE(v_cur, '2026-2027');

  INSERT INTO public.fest_editions (slug, name, theme, year, status, course_id, academic_year, config)
  SELECT
    'meelad-' || v_cur || '-c' || c.cid,      -- slug unchanged (URL/QR stability)
    'Ihlamudheen Madrasa Fest ' || v_cur || ' — ' || c.cname,
    'Ihlamudheen Madrasa Fest',
    split_part(v_cur, '-', 1)::int,
    'draft', c.cid, v_cur,
    jsonb_build_object(
      'caps',              jsonb_build_object('individual', 4, 'group', 2),
      'points_rollup',     'both',
      'official_champion', 'house',
      'judge_anonymize',   true,
      'grade_thresholds',  jsonb_build_object('A', 80, 'B', 60, 'C', 40),
      'points',            jsonb_build_object(
                             'individual', jsonb_build_object('A', 5, 'B', 3, 'C', 1),
                             'group_multiplier', 2),
      'aggregation',       'average',
      'tie_break',         'rank_then_grade_count'
    )
  FROM (VALUES
    ('1', 'Ihlamudheen Madrasa'),
    ('2', 'Kammu Musliyar Memorial School')
  ) AS c(cid, cname)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.fest_editions e
    WHERE e.course_id = c.cid AND e.academic_year = v_cur
  )
  ON CONFLICT (slug) DO NOTHING;

  INSERT INTO public.fest_houses (edition_id, name, color, sort_order)
  SELECT e.id, h.name, h.color, h.ord
  FROM public.fest_editions e
  CROSS JOIN (VALUES
    ('Green', '#16a34a', 1), ('Blue', '#2563eb', 2),
    ('Red', '#dc2626', 3),   ('Yellow', '#ca8a04', 4)
  ) AS h(name, color, ord)
  WHERE NOT EXISTS (SELECT 1 FROM public.fest_houses x WHERE x.edition_id = e.id)
  ON CONFLICT (edition_id, name) DO NOTHING;

  INSERT INTO public.fest_categories (edition_id, name, min_grade, max_grade, sort_order)
  SELECT e.id, c.name, c.lo, c.hi, c.ord
  FROM public.fest_editions e
  CROSS JOIN (VALUES
    ('Sub-Junior', 1, 2, 1), ('Junior', 3, 4, 2),
    ('Senior', 5, 7, 3),     ('Super-Senior', 8, 10, 4)
  ) AS c(name, lo, hi, ord)
  WHERE NOT EXISTS (SELECT 1 FROM public.fest_categories x WHERE x.edition_id = e.id)
  ON CONFLICT (edition_id, name) DO NOTHING;
END $$;


-- ==================== migrations/20260707000000_online_self_checkin.sql ====================
-- Online self check-in (July/August 2026 online months)
-- Run BY HAND in the Supabase SQL editor (project convention — migrations are
-- never auto-applied).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. MANDATORY PRE-CHECK — review the output BEFORE deploying the payroll
--    change that pays session_type='online' rows at 40 AED/session.
--    If this returns rows, they were written by the old self-report flow and
--    would retroactively recalculate at the online rate in live reports.
SELECT count(*) AS historical_online_rows, min(date) AS first, max(date) AS last
FROM public.staff_attendance
WHERE session_type = 'online' AND date < '2026-07-01';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Verification columns. NULL verified_by = unverified; only meaningful for
--    session_type='online' rows (device punches need no verification).
ALTER TABLE public.staff_attendance ADD COLUMN IF NOT EXISTS verified_by TEXT;
ALTER TABLE public.staff_attendance ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. ONLY IF the pre-check in step 1 found rows AND admin confirms those
--    sessions were actually taught offline at the 60 AED rate, neutralize them
--    so the new online rate cannot retroactively change past payroll:
-- UPDATE public.staff_attendance SET session_type = 'offline'
--   WHERE session_type = 'online' AND date < '2026-07-01';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Month gating seed — which months the online self check-in is active.
--    Admin can edit this later from the Staff Attendance page.
INSERT INTO public.app_settings (key, value)
VALUES ('online_checkin_months', '["2026-07","2026-08"]')
ON CONFLICT (key) DO NOTHING;


-- ==================== migrations/20260708000000_session_proofs.sql ====================
-- ══════════════════════════════════════════════════════════════════════
-- Session proofs for the July/August ONLINE months
--
-- A self check-in tap alone cannot show that a Google Meet class was
-- actually conducted. Teachers now attach evidence to each checked-in
-- session — a screenshot of the Meet participant grid and/or the Meet
-- link — and the admin verify dialog shows that evidence next to the
-- IN/OUT times before the day is verified.
--
-- Run BY HAND in the Supabase SQL editor (project convention — migrations
-- are never auto-applied).
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. Private storage bucket for proof screenshots ─────────────────────
-- Client compresses screenshots before upload; 5 MB is a hard ceiling.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'session-proofs',
  'session-proofs',
  false,
  5242880,  -- 5 MB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = 5242880,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "session_proofs_staff_upload" ON storage.objects;
DROP POLICY IF EXISTS "session_proofs_staff_read"   ON storage.objects;
DROP POLICY IF EXISTS "session_proofs_admin_manage" ON storage.objects;

-- Staff upload straight from the browser (bypasses the serverless body
-- limit, same pattern as lesson-plans); staff read via signed URLs.
DROP POLICY IF EXISTS "session_proofs_staff_upload" ON storage.objects;
CREATE POLICY "session_proofs_staff_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'session-proofs' AND public.app_role() IN ('admin', 'accountant', 'teacher'));

DROP POLICY IF EXISTS "session_proofs_staff_read" ON storage.objects;
CREATE POLICY "session_proofs_staff_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'session-proofs' AND public.app_role() IN ('admin', 'accountant', 'teacher'));

DROP POLICY IF EXISTS "session_proofs_admin_manage" ON storage.objects;
CREATE POLICY "session_proofs_admin_manage" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'session-proofs' AND public.app_role() = 'admin')
  WITH CHECK (bucket_id = 'session-proofs' AND public.app_role() = 'admin');

-- ── 2. Proof metadata table ─────────────────────────────────────────────
-- Keyed by (teacher_id, date, session) — the same natural key the admin
-- override/verify flow uses — so a proof survives admin time corrections.
-- Multiple proofs per session are allowed (e.g. start + end screenshots).
CREATE TABLE IF NOT EXISTS public.session_proofs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id       text NOT NULL,
  date             date NOT NULL,
  session          text NOT NULL CHECK (session IN ('morning','afternoon','full','evening','edu-makeup','cibis')),
  storage_path     text,      -- object in the session-proofs bucket
  meet_link        text,      -- Google Meet / recording URL
  note             text,      -- free-text remark ("covered lesson 4", ...)
  class_label      text,      -- which course/class was taught
  students_present integer CHECK (students_present IS NULL OR (students_present >= 0 AND students_present <= 500)),
  uploaded_by      text NOT NULL,                    -- uploader's email
  created_at       timestamptz NOT NULL DEFAULT now(), -- server-set; late uploads stay visible
  -- A proof must carry actual evidence, not just a note.
  CONSTRAINT session_proofs_has_evidence CHECK (storage_path IS NOT NULL OR meet_link IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS session_proofs_teacher_date_idx
  ON public.session_proofs (teacher_id, date);
CREATE INDEX IF NOT EXISTS session_proofs_date_idx
  ON public.session_proofs (date);

-- ── 3. RLS: staff read; ALL writes go through the service-role API route
--        (/api/session-proofs) which enforces ownership + record matching.
ALTER TABLE public.session_proofs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_proofs_staff_select" ON public.session_proofs;
DROP POLICY IF EXISTS "session_proofs_staff_select" ON public.session_proofs;
CREATE POLICY "session_proofs_staff_select" ON public.session_proofs FOR SELECT TO authenticated
  USING (public.app_role() IN ('admin', 'accountant', 'teacher'));
-- No INSERT/UPDATE/DELETE policies on purpose: only the service role writes.


-- ==================== migrations/20260708150000_session_proofs_drive_link.sql ====================
-- Google Drive mirror for online-class session proofs.
-- Run BY HAND in the Supabase SQL editor (project convention).
--
-- When a teacher attaches a class proof, the server now also copies the
-- screenshot into the institute Drive (same root as lesson plans / PPTs)
-- under:  Online Class Proof / <Grade-Division> / <file>
-- This column stores the resulting Drive webViewLink (NULL = not mirrored,
-- e.g. Drive not configured or the upload predates this feature).

ALTER TABLE public.session_proofs ADD COLUMN IF NOT EXISTS drive_link TEXT;

