"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Trophy, Crown, Mic, BookOpen, Home } from "lucide-react"
import { supabase } from "@/lib/supabase"

interface HoF {
  topPerformers: Array<{ name: string; reg: string; points: number; wins: number }>
  topReciter: string | null
  topSpeaker: string | null
  bestHouses: Array<{ edition: string; house: string; points: number }>
}

// Public Hall of Fame (§J) — lifetime records across published editions.
export default function HallOfFamePage() {
  const [hof, setHof] = useState<HoF | null>(null)

  useEffect(() => {
    supabase.rpc("fest_hall_of_fame").then(({ data }) => setHof((data ?? null) as HoF | null))
  }, [])

  return (
    <main className="min-h-screen bg-gradient-to-b from-navy-950 to-black px-4 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-gold-400">Meelad Fest</p>
          <h1 className="flex items-center justify-center gap-3 text-4xl font-black"><Trophy className="size-8 text-gold-400" /> Hall of Fame</h1>
          <p className="mt-2 text-sm text-white/50">Lifetime records across all published editions</p>
        </div>

        {!hof ? (
          <p className="text-center text-white/50">Loading…</p>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Highlight icon={<Mic className="size-5" />} label="Top Speaker" value={hof.topSpeaker} />
              <Highlight icon={<BookOpen className="size-5" />} label="Top Reciter" value={hof.topReciter} />
            </div>

            <div className="rounded-2xl bg-white/5 p-6 backdrop-blur">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Crown className="size-5 text-gold-400" /> Best Performers (all-time)</h2>
              {hof.topPerformers.length === 0 ? <p className="text-white/50">No published results yet.</p> : (
                <ol className="space-y-2">
                  {hof.topPerformers.map((p, i) => (
                    <li key={p.reg} className="flex items-center justify-between border-b border-white/10 pb-2 last:border-0">
                      <span className="flex items-center gap-3">
                        <span className="w-6 text-center font-black text-gold-400">{i + 1}</span>
                        <span className="font-semibold">{p.name.trim()}</span>
                        <span className="text-xs text-white/40">({p.reg})</span>
                      </span>
                      <span className="text-right text-sm">
                        <span className="font-bold tabular-nums">{p.points}</span> pts
                        {p.wins > 0 && <span className="ml-2 text-gold-300">· {p.wins}× 1st</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {hof.bestHouses.length > 0 && (
              <div className="rounded-2xl bg-white/5 p-6 backdrop-blur">
                <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Home className="size-5 text-gold-400" /> Champion Houses</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {hof.bestHouses.map((b, i) => (
                    <div key={i} className="rounded-lg bg-white/5 p-3 text-center">
                      <p className="text-xs text-white/50">{b.edition}</p>
                      <p className="text-lg font-bold">{b.house}</p>
                      <p className="text-xs text-gold-300">{b.points} pts</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-8 text-center">
          <Link href="/" className="text-sm text-white/40 hover:text-white/70">← Back</Link>
        </div>
      </div>
    </main>
  )
}

function Highlight({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-5 backdrop-blur">
      <div className="rounded-full bg-gold-400/20 p-3 text-gold-300">{icon}</div>
      <div>
        <p className="text-xs uppercase tracking-wide text-white/50">{label}</p>
        <p className="text-lg font-bold">{value?.trim() ?? "—"}</p>
      </div>
    </div>
  )
}
