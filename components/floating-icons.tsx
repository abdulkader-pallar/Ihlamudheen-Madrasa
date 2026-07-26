"use client"

import { motion } from "framer-motion"
import {
  BookOpen, GraduationCap, Pencil, Star, Award,
  BookMarked, Lightbulb, FileText, Sparkles, Moon,
  Feather, Bookmark, PenTool,
} from "lucide-react"

/* ========================================
   Scattered Symbols — PawPaths-style
   Bigger, more visible, varied animations
   ======================================== */

const symbolSet = [
  BookOpen, GraduationCap, Pencil, Star, Award,
  BookMarked, Lightbulb, FileText, Sparkles, Moon,
  Feather, Bookmark, PenTool,
]

const animations = [
  "animate-float",
  "animate-float-drift",
  "animate-float-spin",
  "animate-float-wobble",
]

const delays = [
  "float-delay-1", "float-delay-2", "float-delay-3", "float-delay-4",
  "float-delay-5", "float-delay-6", "float-delay-7", "float-delay-8",
]

// Predefined positions for consistent layout (no Math.random SSR mismatch)
const symbolPositions = [
  { left: "3%", top: "12%", size: 28 },
  { left: "92%", top: "8%", size: 22 },
  { left: "8%", top: "35%", size: 20 },
  { left: "95%", top: "30%", size: 26 },
  { left: "5%", top: "58%", size: 24 },
  { left: "90%", top: "55%", size: 18 },
  { left: "12%", top: "78%", size: 22 },
  { left: "88%", top: "82%", size: 28 },
  { left: "25%", top: "5%", size: 16 },
  { left: "75%", top: "92%", size: 20 },
  { left: "50%", top: "3%", size: 18 },
  { left: "40%", top: "95%", size: 22 },
  { left: "18%", top: "92%", size: 16 },
  { left: "82%", top: "15%", size: 20 },
  { left: "60%", top: "8%", size: 14 },
  { left: "35%", top: "88%", size: 18 },
]

interface ScatteredSymbolsProps {
  count?: number
  /** "light" for dark bg sections (white icons), "dark" for light bg sections (gold/navy icons) */
  variant?: "light" | "dark"
  className?: string
}

export function ScatteredSymbols({
  count = 14,
  variant = "dark",
  className = "",
}: ScatteredSymbolsProps) {
  const colorClass =
    variant === "light"
      ? "text-white/[0.12]"
      : "text-gold-500/[0.15] dark:text-gold-400/[0.10]"

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {symbolPositions.slice(0, count).map((pos, i) => {
        const Icon = symbolSet[i % symbolSet.length]
        const anim = animations[i % animations.length]
        const delay = delays[i % delays.length]

        return (
          <div
            key={i}
            className={`absolute ${colorClass} ${anim} ${delay}`}
            style={{ left: pos.left, top: pos.top }}
          >
            <Icon style={{ width: pos.size, height: pos.size }} strokeWidth={1.5} />
          </div>
        )
      })}
    </div>
  )
}

/* ========================================
   Breathing Orb (unchanged)
   ======================================== */

export function BreathingOrb({
  className = "",
  size = "lg",
}: {
  className?: string
  size?: "sm" | "md" | "lg"
}) {
  const sizes = {
    sm: "w-32 h-32",
    md: "w-64 h-64",
    lg: "w-96 h-96",
  }

  return (
    <motion.div
      className={`rounded-full blur-3xl absolute ${sizes[size]} ${className}`}
      animate={{
        scale: [1, 1.15, 1, 0.9, 1],
        opacity: [0.15, 0.25, 0.15, 0.1, 0.15],
      }}
      transition={{
        duration: 6,
        repeat: Infinity,
        ease: "easeInOut" as const,
      }}
    />
  )
}

/* ========================================
   Marquee Ticker — scrolling certifications
   ======================================== */

import { initialTeachers } from "@/data/courses"

const STATIC_TICKER_BASE = [
  "Ihlamudheen Madrasa",
  "Ihlamudheen Madrasa",
  "Ihlamudheen Madrasa",
  "CIBIS CERTIFICATION",
  "Ihlamudheen Madrasa",
  "ISLAMIC & PROFESSIONAL EDUCATION",
  "Malappuram, Kerala",
]

export function MarqueeTicker({
  className = "",
  studentCount,
}: {
  className?: string
  studentCount?: number
}) {
  const tickerItems = [
    ...STATIC_TICKER_BASE,
    `${studentCount ?? ""} STUDENTS`.trim(),
    `${initialTeachers.length} CERTIFIED TEACHERS`,
  ]
  // Double the items for seamless loop
  const doubled = [...tickerItems, ...tickerItems]

  return (
    <div
      className={`overflow-hidden bg-navy-900 dark:bg-navy-950 py-3 ${className}`}
    >
      <div className="animate-marquee flex whitespace-nowrap">
        {doubled.map((item, i) => (
          <span key={i} className="flex items-center mx-6">
            <span className="text-gold-500 mr-3 text-lg">&#9733;</span>
            <span className="text-sm font-semibold tracking-wider text-white/90 uppercase">
              {item}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
