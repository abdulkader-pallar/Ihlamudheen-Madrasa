"use client"

import { motion } from "framer-motion"
import { Lock, Shield, Users, UserCheck, GraduationCap, Briefcase } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"

export default function AccessPage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"

  const roles = [
    {
      key: "admin",
      label: "Admin",
      icon: Shield,
      color: "bg-red-500",
      can: [
        "Full access to all modules",
        "User and role management",
        "Delete classes / students",
        "Approve leave requests",
        "Create assessments and notes",
        "Manage payments",
      ],
    },
    {
      key: "accountant",
      label: "Accountant",
      icon: Briefcase,
      color: "bg-green-600",
      can: [
        "Finance, fees, enrollment",
        "Staff attendance + payments",
        "Reports",
      ],
    },
    {
      key: "teacher",
      label: "Teacher",
      icon: GraduationCap,
      color: "bg-teal-500",
      can: [
        "Mark own attendance",
        "View/manage own classes",
        "Create assessments",
        "Share class notes (LMS)",
        "View grade book",
      ],
    },
    {
      key: "student",
      label: "Student",
      icon: Users,
      color: "bg-blue-500",
      can: [
        "View own courses + schedule",
        "View assignments + homework",
        "View report card",
        "Access shared class notes via /lms/[classId]",
      ],
    },
  ]

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <Lock className="size-7 text-stone-500" /> Access Control
        </h1>
        <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
          Permissions by role. Your role: <strong>{role}</strong>
        </p>
      </motion.div>

      <div className="grid gap-3 md:grid-cols-2">
        {roles.map((r) => {
          const Icon = r.icon
          const isMine = r.key === role
          return (
            <Card key={r.key} className={isMine ? "border-gold-400 ring-1 ring-gold-300" : ""}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`flex size-11 items-center justify-center rounded-lg text-white ${r.color}`}>
                    <Icon className="size-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-navy-900 dark:text-white">{r.label}</h3>
                    {isMine && (
                      <span className="text-[11px] font-medium text-gold-600 uppercase tracking-wide">
                        Your role
                      </span>
                    )}
                  </div>
                </div>
                <ul className="space-y-1 text-sm text-navy-600 dark:text-navy-300">
                  {r.can.map((c, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <UserCheck className="size-3.5 text-emerald-500 mt-0.5 shrink-0" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
