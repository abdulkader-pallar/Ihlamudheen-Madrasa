-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — per-course editions                                  ║
-- ║                                                                    ║
-- ║ Each Ihlamudheen course runs its OWN Ihlamudheen Madrasa Meelad Fest. We add a      ║
-- ║ course_id dimension to fest_editions so every edition (and, by      ║
-- ║ extension, its houses / categories / items / students / results,    ║
-- ║ which all hang off edition_id) is isolated to a single course.      ║
-- ║                                                                    ║
-- ║ Courses are static app data (src/data/courses.ts), so the course    ║
-- ║ list is seeded here explicitly. The pre-existing generic            ║
-- ║ 'meelad-2026' edition is adopted as course 1 (Malayalam Madrasa);   ║
-- ║ courses 2–4 get a fresh edition each with the default houses and     ║
-- ║ category bands. Idempotent — safe to re-run.                       ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── Schema ────────────────────────────────────────────────────────────────────
ALTER TABLE public.fest_editions
  ADD COLUMN IF NOT EXISTS course_id text;

CREATE INDEX IF NOT EXISTS fest_editions_course_idx ON public.fest_editions (course_id);

-- ── Adopt the existing generic edition as the course-1 fest ───────────────────
UPDATE public.fest_editions
   SET course_id = '1',
       name = 'Meelad 2026 — Ihlamudheen Madrasa Malayalam Madrasa'
 WHERE slug = 'meelad-2026'
   AND course_id IS NULL;

-- ── One edition per remaining course ──────────────────────────────────────────
INSERT INTO public.fest_editions (slug, name, theme, year, status, course_id, config)
SELECT
  c.slug, c.name, 'Ihlamudheen Madrasa Meelad Fest', 2026, 'draft', c.cid,
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
  ('2', 'meelad-2026-c2', 'Meelad 2026 — Ihlamudheen Madrasa English Madrasa'),
  ('3', 'meelad-2026-c3', 'Meelad 2026 — CIBIS Certification'),
  ('4', 'meelad-2026-c4', 'Meelad 2026 — Ihlamudheen Madrasa EDU Support')
) AS c(cid, slug, name)
ON CONFLICT (slug) DO NOTHING;

-- ── Default houses for every edition that has none ────────────────────────────
INSERT INTO public.fest_houses (edition_id, name, color, sort_order)
SELECT e.id, h.name, h.color, h.ord
FROM public.fest_editions e
CROSS JOIN (VALUES
  ('Green',  '#16a34a', 1),
  ('Blue',   '#2563eb', 2),
  ('Red',    '#dc2626', 3),
  ('Yellow', '#ca8a04', 4)
) AS h(name, color, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.fest_houses x WHERE x.edition_id = e.id)
ON CONFLICT (edition_id, name) DO NOTHING;

-- ── Default category bands for every edition that has none ─────────────────────
INSERT INTO public.fest_categories (edition_id, name, min_grade, max_grade, sort_order)
SELECT e.id, c.name, c.lo, c.hi, c.ord
FROM public.fest_editions e
CROSS JOIN (VALUES
  ('Sub-Junior',   1, 2, 1),
  ('Junior',       3, 4, 2),
  ('Senior',       5, 7, 3),
  ('Super-Senior', 8, 10, 4)
) AS c(name, lo, hi, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.fest_categories x WHERE x.edition_id = e.id)
ON CONFLICT (edition_id, name) DO NOTHING;
