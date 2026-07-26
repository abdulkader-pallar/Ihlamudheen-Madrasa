// ── Shared Types ──────────────────────────────────────────
export interface Student {
  id: string
  name: string
  photo?: string
  rollNo: string
  // Optional extended profile (populated from the admin form)
  gender?: "Male" | "Female"
  fatherName?: string
  motherName?: string
  fatherPhone?: string
  motherPhone?: string
  email?: string
}

export interface AttendanceRecord {
  date: string
  records: Record<string, "present" | "absent" | "late">
  // Per-student note. Required when status === "absent" — enforced in UI.
  remarks?: Record<string, string>
  // Per-student arrival time "HH:MM" (24h). Recorded for late tracking;
  // an arrival after the program's start time stores status === "late".
  arrivalTimes?: Record<string, string>
}

export interface Subject {
  id: string
  name: string
  maxScore: number
}

export interface GradeEntry {
  examName: string
  subject: string
  date: string
  scores: Record<string, number>
  maxScore: number
  // New multi-subject model
  subjects?: Subject[]
  subjectScores?: Record<string, Record<string, number>> // studentId -> subjectId -> score
}

export interface ClassData {
  id: string
  name: string
  schedule: string
  students: Student[]
  attendance: AttendanceRecord[]
  grades: GradeEntry[]
}

export interface CourseData {
  id: string
  title: string
  logo: string
  logoClass: string
  classes: ClassData[]
}

// ── Class-naming uniformity ───────────────────────────────
// Every class in a course must follow the same naming convention as its
// siblings (e.g. "Grade 1", "Grade 2" … never a bare "6"). This helper
// infers the leading label shared by the existing classes and normalises a
// freshly-entered name to match it.

/** Extract the alphabetic label that precedes the first number in a class
 *  name. "Grade 1A" → "Grade", "Level 3 - Advanced" → "Level", "6" → "". */
export function classNameLabel(name: string): string {
  const m = name.trim().match(/^([A-Za-z][A-Za-z]*(?:\s+[A-Za-z]+)*?)\s*\d/)
  return m ? m[1].trim() : ""
}

/** The naming label shared by a course's existing classes, or "" when the
 *  course has no classes or no consistent label yet. The most frequently
 *  used label wins; its canonical casing is preserved. */
export function dominantClassLabel(existing: Array<{ name: string }>): string {
  const counts = new Map<string, { label: string; count: number }>()
  for (const c of existing) {
    const label = classNameLabel(c.name)
    if (!label) continue
    const key = label.toLowerCase()
    const entry = counts.get(key)
    if (entry) entry.count += 1
    else counts.set(key, { label, count: 1 })
  }
  let best = ""
  let bestCount = 0
  Array.from(counts.values()).forEach(({ label, count }) => {
    if (count > bestCount) { best = label; bestCount = count }
  })
  return best
}

/** Normalise a new class name so it aligns with the course's existing
 *  classes. ("6", [Grade 1, Grade 2]) → "Grade 6". Returns the trimmed name
 *  unchanged when there is no dominant label to align to. */
export function normalizeClassName(rawName: string, existing: Array<{ name: string }>): string {
  const name = rawName.trim().replace(/\s+/g, " ")
  if (!name) return name
  const label = dominantClassLabel(existing)
  if (!label) return name
  // Already follows the convention (case-insensitive) — leave as typed.
  if (name.toLowerCase().startsWith(label.toLowerCase() + " ")) return name
  if (name.toLowerCase() === label.toLowerCase()) return name
  return `${label} ${name}`
}

// ── Course / Class / Student seed data ─────────────────────
// Intentionally EMPTY — real courses, classes, students and staff live in the
// database (or are entered through the app). Do NOT hardcode real people here.
export const initialCourses: CourseData[] = []

// ── Teacher Pay Types ─────────────────────────────────────
// Configure the amounts in the rate constants below to match your institute.
// per-session-madrasa  → per weekend session (1 or 2 sessions/day)
// per-day-english      → flat per-day rate (e.g. a weekly language class)
// per-day-cibis        → flat per-day rate for a certification program
// monthly-edu-support  → fixed monthly + attendance tracking
// monthly-office       → fixed monthly office staff
// monthly-cleaning     → fixed monthly support staff
// daily-driver         → per-day transport staff
export type TeacherPayType =
  | "per-session-madrasa"
  | "per-day-english"
  | "per-day-cibis"
  | "monthly-edu-support"
  | "monthly-office"
  | "monthly-cleaning"
  | "daily-driver"

// ── Teacher Data ──────────────────────────────────────────
export interface TeacherData {
  id: string
  name: string
  phone?: string
  transportAllowance: boolean
  classIds: string[]
  payType: TeacherPayType
  fixedMonthlyRate?: number   // for monthly-* pay types
  dailyRate?: number          // for daily-driver
  // Dual-role teachers — earn from two programs.
  dualPayType?: TeacherPayType
  // Teachers who also teach the weekend madrasa (dual pay).
  teachesMadrasa?: boolean
  // Teachers on the certification program.
  teachesCibis?: boolean
}

// Intentionally EMPTY — enter real staff through the app / database.
export const initialTeachers: TeacherData[] = []

// Device user ID → website teacher ID mapping (ZKTeco fingerprint machine).
// Used by the local attendance agent to translate punch records to teachers.
// Intentionally EMPTY — populate with your own device enrolments.
export const ZK_DEVICE_ID_MAP: Record<number, string> = {}

