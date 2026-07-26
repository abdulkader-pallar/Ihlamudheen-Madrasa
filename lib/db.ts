import { supabase, isSupabaseConfigured } from "./supabase"
import { compareNatural } from "./utils"
import type { Student, AttendanceRecord, GradeEntry, ClassData, Subject, CourseData } from "@/data/courses"
import { initialCourses } from "@/data/courses"
import { recitationTotal, type RecitationSession } from "./recitation"
import type { PeriodAssignment } from "@/data/period-timetable"

// ── Check if Supabase is configured and reachable ─────────
let _supabaseReady: boolean | null = null
export async function checkSupabase(): Promise<boolean> {
  // Don't cache failures — allow retry
  if (_supabaseReady === true) return true
  if (!isSupabaseConfigured()) { _supabaseReady = false; return false }
  try {
    // Probe the attendance table (the primary table we actually use for student data).
    // Previous code probed `classes` which may not exist if only partial migrations ran.
    // If the attendance table doesn't exist yet, try a generic health check.
    const { error } = await supabase.from("attendance").select("class_id").limit(1)
    if (error && error.code === "42P01") {
      // Table doesn't exist — Supabase is reachable but not migrated yet
      // Still mark as ready so saves can create the table via upsert
      _supabaseReady = true
      return true
    }
    _supabaseReady = !error
    return _supabaseReady
  } catch {
    _supabaseReady = false
    return false
  }
}

// ── Real-time subscription helper ─────────────────────────
export function subscribeToTable(
  table: string,
  callback: () => void,
  filter?: string
) {
  if (!isSupabaseConfigured()) return { unsubscribe: () => { } }
  const channel = supabase
    .channel(`realtime:${table}:${Date.now()}`)
    .on('postgres_changes' as Parameters<ReturnType<typeof supabase.channel>['on']>[0],
      { event: '*', schema: 'public', table, filter } as Parameters<ReturnType<typeof supabase.channel>['on']>[1],
      callback
    )
  const sub = channel.subscribe()
  return { unsubscribe: () => { sub.unsubscribe?.(); supabase.removeChannel(channel) } }
}

// ══════════════════════════════════════════════════════════
// CLASSES
// ══════════════════════════════════════════════════════════
export async function fetchClasses(courseId: string): Promise<ClassData[]> {
  const { data, error } = await supabase
    .from("classes")
    .select("*")
    .eq("course_id", courseId)
    .order("name")
  if (error || !data) return []
  return data.map((c: Record<string, string>) => ({
    id: c.id,
    name: c.name,
    schedule: c.schedule || "TBD",
    students: [],
    attendance: [],
    grades: [],
  })).sort((a, b) => compareNatural(a.name, b.name))
}

export async function addClass(courseId: string, id: string, name: string, schedule: string) {
  return supabase.from("classes").insert({ id, course_id: courseId, name, schedule })
}

/** Rename an existing class (and/or update its schedule). */
export async function renameClass(classId: string, name: string, schedule?: string) {
  const payload: Record<string, string> = { name }
  if (schedule !== undefined) payload.schedule = schedule
  return supabase.from("classes").update(payload).eq("id", classId)
}

export async function removeClass(classId: string) {
  // Best-effort cascade: delete attendance + grades + students first in case FK cascade isn't set.
  // If FK ON DELETE CASCADE is configured, these are no-ops but still safe.
  await supabase.from("attendance").delete().eq("class_id", classId)
  await supabase.from("grades").delete().eq("class_id", classId)
  await supabase.from("students").delete().eq("class_id", classId)
  return supabase.from("classes").delete().eq("id", classId)
}

// ══════════════════════════════════════════════════════════
// STUDENTS
// ══════════════════════════════════════════════════════════
export async function fetchStudents(classId: string): Promise<Student[]> {
  const { data, error } = await supabase
    .from("students")
    .select("*")
    .eq("class_id", classId)
    .order("roll_no")
  if (error || !data) return []
  // Active roster only — drop disenrolled students. Filtered in JS (not via a
  // .is() query) so this still works if the disenrolled_at column hasn't been
  // migrated yet: undefined reads as active.
  return data.filter((s: Record<string, string>) => !s.disenrolled_at).map((s: Record<string, string>) => ({
    id: s.id,
    name: s.name,
    rollNo: s.roll_no,
    photo: s.photo || undefined,
    gender: ((s.gender as "Male" | "Female") || undefined),
    fatherName: s.father_name || undefined,
    motherName: s.mother_name || undefined,
    fatherPhone: s.father_phone || undefined,
    motherPhone: s.mother_phone || undefined,
  }))
}

export async function fetchAllStudents(): Promise<Record<string, Student[]>> {
  const { data, error } = await supabase
    .from("students")
    .select("*")
    .order("roll_no")
  if (error || !data) return {}
  const map: Record<string, Student[]> = {}
  data.forEach((s: Record<string, string>) => {
    if (s.disenrolled_at) return // active roster only — skip disenrolled
    if (!map[s.class_id]) map[s.class_id] = []
    map[s.class_id].push({
      id: s.id,
      name: s.name,
      rollNo: s.roll_no,
      photo: s.photo || undefined,
      gender: ((s.gender as "Male" | "Female") || undefined),
      fatherName: s.father_name || undefined,
      motherName: s.mother_name || undefined,
      fatherPhone: s.father_phone || undefined,
      motherPhone: s.mother_phone || undefined,
    })
  })
  return map
}

export async function addStudent(classId: string, id: string, name: string, rollNo: string) {
  return supabase.from("students").insert({ id, class_id: classId, name, roll_no: rollNo })
}

/** Unique students who have attendance records in a given class.
 *  Catches students who were later moved to another class — they still
 *  have attendance rows for the old class_id but a different class_id now. */
export async function fetchStudentsFromAttendance(classId: string): Promise<Student[]> {
  const { data: attRows } = await supabase
    .from("attendance")
    .select("student_id")
    .eq("class_id", classId)
  if (!attRows?.length) return []
  const ids = Array.from(new Set(attRows.map((r: Record<string, string>) => r.student_id)))
  const { data } = await supabase.from("students").select("*").in("id", ids).order("roll_no")
  return (data || []).map(mapStudent)
}

/** Distinct student IDs that have at least one score row for an exam. */
export async function fetchStudentIdsWithScores(examId: number): Promise<string[]> {
  const { data } = await supabase
    .from("exam_scores")
    .select("student_id")
    .eq("exam_id", examId)
  if (!data?.length) return []
  return Array.from(new Set(data.map((r: Record<string, string>) => r.student_id)))
}

/** Fetch students by an explicit list of IDs, regardless of which class they belong to. */
export async function fetchStudentsByIds(ids: string[]): Promise<Student[]> {
  if (!ids.length) return []
  const { data } = await supabase.from("students").select("*").in("id", ids).order("name")
  return (data || []).map(mapStudent)
}

function mapStudent(s: Record<string, string>): Student {
  return {
    id: s.id,
    name: s.name,
    rollNo: s.roll_no,
    photo: s.photo || undefined,
    gender: (s.gender as "Male" | "Female") || undefined,
    fatherName: s.father_name || undefined,
    motherName: s.mother_name || undefined,
    fatherPhone: s.father_phone || undefined,
    motherPhone: s.mother_phone || undefined,
  }
}

export async function removeStudent(studentId: string) {
  // Clean up child rows first (attendance + grade entries per student).
  await supabase.from("attendance").delete().eq("student_id", studentId)
  await supabase.from("grades").delete().eq("student_id", studentId)
  // Select the deleted rows so we can tell whether anything was actually
  // removed. A delete blocked by row-level security removes 0 rows but
  // returns NO error — without this check the caller would show a green
  // "removed" tick for a no-op, and the student reappears on refresh.
  const { data, error } = await supabase
    .from("students")
    .delete()
    .eq("id", studentId)
    .select("id")
  if (error) return { error }
  if (!data || data.length === 0) {
    return {
      error: {
        message:
          "Student was not removed — you may not have permission to delete students, or the record no longer exists.",
      },
    }
  }
  return { error: null }
}

// ── Disenroll (soft archive) ────────────────────────────────────────────
// A disenrolled student keeps their record, attendance, and grades but is
// hidden from active rosters. Reversible via reenrollStudent.

export interface DisenrolledStudent {
  id: string
  name: string
  rollNo: string
  classId: string
  className: string
  courseId: string
  courseTitle: string
  disenrolledAt: string | null
  reason: string | null
}

/** Mark a student as disenrolled (left). Keeps all their data. */
export async function disenrollStudent(studentId: string, reason?: string) {
  const { data, error } = await supabase
    .from("students")
    .update({ disenrolled_at: new Date().toISOString(), disenroll_reason: reason?.trim() || null })
    .eq("id", studentId)
    .is("disenrolled_at", null) // only act on a currently-active student
    .select("id")
  if (error) return { error }
  if (!data || data.length === 0) {
    return { error: { message: "Student was not disenrolled — you may not have permission, or they are already disenrolled." } }
  }
  return { error: null }
}

/** Restore a disenrolled student back to their class. */
export async function reenrollStudent(studentId: string) {
  const { data, error } = await supabase
    .from("students")
    .update({ disenrolled_at: null, disenroll_reason: null })
    .eq("id", studentId)
    .select("id")
  if (error) return { error }
  if (!data || data.length === 0) {
    return { error: { message: "Student was not re-enrolled — you may not have permission, or the record no longer exists." } }
  }
  return { error: null }
}

/** List every disenrolled student with their (former) class + course names. */
export async function fetchDisenrolledStudents(): Promise<DisenrolledStudent[]> {
  const { data: rows } = await supabase
    .from("students")
    .select("*")
    .not("disenrolled_at", "is", null)
    .order("disenrolled_at", { ascending: false })
  if (!rows || rows.length === 0) return []

  // Resolve class_id → class name + course id, and course id → course title.
  const { data: classRows } = await supabase.from("classes").select("id, name, course_id")
  const classMap: Record<string, { name: string; courseId: string }> = {}
  ;(classRows || []).forEach((c: Record<string, string>) => {
    classMap[c.id] = { name: c.name, courseId: c.course_id }
  })
  const courseTitleById: Record<string, string> = {}
  initialCourses.forEach((c) => { courseTitleById[c.id] = c.title })

  return rows.map((s: Record<string, string>) => {
    const cls = classMap[s.class_id]
    return {
      id: s.id,
      name: s.name,
      rollNo: s.roll_no,
      classId: s.class_id,
      className: cls?.name || "—",
      courseId: cls?.courseId || "",
      courseTitle: (cls && courseTitleById[cls.courseId]) || "—",
      disenrolledAt: s.disenrolled_at || null,
      reason: s.disenroll_reason || null,
    }
  })
}

export async function updateStudentPhoto(studentId: string, photo: string) {
  return supabase.from("students").update({ photo }).eq("id", studentId)
}

/**
 * Update an existing student's class and/or name. Used by reconcileRoster
 * to move misplaced students.
 */
export async function moveStudent(studentId: string, newClassId: string, name: string) {
  return supabase.from("students").update({ class_id: newClassId, name }).eq("id", studentId)
}

/**
 * Update extended profile (gender, parents, contact). All fields optional.
 * The DB schema must include the matching columns; if a column is missing,
 * Supabase silently ignores the field.
 */
export async function updateStudentProfile(
  studentId: string,
  profile: {
    gender?: string | null
    fatherName?: string | null
    motherName?: string | null
    fatherPhone?: string | null
    motherPhone?: string | null
    email?: string | null
  }
) {
  const payload: Record<string, string | null> = {}
  if (profile.gender !== undefined) payload.gender = profile.gender
  if (profile.fatherName !== undefined) payload.father_name = profile.fatherName
  if (profile.motherName !== undefined) payload.mother_name = profile.motherName
  if (profile.fatherPhone !== undefined) payload.father_phone = profile.fatherPhone
  if (profile.motherPhone !== undefined) payload.mother_phone = profile.motherPhone
  if (profile.email !== undefined) payload.email = profile.email
  if (Object.keys(payload).length === 0) return { error: null }
  return supabase.from("students").update(payload).eq("id", studentId)
}

/**
 * Apply many profile updates in one go. Each row must include the student id.
 * Skips rows whose update failed (returns the failed count).
 */
export async function bulkUpdateStudentProfiles(
  rows: Array<{
    id: string
    gender?: string | null
    fatherName?: string | null
    motherName?: string | null
    fatherPhone?: string | null
    motherPhone?: string | null
  }>,
): Promise<{ updated: number; failed: number; errors: string[] }> {
  let updated = 0
  let failed = 0
  const errors: string[] = []
  // Sequential to keep DB pressure low and ordering predictable for error reports
  for (const r of rows) {
    const { error } = await updateStudentProfile(r.id, {
      gender: r.gender,
      fatherName: r.fatherName,
      motherName: r.motherName,
      fatherPhone: r.fatherPhone,
      motherPhone: r.motherPhone,
    })
    if (error) {
      failed++
      errors.push(`${r.id}: ${(error as { message?: string }).message ?? "unknown error"}`)
    } else {
      updated++
    }
  }
  return { updated, failed, errors }
}

/**
 * Reconcile the live students table against a canonical roster.
 * - For each roster entry: insert if missing; if present in a different
 *   class, move it to the correct class; if present in the right class
 *   with a different name, update the name.
 * - Untracked students (in DB but not in roster) are LEFT ALONE so the
 *   admin can review them manually.
 *
 * Returns counts for a friendly toast.
 */
