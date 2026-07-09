import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { AdminShell } from "@/components/admin/admin-shell";
import type { Profile } from "@/lib/types";

// Always run per-request so auth is checked on the server every time.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // If Supabase isn't configured yet, send to the login screen (which explains it)
  // instead of throwing a server error.
  if (!supabaseConfigured) redirect("/login");

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .single();

  // Signed in but no access profile → sign out and bounce.
  if (!profile) {
    await supabase.auth.signOut();
    redirect("/login?error=no-access");
  }

  return <AdminShell profile={profile as Profile}>{children}</AdminShell>;
}
