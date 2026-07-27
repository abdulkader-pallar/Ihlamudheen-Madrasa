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
    CREATE POLICY "settings_select" ON public.app_settings
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings' AND policyname = 'settings_admin_write') THEN
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
