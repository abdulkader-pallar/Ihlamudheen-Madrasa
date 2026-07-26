"use client"

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react"
import { motion, AnimatePresence } from "framer-motion"
import Image from "next/image"
import { useRouter } from "next/navigation"
import {
  BookOpen,
  Users,
  Plus,
  Eye,
  ClipboardCheck,
  FileText,
  ChevronRight,
  ChevronLeft,
  Camera,
  UserPlus,
  Save,
  Award,
  Trash2,
  RefreshCw,
  Sparkles,
  Search,
  Clock,
  ChevronDown as ChevronDownIcon,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { CourseLogo } from "@/components/course-logo"
import { initialCourses, initialTeachers, ZK_DEVICE_ID_MAP, normalizeClassName, type CourseData, type GradeEntry, type AttendanceRecord } from "@/data/courses"
import { exportStudents, type ExportFormat, type ExportableStudent } from "@/lib/export-students"
import { computeLateness, getProgramStart, formatTime12h, formatMinutesLate } from "@/lib/late-policy"
import { ArrivalTimeInput } from "@/components/arrival-time-input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, Download, ArrowRightLeft, Pencil } from "lucide-react"
import { uploadStudentPhoto, getStudentPhotoUrl } from "@/lib/storage"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole, canManageStudents, canAddStudents } from "@/lib/roles"
import * as db from "@/lib/db"
import { supabase } from "@/lib/supabase"
import { authFetch } from "@/lib/api-client"
import { useDisabledTeachers } from "@/hooks/use-disabled-teachers"
import { toast } from "sonner"

// ── Staff Directory helpers ─────────────────────────────────
// Reverse ZK_DEVICE_ID_MAP → teacher system ID → first ZK device ID
const TEACHER_TO_ZK: Record<string, number> = {}
for (const [zk, tid] of Object.entries(ZK_DEVICE_ID_MAP)) {
  if (!(tid in TEACHER_TO_ZK)) TEACHER_TO_ZK[tid] = Number(zk)
}


function formatProgram(payType: string): string {
  switch (payType) {
    case "per-session-madrasa":   return "Ihlamudheen Madrasa"
    case "per-day-english":     return "English Madrasa"
    case "per-day-cibis":       return "CIBIS"
    case "monthly-edu-support": return "EDU Support"
    case "monthly-office":      return "Office Staff"
    case "monthly-cleaning":    return "Cleaning Staff"
    case "daily-driver":        return "Driver"
    default:                    return payType
  }
}

// ── Login-email matching ────────────────────────────────────
// Staff login accounts (Supabase auth) carry the person's email, but their
// account name is usually shorter than the HR name in the directory
// (e.g. login "Basheer" → staff "Basheer EK") and sometimes spelled with a
// transliteration variant (a transliteration variant). We match a login account
// to a staff row when the login's name tokens are contained in the staff name,
// tolerating a one-character typo per token.
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")   // drop parentheticals e.g. "(Muthu)"
    .replace(/[^a-z\s]/g, " ")     // drop punctuation / digits
    .split(/\s+/)
    .filter(Boolean)
}

function levDist(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
  return dp[m][n]
}

function tokenEq(a: string, b: string): boolean {
  if (a === b) return true
  // Allow a single-character transliteration difference on longer tokens.
  return a.length >= 4 && b.length >= 4 && Math.abs(a.length - b.length) <= 1 && levDist(a, b) <= 1
}

// True when every login token is matched (1:1) by some staff token.
function tokensContained(login: string[], staff: string[]): boolean {
  const used = new Array(staff.length).fill(false)
  for (const lt of login) {
    let hit = false
    for (let i = 0; i < staff.length; i++) {
      if (!used[i] && tokenEq(lt, staff[i])) { used[i] = true; hit = true; break }
    }
    if (!hit) return false
  }
  return true
}

// Assign each login account's email to the single best-matching staff row.
// "Best" = the staff name with the fewest leftover tokens (most specific). When
// two staff tie for an account (e.g. two staff with the same first name), the account is
// ambiguous and left unassigned so we never show a wrong email.
function assignLoginEmails(
  rows: { id: string; name: string }[],
  accounts: { name: string; email: string }[],
): Map<string, string> {
  const staffTokens = rows.map((r) => ({ id: r.id, tokens: nameTokens(r.name) }))
  const byRow = new Map<string, string>()
  for (const acc of accounts) {
    const email = acc.email?.trim()
    if (!email || !email.includes("@")) continue
    const login = nameTokens(acc.name)
    if (login.length === 0) continue
    let best: string | null = null
    let bestExtra = Infinity
    let tie = false
    for (const s of staffTokens) {
      if (!tokensContained(login, s.tokens)) continue
      const extra = s.tokens.length - login.length
      if (extra < bestExtra) { best = s.id; bestExtra = extra; tie = false }
      else if (extra === bestExtra && best !== null) { tie = true }
    }
    if (best && !tie) byRow.set(best, email)
  }
  return byRow
}

// Normalised key for matching a login-account name to an override entry.
function loginKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim()
}

// Explicit teacher → login-account mappings for cases the fuzzy matcher can't
// resolve on its own: transliteration variants (a login name vs staff
// a full staff name), or a first name shared by two staff (two staff with the same first name).
// Maps a teacher id to the exact login-account *name*; the email is still read
// at runtime from the fetched auth list, so no addresses live in the bundle.
// Ambiguous entries (ambiguous first names
// were confirmed by the institute admin.
// Intentionally EMPTY — add explicit teacher-id → login-account-name mappings
// only for cases the fuzzy matcher can't resolve for your own staff.
const LOGIN_ACCOUNT_BY_TEACHER: Record<string, string> = {}

// A few staff share a login with no stable account name to match on (e.g. an
// admin who also holds a teacher row, with several same-first-name accounts).
// For those we pin the email directly; it is only shown when that account is
// actually present in the admin-gated accounts list, so it stays gated.
// Intentionally EMPTY — pin an email here only for your own staff who share a
// login with no stable account name to match on.
const LOGIN_EMAIL_BY_TEACHER: Record<string, string> = {}

// ── View States ────────────────────────────────────────────
type View =
  | { page: "courses" }
  | { page: "classes"; courseId: string }
  | { page: "viewClass"; courseId: string; classId: string }
  | { page: "attendance"; courseId: string; classId: string }
  | { page: "gradebook"; courseId: string; classId: string }

// ── Persistence helpers ────────────────────────────────────
// Remember which course/class/page the user was on so a refresh or "back"
// returns them to the same place instead of resetting to the course list.
const VIEW_KEY = "madrasa:teachers:view"

function loadSavedView(): View {
  if (typeof window === "undefined") return { page: "courses" }
  const renderable = new Set(["courses", "classes", "viewClass", "attendance"])
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    if (raw) {
      const v = JSON.parse(raw) as View
      if (v && typeof v.page === "string" && renderable.has(v.page)) return v
    }
  } catch { /* ignore */ }
  return { page: "courses" }
}

function saveView(view: View) {
  if (typeof window === "undefined") return
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)) } catch { /* ignore */ }
}

// Unsaved attendance edits (status + arrival/late times) are kept as a local
// draft so they survive a "back" or refresh for up to an hour. Cleared once
// the attendance is saved to the database.
type AttStatusMap = Record<string, Record<string, "present" | "absent" | "late">>
type AttArrivalMap = Record<string, Record<string, string>>
const ATT_DRAFT_PREFIX = "madrasa:att-draft:"
const ATT_DRAFT_TTL_MS = 60 * 60 * 1000 // keep unsaved edits for 1 hour

function attDraftKey(classId: string, month: string) {
  return `${ATT_DRAFT_PREFIX}${classId}:${month}`
}

function saveAttendanceDraft(classId: string, month: string, attendance: AttStatusMap, arrival: AttArrivalMap) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(attDraftKey(classId, month), JSON.stringify({ savedAt: Date.now(), attendance, arrival }))
  } catch { /* ignore */ }
}

function loadAttendanceDraft(classId: string, month: string): { attendance: AttStatusMap; arrival: AttArrivalMap } | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(attDraftKey(classId, month))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { savedAt?: number; attendance?: AttStatusMap; arrival?: AttArrivalMap }
    if (!parsed.savedAt || Date.now() - parsed.savedAt > ATT_DRAFT_TTL_MS) {
      localStorage.removeItem(attDraftKey(classId, month))
      return null
    }
    return { attendance: parsed.attendance || {}, arrival: parsed.arrival || {} }
  } catch {
    return null
  }
}

function clearAttendanceDraft(classId: string, month: string) {
  if (typeof window === "undefined") return
  try { localStorage.removeItem(attDraftKey(classId, month)) } catch { /* ignore */ }
}

