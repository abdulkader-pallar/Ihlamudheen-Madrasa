"use client"

import { useEffect, useState } from "react"
import { supabase, isSupabaseConfigured } from "@/lib/supabase"
import { subscribeToTable } from "@/lib/db"
import { initialCourses } from "@/data/courses"

// Static fallback count shown before live data loads / when Supabase is off.
// No hardcoded roster — real counts come from the database.
const ROSTER_TOTAL = 0
const STATIC_COURSES = initialCourses.length

// Live counts synced from Supabase in real time.
// Falls back to static values during loading or when Supabase is not configured,
// so every page always shows a sensible number.
export function useLiveCounts(): {
  studentCount: number
  courseCount: number
  isLive: boolean
} {
  const [studentCount, setStudentCount] = useState(ROSTER_TOTAL)
  const courseCount = STATIC_COURSES
  const [isLive, setIsLive] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    let cancelled = false

    const refresh = async () => {
      const [studentsRes] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }),
      ])

      if (cancelled) return

      if (!studentsRes.error && studentsRes.count != null) {
        setStudentCount(studentsRes.count)
      }

      // Course count stays as initialCourses.length — Supabase only has active classes,
      // not all 4 programs, so we don't override the static value here.

      setIsLive(true)
    }

    refresh()
    const subs = [
      subscribeToTable("students", refresh),
    ]
    return () => {
      cancelled = true
      subs.forEach((s) => s.unsubscribe())
    }
  }, [])

  return { studentCount, courseCount, isLive }
}

// Backwards-compat shim for pages that only need the student count.
export function useStudentCount(): { count: number; isLive: boolean } {
  const { studentCount, isLive } = useLiveCounts()
  return { count: studentCount, isLive }
}
