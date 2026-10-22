"use client";

import { useMemo, useState } from "react";
import { Download, IndianRupee, Pencil, Plus, Search, Trash2, UserCheck, UserRound, UserX } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { PdfButton } from "@/components/admin/pdf-button";
import { EmptyState, Modal, Panel, Spinner, StatCard } from "@/components/admin/ui";
import { StaffDialog } from "@/components/admin/staff-dialog";
import { SalaryDialog } from "@/components/admin/salary-dialog";
import { fmt, todayISO } from "@/lib/format";
import { basicFor, fromPaise, monthlyCost } from "@/lib/unit-payroll";
import { toast } from "@/components/ui/toast";
import { downloadCSV } from "@/lib/csv";
import type { Staff } from "@/lib/types";
import { btn, cx, inputClass } from "@/lib/ui";

// Staff register for the selected institution (Ihlamudheen, Grace Valley or
// PMSA — see components/admin/data-context.tsx). These are employees, not
// portal login accounts.

type Show = "all" | "active" | "inactive";

export default function StaffPage() {
  const { staff, allStaff, loading, canEdit, supabase, reloadStaff, site, units, unit, unitName, salaryRevisions, salaryComponents } = useData();
  const hasUnits = units.length > 0;
  const month = todayISO().slice(0, 7);
  const [salaryOf, setSalaryOf] = useState<Staff | null>(null);
  // Full-month cost to the institution at current pay, in paise.
  const costOf = useMemo(() => {
    const m: Record<string, number> = {};
    allStaff.forEach((s) => { m[s.id] = monthlyCost(s, salaryRevisions, salaryComponents, month); });
    return m;
  }, [allStaff, salaryRevisions, salaryComponents, month]);
  // Basic in force this month, in paise; shown beside the cost, which adds
  // allowances and employer contributions on top of it.
  const basicOf = useMemo(() => {
    const m: Record<string, number> = {};
    allStaff.forEach((s) => { m[s.id] = basicFor(s, salaryRevisions, month); });
    return m;
  }, [allStaff, salaryRevisions, month]);
  const onPayroll = (s: Staff) => s.active && (!s.left_on || s.left_on >= todayISO());
  const bill = useMemo(() => staff.filter(onPayroll).reduce((a, s) => a + (costOf[s.id] || 0), 0), [staff, costOf]);
  // Headcount and salary bill per unit (shown on "All").
  const byUnit = useMemo(() => {
    const rows = [...units.map((u) => ({ id: u.id as string | null, name: u.name })), { id: null, name: unitName(null) }].map((u) => {
      const list = allStaff.filter((s) => onPayroll(s) && (s.unit_id ?? null) === u.id);
      return { ...u, count: list.length, cost: list.reduce((a, s) => a + (costOf[s.id] || 0), 0) };
    });
    return rows.filter((r) => r.id !== null || r.count > 0);
  }, [units, allStaff, costOf, unitName]);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("active");
  const [edit, setEdit] = useState<Staff | "new" | null>(null);
  const [del, setDel] = useState<Staff | null>(null);

  const counts = useMemo(() => {
    const active = staff.filter((s) => s.active).length;
    return { total: staff.length, active, inactive: staff.length - active };
  }, [staff]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return staff.filter((s) => {
      if (show === "active" && !s.active) return false;
      if (show === "inactive" && s.active) return false;
      if (!term) return true;
      return [s.name, s.code, s.designation, s.phone, hasUnits ? unitName(s.unit_id) : null].some((v) => v?.toLowerCase().includes(term));
    });
  }, [staff, q, show, hasUnits, unitName]);

  const setActive = async (s: Staff, active: boolean) => {
    const { error } = await supabase.from("staff").update({ active }).eq("id", s.id);
    if (error) return toast(error.message, true);
    toast(active ? `${s.name} is active again.` : `${s.name} marked inactive.`);
    await reloadStaff();
  };

  const doDelete = async () => {
    if (!del) return;
    const { error } = await supabase.from("staff").delete().eq("id", del.id);
    if (error) return toast(error.message, true);
    toast(`${del.name} deleted.`);
    setDel(null);
    await reloadStaff();
  };

  const exportCSV = () => {
    const rows: (string | number)[][] = [["Staff ID", "Name", "Designation", ...(hasUnits ? ["Institution", "Basic salary", "Total salary"] : []), "Phone", "Status"]];
    list.forEach((s) => rows.push([
      s.code || "", s.name, s.designation || "",
      ...(hasUnits ? [unitName(s.unit_id), fromPaise(basicOf[s.id] || 0), fromPaise(costOf[s.id] || 0)] : []),
      s.phone || "", s.active ? "Active" : "Inactive",
    ]));
    downloadCSV(`${site.id}-staff`, rows);
    toast("CSV downloaded");
  };

  if (loading) return <Spinner />;

  return (
    <div className="animate-fade grid gap-5">
      <div className={cx("grid gap-4 sm:grid-cols-2", hasUnits ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
        <StatCard icon={UserRound} accent="teal" label="Total staff" value={String(counts.total)} sub={site.name} />
        <StatCard icon={UserCheck} accent="green" label="Active" value={String(counts.active)} sub="Currently employed" />
        <StatCard icon={UserX} accent="red" label="Inactive" value={String(counts.inactive)} sub="Kept for history" />
        {hasUnits && <StatCard icon={IndianRupee} accent="gold" label="Monthly salary bill" value={fmt(fromPaise(bill))} sub="Gross + employer cost, current pay" />}
      </div>

      {hasUnits && unit === "all" && (
        <Panel title="Salary bill by institution">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted">
                  <th className="py-2 font-bold">Institution</th>
                  <th className="py-2 text-right font-bold">Staff</th>
                  <th className="py-2 text-right font-bold">Total salary</th>
                </tr>
              </thead>
              <tbody>
                {byUnit.map((u) => (
                  <tr key={u.id ?? "common"} className="border-t border-line">
                    <td className="py-2.5 font-semibold">{u.name}</td>
                    <td className="tnum py-2.5 text-right">{u.count}</td>
                    <td className="tnum py-2.5 text-right font-bold">{fmt(fromPaise(u.cost))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-extrabold">
                  <td className="py-2.5">Total</td>
                  <td className="tnum py-2.5 text-right">{byUnit.reduce((a, u) => a + u.count, 0)}</td>
                  <td className="tnum py-2.5 text-right">{fmt(fromPaise(byUnit.reduce((a, u) => a + u.cost, 0)))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>
      )}

      <Panel
        title={`Staff (${list.length})`}
        action={
          <div className="flex gap-2">
            <button onClick={exportCSV} disabled={!list.length} className={btn({ variant: "ghost", size: "sm" })}><Download size={14} /> CSV</button>
        <PdfButton />
            {canEdit && <button onClick={() => setEdit("new")} className={btn({ variant: "primary", size: "sm" })}><Plus size={15} /> Add staff</button>}
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <label className="relative min-w-[200px] flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search staff ID, name, designation, phone"
              className={cx(inputClass, "py-2 pl-9")} aria-label="Search staff" />
          </label>
          <div className="flex gap-1 rounded-xl border border-line bg-surface-2 p-1" role="tablist" aria-label="Show">
            {(["active", "inactive", "all"] as Show[]).map((v) => (
              <button key={v} role="tab" aria-selected={show === v} onClick={() => setShow(v)}
                className={cx("rounded-lg px-3 py-1.5 text-[13px] font-bold capitalize transition", show === v ? "btn-grad text-white" : "text-muted hover:text-ink")}>
                {v}
              </button>
            ))}
          </div>
        </div>

        {staff.length === 0 ? (
          <EmptyState>No staff on {site.name} yet.{canEdit && " Add your teachers & employees."}</EmptyState>
        ) : list.length === 0 ? (
          <EmptyState>No staff match.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={cx("w-full text-sm", hasUnits ? "min-w-[940px]" : "min-w-[620px]")}>
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted">
                  <th className="py-2 font-bold">ID</th>
                  <th className="py-2 font-bold">Name</th>
                  <th className="py-2 font-bold">Designation</th>
                  {hasUnits && <th className="py-2 font-bold">Institution</th>}
                  {hasUnits && <th className="py-2 text-right font-bold">Basic salary</th>}
                  {hasUnits && <th className="py-2 pl-6 text-right font-bold" title="Basic + allowances + employer PF/ESI, per month">Total salary</th>}
                  {/* pl-6: keeps the phone clear of the right-aligned amount before it. */}
                  <th className="py-2 pl-6 font-bold">Phone</th>
                  <th className="py-2 font-bold">Status</th>
                  {canEdit && <th className="no-print py-2 text-right font-bold">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className="border-t border-line align-middle">
                    <td className="tnum py-2.5 text-muted">{s.code || "—"}</td>
                    <td className="py-2.5 font-bold">{s.name}</td>
                    <td className="py-2.5 text-muted">{s.designation || "—"}</td>
                    {hasUnits && <td className="py-2.5 text-muted">{unitName(s.unit_id)}</td>}
                    {hasUnits && (
                      <td className="tnum py-2.5 text-right">
                        {basicOf[s.id] ? fmt(fromPaise(basicOf[s.id])) : <span className="text-muted">—</span>}
                      </td>
                    )}
                    {hasUnits && (
                      <td className="tnum py-2.5 pl-6 text-right font-semibold">
                        {costOf[s.id] ? fmt(fromPaise(costOf[s.id])) : <span className="text-muted">No salary</span>}
                      </td>
                    )}
                    <td className="tnum py-2.5 pl-6 text-muted">{s.phone || "—"}</td>
                    <td className="py-2.5">
                      {s.active
                        ? <span className="inline-flex rounded-full bg-good-bg px-2.5 py-0.5 text-[11.5px] font-bold text-good">Active</span>
                        : <span className="inline-flex rounded-full bg-muted/20 px-2.5 py-0.5 text-[11.5px] font-bold text-muted">Inactive</span>}
                    </td>
                    {canEdit && (
                      <td className="no-print py-2.5">
                        {/* Salary, Deactivate and Delete live inside this dialog. */}
                        <div className="flex justify-end">
                          <button onClick={() => setEdit(s)} className={btn({ variant: "ghost", size: "sm" })} aria-label={`Edit ${s.name}`}>
                            <Pencil size={14} /> Edit
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {edit && (
        <StaffDialog
          staff={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={async () => { setEdit(null); await reloadStaff(); }}
          onSalary={hasUnits && edit !== "new" ? () => { setSalaryOf(edit); setEdit(null); } : undefined}
          onToggleActive={edit !== "new" ? async () => { setEdit(null); await setActive(edit, !edit.active); } : undefined}
          onDelete={edit !== "new" ? () => { setDel(edit); setEdit(null); } : undefined}
        />
      )}

      {salaryOf && <SalaryDialog staff={salaryOf} onClose={() => setSalaryOf(null)} />}

      {del && (
        <Modal title="Delete staff member?" onClose={() => setDel(null)}>
          <p className="mb-5 text-[14px] text-muted">
            <b className="text-ink">{del.name}</b> and their salary details will be permanently deleted.
            To take them off payroll but keep their history, use <b className="text-ink">Deactivate</b> instead.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDel(null)} className={btn({ variant: "ghost" })}>Cancel</button>
            {del.active && (
              <button onClick={async () => { await setActive(del, false); setDel(null); }} className={btn({ variant: "ghost" })}>
                <UserX size={15} /> Deactivate
              </button>
            )}
            <button onClick={doDelete} className={btn({ variant: "danger" })}><Trash2 size={15} /> Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
