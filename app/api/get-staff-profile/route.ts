import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { requireRole } from "@/lib/api-auth"

// GET /api/get-staff-profile?name=Staff+Name
// Returns the email and phone of an existing Supabase auth user matched by full_name.
// Used by Staff Onboarding to pre-fill known fields when a roster match is found.
export async function GET(request: Request) {
  const guard = await requireRole(request, ["admin"])
  if (guard.error) return guard.error

  const { searchParams } = new URL(request.url)
  const name = (searchParams.get("name") ?? "").trim()
  if (!name) return NextResponse.json({ found: false })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.json({ found: false })

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (error || !data?.users) return NextResponse.json({ found: false })

    const nameLower = name.toLowerCase()
    const match = data.users.find((u) => {
      const meta = u.user_metadata || {}
      const stored = (meta.full_name || meta.name || "").trim().toLowerCase()
      return stored === nameLower
    })

    if (!match) return NextResponse.json({ found: false })

    return NextResponse.json({
      found: true,
      email: match.email ?? "",
      phone: (match.user_metadata?.phone ?? "").trim(),
    })
  } catch {
    return NextResponse.json({ found: false })
  }
}
