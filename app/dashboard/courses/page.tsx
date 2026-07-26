"use client"

import { useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { Clock, BarChart3, Play, Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { CourseLogo } from "@/components/course-logo"

const enrolledCourses = [
  {
    id: "1",
    title: "Ihlamudheen Madrasa",
    instructor: "Ihlamudheen Academy",
    progress: 75,
    totalLessons: 48,
    completedLessons: 36,
    category: "Islamic Studies",
    logo: "/logo.png",
    logoClass: "h-20 w-auto object-contain",
    lastAccessed: "2 hours ago",
  },
  {
    id: "2",
    title: "Ihlamudheen Madrasa",
    instructor: "Ihlamudheen Academy",
    progress: 45,
    totalLessons: 36,
    completedLessons: 16,
    category: "Language",
    logo: "/logo-icon.png",
    logoClass: "h-20 w-auto object-contain",
    lastAccessed: "1 day ago",
  },
  {
    id: "3",
    title: "CIBIS",
    instructor: "Ihlamudheen Academy",
    progress: 60,
    totalLessons: 32,
    completedLessons: 19,
    category: "Professional",
    logo: "/logo-icon.png",
    logoClass: "h-20 w-auto object-contain",
    lastAccessed: "3 hours ago",
  },
  {
    id: "4",
    title: "Ihlamudheen Madrasa",
    instructor: "Ihlamudheen Academy",
    progress: 20,
    totalLessons: 40,
    completedLessons: 8,
    category: "Professional",
    logo: "/logo.png",
    logoClass: "h-20 w-auto object-contain",
    lastAccessed: "5 days ago",
  },
]

export default function MyCoursesPage() {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "in-progress" | "completed">("all")

  const filtered = enrolledCourses.filter((c) => {
    const matchSearch = c.title.toLowerCase().includes(search.toLowerCase())
    if (filter === "completed") return matchSearch && c.progress === 100
    if (filter === "in-progress") return matchSearch && c.progress < 100
    return matchSearch
  })

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-3xl font-bold text-navy-900 dark:text-white">My Courses</h1>
        <p className="mt-1 text-navy-600 dark:text-navy-300">
          Track your learning progress across all enrolled courses.
        </p>
      </motion.div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search courses..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          {(["all", "in-progress", "completed"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
              className={filter === f ? "bg-gold-500 text-navy-950 hover:bg-gold-400" : ""}
            >
              {f === "all" ? "All" : f === "in-progress" ? "In Progress" : "Completed"}
            </Button>
          ))}
        </div>
      </div>

      {/* Course Grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((course, i) => (
          <motion.div
            key={course.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.05 }}
          >
            <Card className="overflow-hidden transition-shadow hover:shadow-lg">
              <div className="h-32 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-navy-700 dark:to-navy-900 flex items-center justify-center">
                <CourseLogo id={course.id} title={course.title} className={course.logoClass} />
              </div>
              <CardContent className="p-4 space-y-3">
                <div>
                  <span className="text-xs font-medium text-gold-600 dark:text-gold-400">
                    {course.category}
                  </span>
                  <h3 className="mt-1 font-semibold text-navy-900 dark:text-white line-clamp-1">
                    {course.title}
                  </h3>
                  <p className="text-sm text-navy-500 dark:text-navy-400">{course.instructor}</p>
                </div>

                {/* Progress */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-navy-600 dark:text-navy-300">
                      {course.completedLessons}/{course.totalLessons} lessons
                    </span>
                    <span className="font-medium text-gold-600 dark:text-gold-400">
                      {course.progress}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-navy-100 dark:bg-navy-700">
                    <div
                      className="h-2 rounded-full bg-gold-500 transition-all"
                      style={{ width: `${course.progress}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-xs text-navy-400">
                    <Clock className="size-3" /> {course.lastAccessed}
                  </span>
                  <Link href={`/courses/${course.id}`}>
                    <Button size="sm" className="bg-gold-500 text-navy-950 hover:bg-gold-400">
                      <Play className="mr-1 size-3" /> Continue
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BarChart3 className="size-12 text-navy-300 dark:text-navy-600 mb-3" />
          <p className="text-navy-500 dark:text-navy-400">No courses found.</p>
        </div>
      )}
    </div>
  )
}
