"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  FileText,
  HardDrive,
  Link2,
  ExternalLink,
  Loader2,
  BookOpen,
} from "lucide-react"
import * as db from "@/lib/db"

type Note = db.LmsNote

type LinkIconInfo = {
  Icon?: React.ComponentType<{ className?: string }>
  image?: string
  color: string
  bg: string
}

const linkIcon = (t: db.LmsLinkType): LinkIconInfo => {
  if (t === "youtube") return { image: "/logo-icon.png", color: "", bg: "bg-slate-100 dark:bg-slate-700/40" }
  if (t === "drive") return { Icon: HardDrive, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-500/10" }
  if (t === "doc") return { Icon: FileText, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-500/10" }
  return { Icon: Link2, color: "text-slate-600", bg: "bg-slate-100 dark:bg-slate-700/40" }
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    })
  } catch { return iso }
}

export default function PublicLmsClassPage() {
  const params = useParams<{ classId: string }>()
  const classId = params?.classId || ""

  const [notes, setNotes] = useState<Note[]>([])
  const [className, setClassName] = useState<string>("")
  const [loading, setLoading] = useState(true)

  const loadNotes = useCallback(async () => {
    if (!classId) return
    const rows = await db.fetchLmsNotes(classId)
    setNotes(rows)
    setLoading(false)
  }, [classId])

  const loadClassName = useCallback(async () => {
    if (!classId) return
    const courses = await db.fetchCoursesFromDB()
    for (const course of courses) {
      const match = course.classes.find((c) => c.id === classId)
      if (match) {
        setClassName(`${course.title} — ${match.name}`)
        return
      }
    }
    setClassName(classId)
  }, [classId])

  useEffect(() => {
    loadNotes()
    loadClassName()
  }, [loadNotes, loadClassName])

  useEffect(() => {
    if (!classId) return
    const sub = db.subscribeToTable("lms_notes", loadNotes, `class_id=eq.${classId}`)
    return () => sub.unsubscribe()
  }, [classId, loadNotes])

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-amber-50 dark:from-navy-900 dark:via-navy-800 dark:to-navy-900">
      {/* Header */}
      <header className="border-b border-rose-200/60 bg-white/80 backdrop-blur-sm dark:bg-navy-800/80 dark:border-navy-700">
        <div className="mx-auto max-w-3xl px-4 py-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl overflow-hidden shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.png" alt="Ihlamudheen" className="size-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-500">Class Notes</p>
            <h1 className="text-base font-bold text-navy-800 dark:text-white truncate">
              {className || "Loading…"}
            </h1>
          </div>
          <Link
            href="/login"
            className="text-xs font-medium text-navy-500 hover:text-navy-700 dark:text-navy-300 dark:hover:text-white"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-rose-500" />
          </div>
        ) : notes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-rose-300/60 bg-white/70 p-10 text-center dark:bg-navy-800/60 dark:border-navy-700">
            <BookOpen className="size-10 mx-auto text-rose-300 mb-3" />
            <h2 className="text-lg font-semibold text-navy-700 dark:text-white">No notes yet</h2>
            <p className="text-sm text-navy-500 dark:text-navy-400 mt-1">
              Your teacher hasn&apos;t added any notes for this class. Check back later.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {notes.map((n) => {
              const { Icon, image, color, bg } = linkIcon(n.linkType)
              return (
                <li
                  key={n.id}
                  className="rounded-2xl border border-border/60 bg-white shadow-sm dark:bg-navy-800 dark:border-navy-700"
                >
                  <a
                    href={n.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-4 hover:bg-rose-50/40 dark:hover:bg-navy-700/40 transition-colors"
                  >
                    <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl overflow-hidden ${bg}`}>
                      {image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={image}
                          alt="Ihlamudheen Book"
                          className="size-full object-cover"
                        />
                      ) : Icon ? (
                        <Icon className={`size-5 ${color}`} />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-navy-800 dark:text-white break-words">
                        {n.title}
                      </h3>
                      {n.description && (
                        <p className="text-xs text-navy-600 dark:text-navy-300 mt-1 break-words">
                          {n.description}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-navy-400 dark:text-navy-500">
                        <span className="truncate">By {n.teacherName}</span>
                        <span aria-hidden>•</span>
                        <span>{formatDate(n.createdAt)}</span>
                      </div>
                    </div>
                    <ExternalLink className="size-4 shrink-0 text-navy-400 mt-1" />
                  </a>
                </li>
              )
            })}
          </ul>
        )}

        <p className="mt-8 text-center text-[11px] text-navy-400 dark:text-navy-500">
          Ihlamudheen Madrasa — Learning Management
        </p>
      </main>
    </div>
  )
}
