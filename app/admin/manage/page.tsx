"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { EmptyState, Modal, Panel, Spinner } from "@/components/admin/ui";
import { toast } from "@/components/ui/toast";
import { isEditor, type TxType } from "@/lib/types";
import { btn, cx, inputClass, labelClass } from "@/lib/ui";

type DelTarget = { table: "categories" | "funds"; id: string; label: string } | null;

export default function ManagePage() {
  const { categories, funds, loading, profile, supabase, reload } = useData();
  const [addCat, setAddCat] = useState(false);
  const [addFund, setAddFund] = useState(false);
  const [del, setDel] = useState<DelTarget>(null);
  const editor = isEditor(profile.role);

  const doDelete = async () => {
    if (!del) return;
    const { error } = await supabase.from(del.table).delete().eq("id", del.id);
    if (error) return toast(error.message, true);
    setDel(null);
    await reload();
    toast("Removed");
  };

  if (loading) return <Spinner />;

  return (
    <div className="animate-fade grid gap-4 lg:grid-cols-2">
      <Panel title="Categories" action={editor && <button onClick={() => setAddCat(true)} className={btn({ variant: "gold", size: "sm" })}><Plus size={14} /> Add</button>}>
        <div className="grid max-h-[380px] gap-2 overflow-y-auto">
          {categories.length === 0 ? <EmptyState>No categories.</EmptyState> : categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2.5 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-sm">
              <span>{c.name} <span className={cx("ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold capitalize", c.kind === "income" ? "bg-good-bg text-good" : "bg-bad-bg text-bad")}>{c.kind}</span></span>
              {editor && <button onClick={() => setDel({ table: "categories", id: c.id, label: c.name })} className="text-bad hover:opacity-70" aria-label="Remove"><X size={16} /></button>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Funds / Accounts" action={editor && <button onClick={() => setAddFund(true)} className={btn({ variant: "gold", size: "sm" })}><Plus size={14} /> Add</button>}>
        <div className="grid max-h-[380px] gap-2 overflow-y-auto">
          {funds.length === 0 ? <EmptyState>No funds.</EmptyState> : funds.map((fd) => (
            <div key={fd.id} className="flex items-center justify-between gap-2.5 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-sm">
              <span>{fd.name}{fd.description && <span className="text-[12px] text-muted"> — {fd.description}</span>}</span>
              {editor && <button onClick={() => setDel({ table: "funds", id: fd.id, label: fd.name })} className="text-bad hover:opacity-70" aria-label="Remove"><X size={16} /></button>}
            </div>
          ))}
        </div>
      </Panel>

      {addCat && <AddCategory onClose={() => setAddCat(false)} />}
      {addFund && <AddFund onClose={() => setAddFund(false)} />}

      {del && (
        <Modal title="Remove item?" onClose={() => setDel(null)}>
          <p className="-mt-2 mb-5 text-muted">Remove “{del.label}”? Existing transactions keep their record but lose this link.</p>
          <div className="flex justify-end gap-2.5">
            <button onClick={() => setDel(null)} className={btn({ variant: "ghost" })}>Cancel</button>
            <button onClick={doDelete} className={btn({ variant: "danger" })}>Remove</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AddCategory({ onClose }: { onClose: () => void }) {
  const { supabase, reload } = useData();
  const [error, setError] = useState("");
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const { error } = await supabase.from("categories").insert({ name: String(fd.get("name")).trim(), kind: fd.get("kind") as TxType });
    if (error) return setError(error.message);
    await reload();
    toast("Category added");
    onClose();
  };
  return (
    <Modal title="Add category" onClose={onClose}>
      <form onSubmit={onSubmit} className="grid gap-4">
        <div><label className={labelClass}>Name</label><input name="name" required placeholder="e.g. Library Fund Income" className={inputClass} /></div>
        <div><label className={labelClass}>Type</label>
          <select name="kind" className={inputClass}><option value="income">Income</option><option value="expense">Expense</option></select>
        </div>
        {error && <p className="text-sm font-semibold text-bad">{error}</p>}
        <div className="flex justify-end gap-2.5"><button type="button" onClick={onClose} className={btn({ variant: "ghost" })}>Cancel</button><button className={btn({ variant: "primary" })}>Add</button></div>
      </form>
    </Modal>
  );
}

function AddFund({ onClose }: { onClose: () => void }) {
  const { supabase, reload } = useData();
  const [error, setError] = useState("");
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const { error } = await supabase.from("funds").insert({ name: String(fd.get("name")).trim(), description: String(fd.get("description")).trim() || null });
    if (error) return setError(error.message);
    await reload();
    toast("Fund added");
    onClose();
  };
  return (
    <Modal title="Add fund / account" onClose={onClose}>
      <form onSubmit={onSubmit} className="grid gap-4">
        <div><label className={labelClass}>Name</label><input name="name" required placeholder="e.g. Ramadan Fund" className={inputClass} /></div>
        <div><label className={labelClass}>Description (optional)</label><input name="description" className={inputClass} /></div>
        {error && <p className="text-sm font-semibold text-bad">{error}</p>}
        <div className="flex justify-end gap-2.5"><button type="button" onClick={onClose} className={btn({ variant: "ghost" })}>Cancel</button><button className={btn({ variant: "primary" })}>Add</button></div>
      </form>
    </Modal>
  );
}
