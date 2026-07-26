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
