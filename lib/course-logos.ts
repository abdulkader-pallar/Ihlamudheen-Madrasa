// Per-course brand logos with dedicated light- and dark-mode variants.
// Keyed by the course `id` ("1"–"4") used across the public and dashboard
// course listings. The *-light.png files use dark (navy) artwork meant for
// light backgrounds; the *-dark.png files use light (white) artwork meant for
// dark backgrounds. Render via <CourseLogo /> so the correct variant shows for
// the active theme.

export interface CourseLogoEntry {
  /** Dark-ink artwork for light backgrounds (light mode). */
  light: string
  /** Light-ink artwork for dark backgrounds (dark mode). */
  dark: string
  alt: string
}

export const COURSE_LOGOS: Record<string, CourseLogoEntry> = {
  "1": {
    light: "/COURSES/madrasa-madrasa-light.png",
    dark: "/COURSES/madrasa-madrasa-dark.png",
    alt: "Ihlamudheen Madrasa",
  },
  "2": {
    light: "/COURSES/english-madrasa-light.png",
    dark: "/COURSES/english-madrasa-dark.png",
    alt: "English Madrasa",
  },
  "3": {
    light: "/COURSES/cbis-light.png",
    dark: "/COURSES/cbis-dark.png",
    alt: "CBIS Certification",
  },
  "4": {
    light: "/COURSES/edu-support-light.png",
    dark: "/COURSES/edu-support-dark.png",
    alt: "Edu Support",
  },
}
