"use client";

import { useState } from "react";
import { Modal } from "./ui";
import { useData } from "./data-context";
import { toast } from "@/components/ui/toast";
import { inputClass, labelClass, btn, cx } from "@/lib/ui";
import { todayISO } from "@/lib/format";
import type { Transaction, TxType } from "@/lib/types";

export function TxDialog({ tx, onClose }: { tx?: Transaction | null; onClose: () => void }) {
  const { categories, funds, supabase, reload } = useData();
  const editing = !!tx;
  const [type, setType] = useState<TxType>(tx?.type ?? "income");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const cats = categories.filter((c) => c.kind === type);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amount = parseFloat(String(f.get("amount")));
    if (!(amount > 0)) return setError("Enter a valid amount.");
    setError("");
    setSaving(true);
    const payload = {
      type,
      amount,
      occurred_on: String(f.get("date")),
      category_id: (f.get("category") as string) || null,
      fund_id: (f.get("fund") as string) || null,
      description: (String(f.get("description")).trim() || null) as string | null,
      reference: (String(f.get("reference")).trim() || null) as string | null,
    };
    const res = editing
      ? await supabase.from("transactions").update(payload).eq("id", tx!.id)
      : await supabase.from("transactions").insert(payload);
    if (res.error) {
      setSaving(false);
      return setError(res.error.message);
    }
    await reload();
    toast(editing ? "Entry updated" : "Entry added");
    onClose();
  };

  return (
    <Modal title={editing ? "Edit entry" : "New entry"} onClose={onClose}>
      <form onSubmit={onSubmit} className="grid gap-4">
        <div>
          <label className={labelClass}>Type</label>
          <div className="flex gap-1.5 rounded-[11px] border border-line bg-surface-2 p-1">
            {(["income", "expense"] as TxType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cx(
                  "flex-1 rounded-lg py-2 text-[13.5px] font-bold capitalize transition",
                  type === t ? (t === "income" ? "bg-good text-white" : "bg-bad text-white") : "text-muted"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Amount (₹)</label>
            <input name="amount" type="number" step="0.01" min="0.01" required defaultValue={tx?.amount ?? ""} placeholder="0.00" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Date</label>
            <input name="date" type="date" required defaultValue={tx?.occurred_on ?? todayISO()} className={inputClass} />
          </div>
        </div>

        <div>
          <label className={labelClass}>Category</label>
          <select name="category" required defaultValue={tx?.category_id ?? ""} className={inputClass}>
            <option value="" disabled>Select a category</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Fund / account</label>
          <select name="fund" defaultValue={tx?.fund_id ?? ""} className={inputClass}>
            <option value="">— none —</option>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Description</label>
          <input name="description" defaultValue={tx?.description ?? ""} placeholder="e.g. October fees — Class 3" className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>Reference / voucher no. (optional)</label>
          <input name="reference" defaultValue={tx?.reference ?? ""} className={inputClass} />
        </div>

        {error && <p className="text-sm font-semibold text-bad">{error}</p>}

        <div className="flex justify-end gap-2.5">
          <button type="button" onClick={onClose} className={btn({ variant: "ghost" })}>Cancel</button>
          <button type="submit" disabled={saving} className={btn({ variant: "primary" })}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add entry"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
