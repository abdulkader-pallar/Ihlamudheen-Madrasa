import { supabase } from "./supabase"
import { authFetch } from "./api-client"

// ── Disabled teachers / staff ───────────────────────────────────────────────
// A teacher who has left Ihlamudheen Madrasa is "disabled" instead of deleted. Their
// historical punch records and approved salary snapshots stay intact, but they
// are hidden going forward from attendance widgets, synthesized absences,
// EDU-support hours, the staff grid, and payroll selection.
//
// The set of disabled ids is small and rarely changes, so each surface fetches
// it (directly, via authenticated SELECT) and filters initialTeachers locally.
// If the table is missing (migration not yet run) we fail open — an empty set,
// so the app behaves exactly as before.

export async function fetchDisabledTeacherIds(): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.from("disabled_teachers").select("teacher_id")
    if (error || !data) return new Set()
    return new Set((data as { teacher_id: string }[]).map((r) => r.teacher_id))
  } catch {
    return new Set()
  }
}

// Disable or re-enable a teacher (admin only — enforced server-side).
export async function setTeacherDisabled(
  teacherId: string,
  disabled: boolean,
  reason?: string,
): Promise<{ error: string | null }> {
  try {
    const res = await authFetch("/api/admin/teacher-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teacherId, disabled, reason }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      return { error: json.error ?? "Failed to update teacher status" }
    }
    return { error: null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Network error" }
  }
}
