// ╔══════════════════════════════════════════════════════════════════╗
// ║ Institution / class filter — shared between the dashboard widget ║
// ║ and the attendance-report page so both speak the same language. ║
// ║                                                                  ║
// ║ A "filter" is one of:                                            ║
// ║   • "all"               → every class                            ║
// ║   • an INSTITUTIONS key → all classes for that institution       ║
// ║   • a Ihlamudheen day-of-week sub-filter                               ║
// ╚══════════════════════════════════════════════════════════════════╝

import { SATURDAY_CLASSES, SUNDAY_CLASSES, ONLINE_DEFAULT_CLASSES } from "@/data/courses"
import type { CourseData } from "@/data/courses"

// Institution keys are UPPER-CASE course titles (matchesFilter uppercases the
// title before comparing). These are placeholder default programs — rename them
// to your own programs (and keep them in sync with your course titles).
export const INSTITUTIONS = [
  { key: "IHLAMUDHEEN MADRASA", label: "Ihlamudheen Madrasa", dotColor: "bg-emerald-500" },
] as const

// Loosened to `string` so pages can compare against configurable program
// titles without exhaustive literal typing (the taxonomy is user-configurable).
export type InstitutionKey = string

export type WidgetFilter =
  | "all"
  | InstitutionKey
  | "madrasa_saturday"
  | "madrasa_sunday"
  | "madrasa_online"

export const INST_SUB_FILTERS: Array<{ key: WidgetFilter; label: string; ids: readonly string[] }> = [
  { key: "madrasa_saturday", label: "Saturday classes", ids: SATURDAY_CLASSES },
  { key: "madrasa_sunday",   label: "Sunday classes",   ids: SUNDAY_CLASSES },
  { key: "madrasa_online",   label: "Online classes",   ids: ONLINE_DEFAULT_CLASSES },
]

/** Does this (classId, courseTitle) pair match the given filter? */
export function matchesFilter(
  c: { classId: string; courseTitle: string },
  f: WidgetFilter,
): boolean {
  const title = c.courseTitle.toUpperCase().trim()
  if (f === "all") return true
  if (f === "madrasa_saturday") return title === "IHLAMUDHEEN MADRASA" && SATURDAY_CLASSES.includes(c.classId)
  if (f === "madrasa_sunday")   return title === "IHLAMUDHEEN MADRASA" && SUNDAY_CLASSES.includes(c.classId)
  if (f === "madrasa_online")   return title === "IHLAMUDHEEN MADRASA" && ONLINE_DEFAULT_CLASSES.includes(c.classId)
  return title === f
}

/** Human-readable label for a filter — used in titles and export filenames. */
export function institutionLabel(f: WidgetFilter): string {
  if (f === "all")            return "All Institutions"
  if (f === "madrasa_saturday") return "Ihlamudheen — Saturday"
  if (f === "madrasa_sunday")   return "Ihlamudheen — Sunday"
  if (f === "madrasa_online")   return "Ihlamudheen — Online"
  return INSTITUTIONS.find((i) => i.key === f)?.label ?? "Filter"
}

/** Filter a CourseData[] tree to only courses/classes that match. */
export function filterCourses(courses: CourseData[], f: WidgetFilter): CourseData[] {
  if (f === "all") return courses
  return courses
    .map((course) => ({
      ...course,
      classes: course.classes.filter((cls) =>
        matchesFilter({ classId: cls.id, courseTitle: course.title }, f),
      ),
    }))
    .filter((course) => course.classes.length > 0)
}