export async function reconcileRoster(
  rosterClasses: Array<{ classId: string; students: Array<{ id: string; name: string }> }>,
): Promise<{ inserted: number; moved: number; renamed: number; unchanged: number; classesAdded: number; classesRemapped: number; untracked: Array<{ id: string; name: string; classId: string }>; error?: unknown }> {
  // Step 0a — fetch existing class rows so we can both INSERT missing ones
  // and FIX wrong course_id on existing ones (e.g. classes that were
  // initially put under Ihlamudheen Madrasa but should live under Ihlamudheen Madrasa).
  const { data: existingClasses } = await supabase.from("classes").select("id, course_id, name")
  const existingClassMap = new Map<string, { id: string; course_id: string; name: string }>()
  ;(existingClasses ?? []).forEach((r: Record<string, unknown>) =>
    existingClassMap.set(r.id as string, {
      id: r.id as string,
      course_id: r.course_id as string,
      name: r.name as string,
    })
  )

  const classRowsToInsert: Array<{ id: string; course_id: string; name: string; schedule: string }> = []
  const classRowsToRemap: Array<{ id: string; course_id: string }> = []
  for (const course of initialCourses) {
    for (const cls of course.classes) {
      const dbRow = existingClassMap.get(cls.id)
      if (!dbRow) {
        classRowsToInsert.push({
          id: cls.id,
          course_id: course.id,
          name: cls.name,
          schedule: cls.schedule || "TBD",
        })
      } else if (dbRow.course_id !== course.id) {
        classRowsToRemap.push({ id: cls.id, course_id: course.id })
      }
    }
  }

  let classesAdded = 0
  let classesRemapped = 0
  if (classRowsToInsert.length > 0) {
    const { error: addClassErr } = await supabase.from("classes").upsert(classRowsToInsert, { onConflict: "id" })
    if (addClassErr) return { inserted: 0, moved: 0, renamed: 0, unchanged: 0, classesAdded: 0, classesRemapped: 0, untracked: [], error: addClassErr }
    classesAdded = classRowsToInsert.length
  }
  // Step 0b — fix wrong course_id (admins occasionally reorganise the school
  // structure; this lets a sync click handle it without manual SQL)
  for (const remap of classRowsToRemap) {
    const { error: remapErr } = await supabase.from("classes").update({ course_id: remap.course_id }).eq("id", remap.id)
    if (remapErr) return { inserted: 0, moved: 0, renamed: 0, unchanged: 0, classesAdded, classesRemapped, untracked: [], error: remapErr }
    classesRemapped++
  }

  // Snapshot all DB students once
  const { data: existing, error: exErr } = await supabase
    .from("students")
    .select("id, class_id, name")
  if (exErr) return { inserted: 0, moved: 0, renamed: 0, unchanged: 0, classesAdded, classesRemapped, untracked: [], error: exErr }

  const dbById = new Map<string, { id: string; classId: string; name: string }>()
  ;(existing ?? []).forEach((row: Record<string, unknown>) =>
    dbById.set(row.id as string, {
      id: row.id as string,
      classId: row.class_id as string,
      name: row.name as string,
    })
  )

  let inserted = 0, moved = 0, renamed = 0, unchanged = 0
  // Track which DB student IDs are accounted for in the roster
  const trackedIds = new Set<string>()

  for (const cls of rosterClasses) {
    for (const student of cls.students) {
      trackedIds.add(student.id)
      const dbRow = dbById.get(student.id)
      if (!dbRow) {
        const { error } = await supabase
          .from("students")
          .insert({ id: student.id, class_id: cls.classId, name: student.name, roll_no: student.id })
        if (error) return { inserted, moved, renamed, unchanged, classesAdded, classesRemapped, untracked: [], error }
        inserted++
      } else if (dbRow.classId !== cls.classId) {
        const { error } = await supabase
          .from("students")
          .update({ class_id: cls.classId, name: student.name })
          .eq("id", student.id)
        if (error) return { inserted, moved, renamed, unchanged, classesAdded, classesRemapped, untracked: [], error }
        moved++
      } else if (dbRow.name !== student.name) {
        const { error } = await supabase
          .from("students")
          .update({ name: student.name })
          .eq("id", student.id)
        if (error) return { inserted, moved, renamed, unchanged, classesAdded, classesRemapped, untracked: [], error }
        renamed++
      } else {
        unchanged++
      }
    }
  }

  // Untracked = students in DB but not in the canonical roster.
  // We don't auto-delete; the UI surfaces them so the admin can decide.
  const untracked: Array<{ id: string; name: string; classId: string }> = []
  dbById.forEach((row, id) => {
    if (!trackedIds.has(id)) untracked.push({ id, name: row.name, classId: row.classId })
  })

  return { inserted, moved, renamed, unchanged, classesAdded, classesRemapped, untracked }
}

/** Bulk-delete students by id. Used by the "remove untracked" follow-up
 *  step after reconcileRoster. Cascades to attendance + grade rows. */
export async function bulkRemoveStudents(ids: string[]): Promise<{ removed: number; error?: unknown }> {
  if (ids.length === 0) return { removed: 0 }
  await supabase.from("attendance").delete().in("student_id", ids)
  await supabase.from("grades").delete().in("student_id", ids)
  const { error } = await supabase.from("students").delete().in("id", ids)
  if (error) return { removed: 0, error }
  return { removed: ids.length }
}

// ══════════════════════════════════════════════════════════
// ASSESSMENTS — link-based quizzes / tests / assignments
// ══════════════════════════════════════════════════════════
export interface Assessment {
  id: string
  classId: string
  teacherId: string
  teacherName: string
  title: string
  description?: string
  linkUrl: string
  dueDate?: string
  maxMarks?: number
  createdAt: string
}

function mapAssessmentRow(r: Record<string, unknown>): Assessment {
  return {
    id: r.id as string,
    classId: r.class_id as string,
    teacherId: r.teacher_id as string,
    teacherName: r.teacher_name as string,
    title: r.title as string,
    description: (r.description as string) || undefined,
    linkUrl: r.link_url as string,
    dueDate: (r.due_date as string) || undefined,
    maxMarks: (r.max_marks as number) ?? undefined,
    createdAt: r.created_at as string,
  }
}

export async function fetchAssessments(classId: string): Promise<Assessment[]> {
  const { data, error } = await supabase
    .from("assessments")
    .select("*")
    .eq("class_id", classId)
    .order("created_at", { ascending: false })
  if (error || !data) return []
  return data.map(mapAssessmentRow)
}

export async function fetchAllAssessments(): Promise<Assessment[]> {
  const { data, error } = await supabase
    .from("assessments")
    .select("*")
    .order("created_at", { ascending: false })
  if (error || !data) return []
  return data.map(mapAssessmentRow)
}

export async function addAssessment(params: {
  classId: string
  teacherId: string
  teacherName: string
  title: string
  description?: string
  linkUrl: string
  dueDate?: string
  maxMarks?: number
}): Promise<{ data?: Assessment; error?: string }> {
  const { data, error } = await supabase
    .from("assessments")
    .insert({
      class_id: params.classId,
      teacher_id: params.teacherId,
      teacher_name: params.teacherName,
      title: params.title,
      description: params.description || null,
      link_url: params.linkUrl,
      due_date: params.dueDate || null,
      max_marks: params.maxMarks ?? null,
    })
    .select()
    .single()
  if (error) return { error: error.message }
  return { data: mapAssessmentRow(data as Record<string, unknown>) }
}

export async function removeAssessment(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("assessments").delete().eq("id", id)
  if (error) return { error: error.message }
  return {}
}

// ══════════════════════════════════════════════════════════
// LMS NOTES — link-based class notes
// ══════════════════════════════════════════════════════════
export type LmsLinkType = "drive" | "youtube" | "doc" | "other"

export interface LmsNote {
  id: string
  classId: string
  teacherId: string
  teacherName: string
  title: string
  description?: string
  linkUrl: string
  linkType: LmsLinkType
  createdAt: string
}

export function detectLinkType(url: string): LmsLinkType {
  const u = url.toLowerCase()
  if (u.includes("drive.google.com")) return "drive"
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube"
  if (u.includes("docs.google.com") || u.includes("sheets.google.com") || u.includes("slides.google.com")) return "doc"
  return "other"
}

function mapLmsRow(r: Record<string, unknown>): LmsNote {
  return {
    id: r.id as string,
    classId: r.class_id as string,
    teacherId: r.teacher_id as string,
    teacherName: r.teacher_name as string,
    title: r.title as string,
    description: (r.description as string) || undefined,
    linkUrl: r.link_url as string,
    linkType: (r.link_type as LmsLinkType) || "other",
    createdAt: r.created_at as string,
  }
}

export async function fetchLmsNotes(classId: string): Promise<LmsNote[]> {
  const { data, error } = await supabase
    .from("lms_notes")
    .select("*")
    .eq("class_id", classId)
    .order("created_at", { ascending: false })
  if (error || !data) return []
  return data.map(mapLmsRow)
}

export async function fetchAllLmsNotes(): Promise<LmsNote[]> {
  const { data, error } = await supabase
    .from("lms_notes")
    .select("*")
    .order("created_at", { ascending: false })
  if (error || !data) return []
  return data.map(mapLmsRow)
}

export async function addLmsNote(params: {
  classId: string
  teacherId: string
  teacherName: string
  title: string
  description?: string
  linkUrl: string
}): Promise<{ data?: LmsNote; error?: string }> {
  const linkType = detectLinkType(params.linkUrl)
  const { data, error } = await supabase
    .from("lms_notes")
    .insert({
      class_id: params.classId,
      teacher_id: params.teacherId,
      teacher_name: params.teacherName,
      title: params.title,
      description: params.description || null,
      link_url: params.linkUrl,
      link_type: linkType,
    })
    .select()
    .single()
  if (error) return { error: error.message }
  return { data: mapLmsRow(data as Record<string, unknown>) }
}

export async function removeLmsNote(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("lms_notes").delete().eq("id", id)
  if (error) return { error: error.message }
  return {}
}

// ══════════════════════════════════════════════════════════
// SEED & FETCH — Full course data from Supabase (no localStorage)
// ══════════════════════════════════════════════════════════

// Module-level cache — skip the DB round-trip on subsequent calls this session
let _seedCheckDone = false

/** Seed classes + students from initialCourses if DB tables are empty */
/** Ensure all default app_settings rows exist. Safe to call every session — uses ON CONFLICT DO NOTHING. */
async function ensureDefaultSettings(): Promise<void> {
  const defaults: Array<{ key: string; value: string }> = [
    { key: "report_card_enabled",    value: "true" },
    { key: "unlocked_academic_years", value: '["2025-2026","2026-2027"]' },
    // Months (YYYY-MM) when staff self-mark attendance online instead of the
    // fingerprint device — read by /api/online-checkin and the My Attendance card.
    { key: "online_checkin_months",   value: '["2026-07","2026-08"]' },
  ]
  await supabase
    .from("app_settings")
    .upsert(defaults, { onConflict: "key", ignoreDuplicates: true })
}

async function seedInitialData(): Promise<void> {
  if (_seedCheckDone) return // run at most once per browser session
  _seedCheckDone = true

  // Seed only when the DB is pristine (no classes AND no students). Once the
  // database is in use it is the single source of truth, so we must never
  // re-insert seed rows — doing so would resurrect classes/students that an
  // admin or accountant deliberately deleted (they still appear in
  // initialCourses), which is exactly the "deleted student comes back after a
  // refresh" bug. New classes/students are added through the UI, not by
  // re-seeding from code.
  const [{ count: classCount }, { count: studentCount }] = await Promise.all([
    supabase.from("classes").select("id", { count: "exact", head: true }),
    supabase.from("students").select("id", { count: "exact", head: true }),
  ])
  if ((classCount ?? 0) > 0 || (studentCount ?? 0) > 0) return

  // First run on an empty DB — insert the full initial structure.
  const classRows: Array<{ id: string; course_id: string; name: string; schedule: string }> = []
  const studentRows: Array<{ id: string; class_id: string; name: string; roll_no: string }> = []

  for (const course of initialCourses) {
    for (const cls of course.classes) {
      classRows.push({
        id: cls.id,
        course_id: course.id,
        name: cls.name,
        schedule: cls.schedule || "TBD",
      })
      for (const student of cls.students) {
        studentRows.push({
          id: student.id,
          class_id: cls.id,
          name: student.name,
          roll_no: student.rollNo,
        })
      }
    }
  }

  if (classRows.length > 0) {
    await supabase.from("classes").upsert(classRows, { onConflict: "id", ignoreDuplicates: true })
  }
  if (studentRows.length > 0) {
    await supabase.from("students").upsert(studentRows, { onConflict: "id", ignoreDuplicates: true })
  }
}

/** Fetch full course structure from Supabase (classes + students + attendance + grades).
 *  Seeds initialCourses data into DB if tables are empty.
 *  Returns CourseData[] ready for React state — NO localStorage involved. */
