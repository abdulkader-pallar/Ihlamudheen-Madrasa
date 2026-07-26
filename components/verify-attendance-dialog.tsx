"use client"

// Admin/accountant review dialog for ONLINE self check-in records.
// Opened from a day cell in the Staff Attendance grid. Lets the reviewer fix
// arrival/departure times, mark a record absent, adjust credited sessions,
// and stamp the whole day as verified (verified_by/verified_at).
// Shows the teacher's session proofs (Meet screenshot / link) next to each
// record so "properly done vs just checked in" is a one-glance decision.

import { useState, useEffect } from "react"
import { Camera, CheckCircle2, ExternalLink, Link2, Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import * as db from "@/lib/db"
import { getSessionProofUrl } from "@/lib/storage"
import { classifySessionEvidence, uploadDelayDays } from "@/lib/session-proof"
import { toast } from "sonner"

const SESSION_LABEL: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  cibis: "CIBIS",
  "edu-makeup": "Makeup",
  full: "Full Day",
}

interface RecordDraft {
  session: string
  arrival: string
  departure: string
  status: "present" | "absent" | "late"
  sessionsCredited: number
  sessionType: "online" | "offline"
  verifiedBy: string | null
  remarks?: string
  dirty: boolean
}

export function VerifyAttendanceDialog({
  open,
  onOpenChange,
  teacherId,
  teacherName,
  date,
  records,
  reviewerEmail,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  teacherId: string
  teacherName: string
  date: string // YYYY-MM-DD
  records: db.StaffAttendanceEntry[]
  reviewerEmail: string
  onSaved: () => void
}) {
  const [drafts, setDrafts] = useState<RecordDraft[]>([])
  const [busy, setBusy] = useState(false)

  // Session proofs for this teacher/day + signed URLs for the screenshots
  const [proofs, setProofs] = useState<db.SessionProofEntry[]>([])
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setDrafts(
      records.map((r) => ({
        session: r.session,
        arrival: r.arrivalTime ?? "",
        departure: r.departureTime ?? "",
        status: r.status,
        sessionsCredited: r.sessionsCredited ?? 1,
        sessionType: r.sessionType,
        verifiedBy: r.verifiedBy ?? null,
        remarks: r.remarks,
        dirty: false,
      }))
    )
  }, [open, records])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setProofs([])
    setProofUrls({})
    ;(async () => {
      const res = await db.fetchSessionProofsForDay(teacherId, date)
      if (cancelled || res.error) return
      setProofs(res.data)
      const urls: Record<string, string> = {}
      await Promise.all(
        res.data
          .filter((p) => p.storagePath)
          .map(async (p) => {
            const url = await getSessionProofUrl(p.storagePath!)
            if (url) urls[p.storagePath!] = url
          })
      )
      if (!cancelled) setProofUrls(urls)
    })()
    return () => {
      cancelled = true
    }
  }, [open, teacherId, date])

  const patchDraft = (i: number, patch: Partial<RecordDraft>) =>
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch, dirty: true } : d)))

  const saveDraft = async (d: RecordDraft) => {
    setBusy(true)
    const res = await db.adminOverrideStaffAttendance({
      teacherId,
      date,
      session: d.session,
      arrivalTime: d.arrival || null,
      departureTime: d.departure || null,
      status: d.status,
      sessionsCredited: d.sessionsCredited,
      verifiedBy: reviewerEmail,
    })
    setBusy(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success("Record updated")
    onSaved()
  }

  const verifyDay = async () => {
    setBusy(true)
    const res = await db.verifyStaffAttendanceDay(teacherId, date, reviewerEmail)
    setBusy(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success("Day verified")
    onSaved()
    onOpenChange(false)
  }

  const hasUnverifiedOnline = drafts.some((d) => d.sessionType === "online" && !d.verifiedBy)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-teal-500" />
            <span className="truncate">{teacherName}</span>
          </DialogTitle>
          <DialogDescription>
            {new Date(date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}{" "}
            — review online self check-ins and their class proofs, correct times if needed, then verify.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {drafts.map((d, i) => (
            <div
              key={d.session}
              className={cn(
                "rounded-xl border p-3 space-y-2",
                d.sessionType === "online" && !d.verifiedBy
                  ? "border-amber-400/60 bg-amber-50/40 dark:bg-amber-500/5"
                  : "border-navy-200 dark:border-navy-700"
              )}
            >
              {/* Row header */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-navy-900 dark:text-white">
                  {SESSION_LABEL[d.session] ?? d.session}
                </span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    d.sessionType === "online"
                      ? "bg-teal-500/15 text-teal-600 dark:text-teal-400"
                      : "bg-navy-200/60 text-navy-600 dark:bg-navy-700 dark:text-navy-300"
                  )}
                >
                  {d.sessionType}
                </span>
                {d.verifiedBy ? (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-3" /> verified
                  </span>
                ) : d.sessionType === "online" ? (
                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">pending verification</span>
                ) : null}
              </div>

              {/* Editable fields — each control stays inside its column */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="min-w-0 text-[10px] font-medium text-navy-500 dark:text-navy-400">
                  IN
                  <input
                    type="time"
                    value={d.arrival}
                    onChange={(e) => patchDraft(i, { arrival: e.target.value })}
                    className="mt-0.5 w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs text-navy-900 dark:text-white"
                  />
                </label>
                <label className="min-w-0 text-[10px] font-medium text-navy-500 dark:text-navy-400">
                  OUT
                  <input
                    type="time"
                    value={d.departure}
                    onChange={(e) => patchDraft(i, { departure: e.target.value })}
                    className="mt-0.5 w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs text-navy-900 dark:text-white"
                  />
                </label>
                <label className="min-w-0 text-[10px] font-medium text-navy-500 dark:text-navy-400">
                  Status
                  <select
                    value={d.status}
                    onChange={(e) => patchDraft(i, { status: e.target.value as RecordDraft["status"] })}
                    className="mt-0.5 w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs text-navy-900 dark:text-white dark:bg-navy-900"
                  >
                    <option value="present">Present</option>
                    <option value="late">Late</option>
                    <option value="absent">Absent</option>
                  </select>
                </label>
                <label className="min-w-0 text-[10px] font-medium text-navy-500 dark:text-navy-400">
                  Sessions
                  <select
                    value={d.sessionsCredited}
                    onChange={(e) => patchDraft(i, { sessionsCredited: Number(e.target.value) })}
                    className="mt-0.5 w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs text-navy-900 dark:text-white dark:bg-navy-900"
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                  </select>
                </label>
              </div>

              {/* Evidence: was the class properly done, or just checked in? */}
              {d.sessionType === "online" &&
                (() => {
                  const sessionProofs = proofs.filter((p) => p.session === d.session)
                  const verdict = classifySessionEvidence({
                    hasArrival: !!d.arrival,
                    hasDeparture: !!d.departure,
                    proofCount: sessionProofs.length,
                    verified: !!d.verifiedBy,
                  })
                  return (
                    <div className="space-y-1.5 rounded-lg bg-navy-50/60 p-2 dark:bg-navy-800/40">
                      <p
                        className={cn(
                          "text-[11px] font-medium",
                          verdict.attention
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-emerald-600 dark:text-emerald-400"
                        )}
                      >
                        {verdict.label}
                      </p>
                      {sessionProofs.map((p) => {
                        const delay = uploadDelayDays(date, p.createdAt)
                        return (
                          <div key={p.id} className="flex flex-wrap items-start gap-2">
                            {p.storagePath &&
                              (proofUrls[p.storagePath] ? (
                                <a href={proofUrls[p.storagePath]} target="_blank" rel="noopener noreferrer" className="block shrink-0">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={proofUrls[p.storagePath]}
                                    alt="Class proof screenshot"
                                    className="h-16 max-w-full rounded border border-navy-200 object-cover dark:border-navy-700"
                                  />
                                </a>
                              ) : (
                                <span className="flex items-center gap-1 text-[10px] text-navy-400">
                                  <Camera className="size-3" /> loading screenshot…
                                </span>
                              ))}
                            <div className="min-w-0 flex-1 space-y-0.5 text-[10px] text-navy-500 dark:text-navy-400">
                              {p.meetLink && (
                                <a
                                  href={p.meetLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 truncate text-teal-600 underline dark:text-teal-400"
                                >
                                  <Link2 className="size-3 shrink-0" />
                                  <span className="truncate">{p.meetLink}</span>
                                  <ExternalLink className="size-3 shrink-0" />
                                </a>
                              )}
                              {p.driveLink && (
                                <a
                                  href={p.driveLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-emerald-600 underline dark:text-emerald-400"
                                >
                                  <ExternalLink className="size-3 shrink-0" />
                                  Saved in Drive
                                </a>
                              )}
                              {p.studentsPresent != null && <p>{p.studentsPresent} students present</p>}
                              {p.classLabel && <p className="truncate">{p.classLabel}</p>}
                              {p.note && <p className="truncate">{p.note}</p>}
                              <p className="truncate">
                                by {p.uploadedBy}
                                {delay > 0 && (
                                  <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">
                                    · uploaded {delay} day{delay > 1 ? "s" : ""} after the class
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}

              {d.remarks && <p className="truncate text-[10px] text-navy-400 dark:text-navy-500">{d.remarks}</p>}

              {d.dirty && (
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => saveDraft(d)}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Save changes
                  </Button>
                </div>
              )}
            </div>
          ))}
          {drafts.length === 0 && (
            <p className="py-6 text-center text-sm text-navy-400">No records for this day.</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
          {hasUnverifiedOnline && (
            <Button
              onClick={verifyDay}
              disabled={busy}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              Verify day
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
