import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { verifyPin } from "@/lib/pin"

// Server-side gateway for the (auth-less) student activity portal.
// The portal previously read/wrote `student_self_reports` directly via the anon
// key, which RLS exposed as read-all + write-all. This route funnels portal
// traffic through the service role, scoped to a SINGLE (class_id, roll_no) that
// must exist in the roster — eliminating bulk reads and arbitrary-row tampering.
// An optional per-student PIN (students.portal_pin_hash, set via /api/student-pin)
// is enforced here when present — a NULL hash means no PIN required (backward compatible).

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DAY_KEYS = new Set(["sat", "sun", "mon", "tue", "wed", "thu", "fri"])
const ROLL_RE = /^[A-Za-z0-9_-]{1,40}$/

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

type StudentRow = { portal_pin_hash: string | null }

// Look up (classId, rollNo) in the roster (service-role read). Returns the row
// incl. the PIN hash, or null if there is no such enrolled student.
async function getStudent(db: SupabaseClient, classId: string, rollNo: string): Promise<StudentRow | null> {
  const { data } = await db
    .from("students")
    .select("id, portal_pin_hash")
    .eq("class_id", classId)
    .or(`id.eq.${rollNo},roll_no.eq.${rollNo}`) // rollNo is validated against ROLL_RE before use
    .limit(1)
  return data && data.length > 0 ? (data[0] as StudentRow) : null
}

// Enforce the per-student PIN when one is set. Returns a 401 response to
// short-circuit, or null when allowed (no PIN set, or the PIN matches).
function pinGate(student: StudentRow, pin: string | null | undefined): NextResponse | null {
  if (!student.portal_pin_hash) return null
  if (!pin) return NextResponse.json({ error: "PIN required", code: "pin_required" }, { status: 401 })
  if (!verifyPin(pin, student.portal_pin_hash)) {
    return NextResponse.json({ error: "Incorrect PIN", code: "pin_invalid" }, { status: 401 })
  }
  return null
}

// GET /api/student-report?classId=&rollNo=&weekKey= → one student's week of rows
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const classId = (searchParams.get("classId") ?? "").trim()
  const rollNo = (searchParams.get("rollNo") ?? "").trim()
  const weekKey = (searchParams.get("weekKey") ?? "").trim()

  if (!classId || !rollNo || !weekKey) return NextResponse.json({ rows: [] })
  if (!ROLL_RE.test(rollNo)) return NextResponse.json({ error: "Invalid rollNo" }, { status: 400 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ rows: [] })

  const db = adminClient()
  const student = await getStudent(db, classId, rollNo)
  if (!student) return NextResponse.json({ error: "Unknown student" }, { status: 404 })
  const gate = pinGate(student, searchParams.get("pin"))
  if (gate) return gate

  const cols = "day_key,fajr,dhuhr,asr,maghrib,isha,quran,reading,writing,custom_data,submitted_at"
  const full = await db
    .from("student_self_reports")
    .select(cols)
    .eq("class_id", classId)
    .eq("roll_no", rollNo)
    .eq("week_key", weekKey)
  if (!full.error) return NextResponse.json({ rows: full.data ?? [] })

  // custom_data column may not exist yet — fall back to base columns.
  const base = await db
    .from("student_self_reports")
    .select("day_key,fajr,dhuhr,asr,maghrib,isha,quran,reading,writing")
    .eq("class_id", classId)
    .eq("roll_no", rollNo)
    .eq("week_key", weekKey)
  return NextResponse.json({ rows: base.data ?? [] })
}

// POST /api/student-report → upsert a single day's row for one student
export async function POST(request: Request) {
  let body: {
    classId?: string; rollNo?: string; weekKey?: string; dayKey?: string
    report?: Record<string, unknown>; customData?: Record<string, boolean>; isSubmit?: boolean; pin?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const classId = (body.classId ?? "").trim()
  const rollNo = (body.rollNo ?? "").trim()
  const weekKey = (body.weekKey ?? "").trim()
  const dayKey = (body.dayKey ?? "").trim()

  if (!classId || !rollNo || !weekKey || !dayKey) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }
  if (!DAY_KEYS.has(dayKey)) return NextResponse.json({ error: "Invalid dayKey" }, { status: 400 })
  if (!ROLL_RE.test(rollNo)) return NextResponse.json({ error: "Invalid rollNo" }, { status: 400 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 })
  }

  const db = adminClient()
  const student = await getStudent(db, classId, rollNo)
  if (!student) return NextResponse.json({ error: "Unknown student" }, { status: 404 })
  const gate = pinGate(student, body.pin)
  if (gate) return gate

  // Whitelist the activity booleans — never persist arbitrary client keys.
  const r = body.report ?? {}
  const payload: Record<string, unknown> = {
    class_id: classId,
    roll_no: rollNo,
    week_key: weekKey,
    day_key: dayKey,
    fajr: !!r.fajr, dhuhr: !!r.dhuhr, asr: !!r.asr, maghrib: !!r.maghrib, isha: !!r.isha,
    quran: !!r.quran, reading: !!r.reading, writing: !!r.writing,
    custom_data: body.customData && typeof body.customData === "object" ? body.customData : {},
    updated_at: new Date().toISOString(),
  }
  if (body.isSubmit) payload.submitted_at = new Date().toISOString()

  const onConflict = "class_id,roll_no,week_key,day_key"
  const first = await db.from("student_self_reports").upsert(payload, { onConflict })
  if (first.error) {
    // custom_data column may not exist yet — retry without it.
    delete payload.custom_data
    const retry = await db.from("student_self_reports").upsert(payload, { onConflict })
    if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
