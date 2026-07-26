-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ MEELAD FEST — Phase 1: schema + RLS + seed                        ║
-- ║                                                                    ║
-- ║ "Ihlamudheen Madrasa Meelad Fest Portal" — a multi-year madrasa arts-fest    ║
-- ║ module living INSIDE Ihlamudheen on the same Supabase project. Every     ║
-- ║ transactional table hangs off `edition_id` so each yearly fest is  ║
-- ║ an isolated, permanently-browsable archive ("clone last year",     ║
-- ║ lifetime student profiles, Hall of Fame all fall out of this).     ║
-- ║                                                                    ║
-- ║ All `fest_*` tables are namespaced to avoid colliding with the     ║
-- ║ existing Ihlamudheen schema. RLS reuses public.app_role() (reads the     ║
-- ║ non-user-writable app_metadata.role claim — see migration          ║
-- ║ 20260603120000). New role strings: 'coordinator', 'judge',         ║
-- ║ 'parent' (set in app_metadata; no app_role() change needed).      ║
-- ║                                                                    ║
-- ║ Locked decisions (§14): module-inside-Ihlamudheen · cap 4 individual +   ║
-- ║ 2 group · points roll up by BOTH house and section · judges see    ║
-- ║ code numbers (admin can always reveal names). Scoring thresholds/  ║
-- ║ aggregation/tie-break live in editions.config and stay per-edition ║
-- ║ configurable (wired up in Phase 4 judging).                        ║
-- ║                                                                    ║
-- ║ Idempotent: IF NOT EXISTS for tables, guarded DO blocks for enums  ║
-- ║ and policies, ON CONFLICT for seed — safe to re-run.               ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── Enums ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE fest_edition_status AS ENUM
    ('draft','registration_open','scheduling','live','results_published','archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE fest_item_language AS ENUM ('en','ml','ar','na');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE fest_item_type AS ENUM ('individual','group');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Shared updated_at helper (create-or-replace; may already exist in Ihlamudheen) ──
CREATE OR REPLACE FUNCTION public.fest_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLES
-- ══════════════════════════════════════════════════════════════════════════════

-- editions — one per yearly fest; the backbone every other table scopes to.
CREATE TABLE IF NOT EXISTS public.fest_editions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,                       -- 'meelad-2026'
  name        text NOT NULL,                              -- 'Meelad 2026'
  theme       text,
  year        int,
  starts_on   date,
  ends_on     date,
  status      fest_edition_status NOT NULL DEFAULT 'draft',
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,         -- caps, grades, points, aggregation…
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- houses — competing units that accumulate points (Green/Blue/Red/Yellow).
CREATE TABLE IF NOT EXISTS public.fest_houses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id  uuid NOT NULL REFERENCES public.fest_editions(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (edition_id, name)
);

-- sections — class sections (1A…10A). Reusable across editions; the per-year
-- section/house/category a student belongs to lives in fest_student_editions.
CREATE TABLE IF NOT EXISTS public.fest_sections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text UNIQUE NOT NULL,                       -- '1A'
  grade       int,                                        -- 1
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- categories — age/class bands, configurable per edition.
CREATE TABLE IF NOT EXISTS public.fest_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id  uuid NOT NULL REFERENCES public.fest_editions(id) ON DELETE CASCADE,
  name        text NOT NULL,                              -- 'Sub-Junior'…
  min_grade   int,
  max_grade   int,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (edition_id, name)
);

-- students — lifetime madrasa roll, keyed by STABLE registration number so a
-- student's history survives across years (they change section each year).
CREATE TABLE IF NOT EXISTS public.fest_students (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reg_no            text UNIQUE NOT NULL,                 -- the REG/ID in the sheet
  name              text NOT NULL,
  name_ml           text,                                 -- Malayalam / Arabi-Malayalam
  gender            text CHECK (gender IN ('male','female')),
  parent_name       text,
  parent_mobile     text,
  madrasa_student_id  text,                                 -- optional link to Ihlamudheen roll
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- student_editions — a student's section/house/category/code AS OF an edition.
CREATE TABLE IF NOT EXISTS public.fest_student_editions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id   uuid NOT NULL REFERENCES public.fest_editions(id)  ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES public.fest_students(id)  ON DELETE CASCADE,
  section_id   uuid REFERENCES public.fest_sections(id),
  house_id     uuid REFERENCES public.fest_houses(id),
  category_id  uuid REFERENCES public.fest_categories(id),
  grade        int,
  code_no      text,                                      -- anonymization code shown to judges
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (edition_id, student_id),
  UNIQUE (edition_id, code_no)
);

