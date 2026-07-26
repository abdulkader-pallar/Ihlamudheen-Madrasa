import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { requireRole } from "@/lib/api-auth"

// Returns a map of teacher name → phone number from Supabase Auth user_metadata
// Only returns phone numbers, never emails (privacy)
export async function GET(request: Request) {
  try {
    const guard = await requireRole(request, ["admin", "accountant"])
    if (guard.error) return guard.error

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ phones: {} })
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: usersData, error } = await adminClient.auth.admin.listUsers()
    if (error || !usersData?.users) {
      return NextResponse.json({ phones: {} })
    }

    // Build name → phone map (only for users with role teacher or admin)
    // Store by BOTH original name AND normalised lowercase key so lookups
    // succeed even when capitalisation differs between courses.ts and Auth metadata.
    const phones: Record<string, string> = {}
    for (const u of usersData.users) {
      const meta = u.user_metadata || {}
      const role = meta.role
      if (role === "teacher" || role === "admin") {
        const name = (meta.full_name || meta.name || "").trim()
        const phone = (meta.phone || "").trim()
        if (name && phone) {
          phones[name] = phone                           // exact match
          phones[name.toLowerCase()] = phone             // normalised fallback
        }
      }
    }

    return NextResponse.json({ phones })
  } catch {
    return NextResponse.json({ phones: {} })
  }
}
