"use client"

import { Fragment, useEffect, useMemo, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft, CheckCircle2, Clock, Banknote, Users, Loader2, Plus, Search, X,
  Info, AlertTriangle, ShieldAlert, ClipboardList, Download, FileText, Sheet, Mail,
} from "lucide-react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole, canManageFinance } from "@/lib/roles"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  BILLING_START_MONTH, REVERSAL_REASONS,
  allocatePayment, computePending, getMonthlyFee,
  monthLabel, shortMonthLabel,
  type LedgerEntry, type PendingSummary, type ReversalReasonId,
} from "@/lib/fee-ledger"
import { downloadFeeMemos, type FeeMemoStudent } from "@/lib/fee-memo"

// ── Constants ─────────────────────────────────────────────────────────────────
const COURSE_ORDER: Record<string, number> = { "1": 0, "2": 1, "4": 2, "3": 3 }

const PROGRAMS: Record<string, { label: string; colorClass: string }> = {
  "1": { label: "Ihlamudheen Madrasa",     colorClass: "text-emerald-400" },
  "2": { label: "Ihlamudheen Madrasa ENGLISH", colorClass: "text-sky-400"     },
  "4": { label: "EDU SUPPORT",       colorClass: "text-violet-400"  },
  "3": { label: "CIBIS",             colorClass: "text-amber-400"   },
}

function getMonthOptions() {
  const opts: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    if (value < BILLING_START_MONTH) break
    const label = d.toLocaleString("en-US", { month: "long", year: "numeric" })
    opts.push({ value, label })
  }
  if (opts.length === 0) opts.push({ value: BILLING_START_MONTH, label: monthLabel(BILLING_START_MONTH) })
  return opts
}

const PAYMENT_METHODS = ["Cash", "Bank transfer", "Card", "Cheque", "Other"] as const
type PaymentMethod = typeof PAYMENT_METHODS[number]

// Default fee-memo due date — the 15th of the current month, or next month's
// 15th if today is already past it. Returned as "YYYY-MM-DD" for <input type=date>.
function defaultDueDate(): string {
  const now = new Date()
  let y = now.getFullYear()
  let m = now.getMonth() // 0-based
  if (now.getDate() > 15) { m += 1; if (m > 11) { m = 0; y += 1 } }
  return `${y}-${String(m + 1).padStart(2, "0")}-15`
}

