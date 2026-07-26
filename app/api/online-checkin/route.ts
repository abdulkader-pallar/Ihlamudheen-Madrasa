// Online self check-in / check-out for staff (July/August online months).
//
// A tap on the My Attendance "Check In / Check Out" button lands here and is
// treated as a virtual fingerprint punch: the SERVER derives UAE time (the
// client never sends a timestamp), classifyPunch decides windows/late tiers,
// and the pure planner in src/lib/online-checkin.ts maps the action to one
// insert/update on staff_attendance with session_type "online".
//
// GET  → today's status for the caller (feature-enabled, records, next action)
// POST → perform the punch
//
// Active only when the current UAE month appears in the app_settings key
// "online_checkin_months" — the ZKTeco route (/api/zk-attendance) is untouched
// and takes over again when the device returns.

import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { requireRole, type AuthedCaller } from "@/lib/api-auth"
import { initialTeachers, type TeacherData, type TeacherPayType } from "@/data/courses"
import { resolveTeacherId, resolveTeacherIdByEmail } from "@/lib/teacher-identity"
import { planOnlinePunch, type TodayRecord } from "@/lib/online-checkin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabase() {
  // Service role — the server clock is authoritative and writes bypass RLS.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

interface CheckinContext {
  supabase: ReturnType<typeof getSupabase>
  caller: AuthedCaller
  enabled: boolean
  month: string      // "YYYY-MM" (UAE)
  punchDate: string  // "YYYY-MM-DD" (UAE)
  punchTime: string  // "HH:MM" (UAE)
  teacherId: string | null
  teacher: TeacherData | null
  disabled: boolean
  todayRecords: TodayRecord[]
}

async function buildContext(request: Request): Promise<{ ctx?: CheckinContext; error?: NextResponse }> {
  const guard = await requireRole(request, ["teacher", "admin", "accountant"])
  if (guard.error) return { error: guard.error }
  const caller = guard.caller

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured on server" }, { status: 500 }) }
  }
  const supabase = getSupabase()

  // ── Server-authoritative UAE time (UTC+4) — zk-attendance pattern ──
  const uaeNow = new Date(Date.now() + 4 * 60 * 60 * 1000)
  const iso = uaeNow.toISOString()
  const punchDate = iso.slice(0, 10)
  const punchTime = iso.slice(11, 16)
  const month = iso.slice(0, 7)

  // ── Month gating from app_settings ──
  let enabled = false
  {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "online_checkin_months").single()
    try {
      const months = JSON.parse(data?.value ?? "[]")
      enabled = Array.isArray(months) && months.includes(month)
    } catch {
      enabled = false
    }
  }

  // ── Resolve caller → teacher ──
  let teacherId = resolveTeacherIdByEmail(caller.email)
  if (!teacherId) {
    // Fallback: metadata-based resolution (teacher_id / full_name) via a
    // service lookup — only needed when the email map misses.
    const { data } = await supabase.auth.admin.getUserById(caller.id)
    if (data?.user) {
      teacherId = resolveTeacherId({
        email: data.user.email,
        app_metadata: data.user.app_metadata,
        user_metadata: data.user.user_metadata,
      })
    }
  }

  let teacher: TeacherData | null = null
  if (teacherId) {
    teacher = initialTeachers.find((t) => t.id === teacherId) ?? null
    if (!teacher) {
      // DB fallback for dynamically-added staff (mirrors zk-attendance route)
      const { data: dbStaff } = await supabase.from("staff_members").select("*").eq("id", teacherId).single()
      if (dbStaff) {
        teacher = {
          id: dbStaff.id,
          name: dbStaff.name,
          transportAllowance: dbStaff.transport_allowance ?? false,
          classIds: dbStaff.class_ids ?? [],
          payType: dbStaff.pay_type as TeacherPayType,
          dualPayType: (dbStaff.dual_pay_type as TeacherPayType | null) ?? undefined,
          fixedMonthlyRate: dbStaff.fixed_monthly_rate ?? undefined,
          dailyRate: dbStaff.daily_rate ?? undefined,
          teachesCibis: dbStaff.teaches_cibis ?? false,
          teachesMadrasa: dbStaff.teaches_madrasa ?? false,
        }
      }
    }
  }

  // ── Disabled staff cannot check in ──
  let disabled = false
  if (teacherId) {
    const { data } = await supabase.from("disabled_teachers").select("teacher_id").eq("teacher_id", teacherId)
    disabled = (data ?? []).length > 0
  }

  // ── Today's records (duplicate / open-record detection) ──
  let todayRecords: TodayRecord[] = []
  if (teacherId) {
    const { data } = await supabase
      .from("staff_attendance")
      .select("id, session, arrival_time, departure_time, sessions_credited, out_missing")
      .eq("teacher_id", teacherId)
      .eq("date", punchDate)
    todayRecords = (data ?? []) as TodayRecord[]
  }

  return { ctx: { supabase, caller, enabled, month, punchDate, punchTime, teacherId, teacher, disabled, todayRecords } }
}

