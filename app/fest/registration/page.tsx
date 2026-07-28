"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, UserCog, UserPlus, ExternalLink, Trash2, Search, Download, ChevronDown, FileText } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { compareNatural } from "@/lib/utils"
import { addFestStudent, type NewStudentInput } from "@/lib/fest/add-student"
import { searchStudents, studentCourseId, type StudentSuggestion, type ClassInfo } from "@/lib/fest/student-lookup"
import { FEST_COURSES, courseTitle } from "@/lib/fest/courses"

interface EditionOpt { id: string; name: string; courseId: string | null; academicYear: string | null }
interface SectionOpt { id: string; name: string; grade: number | null }
interface HouseOpt { id: string; name: string }
interface CategoryOpt { id: string; name: string; minGrade: number | null; maxGrade: number | null }
interface ItemOpt { id: string; name: string; type: "individual" | "group" }
interface RosterRow {
  seId: string
  studentId: string
  regNo: string
  name: string
  codeNo: string | null
  sectionId: string | null
  sectionName: string | null
  itemIds: string[]
}

const NEW_SECTION = "__new__"

interface AddForm {
  regNo: string
  name: string
  nameMl: string
  gender: "male" | "female" | ""
  parentName: string
  parentMobile: string
  grade: string
  sectionChoice: string   // section id, or NEW_SECTION
  newSectionName: string
  houseId: string
  programIds: Set<string>
}

function emptyForm(sectionChoice: string): AddForm {
  return {
    regNo: "", name: "", nameMl: "", gender: "", parentName: "", parentMobile: "",
    grade: "", sectionChoice, newSectionName: "", houseId: "", programIds: new Set(),
  }
}

