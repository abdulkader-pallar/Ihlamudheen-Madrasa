"use client"

import { use, useEffect, useState } from "react"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"

interface VerifyResult {
  valid: boolean
  student?: string
  reg?: string
  item?: string
  edition?: string
  theme?: string | null
  type?: string
  rank?: number | null
  grade?: string | null
  issued_at?: string
}

const TYPE_LABEL: Record<string, string> = {
  winner: "Certificate of Achievement",
  participation: "Certificate of Participation",
  appreciation: "Certificate of Appreciation",
}

// Public certificate verification (§F). Standalone branded page — not inside the
// staff /fest shell, so anyone with the QR can confirm authenticity.
export default function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [res, setRes] = useState<VerifyResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.rpc("fest_verify_certificate", { p_token: token })
      .then(({ data }) => setRes((data ?? { valid: false }) as VerifyResult))
      .then(() => setLoading(false))
  }, [token])

  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-50 p-4 dark:bg-navy-950">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-8 text-center shadow-lg dark:bg-navy-900">
        {/* Ihlamudheen Madrasa letterhead (centered stack per branding rules) */}
        {/* eslint-disable-next-line @next/next/no-img-element -- public page, plain logo with onerror fallback */}
        <img src="/logo.png" alt="Ihlamudheen Madrasa" className="mx-auto mb-2 h-10 w-auto object-contain"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
        <h1 className="whitespace-nowrap text-lg font-extrabold tracking-tight text-navy-800 dark:text-white">
          Ihlamudheen Madrasa
        </h1>
        <p className="mb-6 text-xs text-navy-500">Ihlamudheen Madrasa · Malappuram, Kerala</p>

        {loading ? (
          <div className="flex flex-col items-center gap-2 py-6 text-navy-500">
            <Loader2 className="size-6 animate-spin" /> Verifying…
          </div>
        ) : res?.valid ? (
          <div className="space-y-3">
            <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600">Verified Authentic</p>
            <div className="rounded-lg bg-navy-50 p-4 text-left text-sm dark:bg-navy-800">
              <Row k="Name" v={res.student?.trim()} />
              <Row k="Certificate" v={TYPE_LABEL[res.type ?? ""] ?? res.type} />
              <Row k="Item" v={res.item} />
              {res.rank ? <Row k="Rank" v={String(res.rank)} /> : null}
              {res.grade && res.grade !== "-" ? <Row k="Grade" v={res.grade} /> : null}
              <Row k="Edition" v={res.edition} />
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-4">
            <XCircle className="mx-auto size-12 text-red-500" />
            <p className="text-sm font-semibold text-red-600">Not found or not yet published</p>
            <p className="text-xs text-navy-500">This certificate could not be verified. Check the code, or it may not be published yet.</p>
          </div>
        )}
      </div>
    </main>
  )
}

function Row({ k, v }: { k: string; v?: string }) {
  if (!v) return null
  return (
    <div className="flex justify-between gap-4 border-b border-border/40 py-1.5 last:border-0">
      <span className="text-navy-500">{k}</span>
      <span className="font-medium text-navy-800 dark:text-navy-100">{v}</span>
    </div>
  )
}
