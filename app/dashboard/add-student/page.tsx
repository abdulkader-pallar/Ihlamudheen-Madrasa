"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import {
  UserPlus,
  ChevronLeft,
  Users,
  Save,
  Loader2,
  BookOpen,
  CheckCircle2,
  ArrowRight,
  AlertTriangle,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import * as db from "@/lib/db"
import { initialCourses, type CourseData } from "@/data/courses"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { toast } from "sonner"

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

// A student flattened with its course/class context, used for the
// institute-wide register-number and name duplicate lookups.
interface IndexedStudent {
  id: string
  name: string
  rollNo: string
  gender?: "Male" | "Female"
  fatherName?: string
  motherName?: string
  fatherPhone?: string
  motherPhone?: string
  email?: string
  courseId: string
  courseTitle: string
  classId: string
  className: string
}

function StepBadge({ n, done }: { n: number; done?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
        done
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
          : "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300"
      )}
    >
      {done ? <CheckCircle2 className="size-3.5" /> : n}
    </span>
  )
}

export default function AddStudentPage() {
  const { user } = useAuth(false)
  const canAddStudents = user ? ["admin", "accountant"].includes(getUserRole(user)) : false

  const [courses, setCourses] = useState<CourseData[]>(initialCourses)
  const [useSupabase, setUseSupabase] = useState(false)
  const [loading, setLoading] = useState(true)

  // Selection
  const [courseId, setCourseId] = useState("")
  const [classId, setClassId] = useState("")

  // Student fields
  const [name, setName] = useState("")
  const [rollNo, setRollNo] = useState("")
  const [gender, setGender] = useState<"" | "Male" | "Female">("")
  const [father, setFather] = useState("")
  const [mother, setMother] = useState("")
  const [phone, setPhone] = useState("")
  const [altPhone, setAltPhone] = useState("")
  const [email, setEmail] = useState("")

  const [saving, setSaving] = useState(false)
  const [addedCount, setAddedCount] = useState(0)

  // Duplicate detection. When a typed register number or a picked name
  // resolves to an existing student, we auto-fill the columns with that
  // student's details and block Save so the same child can't be added twice.
  const [matched, setMatched] = useState<IndexedStudent | null>(null)
  const [matchSource, setMatchSource] = useState<"roll" | "name" | null>(null)
  const [showNameSuggestions, setShowNameSuggestions] = useState(false)

  // Load live data so the dropdowns and counts match the rest of the app.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ready = await db.checkSupabase()
      if (cancelled) return
      if (ready) {
        setUseSupabase(true)
        const dbCourses = await db.fetchCoursesFromDB()
        if (!cancelled) setCourses(dbCourses)
      }
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const course = useMemo(() => courses.find((c) => c.id === courseId), [courses, courseId])
  const classesInCourse = useMemo(() => course?.classes ?? [], [course])
  const cls = useMemo(
    () => classesInCourse.find((c) => c.id === classId),
    [classesInCourse, classId]
  )

  // Every student across every course/class, for duplicate lookups.
  const allStudents = useMemo<IndexedStudent[]>(() => {
    const out: IndexedStudent[] = []
    for (const c of courses) {
      for (const cl of c.classes) {
        for (const s of cl.students) {
          out.push({
            id: s.id,
            name: s.name,
            rollNo: s.rollNo,
            gender: s.gender,
            fatherName: s.fatherName,
            motherName: s.motherName,
            fatherPhone: s.fatherPhone,
            motherPhone: s.motherPhone,
            email: s.email,
            courseId: c.id,
            courseTitle: c.title,
            classId: cl.id,
            className: cl.name,
          })
        }
      }
    }
    return out
  }, [courses])

  // Name typeahead — existing students whose name matches what's being typed.
  // Hidden once a match has locked the form.
  const nameSuggestions = useMemo<IndexedStudent[]>(() => {
    if (matched) return []
    const q = name.trim().toLowerCase()
    if (q.length < 2) return []
    return allStudents
      .filter((s) => s.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1
        return aStarts - bStarts || a.name.localeCompare(b.name)
      })
      .slice(0, 6)
  }, [name, matched, allStudents])

  const locked = matched !== null

  function fillFromStudent(s: IndexedStudent) {
    setName(s.name)
    setRollNo(s.rollNo)
    setGender((s.gender as "Male" | "Female") || "")
    setFather(s.fatherName || "")
    setMother(s.motherName || "")
    setPhone(s.fatherPhone || "")
    setAltPhone(s.motherPhone || "")
    setEmail(s.email || "")
  }

  // Reset the class when the course changes.
  function handleCourseChange(id: string) {
    setCourseId(id)
    setClassId("")
  }

  // Register number is the canonical unique key — surface the owner the moment
  // a typed number matches an existing student, and auto-fill the columns.
  function handleRollChange(value: string) {
    const digits = value.replace(/\D/g, "")
    // If the form is locked by a name pick, ignore edits (use Clear to reset).
    if (locked && matchSource === "name") return
    setRollNo(digits)
    if (!digits) {
      if (matchSource === "roll") clearStudent()
      return
    }
    const m = allStudents.find((s) => (s.rollNo || "").trim() === digits)
    if (m) {
      fillFromStudent(m)
      setMatched(m)
      setMatchSource("roll")
      setShowNameSuggestions(false)
    } else if (matchSource === "roll") {
      // Was matched, no longer — release the lock and clear the auto-filled data.
      clearStudent()
      setRollNo(digits)
    }
  }

  function pickSuggestion(s: IndexedStudent) {
    fillFromStudent(s)
    setMatched(s)
    setMatchSource("name")
    setShowNameSuggestions(false)
  }

  function clearStudent() {
    setName("")
    setRollNo("")
    setGender("")
    setFather("")
    setMother("")
    setPhone("")
    setAltPhone("")
    setEmail("")
    setMatched(null)
    setMatchSource(null)
    setShowNameSuggestions(false)
  }

  const resetStudentFields = clearStudent

  async function handleSave() {
    if (!canAddStudents) {
      toast.error("Only admins and accountants can add students")
      return
    }
    if (!courseId) {
      toast.error("Select a course")
      return
    }
    if (!classId || !cls) {
      toast.error("Select a class")
      return
    }
    if (matched) {
      toast.error("This student already exists. Clear the form to add a different student.")
      return
    }

    const n = name.trim()
    const r = rollNo.trim()
    const f = father.trim()
    const m = mother.trim()
    const p = phone.trim()
    const alt = altPhone.trim()
    const em = email.trim()

    // Same mandatory-field rules as the Teachers add-student form. Email is
    // recommended but not required.
    if (!n) return toast.error("Student name is required")
    if (!r) return toast.error("Register number is required")
    if (!/^\d+$/.test(r)) return toast.error("Register number must contain digits only")
    if (!gender) return toast.error("Sex is required")
    if (!f) return toast.error("Father's name is required")
    if (!m) return toast.error("Mother's name is required")
    if (!p) return toast.error("Contact number is required")
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return toast.error("Enter a valid email address")

    // Register numbers uniquely identify a child institute-wide — reject dupes.
    const key = r.toLowerCase()
    for (const c of courses) {
      for (const cl of c.classes) {
        const existing = cl.students.find(
          (s) => (s.rollNo || "").trim().toLowerCase() === key
        )
        if (existing) {
          toast.error(
            `Register number ${r} already belongs to ${existing.name} (${c.title} · ${cl.name}). Duplicate not added.`,
            { duration: 6000 }
          )
          return
        }
      }
    }

    // A name on its own can legitimately repeat — different people share names,
    // so a free-typed name is allowed (only picking an existing student from the
    // suggestions blocks). But when the name AND both parents match an existing
    // student it's almost certainly the same child, so force a distinguishing
    // detail. Note: matching parents alone is fine — siblings share parents.
    const nameKey = n.toLowerCase()
    const fatherKey = f.toLowerCase()
    const motherKey = m.toLowerCase()
    const sameChild = allStudents.find(
      (s) =>
        s.name.trim().toLowerCase() === nameKey &&
        (s.fatherName || "").trim().toLowerCase() === fatherKey &&
        (s.motherName || "").trim().toLowerCase() === motherKey
    )
    if (sameChild) {
      toast.error(
        `${n} with the same father (${f}) and mother (${m}) already exists in ${sameChild.courseTitle} · ${sameChild.className}. Add a distinguishing detail (e.g. a middle name) so the two students can be told apart.`,
        { duration: 8000 }
      )
      return
    }

    setSaving(true)
    const studentId = `s${Date.now()}`

    if (useSupabase) {
      const { error } = await db.addStudent(classId, studentId, n, r)
      if (error) {
        toast.error("Failed to save student")
        setSaving(false)
        return
      }
      const { error: profileError } = await db.updateStudentProfile(studentId, {
        gender,
        fatherName: f,
        motherName: m,
        fatherPhone: p,
        email: em || null,
        ...(alt ? { motherPhone: alt } : {}),
      })
      if (profileError) {
        toast.error("Student saved, but failed to save parent details")
        setSaving(false)
        return
      }
    }

    // Update local state so counts stay accurate and dupes are caught.
    setCourses((prev) =>
      prev.map((c) =>
        c.id === courseId
          ? {
              ...c,
              classes: c.classes.map((cl) =>
                cl.id === classId
                  ? {
                      ...cl,
                      students: [
                        ...cl.students,
                        {
                          id: studentId,
                          name: n,
                          rollNo: r,
                          gender,
                          fatherName: f,
                          motherName: m,
                          fatherPhone: p,
                          ...(em ? { email: em } : {}),
                          ...(alt ? { motherPhone: alt } : {}),
                        },
                      ],
                    }
                  : cl
              ),
            }
          : c
      )
    )

    setSaving(false)
    setAddedCount((c) => c + 1)
    toast.success(`${n} added to ${cls.name}`)
    // Keep the course + class selected so the office can add several students
    // in a row; just clear the per-student fields.
    resetStudentFields()
  }

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-navy-100 dark:hover:bg-navy-800 transition-colors"
          aria-label="Back to dashboard"
        >
          <ChevronLeft className="size-5 text-navy-500" />
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-sky-500 text-white shadow-sm">
            <UserPlus className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Add Student</h1>
            <p className="text-sm text-navy-500 dark:text-navy-400">
              Enrol a new student into a course and class.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-navy-500 dark:text-navy-400">
          <Loader2 className="size-5 animate-spin" />
          <span>Loading courses…</span>
        </div>
      ) : !canAddStudents ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Users className="size-10 text-navy-300 dark:text-navy-600" />
            <p className="font-semibold text-navy-900 dark:text-white">Admins &amp; accountants only</p>
            <p className="text-sm text-navy-500 dark:text-navy-400">
              You don&apos;t have permission to add students.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Step 1 — Course */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-navy-900 dark:text-white">
                <StepBadge n={1} done={!!courseId} />
                Select course
              </div>
              <select
                className={selectClass}
                value={courseId}
                onChange={(e) => handleCourseChange(e.target.value)}
              >
                <option value="">Choose a course…</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.classes.length} {c.classes.length === 1 ? "class" : "classes"})
                  </option>
                ))}
              </select>
            </CardContent>
          </Card>

          {/* Step 2 — Class */}
          <AnimatePresence>
            {courseId && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Card>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-navy-900 dark:text-white">
                      <StepBadge n={2} done={!!classId} />
                      Select class
                    </div>
                    {classesInCourse.length === 0 ? (
                      <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-navy-200 dark:border-navy-700 p-4">
                        <p className="flex items-center gap-2 text-sm text-navy-500 dark:text-navy-400">
                          <BookOpen className="size-4" /> This course has no classes yet.
                        </p>
                        <Link
                          href="/dashboard/teachers"
                          className="inline-flex items-center gap-1 text-sm font-medium text-sky-600 hover:underline dark:text-sky-400"
                        >
                          Add a class in Teachers <ArrowRight className="size-3.5" />
                        </Link>
                      </div>
                    ) : (
                      <select
                        className={selectClass}
                        value={classId}
                        onChange={(e) => setClassId(e.target.value)}
                      >
                        <option value="">Choose a class…</option>
                        {classesInCourse.map((cl) => (
                          <option key={cl.id} value={cl.id}>
                            {cl.name} · {cl.schedule} ({cl.students.length} students)
                          </option>
                        ))}
                      </select>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Step 3 — Student details */}
          <AnimatePresence>
            {classId && cls && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Card className="border-gold-500/30">
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-navy-900 dark:text-white">
                        <StepBadge n={3} />
                        Student details
                      </div>
                      <span className="text-xs text-navy-500 dark:text-navy-400">
                        Adding to <span className="font-semibold text-navy-700 dark:text-navy-200">{cls.name}</span>
                      </span>
                    </div>

                    {/* Already-registered banner — shown when the register number
                        or a picked name resolves to an existing student. */}
                    {matched && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-400/50 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-900/20">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <div className="min-w-0">
                          <p className="font-semibold text-amber-800 dark:text-amber-300">
                            Already registered — {matched.name} (Reg {matched.rollNo})
                          </p>
                          <p className="text-amber-700 dark:text-amber-400/90">
                            Enrolled in {matched.courseTitle} · {matched.className}. The same student
                            can&apos;t be added twice — press <span className="font-semibold">Clear</span> to enter a different student.
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      {/* Name + autocomplete suggestions */}
                      <div className="relative">
                        <Input
                          placeholder="Student name *"
                          value={name}
                          autoComplete="off"
                          disabled={locked}
                          onChange={(e) => {
                            setName(e.target.value)
                            setShowNameSuggestions(true)
                          }}
                          onFocus={() => setShowNameSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowNameSuggestions(false), 150)}
                        />
                        {showNameSuggestions && nameSuggestions.length > 0 && (
                          <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg">
                            {nameSuggestions.map((s) => (
                              <li key={s.id}>
                                <button
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    pickSuggestion(s)
                                  }}
                                  className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-accent"
                                >
                                  <span className="text-sm font-medium text-navy-900 dark:text-white">{s.name}</span>
                                  <span className="text-xs text-navy-500 dark:text-navy-400">
                                    Reg {s.rollNo} · {s.courseTitle} · {s.className}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <Input
                        placeholder="Register number *"
                        value={rollNo}
                        onChange={(e) => handleRollChange(e.target.value)}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        disabled={locked && matchSource === "name"}
                        className="font-mono"
                      />
                      <select
                        value={gender}
                        onChange={(e) => setGender(e.target.value as "" | "Male" | "Female")}
                        disabled={locked}
                        className={cn(selectClass, "h-9", gender ? "text-foreground" : "text-muted-foreground")}
                        aria-label="Sex"
                      >
                        <option value="">Sex *</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                      </select>
                      <Input placeholder="Father's name *" value={father} disabled={locked} onChange={(e) => setFather(e.target.value)} />
                      <Input placeholder="Mother's name *" value={mother} disabled={locked} onChange={(e) => setMother(e.target.value)} />
                      <Input placeholder="Contact number *" value={phone} disabled={locked} onChange={(e) => setPhone(e.target.value)} className="font-mono" />
                      <Input placeholder="Alternate contact number" value={altPhone} disabled={locked} onChange={(e) => setAltPhone(e.target.value)} className="font-mono sm:col-span-2" />
                      <Input
                        placeholder="Email address (recommended)"
                        type="email"
                        inputMode="email"
                        value={email}
                        disabled={locked}
                        onChange={(e) => setEmail(e.target.value)}
                        className="sm:col-span-2"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        className="bg-gold-500 text-navy-950 hover:bg-gold-400"
                        onClick={handleSave}
                        disabled={saving || locked}
                      >
                        {saving ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Save className="size-4 mr-1" />}
                        {saving ? "Saving…" : "Save Student"}
                      </Button>
                      <Button variant="outline" onClick={resetStudentFields} disabled={saving}>
                        Clear
                      </Button>
                      {addedCount > 0 && (
                        <span className="ml-auto inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="size-4" /> {addedCount} added this session
                        </span>
                      )}
                    </div>

                    {!useSupabase && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Database not connected — students added here won&apos;t be saved permanently.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}
