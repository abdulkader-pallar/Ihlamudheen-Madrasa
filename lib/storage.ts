import { supabase } from "./supabase"

const BUCKET = "student-photos"
const MAX_SIZE_BYTES = 500 * 1024 // 500KB max after compression

/**
 * Compress an image file to JPEG, max 200x200px, target < 500KB
 */
async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.onload = (e) => {
      const img = document.createElement("img")
      img.onerror = () => reject(new Error("Failed to load image"))
      img.onload = () => {
        const canvas = document.createElement("canvas")
        const size = 200
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext("2d")!
        // Draw centered & cropped
        const min = Math.min(img.width, img.height)
        const sx = (img.width - min) / 2
        const sy = (img.height - min) / 2
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size)
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("Compression failed"))
            if (blob.size > MAX_SIZE_BYTES) {
              // Retry with lower quality
              canvas.toBlob(
                (blob2) => {
                  if (!blob2) return reject(new Error("Compression failed"))
                  resolve(blob2)
                },
                "image/jpeg",
                0.5
              )
            } else {
              resolve(blob)
            }
          },
          "image/jpeg",
          0.75
        )
      }
      img.src = e.target?.result as string
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Upload a student photo to Supabase Storage (private bucket).
 * Returns the storage path (not a public URL).
 */
export async function uploadStudentPhoto(
  studentId: string,
  file: File
): Promise<{ path: string; error: string | null }> {
  try {
    const compressed = await compressImage(file)
    const ext = "jpg"
    const path = `students/${studentId}.${ext}`

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, compressed, {
        contentType: "image/jpeg",
        upsert: true, // overwrite existing photo
      })

    if (error) {
      return { path: "", error: error.message }
    }

    return { path, error: null }
  } catch (err) {
    return { path: "", error: err instanceof Error ? err.message : "Upload failed" }
  }
}

/**
 * Get a signed URL for a student photo (expires in 1 hour).
 * Uses signed URLs for private bucket access.
 */
export async function getStudentPhotoUrl(
  path: string
): Promise<string | null> {
  if (!path) return null

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600) // 1 hour expiry

  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

/**
 * Delete a student photo from storage.
 */
export async function deleteStudentPhoto(
  path: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([path])

  return { error: error?.message ?? null }
}

/**
 * Batch get signed URLs for multiple photos.
 * Returns a map of path -> signedUrl.
 */
export async function getPhotoUrls(
  paths: string[]
): Promise<Record<string, string>> {
  const validPaths = paths.filter(Boolean)
  if (validPaths.length === 0) return {}

  const results: Record<string, string> = {}

  // Fetch signed URLs in parallel (batches of 10)
  const batchSize = 10
  for (let i = 0; i < validPaths.length; i += batchSize) {
    const batch = validPaths.slice(i, i + batchSize)
    const promises = batch.map(async (path) => {
      const url = await getStudentPhotoUrl(path)
      if (url) results[path] = url
    })
    await Promise.all(promises)
  }

  return results
}

// ── Lesson-plan / PPT files (private bucket) ──────────────────────────
// Uploaded directly from the browser so large files bypass the serverless
// request-body limit. The server later mirrors them to Google Drive.
const LESSON_PLAN_BUCKET = "lesson-plans"
const LESSON_PLAN_MAX_BYTES = 100 * 1024 * 1024 // 100 MB (matches the bucket)

export const LESSON_PLAN_MAX_MB = 100

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120)
}

/**
 * Upload one lesson-plan/PPT file straight to Supabase Storage.
 * Returns the stored path (used by the server to mirror to Drive).
 */
export async function uploadLessonPlanFile(
  file: File,
): Promise<{ path: string; error: string | null }> {
  if (file.size > LESSON_PLAN_MAX_BYTES) {
    return { path: "", error: `${file.name} exceeds the ${LESSON_PLAN_MAX_MB} MB limit.` }
  }
  const folder = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const path = `uploads/${folder}/${safeFileName(file.name)}`
  const { error } = await supabase.storage
    .from(LESSON_PLAN_BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false })
  if (error) return { path: "", error: error.message }
  return { path, error: null }
}

/** Signed URL (1 hour) for a stored lesson-plan/PPT file. */
export async function getLessonPlanUrl(path: string): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabase.storage
    .from(LESSON_PLAN_BUCKET)
    .createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

// ── Online-class session proofs (private bucket) ──────────────────────
// Screenshot of the Google Meet participant grid, uploaded directly from
// the browser and referenced by a session_proofs row created via
// /api/session-proofs. Path layout `<teacherId>/<date>/<session>/<file>`
// is validated server-side — keep it in sync with that route.
const SESSION_PROOF_BUCKET = "session-proofs"
const SESSION_PROOF_MAX_DIM = 1600 // px — keeps the Meet grid readable, file small

/** Downscale a screenshot to ≤1600px on its longest side, JPEG ~0.8. */
async function compressProofImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.onload = (e) => {
      const img = document.createElement("img")
      img.onerror = () => reject(new Error("Failed to load image — is it a screenshot?"))
      img.onload = () => {
        const scale = Math.min(1, SESSION_PROOF_MAX_DIM / Math.max(img.width, img.height))
        const canvas = document.createElement("canvas")
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Compression failed"))),
          "image/jpeg",
          0.8
        )
      }
      img.src = e.target?.result as string
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Upload one class-proof screenshot for a session.
 * Returns the storage path to send to POST /api/session-proofs.
 */
export async function uploadSessionProofImage(
  teacherId: string,
  date: string, // YYYY-MM-DD
  session: string,
  file: File,
): Promise<{ path: string; error: string | null }> {
  try {
    const compressed = await compressProofImage(file)
    const path = `${teacherId}/${date}/${session}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const { error } = await supabase.storage
      .from(SESSION_PROOF_BUCKET)
      .upload(path, compressed, { contentType: "image/jpeg", upsert: false })
    if (error) return { path: "", error: error.message }
    return { path, error: null }
  } catch (err) {
    return { path: "", error: err instanceof Error ? err.message : "Upload failed" }
  }
}

/** Signed URL (1 hour) for a stored session-proof screenshot. */
export async function getSessionProofUrl(path: string): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabase.storage
    .from(SESSION_PROOF_BUCKET)
    .createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
