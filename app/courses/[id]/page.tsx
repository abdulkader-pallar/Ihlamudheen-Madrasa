"use client"

import { useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import Image from "next/image"
import {
  Search,
  Star,
  Clock,
  BookOpen,
  Monitor,
  Briefcase,
  Layers,
} from "lucide-react"
import { ScatteredSymbols } from "@/components/floating-icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { CourseLogo } from "@/components/course-logo"
import { cn } from "@/lib/utils"

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: "easeOut" as const },
  }),
}

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
}

const categories = [
  { label: "All", icon: Layers },
  { label: "Islamic Studies", icon: BookOpen },
  { label: "Language", icon: Monitor },
  { label: "Professional", icon: Briefcase },
]

// Theme-aware tile backgrounds: soft tints in light mode (so the dark-ink logo
// variant reads) and saturated brand gradients in dark mode (for the light-ink
// variant). Keep the category colour identity across both.
const categoryGradients: Record<string, string> = {
  "Islamic Studies": "from-emerald-50 to-teal-100 dark:from-emerald-800 dark:to-teal-900",
  Language: "from-blue-50 to-indigo-100 dark:from-blue-800 dark:to-indigo-900",
  Professional: "from-purple-50 to-violet-100 dark:from-purple-800 dark:to-violet-900",
}


interface Course {
  id: string
  title: string
  instructor: string
  instructorInitial: string
  category: string
  rating: number
  reviews: number
  duration: string
  lessons: number
  price: number
  enrolled: number
  logo: string
  logoClass: string
}

const courses: Course[] = [
  {
    id: "1",
    title: "Ihlamudheen Madrasa",
    instructor: "Ihlamudheen Academy",
    instructorInitial: "H",
    category: "Islamic Studies",
    rating: 4.9,
    reviews: 1247,
    duration: "120 hours",
    lessons: 48,
    price: 0,
    enrolled: 4520,
    logo: "/logo.png",
    logoClass: "h-24 w-auto object-contain",
  },
  {
    id: "2",
    title: "Kammu Musliyar Memorial School",
    instructor: "Ihlamudheen Academy",
    instructorInitial: "H",
    category: "Language",
    rating: 4.8,
    reviews: 983,
    duration: "96 hours",
    lessons: 36,
    price: 0,
    enrolled: 3890,
    logo: "/logo-icon.png",
    logoClass: "h-24 w-auto object-contain",
  },
  {
    id: "3",
    title: "CIBIS",
    instructor: "Ihlamudheen Academy",
    instructorInitial: "H",
    category: "Professional",
    rating: 4.7,
    reviews: 756,
    duration: "80 hours",
    lessons: 32,
    price: 0,
    enrolled: 2340,
    logo: "/logo-icon.png",
    logoClass: "h-24 w-auto object-contain",
  },
  {
    id: "4",
    title: "Kammu Musliyar Memorial School",
    instructor: "Ihlamudheen Academy",
    instructorInitial: "H",
    category: "Professional",
    rating: 4.8,
    reviews: 892,
    duration: "100 hours",
    lessons: 40,
    price: 0,
    enrolled: 3120,
    logo: "/logo.png",
    logoClass: "h-24 w-auto object-contain",
  },
]

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            "h-3.5 w-3.5",
            star <= Math.round(rating)
              ? "fill-gold-500 text-gold-500"
              : "fill-muted text-muted"
          )}
        />
      ))}
      <span className="ml-1 text-sm font-medium">{rating}</span>
    </div>
  )
}

