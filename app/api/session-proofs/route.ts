// Session proofs for online classes (July/August online months).
//
// The screenshot file itself goes straight from the browser to the private
// 'session-proofs' storage bucket (RLS-gated to staff, same pattern as
// lesson-plans). This route then records the proof METADATA row — and that
// write is service-role only, because ownership (caller email → teacher_id)
// is an app-level mapping RLS cannot express:
//
//   POST   → attach a proof to one of the caller's own online attendance
//            records (admin/accountant may attach for any teacher)
//   DELETE → remove a proof: uploader while the record is still unverified,
//            admin/accountant anytime (also removes the stored screenshot)
//
// Reads need no route: the table has a staff SELECT policy, so the grid and
// dialogs query it with the normal client (see db.fetchSessionProofs).

import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { requireRole } from "@/lib/api-auth"
import { resolveTeacherIdByEmail } from "@/lib/teacher-identity"
import { validateProofPayload } from "@/lib/session-proof"
import { initialTeachers } from "@/data/courses"
import { uploadToDrive, isDriveConfigured, DEFAULT_LESSON_PLANS_FOLDER_ID } from "@/lib/google-drive"
import { getOAuthConnection, uploadToDriveOAuth } from "@/lib/google-oauth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BUCKET = "session-proofs"

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function POST(request: Request) {
  const guard = await requireRole(request, ["teacher", "admin", "accountant"])
  if (guard.error) return guard.error
  const caller = guard.caller

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured on server" }, { status: 500 })
  }
  const supabase = getSupabase()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const date = typeof body.date === "string" ? body.date : ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 })
  }

  const validated = validateProofPayload({
    session: typeof body.session === "string" ? body.session : "",
    storagePath: typeof body.storagePath === "string" ? body.storagePath : null,
    meetLink: typeof body.meetLink === "string" ? body.meetLink : null,
    note: typeof body.note === "string" ? body.note : null,
    classLabel: typeof body.classLabel === "string" ? body.classLabel : null,
    studentsPresent: typeof body.studentsPresent === "number" ? body.studentsPresent : null,
  })
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })
  const proof = validated.value

  // ── Whose record is this proof for? ──
  // Teachers may only attach proofs to their OWN records; admin/accountant
  // may pass an explicit teacherId to attach on a teacher's behalf.
  const ownTeacherId = resolveTeacherIdByEmail(caller.email)
  const isReviewer = caller.role === "admin" || caller.role === "accountant"
  const requestedTeacherId = typeof body.teacherId === "string" && body.teacherId ? body.teacherId : null
  const teacherId = isReviewer ? (requestedTeacherId ?? ownTeacherId) : ownTeacherId

  if (!teacherId) {
    return NextResponse.json({ error: "Your account is not linked to a staff profile — contact admin" }, { status: 404 })
  }
  if (!isReviewer && requestedTeacherId && requestedTeacherId !== ownTeacherId) {
    return NextResponse.json({ error: "You can only attach proofs to your own sessions" }, { status: 403 })
  }

  // ── The proof must hang off a real checked-in ONLINE session ──
  const { data: att, error: attErr } = await supabase
    .from("staff_attendance")
    .select("id, session_type")
    .eq("teacher_id", teacherId)
    .eq("date", date)
    .eq("session", proof.session)
    .maybeSingle()
  if (attErr) return NextResponse.json({ error: attErr.message }, { status: 500 })
  if (!att) {
    return NextResponse.json({ error: "No check-in found for that session — check in first, then attach the proof" }, { status: 404 })
  }
  if (att.session_type !== "online") {
    return NextResponse.json({ error: "Proofs are only collected for online sessions" }, { status: 400 })
  }

  // ── The storage object must exist and belong to this teacher's folder ──
  // (prevents registering someone else's upload, or a path that was never
  // uploaded — the client uploads to `<teacherId>/<date>/<session>/…`).
  if (proof.storagePath) {
    const expectedPrefix = `${teacherId}/${date}/${proof.session}/`
    if (!proof.storagePath.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: "Screenshot path does not match this session" }, { status: 400 })
    }
    const folder = proof.storagePath.slice(0, proof.storagePath.lastIndexOf("/"))
    const name = proof.storagePath.slice(proof.storagePath.lastIndexOf("/") + 1)
    const { data: objects, error: listErr } = await supabase.storage.from(BUCKET).list(folder, { search: name })
    if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })
    if (!objects?.some((o) => o.name === name)) {
      return NextResponse.json({ error: "Screenshot upload not found — try uploading again" }, { status: 400 })
    }
  }

  const { data: inserted, error: insErr } = await supabase
    .from("session_proofs")
    .insert({
      teacher_id: teacherId,
      date,
      session: proof.session,
      storage_path: proof.storagePath,
      meet_link: proof.meetLink,
      note: proof.note,
      class_label: proof.classLabel,
      students_present: proof.studentsPresent,
      uploaded_by: caller.email ?? caller.id,
    })
    .select("id")
    .single()
  if (insErr) {
    if (insErr.code === "42P01") {
      return NextResponse.json({ error: "session_proofs table missing — run migration 20260708000000 in the Supabase SQL editor" }, { status: 500 })
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  // ── Best-effort mirror of the screenshot into the institute Drive ──
  // Same root folder as lesson plans / PPTs, filed under
  //   Online Class Proof / <Grade-Division> /
  // (folders are created on demand). Failures never lose the proof — the
  // screenshot stays in the Supabase bucket and the row is already saved.
  // Mirrors the lesson-plans upload route: prefer the institute's OAuth
  // connection, fall back to the service account.
  let driveLink: string | null = null
  let driveError: string | null = null
  if (proof.storagePath) {
    try {
      const oauth = await getOAuthConnection()
      const driveEnabled = oauth.connected || isDriveConfigured()
      if (driveEnabled) {
        const putToDrive = oauth.connected ? uploadToDriveOAuth : uploadToDrive
        const { data: fileData, error: dlErr } = await supabase.storage.from(BUCKET).download(proof.storagePath)
        if (dlErr || !fileData) throw new Error(dlErr?.message || "storage download failed")

        const teacherName = initialTeachers.find((t) => t.id === teacherId)?.name ?? teacherId
        const originalName = proof.storagePath.slice(proof.storagePath.lastIndexOf("/") + 1)
        const up = await putToDrive(
          {
            name: `${date} — ${proof.session} — ${teacherName} — ${originalName}`,
            mimeType: fileData.type || "image/png",
            bytes: Buffer.from(await fileData.arrayBuffer()),
          },
          DEFAULT_LESSON_PLANS_FOLDER_ID,
          ["Online Class Proof", proof.classLabel || "Unsorted class"],
        )
        driveLink = up.webViewLink || `https://drive.google.com/file/d/${up.id}/view`

        // Record the link; tolerate the drive_link column not existing yet
        // (migration 20260708150000 not run) — the Drive copy still exists.
        const { error: updErr } = await supabase
          .from("session_proofs")
          .update({ drive_link: driveLink })
          .eq("id", inserted.id)
        if (updErr && !(updErr.code === "42703" || /drive_link/.test(updErr.message))) {
          console.error("[session-proofs] drive_link update failed:", updErr.message)
        }
      }
    } catch (e) {
      driveError = e instanceof Error ? e.message : String(e)
      console.error("[session-proofs] Drive mirror failed:", driveError)
    }
  }

  return NextResponse.json({ ok: true, id: inserted.id, driveLink, driveError })
}

export async function DELETE(request: Request) {
  const guard = await requireRole(request, ["teacher", "admin", "accountant"])
  if (guard.error) return guard.error
  const caller = guard.caller

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured on server" }, { status: 500 })
  }
  const supabase = getSupabase()

  const id = new URL(request.url).searchParams.get("id") ?? ""
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const { data: proof, error: getErr } = await supabase
    .from("session_proofs")
    .select("id, teacher_id, date, session, storage_path, uploaded_by")
    .eq("id", id)
    .maybeSingle()
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 })
  if (!proof) return NextResponse.json({ error: "Proof not found" }, { status: 404 })

  const isReviewer = caller.role === "admin" || caller.role === "accountant"
  if (!isReviewer) {
    if (proof.uploaded_by !== (caller.email ?? caller.id)) {
      return NextResponse.json({ error: "You can only remove proofs you uploaded" }, { status: 403 })
    }
    // Once the day is verified the evidence is frozen — only admin may touch it.
    const { data: att } = await supabase
      .from("staff_attendance")
      .select("verified_by")
      .eq("teacher_id", proof.teacher_id)
      .eq("date", proof.date)
      .eq("session", proof.session)
      .maybeSingle()
    if (att?.verified_by) {
      return NextResponse.json({ error: "This session is already verified — ask admin to change its evidence" }, { status: 403 })
    }
  }

  const { error: delErr } = await supabase.from("session_proofs").delete().eq("id", id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  if (proof.storage_path) {
    // Best-effort: a dangling object is invisible (bucket is private) and can
    // be cleaned later; the metadata row is already gone.
    await supabase.storage.from(BUCKET).remove([proof.storage_path])
  }

  return NextResponse.json({ ok: true })
}
