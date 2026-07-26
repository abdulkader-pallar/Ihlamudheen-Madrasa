// ╔══════════════════════════════════════════════════════════════════╗
// ║ Ihlamudheen Madrasa Fest — add a single student by hand                     ║
// ║                                                                    ║
// ║ The bulk Excel importer (import-fest-apply.ts) is the fast path     ║
// ║ when a section roster already exists as a spreadsheet. Many         ║
// ║ chapters, though, have no list yet — teachers enrol students one    ║
// ║ at a time. This mirrors the importer's persistence rules for a      ║
// ║ single row: upsert the lifetime student by reg_no, upsert the       ║
// ║ per-edition snapshot, and mint an anonymization code only for a     ║
// ║ brand-new (edition, student) pairing so re-saving never renumbers.  ║
// ║                                                                    ║
// ║ Writes run as the signed-in staff user through the fest RLS         ║
// ║ policies — no service key.                                         ║
// ╚══════════════════════════════════════════════════════════════════╝

import type { SupabaseClient } from "@supabase/supabase-js"

export interface NewStudentInput {
  regNo: string
  name: string
  nameMl?: string
  gender: "male" | "female" | ""
  parentName: string
  parentMobile: string
  grade: number | null
  sectionId: string
  houseId?: string | null
  categoryId?: string | null
}

export interface AddStudentResult {
  studentId: string
  codeNo: string
  /** true when this is the first time the student joins the edition. */
  created: boolean
}

/**
 * Pure, synchronous field validation so the form can flag problems before any
 * round-trip. Returns a human-readable message, or null when the input is valid.
 * Compulsory fields follow the project convention (name · digits-only unique
 * reg · sex · guardian name · contact) adapted to the fest student schema.
 */
export function validateNewStudent(input: NewStudentInput): string | null {
  const reg = input.regNo.trim()
  if (!reg) return "Register number is required."
  if (!/^\d+$/.test(reg)) return "Register number must be digits only."
  if (!input.name.trim()) return "Name is required."
  if (input.gender !== "male" && input.gender !== "female") return "Select the student's sex."
  if (!input.parentName.trim()) return "Parent / guardian name is required."
  if (!input.sectionId) return "Choose a section."
  if (input.grade == null || !Number.isFinite(input.grade)) return "Grade is required."
  return null
}

/** Zero-pad a code number to the 3-digit house style used across the fest. */
function pad(n: number): string {
  return String(n).padStart(3, "0")
}

export async function addFestStudent(
  supabase: SupabaseClient,
  editionId: string,
  input: NewStudentInput,
): Promise<AddStudentResult> {
  const problem = validateNewStudent(input)
  if (problem) throw new Error(problem)
  if (!editionId) throw new Error("No edition selected.")

  const reg = input.regNo.trim()

  // ── 1. Lifetime student row (upsert by reg_no) ───────────────────────────────
  const { error: upErr } = await supabase.from("fest_students").upsert(
    {
      reg_no: reg,
      name: input.name.trim(),
      name_ml: input.nameMl?.trim() || null,
      gender: input.gender,
      parent_name: input.parentName.trim(),
      parent_mobile: input.parentMobile.trim(),
    },
    { onConflict: "reg_no" },
  )
  if (upErr) throw new Error(`student: ${upErr.message}`)

  const { data: stu, error: stErr } = await supabase
    .from("fest_students")
    .select("id")
    .eq("reg_no", reg)
    .single()
  if (stErr || !stu) throw new Error(stErr?.message ?? "Could not load the saved student.")
  const studentId = stu.id as string

  // ── 2. Per-edition snapshot — reuse the existing code if already enrolled ─────
  const { data: existingSE } = await supabase
    .from("fest_student_editions")
    .select("id, code_no")
    .eq("edition_id", editionId)
    .eq("student_id", studentId)
    .maybeSingle()

  let codeNo = existingSE?.code_no ?? null
  if (!codeNo) {
    const { data: codes } = await supabase
      .from("fest_student_editions")
      .select("code_no")
      .eq("edition_id", editionId)
    const next =
      (codes ?? [])
        .map((r) => parseInt((r as { code_no: string | null }).code_no ?? "", 10))
        .filter((n) => !Number.isNaN(n))
        .reduce((a, b) => Math.max(a, b), 100) + 1
    codeNo = pad(next)
  }

  const { error: seErr } = await supabase.from("fest_student_editions").upsert(
    {
      edition_id: editionId,
      student_id: studentId,
      section_id: input.sectionId,
      house_id: input.houseId || null,
      category_id: input.categoryId || null,
      grade: input.grade,
      code_no: codeNo,
    },
    { onConflict: "edition_id,student_id" },
  )
  if (seErr) throw new Error(`enrolment: ${seErr.message}`)

  return { studentId, codeNo: codeNo!, created: !existingSE }
}
