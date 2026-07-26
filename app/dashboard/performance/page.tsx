"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { BarChart3, Users, GraduationCap, BookOpen, Loader2, TrendingUp } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { useAuth } from "@/hooks/use-auth"
import * as db from "@/lib/db"
import { initialCourses, initialTeachers, getTotalStudents } from "@/data/courses"

interface ClassStat {
  classId: string
  className: string
  courseTitle: string
  students: number
  examCount: number
  avgPct: number | null
  attendanceDays: number
}

export default function PerformancePage() {
  useAuth(true)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<ClassStat[]>([])

  useEffect(() => {
    ;(async () => {
      const courses = await db.fetchCoursesFromDB()
      const all: ClassStat[] = []
      for (const c of courses) {
        for (const cls of c.classes) {
          const [grades, att] = await Promise.all([
            db.fetchGrades(cls.id),
            db.fetchAllAttendance(cls.id),
          ])
          let totalPct = 0
          let totalWeight = 0
          for (const g of grades) {
            if (g.maxScore > 0 && g.scores) {
              for (const sid of Object.keys(g.scores)) {
                totalPct += (g.scores[sid] / g.maxScore) * 100
                totalWeight += 1
              }
            }
          }
          const avgPct = totalWeight > 0 ? totalPct / totalWeight : null
          all.push({
            classId: cls.id,
            className: cls.name,
            courseTitle: c.title,
            students: cls.students.length,
            examCount: grades.length,
            avgPct,
            attendanceDays: att.length,
          })
        }
      }
      setStats(all)
      setLoading(false)
    })()
  }, [])

  const totalStudents = getTotalStudents(initialCourses)
  const activeClasses = stats.length || initialCourses.reduce((n, c) => n + c.classes.length, 0)
  const examsRun = stats.reduce((n, s) => n + s.examCount, 0)
  const overallAvg =
    stats.filter((s) => s.avgPct !== null).length > 0
      ? stats.reduce((n, s) => n + (s.avgPct || 0), 0) /
        stats.filter((s) => s.avgPct !== null).length
      : null

  const summary = [
    { label: "Students", value: String(totalStudents), icon: Users, color: "bg-blue-500" },
    { label: "Active Classes", value: String(activeClasses), icon: BookOpen, color: "bg-emerald-500" },
    { label: "Teachers", value: String(initialTeachers.length), icon: GraduationCap, color: "bg-violet-500" },
    {
      label: "Exams Conducted",
      value: String(examsRun),
      icon: BarChart3,
      color: "bg-gold-500",
    },
  ]

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <BarChart3 className="size-7 text-orange-500" /> Performance
        </h1>
        <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
          Academic performance across all classes — pulled live from exam scores and attendance records.
        </p>
      </motion.div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {summary.map((s) => {
          const Icon = s.icon
          return (
            <Card key={s.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`flex size-10 items-center justify-center rounded-lg text-white ${s.color}`}>
                  <Icon className="size-5" />
                </div>
                <div>
                  <p className="text-xs text-navy-500 dark:text-navy-400">{s.label}</p>
                  <p className="text-xl font-bold text-navy-900 dark:text-white">{s.value}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {overallAvg !== null && (
        <Card className="bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-500/10 dark:to-amber-500/10 border-orange-200">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-full bg-orange-500 text-white">
              <TrendingUp className="size-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-orange-600 font-semibold">
                Overall Average
              </p>
              <p className="text-2xl font-bold text-navy-900 dark:text-white">
                {overallAvg.toFixed(1)}%
              </p>
              <p className="text-xs text-navy-500 dark:text-navy-400">
                across all exams and students
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-class breakdown */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-orange-500" />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 dark:bg-navy-800/50 text-xs text-navy-500 dark:text-navy-400 uppercase">
                <tr>
                  <th className="text-left p-3">Class</th>
                  <th className="text-left p-3">Program</th>
                  <th className="text-right p-3">Students</th>
                  <th className="text-right p-3">Exams</th>
                  <th className="text-right p-3">Avg Score</th>
                  <th className="text-right p-3">Attendance Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {stats.map((s) => (
                  <tr key={s.classId} className="hover:bg-navy-50/50 dark:hover:bg-navy-800/30">
                    <td className="p-3 font-semibold text-navy-900 dark:text-white">{s.className}</td>
                    <td className="p-3 text-navy-500 dark:text-navy-400">{s.courseTitle}</td>
                    <td className="p-3 text-right">{s.students}</td>
                    <td className="p-3 text-right">{s.examCount}</td>
                    <td className="p-3 text-right font-semibold">
                      {s.avgPct !== null ? (
                        <span className={s.avgPct >= 75 ? "text-emerald-600" : s.avgPct >= 50 ? "text-orange-600" : "text-red-500"}>
                          {s.avgPct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-navy-300">—</span>
                      )}
                    </td>
                    <td className="p-3 text-right text-navy-500 dark:text-navy-400">
                      {s.attendanceDays}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
