// EDU Support global scheduler — builds a clash-free weekly timetable for all
// grades at once, with subject-specialist teachers shared across grades.
//
// Guarantee (not heuristic): no teacher is ever double-booked. This is achieved
// by decomposing a teacher×grade "meeting" matrix into matchings, one per slot.
// In every slot each grade is matched to a distinct teacher, so two grades can
// never share a teacher in the same period.
//
// The teacher workload is no longer a hand-built constant — it is derived by a
// free max-flow solver (src/lib/edu-loadplan.ts), so adding/removing a teacher
// or changing a quota re-balances automatically with no code edits. The
// decomposition handles ANY staffing (more/fewer teachers than grades, and
// part-time / not-fully-booked teachers) by padding to a regular bipartite
// multigraph before extracting the per-slot matchings.
//
// Pure module — no React, no network. Unit-tested in edu-scheduler.test.ts.

import type { PeriodAssignment } from "@/data/period-timetable"
import {
  EDU_GRADES, EDU_TEACHERS, EDU_SLOTS, TOTAL_SLOTS, EDU_PERIODS,
  EDU_BELL_TIMETABLE_ID, subjectId, eduTeacherById, eduGradeById, type EduSlot,
} from "@/data/edu-support-timetable"
import { deriveBreakdown, EDU_SCHEDULER_SUBJECTS, type EligibilityFn } from "@/lib/edu-loadplan"

const SUBJECTS = EDU_SCHEDULER_SUBJECTS

export interface WorkloadRow {
  teacherId: string
  teacherName: string
  total: number
  bySubject: Record<string, number>
}
export interface AllocationRow {
  subject: string
  teachers: { name: string; count: number }[]
}
export interface ScheduleResult {
  /** gradeId → that grade's weekly assignments. */
  byGrade: Record<string, PeriodAssignment[]>
  workload: WorkloadRow[]
  allocation: AllocationRow[]
  /** Human-readable conflict-check lines (empty list = none). */
  conflicts: string[]
  ok: boolean
}

// ── Step 2: aggregate the breakdown into a teacher×grade meeting matrix C[t][g] ─
function aggregate(b: number[][][]): number[][] {
  return b.map((row) => row.map((cell) => cell.reduce((a, n) => a + n, 0)))
}

// ── Step 3: decompose into TOTAL_SLOTS matchings (one per slot) ───────────────
// Works for any staffing. The grade side always needs exactly TOTAL_SLOTS
// meetings (one teacher per period), while teachers may carry fewer. We pad the
// teacher×grade matrix with dummy rows/cols and "free-period" filler edges into
// a TOTAL_SLOTS-regular square bipartite multigraph, which always decomposes
// into TOTAL_SLOTS perfect matchings. Real grades carry no filler, so a real
// grade is always matched to a REAL teacher in every slot.
// Returns, per (chronological) slot, gradeIdx → teacherIdx for every grade.
// The matchings are extracted in REAL time order so that, for back-to-back
// periods, each grade's matching prefers a DIFFERENT teacher than the previous
// period had — the soft "avoid the same teacher twice in a row" rule. The
// preference only steers WHICH perfect matching is chosen; a perfect matching
// (hence a clash-free, fully-booked slot) always still exists, so the timetable
// always generates. `slots` must be in chronological order.
function decompose(C: number[][], slots: readonly EduSlot[], rng: Rng | null): number[][] {
  const T = C.length
  const G = T > 0 ? C[0].length : EDU_GRADES.length
  const N = Math.max(T, G)
  const D = TOTAL_SLOTS

  const work: number[][] = Array.from({ length: N }, () => Array(N).fill(0))
  for (let t = 0; t < T; t++) for (let g = 0; g < G; g++) work[t][g] = C[t][g]

  // Pad to D-regular with filler edges between deficient rows and columns.
  const rowDef = Array.from({ length: N }, (_, i) => D - work[i].reduce((a, n) => a + n, 0))
  const colDef = Array.from({ length: N }, (_, j) => {
    let s = 0
    for (let i = 0; i < N; i++) s += work[i][j]
    return D - s
  })
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N && colDef[j] > 0; i++) {
      if (rowDef[i] <= 0) continue
      const add = Math.min(rowDef[i], colDef[j])
      work[i][j] += add
      rowDef[i] -= add
      colDef[j] -= add
    }
  }

  const matchings: number[][] = []
  for (let k = 0; k < D; k++) {
    // The teacher each grade had in the immediately preceding contiguous period.
    const prev = k > 0 && isContiguous(slots[k - 1], slots[k]) ? matchings[k - 1] : null
    const teacherForCol = findPerfectMatching(work, N, G, prev, rng)
    matchings.push(teacherForCol.slice(0, G)) // only the real grades
    for (let j = 0; j < N; j++) work[teacherForCol[j]][j] -= 1
  }
  return matchings
}

