-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 7: media gallery + archive / Hall of Fame     ║
-- ║                                                                    ║
-- ║ • fest_media       — photos/videos/posters tagged by edition →     ║
-- ║                       event → category (public 'fest-media' bucket) ║
-- ║ • fest_hall_of_fame() — lifetime records across PUBLISHED editions  ║
-- ║ • fest_analytics()    — cross-edition counts for the archive charts ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.fest_media (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id    uuid NOT NULL REFERENCES public.fest_editions(id) ON DELETE CASCADE,
  item_id       uuid REFERENCES public.fest_items(id) ON DELETE SET NULL,
  category      text,                                  -- free tag (event/category)
  type          text NOT NULL DEFAULT 'photo',         -- photo | video | poster
  storage_path  text NOT NULL,                         -- path in the fest-media bucket
  caption       text,
  uploaded_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fest_media_edition_idx ON public.fest_media (edition_id);

ALTER TABLE public.fest_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fest_media_public_read ON public.fest_media;
CREATE POLICY fest_media_public_read ON public.fest_media
  FOR SELECT TO anon, authenticated
  USING (
    public.fest_is_staff()
    OR EXISTS (SELECT 1 FROM public.fest_editions e
               WHERE e.id = fest_media.edition_id AND e.status <> 'draft')
  );
DROP POLICY IF EXISTS fest_media_staff_write ON public.fest_media;
CREATE POLICY fest_media_staff_write ON public.fest_media
  FOR ALL TO authenticated
  USING (public.fest_is_staff()) WITH CHECK (public.fest_is_staff());

-- Public media bucket (images displayed on the public site / yearbook).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('fest-media', 'fest-media', true, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 10485760;

DROP POLICY IF EXISTS "fest-media staff upload" ON storage.objects;
CREATE POLICY "fest-media staff upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fest-media' AND public.fest_is_staff());
DROP POLICY IF EXISTS "fest-media public read" ON storage.objects;
CREATE POLICY "fest-media public read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'fest-media');
DROP POLICY IF EXISTS "fest-media staff delete" ON storage.objects;
CREATE POLICY "fest-media staff delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'fest-media' AND public.fest_is_staff());

-- ── Hall of Fame: lifetime records across all PUBLISHED editions ──────────────
CREATE OR REPLACE FUNCTION public.fest_hall_of_fame()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE out jsonb;
BEGIN
  WITH pub AS (SELECT id FROM fest_editions WHERE status = 'results_published'),
  res AS (
    SELECT r.points, r.rank, reg.student_id, it.name AS item_name, se.house_id, r.edition_id
    FROM fest_results r
    JOIN pub ON pub.id = r.edition_id
    JOIN fest_registrations reg ON reg.id = r.registration_id
    JOIN fest_items it ON it.id = r.item_id
    LEFT JOIN fest_student_editions se ON se.edition_id = r.edition_id AND se.student_id = reg.student_id
  )
  SELECT jsonb_build_object(
    'topPerformers', (
      SELECT coalesce(jsonb_agg(x ORDER BY (x->>'points')::numeric DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('name', stu.name, 'reg', stu.reg_no,
                 'points', sum(res.points), 'wins', count(*) FILTER (WHERE res.rank = 1)) AS x
        FROM res JOIN fest_students stu ON stu.id = res.student_id
        GROUP BY stu.id, stu.name, stu.reg_no
        ORDER BY sum(res.points) DESC LIMIT 10
      ) t
    ),
    'topReciter', (
      SELECT stu.name FROM res JOIN fest_students stu ON stu.id = res.student_id
      WHERE res.item_name ILIKE '%quran%' OR res.item_name ILIKE '%hifz%'
      GROUP BY stu.id, stu.name ORDER BY sum(res.points) DESC LIMIT 1
    ),
    'topSpeaker', (
      SELECT stu.name FROM res JOIN fest_students stu ON stu.id = res.student_id
      WHERE res.item_name ILIKE '%speech%'
      GROUP BY stu.id, stu.name ORDER BY sum(res.points) DESC LIMIT 1
    ),
    'bestHouses', (
      SELECT coalesce(jsonb_agg(y ORDER BY y->>'edition'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object('edition', ed.name, 'house', ho.name,
                 'points', sum(res.points)) AS y
        FROM res
        JOIN fest_houses ho ON ho.id = res.house_id
        JOIN fest_editions ed ON ed.id = res.edition_id
        GROUP BY ed.id, ed.name, ho.id, ho.name
        ORDER BY ed.name, sum(res.points) DESC
      ) bh
    )
  ) INTO out;
  RETURN coalesce(out, '{}'::jsonb);
END $$;

-- ── Cross-edition analytics (counts per edition) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fest_analytics()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'name', e.name,
      'year', e.year,
      'students', (SELECT count(*) FROM fest_student_editions se WHERE se.edition_id = e.id),
      'items',    (SELECT count(*) FROM fest_items i WHERE i.edition_id = e.id),
      'registrations', (SELECT count(*) FROM fest_registrations r WHERE r.edition_id = e.id)
    ) AS x
    FROM fest_editions e
    WHERE e.status <> 'draft'
  ) z;
$$;

GRANT EXECUTE ON FUNCTION public.fest_hall_of_fame() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fest_analytics()    TO anon, authenticated;
