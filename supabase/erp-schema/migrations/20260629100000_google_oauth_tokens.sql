-- ══════════════════════════════════════════════════════════════════════
-- Google OAuth token storage (lesson-plan uploads "as the user")
--
-- A service account has no Drive storage of its own, so on a personal Google
-- account its uploads are rejected. Instead the institute connects their own
-- Google account once (OAuth consent); we store the refresh token here and the
-- server uploads as that user — files are owned by them and land in their Drive.
--
-- Single-row table. RLS is enabled with NO policies, so it is only reachable
-- via the service-role key (server-side). The refresh token is never exposed
-- to the browser.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.google_oauth_tokens (
  id            int PRIMARY KEY DEFAULT 1,
  refresh_token text,
  email         text,
  scope         text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_oauth_singleton CHECK (id = 1)
);

ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: only the service-role key (server) can read/write this table.
