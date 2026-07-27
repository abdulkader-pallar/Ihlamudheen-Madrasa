import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { authenticate } from "@/lib/api-auth"

// Master list of authorized emails — must match setup-teachers/route.ts exactly.
// teacherId must match the IDs used in src/data/courses.ts (initialTeachers).
// Add your own staff here; keys are lower-cased emails. Keep in sync with
// setup-teachers/route.ts. Only the super-admin is seeded by default.
const AUTHORIZED: Record<string, { role: "admin" | "teacher" | "accountant"; name: string; teacherId?: string }> = {
  "cryptolife676@gmail.com":     { role: "admin", name: "Administrator" },
  "abdulkaderpallar@gmail.com":  { role: "admin", name: "Administrator" },
}

export async function POST(req: NextRequest) {
  try {
    // Identity comes from the verified session token — NEVER from the request
    // body. This is self-service role assignment: a signed-in user can only ever
    // claim the role their OWN (allow-listed) email maps to.
    const auth = await authenticate(req)
    if (auth.error) return auth.error

    const userId = auth.caller.id
    const normalized = (auth.caller.email ?? "").toLowerCase().trim()
    const authorized = AUTHORIZED[normalized]

    if (!authorized) {
      return NextResponse.json({ authorized: false })
    }

    // Assign the role to this user via admin API (works even for new Google OAuth accounts)
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    // The allow-list is the SEED role for first-time sign-ins. Once an account
    // has a role, that role is authoritative — an admin may have changed it in
    // User Management (e.g. teacher → accountant). Re-stamping the allow-list
    // role on every sign-in would silently revert those changes, which looks
    // like "the role won't save across devices". So we only seed when no role
    // is set yet, and otherwise preserve whatever is already assigned.
    let effectiveRole: "admin" | "accountant" | "teacher" | "student" = authorized.role
    if (serviceKey) {
      const adminClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )

      const { data: existing } = await adminClient.auth.admin.getUserById(userId)
      const currentRole = existing?.user?.app_metadata?.role
      if (currentRole === "admin" || currentRole === "accountant" || currentRole === "teacher" || currentRole === "student") {
        // Already provisioned — keep the admin-assigned role.
        effectiveRole = currentRole
      }

      await adminClient.auth.admin.updateUserById(userId, {
        app_metadata: { role: effectiveRole },   // authoritative role (not user-writable)
        user_metadata: {
          role: effectiveRole,
          full_name: authorized.name,
          // Explicitly null when no teacherId so stale values are cleared on every sign-in
          teacher_id: authorized.teacherId ?? null,
        },
      })
    }

    return NextResponse.json({ authorized: true, role: effectiveRole })
  } catch (err) {
    return NextResponse.json({ authorized: false, error: String(err) }, { status: 500 })
  }
}
