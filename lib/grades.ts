// Canonical 11-tier grading scale for Ihlamudheen Madrasa.
// All grade functions across the app must use this module — no local copies.

export interface GradeInfo {
  letter: string
  label: string
  color: string   // Tailwind text class
  bg: string      // Tailwind bg class
}

/** Returns grade info from a percentage (0–100). Pass threshold = 33 %. */
export function getGrade(pct: number): GradeInfo {
  if (pct >= 90) return { letter: "A+", label: "Excellent",   color: "text-emerald-500", bg: "bg-emerald-500/10" }
  if (pct >= 80) return { letter: "A",  label: "Very Good",   color: "text-emerald-500", bg: "bg-emerald-500/10" }
  if (pct >= 75) return { letter: "A-", label: "Good+",       color: "text-emerald-400", bg: "bg-emerald-400/10" }
  if (pct >= 70) return { letter: "B+", label: "Good",        color: "text-blue-500",    bg: "bg-blue-500/10"    }
  if (pct >= 60) return { letter: "B",  label: "Above Avg",   color: "text-blue-400",    bg: "bg-blue-400/10"    }
  if (pct >= 55) return { letter: "B-", label: "Average",     color: "text-sky-500",     bg: "bg-sky-500/10"     }
  if (pct >= 50) return { letter: "C+", label: "Below Avg+",  color: "text-amber-500",   bg: "bg-amber-500/10"   }
  if (pct >= 45) return { letter: "C",  label: "Below Avg",   color: "text-amber-400",   bg: "bg-amber-400/10"   }
  if (pct >= 40) return { letter: "C-", label: "Weak+",       color: "text-orange-500",  bg: "bg-orange-500/10"  }
  if (pct >= 33) return { letter: "D",  label: "Weak",        color: "text-orange-400",  bg: "bg-orange-400/10"  }
  return           { letter: "F",  label: "Fail",        color: "text-red-500",     bg: "bg-red-500/10"     }
}

/** Hex colour for a grade letter — used in jsPDF where Tailwind classes don't apply. */
export function gradeHexColor(letter: string): string {
  if (letter.startsWith("A")) return "#10b981"
  if (letter.startsWith("B")) return "#3b82f6"
  if (letter.startsWith("C")) return "#f5a623"
  if (letter === "D")         return "#f97316"
  return "#e53e3e"
}

/** All 11 tiers, ordered best→worst, for rendering legends. */
export const GRADE_TIERS: GradeInfo[] = [
  { letter: "A+", label: "Excellent",   color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { letter: "A",  label: "Very Good",   color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { letter: "A-", label: "Good+",       color: "text-emerald-400", bg: "bg-emerald-400/10" },
  { letter: "B+", label: "Good",        color: "text-blue-500",    bg: "bg-blue-500/10"    },
  { letter: "B",  label: "Above Avg",   color: "text-blue-400",    bg: "bg-blue-400/10"    },
  { letter: "B-", label: "Average",     color: "text-sky-500",     bg: "bg-sky-500/10"     },
  { letter: "C+", label: "Below Avg+",  color: "text-amber-500",   bg: "bg-amber-500/10"   },
  { letter: "C",  label: "Below Avg",   color: "text-amber-400",   bg: "bg-amber-400/10"   },
  { letter: "C-", label: "Weak+",       color: "text-orange-500",  bg: "bg-orange-500/10"  },
  { letter: "D",  label: "Weak",        color: "text-orange-400",  bg: "bg-orange-400/10"  },
  { letter: "F",  label: "Fail",        color: "text-red-500",     bg: "bg-red-500/10"     },
]
