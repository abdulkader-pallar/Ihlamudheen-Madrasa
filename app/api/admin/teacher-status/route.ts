import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { requireRole } from "@/lib/api-auth"

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

// POST /api/admin/teacher-status — disable or re-enable a teacher/staff member.
// Disabling keeps all historical data; it only hides the teacher from attendance
// widgets, synthesized absences, EDU-support hours, the staff grid, and payroll
// selection going forward.
export async function POST(request: Request) {
  const guard = await requireRole(request, ["admin"])
  if (guard.error) return guard.error

  const body = await request.json().catch(() => null)
  const teacherId = typeof body?.teacherId === "string" ? body.teacherId.trim() : ""
  const disabled = body?.disabled === true
  if (!teacherId) return NextResponse.json({ error: "teacherId is required" }, { status: 400 })

  const client = adminClient()

  if (disabled) {
    const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : null
    const { error } = await client.from("disabled_teachers").upsert(
      { teacher_id: teacherId, disabled_by: guard.caller.email, reason },
      { onConflict: "teacher_id" },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await client.from("disabled_teachers").delete().eq("teacher_id", teacherId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
