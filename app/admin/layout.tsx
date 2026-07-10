import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { AdminShell } from "@/components/admin/admin-shell";
import { hasAccess, type Profile } from "@/lib/types";

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
  const profileWithEmail = profile ? { ...profile, email: user.email } : profile;

  // Signed in but not a registered/approved user (no profile, or role still
  // "pending") → sign out and bounce. This blocks unregistered Google/Apple
  // sign-ins from ever reaching the portal.
  if (!profile || !hasAccess(profile.role)) {
    await supabase.auth.signOut();
    redirect(profile ? "/login?error=unauthorized" : "/login?error=no-access");
  }

  return <AdminShell profile={profileWithEmail as Profile}>{children}</AdminShell>;
}
