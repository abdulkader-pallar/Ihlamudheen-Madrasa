-- ══════════════════════════════════════════════════════════════════════
-- Ihlamudheen Security — Part B: apply tightened RLS policies
-- Run AFTER Part A succeeded.
-- Run each numbered block ONE AT A TIME. Skip the block entirely if
-- the Supabase SQL editor says the table doesn't exist.
-- ══════════════════════════════════════════════════════════════════════

-- ─── 1. classes ───
DROP POLICY IF EXISTS "Admins and teachers can manage classes" ON public.classes;
DROP POLICY IF EXISTS "classes: staff manage" ON public.classes;
CREATE POLICY "classes: staff manage" ON public.classes
  FOR ALL TO authenticated USING (public.is_teacher_or_admin()) WITH CHECK (public.is_teacher_or_admin());

-- ─── 2. students ───
DROP POLICY IF EXISTS "Admins and teachers can manage students" ON public.students;
DROP POLICY IF EXISTS "students: staff manage" ON public.students;
CREATE POLICY "students: staff manage" ON public.students
  FOR ALL TO authenticated USING (public.is_teacher_or_admin()) WITH CHECK (public.is_teacher_or_admin());

-- ─── 3. attendance ───
DROP POLICY IF EXISTS "Admins and teachers can manage attendance" ON public.attendance;
DROP POLICY IF EXISTS "attendance: staff manage" ON public.attendance;
CREATE POLICY "attendance: staff manage" ON public.attendance
  FOR ALL TO authenticated USING (public.is_teacher_or_admin()) WITH CHECK (public.is_teacher_or_admin());

-- ─── 4. exams ───
DROP POLICY IF EXISTS "Admins and teachers can manage exams" ON public.exams;
DROP POLICY IF EXISTS "exams: staff manage" ON public.exams;
CREATE POLICY "exams: staff manage" ON public.exams
  FOR ALL TO authenticated USING (public.is_teacher_or_admin()) WITH CHECK (public.is_teacher_or_admin());

-- ─── 5. exam_subjects ───
DROP POLICY IF EXISTS "Admins and teachers can manage exam subjects" ON public.exam_subjects;
DROP POLICY IF EXISTS "exam_subjects: staff manage" ON public.exam_subjects;
CREATE POLICY "exam_subjects: staff manage" ON public.exam_subjects
  FOR ALL TO authenticated USING (public.is_teacher_or_admin()) WITH CHECK (public.is_teacher_or_admin());

-- ─── 6. exam_scores ───
DROP POLICY IF EXISTS "Admins and teachers can manage exam scores" ON public.exam_scores;
DROP POLICY IF EXISTS "exam_scores: staff manage" ON public.exam_scores;
CREATE POLICY "exam_scores: staff manage" ON public.exam_scores
  FOR ALL TO authenticated USING (public.is_teacher_or_admin()) WITH CHECK (public.is_teacher_or_admin());

