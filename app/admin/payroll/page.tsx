"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, Banknote, Download, Printer, RefreshCw, RotateCcw, Trash2, Undo2, Users, Wallet } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { EmptyState, Modal, Panel, Spinner, StatCard } from "@/components/admin/ui";
import { toast } from "@/components/ui/toast";
import { downloadCSV } from "@/lib/csv";
import { fmt, fmtDate, todayISO } from "@/lib/format";
import type { PayrollLine, PayrollRun, RunStatus } from "@/lib/types";
import { computeLine, draftLine, monthName, sumMoney } from "@/lib/unit-payroll";
import { btn, cx, inputClass } from "@/lib/ui";

// Monthly payroll per unit (PMSA's schools and colleges). A run starts as a
// draft built from each staff member's current pay, can be adjusted line by
// line, is approved, and on "Mark paid" posts ONE "Staff Salaries" expense
// charged to the unit. The expense's payroll_run_id is unique in the database,
// so a run can never be posted twice.

const STATUS_STYLE: Record<RunStatus, string> = {
  draft: "bg-muted/20 text-muted",
  approved: "bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--accent)]",
  paid: "bg-good-bg text-good",
};

type LineEdit = Pick<PayrollLine, "days_worked" | "bonus" | "other_deduction" | "note">;

