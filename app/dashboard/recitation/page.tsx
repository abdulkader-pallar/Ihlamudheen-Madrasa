"use client"

// ╔══════════════════════════════════════════════════════════════════╗
// ║ QURAN RECITATION TRACKING & PROGRESS                              ║
// ║                                                                    ║
// ║ Route: /dashboard/recitation  (labelled "Quran Recitation")        ║
// ║                                                                    ║
// ║ A dedicated recitation teacher pulls students out of class one at  ║
// ║ a time for a 5-minute slot, coaches them, and scores them on a     ║
// ║ FIXED 50-mark rubric. Reports are weekly and show progress.        ║
// ║                                                                    ║
// ║ Role-aware:                                                        ║
// ║  • admin / teacher → score entry + class report + individual       ║
// ║  • student / parent → their own child's weekly progress only       ║
// ╚══════════════════════════════════════════════════════════════════╝

import { useState, useEffect, useCallback, useMemo } from "react"
import { motion } from "framer-motion"
import {
  BookOpenCheck, ArrowLeft, Save, Download, FileText, FileSpreadsheet, X,
  TrendingUp, TrendingDown, Minus, Search, Loader2, AlertTriangle, ChevronRight,
} from "lucide-react"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import * as db from "@/lib/db"
import { toast } from "sonner"
import type { CourseData, Student } from "@/data/courses"
import { cn } from "@/lib/utils"
import { addReportHeader, loadArabicFont, bilingualHead } from "@/lib/branding"
import type jsPDF from "jspdf"
import {
  RECITATION_CRITERIA, RECITATION_MAX, recitationTotal, recitationPct, recitationBand,
  toWeeklySeries, weeklyTrend, averageTotal, type RecitationSession, type WeeklyPoint,
} from "@/lib/recitation"
import { gradeHexColor, getGrade, GRADE_TIERS } from "@/lib/grades"

const COURSE_DISPLAY: Record<string, string> = {
  "1": "Ihlamudheen Madrasa",
  "2": "Ihlamudheen Madrasa",
  "3": "CBIS",
  "4": "Ihlamudheen Madrasa",
}

// ── Small helpers ───────────────────────────────────────────────────
function today(): string {
  return new Date().toISOString().split("T")[0]
}
function fmtDate(d?: string) {
  if (!d) return "—"
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}
function clampScore(v: string, max: number): number {
  const n = Math.round(Number(v) || 0)
  return Math.max(0, Math.min(max, n))
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
function csvCell(v: unknown): string {
  const s = String(v ?? "")
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
/** Matches Arabic-script characters — used to switch jsPDF cells to the embedded Amiri font. */
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/

// ── Vector chart helpers for PDF exports (drawn directly with jsPDF — no canvas/image needed) ──
const CHART_AMBER: [number, number, number] = [245, 158, 11]
const CHART_GRID: [number, number, number] = [226, 232, 240]
const CHART_MUTED: [number, number, number] = [140, 150, 165]

/** Draw a small weekly-average line chart (mirrors the web `TrendChart`) into the PDF. */
function drawTrendChartPdf(
  doc: jsPDF,
  opts: { x: number; y: number; width: number; height: number; points: WeeklyPoint[]; maxY: number },
) {
  const { x, y, width, height, points, maxY } = opts
  const padL = 9, padB = 7
  const plotX = x + padL
  const plotW = width - padL
  const plotY = y
  const plotH = height - padB

  if (points.length < 2) {
    doc.setDrawColor(...CHART_GRID); doc.setLineWidth(0.2)
    doc.roundedRect(x, y, width, height, 1.5, 1.5)
    doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...CHART_MUTED)
    doc.text("Need at least two weeks of data to show a trend", x + width / 2, y + height / 2, { align: "center" })
    doc.setTextColor(0)
    return
  }

  // gridlines + Y-axis tick labels
  doc.setLineWidth(0.15)
  for (let i = 0; i <= 4; i++) {
    const gy = plotY + (plotH * i) / 4
    doc.setDrawColor(...CHART_GRID)
    doc.line(plotX, gy, plotX + plotW, gy)
    doc.setFontSize(6.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...CHART_MUTED)
    doc.text(String(Math.round(maxY - (maxY * i) / 4)), plotX - 2, gy + 1.1, { align: "right" })
  }

  // plotted line, points, and week labels
  const stepX = plotW / (points.length - 1)
  const coords = points.map((p, i) => ({
    px: plotX + stepX * i,
    py: plotY + plotH - (Math.min(maxY, Math.max(0, p.avgTotal)) / maxY) * plotH,
    p,
  }))
  doc.setDrawColor(...CHART_AMBER)
  doc.setLineWidth(0.6)
  for (let i = 0; i < coords.length - 1; i++) doc.line(coords[i].px, coords[i].py, coords[i + 1].px, coords[i + 1].py)
  doc.setFillColor(...CHART_AMBER)
  for (const c of coords) {
    doc.circle(c.px, c.py, 0.9, "F")
    doc.setFontSize(6); doc.setFont("helvetica", "normal"); doc.setTextColor(...CHART_MUTED)
    doc.text(`W${c.p.weekKey.split("-W")[1]}`, c.px, plotY + plotH + 4.5, { align: "center" })
  }
  doc.setTextColor(0)
}

/** Draw a horizontal grade-distribution bar chart (mirrors the web `GradeDistributionChart`). Returns the bottom y. */
function drawGradeDistributionPdf(
  doc: jsPDF,
  opts: { x: number; y: number; width: number; tiers: { letter: string; count: number }[] },
): number {
  const { x, y, width, tiers } = opts
  const max = Math.max(1, ...tiers.map((t) => t.count))
  const rowH = 5.2
  const labelW = 8
  const countW = 7
  const barX = x + labelW
  const barW = width - labelW - countW

  let cy = y
  for (const t of tiers) {
    const rgb = hexToRgb(gradeHexColor(t.letter))
    doc.setFontSize(7.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...rgb)
    doc.text(t.letter, x + labelW - 2, cy + rowH / 2 + 1, { align: "right" })
    doc.setFillColor(232, 236, 243)
    doc.roundedRect(barX, cy + 0.6, barW, rowH - 1.2, 0.8, 0.8, "F")
    if (t.count > 0) {
      doc.setFillColor(...rgb)
      doc.roundedRect(barX, cy + 0.6, Math.max(2.2, (t.count / max) * barW), rowH - 1.2, 0.8, 0.8, "F")
    }
    doc.setFont("helvetica", "normal"); doc.setTextColor(...CHART_MUTED)
    doc.text(t.count ? String(t.count) : "", barX + barW + countW - 2, cy + rowH / 2 + 1, { align: "right" })
    cy += rowH
  }
  doc.setTextColor(0)
  return cy
}

/**
 * Generate + download a single student's full recitation report as a PDF.
 * Shared by the student-detail view (Export menu) and the class-report list
 * (per-row download icon) so there is exactly one source of truth for the
 * individual report layout.
 */
async function downloadStudentRecitationPdf(opts: {
  student: Pick<Student, "id" | "name" | "rollNo">
  className: string
  courseLabel?: string
  sessions: RecitationSession[]
}) {
  const { student, className, courseLabel } = opts
  const ordered = [...opts.sessions].sort((a, b) => a.date.localeCompare(b.date))
  const weekly = toWeeklySeries(ordered)
  const trend = weeklyTrend(weekly)
  const avg = averageTotal(ordered)
  const best = ordered.reduce((m, s) => Math.max(m, s.total), 0)

  const { default: jsPDF } = await import("jspdf")
  const { default: autoTable } = await import("jspdf-autotable")
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const arabicFont = await loadArabicFont(doc)
  const contentY = await addReportHeader(
    doc,
    "Quran Recitation — Progress Report",
    `${className}${courseLabel ? ` · ${courseLabel}` : ""} · Generated ${new Date().toLocaleString("en-IN")}`,
  )
  const NAVY: [number, number, number] = [30, 58, 95]
  const pageW = doc.internal.pageSize.getWidth()
  doc.setFillColor(...NAVY); doc.rect(14, contentY, pageW - 28, 11, "F")
  doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(255, 255, 255)
  doc.text(`${student.name} — Recitation Progress`, pageW / 2, contentY + 7.5, { align: "center" })
  doc.setTextColor(0, 0, 0)

  autoTable(doc, {
    startY: contentY + 15,
    body: [
      ["Student Name", student.name],
      ["Registration No.", student.rollNo],
      ["Class", className],
      ["Sessions Recorded", String(ordered.length)],
      ["Average Score", ordered.length ? `${avg} / ${RECITATION_MAX} (${recitationPct(avg)}%) · ${recitationBand(avg).label}` : "—"],
      ["Best Score", ordered.length ? `${best} / ${RECITATION_MAX}` : "—"],
      ["Latest vs Previous Week", trend.delta === null ? "First week" : `${trend.delta > 0 ? "+" : ""}${trend.delta} marks`],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 55, fillColor: [248, 249, 252] } },
    theme: "plain",
  })
  const afterInfo = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? contentY + 50

  doc.setFontSize(10); doc.setFont("helvetica", "bold")
  doc.text("Session History", 14, afterInfo + 8)
  autoTable(doc, {
    startY: afterInfo + 11,
    head: [[
      bilingualHead(doc, "Date", "التاريخ"),
      bilingualHead(doc, "Pron /20", RECITATION_CRITERIA[0].labelAr),
      bilingualHead(doc, "Tajweed /20", RECITATION_CRITERIA[1].labelAr),
      bilingualHead(doc, "Style /5", RECITATION_CRITERIA[2].labelAr),
      bilingualHead(doc, "Start/Stop /5", RECITATION_CRITERIA[3].labelAr),
      bilingualHead(doc, `Total /${RECITATION_MAX}`, "المجموع"),
      bilingualHead(doc, "Grade", "التقدير"),
      bilingualHead(doc, "Coaching note", "ملاحظة"),
    ]],
    body: ordered.map((s) => [
      fmtDate(s.date), s.pronunciation, s.tajweed, s.style, s.startStop, s.total, recitationBand(s.total).letter, s.notes ?? "",
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: NAVY, fontSize: 8, font: arabicFont, halign: "center", valign: "middle", minCellHeight: 12 },
    columnStyles: { 7: { cellWidth: 55 } },
    theme: "striped",
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 6) {
        const letter = String(data.cell.raw)
        data.cell.styles.textColor = hexToRgb(gradeHexColor(letter))
        data.cell.styles.fontStyle = "bold"
      } else if (data.section === "body" && data.column.index === 7 && ARABIC_RE.test(String(data.cell.raw ?? ""))) {
        data.cell.styles.font = arabicFont
      }
    },
  })

  // ── Chart: student weekly progress (mirrors the on-screen "Weekly progress" chart) ──
  const pageH = doc.internal.pageSize.getHeight()
  const sessionTableEnd = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? afterInfo + 50
  let chartTop = sessionTableEnd + 11
  const chartH = 45
  if (chartTop + chartH > pageH - 14) {
    doc.addPage()
    chartTop = 20
  }
  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...NAVY)
  doc.text("Weekly progress", 14, chartTop)
  doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(130)
  doc.text(`${ordered.length} session${ordered.length === 1 ? "" : "s"} · ${weekly.length} week${weekly.length === 1 ? "" : "s"}`, 14, chartTop + 4.5)
  doc.setTextColor(0)
  drawTrendChartPdf(doc, { x: 14, y: chartTop + 8, width: pageW - 28, height: chartH - 8, points: weekly, maxY: RECITATION_MAX })

  doc.save(`Recitation-${student.name.replace(/\s+/g, "_")}-${today()}.pdf`)
}

