"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchDisabledTeacherIds } from "@/lib/teacher-status"

// Loads the set of disabled teacher ids so a component can filter
// initialTeachers during render. `refresh` re-reads after a toggle.
export function useDisabledTeachers() {
  const [disabledIds, setDisabledIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const ids = await fetchDisabledTeacherIds()
    setDisabledIds(ids)
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { disabledIds, loading, refresh }
}
