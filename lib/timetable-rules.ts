// Deterministic timetable validator — the single source of truth for what makes
// a period-wise timetable valid. The AI assistant only *proposes* changes; this
// module decides whether a proposal may be applied. A double-booked timetable
// can never pass `validateProposal` (it is a HARD error), so code — not the
// model — guarantees correctness.
//
// Pure: no React, no network. Fully unit-tested in timetable-rules.test.ts.

import { initialTeachers } from "@/data/courses"
import { syllabusForClassId } from "@/data/syllabus"
import { bellTimetableById, type PeriodAssignment } from "@/data/period-timetable"
import { toMinutes } from "@/data/bell-timetable"

export type ConflictSeverity = "error" | "warning"

export type ConflictKind =
  | "double-booking"      // teacher in two classes at overlapping times (HARD)
  | "unqualified-teacher" // teacher not assigned to this class (soft)
  | "empty-slot"          // period with no subject/teacher (soft)
  | "off-syllabus"        // subject not in the grade's syllabus (soft)

export interface Conflict {
  severity: ConflictSeverity
  kind: ConflictKind
  message: string
  classId: string
  periodLabel: string
  teacherId?: string
}

/** Resolve a period assignment to its absolute time window, if known. */
function timeWindow(a: PeriodAssignment): { start: number; end: number } | null {
  const bt = bellTimetableById(a.bellTimetableId)
  const seg = bt?.segments.find((s) => s.label === a.periodLabel)
  if (!seg) return null
  return { start: toMinutes(seg.start), end: toMinutes(seg.end) }
}

/** Two assignments clash when same teacher, same day, overlapping time. */
function overlaps(a: PeriodAssignment, b: PeriodAssignment): boolean {
  if (a.day !== b.day) return false
  const wa = timeWindow(a)
  const wb = timeWindow(b)
  if (!wa || !wb) return a.periodLabel === b.periodLabel // fall back to slot match
  return wa.start < wb.end && wb.start < wa.end
}

/**
 * Find every conflict across a set of assignments (potentially spanning many
 * classes). Double-booking is a HARD error; the rest are warnings the admin may
 * knowingly accept.
 */
export function findConflicts(all: PeriodAssignment[]): Conflict[] {
  const conflicts: Conflict[] = []

  // 1. Double-booking — same teacher overlapping across (any) classes.
  const byTeacher = new Map<string, PeriodAssignment[]>()
  for (const a of all) {
    if (!a.teacherId) continue
    const list = byTeacher.get(a.teacherId) ?? []
    list.push(a)
    byTeacher.set(a.teacherId, list)
  }
  for (const [teacherId, list] of Array.from(byTeacher.entries())) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (overlaps(list[i], list[j])) {
          const name = list[i].teacherName || teacherId
          conflicts.push({
            severity: "error",
            kind: "double-booking",
            classId: list[j].classId,
            periodLabel: list[j].periodLabel,
            teacherId,
            message: `${name} is double-booked: ${list[i].classId} (${list[i].periodLabel}) and ${list[j].classId} (${list[j].periodLabel}) on ${list[j].day}.`,
          })
        }
      }
    }
  }

  // 2-4. Per-assignment soft checks.
  for (const a of all) {
    const hasTeacher = !!(a.teacherId || a.teacherName?.trim())
    const hasSubject = !!a.subjectName?.trim()

    if (!hasTeacher || !hasSubject) {
      conflicts.push({
        severity: "warning",
        kind: "empty-slot",
        classId: a.classId,
        periodLabel: a.periodLabel,
        message: `${a.periodLabel} for ${a.classId} is incomplete${!hasSubject ? " (no subject)" : ""}${!hasTeacher ? " (no teacher)" : ""}.`,
      })
    }

    if (a.teacherId) {
      const teacher = initialTeachers.find((t) => t.id === a.teacherId)
      if (teacher && !teacher.classIds.includes(a.classId)) {
        conflicts.push({
          severity: "warning",
          kind: "unqualified-teacher",
          classId: a.classId,
          periodLabel: a.periodLabel,
          teacherId: a.teacherId,
          message: `${teacher.name} is not normally assigned to ${a.classId}.`,
        })
      }
    }

    if (hasSubject) {
      const syllabus = syllabusForClassId(a.classId)
      if (syllabus) {
        const known = syllabus.subjects.some(
          (s) => s.id === a.subjectId || s.enName.toLowerCase() === a.subjectName.trim().toLowerCase(),
        )
        if (!known) {
          conflicts.push({
            severity: "warning",
            kind: "off-syllabus",
            classId: a.classId,
            periodLabel: a.periodLabel,
            message: `"${a.subjectName}" is not in the ${syllabus.enLabel} syllabus.`,
          })
        }
      }
    }
  }

  return conflicts
}

export interface ProposalCheck {
  ok: boolean
  conflicts: Conflict[]
}

/**
 * Gate an AI (or manual) proposal before it can be applied. `ok` is false when
 * any HARD error (double-booking) exists. The proposed assignments are checked
 * together with the rest of the institute's current assignments so a change in
 * one class can't silently double-book a teacher who also teaches another.
 */
export function validateProposal(
  otherClasses: PeriodAssignment[],
  proposed: PeriodAssignment[],
): ProposalCheck {
  const conflicts = findConflicts([...otherClasses, ...proposed])
  const ok = !conflicts.some((c) => c.severity === "error")
  return { ok, conflicts }
}

/** Convenience: just the hard errors. */
export function hardErrors(conflicts: Conflict[]): Conflict[] {
  return conflicts.filter((c) => c.severity === "error")
}
