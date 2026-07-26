// Google redirects here after consent. This is a top-level browser navigation
// (no bearer token), so CSRF is enforced via the HMAC-signed `state` that only
// the admin-guarded /oauth/start route can mint. We exchange the code for a
// refresh token, store it, and bounce back to the lesson-plans page.

import { NextResponse } from "next/server"
import { verifyState, exchangeCodeAndStore } from "@/lib/google-oauth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const oauthError = url.searchParams.get("error")
  const dest = new URL("/dashboard/lesson-plans", url.origin)

  if (oauthError) {
    dest.searchParams.set("drive", "error")
    dest.searchParams.set("msg", oauthError)
    return NextResponse.redirect(dest)
  }
  if (!code || !state || !verifyState(state)) {
    dest.searchParams.set("drive", "error")
    dest.searchParams.set("msg", "Invalid or expired authorization. Please try connecting again.")
    return NextResponse.redirect(dest)
  }

  const result = await exchangeCodeAndStore(code, url.origin)
  if (result.error) {
    dest.searchParams.set("drive", "error")
    dest.searchParams.set("msg", result.error)
    return NextResponse.redirect(dest)
  }
  dest.searchParams.set("drive", "connected")
  if (result.email) dest.searchParams.set("email", result.email)
  return NextResponse.redirect(dest)
}
