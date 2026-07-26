"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import {
  FileBarChart,
  CalendarCheck,
  GraduationCap,
  CreditCard,
  ArrowRight,
  BookOpen,
  Clock,
  Loader2,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { useAuth } from "@/hooks/use-auth"
import { initialTeachers } from "@/data/courses"
import { supabase } from "@/lib/supabase"

const teacherCount = initialTeachers.filter(
  t => !["monthly-cleaning", "daily-driver"].includes(t.payType)
).length
const staffCount = initialTeachers.length

const reports = [
  {
    title: "Student Attendance Report",
    desc: "Pick any date — see school-wide student attendance with export.",
    href: "/dashboard/attendance-report",
    icon: CalendarCheck,
    color: "bg-emerald-500",
  },
  {
    title: "Late Comers Report",
    desc: "Daily and monthly late arrivals by program, with arrival times and minutes late.",
    href: "/dashboard/late-comers",
    icon: Clock,
    color: "bg-amber-500",
  },
  {
    title: "Grade Book",
    desc: "Exam scores by class and subject, with class averages.",
    href: "/dashboard/assessment",
    icon: GraduationCap,
    color: "bg-indigo-500",
  },
  {
    title: "Staff Attendance & Payments",
    desc: "Daily fingerprint attendance, online manual entry, and salary tracking.",
    href: "/dashboard/staff-attendance",
    icon: CreditCard,
    color: "bg-gold-500",
  },
  {
    title: "Monthly Payment Report",
    desc: "Download or print monthly salary report by institution — Ihlamudheen, EDU Support, office & more.",
    href: "/dashboard/staff-payment-report",
    icon: FileBarChart,
    color: "bg-cyan-600",
  },
  {
    title: "Fees Management",
    desc: "Student fee structure, collection and payment tracking per program.",
    href: "/dashboard/fees",
    icon: BookOpen,
    color: "bg-teal-500",
  },
]

export default function ReportsPage() {
  useAuth(true)

  const [totalStudents, setTotalStudents] = useState<number | null>(null)
  const [totalClasses, setTotalClasses] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      // Fetch live counts from Supabase
      const [{ count: studentCount }, { count: classCount }] = await Promise.all([
        supabase.from("students").select("*", { count: "exact", head: true }),
        supabase.from("classes").select("*", { count: "exact", head: true }),
      ])
      setTotalStudents(studentCount ?? null)
      setTotalClasses(classCount ?? null)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <FileBarChart className="size-7 text-cyan-600" /> Reports
        </h1>
        <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
          School-wide statistics and downloadable reports.
        </p>
      </motion.div>

      {/* Live stats from Supabase */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Students (Ihlamudheen)", value: totalStudents },
          { label: "Classes", value: totalClasses },
          { label: "Programs", value: 4 },
          { label: "Teaching Staff", value: teacherCount },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-navy-500 dark:text-navy-400">{s.label}</p>
              {loading && s.value === null ? (
                <Loader2 className="size-5 animate-spin text-navy-400 mt-1" />
              ) : (
                <p className="text-2xl font-bold text-navy-900 dark:text-white mt-0.5">
                  {s.value ?? "—"}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Report links */}
      <div className="grid gap-3 md:grid-cols-2">
        {reports.map((r) => {
          const Icon = r.icon
          return (
            <Link key={r.href} href={r.href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`flex size-11 shrink-0 items-center justify-center rounded-lg text-white ${r.color}`}>
                    <Icon className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-navy-900 dark:text-white">{r.title}</h3>
                    <p className="text-xs text-navy-500 dark:text-navy-400 mt-0.5">{r.desc}</p>
                  </div>
                  <ArrowRight className="size-4 text-navy-400 shrink-0" />
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      <p className="text-[11px] text-slate-400 dark:text-slate-600">
        Total staff on payroll: {staffCount} (teaching staff, office, cleaning &amp; driver).
        Student count pulled live from the attendance database.
      </p>
    </div>
  )
}
