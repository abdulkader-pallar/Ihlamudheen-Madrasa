// ╔══════════════════════════════════════════════════════════════════╗
// ║ Ihlamudheen Madrasa Fest — commit a parsed workbook into Supabase           ║
// ║                                                                    ║
// ║ Runs as the signed-in admin/coordinator, so every write goes       ║
// ║ through the fest RLS policies (no service key). Idempotent on       ║
// ║ re-import: students upsert by reg_no, sections by name, items by    ║
// ║ (edition,name), student_editions by (edition,student), and          ║
// ║ duplicate registrations are skipped. Returns a created/matched      ║
// ║ summary for the UI.                                                ║
// ╚══════════════════════════════════════════════════════════════════╝

import type { SupabaseClient } from "@supabase/supabase-js"
import { catalogItem } from "./items"
import type { ParsedWorkbook } from "./import-fest-excel"

/** raw-cell key (lowercased) → canonical name, or null to skip that cell. */
export type ReviewResolution = Record<string, string | null>

export interface ApplyResult {
  sectionsUpserted: number
  itemsCreated: number
  studentsUpserted: number
  studentEditionsUpserted: number
  registrationsInserted: number
  registrationsSkipped: number
  /** Students skipped because they belong to a different course on the roll. */
  skippedWrongCourse: number
  wrongCourseRegs: string[]
  warnings: string[]
}

function pad(n: number): string {
  return String(n).padStart(3, "0")
}

/**
 * Resolve every parsed student's raw items to canonical names, applying any
 * manual review decisions. Returns canonical names per (reg → string[]) and the
 * full set of canonical item names that need to exist in fest_items.
 */
function resolveRegistrations(parsed: ParsedWorkbook, resolution: ReviewResolution) {
  const usedItems = new Set<string>()
  const perStudent = new Map<string, Set<string>>() // regNo → canonical item names

  for (const sec of parsed.sections) {
    for (const st of sec.students) {
      const names = perStudent.get(st.regNo) ?? new Set<string>()
      for (const it of st.items) {
        let canonical = it.canonical
        if (it.confidence === "ambiguous" || it.confidence === "unknown") {
          const key = it.raw.toLowerCase().trim()
          if (key in resolution) canonical = resolution[key]
        }
        if (!canonical) continue // unresolved / explicitly skipped
        usedItems.add(canonical)
        names.add(canonical)
      }
      perStudent.set(st.regNo, names)
    }
  }
  return { usedItems, perStudent }
}

