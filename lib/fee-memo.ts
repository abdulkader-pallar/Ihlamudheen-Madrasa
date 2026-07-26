// ╔══════════════════════════════════════════════════════════════════╗
// ║ Fee Memo — printable payment-reminder letter (PDF)               ║
// ║                                                                  ║
// ║ Generates a branded fee-reminder letter the office can share     ║
// ║ with parents. One memo per page, so a whole class/course can be  ║
// ║ produced in a single download. Uses the shared addReportHeader ║
// ║ letterhead (logo + "Ihlamudheen Madrasa") per CLAUDE.md.║
// ╚══════════════════════════════════════════════════════════════════╝

import { monthLabel } from "@/lib/fee-ledger"

export interface FeeMemoStudent {
  name: string
  rollNo: string
  className: string
  programLabel: string
  monthlyFee: number
  totalPending: number
  /** Per-month pending breakdown (raw "YYYY-MM" + pending amount). */
  breakdown: { month: string; pending: number }[]
}

export interface FeeMemoOptions {
  /** Date the parent is asked to settle by — "YYYY-MM-DD". */
  dueDateISO: string
  /** The as-of month the pending balance was computed for (label). */
  asOfMonthLabel: string
  /** Optional office contact line shown to the parent (phone / email). */
  contact?: string
  /** Optional extra note appended to the standard memo body. */
  note?: string
  /** Optional scope label (e.g. class or course name) used in the file name. */
  scopeLabel?: string
}

const BRAND_NAME = "Ihlamudheen Madrasa"
const BRAND_SUBLINE = "Ihlamudheen Madrasa · Malappuram, Kerala"

function fmtAED(n: number): string {
  // Fees are whole AED; round defensively so float drift never shows.
  return `AED ${Math.round(n).toLocaleString("en-US")}`
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "2-digit", month: "long", year: "numeric",
  })
}

function safeFileName(label: string): string {
  return label.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
}

/**
 * Render one student's memo onto the current jsPDF page, starting at `startY`.
 * (The caller is responsible for adding pages and the shared header.)
 */
