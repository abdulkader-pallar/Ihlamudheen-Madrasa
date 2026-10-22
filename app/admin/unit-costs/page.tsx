"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Download, IndianRupee, Printer, TrendingDown, Users } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { PdfButton } from "@/components/admin/pdf-button";
import { EmptyState, Panel, Spinner, StatCard } from "@/components/admin/ui";
import { toast } from "@/components/ui/toast";
import { downloadCSV } from "@/lib/csv";
import { fmt, monthLabel, todayISO } from "@/lib/format";
import type { PayrollRun } from "@/lib/types";
import { daysWorked, fromPaise, fyLabel, fyMonths, fyOf, monthName, monthlyCost, toPaise } from "@/lib/unit-payroll";
import { btn, cx, inputClass } from "@/lib/ui";

// What each unit costs: salaries (posted by payroll runs, counted in the month
// the run is for) plus expenses charged to the unit (counted in the month they
// happened). Expenses with no unit are the institution's common costs.
// Amounts are summed in paise.

type Col = { id: string | null; name: string; budget: number | null };
const COMMON = "__common";
const key = (id: string | null) => id ?? COMMON;

export default function UnitCostsPage() {
  const { units, allTransactions, allStaff, salaryRevisions, salaryComponents, supabase, canEdit, loading, site, unitName, reload } = useData();
  const thisMonth = todayISO().slice(0, 7);
  const [fy, setFy] = useState(fyOf(thisMonth));
  const months = useMemo(() => fyMonths(fy), [fy]);
  const [month, setMonth] = useState(thisMonth);
  const [runs, setRuns] = useState<PayrollRun[] | null>(null);

  useEffect(() => { if (!months.includes(month)) setMonth(months.includes(thisMonth) ? thisMonth : months[0]); }, [months, month, thisMonth]);

  useEffect(() => {
    let off = false;
    supabase.from("payroll_runs").select("id, unit_id, month, status, paid_on").then(({ data, error }) => {
      if (off) return;
      if (error) toast(error.message, true);
      setRuns((data as PayrollRun[]) || []);
    });
    return () => { off = true; };
  }, [supabase]);

  const cols: Col[] = useMemo(
    () => [...units.filter((u) => u.active).map((u) => ({ id: u.id as string | null, name: u.name, budget: u.monthly_budget })), { id: null, name: unitName(null), budget: null }],
    [units, unitName]
  );

  // [unit][month] → paise, split into salary and other expenses.
  const grid = useMemo(() => {
    const runById = Object.fromEntries((runs || []).map((r) => [r.id, r]));
    const salary: Record<string, Record<string, number>> = {};
    const other: Record<string, Record<string, number>> = {};
    const add = (t: Record<string, Record<string, number>>, u: string, m: string, p: number) => {
      t[u] = t[u] || {};
      t[u][m] = (t[u][m] || 0) + p;
    };
    for (const t of allTransactions) {
      if (t.type !== "expense") continue;
      const run = t.payroll_run_id ? runById[t.payroll_run_id] : undefined;
      if (run) add(salary, key(run.unit_id), run.month.slice(0, 7), toPaise(t.amount));
      else add(other, key(t.unit_id ?? null), t.occurred_on.slice(0, 7), toPaise(t.amount));
    }
    return { salary, other };
  }, [allTransactions, runs]);

  const cell = (u: string | null, m: string) => {
    const s = grid.salary[key(u)]?.[m] || 0;
    const o = grid.other[key(u)]?.[m] || 0;
    return { salary: s, other: o, total: s + o };
  };

  // Month summary: staff on the rolls, committed salary at their pay for that
  // month, what was actually paid, and other expenses.
  const summary = useMemo(() => cols.map((c) => {
    const people = allStaff.filter((s) => (s.unit_id ?? null) === c.id && (s.active || (s.left_on && s.left_on >= month + "-01")) && daysWorked(s, month) > 0);
    const committed = people.reduce((a, s) => a + monthlyCost(s, salaryRevisions, salaryComponents, month), 0);
    const { salary, other, total } = cell(c.id, month);
    const budget = c.budget != null ? toPaise(c.budget) : null;
    const run = (runs || []).find((r) => r.unit_id === c.id && r.month.slice(0, 7) === month);
    return { ...c, staff: people.length, committed, salary, other, total, budget, run };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cols, allStaff, salaryRevisions, salaryComponents, month, grid, runs]);

  const sum = (f: (r: (typeof summary)[number]) => number) => summary.reduce((a, r) => a + f(r), 0);
  const fyTotal = (u: string | null) => months.reduce((a, m) => a + cell(u, m).total, 0);
  const monthTotal = (m: string) => cols.reduce((a, c) => a + cell(c.id, m).total, 0);
  const grand = months.reduce((a, m) => a + monthTotal(m), 0);
  const monthsElapsed = months.filter((m) => m <= thisMonth).length || 12;

  const saveBudget = async (unitId: string, v: string) => {
    const monthly_budget = v.trim() === "" ? null : Number(v);
    if (monthly_budget !== null && !(monthly_budget >= 0)) return toast("Budget must be a number.", true);
    const { error } = await supabase.from("units").update({ monthly_budget }).eq("id", unitId);
    if (error) return toast(error.message, true);
    toast("Budget saved.");
    await reload();
  };

  const exportCSV = () => {
    const out: (string | number)[][] = [[`${site.name} institution costs — ${monthName(month)}`]];
    out.push(["Institution", "Staff", "Committed salary", "Salary paid", "Other expenses", "Total expense", "Cost per staff", "Monthly budget", "Budget − actual"]);
    summary.forEach((r) => out.push([
      r.name, r.staff, fromPaise(r.committed), fromPaise(r.salary), fromPaise(r.other), fromPaise(r.total),
      r.staff ? fromPaise(Math.round(r.total / r.staff)) : "", r.budget != null ? fromPaise(r.budget) : "", r.budget != null ? fromPaise(r.budget - r.total) : "",
    ]));
    out.push([]);
    out.push([`${fyLabel(fy)} — total expense by month`]);
    out.push(["Month", ...cols.map((c) => c.name), "Total"]);
    months.forEach((m) => out.push([monthLabel(m), ...cols.map((c) => fromPaise(cell(c.id, m).total)), fromPaise(monthTotal(m))]));
    out.push(["Total", ...cols.map((c) => fromPaise(fyTotal(c.id))), fromPaise(grand)]);
    downloadCSV(`${site.id}-institution-costs-${month}`, out);
    toast("CSV downloaded");
  };

  if (loading || runs === null) return <Spinner />;
  if (!units.length) return <EmptyState>{site.name} has no institutions set up.</EmptyState>;

  return (
    <div className="animate-fade grid gap-5">
      <div className="no-print flex flex-wrap items-end gap-2.5">
        <div>
          <label className="mb-1 block text-[11px] font-bold text-muted">Financial year</label>
          <select value={fy} onChange={(e) => setFy(Number(e.target.value))} className={cx(inputClass, "py-2 text-[13.5px]")}>
            {[fyOf(thisMonth) + 1, fyOf(thisMonth), fyOf(thisMonth) - 1, fyOf(thisMonth) - 2].map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold text-muted">Month</label>
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={cx(inputClass, "py-2 text-[13.5px]")}>
            {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </div>
        <button onClick={() => window.print()} className={btn({ variant: "ghost", size: "sm" })}><Printer size={14} /> Print</button>
        <button onClick={exportCSV} className={btn({ variant: "ghost", size: "sm" })}><Download size={14} /> CSV</button>
        <PdfButton />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={TrendingDown} accent="red" valueTone="bad" label={`Expense — ${monthName(month)}`} value={fmt(fromPaise(sum((r) => r.total)))} sub={`All ${site.name}`} />
        <StatCard icon={IndianRupee} accent="gold" label="Committed salaries" value={fmt(fromPaise(sum((r) => r.committed)))} sub={`Paid ${fmt(fromPaise(sum((r) => r.salary)))}`} />
        <StatCard icon={Users} accent="teal" label="Staff on payroll" value={String(sum((r) => r.staff))} sub={monthName(month)} />
        <StatCard icon={Building2} accent="blue" label={`Expense — ${fyLabel(fy)}`} value={fmt(fromPaise(grand))} sub={`Avg ${fmt(fromPaise(Math.round(grand / monthsElapsed)))} / month`} />
      </div>

      <Panel title={`Institution costs — ${monthName(month)}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted">
                <th className="py-2 font-bold">Institution</th>
                <th className="py-2 text-right font-bold">Staff</th>
                <th className="py-2 text-right font-bold">Committed salary</th>
                <th className="py-2 text-right font-bold">Salary paid</th>
                <th className="py-2 text-right font-bold">Other expenses</th>
                <th className="py-2 text-right font-bold">Total</th>
                <th className="py-2 text-right font-bold">Per staff</th>
                <th className="py-2 text-right font-bold">Monthly budget</th>
                <th className="py-2 text-right font-bold">Budget − actual</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((r) => {
                const unpaid = r.committed > 0 && r.salary === 0;
                const gap = r.salary > 0 && r.committed > 0 && r.salary !== r.committed;
                return (
                  <tr key={key(r.id)} className="border-t border-line align-middle">
                    <td className="py-2.5 font-bold">{r.name}</td>
                    <td className="tnum py-2.5 text-right">{r.staff || "—"}</td>
                    <td className="tnum py-2.5 text-right">{r.committed ? fmt(fromPaise(r.committed)) : "—"}</td>
                    <td className="tnum py-2.5 text-right">
                      {unpaid
                        ? <span className="rounded-full bg-bad-bg px-2 py-0.5 text-[11.5px] font-bold text-bad">{r.run ? `Payroll ${r.run.status}` : "Not paid"}</span>
                        : <span className={cx(gap && "text-[var(--accent)]")} title={gap ? "Differs from committed: pro-rating, bonuses or deductions" : undefined}>{r.salary ? fmt(fromPaise(r.salary)) : "—"}</span>}
                    </td>
                    <td className="tnum py-2.5 text-right">{r.other ? fmt(fromPaise(r.other)) : "—"}</td>
                    <td className="tnum py-2.5 text-right font-extrabold">{fmt(fromPaise(r.total))}</td>
                    <td className="tnum py-2.5 text-right text-muted">{r.staff ? fmt(fromPaise(Math.round(r.total / r.staff))) : "—"}</td>
                    <td className="tnum py-2.5 text-right">
                      {r.id && canEdit
                        ? <BudgetCell value={r.budget != null ? fromPaise(r.budget) : null} onSave={(v) => saveBudget(r.id!, v)} />
                        : r.budget != null ? fmt(fromPaise(r.budget)) : "—"}
                    </td>
                    <td className={cx("tnum py-2.5 text-right font-bold", r.budget == null ? "text-muted" : r.budget - r.total < 0 ? "text-bad" : "text-good")}>
                      {r.budget != null ? fmt(fromPaise(r.budget - r.total)) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line font-extrabold">
                <td className="py-2.5">All {site.name}</td>
                <td className="tnum py-2.5 text-right">{sum((r) => r.staff)}</td>
                <td className="tnum py-2.5 text-right">{fmt(fromPaise(sum((r) => r.committed)))}</td>
                <td className="tnum py-2.5 text-right">{fmt(fromPaise(sum((r) => r.salary)))}</td>
                <td className="tnum py-2.5 text-right">{fmt(fromPaise(sum((r) => r.other)))}</td>
                <td className="tnum py-2.5 text-right">{fmt(fromPaise(sum((r) => r.total)))}</td>
                <td />
                <td className="tnum py-2.5 text-right">{fmt(fromPaise(sum((r) => r.budget ?? 0)))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-muted">
          <b>Committed salary</b> is what the institution&apos;s staff cost for this month at their recorded pay (gross + employer contributions).
          <b> Salary paid</b> is what payroll actually posted for the month. A gap means a payroll that hasn&apos;t been paid, or bonuses, pro-rating or deductions.
        </p>
      </Panel>

      <Panel title={`${fyLabel(fy)} — total expense by institution and month`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 180 + cols.length * 120 }}>
            <thead>
              <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted">
                <th className="py-2 font-bold">Month</th>
                {cols.map((c) => <th key={key(c.id)} className="py-2 text-right font-bold">{c.name}</th>)}
                <th className="py-2 text-right font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m} className={cx("border-t border-line", m === month && "bg-surface-2")}>
                  <td className="py-2 font-semibold">{monthLabel(m)}</td>
                  {cols.map((c) => {
                    const v = cell(c.id, m).total;
                    return <td key={key(c.id)} className={cx("tnum py-2 text-right", !v && "text-muted")}>{v ? fmt(fromPaise(v)) : "—"}</td>;
                  })}
                  <td className="tnum py-2 text-right font-bold">{fmt(fromPaise(monthTotal(m)))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line font-extrabold">
                <td className="py-2.5">Total</td>
                {cols.map((c) => <td key={key(c.id)} className="tnum py-2.5 text-right">{fmt(fromPaise(fyTotal(c.id)))}</td>)}
                <td className="tnum py-2.5 text-right">{fmt(fromPaise(grand))}</td>
              </tr>
              <tr className="text-[12.5px] text-muted">
                <td className="py-1.5">Avg / month</td>
                {cols.map((c) => <td key={key(c.id)} className="tnum py-1.5 text-right">{fmt(fromPaise(Math.round(fyTotal(c.id) / monthsElapsed)))}</td>)}
                <td className="tnum py-1.5 text-right">{fmt(fromPaise(Math.round(grand / monthsElapsed)))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function BudgetCell({ value, onSave }: { value: number | null; onSave: (v: string) => void }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => setV(value == null ? "" : String(value)), [value]);
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== (value == null ? "" : String(value)) && onSave(v)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      inputMode="decimal"
      placeholder="Set"
      className={cx(inputClass, "w-28 px-2 py-1 text-right text-[13px]")}
    />
  );
}
