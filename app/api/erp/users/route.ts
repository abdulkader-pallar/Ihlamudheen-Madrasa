import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import type { UserRole } from "@/lib/roles"
import { requireRole, generateTempPassword } from "@/lib/api-auth"

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function resolveRole(user: { app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }): UserRole {
  const r = user.app_metadata?.role ?? user.user_metadata?.role
  if (r === "admin" || r === "accountant" || r === "teacher" || r === "student") return r
  return "student"
}

// GET /api/admin/users — list all auth users
export async function GET(request: Request) {
  // Accountants need the roster to add users via User Management (read-only);
  // mutations (PATCH/DELETE) remain admin-only.
  const guard = await requireRole(request, ["admin", "accountant"])
  if (guard.error) return guard.error

  const client = adminClient()
  const { data, error } = await client.auth.admin.listUsers({ perPage: 1000 })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const users = data.users.map((u) => ({
    id: u.id,
    name: (u.user_metadata?.full_name ?? u.user_metadata?.name ?? u.email ?? "—") as string,
    email: u.email ?? "—",
    idNumber: (u.user_metadata?.id_number ?? "") as string,
    phone: (u.user_metadata?.phone ?? "") as string,
    gender: (u.user_metadata?.gender ?? "") as string,
    role: resolveRole(u),
    status: u.banned_until ? "inactive" : "active",
    joinDate: u.created_at ? u.created_at.split("T")[0] : "—",
    lastLogin: u.last_sign_in_at ? u.last_sign_in_at.split("T")[0] : "—",
  }))

  return NextResponse.json({ users })
}

// POST /api/admin/users — create a new user
export async function POST(request: Request) {
  const guard = await requireRole(request, ["admin", "accountant"])
  if (guard.error) return guard.error

  const body = await request.json()
  const { name, email, role, password, idNumber, phone, gender } = body as {
    name: string; email: string; role: UserRole; password?: string; idNumber?: string; phone?: string; gender?: string
  }

  const cleanName = name?.trim()
  const cleanEmail = email?.trim()
  const cleanId = idNumber?.trim()
  const cleanPhone = phone?.trim()
  const cleanGender = gender?.trim().toLowerCase()

  // Adding a user enrols a real person — all core identity fields are mandatory.
  if (!cleanName || !cleanEmail || !role || !cleanId || !cleanPhone || !cleanGender) {
    return NextResponse.json(
      { error: "name, email, role, idNumber, phone, and gender are required" },
      { status: 400 }
    )
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 })
  }
  if (!/^[0-9+()\-\s]{6,}$/.test(cleanPhone)) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 })
  }
  if (cleanGender !== "male" && cleanGender !== "female") {
    return NextResponse.json({ error: "Invalid gender" }, { status: 400 })
  }

  // Accountants may add users but must not create admins (privilege escalation).
  if (guard.caller.role === "accountant" && role === "admin") {
    return NextResponse.json({ error: "Accountants cannot create admin accounts." }, { status: 403 })
  }

  // No shared default credential — each new account gets a unique temp password
  // that the admin relays to the user, who rotates it on first login.
  const tempPassword = password?.trim() || generateTempPassword()

  const client = adminClient()
  const { data, error } = await client.auth.admin.createUser({
    email: cleanEmail,
    password: tempPassword,
    email_confirm: true,
    app_metadata: { role },              // authoritative role (not user-writable)
    user_metadata: {
      full_name: cleanName,
      name: cleanName,
      role,
      id_number: cleanId,
      phone: cleanPhone,
      gender: cleanGender,
    },
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return the generated password ONLY when we generated it (so the admin can
  // share it once). When the admin supplied their own, we don't echo it back.
  return NextResponse.json({ id: data.user.id, tempPassword: password?.trim() ? undefined : tempPassword })
}
