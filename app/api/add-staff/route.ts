import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { requireRole, generateTempPassword } from "@/lib/api-auth"

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function POST(request: Request) {
  try {
    const guard = await requireRole(request, ["admin"])
    if (guard.error) return guard.error

    const body = await request.json()
    const {
      name,
      email,
      phone,
      fingerprintDeviceId,
      staffType,
      payType,
      dualPayType,
      fixedMonthlyRate,
      dailyRate,
      transportAllowance,
      classIds,
      teachesMadrasa,
      teachesCibis,
      roleLabel,
    } = body

    // Validate required fields
    if (!name || !email || !fingerprintDeviceId || !payType) {
      return NextResponse.json(
        { error: "Missing required fields: name, email, fingerprintDeviceId, payType" },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY not configured on server" },
        { status: 500 }
      )
    }

    const adminClient = getAdminClient()

    // Create Supabase auth account with a unique temp password (no shared default).
    let authUserId: string | null = null
    const tempPassword = generateTempPassword()
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      app_metadata: { role: "teacher" },   // authoritative role (not user-writable)
      user_metadata: {
        role: "teacher",
        full_name: name,
        name,
      },
    })

    if (createError) {
      // If email already registered, look up the existing user
      if (createError.message.toLowerCase().includes("already been registered") ||
          createError.message.toLowerCase().includes("already exists") ||
          createError.message.toLowerCase().includes("duplicate")) {
        const { data: existingUsers } = await adminClient.auth.admin.listUsers()
        const existing = existingUsers?.users.find(
          (u) => u.email?.toLowerCase() === email.toLowerCase()
        )
        if (existing) {
          authUserId = existing.id
        }
        // else: continue without auth user id
      } else {
        return NextResponse.json({ error: createError.message }, { status: 500 })
      }
    } else if (createData.user) {
      authUserId = createData.user.id
    }

    // Build teacher ID from fingerprint device ID
    const teacherId = `t${fingerprintDeviceId}`

    const isNonTeaching = staffType === "non-teaching"

    // Insert into staff_members table
    const { error: insertError } = await adminClient.from("staff_members").upsert(
      {
        id: teacherId,
        name,
        email,
        phone: phone || null,
        fingerprint_device_id: fingerprintDeviceId,
        pay_type: payType,
        dual_pay_type: dualPayType || null,
        fixed_monthly_rate: fixedMonthlyRate ? Number(fixedMonthlyRate) : null,
        daily_rate: dailyRate ? Number(dailyRate) : null,
        transport_allowance: transportAllowance ?? false,
        class_ids: classIds ?? [],
        teaches_cibis: teachesCibis ?? false,
        teaches_madrasa: teachesMadrasa ?? false,
        is_non_teaching: isNonTeaching,
        role_label: roleLabel || null,
        auth_user_id: authUserId,
        status: "active",
      },
      { onConflict: "id" }
    )

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    // Surface the temp password only when we actually created a new auth account,
    // so the admin can relay it once. Existing accounts keep their password.
    const createdNewAuthUser = !createError && !!createData?.user
    return NextResponse.json({
      success: true,
      teacherId,
      tempPassword: createdNewAuthUser ? tempPassword : undefined,
      message: `Staff member ${name} created successfully with ID ${teacherId}.`,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
