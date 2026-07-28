// Per-course brand logos with dedicated light- and dark-mode variants.
// Keyed by the course `id` used across the public and dashboard course
// listings. The *light* entry is dark-ink artwork meant for light backgrounds;
// the *dark* entry is light-ink artwork meant for dark backgrounds. Render via
// <CourseLogo /> so the correct variant shows for the active theme.

export interface CourseLogoEntry {
  /** Dark-ink artwork for light backgrounds (light mode). */
  light: string
  /** Light-ink artwork for dark backgrounds (dark mode). */
  dark: string
  alt: string
}

const INSTITUTE_LIGHT = "/Logo of Ihlamudheen Madrasa light-bg removed.png"
const INSTITUTE_DARK = "/Logo of Ihlamudheen Madrasa dark-bg removed.png"

export const COURSE_LOGOS: Record<string, CourseLogoEntry> = {
  "1": {
    light: INSTITUTE_LIGHT,
    dark: INSTITUTE_DARK,
    alt: "Ihlamudheen Madrasa",
  },
}

/** Logo for a course id, falling back to the institute mark. */
export function courseLogo(courseId: string): CourseLogoEntry {
  return (
    COURSE_LOGOS[courseId] ?? {
      light: INSTITUTE_LIGHT,
      dark: INSTITUTE_DARK,
      alt: "Ihlamudheen Madrasa",
    }
  )
}
