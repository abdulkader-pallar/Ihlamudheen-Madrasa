"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowLeft, Save, SlidersHorizontal, RotateCcw, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { fetchEduAssignments, saveEduAssignments, type EduAssignment } from "@/lib/db"
import {
  EDU_TEACHERS, EDU_GRADES, SUBJECTS_PER_WEEK, TOTAL_SLOTS, subjectCode,
} from "@/data/edu-support-timetable"
import {
  EDU_SCHEDULER_SUBJECTS, deriveBreakdown, eligibilityFromAssignments,
} from "@/lib/edu-loadplan"

const SUBJECTS = EDU_SCHEDULER_SUBJECTS
const keyOf = (t: string, g: string, s: string) => `${t}|${g}|${s}`

// Default eligibility (what the solver assumes when nothing is saved): every
// teacher may teach every grade for the subjects they're qualified for.
function defaultKeys(): Set<string> {
  const set = new Set<string>()
  for (const t of EDU_TEACHERS) {
    for (const g of EDU_GRADES) {
      for (const s of SUBJECTS) if (t.canTeach.includes(s)) set.add(keyOf(t.id, g.id, s))
    }
  }
  return set
}

export default function EduAssignPage() {
  const { user } = useAuth()
  const isAdmin = getUserRole(user) === "admin"
  const [keys, setKeys] = useState<Set<string>>(() => defaultKeys())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const saved = await fetchEduAssignments()
      if (!alive) return
      if (saved && saved.length > 0) {
        setKeys(new Set(saved.map((a) => keyOf(a.teacherId, a.gradeId, a.subject))))
      }
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  function toggle(t: string, g: string, s: string) {
    setKeys((prev) => {
      const next = new Set(prev)
      const k = keyOf(t, g, s)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  // Set every qualified (grade,subject) cell for a teacher on/off at once.
  function setTeacherAll(teacherId: string, on: boolean) {
    const teacher = EDU_TEACHERS.find((t) => t.id === teacherId)
    if (!teacher) return
    setKeys((prev) => {
      const next = new Set(prev)
      for (const g of EDU_GRADES) {
        for (const s of SUBJECTS) {
          if (!teacher.canTeach.includes(s)) continue
          const k = keyOf(teacherId, g.id, s)
          if (on) next.add(k)
          else next.delete(k)
        }
      }
      return next
    })
  }

  // Live preview: run the same solver the generator uses, so the admin sees the
  // resulting balanced workload (and any infeasibility) before saving.
  const eligible = useMemo(() => {
    const list = Array.from(keys).map((k) => {
      const [teacherId, gradeId, subject] = k.split("|")
      return { teacherId, gradeId, subject }
    })
    return eligibilityFromAssignments(list)
  }, [keys])

  const plan = useMemo(
    () => deriveBreakdown(EDU_TEACHERS, EDU_GRADES, SUBJECTS_PER_WEEK, TOTAL_SLOTS, eligible),
    [eligible],
  )

  const teacherTotals = useMemo(() => {
    if (!plan.ok) return {} as Record<string, number>
    const out: Record<string, number> = {}
    EDU_TEACHERS.forEach((t, ti) => {
      out[t.id] = EDU_GRADES.reduce(
        (a, _g, gi) => a + SUBJECTS.reduce((b, _s, si) => b + (plan.breakdown[ti]?.[gi]?.[si] ?? 0), 0),
        0,
      )
    })
    return out
  }, [plan])

  // (grade,subject) cells with quota but no eligible teacher — the actionable gaps.
  const gaps = useMemo(() => {
    const out: string[] = []
    for (const g of EDU_GRADES) {
      for (const s of SUBJECTS) {
        if ((SUBJECTS_PER_WEEK[s] ?? 0) <= 0) continue
        const count = EDU_TEACHERS.filter((t) => keys.has(keyOf(t.id, g.id, s))).length
        if (count === 0) out.push(`${g.short} · ${s}`)
      }
    }
    return out
  }, [keys])

  async function handleSave() {
    setSaving(true)
    const list: EduAssignment[] = Array.from(keys).map((k) => {
      const [teacherId, gradeId, subject] = k.split("|")
      return { teacherId, gradeId, subject }
    })
    const res = await saveEduAssignments(list)
    setSaving(false)
    if (res.error === "supabase-not-configured") {
      toast.error("Cloud not configured — assignments can't be saved.")
    } else if (res.error) {
      toast.error("Save failed — check you're signed in as admin.")
    } else {
      toast.success("Subject assignments saved. Use “Generate all” to apply.")
    }
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ShieldAlert className="size-10 text-red-500" />
            <p className="text-lg font-semibold">Admins only</p>
            <p className="text-sm text-muted-foreground">
              Subject &amp; grade assignment is restricted to administrators.
            </p>
            <Link href="/dashboard/edu-timetable" className={cn(btnGhost, "mt-2")}>
              <ArrowLeft className="size-4" /> Back to EDU Timetable
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-center gap-3"
      >
        <Link href="/dashboard/edu-timetable" className={btnGhost}>
          <ArrowLeft className="size-4" /> Back
        </Link>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 truncate text-xl font-bold text-navy-800 dark:text-navy-100">
            <SlidersHorizontal className="size-5 shrink-0" /> Assign subjects &amp; grades
          </h1>
          <p className="text-sm text-muted-foreground">
            Tick which subject each teacher may teach in each grade. The generator
            auto-balances the actual periods within your choices{loading ? " · loading…" : ""}.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
          <button onClick={() => setKeys(defaultKeys())} className={btnGhost}>
            <RotateCcw className="size-4" /> Reset to default
          </button>
          <button onClick={handleSave} disabled={saving} className={cn(btnPrimary, saving && "opacity-60")}>
            <Save className="size-4" /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </motion.div>

      {/* Feasibility banner */}
      {!plan.ok ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{plan.error}</span>
        </div>
      ) : gaps.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>No teacher assigned for: {gaps.join(", ")}.</span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-900/20 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>Feasible — every grade is covered and the load balances. Each grade needs {TOTAL_SLOTS} periods/week.</span>
        </div>
      )}

      {EDU_TEACHERS.map((t) => (
        <Card key={t.id}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base">{t.name}</CardTitle>
            <div className="flex items-center gap-2">
              {plan.ok && (
                <span className="rounded-full bg-navy-100 px-2.5 py-1 text-xs font-semibold text-navy-700 dark:bg-navy-700 dark:text-navy-100">
                  {teacherTotals[t.id] ?? 0} periods/week
                </span>
              )}
              <button onClick={() => setTeacherAll(t.id, true)} className={chip}>All</button>
              <button onClick={() => setTeacherAll(t.id, false)} className={chip}>None</button>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Grade</th>
                  {SUBJECTS.map((s) => (
                    <th key={s} className="px-3 py-2 text-center font-medium">
                      {subjectCode(s)}
                      <span className="ml-1 font-normal opacity-70">({SUBJECTS_PER_WEEK[s] ?? 0})</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {EDU_GRADES.map((g) => (
                  <tr key={g.id} className="border-b border-border/60 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-navy-700 dark:text-navy-200">
                      {g.name}
                    </td>
                    {SUBJECTS.map((s) => {
                      const can = t.canTeach.includes(s)
                      const on = keys.has(keyOf(t.id, g.id, s))
                      return (
                        <td key={s} className="px-3 py-2 text-center">
                          {can ? (
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => toggle(t.id, g.id, s)}
                              className="size-4 cursor-pointer accent-violet-600"
                              aria-label={`${t.name} — ${g.name} — ${s}`}
                            />
                          ) : (
                            <span className="text-muted-foreground/40" title="Not qualified">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

const btnPrimary = "flex flex-1 items-center justify-center gap-2 rounded-lg bg-navy-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-800 sm:flex-none"
const btnGhost = "flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-200 dark:hover:bg-navy-700 sm:flex-none"
const chip = "rounded-md border border-border px-2 py-1 text-xs font-medium text-navy-600 transition-colors hover:bg-navy-50 dark:text-navy-300 dark:hover:bg-navy-700"
