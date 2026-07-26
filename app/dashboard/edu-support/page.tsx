"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Clock,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  TrendingUp,
  Download,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Sheet,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { initialTeachers } from "@/data/courses"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { useDisabledTeachers } from "@/hooks/use-disabled-teachers"
import { getUserRole } from "@/lib/roles"

// ── Constants ──────────────────────────────────────────────
const WEEKLY_TARGET = 28 // hours
const MONTHLY_TARGET = 112 // hours (28 × 4 weeks)
const DAILY_MIN = 5 // hours
// When a dual EDU+English teacher (the dual-role teacher) attends English Madrasa the same Friday,
// EDU Support hours run from her arrival to this cutoff — even if she punched out earlier.
const EDU_ENGLISH_HANDOFF = "14:45"

const EDU_SUPPORT_IDS = ["t43", "t39", "t40", "t42", "t45", "t47"]
const eduSupportTeachers = initialTeachers.filter((t) =>
  EDU_SUPPORT_IDS.includes(t.id)
)

// Day abbreviations — Mon–Fri only (EDU Support is a 5-day working week)
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"]

// ── Types ──────────────────────────────────────────────────
interface AttendanceRow {
  teacher_id: string
  date: string
  session: string | null
  arrival_time: string | null
  departure_time: string | null
}

interface DayStats {
  date: string
  dayLabel: string
  arrival: string | null
  departure: string | null
  hours: number
  status: "ok" | "below" | "none"
}

interface TeacherStats {
  teacherId: string
  name: string
  weekDays: DayStats[]
  weeklyHours: number
  monthlyHours: number
  monthWeeks: { label: string; hours: number }[]
}

// ── Helper Functions ───────────────────────────────────────
function parseHours(arrival: string | null, departure: string | null): number {
  if (!arrival || !departure) return 0
  const [ah, am] = arrival.split(":").map(Number)
  const [dh, dm] = departure.split(":").map(Number)
  if (isNaN(ah) || isNaN(am) || isNaN(dh) || isNaN(dm)) return 0
  const diff = (dh * 60 + dm - (ah * 60 + am)) / 60
  return diff > 0 ? Math.round(diff * 100) / 100 : 0
}


