// Period-wise timetable — assigns a SUBJECT and a TEACHER to each teaching
// period of a class. This sits on top of the bell-timetable grid (which only
// defines period *times*) in `src/data/bell-timetable.ts`.
//
// Everything in the top half of this file is pure (no React, no network) so it
// can be unit-tested. Persistence helpers at the bottom are browser-only and
// guarded by a `typeof window` check.

import {
  BELL_TIMETABLES,
  MADRASA_SAT_SUN,
  EDU_SUPPORT_MON_THU,
  type BellTimetable,
  type TimetableSegment,
} from "./bell-timetable"
import {
  initialCourses,
  type ClassData,
  type CourseData,
} from "./courses"

// One subject+teacher assignment for a single period slot of a class.
export interface PeriodAssignment {
  classId: string
  bellTimetableId: string
  /** Weekday this class runs, e.g. "Saturday". Display + conflict grouping. */
  day: string
  /** Matches a `kind: "period"` segment label, e.g. "Period 1". */
  periodLabel: string
  subjectId?: string
  subjectName: string
  teacherId?: string
  teacherName?: string
  room?: string
  note?: string
}

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const

/** Locate a class (and its course) by id across the seeded course data. */
export function findClassData(
  classId: string,
): { course: CourseData; cls: ClassData } | undefined {
  for (const course of initialCourses) {
    const cls = course.classes.find((c) => c.id === classId)
    if (cls) return { course, cls }
  }
  return undefined
}

/**
 * The weekday a class meets. Parsed from the class's `schedule` string
 * ("Saturday — 8:55 AM" → "Saturday"); falls back to "" when unknown.
 */
export function getClassDay(classId: string): string {
  const found = findClassData(classId)
  if (!found) return ""
  const schedule = found.cls.schedule ?? ""
  for (const day of WEEKDAYS) {
    if (schedule.toLowerCase().includes(day.toLowerCase())) return day
  }
  return ""
}

/**
 * The bell-timetable grid whose period *times* this class follows. EDU Support
 * classes use the Mon/Thu grid; everything else (Ihlamudheen grades, and — for v1 —
 * English Levels / CIBIS which have no dedicated grid yet) uses the Ihlamudheen grid.
 */
export function getBellTimetableForClass(classId: string): BellTimetable {
  const found = findClassData(classId)
  const title = found?.course.title?.toLowerCase() ?? ""
  if (title.includes("edu support") || title.includes("edu-support")) {
    return EDU_SUPPORT_MON_THU
  }
  return MADRASA_SAT_SUN
}

/** The teaching periods of a bell timetable (excludes break/prayer rows). */
export function getPeriodSlots(bt: BellTimetable): TimetableSegment[] {
  return bt.segments.filter((s) => s.kind === "period")
}

/**
 * Build a blank timetable for a class: one empty `PeriodAssignment` per
 * teaching period of its bell grid. Break/prayer segments are intentionally
 * excluded — they are rendered as non-editable spacer rows by the UI.
 */
export function buildEmptyTimetable(classId: string): PeriodAssignment[] {
  const bt = getBellTimetableForClass(classId)
  const day = getClassDay(classId)
  return getPeriodSlots(bt).map((seg) => ({
    classId,
    bellTimetableId: bt.id,
    day,
    periodLabel: seg.label,
    subjectName: "",
  }))
}

/** Look up a bell timetable by id (used by the conflict validator). */
export function bellTimetableById(id: string): BellTimetable | undefined {
  return BELL_TIMETABLES.find((b) => b.id === id)
}

// ── Persistence (browser-only) ────────────────────────────────────────────
// TODO(supabase): persist via `period_timetables` (see
// supabase/migrations/*_period_timetables.sql) through src/lib/db.ts, mirroring
// saveAttendance/saveGrade. For now timetables live in localStorage so the UI
// and AI assistant are fully usable; this is the only non-DB-backed store.

const STORE_KEY = "period_timetables_v1"

type Store = Record<string, PeriodAssignment[]>

function readStore(): Store {
  if (typeof window === "undefined") return {}
  try {
    return JSON.parse(window.localStorage.getItem(STORE_KEY) || "{}") as Store
  } catch {
    return {}
  }
}

/** Load a class's saved timetable, or a blank one if none has been saved. */
export function loadClassTimetable(classId: string): PeriodAssignment[] {
  const saved = readStore()[classId]
  if (saved && saved.length) return saved
  return buildEmptyTimetable(classId)
}

/** All saved assignments from classes OTHER than `exceptClassId` — used to
 *  check a class's timetable for teacher clashes against the rest. */
export function loadOtherAssignments(exceptClassId: string): PeriodAssignment[] {
  const store = readStore()
  const out: PeriodAssignment[] = []
  for (const [classId, list] of Object.entries(store)) {
    if (classId === exceptClassId) continue
    out.push(...list)
  }
  return out
}

/** Persist a class's timetable. Returns the saved assignments. */
export function saveClassTimetable(
  classId: string,
  assignments: PeriodAssignment[],
): PeriodAssignment[] {
  if (typeof window !== "undefined") {
    try {
      const store = readStore()
      store[classId] = assignments
      window.localStorage.setItem(STORE_KEY, JSON.stringify(store))
    } catch {
      /* storage blocked (private mode) — keep in-memory only */
    }
  }
  return assignments
}
