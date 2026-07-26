import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { verifyPin } from "@/lib/pin"

// Server-side gateway for the (auth-less) student/parent portal to read a single
// child's Quran-recitation history. Mirrors src/app/api/student-report/route.ts:
// recitation_sessions RLS only exposes rows to authenticated staff (or a student
// whose JWT matches), so the public anon key reads nothing. This route funnels
// portal traffic through the service role, scoped to ONE (class_id, roll_no) that
// must exist in the roster, and enforces the same optional per-student PIN.
//
// Read-only: there is no POST here — parents never write recitation scores.

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ROLL_RE = /^[A-Za-z0-9_-]{1,40}$/

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

type StudentRow = { id: string; name: string; portal_pin_hash: string | null }

// Resolve (classId, rollNo) → the roster row, incl. the real students.id PK
// (recitation_sessions.student_id stores students.id, not the roll number).
async function getStudent(db: SupabaseClient, classId: string, rollNo: string): Promise<StudentRow | null> {
  const { data } = await db
    .from("students")
    .select("id, name, portal_pin_hash")
    .eq("class_id", classId)
    .or(`id.eq.${rollNo},roll_no.eq.${rollNo}`) // rollNo is validated against ROLL_RE before use
    .limit(1)
  return data && data.length > 0 ? (data[0] as StudentRow) : null
}

// Enforce the per-student PIN when one is set. Returns a 401 to short-circuit,
// or null when allowed (no PIN set, or the PIN matches).
function pinGate(student: StudentRow, pin: string | null | undefined): NextResponse | null {
  if (!student.portal_pin_hash) return null
  if (!pin) return NextResponse.json({ error: "PIN required", code: "pin_required" }, { status: 401 })
  if (!verifyPin(pin, student.portal_pin_hash)) {
    return NextResponse.json({ error: "Incorrect PIN", code: "pin_invalid" }, { status: 401 })
  }
  return null
}

// GET /api/student-recitation?classId=&rollNo=&pin= → one child's full session list
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const classId = (searchParams.get("classId") ?? "").trim()
  const rollNo = (searchParams.get("rollNo") ?? "").trim()

  if (!classId || !rollNo) return NextResponse.json({ sessions: [] })
  if (!ROLL_RE.test(rollNo)) return NextResponse.json({ error: "Invalid rollNo" }, { status: 400 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ sessions: [] })

  const db = adminClient()
  const student = await getStudent(db, classId, rollNo)
  if (!student) return NextResponse.json({ error: "Unknown student" }, { status: 404 })
  const gate = pinGate(student, searchParams.get("pin"))
  if (gate) return gate

  const { data, error } = await db
    .from("recitation_sessions")
    .select("session_date,pronunciation,tajweed,style,start_stop,total,notes,assessed_by")
    .eq("student_id", student.id)
    .order("session_date", { ascending: true })

  if (error) {
    // Table not migrated yet → degrade to an empty (but successful) response.
    if (error.code === "42P01") return NextResponse.json({ sessions: [], tableMissing: true })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const sessions = (data ?? []).map((r: Record<string, unknown>) => ({
    date: r.session_date as string,
    pronunciation: Number(r.pronunciation ?? 0),
    tajweed: Number(r.tajweed ?? 0),
    style: Number(r.style ?? 0),
    startStop: Number(r.start_stop ?? 0),
    total: Number(r.total ?? 0),
    notes: (r.notes as string) ?? "",
    assessedBy: (r.assessed_by as string) ?? "",
  }))

  return NextResponse.json({ sessions, studentName: student.name })
}
