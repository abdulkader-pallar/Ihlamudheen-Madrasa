import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Natural (human) string compare so "Grade 2" sorts before "Grade 10" and
 * "Grade 10" after "Grade 9" — never the lexicographic "1, 10, 2" order.
 * Use everywhere grades / classes / sections are ordered.
 */
export function compareNatural(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { numeric: true, sensitivity: "base" })
}

// Capitalizes the first letter of each word: "muhamed abdul rahiman" -> "Muhamed Abdul Rahiman"
export function toTitleCase(name: string): string {
  if (!name) return name
  return name
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}
