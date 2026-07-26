// Deterministic timetable engine — generates and rearranges period timetables
// WITHOUT any AI/LLM or network. Pure functions, fully unit-tested.
//
// Every operation routes its result through validateProposal (timetable-rules),
// and the teacher-assignment logic only ever picks a teacher who is FREE at that
// slot, so the output is guaranteed clash-free by construction. This replaces the
// (removed) Gemini assistant: free forever, instant, offline, no quota.

import { toMinutes, type TimetableSegment } from "@/data/bell-timetable"
import type { TeacherData } from "@/data/courses"
import {
  bellTimetableById,
  type PeriodAssignment,
} from "@/data/period-timetable"
import { validateProposal, type Conflict } from "@/lib/timetable-rules"

export interface EngineResult {
  proposed: PeriodAssignment[]
  summary: string
  conflicts: Conflict[]
  ok: boolean
}

export interface SubjectOption {
  id?: string
  name: string
}

type Window = { start: number; end: number }

function windowOf(a: { bellTimetableId: string; periodLabel: string }): Window | null {
  const bt = bellTimetableById(a.bellTimetableId)
  const seg = bt?.segments.find((s) => s.label === a.periodLabel)
  if (!seg) return null
  return { start: toMinutes(seg.start), end: toMinutes(seg.end) }
}

function overlaps(a: Window, b: Window): boolean {
  return a.start < b.end && b.start < a.end
}

// Is `teacherId` free during `win` on `day`, given everyone's current bookings?
function isTeacherFree(
  teacherId: string,
  day: string,
  win: Window | null,
  busy: PeriodAssignment[],
): boolean {
  for (const b of busy) {
    if (b.teacherId !== teacherId || b.day !== day) continue
    const wb = windowOf(b)
    if (win && wb) {
      if (overlaps(win, wb)) return false
    } else if (b.periodLabel === undefined) {
      continue
    }
  }
  return true
}

function finalize(
  proposed: PeriodAssignment[],
  otherAssignments: PeriodAssignment[],
  summary: string,
): EngineResult {
  const { ok, conflicts } = validateProposal(otherAssignments, proposed)
  return { proposed, summary, conflicts, ok }
}

export interface GenerateParams {
  classId: string
  day: string
  bellTimetableId: string
  slots: TimetableSegment[] // period slots only
  subjects: SubjectOption[]
  classTeachers: TeacherData[]
  otherAssignments: PeriodAssignment[]
}

/**
 * Build a full clash-free timetable: cycle subjects evenly across the periods,
 * and assign each period a class teacher who is free at that time (round-robin,
 * skipping anyone already booked). A period with no free teacher is left
 * unassigned (a warning, never a clash).
 */
export function autoGenerate(p: GenerateParams): EngineResult {
  const busy = [...p.otherAssignments]
  const proposed: PeriodAssignment[] = []
  let cursor = 0

  p.slots.forEach((seg, i) => {
    const subject = p.subjects.length ? p.subjects[i % p.subjects.length] : { name: "" }
    const win: Window = { start: toMinutes(seg.start), end: toMinutes(seg.end) }

    let chosen: TeacherData | undefined
    for (let k = 0; k < p.classTeachers.length; k++) {
      const t = p.classTeachers[(cursor + k) % p.classTeachers.length]
      if (isTeacherFree(t.id, p.day, win, busy)) {
        chosen = t
        cursor = cursor + k + 1
        break
      }
    }

    const a: PeriodAssignment = {
      classId: p.classId,
      bellTimetableId: p.bellTimetableId,
      day: p.day,
      periodLabel: seg.label,
      subjectId: subject.id,
      subjectName: subject.name,
      teacherId: chosen?.id,
      teacherName: chosen?.name,
    }
    proposed.push(a)
    if (chosen) busy.push(a)
  })

  const placed = proposed.filter((a) => a.teacherId).length
  return finalize(
    proposed,
    p.otherAssignments,
    `Generated ${proposed.length} periods — ${placed} with a teacher, subjects distributed evenly.`,
  )
}

/** Re-spread subjects evenly across the existing periods, keeping teachers. */
export function distributeSubjects(
  current: PeriodAssignment[],
  subjects: SubjectOption[],
  otherAssignments: PeriodAssignment[],
): EngineResult {
  const proposed = current.map((a, i) => {
    const s = subjects.length ? subjects[i % subjects.length] : { name: a.subjectName }
    return { ...a, subjectId: s.id, subjectName: s.name }
  })
  return finalize(proposed, otherAssignments, "Distributed subjects evenly across the periods.")
}

/** Swap the subject/teacher/room content of two periods. */
export function swapPeriods(
  current: PeriodAssignment[],
  labelA: string,
  labelB: string,
  otherAssignments: PeriodAssignment[],
): EngineResult {
  const a = current.find((x) => x.periodLabel === labelA)
  const b = current.find((x) => x.periodLabel === labelB)
  if (!a || !b || labelA === labelB) {
    return finalize(current, otherAssignments, "Nothing to swap.")
  }
  const content = (from: PeriodAssignment) => ({
    subjectId: from.subjectId,
    subjectName: from.subjectName,
    teacherId: from.teacherId,
    teacherName: from.teacherName,
    room: from.room,
  })
  const proposed = current.map((x) => {
    if (x.periodLabel === labelA) return { ...x, ...content(b) }
    if (x.periodLabel === labelB) return { ...x, ...content(a) }
    return x
  })
  return finalize(proposed, otherAssignments, `Swapped ${labelA} and ${labelB}.`)
}

export interface ReassignParams {
  current: PeriodAssignment[]
  leavingTeacherId: string
  classTeachers: TeacherData[]
  otherAssignments: PeriodAssignment[]
}

/**
 * A teacher left (or is unavailable) — reassign every period they hold to a
 * free replacement class teacher. Periods with no free replacement are left
 * unassigned (a warning), never double-booked.
 */
export function reassignTeacher(p: ReassignParams): EngineResult {
  const replacements = p.classTeachers.filter((t) => t.id !== p.leavingTeacherId)
  // Everyone busy EXCEPT the leaving teacher's slots in this class (being freed).
  const busy = [
    ...p.otherAssignments,
    ...p.current.filter((a) => a.teacherId !== p.leavingTeacherId),
  ]

  let moved = 0
  let leavingName = p.leavingTeacherId
  const proposed = p.current.map((a) => {
    if (a.teacherId !== p.leavingTeacherId) return a
    leavingName = a.teacherName || leavingName
    const win = windowOf(a)
    const repl = replacements.find((t) => isTeacherFree(t.id, a.day, win, busy))
    const na: PeriodAssignment = { ...a, teacherId: repl?.id, teacherName: repl?.name }
    if (repl) {
      busy.push(na)
      moved++
    }
    return na
  })

  return finalize(
    proposed,
    p.otherAssignments,
    `Reassigned ${moved} of ${leavingName}'s period(s) to available teachers.`,
  )
}
