// EDU Support weekly timetable — Grades 1–5 (the 5th is "Grade 5 & 6" combined),
// Monday–Thursday 5 periods, Friday 3 periods = 23 teaching periods/week per
// grade. Teachers are SUBJECT SPECIALISTS shared across grades (not one teacher
// per grade), so generation is global and must avoid teacher clashes — see
// src/lib/edu-scheduler.ts.
//
// Self-contained config (does not touch courses.ts); persists to the shared
// `period_timetables` table via the grade ids below.
//
// Pure module — no React, no network.

import type { PeriodAssignment } from "@/data/period-timetable"

export const EDU_BELL_TIMETABLE_ID = "edu-support-weekly"

export const EDU_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const
export type EduDay = (typeof EDU_DAYS)[number]

export interface EduPeriod { label: string; start: string; end: string }

// Up to 5 teaching periods/day; recess sits between Period 2 and Period 3.
export const EDU_PERIODS: EduPeriod[] = [
  { label: "Period 1", start: "09:00", end: "09:45" },
  { label: "Period 2", start: "09:45", end: "10:30" },
  { label: "Period 3", start: "10:45", end: "11:30" },
  { label: "Period 4", start: "11:30", end: "12:15" },
  { label: "Period 5", start: "12:15", end: "13:00" },
]
export const EDU_RECESS = { label: "RECESS", start: "10:30", end: "10:45" }

// Friday is a short day — only the first 3 periods run.
export const FRIDAY_PERIOD_COUNT = 3
export function periodsForDay(day: string): EduPeriod[] {
  return day === "Friday" ? EDU_PERIODS.slice(0, FRIDAY_PERIOD_COUNT) : EDU_PERIODS
}

export interface EduSlot { day: EduDay; label: string; start: string; end: string }
// All 23 teaching slots in reading order (Mon–Thu ×5, Fri ×3).
export const EDU_SLOTS: EduSlot[] = EDU_DAYS.flatMap((day) =>
  periodsForDay(day).map((p) => ({ day, label: p.label, start: p.start, end: p.end })),
)
export const TOTAL_SLOTS = EDU_SLOTS.length // 23

// Subjects with short codes used in the grid.
export const EDU_SUBJECTS = [
  { id: "eng", name: "English", code: "ENG" },
  { id: "math", name: "Maths", code: "MATH" },
  { id: "sci", name: "Science", code: "SCI" },
  { id: "arb", name: "Arabic", code: "ARB" },
] as const

export function subjectCode(name: string): string {
  return EDU_SUBJECTS.find((s) => s.name === name)?.code ?? name
}
export function subjectId(name: string): string | undefined {
  return EDU_SUBJECTS.find((s) => s.name === name)?.id
}

// Per-grade weekly demand (same for every grade): 23 periods.
export const SUBJECTS_PER_WEEK: Record<string, number> = {
  English: 7, Maths: 7, Science: 7, Arabic: 2,
}

export interface EduGrade { id: string; name: string; short: string }
export const EDU_GRADES: EduGrade[] = [
  { id: "edu-1a", name: "Grade 1", short: "1A" },
  { id: "edu-2a", name: "Grade 2", short: "2A" },
  { id: "edu-3a", name: "Grade 3", short: "3A" },
  { id: "edu-4a", name: "Grade 4", short: "4A" },
  { id: "edu-56a", name: "Grade 5 & 6", short: "5&6" },
]
export function eduGradeById(id: string): EduGrade | undefined {
  return EDU_GRADES.find((g) => g.id === id)
}

export interface EduTeacher {
  id: string
  name: string
  canTeach: string[]
}
// Teacher ids match initialTeachers in courses.ts.
// Intentionally EMPTY — populate with your own EDU-support teachers.
export const EDU_TEACHERS: EduTeacher[] = []
export function eduTeacherById(id: string): EduTeacher | undefined {
  return EDU_TEACHERS.find((t) => t.id === id)
}

// NOTE: the teacher → subject weekly load is no longer a hand-built constant.
// It is derived automatically by the free solver in src/lib/edu-loadplan.ts
// (deriveBreakdown) from each teacher's `canTeach` + the per-grade demand, so
// adding/removing a teacher or changing a quota re-balances with no code edits.

/** Count how many periods each subject has in a set of assignments. */
export function countSubjects(assignments: PeriodAssignment[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const a of assignments) {
    const name = a.subjectName?.trim()
    if (name) out[name] = (out[name] ?? 0) + 1
  }
  return out
}

/** Blank weekly timetable for a grade — one empty slot per teaching period. */
export function buildEmptyWeekly(gradeId: string): PeriodAssignment[] {
  return EDU_SLOTS.map((s) => ({
    classId: gradeId,
    bellTimetableId: EDU_BELL_TIMETABLE_ID,
    day: s.day,
    periodLabel: s.label,
    subjectName: "",
  }))
}
