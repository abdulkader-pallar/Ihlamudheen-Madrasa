"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Activity,
  BookOpen,
  BookOpenCheck,
  Calendar,
  MessageSquare,
  User,
  Settings,
  Shield,
  LogOut,
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
  ChevronDown,
  ChevronUp,
  FileText,
  ClipboardList,
  Receipt,
  UserPlus,
  KeyRound,
  NotebookPen,
  Clock,
  Wallet,
  Sparkles,
  Bell,
  CalendarRange,
  SlidersHorizontal,
  Trophy,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import type { UserRole } from "@/lib/roles"

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  image?: string
}

interface NavCategory {
  title: string
  items: NavItem[]
}

export function getMenuForRole(role: UserRole, options?: { isEduSupport?: boolean }): NavCategory[] {
  const isEduSupport = options?.isEduSupport ?? false
  const common: NavCategory = {
    title: "Dashboard",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, color: "bg-blue-500" },
      { href: "/dashboard/attendance", label: "Attendance", icon: ClipboardCheck, color: "bg-emerald-500" },
      { href: "/dashboard/profile", label: "Profile", icon: User, color: "bg-cyan-500" },
      { href: "/dashboard/messages", label: "Messages", icon: MessageSquare, color: "bg-purple-500" },
      { href: "/dashboard/settings", label: "Settings", icon: Settings, color: "bg-slate-500" },
      { href: "/dashboard/ai-educator", label: "AI Educator", icon: Sparkles, color: "bg-violet-500" },
    ],
  }

  // Ihlamudheen Madrasa Fest (Ihlamudheen Madrasa arts fest) — shown to fest staff only.
  const meeladFest: NavCategory = {
    title: "Ihlamudheen Madrasa Fest",
    items: [
      { href: "/fest", label: "Fest Home", icon: Trophy, color: "bg-gold-500" },
      { href: "/fest/registration", label: "Registration", icon: UserPlus, color: "bg-sky-500" },
      { href: "/fest/results", label: "Results", icon: BarChart3, color: "bg-orange-500" },
      { href: "/meelad", label: "Public Site", icon: MonitorPlay, color: "bg-rose-500" },
    ],
  }

  if (role === "admin") {
    return [
      common,
      {
        title: "Academics",
        items: [
          { href: "/dashboard/courses", label: "All Courses", icon: BookOpen, color: "bg-gold-500" },
          { href: "/dashboard/activity-tracker", label: "Activity Tracker", icon: Activity, color: "bg-emerald-500" },
          { href: "/dashboard/assessment", label: "Grade Book", icon: GraduationCap, color: "bg-indigo-500" },
          { href: "/dashboard/recitation", label: "Quran Recitation", icon: BookOpenCheck, color: "bg-emerald-600" },
          { href: "/dashboard/lesson-plans", label: "Lesson Plans / PPT", icon: BookOpen, color: "bg-emerald-700" },
          { href: "/dashboard/teachers", label: "Teachers", icon: UserCheck, color: "bg-teal-500" },
          { href: "/dashboard/add-student", label: "Add Student", icon: UserPlus, color: "bg-sky-500" },
          { href: "/dashboard/promote", label: "Promote Students", icon: ArrowUpCircle, color: "bg-indigo-600" },
          { href: "/dashboard/performance", label: "Performance", icon: BarChart3, color: "bg-orange-500" },
          { href: "/dashboard/lms", label: "LMS (Moodle)", icon: MonitorPlay, color: "bg-rose-500", image: "/madrasa-book.jpg" },
        ],
      },
      meeladFest,
      {
        title: "HRMS",
        items: [
          { href: "/dashboard/office-routine", label: "Office Routine", icon: ClipboardList, color: "bg-emerald-500" },
          { href: "/dashboard/staff-attendance", label: "Staff Attendance", icon: ClipboardList, color: "bg-teal-500" },
          { href: "/dashboard/employees", label: "Employees", icon: Users, color: "bg-blue-600" },
          { href: "/dashboard/leave", label: "Leave Mgmt", icon: CalendarOff, color: "bg-amber-500" },
          { href: "/dashboard/setup-teachers", label: "Setup Teachers", icon: UserPlus, color: "bg-indigo-500" },
          { href: "/dashboard/edu-support", label: "EDU Support Hours", icon: Clock, color: "bg-emerald-600" },
        ],
      },
      {
        title: "ERP & Finance",
        items: [
          { href: "/dashboard/fees/payments", label: "Finance", icon: Receipt, color: "bg-green-600" },
          { href: "/dashboard/fees", label: "Fees Mgmt", icon: CreditCard, color: "bg-emerald-600" },
          { href: "/dashboard/erp/monthly-salary", label: "Monthly Salary", icon: Wallet, color: "bg-rose-600" },
          { href: "/dashboard/erp", label: "ERP System", icon: Building2, color: "bg-violet-500" },
        ],
      },
      {
        title: "Collaboration",
        items: [
          { href: "/dashboard/communication", label: "Communication", icon: Radio, color: "bg-sky-600" },
          { href: "/dashboard/news", label: "News & Circular", icon: Newspaper, color: "bg-pink-500" },
        ],
      },
      {
        title: "Tools",
        items: [
          { href: "/dashboard/schedule", label: "Schedule", icon: Calendar, color: "bg-emerald-500" },
          { href: "/dashboard/bell-timetable", label: "Bell Timetable", icon: Bell, color: "bg-amber-500" },
          { href: "/dashboard/period-timetable", label: "Period Timetable", icon: CalendarRange, color: "bg-violet-500" },
          { href: "/dashboard/edu-timetable", label: "EDU Timetable", icon: CalendarRange, color: "bg-emerald-600" },
          { href: "/dashboard/edu-timetable/assign", label: "EDU Subjects", icon: SlidersHorizontal, color: "bg-emerald-500" },
          { href: "/dashboard/album", label: "School Album", icon: Camera, color: "bg-fuchsia-500" },
          { href: "/dashboard/discipline", label: "Discipline", icon: Scale, color: "bg-red-400" },
        ],
      },
      {
        title: "Reports",
        items: [
          { href: "/dashboard/reports", label: "Reports", icon: FileBarChart, color: "bg-cyan-600" },
          { href: "/dashboard/office-routine/reports", label: "Routine Reports", icon: ClipboardList, color: "bg-emerald-700" },
          { href: "/dashboard/staff-payment-report", label: "Payment Report", icon: Receipt, color: "bg-emerald-700" },
        ],
      },
      {
        title: "Administration",
        items: [
          { href: "/admin", label: "Admin Panel", icon: Shield, color: "bg-red-500" },
          { href: "/dashboard/user-mgmt", label: "User Mgmt", icon: UserCog, color: "bg-navy-500" },
          { href: "/dashboard/system-setup", label: "System Setup", icon: Wrench, color: "bg-gray-500" },
          { href: "/dashboard/access", label: "Access Control", icon: Lock, color: "bg-stone-500" },
          { href: "/dashboard/passwords", label: "Passwords", icon: KeyRound, color: "bg-amber-600" },
        ],
      },
    ]
  }

  if (role === "accountant") {
    // Accountants get the full finance suite PLUS everything a teacher can do
    // (Academics, Quran Recitation, Grade Book, timetables, …) — a superset.
    return [
      common,
      {
        title: "My Work",
        items: [
          { href: "/dashboard/office-routine", label: "Office Routine", icon: ClipboardList, color: "bg-emerald-500" },
          { href: "/dashboard/my-attendance", label: "My Attendance", icon: ClipboardList, color: "bg-teal-600" },
        ],
      },
      {
        title: "Finance & Accounts",
        items: [
          { href: "/dashboard/fees/payments", label: "Finance", icon: Receipt, color: "bg-green-600" },
          { href: "/dashboard/fees", label: "Fees Mgmt", icon: CreditCard, color: "bg-emerald-600" },
          { href: "/dashboard/erp/monthly-salary", label: "Monthly Salary", icon: Wallet, color: "bg-rose-600" },
        ],
      },
      {
        title: "Academics",
        items: [
          { href: "/dashboard/courses", label: "All Courses", icon: BookOpen, color: "bg-gold-500" },
          { href: "/dashboard/assessment", label: "Grade Book", icon: GraduationCap, color: "bg-indigo-500" },
          { href: "/dashboard/recitation", label: "Quran Recitation", icon: BookOpenCheck, color: "bg-emerald-600" },
          { href: "/dashboard/activity-tracker", label: "Activity Tracker", icon: Activity, color: "bg-emerald-500" },
          { href: "/dashboard/lesson-plans", label: "Lesson Plans / PPT", icon: BookOpen, color: "bg-emerald-700" },
          { href: "/dashboard/teachers", label: "Teachers", icon: UserCheck, color: "bg-teal-500" },
          { href: "/dashboard/add-student", label: "Add Student", icon: UserPlus, color: "bg-sky-500" },
          { href: "/dashboard/lms", label: "LMS (Moodle)", icon: MonitorPlay, color: "bg-rose-500", image: "/madrasa-book.jpg" },
        ],
      },
      meeladFest,
      {
        title: "HRMS",
        items: [
          { href: "/dashboard/staff-attendance", label: "Staff Attendance", icon: ClipboardList, color: "bg-teal-500" },
          { href: "/dashboard/employees", label: "Employees", icon: Users, color: "bg-blue-600" },
          { href: "/dashboard/leave", label: "Leave Mgmt", icon: CalendarOff, color: "bg-amber-500" },
          { href: "/dashboard/edu-support", label: "EDU Support Hours", icon: Clock, color: "bg-emerald-600" },
        ],
      },
      {
        title: "Tools",
        items: [
          { href: "/dashboard/schedule", label: "Schedule", icon: Calendar, color: "bg-emerald-500" },
          { href: "/dashboard/bell-timetable", label: "Bell Timetable", icon: Bell, color: "bg-amber-500" },
          { href: "/dashboard/period-timetable", label: "Period Timetable", icon: CalendarRange, color: "bg-violet-500" },
        ],
      },
      {
        title: "Reports",
        items: [
          { href: "/dashboard/reports", label: "Reports", icon: FileBarChart, color: "bg-cyan-600" },
          { href: "/dashboard/staff-payment-report", label: "Payment Report", icon: Receipt, color: "bg-emerald-700" },
        ],
      },
      {
        title: "Collaboration",
        items: [
          { href: "/dashboard/communication", label: "Communication", icon: Radio, color: "bg-sky-600" },
          { href: "/dashboard/news", label: "News & Circular", icon: Newspaper, color: "bg-pink-500" },
        ],
      },
      {
        title: "Administration",
        items: [
          { href: "/dashboard/user-mgmt", label: "User Mgmt", icon: UserCog, color: "bg-navy-500" },
        ],
      },
    ]
  }

  if (role === "teacher") {
    return [
      common,
      {
        title: "My Work",
        items: [
          { href: "/dashboard/my-attendance", label: "My Attendance", icon: ClipboardList, color: "bg-teal-600" },
          { href: "/dashboard/teachers", label: "Teachers", icon: UserCheck, color: "bg-navy-500" },
          { href: "/dashboard/activity-tracker", label: "Activity Tracker", icon: Activity, color: "bg-emerald-500" },
          { href: "/dashboard/courses", label: "My Courses", icon: BookOpen, color: "bg-gold-500" },
          { href: "/dashboard/assessment", label: "Grade Book", icon: GraduationCap, color: "bg-indigo-500" },
          { href: "/dashboard/recitation", label: "Quran Recitation", icon: BookOpenCheck, color: "bg-emerald-600" },
          { href: "/dashboard/lesson-plans", label: "Lesson Plans / PPT", icon: BookOpen, color: "bg-emerald-700" },
          { href: "/dashboard/lms", label: "LMS (Moodle)", icon: MonitorPlay, color: "bg-rose-500", image: "/madrasa-book.jpg" },
          ...(isEduSupport ? [{ href: "/dashboard/edu-support", label: "EDU Support Hours", icon: Clock, color: "bg-emerald-600" }] : []),
        ],
      },
      meeladFest,
      {
        title: "Tools",
        items: [
          { href: "/dashboard/schedule", label: "Schedule", icon: Calendar, color: "bg-emerald-500" },
          { href: "/dashboard/bell-timetable", label: "Bell Timetable", icon: Bell, color: "bg-amber-500" },
          { href: "/dashboard/period-timetable", label: "Period Timetable", icon: CalendarRange, color: "bg-violet-500" },
          { href: "/dashboard/communication", label: "Communication", icon: Radio, color: "bg-sky-600" },
          { href: "/dashboard/news", label: "News & Circular", icon: Newspaper, color: "bg-pink-500" },
        ],
      },
    ]
  }

  return [
    common,
    {
      title: "Learning",
      items: [
        { href: "/dashboard/courses", label: "My Courses", icon: BookOpen, color: "bg-gold-500" },
        { href: "/dashboard/assignments", label: "Assignments", icon: ClipboardList, color: "bg-indigo-500" },
        { href: "/dashboard/homework", label: "Homework", icon: NotebookPen, color: "bg-orange-500" },
        { href: "/dashboard/report-card", label: "Report Card", icon: FileText, color: "bg-emerald-500" },
        { href: "/dashboard/recitation", label: "Quran Recitation", icon: BookOpenCheck, color: "bg-emerald-600" },
      ],
    },
    {
      title: "Campus",
      items: [
        { href: "/dashboard/schedule", label: "Schedule", icon: Calendar, color: "bg-emerald-600" },
        { href: "/dashboard/news", label: "News & Circular", icon: Newspaper, color: "bg-pink-500" },
      ],
    },
  ]
}

