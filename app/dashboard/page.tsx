"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"

// Use device LOCAL date (not UTC) — prevents midnight UTC vs UAE timezone mismatch
function getLocalDateStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}
import { motion } from "framer-motion"
import {
  BookOpen,
  Clock,
  Award,
  TrendingUp,
  Bell,
  CalendarDays,
  GraduationCap,
  MapPin,
  Video,
  Fingerprint,
  XCircle,
  ClipboardCheck,
  UserCheck,
  Download,
  ChevronDown,
  ChevronRight,
  FileText,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
} from "lucide-react"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  buildMonthlyAttendanceRows,
  exportMonthlyAttendance,
  type AttendanceFormat,
} from "@/lib/export-attendance"
import {
  exportStaffPunchesExcel,
  exportStaffPunchesPDF,
  type StaffPunchRow,
} from "@/lib/export-staff-punches"
import type { CourseData, AttendanceRecord } from "@/data/courses"
import { formatTime12h, formatMinutesLate, computeLateness } from "@/lib/late-policy"
import { fetchDisabledTeacherIds } from "@/lib/teacher-status"
import { cn, toTitleCase } from "@/lib/utils"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DashboardSkeleton } from "@/components/loading-skeleton"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole, ROLE_LABELS, ROLE_BADGE_COLORS } from "@/lib/roles"
import {
  initialCourses,
  initialTeachers,
  ZK_DEVICE_ID_MAP,
  getTotalStudents,
  getTotalClasses,
  getStudentsByClassIds,
  SATURDAY_CLASSES,
  SUNDAY_CLASSES,
  ONLINE_DEFAULT_CLASSES,
} from "@/data/courses"
import * as db from "@/lib/db"
import { punchDataAbsenceSessions } from "@/lib/staff-absence"
import { supabase } from "@/lib/supabase"
import Link from "next/link"

// ── Institution attendance widgets ──
// Each institution gets its own card in "School Attendance (Today)".
// `key` MUST match course.title.toUpperCase() exactly (see src/data/courses.ts);
// `label` is the brand-friendly version shown in the UI.
const INSTITUTIONS = [
  { key: "Ihlamudheen Madrasa", label: "Ihlamudheen Madrasa", borderColor: "border-emerald-500/20" },
] as const

type InstitutionCounts = { present: number; absent: number; late: number; notMarked: number; total: number }
const emptyInstitutionCounts = (): Record<string, InstitutionCounts> =>
  Object.fromEntries(INSTITUTIONS.map((i) => [i.key, { present: 0, absent: 0, late: 0, notMarked: 0, total: 0 }]))

// ── Fingerprint punch type ──────────────────────────────────
type PunchProgram = "EDU Support" | "Ihlamudheen Madrasa" | "English" | "CIBIS" | "Non-Teaching Staff"

const NON_TEACHING_PAY_TYPES = new Set(["monthly-office", "monthly-cleaning", "daily-driver"])

interface FingerprintPunchRow {
  teacherId: string
  teacherName: string
  timeIn: string        // arrival HH:MM or "—" when arrival_time is null
  timeOut: string       // departure HH:MM or "—"
  session: "Morning" | "Afternoon" | "English" | "CIBIS" | "Session 1" | "Session 2"
  program: PunchProgram
  role: string          // e.g. "Office", "Cleaning Staff", "Driver", "Teacher"
  status: "Present" | "Late" | "Absent" | "Support Hours"
  lateCategory: string  // "—", "Cat 1", "Cat 2", "Cat 3"
  workedMins: number | null  // null if either punch is missing
  inMissing: boolean    // true when only OUT was recorded (teacher forgot to punch in)
  outMissing: boolean   // true when IN recorded but OUT window closed with no OUT punch (office)
  notPunched: boolean   // true for a synthesized office session row with no punch at all
}

// Office (the office staff) session windows by day-of-week, in minutes from midnight.
// Mirrors the IN/OUT zones in src/app/api/zk-attendance/route.ts.
//   *InEnd  = latest time an IN punch is expected (after this, a missing session = not punched)
//   *OutEnd = end of the OUT window      (after this, a missing OUT = not punched)
function officeSessionWindows(dow: number): { s1InEnd: number; s1OutEnd: number; s2InEnd: number; s2OutEnd: number } {
  const H = (h: number, m = 0) => h * 60 + m
  if (dow === 5)               // Friday: S1 IN+OUT before 13:00, S2 IN 13:01–18:00 / OUT to end of day
    return { s1InEnd: H(13), s1OutEnd: H(13), s2InEnd: H(18), s2OutEnd: H(23, 59) }
  if (dow === 0 || dow === 6)  // Sat/Sun: S1 IN 06:00–10:00 / OUT 10:01–16:00, S2 16:01–end of day
    return { s1InEnd: H(10), s1OutEnd: H(16), s2InEnd: H(18), s2OutEnd: H(23, 59) }
  // Mon–Thu: S1 IN 06:00–11:00 / OUT 11:00–16:00, S2 IN 16:01–18:00 / OUT to end of day
  return { s1InEnd: H(11), s1OutEnd: H(16), s2InEnd: H(18), s2OutEnd: H(23, 59) }
}

function calcWorkedMins(arrival: string | null, departure: string | null): number | null {
  if (!arrival || !departure) return null
  const [ah, am] = arrival.slice(0, 5).split(":").map(Number)
  const [dh, dm] = departure.slice(0, 5).split(":").map(Number)
  const mins = (dh * 60 + dm) - (ah * 60 + am)
  return mins > 0 ? mins : null
}

function lateCatDisplay(row: FingerprintPunchRow): { text: string; color: string } {
  if (row.status === "Absent" && row.workedMins !== null) {
    const h = Math.floor(row.workedMins / 60)
    const m = row.workedMins % 60
    const label = row.workedMins < 300
      ? `${h}h ${m}m — < 5h req.`
      : `${h}h ${m}m`
    return { text: label, color: "text-red-500 dark:text-red-400" }
  }
  if (row.lateCategory !== "—")
    return { text: row.lateCategory, color: "text-amber-600 dark:text-amber-400" }
  return { text: "—", color: "text-navy-400 dark:text-navy-500" }
}

// Resolve the display status for a punch row.
//   • A punch-in can NEVER be "Absent": on-time → Present, after the late
//     threshold → Late. Lateness caps at "Late" (never escalates to Absent).
//     "Absent" applies only when there is no punch-in (arrival_time is null).
//   • EDU-support staff who punch in on a Saturday or Sunday show as
//     "Support Hours" (weekend make-up time) with its own badge colour.
function resolvePunchStatus(
  rawStatus: string,
  hasPunchIn: boolean,
  isEduSupport: boolean,
  isWeekend: boolean,
): FingerprintPunchRow["status"] {
  if (isEduSupport && isWeekend && hasPunchIn) return "Support Hours"
  if (rawStatus === "present") return "Present"
  if (rawStatus === "late") return "Late"
  return hasPunchIn ? "Late" : "Absent"
}

