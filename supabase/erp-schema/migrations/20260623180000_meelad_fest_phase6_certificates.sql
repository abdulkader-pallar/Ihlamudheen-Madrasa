-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 6: certificates + QR verification             ║
-- ║                                                                    ║
-- ║ fest_certificates holds one row per issued certificate with a       ║
-- ║ random verification token printed (as a QR) on the PDF.            ║
-- ║ fest_verify_certificate(token) is a public SECURITY DEFINER RPC so  ║
-- ║ /verify/<token> can confirm authenticity without exposing the       ║
-- ║ underlying PII tables — and only once the edition is published.     ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.fest_certificates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id       uuid NOT NULL REFERENCES public.fest_editions(id)      ON DELETE CASCADE,
  registration_id  uuid NOT NULL REFERENCES public.fest_registrations(id) ON DELETE CASCADE,
  student_id       uuid REFERENCES public.fest_students(id) ON DELETE SET NULL,
  item_id          uuid REFERENCES public.fest_items(id)    ON DELETE SET NULL,
  type             text NOT NULL DEFAULT 'participation',   -- participation | winner | appreciation
  rank             int,
  grade            text,
  token            text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(9), 'hex'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_id, type)
);
CREATE INDEX IF NOT EXISTS fest_certificates_edition_idx ON public.fest_certificates (edition_id);

ALTER TABLE public.fest_certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fest_certificates_staff_all ON public.fest_certificates;
CREATE POLICY fest_certificates_staff_all ON public.fest_certificates
  FOR ALL TO authenticated
  USING (public.fest_is_staff()) WITH CHECK (public.fest_is_staff());

-- Public certificate verification: returns the printable facts only, and only
-- when the edition has published results (otherwise reports invalid).
CREATE OR REPLACE FUNCTION public.fest_verify_certificate(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'valid', true,
    'student', stu.name,
    'reg', stu.reg_no,
    'item', it.name,
    'edition', ed.name,
    'theme', ed.theme,
    'type', c.type,
    'rank', c.rank,
    'grade', c.grade,
    'issued_at', c.created_at
  ) INTO out
  FROM fest_certificates c
  JOIN fest_editions ed ON ed.id = c.edition_id
  LEFT JOIN fest_students stu ON stu.id = c.student_id
  LEFT JOIN fest_items it ON it.id = c.item_id
  WHERE c.token = p_token
    AND (public.fest_is_staff() OR ed.status = 'results_published');

  RETURN coalesce(out, jsonb_build_object('valid', false));
END $$;

GRANT EXECUTE ON FUNCTION public.fest_verify_certificate(text) TO anon, authenticated;
