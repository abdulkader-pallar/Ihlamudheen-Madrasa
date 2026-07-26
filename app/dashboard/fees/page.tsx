"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { CreditCard, Users, BookOpen, Info, Loader2, Banknote } from "lucide-react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { supabase } from "@/lib/supabase"
import { cn } from "@/lib/utils"

// ── Fee structure ──────────────────────────────────────────
const FEE_STRUCTURE = [
  {
    courseId: "1",
    program: "Ihlamudheen Madrasa",
    color: "bg-emerald-500",
    textColor: "text-emerald-700 dark:text-emerald-400",
    bgLight: "bg-emerald-50 dark:bg-emerald-500/10",
    border: "border-emerald-200 dark:border-emerald-500/30",
    tiers: [{ grade: "All Grades", fee: 125, unit: "per month" }],
    note: "125 AED/month for all enrolled students.",
    getFee: () => 125,
  },
  {
    courseId: "2",
    program: "Ihlamudheen Madrasa",
    color: "bg-sky-500",
    textColor: "text-sky-700 dark:text-sky-400",
    bgLight: "bg-sky-50 dark:bg-sky-500/10",
    border: "border-sky-200 dark:border-sky-500/30",
    tiers: [{ grade: "All Levels", fee: 150, unit: "per month" }],
    note: "150 AED/month for all enrolled students.",
    getFee: () => 150,
  },
  {
    courseId: "4",
    program: "Ihlamudheen Madrasa",
    color: "bg-violet-500",
    textColor: "text-violet-700 dark:text-violet-400",
    bgLight: "bg-violet-50 dark:bg-violet-500/10",
    border: "border-violet-200 dark:border-violet-500/30",
    tiers: [
      { grade: "Grade 1 & 2", fee: 300, unit: "per month" },
      { grade: "Grade 3 & 4", fee: 350, unit: "per month" },
      { grade: "Grade 5 & 6", fee: 400, unit: "per month" },
    ],
    note: "Fee varies by grade: 300 / 350 / 400 AED/month.",
    getFee: (className: string) => {
      const lower = className.toLowerCase()
      if (/grade\s+[12]\b/.test(lower) || /\bg[12]\b/.test(lower)) return 300
      if (/grade\s+[34]\b/.test(lower) || /\bg[34]\b/.test(lower)) return 350
      if (/grade\s+[56]\b/.test(lower) || /\bg[56]\b/.test(lower)) return 400
      return 350
    },
  },
  {
    courseId: "3",
    program: "CIBIS CERTIFICATION",
    color: "bg-amber-500",
    textColor: "text-amber-700 dark:text-amber-400",
    bgLight: "bg-amber-50 dark:bg-amber-500/10",
    border: "border-amber-200 dark:border-amber-500/30",
    tiers: [{ grade: "All Students", fee: 0, unit: "contact admin" }],
    note: "Fee set individually — contact administration.",
    getFee: () => 0,
  },
]

interface ClassRow {
  id: string
  name: string
  schedule: string
  course_id: string
  studentCount: number
}

