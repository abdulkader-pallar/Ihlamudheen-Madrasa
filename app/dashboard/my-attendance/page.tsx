"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { motion } from "framer-motion"
import { Clock, AlertTriangle, CheckCircle2, CalendarDays, Info, Sparkles, ChevronLeft, ChevronRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { supabase } from "@/lib/supabase"
import { initialTeachers } from "@/data/courses"
import { resolveTeacherId } from "@/lib/teacher-identity"
import { OnlineCheckinCard } from "@/components/online-checkin-card"

// ── Helpers ────────────────────────────────────────────────────────────────────
function toYYYYMM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" })
}

function nextMonthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number)
  return new Date(y, m, 1).toLocaleString("en-US", { month: "long", year: "numeric" })
}

function shiftMonth(yyyymm: string, delta: number): string {
  const [y, m] = yyyymm.split("-").map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return toYYYYMM(d)
}

/** ms from now until target Date — clamps to 0 if already past */
function msUntil(target: Date): number {
  return Math.max(0, target.getTime() - Date.now())
}

/** Last day of the month as a Date */
function lastDayOf(y: number, m: number): Date {
  return new Date(y, m, 0) // day 0 of next month = last day of this month
}

// ── DB record type ─────────────────────────────────────────────────────────────
interface AttRec {
  id: number
  date: string
  session: string
  status: string
  late_category: number | null
  early_departure_category: number | null
  sessions_credited: number | null
  arrival_time: string | null
  departure_time: string | null
  out_missing: boolean | null
}

// ── Badge helpers ──────────────────────────────────────────────────────────────
const SESSION_LABEL: Record<string, string> = {
  morning:      "Morning",
  afternoon:    "Afternoon",
  full:         "Full Day",
  evening:      "Evening",
  "edu-makeup": "Makeup",
  cibis:        "CIBIS",
}

