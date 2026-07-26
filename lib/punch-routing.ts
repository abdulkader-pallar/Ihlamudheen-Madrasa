// Pure logic for classifying a fingerprint punch into a session action.
// The route handler in src/app/api/zk-attendance/route.ts wraps this with
// Supabase reads/writes — all the day/time/role decisions live here so
// they can be unit-tested in isolation.
//
// ── Ihlamudheen Madrasa (Sat & Sun) ─────────────────────────────────────────
//   IN window   : 06:00–10:30  (late tiers: Cat1 08:56–09:00 / Cat2 09:01–09:05 / Cat3 09:06–09:15)
//   Afternoon IN: 10:31–10:59 / 11:00–11:30 (late tiers: Cat1 11:11–11:15 / Cat2 11:16–11:20 / Cat3 11:21–11:30)
//   OUT window  : 11:00–16:00
//     11:00–12:59 → 1 session credited (morning only)
//     13:00–13:39 → 2 sessions credited, early-departure flag (red in reports)
//     13:40–16:00 → 2 sessions credited, on-time (green)
//   Single punch in IN window only → 1 session + out_missing flag
//   Single punch in OUT window only → 1 session (afternoon) + out_missing flag
//
// ── EDU Support (Mon–Fri, 06:00–10:30 IN / 10:31–20:00 OUT — same window every
//    weekday incl. Friday for pure EDU staff; dual-role EDU+English teachers use
//    the Friday English/CIBIS evening windows for any 14:00+ punch) ──
//
// ── English Madrasa (Friday only, flat 150 AED/day) ──────────────────
//   IN  : 14:00–17:00  (on-time ≤14:55 / Cat1 14:56–15:19 / Cat2 15:20–17:00)
//   OUT : 17:01–22:30  (on-time ≥19:30 / Cat1 early 19:00–19:29 / Cat2 early 17:01–18:59)
//   Dual-role (the dual-role teacher EDU+English): morning EDU punch counts as day-present;
//     she needs ≥1 punch after 14:00 to qualify for 150 AED English.
//
// ── CIBIS (Friday only, 17:00–22:00, first=IN second=OUT, no late cat) ──
//   Thursday evening punches → blocked with reason.
//
// ── Office – the office staff (2 sessions/day all week, fixed salary) ──────
//   Mon–Thu: S1 IN 06:00–11:00, S1 OUT 11:00–16:00 | S2 IN 16:01–18:00, S2 OUT 18:01–23:59
//   Fri:     S1 before 13:00 (1st=IN, 2nd=OUT)     | S2 IN 13:01–18:00, S2 OUT 18:01–23:59
//   Sat/Sun: S1 IN 06:00–10:00, S1 OUT 10:01–16:00 | S2 16:01–23:59
//   S2 late IN: ≥17:30 (Mon–Thu/Sat/Sun) · ≥14:30 (Fri) | S2 early OUT: <22:00 (Mon–Thu/Sat/Sun) · <21:30 (Fri)
//   No late/early for session 1. All Cat-1, no AED deduction (fixed salary).
//
// ── Cleaning – the cleaning staff (any day/time, first=IN last=OUT) ──────────────
// ── Driver – the driver (any day, first punch=present, 2nd=dual highlight) ─

import { getLateCategory, type LateCategory } from "@/data/courses"

export type PunchAction =
  | { kind: "skip"; reason: string }
  | { kind: "madrasa-arrival";            status: "present" | "late" | "absent"; lateCategory: LateCategory | null }
  | { kind: "madrasa-afternoon-arrival" }                    // 10:31–10:59: afternoon-only IN (route handler skips if morning already recorded)
  | { kind: "madrasa-out";               sessionsCredited: 1 | 2; earlyDepartureCategory: 1 | null }
  | { kind: "edu-arrival";             status: "present" | "late" | "absent" }
  | { kind: "edu-departure" }
  | { kind: "edu-makeup-arrival";      status: "present" | "late" | "absent" }
  | { kind: "edu-makeup-departure" }
  | { kind: "english-arrival";         lateCategory: 1 | 2 | null }  // Cat1=mild late, Cat2=very late (no deduction)
  | { kind: "english-out";             earlyDepartureCategory: 1 | 2 | null }
  | { kind: "cibis-punch" }                                // first=IN, second=OUT; handler stores in session="cibis"
  | { kind: "office-session1-punch" }                      // handler decides IN vs OUT; handler computes late/early
  | { kind: "office-session2-punch" }
  | { kind: "cleaning-punch" }
  | { kind: "driver-punch" }

