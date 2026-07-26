"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { ClipboardList, Calendar, CheckCircle2, Circle, AlertCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Assignment {
  id: string
  title: string
  course: string
  dueDate: string
  status: "pending" | "submitted" | "graded" | "overdue"
  description: string
  grade?: string
  attachments?: string[]
}

const assignments: Assignment[] = [
  {
    id: "1",
    title: "Surah Al-Baqarah Memorization (Ayat 1-20)",
    course: "Ihlamudheen Madrasa",
    dueDate: "2026-04-10",
    status: "pending",
    description: "Memorize Ayat 1-20 of Surah Al-Baqarah with proper Tajweed. Be prepared for oral recitation in class.",
  },
  {
    id: "2",
    title: "English Essay - My Community",
    course: "Ihlamudheen Madrasa",
    dueDate: "2026-04-08",
    status: "submitted",
    description: "Write a 500-word essay about your community and how education plays a role in it.",
  },
  {
    id: "3",
    title: "Islamic History Report",
    course: "Ihlamudheen Madrasa",
    dueDate: "2026-04-05",
    status: "graded",
    description: "Research and write about the early Islamic period and the four Rightly Guided Caliphs.",
    grade: "A",
  },
  {
    id: "4",
    title: "Business Communication Presentation",
    course: "CIBIS",
    dueDate: "2026-04-03",
    status: "overdue",
    description: "Prepare a 10-minute presentation on effective business communication strategies.",
  },
  {
    id: "5",
    title: "Vocabulary Test Preparation",
    course: "Ihlamudheen Madrasa",
    dueDate: "2026-04-12",
    status: "pending",
    description: "Study chapters 5-8 vocabulary words. Test will cover definitions, synonyms, and usage in sentences.",
  },
]

const statusConfig = {
  pending: { label: "Pending", icon: Circle, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-500/10" },
  submitted: { label: "Submitted", icon: CheckCircle2, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-500/10" },
  graded: { label: "Graded", icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-500/10" },
  overdue: { label: "Overdue", icon: AlertCircle, color: "text-red-500", bg: "bg-red-50 dark:bg-red-500/10" },
}

export default function AssignmentsPage() {
  const [filter, setFilter] = useState<"all" | "pending" | "submitted" | "graded" | "overdue">("all")

  const filtered = filter === "all" ? assignments : assignments.filter((a) => a.status === filter)

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <ClipboardList className="size-8 text-indigo-500" /> Assignments
        </h1>
        <p className="mt-1 text-navy-600 dark:text-navy-300">
          View and track all your course assignments.
        </p>
      </motion.div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "pending", "submitted", "graded", "overdue"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
            className={cn(filter === f && "bg-gold-500 text-navy-950 hover:bg-gold-400", "capitalize")}
          >
            {f === "all" ? "All" : f} {f !== "all" && `(${assignments.filter((a) => a.status === f).length})`}
          </Button>
        ))}
      </div>

      {/* Assignments list */}
      <div className="space-y-3">
        {filtered.map((assignment, i) => {
          const sc = statusConfig[assignment.status]
          const StatusIcon = sc.icon
          return (
            <motion.div key={assignment.id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className="transition-shadow hover:shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-medium text-gold-600 dark:text-gold-400">{assignment.course}</span>
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", sc.bg, sc.color)}>
                          <StatusIcon className="size-3" /> {sc.label}
                        </span>
                      </div>
                      <h3 className="font-semibold text-navy-900 dark:text-white">{assignment.title}</h3>
                      <p className="text-sm text-navy-500 dark:text-navy-400 mt-1 line-clamp-2">{assignment.description}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-navy-400">
                        <span className="flex items-center gap-1"><Calendar className="size-3" /> Due: {assignment.dueDate}</span>
                        {assignment.grade && (
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">Grade: {assignment.grade}</span>
                        )}
                      </div>
                    </div>
                    {assignment.status === "pending" && (
                      <Button size="sm" className="bg-gold-500 text-navy-950 hover:bg-gold-400 shrink-0">Submit</Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <ClipboardList className="size-12 text-navy-300 dark:text-navy-600 mb-3" />
          <p className="text-navy-500 dark:text-navy-400">No assignments found.</p>
        </div>
      )}
    </div>
  )
}
