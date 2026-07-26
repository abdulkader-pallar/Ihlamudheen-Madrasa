// ── Lesson-plan / PPT submission endpoint (item 9) ───────────────────────────
// The browser uploads the files straight to Supabase Storage (bucket
// 'lesson-plans') first — this bypasses the ~4.5 MB serverless-request-body
// limit, so large PPTs submit smoothly. This route then receives only the
// storage *paths* + metadata (a small JSON body) and:
//   1. records the submission row (service-role insert with the caller identity),
//   2. best-effort mirrors each file from Storage to the shared Google Drive
//      folder (if configured),
//   3. emails a confirmation to the teacher + admin (Resend, if configured).
//
// Storage is the source of truth: a submission is always saved, even when Drive
// or email are unconfigured (status 'partial'). The file stays reachable via a
// signed Storage URL regardless.

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireRole } from "@/lib/api-auth"
import {
  uploadToDrive,
  isDriveConfigured,
  DEFAULT_LESSON_PLANS_FOLDER_ID,
} from "@/lib/google-drive"
import { getOAuthConnection, uploadToDriveOAuth } from "@/lib/google-oauth"

export const runtime = "nodejs"

const STORAGE_BUCKET = "lesson-plans"

function genCode(): string {
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate(),
  ).padStart(2, "0")}`
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `LP-${stamp}-${rand}`
}

export async function POST(request: Request) {
  try {
    const guard = await requireRole(request, ["admin", "accountant", "teacher"])
    if (guard.error) return guard.error
    const caller = guard.caller

    const body = await request.json()
    const subject = String(body.subject || "").trim()
    const grade = String(body.grade || "").trim()
    const courseId = String(body.courseId || "").trim()
    const courseName = String(body.courseName || "").trim()
    const classId = String(body.classId || "").trim()
    const weekDate = String(body.weekDate || "").trim()
    const teacherName = String(body.teacherName || "").trim()
    const lessonPlanPath = String(body.lessonPlanPath || "").trim()
    const lessonPlanName = String(body.lessonPlanName || "").trim() || null
    const pptPath = String(body.pptPath || "").trim()
    const pptName = String(body.pptName || "").trim() || null

    if (!subject || !weekDate) {
      return NextResponse.json({ error: "Subject and week/date are required." }, { status: 400 })
    }
    if (!lessonPlanPath && !pptPath) {
      return NextResponse.json({ error: "Upload at least a lesson plan or a PPT." }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "Server storage not configured." }, { status: 500 })
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const code = genCode()
    let lessonPlanUrl: string | null = null
    let pptUrl: string | null = null
    let driveOk = true
    let driveError: string | null = null

    // Prefer OAuth (uploads as the institute's own Google account, which works
    // on a personal account); fall back to the service account if configured.
    const oauth = await getOAuthConnection()
    const driveEnabled = oauth.connected || isDriveConfigured()
    const putToDrive = oauth.connected ? uploadToDriveOAuth : uploadToDrive

    // File everything under Course / Class / Week-Date so the Drive folder
    // stays organised instead of one flat pile. Missing values fall back to a
    // readable placeholder so nothing lands at the root un-filed.
    const folderSegments = [
      courseName || (courseId ? `Course ${courseId}` : "Unsorted course"),
      grade || "Unassigned class",
      weekDate || "Undated",
    ]

    // Best-effort mirror from Storage → Drive. Failures never lose the
    // submission — the file remains in Storage.
    if (driveEnabled) {
      const mirror = async (path: string, name: string, label: string): Promise<string | null> => {
        const { data, error } = await admin.storage.from(STORAGE_BUCKET).download(path)
        if (error || !data) throw new Error(error?.message || "storage download failed")
        const up = await putToDrive(
          {
            name: `${code} — ${subject} — ${label} — ${name}`,
            mimeType: data.type || "application/octet-stream",
            bytes: Buffer.from(await data.arrayBuffer()),
          },
          DEFAULT_LESSON_PLANS_FOLDER_ID,
          folderSegments,
        )
        return up.webViewLink || `https://drive.google.com/file/d/${up.id}/view`
      }
      try {
        if (lessonPlanPath && lessonPlanName) lessonPlanUrl = await mirror(lessonPlanPath, lessonPlanName, "Lesson Plan")
        if (pptPath && pptName) pptUrl = await mirror(pptPath, pptName, "PPT")
      } catch (e) {
        driveOk = false
        driveError = e instanceof Error ? e.message : String(e)
        console.error("[lesson-plans/upload] Drive mirror failed:", e)
      }
    } else {
      driveOk = false
    }

    const status: "submitted" | "partial" = driveEnabled && driveOk ? "submitted" : "partial"

    // Once a file lives in Drive, drop the temporary Supabase copy so it does
    // not consume the (limited) Storage quota. Keep the Storage copy only when
    // it is the sole home (Drive unconfigured or its mirror failed).
    const toRemove: string[] = []
    let storedLessonPlanPath: string | null = lessonPlanPath || null
    let storedPptPath: string | null = pptPath || null
    if (lessonPlanUrl && lessonPlanPath) { toRemove.push(lessonPlanPath); storedLessonPlanPath = null }
    if (pptUrl && pptPath) { toRemove.push(pptPath); storedPptPath = null }
    if (toRemove.length) {
      const { error: rmErr } = await admin.storage.from(STORAGE_BUCKET).remove(toRemove)
      if (rmErr) console.error("[lesson-plans/upload] temp cleanup failed:", rmErr)
    }

    const { error: insErr } = await admin.from("lesson_plan_submissions").insert({
      submission_code: code,
      teacher_id: caller.id,
      teacher_name: teacherName || null,
      teacher_email: caller.email,
      course_id: courseId || null,
      class_id: classId || null,
      grade: grade || null,
      subject,
      week_date: weekDate,
      lesson_plan_name: lessonPlanName,
      lesson_plan_url: lessonPlanUrl,
      lesson_plan_path: storedLessonPlanPath,
      ppt_name: pptName,
      ppt_url: pptUrl,
      ppt_path: storedPptPath,
      drive_folder_id: DEFAULT_LESSON_PLANS_FOLDER_ID,
      status,
    })
    if (insErr) {
      console.error("[lesson-plans/upload] insert failed:", insErr)
      return NextResponse.json({ error: "Could not record the submission." }, { status: 500 })
    }

    // Confirmation emails (best-effort; never block a successful submission).
    let emailed = false
    try {
      emailed = await sendConfirmationEmails({
        code,
        teacherName: teacherName || caller.email || "Teacher",
        teacherEmail: caller.email,
        subject,
        grade,
        weekDate,
        files: [lessonPlanName, pptName].filter(Boolean) as string[],
        lessonPlanUrl,
        pptUrl,
      })
    } catch (e) {
      console.error("[lesson-plans/upload] email failed:", e)
    }

    return NextResponse.json({
      success: true,
      submissionCode: code,
      submittedAt: new Date().toISOString(),
      files: [lessonPlanName, pptName].filter(Boolean),
      lessonPlanUrl,
      pptUrl,
      status,
      driveConfigured: driveEnabled,
      driveError,
      driveFolderId: DEFAULT_LESSON_PLANS_FOLDER_ID,
      emailed,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 },
    )
  }
}

