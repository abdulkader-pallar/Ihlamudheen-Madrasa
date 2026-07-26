// Pure payroll calculation logic for the Staff Payment Report.
// All program detection, hours math, and gross/net pay computation lives here
// so it can be unit-tested without rendering React.

import {
  type TeacherData,
  type TeacherPayType,
  type LateCategory,
  SESSION_RATE_MADRASA,
  SESSION_RATE_MADRASA_ONLINE,
  DAY_RATE_ENGLISH,
  DAY_RATE_CIBIS,
  LATE_DEDUCTION,
  CAT_DEDUCTION_THRESHOLDS,
  EDU_SUPPORT_MONTHLY_HOURS,
} from "@/data/courses"

// Per-category occurrence counts (Cat-1, Cat-2, Cat-3 tracked independently)
export interface PerCategoryCount {
  cat1: number
  cat2: number
  cat3: number
}

// ── Types ──────────────────────────────────────────────────
export interface AttendanceRec {
  teacher_id: string
  date: string
  session: string | null
  status: string | null
  late_category: number | null
  early_departure_category: number | null  // 1 or 2 — red flag in reports
  sessions_credited: number | null         // 1 or 2 for Ihlamudheen
  out_missing: boolean | null
  dual_punches: boolean | null             // driver / cleaning double punch
  arrival_time: string | null
  departure_time: string | null
  // "online" rows (self check-in during online months) pay the Ihlamudheen online
  // rate. Optional so legacy rows / older selects fail safe to the offline rate.
  session_type?: string | null
}

/**
 * Prior-month late records carried into the current month. Only the fields the
 * deduction audit needs — enough to list each carried-forward occurrence by
 * date/time, not just collapse it into a count.
 */
export type PriorLateRec = Pick<
  AttendanceRec,
  "teacher_id" | "late_category" | "date" | "session" | "arrival_time"
>

export interface ReportRow {
  teacherId: string
  name: string
  institution: string
  payTypeLabel: string
  payType: TeacherPayType
  hasDualRole: boolean
  dualRoleLabel?: string
  primaryInstitution?: string
  daysPresent: number
  sessions: number
  hours: number
  eduHourlyRate?: number       // set only for monthly-edu-support: fixedMonthlyRate / 112
  englishHours?: number
  madrasaSessions?: number
  // Offline/online split (set only when online sessions exist — payslips show
  // "2 × 60 + 4 × 40" instead of a single rate)
  madrasaOnlineSessions?: number
  madrasaOfflineSessions?: number
  englishDays?: number
  cibisDays?: number
  madrasaGross?: number
  englishGross?: number
  cibisGross?: number
  grossPay: number
  deductions: number
  netPay: number
  // Flags for report highlight
  hasEarlyDeparture: boolean
  hasOutMissing: boolean
  hasLate: boolean
  // Per-category carry-forward (Ihlamudheen per-session only — categories never mix)
  carryIn: PerCategoryCount        // unspent occurrences brought from prior months
  currentMonth: PerCategoryCount   // occurrences earned in this month only
  carryOut: PerCategoryCount       // remainder after deductions (carries to next month)
}

// ── Institution + pay-type labels ──────────────────────────
export function getInstitutionLabel(t: TeacherData): string {
  switch (t.payType) {
    case "per-session-madrasa":   return t.dualPayType === "per-day-english" ? "Ihlamudheen + English"
                                     : t.dualPayType === "per-day-cibis"   ? "Ihlamudheen + CIBIS"
                                     : "Ihlamudheen Madrasa"
    case "per-day-english":    return "Ihlamudheen Madrasa"
    case "per-day-cibis":      return "CIBIS"
    case "monthly-edu-support": return t.dualPayType === "per-day-english" ? "EDU Support + English" : "EDU Support"
    case "monthly-office":      return "Office"
    case "monthly-cleaning":    return "Cleaning"
    case "daily-driver":        return "Driver"
    default:                    return "Other"
  }
}

