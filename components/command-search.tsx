"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Search, X } from "lucide-react"
import {
  LayoutDashboard,
  Activity,
  BookOpen,
  BookOpenCheck,
  Bell,
  CalendarRange,
  Calendar,
  MessageSquare,
  User,
  Settings,
  Shield,
  GraduationCap,
  ArrowUpCircle,
  ClipboardCheck,
  UserCheck,
  BarChart3,
  MonitorPlay,
  Users,
  UserCog,
  CalendarOff,
  Building2,
  CreditCard,
  Radio,
  Newspaper,
  Camera,
  Scale,
  FileBarChart,
  Wrench,
  Lock,
  FileText,
  ClipboardList,
  Receipt,
  UserPlus,
  KeyRound,
  NotebookPen,
  Clock,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { UserRole } from "@/lib/roles"

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  category: string
}

// Mirrors getMenuForRole from app-launcher.tsx, flattened to a single list with category label
function getItemsForRole(role: UserRole): NavItem[] {
  const common: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, color: "bg-blue-500", category: "Dashboard" },
    { href: "/dashboard/attendance", label: "Attendance", icon: ClipboardCheck, color: "bg-emerald-500", category: "Dashboard" },
    { href: "/dashboard/profile", label: "Profile", icon: User, color: "bg-cyan-500", category: "Dashboard" },
    { href: "/dashboard/messages", label: "Messages", icon: MessageSquare, color: "bg-purple-500", category: "Dashboard" },
    { href: "/dashboard/settings", label: "Settings", icon: Settings, color: "bg-slate-500", category: "Dashboard" },
    { href: "/dashboard/ai-educator", label: "AI Educator", icon: Sparkles, color: "bg-violet-500", category: "Dashboard" },
  ]

  if (role === "admin") {
    return [
      ...common,
      // Academics
      { href: "/dashboard/courses", label: "All Courses", icon: BookOpen, color: "bg-gold-500", category: "Academics" },
      { href: "/dashboard/activity-tracker", label: "Activity Tracker", icon: Activity, color: "bg-emerald-500", category: "Academics" },
      { href: "/dashboard/assessment", label: "Grade Book", icon: GraduationCap, color: "bg-indigo-500", category: "Academics" },
      { href: "/dashboard/teachers", label: "Teachers", icon: UserCheck, color: "bg-teal-500", category: "Academics" },
      { href: "/dashboard/promote", label: "Promote Students", icon: ArrowUpCircle, color: "bg-indigo-600", category: "Academics" },
      { href: "/dashboard/performance", label: "Performance", icon: BarChart3, color: "bg-orange-500", category: "Academics" },
      { href: "/dashboard/lms", label: "LMS (Moodle)", icon: MonitorPlay, color: "bg-rose-500", category: "Academics" },
      // HRMS
      { href: "/dashboard/office-routine", label: "Office Routine", icon: ClipboardList, color: "bg-emerald-500", category: "HRMS" },
      { href: "/dashboard/staff-attendance", label: "Staff Attendance", icon: ClipboardList, color: "bg-teal-500", category: "HRMS" },
      { href: "/dashboard/employees", label: "Employees", icon: Users, color: "bg-blue-600", category: "HRMS" },
      { href: "/dashboard/leave", label: "Leave Mgmt", icon: CalendarOff, color: "bg-amber-500", category: "HRMS" },
      { href: "/dashboard/setup-teachers", label: "Setup Teachers", icon: UserPlus, color: "bg-indigo-500", category: "HRMS" },
      // ERP & Finance
      { href: "/dashboard/fees/payments", label: "Finance", icon: Receipt, color: "bg-green-600", category: "ERP & Finance" },
      { href: "/dashboard/fees", label: "Fees Mgmt", icon: CreditCard, color: "bg-emerald-600", category: "ERP & Finance" },
      { href: "/dashboard/erp", label: "ERP System", icon: Building2, color: "bg-violet-500", category: "ERP & Finance" },
      // Collaboration
      { href: "/dashboard/communication", label: "Communication", icon: Radio, color: "bg-sky-600", category: "Collaboration" },
      { href: "/dashboard/news", label: "News & Circular", icon: Newspaper, color: "bg-pink-500", category: "Collaboration" },
      // Tools
      { href: "/dashboard/schedule", label: "Schedule", icon: Calendar, color: "bg-emerald-500", category: "Tools" },
      { href: "/dashboard/album", label: "School Album", icon: Camera, color: "bg-fuchsia-500", category: "Tools" },
      { href: "/dashboard/discipline", label: "Discipline", icon: Scale, color: "bg-red-400", category: "Tools" },
      // Reports
      { href: "/dashboard/reports", label: "Reports", icon: FileBarChart, color: "bg-cyan-600", category: "Reports" },
      { href: "/dashboard/office-routine/reports", label: "Routine Reports", icon: ClipboardList, color: "bg-emerald-700", category: "Reports" },
      { href: "/dashboard/staff-payment-report", label: "Payment Report", icon: Receipt, color: "bg-emerald-700", category: "Reports" },
      // Administration
      { href: "/admin", label: "Admin Panel", icon: Shield, color: "bg-red-500", category: "Administration" },
      { href: "/dashboard/user-mgmt", label: "User Mgmt", icon: UserCog, color: "bg-navy-500", category: "Administration" },
      { href: "/dashboard/system-setup", label: "System Setup", icon: Wrench, color: "bg-gray-500", category: "Administration" },
      { href: "/dashboard/access", label: "Access Control", icon: Lock, color: "bg-stone-500", category: "Administration" },
      { href: "/dashboard/passwords", label: "Passwords", icon: KeyRound, color: "bg-amber-600", category: "Administration" },
    ]
  }

  if (role === "accountant") {
    return [
      ...common,
      // My Work
      { href: "/dashboard/office-routine", label: "Office Routine", icon: ClipboardList, color: "bg-emerald-500", category: "My Work" },
      // Finance & Accounts
      { href: "/dashboard/fees/payments", label: "Finance", icon: Receipt, color: "bg-green-600", category: "Finance & Accounts" },
      { href: "/dashboard/fees", label: "Fees Mgmt", icon: CreditCard, color: "bg-emerald-600", category: "Finance & Accounts" },
      // Academics — accountants share every teacher capability
      { href: "/dashboard/courses", label: "All Courses", icon: BookOpen, color: "bg-gold-500", category: "Academics" },
      { href: "/dashboard/assessment", label: "Grade Book", icon: GraduationCap, color: "bg-indigo-500", category: "Academics" },
      { href: "/dashboard/recitation", label: "Quran Recitation", icon: BookOpenCheck, color: "bg-emerald-600", category: "Academics" },
      { href: "/dashboard/activity-tracker", label: "Activity Tracker", icon: Activity, color: "bg-emerald-500", category: "Academics" },
      { href: "/dashboard/teachers", label: "Teachers", icon: UserCheck, color: "bg-teal-500", category: "Academics" },
      { href: "/dashboard/lms", label: "LMS (Moodle)", icon: MonitorPlay, color: "bg-rose-500", category: "Academics" },
      // HRMS
      { href: "/dashboard/staff-attendance", label: "Staff Attendance", icon: ClipboardList, color: "bg-teal-500", category: "HRMS" },
      { href: "/dashboard/my-attendance", label: "My Attendance", icon: ClipboardList, color: "bg-teal-600", category: "HRMS" },
      { href: "/dashboard/employees", label: "Employees", icon: Users, color: "bg-blue-600", category: "HRMS" },
      { href: "/dashboard/leave", label: "Leave Mgmt", icon: CalendarOff, color: "bg-amber-500", category: "HRMS" },
      // Tools
      { href: "/dashboard/schedule", label: "Schedule", icon: Calendar, color: "bg-emerald-500", category: "Tools" },
      { href: "/dashboard/bell-timetable", label: "Bell Timetable", icon: Bell, color: "bg-amber-500", category: "Tools" },
      { href: "/dashboard/period-timetable", label: "Period Timetable", icon: CalendarRange, color: "bg-violet-500", category: "Tools" },
      // Reports
      { href: "/dashboard/reports", label: "Reports", icon: FileBarChart, color: "bg-cyan-600", category: "Reports" },
      { href: "/dashboard/staff-payment-report", label: "Payment Report", icon: Receipt, color: "bg-emerald-700", category: "Reports" },
      // Collaboration
      { href: "/dashboard/communication", label: "Communication", icon: Radio, color: "bg-sky-600", category: "Collaboration" },
      { href: "/dashboard/news", label: "News & Circular", icon: Newspaper, color: "bg-pink-500", category: "Collaboration" },
      // Administration
      { href: "/dashboard/user-mgmt", label: "User Mgmt", icon: UserCog, color: "bg-navy-500", category: "Administration" },
    ]
  }

  if (role === "teacher") {
    return [
      ...common,
      // My Work
      { href: "/dashboard/teachers", label: "Teachers", icon: UserCheck, color: "bg-navy-500", category: "My Work" },
      { href: "/dashboard/activity-tracker", label: "Activity Tracker", icon: Activity, color: "bg-emerald-500", category: "My Work" },
      { href: "/dashboard/courses", label: "My Courses", icon: BookOpen, color: "bg-gold-500", category: "My Work" },
      { href: "/dashboard/assessment", label: "Grade Book", icon: GraduationCap, color: "bg-indigo-500", category: "My Work" },
      { href: "/dashboard/lms", label: "LMS (Moodle)", icon: MonitorPlay, color: "bg-rose-500", category: "My Work" },
      // Tools
      { href: "/dashboard/schedule", label: "Schedule", icon: Calendar, color: "bg-emerald-500", category: "Tools" },
      { href: "/dashboard/communication", label: "Communication", icon: Radio, color: "bg-sky-600", category: "Tools" },
      { href: "/dashboard/news", label: "News & Circular", icon: Newspaper, color: "bg-pink-500", category: "Tools" },
    ]
  }

  // Student (default)
  return [
    ...common,
    // Learning
    { href: "/dashboard/courses", label: "My Courses", icon: BookOpen, color: "bg-gold-500", category: "Learning" },
    { href: "/dashboard/assignments", label: "Assignments", icon: ClipboardList, color: "bg-indigo-500", category: "Learning" },
    { href: "/dashboard/homework", label: "Homework", icon: NotebookPen, color: "bg-orange-500", category: "Learning" },
    { href: "/dashboard/report-card", label: "Report Card", icon: FileText, color: "bg-emerald-500", category: "Learning" },
    // Campus
    { href: "/dashboard/schedule", label: "Schedule", icon: Calendar, color: "bg-emerald-600", category: "Campus" },
    { href: "/dashboard/news", label: "News & Circular", icon: Newspaper, color: "bg-pink-500", category: "Campus" },
  ]
}

