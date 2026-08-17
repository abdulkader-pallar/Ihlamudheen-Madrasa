"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import {
  Wallet, TrendingUp, TrendingDown, Plus, Search, Trash2, Pencil, X, Check,
  Download, Printer, ListOrdered, RefreshCw,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/hooks/use-auth"
import { DashboardSkeleton } from "@/components/loading-skeleton"
import { fmt, fmtDate, todayISO } from "@/lib/format"
import { downloadCSV } from "@/lib/csv"
import { cn } from "@/lib/utils"
import {
  fetchMeeladEntries, fetchMeeladYears, addMeeladEntry, updateMeeladEntry, deleteMeeladEntry,
  summarise, categoryTotals,
  MEELAD_PAYMENT_MODES, MEELAD_INCOME_CATEGORIES, MEELAD_EXPENSE_CATEGORIES,
  type MeeladEntry, type MeeladEntryInput, type MeeladEntryType, type MeeladPaymentMode,
} from "@/lib/meelad-accounts"

// Meelad ul Nabi program accounts — a standalone income/expenditure book.
// Separate table, separate totals, super-admin only (enforced by RLS; the check
// here is just the UI layer). See supabase/meelad-accounts.sql.

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

const CURRENT_YEAR = new Date().getFullYear()

const emptyForm = (): MeeladEntryInput => ({
  programYear: CURRENT_YEAR,
  entryDate: todayISO(),
  type: "income",
  amount: 0,
  category: "",
  description: "",
  party: "",
  paymentMode: "cash",
  voucherNo: "",
  remarks: "",
})

