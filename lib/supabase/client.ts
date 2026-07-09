import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client (used inside "use client" components).
// Only the PUBLIC url + anon key are exposed. RLS enforces all access.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
