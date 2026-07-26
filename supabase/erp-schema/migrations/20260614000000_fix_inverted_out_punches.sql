-- Fix Ihlamudheen OUT-window punches that were stored as an arrival (IN) instead of
-- a departure (OUT).
--
-- BACKGROUND
-- Before commit c9da74c, a Ihlamudheen Madrasa punch in the 11:31–16:00 OUT window
-- with no prior morning record was stored via createMadrasaAfternoonArrival with
-- the "no-prior-IN" variant:
--     arrival_time   = punchTime  (e.g. "13:35")  ← wrong: this is a punch-OUT
--     departure_time = NULL
--     out_missing    = true
--     sessions_credited = 1
-- So an afternoon punch-out (e.g. a staff member at 1:35 PM) showed up as a
-- punch-IN with a missing OUT.
--
-- These records carry the remark suffix "(afternoon-only punch, no prior IN)".
--
-- This migration converts them to departure-only records, matching the new
-- route-handler behaviour:
--     arrival_time   = NULL                 (with a red "No IN" flag in the UI)
--     departure_time = <old arrival_time>   (the real punch-out time)
--     out_missing    = false
--
-- SESSIONS RULE: a missed morning IN means the morning session is unverified,
-- so only 1 session is credited (no early-departure flag) — EXCEPT teachers
-- with transport allowance (TA), who keep the full-day credit:
--     non-TA teacher              → 1 session, no early-departure flag
--     TA teacher, OUT 13:00–13:39 → 2 sessions, early-departure Cat-1
--     TA teacher, OUT 13:40+      → 2 sessions, on-time
-- TA teachers (from initialTeachers in src/data/courses.ts): t17, t18, t33, t34.
--
-- SAFETY
--   • Only rows whose remark matches the exact old code path are touched.
--   • departure_time IS NULL guard skips any record that already received a
--     second punch (a legitimate IN→OUT pair must not be altered).
--   • All SET expressions read the row's pre-update values, so swapping
--     arrival_time → departure_time in one statement is safe.
--
-- Run the SELECT preview first to confirm the affected rows, then the UPDATE.

-- ── Preview (run first, change nothing) ──────────────────────────────────
-- SELECT id, teacher_id, date, arrival_time, departure_time,
--        sessions_credited, early_departure_category, out_missing, remarks
-- FROM staff_attendance
-- WHERE remarks LIKE '%afternoon-only punch, no prior IN%'
--   AND arrival_time IS NOT NULL
--   AND departure_time IS NULL
-- ORDER BY date, teacher_id;

-- ── Correction ───────────────────────────────────────────────────────────
UPDATE staff_attendance
SET
  departure_time = arrival_time,
  sessions_credited = CASE
    WHEN teacher_id IN ('t17','t18','t33','t34')  -- TA teachers keep full-day credit
         AND arrival_time::time >= TIME '13:00' THEN 2
    ELSE 1
  END,
  early_departure_category = CASE
    WHEN teacher_id IN ('t17','t18','t33','t34')
         AND arrival_time::time >= TIME '13:00'
         AND arrival_time::time <  TIME '13:40' THEN 1
    ELSE NULL
  END,
  arrival_time = NULL,
  out_missing = false,
  remarks = remarks || ' [corrected: OUT-only — IN punch was missed]'
WHERE remarks LIKE '%afternoon-only punch, no prior IN%'
  AND arrival_time IS NOT NULL
  AND departure_time IS NULL;
