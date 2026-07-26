// ── Role Definitions ──────────────────────────────────────
// Unioned set: teacher/student roles + accounting viewer/pending roles.
export type UserRole = "admin" | "accountant" | "teacher" | "student" | "viewer" | "pending"

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  accountant: "Accountant",
  teacher: "Teacher",
  student: "Student",
  viewer: "Viewer",
  pending: "Pending",
}

export const ROLE_COLORS: Record<UserRole, string> = {
  admin: "bg-red-500",
  accountant: "bg-violet-500",
  teacher: "bg-teal-500",
  student: "bg-blue-500",
  viewer: "bg-slate-500",
  pending: "bg-amber-500",
}

export const ROLE_BADGE_COLORS: Record<UserRole, string> = {
  admin: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
  accountant: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400",
  teacher: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-400",
  student: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
  viewer: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-400",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
}

interface UserLike {
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
}

const VALID_ROLES: readonly UserRole[] = [
  "admin", "accountant", "teacher", "student", "viewer", "pending",
]

/**
 * Reads role from app_metadata first (service-role-only, not user-writable).
 * Falls back to user_metadata for backwards compat during migration.
 * app_metadata takes priority to prevent self-escalation via
 * supabase.auth.updateUser({ data: { role: 'admin' } }).
 * Unknown / missing role -> "pending" (no access until an admin assigns one).
 */
export function getUserRole(user?: UserLike | null): UserRole {
  const appRole = user?.app_metadata?.role as string | undefined
  if (appRole && (VALID_ROLES as readonly string[]).includes(appRole)) return appRole as UserRole
  const userRole = user?.user_metadata?.role as string | undefined
  if (userRole && (VALID_ROLES as readonly string[]).includes(userRole)) return userRole as UserRole
  return "pending"
}

// ── Permission Checks ─────────────────────────────────────
export function canManageUsers(role: UserRole): boolean {
  return role === "admin"
}

export function canManageFinance(role: UserRole): boolean {
  return role === "admin" || role === "accountant"
}

export function canEnrollStudents(role: UserRole): boolean {
  return role === "admin"
}

// Add/remove students within the roster. Accountants manage student records
// alongside admins; students/viewers cannot.
export function canManageStudents(role: UserRole): boolean {
  return role === "admin" || role === "accountant"
}

// Adding a student is also open to teachers — they can onboard their own
// class roster, but removing a student stays admin/accountant only.
export function canAddStudents(role: UserRole): boolean {
  return role === "admin" || role === "accountant" || role === "teacher"
}

export function canTakeAttendance(role: UserRole): boolean {
  return role === "admin" || role === "accountant" || role === "teacher"
}

export function canEnterGrades(role: UserRole): boolean {
  return role === "admin" || role === "accountant" || role === "teacher"
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function canViewReportCard(role: UserRole): boolean {
  return true // all roles can view
}

export function canManageSystem(role: UserRole): boolean {
  return role === "admin"
}
