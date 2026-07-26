"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import {
  ClipboardList, Loader2, Plus, Trash2, Save, Lock, FileDown,
  Clock, Wallet, Film, Megaphone, Users, BookUp, CheckCircle2, Circle,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import * as db from "@/lib/db"
import { getLessonPlanUrl } from "@/lib/storage"
import type { Student, ClassData, AttendanceRecord, TeacherData } from "@/data/courses"
import { initialTeachers } from "@/data/courses"
import { useDisabledTeachers } from "@/hooks/use-disabled-teachers"
import { toast } from "sonner"

// The four institute courses (exact ids/titles from src/data/courses.ts).
const COURSES: { id: string; title: string }[] = [
  { id: "4", title: "Ihlamudheen Madrasa" },
  { id: "1", title: "Ihlamudheen Madrasa" },
  { id: "2", title: "Ihlamudheen Madrasa" },
  { id: "3", title: "CIBIS CERTIFICATION" },
]

// Pre-submit checklist — the report can only be submitted once every section
// has been reviewed and ticked. Keys mirror the tab `value`s below so the
// checklist reads in the same order as the tabs.
type ChecklistKey = "attendance" | "finance" | "duties" | "marketing" | "lessons" | "assignments"
const CHECKLIST_ITEMS: { key: ChecklistKey; label: string; icon: typeof Clock }[] = [
  { key: "attendance", label: "Attendance", icon: Clock },
  { key: "finance", label: "Finance", icon: Wallet },
  { key: "duties", label: "Course duties", icon: ClipboardList },
  { key: "marketing", label: "Marketing", icon: Film },
  { key: "lessons", label: "Lesson plans", icon: BookUp },
  { key: "assignments", label: "Assignments", icon: Users },
]
const emptyChecklist = (): Record<ChecklistKey, boolean> =>
  ({ attendance: false, finance: false, duties: false, marketing: false, lessons: false, assignments: false })

// Default daily duties per course (data-driven; admins can adjust later).
const DUTY_TEMPLATES: Record<string, string[]> = {
  "4": ["Tuition sessions followed up", "Subject teachers coordinated", "EDU support hours log updated"],
  "1": ["Class registers verified", "Teacher coordination done", "Parent follow-up calls made"],
  "2": ["Class registers verified", "Teacher coordination done", "Parent follow-up calls made"],
  "3": ["Batch attendance verified", "Certification progress updated"],
}

// Local calendar date (NOT UTC) — matches how attendance dates are stored and
// how the dashboard computes "today", so the day's records line up.
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// Which weekdays each course runs (getDay(): 0=Sun … 6=Sat).
//   EDU Support → Mon–Fri · Malayalam Madrasa → Sat/Sun · English & CIBIS → Fri
const COURSE_DAYS: Record<string, number[]> = {
  "4": [1, 2, 3, 4, 5],
  "1": [6, 0],
  "2": [5],
  "3": [5],
}
const DAY_TOKENS: [string, number][] = [
  ["sunday", 0], ["monday", 1], ["tuesday", 2], ["wednesday", 3],
  ["thursday", 4], ["friday", 5], ["saturday", 6],
]

function courseRunsToday(courseId: string, dow: number): boolean {
  return (COURSE_DAYS[courseId] || []).includes(dow)
}

// A class meets today when its named weekday matches (madrasa/CIBIS classes name
// a specific day), falling back to its course's general schedule. EDU Support
// runs every weekday regardless of how its schedule text reads.
function classMeetsToday(courseId: string, schedule: string, dow: number): boolean {
  if (courseId === "4") return dow >= 1 && dow <= 5
  const sched = (schedule || "").toLowerCase()
  const named = DAY_TOKENS.filter(([n]) => sched.includes(n)).map(([, d]) => d)
  if (named.length) return named.includes(dow)
  return courseRunsToday(courseId, dow)
}

function weekStartISO(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  const day = (d.getDay() + 6) % 7 // Monday = 0
  d.setDate(d.getDate() - day)
  return d.toISOString().split("T")[0]
}

function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00")
  d.setDate(d.getDate() + days)
  return d.toISOString().split("T")[0]
}

// The week runs Monday (weekStart) → Sunday (weekStart + 6).
const weekEndISO = (weekStart: string) => addDaysISO(weekStart, 6)

// Staff arrival lateness category, mirroring db.approveAttendanceRequest:
//   <08:55 present · 08:55–08:59 → Cat 1 · 09:00–09:05 → Cat 2 ·
//   09:06–09:16 → Cat 3 · >09:16 → counted absent (no late category).
function staffLateCategory(arrivalTime?: string): number | null {
  if (!arrivalTime) return null
  const [h, m] = arrivalTime.split(":").map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  const mins = h * 60 + m
  if (mins < 8 * 60 + 55) return null
  if (mins <= 8 * 60 + 59) return 1
  if (mins <= 9 * 60 + 5) return 2
  if (mins <= 9 * 60 + 16) return 3
  return null
}

interface OfficeDraft {
  finance: db.OfficeFinanceEntry[]
  duties: db.OfficeDutyItem[]
  reels: db.OfficeReelItem[]
  boost: db.OfficeReelBoost
  attendance: db.OfficeAttendanceFollowupRow[]
  assignments: db.OfficeAssignmentFollowupRow[]
}