export async function fetchCoursesFromDB(): Promise<CourseData[]> {
  await Promise.all([seedInitialData(), ensureDefaultSettings()])

  // Fetch all classes
  const { data: classRows } = await supabase.from("classes").select("*").order("name")
  // Fetch all students. Disenrolled students are hidden from every
  // course/class view (see the Disenroll page to view/restore them). We filter
  // in JS rather than via .is("disenrolled_at", null) so this keeps working if
  // the disenrolled_at column hasn't been migrated yet — undefined reads as
  // active and no roster breaks.
  const { data: studentRows } = await supabase
    .from("students")
    .select("*")
    .order("roll_no")

  if (!classRows) return initialCourses // fallback if DB unreachable

  // Build student map: classId → Student[]
  const studentMap: Record<string, Student[]> = {}
    ; (studentRows || []).forEach((s: Record<string, string>) => {
      if (s.disenrolled_at) return // skip disenrolled — active roster only
      if (!studentMap[s.class_id]) studentMap[s.class_id] = []
      studentMap[s.class_id].push({
        id: s.id,
        name: s.name,
        rollNo: s.roll_no,
        photo: s.photo || undefined,
        gender: ((s.gender as "Male" | "Female") || undefined),
        fatherName: s.father_name || undefined,
        motherName: s.mother_name || undefined,
        fatherPhone: s.father_phone || undefined,
        motherPhone: s.mother_phone || undefined,
      })
    })

  // Order every class roster A–Z by student name (case-insensitive dictionary
  // order) so all student lists — assessment, attendance, reports — read like
  // a dictionary regardless of roll number.
  Object.values(studentMap).forEach((roster) =>
    roster.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
  )

  // Build class map: courseId → ClassData[]
  const classMap: Record<string, ClassData[]> = {}
  classRows.forEach((c: Record<string, string>) => {
    if (!classMap[c.course_id]) classMap[c.course_id] = []
    classMap[c.course_id].push({
      id: c.id,
      name: c.name,
      schedule: c.schedule || "TBD",
      students: studentMap[c.id] || [],
      attendance: [],
      grades: [],
    })
  })

  // Sort each course's classes naturally (Grade 2 before Grade 10).
  Object.values(classMap).forEach((list) => list.sort((a, b) => compareNatural(a.name, b.name)))

  // Map to course structure (preserve course order from initialCourses)
  return initialCourses.map((course) => ({
    ...course,
    classes: classMap[course.id] || course.classes.map((cls) => ({
      ...cls,
      students: studentMap[cls.id] || cls.students,
      attendance: [],
      grades: [],
    })),
  }))
}

// ══════════════════════════════════════════════════════════
// ATTENDANCE
// ══════════════════════════════════════════════════════════
export async function fetchAttendance(classId: string, month: string): Promise<AttendanceRecord[]> {
  // month is "YYYY-MM"
  const startDate = `${month}-01`
  const [y, m] = month.split("-").map(Number)
  const endDate = `${y}-${String(m).padStart(2, "0")}-${new Date(y, m, 0).getDate()}`

  const { data, error } = await supabase
    .from("attendance")
    .select("*")
    .eq("class_id", classId)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date")

  if (error || !data) return []

  // Group by date
  const map: Record<string, Record<string, "present" | "absent" | "late">> = {}
  const arrivalMap: Record<string, Record<string, string>> = {}
  data.forEach((row: Record<string, string>) => {
    if (!map[row.date]) map[row.date] = {}
    map[row.date][row.student_id] = row.status as "present" | "absent" | "late"
    if (row.arrival_time) {
      if (!arrivalMap[row.date]) arrivalMap[row.date] = {}
      arrivalMap[row.date][row.student_id] = row.arrival_time
    }
  })

  return Object.entries(map).map(([date, records]) => ({
    date,
    records,
    arrivalTimes: arrivalMap[date],
  }))
}

export async function fetchAllAttendance(classId: string): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from("attendance")
    .select("*")
    .eq("class_id", classId)
    .order("date")

  if (error || !data) return []

  const map: Record<string, Record<string, "present" | "absent" | "late">> = {}
  const remarksMap: Record<string, Record<string, string>> = {}
  const arrivalMap: Record<string, Record<string, string>> = {}
  data.forEach((row: Record<string, string>) => {
    if (!map[row.date]) map[row.date] = {}
    map[row.date][row.student_id] = row.status as "present" | "absent" | "late"
    if (row.remarks) {
      if (!remarksMap[row.date]) remarksMap[row.date] = {}
      remarksMap[row.date][row.student_id] = row.remarks
    }
    if (row.arrival_time) {
      if (!arrivalMap[row.date]) arrivalMap[row.date] = {}
      arrivalMap[row.date][row.student_id] = row.arrival_time
    }
  })

  return Object.entries(map).map(([date, records]) => ({
    date,
    records,
    remarks: remarksMap[date],
    arrivalTimes: arrivalMap[date],
  }))
}

/** Batch fetch attendance for many classes in ONE query instead of N queries */
export async function fetchAllAttendanceBatch(
  classIds: string[]
): Promise<Record<string, AttendanceRecord[]>> {
  if (classIds.length === 0) return {}
  // arrival_time is a newer column; if the DB hasn't been migrated yet the
  // select errors, so retry without it rather than dropping all attendance.
  const runBatch = (cols: string) =>
    supabase.from("attendance").select(cols).in("class_id", classIds).order("date")
  let resp = await runBatch("class_id, student_id, date, status, remarks, arrival_time")
  if (resp.error) resp = await runBatch("class_id, student_id, date, status, remarks")
  const { data, error } = resp
  if (error || !data) return {}

  // Group: classId → date → { records, remarks, arrivalTimes }
  const byClass: Record<string, Record<string, { records: Record<string, "present" | "absent" | "late">; remarks: Record<string, string>; arrivalTimes: Record<string, string> }>> = {}
  ;(data as unknown as Array<{ class_id: string; student_id: string; date: string; status: string; remarks?: string; arrival_time?: string }>).forEach(row => {
    if (!byClass[row.class_id]) byClass[row.class_id] = {}
    if (!byClass[row.class_id][row.date]) byClass[row.class_id][row.date] = { records: {}, remarks: {}, arrivalTimes: {} }
    byClass[row.class_id][row.date].records[row.student_id] = row.status as "present" | "absent" | "late"
    if (row.remarks) byClass[row.class_id][row.date].remarks[row.student_id] = row.remarks
    if (row.arrival_time) byClass[row.class_id][row.date].arrivalTimes[row.student_id] = row.arrival_time
  })

  const result: Record<string, AttendanceRecord[]> = {}
  for (const classId of classIds) {
    result[classId] = Object.entries(byClass[classId] ?? {}).map(([date, { records, remarks, arrivalTimes }]) => ({
      date, records,
      remarks: Object.keys(remarks).length ? remarks : undefined,
      arrivalTimes: Object.keys(arrivalTimes).length ? arrivalTimes : undefined,
    }))
  }
  return result
}

/** Batch fetch grades for many classes in 3 queries instead of 3×N queries */
export async function fetchAllGradesBatch(
  classIds: string[]
): Promise<Record<string, GradeEntry[]>> {
  if (classIds.length === 0) return {}

  // 1. All exams for these classes
  const { data: exams } = await supabase
    .from("exams")
    .select("*")
    .in("class_id", classIds)
    .order("created_at", { ascending: false })
  if (!exams || exams.length === 0) return {}

  const examIds = (exams as Array<{ id: number }>).map(e => e.id)

  // 2 & 3. Subjects + scores in parallel
  const [{ data: subjects }, { data: scores }] = await Promise.all([
    supabase.from("exam_subjects").select("*").in("exam_id", examIds),
    supabase.from("exam_scores").select("*").in("exam_id", examIds),
  ])

  // Build result grouped by class_id
  const result: Record<string, GradeEntry[]> = {}
  for (const exam of exams as Array<Record<string, unknown>>) {
    const classId = exam.class_id as string
    if (!result[classId]) result[classId] = []

    const examSubjects: Subject[] = (subjects || [])
      .filter((s: Record<string, unknown>) => s.exam_id === exam.id)
      .map((s: Record<string, unknown>) => ({ id: s.id as string, name: s.name as string, maxScore: s.max_score as number }))

    const examScores = (scores || []).filter((s: Record<string, unknown>) => s.exam_id === exam.id)
    const subjectScores: Record<string, Record<string, number>> = {}
    const legacyScores: Record<string, number> = {}

    examScores.forEach((s: Record<string, unknown>) => {
      const sid = s.student_id as string
      if (s.subject_id) {
        if (!subjectScores[sid]) subjectScores[sid] = {}
        subjectScores[sid][s.subject_id as string] = s.score as number
      } else {
        legacyScores[sid] = s.score as number
      }
    })

    result[classId].push({
      examName: exam.name as string,
      subject: (exam.subject as string) || "",
      date: (exam.date as string) || "",
      scores: legacyScores,
      maxScore: (exam.max_score as number) || 100,
      subjects: examSubjects.length > 0 ? examSubjects : undefined,
      subjectScores: Object.keys(subjectScores).length > 0 ? subjectScores : undefined,
    })
  }
  return result
}

/**
 * Permanently delete every attendance row for a class on a single date.
 * Used by the "Reset / Clear day" action to erase all marks (present,
 * absent, late and arrival times) for that class+date.
 */
export async function deleteAttendanceForDate(classId: string, date: string) {
  return supabase.from("attendance").delete().eq("class_id", classId).eq("date", date)
}

export async function saveAttendance(
  classId: string,
  records: Record<string, Record<string, "present" | "absent" | "late">>,
  markedBy?: string,
  remarks?: Record<string, Record<string, string>>,
  arrivalTimes?: Record<string, Record<string, string>>,
) {
  // records:      { "2026-04-08": { "studentId": "present", ... }, ... }
  // remarks:      { "2026-04-08": { "studentId": "Sick", ... }, ... } — only for absent rows
  // arrivalTimes: { "2026-04-08": { "studentId": "09:12", ... }, ... } — only for recorded arrivals
  const rows: Array<{
    class_id: string
    student_id: string
    date: string
    status: string
    marked_by?: string
    remarks?: string
    arrival_time?: string
  }> = []
  Object.entries(records).forEach(([date, studentRecords]) => {
    Object.entries(studentRecords).forEach(([studentId, status]) => {
      rows.push({
        class_id: classId,
        student_id: studentId,
        date,
        status,
        marked_by: markedBy || undefined,
        remarks: remarks?.[date]?.[studentId] || undefined,
        arrival_time: arrivalTimes?.[date]?.[studentId] || undefined,
      })
    })
  })
  if (rows.length === 0) return { error: null }

  const upsert = (rs: Array<Record<string, unknown>>) =>
    supabase.from("attendance").upsert(rs, { onConflict: "class_id,student_id,date" })

  // Try with the full payload first.
  let result = await upsert(rows)
  if (!result.error) return result

  // Older databases may be missing the newer optional columns. Retry with
  // progressively smaller payloads, dropping the most-recently-added column
  // first so existing columns (marked_by, remarks) are preserved when possible.
  const withoutArrival = rows.map(({ arrival_time: _a, ...r }) => { void _a; return r })
  result = await upsert(withoutArrival)
  if (!result.error) return result

  const withoutRemarks = withoutArrival.map(({ remarks: _r, ...r }) => { void _r; return r })
  result = await upsert(withoutRemarks)
  if (!result.error) return result

  const minimal = withoutRemarks.map(({ marked_by: _m, ...r }) => { void _m; return r })
  return upsert(minimal)
}

/**
 * Returns a map of class_id → teacher name for all classes that had attendance marked
 * on the given date. One batched query, used by the dashboard to populate
 * "Marked by …" on each class card.
 */
export async function fetchTodayMarkers(dateStr: string): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("attendance")
    .select("class_id, marked_by")
    .eq("date", dateStr)
    .not("marked_by", "is", null)
  if (error || !data) return {}
  const map: Record<string, string> = {}
  for (const row of data as Array<{ class_id: string; marked_by: string | null }>) {
    if (row.marked_by && !map[row.class_id]) map[row.class_id] = row.marked_by
  }
  return map
}

/**
 * Returns a map of date → teacher name for the most recent "marked_by" on each date for a class.
 * Used to display "Last marked by…" on the attendance UI.
 */
export async function fetchAttendanceMarkers(classId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("attendance")
    .select("date, marked_by")
    .eq("class_id", classId)
    .not("marked_by", "is", null)
    .order("date", { ascending: false })
  if (error || !data) return {}
  const map: Record<string, string> = {}
  for (const row of data as Array<{ date: string; marked_by: string | null }>) {
    const date = (row.date as string).split("T")[0]
    if (row.marked_by && !map[date]) {
      map[date] = row.marked_by
    }
  }
  return map
}

/**
 * One batched query: returns the most-recent marked_by date+name per class,
 * across ALL supplied classIds. Replaces the N×fetchAttendanceMarkers loop
 * that was causing the attendance page to make one query per class.
 */
export async function fetchAllClassLastMarkers(
  classIds: string[],
): Promise<Record<string, { date: string; by: string }>> {
  if (classIds.length === 0) return {}
  const { data, error } = await supabase
    .from("attendance")
    .select("class_id, date, marked_by")
    .in("class_id", classIds)
    .not("marked_by", "is", null)
    .order("date", { ascending: false })
  if (error || !data) return {}
  // Keep only the first (most recent) entry per class
  const map: Record<string, { date: string; by: string }> = {}
  for (const row of data as Array<{ class_id: string; date: string; marked_by: string | null }>) {
    if (row.marked_by && !map[row.class_id]) {
      map[row.class_id] = { date: (row.date as string).split("T")[0], by: row.marked_by }
    }
  }
  return map
}

