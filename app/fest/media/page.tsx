"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, ImagePlus, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

interface EditionOpt { id: string; name: string }
interface MediaItem { id: string; storagePath: string; caption: string | null; category: string | null; url: string }

const BUCKET = "fest-media"

export default function FestMediaPage() {
  const [editions, setEditions] = useState<EditionOpt[]>([])
  const [editionId, setEditionId] = useState("")
  const [category, setCategory] = useState("")
  const [media, setMedia] = useState<MediaItem[]>([])
  const [busy, setBusy] = useState(false)

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
    const { data } = await supabase.from("fest_media")
      .select("id,storage_path,caption,category").eq("edition_id", eid).order("created_at", { ascending: false })
    setMedia(((data ?? []) as Array<{ id: string; storage_path: string; caption: string | null; category: string | null }>)
      .map((m) => ({
        id: m.id, storagePath: m.storage_path, caption: m.caption, category: m.category,
        url: supabase.storage.from(BUCKET).getPublicUrl(m.storage_path).data.publicUrl,
      })))
  }, [])
  useEffect(() => { void load(editionId) }, [editionId, load])

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length || !editionId) return
    setBusy(true)
    try {
      for (const file of files) {
        const path = `${editionId}/${category || "general"}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "_")}`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false })
        if (upErr) throw new Error(upErr.message)
        const { error: insErr } = await supabase.from("fest_media").insert({
          edition_id: editionId, storage_path: path, category: category || null, type: "photo",
        })
        if (insErr) throw new Error(insErr.message)
      }
      toast.success(`Uploaded ${files.length} file(s)`)
      void load(editionId)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
      e.target.value = ""
    }
  }

  async function remove(m: MediaItem) {
    await supabase.storage.from(BUCKET).remove([m.storagePath])
    await supabase.from("fest_media").delete().eq("id", m.id)
    void load(editionId)
  }

  // Group by category for the year→event→category browse.
  const byCat = new Map<string, MediaItem[]>()
  for (const m of media) {
    const k = m.category || "General"
    const list = byCat.get(k) ?? []
    list.push(m); byCat.set(k, list)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/fest" className="text-navy-500 hover:text-navy-700 dark:text-navy-400"><ArrowLeft className="size-5" /></Link>
        <h1 className="text-2xl font-bold tracking-tight text-navy-800 dark:text-white">Ihlamudheen Madrasa Memories</h1>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="w-full sm:w-48">
            <Label className="mb-1 block text-xs">Edition</Label>
            <Select value={editionId} onValueChange={(v) => setEditionId(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Edition">{(v: string) => editions.find((e) => e.id === v)?.name ?? "Edition"}</SelectValue></SelectTrigger>
              <SelectContent>{editions.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-48">
            <Label className="mb-1 block text-xs">Category / event tag</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Stage, Duff" />
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-navy-800 px-3 py-2 text-sm font-medium text-white hover:bg-navy-700">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} Upload photos
            <input type="file" accept="image/*" multiple className="hidden" onChange={onUpload} disabled={busy} />
          </label>
        </CardContent>
      </Card>

      {media.length === 0 && <p className="text-sm text-navy-500">No media yet for this edition.</p>}

      {Array.from(byCat.entries()).map(([cat, list]) => (
        <div key={cat}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-navy-500">{cat}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {list.map((m) => (
              <div key={m.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- user gallery upload from storage */}
                <img src={m.url} alt={m.caption ?? "Ihlamudheen Madrasa memory"} className="size-full object-cover" />
                <button onClick={() => remove(m)}
                  className="absolute right-1 top-1 hidden rounded-md bg-black/60 p-1 text-white group-hover:block">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
