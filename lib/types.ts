// "pending" = a signed-up account (e.g. via Google) that an admin has NOT yet
// approved. Pending users have NO access until an admin assigns a real role.
export type Role = "admin" | "accountant" | "viewer" | "pending";
export type TxType = "income" | "expense";

export interface Profile {
  id: string;
  full_name: string | null;
  role: Role;
  email?: string | null;
}

export interface Category {
  id: string;
  name: string;
  kind: TxType;
}

export interface Fund {
  id: string;
  name: string;
  description: string | null;
}

export interface Transaction {
  id: string;
  occurred_on: string;
  type: TxType;
  amount: number;
  category_id: string | null;
  fund_id: string | null;
  description: string | null;
  reference: string | null;
  created_by: string | null;
  created_at: string;
}

export const isEditor = (role?: Role | null) => role === "admin" || role === "accountant";

// Only these roles may enter the portal at all. "pending" (and anyone with no
// profile) is denied — this is what keeps unregistered Google/Apple sign-ins out.
export const hasAccess = (role?: Role | null) =>
  role === "admin" || role === "accountant" || role === "viewer";
