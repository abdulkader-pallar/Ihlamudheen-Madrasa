"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import { ArrowLeft, BookMarked, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { fetchLeaderboard } from "@/lib/fest/leaderboard"
import { buildYearbookPdf, type YearbookData } from "@/lib/fest/yearbook"

interface AnalyticsRow { name: string; year: number | null; students: number; items: number; registrations: number }
interface EditionOpt { id: string; name: string; theme: string | null }

export default function FestArchivePage() {
  const [rows, setRows] = useState<AnalyticsRow[]>([])
  const [editions, setEditions] = useState<EditionOpt[]>([])
  const [editionId, setEditionId] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.rpc("fest_analytics").then(({ data }) => setRows((data ?? []) as AnalyticsRow[]))
    supabase.from("fest_editions").select("id,name,theme").neq("status", "draft")
      .order("year", { ascending: false })
      .then(({ data }) => {
        const opts = (data ?? []) as EditionOpt[]
        setEditions(opts)
        if (opts.length) setEditionId(opts[0].id)
      })
  }, [])

  async function downloadYearbook() {
    const edition = editions.find((e) => e.id === editionId)
    if (!edition) return
    setBusy(true)
    try {
      const [{ data: lb }, results, sectionRows] = await Promise.all([
        fetchLeaderboard(supabase, editionId),
        supabase.from("fest_results")
          .select("rank,grade, item:fest_items(name), registration:fest_registrations(student:fest_students(name))")
          .eq("edition_id", editionId).lte("rank", 3),
        supabase.from("fest_student_editions")
          .select("section:fest_sections(name), student:fest_students(reg_no,name)")
          .eq("edition_id", editionId),
      ])

      // Event winners grouped by item.
      const winnersByItem = new Map<string, Array<{ rank: number; name: string; grade: string | null }>>()
      for (const r of (results.data ?? []) as unknown as Array<{
        rank: number | null; grade: string | null
        item: { name: string } | null; registration: { student: { name: string } | null } | null
      }>) {
        const item = r.item?.name ?? "—"
        const list = winnersByItem.get(item) ?? []
        list.push({ rank: r.rank ?? 0, name: r.registration?.student?.name ?? "—", grade: r.grade })
        winnersByItem.set(item, list)
      }

      // Participants by section.
      const secMap = new Map<string, Array<{ reg: string; name: string }>>()
      for (const r of (sectionRows.data ?? []) as unknown as Array<{
        section: { name: string } | null; student: { reg_no: string; name: string } | null
      }>) {
        const name = r.section?.name ?? "Unassigned"
        const list = secMap.get(name) ?? []
        if (r.student) list.push({ reg: r.student.reg_no, name: r.student.name })
        secMap.set(name, list)
      }

      const a = rows.find((x) => x.name === edition.name)
      const data: YearbookData = {
        editionName: edition.name,
        theme: edition.theme,
        summary: { students: a?.students ?? 0, items: a?.items ?? 0, registrations: a?.registrations ?? 0 },
        houses: lb.houses.map((h) => ({ name: h.name, points: h.points })),
        results: Array.from(winnersByItem, ([item, winners]) => ({ item, winners: winners.sort((x, y) => x.rank - y.rank) })),
        sections: Array.from(secMap, ([name, students]) => ({ name, students }))
          .sort((x, y) => x.name.localeCompare(y.name)),
      }
      const doc = await buildYearbookPdf(data)
      doc.save(`ihlamudheen-yearbook-${edition.name.replace(/\s+/g, "-").toLowerCase()}.pdf`)
      toast.success("Yearbook generated")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/fest" className="text-navy-500 hover:text-navy-700 dark:text-navy-400"><ArrowLeft className="size-5" /></Link>
        <h1 className="text-2xl font-bold tracking-tight text-navy-800 dark:text-white">Archive &amp; Analytics</h1>
        <Link href="/hall-of-fame" className="ml-auto text-sm text-gold-600 hover:underline">Hall of Fame →</Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><BookMarked className="size-4 text-gold-500" /> Annual Ihlamudheen Madrasa Book</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-56">
            <label className="mb-1 block text-xs font-medium text-navy-600 dark:text-navy-300">Edition</label>
            <Select value={editionId} onValueChange={(v) => setEditionId(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Edition">{(v: string) => editions.find((e) => e.id === v)?.name ?? "Edition"}</SelectValue></SelectTrigger>
              <SelectContent>{editions.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={downloadYearbook} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <BookMarked className="size-4" />} Download yearbook PDF
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Participation by edition</CardTitle></CardHeader>
          <CardContent style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} /><Tooltip />
                <Bar dataKey="students" name="Participants" fill="#1e3a5f" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Registrations growth</CardTitle></CardHeader>
          <CardContent style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} /><Tooltip />
                <Line dataKey="registrations" name="Registrations" stroke="#ca8a04" strokeWidth={2} />
                <Line dataKey="items" name="Events" stroke="#2563eb" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
