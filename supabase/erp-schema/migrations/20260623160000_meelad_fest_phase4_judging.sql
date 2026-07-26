-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 4: judging + results computation              ║
-- ║                                                                    ║
-- ║ • fest_item_judges  — which judge scores which item                ║
-- ║ • fest_scores       — one row per (judge, entry); judges see only   ║
-- ║                       their own marks, never another judge's        ║
-- ║ • fest_results      — finalized rank/grade/points per entry         ║
-- ║ • fest_items.locked_at — item locks when judging completes          ║
-- ║                                                                    ║
-- ║ Judge anonymization (§5): judges load their sheet via               ║
-- ║ fest_judge_sheet() which returns CODE NUMBERS, never names.         ║
-- ║ Admins/staff keep full read access (the "reveal" path).            ║
-- ║                                                                    ║
-- ║ fest_recompute_results() aggregates marks per the edition's config  ║
-- ║ (average | sum | drop_high_low), grades (A/B/C thresholds), ranks   ║
-- ║ within each item, and awards points (group doubled) — atomically.   ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── Tables ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fest_item_judges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL REFERENCES public.fest_items(id) ON DELETE CASCADE,
  judge_id    uuid NOT NULL,                       -- auth.users id
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, judge_id)
);
CREATE INDEX IF NOT EXISTS fest_item_judges_judge_idx ON public.fest_item_judges (judge_id);

CREATE TABLE IF NOT EXISTS public.fest_scores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id       uuid NOT NULL REFERENCES public.fest_editions(id)     ON DELETE CASCADE,
  item_id          uuid NOT NULL REFERENCES public.fest_items(id)        ON DELETE CASCADE,
  registration_id  uuid NOT NULL REFERENCES public.fest_registrations(id) ON DELETE CASCADE,
  judge_id         uuid NOT NULL,                  -- auth.users id (= auth.uid())
  criteria         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { criterionKey: mark }
  total            numeric NOT NULL DEFAULT 0,     -- 0..100 aggregate of criteria
  remarks          text,
  submitted        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, registration_id, judge_id)
);
CREATE INDEX IF NOT EXISTS fest_scores_item_idx  ON public.fest_scores (item_id);
CREATE INDEX IF NOT EXISTS fest_scores_judge_idx ON public.fest_scores (judge_id);

DROP TRIGGER IF EXISTS fest_scores_set_updated_at ON public.fest_scores;
CREATE TRIGGER fest_scores_set_updated_at BEFORE UPDATE ON public.fest_scores
  FOR EACH ROW EXECUTE FUNCTION public.fest_set_updated_at();

CREATE TABLE IF NOT EXISTS public.fest_results (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id       uuid NOT NULL REFERENCES public.fest_editions(id)     ON DELETE CASCADE,
  item_id          uuid NOT NULL REFERENCES public.fest_items(id)        ON DELETE CASCADE,
  registration_id  uuid NOT NULL REFERENCES public.fest_registrations(id) ON DELETE CASCADE,
  avg_mark         numeric,
  grade            text,
  rank             int,
  points           numeric NOT NULL DEFAULT 0,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, registration_id)
);
CREATE INDEX IF NOT EXISTS fest_results_edition_idx ON public.fest_results (edition_id);

ALTER TABLE public.fest_items
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.fest_item_judges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_scores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_results     ENABLE ROW LEVEL SECURITY;

-- item_judges: staff manage; a judge can see their own assignments.
DROP POLICY IF EXISTS fest_item_judges_staff_write ON public.fest_item_judges;
CREATE POLICY fest_item_judges_staff_write ON public.fest_item_judges
  FOR ALL TO authenticated
  USING (public.fest_is_staff()) WITH CHECK (public.fest_is_staff());
DROP POLICY IF EXISTS fest_item_judges_self_read ON public.fest_item_judges;
CREATE POLICY fest_item_judges_self_read ON public.fest_item_judges
  FOR SELECT TO authenticated
  USING (public.fest_is_staff() OR judge_id = auth.uid());

-- scores: a judge reads/writes ONLY their own rows, and only while the item is
-- unlocked and they're assigned. Staff read all (the reveal/oversight path).
DROP POLICY IF EXISTS fest_scores_select ON public.fest_scores;
CREATE POLICY fest_scores_select ON public.fest_scores
  FOR SELECT TO authenticated
  USING (public.fest_is_staff() OR judge_id = auth.uid());

DROP POLICY IF EXISTS fest_scores_judge_write ON public.fest_scores;
CREATE POLICY fest_scores_judge_write ON public.fest_scores
  FOR ALL TO authenticated
  USING (
    public.fest_is_staff()
    OR (
      judge_id = auth.uid()
      AND EXISTS (SELECT 1 FROM public.fest_item_judges j
                  WHERE j.item_id = fest_scores.item_id AND j.judge_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.fest_items i
                  WHERE i.id = fest_scores.item_id AND i.locked_at IS NULL)
    )
  )
  WITH CHECK (
    public.fest_is_staff()
    OR (
      judge_id = auth.uid()
      AND EXISTS (SELECT 1 FROM public.fest_item_judges j
                  WHERE j.item_id = fest_scores.item_id AND j.judge_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.fest_items i
                  WHERE i.id = fest_scores.item_id AND i.locked_at IS NULL)
    )
  );

-- results: staff read always; public reads once the edition is published.
DROP POLICY IF EXISTS fest_results_read ON public.fest_results;
CREATE POLICY fest_results_read ON public.fest_results
  FOR SELECT TO anon, authenticated
  USING (
    public.fest_is_staff()
    OR EXISTS (SELECT 1 FROM public.fest_editions e
               WHERE e.id = fest_results.edition_id AND e.status = 'results_published')
  );
