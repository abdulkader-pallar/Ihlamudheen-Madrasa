-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 8: public results portal                      ║
-- ║                                                                    ║
-- ║ Anon can read fest_results, but NOT the PII tables it joins to, so  ║
-- ║ the public results portal goes through this SECURITY DEFINER RPC.   ║
-- ║ It returns each item's top-3 winners (name, rank, grade) only once  ║
-- ║ the edition is published.                                          ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION public.fest_public_results(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE eid uuid; st fest_edition_status; out jsonb;
BEGIN
  SELECT id, status INTO eid, st FROM fest_editions WHERE slug = p_slug;
  IF eid IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  IF st <> 'results_published' AND NOT public.fest_is_staff() THEN
    RETURN jsonb_build_object('found', true, 'published', false, 'items', '[]'::jsonb);
  END IF;

  SELECT jsonb_build_object(
    'found', true, 'published', true,
    'items', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'item')
      FROM (
        SELECT jsonb_build_object(
          'item', it.name,
          'type', it.type,
          'winners', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                     'rank', r.rank, 'grade', r.grade, 'name', stu.name)
                     ORDER BY r.rank), '[]'::jsonb)
            FROM fest_results r
            JOIN fest_registrations reg ON reg.id = r.registration_id
            LEFT JOIN fest_students stu ON stu.id = reg.student_id
            WHERE r.item_id = it.id AND r.rank <= 3
          )
        ) AS x
        FROM fest_items it
        WHERE it.edition_id = eid
          AND EXISTS (SELECT 1 FROM fest_results r WHERE r.item_id = it.id AND r.rank <= 3)
      ) y
    ), '[]'::jsonb)
  ) INTO out;

  RETURN out;
END $$;

GRANT EXECUTE ON FUNCTION public.fest_public_results(text) TO anon, authenticated;