interface CommandSearchProps {
  role: UserRole
}

export function CommandSearch({ role }: CommandSearchProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const allItems = getItemsForRole(role)

  const filtered = query.trim().length === 0
    ? allItems
    : allItems.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.category.toLowerCase().includes(query.toLowerCase())
      )

  const openPalette = useCallback(() => {
    setOpen(true)
    setQuery("")
    // Focus input on next tick after render
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const closePalette = useCallback(() => {
    setOpen(false)
    setQuery("")
  }, [])

  const handleSelect = useCallback(
    (href: string) => {
      router.push(href)
      closePalette()
    },
    [router, closePalette]
  )

  // Global "/" shortcut to open (only when not in an input/textarea/select)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (open) closePalette()
        return
      }
      if (e.key === "/" && !open) {
        const tag = (e.target as HTMLElement).tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
        e.preventDefault()
        openPalette()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, openPalette, closePalette])

  return (
    <>
      {/* Search icon button in the header */}
      <button
        onClick={openPalette}
        className="flex size-9 items-center justify-center rounded-lg hover:bg-navy-800 transition-colors"
        title="Search (press /)"
        aria-label="Open command search"
      >
        <Search className="size-5 text-navy-300" />
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePalette()
          }}
        >
          <div className="mx-4 w-full max-w-lg rounded-2xl bg-white dark:bg-navy-800 shadow-2xl overflow-hidden">
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-navy-100 dark:border-navy-700">
              <Search className="size-5 text-navy-400 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pages…"
                className="flex-1 bg-transparent text-sm text-navy-900 dark:text-white placeholder:text-navy-400 outline-none"
              />
              <div className="flex items-center gap-2">
                <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-navy-200 dark:border-navy-600 bg-navy-50 dark:bg-navy-900 px-1.5 py-0.5 text-[10px] font-medium text-navy-500 dark:text-navy-400">
                  ESC
                </kbd>
                <button
                  onClick={closePalette}
                  className="rounded-lg p-1 hover:bg-navy-100 dark:hover:bg-navy-700 transition-colors"
                >
                  <X className="size-4 text-navy-400" />
                </button>
              </div>
            </div>

            {/* Results */}
            <div className="max-h-[60vh] overflow-y-auto py-2">
              {filtered.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-navy-400 dark:text-navy-500">
                  No pages found for &ldquo;{query}&rdquo;
                </p>
              ) : (
                <ul>
                  {filtered.map((item) => {
                    const Icon = item.icon
                    return (
                      <li key={item.href}>
                        <button
                          onClick={() => handleSelect(item.href)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                            "hover:bg-navy-50 dark:hover:bg-navy-700/50"
                          )}
                        >
                          <div
                            className={cn(
                              "flex size-8 flex-shrink-0 items-center justify-center rounded-lg text-white",
                              item.color
                            )}
                          >
                            <Icon className="size-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-navy-900 dark:text-white truncate">
                              {item.label}
                            </p>
                            <p className="text-xs text-navy-400 dark:text-navy-500 truncate">
                              {item.category}
                            </p>
                          </div>
                          <span className="text-xs text-navy-300 dark:text-navy-600 font-mono truncate hidden sm:block max-w-[140px]">
                            {item.href}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Footer hint */}
            <div className="border-t border-navy-100 dark:border-navy-700 px-4 py-2 flex items-center gap-3 text-[11px] text-navy-400 dark:text-navy-500">
              <span>
                <kbd className="rounded border border-navy-200 dark:border-navy-600 bg-navy-50 dark:bg-navy-900 px-1 py-0.5 font-medium">/</kbd>
                {" "}to open
              </span>
              <span>
                <kbd className="rounded border border-navy-200 dark:border-navy-600 bg-navy-50 dark:bg-navy-900 px-1 py-0.5 font-medium">Enter</kbd>
                {" "}/ click to navigate
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
