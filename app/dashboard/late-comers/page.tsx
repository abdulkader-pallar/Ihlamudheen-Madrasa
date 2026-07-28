"use client"

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Late Comers Report                                               ║
// ║ Visible to: admin · teacher · accountant                         ║
// ║                                                                  ║
// ║ Daily and monthly views of students who arrived after their      ║
// ║ program's official start time. Shows arrival time and minutes    ║
// ║ late, with institution filter and CSV / Excel / PDF export.      ║
// ║                                                                  ║
// ║ Start times (students): Ihlamudheen 9:00 · Ihlamudheen Madrasa 3:00 PM   ║
// ║ · Edu Support 9:00. CIBIS is not tracked. See src/lib/late-policy.║
// ╚══════════════════════════════════════════════════════════════════╝

import { useState, useEffect, useCallback, useMemo } from "react"
import { motion } from "framer-motion"
import {
  Clock,
  Users,
  Timer,
  ArrowLeft,
  Download,
  ChevronDown,
  FileText,
  Filter,
  CalendarDays,
  School,
} from "lucide-react"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import * as db from "@/lib/db"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { CourseData, AttendanceRecord } from "@/data/courses"
import { formatTime12h, formatMinutesLate } from "@/lib/late-policy"
import {
  buildDailyLateRows,
  buildMonthlyLateRows,
  exportDailyLate,
  exportMonthlyLate,
  type AttendanceFormat,
} from "@/lib/export-attendance"
import {
  INSTITUTIONS,
  INST_SUB_FILTERS,
  institutionLabel,
  filterCourses,
  type WidgetFilter,
} from "@/lib/institution-filter"

type Mode = "daily" | "monthly"

