// ── Types ─────────────────────────────────────────────────────────────────────

export interface SelfReport {
  fajr: boolean; dhuhr: boolean; asr: boolean; maghrib: boolean; isha: boolean
  quran: boolean; reading: boolean; writing: boolean
}

export type DayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri"

export const EMPTY_REPORT: SelfReport = {
  fajr: false, dhuhr: false, asr: false, maghrib: false, isha: false,
  quran: false, reading: false, writing: false,
}

export const PRAYERS: (keyof SelfReport)[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"]

export const DAY_LABELS: Record<DayKey, string> = {
  sat: "Saturday", sun: "Sunday", mon: "Monday",
  tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday",
}

export const DAY_SHORT: Record<DayKey, string> = {
  sat: "Sat", sun: "Sun", mon: "Mon",
  tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri",
}

export const WEEK_ORDER: DayKey[] = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"]

export const WEEK_DAYS = WEEK_ORDER.length // 7

// ── Week helpers ──────────────────────────────────────────────────────────────

/**
 * Returns a Date for the Saturday that starts the Ihlamudheen week,
 * offset by the given number of weeks from the current week.
 */
export function getWeekStart(offset = 0): Date {
  const now = new Date()
  const day = now.getDay() // 0=Sun … 6=Sat
  const daysToLastSat = day === 6 ? 0 : day + 1
  const sat = new Date(now)
  sat.setDate(now.getDate() - daysToLastSat + offset * 7)
  sat.setHours(0, 0, 0, 0)
  return sat
}

/**
 * Formats a Date as "YYYY-MM-DD" using LOCAL date parts (not UTC).
 * This avoids the timezone bug where toISOString() in UTC+4 returns
 * the previous calendar day.
 */
export function getWeekKey(weekStart: Date): string {
  const y = weekStart.getFullYear()
  const m = String(weekStart.getMonth() + 1).padStart(2, "0")
  const d = String(weekStart.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function getWeekLabel(weekStart: Date): string {
  const end = new Date(weekStart)
  end.setDate(end.getDate() + 6) // Sat → Fri (full 7-day week)
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  return `${fmt(weekStart)} – ${fmt(end)}`
}

export function todayDayKey(): DayKey {
  const map: Record<number, DayKey> = { 6: "sat", 0: "sun", 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri" }
  return map[new Date().getDay()] ?? "sat"
}

/**
 * Returns the DayKey for today. If today is past the current week (shouldn't
 * happen), defaults to "sat".
 */
export function todayDayIndex(): number {
  return WEEK_ORDER.indexOf(todayDayKey())
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export function selfReportScore(r: SelfReport): number {
  return [r.fajr, r.dhuhr, r.asr, r.maghrib, r.isha, r.quran, r.reading, r.writing].filter(Boolean).length
}

export const MAX_DAY_SCORE = 8
export const MAX_WEEK_SCORE = WEEK_DAYS * MAX_DAY_SCORE // 56

// ── Class configuration (single source of truth) ──────────────────────────────

export interface TrackerClass {
  id: string
  name: string
  courseId: string
  days: DayKey[]
  students: { id: string; name: string }[]
}

export interface TrackerCourse {
  id: string
  title: string
  shortTitle: string
  dotColor: string
  activeColor: string
}

// No hardcoded roster — students come from the database / app.
// The class scaffold below is a placeholder; adjust to your own classes.
function rosterStudents(_classId: string): { id: string; name: string }[] {
  return []
}

export const TRACKER_COURSES: TrackerCourse[] = [
  {
    id: "madrasa",
    title: "Ihlamudheen Madrasa",
    shortTitle: "Ihlamudheen Madrasa",
    dotColor: "bg-emerald-400",
    activeColor: "bg-emerald-600",
  },
  {
    id: "english",
    title: "Ihlamudheen Madrasa",
    shortTitle: "English Madrasa",
    dotColor: "bg-blue-400",
    activeColor: "bg-blue-600",
  },
  {
    id: "edu-support",
    title: "Ihlamudheen Madrasa",
    shortTitle: "Edu Support",
    dotColor: "bg-purple-400",
    activeColor: "bg-purple-600",
  },
]

export const ALL_CLASSES: TrackerClass[] = [
  // Ihlamudheen Madrasa
  { id: "1a",     courseId: "madrasa",   name: "Grade 1A",  days: ["sat"], students: rosterStudents("1a") },
  { id: "1b",     courseId: "madrasa",   name: "Grade 1B",  days: ["sun"], students: rosterStudents("1b") },
  { id: "1c",     courseId: "madrasa",   name: "Grade 1C",  days: ["sat"], students: rosterStudents("1c") },
  { id: "2a",     courseId: "madrasa",   name: "Grade 2A",  days: ["sat"], students: rosterStudents("2a") },
  { id: "2b",     courseId: "madrasa",   name: "Grade 2B",  days: ["sun"], students: rosterStudents("2b") },
  { id: "3a",     courseId: "madrasa",   name: "Grade 3A",  days: ["sat"], students: rosterStudents("3a") },
  { id: "3b",     courseId: "madrasa",   name: "Grade 3B",  days: ["sun"], students: rosterStudents("3b") },
  { id: "4a",     courseId: "madrasa",   name: "Grade 4A",  days: ["sun"], students: rosterStudents("4a") },
  { id: "5a",     courseId: "madrasa",   name: "Grade 5A",  days: ["sat"], students: rosterStudents("5a") },
  { id: "6a",     courseId: "madrasa",   name: "Grade 6A",  days: ["sun"], students: rosterStudents("6a") },
  { id: "7a",     courseId: "madrasa",   name: "Grade 7A",  days: ["sat"], students: rosterStudents("7a") },
  { id: "8a",     courseId: "madrasa",   name: "Grade 8A",  days: ["sun"], students: rosterStudents("8a") },
  { id: "9a",     courseId: "madrasa",   name: "Grade 9A",  days: ["sun"], students: rosterStudents("9a") },
  { id: "10a",    courseId: "madrasa",   name: "Grade 10A", days: ["sun"], students: rosterStudents("10a") },
  // English Madrasa
  { id: "level1", courseId: "english",     name: "Level 1",   days: ["sat"], students: rosterStudents("level1") },
  { id: "level2", courseId: "english",     name: "Level 2",   days: ["sat"], students: rosterStudents("level2") },
  { id: "level3", courseId: "english",     name: "Level 3",   days: ["sat"], students: rosterStudents("level3") },
  { id: "level5", courseId: "english",     name: "Level 5",   days: ["sat"], students: rosterStudents("level5") },
  // Edu Support — Mon to Fri
  { id: "es1", courseId: "edu-support", name: "Grade 1", days: ["mon","tue","wed","thu","fri"], students: rosterStudents("es1") },
  { id: "es2", courseId: "edu-support", name: "Grade 2", days: ["mon","tue","wed","thu","fri"], students: rosterStudents("es2") },
  { id: "es3", courseId: "edu-support", name: "Grade 3", days: ["mon","tue","wed","thu","fri"], students: rosterStudents("es3") },
  { id: "es4", courseId: "edu-support", name: "Grade 4", days: ["mon","tue","wed","thu","fri"], students: rosterStudents("es4") },
  { id: "es5", courseId: "edu-support", name: "Grade 5", days: ["mon","tue","wed","thu","fri"], students: rosterStudents("es5") },
  { id: "es6", courseId: "edu-support", name: "Grade 6", days: ["mon","tue","wed","thu","fri"], students: rosterStudents("es6") },
]

export function getClassesForCourse(courseId: string): TrackerClass[] {
  return ALL_CLASSES.filter(c => c.courseId === courseId)
}
