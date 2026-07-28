// ╔══════════════════════════════════════════════════════════════════╗
// ║ Meelad Fest — bulk Excel importer (§10)                         ║
// ║                                                                    ║
// ║ The source sheet repeats per section: a header row                 ║
// ║   SL | REG/ID | NAME | <SECTION> | P1 | P2 | P3 | P4 (sometimes P5) ║
// ║ then student rows whose P-cells hold free-typed item names.        ║
// ║                                                                    ║
// ║ This module is format-agnostic: it parses a 2-D matrix of cells    ║
// ║ (so it's unit-testable and reusable for CSV paste). A thin xlsx     ║
// ║ adapter lives in import-fest-xlsx.ts; the apply-to-Supabase step    ║
// ║ lives in import-fest-apply.ts. Output is a created/matched/         ║
// ║ needs-review summary the UI can show before committing.            ║
// ╚══════════════════════════════════════════════════════════════════╝

import { normalizeItemName, type ItemMatch } from "./items"

export type Cell = string | number | null | undefined
export type SheetMatrix = Cell[][]

export interface ParsedStudent {
  sl: number | null
  regNo: string
  name: string
  /** Raw P-cell strings as typed in the sheet. */
  rawItems: string[]
  /** Normalized result per non-blank raw item. */
  items: ItemMatch[]
  /** Source row index (0-based) for error reporting. */
  row: number
}

export interface ParsedSection {
  name: string          // '1A'
  grade: number | null  // 1
  rawLabel: string      // 'CLASS-1A'
  students: ParsedStudent[]
  headerRow: number
}

export interface ImportSummary {
  sections: number
  students: number
  registrations: number      // total non-blank, non-ignored item cells
  matchedExact: number
  matchedFuzzy: number
  ambiguous: number
  unknown: number
  duplicateRegNos: string[]  // reg numbers that appear in more than one row
}

export interface ImportReviewRow {
  section: string
  regNo: string
  studentName: string
  raw: string
  suggestion: string | null
  confidence: ItemMatch["confidence"]
  row: number
}

export interface ParsedWorkbook {
  sections: ParsedSection[]
  summary: ImportSummary
  /** Item cells needing a human decision (ambiguous + unknown). */
  review: ImportReviewRow[]
}

function cellStr(c: Cell): string {
  if (c === null || c === undefined) return ""
  return String(c).trim()
}

/** A header row marks the start of a section block: NAME label + a section cell. */
function detectHeader(row: Cell[]): { rawLabel: string; itemStartCol: number } | null {
  // Find the NAME column (the cell literally reading "name").
  let nameCol = -1
  for (let c = 0; c < row.length; c++) {
    if (cellStr(row[c]).toLowerCase() === "name") {
      nameCol = c
      break
    }
  }
  if (nameCol === -1) return null
  // Section label sits immediately to the right of NAME; items follow it.
  const rawLabel = cellStr(row[nameCol + 1])
  if (!rawLabel) return null
  return { rawLabel, itemStartCol: nameCol + 2 }
}

/** 'CLASS-1A' / '1B' / 'Class 10 A' → { name: '1A', grade: 1 }. */
export function parseSectionLabel(rawLabel: string): { name: string; grade: number | null } {
  const cleaned = rawLabel
    .replace(/class[\s-]*/i, "")
    .replace(/\s+/g, "")
    .toUpperCase()
  const m = cleaned.match(/^(\d{1,2})/)
  return { name: cleaned, grade: m ? parseInt(m[1], 10) : null }
}

/**
 * Parse the whole workbook matrix into sections + a review/summary report.
 * Pure and side-effect free — feeds both the dry-run preview and the apply step.
 */
export function parseFestWorkbook(matrix: SheetMatrix): ParsedWorkbook {
  const sections: ParsedSection[] = []
  let current: ParsedSection | null = null
  let itemStartCol = 4

  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] ?? []
    const header = detectHeader(row)
    if (header) {
      const { name, grade } = parseSectionLabel(header.rawLabel)
      current = { name, grade, rawLabel: header.rawLabel, students: [], headerRow: r }
      itemStartCol = header.itemStartCol
      sections.push(current)
      continue
    }
    if (!current) continue

    // A student row needs a reg number (col B, index 1) and a name (col C, index 2).
    const regNo = cellStr(row[1])
    const name = cellStr(row[2])
    if (!regNo || !name) continue
    if (/^(reg|id|sl\.?)$/i.test(regNo)) continue // stray header fragment

    const slRaw = cellStr(row[0])
    const sl = /^\d+$/.test(slRaw) ? parseInt(slRaw, 10) : null

    const rawItems: string[] = []
    const items: ItemMatch[] = []
    for (let c = itemStartCol; c < row.length; c++) {
      const raw = cellStr(row[c])
      if (!raw) continue
      const match = normalizeItemName(raw)
      if (match.ignored) continue
      rawItems.push(raw)
      items.push(match)
    }

    current.students.push({ sl, regNo, name, rawItems, items, row: r })
  }

  // ── Summary + review ────────────────────────────────────────────────────────
  const review: ImportReviewRow[] = []
  const regSeen = new Map<string, number>()
  let students = 0, registrations = 0
  let matchedExact = 0, matchedFuzzy = 0, ambiguous = 0, unknown = 0

  for (const sec of sections) {
    for (const st of sec.students) {
      students++
      regSeen.set(st.regNo, (regSeen.get(st.regNo) ?? 0) + 1)
      for (const it of st.items) {
        registrations++
        if (it.confidence === "exact") matchedExact++
        else if (it.confidence === "fuzzy") matchedFuzzy++
        else if (it.confidence === "ambiguous") ambiguous++
        else unknown++
        if (it.confidence === "ambiguous" || it.confidence === "unknown") {
          review.push({
            section: sec.name,
            regNo: st.regNo,
            studentName: st.name,
            raw: it.raw,
            suggestion: it.canonical,
            confidence: it.confidence,
            row: st.row,
          })
        }
      }
    }
  }

  const duplicateRegNos = Array.from(regSeen.entries())
    .filter(([, n]) => n > 1)
    .map(([reg]) => reg)

  return {
    sections,
    summary: {
      sections: sections.length,
      students,
      registrations,
      matchedExact,
      matchedFuzzy,
      ambiguous,
      unknown,
      duplicateRegNos,
    },
    review,
  }
}
