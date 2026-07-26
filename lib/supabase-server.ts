import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase/config'

type CookieToSet = { name: string; value: string; options: CookieOptions }

// Cookie-based Supabase client for Server Components and Route Handlers.
// Reads the session that the browser client (lib/supabase.ts) persisted in
// cookies via @supabase/ssr, so server-side code can call supabase.auth.getUser().
//
// Next 15: cookies() is async, so this helper is async too.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Invoked from a Server Component, where the cookie store is
          // read-only. Safe to ignore — the middleware refreshes the session
          // cookie on every request instead.
        }
      },
    },
  })
}
