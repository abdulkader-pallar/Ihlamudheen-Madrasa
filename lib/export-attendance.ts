// ╔══════════════════════════════════════════════════════════════════╗
// ║ Attendance report export — CSV / Excel / PDF                     ║
// ║ Shared between /dashboard/attendance-report and the inline       ║
// ║ "Today's Class Attendance Status" widget on the dashboard.       ║
// ║ Zero new dependencies — Excel uses the application/vnd.ms-excel  ║
// ║ HTML table trick; PDF opens a print-ready new window.            ║
// ╚══════════════════════════════════════════════════════════════════╝

import type { CourseData, AttendanceRecord } from "@/data/courses"
import { computeLateness, getProgramStart, formatTime12h, formatMinutesLate } from "@/lib/late-policy"
import { formatIsoDate } from "@/lib/date-format"

export type AttendanceStatus = "present" | "absent" | "late" | "not-marked"

export interface AttendanceRow {
  classId: string
  className: string
  courseTitle: string
  studentId: string
  studentName: string
  rollNo: string
  status: AttendanceStatus
  markedBy?: string
  remarks?: string
}

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  "not-marked": "Not Marked",
}

/** Build the flat row list (one row per student) from the data the
 *  dashboard already has in memory. */
export function buildAttendanceRows(
  courses: CourseData[],
  attendanceByClass: Record<string, AttendanceRecord[]>,
  markerByClass: Record<string, string>,
  date: string,
): AttendanceRow[] {
  const out: AttendanceRow[] = []
  for (const course of courses) {
    for (const cls of course.classes) {
      const att = attendanceByClass[cls.id] || []
      const todayRec = att.find((a) => a.date === date)
      for (const st of cls.students) {
        const raw = todayRec?.records[st.id]
        let status: AttendanceStatus = "not-marked"
        if (raw === "present") status = "present"
        else if (raw === "absent") status = "absent"
        else if (raw === "late") status = "late"
        out.push({
          classId: cls.id,
          className: cls.name,
          courseTitle: course.title,
          studentId: st.id,
          studentName: st.name,
          rollNo: st.rollNo,
          status,
          markedBy: markerByClass[cls.id],
          remarks: todayRec?.remarks?.[st.id],
        })
      }
    }
  }
  return out
}

const HEADERS = ["Class", "Reg No", "Student", "Status", "Reason", "Marked By"]
const cellsForRow = (r: AttendanceRow): string[] => [
  r.className,
  r.rollNo,
  r.studentName,
  STATUS_LABEL[r.status],
  r.status === "absent" ? (r.remarks ?? "") : "",
  r.markedBy ?? "",
]

function csvEscape(s: string) {
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
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

const escHTML = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function exportAttendanceCSV(rows: AttendanceRow[], date: string, filterLabel = "All"): { ok: boolean; message: string } {
  const slug = filterLabel.replace(/[^a-zA-Z0-9]+/g, "-")
  const lines = ["﻿" + HEADERS.map(csvEscape).join(",")]
  rows.forEach((r) => lines.push(cellsForRow(r).map(csvEscape).join(",")))
  downloadBlob(
    new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }),
    `Attendance-${slug}-${date}.csv`,
  )
  return { ok: true, message: `Exported ${rows.length} rows as CSV` }
}