export default function FeesPage() {
  const { user } = useAuth(true)
  const router = useRouter()

  useEffect(() => {
    if (user && getUserRole(user) !== "admin") router.replace("/dashboard")
  }, [user, router])

  const [classes, setClasses] = useState<ClassRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: classRows }, { data: studentRows }] = await Promise.all([
        supabase.from("classes").select("id, name, schedule, course_id").order("name"),
        supabase.from("students").select("class_id"),
      ])

      if (!classRows) { setLoading(false); return }

      const countByClass: Record<string, number> = {}
      ;(studentRows ?? []).forEach((s: { class_id: string }) => {
        countByClass[s.class_id] = (countByClass[s.class_id] ?? 0) + 1
      })

      setClasses(
        classRows.map((c: { id: string; name: string; schedule: string; course_id: string }) => ({
          ...c,
          studentCount: countByClass[c.id] ?? 0,
        }))
      )
      setLoading(false)
    }
    load()
  }, [])

  const totalStudents = classes.reduce((n, c) => n + c.studentCount, 0)
  const totalClasses = classes.length

  // Calculate monthly fee per program
  const programStats = FEE_STRUCTURE.map(prog => {
    const progClasses = classes.filter(c => c.course_id === prog.courseId)
    const students = progClasses.reduce((n, c) => n + c.studentCount, 0)
    const monthly = progClasses.reduce((n, c) => n + c.studentCount * prog.getFee(c.name), 0)
    return { ...prog, progClasses, students, monthly }
  })

  const totalMonthly = programStats.reduce((n, p) => n + p.monthly, 0)

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
            <CreditCard className="size-7 text-emerald-500" /> Fees Management
          </h1>
          <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
            Official fee structure for all Ihlamudheen Centre programs.
          </p>
        </div>
        <Link href="/dashboard/fees/payments">
          <Button size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
            <Banknote className="size-4" /> Track Payments
          </Button>
        </Link>
      </motion.div>

      {/* Summary tiles — ALL programs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-navy-500 dark:text-navy-400">Total Students</p>
            {loading ? <Loader2 className="size-5 animate-spin text-navy-400 mt-1" /> : (
              <>
                <p className="text-2xl font-bold text-navy-900 dark:text-white mt-0.5">{totalStudents}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">across {totalClasses} classes, all programs</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-navy-500 dark:text-navy-400">Est. Monthly (All)</p>
            {loading ? <Loader2 className="size-5 animate-spin text-navy-400 mt-1" /> : (
              <>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                  AED {totalMonthly.toLocaleString()}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">all programs combined</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-navy-500 dark:text-navy-400">Programs</p>
            <p className="text-2xl font-bold text-navy-900 dark:text-white mt-0.5">4</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Ihlamudheen, English, EDU, CIBIS</p>
          </CardContent>
        </Card>
      </div>

      {/* Fee structure + per-program class breakdown */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-navy-900 dark:text-white">Fee Structure &amp; Enrollment</h2>

        {programStats.map((prog) => (
          <motion.div
            key={prog.courseId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn("rounded-2xl border overflow-hidden", prog.border)}
          >
            {/* Program header */}
            <div className={cn("flex flex-wrap items-center gap-4 px-5 py-4", prog.bgLight)}>
              <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl text-white", prog.color)}>
                <BookOpen className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className={cn("font-bold text-sm", prog.textColor)}>{prog.program}</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{prog.note}</p>
              </div>
              {/* Fee tiers */}
              <div className="flex flex-wrap gap-2">
                {prog.tiers.map(tier => (
                  <div key={tier.grade} className="rounded-xl bg-white dark:bg-navy-800/60 border border-white/70 dark:border-navy-700/50 px-3 py-1.5 text-center">
                    <p className="text-[10px] text-slate-500">{tier.grade}</p>
                    <p className={cn("text-sm font-bold", prog.textColor)}>
                      {tier.fee > 0 ? `AED ${tier.fee}` : "TBD"}
                    </p>
                  </div>
                ))}
              </div>
              {/* Summary */}
              {!loading && (
                <div className="text-right shrink-0">
                  <p className={cn("text-lg font-bold", prog.textColor)}>
                    {prog.students} students
                  </p>
                  {prog.monthly > 0 && (
                    <p className="text-[11px] text-slate-500">
                      AED {prog.monthly.toLocaleString()}/month
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Class breakdown table */}
            {!loading && prog.progClasses.length > 0 && (
              <div className="overflow-x-auto bg-white dark:bg-navy-800/30">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-navy-700">
                      <th className="text-left px-4 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">#</th>
                      <th className="text-left px-4 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Class</th>
                      <th className="text-left px-4 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide hidden sm:table-cell">Schedule</th>
                      <th className="text-center px-4 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Students</th>
                      <th className="text-center px-4 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Fee/month</th>
                      <th className="text-right px-4 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Monthly Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prog.progClasses.map((cls, i) => {
                      const fee = prog.getFee(cls.name)
                      return (
                        <tr key={cls.id} className={cn("border-t border-slate-100 dark:border-navy-700/50", i % 2 !== 0 && "bg-slate-50/40 dark:bg-navy-800/30")}>
                          <td className="px-4 py-2 text-xs text-slate-400">{i + 1}</td>
                          <td className="px-4 py-2 font-medium text-navy-900 dark:text-white">{cls.name}</td>
                          <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400 hidden sm:table-cell">{cls.schedule || "—"}</td>
                          <td className="px-4 py-2 text-center font-semibold text-navy-900 dark:text-white">{cls.studentCount}</td>
                          <td className="px-4 py-2 text-center text-xs text-slate-600 dark:text-slate-300">
                            {fee > 0 ? `AED ${fee}` : "TBD"}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                            {fee > 0 ? `AED ${(cls.studentCount * fee).toLocaleString()}` : "—"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 dark:border-navy-600 bg-slate-50 dark:bg-navy-700/40 font-bold">
                      <td colSpan={3} className="px-4 py-2 text-xs uppercase tracking-wide text-slate-600 dark:text-slate-300">Subtotal</td>
                      <td className="px-4 py-2 text-center text-navy-900 dark:text-white">{prog.students}</td>
                      <td />
                      <td className="px-4 py-2 text-right text-emerald-600 dark:text-emerald-400">
                        {prog.monthly > 0 ? `AED ${prog.monthly.toLocaleString()}` : "—"}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {!loading && prog.progClasses.length === 0 && (
              <p className="px-5 py-3 text-sm text-slate-400 dark:text-slate-500 italic bg-white dark:bg-navy-800/30">
                No classes added yet for this program.
              </p>
            )}
          </motion.div>
        ))}
      </div>

      {/* Grand total */}
      {!loading && (
        <Card className="border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10">
          <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Users className="size-5 text-emerald-600" />
              <span className="font-semibold text-navy-900 dark:text-white">Grand Total — All Programs</span>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-center">
                <p className="text-xs text-slate-500">Students</p>
                <p className="text-xl font-bold text-navy-900 dark:text-white">{totalStudents}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-slate-500">Est. Monthly</p>
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">AED {totalMonthly.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-dashed border-slate-300 dark:border-navy-600">
        <CardContent className="p-4">
          <p className="text-sm text-navy-600 dark:text-navy-300">
            <Info className="size-4 inline mr-1.5 text-slate-400" />
            Student counts are pulled live from the attendance database. Per-student fee records and payment history will be added here.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
