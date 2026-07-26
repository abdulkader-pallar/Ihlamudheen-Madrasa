// ╔══════════════════════════════════════════════════════════════════╗
// ║ Ihlamudheen Madrasa Fest — canonical item catalog + variant normalization   ║
// ║                                                                    ║
// ║ The Excel sheet stores free-typed item names in the P1–P4 cells    ║
// ║ ('Speech Eng', 'Song (G)', 'Song Mlm'…). The importer normalizes   ║
// ║ each to a canonical catalog entry, flagging anything it can't      ║
// ║ confidently match for a human review step (§10).                  ║
// ╚══════════════════════════════════════════════════════════════════╝

export type ItemLanguage = "en" | "ml" | "ar" | "na"
export type ItemType = "individual" | "group"

export interface CatalogItem {
  /** Canonical display name, e.g. "Speech – English". */
  name: string
  language: ItemLanguage
  type: ItemType
}

/**
 * The seed catalog (§6B). Canonical names are what we store in `fest_items`;
 * everything in the sheet is normalized onto one of these.
 */
export const FEST_ITEM_CATALOG: CatalogItem[] = [
  { name: "Speech – English",    language: "en", type: "individual" },
  { name: "Speech – Malayalam",  language: "ml", type: "individual" },
  { name: "Quran Recitation",    language: "ar", type: "individual" },
  { name: "Hifz",                language: "ar", type: "individual" },
  { name: "Adhan",               language: "ar", type: "individual" },
  { name: "Song – English",      language: "en", type: "individual" },
  { name: "Song – Malayalam",    language: "ml", type: "individual" },
  { name: "Song – Group",        language: "na", type: "group" },
  { name: "Duff",                language: "na", type: "group" },
  { name: "Story Telling",       language: "na", type: "individual" },
  { name: "Quiz",                language: "na", type: "group" },
  { name: "Essay",               language: "na", type: "individual" },
  { name: "Drawing",             language: "na", type: "individual" },
  { name: "Calligraphy",         language: "ar", type: "individual" },
  { name: "Flower Show",         language: "na", type: "individual" },
  { name: "Scout",               language: "na", type: "group" },
]

const BY_NAME = new Map(FEST_ITEM_CATALOG.map((i) => [i.name.toLowerCase(), i]))

export function catalogItem(canonicalName: string): CatalogItem | undefined {
  return BY_NAME.get(canonicalName.toLowerCase())
}

/**
 * Hand-curated aliases → canonical name. Keys are normalized (lowercase,
 * single-spaced, punctuation stripped) — see `normKey`.
 */
const ALIASES: Record<string, string> = {
  // Speech
  "speech eng": "Speech – English",
  "speech english": "Speech – English",
  "english speech": "Speech – English",
  "speech mlm": "Speech – Malayalam",
  "speech malayalam": "Speech – Malayalam",
  "malayalam speech": "Speech – Malayalam",
  "prasangam": "Speech – Malayalam",
  // Song / Nasheed
  "song eng": "Song – English",
  "song english": "Song – English",
  "nasheed eng": "Song – English",
  "song mlm": "Song – Malayalam",
  "song malayalam": "Song – Malayalam",
  "nasheed": "Song – Malayalam",
  "song g": "Song – Group",
  "song group": "Song – Group",
  "group song": "Song – Group",
  // Story telling
  "story telling": "Story Telling",
  "storytelling": "Story Telling",
  "kadha parachil": "Story Telling",
  // Recitation family
  "quran": "Quran Recitation",
  "quran recitation": "Quran Recitation",
  "qiraath": "Quran Recitation",
  "hifz": "Hifz",
  "adhan": "Adhan",
  "bang": "Adhan",
  // Misc — already canonical-ish
  "duff": "Duff",
  "scout": "Scout",
  "flower show": "Flower Show",
  "quiz": "Quiz",
  "essay": "Essay",
  "drawing": "Drawing",
  "calligraphy": "Calligraphy",
}

/**
 * Bare tokens that are NOT enrolments — column placeholders carried into data
 * cells, or empty markers. Skipped silently by the importer.
 */
const IGNORE = new Set(["", "p1", "p2", "p3", "p4", "p5", "-", "nil", "na", "n/a"])

/**
 * Bare names whose language is genuinely ambiguous in the sheet. We surface a
 * best-guess canonical but mark the match `ambiguous` so a human confirms.
 */
const AMBIGUOUS: Record<string, string> = {
  "speech": "Speech – Malayalam",
  "song": "Song – Malayalam",
}

export type MatchConfidence = "exact" | "fuzzy" | "ambiguous" | "unknown"

export interface ItemMatch {
  raw: string
  /** Canonical catalog name, or null when unknown. */
  canonical: string | null
  confidence: MatchConfidence
  /** True when this raw token is a placeholder/blank to be skipped entirely. */
  ignored: boolean
}

/** Normalize a raw cell to a comparison key: lowercase, strip punctuation, single-space. */
export function normKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[()._\-–—/\\]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Tiny Levenshtein for fuzzy fallbacks (small inputs only). */
function lev(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
  return d[m][n]
}

/**
 * Resolve one raw P-cell to a catalog item.
 * exact     — direct alias / canonical hit
 * ambiguous — known bare term with a best-guess language
 * fuzzy     — close edit-distance to an alias key
 * unknown   — needs manual resolution
 */
export function normalizeItemName(raw: string): ItemMatch {
  const key = normKey(raw)
  if (IGNORE.has(key)) return { raw, canonical: null, confidence: "exact", ignored: true }

  if (ALIASES[key]) return { raw, canonical: ALIASES[key], confidence: "exact", ignored: false }
  if (BY_NAME.has(key)) return { raw, canonical: catalogItem(key)!.name, confidence: "exact", ignored: false }
  // canonical compared on its own normalized key (handles the en-dash form)
  for (const it of FEST_ITEM_CATALOG) {
    if (normKey(it.name) === key) return { raw, canonical: it.name, confidence: "exact", ignored: false }
  }
  if (AMBIGUOUS[key]) return { raw, canonical: AMBIGUOUS[key], confidence: "ambiguous", ignored: false }

  // fuzzy: nearest alias key within a small edit budget
  let best: { name: string; dist: number } | null = null
  for (const [aliasKey, canonical] of Object.entries(ALIASES)) {
    const dist = lev(key, aliasKey)
    if (best === null || dist < best.dist) best = { name: canonical, dist }
  }
  if (best && best.dist <= 2) return { raw, canonical: best.name, confidence: "fuzzy", ignored: false }

  return { raw, canonical: null, confidence: "unknown", ignored: false }
}