export function exportAttendanceExcel(rows: AttendanceRow[], date: string, filterLabel = "All"): { ok: boolean; message: string } {
  const slug = filterLabel.replace(/[^a-zA-Z0-9]+/g, "-")
  const headRow = HEADERS.map(
    (h) =>
      `<th style="background:#1e3a5f;color:#fff;padding:6px 10px;border:1px solid #999;text-align:left;">${escHTML(h)}</th>`,
  ).join("")
  const bodyRows = rows
    .map(
      (r) =>
        "<tr>" +
        cellsForRow(r)
          .map((c) => `<td style="padding:6px 10px;border:1px solid #ccc;">${escHTML(c)}</td>`)
          .join("") +
        "</tr>",
    )
    .join("")
  const title = `Attendance Report — ${escHTML(filterLabel)} — ${escHTML(formatIsoDate(date))}`
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Attendance ${date}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--><style>td,th{vertical-align:top;font-family:Calibri,sans-serif;font-size:11pt;}</style></head><body><h2 style="font-family:Calibri,sans-serif;color:#1e3a5f;">${title}</h2><table style="border-collapse:collapse;"><thead><tr>${headRow}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`
  downloadBlob(
    new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }),
    `Attendance-${slug}-${date}.xls`,
  )
  return { ok: true, message: `Exported ${rows.length} rows as Excel` }
}

export function exportAttendancePDF(rows: AttendanceRow[], date: string, filterLabel = "All"): { ok: boolean; message: string } {
  const win = window.open("", "_blank", "width=1100,height=800")
  if (!win) return { ok: false, message: "Pop-up blocker prevented opening — allow pop-ups for this site" }

  const dateLong = new Date(date + "T00:00:00").toLocaleDateString("en-AE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  const summary = { present: 0, absent: 0, late: 0, notMarked: 0 }
  rows.forEach((r) => {
    if (r.status === "present") summary.present++
    else if (r.status === "absent") summary.absent++
    else if (r.status === "late") summary.late++
    else summary.notMarked++
  })

  // Per-class summary for the report's "By Class" section (mirrors the
  // dashboard widget's appearance on paper)
  const classMap = new Map<string, { name: string; courseTitle: string; total: number; present: number; absent: number; late: number; notMarked: number; markedBy?: string }>()
  rows.forEach((r) => {
    if (!classMap.has(r.classId)) {
      classMap.set(r.classId, { name: r.className, courseTitle: r.courseTitle, total: 0, present: 0, absent: 0, late: 0, notMarked: 0, markedBy: r.markedBy })
    }
    const c = classMap.get(r.classId)!
    c.total++
    if (r.status === "present") c.present++
    else if (r.status === "absent") c.absent++
    else if (r.status === "late") c.late++
    else c.notMarked++
  })
  const classes = Array.from(classMap.values())
  const classCount = classes.length

  const statusColor = (s: AttendanceStatus) =>
    s === "present" ? "#10b981" : s === "absent" ? "#dc2626" : s === "late" ? "#f59e0b" : "#8899b0"

  const classCards = classes
    .map((c) => {
      const marked = c.present + c.absent + c.late
      const pct = c.total > 0 ? Math.round((c.present / c.total) * 100) : 0
      const fullyMarked = c.notMarked === 0 && c.total > 0
      const isPartial = marked > 0 && c.notMarked > 0
      const cardBg = fullyMarked ? "#ecfdf5" : isPartial ? "#fef9c3" : "#fef2f2"
      const cardBorder = fullyMarked ? "#10b981" : isPartial ? "#f59e0b" : "#dc2626"
      const statusLabel = fullyMarked ? "Done" : isPartial ? "Partial" : "Not Marked"
      const statusColorH = fullyMarked ? "#10b981" : isPartial ? "#f59e0b" : "#dc2626"
      const progress = c.total > 0 ? Math.round((marked / c.total) * 100) : 0
      const markedBy = c.markedBy
        ? `<p style="font-size:7.5pt;color:#5c6b82;margin:2px 0 4px;">Marked by <strong style="color:#0f2240;">${escHTML(c.markedBy)}</strong></p>`
        : `<p style="font-size:7.5pt;color:#8899b0;font-style:italic;margin:2px 0 4px;">No teacher marked yet</p>`
      return `<div style="border:1px solid ${cardBorder}40;background:${cardBg};border-radius:8px;padding:8px 10px;break-inside:avoid;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
          <strong style="font-size:9.5pt;color:#0f2240;">${escHTML(c.name)}</strong>
          <span style="font-size:7pt;font-weight:700;background:${statusColorH}22;color:${statusColorH};padding:2px 7px;border-radius:99px;text-transform:uppercase;letter-spacing:.04em;">${statusLabel}</span>
        </div>
        <p style="font-size:7.5pt;color:#8899b0;margin-bottom:2px;">${escHTML(c.courseTitle)}</p>
        ${markedBy}
        <div style="display:flex;align-items:center;gap:10px;font-size:8pt;">
          <span style="color:#5c6b82;">${c.total} students</span>
          ${marked > 0 ? `<span style="color:#10b981;font-weight:600;">P: ${c.present}</span><span style="color:#dc2626;font-weight:600;">A: ${c.absent}</span>${c.late > 0 ? `<span style="color:#f59e0b;font-weight:600;">L: ${c.late}</span>` : ""}<span style="margin-left:auto;color:#0f2240;font-weight:700;">${pct}%</span>` : ""}
        </div>
        <div style="margin-top:5px;height:4px;background:#e2e8f0;border-radius:99px;overflow:hidden;">
          <div style="height:100%;width:${progress}%;background:${statusColorH};"></div>
        </div>
      </div>`
    })
    .join("")

  const bodyRows = rows
    .map((r, i) => {
      const cells = cellsForRow(r)
      return (
        `<tr style="background:${i % 2 === 0 ? "#f8f9fc" : "#fff"}">` +
        cells
          .map((c, ci) => {
            if (ci === 3) return `<td style="color:${statusColor(r.status)};font-weight:700;">${escHTML(c)}</td>`
            // Reason column (ci=4): italic, muted — only present for absent rows
            if (ci === 4) return `<td style="color:#8899b0;font-style:italic;">${escHTML(c)}</td>`
            return `<td>${escHTML(c)}</td>`
          })
          .join("") +
        "</tr>"
      )
    })
    .join("")

  const filterNote = filterLabel && filterLabel !== "All Institutions" ? ` · ${escHTML(filterLabel)}` : ""
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Attendance Report ${escHTML(date)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter','Segoe UI',sans-serif;color:#0f2240;padding:32px 28px;}
header{text-align:center;border-bottom:2px solid #1e3a5f;padding-bottom:14px;margin-bottom:18px;}
.logo{height:46px;width:auto;object-fit:contain;display:block;margin:0 auto 8px;}
.school{font-weight:800;font-size:18pt;letter-spacing:-0.02em;white-space:nowrap;}
.school-sub{font-size:9pt;color:#5c6b82;margin-top:2px;}
.badge{display:inline-block;background:#1e3a5f;color:#fff;font-size:9pt;font-weight:700;padding:3px 14px;border-radius:3px;text-transform:uppercase;letter-spacing:.06em;margin-top:8px;}
h1{font-size:13pt;font-weight:700;color:#1e3a5f;margin-bottom:2px;}
.subtitle{font-size:9.5pt;color:#5c6b82;margin-bottom:10px;}
.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px;}
.summary > div{background:#f8f9fc;border:1px solid #dde3ed;border-radius:6px;padding:10px 12px;text-align:center;}
.summary p:first-child{font-size:9pt;color:#5c6b82;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:3px;}
.summary p:last-child{font-size:18pt;font-weight:800;color:#1e3a5f;line-height:1;}
.section-title{font-size:10pt;font-weight:700;color:#1e3a5f;text-transform:uppercase;letter-spacing:.06em;margin:6px 0 8px;padding-bottom:4px;border-bottom:1px solid #dde3ed;}
.classes-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px;}
table{width:100%;border-collapse:collapse;font-size:9pt;}
th{background:#1e3a5f;color:#fff;padding:7px 10px;text-align:left;font-weight:600;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;border:1px solid #1e3a5f;}
td{padding:6px 10px;border:1px solid #dde3ed;vertical-align:top;}
footer{margin-top:18px;padding-top:10px;border-top:1px solid #dde3ed;font-size:8pt;color:#8899b0;display:flex;justify-content:space-between;}
.toolbar{position:fixed;bottom:18px;right:18px;display:flex;gap:8px;z-index:99;}
.btn{padding:8px 16px;background:#f5a623;color:#0a1628;border:none;border-radius:8px;font-size:11pt;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 4px 16px rgba(245,166,35,.4);}
.btn-out{background:#fff;color:#0f2240;border:1.5px solid #dde3ed;box-shadow:0 4px 12px rgba(0,0,0,.1);}
@media print{.toolbar{display:none;}body{padding:14mm;}@page{margin:10mm;}}
</style></head><body>
<header><img src="/logo.png" alt="Ihlamudheen Madrasa" class="logo" onerror="this.style.display='none'"/><div class="school">Ihlamudheen Madrasa</div><div class="school-sub">Ihlamudheen Madrasa · Malappuram, Kerala</div><span class="badge">Attendance Report</span></header>
<h1>Daily Attendance — ${escHTML(dateLong)}</h1>
<div class="subtitle">${rows.length} students across ${classCount} class${classCount === 1 ? "" : "es"}${filterNote} · printed ${escHTML(new Date().toLocaleDateString("en-AE"))}</div>
<div class="summary">
<div><p>Present</p><p style="color:#10b981;">${summary.present}</p></div>
<div><p>Absent</p><p style="color:#dc2626;">${summary.absent}</p></div>
<div><p>Late</p><p style="color:#f59e0b;">${summary.late}</p></div>
<div><p>Not Marked</p><p style="color:#8899b0;">${summary.notMarked}</p></div>
</div>
<div class="section-title">By Class — ${classCount} ${classCount === 1 ? "class" : "classes"}</div>
<div class="classes-grid">${classCards}</div>
<div class="section-title">Student Detail</div>
<table><thead><tr>${HEADERS.map((h) => `<th>${escHTML(h)}</th>`).join("")}</tr></thead><tbody>${bodyRows}</tbody></table>
<footer><span>Generated by Ihlamudheen Madrasa</span><span>${escHTML(new Date().toLocaleDateString("en-AE"))}</span></footer>
<div class="toolbar"><button class="btn-out btn" onclick="window.close()">Close</button><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
<script>setTimeout(function(){window.print()},400);</script>
</body></html>`)
  win.document.close()
  return { ok: true, message: "PDF print preview opened" }
}

export type AttendanceFormat = "csv" | "excel" | "pdf"

export function exportAttendance(
  rows: AttendanceRow[],
  format: AttendanceFormat,
  date: string,
  filterLabel = "All Institutions",
): { ok: boolean; message: string } {
  switch (format) {
    case "csv":
      return exportAttendanceCSV(rows, date, filterLabel)
    case "excel":
      return exportAttendanceExcel(rows, date, filterLabel)
    case "pdf":
      return exportAttendancePDF(rows, date, filterLabel)
  }
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Monthly report — per-student summary across all sessions in a   ║
// ║ given calendar month.                                           ║
// ╚══════════════════════════════════════════════════════════════════╝

export interface MonthlyAttendanceRow {
  classId: string
  className: string
  courseTitle: string
  studentId: string
  studentName: string
  rollNo: string
  /** Working days — how many days the class had attendance taken this month. */
  workingDays: number
  present: number
  absent: number
  late: number
  /** Days where no record for this student. */
  notMarked: number
  /** (present + late) / workingDays, rounded — 0 when workingDays = 0. */
  attendancePct: number
  /** Comma-separated absent reasons collected from remarks across all absent days. */
  absentReasons: string
}

/** Aggregate per-student totals for the given month. */
export function buildMonthlyAttendanceRows(
  courses: CourseData[],
  attendanceByClass: Record<string, AttendanceRecord[]>,
  month: string,
): MonthlyAttendanceRow[] {
  const monthPrefix = month + "-"
  const out: MonthlyAttendanceRow[] = []
  for (const course of courses) {
    for (const cls of course.classes) {
      const allRecs = attendanceByClass[cls.id] || []
      const monthRecs = allRecs.filter((r) => r.date.startsWith(monthPrefix))
      const workingDays = monthRecs.length
      for (const st of cls.students) {
        let present = 0, absent = 0, late = 0, notMarked = 0
        const reasons: string[] = []
        for (const rec of monthRecs) {
          const s = rec.records[st.id]
          if (s === "present") present++
          else if (s === "absent") {
            absent++
            const remark = rec.remarks?.[st.id]
            if (remark) reasons.push(remark)
          }
          else if (s === "late") late++
          else notMarked++
        }
        const attended = present + late
        const pct = workingDays > 0 ? Math.round((attended / workingDays) * 100) : 0
        out.push({
          classId: cls.id,
          className: cls.name,
          courseTitle: course.title,
          studentId: st.id,
          studentName: st.name,
          rollNo: st.rollNo,
          workingDays,
          present,
          absent,
          late,
          notMarked,
          attendancePct: pct,
          absentReasons: reasons.join(", "),
        })
      }
    }
  }
  return out
}

/** Distinct sorted session dates for a class within a month. */
export function classSessionDates(
  attendanceByClass: Record<string, AttendanceRecord[]>,
  classId: string,
  month: string,
): string[] {
  const monthPrefix = month + "-"
  const all = (attendanceByClass[classId] || []).map((r) => r.date).filter((d) => d.startsWith(monthPrefix))
  return Array.from(new Set(all)).sort()
}

const MONTHLY_HEADERS = ["Class", "Reg No", "Student", "Working Days", "Present", "Absent", "Late", "Reason", "Attendance %"]
const cellsForMonthlyRow = (r: MonthlyAttendanceRow): string[] => [
  r.className,
  r.rollNo,
  r.studentName,
  String(r.workingDays),
  String(r.present),
  String(r.absent),
  String(r.late),
  r.absentReasons || "—",
  r.workingDays > 0 ? `${r.attendancePct}%` : "—",
]

function monthLong(month: string): string {
  // month is "YYYY-MM"
  const [y, m] = month.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString("en-AE", { month: "long", year: "numeric" })
}

export function exportMonthlyAttendanceCSV(
  rows: MonthlyAttendanceRow[],
  month: string,
  filterLabel = "All",
): { ok: boolean; message: string } {
  const slug = filterLabel.replace(/[^a-zA-Z0-9]+/g, "-")
  const lines = ["﻿" + MONTHLY_HEADERS.map(csvEscape).join(",")]
  rows.forEach((r) => lines.push(cellsForMonthlyRow(r).map(csvEscape).join(",")))
  downloadBlob(
    new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }),
    `Attendance-Monthly-${slug}-${month}.csv`,
  )
  return { ok: true, message: `Exported ${rows.length} rows as CSV` }
}

export function exportMonthlyAttendanceExcel(
  rows: MonthlyAttendanceRow[],
  month: string,
  filterLabel = "All",
): { ok: boolean; message: string } {
  const slug = filterLabel.replace(/[^a-zA-Z0-9]+/g, "-")
  const headRow = MONTHLY_HEADERS.map(
    (h) =>
      `<th style="background:#1e3a5f;color:#fff;padding:6px 10px;border:1px solid #999;text-align:left;">${escHTML(h)}</th>`,
  ).join("")
  const bodyRows = rows
    .map(
      (r) =>
        "<tr>" +
        cellsForMonthlyRow(r)
          .map((c) => `<td style="padding:6px 10px;border:1px solid #ccc;">${escHTML(c)}</td>`)
          .join("") +
        "</tr>",
    )
    .join("")
  const monthLabel = monthLong(month)
  const title = `Monthly Attendance Report — ${escHTML(filterLabel)} — ${escHTML(monthLabel)}`
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Attendance ${month}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--><style>td,th{vertical-align:top;font-family:Calibri,sans-serif;font-size:11pt;}</style></head><body><h2 style="font-family:Calibri,sans-serif;color:#1e3a5f;">${title}</h2><table style="border-collapse:collapse;"><thead><tr>${headRow}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`
  downloadBlob(
    new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }),
    `Attendance-Monthly-${slug}-${month}.xls`,
  )
  return { ok: true, message: `Exported ${rows.length} rows as Excel` }
}

export function exportMonthlyAttendancePDF(
  rows: MonthlyAttendanceRow[],
  month: string,
  filterLabel = "All",
): { ok: boolean; message: string } {
  const win = window.open("", "_blank", "width=1100,height=800")
  if (!win) return { ok: false, message: "Pop-up blocker prevented opening — allow pop-ups for this site" }

  const monthLabel = monthLong(month)

  // Class-level aggregates for the "By Class" cards
  const classMap = new Map<string, { name: string; courseTitle: string; students: number; workingDays: number; present: number; absent: number; late: number; notMarked: number }>()
  rows.forEach((r) => {
    if (!classMap.has(r.classId)) {
      classMap.set(r.classId, { name: r.className, courseTitle: r.courseTitle, students: 0, workingDays: r.workingDays, present: 0, absent: 0, late: 0, notMarked: 0 })
    }
    const c = classMap.get(r.classId)!
    c.students++
    c.present += r.present
    c.absent += r.absent
    c.late += r.late
    c.notMarked += r.notMarked
  })
  const classes = Array.from(classMap.values())
  const classCount = classes.length

  // School-wide totals
  const totals = { workingDays: 0, present: 0, absent: 0, late: 0, notMarked: 0 }
  classes.forEach((c) => { totals.workingDays += c.workingDays })
  rows.forEach((r) => {
    totals.present += r.present
    totals.absent += r.absent
    totals.late += r.late
    totals.notMarked += r.notMarked
  })
  const attendedTotal = totals.present + totals.late
  const possibleTotal = totals.present + totals.absent + totals.late + totals.notMarked
  const overallPct = possibleTotal > 0 ? Math.round((attendedTotal / possibleTotal) * 100) : 0

  const classCards = classes
    .map((c) => {
      const possible = c.students * c.workingDays
      const attended = c.present + c.late
      const pct = possible > 0 ? Math.round((attended / possible) * 100) : 0
      const color = pct >= 85 ? "#10b981" : pct >= 60 ? "#f59e0b" : "#dc2626"
      return `<div style="border:1px solid ${color}40;background:${color}10;border-radius:8px;padding:8px 10px;break-inside:avoid;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
          <strong style="font-size:9.5pt;color:#0f2240;">${escHTML(c.name)}</strong>
          <span style="font-size:7pt;font-weight:700;background:${color}22;color:${color};padding:2px 7px;border-radius:99px;">${pct}%</span>
        </div>
        <p style="font-size:7.5pt;color:#8899b0;margin-bottom:4px;">${escHTML(c.courseTitle)}</p>
        <div style="display:flex;align-items:center;gap:10px;font-size:8pt;flex-wrap:wrap;">
          <span style="color:#5c6b82;">${c.students} students · ${c.workingDays} day${c.workingDays === 1 ? "" : "s"}</span>
          <span style="color:#10b981;font-weight:600;">P: ${c.present}</span>
          <span style="color:#dc2626;font-weight:600;">A: ${c.absent}</span>
          ${c.late > 0 ? `<span style="color:#f59e0b;font-weight:600;">L: ${c.late}</span>` : ""}
        </div>
        <div style="margin-top:5px;height:4px;background:#e2e8f0;border-radius:99px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${color};"></div>
        </div>
      </div>`
    })
    .join("")

  const bodyRows = rows
    .map((r, i) => {
      const cells = cellsForMonthlyRow(r)
      const pctColor = r.workingDays === 0
        ? "#8899b0"
        : r.attendancePct >= 85 ? "#10b981" : r.attendancePct >= 60 ? "#f59e0b" : "#dc2626"
      return (
        `<tr style="background:${i % 2 === 0 ? "#f8f9fc" : "#fff"}">` +
        cells
          .map((c, ci) => {
            if (ci === 4) return `<td style="color:#10b981;font-weight:600;">${escHTML(c)}</td>`
            if (ci === 5) return `<td style="color:#dc2626;font-weight:600;">${escHTML(c)}</td>`
            if (ci === 6) return `<td style="color:#f59e0b;font-weight:600;">${escHTML(c)}</td>`
            if (ci === 7) return `<td style="color:#8899b0;font-style:italic;">${escHTML(c)}</td>`
            if (ci === 8) return `<td style="color:${pctColor};font-weight:700;">${escHTML(c)}</td>`
            return `<td>${escHTML(c)}</td>`
          })
          .join("") +
        "</tr>"
      )
    })
    .join("")

  const filterNote = filterLabel && filterLabel !== "All Institutions" ? ` · ${escHTML(filterLabel)}` : ""
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Monthly Attendance Report ${escHTML(month)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter','Segoe UI',sans-serif;color:#0f2240;padding:32px 28px;}
header{text-align:center;border-bottom:2px solid #1e3a5f;padding-bottom:14px;margin-bottom:18px;}
.logo{height:46px;width:auto;object-fit:contain;display:block;margin:0 auto 8px;}
.school{font-weight:800;font-size:18pt;letter-spacing:-0.02em;white-space:nowrap;}
.school-sub{font-size:9pt;color:#5c6b82;margin-top:2px;}
.badge{display:inline-block;background:#1e3a5f;color:#fff;font-size:9pt;font-weight:700;padding:3px 14px;border-radius:3px;text-transform:uppercase;letter-spacing:.06em;margin-top:8px;}
h1{font-size:13pt;font-weight:700;color:#1e3a5f;margin-bottom:2px;}
.subtitle{font-size:9.5pt;color:#5c6b82;margin-bottom:10px;}
.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px;}
.summary > div{background:#f8f9fc;border:1px solid #dde3ed;border-radius:6px;padding:10px 12px;text-align:center;}
.summary p:first-child{font-size:9pt;color:#5c6b82;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:3px;}
.summary p:last-child{font-size:16pt;font-weight:800;color:#1e3a5f;line-height:1;}
.section-title{font-size:10pt;font-weight:700;color:#1e3a5f;text-transform:uppercase;letter-spacing:.06em;margin:6px 0 8px;padding-bottom:4px;border-bottom:1px solid #dde3ed;}
.classes-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px;}
table{width:100%;border-collapse:collapse;font-size:9pt;}
th{background:#1e3a5f;color:#fff;padding:7px 10px;text-align:left;font-weight:600;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;border:1px solid #1e3a5f;}
td{padding:6px 10px;border:1px solid #dde3ed;vertical-align:top;}
footer{margin-top:18px;padding-top:10px;border-top:1px solid #dde3ed;font-size:8pt;color:#8899b0;display:flex;justify-content:space-between;}
.toolbar{position:fixed;bottom:18px;right:18px;display:flex;gap:8px;z-index:99;}
.btn{padding:8px 16px;background:#f5a623;color:#0a1628;border:none;border-radius:8px;font-size:11pt;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 4px 16px rgba(245,166,35,.4);}
.btn-out{background:#fff;color:#0f2240;border:1.5px solid #dde3ed;box-shadow:0 4px 12px rgba(0,0,0,.1);}
@media print{.toolbar{display:none;}body{padding:14mm;}@page{margin:10mm;}}
</style></head><body>
<header><img src="/logo.png" alt="Ihlamudheen Madrasa" class="logo" onerror="this.style.display='none'"/><div class="school">Ihlamudheen Madrasa</div><div class="school-sub">Ihlamudheen Madrasa · Malappuram, Kerala</div><span class="badge">Monthly Attendance</span></header>
<h1>Monthly Attendance — ${escHTML(monthLabel)}</h1>
<div class="subtitle">${rows.length} student${rows.length === 1 ? "" : "s"} across ${classCount} class${classCount === 1 ? "" : "es"}${filterNote} · printed ${escHTML(new Date().toLocaleDateString("en-AE"))}</div>
<div class="summary">
<div><p>Working Days</p><p>${totals.workingDays}</p></div>
<div><p>Present</p><p style="color:#10b981;">${totals.present}</p></div>
<div><p>Absent</p><p style="color:#dc2626;">${totals.absent}</p></div>
<div><p>Late</p><p style="color:#f59e0b;">${totals.late}</p></div>
<div><p>Attendance %</p><p style="color:${overallPct >= 85 ? "#10b981" : overallPct >= 60 ? "#f59e0b" : "#dc2626"};">${overallPct}%</p></div>
</div>
<div class="section-title">By Class — ${classCount} ${classCount === 1 ? "class" : "classes"}</div>
<div class="classes-grid">${classCards}</div>
<div class="section-title">Per-Student Summary</div>
<table><thead><tr>${MONTHLY_HEADERS.map((h) => `<th>${escHTML(h)}</th>`).join("")}</tr></thead><tbody>${bodyRows}</tbody></table>
<footer><span>Generated by Ihlamudheen Madrasa</span><span>${escHTML(new Date().toLocaleDateString("en-AE"))}</span></footer>
<div class="toolbar"><button class="btn-out btn" onclick="window.close()">Close</button><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
<script>setTimeout(function(){window.print()},400);</script>
</body></html>`)
  win.document.close()
  return { ok: true, message: "Monthly PDF print preview opened" }
}

export function exportMonthlyAttendance(
  rows: MonthlyAttendanceRow[],
  format: AttendanceFormat,
  month: string,
  filterLabel = "All Institutions",
): { ok: boolean; message: string } {
  switch (format) {
    case "csv":
      return exportMonthlyAttendanceCSV(rows, month, filterLabel)
    case "excel":
      return exportMonthlyAttendanceExcel(rows, month, filterLabel)
    case "pdf":
      return exportMonthlyAttendancePDF(rows, month, filterLabel)
  }
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Classes-taken report                                             ║
// ║                                                                  ║
// ║ How many class sessions each class actually received in a month  ║
// ║ — one attendance-marked date = one class taken. Added for the    ║
// ║ July/August online months so admin can spot classes falling      ║
// ║ behind on Google Meet, but works for any month.                  ║
// ╚══════════════════════════════════════════════════════════════════╝

export interface ClassesTakenRow {
  classId: string
  className: string
  courseTitle: string
  schedule: string
  /** Attendance-marked dates in the month = classes conducted. */
  taken: number
  /** Per-week split of `taken`: W1 = days 1–7, W2 = 8–14, W3 = 15–21,
   *  W4 = 22–28, W5 = 29–31. Always 5 entries. */
  weeks: number[]
  /** Scheduled occurrences of the class's weekday in the month up to today
   *  (null when the schedule string doesn't start with a weekday name). */
  expectedToDate: number | null
  lastDate: string | null
}

/** Week-of-month bucket for a YYYY-MM-DD date: 0 for days 1–7 … 4 for 29–31. */
export function weekOfMonth(dateStr: string): number {
  const day = parseInt(dateStr.slice(8, 10), 10)
  return Math.min(4, Math.floor((day - 1) / 7))
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/** Occurrences of `weekday` (0=Sun…6=Sat) in `month`, counting only dates ≤ upTo. */
export function countWeekdayInMonth(month: string, weekday: number, upTo?: string): number {
  const [y, m] = month.split("-").map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  let n = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${month}-${String(d).padStart(2, "0")}`
    if (upTo && dateStr > upTo) break
    if (new Date(y, m - 1, d).getDay() === weekday) n++
  }
  return n
}

export function buildClassesTakenRows(
  courses: CourseData[],
  attendanceByClass: Record<string, AttendanceRecord[]>,
  month: string,
  today: string = new Date().toISOString().slice(0, 10),
): ClassesTakenRow[] {
  const out: ClassesTakenRow[] = []
  for (const course of courses) {
    for (const cls of course.classes) {
      const dates = classSessionDates(attendanceByClass, cls.id, month)
      const weekday = WEEKDAY_NAMES.findIndex((d) => (cls.schedule ?? "").trim().startsWith(d))
      const weeks = [0, 0, 0, 0, 0]
      for (const d of dates) weeks[weekOfMonth(d)]++
      out.push({
        classId: cls.id,
        className: cls.name,
        courseTitle: course.title,
        schedule: cls.schedule ?? "",
        taken: dates.length,
        weeks,
        expectedToDate: weekday >= 0 ? countWeekdayInMonth(month, weekday, today) : null,
        lastDate: dates.length > 0 ? dates[dates.length - 1] : null,
      })
    }
  }
  return out.sort(
    (a, b) =>
      a.courseTitle.localeCompare(b.courseTitle) ||
      a.className.localeCompare(b.className, undefined, { numeric: true }),
  )
}

const CLASSES_TAKEN_HEADERS = [
  "Course", "Class", "Schedule", "Classes Taken",
  "W1 (1-7)", "W2 (8-14)", "W3 (15-21)", "W4 (22-28)", "W5 (29-31)",
  "Scheduled (to date)", "Last Class",
]
const cellsForClassesTakenRow = (r: ClassesTakenRow): string[] => [
  r.courseTitle,
  r.className,
  r.schedule || "—",
  String(r.taken),
  ...r.weeks.map((w) => (w > 0 ? String(w) : "—")),
  r.expectedToDate === null ? "—" : String(r.expectedToDate),
  r.lastDate ?? "—",
]

export function exportClassesTaken(
  rows: ClassesTakenRow[],
  format: AttendanceFormat,
  month: string,
  filterLabel = "All Institutions",
): { ok: boolean; message: string } {
  const slug = filterLabel.replace(/[^a-zA-Z0-9]+/g, "-")
  const monthLabel = monthLong(month)

  if (format === "csv") {
    const lines = ["﻿" + CLASSES_TAKEN_HEADERS.map(csvEscape).join(",")]
    rows.forEach((r) => lines.push(cellsForClassesTakenRow(r).map(csvEscape).join(",")))
    downloadBlob(
      new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }),
      `Classes-Taken-${slug}-${month}.csv`,
    )
    return { ok: true, message: `Exported ${rows.length} classes as CSV` }
  }

  if (format === "excel") {
    const headRow = CLASSES_TAKEN_HEADERS.map(
      (h) => `<th style="background:#1e3a5f;color:#fff;padding:6px 10px;border:1px solid #999;text-align:left;">${escHTML(h)}</th>`,
    ).join("")
    const bodyRows = rows
      .map(
        (r) =>
          "<tr>" +
          cellsForClassesTakenRow(r)
            .map((c) => `<td style="padding:6px 10px;border:1px solid #ccc;">${escHTML(c)}</td>`)
            .join("") +
          "</tr>",
      )
      .join("")
    const title = `Classes Taken — ${escHTML(filterLabel)} — ${escHTML(monthLabel)}`
    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/><style>td,th{vertical-align:top;font-family:Calibri,sans-serif;font-size:11pt;}</style></head><body><h2 style="font-family:Calibri,sans-serif;color:#1e3a5f;">${title}</h2><table style="border-collapse:collapse;"><thead><tr>${headRow}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`
    downloadBlob(
      new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }),
      `Classes-Taken-${slug}-${month}.xls`,
    )
    return { ok: true, message: `Exported ${rows.length} classes as Excel` }
  }

  // PDF — print window with the standard centered letterhead
  const win = window.open("", "_blank", "width=1100,height=800")
  if (!win) return { ok: false, message: "Pop-up blocker prevented opening — allow pop-ups for this site" }

  const bodyRows = rows
    .map((r, i) => {
      const behind = r.expectedToDate !== null ? r.expectedToDate - r.taken : null
      const statusColor = behind === null ? "#8899b0" : behind <= 0 ? "#10b981" : behind === 1 ? "#f59e0b" : "#dc2626"
      const statusText = behind === null ? "—" : behind <= 0 ? "On track" : `${behind} behind`
      const cells = cellsForClassesTakenRow(r)
      return (
        `<tr style="background:${i % 2 === 0 ? "#f8f9fc" : "#fff"}">` +
        cells.map((c, ci) => (ci === 3 ? `<td style="font-weight:700;">${escHTML(c)}</td>` : `<td>${escHTML(c)}</td>`)).join("") +
        `<td style="color:${statusColor};font-weight:700;">${statusText}</td></tr>`
      )
    })
    .join("")

  const totalTaken = rows.reduce((s, r) => s + r.taken, 0)
  const filterNote = filterLabel && filterLabel !== "All Institutions" ? ` · ${escHTML(filterLabel)}` : ""
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Classes Taken ${escHTML(month)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter','Segoe UI',sans-serif;color:#0f2240;padding:32px 28px;}
header{text-align:center;border-bottom:2px solid #1e3a5f;padding-bottom:14px;margin-bottom:18px;}
.logo{height:46px;width:auto;object-fit:contain;display:block;margin:0 auto 8px;}
.school{font-weight:800;font-size:18pt;letter-spacing:-0.02em;white-space:nowrap;}
.school-sub{font-size:9pt;color:#5c6b82;margin-top:2px;}
.badge{display:inline-block;background:#1e3a5f;color:#fff;font-size:9pt;font-weight:700;padding:3px 14px;border-radius:3px;text-transform:uppercase;letter-spacing:.06em;margin-top:8px;}
h1{font-size:13pt;font-weight:700;color:#1e3a5f;margin-bottom:2px;}
.subtitle{font-size:9.5pt;color:#5c6b82;margin-bottom:14px;}
table{width:100%;border-collapse:collapse;font-size:9pt;}
th{background:#1e3a5f;color:#fff;padding:7px 10px;text-align:left;font-weight:600;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;border:1px solid #1e3a5f;}
td{padding:6px 10px;border:1px solid #dde3ed;vertical-align:top;}
footer{margin-top:18px;padding-top:10px;border-top:1px solid #dde3ed;font-size:8pt;color:#8899b0;display:flex;justify-content:space-between;}
.toolbar{position:fixed;bottom:18px;right:18px;display:flex;gap:8px;z-index:99;}
.btn{padding:8px 16px;background:#f5a623;color:#0a1628;border:none;border-radius:8px;font-size:11pt;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 4px 16px rgba(245,166,35,.4);}
.btn-out{background:#fff;color:#0f2240;border:1.5px solid #dde3ed;box-shadow:0 4px 12px rgba(0,0,0,.1);}
@media print{.toolbar{display:none;}body{padding:14mm;}@page{margin:10mm;}}
</style></head><body>
<header><img src="/logo.png" alt="Ihlamudheen Madrasa" class="logo" onerror="this.style.display='none'"/><div class="school">Ihlamudheen Madrasa</div><div class="school-sub">Ihlamudheen Madrasa · Malappuram, Kerala</div><span class="badge">Classes Taken</span></header>
<h1>Classes Taken — ${escHTML(monthLabel)}</h1>
<div class="subtitle">${rows.length} class${rows.length === 1 ? "" : "es"} · ${totalTaken} session${totalTaken === 1 ? "" : "s"} conducted${filterNote} · printed ${escHTML(new Date().toLocaleDateString("en-AE"))}</div>
<table><thead><tr>${CLASSES_TAKEN_HEADERS.map((h) => `<th>${escHTML(h)}</th>`).join("")}<th>Status</th></tr></thead><tbody>${bodyRows}</tbody></table>
<footer><span>Generated by Ihlamudheen Madrasa</span><span>${escHTML(new Date().toLocaleDateString("en-AE"))}</span></footer>
<div class="toolbar"><button class="btn-out btn" onclick="window.close()">Close</button><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
<script>setTimeout(function(){window.print()},400);</script>
</body></html>`)
  win.document.close()
  return { ok: true, message: "Classes Taken PDF print preview opened" }
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Late-comer reports — daily & monthly                            ║
// ║                                                                  ║
// ║ Only programs with a defined start time are considered (Ihlamudheen   ║
// ║ Madrasa, Ihlamudheen Madrasa, Edu Support). A student is "late"   ║
// ║ when their recorded arrival is after that start time.           ║
// ╚══════════════════════════════════════════════════════════════════╝

export interface DailyLateRow {
  classId: string
  className: string
  courseTitle: string
  studentId: string
  studentName: string
  rollNo: string
  /** Program start time "HH:MM". */
  startTime: string
  /** Recorded arrival time "HH:MM" (may be empty if status was set without a time). */
  arrivalTime: string
  /** Minutes after the start time. */
  minutesLate: number
}

/** Late students for a single date, across the (already filtered) courses. */
export function buildDailyLateRows(
  courses: CourseData[],
  attendanceByClass: Record<string, AttendanceRecord[]>,
  date: string,
): DailyLateRow[] {
  const out: DailyLateRow[] = []
  for (const course of courses) {
    const start = getProgramStart(course.title)
    if (!start) continue // untracked program (e.g. CIBIS)
    for (const cls of course.classes) {
      const rec = (attendanceByClass[cls.id] || []).find((a) => a.date === date)
      if (!rec) continue
      for (const st of cls.students) {
        if (rec.records[st.id] !== "late") continue
        const arrival = rec.arrivalTimes?.[st.id] || ""
        const lateness = computeLateness(course.title, arrival)
        out.push({
          classId: cls.id,
          className: cls.name,
          courseTitle: course.title,
          studentId: st.id,
          studentName: st.name,
          rollNo: st.rollNo,
          startTime: start,
          arrivalTime: arrival,
          minutesLate: lateness?.minutesLate ?? 0,
        })
      }
    }
  }
  // Most-late first, then by class for a stable order.
  return out.sort((a, b) => b.minutesLate - a.minutesLate || a.className.localeCompare(b.className))
}

export interface MonthlyLateRow {
  classId: string
  className: string
  courseTitle: string
  studentId: string
  studentName: string
  rollNo: string
  startTime: string
  /** Number of days the student arrived late this month. */
  lateDays: number
  totalMinutesLate: number
  avgMinutesLate: number
  /** Human-readable per-day breakdown, e.g. "06 — 9:12 AM (12m), 13 — 9:05 AM (5m)". */
  details: string
}

/** Per-student late summary for a month, across the (already filtered) courses. */
export function buildMonthlyLateRows(
  courses: CourseData[],
  attendanceByClass: Record<string, AttendanceRecord[]>,
  month: string,
): MonthlyLateRow[] {
  const monthPrefix = month + "-"
  const out: MonthlyLateRow[] = []
  for (const course of courses) {
    const start = getProgramStart(course.title)
    if (!start) continue
    for (const cls of course.classes) {
      const recs = (attendanceByClass[cls.id] || []).filter((r) => r.date.startsWith(monthPrefix))
      for (const st of cls.students) {
        let lateDays = 0
        let totalMinutesLate = 0
        const detailParts: string[] = []
        for (const rec of recs) {
          if (rec.records[st.id] !== "late") continue
          lateDays++
          const arrival = rec.arrivalTimes?.[st.id] || ""
          const min = computeLateness(course.title, arrival)?.minutesLate ?? 0
          totalMinutesLate += min
          const day = rec.date.slice(8)
          const arrLabel = arrival ? formatTime12h(arrival) : "—"
          detailParts.push(`${day} — ${arrLabel} (${formatMinutesLate(min)})`)
        }
        if (lateDays === 0) continue
        out.push({
          classId: cls.id,
          className: cls.name,
          courseTitle: course.title,
          studentId: st.id,
          studentName: st.name,
          rollNo: st.rollNo,
          startTime: start,
          lateDays,
          totalMinutesLate,
          avgMinutesLate: Math.round(totalMinutesLate / lateDays),
          details: detailParts.join(", "),
        })
      }
    }
  }
  return out.sort((a, b) => b.lateDays - a.lateDays || b.totalMinutesLate - a.totalMinutesLate)
}

// ── Shared report shell (standard Ihlamudheen Madrasa letterhead) ──────────────
function openPrintableReport(
  badge: string,
  h1: string,
  subtitle: string,
  bodyHtml: string,
  docTitle: string,
): { ok: boolean; message: string } {
  const win = window.open("", "_blank", "width=1100,height=800")
  if (!win) return { ok: false, message: "Pop-up blocker prevented opening — allow pop-ups for this site" }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escHTML(docTitle)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter','Segoe UI',sans-serif;color:#0f2240;padding:32px 28px;}
header{text-align:center;border-bottom:2px solid #1e3a5f;padding-bottom:14px;margin-bottom:18px;}
.logo{height:46px;width:auto;object-fit:contain;display:block;margin:0 auto 8px;}
.school{font-weight:800;font-size:18pt;letter-spacing:-0.02em;white-space:nowrap;}
.school-sub{font-size:9pt;color:#5c6b82;margin-top:2px;}
.badge{display:inline-block;background:#1e3a5f;color:#fff;font-size:9pt;font-weight:700;padding:3px 14px;border-radius:3px;text-transform:uppercase;letter-spacing:.06em;margin-top:8px;}
h1{font-size:13pt;font-weight:700;color:#1e3a5f;margin-bottom:2px;}
.subtitle{font-size:9.5pt;color:#5c6b82;margin-bottom:14px;}
.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px;}
.summary > div{background:#f8f9fc;border:1px solid #dde3ed;border-radius:6px;padding:10px 12px;text-align:center;}
.summary p:first-child{font-size:9pt;color:#5c6b82;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:3px;}
.summary p:last-child{font-size:18pt;font-weight:800;color:#1e3a5f;line-height:1;}
table{width:100%;border-collapse:collapse;font-size:9pt;}
th{background:#1e3a5f;color:#fff;padding:7px 10px;text-align:left;font-weight:600;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;border:1px solid #1e3a5f;}
td{padding:6px 10px;border:1px solid #dde3ed;vertical-align:top;}
.empty{padding:28px;text-align:center;color:#8899b0;font-size:10pt;border:1px dashed #dde3ed;border-radius:8px;}
footer{margin-top:18px;padding-top:10px;border-top:1px solid #dde3ed;font-size:8pt;color:#8899b0;display:flex;justify-content:space-between;}
.toolbar{position:fixed;bottom:18px;right:18px;display:flex;gap:8px;z-index:99;}
.btn{padding:8px 16px;background:#f5a623;color:#0a1628;border:none;border-radius:8px;font-size:11pt;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 4px 16px rgba(245,166,35,.4);}
.btn-out{background:#fff;color:#0f2240;border:1.5px solid #dde3ed;box-shadow:0 4px 12px rgba(0,0,0,.1);}
@media print{.toolbar{display:none;}body{padding:14mm;}@page{margin:10mm;}}
</style></head><body>
<header><img src="/logo.png" alt="Ihlamudheen Madrasa" class="logo" onerror="this.style.display='none'"/><div class="school">Ihlamudheen Madrasa</div><div class="school-sub">Ihlamudheen Madrasa · Malappuram, Kerala</div><span class="badge">${escHTML(badge)}</span></header>
<h1>${escHTML(h1)}</h1>
<div class="subtitle">${subtitle}</div>
${bodyHtml}
<footer><span>Generated by Ihlamudheen Madrasa</span><span>${escHTML(new Date().toLocaleDateString("en-AE"))}</span></footer>
<div class="toolbar"><button class="btn-out btn" onclick="window.close()">Close</button><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
<script>setTimeout(function(){window.print()},400);</script>
</body></html>`)
  win.document.close()
  return { ok: true, message: "PDF print preview opened" }
}

// ── Daily late-comer exports ─────────────────────────────────────────
const DAILY_LATE_HEADERS = ["Class", "Reg No", "Student", "Program Start", "Arrival", "Minutes Late"]
const cellsForDailyLate = (r: DailyLateRow): string[] => [
  r.className,
  r.rollNo,
  r.studentName,
  formatTime12h(r.startTime),
  r.arrivalTime ? formatTime12h(r.arrivalTime) : "—",
  String(r.minutesLate),
]

export function exportDailyLateCSV(rows: DailyLateRow[], date: string, filterLabel = "All"): { ok: boolean; message: string } {
  const slug = filterLabel.replace(/[^a-zA-Z0-9]+/g, "-")
  const lines = ["﻿" + DAILY_LATE_HEADERS.map(csvEscape).join(",")]
  rows.forEach((r) => lines.push(cellsForDailyLate(r).map(csvEscape).join(",")))
  downloadBlob(new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `Late-Comers-${slug}-${date}.csv`)
  return { ok: true, message: `Exported ${rows.length} late student${rows.length === 1 ? "" : "s"} as CSV` }
}

export function exportDailyLateExcel(rows: DailyLateRow[], date: string, filterLabel = "All"): { ok: boolean; message: string } {
  const slug = filterLabel.replace(/[^a-zA-Z0-9]+/g, "-")
  const headRow = DAILY_LATE_HEADERS.map((h) => `<th style="background:#1e3a5f;color:#fff;padding:6px 10px;border:1px solid #999;text-align:left;">${escHTML(h)}</th>`).join("")
  const bodyRows = rows.map((r) => "<tr>" + cellsForDailyLate(r).map((c) => `<td style="padding:6px 10px;border:1px solid #ccc;">${escHTML(c)}</td>`).join("") + "</tr>").join("")
  const title = `Late Comers — ${escHTML(filterLabel)} — ${escHTML(formatIsoDate(date))}`
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Late ${date}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--><style>td,th{vertical-align:top;font-family:Calibri,sans-serif;font-size:11pt;}</style></head><body><h2 style="font-family:Calibri,sans-serif;color:#1e3a5f;">${title}</h2><table style="border-collapse:collapse;"><thead><tr>${headRow}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`
  downloadBlob(new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }), `Late-Comers-${slug}-${date}.xls`)
  return { ok: true, message: `Exported ${rows.length} late student${rows.length === 1 ? "" : "s"} as Excel` }
}

export function exportDailyLatePDF(rows: DailyLateRow[], date: string, filterLabel = "All"): { ok: boolean; message: string } {
  const dateLong = new Date(date + "T00:00:00").toLocaleDateString("en-AE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  const classCount = new Set(rows.map((r) => r.classId)).size
  const totalMin = rows.reduce((n, r) => n + r.minutesLate, 0)
  const avgMin = rows.length > 0 ? Math.round(totalMin / rows.length) : 0
  const filterNote = filterLabel && filterLabel !== "All Institutions" ? ` · ${escHTML(filterLabel)}` : ""
  const summary = `<div class="summary">
<div><p>Late Comers</p><p style="color:#f59e0b;">${rows.length}</p></div>
<div><p>Classes</p><p>${classCount}</p></div>
<div><p>Avg Minutes Late</p><p style="color:#f59e0b;">${avgMin}</p></div>
</div>`
  const table = rows.length === 0
    ? `<div class="empty">No late arrivals recorded for ${escHTML(dateLong)}.</div>`
    : `<table><thead><tr>${DAILY_LATE_HEADERS.map((h) => `<th>${escHTML(h)}</th>`).join("")}</tr></thead><tbody>${
        rows.map((r, i) => `<tr style="background:${i % 2 === 0 ? "#f8f9fc" : "#fff"}">` + cellsForDailyLate(r).map((c, ci) =>
          ci === 5 ? `<td style="color:#f59e0b;font-weight:700;">${escHTML(c)} min</td>`
          : ci === 4 ? `<td style="color:#dc2626;font-weight:600;">${escHTML(c)}</td>`
          : `<td>${escHTML(c)}</td>`).join("") + "</tr>").join("")
      }</tbody></table>`
  const subtitle = `${rows.length} late student${rows.length === 1 ? "" : "s"} across ${classCount} class${classCount === 1 ? "" : "es"}${filterNote} · printed ${escHTML(new Date().toLocaleDateString("en-AE"))}`
  return openPrintableReport("Late Comers — Daily", `Daily Late Comers — ${dateLong}`, subtitle, summary + table, `Late Comers ${date}`)
}

export function exportDailyLate(rows: DailyLateRow[], format: AttendanceFormat, date: string, filterLabel = "All Institutions"): { ok: boolean; message: string } {
  switch (format) {
    case "csv": return exportDailyLateCSV(rows, date, filterLabel)
    case "excel": return exportDailyLateExcel(rows, date, filterLabel)
    case "pdf": return exportDailyLatePDF(rows, date, filterLabel)
  }
}

// ── Monthly late-comer exports ───────────────────────────────────────
const MONTHLY_LATE_HEADERS = ["Class", "Reg No", "Student", "Late Days", "Total Late", "Avg / Day", "Detail"]
const cellsForMonthlyLate = (r: MonthlyLateRow): string[] => [
  r.className,
  r.rollNo,
  r.studentName,
  String(r.lateDays),
  formatMinutesLate(r.totalMinutesLate),
  formatMinutesLate(r.avgMinutesLate),
  r.details,
]

export function exportMonthlyLateCSV(rows: MonthlyLateRow[], month: string, filterLabel = "All"): { ok: boolean; message: string } {
  const slug = filterLabel.replace(/[^a-zA-Z0-9]+/g, "-")
  const lines = ["﻿" + MONTHLY_LATE_HEADERS.map(csvEscape).join(",")]
  rows.forEach((r) => lines.push(cellsForMonthlyLate(r).map(csvEscape).join(",")))
  downloadBlob(new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `Late-Comers-Monthly-${slug}-${month}.csv`)
  return { ok: true, message: `Exported ${rows.length} late student${rows.length === 1 ? "" : "s"} as CSV` }
}

export function exportMonthlyLateExcel(rows: MonthlyLateRow[], month: string, filterLabel = "All"): { ok: boolean; message: string } {
  const slug = filterLabel.replace(/[^a-zA-Z0-9]+/g, "-")
  const headRow = MONTHLY_LATE_HEADERS.map((h) => `<th style="background:#1e3a5f;color:#fff;padding:6px 10px;border:1px solid #999;text-align:left;">${escHTML(h)}</th>`).join("")
  const bodyRows = rows.map((r) => "<tr>" + cellsForMonthlyLate(r).map((c) => `<td style="padding:6px 10px;border:1px solid #ccc;">${escHTML(c)}</td>`).join("") + "</tr>").join("")
  const title = `Monthly Late Comers — ${escHTML(filterLabel)} — ${escHTML(monthLong(month))}`
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Late ${month}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--><style>td,th{vertical-align:top;font-family:Calibri,sans-serif;font-size:11pt;}</style></head><body><h2 style="font-family:Calibri,sans-serif;color:#1e3a5f;">${title}</h2><table style="border-collapse:collapse;"><thead><tr>${headRow}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`
  downloadBlob(new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }), `Late-Comers-Monthly-${slug}-${month}.xls`)
  return { ok: true, message: `Exported ${rows.length} late student${rows.length === 1 ? "" : "s"} as Excel` }
}

export function exportMonthlyLatePDF(rows: MonthlyLateRow[], month: string, filterLabel = "All"): { ok: boolean; message: string } {
  const monthLabel = monthLong(month)
  const classCount = new Set(rows.map((r) => r.classId)).size
  const totalLateDays = rows.reduce((n, r) => n + r.lateDays, 0)
  const totalMin = rows.reduce((n, r) => n + r.totalMinutesLate, 0)
  const filterNote = filterLabel && filterLabel !== "All Institutions" ? ` · ${escHTML(filterLabel)}` : ""
  const summary = `<div class="summary">
<div><p>Late Students</p><p style="color:#f59e0b;">${rows.length}</p></div>
<div><p>Total Late Days</p><p style="color:#f59e0b;">${totalLateDays}</p></div>
<div><p>Total Time Late</p><p style="color:#f59e0b;">${formatMinutesLate(totalMin)}</p></div>
</div>`
  const table = rows.length === 0
    ? `<div class="empty">No late arrivals recorded in ${escHTML(monthLabel)}.</div>`
    : `<table><thead><tr>${MONTHLY_LATE_HEADERS.map((h) => `<th>${escHTML(h)}</th>`).join("")}</tr></thead><tbody>${
        rows.map((r, i) => `<tr style="background:${i % 2 === 0 ? "#f8f9fc" : "#fff"}">` + cellsForMonthlyLate(r).map((c, ci) =>
          ci === 3 ? `<td style="color:#f59e0b;font-weight:700;">${escHTML(c)}</td>`
          : ci === 6 ? `<td style="color:#5c6b82;font-size:8pt;">${escHTML(c)}</td>`
          : `<td>${escHTML(c)}</td>`).join("") + "</tr>").join("")
      }</tbody></table>`
  const subtitle = `${rows.length} late student${rows.length === 1 ? "" : "s"} across ${classCount} class${classCount === 1 ? "" : "es"}${filterNote} · printed ${escHTML(new Date().toLocaleDateString("en-AE"))}`
  return openPrintableReport("Late Comers — Monthly", `Monthly Late Comers — ${monthLabel}`, subtitle, summary + table, `Late Comers ${month}`)
}

export function exportMonthlyLate(rows: MonthlyLateRow[], format: AttendanceFormat, month: string, filterLabel = "All Institutions"): { ok: boolean; message: string } {
  switch (format) {
    case "csv": return exportMonthlyLateCSV(rows, month, filterLabel)
    case "excel": return exportMonthlyLateExcel(rows, month, filterLabel)
    case "pdf": return exportMonthlyLatePDF(rows, month, filterLabel)
  }
}
