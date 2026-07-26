"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Sun, Moon } from "lucide-react"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

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
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
      className="hover:bg-gray-100 dark:hover:bg-navy-800"
    >
      <span className="inline-flex transition-transform duration-300">
        {theme === "dark" ? (
          <Sun className="size-4 text-yellow-300" />
        ) : (
          <Moon className="size-4 text-gray-600" />
        )}
      </span>
    </Button>
  )
}
