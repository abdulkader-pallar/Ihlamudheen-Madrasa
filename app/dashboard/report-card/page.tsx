"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { FileText, Lock, TrendingUp, Award, Loader2, BookOpen, ToggleLeft, ToggleRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import * as db from "@/lib/db"
import type { StudentExamResult } from "@/lib/db"
import { getGrade } from "@/lib/grades"

// ── Grade color helper (Tailwind light/dark classes) ──────
function gradeColorClass(letter: string) {
  if (letter.startsWith("A")) return "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10"
  if (letter.startsWith("B")) return "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10"
  if (letter.startsWith("C")) return "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10"
  return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10"
}

function formatDate(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  })
}

// ── Exam Card ─────────────────────────────────────────────
function ExamCard({ exam, index }: { exam: StudentExamResult; index: number }) {
  const pct = exam.maxTotalScore > 0
    ? Math.round((exam.totalScore / exam.maxTotalScore) * 100)
    : 0
  const overallGrade = getGrade(pct)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
    >
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-lg">{exam.examName}</CardTitle>
              <p className="text-sm text-navy-500 dark:text-navy-400 mt-0.5">
                {exam.className} · {formatDate(exam.date)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 rounded-full bg-navy-50 dark:bg-navy-700 px-3 py-1 font-semibold text-sm text-navy-900 dark:text-white">
                <Award className="size-4 text-gold-500" />
                {exam.totalScore} / {exam.maxTotalScore}
                <span className="text-navy-400 font-normal">({pct}%)</span>
              </span>
              <span className={cn("rounded-full px-3 py-1 text-sm font-bold", gradeColorClass(overallGrade.letter))}>
                {overallGrade.letter}
              </span>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-navy-100 dark:bg-navy-700 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                pct >= 75 ? "bg-emerald-500" : pct >= 55 ? "bg-blue-500" : pct >= 33 ? "bg-amber-500" : "bg-red-500"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </CardHeader>

        {exam.subjects.length > 0 && (
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y bg-navy-50 dark:bg-navy-800/50">
                    <th className="px-4 py-3 text-left font-medium text-navy-600 dark:text-navy-300">Subject</th>
                    <th className="px-4 py-3 text-center font-medium text-navy-600 dark:text-navy-300">Score</th>
                    <th className="px-4 py-3 text-center font-medium text-navy-600 dark:text-navy-300">Max</th>
                    <th className="px-4 py-3 text-center font-medium text-navy-600 dark:text-navy-300">%</th>
                    <th className="px-4 py-3 text-center font-medium text-navy-600 dark:text-navy-300">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {exam.subjects.map((sub, si) => {
                    const subPct = sub.maxScore > 0 ? Math.round((sub.score / sub.maxScore) * 100) : 0
                    const subGrade = getGrade(subPct)
                    return (
                      <tr key={si} className="border-b last:border-0 hover:bg-navy-50/50 dark:hover:bg-navy-800/20">
                        <td className="px-4 py-3 font-medium text-navy-900 dark:text-white">{sub.name}</td>
                        <td className="px-4 py-3 text-center font-semibold text-navy-900 dark:text-white">{sub.score}</td>
                        <td className="px-4 py-3 text-center text-navy-500 dark:text-navy-400">{sub.maxScore}</td>
                        <td className="px-4 py-3 text-center text-navy-500 dark:text-navy-400">{subPct}%</td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", gradeColorClass(subGrade.letter))}>
                            {subGrade.letter}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>
    </motion.div>
  )
}

// ── Page ──────────────────────────────────────────────────
export default function ReportCardPage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const isAdmin = role === "admin"

  const [reportCardEnabled, setReportCardEnabled] = useState<boolean | null>(null)
  const [togglingEnabled, setTogglingEnabled] = useState(false)

  const [exams, setExams] = useState<StudentExamResult[]>([])
  const [className, setClassName] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load the DB setting on mount
  useEffect(() => {
    async function loadSetting() {
      const val = await db.fetchAppSetting("report_card_enabled")
      setReportCardEnabled(val !== "false")
    }
    loadSetting()
  }, [])

  // Load student exam data
  useEffect(() => {
    if (!user) return

    async function load() {
      setLoading(true)
      const ready = await db.checkSupabase()
      if (!ready) {
        setError("Could not reach database. Check your connection.")
        setLoading(false)
        return
      }

      const studentId = (user!.user_metadata?.student_id as string) || user!.id
      const result = await db.fetchStudentReportCard(studentId)

      if (result.error) {
        setError(null)
        setExams([])
      } else {
        setExams(result.data)
        setClassName(result.className || "")
        setError(null)
      }
      setLoading(false)
    }

    load()
  }, [user])

  async function toggleEnabled() {
    if (!isAdmin) return
    setTogglingEnabled(true)
    const next = !reportCardEnabled
    const { error: err } = await db.setAppSetting("report_card_enabled", next ? "true" : "false")
    if (!err) setReportCardEnabled(next)
    setTogglingEnabled(false)
  }

  const adminToggle = isAdmin && reportCardEnabled !== null && (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-navy-500 dark:text-navy-400">Student access:</span>
      <button
        onClick={toggleEnabled}
        disabled={togglingEnabled}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition-colors text-xs",
          reportCardEnabled
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
            : "bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20"
        )}
      >
        {reportCardEnabled ? <ToggleRight className="size-4" /> : <ToggleLeft className="size-4" />}
        {reportCardEnabled ? "Enabled" : "Locked"}
      </button>
    </div>
  )

  // ── Locked screen (non-admin only) ────────────────────
  if (reportCardEnabled === false && !isAdmin) {
    return (
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
            <FileText className="size-8 text-emerald-500" /> Report Card
          </h1>
        </motion.div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Lock className="size-16 text-navy-300 dark:text-navy-600 mb-4" />
          <h2 className="text-xl font-semibold text-navy-700 dark:text-navy-200 mb-2">Report Card Locked</h2>
          <p className="text-navy-500 dark:text-navy-400 max-w-md">
            Your report card is not available yet. The administration will open access when results are published.
          </p>
        </div>
      </div>
    )
  }

  if (loading || reportCardEnabled === null) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-8 animate-spin text-gold-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <FileText className="size-8 text-emerald-500" /> Report Card
        </h1>
        <div className="flex flex-col items-center py-20 text-center">
          <p className="text-red-500">{error}</p>
        </div>
      </div>
    )
  }

  if (exams.length === 0) {
    return (
      <div className="space-y-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-3xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
                <FileText className="size-8 text-emerald-500" /> Report Card
              </h1>
              {className && (
                <p className="mt-1 text-navy-600 dark:text-navy-300 flex items-center gap-2">
                  <TrendingUp className="size-4 text-gold-500" />
                  {className}
                </p>
              )}
            </div>
            {adminToggle}
          </div>
        </motion.div>
        <div className="flex flex-col items-center py-20 text-center">
          <BookOpen className="size-14 text-navy-300 dark:text-navy-600 mb-4" />
          <h2 className="text-lg font-semibold text-navy-700 dark:text-navy-200 mb-2">No Exams Yet</h2>
          <p className="text-navy-500 dark:text-navy-400 max-w-sm">
            No exam results have been recorded for your class yet.
            They will appear here once your teacher enters grades.
          </p>
        </div>
      </div>
    )
  }

  const avgPct = Math.round(
    exams.reduce((a, e) => a + (e.maxTotalScore > 0 ? (e.totalScore / e.maxTotalScore) * 100 : 0), 0) /
    exams.length
  )
  const avgGrade = getGrade(avgPct)
  const bestExam = [...exams].sort((a, b) => {
    const pctA = a.maxTotalScore > 0 ? a.totalScore / a.maxTotalScore : 0
    const pctB = b.maxTotalScore > 0 ? b.totalScore / b.maxTotalScore : 0
    return pctB - pctA
  })[0]

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
              <FileText className="size-8 text-emerald-500" /> Report Card
            </h1>
            <p className="mt-1 text-navy-600 dark:text-navy-300">
              {className} · {exams.length} exam{exams.length !== 1 ? "s" : ""} recorded
            </p>
          </div>
          {adminToggle}
        </div>
      </motion.div>

      {/* Summary bar */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-2 sm:grid-cols-3 gap-3"
      >
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-gold-500/10">
            <Award className="size-5 text-gold-500" />
          </div>
          <div>
            <p className="text-xs text-navy-500 dark:text-navy-400">Overall Average</p>
            <p className="text-lg font-bold text-navy-900 dark:text-white">
              {avgPct}%
              <span className={cn("ml-2 text-xs font-bold rounded-full px-2 py-0.5", gradeColorClass(avgGrade.letter))}>
                {avgGrade.letter}
              </span>
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500/10">
            <TrendingUp className="size-5 text-emerald-500" />
          </div>
          <div>
            <p className="text-xs text-navy-500 dark:text-navy-400">Best Exam</p>
            <p className="text-sm font-semibold text-navy-900 dark:text-white truncate max-w-[130px]">
              {bestExam?.examName || "—"}
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-blue-500/10">
            <FileText className="size-5 text-blue-500" />
          </div>
          <div>
            <p className="text-xs text-navy-500 dark:text-navy-400">Exams Taken</p>
            <p className="text-lg font-bold text-navy-900 dark:text-white">{exams.length}</p>
          </div>
        </div>
      </motion.div>

      {exams.map((exam, i) => (
        <ExamCard key={exam.examId} exam={exam} index={i} />
      ))}
    </div>
  )
}
