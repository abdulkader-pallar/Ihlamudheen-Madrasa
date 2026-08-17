"use client"

import Link from "next/link"
import Image from "next/image"
import { AppLauncher } from "@/components/app-launcher"
import { ThemeToggle } from "@/components/theme-toggle"
import { useAuth } from "@/hooks/use-auth"
import { DashboardSkeleton } from "@/components/loading-skeleton"
import { getUserRole, ROLE_LABELS, ROLE_BADGE_COLORS } from "@/lib/roles"
import { isSuperadmin } from "@/lib/types"
import { cn } from "@/lib/utils"

// Meelad Fest module shell. Auth + role gating is enforced in middleware.ts and,
// authoritatively, by the fest_* RLS policies; this layout just frames the UI.
export default function FestLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth(true)

  if (loading) return <DashboardSkeleton />
  if (!user) return null

  const userName = user.user_metadata?.full_name || user.email || "Staff"
  const userRole = getUserRole(user)
  // Without this the launcher hides the whole Accounts group, which is the only
  // way back to /admin from inside the fest module — a super-admin who came here
  // would be stranded with no route out but signing out.
  const superadmin = isSuperadmin(user.email)

  return (
    <div className="flex min-h-screen flex-col bg-navy-50/30 dark:bg-navy-950">
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-white/80 backdrop-blur-xl dark:bg-navy-900/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/fest" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Ihlamudheen Madrasa" width={120} height={32} className="h-8 w-auto rounded" />
            <div className="flex flex-col leading-none">
              <span className="text-base font-bold text-navy-800 dark:text-white tracking-tight">Meelad Fest</span>
              <span className="text-[9px] font-medium text-navy-500 dark:text-navy-400 tracking-wider">Ihlamudheen Madrasa PORTAL</span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <span className={cn("hidden sm:inline-block text-[9px] font-semibold uppercase tracking-wider rounded-full px-1.5 py-0.5", ROLE_BADGE_COLORS[userRole])}>
              {ROLE_LABELS[userRole]}
            </span>
            <span className="hidden sm:block text-sm font-medium text-navy-700 dark:text-navy-200 max-w-[140px] truncate">{userName}</span>
            <ThemeToggle />
            <AppLauncher role={userRole} isSuperadmin={superadmin} onLogout={signOut} />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  )
}
