// Auto-derive the EDU Support teacher load plan — the free, offline solver that
// REPLACES the old hand-built `TEACHER_SUBJECT_PLAN`. Given the teachers, the
// grades, each grade's per-subject weekly demand, AND an eligibility predicate
// (which teacher may teach which subject in which grade), it works out how many
// periods of each subject every teacher teaches every grade — balanced,
// eligibility-respecting, and feasible for any staffing (more or fewer teachers
// than grades, part-time / not-fully-booked teachers).
//
// So adding/removing a teacher, changing a subject quota, or letting the admin
// pin a subject+grade to specific teachers needs NO hand-tuned constant and NO
// redeploy of a balanced matrix — the plan is recomputed.
//
// Method (classical operations-research, no AI, no network):
//   A single max-flow distributes the per-(grade,subject) demand across the
//   teachers eligible for that exact cell:
//     source → teacher[cap] → (grade,subject)[if eligible] → sink[demand].
//   Balanced per-teacher capacities are tried first so the load spreads evenly;
//   if the eligibility choices make that infeasible we relax to the per-teacher
//   maximum and re-solve. The flow on each teacher→(grade,subject) edge IS that
//   teacher's weekly period count for that subject in that grade.
//
// This is how "assign subject + grade to a teacher" and "keep automatic load
// balancing" coexist: the admin's choices become the eligibility constraints,
// and the solver auto-balances the actual period counts WITHIN them. Pin a
// (subject, grade) to one teacher and they get it all; allow several and the
// flow splits it evenly.
//
// Pure module — no React, no network. Unit-tested in edu-loadplan.test.ts.

import {
  EDU_TEACHERS, EDU_GRADES, SUBJECTS_PER_WEEK, TOTAL_SLOTS,
  type EduTeacher, type EduGrade,
} from "@/data/edu-support-timetable"

// Subject order is the single source of truth shared with the scheduler.
export const EDU_SCHEDULER_SUBJECTS = ["English", "Maths", "Science", "Arabic"] as const
export type EduSchedulerSubject = (typeof EDU_SCHEDULER_SUBJECTS)[number]

export interface LoadPlanResult {
  ok: boolean
  error?: string
  /** b[teacherIdx][gradeIdx][subjectIdx] = periods/week. */
  breakdown: number[][][]
}

/**
 * Eligibility predicate: may this teacher teach this subject in this grade?
 * The admin's "subject + grade" assignment is expressed as one of these.
 */
export type EligibilityFn = (teacher: EduTeacher, grade: EduGrade, subject: string) => boolean

/** Default eligibility: a teacher may teach any grade for the subjects they can teach. */
export const canTeachEligible: EligibilityFn = (t, _g, subject) => t.canTeach.includes(subject)

/**
 * Build an eligibility predicate from the admin's saved (teacher, grade, subject)
 * assignments. Only the listed cells are eligible — so the matrix the admin ticks
 * on the assignment page IS the constraint the solver balances within.
 */
export function eligibilityFromAssignments(
  assignments: readonly { teacherId: string; gradeId: string; subject: string }[],
): EligibilityFn {
  const set = new Set(assignments.map((a) => `${a.teacherId}|${a.gradeId}|${a.subject}`))
  return (t, g, subject) => set.has(`${t.id}|${g.id}|${subject}`)
}

/** Spread `total` over `n` buckets as evenly as possible (sums back to total). */
function balancedSplit(total: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(total / n)
  const rem = total - base * n
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0))
}

// ── Max-flow (Edmonds–Karp) on a tiny dense graph ────────────────────────────
function maxflow(cap: number[][], src: number, sink: number): number[][] {
  const n = cap.length
  const residual = cap.map((r) => [...r])
  const flow: number[][] = Array.from({ length: n }, () => Array(n).fill(0))

  for (;;) {
    const parent = Array(n).fill(-1)
    parent[src] = src
    const queue = [src]
    while (queue.length) {
      const u = queue.shift()!
      for (let v = 0; v < n; v++) {
        if (parent[v] === -1 && residual[u][v] > 0) {
          parent[v] = u
          queue.push(v)
        }
      }
    }
    if (parent[sink] === -1) break
    let bottleneck = Infinity
    for (let v = sink; v !== src; v = parent[v]) bottleneck = Math.min(bottleneck, residual[parent[v]][v])
    for (let v = sink; v !== src; v = parent[v]) {
      residual[parent[v]][v] -= bottleneck
      residual[v][parent[v]] += bottleneck
      flow[parent[v]][v] += bottleneck
      flow[v][parent[v]] -= bottleneck
    }
  }
  return flow
}

/**
 * Distribute the per-(grade,subject) demand across eligible teachers with a
 * single max-flow. Returns b[t][g][s] or null if these capacities can't satisfy
 * the demand given the eligibility.
 */
