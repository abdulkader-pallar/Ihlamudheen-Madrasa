import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, SERVICE_ROLE_KEY } from "@/lib/supabase/admin";
import { isSuperadmin, type Role } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES: Role[] = ["admin", "accountant", "viewer"];

// POST /api/admin/users — create a login account.
// Restricted to the institute super-admins (see SUPERADMIN_EMAILS in
// lib/types.ts). Identity is taken from the caller's httpOnly session cookie,
// verified server-side.
export async function POST(request: Request) {
  if (!SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Server not configured (missing service role key)." }, { status: 500 });
  }

  // ── Authorise: must be signed in AND be the super-admin ──
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isSuperadmin(user.email)) {
    return NextResponse.json({ error: "Only the super-admin can add users." }, { status: 403 });
  }

  let body: { name?: string; email?: string; password?: string; role?: Role };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const role = body.role;

  if (!name) return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  if (password.length < 8)
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  if (!role || !ALLOWED_ROLES.includes(role))
    return NextResponse.json({ error: "Choose a role: admin, accountant or viewer." }, { status: 400 });

  const admin = createAdminClient();

  // Create the auth user (email pre-confirmed so they can log in immediately).
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data?.user) {
    const msg = /already/i.test(error?.message || "") ? "That email already has an account." : (error?.message || "Could not create user.");
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // The handle_new_user trigger created a 'pending' profile — set the real role.
  const { error: pErr } = await admin
    .from("profiles")
    .update({ role, full_name: name })
    .eq("id", data.user.id);
  if (pErr) {
    // Roll back the half-created account so it can't linger as 'pending'.
    await admin.auth.admin.deleteUser(data.user.id);
    return NextResponse.json({ error: "User created but role assignment failed — rolled back. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.user.id });
}
