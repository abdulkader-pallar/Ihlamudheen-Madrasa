"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Calculator, Globe, EyeOff, Medal, Megaphone, Copy } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { authFetch } from "@/lib/api-client"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

interface EditionOpt { id: string; name: string; status: string }
interface ResRow {
  itemId: string; itemName: string; itemType: string
  rank: number | null; grade: string | null; points: number; mark: number | null
  name: string; reg: string
}

const RANK_COLOR: Record<number, string> = { 1: "#FFD700", 2: "#C0C0C0", 3: "#CD7F32" }

export default function FestResultsPage() {
  const [editions, setEditions] = useState<EditionOpt[]>([])
  const [editionId, setEditionId] = useState("")
  const [rows, setRows] = useState<ResRow[]>([])
  const [busy, setBusy] = useState(false)
  const [announcement, setAnnouncement] = useState<string | null>(null)

  const edition = editions.find((e) => e.id === editionId)
  const published = edition?.status === "results_published"

  const loadEditions = useCallback(async () => {
    const { data } = await supabase.from("fest_editions").select("id,name,status")
      .neq("status", "archived").order("year", { ascending: false })
    const opts = (data ?? []) as EditionOpt[]
    setEditions(opts)
    setEditionId((cur) => (opts.some((o) => o.id === cur) ? cur : opts[0]?.id ?? ""))
  }, [])
  useEffect(() => { void loadEditions() }, [loadEditions])

  const loadResults = useCallback(async (eid: string) => {
    if (!eid) return
    const { data } = await supabase.from("fest_results")
      .select("rank,grade,points,avg_mark, item:fest_items(id,name,type), registration:fest_registrations(student:fest_students(name,reg_no))")
      .eq("edition_id", eid)
    const out: ResRow[] = ((data ?? []) as unknown as Array<{
      rank: number | null; grade: string | null; points: number; avg_mark: number | null
      item: { id: string; name: string; type: string } | null
      registration: { student: { name: string; reg_no: string } | null } | null
    }>).map((r) => ({
      itemId: r.item?.id ?? "?", itemName: r.item?.name ?? "?", itemType: r.item?.type ?? "individual",
      rank: r.rank, grade: r.grade, points: r.points, mark: r.avg_mark,
      name: r.registration?.student?.name ?? "—", reg: r.registration?.student?.reg_no ?? "",
    }))
    out.sort((a, b) => a.itemName.localeCompare(b.itemName) || (a.rank ?? 99) - (b.rank ?? 99))
    setRows(out)
  }, [])
  useEffect(() => { void loadResults(editionId) }, [editionId, loadResults])

  async function recompute() {
    setBusy(true)
    const { error } = await supabase.rpc("fest_recompute_results", { p_edition_id: editionId })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success("Results recomputed"); void loadResults(editionId)
  }

  async function announce() {
    const res = await authFetch("/api/fest/announce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editionId }),
    })
    const json = await res.json()
    if (!res.ok) return toast.error(json.error ?? "Failed")
    setAnnouncement(json.text)
  }

  async function togglePublish() {
    const next = published ? "live" : "results_published"
    const { error } = await supabase.from("fest_editions").update({ status: next }).eq("id", editionId)
    if (error) return toast.error(error.message)
    toast.success(published ? "Results hidden from public" : "Results published")
    void loadEditions()
  }

  // Group rows by item for display.
  const byItem = new Map<string, ResRow[]>()
  for (const r of rows) {
    const list = byItem.get(r.itemId) ?? []
    list.push(r); byItem.set(r.itemId, list)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/fest" className="text-navy-500 hover:text-navy-700 dark:text-navy-400"><ArrowLeft className="size-5" /></Link>
        <h1 className="text-2xl font-bold tracking-tight text-navy-800 dark:text-white">Results</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={editionId} onValueChange={(v) => setEditionId(v ?? "")}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Edition">{(v: string) => editions.find((e) => e.id === v)?.name ?? "Edition"}</SelectValue></SelectTrigger>
            <SelectContent>{editions.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={recompute} disabled={busy}><Calculator className="size-4" /> Recompute</Button>
          <Button variant="outline" size="sm" onClick={announce}><Megaphone className="size-4" /> Announcement</Button>
          <Button variant={published ? "outline" : "default"} size="sm" onClick={togglePublish}>
            {published ? <><EyeOff className="size-4" /> Unpublish</> : <><Globe className="size-4" /> Publish</>}
          </Button>
        </div>
      </div>

      {edition && (
        <p className="text-sm text-navy-500">
          Status: <Badge variant={published ? "default" : "secondary"}>{edition.status.replace(/_/g, " ")}</Badge>
          {published && <> · public can see <Link className="underline" href={`/fest/leaderboard`}>the leaderboard</Link></>}
        </p>
      )}

      {byItem.size === 0 && <p className="text-sm text-navy-500">No results yet. Score items in Judging, then Recompute.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {Array.from(byItem.entries()).map(([itemId, list]) => {
          const winners = list.filter((r) => (r.rank ?? 99) <= 3).sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9))
          return (
            <Card key={itemId}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  {list[0].itemName}<Badge variant="outline" className="text-[10px]">{list[0].itemType}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {winners.length === 0
                  ? <p className="text-xs text-navy-400">No graded winners.</p>
                  : (
                    <ul className="space-y-1 text-sm">
                      {winners.map((w, i) => (
                        <li key={i} className="flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <Medal className="size-4" style={{ color: RANK_COLOR[w.rank ?? 0] ?? "#94a3b8" }} />
                            <span className="font-medium">{w.name.trim()}</span>
                            <span className="text-navy-400">({w.reg})</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <Badge variant="secondary">{w.grade}</Badge>
                            <span className="text-xs text-navy-500">{w.points} pts</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Dialog open={announcement !== null} onOpenChange={(o) => !o && setAnnouncement(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Results announcement</DialogTitle></DialogHeader>
          <p className="text-xs text-navy-500">Copy this into WhatsApp or email. (Email auto-send activates when Gmail is configured.)</p>
          <Textarea readOnly value={announcement ?? ""} className="h-64 font-mono text-xs" />
          <Button onClick={() => { navigator.clipboard?.writeText(announcement ?? ""); toast.success("Copied") }}>
            <Copy className="size-4" /> Copy
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