// ══════════════════════════════════════════════════════════
// GRADES / EXAMS
// ══════════════════════════════════════════════════════════
export async function fetchGrades(classId: string): Promise<GradeEntry[]> {
  // Fetch exams
  const { data: exams, error: exErr } = await supabase
    .from("exams")
    .select("*")
    .eq("class_id", classId)
    .order("created_at", { ascending: false })
  if (exErr || !exams || exams.length === 0) return []

  const examIds = exams.map((e: Record<string, number>) => e.id)

  // Fetch subjects for all exams
  const { data: subjects } = await supabase
    .from("exam_subjects")
    .select("*")
    .in("exam_id", examIds)

  // Fetch scores for all exams
  const { data: scores } = await supabase
    .from("exam_scores")
    .select("*")
    .in("exam_id", examIds)

  return exams.map((exam: Record<string, unknown>) => {
    const examSubjects: Subject[] = (subjects || [])
      .filter((s: Record<string, unknown>) => s.exam_id === exam.id)
      .map((s: Record<string, unknown>) => ({
        id: s.id as string,
        name: s.name as string,
        maxScore: s.max_score as number,
      }))

    const examScores = (scores || []).filter((s: Record<string, unknown>) => s.exam_id === exam.id)

    // Build subjectScores: studentId -> subjectId -> score
    const subjectScoresMap: Record<string, Record<string, number>> = {}
    const totalScoresMap: Record<string, number> = {}

    examScores.forEach((s: Record<string, unknown>) => {
      const sid = s.student_id as string
      const subId = s.subject_id as string
      const score = s.score as number
      if (!subjectScoresMap[sid]) subjectScoresMap[sid] = {}
      subjectScoresMap[sid][subId] = score
      totalScoresMap[sid] = (totalScoresMap[sid] || 0) + score
    })

    return {
      examName: exam.exam_name as string,
      subject: examSubjects.map((s) => s.name).join(", "),
      date: (exam.date as string).split("T")[0],
      scores: totalScoresMap,
      maxScore: exam.total_max_score as number,
      subjects: examSubjects,
      subjectScores: subjectScoresMap,
      _dbId: exam.id, // internal: DB id for deletion
    } as GradeEntry & { _dbId: number }
  })
}

export async function saveGrade(
  classId: string,
  examName: string,
  date: string,
  totalMaxScore: number,
  subjects: Array<{ id: string; name: string; maxScore: number }>,
  subjectScores: Record<string, Record<string, number>> // studentId -> subjectId -> score
) {
  // 1. Insert exam
  const { data: exam, error: exErr } = await supabase
    .from("exams")
    .insert({ class_id: classId, exam_name: examName, date, total_max_score: totalMaxScore })
    .select("id")
    .single()
  if (exErr || !exam) return { error: exErr }

  const examId = exam.id

  // 2. Insert subjects
  const subjectRows = subjects.map((s) => ({
    id: s.id,
    exam_id: examId,
    name: s.name,
    max_score: s.maxScore,
  }))
  const { error: subErr } = await supabase.from("exam_subjects").insert(subjectRows)
  if (subErr) return { error: subErr }

  // 3. Insert scores
  const scoreRows: Array<{ exam_id: number; student_id: string; subject_id: string; score: number }> = []
  Object.entries(subjectScores).forEach(([studentId, subs]) => {
    Object.entries(subs).forEach(([subjectId, score]) => {
      scoreRows.push({ exam_id: examId, student_id: studentId, subject_id: subjectId, score })
    })
  })
  if (scoreRows.length > 0) {
    const { error: scErr } = await supabase.from("exam_scores").insert(scoreRows)
    if (scErr) return { error: scErr }
  }

  return { error: null, examId }
}

export async function deleteGrade(examId: number) {
  // Cascade will delete subjects and scores
  return supabase.from("exams").delete().eq("id", examId)
}

// ── Grade Book (new unified module) ──────────────────────────
// Used by /dashboard/assessment (Grade Book) to fetch every exam
// across every class in a single round-trip, enriched with subjects + scores.
export interface GradeBookExam {
  id: number
  classId: string
  examName: string
  date: string
  totalMaxScore: number
  subjects: Subject[]
  /** studentId -> subjectId -> score */
  subjectScores: Record<string, Record<string, number>>
}

export async function fetchAllGrades(): Promise<GradeBookExam[]> {
  if (!isSupabaseConfigured()) return []
  const { data: exams, error: exErr } = await supabase
    .from("exams")
    .select("*")
    .order("date", { ascending: false })
  if (exErr || !exams || exams.length === 0) return []

  const examIds = exams.map((e: Record<string, number>) => e.id)
  const [{ data: subjects }, { data: scores }] = await Promise.all([
    supabase.from("exam_subjects").select("*").in("exam_id", examIds),
    supabase.from("exam_scores").select("*").in("exam_id", examIds),
  ])

  return exams.map((exam: Record<string, unknown>) => {
    const examSubjects: Subject[] = (subjects || [])
      .filter((s: Record<string, unknown>) => s.exam_id === exam.id)
      .map((s: Record<string, unknown>) => ({
        id: s.id as string,
        name: s.name as string,
        maxScore: s.max_score as number,
      }))

    const subjectScoresMap: Record<string, Record<string, number>> = {}
    ;(scores || [])
      .filter((s: Record<string, unknown>) => s.exam_id === exam.id)
      .forEach((s: Record<string, unknown>) => {
        const sid = s.student_id as string
        const subId = s.subject_id as string
        if (!subjectScoresMap[sid]) subjectScoresMap[sid] = {}
        subjectScoresMap[sid][subId] = s.score as number
      })

    return {
      id: exam.id as number,
      classId: exam.class_id as string,
      examName: exam.exam_name as string,
      date: (exam.date as string).split("T")[0],
      totalMaxScore: exam.total_max_score as number,
      subjects: examSubjects,
      subjectScores: subjectScoresMap,
    }
  })
}

/** Update an exam's name, date, and total. Subjects and scores are not touched. */
export async function updateExamMeta(
  examId: number,
  examName: string,
  date: string,
  totalMaxScore: number
) {
  return supabase
    .from("exams")
    .update({ exam_name: examName, date, total_max_score: totalMaxScore })
    .eq("id", examId)
}

/**
 * Replace the subject list for an exam without destroying existing scores.
 * Strategy: fetch current subject IDs → delete only removed ones (cascade
 * removes their scores) → upsert retained + new subjects (scores are preserved).
 */
export async function replaceExamSubjects(
  examId: number,
  subjects: Array<{ id: string; name: string; maxScore: number }>
) {
  const { data: existing, error: fetchErr } = await supabase
    .from("exam_subjects")
    .select("id")
    .eq("exam_id", examId)
  if (fetchErr) return { error: fetchErr }

  const incomingIds = new Set(subjects.map((s) => s.id))
  const removedIds = (existing || [])
    .map((r: Record<string, string>) => r.id)
    .filter((id: string) => !incomingIds.has(id))

  if (removedIds.length > 0) {
    const { error: delErr } = await supabase
      .from("exam_subjects")
      .delete()
      .eq("exam_id", examId)
      .in("id", removedIds)
    if (delErr) return { error: delErr }
  }

  if (subjects.length === 0) return { error: null }
  const rows = subjects.map((s) => ({ id: s.id, exam_id: examId, name: s.name, max_score: s.maxScore }))
  const { error } = await supabase.from("exam_subjects").upsert(rows, { onConflict: "id" })
  return { error }
}

/**
 * Seed the two scheduled syllabus exams (Half-Yearly + Final Year) for one
 * class. Idempotent — if an exam with the same name already exists, skip it.
 *
 * DB stays clean: only English subject names + stable ids land in
 * exam_subjects. The bilingual portion text + Arabic name live in
 * src/data/syllabus.ts and are joined back at render time via the subject id.
 */
export async function seedSyllabusExamsForClass(
  classId: string,
  halfYearlyDate: string,
  finalYearDate: string,
  subjects: Array<{ id: string; enName: string; maxScore: number }>,
  className: string,
  yearLabel: string,
): Promise<{ created: number[]; skipped: string[]; error?: unknown }> {
  const { data: existing, error: exErr } = await supabase
    .from("exams")
    .select("id, exam_name")
    .eq("class_id", classId)
  if (exErr) return { created: [], skipped: [], error: exErr }

  const existingNames = new Set((existing ?? []).map((e: Record<string, unknown>) => (e.exam_name as string).toLowerCase()))

  const totalMax = subjects.reduce((s, sub) => s + sub.maxScore, 0)
  const created: number[] = []
  const skipped: string[] = []

  const exams: Array<{ name: string; date: string }> = [
    { name: `${className} — Half-Yearly Examination ${yearLabel}`, date: halfYearlyDate },
    { name: `${className} — Annual Examination ${yearLabel}`, date: finalYearDate },
  ]

  for (const ex of exams) {
    if (existingNames.has(ex.name.toLowerCase())) {
      skipped.push(ex.name)
      continue
    }
    const { data: inserted, error: insErr } = await supabase
      .from("exams")
      .insert({ class_id: classId, exam_name: ex.name, date: ex.date, total_max_score: totalMax })
      .select("id")
      .single()
    if (insErr || !inserted) return { created, skipped, error: insErr }

    // Prefix exam id to keep subject PKs unique across academic years
    const subjectRows = subjects.map((s) => ({
      id: `${inserted.id as number}_${s.id}`,
      exam_id: inserted.id as number,
      name: s.enName,
      max_score: s.maxScore,
    }))
    const { error: subErr } = await supabase.from("exam_subjects").insert(subjectRows)
    if (subErr) return { created, skipped, error: subErr }
    created.push(inserted.id as number)
  }
  return { created, skipped }
}

/**
 * Save scores for one exam without a destructive delete-all.
 * Non-empty cells are upserted atomically.
 * Empty cells (intentionally cleared) are deleted per-student in targeted queries.
 * This preserves all untouched scores even if the save of a subset fails.
 */
export async function bulkSaveScores(
  examId: number,
  studentScores: Record<string, Record<string, number | "">>
) {
  const toUpsert: Array<{ exam_id: number; student_id: string; subject_id: string; score: number }> = []
  const toClear: Record<string, string[]> = {} // studentId → subjectIds[]

  Object.entries(studentScores).forEach(([studentId, subs]) => {
    Object.entries(subs).forEach(([subjectId, score]) => {
      if (score === "" || score === null || score === undefined) {
        if (!toClear[studentId]) toClear[studentId] = []
        toClear[studentId].push(subjectId)
        return
      }
      const num = Number(score)
      if (Number.isNaN(num)) return
      toUpsert.push({ exam_id: examId, student_id: studentId, subject_id: subjectId, score: num })
    })
  })

  if (toUpsert.length > 0) {
    // Try upsert first (requires UNIQUE constraint on exam_id,student_id,subject_id).
    // Fall back to delete+insert per row if the constraint is missing in production.
    const { error: upsertErr } = await supabase
      .from("exam_scores")
      .upsert(toUpsert, { onConflict: "exam_id,student_id,subject_id" })

    if (upsertErr) {
      for (const row of toUpsert) {
        await supabase.from("exam_scores")
          .delete()
          .eq("exam_id", row.exam_id)
          .eq("student_id", row.student_id)
          .eq("subject_id", row.subject_id)
        const { error: insErr } = await supabase.from("exam_scores").insert(row)
        if (insErr) return { error: insErr }
      }
    }
  }

  for (const studentId of Object.keys(toClear)) {
    const subjectIds = toClear[studentId]
    const { error } = await supabase
      .from("exam_scores")
      .delete()
      .eq("exam_id", examId)
      .eq("student_id", studentId)
      .in("subject_id", subjectIds)
    if (error) return { error }
  }

  return { error: null }
}

// ══════════════════════════════════════════════════════════
// STAFF / TEACHERS
// ══════════════════════════════════════════════════════════
export interface StaffRecord {
  id: string
  name: string
  phone?: string
  transportAllowance: boolean
}

export interface StaffAttendanceEntry {
  teacherId: string
  date: string
  session: "morning" | "afternoon" | "full" | "evening" | "edu-makeup" | "cibis"
  status: "present" | "absent" | "late"
  lateCategory?: 1 | 2 | 3
  arrivalTime?: string
  departureTime?: string
  sessionsCredited?: number
  earlyDepartureCategory?: number | null
  outMissing?: boolean
  sessionType: "online" | "offline"
  transportAllowance?: boolean
  taRemarks?: string
  remarks?: string
  // Online self check-in verification (null until admin/accountant verifies).
  // Columns come from migration 20260707000000_online_self_checkin.sql; when it
  // hasn't run yet they are simply undefined (select("*") tolerates that).
  verifiedBy?: string | null
  verifiedAt?: string | null
}

export async function fetchTeachers(): Promise<StaffRecord[]> {
  const { data, error } = await supabase.from("teachers").select("*").order("name")
  if (error || !data) return []
  return data.map((t: Record<string, unknown>) => ({
    id: t.id as string,
    name: t.name as string,
    phone: (t.phone as string) || undefined,
    transportAllowance: t.transport_allowance as boolean,
  }))
}

export async function updateTeacherTransport(teacherId: string, transportAllowance: boolean) {
  return supabase.from("teachers").update({ transport_allowance: transportAllowance }).eq("id", teacherId)
}

