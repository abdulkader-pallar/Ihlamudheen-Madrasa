"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowLeft, Tv, Trophy } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { fetchLeaderboard, type Leaderboard } from "@/lib/fest/leaderboard"

interface EditionOpt { id: string; name: string }

const MEDAL = ["#FFD700", "#C0C0C0", "#CD7F32"] // gold/silver/bronze

export default function FestLeaderboardPage() {
  const [editions, setEditions] = useState<EditionOpt[]>([])
  const [editionId, setEditionId] = useState("")
  const [lb, setLb] = useState<Leaderboard>({ houses: [], sections: [], individuals: [] })
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    supabase.from("fest_editions").select("id,name").neq("status", "archived")
      .order("year", { ascending: false })
      .then(({ data }) => {
        const opts = (data ?? []) as EditionOpt[]
        setEditions(opts)
        if (opts.length) setEditionId(opts[0].id)
      })
  }, [])

  const refresh = useCallback(async (eid: string) => {
    const { data, error } = await fetchLeaderboard(supabase, eid)
    setLb(data); setErr(error)
  }, [])

  useEffect(() => {
    if (!editionId) return
    void refresh(editionId)
    // Live updates: re-fetch whenever results for this edition change.
    const ch = supabase
      .channel(`fest-lb-${editionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "fest_results", filter: `edition_id=eq.${editionId}` },
        () => void refresh(editionId))
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [editionId, refresh])

  const maxHouse = Math.max(1, ...lb.houses.map((h) => h.points))
  const podium = lb.houses.slice(0, 3)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/fest" className="text-navy-500 hover:text-navy-700 dark:text-navy-400"><ArrowLeft className="size-5" /></Link>
        <h1 className="text-2xl font-bold tracking-tight text-navy-800 dark:text-white">Leaderboard</h1>
        <div className="ml-auto flex items-center gap-2">
          <Select value={editionId} onValueChange={(v) => setEditionId(v ?? "")}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Edition">{(v: string) => editions.find((e) => e.id === v)?.name ?? "Edition"}</SelectValue></SelectTrigger>
            <SelectContent>{editions.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
          </Select>
          <Link href={`/fest/stage-mode?edition=${editionId}`}><Button variant="outline" size="sm"><Tv className="size-4" /> Stage Mode</Button></Link>
        </div>
      </div>

      {err && <p className="text-sm text-amber-600">{err}</p>}

      {/* Podium */}
      <div className="grid grid-cols-3 items-end gap-3">
        {[1, 0, 2].map((slot) => {
          const h = podium[slot]
          const height = slot === 0 ? "h-40" : slot === 1 ? "h-32" : "h-24"
          if (!h) return <div key={slot} />
          return (
            <motion.div key={h.id} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: slot * 0.1 }}
              className="flex flex-col items-center">
              <Trophy className="mb-1 size-6" style={{ color: MEDAL[slot] }} />
              <span className="text-sm font-semibold text-navy-800 dark:text-white">{h.name}</span>
              <span className="text-xs text-navy-500">{h.points} pts</span>
              <div className={`mt-2 w-full rounded-t-lg ${height}`} style={{ background: h.color ?? MEDAL[slot] }} />
            </motion.div>
          )
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">House standings</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {lb.houses.length === 0 && <p className="text-sm text-navy-500">No points yet — recompute results.</p>}
            {lb.houses.map((h) => (
              <div key={h.id}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium text-navy-700 dark:text-navy-200">{h.name}</span>
                  <span className="text-navy-500">{h.points}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-navy-100 dark:bg-navy-800">
                  <motion.div className="h-full rounded-full" style={{ background: h.color ?? "#1e3a5f" }}
                    initial={{ width: 0 }} animate={{ width: `${(h.points / maxHouse) * 100}%` }} transition={{ duration: 0.6 }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Top individuals</CardTitle></CardHeader>
          <CardContent>
            {lb.individuals.length === 0 && <p className="text-sm text-navy-500">No individual points yet.</p>}
            <ol className="space-y-1 text-sm">
              {lb.individuals.slice(0, 10).map((s, i) => (
                <li key={s.student_id} className="flex justify-between">
                  <span><span className="mr-2 text-navy-400">{i + 1}.</span>{s.name.trim()} <span className="text-navy-400">({s.reg})</span></span>
                  <span className="font-semibold">{s.points}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      {lb.sections.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Section standings</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {lb.sections.map((s) => (
              <div key={s.id} className="flex justify-between rounded-md border border-border/60 px-3 py-2 text-sm">
                <span className="font-medium">{s.name}</span><span className="text-navy-500">{s.points}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
