import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

// Server-ONLY Supabase client that uses the service_role / secret key. It
// bypasses Row Level Security, so it must NEVER be imported into a client
// component or exposed to the browser — use it only inside route handlers
// (app/api/**) after the caller has been authorised.
//
// The secret key is read from SUPABASE_SERVICE_ROLE_KEY, falling back to the
// existing NEXT_SECRET_SUPABASE_SECRET_KEY that this project already sets.
export const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_SECRET_SUPABASE_SECRET_KEY;

export function createAdminClient() {
  if (!SERVICE_ROLE_KEY) throw new Error("Service role key not configured on the server");
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