-- writes happen only through the SECURITY DEFINER recompute function below.
DROP POLICY IF EXISTS fest_results_staff_write ON public.fest_results;
CREATE POLICY fest_results_staff_write ON public.fest_results
  FOR ALL TO authenticated
  USING (public.app_role() IN ('admin','accountant'))
  WITH CHECK (public.app_role() IN ('admin','accountant'));

-- ── Anonymized judge sheet: code numbers, never names ─────────────────────────
CREATE OR REPLACE FUNCTION public.fest_judge_sheet(p_item_id uuid)
RETURNS TABLE (registration_id uuid, code_no text, is_group boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    public.fest_is_staff()
    OR EXISTS (SELECT 1 FROM fest_item_judges j WHERE j.item_id = p_item_id AND j.judge_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'not authorized for this item';
  END IF;

  RETURN QUERY
    SELECT r.id, se.code_no, r.is_group
    FROM fest_registrations r
    JOIN fest_items i ON i.id = r.item_id
    LEFT JOIN fest_student_editions se
      ON se.edition_id = i.edition_id AND se.student_id = r.student_id
    WHERE r.item_id = p_item_id
    ORDER BY se.code_no NULLS LAST;
END $$;

-- ── Lock when every assigned judge has submitted every entry ──────────────────
CREATE OR REPLACE FUNCTION public.fest_lock_if_complete(p_item_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n_judges int; n_entries int; n_done int;
BEGIN
  SELECT count(*) INTO n_judges  FROM fest_item_judges WHERE item_id = p_item_id;
  SELECT count(*) INTO n_entries FROM fest_registrations WHERE item_id = p_item_id;
  IF n_judges = 0 OR n_entries = 0 THEN RETURN false; END IF;

  SELECT count(*) INTO n_done
  FROM fest_scores WHERE item_id = p_item_id AND submitted;

  IF n_done >= n_judges * n_entries THEN
    UPDATE fest_items SET locked_at = now() WHERE id = p_item_id AND locked_at IS NULL;
    RETURN true;
  END IF;
  RETURN false;
END $$;

-- Admin-only unlock, audited.
CREATE OR REPLACE FUNCTION public.fest_unlock_item(p_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eid uuid;
BEGIN
  IF public.app_role() <> 'admin' THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT edition_id INTO eid FROM fest_items WHERE id = p_item_id;
  UPDATE fest_items SET locked_at = NULL WHERE id = p_item_id;
  INSERT INTO fest_audit_log(edition_id, actor, action, entity, entity_id)
  VALUES (eid, auth.uid(), 'unlock_item', 'fest_items', p_item_id::text);
END $$;

-- ── Recompute results for an edition (atomic) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.fest_recompute_results(p_edition_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg jsonb;
  ta int; tb int; tc int;
  agg text;
  pa numeric; pb numeric; pc numeric; gmul numeric;
BEGIN
  IF NOT (public.app_role() IN ('admin','accountant')) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT config INTO cfg FROM fest_editions WHERE id = p_edition_id;
  ta   := coalesce((cfg #>> '{grade_thresholds,A}')::int, 80);
  tb   := coalesce((cfg #>> '{grade_thresholds,B}')::int, 60);
  tc   := coalesce((cfg #>> '{grade_thresholds,C}')::int, 40);
  agg  := coalesce(cfg ->> 'aggregation', 'average');
  pa   := coalesce((cfg #>> '{points,individual,A}')::numeric, 5);
  pb   := coalesce((cfg #>> '{points,individual,B}')::numeric, 3);
  pc   := coalesce((cfg #>> '{points,individual,C}')::numeric, 1);
  gmul := coalesce((cfg #>> '{points,group_multiplier}')::numeric, 2);

  DELETE FROM fest_results WHERE edition_id = p_edition_id;

  INSERT INTO fest_results (edition_id, item_id, registration_id, avg_mark, grade, rank, points)
  WITH agg_marks AS (
    SELECT s.item_id, s.registration_id,
      CASE agg
        WHEN 'sum' THEN sum(s.total)
        WHEN 'drop_high_low' THEN
          CASE WHEN count(*) > 2
               THEN (sum(s.total) - max(s.total) - min(s.total)) / (count(*) - 2)
               ELSE avg(s.total) END
        ELSE avg(s.total)
      END AS mark
    FROM fest_scores s
    JOIN fest_items i ON i.id = s.item_id
    WHERE i.edition_id = p_edition_id AND s.submitted
    GROUP BY s.item_id, s.registration_id
  ),
  graded AS (
    SELECT am.*,
      CASE WHEN mark >= ta THEN 'A' WHEN mark >= tb THEN 'B'
           WHEN mark >= tc THEN 'C' ELSE '-' END AS grade
    FROM agg_marks am
  ),
  ranked AS (
    SELECT g.*, rank() OVER (PARTITION BY item_id ORDER BY mark DESC) AS rnk
    FROM graded g
  )
  SELECT p_edition_id, r.item_id, r.registration_id, round(r.mark, 2), r.grade, r.rnk::int,
    (CASE r.grade WHEN 'A' THEN pa WHEN 'B' THEN pb WHEN 'C' THEN pc ELSE 0 END)
      * (CASE WHEN it.type = 'group' THEN gmul ELSE 1 END)
  FROM ranked r
  JOIN fest_items it ON it.id = r.item_id;

  INSERT INTO fest_audit_log(edition_id, actor, action, entity, entity_id)
  VALUES (p_edition_id, auth.uid(), 'recompute_results', 'fest_editions', p_edition_id::text);
END $$;

GRANT EXECUTE ON FUNCTION public.fest_judge_sheet(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.fest_lock_if_complete(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.fest_unlock_item(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.fest_recompute_results(uuid)  TO authenticated;
