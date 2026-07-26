"use client"

import { useEffect, useState } from "react"
import { Sun, Moon } from "lucide-react"
import { Button } from "@/components/ui/button"

// Uses the app's own `data-theme` scheme (same as components/ui/theme-toggle),
// so the ERP pages share one theme mechanism with the accounting app — no
// separate next-themes provider needed.
function currentIsDark() {
  if (typeof document === "undefined") return false
  const t = document.documentElement.getAttribute("data-theme")
  if (t) return t === "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false)
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setMounted(true)
    setDark(currentIsDark())
  }, [])

  const toggle = () => {
    const next = currentIsDark() ? "light" : "dark"
    document.documentElement.setAttribute("data-theme", next)
    try {
      localStorage.setItem("theme", next)
    } catch {}
    setDark(next === "dark")
    window.dispatchEvent(new Event("themechange"))
  }

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" aria-label="Toggle theme">
        <span className="inline-flex size-4" />
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Toggle theme"
      className="hover:bg-gray-100 dark:hover:bg-navy-800"
    >
      <span className="inline-flex transition-transform duration-300">
        {dark ? <Sun className="size-4 text-yellow-300" /> : <Moon className="size-4 text-gray-600" />}
      </span>
    </Button>
  )
}