// ── Bilingual rubric-criterion label (English + Arabic) ─────────────
function CriterionLabel({ en, ar, short }: { en: string; ar: string; short?: boolean }) {
  return (
    <>
      {short ? en.split(" ")[0] : en}
      <bdi dir="rtl" className="block font-['Amiri'] text-[0.92em] leading-tight opacity-70">{ar}</bdi>
    </>
  )
}

// ── Trend badge ─────────────────────────────────────────────────────
function TrendBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="inline-flex items-center gap-1 text-xs text-navy-400">— new</span>
  }
  if (delta > 0) {
    return <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-500"><TrendingUp className="size-3.5" />+{delta}</span>
  }
  if (delta < 0) {
    return <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500"><TrendingDown className="size-3.5" />{delta}</span>
  }
  return <span className="inline-flex items-center gap-1 text-xs font-semibold text-navy-400"><Minus className="size-3.5" />0</span>
}

// ── Weekly trend line chart ─────────────────────────────────────────
function TrendChart({ points }: { points: WeeklyPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-navy-400">
        Need at least two weeks of data to show a trend
      </div>
    )
  }
  const data = points.map((p) => ({ name: p.label.replace(" · ", "\n"), week: `W${p.weekKey.split("-W")[1]}`, score: p.avgTotal }))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
        <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="#94a3b8" />
        <YAxis domain={[0, RECITATION_MAX]} tick={{ fontSize: 11 }} stroke="#94a3b8" />
        <Tooltip
          contentStyle={{ borderRadius: 10, border: "1px solid rgba(148,163,184,0.3)", fontSize: 12 }}
          formatter={(value) => [`${value} / ${RECITATION_MAX}`, "Avg score"]}
        />
        <Line type="monotone" dataKey="score" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3, fill: "#f59e0b" }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── Per-criterion progress bar (rubric breakdown) ───────────────────
