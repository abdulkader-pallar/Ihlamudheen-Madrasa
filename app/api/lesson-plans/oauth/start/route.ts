// Begin the Google OAuth consent flow. Admin-only. Returns the consent URL for
// the browser to navigate to (so we can guard it with the caller's bearer token).

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/api-auth"
import { isOAuthConfigured, buildConsentUrl, signState, oauthCallbackUrl } from "@/lib/google-oauth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const guard = await requireRole(request, ["admin"])
  if (guard.error) return guard.error

  if (!isOAuthConfigured()) {
    return NextResponse.json(
      { error: "OAuth is not configured (set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET)." },
      { status: 400 },
    )
  }
  const origin = new URL(request.url).origin
  return NextResponse.json({ url: buildConsentUrl(origin, signState()), redirectUri: oauthCallbackUrl(origin) })
}
