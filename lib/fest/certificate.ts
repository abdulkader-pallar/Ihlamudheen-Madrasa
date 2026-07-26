// ╔══════════════════════════════════════════════════════════════════╗
// ║ Ihlamudheen Madrasa Fest — certificate PDF generation (§F)                  ║
// ║                                                                    ║
// ║ Uses the shared Ihlamudheen Madrasa letterhead (branding.ts) per CLAUDE.md,   ║
// ║ then lays out a landscape certificate with the participant's name,  ║
// ║ item, grade/rank, edition theme, a signature line, and a QR of the  ║
// ║ public verification URL (anti-forgery). Multiple certificates are   ║
// ║ emitted as pages of a single PDF.                                  ║
// ╚══════════════════════════════════════════════════════════════════╝

import jsPDF from "jspdf"
import QRCode from "qrcode"
import { addReportHeader } from "@/lib/branding"

export type CertType = "participation" | "winner" | "appreciation"

export interface CertificateData {
  name: string
  item: string
  editionName: string
  theme?: string | null
  type: CertType
  rank?: number | null
  grade?: string | null
  token: string
  verifyUrl: string
}

const RANK_WORD: Record<number, string> = { 1: "First Place", 2: "Second Place", 3: "Third Place" }

function titleFor(d: CertificateData): string {
  if (d.type === "winner") return "Certificate of Achievement"
  if (d.type === "appreciation") return "Certificate of Appreciation"
  return "Certificate of Participation"
}

function citationFor(d: CertificateData): string {
  if (d.type === "winner") {
    const place = d.rank ? (RANK_WORD[d.rank] ?? `Rank ${d.rank}`) : "a winning position"
    return `for securing ${place} in ${d.item}`
  }
  if (d.type === "appreciation") return `in appreciation of valued contribution to ${d.item}`
  return `for participation in ${d.item}`
}

/** Render one certificate onto the current page of the doc. */
async function renderCertificate(doc: jsPDF, d: CertificateData): Promise<void> {
  await addReportHeader(doc, titleFor(d), d.editionName + (d.theme ? ` · ${d.theme}` : ""))
  const pageW = doc.internal.pageSize.getWidth()
  const cx = pageW / 2

  doc.setFontSize(11); doc.setFont("helvetica", "normal"); doc.setTextColor(90)
  doc.text("This is to certify that", cx, 64, { align: "center" })

  doc.setFontSize(26); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 58, 95)
  doc.text(d.name.trim(), cx, 80, { align: "center" })

  doc.setFontSize(13); doc.setFont("helvetica", "normal"); doc.setTextColor(40)
  doc.text(citationFor(d), cx, 94, { align: "center", maxWidth: pageW - 60 })

  if (d.grade && d.grade !== "-") {
    doc.setFontSize(12); doc.setFont("helvetica", "bold")
    doc.text(`Grade ${d.grade}`, cx, 104, { align: "center" })
  }

  // Signature line (left) + QR verification (right).
  const baseY = doc.internal.pageSize.getHeight() - 30
  doc.setDrawColor(120); doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(80)
  doc.line(30, baseY, 90, baseY)
  doc.text("Authorized Signature", 60, baseY + 5, { align: "center" })

  try {
    const qr = await QRCode.toDataURL(d.verifyUrl, { margin: 0, width: 120 })
    doc.addImage(qr, "PNG", pageW - 52, baseY - 22, 22, 22)
    doc.setFontSize(7); doc.setTextColor(110)
    doc.text("Scan to verify", pageW - 41, baseY + 2, { align: "center" })
    doc.text(d.token, pageW - 41, baseY + 5, { align: "center" })
  } catch { /* QR optional */ }
  doc.setTextColor(0)
}

/** Build a single landscape PDF containing every certificate (one per page). */
export async function buildCertificatesPdf(items: CertificateData[]): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  for (let i = 0; i < items.length; i++) {
    if (i > 0) doc.addPage()
    await renderCertificate(doc, items[i])
  }
  return doc
}
