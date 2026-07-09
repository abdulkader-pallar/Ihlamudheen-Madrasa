// Public Supabase connection values (safe to expose in the browser).
// Accepts EITHER the new "publishable" key (sb_publishable_...) or the legacy
// "anon" JWT key — whichever env var you set. Security is enforced by RLS.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!;

export const supabaseConfigured =
  !!SUPABASE_URL && !!SUPABASE_ANON_KEY && !/PASTE_YOUR/.test(SUPABASE_ANON_KEY);
