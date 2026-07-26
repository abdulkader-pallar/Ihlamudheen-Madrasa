"use client"

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Monthly Attendance Report                                        ║
// ║ Visible to: admin · teacher · accountant                         ║
// ║                                                                  ║
// ║ Pick a month → see aggregated attendance across all working      ║
// ║ days: per-class cards (click for day-by-day grid), per-student   ║
// ║ summary table with absent reasons.                               ║
// ║ Institution filter + CSV / Excel / PDF exports.                  ║
// ╚══════════════════════════════════════════════════════════════════╝

import { useState, useEffect, useCallback, useMemo } from "react"
import { motion } from "framer-motion"
import {
  CalendarCheck,
  Fingerprint,
  XCircle,
  ClipboardCheck,
  ArrowLeft,
  Download,
  ChevronDown,
  FileText,
  CalendarRange,
  Filter,
  CalendarDays,
  School,
} from "lucide-react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import * as db from "@/lib/db"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { CourseData, AttendanceRecord } from "@/data/courses"
import {
  buildMonthlyAttendanceRows,
  buildClassesTakenRows,
  classSessionDates,
  exportMonthlyAttendance,
  exportClassesTaken,
  type AttendanceFormat,
} from "@/lib/export-attendance"
import {
  INSTITUTIONS,
  INST_SUB_FILTERS,
  institutionLabel,
  filterCourses,
  type WidgetFilter,
} from "@/lib/institution-filter"

type Status = "present" | "absent" | "late" | "not-marked"

