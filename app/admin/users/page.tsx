"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Trash2, UserPlus, UserRound } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { EmptyState, Panel, Spinner } from "@/components/admin/ui";
import { toast } from "@/components/ui/toast";
import { btn, cx, inputClass, labelClass } from "@/lib/ui";
import { isSuperadmin, type Role } from "@/lib/types";

type Row = { id: string; full_name: string | null; role: Role; created_at: string };

const ROLE_INFO: Record<Role, { label: string; desc: string; color: string }> = {
  admin: { label: "Admin", desc: "Full access, including user roles", color: "var(--accent)" },
  accountant: { label: "Accountant", desc: "Add and edit all records", color: "var(--brand)" },
  viewer: { label: "Viewer", desc: "Read-only reports", color: "#8b5cf6" },
  pending: { label: "Pending", desc: "No access — awaiting approval", color: "var(--muted)" },
};

export default function UsersPage() {
  const { profile, supabase } = useData();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const isAdmin = profile.role === "admin";
  const isSuperadminUser = isSuperadmin(profile.email);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, role, created_at")
      .order("created_at");
    if (error) {
      toast(error.message, true);
      setRows([]);
      return;
    }
    setRows((data as Row[]) || []);
  }, [supabase]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <Panel>
        <EmptyState>Only admins can manage users.</EmptyState>
      </Panel>
    );
  }

  const changeRole = async (row: Row, role: Role) => {
    if (row.id === profile.id && role !== "admin") {
      const others = (rows || []).filter((r) => r.id !== row.id && r.role === "admin").length;
      if (others === 0) {
        toast("You are the only admin — promote someone else first.", true);
        return;
      }
    }
    const { error } = await supabase.from("profiles").update({ role }).eq("id", row.id);
    if (error) {
      toast(error.message, true);
      return;
    }
    toast(`${row.full_name || "User"} is now ${ROLE_INFO[role].label}`);
    await load();
  };

  const removeUser = async (row: Row) => {
    const who = row.full_name || "this user";
    if (!window.confirm(
      `Remove ${who}?\n\nTheir login will be deleted permanently and they will lose all access. This cannot be undone.`
    )) return;

    setRemovingId(row.id);
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body.error || "Could not remove that user.", true);
        return;
      }
      toast(`${who} has been removed`);
      await load();
    } finally {
      setRemovingId(null);
    }
  };

  if (rows === null) return <Spinner />;

  return (
    <div className="animate-fade grid gap-4">
      <Panel>
        <div className="flex items-start gap-3">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-brand" />
          <p className="text-[14px] text-muted">
            Roles control what each staff member can do.
            {isSuperadminUser
              ? " Add a new person below — they can sign in immediately with the email and password you set."
              : " New accounts are created by the super-admin; you can adjust their roles here."}
          </p>
        </div>
      </Panel>

      {isSuperadminUser && <AddUserForm onCreated={load} />}

      <Panel title={`Staff (${rows.length})`}>
        {rows.length === 0 ? (
          <EmptyState>No users yet.</EmptyState>
        ) : (
          <div className="grid gap-2.5">
            {rows.map((r) => {
              const info = ROLE_INFO[r.role];
              const me = r.id === profile.id;
              return (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3"
                >
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white"
                    style={{ background: info.color }}
                  >
                    <UserRound size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px] font-bold">
                      {r.full_name || "Unnamed"}
                      {me && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-[10.5px] font-bold text-white">You</span>}
                    </div>
                    <div className="text-[12px] text-muted">
                      {info.desc} · joined {new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </div>
                  </div>
                  <select
                    value={r.role}
                    onChange={(e) => changeRole(r, e.target.value as Role)}
                    className={cx(inputClass, "w-auto py-2 text-[13.5px] font-semibold")}
                    aria-label={`Role for ${r.full_name || "user"}`}
                  >
                    {(Object.keys(ROLE_INFO) as Role[]).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_INFO[role].label}
                      </option>
                    ))}
                  </select>
                  {/* Remove: super-admins only; never for yourself or another super-admin. */}
                  {isSuperadminUser && !me && (
                    <button
                      onClick={() => removeUser(r)}
                      disabled={removingId === r.id}
                      title={`Remove ${r.full_name || "user"}`}
                      aria-label={`Remove ${r.full_name || "user"}`}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line text-muted transition hover:border-bad hover:text-bad disabled:opacity-50"
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

function AddUserForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("accountant");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || "Could not create user.", true); return; }
      toast(`${name} added as ${role}.`);
      setName(""); setEmail(""); setPassword(""); setRole("accountant");
      onCreated();
    } catch {
      toast("Network error — please try again.", true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Add a user">
      <form onSubmit={submit} className="grid gap-3.5 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Full name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} placeholder="e.g. Muhammed Ali" />
        </div>
        <div>
          <label className={labelClass}>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="off" className={inputClass} placeholder="person@example.com" />
        </div>
        <div>
          <label className={labelClass}>Temporary password</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="text" required minLength={8} autoComplete="new-password" className={inputClass} placeholder="At least 8 characters" />
        </div>
        <div>
          <label className={labelClass}>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputClass}>
            <option value="admin">Admin — full access, incl. user roles</option>
            <option value="accountant">Accountant — add &amp; edit records</option>
            <option value="viewer">Viewer — read-only reports</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className={btn({ variant: "primary" })}>
            <UserPlus size={16} /> {busy ? "Creating…" : "Create user"}
          </button>
          <p className="mt-2 text-[12px] text-muted">Share the email &amp; password with the person; they can change the password after signing in.</p>
        </div>
      </form>
    </Panel>
  );
}
