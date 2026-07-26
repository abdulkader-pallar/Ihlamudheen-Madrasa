// ╔══════════════════════════════════════════════════════════════════╗
// ║ Student late-arrival policy                                       ║
// ║                                                                  ║
// ║ Each program has an official start time for STUDENTS. A student  ║
// ║ whose recorded arrival time is strictly after the start time is  ║
// ║ marked "late" (no grace period). CIBIS Certification has no      ║
// ║ start time and is therefore not tracked for lateness.            ║
// ║                                                                  ║
// ║ Note: the 8:55 AM Madrasa rule applies to teachers/staff and is  ║
// ║ handled by the separate staff-attendance system — students use   ║
// ║ a flat 9:00 AM start here.                                       ║
// ╚══════════════════════════════════════════════════════════════════╝

/** Program (course title, upper-cased) → official student start time "HH:MM" (24h). */
// Keys are UPPER-CASED course titles (see getProgramStart). These are
// placeholder defaults — adjust the labels/times to your own programs.
export const PROGRAM_START_TIMES: Record<string, string> = {
  "IHLAMUDHEEN MADRASA": "09:00",
  "KAMMU MUSLIYAR MEMORIAL SCHOOL": "09:00",
}

/** Official start time for a program, or null when lateness isn't tracked. */
export function getProgramStart(courseTitle: string | undefined | null): string | null {
  if (!courseTitle) return null
  return PROGRAM_START_TIMES[courseTitle.toUpperCase().trim()] ?? null
}

/** Whether arrival-time / late tracking applies to this program. */
export function isLateTracked(courseTitle: string | undefined | null): boolean {
  return getProgramStart(courseTitle) !== null
}

/** Parse "HH:MM" (24h) into minutes-since-midnight, or null if malformed. */
export function parseTimeToMinutes(hhmm: string | undefined | null): number | null {
  if (!hhmm) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

export interface Lateness {
  /** Strictly after the start time. */
  isLate: boolean
  /** Minutes after the start time (0 when on-time/early). */
  minutesLate: number
  /** The program start time used, "HH:MM". */
  start: string
}

/**
 * Compute lateness for an arrival time against the program's start time.
 * Returns null when the program isn't tracked or the arrival time is invalid.
 * Strict: any arrival after the start counts as late (no grace).
 */
export function computeLateness(
  courseTitle: string | undefined | null,
  arrival: string | undefined | null,
): Lateness | null {
  const start = getProgramStart(courseTitle)
  if (!start) return null
  const a = parseTimeToMinutes(arrival)
  if (a === null) return null
  const s = parseTimeToMinutes(start)
  if (s === null) return null
  const diff = a - s
  return { isLate: diff > 0, minutesLate: diff > 0 ? diff : 0, start }
}

/** Format "HH:MM" (24h) as a 12-hour clock label, e.g. "3:05 PM". Empty if invalid. */
export function formatTime12h(hhmm: string | undefined | null): string {
  const mins = parseTimeToMinutes(hhmm)
  if (mins === null) return ""
  let h = Math.floor(mins / 60)
  const m = mins % 60
  const ampm = h >= 12 ? "PM" : "AM"
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`
}

/** Compact "1h 05m" / "12m" label for a minutes-late value. */
export function formatMinutesLate(minutes: number): string {
  if (minutes <= 0) return "0m"
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`
  return `${m}m`
}

/**
 * Live auto-formatter for the type-it-in arrival field: inserts the "HH:MM"
 * colon as the teacher types plain digits, so no manual ":" is needed.
 *
 * Smart hour length: a leading "1" could start a one-digit (1 o'clock) or
 * two-digit (10/11/12 o'clock) hour, so entry pauses after it for a second
 * digit before deciding. Any other leading digit is unambiguously a one-digit
 * hour, so the colon appears immediately and typing continues straight into
 * the minutes — no separate step to "select" the minutes field.
 *
 * Backs off and returns the input untouched once the teacher places their own
 * ":" or types letters/dots/spaces (e.g. "3:05 pm", "9.09", "1:05") — that is
 * explicit entry, parsed as-is by parseArrivalInput on commit.
 */
export function formatArrivalTyping(raw: string): string {
  if (!raw) return raw
  if (raw.includes(":") || /[^\d]/.test(raw)) return raw

  const digits = raw.slice(0, 4)
  if (digits.length === 1) return digits

  const hourLen = digits[0] === "1" && /^[012]/.test(digits[1]) ? 2 : 1
  const hour = digits.slice(0, hourLen)
  const minute = digits.slice(hourLen, hourLen + 2)
  return minute ? `${hour}:${minute}` : hour
}

/**
 * Parse a free-typed arrival time into "HH:MM" (24h), or null if unusable.
 *
 * Accepts forms like "9:09", "0909", "909", "9.09", "3:05 pm", "15:05".
 * When no AM/PM is given, the time is anchored to the program's start:
 * for an afternoon program (e.g. Ihlamudheen Madrasa at 15:00) a typed
 * 1–11 o'clock is treated as PM, so "3:05" → "15:05"; for a morning
 * program "9:09" stays "09:09". This avoids the native time picker's
 * all-or-nothing AM/PM box, which can silently produce an empty value.
 */
export function parseArrivalInput(
  raw: string | undefined | null,
  programStart?: string | null,
): string | null {
  if (!raw) return null
  let s = raw.trim().toLowerCase()
  if (!s) return null

  // Pull off an explicit am/pm suffix if present.
  let mer: "am" | "pm" | null = null
  const merMatch = s.match(/([ap])\.?m\.?$/)
  if (merMatch) {
    mer = merMatch[1] === "p" ? "pm" : "am"
    s = s.slice(0, merMatch.index).trim()
  }

  let h: number
  let m: number
  if (/[:.\s]/.test(s)) {
    const parts = s.split(/[:.\s]+/).filter(Boolean)
    if (parts.length === 0) return null
    h = parseInt(parts[0], 10)
    m = parts.length > 1 ? parseInt(parts[1], 10) : 0
  } else {
    const digits = s.replace(/\D/g, "")
    if (digits.length === 0) return null
    if (digits.length <= 2) { h = parseInt(digits, 10); m = 0 }
    else if (digits.length === 3) { h = parseInt(digits.slice(0, 1), 10); m = parseInt(digits.slice(1), 10) }
    else { h = parseInt(digits.slice(0, 2), 10); m = parseInt(digits.slice(2, 4), 10) }
  }
  if (Number.isNaN(h) || Number.isNaN(m) || h > 23 || m > 59) return null

  if (mer === "pm" && h < 12) h += 12
  else if (mer === "am" && h === 12) h = 0
  else if (!mer && programStart) {
    const ps = parseTimeToMinutes(programStart)
    if (ps !== null) {
      const programHour = Math.floor(ps / 60)
      if (programHour >= 12 && h >= 1 && h <= 11) h += 12 // afternoon program → PM
      else if (programHour < 12 && h === 12) h = 0
    }
  }
  if (h > 23) return null
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}
