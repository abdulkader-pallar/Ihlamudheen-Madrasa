import { createClient as createSupabase } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSuperadmin } from "@/lib/types";

// SERVER-ONLY access to the other institutions' Supabase projects (see
// lib/sites.ts). Their secret keys bypass RLS, so every caller must pass
// authorizeRemote() first.
const REMOTES: Record<string, { url?: string; key?: string }> = {
  gracevalley: { url: process.env.GRACEVALLEY_SUPABASE_URL, key: process.env.GRACEVALLEY_SUPABASE_SECRET_KEY },
  pmsa: { url: process.env.PMSA_SUPABASE_URL, key: process.env.PMSA_SUPABASE_SECRET_KEY },
};

const connect = (url: string, key: string) =>
  createSupabase(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

type Authorized = { db: ReturnType<typeof connect>; error?: undefined };
type Denied = { error: string; status: number; db?: undefined };

/** Checks the caller is a signed-in super-admin and returns a service-role
 *  client for `site`, or an error to send back. */
export async function authorizeRemote(site: string): Promise<Authorized | Denied> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in", status: 401 };
  if (!isSuperadmin(user.email)) return { error: "Forbidden", status: 403 };

  const remote = REMOTES[site];
  if (!remote) return { error: "Unknown site", status: 404 };
  if (!remote.url || !remote.key) return { error: `Database for ${site} is not configured on the server`, status: 500 };

  return { db: connect(remote.url, remote.key) };
}
