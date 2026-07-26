// Shared date-formatting helpers. Every date shown to a user in this app —
// tables, PDFs, CSV/Excel exports, labels — must render in day-month-year
// order. Use these instead of ad-hoc toLocaleDateString()/toLocaleString()
// calls or manual YYYY-MM-DD string building.

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value)
}

/** "30/06/2026" */
export function formatDate(value: Date | string | number): string {
  return toDate(value).toLocaleDateString("en-GB")
}

/** "30 June 2026" */
export function formatDateLong(value: Date | string | number): string {
  return toDate(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

/** "30 Jun 2026" */
export function formatDateMedium(value: Date | string | number): string {
  return toDate(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

/** "June 2026" */
export function formatMonthYear(value: Date | string | number): string {
  return toDate(value).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  })
}

/** "30/06/2026, 9:52:02 AM" */
export function formatDateTime(value: Date | string | number): string {
  const d = toDate(value)
  return `${d.toLocaleDateString("en-GB")}, ${d.toLocaleTimeString("en-US")}`
}

/** "2026-06-30" (ISO, e.g. "2026-06-30") -> "30/06/2026" without timezone conversion */
export function formatIsoDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return iso
  const [, y, m, d] = match
  return `${d}/${m}/${y}`
}
