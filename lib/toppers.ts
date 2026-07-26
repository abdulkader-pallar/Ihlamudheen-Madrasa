// ╔══════════════════════════════════════════════════════════════════╗
// ║ TOPPERS — exam rank-list poster generator                        ║
// ║                                                                  ║
// ║ Pure helpers (no React) used by the Grade Book to produce a      ║
// ║ shareable "Toppers" poster per class once marks are entered:     ║
// ║   • computeToppers()  — rank students by total score             ║
// ║   • inlinePhoto()     — resolve a student photo to a data URI    ║
// ║   • buildToppersSVG() — render the branded poster as SVG markup  ║
// ║   • svgToPngDataUrl() — rasterise the SVG to a PNG data URL       ║
// ║                                                                  ║
// ║ Everything the poster references (logo + photos) is inlined as   ║
// ║ a data URI, so the export canvas is never tainted.               ║
// ╚══════════════════════════════════════════════════════════════════╝

import type { GradeBookExam } from "@/lib/db"
import type { Student } from "@/data/courses"
import { getStudentPhotoUrl } from "@/lib/storage"

// ── Brand palette ───────────────────────────────────────────────────
const NAVY = "#16335a"
const TEAL = "#147d7a"
const INK = "#1e3a5f"

// ── Ranking ─────────────────────────────────────────────────────────
export interface Topper {
  rank: number
  student: Student
  total: number
  maxTotal: number
  pct: number
}

/**
 * Rank a class's students for an exam by total score (desc).
 * Students with no marks (or a zero total) are excluded. Ties are broken
 * alphabetically by name so the ordering is stable across re-renders.
 */
export function computeToppers(
  exam: GradeBookExam,
  students: Student[],
  topN = 3,
): Topper[] {
  const maxTotal = exam.subjects.reduce((s, sub) => s + sub.maxScore, 0)
  const scored = students
    .map((st) => {
      let total = 0
      let hasAny = false
      exam.subjects.forEach((sub) => {
        const v = exam.subjectScores[st.id]?.[sub.id]
        if (v !== undefined && v !== null) {
          total += Number(v) || 0
          hasAny = true
        }
      })
      return { student: st, total, hasAny }
    })
    .filter((x) => x.hasAny && x.total > 0)
    .sort(
      (a, b) =>
        b.total - a.total ||
        a.student.name.localeCompare(b.student.name, undefined, { sensitivity: "base" }),
    )

  return scored.slice(0, topN).map((x, i) => ({
    rank: i + 1,
    student: x.student,
    total: x.total,
    maxTotal,
    pct: maxTotal > 0 ? Math.round((x.total / maxTotal) * 100) : 0,
  }))
}

// ── Photo resolution ────────────────────────────────────────────────
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

/**
 * Resolve a `Student.photo` value to a data URI suitable for inlining into
 * the poster SVG. `photo` may be a `data:` URI, a full URL, or a private
 * `student-photos` bucket path (e.g. `students/<id>.jpg`). Returns "" on any
 * failure so the caller can fall back to an initials avatar.
 */
export async function inlinePhoto(photo?: string): Promise<string> {
  if (!photo) return ""
  try {
    if (photo.startsWith("data:")) return photo
    let url = photo
    if (!/^https?:\/\//.test(photo)) {
      const signed = await getStudentPhotoUrl(photo)
      if (!signed) return ""
      url = signed
    }
    const res = await fetch(url)
    if (!res.ok) return ""
    const blob = await res.blob()
    return await blobToDataUrl(blob)
  } catch {
    return ""
  }
}

/** Resolve every topper's photo in parallel → map of studentId → data URI. */
export async function resolveTopperPhotos(toppers: Topper[]): Promise<Record<string, string>> {
  const entries = await Promise.all(
    toppers.map(async (t) => [t.student.id, await inlinePhoto(t.student.photo)] as const),
  )
  const map: Record<string, string> = {}
  entries.forEach(([id, uri]) => {
    if (uri) map[id] = uri
  })
  return map
}