export interface ClassifyPunchInput {
  punchTime: string          // "HH:MM" 24h
  punchDate: string          // "YYYY-MM-DD"
  teachesEnglish: boolean    // payType=per-day-english OR dualPayType=per-day-english
  teachesCibis: boolean      // teachesCibis flag in TeacherData
  isOffice: boolean          // payType=monthly-office (the office staff)
  isCleaning: boolean        // payType=monthly-cleaning
  isDriver: boolean          // payType=daily-driver
  isEduSupport: boolean      // payType=monthly-edu-support
  hasMorningPunchToday: boolean // for the dual-role teacher English dual-role departure detection
}

const PUNCH_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const PUNCH_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ── Office (the office staff) late/early thresholds ───────────────────────────
// Shared by the ZKTeco route handler and the online self check-in planner so
// the flag rules stay identical across offline and online months.
// All values are minutes-since-midnight; null = no flag applies.
//
// Session 1: Monday has no late/early flag; Sat/Sun late IN ≥08:00, on-time
// OUT ≥14:30; Tue–Fri late IN ≥08:30, on-time OUT ≥13:00.
export function officeS1Thresholds(punchDate: string): {
  lateInMins: number | null
  onTimeOutMins: number | null
} {
  const dow = new Date(punchDate + "T12:00:00").getDay()
  const isMonday   = dow === 1
  const isSatOrSun = dow === 0 || dow === 6
  return {
    lateInMins:    isMonday ? null : isSatOrSun ? 8 * 60       : 8 * 60 + 30,
    onTimeOutMins: isMonday ? null : isSatOrSun ? 14 * 60 + 30 : 13 * 60,
  }
}

// Session 2: Friday late IN ≥14:30, on-time OUT ≥21:30; every other day late
// IN ≥17:30, on-time OUT ≥22:00.
export function officeS2Thresholds(punchDate: string): {
  lateInMins: number
  onTimeOutMins: number
} {
  const isFriday = new Date(punchDate + "T12:00:00").getDay() === 5
  return {
    lateInMins:    isFriday ? 14 * 60 + 30 : 17 * 60 + 30,
    onTimeOutMins: isFriday ? 21 * 60 + 30 : 22 * 60,
  }
}

