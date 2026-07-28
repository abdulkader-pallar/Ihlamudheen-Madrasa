"use client"

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import {
  FileBarChart,
  Download,
  Printer,
  ChevronDown,
  Loader2,
  AlertTriangle,
  Users,
  BookOpen,
  Clock,
  Building2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { fetchDisabledTeacherIds } from "@/lib/teacher-status"
import {
  initialTeachers,
  type TeacherData,
  type TeacherPayType,
} from "@/data/courses"
import {
  type AttendanceRec,
  type ReportRow,
  calcRow,
  computeCarryIn,
} from "@/lib/payroll"
import { supabase } from "@/lib/supabase"

// ── Month helpers ──────────────────────────────────────────
function getLast12Months(): { value: string; label: string }[] {
  const result: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    const label = d.toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    result.push({ value, label })
  }
  return result
}

function getMonthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return {
    start: `${ym}-01`,
    end: `${ym}-${String(lastDay).padStart(2, "0")}`,
  }
}

// ── Institution groups ─────────────────────────────────────
const INSTITUTION_OPTIONS = [
  { value: "all",     label: "All Institutions",    icon: Users },
  { value: "madrasa",   label: "Ihlamudheen Madrasa",        icon: BookOpen },
  { value: "english", label: "Ihlamudheen Madrasa (English)",  icon: BookOpen },
  { value: "edu",     label: "EDU Support",          icon: Clock },
  { value: "office",  label: "Office & Others",      icon: Building2 },
]

const OFFICE_TYPES: TeacherPayType[] = ["monthly-office", "monthly-cleaning", "daily-driver"]

function filterTeachers(institution: string): TeacherData[] {
  switch (institution) {
    case "madrasa":
      // Primary Ihlamudheen teachers only (excludes dual-role teachers whose primary is elsewhere)
      return initialTeachers.filter(t => t.payType === "per-session-madrasa")
    case "english":
      // All teachers involved in English Madrasa — primary OR dual role
      return initialTeachers.filter(t =>
        t.payType === "per-day-english" || t.dualPayType === "per-day-english"
      )
    case "edu":
      return initialTeachers.filter(t => t.payType === "monthly-edu-support")
    case "office":
      return initialTeachers.filter(t => OFFICE_TYPES.includes(t.payType))
    default:
      return initialTeachers
  }
}

