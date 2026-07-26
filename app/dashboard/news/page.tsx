"use client"

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { Newspaper, Plus, Trash2, Loader2, ExternalLink, Link2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { toast } from "sonner"

interface NewsItem {
  id: string
  title: string
  body: string
  linkUrl?: string
  authorId: string
  authorName: string
  createdAt: number
}

const STORAGE_KEY = "madrasa-news"

function loadStored(): NewsItem[] {
  if (typeof window === "undefined") return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")
  } catch {
    return []
  }
}

function saveStored(items: NewsItem[]) {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export default function NewsPage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const canPost = role === "admin" || role === "accountant" || role === "teacher"

  const [items, setItems] = useState<NewsItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [linkUrl, setLinkUrl] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setItems(loadStored())
    setLoading(false)
  }, [])

  const reset = useCallback(() => {
    setTitle("")
    setBody("")
    setLinkUrl("")
    setShowForm(false)
  }, [])

  const handlePost = () => {
    if (!title.trim() || !body.trim()) {
      toast.error("Title and content required")
      return
    }
    const normalized = linkUrl.trim()
      ? /^https?:\/\//i.test(linkUrl.trim())
        ? linkUrl.trim()
        : `https://${linkUrl.trim()}`
      : undefined
    const newItem: NewsItem = {
      id: `${Date.now()}`,
      title: title.trim(),
      body: body.trim(),
      linkUrl: normalized,
      authorId: user?.id || "",
      authorName: user?.user_metadata?.full_name || user?.email || "Staff",
      createdAt: Date.now(),
    }
    const next = [newItem, ...items]
    setItems(next)
    saveStored(next)
    toast.success("Published")
    reset()
  }

  const handleDelete = (id: string) => {
    const target = items.find((i) => i.id === id)
    if (!target) return
    const isAdmin = role === "admin"
    const isAuthor = target.authorId === user?.id
    if (!isAdmin && !isAuthor) {
      toast.error("Only the author or an admin can delete")
      return
    }
    if (!window.confirm("Delete this news item?")) return
    const next = items.filter((i) => i.id !== id)
    setItems(next)
    saveStored(next)
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
            <Newspaper className="size-7 text-pink-500" /> News &amp; Circulars
          </h1>
          <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
            Campus announcements and circulars. {items.length} {items.length === 1 ? "post" : "posts"}.
          </p>
        </div>
        {canPost && !showForm && (
          <Button
            onClick={() => setShowForm(true)}
            className="bg-pink-500 hover:bg-pink-600 text-white shrink-0"
          >
            <Plus className="size-4 mr-1" /> Post
          </Button>
        )}
      </motion.div>

      {showForm && canPost && (
        <Card className="border-pink-300">
          <CardContent className="p-4 space-y-3">
            <Input
              placeholder="Headline"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              placeholder="Content"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-border/60 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
            />
            <Input
              placeholder="Attach link (optional)"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={handlePost} className="bg-pink-500 hover:bg-pink-600 text-white">
                Publish
              </Button>
              <Button variant="outline" onClick={reset}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-pink-500" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-navy-400">
            <Newspaper className="size-10 mx-auto mb-2 text-navy-300" />
            No news yet. {canPost && "Post the first circular!"}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((n) => {
            const isAdmin = role === "admin"
            const isAuthor = n.authorId === user?.id
            return (
              <Card key={n.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-lg font-bold text-navy-900 dark:text-white">{n.title}</h3>
                    {(isAdmin || isAuthor) && (
                      <button
                        onClick={() => handleDelete(n.id)}
                        className="p-1.5 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-navy-600 dark:text-navy-300 mt-2 whitespace-pre-wrap">
                    {n.body}
                  </p>
                  {n.linkUrl && (
                    <a
                      href={n.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-3 text-sm text-pink-600 hover:underline"
                    >
                      <Link2 className="size-3.5" /> Attached link
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                  <p className="text-[11px] text-navy-400 mt-3">
                    {n.authorName} — {new Date(n.createdAt).toLocaleString("en-GB")}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <p className="text-[11px] text-navy-400 text-center">
        Posts are currently stored locally in your browser. Ask to wire this up to Supabase for multi-user sharing.
      </p>
    </div>
  )
}
