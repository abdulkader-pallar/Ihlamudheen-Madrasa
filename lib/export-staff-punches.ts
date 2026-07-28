// ╔══════════════════════════════════════════════════════════════════╗
// ║ Staff Fingerprint Punch Report — Excel / PDF                     ║
// ║ Carries status colours, late category AND early-departure flags  ║
// ║ through to every export format (Excel XLS, print-to-PDF).       ║
// ╚══════════════════════════════════════════════════════════════════╝

export interface StaffPunchRow {
  date: string           // YYYY-MM-DD
  program: string        // "EDU Support" | "Ihlamudheen Madrasa" | "English" | "CIBIS" | "Non-Teaching Staff"
  teacherName: string
  role: string           // "" for teachers, "Office"/"Cleaning"/"Driver" for non-teaching
  timeIn: string         // HH:MM or "—"
  timeOut: string        // HH:MM or "—"
  status: string         // "Present" | "Late" | "Absent"
  lateCategory: string   // "Cat 1" | "Cat 2" | "Cat 3" | "—"
  earlyDeparture: string // "Cat 1 Early" | "Cat 2 Early" | "—"
  dualPunches?: boolean  // driver/cleaning: two punches in one day
}

// ── Helpers ───────────────────────────────────────────────
function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

// ── Status / flag colours ─────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  Present: "#10b981", Late: "#f59e0b", Absent: "#dc2626",
}
// Late category text color (amber for Cat1, orange for Cat2, red for Cat3)
function lateCatColor(cat: string): string {
  if (cat === "Cat 1") return "#f59e0b"
  if (cat === "Cat 2") return "#ea580c"
  if (cat === "Cat 3") return "#dc2626"
  return "#94a3b8"
}
// Early departure text color — always red
function earlyDepColor(dep: string): string {
  return dep === "—" ? "#94a3b8" : "#dc2626"
}

const HEADERS = ["Date", "Program", "Name", "Role", "IN", "OUT", "Status", "Late Cat.", "Early Dep."]
const PROG_COLORS: Record<string, string> = {
  "EDU Support": "#7c3aed", "Ihlamudheen Madrasa": "#059669",
  "English": "#2563eb", "CIBIS": "#d97706", "Non-Teaching Staff": "#64748b",
}

const PROG_ORDER = ["EDU Support", "Ihlamudheen Madrasa", "English", "CIBIS", "Non-Teaching Staff"]

// ── Group rows by date, latest date first (descending) ────
function groupByDate(rows: StaffPunchRow[]): [string, StaffPunchRow[]][] {
  const map: Record<string, StaffPunchRow[]> = {}
  for (const r of rows) {
    if (!map[r.date]) map[r.date] = []
    map[r.date].push(r)
  }
  const dates = Object.keys(map).sort((a, b) => b.localeCompare(a))
  return dates.map(d => [
    d,
    map[d].sort((a, b) => {
      const pi = PROG_ORDER.indexOf(a.program) - PROG_ORDER.indexOf(b.program)
      return pi !== 0 ? pi : a.teacherName.localeCompare(b.teacherName)
    }),
  ])
}

// ── Group rows by teacher name, sorted by name then date ──
function groupByName(rows: StaffPunchRow[]): [string, StaffPunchRow[]][] {
  const map: Record<string, StaffPunchRow[]> = {}
  for (const r of rows) {
    if (!map[r.teacherName]) map[r.teacherName] = []
    map[r.teacherName].push(r)
  }
  const names = Object.keys(map).sort((a, b) => a.localeCompare(b))
  return names.map(name => [
    name,
    map[name].sort((a, b) => {
      const dc = a.date.localeCompare(b.date)
      return dc !== 0 ? dc : a.timeIn.localeCompare(b.timeIn)
    }),
  ])
}

// Weekday name for a YYYY-MM-DD date string
function weekdayOf(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-IN", { weekday: "long" })
}

