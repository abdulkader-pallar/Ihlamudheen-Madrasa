"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import {
  Building2,
  Users,
  CreditCard,
  Receipt,
  CalendarOff,
  FileBarChart,
  ArrowRight,
  Clock,
  Wallet,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { useAuth } from "@/hooks/use-auth"

export default function ErpPage() {
  useAuth(true)

  const modules = [
    { title: "Finance", href: "/dashboard/fees/payments", icon: Receipt, color: "bg-green-600" },
    { title: "Fees Management", href: "/dashboard/fees", icon: CreditCard, color: "bg-emerald-600" },
    { title: "Employees", href: "/dashboard/employees", icon: Users, color: "bg-blue-600" },
    { title: "Leave Management", href: "/dashboard/leave", icon: CalendarOff, color: "bg-amber-500" },
    { title: "Punch Records", href: "/dashboard/erp/punch-records", icon: Clock, color: "bg-teal-600" },
    { title: "Monthly Salary", href: "/dashboard/erp/monthly-salary", icon: Wallet, color: "bg-rose-600" },
    { title: "Reports", href: "/dashboard/reports", icon: FileBarChart, color: "bg-cyan-600" },
  ]

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <Building2 className="size-7 text-violet-500" /> ERP System
        </h1>
        <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
          Enterprise operations — finance, HR, enrollment and reporting modules.
        </p>
      </motion.div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => {
          const Icon = m.icon
          return (
            <Link key={m.href} href={m.href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`flex size-11 items-center justify-center rounded-lg text-white ${m.color}`}>
                    <Icon className="size-5" />
                  </div>
                  <span className="flex-1 font-semibold text-navy-900 dark:text-white">{m.title}</span>
                  <ArrowRight className="size-4 text-navy-400" />
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
