import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { requireRole } from "@/lib/api-auth"
import { hashPin } from "@/lib/pin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// POST /api/student-pin — admin sets or clears a student's portal PIN.
//   body: { studentId: string, pin: string | null }
//   pin = 4–8 digit string to set; null/"" to clear (no PIN required).
export async function POST(request: Request) {
  const guard = await requireRole(request, ["admin"])
  if (guard.error) return guard.error

  let body: { studentId?: string; pin?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const studentId = (body.studentId ?? "").trim()
  if (!studentId) return NextResponse.json({ error: "studentId required" }, { status: 400 })

  const pin = body.pin == null ? "" : String(body.pin).trim()
  if (pin && !/^\d{4,8}$/.test(pin)) {
    return NextResponse.json({ error: "PIN must be 4–8 digits" }, { status: 400 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 })
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
  const portal_pin_hash = pin ? hashPin(pin) : null
  const { error } = await db.from("students").update({ portal_pin_hash }).eq("id", studentId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, pinSet: !!pin })
}