export function getPayTypeLabel(t: TeacherData): string {
  const englishSuffix = t.dualPayType === "per-day-english"
    ? ` + ${DAY_RATE_ENGLISH} AED/day (English Fri)`
    : t.dualPayType === "per-day-cibis" && DAY_RATE_CIBIS > 0
    ? ` + ${DAY_RATE_CIBIS} AED/day (CIBIS Fri)`
    : ""
  switch (t.payType) {
    case "per-session-madrasa":   return `${SESSION_RATE_MADRASA} AED/session (Ihlamudheen)${englishSuffix}`
    case "per-day-english":    return `${DAY_RATE_ENGLISH} AED/day (English)`
    case "per-day-cibis":      return `${DAY_RATE_CIBIS} AED/day (CIBIS)`
    case "monthly-edu-support": {
      const monthly = t.fixedMonthlyRate ?? 1500
      const hourly  = (monthly / EDU_SUPPORT_MONTHLY_HOURS).toFixed(4)
      return `${monthly} AED/month (${hourly} AED/hr ÷ ${EDU_SUPPORT_MONTHLY_HOURS} hrs)${englishSuffix}`
    }
    case "monthly-office":      return `${t.fixedMonthlyRate ?? 2000} AED/month`
    case "monthly-cleaning":    return `${t.fixedMonthlyRate ?? 400} AED/month`
    case "daily-driver":        return `${t.dailyRate ?? 30} AED/day`
    default:                    return "—"
  }
}

/**
 * Compute per-category carry-in counts for a Ihlamudheen teacher entering a given month.
 * Pass all attendance records that fall BEFORE the target month's first day.
 * For each category, carry_in = (total occurrences) % threshold, because each full
 * group of threshold occurrences has already triggered a deduction.
 * Categories are tracked independently — Cat-1 and Cat-2 never mix.
 */
export function computeCarryIn(
  teacherId: string,
  priorRecords: Pick<AttendanceRec, "teacher_id" | "late_category">[],
): PerCategoryCount {
  // Cat-3 has threshold=1 (always triggers immediately), so it never carries — skip counting it
  let cat1 = 0, cat2 = 0
  for (const r of priorRecords) {
    if (r.teacher_id !== teacherId) continue
    if (r.late_category === 1) cat1++
    else if (r.late_category === 2) cat2++
  }
  return {
    cat1: cat1 % CAT_DEDUCTION_THRESHOLDS[1],  // remainder after deductions
    cat2: cat2 % CAT_DEDUCTION_THRESHOLDS[2],
    cat3: 0,  // never carries
  }
}

// ── Program detection by session field ─────────────────────
export function detectProgram(
  session: string | null,
  date: string,
): "madrasa" | "edu-support" | "english" | "cibis" | "other" {
  // Weekend makeup punches for EDU Support teachers are stored with session="edu-makeup"
  if (session === "edu-makeup") return "edu-support"
  if (session === "cibis") return "cibis"
  if (session === "evening") {
    // Distinguish English vs office session-2 by day + arrival time
    const day = new Date(date + "T12:00:00").getDay()
    if (day === 5) return "english"  // Friday evening = English
    return "other"                    // Weekday evening = office session 2
  }
  const day = new Date(date + "T12:00:00").getDay()
  if (day === 6 || day === 0) return "madrasa"
  if (day >= 1 && day <= 5)  return "edu-support"
  return "other"
}

// ── Hours from arrival/departure ──────────────────────────
export function parseHours(arrival: string | null, departure: string | null): number {
  if (!arrival || !departure) return 0
  const [ah, am] = arrival.split(":").map(Number)
  const [dh, dm] = departure.split(":").map(Number)
  if (isNaN(ah) || isNaN(am) || isNaN(dh) || isNaN(dm)) return 0
  const diff = (dh * 60 + dm - (ah * 60 + am)) / 60
  return diff > 0 ? Math.round(diff * 100) / 100 : 0
}

const EDU_ENGLISH_HANDOFF_TIME = "14:45"

// ── Deduction line items (for audit modal) ────────────────
export interface DeductionItem {
  date: string
  session: "morning" | "afternoon" | "other"
  arrivalTime: string | null
  reasonType: "late-cat-1" | "late-cat-2" | "late-cat-3" | "early-departure" | "out-missing" | "hours-shortfall"
  reason: string
  minusMarks: number          // for late-mark items; 0 otherwise
  amount: number              // AED actually deducted at this point (only set on deduction-trigger rows)
  cumulativeMarks: number     // running marks after this event
  carriedForward?: boolean    // true = a late occurrence from a prior month, shown for context (no deduction this month)
}