// ── Excel export ──────────────────────────────────────────
// preOpenedWin: pass a synchronously-opened window (iOS Safari) so the
// report renders there instead of being downloaded as a blob (which iOS blocks).
export function exportStaffPunchesExcel(rows: StaffPunchRow[], month: string, groupBy: "date" | "name" = "date", preOpenedWin?: Window | null) {
  const sorted = groupBy === "name"
    ? [...rows].sort((a, b) => {
        const nc = a.teacherName.localeCompare(b.teacherName)
        if (nc !== 0) return nc
        return a.date.localeCompare(b.date)
      })
    : [...rows].sort((a, b) => {
        // Latest date first (descending) to match the grouped-by-date report.
        const dc = b.date.localeCompare(a.date)
        if (dc !== 0) return dc
        const pi = PROG_ORDER.indexOf(a.program) - PROG_ORDER.indexOf(b.program)
        return pi !== 0 ? pi : a.teacherName.localeCompare(b.teacherName)
      })

  const headRow = HEADERS.map(
    h => `<th style="background:#1e3a5f;color:#fff;padding:6px 10px;border:1px solid #999;white-space:nowrap;">${esc(h)}</th>`
  ).join("")

  const bodyRows = sorted.map((r, i) => {
    const bg = i % 2 === 0 ? "#f8f9fc" : "#fff"
    const progColor   = PROG_COLORS[r.program] ?? "#1e3a5f"
    const statusColor = STATUS_COLOR[r.status] ?? "#1e3a5f"
    const lcColor     = lateCatColor(r.lateCategory)
    const edColor     = earlyDepColor(r.earlyDeparture)
    const rowBg       = r.dualPunches ? "#fef3c7" : bg

    const cells: string[] = [
      `<td style="padding:6px 10px;border:1px solid #dde3ed;">${esc(r.date)}</td>`,
      `<td style="color:${progColor};font-weight:600;padding:6px 10px;border:1px solid #dde3ed;">${esc(r.program)}</td>`,
      `<td style="padding:6px 10px;border:1px solid #dde3ed;">${esc(r.teacherName)}</td>`,
      `<td style="padding:6px 10px;border:1px solid #dde3ed;">${esc(r.role || "Teacher")}</td>`,
      `<td style="font-family:monospace;padding:6px 10px;border:1px solid #dde3ed;">${esc(r.timeIn)}</td>`,
      `<td style="font-family:monospace;padding:6px 10px;border:1px solid #dde3ed;">${esc(r.timeOut)}</td>`,
      `<td style="color:${statusColor};font-weight:700;padding:6px 10px;border:1px solid #dde3ed;">${esc(r.status)}</td>`,
      r.lateCategory !== "—"
        ? `<td style="color:${lcColor};font-weight:700;background:#fffbeb;padding:6px 10px;border:1px solid #dde3ed;">${esc(r.lateCategory)}</td>`
        : `<td style="color:#94a3b8;padding:6px 10px;border:1px solid #dde3ed;">—</td>`,
      r.earlyDeparture !== "—"
        ? `<td style="color:${edColor};font-weight:700;background:#fff1f2;padding:6px 10px;border:1px solid #dde3ed;">${esc(r.earlyDeparture)}</td>`
        : `<td style="color:#94a3b8;padding:6px 10px;border:1px solid #dde3ed;">—</td>`,
    ]
    return `<tr style="background:${rowBg}">${cells.join("")}</tr>`
  }).join("")

  const monthLabel = new Date(month + "-15").toLocaleDateString("en-IN", { month: "long", year: "numeric" })
  const groupLabel = groupBy === "name" ? "Sorted by Name" : "Sorted by Date"
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>Staff Punches ${month}</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
td,th{vertical-align:top;font-family:Calibri,sans-serif;font-size:11pt;}
.ios-hint{display:none;background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-family:Calibri,sans-serif;font-size:10pt;color:#92400e;}
@supports(-webkit-touch-callout:none){.ios-hint{display:block;}}
</style>
</head><body>
<div class="ios-hint">On iPhone / iPad: tap the <strong>Share</strong> button in Safari then choose <strong>Save to Files</strong> or <strong>Print</strong> to keep this report.</div>
<img src="/logo.png" style="height:52px;" onerror="this.style.display='none'"/>
<h2 style="font-family:Calibri,sans-serif;color:#1e3a5f;font-size:16pt;">Ihlamudheen Madrasa Staff Fingerprint Punch Report</h2>
<h3 style="font-family:Calibri,sans-serif;color:#2563eb;font-size:13pt;margin-top:2px;">${esc(monthLabel)} &nbsp;·&nbsp; <span style="color:#7c3aed;font-size:11pt;">${esc(groupLabel)}</span></h3>
<p style="font-family:Calibri,sans-serif;color:#9aa5b4;font-size:8pt;margin-top:2px;">Ihlamudheen Madrasa &nbsp;·&nbsp; Ihlamudheen Madrasa · Malappuram, Kerala</p>
<br/>
<table style="border-collapse:collapse;">
  <thead><tr>${headRow}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table>
</body></html>`

  if (preOpenedWin) {
    // iOS path: write HTML to the pre-opened window; user saves via Share sheet
    preOpenedWin.document.open()
    preOpenedWin.document.write(html)
    preOpenedWin.document.close()
  } else {
    downloadBlob(
      new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }),
      `Staff-Punches-${month}-by-${groupBy}.xls`
    )
  }
}

// ── PDF export (print window) ────────────────────────────
// preOpenedWin: pass a synchronously-opened window on iOS so the popup isn't
// blocked (window.open after an await is rejected by iOS Safari).
export function exportStaffPunchesPDF(rows: StaffPunchRow[], month: string, groupBy: "date" | "name" = "date", preOpenedWin?: Window | null) {
  const win = preOpenedWin ?? window.open("", "_blank", "width=1200,height=900")
  if (!win) return

  const monthLabel = new Date(month + "-15").toLocaleDateString("en-IN", { month: "long", year: "numeric" })
  const groupLabel = groupBy === "name" ? "Grouped by Name" : "Grouped by Date"

  // Summary counts
  const summary = { present: 0, late: 0, absent: 0, earlyDep: 0, total: rows.length }
  rows.forEach(r => {
    if (r.status === "Present") summary.present++
    else if (r.status === "Late") summary.late++
    else if (r.status === "Absent") summary.absent++
    if (r.earlyDeparture !== "—") summary.earlyDep++
  })

  // ── Build rows for a section ──────────────────────────
  function buildTableRows(sectionRows: StaffPunchRow[], showDate: boolean): string {
    return sectionRows.map((r, i) => {
      const bg      = r.dualPunches ? "#fef3c7" : (i % 2 === 0 ? "#f8f9fc" : "#fff")
      const sc      = STATUS_COLOR[r.status] ?? "#1e3a5f"
      const pc      = PROG_COLORS[r.program] ?? "#1e3a5f"
      const lcColor = lateCatColor(r.lateCategory)
      const edColor = earlyDepColor(r.earlyDeparture)
      const lateCatCell  = r.lateCategory !== "—"
        ? `<td style="color:${lcColor};font-weight:700;background:#fffbeb;">${esc(r.lateCategory)}</td>`
        : `<td style="color:#c4c9d4;">—</td>`
      const earlyDepCell = r.earlyDeparture !== "—"
        ? `<td style="color:${edColor};font-weight:700;background:#fff1f2;">${esc(r.earlyDeparture)}</td>`
        : `<td style="color:#c4c9d4;">—</td>`
      const dateCell = showDate
        ? `<td style="font-size:8pt;color:#5c6b82;white-space:nowrap;">${esc(r.date)}<br/><span style="color:#2563eb;font-size:7pt;">${esc(weekdayOf(r.date))}</span></td>`
        : ""
      const nameCell = !showDate
        ? `<td>${esc(r.teacherName)}${r.dualPunches ? ' <span style="color:#d97706;font-size:8pt;">[2×]</span>' : ""}</td>`
        : `<td>${esc(r.teacherName)}${r.dualPunches ? ' <span style="color:#d97706;font-size:8pt;">[2×]</span>' : ""}</td>`
      return `<tr style="background:${bg}">
        ${dateCell}
        ${nameCell}
        <td><span style="color:${pc};font-weight:600;font-size:8pt;">${esc(r.program)}</span></td>
        <td style="color:#5c6b82;font-size:8pt;">${esc(r.role || "Teacher")}</td>
        <td class="mono">${esc(r.timeIn)}</td>
        <td class="mono">${esc(r.timeOut)}</td>
        <td style="color:${sc};font-weight:700;">${esc(r.status)}</td>
        ${lateCatCell}
        ${earlyDepCell}
      </tr>`
    }).join("")
  }

  let sections: string
  if (groupBy === "name") {
    const byName = groupByName(rows)
    const ths = ["Date", "Name", "Program", "Role", "IN", "OUT", "Status", "Late Cat.", "Early Dep."]
      .map(h => `<th>${esc(h)}</th>`).join("")
    sections = byName.map(([name, nameRows]) => {
      const payType = nameRows[0]?.role || "Teacher"
      return `
        <div class="section-title">
          <span class="date-label">${esc(name)}</span>
          <span class="day-name">${esc(payType !== "Teacher" ? payType : nameRows[0]?.program ?? "")}</span>
          <span class="punch-count">${nameRows.length} punch${nameRows.length !== 1 ? "es" : ""}</span>
        </div>
        <table><thead><tr>${ths}</tr></thead><tbody>${buildTableRows(nameRows, true)}</tbody></table>
        <div style="height:14px;"></div>`
    }).join("")
  } else {
    const byDate = groupByDate(rows)
    const ths = ["Name", "Program", "Role", "IN", "OUT", "Status", "Late Cat.", "Early Dep."]
      .map(h => `<th>${esc(h)}</th>`).join("")
    sections = byDate.map(([date, dateRows]) => {
      return `
        <div class="section-title">
          <span class="date-label">${esc(date)}</span>
          <span class="day-name">${esc(weekdayOf(date))}</span>
          <span class="punch-count">${dateRows.length} punch${dateRows.length !== 1 ? "es" : ""}</span>
        </div>
        <table><thead><tr>${ths}</tr></thead><tbody>${buildTableRows(dateRows, false)}</tbody></table>
        <div style="height:14px;"></div>`
    }).join("")
  }

  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Staff Punch Report — ${esc(monthLabel)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter','Segoe UI',sans-serif;color:#0f2240;padding:28px 24px;}
header{display:flex;flex-direction:column;align-items:center;text-align:center;border-bottom:2px solid #1e3a5f;padding-bottom:12px;margin-bottom:16px;}
.report-title{font-weight:800;font-size:15pt;color:#1e3a5f;line-height:1.25;}
.school-info{font-size:8pt;color:#9aa5b4;margin-top:3px;}
.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px;}
.summary>div{background:#f8f9fc;border:1px solid #dde3ed;border-radius:6px;padding:8px 10px;text-align:center;}
.summary p:first-child{font-size:8pt;color:#5c6b82;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:2px;}
.summary p:last-child{font-size:16pt;font-weight:800;color:#1e3a5f;line-height:1;}
.section-title{display:flex;align-items:baseline;gap:10px;margin:4px 0 6px;padding:5px 8px;background:#f0f4f8;border-left:3px solid #1e3a5f;border-radius:0 4px 4px 0;}
.date-label{font-size:10pt;font-weight:800;color:#1e3a5f;letter-spacing:.02em;}
.day-name{font-size:9pt;font-weight:600;color:#2563eb;}
.punch-count{margin-left:auto;font-size:8pt;color:#5c6b82;font-weight:600;}
table{width:100%;border-collapse:collapse;font-size:8.5pt;margin-bottom:4px;}
th{background:#1e3a5f;color:#fff;padding:6px 8px;text-align:left;font-weight:600;font-size:8pt;}
td{padding:5px 8px;border:1px solid #dde3ed;}
.mono{font-family:monospace;}
footer{margin-top:16px;padding-top:8px;border-top:1px solid #dde3ed;font-size:7.5pt;color:#8899b0;display:flex;justify-content:space-between;}
.toolbar{position:fixed;bottom:16px;right:16px;display:flex;gap:8px;z-index:99;}
.btn{padding:7px 14px;background:#f5a623;color:#0a1628;border:none;border-radius:6px;font-size:10pt;font-weight:600;cursor:pointer;font-family:inherit;}
.btn-out{background:#fff;color:#0f2240;border:1.5px solid #dde3ed;}
.legend{display:flex;gap:16px;font-size:7.5pt;color:#5c6b82;margin-bottom:12px;flex-wrap:wrap;}
.legend-item{display:flex;align-items:center;gap:4px;}
.dot{width:10px;height:10px;border-radius:2px;display:inline-block;}
@media print{.toolbar{display:none;}body{padding:12mm;}@page{margin:8mm;}}
</style></head><body>
<header>
  <img src="/logo.png" alt="Ihlamudheen Madrasa" style="height:48px;width:auto;object-fit:contain;margin-bottom:8px;" onerror="this.style.display='none'"/>
  <div class="report-title">Ihlamudheen Madrasa Staff Punch Report</div>
  <div style="font-size:13pt;font-weight:700;color:#2563eb;margin-top:3px;">
    ${esc(monthLabel)}&nbsp;&nbsp;<span style="font-size:9.5pt;color:#7c3aed;font-weight:600;">${esc(groupLabel)}</span>
  </div>
  <div class="school-info">Ihlamudheen Madrasa &nbsp;·&nbsp; Ihlamudheen Madrasa · Malappuram, Kerala</div>
</header>
<div class="summary">
  <div><p>Total Punches</p><p>${summary.total}</p></div>
  <div><p>Present</p><p style="color:#10b981;">${summary.present}</p></div>
  <div><p>Late</p><p style="color:#f59e0b;">${summary.late}</p></div>
  <div><p>Absent</p><p style="color:#dc2626;">${summary.absent}</p></div>
  <div><p>Early Dep.</p><p style="color:#dc2626;">${summary.earlyDep}</p></div>
</div>
<div class="legend">
  <div class="legend-item"><div class="dot" style="background:#fffbeb;border:1px solid #f59e0b;"></div> Late Cat. — amber cell</div>
  <div class="legend-item"><div class="dot" style="background:#fff1f2;border:1px solid #dc2626;"></div> Early Departure — red cell</div>
  <div class="legend-item"><div class="dot" style="background:#fef3c7;border:1px solid #d97706;"></div> Driver 2× punch — amber row</div>
</div>
${sections}
<footer><span>Generated by Ihlamudheen Madrasa · ihlamudheen-madrasa.vercel.app</span><span>${new Date().toLocaleDateString("en-IN")}</span></footer>
<div class="toolbar">
  <button class="btn-out btn" onclick="window.close()">Close</button>
  <button class="btn" onclick="window.print()">Print / Save PDF</button>
</div>
<script>setTimeout(function(){window.print()},500);</script>
</body></html>`)
  win.document.close()
}
