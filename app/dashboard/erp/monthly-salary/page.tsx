"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { motion } from "framer-motion"
import {
  Wallet,
  Download,
  ChevronDown,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Users,
  BookOpen,
  Clock,
  Building2,
  X,
  FileText,
  Sheet,
  Lock,
  Search,
  Printer,
  CheckCircle2,
  Banknote,
  ShieldCheck,
  AlertOctagon,
  ListChecks,
} from "lucide-react"
import { toast } from "sonner"
import { subscribeToTable } from "@/lib/db"
import { addReportHeader, BRAND_NAME } from "@/lib/branding"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import {
  initialTeachers,
  type TeacherData,
  type TeacherPayType,
  LATE_DEDUCTION,
} from "@/data/courses"
import { fetchDisabledTeacherIds } from "@/lib/teacher-status"
import {
  type AttendanceRec,
  type ReportRow,
  type DeductionItem,
  type PriorLateRec,
  type Anomaly,
  calcRow,
  computeCarryIn,
  getDeductionItems,
  getAnomalies,
} from "@/lib/payroll"
import { supabase } from "@/lib/supabase"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

// ── Helpers ────────────────────────────────────────────────
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
    case "madrasa":   return initialTeachers.filter(t => t.payType === "per-session-madrasa")
    case "english": return initialTeachers.filter(t => t.payType === "per-day-english" || t.dualPayType === "per-day-english")
    case "edu":     return initialTeachers.filter(t => t.payType === "monthly-edu-support")
    case "office":  return initialTeachers.filter(t => OFFICE_TYPES.includes(t.payType))
    default:        return initialTeachers
  }
}

// ── CSV ────────────────────────────────────────────────────
function downloadCSV(
  rows: ReportRow[],
  monthLabel: string,
  instLabel: string,
  statusMap: Record<string, SalaryStatusRow>,
) {
  const header = [
    "No.", "Name", "Institution", "Pay Type",
    "Days Present", "Sessions / Hours", "Gross (",
    "Deductions (", "Net Salary (",
    "Status", "Approved At", "Paid At",
  ]
  const dataRows = rows.map((r, i) => {
    const st = statusMap[r.teacherId]
    return [
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
      st?.status ?? "pending",
      st?.approved_at ? new Date(st.approved_at).toLocaleString("en-IN") : "—",
      st?.paid_at ? new Date(st.paid_at).toLocaleString("en-IN") : "—",
    ]
  })
  const totals = [
    "", "", "", "TOTAL",
    String(rows.reduce((s, r) => s + r.daysPresent, 0)),
    "",
    String(rows.reduce((s, r) => s + r.grossPay, 0)),
    String(rows.reduce((s, r) => s + r.deductions, 0)),
    String(rows.reduce((s, r) => s + r.netPay, 0)),
    "", "", "",
  ]

  const csvLines = [
    [BRAND_NAME],
    [`Ihlamudheen Madrasa · Monthly Salary`],
    [`Month: ${monthLabel}`, `Group: ${instLabel}`],
    [`Generated: ${new Date().toLocaleString("en-IN")}`],
    [],
    header,
    ...dataRows,
    [],
    totals,
  ]
  const csv = csvLines.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `monthly-salary-${monthLabel.replace(/\s+/g, "-").toLowerCase()}.csv`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── PDF ────────────────────────────────────────────────────
async function downloadPDF(
  rows: ReportRow[],
  monthLabel: string,
  instLabel: string,
  statusMap: Record<string, SalaryStatusRow>,
) {
  const { default: jsPDF } = await import("jspdf")
  const { default: autoTable } = await import("jspdf-autotable")
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })

  const contentY = await addReportHeader(
    doc,
    "Monthly Salary Report",
    `Month: ${monthLabel}   ·   Group: ${instLabel}   ·   Generated: ${new Date().toLocaleString("en-IN")}`,
  )

  autoTable(doc, {
    startY: contentY,
    head: [["#", "Name", "Institution", "Days", "Sess/Hrs", "Gross", "Deduct.", "Net", "Status", "Paid At"]],
    body: rows.map((r, i) => {
      const st = statusMap[r.teacherId]
      const statusLabel = st?.status ?? "pending"
      return [
        i + 1,
        r.name,
        r.institution,
        r.daysPresent || 0,
        r.payType === "monthly-edu-support"
          ? `${r.hours.toFixed(1)}h/112h`
          : r.sessions > 0 ? `${r.sessions}` : r.hours > 0 ? `${r.hours.toFixed(1)}h` : "—",
        r.grossPay.toLocaleString(),
        r.deductions > 0 ? `-${r.deductions}` : "—",
        r.netPay.toLocaleString(),
        statusLabel.toUpperCase(),
        st?.paid_at ? new Date(st.paid_at).toLocaleDateString("en-IN") : "—",
      ]
    }),
    foot: [[
      "", `Total — ${rows.length} staff`, "",
      rows.reduce((s, r) => s + r.daysPresent, 0),
      "",
      rows.reduce((s, r) => s + r.grossPay, 0).toLocaleString(),
      rows.reduce((s, r) => s + r.deductions, 0).toLocaleString(),
      rows.reduce((s, r) => s + r.netPay, 0).toLocaleString(),
      "", "",
    ]],
    didParseCell: (data) => {
      // Color-code the Status column
      if (data.section === "body" && data.column.index === 8) {
        const v = String(data.cell.raw ?? "").toLowerCase()
        if (v === "paid") { data.cell.styles.textColor = [16, 130, 80]; data.cell.styles.fontStyle = "bold" }
        else if (v === "approved") { data.cell.styles.textColor = [40, 100, 180]; data.cell.styles.fontStyle = "bold" }
        else { data.cell.styles.textColor = [120, 120, 120] }
      }
    },
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [240, 240, 245], textColor: 0, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      3: { halign: "center" },
      5: { halign: "right" },
      6: { halign: "right", textColor: [200, 40, 40] },
      7: { halign: "right", fontStyle: "bold", textColor: [16, 130, 80] },
      8: { halign: "center" },
    },
  })

  doc.save(`monthly-salary-${monthLabel.replace(/\s+/g, "-").toLowerCase()}.pdf`)
}