-- items (events) — speech, recitation, duff, group programmes, etc.
CREATE TABLE IF NOT EXISTS public.fest_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id        uuid NOT NULL REFERENCES public.fest_editions(id) ON DELETE CASCADE,
  name              text NOT NULL,                        -- canonical, e.g. 'Speech – English'
  name_ml           text,
  language          fest_item_language NOT NULL DEFAULT 'na',
  type              fest_item_type     NOT NULL DEFAULT 'individual',
  category_id       uuid REFERENCES public.fest_categories(id),
  stage             text,
  scheduled_at      timestamptz,
  max_per_section   int,
  group_min         int,
  group_max         int,
  rubric            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{key,label,weight,max}]
  rules             text,
  duration_minutes  int,
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fest_items_group_size_ck
    CHECK (group_min IS NULL OR group_max IS NULL OR group_min <= group_max)
);
-- One item name per (edition, category), case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS fest_items_edition_name_cat_uq
  ON public.fest_items (edition_id, lower(name), coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- registrations — student/group → item within an edition.
CREATE TABLE IF NOT EXISTS public.fest_registrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id    uuid NOT NULL REFERENCES public.fest_editions(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES public.fest_items(id)    ON DELETE CASCADE,
  student_id    uuid REFERENCES public.fest_students(id) ON DELETE CASCADE,  -- individual entrant / group leader
  is_group      boolean NOT NULL DEFAULT false,
  section_id    uuid REFERENCES public.fest_sections(id),                    -- snapshot for reporting
  status        text NOT NULL DEFAULT 'registered',       -- registered | verified | withdrawn
  import_batch  uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fest_reg_student_or_group_ck CHECK (is_group OR student_id IS NOT NULL)
);
-- A student can register an individual item only once per edition.
CREATE UNIQUE INDEX IF NOT EXISTS fest_reg_edition_item_student_uq
  ON public.fest_registrations (edition_id, item_id, student_id)
  WHERE student_id IS NOT NULL;

-- group_members — students inside a group registration.
CREATE TABLE IF NOT EXISTS public.fest_group_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id  uuid NOT NULL REFERENCES public.fest_registrations(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL REFERENCES public.fest_students(id)      ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_id, student_id)
);

-- audit_log — who changed what (competition integrity; expanded in later phases).
CREATE TABLE IF NOT EXISTS public.fest_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id  uuid REFERENCES public.fest_editions(id) ON DELETE SET NULL,
  actor       uuid,
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes for the common edition-scoped lookups ─────────────────────────────
CREATE INDEX IF NOT EXISTS fest_student_editions_edition_idx ON public.fest_student_editions (edition_id);
CREATE INDEX IF NOT EXISTS fest_student_editions_student_idx ON public.fest_student_editions (student_id);
CREATE INDEX IF NOT EXISTS fest_items_edition_idx            ON public.fest_items (edition_id);
CREATE INDEX IF NOT EXISTS fest_registrations_edition_idx    ON public.fest_registrations (edition_id);
CREATE INDEX IF NOT EXISTS fest_registrations_item_idx       ON public.fest_registrations (item_id);
CREATE INDEX IF NOT EXISTS fest_registrations_student_idx    ON public.fest_registrations (student_id);
CREATE INDEX IF NOT EXISTS fest_group_members_student_idx    ON public.fest_group_members (student_id);

-- ── updated_at triggers ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS fest_editions_set_updated_at ON public.fest_editions;
CREATE TRIGGER fest_editions_set_updated_at BEFORE UPDATE ON public.fest_editions
  FOR EACH ROW EXECUTE FUNCTION public.fest_set_updated_at();
DROP TRIGGER IF EXISTS fest_students_set_updated_at ON public.fest_students;
CREATE TRIGGER fest_students_set_updated_at BEFORE UPDATE ON public.fest_students
  FOR EACH ROW EXECUTE FUNCTION public.fest_set_updated_at();

-- ══════════════════════════════════════════════════════════════════════════════
-- BUSINESS RULES enforced at the DB (UI is not the gate — §12 acceptance)
-- ══════════════════════════════════════════════════════════════════════════════

