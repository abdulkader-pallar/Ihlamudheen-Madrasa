"use client"

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ClipboardCheck,
  Save,
  ChevronLeft,
  Users,
  CheckCircle2,
  RefreshCw,
  WifiOff,
  Loader2,
  AlertCircle,
  ChevronDown,
  CalendarDays,
  Clock,
  Wifi,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  initialCourses,
  initialTeachers,
  type CourseData,
  SATURDAY_CLASSES,
  SUNDAY_CLASSES,
  ONLINE_DEFAULT_CLASSES,
} from "@/data/courses"
import { resolveTeacherId } from "@/lib/teacher-identity"
import * as db from "@/lib/db"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { computeLateness, getProgramStart, formatTime12h, formatMinutesLate } from "@/lib/late-policy"
import { ArrivalTimeInput } from "@/components/arrival-time-input"
import { toast } from "sonner"

type ViewState =
  | { page: "classes" }
  | { page: "attendance"; courseId: string; classId: string }

// Where unsaved attendance edits are stashed so they survive an app switch.
// Mobile browsers can freeze or fully reload a backgrounded tab (e.g. when the
// user pops out to WhatsApp), which would otherwise wipe everything typed but
// not yet submitted. We persist the working draft here and restore it on
// return, and the draft is cleared only when the user submits or resets.
const DRAFT_KEY = "madrasa:attendance-draft"

type AttendanceDraft = {
  courseId: string
  classId: string
  selectedDate: string
  monthAttendance: Record<string, Record<string, "present" | "absent" | "late">>
  monthRemarks: Record<string, Record<string, string>>
  monthArrival: Record<string, Record<string, string>>
  savedAt: number
}

