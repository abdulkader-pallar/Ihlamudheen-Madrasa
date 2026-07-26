"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { Camera, Trash2, Save, Lock, Loader2, Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/use-auth"

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5 },
}

export default function ProfilePage() {
  const { user } = useAuth(true)

  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [bio, setBio] = useState("")
  const [phone, setPhone] = useState("")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(true)

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [savingPassword, setSavingPassword] = useState(false)
  // Let the user reveal what they typed to confirm the credentials are correct.
  const [showPasswords, setShowPasswords] = useState(false)

  const [courseUpdates, setCourseUpdates] = useState(true)
  const [announcements, setAnnouncements] = useState(true)
  const [weeklyReport, setWeeklyReport] = useState(false)

  const [language, setLanguage] = useState("en")
  const [timezone, setTimezone] = useState("asia-dubai")

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  // Load profile data from Supabase Auth user_metadata (no RLS issues)
  const loadProfile = useCallback(async () => {
    if (!user) return
    try {
      const meta = user.user_metadata || {}
      setEmail(user.email || "")
      setFullName(meta.full_name || meta.name || "")
      setPhone(meta.phone || "")
      setBio(meta.bio || "")
      setAvatarUrl(meta.avatar_url || null)
    } catch {
      // Silent fallback
    } finally {
      setLoadingProfile(false)
    }
  }, [user])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  // Save profile to Supabase Auth user_metadata (persists across sessions, no RLS)
  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true)

    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          full_name: fullName,
          phone: phone,
          bio: bio,
        },
      })

      if (error) throw error

      // Also try to update the users table name (best-effort, won't break if it fails)
      await supabase
        .from("users")
        .update({ name: fullName })
        .eq("id", user.id)
        .then(() => {}) // ignore result

      showToast("Profile saved successfully!")
    } catch {
      showToast("Failed to save profile. Please try again.", "error")
    } finally {
      setSaving(false)
    }
  }

  // Upload avatar — convert to base64 and store in auth user_metadata
  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !user) return

    if (file.size > 2 * 1024 * 1024) {
      showToast("File size must be less than 2MB", "error")
      return
    }
    if (!file.type.startsWith("image/")) {
      showToast("Please upload an image file", "error")
      return
    }

    setUploadingAvatar(true)
    try {
      // Resize and compress to keep base64 small (max ~200KB)
      const base64 = await resizeImage(file, 300, 300, 0.8)
      setAvatarUrl(base64)

      const { error } = await supabase.auth.updateUser({
        data: { avatar_url: base64 },
      })

      if (error) throw error
      showToast("Profile photo updated!")
    } catch {
      showToast("Failed to upload photo. Please try again.", "error")
    } finally {
      setUploadingAvatar(false)
    }
  }

  // Helper: resize image to keep base64 payload small
  function resizeImage(file: File, maxW: number, maxH: number, quality: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const img = new window.Image()
        img.onload = () => {
          const canvas = document.createElement("canvas")
          let w = img.width
          let h = img.height
          if (w > maxW) { h = (h * maxW) / w; w = maxW }
          if (h > maxH) { w = (w * maxH) / h; h = maxH }
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext("2d")
          ctx?.drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL("image/jpeg", quality))
        }
        img.onerror = reject
        img.src = ev.target?.result as string
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function handleRemoveAvatar() {
    if (!user) return
    setAvatarUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ""

    await supabase.auth.updateUser({
      data: { avatar_url: null },
    })

    showToast("Profile photo removed")
  }

  // Update password via Supabase Auth
  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      showToast("Passwords do not match!", "error")
      return
    }
    if (newPassword.length < 6) {
      showToast("Password must be at least 6 characters", "error")
      return
    }
    setSavingPassword(true)

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (error) throw error
      showToast("Password updated successfully!")
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    } catch {
      showToast("Failed to update password. Please try again.", "error")
    } finally {
      setSavingPassword(false)
    }
  }

  if (loadingProfile) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="size-8 animate-spin text-gold-500" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Toast notification */}
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className={cn(
            "fixed right-4 top-4 z-50 rounded-lg px-4 py-3 text-sm shadow-lg",
            toast.type === "error"
              ? "bg-red-600 text-white"
              : "bg-navy-800 text-white dark:bg-white dark:text-navy-900"
          )}
        >
          {toast.message}
        </motion.div>
      )}

      {/* Page Header */}
      <motion.div {...fadeInUp}>
        <h1 className="text-3xl font-bold text-navy-900 dark:text-white">
          My Profile
        </h1>
        <p className="mt-1 text-navy-600 dark:text-navy-300">
          Manage your account settings and personal information.
        </p>
      </motion.div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Personal Information */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Personal Information</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Full Name</Label>
                    <Input
                      id="fullName"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Enter your full name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      disabled
                      className="bg-navy-50 dark:bg-navy-800/50"
                    />
                    <p className="text-xs text-navy-400">
                      Contact support to change your email address.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bio">Bio</Label>
                    <Textarea
                      id="bio"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="Tell us about yourself..."
                      rows={4}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Enter your phone number"
                    />
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      disabled={saving}
                      className="bg-gold-500 text-white hover:bg-gold-600"
                    >
                      {saving ? (
                        <Loader2 className="mr-1.5 size-4 animate-spin" />
                      ) : (
                        <Save className="mr-1.5 size-4" />
                      )}
                      {saving ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>

          {/* Change Password */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Change Password</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleUpdatePassword} className="space-y-4">
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => setShowPasswords((v) => !v)}
                      className="flex items-center gap-1.5 text-xs font-medium text-navy-500 hover:text-navy-700 dark:text-navy-400 dark:hover:text-navy-200 transition-colors"
                    >
                      {showPasswords ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      {showPasswords ? "Hide passwords" : "Show passwords"}
                    </button>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="currentPassword">Current Password</Label>
                    <Input
                      id="currentPassword"
                      type={showPasswords ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter current password"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="newPassword">New Password</Label>
                    <Input
                      id="newPassword"
                      type={showPasswords ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">
                      Confirm New Password
                    </Label>
                    <Input
                      id="confirmPassword"
                      type={showPasswords ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                    />
                  </div>

                  <div className="flex justify-end">
                    <Button type="submit" variant="outline" disabled={savingPassword}>
                      {savingPassword ? (
                        <Loader2 className="mr-1.5 size-4 animate-spin" />
                      ) : (
                        <Lock className="mr-1.5 size-4" />
                      )}
                      {savingPassword ? "Updating..." : "Update Password"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Profile Picture */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Profile Picture</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center space-y-4">
                {avatarUrl ? (
                  <div className="relative size-[120px] overflow-hidden rounded-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={avatarUrl}
                      alt="Profile"
                      className="size-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex size-[120px] items-center justify-center rounded-full bg-gold-500 text-4xl font-bold text-white">
                    {fullName ? fullName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase() : "?"}
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
                <div className="flex flex-col items-center gap-2">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAvatar}
                  >
                    {uploadingAvatar ? (
                      <Loader2 className="mr-1.5 size-4 animate-spin" />
                    ) : (
                      <Camera className="mr-1.5 size-4" />
                    )}
                    {uploadingAvatar ? "Uploading..." : "Upload Photo"}
                  </Button>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={handleRemoveAvatar}
                      className="text-sm text-red-500 hover:text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <p className="text-center text-xs text-navy-400">
                  JPG, PNG or GIF. Max 2MB
                </p>
              </CardContent>
            </Card>
          </motion.div>

          {/* Account Settings */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Account Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Notification toggles */}
                <div className="space-y-3">
                  <p className="text-sm font-medium text-navy-700 dark:text-navy-200">
                    Email Notifications
                  </p>
                  <label className="flex cursor-pointer items-center justify-between">
                    <span className="text-sm text-navy-600 dark:text-navy-300">
                      Course updates
                    </span>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={courseUpdates}
                      onClick={() => setCourseUpdates(!courseUpdates)}
                      className={cn(
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                        courseUpdates
                          ? "bg-gold-500"
                          : "bg-navy-200 dark:bg-navy-600"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block size-3.5 rounded-full bg-white transition-transform",
                          courseUpdates ? "translate-x-4" : "translate-x-1"
                        )}
                      />
                    </button>
                  </label>
                  <label className="flex cursor-pointer items-center justify-between">
                    <span className="text-sm text-navy-600 dark:text-navy-300">
                      New announcements
                    </span>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={announcements}
                      onClick={() => setAnnouncements(!announcements)}
                      className={cn(
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                        announcements
                          ? "bg-gold-500"
                          : "bg-navy-200 dark:bg-navy-600"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block size-3.5 rounded-full bg-white transition-transform",
                          announcements ? "translate-x-4" : "translate-x-1"
                        )}
                      />
                    </button>
                  </label>
                  <label className="flex cursor-pointer items-center justify-between">
                    <span className="text-sm text-navy-600 dark:text-navy-300">
                      Weekly progress report
                    </span>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={weeklyReport}
                      onClick={() => setWeeklyReport(!weeklyReport)}
                      className={cn(
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                        weeklyReport
                          ? "bg-gold-500"
                          : "bg-navy-200 dark:bg-navy-600"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block size-3.5 rounded-full bg-white transition-transform",
                          weeklyReport ? "translate-x-4" : "translate-x-1"
                        )}
                      />
                    </button>
                  </label>
                </div>

                {/* Language */}
                <div className="space-y-2">
                  <Label>Language</Label>
                  <Select value={language} onValueChange={(v) => v && setLanguage(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select language" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="ar">Arabic</SelectItem>
                      <SelectItem value="fr">French</SelectItem>
                      <SelectItem value="es">Spanish</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Timezone */}
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Select value={timezone} onValueChange={(v) => v && setTimezone(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select timezone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asia-dubai">
                        Gulf Standard Time (UAE)
                      </SelectItem>
                      <SelectItem value="asia-riyadh">
                        Arabia Standard Time
                      </SelectItem>
                      <SelectItem value="europe-london">
                        GMT (London)
                      </SelectItem>
                      <SelectItem value="america-new-york">
                        Eastern Time (ET)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Danger Zone */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
          >
            <Card className="border-red-200 ring-red-200 dark:border-red-900 dark:ring-red-900">
              <CardHeader>
                <CardTitle className="text-red-600 dark:text-red-400">
                  Danger Zone
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-navy-500 dark:text-navy-400">
                  Once you delete your account, there is no going back. All of
                  your data, courses, and progress will be permanently removed.
                </p>
                <Button variant="destructive" className="w-full">
                  <Trash2 className="mr-1.5 size-4" />
                  Delete Account
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