export async function fetchStaffAttendance(month: string): Promise<{ data: StaffAttendanceEntry[]; error?: string }> {
  const startDate = `${month}-01`
  const [y, m] = month.split("-").map(Number)
  const endDate = `${y}-${String(m).padStart(2, "0")}-${new Date(y, m, 0).getDate()}`

  const { data, error } = await supabase
    .from("staff_attendance")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date")
  if (error) {
    if (error.code === "42P01") return { data: [], error: "TABLE_MISSING" }
    return { data: [], error: error.message }
  }
  if (!data) return { data: [] }

  return {
    data: data.map((r: Record<string, unknown>) => ({
      teacherId: r.teacher_id as string,
      date: (r.date as string).split("T")[0],
      session: r.session as "morning" | "afternoon" | "full" | "evening" | "edu-makeup" | "cibis",
      status: r.status as "present" | "absent" | "late",
      lateCategory: (r.late_category as 1 | 2 | 3) || undefined,
      arrivalTime: (r.arrival_time as string) || undefined,
      departureTime: (r.departure_time as string) || undefined,
      sessionsCredited: (r.sessions_credited as number) ?? undefined,
      earlyDepartureCategory: r.early_departure_category as number | null | undefined,
      outMissing: (r.out_missing as boolean) || false,
      sessionType: r.session_type as "online" | "offline",
      transportAllowance: (r.transport_allowance as boolean) || false,
      taRemarks: (r.ta_remarks as string) || undefined,
      remarks: (r.remarks as string) || undefined,
      verifiedBy: (r.verified_by as string | null) ?? null,
      verifiedAt: (r.verified_at as string | null) ?? null,
    }))
  }
}

export async function saveStaffAttendance(entries: StaffAttendanceEntry[]) {
  const rows = entries.map((e) => ({
    teacher_id: e.teacherId,
    date: e.date,
    session: e.session,
    status: e.status,
    late_category: e.lateCategory || null,
    arrival_time: e.arrivalTime || null,
    session_type: e.sessionType,
    transport_allowance: e.transportAllowance || false,
    ta_remarks: e.taRemarks || null,
    remarks: e.remarks || null,
  }))

  const result = await supabase.from("staff_attendance").upsert(rows, {
    onConflict: "teacher_id,date,session",
  })

  if (result.error) {
    console.error("[saveStaffAttendance] first attempt error:", result.error)

    // Retry without optional columns that may not exist yet
    const rowsCore = rows.map((row) => {
      const { transport_allowance, ta_remarks, arrival_time, ...r } = row
      void transport_allowance; void ta_remarks; void arrival_time
      return r
    })
    const result2 = await supabase.from("staff_attendance").upsert(rowsCore, {
      onConflict: "teacher_id,date,session",
    })

    if (result2.error) {
      console.error("[saveStaffAttendance] second attempt error:", result2.error)
    }
    return result2
  }

  return result
}

/** Delete all staff_attendance records for a month (used when saving a full monthly grid) */
export async function deleteStaffAttendanceForMonth(month: string, teacherIds: string[]) {
  const startDate = `${month}-01`
  const [y, m] = month.split("-").map(Number)
  const endDate = `${y}-${String(m).padStart(2, "0")}-${new Date(y, m, 0).getDate()}`

  return supabase
    .from("staff_attendance")
    .delete()
    .in("teacher_id", teacherIds)
    .gte("date", startDate)
    .lte("date", endDate)
}

/** Count distinct days a teacher had transport_allowance checked in a month */
export async function countTaDaysInMonth(teacherId: string, month: string): Promise<number> {
  const startDate = `${month}-01`
  const [y, m] = month.split("-").map(Number)
  const endDate = `${y}-${String(m).padStart(2, "0")}-${new Date(y, m, 0).getDate()}`

  const { data, error } = await supabase
    .from("staff_attendance")
    .select("date")
    .eq("teacher_id", teacherId)
    .eq("transport_allowance", true)
    .gte("date", startDate)
    .lte("date", endDate)
  if (error || !data) return 0
  const uniqueDates = new Set(data.map((r: Record<string, string>) => r.date))
  return uniqueDates.size
}

export interface PaymentRecord {
  id?: number
  teacherId: string
  month: string
  totalAmount: number
  transportAmount: number
  deductions: number
  netAmount: number
  paid: boolean
  paidDate?: string
  paidNetAmount?: number   // the exact net amount that was paid — used to detect new sessions added after payment
  taPaid: boolean
  taPaidDate?: string
  paidTaAmount?: number    // the exact TA amount that was paid
  remarks?: string
}

export async function fetchPayments(month: string): Promise<{ data: PaymentRecord[]; error?: string }> {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("month", month)
  if (error) {
    if (error.code === "42P01") return { data: [], error: "TABLE_MISSING" }
    return { data: [], error: error.message }
  }
  if (!data) return { data: [] }
  return {
    data: data.map((p: Record<string, unknown>) => ({
      id: p.id as number,
      teacherId: p.teacher_id as string,
      month: p.month as string,
      totalAmount: Number(p.total_amount),
      transportAmount: Number(p.transport_amount),
      deductions: Number(p.deductions),
      netAmount: Number(p.net_amount),
      paid: p.paid as boolean,
      paidDate: (p.paid_date as string) || undefined,
      paidNetAmount: p.paid_net_amount != null ? Number(p.paid_net_amount) : undefined,
      taPaid: (p.ta_paid as boolean) || false,
      taPaidDate: (p.ta_paid_date as string) || undefined,
      paidTaAmount: p.paid_ta_amount != null ? Number(p.paid_ta_amount) : undefined,
      remarks: (p.remarks as string) || undefined,
    }))
  }
}

/** Fetch ALL payment records where salary OR transport allowance is still unpaid, across all months. */
export async function fetchAllPendingPayments(): Promise<{ data: PaymentRecord[]; error?: string }> {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .or("paid.eq.false,ta_paid.eq.false")
    .order("month", { ascending: true })
  if (error) {
    if (error.code === "42P01") return { data: [], error: "TABLE_MISSING" }
    return { data: [], error: error.message }
  }
  if (!data) return { data: [] }
  return {
    data: data.map((p: Record<string, unknown>) => ({
      id: p.id as number,
      teacherId: p.teacher_id as string,
      month: p.month as string,
      totalAmount: Number(p.total_amount),
      transportAmount: Number(p.transport_amount),
      deductions: Number(p.deductions),
      netAmount: Number(p.net_amount),
      paid: p.paid as boolean,
      paidDate: (p.paid_date as string) || undefined,
      paidNetAmount: p.paid_net_amount != null ? Number(p.paid_net_amount) : undefined,
      taPaid: (p.ta_paid as boolean) || false,
      taPaidDate: (p.ta_paid_date as string) || undefined,
      paidTaAmount: p.paid_ta_amount != null ? Number(p.paid_ta_amount) : undefined,
      remarks: (p.remarks as string) || undefined,
    }))
  }
}

/**
 * Upserts ONLY the financial amounts for a payment row.
 * Never overwrites paid / paid_date / ta_paid / ta_paid_date —
 * those are managed exclusively via markPaymentPaid / markTaPaid / markPaymentUnpaid.
 */
export async function savePayment(payment: PaymentRecord) {
  return supabase.from("payments").upsert({
    teacher_id: payment.teacherId,
    month: payment.month,
    total_amount: payment.totalAmount,
    transport_amount: payment.transportAmount,
    deductions: payment.deductions,
    net_amount: payment.netAmount,
    remarks: payment.remarks || null,
    // paid / paidDate / taPaid / taPaidDate are intentionally omitted:
    // the DB default (false) handles new rows; existing paid status is not touched here.
  }, { onConflict: "teacher_id,month" })
}

/** Explicitly reset salary paid → false (called when net amount changes after being paid) */
export async function markPaymentUnpaid(teacherId: string, month: string) {
  return supabase.from("payments")
    .update({ paid: false, paid_date: null, paid_net_amount: null })
    .eq("teacher_id", teacherId)
    .eq("month", month)
}

/** Explicitly reset TA paid → false (called when transport amount changes after being paid) */
export async function markTaUnpaid(teacherId: string, month: string) {
  return supabase.from("payments")
    .update({ ta_paid: false, ta_paid_date: null, paid_ta_amount: null })
    .eq("teacher_id", teacherId)
    .eq("month", month)
}

export async function markPaymentPaid(teacherId: string, month: string, netAmount: number) {
  const result = await supabase.from("payments").update({
    paid: true,
    paid_date: new Date().toISOString().split("T")[0],
    paid_net_amount: netAmount,   // lock in what was paid — used to detect new sessions later
  }).eq("teacher_id", teacherId).eq("month", month)

  // If paid_net_amount column doesn't exist yet, retry without it and report back
  if (result.error?.code === "42703" || result.error?.message?.includes("paid_net_amount")) {
    console.error("[markPaymentPaid] paid_net_amount column missing — run migration SQL")
    const retry = await supabase.from("payments").update({
      paid: true,
      paid_date: new Date().toISOString().split("T")[0],
    }).eq("teacher_id", teacherId).eq("month", month)
    return { ...retry, missingColumn: true as const }
  }
  return result
}

export async function markTaPaid(teacherId: string, month: string, taAmount: number) {
  const result = await supabase.from("payments").update({
    ta_paid: true,
    ta_paid_date: new Date().toISOString().split("T")[0],
    paid_ta_amount: taAmount,     // lock in what TA was paid
  }).eq("teacher_id", teacherId).eq("month", month)

  if (result.error?.code === "42703" || result.error?.message?.includes("paid_ta_amount")) {
    console.error("[markTaPaid] paid_ta_amount column missing — run migration SQL")
    const retry = await supabase.from("payments").update({
      ta_paid: true,
      ta_paid_date: new Date().toISOString().split("T")[0],
    }).eq("teacher_id", teacherId).eq("month", month)
    return { ...retry, missingColumn: true as const }
  }
  return result
}

/** Sum minus marks for a teacher in a month.
 *  Cat-1 = 1 mark, Cat-2 = 2 marks, Cat-3 = 3 marks.
 *  Falls back to 1 mark per late day for old records without late_category. */
export async function countMinusMarksInMonth(teacherId: string, month: string): Promise<number> {
  const startDate = `${month}-01`
  const [y, m] = month.split("-").map(Number)
  const endDate = `${y}-${String(m).padStart(2, "0")}-${new Date(y, m, 0).getDate()}`

  const { data, error } = await supabase
    .from("staff_attendance")
    .select("date, late_category")
    .eq("teacher_id", teacherId)
    .eq("status", "late")
    .gte("date", startDate)
    .lte("date", endDate)
  if (error || !data) return 0

  // De-duplicate by date (one minus-mark event per day per teacher)
  const seen = new Map<string, number>()
  for (const r of data as Array<{ date: string; late_category: number | null }>) {
    const marks = r.late_category ?? 1  // legacy rows without category default to 1
    const date = (r.date as string).split("T")[0]
    if (!seen.has(date) || (r.late_category ?? 1) > (seen.get(date) ?? 0)) {
      seen.set(date, marks)
    }
  }
  return Array.from(seen.values()).reduce((sum, v) => sum + v, 0)
}

/** @deprecated Use countMinusMarksInMonth instead */
export async function countLateInMonth(teacherId: string, month: string): Promise<number> {
  return countMinusMarksInMonth(teacherId, month)
}

// ── Teacher Self-Attendance Requests ──────────────────────

export interface AttendanceRequest {
  id: string
  teacherId: string
  teacherName: string
  date: string
  morningStatus: "present" | "absent" | "late"
  afternoonStatus: "present" | "absent" | "late"
  transportAllowance: boolean
  sessionType: "online" | "offline"
  notes: string
  status: "pending" | "approved" | "rejected"
  submittedAt: string
  reviewedBy?: string
  reviewedAt?: string
}

export async function submitAttendanceRequest(req: Omit<AttendanceRequest, "id" | "status" | "submittedAt" | "reviewedBy" | "reviewedAt">): Promise<{ error: string | null; alreadySubmitted?: boolean }> {
  const { error } = await supabase.from("staff_attendance_requests").insert({
    teacher_id: req.teacherId,
    teacher_name: req.teacherName,
    date: req.date,
    morning_status: req.morningStatus,
    afternoon_status: req.afternoonStatus,
    transport_allowance: req.transportAllowance,
    session_type: req.sessionType,
    notes: req.notes,
    status: "pending",
  })
  if (error?.code === "23505") return { error: null, alreadySubmitted: true } // unique violation
  return { error: error?.message || null }
}

export async function fetchAttendanceRequests(status?: "pending" | "approved" | "rejected"): Promise<{ data: AttendanceRequest[]; error: string | null }> {
  let query = supabase.from("staff_attendance_requests").select("*").order("submitted_at", { ascending: false })
  if (status) query = query.eq("status", status)
  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return {
    data: (data || []).map((r) => ({
      id: r.id,
      teacherId: r.teacher_id,
      teacherName: r.teacher_name,
      date: r.date,
      morningStatus: r.morning_status,
      afternoonStatus: r.afternoon_status,
      transportAllowance: r.transport_allowance,
      sessionType: r.session_type,
      notes: r.notes || "",
      status: r.status,
      submittedAt: r.submitted_at,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
    })),
    error: null,
  }
}

export async function fetchTeacherRequests(teacherId: string): Promise<{ data: AttendanceRequest[]; error: string | null }> {
  const { data, error } = await supabase
    .from("staff_attendance_requests")
    .select("*")
    .eq("teacher_id", teacherId)
    .order("date", { ascending: false })
    .limit(30)
  if (error) return { data: [], error: error.message }
  return {
    data: (data || []).map((r) => ({
      id: r.id,
      teacherId: r.teacher_id,
      teacherName: r.teacher_name,
      date: r.date,
      morningStatus: r.morning_status,
      afternoonStatus: r.afternoon_status,
      transportAllowance: r.transport_allowance,
      sessionType: r.session_type,
      notes: r.notes || "",
      status: r.status,
      submittedAt: r.submitted_at,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
    })),
    error: null,
  }
}