// ── SVG poster ──────────────────────────────────────────────────────
const POSTER_W = 1130
const POSTER_H = 1600

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Greedy word-wrap into at most `maxLines` lines, each ≤ `maxChars`. */
function wrapWords(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ""
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w
    if (candidate.length > maxChars && cur) {
      lines.push(cur)
      cur = w
      if (lines.length === maxLines - 1) break
    } else {
      cur = candidate
    }
  }
  if (cur) lines.push(cur)
  // Anything that didn't fit gets appended to the last line (rare).
  const consumed = lines.join(" ").split(/\s+/).length
  if (consumed < words.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1]} ${words.slice(consumed).join(" ")}`
  }
  return lines.slice(0, maxLines)
}

interface MedalTheme {
  ring: string
  light: string
  dark: string
  ribbon: string
}
const MEDAL_THEMES: Record<number, MedalTheme> = {
  1: { ring: "#caa53d", light: "#fbe08a", dark: "#d9a227", ribbon: "#147d7a" },
  2: { ring: "#9aa3ae", light: "#e6eaee", dark: "#aab2bd", ribbon: "#147d7a" },
  3: { ring: "#b06a2e", light: "#e3a972", dark: "#bd7637", ribbon: "#147d7a" },
}
function medalTheme(rank: number): MedalTheme {
  return MEDAL_THEMES[rank] ?? { ring: NAVY, light: "#cdd6e2", dark: "#8c9bb3", ribbon: TEAL }
}

/** A medal disc (number inside), ribbon tails, and a crown for rank 1. */
function medalSvg(cx: number, cy: number, r: number, rank: number): string {
  const t = medalTheme(rank)
  const ribW = r * 0.42
  const ribbon = `
    <path d="M ${cx - ribW} ${cy + r * 0.5} L ${cx - ribW} ${cy + r * 1.7} L ${cx - ribW / 2} ${cy + r * 1.4} L ${cx} ${cy + r * 1.7} L ${cx} ${cy + r * 0.5} Z" fill="${t.ribbon}" opacity="0.92"/>
    <path d="M ${cx + ribW} ${cy + r * 0.5} L ${cx + ribW} ${cy + r * 1.7} L ${cx + ribW / 2} ${cy + r * 1.4} L ${cx} ${cy + r * 1.7} L ${cx} ${cy + r * 0.5} Z" fill="${t.ribbon}" opacity="0.78"/>`
  const crown =
    rank === 1
      ? `<path d="M ${cx - r * 0.62} ${cy - r * 0.95}
           L ${cx - r * 0.42} ${cy - r * 1.5}
           L ${cx - r * 0.18} ${cy - r * 1.05}
           L ${cx} ${cy - r * 1.62}
           L ${cx + r * 0.18} ${cy - r * 1.05}
           L ${cx + r * 0.42} ${cy - r * 1.5}
           L ${cx + r * 0.62} ${cy - r * 0.95} Z"
           fill="#e7b73a" stroke="#caa53d" stroke-width="2" stroke-linejoin="round"/>`
      : ""
  return `
    ${ribbon}
    ${crown}
    <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="${t.ring}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#medal${rank})" stroke="#ffffff" stroke-width="3"/>
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
      font-family="Arial, Helvetica, sans-serif" font-weight="800"
      font-size="${r * 1.05}" fill="#ffffff" stroke="${t.dark}" stroke-width="1">${rank}</text>`
}

/** A square, rounded student photo (or an initials avatar when missing). */
function photoSvg(x: number, y: number, size: number, name: string, dataUri: string): string {
  const rx = size * 0.16
  const clipId = `clip${Math.round(x)}_${Math.round(y)}`
  if (dataUri) {
    return `
      <defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${rx}"/></clipPath></defs>
      <rect x="${x - 4}" y="${y - 4}" width="${size + 8}" height="${size + 8}" rx="${rx + 4}" fill="#ffffff" stroke="#dfe5ec" stroke-width="2"/>
      <image href="${dataUri}" xlink:href="${dataUri}" x="${x}" y="${y}" width="${size}" height="${size}"
        preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`
  }
  return `
    <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${rx}" fill="#e8edf3" stroke="#cfd8e3" stroke-width="2"/>
    <text x="${x + size / 2}" y="${y + size / 2}" text-anchor="middle" dominant-baseline="central"
      font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${size * 0.34}" fill="${INK}">${escapeXml(initials(name))}</text>`
}

export interface ToppersPosterInput {
  classLabel: string
  examTitle: string
  academicYear: string
  toppers: Topper[]
  photos: Record<string, string>
  logoDataUri: string | null
  /** Show the obtained / max total beneath each name. Default true. */
  showScores?: boolean
}

/**
 * Build the full Toppers poster as a self-contained SVG string (pure SVG —
 * no foreignObject — so it rasterises cleanly to PNG). All images must
 * already be inlined as data URIs.
 */
