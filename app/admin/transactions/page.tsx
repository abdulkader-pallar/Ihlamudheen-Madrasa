"use client";

import { useMemo, useState } from "react";
import { Download, Plus } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { EmptyState, Modal, Pill, Spinner } from "@/components/admin/ui";
import { TxDialog } from "@/components/admin/tx-dialog";
import { toast } from "@/components/ui/toast";
import { fmt, fmtDate, round2 } from "@/lib/format";
import { downloadCSV } from "@/lib/csv";
import { isEditor, type Transaction } from "@/lib/types";
import { btn, cx, inputClass } from "@/lib/ui";

const empty = { search: "", type: "", category: "", fund: "", from: "", to: "" };

export default function TransactionsPage() {
  const { transactions, categories, funds, loading, profile, supabase, reload } = useData();
  const [f, setF] = useState(empty);
  const [editing, setEditing] = useState<Transaction | null | undefined>(undefined);
  const [delTarget, setDelTarget] = useState<Transaction | null>(null);
  const editor = isEditor(profile.role);

  const catName = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.name])), [categories]);
  const fundName = useMemo(() => Object.fromEntries(funds.map((x) => [x.id, x.name])), [funds]);

  const list = useMemo(() => {
    const s = f.search.toLowerCase();
    return transactions.filter((t) => {
      if (f.type && t.type !== f.type) return false;
      if (f.category && t.category_id !== f.category) return false;
      if (f.fund && t.fund_id !== f.fund) return false;
      if (f.from && t.occurred_on < f.from) return false;
      if (f.to && t.occurred_on > f.to) return false;
      if (s && !((t.description || "") + " " + (t.reference || "")).toLowerCase().includes(s)) return false;
      return true;
    });
  }, [transactions, f]);

  const totals = useMemo(() => {
    let income = 0, expense = 0;
    list.forEach((t) => (t.type === "income" ? (income += +t.amount) : (expense += +t.amount)));
    return { income: round2(income), expense: round2(expense), balance: round2(income - expense) };
  }, [list]);

  const set = (k: keyof typeof empty, v: string) => setF((p) => ({ ...p, [k]: v }));

  const doDelete = async () => {
    if (!delTarget) return;
    const { error } = await supabase.from("transactions").delete().eq("id", delTarget.id);
    if (error) return toast(error.message, true);
    setDelTarget(null);
    await reload();
    toast("Entry deleted");
  };

  const exportCSV = () => {
    const rows: (string | number)[][] = [["Date", "Type", "Category", "Fund", "Description", "Reference", "Amount"]];
    list.forEach((t) => rows.push([t.occurred_on, t.type, catName[t.category_id ?? ""] || "", fundName[t.fund_id ?? ""] || "", t.description || "", t.reference || "", t.amount]));
    downloadCSV("transactions", rows);
    toast("CSV downloaded");
  };

  if (loading) return <Spinner />;

  return (
    <div className="animate-fade">
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-end gap-2.5">
        <div className="min-w-[160px] flex-1">
          <label className="mb-1 block text-[11px] font-bold text-muted">Search</label>
          <input value={f.search} onChange={(e) => set("search", e.target.value)} placeholder="Description or reference…" className={cx(inputClass, "py-2 text-[13.5px]")} />
        </div>
        <Select label="Type" value={f.type} onChange={(v) => set("type", v)} options={[["", "All"], ["income", "Income"], ["expense", "Expense"]]} />
        <Select label="Category" value={f.category} onChange={(v) => set("category", v)} options={[["", "All"], ...categories.map((c) => [c.id, c.name] as [string, string])]} />
        <Select label="Fund" value={f.fund} onChange={(v) => set("fund", v)} options={[["", "All"], ...funds.map((x) => [x.id, x.name] as [string, string])]} />
        <div>
          <label className="mb-1 block text-[11px] font-bold text-muted">From</label>
          <input type="date" value={f.from} onChange={(e) => set("from", e.target.value)} className={cx(inputClass, "py-2 text-[13.5px]")} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold text-muted">To</label>
          <input type="date" value={f.to} onChange={(e) => set("to", e.target.value)} className={cx(inputClass, "py-2 text-[13.5px]")} />
        </div>
        <button onClick={() => setF(empty)} className={btn({ variant: "ghost", size: "sm" })}>Clear</button>
        <button onClick={exportCSV} className={btn({ variant: "ghost", size: "sm" })}><Download size={14} /> CSV</button>
        {editor && (
          <button onClick={() => setEditing(null)} className={cx(btn({ variant: "primary", size: "sm" }), "ml-auto")}>
            <Plus size={14} /> New entry
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-bold">Date</th>
                <th className="px-4 py-3 font-bold">Type</th>
                <th className="px-4 py-3 font-bold">Category</th>
                <th className="px-4 py-3 font-bold">Fund</th>
                <th className="px-4 py-3 font-bold">Description</th>
                <th className="px-4 py-3 text-right font-bold">Amount</th>
                {editor && <th className="px-4 py-3 text-right font-bold">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr><td colSpan={editor ? 7 : 6}><EmptyState>No transactions match.</EmptyState></td></tr>
              ) : (
                list.map((t) => (
                  <tr key={t.id} className="border-t border-line hover:bg-surface-2">
                    <td className="tnum px-4 py-3">{fmtDate(t.occurred_on)}</td>
                    <td className="px-4 py-3"><Pill type={t.type} /></td>
                    <td className="px-4 py-3">{catName[t.category_id ?? ""] || "—"}</td>
                    <td className="px-4 py-3">{fundName[t.fund_id ?? ""] || "—"}</td>
                    <td className="px-4 py-3">
                      {t.description || ""}
                      {t.reference && <span className="text-muted"> #{t.reference}</span>}
                    </td>
                    <td className={"tnum whitespace-nowrap px-4 py-3 text-right font-bold " + (t.type === "income" ? "text-good" : "text-bad")}>
                      {t.type === "expense" ? "−" : "+"}{fmt(t.amount)}
                    </td>
                    {editor && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => setEditing(t)} className={btn({ variant: "ghost", size: "sm" })}>Edit</button>
                          <button onClick={() => setDelTarget(t)} className={btn({ variant: "danger", size: "sm" })}>Delete</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-muted">
          <span>{list.length} transaction{list.length === 1 ? "" : "s"}</span>
          <span className="tnum">Income {fmt(totals.income)} · Expense {fmt(totals.expense)} · Net <b className="text-ink">{fmt(totals.balance)}</b></span>
        </div>
      </div>

      {editing !== undefined && <TxDialog tx={editing} onClose={() => setEditing(undefined)} />}

      {delTarget && (
        <Modal title="Delete transaction?" onClose={() => setDelTarget(null)}>
          <p className="-mt-2 mb-5 text-muted">Delete this {delTarget.type} of {fmt(delTarget.amount)}? This cannot be undone.</p>
          <div className="flex justify-end gap-2.5">
            <button onClick={() => setDelTarget(null)} className={btn({ variant: "ghost" })}>Cancel</button>
            <button onClick={doDelete} className={btn({ variant: "danger" })}>Yes, delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-bold text-muted">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputClass, "py-2 text-[13.5px]")}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </div>
  );
}
