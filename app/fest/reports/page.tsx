"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, FileSpreadsheet, Printer, Trophy, ListChecks } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { fetchLeaderboard } from "@/lib/fest/leaderboard"

interface EditionOpt { id: string; name: string }

function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n")
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }))
  const a = document.createElement("a")
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function FestReportsPage() {
  const [editions, setEditions] = useState<EditionOpt[]>([])
  const [editionId, setEditionId] = useState("")
  const edition = editions.find((e) => e.id === editionId)
  const tag = (edition?.name ?? "edition").replace(/\s+/g, "-").toLowerCase()

  useEffect(() => {
    supabase.from("fest_editions").select("id,name").neq("status", "archived")
      .order("year", { ascending: false })
      .then(({ data }) => {
        const opts = (data ?? []) as EditionOpt[]
        setEditions(opts)
        if (opts.length) setEditionId(opts[0].id)
      })
  }, [])

  async function resultsCsv() {
    const { data } = await supabase.from("fest_results")
      .select("rank,grade,points,avg_mark, item:fest_items(name,type), registration:fest_registrations(student:fest_students(name,reg_no))")
      .eq("edition_id", editionId)
    const rows = ((data ?? []) as unknown as Array<{
      rank: number | null; grade: string | null; points: number; avg_mark: number | null
      item: { name: string; type: string } | null
      registration: { student: { name: string; reg_no: string } | null } | null
    }>)
    if (rows.length === 0) return toast.info("No results yet")
    const out: (string | number | null)[][] = [["Item", "Type", "Reg", "Name", "Rank", "Grade", "Mark", "Points"]]
    rows
      .sort((a, b) => (a.item?.name ?? "").localeCompare(b.item?.name ?? "") || (a.rank ?? 99) - (b.rank ?? 99))
      .forEach((r) => out.push([
        r.item?.name ?? "", r.item?.type ?? "", r.registration?.student?.reg_no ?? "",
        r.registration?.student?.name?.trim() ?? "", r.rank, r.grade, r.avg_mark, r.points,
      ]))
    downloadCsv(`ihlamudheen-results-${tag}.csv`, out)
  }

  async function houseCsv() {
    const { data, error } = await fetchLeaderboard(supabase, editionId)
    if (error) return toast.error(error)
    const out: (string | number | null)[][] = [["House", "Points"]]
    data.houses.forEach((h) => out.push([h.name, h.points]))
    out.push([])
    out.push(["Section", "Points"])
    data.sections.forEach((s) => out.push([s.name, s.points]))
    downloadCsv(`ihlamudheen-standings-${tag}.csv`, out)
  }

  async function callerSheet() {
    // Code numbers to call per scheduled item (anonymized stage-caller sheet).
    const { data: items } = await supabase.from("fest_items")
      .select("id,name,stage,scheduled_at").eq("edition_id", editionId).not("scheduled_at", "is", null)
      .order("scheduled_at")
    const its = (items ?? []) as Array<{ id: string; name: string; stage: string | null; scheduled_at: string }>
    if (its.length === 0) return toast.info("No scheduled items")

    const blocks: string[] = []
    for (const it of its) {
      const { data: sheet } = await supabase.rpc("fest_judge_sheet", { p_item_id: it.id })
      const codes = ((sheet ?? []) as Array<{ code_no: string | null }>).map((s) => s.code_no ?? "—").join(", ")
      const time = new Date(it.scheduled_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      blocks.push(`<div class="blk"><h3>${time} · ${it.name}${it.stage ? ` — ${it.stage}` : ""}</h3><p>${codes || "No entries"}</p></div>`)
    }
    const w = window.open("", "_blank")
    if (!w) return
    w.document.write(`<html><head><title>Caller Sheet</title><style>
      body{font-family:system-ui;padding:24px;color:#1e3a5f}
      header{text-align:center;border-bottom:2px solid #1e3a5f;padding-bottom:12px;margin-bottom:16px}
      .school{font-weight:800;font-size:18pt;white-space:nowrap}.sub{font-size:9pt;color:#5c6b82}
      .blk{margin-bottom:10px}.blk h3{margin:0;font-size:12pt}.blk p{margin:2px 0 0;font-family:monospace}
    </style></head><body>
      <header><img src="/logo.png" style="height:40px"/><div class="school">Ihlamudheen Madrasa</div>
      <div class="sub">Ihlamudheen Madrasa · Stage Caller Sheet — ${edition?.name ?? ""}</div></header>
      ${blocks.join("")}
    </body></html>`)
    w.document.close(); w.focus(); w.print()
  }

  const reports = [
    { title: "Event results", desc: "Every item's ranks, grades, marks, and points.", icon: ListChecks, run: resultsCsv, fmt: "CSV" },
    { title: "House & section standings", desc: "Total points by house and section.", icon: Trophy, run: houseCsv, fmt: "CSV" },
    { title: "Stage caller sheet", desc: "Code numbers to call per scheduled item.", icon: Printer, run: callerSheet, fmt: "Print" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/fest" className="text-navy-500 hover:text-navy-700 dark:text-navy-400"><ArrowLeft className="size-5" /></Link>
        <h1 className="text-2xl font-bold tracking-tight text-navy-800 dark:text-white">Reports &amp; Exports</h1>
        <div className="ml-auto">
          <Select value={editionId} onValueChange={(v) => setEditionId(v ?? "")}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Edition">{(v: string) => editions.find((e) => e.id === v)?.name ?? "Edition"}</SelectValue></SelectTrigger>
            <SelectContent>{editions.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => {
          const Icon = r.icon
          return (
            <Card key={r.title}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base"><Icon className="size-4 text-gold-500" /> {r.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-navy-600 dark:text-navy-300">{r.desc}</p>
                <Button variant="outline" size="sm" onClick={() => void r.run()}>
                  <FileSpreadsheet className="size-4" /> Export {r.fmt}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
