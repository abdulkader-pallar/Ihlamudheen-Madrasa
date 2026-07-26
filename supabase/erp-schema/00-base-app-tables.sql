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
CREATE POLICY "Anyone authenticated can read classes" ON public.classes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and teachers can manage classes" ON public.classes FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'teacher')
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

CREATE INDEX idx_students_class ON public.students(class_id);

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read students" ON public.students FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and teachers can manage students" ON public.students FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'teacher')
  );

-- 3. ATTENDANCE table (one row per student per date)
CREATE TABLE IF NOT EXISTS public.attendance (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(class_id, student_id, date)
);

CREATE INDEX idx_attendance_class_date ON public.attendance(class_id, date);
CREATE INDEX idx_attendance_student ON public.attendance(student_id);

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read attendance" ON public.attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and teachers can manage attendance" ON public.attendance FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'teacher')
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

CREATE INDEX idx_exams_class ON public.exams(class_id);

ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read exams" ON public.exams FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and teachers can manage exams" ON public.exams FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'teacher')
  );

-- 5. EXAM_SUBJECTS table (subjects per exam)
CREATE TABLE IF NOT EXISTS public.exam_subjects (
  id TEXT PRIMARY KEY,
  exam_id BIGINT NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  max_score NUMERIC NOT NULL DEFAULT 50
);

CREATE INDEX idx_exam_subjects_exam ON public.exam_subjects(exam_id);

ALTER TABLE public.exam_subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read exam subjects" ON public.exam_subjects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and teachers can manage exam subjects" ON public.exam_subjects FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'teacher')
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

CREATE INDEX idx_exam_scores_exam ON public.exam_scores(exam_id);
CREATE INDEX idx_exam_scores_student ON public.exam_scores(student_id);

ALTER TABLE public.exam_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can read exam scores" ON public.exam_scores FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and teachers can manage exam scores" ON public.exam_scores FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('admin', 'teacher')
  );