export default function PayrollPage() {
  const { units, unit, allStaff, salaryRevisions, salaryComponents, supabase, canEdit, loading, categories, reload, site } = useData();
  const activeUnits = useMemo(() => units.filter((u) => u.active), [units]);
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [unitId, setUnitId] = useState<string>("");
  const [runs, setRuns] = useState<PayrollRun[] | null>(null);
  const [lineTotals, setLineTotals] = useState<Record<string, { cost: number; net: number; count: number }>>({});
  const [lines, setLines] = useState<PayrollLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paidOn, setPaidOn] = useState(todayISO());
  const [confirm, setConfirm] = useState<"regenerate" | "delete" | "reopen" | null>(null);

  // Follow the sidebar's unit when it names one; otherwise the first unit.
  useEffect(() => {
    if (unit !== "all" && unit !== "common" && units.some((u) => u.id === unit)) setUnitId(unit);
  }, [unit, units]);
  useEffect(() => {
    if (!unitId && activeUnits[0]) setUnitId(activeUnits[0].id);
  }, [unitId, activeUnits]);

  const first = month + "-01";
  const run = runs?.find((r) => r.unit_id === unitId) ?? null;
  const unitLabel = units.find((u) => u.id === unitId)?.name ?? "";
  const editable = canEdit && run?.status === "draft";

  const loadRuns = useCallback(async () => {
    const { data, error } = await supabase.from("payroll_runs").select("id, unit_id, month, status, paid_on").eq("month", first);
    if (error) { toast(error.message, true); setRuns([]); return; }
    const rs = (data as PayrollRun[]) || [];
    setRuns(rs);
    const totals: Record<string, { cost: number; net: number; count: number }> = {};
    if (rs.length) {
      const { data: ls } = await supabase.from("payroll_lines").select("run_id, cost, net").in("run_id", rs.map((r) => r.id));
      for (const r of rs) {
        const mine = ((ls as { run_id: string; cost: number; net: number }[]) || []).filter((l) => l.run_id === r.id);
        totals[r.id] = { cost: sumMoney(mine.map((l) => l.cost)), net: sumMoney(mine.map((l) => l.net)), count: mine.length };
      }
    }
    setLineTotals(totals);
  }, [supabase, first]);

  const loadLines = useCallback(async (runId: string | undefined) => {
    if (!runId) { setLines([]); return; }
    const { data, error } = await supabase.from("payroll_lines").select("*").eq("run_id", runId).order("staff_name");
    if (error) toast(error.message, true);
    setLines((data as PayrollLine[]) || []);
  }, [supabase]);

  useEffect(() => { setRuns(null); loadRuns(); }, [loadRuns]);
  useEffect(() => { setLines(null); if (runs) loadLines(run?.id); }, [runs, run?.id, loadLines]);

  const refresh = async () => { await loadRuns(); };

  // Staff of this unit who were on the rolls at any point in the month.
  const buildLines = () =>
    allStaff
      .filter((s) => s.unit_id === unitId && (s.active || (s.left_on && s.left_on >= first)))
      .map((s) => draftLine(s, salaryRevisions, salaryComponents, month))
      .filter((l): l is NonNullable<typeof l> => l !== null);

  const generate = async () => {
    const drafts = buildLines();
    if (!drafts.length) return toast(`No staff with a salary in ${unitLabel} for ${monthName(month)}. Add staff and their basic salary first.`, true);
    setBusy(true);
    const { data, error } = await supabase.from("payroll_runs").insert({ unit_id: unitId, month: first, status: "draft" }).select("id").single();
    if (error || !data) { setBusy(false); return toast(error?.message || "Could not create the run.", true); }
    const runId = (data as { id: string }).id;
    const { error: e2 } = await supabase.from("payroll_lines").insert(drafts.map((d) => ({ ...d, run_id: runId })));
    setBusy(false);
    if (e2) return toast(e2.message, true);
    toast(`Draft payroll for ${unitLabel}, ${monthName(month)}: ${drafts.length} staff.`);
    await refresh();
  };

  const regenerate = async () => {
    if (!run) return;
    const drafts = buildLines();
    setBusy(true);
    const { error } = await supabase.from("payroll_lines").delete().eq("run_id", run.id);
    if (!error && drafts.length) await supabase.from("payroll_lines").insert(drafts.map((d) => ({ ...d, run_id: run.id })));
    setBusy(false);
    setConfirm(null);
    if (error) return toast(error.message, true);
    toast("Rebuilt from current salaries.");
    await refresh();
  };

  const saveLine = async (l: PayrollLine, patch: Partial<LineEdit>) => {
    const next = { ...l, ...patch };
    if (next.days_worked < 0 || next.days_worked > next.days_in_month) return toast(`Days worked must be 0–${next.days_in_month}.`, true);
    if (next.bonus < 0 || next.other_deduction < 0) return toast("Amounts can't be negative.", true);
    const { gross, net, cost } = computeLine(next);
    const { error } = await supabase
      .from("payroll_lines")
      .update({ days_worked: next.days_worked, bonus: next.bonus, other_deduction: next.other_deduction, note: next.note, gross, net, cost })
      .eq("id", l.id);
    if (error) return toast(error.message, true);
    setLines((ls) => ls?.map((x) => (x.id === l.id ? { ...next, gross, net, cost } : x)) ?? ls);
    loadRuns();
  };

  const removeLine = async (l: PayrollLine) => {
    const { error } = await supabase.from("payroll_lines").delete().eq("id", l.id);
    if (error) return toast(error.message, true);
    await refresh();
  };

  const setStatus = async (status: RunStatus, extra: Record<string, unknown> = {}) => {
    if (!run) return false;
    const { error } = await supabase.from("payroll_runs").update({ status, ...extra }).eq("id", run.id);
    if (error) { toast(error.message, true); return false; }
    return true;
  };

  const deleteRun = async () => {
    if (!run) return;
    const { error } = await supabase.from("payroll_runs").delete().eq("id", run.id);
    setConfirm(null);
    if (error) return toast(error.message, true);
    toast("Payroll run deleted.");
    await refresh();
  };

  const totals = useMemo(() => {
    const ls = lines || [];
    return {
      gross: sumMoney(ls.map((l) => l.gross)),
      net: sumMoney(ls.map((l) => l.net)),
      deductions: sumMoney(ls.map((l) => Number(l.gross) - Number(l.net))),
      employer: sumMoney(ls.map((l) => Number(l.cost) - Number(l.gross))),
      cost: sumMoney(ls.map((l) => l.cost)),
    };
  }, [lines]);

  // Post the salary expense, then mark the run paid. If the expense already
  // exists (an earlier attempt failed halfway), just finish marking it paid.
  const markPaid = async () => {
    if (!run || !lines?.length) return;
    setBusy(true);
    let catId = categories.find((c) => c.kind === "expense" && /salar/i.test(c.name))?.id;
    if (!catId) {
      const { data, error } = await supabase.from("categories").insert({ name: "Staff Salaries", kind: "expense" }).select("id").single();
      if (error) { setBusy(false); return toast(error.message, true); }
      catId = (data as { id: string }).id;
    }
    const { error } = await supabase.from("transactions").insert({
      type: "expense",
      amount: totals.cost,
      occurred_on: paidOn,
      category_id: catId,
      unit_id: run.unit_id,
      payroll_run_id: run.id,
      description: `Salaries ${monthName(month)} — ${unitLabel} (${lines.length} staff; net pay ${fmt(totals.net)}, deductions ${fmt(totals.deductions)}, employer ${fmt(totals.employer)})`,
      reference: `PAYROLL-${month}`,
    });
    if (error && !/duplicate|unique/i.test(error.message)) { setBusy(false); return toast(error.message, true); }
    const ok = await setStatus("paid", { paid_on: paidOn });
    setBusy(false);
    setPaying(false);
    if (!ok) return;
    toast(`Paid. ${fmt(totals.cost)} recorded as ${unitLabel}'s salary expense.`);
    await Promise.all([refresh(), reload()]);
  };

  // Undo "paid": remove the expense it posted and go back to approved.
  const reopen = async () => {
    if (!run) return;
    setBusy(true);
    const { error } = await supabase.from("transactions").delete().eq("payroll_run_id", run.id);
    if (error) { setBusy(false); setConfirm(null); return toast(error.message, true); }
    await setStatus("approved", { paid_on: null });
    setBusy(false);
    setConfirm(null);
    toast("Reopened. The salary expense was removed.");
    await Promise.all([refresh(), reload()]);
  };

  const exportCSV = () => {
    const out: (string | number)[][] = [["Staff", "Designation", "Days", "Basic", "Allowances", "Bonus", "Gross", "Deductions", "Net pay", "Employer cost", "Total cost", "Note"]];
    (lines || []).forEach((l) => out.push([
      l.staff_name, l.designation || "", `${l.days_worked}/${l.days_in_month}`, Number(l.basic), Number(l.allowances), Number(l.bonus),
      Number(l.gross), sumMoney([l.gross, -Number(l.net)]), Number(l.net), sumMoney([l.cost, -Number(l.gross)]), Number(l.cost), l.note || "",
    ]));
    out.push(["Total", "", "", "", "", "", totals.gross, totals.deductions, totals.net, totals.employer, totals.cost, ""]);
    downloadCSV(`${site.id}-payroll-${month}-${unitLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, out);
    toast("CSV downloaded");
  };

  if (loading) return <Spinner />;
  if (!units.length) return <EmptyState>{site.name} has no institutions set up.</EmptyState>;

  return (
    <div className="animate-fade grid gap-5">
      <div className="no-print flex flex-wrap items-end gap-2.5">
        <div>
          <label className="mb-1 block text-[11px] font-bold text-muted">Month</label>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={cx(inputClass, "py-2 text-[13.5px]")} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold text-muted">Institution</label>
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={cx(inputClass, "py-2 text-[13.5px]")}>
            {units.filter((u) => u.active || u.id === unitId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>

      {/* Every unit's status for the month at a glance. */}
      <div className="no-print grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {activeUnits.map((u) => {
          const r = runs?.find((x) => x.unit_id === u.id);
          const t = r ? lineTotals[r.id] : undefined;
          return (
            <button key={u.id} onClick={() => setUnitId(u.id)}
              className={cx("flex items-center justify-between gap-3 rounded-xl border bg-surface px-4 py-3 text-left transition hover:shadow-soft", u.id === unitId ? "border-brand" : "border-line")}>
              <div className="min-w-0">
                <div className="truncate text-[14px] font-bold">{u.name}</div>
                <div className="tnum text-[12.5px] text-muted">{t ? `${t.count} staff · ${fmt(t.cost)}` : "Not generated"}</div>
              </div>
              {runs === null ? null : r
                ? <span className={cx("shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize", STATUS_STYLE[r.status])}>{r.status}</span>
                : <span className="shrink-0 rounded-full bg-bad-bg px-2.5 py-0.5 text-[11px] font-bold text-bad">Pending</span>}
            </button>
          );
        })}
      </div>

      {runs === null ? <Spinner /> : !run ? (
        <Panel>
          <EmptyState>
            <div className="mb-3">No payroll for <b className="text-ink">{unitLabel}</b> in {monthName(month)} yet.</div>
            {canEdit && (
              <button onClick={generate} disabled={busy} className={btn({ variant: "primary" })}>
                <Banknote size={16} /> {busy ? "Generating…" : "Generate from current salaries"}
              </button>
            )}
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Users} accent="teal" label="Staff" value={String(lines?.length ?? 0)} sub={unitLabel} />
            <StatCard icon={Wallet} accent="blue" label="Gross pay" value={fmt(totals.gross)} sub={`Net to staff ${fmt(totals.net)}`} />
            <StatCard icon={Banknote} accent="gold" label="Employer cost" value={fmt(totals.employer)} sub="PF / ESI employer share" />
            <StatCard icon={BadgeCheck} accent="red" valueTone="bad" label="Total cost" value={fmt(totals.cost)} sub="Gross + employer cost" />
          </div>

          <Panel
            title={`${unitLabel} — ${monthName(month)}`}
            action={
              <div className="no-print flex flex-wrap items-center gap-2">
                <span className={cx("rounded-full px-2.5 py-0.5 text-[11.5px] font-bold capitalize", STATUS_STYLE[run.status])}>
                  {run.status}{run.status === "paid" && run.paid_on ? ` ${fmtDate(run.paid_on)}` : ""}
                </span>
                <button onClick={() => window.print()} className={btn({ variant: "ghost", size: "sm" })}><Printer size={14} /> Print</button>
                <button onClick={exportCSV} disabled={!lines?.length} className={btn({ variant: "ghost", size: "sm" })}><Download size={14} /> CSV</button>
                {canEdit && run.status === "draft" && (
                  <>
                    <button onClick={() => setConfirm("regenerate")} className={btn({ variant: "ghost", size: "sm" })}><RefreshCw size={14} /> Rebuild</button>
                    <button onClick={() => setConfirm("delete")} className={btn({ variant: "ghost", size: "sm" })}><Trash2 size={14} /> Delete</button>
                    <button onClick={async () => { if (await setStatus("approved")) { toast("Approved."); refresh(); } }} disabled={!lines?.length} className={btn({ variant: "primary", size: "sm" })}>
                      <BadgeCheck size={14} /> Approve
                    </button>
                  </>
                )}
                {canEdit && run.status === "approved" && (
                  <>
                    <button onClick={async () => { if (await setStatus("draft")) refresh(); }} className={btn({ variant: "ghost", size: "sm" })}><Undo2 size={14} /> Back to draft</button>
                    <button onClick={() => { setPaidOn(todayISO()); setPaying(true); }} className={btn({ variant: "primary", size: "sm" })}><Banknote size={14} /> Mark paid</button>
                  </>
                )}
                {canEdit && run.status === "paid" && (
                  <button onClick={() => setConfirm("reopen")} className={btn({ variant: "ghost", size: "sm" })}><RotateCcw size={14} /> Reopen</button>
                )}
              </div>
            }
          >
            {lines === null ? <Spinner /> : lines.length === 0 ? (
              <EmptyState>No staff in this run.{editable && " Use Rebuild after adding staff to the institution."}</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead>
                    <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted">
                      <th className="py-2 font-bold">Staff</th>
                      <th className="py-2 text-right font-bold">Days</th>
                      <th className="py-2 text-right font-bold">Basic</th>
                      <th className="py-2 text-right font-bold">Allowances</th>
                      <th className="py-2 text-right font-bold">Bonus</th>
                      <th className="py-2 text-right font-bold">Gross</th>
                      <th className="py-2 text-right font-bold">Other deduction</th>
                      <th className="py-2 text-right font-bold">Net pay</th>
                      <th className="py-2 text-right font-bold">Total cost</th>
                      <th className="py-2 font-bold">Note</th>
                      {editable && <th className="no-print py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-t border-line align-middle">
                        <td className="py-2">
                          <div className="font-bold">{l.staff_name}</div>
                          <div className="text-[11.5px] text-muted">{l.designation || "Staff"}</div>
                        </td>
                        <td className="tnum py-2 text-right">
                          {editable
                            ? <NumCell value={l.days_worked} width="w-14" onSave={(v) => saveLine(l, { days_worked: Math.round(v) })} suffix={`/${l.days_in_month}`} />
                            : `${l.days_worked}/${l.days_in_month}`}
                        </td>
                        <td className="tnum py-2 text-right">{fmt(l.basic)}</td>
                        <td className="tnum py-2 text-right">{fmt(l.allowances)}</td>
                        <td className="tnum py-2 text-right">
                          {editable ? <NumCell value={Number(l.bonus)} onSave={(v) => saveLine(l, { bonus: v })} /> : fmt(l.bonus)}
                        </td>
                        <td className="tnum py-2 text-right font-semibold">{fmt(l.gross)}</td>
                        <td className="tnum py-2 text-right">
                          {editable ? <NumCell value={Number(l.other_deduction)} onSave={(v) => saveLine(l, { other_deduction: v })} /> : fmt(l.other_deduction)}
                        </td>
                        <td className="tnum py-2 text-right font-semibold">{fmt(l.net)}</td>
                        <td className="tnum py-2 text-right font-bold">{fmt(l.cost)}</td>
                        <td className="py-2 text-[12.5px] text-muted">
                          {editable
                            ? <TextCell value={l.note || ""} onSave={(v) => saveLine(l, { note: v || null })} />
                            : l.note || ""}
                        </td>
                        {editable && (
                          <td className="no-print py-2 text-right">
                            <button onClick={() => removeLine(l)} className="grid h-8 w-8 place-items-center rounded-lg text-bad hover:bg-bad-bg" aria-label={`Remove ${l.staff_name}`}><Trash2 size={14} /></button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-line font-extrabold">
                      <td className="py-2.5">Total</td>
                      <td colSpan={4} />
                      <td className="tnum py-2.5 text-right">{fmt(totals.gross)}</td>
                      <td />
                      <td className="tnum py-2.5 text-right">{fmt(totals.net)}</td>
                      <td className="tnum py-2.5 text-right">{fmt(totals.cost)}</td>
                      <td />
                      {editable && <td className="no-print" />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <p className="mt-3 text-[12px] text-muted">
              Gross = (basic + allowances) × days worked ÷ days in month + bonus. Net pay = gross − recurring deductions (pro-rated) − other deduction.
              Total cost = gross + employer contributions; this is what is posted as the institution&apos;s salary expense when the run is paid.
            </p>
          </Panel>
        </>
      )}

      {paying && run && (
        <Modal title="Mark payroll paid" onClose={() => setPaying(false)}>
          <p className="mb-4 text-[14px] text-muted">
            Records <b className="text-ink">{fmt(totals.cost)}</b> as a <b className="text-ink">Staff Salaries</b> expense for <b className="text-ink">{unitLabel}</b>, {monthName(month)}.
            The run is then locked.
          </p>
          <label className="mb-1 block text-[13px] font-bold">Paid on</label>
          <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={cx(inputClass, "mb-5")} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setPaying(false)} className={btn({ variant: "ghost" })}>Cancel</button>
            <button onClick={markPaid} disabled={busy || !paidOn} className={btn({ variant: "primary" })}>{busy ? "Posting…" : "Mark paid"}</button>
          </div>
        </Modal>
      )}

      {confirm && run && (
        <Modal
          title={confirm === "regenerate" ? "Rebuild this payroll?" : confirm === "delete" ? "Delete this payroll run?" : "Reopen this payroll?"}
          onClose={() => setConfirm(null)}
        >
          <p className="mb-5 text-[14px] text-muted">
            {confirm === "regenerate" && "Every line is rebuilt from current salaries and staff. Bonuses, other deductions, day changes and notes made on this draft are lost."}
            {confirm === "delete" && `The ${run.status} payroll for ${unitLabel}, ${monthName(month)} is deleted. You can generate it again.`}
            {confirm === "reopen" && `The ${fmt(totals.cost)} salary expense this run posted is deleted, and the run goes back to approved so it can be corrected and paid again.`}
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirm(null)} className={btn({ variant: "ghost" })}>Cancel</button>
            <button
              onClick={confirm === "regenerate" ? regenerate : confirm === "delete" ? deleteRun : reopen}
              disabled={busy}
              className={btn({ variant: "danger" })}
            >
              {confirm === "regenerate" ? "Rebuild" : confirm === "delete" ? "Delete" : "Reopen"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Inline editors that save on blur / Enter.
function NumCell({ value, onSave, width = "w-24", suffix }: { value: number; onSave: (v: number) => void; width?: string; suffix?: string }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Number(v);
    if (v.trim() === "" || Number.isNaN(n)) { setV(String(value)); return; }
    if (n !== Number(value)) onSave(n);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        inputMode="decimal" className={cx(inputClass, width, "px-2 py-1 text-right text-[13px]")} />
      {suffix && <span className="text-muted">{suffix}</span>}
    </span>
  );
}

function TextCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== value && onSave(v.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder="—" className={cx(inputClass, "w-36 px-2 py-1 text-[12.5px]")} />
  );
}