async function sendConfirmationEmails(p: {
  code: string
  teacherName: string
  teacherEmail: string | null
  subject: string
  grade: string
  weekDate: string
  files: string[]
  lessonPlanUrl: string | null
  pptUrl: string | null
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false
  const from = process.env.LESSON_PLAN_FROM_EMAIL || "Ihlamudheen Madrasa <onboarding@resend.dev>"
  // Supports one or more admin recipients, comma/semicolon separated, e.g.
  // LESSON_PLAN_ADMIN_EMAIL="admin1@example.com, admin2@example.com"
  const adminEmails = (process.env.LESSON_PLAN_ADMIN_EMAIL || "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)

  const { Resend } = await import("resend")
  const resend = new Resend(apiKey)

  // De-duplicate so an admin who is also the teacher isn't emailed twice.
  const recipients = Array.from(
    new Set([p.teacherEmail, ...adminEmails].filter(Boolean) as string[]),
  )
  if (recipients.length === 0) return false

  const links: string[] = []
  if (p.lessonPlanUrl) links.push(`<li>Lesson Plan: <a href="${p.lessonPlanUrl}">${p.lessonPlanUrl}</a></li>`)
  if (p.pptUrl) links.push(`<li>PPT: <a href="${p.pptUrl}">${p.pptUrl}</a></li>`)

  const html = [
    '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9f6f0;">',
    '  <div style="background:#1e3a5f;color:#fff;border-radius:8px;padding:20px;text-align:center;">',
    '    <div style="font-size:18px;font-weight:800;">Ihlamudheen Madrasa</div>',
    '    <div style="font-size:12px;opacity:.85;">Ihlamudheen Madrasa · Malappuram, Kerala</div>',
    "  </div>",
    '  <div style="background:#fff;border-radius:8px;padding:24px;margin-top:16px;">',
    "    <h2 style=\"margin:0 0 12px;color:#1e3a5f;\">Lesson Plan / PPT — Submitted Successfully</h2>",
    `    <p>Dear ${p.teacherName},</p>`,
    "    <p>Your submission has been received and recorded. Details:</p>",
    "    <ul>",
    `      <li><strong>Submission ID:</strong> ${p.code}</li>`,
    `      <li><strong>Date &amp; Time:</strong> ${new Date().toLocaleString("en-GB")}</li>`,
    `      <li><strong>Subject:</strong> ${p.subject}</li>`,
    p.grade ? `      <li><strong>Grade:</strong> ${p.grade}</li>` : "",
    `      <li><strong>Week / Date:</strong> ${p.weekDate}</li>`,
    `      <li><strong>Files:</strong> ${p.files.join(", ") || "—"}</li>`,
    "    </ul>",
    links.length ? `    <p><strong>Drive links:</strong></p><ul>${links.join("")}</ul>` : "",
    '    <p style="color:#3a7a3a;font-weight:700;">Status: Submitted Successfully</p>',
    "  </div>",
    "</div>",
  ]
    .filter(Boolean)
    .join("")

  await resend.emails.send({
    from,
    to: recipients,
    subject: `Lesson Plan Submitted — ${p.subject} (${p.code})`,
    html,
  })
  return true
}