function CriterionBar({ label, labelAr, value, max }: { label: string; labelAr: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const grade = getGrade(Math.round(pct))
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium leading-tight text-navy-600 dark:text-navy-300">
          {label}
          <bdi dir="rtl" className="block font-['Amiri'] text-[0.92em] opacity-70">{labelAr}</bdi>
        </span>
        <span className={cn("shrink-0 font-bold tabular-nums", grade.color)}>
          {Number.isInteger(value) ? value : value.toFixed(1)} <span className="font-normal text-navy-400">/ {max}</span>
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-navy-100 dark:bg-navy-800">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: gradeHexColor(grade.letter) }}
          initial={{ width: "0%" }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
    </div>
  )
}

// ── Class-wide grade-distribution bar chart ─────────────────────────
function GradeDistributionChart({
  tiers, assessed, total,
}: {
  tiers: { letter: string; label: string; color: string; count: number }[]
  assessed: number
  total: number
}) {
  const max = Math.max(1, ...tiers.map((t) => t.count))
  return (
    <div>
      <div className="space-y-2">
        {tiers.map((t) => (
          <div key={t.letter} className="flex items-center gap-2.5">
            <span className={cn("w-8 shrink-0 text-right text-[11px] font-bold", t.color)}>{t.letter}</span>
            <div className="h-4 flex-1 overflow-hidden rounded-md bg-navy-100 dark:bg-navy-900/60">
              {t.count > 0 && (
                <motion.div
                  className="h-full rounded-md"
                  style={{ backgroundColor: gradeHexColor(t.letter) }}
                  initial={{ width: "0%" }}
                  animate={{ width: `${(t.count / max) * 100}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              )}
            </div>
            <span className="w-5 shrink-0 text-right text-[11px] font-semibold text-navy-500 dark:text-navy-400">{t.count || ""}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-navy-400">Based on each student&apos;s average score · {assessed} of {total} assessed so far</p>
    </div>
  )
}

// ── Export menu (PDF + CSV) ─────────────────────────────────────────
function ExportMenu({ onPdf, onCsv, disabled }: { onPdf: () => void; onCsv: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    function close(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest("[data-export-menu]")) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])
  return (
    <div className="relative" data-export-menu>
      <Button variant="outline" className="gap-2" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        <Download className="size-4" /> Export <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-card shadow-xl">
          <button onClick={() => { setOpen(false); onPdf() }} className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-navy-50 dark:hover:bg-navy-800">
            <FileText className="size-4 text-red-500" /> Download PDF
          </button>
          <button onClick={() => { setOpen(false); onCsv() }} className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-navy-50 dark:hover:bg-navy-800">
            <FileSpreadsheet className="size-4 text-emerald-500" /> Download CSV
          </button>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// PAGE
// ════════════════════════════════════════════════════════════════════
export default function RecitationPage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const canManage = role === "admin" || role === "accountant" || role === "teacher"

  if (!user) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="size-8 animate-spin text-gold-500" /></div>
  }

  if (!canManage) {
    const studentId = (user.user_metadata?.student_id as string) || user.id
    const studentName = (user.user_metadata?.full_name as string) || "Your child"
    return <StudentRecitationView studentId={studentId} fallbackName={studentName} />
  }

  return <RecitationConsole assessorName={(user.user_metadata?.full_name as string) || user.email || "Teacher"} assessorId={user.id} role={role} />
}

// ════════════════════════════════════════════════════════════════════
// TEACHER / ADMIN CONSOLE
// ════════════════════════════════════════════════════════════════════
type Draft = Record<string, { pronunciation: string; tajweed: string; style: string; startStop: string; notes: string }>

function RecitationConsole({ assessorName, assessorId, role }: { assessorName: string; assessorId: string; role: string }) {
  const [courses, setCourses] = useState<CourseData[]>([])
  const [sessions, setSessions] = useState<RecitationSession[]>([])
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)

  const [courseFilter, setCourseFilter] = useState("")
  const [classFilter, setClassFilter] = useState("")
  const [sessionDate, setSessionDate] = useState(today())
  const [tab, setTab] = useState<"entry" | "report">("entry")
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [previewExport, setPreviewExport] = useState<"pdf" | "csv" | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const [draft, setDraft] = useState<Draft>({})
  const [saving, setSaving] = useState(false)

  // ── Loaders ──
  const loadAll = useCallback(async () => {
    const ready = await db.checkSupabase()
    if (!ready) { setLoading(false); return }
    const [coursesRes, sessRes] = await Promise.all([
      db.fetchCoursesFromDB(),
      db.fetchAllRecitationSessions(),
    ])
    setCourses(coursesRes)
    if (sessRes.error === "TABLE_MISSING") setTableMissing(true)
    else { setTableMissing(false); setSessions(sessRes.data) }
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    const sub = db.subscribeToTable("recitation_sessions", loadAll)
    return () => sub.unsubscribe()
  }, [loadAll])

  // ── Derived ──
  const allClasses = useMemo(
    () => courses.flatMap((c) => c.classes.map((cl) => ({ ...cl, courseId: c.id, courseTitle: c.title }))),
    [courses],
  )
  const currentClass = useMemo(() => allClasses.find((c) => c.id === classFilter), [allClasses, classFilter])
  const roster = useMemo(() => {
    const list = currentClass?.students ?? []
    return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
  }, [currentClass])

  const classSessions = useMemo(
    () => sessions.filter((s) => s.classId === classFilter),
    [sessions, classFilter],
  )
  const sessionsByStudent = useMemo(() => {
    const map: Record<string, RecitationSession[]> = {}
    for (const s of classSessions) (map[s.studentId] ??= []).push(s)
    Object.values(map).forEach((arr) => arr.sort((a, b) => a.date.localeCompare(b.date)))
    return map
  }, [classSessions])

  // Rebuild the entry draft whenever class or date changes (prefill existing rows)
  useEffect(() => {
    if (!classFilter) { setDraft({}); return }
    const next: Draft = {}
    for (const st of roster) {
      const existing = classSessions.find((s) => s.studentId === st.id && s.date === sessionDate)
      next[st.id] = existing
        ? {
            pronunciation: String(existing.pronunciation),
            tajweed: String(existing.tajweed),
            style: String(existing.style),
            startStop: String(existing.startStop),
            notes: existing.notes ?? "",
          }
        : { pronunciation: "", tajweed: "", style: "", startStop: "", notes: "" }
    }
    setDraft(next)
  }, [classFilter, sessionDate, roster, classSessions])

  function updateDraft(studentId: string, field: keyof Draft[string], value: string) {
    setDraft((p) => ({ ...p, [studentId]: { ...p[studentId], [field]: value } }))
  }

  function rowHasData(d?: Draft[string]) {
    if (!d) return false
    return d.pronunciation !== "" || d.tajweed !== "" || d.style !== "" || d.startStop !== "" || d.notes.trim() !== ""
  }

  async function handleSaveAll() {
    if (!classFilter) return
    const rows = roster.filter((st) => rowHasData(draft[st.id]))
    if (rows.length === 0) { toast.error("Enter at least one score before saving."); return }
    setSaving(true)
    let ok = 0, fail = 0
    for (const st of rows) {
      const d = draft[st.id]
      const { error } = await db.saveRecitationSession({
        classId: classFilter,
        studentId: st.id,
        date: sessionDate,
        pronunciation: clampScore(d.pronunciation, 20),
        tajweed: clampScore(d.tajweed, 20),
        style: clampScore(d.style, 5),
        startStop: clampScore(d.startStop, 5),
        notes: d.notes,
        assessedBy: assessorName,
        assessedById: assessorId,
      })
      if (error) fail++; else ok++
    }
    setSaving(false)
    if (fail === 0) toast.success(`Saved ${ok} assessment${ok === 1 ? "" : "s"} for ${fmtDate(sessionDate)}`)
    else toast.error(`Saved ${ok}, ${fail} failed. Check connection and try again.`)
    loadAll()
  }

  // ── Class report rows (weekly progress per student) ──
  const reportRows = useMemo(() => {
    return roster.map((st) => {
      const list = sessionsByStudent[st.id] ?? []
      const weekly = toWeeklySeries(list)
      const trend = weeklyTrend(weekly)
      return {
        student: st,
        count: list.length,
        avg: averageTotal(list),
        latest: trend.latest,
        previous: trend.previous,
        delta: trend.delta,
        lastNote: list.length ? list[list.length - 1].notes : undefined,
        weekly,
      }
    })
  }, [roster, sessionsByStudent])

  const filteredReportRows = useMemo(() => {
    if (!search.trim()) return reportRows
    const q = search.toLowerCase()
    return reportRows.filter((r) => r.student.name.toLowerCase().includes(q) || r.student.rollNo.toLowerCase().includes(q))
  }, [reportRows, search])

  const classWeekly = useMemo(() => toWeeklySeries(classSessions), [classSessions])

  // ── Grade distribution across the class (by each student's average) ──
  const gradeDistribution = useMemo(() => {
    const counts = new Map<string, number>()
    let assessed = 0
    for (const r of reportRows) {
      if (!r.count) continue
      assessed++
      const letter = recitationBand(r.avg).letter
      counts.set(letter, (counts.get(letter) ?? 0) + 1)
    }
    return {
      tiers: GRADE_TIERS.map((g) => ({ letter: g.letter, label: g.label, color: g.color, count: counts.get(g.letter) ?? 0 })),
      assessed,
      total: reportRows.length,
    }
  }, [reportRows])

  // ── Exports ──
  async function exportClassPdf() {
    if (!currentClass) return
    const { default: jsPDF } = await import("jspdf")
    const { default: autoTable } = await import("jspdf-autotable")
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
    const arabicFont = await loadArabicFont(doc)
    const contentY = await addReportHeader(
      doc,
      "Quran Recitation — Class Progress Report",
      `${currentClass.name} · ${COURSE_DISPLAY[currentClass.courseId] ?? currentClass.courseTitle} · Generated ${new Date().toLocaleString("en-IN")}`,
    )
    const NAVY: [number, number, number] = [30, 58, 95]
    const pageW = doc.internal.pageSize.getWidth()
    doc.setFillColor(...NAVY); doc.rect(14, contentY, pageW - 28, 9, "F")
    doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(255, 255, 255)
    doc.text(`Rubric: Pronunciation /20 · Tajweed /20 · Style & Melody /5 · Start & Stop /5  →  Total /${RECITATION_MAX}`, pageW / 2, contentY + 6, { align: "center" })
    doc.setTextColor(0, 0, 0)

    autoTable(doc, {
      startY: contentY + 13,
      head: [[
        bilingualHead(doc, "Reg No.", "رقم التسجيل"),
        bilingualHead(doc, "Student", "الطالب"),
        bilingualHead(doc, "Sessions", "الجلسات"),
        bilingualHead(doc, `Avg /${RECITATION_MAX}`, "المعدل"),
        bilingualHead(doc, `Latest /${RECITATION_MAX}`, "الأحدث"),
        bilingualHead(doc, `Prev /${RECITATION_MAX}`, "السابق"),
        bilingualHead(doc, "Δ Week", "تغيّر الأسبوع"),
        bilingualHead(doc, "Grade", "التقدير"),
        bilingualHead(doc, "Latest coaching note", "آخر ملاحظة"),
      ]],
      body: reportRows.map((r) => [
        r.student.rollNo,
        r.student.name,
        r.count,
        r.count ? r.avg : "—",
        r.latest ?? "—",
        r.previous ?? "—",
        r.delta === null ? "new" : (r.delta > 0 ? `+${r.delta}` : String(r.delta)),
        r.latest !== null ? recitationBand(r.latest).letter : "—",
        r.lastNote ?? "",
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: NAVY, fontSize: 8, font: arabicFont, halign: "center", valign: "middle", minCellHeight: 12 },
      columnStyles: { 8: { cellWidth: 70 } },
      theme: "striped",
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 8 && ARABIC_RE.test(String(data.cell.raw ?? ""))) {
          data.cell.styles.font = arabicFont
        }
      },
    })

    // ── Charts: class weekly trend + grade distribution (mirrors the on-screen report) ──
    const pageH = doc.internal.pageSize.getHeight()
    const tableEndY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? contentY + 13
    let chartTop = tableEndY + 11
    const blockH = 56
    if (chartTop + blockH > pageH - 14) {
      doc.addPage()
      chartTop = 20
    }
    const colGap = 12
    const colW = (pageW - 28 - colGap) / 2
    const leftX = 14
    const rightX = leftX + colW + colGap

    doc.setFontSize(10.5); doc.setFont("helvetica", "bold"); doc.setTextColor(...NAVY)
    doc.text("Class average — weekly trend", leftX, chartTop)
    doc.text("Grade distribution", rightX, chartTop)
    doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(130)
    doc.text(`${classSessions.length} session${classSessions.length === 1 ? "" : "s"} across ${classWeekly.length} week${classWeekly.length === 1 ? "" : "s"}`, leftX, chartTop + 4.5)
    doc.text("How the class is spread across the 11-tier grade scale", rightX, chartTop + 4.5)
    doc.setTextColor(0)

    drawTrendChartPdf(doc, { x: leftX, y: chartTop + 8, width: colW, height: 38, points: classWeekly, maxY: RECITATION_MAX })

    if (gradeDistribution.assessed > 0) {
      const distBottom = drawGradeDistributionPdf(doc, {
        x: rightX, y: chartTop + 9, width: colW,
        tiers: gradeDistribution.tiers.map((t) => ({ letter: t.letter, count: t.count })),
      })
      doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(...CHART_MUTED)
      doc.text(`Based on each student's average score · ${gradeDistribution.assessed} of ${gradeDistribution.total} assessed so far`, rightX, distBottom + 4)
      doc.setTextColor(0)
    } else {
      doc.setDrawColor(...CHART_GRID); doc.setLineWidth(0.2)
      doc.roundedRect(rightX, chartTop + 9, colW, 34, 1.5, 1.5)
      doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(...CHART_MUTED)
      doc.text("No assessments recorded yet", rightX + colW / 2, chartTop + 9 + 17, { align: "center" })
      doc.setTextColor(0)
    }

    doc.save(`Recitation-ClassReport-${currentClass.name.replace(/\s+/g, "_")}-${today()}.pdf`)
  }

  function exportClassCsv() {
    if (!currentClass) return
    const header = ["Reg No.", "Student", "Sessions", "Average/50", "Latest/50", "Previous/50", "Delta", "Grade", "Latest note"]
    const lines = [header.map(csvCell).join(",")]
    for (const r of reportRows) {
      lines.push([
        r.student.rollNo, r.student.name, r.count,
        r.count ? r.avg : "", r.latest ?? "", r.previous ?? "",
        r.delta === null ? "new" : r.delta, r.latest !== null ? recitationBand(r.latest).letter : "",
        r.lastNote ?? "",
      ].map(csvCell).join(","))
    }
    downloadBlob(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }), `Recitation-ClassReport-${currentClass.name.replace(/\s+/g, "_")}-${today()}.csv`)
  }

  // Download one student's full recitation report straight from the class list.
  async function handleRowPdf(student: Student) {
    if (!currentClass) return
    setDownloadingId(student.id)
    try {
      await downloadStudentRecitationPdf({
        student,
        className: currentClass.name,
        courseLabel: COURSE_DISPLAY[currentClass.courseId] ?? currentClass.courseTitle,
        sessions: sessionsByStudent[student.id] ?? [],
      })
    } catch {
      toast.error(`Could not generate ${student.name}'s report. Please try again.`)
    } finally {
      setDownloadingId(null)
    }
  }

  // ── Render: individual student detail ──
  if (selectedStudentId && currentClass) {
    const st = roster.find((s) => s.id === selectedStudentId)
    if (st) {
      return (
        <RecitationDetail
          student={st}
          className={currentClass.name}
          courseLabel={COURSE_DISPLAY[currentClass.courseId] ?? currentClass.courseTitle}
          sessions={sessionsByStudent[st.id] ?? []}
          showAssessor
          onBack={() => setSelectedStudentId(null)}
        />
      )
    }
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 animate-pulse rounded-lg bg-navy-100 dark:bg-navy-800" />
        <div className="h-96 animate-pulse rounded-xl bg-navy-100 dark:bg-navy-800" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-gold-500">Ihlamudheen Madrasa</p>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold leading-none tracking-tight text-navy-900 dark:text-white sm:text-3xl">
              <BookOpenCheck className="size-7 text-gold-500" /> Quran Recitation
            </h1>
            <p className="mt-1.5 text-sm text-navy-500 dark:text-navy-400">
              5-minute one-on-one assessment · fixed {RECITATION_MAX}-mark rubric · weekly progress tracking
            </p>
          </div>
        </div>
      </motion.div>

      {/* Migration banner */}
      {tableMissing && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">Database table not found</p>
            <p className="mt-0.5 text-amber-700/80 dark:text-amber-300/80">
              Run <code className="rounded bg-amber-500/20 px-1">supabase/migrations/20260607000000_recitation_sessions.sql</code> in the
              Supabase SQL editor to enable saving. The page works in read-only preview until then.
            </p>
          </div>
        </div>
      )}

      {/* Cascading filter bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-400">Course</span>
          <select
            value={courseFilter}
            onChange={(e) => { setCourseFilter(e.target.value); setClassFilter(""); setSelectedStudentId(null) }}
            className="w-full cursor-pointer rounded-lg border border-navy-200 bg-white px-3 py-2 text-xs font-semibold text-navy-800 focus:outline-none focus:ring-2 focus:ring-sky-500/40 dark:border-navy-700 dark:bg-navy-900 dark:text-white"
          >
            <option value="">Select Course</option>
            <option value="1">Ihlamudheen Madrasa</option>
            <option value="2">Ihlamudheen Madrasa</option>
            <option value="4">Ihlamudheen Madrasa</option>
            <option value="3">CBIS</option>
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", courseFilter ? "text-navy-400" : "text-navy-300 dark:text-navy-600")}>Class</span>
          <select
            value={classFilter}
            onChange={(e) => { setClassFilter(e.target.value); setSelectedStudentId(null) }}
            disabled={!courseFilter}
            className={cn(
              "w-full rounded-lg border px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500/40",
              !courseFilter
                ? "cursor-not-allowed border-navy-100 bg-navy-50 text-navy-300 dark:border-navy-800 dark:bg-navy-950 dark:text-navy-600"
                : "cursor-pointer border-navy-200 bg-white text-navy-800 dark:border-navy-700 dark:bg-navy-900 dark:text-white",
            )}
          >
            <option value="">Select Class</option>
            {allClasses.filter((c) => c.courseId === courseFilter).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", classFilter ? "text-navy-400" : "text-navy-300 dark:text-navy-600")}>Session Date</span>
          {/* appearance-none: WebKit/iOS otherwise sizes date inputs to their
              intrinsic content, ignoring width/min-width — which expands the grid
              track and pushes into the neighbouring "View" column. */}
          <Input type="date" value={sessionDate} max={today()} onChange={(e) => setSessionDate(e.target.value)} disabled={!classFilter} className="h-[38px] w-full min-w-0 appearance-none text-xs" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", classFilter ? "text-navy-400" : "text-navy-300 dark:text-navy-600")}>View</span>
          <div className="flex h-[38px] overflow-hidden rounded-lg border border-navy-200 dark:border-navy-700">
            <button
              onClick={() => setTab("entry")} disabled={!classFilter}
              className={cn("flex-1 text-xs font-semibold transition-colors", tab === "entry" ? "bg-gold-500 text-navy-950" : "bg-white text-navy-600 hover:bg-navy-50 dark:bg-navy-900 dark:text-navy-300", !classFilter && "cursor-not-allowed opacity-50")}
            >Score Entry</button>
            <button
              onClick={() => setTab("report")} disabled={!classFilter}
              className={cn("flex-1 text-xs font-semibold transition-colors", tab === "report" ? "bg-gold-500 text-navy-950" : "bg-white text-navy-600 hover:bg-navy-50 dark:bg-navy-900 dark:text-navy-300", !classFilter && "cursor-not-allowed opacity-50")}
            >Class Report</button>
          </div>
        </div>
      </div>

      {/* Empty gate */}
      {!classFilter && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-navy-100 dark:bg-navy-800">
            <BookOpenCheck className="size-6 text-navy-400" />
          </div>
          <p className="text-sm font-semibold text-navy-500 dark:text-navy-400">Select a course and class to begin</p>
          <p className="text-xs text-navy-400">Score students one at a time, then review weekly progress in the Class Report</p>
        </div>
      )}

      {/* ── Score entry ── */}
      {classFilter && tab === "entry" && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
            <div>
              <h3 className="text-sm font-bold text-navy-900 dark:text-white">{currentClass?.name} · {fmtDate(sessionDate)}</h3>
              <p className="text-xs text-navy-400">{roster.length} students · enter the rubric scores, then Save</p>
            </div>
            <Button onClick={handleSaveAll} disabled={saving || tableMissing} className="hidden gap-2 bg-gold-500 font-semibold text-navy-950 hover:bg-gold-600 sm:inline-flex">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {saving ? "Saving…" : "Save Session"}
            </Button>
          </div>
          {roster.length === 0 ? (
            <div className="py-12 text-center text-sm text-navy-400">No students in this class.</div>
          ) : (
            <>
            {/* Mobile: one card per student — phone-friendly entry */}
            <div className="divide-y divide-border/60 sm:hidden">
              {roster.map((st) => {
                const d = draft[st.id] ?? { pronunciation: "", tajweed: "", style: "", startStop: "", notes: "" }
                const total = recitationTotal({
                  pronunciation: clampScore(d.pronunciation, 20),
                  tajweed: clampScore(d.tajweed, 20),
                  style: clampScore(d.style, 5),
                  startStop: clampScore(d.startStop, 5),
                })
                const has = rowHasData(d)
                return (
                  <div key={st.id} className="p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-navy-900 dark:text-white">{st.name}</p>
                        <p className="font-mono text-xs text-navy-400">Reg No. {st.rollNo}</p>
                      </div>
                      <div className="shrink-0 whitespace-nowrap text-right">
                        <span className={cn("text-2xl font-extrabold", has ? recitationBand(total).color : "text-navy-300")}>{has ? total : "—"}</span>
                        <span className="text-xs text-navy-400"> /{RECITATION_MAX}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      {RECITATION_CRITERIA.map((c) => (
                        <div key={c.key} className="rounded-lg border border-input bg-background p-2.5">
                          <span className="block text-[11px] font-medium leading-tight text-navy-500 dark:text-navy-300">
                            <CriterionLabel en={c.label} ar={c.labelAr} />
                          </span>
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <input
                              type="number" min={0} max={c.max} inputMode="numeric" placeholder="0"
                              value={d[c.key]}
                              onChange={(e) => updateDraft(st.id, c.key, e.target.value)}
                              className="h-11 w-full rounded-md border border-input bg-background text-center text-base font-semibold focus:outline-none focus:ring-2 focus:ring-gold-500/40"
                            />
                            <span className="shrink-0 text-xs text-navy-400">/{c.max}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <input
                      value={d.notes}
                      onChange={(e) => updateDraft(st.id, "notes", e.target.value)}
                      placeholder="Coaching note (optional)"
                      className="mt-2.5 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500/40"
                    />
                  </div>
                )
              })}
            </div>
            {/* Desktop: table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-navy-50 dark:bg-navy-950/40">
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-navy-400">Reg No.</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-navy-400">Student</th>
                    {RECITATION_CRITERIA.map((c) => (
                      <th key={c.key} className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-navy-400" title={c.label}>
                        <CriterionLabel en={c.label} ar={c.labelAr} short /> <span className="text-navy-300">/{c.max}</span>
                      </th>
                    ))}
                    <th className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-navy-400">Total</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-navy-400">Coaching note</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((st, idx) => {
                    const d = draft[st.id] ?? { pronunciation: "", tajweed: "", style: "", startStop: "", notes: "" }
                    const total = recitationTotal({
                      pronunciation: clampScore(d.pronunciation, 20),
                      tajweed: clampScore(d.tajweed, 20),
                      style: clampScore(d.style, 5),
                      startStop: clampScore(d.startStop, 5),
                    })
                    const has = rowHasData(d)
                    return (
                      <tr key={st.id} className={cn("border-b border-border/50", idx % 2 ? "bg-navy-50/30 dark:bg-navy-950/30" : "")}>
                        <td className="px-3 py-2 text-xs font-mono text-navy-500">{st.rollNo}</td>
                        <td className="px-3 py-2 text-sm font-semibold text-navy-900 dark:text-white">{st.name}</td>
                        {RECITATION_CRITERIA.map((c) => (
                          <td key={c.key} className="px-2 py-2">
                            <input
                              type="number" min={0} max={c.max} inputMode="numeric"
                              value={d[c.key]}
                              onChange={(e) => updateDraft(st.id, c.key, e.target.value)}
                              className="h-8 w-14 rounded-md border border-input bg-background text-center text-sm focus:outline-none focus:ring-2 focus:ring-gold-500/40"
                            />
                          </td>
                        ))}
                        <td className="px-2 py-2 text-center">
                          <span className={cn("text-sm font-bold", has ? recitationBand(total).color : "text-navy-300")}>{has ? total : "—"}</span>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={d.notes}
                            onChange={(e) => updateDraft(st.id, "notes", e.target.value)}
                            placeholder="e.g. worked on madd elongation"
                            className="h-8 w-full min-w-[160px] rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold-500/40"
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Card>
      )}

      {/* Mobile sticky Save — reachable without scrolling back to the top */}
      {classFilter && tab === "entry" && roster.length > 0 && (
        <div className="sticky bottom-3 z-20 sm:hidden">
          <Button
            onClick={handleSaveAll}
            disabled={saving || tableMissing}
            className="w-full gap-2 bg-gold-500 py-6 text-base font-bold text-navy-950 shadow-lg shadow-black/20 hover:bg-gold-600"
          >
            {saving ? <Loader2 className="size-5 animate-spin" /> : <Save className="size-5" />}
            {saving ? "Saving…" : "Save Session"}
          </Button>
        </div>
      )}

      {/* ── Class report ── */}
      {classFilter && tab === "report" && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-navy-900 dark:text-white">Class average — weekly trend</h3>
                  <p className="text-xs text-navy-400">{classSessions.length} sessions across {classWeekly.length} week{classWeekly.length === 1 ? "" : "s"}</p>
                </div>
              </div>
              <TrendChart points={classWeekly} />
            </Card>

            <Card className="p-5">
              <div className="mb-3">
                <h3 className="text-sm font-bold text-navy-900 dark:text-white">Grade distribution</h3>
                <p className="text-xs text-navy-400">How the class is spread across the 11-tier grade scale</p>
              </div>
              {gradeDistribution.assessed > 0 ? (
                <GradeDistributionChart {...gradeDistribution} />
              ) : (
                <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-navy-400">
                  No assessments recorded yet
                </div>
              )}
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
              <h3 className="text-sm font-bold text-navy-900 dark:text-white">Student progress</h3>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <div className="relative flex-1 sm:flex-none">
                  <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-navy-400" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search student…" className="h-9 w-full pl-8 text-sm sm:w-44" />
                </div>
                <ExportMenu onPdf={() => setPreviewExport("pdf")} onCsv={() => setPreviewExport("csv")} disabled={classSessions.length === 0} />
              </div>
            </div>
            {/* Mobile: tappable progress cards */}
            <div className="divide-y divide-border/60 sm:hidden">
              {filteredReportRows.map((r) => (
                <div key={r.student.id} className="flex items-stretch">
                  <button
                    type="button"
                    disabled={r.count === 0 || downloadingId === r.student.id}
                    aria-label={`Download ${r.student.name}'s recitation report`}
                    title={r.count ? "Download report (PDF)" : "No sessions to report yet"}
                    onClick={() => handleRowPdf(r.student)}
                    className="flex shrink-0 items-center pl-3 pr-1 text-navy-400 transition-colors hover:text-red-500 disabled:opacity-30 disabled:hover:text-navy-400"
                  >
                    {downloadingId === r.student.id ? <Loader2 className="size-5 animate-spin" /> : <Download className="size-5" />}
                  </button>
                  <button
                    onClick={() => setSelectedStudentId(r.student.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 py-4 pl-1 pr-4 text-left transition-colors hover:bg-navy-50 dark:hover:bg-navy-800/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-navy-900 dark:text-white">{r.student.name}</p>
                      <p className="font-mono text-xs text-navy-400">Reg No. {r.student.rollNo}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        <span className="text-navy-500 dark:text-navy-400">{r.count || 0} session{r.count === 1 ? "" : "s"}</span>
                        <span className="text-navy-500 dark:text-navy-400">Avg <span className={cn("font-bold", r.count ? recitationBand(r.avg).color : "text-navy-300")}>{r.count ? r.avg : "—"}</span></span>
                        <span className="text-navy-500 dark:text-navy-400">Latest <span className="font-semibold text-navy-700 dark:text-navy-200">{r.latest ?? "—"}</span></span>
                        <TrendBadge delta={r.delta} />
                      </div>
                      {r.lastNote && <p className="mt-1.5 truncate text-xs italic text-navy-500 dark:text-navy-400">&ldquo;{r.lastNote}&rdquo;</p>}
                    </div>
                    <ChevronRight className="size-5 shrink-0 text-navy-300" />
                  </button>
                </div>
              ))}
            </div>
            {/* Desktop: table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-navy-50 dark:bg-navy-950/40">
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-navy-400">Reg No.</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-navy-400">Student</th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-navy-400">Sessions</th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-navy-400">Avg /{RECITATION_MAX}</th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-navy-400">Latest</th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-navy-400">Week Δ</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-navy-400">Latest note</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filteredReportRows.map((r, idx) => (
                    <tr
                      key={r.student.id}
                      onClick={() => setSelectedStudentId(r.student.id)}
                      className={cn("group cursor-pointer border-b border-border/50 transition-colors hover:bg-navy-50 dark:hover:bg-navy-800/40", idx % 2 ? "bg-navy-50/30 dark:bg-navy-950/30" : "")}
                    >
                      <td className="px-3 py-2.5 font-mono text-xs text-navy-500">{r.student.rollNo}</td>
                      <td className="px-3 py-2.5 text-sm font-semibold text-navy-900 dark:text-white">
                        <span className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={r.count === 0 || downloadingId === r.student.id}
                            title={r.count ? `Download ${r.student.name}'s recitation report (PDF)` : "No sessions to report yet"}
                            aria-label={`Download ${r.student.name}'s recitation report`}
                            onClick={(e) => { e.stopPropagation(); handleRowPdf(r.student) }}
                            className="shrink-0 rounded p-1 text-navy-400 transition-colors hover:bg-navy-100 hover:text-red-500 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-navy-400 dark:hover:bg-navy-800"
                          >
                            {downloadingId === r.student.id ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                          </button>
                          <span className="truncate">{r.student.name}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center text-sm text-navy-600 dark:text-navy-300">{r.count || "—"}</td>
                      <td className="px-3 py-2.5 text-center">
                        {r.count ? <span className={cn("text-sm font-bold", recitationBand(r.avg).color)}>{r.avg}</span> : <span className="text-navy-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center text-sm font-semibold text-navy-700 dark:text-navy-200">{r.latest ?? "—"}</td>
                      <td className="px-3 py-2.5 text-center"><TrendBadge delta={r.delta} /></td>
                      <td className="max-w-[260px] truncate px-3 py-2.5 text-xs text-navy-500 dark:text-navy-400">{r.lastNote || <span className="text-navy-300">—</span>}</td>
                      <td className="px-3 py-2.5 text-right"><ChevronRight className="size-4 text-navy-300 opacity-0 transition-opacity group-hover:opacity-100" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <p className="text-center text-[11px] text-navy-400">
        {role === "admin" ? "Admin" : "Teacher"} · scores feed each student&apos;s weekly progress, visible to parents in their portal.
      </p>

      {/* ── Class report preview — review before download ──────── */}
      <Dialog open={!!previewExport} onOpenChange={(o) => { if (!o) setPreviewExport(null) }}>
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col sm:max-w-4xl">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-navy-900 dark:text-white">
            {previewExport === "pdf" ? <FileText className="size-5 text-red-500" /> : <FileSpreadsheet className="size-5 text-emerald-500" />}
            {previewExport === "pdf" ? "PDF" : "CSV"} Preview — Class Progress Report
          </DialogTitle>
          <DialogDescription className="text-xs">
            {currentClass?.name} · {reportRows.length} student{reportRows.length === 1 ? "" : "s"} · Review before downloading
          </DialogDescription>
          <div className="flex-1 overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-navy-700 text-white">
                <tr>
                  <th className="px-3 py-2 text-left">Reg No.</th>
                  <th className="px-3 py-2 text-left">Student</th>
                  <th className="px-3 py-2 text-center">Sessions</th>
                  <th className="px-3 py-2 text-center">Avg /{RECITATION_MAX}</th>
                  <th className="px-3 py-2 text-center">Latest /{RECITATION_MAX}</th>
                  <th className="px-3 py-2 text-center">Prev /{RECITATION_MAX}</th>
                  <th className="px-3 py-2 text-center">Δ Week</th>
                  <th className="px-3 py-2 text-center">Grade</th>
                  <th className="px-3 py-2 text-left">Latest coaching note</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map((r, i) => (
                  <tr key={r.student.id} className={cn("border-b border-slate-100 dark:border-navy-700/50", i % 2 ? "bg-slate-50/40 dark:bg-navy-800/40" : "")}>
                    <td className="px-3 py-2 font-mono text-navy-500">{r.student.rollNo}</td>
                    <td className="px-3 py-2 font-medium text-navy-900 dark:text-white">{r.student.name}</td>
                    <td className="px-3 py-2 text-center text-navy-600 dark:text-navy-300">{r.count || "—"}</td>
                    <td className="px-3 py-2 text-center font-semibold">{r.count ? r.avg : "—"}</td>
                    <td className="px-3 py-2 text-center">{r.latest ?? "—"}</td>
                    <td className="px-3 py-2 text-center">{r.previous ?? "—"}</td>
                    <td className="px-3 py-2 text-center">{r.delta === null ? "new" : r.delta > 0 ? `+${r.delta}` : r.delta}</td>
                    <td className="px-3 py-2 text-center font-bold">{r.latest !== null ? recitationBand(r.latest).letter : "—"}</td>
                    <td className="max-w-[260px] truncate px-3 py-2 text-navy-500 dark:text-navy-400">
                      {r.lastNote ? <bdi dir="auto" className="font-['Amiri']">{r.lastNote}</bdi> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 pt-2 dark:border-navy-700">
            <Button variant="outline" size="sm" onClick={() => setPreviewExport(null)}>
              <X className="size-4 mr-1" /> Cancel
            </Button>
            <Button
              size="sm"
              className={cn("gap-1.5", previewExport === "pdf" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700")}
              onClick={() => {
                if (previewExport === "pdf") exportClassPdf()
                else exportClassCsv()
                setPreviewExport(null)
              }}
            >
              <Download className="size-4" />
              Download {previewExport === "pdf" ? "PDF" : "CSV"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// SHARED: individual student detail (teacher view + parent portal)
// ════════════════════════════════════════════════════════════════════
function RecitationDetail({
  student, className, courseLabel, sessions, showAssessor, onBack,
}: {
  student: Pick<Student, "id" | "name" | "rollNo">
  className: string
  courseLabel?: string
  sessions: RecitationSession[]
  showAssessor?: boolean
  onBack?: () => void
}) {
  const [previewExport, setPreviewExport] = useState<"pdf" | "csv" | null>(null)
  const ordered = useMemo(() => [...sessions].sort((a, b) => a.date.localeCompare(b.date)), [sessions])
  const weekly = useMemo(() => toWeeklySeries(ordered), [ordered])
  const trend = useMemo(() => weeklyTrend(weekly), [weekly])
  const avg = averageTotal(ordered)
  const best = ordered.reduce((m, s) => Math.max(m, s.total), 0)
  const latest = ordered.length ? ordered[ordered.length - 1] : null

  // ── Per-criterion averages — where the student is strong/weak ──
  const criteriaAvg = useMemo(() => {
    if (!ordered.length) return null
    return RECITATION_CRITERIA.map((c) => ({
      ...c,
      avg: Math.round((ordered.reduce((a, s) => a + (s[c.key] || 0), 0) / ordered.length) * 10) / 10,
    }))
  }, [ordered])

  async function exportPdf() {
    await downloadStudentRecitationPdf({ student, className, courseLabel, sessions: ordered })
  }

  function exportCsv() {
    const header = ["Date", "Pronunciation/20", "Tajweed/20", "Style/5", "StartStop/5", "Total/50", "Percent", "Grade", "Coaching note", ...(showAssessor ? ["Assessed by"] : [])]
    const lines = [header.map(csvCell).join(",")]
    for (const s of ordered) {
      lines.push([
        s.date, s.pronunciation, s.tajweed, s.style, s.startStop, s.total,
        `${recitationPct(s.total)}%`, recitationBand(s.total).letter, s.notes ?? "",
        ...(showAssessor ? [s.assessedBy ?? ""] : []),
      ].map(csvCell).join(","))
    }
    downloadBlob(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }), `Recitation-${student.name.replace(/\s+/g, "_")}-${today()}.csv`)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="flex size-9 items-center justify-center rounded-lg border border-border hover:bg-navy-50 dark:hover:bg-navy-800">
              <ArrowLeft className="size-4 text-navy-500" />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-navy-900 dark:text-white">{student.name}</h1>
            <p className="text-sm text-navy-500 dark:text-navy-400">Reg No. {student.rollNo} · {className} · Quran Recitation</p>
          </div>
        </div>
        <ExportMenu onPdf={() => setPreviewExport("pdf")} onCsv={() => setPreviewExport("csv")} disabled={ordered.length === 0} />
      </div>

      {ordered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <BookOpenCheck className="size-12 text-navy-300 dark:text-navy-600" />
          <p className="text-sm font-semibold text-navy-500">No recitation sessions recorded yet</p>
          <p className="text-xs text-navy-400">Progress will appear here after the first weekly assessment.</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard label="Latest" value={latest ? `${latest.total}` : "—"} sub={`/ ${RECITATION_MAX}`} accent={latest ? recitationBand(latest.total).color : undefined} />
            <SummaryCard label="Average" value={`${avg}`} sub={`/ ${RECITATION_MAX} · ${recitationBand(avg).label}`} />
            <SummaryCard label="Best" value={`${best}`} sub={`/ ${RECITATION_MAX}`} />
            <SummaryCard
              label="Week-on-week"
              value={trend.delta === null ? "New" : `${trend.delta > 0 ? "+" : ""}${trend.delta}`}
              sub={trend.delta === null ? "first week" : "vs last week"}
              accent={trend.delta === null ? undefined : trend.delta > 0 ? "text-emerald-500" : trend.delta < 0 ? "text-red-500" : "text-navy-400"}
            />
          </div>

          {/* Trend chart + rubric breakdown */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-bold text-navy-900 dark:text-white">Weekly progress</h3>
              <TrendChart points={weekly} />
            </Card>

            <Card className="p-5">
              <div className="mb-4">
                <h3 className="text-sm font-bold text-navy-900 dark:text-white">Rubric breakdown</h3>
                <p className="text-xs text-navy-400">Average per criterion across {ordered.length} assessment{ordered.length === 1 ? "" : "s"} — shows where {student.name.split(" ")[0]} is strongest</p>
              </div>
              <div className="space-y-4">
                {criteriaAvg!.map((c) => (
                  <CriterionBar key={c.key} label={c.label} labelAr={c.labelAr} value={c.avg} max={c.max} />
                ))}
              </div>
            </Card>
          </div>

          {/* History table */}
          <Card className="overflow-hidden">
            <div className="border-b border-border px-5 py-3">
              <h3 className="text-sm font-bold text-navy-900 dark:text-white">Session history</h3>
              <p className="text-xs text-navy-400">{ordered.length} assessment{ordered.length === 1 ? "" : "s"}, most recent first</p>
            </div>
            {/* Mobile: one card per session */}
            <div className="divide-y divide-border/60 sm:hidden">
              {[...ordered].reverse().map((s) => {
                const band = recitationBand(s.total)
                return (
                  <div key={s.id} className="p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-navy-900 dark:text-white">{fmtDate(s.date)}</span>
                      <span className={cn("shrink-0 rounded-full px-3 py-1 text-xs font-bold", band.bg, band.color)}>{s.total}/{RECITATION_MAX} · {band.letter}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {RECITATION_CRITERIA.map((c) => (
                        <div key={c.key} className="flex items-center justify-between rounded-lg bg-navy-50 px-3 py-2 dark:bg-navy-950/40">
                          <span className="text-xs leading-tight text-navy-500 dark:text-navy-400">
                            <CriterionLabel en={c.label} ar={c.labelAr} />
                          </span>
                          <span className="whitespace-nowrap text-sm font-bold text-navy-900 dark:text-white">{s[c.key]}<span className="text-[10px] font-normal text-navy-400">/{c.max}</span></span>
                        </div>
                      ))}
                    </div>
                    {s.notes && (
                      <p className="mt-2.5 rounded-lg bg-navy-50 p-2.5 text-xs leading-relaxed text-navy-600 dark:bg-navy-950/40 dark:text-navy-300">
                        <span className="font-semibold text-gold-600 dark:text-gold-500">Note: </span>{s.notes}
                      </p>
                    )}
                    {showAssessor && s.assessedBy && <p className="mt-1.5 text-[11px] text-navy-400">By {s.assessedBy}</p>}
                  </div>
                )
              })}
            </div>
            {/* Desktop: table */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-navy-50 dark:bg-navy-950/40">
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-navy-400">Date</th>
                    {RECITATION_CRITERIA.map((c) => (
                      <th key={c.key} className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-navy-400" title={c.label}>
                        <CriterionLabel en={c.label} ar={c.labelAr} short /> <span className="text-navy-300">/{c.max}</span>
                      </th>
                    ))}
                    <th className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-navy-400">Total</th>
                    <th className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-navy-400">Grade</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-navy-400">Coaching note</th>
                    {showAssessor && <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-navy-400">By</th>}
                  </tr>
                </thead>
                <tbody>
                  {[...ordered].reverse().map((s, idx) => {
                    const band = recitationBand(s.total)
                    return (
                      <tr key={s.id} className={cn("border-b border-border/50", idx % 2 ? "bg-navy-50/30 dark:bg-navy-950/30" : "")}>
                        <td className="px-3 py-2.5 text-sm font-medium text-navy-900 dark:text-white">{fmtDate(s.date)}</td>
                        <td className="px-2 py-2.5 text-center text-sm text-navy-600 dark:text-navy-300">{s.pronunciation}</td>
                        <td className="px-2 py-2.5 text-center text-sm text-navy-600 dark:text-navy-300">{s.tajweed}</td>
                        <td className="px-2 py-2.5 text-center text-sm text-navy-600 dark:text-navy-300">{s.style}</td>
                        <td className="px-2 py-2.5 text-center text-sm text-navy-600 dark:text-navy-300">{s.startStop}</td>
                        <td className={cn("px-2 py-2.5 text-center text-sm font-bold", band.color)}>{s.total}</td>
                        <td className="px-2 py-2.5 text-center"><span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", band.bg, band.color)}>{band.letter}</span></td>
                        <td className="max-w-[260px] px-3 py-2.5 text-xs text-navy-500 dark:text-navy-400">{s.notes || <span className="text-navy-300">—</span>}</td>
                        {showAssessor && <td className="px-3 py-2.5 text-xs text-navy-500 dark:text-navy-400">{s.assessedBy || "—"}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* ── Student report preview — review before download ────── */}
      <Dialog open={!!previewExport} onOpenChange={(o) => { if (!o) setPreviewExport(null) }}>
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col sm:max-w-3xl">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-navy-900 dark:text-white">
            {previewExport === "pdf" ? <FileText className="size-5 text-red-500" /> : <FileSpreadsheet className="size-5 text-emerald-500" />}
            {previewExport === "pdf" ? "PDF" : "CSV"} Preview — {student.name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {className} · {ordered.length} session{ordered.length === 1 ? "" : "s"} · Review before downloading
          </DialogDescription>
          <div className="flex-1 overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-navy-700 text-white">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-center">Pron /20</th>
                  <th className="px-3 py-2 text-center">Tajweed /20</th>
                  <th className="px-3 py-2 text-center">Style /5</th>
                  <th className="px-3 py-2 text-center">Start/Stop /5</th>
                  <th className="px-3 py-2 text-center">Total /{RECITATION_MAX}</th>
                  <th className="px-3 py-2 text-center">Grade</th>
                  <th className="px-3 py-2 text-left">Coaching note</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((s, i) => (
                  <tr key={s.id} className={cn("border-b border-slate-100 dark:border-navy-700/50", i % 2 ? "bg-slate-50/40 dark:bg-navy-800/40" : "")}>
                    <td className="px-3 py-2 text-navy-600 dark:text-navy-300">{fmtDate(s.date)}</td>
                    <td className="px-3 py-2 text-center">{s.pronunciation}</td>
                    <td className="px-3 py-2 text-center">{s.tajweed}</td>
                    <td className="px-3 py-2 text-center">{s.style}</td>
                    <td className="px-3 py-2 text-center">{s.startStop}</td>
                    <td className="px-3 py-2 text-center font-semibold">{s.total}</td>
                    <td className="px-3 py-2 text-center font-bold" style={{ color: gradeHexColor(recitationBand(s.total).letter) }}>{recitationBand(s.total).letter}</td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-navy-500 dark:text-navy-400">
                      {s.notes ? <bdi dir="auto" className="font-['Amiri']">{s.notes}</bdi> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 pt-2 dark:border-navy-700">
            <Button variant="outline" size="sm" onClick={() => setPreviewExport(null)}>
              <X className="size-4 mr-1" /> Cancel
            </Button>
            <Button
              size="sm"
              className={cn("gap-1.5", previewExport === "pdf" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700")}
              onClick={() => {
                if (previewExport === "pdf") exportPdf()
                else exportCsv()
                setPreviewExport(null)
              }}
            >
              <Download className="size-4" />
              Download {previewExport === "pdf" ? "PDF" : "CSV"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400">{label}</p>
      <p className={cn("mt-1 text-2xl font-extrabold", accent ?? "text-navy-900 dark:text-white")}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-navy-400">{sub}</p>}
    </Card>
  )
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// ════════════════════════════════════════════════════════════════════
// STUDENT / PARENT PORTAL VIEW (read-only, own child only)
// ════════════════════════════════════════════════════════════════════
function StudentRecitationView({ studentId, fallbackName }: { studentId: string; fallbackName: string }) {
  const [sessions, setSessions] = useState<RecitationSession[]>([])
  const [student, setStudent] = useState<Pick<Student, "id" | "name" | "rollNo"> | null>(null)
  const [className, setClassName] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const ready = await db.checkSupabase()
      if (!ready) { setLoading(false); return }
      const [sessRes, students] = await Promise.all([
        db.fetchRecitationSessionsForStudent(studentId),
        db.fetchStudentsByIds([studentId]),
      ])
      if (sessRes.error !== "TABLE_MISSING") setSessions(sessRes.data)
      const st = students[0]
      if (st) setStudent({ id: st.id, name: st.name, rollNo: st.rollNo })
      // Resolve class name from the loaded courses tree (lightweight)
      const courses = await db.fetchCoursesFromDB()
      const all = courses.flatMap((c) => c.classes)
      const myClass = all.find((c) => c.students.some((s) => s.id === studentId))
      if (myClass) setClassName(myClass.name)
      setLoading(false)
    }
    load()
  }, [studentId])

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="size-8 animate-spin text-gold-500" /></div>
  }

  return (
    <RecitationDetail
      student={student ?? { id: studentId, name: fallbackName, rollNo: studentId }}
      className={className || "—"}
      sessions={sessions}
      showAssessor={false}
    />
  )
}
