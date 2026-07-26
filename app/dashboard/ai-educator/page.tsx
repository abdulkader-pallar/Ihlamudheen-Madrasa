"use client"

export const dynamic = "force-static"

import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"

const AI_EDUCATOR_URL =
  process.env.NEXT_PUBLIC_AI_EDUCATOR_URL?.trim() || ""

function isDarkMode() {
  return typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
}

export default function AiEducatorPage() {
  const { user } = useAuth()
  const [loaded, setLoaded] = useState(false)
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(isDarkMode())
    const observer = new MutationObserver(() => setDark(isDarkMode()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => observer.disconnect()
  }, [])

  const firstName = (user?.user_metadata?.full_name as string | undefined)
    ?.split(" ")[0] ?? ""
  const params = new URLSearchParams({ embed: "1", full: "1" })
  if (dark) params.set("dark", "1")
  if (firstName) params.set("name", firstName)
  const iframeSrc = `${AI_EDUCATOR_URL}?${params.toString()}`

  return (
    <div className="fixed inset-0 top-14 z-10">
      {!loaded && (
        <div className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 ${
          dark ? "bg-navy-950" : "bg-white"
        }`}>
          <Loader2 className="size-6 animate-spin text-gold-500" />
          <p className={`text-sm ${dark ? "text-navy-300" : "text-navy-500"}`}>
            Loading the AI tool…
          </p>
        </div>
      )}
      <iframe
        key={iframeSrc}
        src={iframeSrc}
        title="Educator AI"
        className="size-full"
        onLoad={() => setLoaded(true)}
        allow="clipboard-read; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  )
}
