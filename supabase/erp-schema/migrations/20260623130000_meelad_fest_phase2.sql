-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 2: one-click edition cloning                  ║
-- ║                                                                    ║
-- ║ fest_clone_edition(source, target) copies a *catalog* — categories, ║
-- ║ houses and items — from one edition into another, remapping each    ║
-- ║ item's category to the same-named category in the target. Students  ║
-- ║ and registrations are NOT cloned: a new year reuses the structure,  ║
-- ║ not last year's entries (acceptance §12 — "creating Meelad 2027     ║
-- ║ reuses sections/students/items in one click; 2026 stays intact").   ║
-- ║                                                                    ║
-- ║ Idempotent: skips rows that already exist in the target (by name),  ║
-- ║ so it can be re-run or layered on top of a partial clone.           ║
-- ║                                                                    ║
-- ║ SECURITY DEFINER + an internal app_role() = 'admin' check so the    ║
-- ║ multi-table write is admin-only regardless of table RLS. search_    ║
-- ║ path is pinned to public to keep the definer context safe.         ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION public.fest_clone_edition(p_source uuid, p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cats   int := 0;
  v_houses int := 0;
  v_items  int := 0;
BEGIN
  IF public.app_role() <> 'admin' THEN
    RAISE EXCEPTION 'fest: only admin may clone editions' USING ERRCODE = '42501';
  END IF;
  IF p_source IS NULL OR p_target IS NULL OR p_source = p_target THEN
    RAISE EXCEPTION 'fest: source and target editions must be distinct';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fest_editions WHERE id = p_source) THEN
    RAISE EXCEPTION 'fest: source edition % not found', p_source;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fest_editions WHERE id = p_target) THEN
    RAISE EXCEPTION 'fest: target edition % not found', p_target;
  END IF;

  -- Categories (match by name).
  INSERT INTO public.fest_categories (edition_id, name, min_grade, max_grade, sort_order)
  SELECT p_target, c.name, c.min_grade, c.max_grade, c.sort_order
  FROM public.fest_categories c
  WHERE c.edition_id = p_source
    AND NOT EXISTS (
      SELECT 1 FROM public.fest_categories t
      WHERE t.edition_id = p_target AND t.name = c.name
    );
  GET DIAGNOSTICS v_cats = ROW_COUNT;

  -- Houses (match by name).
  INSERT INTO public.fest_houses (edition_id, name, color, sort_order)
  SELECT p_target, h.name, h.color, h.sort_order
  FROM public.fest_houses h
  WHERE h.edition_id = p_source
    AND NOT EXISTS (
      SELECT 1 FROM public.fest_houses t
      WHERE t.edition_id = p_target AND t.name = h.name
    );
  GET DIAGNOSTICS v_houses = ROW_COUNT;

  -- Items (remap category_id to the same-named category in the target edition).
  INSERT INTO public.fest_items (
    edition_id, name, name_ml, language, type, category_id, stage,
    max_per_section, group_min, group_max, rubric, rules, duration_minutes, status
  )
  SELECT
    p_target, i.name, i.name_ml, i.language, i.type, tc.id, i.stage,
    i.max_per_section, i.group_min, i.group_max, i.rubric, i.rules, i.duration_minutes, i.status
  FROM public.fest_items i
  LEFT JOIN public.fest_categories sc ON sc.id = i.category_id
  LEFT JOIN public.fest_categories tc
    ON tc.edition_id = p_target AND tc.name = sc.name
  WHERE i.edition_id = p_source
    AND NOT EXISTS (
      SELECT 1 FROM public.fest_items t
      WHERE t.edition_id = p_target
        AND lower(t.name) = lower(i.name)
        AND coalesce(t.category_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(tc.id,        '00000000-0000-0000-0000-000000000000'::uuid)
    );
  GET DIAGNOSTICS v_items = ROW_COUNT;

  RETURN jsonb_build_object(
    'categories', v_cats,
    'houses',     v_houses,
    'items',      v_items
  );
END $$;

REVOKE ALL ON FUNCTION public.fest_clone_edition(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fest_clone_edition(uuid, uuid) TO authenticated;
