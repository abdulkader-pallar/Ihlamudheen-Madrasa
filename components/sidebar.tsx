"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import Image from "next/image"
import {
  LayoutDashboard,
  BookOpen,
  Calendar,
  MessageSquare,
  User,
  Settings,
  Shield,
  LogOut,
  Menu,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  adminOnly?: boolean
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/courses", label: "My Courses", icon: BookOpen },
  { href: "/dashboard/schedule", label: "Schedule", icon: Calendar },
  { href: "/dashboard/messages", label: "Messages", icon: MessageSquare },
  { href: "/dashboard/profile", label: "Profile", icon: User },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
  { href: "/admin", label: "Admin Panel", icon: Shield, adminOnly: true },
]

interface SidebarProps {
  isAdmin?: boolean
  userName?: string
  userAvatar?: string
  onLogout?: () => void
}

function NavLink({
  item,
  isActive,
  collapsed,
}: {
  item: NavItem
  isActive: boolean
  collapsed: boolean
}) {
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        isActive
          ? "bg-gold-500/10 text-gold-600 dark:bg-gold-500/20 dark:text-gold-400"
          : "text-navy-600 hover:bg-navy-100 hover:text-navy-900 dark:text-navy-300 dark:hover:bg-navy-800 dark:hover:text-white",
        collapsed && "justify-center px-2"
      )}
      title={collapsed ? item.label : undefined}
    >
      <Icon className="size-5 shrink-0" />
      <AnimatePresence mode="wait">
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden whitespace-nowrap"
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  )
}

function SidebarContent({
  isAdmin,
  userName,
  collapsed,
  pathname,
  onLogout,
}: SidebarProps & { collapsed: boolean; pathname: string }) {
  const filteredItems = navItems.filter(
    (item) => !item.adminOnly || isAdmin
  )

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-border/40 px-4",
          collapsed && "justify-center px-2"
        )}
      >
        <Link href="/dashboard" className="flex items-center gap-2">
          <Image src="/logo-icon.png" alt="Ihlamudheen" width={32} height={32} className="size-8 shrink-0" />
          <AnimatePresence mode="wait">
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden whitespace-nowrap flex flex-col leading-none"
              >
                <span className="text-lg font-bold text-navy-800 dark:text-white">Ihlamudheen</span>
                <span className="text-[9px] font-medium text-navy-500 dark:text-navy-400 tracking-wider"></span>
              </motion.div>
            )}
          </AnimatePresence>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3">
        {filteredItems.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            isActive={pathname === item.href}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* Footer: user info + logout */}
      <div
        className={cn(
          "border-t border-border/40 p-3",
          collapsed && "flex flex-col items-center"
        )}
      >
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg p-2",
            collapsed && "justify-center p-1"
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold-500 text-sm font-semibold text-white">
            {userName ? userName[0].toUpperCase() : "U"}
          </div>
          <AnimatePresence mode="wait">
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                className="flex-1 overflow-hidden"
              >
                <p className="truncate text-sm font-medium text-navy-800 dark:text-white">
                  {userName ?? "User"}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "default"}
          className={cn(
            "mt-1 w-full text-navy-600 hover:text-red-600 dark:text-navy-300 dark:hover:text-red-400",
            collapsed && "w-auto"
          )}
          onClick={onLogout}
        >
          <LogOut className="size-4" />
          {!collapsed && <span className="ml-2">Logout</span>}
        </Button>
      </div>
    </div>
  )
}

export function Sidebar({
  isAdmin = false,
  userName = "User",
  userAvatar,
  onLogout,
}: SidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      {/* Mobile trigger */}
      <div className="fixed left-4 top-4 z-50 lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger className="inline-flex items-center justify-center rounded-md border border-border bg-background p-2 hover:bg-muted">
            <Menu className="size-5" />
            <span className="sr-only">Open sidebar</span>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <SidebarContent
              isAdmin={isAdmin}
              userName={userName}
              userAvatar={userAvatar}
              collapsed={false}
              pathname={pathname}
              onLogout={onLogout}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 72 : 256 }}
        transition={{ duration: 0.2, ease: "easeInOut" as const }}
        className="relative hidden h-screen border-r border-border/40 bg-white dark:bg-navy-800 lg:block"
      >
        <SidebarContent
          isAdmin={isAdmin}
          userName={userName}
          userAvatar={userAvatar}
          collapsed={collapsed}
          pathname={pathname}
          onLogout={onLogout}
        />

        {/* Collapse toggle — 9-dot grid */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-4 top-20 z-10 flex size-8 items-center justify-center rounded-lg border border-border/60 bg-white shadow-md transition-colors hover:bg-navy-50 dark:bg-navy-700 dark:hover:bg-navy-600"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <div className="grid grid-cols-3 gap-[2.5px]">
            {[...Array(9)].map((_, i) => (
              <span key={i} className="block size-[3px] rounded-full bg-navy-500 dark:bg-navy-300" />
            ))}
          </div>
        </button>
      </motion.aside>
    </>
  )
}
