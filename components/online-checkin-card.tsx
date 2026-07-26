"use client"

// "Today" card on My Attendance — online self check-in for July/August online
// months. Renders nothing unless the server says the feature is enabled for
// the current UAE month. The server clock is authoritative: the client never
// sends a timestamp, it only asks the API to record "now".

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { Wifi, Clock, Info, LogIn, LogOut, Loader2, AlertTriangle, Camera, Link2, X } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
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
import { authFetch } from "@/lib/api-client"
import { SessionProofDialog } from "@/components/session-proof-dialog"
import { getSessionProofUrl } from "@/lib/storage"
import * as db from "@/lib/db"
import { toast } from "sonner"

interface TodayRecord {
  id: number
  session: string
  arrival_time: string | null
  departure_time: string | null
  sessions_credited: number | null
  out_missing: boolean | null
}

interface CheckinStatus {
  enabled: boolean
  month: string
  serverDate: string
  serverTime: string
  resolved: boolean
  teacherId: string | null
  teacherName: string | null
  disabled: boolean
  todayRecords: TodayRecord[]
  suggestedAction: "check-in" | "check-out"
}

const SESSION_LABEL: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  cibis: "CIBIS",
  "edu-makeup": "Makeup",
  full: "Full Day",
}

/** Live UAE wall-clock string "HH:MM:SS" (display only — server is authoritative) */
function uaeClock(): string {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(11, 19)
}