export default function CoursesPage() {
  const [activeCategory, setActiveCategory] = useState("All")
  const [searchQuery, setSearchQuery] = useState("")

  const filteredCourses = courses.filter((course) => {
    const matchesCategory =
      activeCategory === "All" || course.category === activeCategory
    const matchesSearch = course.title
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
    return matchesCategory && matchesSearch
  })

  return (
    <div className="min-h-screen bg-[#fdf8f0] dark:bg-background relative perspective-container">
      {/* Scattered symbols background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
        <ScatteredSymbols count={12} variant="dark" />
        <div className="absolute top-1/4 -left-20 w-64 h-64 rounded-full bg-gold-500/5 animate-breathe" />
        <div className="absolute bottom-1/4 -right-20 w-72 h-72 rounded-full bg-emerald-500/5 animate-breathe-slow" />
      </div>
      <Navbar />

      {/* Hero Banner */}
      <section className="relative overflow-hidden bg-gradient-to-br from-navy-900 via-navy-800 to-navy-700 py-20">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute left-1/4 top-1/4 h-64 w-64 rounded-full bg-gold-500 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 h-48 w-48 rounded-full bg-gold-400 blur-3xl" />
        </div>
        <div className="container relative mx-auto px-4 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex items-center justify-center gap-4 mb-4"
          >
            <Image src="/logo.png" alt="Ihlamudheen Madrasa" width={48} height={48} className="size-12 rounded-full ring-2 ring-gold-500/30" />
            <Image src="/logo.png" alt="Ihlamudheen Madrasa" width={140} height={40} className="h-8 w-auto rounded" />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="mb-4 text-4xl font-bold tracking-tight text-white md:text-5xl"
          >
            Explore Our Courses
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mb-8 text-lg text-navy-200"
          >
            Discover our Islamic and professional education programs at Ihlamudheen Madrasa
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mx-auto max-w-xl"
          >
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search courses by title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-12 rounded-xl border-navy-600 bg-white/10 pl-12 text-base text-white placeholder:text-navy-300 backdrop-blur-sm focus-visible:border-gold-500 focus-visible:ring-gold-500/30"
              />
            </div>
          </motion.div>
        </div>
      </section>

      {/* Filter Bar & Content */}
      <section className="container mx-auto px-4 py-10">
        {/* Category Pills */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mb-8 flex flex-wrap items-center gap-2"
        >
          {categories.map((cat) => {
            const Icon = cat.icon
            return (
              <Button
                key={cat.label}
                variant={activeCategory === cat.label ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveCategory(cat.label)}
                className={cn(
                  "gap-1.5 rounded-full px-4 transition-all",
                  activeCategory === cat.label &&
                    "bg-navy-800 text-white hover:bg-navy-700 dark:bg-navy-600"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {cat.label}
              </Button>
            )
          })}
        </motion.div>

        {/* Results Count */}
        <p className="mb-6 text-sm text-muted-foreground">
          Showing{" "}
          <span className="font-semibold text-foreground">
            {filteredCourses.length}
          </span>{" "}
          of{" "}
          <span className="font-semibold text-foreground">
            {courses.length}
          </span>{" "}
          courses
        </p>

        {/* Course Grid */}
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="visible"
          className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {filteredCourses.map((course, i) => {
            const gradient =
              categoryGradients[course.category] ||
              "from-slate-100 to-slate-200 dark:from-navy-600 dark:to-navy-800"
            return (
              <motion.div
                key={course.id}
                variants={fadeUp}
                custom={i}
              >
                <Card className="group h-full transition-shadow hover:shadow-lg">
                  {/* Thumbnail */}
                  <div
                    className={cn(
                      "relative flex h-44 items-center justify-center bg-gradient-to-br",
                      gradient
                    )}
                  >
                    <CourseLogo id={course.id} title={course.title} className={course.logoClass} />
                    <div className="absolute right-3 top-3">
                      <Badge
                        variant="secondary"
                        className="bg-white/90 text-xs font-medium text-navy-900"
                      >
                        {course.category}
                      </Badge>
                    </div>
                  </div>

                  <CardContent className="flex flex-1 flex-col gap-3">
                    {/* Title */}
                    <h3 className="line-clamp-2 font-semibold leading-snug">
                      {course.title}
                    </h3>

                    {/* Instructor */}
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-100 text-xs font-semibold text-navy-700 dark:bg-navy-800 dark:text-navy-200">
                        {course.instructorInitial}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {course.instructor}
                      </span>
                    </div>

                    {/* Rating */}
                    <StarRating rating={course.rating} />

                    {/* Meta */}
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {course.duration}
                      </span>
                      <span className="flex items-center gap-1">
                        <BookOpen className="h-3.5 w-3.5" />
                        {course.lessons} lessons
                      </span>
                    </div>

                    {/* Price & CTA */}
                    <div className="mt-auto flex items-center justify-between pt-2">
                      {course.price === 0 ? (
                        <Badge
                          variant="secondary"
                          className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        >
                          Free
                        </Badge>
                      ) : (
                        <span className="text-lg font-bold text-navy-900 dark:text-navy-100">
                          ${course.price}
                        </span>
                      )}
                      <Link href={`/courses/${course.id}`}>
                        <Button
                          size="sm"
                          className="bg-gold-500 text-navy-950 hover:bg-gold-600"
                        >
                          View Details
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>

        {/* Empty State */}
        {filteredCourses.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="py-20 text-center"
          >
            <Search className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <h3 className="mb-2 text-lg font-semibold">No courses found</h3>
            <p className="text-muted-foreground">
              Try adjusting your search or filter to find what you are looking
              for.
            </p>
          </motion.div>
        )}
      </section>

      <Footer />
    </div>
  )
}
