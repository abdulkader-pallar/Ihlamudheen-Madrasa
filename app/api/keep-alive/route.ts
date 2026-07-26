import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export const runtime = "edge"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  // Optional: protect with a secret so only your cron can call it
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get("secret")
  const expectedSecret = process.env.CRON_SECRET

  if (expectedSecret && secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    // Simple query to keep the database active
    const { count, error } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })

    if (error) throw error

    return NextResponse.json({
      status: "alive",
      timestamp: new Date().toISOString(),
      usersCount: count,
      message: "Supabase project pinged successfully",
    })
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        message: err instanceof Error ? err.message : "Ping failed",
      },
      { status: 500 }
    )
  }
}