export default function FestRegistrationPage() {
  const [editions, setEditions] = useState<EditionOpt[]>([])
  const [editionId, setEditionId] = useState("")           // derived from course + year
  const [courseId, setCourseId] = useState("")
  const [academicYear, setAcademicYear] = useState("")
  const [sections, setSections] = useState<SectionOpt[]>([])
  const [sectionId, setSectionId] = useState("")
  const [houses, setHouses] = useState<HouseOpt[]>([])
  const [categories, setCategories] = useState<CategoryOpt[]>([])
  const [items, setItems] = useState<ItemOpt[]>([])
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")

  // manage-items dialog (existing student)
  const [editing, setEditing] = useState<RosterRow | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  // add-student dialog (new student + their selected programs)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<AddForm>(emptyForm(""))
  const [creating, setCreating] = useState(false)

  // Enrolled-student count per edition, so we default the pickers onto the
  // course/year with the BIGGEST roster (not just any year with a stray entry).
  const [editionCount, setEditionCount] = useState<Map<string, number>>(new Map())

  // Autocomplete from the existing Ihlamudheen roll while typing reg / name.
  const [classInfoById, setClassInfoById] = useState<Map<string, ClassInfo>>(new Map())
  const [suggestions, setSuggestions] = useState<StudentSuggestion[]>([])
  const [activeField, setActiveField] = useState<"reg" | "name" | null>(null)

  const itemName = useMemo(() => new Map(items.map((i) => [i.id, i.name])), [items])

  // Roster filtered by the search box (reg / name / code / section).
  const shownRoster = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return roster
    return roster.filter((r) =>
      r.regNo.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      (r.codeNo ?? "").toLowerCase().includes(q) ||
      (r.sectionName ?? "").toLowerCase().includes(q))
  }, [roster, query])

  // Roster subset for an export category (the "code" is the register number).
  type ExportKind = "all" | "noProgram" | "flagged"
  function rosterFor(kind: ExportKind): { rows: RosterRow[]; suffix: string; label: string } {
    if (kind === "noProgram") return { rows: roster.filter((r) => r.itemIds.length === 0), suffix: "no-program", label: "No program selected" }
    if (kind === "flagged") return { rows: roster.filter((r) => !r.sectionName || r.itemIds.length === 0), suffix: "needs-attention", label: "Needs attention" }
    return { rows: roster, suffix: "participants", label: "All participants" }
  }
  const programsOf = (r: RosterRow) => r.itemIds.map((id) => itemName.get(id) ?? "").filter(Boolean).join("; ")
  const fileBase = (suffix: string) =>
    `${courseOpts.find((c) => c.id === courseId)?.title ?? "fest"} ${academicYear} — ${suffix}`.replace(/\s+/g, "-")

  // Deliver a file: native share sheet on mobile (iOS blocks programmatic
  // downloads), anchor download on desktop / as a fallback.
  async function saveBlob(filename: string, blob: Blob) {
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean; share?: (d: unknown) => Promise<void> }
    try {
      const file = new File([blob], filename, { type: blob.type })
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        try { await nav.share({ files: [file], title: filename }); return }
        catch (err) { if ((err as Error).name === "AbortError") return /* cancelled */ }
      }
    } catch { /* File/share unsupported — fall through */ }
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = filename; a.rel = "noopener"
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  async function exportRoster(kind: ExportKind, format: "csv" | "pdf") {
    const { rows, suffix, label } = rosterFor(kind)
    if (rows.length === 0) { toast.info("No students in that category."); return }
    try {
      if (format === "csv") {
        const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
        const lines = [["Reg / Code", "Name", "Section", "Programs", "Program count"].join(",")]
        for (const r of rows) {
          lines.push([r.regNo, r.name.trim(), r.sectionName ?? "", programsOf(r), String(r.itemIds.length)].map(esc).join(","))
        }
        const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
        await saveBlob(`${fileBase(suffix)}.csv`, blob)
      } else {
        // jsPDF's *named* export is the constructor in every build; the default
        // export is not always a constructor in the browser bundle.
        const [jspdf, autotable, { addReportHeader }] = await Promise.all([
          import("jspdf"), import("jspdf-autotable"), import("@/lib/branding"),
        ])
        const JsPDF = jspdf.jsPDF ?? (jspdf as unknown as { default: typeof jspdf.jsPDF }).default
        const autoTable = (autotable as unknown as { default: (doc: unknown, opts: unknown) => void }).default
          ?? (autotable as unknown as { autoTable: (doc: unknown, opts: unknown) => void }).autoTable
        const doc = new JsPDF({ unit: "mm", format: "a4" })
        const courseName = courseOpts.find((c) => c.id === courseId)?.title ?? "Fest"
        const startY = await addReportHeader(doc, "Meelad Fest — Participants", `${courseName} · ${academicYear} · ${label} (${rows.length})`)
        autoTable(doc, {
          startY,
          head: [["#", "Reg / Code", "Name", "Section", "Programs"]],
          body: rows.map((r, i) => [String(i + 1), r.regNo, r.name.trim(), r.sectionName ?? "—", programsOf(r) || "—"]),
          styles: { fontSize: 8, cellPadding: 2.5, lineColor: [220, 225, 235], lineWidth: 0.2, overflow: "linebreak" },
          headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: "bold", fontSize: 8 },
          alternateRowStyles: { fillColor: [248, 250, 254] },
          columnStyles: { 0: { cellWidth: 10, halign: "center" }, 1: { cellWidth: 24 }, 2: { cellWidth: 50 }, 3: { cellWidth: 26 } },
        })
        await saveBlob(`${fileBase(suffix)}.pdf`, doc.output("blob") as Blob)
      }
      toast.success(`Exported ${rows.length} student(s) as ${format.toUpperCase()}`)
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`)
    }
  }
  const setF = useCallback(
    <K extends keyof AddForm>(k: K, v: AddForm[K]) => setForm((p) => ({ ...p, [k]: v })),
    [],
  )

  // Once the user picks a course/year we stop auto-defaulting.
  const userTouched = useRef(false)
  const [dataReady, setDataReady] = useState(false)
  // The single year open for data entry; other years are view-only archives.
  const [currentYear, setCurrentYear] = useState<string>("")

  useEffect(() => {
    supabase
      .from("fest_editions").select("id,name,course_id,academic_year").neq("status", "archived")
      .order("academic_year", { ascending: false })
      .then(({ data }) => {
        const opts = ((data ?? []) as Array<{ id: string; name: string; course_id: string | null; academic_year: string | null }>)
          .map((e) => ({ id: e.id, name: e.name, courseId: e.course_id, academicYear: e.academic_year }))
        setEditions(opts)
      })
    // How many students each edition holds — so we can land on the biggest roster.
    supabase.from("fest_student_editions").select("edition_id").then(({ data }) => {
      const counts = new Map<string, number>()
      for (const r of (data ?? []) as Array<{ edition_id: string }>) {
        counts.set(r.edition_id, (counts.get(r.edition_id) ?? 0) + 1)
      }
      setEditionCount(counts)
      setDataReady(true)
    })
    // The year that is open for entry (others are frozen, view-only).
    supabase.from("app_settings").select("value").eq("key", "fest_current_academic_year").maybeSingle()
      .then(({ data }) => setCurrentYear((data as { value: string } | null)?.value ?? ""))
  }, [])

  // Entry is allowed only on the current academic year.
  const frozen = currentYear !== "" && academicYear !== "" && academicYear !== currentYear

  // Courses that have at least one fest.
  const courseOpts = useMemo(
    () => FEST_COURSES.filter((c) => editions.some((e) => e.courseId === c.id)),
    [editions],
  )
  // Academic years available for the picked course (latest first).
  const yearOpts = useMemo(
    () => Array.from(new Set(
      editions.filter((e) => e.courseId === courseId).map((e) => e.academicYear).filter(Boolean) as string[],
    )).sort((a, b) => b.localeCompare(a)),
    [editions, courseId],
  )

  // The course's year with the most enrolled students, else its latest year.
  const bestYearForCourse = useCallback((cid: string): string => {
    const courseEds = editions.filter((e) => e.courseId === cid)
    const top = courseEds
      .filter((e) => (editionCount.get(e.id) ?? 0) > 0)
      .sort((a, b) => (editionCount.get(b.id) ?? 0) - (editionCount.get(a.id) ?? 0))[0]
    if (top) return top.academicYear ?? ""
    const ys = Array.from(new Set(courseEds.map((e) => e.academicYear).filter(Boolean) as string[]))
      .sort((a, b) => b.localeCompare(a))
    return ys[0] ?? ""
  }, [editions, editionCount])

  // Auto-pick the course + year with the BIGGEST roster — but only after the
  // student-count query has resolved, and only until the user picks something.
  // This lands you on your imported/active list, not an empty future year or a
  // year that happens to hold a single stray entry.
  useEffect(() => {
    if (userTouched.current || !dataReady || editions.length === 0) return
    const top = editions
      .filter((e) => e.courseId && (editionCount.get(e.id) ?? 0) > 0)
      .sort((a, b) => (editionCount.get(b.id) ?? 0) - (editionCount.get(a.id) ?? 0))[0]
    let cid: string
    let year: string
    if (top) {
      cid = top.courseId as string
      year = top.academicYear ?? ""
    } else {
      cid = FEST_COURSES.find((x) => editions.some((e) => e.courseId === x.id))?.id ?? ""
      const ys = Array.from(new Set(
        editions.filter((e) => e.courseId === cid).map((e) => e.academicYear).filter(Boolean) as string[],
      )).sort((a, b) => b.localeCompare(a))
      year = ys[0] ?? ""
    }
    // Prefer the entry-open year when that course has it.
    if (currentYear && editions.some((e) => e.courseId === cid && e.academicYear === currentYear)) {
      year = currentYear
    }
    setCourseId(cid)
    setAcademicYear(year)
  }, [dataReady, editions, editionCount, currentYear])

  function changeCourse(v: string) {
    userTouched.current = true
    setCourseId(v)
    setAcademicYear(bestYearForCourse(v))
  }
  function changeYear(v: string) {
    userTouched.current = true
    setAcademicYear(v)
  }

  // The edition is whichever (course, year) the pickers resolve to.
  useEffect(() => {
    const ed = editions.find((e) => e.courseId === courseId && e.academicYear === academicYear)
    setEditionId(ed?.id ?? "")
  }, [editions, courseId, academicYear])

  // All global sections + this edition's houses, categories, and item catalog.
  useEffect(() => {
    if (!editionId) return
    void (async () => {
      const [{ data: secs }, { data: hs }, { data: cats }, { data: its }] = await Promise.all([
        supabase.from("fest_sections").select("id,name,grade").order("sort_order").order("name"),
        supabase.from("fest_houses").select("id,name").eq("edition_id", editionId).order("sort_order"),
        supabase.from("fest_categories").select("id,name,min_grade,max_grade").eq("edition_id", editionId).order("sort_order"),
        supabase.from("fest_items").select("id,name,type").eq("edition_id", editionId).order("name"),
      ])
      const sectionOpts = ((secs ?? []) as Array<{ id: string; name: string; grade: number | null }>)
        .map((s) => ({ id: s.id, name: s.name, grade: s.grade }))
        .sort((a, b) => compareNatural(a.name, b.name))
      setSections(sectionOpts)
      setSectionId((cur) => (sectionOpts.some((s) => s.id === cur) ? cur : sectionOpts[0]?.id ?? ""))
      setHouses((hs ?? []) as HouseOpt[])
      setCategories(((cats ?? []) as Array<{ id: string; name: string; min_grade: number | null; max_grade: number | null }>)
        .map((c) => ({ id: c.id, name: c.name, minGrade: c.min_grade, maxGrade: c.max_grade })))
      setItems((its ?? []) as ItemOpt[])
    })()
  }, [editionId])

  const loadRoster = useCallback(async (eid: string) => {
    if (!eid) { setRoster([]); return }
    setLoading(true)
    const { data: se } = await supabase
      .from("fest_student_editions")
      .select("id, code_no, section_id, section:fest_sections(name), student:fest_students(id,reg_no,name)")
      .eq("edition_id", eid)
    const rows = (se ?? []) as unknown as Array<{ id: string; code_no: string | null; section_id: string | null; section: { name: string } | null; student: { id: string; reg_no: string; name: string } | null }>
    const studentIds = rows.map((r) => r.student?.id).filter(Boolean) as string[]

    const regByStudent = new Map<string, string[]>()
    if (studentIds.length) {
      const { data: regs } = await supabase
        .from("fest_registrations")
        .select("student_id,item_id")
        .eq("edition_id", eid).in("student_id", studentIds)
      for (const r of (regs ?? []) as Array<{ student_id: string; item_id: string }>) {
        const list = regByStudent.get(r.student_id) ?? []
        list.push(r.item_id)
        regByStudent.set(r.student_id, list)
      }
    }

    setRoster(
      rows
        .filter((r) => r.student)
        .map((r) => ({
          seId: r.id,
          studentId: r.student!.id,
          regNo: r.student!.reg_no,
          name: r.student!.name,
          codeNo: r.code_no,
          sectionId: r.section_id,
          sectionName: r.section?.name ?? null,
          itemIds: regByStudent.get(r.student!.id) ?? [],
        }))
        .sort((a, b) => compareNatural(a.sectionName, b.sectionName) || a.name.localeCompare(b.name)),
    )
    setLoading(false)
  }, [])

  useEffect(() => { void loadRoster(editionId) }, [editionId, loadRoster])

  function manage(row: RosterRow) {
    setEditing(row)
    setChecked(new Set(row.itemIds))
  }

  function toggle(setter: typeof setChecked, itemId: string) {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  // Remove a student from THIS edition only (drops their enrolment + program
  // registrations for this fest; the lifetime student record is untouched).
  async function removeFromRoster(row: RosterRow) {
    if (!window.confirm(`Remove ${row.name.trim()} from this fest? Their program registrations here will be deleted.`)) return
    try {
      const { error: regErr } = await supabase
        .from("fest_registrations")
        .delete().eq("edition_id", editionId).eq("student_id", row.studentId)
      if (regErr) throw new Error(regErr.message)
      const { error: seErr } = await supabase
        .from("fest_student_editions")
        .delete().eq("edition_id", editionId).eq("student_id", row.studentId)
      if (seErr) throw new Error(seErr.message)
      toast.success(`Removed ${row.name.trim()}`)
      void loadRoster(editionId)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    const before = new Set(editing.itemIds)
    const after = checked
    const toAdd = items.filter((i) => after.has(i.id) && !before.has(i.id))
    const toRemove = Array.from(before).filter((id) => !after.has(id))

    try {
      if (toRemove.length) {
        const { error } = await supabase
          .from("fest_registrations")
          .delete()
          .eq("edition_id", editionId)
          .eq("student_id", editing.studentId)
          .in("item_id", toRemove)
        if (error) throw new Error(error.message)
      }
      if (toAdd.length) {
        const rows = toAdd.map((i) => ({
          edition_id: editionId,
          item_id: i.id,
          student_id: editing.studentId,
          is_group: i.type === "group",
          section_id: editing.sectionId,
        }))
        const { error } = await supabase.from("fest_registrations").insert(rows)
        if (error) throw new Error(error.message.replace(/^.*fest: /, "Cap rule: "))
      }
      toast.success(`Saved ${editing.name.trim()}`)
      setEditing(null)
      void loadRoster(editionId)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Class id → { name, course }, so a Ihlamudheen student resolves to a section AND
  // we can keep a per-course fest to its own students.
  useEffect(() => {
    supabase.from("classes").select("id,name,course_id").then(({ data }) => {
      setClassInfoById(new Map(((data ?? []) as Array<{ id: string; name: string; course_id: string | null }>)
        .map((c) => [c.id, { name: c.name, courseId: c.course_id }])))
    })
  }, [])

  // Debounced typeahead against the existing roll, restricted to this course.
  useEffect(() => {
    if (!adding || !activeField) { setSuggestions([]); return }
    const q = activeField === "reg" ? form.regNo : form.name
    if (q.trim().length < 2) { setSuggestions([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      const res = await searchStudents(supabase, q, classInfoById, { restrictCourseId: courseId || undefined })
      if (!cancelled) setSuggestions(res)
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [adding, activeField, form.regNo, form.name, classInfoById, courseId])

  function openAdd() {
    setForm(emptyForm(sectionId || (sections[0]?.id ?? "")))
    setSuggestions([])
    setActiveField(null)
    setAdding(true)
  }

  // Fill the form from a picked student; resolve their section (match an
  // existing fest section by name, else queue a new one to be created on save).
  function pickSuggestion(s: StudentSuggestion) {
    setForm((p) => {
      let sectionChoice = p.sectionChoice
      let newSectionName = p.newSectionName
      if (s.sectionName) {
        const match = sections.find((sec) => sec.name.toLowerCase() === s.sectionName!.toLowerCase())
        if (match) { sectionChoice = match.id; newSectionName = "" }
        else { sectionChoice = NEW_SECTION; newSectionName = s.sectionName }
      }
      return {
        ...p,
        regNo: s.regNo || p.regNo,
        name: s.name || p.name,
        gender: s.gender || p.gender,
        parentName: s.parentName || p.parentName,
        parentMobile: s.parentMobile || p.parentMobile,
        grade: s.grade != null ? String(s.grade) : p.grade,
        sectionChoice,
        newSectionName,
      }
    })
    setSuggestions([])
    setActiveField(null)
  }

  function toggleProgram(itemId: string) {
    setForm((p) => {
      const next = new Set(p.programIds)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return { ...p, programIds: next }
    })
  }

  /** Match a grade to a configured category band, for the per-edition snapshot. */
  function deriveCategory(grade: number | null): string | null {
    if (grade == null) return null
    return (
      categories.find(
        (c) => (c.minGrade == null || grade >= c.minGrade) && (c.maxGrade == null || grade <= c.maxGrade),
      )?.id ?? null
    )
  }

  async function createStudent() {
    if (frozen) { toast.error(`Entry is open only for the current year${currentYear ? ` (${currentYear})` : ""}.`); return }
    setCreating(true)
    try {
      // A per-course fest enrols only its own students: block a register
      // number that belongs to a different course on the Ihlamudheen roll. Brand-new
      // students (not on the roll) carry no course and are allowed.
      if (courseId) {
        const theirCourse = await studentCourseId(supabase, form.regNo, classInfoById)
        if (theirCourse && theirCourse !== courseId) {
          throw new Error(
            `Reg ${form.regNo.trim()} belongs to ${courseTitle(theirCourse)} — add them under that course's fest, not ${courseTitle(courseId)}.`,
          )
        }
      }

      const grade = form.grade.trim() === "" ? null : Number(form.grade)

      // Resolve the section — create a new global section on the fly if asked.
      let targetSectionId = form.sectionChoice
      if (form.sectionChoice === NEW_SECTION) {
        const name = form.newSectionName.trim()
        if (!name) throw new Error("Enter a name for the new section.")
        const { error: upErr } = await supabase
          .from("fest_sections")
          .upsert({ name, grade }, { onConflict: "name" })
        if (upErr) throw new Error(`section: ${upErr.message}`)
        const { data: sec, error: selErr } = await supabase
          .from("fest_sections").select("id,name,grade").eq("name", name).single()
        if (selErr || !sec) throw new Error(selErr?.message ?? "Could not create the section.")
        targetSectionId = sec.id
        setSections((prev) =>
          prev.some((s) => s.id === sec.id) ? prev : [...prev, { id: sec.id, name: sec.name, grade: sec.grade }])
      }

      const input: NewStudentInput = {
        regNo: form.regNo,
        name: form.name,
        nameMl: form.nameMl,
        gender: form.gender,
        parentName: form.parentName,
        parentMobile: form.parentMobile,
        grade,
        sectionId: targetSectionId,
        houseId: form.houseId || null,
        categoryId: deriveCategory(grade),
      }

      const { studentId } = await addFestStudent(supabase, editionId, input)

      // Register the programs the student selected (skip cap/duplicate failures
      // gracefully so a valid student is never lost over one bad item).
      const chosen = items.filter((i) => form.programIds.has(i.id))
      if (chosen.length) {
        const rows = chosen.map((i) => ({
          edition_id: editionId,
          item_id: i.id,
          student_id: studentId,
          is_group: i.type === "group",
          section_id: targetSectionId,
        }))
        const { error } = await supabase.from("fest_registrations").insert(rows)
        if (error) {
          toast.warning(`Student saved, but programs were not all added: ${error.message.replace(/^.*fest: /, "")}`)
        }
      }

      toast.success(`Added ${form.name.trim()} · ${chosen.length} program(s)`)
      setAdding(false)
      void loadRoster(editionId)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const individual = items.filter((i) => i.type === "individual")
  const group = items.filter((i) => i.type === "group")
  const noItems = items.length === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/fest" className="text-navy-500 hover:text-navy-700 dark:text-navy-400">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-navy-800 dark:text-white">Registration</h1>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="w-full min-w-0 sm:w-64">
            <Label className="mb-1 block text-xs">Course</Label>
            <Select value={courseId} onValueChange={(v) => changeCourse(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Course">
                  {(v: string) => courseOpts.find((c) => c.id === v)?.title ?? "Course"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {courseOpts.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full min-w-0 sm:w-36">
            <Label className="mb-1 block text-xs">Academic year</Label>
            <Select value={academicYear} onValueChange={(v) => changeYear(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Year">
                  {(v: string) => v || "Year"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {yearOpts.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={openAdd} className="sm:ml-auto" disabled={frozen} title={frozen ? "This year is frozen" : undefined}>
            <UserPlus className="size-4" />Add student
          </Button>
          {frozen && (
            <p className="w-full text-sm text-amber-600">
              {academicYear} is a frozen archive — entry is open only for the current year
              {currentYear ? ` (${currentYear})` : ""}. Switch the Academic year to make changes.
            </p>
          )}
          {!frozen && noItems && (
            <p className="w-full text-sm text-amber-600">
              No programs in this edition yet — seed the <Link href="/fest/items" className="underline">item catalog</Link> first
              so students have programs to select.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between space-y-0">
          <CardTitle className="text-base">
            Roster {roster.length > 0 && <Badge variant="secondary">{shownRoster.length}{query ? ` / ${roster.length}` : ""}</Badge>}
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-navy-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search reg, name, section…"
                className="pl-8"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium transition-colors hover:bg-accent"
                disabled={roster.length === 0}
              >
                <Download className="size-4" /> Export <ChevronDown className="size-3.5 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[260px] p-1">
                <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-navy-400">CSV</div>
                <DropdownMenuItem onClick={() => exportRoster("all", "csv")} className="cursor-pointer py-2">
                  <FileText className="mr-2.5 size-4 shrink-0 text-emerald-500" /> All participants
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportRoster("noProgram", "csv")} className="cursor-pointer py-2">
                  <FileText className="mr-2.5 size-4 shrink-0 text-amber-500" /> No program selected
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportRoster("flagged", "csv")} className="cursor-pointer py-2">
                  <FileText className="mr-2.5 size-4 shrink-0 text-red-500" /> Needs attention
                </DropdownMenuItem>
                <div className="my-1 border-t border-border/60" />
                <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-navy-400">PDF</div>
                <DropdownMenuItem onClick={() => exportRoster("all", "pdf")} className="cursor-pointer py-2">
                  <FileText className="mr-2.5 size-4 shrink-0 text-emerald-500" /> All participants
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportRoster("noProgram", "pdf")} className="cursor-pointer py-2">
                  <FileText className="mr-2.5 size-4 shrink-0 text-amber-500" /> No program selected
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportRoster("flagged", "pdf")} className="cursor-pointer py-2">
                  <FileText className="mr-2.5 size-4 shrink-0 text-red-500" /> Needs attention
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-sm text-navy-500">Loading…</p>
          ) : roster.length === 0 ? (
            <p className="py-8 text-center text-sm text-navy-500">
              No students in this course&apos;s fest for {academicYear || "this year"} yet. Use <span className="font-medium">Add student</span> to enrol one and tick the programs they selected.
            </p>
          ) : shownRoster.length === 0 ? (
            <p className="py-8 text-center text-sm text-navy-500">No students match “{query}”.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reg / Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Section</TableHead>
                    <TableHead>Programs</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownRoster.map((r) => (
                    <TableRow key={r.seId}>
                      <TableCell className="font-mono text-xs">{r.regNo}</TableCell>
                      <TableCell className="font-medium">{r.name.trim()}</TableCell>
                      <TableCell className="text-sm text-navy-600 dark:text-navy-300">{r.sectionName ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.itemIds.length === 0
                            ? <span className="text-xs text-navy-400">—</span>
                            : r.itemIds.map((id) => (
                                <Badge key={id} variant="outline" className="text-[10px]">{itemName.get(id) ?? "?"}</Badge>
                              ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {!frozen && (
                          <Button variant="ghost" size="sm" onClick={() => manage(r)} title="Manage programs">
                            <UserCog className="size-4" />
                          </Button>
                        )}
                        <Link href={`/fest/students/${encodeURIComponent(r.regNo)}`}>
                          <Button variant="ghost" size="sm" title="Open profile"><ExternalLink className="size-4" /></Button>
                        </Link>
                        {!frozen && (
                          <Button
                            variant="ghost" size="sm" title="Remove from this fest"
                            className="text-red-500 hover:text-red-600"
                            onClick={() => removeFromRoster(r)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manage programs for an existing student */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.name.trim()} · programs</DialogTitle>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
            {noItems ? (
              <p className="text-sm text-amber-600">
                No programs in this fest yet — seed the <Link href="/fest/items" className="underline">item catalog</Link> first,
                then come back to tick the programs this student selected.
              </p>
            ) : (
              <>
                <ItemGroup title="Individual" items={individual} checked={checked} onToggle={(id) => toggle(setChecked, id)} />
                <ItemGroup title="Group" items={group} checked={checked} onToggle={(id) => toggle(setChecked, id)} />
              </>
            )}
          </div>
          <DialogFooter>
            <span className="mr-auto self-center text-xs text-navy-500">
              Cap: 4 individual + 2 group (enforced by the database)
            </span>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add a new student + the programs they selected */}
      <Dialog open={adding} onOpenChange={(o) => { if (!o) { setAdding(false); setActiveField(null); setSuggestions([]) } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add student</DialogTitle>
          </DialogHeader>
          <p className="-mt-1 text-xs text-navy-500">
            Start typing a register number or name to pull a student from the existing records —
            their details and section auto-fill. Or just fill the form for a new student.
          </p>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Register number *">
                <div>
                  <Input
                    inputMode="numeric" autoComplete="off" value={form.regNo}
                    placeholder="Type to search existing students…"
                    onFocus={() => setActiveField("reg")}
                    onChange={(e) => { setF("regNo", e.target.value); setActiveField("reg") }}
                  />
                  {activeField === "reg" && (
                    <SuggestionList items={suggestions} onPick={pickSuggestion} />
                  )}
                </div>
              </Field>
              <Field label="Name *">
                <div>
                  <Input
                    autoComplete="off" value={form.name}
                    placeholder="Type to search existing students…"
                    onFocus={() => setActiveField("name")}
                    onChange={(e) => { setF("name", e.target.value); setActiveField("name") }}
                  />
                  {activeField === "name" && (
                    <SuggestionList items={suggestions} onPick={pickSuggestion} />
                  )}
                </div>
              </Field>
              <Field label="Name (Malayalam)">
                <Input value={form.nameMl} onChange={(e) => setF("nameMl", e.target.value)} />
              </Field>
              <Field label="Sex *">
                <div className="flex gap-2">
                  {(["male", "female"] as const).map((g) => (
                    <Button
                      key={g}
                      type="button"
                      variant={form.gender === g ? "default" : "outline"}
                      size="sm"
                      className="flex-1 capitalize"
                      onClick={() => setF("gender", g)}
                    >
                      {g}
                    </Button>
                  ))}
                </div>
              </Field>
              <Field label="Parent / guardian name *">
                <Input value={form.parentName} onChange={(e) => setF("parentName", e.target.value)} />
              </Field>
              <Field label="Contact number">
                <Input inputMode="tel" value={form.parentMobile} onChange={(e) => setF("parentMobile", e.target.value)} />
              </Field>
              <Field label="Grade *">
                <Input inputMode="numeric" value={form.grade} onChange={(e) => setF("grade", e.target.value)} placeholder="e.g. 4" />
              </Field>
              <Field label="House">
                <Select value={form.houseId || undefined} onValueChange={(v) => setF("houseId", v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="— None —">
                      {(v: string) => houses.find((h) => h.id === v)?.name ?? "— None —"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {houses.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Section *">
                <Select value={form.sectionChoice} onValueChange={(v) => setF("sectionChoice", v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Section">
                      {(v: string) => v === NEW_SECTION ? "+ New section…" : (sections.find((s) => s.id === v)?.name ?? "Section")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    <SelectItem value={NEW_SECTION}>+ New section…</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.sectionChoice === NEW_SECTION && (
                <Field label="New section name *">
                  <Input value={form.newSectionName} onChange={(e) => setF("newSectionName", e.target.value)} placeholder="e.g. 4A" />
                </Field>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-500">
                Programs selected {form.programIds.size > 0 && <Badge variant="secondary">{form.programIds.size}</Badge>}
              </p>
              {noItems ? (
                <p className="text-sm text-amber-600">
                  No programs to choose from yet — seed the <Link href="/fest/items" className="underline">item catalog</Link> first.
                </p>
              ) : (
                <div className="space-y-3">
                  <ItemGroup title="Individual" items={individual} checked={form.programIds} onToggle={toggleProgram} />
                  <ItemGroup title="Group" items={group} checked={form.programIds} onToggle={toggleProgram} />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <span className="mr-auto self-center text-xs text-navy-500">
              Cap: 4 individual + 2 group (enforced by the database)
            </span>
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={createStudent} disabled={creating}>
              {creating && <Loader2 className="size-4 animate-spin" />}Save student
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block text-xs">{label}</Label>
      {children}
    </div>
  )
}

// Typeahead results for the reg / name fields. Rendered inline (in the form
// flow) rather than as an absolute popup so it is never clipped by the dialog's
// scroll container or hidden behind the mobile keyboard; onClick (not
// onMouseDown) so a tap registers reliably on touch devices.
function SuggestionList({
  items, onPick,
}: {
  items: StudentSuggestion[]
  onPick: (s: StudentSuggestion) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-popover shadow-sm">
      {items.map((s, i) => (
        <button
          key={`${s.regNo}-${i}`}
          type="button"
          onClick={() => onPick(s)}
          className="flex w-full items-center justify-between gap-2 border-b border-border/40 px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-accent active:bg-accent"
        >
          <span className="min-w-0 truncate">
            <span className="font-mono text-xs text-navy-500">{s.regNo || "—"}</span>
            <span className="mx-1 text-navy-300">·</span>
            {s.name || "(no name)"}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-navy-400">
            {s.sectionName ?? (s.source === "fest" ? "added before" : "")}
          </span>
        </button>
      ))}
    </div>
  )
}

function ItemGroup({
  title, items, checked, onToggle,
}: {
  title: string
  items: ItemOpt[]
  checked: Set<string>
  onToggle: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-500">{title}</p>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {items.map((i) => (
          <label key={i.id} className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 text-sm">
            <input type="checkbox" checked={checked.has(i.id)} onChange={() => onToggle(i.id)} className="size-4 accent-gold-500" />
            <span className="truncate">{i.name}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
