// ╔══════════════════════════════════════════════════════════════════╗
// ║ Meelad Fest — student autocomplete from the existing Ihlamudheen roll ║
// ║                                                                    ║
// ║ Teachers shouldn't retype details the institute already holds.     ║
// ║ As they type a register number or name in the fest "Add student"   ║
// ║ form, we search the Ihlamudheen `students` table (and the fest's own      ║
// ║ lifetime roll for re-adds) and offer pick-from suggestions that     ║
// ║ auto-fill name, sex, guardian, contact, grade and section.          ║
// ║                                                                    ║
// ║ Each Ihlamudheen student carries the course they belong to (class →       ║
// ║ course). A per-course fest must only enrol its OWN students, so     ║
// ║ searches can be restricted to a course and the save path verifies   ║
// ║ a student's course before enrolling them.                          ║
// ║                                                                    ║
// ║ Pure row→suggestion mappers are exported for unit testing.         ║
// ╚══════════════════════════════════════════════════════════════════╝

import type { SupabaseClient } from "@supabase/supabase-js"

export interface StudentSuggestion {
  source: "madrasa" | "fest"
  regNo: string
  name: string
  gender: "male" | "female" | ""
  parentName: string
  parentMobile: string
  grade: number | null
  sectionName: string | null
  courseId: string | null
}

/** Class id → its name and owning course id. */
export interface ClassInfo { name: string; courseId: string | null }

/** First run of digits in a class/section name → grade number ("Grade 7" → 7). */
export function gradeFromClassName(name: string | null | undefined): number | null {
  if (!name) return null
  const m = name.match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

interface MadrasaStudentRow {
  roll_no: string | null
  name: string | null
  gender: string | null
  father_name: string | null
  mother_name: string | null
  father_phone: string | null
  mother_phone: string | null
  class_id: string | null
  disenrolled_at?: string | null
}

/** Map a Ihlamudheen students row + resolved class into a fest suggestion. */
export function mapMadrasaStudent(row: MadrasaStudentRow, cls: ClassInfo | null): StudentSuggestion {
  const g = (row.gender ?? "").toLowerCase()
  return {
    source: "madrasa",
    regNo: (row.roll_no ?? "").trim(),
    name: (row.name ?? "").trim(),
    gender: g === "male" || g === "female" ? (g as "male" | "female") : "",
    parentName: (row.father_name || row.mother_name || "").trim(),
    parentMobile: (row.father_phone || row.mother_phone || "").trim(),
    grade: gradeFromClassName(cls?.name),
    sectionName: cls?.name?.trim() || null,
    courseId: cls?.courseId ?? null,
  }
}

interface FestStudentRow {
  reg_no: string | null
  name: string | null
  gender: string | null
  parent_name: string | null
  parent_mobile: string | null
}

/** Map a fest_students (lifetime roll) row into a suggestion. */
export function mapFestStudent(row: FestStudentRow): StudentSuggestion {
  const g = (row.gender ?? "").toLowerCase()
  return {
    source: "fest",
    regNo: (row.reg_no ?? "").trim(),
    name: (row.name ?? "").trim(),
    gender: g === "male" || g === "female" ? (g as "male" | "female") : "",
    parentName: (row.parent_name ?? "").trim(),
    parentMobile: (row.parent_mobile ?? "").trim(),
    grade: null,
    sectionName: null,
    courseId: null,
  }
}

/**
 * Merge two suggestion lists, de-duped by register number. Ihlamudheen rows win over
 * fest rows for the same reg (they carry section, grade and course), but a
 * fest-only student still surfaces so previously-added entrants can be re-picked.
 */
export function mergeSuggestions(a: StudentSuggestion[], b: StudentSuggestion[]): StudentSuggestion[] {
  const byReg = new Map<string, StudentSuggestion>()
  for (const s of [...a, ...b]) {
    if (!s.regNo) continue
    const existing = byReg.get(s.regNo)
    if (!existing || (existing.source === "fest" && s.source === "madrasa")) byReg.set(s.regNo, s)
  }
  return Array.from(byReg.values())
}

/**
 * Search both rolls for students whose register number starts with, or whose
 * name contains, the query. `classInfoById` resolves a Ihlamudheen student's class
 * into its section name + course. Pass `restrictCourseId` to only return
 * students belonging to that course (a per-course fest enrols only its own).
 */
export async function searchStudents(
  supabase: SupabaseClient,
  query: string,
  classInfoById: Map<string, ClassInfo>,
  opts: { restrictCourseId?: string; limit?: number } = {},
): Promise<StudentSuggestion[]> {
  const { restrictCourseId, limit = 8 } = opts
  const q = query.trim()
  if (q.length < 2) return []
  const esc = q.replace(/[%,]/g, "") // keep the ilike pattern safe
  if (!esc) return []

  const [madrasa, fest] = await Promise.all([
    supabase
      .from("students")
      .select("roll_no,name,gender,father_name,mother_name,father_phone,mother_phone,class_id,disenrolled_at")
      .or(`roll_no.ilike.${esc}%,name.ilike.%${esc}%`)
      .limit(limit * 2),
    supabase
      .from("fest_students")
      .select("reg_no,name,gender,parent_name,parent_mobile")
      .or(`reg_no.ilike.${esc}%,name.ilike.%${esc}%`)
      .limit(limit),
  ])

  let madrasaRows = ((madrasa.data ?? []) as MadrasaStudentRow[])
    .filter((r) => !r.disenrolled_at)
    .map((r) => mapMadrasaStudent(r, classInfoById.get(r.class_id ?? "") ?? null))

  if (restrictCourseId) {
    // Only this course's students; fest-only rows have no course so are dropped.
    madrasaRows = madrasaRows.filter((s) => s.courseId === restrictCourseId)
    return madrasaRows.filter((s) => s.regNo || s.name).slice(0, limit)
  }

  const festRows = ((fest.data ?? []) as FestStudentRow[]).map(mapFestStudent)
  return mergeSuggestions(madrasaRows, festRows)
    .filter((s) => s.regNo || s.name)
    .slice(0, limit)
}

/**
 * The course a register number belongs to in the Ihlamudheen roll, or null if the
 * reg isn't on the roll (a brand-new student, who may be enrolled anywhere).
 * Used to block enrolling a student into another course's fest.
 */
export async function studentCourseId(
  supabase: SupabaseClient,
  regNo: string,
  classInfoById: Map<string, ClassInfo>,
): Promise<string | null> {
  const reg = regNo.trim()
  if (!reg) return null
  const { data } = await supabase
    .from("students")
    .select("class_id,disenrolled_at")
    .eq("roll_no", reg)
    .limit(5)
  const active = ((data ?? []) as Array<{ class_id: string | null; disenrolled_at?: string | null }>)
    .filter((r) => !r.disenrolled_at)
  for (const r of active) {
    const course = classInfoById.get(r.class_id ?? "")?.courseId ?? null
    if (course) return course
  }
  return null
}
