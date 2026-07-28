// ╔══════════════════════════════════════════════════════════════════╗
// ║ Meelad Fest — QR payloads (§7 cross-cutting QR system)         ║
// ║                                                                    ║
// ║ Every student gets a QR encoding their stable reg number + the     ║
// ║ edition, used for event check-in/attendance, participation         ║
// ║ verification, and profile/schedule lookup. The payload is a plain  ║
// ║ delimited string (no PII beyond the reg number) so it scans on any ║
// ║ reader; rendering to an image is done with the `qrcode` lib in the  ║
// ║ components/PDFs.                                                    ║
// ╚══════════════════════════════════════════════════════════════════╝

/** Magic prefix so a scanner can tell our codes apart from arbitrary QRs. */
export const FEST_QR_PREFIX = "RPMF1" // Meelad Fest, v1

export interface StudentQr {
  editionSlug: string
  regNo: string
}

/** Build the QR string for a student in an edition: `RPMF1|<edition>|<reg>`. */
export function studentQrPayload(editionSlug: string, regNo: string): string {
  return [FEST_QR_PREFIX, editionSlug, regNo].join("|")
}

/** Parse a scanned payload back to its parts, or null if it isn't one of ours. */
export function parseStudentQr(payload: string): StudentQr | null {
  if (!payload) return null
  const parts = payload.trim().split("|")
  if (parts.length !== 3) return null
  const [prefix, editionSlug, regNo] = parts
  if (prefix !== FEST_QR_PREFIX) return null
  if (!editionSlug || !regNo) return null
  return { editionSlug, regNo }
}
