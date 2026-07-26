// Pure planner for the ONLINE self check-in punch (July/August online months).
//
// A tap on the Check In / Check Out button is treated as a "virtual punch":
// the server derives UAE time, calls classifyPunch (the single source of
// window/late-tier truth shared with the ZKTeco device route), and this module
// maps the resulting PunchAction + today's existing records to exactly one
// database operation. The write semantics mirror the device route in
// src/app/api/zk-attendance/route.ts branch-by-branch — if you change a rule
// there, change it here too (the unit tests in online-checkin.test.ts pin the
// parity).
//
// Deltas vs the device route, by design:
//   • every insert carries session_type: "online"
//   • remarks say who self-checked-in ("Self check-in (online) by <email>")
//   • classifyPunch "skip" results become op:"reject" with the same reason
//     so the UI can explain why nothing was recorded.
// This module never writes verified_by/verified_at — admin verification is a
// separate step in the Staff Attendance grid.

import {
  classifyPunch,
  officeS1Thresholds,
  officeS2Thresholds,
  type ClassifyPunchInput,
} from "@/lib/punch-routing"

export interface TodayRecord {
  id: number
  session: string
  arrival_time: string | null
  departure_time: string | null
  sessions_credited: number | null
  out_missing: boolean | null
}

export type PunchPlan =
  | { op: "reject"; reason: string }
  | { op: "insert"; values: Record<string, unknown>; message: string }
  | { op: "update"; recordId: number; values: Record<string, unknown>; message: string }

export interface PlanOnlinePunchInput {
  punchDate: string // "YYYY-MM-DD" — server-derived UAE date
  punchTime: string // "HH:MM" 24h  — server-derived UAE time
  teacher: { id: string; transportAllowance: boolean }
  flags: Omit<ClassifyPunchInput, "punchTime" | "punchDate" | "hasMorningPunchToday">
  todayRecords: TodayRecord[]
  actorEmail: string
}

