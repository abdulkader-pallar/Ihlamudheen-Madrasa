"use client"

// A type-it-in arrival-time field used by the attendance late-tracking panels.
// Replaces the native <input type="time">, whose 12-hour AM/PM box can silently
// yield an empty value when left unset. The user types a plain time (e.g. "9:09"
// or "3:05") and it is parsed relative to the program's start time, so no AM/PM
// selection is required. The committed value is always "HH:MM" (24h) or "".

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { parseArrivalInput, formatArrivalTyping, formatTime12h } from "@/lib/late-policy"

export function ArrivalTimeInput({
  value,
  programStart,
  onCommit,
  ariaLabel,
}: {
  /** Current arrival time as "HH:MM" (24h), or "" when none. */
  value: string
  /** Program start time "HH:MM" — used to anchor AM/PM for ambiguous input. */
  programStart: string
  /** Called with the normalised "HH:MM" (or "" to clear). */
  onCommit: (hhmm: string) => void
  ariaLabel?: string
}) {
  const [text, setText] = useState(() => (value ? formatTime12h(value) : ""))
  const [focused, setFocused] = useState(false)

  // Sync from external changes (seed/reseed) only while not actively editing,
  // so live re-renders don't clobber what the user is typing.
  useEffect(() => {
    if (!focused) setText(value ? formatTime12h(value) : "")
  }, [value, focused])

  return (
    <Input
      type="text"
      placeholder="e.g. 9:09"
      value={text}
      aria-label={ariaLabel}
      className="h-7 w-[116px] text-xs px-2"
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        const formatted = formatArrivalTyping(e.target.value)
        setText(formatted)
        onCommit(parseArrivalInput(formatted, programStart) ?? "")
      }}
      onBlur={() => {
        setFocused(false)
        const parsed = parseArrivalInput(text, programStart)
        onCommit(parsed ?? "")
        setText(parsed ? formatTime12h(parsed) : "")
      }}
    />
  )
}
