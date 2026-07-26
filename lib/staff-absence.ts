// ╔══════════════════════════════════════════════════════════════════╗
// ║ Fixed-salary staff absence rules                                   ║
// ╠══════════════════════════════════════════════════════════════════╣
// ║ Absences for "no punch at all" days are NOT stored in the database ║
// ║ — they are synthesised at display time. This module centralises:   ║
// ║   1. which pay types are fixed-salary (paid regardless of punches),║
// ║   2. which sessions each is expected to work on a calendar date,   ║
// ║   3. WHERE an absence should surface — Staff Attendance grid/report ║
// ║      versus Punch data (today widget + Staff Punch Report).        ║
// ║                                                                    ║
// ║ Visibility policy:                                                 ║
// ║   • Fixed-salary staff absent on a working day                     ║
// ║       → shown in Attendance AND Punch data.                        ║
// ║   • Cleaning staff (the cleaning staff)                                        ║
// ║       → shown in Attendance + its report ONLY, never Punch data.   ║
// ║   • Office (the office staff) Monday & Friday morning session        ║
// ║       → not a worked session, so its absence is suppressed in      ║
// ║         BOTH Attendance and Punch data (the evening session still  ║
// ║         counts on those days).                                     ║
// ╚══════════════════════════════════════════════════════════════════╝

import type { TeacherPayType } from "@/data/courses"

// Pay types paid a fixed monthly salary regardless of daily attendance.
// Drivers (daily-driver) and teachers (per-session/per-day) are excluded.
export const FIXED_SALARY_PAY_TYPES: ReadonlySet<TeacherPayType> = new Set<TeacherPayType>([
  "monthly-office",
  "monthly-cleaning",
  "monthly-edu-support",
])

export function isFixedSalaryPayType(payType: string | null | undefined): boolean {
  return !!payType && FIXED_SALARY_PAY_TYPES.has(payType as TeacherPayType)
}

// A working session a fixed-salary staff member is expected to attend.
export interface ExpectedSession {
  // staff_attendance.session value a present/late punch for this session is
  // stored under. Office S1 and all single-duty staff use "morning"; office
  // S2 uses "evening".
  recordSession: "morning" | "evening"
  // Short human label ("Session 1", "Session 2", "Normal Duty", "EDU Support").
  label: string
  // Punch-data grouping bucket.
  program: "EDU Support" | "Non-Teaching Staff"
  // Role column for non-teaching staff ("Office", "Cleaning", "").
  role: string
  // Surface an absence here in the Staff Attendance grid + report.
  showInAttendance: boolean
  // Surface an absence here in Punch data (today widget + Staff Punch Report).
  showInPunchData: boolean
}

// Day-of-week (0=Sun … 6=Sat) for a YYYY-MM-DD string, midday-anchored to avoid
// timezone roll-over. Returns NaN for a malformed date.
function dayOfWeek(date: string): number {
  return new Date(date + "T12:00:00").getDay()
}

// Sessions a fixed-salary staff member is expected to work on `date`.
// Empty array → not fixed-salary, or no working session that day (no absence).
export function expectedSessions(payType: string, date: string): ExpectedSession[] {
  const dow = dayOfWeek(date)
  if (Number.isNaN(dow)) return []

  switch (payType) {
    case "monthly-edu-support": {
      // EDU Support: Monday–Friday, single daily duty (weekend make-up is optional).
      if (dow < 1 || dow > 5) return []
      return [{
        recordSession: "morning", label: "EDU Support",
        program: "EDU Support", role: "",
        showInAttendance: true, showInPunchData: true,
      }]
    }
    case "monthly-office": {
      // the office staff: two sessions every day — EXCEPT the morning (Session 1)
      // is NOT worked on Monday or Friday, so it is dropped entirely (its
      // absence never surfaces). The evening session (Session 2) is worked
      // every day of the week.
      const sessions: ExpectedSession[] = []
      const isMon = dow === 1
      const isFri = dow === 5
      if (!isMon && !isFri) {
        sessions.push({
          recordSession: "morning", label: "Session 1",
          program: "Non-Teaching Staff", role: "Office",
          showInAttendance: true, showInPunchData: true,
        })
      }
      sessions.push({
        recordSession: "evening", label: "Session 2",
        program: "Non-Teaching Staff", role: "Office",
        showInAttendance: true, showInPunchData: true,
      })
      return sessions
    }
    case "monthly-cleaning": {
      // the cleaning staff: works every day, single daily duty. Absence surfaces ONLY in the
      // attendance grid + report — never in punch data.
      return [{
        recordSession: "morning", label: "Normal Duty",
        program: "Non-Teaching Staff", role: "Cleaning",
        showInAttendance: true, showInPunchData: false,
      }]
    }
    default:
      return []
  }
}

// True when the staff member has at least one working session on `date` whose
// absence should surface in the Staff Attendance grid.
export function isAttendanceWorkingDay(payType: string, date: string): boolean {
  return expectedSessions(payType, date).some((s) => s.showInAttendance)
}

// Working sessions whose absence should surface in punch data (today widget +
// Staff Punch Report). Empty for cleaning and for non-fixed-salary staff.
export function punchDataAbsenceSessions(payType: string, date: string): ExpectedSession[] {
  return expectedSessions(payType, date).filter((s) => s.showInPunchData)
}
