import nodemailer from "nodemailer"
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireRole } from "@/lib/api-auth"
import { composeResultsAnnouncement } from "@/lib/fest/notify"

// Builds the day's winners announcement server-side (so it can read results with
// the service role) and returns the WhatsApp/email-ready text. Optionally emails
// it to `to` when Gmail is configured — otherwise it just returns the text for
// copy-paste, so the feature works with zero provider setup (§I email baseline).
export async function POST(request: Request) {
  try {
    const guard = await requireRole(request, ["admin", "accountant"])
    if (guard.error) return guard.error

    const { editionId, to } = await request.json()
    if (!editionId) return NextResponse.json({ error: "editionId required" }, { status: 400 })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: "Server not configured" }, { status: 500 })
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: ed } = await admin.from("fest_editions").select("name").eq("id", editionId).single()
    const { data: results } = await admin.from("fest_results")
      .select("rank, item:fest_items(name), registration:fest_registrations(student:fest_students(name))")
      .eq("edition_id", editionId).lte("rank", 3)

    const winners = ((results ?? []) as unknown as Array<{
      rank: number | null
      item: { name: string } | null
      registration: { student: { name: string } | null } | null
    }>).map((r) => ({
      item: r.item?.name ?? "—",
      rank: r.rank ?? 0,
      name: r.registration?.student?.name ?? "—",
    }))

    const text = composeResultsAnnouncement({
      editionName: (ed as { name: string } | null)?.name ?? "Ihlamudheen Madrasa Fest",
      winners,
    })

    // Optional email delivery (skipped silently if Gmail isn't configured).
    const gmailUser = process.env.GMAIL_USER || "info@example.com"
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD
    let emailed = false
    if (to && gmailAppPassword) {
      const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailAppPassword } })
      await transporter.sendMail({
        from: '"Ihlamudheen Madrasa" <' + gmailUser + ">",
        to,
        subject: `Ihlamudheen Madrasa Fest Results`,
        text,
      })
      emailed = true
    }

    return NextResponse.json({ text, emailed })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 })
  }
}