export default function MeeladAccountsPage() {
  const { user, loading: authLoading } = useAuth(true)

  const [year, setYear] = useState(CURRENT_YEAR)
  const [knownYears, setKnownYears] = useState<number[]>([])
  const [entries, setEntries] = useState<MeeladEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<MeeladEntryInput>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string>()

  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | MeeladEntryType>("all")

  const load = useCallback(async (y: number) => {
    setLoading(true)
    setError(undefined)
    const [{ entries: rows, error: err }, years] = await Promise.all([
      fetchMeeladEntries(y),
      fetchMeeladYears(),
    ])
    if (err) setError(err)
    setEntries(rows)
    setKnownYears(years)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load(year)
  }, [year, load])

  // Balance after each entry, in date order — the running total a paper book
  // would carry down the page. Keyed by id so it survives filtering.
  const runningBalance = useMemo(() => {
    const map = new Map<string, number>()
    let bal = 0
    for (const e of entries) {
      bal += e.type === "income" ? e.amount : -e.amount
      map.set(e.id, bal)
    }
    return map
  }, [entries])

  const summary = useMemo(() => summarise(entries), [entries])
  const incomeByCategory = useMemo(() => categoryTotals(entries, "income"), [entries])
  const expenseByCategory = useMemo(() => categoryTotals(entries, "expense"), [entries])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries
      .filter((e) => filter === "all" || e.type === filter)
      .filter((e) => {
        if (!q) return true
        return [e.description, e.category, e.party, e.voucherNo, e.remarks]
          .some((f) => f?.toLowerCase().includes(q))
      })
      .slice()
      .reverse() // newest first on screen; the running balance stays chronological
  }, [entries, filter, search])

  // Existing categories join the suggestion list so the book stays consistent.
  const categorySuggestions = useMemo(() => {
    const base = form.type === "income" ? MEELAD_INCOME_CATEGORIES : MEELAD_EXPENSE_CATEGORIES
    const used = entries.filter((e) => e.type === form.type).map((e) => e.category).filter(Boolean) as string[]
    return [...new Set([...base, ...used])].sort()
  }, [form.type, entries])

  const yearOptions = useMemo(() => {
    const span = [CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2]
    return [...new Set([...span, ...knownYears, year])].sort((a, b) => b - a)
  }, [knownYears, year])

  function openAdd() {
    setForm({ ...emptyForm(), programYear: year })
    setEditingId(null)
    setFormError(undefined)
    setShowForm(true)
  }

  function openEdit(e: MeeladEntry) {
    setForm({
      programYear: e.programYear,
      entryDate: e.entryDate,
      type: e.type,
      amount: e.amount,
      category: e.category ?? "",
      description: e.description,
      party: e.party ?? "",
      paymentMode: e.paymentMode,
      voucherNo: e.voucherNo ?? "",
      remarks: e.remarks ?? "",
    })
    setEditingId(e.id)
    setFormError(undefined)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setFormError(undefined)
  }

  async function save() {
    if (!user) return
    if (!form.description.trim()) return setFormError("Write what this entry is for.")
    if (!(form.amount > 0)) return setFormError("Amount must be more than zero.")
    if (!form.entryDate) return setFormError("Pick a date.")

    setSaving(true)
    setFormError(undefined)
    const payload: MeeladEntryInput = { ...form, programYear: year }
    const res = editingId
      ? await updateMeeladEntry(editingId, payload)
      : await addMeeladEntry(payload, {
          id: user.id,
          name: (user.user_metadata?.full_name as string) || user.email || undefined,
        })
    setSaving(false)

    if (res.error) return setFormError(res.error)
    closeForm()
    await load(year)
  }

  async function remove(e: MeeladEntry) {
    if (!confirm(`Delete this ${e.type} entry of ${fmt(e.amount)} — "${e.description}"?\n\nThis cannot be undone.`)) return
    const { error: err } = await deleteMeeladEntry(e.id)
    if (err) return setError(err)
    await load(year)
  }

  function exportCSV() {
    downloadCSV(`meelad_${year}_accounts`, [
      ["Date", "Type", "Description", "Category", "From / To", "Mode", "Voucher", "Income", "Expense", "Balance", "Remarks", "Entered by"],
      ...entries.map((e) => [
        e.entryDate,
        e.type,
        e.description,
        e.category ?? "",
        e.party ?? "",
        e.paymentMode,
        e.voucherNo ?? "",
        e.type === "income" ? e.amount : "",
        e.type === "expense" ? e.amount : "",
        runningBalance.get(e.id) ?? 0,
        e.remarks ?? "",
        e.createdByName ?? "",
      ]),
      [],
      ["", "", "TOTAL", "", "", "", "", summary.income, summary.expense, summary.balance, "", ""],
    ])
  }

  // No super-admin check here: app/admin/layout.tsx already redirects anyone
  // else away on the server before this renders, the same way /admin/users
  // works, and the RLS policies are the real boundary either way.
  if (authLoading) return <DashboardSkeleton />
  if (!user) return null

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-start justify-between gap-3 print:hidden"
      >
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-navy-800 dark:text-white">
            <Wallet className="size-7 text-gold-500" />
            Meelad ul Nabi Accounts
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-navy-600 dark:text-navy-300">
            A separate income &amp; expenditure book for the Meelad ul Nabi program. Nothing here
            touches the institute accounting or the office daily ledger — this book&apos;s totals
            stand on their own.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={cn(selectClass, "h-9 w-auto")}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label="Program year"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>Meelad {y}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => void load(year)} disabled={loading}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus className="mr-1 size-4" /> Add Entry
          </Button>
        </div>
      </motion.div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      {/* ── Summary ───────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Total Income" value={summary.income} delay={0.05}
          icon={TrendingUp} tone="emerald"
        />
        <SummaryCard
          label="Total Expenditure" value={summary.expense} delay={0.1}
          icon={TrendingDown} tone="red"
        />
        <SummaryCard
          label="Balance in Hand" value={summary.balance} delay={0.15}
          icon={Wallet} tone={summary.balance < 0 ? "red" : "blue"}
        />
        <SummaryCard
          label="Entries" value={summary.entryCount} delay={0.2}
          icon={ListOrdered} tone="gold" plain
        />
      </div>

      {/* ── Add / edit form ───────────────────────────────────────── */}
      {showForm && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="print:hidden">
          <Card className="border-gold-300 dark:border-gold-500/40">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">
                {editingId ? "Edit entry" : `New entry — Meelad ${year}`}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={closeForm}><X className="size-4" /></Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Income / expense */}
              <div className="flex gap-2">
                {(["income", "expense"] as MeeladEntryType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, type: t, category: "" }))}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-2 text-sm font-semibold capitalize transition",
                      form.type === t
                        ? t === "income"
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                          : "border-red-500 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400"
                        : "border-input text-navy-500 hover:bg-navy-50 dark:text-navy-400 dark:hover:bg-navy-800",
                    )}
                  >
                    {t === "income" ? "Income" : "Expenditure"}
                  </button>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Date">
                  <Input
                    type="date" value={form.entryDate}
                    onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))}
                  />
                </Field>

                <Field label="Amount (INR)">
                  <Input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    value={form.amount || ""}
                    onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) || 0 }))}
                    placeholder="0.00"
                  />
                </Field>

                <Field label="Category">
                  <Input
                    list="meelad-categories" value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    placeholder={form.type === "income" ? "Donation…" : "Food & Refreshments…"}
                  />
                  <datalist id="meelad-categories">
                    {categorySuggestions.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </Field>

                <Field label="Description" className="sm:col-span-2">
                  <Input
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="What is this entry for?"
                  />
                </Field>

                <Field label={form.type === "income" ? "Received from" : "Paid to"}>
                  <Input
                    value={form.party}
                    onChange={(e) => setForm((f) => ({ ...f, party: e.target.value }))}
                    placeholder="Name (optional)"
                  />
                </Field>

                <Field label="Payment mode">
                  <select
                    className={selectClass} value={form.paymentMode}
                    onChange={(e) => setForm((f) => ({ ...f, paymentMode: e.target.value as MeeladPaymentMode }))}
                  >
                    {MEELAD_PAYMENT_MODES.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Receipt / Bill no.">
                  <Input
                    value={form.voucherNo}
                    onChange={(e) => setForm((f) => ({ ...f, voucherNo: e.target.value }))}
                    placeholder="Optional"
                  />
                </Field>

                <Field label="Remarks">
                  <Input
                    value={form.remarks}
                    onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                    placeholder="Optional"
                  />
                </Field>
              </div>

              {formError && (
                <p className="text-sm font-medium text-red-600 dark:text-red-400">{formError}</p>
              )}

              <div className="flex gap-2">
                <Button onClick={() => void save()} disabled={saving}>
                  <Check className="mr-1 size-4" />
                  {saving ? "Saving…" : editingId ? "Save changes" : "Add to book"}
                </Button>
                <Button variant="outline" onClick={closeForm} disabled={saving}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ── Filters ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy-400" />
          <Input
            className="pl-9" placeholder="Search description, category, name, receipt…"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1 rounded-md border border-input p-1">
          {(["all", "income", "expense"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded px-3 py-1 text-xs font-semibold capitalize transition",
                filter === f
                  ? "bg-navy-800 text-white dark:bg-white dark:text-navy-900"
                  : "text-navy-500 hover:bg-navy-50 dark:text-navy-400 dark:hover:bg-navy-800",
              )}
            >
              {f === "expense" ? "Expenditure" : f}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={exportCSV} disabled={!entries.length}>
          <Download className="mr-1 size-4" /> CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!entries.length}>
          <Printer className="mr-1 size-4" /> Print
        </Button>
      </div>

      {/* ── The book ──────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="py-12 text-center text-sm text-navy-500 dark:text-navy-400">Loading the book…</p>
          ) : !entries.length ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Wallet className="size-10 text-navy-300 dark:text-navy-600" />
              <p className="font-semibold text-navy-900 dark:text-white">No entries for Meelad {year} yet</p>
              <p className="max-w-sm text-sm text-navy-500 dark:text-navy-400">
                Add the first income or expenditure and the balance will build up from there.
              </p>
              <Button size="sm" className="mt-2" onClick={openAdd}>
                <Plus className="mr-1 size-4" /> Add Entry
              </Button>
            </div>
          ) : !visible.length ? (
            <p className="py-12 text-center text-sm text-navy-500 dark:text-navy-400">
              No entries match this search.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-navy-50/60 text-left text-xs uppercase tracking-wide text-navy-500 dark:bg-navy-900/50 dark:text-navy-400">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Date</th>
                    <th className="px-3 py-2.5 font-semibold">Description</th>
                    <th className="px-3 py-2.5 font-semibold">Category</th>
                    <th className="px-3 py-2.5 font-semibold">From / To</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Income</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Expenditure</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Balance</th>
                    <th className="px-3 py-2.5 print:hidden" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-navy-50/50 dark:hover:bg-navy-900/40">
                      <td className="whitespace-nowrap px-3 py-2.5 text-navy-600 dark:text-navy-300">
                        {fmtDate(e.entryDate)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-navy-900 dark:text-white">{e.description}</span>
                        {(e.voucherNo || e.remarks) && (
                          <span className="block text-xs text-navy-500 dark:text-navy-400">
                            {e.voucherNo && `#${e.voucherNo}`}
                            {e.voucherNo && e.remarks && " · "}
                            {e.remarks}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {e.category && <Badge variant="secondary" className="text-[10px]">{e.category}</Badge>}
                      </td>
                      <td className="px-3 py-2.5 text-navy-600 dark:text-navy-300">
                        {e.party || "—"}
                        <span className="block text-xs capitalize text-navy-400">{e.paymentMode}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                        {e.type === "income" ? fmt(e.amount) : ""}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-red-600 dark:text-red-400">
                        {e.type === "expense" ? fmt(e.amount) : ""}
                      </td>
                      <td className={cn(
                        "whitespace-nowrap px-3 py-2.5 text-right font-semibold",
                        (runningBalance.get(e.id) ?? 0) < 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-navy-700 dark:text-navy-200",
                      )}>
                        {fmt(runningBalance.get(e.id) ?? 0)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right print:hidden">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(e)} aria-label="Edit entry">
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void remove(e)} aria-label="Delete entry">
                          <Trash2 className="size-3.5 text-red-500" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 bg-navy-50/60 font-bold dark:bg-navy-900/50">
                  <tr>
                    <td className="px-3 py-3" colSpan={4}>Total — Meelad {year}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-emerald-600 dark:text-emerald-400">{fmt(summary.income)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-red-600 dark:text-red-400">{fmt(summary.expense)}</td>
                    <td className={cn(
                      "whitespace-nowrap px-3 py-3 text-right",
                      summary.balance < 0 ? "text-red-600 dark:text-red-400" : "text-navy-900 dark:text-white",
                    )}>
                      {fmt(summary.balance)}
                    </td>
                    <td className="print:hidden" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Category breakdown ────────────────────────────────────── */}
      {!!entries.length && (
        <div className="grid gap-4 lg:grid-cols-2">
          <BreakdownCard title="Income by category" rows={incomeByCategory} total={summary.income} tone="emerald" />
          <BreakdownCard title="Expenditure by category" rows={expenseByCategory} total={summary.expense} tone="red" />
        </div>
      )}
    </div>
  )
}

