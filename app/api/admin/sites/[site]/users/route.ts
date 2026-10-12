import { NextResponse } from "next/server";
import { authorizeRemote } from "@/lib/remote-sites";
import { isSuperadmin, type Role } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Login-account management for another institution (Grace Valley, PMSA), run
// on that institution's own Supabase project. Super-admins only — see
// lib/remote-sites.ts. Mirrors how those sites create users themselves: an
// auth user (email pre-confirmed) plus the role on its `profiles` row.
const ROLES: Role[] = ["admin", "accountant", "viewer", "pending"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Ctx = { params: Promise<{ site: string }> };
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

// The institute super-admins keep their access everywhere: their role can't be
// changed and their account can't be deleted from here.
async function isProtected(db: NonNullable<Awaited<ReturnType<typeof authorizeRemote>>["db"]>, id: string) {
  const { data } = await db.auth.admin.getUserById(id);
  return isSuperadmin(data?.user?.email);
}

async function authorize(ctx: Ctx) {
  const { site } = await ctx.params;
  return authorizeRemote(site);
}

// GET — every login account with its profile.
export async function GET(_req: Request, ctx: Ctx) {
  const auth = await authorize(ctx);
  if (auth.error !== undefined) return fail(auth.error, auth.status);

  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await auth.db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return fail(error.message, 500);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  const { data: profiles, error } = await auth.db.from("profiles").select("id, full_name, role");
  if (error) return fail(error.message, 500);
  const byId = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]));

  const list = users
    .map((u) => ({
      id: u.id,
      email: u.email ?? "",
      full_name: byId[u.id]?.full_name ?? (u.user_metadata?.full_name as string | undefined) ?? null,
      role: (byId[u.id]?.role ?? "pending") as Role,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
    }))
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));

  return NextResponse.json({ users: list }, { headers: { "Cache-Control": "no-store" } });
}

// POST { name, email, password, role } — create a login account.
export async function POST(req: Request, ctx: Ctx) {
  const auth = await authorize(ctx);
  if (auth.error !== undefined) return fail(auth.error, auth.status);

  const body = (await req.json().catch(() => ({}))) as { name?: string; email?: string; password?: string; role?: Role };
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!name) return fail("Full name is required.");
  if (!email || !EMAIL_RE.test(email)) return fail("A valid email is required.");
  if (password.length < 8) return fail("Password must be at least 8 characters.");
  if (!body.role || !ROLES.includes(body.role) || body.role === "pending") return fail("Choose a role: admin, accountant or viewer.");

  const { data, error } = await auth.db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data?.user) return fail(/already/i.test(error?.message || "") ? "That email already has an account." : error?.message || "Could not create user.");

  // The site's handle_new_user trigger makes a 'pending' profile; set the real
  // role (upsert in case the trigger is missing).
  const { error: pErr } = await auth.db
    .from("profiles")
    .upsert({ id: data.user.id, full_name: name, role: body.role }, { onConflict: "id" });
  if (pErr) {
    await auth.db.auth.admin.deleteUser(data.user.id);
    return fail("User created but role assignment failed — rolled back. Try again.", 500);
  }
  return NextResponse.json({ ok: true, id: data.user.id });
}

// PATCH { id, role?, full_name?, password? } — change role / name / password.
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await authorize(ctx);
  if (auth.error !== undefined) return fail(auth.error, auth.status);

  const body = (await req.json().catch(() => ({}))) as { id?: string; role?: Role; full_name?: string; password?: string };
  if (!body.id) return fail("Missing user id.");

  if (body.password !== undefined) {
    if (body.password.length < 8) return fail("Password must be at least 8 characters.");
    const { error } = await auth.db.auth.admin.updateUserById(body.id, { password: body.password });
    if (error) return fail(error.message);
  }

  const patch: { role?: Role; full_name?: string } = {};
  if (body.role !== undefined) {
    if (await isProtected(auth.db, body.id)) return fail("Super Admin accounts can't have their role changed.", 403);
    if (!ROLES.includes(body.role)) return fail("Unknown role.");
    patch.role = body.role;
  }
  if (body.full_name !== undefined) {
    if (!body.full_name.trim()) return fail("Name can't be empty.");
    patch.full_name = body.full_name.trim();
  }
  if (Object.keys(patch).length) {
    const { error } = await auth.db.from("profiles").update(patch).eq("id", body.id);
    if (error) return fail(error.message);
  }
  return NextResponse.json({ ok: true });
}

// DELETE { id } — remove a login account.
export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await authorize(ctx);
  if (auth.error !== undefined) return fail(auth.error, auth.status);

  const body = (await req.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return fail("Missing user id.");
  if (await isProtected(auth.db, body.id)) return fail("Super Admin accounts can't be deleted.", 403);
  const { error } = await auth.db.auth.admin.deleteUser(body.id);
  if (error) {
    // Entries they made still point at them, so the database refuses.
    if (/foreign key|violates|referenced/i.test(error.message))
      return fail("This user has recorded entries, so they can't be deleted. Set their role to Pending to block access instead.");
    return fail(error.message);
  }
  return NextResponse.json({ ok: true });
}
