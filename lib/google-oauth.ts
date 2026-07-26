// ── Google OAuth: upload to Drive "as the institute's own account" ────────────
// A service account can't store files on a personal Google account. Instead the
// admin connects their own Google account once (OAuth consent); we keep the
// refresh token (server-side only, in google_oauth_tokens) and upload as them,
// so files are owned by the user and land in their Drive folder.
//
// Env (set in the deployment):
//   • GOOGLE_OAUTH_CLIENT_ID
//   • GOOGLE_OAUTH_CLIENT_SECRET
//   • (redirect URI is derived from the request origin)

import crypto from "crypto"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  driveMultipartUpload,
  driveDeleteFile,
  ensureDriveFolderPath,
  type DriveUploadResult,
  DEFAULT_LESSON_PLANS_FOLDER_ID,
} from "@/lib/google-drive"

const TOKEN_URI = "https://oauth2.googleapis.com/token"
const AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ")

export function isOAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET)
}

export function oauthCallbackUrl(origin: string): string {
  return `${origin}/api/lesson-plans/oauth/callback`
}

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase service role not configured")
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// ── CSRF state (stateless HMAC, so only the admin-guarded start route can mint
//    a valid state) ────────────────────────────────────────────────────────
function stateSecret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "rp-oauth"
}
function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
}
export function signState(): string {
  const payload = `${crypto.randomBytes(8).toString("hex")}.${Date.now() + 10 * 60 * 1000}`
  const mac = crypto.createHmac("sha256", stateSecret()).update(payload).digest("hex")
  return `${b64url(payload)}.${mac}`
}
export function verifyState(state: string): boolean {
  try {
    const [p, mac] = state.split(".")
    if (!p || !mac) return false
    const payload = Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    const expected = crypto.createHmac("sha256", stateSecret()).update(payload).digest("hex")
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false
    const exp = Number(payload.split(".")[1])
    return Number.isFinite(exp) && Date.now() < exp
  } catch {
    return false
  }
}

export function buildConsentUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    redirect_uri: oauthCallbackUrl(origin),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: SCOPES,
    state,
  })
  return `${AUTH_URI}?${params.toString()}`
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  error?: string
  error_description?: string
}

/** Exchange the authorization code for tokens and persist the refresh token. */
export async function exchangeCodeAndStore(code: string, origin: string): Promise<{ email?: string; error?: string }> {
  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      redirect_uri: oauthCallbackUrl(origin),
      grant_type: "authorization_code",
    }),
  })
  const json = (await res.json()) as TokenResponse
  if (!res.ok || !json.refresh_token) {
    return { error: json.error_description || json.error || "Token exchange failed (no refresh token returned)" }
  }

  // Look up which account was connected (for display).
  let email: string | undefined
  try {
    if (json.access_token) {
      const u = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${json.access_token}` },
      })
      if (u.ok) email = ((await u.json()) as { email?: string }).email
    }
  } catch { /* non-fatal */ }

  const { error } = await adminClient().from("google_oauth_tokens").upsert({
    id: 1,
    refresh_token: json.refresh_token,
    email: email || null,
    scope: SCOPES,
    updated_at: new Date().toISOString(),
  })
  if (error) return { error: error.message }
  return { email }
}

async function getStoredRefreshToken(): Promise<{ refreshToken?: string; email?: string }> {
  try {
    const { data } = await adminClient()
      .from("google_oauth_tokens")
      .select("refresh_token, email")
      .eq("id", 1)
      .maybeSingle()
    return { refreshToken: data?.refresh_token || undefined, email: data?.email || undefined }
  } catch {
    return {}
  }
}

/** Mint a fresh access token from the stored refresh token. */
async function getOAuthAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })
  const json = (await res.json()) as TokenResponse
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Could not refresh Google access token")
  }
  return json.access_token
}

export interface OAuthConnection {
  connected: boolean
  email?: string
}

export async function getOAuthConnection(): Promise<OAuthConnection> {
  if (!isOAuthConfigured()) return { connected: false }
  const { refreshToken, email } = await getStoredRefreshToken()
  return { connected: !!refreshToken, email }
}

/** Disconnect (remove the stored refresh token). */
export async function disconnectOAuth(): Promise<void> {
  await adminClient().from("google_oauth_tokens").delete().eq("id", 1)
}

/** Upload a file to Drive as the connected user. Throws if not connected. */
export async function uploadToDriveOAuth(
  file: { name: string; mimeType: string; bytes: Buffer },
  folderId: string = DEFAULT_LESSON_PLANS_FOLDER_ID,
  subPath: string[] = [],
): Promise<DriveUploadResult> {
  const { refreshToken } = await getStoredRefreshToken()
  if (!refreshToken) throw new Error("Google Drive is not connected (OAuth).")
  const token = await getOAuthAccessToken(refreshToken)
  const target = subPath.length ? await ensureDriveFolderPath(token, folderId, subPath) : folderId
  return driveMultipartUpload(token, file, target)
}

/** End-to-end OAuth write check (create + delete a tiny file). */
export async function checkOAuthDriveAccess(
  folderId: string = DEFAULT_LESSON_PLANS_FOLDER_ID,
): Promise<{ ok: boolean; email?: string; folderName?: string; error?: string }> {
  const { refreshToken, email } = await getStoredRefreshToken()
  if (!refreshToken) return { ok: false, error: "Not connected." }
  try {
    const token = await getOAuthAccessToken(refreshToken)
    // Read the folder name (and confirm access).
    const meta = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const folderName = meta.ok ? ((await meta.json()) as { name?: string }).name : undefined
    // Write test.
    const test = await driveMultipartUpload(
      token,
      { name: `.rp-drive-write-test-${Date.now()}`, mimeType: "text/plain", bytes: Buffer.from("ok") },
      folderId,
    )
    await driveDeleteFile(token, test.id)
    return { ok: true, email, folderName }
  } catch (e) {
    return { ok: false, email, error: e instanceof Error ? e.message : "OAuth Drive check failed." }
  }
}