// ── Individual payslip PDF ─────────────────────────────────
async function downloadPayslip(row: ReportRow, deductions: DeductionItem[], monthLabel: string) {
  const { default: jsPDF } = await import("jspdf")
  const { default: autoTable } = await import("jspdf-autotable")
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

  const headerY = await addReportHeader(
    doc,
    "Payslip",
    `Month: ${monthLabel}   ·   Generated: ${new Date().toLocaleString("en-IN")}`,
  )

  doc.setFontSize(11); doc.setFont("helvetica", "bold")
  doc.text(row.name, 14, headerY + 6)
  doc.setFontSize(9); doc.setFont("helvetica", "normal")
  doc.text(`Institution: ${row.institution}   |   Pay type: ${row.payTypeLabel}`, 14, headerY + 12)

  autoTable(doc, {
    startY: headerY + 18,
    head: [["Description", "Value"]],
    body: [
      ["Days Present", String(row.daysPresent)],
      ["Sessions / Hours", row.payType === "monthly-edu-support" ? `${row.hours.toFixed(1)}h / 112h` : row.sessions > 0 ? `${row.sessions} sessions` : row.hours > 0 ? `${row.hours.toFixed(1)}h` : "—"],
      ["Gross Pay", `row.grossPay.toLocaleString()}`],
      ["Deductions", row.deductions > 0 ? `row.deductions.toLocaleString()}` : "—"],
      ["Net Salary", `row.netPay.toLocaleString()}`],
    ],
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 60 }, 1: { halign: "right" } },
  })

  if (deductions.length > 0) {
    const afterTable = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? 100
    doc.setFontSize(10); doc.setFont("helvetica", "bold")
    doc.text("Deduction Breakdown", 14, afterTable + 10)

    autoTable(doc, {
      startY: afterTable + 14,
      head: [["Date", "Type", "Reason", "Marks", "Amount"]],
      body: deductions.map(d => [
        d.date,
        d.reasonType.startsWith("late") ? `Late Cat-${d.reasonType.slice(-1)}` : d.reasonType === "early-departure" ? "Early Out" : d.reasonType === "out-missing" ? "Missing Punch" : "Other",
        d.reason,
        d.minusMarks > 0 ? `${d.minusMarks} (total ${d.cumulativeMarks})` : "—",
        d.amount > 0 ? `-d.amount}` : "flagged",
      ]),
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [180, 40, 40], textColor: 255, fontStyle: "bold" },
      columnStyles: { 4: { halign: "right" } },
    })
  }

  const pageH = doc.internal.pageSize.getHeight()
  doc.setFontSize(8); doc.setFont("helvetica", "italic"); doc.setTextColor(130)
  doc.text("This is a system-generated payslip. Verify before disbursement.", 14, pageH - 12)
  doc.line(14, pageH - 26, 80, pageH - 26)
  doc.text("Authorized Signature", 14, pageH - 22)

  doc.save(`payslip-${row.name.replace(/\s+/g, "-").toLowerCase()}-${monthLabel.replace(/\s+/g, "-").toLowerCase()}.pdf`)
}

// ── Deduction report PDF ───────────────────────────────────
async function downloadDeductionReport(name: string, deductions: DeductionItem[], totalDeducted: number, monthLabel: string) {
  const { default: jsPDF } = await import("jspdf")
  const { default: autoTable } = await import("jspdf-autotable")
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

  const headerY = await addReportHeader(
    doc,
    "Deduction Report",
    `Staff: ${name}   ·   Month: ${monthLabel}   ·   Total deducted: totalDeducted}`,
  )

  autoTable(doc, {
    startY: headerY + 6,
    head: [["Date", "Session", "Type", "Reason", "Marks", "Cumulative", "Amount"]],
    body: deductions.map(d => [
      d.date,
      d.session,
      d.reasonType.startsWith("late") ? `Late Cat-${d.reasonType.slice(-1)}` : d.reasonType === "early-departure" ? "Early Out" : d.reasonType === "out-missing" ? "Missing Punch" : "Other",
      d.reason,
      d.minusMarks > 0 ? String(d.minusMarks) : "—",
      d.cumulativeMarks > 0 ? String(d.cumulativeMarks) : "—",
      d.amount > 0 ? `-d.amount}` : "flagged",
    ]),
    foot: [["", "", "", "", "", "TOTAL", `totalDeducted}`]],
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [180, 40, 40], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [240, 240, 245], textColor: 0, fontStyle: "bold" },
    columnStyles: { 6: { halign: "right" } },
  })

  doc.save(`deduction-report-${name.replace(/\s+/g, "-").toLowerCase()}-${monthLabel.replace(/\s+/g, "-").toLowerCase()}.pdf`)
}

// ── Salary status record ──────────────────────────────────
type SalaryStatus = "pending" | "approved" | "paid"

interface SalaryStatusRow {
  teacher_id: string
  year: number
  month: number
  status: SalaryStatus
  approved_by: string | null
  approved_at: string | null
  paid_by: string | null
  paid_at: string | null
  gross_pay: number
  deductions: number
  net_pay: number
}

