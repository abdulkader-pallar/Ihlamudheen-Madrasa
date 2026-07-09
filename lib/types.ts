export type Role = "admin" | "accountant" | "viewer";
export type TxType = "income" | "expense";

export interface Profile {
  id: string;
  full_name: string | null;
  role: Role;
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
