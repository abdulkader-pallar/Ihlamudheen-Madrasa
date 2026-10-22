"use client";

import { useState } from "react";
import { useData } from "@/components/admin/data-context";
import { Modal } from "@/components/admin/ui";
import { toast } from "@/components/ui/toast";
import { todayISO } from "@/lib/format";
import type { Staff } from "@/lib/types";
import { btn, inputClass, labelClass } from "@/lib/ui";

// Add / edit one staff member on the selected institution. Used by the Staff
// page and the Staff Attendance page. Institutions with units (PMSA) also set
// the unit and salary here; allowances and deductions live in SalaryDialog.
export function StaffDialog({ staff, onClose, onSaved }: { staff: Staff | null; onClose: () => void; onSaved: () => void }) {
  const { supabase, units, unit, reloadSalary } = useData();
  const hasUnits = units.length > 0;
  const [unitId, setUnitId] = useState(staff ? staff.unit_id ?? "" : unit === "all" || unit === "common" ? "" : unit);
  const [basic, setBasic] = useState(staff?.basic_salary != null ? String(staff.basic_salary) : "");
  // A new basic applies from the 1st of this month unless changed.
  const [basicFrom, setBasicFrom] = useState(todayISO().slice(0, 8) + "01");
  const [joinedOn, setJoinedOn] = useState(staff?.joined_on || "");
  const [leftOn, setLeftOn] = useState(staff?.left_on || "");
  const basicChanged = (basic.trim() === "" ? null : Number(basic)) !== (staff?.basic_salary != null ? Number(staff.basic_salary) : null);
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
    const basic_salary = basic.trim() === "" ? null : Number(basic);
    if (hasUnits) {
      if (basic_salary !== null && !(basic_salary >= 0)) { toast("Basic salary must be a number.", true); return; }
      if (joinedOn && leftOn && leftOn < joinedOn) { toast("Left date is before the joining date.", true); return; }
    }
    setBusy(true);
    const payload = {
      name: name.trim(), designation: designation.trim() || null, device_user_id, phone: phone.trim() || null, active,
      ...(hasUnits ? { unit_id: unitId || null, basic_salary, joined_on: joinedOn || null, left_on: leftOn || null } : {}),
    };
    const res = staff
      ? await supabase.from("staff").update(payload).eq("id", staff.id).select("id").single()
      : await supabase.from("staff").insert(payload).select("id").single();
    const error = res.error;
    // Record the basic in the salary history so earlier months keep the old figure.
    if (!error && hasUnits && basic_salary !== null && basicChanged && res.data) {
      const { error: e2 } = await supabase
        .from("salary_revisions")
        .upsert({ staff_id: (res.data as { id: string }).id, basic_salary, effective_from: basicFrom || todayISO() }, { onConflict: "staff_id,effective_from" });
      if (e2) toast(`Saved, but the salary history wasn't updated: ${e2.message}`, true);
      await reloadSalary();
    }
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
        {hasUnits && (
          <>
            <div>
              <label className={labelClass}>Institution</label>
              <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={inputClass}>
                <option value="">— Common (no institution) —</option>
                {units.filter((u) => u.active || u.id === unitId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className={labelClass}>Basic salary (₹/month)</label>
                <input value={basic} onChange={(e) => setBasic(e.target.value)} inputMode="decimal" className={inputClass} placeholder="e.g. 18000" />
              </div>
              <div>
                <label className={labelClass}>{staff ? "New basic from" : "Basic from"}</label>
                <input type="date" value={basicFrom} onChange={(e) => setBasicFrom(e.target.value)} disabled={!basicChanged} className={inputClass} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className={labelClass}>Joined on</label>
                <input type="date" value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Left on</label>
                <input type="date" value={leftOn} onChange={(e) => setLeftOn(e.target.value)} className={inputClass} />
              </div>
            </div>
            <p className="-mt-1 text-[12px] text-muted">Allowances, deductions and PF/ESI are added with the <b>Salary</b> button on the Staff page.</p>
          </>
        )}
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