// ── Row type ─────────────────────────────────────────────────────────────────
interface StudentRow {
  id: string
  name: string
  rollNo: string
  classId: string
  className: string
  courseId: string
  monthlyFee: number
  summary: PendingSummary
  ledger: LedgerEntry[]
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function FeePaymentsPage() {
  const { user } = useAuth(true)
  const router = useRouter()

  useEffect(() => {
    if (user && !canManageFinance(getUserRole(user))) router.replace("/dashboard")
  }, [user, router])

  const months = useMemo(() => getMonthOptions(), [])
  const [month, setMonth]             = useState(months[0].value)
  const [students, setStudents]       = useState<StudentRow[]>([])
  const [loading, setLoading]         = useState(true)
  const [tableReady, setTableReady]   = useState(true)
  const [programFilter, setProgramFilter] = useState("all")
  const [classFilter, setClassFilter]     = useState("all")
  const [statusFilter, setStatusFilter]   = useState<"all" | "paid" | "pending">("all")

  // Inline panels
  const [breakdownFor, setBreakdownFor] = useState<string | null>(null)
  const [historyFor,   setHistoryFor]   = useState<string | null>(null)

  // Add Entry dialog
  const [addOpen, setAddOpen]         = useState(false)
  const [addFromEntry, setAddFromEntry] = useState(false) // true = opened via "+ Add Entry", false = via row "Mark Paid"
  const [query, setQuery]             = useState("")
  const [selected, setSelected]       = useState<StudentRow | null>(null)
  const [amountInput, setAmountInput] = useState("")
  const [methodInput, setMethodInput] = useState<PaymentMethod>("Cash")
  const [notesInput,  setNotesInput]  = useState("")
  const [confirmStep, setConfirmStep] = useState(false)
  const [submitting,  setSubmitting]  = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Adjust / Reverse dialog
  const [adjustOpen, setAdjustOpen]   = useState(false)
  const [adjustStudent, setAdjustStudent] = useState<StudentRow | null>(null)
  const [adjustReason, setAdjustReason]   = useState<ReversalReasonId>("wrong_amount")
  const [adjustNotes, setAdjustNotes]     = useState("")
  const [adjustAmount, setAdjustAmount]   = useState("")
  const [adjustConfirm, setAdjustConfirm] = useState("")
  const [adjustReverseId, setAdjustReverseId] = useState<number | null>(null)

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: classRows }, { data: studentRows }] = await Promise.all([
        supabase.from("classes").select("id, name, course_id"),
        supabase.from("students").select("id, name, roll_no, class_id"),
      ])
      if (!classRows || !studentRows) { setLoading(false); return }

      const { data: ledgerRows, error: payErr } = await supabase
        .from("fee_payments")
        .select("id, student_id, month, amount, entry_type, reverses_id, reason, notes, paid_at, recorded_by, created_at")
        .lte("month", month)
      if (payErr) {
        // Migration likely not applied. Surface a one-time setup notice and stop.
        setTableReady(false)
        setLoading(false)
        return
      }
      setTableReady(true)

      const classMap = Object.fromEntries(
        (classRows as { id: string; name: string; course_id: string }[]).map(c => [c.id, c]),
      )

      const ledgerByStudent = new Map<string, LedgerEntry[]>()
      for (const row of (ledgerRows ?? []) as LedgerEntry[]) {
        const list = ledgerByStudent.get(row.student_id) ?? []
        list.push(row)
        ledgerByStudent.set(row.student_id, list)
      }

      const rows: StudentRow[] = (studentRows as { id: string; name: string; roll_no: string; class_id: string }[]).map(s => {
        const cls         = classMap[s.class_id]
        const monthlyFee  = cls ? getMonthlyFee(cls.name, cls.course_id) : 0
        const ledger      = ledgerByStudent.get(s.id) ?? []
        const summary     = computePending(monthlyFee, month, ledger)
        return {
          id: s.id,
          name: s.name,
          rollNo: s.roll_no ?? "—",
          classId: s.class_id,
          className: cls?.name ?? "—",
          courseId: cls?.course_id ?? "",
          monthlyFee,
          summary,
          ledger,
        }
      })

      rows.sort((a, b) => {
        const c = (COURSE_ORDER[a.courseId] ?? 9) - (COURSE_ORDER[b.courseId] ?? 9)
        if (c !== 0) return c
        const cl = a.className.localeCompare(b.className)
        if (cl !== 0) return cl
        return a.name.localeCompare(b.name)
      })

      setStudents(rows)
      // Keep the selected student in sync with fresh data.
      setSelected(prev => prev ? (rows.find(r => r.id === prev.id) ?? null) : null)
      setAdjustStudent(prev => prev ? (rows.find(r => r.id === prev.id) ?? null) : null)
    } catch {
      // leave empty on unexpected error
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => { load() }, [load])

  // ── Class options for the class-wise filter ───────────────────────────────
  // Distinct classes present in the roster, narrowed to the selected program so
  // the picker only ever offers classes that belong to the chosen course.
  const classOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; courseId: string }>()
    for (const s of students) {
      if (programFilter !== "all" && s.courseId !== programFilter) continue
      if (!seen.has(s.classId)) seen.set(s.classId, { id: s.classId, name: s.className, courseId: s.courseId })
    }
    return Array.from(seen.values()).sort((a, b) => {
      const c = (COURSE_ORDER[a.courseId] ?? 9) - (COURSE_ORDER[b.courseId] ?? 9)
      return c !== 0 ? c : a.name.localeCompare(b.name)
    })
  }, [students, programFilter])

  // Reset the class filter whenever it no longer belongs to the chosen program.
  useEffect(() => {
    if (classFilter !== "all" && !classOptions.some(c => c.id === classFilter)) {
      setClassFilter("all")
    }
  }, [classOptions, classFilter])

  // ── Derived: filtered list + headline numbers ────────────────────────────
  const filtered = useMemo(() => students.filter(s => {
    if (programFilter !== "all" && s.courseId !== programFilter) return false
    if (classFilter !== "all" && s.classId !== classFilter) return false
    if (statusFilter === "paid"    && s.summary.totalPending > 0) return false
    if (statusFilter === "pending" && s.summary.totalPending === 0) return false
    // Skip students whose program has no auto-fee (CIBIS) from the pending/paid filters
    if (statusFilter !== "all" && s.monthlyFee === 0) return false
    return true
  }), [students, programFilter, classFilter, statusFilter])

  const totalOutstanding = filtered.reduce((n, s) => n + s.summary.totalPending, 0)
  const totalReceived = filtered.reduce(
    (n, s) => n + s.ledger.reduce((m, e) => m + (e.amount > 0 ? e.amount : 0), 0),
    0,
  )
  const studentsPending = filtered.filter(s => s.summary.totalPending > 0).length
  const studentsPaid    = filtered.filter(s => s.monthlyFee > 0 && s.summary.totalPending === 0).length

  // ── Add Entry helpers ────────────────────────────────────────────────────
  const q = query.trim().toLowerCase()
  const searchResults: StudentRow[] = q.length < 1 ? [] : students.filter(s =>
    s.rollNo.toLowerCase().includes(q) ||
    s.name.toLowerCase().includes(q) ||
    s.className.toLowerCase().includes(q)
  ).slice(0, 8)

  function openAddBlank() {
    setSelected(null); setQuery(""); setAmountInput(""); setMethodInput("Cash"); setNotesInput("")
    setConfirmStep(false); setAddFromEntry(true)
    setAddOpen(true)
    setTimeout(() => searchRef.current?.focus(), 50)
  }
  function openAddFor(s: StudentRow) {
    setSelected(s); setQuery(""); setAmountInput(String(s.summary.totalPending || ""))
    setMethodInput("Cash"); setNotesInput(""); setConfirmStep(false); setAddFromEntry(false)
    setAddOpen(true)
  }
  function closeAdd() { setAddOpen(false); setConfirmStep(false) }

  function requestConfirm() {
    if (!selected) { toast.error("Pick a student first."); return }
    const amount = Math.round(Number(amountInput))
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("Enter a positive amount."); return }
    setConfirmStep(true)
  }

  async function submitPayment() {
    if (!selected || !confirmStep) return
    const amount = Math.round(Number(amountInput))
    if (!Number.isFinite(amount) || amount <= 0) return

    setSubmitting(true)
    try {
      const { data: authData } = await supabase.auth.getUser()
      const actorId = authData?.user?.id ?? null

      const allocations = allocatePayment(amount, month, selected.summary.breakdown)
      // Defensive: if breakdown is empty (no pending) we still record one row to month.
      const rows = (allocations.length > 0 ? allocations : [{ month, amount }]).map(a => ({
        student_id:  selected.id,
        class_id:    selected.classId,
        month:       a.month,
        amount:      a.amount,
        entry_type:  "payment",
        paid_at:     new Date().toISOString(),
        reason:      null,
        notes:       notesInput.trim() ? `${methodInput} · ${notesInput.trim()}` : methodInput,
        recorded_by: actorId,
      }))

      const { data: inserted, error } = await supabase
        .from("fee_payments")
        .insert(rows)
        .select("id, student_id, month, amount, entry_type, paid_at")

      if (error) { toast.error(`Failed to record payment: ${error.message}`); return }

      // Audit log
      if (inserted && inserted.length > 0) {
        await supabase.from("fee_payment_audit").insert(
          inserted.map(r => ({
            payment_id: (r as { id: number }).id,
            action: "insert" as const,
            actor_id: actorId,
            reason: null,
            payload: r,
          }))
        )
      }

      toast.success(`Recorded amount} for ${selected.name}.`)
      closeAdd()
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  // ── Adjust / Reverse helpers ─────────────────────────────────────────────
  function openAdjustFor(s: StudentRow) {
    const lastPayment = [...s.ledger]
      .filter(e => e.entry_type === "payment")
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0]
    if (!lastPayment) {
      toast.error("No payment recorded yet for this student.")
      return
    }
    setAdjustStudent(s)
    setAdjustReverseId(lastPayment.id)
    setAdjustReason("wrong_amount")
    setAdjustNotes("")
    setAdjustAmount(String(lastPayment.amount))
    setAdjustConfirm("")
    setAdjustOpen(true)
  }

  async function submitAdjustment() {
    if (!adjustStudent || adjustReverseId === null) return
    const amount = Math.round(Number(adjustAmount))
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter the amount to reverse (positive).")
      return
    }
    const lastPayment = adjustStudent.ledger.find(e => e.id === adjustReverseId)
    if (!lastPayment) {
      toast.error("That payment no longer exists. Reload and try again.")
      return
    }
    if (amount > lastPayment.amount) {
      toast.error(`Cannot reverse more than the original lastPayment.amount}.`)
      return
    }
    if (adjustConfirm.trim() !== adjustStudent.rollNo) {
      toast.error(`Type the student's Reg No. (${adjustStudent.rollNo}) to confirm.`)
      return
    }
    if (adjustReason === "other" && adjustNotes.trim().length < 4) {
      toast.error("A short explanation is required for 'Other'.")
      return
    }

    setSubmitting(true)
    try {
      const { data: authData } = await supabase.auth.getUser()
      const actorId = authData?.user?.id ?? null
      const reasonLabel = REVERSAL_REASONS.find(r => r.id === adjustReason)?.label ?? adjustReason

      const { data: inserted, error } = await supabase.from("fee_payments").insert({
        student_id:  adjustStudent.id,
        class_id:    adjustStudent.classId,
        month:       lastPayment.month,
        amount:      -amount,
        entry_type:  "adjustment",
        reverses_id: lastPayment.id,
        reason:      reasonLabel,
        notes:       adjustNotes.trim() || null,
        paid_at:     null,
        recorded_by: actorId,
      }).select("id, student_id, month, amount, entry_type, reverses_id, reason, paid_at").single()

      if (error) { toast.error(`Reversal failed: ${error.message}`); return }

      if (inserted) {
        await supabase.from("fee_payment_audit").insert({
          payment_id: (inserted as { id: number }).id,
          action: "reverse",
          actor_id: actorId,
          reason: reasonLabel + (adjustNotes.trim() ? ` — ${adjustNotes.trim()}` : ""),
          payload: inserted,
        })
      }

      toast.success(`Reversed amount} from ${adjustStudent.name}.`)
      setAdjustOpen(false)
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  const COLS = 8

  // ── Export helpers ────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false)

  // ── Fee memo dialog ─────────────────────────────────────────────────────────
  const [memoOpen, setMemoOpen]       = useState(false)
  const [memoStudent, setMemoStudent] = useState<StudentRow | null>(null) // null = all filtered pending
  const [memoDue, setMemoDue]         = useState(defaultDueDate())
  const [memoContact, setMemoContact] = useState("")
  const [memoNote, setMemoNote]       = useState("")
  const [memoBusy, setMemoBusy]       = useState(false)

  // Students the memo will cover: a single student, or every filtered student
  // that still has a pending balance (CIBIS/zero-fee rows are excluded).
  const memoTargets: StudentRow[] = useMemo(() => {
    if (memoStudent) return [memoStudent]
    return filtered.filter(s => s.monthlyFee > 0 && s.summary.totalPending > 0)
  }, [memoStudent, filtered])

  function openMemo(student: StudentRow | null) {
    setMemoStudent(student)
    setMemoNote("")
    setMemoOpen(true)
  }

  async function generateMemos() {
    if (memoTargets.length === 0) {
      toast.error("No students with a pending balance to memo.")
      return
    }
    setMemoBusy(true)
    try {
      const payload: FeeMemoStudent[] = memoTargets.map(s => ({
        name: s.name,
        rollNo: s.rollNo,
        className: s.className,
        programLabel: PROGRAMS[s.courseId]?.label ?? "—",
        monthlyFee: s.monthlyFee,
        totalPending: s.summary.totalPending,
        breakdown: s.summary.breakdown.map(b => ({ month: b.month, pending: b.pending })),
      }))
      const scopeLabel = memoStudent
        ? undefined
        : classFilter !== "all"
          ? classOptions.find(c => c.id === classFilter)?.name
          : programFilter !== "all"
            ? PROGRAMS[programFilter]?.label
            : undefined
      const res = await downloadFeeMemos(payload, {
        dueDateISO: memoDue,
        asOfMonthLabel: monthLabel(month),
        contact: memoContact,
        note: memoNote,
        scopeLabel,
      })
      if (res.ok) { toast.success(res.message ?? "Fee memos downloaded."); setMemoOpen(false) }
      else toast.error(res.message ?? "Could not generate memos.")
    } catch {
      toast.error("Could not generate the memo PDF.")
    } finally {
      setMemoBusy(false)
    }
  }

  async function exportCSV() {
    setExporting(true)
    try {
      const headers = ["#", "Reg No.", "Student", "Class", "Program", "Monthly Fee (", "Pending Fee (", "Status", "Pending Months"]
      const rows = filtered.map((s, i) => [
        i + 1,
        s.rollNo,
        s.name,
        s.className,
        PROGRAMS[s.courseId]?.label ?? "",
        s.monthlyFee,
        s.summary.totalPending,
        s.monthlyFee === 0 ? "Manual" : s.summary.totalPending === 0 ? "Paid" : "Pending",
        s.summary.breakdown.map(b => `${monthLabel(b.month)}: b.pending}`).join(" | "),
      ])

      const csv = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n")

      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `fee-payments-${month}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  async function exportPDF() {
    setExporting(true)
    try {
      const { default: jsPDF } = await import("jspdf")
      const { default: autoTable } = await import("jspdf-autotable")
      const { addReportHeader } = await import("@/lib/branding")

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
      const subtitle = `${monthLabel(month)}  ·  Generated ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
      const startY = await addReportHeader(doc, "Fee Payments Report", subtitle)

      // Summary row
      const pageW = doc.internal.pageSize.getWidth()
      doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(80)
      const summaryLine = [
        `Collected (lifetime): totalReceived.toLocaleString()}`,
        `Outstanding: totalOutstanding.toLocaleString()}`,
        `Paid: ${studentsPaid}`,
        `Pending: ${studentsPending}`,
        `Shown: ${filtered.length} students`,
      ].join("     ")
      doc.text(summaryLine, 14, startY)
      doc.setTextColor(0)

      autoTable(doc, {
        startY: startY + 5,
        head: [["#", "Reg No.", "Student", "Class", "Program", "Monthly Fee", "Pending Fee", "Status", "Unpaid Months"]],
        body: filtered.map((s, i) => [
          i + 1,
          s.rollNo,
          s.name,
          s.className,
          PROGRAMS[s.courseId]?.label ?? "",
          s.monthlyFee > 0 ? `s.monthlyFee}` : "TBD",
          s.monthlyFee > 0 ? `s.summary.totalPending}` : "—",
          s.monthlyFee === 0 ? "Manual" : s.summary.totalPending === 0 ? "Paid" : "Pending",
          s.summary.breakdown.map(b => `${shortMonthLabel(b.month)} b.pending}`).join(", ") || "—",
        ]),
        foot: [[
          "", "", `Total: ${filtered.length}`, "", "",
          "", `totalOutstanding.toLocaleString()} pending`, "", "",
        ]],
        headStyles:  { fillColor: [30, 58, 95], fontSize: 7, fontStyle: "bold" },
        footStyles:  { fillColor: [240, 240, 240], fontSize: 7, fontStyle: "bold", textColor: [30, 58, 95] },
        bodyStyles:  { fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 8 },
          1: { cellWidth: 14 },
          2: { cellWidth: 42 },
          3: { cellWidth: 20 },
          4: { cellWidth: 28 },
          5: { cellWidth: 20, halign: "center" },
          6: { cellWidth: 20, halign: "center" },
          7: { cellWidth: 16, halign: "center" },
          8: { cellWidth: "auto" },
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didParseCell(data) {
          if (data.section === "body" && data.column.index === 7) {
            const val = data.cell.raw as string
            data.cell.styles.textColor = val === "Paid" ? [22, 163, 74] : val === "Pending" ? [217, 119, 6] : [100, 116, 139]
            data.cell.styles.fontStyle = "bold"
          }
        },
      })

      // Page numbers
      const pageCount = (doc.internal as unknown as { getNumberOfPages(): number }).getNumberOfPages()
      for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p)
        doc.setFontSize(7); doc.setTextColor(150)
        doc.text(`Page ${p} of ${pageCount}`, pageW - 14, doc.internal.pageSize.getHeight() - 6, { align: "right" })
        doc.setTextColor(0)
      }

      doc.save(`fee-payments-${month}.pdf`)
    } finally {
      setExporting(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/fees">
            <Button variant="ghost" size="sm" className="gap-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-white">
              <ArrowLeft className="size-4" /> Fees
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-navy-900 dark:text-white">Fee Payments</h1>
            <p className="text-xs text-slate-500">Cumulative pending balance per student · ledger-tracked</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={openAddBlank}>
            <Plus className="size-4" /> Add Entry
          </Button>

          {/* Export dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={exporting || filtered.length === 0}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-navy-600 bg-background hover:bg-muted h-8 px-3 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {exporting
                ? <Loader2 className="size-4 animate-spin" />
                : <Download className="size-4" />}
              Export
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5 text-[10px] text-slate-400 uppercase tracking-wide border-b border-slate-100 dark:border-navy-700 mb-1">
                {filtered.length} students · {monthLabel(month)}
              </div>
              <DropdownMenuItem onClick={exportCSV}>
                <Sheet className="size-4 mr-2 text-emerald-600" />
                CSV / Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportPDF}>
                <FileText className="size-4 mr-2 text-red-500" />
                PDF Report
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openMemo(null)}>
                <Mail className="size-4 mr-2 text-sky-500" />
                Fee Memos (PDF)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Select value={month} onValueChange={(v) => v && setMonth(v as string)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Setup notice */}
      {!tableReady && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <strong>One-time setup required.</strong> Apply the latest migration{" "}
          <code className="font-mono">20260525210000_fee_payments_ledger.sql</code> in your Supabase project.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Collected (lifetime)", value: `totalReceived.toLocaleString()}`,    icon: Banknote,     ring: "border-emerald-200 dark:border-emerald-500/30", iconClass: "text-emerald-500" },
          { label: "Outstanding",          value: `totalOutstanding.toLocaleString()}`, icon: Clock,        ring: "border-amber-200 dark:border-amber-500/30",     iconClass: "text-amber-500"  },
          { label: "Students Paid",        value: `${studentsPaid}`,                          icon: CheckCircle2, ring: "border-emerald-200 dark:border-emerald-500/30", iconClass: "text-emerald-500" },
          { label: "Students Pending",     value: `${studentsPending}`,                       icon: Users,        ring: "border-amber-200 dark:border-amber-500/30",     iconClass: "text-amber-500"  },
        ].map((card, i) => (
          <Card key={i} className={cn("border", card.ring)}>
            <CardContent className="p-4 flex items-center gap-3">
              <card.icon className={cn("size-5 shrink-0", card.iconClass)} />
              <div>
                <p className="text-[11px] text-slate-500">{card.label}</p>
                <p className="text-base font-bold text-navy-900 dark:text-white">{card.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">Program:</span>
        {[{ id: "all", label: "All" }, ...Object.entries(PROGRAMS).map(([id, p]) => ({ id, label: p.label }))].map(p => (
          <Button key={p.id} size="sm" variant={programFilter === p.id ? "default" : "outline"}
            className="h-7 text-xs" onClick={() => setProgramFilter(p.id)}>
            {p.label}
          </Button>
        ))}
        <span className="text-xs text-slate-400 font-medium uppercase tracking-wide ml-2">Class:</span>
        <Select value={classFilter} onValueChange={(v) => v && setClassFilter(v as string)}>
          <SelectTrigger className="h-7 w-44 text-xs"><SelectValue placeholder="All classes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classes</SelectItem>
            {classOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-slate-400 font-medium uppercase tracking-wide ml-2">Status:</span>
        {[{ id: "all", label: "All" }, { id: "paid", label: "Paid" }, { id: "pending", label: "Pending" }].map(s => (
          <Button key={s.id} size="sm" variant={statusFilter === s.id ? "default" : "outline"}
            className="h-7 text-xs" onClick={() => setStatusFilter(s.id as typeof statusFilter)}>
            {s.label}
          </Button>
        ))}
      </div>

      {/* Table */}
      <Card className="border-slate-200 dark:border-navy-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-navy-700 bg-slate-50 dark:bg-navy-800/40">
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide w-10">#</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Reg No.</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Student</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Class</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide hidden md:table-cell">Program</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Pending Fee</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLS} className="px-4 py-10 text-center">
                  <Loader2 className="size-5 animate-spin text-slate-400 mx-auto" />
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={COLS} className="px-4 py-10 text-center text-slate-400 text-sm">
                  No students match the current filters.
                </td></tr>
              ) : filtered.map((s, i) => {
                const pending = s.summary.totalPending
                const isPaid = s.monthlyFee > 0 && pending === 0
                const isCibis = s.monthlyFee === 0
                const isOpen = breakdownFor === s.id
                return (
                  <Fragment key={s.id}>
                    <tr className={cn(
                      "border-t border-slate-100 dark:border-navy-700/50 transition-colors",
                      i % 2 !== 0 && "bg-slate-50/40 dark:bg-navy-800/20"
                    )}>
                      <td className="px-4 py-2.5 text-xs text-slate-400">{i + 1}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-slate-500 dark:text-slate-400">{s.rollNo}</td>
                      <td className="px-4 py-2.5 font-medium text-navy-900 dark:text-white">{s.name}</td>
                      <td className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300">{s.className}</td>
                      <td className={cn("px-4 py-2.5 text-xs font-medium hidden md:table-cell", PROGRAMS[s.courseId]?.colorClass ?? "text-slate-400")}>
                        {PROGRAMS[s.courseId]?.label ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-center text-sm">
                        {isCibis ? (
                          <span className="text-slate-400">TBD</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <span className={cn("font-semibold", pending > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-500")}>
                              INR {pending.toLocaleString()}
                            </span>
                            {s.summary.breakdown.length > 0 && (
                              <button
                                aria-label="Show pending months"
                                title={`${s.summary.breakdown.length} month${s.summary.breakdown.length > 1 ? "s" : ""} pending`}
                                onClick={() => { setBreakdownFor(isOpen ? null : s.id); setHistoryFor(null) }}
                                className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300"
                              >
                                <Info className="size-3.5" />
                              </button>
                            )}
                            {s.ledger.filter(e => e.entry_type === "payment").length > 0 && (
                              <button
                                aria-label="View payment history"
                                title="View payment history"
                                onClick={() => { setHistoryFor(historyFor === s.id ? null : s.id); setBreakdownFor(null) }}
                                className={cn("hover:text-sky-700 dark:hover:text-sky-300",
                                  historyFor === s.id ? "text-sky-600 dark:text-sky-400" : "text-slate-400"
                                )}
                              >
                                <ClipboardList className="size-3.5" />
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {isCibis ? (
                          <Badge variant="outline" className="text-[11px] bg-slate-500/10 text-slate-500 border-slate-300">Manual</Badge>
                        ) : (
                          <Badge variant="outline" className={cn("text-[11px] font-semibold",
                            isPaid
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/40"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-500/40"
                          )}>
                            {isPaid ? "Paid" : "Pending"}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {!isCibis && pending > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              title="Download fee memo for this student"
                              onClick={() => openMemo(s)}
                              className="text-xs h-7 px-2 border-sky-300 text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-500/10"
                            >
                              <Mail className="size-3.5" />
                              <span className="hidden sm:inline ml-1">Memo</span>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isCibis}
                            onClick={() => openAddFor(s)}
                            className={cn("text-xs h-7 min-w-[88px]",
                              !isPaid && !isCibis
                                ? "border-emerald-400 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                                : "border-slate-300 text-slate-500 hover:bg-slate-50 dark:hover:bg-navy-700"
                            )}
                          >
                            {isPaid ? "Add Payment" : "Mark Paid"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-amber-50/40 dark:bg-amber-500/5 border-t border-amber-200/60 dark:border-amber-500/20">
                        <td colSpan={COLS} className="px-4 py-3">
                          <BreakdownPanel student={s} onClose={() => setBreakdownFor(null)} />
                        </td>
                      </tr>
                    )}
                    {historyFor === s.id && (
                      <tr className="bg-sky-50/40 dark:bg-sky-500/5 border-t border-sky-200/60 dark:border-sky-500/20">
                        <td colSpan={COLS} className="px-4 py-3">
                          <HistoryPanel student={s} onClose={() => setHistoryFor(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
            {!loading && filtered.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 dark:border-navy-600 bg-slate-50 dark:bg-navy-700/40 font-bold">
                  <td colSpan={5} className="px-4 py-2.5 text-xs uppercase tracking-wide text-slate-500">
                    Total ({filtered.length} students)
                  </td>
                  <td className="px-4 py-2.5 text-center text-amber-600 dark:text-amber-400 text-sm">
                    INR {totalOutstanding.toLocaleString()}
                  </td>
                  <td colSpan={2} className="px-4 py-2.5 text-right text-emerald-600 dark:text-emerald-400 text-sm">
                    INR {totalReceived.toLocaleString()} collected
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {/* ── Add Entry dialog ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Fee Payment</DialogTitle>
            <DialogDescription>
              Enter the amount received. Partial payments are credited oldest-month first.
            </DialogDescription>
          </DialogHeader>

          {!selected ? (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                <Input
                  ref={searchRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Reg No., student name, or class…"
                  className="pl-9"
                />
              </div>
              {q.length > 0 && (
                <div className="rounded-lg border border-slate-200 dark:border-navy-600 divide-y divide-slate-100 dark:divide-navy-700 overflow-hidden max-h-64 overflow-y-auto">
                  {searchResults.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-4">No students found.</p>
                  ) : searchResults.map(s => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSelected(s)
                        setAmountInput(String(s.summary.totalPending || ""))
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-navy-700/60 transition-colors flex items-center gap-3"
                    >
                      <span className="text-xs text-slate-400 w-14 shrink-0 font-mono">{s.rollNo}</span>
                      <span className="font-medium text-sm text-navy-900 dark:text-white flex-1 truncate">{s.name}</span>
                      <span className="text-xs text-slate-500">{s.className}</span>
                      <span className={cn("text-xs font-semibold",
                        s.summary.totalPending > 0 ? "text-amber-600" : "text-emerald-600")}>
                        INR {s.summary.totalPending}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 dark:border-navy-600 bg-slate-50 dark:bg-navy-800/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-navy-900 dark:text-white text-sm">{selected.name}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Reg: <span className="font-mono">{selected.rollNo}</span>
                      &nbsp;·&nbsp;{selected.className}
                      &nbsp;·&nbsp;<span className={PROGRAMS[selected.courseId]?.colorClass}>{PROGRAMS[selected.courseId]?.label}</span>
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setSelected(null)}>Change</Button>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <span className="text-slate-500">Monthly fee: <strong className="text-navy-900 dark:text-white">INR {selected.monthlyFee}</strong></span>
                  <span className="text-slate-500">Total pending: <strong className={selected.summary.totalPending > 0 ? "text-amber-600" : "text-emerald-600"}>INR {selected.summary.totalPending}</strong></span>
                </div>
                {selected.summary.breakdown.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selected.summary.breakdown.map(b => (
                      <Badge key={b.month} variant="outline" className="text-[10px] bg-amber-500/10 border-amber-300 text-amber-700 dark:text-amber-400">
                        {shortMonthLabel(b.month)} · INR {b.pending}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Amount Received (</label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={amountInput}
                    onChange={e => setAmountInput(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Payment Method</label>
                  <Select value={methodInput} onValueChange={v => v && setMethodInput(v as PaymentMethod)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Notes (optional)</label>
                <Input
                  value={notesInput}
                  onChange={e => setNotesInput(e.target.value)}
                  placeholder="Receipt #, reference, parent name…"
                />
              </div>

              {/* Reverse option — only visible from "+ Add Entry", not from row "Mark Paid" */}
              {addFromEntry && selected.ledger.filter(e => e.entry_type === "payment").length > 0 && (
                <div className="border-t border-slate-200 dark:border-navy-600 pt-3">
                  <button
                    type="button"
                    onClick={() => { closeAdd(); openAdjustFor(selected) }}
                    className="text-xs text-red-600 dark:text-red-400 hover:underline flex items-center gap-1.5"
                  >
                    <ShieldAlert className="size-3.5" />
                    Reverse a previously recorded payment instead
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Confirmation step ── */}
          {confirmStep && selected && (
            <div className="rounded-lg border-2 border-emerald-400 dark:border-emerald-500/60 bg-emerald-50/60 dark:bg-emerald-500/10 p-4 space-y-2">
              <p className="font-semibold text-sm text-navy-900 dark:text-white flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600" /> Confirm Payment
              </p>
              <div className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
                <p>Student: <strong>{selected.name}</strong> (Reg {selected.rollNo})</p>
                <p>Amount: <strong className="text-emerald-700 dark:text-emerald-400">INR {Math.round(Number(amountInput)).toLocaleString()}</strong></p>
                <p>Method: <strong>{methodInput}</strong>{notesInput ? ` · ${notesInput}` : ""}</p>
                {Number(amountInput) > selected.summary.totalPending && selected.summary.totalPending > 0 && (
                  <p className="text-amber-600 dark:text-amber-400 text-xs font-medium">
                    Overpayment: INR {Math.round(Number(amountInput)) - selected.summary.totalPending} will be recorded as credit.
                  </p>
                )}
              </div>
              <p className="text-xs text-slate-500">This action cannot be undone directly. Use the Reverse Payment option if needed.</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={confirmStep ? () => setConfirmStep(false) : closeAdd}>
              {confirmStep ? "Back" : "Cancel"}
            </Button>
            {!confirmStep ? (
              <Button
                disabled={!selected || !amountInput || Number(amountInput) <= 0}
                onClick={requestConfirm}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Review Payment
              </Button>
            ) : (
              <Button
                disabled={submitting}
                onClick={submitPayment}
                className="bg-emerald-700 hover:bg-emerald-800 text-white"
              >
                {submitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Yes, Confirm &amp; Record
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Adjust / Reverse dialog ── */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="size-5" /> Reverse Payment
            </DialogTitle>
            <DialogDescription>
              This action is logged. The original entry is preserved — a linked reversal entry is added to the ledger.
            </DialogDescription>
          </DialogHeader>

          {adjustStudent && (
            <div className="space-y-4">
              <div className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50/60 dark:bg-red-500/10 p-3 text-sm">
                <p className="font-semibold text-navy-900 dark:text-white">{adjustStudent.name}</p>
                <p className="text-[11px] text-slate-500 font-mono">Reg: {adjustStudent.rollNo} · {adjustStudent.className}</p>
                {(() => {
                  const p = adjustStudent.ledger.find(e => e.id === adjustReverseId)
                  if (!p) return null
                  return (
                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                      Reversing payment of <strong>INR {p.amount}</strong> recorded for <strong>{monthLabel(p.month)}</strong>
                      {p.paid_at ? <> on {new Date(p.paid_at).toLocaleDateString("en-GB")}</> : null}.
                    </p>
                  )
                })()}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Amount to Reverse (</label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={adjustAmount}
                    onChange={e => setAdjustAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">Reason</label>
                  <Select value={adjustReason} onValueChange={v => v && setAdjustReason(v as ReversalReasonId)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REVERSAL_REASONS.map(r => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">
                  Notes {adjustReason === "other" && <span className="text-red-500">(required)</span>}
                </label>
                <Input
                  value={adjustNotes}
                  onChange={e => setAdjustNotes(e.target.value)}
                  placeholder="Short explanation for the audit log"
                />
              </div>

              <div className="space-y-1 rounded-lg border border-red-300 dark:border-red-500/40 bg-red-50/40 dark:bg-red-500/5 p-3">
                <label className="text-xs font-semibold text-red-700 dark:text-red-400">
                  Type the student&apos;s Reg No. ({adjustStudent.rollNo}) to confirm
                </label>
                <Input
                  value={adjustConfirm}
                  onChange={e => setAdjustConfirm(e.target.value)}
                  placeholder={adjustStudent.rollNo}
                  className="font-mono"
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
            <Button
              disabled={
                submitting ||
                !adjustStudent ||
                !adjustAmount ||
                Number(adjustAmount) <= 0 ||
                adjustConfirm.trim() !== (adjustStudent?.rollNo ?? "___")
              }
              onClick={submitAdjustment}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {submitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Confirm Reversal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Fee Memo dialog ── */}
      <Dialog open={memoOpen} onOpenChange={setMemoOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="size-5 text-sky-500" /> Fee Memo
            </DialogTitle>
            <DialogDescription>
              {memoStudent
                ? <>A payment-reminder letter for <strong>{memoStudent.name}</strong> (Reg {memoStudent.rollNo}).</>
                : <>A payment-reminder letter for every student with a pending balance in the current view — one memo per page.</>}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Scope summary */}
            <div className="rounded-lg border border-slate-200 dark:border-navy-600 bg-slate-50 dark:bg-navy-800/60 p-3 text-sm">
              {memoStudent ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-navy-900 dark:text-white">{memoStudent.name}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Reg <span className="font-mono">{memoStudent.rollNo}</span> · {memoStudent.className}
                      &nbsp;·&nbsp;<span className={PROGRAMS[memoStudent.courseId]?.colorClass}>{PROGRAMS[memoStudent.courseId]?.label}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] text-slate-500">Pending</p>
                    <p className="font-bold text-amber-600 dark:text-amber-400">INR {memoStudent.summary.totalPending.toLocaleString()}</p>
                  </div>
                </div>
              ) : (
                <p className="text-slate-600 dark:text-slate-300">
                  <strong className="text-navy-900 dark:text-white">{memoTargets.length}</strong> student{memoTargets.length === 1 ? "" : "s"} with a pending balance
                  {classFilter !== "all"
                    ? <> in <strong>{classOptions.find(c => c.id === classFilter)?.name}</strong></>
                    : programFilter !== "all" && <> in <strong>{PROGRAMS[programFilter]?.label}</strong></>}
                  {" "}as of <strong>{monthLabel(month)}</strong>.
                  {memoTargets.length === 0 && (
                    <span className="block mt-1 text-amber-600 dark:text-amber-400">
                      Nothing to generate — all shown students are settled.
                    </span>
                  )}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Pay on or before</label>
                <Input type="date" value={memoDue} onChange={e => setMemoDue(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500">Office contact (optional)</label>
                <Input
                  value={memoContact}
                  onChange={e => setMemoContact(e.target.value)}
                  placeholder="Phone or email"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">Extra note (optional)</label>
              <Input
                value={memoNote}
                onChange={e => setMemoNote(e.target.value)}
                placeholder="e.g. Kindly clear dues before the term-end exams."
              />
            </div>

            <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
              <Info className="size-3.5 shrink-0 mt-0.5" />
              Memos use the live pending balance and per-month breakdown. The letter carries the
              Ihlamudheen Madrasa letterhead and can be printed or shared with parents directly.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMemoOpen(false)}>Cancel</Button>
            <Button
              disabled={memoBusy || memoTargets.length === 0 || !memoDue}
              onClick={generateMemos}
              className="bg-sky-600 hover:bg-sky-700 text-white"
            >
              {memoBusy ? <Loader2 className="size-4 animate-spin mr-2" /> : <Download className="size-4 mr-2" />}
              {memoStudent ? "Download Memo" : `Download ${memoTargets.length || ""} Memo${memoTargets.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Breakdown panel ──────────────────────────────────────────────────────────
// ── History panel ────────────────────────────────────────────────────────────
function HistoryPanel({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const entries = [...student.ledger].sort((a, b) =>
    (b.paid_at ?? b.created_at).localeCompare(a.paid_at ?? a.created_at)
  )

  function fmtDate(iso: string | null) {
    if (!iso) return "—"
    const d = new Date(iso)
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  }
  function fmtTime(iso: string | null) {
    if (!iso) return ""
    return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  }

  return (
    <div className="rounded-lg border border-sky-300/60 dark:border-sky-500/30 bg-white dark:bg-navy-800/60 p-3 text-sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="font-semibold text-navy-900 dark:text-white flex items-center gap-1.5">
          <ClipboardList className="size-4 text-sky-500" />
          Payment history — {student.name}
        </p>
        <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-slate-400">No payment records found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-navy-700">
                <th className="text-left pb-1.5 pr-4 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Date</th>
                <th className="text-left pb-1.5 pr-4 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Time</th>
                <th className="text-left pb-1.5 pr-4 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">For Month</th>
                <th className="text-right pb-1.5 pr-4 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Amount</th>
                <th className="text-left pb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Notes / Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-navy-700/50">
              {entries.map(e => {
                const isAdj = e.entry_type === "adjustment"
                return (
                  <tr key={e.id} className={cn("", isAdj && "opacity-70")}>
                    <td className="py-1.5 pr-4 font-medium text-navy-900 dark:text-white whitespace-nowrap">
                      {fmtDate(e.paid_at ?? e.created_at)}
                    </td>
                    <td className="py-1.5 pr-4 text-slate-500 whitespace-nowrap">
                      {fmtTime(e.paid_at ?? e.created_at)}
                    </td>
                    <td className="py-1.5 pr-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {monthLabel(e.month)}
                    </td>
                    <td className={cn("py-1.5 pr-4 text-right font-bold tabular-nums whitespace-nowrap",
                      isAdj ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"
                    )}>
                      {isAdj ? "−" : "+"}INR {Math.abs(e.amount).toLocaleString()}
                    </td>
                    <td className="py-1.5 text-slate-500 max-w-[200px] truncate">
                      {isAdj
                        ? <span className="text-red-500 dark:text-red-400">{e.reason}{e.notes ? ` · ${e.notes}` : ""}</span>
                        : (e.notes ?? "—")}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 dark:border-navy-600">
                <td colSpan={3} className="pt-1.5 text-[10px] text-slate-400 uppercase tracking-wide">Net received</td>
                <td className="pt-1.5 pr-4 text-right font-bold text-sky-700 dark:text-sky-400 tabular-nums">
                  INR {entries.reduce((n, e) => n + e.amount, 0).toLocaleString()}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function BreakdownPanel({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const { breakdown, fullyPaidMonths, totalCredit } = student.summary
  return (
    <div className="rounded-lg border border-amber-300/60 dark:border-amber-500/30 bg-white dark:bg-navy-800/60 p-3 text-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="font-semibold text-navy-900 dark:text-white flex items-center gap-1.5">
          <Info className="size-4 text-amber-500" />
          Pending breakdown — {student.name}
        </p>
        <Button variant="ghost" size="icon-sm" className="h-6 w-6" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>
      {breakdown.length === 0 ? (
        <p className="text-xs text-slate-500">All months are settled.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {breakdown.map(b => (
            <div key={b.month} className="rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5 px-3 py-2">
              <p className="text-[11px] text-slate-500">{monthLabel(b.month)}</p>
              <p className="text-sm font-bold text-amber-700 dark:text-amber-400">INR {b.pending}</p>
              {b.received > 0 && (
                <p className="text-[10px] text-slate-400">paid INR {b.received} / {b.due}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {(fullyPaidMonths.length > 0 || totalCredit > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          {fullyPaidMonths.length > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400">
              Paid: {fullyPaidMonths.map(shortMonthLabel).join(", ")}
            </span>
          )}
          {totalCredit > 0 && (
            <span className="text-sky-600 dark:text-sky-400">· Credit balance: INR {totalCredit}</span>
          )}
        </div>
      )}
    </div>
  )
}
