-- Optional per-student PIN for the activity portal (closes the audit H3 residual:
-- identity was just the roll number, which a peer could guess).
--
-- NULL = no PIN required → fully backward compatible: existing students keep
-- working until an admin sets a PIN via /api/student-pin.
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS portal_pin_hash TEXT;

COMMENT ON COLUMN public.students.portal_pin_hash IS
  'scrypt hash of the student portal PIN (set via /api/student-pin). NULL = no PIN required. Never exposed to the anon client.';
