import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

// Browser-side Supabase client (used inside "use client" components).
// Only the PUBLIC url + anon/publishable key are exposed. RLS enforces all access.
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
