"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Download, Loader2, AlertCircle, Clock, Calendar, Filter, X, AlertTriangle, RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/use-auth"
import { authFetch } from "@/lib/api-client"
import { toast } from "sonner"
import { createClient } from "@supabase/supabase-js"
import { initialTeachers, type TeacherData, ZK_DEVICE_ID_MAP } from "@/data/courses"

interface RawPunch {
  id: string
  device_user_id: number
  punch_date: string
  punch_time: string
  status: string | null
  late_category: string | null
  created_at: string
}

interface ProcessedAttendance {
  id: string
  teacher_id: string
  arrival_time: string
  departure_time: string | null
  date: string
  status: string
  late_category: string | null
}

interface PunchMatch {
  device_user_id: number
  employee_name: string
  punch_date: string
  punch_time: string
  status: "MATCHED" | "MISSING" | "FAILED"
  matched_status: string | null
  late_category: string | null
  reason: string
  raw_punch_id: string
}

export default function PunchRecordsPage() {
  useAuth(true)

  const [, setRawPunches] = useState<RawPunch[]>([])
  const [, setProcessedAttendance] = useState<ProcessedAttendance[]>([])
  const [matches, setMatches] = useState<PunchMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [reprocessResult, setReprocessResult] = useState<{
    summary: { total: number; recorded: number; skipped: number; errored: number }
    details: Array<{ deviceUserId: number; date: string; time: string; outcome: string; note?: string }>
  } | null>(null)

  // Filters
  const [startDate, setStartDate] = useState<string>("")
  const [endDate, setEndDate] = useState<string>("")
  const [userIdFilter, setUserIdFilter] = useState<string>("")
  const [statusFilter, setStatusFilter] = useState<"all" | "MATCHED" | "MISSING" | "FAILED">("all")

  // Teacher mapping
  const [teacherMap, setTeacherMap] = useState<Record<string, string>>({})

  // Load teacher/staff names
  useEffect(() => {
    async function loadStaffNames() {
      const teacherMap: Record<string, string> = {}

      // Add initial teachers
      initialTeachers.forEach((teacher: TeacherData) => {
        teacherMap[teacher.id] = teacher.name
      })

      // Try to fetch dynamic staff from database
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        const supabase = createClient(supabaseUrl, supabaseKey)

        const { data: staffData } = await supabase.from("staff_members").select("id, name")

        if (staffData) {
          staffData.forEach((staff: { id: string; name: string }) => {
            teacherMap[staff.id] = staff.name
          })
        }
      } catch {
        console.log("Note: Could not fetch additional staff names from database")
      }

      setTeacherMap(teacherMap)
    }

    loadStaffNames()
  }, [])

  // Fetch data and compare
  useEffect(() => {
    async function loadAndCompare() {
      try {
        setLoading(true)
        setError(null)

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        const supabase = createClient(supabaseUrl, supabaseKey)

        // Fetch raw punches
        const { data: rawData, error: rawError } = await supabase
          .from("zk_raw_punches")
          .select("*")
          .order("punch_date", { ascending: false })
          .order("punch_time", { ascending: false })

        if (rawError) throw new Error(`Raw punches: ${rawError.message}`)

        // Fetch processed attendance
        const { data: processedData, error: processedError } = await supabase
          .from("staff_attendance")
          .select("id, teacher_id, arrival_time, departure_time, date, status, late_category")

        if (processedError) throw new Error(`Attendance: ${processedError.message}`)

        const raw: RawPunch[] = (rawData || []).map((row: Record<string, unknown>) => ({
          id: String(row.id ?? Math.random()),
          device_user_id: row.device_user_id as number,
          punch_date: row.punch_date as string,
          punch_time: row.punch_time as string,
          status: (row.status as string) || null,
          late_category: (row.late_category as string) || null,
          created_at: row.created_at as string,
        }))

        const processed: ProcessedAttendance[] = (processedData || []).map((row: Record<string, unknown>) => ({
          id: row.id as string,
          teacher_id: row.teacher_id as string,
          arrival_time: row.arrival_time as string,
          departure_time: (row.departure_time as string) || null,
          date: row.date as string,
          status: row.status as string,
          late_category: (row.late_category as string) || null,
        }))

        setRawPunches(raw)
        setProcessedAttendance(processed)

        // Compare and match
        const matchResults: PunchMatch[] = raw.map((rawPunch) => {
          // Convert device user ID → teacher ID using the ZK map (e.g. 38 → "t38")
          const mappedTeacherId = ZK_DEVICE_ID_MAP[rawPunch.device_user_id]

          // Find matching processed records (exact match: mapped teacher_id + date + time)
          const matchedAttendance = mappedTeacherId
            ? processed.find(
                (att) =>
                  att.teacher_id === mappedTeacherId &&
                  att.date === rawPunch.punch_date &&
                  (att.arrival_time === rawPunch.punch_time || att.departure_time === rawPunch.punch_time),
              )
            : undefined

          const employeeName = mappedTeacherId
            ? (teacherMap[mappedTeacherId] || `User ${rawPunch.device_user_id}`)
            : `Unknown User ${rawPunch.device_user_id}`

          if (matchedAttendance) {
            return {
              device_user_id: rawPunch.device_user_id,
              employee_name: employeeName,
              punch_date: rawPunch.punch_date,
              punch_time: rawPunch.punch_time,
              status: "MATCHED",
              matched_status: matchedAttendance.status,
              late_category: matchedAttendance.late_category,
              reason: `Matched to attendance record (${matchedAttendance.status})`,
              raw_punch_id: rawPunch.id,
            }
          }

          // Check if it's a failed processing (no matching processed record)
          if (rawPunch.status === null) {
            return {
              device_user_id: rawPunch.device_user_id,
              employee_name: employeeName,
              punch_date: rawPunch.punch_date,
              punch_time: rawPunch.punch_time,
              status: "FAILED",
              matched_status: null,
              late_category: rawPunch.late_category,
              reason: `Punch captured but processing failed - no status assigned`,
              raw_punch_id: rawPunch.id,
            }
          }

          // Not found - this is a missing punch
          return {
            device_user_id: rawPunch.device_user_id,
            employee_name: employeeName,
            punch_date: rawPunch.punch_date,
            punch_time: rawPunch.punch_time,
            status: "MISSING",
            matched_status: null,
            late_category: rawPunch.late_category,
            reason: `Punch from device NOT recorded in attendance sheet`,
            raw_punch_id: rawPunch.id,
          }
        })

        setMatches(matchResults)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load punch records")
        toast.error("Failed to load punch records")
      } finally {
        setLoading(false)
      }
    }

    if (Object.keys(teacherMap).length > 0) {
      loadAndCompare()
    }
  }, [teacherMap, refreshNonce])

  // Apply filters
  const filtered = matches.filter((match) => {
    if (startDate && match.punch_date < startDate) return false
    if (endDate && match.punch_date > endDate) return false
    if (userIdFilter && match.device_user_id !== parseInt(userIdFilter, 10)) return false
    if (statusFilter !== "all" && match.status !== statusFilter) return false
    return true
  })

  // Statistics
  const stats = {
    total: matches.length,
    matched: matches.filter((m) => m.status === "MATCHED").length,
    missing: matches.filter((m) => m.status === "MISSING").length,
    failed: matches.filter((m) => m.status === "FAILED").length,
  }

  const filteredStats = {
    total: filtered.length,
    matched: filtered.filter((m) => m.status === "MATCHED").length,
    missing: filtered.filter((m) => m.status === "MISSING").length,
    failed: filtered.filter((m) => m.status === "FAILED").length,
  }

  // Download missing punches as CSV
  const handleDownloadMissing = () => {
    try {
      setDownloading(true)
      const missing = filtered.filter((m) => m.status === "MISSING")

      if (missing.length === 0) {
        toast.error("No missing punches to download")
        return
      }

      const headers = ["Device User ID", "Employee Name", "Punch Date", "Punch Time", "Reason"]
      const csvContent = [
        headers.join(","),
        ...missing.map((m) =>
          [m.device_user_id, `"${m.employee_name}"`, m.punch_date, m.punch_time, `"${m.reason}"`].join(","),
        ),
      ].join("\n")

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const link = document.createElement("a")
      const url = URL.createObjectURL(blob)
      link.setAttribute("href", url)
      link.setAttribute(
        "download",
        `missing-punches-${new Date().toISOString().split("T")[0]}.csv`,
      )
      link.style.visibility = "hidden"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      toast.success(`Downloaded ${missing.length} missing punch records`)
    } catch {
      toast.error("Failed to download CSV")
    } finally {
      setDownloading(false)
    }
  }

  // Download all records as CSV
  const handleDownloadAll = () => {
    try {
      setDownloading(true)

      const headers = ["Device User ID", "Employee Name", "Punch Date", "Punch Time", "Status", "Matched Status", "Late Category", "Reason"]
      const csvContent = [
        headers.join(","),
        ...filtered.map((m) =>
          [
            m.device_user_id,
            `"${m.employee_name}"`,
            m.punch_date,
            m.punch_time,
            m.status,
            m.matched_status || "—",
            m.late_category || "—",
            `"${m.reason}"`,
          ].join(","),
        ),
      ].join("\n")

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const link = document.createElement("a")
      const url = URL.createObjectURL(blob)
      link.setAttribute("href", url)
      link.setAttribute(
        "download",
        `punch-audit-${new Date().toISOString().split("T")[0]}.csv`,
      )
      link.style.visibility = "hidden"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      toast.success(`Downloaded ${filtered.length} punch records`)
    } catch {
      toast.error("Failed to download CSV")
    } finally {
      setDownloading(false)
    }
  }

  // Re-feed FAILED punches (captured by the device but never turned into an
  // attendance row) back through the corrected /api/zk-attendance pipeline.
  // Recovers historical OUT punches that earlier classifier bugs had dropped.
  const handleReprocessFailed = async () => {
    const failedRows = filtered.filter((m) => m.status === "FAILED")
    if (failedRows.length === 0) {
      toast.error("No failed punches in the current view to reprocess")
      return
    }
    const dates = failedRows.map((m) => m.punch_date).sort()
    const start = startDate || dates[0]
    const end = endDate || dates[dates.length - 1]
    const devId = userIdFilter ? parseInt(userIdFilter, 10) : undefined

    if (
      !window.confirm(
        `Reprocess failed punches from ${start} to ${end}?\n\nThis re-runs the raw device punches through the attendance pipeline and records any that now fall inside a tracked window. Punches still outside a window are left untouched. Safe to run more than once.`,
      )
    )
      return

    try {
      setReprocessing(true)
      const res = await authFetch("/api/admin/reprocess-punches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startDate: start, endDate: end, deviceUserId: devId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data?.error || "Reprocess failed")
        return
      }
      const s = data.summary
      toast.success(
        `Reprocessed ${s.total} — ${s.recorded} recorded, ${s.skipped} still outside a window, ${s.errored} errored`,
      )
      setReprocessResult({ summary: s, details: data.details ?? [] })
      setRefreshNonce((n) => n + 1)
    } catch {
      toast.error("Reprocess request failed")
    } finally {
      setReprocessing(false)
    }
  }

  const handleResetFilters = () => {
    setStartDate("")
    setEndDate("")
    setUserIdFilter("")
    setStatusFilter("all")
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <Clock className="size-7 text-emerald-500" /> Punch Records Audit
        </h1>
        <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
          Compare raw punch data from device with processed attendance records. Identify missing or failed punches.
        </p>
      </motion.div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-navy-500">Total Punches</div>
            <div className="text-2xl font-bold text-navy-900 dark:text-white">{stats.total}</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardContent className="p-4">
            <div className="text-sm text-emerald-600 dark:text-emerald-400">Matched ✓</div>
            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{stats.matched}</div>
          </CardContent>
        </Card>
        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="p-4">
            <div className="text-sm text-red-600 dark:text-red-400">Missing ⚠</div>
            <div className="text-2xl font-bold text-red-700 dark:text-red-300">{stats.missing}</div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 dark:border-amber-800">
          <CardContent className="p-4">
            <div className="text-sm text-amber-600 dark:text-amber-400">Failed ✗</div>
            <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">{stats.failed}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="size-5" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-navy-900 dark:text-white mb-1">From Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-900 dark:text-white mb-1">To Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-900 dark:text-white mb-1">User ID</label>
              <Input
                type="number"
                placeholder="Device user ID"
                value={userIdFilter}
                onChange={(e) => setUserIdFilter(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-900 dark:text-white mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "all" | "MATCHED" | "MISSING" | "FAILED")}
                className="w-full px-3 py-2 border border-navy-200 dark:border-navy-700 rounded-md bg-white dark:bg-navy-800 text-navy-900 dark:text-white"
              >
                <option value="all">All</option>
                <option value="MATCHED">Matched ✓</option>
                <option value="MISSING">Missing ⚠</option>
                <option value="FAILED">Failed ✗</option>
              </select>
            </div>
          </div>
          {(startDate || endDate || userIdFilter || statusFilter !== "all") && (
            <div className="mt-3">
              <Button
                onClick={handleResetFilters}
                variant="outline"
                size="sm"
                className="gap-1"
              >
                <X className="size-4" /> Clear Filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Download Buttons */}
      <div className="flex gap-2 flex-wrap">
        <Button
          onClick={handleDownloadMissing}
          disabled={loading || filteredStats.missing === 0 || downloading}
          className="gap-2 bg-red-600 hover:bg-red-700"
        >
          {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Download Missing ({filteredStats.missing})
        </Button>
        <Button
          onClick={handleDownloadAll}
          disabled={loading || filtered.length === 0 || downloading}
          className="gap-2"
          variant="outline"
        >
          {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Download All ({filtered.length})
        </Button>
        <Button
          onClick={handleReprocessFailed}
          disabled={loading || filteredStats.failed === 0 || reprocessing}
          className="gap-2 bg-amber-600 hover:bg-amber-700"
          title="Re-run failed punches through the corrected attendance pipeline to backfill dropped records"
        >
          {reprocessing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Reprocess Failed ({filteredStats.failed})
        </Button>
      </div>

      {/* Reprocess results — per-punch outcome so we can see why a punch did or
          did not record (recorded / skipped-with-reason / errored). */}
      {reprocessResult && (
        <Card className="border-amber-200 dark:border-amber-800">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Last Reprocess — {reprocessResult.summary.recorded} recorded · {reprocessResult.summary.skipped} skipped · {reprocessResult.summary.errored} errored ({reprocessResult.summary.total} processed)
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setReprocessResult(null)}>
              <X className="size-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {reprocessResult.details.length === 0 ? (
              <p className="text-sm text-navy-500">
                No unmatched punches were found to reprocess in this range. (Punches already recorded are skipped on purpose.)
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-navy-200 dark:border-navy-700 text-left">
                      <th className="px-2 py-1.5 font-semibold">Outcome</th>
                      <th className="px-2 py-1.5 font-semibold">User</th>
                      <th className="px-2 py-1.5 font-semibold">Name</th>
                      <th className="px-2 py-1.5 font-semibold">Date</th>
                      <th className="px-2 py-1.5 font-semibold">Time</th>
                      <th className="px-2 py-1.5 font-semibold">Reason / note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reprocessResult.details.map((d, i) => (
                      <tr key={i} className="border-b border-navy-100 dark:border-navy-800">
                        <td className="px-2 py-1.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              d.outcome === "recorded"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                                : d.outcome === "skipped"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                                  : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                            }`}
                          >
                            {d.outcome}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 font-semibold">{d.deviceUserId}</td>
                        <td className="px-2 py-1.5">{teacherMap[ZK_DEVICE_ID_MAP[d.deviceUserId]] ?? "—"}</td>
                        <td className="px-2 py-1.5 text-navy-600 dark:text-navy-300">{d.date}</td>
                        <td className="px-2 py-1.5 font-mono">{d.time}</td>
                        <td className="px-2 py-1.5 text-navy-600 dark:text-navy-300">{d.note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Missing Punches Alert */}
      {filteredStats.missing > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <AlertTriangle className="size-5 text-red-600 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-red-900 dark:text-red-200">⚠ {filteredStats.missing} Missing Punch Records</h3>
            <p className="text-sm text-red-700 dark:text-red-300">
              These punches exist in the device but were NOT recorded in the attendance sheet. Review and add them manually if needed.
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="size-5" /> Punch Audit Results ({filteredStats.total})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-navy-400" />
            </div>
          ) : error ? (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20">
              <AlertCircle className="size-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-red-900 dark:text-red-200">Error loading records</h3>
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-navy-500">
              {matches.length === 0 ? "No punch records found." : "No records match your filters."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-navy-200 dark:border-navy-700">
                    <th className="px-4 py-3 text-left font-semibold text-navy-900 dark:text-white">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-navy-900 dark:text-white">User ID</th>
                    <th className="px-4 py-3 text-left font-semibold text-navy-900 dark:text-white">Employee Name</th>
                    <th className="px-4 py-3 text-left font-semibold text-navy-900 dark:text-white">Date</th>
                    <th className="px-4 py-3 text-left font-semibold text-navy-900 dark:text-white">Time</th>
                    <th className="px-4 py-3 text-left font-semibold text-navy-900 dark:text-white">Matched Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-navy-900 dark:text-white">Late Cat.</th>
                    <th className="px-4 py-3 text-left font-semibold text-navy-900 dark:text-white">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((match, idx) => (
                    <tr
                      key={match.raw_punch_id || idx}
                      className={`border-b border-navy-100 dark:border-navy-800 ${
                        match.status === "MISSING"
                          ? "bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20"
                          : match.status === "FAILED"
                            ? "bg-amber-50 dark:bg-amber-900/10 hover:bg-amber-100 dark:hover:bg-amber-900/20"
                            : "hover:bg-navy-50 dark:hover:bg-navy-900/50"
                      } transition`}
                    >
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded text-xs font-bold ${
                            match.status === "MATCHED"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                              : match.status === "MISSING"
                                ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                          }`}
                        >
                          {match.status === "MATCHED" ? "✓" : match.status === "MISSING" ? "⚠" : "✗"} {match.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-navy-900 dark:text-white">{match.device_user_id}</td>
                      <td className="px-4 py-3 font-medium text-navy-900 dark:text-white">{match.employee_name}</td>
                      <td className="px-4 py-3 text-navy-700 dark:text-navy-300">{match.punch_date}</td>
                      <td className="px-4 py-3 font-mono text-navy-700 dark:text-navy-300">{match.punch_time}</td>
                      <td className="px-4 py-3">
                        {match.matched_status ? (
                          <span className="px-2 py-1 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                            {match.matched_status}
                          </span>
                        ) : (
                          <span className="text-navy-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {match.late_category ? (
                          <span className="px-2 py-1 rounded text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                            {match.late_category}
                          </span>
                        ) : (
                          <span className="text-navy-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-navy-700 dark:text-navy-300 max-w-xs">
                        {match.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Print styles */}
      <style>{`
        @media print {
          body * { display: none; }
          #printable, #printable * { display: block; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #999; padding: 8px; text-align: left; font-size: 10pt; }
          th { background: #1e3a5f; color: white; font-weight: bold; }
          tr:nth-child(even) { background: #f8f9fc; }
        }
      `}</style>
    </div>
  )
}
