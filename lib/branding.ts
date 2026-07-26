// Branding constants & helpers used by every report/payslip/export.
// All generated documents show the institute name as the main heading and the
// institute logo in the top-center.

import type jsPDF from "jspdf"

export const BRAND_NAME = "Ihlamudheen Madrasa"
export const BRAND_SUBLINE = "Pallar, Vairamkode, Malappuram, Kerala 676301"
export const BRAND_LOGO_URL = "/logo.png"

// Lazy-cache the data URL so we only fetch the PNG once per session.
let _logoDataUrl: string | null = null
let _logoPromise: Promise<string | null> | null = null

export async function fetchLogoDataUrl(): Promise<string | null> {
  if (_logoDataUrl) return _logoDataUrl
  if (_logoPromise) return _logoPromise

  _logoPromise = (async () => {
    try {
      const res = await fetch(BRAND_LOGO_URL)
      if (!res.ok) return null
      const blob = await res.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = reject
        r.readAsDataURL(blob)
      })
      _logoDataUrl = dataUrl
      return dataUrl
    } catch {
      return null
    }
  })()

  return _logoPromise
}

// ── Arabic-capable font for jsPDF ────────────────────────────────────
// jsPDF's built-in fonts (helvetica/times/courier) only cover WinAnsi —
// Arabic text renders as mojibake unless a Unicode font is embedded.
// Amiri ships full Arabic + Latin coverage, so one embedded font handles
// bilingual tables.
const ARABIC_FONT_NAME = "Amiri"
const ARABIC_FONT_FILES = {
  normal: { url: "/fonts/Amiri-Regular.ttf", vfsName: "Amiri-Regular.ttf" },
  bold: { url: "/fonts/Amiri-Bold.ttf", vfsName: "Amiri-Bold.ttf" },
} as const

let _arabicFontPromise: Promise<{ normal: string; bold: string } | null> | null = null

async function fetchFontBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  } catch {
    return null
  }
}

/**
 * Embed the Amiri font into a jsPDF document so Arabic text (and Latin,
 * which Amiri also covers) renders correctly instead of as mojibake.
 * Returns the font family name to pass to `doc.setFont(...)` / autoTable's
 * `font` style — falls back to "helvetica" if the font could not be loaded.
 */
export async function loadArabicFont(doc: jsPDF): Promise<string> {
  if (!_arabicFontPromise) {
    _arabicFontPromise = (async () => {
      const [normal, bold] = await Promise.all([
        fetchFontBase64(ARABIC_FONT_FILES.normal.url),
        fetchFontBase64(ARABIC_FONT_FILES.bold.url),
      ])
      if (!normal) return null
      return { normal, bold: bold ?? normal }
    })()
  }
  const fonts = await _arabicFontPromise
  if (!fonts) return "helvetica"
  try {
    doc.addFileToVFS(ARABIC_FONT_FILES.normal.vfsName, fonts.normal)
    doc.addFont(ARABIC_FONT_FILES.normal.vfsName, ARABIC_FONT_NAME, "normal")
    doc.addFileToVFS(ARABIC_FONT_FILES.bold.vfsName, fonts.bold)
    doc.addFont(ARABIC_FONT_FILES.bold.vfsName, ARABIC_FONT_NAME, "bold")
    return ARABIC_FONT_NAME
  } catch {
    return "helvetica"
  }
}

/**
 * Build a two-line "English\nArabic" autoTable header label with the Arabic
 * half pre-shaped into contextual presentation-form glyphs. Pre-shaping makes
 * autoTable's width-measuring and text-rendering passes agree, so Arabic header
 * lines are not wrongly wrapped. `processArabic` is idempotent.
 */
export function bilingualHead(doc: jsPDF, en: string, ar: string): string {
  const d = doc as jsPDF & { processArabic?: (text: string) => string }
  return `${en}\n${d.processArabic ? d.processArabic(ar) : ar}`
}

/**
 * Stamp the standard institute header on a jsPDF document.
 * Logo + brand name + sub-line are centred at the top of the page.
 * Returns the y-coordinate where document content should start.
 */
export async function addReportHeader(
  doc: jsPDF,
  title: string,
  subtitle?: string,
): Promise<number> {
  const pageW = doc.internal.pageSize.getWidth()
  const cx = pageW / 2
  const startX = 14

  const logo = await fetchLogoDataUrl()
  if (logo) {
    try { doc.addImage(logo, "PNG", cx - 20, 7, 40, 9) }
    catch { /* gracefully continue without logo */ }
  }

  // Centred brand name below logo
  doc.setFontSize(14); doc.setFont("helvetica", "bold")
  doc.text(BRAND_NAME, cx, 21, { align: "center" })

  // Centred sub-line
  doc.setFontSize(8); doc.setFont("helvetica", "normal")
  doc.setTextColor(110)
  doc.text(BRAND_SUBLINE, cx, 26, { align: "center" })
  doc.setTextColor(0)

  // Document title (left-aligned — this is the specific report title)
  doc.setFontSize(12); doc.setFont("helvetica", "bold")
  doc.text(title, startX, 35)

  let y = 35
  if (subtitle) {
    doc.setFontSize(9); doc.setFont("helvetica", "normal")
    doc.text(subtitle, startX, 41)
    y = 41
  }

  // Faint divider beneath the header
  doc.setDrawColor(220)
  doc.line(startX, y + 3, pageW - startX, y + 3)
  doc.setDrawColor(0)

  return y + 8 // recommended startY for autoTable
}