// ── Shared menu body ─────────────────────────────────────────
interface NavMenuBodyProps {
  categories: NavCategory[]
  onItemClick?: () => void
  onLogout?: () => void
}

export function NavMenuBody({ categories, onItemClick, onLogout }: NavMenuBodyProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const pathname = usePathname()

  useEffect(() => {
    const defaults: Record<string, boolean> = {}
    categories.slice(0, 2).forEach((c) => { defaults[c.title] = true })
    setExpandedSections(defaults)
  }, [categories])

  return (
    <>
      {/* Scrollable menu */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        {categories.map((category, catIdx) => {
          const isExpanded = expandedSections[category.title] ?? false
          return (
            <div key={category.title}>
              {catIdx > 0 && (
                <div className="mx-3 my-1 border-t border-border/30 dark:border-navy-700" />
              )}
              <button
                onClick={() => setExpandedSections((p) => ({ ...p, [category.title]: !p[category.title] }))}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-navy-400 dark:text-navy-200 hover:text-navy-600 dark:hover:text-white transition-colors"
              >
                {category.title}
                {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>

              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-3 gap-1 px-1 pb-1">
                      {category.items.map((item) => {
                        const Icon = item.icon
                        const isActive = pathname === item.href
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={onItemClick}
                            className={cn(
                              "flex flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 transition-all",
                              isActive
                                ? "bg-gold-50 dark:bg-gold-500/10 shadow-[0_0_0_1.5px_#f59e0b,0_0_14px_rgba(245,158,11,0.35)] dark:shadow-[0_0_0_1.5px_#f59e0b,0_0_16px_rgba(245,158,11,0.25)]"
                                : "hover:bg-navy-50 dark:hover:bg-navy-700/40"
                            )}
                          >
                            <div className={cn(
                              "flex size-9 items-center justify-center rounded-full text-white shadow-sm icon-3d glow-icon overflow-hidden",
                              !item.image && item.color
                            )}>
                              {item.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={item.image} alt="" className="size-full object-cover" />
                              ) : (
                                <Icon className="size-[18px]" />
                              )}
                            </div>
                            <span className={cn(
                              "text-[10px] font-medium leading-tight text-center line-clamp-2",
                              isActive ? "text-gold-600 dark:text-gold-400" : "text-navy-600 dark:text-navy-100"
                            )}>
                              {item.label}
                            </span>
                          </Link>
                        )
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>

      {/* Logout */}
      <div className="border-t border-border/40 bg-white/95 backdrop-blur-sm p-2 dark:bg-navy-800/95">
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-navy-600 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-navy-300 dark:hover:bg-red-500/10 dark:hover:text-red-400"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </div>
    </>
  )
}

// ── Navbar buttons: 9-dots (overlay) + PanelLeft (pin) ──────
interface AppLauncherProps {
  role?: UserRole
  isEduSupport?: boolean
  onLogout?: () => void
  sidebarPinned?: boolean
  onTogglePin?: () => void
}

export function AppLauncher({ role = "student", isEduSupport = false, onLogout, sidebarPinned }: AppLauncherProps) {
  const [open, setOpen] = useState(false)
  const categories = getMenuForRole(role, { isEduSupport })

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest("[data-app-launcher]")) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open])

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    if (open) document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [open])

  return (
    <div className="flex items-center gap-1">
      {/* 9-dot dropdown button — hidden when sidebar is pinned */}
      {!sidebarPinned && <div className="relative" data-app-launcher>
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            "flex size-10 items-center justify-center rounded-full transition-colors",
            open ? "bg-navy-100 dark:bg-navy-700" : "hover:bg-navy-100 dark:hover:bg-navy-700"
          )}
          aria-label="Open app launcher"
          title="Apps"
        >
          <div className="grid grid-cols-3 gap-[3px]">
            {[...Array(9)].map((_, i) => (
              <span
                key={i}
                className={cn(
                  "block size-[4px] rounded-full transition-colors",
                  open ? "bg-gold-500" : "bg-navy-300 dark:bg-navy-300"
                )}
              />
            ))}
          </div>
        </button>

        {/* Original top-right dropdown */}
        <AnimatePresence>
          {open && (
            <div className="fixed right-2 top-14 sm:absolute sm:right-0 sm:top-full sm:mt-2 z-50 w-[calc(100vw-16px)] sm:w-[340px] rounded-2xl stitch-border shadow-2xl shadow-3d">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -8 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="w-full max-h-[80vh] overflow-y-auto rounded-[14px] bg-white dark:bg-navy-800 scrollbar-thin"
              >
                <NavMenuBody
                  categories={categories}
                  onItemClick={() => setOpen(false)}
                  onLogout={() => { setOpen(false); onLogout?.() }}
                />
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>}
    </div>
  )
}