// Augmenting-path perfect matching on the N×N support graph (edge if work>0).
// For a D-regular bipartite multigraph a perfect matching always exists. When
// `prev` is given, each real grade column tries every OTHER teacher before the
// one it had last period, so back-to-back repeats are avoided unless the column
// can only be satisfied by repeating (kept feasible — preference, not a hard cut).
function findPerfectMatching(
  work: number[][], N: number, G: number, prev: number[] | null, rng: Rng | null,
): number[] {
  const teacherForCol = Array(N).fill(-1)
  const colForTeacher = Array(N).fill(-1)

  // For each grade column, the order in which to try teachers: those with the
  // MOST remaining periods for that grade first (drains busy teacher-grade pairs
  // across the week so none bunch up at the end), and the teacher this grade had
  // last period LAST (so back-to-back repeats are avoided unless unavoidable).
  // With an rng, ties (equal remaining) are broken randomly so Shuffle yields a
  // different — still clash-free and rule-respecting — layout each time.
  function preferenceFor(col: number): number[] {
    const forb = prev && col < G ? prev[col] : -1
    const order = Array.from({ length: N }, (_, t) => t)
    if (rng) for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    order.sort((a, c) => {
      if (a === forb) return 1
      if (c === forb) return -1
      return work[c][col] - work[a][col]
    })
    return order
  }

  function tryAssign(col: number, seen: boolean[]): boolean {
    for (const t of preferenceFor(col)) {
      if (work[t][col] > 0 && !seen[t]) {
        seen[t] = true
        if (colForTeacher[t] === -1 || tryAssign(colForTeacher[t], seen)) {
          colForTeacher[t] = col
          teacherForCol[col] = t
          return true
        }
      }
    }
    return false
  }

  for (let col = 0; col < N; col++) {
    if (!tryAssign(col, Array(N).fill(false))) {
      throw new Error("EDU scheduler: no clash-free arrangement for this staffing.")
    }
  }
  return teacherForCol
}

function infeasibleResult(error?: string): ScheduleResult {
  const byGrade: Record<string, PeriodAssignment[]> = {}
  for (const g of EDU_GRADES) byGrade[g.id] = []
  return {
    byGrade,
    workload: EDU_TEACHERS.map((t) => ({ teacherId: t.id, teacherName: t.name, total: 0, bySubject: {} })),
    allocation: [],
    conflicts: [error ?? "Timetable is infeasible."],
    ok: false,
  }
}

// Are these two consecutive slots truly back-to-back (no break between them)?
// Recess sits between Period 2 and Period 3, so P2→P3 is NOT back-to-back (the
// recess counts as a "gap"); P1→P2, P3→P4, P4→P5 are. Different days never are.
function isContiguous(prev: EduSlot | undefined, slot: EduSlot): boolean {
  return !!prev && prev.day === slot.day && prev.end === slot.start
}