export async function applyFestImport(
  supabase: SupabaseClient,
  editionId: string,
  parsed: ParsedWorkbook,
  resolution: ReviewResolution = {},
  courseId?: string | null,
): Promise<ApplyResult> {
  const warnings: string[] = []
  const { usedItems, perStudent } = resolveRegistrations(parsed, resolution)

  // ── Course gate: a course's fest may only enrol that course's students ───────
  // Reg numbers that exist on the Ihlamudheen roll under a DIFFERENT course are
  // blocked (a student not on the roll carries no course and is allowed).
  const blockedRegs = new Set<string>()
  if (courseId) {
    const allRegs = Array.from(new Set(parsed.sections.flatMap((s) => s.students.map((st) => st.regNo))))
    if (allRegs.length) {
      const { data: stu } = await supabase.from("students").select("roll_no,class_id").in("roll_no", allRegs)
      const rows = (stu ?? []) as Array<{ roll_no: string; class_id: string | null }>
      const classIds = Array.from(new Set(rows.map((r) => r.class_id).filter(Boolean) as string[]))
      const courseByClass = new Map<string, string | null>()
      if (classIds.length) {
        const { data: cls } = await supabase.from("classes").select("id,course_id").in("id", classIds)
        for (const c of (cls ?? []) as Array<{ id: string; course_id: string | null }>) {
          courseByClass.set(c.id, c.course_id)
        }
      }
      for (const r of rows) {
        const courseOf = courseByClass.get(r.class_id ?? "") ?? null
        if (courseOf && courseOf !== courseId) blockedRegs.add(r.roll_no)
      }
    }
  }
  const isBlocked = (reg: string) => blockedRegs.has(reg)

  // ── 1. Sections (global, by name) ───────────────────────────────────────────
  const sectionRows = parsed.sections.map((s, i) => ({
    name: s.name,
    grade: s.grade,
    sort_order: i,
  }))
  if (sectionRows.length) {
    const { error } = await supabase
      .from("fest_sections")
      .upsert(sectionRows, { onConflict: "name" })
    if (error) throw new Error(`sections upsert: ${error.message}`)
  }
  const { data: sectionData, error: secErr } = await supabase
    .from("fest_sections")
    .select("id,name")
    .in("name", parsed.sections.map((s) => s.name))
  if (secErr) throw new Error(`sections fetch: ${secErr.message}`)
  const sectionId = new Map<string, string>((sectionData ?? []).map((r) => [r.name, r.id]))

  // ── 2. Items for this edition (expression-unique index ⇒ select-then-insert) ─
  const { data: existingItems, error: itErr } = await supabase
    .from("fest_items")
    .select("id,name")
    .eq("edition_id", editionId)
  if (itErr) throw new Error(`items fetch: ${itErr.message}`)
  const itemId = new Map<string, string>(
    (existingItems ?? []).map((r) => [r.name.toLowerCase(), r.id]),
  )
  const toCreate = Array.from(usedItems)
    .filter((name) => !itemId.has(name.toLowerCase()))
    .map((name) => {
      const meta = catalogItem(name)
      return {
        edition_id: editionId,
        name,
        language: meta?.language ?? "na",
        type: meta?.type ?? "individual",
      }
    })
  let itemsCreated = 0
  if (toCreate.length) {
    const { data, error } = await supabase.from("fest_items").insert(toCreate).select("id,name")
    if (error) throw new Error(`items insert: ${error.message}`)
    for (const r of data ?? []) itemId.set(r.name.toLowerCase(), r.id)
    itemsCreated = data?.length ?? 0
  }

  // ── 3. Students (lifetime, by reg_no) ────────────────────────────────────────
  const studentRows = parsed.sections.flatMap((sec) =>
    sec.students.filter((st) => !isBlocked(st.regNo)).map((st) => ({ reg_no: st.regNo, name: st.name })),
  )
  // de-dupe by reg_no (last wins) so a single upsert payload is conflict-free
  const studentByReg = new Map(studentRows.map((s) => [s.reg_no, s]))
  if (studentByReg.size) {
    const { error } = await supabase
      .from("fest_students")
      .upsert(Array.from(studentByReg.values()), { onConflict: "reg_no", ignoreDuplicates: false })
    if (error) throw new Error(`students upsert: ${error.message}`)
  }
  const { data: studentData, error: stErr } = await supabase
    .from("fest_students")
    .select("id,reg_no")
    .in("reg_no", Array.from(studentByReg.keys()))
  if (stErr) throw new Error(`students fetch: ${stErr.message}`)
  const studentId = new Map<string, string>((studentData ?? []).map((r) => [r.reg_no, r.id]))

  // ── 4. student_editions (per-year snapshot + anonymization code) ─────────────
  // Continue code numbers after any already issued for this edition.
  const { data: codeData } = await supabase
    .from("fest_student_editions")
    .select("code_no")
    .eq("edition_id", editionId)
  let nextCode =
    (codeData ?? [])
      .map((r) => parseInt(r.code_no ?? "", 10))
      .filter((n) => !Number.isNaN(n))
      .reduce((a, b) => Math.max(a, b), 100) + 1

  const { data: existingSE } = await supabase
    .from("fest_student_editions")
    .select("student_id")
    .eq("edition_id", editionId)
  const haveSE = new Set((existingSE ?? []).map((r) => r.student_id))

  const seRows: Array<Record<string, unknown>> = []
  for (const sec of parsed.sections) {
    for (const st of sec.students) {
      if (isBlocked(st.regNo)) continue
      const sid = studentId.get(st.regNo)
      if (!sid) continue
      const row: Record<string, unknown> = {
        edition_id: editionId,
        student_id: sid,
        section_id: sectionId.get(sec.name) ?? null,
        grade: sec.grade,
      }
      if (!haveSE.has(sid)) row.code_no = pad(nextCode++) // only mint a code for new rows
      seRows.push(row)
    }
  }
  if (seRows.length) {
    const { error } = await supabase
      .from("fest_student_editions")
      .upsert(seRows, { onConflict: "edition_id,student_id" })
    if (error) throw new Error(`student_editions upsert: ${error.message}`)
  }

  // ── 5. Registrations (skip duplicates already present) ───────────────────────
  const { data: existingRegs } = await supabase
    .from("fest_registrations")
    .select("item_id,student_id")
    .eq("edition_id", editionId)
  const regKey = (itemIdv: string, studentIdv: string) => `${itemIdv}::${studentIdv}`
  const haveReg = new Set((existingRegs ?? []).map((r) => regKey(r.item_id, r.student_id)))

  const regRows: Array<Record<string, unknown>> = []
  let registrationsSkipped = 0
  for (const sec of parsed.sections) {
    for (const st of sec.students) {
      if (isBlocked(st.regNo)) continue
      const sid = studentId.get(st.regNo)
      if (!sid) continue
      for (const canonical of Array.from(perStudent.get(st.regNo) ?? [])) {
        const iid = itemId.get(canonical.toLowerCase())
        if (!iid) {
          warnings.push(`No item id for "${canonical}" (reg ${st.regNo})`)
          continue
        }
        if (haveReg.has(regKey(iid, sid))) {
          registrationsSkipped++
          continue
        }
        haveReg.add(regKey(iid, sid))
        regRows.push({
          edition_id: editionId,
          item_id: iid,
          student_id: sid,
          is_group: catalogItem(canonical)?.type === "group",
          section_id: sectionId.get(sec.name) ?? null,
        })
      }
    }
  }
  let registrationsInserted = 0
  if (regRows.length) {
    const { data, error } = await supabase.from("fest_registrations").insert(regRows).select("id")
    if (error) throw new Error(`registrations insert: ${error.message}`)
    registrationsInserted = data?.length ?? 0
  }

  if (blockedRegs.size) {
    warnings.push(`${blockedRegs.size} student(s) skipped — they belong to another course: ${Array.from(blockedRegs).slice(0, 20).join(", ")}${blockedRegs.size > 20 ? "…" : ""}`)
  }

  return {
    sectionsUpserted: sectionRows.length,
    itemsCreated,
    studentsUpserted: studentByReg.size,
    studentEditionsUpserted: seRows.length,
    registrationsInserted,
    registrationsSkipped,
    skippedWrongCourse: blockedRegs.size,
    wrongCourseRegs: Array.from(blockedRegs),
    warnings,
  }
}