export default function MadrasaTeacherPage() {
  const router = useRouter()
  const [courses, setCourses] = useState<CourseData[]>(initialCourses)
  const [useSupabase, setUseSupabase] = useState(false)
  const { user } = useAuth(false)
  const role = user ? getUserRole(user) : "student"
  const isAdmin = role === "admin"
  // Accountants share the add/remove-student capability with admins, but not
  // class management, transfers, or the staff directory.
  const canManageRoster = canManageStudents(role)
  // Teachers can add students to their own roster, but removing a student
  // stays admin/accountant only — see canAddRoster vs canManageRoster below.
  const canAddRoster = canAddStudents(role)

  // Load everything from Supabase (classes, students, attendance, grades)
  useEffect(() => {
    let cancelled = false
    async function loadFromSupabase() {
      const ready = await db.checkSupabase()
      if (cancelled) return
      if (!ready) return
      setUseSupabase(true)

      // Fetch full course structure from DB (seeds initial data if empty)
      const dbCourses = await db.fetchCoursesFromDB()
      if (cancelled) return

      // Collect all class IDs across all courses
      const allClassIds = dbCourses.flatMap(course => course.classes.map(cls => cls.id))

      // Batch fetch attendance + grades in 2 parallel calls (was N×2 sequential calls)
      const [attendanceBatch, gradesBatch] = await Promise.all([
        db.fetchAllAttendanceBatch(allClassIds),
        db.fetchAllGradesBatch(allClassIds),
      ])

      if (!cancelled) {
        setCourses(dbCourses.map((course) => ({
          ...course,
          classes: course.classes.map((cls) => ({
            ...cls,
            attendance: attendanceBatch[cls.id] ?? cls.attendance,
            grades: gradesBatch[cls.id] ?? cls.grades,
          })),
        })))
      }
    }
    loadFromSupabase()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time subscription: auto-refresh when ANY device saves
  const reloadFromSupabase = useCallback(async () => {
    const ready = await db.checkSupabase()
    if (!ready) return
    const dbCourses = await db.fetchCoursesFromDB()
    const attendanceMap: Record<string, AttendanceRecord[]> = {}
    const gradesMap: Record<string, GradeEntry[]> = {}
    for (const course of dbCourses) {
      for (const cls of course.classes) {
        const [attendance, grades] = await Promise.all([
          db.fetchAllAttendance(cls.id),
          db.fetchGrades(cls.id),
        ])
        if (attendance.length > 0) attendanceMap[cls.id] = attendance
        if (grades.length > 0) gradesMap[cls.id] = grades
      }
    }
    setCourses(dbCourses.map((course) => ({
      ...course,
      classes: course.classes.map((cls) => ({
        ...cls,
        attendance: attendanceMap[cls.id] ?? cls.attendance,
        grades: gradesMap[cls.id] ?? cls.grades,
      })),
    })))
  }, [])

  useEffect(() => {
    if (!useSupabase) return
    const subAttendance = db.subscribeToTable("attendance", () => { reloadFromSupabase() })
    const subStudents = db.subscribeToTable("students", () => { reloadFromSupabase() })
    return () => {
      subAttendance.unsubscribe()
      subStudents.unsubscribe()
    }
  }, [useSupabase, reloadFromSupabase])

  // Also refresh when tab becomes visible (user navigates back)
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible" && useSupabase) reloadFromSupabase()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => { document.removeEventListener("visibilitychange", onVisibility) }
  }, [useSupabase, reloadFromSupabase])

  const saveCourses = useCallback((updater: (prev: CourseData[]) => CourseData[]) => {
    setCourses(updater)
  }, [])
  const [view, setView] = useState<View>(loadSavedView)

  // Persist the current location so a refresh / browser-back lands the user
  // back where they were (course → class → page) rather than the course list.
  useEffect(() => { saveView(view) }, [view])
  const [showAddClass, setShowAddClass] = useState(false)
  const [newClassName, setNewClassName] = useState("")
  const [newClassSchedule, setNewClassSchedule] = useState("")
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [newStudentName, setNewStudentName] = useState("")
  const [newStudentRoll, setNewStudentRoll] = useState("")
  const [newStudentGender, setNewStudentGender] = useState<"" | "Male" | "Female">("")
  const [newStudentFather, setNewStudentFather] = useState("")
  const [newStudentMother, setNewStudentMother] = useState("")
  const [newStudentPhone, setNewStudentPhone] = useState("")
  const [newStudentAltPhone, setNewStudentAltPhone] = useState("")
  const [newStudentEmail, setNewStudentEmail] = useState("")
  const [showNameSuggestions, setShowNameSuggestions] = useState(false)

  // Live suggestions as the admin types a name — search across all enrolled students
  const nameSuggestions = useMemo(() => {
    const q = newStudentName.trim().toLowerCase()
    if (q.length < 2) return []
    const results: Array<{ student: (typeof courses)[0]["classes"][0]["students"][0]; courseTitle: string; className: string }> = []
    for (const course of courses) {
      for (const c of course.classes) {
        for (const s of c.students) {
          if (s.name.toLowerCase().includes(q)) {
            results.push({ student: s, courseTitle: course.title, className: c.name })
          }
        }
      }
    }
    return results.slice(0, 6)
  }, [newStudentName, courses])

  // Live reg-number lookup — show existing student details as soon as a known number is typed
  const regLookupMatch = useMemo(() => {
    const key = newStudentRoll.trim()
    if (!key) return null
    for (const course of courses) {
      for (const c of course.classes) {
        const s = c.students.find((st) => (st.rollNo || "").trim() === key)
        if (s) return { student: s, courseTitle: course.title, className: c.name }
      }
    }
    return null
  }, [newStudentRoll, courses])

  // Admin-only delete modes — toggle reveals trash buttons on each class/student card
  const [removeClassMode, setRemoveClassMode] = useState(false)
  const [removeStudentMode, setRemoveStudentMode] = useState(false)
  // Per-class roster view: "valid" = active students (default), "previous" =
  // removed students (kept on record, restorable). Replaces the old standalone
  // Enrollment/Disenroll pages — a removed child is saved as a Previous student.
  const [rosterView, setRosterView] = useState<"valid" | "previous">("valid")
  const [previousStudents, setPreviousStudents] = useState<db.DisenrolledStudent[]>([])
  const reloadPrevious = useCallback(() => {
    db.fetchDisenrolledStudents().then(setPreviousStudents).catch(() => {})
  }, [])
  useEffect(() => { reloadPrevious() }, [reloadPrevious])
  // Default back to the active list whenever a different class is opened.
  const openClassId = view.page === "viewClass" ? view.classId : null
  useEffect(() => { setRosterView("valid") }, [openClassId])
  // Full date (YYYY-MM-DD) — only the selected date's column is editable
  const [selectedAttDate, setSelectedAttDate] = useState(new Date().toISOString().split("T")[0])
  // The date picker edits pendingAttDate only — selectedAttDate (the one
  // actual editable column) only changes when "Apply" is clicked, so
  // browsing the picker never accidentally unlocks the wrong day.
  const [pendingAttDate, setPendingAttDate] = useState(new Date().toISOString().split("T")[0])
  const [monthAttendance, setMonthAttendance] = useState<Record<string, Record<string, "present" | "absent" | "late">>>({}) // date -> studentId -> status
  // Per-date, per-student arrival time "HH:MM" — drives late detection.
  const [monthArrival, setMonthArrival] = useState<Record<string, Record<string, string>>>({})
  // Note: legacy gradebook state removed. Grade Book now lives at /dashboard/assessment.


  // Helpers
  const getCourse = (id: string) => courses.find((c) => c.id === id)
  const getClass = (courseId: string, classId: string) =>
    getCourse(courseId)?.classes.find((c) => c.id === classId)

  // ── Add Class ────────────────────────────────────────────
  const handleAddClass = async (courseId: string) => {
    // Every field on the add-class form is mandatory — a class without its
    // working days is incomplete for attendance and timetabling.
    if (!newClassName.trim()) { toast.error("Class name is required"); return }
    if (!newClassSchedule.trim()) { toast.error("Working days are required"); return }

    const course = getCourse(courseId)
    const classId = `c${Date.now()}`
    // Enforce naming uniformity: align the new name with the course's existing
    // classes (e.g. a bare "6" becomes "Grade 6" next to "Grade 5").
    const name = normalizeClassName(newClassName, course?.classes ?? [])
    const schedule = newClassSchedule.trim()

    if (useSupabase) {
      const { error } = await db.addClass(courseId, classId, name, schedule)
      if (error) { toast.error("Failed to save class"); return }
    }

    saveCourses((prev) =>
      prev.map((course) =>
        course.id === courseId
          ? {
              ...course,
              classes: [
                ...course.classes,
                { id: classId, name, schedule, students: [], attendance: [], grades: [] },
              ],
            }
          : course
      )
    )
    setNewClassName("")
    setNewClassSchedule("")
    setShowAddClass(false)
    toast.success(
      name !== newClassName.trim()
        ? `Class added as "${name}" to match the course's naming convention`
        : "Class added"
    )
  }

  // ── Edit Class (admin only) ─────────────────────────────
  // Lets an admin fix a class whose name breaks the course convention
  // (e.g. "6" → "Grade 6") and set its working days (replacing a legacy
  // "TBD"). The new name is run through the same uniformity rule applied
  // when adding a class.
  const handleEditClass = async (courseId: string, classId: string, currentName: string, currentSchedule: string) => {
    if (!isAdmin || typeof window === "undefined") return
    const nameInput = window.prompt(`Class name for "${currentName}":`, currentName)
    if (nameInput === null) return
    const course = getCourse(courseId)
    const siblings = (course?.classes ?? []).filter((c) => c.id !== classId)
    const name = normalizeClassName(nameInput, siblings)
    if (!name) { toast.error("Class name is required"); return }

    // "TBD" is a non-answer placeholder — start the prompt blank so the admin
    // is nudged to enter real working days.
    const scheduleSeed = currentSchedule === "TBD" ? "" : currentSchedule
    const scheduleInput = window.prompt(`Working days for "${name}" (e.g., Monday – Saturday):`, scheduleSeed)
    if (scheduleInput === null) return
    const schedule = scheduleInput.trim()
    if (!schedule) { toast.error("Working days are required"); return }

    if (name === currentName && schedule === currentSchedule) return

    if (useSupabase) {
      const { error } = await db.renameClass(classId, name, schedule)
      if (error) { toast.error("Failed to update class: " + error.message); return }
    }

    saveCourses((prev) =>
      prev.map((c) =>
        c.id === courseId
          ? { ...c, classes: c.classes.map((cl) => (cl.id === classId ? { ...cl, name, schedule } : cl)) }
          : c
      )
    )
    toast.success(`Updated "${name}"`)
  }

  // ── Add Student ──────────────────────────────────────────
  const handleAddStudent = async (courseId: string, classId: string) => {
    // Adding a student is open to admins, accountants, and teachers — guard
    // the handler itself so it can't run even if the trigger is somehow
    // reached otherwise.
    if (!canAddRoster) { toast.error("You don't have permission to add students"); return }
    const name = newStudentName.trim()
    const rollNo = newStudentRoll.trim()
    const gender = newStudentGender
    const fatherName = newStudentFather.trim()
    const motherName = newStudentMother.trim()
    const phone = newStudentPhone.trim()
    const email = newStudentEmail.trim()

    // Name, register number, sex, and parent contact details are mandatory.
    // Email is recommended (useful for LMS access) but not required.
    if (!name) { toast.error("Student name is required"); return }
    if (!rollNo) { toast.error("Register number is required"); return }
    if (!/^\d+$/.test(rollNo)) { toast.error("Register number must contain digits only"); return }
    if (!gender) { toast.error("Sex is required"); return }
    if (!fatherName) { toast.error("Father's name is required"); return }
    if (!motherName) { toast.error("Mother's name is required"); return }
    if (!phone) { toast.error("Contact number is required"); return }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error("Enter a valid email address"); return }

    // Reject duplicate register numbers anywhere in the institute.
    // Register numbers uniquely identify a child, so the same number must
    // never be enrolled twice — surface the existing child instead of adding.
    const key = rollNo.toLowerCase()
    for (const course of courses) {
      for (const c of course.classes) {
        const existing = c.students.find((s) => (s.rollNo || "").trim().toLowerCase() === key)
        if (existing) {
          toast.error(
            `Register number ${rollNo} already belongs to ${existing.name} (${course.title} · ${c.name}). Duplicate not added.`,
            { duration: 6000 }
          )
          return
        }
      }
    }

    const studentId = `s${Date.now()}`

    if (useSupabase) {
      const { error } = await db.addStudent(classId, studentId, name, rollNo)
      if (error) { toast.error("Failed to save student"); return }
      const altPhone = newStudentAltPhone.trim()
      const { error: profileError } = await db.updateStudentProfile(studentId, {
        gender, fatherName, motherName, fatherPhone: phone, email: email || null, ...(altPhone ? { motherPhone: altPhone } : {}),
      })
      if (profileError) { toast.error("Student saved, but failed to save parent details"); return }
    }

    saveCourses((prev) =>
      prev.map((course) =>
        course.id === courseId
          ? {
              ...course,
              classes: course.classes.map((c) =>
                c.id === classId
                  ? { ...c, students: [...c.students, { id: studentId, name, rollNo, gender, fatherName, motherName, fatherPhone: phone, ...(email ? { email } : {}), ...(newStudentAltPhone.trim() ? { motherPhone: newStudentAltPhone.trim() } : {}) }] }
                  : c
              ),
            }
          : course
      )
    )
    setNewStudentName("")
    setNewStudentRoll("")
    setNewStudentGender("")
    setNewStudentFather("")
    setNewStudentMother("")
    setNewStudentPhone("")
    setNewStudentAltPhone("")
    setNewStudentEmail("")
    setShowNameSuggestions(false)
    setShowAddStudent(false)
    toast.success("Student added")
  }

  // ── Remove Class (admin only) ───────────────────────────
  const handleRemoveClass = async (courseId: string, classId: string, className: string) => {
    if (!isAdmin) return
    const ok = typeof window !== "undefined"
      ? window.confirm(`Delete "${className}"?\n\nThis removes the class along with all its students, attendance records, and grades. This cannot be undone.`)
      : false
    if (!ok) return

    if (useSupabase) {
      const { error } = await db.removeClass(classId)
      if (error) { toast.error("Failed to delete class: " + error.message); return }
    }

    saveCourses((prev) =>
      prev.map((course) =>
        course.id === courseId
          ? { ...course, classes: course.classes.filter((c) => c.id !== classId) }
          : course
      )
    )
    toast.success(`"${className}" deleted`)
  }

  // ── Remove Student (admin / accountant) ─────────────────
  const handleRemoveStudent = async (courseId: string, classId: string, studentId: string, studentName: string) => {
    if (!canManageRoster) return
    const ok = typeof window !== "undefined"
      ? window.confirm(`Remove ${studentName}?\n\nThey will be moved to Previous Students. Their record, attendance and grades are kept and they can be restored later.`)
      : false
    if (!ok) return

    if (useSupabase) {
      // Soft-delete (disenroll) so the child is preserved as a Previous student.
      const { error } = await db.disenrollStudent(studentId)
      if (error) { toast.error("Failed to remove student: " + error.message); return }
    }

    saveCourses((prev) =>
      prev.map((course) =>
        course.id === courseId
          ? {
              ...course,
              classes: course.classes.map((c) =>
                c.id === classId
                  ? { ...c, students: c.students.filter((s) => s.id !== studentId) }
                  : c
              ),
            }
          : course
      )
    )
    reloadPrevious()
    toast.success(`${studentName} moved to Previous Students`)
  }

  // ── Restore a Previous (removed) student back to their class ─────────────
  const handleRestoreStudent = async (s: db.DisenrolledStudent) => {
    if (!canManageRoster) return
    if (typeof window !== "undefined" &&
      !window.confirm(`Restore ${s.name} to ${s.className}?\n\nThey will appear again in the active roster.`)) return

    if (useSupabase) {
      const { error } = await db.reenrollStudent(s.id)
      if (error) { toast.error("Failed to restore student: " + error.message); return }
    }

    setPreviousStudents((prev) => prev.filter((p) => p.id !== s.id))
    // Refresh the active roster so the restored student reappears immediately.
    const fresh = await db.fetchCoursesFromDB()
    setCourses(fresh)
    toast.success(`${s.name} restored`)
  }

  // ── Photo URL cache (signed URLs expire, so cache them per session) ──
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})

  // Resolve a photo field to a displayable URL
  const getPhotoDisplay = useCallback((photo?: string) => {
    if (!photo) return null
    // Already a data URL (legacy base64) or cached signed URL
    if (photo.startsWith("data:")) return photo
    // Check cache for signed URL
    if (photoUrls[photo]) return photoUrls[photo]
    return null
  }, [photoUrls])

  // Load signed URLs for storage paths on mount / when courses change
  useEffect(() => {
    const paths: string[] = []
    courses.forEach((c) =>
      c.classes.forEach((cls) =>
        cls.students.forEach((s) => {
          if (s.photo && !s.photo.startsWith("data:") && !photoUrls[s.photo]) {
            paths.push(s.photo)
          }
        })
      )
    )
    if (paths.length === 0) return
    let cancelled = false
    Promise.all(
      paths.map(async (path) => {
        const url = await getStudentPhotoUrl(path)
        return { path, url }
      })
    ).then((results) => {
      if (cancelled) return
      const newUrls: Record<string, string> = {}
      results.forEach(({ path, url }) => { if (url) newUrls[path] = url })
      if (Object.keys(newUrls).length > 0) {
        setPhotoUrls((prev) => ({ ...prev, ...newUrls }))
      }
    })
    return () => { cancelled = true }
  }, [courses]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Upload Photo ─────────────────────────────────────────
  const handlePhotoUpload = async (courseId: string, classId: string, studentId: string, file: File) => {
    // Try Supabase Storage first
    const { path, error } = await uploadStudentPhoto(studentId, file)

    if (!error && path) {
      // Success — store the storage path (not base64)
      saveCourses((prev) =>
        prev.map((course) =>
          course.id === courseId
            ? {
                ...course,
                classes: course.classes.map((cls) =>
                  cls.id === classId
                    ? {
                        ...cls,
                        students: cls.students.map((s) =>
                          s.id === studentId ? { ...s, photo: path } : s
                        ),
                      }
                    : cls
                ),
              }
            : course
        )
      )
      // Also update DB
      if (useSupabase) await db.updateStudentPhoto(studentId, path)
      // Fetch signed URL for immediate display
      const url = await getStudentPhotoUrl(path)
      if (url) setPhotoUrls((prev) => ({ ...prev, [path]: url }))
      toast.success("Photo uploaded")
      return
    }

    // Fallback: compress to base64 locally (when Supabase not configured)
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = document.createElement("img")
      img.onload = () => {
        const canvas = document.createElement("canvas")
        const size = 200
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext("2d")!
        const min = Math.min(img.width, img.height)
        const sx = (img.width - min) / 2
        const sy = (img.height - min) / 2
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size)
        const dataUrl = canvas.toDataURL("image/jpeg", 0.6)
        saveCourses((prev) =>
          prev.map((course) =>
            course.id === courseId
              ? {
                  ...course,
                  classes: course.classes.map((cls) =>
                    cls.id === classId
                      ? {
                          ...cls,
                          students: cls.students.map((s) =>
                            s.id === studentId ? { ...s, photo: dataUrl } : s
                          ),
                        }
                      : cls
                  ),
                }
              : course
          )
        )
        toast.success("Photo saved locally")
      }
      img.src = e.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  // ── Build seeded attendance from DB records ──────────────
  function buildSeededAttendance(
    attendance: CourseData["classes"][number]["attendance"],
    month: string,
    students: Array<{ id: string }>,
    seedDate: string
  ): { seeded: Record<string, Record<string, "present" | "absent" | "late">>; arrival: Record<string, Record<string, string>> } {
    const seeded: Record<string, Record<string, "present" | "absent" | "late">> = {}
    const arrival: Record<string, Record<string, string>> = {}
    attendance
      .filter((a) => a.date.startsWith(month))
      .forEach((a) => {
        seeded[a.date] = {}
        Object.entries(a.records).forEach(([sid, status]) => {
          if (status === "present" || status === "absent" || status === "late") {
            seeded[a.date][sid] = status
          }
        })
        if (a.arrivalTimes) arrival[a.date] = { ...a.arrivalTimes }
      })
    // Seed the selected date with "present" for students without a saved record
    if (seedDate.startsWith(month) && seedDate <= new Date().toISOString().split("T")[0]) {
      if (!seeded[seedDate]) seeded[seedDate] = {}
      students.forEach((s) => {
        if (!seeded[seedDate][s.id]) seeded[seedDate][s.id] = "present"
      })
    }
    return { seeded, arrival }
  }

  // Seed the attendance grid for a class+date, overlaying any unsaved local
  // draft (typed statuses / late times) so going back or refreshing never
  // loses work. Use this everywhere we open or change the attendance grid.
  const seedAttendanceGrid = useCallback((cls: CourseData["classes"][number], date: string) => {
    const month = date.slice(0, 7)
    const { seeded, arrival } = buildSeededAttendance(cls.attendance, month, cls.students, date)
    const draft = loadAttendanceDraft(cls.id, month)
    if (draft && (Object.keys(draft.attendance).length > 0 || Object.keys(draft.arrival).length > 0)) {
      // Draft wins for dates the user touched; fall back to DB-seeded for the rest.
      setMonthAttendance({ ...seeded, ...draft.attendance })
      setMonthArrival({ ...arrival, ...draft.arrival })
    } else {
      setMonthAttendance(seeded)
      setMonthArrival(arrival)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // After a refresh that restored an attendance view, the grid state is empty
  // because the seeding normally happens on the button click. Re-seed it once
  // the class data is available so the page isn't blank.
  useEffect(() => {
    if (view.page !== "attendance") return
    if (Object.keys(monthAttendance).length > 0) return // already populated
    const cls = getClass(view.courseId, view.classId)
    if (!cls) return // courses still loading
    seedAttendanceGrid(cls, selectedAttDate)
  }, [view, courses]) // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave unsaved attendance edits to a 1-hour local draft so they survive
  // navigating back or refreshing. Cleared on a successful save.
  const skipNextDraftSave = useRef(false)
  useEffect(() => {
    if (view.page !== "attendance") return
    if (skipNextDraftSave.current) { skipNextDraftSave.current = false; return }
    if (Object.keys(monthAttendance).length === 0 && Object.keys(monthArrival).length === 0) return
    saveAttendanceDraft(view.classId, selectedAttDate.slice(0, 7), monthAttendance, monthArrival)
  }, [monthAttendance, monthArrival, view, selectedAttDate])

  // ── Save Monthly Attendance ──────────────────────────────
  const [attendanceSaving, setAttendanceSaving] = useState(false)
  const [attendanceSuccess, setAttendanceSuccess] = useState(false)

  const handleSaveMonthlyAttendance = async (courseId: string, classId: string) => {
    setAttendanceSaving(true)
    // Save to Supabase if available
    if (useSupabase) {
      const markedByName = user
        ? (user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Unknown")
        : "Unknown"
      const { error } = await db.saveAttendance(classId, monthAttendance, markedByName, undefined, monthArrival)
      if (error) { toast.error("Failed to save attendance"); setAttendanceSaving(false); return }
    }

    saveCourses((prev) =>
      prev.map((course) =>
        course.id === courseId
          ? {
              ...course,
              classes: course.classes.map((cls) => {
                if (cls.id !== classId) return cls
                const updated = [...cls.attendance]
                Object.entries(monthAttendance).forEach(([date, records]) => {
                  if (Object.keys(records).length === 0) return
                  const idx = updated.findIndex((a) => a.date === date)
                  if (idx >= 0) {
                    updated[idx] = { date, records: { ...records } }
                  } else {
                    updated.push({ date, records: { ...records } })
                  }
                })
                updated.sort((a, b) => a.date.localeCompare(b.date))
                return { ...cls, attendance: updated }
              }),
            }
          : course
      )
    )

    // Refetch from Supabase so both pages stay in sync
    if (useSupabase) {
      const freshAttendance = await db.fetchAllAttendance(classId)
      if (freshAttendance.length > 0) {
        saveCourses((prev) =>
          prev.map((course) =>
            course.id === courseId
              ? { ...course, classes: course.classes.map((cls) =>
                  cls.id === classId ? { ...cls, attendance: freshAttendance } : cls
                ) }
              : course
          )
        )
      }
    }

    // Saved to DB — discard the local draft and don't let the re-seed below
    // immediately write it back.
    clearAttendanceDraft(classId, selectedAttDate.slice(0, 7))
    skipNextDraftSave.current = true

    // Re-seed grid from updated data instead of clearing
    const updatedCls = courses.find((c) => c.id === courseId)?.classes.find((c) => c.id === classId)
    if (updatedCls) {
      const month = selectedAttDate.slice(0, 7)
      const { seeded, arrival } = buildSeededAttendance(updatedCls.attendance, month, updatedCls.students, selectedAttDate)
      setMonthAttendance(seeded); setMonthArrival(arrival)
    }
    setAttendanceSaving(false)
    setAttendanceSuccess(true)
    // Mobile-visible popup — sonner positions itself at top-center on small
    // screens, so the teacher gets clear confirmation even if the inline
    // banner is below the fold.
    toast.success("Attendance marked successfully", {
      description: "All records saved and synced to the database.",
      duration: 5000,
    })
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
    setTimeout(() => setAttendanceSuccess(false), 5000)
  }

  // ── Legacy grade-book helpers removed. All exam/grade entry now lives at /dashboard/assessment.


  // Track which student card is expanded to show full profile + edit form
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null)
  const [editStudentId, setEditStudentId] = useState<string | null>(null)
  const [profileEdit, setProfileEdit] = useState<{
    gender: string
    fatherName: string
    motherName: string
    fatherPhone: string
    motherPhone: string
    email: string
  }>({ gender: "", fatherName: "", motherName: "", fatherPhone: "", motherPhone: "", email: "" })

  // Transfer student state
  const [transferStudent, setTransferStudent] = useState<{ id: string; name: string; currentClass: string } | null>(null)
  const [transferDestCourseId, setTransferDestCourseId] = useState("")
  const [transferDestClassId, setTransferDestClassId] = useState("")
  const [transferring, setTransferring] = useState(false)

  const handleTransfer = async () => {
    if (!transferStudent || !transferDestClassId) return
    setTransferring(true)
    try {
      const { error } = await supabase
        .from("students")
        .update({ class_id: transferDestClassId })
        .eq("id", transferStudent.id)
      if (error) { toast.error("Transfer failed: " + error.message); return }
      toast.success(`${transferStudent.name} transferred successfully`)
      setTransferStudent(null)
      setTransferDestCourseId("")
      setTransferDestClassId("")
      reloadFromSupabase()
    } finally {
      setTransferring(false)
    }
  }

  const startEditProfile = (student: { id: string; gender?: string; fatherName?: string; motherName?: string; fatherPhone?: string; motherPhone?: string; email?: string }) => {
    setEditStudentId(student.id)
    setProfileEdit({
      gender: student.gender ?? "",
      fatherName: student.fatherName ?? "",
      motherName: student.motherName ?? "",
      fatherPhone: student.fatherPhone ?? "",
      motherPhone: student.motherPhone ?? "",
      email: student.email ?? "",
    })
  }

  // ── Bulk Parent Import (admin only) ─────────────────────────
  const [showBulkImport, setShowBulkImport] = useState(false)

  // Multi-format export — CSV / Excel / Google Sheets / PDF.
  // Used at the course level (every class flattened) and at the per-class
  // level (single class). Both paths route through the same helper.
  const exportCourse = useCallback((courseId: string, format: ExportFormat) => {
    const course = courses.find((c) => c.id === courseId)
    if (!course) return
    const flat: ExportableStudent[] = course.classes.flatMap((c) =>
      c.students.map((s) => ({ ...s, className: c.name }))
    )
    if (flat.length === 0) {
      toast.error("No students to export")
      return
    }
    const res = exportStudents(flat, format, {
      label: `${course.title}-students`,
      subtitle: `${course.title} · ${course.classes.length} classes`,
    })
    if (res.ok) toast.success(res.message ?? "Export ready")
    else toast.error(res.message ?? "Export failed")
  }, [courses])

  const exportClass = useCallback((courseId: string, classId: string, format: ExportFormat) => {
    const course = courses.find((c) => c.id === courseId)
    const cls = course?.classes.find((c) => c.id === classId)
    if (!course || !cls) return
    if (cls.students.length === 0) {
      toast.error("No students in this class to export")
      return
    }
    const flat: ExportableStudent[] = cls.students.map((s) => ({ ...s, className: cls.name }))
    const res = exportStudents(flat, format, {
      label: `${cls.name}-students`,
      subtitle: `${course.title} · ${cls.name} · ${cls.schedule}`,
    })
    if (res.ok) toast.success(res.message ?? "Export ready")
    else toast.error(res.message ?? "Export failed")
  }, [courses])

  const handleSaveProfile = async (student: { id: string; name: string }) => {
    if (!useSupabase) { toast.error("Supabase not configured"); return }

    // Gender and parent contact details are mandatory; email is recommended
    // but optional — no partial records on the required fields.
    if (!profileEdit.gender.trim()) { toast.error("Gender is required"); return }
    if (!profileEdit.fatherName.trim()) { toast.error("Father's name is required"); return }
    if (!profileEdit.motherName.trim()) { toast.error("Mother's name is required"); return }
    if (!profileEdit.fatherPhone.trim()) { toast.error("Father's phone is required"); return }
    if (!profileEdit.motherPhone.trim()) { toast.error("Mother's phone is required"); return }
    if (profileEdit.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileEdit.email.trim())) { toast.error("Enter a valid email address"); return }

    const { error } = await db.updateStudentProfile(student.id, {
      gender: profileEdit.gender || null,
      fatherName: profileEdit.fatherName || null,
      motherName: profileEdit.motherName || null,
      fatherPhone: profileEdit.fatherPhone || null,
      motherPhone: profileEdit.motherPhone || null,
      email: profileEdit.email.trim() || null,
    })
    if (error) {
      toast.error("Failed to save profile")
      return
    }
    toast.success(`${student.name}'s profile saved`)
    setEditStudentId(null)
    const fresh = await db.fetchCoursesFromDB()
    setCourses(fresh)
  }

  // ── Breadcrumb ───────────────────────────────────────────
  const Breadcrumb = () => {
    const crumbs: { label: string; onClick?: () => void }[] = [
      { label: "Teachers", onClick: () => setView({ page: "courses" }) },
    ]
    if (view.page !== "courses") {
      const course = getCourse((view as { courseId: string }).courseId)
      crumbs.push({
        label: course?.title || "",
        onClick: () => setView({ page: "classes", courseId: (view as { courseId: string }).courseId }),
      })
    }
    if (view.page === "viewClass" || view.page === "attendance" || view.page === "gradebook") {
      const cls = getClass(view.courseId, view.classId)
      crumbs.push({ label: cls?.name || "" })
    }

    return (
      <div className="flex items-center gap-1.5 text-sm text-navy-500 dark:text-navy-400 mb-4 flex-wrap">
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-3.5" />}
            {crumb.onClick && i < crumbs.length - 1 ? (
              <button onClick={crumb.onClick} className="hover:text-gold-500 transition-colors">
                {crumb.label}
              </button>
            ) : (
              <span className="font-medium text-navy-700 dark:text-navy-200">{crumb.label}</span>
            )}
          </span>
        ))}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: COURSES LIST
  // ══════════════════════════════════════════════════════════
  if (view.page === "courses") {
    return (
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold text-navy-900 dark:text-white">Select your Ihlamudheen Madrasa course</h1>
          <p className="mt-1 text-navy-600 dark:text-navy-300">
            Manage your courses, classes, students, attendance, and grades.
          </p>
        </motion.div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {courses.map((course, i) => (
            <motion.div
              key={course.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card
                className="cursor-pointer transition-all hover:shadow-lg hover:ring-1 hover:ring-gold-500/30"
                onClick={() => setView({ page: "classes", courseId: course.id })}
              >
                <div className="h-28 bg-gradient-to-br from-[#fef9f0] via-[#fdf3e3] to-[#faebd7] dark:from-navy-700 dark:to-navy-900 flex items-center justify-center rounded-t-lg">
                  <CourseLogo id={course.id} title={course.title} className={course.logoClass} />
                </div>
                <CardContent className="p-4">
                  <h3 className="font-semibold text-navy-900 dark:text-white text-sm">{course.title}</h3>
                  <p className="text-xs text-navy-500 dark:text-navy-400 mt-1">
                    {course.classes.length} {course.classes.length === 1 ? "class" : "classes"}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* ── Staff Directory ─────────────────────────────────── */}
        {isAdmin && <StaffDirectory />}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: CLASSES LIST
  // ══════════════════════════════════════════════════════════
  if (view.page === "classes") {
    const course = getCourse(view.courseId)
    if (!course) return null

    return (
      <div className="space-y-6">
        <Breadcrumb />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setView({ page: "courses" })}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-navy-100 dark:hover:bg-navy-800 transition-colors"
            >
              <ChevronLeft className="size-5 text-navy-500" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold text-navy-900 dark:text-white">{course.title}</h1>
              <p className="text-sm text-navy-500 dark:text-navy-400">{course.classes.length} classes</p>
            </div>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {isAdmin && (
              <ExportDropdown onExport={(fmt) => exportCourse(view.courseId, fmt)} />
            )}
            {isAdmin && course.classes.length > 0 && (
              <Button
                variant="outline"
                className={cn(
                  "border-red-400/60",
                  removeClassMode
                    ? "bg-red-500 text-white hover:bg-red-400 border-red-500"
                    : "text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                )}
                onClick={() => setRemoveClassMode((v) => !v)}
              >
                <Trash2 className="size-4 mr-1" />
                {removeClassMode ? "Done" : "Remove Class"}
              </Button>
            )}
            <Button
              className="bg-gold-500 text-navy-950 hover:bg-gold-400"
              onClick={() => setShowAddClass(true)}
            >
              <Plus className="size-4 mr-1" /> Add Class
            </Button>
          </div>
        </div>

        {/* Add Class Modal */}
        <AnimatePresence>
          {showAddClass && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <Card className="border-gold-500/30">
                <CardContent className="p-4 space-y-3">
                  <h3 className="font-semibold text-navy-900 dark:text-white">New Class</h3>
                  <Input
                    placeholder="Class name * (e.g., Grade 6)"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                  />
                  <Input
                    placeholder="Working days * (e.g., Monday – Saturday)"
                    value={newClassSchedule}
                    onChange={(e) => setNewClassSchedule(e.target.value)}
                  />
                  {(() => {
                    const course = getCourse(view.courseId)
                    const preview = normalizeClassName(newClassName, course?.classes ?? [])
                    return newClassName.trim() && preview !== newClassName.trim() ? (
                      <p className="text-xs text-gold-600 dark:text-gold-400">
                        Will be saved as <span className="font-semibold">{preview}</span> to match this course&apos;s other classes.
                      </p>
                    ) : null
                  })()}
                  <div className="flex gap-2">
                    <Button className="bg-gold-500 text-navy-950 hover:bg-gold-400" onClick={() => handleAddClass(view.courseId)}>
                      <Save className="size-4 mr-1" /> Save
                    </Button>
                    <Button variant="outline" onClick={() => setShowAddClass(false)}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {course.classes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="size-12 text-navy-300 dark:text-navy-600 mb-3" />
            <p className="text-navy-500 dark:text-navy-400">No classes yet. Add your first class.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {course.classes.map((cls, i) => (
              <motion.div key={cls.id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className={cn("transition-shadow hover:shadow-md", removeClassMode && isAdmin && "ring-2 ring-red-400/60")}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-navy-900 dark:text-white">{cls.name}</h3>
                        <p className="text-xs text-navy-500 dark:text-navy-400 mt-0.5">{cls.schedule}</p>
                        <p className="text-xs text-navy-400 mt-1 flex items-center gap-1">
                          <Users className="size-3" /> {cls.students.length} students
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {isAdmin && !removeClassMode && (
                          <button
                            onClick={() => handleEditClass(view.courseId, cls.id, cls.name, cls.schedule)}
                            className="flex size-8 items-center justify-center rounded-lg text-navy-400 hover:bg-navy-100 hover:text-navy-700 dark:hover:bg-navy-800 dark:hover:text-navy-200 transition-colors"
                            title={`Edit ${cls.name}`}
                          >
                            <Pencil className="size-4" />
                          </button>
                        )}
                        {removeClassMode && isAdmin && (
                          <button
                            onClick={() => handleRemoveClass(view.courseId, cls.id, cls.name)}
                            className="flex size-8 items-center justify-center rounded-lg bg-red-500 text-white hover:bg-red-400 transition-colors"
                            title={`Delete ${cls.name}`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Button
                        size="sm"
                        className="bg-navy-700 text-white hover:bg-navy-600"
                        onClick={() => setView({ page: "viewClass", courseId: view.courseId, classId: cls.id })}
                      >
                        <Eye className="size-3.5 mr-1" /> View
                      </Button>
                      <Button
                        size="sm"
                        className="bg-emerald-600 text-white hover:bg-emerald-500"
                        onClick={() => {
                          // Pre-seed monthAttendance from DB data (+ any unsaved draft)
                          const today = new Date().toISOString().split("T")[0]
                          setSelectedAttDate(today)
                          setPendingAttDate(today)
                          seedAttendanceGrid(cls, today)
                          setView({ page: "attendance", courseId: view.courseId, classId: cls.id })
                        }}
                      >
                        <ClipboardCheck className="size-3.5 mr-1" /> Attend
                      </Button>
                      <Button
                        size="sm"
                        className="bg-indigo-600 text-white hover:bg-indigo-500"
                        title="Open in Grade Book"
                        onClick={() => router.push("/dashboard/assessment")}
                      >
                        <FileText className="size-3.5 mr-1" /> Grades
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        {/* Bulk Parent Import slide-over */}
        <AnimatePresence>
          {showBulkImport && course.classes.length > 0 && (
            <BulkParentImport
              key="bulk-import"
              allStudents={course.classes.flatMap((c) => c.students.map((s) => ({ ...s, className: c.name })))}
              onClose={() => setShowBulkImport(false)}
              onImported={async () => {
                setShowBulkImport(false)
                const fresh = await db.fetchCoursesFromDB()
                setCourses(fresh)
              }}
            />
          )}
        </AnimatePresence>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: VIEW CLASS (Students List)
  // ══════════════════════════════════════════════════════════
  if (view.page === "viewClass") {
    const course = getCourse(view.courseId)
    const cls = getClass(view.courseId, view.classId)
    if (!course || !cls) return null

    return (
      <div className="space-y-6">
        <Breadcrumb />
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setView({ page: "classes", courseId: view.courseId })}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-navy-100 dark:hover:bg-navy-800 transition-colors"
            >
              <ChevronLeft className="size-5 text-navy-500" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold text-navy-900 dark:text-white">{cls.name}</h1>
              <p className="text-sm text-navy-500 dark:text-navy-400">{cls.schedule} · {cls.students.length} students</p>
            </div>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button size="sm" variant="outline" onClick={() => {
              const today = new Date().toISOString().split("T")[0]
              setSelectedAttDate(today)
              setPendingAttDate(today)
              seedAttendanceGrid(cls, today)
              setView({ page: "attendance", courseId: view.courseId, classId: view.classId })
            }}>
              <ClipboardCheck className="size-4 mr-1" /> Attendance
            </Button>
            <Button size="sm" variant="outline" title="Open unified Grade Book" onClick={() => router.push("/dashboard/assessment")}>
              <FileText className="size-4 mr-1" /> Grade Book
            </Button>
            <ExportDropdown
              size="sm"
              label="Export"
              onExport={(fmt) => exportClass(view.courseId, view.classId, fmt)}
            />
            {/* Valid (active) vs Previous (removed) students — default Valid */}
            <select
              value={rosterView}
              onChange={(e) => { setRosterView(e.target.value as "valid" | "previous"); setRemoveStudentMode(false) }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              title="Show valid (active) or previous (removed) students"
            >
              <option value="valid">Valid Students</option>
              <option value="previous">Previous Students</option>
            </select>
            {rosterView === "valid" && canManageRoster && cls.students.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className={cn(
                  "border-red-400/60",
                  removeStudentMode
                    ? "bg-red-500 text-white hover:bg-red-400 border-red-500"
                    : "text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                )}
                onClick={() => setRemoveStudentMode((v) => !v)}
              >
                <Trash2 className="size-4 mr-1" />
                {removeStudentMode ? "Done" : "Remove Student"}
              </Button>
            )}
            {rosterView === "valid" && canAddRoster && (
              <Button size="sm" className="bg-gold-500 text-navy-950 hover:bg-gold-400" onClick={() => setShowAddStudent(true)}>
                <UserPlus className="size-4 mr-1" /> Add Student
              </Button>
            )}
          </div>
        </div>

        {/* Add Student — admin / accountant / teacher */}
        <AnimatePresence>
          {canAddRoster && showAddStudent && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <Card className="border-gold-500/30">
                <CardContent className="p-4 space-y-3">
                  <h3 className="font-semibold text-navy-900 dark:text-white">Add Student</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {/* Name field with live suggestions */}
                    <div className="relative sm:col-span-1">
                      <Input
                        placeholder="Student name *"
                        value={newStudentName}
                        onChange={(e) => { setNewStudentName(e.target.value); setShowNameSuggestions(true) }}
                        onFocus={() => setShowNameSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowNameSuggestions(false), 150)}
                        autoComplete="off"
                      />
                      {showNameSuggestions && nameSuggestions.length > 0 && (
                        <ul className="absolute z-50 left-0 right-0 top-full mt-1 rounded-md border border-border bg-background shadow-lg max-h-48 overflow-y-auto text-sm">
                          {nameSuggestions.map(({ student, courseTitle, className }) => (
                            <li
                              key={student.id}
                              onMouseDown={() => {
                                setNewStudentName(student.name)
                                setNewStudentRoll(student.rollNo)
                                if (student.gender) setNewStudentGender(student.gender as "" | "Male" | "Female")
                                if (student.fatherName) setNewStudentFather(student.fatherName)
                                if (student.motherName) setNewStudentMother(student.motherName)
                                if (student.fatherPhone) setNewStudentPhone(student.fatherPhone)
                                if (student.motherPhone) setNewStudentAltPhone(student.motherPhone)
                                setShowNameSuggestions(false)
                              }}
                              className="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer hover:bg-navy-100 dark:hover:bg-navy-800"
                            >
                              <span className="font-medium truncate">{student.name}</span>
                              <span className="text-xs text-navy-400 shrink-0">Reg {student.rollNo} · {courseTitle} {className}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {/* Register number with live duplicate preview */}
                    <div>
                      <Input
                        placeholder="Register number *"
                        value={newStudentRoll}
                        onChange={(e) => setNewStudentRoll(e.target.value.replace(/\D/g, ""))}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className={cn("font-mono", regLookupMatch && "border-amber-500 focus-visible:ring-amber-500")}
                      />
                      {regLookupMatch && (
                        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 leading-snug">
                          Reg {newStudentRoll} already belongs to <strong>{regLookupMatch.student.name}</strong> in {regLookupMatch.courseTitle} · {regLookupMatch.className}. Save will be blocked.
                        </p>
                      )}
                    </div>
                    <select
                      value={newStudentGender}
                      onChange={(e) => setNewStudentGender(e.target.value as "" | "Male" | "Female")}
                      className={cn(
                        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                        newStudentGender ? "text-foreground" : "text-muted-foreground"
                      )}
                      aria-label="Sex"
                    >
                      <option value="">Sex *</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                    <Input placeholder="Father's name *" value={newStudentFather} onChange={(e) => setNewStudentFather(e.target.value)} />
                    <Input placeholder="Mother's name *" value={newStudentMother} onChange={(e) => setNewStudentMother(e.target.value)} />
                    <Input placeholder="Contact number *" value={newStudentPhone} onChange={(e) => setNewStudentPhone(e.target.value)} className="font-mono" />
                    <Input placeholder="Alternate contact number" value={newStudentAltPhone} onChange={(e) => setNewStudentAltPhone(e.target.value)} className="font-mono" />
                    <Input
                      placeholder="Email address (recommended)"
                      type="email"
                      value={newStudentEmail}
                      onChange={(e) => setNewStudentEmail(e.target.value)}
                      inputMode="email"
                      className="sm:col-span-2"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button className="bg-gold-500 text-navy-950 hover:bg-gold-400" onClick={() => handleAddStudent(view.courseId, view.classId)}>
                      <Save className="size-4 mr-1" /> Save
                    </Button>
                    <Button variant="outline" onClick={() => {
                      setShowAddStudent(false)
                      setNewStudentName(""); setNewStudentRoll(""); setNewStudentGender("")
                      setNewStudentFather(""); setNewStudentMother(""); setNewStudentPhone(""); setNewStudentAltPhone(""); setNewStudentEmail(""); setShowNameSuggestions(false)
                    }}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Roster — Valid (active) students by default, or Previous (removed) students */}
        {rosterView === "previous" ? (
          (() => {
            const prev = previousStudents.filter((p) => p.classId === view.classId)
            if (prev.length === 0) {
              return (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Users className="size-12 text-navy-300 dark:text-navy-600 mb-3" />
                  <p className="text-navy-500 dark:text-navy-400">No previous students for this class.</p>
                </div>
              )
            }
            return (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {prev.map((s) => (
                  <Card key={s.id} className="border-red-300/50 dark:border-red-500/30">
                    <CardContent className="p-4 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-navy-900 dark:text-white truncate">{s.name}</p>
                        <span className="shrink-0 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">Previous</span>
                      </div>
                      <p className="text-xs font-mono text-navy-500 dark:text-navy-400">Reg No {s.rollNo}</p>
                      <p className="text-[11px] text-navy-400">
                        Removed{s.disenrolledAt ? ` ${new Date(s.disenrolledAt).toLocaleDateString("en-AE")}` : ""}{s.reason ? ` · ${s.reason}` : ""}
                      </p>
                      {canManageRoster && (
                        <Button size="sm" variant="outline" className="mt-1 border-emerald-400/60 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20" onClick={() => handleRestoreStudent(s)}>
                          Restore
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )
          })()
        ) : cls.students.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="size-12 text-navy-300 dark:text-navy-600 mb-3" />
            <p className="text-navy-500 dark:text-navy-400">No students yet. Add students to this class.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cls.students.map((student, i) => {
              const expanded = expandedStudentId === student.id
              const editing = editStudentId === student.id
              return (
                <motion.div
                  key={student.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={cn("col-span-1", expanded && "sm:col-span-2 lg:col-span-3 xl:col-span-4")}
                >
                  <Card className={cn("transition-shadow hover:shadow-md", removeStudentMode && canManageRoster && "ring-2 ring-red-400/60", expanded && "ring-2 ring-gold-500/40")}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="relative group shrink-0">
                          {(getPhotoDisplay(student.photo) || student.photo?.startsWith("students/")) ? (
                            <Image src={getPhotoDisplay(student.photo) || ""} alt={student.name} width={48} height={48} className="size-12 rounded-full object-cover ring-2 ring-border" />
                          ) : (
                            <div className="flex size-12 items-center justify-center rounded-full bg-navy-100 dark:bg-navy-700 text-navy-500 dark:text-navy-300 text-lg font-semibold">
                              {student.name[0]}
                            </div>
                          )}
                          <label className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                            <Camera className="size-4 text-white" />
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) handlePhotoUpload(view.courseId, view.classId, student.id, file)
                              }}
                            />
                          </label>
                        </div>
                        <button
                          onClick={() => {
                            if (removeStudentMode && canManageRoster) return
                            setExpandedStudentId(expanded ? null : student.id)
                            setEditStudentId(null)
                          }}
                          className="min-w-0 flex-1 text-left"
                          disabled={removeStudentMode && canManageRoster}
                        >
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-navy-900 dark:text-white text-sm truncate">{student.name}</p>
                            {student.gender && (
                              <span className={cn(
                                "shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full",
                                student.gender === "Male"
                                  ? "bg-blue-500/10 text-blue-500"
                                  : "bg-pink-500/10 text-pink-500"
                              )}>
                                {student.gender === "Male" ? "M" : "F"}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-navy-500 dark:text-navy-400">
                            Reg No {student.rollNo}
                            {student.fatherName && (
                              <span className="ml-2 truncate">· {student.gender === "Female" ? "d/o" : "s/o"} {student.fatherName.split(" ")[0]}</span>
                            )}
                          </p>
                        </button>
                        {removeStudentMode && canManageRoster ? (
                          <button
                            onClick={() => handleRemoveStudent(view.courseId, view.classId, student.id, student.name)}
                            className="flex size-8 items-center justify-center rounded-lg bg-red-500 text-white hover:bg-red-400 transition-colors shrink-0"
                            title={`Remove ${student.name}`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => setExpandedStudentId(expanded ? null : student.id)}
                            className="shrink-0 size-7 flex items-center justify-center rounded-md hover:bg-navy-100 dark:hover:bg-navy-800 transition-colors"
                            title={expanded ? "Collapse" : "View details"}
                          >
                            <ChevronRight className={cn("size-4 text-navy-500 transition-transform", expanded && "rotate-90")} />
                          </button>
                        )}
                      </div>

                      {/* Expanded profile panel */}
                      <AnimatePresence>
                        {expanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.25 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-4 pt-3 border-t border-border">
                              {!editing ? (
                                <>
                                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                                    <ProfileField label="Gender" value={student.gender ?? "—"} />
                                    <ProfileField label="Father" value={student.fatherName ?? "—"} />
                                    <ProfileField label="Mother" value={student.motherName ?? "—"} />
                                    <ProfileField label="Father Phone" value={student.fatherPhone ?? "—"} mono />
                                    <ProfileField label="Mother Phone" value={student.motherPhone ?? "—"} mono />
                                    <ProfileField label="Reg No" value={student.rollNo} mono />
                                    <ProfileField label="Email" value={student.email ?? "—"} mono />
                                  </div>
                                  <div className="mt-3 flex gap-2 flex-wrap">
                                    <Button size="sm" variant="outline" onClick={() => startEditProfile(student)}>
                                      <Save className="size-3.5 mr-1" /> Edit Profile
                                    </Button>
                                    {isAdmin && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="border-sky-400 text-sky-600 hover:bg-sky-50 dark:border-sky-500 dark:text-sky-400"
                                        onClick={() => {
                                          const currentClassName = view.page === "viewClass" ? (getClass(view.courseId, view.classId)?.name ?? "") : ""
                                          setTransferStudent({ id: student.id, name: student.name, currentClass: currentClassName })
                                          setTransferDestCourseId("")
                                          setTransferDestClassId("")
                                        }}
                                      >
                                        <ArrowRightLeft className="size-3.5 mr-1" /> Transfer
                                      </Button>
                                    )}
                                    {(student.fatherPhone || student.motherPhone) && (
                                      <a
                                        href={`tel:${student.fatherPhone || student.motherPhone}`}
                                        className="inline-flex items-center justify-center h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-navy-100 dark:hover:bg-navy-800 transition-colors"
                                      >
                                        📞 Call
                                      </a>
                                    )}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                                    <div>
                                      <label className="block text-[10px] font-bold uppercase tracking-wider text-navy-400 mb-1">Gender *</label>
                                      <select
                                        value={profileEdit.gender}
                                        onChange={(e) => setProfileEdit((p) => ({ ...p, gender: e.target.value }))}
                                        className="w-full h-8 px-2 rounded-md border border-input bg-background text-sm"
                                      >
                                        <option value="">—</option>
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold uppercase tracking-wider text-navy-400 mb-1">Father Name *</label>
                                      <Input value={profileEdit.fatherName} onChange={(e) => setProfileEdit((p) => ({ ...p, fatherName: e.target.value }))} className="h-8 text-sm" />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold uppercase tracking-wider text-navy-400 mb-1">Mother Name *</label>
                                      <Input value={profileEdit.motherName} onChange={(e) => setProfileEdit((p) => ({ ...p, motherName: e.target.value }))} className="h-8 text-sm" />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold uppercase tracking-wider text-navy-400 mb-1">Father Phone *</label>
                                      <Input value={profileEdit.fatherPhone} onChange={(e) => setProfileEdit((p) => ({ ...p, fatherPhone: e.target.value }))} className="h-8 text-sm font-mono" />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold uppercase tracking-wider text-navy-400 mb-1">Mother Phone *</label>
                                      <Input value={profileEdit.motherPhone} onChange={(e) => setProfileEdit((p) => ({ ...p, motherPhone: e.target.value }))} className="h-8 text-sm font-mono" />
                                    </div>
                                    <div className="sm:col-span-2 lg:col-span-3">
                                      <label className="block text-[10px] font-bold uppercase tracking-wider text-navy-400 mb-1">Email (recommended)</label>
                                      <Input type="email" inputMode="email" value={profileEdit.email} onChange={(e) => setProfileEdit((p) => ({ ...p, email: e.target.value }))} className="h-8 text-sm font-mono" />
                                    </div>
                                  </div>
                                  <div className="mt-3 flex gap-2">
                                    <Button size="sm" className="bg-gold-500 text-navy-950 hover:bg-gold-400" onClick={() => handleSaveProfile(student)}>
                                      <Save className="size-3.5 mr-1" /> Save
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setEditStudentId(null)}>Cancel</Button>
                                  </div>
                                </>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: TAKE ATTENDANCE (Monthly Grid)
  // ══════════════════════════════════════════════════════════
  if (view.page === "attendance") {
    const course = getCourse(view.courseId)
    const cls = getClass(view.courseId, view.classId)
    if (!course || !cls) return null

    // Program-level late policy. Untracked programs (e.g. CIBIS) return null,
    // hiding the arrival panel and keeping only present/absent.
    const courseTitle = course.title
    const programStart = getProgramStart(courseTitle) // "HH:MM" | null
    const trackLate = programStart !== null

    // Derive month from selectedAttDate
    const attendanceMonth = selectedAttDate.slice(0, 7)
    const selectedDay = parseInt(selectedAttDate.split("-")[2], 10)
    const [selYear, selMonth] = attendanceMonth.split("-").map(Number)
    const daysInMonth = new Date(selYear, selMonth, 0).getDate()
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
    const today = new Date()
    const todayDate = today.getDate()
    const isCurrentMonth = selYear === today.getFullYear() && selMonth === today.getMonth() + 1
    const isPastMonth = selYear < today.getFullYear() || (selYear === today.getFullYear() && selMonth < today.getMonth() + 1)

    const getStatus = (studentId: string, day: number): "present" | "absent" | "late" | "" => {
      const dateStr = `${attendanceMonth}-${String(day).padStart(2, "0")}`
      if (isFutureDay(day)) return ""
      // Single source of truth: monthAttendance (pre-seeded from DB)
      const val = monthAttendance[dateStr]?.[studentId]
      if (val === "present" || val === "absent" || val === "late") return val
      return ""
    }

    const getArrival = (studentId: string, day: number): string => {
      const dateStr = `${attendanceMonth}-${String(day).padStart(2, "0")}`
      return monthArrival[dateStr]?.[studentId] || ""
    }

    const isFutureDay = (day: number): boolean => {
      if (!isCurrentMonth && !isPastMonth) return true
      if (isCurrentMonth && day > todayDate) return true
      return false
    }

    // Only the applied date's column is editable — all others are read-only.
    const isEditableDay = (day: number) => day === selectedDay && !isFutureDay(day)

    // Commits pendingAttDate (the date-picker's draft value) as the active,
    // editable date. Browsing the picker alone never changes what's
    // editable — only clicking Apply does.
    const applyPendingAttDate = () => {
      const newDate = pendingAttDate
      const newMonth = newDate.slice(0, 7)
      const oldMonth = selectedAttDate.slice(0, 7)
      if (newMonth !== oldMonth) {
        // Each month keeps its own 1-hour draft, so switching months never
        // loses unsaved edits — reload the target month's data + draft.
        setSelectedAttDate(newDate)
        seedAttendanceGrid(cls, newDate)
      } else {
        setSelectedAttDate(newDate)
      }
    }

    const toggleStatus = (studentId: string, day: number) => {
      if (!isEditableDay(day)) return
      const dateStr = `${attendanceMonth}-${String(day).padStart(2, "0")}`
      const current = getStatus(studentId, day)
      // A "late" cell behaves like "present" here — clicking it marks absent.
      const next: "present" | "absent" = current === "present" || current === "late" ? "absent" : "present"
      // Toggling never records a time, so drop any arrival time for this cell.
      setMonthArrival((prev) => {
        if (!prev[dateStr]?.[studentId]) return prev
        const { [studentId]: _drop, ...rest } = prev[dateStr]
        void _drop
        return { ...prev, [dateStr]: rest }
      })
      setMonthAttendance((prev) => ({
        ...prev,
        [dateStr]: { ...(prev[dateStr] || {}), [studentId]: next },
      }))
    }

    // Record an arrival time for the selected date and auto-set status:
    // after the program start ⇒ "late", otherwise "present". Clearing the
    // time reverts a "late" cell to "present".
    const setArrivalTime = (studentId: string, value: string) => {
      if (!trackLate) return
      const dateStr = selectedAttDate
      const trimmed = value.trim()
      if (!trimmed) {
        setMonthArrival((prev) => {
          if (!prev[dateStr]?.[studentId]) return prev
          const { [studentId]: _d, ...rest } = prev[dateStr]
          void _d
          return { ...prev, [dateStr]: rest }
        })
        setMonthAttendance((prev) => {
          if (prev[dateStr]?.[studentId] !== "late") return prev
          return { ...prev, [dateStr]: { ...(prev[dateStr] || {}), [studentId]: "present" } }
        })
        return
      }
      const nextStatus: "present" | "late" = computeLateness(courseTitle, trimmed)?.isLate ? "late" : "present"
      setMonthArrival((prev) => ({
        ...prev,
        [dateStr]: { ...(prev[dateStr] || {}), [studentId]: trimmed },
      }))
      setMonthAttendance((prev) => ({
        ...prev,
        [dateStr]: { ...(prev[dateStr] || {}), [studentId]: nextStatus },
      }))
    }

    const getMonthSummary = (studentId: string) => {
      let present = 0, absent = 0, late = 0
      days.forEach((d) => {
        const s = getStatus(studentId, d)
        if (s === "present") present++
        else if (s === "absent") absent++
        else if (s === "late") late++
      })
      return { present, absent, late }
    }

    return (
      <div className="space-y-6">
        <Breadcrumb />
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setView({ page: "classes", courseId: view.courseId })}
              className="flex size-8 items-center justify-center rounded-lg hover:bg-navy-100 dark:hover:bg-navy-800 transition-colors"
            >
              <ChevronLeft className="size-5 text-navy-500" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
                <ClipboardCheck className="size-6 text-emerald-500" /> Attendance
              </h1>
              <p className="text-sm text-navy-500 dark:text-navy-400">{cls.name}</p>
            </div>
          </div>
        </div>

        {/* Success notification — white box with green tick */}
        <AnimatePresence>
          {attendanceSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="flex items-center gap-4 rounded-xl bg-white dark:bg-navy-800 border border-emerald-200 dark:border-emerald-700 px-6 py-5 shadow-xl"
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20 ring-4 ring-emerald-100 dark:ring-emerald-500/10">
                <ClipboardCheck className="size-7 text-emerald-500" />
              </div>
              <div>
                <p className="text-lg font-bold text-navy-900 dark:text-white">Attendance Marked Successfully</p>
                <p className="text-sm text-navy-500 dark:text-navy-400">All records saved and synced to the database.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Date picker with day name */}
        <Card className="border-emerald-500/30">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="text-xs font-medium text-navy-600 dark:text-navy-300 block mb-1">Attendance Date</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={pendingAttDate}
                    onChange={(e) => setPendingAttDate(e.target.value)}
                    className="w-48"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={pendingAttDate === selectedAttDate}
                    onClick={applyPendingAttDate}
                  >
                    Apply
                  </Button>
                </div>
              </div>
              <div className="pb-1">
                <p className="text-base font-semibold text-navy-900 dark:text-white">
                  {new Date(selectedAttDate + "T12:00:00").toLocaleDateString("en-GB", {
                    weekday: "long", day: "2-digit", month: "long", year: "numeric"
                  })}
                </p>
                <p className="text-xs text-navy-400 dark:text-navy-500 mt-0.5">
                  Only this date is editable. Pick another date and click Apply to edit it instead.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Late-tracking hint — the Arrival column lives inside the grid below */}
        {trackLate && (
          <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
            <Clock className="size-3.5 mt-0.5 shrink-0" />
            <span>
              {courseTitle} starts at <span className="font-semibold">{formatTime12h(programStart)}</span>.
              Type each student&apos;s arrival time in the <span className="font-semibold">Arrival</span> column —
              anyone after the start time is automatically marked <span className="font-semibold">Late (L)</span>.
            </span>
          </div>
        )}

        {/* Attendance grid */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-navy-50 dark:bg-navy-800/50">
                    <th className="sticky left-0 z-10 bg-navy-50 dark:bg-navy-800 px-2 py-2 text-left font-medium text-navy-600 dark:text-navy-300 border-b border-r min-w-[40px]">Sl No</th>
                    <th className="sticky left-[40px] z-10 bg-navy-50 dark:bg-navy-800 px-2 py-2 text-left font-medium text-navy-600 dark:text-navy-300 border-b border-r w-[140px] min-w-[140px] max-w-[140px]">Student Name</th>
                    {days.map((d) => (
                      <Fragment key={d}>
                        <th className={cn(
                          "px-1 py-2 text-center font-medium border-b min-w-[32px]",
                          d === selectedDay ? "bg-emerald-500 text-white" : "text-navy-600 dark:text-navy-300"
                        )}>
                          {d}
                        </th>
                        {trackLate && d === selectedDay && (
                          <th className="bg-navy-50 dark:bg-navy-800 px-2 py-2 text-left font-medium text-amber-600 dark:text-amber-400 border-b border-r border-l-2 border-l-emerald-500 w-[124px] min-w-[124px]" title="Arrival time for the selected date">
                            Arrival
                          </th>
                        )}
                      </Fragment>
                    ))}
                    <th className="px-2 py-2 text-center font-medium text-emerald-600 dark:text-emerald-400 border-b border-l min-w-[32px]">P</th>
                    {trackLate && <th className="px-2 py-2 text-center font-medium text-amber-500 border-b min-w-[32px]">L</th>}
                    <th className="px-2 py-2 text-center font-medium text-red-500 border-b min-w-[32px]">A</th>
                  </tr>
                </thead>
                <tbody>
                  {cls.students.map((student, si) => {
                    const summary = getMonthSummary(student.id)
                    return (
                      <tr key={student.id} className={cn("border-b last:border-0", si % 2 === 0 ? "" : "bg-navy-50/50 dark:bg-navy-800/20")}>
                        <td className="sticky left-0 z-10 bg-white dark:bg-navy-900 px-2 py-2 text-navy-500 dark:text-navy-400 font-mono border-r">{si + 1}</td>
                        <td className="sticky left-[40px] z-10 bg-white dark:bg-navy-900 px-2 py-2 font-medium text-navy-900 dark:text-white border-r whitespace-nowrap truncate w-[140px] min-w-[140px] max-w-[140px]">{student.name}</td>
                        {days.map((d) => {
                          const status = getStatus(student.id, d)
                          const future = isFutureDay(d)
                          const editable = isEditableDay(d)
                          const cellArrival = getArrival(student.id, d)
                          const cellTitle =
                            status === "late" && cellArrival
                              ? `Late — arrived ${formatTime12h(cellArrival)}`
                              : status === "present" && cellArrival
                                ? `On time — arrived ${formatTime12h(cellArrival)}`
                                : undefined
                          return (
                            <Fragment key={d}>
                              <td className="p-0.5">
                                <div
                                  onClick={() => toggleStatus(student.id, d)}
                                  title={cellTitle}
                                  className={cn(
                                    "flex items-center justify-center w-7 h-7 border rounded select-none text-[10px] font-bold transition-all",
                                    d === selectedDay ? "ring-2 ring-emerald-500" : "",
                                    future
                                      ? "bg-navy-50 dark:bg-navy-800/30 border-navy-200 dark:border-navy-700 text-navy-300 dark:text-navy-600 cursor-default"
                                      : editable
                                        ? status === "present"
                                          ? "bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-600 text-emerald-700 dark:text-emerald-400 cursor-pointer"
                                          : status === "late"
                                            ? "bg-amber-50 dark:bg-amber-500/15 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400 cursor-pointer"
                                          : status === "absent"
                                            ? "bg-red-50 dark:bg-red-500/15 border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 cursor-pointer"
                                            : "bg-white dark:bg-navy-900 border-navy-200 dark:border-navy-700 text-navy-300 dark:text-navy-600 cursor-pointer"
                                        : status === "present"
                                          ? "bg-emerald-50/50 dark:bg-emerald-500/5 border-emerald-200 dark:border-emerald-800 text-emerald-500/70 dark:text-emerald-600 cursor-default"
                                          : status === "late"
                                            ? "bg-amber-50/50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-800 text-amber-500/70 dark:text-amber-600 cursor-default"
                                          : status === "absent"
                                            ? "bg-red-50/50 dark:bg-red-500/5 border-red-200 dark:border-red-800 text-red-400/70 dark:text-red-700 cursor-default"
                                            : "bg-navy-25 dark:bg-navy-800/20 border-navy-100 dark:border-navy-800 text-navy-200 dark:text-navy-700 cursor-default"
                                  )}
                                >
                                  {status === "present" ? "P" : status === "late" ? "L" : status === "absent" ? "A" : "-"}
                                </div>
                              </td>
                              {trackLate && d === selectedDay && (
                                <td className="bg-white dark:bg-navy-900 px-2 py-1.5 border-r border-l-2 border-l-emerald-500/40 align-middle">
                                  {editable ? (
                                    <div className="flex flex-col gap-0.5">
                                      <ArrivalTimeInput
                                        value={cellArrival}
                                        programStart={programStart ?? ""}
                                        onCommit={(v) => setArrivalTime(student.id, v)}
                                        ariaLabel={`Arrival time for ${student.name}`}
                                      />
                                      {cellArrival && (
                                        <span className={cn(
                                          "text-[9px] font-semibold leading-none",
                                          status === "late" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400",
                                        )}>
                                          {status === "late"
                                            ? `Late · ${formatMinutesLate(computeLateness(courseTitle, cellArrival)?.minutesLate ?? 0)}`
                                            : "On time"}
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-navy-400">{cellArrival ? formatTime12h(cellArrival) : "—"}</span>
                                  )}
                                </td>
                              )}
                            </Fragment>
                          )
                        })}
                        <td className="px-2 py-2 text-center font-semibold text-emerald-600 dark:text-emerald-400 border-l">{summary.present}</td>
                        {trackLate && <td className="px-2 py-2 text-center font-semibold text-amber-500">{summary.late}</td>}
                        <td className="px-2 py-2 text-center font-semibold text-red-500">{summary.absent}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Submit + Reset — BELOW the grid */}
        <Card className="border-emerald-500/30">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-500 px-8 py-2.5 text-sm font-semibold"
                onClick={() => handleSaveMonthlyAttendance(view.courseId, view.classId)}
                disabled={attendanceSaving}
              >
                <Save className="size-4 mr-2" /> {attendanceSaving ? "Saving…" : "Submit Attendance"}
              </Button>
              <Button variant="outline" disabled={attendanceSaving} onClick={async () => {
                const dateLabel = new Date(selectedAttDate + "T12:00:00").toLocaleDateString("en-GB", {
                  weekday: "long", day: "numeric", month: "long", year: "numeric",
                })
                const confirmed = window.confirm(
                  `Clear ALL attendance for ${cls.name} on ${dateLabel}?\n\n` +
                  `This permanently erases every Present, Absent and Late mark and all arrival times recorded for this class on this date — for every student. This cannot be undone.`,
                )
                if (!confirmed) return
                setAttendanceSaving(true)
                if (useSupabase) {
                  const { error } = await db.deleteAttendanceForDate(view.classId, selectedAttDate)
                  if (error) { toast.error("Failed to clear attendance from the database"); setAttendanceSaving(false); return }
                }
                setMonthAttendance((prev) => ({ ...prev, [selectedAttDate]: {} }))
                setMonthArrival((prev) => ({ ...prev, [selectedAttDate]: {} }))
                saveCourses((prev) => prev.map((course) => ({
                  ...course,
                  classes: course.classes.map((c) =>
                    c.id === view.classId
                      ? { ...c, attendance: c.attendance.filter((a) => a.date !== selectedAttDate) }
                      : c,
                  ),
                })))
                setAttendanceSaving(false)
                toast.success(`Attendance cleared for ${dateLabel}`)
              }} className="px-6">
                <RefreshCw className="size-4 mr-2" /> Reset
              </Button>
            </div>
            <p className="mt-2 text-xs text-navy-400 dark:text-navy-500">
              Submit saves all changes to the database permanently. Reset erases this date&apos;s attendance for the whole class.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: GRADE BOOK — moved to /dashboard/assessment
  // The legacy inline grade book has been replaced by the unified
  // Grade Book module. This branch redirects.
  // ══════════════════════════════════════════════════════════
  if (view.page === "gradebook") {
    if (typeof window !== "undefined") router.replace("/dashboard/assessment")
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Award className="size-12 text-indigo-400 mb-3" />
        <p className="text-navy-700 dark:text-navy-200 font-semibold mb-1">Opening Grade Book…</p>
        <p className="text-sm text-navy-500 dark:text-navy-400 mb-4">
          The grade book has moved to the unified module.
        </p>
        <Button onClick={() => router.push("/dashboard/assessment")}>
          Go to Grade Book
        </Button>
      </div>
    )
  }

  return (
    <>
      {/* Transfer Student Modal */}
      {transferStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-navy-800 shadow-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <ArrowRightLeft className="size-5 text-sky-500" />
              <h2 className="text-lg font-bold text-navy-900 dark:text-white">Transfer Student</h2>
            </div>
            <p className="text-sm text-navy-600 dark:text-navy-300 mb-1">
              <span className="font-semibold text-navy-900 dark:text-white">{transferStudent.name}</span>
            </p>
            <p className="text-xs text-navy-400 mb-4">
              Current class: <span className="font-medium">{transferStudent.currentClass}</span>
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-navy-400 block mb-1">Destination Course</label>
                <select
                  value={transferDestCourseId}
                  onChange={(e) => { setTransferDestCourseId(e.target.value); setTransferDestClassId("") }}
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm"
                >
                  <option value="">— Select course —</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              {transferDestCourseId && (
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-navy-400 block mb-1">Destination Class</label>
                  <select
                    value={transferDestClassId}
                    onChange={(e) => setTransferDestClassId(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm"
                  >
                    <option value="">— Select class —</option>
                    {(courses.find((c) => c.id === transferDestCourseId)?.classes ?? []).map((cl) => (
                      <option key={cl.id} value={cl.id}>{cl.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <Button
                className="bg-sky-500 text-white hover:bg-sky-400 flex-1"
                disabled={!transferDestClassId || transferring}
                onClick={handleTransfer}
              >
                <ArrowRightLeft className="size-4 mr-1" />
                {transferring ? "Transferring…" : "Transfer"}
              </Button>
              <Button variant="outline" onClick={() => setTransferStudent(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Staff Directory ────────────────────────────────────────
type DbStaffRow = {
  id: string
  name: string
  email: string | null
  fingerprint_device_id: number | null
  pay_type: string
  dual_pay_type: string | null
  transport_allowance: boolean
}

function StaffDirectory() {
  const [open, setOpen] = useState(true)
  const [query, setQuery] = useState("")
  const [dbStaff, setDbStaff] = useState<DbStaffRow[]>([])
  const [loginAccounts, setLoginAccounts] = useState<{ name: string; email: string }[]>([])
  const { disabledIds } = useDisabledTeachers()

  // Fetch live staff from staff_members table (written by /api/add-staff)
  useEffect(() => {
    supabase
      .from("staff_members")
      .select("id,name,email,fingerprint_device_id,pay_type,dual_pay_type,transport_allowance")
      .then(({ data }) => { if (data) setDbStaff(data as DbStaffRow[]) })
  }, [])

  // Fetch login accounts (Supabase auth) to fill in each staff member's email
  // from their login credentials. Restricted to admin/accountant; for other
  // roles the request 403s and we simply fall back to staff_members emails.
  useEffect(() => {
    authFetch("/api/admin/users")
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        if (json?.users) {
          setLoginAccounts(
            (json.users as { name?: string; email?: string }[])
              .filter(u => u.email && u.email.includes("@"))
              .map(u => ({ name: u.name ?? "", email: u.email! }))
          )
        }
      })
      .catch(() => { /* not permitted for this role — staff_members emails only */ })
  }, [])

  // Build ZK IDs already covered by the static list
  const staticZkIds = useMemo(
    () => new Set(Object.values(TEACHER_TO_ZK)),
    []
  )

  // Email lookup for static teachers — the hardcoded list carries no email,
  // so resolve it from the live staff_members table by ZK device id, then name.
  const emailByZk = useMemo(() => {
    const m = new Map<number, string>()
    dbStaff.forEach(d => { if (d.fingerprint_device_id !== null && d.email) m.set(d.fingerprint_device_id, d.email) })
    return m
  }, [dbStaff])
  const emailByName = useMemo(() => {
    const m = new Map<string, string>()
    dbStaff.forEach(d => { if (d.email) m.set(d.name.trim().toLowerCase(), d.email) })
    return m
  }, [dbStaff])
  // Login-account email keyed by account name, for the explicit overrides.
  const emailByLoginName = useMemo(() => {
    const m = new Map<string, string>()
    loginAccounts.forEach(a => { if (a.email) m.set(loginKey(a.name), a.email) })
    return m
  }, [loginAccounts])
  // Set of login emails actually visible to this admin, used to gate the
  // email-pinned overrides so they never render for non-admin viewers.
  const loginEmailSet = useMemo(
    () => new Set(loginAccounts.map(a => a.email.toLowerCase())),
    [loginAccounts],
  )

  // Merge: static teachers + DB-only teachers (not in static list)
  const allRows = useMemo(() => {
    const staticRows = initialTeachers.map(t => ({
      id:          t.id,
      name:        t.name,
      email:       (TEACHER_TO_ZK[t.id] != null ? emailByZk.get(TEACHER_TO_ZK[t.id]) : undefined)
                     ?? emailByName.get(t.name.trim().toLowerCase())
                     ?? (LOGIN_ACCOUNT_BY_TEACHER[t.id] ? emailByLoginName.get(loginKey(LOGIN_ACCOUNT_BY_TEACHER[t.id])) : undefined)
                     ?? (LOGIN_EMAIL_BY_TEACHER[t.id] && loginEmailSet.has(LOGIN_EMAIL_BY_TEACHER[t.id].toLowerCase()) ? LOGIN_EMAIL_BY_TEACHER[t.id] : undefined)
                     ?? null as string | null,
      zkId:        TEACHER_TO_ZK[t.id] ?? null,
      program:     formatProgram(t.payType),
      dualProgram: t.dualPayType ? formatProgram(t.dualPayType) : null,
      transport:   t.transportAllowance,
      disabled:    disabledIds.has(t.id),
      isNew:       false,
    }))

    // DB teachers whose ZK ID is NOT already in the static list
    const dbOnlyRows = dbStaff
      .filter(d => d.fingerprint_device_id !== null && !staticZkIds.has(d.fingerprint_device_id!))
      .map(d => ({
        id:          d.id,
        name:        d.name,
        email:       d.email as string | null,
        zkId:        d.fingerprint_device_id,
        program:     formatProgram(d.pay_type),
        dualProgram: d.dual_pay_type ? formatProgram(d.dual_pay_type) : null,
        transport:   d.transport_allowance,
        disabled:    disabledIds.has(d.id),
        isNew:       true, // badge to distinguish onboarded-only teachers
      }))

    const merged = [...staticRows, ...dbOnlyRows]

    // Fill any still-missing email from the matching login account.
    const loginEmails = assignLoginEmails(merged, loginAccounts)
    merged.forEach(r => { if (!r.email) r.email = loginEmails.get(r.id) ?? null })

    return merged.sort((a, b) => a.name.localeCompare(b.name))
  }, [dbStaff, staticZkIds, emailByZk, emailByName, emailByLoginName, loginEmailSet, loginAccounts, disabledIds])

  const rows = allRows.filter(r =>
    !query ||
    r.name.toLowerCase().includes(query.toLowerCase()) ||
    r.id.toLowerCase().includes(query.toLowerCase()) ||
    (r.zkId !== null && String(r.zkId).includes(query)) ||
    r.program.toLowerCase().includes(query.toLowerCase()) ||
    (!!r.email && r.email.toLowerCase().includes(query.toLowerCase()))
  )

  // Active staff first; disabled (left Ihlamudheen Madrasa) collected at the bottom under
  // a "Non-Active" heading so they are not mistaken for current staff.
  const activeRows = rows.filter(r => !r.disabled)
  const inactiveRows = rows.filter(r => r.disabled)

  const renderStaffRow = (r: (typeof allRows)[number], sl: number) => (
    <tr key={r.id} className={cn("hover:bg-muted/30 transition-colors", r.disabled && "opacity-60")}>
      <td className="px-3 py-2 text-muted-foreground">{sl}</td>
      <td className="px-3 py-2 font-medium text-navy-900 dark:text-white">
        {r.name}
        {r.disabled && <span className="ml-1.5 text-[9px] bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded px-1 py-0.5 font-semibold uppercase">Disabled</span>}
        {r.transport && <span className="ml-1.5 text-[9px] bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 rounded px-1 py-0.5 font-semibold">🚌</span>}
        {r.isNew && !r.disabled && <span className="ml-1.5 text-[9px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 rounded px-1 py-0.5 font-semibold">NEW</span>}
      </td>
      <td className="px-3 py-2 text-center">
        <span className="font-mono font-bold text-gold-600 dark:text-gold-400 bg-gold-50 dark:bg-gold-900/20 px-2 py-0.5 rounded">
          {r.id}
        </span>
      </td>
      <td className="px-3 py-2 text-center">
        {r.zkId !== null
          ? <span className="font-mono font-semibold text-violet-600 dark:text-violet-400">{r.zkId}</span>
          : <span className="text-muted-foreground">—</span>
        }
      </td>
      <td className="px-3 py-2">
        {r.email
          ? <a href={`mailto:${r.email}`} className="font-mono text-[11px] text-navy-600 dark:text-navy-300 hover:text-gold-600 dark:hover:text-gold-400 hover:underline break-all">{r.email}</a>
          : <span className="text-muted-foreground">—</span>
        }
      </td>
      <td className="px-3 py-2 text-navy-600 dark:text-navy-300">
        {r.program}
        {r.dualProgram && (
          <span className="ml-1.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 rounded px-1.5 py-0.5">
            + {r.dualProgram}
          </span>
        )}
      </td>
    </tr>
  )

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <button
        type="button"
        className="w-full text-left"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-gold-500" />
            <span className="font-semibold text-sm text-navy-900 dark:text-white">Staff Directory</span>
            <span className="text-xs text-muted-foreground">
              ({allRows.length} staff{allRows.some(r => r.disabled) && <> · {allRows.filter(r => r.disabled).length} non-active</>})
            </span>
          </div>
          <ChevronDownIcon className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div>
          {/* Search */}
          <div className="px-4 py-2 border-b border-border/40">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by name, ID or email…"
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-gold-400"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-navy-50/40 dark:bg-navy-800/30 border-b border-border/40">
                  <th className="px-3 py-2 text-left font-semibold text-navy-500 uppercase tracking-wider w-12">SL No</th>
                  <th className="px-3 py-2 text-left font-semibold text-navy-500 uppercase tracking-wider">Name</th>
                  <th className="px-3 py-2 text-center font-semibold text-navy-500 uppercase tracking-wider w-20">System ID</th>
                  <th className="px-3 py-2 text-center font-semibold text-navy-500 uppercase tracking-wider w-20">ID</th>
                  <th className="px-3 py-2 text-left font-semibold text-navy-500 uppercase tracking-wider">Email</th>
                  <th className="px-3 py-2 text-left font-semibold text-navy-500 uppercase tracking-wider">Program</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {activeRows.map((r, i) => renderStaffRow(r, i + 1))}

                {inactiveRows.length > 0 && (
                  <tr className="bg-red-50/60 dark:bg-red-900/15 border-y border-red-200/60 dark:border-red-800/40">
                    <td colSpan={6} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
                      Non-Active ({inactiveRows.length})
                    </td>
                  </tr>
                )}
                {inactiveRows.map((r, i) => renderStaffRow(r, activeRows.length + i + 1))}

                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      No staff match &ldquo;{query}&rdquo;
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  )
}

// Tiny helper for the expanded student profile panel
function ProfileField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-navy-400 mb-0.5">{label}</p>
      <p className={cn(
        "text-xs text-navy-700 dark:text-navy-200 break-words",
        mono && "font-mono",
        value === "—" && "text-navy-400 italic"
      )}>{value}</p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Bulk Parent Import slide-over
//
// Paste a spreadsheet (Excel / Google Sheets / CSV / TSV). Auto-detects
// the delimiter and column headers. Matches each row to a student by
// id (preferred) or name (case-insensitive fallback). Shows a preview
// table with status per row, then writes everything to Supabase in one
// click via db.bulkUpdateStudentProfiles.
//
// Recognised header aliases (any one is enough):
//   id          → id, roll, roll no, roll number, student id
//   name        → name, student, student name
//   gender      → gender, sex
//   fatherName  → father, father name, father's name, dad
//   motherName  → mother, mother name, mother's name, mom
//   fatherPhone → father phone, dad phone, father contact, father mobile
//   motherPhone → mother phone, mom phone, mother contact, mother mobile
// ═══════════════════════════════════════════════════════════════════

type ImportRow = {
  rawIndex: number          // 0-based index in pasted data (excluding header)
  id?: string
  name?: string
  gender?: string
  fatherName?: string
  motherName?: string
  fatherPhone?: string
  motherPhone?: string
  matchStudentId?: string   // resolved DB student id
  matchStudentName?: string
  matchClassName?: string
  status: "matched" | "matched-by-name" | "no-match" | "ambiguous"
}

const HEADER_ALIASES: Record<string, keyof ImportRow> = {
  id: "id", "student id": "id", roll: "id", "roll no": "id", "roll number": "id", "rollno": "id", "#": "id",
  "reg no": "id", "register no": "id", "register number": "id", "regno": "id",
  name: "name", student: "name", "student name": "name",
  gender: "gender", sex: "gender", g: "gender",
  father: "fatherName", "father name": "fatherName", "father's name": "fatherName", "fathers name": "fatherName", dad: "fatherName",
  mother: "motherName", "mother name": "motherName", "mother's name": "motherName", "mothers name": "motherName", mom: "motherName",
  "father phone": "fatherPhone", "dad phone": "fatherPhone", "father contact": "fatherPhone", "father mobile": "fatherPhone", "father no": "fatherPhone", "father number": "fatherPhone",
  "mother phone": "motherPhone", "mom phone": "motherPhone", "mother contact": "motherPhone", "mother mobile": "motherPhone", "mother no": "motherPhone", "mother number": "motherPhone",
}

function detectDelimiter(line: string): string {
  const tabs = (line.match(/\t/g) ?? []).length
  const commas = (line.match(/,/g) ?? []).length
  if (tabs >= commas) return "\t"
  return ","
}

function splitCSVLine(line: string, delim: string): string[] {
  if (delim === "\t") return line.split("\t").map((c) => c.trim())
  // Simple CSV: handle quoted fields containing commas
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = !inQuotes }
    } else if (ch === delim && !inQuotes) {
      out.push(cur.trim()); cur = ""
    } else {
      cur += ch
    }
  }
  out.push(cur.trim())
  return out
}

function parsePastedData(
  raw: string,
  knownStudents: Array<{ id: string; name: string; className?: string }>,
): { rows: ImportRow[]; headers: string[]; warning?: string } {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { rows: [], headers: [], warning: "Nothing pasted" }

  const delim = detectDelimiter(lines[0])
  const headerCells = splitCSVLine(lines[0], delim).map((h) => h.toLowerCase().replace(/[._]/g, " ").trim())

  // Map columns → ImportRow field
  const colMap: Record<number, keyof ImportRow> = {}
  headerCells.forEach((h, i) => {
    const target = HEADER_ALIASES[h]
    if (target) colMap[i] = target
  })

  // If no headers were recognised, treat the first row as data and apply
  // a reasonable default column order: id, name, gender, father, mother,
  // father phone, mother phone
  const hasHeaders = Object.keys(colMap).length > 0
  const dataLines = hasHeaders ? lines.slice(1) : lines
  const defaultCols: (keyof ImportRow)[] = ["id", "name", "gender", "fatherName", "motherName", "fatherPhone", "motherPhone"]

  // Build name lookup (lowercased, normalised whitespace)
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")
  const byId = new Map<string, { id: string; name: string; className?: string }>()
  const byName = new Map<string, { id: string; name: string; className?: string }[]>()
  knownStudents.forEach((st) => {
    byId.set(st.id, st)
    const k = norm(st.name)
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k)!.push(st)
  })

  const rows: ImportRow[] = dataLines.map((line, idx) => {
    const cells = splitCSVLine(line, delim)
    const row: ImportRow = { rawIndex: idx, status: "no-match" }
    cells.forEach((c, i) => {
      const target = hasHeaders ? colMap[i] : defaultCols[i]
      if (!target) return
      if (!c) return
      // The id field is special — we want it as-is (string match)
      ;(row as Record<string, unknown>)[target] = c.trim()
    })

    // Resolve match
    if (row.id) {
      const m = byId.get(row.id)
      if (m) {
        row.matchStudentId = m.id
        row.matchStudentName = m.name
        row.matchClassName = m.className
        row.status = "matched"
      }
    }
    if (!row.matchStudentId && row.name) {
      const cands = byName.get(norm(row.name)) ?? []
      if (cands.length === 1) {
        row.matchStudentId = cands[0].id
        row.matchStudentName = cands[0].name
        row.matchClassName = cands[0].className
        row.status = "matched-by-name"
      } else if (cands.length > 1) {
        row.status = "ambiguous"
      }
    }
    return row
  })

  return { rows, headers: hasHeaders ? headerCells : defaultCols.slice(0, splitCSVLine(lines[0], delim).length) }
}

function BulkParentImport({
  allStudents,
  onClose,
  onImported,
}: {
  allStudents: Array<{ id: string; name: string; className: string }>
  onClose: () => void
  onImported: () => void
}) {
  const [raw, setRaw] = useState("")
  const [importing, setImporting] = useState(false)
  const parsed = raw.trim() ? parsePastedData(raw, allStudents) : null
  const importable = parsed?.rows.filter((r) => r.matchStudentId) ?? []
  const skipped = parsed?.rows.filter((r) => !r.matchStudentId) ?? []

  const sample = `id\tname\tgender\tfather\tmother\tfather phone\tmother phone
101\tStudent One\tMale\tFather Name\tMother Name\t9000000000\t
102\tStudent Two\tFemale\tFather Name\tMother Name\t9000000000\t9000000001`

  async function doImport() {
    if (!parsed || importable.length === 0) return
    setImporting(true)
    // Send only the fields the user actually provided — empty cells stay
    // empty in the DB (we promised "won't overwrite with blanks" in the UI).
    const payload = importable.map((r) => {
      const row: {
        id: string
        gender?: string
        fatherName?: string
        motherName?: string
        fatherPhone?: string
        motherPhone?: string
      } = { id: r.matchStudentId! }
      if (r.gender) row.gender = r.gender
      if (r.fatherName) row.fatherName = r.fatherName
      if (r.motherName) row.motherName = r.motherName
      if (r.fatherPhone) row.fatherPhone = r.fatherPhone
      if (r.motherPhone) row.motherPhone = r.motherPhone
      return row
    })
    const res = await db.bulkUpdateStudentProfiles(payload)
    setImporting(false)
    if (res.failed > 0) {
      console.error("Bulk import errors:", res.errors)
      toast.error(`Imported ${res.updated}, ${res.failed} failed — check console`)
    } else {
      toast.success(`Imported ${res.updated} student profile${res.updated === 1 ? "" : "s"}`)
    }
    onImported()
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        onClick={onClose}
        className="fixed inset-0 bg-navy-950/70 backdrop-blur-[3px] z-[199]"
      />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}
        className="fixed top-0 right-0 bottom-0 z-[200] w-full sm:w-[640px] bg-card border-l border-border shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <div className="size-9 rounded-lg bg-gold-500/10 flex items-center justify-center shrink-0">
            <UserPlus className="size-4 text-gold-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-navy-900 dark:text-white">Bulk Parent Import</h2>
            <p className="text-xs text-navy-400 mt-0.5">Paste a spreadsheet to update many students at once</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-md hover:bg-navy-100 dark:hover:bg-navy-800">
            <ChevronRight className="size-4 text-navy-500 rotate-180" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-navy-400 mb-2">
              Paste from Excel / Google Sheets / CSV
            </label>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={sample}
              rows={10}
              className="w-full p-3 rounded-md border border-input bg-background text-xs font-mono whitespace-pre overflow-x-auto focus:outline-none focus:ring-2 focus:ring-gold-500/40"
            />
            <div className="mt-2 flex items-start gap-2 text-[10.5px] text-navy-400">
              <Sparkles className="size-3 shrink-0 mt-0.5 text-gold-500" />
              <p>
                Headers are auto-detected. Recognised: <span className="font-mono">id</span>,{" "}
                <span className="font-mono">name</span>, <span className="font-mono">gender</span>,{" "}
                <span className="font-mono">father</span>, <span className="font-mono">mother</span>,{" "}
                <span className="font-mono">father phone</span>, <span className="font-mono">mother phone</span>.
                Empty cells are kept as-is (won&apos;t overwrite existing data with blanks).
              </p>
            </div>
          </div>

          {/* Quick load sample */}
          {!raw.trim() && (
            <button
              onClick={() => setRaw(sample)}
              className="text-[11px] text-gold-500 hover:underline"
            >
              Load sample data ↗
            </button>
          )}

          {/* Preview */}
          {parsed && (
            <div className="rounded-lg border border-border bg-background">
              <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                <p className="text-xs font-bold text-navy-700 dark:text-navy-200">
                  Preview · {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}
                </p>
                <div className="flex gap-1.5 text-[10px]">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-bold">
                    {importable.length} ready
                  </span>
                  {skipped.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 font-bold">
                      {skipped.length} unmatched
                    </span>
                  )}
                </div>
              </div>
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-navy-50 dark:bg-navy-950 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wider text-navy-400">Status</th>
                      <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wider text-navy-400">Student</th>
                      <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wider text-navy-400">Gender</th>
                      <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wider text-navy-400">Father</th>
                      <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wider text-navy-400">Mother</th>
                      <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wider text-navy-400">Phones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.map((r) => {
                      const ok = !!r.matchStudentId
                      return (
                        <tr key={r.rawIndex} className={cn("border-t border-border/50", !ok && "bg-red-500/5")}>
                          <td className="px-2 py-1.5">
                            {r.status === "matched" && (
                              <span className="text-[9px] font-bold uppercase text-emerald-500">match</span>
                            )}
                            {r.status === "matched-by-name" && (
                              <span className="text-[9px] font-bold uppercase text-blue-500" title="Matched by name (id missing or didn't match)">name</span>
                            )}
                            {r.status === "no-match" && (
                              <span className="text-[9px] font-bold uppercase text-red-500" title="No student found with this id or name">no match</span>
                            )}
                            {r.status === "ambiguous" && (
                              <span className="text-[9px] font-bold uppercase text-amber-500" title="Multiple students with this name — please add an id column">ambig</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 max-w-[140px]">
                            {ok ? (
                              <>
                                <p className="font-medium text-navy-900 dark:text-white truncate">{r.matchStudentName}</p>
                                <p className="text-[9px] text-navy-400">{r.matchClassName} · #{r.matchStudentId}</p>
                              </>
                            ) : (
                              <p className="text-navy-500 italic truncate">{r.name || r.id || "(blank)"}</p>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-navy-700 dark:text-navy-300">{r.gender || "—"}</td>
                          <td className="px-2 py-1.5 text-navy-700 dark:text-navy-300 max-w-[120px] truncate">{r.fatherName || "—"}</td>
                          <td className="px-2 py-1.5 text-navy-700 dark:text-navy-300 max-w-[120px] truncate">{r.motherName || "—"}</td>
                          <td className="px-2 py-1.5 text-[10px] font-mono text-navy-500 dark:text-navy-400">
                            {r.fatherPhone && <div>F: {r.fatherPhone}</div>}
                            {r.motherPhone && <div>M: {r.motherPhone}</div>}
                            {!r.fatherPhone && !r.motherPhone && "—"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-background/60 flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={importing} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={doImport}
            disabled={importing || importable.length === 0}
            className="flex-[2] bg-gold-500 hover:bg-gold-600 text-navy-950 font-semibold gap-2"
          >
            <Save className="size-4" />
            {importing ? "Importing…" : `Import ${importable.length} student${importable.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </motion.div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ExportDropdown — single-click access to CSV / Excel / Sheets / PDF
// Shared between course-level and per-class header.
// ═══════════════════════════════════════════════════════════════════
function ExportDropdown({
  onExport,
  label = "Export",
  size,
}: {
  onExport: (fmt: ExportFormat) => void
  label?: string
  size?: "sm" | "default"
}) {
  // Base UI's Trigger renders a <button> by default — using className
  // directly avoids the render-prop quirks we saw with the Button
  // component swallowing the click.
  const triggerClass = cn(
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
    "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "disabled:opacity-50 disabled:pointer-events-none",
    size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-3.5 text-sm"
  )

  const items: Array<{ fmt: ExportFormat; label: string; sub: string; color: string }> = [
    { fmt: "csv", label: "CSV", sub: "Universal text format", color: "text-emerald-500" },
    { fmt: "excel", label: "Excel (.xls)", sub: "Opens in Microsoft Excel", color: "text-green-600" },
    { fmt: "sheets", label: "Google Sheets", sub: "CSV ready for Sheets import", color: "text-blue-500" },
    { fmt: "pdf", label: "PDF", sub: "Print-ready letterhead view", color: "text-red-500" },
  ]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={triggerClass}
        title="Download student list in CSV, Excel, Google Sheets, or PDF"
      >
        <Download className="size-4" />
        <span>{label}</span>
        <ChevronDown className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[230px] p-1">
        {items.map((it) => (
          <DropdownMenuItem
            key={it.fmt}
            onClick={() => onExport(it.fmt)}
            className="cursor-pointer py-2"
          >
            <FileText className={cn("size-4 mr-2.5 shrink-0", it.color)} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-tight">{it.label}</p>
              <p className="text-[10.5px] text-muted-foreground leading-tight mt-0.5">{it.sub}</p>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
