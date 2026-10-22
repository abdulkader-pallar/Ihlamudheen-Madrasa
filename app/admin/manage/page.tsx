"use client";

import { useState } from "react";
import { Eye, EyeOff, Pencil, Plus, X } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { EmptyState, Modal, Panel, Spinner } from "@/components/admin/ui";
import { toast } from "@/components/ui/toast";
import type { TxType, Unit } from "@/lib/types";
import { btn, cx, inputClass, labelClass } from "@/lib/ui";

type DelTarget = { table: "categories" | "funds"; id: string; label: string } | null;

export default function ManagePage() {
  const { categories, funds, loading, canEdit, supabase, reload, units } = useData();
  const [addCat, setAddCat] = useState(false);
  const [addFund, setAddFund] = useState(false);
  const [del, setDel] = useState<DelTarget>(null);
  const editor = canEdit;

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
      <Panel title="Income Categories" action={editor && <button onClick={() => setAddCat(true)} className={btn({ variant: "gold", size: "sm" })}><Plus size={14} /> Add</button>}>
        <div className="grid max-h-[380px] gap-2 overflow-y-auto">
          {categories.filter((c) => c.kind === "income").length === 0
            ? <EmptyState>No income categories.</EmptyState>
            : categories.filter((c) => c.kind === "income").map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2.5 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-sm">
                <span>{c.name}</span>
                {editor && <button onClick={() => setDel({ table: "categories", id: c.id, label: c.name })} className="text-bad hover:opacity-70" aria-label="Remove"><X size={16} /></button>}
              </div>
            ))}
        </div>
      </Panel>

      <Panel title="Expense Categories" action={editor && <button onClick={() => setAddCat(true)} className={btn({ variant: "gold", size: "sm" })}><Plus size={14} /> Add</button>}>
        <div className="grid max-h-[380px] gap-2 overflow-y-auto">
          {categories.filter((c) => c.kind === "expense").length === 0
            ? <EmptyState>No expense categories.</EmptyState>
            : categories.filter((c) => c.kind === "expense").map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2.5 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-sm">
                <span>{c.name}</span>
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

      {units.length > 0 && <UnitsPanel />}

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

// The institution's units (PMSA's schools and colleges). Units with payroll
// history can't be deleted, so they're deactivated instead; inactive units
// drop out of the pickers but keep their past figures.
function UnitsPanel() {
  const { units, supabase, reload, canEdit, site } = useData();
  const [edit, setEdit] = useState<Unit | "new" | null>(null);
  const [name, setName] = useState("");

  const open = (u: Unit | "new") => { setEdit(u); setName(u === "new" ? "" : u.name); };
  const save = async () => {
    if (!name.trim()) return toast("Enter a name.", true);
    const { error } = edit === "new"
      ? await supabase.from("units").insert({ name: name.trim(), sort: units.length + 1 })
      : await supabase.from("units").update({ name: name.trim() }).eq("id", (edit as Unit).id);
    if (error) return toast(/duplicate|unique/i.test(error.message) ? "An institution with that name already exists." : error.message, true);
    setEdit(null);
    await reload();
    toast(edit === "new" ? "Institution added" : "Institution renamed");
  };
  const toggle = async (u: Unit) => {
    const { error } = await supabase.from("units").update({ active: !u.active }).eq("id", u.id);
    if (error) return toast(error.message, true);
    await reload();
  };

  return (
    <Panel title={`${site.name} Institutions`} action={canEdit && <button onClick={() => open("new")} className={btn({ variant: "gold", size: "sm" })}><Plus size={14} /> Add</button>}>
      <div className="grid max-h-[380px] gap-2 overflow-y-auto">
        {units.map((u) => (
          <div key={u.id} className={cx("flex items-center justify-between gap-2.5 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-sm", !u.active && "opacity-55")}>
            <span>{u.name}{!u.active && <span className="text-[12px] text-muted"> — inactive</span>}</span>
            {canEdit && (
              <span className="flex gap-2.5">
                <button onClick={() => open(u)} className="text-muted hover:text-ink" aria-label={`Rename ${u.name}`}><Pencil size={15} /></button>
                <button onClick={() => toggle(u)} className="text-muted hover:text-ink" aria-label={u.active ? `Deactivate ${u.name}` : `Activate ${u.name}`}>
                  {u.active ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      {edit && (
        <Modal title={edit === "new" ? "Add institution" : "Rename institution"} onClose={() => setEdit(null)}>
          <div className="grid gap-4">
            <div><label className={labelClass}>Name</label><input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} className={inputClass} placeholder="e.g. Hifz College" /></div>
            <div className="flex justify-end gap-2.5"><button onClick={() => setEdit(null)} className={btn({ variant: "ghost" })}>Cancel</button><button onClick={save} className={btn({ variant: "primary" })}>Save</button></div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
