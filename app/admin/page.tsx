"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { EmptyState, Panel, Pill, Spinner, StatCard } from "@/components/admin/ui";
import { CategoryDonut, MonthlyChart } from "@/components/admin/charts";
import { TxDialog } from "@/components/admin/tx-dialog";
import { fmt, fmtDate, monthKey, monthLabel } from "@/lib/format";
import { isEditor } from "@/lib/types";
import { btn } from "@/lib/ui";

export default function DashboardPage() {
  const { transactions, categories, loading, profile } = useData();
  const [adding, setAdding] = useState(false);

  const catName = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.name])), [categories]);

  const stats = useMemo(() => {
    let income = 0, expense = 0;
    const thisMonth = new Date().toISOString().slice(0, 7);
    let mNet = 0;
    for (const t of transactions) {
      if (t.type === "income") income += +t.amount;
      else expense += +t.amount;
      if (monthKey(t.occurred_on) === thisMonth) mNet += t.type === "income" ? +t.amount : -+t.amount;
    }
    return { income, expense, balance: income - expense, mNet };
  }, [transactions]);

  const monthly = useMemo(() => {
    const now = new Date();
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) months.push(new Date(now.getFullYear(), now.getMonth() - i, 1).toISOString().slice(0, 7));
    return months.map((m) => ({
      label: monthLabel(m),
      income: transactions.filter((t) => monthKey(t.occurred_on) === m && t.type === "income").reduce((s, t) => s + +t.amount, 0),
      expense: transactions.filter((t) => monthKey(t.occurred_on) === m && t.type === "expense").reduce((s, t) => s + +t.amount, 0),
    }));
  }, [transactions]);

  const byCategory = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.filter((t) => t.type === "expense").forEach((t) => {
      const k = catName[t.category_id ?? ""] || "Uncategorised";
      map[k] = (map[k] || 0) + +t.amount;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [transactions, catName]);

  const recent = transactions.slice(0, 6);

  if (loading) return <Spinner />;

  return (
    <div className="animate-fade">
      {isEditor(profile.role) && (
        <div className="mb-5 flex justify-end">
          <button onClick={() => setAdding(true)} className={btn({ variant: "primary" })}>
            <Plus size={16} /> New entry
          </button>
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Income" value={fmt(stats.income)} tone="income" dot="i" />
        <StatCard label="Total Expense" value={fmt(stats.expense)} tone="expense" dot="e" />
        <StatCard label="Balance" value={fmt(stats.balance)} dot="b" />
        <StatCard label="This Month (Net)" value={fmt(stats.mNet)} tone={stats.mNet >= 0 ? "income" : "expense"} />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Panel title="Income vs Expense — last 6 months">
          <MonthlyChart data={monthly} />
        </Panel>
        <Panel title="Expenses by category">
          <CategoryDonut data={byCategory} />
        </Panel>
      </div>

      <Panel title="Recent transactions">
        {recent.length === 0 ? (
          <EmptyState>No transactions yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted">
                  <th className="py-2 font-bold">Date</th>
                  <th className="py-2 font-bold">Type</th>
                  <th className="py-2 font-bold">Category</th>
                  <th className="py-2 font-bold">Description</th>
                  <th className="py-2 text-right font-bold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className="tnum py-2.5">{fmtDate(t.occurred_on)}</td>
                    <td className="py-2.5"><Pill type={t.type} /></td>
                    <td className="py-2.5">{catName[t.category_id ?? ""] || "—"}</td>
                    <td className="py-2.5">{t.description || ""}</td>
                    <td className={"tnum py-2.5 text-right font-bold " + (t.type === "income" ? "text-good" : "text-bad")}>
                      {t.type === "expense" ? "−" : "+"}{fmt(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {adding && <TxDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
