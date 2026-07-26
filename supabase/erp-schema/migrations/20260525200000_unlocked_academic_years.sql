-- ============================================================
-- Seed: unlocked_academic_years setting
-- Controls which academic years are open for data entry.
-- Future years are locked until an admin promotes students.
-- ============================================================

INSERT INTO public.app_settings (key, value)
VALUES ('unlocked_academic_years', '["2025-2026","2026-2027"]')
ON CONFLICT (key) DO NOTHING;
