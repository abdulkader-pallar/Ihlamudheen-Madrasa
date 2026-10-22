"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { Modal } from "@/components/admin/ui";
import { toast } from "@/components/ui/toast";
import { fmt, fmtDate, todayISO } from "@/lib/format";
import type { ComponentKind, SalaryComponent, Staff } from "@/lib/types";
import { componentsFor, fromPaise, monthlyPay } from "@/lib/unit-payroll";
import { btn, cx, inputClass, labelClass } from "@/lib/ui";

// One staff member's monthly pay: recurring allowances, deductions and
// employer contributions, plus their basic-salary history. Payroll copies
// these into each month's run (lib/unit-payroll.ts).

const KINDS: { kind: ComponentKind; label: string; hint: string }[] = [
  { kind: "allowance", label: "Allowance", hint: "Added to gross pay — DA, HRA, special allowance" },
  { kind: "deduction", label: "Deduction", hint: "Taken from net pay — PF employee share, advance recovery" },
  { kind: "employer", label: "Employer cost", hint: "Paid by the institution on top — PF/ESI employer share" },
];

export function SalaryDialog({ staff, onClose }: { staff: Staff; onClose: () => void }) {
  const { supabase, salaryComponents, salaryRevisions, reloadSalary, canEdit } = useData();
  const month = todayISO().slice(0, 7);
  const [kind, setKind] = useState<ComponentKind>("allowance");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(month + "-01");
  const [busy, setBusy] = useState(false);

  const mine = useMemo(() => salaryComponents.filter((c) => c.staff_id === staff.id), [salaryComponents, staff.id]);
  const current = useMemo(() => new Set(componentsFor(staff.id, salaryComponents, month).map((c) => c.id)), [salaryComponents, staff.id, month]);
  const history = useMemo(
    () => salaryRevisions.filter((r) => r.staff_id === staff.id).sort((a, b) => b.effective_from.localeCompare(a.effective_from)),
    [salaryRevisions, staff.id]
  );
  const pay = monthlyPay(staff, salaryRevisions, salaryComponents, month);
  const gross = fromPaise(pay.basic + pay.allowances);

  const add = async () => {
    const amt = Number(amount);
    if (!name.trim()) return toast("Give it a name, e.g. HRA.", true);
    if (!(amt > 0)) return toast("Enter an amount.", true);
    setBusy(true);
    const { error } = await supabase.from("salary_components").insert({ staff_id: staff.id, kind, name: name.trim(), amount: amt, effective_from: from || todayISO() });
    setBusy(false);
    if (error) return toast(error.message, true);
    setName(""); setAmount("");
    await reloadSalary();
  };

  // Ending an item keeps it on past payrolls; deleting removes it everywhere
  // it hasn't already been copied into a run.
  const end = async (c: SalaryComponent) => {
    // An item that only starts this month (or later) was never paid in an
    // earlier month, so there is nothing to keep: stopping it from this month
    // means it goes. Its end date can't fall before its start date anyway.
    if (c.effective_from >= month + "-01") {
      const { error } = await supabase.from("salary_components").delete().eq("id", c.id);
      if (error) return toast(error.message, true);
      toast(`${c.name} removed - it hadn't been paid in any earlier month.`);
      return reloadSalary();
    }
    const effective_to = new Date(new Date(month + "-01T00:00:00").getTime() - 86400000).toLocaleDateString("en-CA");
    const { error } = await supabase.from("salary_components").update({ effective_to }).eq("id", c.id);
    if (error) return toast(error.message, true);
    toast(`${c.name} stops from ${fmtDate(month + "-01")}.`);
    await reloadSalary();
  };
  const remove = async (c: SalaryComponent) => {
    const { error } = await supabase.from("salary_components").delete().eq("id", c.id);
    if (error) return toast(error.message, true);
    await reloadSalary();
  };

  return (
    <Modal title={`Salary — ${staff.name}`} onClose={onClose}>
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
          <Row label="Basic" value={fmt(fromPaise(pay.basic))} />
          <Row label="Allowances" value={fmt(fromPaise(pay.allowances))} />
          <Row label="Gross pay" value={fmt(gross)} bold />
          <Row label="Deductions" value={"−" + fmt(fromPaise(pay.deductions))} />
          <Row label="Net pay" value={fmt(fromPaise(pay.basic + pay.allowances - pay.deductions))} bold />
          <Row label="Employer cost" value={fmt(fromPaise(pay.employer))} />
          <div className="col-span-2 mt-1 border-t border-line pt-2">
            <Row label="Monthly cost to institution" value={fmt(fromPaise(pay.basic + pay.allowances + pay.employer))} bold />
          </div>
        </div>

        {KINDS.map(({ kind: k, label }) => {
          const items = mine.filter((c) => c.kind === k);
          if (!items.length) return null;
          return (
            <div key={k}>
              <div className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-muted">{label}s</div>
              <div className="grid gap-1.5">
                {items.map((c) => (
                  <div key={c.id} className={cx("flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[13px]", !current.has(c.id) && "opacity-55")}>
                    <div className="min-w-0">
                      <b>{c.name}</b> <span className="tnum">{fmt(c.amount)}</span>
                      <div className="text-[11.5px] text-muted">
                        from {fmtDate(c.effective_from)}{c.effective_to ? ` to ${fmtDate(c.effective_to)}` : ""}
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-1">
                        {!c.effective_to && <button onClick={() => end(c)} className={btn({ variant: "ghost", size: "sm" })}>Stop</button>}
                        <button onClick={() => remove(c)} className="grid h-8 w-8 place-items-center rounded-lg text-bad hover:bg-bad-bg" aria-label={`Delete ${c.name}`}><Trash2 size={14} /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {canEdit && (
          <div className="grid gap-2.5 rounded-xl border border-dashed border-line p-3">
            <div className="flex gap-1 rounded-[10px] border border-line bg-surface-2 p-1">
              {KINDS.map((k) => (
                <button key={k.kind} type="button" onClick={() => setKind(k.kind)}
                  className={cx("flex-1 rounded-lg py-1.5 text-[12.5px] font-bold transition", kind === k.kind ? "btn-grad text-white" : "text-muted")}>
                  {k.label}
                </button>
              ))}
            </div>
            <p className="text-[12px] text-muted">{KINDS.find((k) => k.kind === kind)?.hint}</p>
            <div className="grid grid-cols-[1.3fr_1fr] gap-2.5">
              <div>
                <label className={labelClass}>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder={kind === "allowance" ? "HRA" : kind === "deduction" ? "PF (employee)" : "PF (employer)"} />
              </div>
              <div>
                <label className={labelClass}>₹ / month</label>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={inputClass} placeholder="0" />
              </div>
            </div>
            <div className="flex items-end gap-2.5">
              <div className="flex-1">
                <label className={labelClass}>From</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
              </div>
              <button onClick={add} disabled={busy} className={btn({ variant: "primary" })}><Plus size={15} /> Add</button>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div>
            <div className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-muted">Basic salary history</div>
            <div className="grid gap-1 text-[13px]">
              {history.map((r) => (
                <div key={r.id} className="flex justify-between border-b border-line py-1 last:border-0">
                  <span className="text-muted">from {fmtDate(r.effective_from)}</span>
                  <span className="tnum font-semibold">{fmt(r.basic_salary)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button onClick={onClose} className={btn({ variant: "ghost" })}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className={cx("tnum", bold && "font-extrabold")}>{value}</span>
    </div>
  );
}
