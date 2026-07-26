// Bell timetable — period / break / prayer / bell schedules for a teaching day.
//
// Models the bell schedules used across the institute. The shape is generic so
// further programs/days can be added as constants here without touching the
// page that renders them.
//
// Times are stored in 24-hour "HH:MM" form for easy arithmetic; use
// `formatTime` for the "9:00 AM" display strings.

export type SegmentKind = "period" | "break" | "prayer"

export interface TimetableSegment {
  kind: SegmentKind
  /** Display label, e.g. "Period 1", "Break", "Dhuhr Prayer". */
  label: string
  /** 24-hour start time, "HH:MM". */
  start: string
  /** 24-hour end time, "HH:MM". */
  end: string
  /** Duration in minutes (derived, kept explicit for display). */
  durationMin: number
  /** When true, no bell rings at this segment's end. */
  noBell?: boolean
  /** Override label for the bell that rings at this segment's end. */
  bellLabel?: string
}

export interface BellTimetable {
  id: string
  /** Program/course this timetable applies to. */
  program: string
  /** Days of the week this timetable runs (display). */
  days: string[]
  /** JS `Date.getDay()` indexes this timetable runs on (Sun = 0 … Sat = 6). */
  dayIndexes: number[]
  /** Time of the warning "first bell" before the first period, "HH:MM". */
  firstBell: string
  segments: TimetableSegment[]
  /** Optional closing note shown after the final bell (e.g. dispersal). */
  closing?: { time: string; label: string }
}

// ── EDU SUPPORT — Monday to Thursday ─────────────────────────────
export const EDU_SUPPORT_MON_THU: BellTimetable = {
  id: "edu-support-mon-thu",
  program: "EDU Support",
  days: ["Monday – Thursday"],
  dayIndexes: [1, 2, 3, 4],
  firstBell: "08:55",
  segments: [
    { kind: "period", label: "Period 1", start: "09:00", end: "09:50", durationMin: 50 },
    { kind: "period", label: "Period 2", start: "09:50", end: "10:35", durationMin: 45 },
    { kind: "break", label: "Break", start: "10:35", end: "10:50", durationMin: 15 },
    { kind: "period", label: "Period 3", start: "10:50", end: "11:35", durationMin: 45 },
    { kind: "period", label: "Period 4", start: "11:35", end: "12:20", durationMin: 45 },
    { kind: "period", label: "Period 5", start: "12:20", end: "13:05", durationMin: 45 },
  ],
}

// ── EDU SUPPORT — Friday ─────────────────────────────────────────
export const EDU_SUPPORT_FRI: BellTimetable = {
  id: "edu-support-fri",
  program: "EDU Support",
  days: ["Friday"],
  dayIndexes: [5],
  firstBell: "08:55",
  segments: [
    { kind: "period", label: "Period 1", start: "09:00", end: "09:45", durationMin: 45 },
    { kind: "period", label: "Period 2", start: "09:45", end: "10:25", durationMin: 40 },
    { kind: "break", label: "Break", start: "10:25", end: "10:40", durationMin: 15 },
    { kind: "period", label: "Period 3", start: "10:40", end: "11:20", durationMin: 40 },
    { kind: "period", label: "Period 4", start: "11:20", end: "12:00", durationMin: 40 },
  ],
}

// ── ENGLISH MADRASA — Friday (afternoon/evening) ─────────────────
export const ENGLISH_MADRASA_FRI: BellTimetable = {
  id: "english-madrasa-fri",
  program: "English Madrasa",
  days: ["Friday"],
  dayIndexes: [5],
  firstBell: "14:55",
  segments: [
    { kind: "period", label: "Period 1", start: "15:00", end: "15:45", durationMin: 45 },
    // Asar prayer follows directly — no bell at Period 2's end.
    { kind: "period", label: "Period 2", start: "15:45", end: "16:30", durationMin: 45, noBell: true },
    { kind: "prayer", label: "Asar Prayer", start: "16:30", end: "16:45", durationMin: 15, noBell: true },
    { kind: "period", label: "Period 3", start: "16:45", end: "17:30", durationMin: 45 },
    { kind: "period", label: "Period 4", start: "17:30", end: "18:15", durationMin: 45 },
    // Maghrib prayer follows directly — no bell at Period 5's end.
    { kind: "period", label: "Period 5", start: "18:15", end: "19:00", durationMin: 45, noBell: true },
    { kind: "prayer", label: "Maghrib Prayer", start: "19:00", end: "19:15", durationMin: 15, noBell: true },
    { kind: "period", label: "Final Session", start: "19:15", end: "19:25", durationMin: 10, bellLabel: "Final Bell" },
  ],
  closing: { time: "19:30", label: "Dispersal / End of Classes" },
}

