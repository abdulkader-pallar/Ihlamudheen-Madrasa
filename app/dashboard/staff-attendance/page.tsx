"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Users,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  Download,
  ChevronLeft,
  ChevronRight,
  CalendarCheck,
  X,
  FileText,
  Wifi,
  Plus,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { initialTeachers, type TeacherData } from "@/data/courses"
import { isFixedSalaryPayType, isAttendanceWorkingDay } from "@/lib/staff-absence"
import * as db from "@/lib/db"
import { useAuth } from "@/hooks/use-auth"
import { useDisabledTeachers } from "@/hooks/use-disabled-teachers"
import { getUserRole } from "@/lib/roles"
import { toast } from "sonner"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { addReportHeader } from "@/lib/branding"
import { VerifyAttendanceDialog } from "@/components/verify-attendance-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// ── Attendance codes ───────────────────────────────────────
// H1 = Ihlamudheen 1st session (morning) only
// H2 = Ihlamudheen 2nd session (afternoon) only
// HF = Both Ihlamudheen sessions
// ES = EDU Support (monthly-edu-support) — any present punch
// S1 = Office morning session only (the office staff etc.)
// S2 = Office afternoon session only
// ND = Normal Duty — full office day / cleaning / driver / all other non-teaching
// A  = Absent — fixed-salary staff with no punch on a working day (synthesised,
//      not stored). Does NOT count toward Total Days.
// Each present/late code counts as exactly 1 in Total; "A" never does.

type AttendanceCode = "" | "H1" | "H2" | "HF" | "ES" | "EM" | "ES+EM" | "S1" | "S2" | "ND" | "A"
type MonthlyGrid = Record<string, Record<number, AttendanceCode>>

const CODE_STYLE: Record<AttendanceCode, string> = {
  "":      "",
  H1:      "bg-teal-400 text-white",
  H2:      "bg-sky-500 text-white",
  HF:      "bg-emerald-500 text-white",
  ES:      "bg-violet-500 text-white",
  EM:      "bg-pink-500 text-white",
  "ES+EM": "bg-gradient-to-r from-violet-500 to-pink-500 text-white",
  S1:      "bg-amber-400 text-white",
  S2:      "bg-orange-400 text-white",
  ND:      "bg-blue-500 text-white",
  A:       "bg-red-600 text-white",
}

// punchCount = total distinct present records on that day (regardless of session label)
function resolveCode(
  teacher: TeacherData,
  hasMorning: boolean,
  hasAfternoon: boolean,
  hasEvening: boolean,
  punchCount: number
): AttendanceCode {
  const hasDay = hasMorning || hasAfternoon || punchCount >= 2

  switch (teacher.payType) {
    case "monthly-edu-support":
      if (teacher.dualPayType === "per-day-english") {
        if (hasDay && hasEvening) return "ES+EM"
        if (hasEvening) return "EM"
        if (hasDay) return "ES"
        return ""
      }
      return hasDay ? "ES" : ""

    case "per-day-english":
      return hasEvening || hasDay ? "EM" : ""

    case "monthly-office":
      if (!hasDay && !hasEvening) return ""
      // 2+ punches or explicit morning+afternoon = full day
      if (punchCount >= 2 || (hasMorning && hasAfternoon)) return "ND"
      if (hasMorning)  return "S1"
      return "S2"

    case "monthly-cleaning":
    case "daily-driver":
      return hasDay || hasEvening ? "ND" : ""

    default:
      // per-session-madrasa, per-day-cibis (and their duals)
      if (!hasDay && !hasEvening) return ""
      if (teacher.dualPayType === "per-day-english" && hasEvening && !hasDay) return "EM"
      if (hasMorning && hasAfternoon) return "HF"
      if (hasMorning)  return "H1"
      if (hasAfternoon) return "H2"
      return hasEvening ? "EM" : ""
  }
}

