"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { Radio, MessageSquare, Newspaper, Phone, Mail, ArrowRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { useAuth } from "@/hooks/use-auth"

export default function CommunicationPage() {
  useAuth(true)

  const channels = [
    {
      title: "Messages",
      desc: "Chat directly with teachers, staff, and classmates.",
      href: "/dashboard/messages",
      icon: MessageSquare,
      color: "bg-purple-500",
    },
    {
      title: "News & Circulars",
      desc: "School-wide announcements and circulars.",
      href: "/dashboard/news",
      icon: Newspaper,
      color: "bg-pink-500",
    },
  ]

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-navy-900 dark:text-white flex items-center gap-2">
          <Radio className="size-7 text-sky-500" /> Communication
        </h1>
        <p className="mt-1 text-sm text-navy-500 dark:text-navy-400">
          All school communication channels in one place.
        </p>
      </motion.div>

      <div className="grid gap-3 md:grid-cols-2">
        {channels.map((c) => {
          const Icon = c.icon
          return (
            <Link key={c.href} href={c.href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`flex size-11 items-center justify-center rounded-lg text-white ${c.color}`}>
                    <Icon className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-navy-900 dark:text-white">{c.title}</h3>
                    <p className="text-xs text-navy-500 dark:text-navy-400 mt-0.5">{c.desc}</p>
                  </div>
                  <ArrowRight className="size-4 text-navy-400 shrink-0" />
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      <Card>
        <CardContent className="p-5 space-y-3">
          <h2 className="text-base font-semibold text-navy-900 dark:text-white">Direct contact</h2>
          <p className="text-sm text-navy-500 dark:text-navy-400">
            Reach the Ihlamudheen office directly using the contacts below.
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Phone className="size-4 text-sky-500" />
              <span className="text-navy-600 dark:text-navy-300">Office phone — see Profile page</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Mail className="size-4 text-sky-500" />
              <span className="text-navy-600 dark:text-navy-300">majeed@example.com</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
