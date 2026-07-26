"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { motion } from "framer-motion"
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const WEEKLY_TARGET = 28
const MONTHLY_TARGET = 112
const DAILY_MIN = 5
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"]

interface AttendanceRow {
  teacher_id: string
  date: string
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
  weekDays: DayStats[]
  weeklyHours: number
  monthlyHours: number
}

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

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
      week.push(toLocalDateStr(d))
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

function DonutRing({ hours, target }: { hours: number; target: number }) {
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const pct = Math.min(hours / target, 1)
  const dash = pct * circumference
  const gap = circumference - dash
  let strokeColor = "#10b981"
  if (pct < 0.5) strokeColor = "#ef4444"
  else if (pct < 0.9) strokeColor = "#f59e0b"
  return (
    <div className="relative flex items-center justify-center">
      <svg width="88" height="88" viewBox="0 0 88 88" className="-rotate-90">
        <circle cx="44" cy="44" r={radius} fill="none" stroke="currentColor"
          strokeWidth="8" className="text-slate-200 dark:text-navy-700" />
        <circle cx="44" cy="44" r={radius} fill="none" stroke={strokeColor}
          strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }} />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-lg font-bold text-navy-900 dark:text-white">{hours.toFixed(1)}</span>
        <span className="text-[9px] text-slate-500 dark:text-slate-400">hrs</span>
      </div>
    </div>
  )
}

function MonthlyBar({ hours, target }: { hours: number; target: number }) {
  const pct = Math.min((hours / target) * 100, 100)
  let barColor = "bg-red-500"
  let textColor = "text-red-600 dark:text-red-400"
  if (pct >= 90) { barColor = "bg-emerald-500"; textColor = "text-emerald-600 dark:text-emerald-400" }
  else if (pct >= 60) { barColor = "bg-amber-500"; textColor = "text-amber-600 dark:text-amber-400" }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-navy-700 dark:text-navy-200">Monthly Total</span>
        <span className={cn("font-semibold", textColor)}>{hours.toFixed(1)} / {target}h</span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-slate-200 dark:bg-navy-700 overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={cn("h-full rounded-full", barColor)} />
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{pct.toFixed(0)}% of {target}h target</div>
    </div>
  )
}

interface EduSupportWidgetProps {
  teacherId: string
  teacherName: string
}

