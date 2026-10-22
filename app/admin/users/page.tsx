"use client";

import { UserManagement } from "@/components/user-management";

// The Accounts portal uses the same platform user management as the school
// ERP (/dashboard/user-mgmt), so there is one consistent tool for adding,
// editing and removing users, changing roles and resetting passwords. Every
// institution's books live in this one database, so it has one list of logins.
export default function UsersPage() {
  return <UserManagement />;
}
