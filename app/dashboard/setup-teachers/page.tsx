"use client"

import { useState, useEffect, useRef } from "react"
import { motion } from "framer-motion"
import {
  Shield,
  UserPlus,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  ArrowLeft,
  Fingerprint,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { authFetch } from "@/lib/api-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { initialCourses, ZK_DEVICE_ID_MAP, initialTeachers } from "@/data/courses"

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeacherResult {
  name: string
  role: string
  status: "created" | "exists" | "error"
  message?: string
}

interface SetupResponse {
  success: boolean
  summary: { created: number; existing: number; errors: number; total: number }
  results: TeacherResult[]
  error?: string
}

interface AddStaffResult {
  success?: boolean
  teacherId?: string
  message?: string
  error?: string
}

type StaffType = "teaching" | "non-teaching"
type TeachingProgram = "madrasa" | "edu-support" | "english" | "cibis"
type DualProgram = "none" | "english" | "cibis"
type NonTeachingRole = "office" | "cleaning" | "driver"

// ── Pay type mapping ──────────────────────────────────────────────────────────
const PAY_TYPE_MAP: Record<string, string> = {
  madrasa: "per-session-madrasa",
  "edu-support": "monthly-edu-support",
  english: "per-day-english",
  cibis: "per-day-cibis",
  office: "monthly-office",
  cleaning: "monthly-cleaning",
  driver: "daily-driver",
}

// ── Reverse pay type → { staffType, teachingProgram, nonTeachingRole } ────────
function resolvePayType(payType: string): {
  staffType: StaffType
  teachingProgram: TeachingProgram
  nonTeachingRole: NonTeachingRole
} {
  switch (payType) {
    case "per-session-madrasa":
      return { staffType: "teaching", teachingProgram: "madrasa", nonTeachingRole: "office" }
    case "monthly-edu-support":
      return { staffType: "teaching", teachingProgram: "edu-support", nonTeachingRole: "office" }
    case "per-day-english":
      return { staffType: "teaching", teachingProgram: "english", nonTeachingRole: "office" }
    case "per-day-cibis":
      return { staffType: "teaching", teachingProgram: "cibis", nonTeachingRole: "office" }
    case "monthly-office":
      return { staffType: "non-teaching", teachingProgram: "madrasa", nonTeachingRole: "office" }
    case "monthly-cleaning":
      return { staffType: "non-teaching", teachingProgram: "madrasa", nonTeachingRole: "cleaning" }
    case "daily-driver":
      return { staffType: "non-teaching", teachingProgram: "madrasa", nonTeachingRole: "driver" }
    default:
      return { staffType: "teaching", teachingProgram: "madrasa", nonTeachingRole: "office" }
  }
}

// ── Ihlamudheen classes (from initialCourses, course id "1") ────────────────────────
const madrasaCourse = initialCourses.find((c) => c.id === "1")
const madrasaCourseClasses = madrasaCourse ? madrasaCourse.classes : []

// ── Non-teaching role defaults ─────────────────────────────────────────────────
const NON_TEACHING_DEFAULTS: Record<NonTeachingRole, { monthly?: number; daily?: number }> = {
  office: { monthly: 2000 },
  cleaning: { monthly: 400 },
  driver: { daily: 30 },
}

// ── Build a lookup index: teacherId → ZK device ID ───────────────────────────
const TEACHER_ID_TO_ZK: Record<string, number> = {}
for (const [zkId, teacherId] of Object.entries(ZK_DEVICE_ID_MAP)) {
  // Only store first occurrence (avoid duplicate-enrollment override)
  if (!(teacherId in TEACHER_ID_TO_ZK)) {
    TEACHER_ID_TO_ZK[teacherId] = Number(zkId)
  }
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SetupTeachersPage() {
  const { user, loading: authLoading } = useAuth(true)

  // ── Batch bootstrap state (existing) ──────────────────────────────────────
  const [running, setRunning] = useState(false)
  const [batchResponse, setBatchResponse] = useState<SetupResponse | null>(null)
  const [batchError, setBatchError] = useState("")
  const [batchOpen, setBatchOpen] = useState(false)

  // ── Add Staff form state ───────────────────────────────────────────────────
  const [staffType, setStaffType] = useState<StaffType>("teaching")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [fingerprintId, setFingerprintId] = useState("")
  const [teachingProgram, setTeachingProgram] = useState<TeachingProgram>("madrasa")
  const [dualProgram, setDualProgram] = useState<DualProgram>("none")
  const [nonTeachingRole, setNonTeachingRole] = useState<NonTeachingRole>("office")
  const [selectedClasses, setSelectedClasses] = useState<string[]>([])
  const [transportAllowance, setTransportAllowance] = useState(false)
  const [monthlyRate, setMonthlyRate] = useState("1500")
  const [dailyRate, setDailyRate] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<AddStaffResult | null>(null)

  // ── Existing staff lookup state ────────────────────────────────────────────
  // existingTeacherId: non-null when a roster match is active (fingerprint lookup)
  const [existingTeacherId, setExistingTeacherId] = useState<string | null>(null)
  // greenBannerDismissed: hides the green "Existing roster record found" banner
  const [greenBannerDismissed, setGreenBannerDismissed] = useState(false)
  // nameSuggestion: non-null when a single name match found and fingerprint is empty
  const [nameSuggestion, setNameSuggestion] = useState<{ teacherId: string; name: string; zkId: number } | null>(null)
  // nameDebounceRef: timer for debounced name lookup
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const role = user ? getUserRole(user) : "student"
  const isAdmin = role === "admin"

  // ── loadTeacher: fill form fields from roster + existing Supabase profile ──
  function loadTeacher(teacherId: string) {
    const teacher = initialTeachers.find((t) => t.id === teacherId)
    if (!teacher) return

    const { staffType: resolvedStaffType, teachingProgram: resolvedProgram, nonTeachingRole: resolvedRole } =
      resolvePayType(teacher.payType)

    setName(teacher.name)
    setStaffType(resolvedStaffType)
    setTransportAllowance(teacher.transportAllowance)
    setSelectedClasses(teacher.classIds ?? [])

    if (resolvedStaffType === "teaching") {
      setTeachingProgram(resolvedProgram)
      setDualProgram("none")
      if (teacher.fixedMonthlyRate !== undefined) setMonthlyRate(String(teacher.fixedMonthlyRate))
    } else {
      setNonTeachingRole(resolvedRole)
      if (teacher.fixedMonthlyRate !== undefined) { setMonthlyRate(String(teacher.fixedMonthlyRate)); setDailyRate("") }
      else if (teacher.dailyRate !== undefined)   { setDailyRate(String(teacher.dailyRate)); setMonthlyRate("") }
    }

    setExistingTeacherId(teacherId)
    setGreenBannerDismissed(false)
    setNameSuggestion(null)
    setResult(null)

    // Fetch existing Supabase account details (email + phone) if the teacher
    // already has an account — pre-fills the form so admin can see/update them.
    authFetch(`/api/get-staff-profile?name=${encodeURIComponent(teacher.name)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.found) {
          if (data.email) setEmail(data.email)
          if (data.phone) setPhone(data.phone)
        }
      })
      .catch(() => { /* silently ignore — admin can type manually */ })
  }

  // ── lookupByFingerprint: called when fingerprint field changes ─────────────
  function lookupByFingerprint(value: string) {
    const num = parseInt(value, 10)
    if (isNaN(num) || num < 1) {
      // Clear roster match if fingerprint is cleared
      setExistingTeacherId(null)
      setGreenBannerDismissed(false)
      return
    }
    const teacherId = ZK_DEVICE_ID_MAP[num as keyof typeof ZK_DEVICE_ID_MAP]
    if (teacherId) {
      loadTeacher(teacherId)
    } else {
      // No match — clear any previous match
      setExistingTeacherId(null)
      setGreenBannerDismissed(false)
    }
  }

  // ── lookupByName: debounced, runs when name field changes ─────────────────
  function scheduleNameLookup(value: string) {
    if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current)
    // Only suggest when fingerprint is empty
    if (fingerprintId.trim() !== "") {
      setNameSuggestion(null)
      return
    }
    nameDebounceRef.current = setTimeout(() => {
      const query = value.trim().toLowerCase()
      if (query.length < 2) {
        setNameSuggestion(null)
        return
      }
      const matches = initialTeachers.filter((t) =>
        t.name.toLowerCase().includes(query)
      )
      if (matches.length === 1) {
        const zkId = TEACHER_ID_TO_ZK[matches[0].id]
        if (zkId !== undefined) {
          setNameSuggestion({ teacherId: matches[0].id, name: matches[0].name, zkId })
        } else {
          setNameSuggestion(null)
        }
      } else {
        setNameSuggestion(null)
      }
    }, 400)
  }

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current)
    }
  }, [])

  // ── Batch bootstrap handler (existing logic) ──────────────────────────────
  async function handleSetup() {
    setRunning(true)
    setBatchError("")
    setBatchResponse(null)

    try {
      const res = await authFetch("/api/setup-teachers", { method: "POST" })
      const text = await res.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        setBatchError(`Server returned invalid response (${res.status}): ${text.slice(0, 200)}`)
        return
      }
      if (!res.ok) {
        setBatchError(data.error || `Failed (status ${res.status})`)
        return
      }
      setBatchResponse(data)
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Network error")
    } finally {
      setRunning(false)
    }
  }

  // ── Teaching program change handler ───────────────────────────────────────
  function handleTeachingProgramChange(program: TeachingProgram) {
    setTeachingProgram(program)
    setDualProgram("none")
    setSelectedClasses([])
    // Set default monthly rate for edu-support
    if (program === "edu-support") {
      setMonthlyRate("1500")
    }
  }

  // ── Non-teaching role change handler ──────────────────────────────────────
  function handleNonTeachingRoleChange(role: NonTeachingRole) {
    setNonTeachingRole(role)
    const defaults = NON_TEACHING_DEFAULTS[role]
    if (defaults.monthly !== undefined) {
      setMonthlyRate(String(defaults.monthly))
      setDailyRate("")
    } else if (defaults.daily !== undefined) {
      setDailyRate(String(defaults.daily))
      setMonthlyRate("")
    }
  }

  // ── Class toggle ───────────────────────────────────────────────────────────
  function toggleClass(classId: string) {
    setSelectedClasses((prev) =>
      prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId]
    )
  }

  // Show classes grid when primary is Ihlamudheen
  const showClassGrid = staffType === "teaching" && teachingProgram === "madrasa"

  // ── Dual program options (exclude primary) ────────────────────────────────
  const dualOptions: { label: string; value: DualProgram }[] = [
    { label: "None", value: "none" },
    ...(teachingProgram !== "english" ? [{ label: "+English Madrasa", value: "english" as DualProgram }] : []),
    ...(teachingProgram !== "cibis" ? [{ label: "+CIBIS", value: "cibis" as DualProgram }] : []),
  ]

  // ── Matched teacher name for green banner ─────────────────────────────────
  const matchedTeacher = existingTeacherId
    ? initialTeachers.find((t) => t.id === existingTeacherId)
    : null

  // ── Add Staff submit handler ───────────────────────────────────────────────
  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault()
    setResult(null)

    // Client-side validation
    if (!name.trim()) { toast.error("Full name is required"); return }
    if (!email.trim()) { toast.error("Email is required"); return }
    if (!fingerprintId.trim()) { toast.error("Fingerprint Device ID is required"); return }
    const fpNum = parseInt(fingerprintId, 10)
    if (isNaN(fpNum) || fpNum < 1 || String(fpNum) !== fingerprintId.trim()) {
      toast.error("Fingerprint Device ID must be a positive integer")
      return
    }

    // Pay type computation
    let computedPayType: string
    let computedDualPayType: string | undefined
    let computedFixedMonthlyRate: number | undefined
    let computedDailyRate: number | undefined
    let computedTeachesMadrasa = false
    let computedTeachesCibis = false
    let computedRoleLabel: string | undefined
    let computedClassIds = selectedClasses

    if (staffType === "teaching") {
      computedPayType = PAY_TYPE_MAP[teachingProgram]
      if (dualProgram !== "none") {
        computedDualPayType = PAY_TYPE_MAP[dualProgram]
        if (dualProgram === "cibis") computedTeachesCibis = true
      }
      if (teachingProgram === "madrasa") computedTeachesMadrasa = true
      if (teachingProgram === "cibis") computedTeachesCibis = true

      if (teachingProgram === "edu-support") {
        if (!monthlyRate.trim()) { toast.error("Monthly Rate is required for EDU Support"); return }
        computedFixedMonthlyRate = Number(monthlyRate)
      }
    } else {
      // non-teaching
      computedPayType = PAY_TYPE_MAP[nonTeachingRole]
      computedClassIds = []
      computedRoleLabel = nonTeachingRole

      if (nonTeachingRole === "office" || nonTeachingRole === "cleaning") {
        if (!monthlyRate.trim()) { toast.error("Monthly Salary is required"); return }
        computedFixedMonthlyRate = Number(monthlyRate)
      } else if (nonTeachingRole === "driver") {
        if (!dailyRate.trim()) { toast.error("Daily Rate is required"); return }
        computedDailyRate = Number(dailyRate)
      }
    }

    setSubmitting(true)
    try {
      const res = await authFetch("/api/add-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          fingerprintDeviceId: fpNum,
          staffType,
          payType: computedPayType,
          dualPayType: computedDualPayType,
          fixedMonthlyRate: computedFixedMonthlyRate,
          dailyRate: computedDailyRate,
          transportAllowance,
          classIds: computedClassIds,
          teachesMadrasa: computedTeachesMadrasa,
          teachesCibis: computedTeachesCibis,
          roleLabel: computedRoleLabel,
        }),
      })
      const data = await res.json()
      setResult(data)
      if (data.success) {
        toast.success(`Staff member added successfully! ID: ${data.teacherId}`)
        if (data.tempPassword) {
          window.alert(
            `Account created for ${name.trim()}.\n\nTemporary password: ${data.tempPassword}\n\nShare it securely. They should change it on first login.`
          )
        }
      } else {
        toast.error(data.error || "Failed to add staff member")
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error"
      setResult({ error: msg })
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Auth loading ───────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="size-8 animate-spin text-gold-500" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <Shield className="size-16 text-red-400" />
        <h2 className="text-xl font-bold text-navy-900 dark:text-white">Admin Access Required</h2>
        <p className="text-muted-foreground">Only administrators can create teacher accounts.</p>
        <Link href="/dashboard">
          <Button variant="outline">
            <ArrowLeft className="mr-2 size-4" />
            Back to Dashboard
          </Button>
        </Link>
      </div>
    )
  }

  // ── Punch rules info text ─────────────────────────────────────────────────
  function getPunchRulesText(): string[] {
    const lines: string[] = []

    if (staffType === "teaching") {
      switch (teachingProgram) {
        case "madrasa":
          lines.push("✓ Ihlamudheen Madrasa: Sat & Sun. IN 06:00–10:30, OUT 11:00–16:00. 60 AED/session.")
          break
        case "edu-support":
          lines.push("✓ EDU Support: Mon–Fri. IN 06:00–10:30, OUT 11:31–16:00. Fixed monthly salary.")
          break
        case "english":
          lines.push("✓ English Madrasa: Friday. IN 14:00–17:00, OUT 17:01–22:00. 150 AED/day.")
          break
        case "cibis":
          lines.push("✓ CIBIS: Friday evenings. First punch = IN, second = OUT.")
          break
      }
      if (dualProgram === "english") {
        lines.push("✓ Dual: +English Madrasa (Friday). IN 14:00–17:00, OUT 17:01–22:00. 150 AED/day.")
      }
      if (dualProgram === "cibis") {
        lines.push("✓ Dual: +CIBIS (Friday evenings). First punch = IN, second = OUT.")
      }
    } else {
      switch (nonTeachingRole) {
        case "office":
          lines.push("✓ Office Staff: Mon–Thu & Sat/Sun. Session 1 before 15:00, Session 2 after. Monthly salary.")
          break
        case "cleaning":
          lines.push("✓ Cleaning Staff: Any day, any time.")
          break
        case "driver":
          lines.push(`✓ Driver: Any day, any time. ${dailyRate || "—"} AED/day.`)
          break
      }
    }

    lines.push(`Login: ${email.trim() || "email"} / Password: Change@123 (staff must change on first login)`)
    return lines
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="size-4" />
          Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white">Staff Onboarding</h1>
        <p className="mt-1 text-muted-foreground">
          Add new staff members and manage account setup.
        </p>
      </motion.div>

      {/* ── PRIMARY: Add New Staff Member ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="size-5 text-gold-500" />
            Add New Staff Member
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddStaff} className="space-y-5">
            {/* Staff Type Toggle */}
            <div>
              <label className="block text-sm font-medium text-navy-700 dark:text-navy-200 mb-2">
                Staff Type <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                {(["teaching", "non-teaching"] as StaffType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setStaffType(type)
                      setResult(null)
                      setSelectedClasses([])
                      if (type === "non-teaching") {
                        setMonthlyRate("2000")
                        setDailyRate("")
                      }
                    }}
                    className={cn(
                      "px-4 py-2 rounded-full text-sm font-medium border transition-colors",
                      staffType === type
                        ? "bg-gold-500 border-gold-500 text-navy-950"
                        : "border-border text-muted-foreground hover:border-gold-400"
                    )}
                  >
                    {type === "teaching" ? "Teaching Staff" : "Non-Teaching Staff"}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Green banner: Existing roster record found ──────────────────── */}
            {existingTeacherId && matchedTeacher && !greenBannerDismissed && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start justify-between gap-3 rounded-lg bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/25 px-4 py-3"
              >
                <div className="flex items-start gap-2 text-green-800 dark:text-green-300 text-sm">
                  <CheckCircle className="size-4 shrink-0 mt-0.5 text-green-600 dark:text-green-400" />
                  <div>
                    <span className="font-semibold">Existing roster record found — fill in missing fields.</span>
                    <br />
                    <span className="text-green-700 dark:text-green-400">
                      Matched: <span className="font-medium">{matchedTeacher.name}</span>
                      {" "}(ID: <span className="font-mono">{existingTeacherId}</span>)
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setGreenBannerDismissed(true)}
                  className="shrink-0 text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="size-4" />
                </button>
              </motion.div>
            )}

            {/* ── Yellow suggestion banner: name match ───────────────────────── */}
            {nameSuggestion && !existingTeacherId && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 px-4 py-3"
              >
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-sm">
                  <AlertCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>
                    Did you mean{" "}
                    <span className="font-semibold">{nameSuggestion.name}</span>?
                    {" "}(ID: {nameSuggestion.zkId}) —{" "}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setFingerprintId(String(nameSuggestion.zkId))
                      loadTeacher(nameSuggestion.teacherId)
                    }}
                    className="underline font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
                  >
                    click to load
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setNameSuggestion(null)}
                  className="shrink-0 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition-colors"
                  aria-label="Dismiss suggestion"
                >
                  <X className="size-4" />
                </button>
              </motion.div>
            )}

            {/* Common Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-navy-700 dark:text-navy-200 mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    scheduleNameLookup(e.target.value)
                  }}
                  placeholder="e.g. Ahmed Ali"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 dark:text-navy-200 mb-1">
                  Email ID <span className="text-red-500">*</span>
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. name@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 dark:text-navy-200 mb-1">
                  Phone Number
                </label>
                <Input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. +91 90000 00000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-navy-700 dark:text-navy-200 mb-1">
                  Fingerprint Device ID <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Fingerprint className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    type="number"
                    min={1}
                    value={fingerprintId}
                    onChange={(e) => {
                      setFingerprintId(e.target.value)
                      lookupByFingerprint(e.target.value)
                    }}
                    placeholder="e.g. 47"
                    className="pl-9"
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  ZKTeco device user ID. System ID will be{" "}
                  <span className="font-mono font-semibold">
                    t{fingerprintId || "…"}
                  </span>
                </p>
              </div>
            </div>

            {/* Teaching Section */}
            {staffType === "teaching" && (
              <div className="rounded-lg border border-border p-4 space-y-4">
                <p className="text-sm font-semibold text-navy-700 dark:text-navy-200">Teaching Details</p>

                {/* Primary Program */}
                <div>
                  <label className="block text-sm font-medium text-navy-700 dark:text-navy-200 mb-1">
                    Primary Program <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={teachingProgram}
                    onChange={(e) => handleTeachingProgramChange(e.target.value as TeachingProgram)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="madrasa">Ihlamudheen Madrasa (60 AED/session — Sat & Sun)</option>
                    <option value="edu-support">EDU Support (1,500 AED/month — Mon–Fri)</option>
                    <option value="english">English Madrasa (150 AED/day — Friday)</option>
                    <option value="cibis">CIBIS (Friday evenings)</option>
                  </select>
                </div>

                {/* Dual Program */}
                <div>
                  <label className="block text-sm font-medium text-navy-700 dark:text-navy-200 mb-1">
                    Dual Program
                  </label>
                  <select
                    value={dualProgram}
                    onChange={(e) => setDualProgram(e.target.value as DualProgram)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {dualOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Monthly Rate (EDU Support only) */}
                {teachingProgram === "edu-support" && (
                  <div>
                    <label className="block text-sm font-medium text-navy-700 dark:text-navy-200 mb-1">
                      Monthly Rate (AED) <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="number"
                      value={monthlyRate}
                      onChange={(e) => setMonthlyRate(e.target.value)}
                      placeholder="1500"
                    />
                  </div>
                )}

                {/* Transport Allowance */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={transportAllowance}
                    onChange={(e) => setTransportAllowance(e.target.checked)}
                    className="rounded border-input size-4"
                  />
                  <span className="text-sm text-navy-700 dark:text-navy-200">Transport Allowance</span>
                </label>

                {/* Assigned Classes (Ihlamudheen only) */}
                {showClassGrid && (
                  <div>
                    <label className="block text-sm font-medium text-navy-700 dark:text-navy-200 mb-2">
                      Assigned Classes
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {madrasaCourseClasses.map((cls) => {
                        const checked = selectedClasses.includes(cls.id)
                        return (
                          <button
                            key={cls.id}
                            type="button"
                            onClick={() => toggleClass(cls.id)}
                            className={cn(
                              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                              checked
                                ? "bg-gold-500 border-gold-500 text-navy-950"
                                : "border-border text-muted-foreground hover:border-gold-400"
                            )}
                          >
                            {cls.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Non-Teaching Section */}
            {staffType === "non-teaching" && (
              <div className="rounded-lg border border-border p-4 space-y-4">
                <p className="text-sm font-semibold text-navy-700 dark:text-navy-200">Non-Teaching Details</p>

                {/* Role */}
                <div>
                  <label className="block text-sm font-medium text-navy-700 dark:text-navy-200 mb-1">
                    Role <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={nonTeachingRole}
                    onChange={(e) => handleNonTeachingRoleChange(e.target.value as NonTeachingRole)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="office">Office Staff (monthly — Mon–Thu + Sat/Sun)</option>
                    <option value="cleaning">Cleaning Staff (monthly — any day/time)</option>
                    <option value="driver">Driver (daily rate — any day/time)</option>
                  </select>
                </div>

                {/* Monthly Salary (office or cleaning) */}
                {(nonTeachingRole === "office" || nonTeachingRole === "cleaning") && (
                  <div>
                    <label className="block text-sm font-medium text-navy-700 dark:text-navy-200 mb-1">
                      Monthly Salary (AED) <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="number"
                      value={monthlyRate}
                      onChange={(e) => setMonthlyRate(e.target.value)}
                      placeholder={nonTeachingRole === "office" ? "2000" : "400"}
                    />
                  </div>
                )}

                {/* Daily Rate (driver) */}
                {nonTeachingRole === "driver" && (
                  <div>
                    <label className="block text-sm font-medium text-navy-700 dark:text-navy-200 mb-1">
                      Daily Rate (AED) <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="number"
                      value={dailyRate}
                      onChange={(e) => setDailyRate(e.target.value)}
                      placeholder="30"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Punch Rules Info Box */}
            <div className="rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 p-4 text-sm space-y-1">
              {getPunchRulesText().map((line, i) => (
                <p key={i} className={cn(
                  i < getPunchRulesText().length - 1
                    ? "text-blue-800 dark:text-blue-300"
                    : "text-blue-600 dark:text-blue-400 text-xs mt-2 pt-2 border-t border-blue-200 dark:border-blue-500/20"
                )}>
                  {line}
                </p>
              ))}
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-12 bg-gold-500 text-navy-950 hover:bg-gold-600 font-semibold"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {existingTeacherId ? "Updating account..." : "Creating account..."}
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 size-4" />
                  {existingTeacherId ? "Update & Activate Staff" : "Create Account & Activate Staff"}
                </>
              )}
            </Button>

            {/* Result Display */}
            {result && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3"
              >
                {result.success ? (
                  <>
                    <div className="rounded-lg bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 p-4">
                      <div className="flex items-center gap-2 text-green-700 dark:text-green-400 mb-1">
                        <CheckCircle className="size-5 shrink-0" />
                        <p className="font-semibold">Staff member added successfully!</p>
                      </div>
                      <p className="text-sm text-green-600 dark:text-green-300 ml-7">
                        System ID: <span className="font-mono font-bold">{result.teacherId}</span>
                      </p>
                    </div>

                    <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-4 text-sm">
                      <p className="font-semibold text-amber-800 dark:text-amber-400 mb-2">Next Steps</p>
                      <ol className="list-decimal list-inside space-y-1.5 text-amber-700 dark:text-amber-300">
                        <li>
                          Enroll fingerprint on ZKTeco device with User ID:{" "}
                          <span className="font-mono font-bold">{fingerprintId}</span>
                        </li>
                        <li>
                          Share credentials privately:{" "}
                          <span className="font-mono">{email}</span> / Change@123
                        </li>
                        <li>Ask them to change password on first login via Profile page</li>
                      </ol>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-4">
                    <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                      <XCircle className="size-5 shrink-0" />
                      <p className="text-sm font-medium">{result.error}</p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* ── SECONDARY: Batch Bootstrap (collapsible) ──────────────────────────── */}
      <Card>
        <button
          type="button"
          className="w-full text-left"
          onClick={() => setBatchOpen((prev) => !prev)}
        >
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserPlus className="size-4 text-muted-foreground" />
                Batch Bootstrap (Initial Setup)
              </CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Create all pre-configured accounts at once
              </p>
            </div>
            {batchOpen ? (
              <ChevronDown className="size-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground shrink-0" />
            )}
          </CardHeader>
        </button>

        {batchOpen && (
          <CardContent className="space-y-4 pt-0">
            <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-4 text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-400 mb-2">Before running:</p>
              <ul className="list-disc list-inside space-y-1 text-amber-700 dark:text-amber-300">
                <li>
                  Add{" "}
                  <code className="bg-amber-100 dark:bg-amber-500/20 px-1 rounded">
                    SUPABASE_SERVICE_ROLE_KEY=your_key
                  </code>{" "}
                  to{" "}
                  <code className="bg-amber-100 dark:bg-amber-500/20 px-1 rounded">.env.local</code>
                </li>
                <li>Find this key in Supabase Dashboard → Settings → API → service_role (secret)</li>
                <li>Restart the dev server after adding the key</li>
                <li>
                  A one-time password is issued server-side and shared privately with each teacher —
                  they must change it on first login.
                </li>
              </ul>
            </div>

            <div className="rounded-lg border p-4 space-y-4">
              {/* Admin */}
              <div>
                <h3 className="font-medium text-sm mb-2 text-navy-700 dark:text-navy-200">1 Admin Account:</h3>
                <div className="flex items-center gap-1.5 text-sm">
                  <div className="size-2 rounded-full bg-red-500" />
                  <span className="text-navy-600 dark:text-navy-300 font-medium">Administrator</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400">
                    Admin
                  </span>
                </div>
              </div>
              {/* Teachers */}
              <div>
                <h3 className="font-medium text-sm mb-2 text-navy-700 dark:text-navy-200">Teacher Accounts:</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                  {([] as string[]).map((n) => (
                    <div key={n} className="flex items-center gap-1.5">
                      <div className="size-2 rounded-full bg-gold-500" />
                      <span className="text-navy-600 dark:text-navy-300">{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <Button
              onClick={handleSetup}
              disabled={running}
              className="w-full bg-gold-500 text-navy-950 hover:bg-gold-600 font-semibold"
            >
              {running ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Creating accounts...
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 size-4" />
                  Create All Accounts (1 Admin + 19 Teachers)
                </>
              )}
            </Button>

            {batchError && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-4"
              >
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                  <XCircle className="size-5 shrink-0" />
                  <p className="text-sm font-medium">{batchError}</p>
                </div>
              </motion.div>
            )}

            {batchResponse && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-green-50 dark:bg-green-500/10 p-3 text-center">
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {batchResponse.summary.created}
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-300">Created</p>
                  </div>
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-500/10 p-3 text-center">
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                      {batchResponse.summary.existing}
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-300">Already Exist</p>
                  </div>
                  <div className="rounded-lg bg-red-50 dark:bg-red-500/10 p-3 text-center">
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                      {batchResponse.summary.errors}
                    </p>
                    <p className="text-xs text-red-700 dark:text-red-300">Errors</p>
                  </div>
                </div>

                <div className="rounded-lg border divide-y">
                  {batchResponse.results.map((r) => (
                    <div key={r.name} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-navy-700 dark:text-navy-200">{r.name}</span>
                        <span
                          className={cn(
                            "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full",
                            r.role === "admin"
                              ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"
                          )}
                        >
                          {r.role}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {r.status === "created" && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400">
                            <CheckCircle className="size-3" /> Created
                          </span>
                        )}
                        {r.status === "exists" && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                            <AlertCircle className="size-3" /> Exists
                          </span>
                        )}
                        {r.status === "error" && (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"
                            title={r.message}
                          >
                            <XCircle className="size-3" /> Error
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}
