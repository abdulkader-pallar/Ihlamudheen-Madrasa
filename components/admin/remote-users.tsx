"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { EmptyState, Modal, Panel, Spinner } from "@/components/admin/ui";
import { toast } from "@/components/ui/toast";
import type { Role } from "@/lib/types";
import { btn, cx, inputClass, labelClass } from "@/lib/ui";

// User management for another institution (Grace Valley, PMSA): add login
// accounts, change roles, reset passwords and remove accounts on that
// institution's own Supabase project via app/api/admin/sites/[site]/users.
// Ihlamudheen keeps the full platform tool (components/user-management.tsx).

type RemoteUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  created_at: string;
  last_sign_in_at: string | null;
};

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "accountant", label: "Accountant" },
  { value: "viewer", label: "Viewer (read-only)" },
  { value: "pending", label: "Pending (no access)" },
];

export function RemoteUsers() {
  const { site } = useData();
  const [users, setUsers] = useState<RemoteUser[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetFor, setResetFor] = useState<RemoteUser | null>(null);
  const [removing, setRemoving] = useState<RemoteUser | null>(null);
  const api = `/api/admin/sites/${site.id}/users`;

  const call = useCallback(async (method: string, body?: unknown) => {
    const res = await fetch(api, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }, [api]);

  const load = useCallback(async () => {
    try {
      setUsers((await call("GET")).users);
    } catch (e) {
      toast((e as Error).message, true);
      setUsers([]);
    }
  }, [call]);

  useEffect(() => { setUsers(null); load(); }, [load]);

  const changeRole = async (u: RemoteUser, role: Role) => {
    try {
      await call("PATCH", { id: u.id, role });
      toast(`${u.full_name || u.email} is now ${role}.`);
      await load();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  if (users === null) return <Spinner />;

  return (
    <>
      <Panel
        title={`${site.name} users (${users.length})`}
        action={<button onClick={() => setAdding(true)} className={btn({ variant: "primary", size: "sm" })}><Plus size={15} /> Add user</button>}
      >
        {users.length === 0 ? (
          <EmptyState>No login accounts on {site.name} yet.</EmptyState>
        ) : (
          <div className="grid gap-2">
            {users.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-2.5">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand font-bold text-white">
                  {(u.full_name || u.email || "?")[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-bold">{u.full_name || "Unnamed"}</div>
                  <div className="truncate text-[12px] text-muted">
                    {u.email}
                    {u.last_sign_in_at ? ` · last sign-in ${new Date(u.last_sign_in_at).toLocaleDateString("en-IN")}` : " · never signed in"}
                  </div>
                </div>
                <select
                  value={u.role}
                  onChange={(e) => changeRole(u, e.target.value as Role)}
                  aria-label={`Role for ${u.full_name || u.email}`}
                  className={cx(inputClass, "w-auto py-1.5 text-[13px]")}
                >
                  {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <button onClick={() => setResetFor(u)} className={btn({ variant: "ghost", size: "sm" })} aria-label={`Reset password for ${u.email}`}>
                  <KeyRound size={14} /> Password
                </button>
                <button onClick={() => setRemoving(u)} className="text-bad hover:opacity-70" aria-label={`Remove ${u.email}`}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {adding && (
        <AddUserDialog
          siteName={site.name}
          onClose={() => setAdding(false)}
          onSubmit={async (body) => {
            await call("POST", body);
            toast(`${body.name} can now sign in to ${site.name}.`);
            setAdding(false);
            await load();
          }}
        />
      )}

      {resetFor && (
        <PasswordDialog
          user={resetFor}
          onClose={() => setResetFor(null)}
          onSubmit={async (password) => {
            await call("PATCH", { id: resetFor.id, password });
            toast("Password changed.");
            setResetFor(null);
          }}
        />
      )}

      {removing && (
        <Modal title="Remove user?" onClose={() => setRemoving(null)}>
          <p className="mb-5 text-[14px] text-muted">
            <b className="text-ink">{removing.full_name || removing.email}</b> will no longer be able to sign in to {site.name}.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setRemoving(null)} className={btn({ variant: "ghost" })}>Cancel</button>
            <button
              onClick={async () => {
                try {
                  await call("DELETE", { id: removing.id });
                  toast("User removed.");
                  setRemoving(null);
                  await load();
                } catch (e) {
                  toast((e as Error).message, true);
                }
              }}
              className={btn({ variant: "danger" })}
            >
              <Trash2 size={15} /> Remove
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function AddUserDialog({
  siteName,
  onClose,
  onSubmit,
}: {
  siteName: string;
  onClose: () => void;
  onSubmit: (body: { name: string; email: string; password: string; role: Role }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await onSubmit({
        name: String(f.get("name")),
        email: String(f.get("email")),
        password: String(f.get("password")),
        role: f.get("role") as Role,
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Add a ${siteName} user`} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3.5">
        <div><label className={labelClass}>Full name</label><input name="name" required className={inputClass} /></div>
        <div><label className={labelClass}>Email</label><input name="email" type="email" required className={inputClass} /></div>
        <div><label className={labelClass}>Password</label><input name="password" type="password" minLength={8} required autoComplete="new-password" className={inputClass} /></div>
        <div>
          <label className={labelClass}>Role</label>
          <select name="role" defaultValue="accountant" className={inputClass}>
            {ROLE_OPTIONS.filter((r) => r.value !== "pending").map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        {error && <p className="text-[13px] font-semibold text-bad">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btn({ variant: "ghost" })}>Cancel</button>
          <button disabled={busy} className={btn({ variant: "primary" })}>{busy ? "Adding…" : "Add user"}</button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordDialog({ user, onClose, onSubmit }: { user: RemoteUser; onClose: () => void; onSubmit: (password: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(String(new FormData(e.currentTarget).get("password")));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Set a new password" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3.5">
        <p className="text-[14px] text-muted">For <b className="text-ink">{user.email}</b>.</p>
        <div><label className={labelClass}>New password</label><input name="password" type="password" minLength={8} required autoComplete="new-password" className={inputClass} /></div>
        {error && <p className="text-[13px] font-semibold text-bad">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btn({ variant: "ghost" })}>Cancel</button>
          <button disabled={busy} className={btn({ variant: "primary" })}>{busy ? "Saving…" : "Save password"}</button>
        </div>
      </form>
    </Modal>
  );
}
