import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasAccess, type Role } from "@/lib/types";

// OAuth (Google / Apple) redirect lands here. We exchange the code for a
// session, then ONLY let the user through if an admin has already registered
// and approved them. Unapproved accounts are signed out immediately.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/admin";

  if (!code) return NextResponse.redirect(`${origin}/login?error=auth`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=auth`);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let role: Role | undefined;
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    role = profile?.role as Role | undefined;
  }

  if (hasAccess(role)) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  // Not a registered/approved user → destroy the session and explain.
  await supabase.auth.signOut();
  return NextResponse.redirect(`${origin}/login?error=unauthorized`);
}
