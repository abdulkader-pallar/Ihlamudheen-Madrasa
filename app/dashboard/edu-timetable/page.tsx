"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import {
  CalendarRange, FileText, Printer, Pencil, Save, X, Wand2,
  Download, ChevronDown, LayoutGrid, UserCheck, AlertTriangle, ShieldCheck,
  SlidersHorizontal, Shuffle,
} from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { fetchAllTimetables, saveClassTimetableDB, fetchEduAssignments } from "@/lib/db"
import type { PeriodAssignment } from "@/data/period-timetable"
import {
  EDU_GRADES, EDU_TEACHERS, EDU_PERIODS, EDU_RECESS, EDU_SUBJECTS,
  SUBJECTS_PER_WEEK, TOTAL_SLOTS, EDU_BELL_TIMETABLE_ID,
  buildEmptyWeekly, countSubjects, subjectCode, subjectId,
  eduGradeById, eduTeacherById, periodsForDay, type EduTeacher,
} from "@/data/edu-support-timetable"
import { buildEduSchedule } from "@/lib/edu-scheduler"
import { eligibilityFromAssignments } from "@/lib/edu-loadplan"
import { BRAND_NAME, BRAND_SUBLINE, BRAND_LOGO_URL, addReportHeader } from "@/lib/branding"
import type { jsPDF as JsPDFDoc } from "jspdf"

const NAVY: [number, number, number] = [30, 58, 95]
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
const SHORT_DAY: Record<string, string> = {
  Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri",
}

type Mode = "class" | "teacher"
type GradeData = Record<string, PeriodAssignment[]>

// Column layout: P1, P2, RECESS, P3, P4, P5
type Col = { kind: "period"; label: string; start: string; end: string } | { kind: "recess" }
const COLUMNS: Col[] = [
  { kind: "period", ...EDU_PERIODS[0] },
  { kind: "period", ...EDU_PERIODS[1] },
  { kind: "recess" },
  { kind: "period", ...EDU_PERIODS[2] },
  { kind: "period", ...EDU_PERIODS[3] },
  { kind: "period", ...EDU_PERIODS[4] },
]

function slotExists(day: string, label: string): boolean {
  return periodsForDay(day).some((p) => p.label === label)
}
function firstName(n?: string) { return (n ?? "").split(" ")[0] }

// A double-booking conflict plus the fixes the system suggests for it.
type SlotRef = { day: string; label: string }
type ConflictFix = {
  day: string
  periodLabel: string
  teacherId: string
  teacherName: string
  gradeA: string  // first grade holding the teacher in this slot
  gradeB: string  // the duplicate grade — the cell we'd reassign / move
  subjectName: string
  free: EduTeacher[]   // qualified teachers free at this slot (one-click reassign)
  swaps: SlotRef[]     // periods in gradeB we could swap this lesson into instead
}

// Is a teacher already teaching some grade at this exact day + period?
function isBusyAt(data: GradeData, teacherId: string, day: string, label: string): boolean {
  for (const g of EDU_GRADES) {
    for (const a of data[g.id] ?? []) {
      if (a.teacherId === teacherId && a.day === day && a.periodLabel === label) return true
    }
  }
  return false
}

// All double-bookings across grades (gradeB is the duplicate to fix).
function findConflicts(data: GradeData) {
  const seen = new Map<string, string>() // slot+teacher → first gradeId
  const out: { gradeA: string; gradeB: string; day: string; label: string; teacherId: string; teacherName: string; subjectName: string }[] = []
  for (const g of EDU_GRADES) {
    for (const a of data[g.id] ?? []) {
      if (!a.teacherId || !a.subjectName) continue
      const key = `${a.day}|${a.periodLabel}|${a.teacherId}`
      const other = seen.get(key)
      if (other && other !== g.id) {
        out.push({
          gradeA: other, gradeB: g.id, day: a.day, label: a.periodLabel,
          teacherId: a.teacherId, teacherName: a.teacherName ?? a.teacherId, subjectName: a.subjectName,
        })
      } else if (!other) {
        seen.set(key, g.id)
      }
    }
  }
  return out
}

// Qualified teachers who are free in this exact slot.
function freeTeachersFor(data: GradeData, subjectName: string, teacherId: string, day: string, label: string): EduTeacher[] {
  return EDU_TEACHERS.filter(
    (t) => t.id !== teacherId && t.canTeach.includes(subjectName) && !isBusyAt(data, t.id, day, label),
  )
}

// Periods within gradeB we could swap the conflicting lesson into without
// creating a new clash (moves the double-booked teacher to a slot where they
// are free; the swapped-in lesson's teacher must also be free in the old slot).
function findSwapTargets(data: GradeData, c: { gradeB: string; day: string; label: string; teacherId: string }): SlotRef[] {
  const targets: SlotRef[] = []
  for (const b of data[c.gradeB] ?? []) {
    if (b.day === c.day && b.periodLabel === c.label) continue
    if (!slotExists(b.day, b.periodLabel)) continue
    if (isBusyAt(data, c.teacherId, b.day, b.periodLabel)) continue          // T must be free in the target slot
    if (b.teacherId && isBusyAt(data, b.teacherId, c.day, c.label)) continue // swapped-in teacher must be free in the old slot
    targets.push({ day: b.day, label: b.periodLabel })
  }
  return targets
}