export function planOnlinePunch(input: PlanOnlinePunchInput): PunchPlan {
  const { punchDate, punchTime, teacher, flags, todayRecords, actorEmail } = input

  const hasMorningPunchToday = todayRecords.some((r) => r.session === "morning")

  const action = classifyPunch({
    punchTime,
    punchDate,
    ...flags,
    hasMorningPunchToday,
  })

  if (action.kind === "skip") return { op: "reject", reason: action.reason }

  const remarks = `Self check-in (online) by ${actorEmail}`
  // Columns every fresh arrival insert shares (mirrors the device route).
  const insertBase = {
    teacher_id: teacher.id,
    date: punchDate,
    session_type: "online",
    transport_allowance: false,
  }
  const findSession = (session: string) => todayRecords.find((r) => r.session === session)

  const [ph, pm] = punchTime.split(":").map(Number)
  const pmins = ph * 60 + pm

  // ── Ihlamudheen morning arrival (Sat/Sun 06:00–10:30) ─────────────────────────
  if (action.kind === "madrasa-arrival") {
    const existing = findSession("morning")
    if (existing) {
      // Second tap inside the morning window → record departure
      return {
        op: "update",
        recordId: existing.id,
        values: { departure_time: punchTime },
        message: "Checked out (morning window)",
      }
    }
    return {
      op: "insert",
      values: {
        ...insertBase,
        session: "morning",
        status: action.status,
        late_category: action.lateCategory,
        arrival_time: punchTime,
        departure_time: null,
        sessions_credited: 1, // updated to 2 on a 13:00+ check-out
        early_departure_category: null,
        out_missing: true,
        remarks,
      },
      message: action.status === "late" ? `Checked in — late Cat-${action.lateCategory}` : "Checked in",
    }
  }

  // ── Ihlamudheen afternoon-only arrival (Sat/Sun 10:31–10:59) ──────────────────
  if (action.kind === "madrasa-afternoon-arrival") {
    if (findSession("morning")) {
      return { op: "reject", reason: "Afternoon arrival skipped — morning session already recorded" }
    }
    return {
      op: "insert",
      values: {
        ...insertBase,
        session: "morning",
        status: "present",
        late_category: null,
        arrival_time: punchTime,
        departure_time: null,
        sessions_credited: 1,
        early_departure_category: null,
        out_missing: true,
        remarks: `${remarks} (afternoon-only arrival)`,
      },
      message: "Checked in (afternoon session)",
    }
  }

  // ── Ihlamudheen OUT / departure (Sat/Sun 11:00–16:00) ─────────────────────────
  if (action.kind === "madrasa-out") {
    const morningRecord = findSession("morning")
    if (morningRecord) {
      return {
        op: "update",
        recordId: morningRecord.id,
        values: {
          departure_time: punchTime,
          sessions_credited: action.sessionsCredited,
          early_departure_category: action.earlyDepartureCategory,
          out_missing: false,
        },
        message: `Checked out — ${action.sessionsCredited} session${action.sessionsCredited > 1 ? "s" : ""} credited`,
      }
    }

    // No morning record. 11:00–11:30 is ambiguous → treat as afternoon arrival.
    if (pmins <= 11 * 60 + 30) {
      return {
        op: "insert",
        values: {
          ...insertBase,
          session: "morning",
          status: "present",
          late_category: null,
          arrival_time: punchTime,
          departure_time: null,
          sessions_credited: 1,
          early_departure_category: null,
          out_missing: true,
          remarks: `${remarks} (afternoon arrival, 11:00–11:30 zone)`,
        },
        message: "Checked in (afternoon session)",
      }
    }

    // 11:31–16:00 with no prior check-in: store as departure-only.
    // SESSIONS RULE mirrors the device route: without a verified IN only 1
    // session is credited — EXCEPT transport-allowance teachers, who keep the
    // classifier's full-day credit.
    const hasTA = teacher.transportAllowance === true
    const creditedSessions = hasTA ? action.sessionsCredited : 1
    const creditedEarlyDep = hasTA ? action.earlyDepartureCategory : null
    return {
      op: "insert",
      values: {
        ...insertBase,
        session: "morning",
        status: "present",
        late_category: null,
        arrival_time: null,
        departure_time: punchTime,
        sessions_credited: creditedSessions,
        early_departure_category: creditedEarlyDep,
        out_missing: false,
        remarks: `${remarks} (OUT only — no prior check-in)`,
      },
      message: "Checked out — no prior check-in recorded today",
    }
  }

  // ── EDU Support arrival (Mon–Fri 06:00–10:30) ───────────────────────────
  if (action.kind === "edu-arrival") {
    const existing = findSession("morning")
    if (existing) {
      return {
        op: "update",
        recordId: existing.id,
        values: { departure_time: punchTime },
        message: "Checked out",
      }
    }
    const lateCategory = action.status === "late" ? 1 : null
    return {
      op: "insert",
      values: {
        ...insertBase,
        session: "morning",
        status: action.status,
        late_category: lateCategory,
        arrival_time: punchTime,
        departure_time: null,
        sessions_credited: 1,
        early_departure_category: null,
        out_missing: true,
        remarks,
      },
      message: action.status === "late" ? "Checked in — late" : "Checked in",
    }
  }

  // ── EDU Support departure ───────────────────────────────────────────────
  if (action.kind === "edu-departure") {
    const morningRec = findSession("morning")
    if (morningRec) {
      return {
        op: "update",
        recordId: morningRec.id,
        values: { departure_time: punchTime, out_missing: false },
        message: "Checked out",
      }
    }
    // Forgot to check in — create the arrival now so a later tap can close it.
    return {
      op: "insert",
      values: {
        ...insertBase,
        session: "morning",
        status: "present",
        late_category: null,
        arrival_time: punchTime,
        departure_time: null,
        sessions_credited: 1,
        early_departure_category: null,
        out_missing: true,
        remarks,
      },
      message: "Checked in (no earlier check-in found today)",
    }
  }

  // ── EDU weekend makeup arrival (Sat/Sun 06:00–10:30) ────────────────────
  if (action.kind === "edu-makeup-arrival") {
    const existing = findSession("edu-makeup")
    if (existing) {
      return {
        op: "update",
        recordId: existing.id,
        values: { departure_time: punchTime },
        message: "Checked out (makeup)",
      }
    }
    const lateCategory = action.status === "late" ? 1 : null
    return {
      op: "insert",
      values: {
        ...insertBase,
        session: "edu-makeup",
        status: action.status,
        late_category: lateCategory,
        arrival_time: punchTime,
        departure_time: null,
        sessions_credited: 1,
        early_departure_category: null,
        out_missing: true,
        remarks: `${remarks} (EDU weekend makeup)`,
      },
      message: "Checked in (weekend makeup)",
    }
  }

  // ── EDU weekend makeup departure ────────────────────────────────────────
  if (action.kind === "edu-makeup-departure") {
    const makeupRec = findSession("edu-makeup")
    if (makeupRec) {
      return {
        op: "update",
        recordId: makeupRec.id,
        values: { departure_time: punchTime, out_missing: false },
        message: "Checked out (makeup)",
      }
    }
    return {
      op: "insert",
      values: {
        ...insertBase,
        session: "edu-makeup",
        status: "present",
        late_category: null,
        arrival_time: punchTime,
        departure_time: null,
        sessions_credited: 1,
        early_departure_category: null,
        out_missing: true,
        remarks: `${remarks} (EDU weekend makeup, arrival from OUT-window)`,
      },
      message: "Checked in (weekend makeup — no earlier check-in found)",
    }
  }

  // ── English arrival (Friday 14:00–17:00) ────────────────────────────────
  if (action.kind === "english-arrival") {
    const existing = findSession("evening")
    if (existing) {
      return {
        op: "update",
        recordId: existing.id,
        values: { departure_time: punchTime, out_missing: false },
        message: "Checked out (English)",
      }
    }
    const lateCategory = action.lateCategory ?? null
    const status = lateCategory !== null ? "late" : "present"
    return {
      op: "insert",
      values: {
        ...insertBase,
        session: "evening",
        status,
        late_category: lateCategory,
        arrival_time: punchTime,
        departure_time: null,
        sessions_credited: 1,
        early_departure_category: null,
        out_missing: true,
        remarks: `${remarks} (english)`,
      },
      message: lateCategory !== null ? `Checked in (English) — late Cat-${lateCategory}` : "Checked in (English)",
    }
  }

  // ── English departure / let-off (Friday 17:01–22:30) ────────────────────
  if (action.kind === "english-out") {
    const eveningRec = findSession("evening")
    if (eveningRec) {
      return {
        op: "update",
        recordId: eveningRec.id,
        values: {
          departure_time: punchTime,
          early_departure_category: action.earlyDepartureCategory,
          out_missing: false,
        },
        message: "Checked out (English)",
      }
    }
    // Dual-role let-off: only with a prior EDU morning punch (mirrors device rule
    // — English credit requires a physical/real action after 14:00, never auto).
    if (hasMorningPunchToday) {
      return {
        op: "insert",
        values: {
          ...insertBase,
          session: "evening",
          status: "present",
          late_category: null,
          arrival_time: null,
          departure_time: punchTime,
          sessions_credited: 1,
          early_departure_category: action.earlyDepartureCategory,
          out_missing: false,
          remarks: `${remarks} (english let-off, dual-role)`,
        },
        message: "Checked out (English let-off)",
      }
    }
    return { op: "reject", reason: "English let-off skipped — no prior EDU morning check-in and no English check-in" }
  }

  // ── CIBIS (Friday 17:00–22:00, first=IN second=OUT) ─────────────────────
  if (action.kind === "cibis-punch") {
    const cibisRec = findSession("cibis")
    if (cibisRec) {
      return {
        op: "update",
        recordId: cibisRec.id,
        values: { departure_time: punchTime, out_missing: false },
        message: "Checked out (CIBIS)",
      }
    }
    return {
      op: "insert",
      values: {
        ...insertBase,
        session: "cibis",
        status: "present",
        late_category: null,
        arrival_time: punchTime,
        departure_time: null,
        sessions_credited: 1,
        early_departure_category: null,
        out_missing: true,
        remarks: `${remarks} (cibis)`,
      },
      message: "Checked in (CIBIS)",
    }
  }

  // ── Office session 1 ─────────────────────────────────────────────────────
  if (action.kind === "office-session1-punch") {
    const { lateInMins, onTimeOutMins } = officeS1Thresholds(punchDate)
    const existing = findSession("morning")
    if (existing) {
      const earlyDep: 1 | null = onTimeOutMins !== null && pmins < onTimeOutMins ? 1 : null
      return {
        op: "update",
        recordId: existing.id,
        values: { departure_time: punchTime, early_departure_category: earlyDep, out_missing: false },
        message: earlyDep ? "Checked out — early departure flagged" : "Checked out",
      }
    }
    const lateCategory: 1 | null = lateInMins !== null && pmins >= lateInMins ? 1 : null
    return {
      op: "insert",
      values: {
        ...insertBase,
        session: "morning",
        status: "present",
        late_category: lateCategory,
        arrival_time: punchTime,
        departure_time: null,
        sessions_credited: 1,
        early_departure_category: null,
        out_missing: true,
        remarks,
      },
      message: lateCategory ? "Checked in — late flagged" : "Checked in",
    }
  }

  // ── Office session 2 ─────────────────────────────────────────────────────
  if (action.kind === "office-session2-punch") {
    const { lateInMins, onTimeOutMins } = officeS2Thresholds(punchDate)
    const existing = findSession("evening")
    if (existing) {
      const earlyDep: 1 | null = pmins < onTimeOutMins ? 1 : null
      return {
        op: "update",
        recordId: existing.id,
        values: { departure_time: punchTime, early_departure_category: earlyDep, out_missing: false },
        message: earlyDep ? "Checked out — early departure flagged" : "Checked out",
      }
    }
    const lateCategory: 1 | null = pmins >= lateInMins ? 1 : null
    return {
      op: "insert",
      values: {
        ...insertBase,
        session: "evening",
        status: "present",
        late_category: lateCategory,
        arrival_time: punchTime,
        departure_time: null,
        sessions_credited: 1,
        early_departure_category: null,
        out_missing: true,
        remarks,
      },
      message: lateCategory ? "Checked in — late flagged" : "Checked in",
    }
  }

  // ── Cleaning (any day/time; first=IN, every later tap updates OUT) ───────
  if (action.kind === "cleaning-punch") {
    const existing = findSession("morning")
    if (existing) {
      return {
        op: "update",
        recordId: existing.id,
        values: { departure_time: punchTime, out_missing: false, dual_punches: true },
        message: "Checked out",
      }
    }
    return {
      op: "insert",
      values: {
        ...insertBase,
        session: "morning",
        status: "present",
        late_category: null,
        arrival_time: punchTime,
        departure_time: null,
        sessions_credited: 1,
        early_departure_category: null,
        out_missing: true,
        dual_punches: false,
        remarks,
      },
      message: "Checked in",
    }
  }

  // ── Driver (any day/time; first tap=present, second recorded) ────────────
  if (action.kind === "driver-punch") {
    const existing = findSession("morning")
    if (existing) {
      return {
        op: "update",
        recordId: existing.id,
        values: { departure_time: punchTime, dual_punches: true, out_missing: false },
        message: "Second check recorded",
      }
    }
    return {
      op: "insert",
      values: {
        ...insertBase,
        session: "morning",
        status: "present",
        late_category: null,
        arrival_time: punchTime,
        departure_time: null,
        sessions_credited: 1,
        early_departure_category: null,
        out_missing: false,
        dual_punches: false,
        remarks,
      },
      message: "Checked in",
    }
  }

  return { op: "reject", reason: "Unhandled punch action" }
}
