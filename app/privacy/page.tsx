"use client"

import Link from "next/link"
import Image from "next/image"

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <Link href="/" className="flex items-center gap-3 w-fit">
          <Image src="/logo.png" alt="Ihlamudheen Madrasa" width={120} height={36} className="h-9 w-auto rounded" />
          <div className="flex flex-col leading-none">
            <span className="text-base font-bold tracking-tight">Ihlamudheen</span>
            <span className="text-[10px] font-medium text-muted-foreground tracking-wide"></span>
          </div>
        </Link>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Privacy Policy</h1>
          <p className="text-muted-foreground mt-2 text-sm">Last updated: April 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Who We Are</h2>
          <p className="text-muted-foreground leading-relaxed">
            Ihlamudheen Madrasa — Ihlamudheen Madrasa is an educational institution based in Malappuram, Kerala.
            Our campus management platform at <strong>ihlamudheen-madrasa.vercel.app</strong> is used by staff, teachers,
            and administrators to manage student attendance, grades, and communications.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. Information We Collect</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 leading-relaxed">
            <li>Name and email address (used for account creation and login)</li>
            <li>Profile photo (optional, for student records)</li>
            <li>Attendance and academic records (for enrolled students only)</li>
            <li>Google account information (if you choose to sign in with Google)</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. How We Use Your Information</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 leading-relaxed">
            <li>To provide access to the campus management system</li>
            <li>To manage student attendance and academic records</li>
            <li>To send payment notifications to teachers via email or WhatsApp</li>
            <li>We do not sell or share your data with third parties</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Data Storage</h2>
          <p className="text-muted-foreground leading-relaxed">
            All data is securely stored using Supabase (hosted on AWS). Access is restricted to authorised
            staff only using role-based access control.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. Google Sign-In</h2>
          <p className="text-muted-foreground leading-relaxed">
            If you choose to sign in with Google, we receive your name, email address, and profile picture
            from Google. We do not access any other Google account data. You can revoke access at any time
            from your Google Account settings at <a href="https://myaccount.google.com/permissions" className="text-blue-500 underline" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. Your Rights</h2>
          <p className="text-muted-foreground leading-relaxed">
            You may request access to, correction of, or deletion of your personal data at any time
            by contacting the institute administration.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Contact</h2>
          <p className="text-muted-foreground leading-relaxed">
            For any privacy-related queries, please contact Ihlamudheen Madrasa at Malappuram, Kerala
            or reach us through the contact form on our <Link href="/#contact" className="text-blue-500 underline">home page</Link>.
          </p>
        </section>

        <div className="border-t border-border pt-6">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
