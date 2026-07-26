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