// Swap the subject+teacher content of two periods within one grade.
function swapCells(list: PeriodAssignment[], a: SlotRef, b: SlotRef): PeriodAssignment[] {
  const ca = list.find((x) => x.day === a.day && x.periodLabel === a.label)
  const cb = list.find((x) => x.day === b.day && x.periodLabel === b.label)
  if (!ca || !cb) return list
  const content = (s: PeriodAssignment) => ({ subjectId: s.subjectId, subjectName: s.subjectName, teacherId: s.teacherId, teacherName: s.teacherName })
  const fromA = content(ca), fromB = content(cb)
  return list.map((x) => {
    if (x.day === a.day && x.periodLabel === a.label) return { ...x, ...fromB }
    if (x.day === b.day && x.periodLabel === b.label) return { ...x, ...fromA }
    return x
  })
}

// Resolve as many conflicts as possible automatically: prefer reassigning to a
// free qualified teacher, else swap the lesson to a clash-free period. Returns
// the new data, the set of grades changed, and how many conflicts remain.
function autoResolveConflicts(data: GradeData): { data: GradeData; changed: Set<string>; remaining: number } {
  const next: GradeData = {}
  for (const g of EDU_GRADES) next[g.id] = (data[g.id] ?? []).map((a) => ({ ...a }))
  const changed = new Set<string>()

  for (let guard = 0; guard < 500; guard++) {
    const conflicts = findConflicts(next)
    let acted = false
    for (const c of conflicts) {
      const free = freeTeachersFor(next, c.subjectName, c.teacherId, c.day, c.label)
      if (free.length) {
        const cell = next[c.gradeB].find((a) => a.day === c.day && a.periodLabel === c.label)
        if (cell) { cell.teacherId = free[0].id; cell.teacherName = free[0].name; changed.add(c.gradeB); acted = true; break }
      }
      const swaps = findSwapTargets(next, c)
      if (swaps.length) {
        next[c.gradeB] = swapCells(next[c.gradeB], { day: c.day, label: c.label }, swaps[0])
        changed.add(c.gradeB); acted = true; break
      }
    }
    if (!acted) break
  }
  return { data: next, changed, remaining: findConflicts(next).length }
}