-- Per-student item cap. Reads the edition's config.caps (defaults 4 individual,
-- 2 group). Counts the student's existing INDIVIDUAL registrations vs GROUP
-- registrations (as entrant/leader) for the edition and rejects over-cap inserts.
-- Member-level group cap (a student appearing only in fest_group_members) is a
-- Phase-2 refinement; Phase-1 imports register the entrant on the registration row.
CREATE OR REPLACE FUNCTION public.fest_enforce_item_cap()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cfg          jsonb;
  cap_ind      int;
  cap_grp      int;
  is_grp_item  boolean;
  existing_ind int;
  existing_grp int;
BEGIN
  IF NEW.student_id IS NULL THEN
    RETURN NEW;  -- pure group entry with no leader: cap tracked via members later
  END IF;

  SELECT config INTO cfg FROM public.fest_editions WHERE id = NEW.edition_id;
  cap_ind := COALESCE((cfg #>> '{caps,individual}')::int, 4);
  cap_grp := COALESCE((cfg #>> '{caps,group}')::int, 2);

  SELECT (type = 'group') INTO is_grp_item FROM public.fest_items WHERE id = NEW.item_id;

  SELECT
    count(*) FILTER (WHERE i.type = 'individual'),
    count(*) FILTER (WHERE i.type = 'group')
  INTO existing_ind, existing_grp
  FROM public.fest_registrations r
  JOIN public.fest_items i ON i.id = r.item_id
  WHERE r.edition_id = NEW.edition_id
    AND r.student_id = NEW.student_id
    AND r.status <> 'withdrawn'
    AND r.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF COALESCE(is_grp_item, false) THEN
    IF existing_grp >= cap_grp THEN
      RAISE EXCEPTION 'fest: student exceeds group item cap (%).', cap_grp
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF existing_ind >= cap_ind THEN
      RAISE EXCEPTION 'fest: student exceeds individual item cap (%).', cap_ind
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fest_registrations_cap ON public.fest_registrations;
CREATE TRIGGER fest_registrations_cap
  BEFORE INSERT OR UPDATE OF student_id, item_id, status ON public.fest_registrations
  FOR EACH ROW EXECUTE FUNCTION public.fest_enforce_item_cap();

-- Group size ceiling: never let members exceed the item's group_max.
CREATE OR REPLACE FUNCTION public.fest_enforce_group_max()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g_max int; n int;
BEGIN
  SELECT i.group_max INTO g_max
  FROM public.fest_registrations r JOIN public.fest_items i ON i.id = r.item_id
  WHERE r.id = NEW.registration_id;
  IF g_max IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.fest_group_members WHERE registration_id = NEW.registration_id;
    IF n >= g_max THEN
      RAISE EXCEPTION 'fest: group exceeds max size (%).', g_max USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fest_group_members_max ON public.fest_group_members;
CREATE TRIGGER fest_group_members_max
  BEFORE INSERT ON public.fest_group_members
  FOR EACH ROW EXECUTE FUNCTION public.fest_enforce_group_max();

-- ══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
--   admin                       → super admin, full control
--   accountant/coordinator/teacher → fest staff: manage roster/items/registration
--   anon (public)               → read-only on the public catalog of a non-draft
--                                 edition (editions, houses, categories, sections,
--                                 items). Student PII + registrations stay private.
--   judge/parent/student        → scoped reads land in Phase 4/7; until then they
--                                 fall through to the authenticated staff checks.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fest_is_staff()
RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT public.app_role() IN ('admin','accountant','coordinator','teacher') $$;

ALTER TABLE public.fest_editions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_houses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_sections         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_students         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_student_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_registrations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_group_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fest_audit_log        ENABLE ROW LEVEL SECURITY;

-- editions: admin writes; staff read all; public reads non-draft editions.
DROP POLICY IF EXISTS fest_editions_public_read ON public.fest_editions;
CREATE POLICY fest_editions_public_read ON public.fest_editions
  FOR SELECT TO anon, authenticated
  USING (status <> 'draft' OR public.fest_is_staff());
DROP POLICY IF EXISTS fest_editions_admin_write ON public.fest_editions;
CREATE POLICY fest_editions_admin_write ON public.fest_editions
  FOR ALL TO authenticated
  USING (public.app_role() = 'admin')
  WITH CHECK (public.app_role() = 'admin');

-- Public-catalog tables: anon read when parent edition is non-draft; staff manage.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fest_houses','fest_categories','fest_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_public_read', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated
      USING (
        public.fest_is_staff()
        OR EXISTS (SELECT 1 FROM public.fest_editions e
                   WHERE e.id = %I.edition_id AND e.status <> 'draft')
      )$f$, t||'_public_read', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_staff_write', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING (public.fest_is_staff()) WITH CHECK (public.fest_is_staff())$f$,
      t||'_staff_write', t);
  END LOOP;
END $$;

-- sections are global (no edition_id): public read, staff manage.
DROP POLICY IF EXISTS fest_sections_public_read ON public.fest_sections;
CREATE POLICY fest_sections_public_read ON public.fest_sections
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS fest_sections_staff_write ON public.fest_sections;
CREATE POLICY fest_sections_staff_write ON public.fest_sections
  FOR ALL TO authenticated
  USING (public.fest_is_staff()) WITH CHECK (public.fest_is_staff());

-- PII / transactional tables: staff only (parents/students/judges added later).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fest_students','fest_student_editions',
                           'fest_registrations','fest_group_members'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_staff_all', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING (public.fest_is_staff()) WITH CHECK (public.fest_is_staff())$f$,
      t||'_staff_all', t);
  END LOOP;
END $$;

-- audit_log: staff insert, admin read.
DROP POLICY IF EXISTS fest_audit_admin_read ON public.fest_audit_log;
CREATE POLICY fest_audit_admin_read ON public.fest_audit_log
  FOR SELECT TO authenticated USING (public.app_role() = 'admin');
DROP POLICY IF EXISTS fest_audit_staff_insert ON public.fest_audit_log;
CREATE POLICY fest_audit_staff_insert ON public.fest_audit_log
  FOR INSERT TO authenticated WITH CHECK (public.fest_is_staff());

-- ══════════════════════════════════════════════════════════════════════════════
-- SEED — the current edition + default houses & category bands (§3)
-- ══════════════════════════════════════════════════════════════════════════════
INSERT INTO public.fest_editions (slug, name, theme, year, status, config)
VALUES (
  'meelad-2026', 'Meelad 2026', 'Ihlamudheen Madrasa Meelad Fest', 2026, 'draft',
  jsonb_build_object(
    'caps',              jsonb_build_object('individual', 4, 'group', 2),
    'points_rollup',     'both',                 -- house AND section
    'official_champion', 'house',
    'judge_anonymize',   true,                   -- judges see code numbers
    'grade_thresholds',  jsonb_build_object('A', 80, 'B', 60, 'C', 40),
    'points',            jsonb_build_object(
                           'individual', jsonb_build_object('A', 5, 'B', 3, 'C', 1),
                           'group_multiplier', 2),
    'aggregation',       'average',              -- average | drop_high_low | sum
    'tie_break',         'rank_then_grade_count' -- placeholder; finalized in Phase 4
  )
)
ON CONFLICT (slug) DO NOTHING;

-- Default houses.
INSERT INTO public.fest_houses (edition_id, name, color, sort_order)
SELECT e.id, h.name, h.color, h.ord
FROM public.fest_editions e
CROSS JOIN (VALUES
  ('Green',  '#16a34a', 1),
  ('Blue',   '#2563eb', 2),
  ('Red',    '#dc2626', 3),
  ('Yellow', '#ca8a04', 4)
) AS h(name, color, ord)
WHERE e.slug = 'meelad-2026'
ON CONFLICT (edition_id, name) DO NOTHING;

-- Default category bands (Sub-Junior 1–2 · Junior 3–4 · Senior 5–7 · Super-Senior 8–10).
INSERT INTO public.fest_categories (edition_id, name, min_grade, max_grade, sort_order)
SELECT e.id, c.name, c.lo, c.hi, c.ord
FROM public.fest_editions e
CROSS JOIN (VALUES
  ('Sub-Junior',   1, 2, 1),
  ('Junior',       3, 4, 2),
  ('Senior',       5, 7, 3),
  ('Super-Senior', 8, 10, 4)
) AS c(name, lo, hi, ord)
WHERE e.slug = 'meelad-2026'
ON CONFLICT (edition_id, name) DO NOTHING;
