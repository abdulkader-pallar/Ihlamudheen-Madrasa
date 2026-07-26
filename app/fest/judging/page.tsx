"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Lock, Unlock, CloudOff, Calculator, Save } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  criteriaTotal, gradeForMark, type RubricCriterion, type GradeThresholds, DEFAULT_THRESHOLDS,
} from "@/lib/fest/scoring"

interface EditionOpt { id: string; name: string }
interface JItem { id: string; name: string; type: "individual" | "group"; rubric: RubricCriterion[]; lockedAt: string | null }
interface Entry { registrationId: string; codeNo: string | null; regNo: string | null; name: string | null; isGroup: boolean }
interface ScoreState { criteria: Record<string, number>; remarks: string; submitted: boolean; dirty: boolean }

const PENDING_KEY = "fest_pending_scores_v1"

interface PendingRow {
  edition_id: string; item_id: string; registration_id: string; judge_id: string
  criteria: Record<string, number>; total: number; remarks: string; submitted: boolean
}

function loadPending(): PendingRow[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") } catch { return [] }
}
function savePending(rows: PendingRow[]) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(rows)) } catch { /* ignore quota */ }
}

export default function FestJudgingPage() {
  const { user, loading: authLoading } = useAuth(true)
  const judgeId = user?.id ?? ""
  const isStaff = user ? ["admin", "accountant", "teacher", "coordinator"].includes(getUserRole(user)) : false
  const isAdmin = user ? getUserRole(user) === "admin" : false

  const [editions, setEditions] = useState<EditionOpt[]>([])
  const [editionId, setEditionId] = useState("")
  const [thresholds, setThresholds] = useState<GradeThresholds>(DEFAULT_THRESHOLDS)
  const [items, setItems] = useState<JItem[]>([])
  const [itemId, setItemId] = useState("")
  const [entries, setEntries] = useState<Entry[]>([])
  const [scores, setScores] = useState<Record<string, ScoreState>>({})
  const [pendingCount, setPendingCount] = useState(0)

  const item = useMemo(() => items.find((i) => i.id === itemId) ?? null, [items, itemId])
  const locked = !!item?.lockedAt

  useEffect(() => { setPendingCount(loadPending().length) }, [])

  useEffect(() => {
    supabase.from("fest_editions").select("id,name,config").neq("status", "archived")
      .order("year", { ascending: false })
      .then(({ data }) => {
        const opts = (data ?? []) as Array<{ id: string; name: string; config: { grade_thresholds?: GradeThresholds } }>
        setEditions(opts.map((e) => ({ id: e.id, name: e.name })))
        if (opts.length) {
          setEditionId(opts[0].id)
          setThresholds(opts[0].config?.grade_thresholds ?? DEFAULT_THRESHOLDS)
        }
      })
  }, [])

  // Items the current user may judge: staff see all; judges see their assignments.
  const loadItems = useCallback(async (eid: string) => {
    if (!eid) return
    if (isStaff) {
      const { data } = await supabase.from("fest_items")
        .select("id,name,type,rubric,locked_at").eq("edition_id", eid).order("name")
      setItems(((data ?? []) as Array<Record<string, unknown>>).map(mapItem))
    } else {
      const { data: asg } = await supabase.from("fest_item_judges").select("item_id").eq("judge_id", judgeId)
      const ids = (asg ?? []).map((r) => (r as { item_id: string }).item_id)
      if (ids.length === 0) { setItems([]); return }
      const { data } = await supabase.from("fest_items")
        .select("id,name,type,rubric,locked_at").eq("edition_id", eid).in("id", ids).order("name")
      setItems(((data ?? []) as Array<Record<string, unknown>>).map(mapItem))
    }
  }, [isStaff, judgeId])

  useEffect(() => { if (editionId) void loadItems(editionId) }, [editionId, loadItems])

  const loadSheet = useCallback(async (theItem: JItem) => {
    const { data: ent, error } = await supabase.rpc("fest_judge_sheet", { p_item_id: theItem.id })
    if (error) { toast.error(error.message); return }
    const es = ((ent ?? []) as Array<{ registration_id: string; code_no: string | null; reg_no: string | null; student_name: string | null; is_group: boolean }>)
      .map((e) => ({ registrationId: e.registration_id, codeNo: e.code_no, regNo: e.reg_no, name: e.student_name, isGroup: e.is_group }))
    setEntries(es)

    const { data: mine } = await supabase.from("fest_scores")
      .select("registration_id,criteria,remarks,submitted").eq("item_id", theItem.id).eq("judge_id", judgeId)
    const byReg = new Map((mine ?? []).map((r) => {
      const row = r as { registration_id: string; criteria: Record<string, number>; remarks: string | null; submitted: boolean }
      return [row.registration_id, row]
    }))

    // Overlay any locally-pending (unsynced) edits.
    const pending = loadPending().filter((p) => p.item_id === theItem.id && p.judge_id === judgeId)
    const pendByReg = new Map(pending.map((p) => [p.registration_id, p]))

    const next: Record<string, ScoreState> = {}
    for (const e of es) {
      const p = pendByReg.get(e.registrationId)
      const server = byReg.get(e.registrationId)
      next[e.registrationId] = {
        criteria: p?.criteria ?? server?.criteria ?? {},
        remarks: p?.remarks ?? server?.remarks ?? "",
        submitted: p?.submitted ?? server?.submitted ?? false,
        dirty: !!p,
      }
    }
    setScores(next)
  }, [judgeId])

  useEffect(() => { if (item) void loadSheet(item) }, [item, loadSheet])

  function setMark(reg: string, key: string, val: number) {
    setScores((prev) => ({
      ...prev,
      [reg]: { ...prev[reg], criteria: { ...prev[reg].criteria, [key]: val }, dirty: true },
    }))
  }
  function setRemarks(reg: string, val: string) {
    setScores((prev) => ({ ...prev, [reg]: { ...prev[reg], remarks: val, dirty: true } }))
  }

  async function persist(reg: string, submit: boolean) {
    if (!item) return
    const s = scores[reg]
    const total = criteriaTotal(s.criteria, item.rubric)
    const row: PendingRow = {
      edition_id: editionId, item_id: item.id, registration_id: reg, judge_id: judgeId,
      criteria: s.criteria, total, remarks: s.remarks, submitted: submit || s.submitted,
    }
    const { error } = await supabase.from("fest_scores")
      .upsert(row, { onConflict: "item_id,registration_id,judge_id" })
    if (error) {
      // Offline / rejected — stash locally and let the judge keep going.
      const pend = loadPending().filter((p) => !(p.item_id === row.item_id && p.registration_id === row.registration_id && p.judge_id === row.judge_id))
      pend.push(row)
      savePending(pend)
      setPendingCount(pend.length)
      setScores((prev) => ({ ...prev, [reg]: { ...prev[reg], submitted: row.submitted, dirty: true } }))
      toast.warning("Saved offline — will sync later")
      return
    }
    setScores((prev) => ({ ...prev, [reg]: { ...prev[reg], submitted: row.submitted, dirty: false } }))
  }

  async function syncPending() {
    const pend = loadPending()
    if (pend.length === 0) { toast.info("Nothing to sync"); return }
    const remaining: PendingRow[] = []
    for (const row of pend) {
      const { error } = await supabase.from("fest_scores")
        .upsert(row, { onConflict: "item_id,registration_id,judge_id" })
      if (error) remaining.push(row)
    }
    savePending(remaining)
    setPendingCount(remaining.length)
    toast[remaining.length ? "warning" : "success"](
      remaining.length ? `${remaining.length} still pending` : "All scores synced",
    )
    if (item) void loadSheet(item)
  }

  async function submitAll() {
    for (const e of entries) await persist(e.registrationId, true)
    const { data } = await supabase.rpc("fest_lock_if_complete", { p_item_id: item!.id })
    if (data === true) { toast.success("All judges done — item locked"); void loadItems(editionId) }
    else toast.success("Your scores submitted")
  }

  async function unlock() {
    const { error } = await supabase.rpc("fest_unlock_item", { p_item_id: item!.id })
    if (error) return toast.error(error.message)
    toast.success("Unlocked"); void loadItems(editionId)
  }

  async function recompute() {
    const { error } = await supabase.rpc("fest_recompute_results", { p_edition_id: editionId })
    if (error) return toast.error(error.message)
    toast.success("Results recomputed")
  }

  if (authLoading) return <p className="py-10 text-center text-sm text-navy-500">Loading…</p>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/fest" className="text-navy-500 hover:text-navy-700 dark:text-navy-400"><ArrowLeft className="size-5" /></Link>
        <h1 className="text-2xl font-bold tracking-tight text-navy-800 dark:text-white">Judging</h1>
        <div className="ml-auto flex items-center gap-2">
          {pendingCount > 0 && (
            <Button variant="outline" size="sm" onClick={syncPending}>
              <CloudOff className="size-4 text-amber-500" /> Sync {pendingCount}
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={recompute}>
              <Calculator className="size-4" /> Recompute results
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="w-full sm:w-52">
            <label className="mb-1 block text-xs font-medium text-navy-600 dark:text-navy-300">Edition</label>
            <Select value={editionId} onValueChange={(v) => setEditionId(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Edition">{(v: string) => editions.find((e) => e.id === v)?.name ?? "Edition"}</SelectValue></SelectTrigger>
              <SelectContent>{editions.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-64">
            <label className="mb-1 block text-xs font-medium text-navy-600 dark:text-navy-300">Item</label>
            <Select value={itemId} onValueChange={(v) => setItemId(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select item to judge">{(v: string) => items.find((i) => i.id === v)?.name ?? "Select item to judge"}</SelectValue></SelectTrigger>
              <SelectContent>
                {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}{i.lockedAt ? " 🔒" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {items.length === 0 && <p className="text-sm text-navy-500">No items assigned to you in this edition.</p>}
        </CardContent>
      </Card>

      {item && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              {item.name}
              <Badge variant="outline" className="text-[10px]">{item.type}</Badge>
              {locked && <Badge variant="secondary" className="gap-1"><Lock className="size-3" /> Locked</Badge>}
            </CardTitle>
            <div className="flex gap-2">
              {locked && isAdmin && <Button variant="outline" size="sm" onClick={unlock}><Unlock className="size-4" /> Unlock</Button>}
              {!locked && <Button size="sm" onClick={submitAll}><Save className="size-4" /> Submit all</Button>}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-navy-500">
              Scoring by <strong>code number</strong> (names hidden). Marks total to 100; grade preview uses
              A≥{thresholds.A} · B≥{thresholds.B} · C≥{thresholds.C}.
            </p>
            {entries.length === 0 && <p className="py-6 text-center text-sm text-navy-500">No entries.</p>}
            {entries.map((e) => {
              const s = scores[e.registrationId]
              if (!s) return null
              const total = criteriaTotal(s.criteria, item.rubric)
              const grade = gradeForMark(total, thresholds)
              return (
                <div key={e.registrationId} className="rounded-lg border border-border/60 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <span className="font-mono text-sm font-semibold">{e.regNo ?? e.codeNo ?? "—"}</span>
                      {e.name && <span className="ml-2 text-sm font-medium text-navy-700 dark:text-navy-200">{e.name.trim()}</span>}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline">{total} / 100</Badge>
                      <Badge variant={grade === "-" ? "outline" : "secondary"}>Grade {grade}</Badge>
                      {s.submitted && <Badge className="bg-emerald-500">Submitted</Badge>}
                      {s.dirty && <Badge variant="outline" className="text-amber-600">Unsaved</Badge>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {(item.rubric.length ? item.rubric : [{ key: "mark", label: "Mark", max: 100 }]).map((c) => (
                      <label key={c.key} className="text-xs">
                        <span className="mb-1 block text-navy-500">{c.label} <span className="text-navy-400">/{c.max}</span></span>
                        <Input type="number" min={0} max={c.max} disabled={locked}
                          value={s.criteria[c.key] ?? ""}
                          onChange={(ev) => setMark(e.registrationId, c.key, ev.target.value ? Number(ev.target.value) : 0)} />
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <Input className="flex-1" placeholder="Remarks (optional)" disabled={locked}
                      value={s.remarks} onChange={(ev) => setRemarks(e.registrationId, ev.target.value)} />
                    {!locked && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => persist(e.registrationId, false)}>Save</Button>
                        <Button size="sm" onClick={() => persist(e.registrationId, true)}>Submit</Button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function mapItem(r: Record<string, unknown>): JItem {
  return {
    id: r.id as string,
    name: r.name as string,
    type: r.type as "individual" | "group",
    rubric: (r.rubric as RubricCriterion[]) ?? [],
    lockedAt: (r.locked_at as string | null) ?? null,
  }
}
