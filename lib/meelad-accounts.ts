import { supabase, isSupabaseConfigured } from "./supabase"

// ── Meelad ul Nabi program accounts ────────────────────────────────────────
// A standalone income/expenditure book for the Meelad program, backed by
// public.meelad_accounts_entries (supabase/meelad-accounts.sql). Deliberately
// NOT wired to the accounting module (transactions/categories/funds) or to the
// office daily ledger — this book's totals stand on their own.
//
// Access is super-admin only and enforced by RLS; these helpers just read and
// write, and surface the database's error message when it says no.

export type MeeladEntryType = "income" | "expense"
export type MeeladPaymentMode = "cash" | "bank" | "upi" | "cheque" | "other"

export const MEELAD_PAYMENT_MODES: { value: MeeladPaymentMode; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "upi", label: "UPI" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
]

// Starting points for the category dropdown. Any typed-in category is accepted
// and joins the list once it appears in the book.
export const MEELAD_INCOME_CATEGORIES = [
  "Donation", "Sponsorship", "Membership", "Stall Rent", "Ticket / Coupon",
  "Committee Contribution", "Other Income",
]

export const MEELAD_EXPENSE_CATEGORIES = [
  "Food & Refreshments", "Stage & Decoration", "Sound & Light", "Printing & Publicity",
  "Transport", "Gifts & Prizes", "Guest Hospitality", "Rent", "Electricity",
  "Cleaning", "Miscellaneous",
]

export interface MeeladEntry {
  id: string
  programYear: number
  entryDate: string
  type: MeeladEntryType
  amount: number
  category?: string
  description: string
  party?: string
  paymentMode: MeeladPaymentMode
  voucherNo?: string
  remarks?: string
  createdBy?: string | null
  createdByName?: string
  createdAt?: string
}

export interface MeeladEntryInput {
  programYear: number
  entryDate: string
  type: MeeladEntryType
  amount: number
  category?: string
  description: string
  party?: string
  paymentMode: MeeladPaymentMode
  voucherNo?: string
  remarks?: string
}

const NOT_CONFIGURED = "Supabase is not configured — cannot reach the accounts book."

function toEntry(r: Record<string, unknown>): MeeladEntry {
  return {
    id: r.id as string,
    programYear: Number(r.program_year) || 0,
    entryDate: String(r.entry_date).split("T")[0],
    type: r.type as MeeladEntryType,
    amount: Number(r.amount) || 0,
    category: (r.category as string) || undefined,
    description: (r.description as string) || "",
    party: (r.party as string) || undefined,
    paymentMode: (r.payment_mode as MeeladPaymentMode) || "cash",
    voucherNo: (r.voucher_no as string) || undefined,
    remarks: (r.remarks as string) || undefined,
    createdBy: (r.created_by as string) ?? null,
    createdByName: (r.created_by_name as string) || undefined,
    createdAt: (r.created_at as string) || undefined,
  }
}

function toRow(e: MeeladEntryInput) {
  return {
    program_year: e.programYear,
    entry_date: e.entryDate,
    type: e.type,
    amount: e.amount,
    category: e.category?.trim() || null,
    description: e.description.trim(),
    party: e.party?.trim() || null,
    payment_mode: e.paymentMode,
    voucher_no: e.voucherNo?.trim() || null,
    remarks: e.remarks?.trim() || null,
  }
}

/** Every entry for one program year, oldest first — the book reads as a ledger. */
export async function fetchMeeladEntries(
  programYear: number,
): Promise<{ entries: MeeladEntry[]; error?: string }> {
  if (!isSupabaseConfigured()) return { entries: [], error: NOT_CONFIGURED }
  const { data, error } = await supabase
    .from("meelad_accounts_entries")
    .select("*")
    .eq("program_year", programYear)
    .order("entry_date", { ascending: true })
    .order("created_at", { ascending: true })
  if (error) return { entries: [], error: error.message }
  return { entries: (data ?? []).map(toEntry) }
}

/** Years that already have entries, newest first — drives the year picker. */
export async function fetchMeeladYears(): Promise<number[]> {
  if (!isSupabaseConfigured()) return []
  const { data, error } = await supabase
    .from("meelad_accounts_entries")
    .select("program_year")
    .order("program_year", { ascending: false })
  if (error || !data) return []
  return [...new Set(data.map((r: { program_year: number }) => Number(r.program_year)))]
}

export async function addMeeladEntry(
  entry: MeeladEntryInput,
  author: { id: string; name?: string },
): Promise<{ entry?: MeeladEntry; error?: string }> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED }
  const { data, error } = await supabase
    .from("meelad_accounts_entries")
    .insert({ ...toRow(entry), created_by: author.id, created_by_name: author.name || null })
    .select("*")
    .single()
  if (error) return { error: error.message }
  return { entry: toEntry(data) }
}

export async function updateMeeladEntry(
  id: string,
  entry: MeeladEntryInput,
): Promise<{ entry?: MeeladEntry; error?: string }> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED }
  const { data, error } = await supabase
    .from("meelad_accounts_entries")
    .update(toRow(entry))
    .eq("id", id)
    .select("*")
    .single()
  if (error) return { error: error.message }
  return { entry: toEntry(data) }
}

export async function deleteMeeladEntry(id: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED }
  const { error } = await supabase.from("meelad_accounts_entries").delete().eq("id", id)
  return { error: error?.message }
}

// ── Derived totals ─────────────────────────────────────────────────────────

export interface MeeladSummary {
  income: number
  expense: number
  balance: number
  entryCount: number
}

export function summarise(entries: MeeladEntry[]): MeeladSummary {
  let income = 0
  let expense = 0
  for (const e of entries) {
    if (e.type === "income") income += e.amount
    else expense += e.amount
  }
  return { income, expense, balance: income - expense, entryCount: entries.length }
}

/** Per-category totals for one side of the book, largest first. */
export function categoryTotals(
  entries: MeeladEntry[],
  type: MeeladEntryType,
): { category: string; total: number; count: number }[] {
  const map = new Map<string, { total: number; count: number }>()
  for (const e of entries) {
    if (e.type !== type) continue
    const key = e.category?.trim() || "Uncategorised"
    const cur = map.get(key) ?? { total: 0, count: 0 }
    map.set(key, { total: cur.total + e.amount, count: cur.count + 1 })
  }
  return [...map.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.total - a.total)
}