function formatTime(time: string | null): string {
  if (!time) return "—"
  const [h, m] = time.split(":").map(Number)
  if (isNaN(h) || isNaN(m)) return "—"
  const period = h >= 12 ? "PM" : "AM"
  const hour12 = h % 12 || 12
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`
}

// Local YYYY-MM-DD — uses local calendar components, NOT toISOString().
// In UAE (UTC+4) toISOString() rolls local midnight back to the previous day,
// which shifts every day label by one (Monday's punch shows under "Tue").
function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function getWeekLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const weekNum = Math.ceil(d.getDate() / 7)
  return `Week ${weekNum}`
}

function getMonthDatesFor(year: number, month: number): string[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const dates: string[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(ymd(new Date(year, month, d)))
  }
  return dates
}

// Returns all Mon–Fri week arrays that overlap the given month
function getWeeksInMonth(year: number, month: number): string[][] {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const dow = firstDay.getDay()
  const offset = dow === 0 ? -6 : 1 - dow
  const firstMonday = new Date(firstDay)
  firstMonday.setDate(firstDay.getDate() + offset)
  const weeks: string[][] = []
  const cur = new Date(firstMonday)
  while (cur <= lastDay) {
    const week: string[] = []
    for (let i = 0; i < 5; i++) {
      const d = new Date(cur)
      d.setDate(cur.getDate() + i)
      week.push(ymd(d))
    }
    weeks.push(week)
    cur.setDate(cur.getDate() + 7)
  }
  return weeks
}

function weekRangeLabel(dates: string[]): string {
  if (!dates.length) return ""
  const fmt = (s: string) =>
    new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  return `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`
}

// ── Donut Ring Chart (SVG, no library) ────────────────────
function DonutRing({ hours, target }: { hours: number; target: number }) {
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const pct = Math.min(hours / target, 1)
  const dash = pct * circumference
  const gap = circumference - dash

  let strokeColor = "#10b981" // emerald
  if (pct < 0.5) strokeColor = "#ef4444" // red
  else if (pct < 0.9) strokeColor = "#f59e0b" // amber

  return (
    <div className="relative flex items-center justify-center">
      <svg width="88" height="88" viewBox="0 0 88 88" className="-rotate-90">
        {/* Background track */}
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-slate-200 dark:text-navy-700"
        />
        {/* Progress arc */}
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-lg font-bold text-navy-900 dark:text-white">
          {hours.toFixed(1)}
        </span>
        <span className="text-[9px] text-slate-500 dark:text-slate-400">hrs</span>
      </div>
    </div>
  )
}

// ── Monthly Progress Bar ───────────────────────────────────
function MonthlyBar({ hours, target }: { hours: number; target: number }) {
  const pct = Math.min((hours / target) * 100, 100)
  let barColor = "bg-red-500"
  let textColor = "text-red-600 dark:text-red-400"
  if (pct >= 90) {
    barColor = "bg-emerald-500"
    textColor = "text-emerald-600 dark:text-emerald-400"
  } else if (pct >= 60) {
    barColor = "bg-amber-500"
    textColor = "text-amber-600 dark:text-amber-400"
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-navy-700 dark:text-navy-200">Monthly Total</span>
        <span className={cn("font-semibold", textColor)}>
          {hours.toFixed(1)} / {target}h
        </span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-slate-200 dark:bg-navy-700 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={cn("h-full rounded-full", barColor)}
        />
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400">
        {pct.toFixed(0)}% of {target}h target
      </div>
    </div>
  )
}

// ── Teacher Card ───────────────────────────────────────────
function TeacherCard({ stats }: { stats: TeacherStats }) {
  const weeklyShort = stats.weeklyHours < WEEKLY_TARGET
  const shortBy = (WEEKLY_TARGET - stats.weeklyHours).toFixed(1)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 shadow-sm overflow-hidden"
    >
      {/* Card Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-navy-700 bg-slate-50 dark:bg-navy-800/80">
        <div className="flex size-8 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold text-sm shrink-0">
          {stats.name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-navy-900 dark:text-white truncate">{stats.name}</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">EDU Support — Monthly</p>
        </div>
        {weeklyShort ? (
          <span className="flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3" />{shortBy}h short
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-3" />On track
          </span>
        )}
      </div>

      <div className="p-4 space-y-3">
        {/* Ring chart + weekly table side by side */}
        <div className="flex items-center gap-4">
          {/* Donut ring (smaller) */}
          <div className="flex flex-col items-center shrink-0">
            <DonutRing hours={stats.weeklyHours} target={WEEKLY_TARGET} />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {stats.weeklyHours.toFixed(1)} / {WEEKLY_TARGET}h
            </p>
          </div>
          {/* Daily table */}
          <div className="flex-1 min-w-0">
            <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-navy-700">
              <table className="w-full text-xs table-fixed">
                <colgroup>
                  <col className="w-9" />
                  <col />
                  <col />
                  <col className="w-10" />
                </colgroup>
                <thead>
                  <tr className="bg-slate-100 dark:bg-navy-700/60">
                    <th className="text-left px-1.5 py-1 font-semibold text-slate-500 dark:text-slate-400">Day</th>
                    <th className="text-center px-1 py-1 font-semibold text-slate-500 dark:text-slate-400">IN</th>
                    <th className="text-center px-1 py-1 font-semibold text-slate-500 dark:text-slate-400">OUT</th>
                    <th className="text-center px-1 py-1 font-semibold text-slate-500 dark:text-slate-400">Hrs</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.weekDays.map((day, idx) => (
                    <tr key={day.date} className={cn("border-t border-slate-100 dark:border-navy-700", idx % 2 === 0 ? "" : "bg-slate-50/60 dark:bg-navy-800/40")}>
                      <td className="px-1.5 py-1 font-medium text-navy-800 dark:text-navy-200">{day.dayLabel}</td>
                      <td className="px-1 py-1 text-center text-slate-600 dark:text-slate-300 truncate">{formatTime(day.arrival)}</td>
                      <td className="px-1 py-1 text-center text-slate-600 dark:text-slate-300 truncate">{formatTime(day.departure)}</td>
                      <td className="px-1 py-1 text-center font-semibold text-navy-900 dark:text-white">
                        {day.status === "none" ? "—" : `${day.hours.toFixed(1)}h`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Monthly summary */}
        <MonthlyBar hours={stats.monthlyHours} target={MONTHLY_TARGET} />
      </div>
    </motion.div>
  )
}

// ── CSV Export ─────────────────────────────────────────────
function exportCSV(stats: TeacherStats[], selectedMonthLabel: string, weekLabel: string) {
  const now = new Date()
  const dateLabel = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  const timeLabel = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

  const rows: string[][] = []

  // Report header
  rows.push([`EDU Support — Working Hours Report (${selectedMonthLabel})`])
  rows.push([`Generated: ${dateLabel} ${timeLabel}`])
  rows.push([`Target: ${WEEKLY_TARGET}h/week  •  ${MONTHLY_TARGET}h/month  •  Min ${DAILY_MIN}h/day`])
  rows.push([])

  // ── Summary table ──
  rows.push(["SUMMARY"])
  rows.push(["Teacher", `${weekLabel} (h)`, `/ ${WEEKLY_TARGET}h`, `${selectedMonthLabel} (h)`, `/ ${MONTHLY_TARGET}h`, "Status"])
  for (const t of stats) {
    const onTrack = t.weeklyHours >= WEEKLY_TARGET
    const shortBy = (WEEKLY_TARGET - t.weeklyHours).toFixed(1)
    rows.push([
      t.name,
      t.weeklyHours.toFixed(1),
      `${((t.weeklyHours / WEEKLY_TARGET) * 100).toFixed(0)}%`,
      t.monthlyHours.toFixed(1),
      `${((t.monthlyHours / MONTHLY_TARGET) * 100).toFixed(0)}%`,
      onTrack ? "On Track" : `${shortBy}h short`,
    ])
  }
  const totalWeek = stats.reduce((s, t) => s + t.weeklyHours, 0)
  const totalMonth = stats.reduce((s, t) => s + t.monthlyHours, 0)
  rows.push([
    "TOTAL",
    totalWeek.toFixed(1),
    "",
    totalMonth.toFixed(1),
    "",
    `${stats.filter(t => t.weeklyHours >= WEEKLY_TARGET).length}/${stats.length} on track`,
  ])
  rows.push([])

  // ── Per-teacher daily breakdown ──
  rows.push([`DAILY BREAKDOWN — ${weekLabel.toUpperCase()}`])
  for (const t of stats) {
    rows.push([])
    rows.push([t.name])
    rows.push(["Day", "Date", "In", "Out", "Hours", "Status"])
    for (const d of t.weekDays) {
      rows.push([
        d.dayLabel,
        d.date,
        formatTime(d.arrival),
        formatTime(d.departure),
        d.status === "none" ? "—" : `${d.hours.toFixed(1)}h`,
        d.status === "ok" ? "OK" : d.status === "below" ? "Below min" : "Absent",
      ])
    }
    rows.push(["", "", "", "Weekly Total", `${t.weeklyHours.toFixed(1)}h`, ""])
  }

  // Convert to CSV string
  const csv = rows
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\r\n")

  // Trigger download
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `edu-support-hours-${ymd(now)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── PDF Export ─────────────────────────────────────────────
async function exportPDF(stats: TeacherStats[], selectedMonthLabel: string, weekLabel: string) {
  // Dynamically import so the library is only loaded when needed
  const { default: jsPDF } = await import("jspdf")
  const { default: autoTable } = await import("jspdf-autotable")

  const now = new Date()
  const dateLabel = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  const timeLabel = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const pageW = doc.internal.pageSize.getWidth()
  let y = 15

  // ── Header ──
  doc.setFontSize(18)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(15, 185, 129) // emerald
  doc.text(`EDU Support — Working Hours Report (${selectedMonthLabel})`, pageW / 2, y, { align: "center" })
  y += 8

  doc.setFontSize(9)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(100, 100, 100)
  doc.text(
    `Ihlamudheen Madrasa  •  Generated: ${dateLabel} ${timeLabel}`,
    pageW / 2, y, { align: "center" }
  )
  y += 5
  doc.text(
    `Target: ${WEEKLY_TARGET}h/week  •  ${MONTHLY_TARGET}h/month  •  Min ${DAILY_MIN}h/day  •  Mon–Fri`,
    pageW / 2, y, { align: "center" }
  )
  y += 8

  // ── Summary table ──
  doc.setFontSize(11)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(30, 30, 30)
  doc.text("Summary", 14, y)
  y += 4

  const summaryBody = stats.map(t => {
    const onTrack = t.weeklyHours >= WEEKLY_TARGET
    return [
      t.name,
      `${t.weeklyHours.toFixed(1)}h`,
      `${((t.weeklyHours / WEEKLY_TARGET) * 100).toFixed(0)}%`,
      `${t.monthlyHours.toFixed(1)}h`,
      `${((t.monthlyHours / MONTHLY_TARGET) * 100).toFixed(0)}%`,
      onTrack ? "On Track" : `${(WEEKLY_TARGET - t.weeklyHours).toFixed(1)}h short`,
    ]
  })
  const totalWeek = stats.reduce((s, t) => s + t.weeklyHours, 0)
  const totalMonth = stats.reduce((s, t) => s + t.monthlyHours, 0)
  summaryBody.push([
    "TOTAL",
    `${totalWeek.toFixed(1)}h`,
    "",
    `${totalMonth.toFixed(1)}h`,
    "",
    `${stats.filter(t => t.weeklyHours >= WEEKLY_TARGET).length}/${stats.length} on track`,
  ])

  autoTable(doc, {
    startY: y,
    head: [[`Teacher`, weekLabel, "%", selectedMonthLabel, "%", "Status"]],
    body: summaryBody,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [15, 185, 129], textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 52 }, 5: { cellWidth: 28 } },
    alternateRowStyles: { fillColor: [245, 255, 250] },
    didParseCell: (data) => {
      // Colour status cell
      if (data.section === "body" && data.column.index === 5) {
        const val = String(data.cell.raw)
        if (val === "On Track") data.cell.styles.textColor = [15, 185, 129]
        else if (val.includes("short")) data.cell.styles.textColor = [217, 119, 6]
      }
      // Bold total row
      if (data.section === "body" && data.row.index === stats.length) {
        data.cell.styles.fontStyle = "bold"
        data.cell.styles.fillColor = [230, 255, 245]
      }
    },
  })

  // ── Per-teacher daily breakdown ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 10

  doc.setFontSize(11)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(30, 30, 30)
  doc.text(`Daily Breakdown — ${weekLabel}`, 14, y)
  y += 4

  for (const t of stats) {
    const body = t.weekDays.map(d => [
      d.dayLabel,
      d.date,
      formatTime(d.arrival),
      formatTime(d.departure),
      d.status === "none" ? "—" : `${d.hours.toFixed(1)}h`,
      d.status === "ok" ? "OK" : d.status === "below" ? "Below min" : "Absent",
    ])
    body.push(["", "", "", "Weekly Total", `${t.weeklyHours.toFixed(1)}h`, ""])

    autoTable(doc, {
      startY: y,
      head: [[{ content: t.name, colSpan: 6, styles: { fillColor: [30, 58, 100], textColor: 255, fontStyle: "bold" } }],
             ["Day", "Date", "In", "Out", "Hours", "Status"]],
      body,
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      headStyles: { fillColor: [51, 65, 85], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 14 }, 1: { cellWidth: 26 },
        2: { cellWidth: 22 }, 3: { cellWidth: 22 },
        4: { cellWidth: 18 }, 5: { cellWidth: 22 },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 5) {
          const val = String(data.cell.raw)
          if (val === "OK") data.cell.styles.textColor = [15, 185, 129]
          else if (val === "Below min") data.cell.styles.textColor = [217, 119, 6]
          else if (val === "Absent") data.cell.styles.textColor = [239, 68, 68]
        }
        // Bold total row
        if (data.section === "body" && data.row.index === t.weekDays.length) {
          data.cell.styles.fontStyle = "bold"
        }
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6
  }

  // ── Footer on each page ──
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5)
    doc.setTextColor(150)
    doc.text(
      `Ihlamudheen Madrasa — Confidential  •  Page ${i} of ${pageCount}`,
      pageW / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: "center" }
    )
  }

  doc.save(`edu-support-hours-${ymd(now)}.pdf`)
}

