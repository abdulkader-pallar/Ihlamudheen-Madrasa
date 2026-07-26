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

CREATE POLICY "office reports: read" ON public.office_daily_reports
  FOR SELECT TO authenticated
  USING (public.app_role() IN ('admin', 'accountant'));

CREATE POLICY "office reports: insert" ON public.office_daily_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_role() = 'admin'
    OR (public.app_role() = 'accountant' AND staff_id = auth.uid())
  );

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

CREATE POLICY "lesson plans: read" ON public.lesson_plan_submissions
  FOR SELECT TO authenticated
  USING (public.app_role() IN ('admin', 'accountant', 'teacher'));

CREATE POLICY "lesson plans: insert" ON public.lesson_plan_submissions
  FOR INSERT TO authenticated
  WITH CHECK (public.app_role() IN ('admin', 'accountant', 'teacher'));

CREATE POLICY "lesson plans: manage" ON public.lesson_plan_submissions
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');
