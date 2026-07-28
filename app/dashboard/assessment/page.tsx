"use client"

// ╔══════════════════════════════════════════════════════════════════╗
// ║ GRADE BOOK — Unified exam + marks + report module                ║
// ║ Replaces the previous Assessment page and the inline grade-book  ║
// ║ tab in /dashboard/teachers. Single source of truth.              ║
// ║                                                                  ║
// ║ Route                                                            ║
// ║   /dashboard/assessment   — labelled "Grade Book" in launcher    ║
// ║                                                                  ║
// ║ Phase 1 (this commit) ships:                                     ║
// ║   • Grade Book main page — class filter + metrics + exam table   ║
// ║   • Add / Edit Exam slide-over (right side, keyboard friendly)   ║
// ║   • Marks Entry view — spreadsheet w/ arrow + tab nav            ║
// ║   • Subject lock when scores exist                               ║
// ║   • Live Supabase wiring (realtime subscriptions on exams +      ║
// ║     exam_subjects + exam_scores so a save on one device updates  ║
// ║     others instantly)                                            ║
// ║                                                                  ║
// ║ Phase 2 will layer on Generate Report (PDF) + Certificate.       ║
// ║ Phase 3 will gut the legacy grade-book tab in teachers/page.tsx. ║
// ╚══════════════════════════════════════════════════════════════════╝

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Award,
  Plus,
  X,
  Trash2,
  Edit3,
  Eye,
  ArrowLeft,
  Sparkles,
  Search,
  Lock,
  Save,
  ChevronRight,
  Printer,
  Languages,
  CalendarDays,
  Download,
  Trophy,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import * as db from "@/lib/db"