// ── Ihlamudheen Madrasa — Saturday & Sunday ─────────────────────────────────
export const MADRASA_SAT_SUN: BellTimetable = {
  id: "madrasa-madrasa-sat-sun",
  program: "Ihlamudheen Madrasa",
  days: ["Saturday", "Sunday"],
  dayIndexes: [6, 0],
  firstBell: "08:55",
  segments: [
    { kind: "period", label: "Period 1", start: "09:00", end: "09:40", durationMin: 40 },
    { kind: "period", label: "Period 2", start: "09:40", end: "10:20", durationMin: 40 },
    { kind: "period", label: "Period 3", start: "10:20", end: "11:00", durationMin: 40 },
    // Break end (11:15) has no bell in this schedule.
    { kind: "break", label: "Break", start: "11:00", end: "11:15", durationMin: 15, noBell: true },
    { kind: "period", label: "Period 4", start: "11:15", end: "12:10", durationMin: 55 },
    { kind: "period", label: "Period 5", start: "12:10", end: "13:00", durationMin: 50 },
    { kind: "prayer", label: "Dhuhr Prayer", start: "13:00", end: "13:25", durationMin: 25, bellLabel: "Final Bell" },
  ],
  closing: { time: "13:30", label: "Salath / Dispersal" },
}

export const BELL_TIMETABLES: BellTimetable[] = [
  MADRASA_SAT_SUN,
  EDU_SUPPORT_MON_THU,
  EDU_SUPPORT_FRI,
  ENGLISH_MADRASA_FRI,
]

// ── Helpers ───────────────────────────────────────────────────────────

/** "HH:MM" → minutes since midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

/** "HH:MM" (24h) → "9:00 AM" (12h). */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, "0")} ${period}`
}

/** Minutes → "1h 5m" / "45m". */
export function formatDuration(mins: number): string {
  if (mins <= 0) return "0m"
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

export interface BellMoment {
  /** 24-hour "HH:MM". */
  time: string
  label: string
}

/**
 * All bell moments for a timetable, in order: the first bell, then the end of
 * every segment that rings a bell. The last ringing segment is labelled
 * "Final Bell" unless it carries an explicit `bellLabel`.
 */
export function getBellMoments(tt: BellTimetable): BellMoment[] {
  const bells: BellMoment[] = [{ time: tt.firstBell, label: "First Bell" }]
  const lastRingingIdx = (() => {
    for (let i = tt.segments.length - 1; i >= 0; i--) if (!tt.segments[i].noBell) return i
    return -1
  })()
  tt.segments.forEach((seg, i) => {
    if (seg.noBell) return
    let label: string
    if (seg.bellLabel) label = seg.bellLabel
    else if (i === lastRingingIdx) label = "Final Bell"
    else if (seg.kind === "break") label = "End of Break"
    else label = "Bell"
    bells.push({ time: seg.end, label })
  })
  return bells
}

export type DayStatus = "before" | "active" | "after"

export interface TimetableNow {
  status: DayStatus
  /** The segment in progress right now (when status === "active"). */
  current: TimetableSegment | null
  /** The next segment that will start (when before/active and one remains). */
  next: TimetableSegment | null
  /** Minutes remaining in the current segment (when active). */
  minsLeftInCurrent: number
  /** Minutes until the next thing begins (first bell, or the next segment). */
  minsToNext: number
  /** The next bell moment, if any remain in the day. */
  nextBell: BellMoment | null
  /** Minutes until that next bell. */
  minsToNextBell: number
}

/**
 * Compute where `now` (minutes since midnight) falls within the timetable.
 * Day-agnostic — callers decide whether today is a timetable day.
 */
export function getTimetableNow(tt: BellTimetable, nowMins: number): TimetableNow {
  const segs = tt.segments
  const dayStart = toMinutes(tt.firstBell)
  const dayEnd = toMinutes(segs[segs.length - 1].end)

  // Next bell after `now`
  const bells = getBellMoments(tt)
  const nextBellEntry = bells.find((b) => toMinutes(b.time) > nowMins) ?? null

  const base = {
    nextBell: nextBellEntry,
    minsToNextBell: nextBellEntry ? toMinutes(nextBellEntry.time) - nowMins : 0,
  }

  if (nowMins < dayStart) {
    return {
      status: "before",
      current: null,
      next: segs[0],
      minsLeftInCurrent: 0,
      minsToNext: dayStart - nowMins,
      ...base,
    }
  }

  if (nowMins >= dayEnd) {
    return {
      status: "after",
      current: null,
      next: null,
      minsLeftInCurrent: 0,
      minsToNext: 0,
      ...base,
    }
  }

  // Within the school day
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const sStart = toMinutes(s.start)
    const sEnd = toMinutes(s.end)
    if (nowMins >= sStart && nowMins < sEnd) {
      return {
        status: "active",
        current: s,
        next: segs[i + 1] ?? null,
        minsLeftInCurrent: sEnd - nowMins,
        minsToNext: sEnd - nowMins,
        ...base,
      }
    }
  }

  // Between firstBell and the first period — treat as "before period 1"
  return {
    status: "before",
    current: null,
    next: segs[0],
    minsLeftInCurrent: 0,
    minsToNext: Math.max(0, toMinutes(segs[0].start) - nowMins),
    ...base,
  }
}