/**
 * Build the full audit trail of deduction-triggering events for a teacher in a month.
 * Used to populate the deduction-details modal — each row references the exact punch.
 *
 * When `priorLateRecords` are supplied, the carried-forward occurrences from
 * earlier months (the ones folded into `carryIn`) are listed first by their own
 * date/time, so a deduction triggered by, say, the 3rd Cat-1 still shows all
 * three dates one by one — not just the occurrence that crossed the threshold.
 */
export function getDeductionItems(
  teacher: TeacherData,
  records: AttendanceRec[],
  carryIn: PerCategoryCount = { cat1: 0, cat2: 0, cat3: 0 },
  priorLateRecords: PriorLateRec[] = [],
): DeductionItem[] {
  const tRecords = records
    .filter(r => r.teacher_id === teacher.id)
    .sort((a, b) => (a.date + (a.session ?? "")).localeCompare(b.date + (b.session ?? "")))

  const items: DeductionItem[] = []
  const isSessionBased = teacher.payType === "per-session-madrasa"

  // Late deductions — per category, no mixing (Ihlamudheen per-session only)
  if (isSessionBased) {
    // Running occurrence counters per category. We start from ZERO and replay the
    // carried-forward prior occurrences first, then this month's records. That
    // reproduces the same trigger points as `carryIn` (which is count % threshold)
    // while letting every contributing late be listed by its own date/time.
    const counts = { 1: 0, 2: 0, 3: 0 }
    const triggered = { 1: 0, 2: 0, 3: 0 }

    // Identify which prior late records carry forward: per category, the most
    // recent (count % threshold) = carryIn.catN occurrences — the ones that have
    // not yet been consumed by a deduction in an earlier month.
    const priorByCat: Record<LateCategory, PriorLateRec[]> = { 1: [], 2: [], 3: [] }
    for (const r of priorLateRecords) {
      if (r.teacher_id !== teacher.id) continue
      const cat = r.late_category as LateCategory | null
      if (!cat || cat < 1 || cat > 3) continue
      priorByCat[cat].push(r)
    }
    const carryTarget = { 1: carryIn.cat1, 2: carryIn.cat2, 3: carryIn.cat3 }
    const carriedForward: PriorLateRec[] = []
    for (const cat of [1, 2, 3] as LateCategory[]) {
      const keep = carryTarget[cat]
      if (keep <= 0) continue
      const sorted = priorByCat[cat].sort((a, b) =>
        (a.date + (a.session ?? "")).localeCompare(b.date + (b.session ?? "")))
      carriedForward.push(...sorted.slice(Math.max(0, sorted.length - keep)))
    }
    carriedForward.sort((a, b) =>
      (a.date + (a.session ?? "")).localeCompare(b.date + (b.session ?? "")))

    const pushLate = (
      r: Pick<AttendanceRec, "date" | "session" | "arrival_time" | "late_category">,
      isCarried: boolean,
    ) => {
      const cat = r.late_category as LateCategory
      counts[cat]++

      const sessionLabel: DeductionItem["session"] =
        r.session === "morning" || r.session === "afternoon" ? r.session : "other"
      const reasonType =
        cat === 1 ? "late-cat-1" : cat === 2 ? "late-cat-2" : "late-cat-3"
      const arrival = r.arrival_time
      const threshold = CAT_DEDUCTION_THRESHOLDS[cat]
      const context = isCarried
        ? `occurrence ${counts[cat]} of ${threshold}, carried from a prior month`
        : `occurrence ${counts[cat]}, threshold ${threshold}`
      const reason =
        `Late arrival — Cat-${cat} (${context}) ` +
        `${arrival ? `punched in at ${arrival}` : ""}` +
        `${sessionLabel !== "other" ? ` for ${sessionLabel} session` : ""}`

      const newTriggers = Math.floor(counts[cat] / threshold) - triggered[cat]
      const amount = newTriggers * LATE_DEDUCTION
      triggered[cat] += newTriggers

      items.push({
        date: r.date,
        session: sessionLabel,
        arrivalTime: arrival,
        reasonType,
        reason,
        minusMarks: 1,
        amount,
        cumulativeMarks: counts[cat],
        carriedForward: isCarried,
      })
    }

    for (const r of carriedForward) pushLate(r, true)
    for (const r of tRecords) {
      const cat = r.late_category as LateCategory | null
      if (!cat || cat < 1 || cat > 3) continue
      pushLate(r, false)
    }
  }

  // Informational flags (never silently absorb pay — surface them in the modal)
  for (const r of tRecords) {
    if (r.early_departure_category) {
      items.push({
        date: r.date,
        session: r.session === "morning" || r.session === "afternoon" ? r.session : "other",
        arrivalTime: r.departure_time,
        reasonType: "early-departure",
        reason: `Early departure — Cat-${r.early_departure_category}${r.departure_time ? ` (left at ${r.departure_time})` : ""}`,
        minusMarks: 0,
        amount: 0, // flagged for review, no automatic deduction
        cumulativeMarks: 0,
      })
    }
    if (r.out_missing) {
      items.push({
        date: r.date,
        session: r.session === "morning" || r.session === "afternoon" ? r.session : "other",
        arrivalTime: null,
        reasonType: "out-missing",
        reason: `Missing punch-out — no departure recorded`,
        minusMarks: 0,
        amount: 0,
        cumulativeMarks: 0,
      })
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date))
}

