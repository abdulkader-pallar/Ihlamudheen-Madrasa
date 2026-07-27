"use client"

import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { KeyRound, Search, RefreshCw, Wand2, Copy, Check, ShieldAlert } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { authFetch } from "@/lib/api-client"
import { useAuth } from "@/hooks/use-auth"
import { getUserRole, ROLE_BADGE_COLORS, ROLE_LABELS } from "@/lib/roles"
import type { UserRole } from "@/lib/roles"

interface ManagedUser {
  id: string
  name: string
  email: string
  role: UserRole
  status: "active" | "inactive"
  joinDate: string
  lastLogin: string
}

// Client-side strong password generator (mirrors the server's generateTempPassword
// shape: mixed-case + digit + symbol so it satisfies common password policies).
function generatePassword(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `Rp${raw.slice(0, 14)}!${raw.slice(14, 16).toUpperCase()}`
}

export default function PasswordsPage() {
  const { user } = useAuth(true)
  const role = user ? getUserRole(user) : "student"
  const isAdmin = role === "admin"

  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)
  const [password, setPassword] = useState("")
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

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

  useEffect(() => {
    if (isAdmin) fetchUsers()
    else setLoading(false)
  }, [isAdmin, fetchUsers])

  const filtered = users.filter((u) => {
    const q = search.toLowerCase()
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })

  const openReset = (id: string) => {
    setOpenId(openId === id ? null : id)
    setPassword("")
    setCopied(false)
    setNotice(null)
  }

  const handleReset = async (u: ManagedUser) => {
    if (password.trim().length < 6) {
      setNotice("Password must be at least 6 characters.")
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      const res = await authFetch(`/api/erp/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setNotice(`Password updated for ${u.name}. Share it securely — they should change it on first login.`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to reset password")
    } finally {
      setSaving(false)
    }
  }

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — admin can copy manually */
    }
  }

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="border-red-500/30">
          <CardContent className="p-6 flex items-start gap-3">
            <ShieldAlert className="size-6 text-red-500 shrink-0" />
            <div>
              <h2 className="font-semibold text-navy-900 dark:text-white">Admins only</h2>
              <p className="text-sm text-navy-500 dark:text-navy-400 mt-1">
                Password management is restricted to administrators.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <KeyRound className="size-7 text-amber-500" /> Passwords
        </h1>
        <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
          Reset account passwords and generate one-time credentials. Users should change
          their password on first login.
        </p>
      </motion.div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search users..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button variant="outline" size="icon" onClick={fetchUsers} title="Refresh">
          <RefreshCw className="size-4" />
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 text-center text-navy-400">Loading users...</div>
          ) : error ? (
            <div className="py-16 text-center text-red-400">{error}</div>
          ) : (
            <ul className="divide-y divide-navy-100 dark:divide-navy-800">
              {filtered.map((u) => (
                <li key={u.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-navy-900 dark:text-white truncate">{u.name}</p>
                      <p className="text-xs text-navy-400 truncate">{u.email}</p>
                    </div>
                    <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase", ROLE_BADGE_COLORS[u.role])}>
                      {ROLE_LABELS[u.role]}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => openReset(u.id)}
                    >
                      <KeyRound className="size-3.5 mr-1" /> Reset password
                    </Button>
                  </div>

                  {openId === u.id && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="mt-3 rounded-lg border border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5 p-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          type="text"
                          className="h-9 flex-1 min-w-[180px] font-mono text-sm"
                          placeholder="New password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <Button variant="outline" size="sm" className="shrink-0" onClick={() => setPassword(generatePassword())} title="Generate strong password">
                          <Wand2 className="size-3.5 mr-1" /> Generate
                        </Button>
                        <Button variant="outline" size="sm" className="shrink-0" onClick={copyPassword} disabled={!password} title="Copy">
                          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                        </Button>
                        <Button
                          size="sm"
                          className="shrink-0 bg-amber-500 text-white hover:bg-amber-400"
                          onClick={() => handleReset(u)}
                          disabled={saving}
                        >
                          {saving ? "Saving..." : "Save"}
                        </Button>
                      </div>
                      {notice && (
                        <p className="text-xs text-navy-600 dark:text-navy-300">{notice}</p>
                      )}
                    </motion.div>
                  )}
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-4 py-10 text-center text-navy-400">No users found</li>
              )}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
