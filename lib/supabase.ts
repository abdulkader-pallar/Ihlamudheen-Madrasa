import { SupabaseClient } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase/config'

// Singleton browser client used by pages that call `supabase.from(...)`
// directly. Session is persisted in COOKIES (via
// @supabase/ssr) so Next.js middleware can read it for server-side route gating.
// Reads the same env as this app's lib/supabase/config.ts (accepts either the
// publishable key or the legacy anon JWT).

let _supabase: SupabaseClient | null = null

function getSupabaseClient(): SupabaseClient | null {
  if (_supabase) return _supabase
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  _supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 10 } },
    global: {
      // Prevent the mobile browser from serving stale cached API responses
      fetch: (url: RequestInfo | URL, options: RequestInit = {}) =>
        fetch(url, { ...options, cache: 'no-store' }),
    },
  })
  return _supabase
}

export function isSupabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY)
}

// No-op stubs for build time / when Supabase env is not configured.
const noopBucket = {
  upload: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
  createSignedUrl: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
  remove: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
  getPublicUrl: () => ({ data: { publicUrl: '' } }),
}

const noopQueryBuilder: Record<string, unknown> = {
  select: () => noopQueryBuilder,
  eq: () => noopQueryBuilder,
  neq: () => noopQueryBuilder,
  gte: () => noopQueryBuilder,
  lte: () => noopQueryBuilder,
  in: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
  order: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
  limit: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
  single: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
  then: undefined,
}

const noopFrom = () => ({
  select: () => noopQueryBuilder,
  insert: () => ({
    ...noopQueryBuilder,
    select: () => ({ single: async () => ({ data: null, error: { message: 'Supabase not configured' } }) }),
  }),
  update: () => noopQueryBuilder,
  upsert: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
  delete: () => noopQueryBuilder,
})

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseClient()
    if (!client) {
      if (prop === 'auth') {
        return {
          signInWithPassword: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
          signUp: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
          signOut: async () => ({ error: null }),
          resetPasswordForEmail: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        }
      }
      if (prop === 'from') return noopFrom
      if (prop === 'storage') return { from: () => noopBucket }
      if (prop === 'channel') return () => ({
        on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
      })
      return () => ({})
    }
    return (client as unknown as Record<string, unknown>)[prop as string]
  },
})
