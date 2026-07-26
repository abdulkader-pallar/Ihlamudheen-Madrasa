import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { requireRole } from "@/lib/api-auth"
import { POST as processZkPunch } from "@/app/api/zk-attendance/route"
import { ZK_DEVICE_ID_MAP } from "@/data/courses"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// POST /api/admin/reprocess-punches — admin-only backfill.
// Re-feeds ONLY the genuinely-unmatched raw device punches (audit's FAILED rows)
// back through the SAME /api/zk-attendance classification + write pipeline.
// Because that pipeline is now corrected (e.g. EDU Support Friday OUT punches),
// reprocessing records the rows that were previously dropped. Already-matched
// punches are deliberately excluded — replaying them would re-trigger the
// "second punch → departure" update and overwrite good attendance times.
// Safe to re-run: matched punches are skipped, and punches still outside a
// tracked window simply skip again.
export async function POST(request: Request) {
  const guard = await requireRole(request, ["admin"])
  if (guard.error) return guard.error

  if (!process.env.ZK_API_KEY) {
    return NextResponse.json({ error: "ZK_API_KEY not configured on server" }, { status: 500 })
  }

  const body = await request.json().catch(() => null)
  const startDate = typeof body?.startDate === "string" ? body.startDate.trim() : ""
  const endDate   = typeof body?.endDate === "string" ? body.endDate.trim() : ""
  const deviceUserId = Number.isFinite(body?.deviceUserId) ? Number(body.deviceUserId) : null

  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return NextResponse.json({ error: "startDate and endDate (YYYY-MM-DD) are required" }, { status: 400 })
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: "startDate must be on or before endDate" }, { status: 400 })
  }

  const db = adminClient()

  // Pull the raw device punches in the requested window. NOTE: in this system the
  // raw-punch `status` column is left null even for punches that DID become an
  // attendance row, so "status IS NULL" alone is NOT the failed set — it includes
  // already-matched punches. Re-feeding an already-matched punch would make the
  // pipeline treat it as a second punch and overwrite a good departure_time, which
  // corrupts records and INCREASES the failed count. So below we additionally
  // exclude any punch that already matches an attendance arrival/departure.
  let query = db
    .from("zk_raw_punches")
    .select("id, device_user_id, punch_date, punch_time, status")
    .gte("punch_date", startDate)
    .lte("punch_date", endDate)
    .order("punch_date", { ascending: true })
    .order("punch_time", { ascending: true })

  if (deviceUserId !== null) query = query.eq("device_user_id", deviceUserId)

  const { data: rawPunches, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Build the set of punch times already represented in attendance so we only
  // reprocess GENUINELY-unmatched punches (mirrors the audit's MATCHED check).
  const { data: attendance, error: attErr } = await db
    .from("staff_attendance")
    .select("teacher_id, date, arrival_time, departure_time")
    .gte("date", startDate)
    .lte("date", endDate)
  if (attErr) return NextResponse.json({ error: attErr.message }, { status: 500 })

  const hhmm = (t: string | null) => (t ? String(t).slice(0, 5) : null)
  const matchedKeys = new Set<string>()
  for (const a of attendance ?? []) {
    const arr = hhmm(a.arrival_time as string | null)
    const dep = hhmm(a.departure_time as string | null)
    if (arr) matchedKeys.add(`${a.teacher_id}|${a.date}|${arr}`)
    if (dep) matchedKeys.add(`${a.teacher_id}|${a.date}|${dep}`)
  }

  // Keep only punches that map to a known device user AND are not already matched.
  const failed = (rawPunches ?? []).filter((p) => {
    const teacherId = ZK_DEVICE_ID_MAP[p.device_user_id]
    if (!teacherId) return false   // unmapped device user — nothing to record
    const time = String(p.punch_time).slice(0, 5)
    return !matchedKeys.has(`${teacherId}|${p.punch_date}|${time}`)
  })

  const summary = { total: failed.length, recorded: 0, skipped: 0, errored: 0 }
  const details: Array<{ deviceUserId: number; date: string; time: string; outcome: string; note?: string }> = []

  for (const p of failed) {
    const time = String(p.punch_time).slice(0, 5)   // normalise "HH:MM:SS" → "HH:MM"
    const req = new Request("http://internal/api/zk-attendance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceUserId: p.device_user_id,
        punchDate: p.punch_date,
        punchTime: time,
        apiKey: process.env.ZK_API_KEY,
      }),
    })

    try {
      const res = await processZkPunch(req)
      const result = await res.json().catch(() => ({}))
      if (result?.ok || result?.updated) {
        summary.recorded++
        details.push({ deviceUserId: p.device_user_id, date: p.punch_date, time, outcome: "recorded", note: result.updated || result.note })
      } else if (result?.skipped) {
        summary.skipped++
        details.push({ deviceUserId: p.device_user_id, date: p.punch_date, time, outcome: "skipped", note: result.reason })
      } else {
        summary.errored++
        details.push({ deviceUserId: p.device_user_id, date: p.punch_date, time, outcome: "error", note: result.error })
      }
    } catch (err) {
      summary.errored++
      details.push({ deviceUserId: p.device_user_id, date: p.punch_date, time, outcome: "error", note: String(err) })
    }
  }

  return NextResponse.json({ ok: true, range: { startDate, endDate }, summary, details })
}
