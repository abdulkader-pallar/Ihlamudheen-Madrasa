"use client"

import Link from "next/link"
import { Upload, CalendarDays, Trophy, Users, ClipboardList, Gavel, Medal, Award, FileBarChart, Image as ImageIcon, BookMarked, Globe, Wallet } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/hooks/use-auth"
import { isSuperadmin } from "@/lib/types"

// Phase 1 landing for the Meelad Fest module. Cards for later phases are shown
// as "coming soon" so the build order (§13) is visible but only Import is live.
const TILES = [
  {
    href: "/fest/import",
    title: "Excel Import",
    desc: "Bulk-import the READ FEST roster (SL · REG · NAME · P1–P4) with item normalization and a review step.",
    icon: Upload,
    live: true,
  },
  {
    href: "/fest/items",
    title: "Item Catalog",
    desc: "Events, rubrics, categories, clone-from-previous-year, and the default-catalog seed.",
    icon: ClipboardList,
    live: true,
  },
  { href: "/fest/registration", title: "Registration", desc: "Add students one by one with the programs they selected, manage per-section rosters with cap rules, and QR student IDs.", icon: Users, live: true },
  { href: "/fest/schedule", title: "Scheduling", desc: "Stage/slot planner with student, judge, and stage clash detection.", icon: CalendarDays, live: true },
  { href: "/fest/judging", title: "Judging", desc: "Offline-capable score sheets by code number, with results recompute.", icon: Gavel, live: true },
  { href: "/fest/results", title: "Results", desc: "Recompute, publish, and per-item winners with grades and points.", icon: Medal, live: true },
  { href: "/fest/leaderboard", title: "Leaderboard", desc: "Live house race, animated podium, sections, and top individuals.", icon: Trophy, live: true },
  { href: "/fest/certificates", title: "Certificates", desc: "Participation & winner PDFs with QR verification.", icon: Award, live: true },
  { href: "/fest/reports", title: "Reports & Exports", desc: "Results, standings, and the stage caller sheet (CSV / print).", icon: FileBarChart, live: true },
  { href: "/fest/media", title: "Ihlamudheen Madrasa Memories", desc: "Upload and browse photos by edition → event → category.", icon: ImageIcon, live: true },
  { href: "/fest/archive", title: "Archive & Yearbook", desc: "Cross-edition analytics and the one-click Annual Ihlamudheen Madrasa Book PDF.", icon: BookMarked, live: true },
  { href: "/meelad", title: "Public Site", desc: "The public-facing landing, live leaderboard, gallery, and results portal.", icon: Globe, live: true },
]

// Super-admins only (mirrors the RLS on meelad_accounts_entries), so it is kept
// out of the shared TILES list and appended per-user.
const ACCOUNTS_TILE = {
  href: "/admin/meelad",
  title: "Meelad Accounts",
  desc: "Standalone income & expenditure book for the Meelad ul Nabi program, by year. Separate from institute accounting.",
  icon: Wallet,
  live: true,
}

export default function FestHome() {
  const { user } = useAuth(true)
  const tiles = isSuperadmin(user?.email) ? [...TILES, ACCOUNTS_TILE] : TILES

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-navy-800 dark:text-white">Meelad Fest</h1>
        <Badge variant="secondary">Per-course editions</Badge>
      </div>
      <p className="max-w-2xl text-sm text-navy-600 dark:text-navy-300">
        Meelad Fest portal. Each course runs its own fest, by academic year — pick the
        course (and year) at the top of each tool below to manage that course&apos;s students,
        programs, schedule, judging, and results in isolation. New academic years roll over
        automatically.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => {
          const Icon = t.icon
          const card = (
            <Card className={t.live ? "transition hover:border-gold-400 hover:shadow-md" : "opacity-60"}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="size-4 text-gold-500" />
                  {t.title}
                </CardTitle>
                {!t.live && <Badge variant="outline" className="text-[10px]">Soon</Badge>}
              </CardHeader>
              <CardContent className="text-sm text-navy-600 dark:text-navy-300">{t.desc}</CardContent>
            </Card>
          )
          return t.live ? (
            <Link key={t.title} href={t.href}>{card}</Link>
          ) : (
            <div key={t.title}>{card}</div>
          )
        })}
      </div>
    </div>
  )
}