export default function AttendanceReportPage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const allowed = role === "admin" || role === "teacher" || role === "accountant"

  const todayMonth = new Date().toISOString().split("T")[0].slice(0, 7)
  const [month, setMonth] = useState<string>(todayMonth)
  const [filter, setFilter] = useState<WidgetFilter>("all")
  const [allCourses, setAllCourses] = useState<CourseData[]>([])
  const [attendanceByClass, setAttendanceByClass] = useState<Record<string, AttendanceRecord[]>>({})
  const [loading, setLoading] = useState(true)

  // Drill-down: which class is open in the day-by-day dialog
  const [drillClassId, setDrillClassId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const ready = await db.checkSupabase()
    if (!ready) { setLoading(false); return }
    const dbCourses = await db.fetchCoursesFromDB()
    setAllCourses(dbCourses)
    const allClassIds = dbCourses.flatMap((c) => c.classes.map((cl) => cl.id))
    const attMap = await db.fetchAllClassesAttendanceForMonth(allClassIds, month)
    setAttendanceByClass(attMap)
    setLoading(false)
  }, [month])

  useEffect(() => { load() }, [load])

  // Realtime — refresh when attendance changes from any device
  useEffect(() => {
    const sub = db.subscribeToTable("student_attendance", () => load())
    return () => sub.unsubscribe()
  }, [load])

  // Apply institution filter
  const courses = useMemo(() => filterCourses(allCourses, filter), [allCourses, filter])
  const filterLabel = useMemo(() => institutionLabel(filter), [filter])

  // ── MONTHLY rows + summary ──
  const monthlyRows = useMemo(() => {
    return buildMonthlyAttendanceRows(courses, attendanceByClass, month)
  }, [courses, attendanceByClass, month])

  const monthlySummary = useMemo(() => {
    const totals = { students: monthlyRows.length, workingDays: 0, present: 0, absent: 0, late: 0, notMarked: 0 }
    const daysByClass = new Map<string, number>()
    monthlyRows.forEach((r) => {
      if (!daysByClass.has(r.classId)) daysByClass.set(r.classId, r.workingDays)
      totals.present += r.present
      totals.absent += r.absent
      totals.late += r.late
      totals.notMarked += r.notMarked
    })
    totals.workingDays = Array.from(daysByClass.values()).reduce((a, b) => a + b, 0)
    const attended = totals.present + totals.late
    const possible = totals.present + totals.absent + totals.late + totals.notMarked
    const pct = possible > 0 ? Math.round((attended / possible) * 100) : 0
    return { ...totals, pct, possible }
  }, [monthlyRows])

  const monthlyClassSummary = useMemo(() => {
    const map: Record<string, { className: string; courseTitle: string; students: number; workingDays: number; present: number; absent: number; late: number; notMarked: number }> = {}
    for (const r of monthlyRows) {
      if (!map[r.classId]) {
        map[r.classId] = { className: r.className, courseTitle: r.courseTitle, students: 0, workingDays: r.workingDays, present: 0, absent: 0, late: 0, notMarked: 0 }
      }
      map[r.classId].students++
      map[r.classId].present += r.present
      map[r.classId].absent += r.absent
      map[r.classId].late += r.late
      map[r.classId].notMarked += r.notMarked
    }
    return Object.entries(map).map(([id, v]) => {
      const possible = v.students * v.workingDays
      const attended = v.present + v.late
      const pct = possible > 0 ? Math.round((attended / possible) * 100) : 0
      return { classId: id, ...v, pct }
    })
  }, [monthlyRows])

  // ── Drill-down data for the open class ──
  const drillData = useMemo(() => {
    if (!drillClassId) return null
    let cls: { id: string; name: string; students: { id: string; name: string; rollNo: string }[] } | null = null
    let courseTitle = ""
    for (const course of allCourses) {
      const found = course.classes.find((c) => c.id === drillClassId)
      if (found) {
        cls = { id: found.id, name: found.name, students: found.students }
        courseTitle = course.title
        break
      }
    }
    if (!cls) return null
    const dates = classSessionDates(attendanceByClass, drillClassId, month)
    const recs = (attendanceByClass[drillClassId] || []).filter((r) => r.date.startsWith(month + "-"))
    const byDate = new Map(recs.map((r) => [r.date, r]))
    return { cls, courseTitle, dates, byDate }
  }, [drillClassId, allCourses, attendanceByClass, month])

  // ── Classes-taken rows: one attendance-marked date = one class taken ──
  const classesTaken = useMemo(
    () => buildClassesTakenRows(courses, attendanceByClass, month),
    [courses, attendanceByClass, month],
  )

  // ── Export handlers ──
  function handleDownload(format: AttendanceFormat) {
    if (monthlyRows.length === 0) { toast.error("Nothing to export"); return }
    const res = exportMonthlyAttendance(monthlyRows, format, month, filterLabel)
    if (res.ok) toast.success(res.message)
    else toast.error(res.message)
  }

  function handleClassesTakenDownload(format: AttendanceFormat) {
    if (classesTaken.length === 0) { toast.error("Nothing to export"); return }
    const res = exportClassesTaken(classesTaken, format, month, filterLabel)
    if (res.ok) toast.success(res.message)
    else toast.error(res.message)
  }

  // ── Render guard ──
  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CalendarCheck className="size-12 text-navy-300 dark:text-navy-600 mb-3" />
        <p className="text-navy-500 dark:text-navy-400">Only admins, teachers, and accountants can view attendance reports.</p>
      </div>
    )
  }

  const monthLongLabel = (() => {
    const [y, m] = month.split("-").map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString("en-AE", { month: "long", year: "numeric" })
  })()

  const pctTone = (pct: number) => pct >= 85 ? "text-emerald-500" : pct >= 60 ? "text-amber-500" : "text-red-500"
  const pctBg = (pct: number) => pct >= 85 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500"

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <Link href="/dashboard/reports" className="text-xs text-navy-400 hover:text-navy-700 dark:hover:text-navy-200 inline-flex items-center gap-1 mb-2">
              <ArrowLeft className="size-3" /> Reports
            </Link>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-navy-900 dark:text-white tracking-tight flex items-center gap-2">
              <CalendarCheck className="size-7 text-emerald-500" />
              Monthly Attendance Report
            </h1>
            <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
              {monthLongLabel}
              {filter !== "all" && <span className="text-navy-400"> · {filterLabel}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
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
                <DropdownMenuItem
                  onClick={() => setFilter("all")}
                  className={cn("cursor-pointer py-2", filter === "all" && "bg-accent")}
                >
                  <School className="size-4 mr-2.5 text-navy-500 shrink-0" />
                  <div className="flex-1"><p className="text-sm font-medium">All Institutions</p><p className="text-[10.5px] text-muted-foreground">Every class</p></div>
                </DropdownMenuItem>
                {INSTITUTIONS.map((inst) => {
                  const count = allCourses
                    .filter((c) => c.title.toUpperCase().trim() === inst.key)
                    .reduce((n, c) => n + c.classes.length, 0)
                  return (
                    <DropdownMenuItem
                      key={inst.key}
                      onClick={() => setFilter(inst.key)}
                      className={cn("cursor-pointer py-2", filter === inst.key && "bg-accent")}
                    >
                      <span className={cn("size-2.5 rounded-full mr-2.5 shrink-0", inst.dotColor)} />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{inst.label}</p>
                        <p className="text-[10.5px] text-muted-foreground">{count} class{count === 1 ? "" : "es"}</p>
                      </div>
                    </DropdownMenuItem>
                  )
                })}
                <div className="px-2 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-wider text-navy-400">Ihlamudheen Madrasa — by day</div>
                {INST_SUB_FILTERS.map((sub) => {
                  const count = allCourses
                    .filter((c) => c.title.toUpperCase().trim() === "Ihlamudheen Madrasa")
                    .reduce((n, c) => n + c.classes.filter((cl) => sub.ids.includes(cl.id)).length, 0)
                  return (
                    <DropdownMenuItem
                      key={sub.key}
                      onClick={() => setFilter(sub.key)}
                      className={cn("cursor-pointer py-2", filter === sub.key && "bg-accent")}
                    >
                      <CalendarDays className="size-4 mr-2.5 text-emerald-500 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{sub.label}</p>
                        <p className="text-[10.5px] text-muted-foreground">{count} class{count === 1 ? "" : "es"}</p>
                      </div>
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Month picker */}
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold uppercase text-navy-400">Month</label>
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="h-9 w-44"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors h-9 px-3.5 text-sm",
                  "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
                )}
                disabled={monthlyRows.length === 0 || loading}
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
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <SummaryCard label="Working Days" value={monthlySummary.workingDays} icon={CalendarRange} color="text-navy-600 dark:text-navy-200" bg="bg-navy-500/10" />
        <SummaryCard label="Present" value={monthlySummary.present} icon={Fingerprint} color="text-emerald-500" bg="bg-emerald-500/10" />
        <SummaryCard label="Absent" value={monthlySummary.absent} icon={XCircle} color="text-red-500" bg="bg-red-500/10" />
        <SummaryCard label="Late" value={monthlySummary.late} icon={ClipboardCheck} color="text-amber-500" bg="bg-amber-500/10" />
        <SummaryCard label="Attendance %" value={`${monthlySummary.pct}%`} icon={CalendarCheck} color={pctTone(monthlySummary.pct)} bg={pctBg(monthlySummary.pct) + "/10"} />
      </div>

      {/* Classes taken per class — how many sessions each class received */}
      {classesTaken.length > 0 && (
        <Card className="overflow-hidden border-teal-500/20">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-navy-900 dark:text-white flex items-center gap-2">
                <School className="size-4 text-teal-500 shrink-0" />
                <span className="truncate">Classes Taken — {monthLongLabel}</span>
              </h2>
              <p className="text-[11px] text-navy-500 dark:text-navy-400 mt-0.5">
                One attendance-marked date = one class conducted · W1–W5 = weeks of the month (days 1–7, 8–14, 15–21, 22–28, 29–31)
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors h-8 px-3 text-xs",
                  "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
                )}
                disabled={loading}
              >
                <Download className="size-3.5" />
                <span>Download</span>
                <ChevronDown className="size-3 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[200px] p-1">
                <DropdownMenuItem onClick={() => handleClassesTakenDownload("csv")} className="cursor-pointer py-2">
                  <FileText className="size-4 mr-2.5 text-emerald-500 shrink-0" />
                  <p className="text-sm font-medium">CSV</p>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleClassesTakenDownload("excel")} className="cursor-pointer py-2">
                  <FileText className="size-4 mr-2.5 text-green-600 shrink-0" />
                  <p className="text-sm font-medium">Excel (.xls)</p>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleClassesTakenDownload("pdf")} className="cursor-pointer py-2">
                  <FileText className="size-4 mr-2.5 text-red-500 shrink-0" />
                  <p className="text-sm font-medium">PDF</p>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-navy-50 dark:bg-navy-950/40 border-b border-border">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Course</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Class</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-teal-600">Classes Taken</th>
                  {["W1", "W2", "W3", "W4", "W5"].map((w) => (
                    <th key={w} className="text-center px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">{w}</th>
                  ))}
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Scheduled (to date)</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Last Class</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {classesTaken.map((r, i) => {
                  const behind = r.expectedToDate !== null ? r.expectedToDate - r.taken : null
                  return (
                    <tr
                      key={r.classId}
                      className={cn("border-b border-border/40", i % 2 === 0 ? "" : "bg-navy-50/30 dark:bg-navy-950/30")}
                    >
                      <td className="px-4 py-2 text-xs text-navy-500 dark:text-navy-400 max-w-[180px] truncate" title={r.courseTitle}>
                        {r.courseTitle}
                      </td>
                      <td className="px-4 py-2 text-sm font-medium text-navy-900 dark:text-white whitespace-nowrap">{r.className}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold text-teal-600 dark:text-teal-400">{r.taken}</td>
                      {r.weeks.map((w, wi) => (
                        <td key={wi} className={cn(
                          "px-2 py-2 text-center text-xs tabular-nums",
                          w > 0 ? "font-semibold text-navy-700 dark:text-navy-200" : "text-navy-300 dark:text-navy-600"
                        )}>
                          {w > 0 ? w : "·"}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-xs text-right tabular-nums text-navy-600 dark:text-navy-300">
                        {r.expectedToDate ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-navy-600 dark:text-navy-300 whitespace-nowrap">
                        {r.lastDate ?? "—"}
                      </td>
                      <td className="px-4 py-2">
                        {behind === null ? (
                          <span className="text-xs text-navy-400">—</span>
                        ) : behind <= 0 ? (
                          <span className="inline-block rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                            On track
                          </span>
                        ) : (
                          <span className={cn(
                            "inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            behind === 1
                              ? "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400"
                              : "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400"
                          )}>
                            {behind} behind
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Per-class cards */}
      {monthlyClassSummary.length > 0 && (
        <Card className="overflow-hidden border-emerald-500/20">
          <CardContent className="p-4 sm:p-5">
            <div className="mb-4">
              <h2 className="text-base sm:text-lg font-bold text-navy-900 dark:text-white flex items-center gap-2">
                <ClipboardCheck className="size-5 text-emerald-500" />
                Classes — {monthLongLabel}
              </h2>
              <p className="text-xs text-navy-500 dark:text-navy-300 mt-0.5">
                {monthlyClassSummary.length} {monthlyClassSummary.length === 1 ? "class" : "classes"}
                {" · "}
                <span className="font-semibold text-navy-700 dark:text-navy-200">
                  {monthlySummary.students} student{monthlySummary.students === 1 ? "" : "s"}
                </span>
                {" · "}
                <span className="italic text-navy-400">click a card for day-by-day grid</span>
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {monthlyClassSummary.map((c) => (
                <button
                  key={c.classId}
                  type="button"
                  onClick={() => setDrillClassId(c.classId)}
                  className={cn(
                    "text-left rounded-xl border p-3 transition-all cursor-pointer hover:shadow-lg hover:-translate-y-0.5",
                    c.pct >= 85
                      ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-700/40 dark:bg-emerald-500/5"
                      : c.pct >= 60
                        ? "border-amber-200 bg-amber-50/50 dark:border-amber-700/40 dark:bg-amber-500/5"
                        : "border-red-200 bg-red-50/50 dark:border-red-700/40 dark:bg-red-500/5"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-sm font-bold text-navy-900 dark:text-white">{c.className}</h4>
                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
                      c.pct >= 85 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                      : c.pct >= 60 ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                      : "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300")}>
                      {c.pct}%
                    </span>
                  </div>
                  <p className="text-[10px] text-navy-400 dark:text-navy-500 mb-2">{c.courseTitle}</p>
                  <div className="flex items-center gap-3 text-xs flex-wrap">
                    <span className="text-navy-500 dark:text-navy-400">{c.students} students · {c.workingDays} day{c.workingDays === 1 ? "" : "s"}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[11px]">
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">P: {c.present}</span>
                    <span className="text-red-500 font-semibold">A: {c.absent}</span>
                    {c.late > 0 && <span className="text-amber-500 font-semibold">L: {c.late}</span>}
                    {c.notMarked > 0 && <span className="text-navy-400 font-medium">—: {c.notMarked}</span>}
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-navy-100 dark:bg-navy-700 overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", pctBg(c.pct))}
                      style={{ width: `${c.pct}%` }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-student summary table */}
      <Card>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-navy-900 dark:text-white">Per-Student Summary</h2>
          <span className="text-xs text-navy-400">{monthlyRows.length} student{monthlyRows.length === 1 ? "" : "s"}</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-navy-500">Loading…</div>
        ) : monthlyRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-navy-500">No attendance data for this month</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-navy-50 dark:bg-navy-950/40 border-b border-border">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Class</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Reg No</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Student</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Working Days</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Present</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-red-500">Absent</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-amber-500">Late</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Reason</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">%</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map((r, i) => (
                  <tr
                    key={`${r.classId}-${r.studentId}`}
                    className={cn("border-b border-border/40", i % 2 === 0 ? "" : "bg-navy-50/30 dark:bg-navy-950/30")}
                  >
                    <td className="px-4 py-2 text-xs text-navy-600 dark:text-navy-300">{r.className}</td>
                    <td className="px-4 py-2 text-xs font-mono text-navy-500">{r.rollNo}</td>
                    <td className="px-4 py-2 text-sm font-medium text-navy-900 dark:text-white">{r.studentName}</td>
                    <td className="px-4 py-2 text-xs text-right tabular-nums text-navy-600 dark:text-navy-300">{r.workingDays}</td>
                    <td className="px-4 py-2 text-xs text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{r.present}</td>
                    <td className="px-4 py-2 text-xs text-right tabular-nums font-semibold text-red-500">{r.absent}</td>
                    <td className="px-4 py-2 text-xs text-right tabular-nums font-semibold text-amber-500">{r.late}</td>
                    <td className="px-4 py-2 text-xs text-navy-500 italic max-w-[200px] truncate" title={r.absentReasons || undefined}>
                      {r.absentReasons || <span className="text-navy-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-right tabular-nums font-bold">
                      {r.workingDays > 0 ? (
                        <span className={pctTone(r.attendancePct)}>{r.attendancePct}%</span>
                      ) : (
                        <span className="italic text-navy-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Per-class day-by-day drill-down dialog */}
      <Dialog open={drillClassId !== null} onOpenChange={(o) => !o && setDrillClassId(null)}>
        <DialogContent className="max-w-[min(96vw,1200px)] max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <CalendarRange className="size-5 text-emerald-500" />
              {drillData?.cls.name ?? ""} — {monthLongLabel}
            </DialogTitle>
            <DialogDescription>
              {drillData ? (
                <>
                  {drillData.courseTitle} · {drillData.cls.students.length} students · {drillData.dates.length} working day{drillData.dates.length === 1 ? "" : "s"}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {drillData && (
            <div className="overflow-auto rounded border border-border min-h-0">
              {drillData.dates.length === 0 ? (
                <div className="p-8 text-center text-sm text-navy-500">No attendance marked for this class in {monthLongLabel}</div>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-navy-50 dark:bg-navy-950/80 z-10">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-navy-500 border-b border-border sticky left-0 bg-navy-50 dark:bg-navy-950/80 z-20 min-w-[180px]">Student</th>
                      <th className="text-left px-2 py-2 font-semibold text-navy-500 border-b border-border min-w-[60px]">Reg</th>
                      {drillData.dates.map((d) => {
                        const dt = new Date(d + "T00:00:00")
                        return (
                          <th key={d} className="text-center px-2 py-2 font-semibold text-navy-500 border-b border-l border-border whitespace-nowrap">
                            <div className="text-[10px] text-navy-400">{dt.toLocaleDateString("en-AE", { weekday: "short" })}</div>
                            <div>{dt.getDate()}</div>
                          </th>
                        )
                      })}
                      <th className="text-center px-2 py-2 font-semibold text-navy-500 border-b border-l border-border whitespace-nowrap">P</th>
                      <th className="text-center px-2 py-2 font-semibold text-navy-500 border-b border-l border-border whitespace-nowrap">A</th>
                      <th className="text-center px-2 py-2 font-semibold text-navy-500 border-b border-l border-border whitespace-nowrap">L</th>
                      <th className="text-center px-2 py-2 font-semibold text-navy-500 border-b border-l border-border whitespace-nowrap">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillData.cls.students.map((st, i) => {
                      let present = 0, absent = 0, late = 0
                      const cells = drillData.dates.map((d) => {
                        const rec = drillData.byDate.get(d)
                        const s = rec?.records[st.id]
                        if (s === "present") present++
                        else if (s === "absent") absent++
                        else if (s === "late") late++
                        return s as Status | undefined
                      })
                      const days = drillData.dates.length
                      const pct = days > 0 ? Math.round(((present + late) / days) * 100) : 0
                      const rowBg = i % 2 === 0 ? "" : "bg-navy-50/40 dark:bg-navy-950/30"
                      return (
                        <tr key={st.id} className={cn("border-b border-border/40", rowBg)}>
                          <td className={cn("px-3 py-1.5 font-medium text-navy-900 dark:text-white sticky left-0 z-10", rowBg || "bg-card")}>
                            {st.name}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-navy-500">{st.rollNo}</td>
                          {cells.map((c, ci) => {
                            const letter = c === "present" ? "P" : c === "absent" ? "A" : c === "late" ? "L" : "—"
                            const cl =
                              c === "present" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : c === "absent" ? "bg-red-500/15 text-red-500"
                              : c === "late" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                              : "text-navy-400"
                            return (
                              <td key={ci} className={cn("text-center px-1 py-1.5 border-l border-border/40 font-semibold", cl)}>
                                {letter}
                              </td>
                            )
                          })}
                          <td className="text-center px-2 py-1.5 border-l border-border/40 font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{present}</td>
                          <td className="text-center px-2 py-1.5 border-l border-border/40 font-semibold text-red-500 tabular-nums">{absent}</td>
                          <td className="text-center px-2 py-1.5 border-l border-border/40 font-semibold text-amber-500 tabular-nums">{late}</td>
                          <td className={cn("text-center px-2 py-1.5 border-l border-border/40 font-bold tabular-nums", pctTone(pct))}>
                            {days > 0 ? `${pct}%` : "—"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryCard({ label, value, icon: Icon, color, bg }: { label: string; value: number | string; icon: typeof Fingerprint; color: string; bg: string }) {
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