export async function approveAttendanceRequest(
  id: string,
  reviewedBy: string,
  arrivalTime?: string // HH:MM in 24h format e.g. "09:10"
): Promise<{ error: string | null }> {
  const { data: req, error: fetchErr } = await supabase
    .from("staff_attendance_requests")
    .select("*")
    .eq("id", id)
    .single()
  if (fetchErr || !req) return { error: fetchErr?.message || "Request not found" }

  // Auto-detect late category from arrival time
  let morningStatus = req.morning_status
  let lateCategory: number | null = null
  if (arrivalTime) {
    const [h, m] = arrivalTime.split(":").map(Number)
    const mins = h * 60 + m
    if (mins < 8 * 60 + 55) {
      morningStatus = "present"
    } else if (mins <= 8 * 60 + 59) {
      morningStatus = "late"; lateCategory = 1
    } else if (mins <= 9 * 60 + 5) {
      morningStatus = "late"; lateCategory = 2
    } else if (mins <= 9 * 60 + 16) {
      morningStatus = "late"; lateCategory = 3
    } else {
      morningStatus = "absent"  // after 9:16 → missed morning
    }
  }

  const rows = [
    {
      teacher_id: req.teacher_id,
      date: req.date,
      session: "morning",
      status: morningStatus,
      late_category: lateCategory,
      session_type: req.session_type,
      transport_allowance: req.transport_allowance,
      arrival_time: arrivalTime || null,
      remarks: `Self-reported, approved by ${reviewedBy}`,
    },
    {
      teacher_id: req.teacher_id,
      date: req.date,
      session: "afternoon",
      status: req.afternoon_status,
      late_category: null,
      session_type: req.session_type,
      transport_allowance: req.transport_allowance,
      remarks: `Self-reported, approved by ${reviewedBy}`,
    },
  ]
  const { error: saveErr } = await supabase.from("staff_attendance").upsert(rows, { onConflict: "teacher_id,date,session" })
  if (saveErr) return { error: saveErr.message }

  const { error: updateErr } = await supabase
    .from("staff_attendance_requests")
    .update({ status: "approved", reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq("id", id)
  return { error: updateErr?.message || null }
}

export async function rejectAttendanceRequest(id: string, reviewedBy: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("staff_attendance_requests")
    .update({ status: "rejected", reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq("id", id)
  return { error: error?.message || null }
}

// ============================================================
// Fix 1: db.ts ADDITIONS — paste at the bottom of src/lib/db.ts
// (before the last closing line)
// ============================================================

// ══════════════════════════════════════════════════════════
// CHAT MESSAGES
// ══════════════════════════════════════════════════════════

export interface ChatMessage {
  id: string
  threadId: string
  senderId: string
  senderName: string
  senderRole: string
  text: string
  createdAt: string
}

export interface ChatThread {
  threadId: string
  otherName: string
  otherRole: string
  lastMessage: string
  lastTime: string
  unread: boolean
}

/** Build a stable thread ID from two user IDs (order-independent) */
export function buildThreadId(uid1: string, uid2: string): string {
  return [uid1, uid2].sort().join("___")
}

/** Fetch all messages in a thread, newest last */
export async function fetchChatMessages(threadId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
  if (error || !data) return []
  return data.map((r: Record<string, string>) => ({
    id: r.id,
    threadId: r.thread_id,
    senderId: r.sender_id,
    senderName: r.sender_name,
    senderRole: r.sender_role,
    text: r.text,
    createdAt: r.created_at,
  }))
}

/** Fetch all threads a user has participated in (latest message per thread) */
export async function fetchChatThreads(userId: string): Promise<ChatThread[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .like("thread_id", `%${userId}%`)
    .order("created_at", { ascending: false })
  if (error || !data) return []

  // Deduplicate: one entry per thread, keeping the latest message
  const seen = new Map<string, ChatThread>()
  for (const r of data as Array<Record<string, string>>) {
    if (seen.has(r.thread_id)) continue
    const otherName = r.sender_id === userId ? "" : r.sender_name
    seen.set(r.thread_id, {
      threadId: r.thread_id,
      otherName,
      otherRole: r.sender_role,
      lastMessage: r.text,
      lastTime: r.created_at,
      unread: r.sender_id !== userId,
    })
  }
  return Array.from(seen.values())
}

/** Send a message */
export async function sendChatMessage(params: {
  threadId: string
  senderId: string
  senderName: string
  senderRole: string
  text: string
}): Promise<{ error?: string }> {
  const { error } = await supabase.from("chat_messages").insert({
    thread_id: params.threadId,
    sender_id: params.senderId,
    sender_name: params.senderName,
    sender_role: params.senderRole,
    text: params.text,
  })
  return { error: error?.message }
}

// ══════════════════════════════════════════════════════════
// FIX 3: BATCHED ATTENDANCE FETCH FOR DASHBOARD
// Replace the N+1 loop in dashboard/page.tsx with this function.
// ══════════════════════════════════════════════════════════

/**
 * Fetch all attendance records for a given month across ALL classes
 * in a single Supabase query.
 * Returns: classId → AttendanceRecord[]
 */
export async function fetchAllClassesAttendanceForMonth(
  classIds: string[],
  month: string
): Promise<Record<string, AttendanceRecord[]>> {
  if (classIds.length === 0) return {}

  const startDate = `${month}-01`
  const [y, m] = month.split("-").map(Number)
  const endDate = `${y}-${String(m).padStart(2, "0")}-${new Date(y, m, 0).getDate()}`

  // arrival_time is a newer column; if the DB hasn't been migrated yet the
  // select errors, so retry without it rather than dropping all attendance.
  const runMonth = (cols: string) =>
    supabase.from("attendance").select(cols)
      .in("class_id", classIds).gte("date", startDate).lte("date", endDate)
  let resp = await runMonth("class_id, student_id, date, status, remarks, arrival_time")
  if (resp.error) resp = await runMonth("class_id, student_id, date, status, remarks")
  const { data, error } = resp

  if (error || !data) return {}

  // Group by classId → date → { statusMap, remarksMap, arrivalMap }
  const classDateMap: Record<
    string,
    Record<string, { status: Record<string, "present" | "absent" | "late">; remarks: Record<string, string>; arrivalTimes: Record<string, string> }>
  > = {}

  for (const row of data as unknown as Array<{
    class_id: string; student_id: string; date: string; status: string; remarks?: string; arrival_time?: string
  }>) {
    if (!classDateMap[row.class_id]) classDateMap[row.class_id] = {}
    if (!classDateMap[row.class_id][row.date]) classDateMap[row.class_id][row.date] = { status: {}, remarks: {}, arrivalTimes: {} }
    classDateMap[row.class_id][row.date].status[row.student_id] = row.status as "present" | "absent" | "late"
    if (row.remarks) classDateMap[row.class_id][row.date].remarks[row.student_id] = row.remarks
    if (row.arrival_time) classDateMap[row.class_id][row.date].arrivalTimes[row.student_id] = row.arrival_time
  }

  // Convert to AttendanceRecord[] per class
  const result: Record<string, AttendanceRecord[]> = {}
  for (const [classId, dateMap] of Object.entries(classDateMap)) {
    result[classId] = Object.entries(dateMap).map(([date, { status, remarks, arrivalTimes }]) => ({
      date,
      records: status,
      remarks: Object.keys(remarks).length > 0 ? remarks : undefined,
      arrivalTimes: Object.keys(arrivalTimes).length > 0 ? arrivalTimes : undefined,
    }))
  }
  return result
}

// ══════════════════════════════════════════════════════════
// FIX 2: STUDENT GRADES FOR REPORT CARD
// Fetch all exams + scores for a given student across their class.
// ══════════════════════════════════════════════════════════

export interface StudentExamResult {
  examId: number
  examName: string
  date: string
  classId: string
  className: string
  subjects: Array<{
    id: string
    name: string
    maxScore: number
    score: number
  }>
  totalScore: number
  maxTotalScore: number
}

/**
 * Fetch all exam results for a student.
 * 1. Look up which class the student is in.
 * 2. Fetch all exams for that class.
 * 3. Fetch scores only for this student.
 */
export async function fetchStudentReportCard(
  studentId: string
): Promise<{ data: StudentExamResult[]; classId?: string; className?: string; error?: string }> {
  // Step 1: Find the student's class
  const { data: studentRow, error: stuErr } = await supabase
    .from("students")
    .select("class_id")
    .eq("id", studentId)
    .single()

  if (stuErr || !studentRow) return { data: [], error: stuErr?.message || "Student not found" }

  const classId = studentRow.class_id as string

  // Step 2: Find the class name
  const { data: classRow } = await supabase
    .from("classes")
    .select("name")
    .eq("id", classId)
    .single()

  const className = (classRow as Record<string, string> | null)?.name || classId

  // Step 3: Fetch all exams for this class
  const { data: exams, error: exErr } = await supabase
    .from("exams")
    .select("id, exam_name, date, total_max_score")
    .eq("class_id", classId)
    .order("date", { ascending: false })

  if (exErr || !exams || exams.length === 0) return { data: [], classId, className }

  const examIds = (exams as Array<{ id: number }>).map((e) => e.id)

  // Step 4: Fetch subjects + scores for this student in one go
  const [{ data: subjectsData }, { data: scoresData }] = await Promise.all([
    supabase.from("exam_subjects").select("*").in("exam_id", examIds),
    supabase
      .from("exam_scores")
      .select("exam_id, subject_id, score")
      .in("exam_id", examIds)
      .eq("student_id", studentId),
  ])

  const subjects = (subjectsData || []) as Array<{
    exam_id: number; id: string; name: string; max_score: number
  }>
  const scores = (scoresData || []) as Array<{
    exam_id: number; subject_id: string; score: number
  }>

  // Build score lookup: examId+subjectId → score
  const scoreLookup: Record<string, number> = {}
  for (const s of scores) {
    scoreLookup[`${s.exam_id}__${s.subject_id}`] = s.score
  }

  const results: StudentExamResult[] = (exams as Array<{
    id: number; exam_name: string; date: string; total_max_score: number
  }>).map((exam) => {
    const examSubjects = subjects
      .filter((s) => s.exam_id === exam.id)
      .map((s) => ({
        id: s.id,
        name: s.name,
        maxScore: s.max_score,
        score: scoreLookup[`${exam.id}__${s.id}`] ?? 0,
      }))

    const totalScore = examSubjects.reduce((a, s) => a + s.score, 0)
    const maxTotalScore = examSubjects.reduce((a, s) => a + s.maxScore, 0) || exam.total_max_score

    return {
      examId: exam.id,
      examName: exam.exam_name,
      date: (exam.date as string).split("T")[0],
      classId,
      className,
      subjects: examSubjects,
      totalScore,
      maxTotalScore,
    }
  })

  return { data: results, classId, className }
}

// ══════════════════════════════════════════════════════════
// APP SETTINGS (key/value store — admin-writable)
// ══════════════════════════════════════════════════════════

/** Read a single app setting. Returns null when the key does not exist. */
export async function fetchAppSetting(key: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle()
  if (error || !data) return null
  return (data as Record<string, string>).value
}

/** Write (upsert) an app setting. Only admins may call this (enforced by RLS). */
export async function setAppSetting(key: string, value: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value }, { onConflict: "key" })
  return { error: error?.message }
}

// ══════════════════════════════════════════════════════════
// QURAN RECITATION SESSIONS
// One row per 5-minute one-on-one assessment (fixed 50-mark rubric).
// See src/lib/recitation.ts for the rubric + weekly-progress helpers
// and supabase/migrations/20260607000000_recitation_sessions.sql.
// ══════════════════════════════════════════════════════════

function mapRecitationRow(r: Record<string, unknown>): RecitationSession {
  return {
    id: r.id as string,
    classId: r.class_id as string,
    studentId: r.student_id as string,
    date: (r.session_date as string).split("T")[0],
    pronunciation: Number(r.pronunciation) || 0,
    tajweed: Number(r.tajweed) || 0,
    style: Number(r.style) || 0,
    startStop: Number(r.start_stop) || 0,
    total: Number(r.total) || 0,
    notes: (r.notes as string) || undefined,
    assessedBy: (r.assessed_by as string) || undefined,
    assessedById: (r.assessed_by_id as string) || undefined,
    createdAt: (r.created_at as string) || undefined,
    updatedAt: (r.updated_at as string) || undefined,
  }
}

/** All recitation sessions (admin/teacher console). TABLE_MISSING when not migrated yet. */
export async function fetchAllRecitationSessions(): Promise<{ data: RecitationSession[]; error?: string }> {
  if (!isSupabaseConfigured()) return { data: [] }
  const { data, error } = await supabase
    .from("recitation_sessions")
    .select("*")
    .order("session_date", { ascending: true })
  if (error) {
    if (error.code === "42P01") return { data: [], error: "TABLE_MISSING" }
    return { data: [], error: error.message }
  }
  return { data: (data || []).map(mapRecitationRow) }
}

/** Recitation sessions for one class, oldest → newest. */
export async function fetchRecitationSessionsForClass(
  classId: string,
): Promise<{ data: RecitationSession[]; error?: string }> {
  const { data, error } = await supabase
    .from("recitation_sessions")
    .select("*")
    .eq("class_id", classId)
    .order("session_date", { ascending: true })
  if (error) {
    if (error.code === "42P01") return { data: [], error: "TABLE_MISSING" }
    return { data: [], error: error.message }
  }
  return { data: (data || []).map(mapRecitationRow) }
}

/** Recitation sessions for one student (used by the student/parent portal view). */
export async function fetchRecitationSessionsForStudent(
  studentId: string,
): Promise<{ data: RecitationSession[]; error?: string }> {
  const { data, error } = await supabase
    .from("recitation_sessions")
    .select("*")
    .eq("student_id", studentId)
    .order("session_date", { ascending: true })
  if (error) {
    if (error.code === "42P01") return { data: [], error: "TABLE_MISSING" }
    return { data: [], error: error.message }
  }
  return { data: (data || []).map(mapRecitationRow) }
}

/**
 * Upsert one assessment for a student on a date. The DB trigger recomputes
 * `total`, but we also send it so the value is correct even if the trigger
 * isn't present. Conflict target (student_id, session_date) → re-scoring the
 * same day overwrites that day's entry.
 */
export async function saveRecitationSession(s: {
  classId: string
  studentId: string
  date: string
  pronunciation: number
  tajweed: number
  style: number
  startStop: number
  notes?: string
  assessedBy?: string
  assessedById?: string
}): Promise<{ error?: string }> {
  const row = {
    class_id: s.classId,
    student_id: s.studentId,
    session_date: s.date,
    pronunciation: s.pronunciation,
    tajweed: s.tajweed,
    style: s.style,
    start_stop: s.startStop,
    total: recitationTotal(s),
    notes: s.notes?.trim() || null,
    assessed_by: s.assessedBy || null,
    assessed_by_id: s.assessedById || null,
  }
  const { error } = await supabase
    .from("recitation_sessions")
    .upsert(row, { onConflict: "student_id,session_date" })
  return { error: error?.message }
}

export async function deleteRecitationSession(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("recitation_sessions").delete().eq("id", id)
  return { error: error?.message }
}

// ── Period timetables ─────────────────────────────────────────────────────
// Shared storage for the period-wise timetable (subject + teacher per period,
// per class). Read by everyone; writes are admin-only (enforced by RLS in
// supabase/migrations/*_period_timetables.sql). If the table hasn't been
// migrated yet, these return null/error and the caller falls back to a local
// cache so the feature still works.

const PERIOD_TT_COLS =
  "class_id,bell_timetable_id,day,period_label,subject_id,subject_name,teacher_id,teacher_name,room,note"

type PeriodTtRow = {
  class_id: string
  bell_timetable_id: string
  day: string
  period_label: string
  subject_id: string | null
  subject_name: string | null
  teacher_id: string | null
  teacher_name: string | null
  room: string | null
  note: string | null
}

function mapPeriodTtRow(r: PeriodTtRow): PeriodAssignment {
  return {
    classId: r.class_id,
    bellTimetableId: r.bell_timetable_id,
    day: r.day,
    periodLabel: r.period_label,
    subjectId: r.subject_id ?? undefined,
    subjectName: r.subject_name ?? "",
    teacherId: r.teacher_id ?? undefined,
    teacherName: r.teacher_name ?? undefined,
    room: r.room ?? undefined,
    note: r.note ?? undefined,
  }
}

/** All saved period-timetable assignments across every class. Returns null when
 *  Supabase is unconfigured or the table isn't migrated yet (caller falls back). */
export async function fetchAllTimetables(): Promise<PeriodAssignment[] | null> {
  if (!isSupabaseConfigured()) return null
  const { data, error } = await supabase.from("period_timetables").select(PERIOD_TT_COLS)
  if (error) return null
  return (data as PeriodTtRow[] | null ?? []).map(mapPeriodTtRow)
}

/** One class's saved timetable, or null when unavailable (caller falls back). */
export async function fetchClassTimetable(classId: string): Promise<PeriodAssignment[] | null> {
  if (!isSupabaseConfigured()) return null
  const { data, error } = await supabase
    .from("period_timetables")
    .select(PERIOD_TT_COLS)
    .eq("class_id", classId)
  if (error) return null
  return (data as PeriodTtRow[] | null ?? []).map(mapPeriodTtRow)
}

/** Persist a class's timetable (admin-only via RLS). One row per period slot. */
export async function saveClassTimetableDB(
  classId: string,
  assignments: PeriodAssignment[],
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured()) return { error: "supabase-not-configured" }
  const rows = assignments.map((a) => ({
    class_id: classId,
    bell_timetable_id: a.bellTimetableId,
    day: a.day,
    period_label: a.periodLabel,
    subject_id: a.subjectId ?? null,
    subject_name: a.subjectName ?? "",
    teacher_id: a.teacherId ?? null,
    teacher_name: a.teacherName ?? null,
    room: a.room ?? null,
    note: a.note ?? null,
    updated_at: new Date().toISOString(),
  }))
  const { error } = await supabase
    .from("period_timetables")
    .upsert(rows, { onConflict: "class_id,day,period_label" })
  return { error: error?.message }
}

// ── EDU Support teacher subject+grade eligibility ──────────────────────────
// Each row = "this teacher MAY teach this subject in this grade". The auto-
// scheduler balances the actual period counts within these (see
// src/lib/edu-loadplan.ts). Stored in public.edu_teacher_subjects (migration
// 20260623000000_edu_teacher_subjects.sql). Returns null when Supabase is
// unconfigured or the table isn't migrated yet, so callers fall back to the
// canTeach-based default eligibility.
export interface EduAssignment { teacherId: string; gradeId: string; subject: string }

/** All saved EDU eligibility rows, or null when unavailable (caller falls back). */
export async function fetchEduAssignments(): Promise<EduAssignment[] | null> {
  if (!isSupabaseConfigured()) return null
  const { data, error } = await supabase
    .from("edu_teacher_subjects")
    .select("teacher_id,grade_id,subject")
  if (error) return null
  return (data as { teacher_id: string; grade_id: string; subject: string }[] | null ?? []).map(
    (r) => ({ teacherId: r.teacher_id, gradeId: r.grade_id, subject: r.subject }),
  )
}

/** Replace the full EDU eligibility matrix (admin-only via RLS). */
export async function saveEduAssignments(
  assignments: EduAssignment[],
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured()) return { error: "supabase-not-configured" }
  // Replace-all: clear the table, then insert the current ticks. Admin-gated by
  // RLS, so a non-admin's delete simply affects no rows.
  const del = await supabase.from("edu_teacher_subjects").delete().neq("teacher_id", "")
  if (del.error) return { error: del.error.message }
  if (assignments.length === 0) return {}
  const rows = assignments.map((a) => ({
    teacher_id: a.teacherId,
    grade_id: a.gradeId,
    subject: a.subject,
    updated_at: new Date().toISOString(),
  }))
  const { error } = await supabase.from("edu_teacher_subjects").insert(rows)
  return { error: error?.message }
}