// ── Main page ──────────────────────────────────────────────
export default function MonthlySalaryPage() {
  const { user, loading: authLoading } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const isAdmin = role === "admin" || role === "accountant"

  const months = useMemo(() => getLast12Months(), [])
  const [selectedMonth, setSelectedMonth] = useState(months[0].value)
  const [selectedInstitution, setSelectedInstitution] = useState("all")
  const [reportRows, setReportRows] = useState<ReportRow[]>([])
  const [allRecords, setAllRecords] = useState<AttendanceRec[]>([])
  const [priorRecords, setPriorRecords] = useState<PriorLateRec[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [includeZeroRows, setIncludeZeroRows] = useState(false)

  // Approval workflow
  const [statusMap, setStatusMap] = useState<Record<string, SalaryStatusRow>>({})
  const [busyTeacherId, setBusyTeacherId] = useState<string | null>(null)
  const [bulkApproving, setBulkApproving] = useState(false)

  // Deduction modal
  const [modalTeacher, setModalTeacher] = useState<TeacherData | null>(null)
  const [modalRow, setModalRow] = useState<ReportRow | null>(null)

  // Anomaly modal
  const [anomalyTeacher, setAnomalyTeacher] = useState<TeacherData | null>(null)
  const [, setAnomalyRow] = useState<ReportRow | null>(null)

  // Preview modals
  const [previewPayslip, setPreviewPayslip] = useState<{ row: ReportRow; deds: DeductionItem[] } | null>(null)
  const [previewReport, setPreviewReport] = useState<"pdf" | "csv" | null>(null)

  const generateReport = useCallback(async () => {
    setLoading(true); setFetched(false); setError(null)
    try {
      const { start, end } = getMonthRange(selectedMonth)
      // Disabled staff (left Ihlamudheen Madrasa) drop out of payroll going forward;
      // their already-approved salary snapshots are untouched.
      const disabledIds = await fetchDisabledTeacherIds()
      const teachers = filterTeachers(selectedInstitution).filter(t => !disabledIds.has(t.id))
      const ids = teachers.map(t => t.id)

      const [{ data, error: dbError }, { data: priorData }] = await Promise.all([
        supabase
          .from("staff_attendance")
          .select("teacher_id, date, session, status, late_category, early_departure_category, sessions_credited, out_missing, dual_punches, arrival_time, departure_time, session_type")
          .in("teacher_id", ids)
          .gte("date", start)
          .lte("date", end),
        supabase
          .from("staff_attendance")
          .select("teacher_id, late_category, date, session, arrival_time")
          .in("teacher_id", ids)
          .lt("date", start)
          .not("late_category", "is", null),
      ])

      if (dbError) throw new Error(dbError.message)

      const records   = (data ?? [])      as AttendanceRec[]
      const priorRecs = (priorData ?? []) as PriorLateRec[]
      const rows = teachers.map(t => calcRow(t, records, selectedInstitution, computeCarryIn(t.id, priorRecs)))
      setAllRecords(records)
      setPriorRecords(priorRecs)
      setReportRows(rows)
      setFetched(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load salary data")
    } finally {
      setLoading(false)
    }
  }, [selectedMonth, selectedInstitution])

  useEffect(() => {
    if (!authLoading && isAdmin) generateReport()
  }, [authLoading, isAdmin, generateReport])

  // ── Fetch persisted approval/payment statuses for the month
  const [y, m] = selectedMonth.split("-").map(Number)
  const fetchStatuses = useCallback(async () => {
    const { data, error: dbError } = await supabase
      .from("monthly_salaries")
      .select("teacher_id, year, month, status, approved_by, approved_at, paid_by, paid_at, gross_pay, deductions, net_pay")
      .eq("year", y)
      .eq("month", m)
    if (dbError) {
      // Table not migrated yet — fail gracefully, status will be "pending" for everyone
      if (dbError.code === "42P01") return
      console.warn("Status fetch warning:", dbError.message)
      return
    }
    const next: Record<string, SalaryStatusRow> = {}
    for (const row of (data ?? []) as SalaryStatusRow[]) {
      next[row.teacher_id] = row
    }
    setStatusMap(next)
  }, [y, m])

  useEffect(() => {
    if (!authLoading && isAdmin) fetchStatuses()
  }, [authLoading, isAdmin, fetchStatuses])

  // ── Real-time: refresh status when other devices change it
  useEffect(() => {
    if (!isAdmin) return
    const sub = subscribeToTable("monthly_salaries", () => { fetchStatuses() })
    return () => { sub.unsubscribe() }
  }, [isAdmin, fetchStatuses])

  // ── Workflow actions ──────────────────────────────────────
  const approveSalary = useCallback(async (row: ReportRow) => {
    if (!user) return
    const existing = statusMap[row.teacherId]
    if (existing?.status === "paid") {
      toast.error("Cannot approve — already paid (record is locked).")
      return
    }
    setBusyTeacherId(row.teacherId)
    try {
      const { error: upErr } = await supabase
        .from("monthly_salaries")
        .upsert({
          teacher_id: row.teacherId,
          year: y,
          month: m,
          days_present: row.daysPresent,
          sessions: row.sessions,
          hours: row.hours,
          gross_pay: row.grossPay,
          deductions: row.deductions,
          net_pay: row.netPay,
          status: "approved",
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        }, { onConflict: "teacher_id,year,month" })
      if (upErr) throw upErr
      toast.success(`Approved salary for ${row.name}`)
      fetchStatuses()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approval failed")
    } finally {
      setBusyTeacherId(null)
    }
  }, [user, statusMap, y, m, fetchStatuses])

  const markPaid = useCallback(async (row: ReportRow) => {
    if (!user) return
    const existing = statusMap[row.teacherId]
    if (existing?.status !== "approved") {
      toast.error("Approve first before marking as paid.")
      return
    }
    if (!confirm(`Mark salary for ${row.name} as PAID? This locks the record permanently.`)) return
    setBusyTeacherId(row.teacherId)
    try {
      const { error: upErr } = await supabase
        .from("monthly_salaries")
        .update({
          status: "paid",
          paid_by: user.id,
          paid_at: new Date().toISOString(),
        })
        .eq("teacher_id", row.teacherId)
        .eq("year", y)
        .eq("month", m)
      if (upErr) throw upErr
      toast.success(`Marked ${row.name} as paid`)
      fetchStatuses()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mark paid failed")
    } finally {
      setBusyTeacherId(null)
    }
  }, [user, statusMap, y, m, fetchStatuses])

  // ── Bulk approve all currently-pending rows in the filtered view ──
  const approveAllPending = useCallback(async (rows: ReportRow[]) => {
    if (!user) return
    const targets = rows.filter(r => {
      const st = statusMap[r.teacherId]?.status ?? "pending"
      return st === "pending" && r.netPay > 0
    })
    if (targets.length === 0) {
      toast.error("No pending rows with a net salary to approve.")
      return
    }
    if (!confirm(`Approve ${targets.length} pending salary record(s)? You'll still need to "Mark Paid" individually before payout.`)) return

    setBulkApproving(true)
    const payload = targets.map(r => ({
      teacher_id: r.teacherId,
      year: y,
      month: m,
      days_present: r.daysPresent,
      sessions: r.sessions,
      hours: r.hours,
      gross_pay: r.grossPay,
      deductions: r.deductions,
      net_pay: r.netPay,
      status: "approved" as const,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    }))

    try {
      const { error: upErr } = await supabase
        .from("monthly_salaries")
        .upsert(payload, { onConflict: "teacher_id,year,month" })
      if (upErr) throw upErr
      toast.success(`Approved ${targets.length} salary record(s)`)
      fetchStatuses()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk approval failed")
    } finally {
      setBulkApproving(false)
    }
  }, [user, statusMap, y, m, fetchStatuses])

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return reportRows
    const q = searchQuery.toLowerCase()
    return reportRows.filter(r => r.name.toLowerCase().includes(q))
  }, [reportRows, searchQuery])

  // Rows used for PDF/CSV/Print exports — excludes zero-salary rows unless opted in
  const exportRows = useMemo(
    () => (includeZeroRows ? filteredRows : filteredRows.filter(r => r.netPay > 0)),
    [filteredRows, includeZeroRows],
  )

  // Per-teacher anomaly map (memo — recomputes only when records change)
  const anomalyMap = useMemo(() => {
    const map: Record<string, Anomaly[]> = {}
    for (const row of reportRows) {
      const t = initialTeachers.find(t => t.id === row.teacherId)
      if (!t) continue
      const list = getAnomalies(t, allRecords)
      if (list.length > 0) map[row.teacherId] = list
    }
    return map
  }, [reportRows, allRecords])

  // ── Auth gate ────────────────────────────────────────────
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
        <Lock className="size-10 text-amber-500" />
        <p className="text-lg font-semibold text-navy-900 dark:text-white">Access Restricted</p>
        <p className="text-sm text-slate-500">
          Only Admin / Finance / Accountant can view payroll salary information.
        </p>
      </div>
    )
  }

  const monthLabel = months.find(m => m.value === selectedMonth)?.label ?? selectedMonth
  const instLabel = INSTITUTION_OPTIONS.find(o => o.value === selectedInstitution)?.label ?? "All"

  const totalGross = filteredRows.reduce((s, r) => s + r.grossPay, 0)
  const totalDeductions = filteredRows.reduce((s, r) => s + r.deductions, 0)
  const totalNet = filteredRows.reduce((s, r) => s + r.netPay, 0)
  const totalDays = filteredRows.reduce((s, r) => s + r.daysPresent, 0)
  const flaggedCount = filteredRows.filter(r => (anomalyMap[r.teacherId]?.length ?? 0) > 0).length

  const modalDeductions: DeductionItem[] = modalTeacher
    ? getDeductionItems(modalTeacher, allRecords, computeCarryIn(modalTeacher.id, priorRecords), priorRecords)
    : []

  return (
    <div className="space-y-5 pb-10 max-w-7xl mx-auto">
      {/* Hide zero-salary rows when printing without the "Include zero-salary" flag */}
      {!includeZeroRows && (
        <style dangerouslySetInnerHTML={{ __html: `@media print { [data-zero-row="true"] { display: none !important; } }` }} />
      )}
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
      >
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-navy-900 dark:text-white sm:text-3xl">
            <Wallet className="size-7 text-emerald-600" />
            Monthly Salary
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Salary computed from verified punch records. Click the warning icon next to any staff with deductions to see the audit trail.
          </p>
        </div>

        {/* Actions bar */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Zero-salary filter — applies to Export and Print */}
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={includeZeroRows}
              onChange={e => setIncludeZeroRows(e.target.checked)}
              className="rounded border-slate-300 dark:border-navy-600 accent-emerald-600"
            />
            Include zero-salary
          </label>

          {/* Export dropdown */}
          <div className="relative">
            <Button
              onClick={() => setExportOpen(v => !v)}
              disabled={loading || !fetched || exportRows.length === 0}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              <Download className="size-4" /> Export <ChevronDown className="size-4" />
            </Button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 mt-1 w-44 rounded-lg border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 shadow-lg z-20 overflow-hidden">
                  <button
                    onClick={() => { setPreviewReport("pdf"); setExportOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-navy-900 dark:text-white hover:bg-slate-100 dark:hover:bg-navy-700"
                  >
                    <FileText className="size-4 text-red-500" /> PDF
                  </button>
                  <button
                    onClick={() => { setPreviewReport("csv"); setExportOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-navy-900 dark:text-white hover:bg-slate-100 dark:hover:bg-navy-700"
                  >
                    <Sheet className="size-4 text-emerald-500" /> CSV
                  </button>
                </div>
              </>
            )}
          </div>

          <Button
            onClick={() => setPreviewReport("pdf")}
            disabled={loading || !fetched || filteredRows.length === 0}
            variant="outline"
            className="gap-2"
          >
            <Printer className="size-4" /> Print
          </Button>
          <Button
            onClick={() => approveAllPending(filteredRows)}
            disabled={loading || !fetched || bulkApproving || filteredRows.length === 0}
            className="gap-2 bg-sky-600 hover:bg-sky-700"
            title="Approve all pending salaries in the current view"
          >
            {bulkApproving ? <Loader2 className="size-4 animate-spin" /> : <ListChecks className="size-4" />}
            Approve All
          </Button>
        </div>
      </motion.div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="appearance-none rounded-xl border border-slate-200 dark:border-navy-600 bg-white dark:bg-navy-800 pl-4 pr-9 py-2.5 text-sm font-medium text-navy-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 cursor-pointer"
          >
            {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
        </div>
        <div className="relative">
          <select
            value={selectedInstitution}
            onChange={e => setSelectedInstitution(e.target.value)}
            className="appearance-none rounded-xl border border-slate-200 dark:border-navy-600 bg-white dark:bg-navy-800 pl-4 pr-9 py-2.5 text-sm font-medium text-navy-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 cursor-pointer"
          >
            {INSTITUTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
        </div>
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search teacher…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 dark:border-navy-600 bg-white dark:bg-navy-800 pl-9 pr-4 py-2.5 text-sm text-navy-900 dark:text-white shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Calculating salaries…
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <AlertCircle className="size-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-red-900 dark:text-red-200">Error loading salary data</h3>
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {fetched && !error && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          {[
            { label: "Total Payroll", value: `totalNet.toLocaleString()}`, sub: "net payable", color: "from-emerald-500 to-emerald-600" },
            { label: "Paid / Approved", value: `${filteredRows.filter(r => statusMap[r.teacherId]?.status === "paid").length} / ${filteredRows.filter(r => statusMap[r.teacherId]?.status === "approved").length}`, sub: `of ${filteredRows.length} staff`, color: "from-cyan-500 to-cyan-600" },
            { label: "Deductions",    value: `totalDeductions.toLocaleString()}`, sub: `${filteredRows.filter(r => r.deductions > 0).length} staff affected`, color: "from-red-500 to-red-600" },
            { label: "Flagged",       value: String(flaggedCount), sub: "needs review", color: "from-amber-500 to-amber-600" },
          ].map(card => (
            <div key={card.label} className={`rounded-2xl bg-gradient-to-br ${card.color} p-4 shadow-md`}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{card.label}</p>
              <p className="text-lg font-bold mt-1 leading-tight text-white">{card.value}</p>
              <p className="text-[11px] text-white/60 mt-0.5">{card.sub}</p>
            </div>
          ))}
        </motion.div>
      )}

      {/* Safety notice */}
      {fetched && !error && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm">
          <AlertTriangle className="size-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-amber-900 dark:text-amber-200">
            <strong>Payment integrity:</strong> Figures are derived solely from punch records and stored payroll rules.
            Always cross-check deductions and flagged rows before disbursing payments.
          </p>
        </div>
      )}

      {/* Table */}
      {fetched && filteredRows.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 overflow-hidden shadow-sm"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-navy-700/60 border-b border-slate-200 dark:border-navy-700">
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 w-8">#</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Name</th>
                  <th className="text-left px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hidden sm:table-cell">Institution</th>
                  <th className="text-center px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Days</th>
                  <th className="text-center px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hidden lg:table-cell">Sess/Hrs</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Gross</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hidden sm:table-cell">Deduct.</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Net Salary</th>
                  <th className="text-center px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="text-center px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hidden md:table-cell w-52">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, i) => {
                  const teacher = initialTeachers.find(t => t.id === row.teacherId)
                  const hasDeduction = row.deductions > 0
                  return (
                    <tr
                      key={row.teacherId}
                      data-zero-row={row.netPay <= 0 ? "true" : undefined}
                      className={cn(
                        "border-t border-slate-100 dark:border-navy-700/50 hover:bg-slate-50/80 dark:hover:bg-navy-700/30 transition-colors",
                        i % 2 !== 0 && "bg-slate-50/30 dark:bg-navy-800/50"
                      )}
                    >
                      <td className="px-4 py-3 text-xs text-slate-400">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-navy-100 dark:bg-navy-700 text-xs font-bold text-navy-600 dark:text-navy-200">
                            {row.name.charAt(0)}
                          </div>
                          <div className="min-w-0 flex items-center gap-1.5">
                            <p className="font-medium text-navy-900 dark:text-white text-sm leading-tight truncate max-w-[140px] sm:max-w-none">
                              {row.name}
                            </p>
                            {hasDeduction && teacher && (
                              <button
                                type="button"
                                onClick={() => { setModalTeacher(teacher); setModalRow(row) }}
                                aria-label={`View deduction details for ${row.name} — total row.deductions}`}
                                title={`Deductions: row.deductions} — click for details`}
                                className="inline-flex items-center justify-center size-5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                              >
                                <AlertCircle className="size-3.5" />
                              </button>
                            )}
                            {anomalyMap[row.teacherId] && teacher && (() => {
                              const list = anomalyMap[row.teacherId]
                              const critical = list.some(a => a.severity === "critical")
                              return (
                                <button
                                  type="button"
                                  onClick={() => { setAnomalyTeacher(teacher); setAnomalyRow(row) }}
                                  aria-label={`View ${list.length} anomaly${list.length > 1 ? "ies" : ""} for ${row.name}`}
                                  title={`${list.length} anomaly${list.length > 1 ? "ies" : ""} detected — click for details`}
                                  className={cn(
                                    "inline-flex items-center justify-center size-5 rounded-full transition-colors focus:outline-none focus:ring-2",
                                    critical
                                      ? "bg-orange-200 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 hover:bg-orange-300 dark:hover:bg-orange-900/70 focus:ring-orange-500"
                                      : "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60 focus:ring-amber-500"
                                  )}
                                >
                                  <AlertOctagon className="size-3.5" />
                                </button>
                              )
                            })()}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 hidden sm:table-cell">
                        <span className="inline-block rounded-full bg-slate-100 dark:bg-navy-700 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {row.institution}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={cn("text-sm font-semibold", row.daysPresent > 0 ? "text-navy-900 dark:text-white" : "text-slate-400")}>
                          {row.daysPresent > 0 ? row.daysPresent : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center text-sm text-slate-600 dark:text-slate-300 hidden lg:table-cell">
                        {row.payType === "monthly-edu-support"
                          ? row.hours > 0 ? `${row.hours.toFixed(1)}h/112h` : "0h/112h"
                          : row.sessions > 0 ? `${row.sessions} sess.`
                          : row.hours > 0 ? `${row.hours.toFixed(1)}h` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-navy-900 dark:text-white whitespace-nowrap">
                        {row.grossPay > 0 ? row.grossPay.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell whitespace-nowrap">
                        {row.deductions > 0
                          ? <span className="text-red-600 dark:text-red-400 font-medium">−{row.deductions}</span>
                          : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className={cn("font-bold", row.netPay > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400")}>
                          {row.netPay > 0 ? row.netPay.toLocaleString() : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        {(() => {
                          const st = statusMap[row.teacherId]?.status ?? "pending"
                          const cls =
                            st === "paid" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : st === "approved" ? "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300"
                            : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                          const label = st === "paid" ? "Paid" : st === "approved" ? "Approved" : "Pending"
                          return (
                            <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap", cls)}>
                              {st === "paid" && <ShieldCheck className="size-3" />}
                              {st === "approved" && <CheckCircle2 className="size-3" />}
                              {label}
                            </span>
                          )
                        })()}
                      </td>
                      <td className="px-3 py-3 text-center hidden md:table-cell">
                        {(() => {
                          const st = statusMap[row.teacherId]?.status ?? "pending"
                          const busy = busyTeacherId === row.teacherId
                          return (
                            <div className="flex flex-wrap items-center gap-1 justify-center">
                              <button
                                type="button"
                                onClick={() => {
                                  const t = initialTeachers.find(t => t.id === row.teacherId)
                                  const deds = t ? getDeductionItems(t, allRecords, computeCarryIn(t.id, priorRecords), priorRecords) : []
                                  setPreviewPayslip({ row, deds })
                                }}
                                title={`Download payslip for ${row.name}`}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-cyan-700 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-900/30 hover:bg-cyan-100 dark:hover:bg-cyan-900/50 transition-colors"
                              >
                                <FileText className="size-3.5" /> Payslip
                              </button>
                              {st === "pending" && (
                                <button
                                  type="button"
                                  onClick={() => approveSalary(row)}
                                  disabled={busy || row.netPay <= 0}
                                  title={row.netPay <= 0 ? "Nothing to approve" : `Approve salary for ${row.name}`}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/30 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Approve
                                </button>
                              )}
                              {st === "approved" && (
                                <button
                                  type="button"
                                  onClick={() => markPaid(row)}
                                  disabled={busy}
                                  title={`Mark ${row.name} as paid — this locks the record`}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors disabled:opacity-40"
                                >
                                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Banknote className="size-3.5" />} Mark Paid
                                </button>
                              )}
                              {st === "paid" && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-100/60 dark:bg-emerald-900/40">
                                  <Lock className="size-3.5" /> Locked
                                </span>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 dark:border-navy-500 bg-slate-100 dark:bg-navy-700/70">
                  <td colSpan={2} className="px-4 py-3">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                      Total — {filteredRows.length} staff
                    </span>
                  </td>
                  <td className="hidden sm:table-cell" />
                  <td className="px-3 py-3 text-center text-sm font-bold text-navy-900 dark:text-white">{totalDays}</td>
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
                  <td />
                  <td className="hidden md:table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
        </motion.div>
      )}

      {/* Empty */}
      {fetched && !loading && filteredRows.length === 0 && !error && (
        <div className="flex h-48 flex-col items-center justify-center gap-3 text-center">
          <Wallet className="size-10 text-slate-300 dark:text-slate-600" />
          <p className="text-slate-500 dark:text-slate-400 text-sm">No salary data for this period.</p>
        </div>
      )}

      {/* Deduction Detail Modal */}
      <Dialog
        open={!!modalTeacher}
        onOpenChange={(open) => { if (!open) { setModalTeacher(null); setModalRow(null) } }}
      >
        <DialogContent className="max-w-2xl sm:max-w-2xl">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-navy-900 dark:text-white">
            <AlertCircle className="size-5 text-red-500" />
            Deduction Details — {modalTeacher?.name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {monthLabel} · Total deducted:{" "}
            <span className="font-bold text-red-600 dark:text-red-400">
              INR {modalRow?.deductions ?? 0}
            </span>
          </DialogDescription>

          {modalDeductions.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">
              No deduction events recorded for this teacher.
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white dark:bg-navy-800 z-10">
                  <tr className="border-b border-slate-200 dark:border-navy-700">
                    <th className="text-left px-2 py-2 font-semibold text-slate-500">Date</th>
                    <th className="text-left px-2 py-2 font-semibold text-slate-500">Type</th>
                    <th className="text-left px-2 py-2 font-semibold text-slate-500">Reason</th>
                    <th className="text-center px-2 py-2 font-semibold text-slate-500">Marks</th>
                    <th className="text-right px-2 py-2 font-semibold text-slate-500">Deducted</th>
                  </tr>
                </thead>
                <tbody>
                  {modalDeductions.map((d, idx) => {
                    const typeLabel =
                      d.reasonType === "late-cat-1" ? "Late Cat-1"
                      : d.reasonType === "late-cat-2" ? "Late Cat-2"
                      : d.reasonType === "late-cat-3" ? "Late Cat-3"
                      : d.reasonType === "early-departure" ? "Early Out"
                      : d.reasonType === "out-missing" ? "Missing Punch"
                      : "Hours Short"
                    const typeColor =
                      d.reasonType.startsWith("late") ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                      : d.reasonType === "early-departure" ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
                      : d.reasonType === "out-missing" ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                      : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                    return (
                      <tr key={idx} className="border-b border-slate-100 dark:border-navy-700/50">
                        <td className="px-2 py-2 font-mono text-navy-700 dark:text-navy-200">{d.date}</td>
                        <td className="px-2 py-2">
                          <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap", typeColor)}>
                            {typeLabel}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-slate-700 dark:text-slate-300">{d.reason}</td>
                        <td className="px-2 py-2 text-center text-slate-600 dark:text-slate-400">
                          {d.minusMarks > 0 ? `${d.minusMarks} (Σ ${d.cumulativeMarks})` : "—"}
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          {d.amount > 0
                            ? <span className="font-bold text-red-600 dark:text-red-400">−INR {d.amount}</span>
                            : d.carriedForward
                            ? <span className="text-slate-400">carried</span>
                            : <span className="text-slate-400">flagged</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 dark:border-navy-500 bg-slate-50 dark:bg-navy-700/50">
                    <td colSpan={4} className="px-2 py-2 text-right font-bold text-navy-900 dark:text-white">
                      Total deductions
                    </td>
                    <td className="px-2 py-2 text-right font-bold text-red-600 dark:text-red-400 whitespace-nowrap">
                      −INR {modalRow?.deductions ?? 0}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Late deductions follow the 3-tier minus-mark rule: every {3} accumulated Cat-1 marks triggers an INR {LATE_DEDUCTION} deduction
                (Ihlamudheen per-session teachers only). Rows marked &ldquo;carried&rdquo; are late occurrences from an earlier month shown here for
                context — they count toward the running total but were not deducted this month. &ldquo;Flagged&rdquo; events do not auto-deduct —
                review them manually before payout.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-navy-700">
            {modalDeductions.length > 0 && modalTeacher && (
              <Button
                size="sm"
                className="gap-1 bg-red-600 hover:bg-red-700"
                onClick={() => downloadDeductionReport(
                  modalTeacher.name,
                  modalDeductions,
                  modalRow?.deductions ?? 0,
                  monthLabel,
                )}
              >
                <FileText className="size-4" /> Export Report
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => { setModalTeacher(null); setModalRow(null) }}>
              <X className="size-4 mr-1" /> Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Anomaly Modal */}
      <Dialog
        open={!!anomalyTeacher}
        onOpenChange={(open) => { if (!open) { setAnomalyTeacher(null); setAnomalyRow(null) } }}
      >
        <DialogContent className="max-w-2xl sm:max-w-2xl">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-navy-900 dark:text-white">
            <AlertOctagon className="size-5 text-amber-500" />
            Data Anomalies — {anomalyTeacher?.name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {monthLabel} · {(anomalyTeacher && anomalyMap[anomalyTeacher.id]?.length) ?? 0} issue(s) detected.
            These do not auto-deduct salary, but must be reviewed before payment.
          </DialogDescription>

          {anomalyTeacher && (() => {
            const list = anomalyMap[anomalyTeacher.id] ?? []
            if (list.length === 0) {
              return <div className="py-6 text-center text-sm text-slate-500">No anomalies for this teacher.</div>
            }
            return (
              <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white dark:bg-navy-800 z-10">
                    <tr className="border-b border-slate-200 dark:border-navy-700">
                      <th className="text-left px-2 py-2 font-semibold text-slate-500">Date</th>
                      <th className="text-left px-2 py-2 font-semibold text-slate-500">Session</th>
                      <th className="text-left px-2 py-2 font-semibold text-slate-500">Type</th>
                      <th className="text-left px-2 py-2 font-semibold text-slate-500">Detail</th>
                      <th className="text-center px-2 py-2 font-semibold text-slate-500">Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((a, idx) => {
                      const typeLabel =
                        a.type === "missing-punch-out" ? "Missing Punch-Out"
                        : a.type === "excessive-hours"   ? "Excessive Hours"
                        : a.type === "future-dated"      ? "Future-Dated"
                        : a.type === "duplicate"         ? "Duplicate"
                        : a.type === "out-missing-flag"  ? "Out Missing"
                        : "Dual Punches"
                      const sevCls = a.severity === "critical"
                        ? "bg-orange-200 text-orange-900 dark:bg-orange-900/50 dark:text-orange-200"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                      return (
                        <tr key={idx} className="border-b border-slate-100 dark:border-navy-700/50">
                          <td className="px-2 py-2 font-mono text-navy-700 dark:text-navy-200">{a.date}</td>
                          <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{a.session ?? "—"}</td>
                          <td className="px-2 py-2">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                              {typeLabel}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-slate-700 dark:text-slate-300">{a.detail}</td>
                          <td className="px-2 py-2 text-center">
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap uppercase", sevCls)}>
                              {a.severity}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Critical anomalies (e.g. &gt;16hr punches, future dates) likely indicate data-entry errors and must be corrected
                  in the Punch Records / Staff Attendance pages before this salary is approved.
                </p>
              </div>
            )
          })()}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-navy-700">
            <Button variant="outline" size="sm" onClick={() => { setAnomalyTeacher(null); setAnomalyRow(null) }}>
              <X className="size-4 mr-1" /> Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Payslip Preview Dialog ─────────────────────────────── */}
      <Dialog open={!!previewPayslip} onOpenChange={(o) => { if (!o) setPreviewPayslip(null) }}>
        <DialogContent className="max-w-lg sm:max-w-lg">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-navy-900 dark:text-white">
            <FileText className="size-5 text-cyan-500" />
            Payslip Preview — {previewPayslip?.row.name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {monthLabel} · Review before downloading
          </DialogDescription>
          {previewPayslip && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-slate-200 dark:border-navy-700 overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      ["Institution", previewPayslip.row.institution],
                      ["Pay Type", previewPayslip.row.payTypeLabel],
                      ["Days Present", String(previewPayslip.row.daysPresent)],
                      ["Sessions / Hours",
                        previewPayslip.row.payType === "monthly-edu-support"
                          ? `${previewPayslip.row.hours.toFixed(1)}h / 112h`
                          : previewPayslip.row.sessions > 0 ? `${previewPayslip.row.sessions} sessions`
                          : previewPayslip.row.hours > 0 ? `${previewPayslip.row.hours.toFixed(1)}h` : "—"],
                      ["Gross Pay", `previewPayslip.row.grossPay.toLocaleString()}`],
                      ["Deductions", previewPayslip.row.deductions > 0 ? `-previewPayslip.row.deductions.toLocaleString()}` : "—"],
                      ["Net Salary", `previewPayslip.row.netPay.toLocaleString()}`],
                    ].map(([k, v], i) => (
                      <tr key={k} className={cn("border-b border-slate-100 dark:border-navy-700/50", i === 6 && "bg-emerald-50 dark:bg-emerald-900/20 font-bold")}>
                        <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400 text-xs w-36">{k}</td>
                        <td className="px-4 py-2.5 font-medium text-navy-900 dark:text-white text-xs">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(statusMap[previewPayslip.row.teacherId]?.status ?? "pending") === "pending" && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-3 py-2">
                  This salary is still pending approval. The PDF will be marked as a draft.
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-navy-700">
            <Button variant="outline" size="sm" onClick={() => setPreviewPayslip(null)}>
              <X className="size-4 mr-1" /> Cancel
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-cyan-600 hover:bg-cyan-700"
              onClick={() => {
                if (previewPayslip) {
                  downloadPayslip(previewPayslip.row, previewPayslip.deds, monthLabel)
                  setPreviewPayslip(null)
                }
              }}
            >
              <Download className="size-4" /> Download Payslip
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Monthly Report Preview Dialog ─────────────────────── */}
      <Dialog open={!!previewReport} onOpenChange={(o) => { if (!o) setPreviewReport(null) }}>
        <DialogContent className="max-w-3xl sm:max-w-3xl max-h-[90vh] flex flex-col">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-navy-900 dark:text-white">
            {previewReport === "pdf" ? <FileText className="size-5 text-red-500" /> : <Sheet className="size-5 text-emerald-500" />}
            {previewReport === "pdf" ? "PDF" : "CSV"} Preview — Monthly Salary
          </DialogTitle>
          <DialogDescription className="text-xs">
            {monthLabel} · {instLabel} · {exportRows.length} staff · Review before downloading
          </DialogDescription>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-navy-700 text-white">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left hidden sm:table-cell">Institution</th>
                  <th className="px-3 py-2 text-right">Gross</th>
                  <th className="px-3 py-2 text-right">Deduct.</th>
                  <th className="px-3 py-2 text-right font-bold">Net</th>
                  <th className="px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {exportRows.map((r, i) => {
                  const st = statusMap[r.teacherId]?.status ?? "pending"
                  return (
                    <tr key={r.teacherId} className={cn("border-b border-slate-100 dark:border-navy-700/50", i % 2 && "bg-slate-50/40 dark:bg-navy-800/40")}>
                      <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-navy-900 dark:text-white">{r.name}</td>
                      <td className="px-3 py-2 text-slate-500 hidden sm:table-cell">{r.institution}</td>
                      <td className="px-3 py-2 text-right">{r.grossPay.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-red-500">{r.deductions > 0 ? `-${r.deductions}` : "—"}</td>
                      <td className="px-3 py-2 text-right font-bold text-emerald-600 dark:text-emerald-400">{r.netPay.toLocaleString()}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={cn("px-1.5 py-0.5 rounded-full text-[10px] font-semibold",
                          st === "paid" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                          : st === "approved" ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300")}>{st}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-slate-100 dark:bg-navy-700/60 font-bold">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-slate-600 dark:text-slate-300">Total</td>
                  <td className="px-3 py-2 text-right">{exportRows.reduce((s, r) => s + r.grossPay, 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-red-500">-{exportRows.reduce((s, r) => s + r.deductions, 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{exportRows.reduce((s, r) => s + r.netPay, 0).toLocaleString()}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-navy-700 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setPreviewReport(null)}>
              <X className="size-4 mr-1" /> Cancel
            </Button>
            <Button
              size="sm"
              className={cn("gap-1.5", previewReport === "pdf" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700")}
              onClick={() => {
                if (previewReport === "pdf") downloadPDF(exportRows, monthLabel, instLabel, statusMap)
                else downloadCSV(exportRows, monthLabel, instLabel, statusMap)
                setPreviewReport(null)
              }}
            >
              <Download className="size-4" />
              Download {previewReport === "pdf" ? "PDF" : "CSV"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