export function EduSupportWidget({ teacherId, teacherName }: EduSupportWidgetProps) {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())
  const [viewWeekIdx, setViewWeekIdx] = useState(-1) // -1 = auto (current week)
  const [stats, setStats] = useState<TeacherStats | null>(null)
  const [loading, setLoading] = useState(true)

  const weeks = useMemo(() => getWeeksInMonth(viewYear, viewMonth), [viewYear, viewMonth])
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth()

  const effectiveWeekIdx = useMemo(() => {
    if (viewWeekIdx >= 0 && viewWeekIdx < weeks.length) return viewWeekIdx
    const todayStr = toLocalDateStr(now)
    const idx = weeks.findIndex((w) => w.includes(todayStr))
    return idx >= 0 ? idx : weeks.length - 1
  }, [viewWeekIdx, weeks, now])

  const weekDates = weeks[effectiveWeekIdx] ?? []

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleString("en-US", {
    month: "long", year: "numeric",
  })

  function navigateMonth(dir: -1 | 1) {
    let m = viewMonth + dir; let y = viewYear
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    setViewYear(y); setViewMonth(m); setViewWeekIdx(-1)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const localWeeks = getWeeksInMonth(viewYear, viewMonth)
      const wIdx = viewWeekIdx >= 0 && viewWeekIdx < localWeeks.length ? viewWeekIdx
        : (() => {
            const t = toLocalDateStr(new Date())
            const i = localWeeks.findIndex((w) => w.includes(t))
            return i >= 0 ? i : localWeeks.length - 1
          })()
      const wDates = localWeeks[wIdx] ?? []

      // All dates in month
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
      const monthDates: string[] = []
      for (let d = 1; d <= daysInMonth; d++) {
        monthDates.push(toLocalDateStr(new Date(viewYear, viewMonth, d)))
      }
      const allDates = Array.from(new Set([...wDates, ...monthDates])).sort()
      if (!allDates.length) { setLoading(false); return }

      const { data: zktData } = await supabase
        .from("staff_attendance")
        .select("teacher_id, date, arrival_time, departure_time")
        .eq("teacher_id", teacherId)
        .gte("date", allDates[0])
        .lte("date", allDates[allDates.length - 1])
        .ilike("remarks", "Auto — ZKTeco%")

      const { data: allData } = await supabase
        .from("staff_attendance")
        .select("teacher_id, date, arrival_time, departure_time")
        .eq("teacher_id", teacherId)
        .gte("date", allDates[0])
        .lte("date", allDates[allDates.length - 1])

      const rows: AttendanceRow[] = ((zktData ?? allData ?? []) as AttendanceRow[])
      const rowByDate: Record<string, AttendanceRow> = {}
      rows.forEach((r) => { rowByDate[r.date] = r })

      const weekDayStats: DayStats[] = wDates.map((date, idx) => {
        const row = rowByDate[date]
        const hours = row ? parseHours(row.arrival_time, row.departure_time) : 0
        let status: DayStats["status"] = "none"
        if (row?.arrival_time) {
          if (!row.departure_time) status = "none"
          else if (hours >= DAILY_MIN) status = "ok"
          else status = "below"
        }
        return { date, dayLabel: DAY_LABELS[idx], arrival: row?.arrival_time ?? null, departure: row?.departure_time ?? null, hours: status !== "none" ? hours : 0, status }
      })

      const weeklyHours = Math.round(weekDayStats.reduce((s, d) => s + d.hours, 0) * 100) / 100

      let monthlyHours = 0
      for (const date of monthDates) {
        const row = rowByDate[date]
        if (!row?.arrival_time || !row?.departure_time) continue
        const h = parseHours(row.arrival_time, row.departure_time)
        if (h > 0) monthlyHours += h
      }
      monthlyHours = Math.round(monthlyHours * 100) / 100

      setStats({ weekDays: weekDayStats, weeklyHours, monthlyHours })
    } catch (err) {
      console.error("EduSupportWidget fetch error:", err)
    } finally {
      setLoading(false)
    }
  }, [teacherId, viewYear, viewMonth, viewWeekIdx])

  useEffect(() => { fetchData() }, [fetchData])

  const weeklyShort = stats ? stats.weeklyHours < WEEKLY_TARGET : false
  const shortBy = stats ? (WEEKLY_TARGET - stats.weeklyHours).toFixed(1) : "0"

  return (
    <Card className="overflow-hidden border-emerald-500/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-navy-900 dark:text-white">
            <Clock className="size-5 text-emerald-500 shrink-0" />
            My Working Hours
          </CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="flex size-7 items-center justify-center rounded-lg border border-slate-200 dark:border-navy-600 text-slate-400 hover:bg-slate-50 dark:hover:bg-navy-700 transition-colors disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </button>
            <Link
              href="/dashboard/edu-support"
              className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors"
            >
              View full →
            </Link>
          </div>
        </div>

        {/* Month navigator */}
        <div className="flex flex-col items-center gap-1 pt-1">
          <div className="flex items-center gap-3">
            <button onClick={() => navigateMonth(-1)}
              className="flex size-7 items-center justify-center rounded-full border border-slate-200 dark:border-navy-600 bg-white dark:bg-navy-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-navy-700 transition-colors">
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="min-w-[130px] text-center text-sm font-semibold text-navy-900 dark:text-white">
              {monthLabel}
            </span>
            <button onClick={() => navigateMonth(1)} disabled={isCurrentMonth}
              className="flex size-7 items-center justify-center rounded-full border border-slate-200 dark:border-navy-600 bg-white dark:bg-navy-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-navy-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronRight className="size-3.5" />
            </button>
          </div>
          {/* Week navigator */}
          <div className="flex items-center gap-2">
            <button onClick={() => setViewWeekIdx(Math.max(0, effectiveWeekIdx - 1))}
              disabled={effectiveWeekIdx === 0}
              className="flex size-5 items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="text-xs text-navy-500 dark:text-navy-400">
              Week {effectiveWeekIdx + 1} of {weeks.length} &middot; {weekRangeLabel(weekDates)}
            </span>
            <button onClick={() => setViewWeekIdx(Math.min(weeks.length - 1, effectiveWeekIdx + 1))}
              disabled={effectiveWeekIdx >= weeks.length - 1}
              className="flex size-5 items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-navy-400 dark:text-navy-500">
            <RefreshCw className="size-5 animate-spin mr-2 opacity-50" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : !stats ? (
          <p className="py-4 text-center text-sm text-navy-400">No data available</p>
        ) : (
          <div className="rounded-2xl border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 shadow-sm overflow-hidden">
            {/* Card Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-navy-700 bg-slate-50 dark:bg-navy-800/80">
              <div className="flex size-8 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold text-sm shrink-0">
                {teacherName.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm text-navy-900 dark:text-white truncate">{teacherName}</h3>
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
              {/* Ring + weekly table */}
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-center shrink-0">
                  <DonutRing hours={stats.weeklyHours} target={WEEKLY_TARGET} />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    {stats.weeklyHours.toFixed(1)} / {WEEKLY_TARGET}h
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-navy-700">
                    <table className="w-full text-xs table-fixed">
                      <colgroup>
                        <col className="w-9" /><col /><col /><col className="w-10" />
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
                          <tr key={day.date} className={cn("border-t border-slate-100 dark:border-navy-700", idx % 2 !== 0 && "bg-slate-50/60 dark:bg-navy-800/40")}>
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
              <MonthlyBar hours={stats.monthlyHours} target={MONTHLY_TARGET} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
