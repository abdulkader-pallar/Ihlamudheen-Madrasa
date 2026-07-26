"use client"

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import {
  GraduationCap, ArrowRight, CheckSquare, Square,
  AlertTriangle, Check, Loader2, ChevronRight, ShieldAlert, Lock,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import * as db from "@/lib/db"
import { supabase } from "@/lib/supabase"
import { type CourseData } from "@/data/courses"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { toast } from "sonner"

interface StudentRow {
  id: string
  rollNo: string
  name: string
  classId: string
  className: string
  courseTitle: string
}

// Generate a list of academic year options (3 years back, 3 years forward)
function buildAcademicYears(): string[] {
  const current = new Date().getFullYear()
  const years: string[] = []
  for (let y = current - 2; y <= current + 2; y++) {
    years.push(`${y}-${y + 1}`)
  }
  return years
}

const ACADEMIC_YEARS = buildAcademicYears()
// Default: pick the one that started this calendar year
const defaultFromYear = ACADEMIC_YEARS[2] // e.g. "2025-2026"
const defaultToYear   = ACADEMIC_YEARS[3] // e.g. "2026-2027"

export default function PromotePage() {
  const { user } = useAuth(true)
  const role = getUserRole(user)
  const isAdmin = role === "admin"

  // ── STEP 0: Academic year gate ─────────────────────────────
  const [fromYear, setFromYear] = useState(defaultFromYear)
  const [toYear,   setToYear]   = useState(defaultToYear)
  const [yearConfirmed, setYearConfirmed] = useState(false)
  const [yearConfirmText, setYearConfirmText] = useState("")
  // Admin must type "CONFIRM" to proceed — prevents accidental bulk moves
  const CONFIRM_PHRASE = "CONFIRM"

  const [courses, setCourses] = useState<CourseData[]>([])
  const [loading, setLoading] = useState(true)

  // Source / destination selection
  const [sourceCourseId, setSourceCourseId] = useState("")
  const [sourceClassId,  setSourceClassId]  = useState("")
  const [destCourseId,   setDestCourseId]   = useState("")
  const [destClassId,    setDestClassId]    = useState("")

  // Students + selection
  const [students, setStudents] = useState<StudentRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Promotion state
  const [promoting, setPromoting] = useState(false)
  const [promoted,  setPromoted]  = useState<string[]>([])
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    const load = async () => {
      const ready = await db.checkSupabase()
      if (!ready) { setLoading(false); return }
      const dbCourses = await db.fetchCoursesFromDB()
      setCourses(dbCourses)
      setLoading(false)
    }
    load()
  }, [])

  // Reload students when source class changes
  useEffect(() => {
    if (!sourceCourseId || !sourceClassId) { setStudents([]); setSelected(new Set()); return }
    const course = courses.find(c => c.id === sourceCourseId)
    const cls    = course?.classes.find(cl => cl.id === sourceClassId)
    if (!cls) { setStudents([]); return }
    const rows: StudentRow[] = cls.students.map(s => ({
      id: s.id, rollNo: s.rollNo, name: s.name,
      classId: cls.id, className: cls.name, courseTitle: course!.title,
    })).sort((a, b) => a.name.localeCompare(b.name))
    setStudents(rows)
    setSelected(new Set(rows.map(s => s.id))) // pre-select ALL (everyone passes)
    setPromoted([])
  }, [sourceCourseId, sourceClassId, courses])

  const toggleAll = () => {
    if (selected.size === students.length) setSelected(new Set())
    else setSelected(new Set(students.map(s => s.id)))
  }

  const toggleStudent = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  const doPromote = useCallback(async () => {
    if (!destClassId || selected.size === 0) return
    setPromoting(true)
    setShowConfirm(false)
    try {
      const ids = Array.from(selected)
      const { error } = await supabase
        .from("students")
        .update({ class_id: destClassId })
        .in("id", ids)
      if (error) { toast.error("Promotion failed: " + error.message); return }
      const names = students.filter(s => selected.has(s.id)).map(s => s.name)
      setPromoted(names)
      toast.success(`${ids.length} student${ids.length !== 1 ? "s" : ""} promoted — ${fromYear} → ${toYear}`)
      const dbCourses = await db.fetchCoursesFromDB()
      setCourses(dbCourses)
      setSourceCourseId(""); setSourceClassId("")
      setDestCourseId("");   setDestClassId("")
      setStudents([]);       setSelected(new Set())
    } finally {
      setPromoting(false)
    }
  }, [destClassId, selected, students, fromYear, toYear])

  // ── Guard: admin only ──────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-500/10 mb-4">
          <Lock className="size-8 text-red-500" />
        </div>
        <p className="text-lg font-bold text-navy-800 dark:text-white mb-1">Admin Access Only</p>
        <p className="text-sm text-navy-500 dark:text-navy-400">
          Student promotion is a restricted operation available only to administrators.
        </p>
      </div>
    )
  }

  const sourceCourse = courses.find(c => c.id === sourceCourseId)
  const sourceClass  = sourceCourse?.classes.find(cl => cl.id === sourceClassId)
  const destCourse   = courses.find(c => c.id === destCourseId)
  const destClass    = destCourse?.classes.find(cl => cl.id === destClassId)
  const destClasses  = destCourse?.classes ?? []

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <GraduationCap className="size-8 text-indigo-500" /> Student Promotion
        </h1>
        <p className="mt-1 text-navy-600 dark:text-navy-300 text-sm">
          Bulk-promote students to the next class for the new academic year.
          Uncheck any student who should be held back.
        </p>
      </motion.div>

      {/* ═══ STEP 0 — Academic Year Gate ═══ */}
      <Card className={cn(
        "border-2",
        yearConfirmed ? "border-emerald-400/40" : "border-amber-400/60"
      )}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <span className={cn(
              "flex size-6 items-center justify-center rounded-full text-white text-xs font-bold",
              yearConfirmed ? "bg-emerald-500" : "bg-amber-500"
            )}>0</span>
            Academic Year
            {yearConfirmed && (
              <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/20 px-2 py-0.5 rounded-full">
                <Check className="size-3" /> Confirmed
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-navy-400 block mb-1">From Year</label>
              <select
                value={fromYear}
                onChange={e => { setFromYear(e.target.value); setYearConfirmed(false); setYearConfirmText("") }}
                disabled={yearConfirmed}
                className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
              >
                {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <ArrowRight className="size-5 text-indigo-500 mt-5" />
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-navy-400 block mb-1">To Year</label>
              <select
                value={toYear}
                onChange={e => { setToYear(e.target.value); setYearConfirmed(false); setYearConfirmText("") }}
                disabled={yearConfirmed}
                className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
              >
                {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {!yearConfirmed ? (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-300/50 dark:border-amber-500/30 px-4 py-3 space-y-3">
              <div className="flex items-start gap-2">
                <ShieldAlert className="size-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  <span className="font-bold">This is an irreversible bulk operation.</span> Students will be moved
                  from their current class to the next class for academic year{" "}
                  <span className="font-bold">{fromYear} → {toYear}</span>.
                  Type <span className="font-mono font-bold bg-amber-100 dark:bg-amber-900/40 px-1 rounded">CONFIRM</span> below to unlock the promotion tool.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={yearConfirmText}
                  onChange={e => setYearConfirmText(e.target.value.toUpperCase())}
                  placeholder="Type CONFIRM to proceed"
                  className="w-48 h-8 text-sm font-mono"
                  maxLength={8}
                />
                <Button
                  size="sm"
                  className="bg-amber-500 text-white hover:bg-amber-400"
                  disabled={yearConfirmText !== CONFIRM_PHRASE || fromYear === toYear}
                  onClick={() => setYearConfirmed(true)}
                >
                  Unlock
                </Button>
              </div>
              {fromYear === toYear && (
                <p className="text-[11px] text-red-500">⚠ From year and To year cannot be the same.</p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                ✅ Promoting students from academic year{" "}
                <span className="font-bold">{fromYear}</span> to{" "}
                <span className="font-bold">{toYear}</span>
              </p>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => { setYearConfirmed(false); setYearConfirmText("") }}
              >
                Change Year
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rest of the steps — locked until year is confirmed */}
      {!yearConfirmed ? (
        <div className="rounded-xl border border-border/40 bg-navy-50/50 dark:bg-navy-800/20 p-8 text-center">
          <Lock className="size-8 text-navy-300 dark:text-navy-600 mx-auto mb-2" />
          <p className="text-sm text-navy-400 dark:text-navy-500">
            Confirm the academic year above to unlock class selection and student promotion.
          </p>
        </div>
      ) : (
        <>
          {/* Promoted success banner */}
          {promoted.length > 0 && (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 px-5 py-4">
              <p className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
                <Check className="size-5" /> {promoted.length} student{promoted.length !== 1 ? "s" : ""} promoted — {fromYear} → {toYear}
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">{promoted.join(", ")}</p>
            </div>
          )}

          {/* Step 1 & 2 — Source + Destination */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-navy-400/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-navy-600 text-white text-xs font-bold">1</span>
                  From — Current Class ({fromYear})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-navy-400 block mb-1">Course</label>
                  <select
                    value={sourceCourseId}
                    onChange={e => { setSourceCourseId(e.target.value); setSourceClassId("") }}
                    className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm"
                    disabled={loading}
                  >
                    <option value="">— Select course —</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </div>
                {sourceCourseId && (
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-navy-400 block mb-1">Class</label>
                    <select
                      value={sourceClassId}
                      onChange={e => setSourceClassId(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm"
                    >
                      <option value="">— Select class —</option>
                      {(sourceCourse?.classes ?? []).map(cl => (
                        <option key={cl.id} value={cl.id}>{cl.name} ({cl.students.length} students)</option>
                      ))}
                    </select>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-indigo-400/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-indigo-500 text-white text-xs font-bold">2</span>
                  To — Next Class ({toYear})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-navy-400 block mb-1">Course</label>
                  <select
                    value={destCourseId}
                    onChange={e => { setDestCourseId(e.target.value); setDestClassId("") }}
                    className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm"
                  >
                    <option value="">— Select course —</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                </div>
                {destCourseId && (
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-navy-400 block mb-1">Class</label>
                    <select
                      value={destClassId}
                      onChange={e => setDestClassId(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm"
                    >
                      <option value="">— Select class —</option>
                      {destClasses.map(cl => (
                        <option key={cl.id} value={cl.id}>{cl.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Step 3 — Student selection */}
          {students.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500 text-white text-xs font-bold">3</span>
                    Select Students to Promote
                    <span className="text-xs font-normal text-navy-500 dark:text-navy-400">
                      {selected.size} of {students.length} selected
                    </span>
                  </CardTitle>
                  <Button size="sm" variant="outline" onClick={toggleAll}>
                    {selected.size === students.length
                      ? <><Square className="size-4 mr-1" /> Deselect All</>
                      : <><CheckSquare className="size-4 mr-1" /> Select All</>}
                  </Button>
                </div>
                <p className="text-xs text-navy-500 dark:text-navy-400 mt-1">
                  ✅ Checked = <span className="font-semibold text-emerald-600">Pass</span> (promoted to next class) &nbsp;·&nbsp;
                  ☐ Unchecked = <span className="font-semibold text-red-500">Hold back</span> (stays in current class)
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-navy-50/50 dark:bg-navy-800/30 border-b">
                        <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-navy-400 w-10">✓</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-navy-400 w-20">Reg No</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-navy-400">Student Name</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-navy-400 w-36">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {students.map((s) => {
                        const isSelected = selected.has(s.id)
                        return (
                          <tr
                            key={s.id}
                            onClick={() => toggleStudent(s.id)}
                            className={cn(
                              "cursor-pointer transition-colors",
                              isSelected
                                ? "bg-emerald-50/60 dark:bg-emerald-500/5 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                                : "bg-red-50/40 dark:bg-red-500/5 hover:bg-red-50/60 dark:hover:bg-red-500/10"
                            )}
                          >
                            <td className="px-4 py-2.5">
                              {isSelected
                                ? <CheckSquare className="size-4 text-emerald-500" />
                                : <Square className="size-4 text-navy-300 dark:text-navy-600" />}
                            </td>
                            <td className="px-4 py-2.5 text-xs font-mono text-navy-500">{s.rollNo}</td>
                            <td className="px-4 py-2.5">
                              <span className="text-sm font-medium text-navy-900 dark:text-white">{s.name}</span>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={cn(
                                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                isSelected
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                                  : "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400"
                              )}>
                                {isSelected ? "✓ Pass — Promote" : "✗ Hold Back"}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 4 — Promote button */}
          {students.length > 0 && (
            <Card className={cn("border-2", destClassId ? "border-indigo-400/50" : "border-border/40")}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="text-sm">
                    {sourceClass && destClass ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-navy-700 dark:text-navy-200">{sourceClass.name}</span>
                        <ArrowRight className="size-4 text-indigo-500" />
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">{destClass.name}</span>
                        <span className="text-navy-400 text-xs">({fromYear} → {toYear})</span>
                        <span className="text-navy-500">·</span>
                        <span className="text-emerald-600 font-semibold">{selected.size} promoted</span>
                        {students.length - selected.size > 0 && (
                          <>
                            <span className="text-navy-500">·</span>
                            <span className="text-red-500 font-semibold">{students.length - selected.size} held back</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-navy-400 text-xs">Select a destination class to continue</span>
                    )}
                  </div>
                  <Button
                    className="bg-indigo-500 text-white hover:bg-indigo-400 min-w-[180px]"
                    disabled={!destClassId || selected.size === 0 || promoting}
                    onClick={() => setShowConfirm(true)}
                  >
                    {promoting
                      ? <><Loader2 className="size-4 mr-1.5 animate-spin" /> Promoting…</>
                      : <><GraduationCap className="size-4 mr-1.5" /> Promote {selected.size > 0 ? selected.size : ""} Students</>}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Confirmation modal */}
      {showConfirm && sourceClass && destClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-navy-800 shadow-2xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="size-5 text-amber-500" />
              <h2 className="text-lg font-bold text-navy-900 dark:text-white">Confirm Promotion</h2>
            </div>
            <div className="rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 px-3 py-2 mb-3">
              <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-1">Academic Year</p>
              <p className="text-sm font-semibold text-navy-900 dark:text-white">{fromYear} → {toYear}</p>
            </div>
            <p className="text-sm text-navy-600 dark:text-navy-300 mb-2">
              Moving <span className="font-bold text-emerald-600">{selected.size} student{selected.size !== 1 ? "s" : ""}</span>:
            </p>
            <div className="flex items-center gap-2 text-sm font-semibold text-navy-900 dark:text-white mb-4 bg-navy-50 dark:bg-navy-700/50 rounded-lg px-3 py-2">
              <span>{sourceClass.name}</span>
              <ChevronRight className="size-4 text-indigo-500" />
              <span className="text-indigo-600 dark:text-indigo-400">{destClass.name}</span>
            </div>
            {students.length - selected.size > 0 && (
              <p className="text-xs text-red-500 mb-4">
                ⚠ {students.length - selected.size} student{students.length - selected.size !== 1 ? "s" : ""} will remain in {sourceClass.name} (held back).
              </p>
            )}
            <p className="text-xs text-navy-400 mb-4">This updates the database immediately and cannot be automatically undone.</p>
            <div className="flex gap-2">
              <Button className="bg-indigo-500 text-white hover:bg-indigo-400 flex-1" onClick={doPromote}>
                <GraduationCap className="size-4 mr-1" /> Confirm & Promote
              </Button>
              <Button variant="outline" onClick={() => setShowConfirm(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
