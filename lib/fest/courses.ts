// Course list for the per-course Ihlamudheen Madrasa Fest. Courses are static app data
// (src/data/courses.ts); the fest scopes each edition to a course_id that
// matches a course's id ("1".."4"). Keeping this thin wrapper here means fest
// pages don't each reach into the courses dataset directly.

import { initialCourses } from "@/data/courses"

export interface FestCourse {
  id: string
  title: string
}

export const FEST_COURSES: FestCourse[] = initialCourses.map((c) => ({ id: c.id, title: c.title }))

export function courseTitle(id: string | null | undefined): string {
  if (!id) return "—"
  return FEST_COURSES.find((c) => c.id === id)?.title ?? id
}
