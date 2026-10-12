"use client";

import { UserManagement } from "@/components/user-management";
import { RemoteUsers } from "@/components/admin/remote-users";
import { useData } from "@/components/admin/data-context";

// The Accounts portal uses the same platform user management as the school
// ERP (/dashboard/user-mgmt), so there is one consistent tool for adding,
// editing and removing users, changing roles and resetting passwords.
// Grace Valley and PMSA get the same jobs done on their own databases.
export default function UsersPage() {
  const { site } = useData();
  return site.local ? <UserManagement /> : <RemoteUsers key={site.id} />;
}
