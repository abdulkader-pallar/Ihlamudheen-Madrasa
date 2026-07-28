"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { motion } from "framer-motion"
import { supabase } from "@/lib/supabase"
import { fetchLeaderboard, type Leaderboard } from "@/lib/fest/leaderboard"

interface SlotItem { id: string; name: string; stage: string | null; startsAt: number; durationMin: number }

function StageMode() {
  const params = useSearchParams()
  const editionParam = params.get("edition") ?? ""
  const [editionId, setEditionId] = useState(editionParam)
  const [editionName, setEditionName] = useState("")
  const [lb, setLb] = useState<Leaderboard>({ houses: [], sections: [], individuals: [] })
  const [items, setItems] = useState<SlotItem[]>([])
  const [now, setNow] = useState(Date.now())

  // Resolve a default edition if none passed.
  useEffect(() => {
    if (editionId) return
    supabase.from("fest_editions").select("id,name")
      .in("status", ["live", "results_published"]).order("year", { ascending: false }).limit(1)
      .then(({ data }) => { if (data?.[0]) { setEditionId(data[0].id); setEditionName(data[0].name) } })
  }, [editionId])

  useEffect(() => {
    if (!editionId || editionName) return
    supabase.from("fest_editions").select("name").eq("id", editionId).single()
      .then(({ data }) => { if (data) setEditionName((data as { name: string }).name) })
  }, [editionId, editionName])

  const refresh = useCallback(async (eid: string) => {
    const { data } = await fetchLeaderboard(supabase, eid)
    setLb(data)
    const { data: its } = await supabase.from("fest_items")
      .select("id,name,stage,scheduled_at,duration_minutes")
      .eq("edition_id", eid).not("scheduled_at", "is", null)
    setItems(((its ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string, name: r.name as string, stage: (r.stage as string | null) ?? null,
      startsAt: new Date(r.scheduled_at as string).getTime(),
      durationMin: (r.duration_minutes as number | null) ?? 30,
    })))
  }, [])

  useEffect(() => {
    if (!editionId) return
    void refresh(editionId)
    const ch = supabase.channel(`fest-stage-${editionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "fest_results", filter: `edition_id=eq.${editionId}` },
        () => void refresh(editionId))
      .subscribe()
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => { void supabase.removeChannel(ch); clearInterval(t) }
  }, [editionId, refresh])

  const onStage = items.filter((i) => i.startsAt <= now && now < i.startsAt + i.durationMin * 60_000)
  const upNext = items.filter((i) => i.startsAt > now).sort((a, b) => a.startsAt - b.startsAt).slice(0, 4)
  const leader = lb.houses[0]

  return (
    <div className="-mx-4 -my-6 min-h-screen bg-gradient-to-br from-navy-950 to-black px-8 py-8 text-white sm:-mx-6 lg:-mx-8">
      <div className="mb-6 text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-gold-400">Meelad Fest</p>
        <h1 className="text-4xl font-black tracking-tight">{editionName || "Live"}</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* House tally */}
        <div className="rounded-3xl bg-white/5 p-6 backdrop-blur">
          <h2 className="mb-4 text-lg font-semibold uppercase tracking-wider text-white/70">House standings</h2>
          {lb.houses.length === 0 && <p className="text-white/50">Awaiting results…</p>}
          <div className="space-y-4">
            {lb.houses.map((h, i) => {
              const max = Math.max(1, ...lb.houses.map((x) => x.points))
              return (
                <div key={h.id}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-2xl font-bold">{i === 0 ? "👑 " : ""}{h.name}</span>
                    <span className="text-3xl font-black tabular-nums">{h.points}</span>
                  </div>
                  <div className="h-4 overflow-hidden rounded-full bg-white/10">
                    <motion.div className="h-full rounded-full" style={{ background: h.color ?? "#FFD700" }}
                      animate={{ width: `${(h.points / max) * 100}%` }} transition={{ duration: 0.8 }} />
                  </div>
                </div>
              )
            })}
          </div>
          {leader && <p className="mt-5 text-center text-xl font-semibold text-gold-300">Leading: {leader.name}</p>}
        </div>

        <div className="space-y-6">
          {/* Now on stage / up next */}
          <div className="rounded-3xl bg-white/5 p-6 backdrop-blur">
            <h2 className="mb-3 text-lg font-semibold uppercase tracking-wider text-white/70">On stage now</h2>
            {onStage.length === 0 ? <p className="text-white/50">—</p> : onStage.map((i) => (
              <p key={i.id} className="text-2xl font-bold">{i.name} <span className="text-base text-white/50">· {i.stage}</span></p>
            ))}
            <h2 className="mb-2 mt-5 text-lg font-semibold uppercase tracking-wider text-white/70">Up next</h2>
            <ul className="space-y-1">
              {upNext.length === 0 ? <li className="text-white/50">—</li> : upNext.map((i) => (
                <li key={i.id} className="flex justify-between text-white/90">
                  <span>{i.name}</span>
                  <span className="text-white/50">{new Date(i.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Top individuals */}
          <div className="rounded-3xl bg-white/5 p-6 backdrop-blur">
            <h2 className="mb-3 text-lg font-semibold uppercase tracking-wider text-white/70">Top performers</h2>
            <ol className="space-y-1">
              {lb.individuals.slice(0, 5).map((s, i) => (
                <li key={s.student_id} className="flex justify-between">
                  <span><span className="mr-2 text-gold-400">{i + 1}.</span>{s.name.trim()}</span>
                  <span className="font-bold tabular-nums">{s.points}</span>
                </li>
              ))}
              {lb.individuals.length === 0 && <li className="text-white/50">—</li>}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StageModePage() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-navy-500">Loading…</p>}>
      <StageMode />
    </Suspense>
  )
}
