"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { Users, Phone, Search, Bus, BookOpen, Loader2, UserX, UserCheck } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { useDisabledTeachers } from "@/hooks/use-disabled-teachers"
import { getUserRole } from "@/lib/roles"
import { setTeacherDisabled } from "@/lib/teacher-status"
import { initialTeachers, initialCourses } from "@/data/courses"
import * as db from "@/lib/db"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

export default function EmployeesPage() {
  const { user } = useAuth(true)
  const isAdmin = getUserRole(user) === "admin"
  const { disabledIds, refresh: refreshDisabled } = useDisabledTeachers()
  const [search, setSearch] = useState("")
  const [dbStaff, setDbStaff] = useState<db.StaffRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState<string | null>(null)

  useEffect(() => {
    db.fetchTeachers().then((rows) => {
      setDbStaff(rows)
      setLoading(false)
    })
  }, [])

  const toggleDisabled = async (id: string, name: string, currentlyDisabled: boolean) => {
    setPendingId(id)
    const { error } = await setTeacherDisabled(id, !currentlyDisabled)
    setPendingId(null)
    if (error) {
      toast.error(error)
      return
    }
    toast.success(currentlyDisabled ? `${name} re-enabled` : `${name} disabled`)
    refreshDisabled()
  }

  const classesById = new Map<string, string>()
  initialCourses.forEach((c) => c.classes.forEach((cls) => classesById.set(cls.id, cls.name)))

  const rows = initialTeachers.map((t) => {
    const fromDb = dbStaff.find((s) => s.id === t.id)
    return {
      id: t.id,
      name: t.name,
      phone: fromDb?.phone || "",
      transportAllowance: fromDb ? fromDb.transportAllowance : t.transportAllowance,
      classes: t.classIds.map((cid) => classesById.get(cid) || cid).join(", "),
      classCount: t.classIds.length,
      disabled: disabledIds.has(t.id),
    }
  })

  const filtered = rows.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.phone.includes(search) ||
      r.classes.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <Users className="size-7 text-blue-500" /> Employees
        </h1>
        <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
          {initialTeachers.length} teachers across Ihlamudheen Madrasa
        </p>
      </motion.div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, phone, or class..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-blue-500" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r, i) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
            >
              <Card className={cn("hover:shadow-md transition-shadow", r.disabled && "opacity-60")}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white font-semibold">
                      {r.name[0]?.toUpperCase() || "T"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-navy-900 dark:text-white truncate">
                        {r.name}
                      </h3>
                      {r.phone && (
                        <p className="text-xs text-navy-500 dark:text-navy-400 flex items-center gap-1 mt-0.5">
                          <Phone className="size-3" /> {r.phone}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.disabled && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400 px-2 py-0.5">
                            <UserX className="size-3" /> Disabled
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 px-2 py-0.5">
                          <BookOpen className="size-3" /> {r.classCount} {r.classCount === 1 ? "class" : "classes"}
                        </span>
                        {r.transportAllowance && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 px-2 py-0.5">
                            <Bus className="size-3" /> TA
                          </span>
                        )}
                      </div>
                      {r.classes && (
                        <p className="text-[11px] text-navy-400 mt-2 line-clamp-2">{r.classes}</p>
                      )}
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pendingId === r.id}
                          onClick={() => toggleDisabled(r.id, r.name, r.disabled)}
                          className={cn(
                            "mt-3 h-7 w-full text-xs",
                            r.disabled
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400",
                          )}
                        >
                          {pendingId === r.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : r.disabled ? (
                            <><UserCheck className="size-3" /> Enable</>
                          ) : (
                            <><UserX className="size-3" /> Disable</>
                          )}
                        </Button>
                      )}
                    </div>
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
