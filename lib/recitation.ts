// ╔══════════════════════════════════════════════════════════════════╗
// ║ Quran Recitation rubric — single source of truth                  ║
// ║                                                                    ║
// ║ A dedicated recitation teacher assesses each student in a short    ║
// ║ one-on-one slot against a FIXED rubric (identical for every class):║
// ║   Pronunciation Accuracy /20 · Tajweed Rules /20 ·                 ║
// ║   Style and Melody /5 · Start and Stop /5  →  Total /50            ║
// ║                                                                    ║
// ║ Reports are weekly and surface week-over-week progress.            ║
// ╚══════════════════════════════════════════════════════════════════╝

import { getGrade, type GradeInfo } from "./grades"

// ── Fixed rubric ────────────────────────────────────────────────────
export interface RecitationCriterion {
  /** stable key — also the camelCase field on RecitationSession */
  key: "pronunciation" | "tajweed" | "style" | "startStop"
  /** snake_case DB column */
  col: "pronunciation" | "tajweed" | "style" | "start_stop"
  label: string
  /** Arabic name of the criterion — shown alongside the English label in the UI */
  labelAr: string
  max: number
}

export const RECITATION_CRITERIA: RecitationCriterion[] = [
  { key: "pronunciation", col: "pronunciation", label: "Pronunciation Accuracy", labelAr: "مخارج الحروف",      max: 20 },
  { key: "tajweed",       col: "tajweed",       label: "Tajweed Rules",          labelAr: "أحكام التجويد",      max: 20 },
  { key: "style",         col: "style",         label: "Style and Melody",       labelAr: "حسن الأداء والصوت",  max: 5 },
  { key: "startStop",     col: "start_stop",    label: "Start and Stop",         labelAr: "الوقف والإبتداء",    max: 5 },
]

export const RECITATION_MAX = RECITATION_CRITERIA.reduce((s, c) => s + c.max, 0) // 50

// ── Session model ───────────────────────────────────────────────────
export interface RecitationSession {
  id: string
  classId: string
  studentId: string
  date: string            // "YYYY-MM-DD"
  pronunciation: number
  tajweed: number
  style: number
  startStop: number
  total: number           // 0..50 (server keeps in sync; we also compute client-side)
  notes?: string
  assessedBy?: string     // teacher display name
  assessedById?: string
  createdAt?: string
  updatedAt?: string
}

/** Sum of the four sub-scores, clamped to the rubric maximum. */
export function recitationTotal(
  s: Pick<RecitationSession, "pronunciation" | "tajweed" | "style" | "startStop">,
): number {
  const t = (s.pronunciation || 0) + (s.tajweed || 0) + (s.style || 0) + (s.startStop || 0)
  return Math.max(0, Math.min(RECITATION_MAX, t))
}

/** Percentage (0..100) of the 50-mark total. */
export function recitationPct(total: number): number {
  return RECITATION_MAX > 0 ? Math.round((total / RECITATION_MAX) * 100) : 0
}

/** Reuse the canonical 11-tier grade scale, applied to the recitation %. */
export function recitationBand(total: number): GradeInfo {
  return getGrade(recitationPct(total))
}

// ── Weekly grouping (ISO week, Monday-based) ────────────────────────
/** ISO week key like "2026-W23" — sortable lexicographically within a year. */
export function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  // Shift to Thursday of the current week to get the ISO week-year right.
  const target = new Date(d.valueOf())
  const dayNr = (d.getDay() + 6) % 7 // Mon=0 … Sun=6
  target.setDate(target.getDate() - dayNr + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const firstDayNr = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstDayNr + 3)
  const weekNo = 1 + Math.round((target.valueOf() - firstThursday.valueOf()) / (7 * 24 * 3600 * 1000))
  return `${target.getFullYear()}-W${String(weekNo).padStart(2, "0")}`
}

/** Human label for a week key, e.g. "Week 23 · 2026". */
export function weekLabel(key: string): string {
  const [year, w] = key.split("-W")
  return `Week ${parseInt(w, 10)} · ${year}`
}

export interface WeeklyPoint {
  weekKey: string
  label: string
  /** average total (0..50) across all sessions that week */
  avgTotal: number
  /** number of sessions that week */
  count: number
  /** the most recent session of that week (for notes display) */
  last: RecitationSession
}

/**
 * Collapse a student's sessions into one point per ISO week (averaging when a
 * week has multiple sessions), ordered oldest → newest.
 */
export function toWeeklySeries(sessions: RecitationSession[]): WeeklyPoint[] {
  const byWeek = new Map<string, RecitationSession[]>()
  for (const s of sessions) {
    const k = isoWeekKey(s.date)
    const arr = byWeek.get(k)
    if (arr) arr.push(s)
    else byWeek.set(k, [s])
  }
  const points: WeeklyPoint[] = []
  Array.from(byWeek.entries()).forEach(([weekKey, group]) => {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date))
    const avgTotal = Math.round(sorted.reduce((a, s) => a + s.total, 0) / sorted.length)
    points.push({ weekKey, label: weekLabel(weekKey), avgTotal, count: sorted.length, last: sorted[sorted.length - 1] })
  })
  return points.sort((a, b) => a.weekKey.localeCompare(b.weekKey))
}

export interface TrendInfo {
  latest: number | null
  previous: number | null
  delta: number | null            // latest - previous
  direction: "up" | "down" | "flat" | "none"
}

/** Week-over-week movement from a chronologically ordered weekly series. */
export function weeklyTrend(points: WeeklyPoint[]): TrendInfo {
  if (points.length === 0) return { latest: null, previous: null, delta: null, direction: "none" }
  const latest = points[points.length - 1].avgTotal
  if (points.length === 1) return { latest, previous: null, delta: null, direction: "none" }
  const previous = points[points.length - 2].avgTotal
  const delta = latest - previous
  return { latest, previous, delta, direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat" }
}

/** Average of a session list's totals (0..50), rounded. */
export function averageTotal(sessions: RecitationSession[]): number {
  if (sessions.length === 0) return 0
  return Math.round(sessions.reduce((a, s) => a + s.total, 0) / sessions.length)
}
