// ── Drive connection status (diagnostic) ─────────────────────────────────────
// Reports whether uploads to Drive will work. Prefers OAuth (upload as the
// institute's own account) and falls back to the service account. Both paths
// run a real write test so a green status is trustworthy.

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/api-auth"
import { checkDriveAccess, isDriveConfigured } from "@/lib/google-drive"
import { isOAuthConfigured, getOAuthConnection, checkOAuthDriveAccess } from "@/lib/google-oauth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const guard = await requireRole(request, ["admin", "accountant", "teacher"])
  if (guard.error) return guard.error

  const oauthConfigured = isOAuthConfigured()
  const conn = await getOAuthConnection()

  if (conn.connected) {
    const w = await checkOAuthDriveAccess()
    return NextResponse.json({
      method: "oauth",
      oauthConfigured,
      connected: true,
      configured: true,
      ok: w.ok,
      canWrite: w.ok,
      folderName: w.folderName,
      email: w.email,
      error: w.ok ? undefined : w.error,
    })
  }

  // Not connected via OAuth — report service-account status (if any).
  const sa = await checkDriveAccess()
  return NextResponse.json({
    method: "service_account",
    oauthConfigured,
    connected: false,
    configured: sa.configured || isDriveConfigured(),
    ok: sa.ok,
    canWrite: sa.canWrite,
    folderName: sa.folderName,
    serviceAccountEmail: sa.serviceAccountEmail,
    error: sa.error,
  })
}
