-- ══════════════════════════════════════════════════════════════════════
-- Ihlamudheen Security — Part A (safe, minimal, runs on ANY project)
-- Creates:
--   • public.profiles table + RLS
--   • auto-create trigger for new signups
--   • helper functions is_admin(), is_teacher_or_admin(), is_admin_or_accountant(), is_staff()
--   • backfill of existing users from user_metadata
-- Does NOT touch any other table. After this succeeds, run Part B.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'student'
               CHECK (role IN ('admin', 'teacher', 'accountant', 'student')),
  full_name  TEXT,
  email      TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles: own read"        ON public.profiles;
DROP POLICY IF EXISTS "profiles: admin read"      ON public.profiles;
DROP POLICY IF EXISTS "profiles: admin write"     ON public.profiles;
DROP POLICY IF EXISTS "profiles: own update safe" ON public.profiles;

CREATE POLICY "profiles: own read" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "profiles: admin read" ON public.profiles
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE POLICY "profiles: admin write" ON public.profiles
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE POLICY "profiles: own update safe" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

-- Auto-create profile row on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, email)
  VALUES (
    NEW.id, 'student',
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Helper functions
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_teacher_or_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher'));
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_accountant()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'accountant'));
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'teacher', 'accountant'));
$$;

-- Backfill existing users from user_metadata
INSERT INTO public.profiles (id, role, full_name, email)
SELECT
  u.id,
  CASE WHEN u.raw_user_meta_data ->> 'role' IN ('admin','teacher','accountant','student')
       THEN u.raw_user_meta_data ->> 'role' ELSE 'student' END,
  COALESCE(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', ''),
  u.email
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- Verify: SELECT role, count(*) FROM public.profiles GROUP BY role;