// ── Main Page ──────────────────────────────────────────────
export default function EduSupportPage() {
  const { user, loading: authLoading } = useAuth(true)
  const { disabledIds } = useDisabledTeachers()
  const role = user ? getUserRole(user) : "student"
  const isAdmin = role === "admin" || role === "accountant"

  const [teacherStats, setTeacherStats] = useState<TeacherStats[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [showExport, setShowExport] = useState(false)

  // Month / week navigation
  const todayDate = new Date()
  const [viewYear, setViewYear] = useState(todayDate.getFullYear())
  const [viewMonth, setViewMonth] = useState(todayDate.getMonth()) // 0-indexed
  const [viewWeekIdx, setViewWeekIdx] = useState(-1) // -1 = auto (current or last week)

  const isCurrentMonth =
    viewYear === new Date().getFullYear() && viewMonth === new Date().getMonth()

  const weeksInMonth = useMemo(() => getWeeksInMonth(viewYear, viewMonth), [viewYear, viewMonth])

  const effectiveWeekIdx = useMemo(() => {
    if (viewWeekIdx >= 0 && viewWeekIdx < weeksInMonth.length) return viewWeekIdx
    const todayStr = ymd(new Date())
    const idx = weeksInMonth.findIndex((w) => w.includes(todayStr))
    return idx >= 0 ? idx : weeksInMonth.length - 1
  }, [viewWeekIdx, weeksInMonth])

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  })

  function navigateMonth(dir: -1 | 1) {
    let newMonth = viewMonth + dir
    let newYear = viewYear
    if (newMonth < 0) { newMonth = 11; newYear-- }
    if (newMonth > 11) { newMonth = 0; newYear++ }
    setViewYear(newYear)
    setViewMonth(newMonth)
    setViewWeekIdx(-1)
  }

  // Identify the logged-in teacher (for teacher role)
  const selfTeacher = (() => {
    if (isAdmin) return null
    const fullName = user?.user_metadata?.full_name as string | undefined
    const email = user?.email ?? ""
    // Try matching by full_name first, then email prefix
    return (
      eduSupportTeachers.find(
        (t) =>
          fullName &&
          t.name.toLowerCase().trim() === fullName.toLowerCase().trim()
      ) ??
      eduSupportTeachers.find((t) =>
        t.name
          .toLowerCase()
          .replace(/\s+/g, "")
          .includes(email.split("@")[0].toLowerCase())
      ) ??
      null
    )
  })()

  // Disabled staff (left Ihlamudheen Madrasa) drop out of the EDU-support hours view.
  const targetTeachers = (isAdmin
    ? eduSupportTeachers
    : selfTeacher
    ? [selfTeacher]
    : []
  ).filter((t) => !disabledIds.has(t.id))

  const fetchData = useCallback(async () => {
    if (targetTeachers.length === 0) {
      setLoading(false)
      return
    }

    setLoading(true)

    const localWeeks = getWeeksInMonth(viewYear, viewMonth)
    const localWeekIdx = viewWeekIdx >= 0 && viewWeekIdx < localWeeks.length
      ? viewWeekIdx
      : (() => {
          const todayStr = ymd(new Date())
          const idx = localWeeks.findIndex((w) => w.includes(todayStr))
          return idx >= 0 ? idx : localWeeks.length - 1
        })()
    const weekDates = localWeeks[localWeekIdx] ?? []
    const monthDates = getMonthDatesFor(viewYear, viewMonth)
    const allDates = Array.from(new Set([...weekDates, ...monthDates])).sort()

    const teacherIds = targetTeachers.map((t) => t.id)

    const { data, error } = await supabase
      .from("staff_attendance")
      .select("teacher_id, date, session, arrival_time, departure_time")
      .in("teacher_id", teacherIds)
      .gte("date", allDates[0])
      .lte("date", allDates[allDates.length - 1])
      // Filter remarks LIKE 'Auto — ZKTeco%' — we filter client-side as supabase ilike
      // but also fetch all and filter below since remarks column not selected for perf

    // Note: remarks filter applied via a separate query pattern
    const { data: zktData } = await supabase
      .from("staff_attendance")
      .select("teacher_id, date, session, arrival_time, departure_time")
      .in("teacher_id", teacherIds)
      .gte("date", allDates[0])
      .lte("date", allDates[allDates.length - 1])
      .ilike("remarks", "Auto — ZKTeco%")

    // Use zktData if available, else fall back to data (graceful degradation)
    const rows: AttendanceRow[] = (zktData ?? data ?? []) as AttendanceRow[]

    if (error && !zktData) {
      console.error("EDU Support fetch error:", error)
      setLoading(false)
      return
    }

    // Build a map: teacherId -> date -> all rows for that date
    // (dual-role days like the dual-role teacher's Friday have an EDU row + an English row)
    const rowMap: Record<string, Record<string, AttendanceRow[]>> = {}
    for (const row of rows) {
      if (!rowMap[row.teacher_id]) rowMap[row.teacher_id] = {}
      if (!rowMap[row.teacher_id][row.date]) rowMap[row.teacher_id][row.date] = []
      rowMap[row.teacher_id][row.date].push(row)
    }

    const stats: TeacherStats[] = targetTeachers.map((teacher) => {
      const tRows = rowMap[teacher.id] ?? {}
      const isDualEduEnglish = teacher.dualPayType === "per-day-english"

      // Returns the EDU hours for a date, applying the 14:45 handoff rule for
      // dual EDU+English teachers when they also attend English Madrasa that day.
      function eduHoursForDate(date: string): { arrival: string | null; departure: string | null; hours: number } {
        const dayRows = tRows[date] ?? []
        const isFriday = new Date(date + "T12:00:00").getDay() === 5

        // EDU record = any punch whose session is NOT the English/CIBIS evening session
        const eduRow = dayRows.find(r => r.session !== "evening" && r.session !== "cibis")
          ?? dayRows[0]
          ?? null

        const hasEnglish = isDualEduEnglish && isFriday &&
          dayRows.some(r => r.session === "evening" && r.arrival_time)

        if (!eduRow?.arrival_time) return { arrival: null, departure: null, hours: 0 }

        if (hasEnglish) {
          // Present for English → credit EDU from arrival to 14:45 regardless of
          // when she punched out (she was at the institute the whole time).
          return {
            arrival: eduRow.arrival_time,
            departure: eduRow.departure_time,  // display real punch-out as-is
            hours: parseHours(eduRow.arrival_time, EDU_ENGLISH_HANDOFF),
          }
        }
        if (eduRow.departure_time) {
          return {
            arrival: eduRow.arrival_time,
            departure: eduRow.departure_time,
            hours: parseHours(eduRow.arrival_time, eduRow.departure_time),
          }
        }
        // No departure punch and not a handoff day — show punch-in but don't credit hours
        return { arrival: eduRow.arrival_time, departure: null, hours: 0 }
      }

      // Week days
      const weekDays: DayStats[] = weekDates.map((date, idx) => {
        const { arrival, departure, hours } = eduHoursForDate(date)
        let status: DayStats["status"] = "none"
        if (arrival) {
          if (hours >= DAILY_MIN) status = "ok"
          else if (hours > 0) status = "below"
          // hours === 0 (no departure, no handoff) → status stays "none"
        }
        return {
          date,
          dayLabel: DAY_LABELS[idx],
          arrival,
          departure,
          hours,
          status,
        }
      })

      const weeklyHours = weekDays.reduce((sum, d) => sum + d.hours, 0)

      // Monthly hours + week buckets
      const weekBuckets: Record<string, number> = {}
      let monthlyHours = 0

      for (const date of monthDates) {
        const { hours: h } = eduHoursForDate(date)
        if (h <= 0) continue
        monthlyHours += h
        const wLabel = getWeekLabel(date)
        weekBuckets[wLabel] = (weekBuckets[wLabel] ?? 0) + h
      }

      const monthWeeks = Object.entries(weekBuckets).map(([label, hours]) => ({
        label,
        hours,
      }))

      return {
        teacherId: teacher.id,
        name: teacher.name,
        weekDays,
        weeklyHours: Math.round(weeklyHours * 100) / 100,
        monthlyHours: Math.round(monthlyHours * 100) / 100,
        monthWeeks,
      }
    })

    setTeacherStats(stats)
    setLastRefresh(new Date())
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isAdmin, viewYear, viewMonth, viewWeekIdx, disabledIds])

  useEffect(() => {
    if (!authLoading) fetchData()
  }, [authLoading, fetchData])

  // Live refresh every 5 minutes — only for the current month
  useEffect(() => {
    if (!isCurrentMonth) return
    const interval = setInterval(
      () => {
        if (!authLoading) fetchData()
      },
      5 * 60 * 1000
    )
    return () => clearInterval(interval)
  }, [authLoading, fetchData, isCurrentMonth])

  if (authLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-emerald-500" />
      </div>
    )
  }

  // Access guard: only admin, accountant, or edu-support teachers
  if (!isAdmin && !selfTeacher) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
        <AlertTriangle className="size-10 text-amber-500" />
        <p className="text-lg font-semibold text-navy-900 dark:text-white">Access Restricted</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          This page is only available to EDU Support staff and administrators.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-navy-900 dark:text-white sm:text-3xl">
            <Clock className="size-7 text-emerald-500" />
            EDU Support — Working Hours
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Mon–Fri &bull; 8:30 AM – 1:30 PM &bull; Min {DAILY_MIN}h/day &bull; <strong className="text-emerald-600 dark:text-emerald-400">{WEEKLY_TARGET}h/week</strong> &bull; {MONTHLY_TARGET}h/month
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
            Pay is 1,500 AED/month for {MONTHLY_TARGET} hrs (13.39 AED/hr). Below {MONTHLY_TARGET} hrs → deducted per hour. Hours can be made up on Saturdays and Sundays.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 dark:text-slate-500">
            Updated {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {isAdmin && teacherStats.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowExport(v => !v)}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
              >
                <Download className="size-4" />
                Export
                <ChevronDown className={cn("size-3.5 transition-transform", showExport && "rotate-180")} />
              </button>
              <AnimatePresence>
                {showExport && (
                  <>
                    {/* Backdrop to close on outside click */}
                    <div className="fixed inset-0 z-10" onClick={() => setShowExport(false)} />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -4 }}
                      transition={{ duration: 0.12 }}
                      className="absolute right-0 top-full mt-1.5 z-20 min-w-[148px] rounded-xl border border-slate-200 dark:border-navy-600 bg-white dark:bg-navy-800 shadow-lg overflow-hidden"
                    >
                      <button
                        onClick={() => { exportPDF(teacherStats, monthLabel, `Week ${effectiveWeekIdx + 1}`); setShowExport(false) }}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-700 dark:hover:text-rose-400 transition-colors"
                      >
                        <FileText className="size-4 shrink-0" />
                        Download PDF
                      </button>
                      <div className="h-px bg-slate-100 dark:bg-navy-700" />
                      <button
                        onClick={() => { exportCSV(teacherStats, monthLabel, `Week ${effectiveWeekIdx + 1}`); setShowExport(false) }}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
                      >
                        <Sheet className="size-4 shrink-0" />
                        Download CSV
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          )}
          <button
            onClick={() => fetchData()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-navy-600 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-navy-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </motion.div>

      {/* Month + week navigation */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-2"
      >
        {/* Month selector */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateMonth(-1)}
            className="flex items-center justify-center size-8 rounded-full border border-slate-200 dark:border-navy-600 bg-white dark:bg-navy-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-navy-700 transition-colors"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-[140px] text-center text-base font-semibold text-navy-900 dark:text-white">
            {monthLabel}
          </span>
          <button
            onClick={() => navigateMonth(1)}
            disabled={isCurrentMonth}
            className="flex items-center justify-center size-8 rounded-full border border-slate-200 dark:border-navy-600 bg-white dark:bg-navy-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-navy-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        {/* Week selector */}
        {weeksInMonth.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewWeekIdx(Math.max(0, effectiveWeekIdx - 1))}
              disabled={effectiveWeekIdx === 0}
              className="flex items-center justify-center size-6 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400 min-w-[170px] text-center">
              Week {effectiveWeekIdx + 1} of {weeksInMonth.length}
              {" · "}
              {weekRangeLabel(weeksInMonth[effectiveWeekIdx] ?? [])}
            </span>
            <button
              onClick={() => setViewWeekIdx(Math.min(weeksInMonth.length - 1, effectiveWeekIdx + 1))}
              disabled={effectiveWeekIdx === weeksInMonth.length - 1}
              className="flex items-center justify-center size-6 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        )}
      </motion.div>

      {/* Summary strip (admin only) — teacher list with hours */}
      {isAdmin && !loading && teacherStats.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 overflow-hidden"
        >
          {/* Header row */}
          <div className="grid grid-cols-4 gap-2 px-4 py-2 bg-slate-50 dark:bg-navy-700/50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <span>Teacher</span>
            <span className="text-center">Wk {effectiveWeekIdx + 1}</span>
            <span className="text-center">{monthLabel}</span>
            <span className="text-center">Status</span>
          </div>
          {/* Teacher rows */}
          {teacherStats.map((t, i) => {
            const onTrack = t.weeklyHours >= WEEKLY_TARGET
            const pctWeek = Math.min((t.weeklyHours / WEEKLY_TARGET) * 100, 100)
            return (
              <div key={t.teacherId} className={cn("grid grid-cols-4 gap-2 px-4 py-3 items-center border-t border-slate-100 dark:border-navy-700", i % 2 === 0 ? "" : "bg-slate-50/50 dark:bg-navy-700/20")}>
                {/* Name */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    {t.name.charAt(0)}
                  </div>
                  <span className="text-sm font-medium text-navy-900 dark:text-white truncate">{t.name}</span>
                </div>
                {/* Weekly hours + mini bar */}
                <div className="text-center">
                  <p className={cn("text-sm font-bold", onTrack ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                    {t.weeklyHours.toFixed(1)}h
                  </p>
                  <div className="mt-1 h-1 rounded-full bg-slate-200 dark:bg-navy-600 overflow-hidden mx-2">
                    <div className={cn("h-full rounded-full transition-all", onTrack ? "bg-emerald-500" : pctWeek >= 50 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${pctWeek}%` }} />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">/ {WEEKLY_TARGET}h</p>
                </div>
                {/* Monthly hours */}
                <div className="text-center">
                  <p className="text-sm font-bold text-navy-900 dark:text-white">{t.monthlyHours.toFixed(1)}h</p>
                  <p className="text-[10px] text-slate-400">/ {MONTHLY_TARGET}h</p>
                </div>
                {/* Status badge */}
                <div className="flex justify-center">
                  {onTrack ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="size-3" /> On Track
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="size-3" /> {(WEEKLY_TARGET - t.weeklyHours).toFixed(1)}h short
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          {/* Footer totals */}
          <div className="grid grid-cols-4 gap-2 px-4 py-2.5 bg-slate-50 dark:bg-navy-700/50 border-t border-slate-200 dark:border-navy-600">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1"><TrendingUp className="size-3" /> Total</span>
            <span className="text-center text-xs font-bold text-navy-900 dark:text-white">{teacherStats.reduce((s, t) => s + t.weeklyHours, 0).toFixed(1)}h</span>
            <span className="text-center text-xs font-bold text-navy-900 dark:text-white">{teacherStats.reduce((s, t) => s + t.monthlyHours, 0).toFixed(1)}h</span>
            <span className="text-center text-[11px] text-slate-400">{teacherStats.filter(t => t.weeklyHours >= WEEKLY_TARGET).length}/{teacherStats.length} on track</span>
          </div>
        </motion.div>
      )}

      {/* Loading state */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex h-48 items-center justify-center"
          >
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="size-8 animate-spin text-emerald-500" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Loading attendance data…
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Teacher Cards */}
      {!loading && teacherStats.length > 0 && (
        <div
          className={cn(
            isAdmin
              ? "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
              : "flex justify-center"
          )}
        >
          {teacherStats.map((stats) => (
            <div
              key={stats.teacherId}
              className={cn(!isAdmin && "w-full max-w-2xl")}
            >
              <TeacherCard stats={stats} />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && teacherStats.length === 0 && (
        <div className="flex h-48 flex-col items-center justify-center gap-3 text-center">
          <Clock className="size-10 text-slate-300 dark:text-slate-600" />
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            No attendance data found for this period.
          </p>
        </div>
      )}
    </div>
  )
}
