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
    ('1', 'Ihlamudheen Madrasa Malayalam Madrasa'),
    ('2', 'Ihlamudheen Madrasa English Madrasa'),
    ('3', 'CIBIS Certification'),
    ('4', 'Ihlamudheen Madrasa EDU Support')
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