// ── PDF export ─────────────────────────────────────────────
async function downloadPDF(rows: ReportRow[], monthLabel: string, instLabel: string) {
  const { default: jsPDF } = await import("jspdf")
  const { default: autoTable } = await import("jspdf-autotable")

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const pageW = doc.internal.pageSize.getWidth()
  let y = 10

  // Logo
  try {
    const resp = await fetch("/logo.png")
    if (resp.ok) {
      const blob = await resp.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      doc.addImage(dataUrl, "PNG", 14, y, 28, 12)
    }
  } catch { /* continue without logo */ }

  doc.setFontSize(14); doc.setFont("helvetica", "bold")
  doc.setTextColor(30, 58, 95)
  doc.text("Ihlamudheen Madrasa", 46, y + 6)
  doc.setFontSize(9); doc.setFont("helvetica", "normal")
  doc.setTextColor(90, 90, 90)
  doc.text("Ihlamudheen Madrasa · Malappuram, Kerala", 46, y + 11)
  y += 20

  doc.setFontSize(13); doc.setFont("helvetica", "bold")
  doc.setTextColor(20, 20, 20)
  doc.text(`Staff Payment Report — ${monthLabel}`, 14, y)
  y += 5
  doc.setFontSize(8.5); doc.setFont("helvetica", "normal")
  doc.setTextColor(110, 110, 110)
  doc.text(`${instLabel}  ·  Generated ${new Date().toLocaleString("en-IN")}`, 14, y)
  y += 9

  // Summary boxes
  const totalGross = rows.reduce((s, r) => s + r.grossPay, 0)
  const totalDeductions = rows.reduce((s, r) => s + r.deductions, 0)
  const totalNet = rows.reduce((s, r) => s + r.netPay, 0)
  const totalDays = rows.reduce((s, r) => s + r.daysPresent, 0)

  const boxes = [
    { label: "STAFF",       value: String(rows.length),                   sub: "employees"       },
    { label: "GROSS PAY",   value: `totalGross.toLocaleString()}`,   sub: "before deductions" },
    { label: "DEDUCTIONS",  value: `totalDeductions.toLocaleString()}`, sub: "late marks"   },
    { label: "NET PAYABLE", value: `totalNet.toLocaleString()}`,     sub: "final amount"    },
  ]
  const bw = (pageW - 28 - 6) / 4
  boxes.forEach((box, i) => {
    const x = 14 + i * (bw + 2)
    doc.setFillColor(30, 58, 95)
    doc.roundedRect(x, y, bw, 18, 2, 2, "F")
    doc.setFontSize(6.5); doc.setFont("helvetica", "bold")
    doc.setTextColor(170, 190, 220)
    doc.text(box.label, x + bw / 2, y + 5, { align: "center" })
    doc.setFontSize(9.5); doc.setFont("helvetica", "bold")
    doc.setTextColor(255, 255, 255)
    doc.text(box.value, x + bw / 2, y + 11, { align: "center" })
    doc.setFontSize(6.5); doc.setFont("helvetica", "normal")
    doc.setTextColor(150, 175, 210)
    doc.text(box.sub, x + bw / 2, y + 16, { align: "center" })
  })
  y += 24

  // Data table
  const tableBody: string[][] = rows.map((r, i) => [
    String(i + 1),
    r.name,
    r.institution,
    r.payTypeLabel,
    r.daysPresent > 0 ? String(r.daysPresent) : "—",
    r.payType === "monthly-edu-support"
      ? `${r.hours.toFixed(1)}h / 112h`
      : r.sessions > 0
      ? `${r.sessions} sess.`
      : r.hours > 0
      ? `${r.hours.toFixed(1)}h`
      : "—",
    r.grossPay > 0 ? r.grossPay.toLocaleString() : "—",
    r.deductions > 0 ? `−${r.deductions.toLocaleString()}` : "—",
    r.netPay > 0 ? r.netPay.toLocaleString() : "—",
  ])
  tableBody.push([
    "", `TOTAL — ${rows.length} staff`, "", "",
    totalDays > 0 ? String(totalDays) : "—", "",
    `totalGross.toLocaleString()}`,
    totalDeductions > 0 ? `−${totalDeductions.toLocaleString()}` : "—",
    `totalNet.toLocaleString()}`,
  ])

  autoTable(doc, {
    startY: y,
    head: [["#", "Name", "Institution", "Pay Type", "Days", "Sess / Hrs", "Gross (", "Deduct.", "Net Pay ("]],
    body: tableBody,
    styles: { fontSize: 8, cellPadding: 2.5, lineColor: [220, 225, 235], lineWidth: 0.2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: "bold", fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 254] },
    columnStyles: {
      0: { cellWidth: 8,  halign: "center" },
      1: { cellWidth: 38 },
      2: { cellWidth: 27 },
      3: { cellWidth: 24 },
      4: { cellWidth: 11, halign: "center" },
      5: { cellWidth: 16, halign: "center" },
      6: { cellWidth: 22, halign: "right" },
      7: { cellWidth: 14, halign: "right" },
      8: { cellWidth: 22, halign: "right" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index === rows.length) {
        data.cell.styles.fontStyle = "bold"
        data.cell.styles.fillColor = [232, 238, 250]
      }
      if (data.section === "body" && data.column.index === 7 && data.row.index < rows.length) {
        if (String(data.cell.raw).startsWith("−")) data.cell.styles.textColor = [200, 50, 50]
      }
      if (data.section === "body" && data.column.index === 8 && data.row.index < rows.length) {
        if (String(data.cell.raw) !== "—") data.cell.styles.textColor = [5, 140, 90]
      }
    },
  })

  // Footer on every page
  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.setFontSize(7.5); doc.setTextColor(160)
    doc.text(
      `Ihlamudheen Madrasa — Confidential  ·  Page ${p} of ${pageCount}`,
      pageW / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" }
    )
  }

  doc.save(`staff-payment-${monthLabel.replace(/\s+/g, "-").toLowerCase()}.pdf`)
}