export function OnlineCheckinCard({ onRecorded }: { onRecorded?: () => void }) {
  const [status, setStatus] = useState<CheckinStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState<string | null>(null)
  const [clock, setClock] = useState(uaeClock)

  // Session proofs attached to today's records (screenshot / Meet link)
  const [proofs, setProofs] = useState<db.SessionProofEntry[]>([])
  const [proofTarget, setProofTarget] = useState<{ session: string; label: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/online-checkin")
      if (!res.ok) {
        setStatus(null)
        return
      }
      setStatus((await res.json()) as CheckinStatus)
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const loadProofs = useCallback(async () => {
    if (!status?.teacherId || !status.serverDate) return
    const res = await db.fetchSessionProofsForDay(status.teacherId, status.serverDate)
    if (!res.error) setProofs(res.data)
  }, [status?.teacherId, status?.serverDate])

  useEffect(() => {
    loadProofs()
  }, [loadProofs])

  const openProof = async (p: db.SessionProofEntry) => {
    const url = p.storagePath ? await getSessionProofUrl(p.storagePath) : p.meetLink
    if (url) window.open(url, "_blank", "noopener")
    else toast.error("Could not open the proof — try again")
  }

  const removeProof = async (p: db.SessionProofEntry) => {
    const res = await authFetch(`/api/session-proofs?id=${encodeURIComponent(p.id)}`, { method: "DELETE" })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.ok) {
      toast.error(body.error ?? "Could not remove the proof")
      return
    }
    toast.success("Proof removed")
    loadProofs()
  }

  // Tick the display clock every second while the card is visible
  useEffect(() => {
    if (!status?.enabled) return
    const t = setInterval(() => setClock(uaeClock()), 1000)
    return () => clearInterval(t)
  }, [status?.enabled])

  const punch = async () => {
    setPosting(true)
    setRejectReason(null)
    try {
      const res = await authFetch("/api/online-checkin", { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (body.ok) {
        toast.success(body.message ?? "Recorded")
        onRecorded?.()
      } else if (body.rejected) {
        setRejectReason(body.reason ?? "Not recorded")
      } else {
        toast.error(body.error ?? "Could not record — try again")
      }
    } catch {
      toast.error("Network error — try again")
    } finally {
      setPosting(false)
      setConfirmOpen(false)
      load()
    }
  }

  // Feature off / still loading / auth failed → render nothing (page stays as-is)
  if (loading || !status || !status.enabled) return null

  const isCheckIn = status.suggestedAction === "check-in"
  const actionLabel = isCheckIn ? "Check In" : "Check Out"

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="border-teal-500/30 bg-navy-900/80">
        <CardContent className="space-y-3 p-4">
          {/* Header row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Wifi className="size-4 shrink-0 text-teal-400" />
              <span className="truncate text-sm font-semibold text-white">Online Class — Today</span>
            </div>
            <span className="flex items-center gap-1.5 font-mono text-sm text-teal-300">
              <Clock className="size-3.5" />
              {clock}
              <span className="text-[10px] text-slate-500">UAE</span>
            </span>
          </div>

          {/* Unlinked / disabled guidance */}
          {!status.resolved ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <Info className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <p className="text-xs text-amber-200">
                Your account is not linked to a staff profile — contact admin to enable check-in.
              </p>
            </div>
          ) : status.disabled ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <Info className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <p className="text-xs text-amber-200">This staff profile is disabled — contact admin.</p>
            </div>
          ) : (
            <>
              {/* Today's recorded punches */}
              {status.todayRecords.length > 0 && (
                <div className="space-y-1">
                  {status.todayRecords.map((r) => {
                    const recordProofs = proofs.filter((p) => p.session === r.session)
                    return (
                      <div key={r.id} className="space-y-1 rounded-lg bg-navy-800/60 px-3 py-1.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span className="font-medium text-slate-300">
                            {SESSION_LABEL[r.session] ?? r.session}
                          </span>
                          <span className="text-slate-500">
                            IN{" "}
                            <span className={cn("font-mono", r.arrival_time ? "text-emerald-400" : "text-slate-600")}>
                              {r.arrival_time ?? "—"}
                            </span>
                          </span>
                          <span className="text-slate-500">
                            OUT{" "}
                            <span className={cn("font-mono", r.departure_time ? "text-slate-300" : "text-slate-600")}>
                              {r.departure_time ?? "—"}
                            </span>
                          </span>
                          {r.sessions_credited != null && r.departure_time && (
                            <span className="text-teal-400">
                              {r.sessions_credited} session{r.sessions_credited > 1 ? "s" : ""}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setProofTarget({ session: r.session, label: SESSION_LABEL[r.session] ?? r.session })
                            }
                            className={cn(
                              "ml-auto flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium",
                              recordProofs.length > 0
                                ? "border-teal-500/40 text-teal-300 hover:bg-teal-500/10"
                                : "border-amber-500/50 text-amber-300 hover:bg-amber-500/10"
                            )}
                          >
                            <Camera className="size-3" />
                            {recordProofs.length > 0 ? "Add another proof" : "Add class proof"}
                          </button>
                        </div>

                        {/* Attached proofs */}
                        {recordProofs.map((p) => (
                          <div key={p.id} className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                            {p.storagePath ? <Camera className="size-3 text-teal-400" /> : <Link2 className="size-3 text-teal-400" />}
                            <button type="button" onClick={() => openProof(p)} className="truncate underline hover:text-teal-300">
                              {p.storagePath ? "Screenshot" : "Meet link"}
                            </button>
                            {p.studentsPresent != null && <span>{p.studentsPresent} students</span>}
                            {p.note && <span className="truncate">· {p.note}</span>}
                            <button
                              type="button"
                              onClick={() => removeProof(p)}
                              className="ml-auto text-slate-500 hover:text-red-400"
                              aria-label="Remove proof"
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        ))}
                        {recordProofs.length === 0 && (
                          <p className="text-[10px] text-amber-400/80">
                            No proof yet — attach a Meet screenshot before ending the class.
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Rejection reason from the last attempt */}
              {rejectReason && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                  <p className="text-xs text-amber-200">{rejectReason}</p>
                </div>
              )}

              {/* Action */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500">
                  Times are recorded by the server in UAE time.
                </p>
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={posting}
                  className={cn(
                    "text-white",
                    isCheckIn ? "bg-teal-600 hover:bg-teal-500" : "bg-sky-600 hover:bg-sky-500"
                  )}
                >
                  {posting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : isCheckIn ? (
                    <LogIn className="size-4" />
                  ) : (
                    <LogOut className="size-4" />
                  )}
                  {actionLabel}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="border-slate-700 bg-navy-900 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">{actionLabel} now?</DialogTitle>
            <DialogDescription className="text-slate-400">
              Your {isCheckIn ? "check-in" : "check-out"} will be recorded at the server&apos;s current UAE
              time ({clock.slice(0, 5)}). You cannot edit this afterwards — only admin can.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={posting}>
              Cancel
            </Button>
            <Button
              onClick={punch}
              disabled={posting}
              className={cn("text-white", isCheckIn ? "bg-teal-600 hover:bg-teal-500" : "bg-sky-600 hover:bg-sky-500")}
            >
              {posting ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirm {actionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add-proof dialog for the tapped session */}
      {status.teacherId && proofTarget && (
        <SessionProofDialog
          open={!!proofTarget}
          onOpenChange={(o) => !o && setProofTarget(null)}
          teacherId={status.teacherId}
          date={status.serverDate}
          session={proofTarget.session}
          sessionLabel={proofTarget.label}
          onSaved={loadProofs}
        />
      )}
    </motion.div>
  )
}
