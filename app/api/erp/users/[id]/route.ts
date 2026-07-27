import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import type { UserRole } from "@/lib/roles"
import { requireRole } from "@/lib/api-auth"

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// PATCH /api/erp/users/[id] — update role or status
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireRole(request, ["admin"])
  if (guard.error) return guard.error

  const body = await request.json()
  const { role, status, password } = body as { role?: UserRole; status?: "active" | "inactive"; password?: string }

  // Prevent an admin from locking themselves out (demoting or disabling self).
  if (guard.caller.id === id) {
    if (role && role !== "admin") {
      return NextResponse.json({ error: "You cannot change your own role." }, { status: 400 })
    }
    if (status === "inactive") {
      return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 })
    }
  }

  const client = adminClient()
  const update: Record<string, unknown> = {}

  if (role) {
    update.app_metadata = { role }   // authoritative role (not user-writable)
    update.user_metadata = { role }
  }
  if (status) {
    update.ban_duration = status === "inactive" ? "876000h" : "none"
  }
  if (password) {
    update.password = password
  }

  const { error } = await client.auth.admin.updateUserById(id, update)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

// DELETE /api/erp/users/[id] — remove user
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireRole(request, ["admin"])
  if (guard.error) return guard.error

  if (guard.caller.id === id) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 })
  }

  const client = adminClient()
  const { error } = await client.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