const teacherPayTypeMap: Record<string, TeacherData["payType"]> = {}
initialTeachers.forEach((t) => { teacherPayTypeMap[t.id] = t.payType })

function getDaysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number)
  return new Date(y, m, 0).getDate()
}

function formatMonthLabel(month: string): string {
  return new Date(month + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number)
  return new Date(y, m - 1 + delta, 1).toISOString().slice(0, 7)
}

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
function getDayAbbr(month: string, day: number): string {
  const [y, m] = month.split("-").map(Number)
  return DAY_ABBR[new Date(y, m - 1, day).getDay()]
}

// Device-local today (YYYY-MM-DD). Only days strictly before today are eligible
// for a synthesised "Absent" mark — today's working sessions may not be over yet.
function getLocalDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export default function StaffAttendancePage() {
  const { user } = useAuth(true)
  const { disabledIds } = useDisabledTeachers()
  const role = user ? getUserRole(user) : "student"
  const canView = role === "admin" || role === "accountant"

  const currentMonth = new Date().toISOString().slice(0, 7)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [grid, setGrid] = useState<MonthlyGrid>({})
  const [useSupabase, setUseSupabase] = useState(false)
  const [dbError, setDbError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Online self check-in: raw per-day records (for the verify dialog), the
  // configured online months, and the currently-open verify target.
  const [dayRecords, setDayRecords] = useState<Record<string, Record<number, db.StaffAttendanceEntry[]>>>({})
  const [proofCounts, setProofCounts] = useState<Record<string, Record<number, number>>>({})
  const [onlineMonths, setOnlineMonths] = useState<string[]>([])
  const [showOnlineMonths, setShowOnlineMonths] = useState(false)
  const [newOnlineMonth, setNewOnlineMonth] = useState("")
  const [verifyTarget, setVerifyTarget] = useState<{ teacherId: string; name: string; day: number } | null>(null)

  // Disabled staff (left Ihlamudheen Madrasa) are hidden from the attendance grid.
  const allTeachers = initialTeachers
    .filter((t) => !disabledIds.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))

  const loadAttendance = useCallback(async () => {
    const ready = await db.checkSupabase()
    if (!ready) { setDbError("Supabase not configured or unreachable"); return }
    setUseSupabase(true)

    const result = await db.fetchStaffAttendance(selectedMonth)
    if (result.error) {
      setDbError(result.error === "TABLE_MISSING"
        ? "staff_attendance table not found — please run the migration SQL"
        : result.error)
      return
    }
    setDbError(null)

    // Raw records per teacher/day — powers the online check-in verify dialog
    const byTeacherDay: Record<string, Record<number, db.StaffAttendanceEntry[]>> = {}
    result.data.forEach((rec) => {
      const day = parseInt(rec.date.slice(8, 10), 10)
      if (!byTeacherDay[rec.teacherId]) byTeacherDay[rec.teacherId] = {}
      if (!byTeacherDay[rec.teacherId][day]) byTeacherDay[rec.teacherId][day] = []
      byTeacherDay[rec.teacherId][day].push(rec)
    })
    setDayRecords(byTeacherDay)

    // Session-proof counts per teacher/day — powers the "class proof attached"
    // dot on online days (evidence a Meet class was actually conducted).
    const proofsRes = await db.fetchSessionProofs(selectedMonth)
    const counts: Record<string, Record<number, number>> = {}
    proofsRes.data.forEach((p) => {
      const day = parseInt(p.date.slice(8, 10), 10)
      if (!counts[p.teacherId]) counts[p.teacherId] = {}
      counts[p.teacherId][day] = (counts[p.teacherId][day] ?? 0) + 1
    })
    setProofCounts(counts)

    // Build per-teacher, per-day session flags + raw punch count
    const sessionFlags: Record<string, Record<number, { m: boolean; a: boolean; e: boolean; count: number }>> = {}
    result.data.forEach((rec) => {
      if (rec.status !== "present" && rec.status !== "late") return
      const day = parseInt(rec.date.slice(8, 10), 10)
      if (!sessionFlags[rec.teacherId]) sessionFlags[rec.teacherId] = {}
      if (!sessionFlags[rec.teacherId][day]) sessionFlags[rec.teacherId][day] = { m: false, a: false, e: false, count: 0 }
      sessionFlags[rec.teacherId][day].count++
      if (rec.session === "morning" || rec.session === "full") sessionFlags[rec.teacherId][day].m = true
      if (rec.session === "afternoon" || rec.session === "full") sessionFlags[rec.teacherId][day].a = true
      // sessions_credited=2 on a morning record means the teacher stayed for both Ihlamudheen sessions
      if (rec.session === "morning" && (rec.sessionsCredited ?? 1) >= 2) sessionFlags[rec.teacherId][day].a = true
      if (rec.session === "evening") sessionFlags[rec.teacherId][day].e = true
    })

    const newGrid: MonthlyGrid = {}
    allTeachers.forEach((t) => {
      newGrid[t.id] = {}
      const days = sessionFlags[t.id] || {}
      Object.entries(days).forEach(([dayStr, { m, a, e, count }]) => {
        const d = parseInt(dayStr, 10)
        newGrid[t.id][d] = resolveCode(t, m, a, e, count)
      })
    })

    // Synthesise "Absent" (A) marks for fixed-salary staff who have no present/late
    // record on a working day. Only days strictly before today are eligible — a
    // working session today may still be open. Cleaning is included here (its
    // absence shows in attendance + report); the office staff's Monday/Friday morning
    // is excluded by isAttendanceWorkingDay (the evening session still counts).
    const todayStr = getLocalDateStr()
    const daysThisMonth = getDaysInMonth(selectedMonth)
    allTeachers.forEach((t) => {
      if (!isFixedSalaryPayType(t.payType)) return
      for (let d = 1; d <= daysThisMonth; d++) {
        const dateStr = `${selectedMonth}-${String(d).padStart(2, "0")}`
        if (dateStr >= todayStr) break          // today and the future are not yet absences
        if (newGrid[t.id][d]) continue           // already present/late that day
        if (isAttendanceWorkingDay(t.payType, dateStr)) newGrid[t.id][d] = "A"
      }
    })

    setGrid(newGrid)
  }, [selectedMonth]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAttendance() }, [loadAttendance])
  useEffect(() => {
    if (!useSupabase) return
    const sub = db.subscribeToTable("staff_attendance", () => loadAttendance())
    return () => sub.unsubscribe()
  }, [useSupabase, loadAttendance])

  // Which months run on online self check-in (app_settings)
  useEffect(() => {
    db.fetchAppSetting("online_checkin_months").then((v) => {
      try {
        const arr = JSON.parse(v ?? "[]")
        if (Array.isArray(arr)) setOnlineMonths(arr.filter((m): m is string => typeof m === "string"))
      } catch { /* malformed setting — leave feature off */ }
    })
  }, [])

  const isOnlineMonth = onlineMonths.includes(selectedMonth)

  const saveOnlineMonths = async (months: string[]) => {
    const res = await db.setAppSetting("online_checkin_months", JSON.stringify(months))
    if (res.error) { toast.error(res.error); return }
    setOnlineMonths(months)
    toast.success("Online months updated")
  }

  // Total = number of days present (each present/late day = 1). "A" (Absent) and
  // blank days never count.
  const getTotal = (teacherId: string): number =>
    Object.values(grid[teacherId] || {}).filter((v) => v !== "" && v !== "A").length

  const exportCSV = () => {
    const daysInMonth = getDaysInMonth(selectedMonth)
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
    const monthLabel = formatMonthLabel(selectedMonth)

    const rows = [
      [`Staff Attendance — ${monthLabel}`, "Ihlamudheen Madrasa"],
      ["#", "Teacher", ...days.map(String), "Total Days"],
      ...allTeachers.map((teacher, i) => {
        const td = grid[teacher.id] || {}
        return [i + 1, teacher.name, ...days.map((d) => td[d] || ""), getTotal(teacher.id)]
      }),
      [],
      ["Codes:", "H1=Ihlamudheen Morning", "H2=Ihlamudheen Afternoon", "HF=Ihlamudheen Full Day",
        "ES=EDU Support", "EM=English Madrasa", "ES+EM=EDU Support+English",
        "S1=Office Morning", "S2=Office Afternoon", "ND=Normal Duty", "A=Absent"],
    ]

    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `staff-attendance-${selectedMonth}.csv`; a.click()
    URL.revokeObjectURL(url)
    setShowPreview(false); toast.success("CSV exported")
  }

  const exportPDF = async () => {
    const daysInMonth = getDaysInMonth(selectedMonth)
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
    const monthLabel = formatMonthLabel(selectedMonth)

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" })
    const contentY = await addReportHeader(doc, `Staff Attendance — ${monthLabel}`)

    autoTable(doc, {
      head: [["#", "Teacher", ...days.map(String), "Total"]],
      body: allTeachers.map((teacher, i) => {
        const td = grid[teacher.id] || {}
        return [String(i + 1), teacher.name, ...days.map((d) => td[d] || ""), String(getTotal(teacher.id) || "–")]
      }),
      startY: contentY,
      styles: { fontSize: 6, cellPadding: 1.2, halign: "center" },
      columnStyles: {
        0: { cellWidth: 7 },
        1: { cellWidth: 28, halign: "left" },
        [days.length + 2]: { cellWidth: 10, fontStyle: "bold" },
      },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 6, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      didParseCell: (data) => {
        if (data.section !== "body" || data.column.index <= 1) return
        const v = data.cell.raw as string
        const colorMap: Record<string, [number, number, number]> = {
          H1: [20, 184, 166], H2: [14, 165, 233], HF: [16, 185, 129],
          ES: [139, 92, 246], EM: [236, 72, 153], "ES+EM": [168, 85, 247],
          S1: [245, 158, 11], S2: [249, 115, 22], ND: [59, 130, 246],
          A: [220, 38, 38],
        }
        if (colorMap[v]) { data.cell.styles.textColor = colorMap[v]; data.cell.styles.fontStyle = "bold" }
      },
    })

    const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5
    doc.setFontSize(7); doc.setTextColor(100)
    doc.text(
      "H1=Ihlamudheen Morning   H2=Ihlamudheen Afternoon   HF=Ihlamudheen Full Day   ES=EDU Support   EM=English Madrasa   ES+EM=EDU Support+English   S1=Office Morning   S2=Office Afternoon   ND=Normal Duty   A=Absent",
      14, finalY
    )
    doc.save(`staff-attendance-${selectedMonth}.pdf`)
    setShowPreview(false); toast.success("PDF exported")
  }

  if (!canView) {
    const todayLabel = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
            <CalendarCheck className="size-7 text-teal-500" /> My Attendance
          </h1>
          <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">{todayLabel}</p>
        </motion.div>
        <Card className="shadow-3d border-teal-400/30">
          <CardContent className="pt-6 pb-6">
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-teal-50 dark:bg-teal-900/30 p-3 shrink-0">
                <CheckCircle2 className="size-6 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                {onlineMonths.includes(currentMonth) ? (
                  <>
                    <p className="text-base font-bold text-navy-900 dark:text-white">Online self check-in is active</p>
                    <p className="text-sm text-navy-500 dark:text-navy-400 mt-1">
                      Classes are online this month — check in from the{" "}
                      <a href="/dashboard/my-attendance" className="font-medium text-teal-600 dark:text-teal-400 underline">
                        My Attendance
                      </a>{" "}
                      page when your class starts.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-base font-bold text-navy-900 dark:text-white">Attendance is recorded automatically</p>
                    <p className="text-sm text-navy-500 dark:text-navy-400 mt-1">
                      Your attendance is marked when you punch the fingerprint machine.
                    </p>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const daysInMonth = getDaysInMonth(selectedMonth)
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const cb = "border border-navy-200 dark:border-navy-700" // cell border

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <Users className="size-8 text-teal-500" /> Staff Attendance
        </h1>
        <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
          {isOnlineMonth
            ? "Online self check-in month — staff record their own attendance; amber-ringed days await verification, the dot under a chip shows whether class proof (Meet screenshot/link) is attached."
            : "Read-only — attendance recorded automatically via fingerprint machine."}
        </p>
      </motion.div>

      {dbError && (
        <div className="flex items-center gap-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 px-5 py-3">
          <AlertTriangle className="size-5 text-red-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Database Error</p>
            <p className="text-xs text-red-600 dark:text-red-300 mt-0.5">{dbError}</p>
          </div>
        </div>
      )}
      {useSupabase && !dbError && (
        <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          Live — synced across all devices
        </div>
      )}

      {/* Controls */}
      <Card className="border-teal-500/30">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))}>
                <ChevronLeft className="size-4" />
              </Button>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="text-sm font-semibold text-navy-900 dark:text-white bg-transparent border border-border rounded-md px-3 py-1.5 w-40"
              />
              <Button variant="outline" size="sm" onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))} disabled={selectedMonth >= currentMonth}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={loadAttendance}><RefreshCw className="size-4 mr-1" /> Refresh</Button>
              <Button variant="outline" className="border-teal-500 text-teal-700 dark:text-teal-400 hover:bg-teal-50" onClick={() => setShowPreview(true)}>
                <Download className="size-4 mr-1" /> Export
              </Button>
              {role === "admin" && (
                <Button variant="outline" onClick={() => setShowOnlineMonths(true)}>
                  <Wifi className="size-4 mr-1" /> Online Months
                </Button>
              )}
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-2 mt-3">
            {(["H1","H2","HF","ES","EM","ES+EM","S1","S2","ND","A"] as AttendanceCode[]).map((code) => {
              const labels: Record<string, string> = {
                H1: "Ihlamudheen 1st Session", H2: "Ihlamudheen 2nd Session", HF: "Ihlamudheen Full Day",
                ES: "EDU Support", EM: "English Madrasa", "ES+EM": "EDU Support + English",
                S1: "Office Morning", S2: "Office Afternoon", ND: "Normal Duty", A: "Absent",
              }
              return (
                <span key={code} className="flex items-center gap-1 text-[10px] text-navy-600 dark:text-navy-300">
                  <span className={cn("inline-flex items-center justify-center w-7 h-5 rounded text-[9px] font-bold", CODE_STYLE[code])}>
                    {code}
                  </span>
                  {labels[code]}
                </span>
              )
            })}
            {isOnlineMonth && (
              <>
                <span className="flex items-center gap-1 text-[10px] text-navy-600 dark:text-navy-300">
                  <span className="inline-flex items-center justify-center w-7 h-5 rounded text-[9px] font-bold bg-teal-500 text-white ring-2 ring-amber-400">
                    H1
                  </span>
                  Online self check-in pending verification
                </span>
                <span className="flex items-center gap-1 text-[10px] text-navy-600 dark:text-navy-300">
                  <span className="size-1.5 rounded-full bg-teal-500" />
                  Class proof attached
                </span>
                <span className="flex items-center gap-1 text-[10px] text-navy-600 dark:text-navy-300">
                  <span className="size-1.5 rounded-full bg-red-500" />
                  Checked in, no class proof
                </span>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Monthly grid — header frozen on scroll */}
      <Card>
        <CardContent className="p-0">
          {/* overflow-auto so sticky thead works on both axes */}
          <div className="overflow-auto max-h-[calc(100vh-320px)]">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-20">
                <tr className="bg-navy-800 dark:bg-navy-900">
                  <th className={cn(cb, "px-2 py-2 text-left font-medium text-navy-200 sticky left-0 bg-navy-800 dark:bg-navy-900 z-30 w-8")}>#</th>
                  <th className={cn(cb, "px-3 py-2 text-left font-medium text-navy-200 sticky left-8 bg-navy-800 dark:bg-navy-900 z-30 min-w-[140px]")}>
                    Teacher
                  </th>
                  {days.map((d) => {
                    const abbr = getDayAbbr(selectedMonth, d)
                    const isFriSat = abbr === "Fri" || abbr === "Sat"
                    return (
                      <th key={d} className={cn(
                        cb, "px-0 py-1.5 text-center w-8",
                        isFriSat ? "bg-navy-700 dark:bg-navy-800" : "bg-navy-800 dark:bg-navy-900"
                      )}>
                        <div className="font-bold text-white leading-tight text-xs">{d}</div>
                        <div className={cn("text-[8px] font-normal leading-tight", isFriSat ? "text-amber-300" : "text-navy-400")}>{abbr}</div>
                      </th>
                    )
                  })}
                  <th className={cn(cb, "px-2 py-2 text-center font-bold text-white bg-navy-700 dark:bg-navy-800 sticky right-0 z-30 min-w-[50px]")}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {allTeachers.map((teacher, i) => {
                  const td = grid[teacher.id] || {}
                  const total = getTotal(teacher.id)
                  const rowBg = i % 2 === 0 ? "bg-white dark:bg-navy-900" : "bg-navy-50/60 dark:bg-navy-800/40"
                  return (
                    <tr key={teacher.id} className={rowBg}>
                      <td className={cn(cb, "px-2 py-1.5 text-navy-400 font-mono sticky left-0 z-10", rowBg)}>{i + 1}</td>
                      <td className={cn(cb, "px-3 py-1.5 font-medium text-navy-900 dark:text-white sticky left-8 z-10 whitespace-nowrap", rowBg)}>
                        {teacher.name}
                      </td>
                      {days.map((d) => {
                        const code = td[d] || ""
                        const abbr = getDayAbbr(selectedMonth, d)
                        const isFriSat = abbr === "Fri" || abbr === "Sat"
                        const recs = dayRecords[teacher.id]?.[d]
                        const hasOnline = !!recs?.some((r) => r.sessionType === "online")
                        const hasUnverifiedOnline = !!recs?.some((r) => r.sessionType === "online" && !r.verifiedBy)
                        const hasProof = (proofCounts[teacher.id]?.[d] ?? 0) > 0
                        const chip = code ? (
                          <span className={cn(
                            "relative inline-flex items-center justify-center w-7 h-5 rounded text-[9px] font-bold",
                            CODE_STYLE[code],
                            hasUnverifiedOnline && "ring-2 ring-amber-400"
                          )}>
                            {code}
                            {hasOnline && (
                              // Evidence dot: teal = class proof attached, red = check-in only
                              <span
                                className={cn(
                                  "absolute -bottom-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full",
                                  hasProof ? "bg-teal-500" : "bg-red-500"
                                )}
                              />
                            )}
                          </span>
                        ) : (
                          <span className="text-navy-200 dark:text-navy-700 text-[10px]">·</span>
                        )
                        return (
                          <td key={d} className={cn(
                            cb, "py-1.5 text-center",
                            isFriSat && !code ? "bg-amber-50/30 dark:bg-amber-900/10" : ""
                          )}>
                            {hasOnline ? (
                              // Online self check-in day → click to review/verify
                              <button
                                type="button"
                                title={hasProof ? "Review online check-in — class proof attached" : "Review online check-in — no class proof yet"}
                                onClick={() => setVerifyTarget({ teacherId: teacher.id, name: teacher.name, day: d })}
                                className="cursor-pointer rounded hover:opacity-80"
                              >
                                {chip}
                              </button>
                            ) : chip}
                          </td>
                        )
                      })}
                      <td className={cn(cb, "px-2 py-1.5 text-center font-bold bg-navy-50 dark:bg-navy-800/60 sticky right-0 z-10", rowBg)}>
                        <span className={cn("text-xs font-bold", total > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-navy-300 dark:text-navy-600")}>
                          {total > 0 ? total : "–"}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-20">
                <tr className="bg-navy-100 dark:bg-navy-800">
                  <td colSpan={2} className={cn(cb, "px-3 py-2 text-[10px] font-bold text-navy-600 dark:text-navy-300 sticky left-0 bg-navy-100 dark:bg-navy-800 z-30")}>
                    DAILY TOTAL
                  </td>
                  {days.map((d) => {
                    const dayTotal = allTeachers.reduce((s, t) => {
                      const code = grid[t.id]?.[d]
                      return s + (code && code !== "A" ? 1 : 0)
                    }, 0)
                    return (
                      <td key={d} className={cn(cb, "py-2 text-center text-[10px] font-medium text-navy-600 dark:text-navy-400")}>
                        {dayTotal > 0 ? dayTotal : ""}
                      </td>
                    )
                  })}
                  <td className={cn(cb, "px-2 py-2 text-center text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-navy-100 dark:bg-navy-800 sticky right-0 z-30")}>
                    {allTeachers.reduce((s, t) => s + getTotal(t.id), 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Export Preview Modal */}
      <AnimatePresence>
        {showPreview && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowPreview(false) }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="bg-white dark:bg-navy-900 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                <div>
                  <h2 className="text-lg font-bold text-navy-900 dark:text-white">Export Preview</h2>
                  <p className="text-sm text-navy-500 dark:text-navy-400">Staff Attendance — {formatMonthLabel(selectedMonth)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" className="border-teal-500 text-teal-700 dark:text-teal-400" onClick={exportCSV}>
                    <Download className="size-4 mr-1" /> CSV
                  </Button>
                  <Button className="bg-red-600 text-white hover:bg-red-500" onClick={exportPDF}>
                    <FileText className="size-4 mr-1" /> PDF
                  </Button>
                  <button onClick={() => setShowPreview(false)} className="rounded-full p-2 hover:bg-navy-100 dark:hover:bg-navy-700 transition-colors ml-1">
                    <X className="size-5 text-navy-500" />
                  </button>
                </div>
              </div>

              <div className="overflow-auto flex-1 p-6">
                <div className="mb-4 flex flex-col items-center text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.png" alt="Ihlamudheen Madrasa" className="h-10 w-auto mb-2"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
                  <p className="text-base font-bold text-navy-900 dark:text-white">Ihlamudheen Madrasa</p>
                  <p className="text-sm text-navy-500 dark:text-navy-400">Ihlamudheen Madrasa · Malappuram, Kerala</p>
                  <p className="text-sm font-semibold text-navy-700 dark:text-navy-300 mt-1">
                    Staff Attendance — {formatMonthLabel(selectedMonth)}
                  </p>
                  <div className="flex flex-wrap justify-center gap-3 text-[10px] text-navy-500 mt-2">
                    {(["H1","H2","HF","ES","EM","ES+EM","S1","S2","ND","A"] as AttendanceCode[]).map((code) => {
                      const labels: Record<string, string> = {
                        H1:"Ihlamudheen 1st Session",H2:"Ihlamudheen 2nd Session",HF:"Ihlamudheen Full Day",
                        ES:"EDU Support",EM:"English Madrasa","ES+EM":"EDU Support+English",
                        S1:"Office Morning",S2:"Office Afternoon",ND:"Normal Duty",A:"Absent",
                      }
                      return (
                        <span key={code} className="flex items-center gap-1">
                          <span className={cn("inline-flex items-center justify-center w-6 h-4 rounded text-[8px] font-bold", CODE_STYLE[code])}>{code}</span>
                          {labels[code]}
                        </span>
                      )
                    })}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-navy-800 text-white">
                        <th className="border border-navy-600 px-2 py-1.5 text-left font-medium">#</th>
                        <th className="border border-navy-600 px-2 py-1.5 text-left font-medium min-w-[120px]">Teacher</th>
                        {days.map((d) => (
                          <th key={d} className="border border-navy-600 px-0 py-1 text-center w-7">
                            <div className="font-bold leading-tight">{d}</div>
                            <div className="text-[7px] text-navy-400 leading-tight">{getDayAbbr(selectedMonth, d)}</div>
                          </th>
                        ))}
                        <th className="border border-navy-600 px-2 py-1.5 text-center font-bold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allTeachers.map((teacher, i) => {
                        const td = grid[teacher.id] || {}
                        const total = getTotal(teacher.id)
                        return (
                          <tr key={teacher.id} className={i % 2 !== 0 ? "bg-navy-50 dark:bg-navy-800/20" : ""}>
                            <td className="border border-navy-200 dark:border-navy-700 px-2 py-1 font-mono text-navy-400">{i + 1}</td>
                            <td className="border border-navy-200 dark:border-navy-700 px-2 py-1 font-medium whitespace-nowrap">{teacher.name}</td>
                            {days.map((d) => {
                              const code = td[d] || ""
                              return (
                                <td key={d} className={cn("border border-navy-200 dark:border-navy-700 px-0 py-1 text-center")}>
                                  {code ? (
                                    <span className={cn("inline-flex items-center justify-center w-7 h-4 rounded text-[8px] font-bold", CODE_STYLE[code])}>{code}</span>
                                  ) : ""}
                                </td>
                              )
                            })}
                            <td className="border border-navy-200 dark:border-navy-700 px-2 py-1 text-center font-bold text-emerald-600 dark:text-emerald-400">
                              {total > 0 ? total : "–"}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Verify online self check-in dialog */}
      {verifyTarget && (
        <VerifyAttendanceDialog
          open={!!verifyTarget}
          onOpenChange={(open) => { if (!open) setVerifyTarget(null) }}
          teacherId={verifyTarget.teacherId}
          teacherName={verifyTarget.name}
          date={`${selectedMonth}-${String(verifyTarget.day).padStart(2, "0")}`}
          records={dayRecords[verifyTarget.teacherId]?.[verifyTarget.day] ?? []}
          reviewerEmail={user?.email ?? "admin"}
          onSaved={loadAttendance}
        />
      )}

      {/* Online months settings (admin only) */}
      <Dialog open={showOnlineMonths} onOpenChange={setShowOnlineMonths}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wifi className="size-5 text-teal-500" /> Online Check-in Months
            </DialogTitle>
            <DialogDescription>
              During these months staff self-mark attendance from My Attendance instead of the
              fingerprint machine.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {onlineMonths.length === 0 && (
                <p className="text-sm text-navy-400">No online months configured.</p>
              )}
              {onlineMonths.map((m) => (
                <span
                  key={m}
                  className="flex items-center gap-1 rounded-full bg-teal-500/15 px-3 py-1 text-xs font-medium text-teal-700 dark:text-teal-300"
                >
                  {formatMonthLabel(m)}
                  <button
                    type="button"
                    aria-label={`Remove ${m}`}
                    onClick={() => saveOnlineMonths(onlineMonths.filter((x) => x !== m))}
                    className="text-teal-600 hover:text-red-500 dark:text-teal-400"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="month"
                value={newOnlineMonth}
                onChange={(e) => setNewOnlineMonth(e.target.value)}
                className="w-full min-w-0 flex-1 rounded-md border border-border bg-transparent px-3 py-1.5 text-sm text-navy-900 dark:text-white sm:w-40"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={!newOnlineMonth || onlineMonths.includes(newOnlineMonth)}
                onClick={() => {
                  saveOnlineMonths([...onlineMonths, newOnlineMonth].sort())
                  setNewOnlineMonth("")
                }}
              >
                <Plus className="size-4 mr-1" /> Add
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOnlineMonths(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
