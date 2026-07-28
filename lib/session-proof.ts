// Pure helpers for ONLINE-class session proofs (July/August online months).
//
// A self check-in tap only proves a button was pressed. To show a Google Meet
// class was actually conducted, teachers attach evidence to each session —
// a screenshot of the Meet participant grid and/or the Meet link. This module
// holds the parts that need no I/O so they can be unit-tested and shared by
// the API route and the UI:
//
//   • validateProofPayload — what counts as an acceptable proof submission
//   • classifySessionEvidence — "was this class properly done, or just
//     checked in?" verdict for one attendance record
//   • uploadDelayDays — flags proofs uploaded days after the class

export const PROOF_SESSIONS = ["morning", "afternoon", "full", "evening", "edu-makeup", "cibis"] as const
export type ProofSession = (typeof PROOF_SESSIONS)[number]

export const PROOF_NOTE_MAX = 500
export const PROOF_CLASS_LABEL_MAX = 120
export const PROOF_STUDENTS_MAX = 500

export interface ProofPayload {
  session: string
  storagePath?: string | null
  meetLink?: string | null
  note?: string | null
  classLabel?: string | null
  studentsPresent?: number | null
}

export interface CleanProofPayload {
  session: ProofSession
  storagePath: string | null
  meetLink: string | null
  note: string | null
  classLabel: string | null
  studentsPresent: number | null
}

export type ProofValidation =
  | { ok: true; value: CleanProofPayload }
  | { ok: false; error: string }

/** Accepts Google Meet links and generic https URLs (recordings, drive). */
export function isAcceptableProofLink(link: string): boolean {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return false
  }
  return url.protocol === "https:" && url.hostname.includes(".")
}

const trimOrNull = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim()
  return t.length > 0 ? t : null
}

/**
 * Validate a proof submission. Evidence is mandatory: a screenshot upload
 * (storagePath) or a Meet/recording link — a bare note is not a proof.
 */
export function validateProofPayload(payload: ProofPayload): ProofValidation {
  if (!PROOF_SESSIONS.includes(payload.session as ProofSession)) {
    return { ok: false, error: "Unknown session" }
  }

  const storagePath = trimOrNull(payload.storagePath)
  const meetLink = trimOrNull(payload.meetLink)
  const note = trimOrNull(payload.note)
  const classLabel = trimOrNull(payload.classLabel)

  if (!storagePath && !meetLink) {
    return { ok: false, error: "Attach a class screenshot or a Google Meet link — a note alone is not proof" }
  }
  if (meetLink && !isAcceptableProofLink(meetLink)) {
    return { ok: false, error: "The link must be a valid https:// URL (e.g. https://meet.google.com/…)" }
  }
  if (note && note.length > PROOF_NOTE_MAX) {
    return { ok: false, error: `Note is too long (max ${PROOF_NOTE_MAX} characters)` }
  }
  if (classLabel && classLabel.length > PROOF_CLASS_LABEL_MAX) {
    return { ok: false, error: `Class label is too long (max ${PROOF_CLASS_LABEL_MAX} characters)` }
  }

  let studentsPresent: number | null = null
  if (payload.studentsPresent !== null && payload.studentsPresent !== undefined) {
    const n = Number(payload.studentsPresent)
    if (!Number.isInteger(n) || n < 0 || n > PROOF_STUDENTS_MAX) {
      return { ok: false, error: `Students present must be a whole number between 0 and ${PROOF_STUDENTS_MAX}` }
    }
    studentsPresent = n
  }

  return {
    ok: true,
    value: {
      session: payload.session as ProofSession,
      storagePath,
      meetLink,
      note,
      classLabel,
      studentsPresent,
    },
  }
}

// ── "Properly done, or just checked in?" verdict ─────────────────────────────

export type EvidenceLevel =
  | "verified"        // admin already verified the record
  | "complete"        // IN + OUT + proof — properly done, awaiting verification
  | "missing-proof"   // IN + OUT but no evidence attached
  | "no-checkout"     // IN + proof but never checked out
  | "checked-in-only" // IN only — nothing else to show

export interface EvidenceInput {
  hasArrival: boolean
  hasDeparture: boolean
  proofCount: number
  verified: boolean
}

export interface EvidenceVerdict {
  level: EvidenceLevel
  label: string
  /** true when the record needs teacher/admin attention before verification */
  attention: boolean
}

export function classifySessionEvidence(input: EvidenceInput): EvidenceVerdict {
  const { hasArrival, hasDeparture, proofCount, verified } = input
  if (verified) {
    return { level: "verified", label: "Verified by admin", attention: false }
  }
  const hasProof = proofCount > 0
  if (hasArrival && hasDeparture && hasProof) {
    return { level: "complete", label: "Class done — IN, OUT and proof recorded", attention: false }
  }
  if (hasArrival && hasDeparture) {
    return { level: "missing-proof", label: "Checked in and out — no class proof attached", attention: true }
  }
  if (hasProof) {
    return { level: "no-checkout", label: "Proof attached — check-out missing", attention: true }
  }
  return { level: "checked-in-only", label: "Checked in only — no check-out, no proof", attention: true }
}

/**
 * Whole days between the class date and the proof upload timestamp (UIN-naive:
 * both sides compared as calendar dates). 0 = uploaded the same day.
 */
export function uploadDelayDays(classDate: string, uploadedAtIso: string): number {
  const day = new Date(`${classDate}T00:00:00Z`).getTime()
  const uploadedDay = new Date(`${uploadedAtIso.slice(0, 10)}T00:00:00Z`).getTime()
  if (!Number.isFinite(day) || !Number.isFinite(uploadedDay)) return 0
  return Math.max(0, Math.round((uploadedDay - day) / 86_400_000))
}