function suggestedAction(todayRecords: TodayRecord[]): "check-in" | "check-out" {
  const open = todayRecords.some((r) => r.arrival_time && !r.departure_time)
  return open ? "check-out" : "check-in"
}

export async function GET(request: Request) {
  const { ctx, error } = await buildContext(request)
  if (error) return error
  const { enabled, month, punchDate, punchTime, teacherId, teacher, disabled, todayRecords } = ctx!

  return NextResponse.json({
    enabled,
    month,
    serverDate: punchDate,
    serverTime: punchTime,
    resolved: !!teacher,
    teacherId,
    teacherName: teacher?.name ?? null,
    disabled,
    todayRecords,
    suggestedAction: suggestedAction(todayRecords),
  })
}

export async function POST(request: Request) {
  const { ctx, error } = await buildContext(request)
  if (error) return error
  const { supabase, caller, enabled, punchDate, punchTime, teacherId, teacher, disabled, todayRecords } = ctx!

  if (!enabled) {
    return NextResponse.json({ error: "Online self check-in is not active for this month" }, { status: 403 })
  }
  if (!teacherId || !teacher) {
    return NextResponse.json({ error: "Your account is not linked to a staff profile — contact admin" }, { status: 404 })
  }
  if (disabled) {
    return NextResponse.json({ error: "This staff profile is disabled — contact admin" }, { status: 403 })
  }

  const plan = planOnlinePunch({
    punchDate,
    punchTime,
    teacher: { id: teacher.id, transportAllowance: teacher.transportAllowance === true },
    flags: {
      teachesEnglish: teacher.payType === "per-day-english" || teacher.dualPayType === "per-day-english",
      teachesCibis: teacher.teachesCibis === true,
      isOffice: teacher.payType === "monthly-office",
      isCleaning: teacher.payType === "monthly-cleaning",
      isDriver: teacher.payType === "daily-driver",
      isEduSupport: teacher.payType === "monthly-edu-support",
    },
    todayRecords,
    actorEmail: caller.email ?? caller.id,
  })

  if (plan.op === "reject") {
    return NextResponse.json({ rejected: true, reason: plan.reason })
  }

  if (plan.op === "insert") {
    const { error: insErr } = await supabase.from("staff_attendance").insert(plan.values)
    if (insErr) {
      // Concurrent double-tap → unique violation on (teacher_id, date, session)
      if (insErr.code === "23505") {
        return NextResponse.json({ rejected: true, reason: "Already recorded — refresh and try again" })
      }
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, message: plan.message, punchDate, punchTime })
  }

  // update
  const { error: updErr } = await supabase.from("staff_attendance").update(plan.values).eq("id", plan.recordId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  return NextResponse.json({ ok: true, message: plan.message, punchDate, punchTime })
}
