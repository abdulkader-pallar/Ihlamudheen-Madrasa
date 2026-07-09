"use client";

import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { EmptyState, Spinner, StatCard } from "@/components/admin/ui";
import { toast } from "@/components/ui/toast";
import { fmt, fmtDate, monthKey, monthLabel } from "@/lib/format";
import { downloadCSV } from "@/lib/csv";
import { btn, cx, inputClass } from "@/lib/ui";

type Group = "category" | "month" | "fund";

export default function ReportsPage() {
  const { transactions, categories, funds, loading } = useData();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [group, setGroup] = useState<Group>("category");

  const catName = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.name])), [categories]);
  const fundName = useMemo(() => Object.fromEntries(funds.map((x) => [x.id, x.name])), [funds]);

  const { rows, totals } = useMemo(() => {
    const list = transactions.filter((t) => (!from || t.occurred_on >= from) && (!to || t.occurred_on <= to));
    const groups: Record<string, { income: number; expense: number }> = {};
    list.forEach((t) => {
      const key =
        group === "month" ? monthLabel(monthKey(t.occurred_on)) : group === "fund" ? fundName[t.fund_id ?? ""] || "— No fund —" : catName[t.category_id ?? ""] || "— Uncategorised —";
      groups[key] = groups[key] || { income: 0, expense: 0 };
      groups[key][t.type] += +t.amount;
    });
    let income = 0, expense = 0;
    list.forEach((t) => (t.type === "income" ? (income += +t.amount) : (expense += +t.amount)));
    const rows = Object.entries(groups).sort((a, b) => b[1].income + b[1].expense - (a[1].income + a[1].expense));
    return { rows, totals: { income, expense, balance: income - expense } };
  }, [transactions, from, to, group, catName, fundName]);

  const rangeText = from || to ? `${from ? fmtDate(from) : "start"} → ${to ? fmtDate(to) : "today"}` : "All time";

  const exportCSV = () => {
    const head = group === "month" ? "Month" : group === "fund" ? "Fund" : "Category";
    const out: (string | number)[][] = [[head, "Income", "Expense", "Net"]];
    rows.forEach(([k, v]) => out.push([k, v.income, v.expense, v.income - v.expense]));
    out.push(["Total", totals.income, totals.expense, totals.balance]);
    downloadCSV("report", out);
    toast("CSV downloaded");
  };

  if (loading) return <Spinner />;

  return (
    <div className="animate-fade">
      <div className="no-print mb-4 flex flex-wrap items-end gap-2.5">
        <div>
          <label className="mb-1 block text-[11px] font-bold text-muted">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={cx(inputClass, "py-2 text-[13.5px]")} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold text-muted">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={cx(inputClass, "py-2 text-[13.5px]")} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold text-muted">Group by</label>
          <select value={group} onChange={(e) => setGroup(e.target.value as Group)} className={cx(inputClass, "py-2 text-[13.5px]")}>
            <option value="category">Category</option>
            <option value="month">Month</option>
            <option value="fund">Fund</option>
          </select>
        </div>
        <button onClick={() => window.print()} className={btn({ variant: "ghost", size: "sm" })}><Printer size={14} /> Print / PDF</button>
        <button onClick={exportCSV} className={btn({ variant: "ghost", size: "sm" })}><Download size={14} /> CSV</button>
      </div>

      <div className="mb-4 rounded-2xl border border-line bg-surface p-5 shadow-soft">
        <h3 className="font-display text-lg font-semibold">Income &amp; Expenditure Statement</h3>
        <p className="mt-0.5 text-[13.5px] text-muted">Ihlamudheen Madrasa · {rangeText} · grouped by {group}</p>
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Income" value={fmt(totals.income)} tone="income" dot="i" />
        <StatCard label="Total Expense" value={fmt(totals.expense)} tone="expense" dot="e" />
        <StatCard label="Net Balance" value={fmt(totals.balance)} dot="b" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-bold">{group === "month" ? "Month" : group === "fund" ? "Fund" : "Category"}</th>
                <th className="px-4 py-3 text-right font-bold">Income</th>
                <th className="px-4 py-3 text-right font-bold">Expense</th>
                <th className="px-4 py-3 text-right font-bold">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4}><EmptyState>No data in this range.</EmptyState></td></tr>
              ) : (
                rows.map(([k, v]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="px-4 py-3">{k}</td>
                    <td className="tnum px-4 py-3 text-right text-good">{fmt(v.income)}</td>
                    <td className="tnum px-4 py-3 text-right text-bad">{fmt(v.expense)}</td>
                    <td className="tnum px-4 py-3 text-right font-semibold">{fmt(v.income - v.expense)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line font-extrabold">
                <td className="px-4 py-3">Total</td>
                <td className="tnum px-4 py-3 text-right text-good">{fmt(totals.income)}</td>
                <td className="tnum px-4 py-3 text-right text-bad">{fmt(totals.expense)}</td>
                <td className="tnum px-4 py-3 text-right">{fmt(totals.balance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
