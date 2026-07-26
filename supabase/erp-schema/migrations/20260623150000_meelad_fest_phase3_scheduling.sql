-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 3: scheduling                                 ║
-- ║                                                                    ║
-- ║ Stages (venues) per edition, and the scheduling columns on items   ║
-- ║ (stage + start time + duration) that drive the clash detector.     ║
-- ║ Idempotent; RLS mirrors the Phase-1 catalog pattern (public reads  ║
-- ║ non-draft editions, fest staff manage).                            ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.fest_stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id  uuid NOT NULL REFERENCES public.fest_editions(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (edition_id, name)
);
CREATE INDEX IF NOT EXISTS fest_stages_edition_idx ON public.fest_stages (edition_id);

-- Items already carry `stage` (text), `scheduled_at`, `duration_minutes`; add a
-- proper FK to the stage entity so the planner can group by venue.
ALTER TABLE public.fest_items
  ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES public.fest_stages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS fest_items_stage_idx ON public.fest_items (stage_id);

ALTER TABLE public.fest_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fest_stages_public_read ON public.fest_stages;
CREATE POLICY fest_stages_public_read ON public.fest_stages
  FOR SELECT TO anon, authenticated
  USING (
    public.fest_is_staff()
    OR EXISTS (SELECT 1 FROM public.fest_editions e
               WHERE e.id = fest_stages.edition_id AND e.status <> 'draft')
  );
DROP POLICY IF EXISTS fest_stages_staff_write ON public.fest_stages;
CREATE POLICY fest_stages_staff_write ON public.fest_stages
  FOR ALL TO authenticated
  USING (public.fest_is_staff()) WITH CHECK (public.fest_is_staff());
