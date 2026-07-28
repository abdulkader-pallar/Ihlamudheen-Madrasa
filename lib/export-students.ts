// ╔══════════════════════════════════════════════════════════════════╗
// ║ Multi-format student list export                                 ║
// ║ Supports: CSV · Excel (.xls) · Google Sheets (CSV) · PDF (print) ║
// ║                                                                  ║
// ║ Zero new dependencies — Excel uses an HTML table with the        ║
// ║ application/vnd.ms-excel mime type (Excel opens it natively as a ║
// ║ spreadsheet); PDF opens a print-ready window and triggers the    ║
// ║ browser's Print → Save as PDF dialog.                            ║
// ╚══════════════════════════════════════════════════════════════════╝

import type { Student } from "@/data/courses"

export type ExportFormat = "csv" | "excel" | "sheets" | "pdf"

export interface ExportableStudent extends Student {
  className?: string  // optional — included in CSV/Excel/PDF headers when present
}

const HEADERS = ["ID", "Name", "Class", "Gender", "Father", "Mother", "Father Phone", "Mother Phone"]

function studentToCells(s: ExportableStudent): string[] {
  return [
    s.id ?? "",
    s.name ?? "",
    s.className ?? "",
    s.gender ?? "",
    s.fatherName ?? "",
    s.motherName ?? "",
    s.fatherPhone ?? "",
    s.motherPhone ?? "",
  ]
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0]
}

