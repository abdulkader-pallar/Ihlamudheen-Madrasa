// ╔══════════════════════════════════════════════════════════════════╗
// ║ Ihlamudheen Madrasa Fest — notification templates (§I)                      ║
// ║                                                                    ║
// ║ Pure, unit-tested message composers. Email is the free baseline    ║
// ║ (sent server-side via Resend when configured — see                 ║
// ║ /api/fest/announce); WhatsApp/SMS are optional and provider-gated.  ║
// ║ The results "announcement" doubles as a copy-paste WhatsApp post.   ║
// ╚══════════════════════════════════════════════════════════════════╝

export interface EmailMessage { subject: string; body: string }

export function composeRegistrationEmail(p: {
  name: string
  editionName: string
  items: string[]
}): EmailMessage {
  const items = p.items.length ? p.items.map((i) => `• ${i}`).join("\n") : "• (no items yet)"
  return {
    subject: `Registration confirmed — ${p.editionName}`,
    body:
      `Assalamu Alaikum,\n\n` +
      `${p.name.trim()} is registered for ${p.editionName} in:\n${items}\n\n` +
      `We'll share the schedule soon, in shaa Allah.\n\nIhlamudheen Madrasa`,
  }
}

export function composeCertificateReadyEmail(p: {
  name: string
  editionName: string
}): EmailMessage {
  return {
    subject: `Certificate ready — ${p.editionName}`,
    body:
      `Assalamu Alaikum,\n\n` +
      `${p.name.trim()}'s certificate for ${p.editionName} is ready to download from the ` +
      `Ihlamudheen Madrasa Fest portal. Each certificate carries a QR code for verification.\n\n` +
      `Ihlamudheen Madrasa`,
  }
}

/** A WhatsApp/email-friendly winners announcement ("press release"). */
export function composeResultsAnnouncement(p: {
  editionName: string
  winners: Array<{ item: string; rank: number; name: string }>
}): string {
  const place = (r: number) => (["", "🥇 1st", "🥈 2nd", "🥉 3rd"][r] ?? `${r}th`)
  const byItem = new Map<string, Array<{ rank: number; name: string }>>()
  for (const w of p.winners) {
    const list = byItem.get(w.item) ?? []
    list.push({ rank: w.rank, name: w.name })
    byItem.set(w.item, list)
  }
  const lines: string[] = [`🌙 ${p.editionName} — Results`, ""]
  for (const [item, ws] of Array.from(byItem.entries())) {
    lines.push(`*${item}*`)
    ws.sort((a, b) => a.rank - b.rank).forEach((w) => lines.push(`${place(w.rank)} — ${w.name.trim()}`))
    lines.push("")
  }
  lines.push("Ihlamudheen Madrasa · Ihlamudheen Madrasa")
  return lines.join("\n").trim()
}
