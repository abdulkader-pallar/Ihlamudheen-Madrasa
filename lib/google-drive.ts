// ── Google Drive upload via a service account (server-only) ───────────────────
// Used by the lesson-plan / PPT submission flow to push uploaded files into the
// shared institute Drive folder.
//
// SECURITY: credentials are read ONLY from the environment, never hard-coded.
//   • GOOGLE_SERVICE_ACCOUNT_JSON  — the full service-account JSON (as a string)
//   • GOOGLE_DRIVE_LESSON_PLANS_FOLDER_ID — target Drive folder id (REQUIRED)
//
// Implemented with Node's built-in crypto (RS256 JWT → OAuth2 token) + the Drive
// REST API, so it adds no new npm dependency. Must run on the Node.js runtime.

import crypto from "crypto"

const TOKEN_URI = "https://oauth2.googleapis.com/token"
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink"

// The Drive folder the institute uses for lesson plans / PPTs.
// Set GOOGLE_DRIVE_LESSON_PLANS_FOLDER_ID to the folder's id — the part of the
// folder URL after /folders/ :
//   https://drive.google.com/drive/folders/THIS_IS_THE_ID
// There is deliberately no default: uploading into someone else's folder would
// silently fail (or leak files), so an unset value is reported clearly instead.
export const DEFAULT_LESSON_PLANS_FOLDER_ID =
  process.env.GOOGLE_DRIVE_LESSON_PLANS_FOLDER_ID || ""

export const isDriveFolderConfigured = () => DEFAULT_LESSON_PLANS_FOLDER_ID.length > 0

interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
}

export interface DriveUploadResult {
  id: string
  name: string
  webViewLink?: string
}

/** True when a service-account credential is present in the environment. */
export function isDriveConfigured(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON
}

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) return null
  try {
    const sa = JSON.parse(raw) as ServiceAccount
    if (!sa.client_email || !sa.private_key) return null
    // Tolerate escaped newlines when the JSON is stored as a single env line.
    sa.private_key = sa.private_key.replace(/\\n/g, "\n")
    return sa
  } catch {
    return null
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
}

/** Mint a short-lived OAuth2 access token for the service account (RS256 JWT). */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: DRIVE_SCOPE,
      aud: sa.token_uri || TOKEN_URI,
      iat: now,
      exp: now + 3600,
    }),
  )
  const signingInput = `${header}.${claim}`
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(sa.private_key)
  const assertion = `${signingInput}.${base64url(signature)}`

  const res = await fetch(sa.token_uri || TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  })
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`)
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error("Google token exchange returned no access_token")
  return json.access_token
}

/**
 * Upload a single file to the given Drive folder. Returns the new file's id and
 * a shareable webViewLink. Throws when Drive is not configured or the API errors,
 * so callers can record a 'failed'/'partial' submission status.
 */
export async function uploadToDrive(
  file: { name: string; mimeType: string; bytes: Buffer },
  folderId: string = DEFAULT_LESSON_PLANS_FOLDER_ID,
  subPath: string[] = [],
): Promise<DriveUploadResult> {
  const sa = loadServiceAccount()
  if (!sa) throw new Error("Google Drive is not configured (missing GOOGLE_SERVICE_ACCOUNT_JSON)")
  const token = await getAccessToken(sa)
  const target = subPath.length ? await ensureDriveFolderPath(token, folderId, subPath) : folderId
  return driveMultipartUpload(token, file, target)
}

/**
 * Low-level multipart upload to Drive with a ready access token. Shared by the
 * service-account path (uploadToDrive) and the OAuth path (google-oauth.ts).
 */
export async function driveMultipartUpload(
  token: string,
  file: { name: string; mimeType: string; bytes: Buffer },
  folderId: string = DEFAULT_LESSON_PLANS_FOLDER_ID,
): Promise<DriveUploadResult> {
  const metadata = { name: file.name, parents: [folderId] }
  const boundary = `rp-${crypto.randomBytes(12).toString("hex")}`
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
    ),
    file.bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ])

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  if (!res.ok) {
    throw new Error(`Drive upload failed (${res.status}): ${await res.text()}`)
  }
  return (await res.json()) as DriveUploadResult
}

/** Make a raw label safe to use as a single Drive folder name. */
function sanitizeFolderName(raw: string): string {
  return raw.replace(/[/\\]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120)
}

/** Find a child folder by name under a parent, creating it if absent. */
async function ensureChildFolder(token: string, parentId: string, name: string): Promise<string> {
  // Escape backslashes then single quotes for the Drive query string.
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
  const q = `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const listUrl =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
    `&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1`
  const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } })
  if (res.ok) {
    const data = (await res.json()) as { files?: { id: string }[] }
    if (data.files && data.files.length) return data.files[0].id
  }
  const createRes = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    },
  )
  if (!createRes.ok) {
    throw new Error(`Failed to create folder "${name}" (${createRes.status}): ${await createRes.text()}`)
  }
  return ((await createRes.json()) as { id: string }).id
}

