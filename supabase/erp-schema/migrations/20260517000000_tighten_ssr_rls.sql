-- ============================================================
-- Tighten RLS on student_self_reports
-- Previous policy allowed anonymous DELETE of any row.
-- New policies: anon can INSERT and UPDATE (needed for the
-- student portal upsert), but NOT delete.  SELECT is open
-- so the teacher dashboard can fetch class reports via the
-- anon key.  DELETE is restricted to service_role only.
-- ============================================================

-- Drop the overly-permissive blanket policy
DROP POLICY IF EXISTS "student_self_reports_public" ON public.student_self_reports;

-- 1. Anon can read all rows (teacher dashboard fetches via anon key)
CREATE POLICY "ssr_anon_select"
  ON public.student_self_reports
  FOR SELECT TO anon
  USING (true);

-- 2. Anon can insert new rows (student portal upsert)
CREATE POLICY "ssr_anon_insert"
  ON public.student_self_reports
  FOR INSERT TO anon
  WITH CHECK (true);

-- 3. Anon can update existing rows (student portal upsert on conflict)
CREATE POLICY "ssr_anon_update"
  ON public.student_self_reports
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- 4. Only service_role can delete (admin cleanup via server-side client)
CREATE POLICY "ssr_service_delete"
  ON public.student_self_reports
  FOR DELETE TO service_role
  USING (true);

-- 5. Service role has full access (for server-side operations)
CREATE POLICY "ssr_service_all"
  ON public.student_self_reports
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