export default function LateComersPage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const allowed = role === "admin" || role === "teacher" || role === "accountant"

  const today = new Date().toISOString().split("T")[0]
  const [mode, setMode] = useState<Mode>("daily")
  const [date, setDate] = useState<string>(today)
  const [month, setMonth] = useState<string>(today.slice(0, 7))
  const [filter, setFilter] = useState<WidgetFilter>("all")
  const [allCourses, setAllCourses] = useState<CourseData[]>([])
  const [attendanceByClass, setAttendanceByClass] = useState<Record<string, AttendanceRecord[]>>({})
  const [loading, setLoading] = useState(true)

  // The month we need to fetch depends on the active view.
  const fetchMonth = mode === "daily" ? date.slice(0, 7) : month

  const load = useCallback(async () => {
    setLoading(true)
    const ready = await db.checkSupabase()
    if (!ready) { setLoading(false); return }
    const dbCourses = await db.fetchCoursesFromDB()
    setAllCourses(dbCourses)
    const allClassIds = dbCourses.flatMap((c) => c.classes.map((cl) => cl.id))
    const attMap = await db.fetchAllClassesAttendanceForMonth(allClassIds, fetchMonth)
    setAttendanceByClass(attMap)
    setLoading(false)
  }, [fetchMonth])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const sub = db.subscribeToTable("student_attendance", () => load())
    return () => sub.unsubscribe()
  }, [load])

  const courses = useMemo(() => filterCourses(allCourses, filter), [allCourses, filter])
  const filterLabel = useMemo(() => institutionLabel(filter), [filter])

  const dailyRows = useMemo(
    () => buildDailyLateRows(courses, attendanceByClass, date),
    [courses, attendanceByClass, date],
  )
  const monthlyRows = useMemo(
    () => buildMonthlyLateRows(courses, attendanceByClass, month),
    [courses, attendanceByClass, month],
  )

  const summary = useMemo(() => {
    if (mode === "daily") {
      const classCount = new Set(dailyRows.map((r) => r.classId)).size
      const totalMin = dailyRows.reduce((n, r) => n + r.minutesLate, 0)
      const avgMin = dailyRows.length > 0 ? Math.round(totalMin / dailyRows.length) : 0
      return { count: dailyRows.length, classCount, totalMin, avgMin }
    }
    const classCount = new Set(monthlyRows.map((r) => r.classId)).size
    const totalLateDays = monthlyRows.reduce((n, r) => n + r.lateDays, 0)
    const totalMin = monthlyRows.reduce((n, r) => n + r.totalMinutesLate, 0)
    return { count: monthlyRows.length, classCount, totalLateDays, totalMin }
  }, [mode, dailyRows, monthlyRows])

  function handleDownload(format: AttendanceFormat) {
    const empty = mode === "daily" ? dailyRows.length === 0 : monthlyRows.length === 0
    if (empty) { toast.error("No late comers to export"); return }
    const res = mode === "daily"
      ? exportDailyLate(dailyRows, format, date, filterLabel)
      : exportMonthlyLate(monthlyRows, format, month, filterLabel)
    if (res.ok) toast.success(res.message)
    else toast.error(res.message)
  }

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Clock className="size-12 text-navy-300 dark:text-navy-600 mb-3" />
        <p className="text-navy-500 dark:text-navy-400">Only admins, teachers, and accountants can view late-comer reports.</p>
      </div>
    )
  }

  const monthLongLabel = (() => {
    const [y, m] = month.split("-").map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
  })()
  const dateLongLabel = new Date(date + "T12:00:00").toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  })
  const hasData = mode === "daily" ? dailyRows.length > 0 : monthlyRows.length > 0

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <Link href="/dashboard/reports" className="text-xs text-navy-400 hover:text-navy-700 dark:hover:text-navy-200 inline-flex items-center gap-1 mb-2">
              <ArrowLeft className="size-3" /> Reports
            </Link>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-navy-900 dark:text-white tracking-tight flex items-center gap-2">
              <Clock className="size-7 text-amber-500" />
              Late Comers Report
            </h1>
            <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
              {mode === "daily" ? dateLongLabel : monthLongLabel}
              {filter !== "all" && <span className="text-navy-400"> · {filterLabel}</span>}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Daily / Monthly toggle */}
            <div className="inline-flex rounded-md border border-input overflow-hidden h-9">
              {(["daily", "monthly"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "px-3.5 text-sm font-medium capitalize transition-colors",
                    mode === m
                      ? "bg-amber-500 text-white"
                      : "bg-background hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Institution filter */}
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors h-9 px-3 text-xs",
                  "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
                )}
                title="Filter by institution"
              >
                <Filter className="size-3.5" />
                <span className="max-w-[180px] truncate">{filterLabel}</span>
                <ChevronDown className="size-3 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[260px] p-1">
                <DropdownMenuItem onClick={() => setFilter("all")} className={cn("cursor-pointer py-2", filter === "all" && "bg-accent")}>
                  <School className="size-4 mr-2.5 text-navy-500 shrink-0" />
                  <div className="flex-1"><p className="text-sm font-medium">All Institutions</p><p className="text-[10.5px] text-muted-foreground">Every tracked class</p></div>
                </DropdownMenuItem>
                {INSTITUTIONS.map((inst) => (
                  <DropdownMenuItem
                    key={inst.key}
                    onClick={() => setFilter(inst.key)}
                    className={cn("cursor-pointer py-2", filter === inst.key && "bg-accent")}
                  >
                    <span className={cn("size-2.5 rounded-full mr-2.5 shrink-0", inst.dotColor)} />
                    <div className="flex-1"><p className="text-sm font-medium">{inst.label}</p></div>
                  </DropdownMenuItem>
                ))}
                <div className="px-2 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-wider text-navy-400">Ihlamudheen Madrasa — by day</div>
                {INST_SUB_FILTERS.map((sub) => (
                  <DropdownMenuItem
                    key={sub.key}
                    onClick={() => setFilter(sub.key)}
                    className={cn("cursor-pointer py-2", filter === sub.key && "bg-accent")}
                  >
                    <CalendarDays className="size-4 mr-2.5 text-emerald-500 shrink-0" />
                    <div className="flex-1"><p className="text-sm font-medium">{sub.label}</p></div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Date / Month picker */}
            {mode === "daily" ? (
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold uppercase text-navy-400">Date</label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-44" />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold uppercase text-navy-400">Month</label>
                <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-44" />
              </div>
            )}

            {/* Download — always active; handleDownload itself guards against an empty report */}
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors h-9 px-3.5 text-sm",
                  "border border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20",
                )}
              >
                <Download className="size-4" />
                <span>Download</span>
                <ChevronDown className="size-3.5 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[230px] p-1">
                <DropdownMenuItem onClick={() => handleDownload("csv")} className="cursor-pointer py-2">
                  <FileText className="size-4 mr-2.5 text-emerald-500 shrink-0" />
                  <div className="flex-1"><p className="text-sm font-medium">CSV</p><p className="text-[10.5px] text-muted-foreground">Universal text format</p></div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownload("excel")} className="cursor-pointer py-2">
                  <FileText className="size-4 mr-2.5 text-green-600 shrink-0" />
                  <div className="flex-1"><p className="text-sm font-medium">Excel (.xls)</p><p className="text-[10.5px] text-muted-foreground">Opens in Microsoft Excel</p></div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownload("pdf")} className="cursor-pointer py-2">
                  <FileText className="size-4 mr-2.5 text-red-500 shrink-0" />
                  <div className="flex-1"><p className="text-sm font-medium">PDF</p><p className="text-[10.5px] text-muted-foreground">Print-ready letterhead view</p></div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </motion.div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Late Comers" value={summary.count} icon={Users} color="text-amber-500" bg="bg-amber-500/10" />
        {mode === "daily" ? (
          <>
            <SummaryCard label="Classes" value={summary.classCount} icon={School} color="text-navy-600 dark:text-navy-200" bg="bg-navy-500/10" />
            <SummaryCard label="Avg Late" value={formatMinutesLate(summary.avgMin ?? 0)} icon={Timer} color="text-amber-500" bg="bg-amber-500/10" />
          </>
        ) : (
          <>
            <SummaryCard label="Total Late Days" value={summary.totalLateDays ?? 0} icon={CalendarDays} color="text-amber-500" bg="bg-amber-500/10" />
            <SummaryCard label="Total Time Late" value={formatMinutesLate(summary.totalMin)} icon={Timer} color="text-amber-500" bg="bg-amber-500/10" />
          </>
        )}
      </div>

      {/* Table */}
      <Card>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-navy-900 dark:text-white">
            {mode === "daily" ? "Late Arrivals" : "Late Comers — Monthly Summary"}
          </h2>
          <span className="text-xs text-navy-400">{summary.count} student{summary.count === 1 ? "" : "s"}</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-navy-500">Loading…</div>
        ) : !hasData ? (
          <div className="p-8 text-center text-sm text-navy-500">
            No late comers {mode === "daily" ? `on ${dateLongLabel}` : `in ${monthLongLabel}`}.
          </div>
        ) : mode === "daily" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-navy-50 dark:bg-navy-950/40 border-b border-border">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Class</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Reg No</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Student</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Program Start</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-red-500">Arrival</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-amber-500">Minutes Late</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((r, i) => (
                  <tr key={`${r.classId}-${r.studentId}`} className={cn("border-b border-border/40", i % 2 === 0 ? "" : "bg-navy-50/30 dark:bg-navy-950/30")}>
                    <td className="px-4 py-2 text-xs text-navy-600 dark:text-navy-300">{r.className}</td>
                    <td className="px-4 py-2 text-xs font-mono text-navy-500">{r.rollNo}</td>
                    <td className="px-4 py-2 text-sm font-medium text-navy-900 dark:text-white">{r.studentName}</td>
                    <td className="px-4 py-2 text-xs text-navy-500">{formatTime12h(r.startTime)}</td>
                    <td className="px-4 py-2 text-xs font-semibold text-red-500">{r.arrivalTime ? formatTime12h(r.arrivalTime) : "—"}</td>
                    <td className="px-4 py-2 text-xs text-right tabular-nums font-bold text-amber-500">{formatMinutesLate(r.minutesLate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-navy-50 dark:bg-navy-950/40 border-b border-border">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Class</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Reg No</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Student</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-amber-500">Late Days</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-amber-500">Total Late</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Avg / Day</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Detail</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map((r, i) => (
                  <tr key={`${r.classId}-${r.studentId}`} className={cn("border-b border-border/40", i % 2 === 0 ? "" : "bg-navy-50/30 dark:bg-navy-950/30")}>
                    <td className="px-4 py-2 text-xs text-navy-600 dark:text-navy-300">{r.className}</td>
                    <td className="px-4 py-2 text-xs font-mono text-navy-500">{r.rollNo}</td>
                    <td className="px-4 py-2 text-sm font-medium text-navy-900 dark:text-white">{r.studentName}</td>
                    <td className="px-4 py-2 text-xs text-right tabular-nums font-bold text-amber-500">{r.lateDays}</td>
                    <td className="px-4 py-2 text-xs text-right tabular-nums font-semibold text-amber-500">{formatMinutesLate(r.totalMinutesLate)}</td>
                    <td className="px-4 py-2 text-xs text-right tabular-nums text-navy-600 dark:text-navy-300">{formatMinutesLate(r.avgMinutesLate)}</td>
                    <td className="px-4 py-2 text-[11px] text-navy-500 max-w-[280px] truncate" title={r.details}>{r.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function SummaryCard({ label, value, icon: Icon, color, bg }: { label: string; value: number | string; icon: typeof Users; color: string; bg: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className={cn("inline-flex size-10 items-center justify-center rounded-lg mb-2", bg)}>
        <Icon className={cn("size-5", color)} />
      </div>
      <p className={cn("text-2xl font-extrabold", typeof value === "string" ? color : "text-navy-900 dark:text-white")}>{value}</p>
      <p className="text-xs text-navy-500 dark:text-navy-400 mt-0.5">{label}</p>
    </div>
  )
}
