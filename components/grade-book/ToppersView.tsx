"use client"

// ╔══════════════════════════════════════════════════════════════════╗
// ║ ToppersView — live preview + export of the class Toppers poster   ║
// ║                                                                  ║
// ║ Renders the rank 1-2-3 (or top-N) poster for one exam/class,     ║
// ║ matching the Ihlamudheen Madrasa branded reference design, with Download   ║
// ║ PNG + Print. Resolves the same enrolled ∪ attendance roster the  ║
// ║ marks-entry view uses, so every student with marks is ranked.    ║
// ╚══════════════════════════════════════════════════════════════════╝

import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, ChevronRight, Download, Printer, Trophy, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import * as db from "@/lib/db"
import type { Student } from "@/data/courses"
import { fetchLogoDataUrl } from "@/lib/branding"
import { toast } from "sonner"
import {
  computeToppers,
  resolveTopperPhotos,
  buildToppersSVG,
  svgToPngDataUrl,
} from "@/lib/toppers"

const TOP_N_OPTIONS = [3, 5, 10] as const

function slug(s: string) {
  return s.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "").toLowerCase()
}

export default function ToppersView({
  exam,
  cls,
  examTitle,
  academicYear,
  onBack,
}: {
  exam: db.GradeBookExam
  cls: { id: string; name: string; students: Student[] } | undefined
  examTitle: string
  academicYear: string
  onBack: () => void
}) {
  const [attendanceStudents, setAttendanceStudents] = useState<Student[]>([])
  const [loadingStudents, setLoadingStudents] = useState(true)
  const [topN, setTopN] = useState<number>(3)
  const [svg, setSvg] = useState<string>("")
  const [building, setBuilding] = useState(true)
  const [exporting, setExporting] = useState(false)

  // ── Roster: enrolled ∪ attendance, deduped ──
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingStudents(true)
      const att = await db.fetchStudentsFromAttendance(exam.classId)
      if (!cancelled) {
        setAttendanceStudents(att)
        setLoadingStudents(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [exam.classId])

  const students = useMemo<Student[]>(() => {
    const map = new Map<string, Student>((cls?.students ?? []).map((s) => [s.id, s]))
    attendanceStudents.forEach((s) => { if (!map.has(s.id)) map.set(s.id, s) })
    return Array.from(map.values())
  }, [cls, attendanceStudents])

  const toppers = useMemo(() => computeToppers(exam, students, topN), [exam, students, topN])

  // ── Build the poster whenever inputs change ──
  useEffect(() => {
    let cancelled = false
    async function build() {
      if (loadingStudents) return
      if (toppers.length === 0) { setSvg(""); setBuilding(false); return }
      setBuilding(true)
      const [photos, logo] = await Promise.all([
        resolveTopperPhotos(toppers),
        fetchLogoDataUrl(),
      ])
      if (cancelled) return
      const markup = buildToppersSVG({
        classLabel: cls?.name ?? "",
        examTitle,
        academicYear,
        toppers,
        photos,
        logoDataUri: logo,
      })
      if (!cancelled) { setSvg(markup); setBuilding(false) }
    }
    build()
    return () => { cancelled = true }
  }, [toppers, loadingStudents, cls, examTitle, academicYear])

  async function handleDownloadPng() {
    if (!svg) return
    setExporting(true)
    try {
      const png = await svgToPngDataUrl(svg)
      const a = document.createElement("a")
      a.href = png
      a.download = `toppers-${slug(cls?.name ?? "class")}-${slug(examTitle)}-${academicYear}.png`
      a.click()
      toast.success("Poster downloaded")
    } catch (e) {
      console.error(e)
      toast.error("Could not export the poster image")
    } finally {
      setExporting(false)
    }
  }

  async function handlePrint() {
    if (!svg) return
    setExporting(true)
    try {
      const png = await svgToPngDataUrl(svg)
      const w = window.open("", "_blank")
      if (!w) { toast.error("Allow pop-ups to print"); return }
      w.document.write(
        `<html><head><title>Toppers — ${cls?.name ?? ""}</title>
         <style>@page{size:A4;margin:0}html,body{margin:0;padding:0}
         img{width:100%;height:auto;display:block}</style></head>
         <body><img src="${png}" onload="setTimeout(()=>{window.print()},150)"/></body></html>`,
      )
      w.document.close()
    } catch (e) {
      console.error(e)
      toast.error("Could not prepare the poster for printing")
    } finally {
      setExporting(false)
    }
  }

  const noMarks = !loadingStudents && !building && toppers.length === 0

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-navy-400">
        <button onClick={onBack} className="hover:text-navy-700 dark:hover:text-navy-200 transition-colors">Grade Book</button>
        <ChevronRight className="size-3" />
        <span className="text-navy-700 dark:text-navy-200 font-medium">{exam.examName}</span>
        <ChevronRight className="size-3" />
        <span className="text-gold-500 font-semibold">Toppers</span>
      </div>

      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="text-[11px] font-semibold text-gold-500 uppercase tracking-[0.09em] mb-1 flex items-center gap-1.5">
            <Trophy className="size-3.5" /> Toppers
          </p>
          <h1 className="text-2xl font-extrabold text-navy-900 dark:text-white tracking-tight">{cls?.name ?? "—"}</h1>
          <p className="text-sm text-navy-500 dark:text-navy-400 mt-1">
            {examTitle} · {academicYear} · {toppers.length} ranked
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={onBack} size="sm">
            <ArrowLeft className="size-4 mr-1.5" /> Back
          </Button>
          {/* Top-N selector */}
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            {TOP_N_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setTopN(n)}
                className={
                  "px-3 py-1.5 text-xs font-semibold transition-colors " +
                  (topN === n
                    ? "bg-navy-900 text-white dark:bg-white dark:text-navy-900"
                    : "text-navy-500 hover:bg-navy-100 dark:hover:bg-navy-800")
                }
              >
                Top {n}
              </button>
            ))}
          </div>
          <Button variant="outline" onClick={handlePrint} size="sm" disabled={!svg || exporting}>
            <Printer className="size-4 mr-1.5" /> Print
          </Button>
          <Button
            onClick={handleDownloadPng}
            size="sm"
            disabled={!svg || exporting}
            className="bg-gold-500 hover:bg-gold-600 text-navy-950 font-semibold gap-1.5"
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Download PNG
          </Button>
        </div>
      </div>

      {/* Poster preview */}
      <Card className="p-4 sm:p-6 flex justify-center bg-navy-50/40 dark:bg-navy-950/40">
        {loadingStudents || building ? (
          <div className="flex flex-col items-center gap-3 py-24 text-navy-400">
            <Loader2 className="size-8 animate-spin text-gold-500" />
            <p className="text-sm">Building poster…</p>
          </div>
        ) : noMarks ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <div className="size-14 rounded-2xl bg-navy-100 dark:bg-navy-800 flex items-center justify-center">
              <Trophy className="size-6 text-navy-400" />
            </div>
            <p className="text-sm font-semibold text-navy-500 dark:text-navy-400">No marks entered yet</p>
            <p className="text-xs text-navy-400 max-w-xs">
              Enter exam marks for this class first — the toppers poster ranks students by total score.
            </p>
          </div>
        ) : (
          <div
            className="w-full max-w-[560px] [&_svg]:w-full [&_svg]:h-auto [&_svg]:rounded-lg [&_svg]:shadow-xl"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </Card>
    </div>
  )
}
