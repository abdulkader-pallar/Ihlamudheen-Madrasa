-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — single current academic year (2026-2027)             ║
-- ║                                                                    ║
-- ║ Splitting the fest across two unlocked years (2025-2026 +          ║
-- ║ 2026-2027) fragmented the roster. The institute runs ONE current   ║
-- ║ fest year. This:                                                   ║
-- ║   1. records the current fest year (fest_current_academic_year),    ║
-- ║   2. merges every course's editions into a single 2026-2027         ║
-- ║      edition (all students moved into it), pruning the rest,         ║
-- ║   3. makes the auto-sync create ONLY the current year going          ║
-- ║      forward, so changing the current year rolls the fest over.      ║
-- ║                                                                    ║
-- ║ The UI only permits data entry on the current year (frozen else).  ║
-- ║ Idempotent — safe to re-run.                                        ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── 1. Current fest year ──────────────────────────────────────────────────────
INSERT INTO public.app_settings (key, value)
VALUES ('fest_current_academic_year', '2026-2027')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ── 2. Merge each course's editions into one current-year keeper ──────────────
DO $$
DECLARE
  v_cur     text;
  v_course  text;
  v_keeper  uuid;
  v_src     uuid;
BEGIN
  SELECT value INTO v_cur FROM public.app_settings WHERE key = 'fest_current_academic_year';
  v_cur := COALESCE(v_cur, '2026-2027');

  FOR v_course IN
    SELECT DISTINCT course_id FROM public.fest_editions WHERE course_id IS NOT NULL
  LOOP
    -- Keeper = the course's edition with the most students (else the oldest).
    SELECT e.id INTO v_keeper
    FROM public.fest_editions e
    LEFT JOIN (
      SELECT edition_id, count(*) AS n FROM public.fest_student_editions GROUP BY edition_id
    ) se ON se.edition_id = e.id
    WHERE e.course_id = v_course
    ORDER BY COALESCE(se.n, 0) DESC, e.created_at ASC
    LIMIT 1;

    CONTINUE WHEN v_keeper IS NULL;

    -- Relabel the keeper to the current year.
    UPDATE public.fest_editions SET academic_year = v_cur WHERE id = v_keeper;

    -- Fold every other edition of this course into the keeper.
    FOR v_src IN
      SELECT id FROM public.fest_editions WHERE course_id = v_course AND id <> v_keeper
    LOOP
      -- Move students not already in the keeper. house/category/code are
      -- per-edition, so clear them (re-assigned in the UI; code re-minted there).
      UPDATE public.fest_student_editions se
         SET edition_id = v_keeper, house_id = NULL, category_id = NULL, code_no = NULL
       WHERE se.edition_id = v_src
         AND NOT EXISTS (
           SELECT 1 FROM public.fest_student_editions k
           WHERE k.edition_id = v_keeper AND k.student_id = se.student_id
         );

      -- Drop any remaining rows in the source (duplicates / leftover regs);
      -- deleting the edition then cascades its houses, categories and items.
      DELETE FROM public.fest_student_editions WHERE edition_id = v_src;
      DELETE FROM public.fest_editions WHERE id = v_src;
    END LOOP;
  END LOOP;
END $$;

-- ── 3. Auto-sync now ensures only the CURRENT year's editions ─────────────────
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
    'meelad-' || v_cur || '-c' || c.cid,
    'Meelad ' || v_cur || ' — ' || c.cname,
    'Ihlamudheen Madrasa Meelad Fest',
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
    ('1', 'Ihlamudheen Madrasa'),
    ('2', 'Kammu Musliyar Memorial School')
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

-- ── 4. Re-sync trigger also fires when the current fest year changes ──────────
CREATE OR REPLACE FUNCTION public.fest_settings_year_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.key IN ('unlocked_academic_years', 'fest_current_academic_year') THEN
    PERFORM public.fest_sync_course_editions();
  END IF;
  RETURN NEW;
END $$;

-- Ensure every course has its current-year edition.
SELECT public.fest_sync_course_editions();