function renderMemoBody(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  startY: number,
  s: FeeMemoStudent,
  opts: FeeMemoOptions,
) {
  const pageW = doc.internal.pageSize.getWidth()
  const left = 14
  const right = pageW - 14
  const contentW = right - left
  let y = startY + 2

  const line = (gap = 6) => { y += gap }

  // ── "Fee Memo — Payment Reminder" sub-title (centred) ──
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(30, 58, 95)
  doc.text("FEE MEMO — PAYMENT REMINDER", pageW / 2, y, { align: "center" })
  doc.setTextColor(0); line(9)

  // ── Greeting ──
  doc.setFont("helvetica", "normal"); doc.setFontSize(10)
  doc.text(`Greetings from ${BRAND_NAME}.`, left, y); line(8)
  doc.text("Dear Parent / Guardian,", left, y); line(7)

  // ── Student identity block ──
  const idRows: [string, string][] = [
    ["Name of student", s.name],
    ["Register No.", s.rollNo],
    ["Class", s.className],
    ["Programme", s.programLabel],
  ]
  doc.setFontSize(10)
  for (const [label, value] of idRows) {
    doc.setFont("helvetica", "normal"); doc.setTextColor(90)
    doc.text(`${label}:`, left, y)
    doc.setFont("helvetica", "bold"); doc.setTextColor(0)
    doc.text(String(value || "—"), left + 38, y)
    line(6)
  }
  line(2)

  // ── Due amount (highlighted) ──
  doc.setDrawColor(220); doc.setFillColor(248, 250, 252)
  doc.roundedRect(left, y - 4, contentW, 12, 1.5, 1.5, "FD")
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(90)
  doc.text("Total amount due:", left + 3, y + 3.5)
  doc.setFontSize(13); doc.setTextColor(180, 83, 9)
  doc.text(fmtAED(s.totalPending), left + 42, y + 3.5)
  doc.setTextColor(0); doc.setDrawColor(0)
  line(16)

  // ── Body paragraph ──
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(20)
  const body =
    `Most respectfully, it is stated that the amount mentioned above is still pending ` +
    `against the fee of your son / daughter as of ${opts.asOfMonthLabel}. We kindly request ` +
    `you to settle the payment on or before ${fmtDate(opts.dueDateISO)}. Your prompt attention ` +
    `to this matter will be highly appreciated.`
  for (const ln of doc.splitTextToSize(body, contentW) as string[]) {
    doc.text(ln, left, y); line(5)
  }
  line(3)

  // ── Pending breakdown (only when there is more than one month) ──
  if (s.breakdown.length > 1) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(30, 58, 95)
    doc.text("Pending breakdown:", left, y); line(5.5)
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(40)
    for (const b of s.breakdown) {
      doc.text(`•  ${monthLabel(b.month)} — ${fmtAED(b.pending)}`, left + 4, y)
      line(5)
    }
    line(2)
  }

  // ── Kindly note ──
  doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(30, 58, 95)
  doc.text("Kindly note:", left, y); line(5.5)
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(40)
  const notes = [
    "This fee memo is considered the first reminder note.",
    "The institute accepts the fee in monthly installments.",
    "Fees can be paid at the institute office on all working days.",
    "Please ignore this memo if the payment has already been made.",
  ]
  for (const n of notes) {
    const wrapped = doc.splitTextToSize(`•  ${n}`, contentW - 4) as string[]
    for (let i = 0; i < wrapped.length; i++) {
      doc.text(wrapped[i], left + 4 + (i === 0 ? 0 : 4), y); line(5)
    }
  }

  // ── Optional custom note ──
  if (opts.note && opts.note.trim()) {
    line(2)
    doc.setFont("helvetica", "italic"); doc.setFontSize(9.5); doc.setTextColor(60)
    for (const ln of doc.splitTextToSize(opts.note.trim(), contentW) as string[]) {
      doc.text(ln, left, y); line(5)
    }
    doc.setFont("helvetica", "normal")
  }
  line(3)

  // ── Contact ──
  doc.setFontSize(9.5); doc.setTextColor(20)
  const contactLine = opts.contact && opts.contact.trim()
    ? `For any assistance, kindly contact: ${opts.contact.trim()}.`
    : "For any assistance, kindly contact the institute office."
  doc.text(contactLine, left, y); line(8)

  doc.text("Thank you for your continued support.", left, y); line(10)

  // ── Sign-off ──
  doc.setFont("helvetica", "normal"); doc.setTextColor(20)
  doc.text("Sincerely,", left, y); line(5)
  doc.setFont("helvetica", "bold"); doc.text("Office Administration", left, y); line(5)
  doc.setFont("helvetica", "normal"); doc.setTextColor(90); doc.setFontSize(8.5)
  doc.text(`${BRAND_NAME} · ${BRAND_SUBLINE}`, left, y)
  doc.setTextColor(0)
}

/**
 * Build a multi-page fee-memo PDF (one student per page) and trigger download.
 * Returns a small result so callers can surface a toast.
 */
export async function downloadFeeMemos(
  students: FeeMemoStudent[],
  opts: FeeMemoOptions,
): Promise<{ ok: boolean; message?: string }> {
  if (students.length === 0) {
    return { ok: false, message: "No students with a pending balance to memo." }
  }

  const { default: jsPDF } = await import("jspdf")
  const { addReportHeader } = await import("@/lib/branding")

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const generated = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  })

  for (let i = 0; i < students.length; i++) {
    if (i > 0) doc.addPage()
    const subtitle = `Memo generated on ${generated}`
    const startY = await addReportHeader(doc, "Fee Memo", subtitle)
    renderMemoBody(doc, startY, students[i], opts)

    // Page footer
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    doc.setFontSize(7); doc.setTextColor(150)
    doc.text(`Memo ${i + 1} of ${students.length}`, pageW - 14, pageH - 8, { align: "right" })
    doc.text("This is a computer-generated reminder.", 14, pageH - 8)
    doc.setTextColor(0)
  }

  const scope = opts.scopeLabel?.trim()
    ? `-${safeFileName(opts.scopeLabel)}`
    : ""
  const fileName =
    students.length === 1
      ? `fee-memo-${safeFileName(students[0].rollNo || students[0].name)}.pdf`
      : `fee-memos${scope}-${safeFileName(opts.asOfMonthLabel)}.pdf`

  doc.save(fileName)
  return {
    ok: true,
    message:
      students.length === 1
        ? `Fee memo for ${students[0].name} downloaded.`
        : `Downloaded ${students.length} fee memos.`,
  }
}