// `perGradeCap` bounds how many periods a single teacher may take in one grade.
// A small cap forces each grade's periods to spread across SEVERAL teachers
// (instead of one teacher owning a whole grade), which is what lets the
// scheduler avoid back-to-back repeats and give each day subject variety.
function solveCells(
  teachers: readonly EduTeacher[],
  grades: readonly EduGrade[],
  subjects: readonly string[],
  demandPerGrade: Record<string, number>,
  caps: number[],
  perGradeCap: number,
  eligible: EligibilityFn,
): number[][][] | null {
  const T = teachers.length
  const G = grades.length
  const S = subjects.length
  // nodes: 0 = source, 1..T = teachers, then T*G teacher-grade nodes, then G*S
  // demand cells, then sink. The teacher-grade node carries the perGradeCap.
  const src = 0
  const tgBase = 1 + T
  const cellBase = tgBase + T * G
  const sink = cellBase + G * S
  const n = sink + 1
  const cap: number[][] = Array.from({ length: n }, () => Array(n).fill(0))

  let totalDemand = 0
  for (let t = 0; t < T; t++) cap[src][1 + t] = caps[t]
  for (let t = 0; t < T; t++) {
    for (let g = 0; g < G; g++) cap[1 + t][tgBase + t * G + g] = perGradeCap
  }
  for (let g = 0; g < G; g++) {
    for (let s = 0; s < S; s++) {
      const d = demandPerGrade[subjects[s]] ?? 0
      if (d <= 0) continue
      const cell = cellBase + g * S + s
      cap[cell][sink] = d
      totalDemand += d
      for (let t = 0; t < T; t++) {
        if (eligible(teachers[t], grades[g], subjects[s])) cap[tgBase + t * G + g][cell] = Infinity
      }
    }
  }

  const flow = maxflow(cap, src, sink)
  let routed = 0
  for (let g = 0; g < G; g++) for (let s = 0; s < S; s++) routed += flow[cellBase + g * S + s][sink]
  if (routed < totalDemand) return null

  const b: number[][][] = Array.from({ length: T }, () =>
    Array.from({ length: G }, () => Array(S).fill(0)),
  )
  for (let t = 0; t < T; t++) {
    for (let g = 0; g < G; g++) {
      for (let s = 0; s < S; s++) b[t][g][s] = flow[tgBase + t * G + g][cellBase + g * S + s]
    }
  }
  return b
}

/**
 * Derive the full breakdown b[t][g][s]. Defaults to the live EDU config with
 * canTeach-based eligibility, but accepts overrides so the same solver works for
 * any staffing/quota change AND for the admin's explicit subject+grade pins.
 */
export function deriveBreakdown(
  teachers: readonly EduTeacher[] = EDU_TEACHERS,
  grades: readonly EduGrade[] = EDU_GRADES,
  demandPerGrade: Record<string, number> = SUBJECTS_PER_WEEK,
  maxCapPerTeacher: number = TOTAL_SLOTS,
  eligible: EligibilityFn = canTeachEligible,
): LoadPlanResult {
  const subjects = EDU_SCHEDULER_SUBJECTS
  const T = teachers.length
  const G = grades.length
  const empty = Array.from({ length: T }, () =>
    Array.from({ length: G }, () => Array(subjects.length).fill(0)),
  )

  if (G === 0) return { ok: true, breakdown: empty }

  const gradeTotal = subjects.reduce((a, s) => a + (demandPerGrade[s] ?? 0), 0)
  if (gradeTotal !== TOTAL_SLOTS) {
    return {
      ok: false,
      error: `Each grade must total ${TOTAL_SLOTS} periods/week, but the subject demand sums to ${gradeTotal}.`,
      breakdown: empty,
    }
  }
  if (T < G) {
    return {
      ok: false,
      error: `Need at least ${G} teachers (one per grade in each period); only ${T} provided.`,
      breakdown: empty,
    }
  }

  // Per-(grade,subject) eligibility feasibility — a clear, specific message when
  // the admin's assignments leave a subject in a grade with no eligible teacher.
  for (let g = 0; g < G; g++) {
    for (const s of subjects) {
      const need = demandPerGrade[s] ?? 0
      if (need <= 0) continue
      const cap = teachers.reduce(
        (a, t) => a + (eligible(t, grades[g], s) ? maxCapPerTeacher : 0),
        0,
      )
      if (need > cap) {
        return {
          ok: false,
          error: `No teacher is assigned to teach ${s} for ${grades[g].name} (need ${need} periods/week).`,
          breakdown: empty,
        }
      }
    }
  }

  const totalDemand = gradeTotal * G
  const balanced = balancedSplit(totalDemand, T)
  const maxed = teachers.map(() => maxCapPerTeacher)

  // Spread each grade across as many teachers as possible: start from the
  // smallest per-grade cap that can still let a teacher reach a full load
  // (ceil(TOTAL_SLOTS / G)) and raise it only if eligibility makes that
  // infeasible. The smaller the cap, the more teachers share each grade — which
  // is what enables back-to-back avoidance and per-day subject variety.
  const minGradeCap = Math.max(1, Math.ceil(TOTAL_SLOTS / G))

  // Prefer balanced workloads; within that, prefer the most spread (smallest cap).
  for (const caps of [balanced, maxed]) {
    for (let perGradeCap = minGradeCap; perGradeCap <= TOTAL_SLOTS; perGradeCap++) {
      const b = solveCells(teachers, grades, subjects, demandPerGrade, caps, perGradeCap, eligible)
      if (b) return { ok: true, breakdown: b }
    }
  }

  return {
    ok: false,
    error: "Could not balance the teaching load with the current subject assignments.",
    breakdown: empty,
  }
}