// ── Session / pay rates (DEFAULTS — adjust to your institute & currency) ──
export const SESSION_RATE_MADRASA        = 60   // per weekend session (1 or 2 sessions/day)
export const SESSION_RATE_MADRASA_ONLINE = 40   // per online session
export const DAY_RATE_ENGLISH            = 150  // flat per-day (weekly language class)
export const DAY_RATE_CIBIS              = 0    // certification program (default: unpaid)
// Fixed-salary / support staff
export const EDU_SUPPORT_MONTHLY       = 1500  // per month (ceiling)
export const EDU_SUPPORT_MONTHLY_HOURS = 112   // target billable hours/month (28 hrs/week × 4 weeks)
export const EDU_SUPPORT_WEEKLY_HOURS  = 28    // hours/week target
export const EDU_SUPPORT_DAILY_MIN     = 5     // minimum hours/day
export const LATE_DEDUCTION = 30       // 50% × session rate — per-session only (per 3 minus marks)

// Keep old alias so any remaining references don't break.
/** @deprecated Use DAY_RATE_ENGLISH. */
export const SESSION_RATE_ENGLISH = DAY_RATE_ENGLISH
export const LATE_THRESHOLD_MINUTES = 10

// Classes that default to online sessions (configure for your institute).
export const ONLINE_DEFAULT_CLASSES: string[] = []

// Weekend class groupings (configure for your institute).
export const SATURDAY_CLASSES: string[] = []
export const SUNDAY_CLASSES: string[] = []

// Session timing (defaults — adjust to your schedule)
export const SESSION_TIMING = {
  morning: { start: "8:55 AM", end: "11:00 AM" },
  break: { start: "11:00 AM", end: "11:15 AM" },
  afternoon: { start: "11:15 AM", end: "1:40 PM" },
}

// ── Late detection — 3-tier per-category system ────────────
// Morning  Cat-1 (8:56–9:00) : Cat-1 occurrence
// Morning  Cat-2 (9:01–9:05) : Cat-2 occurrence
// Morning  Cat-3 (9:06–9:15) : Cat-3 occurrence → deduction immediately
// Morning  after 9:15        : absent
// Afternoon Cat-1 (11:11–11:15): Cat-1 occurrence
// Afternoon Cat-2 (11:16–11:20): Cat-2 occurrence
// Afternoon Cat-3 (11:21–11:30): Cat-3 occurrence → deduction immediately
// Afternoon after 11:30       : absent
// Deductions are per-category (no mixing between categories):
//   Cat-1: every 3 occurrences = 1 deduction
//   Cat-2: every 2 occurrences = 1 deduction
//   Cat-3: every 1 occurrence  = 1 deduction (immediate)
export type LateCategory = 1 | 2 | 3

export function getLateCategory(
  arrivalHHMM: string,
  session: "morning" | "afternoon" = "morning",
): { category: LateCategory | null; isAbsent: boolean } {
  if (!arrivalHHMM) return { category: null, isAbsent: false }
  const [h, m] = arrivalHHMM.split(":").map(Number)
  const mins = h * 60 + m

  if (session === "afternoon") {
    if (mins < 11 * 60 + 11) return { category: null, isAbsent: false } // before 11:11 → present
    if (mins <= 11 * 60 + 15) return { category: 1, isAbsent: false }   // 11:11–11:15 → Cat-1
    if (mins <= 11 * 60 + 20) return { category: 2, isAbsent: false }   // 11:16–11:20 → Cat-2
    if (mins <= 11 * 60 + 30) return { category: 3, isAbsent: false }   // 11:21–11:30 → Cat-3
    return { category: null, isAbsent: true }                            // after 11:30 → absent afternoon
  }

  // morning (default)
  if (mins < 8 * 60 + 56) return { category: null, isAbsent: false }   // before 8:56 → present (on-time ≤08:55)
  if (mins <= 9 * 60 + 0)  return { category: 1, isAbsent: false }     // 8:56–9:00 → 1 mark
  if (mins <= 9 * 60 + 5)  return { category: 2, isAbsent: false }     // 9:01–9:05 → 2 marks
  if (mins <= 9 * 60 + 15) return { category: 3, isAbsent: false }     // 9:06–9:15 → 3 marks
  return { category: null, isAbsent: true }                             // after 9:15 → absent morning
}

// Per-category deduction thresholds — categories are tracked separately (no mixing)
export const CAT_DEDUCTION_THRESHOLDS: Record<LateCategory, number> = { 1: 3, 2: 2, 3: 1 }
// Legacy aliases kept so existing imports compile.
export const LATE_CATEGORY_MARKS: Record<LateCategory, number> = { 1: 1, 2: 2, 3: 3 }
export const MINUS_MARKS_FOR_DEDUCTION = 3

// ── Computed Stats ─────────────────────────────────────────
export function getTotalStudents(courses: CourseData[]): number {
  return courses.reduce(
    (sum, c) => sum + c.classes.reduce((s, cl) => s + cl.students.length, 0),
    0
  )
}

export function getTotalClasses(courses: CourseData[]): number {
  return courses.reduce((sum, c) => sum + c.classes.length, 0)
}

export function getStudentsByClassIds(courses: CourseData[], classIds: string[]): number {
  return courses.reduce(
    (sum, c) =>
      sum +
      c.classes
        .filter((cl) => classIds.includes(cl.id))
        .reduce((s, cl) => s + cl.students.length, 0),
    0
  )
}
