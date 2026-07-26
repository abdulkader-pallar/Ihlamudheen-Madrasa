"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { Medal } from "lucide-react"
import { supabase } from "@/lib/supabase"

interface Winner { rank: number; grade: string | null; name: string }
interface ItemResult { item: string; type: string; winners: Winner[] }
interface PublicResults { found: boolean; published?: boolean; items?: ItemResult[] }

const RANK_COLOR: Record<number, string> = { 1: "#FFD700", 2: "#C0C0C0", 3: "#CD7F32" }

// Public read-only results portal (§9 /public/[edition]/results).
export default function PublicResultsPage({ params }: { params: Promise<{ edition: string }> }) {
  const { edition } = use(params)
  const [data, setData] = useState<PublicResults | null>(null)

  useEffect(() => {
    supabase.rpc("fest_public_results", { p_slug: edition })
      .then(({ data }) => setData((data ?? { found: false }) as PublicResults))
  }, [edition])

  return (
    <main className="min-h-screen bg-navy-50 px-4 py-10 dark:bg-navy-950">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- public logo */}
          <img src="/logo.png" alt="Ihlamudheen Madrasa" className="mx-auto mb-2 h-10 w-auto"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
          <h1 className="whitespace-nowrap text-xl font-extrabold text-navy-800 dark:text-white">Ihlamudheen Madrasa</h1>
          <p className="text-xs text-navy-500">Ihlamudheen Madrasa Fest Results · {edition}</p>
        </div>

        {!data ? (
          <p className="text-center text-sm text-navy-500">Loading…</p>
        ) : !data.found ? (
          <p className="text-center text-sm text-navy-500">Edition not found.</p>
        ) : !data.published ? (
          <p className="text-center text-sm text-navy-500">Results have not been published yet.</p>
        ) : (data.items ?? []).length === 0 ? (
          <p className="text-center text-sm text-navy-500">No winners published yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {(data.items ?? []).map((it) => (
              <div key={it.item} className="rounded-xl border border-border bg-white p-4 dark:bg-navy-900">
                <h2 className="mb-2 text-sm font-semibold text-navy-800 dark:text-white">{it.item}</h2>
                <ul className="space-y-1 text-sm">
                  {it.winners.map((w, i) => (
                    <li key={i} className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Medal className="size-4" style={{ color: RANK_COLOR[w.rank] ?? "#94a3b8" }} />
                        {w.name.trim()}
                      </span>
                      {w.grade && w.grade !== "-" && <span className="text-xs text-navy-500">Grade {w.grade}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 text-center">
          <Link href="/meelad" className="text-sm text-gold-600 hover:underline">← Ihlamudheen Madrasa Fest home</Link>
        </div>
      </div>
    </main>
  )
}