-- ─── 7. teachers  (SKIP if table doesn't exist) ───
DROP POLICY IF EXISTS "Admins can manage teachers" ON public.teachers;
DROP POLICY IF EXISTS "teachers: admin manage" ON public.teachers;
CREATE POLICY "teachers: admin manage" ON public.teachers
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ─── 8. teacher_assignments  (SKIP if table doesn't exist) ───
DROP POLICY IF EXISTS "Admins can manage assignments" ON public.teacher_assignments;
DROP POLICY IF EXISTS "teacher_assignments: admin manage" ON public.teacher_assignments;
CREATE POLICY "teacher_assignments: admin manage" ON public.teacher_assignments
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ─── 9. staff_attendance  (SKIP if table doesn't exist) ───
DROP POLICY IF EXISTS "Admin and accountant can manage staff attendance" ON public.staff_attendance;
DROP POLICY IF EXISTS "Anyone authenticated can read staff attendance"    ON public.staff_attendance;
DROP POLICY IF EXISTS "Authenticated users can read staff attendance"     ON public.staff_attendance;
DROP POLICY IF EXISTS "Authenticated users can upsert staff attendance"   ON public.staff_attendance;
DROP POLICY IF EXISTS "Authenticated users can update staff attendance"   ON public.staff_attendance;
DROP POLICY IF EXISTS "staff_attendance: staff read" ON public.staff_attendance;
DROP POLICY IF EXISTS "staff_attendance: admin/accountant write" ON public.staff_attendance;
CREATE POLICY "staff_attendance: staff read" ON public.staff_attendance
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "staff_attendance: admin/accountant write" ON public.staff_attendance
  FOR ALL TO authenticated USING (public.is_admin_or_accountant()) WITH CHECK (public.is_admin_or_accountant());

-- ─── 10. payments  (SKIP if table doesn't exist) ───
DROP POLICY IF EXISTS "Admin and accountant can read payments"   ON public.payments;
DROP POLICY IF EXISTS "Admin and accountant can manage payments" ON public.payments;
DROP POLICY IF EXISTS "Authenticated users can read payments"    ON public.payments;
DROP POLICY IF EXISTS "Authenticated users can insert payments"  ON public.payments;
DROP POLICY IF EXISTS "Authenticated users can update payments"  ON public.payments;
DROP POLICY IF EXISTS "payments: admin/accountant read"  ON public.payments;
DROP POLICY IF EXISTS "payments: admin/accountant write" ON public.payments;
CREATE POLICY "payments: admin/accountant read" ON public.payments
  FOR SELECT TO authenticated USING (public.is_admin_or_accountant());
CREATE POLICY "payments: admin/accountant write" ON public.payments
  FOR ALL TO authenticated USING (public.is_admin_or_accountant()) WITH CHECK (public.is_admin_or_accountant());

-- ─── 11. staff_attendance_requests  (SKIP if table doesn't exist) ───
DROP POLICY IF EXISTS "Teachers can submit own requests"   ON public.staff_attendance_requests;
DROP POLICY IF EXISTS "Teachers can view own requests"     ON public.staff_attendance_requests;
DROP POLICY IF EXISTS "Admins can update requests"         ON public.staff_attendance_requests;
DROP POLICY IF EXISTS "Authenticated can insert requests"  ON public.staff_attendance_requests;
DROP POLICY IF EXISTS "Authenticated can read requests"    ON public.staff_attendance_requests;
DROP POLICY IF EXISTS "Authenticated can update requests"  ON public.staff_attendance_requests;
DROP POLICY IF EXISTS "staff_req: staff insert" ON public.staff_attendance_requests;
DROP POLICY IF EXISTS "staff_req: staff read"   ON public.staff_attendance_requests;
DROP POLICY IF EXISTS "staff_req: admin update" ON public.staff_attendance_requests;
CREATE POLICY "staff_req: staff insert" ON public.staff_attendance_requests
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());
CREATE POLICY "staff_req: staff read" ON public.staff_attendance_requests
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "staff_req: admin update" ON public.staff_attendance_requests
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ─── 12. lms_notes  (SKIP if table doesn't exist) ───
DROP POLICY IF EXISTS "Authenticated users can insert notes" ON public.lms_notes;
DROP POLICY IF EXISTS "Authenticated users can delete notes" ON public.lms_notes;
DROP POLICY IF EXISTS "Authenticated users can update notes" ON public.lms_notes;
DROP POLICY IF EXISTS "lms_notes: staff insert" ON public.lms_notes;
DROP POLICY IF EXISTS "lms_notes: staff update" ON public.lms_notes;
DROP POLICY IF EXISTS "lms_notes: staff delete" ON public.lms_notes;
CREATE POLICY "lms_notes: staff insert" ON public.lms_notes
  FOR INSERT TO authenticated WITH CHECK (public.is_teacher_or_admin());
CREATE POLICY "lms_notes: staff update" ON public.lms_notes
  FOR UPDATE TO authenticated USING (public.is_teacher_or_admin()) WITH CHECK (public.is_teacher_or_admin());
CREATE POLICY "lms_notes: staff delete" ON public.lms_notes
  FOR DELETE TO authenticated USING (public.is_teacher_or_admin());

-- ─── 13. assessments  (SKIP if table doesn't exist) ───
DROP POLICY IF EXISTS "Authenticated users can insert assessments" ON public.assessments;
DROP POLICY IF EXISTS "Authenticated users can update assessments" ON public.assessments;
DROP POLICY IF EXISTS "Authenticated users can delete assessments" ON public.assessments;
DROP POLICY IF EXISTS "assessments: staff insert" ON public.assessments;
DROP POLICY IF EXISTS "assessments: staff update" ON public.assessments;
DROP POLICY IF EXISTS "assessments: staff delete" ON public.assessments;
CREATE POLICY "assessments: staff insert" ON public.assessments
  FOR INSERT TO authenticated WITH CHECK (public.is_teacher_or_admin());
CREATE POLICY "assessments: staff update" ON public.assessments
  FOR UPDATE TO authenticated USING (public.is_teacher_or_admin()) WITH CHECK (public.is_teacher_or_admin());
CREATE POLICY "assessments: staff delete" ON public.assessments
  FOR DELETE TO authenticated USING (public.is_teacher_or_admin());
