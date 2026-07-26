// ── Server-side API authentication & authorization guard ──────────────────────
// Every privileged route handler must call requireRole()/authenticate() before
// using the service-role admin client. Identity is derived from the caller's
// Supabase access token (Authorization: Bearer <jwt>), verified server-side.
//
// SECURITY: role is read ONLY from app_metadata. user_metadata is writable by
// the user (supabase.auth.updateUser({ data: { role } })) and must never be
// trusted for authorization. See src/lib/roles.ts and the RLS migration
// 20260603000000_security_rls_app_metadata.sql.

import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import type { UserRole } from "@/lib/roles"

export interface AuthedCaller {
  id: string
  email: string | null
  role: UserRole
}

type GuardResult =
  | { caller: AuthedCaller; error?: undefined }
  | { caller?: undefined; error: NextResponse }

function resolveAppRole(appMetadata: Record<string, unknown> | undefined): UserRole {
  const r = appMetadata?.role
  if (r === "admin" || r === "accountant" || r === "teacher" || r === "student") return r
  return "student"
}

/**
 * Verify the caller's access token and return their identity + app_metadata role.
 * Returns a 401 NextResponse in `error` when the token is missing/invalid.
 */
export async function authenticate(req: Request): Promise<GuardResult> {
  const header = req.headers.get("authorization") ?? ""
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : ""
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized — missing bearer token" }, { status: 401 }) }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return { error: NextResponse.json({ error: "Auth not configured on server" }, { status: 500 }) }
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await client.auth.getUser(token)
  if (error || !data?.user) {
    return { error: NextResponse.json({ error: "Unauthorized — invalid session" }, { status: 401 }) }
  }

  return {
    caller: {
      id: data.user.id,
      email: data.user.email ?? null,
      role: resolveAppRole(data.user.app_metadata as Record<string, unknown> | undefined),
    },
  }
}

/**
 * Verify the caller is authenticated AND holds one of the allowed roles.
 * Returns a 401/403 NextResponse in `error` when the check fails.
 *
 *   const guard = await requireRole(req, ["admin"])
 *   if (guard.error) return guard.error
 *   // guard.caller.id / .role are now trusted
 */
export async function requireRole(req: Request, allowed: UserRole[]): Promise<GuardResult> {
  const res = await authenticate(req)
  if (res.error) return res
  if (!allowed.includes(res.caller.role)) {
    return { error: NextResponse.json({ error: "Forbidden — insufficient role" }, { status: 403 }) }
  }
  return res
}

/**
 * Generate a strong, random temporary password for newly-provisioned accounts.
 * Never ship a shared/hardcoded default — each account gets a unique secret that
 * the user is expected to rotate on first login.
 */
export function generateTempPassword(): string {
  const raw = `${randomUUID()}${randomUUID()}`.replace(/-/g, "")
  // Mixed-case + digit + symbol so it satisfies common password policies.
  return `Rp${raw.slice(0, 14)}!${raw.slice(14, 16).toUpperCase()}`
}
