// Shared user → teacher_id resolution, usable client-side (Supabase User) and
// server-side (auth.getUser result). API routes resolve the same identity the
// UI does.
//
// NOTE (Ihlamudheen): the email/name allow-lists below are intentionally EMPTY.
// Populate them with your own staff once teachers are created, keeping them in
// sync with the AUTHORIZED allow-list in app/api/auth/verify-user/route.ts.

import { initialTeachers } from "@/data/courses"

// ── Email → teacher_id mapping (authoritative for known staff) ──
// Fill with your institute's staff, e.g. { "teacher@example.com": "t1" }.
export const EMAIL_TO_TEACHER_ID: Record<string, string> = {}

// ── Name → teacher_id mapping (matches full_name values used at setup) ──
export const FULL_NAME_TO_TEACHER_ID: Record<string, string> = {}

// Structural type so both a client-side Supabase `User` and a server-side
// `auth.getUser(token)` result fit without importing @supabase/supabase-js here.
export interface IdentityUserLike {
  email?: string | null
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
}

/** Email-map-only lookup — primary path for server routes. */
export function resolveTeacherIdByEmail(email: string | null | undefined): string | null {
  const key = (email ?? "").toLowerCase().trim()
  return key ? EMAIL_TO_TEACHER_ID[key] ?? null : null
}

export function resolveTeacherId(user: IdentityUserLike): string | null {
  // Email first — authoritative for known staff and overrides a stale teacher_id
  // in a cached session token.
  const byEmail = resolveTeacherIdByEmail(user.email)
  if (byEmail) return byEmail

  const directId = (user.app_metadata?.teacher_id ?? user.user_metadata?.teacher_id) as string | undefined
  if (directId) return directId

  const fullName = (user.user_metadata?.full_name ?? user.user_metadata?.name) as string | undefined
  if (fullName && FULL_NAME_TO_TEACHER_ID[fullName]) return FULL_NAME_TO_TEACHER_ID[fullName]

  if (fullName) {
    const lower = fullName.toLowerCase()
    const match = initialTeachers.find(
      (t) => t.name.toLowerCase().includes(lower) || lower.includes(t.name.toLowerCase().split(" ")[0])
    )
    if (match) return match.id
  }

  return null
}