// Tiny seeded PRNG (mulberry32) so "Shuffle" produces a DIFFERENT clash-free
// timetable each time while staying reproducible for a given seed. Without a
// seed the generator is fully deterministic (same input → same timetable).
type Rng = () => number
function mulberry32(seed: number): Rng {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Step 4: assign matchings to slots and pick a subject per meeting ─────────
export function buildEduSchedule(eligible?: EligibilityFn, seed?: number): ScheduleResult {
  const rng = seed === undefined ? null : mulberry32(seed)
  const plan = deriveBreakdown(undefined, undefined, undefined, undefined, eligible)
  if (!plan.ok) return infeasibleResult(plan.error)
  const b = plan.breakdown
  const C = aggregate(b)

  let matchings: number[][]
  try {
    matchings = decompose(C, EDU_SLOTS, rng)
  } catch (e) {
    return infeasibleResult(e instanceof Error ? e.message : String(e))
  }

  // Mutable remaining subject breakdown per (t,g) to draw from as we fill slots.
  const remaining = b.map((row) => row.map((cell) => [...cell]))
  const byGrade: Record<string, PeriodAssignment[]> = {}
  for (const g of EDU_GRADES) byGrade[g.id] = []

  // `matchings` is already in chronological slot order (and ordered to avoid
  // back-to-back same-teacher repeats). Subjects already placed for a grade on a
  // given day let us avoid repeating a subject within the same day.
  const usedByGradeDay: Array<Record<string, Set<string>>> = EDU_GRADES.map(() => ({}))

  EDU_SLOTS.forEach((slot, i) => {
    const teacherForGrade = matchings[i]
    const periodIdx = EDU_PERIODS.findIndex((p) => p.label === slot.label)
    const early = periodIdx === 0 || periodIdx === 1 // Period 1 / Period 2
    for (let g = 0; g < EDU_GRADES.length; g++) {
      const t = teacherForGrade[g]
      const used = (usedByGradeDay[g][slot.day] ??= new Set<string>())
      // Choose a subject this teacher still owes this grade. Priorities:
      //  1) variety — a subject not yet scheduled for this grade today (top
      //     priority, so a day never needlessly repeats a subject),
      //  2) lean Maths/Science toward the early periods and away from late ones.
      let chosen = -1
      let bestScore = -Infinity
      for (let s = 0; s < SUBJECTS.length; s++) {
        if (remaining[t][g][s] <= 0) continue
        let score = 0
        if (!used.has(SUBJECTS[s])) score += 100
        const core = SUBJECTS[s] === "Maths" || SUBJECTS[s] === "Science"
        if (core) score += early ? 12 : -6
        // Tie-break: random when shuffling (varies the layout), else deterministic.
        score += rng ? rng() * 0.4 : -s * 0.001
        if (score > bestScore) { bestScore = score; chosen = s }
      }
      if (chosen < 0) chosen = 0 // unreachable by construction; keep it valid
      remaining[t][g][chosen] -= 1
      const subject = SUBJECTS[chosen]
      used.add(subject)
      const grade = EDU_GRADES[g]
      const teacher = EDU_TEACHERS[t]
      byGrade[grade.id].push({
        classId: grade.id,
        bellTimetableId: EDU_BELL_TIMETABLE_ID,
        day: slot.day,
        periodLabel: slot.label,
        subjectId: subjectId(subject),
        subjectName: subject,
        teacherId: teacher.id,
        teacherName: teacher.name,
      })
    }
  })

  return {
    byGrade,
    workload: computeWorkload(byGrade),
    allocation: computeAllocation(b),
    ...checkConflicts(byGrade),
  }
}

// ── Reporting helpers ────────────────────────────────────────────────────────
function computeWorkload(byGrade: Record<string, PeriodAssignment[]>): WorkloadRow[] {
  const map = new Map<string, WorkloadRow>()
  for (const t of EDU_TEACHERS) {
    map.set(t.id, { teacherId: t.id, teacherName: t.name, total: 0, bySubject: {} })
  }
  for (const list of Object.values(byGrade)) {
    for (const a of list) {
      if (!a.teacherId) continue
      const row = map.get(a.teacherId)
      if (!row) continue
      row.total += 1
      row.bySubject[a.subjectName] = (row.bySubject[a.subjectName] ?? 0) + 1
    }
  }
  return EDU_TEACHERS.map((t) => map.get(t.id)!)
}

// Allocation is read straight from the derived breakdown (subject → teachers).
function computeAllocation(b: number[][][]): AllocationRow[] {
  return SUBJECTS.map((subject, s) => {
    const teachers = EDU_TEACHERS
      .map((t, ti) => ({
        name: t.name,
        count: EDU_GRADES.reduce((a, _g, g) => a + (b[ti]?.[g]?.[s] ?? 0), 0),
      }))
      .filter((x) => x.count > 0)
      .sort((a, c) => c.count - a.count)
    return { subject, teachers }
  })
}

// Conflict report: confirms no teacher is in two grades in the same slot.
function checkConflicts(byGrade: Record<string, PeriodAssignment[]>): { conflicts: string[]; ok: boolean } {
  const seen = new Map<string, string>() // `${day}|${period}|${teacherId}` → gradeId
  const conflicts: string[] = []
  for (const [gradeId, list] of Object.entries(byGrade)) {
    for (const a of list) {
      if (!a.teacherId) continue
      const key = `${a.day}|${a.periodLabel}|${a.teacherId}`
      const other = seen.get(key)
      if (other && other !== gradeId) {
        const tName = eduTeacherById(a.teacherId)?.name ?? a.teacherId
        conflicts.push(
          `${tName} double-booked: ${eduGradeById(other)?.short} & ${eduGradeById(gradeId)?.short} on ${a.day} ${a.periodLabel}`,
        )
      } else {
        seen.set(key, gradeId)
      }
    }
  }
  return { conflicts, ok: conflicts.length === 0 }
}