export default function AttendancePage() {
  // BUG 6 FIX: role-based access control
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const canManage = role === "admin" || role === "teacher" || role === "accountant"

  const [courses, setCourses] = useState<CourseData[]>(initialCourses)
  const [useSupabase, setUseSupabase] = useState(false)
  const [dbLoading, setDbLoading] = useState(true)
  const [dbOffline, setDbOffline] = useState(false)
  const [view, setView] = useState<ViewState>({ page: "classes" })

  // Class-list filter — mirrors the dashboard widget's filter so admins
  // can scope the picker to one institution (or Ihlamudheen Madrasa day/online).
  // Program titles are user-configurable, so this is a plain string (the filter
  // options come from the INSTITUTIONS array + the madrasa_* sub-filters).
  type AttFilter = string
  // Default filter matches today's schedule — same logic as the dashboard widget.
  function pickDefaultAttFilter(): AttFilter {
    const now = new Date()
    const dow = now.getDay() // 0=Sun,1=Mon…5=Fri,6=Sat
    if (dow === 6) return "madrasa_saturday"
    if (dow === 0) return "madrasa_sunday"
    if (dow === 5) return now.getHours() < 15 ? "Ihlamudheen Madrasa" : "Ihlamudheen Madrasa"
    return "Ihlamudheen Madrasa" // Mon–Thu
  }
  const [attFilter, setAttFilter] = useState<AttFilter>(() => pickDefaultAttFilter())

  // ONLINE months (app_settings.online_checkin_months, e.g. July/August 2026):
  // every class meets on Google Meet, so the weekday-based default above is
  // wrong — default to ALL courses and ask the teacher to pick theirs instead.
  // A manual dropdown choice always wins (filterTouchedRef).
  const [isOnlineMonth, setIsOnlineMonth] = useState(false)
  const filterTouchedRef = useRef(false)
  useEffect(() => {
    db.fetchAppSetting("online_checkin_months").then((v) => {
      try {
        const months = JSON.parse(v ?? "[]")
        const thisMonth = new Date().toISOString().slice(0, 7)
        if (Array.isArray(months) && months.includes(thisMonth)) {
          setIsOnlineMonth(true)
          if (!filterTouchedRef.current) setAttFilter("all")
        }
      } catch { /* malformed setting — keep the weekday default */ }
    })
  }, [])
  const selectAttFilter = (f: AttFilter) => {
    filterTouchedRef.current = true
    setAttFilter(f)
  }

  // Which courses does the signed-in TEACHER actually teach (by classIds)?
  //   • exactly one course  → auto-select it; only the CLASS is asked
  //   • multiple courses    → ask for course first, showing only THEIR courses
  //   • admin/accountant or unknown → null → full course picker
  const INSTITUTION_KEYS = useMemo(
    () => [
      "Ihlamudheen Madrasa",
      "Ihlamudheen Madrasa",
      "Ihlamudheen Madrasa",
      "CIBIS CERTIFICATION",
    ] as const,
    [],
  )
  const myCourseKeys = useMemo<Set<string> | null>(() => {
    if (!user || role !== "teacher") return null
    const tid = resolveTeacherId(user)
    const t = tid ? initialTeachers.find((x) => x.id === tid) : null
    if (!t || t.classIds.length === 0) return null
    const keys = new Set<string>()
    for (const course of courses) {
      if (course.classes.some((c) => t.classIds.includes(c.id))) {
        keys.add(course.title.toUpperCase().trim())
      }
    }
    return keys.size > 0 ? keys : null
  }, [user, role, courses])

  // Single-course teachers skip the course step — their course is the default.
  useEffect(() => {
    if (!isOnlineMonth || filterTouchedRef.current) return
    if (myCourseKeys && myCourseKeys.size === 1) {
      const only = Array.from(myCourseKeys)[0]
      if ((INSTITUTION_KEYS as readonly string[]).includes(only)) {
        setAttFilter(only as AttFilter)
      }
    }
  }, [isOnlineMonth, myCourseKeys, INSTITUTION_KEYS])
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0])
  // The date picker edits pendingDate only — selectedDate (the one actual
  // editable column) only changes when "Apply" is clicked, so browsing the
  // picker never accidentally unlocks the wrong day.
  const [pendingDate, setPendingDate] = useState(new Date().toISOString().split("T")[0])
  // monthAttendance is the single source of truth for the grid.
  // Pre-seeded from DB data when a class is opened, so every cell
  // shows the saved value even before the user touches it.
  const [monthAttendance, setMonthAttendance] = useState<Record<string, Record<string, "present" | "absent" | "late">>>({})
  // Per-date, per-student remarks (required when status = "absent").
  // Mirrors monthAttendance shape: { "2026-04-08": { studentId: "Sick" } }
  const [monthRemarks, setMonthRemarks] = useState<Record<string, Record<string, string>>>({})
  // Per-date, per-student arrival time "HH:MM". Drives late detection.
  // { "2026-04-08": { studentId: "09:12" } }
  const [monthArrival, setMonthArrival] = useState<Record<string, Record<string, string>>>({})
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [saving, setSaving] = useState(false)
  // BUG 5 FIX: track whether user actually made changes
  const [isDirty, setIsDirty] = useState(false)
  // Mirror of isDirty readable from stable callbacks (real-time/visibility
  // re-seed) without re-subscribing — used to avoid clobbering unsaved edits.
  const isDirtyRef = useRef(false)
  useEffect(() => { isDirtyRef.current = isDirty }, [isDirty])
  // Track who marked attendance for each class+date
  const [attendanceMarkers, setAttendanceMarkers] = useState<Record<string, string>>({}) // date → name
  // Per-class last-marked info for class list (classId → { date, by })
  const [classLastMarked, setClassLastMarked] = useState<Record<string, { date: string; by: string }>>({})

  // Derive current user's display name for "marked by"
  const markedByName = user
    ? (user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Unknown")
    : "Unknown"

  // ── Fetch all data from Supabase (3 batched queries, not N×2) ────────
  const loadAllData = useCallback(async () => {
    const ready = await db.checkSupabase()
    if (!ready) {
      setDbOffline(true)
      setDbLoading(false)
      return
    }
    setUseSupabase(true)
    setDbOffline(false)

    // 1. Course structure (seeds DB if empty)
    const dbCourses = await db.fetchCoursesFromDB()
    const allClassIds = dbCourses.flatMap((c) => c.classes.map((cl) => cl.id))
    const currentMonth = new Date().toISOString().slice(0, 7)

    // 2+3. One batched query for this month's attendance AND one for last markers
    const [attendanceByClass, lastMarkedMap] = await Promise.all([
      db.fetchAllClassesAttendanceForMonth(allClassIds, currentMonth),
      db.fetchAllClassLastMarkers(allClassIds),
    ])

    setCourses(dbCourses.map((course) => ({
      ...course,
      classes: course.classes.map((cls) => ({
        ...cls,
        // Seed with this month's records so isMarkedToday works on the class list
        attendance: attendanceByClass[cls.id] ?? cls.attendance,
      })),
    })))
    setClassLastMarked(lastMarkedMap)
    setDbLoading(false)
  }, [])

  useEffect(() => { loadAllData() }, [loadAllData])

  // ── Deep-link support: auto-open a specific class if ?classId=… is in URL ──
  // Lets the dashboard's "Today's Class Attendance Status" cards link
  // directly into the matching class+date view. Must also pre-seed
  // monthAttendance so the saved P/A cells are visible immediately.
  const [deepLinkHandled, setDeepLinkHandled] = useState(false)
  useEffect(() => {
    if (dbLoading) return
    if (deepLinkHandled) return
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const wantedClassId = params.get("classId")
    const wantedDate = params.get("date")
    if (!wantedClassId) {
      setDeepLinkHandled(true)
      return
    }
    const match = courses.find((c) => c.classes.some((cl) => cl.id === wantedClassId))
    if (!match) return
    const cls = match.classes.find((cl) => cl.id === wantedClassId)
    if (!cls) return
    const dateStr = wantedDate || new Date().toISOString().split("T")[0]
    const month = dateStr.slice(0, 7)
    const { seededStatus, seededRemarks, seededArrival } = buildSeededAttendance(cls.attendance, month)
    setMonthAttendance(seededStatus)
    setMonthRemarks(seededRemarks)
    setMonthArrival(seededArrival)
    setSelectedDate(dateStr)
    setPendingDate(dateStr)
    db.fetchAttendanceMarkers(cls.id).then((markers) => setAttendanceMarkers(markers))
    setView({ page: "attendance", courseId: match.id, classId: wantedClassId })
    setDeepLinkHandled(true)
  }, [dbLoading, courses, deepLinkHandled])

  // ── Real-time subscription ─────────────────────────────
  // When another device saves attendance, refetch from DB and re-seed the grid.
  const reseedCurrentView = useCallback((updatedCourses: CourseData[], force = false) => {
    // Never overwrite the user's unsaved edits. A re-seed triggered by the tab
    // regaining focus (after an app switch) or by a real-time DB event must not
    // wipe times the user just typed. Only an explicit submit/reset forces it.
    if (!force && isDirtyRef.current) return
    setView((currentView) => {
      if (currentView.page === "attendance") {
        const cls = updatedCourses
          .find((c) => c.id === currentView.courseId)
          ?.classes.find((c) => c.id === currentView.classId)
        if (cls) {
          const month = selectedDate.slice(0, 7)
          const { seededStatus, seededRemarks, seededArrival } = buildSeededAttendance(cls.attendance, month)
          setMonthAttendance(seededStatus)
          setMonthRemarks(seededRemarks)
          setMonthArrival(seededArrival)
        }
      }
      return currentView
    })
  }, [selectedDate])

  const reloadAndReseed = useCallback(async (force = false) => {
    const ready = await db.checkSupabase()
    if (!ready) return

    const allClassIds = initialCourses.flatMap((c) => c.classes.map((cl) => cl.id))
    const currentMonth = new Date().toISOString().slice(0, 7)
    const attendanceByClass = await db.fetchAllClassesAttendanceForMonth(allClassIds, currentMonth)

    setCourses((prev) => {
      const updated = prev.map((course) => ({
        ...course,
        classes: course.classes.map((cls) => ({
          ...cls,
          attendance: attendanceByClass[cls.id] ?? cls.attendance,
        })),
      }))
      reseedCurrentView(updated, force)
      return updated
    })
  }, [reseedCurrentView])

  useEffect(() => {
    if (!useSupabase) return
    const sub = db.subscribeToTable("student_attendance", () => { reloadAndReseed() })
    return () => { sub.unsubscribe() }
  }, [useSupabase, reloadAndReseed])

  // Also refresh when tab becomes visible (user navigates back from another page).
  // reloadAndReseed() respects unsaved edits (isDirty) and will not overwrite a
  // draft in progress, so returning from another app keeps everything typed.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible") reloadAndReseed()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => { document.removeEventListener("visibilitychange", onVisibility) }
  }, [reloadAndReseed])

  // ── Draft persistence ──────────────────────────────────
  // Stash unsaved edits to localStorage so they survive even a hard reload of a
  // backgrounded tab (common on mobile when switching to another app). The
  // draft is written on every change while editing and cleared on submit/reset.
  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* storage may be unavailable */ }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (view.page !== "attendance") return
    // Only persist while there are unsaved edits — a clean view has nothing to
    // protect, and writing would just shadow fresh DB data on the next open.
    if (!isDirty) return
    const draft: AttendanceDraft = {
      courseId: view.courseId,
      classId: view.classId,
      selectedDate,
      monthAttendance,
      monthRemarks,
      monthArrival,
      savedAt: Date.now(),
    }
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch { /* ignore quota/availability */ }
  }, [view, isDirty, selectedDate, monthAttendance, monthRemarks, monthArrival])

  // Restore a saved draft once, after the first data load, if the tab was
  // reloaded mid-edit. Re-opens the same class+date with the unsaved marks.
  const [draftRestored, setDraftRestored] = useState(false)
  useEffect(() => {
    if (dbLoading) return
    if (draftRestored) return
    if (typeof window === "undefined") { setDraftRestored(true); return }
    // A deep-link (?classId=) takes precedence — let that effect drive the view.
    const params = new URLSearchParams(window.location.search)
    if (params.get("classId")) { setDraftRestored(true); return }
    let draft: AttendanceDraft | null = null
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") } catch { draft = null }
    if (!draft || !draft.classId) { setDraftRestored(true); return }
    const course = courses.find((c) => c.id === draft!.courseId)
    const cls = course?.classes.find((c) => c.id === draft!.classId)
    if (!cls) { clearDraft(); setDraftRestored(true); return }
    setMonthAttendance(draft.monthAttendance || {})
    setMonthRemarks(draft.monthRemarks || {})
    setMonthArrival(draft.monthArrival || {})
    setSelectedDate(draft.selectedDate)
    setPendingDate(draft.selectedDate)
    setIsDirty(true)
    // Pull full history + markers so read-only months and "marked by" are correct
    // (the draft only carries the dates the user actually touched).
    db.fetchAttendanceMarkers(cls.id).then((markers) => setAttendanceMarkers(markers))
    db.fetchAllAttendance(cls.id).then((full) => {
      setCourses((prev) => prev.map((co) => ({
        ...co,
        classes: co.classes.map((c) => (c.id === cls.id ? { ...c, attendance: full } : c)),
      })))
    })
    setView({ page: "attendance", courseId: draft.courseId, classId: draft.classId })
    setDeepLinkHandled(true)
    setDraftRestored(true)
  }, [dbLoading, courses, draftRestored, clearDraft])

  // ── Helper: build monthAttendance + monthRemarks from saved DB records ──
  // Seeds every saved cell so the grid shows it immediately.
  // BUG 1 FIX: No longer auto-seeds "present" — cells are blank until explicitly marked.
  function buildSeededAttendance(
    attendance: CourseData["classes"][number]["attendance"],
    month: string,
  ): {
    seededStatus: Record<string, Record<string, "present" | "absent" | "late">>
    seededRemarks: Record<string, Record<string, string>>
    seededArrival: Record<string, Record<string, string>>
  } {
    const seededStatus: Record<string, Record<string, "present" | "absent" | "late">> = {}
    const seededRemarks: Record<string, Record<string, string>> = {}
    const seededArrival: Record<string, Record<string, string>> = {}
    attendance
      .filter((a) => a.date.startsWith(month))
      .forEach((a) => {
        seededStatus[a.date] = {}
        Object.entries(a.records).forEach(([sid, status]) => {
          if (status === "present" || status === "absent" || status === "late") {
            seededStatus[a.date][sid] = status
          }
        })
        if (a.remarks) {
          seededRemarks[a.date] = { ...a.remarks }
        }
        if (a.arrivalTimes) {
          seededArrival[a.date] = { ...a.arrivalTimes }
        }
      })
    return { seededStatus, seededRemarks, seededArrival }
  }

  const getClass = (courseId: string, classId: string) =>
    courses.find((c) => c.id === courseId)?.classes.find((c) => c.id === classId)

  // ── Submit attendance ──────────────────────────────────
  // BUG 2 FIX: Only save the selected date's records to DB, not the entire month.
  const handleSubmitAttendance = async (courseId: string, classId: string) => {
    if (!canManage) { toast.error("Only Admin and Teacher can save attendance"); return }

    // Hard guard: every "absent" must have a non-empty remark before save.
    const dateRecords = monthAttendance[selectedDate] || {}
    const dateRemarks = monthRemarks[selectedDate] || {}
    const dateArrival = monthArrival[selectedDate] || {}
    const missingRemarkIds = Object.entries(dateRecords)
      .filter(([sid, status]) => status === "absent" && !(dateRemarks[sid] || "").trim())
      .map(([sid]) => sid)
    if (missingRemarkIds.length > 0) {
      const courseForCls = courses.find((c) => c.id === courseId)
      const cls = courseForCls?.classes.find((c) => c.id === classId)
      const names = missingRemarkIds
        .map((sid) => cls?.students.find((s) => s.id === sid)?.name || sid)
        .join(", ")
      toast.error(`Add a remark for absent student${missingRemarkIds.length === 1 ? "" : "s"}: ${names}`)
      return
    }

    setSaving(true)
    if (useSupabase) {
      // Build a single-date record to upsert
      if (Object.keys(dateRecords).length > 0) {
        const { error } = await db.saveAttendance(
          classId,
          { [selectedDate]: dateRecords },
          markedByName,
          { [selectedDate]: dateRemarks },
          { [selectedDate]: dateArrival },
        )
        if (error) {
          toast.error("Failed to save attendance to database")
          setSaving(false)
          return
        }
      }
      // Reload markers so "Last marked by" updates immediately
      const updatedMarkers = await db.fetchAttendanceMarkers(classId)
      setAttendanceMarkers(updatedMarkers)
      const markerDates = Object.keys(updatedMarkers).sort()
      if (markerDates.length > 0) {
        const lastDate = markerDates[markerDates.length - 1]
        setClassLastMarked((prev) => ({ ...prev, [classId]: { date: lastDate, by: updatedMarkers[lastDate] } }))
      }
    }
    setCourses((prev) =>
      prev.map((course) =>
        course.id === courseId
          ? {
              ...course,
              classes: course.classes.map((cls) => {
                if (cls.id !== classId) return cls
                const updated = [...cls.attendance]
                Object.entries(monthAttendance).forEach(([date, records]) => {
                  if (Object.keys(records).length === 0) return
                  const arrivalForDate = monthArrival[date]
                  const hasArrival = arrivalForDate && Object.keys(arrivalForDate).length > 0
                  const entry = {
                    date,
                    records: { ...records },
                    ...(hasArrival ? { arrivalTimes: { ...arrivalForDate } } : {}),
                  }
                  const idx = updated.findIndex((a) => a.date === date)
                  if (idx >= 0) {
                    updated[idx] = entry
                  } else {
                    updated.push(entry)
                  }
                })
                updated.sort((a, b) => a.date.localeCompare(b.date))
                return { ...cls, attendance: updated }
              }),
            }
          : course
      )
    )
    // Edits are now saved — drop the local draft and force a fresh re-seed so
    // the editor reflects canonical DB state (the dirty guard would skip it).
    clearDraft()
    setIsDirty(false)
    if (useSupabase) await reloadAndReseed(true)
    setSaving(false)
    setSubmitSuccess(true)
    // Mobile-visible popup confirmation
    toast.success("Attendance marked successfully", {
      description: "All records saved and synced to the database.",
      duration: 5000,
    })
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" })
    setTimeout(() => setSubmitSuccess(false), 5000)
  }

  // BUG 6 FIX: Role guard — only admin, teacher, accountant can access
  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Users className="size-12 text-navy-300 dark:text-navy-600 mb-3" />
        <p className="text-navy-500 dark:text-navy-400">Only Admin and Teacher can access Student Attendance.</p>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: CLASS SELECTION
  // ══════════════════════════════════════════════════════════
  if (view.page === "classes") {
    const everyClass = courses.flatMap((course) =>
      course.classes.map((cls) => ({ ...cls, courseId: course.id, courseTitle: course.title }))
    )
    // Apply institution / day filter
    const matches = (c: { classId: string; courseTitle: string } | { id: string; courseTitle: string }) => {
      const cid = "classId" in c ? c.classId : c.id
      const title = c.courseTitle.toUpperCase().trim()
      if (attFilter === "all") return true
      if (attFilter === "madrasa_saturday") return title === "Ihlamudheen Madrasa" && SATURDAY_CLASSES.includes(cid)
      if (attFilter === "madrasa_sunday") return title === "Ihlamudheen Madrasa" && SUNDAY_CLASSES.includes(cid)
      if (attFilter === "madrasa_online") return title === "Ihlamudheen Madrasa" && ONLINE_DEFAULT_CLASSES.includes(cid)
      return title === attFilter
    }
    const allClasses = everyClass.filter(matches)
    const filterLabel: string = (() => {
      if (attFilter === "all") return isOnlineMonth ? "Online — Choose Course" : "All Institutions"
      if (attFilter === "madrasa_saturday") return "Ihlamudheen — Saturday"
      if (attFilter === "madrasa_sunday") return "Ihlamudheen — Sunday"
      if (attFilter === "madrasa_online") return "Ihlamudheen — Online"
      if (attFilter === "Ihlamudheen Madrasa") return "Ihlamudheen Madrasa"
      if (attFilter === "Ihlamudheen Madrasa") return "Ihlamudheen Madrasa"
      if (attFilter === "CIBIS CERTIFICATION") return "CBIS"
      return "Ihlamudheen Madrasa"
    })()

    // Today's info for "marked / remaining" badges
    const todayStr = new Date().toISOString().split("T")[0]
    const todayDow = new Date(todayStr + "T12:00:00").getDay() // 0=Sun, 6=Sat
    const isTodayWorkingDay = todayDow === 6 || todayDow === 0

    // Check if a class has attendance recorded for today
    const isMarkedToday = (att: CourseData["classes"][number]["attendance"]) =>
      att.some((a) => a.date === todayStr && Object.keys(a.records).length > 0)

    // For the progress summary: only count classes expected today (Sat or Sun schedule)
    const todayScheduleKey = todayDow === 6 ? "Saturday" : todayDow === 0 ? "Sunday" : null
    const todayClasses = todayScheduleKey
      ? allClasses.filter((c) => c.schedule.startsWith(todayScheduleKey))
      : []
    const markedTodayCount = todayClasses.filter((c) => isMarkedToday(c.attendance)).length

    return (
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
                <ClipboardCheck className="size-8 text-emerald-500" /> Attendance
              </h1>
              <p className="mt-1 text-navy-600 dark:text-navy-300">
                {isOnlineMonth
                  ? "Online month — select your course to take attendance."
                  : "Select a class to take or view attendance."}
              </p>
              {isOnlineMonth && (
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-teal-500/15 px-3 py-1 text-xs font-medium text-teal-600 dark:text-teal-400">
                  <Wifi className="size-3.5" />
                  All classes meet on Google Meet this month
                </span>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors h-9 px-3.5 text-sm",
                  "border border-input bg-background hover:bg-accent hover:text-accent-foreground"
                )}
                title="Filter classes by institution or day"
              >
                <span className="text-navy-500 dark:text-navy-400">Show:</span>
                <span className="font-semibold">{filterLabel}</span>
                <ChevronDown className="size-3.5 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[280px] p-1">
                <DropdownMenuItem
                  onClick={() => selectAttFilter("all")}
                  className={cn("cursor-pointer py-2", attFilter === "all" && "bg-accent")}
                >
                  <ClipboardCheck className="size-4 mr-2.5 text-navy-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">All Institutions</p>
                    <p className="text-[10.5px] text-muted-foreground">{everyClass.length} classes total</p>
                  </div>
                </DropdownMenuItem>

                <div className="px-2 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-wider text-navy-400">By Institution</div>
                {([
                  { key: "Ihlamudheen Madrasa",             label: "Ihlamudheen Madrasa",             dot: "bg-emerald-500" },
                  { key: "Ihlamudheen Madrasa", label: "Ihlamudheen Madrasa", dot: "bg-blue-500" },
                  { key: "Ihlamudheen Madrasa",     label: "Ihlamudheen Madrasa",     dot: "bg-violet-500" },
                  { key: "CIBIS CERTIFICATION",        label: "CBIS",                      dot: "bg-amber-500" },
                ] as const).map((inst) => {
                  const count = everyClass.filter((c) => c.courseTitle.toUpperCase().trim() === inst.key).length
                  return (
                    <DropdownMenuItem
                      key={inst.key}
                      onClick={() => selectAttFilter(inst.key)}
                      className={cn("cursor-pointer py-2", attFilter === inst.key && "bg-accent")}
                    >
                      <span className={cn("size-2.5 rounded-full mr-2.5 shrink-0", inst.dot)} />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{inst.label}</p>
                        <p className="text-[10.5px] text-muted-foreground">{count} class{count === 1 ? "" : "es"}</p>
                      </div>
                    </DropdownMenuItem>
                  )
                })}

                <div className="px-2 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-wider text-navy-400">Ihlamudheen Madrasa — by day</div>
                {([
                  { key: "madrasa_saturday", label: "Saturday classes", ids: SATURDAY_CLASSES },
                  { key: "madrasa_sunday",   label: "Sunday classes",   ids: SUNDAY_CLASSES },
                  { key: "madrasa_online",   label: "Online classes",   ids: ONLINE_DEFAULT_CLASSES },
                ] as const).map((sub) => {
                  const count = everyClass.filter(
                    (c) => c.courseTitle.toUpperCase().trim() === "Ihlamudheen Madrasa" && sub.ids.includes(c.id),
                  ).length
                  return (
                    <DropdownMenuItem
                      key={sub.key}
                      onClick={() => selectAttFilter(sub.key)}
                      className={cn("cursor-pointer py-2", attFilter === sub.key && "bg-accent")}
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
          </div>
        </motion.div>

        {/* DB status banners so the user always knows what's happening */}
        {dbLoading && (
          <div className="flex items-center gap-2 text-sm text-navy-500 dark:text-navy-400">
            <Loader2 className="size-4 animate-spin" />
            Syncing with database…
          </div>
        )}
        {!dbLoading && useSupabase && (
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            Live — synced across all devices
          </div>
        )}
        {!dbLoading && !useSupabase && !dbOffline && (
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <span className="size-2 rounded-full bg-amber-500" />
            Local only — changes will not sync to other devices
          </div>
        )}
        {dbOffline && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <WifiOff className="size-4 shrink-0" />
            Database unavailable — showing locally saved data only. Changes will not sync across devices.
            <button
              className="ml-auto underline underline-offset-2"
              onClick={() => { setDbLoading(true); setDbOffline(false); loadAllData() }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Today's progress summary — only shown on working days */}
        {!dbLoading && isTodayWorkingDay && todayClasses.length > 0 && (
          <div className={cn(
            "flex items-center gap-4 rounded-xl border px-5 py-3",
            markedTodayCount === todayClasses.length
              ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30"
              : "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30"
          )}>
            {markedTodayCount === todayClasses.length ? (
              <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
            ) : (
              <AlertCircle className="size-5 text-amber-500 shrink-0" />
            )}
            <div className="flex-1">
              <p className={cn(
                "text-sm font-semibold",
                markedTodayCount === todayClasses.length
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-amber-700 dark:text-amber-400"
              )}>
                {markedTodayCount === todayClasses.length
                  ? `All ${todayClasses.length} ${todayScheduleKey} classes marked today ✓`
                  : `${markedTodayCount} of ${todayClasses.length} ${todayScheduleKey} classes marked today`}
              </p>
              {markedTodayCount < todayClasses.length && (
                <p className="text-xs text-amber-600 dark:text-amber-300 mt-0.5">
                  Remaining: {todayClasses.filter((c) => !isMarkedToday(c.attendance)).map((c) => c.name).join(", ")}
                </p>
              )}
            </div>
            {/* Mini progress bar */}
            <div className="w-24 h-2 rounded-full bg-white/60 dark:bg-navy-700/60 overflow-hidden shrink-0">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  markedTodayCount === todayClasses.length ? "bg-emerald-500" : "bg-amber-400"
                )}
                style={{ width: `${(markedTodayCount / todayClasses.length) * 100}%` }}
              />
            </div>
            <span className={cn(
              "text-xs font-bold shrink-0",
              markedTodayCount === todayClasses.length ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
            )}>
              {markedTodayCount}/{todayClasses.length}
            </span>
          </div>
        )}

        {/* ONLINE MONTH — back to the course picker once a course is chosen */}
        {isOnlineMonth && attFilter !== "all" && (
          <button
            type="button"
            onClick={() => {
              // Counts as a manual choice — the single-course auto-default must
              // not snap the picker away on a later data refresh.
              filterTouchedRef.current = true
              setAttFilter("all")
            }}
            className="inline-flex items-center gap-1 text-sm font-medium text-teal-600 dark:text-teal-400 hover:underline"
          >
            <ChevronLeft className="size-4" /> Choose another course
          </button>
        )}

        {/* ONLINE MONTH — course selection step: ask which course FIRST,
            then show only that course's classes. */}
        {isOnlineMonth && attFilter === "all" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              { key: "Ihlamudheen Madrasa", label: "Ihlamudheen Madrasa", dot: "bg-emerald-500" },
              { key: "Ihlamudheen Madrasa",   label: "Ihlamudheen Madrasa",   dot: "bg-blue-500" },
              { key: "Ihlamudheen Madrasa",       label: "Ihlamudheen Madrasa",       dot: "bg-violet-500" },
              { key: "CIBIS CERTIFICATION",         label: "CBIS",                        dot: "bg-amber-500" },
            ] as const)
              .map((inst) => {
                const instClasses = everyClass.filter((c) => c.courseTitle.toUpperCase().trim() === inst.key)
                return {
                  ...inst,
                  count: instClasses.length,
                  students: instClasses.reduce((s, c) => s + c.students.length, 0),
                }
              })
              // Dual-course teachers choose among THEIR courses only;
              // admins/accountants (myCourseKeys=null) see every course.
              .filter((inst) => inst.count > 0 && (!myCourseKeys || myCourseKeys.has(inst.key)))
              .map((inst, i) => (
                <motion.div
                  key={inst.key}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Card
                    className="cursor-pointer transition-all hover:shadow-lg hover:ring-1 hover:ring-teal-500/40"
                    onClick={() => selectAttFilter(inst.key)}
                  >
                    <CardContent className="flex items-center gap-4 p-5">
                      <span className={cn("size-3 rounded-full shrink-0", inst.dot)} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-navy-900 dark:text-white truncate">{inst.label}</p>
                        <p className="text-xs text-navy-500 dark:text-navy-400 mt-0.5">
                          {inst.count} class{inst.count === 1 ? "" : "es"} · {inst.students} student{inst.students === 1 ? "" : "s"}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/15 px-2.5 py-1 text-[10px] font-semibold text-teal-600 dark:text-teal-400 shrink-0">
                        <Wifi className="size-3" /> Online
                      </span>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
          </div>
        ) : allClasses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="size-12 text-navy-300 dark:text-navy-600 mb-3" />
            <p className="text-navy-500 dark:text-navy-400">No classes found.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {allClasses.map((cls, i) => {
              const markedToday = isMarkedToday(cls.attendance)
              // Only show today status badge if this class is scheduled today
              const scheduledToday = todayScheduleKey
                ? cls.schedule.startsWith(todayScheduleKey)
                : false
              return (
              <motion.div
                key={cls.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <Card
                  className={cn(
                    "cursor-pointer transition-all hover:shadow-lg",
                    scheduledToday && !markedToday
                      ? "ring-2 ring-amber-400/60 dark:ring-amber-500/40 hover:ring-amber-400"
                      : "hover:ring-1 hover:ring-emerald-500/30"
                  )}
                  onClick={async () => {
                    const today = new Date().toISOString().split("T")[0]
                    const month = today.slice(0, 7)
                    // Load full attendance history for this class on-demand so
                    // the user can browse any past month without a stale snapshot.
                    const [fullAttendance, markers] = await Promise.all([
                      db.fetchAllAttendance(cls.id),
                      db.fetchAttendanceMarkers(cls.id),
                    ])
                    // Update this class's attendance in the courses state so
                    // month-switching in the grid always has fresh data.
                    setCourses((prev) => prev.map((course) => ({
                      ...course,
                      classes: course.classes.map((c) =>
                        c.id === cls.id ? { ...c, attendance: fullAttendance } : c
                      ),
                    })))
                    const { seededStatus, seededRemarks, seededArrival } = buildSeededAttendance(fullAttendance, month)
                    setMonthAttendance(seededStatus)
                    setMonthRemarks(seededRemarks)
                    setMonthArrival(seededArrival)
                    setSelectedDate(today)
                    setPendingDate(today)
                    setAttendanceMarkers(markers)
                    // Fresh open from the list starts clean — discard any leftover
                    // draft so it can't be mis-attributed to this class.
                    setIsDirty(false)
                    clearDraft()
                    setView({ page: "attendance", courseId: cls.courseId, classId: cls.id })
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-full",
                        scheduledToday && !markedToday
                          ? "bg-amber-100 dark:bg-amber-500/20"
                          : markedToday
                          ? "bg-emerald-100 dark:bg-emerald-500/20"
                          : "bg-navy-100 dark:bg-navy-700/40"
                      )}>
                        {scheduledToday && !markedToday ? (
                          <AlertCircle className="size-5 text-amber-500" />
                        ) : markedToday ? (
                          <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <ClipboardCheck className="size-5 text-navy-400 dark:text-navy-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-navy-900 dark:text-white">{cls.name}</h3>
                        <p className="text-xs text-navy-500 dark:text-navy-400">
                          {cls.students.length} students · {cls.schedule}
                        </p>
                      </div>
                      {/* Today's status pill — top right */}
                      {scheduledToday && (
                        <span className={cn(
                          "shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full",
                          markedToday
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
                        )}>
                          {markedToday ? "Done ✓" : "Pending"}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-navy-400 mt-2">{cls.courseTitle}</p>
                    {classLastMarked[cls.id] && (
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                        <CheckCircle2 className="size-2.5" />
                        Last marked by <span className="font-semibold">{classLastMarked[cls.id].by}</span>
                        {" "}on {new Date(classLastMarked[cls.id].date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </p>
                    )}
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
  // VIEW: ATTENDANCE GRID
  // ══════════════════════════════════════════════════════════
  if (view.page === "attendance") {
    const cls = getClass(view.courseId, view.classId)
    if (!cls) return null

    // Program-level late policy. CIBIS (and any untracked program) returns null,
    // in which case the arrival-time panel is hidden and only P/A apply.
    const courseTitle = courses.find((c) => c.id === view.courseId)?.title ?? ""
    const programStart = getProgramStart(courseTitle) // "HH:MM" | null
    const trackLate = programStart !== null

    const sortedStudents = [...cls.students].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    )

    const attendanceMonth = selectedDate.slice(0, 7)
    const selectedDay = parseInt(selectedDate.split("-")[2], 10)
    const [selYear, selMonth] = attendanceMonth.split("-").map(Number)
    const daysInMonth = new Date(selYear, selMonth, 0).getDate()
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
    const today = new Date()
    const todayDate = today.getDate()
    const isCurrentMonth = selYear === today.getFullYear() && selMonth === today.getMonth() + 1
    const isPastMonth = selYear < today.getFullYear() || (selYear === today.getFullYear() && selMonth < today.getMonth() + 1)
    const todayDay = isCurrentMonth ? todayDate : -1

    // getStatus reads ONLY from monthAttendance (pre-seeded from DB).
    // Cells are blank until explicitly marked — no auto-seeding of "present".
    const getStatus = (studentId: string, day: number): "present" | "absent" | "late" | "" => {
      const dateStr = `${attendanceMonth}-${String(day).padStart(2, "0")}`
      if (isFutureDay(day)) return ""
      const val = monthAttendance[dateStr]?.[studentId]
      if (val === "present" || val === "absent" || val === "late") return val
      return ""
    }

    const isFutureDay = (day: number) =>
      (!isCurrentMonth && !isPastMonth) || (isCurrentMonth && day > todayDate)

    // Only the applied date's column is editable — all others are read-only.
    const isEditableDay = (day: number) => day === selectedDay && !isFutureDay(day)

    // Commits pendingDate (the date-picker's draft value) as the active,
    // editable date. Browsing the picker alone never changes what's
    // editable — only clicking Apply does.
    const applyPendingDate = () => {
      const newDate = pendingDate
      const newMonth = newDate.slice(0, 7)
      const oldMonth = selectedDate.slice(0, 7)
      if (newMonth !== oldMonth) {
        if (isDirty && !window.confirm("You have unsaved changes. Switch month and lose them?")) return
        setSelectedDate(newDate)
        const { seededStatus, seededRemarks, seededArrival } = buildSeededAttendance(cls.attendance, newMonth)
        setMonthAttendance(seededStatus)
        setMonthRemarks(seededRemarks)
        setMonthArrival(seededArrival)
        setIsDirty(false)
      } else {
        setSelectedDate(newDate)
      }
    }

    const toggleStatus = (studentId: string, day: number) => {
      if (!isEditableDay(day) || !canManage) return
      const dateStr = `${attendanceMonth}-${String(day).padStart(2, "0")}`
      const current = getStatus(studentId, day)
      // Cycle: blank → present → absent → present (first click always marks present).
      // A "late" cell behaves like "present" here — clicking it marks absent.
      const next: "present" | "absent" =
        current === "present" || current === "late" ? "absent" : "present"

      if (next === "absent") {
        // Require a remark before marking absent. Pre-fill any existing remark
        // so editing an existing absent doesn't lose its note.
        const existing = monthRemarks[dateStr]?.[studentId] || ""
        const studentName =
          cls.students.find((s) => s.id === studentId)?.name || "this student"
        const remark = window.prompt(
          `Reason for marking ${studentName} absent on ${dateStr}:`,
          existing,
        )
        if (remark === null) return // user cancelled
        const trimmed = remark.trim()
        if (!trimmed) {
          toast.error("A remark is required to mark a student absent")
          return
        }
        setMonthRemarks((prev) => ({
          ...prev,
          [dateStr]: { ...(prev[dateStr] || {}), [studentId]: trimmed },
        }))
      } else {
        // Switching back to present clears any saved remark for that cell
        setMonthRemarks((prev) => {
          if (!prev[dateStr]?.[studentId]) return prev
          const { [studentId]: _drop, ...rest } = prev[dateStr]
          void _drop
          return { ...prev, [dateStr]: rest }
        })
      }

      // Toggling via the grid never records a time, so drop any arrival time
      // for this cell (a manual present/absent overrides a prior late entry).
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
      setIsDirty(true)
    }

    // Record an arrival time for the selected (editable) date and auto-set
    // status: an arrival strictly after the program start ⇒ "late", else
    // "present". Clearing the time reverts a "late" cell back to "present".
    const setArrivalTime = (studentId: string, value: string) => {
      if (!canManage || !trackLate) return
      const dateStr = selectedDate
      const trimmed = value.trim()

      if (!trimmed) {
        // Clear the arrival time. If the cell was "late", fall back to present.
        setMonthArrival((prev) => {
          if (!prev[dateStr]?.[studentId]) return prev
          const { [studentId]: _d, ...rest } = prev[dateStr]
          void _d
          return { ...prev, [dateStr]: rest }
        })
        setMonthAttendance((prev) => {
          const cur = prev[dateStr]?.[studentId]
          if (cur !== "late") return prev
          return { ...prev, [dateStr]: { ...(prev[dateStr] || {}), [studentId]: "present" } }
        })
        setIsDirty(true)
        return
      }

      const lateness = computeLateness(courseTitle, trimmed)
      const nextStatus: "present" | "late" = lateness?.isLate ? "late" : "present"

      setMonthArrival((prev) => ({
        ...prev,
        [dateStr]: { ...(prev[dateStr] || {}), [studentId]: trimmed },
      }))
      // Recording a time means the student showed up — clear any absent remark.
      setMonthRemarks((prev) => {
        if (!prev[dateStr]?.[studentId]) return prev
        const { [studentId]: _r, ...rest } = prev[dateStr]
        void _r
        return { ...prev, [dateStr]: rest }
      })
      setMonthAttendance((prev) => ({
        ...prev,
        [dateStr]: { ...(prev[dateStr] || {}), [studentId]: nextStatus },
      }))
      setIsDirty(true)
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
        {/* Back + Title */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              // Leaving the editor deliberately discards the in-progress draft so
              // it can't resurface on a later reload of the class list.
              clearDraft()
              setIsDirty(false)
              setView({ page: "classes" })
            }}
            className="flex size-8 items-center justify-center rounded-lg hover:bg-navy-100 dark:hover:bg-navy-800 transition-colors"
          >
            <ChevronLeft className="size-5 text-navy-500" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
              <ClipboardCheck className="size-6 text-emerald-500" /> Attendance — {cls.name}
            </h1>
            <p className="text-sm text-navy-500 dark:text-navy-400">{cls.students.length} students · {cls.schedule}</p>
          </div>
        </div>

        {/* Sync status inside attendance view */}
        {useSupabase && (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live sync active — changes visible on all devices
          </div>
        )}
        {!useSupabase && !dbOffline && (
          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
            <span className="size-1.5 rounded-full bg-amber-500" />
            Local mode — changes will not sync
          </div>
        )}
        {dbOffline && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <WifiOff className="size-4 shrink-0" />
            Offline — changes will only save locally and won&apos;t sync to other devices.
          </div>
        )}

        {/* Success notification */}
        <AnimatePresence>
          {submitSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="flex items-center gap-4 rounded-xl bg-white dark:bg-navy-800 border border-emerald-200 dark:border-emerald-700 px-6 py-5 shadow-xl"
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20 ring-4 ring-emerald-100 dark:ring-emerald-500/10">
                <CheckCircle2 className="size-7 text-emerald-500" />
              </div>
              <div>
                <p className="text-lg font-bold text-navy-900 dark:text-white">Attendance Marked Successfully</p>
                <p className="text-sm text-navy-500 dark:text-navy-400">All records saved and synced to the database.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Date picker — full date with day name */}
        <Card className="border-emerald-500/30">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="text-xs font-medium text-navy-600 dark:text-navy-300 block mb-1">Attendance Date</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={pendingDate}
                    onChange={(e) => setPendingDate(e.target.value)}
                    className="w-48"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={pendingDate === selectedDate}
                    onClick={applyPendingDate}
                  >
                    Apply
                  </Button>
                </div>
              </div>
              {/* Show full day name prominently */}
              <div className="pb-1">
                <p className="text-base font-semibold text-navy-900 dark:text-white">
                  {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-GB", {
                    weekday: "long", day: "2-digit", month: "long", year: "numeric"
                  })}
                </p>
                <p className="text-xs text-navy-400 dark:text-navy-500 mt-0.5">
                  Only this date is editable. Pick another date and click Apply to edit it instead.
                </p>
                {attendanceMarkers[selectedDate] && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                    <CheckCircle2 className="size-3" />
                    Marked by <span className="font-semibold">{attendanceMarkers[selectedDate]}</span>
                  </p>
                )}
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
                        <th
                          className={cn(
                            "px-1 py-2 text-center font-medium border-b min-w-[32px]",
                            d === selectedDay ? "bg-emerald-500 text-white" : d === todayDay ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300" : "text-navy-600 dark:text-navy-300"
                          )}
                        >
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
                  {sortedStudents.map((student, si) => {
                    const summary = getMonthSummary(student.id)
                    return (
                      <tr key={student.id} className={cn("border-b last:border-0", si % 2 === 0 ? "" : "bg-navy-50/50 dark:bg-navy-800/20")}>
                        <td className="sticky left-0 z-10 bg-white dark:bg-navy-900 px-2 py-2 text-navy-500 dark:text-navy-400 font-mono border-r">{si + 1}</td>
                        <td className="sticky left-[40px] z-10 bg-white dark:bg-navy-900 px-2 py-2 font-medium text-navy-900 dark:text-white border-r whitespace-nowrap truncate w-[140px] min-w-[140px] max-w-[140px]">
                          {student.name}
                        </td>
                        {days.map((d) => {
                          const status = getStatus(student.id, d)
                          const future = isFutureDay(d)
                          const editable = isEditableDay(d)
                          const dateStrCell = `${attendanceMonth}-${String(d).padStart(2, "0")}`
                          const cellRemark = monthRemarks[dateStrCell]?.[student.id]
                          const cellArrival = monthArrival[dateStrCell]?.[student.id]
                          const cellTitle =
                            status === "absent" && cellRemark
                              ? `Absent — ${cellRemark}`
                              : status === "late" && cellArrival
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
                                        : // Read-only (non-selected day): show data but faded, not clickable
                                          status === "present"
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
                                        value={cellArrival || ""}
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

        {/* Actions: Mark All + Submit + Reset */}
        <Card className="border-emerald-500/30">
          <CardContent className="p-4">
            {/* Quick mark buttons for selected date */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs font-medium text-navy-600 dark:text-navy-300 mr-1">Quick:</span>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-600 dark:text-emerald-400"
                onClick={() => {
                  if (!canManage) return
                  setMonthAttendance((prev) => {
                    const updated = { ...prev, [selectedDate]: { ...(prev[selectedDate] || {}) } }
                    cls.students.forEach((s) => { updated[selectedDate][s.id] = "present" })
                    return updated
                  })
                  // No one is absent → clear any remarks for the day
                  setMonthRemarks((prev) => ({ ...prev, [selectedDate]: {} }))
                  // "All present" overrides any recorded times/late status
                  setMonthArrival((prev) => ({ ...prev, [selectedDate]: {} }))
                  setIsDirty(true)
                }}
              >
                <CheckCircle2 className="size-3 mr-1" /> All Present
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-600 dark:text-red-400"
                onClick={() => {
                  if (!canManage) return
                  // One remark applied to every student — required.
                  const remark = window.prompt(
                    `Reason for marking ALL ${cls.students.length} students absent on ${selectedDate} (e.g. "Class cancelled"):`,
                    "",
                  )
                  if (remark === null) return
                  const trimmed = remark.trim()
                  if (!trimmed) {
                    toast.error("A remark is required to mark students absent")
                    return
                  }
                  setMonthAttendance((prev) => {
                    const updated = { ...prev, [selectedDate]: { ...(prev[selectedDate] || {}) } }
                    cls.students.forEach((s) => { updated[selectedDate][s.id] = "absent" })
                    return updated
                  })
                  setMonthRemarks((prev) => {
                    const updated = { ...prev, [selectedDate]: { ...(prev[selectedDate] || {}) } }
                    cls.students.forEach((s) => { updated[selectedDate][s.id] = trimmed })
                    return updated
                  })
                  // Everyone absent → no arrival times for the day
                  setMonthArrival((prev) => ({ ...prev, [selectedDate]: {} }))
                  setIsDirty(true)
                }}
              >
                All Absent
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-500 px-8 py-2.5 text-sm font-semibold"
                onClick={() => handleSubmitAttendance(view.courseId, view.classId)}
                disabled={saving}
              >
                {saving
                  ? <><Loader2 className="size-4 mr-2 animate-spin" /> Saving…</>
                  : <><Save className="size-4 mr-2" /> Submit Attendance</>
                }
              </Button>
              <Button
                variant="outline"
                disabled={saving}
                onClick={async () => {
                  if (!canManage) return
                  const dateLabel = new Date(selectedDate + "T12:00:00").toLocaleDateString("en-GB", {
                    weekday: "long", day: "numeric", month: "long", year: "numeric",
                  })
                  const confirmed = window.confirm(
                    `Clear ALL attendance for ${cls.name} on ${dateLabel}?\n\n` +
                    `This permanently erases every Present, Absent and Late mark and all arrival times recorded for this class on this date — for every student. This cannot be undone.`,
                  )
                  if (!confirmed) return
                  setSaving(true)
                  if (useSupabase) {
                    const { error } = await db.deleteAttendanceForDate(view.classId, selectedDate)
                    if (error) { toast.error("Failed to clear attendance from the database"); setSaving(false); return }
                  }
                  // Clear the selected date back to "not marked" in the editor…
                  setMonthAttendance((prev) => ({ ...prev, [selectedDate]: {} }))
                  setMonthRemarks((prev) => ({ ...prev, [selectedDate]: {} }))
                  setMonthArrival((prev) => ({ ...prev, [selectedDate]: {} }))
                  // …and drop that date from the in-memory snapshot so summaries refresh.
                  setCourses((prev) => prev.map((course) => ({
                    ...course,
                    classes: course.classes.map((c) =>
                      c.id === view.classId
                        ? { ...c, attendance: c.attendance.filter((a) => a.date !== selectedDate) }
                        : c,
                    ),
                  })))
                  clearDraft()
                  setIsDirty(false)
                  setSaving(false)
                  if (useSupabase) await reloadAndReseed(true)
                  toast.success(`Attendance cleared for ${dateLabel}`)
                }}
                className="px-6"
              >
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

  return null
}