export function buildToppersSVG(input: ToppersPosterInput): string {
  const { classLabel, examTitle, academicYear, toppers, photos, logoDataUri, showScores = true } = input

  // ── Heading: split the exam title onto at most two balanced lines ──
  const titleLines = wrapWords(examTitle.toUpperCase(), 12, 2)
  const titleFont = titleLines.some((l) => l.length > 11) ? 78 : 92

  // ── Rank rows layout ──
  const zoneTop = 700
  const zoneBottom = POSTER_H - 70
  const rowH = (zoneBottom - zoneTop) / Math.max(toppers.length, 1)
  const cardPad = Math.min(rowH * 0.09, 16)

  const rows = toppers
    .map((t) => {
      const cy = zoneTop + rowH * (toppers.indexOf(t) + 0.5)
      const cardX = 56
      const cardW = POSTER_W - 112
      const cardH = rowH - cardPad * 2
      const cardY = cy - cardH / 2
      const medalR = Math.min(cardH * 0.32, 88)
      const medalCx = cardX + 30 + medalR + 14
      const photoSize = cardH * 0.86
      const photoX = cardX + cardW - photoSize - 26
      const photoY = cy - photoSize / 2
      const dividerX = medalCx + medalR + 34

      // Name occupies the space between the divider and the photo.
      const nameLeft = dividerX + 26
      const nameRight = photoX - 26
      const nameCx = (nameLeft + nameRight) / 2
      const nameLines = wrapWords(t.student.name.toUpperCase(), 16, 2)
      const longest = Math.max(...nameLines.map((l) => l.length), 1)
      const nameFont = Math.max(Math.min(54, Math.round((nameRight - nameLeft) / (longest * 0.62))), 30)
      const lineGap = nameFont * 1.06
      const nameStartY = cy - ((nameLines.length - 1) * lineGap) / 2 - (showScores ? nameFont * 0.28 : 0)

      const t2 = medalTheme(t.rank)
      const cardFill =
        t.rank === 1 ? "#fff8e8" : t.rank === 2 ? "#f4f6f8" : t.rank === 3 ? "#fbf1e8" : "#f6f8fb"

      const nameSvg = nameLines
        .map(
          (l, i) =>
            `<text x="${nameCx}" y="${nameStartY + i * lineGap}" text-anchor="middle" dominant-baseline="central"
               font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${nameFont}"
               letter-spacing="0.5" fill="${INK}">${escapeXml(l)}</text>`,
        )
        .join("")

      const scoreSvg = showScores
        ? `<text x="${nameCx}" y="${nameStartY + nameLines.length * lineGap - lineGap * 0.1 + nameFont * 0.5}"
             text-anchor="middle" dominant-baseline="central"
             font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${Math.max(nameFont * 0.42, 20)}"
             fill="${TEAL}">${t.total} / ${t.maxTotal}  ·  ${t.pct}%</text>`
        : ""

      return `
        <g>
          <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="22"
            fill="${cardFill}" stroke="${t2.ring}" stroke-width="2.5"/>
          <line x1="${dividerX}" y1="${cardY + cardH * 0.18}" x2="${dividerX}" y2="${cardY + cardH * 0.82}"
            stroke="${t2.ring}" stroke-width="2" opacity="0.5"/>
          ${medalSvg(medalCx, cy, medalR, t.rank)}
          ${nameSvg}
          ${scoreSvg}
          ${photoSvg(photoX, photoY, photoSize, t.student.name, photos[t.student.id] || "")}
        </g>`
    })
    .join("")

  const logo = logoDataUri
    ? `<image href="${logoDataUri}" xlink:href="${logoDataUri}" x="${POSTER_W / 2 - 175}" y="58" width="350" height="120" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="${POSTER_W / 2}" y="130" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="60" fill="${NAVY}">Ihlamudheen Madrasa</text>`

  const titleSvg = titleLines
    .map(
      (l, i) =>
        `<text x="${POSTER_W / 2}" y="${250 + i * (titleFont + 8)}" text-anchor="middle"
           font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${titleFont}"
           letter-spacing="1" fill="${i === 0 ? NAVY : TEAL}">${escapeXml(l)}</text>`,
    )
    .join("")
  const titleBottom = 250 + (titleLines.length - 1) * (titleFont + 8) + titleFont * 0.5

  // Year ribbon banner
  const ribbonY = titleBottom + 40
  const ribbonH = 78
  const ribbonW = 460
  const rx0 = (POSTER_W - ribbonW) / 2
  const yearRibbon = `
    <path d="M ${rx0 - 70} ${ribbonY + 8} L ${rx0} ${ribbonY} L ${rx0} ${ribbonY + ribbonH} L ${rx0 - 70} ${ribbonY + ribbonH - 8}
             L ${rx0 - 50} ${ribbonY + ribbonH / 2} Z" fill="${NAVY}" opacity="0.85"/>
    <path d="M ${rx0 + ribbonW + 70} ${ribbonY + 8} L ${rx0 + ribbonW} ${ribbonY} L ${rx0 + ribbonW} ${ribbonY + ribbonH} L ${rx0 + ribbonW + 70} ${ribbonY + ribbonH - 8}
             L ${rx0 + ribbonW + 50} ${ribbonY + ribbonH / 2} Z" fill="${NAVY}" opacity="0.85"/>
    <rect x="${rx0}" y="${ribbonY}" width="${ribbonW}" height="${ribbonH}" rx="8" fill="${TEAL}"/>
    <text x="${POSTER_W / 2}" y="${ribbonY + ribbonH / 2}" text-anchor="middle" dominant-baseline="central"
      font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="46" letter-spacing="3" fill="#ffffff">${escapeXml(academicYear)}</text>`

  // Grade pill
  const pillY = ribbonY + ribbonH + 30
  const pillH = 76
  const pillW = 430
  const px0 = (POSTER_W - pillW) / 2
  const gradePill = `
    <rect x="${px0}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="${NAVY}"/>
    <text x="${px0 - 28}" y="${pillY + pillH / 2}" text-anchor="middle" dominant-baseline="central" font-size="34" fill="${TEAL}">★</text>
    <text x="${px0 + pillW + 28}" y="${pillY + pillH / 2}" text-anchor="middle" dominant-baseline="central" font-size="34" fill="${TEAL}">★</text>
    <text x="${POSTER_W / 2}" y="${pillY + pillH / 2}" text-anchor="middle" dominant-baseline="central"
      font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="40" letter-spacing="2" fill="#ffffff">${escapeXml(classLabel.toUpperCase())}</text>`

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
      width="${POSTER_W}" height="${POSTER_H}" viewBox="0 0 ${POSTER_W} ${POSTER_H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset="1" stop-color="#eef3f7"/>
      </linearGradient>
      <radialGradient id="medal1" cx="0.35" cy="0.3" r="0.85">
        <stop offset="0" stop-color="#fdeeae"/><stop offset="1" stop-color="#e0a01e"/>
      </radialGradient>
      <radialGradient id="medal2" cx="0.35" cy="0.3" r="0.85">
        <stop offset="0" stop-color="#f2f5f8"/><stop offset="1" stop-color="#aab2bd"/>
      </radialGradient>
      <radialGradient id="medal3" cx="0.35" cy="0.3" r="0.85">
        <stop offset="0" stop-color="#eec199"/><stop offset="1" stop-color="#b06a2e"/>
      </radialGradient>
    </defs>

    <rect width="${POSTER_W}" height="${POSTER_H}" fill="url(#bg)"/>
    <!-- Decorative corners -->
    <path d="M 0 0 L 320 0 Q 150 90 0 300 Z" fill="${NAVY}" opacity="0.08"/>
    <path d="M ${POSTER_W} 0 L ${POSTER_W - 300} 0 Q ${POSTER_W - 120} 90 ${POSTER_W} 320 Z" fill="${TEAL}" opacity="0.08"/>
    <path d="M 0 ${POSTER_H} L 280 ${POSTER_H} Q 130 ${POSTER_H - 90} 0 ${POSTER_H - 280} Z" fill="${TEAL}" opacity="0.08"/>
    <path d="M ${POSTER_W} ${POSTER_H} L ${POSTER_W - 320} ${POSTER_H} Q ${POSTER_W - 150} ${POSTER_H - 90} ${POSTER_W} ${POSTER_H - 300} Z" fill="${NAVY}" opacity="0.08"/>
    <!-- Frame -->
    <rect x="20" y="20" width="${POSTER_W - 40}" height="${POSTER_H - 40}" rx="28" fill="none" stroke="${NAVY}" stroke-width="3"/>
    <rect x="30" y="30" width="${POSTER_W - 60}" height="${POSTER_H - 60}" rx="22" fill="none" stroke="#caa53d" stroke-width="1.5" opacity="0.6"/>

    ${logo}
    ${titleSvg}
    ${yearRibbon}
    ${gradePill}
    ${rows}
  </svg>`
}

/**
 * Rasterise an SVG string to a PNG data URL. `scale` supersamples for a
 * crisper image. Resolves to a `data:image/png;base64,…` string.
 */
export function svgToPngDataUrl(svg: string, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas")
        canvas.width = POSTER_W * scale
        canvas.height = POSTER_H * scale
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          URL.revokeObjectURL(url)
          reject(new Error("Canvas not supported"))
          return
        }
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        resolve(canvas.toDataURL("image/png"))
      } catch (e) {
        URL.revokeObjectURL(url)
        reject(e)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Failed to render poster SVG"))
    }
    img.src = url
  })
}

export const TOPPERS_POSTER_W = POSTER_W
export const TOPPERS_POSTER_H = POSTER_H