/**
 * Resolve (creating as needed) a nested folder path under a root folder and
 * return the leaf folder id. Empty/blank segments are skipped. Used to file
 * lesson plans under Course / Class / Date instead of one flat folder.
 */
export async function ensureDriveFolderPath(
  token: string,
  rootFolderId: string,
  segments: string[],
): Promise<string> {
  let parent = rootFolderId
  for (const rawSeg of segments) {
    const seg = sanitizeFolderName(rawSeg)
    if (!seg) continue
    parent = await ensureChildFolder(token, parent, seg)
  }
  return parent
}

/** Delete a Drive file by id, with a ready access token. */
export async function driveDeleteFile(token: string, id: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
}

/** The service-account email the Drive folder must be shared with (or null). */
export function getServiceAccountEmail(): string | null {
  return loadServiceAccount()?.client_email ?? null
}

/** Delete a Drive file by id (used to clean up the write test). */
async function deleteFromDrive(token: string, id: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
}

/** Turn a raw Drive error into a plain-language cause + fix. */
function explainDriveWriteError(raw: string): string {
  const r = raw.toLowerCase()
  if (r.includes("storagequotaexceeded") || r.includes("do not have storage quota")) {
    return "The service account has no Drive storage of its own, so it can't save files to a personal Google account. Fix: connect via OAuth (upload as your own Google account) or use a Google Workspace Shared Drive."
  }
  if (r.includes("insufficient") || r.includes("permission")) {
    return "The folder is shared with the service account as Viewer, not Editor. Fix: re-share the folder as Editor."
  }
  return raw.slice(0, 200)
}

export interface DriveStatus {
  configured: boolean
  ok: boolean
  folderName?: string
  serviceAccountEmail?: string
  canWrite?: boolean
  error?: string
}

/**
 * Verify the credential parses, a token can be minted, the target folder is
 * readable AND writable (by actually creating + deleting a tiny test file).
 * A read-only "connected" is misleading because uploads can still fail, so the
 * write test is what makes the status badge trustworthy.
 */
export async function checkDriveAccess(
  folderId: string = DEFAULT_LESSON_PLANS_FOLDER_ID,
): Promise<DriveStatus> {
  const sa = loadServiceAccount()
  if (!sa) {
    return { configured: isDriveConfigured(), ok: false, error: "Service-account JSON missing or invalid." }
  }
  try {
    const token = await getAccessToken(sa)

    // 1) Can we read the folder?
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) {
      const body = await res.text()
      const hint = res.status === 404
        ? "Folder not found — check the folder id and share it with the service-account email as Editor."
        : `Drive returned ${res.status}.`
      return { configured: true, ok: false, serviceAccountEmail: sa.client_email, error: `${hint} ${body.slice(0, 160)}` }
    }
    const folder = (await res.json()) as { name?: string }

    // 2) Can we actually write to it? (create a tiny file, then delete it)
    try {
      const test = await uploadToDrive(
        { name: `.rp-drive-write-test-${Date.now()}`, mimeType: "text/plain", bytes: Buffer.from("ok") },
        folderId,
      )
      await deleteFromDrive(token, test.id)
    } catch (we) {
      return {
        configured: true,
        ok: false,
        canWrite: false,
        folderName: folder.name,
        serviceAccountEmail: sa.client_email,
        error: `Read OK, but writing failed. ${explainDriveWriteError(we instanceof Error ? we.message : String(we))}`,
      }
    }

    return { configured: true, ok: true, canWrite: true, folderName: folder.name, serviceAccountEmail: sa.client_email }
  } catch (e) {
    return {
      configured: true,
      ok: false,
      serviceAccountEmail: sa.client_email,
      error: e instanceof Error ? e.message : "Drive check failed.",
    }
  }
}
