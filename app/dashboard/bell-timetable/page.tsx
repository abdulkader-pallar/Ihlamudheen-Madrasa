"use client"

import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { Bell, Clock, Coffee, BookOpen, Sun, FileText, Printer, DoorOpen } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  BELL_TIMETABLES,
  formatTime,
  formatDuration,
  getBellMoments,
  getTimetableNow,
  type BellTimetable,
  type TimetableSegment,
} from "@/data/bell-timetable"
import { BRAND_NAME, BRAND_SUBLINE, BRAND_LOGO_URL, addReportHeader } from "@/lib/branding"

const NAVY: [number, number, number] = [30, 58, 95]

export default function BellTimetablePage() {
  const [now, setNow] = useState<Date | null>(null)
  const [selectedId, setSelectedId] = useState<string>(BELL_TIMETABLES[0].id)

  // Live clock — tick every second once mounted (avoids SSR hydration mismatch).
  useEffect(() => {
    const d = new Date()
    setNow(d)
    // On first mount, default to a timetable that runs today, if any.
    const todays = BELL_TIMETABLES.find((t) => t.dayIndexes.includes(d.getDay()))
    if (todays) setSelectedId(todays.id)
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const tt = useMemo(
    () => BELL_TIMETABLES.find((t) => t.id === selectedId) ?? BELL_TIMETABLES[0],
    [selectedId],
  )
  const bells = useMemo(() => getBellMoments(tt), [tt])

  const nowMins = now ? now.getHours() * 60 + now.getMinutes() : -1
  const isTimetableDay = now ? tt.dayIndexes.includes(now.getDay()) : false
  const live = now ? getTimetableNow(tt, nowMins) : null

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-3xl font-bold text-navy-900 dark:text-white">
            <Bell className="size-7 text-gold-500 shrink-0" />
            <span className="truncate">Bell Timetable</span>
          </h1>
          <p className="mt-1 text-navy-600 dark:text-navy-300">
            {tt.program} · {tt.days.join(" & ")} · periods, breaks and bell times.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <button
            onClick={() => printTimetable(tt)}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-200 dark:hover:bg-navy-700 sm:flex-none"
          >
            <Printer className="size-4" /> Print
          </button>
          <button
            onClick={() => exportTimetablePdf(tt)}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-navy-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-800 sm:flex-none"
          >
            <FileText className="size-4" /> Download PDF
          </button>
        </div>
      </motion.div>

      {/* Timetable selector */}
      <div className="flex flex-wrap gap-2">
        {BELL_TIMETABLES.map((t) => {
          const active = t.id === tt.id
          return (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                active
                  ? "border-gold-400 bg-gold-50 text-navy-900 dark:border-gold-500/60 dark:bg-gold-500/10 dark:text-white"
                  : "border-border bg-white text-navy-600 hover:bg-navy-50 dark:bg-navy-800 dark:text-navy-300 dark:hover:bg-navy-700",
              )}
            >
              <div className="font-semibold">{t.program}</div>
              <div className="text-xs text-navy-400 dark:text-navy-500">{t.days.join(" & ")}</div>
            </button>
          )
        })}
      </div>

      {/* Live "now" banner */}
      <LiveBanner timetable={tt} isTimetableDay={isTimetableDay} live={live} now={now} />

      {/* Timetable */}
      <div className="space-y-3">
        {/* First bell */}
        <BellRow
          time={tt.firstBell}
          label="First Bell"
          accent="text-gold-600 dark:text-gold-400"
        />

        {tt.segments.map((seg, i) => {
          const isActive =
            isTimetableDay && live?.status === "active" && live.current?.label === seg.label
          return (
            <div key={seg.label} className="space-y-3">
              <SegmentRow segment={seg} active={!!isActive} index={i} />
              {!seg.noBell && (
                <BellRow
                  time={seg.end}
                  label={bellLabelFor(tt, i)}
                  accent={
                    bellLabelFor(tt, i) === "Final Bell"
                      ? "text-gold-600 dark:text-gold-400"
                      : "text-navy-500 dark:text-navy-400"
                  }
                />
              )}
            </div>
          )
        })}

        {tt.closing && (
          <div className="flex items-center gap-3 pl-3 text-sm">
            <span className="flex items-center gap-1.5 font-medium text-violet-600 dark:text-violet-400">
              <DoorOpen className="size-4" />
              {formatTime(tt.closing.time)}
            </span>
            <span className="text-navy-400 dark:text-navy-500">— {tt.closing.label}</span>
          </div>
        )}
      </div>

      {/* Bell summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bell className="size-5 text-gold-500" />
            All Bells
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {bells.map((b, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-navy-50/60 px-3 py-1 text-xs font-medium text-navy-700 dark:bg-navy-800/60 dark:text-navy-200"
              >
                <Clock className="size-3 text-navy-400" />
                {formatTime(b.time)} · {b.label}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Bell label for the bell rung at segment `i` (mirrors getBellMoments).
function bellLabelFor(tt: BellTimetable, i: number): string {
  const seg = tt.segments[i]
  if (seg.bellLabel) return seg.bellLabel
  let lastRinging = -1
  for (let j = tt.segments.length - 1; j >= 0; j--) {
    if (!tt.segments[j].noBell) { lastRinging = j; break }
  }
  if (i === lastRinging) return "Final Bell"
  if (seg.kind === "break") return "End of Break"
  return "Bell"
}

// ── Live banner ───────────────────────────────────────────────────────
function LiveBanner({
  timetable,
  isTimetableDay,
  live,
  now,
}: {
  timetable: BellTimetable
  isTimetableDay: boolean
  live: ReturnType<typeof getTimetableNow> | null
  now: Date | null
}) {
  if (!now || !live) {
    // Pre-hydration placeholder keeps layout stable.
    return (
      <Card>
        <CardContent className="py-4 text-sm text-navy-500 dark:text-navy-400">Loading current time…</CardContent>
      </Card>
    )
  }

  const clock = now.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })

  let headline: string
  let detail: string
  let tone = "text-navy-600 dark:text-navy-300"

  if (!isTimetableDay) {
    headline = "No session today"
    detail = `${timetable.program} runs on ${timetable.days.join(" & ")}.`
  } else if (live.status === "before") {
    headline = live.next ? `${live.next.label} starts soon` : "Session starting soon"
    detail = `Starts in ${formatDuration(live.minsToNext)}${live.next ? ` (${formatTime(live.next.start)})` : ""}.`
    tone = "text-gold-600 dark:text-gold-400"
  } else if (live.status === "active" && live.current) {
    headline = `${live.current.label} in progress`
    detail = `${formatDuration(live.minsLeftInCurrent)} left${
      live.nextBell ? ` · next bell ${formatTime(live.nextBell.time)} (${live.nextBell.label})` : ""
    }.`
    tone = "text-emerald-600 dark:text-emerald-400"
  } else {
    headline = "Sessions finished for today"
    detail = "All periods are over."
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <Card className="overflow-hidden">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0">
            <div className={cn("text-lg font-semibold", tone)}>{headline}</div>
            <div className="mt-0.5 text-sm text-navy-500 dark:text-navy-400">{detail}</div>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-navy-50 px-3 py-2 dark:bg-navy-800">
            <Clock className="size-4 text-navy-400" />
            <span className="font-mono text-sm font-semibold text-navy-800 dark:text-navy-100">{clock}</span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ── Rows ──────────────────────────────────────────────────────────────
function BellRow({ time, label, accent }: { time: string; label: string; accent: string }) {
  return (
    <div className="flex items-center gap-3 pl-3 text-sm">
      <span className={cn("flex items-center gap-1.5 font-medium", accent)}>
        <Bell className="size-4" />
        {formatTime(time)}
      </span>
      <span className="text-navy-400 dark:text-navy-500">— {label}</span>
    </div>
  )
}

const SEGMENT_STYLE: Record<TimetableSegment["kind"], { icon: typeof BookOpen; circle: string }> = {
  period: { icon: BookOpen, circle: "bg-navy-600" },
  break: { icon: Coffee, circle: "bg-amber-500" },
  prayer: { icon: Sun, circle: "bg-violet-600" },
}

function SegmentRow({
  segment,
  active,
  index,
}: {
  segment: TimetableSegment
  active: boolean
  index: number
}) {
  const { icon: Icon, circle } = SEGMENT_STYLE[segment.kind]
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
    >
      <Card
        className={cn(
          "transition-shadow",
          active &&
            "shadow-[0_0_0_1.5px_#10b981,0_0_16px_rgba(16,185,129,0.3)] dark:shadow-[0_0_0_1.5px_#10b981,0_0_18px_rgba(16,185,129,0.25)]",
        )}
      >
        <CardContent className="flex items-center gap-4 py-3">
          <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-full text-white", circle)}>
            <Icon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-navy-900 dark:text-white">{segment.label}</h4>
              {active && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                  Now
                </span>
              )}
            </div>
            <div className="mt-0.5 text-sm text-navy-500 dark:text-navy-400">
              {formatTime(segment.start)} – {formatTime(segment.end)}
            </div>
          </div>
          <span className="shrink-0 rounded-md bg-navy-50 px-2.5 py-1 text-xs font-medium text-navy-600 dark:bg-navy-800 dark:text-navy-300">
            {formatDuration(segment.durationMin)}
          </span>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ── PDF export (branded, follows CLAUDE.md) ───────────────────────────
async function exportTimetablePdf(tt: BellTimetable) {
  const { default: jsPDF } = await import("jspdf")
  const { default: autoTable } = await import("jspdf-autotable")
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

  const contentY = await addReportHeader(
    doc,
    "Bell Timetable",
    `${tt.program} · ${tt.days.join(" & ")} · Generated ${new Date().toLocaleString("en-IN")}`,
  )

  const body: (string | number)[][] = []
  body.push(["—", formatTime(tt.firstBell), "—", "First Bell"])
  tt.segments.forEach((seg, i) => {
    body.push([
      seg.kind === "break" ? "Break" : seg.label,
      `${formatTime(seg.start)} – ${formatTime(seg.end)}`,
      formatDuration(seg.durationMin),
      seg.noBell ? "—" : `${bellLabelForData(tt, i)} at ${formatTime(seg.end)}`,
    ])
  })
  if (tt.closing) body.push(["—", formatTime(tt.closing.time), "—", tt.closing.label])

  autoTable(doc, {
    startY: contentY,
    head: [["Session", "Time", "Duration", "Bell"]],
    body,
    styles: { fontSize: 10, cellPadding: 3 },
    headStyles: { fillColor: NAVY, halign: "left", valign: "middle" },
    theme: "striped",
    didParseCell: (data) => {
      if (data.section !== "body") return
      const name = String((data.row.raw as (string | number)[] | undefined)?.[0] ?? "")
      if (name === "Break") data.cell.styles.fillColor = [254, 243, 199] // amber-100
      else if (name.includes("Prayer")) data.cell.styles.fillColor = [237, 233, 254] // violet-100
    },
  })

  doc.save(`bell-timetable-${tt.id}.pdf`)
}

// Bell label used in the PDF/print data (mirrors getBellMoments labels).
function bellLabelForData(tt: BellTimetable, i: number): string {
  const seg = tt.segments[i]
  if (seg.bellLabel) return seg.bellLabel
  let lastRinging = -1
  for (let j = tt.segments.length - 1; j >= 0; j--) {
    if (!tt.segments[j].noBell) { lastRinging = j; break }
  }
  if (i === lastRinging) return "Final Bell"
  if (seg.kind === "break") return "End of Break"
  return "Bell"
}

// ── Print (branded HTML window, follows CLAUDE.md centered header) ─────
function printTimetable(tt: BellTimetable) {
  const rows = tt.segments
    .map((seg, i) => {
      const name = seg.kind === "break" ? "Break" : seg.label
      const bellCell = seg.noBell ? "—" : `🔔 ${formatTime(seg.end)} — ${bellLabelForData(tt, i)}`
      const cls = seg.kind === "break" ? ' class="brk"' : seg.kind === "prayer" ? ' class="pray"' : ""
      return `
        <tr${cls}>
          <td>${name}</td>
          <td>${formatTime(seg.start)} – ${formatTime(seg.end)}</td>
          <td>${formatDuration(seg.durationMin)}</td>
          <td>${bellCell}</td>
        </tr>`
    })
    .join("")

  const closingRow = tt.closing
    ? `<tr class="close"><td>${tt.closing.label}</td><td>${formatTime(tt.closing.time)}</td><td>—</td><td>—</td></tr>`
    : ""

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
    <title>Bell Timetable — ${tt.program}</title>
    <style>
      *{box-sizing:border-box;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;}
      body{margin:32px;color:#1e293b;}
      header{text-align:center;border-bottom:2px solid #1e3a5f;padding-bottom:14px;margin-bottom:18px;}
      .logo{height:46px;width:auto;object-fit:contain;display:block;margin:0 auto 8px;}
      .school{font-weight:800;font-size:18pt;letter-spacing:-0.02em;white-space:nowrap;}
      .school-sub{font-size:9pt;color:#5c6b82;margin-top:2px;}
      .badge{display:inline-block;background:#1e3a5f;color:#fff;font-size:9pt;font-weight:700;
             padding:3px 14px;border-radius:3px;text-transform:uppercase;letter-spacing:.06em;margin-top:8px;}
      .meta{text-align:center;font-size:10pt;color:#475569;margin-bottom:16px;}
      .firstbell{text-align:center;font-weight:700;color:#b45309;margin-bottom:14px;}
      table{width:100%;border-collapse:collapse;font-size:11pt;}
      th{background:#1e3a5f;color:#fff;text-align:left;padding:8px 10px;}
      td{padding:8px 10px;border-bottom:1px solid #e2e8f0;}
      tr.brk td{background:#fef3c7;}
      tr.pray td{background:#ede9fe;}
      tr.close td{background:#f1f5f9;font-style:italic;}
      @media print{body{margin:12mm;} button{display:none;}}
    </style></head><body>
    <header>
      <img src="${BRAND_LOGO_URL}" alt="Ihlamudheen Madrasa" class="logo" onerror="this.style.display='none'"/>
      <div class="school">${BRAND_NAME}</div>
      <div class="school-sub">${BRAND_SUBLINE}</div>
      <span class="badge">Bell Timetable</span>
    </header>
    <div class="meta">${tt.program} &middot; ${tt.days.join(" & ")}</div>
    <div class="firstbell">🔔 First Bell — ${formatTime(tt.firstBell)}</div>
    <table>
      <thead><tr><th>Session</th><th>Time</th><th>Duration</th><th>Bell</th></tr></thead>
      <tbody>${rows}${closingRow}</tbody>
    </table>
    <script>window.onload=function(){window.print();}</script>
    </body></html>`

  const w = window.open("", "_blank")
  if (!w) return
  w.document.write(html)
  w.document.close()
}
