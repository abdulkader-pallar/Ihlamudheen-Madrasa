"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import {
  CalendarRange, FileText, Printer, Pencil, Save, X, Wand2,
  AlertTriangle, Check, Download, ChevronDown, Shuffle, UserMinus,
} from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { initialCourses, initialTeachers } from "@/data/courses"
import { syllabusForClassId } from "@/data/syllabus"
import { formatTime, formatDuration, type TimetableSegment } from "@/data/bell-timetable"
import {
  type PeriodAssignment,
  getBellTimetableForClass,
  getClassDay,
  getPeriodSlots,
  buildEmptyTimetable,
  loadClassTimetable,
  saveClassTimetable,
  loadOtherAssignments,
} from "@/data/period-timetable"
import {
  fetchAllTimetables,
  saveClassTimetableDB,
} from "@/lib/db"
import { findConflicts, type Conflict } from "@/lib/timetable-rules"
import {
  autoGenerate,
  distributeSubjects,
  swapPeriods,
  reassignTeacher,
  type EngineResult,
} from "@/lib/timetable-engine"
import { BRAND_NAME, BRAND_SUBLINE, BRAND_LOGO_URL, addReportHeader } from "@/lib/branding"

const NAVY: [number, number, number] = [30, 58, 95]

export default function PeriodTimetablePage() {
  const { user } = useAuth()
  const isAdmin = getUserRole(user) === "admin"

  const coursesWithClasses = useMemo(
    () => initialCourses.filter((c) => c.classes.length > 0),
    [],
  )
  const [courseId, setCourseId] = useState(coursesWithClasses[0]?.id ?? "")
  const course = coursesWithClasses.find((c) => c.id === courseId) ?? coursesWithClasses[0]
  const [classId, setClassId] = useState(course?.classes[0]?.id ?? "")

  const cls = course?.classes.find((c) => c.id === classId)
  const bt = useMemo(() => (classId ? getBellTimetableForClass(classId) : null), [classId])
  const day = classId ? getClassDay(classId) : ""

  const [assignments, setAssignments] = useState<PeriodAssignment[]>([])
  // Other classes' assignments — used for cross-class teacher-clash checks.
  const [otherAssignments, setOtherAssignments] = useState<PeriodAssignment[]>([])
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)

  // Deterministic timetable tools
  const [proposal, setProposal] = useState<EngineResult | null>(null)
  const [swapA, setSwapA] = useState("")
  const [swapB, setSwapB] = useState("")
  const [leavingTeacher, setLeavingTeacher] = useState("")

  // Load the class's timetable from Supabase whenever the class changes, so the
  // schedule is shared across all users/devices. Falls back to the local cache
  // if the table isn't migrated yet or Supabase is unreachable.
  useEffect(() => {
    if (!classId) return
    let cancelled = false
    setEditing(false)
    setProposal(null)
    setLoading(true)
    ;(async () => {
      const all = await fetchAllTimetables()
      if (cancelled) return
      if (all) {
        const mine = all.filter((a) => a.classId === classId)
        setAssignments(mine.length ? mine : buildEmptyTimetable(classId))
        setOtherAssignments(all.filter((a) => a.classId !== classId))
      } else {
        // Supabase unavailable — fall back to the per-browser cache.
        setAssignments(loadClassTimetable(classId))
        setOtherAssignments(loadOtherAssignments(classId))
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [classId])

  // Persist to Supabase (shared) + local cache (offline fallback).
  async function persist(next: PeriodAssignment[]) {
    saveClassTimetable(classId, next)
    const res = await saveClassTimetableDB(classId, next)
    if (res.error && res.error !== "supabase-not-configured") {
      toast.error("Saved on this device, but cloud sync failed.")
    }
  }

  // When the course changes, jump to its first class.
  useEffect(() => {
    if (course && !course.classes.some((c) => c.id === classId)) {
      setClassId(course.classes[0]?.id ?? "")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  const syllabus = classId ? syllabusForClassId(classId) : undefined
  const classTeachers = useMemo(
    () => initialTeachers.filter((t) => t.classIds.includes(classId)),
    [classId],
  )
  const otherTeachers = useMemo(
    () => initialTeachers.filter((t) => !t.classIds.includes(classId)),
    [classId],
  )

  const conflicts = useMemo(() => findConflicts(assignments), [assignments])
  const conflictByPeriod = useMemo(() => {
    const m = new Map<string, Conflict[]>()
    for (const c of conflicts) {
      const list = m.get(c.periodLabel) ?? []
      list.push(c)
      m.set(c.periodLabel, list)
    }
    return m
  }, [conflicts])

  function assignmentFor(label: string): PeriodAssignment | undefined {
    return assignments.find((a) => a.periodLabel === label)
  }

  function patchAssignment(label: string, patch: Partial<PeriodAssignment>) {
    setAssignments((prev) =>
      prev.map((a) => (a.periodLabel === label ? { ...a, ...patch } : a)),
    )
  }

  async function handleSave() {
    await persist(assignments)
    setEditing(false)
    toast.success("Timetable saved for everyone")
  }

  function handleCancel() {
    setAssignments(loadClassTimetable(classId))
    setEditing(false)
  }

  const subjectOptions = useMemo(
    () => (syllabus?.subjects ?? []).map((s) => ({ id: s.id, name: s.enName })),
    [syllabus],
  )

  // Teachers currently appearing in this class's timetable (for "reassign").
  const teachersInUse = useMemo(() => {
    const seen = new Map<string, string>()
    for (const a of assignments) {
      if (a.teacherId) seen.set(a.teacherId, a.teacherName || a.teacherId)
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }, [assignments])

  function handleAutoGenerate() {
    if (!bt) return
    setProposal(
      autoGenerate({
        classId,
        day,
        bellTimetableId: bt.id,
        slots: getPeriodSlots(bt),
        subjects: subjectOptions,
        classTeachers,
        otherAssignments,
      }),
    )
  }

  function handleDistribute() {
    if (!subjectOptions.length) {
      toast.error("This class has no syllabus subjects to distribute.")
      return
    }
    setProposal(distributeSubjects(assignments, subjectOptions, otherAssignments))
  }

  function handleSwap() {
    if (!swapA || !swapB || swapA === swapB) {
      toast.error("Pick two different periods to swap.")
      return
    }
    setProposal(swapPeriods(assignments, swapA, swapB, otherAssignments))
  }

  function handleReassign() {
    if (!leavingTeacher) {
      toast.error("Pick the teacher who is leaving.")
      return
    }
    setProposal(
      reassignTeacher({
        current: assignments,
        leavingTeacherId: leavingTeacher,
        classTeachers,
        otherAssignments,
      }),
    )
  }

  async function applyProposal() {
    if (!proposal) return
    setAssignments(proposal.proposed)
    await persist(proposal.proposed)
    setProposal(null)
    toast.success("Applied — saved for everyone")
  }

  if (!course || !cls || !bt) {
    return <div className="p-6 text-navy-500">No classes available.</div>
  }

  const title = `${course.title} · ${cls.name}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-3xl font-bold text-navy-900 dark:text-white">
            <CalendarRange className="size-7 text-gold-500 shrink-0" />
            <span className="truncate">Period Timetable</span>
          </h1>
          <p className="mt-1 truncate text-navy-600 dark:text-navy-300">
            {title}{day ? ` · ${day}` : ""} · subject &amp; teacher per period.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {isAdmin && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-200 dark:hover:bg-navy-700 sm:flex-none"
            >
              <Pencil className="size-4" /> Edit
            </button>
          )}
          {isAdmin && editing && (
            <>
              <button
                onClick={handleSave}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-navy-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-800 sm:flex-none"
              >
                <Save className="size-4" /> Save
              </button>
              <button
                onClick={handleCancel}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-200 dark:hover:bg-navy-700 sm:flex-none"
              >
                <X className="size-4" /> Cancel
              </button>
            </>
          )}
          <button
            onClick={() => printTimetable(course.title, cls.name, day, bt.segments, assignments)}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-200 dark:hover:bg-navy-700 sm:flex-none"
          >
            <Printer className="size-4" /> Print
          </button>
          <ExportMenu
            onPdf={() => exportPdf(course.title, cls.name, day, bt.segments, assignments)}
            onCsv={() => exportCsv(course.title, cls.name, day, bt.segments, assignments)}
          />
        </div>
      </motion.div>

      {/* Course + Class selectors */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {coursesWithClasses.map((c) => (
            <button
              key={c.id}
              onClick={() => setCourseId(c.id)}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                c.id === courseId
                  ? "border-gold-400 bg-gold-50 text-navy-900 dark:border-gold-500/60 dark:bg-gold-500/10 dark:text-white"
                  : "border-border bg-white text-navy-600 hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-300 dark:hover:bg-navy-700",
              )}
            >
              {c.title}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {course.classes.map((c) => (
            <button
              key={c.id}
              onClick={() => setClassId(c.id)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                c.id === classId
                  ? "border-navy-500 bg-navy-700 text-white dark:border-navy-400"
                  : "border-border bg-white text-navy-600 hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-300 dark:hover:bg-navy-700",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarRange className="size-5 text-gold-500" />
            {cls.name}{day ? ` — ${day}` : ""}
            {loading && (
              <span className="text-xs font-normal text-navy-400">· syncing…</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-navy-700 text-left text-white">
                <th className="rounded-l-lg px-3 py-2 font-semibold">Period</th>
                <th className="px-3 py-2 font-semibold">Time</th>
                <th className="px-3 py-2 font-semibold">Subject</th>
                <th className="px-3 py-2 font-semibold">Teacher</th>
                <th className="rounded-r-lg px-3 py-2 font-semibold">Room</th>
              </tr>
            </thead>
            <tbody>
              {bt.segments.map((seg) => {
                if (seg.kind !== "period") return <SpacerRow key={seg.label} seg={seg} />
                const a = assignmentFor(seg.label)
                const rowConflicts = conflictByPeriod.get(seg.label) ?? []
                const hasError = rowConflicts.some((c) => c.severity === "error")
                const hasWarn = rowConflicts.length > 0
                return (
                  <tr
                    key={seg.label}
                    className={cn(
                      "border-b border-border/60",
                      hasError && "bg-red-50 dark:bg-red-500/10",
                    )}
                  >
                    <td className="px-3 py-2 font-medium text-navy-800 dark:text-navy-100">
                      <span className="flex items-center gap-1.5">
                        {seg.label}
                        {hasWarn && (
                          <span title={rowConflicts.map((c) => c.message).join("\n")}>
                            <AlertTriangle
                              className={cn(
                                "size-3.5",
                                hasError ? "text-red-500" : "text-amber-500",
                              )}
                            />
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-navy-500 dark:text-navy-400">
                      {formatTime(seg.start)} – {formatTime(seg.end)}
                    </td>
                    {editing ? (
                      <>
                        <td className="px-3 py-2">
                          <input
                            list={`subjects-${classId}`}
                            value={a?.subjectName ?? ""}
                            onChange={(e) => {
                              const name = e.target.value
                              const match = syllabus?.subjects.find((s) => s.enName === name)
                              patchAssignment(seg.label, { subjectName: name, subjectId: match?.id })
                            }}
                            placeholder="Subject"
                            className="w-40 rounded-md border border-border bg-white px-2 py-1 text-sm dark:bg-navy-900"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={a?.teacherId ?? ""}
                            onChange={(e) => {
                              const id = e.target.value
                              const t = initialTeachers.find((x) => x.id === id)
                              patchAssignment(seg.label, {
                                teacherId: id || undefined,
                                teacherName: t?.name,
                              })
                            }}
                            className="w-44 rounded-md border border-border bg-white px-2 py-1 text-sm dark:bg-navy-900"
                          >
                            <option value="">— Unassigned —</option>
                            {classTeachers.length > 0 && (
                              <optgroup label="This class">
                                {classTeachers.map((t) => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup label="All staff">
                              {otherTeachers.map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </optgroup>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={a?.room ?? ""}
                            onChange={(e) => patchAssignment(seg.label, { room: e.target.value })}
                            placeholder="Room"
                            className="w-24 rounded-md border border-border bg-white px-2 py-1 text-sm dark:bg-navy-900"
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-navy-700 dark:text-navy-200">
                          {a?.subjectName || <span className="text-navy-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-navy-700 dark:text-navy-200">
                          {a?.teacherName || <span className="text-navy-300">—</span>}
                        </td>
                        <td className="px-3 py-2 text-navy-500 dark:text-navy-400">
                          {a?.room || <span className="text-navy-300">—</span>}
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* datalist for subject suggestions */}
          <datalist id={`subjects-${classId}`}>
            {(syllabus?.subjects ?? []).map((s) => (
              <option key={s.id} value={s.enName} />
            ))}
          </datalist>

          {conflicts.length > 0 && (
            <div className="mt-3 space-y-1 text-xs">
              {conflicts.map((c, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-start gap-1.5",
                    c.severity === "error"
                      ? "text-red-600 dark:text-red-400"
                      : "text-amber-600 dark:text-amber-400",
                  )}
                >
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  <span>{c.message}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timetable tools (admin only) — deterministic, no AI/network */}
      {isAdmin && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wand2 className="size-5 text-violet-500" />
              Timetable Tools
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-navy-500 dark:text-navy-400">
              Build or rearrange this class&apos;s timetable. Every action is
              checked so a teacher is never double-booked — review the preview,
              then Apply.
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleAutoGenerate}
                className="flex items-center gap-2 rounded-lg bg-navy-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-800"
              >
                <Wand2 className="size-4" /> Auto-generate clash-free
              </button>
              <button
                onClick={handleDistribute}
                className="flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-200 dark:hover:bg-navy-700"
              >
                <Shuffle className="size-4" /> Distribute subjects evenly
              </button>
            </div>

            {/* Swap two periods */}
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs text-navy-500 dark:text-navy-400">Swap period</label>
                <select
                  value={swapA}
                  onChange={(e) => setSwapA(e.target.value)}
                  className="mt-1 rounded-md border border-border bg-white px-2 py-1.5 text-sm dark:bg-navy-900"
                >
                  <option value="">—</option>
                  {getPeriodSlots(bt).map((s) => (
                    <option key={s.label} value={s.label}>{s.label}</option>
                  ))}
                </select>
              </div>
              <span className="pb-2 text-navy-400">with</span>
              <div>
                <select
                  value={swapB}
                  onChange={(e) => setSwapB(e.target.value)}
                  className="mt-1 rounded-md border border-border bg-white px-2 py-1.5 text-sm dark:bg-navy-900"
                >
                  <option value="">—</option>
                  {getPeriodSlots(bt).map((s) => (
                    <option key={s.label} value={s.label}>{s.label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleSwap}
                className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-200 dark:hover:bg-navy-700"
              >
                <Shuffle className="size-4" /> Swap
              </button>
            </div>

            {/* Reassign a leaving teacher */}
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs text-navy-500 dark:text-navy-400">Teacher leaving / unavailable</label>
                <select
                  value={leavingTeacher}
                  onChange={(e) => setLeavingTeacher(e.target.value)}
                  className="mt-1 rounded-md border border-border bg-white px-2 py-1.5 text-sm dark:bg-navy-900"
                >
                  <option value="">— pick a teacher —</option>
                  {teachersInUse.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleReassign}
                className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-200 dark:hover:bg-navy-700"
              >
                <UserMinus className="size-4" /> Reassign their periods
              </button>
            </div>

            {proposal && (
              <ProposalPreview
                proposal={proposal}
                segments={bt.segments}
                onApply={applyProposal}
                onDiscard={() => setProposal(null)}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SpacerRow({ seg }: { seg: TimetableSegment }) {
  return (
    <tr className="border-b border-border/40 bg-navy-50/50 text-navy-400 dark:bg-navy-900/40 dark:text-navy-500">
      <td className="px-3 py-1.5 italic">{seg.label}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-xs">
        {formatTime(seg.start)} – {formatTime(seg.end)}
      </td>
      <td className="px-3 py-1.5 text-xs" colSpan={3}>
        {formatDuration(seg.durationMin)}
      </td>
    </tr>
  )
}

function ProposalPreview({
  proposal, segments, onApply, onDiscard,
}: {
  proposal: { proposed: PeriodAssignment[]; summary: string; conflicts: Conflict[]; ok: boolean }
  segments: TimetableSegment[]
  onApply: () => void
  onDiscard: () => void
}) {
  const errors = proposal.conflicts.filter((c) => c.severity === "error")
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-500/30 dark:bg-violet-500/5">
      <p className="mb-2 text-sm font-medium text-navy-800 dark:text-navy-100">{proposal.summary}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-xs">
          <thead>
            <tr className="text-left text-navy-500">
              <th className="py-1 pr-3">Period</th>
              <th className="py-1 pr-3">Subject</th>
              <th className="py-1 pr-3">Teacher</th>
            </tr>
          </thead>
          <tbody>
            {segments.filter((s) => s.kind === "period").map((s) => {
              const a = proposal.proposed.find((p) => p.periodLabel === s.label)
              return (
                <tr key={s.label} className="border-t border-border/40">
                  <td className="py-1 pr-3 font-medium">{s.label}</td>
                  <td className="py-1 pr-3">{a?.subjectName || "—"}</td>
                  <td className="py-1 pr-3">{a?.teacherName || "—"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {proposal.conflicts.length > 0 && (
        <div className="mt-2 space-y-1 text-xs">
          {proposal.conflicts.map((c, i) => (
            <div
              key={i}
              className={cn(
                "flex items-start gap-1.5",
                c.severity === "error" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400",
              )}
            >
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>{c.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={onApply}
          disabled={!proposal.ok}
          title={proposal.ok ? "" : "Resolve the double-booking before applying"}
          className="flex items-center gap-2 rounded-lg bg-navy-700 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check className="size-4" /> Apply
        </button>
        <button
          onClick={onDiscard}
          className="flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-1.5 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-200 dark:hover:bg-navy-700"
        >
          <X className="size-4" /> Discard
        </button>
        {!proposal.ok && (
          <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
            <AlertTriangle className="size-3" /> {errors.length} blocking conflict(s)
          </span>
        )}
      </div>
    </div>
  )
}

// ── Export dropdown ───────────────────────────────────────────────────────
function ExportMenu({ onPdf, onCsv }: { onPdf: () => void; onCsv: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])
  return (
    <div className="relative flex-1 sm:flex-none" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-800"
      >
        <Download className="size-4" /> Export <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-white shadow-lg dark:bg-navy-800">
          <button
            onClick={() => { setOpen(false); onPdf() }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-navy-700 hover:bg-navy-50 dark:text-navy-200 dark:hover:bg-navy-700"
          >
            <FileText className="size-4" /> Download PDF
          </button>
          <button
            onClick={() => { setOpen(false); onCsv() }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-navy-700 hover:bg-navy-50 dark:text-navy-200 dark:hover:bg-navy-700"
          >
            <Download className="size-4" /> Download CSV
          </button>
        </div>
      )}
    </div>
  )
}

// ── Document helpers ──────────────────────────────────────────────────────
function rowsForDoc(segments: TimetableSegment[], assignments: PeriodAssignment[]) {
  return segments.map((seg) => {
    if (seg.kind !== "period") {
      return {
        kind: seg.kind,
        period: seg.label,
        time: `${formatTime(seg.start)} – ${formatTime(seg.end)}`,
        subject: "—",
        teacher: "—",
        room: "—",
      }
    }
    const a = assignments.find((x) => x.periodLabel === seg.label)
    return {
      kind: seg.kind,
      period: seg.label,
      time: `${formatTime(seg.start)} – ${formatTime(seg.end)}`,
      subject: a?.subjectName || "—",
      teacher: a?.teacherName || "—",
      room: a?.room || "—",
    }
  })
}

async function exportPdf(
  courseTitle: string, className: string, day: string,
  segments: TimetableSegment[], assignments: PeriodAssignment[],
) {
  const { default: jsPDF } = await import("jspdf")
  const { default: autoTable } = await import("jspdf-autotable")
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const startY = await addReportHeader(
    doc,
    `Period Timetable — ${className}`,
    `${courseTitle}${day ? ` · ${day}` : ""} · Generated ${new Date().toLocaleString("en-IN")}`,
  )
  const rows = rowsForDoc(segments, assignments)
  autoTable(doc, {
    startY,
    head: [["Period", "Time", "Subject", "Teacher", "Room"]],
    body: rows.map((r) => [r.period, r.time, r.subject, r.teacher, r.room]),
    styles: { fontSize: 10, cellPadding: 3 },
    headStyles: { fillColor: NAVY, halign: "left", valign: "middle" },
    theme: "striped",
    didParseCell: (data) => {
      if (data.section !== "body") return
      const r = rows[data.row.index]
      if (r?.kind === "break") data.cell.styles.fillColor = [254, 243, 199]
      else if (r?.kind === "prayer") data.cell.styles.fillColor = [237, 233, 254]
    },
  })
  doc.save(`period-timetable-${className.replace(/\s+/g, "-").toLowerCase()}.pdf`)
}

function exportCsv(
  courseTitle: string, className: string, day: string,
  segments: TimetableSegment[], assignments: PeriodAssignment[],
) {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`
  const lines: string[] = []
  lines.push(esc(BRAND_NAME))
  lines.push(esc(BRAND_SUBLINE))
  lines.push(esc(`Period Timetable — ${className}`))
  lines.push(esc(`${courseTitle}${day ? ` · ${day}` : ""}`))
  lines.push("")
  lines.push(["Period", "Time", "Subject", "Teacher", "Room"].map(esc).join(","))
  for (const r of rowsForDoc(segments, assignments)) {
    lines.push([r.period, r.time, r.subject, r.teacher, r.room].map(esc).join(","))
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `period-timetable-${className.replace(/\s+/g, "-").toLowerCase()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function printTimetable(
  courseTitle: string, className: string, day: string,
  segments: TimetableSegment[], assignments: PeriodAssignment[],
) {
  const rows = rowsForDoc(segments, assignments)
    .map((r) => {
      const cls = r.kind === "break" ? ' class="brk"' : r.kind === "prayer" ? ' class="pray"' : ""
      return `<tr${cls}><td>${r.period}</td><td>${r.time}</td><td>${r.subject}</td><td>${r.teacher}</td><td>${r.room}</td></tr>`
    })
    .join("")

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
    <title>Period Timetable — ${className}</title>
    <style>
      *{box-sizing:border-box;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;}
      body{margin:32px;color:#1e293b;}
      header{text-align:center;border-bottom:2px solid #1e3a5f;padding-bottom:14px;margin-bottom:18px;}
      .logo{height:46px;width:auto;object-fit:contain;display:block;margin:0 auto 8px;}
      .school{font-weight:800;font-size:18pt;letter-spacing:-0.02em;white-space:nowrap;}
      .school-sub{font-size:9pt;color:#5c6b82;margin-top:2px;}
      .badge{display:inline-block;background:#1e3a5f;color:#fff;font-size:9pt;font-weight:700;
             padding:3px 14px;border-radius:3px;text-transform:uppercase;letter-spacing:.06em;margin-top:8px;}
      .meta{text-align:center;font-size:10pt;color:#475569;margin-bottom:16px;}
      table{width:100%;border-collapse:collapse;font-size:11pt;}
      th{background:#1e3a5f;color:#fff;text-align:left;padding:8px 10px;}
      td{padding:8px 10px;border-bottom:1px solid #e2e8f0;}
      tr.brk td{background:#fef3c7;}
      tr.pray td{background:#ede9fe;}
      @media print{body{margin:12mm;} button{display:none;}}
    </style></head><body>
    <header>
      <img src="${BRAND_LOGO_URL}" alt="Ihlamudheen Madrasa" class="logo" onerror="this.style.display='none'"/>
      <div class="school">${BRAND_NAME}</div>
      <div class="school-sub">${BRAND_SUBLINE}</div>
      <span class="badge">Period Timetable</span>
    </header>
    <div class="meta">${courseTitle} &middot; ${className}${day ? ` &middot; ${day}` : ""}</div>
    <table>
      <thead><tr><th>Period</th><th>Time</th><th>Subject</th><th>Teacher</th><th>Room</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <script>window.onload=function(){window.print();}</script>
    </body></html>`

  const w = window.open("", "_blank")
  if (!w) return
  w.document.write(html)
  w.document.close()
}
