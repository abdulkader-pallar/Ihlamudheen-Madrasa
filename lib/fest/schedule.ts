// ╔══════════════════════════════════════════════════════════════════╗
// ║ Meelad Fest — scheduling clash detection (§C)                  ║
// ║                                                                    ║
// ║ Pure, unit-tested. Given the scheduled items (each with a start    ║
// ║ time, duration, stage, and the students/judges attached), it       ║
// ║ reports every conflict to resolve before going live:               ║
// ║   • a student entered in two overlapping items                     ║
// ║   • a judge double-booked across overlapping items                 ║
// ║   • a stage running two items at once                              ║
// ╚══════════════════════════════════════════════════════════════════╝

export interface ScheduledItem {
  id: string
  name: string
  stageId: string | null
  /** Epoch milliseconds, or null when not yet scheduled. */
  startsAt: number | null
  durationMin: number | null
  /** Reg/student ids participating (individual entrants + group members). */
  studentIds: string[]
  /** Judge ids assigned to the item (empty until Phase 4 assigns them). */
  judgeIds?: string[]
}

export type ClashType = "student" | "judge" | "stage"

export interface Clash {
  type: ClashType
  itemAId: string
  itemBId: string
  itemAName: string
  itemBName: string
  /** The shared resource (student id, judge id, or stage id). */
  resourceId: string
}

type Interval = { start: number; end: number }

/** Compute [start,end) for an item, or null if it isn't fully scheduled. */
export function itemInterval(it: ScheduledItem, defaultDurationMin = 30): Interval | null {
  if (it.startsAt == null) return null
  const dur = (it.durationMin ?? defaultDurationMin) * 60_000
  return { start: it.startsAt, end: it.startsAt + Math.max(dur, 60_000) }
}

/** Half-open interval overlap: they share time iff a starts before b ends and vice-versa. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * Detect every scheduling conflict among the given items.
 * Items without a start time are ignored (nothing to clash with yet).
 */
export function detectClashes(items: ScheduledItem[], defaultDurationMin = 30): Clash[] {
  const clashes: Clash[] = []
  const scheduled = items
    .map((it) => ({ it, iv: itemInterval(it, defaultDurationMin) }))
    .filter((x): x is { it: ScheduledItem; iv: Interval } => x.iv !== null)

  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i]
      const b = scheduled[j]
      if (!overlaps(a.iv, b.iv)) continue

      // Shared students.
      const bStudents = new Set(b.it.studentIds)
      for (const s of a.it.studentIds) {
        if (bStudents.has(s)) {
          clashes.push(mk("student", a.it, b.it, s))
        }
      }
      // Shared judges.
      const bJudges = new Set(b.it.judgeIds ?? [])
      for (const j2 of a.it.judgeIds ?? []) {
        if (bJudges.has(j2)) clashes.push(mk("judge", a.it, b.it, j2))
      }
      // Same stage at the same time.
      if (a.it.stageId && b.it.stageId && a.it.stageId === b.it.stageId) {
        clashes.push(mk("stage", a.it, b.it, a.it.stageId))
      }
    }
  }
  return clashes
}

function mk(type: ClashType, a: ScheduledItem, b: ScheduledItem, resourceId: string): Clash {
  return {
    type,
    itemAId: a.id,
    itemBId: b.id,
    itemAName: a.name,
    itemBName: b.name,
    resourceId,
  }
}

/** Convenience tally for the UI badge. */
export function clashSummary(clashes: Clash[]): Record<ClashType, number> {
  return {
    student: clashes.filter((c) => c.type === "student").length,
    judge: clashes.filter((c) => c.type === "judge").length,
    stage: clashes.filter((c) => c.type === "stage").length,
  }
}
