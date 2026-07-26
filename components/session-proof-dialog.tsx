"use client"

// Add-proof dialog for an online class session (July/August online months).
// Opened from the My Attendance "Today" card after a check-in exists. The
// screenshot goes straight to the private 'session-proofs' bucket, then the
// metadata row is created via POST /api/session-proofs (which validates the
// path and that the session was really checked in).

import { useState, useEffect, useMemo } from "react"
import { Camera, Link2, Loader2, Upload, X } from "lucide-react"
import { initialTeachers, initialCourses } from "@/data/courses"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { uploadSessionProofImage } from "@/lib/storage"
import { validateProofPayload, PROOF_NOTE_MAX } from "@/lib/session-proof"
import { authFetch } from "@/lib/api-client"
import { toast } from "sonner"

export function SessionProofDialog({
  open,
  onOpenChange,
  teacherId,
  date,
  session,
  sessionLabel,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teacherId: string
  date: string // YYYY-MM-DD (server UAE date)
  session: string
  sessionLabel: string
  onSaved: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [meetLink, setMeetLink] = useState("")
  const [note, setNote] = useState("")
  const [studentsPresent, setStudentsPresent] = useState("")
  const [classLabel, setClassLabel] = useState("")
  const [busy, setBusy] = useState(false)

  // The teacher's own classes — the proof must say WHICH grade/division was
  // taught (drives the admin report and the Drive "Online Class Proof" filing).
  const classOptions = useMemo(() => {
    const t = initialTeachers.find((x) => x.id === teacherId)
    if (!t || t.classIds.length === 0) return []
    const opts: string[] = []
    for (const course of initialCourses) {
      for (const cls of course.classes) {
        if (t.classIds.includes(cls.id)) opts.push(cls.name)
      }
    }
    return opts
  }, [teacherId])

  // Reset per open so a second proof starts clean
  useEffect(() => {
    if (!open) return
    setFile(null)
    setPreview(null)
    setMeetLink("")
    setNote("")
    setStudentsPresent("")
    setClassLabel("")
  }, [open])

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const submit = async () => {
    // The grade/division is required — it drives the admin per-class report
    // and files the proof into the right Drive subfolder.
    if (!classLabel.trim()) {
      toast.error("Select which class this proof is for")
      return
    }

    // Local pre-check with the exact same rules the server applies
    const dryRun = validateProofPayload({
      session,
      storagePath: file ? "pending" : null,
      meetLink: meetLink || null,
      note: note || null,
      classLabel: classLabel || null,
      studentsPresent: studentsPresent === "" ? null : Number(studentsPresent),
    })
    if (!dryRun.ok) {
      toast.error(dryRun.error)
      return
    }

    setBusy(true)
    try {
      let storagePath: string | null = null
      if (file) {
        const up = await uploadSessionProofImage(teacherId, date, session, file)
        if (up.error) {
          toast.error(up.error)
          return
        }
        storagePath = up.path
      }

      const res = await authFetch("/api/session-proofs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          session,
          storagePath,
          meetLink: meetLink || null,
          note: note || null,
          classLabel: classLabel || null,
          studentsPresent: studentsPresent === "" ? null : Number(studentsPresent),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? "Could not save the proof — try again")
        return
      }
      toast.success("Class proof saved")
      onSaved()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-700 bg-navy-900 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Camera className="size-5 text-teal-400" />
            Class proof — {sessionLabel}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Attach a screenshot of the Google Meet participant grid and/or the Meet link so admin can
            verify the class was conducted. A note alone is not accepted as proof.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Which grade/division was taught — required */}
          <label className="block text-xs font-medium text-slate-300">
            Class (grade &amp; division)
            {classOptions.length > 0 ? (
              <select
                value={classLabel}
                onChange={(e) => setClassLabel(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-navy-950 px-2 py-1.5 text-xs text-white focus:outline-none"
              >
                <option value="" disabled>
                  Select the class you taught
                </option>
                {classOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={classLabel}
                onChange={(e) => setClassLabel(e.target.value)}
                placeholder="e.g. Grade 5B"
                className="mt-1 w-full rounded-md border border-slate-700 bg-navy-950 px-2 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none"
              />
            )}
          </label>

          {/* Screenshot */}
          <div>
            <label className="text-xs font-medium text-slate-300">Meet screenshot</label>
            {preview ? (
              <div className="relative mt-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Proof preview" className="max-h-48 w-full rounded-lg border border-slate-700 object-contain bg-navy-950" />
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="absolute right-2 top-2 rounded-full bg-navy-900/90 p-1 text-slate-300 hover:text-white"
                  aria-label="Remove screenshot"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <label className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-600 px-3 py-6 text-xs text-slate-400 hover:border-teal-500 hover:text-teal-300">
                <Upload className="size-4" />
                Tap to choose the screenshot
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>

          {/* Meet link */}
          <label className="block text-xs font-medium text-slate-300">
            Google Meet link
            <div className="mt-1 flex items-center gap-2 rounded-md border border-slate-700 bg-navy-950 px-2">
              <Link2 className="size-3.5 shrink-0 text-slate-500" />
              <input
                type="url"
                value={meetLink}
                onChange={(e) => setMeetLink(e.target.value)}
                placeholder="https://meet.google.com/…"
                className="w-full min-w-0 bg-transparent py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none"
              />
            </div>
          </label>

          {/* Students present + note */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="w-32 min-w-0 text-xs font-medium text-slate-300">
              Students present
              <input
                type="number"
                min={0}
                max={500}
                value={studentsPresent}
                onChange={(e) => setStudentsPresent(e.target.value)}
                placeholder="e.g. 18"
                className="mt-1 w-full rounded-md border border-slate-700 bg-navy-950 px-2 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none"
              />
            </label>
            <label className="min-w-0 flex-1 text-xs font-medium text-slate-300">
              Note (optional)
              <input
                type="text"
                value={note}
                maxLength={PROOF_NOTE_MAX}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Covered lesson 4"
                className="mt-1 w-full rounded-md border border-slate-700 bg-navy-950 px-2 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none"
              />
            </label>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !classLabel.trim() || (!file && !meetLink.trim())} className="bg-teal-600 text-white hover:bg-teal-500">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            Save proof
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
