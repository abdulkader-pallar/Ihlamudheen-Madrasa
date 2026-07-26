"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import QRCode from "qrcode"
import { ArrowLeft, Printer, QrCode } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { studentQrPayload } from "@/lib/fest/qr"
import { computeBadges, type Badge as PassportBadge } from "@/lib/fest/badges"

interface EditionLine {
  editionId: string
  editionName: string
  editionSlug: string
  sectionName: string | null
  codeNo: string | null
  grade: number | null
  items: string[]
}
interface Profile {
  regNo: string
  name: string
  editions: EditionLine[]
}

export default function StudentProfilePage({ params }: { params: Promise<{ regId: string }> }) {
  const { regId } = use(params)
  const regNo = decodeURIComponent(regId)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [qr, setQr] = useState<string>("")
  const [badges, setBadges] = useState<PassportBadge[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      const { data: student } = await supabase
        .from("fest_students").select("id,reg_no,name").eq("reg_no", regNo).single()
      if (!student) { setProfile(null); setLoading(false); return }

      const { data: ses } = await supabase
        .from("fest_student_editions")
        .select("code_no, grade, edition:fest_editions(id,name,slug,year), section:fest_sections(name)")
        .eq("student_id", student.id)
      const seRows = (ses ?? []) as unknown as Array<{
        code_no: string | null; grade: number | null
        edition: { id: string; name: string; slug: string; year: number | null } | null
        section: { name: string } | null
      }>

      const { data: regs } = await supabase
        .from("fest_registrations")
        .select("edition_id, item:fest_items(name)")
        .eq("student_id", student.id)
      const itemsByEdition = new Map<string, string[]>()
      for (const r of (regs ?? []) as unknown as Array<{ edition_id: string; item: { name: string } | null }>) {
        if (!r.item) continue
        const list = itemsByEdition.get(r.edition_id) ?? []
        list.push(r.item.name)
        itemsByEdition.set(r.edition_id, list)
      }

      const editions: EditionLine[] = seRows
        .filter((s) => s.edition)
        .map((s) => ({
          editionId: s.edition!.id,
          editionName: s.edition!.name,
          editionSlug: s.edition!.slug,
          sectionName: s.section?.name ?? null,
          codeNo: s.code_no,
          grade: s.grade,
          items: (itemsByEdition.get(s.edition!.id) ?? []).sort(),
        }))
        .sort((a, b) => b.editionName.localeCompare(a.editionName))

      setProfile({ regNo: student.reg_no, name: student.name, editions })

      // Results (rank/grade) per edition → Ihlamudheen Madrasa Passport badges.
      const { data: resData } = await supabase
        .from("fest_results")
        .select("edition_id,rank,grade, registration:fest_registrations!inner(student_id)")
        .eq("registration.student_id", student.id)
      const resByEdition = new Map<string, Array<{ rank: number | null; grade: string | null }>>()
      for (const r of (resData ?? []) as unknown as Array<{ edition_id: string; rank: number | null; grade: string | null }>) {
        const list = resByEdition.get(r.edition_id) ?? []
        list.push({ rank: r.rank, grade: r.grade })
        resByEdition.set(r.edition_id, list)
      }
      setBadges(computeBadges({
        editions: editions.map((e) => ({ items: e.items, results: resByEdition.get(e.editionId) ?? [] })),
      }))

      // QR encodes the most recent edition the student appears in.
      const latest = editions[0]
      if (latest) {
        const payload = studentQrPayload(latest.editionSlug, student.reg_no)
        setQr(await QRCode.toDataURL(payload, { margin: 1, width: 240 }))
      }
      setLoading(false)
    })()
  }, [regNo])

  if (loading) return <p className="py-10 text-center text-sm text-navy-500">Loading…</p>
  if (!profile)
    return (
      <div className="space-y-4">
        <Link href="/fest/registration" className="text-navy-500 hover:text-navy-700"><ArrowLeft className="size-5" /></Link>
        <p className="text-sm text-navy-600">No student found for reg number <strong>{regNo}</strong>.</p>
      </div>
    )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href="/fest/registration" className="text-navy-500 hover:text-navy-700 dark:text-navy-400">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-navy-800 dark:text-white">Student Profile</h1>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => window.print()}>
          <Printer className="size-4" /> Print badge
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><QrCode className="size-4 text-gold-500" /> Ihlamudheen Madrasa Passport</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3 text-center">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- data-URL QR, not a remote asset
              <img src={qr} alt="Student QR" className="size-44 rounded-lg border border-border bg-white p-2" />
            ) : (
              <div className="flex size-44 items-center justify-center rounded-lg border border-dashed text-xs text-navy-400">No edition yet</div>
            )}
            <div>
              <p className="text-lg font-bold text-navy-800 dark:text-white">{profile.name.trim()}</p>
              <p className="text-sm text-navy-500">Reg {profile.regNo}</p>
              {profile.editions[0]?.codeNo && (
                <p className="mt-1 text-xs text-navy-500">Code <span className="font-mono">{profile.editions[0].codeNo}</span></p>
              )}
            </div>
            {badges.length > 0 && (
              <div className="w-full border-t border-border/60 pt-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-navy-500">Badges</p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {badges.map((b) => (
                    <Badge key={b.key} variant="secondary" title={b.description} className="text-[10px]">{b.label}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lifetime record</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {profile.editions.length === 0 && <p className="text-sm text-navy-500">Not enrolled in any edition.</p>}
            {profile.editions.map((e) => (
              <div key={e.editionId} className="rounded-lg border border-border/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-navy-800 dark:text-white">{e.editionName}</span>
                  {e.sectionName && <Badge variant="secondary">{e.sectionName}</Badge>}
                  {e.codeNo && <Badge variant="outline" className="font-mono text-[10px]">#{e.codeNo}</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {e.items.length === 0
                    ? <span className="text-xs text-navy-400">No items</span>
                    : e.items.map((it) => <Badge key={it} variant="outline" className="text-[10px]">{it}</Badge>)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