// ── Anomaly detection (data-integrity checks) ─────────────
export type AnomalyType =
  | "missing-punch-out"     // arrival present but no departure
  | "excessive-hours"       // >16 hours in one session
  | "future-dated"          // punch date > today
  | "duplicate"             // multiple punches for same (teacher, date, session)
  | "out-missing-flag"      // out_missing flag set in source data
  | "dual-punches-flag"     // dual_punches flag set (driver/cleaning)

export interface Anomaly {
  type: AnomalyType
  date: string
  session: string | null
  detail: string
  severity: "warning" | "critical"
}

const MAX_REASONABLE_HOURS = 16

export function getAnomalies(
  teacher: TeacherData,
  records: AttendanceRec[],
): Anomaly[] {
  const tRecords = records.filter(r => r.teacher_id === teacher.id)
  const today = new Date().toISOString().slice(0, 10)
  const anomalies: Anomaly[] = []

  // Track duplicate keys
  const keyCount = new Map<string, number>()
  for (const r of tRecords) {
    const key = `${r.date}|${r.session ?? "_"}`
    keyCount.set(key, (keyCount.get(key) ?? 0) + 1)
  }
  const seenDupKeys = new Set<string>()

  for (const r of tRecords) {
    // Missing punch-out: arrival recorded but no departure
    if (r.arrival_time && !r.departure_time) {
      anomalies.push({
        type: "missing-punch-out",
        date: r.date,
        session: r.session,
        detail: `Arrival at ${r.arrival_time} but no departure recorded`,
        severity: "warning",
      })
    }

    // Source data flag: out_missing
    if (r.out_missing) {
      anomalies.push({
        type: "out-missing-flag",
        date: r.date,
        session: r.session,
        detail: `Source data flagged: out_missing=true`,
        severity: "warning",
      })
    }

    // Excessive hours
    const hrs = parseHours(r.arrival_time, r.departure_time)
    if (hrs > MAX_REASONABLE_HOURS) {
      anomalies.push({
        type: "excessive-hours",
        date: r.date,
        session: r.session,
        detail: `Punch shows ${hrs.toFixed(1)}h — exceeds ${MAX_REASONABLE_HOURS}h ceiling (check for missed punch-out)`,
        severity: "critical",
      })
    }

    // Future-dated
    if (r.date > today) {
      anomalies.push({
        type: "future-dated",
        date: r.date,
        session: r.session,
        detail: `Punch date is in the future (${r.date})`,
        severity: "critical",
      })
    }

    // Duplicates — emit once per duplicate key
    const key = `${r.date}|${r.session ?? "_"}`
    if ((keyCount.get(key) ?? 0) > 1 && !seenDupKeys.has(key)) {
      seenDupKeys.add(key)
      anomalies.push({
        type: "duplicate",
        date: r.date,
        session: r.session,
        detail: `${keyCount.get(key)} duplicate punch records for this date+session`,
        severity: "warning",
      })
    }

    // Dual punches flag (informational for driver/cleaning)
    if (r.dual_punches) {
      anomalies.push({
        type: "dual-punches-flag",
        date: r.date,
        session: r.session,
        detail: `Dual punches recorded (driver/cleaning multi-shift)`,
        severity: "warning",
      })
    }
  }

  return anomalies.sort((a, b) => a.date.localeCompare(b.date))
}

// ── Monthly row calculation ───────────────────────────────
const ZERO_COUNTS: PerCategoryCount = { cat1: 0, cat2: 0, cat3: 0 }

