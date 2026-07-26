"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { Wrench, UserCog, KeyRound, Lock, Shield, ArrowRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { initialTeachers } from "@/data/courses"

export default function SystemSetupPage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"

  const tiles = [
    { title: "User Management", href: "/dashboard/user-mgmt", icon: UserCog, color: "bg-navy-500" },
    { title: "Passwords", href: "/dashboard/passwords", icon: KeyRound, color: "bg-amber-600" },
    { title: "Access Control", href: "/dashboard/access", icon: Lock, color: "bg-stone-500" },
    { title: "Admin Panel", href: "/admin", icon: Shield, color: "bg-red-500" },
  ]

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <Wrench className="size-7 text-gray-500" /> System Setup
        </h1>
        <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
          Configure accounts, permissions, and school-wide settings.
        </p>
      </motion.div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => {
          const Icon = t.icon
          return (
            <Link key={t.href} href={t.href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`flex size-10 items-center justify-center rounded-lg text-white ${t.color}`}>
                    <Icon className="size-5" />
                  </div>
                  <span className="flex-1 font-semibold text-navy-900 dark:text-white text-sm">{t.title}</span>
                  <ArrowRight className="size-4 text-navy-400" />
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      <Card>
        <CardContent className="p-5">
          <h2 className="font-semibold text-navy-900 dark:text-white mb-2">Current system state</h2>
          <ul className="space-y-1.5 text-sm text-navy-600 dark:text-navy-300">
            <li>• Your role: <strong>{role}</strong></li>
            <li>• {initialTeachers.length} staff accounts configured</li>
            <li>• Staff get a one-time password shared privately — must be changed on first login.</li>
            <li>• Authentication: email + password, Google OAuth</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