// ══════════════════════════════════════════════════════════════════════
// Daily Office Routine
// One report per office-staff member (role=accountant) per day, plus child
// records for finance, per-course duties, weekly reels/boost, attendance &
// assignment follow-up. Admins review all. See migration
// 20260628000000_office_daily_routine.sql.
// ══════════════════════════════════════════════════════════════════════

export type OfficeReportStatus = "draft" | "submitted" | "locked"

export interface OfficeFinanceEntry {
  id?: string
  type: "income" | "expense"
  amount: number
  category?: string
  description?: string
  remarks?: string
}

// ── Shared, institute-wide daily income/expenditure ledger ──────────────────
// Day-scoped (NOT per staff report) so the day's finance is a single source of
// truth that admin + accountant both add to, with attribution. Backed by
// public.office_finance_ledger (migration 20260630120000).
export interface OfficeFinanceLedgerEntry {
  id?: string
  entryDate: string
  type: "income" | "expense"
  amount: number
  category?: string
  remarks?: string
  createdBy?: string | null
  createdByName?: string
  createdAt?: string
}

export async function fetchOfficeFinanceLedger(date: string): Promise<OfficeFinanceLedgerEntry[]> {
  if (!isSupabaseConfigured()) return []
  const { data, error } = await supabase
    .from("office_finance_ledger")
    .select("*")
    .eq("entry_date", date)
    .order("created_at", { ascending: true })
  if (error || !data) return []
  return data.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    entryDate: (r.entry_date as string).split("T")[0],
    type: r.type as "income" | "expense",
    amount: Number(r.amount) || 0,
    category: (r.category as string) || undefined,
    remarks: (r.remarks as string) || undefined,
    createdBy: (r.created_by as string) ?? null,
    createdByName: (r.created_by_name as string) || undefined,
    createdAt: (r.created_at as string) || undefined,
  }))
}

export async function addOfficeFinanceLedgerEntry(entry: {
  entryDate: string
  type: "income" | "expense"
  amount: number
  category?: string
  remarks?: string
  createdBy: string
  createdByName?: string
}): Promise<{ error?: string; id?: string }> {
  if (!isSupabaseConfigured()) return { error: "supabase-not-configured" }
  const { data, error } = await supabase
    .from("office_finance_ledger")
    .insert({
      entry_date: entry.entryDate,
      type: entry.type,
      amount: entry.amount,
      category: entry.category || null,
      remarks: entry.remarks || null,
      created_by: entry.createdBy,
      created_by_name: entry.createdByName || null,
    })
    .select("id")
    .single()
  if (error) return { error: error.message }
  return { id: data?.id as string }
}

export async function deleteOfficeFinanceLedgerEntry(id: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured()) return { error: "supabase-not-configured" }
  const { error } = await supabase.from("office_finance_ledger").delete().eq("id", id)
  return { error: error?.message }
}

export interface OfficeDutyItem {
  id?: string
  courseId: string
  dutyLabel: string
  isDone: boolean
  remarks?: string
}

export interface OfficeReelItem {
  id?: string
  weekStartDate: string
  reelNumber: 1 | 2 | 3
  isPrepared: boolean
  notes?: string
}

export interface OfficeReelBoost {
  id?: string
  weekStartDate: string
  isBoosted: boolean
  instagramUrl?: string
}

export interface OfficeAttendanceFollowupRow {
  id?: string
  classId: string
  lateStudents: { studentId?: string; name: string; reason?: string }[]
  absentStudents: { studentId?: string; name: string; reason?: string }[]
}

export interface OfficeAssignmentFollowupRow {
  id?: string
  classId: string
  teacherId?: string
  assignmentForwarded: boolean
  remarks?: string
}

export interface OfficeDailyReport {
  id: string
  staffId: string
  reportDate: string
  status: OfficeReportStatus
  submittedAt?: string | null
  lockedAt?: string | null
  finance: OfficeFinanceEntry[]
  duties: OfficeDutyItem[]
  reels: OfficeReelItem[]
  boost: OfficeReelBoost | null
  attendance: OfficeAttendanceFollowupRow[]
  assignments: OfficeAssignmentFollowupRow[]
}

export interface OfficeReportSummary {
  id: string
  staffId: string
  reportDate: string
  status: OfficeReportStatus
  submittedAt?: string | null
}

/** Fetch (without children) recent office reports for the admin review list. */
export async function fetchOfficeReports(limit = 60): Promise<OfficeReportSummary[]> {
  const { data, error } = await supabase
    .from("office_daily_reports")
    .select("id, staff_id, report_date, status, submitted_at")
    .order("report_date", { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    staffId: r.staff_id as string,
    reportDate: (r.report_date as string).split("T")[0],
    status: r.status as OfficeReportStatus,
    submittedAt: (r.submitted_at as string) ?? null,
  }))
}

/** Load (or, if missing, return null for) one office report with all children. */
export async function fetchOfficeReport(
  staffId: string,
  date: string,
): Promise<OfficeDailyReport | null> {
  const { data: head, error } = await supabase
    .from("office_daily_reports")
    .select("*")
    .eq("staff_id", staffId)
    .eq("report_date", date)
    .maybeSingle()
  if (error || !head) return null
  return hydrateOfficeReport(head as Record<string, unknown>)
}

/** Load one office report by id with all children (admin review drill-in). */
export async function fetchOfficeReportById(id: string): Promise<OfficeDailyReport | null> {
  const { data: head, error } = await supabase
    .from("office_daily_reports")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error || !head) return null
  return hydrateOfficeReport(head as Record<string, unknown>)
}

async function hydrateOfficeReport(head: Record<string, unknown>): Promise<OfficeDailyReport> {
  const id = head.id as string
  const [fin, duty, reels, boost, attend, assign] = await Promise.all([
    supabase.from("office_finance_entries").select("*").eq("report_id", id),
    supabase.from("office_duty_checklist").select("*").eq("report_id", id),
    supabase.from("office_reels_checklist").select("*").eq("report_id", id),
    supabase.from("office_reel_boost").select("*").eq("report_id", id).maybeSingle(),
    supabase.from("office_attendance_followup").select("*").eq("report_id", id),
    supabase.from("office_assignment_followup").select("*").eq("report_id", id),
  ])
  const b = boost.data as Record<string, unknown> | null
  return {
    id,
    staffId: head.staff_id as string,
    reportDate: (head.report_date as string).split("T")[0],
    status: head.status as OfficeReportStatus,
    submittedAt: (head.submitted_at as string) ?? null,
    lockedAt: (head.locked_at as string) ?? null,
    finance: (fin.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      type: r.type as "income" | "expense",
      amount: Number(r.amount) || 0,
      category: (r.category as string) || undefined,
      description: (r.description as string) || undefined,
      remarks: (r.remarks as string) || undefined,
    })),
    duties: (duty.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      courseId: r.course_id as string,
      dutyLabel: r.duty_label as string,
      isDone: !!r.is_done,
      remarks: (r.remarks as string) || undefined,
    })),
    reels: (reels.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      weekStartDate: (r.week_start_date as string).split("T")[0],
      reelNumber: r.reel_number as 1 | 2 | 3,
      isPrepared: !!r.is_prepared,
      notes: (r.notes as string) || undefined,
    })),
    boost: b
      ? {
          id: b.id as string,
          weekStartDate: (b.week_start_date as string).split("T")[0],
          isBoosted: !!b.is_boosted,
          instagramUrl: (b.instagram_url as string) || undefined,
        }
      : null,
    attendance: (attend.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      classId: r.class_id as string,
      lateStudents: (r.late_students as OfficeAttendanceFollowupRow["lateStudents"]) ?? [],
      absentStudents: (r.absent_students as OfficeAttendanceFollowupRow["absentStudents"]) ?? [],
    })),
    assignments: (assign.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      classId: r.class_id as string,
      teacherId: (r.teacher_id as string) || undefined,
      assignmentForwarded: !!r.assignment_forwarded,
      remarks: (r.remarks as string) || undefined,
    })),
  }
}

