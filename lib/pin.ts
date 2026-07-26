// Server-only PIN hashing for the student portal (scrypt, no extra deps).
// Stored format: "scrypt$<saltHex>$<hashHex>".
import { scryptSync, randomBytes, timingSafeEqual } from "crypto"

export function hashPin(pin: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(pin, salt, 32)
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const [scheme, saltHex, hashHex] = stored.split("$")
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false
  try {
    const expected = Buffer.from(hashHex, "hex")
    const actual = scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
