"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Camera, Plus, Trash2, ExternalLink, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { toast } from "sonner"

interface AlbumLink {
  id: string
  title: string
  url: string
  authorId: string
  authorName: string
  createdAt: number
}

const KEY = "madrasa-album"
const load = (): AlbumLink[] => {
  if (typeof window === "undefined") return []
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") } catch { return [] }
}
const save = (v: AlbumLink[]) => {
  if (typeof window === "undefined") return
  localStorage.setItem(KEY, JSON.stringify(v))
}

export default function AlbumPage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const canAdd = role === "admin" || role === "accountant" || role === "teacher"

  const [items, setItems] = useState<AlbumLink[]>([])
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    setItems(load())
    setLoading(false)
  }, [])

  const handleAdd = () => {
    if (!title.trim() || !url.trim()) {
      toast.error("Title and link required")
      return
    }
    const normalized = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`
    const item: AlbumLink = {
      id: `${Date.now()}`,
      title: title.trim(),
      url: normalized,
      authorId: user?.id || "",
      authorName: user?.user_metadata?.full_name || user?.email || "Staff",
      createdAt: Date.now(),
    }
    const next = [item, ...items]
    setItems(next)
    save(next)
    setTitle("")
    setUrl("")
    setShowForm(false)
    toast.success("Added")
  }

  const handleDelete = (id: string) => {
    const target = items.find((i) => i.id === id)
    if (!target) return
    const isAdmin = role === "admin"
    if (!isAdmin && target.authorId !== user?.id) {
      toast.error("Only the author or admin can delete")
      return
    }
    if (!window.confirm("Remove this album?")) return
    const next = items.filter((i) => i.id !== id)
    setItems(next)
    save(next)
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <motion.div className="flex items-start justify-between gap-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
            <Camera className="size-7 text-fuchsia-500" /> School Album
          </h1>
          <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
            Share Google Drive / Photos folder links for school events and activities. No uploads.
          </p>
        </div>
        {canAdd && !showForm && (
          <Button onClick={() => setShowForm(true)} className="bg-fuchsia-500 hover:bg-fuchsia-600 text-white shrink-0">
            <Plus className="size-4 mr-1" /> Add
          </Button>
        )}
      </motion.div>

      {showForm && canAdd && (
        <Card className="border-fuchsia-300">
          <CardContent className="p-4 space-y-3">
            <Input placeholder="Event title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input placeholder="Google Drive / Photos URL" value={url} onChange={(e) => setUrl(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={handleAdd} className="bg-fuchsia-500 hover:bg-fuchsia-600 text-white">Add</Button>
              <Button variant="outline" onClick={() => { setShowForm(false); setTitle(""); setUrl("") }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-fuchsia-500" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-navy-400">
            <Camera className="size-10 mx-auto mb-2 text-navy-300" />
            No albums yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((a) => {
            const isAdmin = role === "admin"
            const canDel = isAdmin || a.authorId === user?.id
            return (
              <Card key={a.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-navy-900 dark:text-white">{a.title}</h3>
                    {canDel && (
                      <button onClick={() => handleDelete(a.id)} className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md">
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-3 text-sm text-fuchsia-600 hover:underline">
                    Open album <ExternalLink className="size-3.5" />
                  </a>
                  <p className="text-[11px] text-navy-400 mt-2">
                    {a.authorName} — {new Date(a.createdAt).toLocaleDateString("en-GB")}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
      <p className="text-[11px] text-navy-400 text-center">Stored locally per browser for now.</p>
    </div>
  )
}
