"use client"

import Image from "next/image"
import { cn } from "@/lib/utils"
import { COURSE_LOGOS } from "@/lib/course-logos"

interface CourseLogoProps {
  /** Course id ("1"–"4") matching COURSE_LOGOS. */
  id: string
  /** Accessible label; falls back to the course's brand name. */
  title?: string
  /** Sizing/styling applied to both variants. */
  className?: string
  width?: number
  height?: number
}

/**
 * Renders a course's brand logo, swapping between its light- and dark-mode
 * artwork based on the active theme. Both variants are rendered and toggled
 * with Tailwind `dark:` classes (no `useTheme`) so there is no hydration flash.
 */
export function CourseLogo({
  id,
  title,
  className,
  width = 96,
  height = 96,
}: CourseLogoProps) {
  const entry = COURSE_LOGOS[id]
  if (!entry) return null
  const alt = title ?? entry.alt

  return (
    <>
      <Image
        src={entry.light}
        alt={alt}
        width={width}
        height={height}
        className={cn("block dark:hidden", className)}
      />
      <Image
        src={entry.dark}
        alt=""
        aria-hidden
        width={width}
        height={height}
        className={cn("hidden dark:block", className)}
      />
    </>
  )
}