// Config for each program table (order = display order)
const PROGRAM_CONFIG: Record<PunchProgram, { label: string; headerBg: string; badgeColor: string }> = {
  "EDU Support":        { label: "Ihlamudheen Madrasa",     headerBg: "border-violet-500/30 bg-violet-500/10",  badgeColor: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" },
  "Ihlamudheen Madrasa":      { label: "Ihlamudheen Madrasa",             headerBg: "border-emerald-500/30 bg-emerald-500/10", badgeColor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  "English":            { label: "Ihlamudheen Madrasa", headerBg: "border-blue-500/30 bg-blue-500/10",      badgeColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  "CIBIS":              { label: "CIBIS",                     headerBg: "border-amber-500/30 bg-amber-500/10",    badgeColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  "Non-Teaching Staff": { label: "NON-TEACHING STAFF",        headerBg: "border-slate-400/30 bg-slate-500/10",    badgeColor: "bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300" },
}
const PROGRAM_ORDER: PunchProgram[] = ["EDU Support", "Ihlamudheen Madrasa", "English", "CIBIS", "Non-Teaching Staff"]

// ── My Attendance widget: deterministic teacher_id resolution ─────────────────
// name → teacher_id (used when full_name is set correctly in metadata)
// Intentionally EMPTY — populate with your own staff mappings if needed.
const MY_ATT_NAME_MAP: Record<string, string> = {}

// email → teacher_id (stable fallback for OAuth sessions where metadata may lag)
// Intentionally EMPTY — populate with your own staff mappings if needed.
const MY_ATT_EMAIL_MAP: Record<string, string> = {}

function resolveMyTeacherId(user: { email?: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> } | null): string | null {
  if (!user) return null
  // 1. Email lookup — the most stable identity and the authoritative mapping for
  // known staff. Checked FIRST so it overrides a stale teacher_id baked into an
  // old session token (useAuth reads the cached JWT via getSession and does not
  // refresh it, so a corrected mapping must win over the cached metadata).
  const email = (user.email ?? "").toLowerCase().trim()
  if (email && MY_ATT_EMAIL_MAP[email]) return MY_ATT_EMAIL_MAP[email]
  // 2. Direct teacher_id in metadata (written by verify-user) — for staff not in
  // the email map above (e.g. provisioned with a different address).
  const direct = (user.app_metadata?.teacher_id ?? user.user_metadata?.teacher_id) as string | null | undefined
  if (direct) return direct
  // Pure admins have no teacher_id — skip name fallback to avoid cross-wiring
  const role = (user.user_metadata?.role ?? user.app_metadata?.role) as string | undefined
  if (role === "admin") return null
  // 3. Full name lookup — exact map first.
  const fullName = (user.user_metadata?.full_name ?? user.user_metadata?.name) as string | undefined
  if (fullName && MY_ATT_NAME_MAP[fullName]) return MY_ATT_NAME_MAP[fullName]
  // 4. Fuzzy match against the teacher roster so staff who aren't in the
  // hardcoded maps (e.g. newly-added users) still
  // link to their punch data. Mirrors resolveTeacherId in /dashboard/
  // my-attendance so the dashboard widget and that page always agree.
  if (fullName) {
    const lower = fullName.toLowerCase().trim()
    const match = initialTeachers.find(
      (t) => t.name.toLowerCase().includes(lower) || lower.includes(t.name.toLowerCase().split(" ")[0])
    )
    if (match) return match.id
  }
  return null
}

interface MyAttRec {
  id: number; date: string; session: string; status: string
  late_category: number | null; early_departure_category: number | null
  sessions_credited: number | null; arrival_time: string | null
  departure_time: string | null; out_missing: boolean | null
}

const MY_ATT_SESSION_LABEL: Record<string, string> = {
  morning: "Morning", afternoon: "Afternoon", full: "Full Day",
  evening: "Evening", "edu-makeup": "Makeup", cibis: "CIBIS",
}

// Build stable teacher-id → name / payType maps from the shared initialTeachers array
const TEACHER_NAME_MAP: Record<string, string> = Object.fromEntries(
  initialTeachers.map((t) => [t.id, t.name])
)
const TEACHER_PAYTYPE_MAP: Record<string, string> = Object.fromEntries(
  initialTeachers.map((t) => [t.id, t.payType])
)
// Reverse ZK_DEVICE_ID_MAP: system teacher ID → ZK device ID (for display in attendance)
const TEACHER_ID_TO_ZK: Record<string, number> = {}
for (const [zk, tid] of Object.entries(ZK_DEVICE_ID_MAP)) {
  if (!(tid in TEACHER_ID_TO_ZK)) TEACHER_ID_TO_ZK[tid] = Number(zk)
}

// ---------- Ihlamudheen Data (auto-computed from shared student data) ----------

const totalStudents = getTotalStudents(initialCourses)
const totalClasses = getTotalClasses(initialCourses)
const totalPrograms = initialCourses.length

const stats = [
  {
    label: "Total Students",
    value: String(totalStudents),
    change: "Across all programs",
    icon: BookOpen,
    color: "bg-navy-600 text-white",
    href: "/dashboard/teachers",
  },
  {
    label: "Active Classes",
    value: String(totalClasses),
    change: "Grades 1A–10A",
    icon: Clock,
    color: "bg-gold-500 text-white",
    href: "/dashboard/attendance",
  },
  {
    label: "Programs",
    value: String(totalPrograms),
    change: "All active",
    icon: Award,
    color: "bg-emerald-600 text-white",
    href: "/dashboard/courses",
  },
  {
    label: "Teachers",
    value: String(initialTeachers.filter(t => !t.name.includes("Cleaning Staff")).length),
    change: "Across all programs",
    icon: TrendingUp,
    color: "bg-violet-600 text-white",
    href: "/dashboard/teachers",
  },
]

// attendanceData is computed dynamically inside the component from real saved data

const courseColors = ["bg-emerald-600", "bg-blue-600", "bg-violet-600", "bg-gold-500"]
const recentCourses = initialCourses.map((c, i) => ({
  id: i + 1,
  title: c.title,
  instructor: c.classes.length > 0
    ? `${c.classes.reduce((s, cl) => s + cl.students.length, 0)} Students · ${c.classes.length} Classes`
    : "Ihlamudheen Madrasa",
  progress: 100,
  color: courseColors[i] || "bg-navy-600",
}))

// Saturday classes: 1A, 2A, 3A, 5A, 7A
const saturdayStudents = getStudentsByClassIds(initialCourses, ["1a","2a","3a","5a","7a"])
// Sunday classes: 1B, 2B, 3B, 4A, 6A, 8A, 10A
const seniorGrades = getStudentsByClassIds(initialCourses, ["10a"])
// Keep old names for schedule display
const lowerGrades = saturdayStudents
const upperGrades = getStudentsByClassIds(initialCourses, ["1b","2b","3b","4a","6a","8a"])

const todaySchedule = [
  {
    id: 1,
    time: "8:55 AM",
    course: `Saturday: Ihlamudheen Madrasa (1A, 2A, 3A, 5A, 7A) — ${lowerGrades} students`,
    type: "Face to Face",
    location: "Ihlamudheen Madrasa TRAINING INSTITUTE",
    borderColor: "border-l-emerald-600",
  },
  {
    id: 2,
    time: "8:55 AM",
    course: `Sunday: Ihlamudheen Madrasa (1B, 2B, 3B, 4A, 6A, 8A) — ${upperGrades} students`,
    type: "Face to Face",
    location: "Ihlamudheen Madrasa TRAINING INSTITUTE",
    borderColor: "border-l-blue-500",
  },
  {
    id: 3,
    time: "8:55 AM",
    course: `Sunday: Ihlamudheen Madrasa (Grade 10A — Online) — ${seniorGrades} students`,
    type: "Online",
    location: "Live Session",
    borderColor: "border-l-navy-500",
  },
  {
    id: 4,
    time: "7:00 PM",
    course: "CIBIS Certification",
    type: "Face to Face",
    location: "Ihlamudheen Madrasa TRAINING INSTITUTE",
    borderColor: "border-l-violet-600",
  },
  {
    id: 5,
    time: "8:55 AM",
    course: "Ihlamudheen Madrasa",
    type: "Face to Face",
    location: "Ihlamudheen Madrasa TRAINING INSTITUTE",
    borderColor: "border-l-gold-500",
  },
]

const announcements: { id: number; title: string; message: string; timestamp: string }[] = []

// ---------- Helpers ----------

function formatDate() {
  return new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: "easeOut" as const },
  }),
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    "Face to Face": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    Online: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        colors[type] ?? "bg-muted text-muted-foreground"
      )}
    >
      {type === "Online" ? <Video className="mr-1 size-3" /> : <MapPin className="mr-1 size-3" />}
      {type}
    </span>
  )
}

// ---------- Component ----------

// No longer needed — attendance counts are computed from Supabase only

