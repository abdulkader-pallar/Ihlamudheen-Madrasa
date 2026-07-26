"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Menu, LogIn } from "lucide-react"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ThemeToggle } from "@/components/theme-toggle"

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/courses", label: "Courses" },
  { href: "/#about", label: "About" },
  { href: "/#contact", label: "Contact" },
]

export function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" as const }}
      className="sticky top-0 z-50 w-full border-b border-border/40 bg-white/80 backdrop-blur-xl dark:bg-navy-950/80 header-3d"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="Ihlamudheen Madrasa" width={120} height={36} className="h-9 w-auto rounded" />
          <div className="flex flex-col leading-none">
            <span className="text-lg font-bold text-navy-800 dark:text-white tracking-tight">
              Ihlamudheen
            </span>
            <span className="text-[10px] font-medium text-navy-500 dark:text-navy-300 tracking-wide">
              
            </span>
          </div>
        </Link>

        {/* Desktop nav links */}
        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-100 hover:text-navy-900 dark:text-navy-200 dark:hover:bg-navy-800 dark:hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right side actions */}
        <div className="flex items-center gap-2">
          <ThemeToggle />

          {/* Sign In — icon on mobile, full button on desktop */}
          <Link
            href="/login"
            className="flex sm:hidden size-9 items-center justify-center rounded-lg hover:bg-navy-100 dark:hover:bg-navy-800 transition-colors"
            title="Sign In"
          >
            <LogIn className="size-5 text-gold-500" />
          </Link>
          <div className="hidden items-center gap-2 sm:flex">
            <Link href="/login">
              <Button variant="ghost" className="text-navy-700 dark:text-navy-200">
                Sign In
              </Button>
            </Link>
            <Link href="/#contact">
              <Button className="bg-gold-500 text-white hover:bg-gold-600">
                Join With Us Now
              </Button>
            </Link>
          </div>

          {/* Mobile hamburger */}
          <div className="md:hidden">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger className="inline-flex items-center justify-center rounded-md p-2 text-navy-700 hover:bg-navy-100 dark:text-navy-200 dark:hover:bg-navy-800">
                <Menu className="size-5" />
                <span className="sr-only">Open menu</span>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <Image src="/logo.png" alt="Ihlamudheen Madrasa" width={100} height={28} className="h-7 w-auto rounded" />
                    <span>Ihlamudheen Madrasa</span>
                  </SheetTitle>
                </SheetHeader>
                <nav className="flex flex-col gap-1 px-4 mt-4">
                  {navLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className="rounded-lg px-3 py-2.5 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-100 dark:text-navy-200 dark:hover:bg-navy-800"
                    >
                      {link.label}
                    </Link>
                  ))}
                </nav>
                <div className="mt-auto flex flex-col gap-2 p-4">
                  <Link href="/login" onClick={() => setOpen(false)}>
                    <Button variant="outline" className="w-full">
                      Sign In
                    </Button>
                  </Link>
                  <Link href="/#contact" onClick={() => setOpen(false)}>
                    <Button className="w-full bg-gold-500 text-white hover:bg-gold-600">
                      Join With Us Now
                    </Button>
                  </Link>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </motion.header>
  )
}
