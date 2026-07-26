-- ============================================================
-- Class Activity Config
-- Stores which default activities a teacher has hidden for
-- a specific class (e.g. hide Prayers for younger grades).
-- hidden_defaults values: 'prayers' | 'quran' | 'reading' | 'writing'
-- ============================================================

CREATE TABLE IF NOT EXISTS public.class_activity_config (
  class_id        TEXT        PRIMARY KEY,
  hidden_defaults TEXT[]      NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.class_activity_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cac_public" ON public.class_activity_config;
CREATE POLICY "cac_public"
  ON public.class_activity_config
  FOR ALL
  USING (true)
  WITH CHECK (true);
