// ╔══════════════════════════════════════════════════════════════════╗
// ║ Meelad Fest — Annual Ihlamudheen Madrasa Book (one-click yearbook PDF, §L) ║
// ║                                                                    ║
// ║ Renders a complete edition into a printable/shareable PDF on the    ║
// ║ Ihlamudheen Madrasa letterhead: cover/theme, summary, house standings, event  ║
// ║ winners, and participant lists by section. Takes already-gathered   ║
// ║ data so it stays pure and testable-ish (jsPDF aside).              ║
// ╚══════════════════════════════════════════════════════════════════╝

import jsPDF from "jspdf"
import { addReportHeader, BRAND_NAME } from "@/lib/branding"

export interface YearbookData {
  editionName: string
  theme?: string | null
  summary: { students: number; items: number; registrations: number }
  houses: Array<{ name: string; points: number }>
  results: Array<{ item: string; winners: Array<{ rank: number; name: string; grade: string | null }> }>
  sections: Array<{ name: string; students: Array<{ reg: string; name: string }> }>
}

const NAVY: [number, number, number] = [30, 58, 95]

export async function buildYearbookPdf(data: YearbookData): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const { default: autoTable } = await import("jspdf-autotable")
  const pageW = doc.internal.pageSize.getWidth()
  const cx = pageW / 2

  // ── Cover ───────────────────────────────────────────────────────────────────
  await addReportHeader(doc, "Annual Ihlamudheen Madrasa Book", data.editionName)
  doc.setFontSize(30); doc.setFont("helvetica", "bold"); doc.setTextColor(...NAVY)
  doc.text(data.editionName, cx, 90, { align: "center" })
  if (data.theme) {
    doc.setFontSize(14); doc.setFont("helvetica", "italic"); doc.setTextColor(90)
    doc.text(`"${data.theme}"`, cx, 102, { align: "center" })
  }
  doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.setTextColor(60)
  doc.text(
    `${data.summary.students} participants · ${data.summary.items} events · ${data.summary.registrations} registrations`,
    cx, 120, { align: "center" },
  )
  doc.setTextColor(0)

  // ── House standings ──────────────────────────────────────────────────────────
  doc.addPage()
  let y = await addReportHeader(doc, "House Standings", data.editionName)
  autoTable(doc, {
    startY: y,
    head: [["Rank", "House", "Points"]],
    body: data.houses.map((h, i) => [String(i + 1), h.name, String(h.points)]),
    headStyles: { fillColor: NAVY },
    styles: { fontSize: 10 },
  })

  // ── Event winners ────────────────────────────────────────────────────────────
  doc.addPage()
  y = await addReportHeader(doc, "Event Winners", data.editionName)
  const rows: string[][] = []
  for (const r of data.results) {
    for (const w of r.winners) {
      rows.push([r.item, ["", "1st", "2nd", "3rd"][w.rank] ?? String(w.rank), w.name.trim(), w.grade ?? ""])
    }
  }
  autoTable(doc, {
    startY: y,
    head: [["Item", "Place", "Winner", "Grade"]],
    body: rows.length ? rows : [["—", "—", "No published winners", "—"]],
    headStyles: { fillColor: NAVY },
    styles: { fontSize: 9 },
  })

  // ── Participants by section ─────────────────────────────────────────────────
  for (const sec of data.sections) {
    doc.addPage()
    y = await addReportHeader(doc, `Participants — ${sec.name}`, data.editionName)
    autoTable(doc, {
      startY: y,
      head: [["Reg", "Name"]],
      body: sec.students.map((s) => [s.reg, s.name.trim()]),
      headStyles: { fillColor: NAVY },
      styles: { fontSize: 9 },
    })
  }

  // Footer brand on every page.
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(7); doc.setTextColor(150)
    doc.text(`${BRAND_NAME} · ${data.editionName}`, cx, doc.internal.pageSize.getHeight() - 6, { align: "center" })
  }
  doc.setTextColor(0)
  return doc
}