export function calcRow(
  teacher: TeacherData,
  records: AttendanceRec[],
  forInstitution: string = "all",
  carryIn: PerCategoryCount = ZERO_COUNTS,
): ReportRow {
  const tRecords = records.filter(r => r.teacher_id === teacher.id)
  const isDualEduEnglish =
    teacher.payType === "monthly-edu-support" &&
    teacher.dualPayType === "per-day-english"
  const fridayEnglishDates = new Set(
    tRecords
      .filter((r) =>
        detectProgram(r.session, r.date) === "english" &&
        new Date(r.date + "T12:00:00").getDay() === 5 &&
        (r.arrival_time || r.departure_time),
      )
      .map((r) => r.date),
  )

  // Split by program
  let madrasaSessions = 0
  let madrasaOnline   = 0   // sessions taught online (Google Meet months) — 40 AED
  let madrasaOffline  = 0   // sessions taught on-site — 60 AED
  const englishDates = new Set<string>()
  const cibisDates   = new Set<string>()
  const eduDates     = new Set<string>()
  let   daysPresent  = 0
  let   hours        = 0
  let   englishHours = 0

  // Flags
  let hasEarlyDeparture = false
  let hasOutMissing     = false
  let hasLate           = false

  for (const r of tRecords) {
    if (!r.arrival_time && !r.departure_time) continue

    const prog = detectProgram(r.session, r.date)

    if (prog === "madrasa") {
      if (r.status === "absent") continue  // absent = 0 sessions, 0 pay
      const credited = r.sessions_credited ?? 0
      madrasaSessions += credited
      // Online self check-ins pay the online session rate; anything else
      // (offline, null, legacy) stays at the standard rate.
      if (r.session_type === "online") madrasaOnline += credited
      else madrasaOffline += credited
      daysPresent++
    } else if (prog === "english") {
      englishDates.add(r.date)
      daysPresent++
      const englishStart =
        isDualEduEnglish && fridayEnglishDates.has(r.date)
          ? EDU_ENGLISH_HANDOFF_TIME
          : r.arrival_time
      englishHours += parseHours(englishStart, r.departure_time)
    } else if (prog === "cibis") {
      cibisDates.add(r.date)
      daysPresent++
    } else if (prog === "edu-support") {
      eduDates.add(r.date)
      daysPresent++
    } else {
      // office session-2 — don't double-count day
    }

    if (r.early_departure_category) hasEarlyDeparture = true
    if (r.out_missing)              hasOutMissing     = true
    if (r.late_category)            hasLate           = true

    // Hours for fixed/daily roles
    if (["monthly-edu-support", "monthly-office", "monthly-cleaning", "daily-driver"].includes(teacher.payType)) {
      if (teacher.payType === "monthly-edu-support") {
        // English / CIBIS punches are paid under their own programs — never fold
        // them into the EDU hourly target. Everything else (weekday EDU, weekend
        // makeup, etc.) counts toward the 112-hr/month target.
        if (prog === "english" || prog === "cibis") continue
        if (!r.arrival_time) continue   // departure-only punch — nothing to credit
        const isFridayEduHandoff =
          isDualEduEnglish &&
          new Date(r.date + "T12:00:00").getDay() === 5 &&
          fridayEnglishDates.has(r.date)
        if (isFridayEduHandoff) {
          // Dual-role EDU+English (the dual-role teacher), present for English the same Friday:
          // she stays at the institute between her EDU punch-out (e.g. 12:30) and the
          // English session, so EDU hours run from arrival to 14:45 even when an
          // earlier EDU departure punch exists. Post-14:45 time is credited to
          // English above. The stored punch record is untouched — reports still show
          // the punches exactly as made.
          hours += parseHours(r.arrival_time, EDU_ENGLISH_HANDOFF_TIME)
        } else if (r.departure_time) {
          // Absent for English (or not a handoff day): EDU counts only up to the
          // real punch-out.
          hours += parseHours(r.arrival_time, r.departure_time)
        } else if (prog === "edu-support") {
          // Genuine missed punch-out on an EDU day — credit a default 5-hour shift
          // rather than losing the day to 0 hours.
          hours += 5
        }
      } else if (prog === "edu-support" && r.arrival_time && !r.departure_time) {
        // Other fixed-salary roles (office/cleaning/driver) with a missed weekday
        // punch-out: credit a default 5-hour shift so the hours display isn't 0.
        // Their pay is fixed and ignores hours; this only affects the hours column.
        hours += 5
      } else {
        hours += parseHours(r.arrival_time, r.departure_time)
      }
    }
  }
  hours = Math.round(hours * 100) / 100
  englishHours = Math.round(englishHours * 100) / 100

  // For driver: daysPresent = unique dates with any punch
  let driverDays = 0
  if (teacher.payType === "daily-driver") {
    driverDays = new Set(tRecords.filter(r => r.arrival_time).map(r => r.date)).size
    daysPresent = driverDays
  }

  // For cleaning: unique dates with any punch
  let cleaningDays = 0
  if (teacher.payType === "monthly-cleaning") {
    cleaningDays = new Set(tRecords.filter(r => r.arrival_time).map(r => r.date)).size
    daysPresent = cleaningDays
  }

  // ── Late deductions — per category, no mixing (Ihlamudheen per-session only) ─
  const isSessionBased = teacher.payType === "per-session-madrasa"
  const currentMonth: PerCategoryCount = { cat1: 0, cat2: 0, cat3: 0 }
  if (isSessionBased) {
    for (const r of tRecords) {
      if (r.late_category === 1) currentMonth.cat1++
      else if (r.late_category === 2) currentMonth.cat2++
      else if (r.late_category === 3) currentMonth.cat3++
    }
  }
  const total1 = currentMonth.cat1 + (isSessionBased ? carryIn.cat1 : 0)
  const total2 = currentMonth.cat2 + (isSessionBased ? carryIn.cat2 : 0)
  const total3 = currentMonth.cat3 + (isSessionBased ? carryIn.cat3 : 0)
  const deductions =
    (Math.floor(total1 / CAT_DEDUCTION_THRESHOLDS[1]) +
     Math.floor(total2 / CAT_DEDUCTION_THRESHOLDS[2]) +
     Math.floor(total3 / CAT_DEDUCTION_THRESHOLDS[3])) * LATE_DEDUCTION
  const carryOut: PerCategoryCount = {
    cat1: total1 % CAT_DEDUCTION_THRESHOLDS[1],
    cat2: total2 % CAT_DEDUCTION_THRESHOLDS[2],
    cat3: 0,  // threshold=1, always triggers immediately
  }

  // ── Gross pay ──────────────────────────────────────────────
  let grossPay   = 0
  let sessions   = 0
  let madrasaGross : number | undefined
  let englishGross: number | undefined
  let cibisGross : number | undefined

  switch (teacher.payType) {
    case "per-session-madrasa": {
      // Online sessions (Google Meet months) pay the online rate; offline pay
      // the standard rate. Late-category minus marks deduct identically for
      // both — classifyPunch assigns categories the same way online.
      madrasaGross   = madrasaOffline * SESSION_RATE_MADRASA + madrasaOnline * SESSION_RATE_MADRASA_ONLINE
      sessions     = madrasaSessions
      grossPay     = madrasaGross
      if (teacher.dualPayType === "per-day-english") {
        englishGross = englishDates.size * DAY_RATE_ENGLISH
        sessions    += englishDates.size
        grossPay    += englishGross
      }
      if (teacher.dualPayType === "per-day-cibis") {
        cibisGross   = cibisDates.size * DAY_RATE_CIBIS
        sessions    += cibisDates.size
        grossPay    += cibisGross
      }
      break
    }
    case "per-day-english": {
      englishGross = englishDates.size * DAY_RATE_ENGLISH
      sessions     = englishDates.size
      grossPay     = englishGross
      break
    }
    case "per-day-cibis": {
      cibisGross = cibisDates.size * DAY_RATE_CIBIS
      sessions   = cibisDates.size
      grossPay   = cibisGross
      break
    }
    case "monthly-edu-support": {
      const monthlyRate = teacher.fixedMonthlyRate ?? 1500
      const hourlyRate  = monthlyRate / EDU_SUPPORT_MONTHLY_HOURS  // e.g. 1500 / 112 = 13.392857…
      // Pay full monthly rate when hours target is met; deduct per-hour if below target
      grossPay = hours >= EDU_SUPPORT_MONTHLY_HOURS
        ? monthlyRate
        : parseFloat((hours * hourlyRate).toFixed(2))
      sessions = eduDates.size
      if (teacher.dualPayType === "per-day-english") {
        englishGross = englishDates.size * DAY_RATE_ENGLISH
        sessions    += englishDates.size
        grossPay    += englishGross
      }
      break
    }
    case "monthly-office":
      grossPay = teacher.fixedMonthlyRate ?? 2000
      sessions = daysPresent
      break
    case "monthly-cleaning":
      grossPay = teacher.fixedMonthlyRate ?? 400
      sessions = cleaningDays
      break
    case "daily-driver":
      grossPay = driverDays * (teacher.dailyRate ?? 30)
      sessions = driverDays
      break
  }

  // Pay-type label with dual-role breakdown.
  // When any online sessions exist, show the offline/online split explicitly
  // (e.g. "2 sess × 60 + 4 online × 40") — normal months keep the plain label.
  const madrasaSessPart = madrasaOnline > 0
    ? `${madrasaOffline} sess × ${SESSION_RATE_MADRASA} + ${madrasaOnline} online × ${SESSION_RATE_MADRASA_ONLINE}`
    : `${madrasaSessions} Ihlamudheen sess × ${SESSION_RATE_MADRASA}`
  let payTypeLabel = getPayTypeLabel(teacher)
  if (teacher.payType === "per-session-madrasa" && !teacher.dualPayType && madrasaOnline > 0) {
    payTypeLabel = `${madrasaSessPart} AED (Ihlamudheen)`
  }
  if (teacher.dualPayType === "per-day-english") {
    const engPart = `${englishDates.size} English day${englishDates.size !== 1 ? "s" : ""} × ${DAY_RATE_ENGLISH} AED`
    if (teacher.payType === "per-session-madrasa") {
      payTypeLabel = `${madrasaSessPart} + ${engPart}`
    } else {
      payTypeLabel = `${teacher.fixedMonthlyRate ?? 1500} AED fixed + ${engPart}`
    }
  } else if (teacher.dualPayType === "per-day-cibis") {
    payTypeLabel = DAY_RATE_CIBIS > 0
      ? `${madrasaSessPart} + ${cibisDates.size} CIBIS day${cibisDates.size !== 1 ? "s" : ""} × ${DAY_RATE_CIBIS} AED`
      : `${madrasaSessPart} AED (CIBIS unpaid)`
  }

  const isDualRoleInEnglish =
    forInstitution === "english" &&
    teacher.dualPayType === "per-day-english" &&
    teacher.payType !== "per-day-english"
  const primaryInstitution = isDualRoleInEnglish
    ? (teacher.payType === "per-session-madrasa" ? "Ihlamudheen Madrasa" : "EDU Support")
    : undefined

  return {
    teacherId: teacher.id,
    name: teacher.name,
    institution: getInstitutionLabel(teacher),
    payTypeLabel: isDualRoleInEnglish ? `${DAY_RATE_ENGLISH} AED/day (English)` : payTypeLabel,
    payType: teacher.payType,
    hasDualRole: !!teacher.dualPayType,
    dualRoleLabel: teacher.dualPayType ? getInstitutionLabel(teacher) : undefined,
    primaryInstitution,
    daysPresent,
    sessions,
    hours,
    eduHourlyRate: teacher.payType === "monthly-edu-support"
      ? (teacher.fixedMonthlyRate ?? 1500) / EDU_SUPPORT_MONTHLY_HOURS
      : undefined,
    englishHours: englishHours > 0 ? englishHours : undefined,
    madrasaSessions: madrasaSessions > 0 ? madrasaSessions : undefined,
    madrasaOnlineSessions: madrasaOnline > 0 ? madrasaOnline : undefined,
    madrasaOfflineSessions: madrasaOnline > 0 ? madrasaOffline : undefined,
    englishDays: englishDates.size > 0 ? englishDates.size : undefined,
    cibisDays: cibisDates.size > 0 ? cibisDates.size : undefined,
    madrasaGross,
    englishGross,
    cibisGross,
    grossPay,
    deductions,
    netPay: Math.max(0, grossPay - deductions),
    hasEarlyDeparture,
    hasOutMissing,
    hasLate,
    carryIn:      isSessionBased ? carryIn       : ZERO_COUNTS,
    currentMonth: isSessionBased ? currentMonth  : ZERO_COUNTS,
    carryOut:     isSessionBased ? carryOut      : ZERO_COUNTS,
  }
}
