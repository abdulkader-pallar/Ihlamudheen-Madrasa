"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Scale, Plus, Trash2, Loader2, AlertCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { initialCourses } from "@/data/courses"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface Incident {
  id: string
  studentId: string
  studentName: string
  classId: string
  className: string
  severity: "minor" | "moderate" | "serious"
  note: string
  authorId: string
  authorName: string
  createdAt: number
}

const KEY = "madrasa-discipline"
const load = (): Incident[] => {
  if (typeof window === "undefined") return []
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") } catch { return [] }
}
const save = (v: Incident[]) => {
  if (typeof window === "undefined") return
  localStorage.setItem(KEY, JSON.stringify(v))
}

export default function DisciplinePage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const canLog = role === "admin" || role === "accountant" || role === "teacher"
  const [items, setItems] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [classId, setClassId] = useState("")
  const [studentId, setStudentId] = useState("")
  const [severity, setSeverity] = useState<Incident["severity"]>("minor")
  const [note, setNote] = useState("")

  useEffect(() => {
    setItems(load())
    setLoading(false)
  }, [])

  const allClasses = initialCourses.flatMap((c) =>
    c.classes.map((cls) => ({ id: cls.id, name: cls.name, students: cls.students })),
  )
  const selectedClass = allClasses.find((c) => c.id === classId)

  const handleSave = () => {
    if (!classId || !studentId || !note.trim()) {
      toast.error("Pick a class + student and enter a note")
      return
    }
    const cls = allClasses.find((c) => c.id === classId)
    const stu = cls?.students.find((s) => s.id === studentId)
    if (!cls || !stu) return
    const incident: Incident = {
      id: `${Date.now()}`,
      studentId: stu.id,
      studentName: stu.name,
      classId: cls.id,
      className: cls.name,
      severity,
      note: note.trim(),
      authorId: user?.id || "",
      authorName: user?.user_metadata?.full_name || user?.email || "Staff",
      createdAt: Date.now(),
    }
    const next = [incident, ...items]
    setItems(next)
    save(next)
    toast.success("Incident logged")
    setClassId(""); setStudentId(""); setNote(""); setSeverity("minor"); setShowForm(false)
  }

  const handleDelete = (id: string) => {
    const target = items.find((i) => i.id === id)
    if (!target) return
    const isAdmin = role === "admin"
    if (!isAdmin && target.authorId !== user?.id) {
      toast.error("Only admin or author can delete")
      return
    }
    if (!window.confirm("Remove incident?")) return
    const next = items.filter((i) => i.id !== id)
    setItems(next)
    save(next)
  }

  const sevColor = (s: Incident["severity"]) =>
    s === "serious" ? "text-red-600 bg-red-50 dark:bg-red-500/10" :
    s === "moderate" ? "text-orange-600 bg-orange-50 dark:bg-orange-500/10" :
    "text-amber-600 bg-amber-50 dark:bg-amber-500/10"

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <motion.div className="flex items-start justify-between gap-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
            <Scale className="size-7 text-red-400" /> Discipline
          </h1>
          <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
            Log student disciplinary incidents. {items.length} total.
          </p>
        </div>
        {canLog && !showForm && (
          <Button onClick={() => setShowForm(true)} className="bg-red-500 hover:bg-red-600 text-white shrink-0">
            <Plus className="size-4 mr-1" /> Log
          </Button>
        )}
      </motion.div>

      {showForm && canLog && (
        <Card className="border-red-300">
          <CardContent className="p-4 space-y-3">
            <select value={classId} onChange={(e) => { setClassId(e.target.value); setStudentId("") }} className="w-full rounded-md border border-border/60 bg-transparent px-3 py-2 text-sm">
              <option value="">-- Select Class --</option>
              {allClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {selectedClass && (
              <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="w-full rounded-md border border-border/60 bg-transparent px-3 py-2 text-sm">
                <option value="">-- Select Student --</option>
                {selectedClass.students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <div className="flex gap-2">
              {(["minor", "moderate", "serious"] as const).map((s) => (
                <button key={s} onClick={() => setSeverity(s)} className={cn("px-3 py-1.5 rounded-full text-xs font-medium border", severity === s ? sevColor(s) + " border-current" : "border-border/50 text-navy-500")}>
                  {s}
                </button>
              ))}
            </div>
            <Input placeholder="What happened?" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={handleSave} className="bg-red-500 hover:bg-red-600 text-white">Save</Button>
              <Button variant="outline" onClick={() => { setShowForm(false); setClassId(""); setStudentId(""); setNote("") }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-red-500" /></div>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-navy-400">
          <AlertCircle className="size-10 mx-auto mb-2 text-navy-300" />
          No incidents logged.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map((i) => {
            const isAdmin = role === "admin"
            const canDel = isAdmin || i.authorId === user?.id
            return (
              <Card key={i.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-navy-900 dark:text-white">{i.studentName}</h3>
                      <p className="text-xs text-navy-500 dark:text-navy-400">{i.className}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium", sevColor(i.severity))}>
                        {i.severity}
                      </span>
                      {canDel && (
                        <button onClick={() => handleDelete(i.id)} className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md">
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-navy-600 dark:text-navy-300 mt-2 whitespace-pre-wrap">{i.note}</p>
                  <p className="text-[11px] text-navy-400 mt-2">{i.authorName} — {new Date(i.createdAt).toLocaleString("en-GB")}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
