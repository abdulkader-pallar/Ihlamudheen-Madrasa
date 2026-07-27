"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { ClipboardCheck, LogOut, PanelLeft } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { AppLauncher, NavMenuBody, getMenuForRole } from "@/components/app-launcher"
import { CommandSearch } from "@/components/command-search"
import { ThemeToggle } from "@/components/theme-toggle"
import { useAuth } from "@/hooks/use-auth"
import { DashboardSkeleton } from "@/components/loading-skeleton"
import { getUserRole, ROLE_LABELS, ROLE_BADGE_COLORS } from "@/lib/roles"
import { cn, toTitleCase } from "@/lib/utils"
import { isSuperadmin } from "@/lib/types"
import { initialTeachers } from "@/data/courses"

const FULL_NAME_TO_TEACHER: Record<string, string> = Object.fromEntries(
  initialTeachers.map((t) => [t.name.toLowerCase(), t.id])
)

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, loading, signOut } = useAuth(true)
  const [sidebarPinned, setSidebarPinned] = useState(false)

  if (loading) return <DashboardSkeleton />
  if (!user) return null

  const userName = toTitleCase(user.user_metadata?.full_name || user.email || "User")
  const avatarUrl = user.user_metadata?.avatar_url
  const userRole = getUserRole(user)
  const fullName = (user.user_metadata?.full_name ?? "") as string
  const teacherId = FULL_NAME_TO_TEACHER[fullName.toLowerCase()] ??
    initialTeachers.find(t => fullName.toLowerCase().includes(t.name.toLowerCase().split(" ")[0]))?.id
  const isEduSupport = teacherId
    ? initialTeachers.find(t => t.id === teacherId)?.payType === "monthly-edu-support"
    : false
  const superadmin = isSuperadmin(user.email)
  const categories = getMenuForRole(userRole, { isEduSupport, isSuperadmin: superadmin })

  return (
    <div className="flex min-h-screen flex-col bg-navy-50/30 dark:bg-navy-950">
      {/* Top header */}
      <header className="sticky top-0 z-40 w-full border-b border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-900 header-3d">
        <div className="mx-auto flex h-14 max-w-full items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2.5 dark:bg-white dark:rounded-lg dark:px-3 dark:py-1.5 flex-shrink-0 dark:border dark:border-transparent">
            <Image src="/logo.png" alt="Ihlamudheen" width={120} height={32} className="h-8 w-auto rounded" />
            <div className="hidden sm:flex flex-col leading-none">
              <span className="text-base font-bold text-navy-800 tracking-tight">Ihlamudheen</span>
              <span className="text-[9px] font-medium text-navy-500 tracking-wider"></span>
            </div>
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* User pill */}
            <div className="hidden sm:flex items-center gap-2 mr-1 px-3 py-1 rounded-full" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #f97316 50%, #d97706 100%)" }}>
              {avatarUrl ? (
                <img // eslint-disable-line @next/next/no-img-element
                  src={avatarUrl}
                  alt={userName}
                  className="size-7 rounded-full object-cover ring-1 ring-border"
                />
              ) : (
                <div className="flex size-7 items-center justify-center rounded-full bg-gold-500 text-xs font-semibold text-white">
                  {userName[0]?.toUpperCase() || "U"}
                </div>
              )}
              <div className="flex flex-col items-end">
                <span className="text-sm font-medium text-white drop-shadow max-w-[120px] truncate">{userName}</span>
                <span className={cn("text-[9px] font-semibold uppercase tracking-wider rounded-full px-1.5", ROLE_BADGE_COLORS[userRole])} style={{ color: "#000000" }}>
                  {ROLE_LABELS[userRole]}
                </span>
              </div>
            </div>

            <AppLauncher
              role={userRole}
              isEduSupport={isEduSupport}
              isSuperadmin={superadmin}
              onLogout={signOut}
              sidebarPinned={sidebarPinned}
              onTogglePin={() => setSidebarPinned((v) => !v)}
            />

            <Link href="/dashboard/attendance" className="flex size-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-navy-800 transition-colors" title="Student Attendance">
              <ClipboardCheck className="size-5 text-emerald-500" />
            </Link>

            <ThemeToggle />

            <button onClick={signOut} className="flex size-9 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-navy-800 transition-colors" title="Sign Out">
              <LogOut className="size-5 text-red-500" />
            </button>

            <CommandSearch role={userRole} />

            {/* Sidebar pin/unpin — desktop only (sidebar hidden on mobile) */}
            <button
              onClick={() => setSidebarPinned((v) => !v)}
              title={sidebarPinned ? "Close sidebar" : "Open sidebar"}
              className={cn("hidden sm:flex",
                "size-9 items-center justify-center rounded-lg transition-colors",
                sidebarPinned
                  ? "bg-gold-100 text-gold-600 dark:bg-gold-500/20 dark:text-gold-400"
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-navy-400 dark:hover:bg-navy-700 dark:hover:text-white"
              )}
            >
              <PanelLeft className="size-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Below header: pinned sidebar + main content */}
      <div className="flex flex-1 min-h-0">

        {/* Pinned sidebar */}
        <AnimatePresence initial={false}>
          {sidebarPinned && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 220 }}
              className="flex-shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-hidden z-30"
            >
              {/* Stitch-border glow on right edge */}
              <div className="h-full stitch-border shadow-3d rounded-r-2xl overflow-hidden">
                <div className="h-full rounded-r-[14px] bg-white dark:bg-navy-800 flex flex-col overflow-hidden" style={{ width: 278 }}>

                  {/* Menu content */}
                  <NavMenuBody
                    categories={categories}
                    onLogout={signOut}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
