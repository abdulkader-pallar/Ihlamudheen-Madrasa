"use client"

import { useState, useEffect, useCallback } from "react"
import { BookUp, Loader2, CheckCircle2, FileText } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { authFetch } from "@/lib/api-client"
import { uploadLessonPlanFile, LESSON_PLAN_MAX_MB } from "@/lib/storage"
import * as db from "@/lib/db"
import type { ClassData } from "@/data/courses"
import { toast } from "sonner"

const COURSES: { id: string; title: string }[] = [
  { id: "4", title: "Ihlamudheen Madrasa" },
  { id: "1", title: "Ihlamudheen Madrasa" },
  { id: "2", title: "Ihlamudheen Madrasa" },
  { id: "3", title: "CIBIS CERTIFICATION" },
]

interface DriveStatus {
  method?: "oauth" | "service_account"
  oauthConfigured?: boolean
  connected?: boolean
  configured: boolean
  ok: boolean
  canWrite?: boolean
  folderName?: string
  email?: string
  serviceAccountEmail?: string
  error?: string
}

interface Confirmation {
  submissionCode: string
  submittedAt: string
  files: string[]
  status: string
  driveConfigured: boolean
  driveError?: string | null
  driveFolderId?: string
  emailed: boolean
}

export default function LessonPlansPage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const allowed = role === "admin" || role === "accountant" || role === "teacher"

  const [courseId, setCourseId] = useState("")
  const [classes, setClasses] = useState<ClassData[]>([])
  const [classId, setClassId] = useState("")
  const [subject, setSubject] = useState("")
  const [weekDate, setWeekDate] = useState(new Date().toISOString().split("T")[0])
  const [lessonPlan, setLessonPlan] = useState<File | null>(null)
  const [ppt, setPpt] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<Confirmation | null>(null)
  const [drive, setDrive] = useState<DriveStatus | null>(null)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    if (!courseId) { setClasses([]); return }
    db.fetchClasses(courseId).then(setClasses)
  }, [courseId])

  const loadDriveStatus = useCallback(() => {
    if (role !== "admin" && role !== "accountant") return
    authFetch("/api/lesson-plans/drive-status")
      .then((r) => r.json())
      .then(setDrive)
      .catch(() => {})
  }, [role])

  // Show whether Google Drive is connected (admin/accountant only).
  useEffect(() => { loadDriveStatus() }, [loadDriveStatus])

  // Handle the OAuth callback redirect (?drive=connected|error).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const d = params.get("drive")
    if (!d) return
    if (d === "connected") toast.success(`Google Drive connected${params.get("email") ? ` as ${params.get("email")}` : ""}.`)
    else if (d === "error") toast.error(`Google Drive connection failed: ${params.get("msg") || "unknown error"}`)
    window.history.replaceState({}, "", "/dashboard/lesson-plans")
    loadDriveStatus()
  }, [loadDriveStatus])

  const connectDrive = async () => {
    setConnecting(true)
    try {
      const res = await authFetch("/api/lesson-plans/oauth/start")
      const json = await res.json()
      if (!res.ok || !json.url) { toast.error(json.error || "Could not start Google sign-in."); setConnecting(false); return }
      window.location.href = json.url
    } catch {
      toast.error("Could not start Google sign-in.")
      setConnecting(false)
    }
  }

  const submit = async () => {
    if (!subject.trim()) { toast.error("Subject is required."); return }
    if (!lessonPlan && !ppt) { toast.error("Attach a lesson plan or a PPT."); return }
    setSubmitting(true)

    try {
      // 1) Upload files straight to Supabase Storage (bypasses the serverless
      //    request-body limit, so large PPTs go through smoothly).
      let lessonPlanPath = "", pptPath = ""
      if (lessonPlan) {
        const up = await uploadLessonPlanFile(lessonPlan)
        if (up.error) { toast.error(up.error); setSubmitting(false); return }
        lessonPlanPath = up.path
      }
      if (ppt) {
        const up = await uploadLessonPlanFile(ppt)
        if (up.error) { toast.error(up.error); setSubmitting(false); return }
        pptPath = up.path
      }

      // 2) Record the submission + mirror to Drive (small JSON body).
      const res = await authFetch("/api/lesson-plans/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          grade: classes.find((c) => c.id === classId)?.name || "",
          courseId,
          courseName: COURSES.find((c) => c.id === courseId)?.title || "",
          classId,
          weekDate,
          teacherName: (user?.user_metadata?.full_name as string) || (user?.user_metadata?.name as string) || "",
          lessonPlanPath,
          lessonPlanName: lessonPlan?.name || "",
          pptPath,
          pptName: ppt?.name || "",
        }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error || "Upload failed"); setSubmitting(false); return }
      setDone(json as Confirmation)
    } catch {
      toast.error("Network error during upload.")
    }
    setSubmitting(false)
  }

  if (!user) return null
  if (!allowed) {
    return <div className="p-6"><Card><CardContent className="p-8 text-center text-navy-300">
      Restricted to teachers, accountant and admin.
    </CardContent></Card></div>
  }

  if (done) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <Card><CardContent className="p-8 text-center space-y-3">
          <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
          <h1 className="text-xl font-bold">Submitted Successfully</h1>
          <div className="text-left inline-block mt-2 text-sm space-y-1">
            <div><span className="text-navy-300">Submission ID:</span> <span className="font-mono">{done.submissionCode}</span></div>
            <div><span className="text-navy-300">Date &amp; Time:</span> {new Date(done.submittedAt).toLocaleString("en-GB")}</div>
            <div><span className="text-navy-300">Files:</span> {done.files.join(", ") || "—"}</div>
            <div><span className="text-navy-300">Status:</span> {done.status}</div>
          </div>
          {!done.driveConfigured && (
            <p className="text-xs text-amber-400">Recorded. Google Drive upload is pending server configuration — the file will be linked once enabled.</p>
          )}
          {done.driveConfigured && done.status === "partial" && done.driveError && (
            <div className="text-xs text-amber-400 break-words">
              <p>File saved, but the Google Drive copy failed:</p>
              <p className="font-mono mt-1 text-amber-300">{done.driveError}</p>
              {done.driveFolderId && <p className="mt-1 text-navy-400">Target folder id: {done.driveFolderId}</p>}
            </div>
          )}
          {!done.emailed && (
            <p className="text-xs text-amber-400">Confirmation email is pending email configuration.</p>
          )}
          <div className="pt-3">
            <Button onClick={() => { setDone(null); setSubject(""); setLessonPlan(null); setPpt(null) }}>Submit another</Button>
          </div>
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
        <BookUp className="h-6 w-6 text-emerald-500" /> Lesson Plan / PPT Submission
      </h1>

      {drive && !drive.ok && (
        <div className="rounded-md px-3 py-2 text-sm bg-amber-500/10 text-amber-300">
          <div className="space-y-2">
              {drive.connected ? (
                <p>Google Drive is connected but the upload test failed.{drive.error ? <span className="block opacity-80 mt-1">{drive.error}</span> : null}</p>
              ) : drive.serviceAccountEmail && drive.error ? (
                <p>Service-account upload won&apos;t work on a personal Google account. Connect your own Google account instead.<span className="block opacity-80 mt-1">{drive.error}</span></p>
              ) : (
                <p>Google Drive isn&apos;t connected yet. Files are saved to storage meanwhile. Connect your Google account so submissions are saved to your Drive.</p>
              )}
              {(role === "admin") && (
                drive.oauthConfigured ? (
                  <Button size="sm" onClick={connectDrive} disabled={connecting}>
                    {connecting ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Opening Google…</> : (drive.connected ? "Reconnect Google Drive" : "Connect Google Drive")}
                  </Button>
                ) : (
                  <p className="text-xs opacity-80">Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (and add the callback URL to the OAuth client) to enable the connect button.</p>
                )
              )}
          </div>
        </div>
      )}

      <Card><CardContent className="p-4 space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="min-w-0">
            <Label className="text-xs">Course</Label>
            <Select value={courseId} onValueChange={(v) => { setCourseId(v ?? ""); setClassId("") }}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select course">{(v) => COURSES.find((c) => c.id === v)?.title ?? "Select course"}</SelectValue></SelectTrigger>
              <SelectContent>{COURSES.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="min-w-0">
            <Label className="text-xs">Grade / Class</Label>
            <Select value={classId} onValueChange={(v) => setClassId(v ?? "")} disabled={!classes.length}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select class">{(v) => classes.find((c) => c.id === v)?.name ?? "Select class"}</SelectValue></SelectTrigger>
              <SelectContent>{classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="min-w-0">
            <Label className="text-xs">Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Arabic" />
          </div>
          <div className="min-w-0">
            <Label className="text-xs">Week / Date</Label>
            <Input type="date" value={weekDate} onChange={(e) => setWeekDate(e.target.value)} />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="min-w-0">
            <Label className="text-xs flex items-center gap-1"><FileText className="h-3 w-3" /> Lesson Plan (PDF/Doc)</Label>
            <Input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setLessonPlan(e.target.files?.[0] || null)} />
          </div>
          <div className="min-w-0">
            <Label className="text-xs flex items-center gap-1"><FileText className="h-3 w-3" /> PPT</Label>
            <Input type="file" accept=".ppt,.pptx,.pdf" onChange={(e) => setPpt(e.target.files?.[0] || null)} />
          </div>
        </div>
        <p className="text-xs text-navy-400">Up to {LESSON_PLAN_MAX_MB} MB per file.</p>

        <Button onClick={submit} disabled={submitting} className="w-full sm:w-auto">
          {submitting ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Uploading…</> : "Submit"}
        </Button>
      </CardContent></Card>
    </div>
  )
}
