"use client";

import { UserManagement } from "@/components/user-management";
import { useData } from "@/components/admin/data-context";
import { EmptyState, Panel, Spinner } from "@/components/admin/ui";

// The Accounts portal uses the same platform user management as the school
// ERP (/dashboard/user-mgmt), so there is one consistent tool for adding,
// editing and removing users, changing roles and resetting passwords.
// For the remote institutions (Grace Valley, PMSA) it is a read-only list of
// their login accounts, taken from their export.
export default function UsersPage() {
  const { site, users, loading } = useData();
  if (site.local) return <UserManagement />;
  if (loading) return <Spinner />;

  return (
    <Panel title={`${site.name} users (${users.length})`}>
      {users.length === 0 ? (
        <EmptyState>No user accounts on {site.name}.</EmptyState>
      ) : (
        <div className="grid gap-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-2.5">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand font-bold text-white">
                {(u.full_name || "?")[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1 truncate text-[14px] font-bold">{u.full_name || "Unnamed"}</div>
              <span className="rounded-full bg-accent/20 px-2.5 py-0.5 text-[11.5px] font-bold uppercase tracking-wide text-ink">
                {u.role}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
