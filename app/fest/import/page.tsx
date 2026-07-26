"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { workbookToMatrix } from "@/lib/fest/import-fest-xlsx"
import { parseFestWorkbook, type ParsedWorkbook } from "@/lib/fest/import-fest-excel"
import { applyFestImport, type ApplyResult, type ReviewResolution } from "@/lib/fest/import-fest-apply"
import { FEST_ITEM_CATALOG } from "@/lib/fest/items"
import { FEST_COURSES, courseTitle } from "@/lib/fest/courses"

interface EditionOpt { id: string; name: string; courseId: string | null; academicYear: string | null }

const SKIP = "__skip__"

export default function FestImportPage() {
  const [editions, setEditions] = useState<EditionOpt[]>([])
  const [courseId, setCourseId] = useState<string>("")
  const [currentYear, setCurrentYear] = useState<string>("")
  const [fileName, setFileName] = useState<string>("")
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null)
  const [resolution, setResolution] = useState<ReviewResolution>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)

  useEffect(() => {
    supabase
      .from("fest_editions")
      .select("id,name,course_id,academic_year")
      .neq("status", "archived")
      .order("academic_year", { ascending: false })
      .then(({ data }) => {
        const opts = ((data ?? []) as Array<{ id: string; name: string; course_id: string | null; academic_year: string | null }>)
          .map((e) => ({ id: e.id, name: e.name, courseId: e.course_id, academicYear: e.academic_year }))
        setEditions(opts)
        setCourseId((cur) => cur || FEST_COURSES.find((c) => opts.some((e) => e.courseId === c.id))?.id || "")
      })
    supabase.from("app_settings").select("value").eq("key", "fest_current_academic_year").maybeSingle()
      .then(({ data }) => setCurrentYear((data as { value: string } | null)?.value ?? ""))
  }, [])

  // Courses that have a fest, and the current-year edition we import into.
  const courseOpts = useMemo(
    () => FEST_COURSES.filter((c) => editions.some((e) => e.courseId === c.id)),
    [editions],
  )
  const targetEdition = useMemo(() => {
    const forCourse = editions.filter((e) => e.courseId === courseId)
    return forCourse.find((e) => e.academicYear === currentYear)
      ?? forCourse.sort((a, b) => (b.academicYear ?? "").localeCompare(a.academicYear ?? ""))[0]
  }, [editions, courseId, currentYear])
  const editionId = targetEdition?.id ?? ""

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(null)
    setFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      const wb = parseFestWorkbook(workbookToMatrix(buf))
      setParsed(wb)
      // pre-seed review resolutions with the parser's best guess
      const seed: ReviewResolution = {}
      for (const r of wb.review) seed[r.raw.toLowerCase().trim()] = r.suggestion
      setResolution(seed)
    } catch (err) {
      toast.error(`Could not read file: ${(err as Error).message}`)
    }
  }

  async function onImport() {
    if (!parsed || !editionId) return
    setBusy(true)
    try {
      const res = await applyFestImport(supabase, editionId, parsed, resolution, courseId)
      setResult(res)
      if (res.skippedWrongCourse > 0) {
        toast.warning(`Imported ${res.studentsUpserted} into ${courseTitle(courseId)} · ${res.skippedWrongCourse} skipped (belong to another course)`)
      } else {
        toast.success(`Imported ${res.studentsUpserted} students into ${courseTitle(courseId)}`)
      }
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const summary = parsed?.summary
  const reviewRows = parsed?.review ?? []
  const catalogNames = useMemo(() => FEST_ITEM_CATALOG.map((i) => i.name), [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/fest" className="text-navy-500 hover:text-navy-700 dark:text-navy-400">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-navy-800 dark:text-white">Excel Import</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · Choose course &amp; file</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="w-full min-w-0 sm:w-64">
            <label className="mb-1 block text-xs font-medium text-navy-600 dark:text-navy-300">Course</label>
            <Select value={courseId} onValueChange={(v) => setCourseId(v ?? "")}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Course">{(v: string) => courseOpts.find((c) => c.id === v)?.title ?? "Course"}</SelectValue></SelectTrigger>
              <SelectContent>
                {courseOpts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-navy-500">
              Imports into {currentYear || "the current year"}. Students who belong to another course are skipped.
            </p>
          </div>
          <div className="w-full sm:flex-1">
            <label className="mb-1 block text-xs font-medium text-navy-600 dark:text-navy-300">Roster workbook (.xlsx)</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-navy-600 hover:border-gold-400 dark:text-navy-300">
              <FileSpreadsheet className="size-4 text-gold-500" />
              <span className="truncate">{fileName || "Select READ FEST .xlsx…"}</span>
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
            </label>
          </div>
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2 · Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              <Stat label="Sections" value={summary.sections} />
              <Stat label="Students" value={summary.students} />
              <Stat label="Registrations" value={summary.registrations} />
              <Stat label="Exact" value={summary.matchedExact} tone="ok" />
              <Stat label="Fuzzy" value={summary.matchedFuzzy} tone={summary.matchedFuzzy ? "warn" : undefined} />
              <Stat label="Needs review" value={summary.ambiguous + summary.unknown} tone={summary.ambiguous + summary.unknown ? "warn" : "ok"} />
            </div>
            {summary.duplicateRegNos.length > 0 && (
              <p className="flex items-center gap-2 text-sm text-amber-600">
                <AlertTriangle className="size-4" />
                Duplicate reg numbers: {summary.duplicateRegNos.join(", ")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {reviewRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3 · Resolve unmatched items ({reviewRows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Section</TableHead>
                    <TableHead>Reg</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Raw cell</TableHead>
                    <TableHead>Map to</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviewRows.map((r, i) => {
                    const key = r.raw.toLowerCase().trim()
                    const val = resolution[key] ?? SKIP
                    return (
                      <TableRow key={`${key}-${i}`}>
                        <TableCell>{r.section}</TableCell>
                        <TableCell>{r.regNo}</TableCell>
                        <TableCell className="max-w-[160px] truncate">{r.studentName}</TableCell>
                        <TableCell>
                          <span className="font-mono">{r.raw}</span>{" "}
                          <Badge variant="outline" className="ml-1 text-[10px]">{r.confidence}</Badge>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={val}
                            onValueChange={(v) =>
                              setResolution((prev) => ({ ...prev, [key]: v === SKIP ? null : v }))
                            }
                          >
                            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={SKIP}>— Skip —</SelectItem>
                              {catalogNames.map((n) => (
                                <SelectItem key={n} value={n}>{n}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {parsed && (
        <div className="flex items-center gap-3">
          <Button onClick={onImport} disabled={busy || !editionId}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Import into {courseTitle(courseId)}
          </Button>
          {result && (
            <span className="text-sm text-emerald-600">
              {result.studentsUpserted} students · {result.itemsCreated} new items ·{" "}
              {result.registrationsInserted} registrations
              {result.registrationsSkipped ? ` · ${result.registrationsSkipped} dup skipped` : ""}
              {result.skippedWrongCourse ? <span className="text-amber-600"> · {result.skippedWrongCourse} wrong-course skipped</span> : ""}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  const color =
    tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-navy-800 dark:text-white"
  return (
    <div className="rounded-md border border-border/60 bg-white/50 p-3 dark:bg-navy-900/40">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-navy-500">{label}</div>
    </div>
  )
}