// ── Small building blocks ───────────────────────────────────────────────────

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="text-xs font-semibold text-navy-600 dark:text-navy-300">{label}</label>
      {children}
    </div>
  )
}

const TONES = {
  emerald: { bg: "bg-emerald-100 dark:bg-emerald-500/20", fg: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" },
  red: { bg: "bg-red-100 dark:bg-red-500/20", fg: "text-red-600 dark:text-red-400", bar: "bg-red-500" },
  blue: { bg: "bg-blue-100 dark:bg-blue-500/20", fg: "text-blue-600 dark:text-blue-400", bar: "bg-blue-500" },
  gold: { bg: "bg-gold-100 dark:bg-gold-500/20", fg: "text-gold-600 dark:text-gold-400", bar: "bg-gold-500" },
} as const

function SummaryCard({
  label, value, icon: Icon, tone, delay, plain,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  tone: keyof typeof TONES
  delay: number
  plain?: boolean
}) {
  const t = TONES[tone]
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", t.bg)}>
            <Icon className={cn("size-5", t.fg)} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-navy-500 dark:text-navy-400">{label}</p>
            <p className={cn("truncate text-xl font-bold", t.fg)}>
              {plain ? value.toLocaleString("en-IN") : fmt(value)}
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

function BreakdownCard({
  title, rows, total, tone,
}: {
  title: string
  rows: { category: string; total: number; count: number }[]
  total: number
  tone: keyof typeof TONES
}) {
  const t = TONES[tone]
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {!rows.length ? (
          <p className="py-4 text-center text-sm text-navy-500 dark:text-navy-400">Nothing recorded yet.</p>
        ) : (
          rows.map((r) => {
            const pct = total > 0 ? (r.total / total) * 100 : 0
            return (
              <div key={r.category} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium text-navy-800 dark:text-navy-100">
                    {r.category}
                    <span className="ml-1 text-xs text-navy-400">({r.count})</span>
                  </span>
                  <span className={cn("whitespace-nowrap font-semibold", t.fg)}>{fmt(r.total)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-navy-100 dark:bg-navy-800">
                  <div className={cn("h-full rounded-full", t.bar)} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
