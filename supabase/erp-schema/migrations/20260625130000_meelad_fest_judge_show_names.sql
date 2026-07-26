-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — judges see the student name + register number        ║
-- ║                                                                    ║
-- ║ The register number is now used as the entry "code", and judges     ║
-- ║ are allowed to see the participant's name. fest_judge_sheet()       ║
-- ║ therefore returns reg_no and student_name alongside the legacy      ║
-- ║ code_no (which may be null). Authorisation is unchanged: only        ║
-- ║ assigned judges (or staff) may read an item's sheet.                ║
-- ║                                                                    ║
-- ║ The return signature changes, so the function is dropped and        ║
-- ║ recreated. Idempotent.                                              ║
-- ╚══════════════════════════════════════════════════════════════════╝

DROP FUNCTION IF EXISTS public.fest_judge_sheet(uuid);

CREATE FUNCTION public.fest_judge_sheet(p_item_id uuid)
RETURNS TABLE (registration_id uuid, code_no text, reg_no text, student_name text, is_group boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    public.fest_is_staff()
    OR EXISTS (SELECT 1 FROM fest_item_judges j WHERE j.item_id = p_item_id AND j.judge_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'not authorized for this item';
  END IF;

  RETURN QUERY
    SELECT r.id, se.code_no, s.reg_no, s.name, r.is_group
    FROM fest_registrations r
    JOIN fest_items i ON i.id = r.item_id
    LEFT JOIN fest_student_editions se
      ON se.edition_id = i.edition_id AND se.student_id = r.student_id
    LEFT JOIN fest_students s ON s.id = r.student_id
    WHERE r.item_id = p_item_id
    ORDER BY s.reg_no NULLS LAST, se.code_no NULLS LAST;
END $$;

GRANT EXECUTE ON FUNCTION public.fest_judge_sheet(uuid) TO authenticated;