export function classifyPunch(input: ClassifyPunchInput): PunchAction {
  const { punchTime, punchDate, teachesEnglish, teachesCibis, isOffice, isCleaning, isDriver, isEduSupport } = input

  if (!PUNCH_TIME_RE.test(punchTime)) return { kind: "skip", reason: "punchTime must be HH:MM (24h)" }
  if (!PUNCH_DATE_RE.test(punchDate)) return { kind: "skip", reason: "punchDate must be YYYY-MM-DD" }

  const [h, m] = punchTime.split(":").map(Number)
  const mins = h * 60 + m

  const dayOfWeek = new Date(punchDate + "T12:00:00").getDay()
  if (Number.isNaN(dayOfWeek)) return { kind: "skip", reason: "punchDate is not a valid calendar date" }

  const isThu = dayOfWeek === 4
  const isFri = dayOfWeek === 5
  const isSat = dayOfWeek === 6
  const isSun = dayOfWeek === 0
  const isWeekend = isSat || isSun
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5

  // ── Cleaning: any day, any time ────────────────────────────────────────
  if (isCleaning) return { kind: "cleaning-punch" }

  // ── Driver: any day, any time ──────────────────────────────────────────
  if (isDriver) return { kind: "driver-punch" }

  // ── Office (the office staff): complex schedule ──────────────────────────
  // Fixed salary — punches recorded every day for attendance tracking,
  // no session restriction on any day of week.
  if (isOffice) {
    if (mins < 6 * 60) return { kind: "skip", reason: "Before office hours" }

    if (isSat || isSun) {
      // Session-1 zone: before 16:00; session-2 zone: 16:00+
      return mins < 16 * 60 ? { kind: "office-session1-punch" } : { kind: "office-session2-punch" }
    }

    // Mon–Thu: session-1 zone 06:00–16:00; session-2 zone 16:01–23:59
    // Friday: session-1 before 13:00; session-2 13:01–23:59
    if (isFri) return mins < 13 * 60 ? { kind: "office-session1-punch" } : { kind: "office-session2-punch" }
    return mins < 16 * 60 ? { kind: "office-session1-punch" } : { kind: "office-session2-punch" }
  }

  // ── FRIDAY-SPECIFIC: English + CIBIS ──────────────────────────────────
  if (isFri) {
    // Pure EDU Support staff (no English/CIBIS duty) work the SAME schedule on
    // Friday as on weekdays — morning IN 06:00–10:30, OUT 11:31–20:00 — often
    // resuming after Jumu'ah and punching out in the afternoon. Route every
    // Friday punch for them through the EDU windows here, BEFORE the English /
    // CIBIS windows below, so their afternoon OUT punch is recorded instead of
    // being dropped as an "outside English/CIBIS window" skip.
    // (Dual-role EDU+English teachers like the dual-role teacher fall through to the
    // English/CIBIS handling below, where their 14:00+ punches become English.)
    if (isEduSupport && !teachesEnglish && !teachesCibis) {
      if (mins >= 6 * 60 && mins <= 10 * 60 + 30) {
        const status: "present" | "late" | "absent" =
          mins > 9 * 60 + 30 ? "absent" : mins > 8 * 60 + 30 ? "late" : "present"
        return { kind: "edu-arrival", status }
      }
      // OUT window starts right after the IN window (10:31) — on the Friday
      // half-day EDU staff usually leave late-morning (~11:00), which fell into
      // the old 10:31–11:30 dead zone and was dropped. The route handler tells
      // an IN apart from an OUT by checking for an existing morning record.
      if (mins > 10 * 60 + 30 && mins <= 20 * 60) {
        return { kind: "edu-departure" }
      }
      return { kind: "skip", reason: "EDU Support punch outside Friday windows (06:00–10:30 IN / 10:31–20:00 OUT)" }
    }

    // Block Thursday-style CIBIS punches (CIBIS moved from Thu to Fri)
    // English window: 14:00–22:00 for English teachers
    // CIBIS window: 17:00–22:00 for CIBIS teachers

    // English IN: 14:00–17:00 (English teachers only)
    if (mins >= 14 * 60 && mins <= 17 * 60) {
      if (teachesEnglish) {
        let lateCategory: 1 | 2 | null = null
        if (mins >= 14 * 60 + 56 && mins <= 15 * 60 + 19) lateCategory = 1
        else if (mins >= 15 * 60 + 20) lateCategory = 2
        return { kind: "english-arrival", lateCategory }
      }
      if (teachesCibis && mins >= 17 * 60) return { kind: "cibis-punch" }
      if (!isEduSupport) return { kind: "skip", reason: "Teacher does not teach English — Friday 14:00-17:00 punch ignored" }
    }

    // English OUT / let-off: 17:01–22:30
    if (mins > 17 * 60 && mins <= 22 * 60 + 30) {
      if (teachesEnglish) {
        let earlyDepartureCategory: 1 | 2 | null = null
        if (mins <= 18 * 60 + 59) earlyDepartureCategory = 2       // 17:01–18:59 very early
        else if (mins <= 19 * 60 + 29) earlyDepartureCategory = 1  // 19:00–19:29 mild early
        return { kind: "english-out", earlyDepartureCategory }
      }
      // CIBIS teachers use this same window on Friday (first punch = IN, second = OUT handled in route)
      if (teachesCibis) return { kind: "cibis-punch" }
      return { kind: "skip", reason: "Teacher does not teach English or CIBIS — Friday evening punch ignored" }
    }

    // Dual-role: the dual-role teacher gets an English let-off if she already has an EDU morning punch
    // and punches after 14:00 (handled by english-out above), OR if she punches between
    // 14:00–17:00 (handled by english-arrival above). This overlap is already covered.

    // Friday morning: EDU Support staff punch in/out before 14:00
    if (mins >= 6 * 60 && mins <= 10 * 60 + 30) {
      if (isEduSupport || teachesEnglish) {
        // EDU Support or English dual-role (the dual-role teacher) morning punch
        const status: "present" | "late" | "absent" =
          mins > 9 * 60 + 30 ? "absent" : mins > 8 * 60 + 30 ? "late" : "present"
        return { kind: "edu-arrival", status }
      }
    }
    if (mins > 11 * 60 + 30 && mins < 14 * 60) {
      if (isEduSupport || teachesEnglish) return { kind: "edu-departure" }
    }

    // Outside any window on Friday
    return { kind: "skip", reason: "Punch outside tracked windows on Friday" }
  }

  // ── Block old Thursday CIBIS window (CIBIS moved to Friday) ───────────
  if (isThu && mins >= 17 * 60 && mins <= 22 * 60) {
    if (teachesCibis) return { kind: "skip", reason: "CIBIS moved to Friday — Thursday evening punches not recorded" }
  }

  // ── EDU Support weekend makeup (Sat & Sun) ───────────────────────────
  // EDU Support teachers may come on weekends to make up hours toward the
  // 112-hour monthly target. Same IN/OUT windows as weekdays.
  // Stored with session="edu-makeup" so detectProgram() counts them as EDU Support.
  if (isWeekend && isEduSupport) {
    if (mins >= 6 * 60 && mins <= 10 * 60 + 30) {
      const status: "present" | "late" | "absent" =
        mins > 9 * 60 + 30 ? "absent" : mins > 8 * 60 + 30 ? "late" : "present"
      return { kind: "edu-makeup-arrival", status }
    }
    if (mins > 11 * 60 + 30 && mins <= 20 * 60) {
      return { kind: "edu-makeup-departure" }
    }
    return { kind: "skip", reason: "EDU Support makeup punch outside windows (06:00–10:30 IN / 11:31–20:00 OUT)" }
  }

  // ── Ihlamudheen Madrasa (Sat & Sun) ─────────────────────────────────────────
  if (isWeekend) {
    // Morning IN window: 06:00–10:30
    // Late tiers (per getLateCategory): Cat1 08:56–09:00 / Cat2 09:01–09:05 / Cat3 09:06–09:15 / absent >09:15
    if (mins >= 6 * 60 && mins <= 10 * 60 + 30) {
      const { category, isAbsent } = getLateCategory(punchTime, "morning")
      const status: "present" | "late" | "absent" = isAbsent ? "absent" : category !== null ? "late" : "present"
      return { kind: "madrasa-arrival", status, lateCategory: isAbsent ? null : category }
    }

    // Afternoon-only IN window: 10:31–10:59
    // For teachers who come ONLY for the afternoon session (missed / don't teach morning).
    // Route handler checks for existing morning record:
    //   • morning record exists → skip (teacher already marked, no double punch needed)
    //   • no morning record    → create afternoon-only arrival (1 session initially)
    if (mins >= 10 * 60 + 31 && mins < 11 * 60) {
      return { kind: "madrasa-afternoon-arrival" }
    }

    // OUT / departure window: 11:00–16:00
    // Route handler also treats 11:00–11:30 as afternoon arrival when no morning record exists.
    // Sessions credited depends on when teacher leaves:
    //   11:00–12:59 → 1 session
    //   13:00–13:39 → 2 sessions + early departure Cat-1 (red flag)
    //   13:40–16:00 → 2 sessions (green, full day)
    if (mins >= 11 * 60 && mins <= 16 * 60) {
      if (mins >= 13 * 60) {
        const earlyDepartureCategory: 1 | null = mins < 13 * 60 + 40 ? 1 : null
        return { kind: "madrasa-out", sessionsCredited: 2, earlyDepartureCategory }
      }
      return { kind: "madrasa-out", sessionsCredited: 1, earlyDepartureCategory: null }
    }

    return { kind: "skip", reason: "Punch outside Ihlamudheen tracked windows (06:00–16:00)" }
  }

  // ── EDU Support (Mon–Thu weekday) ─────────────────────────────────────
  if (isWeekday) {
    // Morning IN: 06:00–10:30
    if (mins >= 6 * 60 && mins <= 10 * 60 + 30) {
      const status: "present" | "late" | "absent" =
        mins > 9 * 60 + 30 ? "absent" : mins > 8 * 60 + 30 ? "late" : "present"
      return { kind: "edu-arrival", status }
    }

    // Departure: 10:31–20:00 (starts right after the IN window so an early
    // late-morning OUT punch is not lost in a dead zone; route handler
    // distinguishes IN vs OUT by the presence of a morning record).
    if (mins > 10 * 60 + 30 && mins <= 20 * 60) {
      return { kind: "edu-departure" }
    }

    return { kind: "skip", reason: "Punch outside tracked windows" }
  }

  return { kind: "skip", reason: "Punch outside tracked windows" }
}
