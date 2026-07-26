import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { requireRole, generateTempPassword } from "@/lib/api-auth"

// Accounts to create — emails stored ONLY server-side, never sent to client.
// Intentionally EMPTY: add your own staff here to batch-provision their logins,
// e.g. { name: "Teacher Name", email: "teacher@example.com", role: "teacher" }.
const ACCOUNTS_TO_CREATE: { name: string; email: string; role: "admin" | "accountant" | "teacher" }[] = []

// Authorize a setup call: an authenticated admin, OR a one-time bootstrap secret
// (SETUP_BOOTSTRAP_SECRET) for the very first provisioning before any admin exists.
// Returns a NextResponse to short-circuit when unauthorized, or null when allowed.
async function authorizeSetup(req: NextRequest): Promise<NextResponse | null> {
  const bootstrap = process.env.SETUP_BOOTSTRAP_SECRET
  const provided = req.nextUrl.searchParams.get("secret") || req.headers.get("x-setup-secret")
  if (bootstrap && provided && provided === bootstrap) return null
  const guard = await requireRole(req, ["admin"])
  return guard.error ?? null
}

// Diagnostic: list each configured account with its auth providers.
// Google-only accounts have no password → email+password sign-in fails for them.
export async function GET(req: NextRequest) {
  try {
    const denied = await authorizeSetup(req)
    if (denied) return denied

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 })
    }
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: existingUsers } = await adminClient.auth.admin.listUsers()
    const byEmail = new Map(
      (existingUsers?.users || []).map((u) => [u.email?.toLowerCase(), u])
    )

    const rows = ACCOUNTS_TO_CREATE.map((a) => {
      const u = byEmail.get(a.email.toLowerCase())
      if (!u) {
        return { name: a.name, email: a.email, role: a.role, exists: false, providers: [], hasPassword: false, needsReset: true }
      }
      const providers = (u.app_metadata?.providers as string[]) || (u.app_metadata?.provider ? [u.app_metadata.provider as string] : [])
      const hasPassword = providers.includes("email")
      return {
        name: a.name,
        email: a.email,
        role: a.role,
        exists: true,
        providers,
        hasPassword,
        needsReset: !hasPassword,
      }
    })
    const needsReset = rows.filter((r) => r.needsReset)
    return NextResponse.json({
      total: rows.length,
      needsResetCount: needsReset.length,
      needsReset: needsReset.map((r) => r.email),
      rows,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = await authorizeSetup(req)
    if (denied) return denied

    // Opt-in: ?resetPasswords=true also resets passwords on existing accounts
    // (useful for accounts first created via Google OAuth — they have no password).
    const resetPasswords = req.nextUrl.searchParams.get("resetPasswords") === "true"
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY not configured in .env.local. Go to Supabase Dashboard → Settings → API → service_role (secret) and paste it." },
        { status: 500 }
      )
    }

    // Create admin client with service role key (full access)
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Quick test: verify the service role key works
    const { error: testError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1 })
    if (testError) {
      return NextResponse.json(
        { error: `Service role key invalid: ${testError.message}. Check SUPABASE_SERVICE_ROLE_KEY in .env.local` },
        { status: 500 }
      )
    }

    const results: { name: string; role: string; status: "created" | "exists" | "error"; message?: string; tempPassword?: string }[] = []

    // Fetch all existing users once (instead of per-iteration)
    const { data: existingUsers } = await adminClient.auth.admin.listUsers()
    const existingMap = new Map(
      (existingUsers?.users || []).map((u) => [u.email?.toLowerCase(), u])
    )

    for (const account of ACCOUNTS_TO_CREATE) {
      try {
        const exists = existingMap.get(account.email.toLowerCase())

        if (exists) {
          // Update role/name; optionally also reset password to default.
          const updatePayload: {
            app_metadata: Record<string, unknown>
            user_metadata: Record<string, unknown>
            password?: string
          } = {
            app_metadata: { role: account.role },   // authoritative role (not user-writable)
            user_metadata: {
              ...exists.user_metadata,
              role: account.role,
              full_name: account.name,
            },
          }
          const resetPw = resetPasswords ? generateTempPassword() : undefined
          if (resetPw) updatePayload.password = resetPw
          await adminClient.auth.admin.updateUserById(exists.id, updatePayload)
          results.push({
            name: account.name,
            role: account.role,
            status: "exists",
            tempPassword: resetPw,
            message: resetPw
              ? `Role updated to ${account.role}; password reset (unique)`
              : `Role updated to ${account.role}`,
          })
          continue
        }

        // Create new user with appropriate role and a unique temp password.
        const newPw = generateTempPassword()
        const { data, error } = await adminClient.auth.admin.createUser({
          email: account.email,
          password: newPw,
          email_confirm: true, // Auto-confirm so they can log in immediately
          app_metadata: { role: account.role },   // authoritative role (not user-writable)
          user_metadata: {
            role: account.role,
            full_name: account.name,
            name: account.name,
          },
        })

        if (error) {
          results.push({ name: account.name, role: account.role, status: "error", message: error.message })
        } else if (data.user) {
          // Also insert into users table
          await adminClient.from("users").upsert({
            id: data.user.id,
            name: account.name,
            email: account.email,
            role: account.role,
          }, { onConflict: "id" })

          results.push({ name: account.name, role: account.role, status: "created", tempPassword: newPw })
        }
      } catch (err) {
        results.push({
          name: account.name,
          role: account.role,
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        })
      }
    }

    const created = results.filter((r) => r.status === "created").length
    const existing = results.filter((r) => r.status === "exists").length
    const errors = results.filter((r) => r.status === "error").length

    return NextResponse.json({
      success: true,
      summary: { created, existing, errors, total: ACCOUNTS_TO_CREATE.length },
      results,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
