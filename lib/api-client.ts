// ── Authenticated client-side fetch ───────────────────────────────────────────
// Attaches the current Supabase access token as a Bearer header so server route
// handlers (see src/lib/api-auth.ts) can verify the caller's identity & role.
// Use this for every call to a privileged /api/* endpoint.

import { supabase } from "@/lib/supabase"

export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let token: string | undefined
  try {
    const { data } = await supabase.auth.getSession()
    token = data.session?.access_token
  } catch {
    /* not signed in / storage blocked — request proceeds without a token and the
       server guard will reject it with 401 */
  }

  const headers = new Headers(init.headers)
  if (token) headers.set("Authorization", `Bearer ${token}`)

  return fetch(input, { ...init, headers })
}
