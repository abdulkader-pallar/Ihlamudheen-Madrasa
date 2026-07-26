import nodemailer from "nodemailer"
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireRole } from "@/lib/api-auth"

// Logo hosted on Supabase public storage — permanently accessible, Gmail-compatible
const LOGO_URL = "https://vuzbbtwlclanotmnouny.supabase.co/storage/v1/object/public/assets/logo.png"

export async function POST(request: Request) {
  try {
    const guard = await requireRole(request, ["admin", "accountant"])
    if (guard.error) return guard.error

    const { teacherName, amount, type, month, testEmail } = await request.json()
    const gmailUser = process.env.GMAIL_USER || "info@example.com"
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    // Skip silently when app password not configured — don't block the payment action
    if (!gmailAppPassword) {
      return NextResponse.json({ success: true, skipped: true, reason: "Email not configured" })
    }

    // Look up teacher's email from Supabase auth users
    let teacherEmail: string | null = null
    if (supabaseUrl && serviceRoleKey) {
      const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const { data: usersData } = await adminClient.auth.admin.listUsers()
      const teacher = usersData?.users?.find((u) => {
        const meta = u.user_metadata || {}
        const name = (meta.full_name || meta.name || "").trim()
        return name.toLowerCase() === teacherName.toLowerCase().trim()
      })
      teacherEmail = teacher?.email || null
    }

    // Allow testEmail override only outside production — prevents anyone from
    // sending institute-branded mail to an arbitrary address in prod.
    if (testEmail && process.env.NODE_ENV !== "production") teacherEmail = testEmail

    if (!teacherEmail) {
      return NextResponse.json({ success: true, skipped: true, reason: "No email found for teacher" })
    }

    const recipientEmail = teacherEmail

    const monthLabel = new Date(month + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" })
    const typeLabel = type === "salary" ? "salary" : "transport allowance"
    const typeLabelCap = type === "salary" ? "Salary" : "Transport Allowance"

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailAppPassword },
    })

    await transporter.sendMail({
      from: '"Ihlamudheen Madrasa" <' + gmailUser + '>',
      to: recipientEmail,
      subject: "Payment Confirmation - " + typeLabelCap + " for " + monthLabel,
      html: buildEmailHtml(teacherName, typeLabel, typeLabelCap, monthLabel, amount),
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send email" },
      { status: 500 }
    )
  }
}

function buildEmailHtml(
  teacherName: string,
  typeLabel: string,
  typeLabelCap: string,
  monthLabel: string,
  amount: number
): string {
  return [
    '<!DOCTYPE html><html lang="en"><head>',
    '<meta name="color-scheme" content="light only" />',
    '<meta name="supported-color-schemes" content="light only" />',
    '<style>:root { color-scheme: light only; }</style>',
    '</head><body style="margin:0;padding:0;background:#f9f6f0;">',
    '<div style="color-scheme: light; font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #f9f6f0; border-radius: 12px;">',
    '  <div style="background: #ffffff; border-radius: 8px; padding: 28px 32px; margin-bottom: 24px; text-align: center; border-bottom: 4px solid #c9a84c;">',
    '    <img src="' + LOGO_URL + '" alt="Ihlamudheen Madrasa" width="220" style="width: 220px; height: auto; display: block; margin: 0 auto 12px;" />',
    '    <p style="color: #7a6a3a; margin: 0; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; font-weight: 600;">Ihlamudheen Madrasa</p>',
    '  </div>',
    '  <div style="background: white; border-radius: 8px; padding: 28px 32px; border: 1px solid #e2d9c8;">',
    '    <p style="font-size: 16px; color: #1a2b4a; margin: 0 0 20px; text-align: right; direction: rtl;">\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u064a\u0643\u0645 \u0648\u0631\u062d\u0645\u0629 \u0627\u0644\u0644\u0647 \u0648\u0628\u0631\u0643\u0627\u062a\u0647\u060c</p>',
    '    <p style="font-size: 15px; color: #2d3748; margin: 0 0 8px;">Dear <strong>' + teacherName + '</strong>,</p>',
    '    <p style="font-size: 15px; color: #4a5568; margin: 0 0 20px; line-height: 1.7;">This is to inform you that your <strong>' + typeLabel + '</strong> for the month of <strong>' + monthLabel + '</strong> amounting to <strong style="color: #1a7a4a; font-size: 16px;">' + amount + ' AED</strong> has been successfully processed and paid.</p>',
    '    <div style="background: #f0faf4; border: 1px solid #b2dfdb; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">',
    '      <table style="width: 100%; font-size: 14px; color: #2d3748;">',
    '        <tr><td style="padding: 4px 0; color: #718096;">Payment Type</td><td style="padding: 4px 0; font-weight: bold; text-align: right;">' + typeLabelCap + '</td></tr>',
    '        <tr><td style="padding: 4px 0; color: #718096;">Month</td><td style="padding: 4px 0; font-weight: bold; text-align: right;">' + monthLabel + '</td></tr>',
    '        <tr><td style="padding: 4px 0; color: #718096;">Amount</td><td style="padding: 4px 0; font-weight: bold; text-align: right; color: #1a7a4a;">' + amount + ' AED</td></tr>',
    '        <tr><td style="padding: 4px 0; color: #718096;">Status</td><td style="padding: 4px 0; font-weight: bold; text-align: right; color: #1a7a4a;">\u2713 Paid</td></tr>',
    '      </table>',
    '    </div>',
    '    <p style="font-size: 14px; color: #718096; margin: 0 0 20px;">Kindly confirm receipt at your convenience.</p>',
    '    <div style="border-top: 1px solid #e2d9c8; padding-top: 16px; margin-top: 4px;">',
    '      <p style="font-size: 15px; color: #1a2b4a; margin: 0 0 8px; text-align: right; direction: rtl;">\u062c\u0632\u0627\u0643\u0645 \u0627\u0644\u0644\u0647 \u062e\u064a\u0631\u064b\u0627.</p>',
    '      <p style="font-size: 13px; color: #4a5568; margin: 0;">Regards, <strong style="color: #1a2b4a;">Ihlamudheen Madrasa</strong> &mdash; Ihlamudheen Madrasa, UAE</p>',
    '      <p style="font-size: 11px; color: #a0aec0; margin: 8px 0 0;">This is an automated payment notification. Please do not reply to this email.</p>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join("\n")
}
