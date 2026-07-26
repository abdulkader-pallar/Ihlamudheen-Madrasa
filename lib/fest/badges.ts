// ╔══════════════════════════════════════════════════════════════════╗
// ║ Ihlamudheen Madrasa Fest — Digital Ihlamudheen Madrasa Passport badges (§K)           ║
// ║                                                                    ║
// ║ Pure + unit-tested. Derives the badges a student has earned from   ║
// ║ their lifetime history (editions, items, results) so the profile   ║
// ║ and PWA can show them. No DB writes — badges are always computed.   ║
// ╚══════════════════════════════════════════════════════════════════╝

export interface EditionRecord {
  /** Canonical item names the student entered this edition. */
  items: string[]
  /** Finalized results for this edition (one per graded entry). */
  results: Array<{ rank: number | null; grade: string | null }>
}

export interface StudentHistory {
  editions: EditionRecord[]
}

export interface Badge {
  key: string
  label: string
  description: string
}

const CATALOG: Array<Badge & { earned: (h: StudentHistory, s: Stats) => boolean }> = [
  { key: "participant", label: "Participant", description: "Took part in the fest", earned: (_h, s) => s.totalItems > 0 },
  { key: "first_timer", label: "First-Timer", description: "First Ihlamudheen Madrasa Fest", earned: (h) => h.editions.length === 1 },
  { key: "veteran", label: "Veteran", description: "Competed in 3+ editions", earned: (h) => h.editions.length >= 3 },
  { key: "winner", label: "Winner", description: "Placed 1st in an item", earned: (_h, s) => s.firsts >= 1 },
  { key: "podium", label: "Podium", description: "Reached the top 3", earned: (_h, s) => s.podiums >= 1 },
  { key: "hat_trick", label: "Hat-Trick", description: "Won 1st place 3+ times", earned: (_h, s) => s.firsts >= 3 },
  { key: "all_rounder", label: "All-Rounder", description: "4+ items in one edition", earned: (_h, s) => s.maxItemsInEdition >= 4 },
  { key: "top_grade", label: "Grade A", description: "Earned an A grade", earned: (_h, s) => s.gradeAs >= 1 },
]

interface Stats {
  totalItems: number
  firsts: number
  podiums: number
  gradeAs: number
  maxItemsInEdition: number
}

function summarize(h: StudentHistory): Stats {
  let totalItems = 0, firsts = 0, podiums = 0, gradeAs = 0, maxItemsInEdition = 0
  for (const ed of h.editions) {
    totalItems += ed.items.length
    maxItemsInEdition = Math.max(maxItemsInEdition, ed.items.length)
    for (const r of ed.results) {
      if (r.rank === 1) firsts++
      if (r.rank != null && r.rank <= 3) podiums++
      if (r.grade === "A") gradeAs++
    }
  }
  return { totalItems, firsts, podiums, gradeAs, maxItemsInEdition }
}

/** Return the badges this student has earned. */
export function computeBadges(history: StudentHistory): Badge[] {
  const stats = summarize(history)
  return CATALOG
    .filter((b) => b.earned(history, stats))
    .map(({ key, label, description }) => ({ key, label, description }))
}
