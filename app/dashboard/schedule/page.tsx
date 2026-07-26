"use client"

import { motion } from "framer-motion"
import { Calendar, Clock, Video, MapPin } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const scheduleItems = [
  {
    day: "Friday",
    items: [
      { time: "7:00 PM", title: "CBIS", type: "FACE TO FACE", location: "Ihlamudheen Madrasa TRAINING INSTITUTE", duration: "2h" },
    ],
  },
  {
    day: "Saturday",
    items: [
      { time: "9:00 AM", title: "Ihlamudheen Madrasa GRADE 1A, 2A, 3A, 5A, 7A", type: "FACE TO FACE", location: "Ihlamudheen Madrasa TRAINING INSTITUTE", duration: "4.5h" },
      { time: "9:00 PM", title: "Ihlamudheen Madrasa GRADE 9A, 10A", type: "Live Session", location: "Online", duration: "2h" },
    ],
  },
  {
    day: "Sunday",
    items: [
      { time: "9:00 AM", title: "Ihlamudheen MADRSA GRADE 1B, 2B, 4B, 6B, 8B", type: "FACE TO FACE", location: "Ihlamudheen Madrasa TRAINING INSTITUTE", duration: "2h" },
    ],
  },
  {
    day: "Monday",
    items: [
      { time: "9:00 AM", title: "Ihlamudheen Madrasa", type: "FACE TO FACE", location: "Ihlamudheen Madrasa TRAINING INSTITUTE", duration: "3h" },
    ],
  },
  {
    day: "Tuesday",
    items: [
      { time: "9:00 AM", title: "Ihlamudheen Madrasa", type: "FACE TO FACE", location: "Ihlamudheen Madrasa TRAINING INSTITUTE", duration: "3h" },
    ],
  },
  {
    day: "Wednesday",
    items: [
      { time: "9:00 AM", title: "Ihlamudheen Madrasa", type: "FACE TO FACE", location: "Ihlamudheen Madrasa TRAINING INSTITUTE", duration: "3h" },
    ],
  },
  {
    day: "Thursday",
    items: [
      { time: "9:00 AM", title: "Ihlamudheen Madrasa", type: "FACE TO FACE", location: "Ihlamudheen Madrasa TRAINING INSTITUTE", duration: "3h" },
    ],
  },
]

const typeColors: Record<string, string> = {
  "Live Session": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "FACE TO FACE": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "Assignment Due": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  Meeting: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "Office Hours": "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  Quiz: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

export default function SchedulePage() {
  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-3xl font-bold text-navy-900 dark:text-white">Schedule</h1>
        <p className="mt-1 text-navy-600 dark:text-navy-300">
          Your weekly class schedule and upcoming events.
        </p>
      </motion.div>

      <div className="space-y-4">
        {scheduleItems.map((day, di) => (
          <motion.div
            key={day.day}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: di * 0.08 }}
          >
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Calendar className="size-5 text-gold-500" />
                  {day.day}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {day.items.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-4 rounded-lg border border-border/50 p-3 transition-colors hover:bg-navy-50/50 dark:hover:bg-navy-800/50"
                  >
                    <div className="flex flex-col items-center text-center min-w-[60px]">
                      <Clock className="size-4 text-navy-400 mb-1" />
                      <span className="text-sm font-medium text-navy-700 dark:text-navy-200">
                        {item.time}
                      </span>
                      <span className="text-xs text-navy-400">{item.duration}</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-navy-900 dark:text-white">{item.title}</h4>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[item.type] || ""}`}>
                          {item.type}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-navy-400">
                          {item.location === "Online" ? (
                            <Video className="size-3" />
                          ) : (
                            <MapPin className="size-3" />
                          )}
                          {item.location}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
