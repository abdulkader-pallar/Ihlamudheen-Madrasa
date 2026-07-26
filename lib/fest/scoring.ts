// ╔══════════════════════════════════════════════════════════════════╗
// ║ Ihlamudheen Madrasa Fest — scoring math (§3 defaults, per-edition configurable) ║
// ║                                                                    ║
// ║ Pure + unit-tested. The judging UI uses these to show a live grade  ║
// ║ as marks are entered; the DB function fest_recompute_results()      ║
// ║ mirrors the same rules so client preview and final results agree.   ║
// ╚══════════════════════════════════════════════════════════════════╝

export type Grade = "A" | "B" | "C" | "-"
export type AggregationMethod = "average" | "sum" | "drop_high_low"

export interface GradeThresholds { A: number; B: number; C: number }
export interface PointConfig {
  individual: { A: number; B: number; C: number }
  group_multiplier: number
}

export interface RubricCriterion {
  key: string
  label: string
  /** Max marks for this criterion; the rubric's maxes are meant to sum to 100. */
  max: number
}

export const DEFAULT_THRESHOLDS: GradeThresholds = { A: 80, B: 60, C: 40 }
export const DEFAULT_POINTS: PointConfig = {
  individual: { A: 5, B: 3, C: 1 },
  group_multiplier: 2,
}

/** Sum the per-criterion marks (clamped to each criterion's max) → 0..100. */
export function criteriaTotal(marks: Record<string, number>, rubric: RubricCriterion[]): number {
  if (rubric.length === 0) {
    // No rubric: a single free 0..100 mark stored under "mark".
    return clamp(marks.mark ?? 0, 0, 100)
  }
  let total = 0
  for (const c of rubric) total += clamp(marks[c.key] ?? 0, 0, c.max)
  return total
}

export function gradeForMark(mark: number, t: GradeThresholds = DEFAULT_THRESHOLDS): Grade {
  if (mark >= t.A) return "A"
  if (mark >= t.B) return "B"
  if (mark >= t.C) return "C"
  return "-"
}

/** Aggregate one entry's marks across judges. */
export function aggregateMarks(totals: number[], method: AggregationMethod = "average"): number {
  if (totals.length === 0) return 0
  if (method === "sum") return totals.reduce((a, b) => a + b, 0)
  if (method === "drop_high_low" && totals.length > 2) {
    const sum = totals.reduce((a, b) => a + b, 0)
    return (sum - Math.max(...totals) - Math.min(...totals)) / (totals.length - 2)
  }
  return totals.reduce((a, b) => a + b, 0) / totals.length
}

export function pointsForGrade(
  grade: Grade,
  type: "individual" | "group",
  points: PointConfig = DEFAULT_POINTS,
): number {
  const base = grade === "A" ? points.individual.A
    : grade === "B" ? points.individual.B
    : grade === "C" ? points.individual.C
    : 0
  return type === "group" ? base * points.group_multiplier : base
}

/**
 * Competition ranking (1,1,3,…): equal marks share a rank, the next rank skips.
 * Returns a map of entryId → rank, highest mark = rank 1.
 */
export function computeRanks(entries: Array<{ id: string; mark: number }>): Map<string, number> {
  const sorted = [...entries].sort((a, b) => b.mark - a.mark)
  const ranks = new Map<string, number>()
  let lastMark = Number.NaN
  let lastRank = 0
  sorted.forEach((e, idx) => {
    const rank = e.mark === lastMark ? lastRank : idx + 1
    ranks.set(e.id, rank)
    lastMark = e.mark
    lastRank = rank
  })
  return ranks
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