export default function DashboardPage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const isAdmin = role === "admin" || role === "accountant"
  const [isLoading, setIsLoading] = useState(true)
  const [attendanceCounts, setAttendanceCounts] = useState({ present: 0, absent: 0, notMarked: totalStudents, total: totalStudents })
  const [liveStudentCount, setLiveStudentCount] = useState(0)
  // Per-institution counts (Ihlamudheen Madrasa + Ihlamudheen Madrasa + Ihlamudheen Madrasa)
  const [institutionCounts, setInstitutionCounts] = useState<Record<string, InstitutionCounts>>(emptyInstitutionCounts)
  // Per-class attendance status for today's working day widget
  const [classAttendanceStatus, setClassAttendanceStatus] = useState<Array<{
    classId: string; className: string; courseTitle: string;
    totalStudents: number; markedCount: number; presentCount: number; absentCount: number;
    markedByName?: string;
  }>>([])

  // Raw data kept around so the widget header's "Download report" dropdown
  // can build CSV/Excel/PDF without re-fetching
  const [coursesRaw, setCoursesRaw] = useState<CourseData[]>([])
  const [attendanceByClassRaw, setAttendanceByClassRaw] = useState<Record<string, AttendanceRecord[]>>({})
  // markerByClassRaw was used for daily report export (removed).
  // markerByClass is still fetched+used locally inside refreshAttendance.
  // Which institution's absent panel is expanded (null = all collapsed)
  const [expandedAbsentInst, setExpandedAbsentInst] = useState<string | null>(null)
  const [expandedLateInst, setExpandedLateInst] = useState<string | null>(null)

  // Fingerprint punches state
  const [fingerprintPunches, setFingerprintPunches] = useState<FingerprintPunchRow[]>([])
  const [fingerprintLoading, setFingerprintLoading] = useState(true)   // true only on first load
  const fingerprintHasData = useRef(false)                              // silent refresh once data exists
  // Staff punch report download state
  const [staffReportMonth, setStaffReportMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [staffReportGroupBy, setStaffReportGroupBy] = useState<"date" | "name">("date")
  const [staffDownloadLoading, setStaffDownloadLoading] = useState(false)

  // My Attendance widget (teacher-only)
  const myTeacherId = resolveMyTeacherId(user)
  const myTeacher   = myTeacherId ? initialTeachers.find((t) => t.id === myTeacherId) : null
  const [myAttRecs, setMyAttRecs]     = useState<MyAttRec[]>([])
  const [myAttCarryIn, setMyAttCarryIn] = useState(0)
  const [myAttLoading, setMyAttLoading] = useState(false)

  // Attendance report month picker — defaults to current month.
  // When a different month is selected we fetch that month's data on-demand.
  const currentMonth = useMemo(() => getLocalDateStr().slice(0, 7), [])
  const [reportMonth, setReportMonth] = useState(currentMonth)
  const [cachedReportMonth, setCachedReportMonth] = useState<string | null>(null)
  const [reportMonthData, setReportMonthData] = useState<Record<string, AttendanceRecord[]> | null>(null)
  const [reportMonthLoading, setReportMonthLoading] = useState(false)

  // Widget filter — institutions + Ihlamudheen Madrasa day/session sub-filters.
  // Default "all" shows every class. Institution keys mirror INSTITUTIONS;
  // sub-filters (Saturday/Sunday/Online) only apply within Ihlamudheen Madrasa.
  type WidgetFilter =
    | "all"
    | (typeof INSTITUTIONS)[number]["key"]
    | "madrasa_saturday"
    | "madrasa_sunday"
    | "madrasa_online"
  // Default filter is chosen by today's weekday so the user lands on the
  // classes they actually need to mark:
  //   Saturday           → Ihlamudheen Madrasa — Saturday classes
  //   Sunday             → Ihlamudheen Madrasa — Sunday classes
  //   Monday–Thursday    → Ihlamudheen Madrasa (weekday classes)
  //   Friday < 15:00     → Ihlamudheen Madrasa
  //   Friday ≥ 15:00     → Ihlamudheen Madrasa
  function pickDefaultWidgetFilter(): WidgetFilter {
    const now = new Date()
    const dow = now.getDay() // 0=Sun,1=Mon…5=Fri,6=Sat
    if (dow === 6) return "madrasa_saturday"
    if (dow === 0) return "madrasa_sunday"
    if (dow === 5) {
      return now.getHours() < 15 ? "Ihlamudheen Madrasa" : "Ihlamudheen Madrasa"
    }
    // Mon–Thu: only Ihlamudheen Madrasa runs on weekdays
    return "Ihlamudheen Madrasa"
  }
  const [widgetInstFilter, setWidgetInstFilter] = useState<WidgetFilter>(() => pickDefaultWidgetFilter())

  const matchesFilter = useCallback(
    (c: { classId: string; courseTitle: string }, f: WidgetFilter): boolean => {
      const title = c.courseTitle.toUpperCase().trim()
      if (f === "all") return true
      if (f === "madrasa_saturday") return title === "Ihlamudheen Madrasa" && SATURDAY_CLASSES.includes(c.classId)
      if (f === "madrasa_sunday") return title === "Ihlamudheen Madrasa" && SUNDAY_CLASSES.includes(c.classId)
      if (f === "madrasa_online") return title === "Ihlamudheen Madrasa" && ONLINE_DEFAULT_CLASSES.includes(c.classId)
      return title === f
    },
    [],
  )

  const filteredClassAttendance = useMemo(
    // Hide classes with no students — there's nothing to mark for them.
    () => classAttendanceStatus.filter((c) => c.totalStudents > 0 && matchesFilter(c, widgetInstFilter)),
    [classAttendanceStatus, widgetInstFilter, matchesFilter],
  )

  const widgetInstLabel: string = (() => {
    if (widgetInstFilter === "all") return "All Institutions"
    if (widgetInstFilter === "madrasa_saturday") return "Ihlamudheen — Saturday"
    if (widgetInstFilter === "madrasa_sunday") return "Ihlamudheen — Sunday"
    if (widgetInstFilter === "madrasa_online") return "Ihlamudheen — Online"
    return INSTITUTIONS.find((i) => i.key === widgetInstFilter)?.label ?? "Filter"
  })()

  // Monthly download — for the current month we re-use the already-fetched
  // attendanceByClassRaw; for other months we fetch on-demand.
  // Respects the active institution filter just like the daily download.
  const handleDownloadMonthlyReport = useCallback(async (format: AttendanceFormat) => {
    const month = reportMonth
    let data: Record<string, AttendanceRecord[]>

    if (month === currentMonth) {
      // Current month — already in memory
      data = attendanceByClassRaw
    } else if (reportMonthData && cachedReportMonth === month) {
      // Already fetched this month previously
      data = reportMonthData
    } else {
      // Need to fetch from Supabase
      setReportMonthLoading(true)
      try {
        const allClassIds = coursesRaw.flatMap((c) => c.classes.map((cl) => cl.id))
        data = await db.fetchAllClassesAttendanceForMonth(allClassIds, month)
        setReportMonthData(data)
        setCachedReportMonth(month)
      } catch {
        toast.error("Failed to fetch attendance data for the selected month")
        setReportMonthLoading(false)
        return
      }
      setReportMonthLoading(false)
    }

    const allRows = buildMonthlyAttendanceRows(coursesRaw, data, month)
    if (allRows.length === 0) {
      toast.error("No attendance data found for the selected month")
      return
    }
    const visibleClassIds = new Set(filteredClassAttendance.map((c) => c.classId))
    const rows = filteredClassAttendance.length < classAttendanceStatus.length
      ? allRows.filter((r) => visibleClassIds.has(r.classId))
      : allRows
    const res = exportMonthlyAttendance(rows, format, month, widgetInstLabel)
    if (res.ok) toast.success(res.message)
    else toast.error(res.message)
  }, [coursesRaw, attendanceByClassRaw, reportMonth, currentMonth, cachedReportMonth, reportMonthData, filteredClassAttendance, classAttendanceStatus, widgetInstLabel])

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 600)
    return () => clearTimeout(timer)
  }, [])

  // Load real attendance data from Supabase only (no localStorage).
  // Re-runs on mount, on tab visibility change,
  // AND on real-time Supabase subscription events from other devices.
  const [supabaseReady, setSupabaseReady] = useState(false)

  const refreshAttendance = useCallback(async () => {
    const todayStr = getLocalDateStr()
    const month = todayStr.slice(0, 7)

    // The readiness probe and the course fetch are independent, so run them
    // together — waiting for the probe first added a whole round-trip to every
    // page load before anything could render.
    const [ready, dbCourses] = await Promise.all([
      db.checkSupabase(),
      db.fetchCoursesFromDB(),
    ])
    if (!ready) return
    setSupabaseReady(true)

    // ── FIX: One batched query for ALL classes instead of N separate queries ──
    const allClassIds = dbCourses.flatMap((c) => c.classes.map((cl) => cl.id))

    const [dbAttendanceByClass, markerByClass] = await Promise.all([
      db.fetchAllClassesAttendanceForMonth(allClassIds, month),
      db.fetchTodayMarkers(todayStr),
    ])
    // ── End fix ───────────────────────────────────────────────────────────────

    // Snapshot the raw fetched data so the widget header's download dropdown
    // can build CSV / Excel / PDF rows without re-querying the DB.
    setCoursesRaw(dbCourses)
    setAttendanceByClassRaw(dbAttendanceByClass)


    // Compute counts from Supabase data + per-class status.
    // Widget is now active for ALL days — every class is tracked, regardless
    // of weekday. Per-institution totals are computed alongside the overall
    // figure so the dashboard can render a card per institution.
    // Total across ALL courses (including CIBIS which is skipped in the attendance loop below)
    const allCourseStudents = dbCourses.reduce((sum, c) => sum + c.classes.reduce((s, cl) => s + cl.students.length, 0), 0)
    if (allCourseStudents > 0) setLiveStudentCount(allCourseStudents)

    let present = 0, absent = 0, late = 0, notMarked = 0
    const perInst: Record<string, InstitutionCounts> = emptyInstitutionCounts()
    const classStatuses: typeof classAttendanceStatus = []

    for (const course of dbCourses) {
      const instKey = course.title.toUpperCase().trim()
      // Only count courses whose title matches a known institution. Unknown
      // courses (e.g. CIBIS) don't contribute to the school-wide totals so
      // their students don't accidentally inflate another institution.
      const matchedKey = INSTITUTIONS.find((i) => i.key === instKey)?.key
      if (!matchedKey) continue
      const inst = perInst[matchedKey]

      for (const cls of course.classes) {
        const attendance = dbAttendanceByClass[cls.id] || []
        const todayRecord = attendance.find((a) => a.date === todayStr)
        let clsPresent = 0, clsAbsent = 0, clsLate = 0, clsNotMarked = 0

        cls.students.forEach((student) => {
          const status = todayRecord?.records[student.id]
          if (!status) {
            notMarked++; clsNotMarked++
          } else if (status === "present") {
            present++; clsPresent++
          } else if (status === "late") {
            late++; clsLate++
          } else {
            absent++; clsAbsent++
          }
        })

        // Add to institution bucket
        inst.present += clsPresent
        inst.absent += clsAbsent
        inst.late += clsLate
        inst.notMarked += clsNotMarked
        inst.total += cls.students.length

        classStatuses.push({
          classId: cls.id,
          className: cls.name,
          courseTitle: course.title,
          totalStudents: cls.students.length,
          markedCount: clsPresent + clsAbsent + clsLate,
          presentCount: clsPresent,
          absentCount: clsAbsent,
          markedByName: markerByClass[cls.id],
        })
      }
    }

    setAttendanceCounts({ present: present + late, absent, notMarked, total: present + absent + late + notMarked })
    setInstitutionCounts(perInst)
    setClassAttendanceStatus(classStatuses)
  }, [])

  // Fetch today's fingerprint punches: Auto — ZKTeco% (device-synced) +
  // Manual — % (admin-entered, used for English/CIBIS when teachers don't
  // fingerprint-punch). Both surface in the widget so payroll reflects them.
  const refreshFingerprintPunches = useCallback(async () => {
    // Only show the full loading spinner on the very first fetch.
    // Subsequent refreshes update data silently — no blank/blink.
    if (!fingerprintHasData.current) setFingerprintLoading(true)
    try {
    const todayStr = getLocalDateStr()
    const { data, error } = await supabase
      .from("staff_attendance")
      .select("teacher_id, session, status, late_category, early_departure_category, dual_punches, arrival_time, departure_time, date, remarks")
      .eq("date", todayStr)
      .or("remarks.like.Auto — ZKTeco%,remarks.like.Manual — %")
      .order("arrival_time", { ascending: true })
    if (error || !data) return

    type RawRow = {
      teacher_id: string
      session: string
      status: string
      late_category: number | null
      early_departure_category: number | null
      dual_punches: boolean | null
      arrival_time: string | null
      departure_time: string | null
      date: string
      remarks: string | null
    }
    const fmt = (t: string | null) => {
      if (!t) return "—"
      const s = t.length > 5 ? t.slice(0, 5) : t
      const [h, m] = s.split(":").map(Number)
      const ampm = h >= 12 ? "PM" : "AM"
      const h12 = h % 12 || 12
      return `${h12}:${String(m).padStart(2, "0")} ${ampm}`
    }

    // Group by teacher + session — morning and English sessions show as separate rows
    const grouped = new Map<string, FingerprintPunchRow>()
    for (const r of data as RawRow[]) {
      // Key by teacher + session so English/CIBIS evening punches appear as their own row
      const mapKey = `${r.teacher_id}_${r.session}`
      const existing = grouped.get(mapKey)
      if (!existing) {
        const lateCategory =
          r.late_category === 1 ? "Cat 1" : r.late_category === 2 ? "Cat 2" : r.late_category === 3 ? "Cat 3" : "—"
        // Derive program: non-teaching first, then evening, then day-of-week
        const payType = TEACHER_PAYTYPE_MAP[r.teacher_id] ?? ""
        const isNonTeaching = NON_TEACHING_PAY_TYPES.has(payType)

        // Detect session label. New records use session="cibis" directly;
        // legacy records used session="evening" with remarks containing "cibis".
        // Only office staff (the office staff) has two named sessions — cleaning/driver use Morning.
        const isOfficeStaff = payType === "monthly-office"
        const remarksLower = ((r as RawRow & { remarks?: string }).remarks ?? "").toLowerCase()
        const sessionLabel: FingerprintPunchRow["session"] =
          r.session === "cibis"    ? "CIBIS"
          : r.session === "afternoon" ? "Afternoon"
          : r.session === "evening" ? (isOfficeStaff ? "Session 2" : remarksLower.includes("cibis") ? "CIBIS" : "English")
          : (isOfficeStaff ? "Session 1" : "Morning")
        const dow = new Date(r.date + "T12:00:00").getDay() // 0=Sun,6=Sat
        const isWeekend = dow === 0 || dow === 6
        const program: PunchProgram =
          isNonTeaching        ? "Non-Teaching Staff"
          : sessionLabel === "English" ? "English"
          : sessionLabel === "CIBIS"   ? "CIBIS"
          : isWeekend          ? "Ihlamudheen Madrasa"
          : "EDU Support"

        // Human-readable role label for non-teaching staff column
        const role =
          payType === "monthly-office"   ? "Office"
          : payType === "monthly-cleaning" ? "Cleaning"
          : payType === "daily-driver"     ? "Driver"
          : ""

        // inMissing: teacher only punched OUT (arrival_time is null, departure recorded).
        // Not applicable to evening/cibis sessions where null arrival is normal.
        const inMissing =
          !r.arrival_time && !!r.departure_time &&
          r.session !== "evening" && r.session !== "cibis"

        const status = resolvePunchStatus(
          r.status, !!r.arrival_time, payType === "monthly-edu-support", isWeekend,
        )

        grouped.set(mapKey, {
          teacherId: r.teacher_id,
          teacherName: TEACHER_NAME_MAP[r.teacher_id] ?? r.teacher_id,
          timeIn: fmt(r.arrival_time),
          timeOut: fmt(r.departure_time),
          session: sessionLabel,
          program,
          role,
          status,
          lateCategory,
          workedMins: calcWorkedMins(r.arrival_time, r.departure_time),
          inMissing,
          outMissing: false,  // set below for office sessions whose OUT window has closed
          notPunched: false,
        })
      } else {
        // Second punch for same session — update OUT time
        const latestOut = r.departure_time || r.arrival_time
        if (latestOut) existing.timeOut = fmt(latestOut)
      }
    }

    // ── Fixed-salary staff: synthesise "not punched" rows once a working session's
    // IN window has closed today ──
    // Fixed salary = visibility flag only, no pay impact. Cleaning is excluded here
    // (its absence shows only in the attendance grid, never in punch data); and
    // the office staff's Monday/Friday morning session is excluded by
    // punchDataAbsenceSessions (the evening session still applies). For each
    // remaining working session:
    //   • record exists but OUT window closed with no OUT punch → "No OUT" (office)
    //   • no punch at all and IN window closed                   → synthesized "not punched" row
    const dow = new Date(todayStr + "T12:00:00").getDay()
    const uaeNow = new Date(Date.now() + 4 * 60 * 60 * 1000)          // UTC → UAE (+4h)
    const nowMins = uaeNow.getUTCHours() * 60 + uaeNow.getUTCMinutes()
    const win = officeSessionWindows(dow)
    const EDU_MORNING_IN_END = 10 * 60 + 30   // EDU Support morning IN window closes 10:30
    const disabledIds = await fetchDisabledTeacherIds()  // staff who have left — no absence to synthesize
    for (const t of initialTeachers) {
      if (disabledIds.has(t.id)) continue
      for (const s of punchDataAbsenceSessions(t.payType, todayStr)) {
        const isOfficeStaff = t.payType === "monthly-office"
        const inEnd  = isOfficeStaff ? (s.recordSession === "morning" ? win.s1InEnd  : win.s2InEnd)  : EDU_MORNING_IN_END
        const outEnd = isOfficeStaff ? (s.recordSession === "morning" ? win.s1OutEnd : win.s2OutEnd) : null
        const mapKey = `${t.id}_${s.recordSession}`
        const existing = grouped.get(mapKey)
        if (existing) {
          // Punched in but never punched out, and the OUT window has now closed.
          if (outEnd !== null && existing.timeOut === "—" && nowMins >= outEnd) existing.outMissing = true
        } else if (nowMins >= inEnd) {
          // No punch at all for this session and its IN window has closed → not punched.
          const sessionLabel: FingerprintPunchRow["session"] =
            s.program === "EDU Support" ? "Morning" : (s.label as "Session 1" | "Session 2")
          grouped.set(mapKey, {
            teacherId: t.id,
            teacherName: TEACHER_NAME_MAP[t.id] ?? t.id,
            timeIn: "—", timeOut: "—",
            session: sessionLabel, program: s.program, role: s.role,
            status: "Absent", lateCategory: "—", workedMins: null,
            inMissing: true, outMissing: true, notPunched: true,
          })
        }
      }
    }

    // Sort by arrival time (fall back to departure time for missed-IN rows)
    const sortKey = (r: FingerprintPunchRow) => r.timeIn !== "—" ? r.timeIn : r.timeOut !== "—" ? r.timeOut : "~"
    const rows = Array.from(grouped.values()).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    setFingerprintPunches(rows)
    fingerprintHasData.current = true
    } finally {
      setFingerprintLoading(false)
    }
  }, [])

  // Staff punch report: fetch a full month and export as Excel or PDF
  const handleStaffPunchDownload = useCallback(async (format: "excel" | "pdf") => {
    setStaffDownloadLoading(true)

    // iOS Safari loses the user-gesture context on the first `await`, which means
    // window.open() and <a download> blob URLs are silently blocked afterwards.
    // Fix: open the report window synchronously here (before any await) so the
    // popup is created while the gesture is still active, then write content into
    // it once the data is ready.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    const preWin = isIOS ? window.open("about:blank", "_blank") : null
    if (preWin) {
      preWin.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="font-family:sans-serif;padding:2rem;color:#1e3a5f;text-align:center;"><p style="margin-top:4rem;font-size:1.1rem;">Preparing ${format === "pdf" ? "PDF" : "Excel"} report…</p></body></html>`)
      preWin.document.close()
    }

    try {
      // Real last day of the month — never assume 31 (e.g. 2026-06-31 is invalid
      // and Postgres rejects it with "date/time field value out of range").
      const [ry, rm] = staffReportMonth.split("-").map(Number)
      const monthEnd = `${staffReportMonth}-${String(new Date(ry, rm, 0).getDate()).padStart(2, "0")}`
      const { data, error } = await supabase
        .from("staff_attendance")
        .select("teacher_id, date, session, status, late_category, early_departure_category, dual_punches, arrival_time, departure_time, remarks")
        .gte("date", `${staffReportMonth}-01`)
        .lte("date", monthEnd)
        .or("remarks.like.Auto — ZKTeco%,remarks.like.Manual — %")
        .order("date", { ascending: true })
        .order("arrival_time", { ascending: true })

      if (error || !data || data.length === 0) {
        preWin?.close()
        toast.error(error?.message ?? `No punch records found for ${staffReportMonth}`)
        return
      }

      type RawPunch = {
        teacher_id: string; date: string; session: string; status: string
        late_category: number | null; early_departure_category: number | null
        dual_punches: boolean | null
        arrival_time: string | null; departure_time: string | null; remarks: string | null
      }
      const fmt = (t: string | null) => {
        if (!t) return "—"
        const s = t.slice(0, 5)
        const [h, m] = s.split(":").map(Number)
        const ampm = h >= 12 ? "PM" : "AM"
        const h12 = h % 12 || 12
        return `${h12}:${String(m).padStart(2, "0")} ${ampm}`
      }

      const exportRows: StaffPunchRow[] = (data as RawPunch[]).map(r => {
        const payType = TEACHER_PAYTYPE_MAP[r.teacher_id] ?? ""
        const isNonTeaching = NON_TEACHING_PAY_TYPES.has(payType)
        const remarksLower = (r.remarks ?? "").toLowerCase()
        const dow = new Date(r.date + "T12:00:00").getDay()
        const isWeekend = dow === 0 || dow === 6

        const program: string =
          isNonTeaching ? "Non-Teaching Staff"
          : r.session === "cibis" ? "CIBIS"
          : r.session === "evening" ? (remarksLower.includes("cibis") ? "CIBIS" : "English")
          : isWeekend ? "Ihlamudheen Madrasa"
          : "EDU Support"

        const role =
          payType === "monthly-office"    ? "Office"
          : payType === "monthly-cleaning" ? "Cleaning"
          : payType === "daily-driver"     ? "Driver"
          : ""

        const lateCat =
          r.late_category === 1 ? "Cat 1"
          : r.late_category === 2 ? "Cat 2"
          : r.late_category === 3 ? "Cat 3"
          : "—"

        const earlyDep =
          r.early_departure_category === 2 ? "Cat 2 Early"
          : r.early_departure_category === 1 ? "Cat 1 Early"
          : "—"

        return {
          date: r.date,
          program,
          teacherName: TEACHER_NAME_MAP[r.teacher_id] ?? r.teacher_id,
          role,
          timeIn:  fmt(r.arrival_time),
          timeOut: fmt(r.departure_time),
          // A punch-in can never be "Absent": cap the worst case at "Late".
          status: r.status === "present" ? "Present" : r.status === "late" ? "Late" : r.arrival_time ? "Late" : "Absent",
          lateCategory: lateCat,
          earlyDeparture: earlyDep,
          dualPunches: r.dual_punches === true,
        }
      })

      // ── Synthesise "Absent" rows for fixed-salary staff with no punch on a
      // working session ──
      // Display-only (never written to the DB, so no payroll impact). Cleaning is
      // excluded (punchDataAbsenceSessions returns none — its absence shows only in
      // the attendance report); the office staff's Monday/Friday morning session is
      // excluded too. Only days strictly before today are eligible. Identical
      // synthesised rows for the same staff+date+program (e.g. both office sessions
      // missing) collapse into one.
      const todayStr = getLocalDateStr()
      const lastDay = new Date(ry, rm, 0).getDate()
      const haveRecord = new Set(
        (data as RawPunch[]).map(r => `${r.teacher_id}_${r.date}_${r.session}`)
      )
      const seenAbsent = new Set<string>()
      const disabledIds = await fetchDisabledTeacherIds()  // staff who have left — no absence to synthesize
      for (const t of initialTeachers) {
        if (disabledIds.has(t.id)) continue
        for (let d = 1; d <= lastDay; d++) {
          const dateStr = `${staffReportMonth}-${String(d).padStart(2, "0")}`
          if (dateStr >= todayStr) break
          for (const s of punchDataAbsenceSessions(t.payType, dateStr)) {
            if (haveRecord.has(`${t.id}_${dateStr}_${s.recordSession}`)) continue
            const dedupeKey = `${t.id}_${dateStr}_${s.program}`
            if (seenAbsent.has(dedupeKey)) continue
            seenAbsent.add(dedupeKey)
            exportRows.push({
              date: dateStr,
              program: s.program,
              teacherName: TEACHER_NAME_MAP[t.id] ?? t.id,
              role: s.role,
              timeIn: "—", timeOut: "—",
              status: "Absent", lateCategory: "—", earlyDeparture: "—",
            })
          }
        }
      }

      if (format === "excel") exportStaffPunchesExcel(exportRows, staffReportMonth, staffReportGroupBy, preWin)
      else exportStaffPunchesPDF(exportRows, staffReportMonth, staffReportGroupBy, preWin)
      toast.success(`Staff punch report ${preWin ? "ready" : "downloaded"} — ${staffReportMonth}`)
    } finally {
      setStaffDownloadLoading(false)
    }
  }, [staffReportMonth, staffReportGroupBy])

  useEffect(() => {
    refreshAttendance()

    // Re-compute every time the tab/page becomes visible (user navigates back)
    function onVisibility() {
      if (document.visibilityState === "visible") refreshAttendance()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [refreshAttendance])

  // Real-time subscription: auto-refresh when ANY device saves attendance,
  // or when students/classes are added or removed (so widget totals stay live).
  useEffect(() => {
    if (!supabaseReady) return
    const subs = [
      db.subscribeToTable("student_attendance", refreshAttendance),
      db.subscribeToTable("students", refreshAttendance),
      db.subscribeToTable("classes", refreshAttendance),
    ]
    return () => { subs.forEach((s) => s.unsubscribe()) }
  }, [supabaseReady, refreshAttendance])

  // Fingerprint punches: initial fetch + refresh every 60 seconds
  useEffect(() => {
    refreshFingerprintPunches()
    const interval = setInterval(refreshFingerprintPunches, 60_000)
    return () => clearInterval(interval)
  }, [refreshFingerprintPunches])

  // My Attendance: fetch current-month records for this teacher
  useEffect(() => {
    if (!myTeacherId) return
    setMyAttLoading(true)
    const month = getLocalDateStr().slice(0, 7)
    const [y, m] = month.split("-").map(Number)
    const end = `${y}-${String(m).padStart(2, "0")}-${new Date(y, m, 0).getDate()}`
    Promise.all([
      supabase
        .from("staff_attendance")
        .select("id, date, session, status, late_category, early_departure_category, sessions_credited, arrival_time, departure_time, out_missing")
        .eq("teacher_id", myTeacherId)
        .gte("date", `${month}-01`)
        .lte("date", end)
        .order("date", { ascending: false })
        .order("session"),
      supabase
        .from("staff_attendance")
        .select("late_category")
        .eq("teacher_id", myTeacherId)
        .lt("date", `${month}-01`)
        .not("late_category", "is", null),
    ]).then(([{ data }, { data: priorData }]) => {
        setMyAttRecs((data ?? []) as MyAttRec[])
        const priorTotal = (priorData ?? []).reduce((s: number, r: { late_category: number | null }) => {
          const c = r.late_category; return s + (c === 1 ? 1 : c === 2 ? 2 : c === 3 ? 3 : 0)
        }, 0)
        setMyAttCarryIn(priorTotal % 3)
        setMyAttLoading(false)
      })
  }, [myTeacherId])

  if (isLoading) {
    return <DashboardSkeleton />
  }

  const userName = toTitleCase(user?.user_metadata?.full_name?.split(" ")[0] || "Student")
  const userRole = getUserRole(user)

  return (
    <div className="relative space-y-8">
      {/* Breathing background orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden -z-10">
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-gold-500/5 animate-breathe" />
        <div className="absolute top-1/3 -left-16 w-56 h-56 rounded-full bg-emerald-500/5 animate-breathe-slow" />
        <div className="absolute bottom-20 right-1/4 w-48 h-48 rounded-full bg-violet-500/5 animate-breathe breathe-delay-3" />
      </div>

      {/* Welcome Header */}
      <motion.div
        initial="hidden"
        animate="visible"
        custom={0}
        variants={fadeUp}
        className="relative"
      >
        <div className="flex items-center gap-3 mb-1">
          <motion.div
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" as const }}
          >
            <GraduationCap className="size-8 text-gold-500" />
          </motion.div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white sm:text-3xl">
            Welcome back, {userName}!{" "}
            <span className={cn("inline-flex align-middle text-xs rounded-full px-2.5 py-0.5 font-semibold uppercase tracking-wider ml-2", ROLE_BADGE_COLORS[userRole])} style={{ color: "#000000" }}>
              {ROLE_LABELS[userRole]}
            </span>
          </h1>
        </div>
        <p className="mt-1 text-sm text-navy-500 dark:text-navy-300 flex items-center gap-2">
          {formatDate()}
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active
          </span>
        </p>
      </motion.div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {stats.map((s, i) => {
          const stat =
            s.label === "Total Students" && (liveStudentCount > 0 || attendanceCounts.total > 0)
              ? { ...s, value: String(liveStudentCount > 0 ? liveStudentCount : attendanceCounts.total) }
              : s
          const Icon = stat.icon
          return (
            <motion.div
              key={stat.label}
              initial="hidden"
              animate="visible"
              custom={i + 1}
              variants={fadeUp}
            >
              <Link href={stat.href} className="block">
              <Card className="group transition-all stat-3d animate-pulse-glow hover:ring-2 hover:ring-gold-400/50 hover:-translate-y-0.5 cursor-pointer" style={{ animationDelay: `${i * 1}s` }}>
                <CardContent className="flex items-center gap-2 sm:gap-4 p-3 sm:p-6">
                  <motion.div
                    className={cn(
                      "flex size-9 sm:size-12 shrink-0 items-center justify-center rounded-xl icon-3d glow-icon",
                      stat.color
                    )}
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    animate={{ scale: [1, 1.03, 1] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" as const, delay: i * 0.5 }}
                  >
                    <Icon className="size-4 sm:size-6" />
                  </motion.div>
                  <div className="min-w-0">
                    <p className="text-xl sm:text-2xl font-bold text-navy-900 dark:text-white">
                      {stat.value}
                    </p>
                    <p className="truncate text-xs sm:text-sm text-navy-500 dark:text-navy-300">
                      {stat.label}
                    </p>
                    <p className="mt-0.5 text-[10px] sm:text-xs font-medium text-emerald-600 dark:text-emerald-400 truncate">
                      {stat.change}
                    </p>
                  </div>
                </CardContent>
              </Card>
              </Link>
            </motion.div>
          )
        })}
      </div>


      {/* ── My Attendance widget (teachers with a linked profile) ─────────── */}
      {myTeacherId && (
        <motion.div
          initial="hidden"
          animate="visible"
          custom={2}
          variants={fadeUp}
        >
          <Card className="overflow-hidden border-teal-500/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base font-semibold text-navy-900 dark:text-white">
                  <ClipboardList className="size-5 text-teal-500 shrink-0" />
                  My Attendance
                </CardTitle>
                <Link
                  href="/dashboard/my-attendance"
                  className="flex items-center gap-0.5 text-xs font-medium text-teal-500 hover:text-teal-400 transition-colors"
                >
                  View all <ChevronRight className="size-3.5" />
                </Link>
              </div>
              <p className="text-sm text-navy-500 dark:text-navy-400">
                {myTeacher?.name ?? "Staff"} · {(() => {
                  const [y, m] = getLocalDateStr().slice(0, 7).split("-").map(Number)
                  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" })
                })()}
              </p>
            </CardHeader>
            <CardContent className="space-y-4 pb-4">
              {myAttLoading ? (
                <div className="flex items-center justify-center py-6 text-navy-400 dark:text-navy-500">
                  <ClipboardList className="size-5 opacity-30 animate-pulse mr-2" />
                  <span className="text-sm">Loading…</span>
                </div>
              ) : (() => {
                const daysPresent      = new Set(myAttRecs.filter(r => r.status !== "absent").map(r => r.date)).size
                const totalSessions    = myAttRecs.reduce((n, r) => n + (r.status !== "absent" ? (r.sessions_credited ?? 1) : 0), 0)
                const lateCount        = myAttRecs.filter(r => r.late_category != null && r.late_category > 0).length
                const thisMonthMarks   = myAttRecs.reduce((n, r) => n + (r.late_category && r.late_category > 0 ? r.late_category : 0), 0)
                const minusMarks       = myAttCarryIn + thisMonthMarks   // effective total with carry-in
                const recent           = myAttRecs.slice(0, 7)

                return (
                  <>
                    {/* Summary chips */}
                    <div className="grid grid-cols-4 gap-2">
                      {([
                        { label: "Days",     value: daysPresent,   icon: CalendarDays,  color: "text-emerald-500", bg: "bg-emerald-500/10", sub: null as string | null },
                        { label: "Sessions", value: totalSessions, icon: CheckCircle2,  color: "text-teal-500",    bg: "bg-teal-500/10",    sub: null },
                        { label: "Late",     value: lateCount,     icon: Clock,         color: lateCount > 0     ? "text-amber-500" : "text-navy-400", bg: lateCount > 0     ? "bg-amber-500/10" : "bg-navy-400/10", sub: null },
                        { label: "Marks",    value: minusMarks,    icon: AlertTriangle, color: minusMarks > 0    ? "text-red-500"   : "text-navy-400", bg: minusMarks > 0    ? "bg-red-500/10"   : "bg-navy-400/10",
                          sub: myAttCarryIn > 0 ? `+${myAttCarryIn} carried` : null },
                      ]).map(({ label, value, icon: Icon, color, bg, sub }) => (
                        <div key={label} className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border/40 bg-card px-1 py-3">
                          <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", bg)}>
                            <Icon className={cn("size-4", color)} />
                          </div>
                          <p className="text-lg font-bold text-navy-900 dark:text-white leading-none">{value}</p>
                          <div className="text-center">
                            <p className="text-[10px] text-navy-500 dark:text-navy-400 leading-tight">{label}</p>
                            {sub && <p className="text-[9px] font-medium text-amber-500 leading-tight">{sub}</p>}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Compact records list */}
                    {recent.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-1.5 py-5">
                        <CalendarDays className="size-6 text-navy-300 dark:text-navy-600" />
                        <p className="text-xs text-navy-400 dark:text-navy-500">No records yet this month</p>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-border/40 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border/40 bg-navy-50/40 dark:bg-navy-800/30 text-[10px] uppercase tracking-wide text-navy-400">
                              <th className="px-3 py-2 text-left">Date</th>
                              <th className="px-3 py-2 text-left">Session</th>
                              <th className="px-3 py-2 text-left">IN</th>
                              <th className="px-3 py-2 text-left">OUT</th>
                              <th className="px-3 py-2 text-left">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/30">
                            {recent.map((rec) => {
                              const [y, mo, d] = rec.date.split("-").map(Number)
                              const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(y, mo - 1, d).getDay()]
                              const fmt = (t: string | null) => {
                                if (!t) return null
                                const [hh, mm] = t.slice(0, 5).split(":").map(Number)
                                const ap = hh >= 12 ? "PM" : "AM"
                                return `${hh % 12 || 12}:${String(mm).padStart(2,"0")} ${ap}`
                              }
                              return (
                                <tr key={rec.id} className="hover:bg-navy-50/30 dark:hover:bg-navy-800/20 transition-colors">
                                  <td className="px-3 py-2">
                                    <span className="font-medium text-navy-900 dark:text-white">
                                      {d} {new Date(y, mo - 1, 1).toLocaleString("en-US", { month: "short" })}
                                    </span>
                                    <span className="ml-1 text-[10px] text-navy-400">{dow}</span>
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-teal-500/10 text-teal-600 dark:text-teal-400">
                                      {MY_ATT_SESSION_LABEL[rec.session] ?? rec.session}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 font-mono">
                                    {rec.arrival_time ? (
                                      <span className={rec.late_category ? "text-amber-500" : "text-emerald-600 dark:text-emerald-400"}>
                                        {fmt(rec.arrival_time)}
                                      </span>
                                    ) : rec.departure_time && rec.session !== "evening" && rec.session !== "cibis" ? (
                                      <span className="text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-500/10 rounded px-1.5 py-0.5">No IN</span>
                                    ) : <span className="text-navy-300 dark:text-navy-600">—</span>}
                                  </td>
                                  <td className="px-3 py-2 font-mono">
                                    {rec.departure_time ? (
                                      <span className={rec.early_departure_category ? "text-orange-500" : "text-navy-600 dark:text-navy-300"}>
                                        {fmt(rec.departure_time)}
                                      </span>
                                    ) : rec.out_missing ? (
                                      <span className="text-red-400 text-[10px]">Missing</span>
                                    ) : <span className="text-navy-300 dark:text-navy-600">—</span>}
                                  </td>
                                  <td className="px-3 py-2">
                                    {rec.status === "absent" ? (
                                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400">Absent</span>
                                    ) : rec.late_category ? (
                                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                                        Late C{rec.late_category}
                                      </span>
                                    ) : (
                                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">On time</span>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                        {myAttRecs.length > 7 && (
                          <div className="border-t border-border/40 px-3 py-2 text-center">
                            <Link href="/dashboard/my-attendance" className="text-[11px] font-medium text-teal-500 hover:text-teal-400 transition-colors">
                              +{myAttRecs.length - 7} more records — view all
                            </Link>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )
              })()}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Staff Attendance — Today (admin/accountant only) */}
      {isAdmin && <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        custom={0}
        variants={fadeUp}
      >
        <Card className="overflow-hidden border-violet-500/20">
          <CardHeader className="pb-3">
            {/* Title row */}
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-lg font-semibold text-navy-900 dark:text-white flex items-center gap-2">
                <Fingerprint className="size-5 text-violet-500 shrink-0" />
                Staff Attendance — Today
              </CardTitle>
              {(() => {
                const n = fingerprintPunches.filter((r) => !r.notPunched).length
                return n > 0 ? (
                  <span className="shrink-0 font-semibold text-sm text-violet-600 dark:text-violet-400">
                    {n} punch{n === 1 ? "" : "es"}
                  </span>
                ) : null
              })()}
            </div>
            {/* Subtitle + download controls — stacks on mobile */}
            <div className="mt-1.5 flex flex-col sm:flex-row sm:items-center gap-2">
              <p className="text-sm text-navy-500 dark:text-navy-300 flex-1">
                Live fingerprint attendance — auto-synced from device
              </p>
              <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-white/80 dark:bg-navy-800/80 px-2 py-1 self-start sm:self-auto">
                <input
                  type="month"
                  value={staffReportMonth}
                  onChange={(e) => setStaffReportMonth(e.target.value)}
                  className="text-[11px] bg-transparent text-navy-700 dark:text-navy-300 outline-none w-28"
                />
                <div className="w-px h-3.5 bg-border/60" />
                <select
                  value={staffReportGroupBy}
                  onChange={(e) => setStaffReportGroupBy(e.target.value as "date" | "name")}
                  className="text-[11px] bg-transparent text-navy-700 dark:text-navy-300 outline-none cursor-pointer"
                  title="Group report by"
                >
                  <option value="date">By Date</option>
                  <option value="name">By Name</option>
                </select>
                <div className="w-px h-3.5 bg-border/60" />
                <button
                  onClick={() => handleStaffPunchDownload("excel")}
                  disabled={staffDownloadLoading}
                  title="Download Excel"
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-200 transition-colors disabled:opacity-50"
                >
                  <Download className="size-3" /> XLS
                </button>
                <button
                  onClick={() => handleStaffPunchDownload("pdf")}
                  disabled={staffDownloadLoading}
                  title="Download PDF"
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 bg-rose-100 dark:bg-rose-900/30 dark:text-rose-400 hover:bg-rose-200 transition-colors disabled:opacity-50"
                >
                  <Download className="size-3" /> PDF
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {fingerprintLoading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-navy-400 dark:text-navy-500">
                <Fingerprint className="size-8 opacity-30 animate-pulse" />
                <p className="text-sm">Loading punches…</p>
              </div>
            ) : fingerprintPunches.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-navy-400 dark:text-navy-500">
                <Fingerprint className="size-8 opacity-30" />
                <p className="text-sm">No punches recorded yet today</p>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {PROGRAM_ORDER.map((prog) => {
                  const rows = fingerprintPunches.filter((r) => r.program === prog)
                  if (rows.length === 0) return null
                  const cfg = PROGRAM_CONFIG[prog]
                  const showLate = prog === "Ihlamudheen Madrasa" || prog === "EDU Support" || prog === "English" || prog === "CIBIS" || prog === "Non-Teaching Staff"
                  return (
                    <div key={prog} className={cn(prog === "Non-Teaching Staff" && "pb-2")}>
                      {/* Program header */}
                      <div className={cn("flex items-center justify-between px-4 py-2 border-b", cfg.headerBg)}>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-navy-700 dark:text-navy-200">
                          {cfg.label}
                        </span>
                        {(() => {
                          const n = rows.filter((r) => !r.notPunched).length
                          return (
                            <span className={cn("text-[10px] font-semibold rounded-full px-2 py-0.5", cfg.badgeColor)}>
                              {n} punch{n !== 1 ? "es" : ""}
                            </span>
                          )
                        })()}
                      </div>

                      {/* ── Mobile card list (< sm) ── */}
                      <div className="sm:hidden divide-y divide-border/30">
                        {rows.map((row) => {
                          const isDriver = row.role === "Driver"
                          const hasBothPunches = row.timeIn !== "—" && row.timeOut !== "—"
                          return (
                            <div key={`${row.teacherId}-${row.session}`}
                              className={cn("px-4 py-3", isDriver && hasBothPunches && "bg-amber-50/60 dark:bg-amber-900/10")}>
                              {/* Row 1: name + status */}
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="text-xs text-navy-400 font-medium shrink-0">{TEACHER_ID_TO_ZK[row.teacherId] ?? '—'}</span>
                                  <span className="text-sm font-medium text-navy-900 dark:text-white truncate">{row.teacherName}</span>
                                  {prog === "Non-Teaching Staff" && (
                                    <span className="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">{row.role}</span>
                                  )}
                                  {(row.session === "Session 1" || row.session === "Session 2") && (
                                    <span className={cn("shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold",
                                      row.session === "Session 1"
                                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                        : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                                    )}>{row.session}</span>
                                  )}
                                  {isDriver && hasBothPunches && (
                                    <span className="shrink-0 text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 rounded px-1">2×</span>
                                  )}
                                </div>
                                {row.notPunched ? (
                                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                    <span className="size-1.5 rounded-full bg-red-500" />
                                    Not punched
                                  </span>
                                ) : (
                                  <span className={cn("shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                    row.status === "Present" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                    : row.status === "Late"  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                    : row.status === "Support Hours" ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
                                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                  )}>
                                    <span className={cn("size-1.5 rounded-full", row.status === "Present" ? "bg-emerald-500" : row.status === "Late" ? "bg-amber-500" : row.status === "Support Hours" ? "bg-sky-500" : "bg-red-500")} />
                                    {row.status}
                                  </span>
                                )}
                              </div>
                              {/* Row 2: times + late cat */}
                              <div className="mt-1 flex items-center gap-3 text-xs">
                                {row.inMissing ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-500/10 rounded px-1.5 py-0.5">
                                    No IN
                                  </span>
                                ) : (
                                  <span className={cn("inline-flex items-center gap-1 font-mono",
                                    isDriver ? "text-navy-700 dark:text-navy-200" : "text-emerald-600 dark:text-emerald-400"
                                  )}>
                                    <Clock className="size-3 shrink-0" />{row.timeIn}
                                  </span>
                                )}
                                <span className="text-navy-400">→</span>
                                {row.outMissing ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-500/10 rounded px-1.5 py-0.5">
                                    No OUT
                                  </span>
                                ) : (
                                  <span className={cn("inline-flex items-center gap-1 font-mono",
                                    row.timeOut === "—" ? "text-navy-400 dark:text-navy-500"
                                    : isDriver ? "text-amber-600 dark:text-amber-400 font-semibold"
                                    : "text-rose-500 dark:text-rose-400"
                                  )}>
                                    <Clock className="size-3 shrink-0" />{row.timeOut}
                                  </span>
                                )}
                                {showLate && (() => { const lcd = lateCatDisplay(row); return lcd.text !== "—" ? (
                                  <span className={cn("ml-auto font-semibold text-[11px]", lcd.color)}>{lcd.text}</span>
                                ) : null })()}
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {/* ── Desktop table (≥ sm) ── */}
                      <div className="hidden sm:block overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-navy-50/30 dark:bg-navy-800/20">
                              <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-navy-400 dark:text-navy-500 w-8">ID</th>
                              <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-navy-400 dark:text-navy-500">
                                {prog === "Non-Teaching Staff" ? "Name" : "Teacher Name"}
                              </th>
                              {prog === "Non-Teaching Staff" && (
                                <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-navy-400 dark:text-navy-500">Role</th>
                              )}
                              <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-navy-400 dark:text-navy-500">IN</th>
                              <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-navy-400 dark:text-navy-500">OUT</th>
                              <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-navy-400 dark:text-navy-500">Status</th>
                              {showLate && (
                                <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-navy-400 dark:text-navy-500">Late Cat.</th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/30">
                            {rows.map((row) => {
                              const isDriver = row.role === "Driver"
                              const hasBothPunches = row.timeIn !== "—" && row.timeOut !== "—"
                              return (
                                <tr key={`${row.teacherId}-${row.session}`}
                                  className={cn("hover:bg-navy-50/40 dark:hover:bg-navy-800/20 transition-colors",
                                    isDriver && hasBothPunches && "bg-amber-50/60 dark:bg-amber-900/10"
                                  )}>
                                  <td className="px-4 py-2.5 text-xs text-navy-400 font-medium">{TEACHER_ID_TO_ZK[row.teacherId] ?? '—'}</td>
                                  <td className="px-4 py-2.5">
                                    <span className="text-sm font-medium text-navy-900 dark:text-white">{row.teacherName}</span>
                                    {isDriver && hasBothPunches && (
                                      <span className="ml-1.5 text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 rounded px-1">2× punch</span>
                                    )}
                                  </td>
                                  {prog === "Non-Teaching Staff" && (
                                    <td className="px-4 py-2.5">
                                      <div className="flex items-center gap-1.5">
                                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">{row.role}</span>
                                        {(row.session === "Session 1" || row.session === "Session 2") && (
                                          <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold",
                                            row.session === "Session 1"
                                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                              : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                                          )}>{row.session}</span>
                                        )}
                                      </div>
                                    </td>
                                  )}
                                  <td className="px-4 py-2.5">
                                    {row.inMissing ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-500/10 rounded px-1.5 py-0.5">
                                        No IN
                                      </span>
                                    ) : (
                                      <span className={cn("inline-flex items-center gap-1 text-sm font-mono",
                                        isDriver ? "text-navy-700 dark:text-navy-200" : "text-emerald-600 dark:text-emerald-400"
                                      )}>
                                        <Clock className="size-3 shrink-0" />{row.timeIn}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    {row.outMissing ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-500/10 rounded px-1.5 py-0.5">
                                        No OUT
                                      </span>
                                    ) : (
                                      <span className={cn("inline-flex items-center gap-1 text-sm font-mono",
                                        row.timeOut === "—" ? "text-navy-400 dark:text-navy-500"
                                        : isDriver ? "text-amber-600 dark:text-amber-400 font-semibold"
                                        : "text-rose-500 dark:text-rose-400"
                                      )}>
                                        <Clock className="size-3 shrink-0" />{row.timeOut}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    {row.notPunched ? (
                                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                        <span className="size-1.5 rounded-full bg-red-500" />
                                        Not punched
                                      </span>
                                    ) : (
                                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                        row.status === "Present" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                        : row.status === "Late"  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                        : row.status === "Support Hours" ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
                                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                      )}>
                                        <span className={cn("size-1.5 rounded-full",
                                          row.status === "Present" ? "bg-emerald-500" : row.status === "Late" ? "bg-amber-500" : row.status === "Support Hours" ? "bg-sky-500" : "bg-red-500"
                                        )} />
                                        {row.status}
                                      </span>
                                    )}
                                  </td>
                                  {showLate && (
                                    <td className="px-4 py-2.5">
                                      {(() => { const lcd = lateCatDisplay(row); return (
                                        <span className={cn("text-xs font-medium", lcd.color)}>{lcd.text}</span>
                                      )})()}
                                    </td>
                                  )}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>}

      {/* School Attendance (Today) — compact grid: one card per institution.
          Admins/accountants see all institutions; teachers only see the
          institutions they are assigned to based on their payType. */}
      {(() => {
        // Build the list of institutions visible to the current user.
        const isPrivileged = role === "admin" || role === "accountant"
        const payType = myTeacher?.payType
        const dualPayType = myTeacher?.dualPayType
        let visible = [...INSTITUTIONS]
        if (!isPrivileged && myTeacherId) {
          visible = INSTITUTIONS.filter((inst) => {
            if (inst.key === "Ihlamudheen Madrasa")
              return payType === "per-session-madrasa" || dualPayType === "per-session-madrasa"
            if (inst.key === "Ihlamudheen Madrasa")
              return payType === "per-day-english" || dualPayType === "per-day-english"
            if (inst.key === "Ihlamudheen Madrasa")
              return payType === "monthly-edu-support" || dualPayType === "monthly-edu-support"
            return false
          })
          // Fallback: if nothing matched show all (e.g. new payType not handled above)
          if (visible.length === 0) visible = [...INSTITUTIONS]
        }
        return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((inst, instIdx) => {
          const counts = institutionCounts[inst.key] ?? { present: 0, absent: 0, late: 0, notMarked: 0, total: 0 }
          const isAbsentOpen = expandedAbsentInst === inst.key
          const isLateOpen = expandedLateInst === inst.key

          // Compute absent students with reasons for this institution from raw data
          const absentStudents: { name: string; className: string; reason: string }[] = []
          if (isAbsentOpen) {
            const todayStr = getLocalDateStr()
            for (const course of coursesRaw) {
              if (course.title.toUpperCase().trim() !== inst.key) continue
              for (const cls of course.classes) {
                const rec = (attendanceByClassRaw[cls.id] || []).find((a) => a.date === todayStr)
                if (!rec) continue
                for (const st of cls.students) {
                  if (rec.records[st.id] === "absent") {
                    absentStudents.push({
                      name: st.name,
                      className: cls.name,
                      reason: rec.remarks?.[st.id] || "—",
                    })
                  }
                }
              }
            }
            absentStudents.sort((a, b) => a.name.localeCompare(b.name))
          }

          // Compute late students with arrival time + minutes late for this institution
          const lateStudents: { name: string; className: string; arrival: string; minutesLate: number }[] = []
          if (isLateOpen) {
            const todayStr = getLocalDateStr()
            for (const course of coursesRaw) {
              if (course.title.toUpperCase().trim() !== inst.key) continue
              for (const cls of course.classes) {
                const rec = (attendanceByClassRaw[cls.id] || []).find((a) => a.date === todayStr)
                if (!rec) continue
                for (const st of cls.students) {
                  if (rec.records[st.id] === "late") {
                    const arrival = rec.arrivalTimes?.[st.id] || ""
                    lateStudents.push({
                      name: st.name,
                      className: cls.name,
                      arrival,
                      minutesLate: computeLateness(course.title, arrival)?.minutesLate ?? 0,
                    })
                  }
                }
              }
            }
            lateStudents.sort((a, b) => b.minutesLate - a.minutesLate || a.name.localeCompare(b.name))
          }

          return (
            <motion.div
              key={inst.key}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.3 }}
              custom={instIdx}
              variants={fadeUp}
            >
              <Card className={cn("overflow-hidden h-full", inst.borderColor)}>
                <CardHeader className="pb-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-navy-400 dark:text-navy-500">Attendance (Today)</p>
                  <CardTitle className="text-sm font-semibold text-navy-900 dark:text-white leading-tight">
                    {inst.label}
                  </CardTitle>
                  <p className="text-xs text-navy-500 dark:text-navy-300">
                    Total students <span className="font-bold text-navy-900 dark:text-white">{counts.total}</span>
                    {counts.total === 0 && (
                      <span className="ml-1 text-[10px] italic text-navy-400 block">No students enrolled yet</span>
                    )}
                  </p>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { label: "Present", count: counts.present, icon: Fingerprint, color: "text-emerald-500", bg: "bg-emerald-500/10", clickable: false },
                      { label: "Absent", count: counts.absent, icon: XCircle, color: "text-red-500", bg: "bg-red-500/10", clickable: true },
                      { label: "Late", count: counts.late, icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10", clickable: false },
                      { label: "Not Marked", count: counts.notMarked, icon: ClipboardCheck, color: "text-navy-400", bg: "bg-navy-400/10", clickable: false },
                    ] as const).map((item) => {
                      const Icon = item.icon
                      const pct = counts.total > 0 ? ((item.count / counts.total) * 100).toFixed(2) : "0.00"
                      const isAbsentTile = item.label === "Absent"
                      const isLateTile = item.label === "Late"
                      const absentClickable = isAbsentTile && counts.absent > 0
                      const lateClickable = isLateTile && counts.late > 0
                      return (
                        <div
                          key={item.label}
                          onClick={
                            absentClickable
                              ? () => { setExpandedAbsentInst(isAbsentOpen ? null : inst.key); setExpandedLateInst(null) }
                              : lateClickable
                                ? () => { setExpandedLateInst(isLateOpen ? null : inst.key); setExpandedAbsentInst(null) }
                                : undefined
                          }
                          className={cn(
                            "rounded-lg border border-border/50 bg-card p-2.5",
                            absentClickable && "cursor-pointer hover:bg-red-50/30 dark:hover:bg-red-500/5 transition-colors",
                            isAbsentTile && isAbsentOpen && "ring-1 ring-red-400/50",
                            lateClickable && "cursor-pointer hover:bg-amber-50/30 dark:hover:bg-amber-500/5 transition-colors",
                            isLateTile && isLateOpen && "ring-1 ring-amber-400/50"
                          )}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className={cn("inline-flex size-7 items-center justify-center rounded-md", item.bg)}>
                              <Icon className={cn("size-4", item.color)} />
                            </div>
                            {absentClickable && (
                              <ChevronDown className={cn("size-3.5 text-red-400 transition-transform", isAbsentOpen && "rotate-180")} />
                            )}
                            {lateClickable && (
                              <ChevronDown className={cn("size-3.5 text-amber-400 transition-transform", isLateOpen && "rotate-180")} />
                            )}
                          </div>
                          <p className="text-lg font-bold text-navy-900 dark:text-white leading-none">{item.count}</p>
                          <p className="text-[10px] text-navy-500 dark:text-navy-400 mt-0.5">({pct}%)</p>
                          <p className="text-[11px] text-navy-500 dark:text-navy-300">{item.label}</p>
                        </div>
                      )
                    })}
                  </div>

                  {/* Expandable absent students list */}
                  {isAbsentOpen && (
                    <div className="mt-3 rounded-lg border border-red-200 dark:border-red-800/40 bg-red-50/50 dark:bg-red-500/5 overflow-hidden">
                      <div className="px-3 py-2 border-b border-red-200/60 dark:border-red-800/30">
                        <p className="text-[11px] font-semibold text-red-700 dark:text-red-400 uppercase tracking-wider">
                          Absent Students — Reasons
                        </p>
                      </div>
                      {absentStudents.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] text-navy-400 italic">Loading…</p>
                      ) : (
                        <div className="divide-y divide-red-100 dark:divide-red-900/30 max-h-48 overflow-y-auto">
                          {absentStudents.map((s, i) => (
                            <div key={i} className="px-3 py-1.5 flex items-start gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-semibold text-navy-900 dark:text-white truncate">{s.name}</p>
                                <p className="text-[10px] text-navy-400">{s.className}</p>
                              </div>
                              <p className="text-[10px] text-red-600 dark:text-red-400 italic text-right max-w-[120px] shrink-0">{s.reason}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Expandable late comers list */}
                  {isLateOpen && (
                    <div className="mt-3 rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-500/5 overflow-hidden">
                      <div className="px-3 py-2 border-b border-amber-200/60 dark:border-amber-800/30">
                        <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                          Late Comers — Arrival Time
                        </p>
                      </div>
                      {lateStudents.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] text-navy-400 italic">Loading…</p>
                      ) : (
                        <div className="divide-y divide-amber-100 dark:divide-amber-900/30 max-h-48 overflow-y-auto">
                          {lateStudents.map((s, i) => (
                            <div key={i} className="px-3 py-1.5 flex items-start gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-semibold text-navy-900 dark:text-white truncate">{s.name}</p>
                                <p className="text-[10px] text-navy-400">{s.className}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">{s.arrival ? formatTime12h(s.arrival) : "—"}</p>
                                {s.minutesLate > 0 && (
                                  <p className="text-[10px] text-amber-500/80">+{formatMinutesLate(s.minutesLate)} late</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </div>
        )
      })()}

      {/* ═══ Today's Class Attendance Status (every day, all classes) ═══ */}
      {classAttendanceStatus.length > 0 && (
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          custom={0}
          variants={fadeUp}
        >
          <Card className="overflow-hidden border-emerald-500/20">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <CardTitle className="text-lg font-semibold text-navy-900 dark:text-white flex items-center gap-2">
                    <ClipboardCheck className="size-5 text-emerald-500" />
                    Today&apos;s Class Attendance Status
                  </CardTitle>
                </div>
                {/* Institution filter — narrows the cards below to one institution */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(
                      "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors h-8 px-3 text-xs shrink-0",
                      "border border-input bg-background hover:bg-accent hover:text-accent-foreground"
                    )}
                    title="Filter classes by institution"
                  >
                    <span className="text-navy-500 dark:text-navy-400">Show:</span>
                    <span className="font-semibold">{widgetInstLabel}</span>
                    <ChevronDown className="size-3 opacity-70" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[280px] p-1">
                    <DropdownMenuItem
                      onClick={() => setWidgetInstFilter("all")}
                      className={cn("cursor-pointer py-2", widgetInstFilter === "all" && "bg-accent")}
                    >
                      <ClipboardCheck className="size-4 mr-2.5 text-navy-500 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">All Institutions</p>
                        <p className="text-[10.5px] text-muted-foreground">{classAttendanceStatus.length} classes total</p>
                      </div>
                    </DropdownMenuItem>

                    {/* — Institutions — */}
                    <div className="px-2 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-wider text-navy-400">By Institution</div>
                    {INSTITUTIONS.map((inst) => {
                      const count = classAttendanceStatus.filter(
                        (c) => c.courseTitle.toUpperCase().trim() === inst.key,
                      ).length
                      return (
                        <DropdownMenuItem
                          key={inst.key}
                          onClick={() => setWidgetInstFilter(inst.key)}
                          className={cn("cursor-pointer py-2", widgetInstFilter === inst.key && "bg-accent")}
                        >
                          <span
                            className={cn(
                              "size-2.5 rounded-full mr-2.5 shrink-0",
                              inst.key === "Ihlamudheen Madrasa" && "bg-emerald-500",
                              inst.key === "Ihlamudheen Madrasa" && "bg-blue-500",
                              inst.key === "Ihlamudheen Madrasa" && "bg-violet-500",
                            )}
                          />
                          <div className="flex-1">
                            <p className="text-sm font-medium">{inst.label}</p>
                            <p className="text-[10.5px] text-muted-foreground">{count} class{count === 1 ? "" : "es"}</p>
                          </div>
                        </DropdownMenuItem>
                      )
                    })}

                    {/* — Ihlamudheen Madrasa sub-filters — */}
                    <div className="px-2 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-wider text-navy-400">Ihlamudheen Madrasa — by day</div>
                    {([
                      { key: "madrasa_saturday", label: "Saturday classes", ids: SATURDAY_CLASSES },
                      { key: "madrasa_sunday",   label: "Sunday classes",   ids: SUNDAY_CLASSES },
                      { key: "madrasa_online",   label: "Online classes",   ids: ONLINE_DEFAULT_CLASSES },
                    ] as const).map((sub) => {
                      const count = classAttendanceStatus.filter(
                        (c) =>
                          c.courseTitle.toUpperCase().trim() === "Ihlamudheen Madrasa" &&
                          sub.ids.includes(c.classId),
                      ).length
                      return (
                        <DropdownMenuItem
                          key={sub.key}
                          onClick={() => setWidgetInstFilter(sub.key)}
                          className={cn("cursor-pointer py-2", widgetInstFilter === sub.key && "bg-accent")}
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

                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="month"
                    value={reportMonth}
                    max={currentMonth}
                    onChange={(e) => {
                      setReportMonth(e.target.value)
                      // Clear cached data when month changes so we re-fetch
                      if (e.target.value !== cachedReportMonth) {
                        setReportMonthData(null)
                        setCachedReportMonth(null)
                      }
                    }}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(
                      "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors h-8 px-3 text-xs shrink-0",
                      "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
                      reportMonthLoading && "opacity-50 pointer-events-none"
                    )}
                    title="Download monthly attendance report"
                  >
                    <Download className="size-3.5" />
                    <span>{reportMonthLoading ? "Loading…" : "Download"}</span>
                    <ChevronDown className="size-3 opacity-70" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[230px] p-1">
                    <div className="px-2 pt-1 pb-1 text-[9.5px] font-bold uppercase tracking-wider text-navy-400">
                      {(() => {
                        const [y, m] = reportMonth.split("-")
                        return new Date(Number(y), Number(m) - 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
                      })()}
                    </div>
                    <DropdownMenuItem onClick={() => handleDownloadMonthlyReport("csv")} className="cursor-pointer py-2">
                      <FileText className="size-4 mr-2.5 text-emerald-500 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">CSV</p>
                        <p className="text-[10.5px] text-muted-foreground">Per-student totals</p>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownloadMonthlyReport("excel")} className="cursor-pointer py-2">
                      <FileText className="size-4 mr-2.5 text-green-600 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Excel (.xls)</p>
                        <p className="text-[10.5px] text-muted-foreground">Opens in Microsoft Excel</p>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownloadMonthlyReport("pdf")} className="cursor-pointer py-2">
                      <FileText className="size-4 mr-2.5 text-red-500 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">PDF</p>
                        <p className="text-[10.5px] text-muted-foreground">Letterhead summary report</p>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                </div>
              </div>
              <p className="text-sm text-navy-500 dark:text-navy-300 mt-1">
                {new Date().toLocaleDateString("en-US", { weekday: "long" })} — {filteredClassAttendance.length} {filteredClassAttendance.length === 1 ? "class" : "classes"}
                {widgetInstFilter !== "all" && (
                  <span className="text-navy-400"> · {widgetInstLabel}</span>
                )}
                {" · "}
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {filteredClassAttendance.filter((c) => c.markedCount > 0).length} marked
                </span>
                {" · "}
                <span className="font-semibold text-red-500">
                  {filteredClassAttendance.filter((c) => c.markedCount === 0).length} not marked
                </span>
              </p>
            </CardHeader>
            <CardContent>
              {filteredClassAttendance.length === 0 ? (
                <div className="py-8 text-center text-sm text-navy-400">
                  No classes for {widgetInstLabel}.
                </div>
              ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredClassAttendance.map((cls) => {
                  const isFullyMarked = cls.markedCount === cls.totalStudents && cls.totalStudents > 0
                  const isPartial = cls.markedCount > 0 && cls.markedCount < cls.totalStudents
                  const todayStr = getLocalDateStr()
                  return (
                    <Link
                      key={cls.classId}
                      href={`/dashboard/attendance?classId=${encodeURIComponent(cls.classId)}&date=${todayStr}`}
                      className={cn(
                        "block rounded-xl border p-3 transition-all stat-3d glow-outline shadow-3d cursor-pointer hover:shadow-lg hover:-translate-y-0.5",
                        isFullyMarked
                          ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-700 dark:bg-emerald-500/5"
                          : isPartial
                            ? "border-amber-200 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-500/5"
                            : "border-red-200 bg-red-50/50 dark:border-red-700 dark:bg-red-500/5"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-sm font-bold text-navy-900 dark:text-white">{cls.className}</h4>
                        {isFullyMarked ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                            <Fingerprint className="size-3" /> Done
                          </span>
                        ) : isPartial ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-100 dark:bg-amber-500/20 dark:text-amber-400 px-2 py-0.5 rounded-full">
                            <Clock className="size-3" /> Partial
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-100 dark:bg-red-500/20 dark:text-red-400 px-2 py-0.5 rounded-full">
                            <XCircle className="size-3" /> Not Marked
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-navy-400 dark:text-navy-500 mb-1">{cls.courseTitle}</p>
                      {cls.markedByName ? (
                        <p className="flex items-center gap-1 text-[10px] text-navy-600 dark:text-navy-300 mb-2">
                          <UserCheck className="size-3 text-emerald-500 shrink-0" />
                          <span className="truncate">Marked by <span className="font-semibold">{cls.markedByName}</span></span>
                        </p>
                      ) : (
                        <p className="text-[10px] text-navy-400 dark:text-navy-500 italic mb-2">No teacher marked yet</p>
                      )}
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-navy-500 dark:text-navy-400">{cls.totalStudents} students</span>
                        {cls.markedCount > 0 && (
                          <>
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">P: {cls.presentCount}</span>
                            <span className="text-red-500 font-medium">A: {cls.absentCount}</span>
                          </>
                        )}
                      </div>
                      {/* Progress bar */}
                      <div className="mt-2 h-1.5 rounded-full bg-navy-100 dark:bg-navy-700 overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            isFullyMarked ? "bg-emerald-500" : isPartial ? "bg-amber-500" : "bg-red-300 dark:bg-red-700"
                          )}
                          style={{ width: `${cls.totalStudents > 0 ? (cls.markedCount / cls.totalStudents) * 100 : 0}%` }}
                        />
                      </div>
                    </Link>
                  )
                })}
              </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Two Column: Courses + Schedule */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* My Courses */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          custom={0}
          variants={fadeUp}
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-navy-900 dark:text-white flex items-center gap-2">
                <BookOpen className="size-5 text-gold-500" />
                My Courses
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-3">
                {recentCourses.map((course, idx) => (
                  <motion.div
                    key={course.id}
                    className="group relative overflow-hidden rounded-xl border border-border/40 bg-gradient-to-br from-white to-navy-50/60 dark:from-navy-800 dark:to-navy-900/80 p-4 cursor-pointer"
                    whileHover={{ y: -3, boxShadow: "0 8px 24px -4px rgba(0,0,0,0.12)" }}
                    animate={{ opacity: [0.88, 1, 0.88] }}
                    transition={{ duration: 4, repeat: Infinity, delay: idx * 0.7 }}
                  >
                    {/* Coloured top strip */}
                    <div className={cn("absolute inset-x-0 top-0 h-1 rounded-t-xl", course.color)} />
                    <motion.div
                      className={cn("flex size-11 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm mt-1 mb-3", course.color)}
                      animate={{ scale: [1, 1.04, 1] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" as const, delay: idx * 0.5 }}
                    >
                      {course.title.split(" ").slice(0, 2).map((w: string) => w[0]).join("")}
                    </motion.div>
                    <p className="text-sm font-semibold text-navy-900 dark:text-white leading-tight line-clamp-2">
                      {course.title}
                    </p>
                    <p className="mt-1.5 text-xs text-navy-500 dark:text-navy-400">
                      {course.instructor}
                    </p>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Upcoming Schedule */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          custom={1}
          variants={fadeUp}
        >
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CalendarDays className="size-5 text-gold-500" />
                <CardTitle className="text-lg font-semibold text-navy-900 dark:text-white">
                  Upcoming Schedule
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="relative">
                <div className="space-y-4">
                  {todaySchedule.map((item, idx) => (
                    <motion.div
                      key={item.id}
                      className="flex items-start gap-3"
                      whileHover={{ x: 4 }}
                      animate={{ opacity: [0.88, 1, 0.88] }}
                      transition={{ duration: 4, repeat: Infinity, delay: idx * 0.7 }}
                    >
                      {/* Time + dot */}
                      <div className="flex w-[3.25rem] flex-shrink-0 flex-col items-center pt-0.5">
                        <span className="text-[10px] font-bold tabular-nums text-navy-400 dark:text-navy-400">{item.time}</span>
                        <div className={cn("mt-1.5 size-3 rounded-full ring-2 ring-white dark:ring-navy-900 z-10", item.borderColor.replace("border-l-", "bg-"))} />
                      </div>
                      {/* Content card */}
                      <div className="flex-1 min-w-0 rounded-xl bg-navy-50/70 dark:bg-navy-800/50 p-3 border border-border/30">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-navy-900 dark:text-white leading-snug line-clamp-2">{item.course}</p>
                          <TypeBadge type={item.type} />
                        </div>
                        <p className="mt-1 flex items-center gap-1 text-xs text-navy-400">
                          <MapPin className="size-3 flex-shrink-0" />{item.location}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Quick Stats Row */}
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        custom={0}
        variants={fadeUp}
      >
        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: GraduationCap, label: "Graduates", value: "80+", color: "text-emerald-500" },
            { icon: BookOpen, label: "Active Batches", value: String(totalClasses), color: "text-violet-500" },
            { icon: Award, label: "Certifications", value: "25+", color: "text-gold-500" },
          ].map((item, i) => {
            const Icon = item.icon
            return (
              <motion.div
                key={item.label}
                className="flex flex-col items-center rounded-xl border border-border/50 bg-card p-4 text-center"
                animate={{ y: [0, -3, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" as const, delay: i * 0.8 }}
              >
                <Icon className={cn("size-6 mb-2", item.color)} />
                <p className="text-xl font-bold text-navy-900 dark:text-white">{item.value}</p>
                <p className="text-xs text-navy-500 dark:text-navy-400">{item.label}</p>
              </motion.div>
            )
          })}
        </div>
      </motion.div>

      {/* Announcements */}
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        custom={0}
        variants={fadeUp}
      >
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <motion.div
                animate={{ rotate: [0, 10, -10, 0] }}
                transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
              >
                <Bell className="size-5 text-gold-500" />
              </motion.div>
              <CardTitle className="text-lg font-semibold text-navy-900 dark:text-white">
                Announcements
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {announcements.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                <div className="flex size-14 items-center justify-center rounded-full bg-navy-50 dark:bg-navy-800">
                  <Bell className="size-6 text-navy-300 dark:text-navy-500" />
                </div>
                <p className="text-sm font-medium text-navy-500 dark:text-navy-400">No announcements yet</p>
                <p className="text-xs text-navy-400 dark:text-navy-500">You&apos;re all caught up. New announcements will appear here.</p>
              </div>
            ) : (
              announcements.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-border/60 p-4 transition-colors hover:bg-navy-50/50 dark:hover:bg-navy-800/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-navy-900 dark:text-white">{item.title}</h4>
                      <p className="mt-1 line-clamp-2 text-sm text-navy-500 dark:text-navy-300">{item.message}</p>
                    </div>
                    <Bell className="size-4 shrink-0 text-navy-300 dark:text-navy-500" />
                  </div>
                  <p className="mt-2 text-xs text-navy-400">{item.timestamp}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
