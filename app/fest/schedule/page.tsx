"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Plus, AlertTriangle, CheckCircle2, Printer } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { detectClashes, clashSummary, type ScheduledItem } from "@/lib/fest/schedule"

interface EditionOpt { id: string; name: string }
interface Stage { id: string; name: string }
interface ItemRow {
  id: string
  name: string
  type: "individual" | "group"
  stageId: string | null
  scheduledAt: string | null // ISO
  durationMin: number | null
}

const NO_STAGE = "__none__"

/** ISO → value for <input type="datetime-local"> in local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(v: string): string | null {
  if (!v) return null
  return new Date(v).toISOString()
}

export default function FestSchedulePage() {
  const [editions, setEditions] = useState<EditionOpt[]>([])
  const [editionId, setEditionId] = useState("")
  const [stages, setStages] = useState<Stage[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [studentsByItem, setStudentsByItem] = useState<Record<string, string[]>>({})
  const [newStage, setNewStage] = useState("")

  useEffect(() => {
    supabase.from("fest_editions").select("id,name").neq("status", "archived")
      .order("year", { ascending: false })
      .then(({ data }) => {
        const opts = (data ?? []) as EditionOpt[]
        setEditions(opts)
        if (opts.length) setEditionId(opts[0].id)
      })
  }, [])

  const load = useCallback(async (eid: string) => {
    if (!eid) return
    const [{ data: st }, { data: it }, { data: regs }] = await Promise.all([
      supabase.from("fest_stages").select("id,name").eq("edition_id", eid).order("sort_order"),
      supabase.from("fest_items").select("id,name,type,stage_id,scheduled_at,duration_minutes").eq("edition_id", eid).order("name"),
      supabase.from("fest_registrations").select("item_id,student_id").eq("edition_id", eid),
    ])
    setStages((st ?? []) as Stage[])
    setItems(((it ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      type: r.type as "individual" | "group",
      stageId: (r.stage_id as string | null) ?? null,
      scheduledAt: (r.scheduled_at as string | null) ?? null,
      durationMin: (r.duration_minutes as number | null) ?? null,
    })))
    const map: Record<string, string[]> = {}
    for (const r of (regs ?? []) as Array<{ item_id: string; student_id: string | null }>) {
      if (!r.student_id) continue
      ;(map[r.item_id] ??= []).push(r.student_id)
    }
    setStudentsByItem(map)
  }, [])

  useEffect(() => { void load(editionId) }, [editionId, load])

  async function addStage() {
    const name = newStage.trim()
    if (!name || !editionId) return
    const { error } = await supabase.from("fest_stages").insert({ edition_id: editionId, name, sort_order: stages.length })
    if (error) return toast.error(error.message)
    setNewStage("")
    void load(editionId)
  }

  async function patchItem(id: string, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
    const db: Record<string, unknown> = {}
    if ("stageId" in patch) db.stage_id = patch.stageId
    if ("scheduledAt" in patch) db.scheduled_at = patch.scheduledAt
    if ("durationMin" in patch) db.duration_minutes = patch.durationMin
    const { error } = await supabase.from("fest_items").update(db).eq("id", id)
    if (error) toast.error(error.message)
  }

  const scheduledItems: ScheduledItem[] = useMemo(
    () => items.map((it) => ({
      id: it.id,
      name: it.name,
      stageId: it.stageId,
      startsAt: it.scheduledAt ? new Date(it.scheduledAt).getTime() : null,
      durationMin: it.durationMin,
      studentIds: studentsByItem[it.id] ?? [],
    })),
    [items, studentsByItem],
  )
  const clashes = useMemo(() => detectClashes(scheduledItems), [scheduledItems])
  const summary = clashSummary(clashes)
  const stageName = useMemo(() => new Map(stages.map((s) => [s.id, s.name])), [stages])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href="/fest" className="text-navy-500 hover:text-navy-700 dark:text-navy-400"><ArrowLeft className="size-5" /></Link>
        <h1 className="text-2xl font-bold tracking-tight text-navy-800 dark:text-white">Scheduling</h1>
        <div className="ml-auto flex items-center gap-2">
          <Select value={editionId} onValueChange={(v) => setEditionId(v ?? "")}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Edition">{(v: string) => editions.find((e) => e.id === v)?.name ?? "Edition"}</SelectValue></SelectTrigger>
            <SelectContent>{editions.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-4" /> Print programme</Button>
        </div>
      </div>

      {/* Clash banner */}
      <Card className={clashes.length ? "border-amber-400" : "border-emerald-400"}>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          {clashes.length === 0 ? (
            <><CheckCircle2 className="size-5 text-emerald-500" /><span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">No clashes — safe to go live.</span></>
          ) : (
            <>
              <AlertTriangle className="size-5 text-amber-500" />
              <span className="text-sm font-medium text-amber-700 dark:text-amber-400">{clashes.length} clash(es):</span>
              <Badge variant="outline">{summary.student} student</Badge>
              <Badge variant="outline">{summary.judge} judge</Badge>
              <Badge variant="outline">{summary.stage} stage</Badge>
            </>
          )}
        </CardContent>
      </Card>

      {clashes.length > 0 && (
        <Card className="print:hidden">
          <CardHeader><CardTitle className="text-base">Conflicts to resolve</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {clashes.map((c, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">{c.type}</Badge>
                  <span className="text-navy-700 dark:text-navy-200">
                    <strong>{c.itemAName}</strong> ↔ <strong>{c.itemBName}</strong>
                    {c.type === "stage" && <> on stage {stageName.get(c.resourceId) ?? c.resourceId}</>}
                    {c.type === "student" && <> share a participant</>}
                    {c.type === "judge" && <> share a judge</>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Stages */}
      <Card className="print:hidden">
        <CardHeader><CardTitle className="text-base">Stages</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {stages.map((s) => <Badge key={s.id} variant="secondary">{s.name}</Badge>)}
            {stages.length === 0 && <span className="text-sm text-navy-400">No stages yet.</span>}
          </div>
          <div className="flex max-w-sm items-end gap-2">
            <div className="flex-1">
              <Label className="mb-1 block text-xs">Add stage / venue</Label>
              <Input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="Main Stage" />
            </div>
            <Button onClick={addStage}><Plus className="size-4" /> Add</Button>
          </div>
        </CardContent>
      </Card>

      {/* Item planner */}
      <Card className="print:hidden">
        <CardHeader><CardTitle className="text-base">Assign items to stage &amp; time</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>Min</TableHead>
                  <TableHead>Entrants</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">{it.name}<Badge variant="outline" className="ml-2 text-[10px]">{it.type}</Badge></TableCell>
                    <TableCell>
                      <Select value={it.stageId ?? NO_STAGE} onValueChange={(v) => patchItem(it.id, { stageId: v === NO_STAGE ? null : v })}>
                        <SelectTrigger className="w-36"><SelectValue placeholder="—">{(v: string) => (!v || v === NO_STAGE) ? "—" : (stages.find((s) => s.id === v)?.name ?? "—")}</SelectValue></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_STAGE}>—</SelectItem>
                          {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input type="datetime-local" className="w-52" value={toLocalInput(it.scheduledAt)}
                        onChange={(e) => patchItem(it.id, { scheduledAt: fromLocalInput(e.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" className="w-20" value={it.durationMin ?? ""} placeholder="30"
                        onChange={(e) => patchItem(it.id, { durationMin: e.target.value ? Number(e.target.value) : null })} />
                    </TableCell>
                    <TableCell>{(studentsByItem[it.id] ?? []).length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Printable programme grouped by stage */}
      <div className="hidden print:block">
        <h2 className="mb-4 text-xl font-bold">Programme</h2>
        {stages.map((s) => {
          const stageItems = items
            .filter((it) => it.stageId === s.id && it.scheduledAt)
            .sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1))
          if (!stageItems.length) return null
          return (
            <div key={s.id} className="mb-4">
              <h3 className="font-semibold">{s.name}</h3>
              <ul className="ml-4 list-disc">
                {stageItems.map((it) => (
                  <li key={it.id}>{new Date(it.scheduledAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — {it.name}</li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