import { toast } from "sonner"
import type { CourseData, Student } from "@/data/courses"
import { cn } from "@/lib/utils"
import { SYLLABUS_2026_27, syllabusForClassId, ACADEMIC_YEAR, type SyllabusSubject } from "@/data/syllabus"
import { addReportHeader, fetchLogoDataUrl } from "@/lib/branding"
import { getGrade, gradeHexColor, GRADE_TIERS } from "@/lib/grades"
import ToppersView from "@/components/grade-book/ToppersView"
import { computeToppers, resolveTopperPhotos, buildToppersSVG, svgToPngDataUrl, TOPPERS_POSTER_W, TOPPERS_POSTER_H } from "@/lib/toppers"

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────
function formatDate(d?: string) {
  if (!d) return "—"
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

const examColors = ["#f5a623", "#3b82f6", "#10b981", "#7c3aed", "#ec4899", "#06b6d4", "#f97316", "#a855f7"]

function getAcademicYear(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00")
  const month = d.getMonth() + 1  // 1-12
  const year = d.getFullYear()
  // Academic year runs April → March: Apr-Dec belongs to year/year+1, Jan-Mar to (year-1)/year
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`
}

function datesForAcademicYear(academicYear: string): { halfYearly: string; finalYear: string } {
  const startYear = parseInt(academicYear.split("-")[0])
  return { halfYearly: `${startYear}-12-15`, finalYear: `${startYear + 1}-04-15` }
}

// Convert short format "2027-28" → full format "2027-2028"
function toFullYear(y: string): string {
  const [start, end] = y.split("-")
  return end.length === 2 ? `${start}-20${end}` : y
}

const CURRENT_YEAR = toFullYear(ACADEMIC_YEAR) // e.g. "2027-2028"

const COURSE_DISPLAY: Record<string, string> = {
  "1": "Ihlamudheen Madrasa",
  "2": "Ihlamudheen Madrasa",
  "3": "CBIS",
  "4": "Ihlamudheen Madrasa",
}

const EXAM_TYPES = [
  "Periodic Test 1 (PT-1 - May)",
  "Quarterly Examination",
  "Periodic Test 2 (PT-2- Sep)",
  "Half-Yearly Examination",
  "Periodic Test 3 (PT-3- Jan)",
  "Annual Examination",
] as const

function examMatchesType(examName: string, type: string): boolean {
  const n = examName.toLowerCase()
  if (type === "Periodic Test 1 (PT-1 - May)")  return n.includes("periodic test 1") || n.includes("pt-1")
  if (type === "Quarterly Examination")          return n.includes("quarterly")
  if (type === "Periodic Test 2 (PT-2- Sep)")   return n.includes("periodic test 2") || n.includes("pt-2")
  if (type === "Half-Yearly Examination")        return n.includes("half-yearly") || n.includes("half yearly") || n.includes("half year")
  if (type === "Periodic Test 3 (PT-3- Jan)")   return n.includes("periodic test 3") || n.includes("pt-3")
  // "annual examination" covers newly seeded exams; "final year" keeps backwards compat with old seeded data
  if (type === "Annual Examination")             return n.includes("annual examination") || n.includes("final year") || n.includes("annual public")
  return true
}

// Clean, poster-friendly title for an exam type (strips the PT abbreviations).
const EXAM_POSTER_TITLE: Record<string, string> = {
  "Periodic Test 1 (PT-1 - May)": "Periodic Test 1",
  "Quarterly Examination": "Quarterly Examination",
  "Periodic Test 2 (PT-2- Sep)": "Periodic Test 2",
  "Half-Yearly Examination": "Half-Yearly Examination",
  "Periodic Test 3 (PT-3- Jan)": "Periodic Test 3",
  "Annual Examination": "Annual Examination",
}

// Derive a poster heading from an exam: prefer a matched exam-type label,
// otherwise strip the class prefix and year from the raw exam name.
function examPosterTitle(exam: db.GradeBookExam): string {
  for (const t of EXAM_TYPES) {
    if (examMatchesType(exam.examName, t)) return EXAM_POSTER_TITLE[t] ?? t
  }
  const cleaned = exam.examName.replace(/\d{4}\s*-\s*\d{2,4}/g, "").replace(/^.*—\s*/, "").trim()
  return cleaned || "Examination"
}

// ───────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────
type View =
  | { page: "list" }
  | { page: "marks"; examId: number }
  | { page: "report"; examId: number; studentId: string }
  | { page: "certificate"; examId: number; studentId: string }
  | { page: "toppers"; examId: number; from: "list" | "marks" }

interface SubjectDraft {
  id: string  // existing subject id, or `new-${timestamp}` for unsaved
  name: string
  maxMarks: string  // string for input
  isExisting: boolean
}

// ═══════════════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════════════
export default function GradeBookPage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const canManage = role === "admin" || role === "accountant" || role === "teacher"

  const [courses, setCourses] = useState<CourseData[]>([])
  const [exams, setExams] = useState<db.GradeBookExam[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>({ page: "list" })

  const [classFilter, setClassFilter] = useState<string>("")
  const [courseFilter, setCourseFilter] = useState<string>("")
  const [yearFilter, setYearFilter] = useState<string>(CURRENT_YEAR)
  const [examTypeFilter, setExamTypeFilter] = useState<string>("")
  const [search, setSearch] = useState("")

  // Years that are unlocked for data entry (admin-controlled via app_settings)
  const [unlockedYears, setUnlockedYears] = useState<string[]>([CURRENT_YEAR])

  const [slideOpen, setSlideOpen] = useState(false)
  const [editingExamId, setEditingExamId] = useState<number | null>(null)
  const [prefilledCreate, setPrefilledCreate] = useState<{ classId: string; name: string; date: string } | null>(null)
  const [pendingNavExamId, setPendingNavExamId] = useState<number | null>(null)
  // Prevents auto-nav firing immediately after the user clicks Back from marks entry
  const justCameBack = useRef(false)

  // ── Restore filter + view from sessionStorage on mount ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("madrasa-gradebook")
      if (!raw) return
      const s = JSON.parse(raw) as {
        year?: string; course?: string; class?: string; examType?: string; examId?: number
      }
      if (s.year) setYearFilter(s.year)
      if (s.course) setCourseFilter(s.course)
      if (s.class) setClassFilter(s.class)
      if (s.examType) setExamTypeFilter(s.examType)
      if (s.examId) setPendingNavExamId(s.examId)
    } catch { /* ignore corrupt storage */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save filter + view to sessionStorage whenever they change ──
  useEffect(() => {
    try {
      const examId = view.page === "marks" ? view.examId : undefined
      sessionStorage.setItem("madrasa-gradebook", JSON.stringify({
        year: yearFilter, course: courseFilter, class: classFilter,
        examType: examTypeFilter, examId,
      }))
    } catch { /* ignore */ }
  }, [yearFilter, courseFilter, classFilter, examTypeFilter, view])

  // ── Navigate to marks entry once a new/restored exam appears in state ──
  useEffect(() => {
    if (!pendingNavExamId) return
    const found = exams.find((e) => e.id === pendingNavExamId)
    if (found) {
      setView({ page: "marks", examId: pendingNavExamId })
      setPendingNavExamId(null)
    }
  }, [exams, pendingNavExamId])


  // ── Data loaders ──
  const loadAll = useCallback(async () => {
    const ready = await db.checkSupabase()
    if (!ready) {
      setLoading(false)
      return
    }
    const [coursesRes, examsRes, unlockedRaw] = await Promise.all([
      db.fetchCoursesFromDB(),
      db.fetchAllGrades(),
      db.fetchAppSetting("unlocked_academic_years"),
    ])
    setCourses(coursesRes)
    setExams(examsRes)
    if (unlockedRaw) {
      try {
        const parsed = JSON.parse(unlockedRaw) as string[]
        // Always include past years (≤ current) and any admin-unlocked future years
        setUnlockedYears(parsed)
      } catch { /* fallback to default */ }
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Realtime — any exam/subject/score change anywhere refreshes the list
  useEffect(() => {
    const subs = [
      db.subscribeToTable("exams", loadAll),
      db.subscribeToTable("exam_subjects", loadAll),
      db.subscribeToTable("exam_scores", loadAll),
      db.subscribeToTable("students", loadAll),
    ]
    return () => subs.forEach((s) => s.unsubscribe())
  }, [loadAll])

  // ── Derived ──
  const allClasses = useMemo(
    () => courses.flatMap((c) => c.classes.map((cl) => ({ ...cl, courseId: c.id, courseTitle: c.title }))),
    [courses]
  )
  const classesById = useMemo(() => {
    const map: Record<string, (typeof allClasses)[number]> = {}
    allClasses.forEach((c) => (map[c.id] = c))
    return map
  }, [allClasses])

  const availableYears = useMemo(() => {
    const fromExams = exams.map((e) => getAcademicYear(e.date))
    const base = ["2025-2026", "2026-2027", "2027-2028", "2028-2029", "2029-2030"]
    const combined = base.concat(fromExams)
    return combined.filter((yr, i) => combined.indexOf(yr) === i).sort()
  }, [exams])

  const visibleExams = useMemo(() => {
    return exams.filter((e) => {
      if (courseFilter) {
        const cls = classesById[e.classId]
        if (!cls || cls.courseId !== courseFilter) return false
      }
      if (yearFilter !== "all" && getAcademicYear(e.date) !== yearFilter) return false
      if (classFilter && e.classId !== classFilter) return false
      if (examTypeFilter && !examMatchesType(e.examName, examTypeFilter)) return false
      if (search && !e.examName.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [exams, classFilter, courseFilter, yearFilter, examTypeFilter, classesById, search])

  // ── Auto-navigate when exactly one exam matches all 4 filters ──
  useEffect(() => {
    if (loading) return
    if (view.page !== "list") return
    if (!classFilter || !examTypeFilter) return
    if (justCameBack.current) { justCameBack.current = false; return }
    if (visibleExams.length === 1) {
      setView({ page: "marks", examId: visibleExams[0].id })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleExams.length, classFilter, examTypeFilter, loading])

  const totalStudents = useMemo(() => allClasses.reduce((s, c) => s + c.students.length, 0), [allClasses])


  const examHasMarks = useCallback((exam: db.GradeBookExam) => {
    return Object.values(exam.subjectScores).some((s) => Object.keys(s).length > 0)
  }, [])

  // ── Actions ──
  const handleAddExam = () => {
    if (!canManage) return toast.error("Only admin and teachers can add exams")
    setEditingExamId(null)
    if (classFilter && examTypeFilter) {
      const cls = classesById[classFilter]
      const yr = yearFilter !== "all" ? yearFilter : CURRENT_YEAR
      const startYear = parseInt(yr.split("-")[0])
      const defaultExamDate = isNaN(startYear) ? new Date().toISOString().split("T")[0] : `${startYear}-04-01`
      setPrefilledCreate({
        classId: classFilter,
        name: `${cls?.name ?? ""} — ${examTypeFilter} ${yr}`,
        date: defaultExamDate,
      })
    } else if (classFilter) {
      setPrefilledCreate({ classId: classFilter, name: "", date: "" })
    } else {
      setPrefilledCreate(null)
    }
    setSlideOpen(true)
  }

  const handleEditExam = (exam: db.GradeBookExam) => {
    if (!canManage) return toast.error("Only admin and teachers can edit exams")
    setEditingExamId(exam.id)
    setSlideOpen(true)
  }

  const handleDeleteExam = async (exam: db.GradeBookExam) => {
    if (examHasMarks(exam)) return toast.error("Cannot delete — marks already recorded")
    if (!confirm(`Delete exam "${exam.examName}"? This cannot be undone.`)) return
    const { error } = await db.deleteGrade(exam.id)
    if (error) return toast.error("Failed to delete exam")
    toast.success("Exam deleted")
    loadAll()
  }

  // Admin-only: unlock a future academic year after student promotion
  const handleUnlockYear = async (yr: string) => {
    if (!confirm(`Unlock academic year ${yr} for data entry?\n\nOnly do this AFTER student promotion is complete. This cannot be reversed automatically.`)) return
    const updated = Array.from(new Set([...unlockedYears, yr])).sort()
    const { error } = await db.setAppSetting("unlocked_academic_years", JSON.stringify(updated))
    if (error) return toast.error("Failed to unlock year")
    setUnlockedYears(updated)
    toast.success(`Academic year ${yr} is now unlocked`)
  }

  // Admin-only: pre-create Half-Yearly + Final Year exams for Ihlamudheen classes
  // using the syllabus subjects (50 marks each). Idempotent.
  const [seeding, setSeeding] = useState(false)
  const handleSeedSyllabus = async () => {
    const targetYear = yearFilter !== "all" ? yearFilter : ACADEMIC_YEAR
    const { halfYearly, finalYear } = datesForAcademicYear(targetYear)

    // ── Check for existing marks across all Ihlamudheen classes ──────────────
    const madrasaClassIds = SYLLABUS_2026_27.flatMap((g) => g.classIds)
    const classesWithMarks: string[] = []
    for (const classId of madrasaClassIds) {
      const classExams = exams.filter((e) => e.classId === classId)
      if (classExams.some((e) => Object.keys(e.subjectScores).length > 0)) {
        const cls = classesById[classId]
        if (cls) classesWithMarks.push(cls.name)
      }
    }

    if (classesWithMarks.length > 0) {
      const markedList = classesWithMarks.slice(0, 8).join(", ") + (classesWithMarks.length > 8 ? `… (+${classesWithMarks.length - 8} more)` : "")
      const proceed = confirm(
        `⚠️ WARNING — MARKS ALREADY EXIST\n\n` +
        `The following classes already have marks recorded:\n${markedList}\n\n` +
        `Seeding will SKIP exams that already exist (your marks are safe), ` +
        `but it will CREATE new exams with fresh subjects alongside existing ones.\n\n` +
        `This could create DUPLICATE exam entries for those classes.\n\n` +
        `Are you absolutely sure you want to continue?\n` +
        `(Click Cancel to abort — no changes will be made)`
      )
      if (!proceed) return
    }

    if (!confirm(`Pre-create Half-Yearly and Annual exams for all Ihlamudheen classes based on the ${targetYear} syllabus?\n\nExisting exams with the same name will be skipped — your data is safe.`)) return
    setSeeding(true)
    let createdTotal = 0, skippedTotal = 0, errorTotal = 0
    for (const grade of SYLLABUS_2026_27) {
      for (const classId of grade.classIds) {
        const cls = classesById[classId]
        if (!cls) continue
        const { created, skipped, error } = await db.seedSyllabusExamsForClass(
          classId,
          halfYearly,
          finalYear,
          grade.subjects.map((s) => ({ id: s.id, enName: s.enName, maxScore: s.maxScore })),
          cls.name,
          targetYear,
        )
        if (error) errorTotal++
        createdTotal += created.length
        skippedTotal += skipped.length
      }
    }
    setSeeding(false)
    if (errorTotal > 0) toast.error(`Seeded with ${errorTotal} error(s). Check console.`)
    else if (createdTotal === 0) toast.info(`All exams already exist (${skippedTotal} skipped). Nothing to seed.`)
    else toast.success(`Seeded ${createdTotal} exam${createdTotal === 1 ? "" : "s"}${skippedTotal > 0 ? `, skipped ${skippedTotal}` : ""}`)
    loadAll()
  }

  // ── Batch: one Toppers poster per class (course + exam type + year) ──
  // Produces a single multi-page PDF — one page per class that has marks.
  const [batchBusy, setBatchBusy] = useState(false)
  const handleBatchToppers = async () => {
    if (!courseFilter || !examTypeFilter) {
      toast.error("Select a course and examination first")
      return
    }
    const yr = yearFilter !== "all" ? yearFilter : CURRENT_YEAR

    // Pair each class in the course with its matching exam that has marks.
    const jobs: { cls: (typeof allClasses)[number]; exam: db.GradeBookExam }[] = []
    for (const c of allClasses.filter((cl) => cl.courseId === courseFilter)) {
      const match = exams.find(
        (e) =>
          e.classId === c.id &&
          examMatchesType(e.examName, examTypeFilter) &&
          getAcademicYear(e.date) === yr &&
          Object.keys(e.subjectScores).length > 0,
      )
      if (match) jobs.push({ cls: c, exam: match })
    }

    if (jobs.length === 0) {
      toast.error("No classes have marks for this examination yet")
      return
    }

    setBatchBusy(true)
    const toastId = toast.loading(`Generating toppers for ${jobs.length} class${jobs.length === 1 ? "" : "es"}…`)
    try {
      const logo = await fetchLogoDataUrl()
      const { default: jsPDF } = await import("jspdf")
      const doc = new jsPDF({ orientation: "portrait", unit: "px", format: [TOPPERS_POSTER_W, TOPPERS_POSTER_H] })
      let page = 0
      for (const { cls, exam } of jobs) {
        // Roster: enrolled ∪ attendance
        const att = await db.fetchStudentsFromAttendance(cls.id)
        const map = new Map(cls.students.map((s) => [s.id, s]))
        att.forEach((s) => { if (!map.has(s.id)) map.set(s.id, s) })
        const toppers = computeToppers(exam, Array.from(map.values()), 3)
        if (toppers.length === 0) continue
        const photos = await resolveTopperPhotos(toppers)
        const svg = buildToppersSVG({
          classLabel: cls.name,
          examTitle: examPosterTitle(exam),
          academicYear: getAcademicYear(exam.date),
          toppers,
          photos,
          logoDataUri: logo,
        })
        const png = await svgToPngDataUrl(svg)
        if (page > 0) doc.addPage([TOPPERS_POSTER_W, TOPPERS_POSTER_H], "portrait")
        doc.addImage(png, "PNG", 0, 0, TOPPERS_POSTER_W, TOPPERS_POSTER_H)
        page++
      }
      if (page === 0) {
        toast.error("No toppers to export", { id: toastId })
        return
      }
      const courseName = COURSE_DISPLAY[courseFilter] ?? "course"
      doc.save(`toppers-${courseName.replace(/\s+/g, "-").toLowerCase()}-${examPosterTitle(jobs[0].exam).replace(/\s+/g, "-").toLowerCase()}-${yr}.pdf`)
      toast.success(`Generated ${page} poster${page === 1 ? "" : "s"}`, { id: toastId })
    } catch (e) {
      console.error(e)
      toast.error("Failed to generate toppers PDF", { id: toastId })
    } finally {
      setBatchBusy(false)
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Award className="size-12 text-navy-300 dark:text-navy-600 mb-3" />
        <p className="text-navy-500 dark:text-navy-400">Only admins and teachers can access the Grade Book.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 rounded-lg bg-navy-100 dark:bg-navy-800 animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-navy-100 dark:bg-navy-800 animate-pulse" />
          ))}
        </div>
        <div className="h-96 rounded-xl bg-navy-100 dark:bg-navy-800 animate-pulse" />
      </div>
    )
  }

  // ── Marks entry view ──
  if (view.page === "marks") {
    const exam = exams.find((e) => e.id === view.examId)
    if (!exam) {
      return (
        <div className="text-center py-12">
          <p className="text-navy-500">Exam not found</p>
          <Button className="mt-4" onClick={() => setView({ page: "list" })}>Back</Button>
        </div>
      )
    }
    return (
      <MarksEntryView
        exam={exam}
        cls={classesById[exam.classId]}
        onBack={() => { justCameBack.current = true; setView({ page: "list" }) }}
        onSaved={loadAll}
        onViewReport={(studentId) => setView({ page: "report", examId: exam.id, studentId })}
        onToppers={() => setView({ page: "toppers", examId: exam.id, from: "marks" })}
      />
    )
  }

  // ── Toppers poster view ──
  if (view.page === "toppers") {
    const exam = exams.find((e) => e.id === view.examId)
    const cls = exam ? classesById[exam.classId] : undefined
    if (!exam || !cls) {
      return (
        <div className="text-center py-12">
          <p className="text-navy-500">Toppers not available</p>
          <Button className="mt-4" onClick={() => setView({ page: "list" })}>Back to Grade Book</Button>
        </div>
      )
    }
    return (
      <ToppersView
        exam={exam}
        cls={cls}
        examTitle={examPosterTitle(exam)}
        academicYear={getAcademicYear(exam.date)}
        onBack={() => setView(view.from === "marks" ? { page: "marks", examId: exam.id } : { page: "list" })}
      />
    )
  }

  // ── Report card view ──
  if (view.page === "report") {
    const exam = exams.find((e) => e.id === view.examId)
    const cls = exam ? classesById[exam.classId] : undefined
    const student = cls?.students.find((s) => s.id === view.studentId)
    if (!exam || !cls || !student) {
      return (
        <div className="text-center py-12">
          <p className="text-navy-500">Report not available</p>
          <Button className="mt-4" onClick={() => setView({ page: "list" })}>Back to Grade Book</Button>
        </div>
      )
    }
    return (
      <ReportCardView
        exam={exam}
        cls={cls}
        student={student}
        onBack={() => setView({ page: "marks", examId: exam.id })}
        onCertificate={() => setView({ page: "certificate", examId: exam.id, studentId: student.id })}
      />
    )
  }

  // ── Certificate view ──
  if (view.page === "certificate") {
    const exam = exams.find((e) => e.id === view.examId)
    const cls = exam ? classesById[exam.classId] : undefined
    const student = cls?.students.find((s) => s.id === view.studentId)
    if (!exam || !cls || !student) {
      return (
        <div className="text-center py-12">
          <p className="text-navy-500">Certificate not available</p>
          <Button className="mt-4" onClick={() => setView({ page: "list" })}>Back to Grade Book</Button>
        </div>
      )
    }
    return (
      <CertificateView
        exam={exam}
        cls={cls}
        student={student}
        onBack={() => setView({ page: "report", examId: exam.id, studentId: student.id })}
      />
    )
  }

  // ── Main list view ──
  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-[11px] font-semibold text-gold-500 uppercase tracking-[0.09em] mb-1.5">Teacher Dashboard</p>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-navy-900 dark:text-white tracking-tight leading-none">
              Grade Book
            </h1>
            <p className="mt-1.5 text-sm text-navy-500 dark:text-navy-400">
              {!classFilter
                ? `${courseFilter ? (COURSE_DISPLAY[courseFilter] ?? "Selected course") : "All classes"} · ${yearFilter !== "all" ? yearFilter : "all years"} · ${visibleExams.length} exam${visibleExams.length === 1 ? "" : "s"} · ${totalStudents} students enrolled`
                : `${classesById[classFilter]?.name ?? ""} · ${visibleExams.length} exam${visibleExams.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {role === "admin" && (
              <Button
                onClick={handleSeedSyllabus}
                variant="outline"
                disabled={seeding}
                className="gap-2"
                title={`Pre-create Half-Yearly + Annual exams for all Ihlamudheen Madrasa classes using the syllabus. Safe to run again — existing exams are skipped.`}
              >
                <Sparkles className="size-4" />
                {seeding ? "Seeding…" : `Seed Ihlamudheen Syllabus ${yearFilter !== "all" ? yearFilter : ACADEMIC_YEAR}`}
              </Button>
            )}
            {courseFilter && examTypeFilter && (
              <Button
                onClick={handleBatchToppers}
                variant="outline"
                disabled={batchBusy}
                className="gap-2"
                title="Generate a Toppers poster for every class in this course + examination (one PDF)"
              >
                <Trophy className="size-4" />
                {batchBusy ? "Generating…" : "Toppers — all classes"}
              </Button>
            )}
            <Button
              onClick={handleAddExam}
              className="bg-gold-500 hover:bg-gold-600 text-navy-950 font-semibold shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all gap-2"
            >
              <Plus className="size-4" />
              Add Exam
            </Button>
          </div>
        </div>
      </motion.div>


      {/* ── Cascading filter bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* 1. Academic Year */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-400">Academic Year</span>
          <select
            value={yearFilter}
            onChange={(e) => { setYearFilter(e.target.value); setCourseFilter(""); setClassFilter(""); setExamTypeFilter("") }}
            className="text-xs font-semibold rounded-lg border border-navy-200 dark:border-navy-700 bg-white dark:bg-navy-900 text-navy-800 dark:text-white px-3 py-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-500/40 w-full"
          >
            <option value="all">All Years</option>
            {availableYears.map((yr) => {
              const locked = !unlockedYears.includes(yr) && yr > CURRENT_YEAR
              return (
                <option key={yr} value={yr} disabled={locked}>
                  {yr}{locked ? " (Locked)" : yr === CURRENT_YEAR ? " (Current)" : ""}
                </option>
              )
            })}
          </select>
          {/* Admin unlock button for the next locked year */}
          {role === "admin" && (() => {
            const nextLocked = availableYears.find((yr) => !unlockedYears.includes(yr) && yr > CURRENT_YEAR)
            if (!nextLocked) return null
            return (
              <button
                onClick={() => handleUnlockYear(nextLocked)}
                className="text-[10px] text-amber-500 hover:text-amber-400 font-semibold mt-0.5 text-left flex items-center gap-1"
                title="Unlock after completing student promotion"
              >
                <Lock className="size-3" /> Unlock {nextLocked} after promotion
              </button>
            )
          })()}
        </div>

        {/* 2. Course */}
        <div className="flex flex-col gap-1">
          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", yearFilter ? "text-navy-400" : "text-navy-300 dark:text-navy-600")}>Course</span>
          <select
            value={courseFilter}
            onChange={(e) => { setCourseFilter(e.target.value); setClassFilter(""); setExamTypeFilter("") }}
            disabled={!yearFilter}
            className={cn(
              "text-xs font-semibold rounded-lg border px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-sky-500/40",
              !yearFilter
                ? "border-navy-100 dark:border-navy-800 bg-navy-50 dark:bg-navy-950 text-navy-300 dark:text-navy-600 cursor-not-allowed"
                : courseFilter
                  ? "border-sky-500/40 bg-sky-500/5 text-sky-600 dark:text-sky-400 cursor-pointer"
                  : "border-navy-200 dark:border-navy-700 bg-white dark:bg-navy-900 text-navy-800 dark:text-white cursor-pointer"
            )}
          >
            <option value="">Select Course</option>
            <option value="1">Ihlamudheen Madrasa</option>
          </select>
        </div>

        {/* 3. Class */}
        <div className="flex flex-col gap-1">
          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", courseFilter ? "text-navy-400" : "text-navy-300 dark:text-navy-600")}>Class</span>
          <select
            value={classFilter}
            onChange={(e) => { setClassFilter(e.target.value); setExamTypeFilter("") }}
            disabled={!courseFilter}
            className={cn(
              "text-xs font-semibold rounded-lg border px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-sky-500/40",
              !courseFilter
                ? "border-navy-100 dark:border-navy-800 bg-navy-50 dark:bg-navy-950 text-navy-300 dark:text-navy-600 cursor-not-allowed"
                : classFilter
                  ? "border-sky-500/40 bg-sky-500/5 text-sky-600 dark:text-sky-400 cursor-pointer"
                  : "border-navy-200 dark:border-navy-700 bg-white dark:bg-navy-900 text-navy-800 dark:text-white cursor-pointer"
            )}
          >
            <option value="">Select Class</option>
            {allClasses
              .filter((cls) => cls.courseId === courseFilter)
              .map((cls) => (
                <option key={cls.id} value={cls.id}>{cls.name}</option>
              ))}
          </select>
        </div>

        {/* 4. Exam Type */}
        <div className="flex flex-col gap-1">
          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", classFilter ? "text-navy-400" : "text-navy-300 dark:text-navy-600")}>Examination</span>
          <select
            value={examTypeFilter}
            onChange={(e) => setExamTypeFilter(e.target.value)}
            disabled={!classFilter}
            className={cn(
              "text-xs font-semibold rounded-lg border px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-sky-500/40",
              !classFilter
                ? "border-navy-100 dark:border-navy-800 bg-navy-50 dark:bg-navy-950 text-navy-300 dark:text-navy-600 cursor-not-allowed"
                : examTypeFilter
                  ? "border-gold-500/40 bg-gold-500/5 text-gold-600 dark:text-gold-400 cursor-pointer"
                  : "border-navy-200 dark:border-navy-700 bg-white dark:bg-navy-900 text-navy-800 dark:text-white cursor-pointer"
            )}
          >
            <option value="">Select Examination</option>
            {EXAM_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Search bar — only visible when filters are active */}
      {examTypeFilter && (
        <div className="flex justify-end">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-navy-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search exams…"
              className="pl-8 h-9 w-48 text-sm"
            />
          </div>
        </div>
      )}

      {/* Gate: prompt until all 4 filters are chosen */}
      {!examTypeFilter && (
        <div className="py-14 flex flex-col items-center gap-3 text-center">
          <div className="size-14 rounded-2xl bg-navy-100 dark:bg-navy-800 flex items-center justify-center">
            <Award className="size-6 text-navy-400" />
          </div>
          <p className="text-sm font-semibold text-navy-500 dark:text-navy-400">
            {!courseFilter ? "Select an Academic Year, Course, Class, and Examination to view marks" :
             !classFilter ? "Select a Class and Examination to continue" :
             "Select an Examination type to view marks"}
          </p>
          <p className="text-xs text-navy-400">Use the dropdowns above to narrow down the exam</p>
        </div>
      )}

      {examTypeFilter && (
        <>
          {/* Scheduled syllabus exams — flip cards (English ⇄ Arabic) */}
          <ScheduledExamsGrid
            exams={visibleExams}
            classFilter={classFilter}
            classesById={classesById}
            onEdit={handleEditExam}
            onMarks={(examId) => setView({ page: "marks", examId })}
          />

          {/* Exams table */}
          <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold text-navy-900 dark:text-white">Examinations</h3>
          <span className="text-xs text-navy-400">{visibleExams.length} of {exams.length} shown</span>
        </div>

        {visibleExams.length === 0 ? (
          classFilter ? (
            <InlineExamSetup
              classId={classFilter}
              cls={classesById[classFilter]}
              examType={examTypeFilter}
              year={yearFilter !== "all" ? yearFilter : CURRENT_YEAR}
              allExams={exams}
              onCreated={(examId) => {
                loadAll()
                setPendingNavExamId(examId)
              }}
            />
          ) : (
            <div className="py-12 px-6 text-center">
              <div className="size-12 rounded-xl bg-navy-100 dark:bg-navy-800 flex items-center justify-center mx-auto mb-3">
                <Award className="size-5 text-navy-400" />
              </div>
              <p className="text-sm font-semibold text-navy-500 mb-1">No exam found for this selection</p>
              <p className="text-xs text-navy-400 mb-5">Select a class to set up this examination.</p>
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-navy-50 dark:bg-navy-950/40 border-b border-border">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Exam Name</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Class</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Subjects</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Total</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Date</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400">Status</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-navy-400 w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleExams.map((exam, idx) => {
                  const cls = classesById[exam.classId]
                  const totalMax = exam.subjects.reduce((s, sub) => s + sub.maxScore, 0)
                  const hasMarks = examHasMarks(exam)
                  const dotColor = examColors[idx % examColors.length]
                  return (
                    <tr
                      key={exam.id}
                      className={cn(
                        "border-b border-border/50 transition-colors hover:bg-navy-50 dark:hover:bg-navy-800/40 cursor-pointer group",
                        idx % 2 === 0 ? "" : "bg-navy-50/30 dark:bg-navy-950/30"
                      )}
                      onClick={() => setView({ page: "marks", examId: exam.id })}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="size-2 rounded-full shrink-0" style={{ background: dotColor }} />
                          <span className="font-semibold text-navy-900 dark:text-white text-sm">{exam.examName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-navy-500 dark:text-navy-300">
                        {cls?.name ?? <span className="italic text-navy-400">unknown</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          {exam.subjects.slice(0, 3).map((s) => (
                            <span key={s.id} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-navy-100 dark:bg-navy-800 text-navy-500 dark:text-navy-300 border border-navy-200/50 dark:border-navy-700/50">
                              {s.name}
                            </span>
                          ))}
                          {exam.subjects.length > 3 && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gold-500/10 text-gold-500 border border-gold-500/20">
                              +{exam.subjects.length - 3}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-navy-700 dark:text-navy-200">{totalMax}</td>
                      <td className="px-4 py-3 text-xs text-navy-500 dark:text-navy-300">{formatDate(exam.date)}</td>
                      <td className="px-4 py-3">
                        {hasMarks ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[10px] font-semibold">
                            <span className="size-1.5 rounded-full bg-emerald-500" />
                            Marks Entered
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gold-500/10 text-gold-500 border border-gold-500/20 text-[10px] font-semibold">
                            <span className="size-1.5 rounded-full bg-gold-500" />
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            title="Enter Marks"
                            onClick={(e) => { e.stopPropagation(); setView({ page: "marks", examId: exam.id }) }}
                            className="p-1.5 rounded-md hover:bg-navy-200 dark:hover:bg-navy-700 transition-colors"
                          >
                            <Eye className="size-3.5 text-navy-500" />
                          </button>
                          <button
                            title="Toppers Poster"
                            onClick={(e) => { e.stopPropagation(); setView({ page: "toppers", examId: exam.id, from: "list" }) }}
                            className="p-1.5 rounded-md hover:bg-gold-500/10 transition-colors"
                          >
                            <Trophy className="size-3.5 text-gold-500" />
                          </button>
                          <button
                            title="Edit Exam"
                            onClick={(e) => { e.stopPropagation(); handleEditExam(exam) }}
                            className="p-1.5 rounded-md hover:bg-navy-200 dark:hover:bg-navy-700 transition-colors"
                          >
                            <Edit3 className="size-3.5 text-navy-500" />
                          </button>
                          <button
                            title={hasMarks ? "Cannot delete — marks exist" : "Delete Exam"}
                            disabled={hasMarks}
                            onClick={(e) => { e.stopPropagation(); handleDeleteExam(exam) }}
                            className={cn(
                              "p-1.5 rounded-md transition-colors",
                              hasMarks
                                ? "opacity-30 cursor-not-allowed"
                                : "hover:bg-red-500/10"
                            )}
                          >
                            <Trash2 className={cn("size-3.5", hasMarks ? "text-navy-500" : "text-red-500")} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          )}
          </Card>
        </>
      )}

      {/* Slide-over */}
      <AnimatePresence>
        {slideOpen && (
          <ExamSlideOver
            key="slide"
            existing={editingExamId !== null ? exams.find((e) => e.id === editingExamId) ?? null : null}
            initialClassId={prefilledCreate?.classId}
            initialName={prefilledCreate?.name}
            initialDate={prefilledCreate?.date}
            allClasses={allClasses}
            allExams={exams}
            onClose={() => { setSlideOpen(false); setPrefilledCreate(null) }}
            onSaved={(newExamId) => {
              setSlideOpen(false)
              setPrefilledCreate(null)
              loadAll()
              if (newExamId) setPendingNavExamId(newExamId)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Slide-over: Add / Edit Exam
// ═══════════════════════════════════════════════════════════════════
function ExamSlideOver({
  existing,
  initialClassId,
  initialName,
  initialDate,
  allClasses,
  allExams,
  onClose,
  onSaved,
}: {
  existing: db.GradeBookExam | null
  initialClassId?: string
  initialName?: string
  initialDate?: string
  allClasses: Array<{ id: string; name: string; courseId: string; courseTitle: string; students: { id: string }[] }>
  allExams: db.GradeBookExam[]
  onClose: () => void
  onSaved: (newExamId?: number) => void
}) {
  const startClassId = existing?.classId ?? initialClassId ?? allClasses[0]?.id ?? ""
  const [classId, setClassId] = useState(startClassId)
  const [name, setName] = useState(existing?.examName ?? initialName ?? "")
  const [date, setDate] = useState(existing?.date ?? initialDate ?? "")

  // Auto-populate subjects from syllabus when creating a new exam
  const initialSubjects = useMemo<SubjectDraft[]>(() => {
    if (existing) {
      return existing.subjects.map((s) => ({ id: s.id, name: s.name, maxMarks: String(s.maxScore), isExisting: true }))
    }
    const syl = syllabusForClassId(startClassId)
    if (syl?.subjects?.length) {
      return syl.subjects.map((s) => ({ id: `new-${s.id}`, name: s.enName, maxMarks: String(s.maxScore), isExisting: false }))
    }
    return [{ id: `new-${Date.now()}`, name: "", maxMarks: "", isExisting: false }]
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [subjects, setSubjects] = useState<SubjectDraft[]>(initialSubjects)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  // When class changes on a new exam, reload subjects.
  // Priority: 1) Syllabus definition  2) Subjects from any existing exam
  // in the same grade group (same grade level, any division/exam name).
  useEffect(() => {
    if (existing) return

    // 1. Try syllabus (covers all Ihlamudheen Madrasa classes)
    const syl = syllabusForClassId(classId)
    if (syl?.subjects?.length) {
      setSubjects(syl.subjects.map((s) => ({
        id: `new-${s.id}-${Date.now()}`,
        name: s.enName,
        maxMarks: String(s.maxScore),
        isExisting: false,
      })))
      return
    }

    // 2. Fall back: inherit subjects from any exam in the same grade group
    // (same grade classIds from syllabus, or same class if outside Ihlamudheen).
    // Finds the richest subject list (most subjects) across all sibling exams.
    const gradeGroup = SYLLABUS_2026_27.find((g) => g.classIds.includes(classId))
    const siblingIds = gradeGroup ? gradeGroup.classIds : [classId]
    const siblingExams = allExams.filter((e) => siblingIds.includes(e.classId) && e.subjects.length > 0)
    if (siblingExams.length > 0) {
      const richest = siblingExams.reduce((best, e) => e.subjects.length > best.subjects.length ? e : best)
      setSubjects(richest.subjects.map((s) => ({
        id: `new-${s.id}-${Date.now()}`,
        name: s.name,
        maxMarks: String(s.maxScore),
        isExisting: false,
      })))
      return
    }

    // 3. No reference found — start blank
    setSubjects([{ id: `new-${Date.now()}`, name: "", maxMarks: "", isExisting: false }])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId])

  // Track which subjects have scores (can't be removed once recorded)
  const lockedSubjectIds = useMemo(() => {
    if (!existing) return new Set<string>()
    const locked = new Set<string>()
    Object.values(existing.subjectScores).forEach((subs) => {
      Object.keys(subs).forEach((subId) => locked.add(subId))
    })
    return locked
  }, [existing])

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 350)
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onEsc)
    return () => window.removeEventListener("keydown", onEsc)
  }, [onClose])

  const totalMarks = subjects.reduce((s, sub) => s + (Number(sub.maxMarks) || 0), 0)

  function addSubject() {
    setSubjects((prev) => [...prev, { id: `new-${Date.now()}`, name: "", maxMarks: "", isExisting: false }])
  }

  function removeSubject(id: string) {
    if (lockedSubjectIds.has(id)) {
      toast.error("Cannot remove subject — marks already recorded")
      return
    }
    if (subjects.length === 1) return
    setSubjects((prev) => prev.filter((s) => s.id !== id))
  }

  function updateSubject(id: string, field: "name" | "maxMarks", value: string) {
    setSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)))
    const errKey = `sub_${id}_${field}`
    if (errors[errKey]) {
      setErrors((prev) => {
        const e = { ...prev }
        delete e[errKey]
        return e
      })
    }
  }

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!classId) e.classId = "Pick a class"
    if (!name.trim() || name.trim().length < 2) e.name = "Exam name is required (min 2 chars)"
    if (!date) e.date = "Date is required"
    if (subjects.length === 0) e.subjects = "Add at least one subject"

    // Duplicate check: same class + same exam name + same date
    if (name.trim() && date && classId) {
      const nameLower = name.trim().toLowerCase()
      const duplicate = allExams.find(
        (ex) => ex.id !== existing?.id &&
          ex.classId === classId &&
          ex.examName.toLowerCase() === nameLower &&
          ex.date === date
      )
      if (duplicate) e.name = "An exam with this name and date already exists for this class"
    }

    const seen = new Map<string, string>()
    subjects.forEach((s) => {
      const key = s.name.trim().toLowerCase()
      if (!s.name.trim()) e[`sub_${s.id}_name`] = "Required"
      else if (seen.has(key)) e[`sub_${s.id}_name`] = "Duplicate"
      else seen.set(key, s.id)
      if (!s.maxMarks || Number(s.maxMarks) <= 0) e[`sub_${s.id}_maxMarks`] = "Required"
    })

    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      const subjectsToSave = subjects.map((s) => ({
        id: s.isExisting ? s.id : crypto.randomUUID(),
        name: s.name.trim(),
        maxScore: Number(s.maxMarks),
      }))
      if (existing) {
        // Update meta
        const { error: metaErr } = await db.updateExamMeta(existing.id, name.trim(), date, totalMarks)
        if (metaErr) throw metaErr
        // Replace subjects (only valid because UI prevented removing locked ones)
        const { error: subErr } = await db.replaceExamSubjects(existing.id, subjectsToSave)
        if (subErr) throw subErr
        toast.success("Exam updated")
      } else {
        // Create new — saveGrade with empty scores
        const { error, examId: newId } = await db.saveGrade(classId, name.trim(), date, totalMarks, subjectsToSave, {})
        if (error) throw error
        toast.success("Exam created")
        onSaved(newId as number)
        return
      }
      onSaved()
    } catch (err) {
      console.error(err)
      toast.error("Failed to save exam")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Overlay */}
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        onClick={onClose}
        className="fixed inset-0 bg-navy-950/70 backdrop-blur-[3px] z-[199]"
      />
      {/* Panel */}
      <motion.div
        key="panel"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}
        className={cn(
          "fixed top-0 right-0 bottom-0 z-[200]",
          "w-full sm:w-[480px]",
          "bg-card border-l border-border shadow-2xl flex flex-col"
        )}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <div className="size-9 rounded-lg bg-gold-500/10 flex items-center justify-center shrink-0">
            <Award className="size-4 text-gold-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-navy-900 dark:text-white">
              {existing ? "Edit Exam" : "Create New Exam"}
            </h2>
            <p className="text-xs text-navy-400 mt-0.5 truncate">
              {existing
                ? `${allClasses.find((c) => c.id === existing.classId)?.name ?? "—"}`
                : "Fill in the exam details below"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-navy-100 dark:hover:bg-navy-800 transition-colors"
          >
            <X className="size-4 text-navy-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Class — only for new exams */}
          {!existing && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-navy-400 mb-1.5">Class</label>
              <select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-gold-500/40"
              >
                {allClasses.length === 0 && <option value="">No classes available — create one first</option>}
                {allClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.courseTitle})
                  </option>
                ))}
              </select>
              {errors.classId && <p className="text-[11px] text-red-500 mt-1.5">⚠ {errors.classId}</p>}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-navy-400 mb-1.5">Exam Name</label>
            <Input
              ref={nameRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (errors.name) setErrors((p) => { const x = { ...p }; delete x.name; return x })
              }}
              placeholder="e.g. Mid-Term Examination"
            />
            {errors.name && <p className="text-[11px] text-red-500 mt-1.5">⚠ {errors.name}</p>}
          </div>

          {/* Date */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-navy-400 mb-1.5">Exam Date</label>
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                if (errors.date) setErrors((p) => { const x = { ...p }; delete x.date; return x })
              }}
            />
            {errors.date && <p className="text-[11px] text-red-500 mt-1.5">⚠ {errors.date}</p>}
          </div>

          {/* Subjects */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-navy-400">Subjects</label>
              <span className={cn("text-[11px] font-semibold transition-colors", totalMarks > 0 ? "text-gold-500" : "text-navy-400")}>
                Total: <strong>{totalMarks}</strong> marks
              </span>
            </div>
            {errors.subjects && <p className="text-[11px] text-red-500 mb-2">⚠ {errors.subjects}</p>}

            <div className="space-y-2">
              {subjects.map((sub, idx) => {
                const locked = lockedSubjectIds.has(sub.id)
                return (
                  <motion.div
                    key={sub.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, delay: idx * 0.04 }}
                    className="flex items-start gap-2 rounded-lg border border-border bg-background p-2.5"
                  >
                    <div className="flex-1">
                      <Input
                        value={sub.name}
                        onChange={(e) => updateSubject(sub.id, "name", e.target.value)}
                        placeholder={`Subject ${idx + 1}`}
                        className="h-8 text-sm"
                        disabled={locked}
                      />
                      {errors[`sub_${sub.id}_name`] && (
                        <p className="text-[10px] text-red-500 mt-1">⚠ {errors[`sub_${sub.id}_name`]}</p>
                      )}
                    </div>
                    <div className="w-20">
                      <Input
                        type="number"
                        min="1"
                        value={sub.maxMarks}
                        onChange={(e) => updateSubject(sub.id, "maxMarks", e.target.value)}
                        placeholder="Max"
                        className="h-8 text-sm text-center"
                        disabled={locked}
                      />
                      {errors[`sub_${sub.id}_maxMarks`] && (
                        <p className="text-[10px] text-red-500 mt-1">⚠ {errors[`sub_${sub.id}_maxMarks`]}</p>
                      )}
                    </div>
                    {locked ? (
                      <button
                        title="Cannot remove — marks already recorded"
                        disabled
                        className="size-8 flex items-center justify-center rounded-md opacity-40 cursor-not-allowed"
                      >
                        <Lock className="size-3.5 text-red-500" />
                      </button>
                    ) : (
                      <button
                        onClick={() => removeSubject(sub.id)}
                        disabled={subjects.length === 1}
                        className="size-8 flex items-center justify-center rounded-md hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <X className={cn("size-3.5", subjects.length === 1 ? "text-navy-400" : "text-red-500")} />
                      </button>
                    )}
                  </motion.div>
                )
              })}
            </div>

            <button
              onClick={addSubject}
              className="mt-2.5 w-full py-2 rounded-lg border border-dashed border-border hover:border-navy-400 dark:hover:border-navy-500 text-xs font-semibold text-navy-500 hover:text-navy-700 dark:hover:text-navy-200 transition-all flex items-center justify-center gap-1.5"
            >
              <Plus className="size-3.5" />
              Add Subject
            </button>

            {/* Total marks pill */}
            {totalMarks > 0 && (
              <div className="mt-3 px-3.5 py-2 rounded-lg bg-gold-500/[0.06] border border-gold-500/15 flex items-center justify-between">
                <span className="text-xs text-navy-400">
                  {subjects.filter((s) => s.name).length} subject{subjects.filter((s) => s.name).length === 1 ? "" : "s"} · Grand Total
                </span>
                <span className="text-base font-extrabold text-gold-500">{totalMarks} marks</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-background/60 flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1" disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="flex-[2] bg-gold-500 hover:bg-gold-600 text-navy-950 font-semibold gap-2"
          >
            <Award className="size-4" />
            {saving ? "Saving…" : existing ? "Save Changes" : "Create Exam"}
          </Button>
        </div>
      </motion.div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Marks Entry view
// ═══════════════════════════════════════════════════════════════════
function MarksEntryView({
  exam,
  cls,
  onBack,
  onSaved,
  onViewReport,
  onToppers,
}: {
  exam: db.GradeBookExam
  cls: { id: string; name: string; students: { id: string; name: string; rollNo: string }[] } | undefined
  onBack: () => void
  onSaved: () => void
  onViewReport: (studentId: string) => void
  onToppers: () => void
}) {
  // ── Extra students: from attendance + former (moved/removed) ──────
  const [attendanceStudents, setAttendanceStudents] = useState<Student[]>([])
  const [formerStudents, setFormerStudents] = useState<Student[]>([])
  const [showFormer, setShowFormer] = useState(false)
  const [loadingStudents, setLoadingStudents] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingStudents(true)
      const attStudents = await db.fetchStudentsFromAttendance(exam.classId)
      if (cancelled) return
      setAttendanceStudents(attStudents)

      const scoreIds = await db.fetchStudentIdsWithScores(exam.id)
      if (cancelled) return
      const knownIds = new Set([
        ...(cls?.students ?? []).map((s) => s.id),
        ...attStudents.map((s) => s.id),
      ])
      const formerIds = scoreIds.filter((id) => !knownIds.has(id))
      if (formerIds.length) {
        const former = await db.fetchStudentsByIds(formerIds)
        if (!cancelled) setFormerStudents(former)
      }
      if (!cancelled) setLoadingStudents(false)
    }
    load()
    return () => { cancelled = true }
  }, [exam.id, exam.classId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Merged active list: enrolled students ∪ attendance students (deduped),
  // ordered A–Z by name so the marks table reads like a dictionary.
  const activeStudents = useMemo<Student[]>(() => {
    const map = new Map<string, Student>((cls?.students ?? []).map((s) => [s.id, s]))
    attendanceStudents.forEach((s) => { if (!map.has(s.id)) map.set(s.id, s) })
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    )
  }, [cls, attendanceStudents])

  // Local mark state — studentId -> subjectId -> string
  const seedScores = useMemo(() => {
    const seeded: Record<string, Record<string, string>> = {}
    activeStudents.forEach((st) => {
      seeded[st.id] = {}
      exam.subjects.forEach((sub) => {
        const v = exam.subjectScores[st.id]?.[sub.id]
        seeded[st.id][sub.id] = v !== undefined ? String(v) : ""
      })
    })
    return seeded
  }, [exam, activeStudents]) // eslint-disable-line react-hooks/exhaustive-deps

  const [scores, setScores] = useState(seedScores)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const tableRef = useRef<HTMLTableElement>(null)

  useEffect(() => {
    if (dirty) return
    setScores(seedScores)
  }, [seedScores]) // eslint-disable-line react-hooks/exhaustive-deps

  // Seed scores for former students once they load
  useEffect(() => {
    if (!formerStudents.length) return
    setScores((prev) => {
      const updated = { ...prev }
      formerStudents.forEach((st) => {
        if (updated[st.id]) return
        updated[st.id] = {}
        exam.subjects.forEach((sub) => {
          const v = exam.subjectScores[st.id]?.[sub.id]
          updated[st.id][sub.id] = v !== undefined ? String(v) : ""
        })
      })
      return updated
    })
  }, [formerStudents]) // eslint-disable-line react-hooks/exhaustive-deps

  const maxTotal = exam.subjects.reduce((s, sub) => s + sub.maxScore, 0)

  function updateMark(sId: string, subId: string, value: string) {
    setScores((prev) => ({ ...prev, [sId]: { ...prev[sId], [subId]: value } }))
    setDirty(true)
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>, rIdx: number, cIdx: number) {
    const subCount = exam.subjects.length
    const stCount = activeStudents.length
    let nr = rIdx, nc = cIdx
    if (e.key === "ArrowRight" || e.key === "Tab") {
      e.preventDefault()
      nc = (cIdx + 1) % subCount
      if (nc === 0 && e.key === "Tab") nr = Math.min(rIdx + 1, stCount - 1)
    } else if (e.key === "ArrowLeft") {
      e.preventDefault()
      nc = (cIdx - 1 + subCount) % subCount
    } else if (e.key === "ArrowDown" || e.key === "Enter") {
      e.preventDefault()
      nr = Math.min(rIdx + 1, stCount - 1)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      nr = Math.max(rIdx - 1, 0)
    } else return
    const inp = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${nr}"][data-c="${nc}"]`)
    inp?.focus()
    inp?.select()
  }

  function downloadClassCSV() {
    if (!cls) return
    const headers = ["Register No", "Student Name", ...exam.subjects.map((s) => s.name), "Total", "%", "Grade"]
    const rows = activeStudents.map((st) => {
      const stScores = scores[st.id] || {}
      const total = exam.subjects.reduce((s, sub) => s + (Number(stScores[sub.id]) || 0), 0)
      const hasAny = exam.subjects.some((sub) => stScores[sub.id] !== undefined && stScores[sub.id] !== "")
      const pct = hasAny && maxTotal ? Math.round((total / maxTotal) * 100) : 0
      const grade = hasAny ? getGrade(pct) : null
      return [
        st.rollNo,
        st.name,
        ...exam.subjects.map((sub) => stScores[sub.id] ?? ""),
        hasAny ? total : "",
        hasAny ? `${pct}%` : "",
        grade?.letter ?? "",
      ]
    })
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `marks-${cls.name.replace(/\s+/g, "-").toLowerCase()}-${exam.examName.replace(/\s+/g, "-").toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success("CSV downloaded")
  }

  async function downloadAllReportCards() {
    if (!cls) return
    const students = activeStudents.filter((st) =>
      exam.subjects.some((sub) => scores[st.id]?.[sub.id] !== undefined && scores[st.id]?.[sub.id] !== "")
    )
    if (students.length === 0) { toast.error("No marks entered yet — nothing to export."); return }

    const { default: jsPDF } = await import("jspdf")
    const { default: autoTable } = await import("jspdf-autotable")
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

    const fmtLong = (d: string) =>
      new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })

    const maxTotalMarks = exam.subjects.reduce((s, sub) => s + sub.maxScore, 0)
    const classScores = activeStudents
      .map((st) => ({ id: st.id, total: exam.subjects.reduce((s, sub) => s + (Number(scores[st.id]?.[sub.id] || 0)), 0) }))
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total)

    for (let idx = 0; idx < students.length; idx++) {
      const student = students[idx]
      if (idx > 0) doc.addPage()

      const contentY = await addReportHeader(
        doc,
        "",
        `${cls.name} · ${fmtLong(exam.date)} · Generated: ${new Date().toLocaleString("en-IN")}`,
      )

      // ── Centred highlighted title bar ──
      const NAVY = [30, 58, 95] as [number, number, number]
      const pageW = doc.internal.pageSize.getWidth()
      doc.setFillColor(...NAVY)
      doc.rect(14, contentY, pageW - 28, 11, "F")
      doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(255, 255, 255)
      doc.text(`${exam.examName} — Report Card`, pageW / 2, contentY + 7.5, { align: "center" })
      doc.setTextColor(0, 0, 0)
      const infoY = contentY + 15

      const stMarks = scores[student.id] || {}
      const total = exam.subjects.reduce((s, sub) => s + (Number(stMarks[sub.id] || 0)), 0)
      const pct = maxTotalMarks ? Math.round((total / maxTotalMarks) * 100) : 0
      const grade = getGrade(pct)
      const rank = classScores.findIndex((x) => x.id === student.id) + 1
      const passed = pct >= 33

      autoTable(doc, {
        startY: infoY,
        body: [
          ["Student Name", student.name],
          ["Registration No.", student.rollNo],
          ["Class / Section", cls.name],
          ["Examination", exam.examName],
          ...(rank > 0 ? [["Class Rank", `${rank} / ${classScores.length}`] as [string, string]] : []),
        ],
        styles: { fontSize: 9, cellPadding: 2.5 },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 50, fillColor: [248, 249, 252] } },
        theme: "plain",
      })

      const afterInfo = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? infoY + 28

      doc.setFontSize(10); doc.setFont("helvetica", "bold")
      doc.text("Subject-wise Performance", 14, afterInfo + 7)

      autoTable(doc, {
        startY: afterInfo + 11,
        head: [["#", "Subject", "Obtained", "Max", "%", "Grade", "Remarks"]],
        body: exam.subjects.map((sub, i) => {
          const obtained = Number(stMarks[sub.id] || 0)
          const subPct = sub.maxScore ? Math.round((obtained / sub.maxScore) * 100) : 0
          const subGrade = getGrade(subPct)
          return [i + 1, sub.name, obtained, sub.maxScore, `${subPct}%`, subGrade.letter, subGrade.label]
        }),
        foot: [["", "TOTAL", total, maxTotalMarks, `${pct}%`, grade.letter, grade.label]],
        styles: { fontSize: 8, cellPadding: 2.5 },
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
        footStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
        columnStyles: { 0: { cellWidth: 8 }, 2: { halign: "center" }, 3: { halign: "center" }, 4: { halign: "center" }, 5: { halign: "center", fontStyle: "bold" } },
      })

      const afterSubjects = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? afterInfo + 55
      const boxY = afterSubjects + 6

      // ── Performance Summary (left) ──
      autoTable(doc, {
        startY: boxY,
        margin: { left: 14 },
        tableWidth: 89,
        head: [["Performance Summary", ""]],
        body: [
          ["Percentage", `${pct.toFixed(2)}%`],
          ["Overall Grade", `${grade.letter} — ${grade.label}`],
          ["Rank", rank > 0 ? `${rank} / ${classScores.length}` : "—"],
          ["Result", passed ? "PASSED" : "FAILED"],
        ],
        styles: { fontSize: 9, cellPadding: 2.5 },
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", halign: "left" },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 44, fillColor: [248, 249, 252] }, 1: { halign: "right" } },
        theme: "grid",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        didParseCell: (data: any) => {
          if (data.section === "body" && data.row.index === 3 && data.column.index === 1) {
            data.cell.styles.textColor = passed ? [16, 185, 129] : [229, 62, 62]
            data.cell.styles.fontStyle = "bold"
          }
        },
      })

      const perfEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? boxY + 30

      // ── Remarks (right) — same startY for side-by-side layout ──
      const autoRemark =
        pct >= 80 ? "Demonstrates excellent academic performance and leadership qualities among peers." :
        pct >= 60 ? "Shows good progress. Consistent effort will lead to further improvement." :
        pct >= 33 ? "Needs to focus more on studies. Additional support is strongly recommended." :
        "Performance is below passing grade. Immediate intervention is required."

      autoTable(doc, {
        startY: boxY,
        margin: { left: 107 },
        tableWidth: 89,
        head: [["Remarks"]],
        body: [[`Class Teacher:  ${autoRemark}`]],
        styles: { fontSize: 9, cellPadding: 2.5 },
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
        theme: "grid",
      })

      const remarksEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? boxY + 30
      const afterBoxes = Math.max(perfEndY, remarksEndY)

      // ── Grading System ──
      doc.setFontSize(9); doc.setFont("helvetica", "bold")
      doc.text("Grading System", 14, afterBoxes + 7)
      autoTable(doc, {
        startY: afterBoxes + 11,
        head: [["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"]],
        body: [
          ["90-100%","80-89%","75-79%","70-74%","60-69%","55-59%","50-54%","45-49%","40-44%","33-39%","<33%"],
          ["Excellent","Very Good","Good+","Good","Above Avg","Average","Below Avg+","Below Avg","Weak+","Weak","Fail"],
        ],
        styles: { fontSize: 7, cellPadding: 2, halign: "center" },
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", halign: "center" },
        theme: "grid",
      })

      // ── Signature ──
      const pageH = doc.internal.pageSize.getHeight()
      doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(100)
      doc.line(14, pageH - 26, 70, pageH - 26)
      doc.text("Class Teacher Signature", 14, pageH - 22)
      doc.line(130, pageH - 26, 196, pageH - 26)
      doc.text("Head of Institute", 130, pageH - 22)
      doc.setTextColor(0)
    }

    doc.save(`report-cards-${cls.name.replace(/\s+/g, "-").toLowerCase()}-${exam.examName.replace(/\s+/g, "-").toLowerCase()}.pdf`)
    toast.success(`Downloaded ${students.length} report card${students.length > 1 ? "s" : ""}`)
  }

  async function handleSave() {
    // Validate — block scores over max or negative before saving
    const overMax: string[] = []
    const negative: string[] = []
    Object.entries(scores).forEach(([, subs]) => {
      exam.subjects.forEach((sub) => {
        const v = subs[sub.id]
        if (v === "" || v === undefined) return
        const n = Number(v)
        if (n < 0) negative.push(sub.name)
        else if (n > sub.maxScore) overMax.push(`${sub.name} (max ${sub.maxScore})`)
      })
    })
    if (negative.length > 0) {
      toast.error(`Negative scores are not allowed: ${negative.join(", ")}`)
      return
    }
    if (overMax.length > 0) {
      toast.error(`Scores exceed maximum: ${overMax.join(", ")}`)
      return
    }

    setSaving(true)
    // Pass ALL cells (including empty) so bulkSaveScores can clear intentionally-blanked cells
    const payload: Record<string, Record<string, number | "">> = {}
    Object.entries(scores).forEach(([sId, subs]) => {
      payload[sId] = {}
      Object.entries(subs).forEach(([subId, v]) => {
        if (v === "" || v === null) {
          payload[sId][subId] = ""
          return
        }
        const n = Number(v)
        if (!Number.isNaN(n)) payload[sId][subId] = n
      })
    })
    const { error } = await db.bulkSaveScores(exam.id, payload)
    setSaving(false)
    if (error) {
      const msg = (error as { message?: string })?.message ?? String(error)
      console.error("bulkSaveScores error:", error)
      toast.error("Failed to save marks", { description: msg, duration: 8000 })
      return
    }
    toast.success("Marks saved successfully", {
      description: "All scores have been synced to the database.",
      duration: 4000,
    })
    setDirty(false)
    onSaved()
  }

  if (!cls) {
    return (
      <div className="text-center py-12">
        <p className="text-navy-500 mb-4">Class not found for this exam.</p>
        <Button onClick={onBack}><ArrowLeft className="size-4 mr-1.5" /> Back</Button>
      </div>
    )
  }

  // Class avg per subject (footer)
  const subjectAvgs = exam.subjects.map((sub) => {
    const vals = activeStudents
      .map((st) => Number(scores[st.id]?.[sub.id] || 0))
      .filter((v) => v > 0)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2 text-xs text-navy-400">
        <button onClick={onBack} className="hover:text-navy-700 dark:hover:text-navy-200 transition-colors">Grade Book</button>
        <ChevronRight className="size-3" />
        <span className="text-navy-700 dark:text-navy-200 font-medium">{exam.examName}</span>
        <ChevronRight className="size-3" />
        <span className="text-gold-500 font-semibold">Marks Entry</span>
      </div>

      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="text-[11px] font-semibold text-gold-500 uppercase tracking-[0.09em] mb-1">Marks Entry</p>
          <h1 className="text-2xl font-extrabold text-navy-900 dark:text-white tracking-tight">{exam.examName}</h1>
          <p className="text-sm text-navy-500 dark:text-navy-400 mt-1">
            {cls.name} · {formatDate(exam.date)} · {exam.subjects.length} subjects · Max {maxTotal} marks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onBack} size="sm">
            <ArrowLeft className="size-4 mr-1.5" /> Back
          </Button>
          <Button variant="outline" onClick={downloadClassCSV} size="sm">
            <Download className="size-4 mr-1.5" /> Export CSV
          </Button>
          <Button variant="outline" onClick={downloadAllReportCards} size="sm">
            <Download className="size-4 mr-1.5" /> All Report Cards
          </Button>
          <Button variant="outline" onClick={onToppers} size="sm">
            <Trophy className="size-4 mr-1.5" /> Toppers
          </Button>
          <Button
            onClick={handleSave}
            size="sm"
            disabled={saving || !dirty}
            className="bg-gold-500 hover:bg-gold-600 text-navy-950 font-semibold gap-1.5"
          >
            <Save className="size-4" />
            {saving ? "Saving…" : dirty ? "Save All" : "Saved"}
          </Button>
        </div>
      </div>

      {/* Quick subject pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {exam.subjects.map((sub) => (
          <div key={sub.id} className="rounded-md border border-border bg-card px-2.5 py-1 text-center min-w-[60px]">
            <p className="text-[10px] font-bold text-navy-400 uppercase tracking-wider">{sub.name.slice(0, 4)}</p>
            <p className="text-xs font-bold text-gold-500 mt-0.5">{sub.maxScore}</p>
          </div>
        ))}
      </div>

      {/* Marks table */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table ref={tableRef} className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-navy-400 border-b border-border min-w-[80px]">
                  Register No
                </th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-navy-400 border-b border-r-2 border-border min-w-[160px]">
                  Student
                </th>
                {exam.subjects.map((sub) => (
                  <th key={sub.id} className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-navy-400 border-b border-border min-w-[80px]">
                    {sub.name}
                    <br />
                    <span className="font-normal text-[9px] text-navy-400 normal-case tracking-normal">/ {sub.maxScore}</span>
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-blue-500 border-b border-border min-w-[70px]">Total</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-blue-500 border-b border-border min-w-[64px]">%</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-blue-500 border-b border-border min-w-[64px]">Grade</th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-blue-500 border-b border-border min-w-[80px]">Report</th>
              </tr>
            </thead>
            <tbody>
              {loadingStudents && activeStudents.length === 0 && (
                <tr>
                  <td colSpan={exam.subjects.length + 6} className="px-6 py-10 text-center text-navy-400 text-sm">
                    Loading students…
                  </td>
                </tr>
              )}
              {!loadingStudents && activeStudents.length === 0 && (
                <tr>
                  <td colSpan={exam.subjects.length + 6} className="px-6 py-12 text-center text-navy-400 text-sm">
                    No students found for this class. Ensure students are enrolled and attendance has been marked.
                  </td>
                </tr>
              )}
              {activeStudents.map((st, sIdx) => {
                const stScores = scores[st.id] || {}
                const total = exam.subjects.reduce((s, sub) => s + (Number(stScores[sub.id]) || 0), 0)
                const hasAny = exam.subjects.some((sub) => stScores[sub.id] !== undefined && stScores[sub.id] !== "")
                const pct = hasAny && maxTotal ? Math.round((total / maxTotal) * 100) : null
                const grade = pct !== null ? getGrade(pct) : null
                const rowBg = sIdx % 2 === 0 ? "" : "bg-navy-50/30 dark:bg-navy-950/40"
                return (
                  <tr key={st.id} className={cn("border-b border-border/50", rowBg)}>
                    <td className={cn("px-4 py-2 text-xs font-mono text-navy-600 dark:text-navy-300", rowBg || "bg-card")}>
                      {st.rollNo}
                    </td>
                    <td className={cn("px-4 py-2 border-r-2 border-border", rowBg || "bg-card")}>
                      <p className="text-xs font-semibold text-navy-700 dark:text-navy-200 leading-tight">{st.name}</p>
                    </td>
                    {exam.subjects.map((sub, cIdx) => {
                      const val = stScores[sub.id] ?? ""
                      const num = Number(val)
                      const isOver = val !== "" && num > sub.maxScore
                      return (
                        <td
                          key={sub.id}
                          className={cn(
                            "border border-border/30 p-0",
                            isOver && "bg-red-500/[0.08]"
                          )}
                        >
                          <input
                            type="number"
                            min={0}
                            max={sub.maxScore}
                            step="any"
                            inputMode="decimal"
                            data-r={sIdx}
                            data-c={cIdx}
                            value={val}
                            onChange={(e) => updateMark(st.id, sub.id, e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => handleKey(e, sIdx, cIdx)}
                            className={cn(
                              "w-full px-2 py-2.5 bg-transparent border-none outline-none text-center text-sm font-medium transition-colors",
                              "focus:bg-gold-500/10 focus:text-gold-500",
                              isOver && "text-red-500"
                            )}
                          />
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 text-center bg-navy-50/40 dark:bg-navy-950/40 border border-border/30">
                      <span className={cn("font-bold text-xs", hasAny ? "text-navy-700 dark:text-navy-100" : "text-navy-400")}>
                        {hasAny ? total : "—"}
                      </span>
                      {hasAny && <span className="block text-[10px] text-navy-400">/{maxTotal}</span>}
                    </td>
                    <td className="px-3 py-2 text-center bg-navy-50/40 dark:bg-navy-950/40 border border-border/30">
                      <span className={cn("font-bold text-xs", pct !== null ? (pct >= 33 ? "text-emerald-500" : "text-red-500") : "text-navy-400")}>
                        {pct !== null ? `${pct}%` : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center bg-navy-50/40 dark:bg-navy-950/40 border border-border/30">
                      {grade ? (
                        <span className={cn("inline-flex px-2 py-0.5 rounded-md text-xs font-bold", grade.bg, grade.color)}>
                          {grade.letter}
                        </span>
                      ) : (
                        <span className="text-navy-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center bg-navy-50/40 dark:bg-navy-950/40 border border-border/30">
                      {hasAny ? (
                        <button
                          onClick={() => onViewReport(st.id)}
                          className="text-[11px] font-semibold text-navy-500 hover:text-gold-500 transition-colors px-2 py-1 rounded hover:bg-gold-500/5"
                        >
                          View
                        </button>
                      ) : (
                        <span className="text-navy-400 text-[11px]">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}

              {/* ── Former Students section ── */}
              {formerStudents.length > 0 && (
                <>
                  <tr>
                    <td
                      colSpan={exam.subjects.length + 6}
                      className="px-4 py-2 bg-amber-500/5 border-y border-amber-500/20 cursor-pointer select-none"
                      onClick={() => setShowFormer((f) => !f)}
                    >
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                        <ChevronRight className={cn("size-3.5 transition-transform", showFormer && "rotate-90")} />
                        Former Students ({formerStudents.length}) — transferred or removed after marks were recorded
                      </span>
                    </td>
                  </tr>
                  {showFormer && formerStudents.map((st) => {
                    const stScores = scores[st.id] || {}
                    const total = exam.subjects.reduce((s, sub) => s + (Number(stScores[sub.id]) || 0), 0)
                    const hasAny = exam.subjects.some((sub) => stScores[sub.id] !== undefined && stScores[sub.id] !== "")
                    const pct = hasAny && maxTotal ? Math.round((total / maxTotal) * 100) : null
                    const grade = pct !== null ? getGrade(pct) : null
                    return (
                      <tr key={st.id} className="border-b border-amber-500/10 bg-amber-500/[0.03]">
                        <td className="px-4 py-2 text-xs font-mono text-navy-500 dark:text-navy-300 bg-amber-50/60 dark:bg-amber-950/20">
                          {st.rollNo}
                        </td>
                        <td className="px-4 py-2 border-r-2 border-amber-500/20 bg-amber-50/60 dark:bg-amber-950/20">
                          <p className="text-xs font-semibold text-navy-600 dark:text-navy-300 leading-tight">{st.name}</p>
                          <p className="text-[10px] text-amber-500">Former</p>
                        </td>
                        {exam.subjects.map((sub) => {
                          const val = stScores[sub.id] ?? ""
                          return (
                            <td key={sub.id} className="border border-border/20 px-3 py-2 text-center text-xs text-navy-500 dark:text-navy-300 bg-amber-500/[0.03]">
                              {val !== "" ? val : <span className="text-navy-300">—</span>}
                            </td>
                          )
                        })}
                        <td className="px-3 py-2 text-center text-xs font-bold text-navy-600 dark:text-navy-300 border border-border/20">{hasAny ? total : "—"}</td>
                        <td className="px-3 py-2 text-center text-xs text-navy-500 border border-border/20">{pct !== null ? `${pct}%` : "—"}</td>
                        <td className="px-3 py-2 text-center border border-border/20">
                          {grade ? (
                            <span className={cn("inline-flex px-2 py-0.5 rounded-md text-xs font-bold", grade.bg, grade.color)}>
                              {grade.letter}
                            </span>
                          ) : <span className="text-navy-400 text-xs">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center border border-border/20">
                          {hasAny ? (
                            <button
                              onClick={() => onViewReport(st.id)}
                              className="text-[11px] font-semibold text-navy-500 hover:text-gold-500 transition-colors px-2 py-1 rounded hover:bg-gold-500/5"
                            >
                              View
                            </button>
                          ) : <span className="text-navy-400 text-[11px]">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </>
              )}
            </tbody>
            {/* Class average */}
            {activeStudents.length > 0 && (
              <tfoot>
                <tr className="bg-navy-100 dark:bg-navy-950 border-t-2 border-border">
                  <td className="bg-navy-100 dark:bg-navy-950 px-4 py-2.5 border border-border/30" />
                  <td className="bg-navy-100 dark:bg-navy-950 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-navy-400 border-r-2 border-border">
                    Class Avg
                  </td>
                  {subjectAvgs.map((avg, i) => (
                    <td key={i} className="px-3 py-2.5 text-center text-xs font-bold text-navy-500 border border-border/30">
                      {avg !== null ? avg : "—"}
                    </td>
                  ))}
                  <td colSpan={4} className="border border-border/30" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-navy-400">
        {GRADE_TIERS.map((tier) => (
          <div key={tier.letter} className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded", tier.bg)}>
            <span className={cn("text-[9px] font-extrabold", tier.color)}>{tier.letter}</span>
            <span className={cn("text-[9px]", tier.color)}>{tier.label}</span>
          </div>
        ))}
        <span className="text-[10px] text-navy-400 ml-1">· Pass ≥ 33 %</span>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Report Card view — print-ready, exports as PDF via window.print()
// ═══════════════════════════════════════════════════════════════════
function ReportCardView({
  exam,
  cls,
  student,
  onBack,
  onCertificate,
}: {
  exam: db.GradeBookExam
  cls: { id: string; name: string; students: { id: string; name: string; rollNo: string }[] }
  student: { id: string; name: string; rollNo: string }
  onBack: () => void
  onCertificate: () => void
}) {
  const stMarks = exam.subjectScores[student.id] || {}
  const total = exam.subjects.reduce((s, sub) => s + (Number(stMarks[sub.id]) || 0), 0)
  const maxTotal = exam.subjects.reduce((s, sub) => s + sub.maxScore, 0)
  const pct = maxTotal ? Math.round((total / maxTotal) * 100) : 0
  const grade = getGrade(pct)

  // Class rank
  const classScores = cls.students
    .map((st) => {
      const m = exam.subjectScores[st.id] || {}
      return { id: st.id, total: exam.subjects.reduce((s, sub) => s + (Number(m[sub.id]) || 0), 0) }
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total)
  const rank = classScores.findIndex((x) => x.id === student.id) + 1

  const fmtLong = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })

  async function downloadReportCardPDF() {
    const { default: jsPDF } = await import("jspdf")
    const { default: autoTable } = await import("jspdf-autotable")
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

    const contentY = await addReportHeader(
      doc,
      "",
      `${cls.name} · ${fmtLong(exam.date)} · Generated: ${new Date().toLocaleString("en-IN")}`,
    )

    // ── Centred highlighted title bar ──
    const NAVY = [30, 58, 95] as [number, number, number]
    const pageW = doc.internal.pageSize.getWidth()
    doc.setFillColor(...NAVY)
    doc.rect(14, contentY, pageW - 28, 11, "F")
    doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(255, 255, 255)
    doc.text(`${exam.examName} — Report Card`, pageW / 2, contentY + 7.5, { align: "center" })
    doc.setTextColor(0, 0, 0)
    const infoY = contentY + 15

    // Student info block
    autoTable(doc, {
      startY: infoY,
      body: [
        ["Student Name", student.name],
        ["Registration No.", student.rollNo],
        ["Class / Section", cls.name],
        ["Examination", exam.examName],
        ["Date", fmtLong(exam.date)],
        ...(rank > 0 ? [["Class Rank", `${rank} / ${classScores.length}`] as [string, string]] : []),
      ],
      styles: { fontSize: 9, cellPadding: 2.5 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 50, fillColor: [248, 249, 252] } },
      theme: "plain",
    })

    const afterInfo = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? infoY + 30

    // Subject-wise performance table
    doc.setFontSize(10); doc.setFont("helvetica", "bold")
    doc.text("Subject-wise Performance", 14, afterInfo + 7)

    autoTable(doc, {
      startY: afterInfo + 11,
      head: [["#", "Subject", "Obtained", "Max", "%", "Grade", "Remarks"]],
      body: exam.subjects.map((sub, i) => {
        const obtained = Number(stMarks[sub.id] || 0)
        const subPct = sub.maxScore ? Math.round((obtained / sub.maxScore) * 100) : 0
        const subGrade = getGrade(subPct)
        return [i + 1, sub.name, obtained, sub.maxScore, `${subPct}%`, subGrade.letter, subGrade.label]
      }),
      foot: [["", "TOTAL", total, maxTotal, `${pct}%`, grade.letter, grade.label]],
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 8 }, 2: { halign: "center" }, 3: { halign: "center" }, 4: { halign: "center" }, 5: { halign: "center", fontStyle: "bold" } },
    })

    const afterSubjects = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? afterInfo + 55
    const boxY = afterSubjects + 6
    const passed = pct >= 33

    // ── Performance Summary (left) ──
    autoTable(doc, {
      startY: boxY,
      margin: { left: 14 },
      tableWidth: 89,
      head: [["Performance Summary", ""]],
      body: [
        ["Percentage", `${pct.toFixed(2)}%`],
        ["Overall Grade", `${grade.letter} — ${grade.label}`],
        ["Rank", rank > 0 ? `${rank} / ${classScores.length}` : "—"],
        ["Result", passed ? "PASSED" : "FAILED"],
      ],
      styles: { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", halign: "left" },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 44, fillColor: [248, 249, 252] }, 1: { halign: "right" } },
      theme: "grid",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        if (data.section === "body" && data.row.index === 3 && data.column.index === 1) {
          data.cell.styles.textColor = passed ? [16, 185, 129] : [229, 62, 62]
          data.cell.styles.fontStyle = "bold"
        }
      },
    })

    const perfEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? boxY + 30

    // ── Remarks (right) ──
    const autoRemark =
      pct >= 80 ? "Demonstrates excellent academic performance and leadership qualities among peers." :
      pct >= 60 ? "Shows good progress. Consistent effort will lead to further improvement." :
      pct >= 33 ? "Needs to focus more on studies. Additional support is strongly recommended." :
      "Performance is below passing grade. Immediate intervention is required."

    autoTable(doc, {
      startY: boxY,
      margin: { left: 107 },
      tableWidth: 89,
      head: [["Remarks"]],
      body: [[`Class Teacher:  ${autoRemark}`]],
      styles: { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
      theme: "grid",
    })

    const remarksEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? boxY + 30
    const afterBoxes = Math.max(perfEndY, remarksEndY)

    // ── Grading System ──
    doc.setFontSize(9); doc.setFont("helvetica", "bold")
    doc.text("Grading System", 14, afterBoxes + 7)
    autoTable(doc, {
      startY: afterBoxes + 11,
      head: [["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"]],
      body: [
        ["90-100%","80-89%","75-79%","70-74%","60-69%","55-59%","50-54%","45-49%","40-44%","33-39%","<33%"],
        ["Excellent","Very Good","Good+","Good","Above Avg","Average","Below Avg+","Below Avg","Weak+","Weak","Fail"],
      ],
      styles: { fontSize: 7, cellPadding: 2, halign: "center" },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold", halign: "center" },
      theme: "grid",
    })

    // ── Signature ──
    const pageH = doc.internal.pageSize.getHeight()
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(100)
    doc.line(14, pageH - 26, 70, pageH - 26)
    doc.text("Class Teacher Signature", 14, pageH - 22)
    doc.line(130, pageH - 26, 196, pageH - 26)
    doc.text("Head of Institute", 130, pageH - 22)
    doc.setTextColor(0)

    doc.save(`report-card-${student.name.replace(/\s+/g, "-").toLowerCase()}-${exam.examName.replace(/\s+/g, "-").toLowerCase()}.pdf`)
  }

  const remark =
    pct >= 80
      ? `${student.name.split(" ")[0]} has demonstrated excellent performance this term. Keep up the outstanding work!`
      : pct >= 60
      ? `${student.name.split(" ")[0]} has shown satisfactory progress. With continued effort, further improvement is expected.`
      : `${student.name.split(" ")[0]} needs to focus more on studies. Additional support and practice is strongly recommended.`

  return (
    <div className="space-y-5">
      {/* Print-only stylesheet — hides app chrome so only the report prints */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              .no-print, .no-print * { display: none !important; }
              body, html { background: white !important; }
              header, nav, aside, footer, [role="navigation"] { display: none !important; }
              #report-card-page {
                box-shadow: none !important;
                margin: 0 !important;
                width: 100% !important;
                border-radius: 0 !important;
              }
              @page { margin: 12mm; }
            }
          `,
        }}
      />

      {/* Top bar (hidden in print) */}
      <div className="no-print">
        <div className="flex items-center gap-2 text-xs text-navy-400 mb-3">
          <button onClick={onBack} className="hover:text-navy-700 dark:hover:text-navy-200 transition-colors">Grade Book</button>
          <ChevronRight className="size-3" />
          <span>{exam.examName}</span>
          <ChevronRight className="size-3" />
          <span className="text-gold-500 font-semibold">Report Card</span>
        </div>
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="text-[11px] font-semibold text-gold-500 uppercase tracking-[0.09em] mb-1">Report Card</p>
            <h1 className="text-2xl font-extrabold text-navy-900 dark:text-white tracking-tight">{student.name}</h1>
            <p className="text-sm text-navy-500 dark:text-navy-400 mt-1">
              {exam.examName} · {cls.name} · {fmtLong(exam.date)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onBack} size="sm">
              <ArrowLeft className="size-4 mr-1.5" /> Back
            </Button>
            <Button variant="outline" onClick={() => window.print()} size="sm">
              <Printer className="size-4 mr-1.5" /> Print
            </Button>
            <Button variant="outline" onClick={downloadReportCardPDF} size="sm">
              <Download className="size-4 mr-1.5" /> Download PDF
            </Button>
            {pct >= 60 && (
              <Button onClick={onCertificate} size="sm" className="bg-gold-500 hover:bg-gold-600 text-navy-950 font-semibold gap-1.5">
                <Award className="size-4" />
                Certificate
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Print-ready document */}
      <div className="bg-[#f0f2f7] py-8 px-4 rounded-lg">
        <div
          id="report-card-page"
          className="bg-white text-[#0f2240] mx-auto p-12 shadow-2xl"
          style={{ width: 760, maxWidth: "100%", borderRadius: 4, fontFamily: "Inter, sans-serif" }}
        >
          {/* School header */}
          <div className="text-center pb-5 mb-5 border-b-2 border-[#1e3a5f]">
            <div className="flex items-center justify-center gap-3 mb-2.5">
              <img src="/logo.png" alt="Ihlamudheen Madrasa" className="h-10 w-auto object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
              <div>
                <p className="text-xl font-extrabold text-[#0f2240] tracking-tight" style={{ letterSpacing: "-0.02em" }}>Ihlamudheen Madrasa</p>
                <p className="text-xs text-[#5c6b82]">Ihlamudheen Madrasa · Malappuram, Kerala</p>
              </div>
            </div>
            <span className="inline-block bg-[#1e3a5f] text-white text-[11px] font-bold px-4 py-0.5 rounded-sm uppercase tracking-wider">
              Student Report Card
            </span>
          </div>

          {/* Student info */}
          <div className="grid grid-cols-2 mb-6 border border-[#dde3ed] rounded-md overflow-hidden">
            {(
              [
                ["Student Name", student.name],
                ["Reg No.", student.rollNo],
                ["Class / Section", cls.name],
                ["Examination", exam.examName],
                ["Date", fmtLong(exam.date)],
                ["Academic Year", `${new Date().getFullYear()} – ${new Date().getFullYear() + 1}`],
              ] as const
            ).map(([k, v], i) => (
              <div
                key={k}
                className="px-4 py-2.5 flex gap-3 border-b border-[#e8edf4]"
                style={{ background: i % 2 === 0 ? "#f8f9fc" : "#fff" }}
              >
                <span className="text-[11.5px] font-semibold text-[#5c6b82] w-[110px] shrink-0">{k}</span>
                <span className="text-xs font-semibold text-[#0f2240]">{v}</span>
              </div>
            ))}
          </div>

          {/* Subject-wise table */}
          <p className="text-[10.5px] font-bold text-[#0f2240] uppercase tracking-[0.06em] mb-2">Subject-wise Performance</p>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-[#1e3a5f] text-white">
                <th className="px-3.5 py-2 text-left text-[11px] font-semibold w-10">#</th>
                <th className="px-3.5 py-2 text-left text-[11px] font-semibold">Subject</th>
                <th className="px-3.5 py-2 text-center text-[11px] font-semibold">Obtained</th>
                <th className="px-3.5 py-2 text-center text-[11px] font-semibold">Max</th>
                <th className="px-3.5 py-2 text-center text-[11px] font-semibold">%</th>
                <th className="px-3.5 py-2 text-center text-[11px] font-semibold">Grade</th>
                <th className="px-3.5 py-2 text-center text-[11px] font-semibold">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {exam.subjects.map((sub, i) => {
                const obtained = Number(stMarks[sub.id] || 0)
                const subPct = sub.maxScore ? Math.round((obtained / sub.maxScore) * 100) : 0
                const subGrade = getGrade(subPct)
                return (
                  <tr key={sub.id} style={{ background: i % 2 === 0 ? "#fff" : "#f8f9fc" }} className="border-b border-[#e8edf4]">
                    <td className="px-3.5 py-2 text-center text-[#8899b0] text-xs">{i + 1}</td>
                    <td className="px-3.5 py-2 font-semibold text-[#1e3a5f] text-xs">{sub.name}</td>
                    <td
                      className="px-3.5 py-2 text-center font-bold text-xs"
                      style={{ color: obtained >= sub.maxScore * 0.5 ? "#1e3a5f" : "#e53e3e" }}
                    >
                      {obtained}
                    </td>
                    <td className="px-3.5 py-2 text-center text-[#5c6b82] text-xs">{sub.maxScore}</td>
                    <td className="px-3.5 py-2 text-center text-[#1e3a5f] text-xs">{subPct}%</td>
                    <td className="px-3.5 py-2 text-center text-xs font-bold" style={{ color: gradeHexColor(subGrade.letter) }}>
                      {subGrade.letter}
                    </td>
                    <td className="px-3.5 py-2 text-center text-[#5c6b82] text-xs">{subGrade.label}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-[#f0f2f7] border-t-2 border-[#1e3a5f] font-bold">
                <td colSpan={2} className="px-3.5 py-2.5 text-[#0f2240] text-xs">TOTAL</td>
                <td className="px-3.5 py-2.5 text-center text-[#1e3a5f] text-sm font-extrabold">{total}</td>
                <td className="px-3.5 py-2.5 text-center text-[#1e3a5f] text-xs">{maxTotal}</td>
                <td className="px-3.5 py-2.5 text-center text-sm font-extrabold" style={{ color: gradeHexColor(grade.letter) }}>{pct}%</td>
                <td className="px-3.5 py-2.5 text-center text-sm font-extrabold" style={{ color: gradeHexColor(grade.letter) }}>{grade.letter}</td>
                <td className="px-3.5 py-2.5 text-center text-xs font-bold" style={{ color: gradeHexColor(grade.letter) }}>{grade.label}</td>
              </tr>
            </tfoot>
          </table>

          {/* Summary cards */}
          <div className="mt-5 grid grid-cols-4 gap-2.5">
            {[
              ["Total Marks", `${total} / ${maxTotal}`, "#1e3a5f"],
              ["Percentage", `${pct}%`, gradeHexColor(grade.letter)],
              ["Grade", grade.letter, gradeHexColor(grade.letter)],
              rank > 0
                ? ["Class Rank", `#${rank}`, "#1e3a5f"]
                : ["Remarks", grade.label, gradeHexColor(grade.letter)],
            ].map(([l, v, c]) => (
              <div
                key={l}
                className="rounded-md border border-[#dde3ed] p-2.5 text-center"
                style={{ background: "#f8f9fc" }}
              >
                <p className="text-[10px] font-semibold text-[#8899b0] uppercase tracking-wider mb-1">{l}</p>
                <p className="text-base font-extrabold" style={{ color: c as string }}>
                  {v}
                </p>
              </div>
            ))}
          </div>

          {/* Remarks */}
          <div className="mt-5 border border-[#dde3ed] rounded-md px-4 py-3">
            <p className="text-[10.5px] font-bold text-[#5c6b82] uppercase tracking-wider mb-1.5">Teacher&apos;s Remarks</p>
            <p className="text-xs italic text-[#0f2240] leading-relaxed">{remark}</p>
          </div>

          {/* Signatures */}
          <div className="mt-8 grid grid-cols-3 gap-5">
            {["Class Teacher", "Principal", "Parent / Guardian"].map((role) => (
              <div key={role} className="text-center">
                <div className="border-b-2 border-[#0f2240] mb-1.5 pb-6" />
                <p className="text-[10px] font-semibold text-[#5c6b82] uppercase tracking-wider">{role}</p>
              </div>
            ))}
          </div>

          {/* Print footer */}
          <div className="mt-6 pt-3 border-t border-[#e8edf4] text-center">
            <p className="text-[10px] text-[#8899b0] tracking-wider">
              Ihlamudheen Madrasa · {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════
// Certificate view — premium, print-ready
// ═══════════════════════════════════════════════════════════════════
function CertificateView({
  exam,
  cls,
  student,
  onBack,
}: {
  exam: db.GradeBookExam
  cls: { id: string; name: string }
  student: { id: string; name: string }
  onBack: () => void
}) {
  const stMarks = exam.subjectScores[student.id] || {}
  const total = exam.subjects.reduce((s, sub) => s + (Number(stMarks[sub.id]) || 0), 0)
  const maxTotal = exam.subjects.reduce((s, sub) => s + sub.maxScore, 0)
  const pct = maxTotal ? Math.round((total / maxTotal) * 100) : 0
  const grade = getGrade(pct)
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })

  return (
    <div className="space-y-4">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              .no-print, .no-print * { display: none !important; }
              body, html { background: white !important; }
              header, nav, aside, footer, [role="navigation"] { display: none !important; }
              #certificate-page {
                box-shadow: none !important;
                margin: 0 !important;
                width: 100% !important;
              }
              @page { size: landscape; margin: 8mm; }
            }
          `,
        }}
      />

      <div className="no-print">
        <div className="flex items-center gap-2 text-xs text-navy-400 mb-3">
          <button onClick={onBack} className="hover:text-navy-700 dark:hover:text-navy-200 transition-colors">Report Card</button>
          <ChevronRight className="size-3" />
          <span className="text-gold-500 font-semibold">Certificate</span>
        </div>
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="text-[11px] font-semibold text-gold-500 uppercase tracking-[0.09em] mb-1">Certificate of Achievement</p>
            <h1 className="text-2xl font-extrabold text-navy-900 dark:text-white tracking-tight">{student.name}</h1>
            <p className="text-sm text-navy-500 dark:text-navy-400 mt-1">{exam.examName} · {cls.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onBack} size="sm">
              <ArrowLeft className="size-4 mr-1.5" /> Back
            </Button>
            <Button onClick={() => window.print()} size="sm" className="bg-gold-500 hover:bg-gold-600 text-navy-950 font-semibold gap-1.5">
              <Printer className="size-4" />
              Print / Save PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Certificate canvas */}
      <div className="rounded-2xl py-10 px-6 flex items-center justify-center" style={{ background: "#060d1a" }}>
        <div
          id="certificate-page"
          className="relative mx-auto"
          style={{
            width: 900,
            maxWidth: "100%",
            background: "linear-gradient(135deg, #0a1628 0%, #0f2240 60%, #081528 100%)",
            borderRadius: 16,
            boxShadow: "0 30px 80px rgba(0,0,0,0.7)",
            overflow: "hidden",
          }}
        >
          {/* Gold borders */}
          <div className="pointer-events-none absolute z-10" style={{ inset: 10, border: "1.5px solid rgba(245,166,35,0.3)", borderRadius: 10 }} />
          <div className="pointer-events-none absolute z-10" style={{ inset: 14, border: "1px solid rgba(245,166,35,0.12)", borderRadius: 8 }} />
          {/* Background glow */}
          <div className="pointer-events-none absolute" style={{ top: -60, right: -60, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,166,35,0.07) 0%, transparent 70%)" }} />
          <div className="pointer-events-none absolute" style={{ bottom: -40, left: -40, width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(circle, rgba(63,104,161,0.1) 0%, transparent 70%)" }} />

          {/* Corner ornaments */}
          {([
            { top: 16, left: 16, transform: "" },
            { top: 16, right: 16, transform: "scaleX(-1)" },
            { bottom: 16, left: 16, transform: "scaleY(-1)" },
            { bottom: 16, right: 16, transform: "scale(-1)" },
          ] as const).map((pos, i) => (
            <div key={i} className="pointer-events-none absolute z-20" style={{ ...pos, opacity: 0.5 }}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M2 14 L2 4 L12 4" stroke="#f5a623" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M2 4 L6 8" stroke="#f5a623" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
              </svg>
            </div>
          ))}

          {/* Content */}
          <div className="relative z-30 px-16 py-14 text-center">
            {/* School header */}
            <div className="flex items-center justify-center gap-3 mb-7">
              <div className="h-px flex-1" style={{ background: "linear-gradient(to right, transparent, rgba(245,166,35,0.4))" }} />
              <div className="flex items-center gap-2.5">
                <img src="/logo.png" alt="Ihlamudheen Madrasa" className="h-10 w-auto object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                <span className="text-xs font-bold tracking-wider text-[#9fb2d0] uppercase">Ihlamudheen Madrasa</span>
              </div>
              <div className="h-px flex-1" style={{ background: "linear-gradient(to left, transparent, rgba(245,166,35,0.4))" }} />
            </div>

            <p className="text-[10.5px] font-bold text-gold-500 uppercase mb-2.5" style={{ letterSpacing: "0.2em" }}>
              Certificate of Achievement
            </p>
            <div className="mx-auto mb-6" style={{ width: 60, height: 2, background: "linear-gradient(to right, transparent, #f5a623, transparent)" }} />

            <p className="text-sm text-[#7994bd] mb-2.5 tracking-wide">This certificate is proudly presented to</p>
            <h1
              className="font-extrabold text-white leading-none mb-1.5"
              style={{ fontSize: 44, letterSpacing: "-0.02em", textShadow: "0 0 40px rgba(245,166,35,0.2)" }}
            >
              {student.name}
            </h1>
            <div className="mx-auto my-4" style={{ width: 80, height: 2, background: "linear-gradient(to right, transparent, rgba(245,166,35,0.6), transparent)" }} />

            <p className="text-sm text-[#9fb2d0] leading-relaxed max-w-md mx-auto mb-6">
              for successfully completing the <strong className="text-[#e8edf4]">{exam.examName}</strong> with{" "}
              {pct >= 80 ? "outstanding" : pct >= 60 ? "satisfactory" : "demonstrated"} academic performance in{" "}
              <strong className="text-[#e8edf4]">{cls.name}</strong>.
            </p>

            {/* Score badges */}
            <div
              className="inline-flex gap-5 mb-8 px-7 py-3.5"
              style={{
                background: "rgba(245,166,35,0.06)",
                border: "1px solid rgba(245,166,35,0.15)",
                borderRadius: 12,
              }}
            >
              <div className="text-center">
                <p className="text-3xl font-extrabold text-gold-500 leading-none">{pct}%</p>
                <p className="text-[10.5px] text-[#5c6b82] uppercase tracking-wider mt-1">Score</p>
              </div>
              <div style={{ width: 1, background: "rgba(245,166,35,0.2)" }} />
              <div className="text-center">
                <p className="text-3xl font-extrabold leading-none" style={{ color: gradeHexColor(grade.letter) }}>{grade.letter}</p>
                <p className="text-[10.5px] text-[#5c6b82] uppercase tracking-wider mt-1">Grade</p>
              </div>
              <div style={{ width: 1, background: "rgba(245,166,35,0.2)" }} />
              <div className="text-center">
                <p className="text-3xl font-extrabold text-[#e8edf4] leading-none">{total}</p>
                <p className="text-[10.5px] text-[#5c6b82] uppercase tracking-wider mt-1">/{maxTotal} Marks</p>
              </div>
            </div>

            {/* Signatures */}
            <div className="grid grid-cols-3 gap-8 max-w-xl mx-auto">
              {["Class Teacher", "Principal", "Date"].map((role, i) => (
                <div key={role} className="text-center">
                  <div className="pb-5 mb-1.5" style={{ borderBottom: "1px solid rgba(245,166,35,0.25)" }}>
                    {i === 2 && <span className="text-xs text-[#7994bd]">{today}</span>}
                  </div>
                  <p className="text-[10px] font-semibold text-[#3f5168] uppercase tracking-wider">{role}</p>
                </div>
              ))}
            </div>

            {/* Footer */}
            <p className="mt-6 text-[10.5px] uppercase tracking-wider text-[#2c4a7e]">
              Ihlamudheen Madrasa · Malappuram, Kerala
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Scheduled Exams Grid — flip cards (English ⇄ Arabic)
// One card per scheduled exam (Half-Yearly + Final Year per class).
// Front: English. Back: Arabic. Click body to flip; action buttons
// (Edit / Enter Marks) don't trigger flip.
// Subject + portion data is joined back from src/data/syllabus.ts via
// the stable subject id stored in exam_subjects.id.
// ═══════════════════════════════════════════════════════════════════
function ScheduledExamsGrid({
  exams,
  classFilter,
  classesById,
  onEdit,
  onMarks,
}: {
  exams: db.GradeBookExam[]
  classFilter: string
  classesById: Record<string, { id: string; name: string; students: { id: string }[] }>
  onEdit: (exam: db.GradeBookExam) => void
  onMarks: (examId: number) => void
}) {
  const scheduled = exams.filter((e) => /Half-Yearly|Final Year|Annual Examination/i.test(e.examName))
  if (scheduled.length === 0) return null

  const sorted = [...scheduled].sort((a, b) => {
    if (a.classId !== b.classId) return a.classId.localeCompare(b.classId)
    const aHY = /Half-Yearly/i.test(a.examName)
    const bHY = /Half-Yearly/i.test(b.examName)
    return aHY === bHY ? 0 : aHY ? -1 : 1
  })

  return (
    <div>
      <div className="flex items-end justify-between mb-3 flex-wrap gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gold-500">
            Scheduled Syllabus Exams · {ACADEMIC_YEAR}
          </p>
          <h3 className="text-lg font-bold text-navy-900 dark:text-white">
            {classFilter ? (classesById[classFilter]?.name ?? "") : "All Classes"} — Half-Yearly & Annual
          </h3>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-navy-400">
          <Languages className="size-3.5" />
          Tap any card to flip between English and Arabic
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {sorted.map((exam) => (
          <FlipExamCard
            key={exam.id}
            exam={exam}
            cls={classesById[exam.classId]}
            onEdit={() => onEdit(exam)}
            onMarks={() => onMarks(exam.id)}
          />
        ))}
      </div>
    </div>
  )
}

function FlipExamCard({
  exam,
  cls,
  onEdit,
  onMarks,
}: {
  exam: db.GradeBookExam
  cls: { id: string; name: string; students: { id: string }[] } | undefined
  onEdit: () => void
  onMarks: () => void
}) {
  const [flipped, setFlipped] = useState(false)
  const isHY = /Half-Yearly/i.test(exam.examName)
  const examTypeEn = isHY ? "Half-Yearly Examination" : "Annual Examination"
  const examTypeAr = isHY ? "الامتحان النصفي" : "الامتحان السَّنوي"

  const gradeSyllabus = cls ? syllabusForClassId(cls.id) : undefined

  const subjectRows = exam.subjects.map((s) => ({
    dbSubject: s,
    meta: gradeSyllabus?.subjects.find((x) => x.id === s.id) as SyllabusSubject | undefined,
  }))

  const totalMax = exam.subjects.reduce((s, sub) => s + sub.maxScore, 0)
  const dateLong = new Date(exam.date + "T00:00:00").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  const dateAr = new Date(exam.date + "T00:00:00").toLocaleDateString("ar-AE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  const hasMarks = Object.values(exam.subjectScores).some((s) => Object.keys(s).length > 0)

  return (
    <div style={{ perspective: 1500 }} className="relative h-[440px]">
      <div
        onClick={(e) => {
          const target = e.target as HTMLElement
          if (target.closest("[data-no-flip]")) return
          setFlipped((f) => !f)
        }}
        style={{
          transformStyle: "preserve-3d",
          transition: "transform 0.7s cubic-bezier(0.23, 1, 0.32, 1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0)",
        }}
        className="relative size-full cursor-pointer"
      >
        {/* ── FRONT (English) ───────────────────────────────── */}
        <div
          style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
          className={cn(
            "absolute inset-0 rounded-xl border bg-card p-4 flex flex-col",
            isHY ? "border-blue-500/30" : "border-gold-500/30",
            "shadow-lg hover:shadow-xl transition-shadow"
          )}
        >
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-navy-400 mb-1">
                {cls?.name ?? "Class"} · {gradeSyllabus?.enLabel ?? ""}
              </p>
              <h4 className={cn("text-base font-extrabold leading-tight", isHY ? "text-blue-500" : "text-gold-500")}>
                {examTypeEn}
              </h4>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-navy-400 shrink-0">
              <Languages className="size-3" /> EN
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-navy-500 dark:text-navy-300 mb-3">
            <span className="flex items-center gap-1"><CalendarDays className="size-3" /> {dateLong}</span>
            <span className="font-semibold">Total: {totalMax} marks</span>
            {hasMarks && (
              <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[9px] font-bold uppercase">
                ● Entered
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto pr-1 space-y-1.5">
            {subjectRows.map(({ dbSubject, meta }, i) => {
              const portion = isHY ? meta?.halfYearlyPortion.en : meta?.finalYearPortion.en
              return (
                <div key={dbSubject.id} className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className="text-xs font-bold text-navy-900 dark:text-white truncate">
                      {i + 1}. {meta?.enName ?? dbSubject.name}
                    </span>
                    <span className="text-[10px] font-semibold text-navy-400 shrink-0">/{dbSubject.maxScore}</span>
                  </div>
                  {portion && (
                    <p className="text-[10.5px] text-navy-500 dark:text-navy-400 leading-snug">
                      📖 {portion}
                    </p>
                  )}
                </div>
              )
            })}
            {subjectRows.length === 0 && (
              <p className="text-[11px] italic text-navy-400 py-3 text-center">
                No subjects yet — click Edit to add.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 pt-3 mt-2 border-t border-border" data-no-flip>
            <Button size="sm" variant="outline" onClick={onEdit} className="flex-1 h-8 text-xs">
              <Edit3 className="size-3 mr-1" /> Edit
            </Button>
            <Button
              size="sm"
              onClick={onMarks}
              className={cn(
                "flex-1 h-8 text-xs font-semibold",
                isHY ? "bg-blue-500 hover:bg-blue-600 text-white" : "bg-gold-500 hover:bg-gold-600 text-navy-950"
              )}
            >
              <Eye className="size-3 mr-1" /> Enter Marks
            </Button>
          </div>
          <p className="text-[9.5px] text-navy-400 text-center mt-1.5">Tap card to flip → Arabic</p>
        </div>

        {/* ── BACK (Arabic) ────────────────────────────────── */}
        <div
          dir="rtl"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
          className={cn(
            "absolute inset-0 rounded-xl border bg-card p-4 flex flex-col",
            isHY ? "border-blue-500/30" : "border-gold-500/30",
            "shadow-lg"
          )}
        >
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-navy-400 mb-1">
                {gradeSyllabus?.arLabel ?? ""}
              </p>
              <h4 className={cn("text-lg font-extrabold leading-tight", isHY ? "text-blue-500" : "text-gold-500")}>
                {examTypeAr}
              </h4>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-navy-400 shrink-0" dir="ltr">
              <Languages className="size-3" /> AR
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-navy-500 dark:text-navy-300 mb-3">
            <span>{dateAr}</span>
            <span className="font-semibold">المجموع: {totalMax} درجة</span>
          </div>
          <div className="flex-1 overflow-y-auto pl-1 space-y-1.5">
            {subjectRows.map(({ dbSubject, meta }, i) => {
              const portion = isHY ? meta?.halfYearlyPortion.ar : meta?.finalYearPortion.ar
              return (
                <div key={dbSubject.id} className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className="text-sm font-bold text-navy-900 dark:text-white truncate">
                      {i + 1}. {meta?.arName ?? dbSubject.name}
                    </span>
                    <span className="text-[10px] font-semibold text-navy-400 shrink-0" dir="ltr">/{dbSubject.maxScore}</span>
                  </div>
                  {portion && (
                    <p className="text-[11.5px] text-navy-500 dark:text-navy-400 leading-snug">
                      📖 {portion}
                    </p>
                  )}
                </div>
              )
            })}
            {subjectRows.length === 0 && (
              <p className="text-[11px] italic text-navy-400 py-3 text-center">
                لم تتم إضافة مواد بعد — اضغط تعديل لإضافة.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 pt-3 mt-2 border-t border-border" data-no-flip dir="ltr">
            <Button size="sm" variant="outline" onClick={onEdit} className="flex-1 h-8 text-xs">
              <Edit3 className="size-3 mr-1" /> Edit
            </Button>
            <Button
              size="sm"
              onClick={onMarks}
              className={cn(
                "flex-1 h-8 text-xs font-semibold",
                isHY ? "bg-blue-500 hover:bg-blue-600 text-white" : "bg-gold-500 hover:bg-gold-600 text-navy-950"
              )}
            >
              <Eye className="size-3 mr-1" /> Enter Marks
            </Button>
          </div>
          <p className="text-[9.5px] text-navy-400 text-center mt-1.5">اضغط البطاقة للقلب → English</p>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Inline Exam Setup — replaces the empty state when class + exam
// type are both selected. Teacher only needs to add subjects;
// the exam name and date are auto-generated.
// ═══════════════════════════════════════════════════════════════════
function InlineExamSetup({
  classId,
  cls,
  examType,
  year,
  allExams,
  onCreated,
}: {
  classId: string
  cls: { id: string; name: string } | undefined
  examType: string
  year: string
  allExams: db.GradeBookExam[]
  onCreated: (examId: number) => void
}) {
  const autoName = `${cls?.name ?? "Class"} — ${examType} ${year}`
  // Default date = Oct 1 of the academic year's start (safely within any Sep-Aug year)
  const defaultDate = (() => {
    const startYear = parseInt(year.split("-")[0])
    return isNaN(startYear) ? new Date().toISOString().split("T")[0] : `${startYear}-04-01`
  })()

  const initialSubjects = useMemo<SubjectDraft[]>(() => {
    const syl = syllabusForClassId(classId)
    if (syl?.subjects?.length) {
      return syl.subjects.map((s) => ({
        id: `new-${s.id}`,
        name: s.enName,
        maxMarks: String(s.maxScore),
        isExisting: false,
      }))
    }
    // Inherit from an existing exam in the same class as a template
    const sibling = allExams.find((e) => e.classId === classId && e.subjects.length > 0)
    if (sibling) {
      return sibling.subjects.map((s) => ({
        id: `new-${s.id}`,
        name: s.name,
        maxMarks: String(s.maxScore),
        isExisting: false,
      }))
    }
    return [{ id: `new-${Date.now()}`, name: "", maxMarks: "", isExisting: false }]
  }, [classId]) // eslint-disable-line react-hooks/exhaustive-deps

  const [subjects, setSubjects] = useState<SubjectDraft[]>(initialSubjects)
  const [date, setDate] = useState(defaultDate)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const totalMarks = subjects.reduce((s, sub) => s + (Number(sub.maxMarks) || 0), 0)

  function addSubject() {
    setSubjects((prev) => [...prev, { id: `new-${Date.now()}`, name: "", maxMarks: "", isExisting: false }])
  }

  function removeSubject(id: string) {
    if (subjects.length === 1) return
    setSubjects((prev) => prev.filter((s) => s.id !== id))
  }

  function updateSubject(id: string, field: "name" | "maxMarks", value: string) {
    setSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)))
    setErrors((prev) => { const e = { ...prev }; delete e[`sub_${id}_${field}`]; return e })
  }

  async function handleSave() {
    const e: Record<string, string> = {}
    if (!date) e.date = "Date required"
    const seen = new Map<string, string>()
    subjects.forEach((s) => {
      if (!s.name.trim()) e[`sub_${s.id}_name`] = "Required"
      else if (seen.has(s.name.trim().toLowerCase())) e[`sub_${s.id}_name`] = "Duplicate"
      else seen.set(s.name.trim().toLowerCase(), s.id)
      if (!s.maxMarks || Number(s.maxMarks) <= 0) e[`sub_${s.id}_maxMarks`] = "Required"
    })
    setErrors(e)
    if (Object.keys(e).length > 0) return

    // Duplicate exam check
    const dupe = allExams.find(
      (ex) => ex.classId === classId && ex.examName.toLowerCase() === autoName.toLowerCase()
    )
    if (dupe) { toast.error("This exam already exists for the class"); return }

    setSaving(true)
    try {
      const subjectsToSave = subjects.map((s) => ({
        id: crypto.randomUUID(),
        name: s.name.trim(),
        maxScore: Number(s.maxMarks),
      }))
      const { error, examId } = await db.saveGrade(classId, autoName, date, totalMarks, subjectsToSave, {})
      if (error) throw error
      toast.success("Exam created — you can now enter marks")
      onCreated(examId as number)
    } catch (err) {
      console.error(err)
      toast.error("Failed to create exam. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-5 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-gold-500 uppercase tracking-wider mb-1">Add Subjects</p>
          <h3 className="text-base font-bold text-navy-900 dark:text-white">{autoName}</h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-400">Exam Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={cn(
                "text-xs rounded-lg border px-3 py-1.5 bg-white dark:bg-navy-900 text-navy-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40",
                errors.date ? "border-red-400" : "border-navy-200 dark:border-navy-700"
              )}
            />
          </div>
        </div>
      </div>

      {/* Subjects list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-navy-400">
            Subjects · <span className="text-gold-500 font-bold">{totalMarks} total marks</span>
          </span>
          <button
            onClick={addSubject}
            className="text-[11px] font-semibold text-sky-500 hover:text-sky-400 flex items-center gap-1"
          >
            <Plus className="size-3.5" /> Add Subject
          </button>
        </div>

        {subjects.map((sub, idx) => (
          <div key={sub.id} className="flex items-center gap-2">
            <span className="text-[10px] text-navy-400 w-5 text-right shrink-0">{idx + 1}</span>
            <div className="flex-1">
              <input
                type="text"
                value={sub.name}
                onChange={(e) => updateSubject(sub.id, "name", e.target.value)}
                placeholder="Subject name"
                className={cn(
                  "w-full text-xs rounded-lg border px-3 py-1.5 bg-white dark:bg-navy-900 text-navy-800 dark:text-white placeholder-navy-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40",
                  errors[`sub_${sub.id}_name`] ? "border-red-400" : "border-navy-200 dark:border-navy-700"
                )}
              />
              {errors[`sub_${sub.id}_name`] && (
                <p className="text-[10px] text-red-500 mt-0.5">{errors[`sub_${sub.id}_name`]}</p>
              )}
            </div>
            <div className="w-20">
              <input
                type="number"
                value={sub.maxMarks}
                onChange={(e) => updateSubject(sub.id, "maxMarks", e.target.value)}
                placeholder="Max"
                min={1}
                className={cn(
                  "w-full text-xs rounded-lg border px-3 py-1.5 bg-white dark:bg-navy-900 text-navy-800 dark:text-white placeholder-navy-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40 text-center",
                  errors[`sub_${sub.id}_maxMarks`] ? "border-red-400" : "border-navy-200 dark:border-navy-700"
                )}
              />
            </div>
            <button
              onClick={() => removeSubject(sub.id)}
              disabled={subjects.length === 1}
              className="p-1 rounded hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <X className="size-3.5 text-red-500" />
            </button>
          </div>
        ))}
      </div>

      {/* Save button */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <p className="text-[11px] text-navy-400">
          {subjects.filter((s) => s.name.trim()).length} subject{subjects.filter((s) => s.name.trim()).length !== 1 ? "s" : ""} · {totalMarks} marks
        </p>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-gold-500 hover:bg-gold-600 text-navy-950 font-semibold gap-2"
        >
          <Save className="size-4" />
          {saving ? "Creating…" : "Save & Enter Marks"}
        </Button>
      </div>
    </div>
  )
}