export default function OfficeRoutinePage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const allowed = role === "admin" || role === "accountant"
  const isAdmin = role === "admin"

  const date = todayISO()
  const wk = weekStartISO(date)
  const todayDow = useMemo(() => new Date(date + "T12:00:00").getDay(), [date])
  // Default to today's schedule; office staff can reveal every course/class.
  const [showAllSchedule, setShowAllSchedule] = useState(false)

  // Today's "working course" — the first institute course scheduled today (falls
  // back to the first course on a day nothing runs). Seeds the course pickers on
  // the Lesson plans + Assignments tabs; office staff can switch to another.
  const todaysCourseId = useMemo(
    () => COURSES.find((c) => courseRunsToday(c.id, todayDow))?.id || COURSES[0].id,
    [todayDow],
  )
  const [lpCourse, setLpCourse] = useState(todaysCourseId)
  const [assignCourse, setAssignCourse] = useState(todaysCourseId)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [reportId, setReportId] = useState<string | undefined>()
  const [status, setStatus] = useState<db.OfficeReportStatus>("draft")

  // Pre-submit checklist: the final tab. Office staff review each section, then
  // tick them here. Submit is only enabled once every section is ticked.
  const [checklist, setChecklist] = useState<Record<ChecklistKey, boolean>>(emptyChecklist)
  const allChecked = CHECKLIST_ITEMS.every((i) => checklist[i.key])
  const checkedCount = CHECKLIST_ITEMS.filter((i) => checklist[i.key]).length
  const toggleCheck = (key: ChecklistKey) => setChecklist((c) => ({ ...c, [key]: !c[key] }))
  // Auto-tick a section the moment office staff edit it — they no longer have to
  // re-tick a section they've already filled in. Idempotent; staff can still
  // toggle any section by hand in the Pre-submit checklist tab. (Lesson plans is
  // review-only, so it has no auto-edit trigger and stays a manual tick.)
  const markChecked = (key: ChecklistKey) => setChecklist((c) => (c[key] ? c : { ...c, [key]: true }))

  // ── Staff roster (names + active list) — sourced from the institute staff
  //    data keyed by the same t-codes the punch records use, minus disabled
  //    staff. db.fetchTeachers() keys differently and can't resolve these.
  const { disabledIds } = useDisabledTeachers()
  const staffRoster = useMemo(
    () => initialTeachers.filter((t) => !disabledIds.has(t.id)),
    [disabledIds],
  )
  const staffNameMap = useMemo(
    () => Object.fromEntries(initialTeachers.map((t) => [t.id, t.name])) as Record<string, string>,
    [],
  )

  // ── Source data (punches, classes, students, attendance, submissions) ──
  const [punches, setPunches] = useState<db.StaffPunchToday[]>([])
  const [classes, setClasses] = useState<(ClassData & { courseId: string })[]>([])
  const [studentMap, setStudentMap] = useState<Record<string, { name: string; classId: string }>>({})
  const [classNameMap, setClassNameMap] = useState<Record<string, string>>({})
  const [todayAtt, setTodayAtt] = useState<Record<string, AttendanceRecord | undefined>>({})
  const [submissions, setSubmissions] = useState<db.LessonPlanSubmission[]>([])
  // Lesson-plan tracker: which week is being reviewed (defaults to this week).
  const [lpWeek, setLpWeek] = useState(wk)
  const [lpLoading, setLpLoading] = useState(false)

  // ── Shared daily income/expenditure ledger (institute-wide, attributed) ──
  const userName = (user?.user_metadata?.full_name as string) || user?.email || "Office staff"
  const [ledger, setLedger] = useState<db.OfficeFinanceLedgerEntry[]>([])
  const [newFin, setNewFin] = useState({ type: "income" as "income" | "expense", amount: "", category: "", remarks: "" })
  const [finBusy, setFinBusy] = useState(false)

  // ── Editable report draft ──
  const [draft, setDraft] = useState<OfficeDraft>({
    finance: [], duties: [], reels: [], boost: { weekStartDate: wk, isBoosted: false }, attendance: [], assignments: [],
  })

  const load = useCallback(async () => {
    if (!user || !allowed) return
    setLoading(true)

    // Staff punches for today (staff roster comes from initialTeachers above).
    setPunches(await db.fetchStaffPunchesForDate(date))

    // Shared daily finance ledger (institute-wide, not tied to this report).
    setLedger(await db.fetchOfficeFinanceLedger(date))

    // Classes across all four courses
    const perCourse = await Promise.all(
      COURSES.map(async (c) => (await db.fetchClasses(c.id)).map((cl) => ({ ...cl, courseId: c.id }))),
    )
    const allClasses = perCourse.flat()
    setClasses(allClasses)
    setClassNameMap(Object.fromEntries(allClasses.map((c) => [c.id, c.name])))

    // Students (for resolving late/absent names) + today's attendance
    const classIds = allClasses.map((c) => c.id)
    // Month-scoped attendance (not the all-time batch, which Supabase caps at
    // 1000 rows ordered oldest-first and so silently drops today's records).
    const [studentLists, attByClass] = await Promise.all([
      Promise.all(allClasses.map(async (c) => ({ classId: c.id, students: await db.fetchStudents(c.id) }))),
      db.fetchAllClassesAttendanceForMonth(classIds, date.slice(0, 7)),
    ])
    const sMap: Record<string, { name: string; classId: string }> = {}
    studentLists.forEach(({ classId, students }) =>
      students.forEach((s: Student) => { sMap[s.id] = { name: s.name, classId } }),
    )
    setStudentMap(sMap)
    const todayMap: Record<string, AttendanceRecord | undefined> = {}
    // Normalise the stored date (it may carry a time component) before matching.
    for (const cid of classIds) todayMap[cid] = (attByClass[cid] || []).find((r) => (r.date || "").split("T")[0] === date)
    setTodayAtt(todayMap)

    // Lesson-plan submissions are loaded by the week-scoped effect below.

    // Existing report (if any)
    const existing = await db.fetchOfficeReport(user.id, date)
    if (existing) {
      setReportId(existing.id)
      setStatus(existing.status)
      // The checklist always starts unticked — every section must be opened
      // and ticked one by one before the report can be submitted.
      setChecklist(emptyChecklist())
      setDraft({
        // Finance now lives in the shared daily ledger (loaded above), not the
        // per-staff report — keep it empty here so the legacy field is inert.
        finance: [],
        duties: existing.duties.length ? existing.duties : seedDuties(),
        reels: existing.reels.length ? existing.reels : seedReels(wk),
        boost: existing.boost || { weekStartDate: wk, isBoosted: false },
        attendance: existing.attendance,
        assignments: existing.assignments,
      })
    } else {
      setDraft((d) => ({ ...d, duties: seedDuties(), reels: seedReels(wk), boost: { weekStartDate: wk, isBoosted: false } }))
    }
    setLoading(false)
  }, [user, allowed, date, wk])

  useEffect(() => { load() }, [load])

  // Load lesson-plan submissions for the selected week (Mon→Sun) so the
  // tracker can be browsed week-by-week without reloading the whole page.
  useEffect(() => {
    if (!user || !allowed) return
    let cancelled = false
    setLpLoading(true)
    db.fetchLessonPlanSubmissions(lpWeek, weekEndISO(lpWeek)).then((rows) => {
      if (!cancelled) { setSubmissions(rows); setLpLoading(false) }
    })
    return () => { cancelled = true }
  }, [user, allowed, lpWeek])

  function seedDuties(): db.OfficeDutyItem[] {
    return COURSES.flatMap((c) =>
      (DUTY_TEMPLATES[c.id] || []).map((label) => ({ courseId: c.id, dutyLabel: label, isDone: false })),
    )
  }
  function seedReels(week: string): db.OfficeReelItem[] {
    return ([1, 2, 3] as const).map((n) => ({ weekStartDate: week, reelNumber: n, isPrepared: false }))
  }

  // ── Derived: today's attendance summary (+ per-course breakdown) ──
  const attendanceSummary = useMemo(() => {
    const classCourse: Record<string, string> = Object.fromEntries(classes.map((c) => [c.id, c.courseId]))
    let present = 0
    const late: { studentId: string; name: string; classId: string; time?: string }[] = []
    const absent: { studentId: string; name: string; classId: string; time?: string }[] = []
    // Per-course tallies + how many of each course's classes were marked today.
    const perCourse: Record<string, { present: number; late: number; absent: number; marked: number; total: number }> = {}
    for (const c of COURSES) perCourse[c.id] = { present: 0, late: 0, absent: 0, marked: 0, total: 0 }
    for (const c of classes) if (perCourse[c.courseId]) perCourse[c.courseId].total++

    let markedClasses = 0
    for (const [classId, rec] of Object.entries(todayAtt)) {
      if (!rec) continue
      markedClasses++
      const courseId = classCourse[classId]
      const pc = courseId ? perCourse[courseId] : undefined
      if (pc) pc.marked++
      for (const [sid, st] of Object.entries(rec.records)) {
        if (st === "present") { present++; if (pc) pc.present++ }
        else if (st === "late") { late.push({ studentId: sid, name: studentMap[sid]?.name || sid, classId, time: rec.arrivalTimes?.[sid] }); if (pc) pc.late++ }
        else if (st === "absent") { absent.push({ studentId: sid, name: studentMap[sid]?.name || sid, classId, time: rec.arrivalTimes?.[sid] }); if (pc) pc.absent++ }
      }
    }
    return { present, late, absent, perCourse, markedClasses, totalClasses: classes.length }
  }, [todayAtt, studentMap, classes])

  // ── Derived: staff with no punch today, grouped by the course they are
  //    expected in (item 10). A staff member is only flagged when they actually
  //    have a class today — someone with nothing scheduled is not expected to
  //    punch, so they are never reported. Heuristic per staff member:
  //      • if they hold a class in a course that meets today → expected there;
  //      • if they hold no specific class in a course but their pay-type/role
  //        ties them to it and that course runs today → expected there.
  //    Non-teaching daily staff (office/cleaning/driver) map to no course, so
  //    they are intentionally excluded from this teaching-day report.
  const noPunchByCourse = useMemo(() => {
    const punched = new Set(punches.map((p) => p.teacherId))
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]))
    // Courses a staff member is tied to purely by pay-type / dual role.
    const roleCourses = (t: TeacherData): Set<string> => {
      const s = new Set<string>()
      if (t.payType === "per-session-madrasa" || t.dualPayType === "per-session-madrasa" || t.teachesMadrasa) s.add("1")
      if (t.payType === "per-day-english" || t.dualPayType === "per-day-english") s.add("2")
      if (t.payType === "per-day-cibis" || t.dualPayType === "per-day-cibis" || t.teachesCibis) s.add("3")
      if (t.payType === "monthly-edu-support" || t.dualPayType === "monthly-edu-support") s.add("4")
      return s
    }
    const expectedForCourse = (t: TeacherData, courseId: string): boolean => {
      const myClasses = t.classIds.map((id) => classById[id]).filter((c) => c && c.courseId === courseId)
      if (myClasses.length) return myClasses.some((c) => classMeetsToday(c.courseId, c.schedule, todayDow))
      return roleCourses(t).has(courseId) && courseRunsToday(courseId, todayDow)
    }
    const groups = COURSES
      .filter((c) => courseRunsToday(c.id, todayDow))
      .map((c) => ({ course: c, staff: staffRoster.filter((t) => !punched.has(t.id) && expectedForCourse(t, c.id)) }))
    // Non-teaching support staff who are still expected to punch:
    //   • office + cleaning → every day; • driver → only on English-madrasa
    //     (Friday) days, when transport duty runs.
    const support = staffRoster.filter((t) => {
      if (punched.has(t.id)) return false
      if (t.payType === "monthly-office" || t.payType === "monthly-cleaning") return true
      if (t.payType === "daily-driver") return courseRunsToday("2", todayDow)
      return false
    })
    const flagged = new Set([
      ...groups.flatMap((g) => g.staff.map((t) => t.id)),
      ...support.map((t) => t.id),
    ])
    return { groups, support, totalFlagged: flagged.size, anyCourseToday: groups.length > 0 }
  }, [staffRoster, punches, classes, todayDow])

  // ── Derived: reasons already recorded against each student in the attendance
  //    system (the `remarks` on today's record), keyed by `classId:studentId`.
  //    These pre-fill the late/absent reason boxes instead of leaving them blank.
  const sourceReasons = useMemo(() => {
    const m: Record<string, string> = {}
    for (const [classId, rec] of Object.entries(todayAtt)) {
      if (!rec?.remarks) continue
      for (const [sid, remark] of Object.entries(rec.remarks)) {
        if (remark) m[`${classId}:${sid}`] = remark
      }
    }
    return m
  }, [todayAtt])

  // ── Derived: per-teacher lesson-plan / PPT submission status for the week ──
  const lpTracker = useMemo(() => {
    const norm = (s?: string) => (s || "").trim().toLowerCase().replace(/\s+/g, " ")
    const hasPlan = (s: db.LessonPlanSubmission) => !!(s.lessonPlanName || s.lessonPlanUrl || s.lessonPlanPath)
    const hasPpt = (s: db.LessonPlanSubmission) => !!(s.pptName || s.pptUrl || s.pptPath)
    const staffNorm = staffRoster.map((t) => ({ t, n: norm(t.name) }))

    // Resolve each submission to at most ONE staff member. Submissions carry the
    // auth id + a free-text name (often just a first name, e.g. a first name), so:
    //   1. exact auth-id match, else
    //   2. exact name match, else
    //   3. the submitted name is a whole-word prefix of exactly one staff name
    //      (a first name → a full name). If it prefixes several (two staff with the same first name)
    //      it's genuinely ambiguous, so we leave it unmatched rather than guess.
    const subToStaff = new Map<string, string | null>()
    for (const s of submissions) {
      const sn = norm(s.teacherName)
      let staffId: string | null = null
      if (s.teacherId && staffRoster.some((t) => t.id === s.teacherId)) {
        staffId = s.teacherId
      } else if (sn) {
        const exact = staffNorm.filter((x) => x.n === sn)
        const cands = exact.length ? exact : staffNorm.filter((x) => x.n.startsWith(sn + " "))
        if (cands.length === 1) staffId = cands[0].t.id
      }
      subToStaff.set(s.id, staffId)
    }

    const rows = staffRoster.map((t) => {
      const subs = submissions.filter((s) => subToStaff.get(s.id) === t.id)
      return { id: t.id, name: t.name, subs, plan: subs.some(hasPlan), ppt: subs.some(hasPpt) }
    })
    // Submissions we couldn't confidently attribute (no match, or an ambiguous
    // first name) — kept visible so nothing is silently dropped.
    const others = submissions.filter((s) => !subToStaff.get(s.id))
    const planCount = rows.filter((r) => r.plan).length
    const pptCount = rows.filter((r) => r.ppt).length
    const bothCount = rows.filter((r) => r.plan && r.ppt).length
    return { rows, others, planCount, pptCount, bothCount }
  }, [submissions, staffRoster])

  // ── Derived: lesson-plan / PPT submissions grouped by course ──
  // Each submission carries its own courseId, so we bucket per institute course
  // (plus an "unassigned" bucket for rows without a recognised course).
  const lpByCourse = useMemo(() => {
    const hasPlan = (s: db.LessonPlanSubmission) => !!(s.lessonPlanName || s.lessonPlanUrl || s.lessonPlanPath)
    const hasPpt = (s: db.LessonPlanSubmission) => !!(s.pptName || s.pptUrl || s.pptPath)
    const known = new Set(COURSES.map((c) => c.id))
    const groups = COURSES.map((c) => {
      const subs = submissions.filter((s) => s.courseId === c.id)
      return { course: c, subs, planCount: subs.filter(hasPlan).length, pptCount: subs.filter(hasPpt).length }
    })
    const unassigned = submissions.filter((s) => !s.courseId || !known.has(s.courseId))
    return { groups, unassigned, hasPlan, hasPpt }
  }, [submissions])

  // Schedule-aware visibility: by default show only courses/classes that meet
  // today (on a weekday only EDU Support runs), with an option to reveal all.
  const visibleCourses = useMemo(
    () => (showAllSchedule ? COURSES : COURSES.filter((c) => courseRunsToday(c.id, todayDow))),
    [showAllSchedule, todayDow],
  )
  const visibleClasses = useMemo(
    () => (showAllSchedule ? classes : classes.filter((c) => classMeetsToday(c.courseId, c.schedule, todayDow))),
    [showAllSchedule, classes, todayDow],
  )

  const locked = status === "locked" && !isAdmin

  // ── Mutators ──
  const setBoost = (patch: Partial<db.OfficeReelBoost>) => { markChecked("marketing"); setDraft((d) => ({ ...d, boost: { ...d.boost, ...patch } })) }
  // Shared finance ledger: entries persist immediately (no overwrite) and are
  // attributed to whoever adds them.
  const reloadLedger = useCallback(async () => setLedger(await db.fetchOfficeFinanceLedger(date)), [date])
  const addLedgerEntry = async () => {
    if (!user) return
    const amount = parseFloat(newFin.amount)
    if (!amount || amount <= 0) { toast.error("Enter a valid amount."); return }
    setFinBusy(true)
    const res = await db.addOfficeFinanceLedgerEntry({
      entryDate: date, type: newFin.type, amount,
      category: newFin.category.trim() || undefined, remarks: newFin.remarks.trim() || undefined,
      createdBy: user.id, createdByName: userName,
    })
    setFinBusy(false)
    if (res.error) { toast.error(res.error); return }
    markChecked("finance")
    setNewFin({ type: "income", amount: "", category: "", remarks: "" })
    await reloadLedger()
    toast.success("Entry added")
  }
  const removeLedgerEntry = async (id?: string) => {
    if (!id) return
    setFinBusy(true)
    const res = await db.deleteOfficeFinanceLedgerEntry(id)
    setFinBusy(false)
    if (res.error) { toast.error(res.error); return }
    markChecked("finance")
    await reloadLedger()
  }
  const toggleDuty = (i: number, patch: Partial<db.OfficeDutyItem>) => {
    markChecked("duties")
    setDraft((d) => ({ ...d, duties: d.duties.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) }))
  }
  // Admin-only: add a blank duty to a course / remove one.
  const addDuty = (courseId: string) =>
    setDraft((d) => ({ ...d, duties: [...d.duties, { courseId, dutyLabel: "", isDone: false }] }))
  const delDuty = (i: number) =>
    setDraft((d) => ({ ...d, duties: d.duties.filter((_, idx) => idx !== i) }))
  const toggleReel = (i: number, patch: Partial<db.OfficeReelItem>) => {
    markChecked("marketing")
    setDraft((d) => ({ ...d, reels: d.reels.map((x, idx) => (idx === i ? { ...x, ...patch } : x)) }))
  }
  // Admin-only: add a reel into the smallest free slot / remove one. The schema
  // caps reels at 3 per week (reel_number BETWEEN 1 AND 3), so we never exceed it.
  const addReel = () =>
    setDraft((d) => {
      const used = new Set(d.reels.map((r) => r.reelNumber))
      const next = ([1, 2, 3] as const).find((n) => !used.has(n))
      if (!next) return d
      return { ...d, reels: [...d.reels, { weekStartDate: wk, reelNumber: next, isPrepared: false }] }
    })
  const delReel = (i: number) =>
    setDraft((d) => ({ ...d, reels: d.reels.filter((_, idx) => idx !== i) }))
  const setAssignment = (classId: string, patch: Partial<db.OfficeAssignmentFollowupRow>) => {
    markChecked("assignments")
    setDraft((d) => {
      const exists = d.assignments.find((a) => a.classId === classId)
      const next = exists
        ? d.assignments.map((a) => (a.classId === classId ? { ...a, ...patch } : a))
        : [...d.assignments, { classId, assignmentForwarded: false, ...patch }]
      return { ...d, assignments: next }
    })
  }

  // Reasons for late/absent map onto attendance followup rows (per class).
  const setAttReason = (classId: string, kind: "late" | "absent", sid: string, name: string, reason: string) => {
    markChecked("attendance")
    setDraft((d) => {
      const rows = [...d.attendance]
      let row = rows.find((r) => r.classId === classId)
      if (!row) { row = { classId, lateStudents: [], absentStudents: [] }; rows.push(row) }
      const list = kind === "late" ? row.lateStudents : row.absentStudents
      const entry = list.find((e) => e.studentId === sid)
      if (entry) entry.reason = reason
      else list.push({ studentId: sid, name, reason })
      return { ...d, attendance: rows }
    })
  }
  const getAttReason = (classId: string, kind: "late" | "absent", sid: string): string => {
    const row = draft.attendance.find((r) => r.classId === classId)
    const list = row ? (kind === "late" ? row.lateStudents : row.absentStudents) : []
    // Prefer a reason typed into the office report; otherwise fall back to the
    // reason already recorded in the attendance system.
    return list.find((e) => e.studentId === sid)?.reason || sourceReasons[`${classId}:${sid}`] || ""
  }

  const saveOutTime = async (p: db.StaffPunchToday, value: string) => {
    if (!value) return
    const res = await db.updateStaffPunchOut(p.teacherId, p.date, p.session, value)
    if (res.error) { toast.error(res.error); return }
    markChecked("attendance")
    toast.success("Punch-out time saved")
    setPunches((prev) => prev.map((x) =>
      x.teacherId === p.teacherId && x.session === p.session ? { ...x, departureTime: value, outMissing: false } : x))
  }

  const save = async (newStatus: db.OfficeReportStatus) => {
    if (!user) return
    // Submitting requires every section in the pre-submit checklist to be ticked.
    if (newStatus === "submitted" && !allChecked) {
      const pending = CHECKLIST_ITEMS.filter((i) => !checklist[i.key]).map((i) => i.label).join(", ")
      toast.error(`Tick every section in the checklist before submitting. Pending: ${pending}`)
      return
    }
    setSaving(true)
    // Build attendance rows that also carry the late/absent names even when no
    // reason was typed, so the record is complete.
    const attRows = buildAttendanceRows()
    const res = await db.saveOfficeReport({
      id: reportId,
      staffId: user.id,
      reportDate: date,
      status: newStatus,
      finance: draft.finance,
      duties: draft.duties,
      reels: draft.reels,
      boost: draft.boost,
      attendance: attRows,
      assignments: draft.assignments,
    })
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    if (res.id) setReportId(res.id)
    setStatus(newStatus)
    toast.success(newStatus === "submitted" ? "Report submitted" : "Draft saved")
  }

  function buildAttendanceRows(): db.OfficeAttendanceFollowupRow[] {
    const byClass: Record<string, db.OfficeAttendanceFollowupRow> = {}
    const ensure = (cid: string) => (byClass[cid] ||= { classId: cid, lateStudents: [], absentStudents: [] })
    attendanceSummary.late.forEach((s) =>
      ensure(s.classId).lateStudents.push({ studentId: s.studentId, name: s.name, reason: getAttReason(s.classId, "late", s.studentId) }))
    attendanceSummary.absent.forEach((s) =>
      ensure(s.classId).absentStudents.push({ studentId: s.studentId, name: s.name, reason: getAttReason(s.classId, "absent", s.studentId) }))
    return Object.values(byClass)
  }

  const exportPdf = async () => {
    const { default: jsPDF } = await import("jspdf")
    const autoTable = (await import("jspdf-autotable")).default
    const { addReportHeader } = await import("@/lib/branding")
    const doc = new jsPDF()
    let y = await addReportHeader(doc, "Daily Office Routine", `Date: ${date}`)
    const NAVY: [number, number, number] = [30, 58, 95]
    const RED: [number, number, number] = [200, 30, 30]
    const next = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

    // ── 1) Staff punch in/out, with late arrivals flagged red + category ──
    const punchRows = punches.map((p) => {
      const cat = staffLateCategory(p.arrivalTime)
      const late = cat !== null || p.status === "late"
      const inText = !p.arrivalTime ? "—" : cat !== null ? `${p.arrivalTime}  (Late · Cat ${cat})` : late ? `${p.arrivalTime}  (Late)` : p.arrivalTime
      return { late, cells: [staffNameMap[p.teacherId] || p.teacherId, p.session, inText, p.departureTime || "—"] }
    })
    autoTable(doc, {
      startY: y, head: [["Staff punch — Name", "Session", "In", "Out"]],
      body: punchRows.length ? punchRows.map((r) => r.cells) : [["—", "—", "No punches recorded today", "—"]],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
      didParseCell: (d) => {
        if (d.section === "body" && d.column.index === 2 && punchRows[d.row.index]?.late) {
          d.cell.styles.textColor = RED; d.cell.styles.fontStyle = "bold"
        }
      },
    })
    y = next()

    // ── 2) Staff expected today but not punched (grouped) ──
    const noPunchRows: string[][] = []
    noPunchByCourse.groups.filter((g) => g.staff.length).forEach((g) => noPunchRows.push([g.course.title, g.staff.map((t) => t.name).join(", ")]))
    if (noPunchByCourse.support.length) noPunchRows.push(["Office / Support staff", noPunchByCourse.support.map((t) => t.name).join(", ")])
    autoTable(doc, {
      startY: y, head: [["No punch today — Group", "Staff expected but not punched"]],
      body: noPunchRows.length ? noPunchRows : [["—", "All expected staff have punched"]],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
    })
    y = next()

    // ── 3) Student attendance summary ──
    //    Classes scheduled today whose attendance is not marked yet (or only
    //    partially marked) are listed inline under the "Classes marked" tally
    //    in red — no separate table.
    const unmarked = classes.filter((c) => classMeetsToday(c.courseId, c.schedule, todayDow) && !todayAtt[c.id])
    const attnSummary: string[][] = [
      ["Present", String(attendanceSummary.present)],
      ["Late", String(attendanceSummary.late.length)],
      ["Absent", String(attendanceSummary.absent.length)],
      ["Classes marked", `${attendanceSummary.markedClasses} / ${attendanceSummary.totalClasses}`],
      ...unmarked.map((c) => [`Not marked — ${c.name} · ${COURSES.find((x) => x.id === c.courseId)?.title || c.courseId}`, "—"]),
    ]
    autoTable(doc, {
      startY: y, head: [["Student attendance (today)", "Count"]],
      body: attnSummary,
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
      didParseCell: (d) => {
        // Rows after the four summary rows are the unmarked-class lines.
        if (d.section === "body" && d.row.index >= 4) {
          d.cell.styles.textColor = RED
        }
      },
    })
    y = next()

    // ── 5) Late comers (arrival time in red) + reason ──
    const lateRows = attendanceSummary.late.map((s) => [s.name, classNameMap[s.classId] || s.classId, s.time || "—", getAttReason(s.classId, "late", s.studentId) || "—"])
    autoTable(doc, {
      startY: y, head: [["Late comer", "Class", "Time", "Reason"]],
      body: lateRows.length ? lateRows : [["No late comers today", "—", "—", "—"]],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
      didParseCell: (d) => {
        if (d.section === "body" && d.column.index === 2 && lateRows.length && lateRows[d.row.index]?.[2] !== "—") {
          d.cell.styles.textColor = RED; d.cell.styles.fontStyle = "bold"
        }
      },
    })
    y = next()

    // ── 6) Absentees + reason ──
    const absentRows = attendanceSummary.absent.map((s) => [s.name, classNameMap[s.classId] || s.classId, getAttReason(s.classId, "absent", s.studentId) || "—"])
    autoTable(doc, {
      startY: y, head: [["Absentee", "Class", "Reason"]],
      body: absentRows.length ? absentRows : [["No absentees today", "—", "—"]],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
    })
    y = next()

    // ── 7) Finance — shared daily ledger (with who recorded each entry) ──
    const income = ledger.filter((f) => f.type === "income").reduce((s, f) => s + f.amount, 0)
    const expense = ledger.filter((f) => f.type === "expense").reduce((s, f) => s + f.amount, 0)
    autoTable(doc, {
      startY: y, head: [["Finance — Type", "Amount (AED)", "Category", "Remarks", "Added by"]],
      body: [
        ...ledger.map((f) => [f.type, f.amount.toFixed(2), f.category || "—", f.remarks || "—", f.createdByName || "—"]),
        ["Income total", income.toFixed(2), "", "", ""],
        ["Expenditure total", expense.toFixed(2), "", "", ""],
        ["Net", (income - expense).toFixed(2), "", "", ""],
      ],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
    })
    y = next()

    // ── 8) Course duties — only courses scheduled today ──
    const dutyRows: string[][] = []
    COURSES.filter((c) => courseRunsToday(c.id, todayDow)).forEach((c) => {
      const items = draft.duties.filter((d) => d.courseId === c.id)
      if (!items.length) { dutyRows.push([c.title, "No duties listed", "—", "—"]); return }
      items.forEach((d) => dutyRows.push([c.title, d.dutyLabel || "—", d.isDone ? "Yes" : "No", d.remarks || "—"]))
    })
    autoTable(doc, {
      startY: y, head: [["Course duties (today) — Course", "Duty", "Done", "Remarks"]],
      body: dutyRows.length ? dutyRows : [["—", "No courses scheduled today", "—", "—"]],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
    })
    y = next()

    // ── 9) Marketing ──
    const reelsDone = draft.reels.filter((r) => r.isPrepared).length
    autoTable(doc, {
      startY: y, head: [["Marketing (this week)", "Status"]],
      body: [
        ["Reels prepared", `${reelsDone} / ${draft.reels.length}`],
        ["Reel boosted", draft.boost.isBoosted ? "Yes" : "No"],
        ["Boost link", draft.boost.instagramUrl || "—"],
      ],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
    })
    y = next()

    // ── 10) Lesson plan / PPT follow-up — per course, for the tracked week ──
    const lpRows: string[][] = []
    lpByCourse.groups.forEach(({ course, subs }) => {
      if (!subs.length) { lpRows.push([course.title, "No submissions this week", "—", "—", "—"]); return }
      subs.forEach((s) => lpRows.push([
        course.title,
        s.teacherName || s.teacherEmail || "—",
        (s.lessonPlanName || s.lessonPlanUrl || s.lessonPlanPath) ? "Yes" : "No",
        (s.pptName || s.pptUrl || s.pptPath) ? "Yes" : "No",
        `${s.subject}${s.grade ? ` (${s.grade})` : ""}`,
      ]))
    })
    autoTable(doc, {
      startY: y, head: [[`Lesson plan / PPT — week of ${lpWeek} · Course`, "Teacher", "Plan", "PPT", "Subject"]],
      body: lpRows.length ? lpRows : [["—", "No submissions", "—", "—", "—"]],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
    })
    y = next()

    // ── 11) Assignments — classes scheduled today ──
    const assignRows = classes
      .filter((c) => classMeetsToday(c.courseId, c.schedule, todayDow))
      .map((c) => {
        const row = draft.assignments.find((a) => a.classId === c.id)
        return [c.name, row?.assignmentForwarded ? "Yes" : "No", row?.remarks || "—"]
      })
    autoTable(doc, {
      startY: y, head: [["Assignment forwarded — Class", "Forwarded", "Remarks"]],
      body: assignRows.length ? assignRows : [["No classes scheduled today", "—", "—"]],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
    })

    doc.save(`office-routine-${date}.pdf`)
  }

  if (!user) return null
  if (!allowed) {
    return (
      <div className="p-6">
        <Card><CardContent className="p-8 text-center text-navy-300">
          This page is restricted to admin and accountant (office staff) roles.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2 truncate">
            <ClipboardList className="h-6 w-6 shrink-0 text-emerald-500" /> Daily Office Routine
          </h1>
          <p className="text-sm text-navy-300">{date} · status: <Badge variant="outline">{status}</Badge></p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/dashboard/office-routine/reports"><Button variant="outline" size="sm"><ClipboardList className="h-4 w-4 mr-1" /> Reports</Button></a>
          <Button variant="outline" size="sm" onClick={exportPdf}><FileDown className="h-4 w-4 mr-1" /> PDF</Button>
          <Button variant="outline" size="sm" disabled={saving || locked} onClick={() => save("draft")}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Save draft
          </Button>
          <Button size="sm" disabled={saving || locked || !allChecked} onClick={() => save("submitted")}
            title={allChecked ? "Submit the daily report" : "Tick every section in the checklist to enable Submit"}>
            <CheckCircle2 className="h-4 w-4 mr-1" /> Submit
          </Button>
          {isAdmin && reportId && status !== "locked" && (
            <Button size="sm" variant="outline" onClick={async () => {
              const r = await db.lockOfficeReport(reportId); if (r.error) toast.error(r.error); else { setStatus("locked"); toast.success("Report locked") }
            }}><Lock className="h-4 w-4 mr-1" /> Lock</Button>
          )}
        </div>
      </div>

      {locked && (
        <div className="rounded-md bg-amber-500/10 text-amber-300 px-4 py-2 text-sm">
          This report is locked. Only an admin can edit it.
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-navy-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <Tabs defaultValue="attendance" className="w-full">
          <TabsList className="flex w-full h-auto justify-start gap-1 overflow-x-auto p-1 [&>[data-slot=tabs-trigger]]:flex-none [&>[data-slot=tabs-trigger]]:px-3 [&>[data-slot=tabs-trigger]]:py-1.5">
            <TabsTrigger value="attendance"><Clock className="h-4 w-4 mr-1" /> Attendance</TabsTrigger>
            <TabsTrigger value="finance"><Wallet className="h-4 w-4 mr-1" /> Finance</TabsTrigger>
            <TabsTrigger value="duties"><ClipboardList className="h-4 w-4 mr-1" /> Course duties</TabsTrigger>
            <TabsTrigger value="marketing"><Film className="h-4 w-4 mr-1" /> Marketing</TabsTrigger>
            <TabsTrigger value="lessons"><BookUp className="h-4 w-4 mr-1" /> Lesson plans</TabsTrigger>
            <TabsTrigger value="assignments"><Users className="h-4 w-4 mr-1" /> Assignments</TabsTrigger>
            <TabsTrigger value="checklist">
              <CheckCircle2 className={`h-4 w-4 mr-1 ${allChecked ? "text-emerald-500" : ""}`} /> Pre-submit checklist
            </TabsTrigger>
          </TabsList>

          {/* ── Attendance: staff punches + auto-absent + student follow-up ── */}
          <TabsContent value="attendance" className="space-y-4">
            <SectionCard title="Staff punch in / out (today)" icon={<Clock className="h-4 w-4" />}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-navy-300">
                    <th className="py-2 pr-3">Staff</th><th className="pr-3">Session</th>
                    <th className="pr-3">In</th><th className="pr-3">Out</th>
                  </tr></thead>
                  <tbody>
                    {punches.length === 0 && <tr><td colSpan={4} className="py-3 text-navy-400">No punches recorded today.</td></tr>}
                    {punches.map((p, i) => {
                      const name = staffNameMap[p.teacherId] || p.teacherId
                      return (
                        <tr key={i} className="border-t border-navy-700/40">
                          <td className="py-2 pr-3 truncate max-w-[160px]">{name}</td>
                          <td className="pr-3">{p.session}</td>
                          <td className="pr-3">
                            {(() => {
                              if (!p.arrivalTime) return "—"
                              const cat = staffLateCategory(p.arrivalTime)
                              const late = cat !== null || p.status === "late"
                              if (!late) return p.arrivalTime
                              return (
                                <span className="inline-flex items-center gap-1 text-red-400 font-semibold">
                                  {p.arrivalTime}
                                  {cat !== null && (
                                    <Badge variant="outline" className="text-red-400 border-red-400/40">Cat {cat}</Badge>
                                  )}
                                </span>
                              )
                            })()}
                          </td>
                          <td className="pr-3">
                            {p.departureTime ? p.departureTime : (
                              <span className="flex items-center gap-1">
                                <Input type="time" disabled={locked} className="h-8 w-28"
                                  defaultValue=""
                                  onBlur={(e) => e.target.value && saveOutTime(p, e.target.value)} />
                                <Badge variant="outline" className="text-amber-400">missing</Badge>
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <SectionCard title={`Staff with no punch today (${noPunchByCourse.totalFlagged})`} icon={<Users className="h-4 w-4" />}>
              {noPunchByCourse.totalFlagged === 0 ? (
                <p className="text-sm text-navy-400">All staff expected today have at least one punch.</p>
              ) : (
                <div className="space-y-3">
                  {noPunchByCourse.groups.filter((g) => g.staff.length > 0).map(({ course, staff }) => (
                    <div key={course.id}>
                      <p className="text-xs font-semibold text-navy-200 mb-1">{course.title}</p>
                      <div className="flex flex-wrap gap-2">
                        {staff.map((t) => <Badge key={t.id} variant="outline" className="text-amber-300">{t.name}</Badge>)}
                      </div>
                    </div>
                  ))}
                  {noPunchByCourse.support.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-navy-200 mb-1">Office / Support staff</p>
                      <div className="flex flex-wrap gap-2">
                        {noPunchByCourse.support.map((t) => <Badge key={t.id} variant="outline" className="text-amber-300">{t.name}</Badge>)}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs text-navy-400 mt-2">
                Expected today = teaching staff with a class today, office &amp; cleaning staff (daily), and the driver on
                English-madrasa (Friday) days. Staff with nothing scheduled are not expected to punch.
                Computed from punch data (read-only). Payroll is not affected automatically.
              </p>
            </SectionCard>

            <div className="grid sm:grid-cols-3 gap-3">
              <StatCard label="Students present" value={attendanceSummary.present} />
              <StatCard label="Late comers" value={attendanceSummary.late.length} />
              <StatCard label="Absentees" value={attendanceSummary.absent.length} />
            </div>

            <SectionCard title="Student attendance by course (today)" icon={<Users className="h-4 w-4" />}>
              {attendanceSummary.markedClasses === 0 ? (
                <p className="text-sm text-amber-300">
                  No student attendance has been marked yet for {date}. Counts will update automatically as teachers
                  mark attendance for their classes today.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-navy-300">
                      <th className="py-2 pr-3">Course</th><th className="pr-3">Classes marked</th>
                      <th className="pr-3">Present</th><th className="pr-3">Late</th><th className="pr-3">Absent</th>
                    </tr></thead>
                    <tbody>
                      {COURSES.map((c) => {
                        const pc = attendanceSummary.perCourse[c.id]
                        return (
                          <tr key={c.id} className="border-t border-navy-700/40">
                            <td className="py-2 pr-3 truncate max-w-[200px]">{c.title}</td>
                            <td className="pr-3">{pc.marked} / {pc.total}</td>
                            <td className="pr-3 text-emerald-400">{pc.present}</td>
                            <td className="pr-3 text-amber-300">{pc.late}</td>
                            <td className="pr-3 text-red-400">{pc.absent}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p className="text-xs text-navy-400 mt-2">
                    {attendanceSummary.markedClasses} of {attendanceSummary.totalClasses} classes have attendance marked for {date}.
                  </p>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Late comers" icon={<Clock className="h-4 w-4" />}>
              <AttList rows={attendanceSummary.late} classNameMap={classNameMap} locked={locked}
                getReason={(s) => getAttReason(s.classId, "late", s.studentId)}
                setReason={(s, v) => setAttReason(s.classId, "late", s.studentId, s.name, v)} />
            </SectionCard>
            <SectionCard title="Absentees" icon={<Clock className="h-4 w-4" />}>
              <AttList rows={attendanceSummary.absent} classNameMap={classNameMap} locked={locked}
                getReason={(s) => getAttReason(s.classId, "absent", s.studentId)}
                setReason={(s, v) => setAttReason(s.classId, "absent", s.studentId, s.name, v)} />
            </SectionCard>
          </TabsContent>

          {/* ── Finance: shared institute-wide daily ledger ── */}
          <TabsContent value="finance" className="space-y-4">
            <SectionCard title="Income & expenditure — shared daily ledger" icon={<Wallet className="h-4 w-4" />}>
              {/* Existing entries (everyone's, for this date) */}
              {ledger.length === 0 ? (
                <p className="text-sm text-navy-400">No income/expenditure recorded yet for {date}.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-navy-300">
                      <th className="py-2 pr-3">Type</th><th className="pr-3">Amount (AED)</th>
                      <th className="pr-3">Category</th><th className="pr-3">Details / remarks</th>
                      <th className="pr-3">Added by</th><th></th>
                    </tr></thead>
                    <tbody>
                      {ledger.map((f) => (
                        <tr key={f.id} className="border-t border-navy-700/40">
                          <td className="py-2 pr-3 capitalize">{f.type}</td>
                          <td className={`pr-3 ${f.type === "expense" ? "text-red-400" : "text-emerald-400"}`}>{f.amount.toFixed(2)}</td>
                          <td className="pr-3">{f.category || "—"}</td>
                          <td className="pr-3">{f.remarks || "—"}</td>
                          <td className="pr-3 text-navy-300">
                            {f.createdByName || "—"}
                            {f.createdAt ? ` · ${new Date(f.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                          </td>
                          <td className="pr-3">
                            {(isAdmin || f.createdBy === user.id) && (
                              <Button variant="ghost" size="icon" disabled={finBusy} onClick={() => removeLedgerEntry(f.id)} aria-label="Remove entry">
                                <Trash2 className="h-4 w-4 text-red-400" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Add a new entry — saved immediately to the shared ledger */}
              <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-navy-700/40 pt-3">
                <div className="w-full sm:w-32 min-w-0">
                  <Label className="text-xs">Type</Label>
                  <Select value={newFin.type} onValueChange={(v) => v && setNewFin((s) => ({ ...s, type: v as "income" | "expense" }))}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="income">Income</SelectItem>
                      <SelectItem value="expense">Expense</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-full sm:w-28 min-w-0">
                  <Label className="text-xs">Amount</Label>
                  <Input type="number" value={newFin.amount} onChange={(e) => setNewFin((s) => ({ ...s, amount: e.target.value }))} />
                </div>
                <div className="w-full sm:w-40 min-w-0">
                  <Label className="text-xs">Category</Label>
                  <Input value={newFin.category} onChange={(e) => setNewFin((s) => ({ ...s, category: e.target.value }))} />
                </div>
                <div className="flex-1 min-w-0">
                  <Label className="text-xs">Details / remarks</Label>
                  <Input value={newFin.remarks} onChange={(e) => setNewFin((s) => ({ ...s, remarks: e.target.value }))} />
                </div>
                <Button size="sm" disabled={finBusy} onClick={addLedgerEntry}>
                  {finBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />} Add entry
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                <span>Income: <strong>{ledger.filter((f) => f.type === "income").reduce((s, f) => s + f.amount, 0).toFixed(2)}</strong></span>
                <span>Expense: <strong>{ledger.filter((f) => f.type === "expense").reduce((s, f) => s + f.amount, 0).toFixed(2)}</strong></span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                This is the institute&apos;s shared ledger for {date}. Each entry is saved immediately and tagged with who added it —
                entries from earlier in the day are never replaced by a new save.
              </p>
            </SectionCard>
          </TabsContent>

          {/* ── Course duties ── */}
          <TabsContent value="duties" className="space-y-4">
            <ScheduleNote showAll={showAllSchedule} onToggle={setShowAllSchedule} dow={todayDow} />
            {visibleCourses.length === 0 && (
              <p className="text-sm text-navy-400">No courses run today. Tick &ldquo;show all&rdquo; above to see every course.</p>
            )}
            {visibleCourses.map((c) => (
              <SectionCard key={c.id} title={c.title} icon={<ClipboardList className="h-4 w-4" />}>
                <div className="space-y-2">
                  {draft.duties.map((d, i) => d.courseId !== c.id ? null : (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      {isAdmin ? (
                        <>
                          <input type="checkbox" className="shrink-0" checked={d.isDone} onChange={(e) => toggleDuty(i, { isDone: e.target.checked })} />
                          <Input className="w-full sm:w-72 min-w-0" placeholder="Duty name" value={d.dutyLabel}
                            onChange={(e) => toggleDuty(i, { dutyLabel: e.target.value })} />
                        </>
                      ) : (
                        <label className="flex items-center gap-2 w-full sm:w-72 min-w-0">
                          <input type="checkbox" checked={d.isDone} disabled={locked} onChange={(e) => toggleDuty(i, { isDone: e.target.checked })} />
                          <span className="truncate">{d.dutyLabel}</span>
                        </label>
                      )}
                      <Input className="flex-1 min-w-0" placeholder="Remarks" value={d.remarks || ""} disabled={locked}
                        onChange={(e) => toggleDuty(i, { remarks: e.target.value })} />
                      {isAdmin && (
                        <Button variant="ghost" size="icon" onClick={() => delDuty(i)} aria-label="Remove duty">
                          <Trash2 className="h-4 w-4 text-red-400" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                {isAdmin && (
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => addDuty(c.id)}>
                    <Plus className="h-4 w-4 mr-1" /> Add duty
                  </Button>
                )}
              </SectionCard>
            ))}
          </TabsContent>

          {/* ── Marketing: reels + boost ── */}
          <TabsContent value="marketing" className="space-y-4">
            <SectionCard title="Weekly reels" icon={<Film className="h-4 w-4" />}>
              <p className="text-sm text-navy-300 mb-2">Week of {wk} · {draft.reels.filter((r) => r.isPrepared).length}/{draft.reels.length} prepared</p>
              <div className="space-y-2">
                {draft.reels.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 w-full sm:w-40 min-w-0">
                      <input type="checkbox" checked={r.isPrepared} disabled={locked} onChange={(e) => toggleReel(i, { isPrepared: e.target.checked })} />
                      <span>Reel {r.reelNumber} prepared</span>
                    </label>
                    <Input className="flex-1 min-w-0" placeholder="Notes" value={r.notes || ""} disabled={locked}
                      onChange={(e) => toggleReel(i, { notes: e.target.value })} />
                    {isAdmin && (
                      <Button variant="ghost" size="icon" onClick={() => delReel(i)} aria-label="Remove reel">
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {isAdmin && (
                <Button variant="outline" size="sm" className="mt-3" disabled={draft.reels.length >= 3} onClick={addReel}>
                  <Plus className="h-4 w-4 mr-1" /> Add reel
                </Button>
              )}
            </SectionCard>

            <SectionCard title="Weekly reel boost (1 per week)" icon={<Megaphone className="h-4 w-4" />}>
              <label className="flex items-center gap-2 mb-2">
                <input type="checkbox" checked={draft.boost.isBoosted} disabled={locked} onChange={(e) => setBoost({ isBoosted: e.target.checked })} />
                <span>A reel was boosted this week</span>
              </label>
              <Label className="text-xs">Instagram link {draft.boost.isBoosted && <span className="text-red-400">(required)</span>}</Label>
              <Input placeholder="https://www.instagram.com/..." value={draft.boost.instagramUrl || ""} disabled={locked}
                onChange={(e) => setBoost({ instagramUrl: e.target.value })} />
              {draft.boost.isBoosted && draft.boost.instagramUrl && !/instagr/i.test(draft.boost.instagramUrl) && (
                <p className="text-xs text-red-400 mt-1">That does not look like an Instagram link.</p>
              )}
            </SectionCard>
          </TabsContent>

          {/* ── Lesson plans (item 9 follow-up): who submitted, by week ── */}
          <TabsContent value="lessons" className="space-y-4">
            <SectionCard title="Lesson plan / PPT submissions by course" icon={<BookUp className="h-4 w-4" />}>
              {/* Week selector */}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setLpWeek(addDaysISO(lpWeek, -7))}>← Prev week</Button>
                <span className="text-sm text-navy-200 whitespace-nowrap">
                  Week of {lpWeek} – {weekEndISO(lpWeek)}
                </span>
                <Button variant="outline" size="sm" disabled={lpWeek >= wk} onClick={() => setLpWeek(addDaysISO(lpWeek, 7))}>Next week →</Button>
                <Input type="date" className="h-8 w-40" value={lpWeek}
                  onChange={(e) => e.target.value && setLpWeek(weekStartISO(e.target.value))} />
                {lpWeek !== wk && <Button variant="ghost" size="sm" onClick={() => setLpWeek(wk)}>This week</Button>}
                <a href="/dashboard/lesson-plans" className="text-emerald-400 text-sm underline sm:ml-auto">Open the upload form →</a>
              </div>

              {/* Course selector — defaults to today's working course, switchable */}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Label className="text-xs text-navy-300">Course</Label>
                <Select value={lpCourse} onValueChange={(v) => v && setLpCourse(v)}>
                  <SelectTrigger className="h-8 w-full sm:w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All courses</SelectItem>
                    {COURSES.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                  </SelectContent>
                </Select>
                {lpCourse === todaysCourseId && <span className="text-xs text-navy-400">today&apos;s working course</span>}
              </div>

              {/* Summary */}
              <div className="grid sm:grid-cols-3 gap-3 mt-4">
                <StatCard label={`Lesson plan submitted (of ${lpTracker.rows.length})`} value={lpTracker.planCount} />
                <StatCard label={`PPT submitted (of ${lpTracker.rows.length})`} value={lpTracker.pptCount} />
                <StatCard label={`Both submitted (of ${lpTracker.rows.length})`} value={lpTracker.bothCount} />
              </div>

              {/* Per-course breakdown */}
              {lpLoading ? (
                <div className="flex items-center gap-2 py-6 text-navy-300"><Loader2 className="h-4 w-4 animate-spin" /> Loading submissions…</div>
              ) : (
                <div className="mt-4 space-y-5">
                  {lpByCourse.groups.filter((g) => lpCourse === "all" || g.course.id === lpCourse).map(({ course, subs, planCount, pptCount }) => (
                    <div key={course.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <h4 className="font-semibold text-navy-100">{course.title}</h4>
                        <span className="text-xs text-navy-300">
                          {subs.length} submission{subs.length === 1 ? "" : "s"} · Plan {planCount} · PPT {pptCount}
                        </span>
                      </div>
                      {subs.length === 0 ? (
                        <p className="text-sm text-navy-400">No submissions for this course this week.</p>
                      ) : (
                        <div className="overflow-x-auto"><SubmissionTable subs={subs} /></div>
                      )}
                    </div>
                  ))}

                  {lpCourse === "all" && lpByCourse.unassigned.length > 0 && (
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <h4 className="font-semibold text-navy-100">Unassigned course</h4>
                        <span className="text-xs text-navy-300">
                          {lpByCourse.unassigned.length} submission{lpByCourse.unassigned.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="overflow-x-auto"><SubmissionTable subs={lpByCourse.unassigned} /></div>
                    </div>
                  )}

                  {/* Teachers with nothing submitted this week */}
                  {lpTracker.rows.some((r) => r.subs.length === 0) && (
                    <div>
                      <p className="text-xs text-navy-400 mb-1">Not submitted this week:</p>
                      <p className="text-sm text-amber-300">
                        {lpTracker.rows.filter((r) => r.subs.length === 0).map((r) => r.name).join(", ")}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </SectionCard>
          </TabsContent>

          {/* ── Assignments (item 11) ── */}
          <TabsContent value="assignments" className="space-y-4">
            <SectionCard title="Teacher forwarded today's assignment?" icon={<Users className="h-4 w-4" />}>
              {/* Course selector — defaults to today's working course, switchable */}
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Label className="text-xs text-navy-300">Course</Label>
                <Select value={assignCourse} onValueChange={(v) => v && setAssignCourse(v)}>
                  <SelectTrigger className="h-8 w-full sm:w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All courses</SelectItem>
                    {COURSES.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                  </SelectContent>
                </Select>
                {assignCourse === todaysCourseId && <span className="text-xs text-navy-400">today&apos;s working course</span>}
              </div>
              <ScheduleNote showAll={showAllSchedule} onToggle={setShowAllSchedule} dow={todayDow} />
              <div className="space-y-2">
                {visibleClasses.filter((c) => assignCourse === "all" || c.courseId === assignCourse).length === 0 && (
                  <p className="text-sm text-navy-400">No classes scheduled today for this course. Tick &ldquo;show all&rdquo; above, or pick another course.</p>
                )}
                {visibleClasses.filter((c) => assignCourse === "all" || c.courseId === assignCourse).map((c) => {
                  const row = draft.assignments.find((a) => a.classId === c.id)
                  return (
                    <div key={c.id} className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 w-full sm:w-64 min-w-0">
                        <input type="checkbox" checked={row?.assignmentForwarded || false} disabled={locked}
                          onChange={(e) => setAssignment(c.id, { assignmentForwarded: e.target.checked })} />
                        <span className="truncate">{c.name}</span>
                      </label>
                      <Input className="flex-1 min-w-0" placeholder="Remarks" value={row?.remarks || ""} disabled={locked}
                        onChange={(e) => setAssignment(c.id, { remarks: e.target.value })} />
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          </TabsContent>

          {/* ── Pre-submit checklist — the final tab, after Assignments. Office
              staff review each section, then tick them here to enable Submit. ── */}
          <TabsContent value="checklist" className="space-y-4">
            <Card className="border-navy-700/60">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold flex items-center gap-2 min-w-0">
                    <CheckCircle2 className={`h-4 w-4 shrink-0 ${allChecked ? "text-emerald-500" : "text-navy-300"}`} />
                    <span className="truncate">Pre-submit checklist</span>
                  </h2>
                  <span className={`text-xs shrink-0 ${allChecked ? "text-emerald-400" : "text-navy-300"}`}>
                    {checkedCount}/{CHECKLIST_ITEMS.length} reviewed
                  </span>
                </div>
                <p className="text-xs text-navy-300">Review and tick each section before submitting.</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {CHECKLIST_ITEMS.map(({ key, label, icon: Icon }) => {
                    const done = checklist[key]
                    return (
                      <button
                        key={key} type="button" disabled={locked} onClick={() => toggleCheck(key)}
                        aria-pressed={done}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-left transition-colors w-full min-w-0
                          ${done
                            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                            : "border-navy-700/60 bg-navy-800/40 text-navy-200 hover:border-navy-500"}
                          disabled:opacity-60 disabled:cursor-not-allowed`}
                      >
                        {done
                          ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                          : <Circle className="h-4 w-4 shrink-0 text-navy-400" />}
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{label}</span>
                      </button>
                    )
                  })}
                </div>
                {!allChecked && (
                  <p className="text-xs text-amber-300">
                    Tick every section above to enable the Submit button.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

// ── Small presentational helpers ──
// A file link that prefers the Drive URL, else opens a signed Storage URL.
function FileLink({ label, url, path, name }: { label: string; url?: string; path?: string; name?: string }) {
  if (url) return <a className="text-emerald-400 underline" href={url} target="_blank" rel="noreferrer">{label}</a>
  if (path) {
    return (
      <button className="text-emerald-400 underline" onClick={async () => {
        const signed = await getLessonPlanUrl(path)
        if (signed) window.open(signed, "_blank", "noopener")
        else toast.error("Could not open the file.")
      }}>{label}</button>
    )
  }
  return name ? <span className="text-navy-300">{label}</span> : null
}

// Toggle + caption controlling whether only today's scheduled courses/classes
// show, or every one (default: today's schedule).
function ScheduleNote({ showAll, onToggle, dow }: { showAll: boolean; onToggle: (v: boolean) => void; dow: number }) {
  const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dow]
  return (
    <label className="flex items-center gap-2 text-xs text-navy-300 mb-2">
      <input type="checkbox" checked={showAll} onChange={(e) => onToggle(e.target.checked)} />
      <span>{showAll ? "Showing all courses/classes." : `Showing today's schedule (${dayName}) only.`} Tick to show all.</span>
    </label>
  )
}

// A table of lesson-plan / PPT submissions (one row per submission), shared by
// the per-course breakdown in the Lesson plans tab.
function SubmissionTable({ subs }: { subs: db.LessonPlanSubmission[] }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-navy-300">
        <th className="py-2 pr-3">Teacher</th>
        <th className="pr-3">Lesson plan</th>
        <th className="pr-3">PPT</th>
        <th className="pr-3">Subject</th>
        <th className="pr-3">Files</th>
      </tr></thead>
      <tbody>
        {subs.map((s) => (
          <tr key={s.id} className="border-t border-navy-700/40">
            <td className="py-2 pr-3 truncate max-w-[160px]">{s.teacherName || s.teacherEmail || "—"}</td>
            <td className="pr-3"><SubBadge ok={!!(s.lessonPlanName || s.lessonPlanUrl || s.lessonPlanPath)} /></td>
            <td className="pr-3"><SubBadge ok={!!(s.pptName || s.pptUrl || s.pptPath)} /></td>
            <td className="pr-3 text-navy-200">{s.subject}{s.grade ? ` (${s.grade})` : ""}</td>
            <td className="pr-3 space-x-2 whitespace-nowrap">
              <FileLink label="Plan" url={s.lessonPlanUrl} path={s.lessonPlanPath} name={s.lessonPlanName} />
              <FileLink label="PPT" url={s.pptUrl} path={s.pptPath} name={s.pptName} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// A compact yes/no badge for the lesson-plan tracker (submitted vs not).
function SubBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Yes</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-navy-400">— No</span>
  )
}

function SectionCard({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">{icon}{title}</h3>
        {children}
      </CardContent>
    </Card>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-navy-300">{label}</div>
    </CardContent></Card>
  )
}

function AttList({ rows, classNameMap, getReason, setReason, locked }: {
  rows: { studentId: string; name: string; classId: string; time?: string }[]
  classNameMap: Record<string, string>
  getReason: (s: { studentId: string; name: string; classId: string }) => string
  setReason: (s: { studentId: string; name: string; classId: string }, v: string) => void
  locked: boolean
}) {
  if (rows.length === 0) return <p className="text-sm text-navy-400">None today.</p>
  return (
    <div className="space-y-2">
      {rows.map((s) => (
        <div key={s.studentId + s.classId} className="flex flex-wrap items-center gap-2">
          <span className="w-full sm:w-48 min-w-0 truncate">{s.name}</span>
          <span className="w-full sm:w-40 min-w-0 truncate text-navy-300 text-sm">{classNameMap[s.classId] || s.classId}</span>
          {s.time && (
            <span className="w-full sm:w-auto shrink-0 inline-flex items-center gap-1 text-red-400 font-semibold text-sm">
              <Clock className="h-3.5 w-3.5" /> {s.time}
            </span>
          )}
          <Input className="flex-1 min-w-0" placeholder="Reason" defaultValue={getReason(s)} disabled={locked}
            onBlur={(e) => setReason(s, e.target.value)} />
        </div>
      ))}
    </div>
  )
}