/** Create the day's report row if it doesn't exist yet; returns its id. */
export async function ensureOfficeReport(staffId: string, date: string): Promise<string | null> {
  const existing = await supabase
    .from("office_daily_reports")
    .select("id")
    .eq("staff_id", staffId)
    .eq("report_date", date)
    .maybeSingle()
  if (existing.data?.id) return existing.data.id as string
  const { data, error } = await supabase
    .from("office_daily_reports")
    .insert({ staff_id: staffId, report_date: date })
    .select("id")
    .single()
  if (error || !data) return null
  return data.id as string
}

/**
 * Replace-all save of every section of a report. The parent row is upserted and
 * children are cleared then re-inserted, mirroring the staff-attendance/edu
 * patterns elsewhere in this file.
 */
export async function saveOfficeReport(
  report: Omit<OfficeDailyReport, "id" | "lockedAt"> & { id?: string },
): Promise<{ error?: string; id?: string }> {
  if (!isSupabaseConfigured()) return { error: "supabase-not-configured" }

  const id = report.id || (await ensureOfficeReport(report.staffId, report.reportDate))
  if (!id) return { error: "Could not create the report row." }

  const headUpdate = await supabase
    .from("office_daily_reports")
    .update({
      status: report.status,
      submitted_at: report.status === "draft" ? null : new Date().toISOString(),
    })
    .eq("id", id)
  if (headUpdate.error) return { error: headUpdate.error.message }

  // Clear children
  await Promise.all([
    supabase.from("office_finance_entries").delete().eq("report_id", id),
    supabase.from("office_duty_checklist").delete().eq("report_id", id),
    supabase.from("office_reels_checklist").delete().eq("report_id", id),
    supabase.from("office_reel_boost").delete().eq("report_id", id),
    supabase.from("office_attendance_followup").delete().eq("report_id", id),
    supabase.from("office_assignment_followup").delete().eq("report_id", id),
  ])

  const inserts: PromiseLike<{ error: unknown }>[] = []

  if (report.finance.length) {
    inserts.push(
      supabase.from("office_finance_entries").insert(
        report.finance.map((f) => ({
          report_id: id,
          type: f.type,
          amount: f.amount,
          category: f.category || null,
          description: f.description || null,
          remarks: f.remarks || null,
        })),
      ),
    )
  }
  if (report.duties.length) {
    inserts.push(
      supabase.from("office_duty_checklist").insert(
        report.duties.map((d) => ({
          report_id: id,
          course_id: d.courseId,
          duty_label: d.dutyLabel,
          is_done: d.isDone,
          remarks: d.remarks || null,
        })),
      ),
    )
  }
  if (report.reels.length) {
    inserts.push(
      supabase.from("office_reels_checklist").insert(
        report.reels.map((r) => ({
          report_id: id,
          week_start_date: r.weekStartDate,
          reel_number: r.reelNumber,
          is_prepared: r.isPrepared,
          notes: r.notes || null,
        })),
      ),
    )
  }
  if (report.boost) {
    inserts.push(
      supabase.from("office_reel_boost").insert({
        report_id: id,
        week_start_date: report.boost.weekStartDate,
        is_boosted: report.boost.isBoosted,
        instagram_url: report.boost.instagramUrl || null,
      }),
    )
  }
  if (report.attendance.length) {
    inserts.push(
      supabase.from("office_attendance_followup").insert(
        report.attendance.map((a) => ({
          report_id: id,
          class_id: a.classId,
          late_students: a.lateStudents,
          absent_students: a.absentStudents,
        })),
      ),
    )
  }
  if (report.assignments.length) {
    inserts.push(
      supabase.from("office_assignment_followup").insert(
        report.assignments.map((a) => ({
          report_id: id,
          class_id: a.classId,
          teacher_id: a.teacherId || null,
          assignment_forwarded: a.assignmentForwarded,
          remarks: a.remarks || null,
        })),
      ),
    )
  }

  const results = await Promise.all(inserts)
  const failed = results.find((r) => (r as { error?: unknown })?.error)
  if (failed) return { error: ((failed as { error?: { message?: string } }).error)?.message || "save failed" }
  return { id }
}

/** Admin-only: lock a submitted report so it becomes a read-only record. */
export async function lockOfficeReport(id: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("office_daily_reports")
    .update({ status: "locked", locked_at: new Date().toISOString() })
    .eq("id", id)
  return { error: error?.message }
}

// ── Lesson-plan / PPT submissions (item 9) ────────────────────────────
export interface LessonPlanSubmission {
  id: string
  submissionCode: string
  teacherId?: string | null
  teacherName?: string
  teacherEmail?: string
  courseId?: string
  classId?: string
  grade?: string
  subject: string
  weekDate: string
  lessonPlanName?: string
  lessonPlanUrl?: string
  lessonPlanPath?: string
  pptName?: string
  pptUrl?: string
  pptPath?: string
  status: "submitted" | "partial" | "failed"
  createdAt: string
}

/** List lesson-plan submissions, optionally for a given week (Mon ISO date). */
export async function fetchLessonPlanSubmissions(
  weekStart?: string,
  weekEnd?: string,
): Promise<LessonPlanSubmission[]> {
  let q = supabase.from("lesson_plan_submissions").select("*").order("created_at", { ascending: false })
  if (weekStart) q = q.gte("week_date", weekStart)
  if (weekEnd) q = q.lte("week_date", weekEnd)
  const { data, error } = await q
  if (error || !data) return []
  return data.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    submissionCode: r.submission_code as string,
    teacherId: (r.teacher_id as string) ?? null,
    teacherName: (r.teacher_name as string) || undefined,
    teacherEmail: (r.teacher_email as string) || undefined,
    courseId: (r.course_id as string) || undefined,
    classId: (r.class_id as string) || undefined,
    grade: (r.grade as string) || undefined,
    subject: r.subject as string,
    weekDate: (r.week_date as string).split("T")[0],
    lessonPlanName: (r.lesson_plan_name as string) || undefined,
    lessonPlanUrl: (r.lesson_plan_url as string) || undefined,
    lessonPlanPath: (r.lesson_plan_path as string) || undefined,
    pptName: (r.ppt_name as string) || undefined,
    pptUrl: (r.ppt_url as string) || undefined,
    pptPath: (r.ppt_path as string) || undefined,
    status: r.status as "submitted" | "partial" | "failed",
    createdAt: r.created_at as string,
  }))
}

// ── Staff punches for a single day (office-routine item 1 & 10) ───────
// Reads the processed staff_attendance rows incl. departure_time / out_missing
// so office staff can fill in a forgotten punch-out, and so missing-punch staff
// can be surfaced. Writing departure_time here is the legitimate "add the
// forgotten out time" action; payroll re-derivation stays the admin's job via
// the existing reprocess-punches flow.
export interface StaffPunchToday {
  teacherId: string
  date: string
  session: string
  status: string
  arrivalTime?: string
  departureTime?: string
  outMissing: boolean
}

export async function fetchStaffPunchesForDate(date: string): Promise<StaffPunchToday[]> {
  const run = (cols: string) =>
    supabase.from("staff_attendance").select(cols).eq("date", date)
  let resp = await run("teacher_id, date, session, status, arrival_time, departure_time, out_missing")
  if (resp.error) resp = await run("teacher_id, date, session, status, arrival_time")
  const { data, error } = resp
  if (error || !data) return []
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    teacherId: r.teacher_id as string,
    date: (r.date as string).split("T")[0],
    session: (r.session as string) || "full",
    status: (r.status as string) || "present",
    arrivalTime: (r.arrival_time as string) || undefined,
    departureTime: (r.departure_time as string) || undefined,
    outMissing: !!r.out_missing,
  }))
}

export async function updateStaffPunchOut(
  teacherId: string,
  date: string,
  session: string,
  departureTime: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("staff_attendance")
    .update({ departure_time: departureTime, out_missing: false })
    .eq("teacher_id", teacherId)
    .eq("date", date)
    .eq("session", session)
  return { error: error?.message }
}

// ── Online self check-in verification (admin/accountant) ──────────────────
// verified_by/verified_at come from migration 20260707000000_online_self_checkin.sql.
// A 42703 (column missing) means the migration hasn't been run yet.

function missingVerifyColumns(error: { code?: string; message: string } | null): boolean {
  return !!error && (error.code === "42703" || /verified_(by|at)/.test(error.message))
}

const RUN_MIGRATION_MSG =
  "Verification columns missing — run the online self check-in migration (20260707000000) in the Supabase SQL editor"

/** Mark all of a teacher's ONLINE records on a date as verified. */
export async function verifyStaffAttendanceDay(
  teacherId: string,
  date: string,
  verifiedBy: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("staff_attendance")
    .update({ verified_by: verifiedBy, verified_at: new Date().toISOString() })
    .eq("teacher_id", teacherId)
    .eq("date", date)
    .eq("session_type", "online")
  if (missingVerifyColumns(error)) return { error: RUN_MIGRATION_MSG }
  return { error: error?.message }
}

/**
 * Admin override of a single attendance record (online self check-ins).
 * Keyed by (teacher_id, date, session) like updateStaffPunchOut; also stamps
 * verified_by/verified_at since an explicit admin edit implies review.
 */
export async function adminOverrideStaffAttendance(patch: {
  teacherId: string
  date: string
  session: string
  arrivalTime?: string | null
  departureTime?: string | null
  status?: "present" | "absent" | "late"
  sessionsCredited?: number
  verifiedBy: string
}): Promise<{ error?: string }> {
  const values: Record<string, unknown> = {
    verified_by: patch.verifiedBy,
    verified_at: new Date().toISOString(),
  }
  if (patch.arrivalTime !== undefined) values.arrival_time = patch.arrivalTime
  if (patch.departureTime !== undefined) {
    values.departure_time = patch.departureTime
    if (patch.departureTime) values.out_missing = false
  }
  if (patch.status !== undefined) values.status = patch.status
  if (patch.sessionsCredited !== undefined) values.sessions_credited = patch.sessionsCredited

  const { error } = await supabase
    .from("staff_attendance")
    .update(values)
    .eq("teacher_id", patch.teacherId)
    .eq("date", patch.date)
    .eq("session", patch.session)
  if (missingVerifyColumns(error)) return { error: RUN_MIGRATION_MSG }
  return { error: error?.message }
}

// ── Session proofs (online months) ──────────────────────────────────────────
// Evidence a teacher attaches to an online class session — screenshot in the
// private 'session-proofs' bucket and/or Meet link. Table comes from migration
// 20260708000000_session_proofs.sql; writes go through /api/session-proofs,
// reads use the staff SELECT policy directly.

export interface SessionProofEntry {
  id: string
  teacherId: string
  date: string
  session: string
  storagePath: string | null
  meetLink: string | null
  note: string | null
  classLabel: string | null
  studentsPresent: number | null
  uploadedBy: string
  createdAt: string
  /** Drive webViewLink of the mirrored screenshot (null = not mirrored). */
  driveLink: string | null
}

function mapSessionProof(r: Record<string, unknown>): SessionProofEntry {
  return {
    id: r.id as string,
    teacherId: r.teacher_id as string,
    date: (r.date as string).split("T")[0],
    session: r.session as string,
    storagePath: (r.storage_path as string | null) ?? null,
    meetLink: (r.meet_link as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    classLabel: (r.class_label as string | null) ?? null,
    studentsPresent: (r.students_present as number | null) ?? null,
    uploadedBy: r.uploaded_by as string,
    createdAt: r.created_at as string,
    driveLink: (r.drive_link as string | null) ?? null,
  }
}

/** All proofs in a month — feeds the Staff Attendance grid indicators. */
export async function fetchSessionProofs(month: string): Promise<{ data: SessionProofEntry[]; error?: string }> {
  const startDate = `${month}-01`
  const [y, m] = month.split("-").map(Number)
  const endDate = `${y}-${String(m).padStart(2, "0")}-${new Date(y, m, 0).getDate()}`

  const { data, error } = await supabase
    .from("session_proofs")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate)
    .order("created_at")
  if (error) {
    // 42P01 = table missing (migration not run yet) — treat as "no proofs".
    if (error.code === "42P01") return { data: [] }
    return { data: [], error: error.message }
  }
  return { data: (data ?? []).map(mapSessionProof) }
}

/** Proofs for one teacher's day — feeds the verify dialog and the teacher card. */
export async function fetchSessionProofsForDay(
  teacherId: string,
  date: string,
): Promise<{ data: SessionProofEntry[]; error?: string }> {
  const { data, error } = await supabase
    .from("session_proofs")
    .select("*")
    .eq("teacher_id", teacherId)
    .eq("date", date)
    .order("created_at")
  if (error) {
    if (error.code === "42P01") return { data: [] }
    return { data: [], error: error.message }
  }
  return { data: (data ?? []).map(mapSessionProof) }
}
