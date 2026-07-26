"use client"

import { useState, useEffect, useCallback } from "react"
import {
  ClipboardList, Loader2, FileDown, ChevronLeft, CheckCircle2, XCircle,
  Wallet, Film, Megaphone, Users, Clock,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import * as db from "@/lib/db"
import type { ClassData, AttendanceRecord } from "@/data/courses"
import { initialTeachers } from "@/data/courses"
import { toast } from "sonner"
import { formatIsoDate, formatDateTime } from "@/lib/date-format"

// The four institute courses (exact ids/titles from src/data/courses.ts).
const COURSES: { id: string; title: string }[] = [
  { id: "4", title: "Ihlamudheen Madrasa" },
  { id: "1", title: "Ihlamudheen Madrasa" },
  { id: "2", title: "Ihlamudheen Madrasa" },
  { id: "3", title: "CIBIS CERTIFICATION" },
]
const courseTitle = (id: string) => COURSES.find((c) => c.id === id)?.title || `Course ${id}`

// ── Scheduling + lateness helpers (mirror the Office Routine form page; kept in
//    sync via a shared follow-up — see consolidation task). Used to scope the
//    report to the day's actual schedule and to flag late staff. ──
const COURSE_DAYS: Record<string, number[]> = { "4": [1, 2, 3, 4, 5], "1": [6, 0], "2": [5], "3": [5] }
const DAY_TOKENS: [string, number][] = [
  ["sunday", 0], ["monday", 1], ["tuesday", 2], ["wednesday", 3],
  ["thursday", 4], ["friday", 5], ["saturday", 6],
]
const dowOf = (dateStr: string) => new Date(dateStr + "T12:00:00").getDay()
const courseRunsOn = (courseId: string, dow: number) => (COURSE_DAYS[courseId] || []).includes(dow)
function classMeetsOn(courseId: string, schedule: string, dow: number): boolean {
  if (courseId === "4") return dow >= 1 && dow <= 5
  const sched = (schedule || "").toLowerCase()
  const named = DAY_TOKENS.filter(([n]) => sched.includes(n)).map(([, d]) => d)
  if (named.length) return named.includes(dow)
  return courseRunsOn(courseId, dow)
}
function weekStartOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00"); const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day); return d.toISOString().split("T")[0]
}
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + days); return d.toISOString().split("T")[0]
}
function staffLateCategory(arrivalTime?: string): number | null {
  if (!arrivalTime) return null
  const [h, m] = arrivalTime.split(":").map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  const mins = h * 60 + m
  if (mins < 8 * 60 + 55) return null
  if (mins <= 8 * 60 + 59) return 1
  if (mins <= 9 * 60 + 5) return 2
  if (mins <= 9 * 60 + 16) return 3
  return null
}
const staffNameById: Record<string, string> = Object.fromEntries(initialTeachers.map((t) => [t.id, t.name]))

