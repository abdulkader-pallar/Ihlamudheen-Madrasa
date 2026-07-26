"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Bell, Shield, Palette, Globe, Save } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export default function SettingsPage() {
  const [emailNotifs, setEmailNotifs] = useState(true)
  const [pushNotifs, setPushNotifs] = useState(true)
  const [smsNotifs, setSmsNotifs] = useState(false)
  const [twoFactor, setTwoFactor] = useState(false)
  const [sessionTimeout, setSessionTimeout] = useState("30")
  const [theme, setTheme] = useState("system")
  const [fontSize, setFontSize] = useState("medium")
  const [language, setLanguage] = useState("en")
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={cn(
          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
          checked ? "bg-gold-500" : "bg-navy-200 dark:bg-navy-600"
        )}
      >
        <span
          className={cn(
            "inline-block size-3.5 rounded-full bg-white transition-transform",
            checked ? "translate-x-4" : "translate-x-1"
          )}
        />
      </button>
    )
  }

  return (
    <div className="space-y-6">
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed right-4 top-4 z-50 rounded-lg bg-navy-800 px-4 py-3 text-sm text-white shadow-lg dark:bg-white dark:text-navy-900"
        >
          {toast}
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-3xl font-bold text-navy-900 dark:text-white">Settings</h1>
        <p className="mt-1 text-navy-600 dark:text-navy-300">
          Manage your application preferences and account settings.
        </p>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Notifications */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="size-5 text-gold-500" /> Notifications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-navy-800 dark:text-navy-100">Email Notifications</p>
                  <p className="text-xs text-navy-400">Receive updates via email</p>
                </div>
                <Toggle checked={emailNotifs} onChange={() => setEmailNotifs(!emailNotifs)} />
              </label>
              <label className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-navy-800 dark:text-navy-100">Push Notifications</p>
                  <p className="text-xs text-navy-400">Browser push notifications</p>
                </div>
                <Toggle checked={pushNotifs} onChange={() => setPushNotifs(!pushNotifs)} />
              </label>
              <label className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-navy-800 dark:text-navy-100">SMS Notifications</p>
                  <p className="text-xs text-navy-400">Get important alerts via SMS</p>
                </div>
                <Toggle checked={smsNotifs} onChange={() => setSmsNotifs(!smsNotifs)} />
              </label>
            </CardContent>
          </Card>
        </motion.div>

        {/* Security */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="size-5 text-gold-500" /> Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-navy-800 dark:text-navy-100">Two-Factor Authentication</p>
                  <p className="text-xs text-navy-400">Extra security for your account</p>
                </div>
                <Toggle checked={twoFactor} onChange={() => setTwoFactor(!twoFactor)} />
              </label>
              <div className="space-y-2">
                <Label>Session Timeout</Label>
                <Select value={sessionTimeout} onValueChange={(v) => v && setSessionTimeout(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 minutes</SelectItem>
                    <SelectItem value="30">30 minutes</SelectItem>
                    <SelectItem value="60">1 hour</SelectItem>
                    <SelectItem value="120">2 hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Appearance */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="size-5 text-gold-500" /> Appearance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Theme</Label>
                <Select value={theme} onValueChange={(v) => v && setTheme(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Font Size</Label>
                <Select value={fontSize} onValueChange={(v) => v && setFontSize(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small">Small</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="large">Large</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Language & Region */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.25 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="size-5 text-gold-500" /> Language & Region
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={language} onValueChange={(v) => v && setLanguage(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="ar">Arabic</SelectItem>
                    <SelectItem value="fr">French</SelectItem>
                    <SelectItem value="es">Spanish</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="flex justify-end">
        <Button
          className="bg-gold-500 text-navy-950 hover:bg-gold-400"
          onClick={() => showToast("Settings saved successfully!")}
        >
          <Save className="mr-1.5 size-4" />
          Save Settings
        </Button>
      </div>
    </div>
  )
}
