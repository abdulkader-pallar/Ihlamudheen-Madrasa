"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, UserRound } from "lucide-react";
import { useData } from "@/components/admin/data-context";
import { EmptyState, Panel, Spinner } from "@/components/admin/ui";
import { toast } from "@/components/ui/toast";
import { cx, inputClass } from "@/lib/ui";
import type { Role } from "@/lib/types";

type Row = { id: string; full_name: string | null; role: Role; created_at: string };

const ROLE_INFO: Record<Role, { label: string; desc: string; color: string }> = {
  admin: { label: "Admin", desc: "Full access, including user roles", color: "var(--accent)" },
  accountant: { label: "Accountant", desc: "Add and edit all records", color: "var(--brand)" },
  viewer: { label: "Viewer", desc: "Read-only reports", color: "#8b5cf6" },
};

export default function UsersPage() {
  const { profile, supabase } = useData();
  const [rows, setRows] = useState<Row[] | null>(null);
  const isAdmin = profile.role === "admin";

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

  if (rows === null) return <Spinner />;

  return (
    <div className="animate-fade grid gap-4">
      <Panel>
        <div className="flex items-start gap-3">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-brand" />
          <p className="text-[14px] text-muted">
            Roles control what each staff member can do. To add a new person, create their account in{" "}
            <b className="text-ink">Supabase → Authentication → Users</b> — they appear here as a viewer, then you
            assign their role.
          </p>
        </div>
      </Panel>

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
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
