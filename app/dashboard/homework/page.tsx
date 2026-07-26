"use client"

import { motion } from "framer-motion"
import { NotebookPen, Calendar, CheckCircle2, Circle, BookOpen } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

interface Homework {
  id: string
  title: string
  course: string
  assignedDate: string
  dueDate: string
  completed: boolean
  details: string
}

const homeworkList: Homework[] = [
  {
    id: "1",
    title: "Practice Tajweed Rules - Idgham & Ikhfa",
    course: "Ihlamudheen Madrasa",
    assignedDate: "2026-04-04",
    dueDate: "2026-04-07",
    completed: false,
    details: "Practice reading Surah Yasin with proper Idgham and Ikhfa rules. Record yourself and listen for corrections.",
  },
  {
    id: "2",
    title: "Write 10 sentences using new vocabulary",
    course: "Ihlamudheen Madrasa",
    assignedDate: "2026-04-05",
    dueDate: "2026-04-08",
    completed: false,
    details: "Use the 10 new vocabulary words from today's lesson to write original sentences.",
  },
  {
    id: "3",
    title: "Read Chapter 4 - Business Ethics",
    course: "CIBIS",
    assignedDate: "2026-04-03",
    dueDate: "2026-04-06",
    completed: true,
    details: "Read Chapter 4 and prepare 3 discussion questions for next class.",
  },
  {
    id: "4",
    title: "Dua Memorization - Morning & Evening Adhkar",
    course: "Ihlamudheen Madrasa",
    assignedDate: "2026-04-02",
    dueDate: "2026-04-06",
    completed: true,
    details: "Memorize the morning and evening Adhkar from the provided booklet, pages 12-15.",
  },
  {
    id: "5",
    title: "Presentation Slides - My Future Career",
    course: "Ihlamudheen Madrasa",
    assignedDate: "2026-04-05",
    dueDate: "2026-04-10",
    completed: false,
    details: "Create a 5-slide presentation about your desired future career and the skills needed.",
  },
]

export default function HomeworkPage() {
  const pending = homeworkList.filter((h) => !h.completed)
  const completed = homeworkList.filter((h) => h.completed)

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <NotebookPen className="size-8 text-orange-500" /> Homework
        </h1>
        <p className="mt-1 text-navy-600 dark:text-navy-300">
          Your daily homework and tasks from all courses.
        </p>
      </motion.div>

      {/* Pending */}
      <div>
        <h2 className="text-lg font-semibold text-navy-800 dark:text-navy-100 mb-3 flex items-center gap-2">
          <Circle className="size-4 text-amber-500" /> Pending ({pending.length})
        </h2>
        <div className="space-y-3">
          {pending.map((hw, i) => (
            <motion.div key={hw.id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className="border-l-4 border-l-amber-400 transition-shadow hover:shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gold-600 dark:text-gold-400">{hw.course}</span>
                  </div>
                  <h3 className="font-semibold text-navy-900 dark:text-white">{hw.title}</h3>
                  <p className="text-sm text-navy-500 dark:text-navy-400 mt-1">{hw.details}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-navy-400">
                    <span className="flex items-center gap-1"><Calendar className="size-3" /> Assigned: {hw.assignedDate}</span>
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><Calendar className="size-3" /> Due: {hw.dueDate}</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Completed */}
      <div>
        <h2 className="text-lg font-semibold text-navy-800 dark:text-navy-100 mb-3 flex items-center gap-2">
          <CheckCircle2 className="size-4 text-emerald-500" /> Completed ({completed.length})
        </h2>
        <div className="space-y-3">
          {completed.map((hw, i) => (
            <motion.div key={hw.id} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className="border-l-4 border-l-emerald-400 opacity-75 transition-shadow hover:opacity-100 hover:shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gold-600 dark:text-gold-400">{hw.course}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="size-3" /> Done
                    </span>
                  </div>
                  <h3 className="font-semibold text-navy-900 dark:text-white line-through decoration-1">{hw.title}</h3>
                  <p className="text-sm text-navy-500 dark:text-navy-400 mt-1">{hw.details}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>

      {homeworkList.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <BookOpen className="size-12 text-navy-300 dark:text-navy-600 mb-3" />
          <p className="text-navy-500 dark:text-navy-400">No homework assigned.</p>
        </div>
      )}
    </div>
  )
}
