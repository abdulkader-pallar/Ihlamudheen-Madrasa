"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, Fingerprint, LogIn, LogOut, Pencil, Plus, UserRound } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { EmptyState, Modal, Panel, Spinner, StatCard } from "@/components/admin/ui";
import { toast } from "@/components/ui/toast";
import { isEditor, type Attendance, type Staff } from "@/lib/types";
import { btn, cx, inputClass, labelClass } from "@/lib/ui";

const todayStr = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local
const nowTime = () => new Date().toTimeString().slice(0, 5); // HH:MM, local
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

export default function AttendancePage() {
  const { staff, reloadStaff, supabase, profile, loading } = useData();
  const editor = isEditor(profile.role);
  const [date, setDate] = useState(todayStr());
  const [rows, setRows] = useState<Attendance[] | null>(null);
  const [editStaff, setEditStaff] = useState<Staff | "new" | null>(null);
  const [showManage, setShowManage] = useState(false);

  const load = useCallback(async () => {
    setRows(null);
    const { data, error } = await supabase
      .from("attendance")
      .select("id, staff_id, work_date, check_in, check_out, source, remarks")
      .eq("work_date", date);
    if (error) {
      toast(error.message, true);
      setRows([]);
      return;
    }
    setRows((data as Attendance[]) || []);
  }, [supabase, date]);

  useEffect(() => { load(); }, [load]);

  const byStaff = useMemo(() => {
    const m: Record<string, Attendance> = {};
    (rows || []).forEach((r) => { m[r.staff_id] = r; });
    return m;
  }, [rows]);

  const activeStaff = useMemo(() => staff.filter((s) => s.active), [staff]);
  const present = useMemo(() => activeStaff.filter((s) => byStaff[s.id]?.check_in).length, [activeStaff, byStaff]);

  // Save a manual check_in / check_out for a staff member on the selected date.
  const setTime = async (staffId: string, field: "check_in" | "check_out", value: string) => {
    const v = value || null;
    const existing = byStaff[staffId];
    let error;
    if (existing) {
      ({ error } = await supabase.from("attendance").update({ [field]: v, source: "manual" }).eq("id", existing.id));
    } else {
      ({ error } = await supabase.from("attendance").insert({ staff_id: staffId, work_date: date, [field]: v, source: "manual" }));
    }
    if (error) { toast(error.message, true); return; }
    await load();
  };

  if (loading) return <Spinner />;

  return (
    <div className="animate-fade grid gap-5">
      {/* Intro / device note */}
      <Panel>
        <div className="flex items-start gap-3">
          <Fingerprint size={20} className="mt-0.5 shrink-0 text-brand" />
          <p className="text-[14px] text-muted">
            In &amp; out times come from the <b className="text-ink">ZKTeco fingerprint device</b> automatically.
            Each staff member is matched by their <b className="text-ink">device user&nbsp;id</b>.
            {editor && " You can also record or correct times by hand below."}
          </p>
        </div>
      </Panel>

      {/* Controls + stats */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <StatCard icon={UserRound} accent="teal" label="Present" value={`${present} / ${activeStaff.length}`} sub={date === todayStr() ? "Today" : date} />
        <Panel className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2.5 text-[13px] font-bold">
            <CalendarDays size={18} className="text-brand" /> Date
            <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)}
              className={cx(inputClass, "w-auto py-2")} />
          </label>
          {editor && (
            <button onClick={() => setShowManage((v) => !v)} className={btn({ variant: "ghost", size: "sm" })}>
              <Clock size={15} /> Manage staff
            </button>
          )}
        </Panel>
      </div>

      {/* Manage staff */}
      {editor && showManage && (
        <Panel
          title={`Staff (${staff.length})`}
          action={<button onClick={() => setEditStaff("new")} className={btn({ variant: "primary", size: "sm" })}><Plus size={15} /> Add staff</button>}
        >
          {staff.length === 0 ? (
            <EmptyState>No staff yet. Add your teachers &amp; employees, then set each one&apos;s device user id.</EmptyState>
          ) : (
            <div className="grid gap-2">
              {staff.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold">
                      {s.name}
                      {!s.active && <span className="ml-2 rounded-full bg-muted/20 px-2 py-0.5 text-[10.5px] font-bold text-muted">Inactive</span>}
                    </div>
                    <div className="text-[12px] text-muted">
                      {s.designation || "Staff"}
                      {s.device_user_id != null ? ` · device #${s.device_user_id}` : " · no device id"}
                      {s.phone ? ` · ${s.phone}` : ""}
                    </div>
                  </div>
                  <button onClick={() => setEditStaff(s)} className={btn({ variant: "ghost", size: "sm" })} aria-label={`Edit ${s.name}`}>
                    <Pencil size={14} /> Edit
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {/* Attendance board */}
      <Panel title="Attendance">
        {rows === null ? (
          <Spinner />
        ) : activeStaff.length === 0 ? (
          <EmptyState>No active staff to show{editor ? " — add staff to get started." : "."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted">
                  <th className="py-2 font-bold">Staff</th>
                  <th className="py-2 font-bold">Status</th>
                  <th className="py-2 font-bold">In</th>
                  <th className="py-2 font-bold">Out</th>
                  <th className="py-2 font-bold">Source</th>
                </tr>
              </thead>
              <tbody>
                {activeStaff.map((s) => {
                  const a = byStaff[s.id];
                  return (
                    <tr key={s.id} className="border-t border-line align-middle">
                      <td className="py-2.5">
                        <div className="font-bold">{s.name}</div>
                        <div className="text-[12px] text-muted">{s.designation || "Staff"}</div>
                      </td>
                      <td className="py-2.5"><StatusChip a={a} /></td>
                      <td className="py-2.5">
                        <TimeCell value={hhmm(a?.check_in ?? null)} editor={editor}
                          onSet={(v) => setTime(s.id, "check_in", v)} onNow={() => setTime(s.id, "check_in", nowTime())} icon={LogIn} />
                      </td>
                      <td className="py-2.5">
                        <TimeCell value={hhmm(a?.check_out ?? null)} editor={editor}
                          onSet={(v) => setTime(s.id, "check_out", v)} onNow={() => setTime(s.id, "check_out", nowTime())} icon={LogOut} />
                      </td>
                      <td className="py-2.5 text-[12px] capitalize text-muted">{a?.source || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {editStaff && (
        <StaffDialog
          staff={editStaff === "new" ? null : editStaff}
          onClose={() => setEditStaff(null)}
          onSaved={async () => { setEditStaff(null); await reloadStaff(); }}
        />
      )}
    </div>
  );
}

function StatusChip({ a }: { a?: Attendance }) {
  if (!a?.check_in && !a?.check_out) return <span className="inline-flex rounded-full bg-bad-bg px-2.5 py-0.5 text-[11.5px] font-bold text-bad">Absent</span>;
  if (a.check_in && !a.check_out) return <span className="inline-flex rounded-full bg-accent/20 px-2.5 py-0.5 text-[11.5px] font-bold" style={{ color: "var(--accent)" }}>In — no out</span>;
  return <span className="inline-flex rounded-full bg-good-bg px-2.5 py-0.5 text-[11.5px] font-bold text-good">Present</span>;
}

function TimeCell({
  value, editor, onSet, onNow, icon: Icon,
}: {
  value: string; editor: boolean; onSet: (v: string) => void; onNow: () => void; icon: typeof LogIn;
}) {
  if (!editor) return <span className="tnum">{value || "—"}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="time"
        defaultValue={value}
        key={value}
        onBlur={(e) => { if (e.target.value !== value) onSet(e.target.value); }}
        className={cx(inputClass, "w-[118px] py-1.5 text-[13px]")}
      />
      {!value && (
        <button onClick={onNow} title="Set current time" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:border-brand hover:text-brand">
          <Icon size={15} />
        </button>
      )}
    </span>
  );
}

function StaffDialog({ staff, onClose, onSaved }: { staff: Staff | null; onClose: () => void; onSaved: () => void }) {
  const { supabase } = useData();
  const [name, setName] = useState(staff?.name || "");
  const [designation, setDesignation] = useState(staff?.designation || "");
  const [deviceId, setDeviceId] = useState(staff?.device_user_id != null ? String(staff.device_user_id) : "");
  const [phone, setPhone] = useState(staff?.phone || "");
  const [active, setActive] = useState(staff?.active ?? true);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { toast("Name is required.", true); return; }
    const device_user_id = deviceId.trim() === "" ? null : Number(deviceId.trim());
    if (device_user_id !== null && (!Number.isInteger(device_user_id) || device_user_id < 0)) {
      toast("Device user id must be a whole number.", true); return;
    }
    setBusy(true);
    const payload = { name: name.trim(), designation: designation.trim() || null, device_user_id, phone: phone.trim() || null, active };
    const { error } = staff
      ? await supabase.from("staff").update(payload).eq("id", staff.id)
      : await supabase.from("staff").insert(payload);
    setBusy(false);
    if (error) {
      toast(/duplicate|unique/i.test(error.message) ? "That device user id is already assigned to another staff member." : error.message, true);
      return;
    }
    toast(staff ? "Staff updated." : "Staff added.");
    onSaved();
  };

  return (
    <Modal title={staff ? "Edit staff" : "Add staff"} onClose={onClose}>
      <div className="grid gap-3.5">
        <div>
          <label className={labelClass}>Full name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Abdul Rahim" />
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label className={labelClass}>Designation</label>
            <input value={designation} onChange={(e) => setDesignation(e.target.value)} className={inputClass} placeholder="Teacher" />
          </div>
          <div>
            <label className={labelClass}>Device user id</label>
            <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} inputMode="numeric" className={inputClass} placeholder="e.g. 12" />
          </div>
        </div>
        <div>
          <label className={labelClass}>Phone (optional)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="+91…" />
        </div>
        <label className="flex items-center gap-2.5 text-[14px] font-semibold">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
          Active (tracked in attendance)
        </label>
        <div className="mt-1 flex justify-end gap-2.5">
          <button onClick={onClose} className={btn({ variant: "ghost" })}>Cancel</button>
          <button onClick={save} disabled={busy} className={btn({ variant: "primary" })}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Modal>
  );
}