function sessionBadge(session: string) {
  const label = SESSION_LABEL[session] ?? session
  const colors: Record<string, string> = {
    morning:      "bg-teal-500/20 text-teal-300",
    afternoon:    "bg-sky-500/20 text-sky-300",
    full:         "bg-emerald-500/20 text-emerald-300",
    evening:      "bg-pink-500/20 text-pink-300",
    "edu-makeup": "bg-violet-500/20 text-violet-300",
    cibis:        "bg-amber-500/20 text-amber-300",
  }
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", colors[session] ?? "bg-slate-700 text-slate-300")}>
      {label}
    </span>
  )
}

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// ── Page ───────────────────────────────────────────────────────────────────────
export default function MyAttendancePage() {
  const { user } = useAuth(true)

  // `now` drives the real current month and transition timers — only updated by scheduled timeouts.
  // `viewMonth` is what the user is browsing; defaults to current month, can go back.
  const [now, setNow]               = useState(() => new Date())
  const [viewMonth, setViewMonth]   = useState(() => toYYYYMM(new Date()))
  const [records, setRecords]       = useState<AttRec[]>([])
  const [carryIn, setCarryIn]       = useState(0)   // minus marks carried from months before viewMonth
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [transitioning, setTransitioning] = useState(false)

  const currentMonth = toYYYYMM(now)
  const isCurrentMonth = viewMonth === currentMonth
  const teacherId    = user ? resolveTeacherId(user) : null
  const teacher      = teacherId ? initialTeachers.find((t) => t.id === teacherId) : null

  // ── Schedule the two boundary events for the current month ──────────────────
  const timerRef = useRef<{ t1?: ReturnType<typeof setTimeout>; t2?: ReturnType<typeof setTimeout> }>({})

  useEffect(() => {
    const y = now.getFullYear()
    const m = now.getMonth() + 1   // 1-based
    const last = lastDayOf(y, m)

    // T1 — 23:59:00 on the last day: clear records, show transition screen
    const t1Target = new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 0, 0)
    timerRef.current.t1 = setTimeout(() => {
      setRecords([])
      setTransitioning(true)
    }, msUntil(t1Target))

    // T2 — 00:00:01 on the 1st of next month: advance clock, re-enable normal view
    const t2Target = new Date(y, m, 1, 0, 0, 1, 0)   // month m+1, day 1 (JS month 0-based so this is correct)
    timerRef.current.t2 = setTimeout(() => {
      setTransitioning(false)
      const next = new Date()
      setNow(next)
      setViewMonth(toYYYYMM(next)) // snap view back to live month on rollover
    }, msUntil(t2Target))

    return () => {
      clearTimeout(timerRef.current.t1)
      clearTimeout(timerRef.current.t2)
    }
  }, [currentMonth]) // reschedule whenever the month rolls over

  // ── Data fetch ───────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!teacherId || (isCurrentMonth && transitioning)) return
    setLoading(true)
    setError(null)

    const [y, m] = viewMonth.split("-").map(Number)
    const start  = `${viewMonth}-01`
    const end    = `${y}-${String(m).padStart(2, "0")}-${new Date(y, m, 0).getDate()}`

    const [{ data, error: dbErr }, { data: priorData }] = await Promise.all([
      supabase
        .from("staff_attendance")
        .select("id, date, session, status, late_category, early_departure_category, sessions_credited, arrival_time, departure_time, out_missing")
        .eq("teacher_id", teacherId)
        .gte("date", start)
        .lte("date", end)
        .order("date")
        .order("session"),
      supabase
        .from("staff_attendance")
        .select("late_category")
        .eq("teacher_id", teacherId)
        .lt("date", start)
        .not("late_category", "is", null),
    ])

    if (dbErr) { setError(dbErr.message); setLoading(false); return }

    // Carry-in: total prior minus marks % 3 = unspent balance entering this month
    const priorTotal = (priorData ?? []).reduce((sum: number, r: { late_category: number | null }) => {
      const cat = r.late_category
      return sum + (cat === 1 ? 1 : cat === 2 ? 2 : cat === 3 ? 3 : 0)
    }, 0)
    setCarryIn(priorTotal % 3)

    setRecords((data ?? []) as AttRec[])
    setLoading(false)
  }, [teacherId, viewMonth, isCurrentMonth, transitioning])

  useEffect(() => { load() }, [load])

  if (!user) return null

  // ── No teacher profile linked ─────────────────────────────────────────────
  if (!teacherId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a1628] p-8">
        <Card className="max-w-md border-slate-700 bg-navy-900 text-center">
          <CardContent className="p-8">
            <Info className="mx-auto mb-4 size-10 text-amber-400" />
            <p className="text-slate-300">Your account is not linked to a staff profile.</p>
            <p className="mt-1 text-sm text-slate-500">Contact admin to map your teacher record.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Month-end transition screen (only when viewing the live month) ──────────
  if (transitioning && isCurrentMonth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a1628] p-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <Sparkles className="mx-auto mb-4 size-12 text-teal-400" />
          <h2 className="text-xl font-bold text-white">Month Complete</h2>
          <p className="mt-2 text-slate-400">
            {monthLabel(viewMonth)} is done.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Ready for {nextMonthLabel(currentMonth)} — attendance starts fresh at midnight.
          </p>
        </motion.div>
      </div>
    )
  }

  // ── Summary stats ──────────────────────────────────────────────────────────
  const daysPresent     = new Set(records.filter(r => r.status !== "absent").map(r => r.date)).size
  const totalSessions   = records.reduce((n, r) => n + (r.status !== "absent" ? (r.sessions_credited ?? 1) : 0), 0)
  const lateCount       = records.filter(r => r.late_category !== null && r.late_category > 0).length
  const earlyCount      = records.filter(r => r.early_departure_category !== null && r.early_departure_category > 0).length
  const thisMonthMarks  = records.reduce((n, r) => n + (r.late_category && r.late_category > 0 ? r.late_category : 0), 0)
  const totalMinusMarks = carryIn + thisMonthMarks   // effective total including carry-forward
  const carryOut        = totalMinusMarks % 3

  const byDate = new Map<string, AttRec[]>()
  for (const r of records) {
    if (!byDate.has(r.date)) byDate.set(r.date, [])
    byDate.get(r.date)!.push(r)
  }
  const sortedDates = Array.from(byDate.keys()).sort()

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a1628] p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">My Attendance</h1>
            <p className="text-sm text-slate-400">{teacher?.name ?? "Staff"}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-slate-400 hover:text-white"
              onClick={() => setViewMonth(prev => shiftMonth(prev, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-[130px] text-center text-sm font-medium text-white">
              {monthLabel(viewMonth)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-slate-400 hover:text-white disabled:opacity-30"
              disabled={isCurrentMonth}
              onClick={() => setViewMonth(prev => shiftMonth(prev, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        {/* Online self check-in (active only during online months) */}
        {isCurrentMonth && <OnlineCheckinCard onRecorded={load} />}

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Days Present",  value: daysPresent,     icon: CalendarDays,  color: "text-emerald-400", sub: null },
            { label: "Sessions",      value: totalSessions,   icon: CheckCircle2,  color: "text-teal-400",    sub: null },
            { label: "Late Arrivals", value: lateCount,       icon: Clock,         color: lateCount > 0       ? "text-amber-400" : "text-slate-500", sub: null },
            { label: "Minus Marks",   value: totalMinusMarks, icon: AlertTriangle, color: totalMinusMarks > 0 ? "text-red-400"   : "text-slate-500",
              sub: carryIn > 0 ? `+${carryIn} carried` : null },
          ].map(({ label, value, icon: Icon, color, sub }) => (
            <Card key={label} className="border-slate-700/50 bg-navy-900/60">
              <CardContent className="flex items-center gap-3 p-3">
                <Icon className={cn("size-5 shrink-0", color)} />
                <div>
                  <p className="text-lg font-bold text-white">{value}</p>
                  <p className="text-[11px] text-slate-400">{label}</p>
                  {sub && <p className="text-[10px] text-amber-500">{sub}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Records table */}
        <Card className="border-slate-700/50 bg-navy-900/60">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-slate-500">Loading…</div>
            ) : error ? (
              <div className="py-10 text-center text-sm text-red-400">{error}</div>
            ) : sortedDates.length === 0 ? (
              <div className="py-16 text-center">
                <CalendarDays className="mx-auto mb-3 size-8 text-slate-700" />
                <p className="text-slate-500">No attendance records yet for {monthLabel(viewMonth)}.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Session</th>
                    <th className="px-3 py-2.5">IN</th>
                    <th className="px-3 py-2.5">OUT</th>
                    <th className="px-3 py-2.5 text-center">Sessions</th>
                    <th className="px-3 py-2.5">Status / Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDates.map((date) => {
                    const dayRecs = byDate.get(date)!
                    const [y, mo, d] = date.split("-").map(Number)
                    const dow = DAY_ABBR[new Date(y, mo - 1, d).getDay()]
                    return dayRecs.map((rec, ri) => (
                      <motion.tr
                        key={rec.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className={cn(
                          "border-b border-slate-800/60 last:border-0",
                          ri > 0 && "bg-slate-900/20"
                        )}
                      >
                        <td className="px-4 py-2.5 align-top">
                          {ri === 0 && (
                            <div>
                              <span className="font-medium text-white">
                                {d} {new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "short" })}
                              </span>
                              <span className="ml-1.5 text-[11px] text-slate-500">{dow}</span>
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-2.5 align-middle">
                          {sessionBadge(rec.session)}
                        </td>

                        <td className="px-3 py-2.5 align-middle">
                          {rec.arrival_time ? (
                            <span className={cn("font-mono text-[13px]", rec.late_category ? "text-amber-400" : "text-emerald-400")}>
                              {rec.arrival_time}
                            </span>
                          ) : <span className="text-slate-600">—</span>}
                        </td>

                        <td className="px-3 py-2.5 align-middle">
                          {rec.departure_time ? (
                            <span className={cn("font-mono text-[13px]", rec.early_departure_category ? "text-orange-400" : "text-slate-300")}>
                              {rec.departure_time}
                            </span>
                          ) : rec.out_missing ? (
                            <span className="text-[11px] text-red-400">Missing</span>
                          ) : <span className="text-slate-600">—</span>}
                        </td>

                        <td className="px-3 py-2.5 text-center align-middle">
                          {rec.status === "absent" ? (
                            <span className="text-[11px] text-red-400">Absent</span>
                          ) : rec.sessions_credited != null ? (
                            <span className="font-semibold text-white">{rec.sessions_credited}</span>
                          ) : <span className="text-slate-600">—</span>}
                        </td>

                        <td className="px-3 py-2.5 align-middle">
                          <div className="flex flex-wrap gap-1">
                            {rec.late_category && rec.late_category > 0 && (
                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-400">
                                Late Cat-{rec.late_category} (+{rec.late_category} mark{rec.late_category > 1 ? "s" : ""})
                              </span>
                            )}
                            {rec.early_departure_category && rec.early_departure_category > 0 && (
                              <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[11px] font-medium text-orange-400">
                                Early Cat-{rec.early_departure_category}
                              </span>
                            )}
                            {rec.out_missing && !rec.departure_time && (
                              <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-400">
                                No punch-out
                              </span>
                            )}
                            {!rec.late_category && !rec.early_departure_category && !rec.out_missing && rec.status !== "absent" && (
                              <span className="text-[11px] text-emerald-500">On time</span>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    ))
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Footer notes — minus mark carry-forward breakdown */}
        {(thisMonthMarks > 0 || carryIn > 0) && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 space-y-1">
            <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">Minus Mark Tally</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              {carryIn > 0 && (
                <span>Carry-in from prev. months: <strong className="text-amber-400">{carryIn}</strong></span>
              )}
              <span>This month: <strong className="text-white">{thisMonthMarks}</strong></span>
              <span>Total: <strong className={totalMinusMarks >= 3 ? "text-red-400" : "text-white"}>{totalMinusMarks}</strong></span>
            </div>
            {totalMinusMarks >= 3 && (
              <p className="text-xs text-red-400">
                {Math.floor(totalMinusMarks / 3)} deduction{Math.floor(totalMinusMarks / 3) > 1 ? "s" : ""} × 30 INR
                = <strong>{Math.floor(totalMinusMarks / 3) * 30} INR</strong> deducted
                {carryOut > 0 && <> · <span className="text-amber-400">{carryOut} mark{carryOut > 1 ? "s" : ""} carry to next month</span></>}
              </p>
            )}
            {totalMinusMarks > 0 && totalMinusMarks < 3 && (
              <p className="text-xs text-slate-500">
                {3 - totalMinusMarks} more mark{3 - totalMinusMarks > 1 ? "s" : ""} until a 30 INR deduction
                {carryOut > 0 && <> · <span className="text-amber-400">{carryOut} mark{carryOut > 1 ? "s" : ""} carry to next month</span></>}
              </p>
            )}
          </div>
        )}
        {earlyCount > 0 && (
          <p className="text-center text-xs text-slate-500">
            {earlyCount} early departure{earlyCount > 1 ? "s" : ""} flagged — review with admin
          </p>
        )}
      </div>
    </div>
  )
}