// ── CSV export ─────────────────────────────────────────────
function downloadCSV(rows: ReportRow[], monthLabel: string, instLabel: string) {
  const header = [
    "No.", "Name", "Institution", "Pay Type",
    "Days Present", "Sessions / Hours", "Gross Pay (",
    "Deductions (", "Net Pay (",
  ]
  const dataRows = rows.map((r, i) => [
    String(i + 1),
    r.name,
    r.institution,
    r.payTypeLabel,
    String(r.daysPresent || 0),
    r.payType === "monthly-edu-support"
      ? `${r.hours.toFixed(1)}h / 112h`
      : r.sessions > 0 ? `${r.sessions} sessions` : r.hours > 0 ? `${r.hours.toFixed(1)}h` : "—",
    String(r.grossPay),
    String(r.deductions),
    String(r.netPay),
  ])
  const totals = [
    "", "", "", "TOTAL",
    String(rows.reduce((s, r) => s + r.daysPresent, 0)),
    "",
    String(rows.reduce((s, r) => s + r.grossPay, 0)),
    String(rows.reduce((s, r) => s + r.deductions, 0)),
    String(rows.reduce((s, r) => s + r.netPay, 0)),
  ]

  const csvLines = [
    [`Ihlamudheen Centre — Staff Payment Report`],
    [`Month: ${monthLabel}`, `Group: ${instLabel}`],
    [`Generated: ${new Date().toLocaleString("en-IN")}`],
    [],
    header,
    ...dataRows,
    [],
    totals,
  ]

  const csv = csvLines
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n")

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `madrasa-payment-${monthLabel.replace(/\s+/g, "-").toLowerCase()}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Main page ──────────────────────────────────────────────
export default function StaffPaymentReportPage() {
  const { user, loading: authLoading } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const isAdmin = role === "admin" || role === "accountant"

  const months = getLast12Months()
  const [selectedMonth, setSelectedMonth] = useState(months[0].value)
  const [selectedInstitution, setSelectedInstitution] = useState("all")
  const [reportRows, setReportRows] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)

  const generateReport = useCallback(async () => {
    setLoading(true)
    setFetched(false)
    const { start, end } = getMonthRange(selectedMonth)
    // Disabled staff (left Ihlamudheen Madrasa) drop out of the payment report going forward.
    const disabledIds = await fetchDisabledTeacherIds()
    const teachers = filterTeachers(selectedInstitution).filter(t => !disabledIds.has(t.id))
    const ids = teachers.map(t => t.id)

    // Fetch current-month records + prior late-category records (for carry-in)
    const [{ data }, { data: priorData }] = await Promise.all([
      supabase
        .from("staff_attendance")
        .select("teacher_id, date, session, status, late_category, arrival_time, departure_time, early_departure_category, sessions_credited, out_missing, dual_punches, session_type")
        .in("teacher_id", ids)
        .gte("date", start)
        .lte("date", end),
      supabase
        .from("staff_attendance")
        .select("teacher_id, late_category")
        .in("teacher_id", ids)
        .lt("date", start)
        .not("late_category", "is", null),
    ])

    const records   = (data ?? [])      as AttendanceRec[]
    const priorRecs = (priorData ?? []) as Pick<AttendanceRec, "teacher_id" | "late_category">[]
    const rows = teachers.map(t => calcRow(t, records, selectedInstitution, computeCarryIn(t.id, priorRecs)))
    setReportRows(rows)
    setFetched(true)
    setLoading(false)
  }, [selectedMonth, selectedInstitution])

  useEffect(() => {
    if (!authLoading && isAdmin) generateReport()
  }, [authLoading, isAdmin, generateReport])

  if (authLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-cyan-500" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
        <AlertTriangle className="size-10 text-amber-500" />
        <p className="text-lg font-semibold text-navy-900 dark:text-white">Access Restricted</p>
        <p className="text-sm text-slate-500">Only administrators can view payment reports.</p>
      </div>
    )
  }

  const monthLabel = months.find(m => m.value === selectedMonth)?.label ?? selectedMonth
  const instLabel = INSTITUTION_OPTIONS.find(o => o.value === selectedInstitution)?.label ?? "All"
  const totalGross = reportRows.reduce((s, r) => s + r.grossPay, 0)
  const totalDeductions = reportRows.reduce((s, r) => s + r.deductions, 0)
  const totalNet = reportRows.reduce((s, r) => s + r.netPay, 0)
  const totalDays = reportRows.reduce((s, r) => s + r.daysPresent, 0)

  return (
    <div className="space-y-5 pb-10">
      {/* ── Page header ─────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between print:hidden"
      >
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-navy-900 dark:text-white sm:text-3xl">
            <FileBarChart className="size-7 text-cyan-600" />
            Staff Payment Report
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Monthly attendance &amp; salary summary · download CSV or print as PDF
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => downloadCSV(reportRows, monthLabel, instLabel)}
            disabled={loading || !fetched}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all disabled:opacity-40"
          >
            <Download className="size-4" />
            Download CSV
          </button>
          <button
            onClick={async () => {
              setPdfLoading(true)
              try { await downloadPDF(reportRows, monthLabel, instLabel) }
              finally { setPdfLoading(false) }
            }}
            disabled={loading || !fetched || pdfLoading}
            className="flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-navy-600 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-navy-700 transition-all disabled:opacity-40"
          >
            {pdfLoading ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
            {pdfLoading ? "Generating…" : "Download PDF"}
          </button>
        </div>
      </motion.div>

      {/* ── Filters ──────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-center print:hidden">
        {/* Month selector */}
        <div className="relative">
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="appearance-none rounded-xl border border-slate-200 dark:border-navy-600 bg-white dark:bg-navy-800 pl-4 pr-9 py-2.5 text-sm font-medium text-navy-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 cursor-pointer"
          >
            {months.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
        </div>

        {/* Institution filter */}
        <div className="relative">
          <select
            value={selectedInstitution}
            onChange={e => setSelectedInstitution(e.target.value)}
            className="appearance-none rounded-xl border border-slate-200 dark:border-navy-600 bg-white dark:bg-navy-800 pl-4 pr-9 py-2.5 text-sm font-medium text-navy-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 cursor-pointer"
          >
            {INSTITUTION_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="size-4 animate-spin" /> Generating…
          </div>
        )}
      </div>

      {/* ── Print-only header ────────────────────────────── */}
      <div className="hidden print:block border-b border-slate-300 pb-4 mb-2">
        <div className="flex items-center justify-between">
          <div>
            <img src="/logo.png" alt="Ihlamudheen Madrasa" className="h-12 w-auto object-contain mb-2" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
            <h2 className="text-xl font-bold text-black">Ihlamudheen Madrasa</h2>
            <p className="text-base font-semibold text-gray-700">Staff Payment Report — {monthLabel}</p>
            <p className="text-sm text-gray-500">{instLabel} · Generated {new Date().toLocaleDateString("en-IN")}</p>
          </div>
        </div>
      </div>

      {/* ── Summary tiles ────────────────────────────────── */}
      {fetched && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          {[
            { label: "Staff",          value: reportRows.length,                         sub: "employees",         color: "from-navy-500 to-navy-600",    text: "text-white" },
            { label: "Gross Pay",      value: `INR ${totalGross.toLocaleString()}`, sub: "before deductions", color: "from-emerald-500 to-emerald-600", text: "text-white" },
            { label: "Deductions",     value: `INR ${totalDeductions.toLocaleString()}`, sub: "late marks",   color: "from-red-500 to-red-600",       text: "text-white" },
            { label: "Net Payable",    value: `INR ${totalNet.toLocaleString()}`,   sub: "final amount",      color: "from-cyan-500 to-cyan-600",     text: "text-white" },
          ].map(card => (
            <div
              key={card.label}
              className={`rounded-2xl bg-gradient-to-br ${card.color} p-4 shadow-md`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{card.label}</p>
              <p className={`text-lg font-bold mt-1 leading-tight ${card.text}`}>{card.value}</p>
              <p className="text-[11px] text-white/60 mt-0.5">{card.sub}</p>
            </div>
          ))}
        </motion.div>
      )}

      {/* ── Data table ───────────────────────────────────── */}
      {fetched && reportRows.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-2xl border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 overflow-hidden shadow-sm print:shadow-none print:border-slate-300"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-navy-700/60 border-b border-slate-200 dark:border-navy-700">
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 w-8">#</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Name</th>
                  <th className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hidden sm:table-cell">Institution</th>
                  <th className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hidden md:table-cell">Pay Type</th>
                  <th className="text-center px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Days</th>
                  <th className="text-center px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hidden lg:table-cell">Sessions / Hrs</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Gross</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hidden sm:table-cell">Deduct.</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Net Pay</th>
                </tr>
              </thead>

              <tbody>
                {reportRows.map((row, i) => (
                  <tr
                    key={row.teacherId}
                    className={cn(
                      "border-t border-slate-100 dark:border-navy-700/50 hover:bg-slate-50/80 dark:hover:bg-navy-700/30 transition-colors",
                      i % 2 !== 0 && "bg-slate-50/30 dark:bg-navy-800/50"
                    )}
                  >
                    <td className="px-4 py-3 text-xs text-slate-400">{i + 1}</td>

                    {/* Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-navy-100 dark:bg-navy-700 text-xs font-bold text-navy-600 dark:text-navy-200">
                          {row.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-navy-900 dark:text-white text-sm leading-tight truncate max-w-[140px] sm:max-w-none">
                            {row.name}
                          </p>
                          {row.primaryInstitution ? (
                            <span className="text-[10px] text-sky-600 dark:text-sky-400">
                              Primary pay → {row.primaryInstitution}
                            </span>
                          ) : row.hasDualRole && row.dualRoleLabel ? (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400">
                              Dual role ({row.dualRoleLabel})
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    {/* Institution badge */}
                    <td className="px-3 py-3 hidden sm:table-cell">
                      <span className="inline-block rounded-full bg-slate-100 dark:bg-navy-700 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {row.institution}
                      </span>
                    </td>

                    {/* Pay type */}
                    <td className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400 hidden md:table-cell whitespace-nowrap">
                      {row.payTypeLabel}
                    </td>

                    {/* Days present */}
                    <td className="px-3 py-3 text-center">
                      <span className={cn("text-sm font-semibold", row.daysPresent > 0 ? "text-navy-900 dark:text-white" : "text-slate-400")}>
                        {row.daysPresent > 0 ? row.daysPresent : "—"}
                      </span>
                    </td>

                    {/* Sessions or hours */}
                    <td className="px-3 py-3 text-center text-sm text-slate-600 dark:text-slate-300 hidden lg:table-cell">
                      <div>
                        {row.payType === "monthly-edu-support"
                          ? row.hours > 0
                            ? `${row.hours.toFixed(1)}h / 112h`
                            : "0h / 112h"
                          : row.sessions > 0
                          ? `${row.sessions} sess.`
                          : row.hours > 0
                          ? `${row.hours.toFixed(1)}h`
                          : "—"}
                      </div>
                      {row.payType === "monthly-edu-support" &&
                        row.englishHours !== undefined &&
                        row.englishHours > 0 && (
                          <span className="block text-[10px] text-slate-400 leading-tight">
                            + {row.englishHours.toFixed(1)}h English
                          </span>
                        )}
                    </td>

                    {/* Gross — show breakdown for dual-role and hourly rate for EDU Support */}
                    <td className="px-4 py-3 text-right font-medium text-navy-900 dark:text-white whitespace-nowrap">
                      {row.grossPay > 0 ? (
                        <div>
                          <span>{row.grossPay.toLocaleString()}</span>
                          {row.madrasaGross !== undefined && row.englishGross !== undefined && row.englishGross > 0 && (
                            <span className="block text-[10px] text-slate-400 leading-tight">
                              {row.madrasaGross.toLocaleString()} + {row.englishGross.toLocaleString()}
                            </span>
                          )}
                          {row.payType === "monthly-edu-support" && (
                            <span className="block text-[10px] text-slate-400 leading-tight">
                              {row.hours.toFixed(1)}h × {row.eduHourlyRate?.toFixed(4)} INR/hr
                              {row.englishGross !== undefined && row.englishGross > 0
                                ? ` + ${row.englishGross.toLocaleString()} English`
                                : ""}
                            </span>
                          )}
                        </div>
                      ) : "—"}
                    </td>

                    {/* Deductions */}
                    <td className="px-4 py-3 text-right hidden sm:table-cell whitespace-nowrap">
                      {row.deductions > 0 ? (
                        <span className="text-red-600 dark:text-red-400 font-medium">−{row.deductions}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    {/* Net pay */}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span className={cn("font-bold", row.netPay > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400")}>
                        {row.netPay > 0 ? row.netPay.toLocaleString() : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Totals footer */}
              <tfoot>
                <tr className="border-t-2 border-slate-300 dark:border-navy-500 bg-slate-100 dark:bg-navy-700/70">
                  <td colSpan={2} className="px-4 py-3">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                      Total — {reportRows.length} staff
                    </span>
                  </td>
                  <td className="hidden sm:table-cell" />
                  <td className="hidden md:table-cell" />
                  <td className="px-3 py-3 text-center text-sm font-bold text-navy-900 dark:text-white">
                    {totalDays}
                  </td>
                  <td className="hidden lg:table-cell" />
                  <td className="px-4 py-3 text-right text-sm font-bold text-navy-900 dark:text-white whitespace-nowrap">
                    INR {totalGross.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-red-600 dark:text-red-400 hidden sm:table-cell whitespace-nowrap">
                    {totalDeductions > 0 ? `−${totalDeductions.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    INR {totalNet.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Note below table */}
          <div className="px-4 py-2.5 border-t border-slate-100 dark:border-navy-700 bg-slate-50/60 dark:bg-navy-800/50 space-y-1">
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              * Session-based teachers: counted as 2 sessions per attendance day (morning + afternoon).
              Monthly-fixed staff show base salary regardless of attendance.
              Deductions apply when 3 late-mark accumulations occur.
            </p>
            {selectedInstitution === "english" && (
              <p className="text-[11px] text-sky-500 dark:text-sky-400">
                ⓘ Dual-role teachers teach English Madrasa in addition to their primary role.
                Their primary salary is paid under Ihlamudheen Madrasa / EDU Support respectively.
                English sessions must be verified manually and paid separately.
              </p>
            )}
          </div>
        </motion.div>
      )}

      {/* Empty state */}
      {fetched && !loading && reportRows.length === 0 && (
        <div className="flex h-48 flex-col items-center justify-center gap-3 text-center">
          <FileBarChart className="size-10 text-slate-300 dark:text-slate-600" />
          <p className="text-slate-500 dark:text-slate-400 text-sm">No data found for this period.</p>
        </div>
      )}
    </div>
  )
}