function safeFileName(label: string): string {
  return label.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
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

// ── CSV ───────────────────────────────────────────────────────────
function csvEscape(s: string): string {
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function buildCSV(students: ExportableStudent[], includeClassColumn: boolean): string {
  const headers = includeClassColumn ? HEADERS : HEADERS.filter((h) => h !== "Class")
  const rows: string[] = [headers.map(csvEscape).join(",")]
  for (const s of students) {
    const cells = studentToCells(s)
    const out = includeClassColumn ? cells : cells.filter((_, i) => i !== 2)
    rows.push(out.map(csvEscape).join(","))
  }
  // BOM so Excel auto-detects UTF-8 (preserves non-ASCII chars)
  return "﻿" + rows.join("\r\n")
}

// ── Excel (HTML table with .xls extension) ─────────────────────────
// Excel opens this natively as a styled spreadsheet — same as the old
// Microsoft Office "save as web page" format. Free and dependency-free.
function buildExcelHTML(
  students: ExportableStudent[],
  title: string,
  includeClassColumn: boolean,
): string {
  const headers = includeClassColumn ? HEADERS : HEADERS.filter((h) => h !== "Class")
  const escHTML = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const headRow = headers
    .map((h) => `<th style="background:#1e3a5f;color:#fff;padding:6px 10px;border:1px solid #999;text-align:left;">${escHTML(h)}</th>`)
    .join("")
  const bodyRows = students
    .map((s) => {
      const cells = studentToCells(s)
      const out = includeClassColumn ? cells : cells.filter((_, i) => i !== 2)
      return (
        "<tr>" +
        out.map((c) => `<td style="padding:6px 10px;border:1px solid #ccc;">${escHTML(c)}</td>`).join("") +
        "</tr>"
      )
    })
    .join("")
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
<meta charset="utf-8" />
<!--[if gte mso 9]><xml>
  <x:ExcelWorkbook>
    <x:ExcelWorksheets>
      <x:ExcelWorksheet>
        <x:Name>${escHTML(title.slice(0, 31))}</x:Name>
        <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
      </x:ExcelWorksheet>
    </x:ExcelWorksheets>
  </x:ExcelWorkbook>
</xml><![endif]-->
<style>td,th{vertical-align:top;font-family:Calibri,sans-serif;font-size:11pt;}</style>
</head>
<body>
<h2 style="font-family:Calibri,sans-serif;color:#1e3a5f;">${escHTML(title)}</h2>
<table style="border-collapse:collapse;">
  <thead><tr>${headRow}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table>
</body></html>`
}

// ── PDF (print-ready new window) ──────────────────────────────────
function openPrintWindow(
  students: ExportableStudent[],
  title: string,
  subtitle: string,
  includeClassColumn: boolean,
) {
  const headers = includeClassColumn ? HEADERS : HEADERS.filter((h) => h !== "Class")
  const escHTML = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const win = window.open("", "_blank", "width=1100,height=800")
  if (!win) {
    return false
  }
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
  const headRow = headers
    .map((h) => `<th>${escHTML(h)}</th>`)
    .join("")
  const bodyRows = students
    .map((s, i) => {
      const cells = studentToCells(s)
      const out = includeClassColumn ? cells : cells.filter((_, idx) => idx !== 2)
      return (
        `<tr style="background:${i % 2 === 0 ? "#f8f9fc" : "#fff"}">` +
        out.map((c) => `<td>${escHTML(c)}</td>`).join("") +
        "</tr>"
      )
    })
    .join("")
  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escHTML(title)} — Ihlamudheen</title>
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
  tr:nth-child(even) td{background:#f8f9fc;}
  footer{margin-top:18px;padding-top:10px;border-top:1px solid #dde3ed;font-size:8pt;color:#8899b0;display:flex;justify-content:space-between;}
  .toolbar{position:fixed;bottom:18px;right:18px;display:flex;gap:8px;z-index:99;}
  .btn{padding:8px 16px;background:#f5a623;color:#0a1628;border:none;border-radius:8px;font-size:11pt;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 4px 16px rgba(245,166,35,.4);}
  .btn-out{background:#fff;color:#0f2240;border:1.5px solid #dde3ed;box-shadow:0 4px 12px rgba(0,0,0,.1);}
  @media print{
    .toolbar{display:none;}
    body{padding:14mm;}
    @page{margin:10mm;}
  }
</style>
</head>
<body>
<header>
  <img src="/logo.png" alt="Ihlamudheen Madrasa" class="logo" onerror="this.style.display='none'"/>
  <div class="school">Ihlamudheen Madrasa</div>
  <div class="school-sub">Ihlamudheen Madrasa · Malappuram, Kerala</div>
  <span class="badge">Student List</span>
</header>
<h1>${escHTML(title)}</h1>
<div class="subtitle">${escHTML(subtitle)} · ${students.length} student${students.length === 1 ? "" : "s"} · Printed ${escHTML(today)}</div>
<table>
  <thead><tr>${headRow}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table>
<footer>
  <span>Generated by Ihlamudheen Madrasa</span>
  <span>${escHTML(today)}</span>
</footer>
<div class="toolbar">
  <button class="btn-out btn" onclick="window.close()">Close</button>
  <button class="btn" onclick="window.print()">Print / Save as PDF</button>
</div>
<script>setTimeout(function(){window.print()},400);</script>
</body>
</html>`)
  win.document.close()
  return true
}

// ── Public API ────────────────────────────────────────────────────
export function exportStudents(
  students: ExportableStudent[],
  format: ExportFormat,
  options: { label: string; subtitle?: string },
): { ok: boolean; message?: string } {
  const includeClassColumn = students.some((s) => s.className)
  const baseName = `${safeFileName(options.label)}-${todayStr()}`
  const subtitle = options.subtitle ?? ""

  switch (format) {
    case "csv": {
      const csv = buildCSV(students, includeClassColumn)
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${baseName}.csv`)
      return { ok: true, message: `Downloaded ${students.length} students as CSV` }
    }
    case "excel": {
      const html = buildExcelHTML(students, options.label, includeClassColumn)
      downloadBlob(new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }), `${baseName}.xls`)
      return { ok: true, message: `Downloaded ${students.length} students as Excel` }
    }
    case "sheets": {
      // Google Sheets imports CSV cleanly. Use a slightly different filename
      // and surface a hint so the admin knows to import it.
      const csv = buildCSV(students, includeClassColumn)
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${baseName}-sheets.csv`)
      return {
        ok: true,
        message: `Downloaded CSV — open Google Sheets → File → Import → Upload`,
      }
    }
    case "pdf": {
      const ok = openPrintWindow(students, options.label, subtitle, includeClassColumn)
      if (!ok) return { ok: false, message: "Pop-up blocker prevented opening — allow pop-ups for this site" }
      return { ok: true, message: "PDF print preview opened — choose 'Save as PDF' in the print dialog" }
    }
    default:
      return { ok: false, message: "Unknown format" }
  }
}
