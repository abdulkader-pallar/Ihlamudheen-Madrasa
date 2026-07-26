// Pure helpers for the fee-payments ledger.
//
// The ledger model: every row in `fee_payments` is an immutable money entry.
//   entry_type='payment'    → amount > 0 (cash received)
//   entry_type='adjustment' → amount can be negative (reversal) or positive
//                             (additional charge); requires reason + reverses_id
//
// A student's pending balance for a given as-of month is computed as:
//   sum(monthly_fee for every billable month from BILLING_START to as-of month)
//   minus
//   sum(ledger.amount for that student where month <= as-of month)
//
// Pure / no side effects → trivially testable.

// First month the school started billing through this app. Anything before
// this date is treated as "not yet billable" — pending balance is 0.
export const BILLING_START_MONTH = "2026-05"

// "YYYY-MM" helpers — string math so we never hit timezone edge cases.
export function compareMonth(a: string, b: string): number {
  return a.localeCompare(b)
}

export function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number)
  if (!y || !m) return yyyymm
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" })
}

export function shortMonthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number)
  if (!y || !m) return yyyymm
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" })
}

/** Inclusive list of "YYYY-MM" between two months (sorted ascending). */
export function monthsBetween(startInclusive: string, endInclusive: string): string[] {
  if (compareMonth(startInclusive, endInclusive) > 0) return []
  const out: string[] = []
  const [sy, sm] = startInclusive.split("-").map(Number)
  const [ey, em] = endInclusive.split("-").map(Number)
  let y = sy, m = sm
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

// ─── Per-program fee resolution (mirrors the existing /fees page tiers) ─────
export function getMonthlyFee(className: string, courseId: string): number {
  if (courseId === "3") return 0 // CIBIS — fee set individually, no auto-pending
  if (courseId === "4") {
    const l = className.toLowerCase()
    // Use a negative lookahead for a digit so "Grade 1B", "Grade 1 & 2", and "G1" all match.
    if (/grade\s+[12](?!\d)/.test(l) || /\bg[12](?!\d)/.test(l)) return 300
    if (/grade\s+[34](?!\d)/.test(l) || /\bg[34](?!\d)/.test(l)) return 350
    if (/grade\s+[56](?!\d)/.test(l) || /\bg[56](?!\d)/.test(l)) return 400
    return 350
  }
  if (courseId === "2") return 150
  return 125
}

// ─── Ledger types ───────────────────────────────────────────────────────────
export interface LedgerEntry {
  id: number
  student_id: string
  month: string                   // YYYY-MM
  amount: number                  // payment > 0; adjustment can be negative
  entry_type: "payment" | "adjustment"
  reverses_id: number | null
  reason: string | null
  notes: string | null
  paid_at: string | null
  recorded_by: string | null
  created_at: string
}

export interface MonthBreakdown {
  month: string
  due: number                     // expected fee for that month
  received: number                // sum of ledger.amount for that student+month
  pending: number                 // max(0, due - received) — clamps overpayments
}

export interface PendingSummary {
  totalPending: number            // sum of breakdown[i].pending
  totalCredit: number             // amount overpaid (if any) — informational
  breakdown: MonthBreakdown[]     // only months with pending > 0
  fullyPaidMonths: string[]       // months with received >= due
}

/**
 * Computes per-student pending balance as of `asOfMonth`.
 *
 * @param monthlyFee  fee owed every billable month for this student (0 = skip)
 * @param asOfMonth   inclusive end month
 * @param ledger      ALL ledger entries for this student, any month
 */
export function computePending(
  monthlyFee: number,
  asOfMonth: string,
  ledger: LedgerEntry[],
): PendingSummary {
  if (monthlyFee <= 0) {
    return { totalPending: 0, totalCredit: 0, breakdown: [], fullyPaidMonths: [] }
  }

  const dueMonths = monthsBetween(BILLING_START_MONTH, asOfMonth)
  const receivedByMonth = new Map<string, number>()
  for (const e of ledger) {
    if (compareMonth(e.month, asOfMonth) > 0) continue
    receivedByMonth.set(e.month, (receivedByMonth.get(e.month) ?? 0) + e.amount)
  }

  const breakdown: MonthBreakdown[] = []
  const fullyPaidMonths: string[] = []
  let totalPending = 0
  let totalCredit = 0

  for (const m of dueMonths) {
    const received = receivedByMonth.get(m) ?? 0
    const pending = Math.max(0, monthlyFee - received)
    if (pending > 0) {
      breakdown.push({ month: m, due: monthlyFee, received, pending })
      totalPending += pending
    } else {
      fullyPaidMonths.push(m)
      if (received > monthlyFee) totalCredit += received - monthlyFee
    }
  }

  return { totalPending, totalCredit, breakdown, fullyPaidMonths }
}

/**
 * Allocates an incoming payment across pending months, oldest first.
 * Returns one ledger insert per month being credited.
 *
 * Example: pending = [{Mar, 125}, {Apr, 125}, {May, 125}], amount = 200
 *       → [{Mar, 125}, {Apr, 75}]                       (May stays pending)
 *
 * Any surplus that exceeds total pending is attached to `asOfMonth` so the
 * caller can decide whether to accept overpayment (credit balance).
 */
export function allocatePayment(
  amount: number,
  asOfMonth: string,
  breakdown: MonthBreakdown[],
): { month: string; amount: number }[] {
  if (amount <= 0) return []
  const out: { month: string; amount: number }[] = []
  let remaining = amount
  for (const m of breakdown) {
    if (remaining <= 0) break
    const take = Math.min(remaining, m.pending)
    if (take > 0) {
      out.push({ month: m.month, amount: take })
      remaining -= take
    }
  }
  if (remaining > 0) {
    // Overpayment → credit to the as-of month.
    out.push({ month: asOfMonth, amount: remaining })
  }
  return out
}

// ─── Reversal reasons (frozen list) ─────────────────────────────────────────
export const REVERSAL_REASONS = [
  { id: "wrong_amount",     label: "Wrong amount entered"          },
  { id: "wrong_student",    label: "Recorded against wrong student" },
  { id: "duplicate",        label: "Duplicate entry"                },
  { id: "refunded",         label: "Refunded to parent"             },
  { id: "other",            label: "Other (note required)"          },
] as const

export type ReversalReasonId = typeof REVERSAL_REASONS[number]["id"]
