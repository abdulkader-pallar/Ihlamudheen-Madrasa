"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Award, Loader2, Download } from "lucide-react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { buildCertificatesPdf, type CertificateData, type CertType } from "@/lib/fest/certificate"

interface EditionOpt { id: string; name: string; theme: string | null }
type Scope = "winners" | "participation"

interface Target {
  registrationId: string; studentId: string | null; itemId: string | null
  name: string; item: string; rank: number | null; grade: string | null
}

export default function FestCertificatesPage() {
  const [editions, setEditions] = useState<EditionOpt[]>([])
  const [editionId, setEditionId] = useState("")
  const [scope, setScope] = useState<Scope>("winners")
  const [busy, setBusy] = useState(false)
  const [lastCount, setLastCount] = useState<number | null>(null)

  const edition = editions.find((e) => e.id === editionId)

  useEffect(() => {
    supabase.from("fest_editions").select("id,name,theme").neq("status", "archived")
      .order("year", { ascending: false })
      .then(({ data }) => {
        const opts = (data ?? []) as EditionOpt[]
        setEditions(opts)
        if (opts.length) setEditionId(opts[0].id)
      })
  }, [])

  const fetchTargets = useCallback(async (eid: string, sc: Scope): Promise<Target[]> => {
    if (sc === "winners") {
      const { data } = await supabase.from("fest_results")
        .select("rank,grade,registration_id, item:fest_items(id,name), registration:fest_registrations(student:fest_students(id,name))")
        .eq("edition_id", eid).lte("rank", 3)
      return ((data ?? []) as unknown as Array<{
        rank: number | null; grade: string | null; registration_id: string
        item: { id: string; name: string } | null
        registration: { student: { id: string; name: string } | null } | null
      }>).map((r) => ({
        registrationId: r.registration_id, studentId: r.registration?.student?.id ?? null,
        itemId: r.item?.id ?? null, name: r.registration?.student?.name ?? "—",
        item: r.item?.name ?? "—", rank: r.rank, grade: r.grade,
      }))
    }
    const { data } = await supabase.from("fest_registrations")
      .select("id, item:fest_items(id,name), student:fest_students(id,name)")
      .eq("edition_id", eid).neq("status", "withdrawn")
    return ((data ?? []) as unknown as Array<{
      id: string; item: { id: string; name: string } | null; student: { id: string; name: string } | null
    }>).map((r) => ({
      registrationId: r.id, studentId: r.student?.id ?? null, itemId: r.item?.id ?? null,
      name: r.student?.name ?? "—", item: r.item?.name ?? "—", rank: null, grade: null,
    }))
  }, [])

  async function generate() {
    if (!editionId || !edition) return
    setBusy(true); setLastCount(null)
    try {
      const targets = await fetchTargets(editionId, scope)
      if (targets.length === 0) { toast.info("No certificates to generate for this scope"); return }

      const type: CertType = scope === "winners" ? "winner" : "participation"
      // Ensure a certificate row (with token) exists per target.
      const rows = targets.map((t) => ({
        edition_id: editionId, registration_id: t.registrationId, student_id: t.studentId,
        item_id: t.itemId, type, rank: t.rank, grade: t.grade,
      }))
      const { error: upErr } = await supabase.from("fest_certificates")
        .upsert(rows, { onConflict: "registration_id,type" })
      if (upErr) throw new Error(upErr.message)

      const { data: certs, error: selErr } = await supabase.from("fest_certificates")
        .select("registration_id,token").eq("edition_id", editionId).eq("type", type)
        .in("registration_id", targets.map((t) => t.registrationId))
      if (selErr) throw new Error(selErr.message)
      const tokenByReg = new Map((certs ?? []).map((c) => {
        const row = c as { registration_id: string; token: string }
        return [row.registration_id, row.token]
      }))

      const origin = typeof window !== "undefined" ? window.location.origin : ""
      const data: CertificateData[] = targets.map((t) => {
        const token = tokenByReg.get(t.registrationId) ?? ""
        return {
          name: t.name, item: t.item, editionName: edition.name, theme: edition.theme,
          type, rank: t.rank, grade: t.grade, token, verifyUrl: `${origin}/verify/${token}`,
        }
      })

      const doc = await buildCertificatesPdf(data)
      doc.save(`ihlamudheen-certificates-${scope}-${edition.name.replace(/\s+/g, "-").toLowerCase()}.pdf`)
      setLastCount(data.length)
      toast.success(`Generated ${data.length} certificate(s)`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/fest" className="text-navy-500 hover:text-navy-700 dark:text-navy-400"><ArrowLeft className="size-5" /></Link>
        <h1 className="text-2xl font-bold tracking-tight text-navy-800 dark:text-white">Certificates</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Award className="size-4 text-gold-500" /> Generate</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-52">
            <label className="mb-1 block text-xs font-medium text-navy-600 dark:text-navy-300">Edition</label>
            <Select value={editionId} onValueChange={(v) => setEditionId(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Edition">{(v: string) => editions.find((e) => e.id === v)?.name ?? "Edition"}</SelectValue></SelectTrigger>
              <SelectContent>{editions.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-52">
            <label className="mb-1 block text-xs font-medium text-navy-600 dark:text-navy-300">Scope</label>
            <Select value={scope} onValueChange={(v) => setScope((v as Scope) ?? "winners")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="winners">Winners (1st–3rd)</SelectItem>
                <SelectItem value="participation">All participants</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={generate} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Generate PDF
          </Button>
          {lastCount !== null && <span className="text-sm text-emerald-600">{lastCount} certificate(s) in the download.</span>}
        </CardContent>
      </Card>

      <p className="text-sm text-navy-500">
        Each certificate carries the Ihlamudheen Madrasa letterhead and a QR linking to a public
        verification page (<code>/verify/&lt;token&gt;</code>). Winner certificates require results
        to be recomputed first; verification only confirms once the edition is published.
      </p>
    </div>
  )
}
