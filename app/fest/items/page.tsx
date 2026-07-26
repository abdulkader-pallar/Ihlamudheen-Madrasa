"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Plus, Pencil, Trash2, Sparkles, Copy, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { defaultRubric, seedDefaultCatalog } from "@/lib/fest/catalog"

interface EditionOpt { id: string; name: string }
interface CategoryOpt { id: string; name: string }
interface Item {
  id: string
  name: string
  name_ml: string | null
  language: "en" | "ml" | "ar" | "na"
  type: "individual" | "group"
  category_id: string | null
  max_per_section: number | null
  group_min: number | null
  group_max: number | null
  duration_minutes: number | null
  rules: string | null
}

const LANG_LABEL: Record<Item["language"], string> = {
  en: "English", ml: "Malayalam", ar: "Arabic", na: "—",
}
const NO_CATEGORY = "__none__"

type Draft = Partial<Item> & { name: string }

const emptyDraft: Draft = {
  name: "", name_ml: "", language: "na", type: "individual", category_id: null,
}

export default function FestItemsPage() {
  const [editions, setEditions] = useState<EditionOpt[]>([])
  const [editionId, setEditionId] = useState("")
  const [categories, setCategories] = useState<CategoryOpt[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [cloneSource, setCloneSource] = useState("")

  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  )

  useEffect(() => {
    supabase
      .from("fest_editions")
      .select("id,name")
      .neq("status", "archived")
      .order("year", { ascending: false })
      .then(({ data }) => {
        const opts = (data ?? []) as EditionOpt[]
        setEditions(opts)
        if (opts.length) setEditionId(opts[0].id)
      })
  }, [])

  const load = useCallback(async (eid: string) => {
    if (!eid) return
    setLoading(true)
    const [{ data: cats }, { data: its }] = await Promise.all([
      supabase.from("fest_categories").select("id,name").eq("edition_id", eid).order("sort_order"),
      supabase.from("fest_items").select("*").eq("edition_id", eid).order("name"),
    ])
    setCategories((cats ?? []) as CategoryOpt[])
    setItems((its ?? []) as Item[])
    setLoading(false)
  }, [])

  useEffect(() => { void load(editionId) }, [editionId, load])

  function openCreate() {
    setDraft({ ...emptyDraft })
    setEditorOpen(true)
  }
  function openEdit(it: Item) {
    setDraft({ ...it })
    setEditorOpen(true)
  }

  async function saveDraft() {
    if (!draft.name.trim()) { toast.error("Name is required"); return }
    setBusy(true)
    const payload = {
      edition_id: editionId,
      name: draft.name.trim(),
      name_ml: draft.name_ml?.trim() || null,
      language: draft.language ?? "na",
      type: draft.type ?? "individual",
      category_id: draft.category_id ?? null,
      max_per_section: draft.max_per_section ?? null,
      group_min: draft.type === "group" ? draft.group_min ?? 2 : null,
      group_max: draft.type === "group" ? draft.group_max ?? null : null,
      duration_minutes: draft.duration_minutes ?? null,
      rules: draft.rules?.trim() || null,
    }
    let error
    if (draft.id) {
      ;({ error } = await supabase.from("fest_items").update(payload).eq("id", draft.id))
    } else {
      // New items get a sensible default rubric for the Phase 4 score sheet.
      ;({ error } = await supabase
        .from("fest_items")
        .insert({ ...payload, rubric: defaultRubric(payload.name) }))
    }
    setBusy(false)
    if (error) { toast.error(error.message); return }
    toast.success(draft.id ? "Item updated" : "Item created")
    setEditorOpen(false)
    void load(editionId)
  }

  async function remove(it: Item) {
    if (!confirm(`Delete "${it.name}"? This removes its registrations too.`)) return
    const { error } = await supabase.from("fest_items").delete().eq("id", it.id)
    if (error) { toast.error(error.message); return }
    toast.success("Item deleted")
    void load(editionId)
  }

  async function seed() {
    setBusy(true)
    try {
      const { created } = await seedDefaultCatalog(supabase, editionId)
      toast.success(created ? `Added ${created} default items` : "Catalog already complete")
      void load(editionId)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function clone() {
    if (!cloneSource) return
    setBusy(true)
    const { data, error } = await supabase.rpc("fest_clone_edition", {
      p_source: cloneSource,
      p_target: editionId,
    })
    setBusy(false)
    if (error) { toast.error(error.message); return }
    const r = (data ?? {}) as { categories?: number; houses?: number; items?: number }
    toast.success(`Cloned ${r.items ?? 0} items, ${r.categories ?? 0} categories, ${r.houses ?? 0} houses`)
    setCloneOpen(false)
    void load(editionId)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/fest" className="text-navy-500 hover:text-navy-700 dark:text-navy-400">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-navy-800 dark:text-white">Item Catalog</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edition</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-64">
            <Label className="mb-1 block text-xs">Edition</Label>
            <Select value={editionId} onValueChange={(v) => setEditionId(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select edition">{(v: string) => editions.find((e) => e.id === v)?.name ?? "Select edition"}</SelectValue></SelectTrigger>
              <SelectContent>
                {editions.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={openCreate} disabled={!editionId}><Plus className="size-4" />New item</Button>
            <Button variant="outline" onClick={seed} disabled={!editionId || busy}>
              <Sparkles className="size-4" />Seed default catalog
            </Button>
            <Button
              variant="outline"
              onClick={() => { setCloneSource(""); setCloneOpen(true) }}
              disabled={!editionId || editions.length < 2}
            >
              <Copy className="size-4" />Clone from…
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items {items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-sm text-navy-500">Loading…</p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-navy-500">
              No items yet. Seed the default catalog or clone from a previous edition.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Language</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-medium">{it.name}</TableCell>
                      <TableCell>
                        <Badge variant={it.type === "group" ? "default" : "outline"}>{it.type}</Badge>
                      </TableCell>
                      <TableCell>{LANG_LABEL[it.language]}</TableCell>
                      <TableCell>{it.category_id ? categoryName.get(it.category_id) ?? "—" : "All"}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(it)}><Pencil className="size-4" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(it)}><Trash2 className="size-4 text-red-500" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / edit dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit item" : "New item"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="mb-1 block text-xs">Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Speech – English" />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1 block text-xs">Name (Malayalam)</Label>
              <Input value={draft.name_ml ?? ""} onChange={(e) => setDraft((d) => ({ ...d, name_ml: e.target.value }))} />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Type</Label>
              <Select value={draft.type ?? "individual"} onValueChange={(v) => setDraft((d) => ({ ...d, type: (v as Item["type"]) ?? "individual" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="group">Group</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block text-xs">Language</Label>
              <Select value={draft.language ?? "na"} onValueChange={(v) => setDraft((d) => ({ ...d, language: (v as Item["language"]) ?? "na" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="na">—</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ml">Malayalam</SelectItem>
                  <SelectItem value="ar">Arabic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1 block text-xs">Category</Label>
              <Select
                value={draft.category_id ?? NO_CATEGORY}
                onValueChange={(v) => setDraft((d) => ({ ...d, category_id: v === NO_CATEGORY ? null : v }))}
              >
                <SelectTrigger><SelectValue>{(v: string) => (!v || v === NO_CATEGORY) ? "All categories" : (categories.find((c) => c.id === v)?.name ?? "All categories")}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CATEGORY}>All categories</SelectItem>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {draft.type === "group" && (
              <>
                <div>
                  <Label className="mb-1 block text-xs">Group min</Label>
                  <Input type="number" min={1} value={draft.group_min ?? ""} onChange={(e) => setDraft((d) => ({ ...d, group_min: e.target.value ? +e.target.value : null }))} />
                </div>
                <div>
                  <Label className="mb-1 block text-xs">Group max</Label>
                  <Input type="number" min={1} value={draft.group_max ?? ""} onChange={(e) => setDraft((d) => ({ ...d, group_max: e.target.value ? +e.target.value : null }))} />
                </div>
              </>
            )}
            <div>
              <Label className="mb-1 block text-xs">Max per section</Label>
              <Input type="number" min={1} value={draft.max_per_section ?? ""} onChange={(e) => setDraft((d) => ({ ...d, max_per_section: e.target.value ? +e.target.value : null }))} />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Duration (min)</Label>
              <Input type="number" min={1} value={draft.duration_minutes ?? ""} onChange={(e) => setDraft((d) => ({ ...d, duration_minutes: e.target.value ? +e.target.value : null }))} />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1 block text-xs">Rules</Label>
              <Textarea rows={2} value={draft.rules ?? ""} onChange={(e) => setDraft((d) => ({ ...d, rules: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button onClick={saveDraft} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clone dialog */}
      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Clone catalog from another edition</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-navy-600 dark:text-navy-300">
            Copies categories, houses and items into the current edition. Students and
            registrations are not copied.
          </p>
          <Select value={cloneSource} onValueChange={(v) => setCloneSource(v ?? "")}>
            <SelectTrigger><SelectValue placeholder="Source edition">{(v: string) => editions.find((e) => e.id === v)?.name ?? "Source edition"}</SelectValue></SelectTrigger>
            <SelectContent>
              {editions.filter((e) => e.id !== editionId).map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloneOpen(false)}>Cancel</Button>
            <Button onClick={clone} disabled={!cloneSource || busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}Clone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
