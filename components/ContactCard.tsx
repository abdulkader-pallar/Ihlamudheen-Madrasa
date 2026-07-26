"use client"

import { useState } from "react"
import { Phone, UserPlus, MapPin, Mail, Globe, Share2 } from "lucide-react"
import { toast } from "sonner"

/* ───────────────────────────────────────────────────────────────────────────
   DIGITAL CONTACT CARD  ·  Ihlamudheen Madrasa
   Public, no-login page (like the QR business-card in the brief).

   👉 EDIT THE VALUES BELOW with the institute's real details.
   Items already filled from the existing site are marked ✓; the ones marked
   TODO are placeholders you must replace.
─────────────────────────────────────────────────────────────────────────── */
// 👉 TODO: replace every value below with the institute's real details.
const CARD = {
  name: "Ihlamudheen Madrasa",
  subline: "Ihlamudheen Madrasa · Malappuram, Kerala",

  phone: "+910000000000",                 // TODO main contact number
  whatsapp: "910000000000",               // TODO digits only, country code, NO "+"
  email: "info@example.com",              // TODO public email

  website: "https://ihlamudheen-madrasa.vercel.app",   // TODO
  instagram: "",                                       // TODO
  facebook: "",                                        // TODO

  mapsUrl: "",                                         // TODO
  address: "Malappuram, Kerala",
}

// The public URL of this very card — used by Save/Share.
const cardUrl = () =>
  typeof window !== "undefined" ? `${window.location.origin}/card` : `${CARD.website}/card`

/* Build a vCard 3.0 string the phone's Contacts app can import. */
function buildVCard(): string {
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${CARD.name}`,
    `ORG:${CARD.name};Ihlamudheen Madrasa`,
    `TEL;TYPE=WORK,VOICE:${CARD.phone}`,
    `EMAIL;TYPE=WORK:${CARD.email}`,
    `URL:${CARD.website}`,
    `ADR;TYPE=WORK:;;${CARD.address};;;;`,
    `NOTE:Digital card — ${cardUrl()}`,
    "END:VCARD",
  ].join("\r\n")
}

function saveContact() {
  const blob = new Blob([buildVCard()], { type: "text/vcard;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "Ihlamudheen-Madrasa.vcf"
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  toast.success("Contact downloaded — open it to save")
}

async function shareCard() {
  const url = cardUrl()
  const data = { title: CARD.name, text: `${CARD.name} — ${CARD.subline}`, url }
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share(data)
      return
    } catch {
      /* user dismissed the share sheet — fall through to copy */
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    toast.success("Card link copied to clipboard")
  } catch {
    toast.error("Couldn't share — copy the URL from the address bar")
  }
}

/* Brand WhatsApp glyph (lucide has no official one). */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 018.413 3.488 11.82 11.82 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-.607zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
    </svg>
  )
}

/* Brand Instagram glyph (lucide v1 dropped its brand icons). */
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  )
}

/* Brand Facebook glyph. */
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

type Action = {
  label: string
  href?: string
  onClick?: () => void
  color: string // icon color
  Icon: React.ComponentType<{ className?: string }>
  wide?: boolean
}

const actions: Action[] = [
  { label: "Call",          href: `tel:${CARD.phone}`,                                       color: "#1e3a5f", Icon: Phone },
  { label: "Save Contact",  onClick: saveContact,                                            color: "#1e3a5f", Icon: UserPlus },
  { label: "WhatsApp",      href: `https://wa.me/${CARD.whatsapp}`,                          color: "#25D366", Icon: WhatsAppIcon },
  { label: "Location",      href: CARD.mapsUrl,                                              color: "#EA4335", Icon: MapPin },
  { label: "Email",         href: `mailto:${CARD.email}`,                                    color: "#1e3a5f", Icon: Mail },
  { label: "Website",       href: CARD.website,                                              color: "#1DA1F2", Icon: Globe },
  { label: "Instagram",     href: CARD.instagram,                                            color: "#E1306C", Icon: InstagramIcon },
  { label: "Facebook",      href: CARD.facebook,                                             color: "#1877F2", Icon: FacebookIcon },
  { label: "Share Contact", onClick: shareCard,                                              color: "#1e3a5f", Icon: Share2, wide: true },
]

function Tile({
  label,
  href,
  onClick,
  color,
  Icon,
  wide,
  selected,
  onSelect,
}: Action & { selected: boolean; onSelect: () => void }) {
  const inner = (
    <>
      <Icon className="h-7 w-7" />
      <span className="mt-2 text-sm font-semibold text-navy-900">{label}</span>
    </>
  )
  const className = [
    "magic-tile flex flex-col items-center justify-center rounded-2xl border border-navy-100",
    "bg-white px-4 py-6",
    wide ? "col-span-2" : "",
    selected ? "is-selected" : "",
  ]
    .filter(Boolean)
    .join(" ")

  if (href) {
    const external = href.startsWith("http")
    return (
      <a
        href={href}
        className={className}
        style={{ color }}
        onClick={onSelect}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {inner}
      </a>
    )
  }
  return (
    <button
      type="button"
      onClick={() => {
        onSelect()
        onClick?.()
      }}
      className={className}
      style={{ color }}
    >
      {inner}
    </button>
  )
}

export default function ContactCard() {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <main className="min-h-screen bg-gradient-to-b from-navy-50 to-white px-4 py-10">
      <div className="mx-auto w-full max-w-xl">
        {/* ── Ihlamudheen Madrasa letterhead: centered vertical stack ── */}
        <header className="mb-8 border-b-2 border-navy-800 pb-5 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Ihlamudheen Madrasa"
            className="mx-auto mb-2 block h-12 w-auto object-contain"
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = "none"
            }}
          />
          <h1 className="whitespace-nowrap text-xl font-extrabold tracking-tight text-navy-900 sm:text-2xl">
            {CARD.name}
          </h1>
          <p className="mt-1 text-xs text-navy-600 sm:text-sm">{CARD.subline}</p>
          <span className="mt-3 inline-block rounded bg-navy-800 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
            Digital Card
          </span>
        </header>

        {/* ── Action grid ── */}
        <div className="grid grid-cols-2 gap-4">
          {actions.map((a) => (
            <Tile
              key={a.label}
              {...a}
              selected={selected === a.label}
              onSelect={() => setSelected(a.label)}
            />
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-navy-400">
          Ihlamudheen Madrasa · Ihlamudheen Madrasa
        </p>
      </div>
    </main>
  )
}
