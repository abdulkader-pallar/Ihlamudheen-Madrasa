"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Plus,
  Link2,
  FileText,
  HardDrive,
  ExternalLink,
  Trash2,
  ChevronLeft,
  Users,
  Loader2,
  Copy,
  Check,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import * as db from "@/lib/db"
import { toast } from "sonner"
import type { CourseData } from "@/data/courses"

type View =
  | { page: "classes" }
  | { page: "notes"; classId: string; className: string }

export default function LmsPage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const isAdmin = role === "admin"
  const isTeacher = role === "teacher"
  const canManage = isAdmin || isTeacher || role === "accountant"

  const teacherId = user?.id || ""
  const teacherName = user?.user_metadata?.full_name || user?.email || ""

  const [courses, setCourses] = useState<CourseData[]>([])
  const [loadingClasses, setLoadingClasses] = useState(true)
  const [view, setView] = useState<View>({ page: "classes" })

  const [notes, setNotes] = useState<db.LmsNote[]>([])
  const [loadingNotes, setLoadingNotes] = useState(false)

  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [linkUrl, setLinkUrl] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Load class list (with student counts)
  useEffect(() => {
    let cancelled = false
    async function load() {
      const ready = await db.checkSupabase()
      if (cancelled || !ready) { setLoadingClasses(false); return }
      const dbCourses = await db.fetchCoursesFromDB()
      if (cancelled) return
      setCourses(dbCourses)
      setLoadingClasses(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Flatten into a grade-sorted class list
  const allClasses = useMemo(() => {
    const list: Array<{ id: string; name: string; schedule: string; studentCount: number; course: string }> = []
    courses.forEach((c) => {
      c.classes.forEach((cls) => {
        list.push({ id: cls.id, name: cls.name, schedule: cls.schedule, studentCount: cls.students.length, course: c.title })
      })
    })
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return list
  }, [courses])

  const loadNotes = useCallback(async (classId: string) => {
    setLoadingNotes(true)
    const rows = await db.fetchLmsNotes(classId)
    setNotes(rows)
    setLoadingNotes(false)
  }, [])

  useEffect(() => {
    if (view.page === "notes") loadNotes(view.classId)
  }, [view, loadNotes])

  // Real-time updates for the selected class
  useEffect(() => {
    if (view.page !== "notes") return
    const sub = db.subscribeToTable(
      "lms_notes",
      () => loadNotes(view.classId),
      `class_id=eq.${view.classId}`
    )
    return () => sub.unsubscribe()
  }, [view, loadNotes])

  const handleAdd = async () => {
    if (view.page !== "notes") return
    if (!title.trim() || !linkUrl.trim()) { toast.error("Title and link are required"); return }
    let normalizedUrl = linkUrl.trim()
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = "https://" + normalizedUrl

    setSubmitting(true)
    const { error } = await db.addLmsNote({
      classId: view.classId,
      teacherId,
      teacherName,
      title: title.trim(),
      description: description.trim() || undefined,
      linkUrl: normalizedUrl,
    })
    setSubmitting(false)
    if (error) { toast.error("Failed to add note: " + error); return }
    toast.success("Note added")
    setTitle("")
    setDescription("")
    setLinkUrl("")
    setShowAdd(false)
  }

  const handleRemove = async (note: db.LmsNote) => {
    const canDelete = isAdmin || note.teacherId === teacherId
    if (!canDelete) { toast.error("You can only delete your own notes"); return }
    const ok = typeof window !== "undefined" ? window.confirm(`Delete "${note.title}"?`) : false
    if (!ok) return
    const { error } = await db.removeLmsNote(note.id)
    if (error) { toast.error("Failed to delete: " + error); return }
    toast.success("Note removed")
  }

  const copyShareLink = async (classId: string) => {
    const url = `${window.location.origin}/lms/${classId}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(classId)
      toast.success("Student link copied")
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      toast.error("Couldn't copy — link: " + url)
    }
  }

  const linkIcon = (type: db.LmsLinkType) => {
    if (type === "youtube") return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/logo-icon.png"
        alt="Ihlamudheen Book"
        className="size-full object-cover rounded-md"
      />
    )
    if (type === "drive") return <HardDrive className="size-4 text-emerald-500" />
    if (type === "doc") return <FileText className="size-4 text-blue-500" />
    return <Link2 className="size-4 text-navy-500" />
  }

  // ═══════ CLASS LIST VIEW ═══════
  if (view.page === "classes") {
    return (
      <div className="space-y-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.png" alt="" className="size-8 rounded-md object-contain shadow-sm" />
            LMS — Class Notes
          </h1>
          <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
            Share notes and study materials with your students by posting links (Google Drive, YouTube, Docs, etc.).
          </p>
        </div>

        {loadingClasses ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-6 animate-spin text-rose-500" />
          </div>
        ) : allClasses.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-16 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-icon.png" alt="" className="size-16 rounded-lg object-contain mb-3 opacity-80" />
              <p className="text-navy-500 dark:text-navy-400">No classes yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {allClasses.map((cls, i) => (
              <motion.div key={cls.id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <Card className="transition-shadow hover:shadow-md cursor-pointer" onClick={() => setView({ page: "notes", classId: cls.id, className: cls.name })}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-navy-900 dark:text-white truncate">{cls.name}</h3>
                        <p className="text-xs text-navy-500 dark:text-navy-400 mt-0.5 truncate">{cls.schedule}</p>
                        <p className="text-xs text-navy-400 mt-1 flex items-center gap-1">
                          <Users className="size-3" /> {cls.studentCount} students
                        </p>
                      </div>
                      {canManage && (
                        <button
                          onClick={(e) => { e.stopPropagation(); copyShareLink(cls.id) }}
                          className="flex size-8 items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors shrink-0"
                          title="Copy student link"
                        >
                          {copiedId === cls.id ? <Check className="size-4" /> : <Copy className="size-4" />}
                        </button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ═══════ NOTES VIEW (for a specific class) ═══════
  const classNotes = notes
  const myNotesCount = classNotes.filter((n) => n.teacherId === teacherId).length

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView({ page: "classes" })}
            className="flex size-8 items-center justify-center rounded-lg hover:bg-navy-100 dark:hover:bg-navy-800 transition-colors"
          >
            <ChevronLeft className="size-5 text-navy-500" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-navy-900 dark:text-white">{view.className}</h1>
            <p className="text-sm text-navy-500 dark:text-navy-400">
              {classNotes.length} note{classNotes.length === 1 ? "" : "s"}
              {canManage && myNotesCount > 0 && ` · ${myNotesCount} by you`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Button variant="outline" onClick={() => copyShareLink(view.classId)}>
              {copiedId === view.classId ? <Check className="size-4 mr-1 text-emerald-500" /> : <Copy className="size-4 mr-1" />}
              Share with students
            </Button>
          )}
          {canManage && (
            <Button className="bg-rose-500 text-white hover:bg-rose-400" onClick={() => setShowAdd((v) => !v)}>
              <Plus className="size-4 mr-1" /> {showAdd ? "Cancel" : "Add Note"}
            </Button>
          )}
        </div>
      </div>

      {/* Add note form */}
      <AnimatePresence>
        {canManage && showAdd && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <Card className="border-rose-400/40">
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold text-navy-900 dark:text-white">Add a note</h3>
                <Input
                  placeholder="Title (e.g., Chapter 3 — Tajweed Rules)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <Input
                  placeholder="Paste Google Drive, YouTube, Docs, or any URL"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                />
                <Input
                  placeholder="Description (optional)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button onClick={handleAdd} disabled={submitting || !title.trim() || !linkUrl.trim()} className="bg-rose-500 text-white hover:bg-rose-400">
                    {submitting ? <Loader2 className="size-4 animate-spin mr-1" /> : <Plus className="size-4 mr-1" />}
                    Add Note
                  </Button>
                  <Button variant="outline" onClick={() => { setShowAdd(false); setTitle(""); setDescription(""); setLinkUrl("") }}>
                    Cancel
                  </Button>
                </div>
                <p className="text-[11px] text-navy-400 dark:text-navy-500">
                  Tip — upload files to Google Drive or Classroom, then paste the shareable link here. No file storage used.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notes list */}
      {loadingNotes ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-rose-500" />
        </div>
      ) : classNotes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Link2 className="size-12 text-navy-300 dark:text-navy-600 mb-3" />
            <p className="text-navy-500 dark:text-navy-400">No notes yet for this class.</p>
            {canManage && <p className="text-xs text-navy-400 dark:text-navy-500 mt-1">Click &quot;Add Note&quot; above to share your first link.</p>}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {classNotes.map((n, i) => {
            const canDelete = canManage && (isAdmin || n.teacherId === teacherId)
            return (
              <motion.div key={n.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className={cn(
                      "rounded-lg p-2 shrink-0 overflow-hidden flex items-center justify-center size-10",
                      n.linkType === "youtube" && "bg-rose-50 dark:bg-rose-900/20",
                      n.linkType === "drive" && "bg-emerald-50 dark:bg-emerald-900/20",
                      n.linkType === "doc" && "bg-blue-50 dark:bg-blue-900/20",
                      n.linkType === "other" && "bg-navy-50 dark:bg-navy-800",
                    )}>
                      {linkIcon(n.linkType)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <a
                        href={n.linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-navy-900 dark:text-white hover:text-rose-500 dark:hover:text-rose-400 transition-colors inline-flex items-center gap-1.5"
                      >
                        {n.title}
                        <ExternalLink className="size-3.5" />
                      </a>
                      {n.description && (
                        <p className="text-sm text-navy-600 dark:text-navy-300 mt-1">{n.description}</p>
                      )}
                      <p className="text-xs text-navy-400 dark:text-navy-500 mt-1.5 truncate">
                        by {n.teacherName} · {new Date(n.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    {canDelete && (
                      <button
                        onClick={() => handleRemove(n)}
                        className="flex size-8 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
                        title="Delete note"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
