"use client";

import { useMemo, useState } from "react";
import { Download, Fingerprint, Pencil, Plus, Search, Trash2, UserCheck, UserRound, UserX } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { EmptyState, Modal, Panel, Spinner, StatCard } from "@/components/admin/ui";
import { StaffDialog } from "@/components/admin/staff-dialog";
import { toast } from "@/components/ui/toast";
import { downloadCSV } from "@/lib/csv";
import type { Staff } from "@/lib/types";
import { btn, cx, inputClass } from "@/lib/ui";

// Staff register for the selected institution (Ihlamudheen, Grace Valley or
// PMSA — see components/admin/data-context.tsx). These are the people tracked
// by the ZKTeco attendance device, not portal login accounts.

type Show = "all" | "active" | "inactive";

export default function StaffPage() {
  const { staff, loading, canEdit, supabase, reloadStaff, site } = useData();
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("active");
  const [edit, setEdit] = useState<Staff | "new" | null>(null);
  const [del, setDel] = useState<Staff | null>(null);

  const counts = useMemo(() => {
    const active = staff.filter((s) => s.active).length;
    return { total: staff.length, active, inactive: staff.length - active, noDevice: staff.filter((s) => s.active && s.device_user_id == null).length };
  }, [staff]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return staff.filter((s) => {
      if (show === "active" && !s.active) return false;
      if (show === "inactive" && s.active) return false;
      if (!term) return true;
      return [s.name, s.designation, s.phone, s.device_user_id?.toString()].some((v) => v?.toLowerCase().includes(term));
    });
  }, [staff, q, show]);

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
    const rows: (string | number)[][] = [["Name", "Designation", "Device user id", "Phone", "Status"]];
    list.forEach((s) => rows.push([s.name, s.designation || "", s.device_user_id ?? "", s.phone || "", s.active ? "Active" : "Inactive"]));
    downloadCSV(`${site.id}-staff`, rows);
    toast("CSV downloaded");
  };

  if (loading) return <Spinner />;

  return (
    <div className="animate-fade grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={UserRound} accent="teal" label="Total staff" value={String(counts.total)} sub={site.name} />
        <StatCard icon={UserCheck} accent="green" label="Active" value={String(counts.active)} sub="Tracked in attendance" />
        <StatCard icon={UserX} accent="red" label="Inactive" value={String(counts.inactive)} sub="Kept for history" />
        <StatCard icon={Fingerprint} accent="gold" label="No device id" value={String(counts.noDevice)} sub="Active, can't punch in" />
      </div>

      <Panel
        title={`Staff (${list.length})`}
        action={
          <div className="flex gap-2">
            <button onClick={exportCSV} disabled={!list.length} className={btn({ variant: "ghost", size: "sm" })}><Download size={14} /> CSV</button>
            {canEdit && <button onClick={() => setEdit("new")} className={btn({ variant: "primary", size: "sm" })}><Plus size={15} /> Add staff</button>}
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <label className="relative min-w-[200px] flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, designation, phone, device id"
              className={cx(inputClass, "py-2 pl-9")} aria-label="Search staff" />
          </label>
          <div className="flex gap-1 rounded-xl border border-line bg-surface-2 p-1" role="tablist" aria-label="Show">
            {(["active", "inactive", "all"] as Show[]).map((v) => (
              <button key={v} role="tab" aria-selected={show === v} onClick={() => setShow(v)}
                className={cx("rounded-lg px-3 py-1.5 text-[13px] font-bold capitalize transition", show === v ? "bg-brand text-white" : "text-muted hover:text-ink")}>
                {v}
              </button>
            ))}
          </div>
        </div>

        {staff.length === 0 ? (
          <EmptyState>No staff on {site.name} yet.{canEdit && " Add your teachers & employees, then set each one's device user id."}</EmptyState>
        ) : list.length === 0 ? (
          <EmptyState>No staff match.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted">
                  <th className="py-2 font-bold">Name</th>
                  <th className="py-2 font-bold">Designation</th>
                  <th className="py-2 font-bold">Device id</th>
                  <th className="py-2 font-bold">Phone</th>
                  <th className="py-2 font-bold">Status</th>
                  {canEdit && <th className="py-2 text-right font-bold">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className="border-t border-line align-middle">
                    <td className="py-2.5 font-bold">{s.name}</td>
                    <td className="py-2.5 text-muted">{s.designation || "—"}</td>
                    <td className="tnum py-2.5">{s.device_user_id ?? <span className="text-muted">—</span>}</td>
                    <td className="tnum py-2.5 text-muted">{s.phone || "—"}</td>
                    <td className="py-2.5">
                      {s.active
                        ? <span className="inline-flex rounded-full bg-good-bg px-2.5 py-0.5 text-[11.5px] font-bold text-good">Active</span>
                        : <span className="inline-flex rounded-full bg-muted/20 px-2.5 py-0.5 text-[11.5px] font-bold text-muted">Inactive</span>}
                    </td>
                    {canEdit && (
                      <td className="py-2.5">
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => setEdit(s)} className={btn({ variant: "ghost", size: "sm" })} aria-label={`Edit ${s.name}`}>
                            <Pencil size={14} /> Edit
                          </button>
                          <button onClick={() => setActive(s, !s.active)} className={btn({ variant: "ghost", size: "sm" })}>
                            {s.active ? <><UserX size={14} /> Deactivate</> : <><UserCheck size={14} /> Activate</>}
                          </button>
                          <button onClick={() => setDel(s)} className="grid h-8 w-8 place-items-center rounded-lg text-bad hover:bg-bad-bg" aria-label={`Delete ${s.name}`}>
                            <Trash2 size={15} />
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
        />
      )}

      {del && (
        <Modal title="Delete staff member?" onClose={() => setDel(null)}>
          <p className="mb-5 text-[14px] text-muted">
            <b className="text-ink">{del.name}</b> and <b className="text-ink">all of their attendance history</b> will be permanently deleted.
            To stop tracking them but keep their history, use <b className="text-ink">Deactivate</b> instead.
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
