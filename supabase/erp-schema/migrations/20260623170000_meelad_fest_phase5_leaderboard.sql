-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 5: leaderboard aggregation                    ║
-- ║                                                                    ║
-- ║ fest_leaderboard(edition) rolls fest_results points up by house    ║
-- ║ AND by section (locked decision §14.2 = both) plus the top         ║
-- ║ individuals. Readable by staff always, and by anyone once the      ║
-- ║ edition is 'live' or 'results_published' (drives the public live    ║
-- ║ leaderboard + Stage Mode). SECURITY DEFINER so anon can read the    ║
-- ║ aggregate without exposing the underlying PII tables.              ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION public.fest_leaderboard(p_edition_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE st fest_edition_status; out jsonb;
BEGIN
  SELECT status INTO st FROM fest_editions WHERE id = p_edition_id;
  IF st IS NULL THEN RAISE EXCEPTION 'edition not found'; END IF;
  IF NOT (public.fest_is_staff() OR st IN ('live','results_published')) THEN
    RAISE EXCEPTION 'leaderboard not available yet';
  END IF;

  WITH res AS (
    SELECT r.points, r.rank, reg.student_id, se.house_id, se.section_id
    FROM fest_results r
    JOIN fest_registrations reg ON reg.id = r.registration_id
    LEFT JOIN fest_student_editions se
      ON se.edition_id = p_edition_id AND se.student_id = reg.student_id
    WHERE r.edition_id = p_edition_id
  )
  SELECT jsonb_build_object(
    'houses', (
      SELECT coalesce(jsonb_agg(h ORDER BY (h->>'points')::numeric DESC, h->>'name'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('id', ho.id, 'name', ho.name, 'color', ho.color,
                 'points', coalesce(sum(res.points), 0)) AS h
        FROM fest_houses ho
        LEFT JOIN res ON res.house_id = ho.id
        WHERE ho.edition_id = p_edition_id
        GROUP BY ho.id, ho.name, ho.color
      ) hx
    ),
    'sections', (
      SELECT coalesce(jsonb_agg(s ORDER BY (s->>'points')::numeric DESC, s->>'name'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('id', sec.id, 'name', sec.name,
                 'points', coalesce(sum(res.points), 0)) AS s
        FROM fest_sections sec
        JOIN res ON res.section_id = sec.id
        GROUP BY sec.id, sec.name
      ) sx
    ),
    'individuals', (
      SELECT coalesce(jsonb_agg(i ORDER BY (i->>'points')::numeric DESC, i->>'name'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('student_id', stu.id, 'name', stu.name,
                 'reg', stu.reg_no, 'points', sum(res.points)) AS i
        FROM res
        JOIN fest_students stu ON stu.id = res.student_id
        GROUP BY stu.id, stu.name, stu.reg_no
        ORDER BY sum(res.points) DESC
        LIMIT 20
      ) ix
    )
  ) INTO out;

  RETURN out;
END $$;

GRANT EXECUTE ON FUNCTION public.fest_leaderboard(uuid) TO anon, authenticated;
