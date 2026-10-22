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
  /** The unit this is charged to (null = the institution's common costs). */
  unit_id?: string | null;
  /** Set on the salary expense a payroll run posted. */
  payroll_run_id?: string | null;
}

export interface Staff {
  id: string;
  name: string;
  /** The institution's own staff ID number, as printed on its salary
   *  statements. Unique within the unit; see supabase/staff-code.sql. */
  code?: string | null;
  designation: string | null;
  device_user_id: number | null;
  phone: string | null;
  active: boolean;
  created_at: string;
  unit_id?: string | null;
  /** Current basic salary; past months use salary_revisions. */
  basic_salary?: number | null;
  joined_on?: string | null;
  left_on?: string | null;
}

/** A unit inside an institution (PMSA's schools and colleges), see
 *  supabase/pmsa-units-payroll.sql. */
export interface Unit {
  id: string;
  name: string;
  sort: number;
  active: boolean;
  monthly_budget: number | null;
}

export interface SalaryRevision {
  id: string;
  staff_id: string;
  basic_salary: number;
  effective_from: string;
}

export type ComponentKind = "allowance" | "deduction" | "employer";

export interface SalaryComponent {
  id: string;
  staff_id: string;
  kind: ComponentKind;
  name: string;
  amount: number;
  effective_from: string;
  effective_to: string | null;
}

export type RunStatus = "draft" | "approved" | "paid";

export interface PayrollRun {
  id: string;
  unit_id: string;
  /** First day of the month, YYYY-MM-01. */
  month: string;
  status: RunStatus;
  paid_on: string | null;
}

export interface PayrollLine {
  id: string;
  run_id: string;
  staff_id: string | null;
  staff_name: string;
  designation: string | null;
  days_in_month: number;
  days_worked: number;
  basic: number;
  allowances: number;
  deductions: number;
  employer: number;
  bonus: number;
  other_deduction: number;
  gross: number;
  net: number;
  cost: number;
  note: string | null;
}

export interface Attendance {
  id: string;
  staff_id: string;
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  source: "device" | "manual";
  remarks: string | null;
}

// The institute super-admins. ONLY these accounts may open the Accounts
// (accounting) module and create login accounts. Every other user — including
// other admins, teachers and office staff — is denied. This is mirrored in the
// database by public.is_superadmin() (see
// supabase/lock-accounting-to-superadmins.sql), which is the real security
// boundary; the checks in the app are just the UI/route layer.
export const SUPERADMIN_EMAILS = [
  "cryptolife676@gmail.com",
  "abdulkaderpallar@gmail.com",
] as const;

export const isSuperadmin = (email?: string | null): boolean =>
  !!email && (SUPERADMIN_EMAILS as readonly string[]).includes(email.trim().toLowerCase());

/** @deprecated use SUPERADMIN_EMAILS / isSuperadmin() */
export const SUPERADMIN_EMAIL = SUPERADMIN_EMAILS[0];

export const isEditor = (role?: Role | null) => role === "admin" || role === "accountant";

// Only these roles may enter the portal at all. "pending" (and anyone with no
// profile) is denied — this is what keeps unregistered Google/Apple sign-ins out.
export const hasAccess = (role?: Role | null) =>
  role === "admin" || role === "accountant" || role === "viewer";
