// Shared platform user management (add / edit / remove users, roles,
// password reset). Rendered by BOTH:
//   • /dashboard/user-mgmt  (school ERP)
//   • /admin/users          (Accounts portal)
// so both places offer exactly the same tool.
"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { motion } from "framer-motion"
import { UserCog, Search, Plus, Trash2, Edit2, Save, X, KeyRound, RefreshCw } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { authFetch } from "@/lib/api-client"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole, ROLE_BADGE_COLORS, ROLE_LABELS } from "@/lib/roles"
import type { UserRole } from "@/lib/roles"
import { initialTeachers } from "@/data/courses"

// A person the admin can pick from when adding a user, so existing details are
// not retyped. Sourced from current platform accounts + the teacher roster.
interface PersonSuggestion {
  key: string
  name: string
  email: string
  idNumber: string
  phone: string
  gender: "" | "male" | "female"
  role: UserRole
  exists: boolean        // already has a platform account
}

interface ManagedUser {
  id: string
  name: string
  email: string
  idNumber: string
  phone: string
  gender: string
  role: UserRole
  status: "active" | "inactive"
  joinDate: string
  lastLogin: string
}

export function UserManagement() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const isAdmin = role === "admin"
  // Roles an accountant is allowed to assign when creating a user (no admin).
  const assignableRoles: UserRole[] = isAdmin
    ? ["student", "teacher", "accountant", "admin"]
    : ["student", "teacher", "accountant"]

  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<UserRole>("student")
  const [showAddUser, setShowAddUser] = useState(false)
  const [newName, setNewName] = useState("")
  const [newIdNumber, setNewIdNumber] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [newGender, setNewGender] = useState<"" | "male" | "female">("")
  const [newRole, setNewRole] = useState<UserRole>("student")
  const [addError, setAddError] = useState<string | null>(null)
  // Autocomplete state for the add-user form.
  const [activeField, setActiveField] = useState<null | "name" | "id" | "email" | "phone">(null)
  const [dupNotice, setDupNotice] = useState<string | null>(null)
  const [resetPasswordId, setResetPasswordId] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState("")
  const [saving, setSaving] = useState(false)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch("/api/erp/users")
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Failed to load users")
      setUsers(json.users)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const filtered = users.filter((u) => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
    if (roleFilter === "all") return matchSearch
    return matchSearch && u.role === roleFilter
  })

  // Pickable people: current platform accounts (full details, exists=true) plus
  // teacher-roster entries not yet onboarded (name + system id + phone).
  const directory = useMemo<PersonSuggestion[]>(() => {
    const fromUsers: PersonSuggestion[] = users.map((u) => ({
      key: `u-${u.id}`,
      name: u.name,
      email: u.email && u.email !== "—" ? u.email : "",
      idNumber: u.idNumber || "",
      phone: u.phone || "",
      gender: u.gender === "male" || u.gender === "female" ? u.gender : "",
      role: u.role,
      exists: true,
    }))
    const existingNames = new Set(fromUsers.map((s) => s.name.trim().toLowerCase()))
    const fromRoster: PersonSuggestion[] = initialTeachers
      .filter((t) => !existingNames.has(t.name.trim().toLowerCase()))
      .map((t) => ({
        key: `t-${t.id}`,
        name: t.name,
        email: "",
        idNumber: t.id.toUpperCase(),
        phone: t.phone ?? "",
        gender: "" as const,
        role: "teacher" as UserRole,
        exists: false,
      }))
    return [...fromUsers, ...fromRoster]
  }, [users])

  const fieldValue = (f: "name" | "id" | "email" | "phone") =>
    f === "name" ? newName : f === "id" ? newIdNumber : f === "email" ? newEmail : newPhone

  // Suggestions for the field currently being edited; matches across all fields
  // so typing a name, id, email, or phone all surface the same person.
  const suggestions = useMemo<PersonSuggestion[]>(() => {
    if (!activeField) return []
    const q = fieldValue(activeField).trim().toLowerCase()
    if (q.length < 2) return []
    return directory
      .filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.idNumber.toLowerCase().includes(q) ||
          d.email.toLowerCase().includes(q) ||
          d.phone.toLowerCase().includes(q),
      )
      .slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeField, newName, newIdNumber, newEmail, newPhone, directory])

  const applySuggestion = (s: PersonSuggestion) => {
    setNewName(s.name)
    setNewIdNumber(s.idNumber)
    setNewEmail(s.email)
    setNewPhone(s.phone)
    if (s.gender) setNewGender(s.gender)
    if (assignableRoles.includes(s.role)) setNewRole(s.role)
    setActiveField(null)
    setDupNotice(
      s.exists
        ? `${s.name} already has a ${ROLE_LABELS[s.role]} account${s.email ? ` (${s.email})` : ""}. Creating again will fail — edit the existing user instead.`
        : null,
    )
  }

  // Dropdown rendered under whichever field is active.
  const renderSuggestions = (field: "name" | "id" | "email" | "phone") => {
    if (activeField !== field || suggestions.length === 0) return null
    return (
      <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-lg">
        {suggestions.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              // onMouseDown fires before the input's onBlur, so the pick registers.
              onMouseDown={(e) => { e.preventDefault(); applySuggestion(s) }}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-navy-50 dark:hover:bg-navy-800/60"
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="font-medium text-navy-900 dark:text-white truncate">{s.name}</span>
                <span className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                  s.exists ? ROLE_BADGE_COLORS[s.role] : "bg-navy-100 text-navy-500 dark:bg-navy-800 dark:text-navy-400"
                )}>
                  {s.exists ? ROLE_LABELS[s.role] : "Roster"}
                </span>
              </span>
              <span className="text-[11px] text-navy-400 truncate w-full">
                {[s.idNumber && `ID: ${s.idNumber}`, s.email, s.phone].filter(Boolean).join(" · ") || "No extra details on file"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  const resetAddForm = () => {
    setNewName(""); setNewIdNumber(""); setNewEmail(""); setNewPhone(""); setNewGender(""); setNewRole("student"); setAddError(null)
    setActiveField(null); setDupNotice(null)
  }

  const handleAddUser = async () => {
    // Adding a user enrolls a real person — capture their core details up front.
    // Every field is mandatory.
    const name = newName.trim()
    const idNumber = newIdNumber.trim()
    const email = newEmail.trim()
    const phone = newPhone.trim()

    if (!name || !idNumber || !email || !phone || !newGender) {
      setAddError("All fields are required: full name, ID number, email, phone number, and gender.")
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAddError("Enter a valid email address.")
      return
    }
    if (!/^[0-9+()\-\s]{6,}$/.test(phone)) {
      setAddError("Enter a valid phone number.")
      return
    }

    setAddError(null)
    setSaving(true)
    try {
      const res = await authFetch("/api/erp/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, idNumber, email, phone, gender: newGender, role: newRole }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      if (json.tempPassword) {
        window.alert(
          `User created.\n\nTemporary password: ${json.tempPassword}\n\nShare it securely. They should change it on first login.`
        )
      }
      resetAddForm(); setShowAddUser(false)
      await fetchUsers()
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to create user")
    } finally {
      setSaving(false)
    }
  }

  const handleSaveRole = async (id: string) => {
    setSaving(true)
    try {
      const res = await authFetch(`/api/erp/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: editRole }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setEditingId(null)
      await fetchUsers()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update role")
    } finally {
      setSaving(false)
    }
  }

  const handleToggleStatus = async (id: string, current: "active" | "inactive") => {
    const next = current === "active" ? "inactive" : "active"
    const res = await authFetch(`/api/erp/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    })
    if (res.ok) setUsers((prev) => prev.map((u) => u.id === id ? { ...u, status: next } : u))
    else {
      const json = await res.json().catch(() => ({}))
      alert(json.error ?? "Failed to update status")
    }
  }

  const handleRemoveUser = async (id: string) => {
    if (!confirm("Remove this user permanently?")) return
    const res = await authFetch(`/api/erp/users/${id}`, { method: "DELETE" })
    if (res.ok) setUsers((prev) => prev.filter((u) => u.id !== id))
    else {
      const json = await res.json().catch(() => ({}))
      alert(json.error ?? "Failed to delete user")
    }
  }

  const handleResetPassword = async (id: string) => {
    if (!newPassword.trim()) return
    setSaving(true)
    try {
      const res = await authFetch(`/api/erp/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setResetPasswordId(null); setNewPassword("")
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to reset password")
    } finally {
      setSaving(false)
    }
  }

  if (role !== "admin" && role !== "accountant") {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="border-red-500/30">
          <CardContent className="p-6">
            <h2 className="font-semibold text-navy-900 dark:text-white">Restricted</h2>
            <p className="text-sm text-navy-500 dark:text-navy-400 mt-1">
              User Management is available to administrators and accountants only.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <UserCog className="size-8 text-navy-600 dark:text-navy-300" /> User Management
        </h1>
        <p className="mt-1 text-navy-600 dark:text-navy-300">
          {isAdmin
            ? "Add, remove, change roles, and manage all users on the platform."
            : "Add new users to the platform. Role changes, password resets, and removals are admin-only."}
        </p>
      </motion.div>

      {/* Role stats */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        {(["admin", "accountant", "teacher", "student"] as UserRole[]).map((r) => (
          <Card key={r} className={cn("cursor-pointer transition-shadow hover:shadow-md", roleFilter === r && "ring-2 ring-gold-500")} onClick={() => setRoleFilter(roleFilter === r ? "all" : r)}>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-navy-900 dark:text-white">{users.filter((u) => u.role === r).length}</p>
              <p className={cn("text-xs font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 inline-block mt-1", ROLE_BADGE_COLORS[r])}>{ROLE_LABELS[r]}s</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={fetchUsers} title="Refresh"><RefreshCw className="size-4" /></Button>
          <Button className="bg-gold-500 text-navy-950 hover:bg-gold-400" onClick={() => setShowAddUser(!showAddUser)}>
            <Plus className="size-4 mr-1" /> Add User
          </Button>
        </div>
      </div>

      {/* Add User Form */}
      {showAddUser && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
          <Card className="border-gold-500/30">
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold text-navy-900 dark:text-white">Add New User</h3>
              <p className="text-xs text-navy-400">All fields are required.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-navy-600 dark:text-navy-300">Full name <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Input placeholder="Full name" value={newName} autoComplete="off"
                      onChange={(e) => { setNewName(e.target.value); setActiveField("name"); setDupNotice(null) }}
                      onFocus={() => setActiveField("name")}
                      onBlur={() => setTimeout(() => setActiveField((f) => (f === "name" ? null : f)), 150)} />
                    {renderSuggestions("name")}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-navy-600 dark:text-navy-300">ID number <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Input placeholder="ID / Emirates ID number" value={newIdNumber} autoComplete="off"
                      onChange={(e) => { setNewIdNumber(e.target.value); setActiveField("id"); setDupNotice(null) }}
                      onFocus={() => setActiveField("id")}
                      onBlur={() => setTimeout(() => setActiveField((f) => (f === "id" ? null : f)), 150)} />
                    {renderSuggestions("id")}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-navy-600 dark:text-navy-300">Email address <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Input type="email" placeholder="Email address" value={newEmail} autoComplete="off"
                      onChange={(e) => { setNewEmail(e.target.value); setActiveField("email"); setDupNotice(null) }}
                      onFocus={() => setActiveField("email")}
                      onBlur={() => setTimeout(() => setActiveField((f) => (f === "email" ? null : f)), 150)} />
                    {renderSuggestions("email")}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-navy-600 dark:text-navy-300">Phone number <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Input type="tel" placeholder="Phone number" value={newPhone} autoComplete="off"
                      onChange={(e) => { setNewPhone(e.target.value); setActiveField("phone"); setDupNotice(null) }}
                      onFocus={() => setActiveField("phone")}
                      onBlur={() => setTimeout(() => setActiveField((f) => (f === "phone" ? null : f)), 150)} />
                    {renderSuggestions("phone")}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-navy-600 dark:text-navy-300">Gender <span className="text-red-500">*</span></label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={newGender}
                    onChange={(e) => setNewGender(e.target.value as "" | "male" | "female")}
                  >
                    <option value="" disabled>Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-navy-600 dark:text-navy-300">Role <span className="text-red-500">*</span></label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                  >
                    {assignableRoles.map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </div>
              </div>
              {dupNotice && (
                <p className="rounded-md border border-amber-500/40 bg-amber-50/60 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  {dupNotice}
                </p>
              )}
              {addError && <p className="text-xs text-red-500">{addError}</p>}
              <p className="text-xs text-navy-400">Start typing a name, ID, email, or phone to pick from existing records — details auto-fill. A unique temporary password is generated and shown once after creation.</p>
              <div className="flex gap-2">
                <Button className="bg-gold-500 text-navy-950 hover:bg-gold-400" onClick={handleAddUser} disabled={saving}>
                  <Save className="size-4 mr-1" /> {saving ? "Creating..." : "Create User"}
                </Button>
                <Button variant="outline" onClick={() => { resetAddForm(); setShowAddUser(false) }}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Users table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 text-center text-navy-400">Loading users...</div>
          ) : error ? (
            <div className="py-16 text-center text-red-400">{error}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-navy-50 dark:bg-navy-800/50">
                    <th className="px-4 py-3 text-left font-medium text-navy-600 dark:text-navy-300">User</th>
                    <th className="px-4 py-3 text-left font-medium text-navy-600 dark:text-navy-300">Role</th>
                    <th className="px-4 py-3 text-center font-medium text-navy-600 dark:text-navy-300">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-navy-600 dark:text-navy-300">Joined</th>
                    <th className="px-4 py-3 text-left font-medium text-navy-600 dark:text-navy-300">Last Login</th>
                    <th className="px-4 py-3 text-center font-medium text-navy-600 dark:text-navy-300">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-navy-50/50 dark:hover:bg-navy-800/30">
                      <td className="px-4 py-3">
                        <p className="font-medium text-navy-900 dark:text-white">{u.name}</p>
                        <p className="text-xs text-navy-400">{u.email}</p>
                        {(u.idNumber || u.phone || u.gender) && (
                          <p className="text-xs text-navy-400 capitalize">
                            {[u.idNumber && `ID: ${u.idNumber}`, u.phone, u.gender].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editingId === u.id ? (
                          <div className="flex items-center gap-1">
                            <select className="h-7 rounded border text-xs px-1" value={editRole} onChange={(e) => setEditRole(e.target.value as UserRole)}>
                              <option value="student">Student</option>
                              <option value="teacher">Teacher</option>
                              <option value="accountant">Accountant</option>
                              <option value="admin">Admin</option>
                            </select>
                            <button onClick={() => handleSaveRole(u.id)} disabled={saving} className="text-emerald-500 hover:text-emerald-600"><Save className="size-3.5" /></button>
                            <button onClick={() => setEditingId(null)} className="text-red-400 hover:text-red-500"><X className="size-3.5" /></button>
                          </div>
                        ) : (
                          <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase", ROLE_BADGE_COLORS[u.role])}>
                            {ROLE_LABELS[u.role]}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isAdmin ? (
                          <button onClick={() => handleToggleStatus(u.id, u.status)}
                            className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase transition-colors",
                              u.status === "active"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 hover:bg-emerald-200"
                                : "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400 hover:bg-red-200"
                            )}>
                            {u.status}
                          </button>
                        ) : (
                          <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase",
                            u.status === "active"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                              : "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"
                          )}>
                            {u.status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-navy-400 text-xs">{u.joinDate}</td>
                      <td className="px-4 py-3 text-navy-400 text-xs">{u.lastLogin}</td>
                      <td className="px-4 py-3">
                        {isAdmin ? (
                          <>
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => { setEditingId(u.id); setEditRole(u.role) }} className="p-1 rounded hover:bg-navy-100 dark:hover:bg-navy-700 text-navy-500 hover:text-navy-700" title="Edit role">
                                <Edit2 className="size-3.5" />
                              </button>
                              <button onClick={() => { setResetPasswordId(resetPasswordId === u.id ? null : u.id); setNewPassword("") }} className="p-1 rounded hover:bg-navy-100 dark:hover:bg-navy-700 text-amber-500 hover:text-amber-600" title="Reset password">
                                <KeyRound className="size-3.5" />
                              </button>
                              <button onClick={() => handleRemoveUser(u.id)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-500/10 text-red-400 hover:text-red-600" title="Remove user">
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                            {resetPasswordId === u.id && (
                              <div className="flex items-center gap-1 mt-1">
                                <Input className="h-7 text-xs" type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                                <button onClick={() => handleResetPassword(u.id)} disabled={saving} className="shrink-0 rounded bg-amber-500 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-400">
                                  {saving ? "..." : "Reset"}
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="block text-center text-xs text-navy-300 dark:text-navy-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-navy-400">No users found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