export default function EduTimetablePage() {
  const { user } = useAuth()
  const isAdmin = getUserRole(user) === "admin"

  const [mode, setMode] = useState<Mode>("class")
  const [gradeId, setGradeId] = useState(EDU_GRADES[0].id)
  const [teacherId, setTeacherId] = useState(EDU_TEACHERS[0].id)
  const [data, setData] = useState<GradeData>({})
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)

  const grade = eduGradeById(gradeId)!

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const all = await fetchAllTimetables()
      if (cancelled) return
      const next: GradeData = {}
      for (const g of EDU_GRADES) {
        const mine = all?.filter((a) => a.classId === g.id) ?? []
        next[g.id] = mine.length ? mine : buildEmptyWeekly(g.id)
      }
      setData(next)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  const current = useMemo(() => data[gradeId] ?? [], [data, gradeId])

  function cellOf(list: PeriodAssignment[], day: string, label: string) {
    return list.find((a) => a.day === day && a.periodLabel === label)
  }

  function setCell(day: string, label: string, patch: Partial<PeriodAssignment>) {
    setData((prev) => {
      const existing = prev[gradeId] ?? []
      let found = false
      const list = existing.map((a) => {
        if (a.day === day && a.periodLabel === label) { found = true; return { ...a, ...patch } }
        return a
      })
      if (!found) {
        list.push({ classId: gradeId, bellTimetableId: EDU_BELL_TIMETABLE_ID, day, periodLabel: label, subjectName: "", ...patch })
      }
      return { ...prev, [gradeId]: list }
    })
  }

  async function persistAll(next: GradeData) {
    let okAll = true
    for (const g of EDU_GRADES) {
      const res = await saveClassTimetableDB(g.id, next[g.id] ?? [])
      if (res.error && res.error !== "supabase-not-configured") okAll = false
    }
    return okAll
  }

  async function handleSave() {
    const res = await saveClassTimetableDB(gradeId, current)
    if (res.error && res.error !== "supabase-not-configured") toast.error("Cloud save failed.")
    else toast.success("Saved for everyone")
    setEditing(false)
  }

  async function handleGenerateAll(shuffle = false) {
    // Honour the admin's subject+grade assignments when present; otherwise the
    // solver falls back to canTeach-based eligibility (every grade). With
    // `shuffle`, a random seed yields a different — still clash-free and
    // rule-respecting — layout each click.
    const saved = await fetchEduAssignments()
    const eligible = saved && saved.length > 0 ? eligibilityFromAssignments(saved) : undefined
    const seed = shuffle ? (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0 : undefined
    const schedule = buildEduSchedule(eligible, seed)
    if (!schedule.ok) {
      toast.error(schedule.conflicts[0] ?? "Generator hit a conflict — not saved.")
      return
    }
    setData(schedule.byGrade)
    const ok = await persistAll(schedule.byGrade)
    toast[ok ? "success" : "error"](
      ok
        ? shuffle ? "Shuffled — new clash-free layout saved" : "Generated all grades — clash-free and saved"
        : "Generated, but cloud save failed",
    )
  }

  // Teacher view: all of a teacher's assignments across grades.
  const teacherAssignments = useMemo(() => {
    const out: PeriodAssignment[] = []
    for (const g of EDU_GRADES) {
      for (const a of data[g.id] ?? []) {
        if (a.subjectName && a.teacherId === teacherId) out.push(a)
      }
    }
    return out
  }, [data, teacherId])

  const counts = useMemo(() => countSubjects(current), [current])

  // Global conflict check across all grades, with suggested fixes per conflict.
  const conflictFixes = useMemo<ConflictFix[]>(() => {
    return findConflicts(data).map((c) => ({
      day: c.day, periodLabel: c.label, teacherId: c.teacherId, teacherName: c.teacherName,
      gradeA: c.gradeA, gradeB: c.gradeB, subjectName: c.subjectName,
      free: freeTeachersFor(data, c.subjectName, c.teacherId, c.day, c.label),
      swaps: findSwapTargets(data, c),
    }))
  }, [data])

  // Apply a suggested fix: reassign the duplicate cell to a free teacher + save.
  async function applyFix(gid: string, day: string, label: string, t: EduTeacher) {
    const list = (data[gid] ?? []).map((a) =>
      a.day === day && a.periodLabel === label ? { ...a, teacherId: t.id, teacherName: t.name } : a,
    )
    setData((prev) => ({ ...prev, [gid]: list }))
    const res = await saveClassTimetableDB(gid, list)
    if (res.error && res.error !== "supabase-not-configured") toast.error("Cloud save failed.")
    else toast.success(`Assigned ${firstName(t.name)} — conflict resolved`)
  }

  // Apply a suggested fix: swap the lesson into a clash-free period + save.
  async function applySwap(gid: string, from: SlotRef, to: SlotRef) {
    const list = swapCells(data[gid] ?? [], from, to)
    setData((prev) => ({ ...prev, [gid]: list }))
    const res = await saveClassTimetableDB(gid, list)
    if (res.error && res.error !== "supabase-not-configured") toast.error("Cloud save failed.")
    else toast.success(`Moved to ${SHORT_DAY[to.day]} ${to.label.replace("Period ", "P")} — conflict resolved`)
  }

  // Resolve every conflict it can in one click, then save the grades it changed.
  async function applyAllFixes() {
    const { data: next, changed, remaining } = autoResolveConflicts(data)
    if (changed.size === 0) { toast.error("No conflict could be auto-resolved — try moving a lesson manually."); return }
    setData(next)
    let okAll = true
    for (const gid of Array.from(changed)) {
      const res = await saveClassTimetableDB(gid, next[gid] ?? [])
      if (res.error && res.error !== "supabase-not-configured") okAll = false
    }
    if (!okAll) toast.error("Fixed, but cloud save failed.")
    else if (remaining === 0) toast.success("All conflicts resolved")
    else toast.success(`Resolved conflicts — ${remaining} still need manual attention`)
  }

  // Workload across all grades.
  const workload = useMemo(() => {
    const map = new Map<string, { total: number; bySubject: Record<string, number> }>()
    for (const t of EDU_TEACHERS) map.set(t.id, { total: 0, bySubject: {} })
    for (const g of EDU_GRADES) {
      for (const a of data[g.id] ?? []) {
        if (!a.teacherId || !a.subjectName) continue
        const row = map.get(a.teacherId)
        if (!row) continue
        row.total += 1
        row.bySubject[a.subjectName] = (row.bySubject[a.subjectName] ?? 0) + 1
      }
    }
    return EDU_TEACHERS.map((t) => ({ ...t, ...map.get(t.id)! }))
  }, [data])

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-3xl font-bold text-navy-900 dark:text-white">
            <CalendarRange className="size-7 text-gold-500 shrink-0" />
            <span className="truncate">EDU Support Timetable</span>
          </h1>
          <p className="mt-1 truncate text-navy-600 dark:text-navy-300">
            Grades 1–5 · Mon–Thu 5 periods · Fri 3 periods · 23/week{loading ? " · loading…" : ""}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {isAdmin && mode === "class" && !editing && (
            <button onClick={() => setEditing(true)} className={btnGhost}>
              <Pencil className="size-4" /> Edit
            </button>
          )}
          {isAdmin && mode === "class" && editing && (
            <>
              <button onClick={handleSave} className={btnPrimary}><Save className="size-4" /> Save</button>
              <button onClick={() => setEditing(false)} className={btnGhost}><X className="size-4" /> Done</button>
            </>
          )}
          <button
            onClick={() => mode === "class" ? printClass(grade.id, current) : printTeacher(teacherName(teacherId), teacherAssignments)}
            className={btnGhost}
          >
            <Printer className="size-4" /> Print
          </button>
          <ExportMenu
            pdfLabel={mode === "class" ? "PDF — all grades" : "PDF — all teachers"}
            csvLabel={mode === "class" ? "CSV — all grades" : "CSV — all teachers"}
            onPdf={() => mode === "class" ? exportAllClassesPdf(data) : exportAllTeachersPdf(data)}
            onCsv={() => mode === "class" ? exportAllClassesCsv(data) : exportAllTeachersCsv(data)}
          />
        </div>
      </motion.div>

      {/* Mode toggle + global generate */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => { setMode("class"); setEditing(false) }} className={cn(tab, mode === "class" ? tabActive : tabIdle)}>
          <LayoutGrid className="size-4" /> Class view
        </button>
        <button onClick={() => { setMode("teacher"); setEditing(false) }} className={cn(tab, mode === "teacher" ? tabActive : tabIdle)}>
          <UserCheck className="size-4" /> Teacher view
        </button>
        {isAdmin && (
          <>
            <Link
              href="/dashboard/edu-timetable/assign"
              className={cn(tab, tabIdle, "ml-auto")}
            >
              <SlidersHorizontal className="size-4" /> Assign subjects
            </Link>
            <button onClick={() => handleGenerateAll(false)} className={cn(tab, tabActive, "bg-violet-600")}>
              <Wand2 className="size-4" /> Generate all (clash-free)
            </button>
            <button onClick={() => handleGenerateAll(true)} className={cn(tab, tabActive, "bg-violet-500")}>
              <Shuffle className="size-4" /> Shuffle
            </button>
          </>
        )}
      </div>

      {/* Selector */}
      <div className="flex flex-wrap gap-2">
        {mode === "class"
          ? EDU_GRADES.map((g) => (
              <button key={g.id} onClick={() => { setGradeId(g.id); setEditing(false) }} className={cn(pill, g.id === gradeId ? pillActive : pillIdle)}>
                {g.name}
              </button>
            ))
          : EDU_TEACHERS.map((t) => (
              <button key={t.id} onClick={() => setTeacherId(t.id)} className={cn(pill, t.id === teacherId ? pillActive : pillIdle)}>
                {t.name}
              </button>
            ))}
      </div>

      {/* Grid */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarRange className="size-5 text-gold-500" />
            {mode === "class" ? `${grade.name} (${grade.short})` : `${teacherName(teacherId)} — weekly`}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-border/60 bg-navy-700 px-2 py-2 text-white"></th>
                {COLUMNS.map((c, i) => c.kind === "recess" ? (
                  <th key={i} className="border border-border/60 bg-navy-600 px-2 py-2 text-center text-white">
                    RECESS<div className="text-[10px] font-normal opacity-80">{EDU_RECESS.start}–{EDU_RECESS.end}</div>
                  </th>
                ) : (
                  <th key={i} className="border border-border/60 bg-navy-700 px-2 py-2 text-center text-white">
                    {c.label}<div className="text-[10px] font-normal opacity-80">{c.start}–{c.end}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day) => (
                <tr key={day}>
                  <td className="border border-border/60 bg-navy-50 px-3 py-2 font-semibold text-navy-800 dark:bg-navy-800 dark:text-navy-100">{SHORT_DAY[day]}</td>
                  {COLUMNS.map((c, i) => {
                    if (c.kind === "recess") return <td key={i} className="border border-border/40 bg-navy-50/60 dark:bg-navy-900/40" />
                    if (!slotExists(day, c.label)) {
                      return <td key={i} className="border border-border/40 bg-navy-100/50 text-center text-[10px] text-navy-300 dark:bg-navy-900/60">—</td>
                    }
                    if (mode === "class") {
                      const a = cellOf(current, day, c.label)
                      return (
                        <td key={i} className="border border-border/50 p-1 text-center align-middle">
                          {editing ? (
                            <div className="space-y-1">
                              <select value={a?.subjectName ?? ""} onChange={(e) => {
                                const name = e.target.value
                                const keepTeacher = a?.teacherId && eduTeacherById(a.teacherId)?.canTeach.includes(name)
                                setCell(day, c.label, {
                                  subjectName: name, subjectId: name ? subjectId(name) : undefined,
                                  teacherId: keepTeacher ? a?.teacherId : undefined,
                                  teacherName: keepTeacher ? a?.teacherName : undefined,
                                })
                              }} className="w-full rounded bg-white px-1 py-0.5 text-xs dark:bg-navy-900">
                                <option value="">—</option>
                                {EDU_SUBJECTS.map((s) => <option key={s.id} value={s.name}>{s.code}</option>)}
                              </select>
                              <select value={a?.teacherId ?? ""} onChange={(e) => {
                                const t = eduTeacherById(e.target.value)
                                setCell(day, c.label, { teacherId: t?.id, teacherName: t?.name })
                              }} className="w-full rounded bg-white px-1 py-0.5 text-[10px] dark:bg-navy-900">
                                <option value="">teacher…</option>
                                {EDU_TEACHERS.filter((t) => !a?.subjectName || t.canTeach.includes(a.subjectName)).map((t) => (
                                  <option key={t.id} value={t.id}>{firstName(t.name)}</option>
                                ))}
                              </select>
                            </div>
                          ) : a?.subjectName ? (
                            <div className="rounded bg-gold-50 px-1 py-2 dark:bg-gold-500/10">
                              <div className="font-semibold text-navy-800 dark:text-navy-100">{subjectCode(a.subjectName)}</div>
                              <div className="text-[10px] text-navy-400">{firstName(a.teacherName)}</div>
                            </div>
                          ) : <span className="text-navy-300">—</span>}
                        </td>
                      )
                    }
                    const here = teacherAssignments.filter((a) => a.day === day && a.periodLabel === c.label)
                    return (
                      <td key={i} className="border border-border/50 p-1 text-center align-middle">
                        {here.length ? (
                          <div className="rounded bg-violet-50 px-1 py-2 dark:bg-violet-500/10">
                            <div className="font-semibold text-navy-800 dark:text-navy-100">{subjectCode(here[0].subjectName)}</div>
                            <div className="text-[10px] text-navy-400">{here.map((a) => eduGradeById(a.classId)?.short ?? a.classId).join("/")}</div>
                          </div>
                        ) : <span className="text-navy-300">—</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Subject counts (class view) */}
      {mode === "class" && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-lg">Periods per subject — {grade.name}</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {EDU_SUBJECTS.map((s) => {
                const target = SUBJECTS_PER_WEEK[s.name] ?? 0
                const have = counts[s.name] ?? 0
                const ok = have === target
                return (
                  <span key={s.id} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                    ok ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                       : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300")}>
                    {s.name}: {have}/{target}
                  </span>
                )
              })}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-navy-50/60 px-3 py-1 text-xs font-medium text-navy-600 dark:bg-navy-800/60 dark:text-navy-300">
                Total: {Object.values(counts).reduce((a, b) => a + b, 0)}/{TOTAL_SLOTS}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Conflict report + suggested fixes */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              {conflictFixes.length === 0 ? <ShieldCheck className="size-5 text-emerald-500" /> : <AlertTriangle className="size-5 text-red-500" />}
              Conflict check
            </CardTitle>
            {isAdmin && conflictFixes.length > 0 && (
              <button onClick={applyAllFixes} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-700">
                <Wand2 className="size-4" /> Auto-fix all ({conflictFixes.length})
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {conflictFixes.length === 0 ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">No teacher is double-booked across any grade. ✓</p>
          ) : (
            <div className="space-y-3">
              {conflictFixes.map((c, i) => (
                <div key={i} className="rounded-lg border border-red-200 bg-red-50/60 p-3 dark:border-red-500/30 dark:bg-red-500/10">
                  <div className="flex items-start gap-1.5 text-sm font-medium text-red-700 dark:text-red-300">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {firstName(c.teacherName)} is double-booked in {eduGradeById(c.gradeA)?.short} &amp; {eduGradeById(c.gradeB)?.short} — {subjectCode(c.subjectName)} on {SHORT_DAY[c.day]} {c.periodLabel}.
                    </span>
                  </div>
                  <div className="mt-2 space-y-1.5 pl-6 text-xs">
                    {c.free.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-navy-600 dark:text-navy-300">
                          Reassign {eduGradeById(c.gradeB)?.short} to a free {subjectCode(c.subjectName)} teacher:
                        </span>
                        {c.free.map((t) => (
                          isAdmin ? (
                            <button
                              key={t.id}
                              onClick={() => applyFix(c.gradeB, c.day, c.periodLabel, t)}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                            >
                              <Wand2 className="size-3" /> {firstName(t.name)}
                            </button>
                          ) : (
                            <span key={t.id} className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 font-medium text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
                              {firstName(t.name)}
                            </span>
                          )
                        ))}
                      </div>
                    )}
                    {c.swaps.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-navy-600 dark:text-navy-300">
                          {c.free.length > 0 ? "Or move" : "Move"} {eduGradeById(c.gradeB)?.short}&apos;s lesson to a free period:
                        </span>
                        {c.swaps.slice(0, 4).map((s) => {
                          const label = `${SHORT_DAY[s.day]} ${s.label.replace("Period ", "P")}`
                          return isAdmin ? (
                            <button
                              key={`${s.day}-${s.label}`}
                              onClick={() => applySwap(c.gradeB, { day: c.day, label: c.periodLabel }, s)}
                              className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2 py-1 font-medium text-sky-700 transition-colors hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300"
                            >
                              <Wand2 className="size-3" /> {label}
                            </button>
                          ) : (
                            <span key={`${s.day}-${s.label}`} className="rounded-md border border-sky-300 bg-sky-50 px-2 py-1 font-medium text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300">
                              {label}
                            </span>
                          )
                        })}
                      </div>
                    )}
                    {c.free.length === 0 && c.swaps.length === 0 && (
                      <p className="text-amber-700 dark:text-amber-400">
                        No automatic fix — free up a {subjectCode(c.subjectName)} teacher or change this lesson manually.
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Teacher workload summary */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-lg">Teacher workload (periods/week)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-navy-500">
                <th className="py-1 pr-3">Teacher</th>
                {EDU_SUBJECTS.map((s) => <th key={s.id} className="py-1 pr-3">{s.code}</th>)}
                <th className="py-1 pr-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {workload.map((row) => (
                <tr key={row.id} className="border-t border-border/40">
                  <td className="py-1 pr-3 font-medium text-navy-800 dark:text-navy-100">{row.name}</td>
                  {EDU_SUBJECTS.map((s) => <td key={s.id} className="py-1 pr-3">{row.bySubject[s.name] ?? "—"}</td>)}
                  <td className="py-1 pr-3 font-semibold">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

// ── style helpers ────────────────────────────────────────────────────────────
const btnPrimary = "flex flex-1 items-center justify-center gap-2 rounded-lg bg-navy-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-800 sm:flex-none"
const btnGhost = "flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-200 dark:hover:bg-navy-700 sm:flex-none"
const tab = "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
const tabActive = "bg-navy-700 text-white"
const tabIdle = "border border-border bg-white text-navy-600 hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-300 dark:hover:bg-navy-700"
const pill = "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
const pillActive = "border-gold-400 bg-gold-50 text-navy-900 dark:border-gold-500/60 dark:bg-gold-500/10 dark:text-white"
const pillIdle = "border-border bg-white text-navy-600 hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-300 dark:hover:bg-navy-700"

function teacherName(id: string) { return eduTeacherById(id)?.name ?? id }

// ── Export dropdown ───────────────────────────────────────────────────────────
function ExportMenu({ onPdf, onCsv, pdfLabel = "Download PDF", csvLabel = "Download CSV" }: {
  onPdf: () => void; onCsv: () => void; pdfLabel?: string; csvLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    if (open) document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])
  return (
    <div className="relative flex-1 sm:flex-none" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className={btnPrimary + " w-full"}>
        <Download className="size-4" /> Export <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-white shadow-lg dark:bg-navy-800">
          <button onClick={() => { setOpen(false); onPdf() }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-navy-700 hover:bg-navy-50 dark:text-navy-200 dark:hover:bg-navy-700"><FileText className="size-4" /> {pdfLabel}</button>
          <button onClick={() => { setOpen(false); onCsv() }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-navy-700 hover:bg-navy-50 dark:text-navy-200 dark:hover:bg-navy-700"><Download className="size-4" /> {csvLabel}</button>
        </div>
      )}
    </div>
  )
}

// ── Document helpers ──────────────────────────────────────────────────────────
const HEAD = ["Day", "P1", "P2", "RECESS", "P3", "P4", "P5"]
const LABELS = ["Period 1", "Period 2", null, "Period 3", "Period 4", "Period 5"]

function classRows(list: PeriodAssignment[]): string[][] {
  return DAYS.map((day) => [SHORT_DAY[day], ...LABELS.map((label) => {
    if (label === null) return "—"
    if (!slotExists(day, label)) return ""
    const a = list.find((x) => x.day === day && x.periodLabel === label && x.subjectName)
    return a ? `${subjectCode(a.subjectName)} (${firstName(a.teacherName)})` : "—"
  })])
}
function teacherRows(list: PeriodAssignment[]): string[][] {
  return DAYS.map((day) => [SHORT_DAY[day], ...LABELS.map((label) => {
    if (label === null) return "—"
    if (!slotExists(day, label)) return ""
    const here = list.filter((x) => x.day === day && x.periodLabel === label)
    return here.length ? `${subjectCode(here[0].subjectName)} ${here.map((a) => eduGradeById(a.classId)?.short ?? a.classId).join("/")}` : "—"
  })])
}

// Pull a single teacher's assignments across every grade from the loaded data.
function assignmentsForTeacher(data: GradeData, teacherId: string): PeriodAssignment[] {
  const out: PeriodAssignment[] = []
  for (const g of EDU_GRADES) {
    for (const a of data[g.id] ?? []) {
      if (a.subjectName && a.teacherId === teacherId) out.push(a)
    }
  }
  return out
}

// Column layout for the printed/exported grid: P1, P2, RECESS, P3, P4, P5.
type GridCol =
  | { kind: "period"; display: string; periodLabel: string; start: string; end: string }
  | { kind: "recess"; display: string; start: string; end: string }
const GRID_COLS: GridCol[] = [
  { kind: "period", display: "P1", periodLabel: "Period 1", start: EDU_PERIODS[0].start, end: EDU_PERIODS[0].end },
  { kind: "period", display: "P2", periodLabel: "Period 2", start: EDU_PERIODS[1].start, end: EDU_PERIODS[1].end },
  { kind: "recess", display: "RECESS", start: EDU_RECESS.start, end: EDU_RECESS.end },
  { kind: "period", display: "P3", periodLabel: "Period 3", start: EDU_PERIODS[2].start, end: EDU_PERIODS[2].end },
  { kind: "period", display: "P4", periodLabel: "Period 4", start: EDU_PERIODS[3].start, end: EDU_PERIODS[3].end },
  { kind: "period", display: "P5", periodLabel: "Period 5", start: EDU_PERIODS[4].start, end: EDU_PERIODS[4].end },
]

// A cell's content: subject centered (prominent), and a corner label in the
// bottom-right (the teacher for a class grid, or the class for a teacher grid).
type Cell = { center: string; corner: string } | null
type CellFor = (day: string, periodLabel: string) => Cell

function cellForClass(list: PeriodAssignment[]): CellFor {
  return (day, periodLabel) => {
    const a = list.find((x) => x.day === day && x.periodLabel === periodLabel && x.subjectName)
    return a ? { center: subjectCode(a.subjectName), corner: firstName(a.teacherName) } : null
  }
}
function cellForTeacher(list: PeriodAssignment[]): CellFor {
  return (day, periodLabel) => {
    const here = list.filter((x) => x.day === day && x.periodLabel === periodLabel)
    return here.length
      ? { center: subjectCode(here[0].subjectName), corner: here.map((a) => eduGradeById(a.classId)?.short ?? a.classId).join("/") }
      : null
  }
}

// Draw one professional, aSc-style timetable grid (square cells, centered,
// two-line cell content, a vertical RECESS column) below the branded header.
function drawTimetableGrid(doc: JsPDFDoc, startY: number, cellFor: CellFor) {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 14
  const dayW = 20
  const headerH = 12
  const nrows = DAYS.length
  const ncols = GRID_COLS.length
  // Largest square that fits the width and the height left under the header.
  const side = Math.max(16, Math.min((pageW - 2 * margin - dayW) / ncols, (pageH - startY - 12 - headerH) / nrows))
  const tableW = dayW + ncols * side
  const tableH = headerH + nrows * side
  const x0 = (pageW - tableW) / 2
  const y0 = startY

  // ── Fills ──────────────────────────────────────────────────────────────
  // Header band
  doc.setFillColor(NAVY[0], NAVY[1], NAVY[2])
  doc.rect(x0, y0, tableW, headerH, "F")
  // Day-label column (light) + RECESS column tint, per body row
  for (let r = 0; r < nrows; r++) {
    const ry = y0 + headerH + r * side
    doc.setFillColor(241, 245, 249)
    doc.rect(x0, ry, dayW, side, "F")
    for (let c = 0; c < ncols; c++) {
      const col = GRID_COLS[c]
      const cx = x0 + dayW + c * side
      if (col.kind === "recess") {
        doc.setFillColor(237, 233, 254)
        doc.rect(cx, ry, side, side, "F")
      } else if (!slotExists(DAYS[r], col.periodLabel)) {
        doc.setFillColor(247, 248, 250)
        doc.rect(cx, ry, side, side, "F")
      }
    }
  }

  // ── Header text ────────────────────────────────────────────────────────
  doc.setTextColor(255, 255, 255)
  doc.setFont("helvetica", "bold"); doc.setFontSize(8)
  doc.text("Day", x0 + dayW / 2, y0 + headerH / 2, { align: "center", baseline: "middle" })
  for (let c = 0; c < ncols; c++) {
    const col = GRID_COLS[c]
    const cx = x0 + dayW + c * side + side / 2
    doc.setFont("helvetica", "bold"); doc.setFontSize(9)
    doc.text(col.display, cx, y0 + 5, { align: "center" })
    doc.setFont("helvetica", "normal"); doc.setFontSize(6)
    doc.text(`${col.start}–${col.end}`, cx, y0 + 9.5, { align: "center" })
  }

  // ── Body text ──────────────────────────────────────────────────────────
  for (let r = 0; r < nrows; r++) {
    const day = DAYS[r]
    const ry = y0 + headerH + r * side
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2])
    doc.setFont("helvetica", "bold"); doc.setFontSize(11)
    doc.text(SHORT_DAY[day], x0 + dayW / 2, ry + side / 2, { align: "center", baseline: "middle" })
    for (let c = 0; c < ncols; c++) {
      const col = GRID_COLS[c]
      if (col.kind !== "period" || !slotExists(day, col.periodLabel)) continue
      const cell = cellFor(day, col.periodLabel)
      if (!cell) continue
      const cx = x0 + dayW + c * side
      // Subject — centered and prominent.
      doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]); doc.setFont("helvetica", "bold"); doc.setFontSize(13)
      doc.text(cell.center, cx + side / 2, ry + side / 2, { align: "center", baseline: "middle" })
      // Teacher / class — small, bottom-right corner.
      doc.setTextColor(110, 116, 128); doc.setFont("helvetica", "normal"); doc.setFontSize(7)
      doc.text(cell.corner, cx + side - 2, ry + side - 2, { align: "right", baseline: "alphabetic" })
    }
  }

  // ── Vertical RECESS label ────────────────────────────────────────────────
  const recIdx = GRID_COLS.findIndex((c) => c.kind === "recess")
  if (recIdx >= 0) {
    const cx = x0 + dayW + recIdx * side + side / 2
    const cy = y0 + headerH + (nrows * side) / 2
    doc.setTextColor(124, 111, 176); doc.setFont("helvetica", "bold"); doc.setFontSize(11)
    doc.text("RECESS", cx, cy, { align: "center", baseline: "middle", angle: 90 })
  }

  // ── Grid lines (drawn last, on top) ──────────────────────────────────────
  doc.setDrawColor(170, 178, 190); doc.setLineWidth(0.2)
  doc.rect(x0, y0, tableW, tableH) // outer
  doc.line(x0, y0 + headerH, x0 + tableW, y0 + headerH) // under header
  doc.line(x0 + dayW, y0, x0 + dayW, y0 + tableH) // right of day col
  for (let c = 1; c < ncols; c++) {
    const vx = x0 + dayW + c * side
    doc.line(vx, y0, vx, y0 + tableH)
  }
  for (let r = 1; r < nrows; r++) {
    const hy = y0 + headerH + r * side
    doc.line(x0, hy, x0 + tableW, hy)
  }
  doc.setTextColor(0, 0, 0)
}

// One multi-page PDF: a branded page + square grid per section.
async function exportBulkPdf(sections: { title: string; cellFor: CellFor }[], file: string) {
  const { default: jsPDF } = await import("jspdf")
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  const stamp = `EDU Support · Mon–Fri · Generated ${new Date().toLocaleString("en-AE")}`
  let first = true
  for (const s of sections) {
    if (!first) doc.addPage()
    first = false
    const startY = await addReportHeader(doc, s.title, stamp)
    drawTimetableGrid(doc, startY, s.cellFor)
  }
  doc.save(file)
}

function exportAllClassesPdf(data: GradeData) {
  const sections = EDU_GRADES.map((g) => ({
    title: `Period Timetable — ${g.name} (${g.short})`,
    cellFor: cellForClass(data[g.id] ?? []),
  }))
  return exportBulkPdf(sections, "edu-timetable-all-grades.pdf")
}
function exportAllTeachersPdf(data: GradeData) {
  const sections = EDU_TEACHERS.map((t) => ({
    title: `Teacher Timetable — ${t.name}`,
    cellFor: cellForTeacher(assignmentsForTeacher(data, t.id)),
  }))
  return exportBulkPdf(sections, "edu-timetable-all-teachers.pdf")
}
function downloadCsv(rows: string[][], file: string, titleLines: string[]) {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`
  const out = [...titleLines.map(esc), "", ...rows.map((r) => r.map(esc).join(","))]
  const blob = new Blob([out.join("\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a"); a.href = url; a.download = file; a.click()
  URL.revokeObjectURL(url)
}
function exportAllClassesCsv(data: GradeData) {
  const rows: string[][] = []
  for (const g of EDU_GRADES) {
    rows.push([`${g.name} (${g.short})`])
    rows.push(HEAD)
    rows.push(...classRows(data[g.id] ?? []))
    rows.push([])
  }
  downloadCsv(rows, "edu-timetable-all-grades.csv", [BRAND_NAME, BRAND_SUBLINE, "Period Timetable — All Grades", "EDU Support"])
}
function exportAllTeachersCsv(data: GradeData) {
  const rows: string[][] = []
  for (const t of EDU_TEACHERS) {
    rows.push([t.name])
    rows.push(HEAD)
    rows.push(...teacherRows(assignmentsForTeacher(data, t.id)))
    rows.push([])
  }
  downloadCsv(rows, "edu-timetable-all-teachers.csv", [BRAND_NAME, BRAND_SUBLINE, "Teacher Timetable — All Teachers", "EDU Support"])
}
function htmlEsc(s: string) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] ?? ch))
}
function printGrid(badge: string, heading: string, sub: string, cellFor: CellFor) {
  const head = `<tr><th class="daycol">Day</th>${GRID_COLS.map((c) =>
    `<th>${c.display}<span class="t">${c.start}–${c.end}</span></th>`).join("")}</tr>`
  const body = DAYS.map((day, ri) => {
    const cells = GRID_COLS.map((col) => {
      if (col.kind === "recess") {
        return ri === 0 ? `<td class="rec" rowspan="${DAYS.length}"><span class="r">RECESS</span></td>` : ""
      }
      if (!slotExists(day, col.periodLabel)) return `<td class="none"></td>`
      const c = cellFor(day, col.periodLabel)
      return c
        ? `<td><span class="subj">${htmlEsc(c.center)}</span><span class="who">${htmlEsc(c.corner)}</span></td>`
        : `<td></td>`
    }).join("")
    return `<tr><th class="day">${htmlEsc(SHORT_DAY[day])}</th>${cells}</tr>`
  }).join("")
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${htmlEsc(heading)}</title>
    <style>*{box-sizing:border-box;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;}body{margin:24px;color:#1e293b;}
    header{text-align:center;border-bottom:2px solid #1e3a5f;padding-bottom:14px;margin-bottom:18px;}
    .logo{height:46px;width:auto;object-fit:contain;display:block;margin:0 auto 8px;}
    .school{font-weight:800;font-size:18pt;letter-spacing:-0.02em;white-space:nowrap;}
    .school-sub{font-size:9pt;color:#5c6b82;margin-top:2px;}
    .badge{display:inline-block;background:#1e3a5f;color:#fff;font-size:9pt;font-weight:700;padding:3px 14px;border-radius:3px;text-transform:uppercase;letter-spacing:.06em;margin-top:8px;}
    .meta{text-align:center;font-size:10pt;color:#475569;margin-bottom:14px;}
    table{border-collapse:collapse;table-layout:fixed;margin:0 auto;}
    th,td{border:1px solid #cbd5e1;text-align:center;vertical-align:middle;width:3cm;}
    thead th{background:#1e3a5f;color:#fff;padding:6px 4px;font-size:9.5pt;}
    thead th .t{display:block;font-size:6.5pt;font-weight:400;opacity:.85;}
    thead th.daycol{width:2cm;}
    tbody th.day{width:2cm;background:#f1f5f9;color:#1e293b;font-weight:700;font-size:13pt;}
    tbody td{position:relative;height:3cm;}
    tbody td.none{background:#f7f8fa;}
    .subj{font-size:15pt;font-weight:700;color:#1e3a5f;}
    .who{position:absolute;right:4px;bottom:3px;font-size:8pt;color:#64748b;}
    td.rec{background:#ede9fe;width:2cm;}
    td.rec .r{writing-mode:vertical-rl;transform:rotate(180deg);font-weight:700;color:#7c6fb0;letter-spacing:.12em;font-size:11pt;}
    @page{size:landscape;margin:8mm;}@media print{body{margin:0;}}</style></head><body>
    <header><img src="${BRAND_LOGO_URL}" alt="Ihlamudheen Madrasa" class="logo" onerror="this.style.display='none'"/>
    <div class="school">${BRAND_NAME}</div><div class="school-sub">${BRAND_SUBLINE}</div><span class="badge">${htmlEsc(badge)}</span></header>
    <div class="meta">${htmlEsc(heading)} &middot; ${htmlEsc(sub)}</div>
    <table><thead>${head}</thead><tbody>${body}</tbody></table>
    <script>window.onload=function(){window.print();}</script></body></html>`
  const w = window.open("", "_blank"); if (!w) return
  w.document.write(html); w.document.close()
}
function printClass(gradeId: string, list: PeriodAssignment[]) {
  const g = eduGradeById(gradeId)!
  printGrid("Period Timetable", `${g.name} (${g.short})`, "EDU Support · Mon–Fri", cellForClass(list))
}
function printTeacher(name: string, list: PeriodAssignment[]) {
  printGrid("Teacher Timetable", name, "EDU Support · Mon–Fri", cellForTeacher(list))
}
