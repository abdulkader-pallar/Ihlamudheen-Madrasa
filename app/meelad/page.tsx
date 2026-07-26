"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Trophy, Image as ImageIcon, ScrollText, Star } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { fetchLeaderboard, type Leaderboard } from "@/lib/fest/leaderboard"

interface Edition { id: string; name: string; slug: string; theme: string | null; status: string }

// Public Ihlamudheen Madrasa Fest hub (§9 public landing) — no auth, lives outside /fest.
export default function MeeladPublicPage() {
  const [edition, setEdition] = useState<Edition | null>(null)
  const [lb, setLb] = useState<Leaderboard>({ houses: [], sections: [], individuals: [] })
  const [gallery, setGallery] = useState<string[]>([])

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("fest_editions")
        .select("id,name,slug,theme,status").neq("status", "draft")
        .order("year", { ascending: false }).limit(1)
      const ed = (data?.[0] ?? null) as Edition | null
      setEdition(ed)
      if (!ed) return
      const { data: lbData } = await fetchLeaderboard(supabase, ed.id)
      setLb(lbData)
      const { data: media } = await supabase.from("fest_media")
        .select("storage_path").eq("edition_id", ed.id).limit(8)
      setGallery(((media ?? []) as Array<{ storage_path: string }>)
        .map((m) => supabase.storage.from("fest-media").getPublicUrl(m.storage_path).data.publicUrl))
    })()
  }, [])

  return (
    <main className="min-h-screen bg-navy-50 dark:bg-navy-950">
      {/* Hero */}
      <section className="bg-gradient-to-br from-navy-900 to-navy-950 px-4 py-16 text-center text-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- public hero logo */}
        <img src="/logo.png" alt="Ihlamudheen Madrasa" className="mx-auto mb-4 h-12 w-auto"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
        <p className="text-xs uppercase tracking-[0.3em] text-gold-400">Ihlamudheen Madrasa</p>
        <h1 className="mt-2 text-4xl font-black sm:text-5xl">{edition?.name ?? "Ihlamudheen Madrasa Fest"}</h1>
        {edition?.theme && <p className="mt-2 text-lg italic text-white/70">&ldquo;{edition.theme}&rdquo;</p>}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {edition && (
            <Link href={`/public/${edition.slug}/results`} className="rounded-full bg-gold-500 px-5 py-2 text-sm font-semibold text-navy-900 hover:bg-gold-400">
              View Results
            </Link>
          )}
          <Link href="/hall-of-fame" className="rounded-full border border-white/30 px-5 py-2 text-sm font-semibold hover:bg-white/10">
            Hall of Fame
          </Link>
        </div>
      </section>

      <div className="mx-auto max-w-5xl space-y-10 px-4 py-10">
        {/* Live house race */}
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-navy-800 dark:text-white"><Trophy className="size-5 text-gold-500" /> House Standings</h2>
          {lb.houses.length === 0 ? (
            <p className="text-sm text-navy-500">Standings will appear here once the fest goes live.</p>
          ) : (
            <div className="space-y-2">
              {lb.houses.map((h) => {
                const max = Math.max(1, ...lb.houses.map((x) => x.points))
                return (
                  <div key={h.id}>
                    <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{h.name}</span><span>{h.points}</span></div>
                    <div className="h-3 overflow-hidden rounded-full bg-navy-100 dark:bg-navy-800">
                      <div className="h-full rounded-full" style={{ width: `${(h.points / max) * 100}%`, background: h.color ?? "#1e3a5f" }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Gallery preview */}
        {gallery.length > 0 && (
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-navy-800 dark:text-white"><ImageIcon className="size-5 text-gold-500" /> Ihlamudheen Madrasa Memories</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {gallery.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- public gallery from storage
                <img key={i} src={url} alt="Ihlamudheen Madrasa memory" className="aspect-square w-full rounded-lg object-cover" />
              ))}
            </div>
          </section>
        )}

        {/* Top performers */}
        {lb.individuals.length > 0 && (
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-navy-800 dark:text-white"><Star className="size-5 text-gold-500" /> Top Performers</h2>
            <ol className="space-y-1 text-sm">
              {lb.individuals.slice(0, 8).map((s, i) => (
                <li key={s.student_id} className="flex justify-between rounded-md bg-white px-3 py-1.5 dark:bg-navy-900">
                  <span><span className="mr-2 text-navy-400">{i + 1}.</span>{s.name.trim()}</span>
                  <span className="font-semibold">{s.points}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <p className="flex items-center justify-center gap-2 pt-4 text-xs text-navy-400">
          <ScrollText className="size-3" /> Ihlamudheen Madrasa · Ihlamudheen Madrasa
        </p>
      </div>
    </main>
  )
}
