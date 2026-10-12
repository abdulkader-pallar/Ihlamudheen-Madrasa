"use client";

import { useState } from "react";
import { useData } from "@/components/admin/data-context";
import { Modal } from "@/components/admin/ui";
import { toast } from "@/components/ui/toast";
import type { Staff } from "@/lib/types";
import { btn, inputClass, labelClass } from "@/lib/ui";

// Add / edit one staff member on the selected institution. Used by the Staff
// page and the Staff Attendance page.
export function StaffDialog({ staff, onClose, onSaved }: { staff: Staff | null; onClose: () => void; onSaved: () => void }) {
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