export default function OfficeRoutineReportsPage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  // Reviewing submitted routine reports is an admin-only function. Office staff
  // (accountants) fill in the daily routine but do not review the report log.
  const allowed = role === "admin"

  const [loading, setLoading] = useState(true)
  const [reports, setReports] = useState<db.OfficeReportSummary[]>([])
  const [classNameMap, setClassNameMap] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<db.OfficeDailyReport | null>(null)
  const [opening, setOpening] = useState(false)

  const load = useCallback(async () => {
    if (!user || !allowed) return
    setLoading(true)
    const [list, perCourse] = await Promise.all([
      db.fetchOfficeReports(),
      Promise.all(COURSES.map((c) => db.fetchClasses(c.id))),
    ])
    setReports(list)
    const map: Record<string, string> = {}
    perCourse.flat().forEach((cl: ClassData) => { map[cl.id] = cl.name })
    setClassNameMap(map)
    setLoading(false)
  }, [user, allowed])

  useEffect(() => { load() }, [load])

  const open = async (id: string) => {
    setOpening(true)
    const full = await db.fetchOfficeReportById(id)
    setOpening(false)
    if (!full) { toast.error("Could not load that report."); return }
    setSelected(full)
  }

  const className = (id: string) => classNameMap[id] || id

  const exportPdf = async (r: db.OfficeDailyReport) => {
    setOpening(true)
    // The saved report holds finance/duties/reels/boost/assignments + the student
    // late/absent follow-up. Staff punches, the day's attendance and the week's
    // lesson plans are NOT stored, so fetch them live for this report's date.
    const dow = dowOf(r.reportDate)
    const wkStart = weekStartOf(r.reportDate)
    const perCourse = await Promise.all(COURSES.map(async (c) => (await db.fetchClasses(c.id)).map((cl) => ({ ...cl, courseId: c.id }))))
    const allClasses = perCourse.flat()
    const [punches, attByClass, lessonPlans, ledger] = await Promise.all([
      db.fetchStaffPunchesForDate(r.reportDate),
      db.fetchAllClassesAttendanceForMonth(allClasses.map((c) => c.id), r.reportDate.slice(0, 7)),
      db.fetchLessonPlanSubmissions(wkStart, addDays(wkStart, 6)),
      db.fetchOfficeFinanceLedger(r.reportDate),
    ])
    setOpening(false)

    // Resolve each class's attendance record for this exact date.
    const recOf = (classId: string): AttendanceRecord | undefined =>
      (attByClass[classId] || []).find((rec) => (rec.date || "").split("T")[0] === r.reportDate)
    const scheduledClasses = allClasses.filter((c) => classMeetsOn(c.courseId, c.schedule, dow))
    let present = 0, lateCount = 0, absentCount = 0
    for (const c of allClasses) {
      const rec = recOf(c.id)
      if (!rec) continue
      for (const st of Object.values(rec.records)) {
        if (st === "present") present++
        else if (st === "late") lateCount++
        else if (st === "absent") absentCount++
      }
    }

    const { default: jsPDF } = await import("jspdf")
    const autoTable = (await import("jspdf-autotable")).default
    const { addReportHeader } = await import("@/lib/branding")
    const doc = new jsPDF()
    let y = await addReportHeader(doc, "Daily Office Routine — Report", `Date: ${formatIsoDate(r.reportDate)}  ·  Status: ${r.status}`)
    const NAVY: [number, number, number] = [30, 58, 95]
    const RED: [number, number, number] = [200, 30, 30]
    const next = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

    // 1) Staff punch in/out, with late arrivals flagged red + category.
    const punchRows = punches.map((p) => {
      const cat = staffLateCategory(p.arrivalTime)
      const late = cat !== null || p.status === "late"
      const inText = !p.arrivalTime ? "—" : cat !== null ? `${p.arrivalTime}  (Late · Cat ${cat})` : late ? `${p.arrivalTime}  (Late)` : p.arrivalTime
      return { late, cells: [staffNameById[p.teacherId] || p.teacherId, p.session, inText, p.departureTime || "—"] }
    })
    autoTable(doc, {
      startY: y, head: [["Staff punch — Name", "Session", "In", "Out"]],
      body: punchRows.length ? punchRows.map((x) => x.cells) : [["—", "—", "No punches recorded", "—"]],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
      didParseCell: (d) => {
        if (d.section === "body" && d.column.index === 2 && punchRows[d.row.index]?.late) {
          d.cell.styles.textColor = RED; d.cell.styles.fontStyle = "bold"
        }
      },
    })
    y = next()

    // 2) Student attendance summary. Any classes scheduled that day whose
    //    attendance was not marked (or only partially marked) are listed inline,
    //    right under the "Classes marked" tally in red — no separate table.
    const unmarked = scheduledClasses.filter((c) => !recOf(c.id))
    const attnSummary: string[][] = [
      ["Present", String(present)],
      ["Late", String(lateCount)],
      ["Absent", String(absentCount)],
      ["Classes marked", `${scheduledClasses.filter((c) => recOf(c.id)).length} / ${scheduledClasses.length}`],
      ...unmarked.map((c) => [`Not marked — ${c.name} · ${courseTitle(c.courseId)}`, "—"]),
    ]
    autoTable(doc, {
      startY: y, head: [["Student attendance", "Count"]],
      body: attnSummary,
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
      didParseCell: (d) => {
        // Rows after the four summary rows are the unmarked-class lines.
        if (d.section === "body" && d.row.index >= 4) {
          d.cell.styles.textColor = RED
        }
      },
    })
    y = next()

    // 4) Late/absent follow-up (from the saved report).
    const attBody: string[][] = []
    for (const row of r.attendance) {
      for (const s of row.lateStudents) attBody.push([className(row.classId), "Late", s.name, s.reason || "—"])
      for (const s of row.absentStudents) attBody.push([className(row.classId), "Absent", s.name, s.reason || "—"])
    }
    autoTable(doc, {
      startY: y, head: [["Attendance follow-up — Class", "Type", "Student", "Reason"]],
      body: attBody.length ? attBody : [["—", "—", "No late/absent follow-up recorded", "—"]],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
    })
    y = next()

    // 5) Finance — shared daily ledger (with who recorded each entry).
    const income = ledger.filter((f) => f.type === "income").reduce((s, f) => s + f.amount, 0)
    const expense = ledger.filter((f) => f.type === "expense").reduce((s, f) => s + f.amount, 0)
    autoTable(doc, {
      startY: y, head: [["Finance — Type", "Amount (AED)", "Category", "Remarks", "Added by"]],
      body: [
        ...ledger.map((f) => [f.type, f.amount.toFixed(2), f.category || "—", f.remarks || "—", f.createdByName || "—"]),
        ["Income total", income.toFixed(2), "", "", ""],
        ["Expenditure total", expense.toFixed(2), "", "", ""],
        ["Net", (income - expense).toFixed(2), "", "", ""],
      ],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
    })
    y = next()

    // 6) Course duties — only courses that ran that day.
    const dutyRows: string[][] = []
    COURSES.filter((c) => courseRunsOn(c.id, dow)).forEach((c) => {
      const items = r.duties.filter((d) => d.courseId === c.id)
      if (!items.length) { dutyRows.push([c.title, "No duties listed", "—", "—"]); return }
      items.forEach((d) => dutyRows.push([c.title, d.dutyLabel || "—", d.isDone ? "Yes" : "No", d.remarks || "—"]))
    })
    autoTable(doc, {
      startY: y, head: [["Course duties (scheduled day) — Course", "Duty", "Done", "Remarks"]],
      body: dutyRows.length ? dutyRows : [["—", "No courses scheduled this day", "—", "—"]],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
    })
    y = next()

    // 7) Marketing.
    const reelsDone = r.reels.filter((x) => x.isPrepared).length
    autoTable(doc, {
      startY: y, head: [["Marketing (this week)", "Status"]],
      body: [
        ["Reels prepared", `${reelsDone} / ${r.reels.length || 3}`],
        ["Reel boosted", r.boost?.isBoosted ? "Yes" : "No"],
        ["Boost link", r.boost?.instagramUrl || "—"],
      ],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
    })
    y = next()

    // 8) Lesson plan / PPT follow-up — per course, for the report's week.
    const lpRows: string[][] = []
    COURSES.forEach((c) => {
      const subs = lessonPlans.filter((s) => s.courseId === c.id)
      if (!subs.length) { lpRows.push([c.title, "No submissions this week", "—", "—", "—"]); return }
      subs.forEach((s) => lpRows.push([
        c.title,
        s.teacherName || s.teacherEmail || "—",
        (s.lessonPlanName || s.lessonPlanUrl || s.lessonPlanPath) ? "Yes" : "No",
        (s.pptName || s.pptUrl || s.pptPath) ? "Yes" : "No",
        `${s.subject}${s.grade ? ` (${s.grade})` : ""}`,
      ]))
    })
    autoTable(doc, {
      startY: y, head: [[`Lesson plan / PPT — week of ${wkStart} · Course`, "Teacher", "Plan", "PPT", "Subject"]],
      body: lpRows, headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
    })
    y = next()

    // 9) Assignments (from the saved report).
    autoTable(doc, {
      startY: y, head: [["Assignment forwarded — Class", "Forwarded", "Remarks"]],
      body: r.assignments.length
        ? r.assignments.map((a) => [className(a.classId), a.assignmentForwarded ? "Yes" : "No", a.remarks || "—"])
        : [["—", "No assignment follow-up recorded", "—"]],
      headStyles: { fillColor: NAVY }, styles: { fontSize: 8 },
    })

    doc.save(`office-routine-${r.reportDate}.pdf`)
  }

  if (!user) return null
  if (!allowed) {
    return (
      <div className="p-6">
        <Card><CardContent className="p-8 text-center text-navy-300">
          This page is restricted to the admin role.
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2 truncate min-w-0">
          <ClipboardList className="h-6 w-6 shrink-0 text-emerald-500" /> Office Routine Reports
        </h1>
        {selected && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back to list
            </Button>
            <Button size="sm" onClick={() => exportPdf(selected)}><FileDown className="h-4 w-4 mr-1" /> PDF</Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-navy-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : selected ? (
        <ReportDetail report={selected} className={className} />
      ) : (
        <Card><CardContent className="p-4">
          {reports.length === 0 ? (
            <p className="text-sm text-navy-400 py-6 text-center">No office routine reports have been submitted yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-navy-300">
                  <th className="py-2 pr-3">Date</th><th className="pr-3">Status</th>
                  <th className="pr-3">Submitted</th><th className="pr-3"></th>
                </tr></thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id} className="border-t border-navy-700/40">
                      <td className="py-2 pr-3 font-medium">{formatIsoDate(r.reportDate)}</td>
                      <td className="pr-3"><Badge variant="outline">{r.status}</Badge></td>
                      <td className="pr-3 text-navy-300">{r.submittedAt ? formatDateTime(r.submittedAt) : "—"}</td>
                      <td className="pr-3">
                        <Button size="sm" variant="outline" disabled={opening} onClick={() => open(r.id)}>Open</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent></Card>
      )}
    </div>
  )
}

function ReportDetail({ report, className }: { report: db.OfficeDailyReport; className: (id: string) => string }) {
  // Finance is the institute-wide shared ledger for that date (not stored on the
  // per-staff report), so load it for the report's date.
  const [ledger, setLedger] = useState<db.OfficeFinanceLedgerEntry[]>([])
  useEffect(() => { db.fetchOfficeFinanceLedger(report.reportDate).then(setLedger) }, [report.reportDate])
  const income = ledger.filter((f) => f.type === "income").reduce((s, f) => s + f.amount, 0)
  const expense = ledger.filter((f) => f.type === "expense").reduce((s, f) => s + f.amount, 0)
  const reelsDone = report.reels.filter((r) => r.isPrepared).length
  const dutiesByCourse = COURSES.map((c) => ({ course: c, items: report.duties.filter((d) => d.courseId === c.id) }))
    .filter((g) => g.items.length)

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="font-semibold text-base">{formatIsoDate(report.reportDate)}</span>
          <span className="text-navy-300">Status: <Badge variant="outline">{report.status}</Badge></span>
          {report.submittedAt && <span className="text-navy-300">Submitted: {formatDateTime(report.submittedAt)}</span>}
        </div>
      </CardContent></Card>

      {/* Attendance follow-up */}
      <Section title="Attendance follow-up" icon={<Clock className="h-4 w-4" />}>
        {report.attendance.every((r) => r.lateStudents.length === 0 && r.absentStudents.length === 0) ? (
          <p className="text-sm text-navy-400">No late / absent follow-up recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-navy-300"><th className="py-2 pr-3">Class</th><th className="pr-3">Type</th><th className="pr-3">Student</th><th className="pr-3">Reason</th></tr></thead>
              <tbody>
                {report.attendance.flatMap((row) => [
                  ...row.lateStudents.map((s, i) => (
                    <tr key={`l-${row.classId}-${i}`} className="border-t border-navy-700/40">
                      <td className="py-2 pr-3">{className(row.classId)}</td><td className="pr-3 text-amber-300">Late</td>
                      <td className="pr-3">{s.name}</td><td className="pr-3 text-navy-200">{s.reason || "—"}</td>
                    </tr>
                  )),
                  ...row.absentStudents.map((s, i) => (
                    <tr key={`a-${row.classId}-${i}`} className="border-t border-navy-700/40">
                      <td className="py-2 pr-3">{className(row.classId)}</td><td className="pr-3 text-red-400">Absent</td>
                      <td className="pr-3">{s.name}</td><td className="pr-3 text-navy-200">{s.reason || "—"}</td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Finance — shared daily ledger */}
      <Section title="Income & expenditure (shared daily ledger)" icon={<Wallet className="h-4 w-4" />}>
        {ledger.length === 0 ? (
          <p className="text-sm text-navy-400">No finance entries recorded for {formatIsoDate(report.reportDate)}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-navy-300"><th className="py-2 pr-3">Type</th><th className="pr-3">Amount (AED)</th><th className="pr-3">Category</th><th className="pr-3">Remarks</th><th className="pr-3">Added by</th></tr></thead>
              <tbody>
                {ledger.map((f) => (
                  <tr key={f.id} className="border-t border-navy-700/40">
                    <td className="py-2 pr-3 capitalize">{f.type}</td><td className="pr-3">{f.amount.toFixed(2)}</td>
                    <td className="pr-3">{f.category || "—"}</td><td className="pr-3 text-navy-200">{f.remarks || "—"}</td>
                    <td className="pr-3 text-navy-300">{f.createdByName || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span>Income: <strong>{income.toFixed(2)}</strong></span>
          <span>Expenditure: <strong>{expense.toFixed(2)}</strong></span>
          <span>Net: <strong>{(income - expense).toFixed(2)}</strong></span>
        </div>
      </Section>

      {/* Course duties */}
      <Section title="Course duties" icon={<ClipboardList className="h-4 w-4" />}>
        {dutiesByCourse.length === 0 ? (
          <p className="text-sm text-navy-400">No duties recorded.</p>
        ) : dutiesByCourse.map((g) => (
          <div key={g.course.id} className="mb-3">
            <p className="font-medium text-navy-100 mb-1">{g.course.title}</p>
            <ul className="space-y-1">
              {g.items.map((d, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  {d.isDone ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-navy-500" />}
                  <span>{d.dutyLabel}</span>
                  {d.remarks && <span className="text-navy-400">— {d.remarks}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>

      {/* Marketing */}
      <Section title="Marketing (this week)" icon={<Film className="h-4 w-4" />}>
        <div className="text-sm space-y-1">
          <div>Reels prepared: <strong>{reelsDone} / 3</strong></div>
          {report.reels.filter((r) => r.notes).map((r, i) => (
            <div key={i} className="text-navy-300">Reel {r.reelNumber}: {r.notes}</div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Megaphone className="h-4 w-4 text-navy-300" />
            Reel boosted: <strong>{report.boost?.isBoosted ? "Yes" : "No"}</strong>
          </div>
          {report.boost?.instagramUrl && (
            <div className="text-navy-300 break-all">Boost link: <a className="text-emerald-400 underline" href={report.boost.instagramUrl} target="_blank" rel="noreferrer">{report.boost.instagramUrl}</a></div>
          )}
        </div>
      </Section>

      {/* Assignments */}
      <Section title="Assignment forwarded" icon={<Users className="h-4 w-4" />}>
        {report.assignments.length === 0 ? (
          <p className="text-sm text-navy-400">No assignment follow-up recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-navy-300"><th className="py-2 pr-3">Class</th><th className="pr-3">Forwarded</th><th className="pr-3">Remarks</th></tr></thead>
              <tbody>
                {report.assignments.map((a, i) => (
                  <tr key={i} className="border-t border-navy-700/40">
                    <td className="py-2 pr-3">{className(a.classId)}</td>
                    <td className="pr-3">{a.assignmentForwarded ? <span className="text-emerald-400">Yes</span> : <span className="text-navy-400">No</span>}</td>
                    <td className="pr-3 text-navy-200">{a.remarks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card><CardContent className="p-4">
      <h3 className="font-semibold mb-3 flex items-center gap-2">{icon}{title}</h3>
      {children}
    </CardContent></Card>
  )
}
