"use client"

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { CalendarOff, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import * as db from "@/lib/db"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { formatIsoDate } from "@/lib/date-format"

type Filter = "pending" | "approved" | "rejected" | "all"

export default function LeavePage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const isAdmin = role === "admin"

  const [filter, setFilter] = useState<Filter>("pending")
  const [rows, setRows] = useState<db.AttendanceRequest[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const param = filter === "all" ? undefined : filter
    const { data } = await db.fetchAttendanceRequests(param)
    setRows(data)
    setLoading(false)
  }, [filter])

  useEffect(() => {
    load()
  }, [load])

  const approve = async (r: db.AttendanceRequest) => {
    if (!user) return
    const res = await db.approveAttendanceRequest(r.id, user.email || user.id)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success("Approved")
    load()
  }

  const reject = async (r: db.AttendanceRequest) => {
    if (!user) return
    if (!window.confirm(`Reject leave request from ${r.teacherName}?`)) return
    const res = await db.rejectAttendanceRequest(r.id, user.email || user.id)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success("Rejected")
    load()
  }

  const chip = (f: Filter, label: string) => (
    <button
      onClick={() => setFilter(f)}
      className={cn(
        "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
        filter === f
          ? "bg-amber-500 text-white"
          : "bg-navy-100 text-navy-600 hover:bg-navy-200 dark:bg-navy-800 dark:text-navy-300",
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <CalendarOff className="size-7 text-amber-500" /> Leave Management
        </h1>
        <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
          Review and approve teacher attendance / leave requests.
        </p>
      </motion.div>

      <div className="flex flex-wrap gap-2">
        {chip("pending", "Pending")}
        {chip("approved", "Approved")}
        {chip("rejected", "Rejected")}
        {chip("all", "All")}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-amber-500" />
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-navy-400">
            No {filter === "all" ? "" : filter} requests.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const statusIcon =
              r.status === "approved" ? <CheckCircle2 className="size-4 text-emerald-500" /> :
              r.status === "rejected" ? <XCircle className="size-4 text-red-500" /> :
              <Clock className="size-4 text-amber-500" />
            return (
              <Card key={r.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-navy-900 dark:text-white">
                          {r.teacherName}
                        </h3>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-navy-500 dark:text-navy-400">
                          {statusIcon} {r.status}
                        </span>
                      </div>
                      <p className="text-xs text-navy-500 dark:text-navy-400 mt-0.5">
                        {formatIsoDate(r.date)} — submitted {new Date(r.submittedAt).toLocaleString("en-GB")}
                      </p>
                      {r.notes && (
                        <p className="text-sm text-navy-600 dark:text-navy-300 mt-2 whitespace-pre-wrap">
                          {r.notes}
                        </p>
                      )}
                      {r.reviewedBy && (
                        <p className="text-[11px] text-navy-400 mt-1">
                          Reviewed by {r.reviewedBy}
                          {r.reviewedAt && ` on ${new Date(r.reviewedAt).toLocaleDateString("en-GB")}`}
                        </p>
                      )}
                    </div>
                    {isAdmin && r.status === "pending" && (
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          onClick={() => approve(r)}
                          className="bg-emerald-500 hover:bg-emerald-600 text-white"
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => reject(r)}
                          className="border-red-300 text-red-500 hover:bg-red-50"
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
